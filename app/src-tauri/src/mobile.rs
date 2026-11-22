//! The Android shell (docs/contracts/android-shell.md §2.2, §5, §7; D-2013…D-2041): the start flow, the four
//! Android-only commands and the test APK's `test-env.json`. Compiled only on mobile.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{App, AppHandle, Emitter, Manager, Wry};
use tauri_plugin_tegg_android::TeggAndroid;
use tegg_core::Vault;

use crate::dto::{FoundVaultDto, IpcError, StartStateDto, StorageAccessDto, VaultInfo};
use crate::start::{start_state, StartState};
use crate::vaultfind::{find_vaults, resolve_typed_path, PathRefusal};
use crate::{err, mark_repeat, test_var, AppState};

/// What the Android shell keeps besides `AppState`.
pub(crate) struct Mobile {
    shared_root: PathBuf,
    files_dir: PathBuf,
    state: Mutex<StartStateDto>,
    /// An open is running on the background thread; a second check waits for it.
    opening: AtomicBool,
}

// ---------------------------------------------------------------- test-env.json (§7.1, D-2032)

#[cfg(not(feature = "preview"))]
static TEST_ENV: std::sync::OnceLock<std::collections::HashMap<String, String>> = std::sync::OnceLock::new();

/// A value of the test APK's `test-env.json`; the release APK has no such file reader (AR-08 AC-5).
#[cfg(not(feature = "preview"))]
pub(crate) fn test_env(name: &str) -> Option<String> {
    TEST_ENV.get().and_then(|m| m.get(name).cloned())
}

#[cfg(not(feature = "preview"))]
fn load_test_env(files_dir: &Path) {
    let map = std::fs::read(files_dir.join("test-env.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<std::collections::HashMap<String, serde_json::Value>>(&b).ok())
        .map(|m| m.into_iter().filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string()))).collect())
        .unwrap_or_default();
    let _ = TEST_ENV.set(map);
}

#[cfg(feature = "preview")]
fn load_test_env(_files_dir: &Path) {}

// ---------------------------------------------------------------- setup (§5.2)

fn plugin(app: &AppHandle) -> tauri::State<'_, TeggAndroid<Wry>> {
    app.state::<TeggAndroid<Wry>>()
}

pub(crate) fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let files_dir = PathBuf::from(plugin(&handle).files_dir()?);
    load_test_env(&files_dir);
    let dirs = crate::platform::app_dirs_for(&crate::platform::Platform::Android { files_dir: files_dir.clone() });
    let _ = std::fs::create_dir_all(&dirs.root);
    let shared_root = plugin(&handle).access().map(|a| PathBuf::from(a.shared_root)).unwrap_or_else(|_| PathBuf::from("/storage/emulated/0"));
    app.manage(AppState { dirs: dirs.clone(), core: Mutex::new(None), vault: Mutex::new(None), import: crate::shellimport::new_shared() });
    app.manage(Mobile { shared_root, files_dir, state: Mutex::new(StartStateDto::None), opening: AtomicBool::new(false) });
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into())).initialization_script(crate::init_script(&dirs)).build()?;
    mark_with(&handle, "setup-done", serde_json::json!({ "windows": handle.webview_windows().keys().cloned().collect::<Vec<_>>() }));
    let h = handle.clone();
    std::thread::spawn(move || check(&h));
    Ok(())
}

/// A mark with extra fields (android-shell §7.2); once per name, as `mark`.
fn mark_with(app: &AppHandle, name: &str, extra: serde_json::Value) {
    let Some(log) = test_var("TEGG_PERF_LOG") else { return };
    let mut line = serde_json::json!({ "mark": name, "ms": crate::ms_since_process_start() });
    if let (Some(o), Some(e)) = (line.as_object_mut(), extra.as_object()) {
        o.extend(e.clone());
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = f.write_all(format!("{line}\n").as_bytes());
    }
    let _ = app;
}

fn granted(app: &AppHandle) -> bool {
    let g = plugin(app).access().map(|a| a.granted).unwrap_or(false);
    mark_with(app, "access", serde_json::json!({ "granted": g }));
    g
}

/// The vault to reopen: `TEGG_VAULT` on the test APK, else the last opened one (missing or not).
fn remembered(app: &AppHandle) -> Option<PathBuf> {
    let dirs = &app.state::<AppState>().dirs;
    test_var("TEGG_VAULT").map(PathBuf::from).or_else(|| Vault::last_opened(dirs).map(|(p, _)| p))
}

fn dto(s: StartState) -> StartStateDto {
    match s {
        StartState::NeedsAccess { path } => StartStateDto::NeedsAccess { path },
        StartState::Opening { name, path } => StartStateDto::Opening { name, path },
        StartState::Open { vault } => StartStateDto::Open { vault },
        StartState::Failed { path, kind } => StartStateDto::Failed { path, kind },
        StartState::None => StartStateDto::None,
    }
}

fn set_state(app: &AppHandle, s: StartStateDto) {
    *app.state::<Mobile>().state.lock().unwrap_or_else(|p| p.into_inner()) = s.clone();
    let _ = app.emit_to("main", "vault:start", s);
}

fn current(app: &AppHandle) -> StartStateDto {
    app.state::<Mobile>().state.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Closes the open vault: the core (and its watcher) stops; nothing is written (D-2016).
fn close_vault(app: &AppHandle) {
    let state = app.state::<AppState>();
    let old = state.core.lock().unwrap_or_else(|p| p.into_inner()).take();
    *state.vault.lock().unwrap_or_else(|p| p.into_inner()) = None;
    drop(old);
}

/// §5.2 steps 2 and 3: access first, then the remembered vault on this (background) thread. Never `Core::open`
/// without access (F5).
fn check(app: &AppHandle) {
    let m = app.state::<Mobile>();
    if m.opening.swap(true, Ordering::SeqCst) {
        return;
    }
    let remembered = remembered(app);
    // The guard is dropped here: `open_vault` below locks the same mutex.
    let current_vault = app.state::<AppState>().vault.lock().unwrap_or_else(|p| p.into_inner()).clone();
    if !granted(app) {
        let open = current_vault.as_ref().map(|v| v.path.clone());
        if open.is_some() {
            close_vault(app);
        }
        let path = open.map(PathBuf::from).or(remembered);
        set_state(app, dto(start_state(false, path.as_deref(), None)));
    } else if let Some(v) = current_vault {
        if !matches!(current(app), StartStateDto::Open { .. }) {
            set_state(app, StartStateDto::Open { vault: v });
        }
    } else {
        set_state(app, dto(start_state(true, remembered.as_deref(), None)));
        if let Some(path) = remembered {
            if let Err(e) = open(app, &path) {
                set_state(app, dto(start_state(true, Some(&path), Some(Err(e.kind)))));
            }
        }
    }
    m.opening.store(false, Ordering::SeqCst);
}

/// `RunEvent::Resumed`: access may have changed in the system settings.
pub(crate) fn resumed(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || check(&h));
}

fn refusal(r: PathRefusal) -> IpcError {
    match r {
        PathRefusal::FullPath => err("FullPath", "enter the full path"),
        PathRefusal::OutsideShared => err("OutsideShared", "the folder is outside shared storage"),
        PathRefusal::NotFound => err("NotFound", "the folder doesn't exist"),
        PathRefusal::NotAVault => err("NotATeggVault", "the folder has no .tegg/vault.yml"),
    }
}

fn need_access(app: &AppHandle) -> Result<(), IpcError> {
    if plugin(app).access().map(|a| a.granted).unwrap_or(false) {
        Ok(())
    } else {
        Err(err("NoAccess", "All files access is off"))
    }
}

/// Opens a vault on the phone: the typed-path rules (RA4) first, bulk jobs off (D-2025).
pub(crate) fn open(app: &AppHandle, input: &Path) -> Result<VaultInfo, IpcError> {
    need_access(app)?;
    let m = app.state::<Mobile>();
    let path = resolve_typed_path(&input.to_string_lossy(), &m.shared_root, &m.files_dir, true).map_err(refusal)?;
    let v = crate::open_vault(app, path)?;
    mark_repeat("vault-opened");
    set_state(app, StartStateDto::Open { vault: v.clone() });
    Ok(v)
}

/// `vault_create` on the phone: `parent` must be an existing folder in shared storage.
pub(crate) fn create_parent(app: &AppHandle, parent: &str) -> Result<PathBuf, IpcError> {
    need_access(app)?;
    let m = app.state::<Mobile>();
    resolve_typed_path(parent, &m.shared_root, &m.files_dir, false).map_err(refusal)
}

// ---------------------------------------------------------------- commands (§2.2)

#[tauri::command]
pub(crate) async fn vault_start(app: AppHandle) -> Result<StartStateDto, IpcError> {
    if matches!(current(&app), StartStateDto::NeedsAccess { .. }) && plugin(&app).access().map(|a| a.granted).unwrap_or(false) {
        let h = app.clone();
        std::thread::spawn(move || check(&h));
    }
    Ok(current(&app))
}

#[tauri::command]
pub(crate) async fn vault_find(app: AppHandle) -> Result<Vec<FoundVaultDto>, IpcError> {
    need_access(&app)?;
    let root = app.state::<Mobile>().shared_root.clone();
    Ok(find_vaults(&root)
        .into_iter()
        .map(|v| FoundVaultDto {
            name: v.name,
            rel: v.path.strip_prefix(&root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default(),
            path: v.path.to_string_lossy().into_owned(),
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn storage_access(app: AppHandle) -> Result<StorageAccessDto, IpcError> {
    let a = plugin(&app).access().map_err(|e| err("Io", e))?;
    Ok(StorageAccessDto { granted: a.granted, shared_root: a.shared_root })
}

#[tauri::command]
pub(crate) async fn storage_access_settings(app: AppHandle) -> Result<(), IpcError> {
    plugin(&app).open_settings().map_err(|e| err("Io", e))
}
