//! Tegg desktop shell (architecture §3.3): the main window, IPC commands mapped onto `tegg-core`, core events
//! forwarded to the UI. Thin by design: validate, call the core, map errors. Nothing here reads or writes vault
//! files; the perf log is test-only and machine-local (docs/contracts/ms2-shell.md §1).

mod dto;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, State};
use tegg_core::{AppDirs, Core, CoreError, CoreEvent, CoreOptions, DateRange, MatchField, ProgressState, SearchQuery, SwitcherKind, Vault, VaultError};

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

fn app_dirs() -> AppDirs {
    let root = test_var("TEGG_APP_SUPPORT").map(PathBuf::from).unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/Tegg")
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
    IpcError { kind: kind.into(), message: message.to_string() }
}

fn core_err(e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => err("Conflict", "the file changed on disk"),
        CoreError::Vault(VaultError::Gone) => err("Gone", "the file was deleted"),
        CoreError::Vault(VaultError::NotFound) => err("NotFound", "no such file"),
        CoreError::Vault(VaultError::NameTaken) => err("NameTaken", "the name is taken"),
        other => err("Io", format!("{other:?}")),
    }
}

fn open_vault(app: &AppHandle, path: PathBuf) -> Result<VaultInfo, IpcError> {
    let state = app.state::<AppState>();
    // One vault at a time (D-35): the old core stops (and saves its recency) before the new one opens.
    *state.core.lock().unwrap_or_else(|p| p.into_inner()) = None;
    let core = Arc::new(Core::open(&path, &state.dirs, CoreOptions { watch: true, sync: None }).map_err(core_err)?);
    let info = VaultInfo {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: core.vault().root().to_string_lossy().into_owned(),
        placeholders: core.placeholders().len() as u32,
    };
    forward_events(app.clone(), &core);
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
                CoreEvent::NoteConflict { path, .. } => {
                    let _ = app.emit("note:conflict", ConflictDto { path });
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
    let (bytes, _) = core.read_note(&path, SystemTime::now()).map_err(core_err)?;
    Ok(NoteDto { path, text: String::from_utf8_lossy(&bytes).into_owned() })
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

pub fn run() {
    let dirs = app_dirs();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { dirs, core: Mutex::new(None), vault: Mutex::new(None) })
        .setup(|app| {
            let handle = app.handle().clone();
            let dirs = app.state::<AppState>().dirs.clone();
            let path = test_var("TEGG_VAULT").map(PathBuf::from).or_else(|| Vault::last_opened(&dirs).filter(|(_, exists)| *exists).map(|(p, _)| p));
            if let Some(path) = path {
                // FR-VLT-01 AC-7: a vault that can't be opened leaves the app on its "open a vault" screen.
                if let Err(e) = open_vault(&handle, path) {
                    eprintln!("[tegg] could not open the vault: {}", e.message);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![vault_current, vault_open, index_search, index_switcher, note_read, note_create, perf_mark])
        .run(tauri::generate_context!())
        .expect("error while running Tegg");
}
