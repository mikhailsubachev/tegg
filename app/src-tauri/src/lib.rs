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
    AppDirs, ConflictKind, Core, CoreError, CoreEvent, CoreOptions, DateRange, FileVersion, LinkKind, LinkTarget, MatchField, ProgressState,
    SearchQuery, StarterPlan, StarterSkip, SwitcherKind, TypeInfo, Vault, VaultError, WriteOutcome,
};
use tegg_schema::{AttrChange, AttrDef, AttrType, Field, OptionDef, RuleError, SchemaError, TypeOp};
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

/// Set once the UI has saved (or the user chose to quit anyway): only then may the app exit (FR-EDT-08 AC-7, D-196).
static ALLOW_EXIT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The mouse's back and forward buttons (FR-NAV-03, D-165): WKWebView doesn't pass them to the page, so a local
/// event monitor turns them into `nav:mouse` events (`back` / `forward`) for the UI.
#[cfg(target_os = "macos")]
fn watch_mouse_buttons(app: AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;
    let block = RcBlock::new(move |e: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a valid event for the duration of the handler.
        let n = unsafe { e.as_ref() }.buttonNumber();
        match n {
            3 => { let _ = app.emit("nav:mouse", "back"); }
            4 => { let _ = app.emit("nav:mouse", "forward"); }
            _ => {}
        }
        e.as_ptr()
    });
    // SAFETY: called on the main thread during setup; the monitor lives as long as the app.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::OtherMouseUp, &block) };
    std::mem::forget(monitor);
}

#[cfg(not(target_os = "macos"))]
fn watch_mouse_buttons(_app: AppHandle) {}

/// The UI's answer to `app:quit-requested`: everything is saved, or the user confirmed (D-179, D-196).
#[tauri::command]
fn app_quit(app: AppHandle) {
    ALLOW_EXIT.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

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
        let _ = f.write_all(format!("{line}\n").as_bytes()); // one write per line: lines from parallel writers never interleave
    }
    if test_var("TEGG_EXIT_AFTER").as_deref() == Some(name) {
        app.exit(0);
    }
}

// ---------------------------------------------------------------- vault and events

fn err(kind: &str, message: impl ToString) -> IpcError {
    IpcError { kind: kind.into(), message: message.to_string(), conflict: None, reason: None, field: None, key: None, label: None, count: None, disk: None }
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
        let _ = f.write_all(format!("{line}\n").as_bytes()); // one write per line: lines from parallel writers never interleave
    }
}

fn core_err(e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => err("Conflict", "the file changed on disk"),
        CoreError::Vault(VaultError::Gone) => err("Gone", "the file was deleted"),
        CoreError::Vault(VaultError::NotFound) => err("NotFound", "no such file"),
        CoreError::Vault(VaultError::NameTaken) => err("NameTaken", "the name is taken"),
        CoreError::NotUtf8 => err("NotUtf8", "the file isn't valid UTF-8"),
        // ms3-shell §14.3 (3D).
        CoreError::Schema(SchemaError::Rule(r)) => rule_err(r),
        CoreError::Schema(SchemaError::NewerVersion) => err("NewerVersion", "made by a newer version of Tegg"),
        CoreError::Schema(SchemaError::Invalid) => err("InvalidType", "the type definition can't be read"),
        CoreError::Schema(SchemaError::BuiltInChanged) => err("BuiltInChanged", "built-in properties can't be changed"),
        CoreError::Schema(SchemaError::ReviewLocked) => err("ReviewLocked", "review is always on for this type"),
        CoreError::Schema(SchemaError::SystemTypeName) | CoreError::SystemType => err("SystemType", "system types can't be renamed or deleted"),
        CoreError::HasObjects(n) => IpcError { count: Some(n as u32), ..err("HasObjects", format!("{n} objects have this type")) },
        CoreError::UnknownType => err("UnknownType", "no such type"),
        other => err("Io", format!("{other:?}")),
    }
}

/// `Rule` errors with `reason`, `field` and `key` / `label` (ms3-shell §14.3).
fn rule_err(r: RuleError) -> IpcError {
    let field = |f: &Field| {
        match f {
            Field::Name => "name",
            Field::Plural => "plural",
            Field::Folder => "folder",
            Field::AttrKey => "attrKey",
            Field::AttrName => "attrName",
            Field::OptionLabel => "optionLabel",
        }
        .to_string()
    };
    let (reason, f, key, label) = match &r {
        RuleError::Empty { field: x } => ("empty", Some(field(x)), None, None),
        RuleError::ForbiddenChar { field: x } => ("forbiddenChar", Some(field(x)), None, None),
        RuleError::KeyTaken => ("keyTaken", Some("name".into()), None, None),
        RuleError::KeyTooLong => ("keyTooLong", Some("name".into()), None, None),
        RuleError::FolderTaken => ("folderTaken", Some("folder".into()), None, None),
        RuleError::FolderInvalid => ("folderInvalid", Some("folder".into()), None, None),
        RuleError::ReservedKey { key } => ("reservedKey", Some("attrKey".into()), Some(key.clone()), None),
        RuleError::AttrKeyTaken => ("attrKeyTaken", Some("attrKey".into()), None, None),
        RuleError::AttrKeyInvalid => ("attrKeyInvalid", Some("attrKey".into()), None, None),
        RuleError::RangeCollision => ("rangeCollision", Some("attrKey".into()), None, None),
        RuleError::OptionEmpty => ("optionEmpty", Some("optionLabel".into()), None, None),
        RuleError::OptionDuplicate => ("optionDuplicate", Some("optionLabel".into()), None, None),
        RuleError::OptionUsed { label } => ("optionUsed", Some("optionLabel".into()), None, Some(label.clone())),
        RuleError::PreviewFull => ("previewFull", None, None, None),
    };
    IpcError { reason: Some(reason.into()), field: f, key, label, ..err("Rule", format!("typeRule.{reason}")) }
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

/// ms3-shell §14.3 (3D): `note_create(type, title, text)` → `Core::create_object` (D-232, D-245). The bytes come
/// from `@tegg/doc` `newObject`; the core picks the folder and a free name and indexes the file.
#[tauri::command]
async fn note_create(state: State<'_, AppState>, r#type: String, title: String, text: String) -> Result<String, IpcError> {
    let core = core(&state)?;
    core.create_object(&r#type, &title, text.as_bytes()).map_err(core_err)
}

/// A mark, or with `frame` a typing-latency record `{"mark":"key","frame","ms"}` (NFR-PERF-06 AC-3, D-199).
#[tauri::command]
fn perf_mark(app: AppHandle, name: String, frame: Option<u32>, ms: Option<f64>) {
    match (frame, ms) {
        (Some(frame), Some(ms)) => {
            let Some(log) = test_var("TEGG_PERF_LOG") else { return };
            let line = serde_json::json!({ "mark": name, "frame": frame, "ms": ms });
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
                let _ = f.write_all(format!("{line}\n").as_bytes()); // one write per line: lines from parallel writers never interleave
            }
        }
        _ => mark(&app, &name),
    }
}

// ---------------------------------------------------------------- MS3 slice 3A (ms3-shell §2)

#[tauri::command]
async fn vault_create(app: AppHandle, parent: String, name: String, kind: String) -> Result<VaultInfo, IpcError> {
    // FR-VLT-02 AC-6 (D-238): the starter kind writes `tegg_schema::STARTER_FILES` on top of the empty vault.
    let kind = match kind.as_str() {
        "empty" => VaultKind::Empty,
        "starter" => VaultKind::Starter(tegg_schema::STARTER_FILES),
        other => return Err(err("Unsupported", format!("unknown vault kind {other}"))),
    };
    let dirs = app.state::<AppState>().dirs.clone();
    let vault = Vault::create(&PathBuf::from(&parent), &name, kind, &dirs).map_err(|e| match e {
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

/// D-219: the recently opened vaults, most recent first (ms3-shell §12.5).
#[tauri::command]
async fn vault_recent(state: State<'_, AppState>) -> Result<Vec<RecentVaultDto>, IpcError> {
    Ok(Vault::recent(&state.dirs)
        .into_iter()
        .map(|r| RecentVaultDto { name: r.name, path: r.path.to_string_lossy().into_owned(), exists: r.exists })
        .collect())
}

/// D-220: the logo menu's `About Tegg` shows the standard macOS About panel.
#[tauri::command]
async fn app_about(app: AppHandle) -> Result<(), IpcError> {
    let _ = app.run_on_main_thread(|| {
        #[cfg(target_os = "macos")]
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            let ns = objc2_app_kit::NSApplication::sharedApplication(mtm);
            ns.orderFrontStandardAboutPanel(None);
        }
    });
    Ok(())
}

#[tauri::command]
async fn vault_types(state: State<'_, AppState>) -> Result<Vec<TypeDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.types().into_iter().map(type_dto).collect())
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
    Ok(core.resolve_links(&from, &targets).into_iter().map(link_dto).collect())
}

// ---------------------------------------------------------------- MS3 slice 3D (ms3-shell §14.3)

fn type_dto(t: TypeInfo) -> TypeDto {
    use tegg_schema::{Readability, Review};
    let (state, error) = match &t.readability {
        Readability::Ok => ("ok", None),
        Readability::Newer(_) => ("newer", None),
        Readability::Invalid { message, line } => ("invalid", Some(TypeFileErrorDto { message: message.clone(), line: *line as u32 })),
    };
    let d = t.def;
    TypeDto {
        key: t.key,
        name: t.name,
        plural: t.plural,
        folder: t.folder,
        icon: t.icon,
        color: t.color,
        system: t.system,
        invalid: t.invalid,
        exists: t.exists,
        version: t.version.as_ref().map(version_dto),
        state: state.into(),
        error,
        declared_version: d.declared_version,
        description: d.description,
        review: match d.review {
            Review::Off => "off",
            Review::On => "on",
            Review::Locked => "locked",
        }
        .into(),
        preview: d.preview,
        preview_ignored: t.preview_ignored,
        template: d.template,
        attributes: d.attributes.into_iter().map(attribute_dto).collect(),
    }
}

fn attribute_dto(a: AttrDef) -> AttributeDto {
    let read_only_reason = match &a.r#type {
        AttrType::File => Some("file"),
        AttrType::Color => Some("color"),
        AttrType::Recurrence => Some("recurrence"),
        AttrType::Other(_) => Some("unsupported"),
        _ => None,
    };
    AttributeDto {
        key: a.key,
        name: a.name,
        type_key: a.r#type.as_str().to_string(),
        supported: a.r#type.editable(),
        read_only_reason: read_only_reason.map(str::to_string),
        default: a.default,
        required: a.required,
        options: a.options.into_iter().map(|o| OptionDto { label: o.label, color: o.color }).collect(),
        to: a.to,
        multiple: a.multiple,
        description: a.description,
        built_in: a.built_in,
    }
}

fn option_def(o: OptionDto) -> OptionDef {
    OptionDef { label: o.label, color: o.color, extra: Vec::new() }
}

fn attr_def(a: AttributeInputDto) -> AttrDef {
    AttrDef {
        key: a.key,
        name: a.name,
        r#type: AttrType::parse(&a.type_key),
        default: a.default.filter(|v| !v.is_null()),
        required: a.required,
        options: a.options.into_iter().map(option_def).collect(),
        to: a.to,
        multiple: a.multiple,
        description: a.description,
        built_in: false,
    }
}

fn type_op(op: TypeOpDto) -> Result<TypeOp, IpcError> {
    Ok(match op {
        TypeOpDto::Set { field, value } => {
            let v = value.unwrap_or_default();
            match field.as_str() {
                "name" => TypeOp::SetName(v),
                "plural" => TypeOp::SetPlural(v),
                "folder" => TypeOp::SetFolder(v),
                "icon" => TypeOp::SetIcon(v),
                "color" => TypeOp::SetColor(v),
                "description" => TypeOp::SetDescription(Some(v).filter(|d| !d.trim().is_empty())),
                other => return Err(err("Io", format!("unknown type field {other}"))),
            }
        }
        TypeOpDto::Review { on } => TypeOp::SetReview(on),
        TypeOpDto::Preview { keys } => TypeOp::SetPreview(keys),
        TypeOpDto::AddAttribute { attribute } => TypeOp::AddAttribute(attr_def(attribute)),
        TypeOpDto::UpdateAttribute { key, change } => TypeOp::UpdateAttribute {
            key,
            change: AttrChange {
                name: change.name,
                r#type: change.type_key.map(|t| AttrType::parse(&t)),
                default: change.default.map(|d| d.filter(|v| !v.is_null())),
                required: change.required,
                options: change.options.map(|o| o.into_iter().map(option_def).collect()),
                to: change.to,
                multiple: change.multiple,
                description: change.description,
            },
        },
        TypeOpDto::RemoveAttribute { key } => TypeOp::RemoveAttribute(key),
        TypeOpDto::MoveAttribute { key, to } => TypeOp::MoveAttribute { key, to: to as usize },
    })
}

fn link_dto(t: LinkTarget) -> LinkTargetDto {
    LinkTargetDto {
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
    }
}

fn starter_dto(p: StarterPlan) -> StarterPlanDto {
    StarterPlanDto {
        add: p.add,
        skip: p
            .skip
            .into_iter()
            .map(|(key, why)| match why {
                StarterSkip::NameExists => StarterSkipDto { key, reason: "nameExists".into(), folder: None },
                StarterSkip::FolderUsed { folder } => StarterSkipDto { key, reason: "folderUsed".into(), folder: Some(folder) },
            })
            .collect(),
        skip_templates: p.skip_templates,
    }
}

/// A `Conflict` of a type write carries the type as on disk now (ms3-shell §14.3).
fn type_err(core: &Core, key: &str, e: CoreError) -> IpcError {
    let conflict = matches!(e, CoreError::Vault(VaultError::Conflict { .. }));
    let mut out = core_err(e);
    if conflict {
        out.disk = core.type_get(key).map(|t| Box::new(type_dto(t)));
    }
    out
}

#[tauri::command]
async fn type_get(state: State<'_, AppState>, key: String) -> Result<Option<TypeDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.type_get(&key).map(type_dto))
}

#[tauri::command]
async fn type_create(state: State<'_, AppState>, name: String, plural: String) -> Result<TypeDto, IpcError> {
    let core = core(&state)?;
    core.type_create(&name, &plural).map(type_dto).map_err(core_err)
}

#[tauri::command]
async fn type_patch(state: State<'_, AppState>, key: String, base: Option<VersionDto>, ops: Vec<TypeOpDto>) -> Result<TypeDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    let ops = ops.into_iter().map(type_op).collect::<Result<Vec<_>, _>>()?;
    core.type_patch(&key, base.as_ref(), &ops).map(type_dto).map_err(|e| type_err(&core, &key, e))
}

#[tauri::command]
async fn type_delete(state: State<'_, AppState>, key: String, base: VersionDto) -> Result<Vec<String>, IpcError> {
    let core = core(&state)?;
    let base = version_from(&base)?;
    core.type_delete(&key, &base).map_err(|e| type_err(&core, &key, e))
}

#[tauri::command]
async fn type_template(state: State<'_, AppState>, key: String) -> Result<Option<TypeTemplateDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.type_template(&key).map_err(core_err)?.map(|(path, bytes)| TypeTemplateDto { path, text: String::from_utf8_lossy(&bytes).into_owned() }))
}

#[tauri::command]
async fn type_usage(state: State<'_, AppState>, r#type: String) -> Result<TypeUsageDto, IpcError> {
    let core = core(&state)?;
    let u = core.type_usage(&r#type);
    Ok(TypeUsageDto {
        objects: u.objects as u32,
        values: u.values.into_iter().map(|(k, n)| (k, n as u32)).collect(),
        options: u.options.into_iter().map(|(k, m)| (k, m.into_iter().map(|(l, n)| (l, n as u32)).collect())).collect(),
    })
}

#[tauri::command]
async fn type_misfits(state: State<'_, AppState>, r#type: String, attr: String, r#as: AttributeInputDto) -> Result<u32, IpcError> {
    let core = core(&state)?;
    Ok(core.count_misfits(&r#type, &attr, &attr_def(r#as)) as u32)
}

#[tauri::command]
async fn index_type_rows(state: State<'_, AppState>, r#type: String) -> Result<Vec<TypeRowDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .type_rows(&r#type)
        .into_iter()
        .map(|r| TypeRowDto {
            path: r.path,
            id: r.id,
            title: r.title,
            created: r.created,
            modified: r.modified,
            values: r.values,
            links: r.links.into_iter().map(link_dto).collect(),
            type_single: r.type_single,
        })
        .collect())
}

#[tauri::command]
async fn starter_plan(state: State<'_, AppState>) -> Result<StarterPlanDto, IpcError> {
    let core = core(&state)?;
    Ok(starter_dto(core.starter_plan()))
}

#[tauri::command]
async fn starter_add(state: State<'_, AppState>) -> Result<StarterPlanDto, IpcError> {
    let core = core(&state)?;
    core.starter_add().map(starter_dto).map_err(core_err)
}

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
            watch_mouse_buttons(handle.clone());
            // The default menu, with Quit replaced by an item that lets the UI save first (FR-EDT-08 AC-7, D-196).
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                let menu = Menu::default(&handle)?;
                if let Some(tauri::menu::MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
                    for item in app_menu.items()? {
                        if let tauri::menu::MenuItemKind::Predefined(p) = &item {
                            if p.text().unwrap_or_default().starts_with("Quit") {
                                app_menu.remove(&item)?;
                            }
                        }
                    }
                    app_menu.append(&PredefinedMenuItem::separator(&handle)?)?;
                    app_menu.append(&MenuItem::with_id(&handle, "tegg-quit", format!("Quit {APP_NAME}"), true, Some("CmdOrCtrl+Q"))?)?;
                }
                app.set_menu(menu)?;
                app.on_menu_event(|app, e| {
                    if e.id() == "tegg-quit" {
                        if ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst) {
                            app.exit(0);
                        } else {
                            let _ = app.emit("app:quit-requested", ());
                        }
                    }
                });
            }
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
            vault_last, vault_recent, app_about, vault_types, index_type_counts, index_list, nav_opened, ui_state_get, ui_state_set,
            link_resolve, open_external, note_write, note_create_exact, note_trash, index_tags, index_conflicts, app_quit, type_get,
            type_create, type_patch, type_delete, type_template, type_usage, type_misfits, index_type_rows, starter_plan, starter_add
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tegg")
        .run(|app, event| {
            // ⌘Q, the Quit Apple Event and closing the window first let the UI flush the open note (FR-EDT-08 AC-7):
            // the UI answers with `app_quit` when the note is saved or the user chose to quit anyway (D-196).
            let allowed = ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst);
            match event {
                tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() && !allowed => {
                    api.prevent_exit();
                    let _ = app.emit("app:quit-requested", ());
                }
                tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if !allowed => {
                    api.prevent_close();
                    let _ = app.emit("app:quit-requested", ());
                }
                _ => {}
            }
        });
}
