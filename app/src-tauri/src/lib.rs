//! Tegg desktop shell (architecture §3.3): the main window, IPC commands mapped onto `tegg-core`, core events
//! forwarded to the UI. Thin by design: validate, call the core, map errors. Nothing here reads or writes vault
//! files; the perf log and the UI state are machine-local (docs/contracts/ms2-shell.md §1, ms3-shell.md §1, §2).

mod dto;
mod shell5b;
mod shell6a;
mod strings;

pub use shell5b::{acl_probe, AclProbe};
pub use shell6a::{media_scheme_probe, MediaResponse};
mod shell4d;
mod shell4e;
mod shellg1;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};
use tegg_core::{
    AppDirs, ConflictKind, Core, CoreError, CoreEvent, CoreOptions, DateRange, FileVersion, LinkKind, LinkTarget, MatchField, ProgressState, QueryTier,
    SearchQuery, StarterPlan, StarterSkip, SwitcherKind, TypeInfo, Vault, VaultError, WriteOutcome,
};
use tegg_schema::{AttrChange, AttrDef, AttrType, Field, OptionDef, RuleError, SchemaError, TypeOp};
use tegg_vault::{CreateError, OpenError, VaultKind};

use dto::*;

pub(crate) struct AppState {
    pub(crate) dirs: AppDirs,
    pub(crate) core: Mutex<Option<Arc<Core>>>,
    pub(crate) vault: Mutex<Option<VaultInfo>>,
}

/// The test environment (contract §1): honoured only with `TEGG_TEST=1`.
pub(crate) fn test_var(name: &str) -> Option<String> {
    if std::env::var("TEGG_TEST").as_deref() != Ok("1") {
        return None;
    }
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

/// The app name: window title and Application Support folder (D-118: the preview keeps its own data).
pub(crate) const APP_NAME: &str = if cfg!(feature = "preview") { "Tegg Preview" } else { "Tegg" };
/// The bundle identifier (tauri.conf.json, tauri.preview.conf.json): single instance is per bundle (D-71, D-549).
pub(crate) const BUNDLE_ID: &str = if cfg!(feature = "preview") { "app.tegg.preview" } else { "app.tegg.desktop" };

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

/// Bumped each time a vault opens: the capture window's vault token (ms5-capture §2.2, FR-CAP-01 AC-11).
pub(crate) static VAULT_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Set once the UI has saved (or the user chose to quit anyway): only then may the app exit (FR-EDT-08 AC-7, D-196).
static ALLOW_EXIT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A native event the navigation monitor sees (FR-NAV-03).
#[derive(Clone, Copy, Debug)]
pub(crate) enum NavInput {
    /// `OtherMouseUp` with AppKit's button number (3 = back, 4 = forward).
    OtherMouseUp(isize),
    /// A navigation swipe (`NSEventTypeSwipe`) with its `deltaX`.
    Swipe(f64),
}

/// The `nav:mouse` direction for a native event, if any.
pub(crate) fn nav_of(input: NavInput) -> Option<&'static str> {
    match input {
        NavInput::OtherMouseUp(3) => Some("back"),
        NavInput::OtherMouseUp(4) => Some("forward"),
        // AppKit: deltaX > 0 is a swipe to the left of the content, which browsers treat as Back.
        NavInput::Swipe(dx) if dx > 0.0 => Some("back"),
        NavInput::Swipe(dx) if dx < 0.0 => Some("forward"),
        _ => None,
    }
}

/// The mouse's back and forward buttons (FR-NAV-03, D-165): WKWebView doesn't pass them to the page, so a local
/// event monitor turns them into `nav:mouse` events (`back` / `forward`) for the UI. Mouse utilities such as Logi
/// Options+ send them as the system's navigation swipe instead (5B feedback F1), which the monitor also maps.
#[cfg(target_os = "macos")]
fn watch_mouse_buttons(app: AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    use std::ptr::NonNull;
    let block = RcBlock::new(move |e: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a valid event for the duration of the handler.
        let ev = unsafe { e.as_ref() };
        let input = if ev.r#type() == NSEventType::Swipe { NavInput::Swipe(ev.deltaX()) } else { NavInput::OtherMouseUp(ev.buttonNumber()) };
        if let Some(dir) = nav_of(input) {
            let _ = app.emit_to("main", "nav:mouse", dir);
        }
        e.as_ptr()
    });
    // SAFETY: called on the main thread during setup; the monitor lives as long as the app.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::OtherMouseUp | NSEventMask::Swipe, &block) };
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
    if name == "note-ready" {
        test_drop(app);
        if test_var("TEGG_TEST_FOCUS_TITLE").is_some() {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = app.emit("tegg://test-focus-title", ());
            });
        }
    }
    if name.starts_with("route-ready:type-settings/") && test_var("TEGG_TEST_FOCUS_FOLDER").is_some() {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = app.emit("tegg://test-focus-folder", ());
        });
    }
    if test_var("TEGG_EXIT_AFTER").as_deref() == Some(name) {
        app.exit(0);
    }
}

/// The test hook `TEGG_TEST_DROP=<path>:<path>…@<x>,<y>` (ms6-trash-media test table, FR-ATT-01 AC-2, D-751; a real Finder drag isn't
/// automatable): once the first note is ready, the window gets the drag-drop event a Finder drop sends.
fn test_drop(app: &AppHandle) {
    let Some(spec) = test_var("TEGG_TEST_DROP") else { return };
    let Some((paths, at)) = spec.rsplit_once('@') else { return };
    let Some((x, y)) = at.split_once(',') else { return };
    let (Ok(x), Ok(y)) = (x.trim().parse::<f64>(), y.trim().parse::<f64>()) else { return };
    let paths: Vec<String> = paths.split(':').filter(|p| !p.is_empty()).map(String::from).collect();
    let app = app.clone();
    // The editor's listener is registered asynchronously after its first paint, so the drop comes a moment later.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let _ = app.emit("tauri://drag-drop", serde_json::json!({ "paths": paths, "position": { "x": x, "y": y } }));
    });
}

// ---------------------------------------------------------------- vault and events

pub(crate) fn err(kind: &str, message: impl ToString) -> IpcError {
    IpcError { kind: kind.into(), message: message.to_string(), conflict: None, reason: None, field: None, key: None, label: None, count: None, disk: None, path: None, now: None, error: None, char: None, name: None }
}

pub(crate) fn version_dto(v: &FileVersion) -> VersionDto {
    VersionDto { mtime_ns: v.mtime_ns.to_string(), size: v.size, hash: v.hash.iter().map(|b| format!("{b:02x}")).collect() }
}

pub(crate) fn version_from(d: &VersionDto) -> Result<FileVersion, IpcError> {
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

pub(crate) fn core_err(e: CoreError) -> IpcError {
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
        CoreError::Exists { path } => IpcError { path: Some(path), ..err("Exists", "the note exists now") },
        CoreError::PlanChanged { now } => IpcError { now: Some(Box::new(plan_dto(now))), ..err("PlanChanged", "the plan changed") },
        // ms4-daily §3 (4B).
        CoreError::UseDailyNote => err("UseDailyNote", "a Daily Note is created by typing in it"),
        CoreError::DailyMismatch => err("DailyMismatch", "the bytes aren't this date's Daily Note"),
        // ms5-tasks §11.6 (5A-2).
        CoreError::Protected => err("Protected", "only notes can be discarded"),
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
        RuleError::ColumnsUnreadable => ("columnsUnreadable", None, None, None),
        RuleError::NeedOpen => ("needOpen", Some("optionLabel".into()), None, None),
        RuleError::NeedDone => ("needDone", Some("optionLabel".into()), None, None),
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
        page_width: Some(core.vault_settings().page_width),
        interrupted: {
            let i: Vec<InterruptedDto> = core
                .jobs()
                .interrupted()
                .into_iter()
                .map(|i| InterruptedDto { job_id: i.job as u32, kind: i.kind, title: i.title, from: i.from, to: i.to, done: i.done as u32, total: i.total as u32 })
                .collect();
            (!i.is_empty()).then_some(i)
        },
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
    VAULT_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let _ = app.emit_to(shell5b::CAPTURE, "capture:context-changed", ());
    shell5b::inbox_count_changed(app);
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
                    let _ = app.emit_to("main", "index:progress", ProgressDto { done: done as u32, total: total as u32, state: s.into() });
                    if state == ProgressState::Done {
                        mark(&app, "index-ready");
                    }
                }
                CoreEvent::VaultChanged { paths } => {
                    // The capture window gets no paths (NFR-SEC-03): only a hint to re-read its context (§2.2).
                    shell5b::context_maybe_changed(&app, &paths);
                    if paths.iter().any(|p| p == ".trash" || p.starts_with(".trash/")) {
                        shell6a::trash_changed(&app);
                    }
                    let _ = app.emit_to("main", "vault:changed", ChangedDto { paths });
                    shell5b::inbox_count_changed(&app);
                }
                CoreEvent::NoteConflict { path, mine, theirs, disk } => {
                    let c = ConflictDto {
                        path,
                        mine: String::from_utf8_lossy(&mine).into_owned(),
                        theirs: String::from_utf8_lossy(&theirs).into_owned(),
                        theirs_version: version_dto(&disk),
                    };
                    let _ = app.emit_to("main", "note:conflict", c);
                }
                CoreEvent::Placeholders { .. } => {}
                // ms4-jobs §4 (4C).
                CoreEvent::JobProgress(p) => {
                    let _ = app.emit_to("main", "job:progress", progress_dto(&p));
                }
                CoreEvent::JobTransform { request, source, text, ops, live } => {
                    let ops: Vec<serde_json::Value> = ops.iter().map(tegg_core::tegg_jobs::op_json).collect();
                    let _ = app.emit_to("main", "job:transform", serde_json::json!({ "requestId": request, "source": source, "text": text, "ops": ops, "live": live }));
                }
            }
        }
    });
}

pub(crate) fn core(state: &State<AppState>) -> Result<Arc<Core>, IpcError> {
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

fn snippet_dto(s: tegg_core::Snippet) -> SnippetDto {
    SnippetDto { highlights: s.highlights.iter().map(|&(a, b)| (utf16(&s.text, a), utf16(&s.text, b))).collect(), line: s.line as u32, text: s.text }
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
                    MatchField::FileName => "fileName",
                    MatchField::Alias => "alias",
                    MatchField::Attribute => "attribute",
                    MatchField::Body => "body",
                }
                .into(),
                tier: match r.tier {
                    QueryTier::Phrase => "phrase",
                    QueryTier::AllWords => "allWords",
                    QueryTier::AnyWord => "anyWord",
                }
                .into(),
                typo: r.typo,
                snippet: r.snippet.map(snippet_dto),
                file_name: r.file_name.map(snippet_dto),
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
            duplicate: i.duplicate.map(duplicate_dto),
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

/// ms5-tasks §11.6 (D-492): delete a just-created file after a version check (conversion undo).
#[tauri::command]
async fn note_discard(state: State<'_, AppState>, path: String, base: VersionDto) -> Result<(), IpcError> {
    let core = core(&state)?;
    core.discard_note(&path, &version_from(&base)?).map_err(core_err)
}

/// D-185, ms4-tags §1.2.
#[tauri::command]
async fn index_tags(state: State<'_, AppState>) -> Result<Vec<TagRowDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.tag_rows().into_iter().map(shell4d::tag_row_dto).collect())
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
    let path = core.create_object(&r#type, &title, text.as_bytes()).map_err(core_err)?;
    if test_var("TEGG_TEST_HOLD").as_deref() == Some("after-create") {
        hold("after-create"); // FR-CNV-03 AC-7: the new file is written and indexed, the source not yet saved
    }
    Ok(path)
}

/// ms5-tasks §11.6 (test build only): marks `hold:<point>` and blocks this thread forever, so the L6 test can kill
/// the app at that point (FR-CNV-03 AC-7).
fn hold(point: &str) {
    mark_repeat(&format!("hold:{point}"));
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
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
async fn nav_opened(state: State<'_, AppState>, path: Option<String>, route: Option<String>) -> Result<(), IpcError> {
    let core = core(&state)?;
    // D-349: a daily route is recorded by its route (virtual or not), so the launch landing can reopen it.
    if let Some(p) = &path {
        core.record_open(p, SystemTime::now());
    }
    if let Some(r) = route.filter(|r| r.starts_with("daily/")) {
        core.record_open(&r, SystemTime::now());
    }
    Ok(())
}

/// `link_resolve` (ms3-shell §11.1): all targets of one note in one call (NFR-PERF-05 AC-3).
#[tauri::command]
async fn link_resolve(state: State<'_, AppState>, from: String, targets: Vec<String>) -> Result<Vec<LinkTargetDto>, IpcError> {
    let core = core(&state)?;
    // D-601: with the chip fields (review, task status, due, completed).
    Ok(core
        .resolve_links_with_fields(&from, &targets)
        .into_iter()
        .map(|(t, f)| LinkTargetDto { review: f.review, status: f.status, due: f.due, completed: f.completed, object: f.object, ..link_dto(t) })
        .collect())
}

/// `index_path_by_id` (v1-previews §2, D-935): a previewed object's path after a rename, by its `id`.
#[tauri::command]
async fn index_path_by_id(state: State<'_, AppState>, id: String) -> Result<Option<String>, IpcError> {
    let core = core(&state)?;
    Ok(core.path_by_id(&id))
}

/// `embed_load` (ms4-embeds §4, D-429): one call per nesting level; read-only, records no recency.
#[tauri::command]
async fn embed_load(state: State<'_, AppState>, paths: Vec<String>, media: Option<bool>) -> Result<Vec<EmbedNoteDto>, IpcError> {
    let core = core(&state)?;
    // Slice P (v1-previews §2): `media: true` also resolves the files the notes embed (a preview's images).
    Ok(core
        .embed_load_with(&paths, media.unwrap_or(false))
        .into_iter()
        .map(|n| EmbedNoteDto {
            path: n.path,
            state: match n.state {
                tegg_core::EmbedLoadState::Ok => "ok",
                tegg_core::EmbedLoadState::Missing => "missing",
                tegg_core::EmbedLoadState::Io => "io",
                tegg_core::EmbedLoadState::Trashed => "trashed", // ms6-trash-media §2 (6A)
            }
            .into(),
            text: n.text,
            version: n.version.as_ref().map(version_dto),
            utf8: n.utf8,
            links: n.links.into_iter().map(link_dto).collect(),
        })
        .collect())
}

// ---------------------------------------------------------------- MS4 slice 4A (ms4-links §4)

fn mark_name(m: &tegg_core::Mark) -> String {
    use tegg_core::Mark::*;
    match m {
        Strong => "strong",
        Em => "em",
        Code => "code",
        Strike => "strike",
        Highlight => "highlight",
    }
    .into()
}

fn target_info_dto(t: tegg_core::LinkTargetInfo) -> LinkTargetDto {
    use tegg_core::TargetKind::*;
    let kind = match t.kind {
        Note => "note",
        Daily => "daily",
        DateMissing => "date-missing",
        Unresolved => "unresolved",
    };
    LinkTargetDto { target: t.target, kind: kind.into(), path: t.path, title: t.title, type_key: t.r#type, review: None, status: None, due: None, completed: None, object: None }
}

fn excerpt_dto(e: tegg_core::Excerpt) -> ExcerptDto {
    ExcerptDto {
        segments: e
            .segments
            .into_iter()
            .map(|g| match g {
                tegg_core::RSeg::Text { text, marks } => ExcerptSegDto::Text { text, marks: marks.iter().map(mark_name).collect() },
                tegg_core::RSeg::Link { text, target, here, marks } => {
                    ExcerptSegDto::Link { text, target: target_info_dto(target), here, marks: marks.iter().map(mark_name).collect() }
                }
            })
            .collect(),
        cut_start: e.cut_start,
        cut_end: e.cut_end,
    }
}

fn entry_dto(e: tegg_core::BacklinkEntry) -> BacklinkEntryDto {
    use tegg_core::OccurrenceKind::*;
    BacklinkEntryDto {
        source: e.source,
        title: e.title,
        type_key: e.type_key,
        modified: e.modified,
        read_only: e.read_only,
        occurrences: e
            .occurrences
            .into_iter()
            .map(|o| OccurrenceDto {
                kind: match o.kind {
                    Body => "body",
                    Attribute => "attribute",
                    Embed => "embed",
                }
                .into(),
                attribute: o.attribute,
                attribute_name: o.attribute_name,
                at: AtDto { line: o.at.line, byte: o.at.byte },
                excerpt: excerpt_dto(o.excerpt),
            })
            .collect(),
        review: e.review,
        status: e.status,
        due: e.due,
        completed: e.completed,
    }
}

fn plan_dto(p: tegg_core::LinkCreatePlan) -> LinkCreatePlanDto {
    use tegg_core::LinkCreatePlan::*;
    match p {
        Create { path, title, type_key, rewrite } => LinkCreatePlanDto::Create { path, title, type_key, rewrite },
        Exists { path } => LinkCreatePlanDto::Exists { path },
        Forbidden { reason: tegg_core::CreateRefusal::Folder } => LinkCreatePlanDto::Forbidden { reason: "folder".into() },
        Forbidden { reason: tegg_core::CreateRefusal::NeedsEdit } => LinkCreatePlanDto::Forbidden { reason: "needsEdit".into() },
    }
}

fn plan_from(p: LinkCreatePlanDto) -> tegg_core::LinkCreatePlan {
    match p {
        LinkCreatePlanDto::Create { path, title, type_key, rewrite } => tegg_core::LinkCreatePlan::Create { path, title, type_key, rewrite },
        LinkCreatePlanDto::Exists { path } => tegg_core::LinkCreatePlan::Exists { path },
        LinkCreatePlanDto::Forbidden { reason } => tegg_core::LinkCreatePlan::Forbidden {
            reason: if reason == "needsEdit" { tegg_core::CreateRefusal::NeedsEdit } else { tegg_core::CreateRefusal::Folder },
        },
    }
}

fn duplicate_dto(d: tegg_core::DuplicateDetails) -> DuplicateDetailsDto {
    DuplicateDetailsDto { created: d.created, preview: d.preview, stem: d.stem }
}

/// `index_backlinks` (FR-LNK-01, -02): one query per opened note, from the index.
#[tauri::command]
async fn index_backlinks(state: State<'_, AppState>, path: String) -> Result<BacklinksPanelDto, IpcError> {
    let core = core(&state)?;
    Ok(panel_dto(core.backlinks_panel(&path)))
}

fn panel_dto(p: tegg_core::BacklinksPanel) -> BacklinksPanelDto {
    BacklinksPanelDto {
        objects: p.objects as u32,
        groups: p
            .groups
            .into_iter()
            .map(|g| BacklinkGroupDto { type_key: g.type_key, defined: g.defined, raw: g.raw, entries: g.entries.into_iter().map(entry_dto).collect() })
            .collect(),
    }
}

/// `index_broken_links` (FR-LNK-04, D-284).
#[tauri::command]
async fn index_broken_links(state: State<'_, AppState>) -> Result<BrokenLinksDto, IpcError> {
    let core = core(&state)?;
    let b = core.broken_links();
    Ok(BrokenLinksDto {
        occurrences: b.occurrences as u32,
        objects: b.objects as u32,
        groups: b
            .groups
            .into_iter()
            .map(|g| BrokenGroupDto { key: g.key, label: g.label, count: g.count as u32, create: plan_dto(g.create), sources: g.sources.into_iter().map(entry_dto).collect() })
            .collect(),
    })
}

/// `index_duplicate_titles` (FR-LNK-14, D-284, D-290).
#[tauri::command]
async fn index_duplicate_titles(state: State<'_, AppState>) -> Result<Vec<DuplicateGroupDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .duplicate_titles()
        .into_iter()
        .map(|g| DuplicateGroupDto {
            key: g.key,
            label: g.label,
            objects: g
                .objects
                .into_iter()
                .map(|o| DuplicateObjectDto { path: o.path, title: o.title, type_key: o.type_key, folder: o.folder, details: duplicate_dto(o.details), backlinks: o.backlinks as u32 })
                .collect(),
        })
        .collect())
}

// ---------------------------------------------------------------- slice 4B (ms4-daily §4)

fn parse_day(date: &str) -> Result<chrono::NaiveDate, IpcError> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| err("Io", format!("not a date: {date}")))
}
fn context_rows(rows: Vec<tegg_core::ContextRow>) -> Vec<ContextRowDto> {
    rows.into_iter().map(|r| ContextRowDto { path: r.path, title: r.title, type_key: r.r#type, at: r.at }).collect()
}

/// `daily_view` (FR-DLY-01, D-318, D-319): read-only.
#[tauri::command]
async fn daily_view(state: State<'_, AppState>, date: String) -> Result<DailyViewDto, IpcError> {
    let core = core(&state)?;
    let v = core.daily_view(parse_day(&date)?);
    Ok(DailyViewDto { date: v.date.format("%Y-%m-%d").to_string(), path: v.path, duplicates: v.duplicates, review: v.review })
}

/// `daily_dates` (FR-DLY-03 AC-3): read-only calendar marks.
#[tauri::command]
async fn daily_dates(state: State<'_, AppState>, year: i32, month: u32) -> Result<Vec<String>, IpcError> {
    let core = core(&state)?;
    Ok(core.daily_dates(year, month).into_iter().map(|d| d.format("%Y-%m-%d").to_string()).collect())
}

/// `daily_backlinks` (D-348, FR-DLY-08 AC-7): read-only; the panel of a date, virtual or not.
#[tauri::command]
async fn daily_backlinks(state: State<'_, AppState>, date: String) -> Result<BacklinksPanelDto, IpcError> {
    let core = core(&state)?;
    Ok(panel_dto(core.daily_backlinks(parse_day(&date)?)))
}

/// `daily_draft` (FR-DLY-02, FR-DLY-06): read-only.
#[tauri::command]
async fn daily_draft(state: State<'_, AppState>, date: String) -> Result<DailyDraftDto, IpcError> {
    let core = core(&state)?;
    let d = core.daily_draft(parse_day(&date)?).map_err(core_err)?;
    Ok(DailyDraftDto { text: d.text, body: d.body, template_invalid: d.template_invalid, path: d.path, format_fallback: d.format_fallback })
}

/// `daily_create` (FR-DLY-02 AC-2): the one write of a first keystroke.
#[tauri::command]
async fn daily_create(state: State<'_, AppState>, date: String, text: String) -> Result<DailyCreatedDto, IpcError> {
    let core = core(&state)?;
    let c = core.daily_create(parse_day(&date)?, text.as_bytes()).map_err(core_err)?;
    Ok(DailyCreatedDto { path: c.path, version: version_dto(&c.version), duplicates: c.duplicates })
}

/// `daily_context` (FR-DLY-04, D-271, D-328): read-only; `start` / `end` RFC 3339 with offset.
#[tauri::command]
async fn daily_context(state: State<'_, AppState>, date: String, start: String, end: String, limit: u32) -> Result<DailyContextDto, IpcError> {
    let core = core(&state)?;
    let t = |s: &str| chrono::DateTime::parse_from_rfc3339(s).map_err(|_| err("Io", format!("not an instant: {s}")));
    let w = tegg_core::DayWindow { date: parse_day(&date)?, start: t(&start)?, end: t(&end)? };
    let p = core.daily_context(&w, limit as usize);
    Ok(DailyContextDto {
        quick_notes: context_rows(p.sections.quick_notes),
        created: context_rows(p.sections.created),
        modified: context_rows(p.sections.modified),
        totals: [p.totals[0] as u32, p.totals[1] as u32, p.totals[2] as u32],
    })
}

// ---------------------------------------------------------------- slice 5A-1 (ms5-tasks §3)

/// `task_list` (R44): read-only, one call for the rows and the Task type's options.
#[tauri::command]
async fn task_list(state: State<'_, AppState>) -> Result<TaskListDto, IpcError> {
    let core = core(&state)?;
    let d = core.task_defs();
    let defs = TaskDefsDto {
        statuses: d.statuses.into_iter().map(|s| StatusOptionDto { label: s.label, color: s.color, state: task_state(s.state), state_raw: s.state_raw }).collect(),
        priorities: d.priorities.into_iter().map(option_dto).collect(),
        unknown_states: d.unknown_states.into_iter().map(|(label, state)| UnknownStateDto { label, state }).collect(),
    };
    Ok(TaskListDto { tasks: core.tasks().into_iter().map(task_dto).collect(), defs })
}

/// `daily_tasks` (FR-DLY-04 AC-9, D-485): read-only.
#[tauri::command]
async fn daily_tasks(state: State<'_, AppState>, date: String, start: String, end: String, today: String, limit: u32) -> Result<DailyTasksDto, IpcError> {
    let core = core(&state)?;
    let t = |s: &str| chrono::DateTime::parse_from_rfc3339(s).map_err(|_| err("Io", format!("not an instant: {s}")));
    let w = tegg_core::DayWindow { date: parse_day(&date)?, start: t(&start)?, end: t(&end)? };
    let d = core.daily_tasks(&w, parse_day(&today)?, limit as usize);
    let rows = |v: Vec<tegg_core::TaskRow>| v.into_iter().map(task_dto).collect();
    Ok(DailyTasksDto { overdue: rows(d.overdue), due: rows(d.due), completed: rows(d.completed), total: d.total as u32 })
}

// ---------------------------------------------------------------- slice 4C (ms4-jobs §4)

use tegg_core::tegg_jobs::{JobError, JobOp, JobProgress, JobReport, ResolveChoice, RetryOutcome, TransformError, Transformed};

pub(crate) fn job_err(e: JobError) -> IpcError {
    match e {
        JobError::NotRenamable => err("NotRenamable", "this note can't be renamed"),
        JobError::Busy => err("Busy", "another job is running"),
        JobError::NotCancellable => err("NotCancellable", "the job can't be cancelled now"),
        JobError::NotFound => err("NotFound", "no such job"),
        JobError::NotImplemented => err("NotImplemented", "not available"),
        JobError::BackupFailed(m) => err("BackupFailed", m),
        JobError::InvalidName { error, char } => IpcError { error: Some(error.clone()), char, ..err("InvalidName", error) },
        JobError::TagExists { name } => IpcError { name: Some(name.clone()), ..err("TagExists", format!("#{name} already exists")) },
        JobError::NothingToDo => err("NothingToDo", "nothing to do"),
        // ms4-jobs §14.2 (4E-1).
        JobError::NotMovable => err("NotMovable", "this note can't be moved"),
        JobError::UnknownType => err("UnknownType", "no such type"),
        JobError::NoChange => err("NoChange", "the note already has this type"),
        // ms4-jobs §14.9.1 (4E-2).
        JobError::SystemType => err("SystemType", "system types can't be changed this way"),
        JobError::BuiltIn => err("BuiltIn", "built-in properties can't be removed"),
        JobError::UnknownProperty => err("UnknownProperty", "no such property"),
        JobError::Core(m) => err("Io", m),
    }
}

fn progress_dto(p: &JobProgress) -> JobProgressDto {
    JobProgressDto {
        job_id: p.job as u32,
        kind: p.kind.as_str().into(),
        phase: p.phase.as_str().into(),
        done: p.done as u32,
        total: p.total as u32,
        counts: p.counts.map(|c| JobCountsDto { written: c.written as u32, unchanged: c.unchanged as u32, skipped: c.skipped as u32 }),
    }
}

fn report_dto(r: &JobReport) -> JobReportDto {
    JobReportDto {
        job_id: r.job as u32,
        kind: r.kind.as_str().into(),
        phase: r.phase.as_str().into(),
        renamed: r.renamed.as_ref().map(|(from, to)| RenamedDto { from: from.clone(), to: to.clone() }),
        written: r.written.clone(),
        unchanged: r.unchanged.clone(),
        skipped: r.skipped.iter().map(|s| SkippedDto { path: s.path.clone(), reason: s.reason.as_str().into() }).collect(),
        error: r.error.clone(),
        moved: r.moved.iter().map(|(from, to)| RenamedDto { from: from.clone(), to: to.clone() }).collect(),
        kept_type: r.kept_type,
    }
}

/// `note_rename` (FR-FMT-08, FR-LNK-03, D-268): starts a `note-rename` job; `toPath` is the planned path.
#[tauri::command]
async fn note_rename(state: State<'_, AppState>, path: String, title: String, from_title: String) -> Result<NoteRenameDto, IpcError> {
    let core = core(&state)?;
    let job = core.jobs().start_note_rename(&path, &title, &from_title).map_err(job_err)?;
    // The plan is made on the job thread at once (one job at a time, D-393); wait for it briefly for `toPath`.
    let t0 = std::time::Instant::now();
    let mut to = path.clone();
    while t0.elapsed() < Duration::from_secs(2) {
        if let Some(p) = core.jobs().plan(job) {
            to = p.renames.first().map(|(_, t)| t.clone()).unwrap_or(path.clone());
            break;
        }
        if core.jobs().report(job).is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Ok(NoteRenameDto { job_id: job as u32, to_path: to })
}

#[tauri::command]
async fn job_cancel(state: State<'_, AppState>, job_id: u32) -> Result<(), IpcError> {
    core(&state)?.jobs().cancel(job_id as u64).map_err(job_err)
}

#[tauri::command]
async fn job_confirm(state: State<'_, AppState>, job_id: u32) -> Result<(), IpcError> {
    core(&state)?.jobs().confirm(job_id as u64).map_err(job_err)
}

#[tauri::command]
async fn job_report(state: State<'_, AppState>, job_id: u32) -> Result<Option<JobReportDto>, IpcError> {
    Ok(core(&state)?.jobs().report(job_id as u64).as_ref().map(report_dto))
}

#[tauri::command]
async fn job_retry(state: State<'_, AppState>, job_id: u32, path: String) -> Result<RetryDto, IpcError> {
    Ok(match core(&state)?.jobs().retry(job_id as u64, &path).map_err(job_err)? {
        RetryOutcome::Written => RetryDto { outcome: "written".into(), reason: None },
        RetryOutcome::Unchanged => RetryDto { outcome: "unchanged".into(), reason: None },
        RetryOutcome::Skipped(r) => RetryDto { outcome: "skipped".into(), reason: Some(r.as_str().into()) },
    })
}

#[tauri::command]
async fn job_undo(state: State<'_, AppState>, job_id: u32) -> Result<JobIdDto, IpcError> {
    let id = core(&state)?.jobs().start(JobOp::Undo { job: job_id as u64 }).map_err(job_err)?;
    Ok(JobIdDto { job_id: id as u32 })
}

#[tauri::command]
async fn job_redo(state: State<'_, AppState>, job_id: u32) -> Result<JobIdDto, IpcError> {
    let id = core(&state)?.jobs().start(JobOp::Redo { job: job_id as u64 }).map_err(job_err)?;
    Ok(JobIdDto { job_id: id as u32 })
}

/// The UI's worker answers a `job:transform` (ms4-jobs §2.2).
#[tauri::command]
async fn job_transform_result(state: State<'_, AppState>, request_id: u32, result: TransformedDto) -> Result<(), IpcError> {
    let r = match (result.error, result.kind.as_deref()) {
        (Some(e), _) => Err(TransformError::Engine(e)),
        (None, Some("unchanged")) => Ok(Transformed::Unchanged),
        (None, Some("bytes")) => Ok(Transformed::Bytes(
            result.text.unwrap_or_default().into_bytes(),
            result.edits.unwrap_or_default().into_iter().map(|e| tegg_core::tegg_jobs::Edit { start: e.start as usize, end: e.end as usize }).collect(),
        )),
        _ => Err(TransformError::Engine("unknown answer".into())),
    };
    core(&state)?.jobs().transform_result(request_id as u64, r);
    Ok(())
}

#[tauri::command]
async fn job_interrupted(state: State<'_, AppState>) -> Result<Vec<InterruptedDto>, IpcError> {
    Ok(core(&state)?
        .jobs()
        .interrupted()
        .into_iter()
        .map(|i| InterruptedDto { job_id: i.job as u32, kind: i.kind, title: i.title, from: i.from, to: i.to, done: i.done as u32, total: i.total as u32 })
        .collect())
}

#[tauri::command]
async fn job_resolve_interrupted(state: State<'_, AppState>, job_id: u32, choice: String) -> Result<JobIdDto, IpcError> {
    let c = if choice == "undo" { ResolveChoice::Undo } else { ResolveChoice::Finish };
    let id = core(&state)?.jobs().resolve_interrupted(job_id as u64, c).map_err(job_err)?;
    Ok(JobIdDto { job_id: id as u32 })
}

/// Settings › Backups ships with 4D-lite (D-396); 4C makes no zip for a note rename (D-269).
#[tauri::command]
async fn backups_list(state: State<'_, AppState>) -> Result<Vec<BackupDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .backups()
        .into_iter()
        .map(|b| BackupDto { name: b.name, kind: b.kind, time: b.time, label: BackupLabelDto { key: b.label.key, args: b.label.args }, files: b.files as u32 })
        .collect())
}

#[tauri::command]
async fn backup_restore(state: State<'_, AppState>, name: String) -> Result<JobIdDto, IpcError> {
    let core = core(&state)?;
    let id = core.jobs().start(JobOp::Restore { name }).map_err(job_err)?;
    Ok(JobIdDto { job_id: id as u32 })
}

/// ms4-jobs §9 (D-386): the UI opened / closed `path` in an editor.
#[tauri::command]
async fn editor_open(state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    core(&state)?.jobs().editor_open(&path);
    Ok(())
}

#[tauri::command]
async fn editor_close(state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    core(&state)?.jobs().editor_close(&path);
    Ok(())
}

/// `link_create_plan` (FR-LNK-04, D-286…D-288): read-only, when the Create offer opens.
#[tauri::command]
async fn link_create_plan(state: State<'_, AppState>, from: String, target: String, relation_to: Option<Vec<String>>) -> Result<LinkCreatePlanDto, IpcError> {
    let core = core(&state)?;
    Ok(plan_dto(core.link_create_plan(&from, &target, relation_to.as_deref())))
}

/// `link_create` (FR-LNK-04 AC-5, AC-11): the one write of the Create offer; re-plans first.
#[tauri::command]
async fn link_create(state: State<'_, AppState>, from: String, target: String, expect: LinkCreatePlanDto, text: String, as_type: Option<String>) -> Result<LinkCreatedDto, IpcError> {
    let core = core(&state)?;
    // `asType`: the type picked in the offer's `Type` control (FR-VLT-05 AC-3, D-550).
    let made = core.link_create_as(&from, &target, &plan_from(expect), text.as_bytes(), as_type.as_deref()).map_err(core_err)?;
    Ok(LinkCreatedDto { path: made.path, rewrite: made.rewrite })
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
        hidden: d.hidden,
        columns: d.columns,
        columns_ignored: t.columns_ignored,
        columns_unreadable: t.columns_unreadable,
        embed: t.embed.as_str().into(),
        embed_raw: t.embed_raw,
        template: d.template,
        attributes: d.attributes.into_iter().map(attribute_dto).collect(),
    }
}

pub(crate) fn attribute_dto(a: AttrDef) -> AttributeDto {
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
        options: a.options.into_iter().map(option_dto).collect(),
        to: a.to,
        multiple: a.multiple,
        description: a.description,
        built_in: a.built_in,
    }
}

/// D-511: a status option's `state` travels both ways, so an options edit from the UI never drops it.
fn option_dto(o: OptionDef) -> OptionDto {
    let state = tegg_schema::option_state(&o).map(str::to_string);
    OptionDto { label: o.label, color: o.color, state }
}

fn option_def(o: OptionDto) -> OptionDef {
    let extra = o.state.filter(|s| !s.trim().is_empty()).map(|s| vec![("state".to_string(), serde_json::Value::String(s))]).unwrap_or_default();
    OptionDef { label: o.label, color: o.color, extra }
}

fn task_state(s: tegg_core::TaskState) -> String {
    s.as_str().to_string()
}

fn task_dto(r: tegg_core::TaskRow) -> TaskRowDto {
    TaskRowDto {
        path: r.path,
        id: r.id,
        title: r.title,
        status: r.status,
        state: task_state(r.state),
        status_known: r.status_known,
        priority: r.priority,
        priority_rank: r.priority_rank as u32,
        due_raw: r.due_raw,
        due: r.due.map(|d| d.format("%Y-%m-%d").to_string()),
        completed: r.completed,
        tags: r.tags,
        fm_tags: r.fm_tags,
        source: r.source.map(link_dto),
        excerpt: r.excerpt,
        created: r.created,
        modified: r.modified,
        version: version_dto(&r.version),
        read_only: r.read_only,
    }
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
        TypeOpDto::Columns { keys } => TypeOp::SetColumns(keys),
        TypeOpDto::Hidden { keys } => TypeOp::SetHidden(keys),
        TypeOpDto::Embed { mode } => TypeOp::SetEmbed(match tegg_schema::EmbedMode::parse(&mode) {
            Some(m) => m,
            None => return Err(err("Io", format!("unknown embed mode {mode}"))),
        }),
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
        // ms5-tasks §2.2 (5A-1).
        TypeOpDto::SetOptionState { attr, label, state } => TypeOp::SetOptionState { attr, label, state },
        TypeOpDto::AddOption { attr, option } => TypeOp::AddOption { attr, option: option_def(option) },
        TypeOpDto::SetOptionColor { attr, label, color } => TypeOp::SetOptionColor { attr, label, color },
        TypeOpDto::MoveOption { attr, label, to } => TypeOp::MoveOption { attr, label, to: to as usize },
        TypeOpDto::RemoveOption { attr, label } => TypeOp::RemoveOption { attr, label },
        TypeOpDto::RenameOption { attr, from, to } => TypeOp::RenameOption { attr, from, to },
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
            // ms6-trash-media §2, §3.2 (6A).
            LinkKind::Trashed => "trashed",
            LinkKind::Media => "media",
        }
        .into(),
        path: t.path,
        title: t.title,
        type_key: t.r#type,
        review: None,
        status: None,
        due: None,
        completed: None,
        object: None,
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
async fn type_create(state: State<'_, AppState>, name: String, plural: String, folder: Option<String>) -> Result<TypeDto, IpcError> {
    let core = core(&state)?;
    core.type_create_in(&name, &plural, folder.as_deref()).map(type_dto).map_err(core_err)
}

#[tauri::command]
async fn type_patch(state: State<'_, AppState>, key: String, base: Option<VersionDto>, ops: Vec<TypeOpDto>) -> Result<TypeDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    let ops = ops.into_iter().map(type_op).collect::<Result<Vec<_>, _>>()?;
    // D-805, D-822: a new folder with objects to move is written by the folder-move job, after its zip.
    let (folders, ops): (Vec<_>, Vec<_>) = ops.into_iter().partition(|o| matches!(o, TypeOp::SetFolder(_)));
    // NFR-REL-02: a folder change is checked against the version the page read, as every type-file write (D-235).
    if !folders.is_empty() && ops.is_empty() {
        if let (Some(b), Some(disk)) = (base.as_ref(), core.type_get(&key).and_then(|t| t.version)) {
            if !b.same_content(&disk) {
                return Err(type_err(&core, &key, tegg_core::CoreError::Vault(VaultError::Conflict { disk })));
            }
        }
    }
    let mut t = if ops.is_empty() { core.type_get(&key).ok_or_else(|| err("UnknownType", "no such type"))? } else { core.type_patch(&key, base.as_ref(), &ops).map_err(|e| type_err(&core, &key, e))? };
    for op in folders {
        let TypeOp::SetFolder(f) = &op else { continue };
        if core.folder_move_count(&key, f) > 0 {
            core.jobs().start(tegg_core::tegg_jobs::JobOp::FolderMove { r#type: Some(key.clone()), to_folder: Some(f.clone()) }).map_err(job_err)?;
        } else {
            let base = t.version.clone();
            t = core.type_patch(&key, base.as_ref(), &[op]).map_err(|e| type_err(&core, &key, e))?;
        }
    }
    Ok(type_dto(t))
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

/// D-511 (T2, AP-440): an options edit from the UI keeps each option's `state`, also for a renamed label.
#[cfg(test)]
mod bug_5a_fr_tsk_02_option_state_kept {
    use super::{option_def, option_dto, OptionDef};
    use tegg_schema::{patch, AttrChange, PatchContext, TypeOp};

    #[test]
    fn bug_5a_fr_tsk_02_option_state_kept() {
        let o = OptionDef { label: "Waiting".into(), color: Some("yellow".into()), extra: vec![("state".into(), serde_json::json!("open"))] };
        let back = option_def(option_dto(o.clone()));
        assert_eq!(back, o, "state survives the IPC round trip");
        let text = "version: 1\nname: Projekt\nplural: Projekty\nattributes:\n  - key: faze\n    name: Fáze\n    type: select\n    options:\n      - { label: Nápad, state: open, color: gray }\n      - { label: Hotovo, state: done, color: green }\n";
        let mut dtos: Vec<_> = tegg_schema::parse("projekt", text).def.attributes[0].options.clone().into_iter().map(option_dto).collect();
        dtos[0].label = "Myšlenka".into(); // a rename: the old label's extra can't be found by label
        let change = AttrChange { options: Some(dtos.into_iter().map(option_def).collect()), ..Default::default() };
        let out = patch("projekt", text, &[TypeOp::UpdateAttribute { key: "faze".into(), change }], &PatchContext { others: &[] });
        let out = out.expect("patch").expect("a change");
        assert!(out.contains("- { label: Myšlenka, state: open, color: gray }"), "the renamed option keeps its state:\n{out}");
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
fn ui_state_set(app: AppHandle, app_state: State<AppState>, state: UiStateDto) -> Result<(), IpcError> {
    let bytes = serde_json::to_vec_pretty(&state).map_err(|e| err("Io", e))?;
    tegg_vault::write_local_file(&app_state.dirs.root.join(UI_STATE_FILE), &bytes).map_err(|e| err("Io", e))?;
    // ms5-capture §4 (FR-CAP-01 AC-14): the pre-warmed capture windows re-apply the theme and the date format; they get
    // these two choices only, never the rest of the state.
    let ui = serde_json::json!({ "theme": state.theme, "dateTime": state.date_time });
    for w in [shell5b::CAPTURE, shell5b::SAVED] {
        let _ = app.emit_to(w, "ui:state", ui.clone());
    }
    Ok(())
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
/// test environment the start route and the time zone (`TZ`).
pub(crate) fn init_script(dirs: &AppDirs) -> String {
    let mut ui = load_ui_state(dirs);
    if let Some(theme) = test_var("TEGG_THEME").filter(|t| ["system", "light", "dark"].contains(&t.as_str())) {
        ui.theme = theme;
    }
    let route = test_var("TEGG_ROUTE");
    // D-504: with TEGG_TEST=1, `TEGG_NOW=<ISO 8601>` fixes the UI's clock (it starts there and runs on), so L6 tests run
    // on the criteria's test clock. Only a valid date-time with offset is used.
    let now_ms = test_var("TEGG_NOW").and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()).map(|t| t.timestamp_millis());
    let clock = match now_ms {
        Some(ms) => format!(
            " (() => {{ const off = {ms} - Date.now(); const R = Date; class D extends R {{ constructor(...a) {{ if (a.length === 0) super(R.now() + off); else super(...a); }} static now() {{ return R.now() + off; }} }} window.Date = D; window.__TEGG_NOW__ = {ms}; }})();"
        ),
        None => String::new(),
    };
    format!(
        "window.__TEGG_UI_STATE__ = {}; window.__TEGG_REGION__ = {}; window.__TEGG_ROUTE__ = {}; window.__TEGG_TEST_MODE__ = {}; window.__TEGG_TZ__ = {};{clock}",
        serde_json::to_string(&ui).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&region_locale()).unwrap_or_else(|_| "null".into()),
        serde_json::to_string(&route).unwrap_or_else(|_| "null".into()),
        std::env::var("TEGG_TEST").as_deref() == Ok("1"),
        // L6 time-zone runs: WebKit's content process doesn't inherit TZ, so the UI gets the zone here (D-382 run).
        serde_json::to_string(&test_var("TZ")).unwrap_or_else(|_| "null".into()),
    )
}


/// ⌘Q, the status menu's `Quit Tegg` and the Quit Apple Event: the UI saves first and answers `app_quit` (D-196).
pub(crate) fn request_quit(app: &AppHandle) {
    if ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst) {
        app.exit(0);
    } else {
        let _ = app.emit_to("main", "app:quit-requested", ());
    }
}

/// The app's context (config, assets, capabilities, command manifest), for the real runtime and the ACL probe (D-570).
pub(crate) fn context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

pub fn run() {
    let dirs = app_dirs();
    // D-71: one instance per app bundle (FR-CAP-05 AC-4, AC-9); a second launch shows the first one's window.
    shell5b::single_instance(BUNDLE_ID);
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { dirs, core: Mutex::new(None), vault: Mutex::new(None) })
        // ms6-trash-media §3.6 (D-626): vault media for the webviews, read-only.
        .register_asynchronous_uri_scheme_protocol("tegg-media", shell6a::media_scheme)
        .setup(|app| {
            let handle = app.handle().clone();
            // FR-CNV-03 AC-7 (test build): `TEGG_TEST_HOLD=during-source-save:<vault path>` holds that file's next
            // replacing write after its temp file is written, before the rename.
            if let Some(target) = test_var("TEGG_TEST_HOLD").and_then(|v| v.strip_prefix("during-source-save:").map(tegg_format::nfc)) {
                let _ = tegg_vault::BEFORE_RENAME.set(Box::new(move |path: &str| {
                    if tegg_format::nfc(path) == target {
                        hold("during-source-save");
                    }
                }));
            }
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
                // D-608: Help › Keyboard Shortcuts opens `help/shortcuts` in the main window.
                for item in menu.items()? {
                    if let tauri::menu::MenuItemKind::Submenu(sub) = &item {
                        if sub.text().unwrap_or_default() == "Help" {
                            sub.append(&MenuItem::with_id(&handle, "tegg-shortcuts", strings::menubar("shortcuts"), true, Some("CmdOrCtrl+Shift+/"))?)?;
                        }
                    }
                }
                app.set_menu(menu)?;
                app.on_menu_event(|app, e| {
                    if e.id() == "tegg-quit" {
                        request_quit(app);
                    } else if e.id() == "tegg-shortcuts" {
                        shell5b::show_main(app);
                        let _ = app.emit_to("main", "shell:route", serde_json::json!({ "route": "help/shortcuts" }));
                    }
                });
            }
            let dirs = app.state::<AppState>().dirs.clone();
            // The main window is built here so the init script runs before the UI (no flash of the wrong theme). A
            // login launch starts with it hidden: menu bar and hotkeys only (D-547).
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title(APP_NAME)
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .visible(!shell5b::launched_at_login())
                .initialization_script(&init_script(&dirs))
                .build()?;
            // ms5-capture §1: the pre-warmed capture window and panel, the status item, the global hotkeys.
            shell5b::build_windows(&handle)?;
            shell5b::setup_hotkeys(&handle);
            shell5b::set_status_item(&handle, shell5b::load_shell(&dirs.root).show_status_item)?;
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
            link_resolve, embed_load, index_path_by_id, open_external, note_write, note_create_exact, note_trash, note_discard, index_tags, index_conflicts, app_quit, type_get,
            type_create, type_patch, type_delete, type_template, type_usage, index_type_rows, starter_plan, starter_add,
            index_backlinks, index_broken_links, index_duplicate_titles, link_create_plan, link_create,
            daily_view, daily_dates, daily_draft, daily_create, daily_context, daily_backlinks,
            note_rename, job_cancel, job_confirm, job_report, job_retry, job_undo, job_redo, job_transform_result, job_interrupted,
            job_resolve_interrupted, backups_list, backup_restore, editor_open, editor_close,
            task_list, daily_tasks,
            shell5b::capture_context, shell5b::capture_create, shell5b::capture_ready, shell5b::capture_hide, shell5b::capture_resize,
            shell5b::capture_open_main, shell5b::capture_draft_get, shell5b::capture_draft_set, shell5b::capture_saved_show, shell5b::capture_suggest,
            shell5b::vault_settings, shell5b::vault_settings_patch, shell5b::vault_reveal, shell5b::shell_settings,
            shell5b::shell_settings_set, shell5b::hotkeys, shell5b::hotkeys_retry, shell5b::inbox_list, shell5b::inbox_count,
            shell5b::inbox_bulk, shell5b::capture_open, shell5b::index_versions,
            shell6a::trash_list, shell6a::object_trash, shell6a::trash_restore, shell6a::trash_delete, shell6a::trash_empty,
            shell6a::media_add, shell6a::media_add_paths, shell6a::media_pick, shell6a::media_open, shell6a::media_reveal,
            shell6a::capture_media_add,
            shell4d::tag_objects, shell4d::index_tagged_objects, shell4d::tag_usage, shell4d::tag_new_path, shell4d::tag_rename, shell4d::tag_delete,
            shell4e::type_move_plan, shell4e::type_move, shell4e::folder_move_preview, shell4e::tidy_now, shell4e::jobs_ready,
            shell4e::value_remove_start, shell4e::type_delete_start,
            shell4d::merge_start, shell4d::job_plan, shell4d::backup_reveal,
            shellg1::graph_neighbourhood
        ])
        .build(context())
        .expect("error while building Tegg")
        .run(|app, event| {
            // ⌘Q and the Quit Apple Event first let the UI flush the open note (FR-EDT-08 AC-7): the UI answers with
            // `app_quit` when the note is saved or the user chose to quit anyway (D-196). Closing a window only hides
            // it: the app keeps running in the menu bar (FR-CAP-03 AC-1).
            let allowed = ALLOW_EXIT.load(std::sync::atomic::Ordering::SeqCst);
            match event {
                tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() && !allowed => {
                    api.prevent_exit();
                    let _ = app.emit_to("main", "app:quit-requested", ());
                }
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if !allowed => {
                    api.prevent_close();
                    if let Some(w) = app.get_webview_window(&label) {
                        let _ = w.hide();
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => shell5b::show_main(app),
                _ => {}
            }
        });
}

/// 5B preview feedback F1 (docs/feedback/ms5-5b.md): Logi Options+ sends the mouse's Back and Forward buttons as the
/// system's navigation swipe, not as buttons 4/5; they navigate as the touchpad's back swipe does (FR-NAV-03, D-165).
#[cfg(test)]
mod bug_ms5b_fr_nav_03_swipe_goes_back {
    use super::{nav_of, NavInput};

    #[test]
    fn bug_ms5b_fr_nav_03_swipe_goes_back() {
        assert_eq!(nav_of(NavInput::OtherMouseUp(3)), Some("back"));
        assert_eq!(nav_of(NavInput::OtherMouseUp(4)), Some("forward"));
        assert_eq!(nav_of(NavInput::OtherMouseUp(2)), None, "the middle button isn't navigation");
        assert_eq!(nav_of(NavInput::Swipe(1.0)), Some("back"), "a swipe with deltaX > 0 goes back, as in Safari and Chromium");
        assert_eq!(nav_of(NavInput::Swipe(-1.0)), Some("forward"));
        assert_eq!(nav_of(NavInput::Swipe(0.0)), None, "a vertical swipe isn't navigation");
    }
}
