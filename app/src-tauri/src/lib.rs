//! Tegg desktop shell (architecture §3.3): the main window, IPC commands mapped onto `tegg-core`, core events
//! forwarded to the UI. Thin by design: validate, call the core, map errors. Nothing here reads or writes vault
//! files; the perf log and the UI state are machine-local (docs/contracts/ms2-shell.md §1, ms3-shell.md §1, §2).

mod dto;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};
use tegg_core::{
    AppDirs, ConflictKind, Core, CoreError, CoreEvent, CoreOptions, DateRange, FileVersion, LinkKind, MatchField, ProgressState, SearchQuery,
    SwitcherKind, Vault, VaultError, WriteOutcome,
};
use tegg_vault::{CreateError, OpenError, VaultKind};

use dto::*;

struct AppState {
    dirs: AppDirs,
    core: Mutex<Option<Arc<Core>>>,
    vault: Mutex<Option<VaultInfo>>,
}

/// The test environment (contract §1): honoured only with `TEGG_TEST=1`.
fn test_var(name: &str) -> Option<String> {
    if std::env::var("TEGG_TEST").as_deref() != Ok("1") {
        return None;
    }
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// The app name: window title and Application Support folder (D-118: the preview keeps its own data).
const APP_NAME: &str = if cfg!(feature = "preview") { "Tegg Preview" } else { "Tegg" };

fn app_dirs() -> AppDirs {
    let root = test_var("TEGG_APP_SUPPORT").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support").join(APP_NAME)
    });
    AppDirs { root }
}

// ---------------------------------------------------------------- perf marks (test-strategy §9)

/// Milliseconds since this process started, by the OS start time (contract §1).
#[cfg(target_os = "macos")]
fn ms_since_process_start() -> f64 {
    // SAFETY: `info` is a plain C struct the call fills in; size passed matches its type.
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        let n = libc::proc_pidinfo(libc::getpid(), libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size);
        if n != size {
            return f64::NAN;
        }
        let start = Duration::from_secs(info.pbi_start_tvsec) + Duration::from_micros(info.pbi_start_tvusec);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        now.saturating_sub(start).as_secs_f64() * 1e3
    }
}

#[cfg(not(target_os = "macos"))]
fn ms_since_process_start() -> f64 {
    f64::NAN
}

static MARKS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Writes `{"mark", "ms"}` once per mark to `TEGG_PERF_LOG`; quits (exit code 0) after `TEGG_EXIT_AFTER`.
fn mark(app: &AppHandle, name: &str) {
    let Some(log) = test_var("TEGG_PERF_LOG") else { return };
    {
        let mut seen = MARKS.lock().unwrap_or_else(|p| p.into_inner());
        if seen.iter().any(|m| m == name) {
            return;
        }
        seen.push(name.to_string());
    }
    let line = serde_json::json!({ "mark": name, "ms": ms_since_process_start() });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        let _ = writeln!(f, "{line}");
    }
    if test_var("TEGG_EXIT_AFTER").as_deref() == Some(name) {
        app.exit(0);
    }
}

// ---------------------------------------------------------------- vault and events

fn err(kind: &str, message: impl ToString) -> IpcError {
    IpcError { kind: kind.into(), message: message.to_string(), conflict: None }
}

fn version_dto(v: &FileVersion) -> VersionDto {
    VersionDto { mtime_ns: v.mtime_ns.to_string(), size: v.size, hash: v.hash.iter().map(|b| format!("{b:02x}")).collect() }
}

fn version_from(d: &VersionDto) -> Result<FileVersion, IpcError> {
    let bad = || err("Io", "malformed version");
    if d.hash.len() != 64 {
        return Err(bad());
    }
    let mut hash = [0u8; 32];
    for (i, h) in hash.iter_mut().enumerate() {
        *h = u8::from_str_radix(&d.hash[2 * i..2 * i + 2], 16).map_err(|_| bad())?;
    }
    Ok(FileVersion { mtime_ns: d.mtime_ns.parse().map_err(|_| bad())?, size: d.size, hash })
}

/// Repeatable marks (D-207 `index-idle`): one line per occurrence, unlike `mark`.
fn mark_repeat(name: &str) {
    let Some(log) = test_var("TEGG_PERF_LOG") else { return };
    let line = serde_json::json!({ "mark": name, "ms": ms_since_process_start() });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
        let _ = writeln!(f, "{line}");
    }
}

fn core_err(e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => err("Conflict", "the file changed on disk"),
        CoreError::Vault(VaultError::Gone) => err("Gone", "the file was deleted"),
        CoreError::Vault(VaultError::NotFound) => err("NotFound", "no such file"),
        CoreError::Vault(VaultError::NameTaken) => err("NameTaken", "the name is taken"),
        CoreError::NotUtf8 => err("NotUtf8", "the file isn't valid UTF-8"),
        other => err("Io", format!("{other:?}")),
    }
}

fn open_vault(app: &AppHandle, path: PathBuf) -> Result<VaultInfo, IpcError> {
    let state = app.state::<AppState>();
    // FR-VLT-01 AC-4/AC-5, D-91: a folder that isn't a Tegg vault is refused before anything else (zero writes).
    if let Err(e) = Vault::open(&path, &state.dirs) {
        return Err(match e {
            OpenError::NotATeggVault => err("NotATeggVault", "the folder has no .tegg/vault.yml"),
            OpenError::Missing => err("NotFound", "the folder doesn't exist"),
            other => err("Io", format!("{other:?}")),
        });
    }
    // One vault at a time (D-35): the old core stops (and saves its recency) before the new one opens.
    *state.core.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let core = Arc::new(Core::open(&path, &state.dirs, CoreOptions { watch: true, sync: None }).map_err(core_err)?);
    let info = VaultInfo {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: core.vault().root().to_string_lossy().into_owned(),
        placeholders: core.placeholders().len() as u32,
    };
    forward_events(app.clone(), &core);
    {
        // D-207: `index-idle` each time the index queue drains (L6 waits on it).
        let weak = Arc::downgrade(&core);
        if test_var("TEGG_PERF_LOG").is_some() {
            std::thread::spawn(move || {
                let mut was_idle = false;
                while let Some(core) = weak.upgrade() {
                    let idle = core.wait_idle(Duration::ZERO);
                    if idle && !was_idle {
                        mark_repeat("index-idle");
                    }
                    was_idle = idle;
                    drop(core);
                    std::thread::sleep(Duration::from_millis(50));
                }
            });
        }
    }
    *state.core.lock().unwrap_or_else(|p| p.into_inner()) = Some(core);
    *state.vault.lock().unwrap_or_else(|p| p.into_inner()) = Some(info.clone());
    Ok(info)
}

/// Core events → UI events (contract §2).
fn forward_events(app: AppHandle, core: &Core) {
    let rx = core.events();
    std::thread::spawn(move || {
        for e in rx {
            match e {
                CoreEvent::IndexProgress { done, total, state } => {
                    let s = match state {
                        ProgressState::Running => "running",
                        ProgressState::Done => "done",
                        ProgressState::Cancelled => "cancelled",
                    };
                    let _ = app.emit("index:progress", ProgressDto { done: done as u32, total: total as u32, state: s.into() });
                    if state == ProgressState::Done {
                        mark(&app, "index-ready");
                    }
                }
                CoreEvent::VaultChanged { paths } => {
                    let _ = app.emit("vault:changed", ChangedDto { paths });
                }
                CoreEvent::NoteConflict { path, mine, theirs, disk } => {
                    let c = ConflictDto {
                        path,
                        mine: String::from_utf8_lossy(&mine).into_owned(),
                        theirs: String::from_utf8_lossy(&theirs).into_owned(),
                        theirs_version: version_dto(&disk),
                    };
                    let _ = app.emit("note:conflict", c);
                }
                CoreEvent::Placeholders { .. } => {}
            }
        }
    });
}

fn core(state: &State<AppState>) -> Result<Arc<Core>, IpcError> {
    state.core.lock().unwrap_or_else(|p| p.into_inner()).clone().ok_or_else(|| err("NoVault", "no vault is open"))
}

/// The machine's time zone for date filters (D-104).
fn local_tz() -> chrono_tz::Tz {
    iana_time_zone::get_timezone().ok().and_then(|n| n.parse().ok()).unwrap_or(chrono_tz::UTC)
}

fn utf16(s: &str, byte: usize) -> u32 {
    s.get(..byte).map(|p| p.encode_utf16().count()).unwrap_or(0) as u32
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn vault_current(state: State<AppState>) -> Option<VaultInfo> {
    state.vault.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

#[tauri::command]
async fn vault_open(app: AppHandle, path: String) -> Result<VaultInfo, IpcError> {
    open_vault(&app, PathBuf::from(path))
}

#[tauri::command]
async fn index_search(state: State<'_, AppState>, query: SearchQueryDto) -> Result<SearchPageDto, IpcError> {
    let core = core(&state)?;
    let range = |r: &Option<DateRangeDto>| -> Result<Option<DateRange>, IpcError> {
        match r {
            None => Ok(None),
            Some(r) => {
                let d = |s: &str| tegg_format_date(s).ok_or_else(|| err("Io", format!("bad date {s}")));
                Ok(Some(DateRange { from: d(&r.from)?, to: d(&r.to)? }))
            }
        }
    };
    let mut q = SearchQuery::text(&query.text, local_tz());
    q.types = query.types.clone();
    q.tags = query.tags.clone();
    q.created = range(&query.created)?;
    q.modified = range(&query.modified)?;
    q.review = query.review.clone();
    q.offset = query.offset as usize;
    if query.limit > 0 {
        q.limit = query.limit as usize;
    }
    let page = core.search(&q).map_err(core_err)?;
    Ok(SearchPageDto {
        total: page.total as u32,
        results: page
            .results
            .into_iter()
            .map(|r| SearchResultDto {
                path: r.path,
                type_key: r.r#type,
                title: r.title,
                matched_in: match r.matched_in {
                    MatchField::Title => "title",
                    MatchField::Alias => "alias",
                    MatchField::Attribute => "attribute",
                    MatchField::Body => "body",
                }
                .into(),
                typo: r.typo,
                snippet: r.snippet.map(|s| SnippetDto {
                    highlights: s.highlights.iter().map(|&(a, b)| (utf16(&s.text, a), utf16(&s.text, b))).collect(),
                    line: s.line as u32,
                    text: s.text,
                }),
            })
            .collect(),
    })
}

fn tegg_format_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

#[tauri::command]
async fn index_switcher(state: State<'_, AppState>, q: String, limit: u32) -> Result<Vec<SwitcherItemDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .switcher(&q, limit.max(1) as usize)
        .into_iter()
        .map(|i| SwitcherItemDto {
            created: i.path.as_deref().and_then(|p| core.object(p)).and_then(|o| o.attributes.get("created").and_then(|v| v.as_str()).map(str::to_string)),
            kind: if i.kind == SwitcherKind::Create { "create" } else { "object" }.into(),
            path: i.path,
            title: i.title,
            type_key: i.r#type,
            folder: i.folder,
            matched_alias: i.matched_alias,
        })
        .collect())
}

#[tauri::command]
async fn note_read(state: State<'_, AppState>, path: String) -> Result<NoteDto, IpcError> {
    let core = core(&state)?;
    let r = core.read_note_info(&path, SystemTime::now()).map_err(core_err)?;
    Ok(NoteDto { path, text: String::from_utf8_lossy(&r.bytes).into_owned(), version: version_dto(&r.version), utf8: r.utf8 })
}

/// ms3-shell §13.2: the editor's save, through MS1's one write function (D-175 version rule).
#[tauri::command]
async fn note_write(app: AppHandle, state: State<'_, AppState>, path: String, text: String, base: Option<VersionDto>) -> Result<WriteResultDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    match core.write_note(&path, text.as_bytes(), base.as_ref()) {
        Ok(WriteOutcome::Written(v)) => {
            mark(&app, "note-saved");
            Ok(WriteResultDto { outcome: "written".into(), version: version_dto(&v) })
        }
        Ok(WriteOutcome::Unchanged) => {
            let v = core.vault().version(&path).ok().flatten().ok_or_else(|| err("Gone", "the file was deleted"))?;
            Ok(WriteResultDto { outcome: "unchanged".into(), version: version_dto(&v) })
        }
        Err(CoreError::Vault(VaultError::Conflict { disk })) => {
            let theirs = core.vault().read(&path).map(|(b, _)| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
            let mut e = err("Conflict", "the file changed on disk");
            e.conflict = Some(ConflictDto { path, mine: text, theirs, theirs_version: version_dto(&disk) });
            Err(e)
        }
        Err(e) => Err(core_err(e)),
    }
}

/// D-194: `Keep both` creates exactly this path; `NameTaken` if it exists.
#[tauri::command]
async fn note_create_exact(state: State<'_, AppState>, path: String, text: String) -> Result<VersionDto, IpcError> {
    let core = core(&state)?;
    core.create_exact(&path, text.as_bytes()).map(|v| version_dto(&v)).map_err(core_err)
}

/// D-195: trash after a version check; Conflicts view only.
#[tauri::command]
async fn note_trash(state: State<'_, AppState>, path: String, base: VersionDto) -> Result<String, IpcError> {
    let core = core(&state)?;
    core.trash_note(&path, &version_from(&base)?).map_err(core_err)
}

/// D-185.
#[tauri::command]
async fn index_tags(state: State<'_, AppState>) -> Result<Vec<TagDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.tags().into_iter().map(|t| TagDto { key: t.key, spelling: t.spelling, count: t.count as u32 }).collect())
}

/// ms3-shell §13.2: `Core::conflicts()` with versions.
#[tauri::command]
async fn index_conflicts(state: State<'_, AppState>) -> Result<Vec<ConflictRowDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .conflicts()
        .into_iter()
        .map(|c| {
            let versions = std::iter::once(&c.primary)
                .chain(&c.others)
                .filter_map(|p| core.vault().version(p).ok().flatten().map(|v| (p.clone(), version_dto(&v))))
                .collect();
            ConflictRowDto {
                kind: match c.kind {
                    ConflictKind::DuplicateId => "duplicateId",
                    ConflictKind::PossibleCopy => "possibleCopy",
                    ConflictKind::NameNormalization => "nameNormalization",
                }
                .into(),
                primary: c.primary,
                others: c.others,
                versions,
            }
        })
        .collect())
}

#[tauri::command]
async fn note_create(state: State<'_, AppState>, dir: String, title: String, text: String) -> Result<String, IpcError> {
    let core = core(&state)?;
    core.create_note(&dir, &title, text.as_bytes()).map_err(core_err)
}

#[tauri::command]
fn perf_mark(app: AppHandle, name: String) {
    mark(&app, &name);
}

// ---------------------------------------------------------------- MS3 slice 3A (ms3-shell §2)

#[tauri::command]
async fn vault_create(app: AppHandle, parent: String, name: String, kind: String) -> Result<VaultInfo, IpcError> {
    if kind != "empty" {
        return Err(err("Unsupported", "starter vaults arrive in slice 3D (D-92)"));
    }
    let dirs = app.state::<AppState>().dirs.clone();
    let vault = Vault::create(&PathBuf::from(&parent), &name, VaultKind::Empty, &dirs).map_err(|e| match e {
        CreateError::NotEmpty => err("NotEmpty", "the target folder exists and isn't empty"),
        other => err("Io", format!("{other:?}")),
    })?;
    let root = vault.root().to_path_buf();
    drop(vault);
    open_vault(&app, root)
}

/// The folder dialog, or the test hook `TEGG_TEST_PICK_DIR` (empty = cancelled, D-135).
#[tauri::command]
async fn vault_pick_dir(app: AppHandle) -> Option<String> {
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if let Ok(dir) = std::env::var("TEGG_TEST_PICK_DIR") {
            return if dir.is_empty() { None } else { Some(dir) };
        }
    }
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    });
    rx.recv().ok().flatten()
}

#[tauri::command]
async fn vault_last(state: State<'_, AppState>) -> Result<Option<LastOpenedDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.last_opened().map(|(path, id)| LastOpenedDto { path, id }))
}

#[tauri::command]
async fn vault_types(state: State<'_, AppState>) -> Result<Vec<TypeDefDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .types()
        .into_iter()
        .map(|t| TypeDefDto { key: t.key, name: t.name, plural: t.plural, folder: t.folder, icon: t.icon, color: t.color, system: t.system, invalid: t.invalid })
        .collect())
}

#[tauri::command]
async fn index_type_counts(state: State<'_, AppState>) -> Result<std::collections::BTreeMap<String, u32>, IpcError> {
    let core = core(&state)?;
    Ok(core.type_counts().into_iter().map(|(k, v)| (k, v as u32)).collect())
}

#[tauri::command]
async fn index_list(state: State<'_, AppState>, r#type: String) -> Result<Vec<ObjectRowDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .list_type(&r#type)
        .into_iter()
        .map(|o| {
            let modified = o.attributes.get("modified").and_then(|v| v.as_str()).map(str::to_string);
            ObjectRowDto { path: o.path, id: o.id, title: o.title, type_key: o.r#type, modified }
        })
        .collect())
}

#[tauri::command]
async fn nav_opened(state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    let core = core(&state)?;
    core.record_open(&path, SystemTime::now());
    Ok(())
}

/// `link_resolve` (ms3-shell §11.1): all targets of one note in one call (NFR-PERF-05 AC-3).
#[tauri::command]
async fn link_resolve(state: State<'_, AppState>, from: String, targets: Vec<String>) -> Result<Vec<LinkTargetDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .resolve_links(&from, &targets)
        .into_iter()
        .map(|t| LinkTargetDto {
            target: t.target,
            kind: match t.kind {
                LinkKind::Note => "note",
                LinkKind::Daily => "daily",
                LinkKind::DateMissing => "date-missing",
                LinkKind::Unresolved => "unresolved",
            }
            .into(),
            path: t.path,
            title: t.title,
            type_key: t.r#type,
        })
        .collect())
}

/// D-145: only these schemes are handed to macOS; the shell checks, not only the UI.
fn external_allowed(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// `open_external` (ms3-shell §11.1, D-145): the default macOS handler opens the URL; Tegg fetches nothing
/// (NFR-SEC-01). With `TEGG_TEST=1` nothing is launched.
#[tauri::command]
async fn open_external(url: String) -> Result<(), IpcError> {
    if !external_allowed(&url) {
        return Err(err("Unsupported", "only http, https and mailto links are opened"));
    }
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        return Ok(());
    }
    std::process::Command::new("/usr/bin/open").arg(url.trim()).spawn().map(|_| ()).map_err(|e| err("Io", e.to_string()))
}

#[cfg(test)]
mod external_tests {
    use super::external_allowed;
    #[test]
    fn only_http_https_mailto() {
        for u in ["https://example.com", "http://x", "MAILTO:a@b.c"] {
            assert!(external_allowed(u), "{u}");
        }
        for u in ["javascript:alert(1)", "file:///etc/hosts", "data:text/html,x", "vbscript:x", "ftp://x", "/etc"] {
            assert!(!external_allowed(u), "{u}");
        }
    }
}

const UI_STATE_FILE: &str = "ui-state.json";

fn load_ui_state(dirs: &AppDirs) -> UiStateDto {
    tegg_vault::read_local_file(&dirs.root.join(UI_STATE_FILE)).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

#[tauri::command]
fn ui_state_get(state: State<AppState>) -> UiStateDto {
    load_ui_state(&state.dirs)
}

#[tauri::command]
fn ui_state_set(app_state: State<AppState>, state: UiStateDto) -> Result<(), IpcError> {
    let bytes = serde_json::to_vec_pretty(&state).map_err(|e| err("Io", e))?;
    tegg_vault::write_local_file(&app_state.dirs.root.join(UI_STATE_FILE), &bytes).map_err(|e| err("Io", e))
}

/// The collation locale of this Mac (D-122): the explicit collation order if set, else the region locale.
fn region_locale() -> Option<String> {
    let read = |key: &str| {
        let out = std::process::Command::new("/usr/bin/defaults").args(["read", "-g", key]).output().ok()?;
        let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
        (out.status.success() && !s.is_empty()).then_some(s)
    };
    let raw = read("AppleCollationOrder").or_else(|| read("AppleLocale"))?;
    let tag = raw.split('@').next().unwrap_or(&raw).replace('_', "-");
    Some(tag)
}

/// Set before the UI's first paint (ms3-shell §3.5, §3.6, §10): the stored theme, the region locale, and in the
/// test environment the start route.
fn init_script(dirs: &AppDirs) -> String {
    let mut ui = load_ui_state(dirs);
    if let Some(theme) = test_var("TEGG_THEME").filter(|t| ["system", "light", "dark"].contains(&t.as_str())) {
        ui.theme = theme;
    }
    let route = test_var("TEGG_ROUTE");
    format!(
        "window.__TEGG_UI_STATE__ = {}; window.__TEGG_REGION__ = {}; window.__TEGG_ROUTE__ = {}; window.__TEGG_TEST_MODE__ = {};",
        serde_json::to_string(&ui).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&region_locale()).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&route).unwrap_or_else(|_| "null".into()),
        std::env::var("TEGG_TEST").as_deref() == Ok("1"),
    )
}

pub fn run() {
    let dirs = app_dirs();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { dirs, core: Mutex::new(None), vault: Mutex::new(None) })
        .setup(|app| {
            let handle = app.handle().clone();
            let dirs = app.state::<AppState>().dirs.clone();
            // The main window is built here so the init script runs before the UI (no flash of the wrong theme).
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title(APP_NAME)
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .initialization_script(&init_script(&dirs))
                .build()?;
            let path = test_var("TEGG_VAULT").map(PathBuf::from).or_else(|| Vault::last_opened(&dirs).filter(|(_, exists)| *exists).map(|(p, _)| p));
            if let Some(path) = path {
                // FR-VLT-01 AC-7: a vault that can't be opened leaves the app on its "open a vault" screen.
                if let Err(e) = open_vault(&handle, path) {
                    eprintln!("[tegg] could not open the vault: {}", e.message);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_current, vault_open, index_search, index_switcher, note_read, note_create, perf_mark, vault_create, vault_pick_dir,
            vault_last, vault_types, index_type_counts, index_list, nav_opened, ui_state_get, ui_state_set,
            link_resolve, open_external, note_write, note_create_exact, note_trash, index_tags, index_conflicts
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tegg");
}
