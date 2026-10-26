//! Slice 5B shell (docs/contracts/ms5-capture.md §1, §2, §5, §7; D-539…D-584): the pre-warmed capture window and the
//! `capture-saved` panel, the status item, the two global hotkeys (registered exclusively, D-581), single instance
//! (D-71), the login item (FR-SET-05), machine settings, and the 5B IPC commands. Nothing here writes a vault file
//! except through the core (`capture_create`, `vault_settings_patch`, the `inbox` job).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::dto::*;
use crate::{attribute_dto, core, core_err, err, init_script, job_err, test_var, version_dto, version_from, AppState};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub(crate) const CAPTURE: &str = "capture";
pub(crate) const SAVED: &str = "capture-saved";
const WIDTH: f64 = 420.0;

// ------------------------------------------------------------------------------------------------ machine settings (§5.2)

const SHELL_FILE: &str = "shell-settings.json";
const DRAFT_FILE: &str = "capture-draft.json";

fn support(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().dirs.root.clone()
}

pub(crate) fn load_shell(root: &std::path::Path) -> ShellSettingsDto {
    tegg_vault::read_local_file(&root.join(SHELL_FILE))
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(ShellSettingsDto { show_status_item: true, open_at_login: false })
}

fn save_shell(app: &AppHandle, s: &ShellSettingsDto) -> Result<(), IpcError> {
    let bytes = serde_json::to_vec_pretty(s).map_err(|e| err("Io", e))?;
    tegg_vault::write_local_file(&support(app).join(SHELL_FILE), &bytes).map_err(|e| err("Io", e))
}

// ------------------------------------------------------------------------------------------------ windows (§1.2, §1.3)

/// Creates the hidden capture window and the hidden saved panel (pre-warmed, FR-CAP-03). Both are transparent windows
/// with the native popover material, 14 px corners and the system shadow (D-592, capture.md R55 look).
pub(crate) fn build_windows(app: &AppHandle) -> tauri::Result<()> {
    let _ = APP.set(app.clone());
    let script = init_script(&app.state::<AppState>().dirs);
    WebviewWindowBuilder::new(app, CAPTURE, WebviewUrl::App("capture.html".into()))
        .title("Quick Capture")
        .inner_size(WIDTH, 260.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .effects(EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(14.0).build())
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .minimizable(false)
        .maximizable(false)
        .visible(false)
        .initialization_script(&script)
        .build()?;
    WebviewWindowBuilder::new(app, SAVED, WebviewUrl::App("capture.html#saved".into()))
        .title("Saved to Inbox")
        .inner_size(360.0, 96.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .effects(EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(14.0).build())
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .initialization_script(&script)
        .build()?;
    Ok(())
}

struct Pending {
    seq: u64,
    trigger: &'static str,
    kind: &'static str,
    at: Instant,
}

static SEQ: AtomicU64 = AtomicU64::new(0);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
/// The status item's rect at its last click (physical pixels), for anchoring (D-542).
static TRAY_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);
/// The app that was frontmost before a trigger (re-activated on hide, FR-CAP-01 AC-4).
static PREVIOUS_APP: Mutex<Option<i32>> = Mutex::new(None);

/// §1.3: `trigger` `status-item` | `status-menu` | `hotkey` | `palette`; `kind` `default` | `task`.
pub(crate) fn open_capture(app: &AppHandle, trigger: &'static str, kind: &'static str) {
    let Some(win) = app.get_webview_window(CAPTURE) else { return };
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    *PENDING.lock().unwrap_or_else(|p| p.into_inner()) = Some(Pending { seq, trigger, kind, at: Instant::now() });
    let visible = win.is_visible().unwrap_or(false);
    if !visible {
        *PREVIOUS_APP.lock().unwrap_or_else(|p| p.into_inner()) = macos::frontmost_other_app();
        position(app, &win, trigger);
    }
    let _ = win.emit_to(CAPTURE, "capture:open", serde_json::json!({ "seq": seq, "trigger": trigger, "kind": kind }));
    let _ = win.show();
    let _ = win.set_focus();
}

fn position(app: &AppHandle, win: &tauri::WebviewWindow, trigger: &str) {
    let size = win.outer_size().unwrap_or(tauri::PhysicalSize { width: 840, height: 520 });
    let anchored = matches!(trigger, "status-item" | "status-menu").then(|| *TRAY_RECT.lock().unwrap_or_else(|p| p.into_inner())).flatten();
    if let Some((x, y, w, h)) = anchored {
        let left = x + w / 2.0 - size.width as f64 / 2.0;
        let _ = win.set_position(tauri::PhysicalPosition { x: left.max(0.0) as i32, y: (y + h + 4.0) as i32 });
        return;
    }
    let cursor = app.cursor_position().ok();
    let monitor = cursor.and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten()).or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let (mp, ms) = (m.position(), m.size());
        let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
        let y = mp.y + ms.height as i32 / 6;
        let _ = win.set_position(tauri::PhysicalPosition { x, y });
    } else {
        let _ = win.center();
    }
}

fn hide_capture(app: &AppHandle) {
    // Before the hide: once the capture window is gone, AppKit makes the main window key, which isn't the user's choice.
    let main_key = app.get_webview_window("main").is_some_and(|m| m.is_visible().unwrap_or(false) && m.is_focused().unwrap_or(false));
    if let Some(w) = app.get_webview_window(CAPTURE) {
        let _ = w.hide();
    }
    let previous = PREVIOUS_APP.lock().unwrap_or_else(|p| p.into_inner()).take();
    if let (Some(pid), false) = (previous, main_key) {
        macos::activate(pid);
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ------------------------------------------------------------------------------------------------ status item (§1.4)

const TRAY_ID: &str = "tegg-status";

/// D-597, D-782: the status item is the Tegg mark (logo 3B) as a one-colour glyph, not a template image: near-black on a
/// light menu bar, white on a dark one. The windows follow the system appearance (no window sets a theme), so their
/// theme is the system's.
fn tray_image(theme: tauri::Theme) -> tauri::image::Image<'static> {
    match theme {
        tauri::Theme::Dark => tauri::include_image!("icons/tray-dark.png"),
        _ => tauri::include_image!("icons/tray-light.png"),
    }
}

fn system_theme(app: &AppHandle) -> tauri::Theme {
    app.webview_windows().values().find_map(|w| w.theme().ok()).unwrap_or(tauri::Theme::Light)
}

/// Called on every window's `ThemeChanged` (lib.rs): swaps the status item's glyph.
pub fn tray_follow_theme(app: &AppHandle, theme: tauri::Theme) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(tray_image(theme)));
        let _ = tray.set_icon_as_template(false);
    }
}

pub(crate) fn set_status_item(app: &AppHandle, show: bool) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let _ = app.remove_tray_by_id(TRAY_ID);
    if !show {
        return Ok(());
    }
    let s = crate::strings::menubar;
    let active = |id: &str| hotkey_states().iter().any(|h| h.id == id && h.state == "active");
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "capture", s("capture"), true, active("quick-capture").then_some("Ctrl+Alt+Space"))?,
            &MenuItem::with_id(app, "task", s("task"), true, active("new-task").then_some("Ctrl+Alt+T"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "open", s("open"), true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", s("settings"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", s("quit"), true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_image(system_theme(app)))
        .icon_as_template(false)
        .title("")
        .tooltip(s("help"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = ev {
                let p = rect.position.to_physical::<f64>(1.0);
                let z = rect.size.to_physical::<f64>(1.0);
                *TRAY_RECT.lock().unwrap_or_else(|p| p.into_inner()) = Some((p.x, p.y, z.width, z.height));
                open_capture(tray.app_handle(), "status-item", "default");
            }
        })
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "capture" => open_capture(app, "status-menu", "default"),
            "task" => open_capture(app, "status-menu", "task"),
            "open" => show_main(app),
            "settings" => {
                show_main(app);
                let _ = app.emit_to("main", "shell:route", serde_json::json!({ "route": "settings/appearance" }));
            }
            "quit" => crate::request_quit(app),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ------------------------------------------------------------------------------------------------ hotkeys (§1.6, D-581)

const HOTKEYS: [(&str, &str, u32, &str); 2] = [("quick-capture", "⌃⌥Space", 49 /* kVK_Space */, "default"), ("new-task", "⌃⌥T", 17 /* kVK_ANSI_T */, "task")];
static HOTKEY_STATE: Mutex<Vec<HotkeyStateDto>> = Mutex::new(Vec::new());

pub(crate) fn hotkey_states() -> Vec<HotkeyStateDto> {
    HOTKEY_STATE.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

fn register_hotkey(index: usize) -> bool {
    let (_, _, code, _) = HOTKEYS[index];
    macos::register_hotkey(index as u32 + 1, code)
}

pub(crate) fn setup_hotkeys(app: &AppHandle) {
    macos::install_hotkey_handler(|id| {
        let Some(app) = APP.get() else { return };
        if let Some((_, _, _, kind)) = HOTKEYS.get(id as usize - 1) {
            let app2 = app.clone();
            let kind: &'static str = kind;
            let _ = app.run_on_main_thread(move || open_capture(&app2, "hotkey", kind));
        }
    });
    let states: Vec<HotkeyStateDto> = HOTKEYS
        .iter()
        .enumerate()
        .map(|(i, (id, keys, _, _))| HotkeyStateDto { id: id.to_string(), keys: keys.to_string(), state: if register_hotkey(i) { "active" } else { "taken" }.into() })
        .collect();
    *HOTKEY_STATE.lock().unwrap_or_else(|p| p.into_inner()) = states;
    let _ = app.emit_to("main", "hotkeys:state", hotkey_states());
}

// ------------------------------------------------------------------------------------------------ single instance (D-71)

/// The per-user temp folder keeps one socket per bundle, whatever Application Support folder a launch uses.
fn instance_socket(bundle_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{bundle_id}.instance.sock"))
}

/// Before the app starts: when another instance of this app bundle runs, it is asked to show its main window and this
/// process exits. Otherwise a listener is set up for later launches.
pub(crate) fn single_instance(bundle_id: &str) {
    use std::io::{BufRead, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    let sock = instance_socket(bundle_id);
    if let Ok(mut s) = UnixStream::connect(&sock) {
        let _ = s.write_all(b"show\n");
        std::process::exit(0);
    }
    let _ = std::fs::remove_file(&sock);
    let Ok(listener) = UnixListener::bind(&sock) else { return };
    std::thread::spawn(move || {
        for s in listener.incoming().flatten() {
            let mut line = String::new();
            let _ = std::io::BufReader::new(s).read_line(&mut line);
            if let Some(app) = APP.get() {
                let a = app.clone();
                let _ = app.run_on_main_thread(move || show_main(&a));
            }
        }
    });
}

// ------------------------------------------------------------------------------------------------ login item (§1.5)

pub(crate) fn launched_at_login() -> bool {
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        return test_var("TEGG_TEST_LAUNCHED_AT_LOGIN").as_deref() == Some("1");
    }
    macos::launched_as_login_item()
}

fn set_login_item(on: bool) -> Result<(), IpcError> {
    if let Some(file) = test_var("TEGG_TEST_LOGIN_ITEM") {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| err("Io", e))?;
        return f.write_all(if on { b"register\n" } else { b"unregister\n" }).map_err(|e| err("Io", e));
    }
    if macos::login_item(on) {
        Ok(())
    } else {
        Err(err("LoginItem", "Couldn’t add Tegg to the login items."))
    }
}

// ------------------------------------------------------------------------------------------------ capture IPC (§2.2)

/// §2.2: an opaque token of the open vault (D-553: the capture window never learns the vault's path); a new one after
/// every vault switch, so a capture typed for another vault is refused.
fn vault_token(state: &AppState) -> Option<CaptureVaultDto> {
    use std::hash::{Hash, Hasher};
    let info = state.vault.lock().unwrap_or_else(|p| p.into_inner()).clone()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (info.path.as_str(), crate::VAULT_GEN.load(Ordering::SeqCst)).hash(&mut h);
    Some(CaptureVaultDto { id: format!("v{:016x}", h.finish()), name: info.name, color: None })
}

/// §2.2: `capture:context-changed` only when the capture context can have changed: a `.tegg/` file (types, vault
/// settings, templates' types) or the vault's tag list; not on every autosave.
pub(crate) fn context_maybe_changed(app: &AppHandle, paths: &[String]) {
    use std::hash::{Hash, Hasher};
    static TAGS: Mutex<Option<u64>> = Mutex::new(None);
    let state = app.state::<AppState>();
    let Ok(core) = core(&state) else { return };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for t in core.tag_rows() {
        (t.name, t.color).hash(&mut h);
    }
    let sig = h.finish();
    let tags_changed = TAGS.lock().unwrap_or_else(|p| p.into_inner()).replace(sig) != Some(sig);
    if tags_changed || paths.iter().any(|p| p.starts_with(".tegg/") || p.starts_with("_templates/")) {
        let _ = app.emit_to(CAPTURE, "capture:context-changed", ());
    }
}

/// The frontmatter block of a template, `---` lines included (D-567).
fn template_head(text: &str) -> Option<String> {
    let t = text.strip_prefix('\u{feff}').unwrap_or(text);
    let first = t.find('\n')?;
    if t[..first].trim_end_matches('\r') != "---" {
        return None;
    }
    let mut at = first + 1;
    for line in t[first + 1..].split_inclusive('\n') {
        at += line.len();
        if line.trim_end_matches(['\n', '\r']) == "---" {
            return Some(t[..at].to_string());
        }
    }
    None
}

#[tauri::command]
pub(crate) async fn capture_context(state: State<'_, AppState>) -> Result<CaptureContextDto, IpcError> {
    let vault = vault_token(&state);
    let Ok(core) = core(&state) else { return Ok(CaptureContextDto { vault: None, types: Vec::new(), default_type: "quick-note".into(), tags: Vec::new() }) };
    let types = core
        .types()
        .into_iter()
        .filter(|t| !t.invalid && (matches!(t.key.as_str(), "page" | "task" | "quick-note") || !t.system))
        .map(|t| {
            let head = core.type_template(&t.key).ok().flatten().and_then(|(_, b)| template_head(&String::from_utf8_lossy(&b)));
            let review = match t.def.review {
                tegg_schema::Review::Off => "off",
                tegg_schema::Review::On => "on",
                tegg_schema::Review::Locked => "locked",
            };
            CaptureTypeDto {
                key: t.key.clone(),
                name: t.name.clone(),
                icon: t.icon.clone(),
                color: t.color.clone(),
                folder: t.folder.clone(),
                review: review.into(),
                attributes: t.def.attributes.clone().into_iter().map(attribute_dto).collect(),
                template_head: head,
                plural: Some(t.plural.clone()),
            }
        })
        .collect();
    let d = core.vault_settings().default_type;
    let default_type = if d.valid && d.key != "daily-note" { d.key } else { "quick-note".into() };
    let tags = core.tag_rows().into_iter().filter(|t| t.count >= 1 || t.file.is_some()).map(|t| CaptureTagDto { name: t.name, color: t.color }).collect();
    Ok(CaptureContextDto { vault, types, default_type, tags })
}

#[tauri::command]
pub(crate) async fn capture_create(state: State<'_, AppState>, vault: String, r#type: String, title: String, text: String, media: Option<Vec<String>>) -> Result<CapturedDto, IpcError> {
    let Some(current) = vault_token(&state) else { return Err(err("NoVault", "no vault is open")) };
    if current.id != vault {
        return Err(err("VaultChanged", "the vault isn't open any more"));
    }
    let core = core(&state)?;
    // Test-only, once per launch (no env mutation from an async command).
    static FAILED_ONCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if test_var("TEGG_TEST_FAIL_CAPTURE").as_deref() == Some("io") && !FAILED_ONCE.swap(true, Ordering::SeqCst) {
        return Err(err("Io", "test: the capture write failed"));
    }
    // ms6-trash-media §5 (D-624): the staged files first (pairs, create-exclusive), then the note embedding them. An
    // empty title is a capture without one: its media get `Capture <date> <n>` titles, the note `Untitled`.
    let mut text = text;
    let untitled = title.trim().is_empty();
    let title = if untitled { "Untitled".to_string() } else { title };
    let media = media.unwrap_or_default();
    if !media.is_empty() {
        let key = tegg_format::type_key(&r#type);
        let folder = core.type_get(&key).map(|t| t.folder).unwrap_or_default();
        let owner = format!("{folder}/{}.md", tegg_format::sanitize_file_stem(title.trim()));
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let embeds = crate::shell6a::write_staged(&core, &media, &owner, if untitled { "" } else { title.trim() }, &date)?;
        let body: String = embeds.iter().map(|e| format!("![[{e}]]\n")).collect::<Vec<_>>().join("\n");
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push('\n');
        text.push_str(&body);
    }
    let path = core.capture_create(&r#type, &title, text.as_bytes()).map_err(core_err)?;
    let type_name = core.type_get(&tegg_format::type_key(&r#type)).map(|t| t.name).unwrap_or(r#type);
    Ok(CapturedDto { path, title: tegg_format::nfc(title.trim()), type_name })
}

#[tauri::command]
pub(crate) async fn capture_ready(seq: u64) -> Result<(), IpcError> {
    let p = PENDING.lock().unwrap_or_else(|p| p.into_inner()).take();
    let Some(p) = p.filter(|p| p.seq == seq) else { return Ok(()) };
    let ms = p.at.elapsed().as_secs_f64() * 1e3;
    if let Some(log) = test_var("TEGG_PERF_LOG") {
        use std::io::Write;
        let line = serde_json::json!({ "mark": "capture-ready", "trigger": p.trigger, "kind": p.kind, "ms": ms });
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
            let _ = f.write_all(format!("{line}\n").as_bytes());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn capture_hide(app: AppHandle) -> Result<(), IpcError> {
    let a = app.clone();
    app.run_on_main_thread(move || hide_capture(&a)).map_err(|e| err("Io", e))
}

#[tauri::command]
pub(crate) async fn capture_resize(app: AppHandle, height: f64) -> Result<(), IpcError> {
    if let Some(w) = app.get_webview_window(CAPTURE) {
        let _ = w.set_size(tauri::LogicalSize { width: WIDTH, height: height.clamp(160.0, 560.0) });
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn capture_open_main(app: AppHandle, path: Option<String>) -> Result<(), IpcError> {
    let a = app.clone();
    app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window(CAPTURE) {
            let _ = w.hide();
        }
        if let Some(w) = a.get_webview_window(SAVED) {
            let _ = w.hide();
        }
        show_main(&a);
        if let Some(p) = path {
            let _ = a.emit_to("main", "shell:route", serde_json::json!({ "route": format!("note/{p}") }));
        }
    })
    .map_err(|e| err("Io", e))
}

#[tauri::command]
pub(crate) async fn capture_draft_get(app: AppHandle) -> Result<Option<CaptureDraftDto>, IpcError> {
    Ok(tegg_vault::read_local_file(&support(&app).join(DRAFT_FILE)).and_then(|b| serde_json::from_slice(&b).ok()))
}

#[tauri::command]
pub(crate) async fn capture_draft_set(app: AppHandle, draft: Option<CaptureDraftDto>) -> Result<(), IpcError> {
    let path = support(&app).join(DRAFT_FILE);
    match draft {
        Some(d) => {
            let bytes = serde_json::to_vec_pretty(&d).map_err(|e| err("Io", e))?;
            tegg_vault::write_local_file(&path, &bytes).map_err(|e| err("Io", e))
        }
        None => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(err("Io", e)),
        },
    }
}

static SAVED_GEN: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub(crate) async fn capture_saved_show(app: AppHandle, type_name: String, title: String, path: String, heading: Option<String>) -> Result<(), IpcError> {
    let gen = SAVED_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let a = app.clone();
    app.run_on_main_thread(move || {
        let Some(panel) = a.get_webview_window(SAVED) else { return };
        if let Some(cap) = a.get_webview_window(CAPTURE) {
            if let Ok(p) = cap.outer_position() {
                let _ = panel.set_position(p);
            }
        }
        let _ = panel.emit_to(SAVED, "capture:saved", serde_json::json!({ "typeName": type_name, "title": title, "path": path, "heading": heading }));
        let _ = panel.show();
    })
    .map_err(|e| err("Io", e))?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        if SAVED_GEN.load(Ordering::SeqCst) == gen {
            let a = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(p) = a.get_webview_window(SAVED) {
                    let _ = p.hide();
                }
            });
        }
    });
    Ok(())
}

/// D-578: the main window's palette `Quick Capture` / `Capture a task` and Inbox zero.
#[tauri::command]
pub(crate) async fn capture_open(app: AppHandle, kind: String) -> Result<(), IpcError> {
    let kind: &'static str = if kind == "task" { "task" } else { "default" };
    let a = app.clone();
    app.run_on_main_thread(move || open_capture(&a, "palette", kind)).map_err(|e| err("Io", e))
}

// ------------------------------------------------------------------------------------------------ settings IPC (§5)

fn settings_dto(s: tegg_core::VaultSettings) -> VaultSettingsDto {
    VaultSettingsDto {
        version: s.version.as_ref().map(version_dto),
        default_type: DefaultTypeDto { raw: s.default_type.raw, key: s.default_type.key, valid: s.default_type.valid },
        daily_format: s.daily_format,
        attachments: s.attachments,
    }
}

#[tauri::command]
pub(crate) async fn vault_settings(state: State<'_, AppState>) -> Result<VaultSettingsDto, IpcError> {
    Ok(settings_dto(core(&state)?.vault_settings()))
}

#[tauri::command]
pub(crate) async fn vault_settings_patch(app: AppHandle, state: State<'_, AppState>, base: Option<VersionDto>, key: String, value: String) -> Result<VaultSettingsDto, IpcError> {
    let core = core(&state)?;
    let k = match key.as_str() {
        "default-type" => tegg_core::VaultKey::DefaultType,
        "daily-format" => tegg_core::VaultKey::DailyFormat,
        "attachments" => tegg_core::VaultKey::Attachments,
        _ => return Err(err("Invalid", format!("unknown setting {key}"))),
    };
    let base = base.as_ref().map(version_from).transpose()?;
    let s = core.vault_settings_patch(base, k, value).map_err(core_err)?;
    let _ = app.emit_to(CAPTURE, "capture:context-changed", ());
    Ok(settings_dto(s))
}

#[tauri::command]
pub(crate) async fn vault_reveal(state: State<'_, AppState>) -> Result<(), IpcError> {
    let path = state.vault.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|v| v.path.clone()).ok_or_else(|| err("NoVault", "no vault is open"))?;
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if let Some(file) = test_var("TEGG_TEST_REVEAL") {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| err("Io", e))?;
            return f.write_all(format!("{path}\n").as_bytes()).map_err(|e| err("Io", e));
        }
        return Ok(());
    }
    std::process::Command::new("/usr/bin/open").arg("-R").arg(&path).spawn().map(|_| ()).map_err(|e| err("Io", e))
}

#[tauri::command]
pub(crate) async fn shell_settings(app: AppHandle) -> Result<ShellSettingsDto, IpcError> {
    let mut s = load_shell(&support(&app));
    if test_var("TEGG_TEST_LOGIN_ITEM").is_none() && std::env::var("TEGG_TEST").as_deref() != Ok("1") {
        s.open_at_login = macos::login_item_enabled();
    }
    Ok(s)
}

#[tauri::command]
pub(crate) async fn shell_settings_set(app: AppHandle, settings: ShellSettingsDto) -> Result<(), IpcError> {
    let before = load_shell(&support(&app));
    if before.open_at_login != settings.open_at_login {
        set_login_item(settings.open_at_login)?;
    }
    save_shell(&app, &settings)?;
    if before.show_status_item != settings.show_status_item {
        let a = app.clone();
        let show = settings.show_status_item;
        app.run_on_main_thread(move || {
            let _ = set_status_item(&a, show);
        })
        .map_err(|e| err("Io", e))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn hotkeys() -> Result<Vec<HotkeyStateDto>, IpcError> {
    Ok(hotkey_states())
}

#[tauri::command]
pub(crate) async fn hotkeys_retry(app: AppHandle, id: String) -> Result<Vec<HotkeyStateDto>, IpcError> {
    let (tx, rx) = std::sync::mpsc::channel();
    let a = app.clone();
    app.run_on_main_thread(move || {
        if let Some(i) = HOTKEYS.iter().position(|h| h.0 == id) {
            let ok = hotkey_states().get(i).is_some_and(|h| h.state == "active") || register_hotkey(i);
            if let Some(h) = HOTKEY_STATE.lock().unwrap_or_else(|p| p.into_inner()).get_mut(i) {
                h.state = if ok { "active" } else { "taken" }.into();
            }
            let show = load_shell(&support(&a)).show_status_item;
            let _ = set_status_item(&a, show);
        }
        let _ = tx.send(());
    })
    .map_err(|e| err("Io", e))?;
    let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
    let states = hotkey_states();
    let _ = app.emit_to("main", "hotkeys:state", states.clone());
    Ok(states)
}

// ------------------------------------------------------------------------------------------------ Inbox IPC (§7)

#[tauri::command]
pub(crate) async fn inbox_list(state: State<'_, AppState>) -> Result<Vec<InboxRowDto>, IpcError> {
    Ok(core(&state)?
        .inbox_list()
        .into_iter()
        .map(|r| InboxRowDto {
            path: r.path,
            id: r.id,
            title: r.title,
            r#type: r.r#type,
            review_raw: r.review_raw,
            captured: r.captured,
            created: r.created,
            modified: r.modified,
            tags: r.tags,
            excerpt: r.excerpt,
            read_only: r.read_only,
            version: version_dto(&r.version),
        })
        .collect())
}

/// The index's versions of `paths` (ms5-capture §7.3): the base of an `Append to…` target.
#[tauri::command]
pub(crate) async fn index_versions(state: State<'_, AppState>, paths: Vec<String>) -> Result<Vec<Option<VersionDto>>, IpcError> {
    Ok(core(&state)?.index_versions(&paths).iter().map(|v| v.as_ref().map(version_dto)).collect())
}

#[tauri::command]
pub(crate) async fn inbox_count(state: State<'_, AppState>) -> Result<u32, IpcError> {
    Ok(core(&state)?.inbox_count() as u32)
}

#[tauri::command]
pub(crate) async fn inbox_bulk(state: State<'_, AppState>, paths: Vec<String>, change: serde_json::Value) -> Result<JobIdDto, IpcError> {
    use tegg_core::tegg_jobs::{InboxJobChange, JobOp};
    let s = |k: &str| change[k].as_str().map(str::to_string).ok_or_else(|| err("Invalid", format!("change.{k}")));
    let now = s("now")?;
    let c = match change["op"].as_str() {
        Some("set-review") => InboxJobChange::SetReview { value: s("value")?, now },
        Some("set-type") => InboxJobChange::SetType { r#type: s("type")?, now },
        Some("add-tags") => InboxJobChange::AddTags { tags: change["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect()).unwrap_or_default(), now },
        Some("append-link") => InboxJobChange::AppendLink { target: s("target")?, now },
        Some("append-link-to") => InboxJobChange::AppendLinkTo { path: s("path")?, title: s("title")?, now },
        _ => return Err(err("Invalid", "unknown change")),
    };
    let core = core(&state)?;
    // Defence in depth (D-557, R60): a type change only to a capture target, and never of a Daily Note (D-320).
    if let InboxJobChange::SetType { r#type, .. } = &c {
        let key = tegg_format::type_key(r#type);
        if tegg_core::capture5b::NOT_CAPTURABLE.contains(&key.as_str()) || !core.type_get(&key).is_some_and(|t| !t.invalid) {
            return Err(err("UnsupportedType", "not a capture target"));
        }
        if paths.iter().any(|p| core.object(p).is_some_and(|o| o.r#type == "daily-note")) {
            return Err(err("Invalid", "daily notes can't change type"));
        }
    }
    let job = core.jobs().start(JobOp::Inbox { paths, change: c }).map_err(job_err)?;
    Ok(JobIdDto { job_id: job as u32 })
}

/// Emits `inbox:count` when the member count changed (FR-NAV-04 AC-2).
pub(crate) fn inbox_count_changed(app: &AppHandle) {
    static LAST: AtomicU64 = AtomicU64::new(u64::MAX);
    let Some(core) = app.state::<AppState>().core.lock().unwrap_or_else(|p| p.into_inner()).clone() else { return };
    let n = core.inbox_count() as u64;
    if LAST.swap(n, Ordering::SeqCst) != n {
        let _ = app.emit_to("main", "inbox:count", serde_json::json!({ "count": n }));
    }
}

// ------------------------------------------------------------------------------------------------ ACL probe (§2.1, D-570)

/// The outcome of [`acl_probe`].
#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AclProbe {
    /// Refused by the ACL; no command function ran.
    Refused,
    /// The command function ran (whatever it returned).
    Reached,
}

/// D-570 (NFR-SEC-03 AC-2): invokes `command` as the window `window` through Tauri's mock runtime with the app's real
/// capabilities and command manifest; the invoke handler only records that it was reached.
#[doc(hidden)]
pub fn acl_probe(window: &str, command: &str) -> AclProbe {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    let reached = Arc::new(AtomicBool::new(false));
    let r = reached.clone();
    let app = tauri::test::mock_builder()
        .invoke_handler(move |invoke| {
            r.store(true, Ordering::SeqCst);
            invoke.resolver.resolve(());
            true
        })
        .build(crate::context())
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, window, Default::default()).build().expect("mock window");
    let res = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().expect("url"),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );
    if reached.load(Ordering::SeqCst) && res.is_ok() {
        AclProbe::Reached
    } else {
        AclProbe::Refused
    }
}

// ------------------------------------------------------------------------------------------------ macOS

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct EventHotKeyID {
        signature: u32,
        id: u32,
    }
    #[repr(C)]
    struct EventTypeSpec {
        class: u32,
        kind: u32,
    }
    type Handler = extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> i32;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn GetApplicationEventTarget() -> *mut c_void;
        fn InstallEventHandler(target: *mut c_void, handler: Handler, n: u32, list: *const EventTypeSpec, user: *mut c_void, out: *mut *mut c_void) -> i32;
        fn RegisterEventHotKey(code: u32, modifiers: u32, id: EventHotKeyID, target: *mut c_void, options: u32, out: *mut *mut c_void) -> i32;
        fn GetEventParameter(event: *mut c_void, name: u32, kind: u32, out_kind: *mut u32, size: usize, out_size: *mut usize, data: *mut c_void) -> i32;
    }
    #[link(name = "ServiceManagement", kind = "framework")]
    extern "C" {}

    const fn four(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
    }
    const SIGNATURE: u32 = four(b"TEGG");
    /// controlKey | optionKey.
    const MODIFIERS: u32 = 4096 | 2048;
    /// kEventHotKeyExclusive (D-581).
    const EXCLUSIVE: u32 = 1;

    static ON_PRESS: OnceLock<Box<dyn Fn(u32) + Send + Sync>> = OnceLock::new();

    extern "C" fn handler(_next: *mut c_void, event: *mut c_void, _user: *mut c_void) -> i32 {
        let mut id = EventHotKeyID { signature: 0, id: 0 };
        // SAFETY: `event` is the Carbon event passed to this handler; the parameter is an EventHotKeyID.
        let r = unsafe {
            GetEventParameter(event, four(b"----"), four(b"hkid"), std::ptr::null_mut(), std::mem::size_of::<EventHotKeyID>(), std::ptr::null_mut(), &mut id as *mut _ as *mut c_void)
        };
        if r == 0 && id.signature == SIGNATURE {
            if let Some(f) = ON_PRESS.get() {
                f(id.id);
            }
        }
        0
    }

    pub fn install_hotkey_handler(f: impl Fn(u32) + Send + Sync + 'static) {
        if ON_PRESS.set(Box::new(f)).is_err() {
            return;
        }
        let spec = EventTypeSpec { class: four(b"keyb"), kind: 5 /* kEventHotKeyPressed */ };
        let mut out = std::ptr::null_mut();
        // SAFETY: installs a static handler on the application target (main thread, during setup).
        unsafe {
            InstallEventHandler(GetApplicationEventTarget(), handler, 1, &spec, std::ptr::null_mut(), &mut out);
        }
    }

    /// Registers ⌃⌥<code> exclusively; false when another process holds it.
    pub fn register_hotkey(id: u32, code: u32) -> bool {
        let mut out = std::ptr::null_mut();
        // SAFETY: plain Carbon call with valid out pointer; the reference lives until the process ends (released on quit).
        unsafe { RegisterEventHotKey(code, MODIFIERS, EventHotKeyID { signature: SIGNATURE, id }, GetApplicationEventTarget(), EXCLUSIVE, &mut out) == 0 }
    }

    fn class(name: &str) -> Option<&'static AnyClass> {
        AnyClass::get(&std::ffi::CString::new(name).ok()?)
    }

    /// The frontmost application's pid when it isn't this app.
    pub fn frontmost_other_app() -> Option<i32> {
        let ws = class("NSWorkspace")?;
        // SAFETY: standard AppKit messages on the shared workspace.
        unsafe {
            let shared: Retained<AnyObject> = msg_send![ws, sharedWorkspace];
            let app: Option<Retained<AnyObject>> = msg_send![&*shared, frontmostApplication];
            let pid: i32 = msg_send![&*app?, processIdentifier];
            (pid != std::process::id() as i32).then_some(pid)
        }
    }

    pub fn activate(pid: i32) {
        let Some(cls) = class("NSRunningApplication") else { return };
        // SAFETY: standard AppKit messages; a vanished pid gives nil.
        unsafe {
            let app: Option<Retained<AnyObject>> = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
            if let Some(app) = app {
                let _: bool = msg_send![&*app, activateWithOptions: 0usize];
            }
        }
    }

    fn main_service() -> Option<Retained<AnyObject>> {
        let cls = class("SMAppService")?;
        // SAFETY: SMAppService (macOS 13+) class message.
        unsafe { msg_send![cls, mainAppService] }
    }

    pub fn login_item(on: bool) -> bool {
        let Some(s) = main_service() else { return false };
        let none: *mut *mut AnyObject = std::ptr::null_mut();
        // SAFETY: documented SMAppService instance methods; errors are reported by the BOOL result.
        unsafe {
            if on {
                msg_send![&*s, registerAndReturnError: none]
            } else {
                msg_send![&*s, unregisterAndReturnError: none]
            }
        }
    }

    pub fn login_item_enabled() -> bool {
        let Some(s) = main_service() else { return false };
        // SAFETY: `status` is an NSInteger; 1 = SMAppServiceStatusEnabled.
        let status: isize = unsafe { msg_send![&*s, status] };
        status == 1
    }

    /// The launch Apple event says "launched as a login item" (keyAELaunchedAsLogInItem).
    pub fn launched_as_login_item() -> bool {
        let Some(cls) = class("NSAppleEventManager") else { return false };
        // SAFETY: standard Foundation messages; every step may be nil.
        unsafe {
            let mgr: Retained<AnyObject> = msg_send![cls, sharedAppleEventManager];
            let ev: Option<Retained<AnyObject>> = msg_send![&*mgr, currentAppleEvent];
            let Some(ev) = ev else { return false };
            let prop: Option<Retained<AnyObject>> = msg_send![&*ev, paramDescriptorForKeyword: four(b"prdt")];
            let Some(prop) = prop else { return false };
            let code: u32 = msg_send![&*prop, enumCodeValue];
            code == four(b"lgit")
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn install_hotkey_handler(_f: impl Fn(u32) + Send + Sync + 'static) {}
    pub fn register_hotkey(_id: u32, _code: u32) -> bool {
        false
    }
    pub fn frontmost_other_app() -> Option<i32> {
        None
    }
    pub fn activate(_pid: i32) {}
    pub fn login_item(_on: bool) -> bool {
        false
    }
    pub fn login_item_enabled() -> bool {
        false
    }
    pub fn launched_as_login_item() -> bool {
        false
    }
}

/// `capture_suggest` (D-603, ms5-capture §16.1): at most 8 switcher matches as link text, title, type and the matched
/// alias, for `[[` and `@` in the capture window. No body, excerpt or path is sent (NFR-SEC-03 as amended).
#[tauri::command]
pub(crate) async fn capture_suggest(state: State<'_, AppState>, query: String) -> Result<Vec<CaptureSuggestDto>, IpcError> {
    let core = core(&state)?;
    let stem = |p: &str| -> String {
        let p = p.strip_suffix(".md").unwrap_or(p);
        p.rsplit('/').next().unwrap_or(p).to_string()
    };
    let mut stems: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for o in core.objects() {
        *stems.entry(tegg_format::nfc(&stem(&o.path)).to_lowercase()).or_default() += 1;
    }
    Ok(core
        .switcher(&query, 8)
        .into_iter()
        .filter(|i| matches!(i.kind, tegg_core::SwitcherKind::Object))
        .filter_map(|i| {
            let path = i.path?;
            let s = stem(&path);
            let unique = stems.get(&tegg_format::nfc(&s).to_lowercase()).copied().unwrap_or(0) <= 1;
            let link = if unique { s } else { path.strip_suffix(".md").unwrap_or(&path).to_string() };
            Some(CaptureSuggestDto { link, title: i.title, type_key: i.r#type, alias: i.matched_alias })
        })
        .take(8)
        .collect())
}
