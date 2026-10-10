//! Spike S3: Tauri platform shell. Menu bar icon, global hotkeys and a pre-warmed capture
//! window that works with the main window closed (FR-CAP-01, -03, -05), timed from trigger
//! to "cursor in the text field" (S3-QA AC-3).

mod vault;

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use vault::{Capture, CaptureKind};

struct Pending {
    seq: u64,
    trigger: &'static str,
    kind: CaptureKind,
    at: Instant,
}

struct AppState {
    vault: PathBuf,
    timings: PathBuf,
    pending: Mutex<Option<Pending>>,
    seq: Mutex<u64>,
}

#[derive(Clone, serde::Serialize)]
struct OpenPayload {
    seq: u64,
    kind: CaptureKind,
}

/// FR-CAP-05 defaults; configurable later (FR-SET-04).
fn quick_capture_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}
fn new_task_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyT)
}

fn open_capture(app: &AppHandle, kind: CaptureKind, trigger: &'static str) {
    let at = Instant::now();
    let state = app.state::<AppState>();
    let seq = {
        let mut s = state.seq.lock().unwrap();
        *s += 1;
        *s
    };
    *state.pending.lock().unwrap() = Some(Pending { seq, trigger, kind, at });
    let Some(win) = app.get_webview_window("capture") else { return };
    // The page resets itself and reports back through `capture_ready` once the field has focus.
    let _ = win.emit("capture:open", OpenPayload { seq, kind });
    let _ = win.center();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn capture_ready(seq: u64, state: State<AppState>) -> Option<f64> {
    let p = state.pending.lock().unwrap().take().filter(|p| p.seq == seq)?;
    let ms = p.at.elapsed().as_secs_f64() * 1000.0;
    let line = serde_json::json!({
        "seq": seq,
        "trigger": p.trigger,
        "kind": p.kind,
        "ms": (ms * 100.0).round() / 100.0,
        "unix_ms": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
    });
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&state.timings) {
        let _ = writeln!(f, "{line}");
    }
    eprintln!("[s3] capture ready {line}");
    Some(ms)
}

#[tauri::command]
fn save_capture(capture: Capture, app: AppHandle, state: State<AppState>) -> Result<String, String> {
    let now = chrono::Local::now().fixed_offset();
    let path = vault::write_capture(&state.vault, &capture, now).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
    let _ = app.emit("vault:changed", ());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn hide_capture(app: AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
}

#[derive(serde::Serialize)]
struct VaultInfo {
    vault: String,
    timings: String,
    files: Vec<String>,
}

#[tauri::command]
fn vault_info(state: State<AppState>) -> VaultInfo {
    let mut files = Vec::new();
    for folder in ["Quick Notes", "Tasks"] {
        if let Ok(rd) = std::fs::read_dir(state.vault.join(folder)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.ends_with(".md") {
                    files.push(format!("{folder}/{n}"));
                }
            }
        }
    }
    files.sort();
    VaultInfo {
        vault: state.vault.to_string_lossy().into_owned(),
        timings: state.timings.to_string_lossy().into_owned(),
        files,
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, sc, ev| {
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if *sc == quick_capture_key() {
                        open_capture(app, CaptureKind::QuickNote, "hotkey-quick-capture");
                    } else if *sc == new_task_key() {
                        open_capture(app, CaptureKind::Task, "hotkey-new-task");
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Machine-local data stays out of the vault (FR-STO-07). The spike vault is synthetic (D-62).
            let support = app.path().home_dir()?.join("Library/Application Support/Tegg/spike-s3");
            std::fs::create_dir_all(&support)?;
            let vault = std::env::var_os("TEGG_S3_VAULT")
                .map(PathBuf::from)
                .unwrap_or_else(|| std::env::temp_dir().join("tegg-s3-vault"));
            std::fs::create_dir_all(&vault)?;
            app.manage(AppState {
                vault,
                timings: support.join("capture-timings.jsonl"),
                pending: Mutex::new(None),
                seq: Mutex::new(0),
            });

            let gs = app.global_shortcut();
            for key in [quick_capture_key(), new_task_key()] {
                if let Err(e) = gs.register(key) {
                    // Another app may own the combination; the product must surface this (FR-SET-04).
                    eprintln!("[s3] could not register global hotkey {key}: {e}");
                }
            }

            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "capture", "Quick Capture", true, Some("Ctrl+Alt+Space"))?,
                    &MenuItem::with_id(app, "task", "New Task", true, Some("Ctrl+Alt+T"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "show", "Open Tegg", true, None::<&str>)?,
                    &MenuItem::with_id(app, "quit", "Quit Tegg", true, None::<&str>)?,
                ],
            )?;
            TrayIconBuilder::with_id("tegg-tray")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Tegg Quick Capture")
                .menu(&menu)
                // Left click captures straight away (FR-CAP-01); right click shows the menu.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        open_capture(tray.app_handle(), CaptureKind::QuickNote, "menu-bar-click");
                    }
                })
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "capture" => open_capture(app, CaptureKind::QuickNote, "menu-bar-menu"),
                    "task" => open_capture(app, CaptureKind::Task, "menu-bar-menu"),
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|win, ev| {
            // Closing a window hides it: the app keeps running in the menu bar (FR-CAP-03).
            if let WindowEvent::CloseRequested { api, .. } = ev {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![capture_ready, save_capture, hide_capture, vault_info])
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|app, ev| {
        if let RunEvent::Reopen { has_visible_windows: false, .. } = ev {
            show_main(app);
        }
    });
}
