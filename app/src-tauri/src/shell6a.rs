//! Slice 6A shell (docs/contracts/ms6-trash-media.md §1.1, §3.6, §4, §5; D-609…D-623): the trash and media IPC
//! commands of the main window, the capture window's `capture_media_add`, the `SystemTrash` of macOS
//! (`NSFileManager trashItemAtURL`) and the read-only `tegg-media://` scheme.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime};

use tauri::{AppHandle, Emitter, Manager, State};
use tegg_core::{media_info, Core, CoreError, MediaAdd, MediaAdded, OwnerRef, SystemTrash, TrashKind};
use tegg_format::nfc;

use crate::dto::*;
use crate::{core, core_err, err, test_var, version_from, AppState};

/// D-621 (§11, AP-554).
const MAX_BYTES: u64 = 200 * 1024 * 1024;

/// `trash:changed` (§4), debounced 200 ms.
pub(crate) fn trash_changed(app: &AppHandle) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|p| p.into_inner());
    let now = Instant::now();
    if last.is_some_and(|t| now.duration_since(t).as_millis() < 200) {
        let a = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(220));
            let _ = a.emit_to("main", "trash:changed", ());
        });
        return;
    }
    *last = Some(now);
    let _ = app.emit_to("main", "trash:changed", ());
}

// ---------------------------------------------------------------- the system trash (§1.1)

/// macOS: `NSFileManager trashItemAtURL`; with `TEGG_TEST_SYSTEM_TRASH=<dir>` a move into that folder.
pub(crate) struct MacTrash;

impl SystemTrash for MacTrash {
    fn trash(&self, abs: &Path) -> std::io::Result<()> {
        if let Some(dir) = test_var("TEGG_TEST_SYSTEM_TRASH") {
            let dir = PathBuf::from(dir);
            std::fs::create_dir_all(&dir)?;
            let name = abs.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            let mut to = dir.join(&name);
            let mut n = 1;
            while to.exists() {
                n += 1;
                to = dir.join(format!("{n} {name}"));
            }
            return std::fs::rename(abs, to);
        }
        system_trash(abs)
    }
}

#[cfg(target_os = "macos")]
fn system_trash(abs: &Path) -> std::io::Result<()> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    let c = std::ffi::CString::new(abs.to_string_lossy().as_bytes()).map_err(|_| std::io::Error::other("bad path"))?;
    unsafe {
        let path: Option<Retained<AnyObject>> = msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()];
        let Some(path) = path else { return Err(std::io::Error::other("no path string")) };
        let url: Option<Retained<AnyObject>> = msg_send![class!(NSURL), fileURLWithPath: &*path];
        let Some(url) = url else { return Err(std::io::Error::other("no file URL")) };
        let fm: Option<Retained<AnyObject>> = msg_send![class!(NSFileManager), defaultManager];
        let Some(fm) = fm else { return Err(std::io::Error::other("no file manager")) };
        let ok: bool = msg_send![&*fm, trashItemAtURL: &*url, resultingItemURL: std::ptr::null_mut::<*mut AnyObject>(), error: std::ptr::null_mut::<*mut AnyObject>()];
        if ok { Ok(()) } else { Err(std::io::Error::other("the system trash refused the item")) }
    }
}

#[cfg(not(target_os = "macos"))]
fn system_trash(_abs: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other("no system trash on this platform"))
}

// ---------------------------------------------------------------- trash commands (§4)

fn iso_local(ns: i128) -> String {
    let secs = (ns / 1_000_000_000) as i64;
    let nanos = (ns % 1_000_000_000) as u32;
    let utc = chrono::DateTime::from_timestamp(secs, nanos).unwrap_or_default();
    utc.with_timezone(&chrono::Local).format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

fn moved_dto(m: Vec<tegg_core::Moved>) -> Vec<MovedDto> {
    m.into_iter().map(|m| MovedDto { from: m.from, to: m.to }).collect()
}

fn removal_dto(r: tegg_core::TrashRemoval) -> TrashRemovalDto {
    TrashRemovalDto { removed: r.removed, failed: r.failed.into_iter().map(|(path, reason)| TrashFailedDto { path, reason }).collect() }
}

#[tauri::command]
pub(crate) async fn trash_list(state: State<'_, AppState>) -> Result<Vec<TrashEntryDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .trash_list()
        .into_iter()
        .map(|e| TrashEntryDto {
            path: e.path,
            kind: match e.kind {
                TrashKind::Object => "object",
                TrashKind::File => "file",
                TrashKind::Folder => "folder",
            }
            .into(),
            original: e.original,
            folder: e.folder,
            title: e.title,
            type_key: e.type_key,
            files: e.files,
            count: e.count,
            trashed_at: iso_local(e.trashed_ns),
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn object_trash(state: State<'_, AppState>, path: String, base: VersionDto) -> Result<Vec<MovedDto>, IpcError> {
    let core = core(&state)?;
    let base = version_from(&base)?;
    match core.trash_object(&path, &base) {
        Ok(m) => Ok(moved_dto(m)),
        Err(CoreError::Invalid { reason }) => Err(err("Invalid", reason)),
        Err(e) => Err(core_err(e)),
    }
}

#[tauri::command]
pub(crate) async fn trash_restore(state: State<'_, AppState>, path: String) -> Result<Vec<MovedDto>, IpcError> {
    let core = core(&state)?;
    core.trash_restore(&path).map(moved_dto).map_err(core_err)
}

#[tauri::command]
pub(crate) async fn trash_delete(state: State<'_, AppState>, paths: Vec<String>) -> Result<TrashRemovalDto, IpcError> {
    let core = core(&state)?;
    Ok(removal_dto(core.trash_delete(&paths, &MacTrash)))
}

#[tauri::command]
pub(crate) async fn trash_empty(state: State<'_, AppState>) -> Result<TrashRemovalDto, IpcError> {
    let core = core(&state)?;
    Ok(removal_dto(core.trash_empty(&MacTrash)))
}

// ---------------------------------------------------------------- media commands (§4)

fn added_dto(a: MediaAdded) -> MediaAddedDto {
    MediaAddedDto {
        file: a.file,
        object: a.object,
        title: a.title,
        embed: a.embed,
        media_type: a.info.media_type.into(),
        size: a.version.size as u32,
        width: a.info.width,
        height: a.info.height,
        pages: a.info.pages,
    }
}

/// The added object's own `size` is the media file's: read it back from the core's answer.
fn added(core: &Core, req: MediaAdd) -> Result<MediaAddedDto, CoreError> {
    let size = req.bytes.len() as u32;
    let a = core.media_add(req)?;
    let mut d = added_dto(a);
    d.size = size;
    Ok(d)
}

fn media_err(e: CoreError) -> IpcError {
    match e {
        CoreError::Refused => err("Refused", "not an image or PDF Tegg can add"),
        CoreError::TooLarge => err("TooLarge", "larger than 200 MB"),
        other => core_err(other),
    }
}

fn header(req: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    let v = req.headers().get(name)?.to_str().ok()?;
    let d = percent_decode(v);
    (!d.is_empty()).then_some(d)
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn owner(path: Option<String>, title: Option<String>) -> Option<OwnerRef> {
    let path = path?;
    let title = title.unwrap_or_else(|| path.rsplit('/').next().unwrap_or(&path).trim_end_matches(".md").to_string());
    Some(OwnerRef { path, title })
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[tauri::command]
pub(crate) async fn media_add(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<MediaAddedDto, IpcError> {
    let core = core(&state)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err(err("Io", "expected the file's bytes")) };
    if bytes.len() as u64 > MAX_BYTES {
        return Err(err("TooLarge", "larger than 200 MB"));
    }
    let name = header(&request, "x-tegg-name").unwrap_or_else(|| "Pasted image".into());
    let req = MediaAdd {
        bytes: bytes.clone(),
        name,
        owner: owner(header(&request, "x-tegg-owner"), header(&request, "x-tegg-owner-title")),
        now: SystemTime::now(),
        zone_date: header(&request, "x-tegg-date").unwrap_or_else(today),
    };
    added(&core, req).map_err(media_err)
}

/// Reads a dropped or picked file for adding: a folder or an unreadable file is refused.
fn read_path(path: &str) -> Result<(String, Vec<u8>), (String, &'static str)> {
    let p = Path::new(path);
    let name = nfc(&p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
    let md = std::fs::metadata(p).map_err(|_| (name.clone(), "Io"))?;
    if md.is_dir() {
        return Err((name, "Refused"));
    }
    if md.len() > MAX_BYTES {
        return Err((name, "TooLarge"));
    }
    std::fs::read(p).map(|b| (name.clone(), b)).map_err(|_| (name, "Io"))
}

#[tauri::command]
pub(crate) async fn media_add_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
    owner: Option<String>,
    owner_title: Option<String>,
    date: String,
) -> Result<Vec<MediaAddResultDto>, IpcError> {
    let core = core(&state)?;
    let mut out = Vec::new();
    for p in paths {
        let (name, bytes) = match read_path(&p) {
            Ok(x) => x,
            Err((name, e)) => {
                out.push(MediaAddResultDto::Err { error: e.into(), name });
                continue;
            }
        };
        let req = MediaAdd { bytes, name: name.clone(), owner: self::owner(owner.clone(), owner_title.clone()), now: SystemTime::now(), zone_date: date.clone() };
        out.push(match added(&core, req) {
            Ok(ok) => MediaAddResultDto::Ok { ok },
            Err(CoreError::Refused) => MediaAddResultDto::Err { error: "Refused".into(), name },
            Err(CoreError::TooLarge) => MediaAddResultDto::Err { error: "TooLarge".into(), name },
            Err(_) => MediaAddResultDto::Err { error: "Io".into(), name },
        });
    }
    Ok(out)
}

const IMAGE_EXT: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"];

fn pick(app: &AppHandle, kind: &str) -> Vec<String> {
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if let Ok(files) = std::env::var("TEGG_TEST_PICK_FILES") {
            return files.split(':').filter(|s| !s.is_empty()).map(str::to_string).collect();
        }
    }
    use tauri_plugin_dialog::DialogExt;
    let mut d = app.dialog().file();
    d = match kind {
        "image" => d.add_filter("Images", &IMAGE_EXT),
        "pdf" => d.add_filter("PDF", &["pdf"]),
        _ => d.add_filter("Images and PDFs", &[&IMAGE_EXT[..], &["pdf"]].concat()),
    };
    let (tx, rx) = std::sync::mpsc::channel();
    d.pick_files(move |p| {
        let files = p.unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let _ = tx.send(files);
    });
    rx.recv().unwrap_or_default()
}

#[tauri::command]
pub(crate) async fn media_pick(app: AppHandle, kind: String) -> Result<Vec<String>, IpcError> {
    Ok(pick(&app, &kind))
}

/// `open <path>` or `reveal <path>` to `TEGG_TEST_REVEAL`; else the system.
fn open_or_reveal(state: &State<'_, AppState>, path: &str, reveal: bool) -> Result<(), IpcError> {
    let core = core(state)?;
    let abs = core.vault().root().join(nfc(path));
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if let Some(file) = test_var("TEGG_TEST_REVEAL") {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| err("Io", e))?;
            return f.write_all(format!("{} {}\n", if reveal { "reveal" } else { "open" }, nfc(path)).as_bytes()).map_err(|e| err("Io", e));
        }
        return Ok(());
    }
    let mut c = std::process::Command::new("/usr/bin/open");
    if reveal {
        c.arg("-R");
    }
    c.arg(&abs).spawn().map(|_| ()).map_err(|e| err("Io", e))
}

#[tauri::command]
pub(crate) async fn media_open(state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    open_or_reveal(&state, &path, false)
}

#[tauri::command]
pub(crate) async fn media_reveal(state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    open_or_reveal(&state, &path, true)
}

// ---------------------------------------------------------------- capture staging (§5)

struct Staged {
    name: String,
    bytes: Vec<u8>,
    media_type: &'static str,
    at: Instant,
}

static STAGED: Mutex<Option<HashMap<String, Staged>>> = Mutex::new(None);

fn stage(name: String, bytes: Vec<u8>) -> StagedMediaResultDto {
    if bytes.len() as u64 > MAX_BYTES {
        return StagedMediaResultDto::Err { error: "TooLarge".into(), name };
    }
    let Some(info) = media_info(&bytes) else { return StagedMediaResultDto::Err { error: "Refused".into(), name } };
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let token = format!("s{:x}{:x}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst));
    let dto = StagedMediaDto {
        token: token.clone(),
        name: name.clone(),
        media_type: info.media_type.into(),
        size: bytes.len() as u32,
        width: info.width,
        height: info.height,
        pages: info.pages,
    };
    let mut s = STAGED.lock().unwrap_or_else(|p| p.into_inner());
    let map = s.get_or_insert_with(HashMap::new);
    // Tokens older than 10 minutes are dropped (§5).
    map.retain(|_, v| v.at.elapsed().as_secs() < 600);
    map.insert(token, Staged { name, bytes, media_type: info.media_type, at: Instant::now() });
    StagedMediaResultDto::Ok { ok: dto }
}

/// Takes the staged files of `tokens` (in order) out of memory; unknown tokens are skipped.
pub(crate) fn take_staged(tokens: &[String]) -> Vec<(String, Vec<u8>)> {
    let mut s = STAGED.lock().unwrap_or_else(|p| p.into_inner());
    let Some(map) = s.as_mut() else { return Vec::new() };
    tokens.iter().filter_map(|t| map.remove(t)).map(|v| (v.name, v.bytes)).collect()
}

#[tauri::command]
pub(crate) async fn capture_media_add(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Vec<StagedMediaResultDto>, IpcError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => {
            let name = header(&request, "x-tegg-name").unwrap_or_else(|| "Pasted image".into());
            Ok(vec![stage(name, bytes.clone())])
        }
        tauri::ipc::InvokeBody::Json(v) => {
            let paths: Vec<String> = if v.get("pick").and_then(|p| p.as_bool()) == Some(true) {
                pick(&app, "any")
            } else {
                v.get("paths").and_then(|p| p.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
            };
            Ok(paths
                .into_iter()
                .map(|p| match read_path(&p) {
                    Ok((name, bytes)) => stage(name, bytes),
                    Err((name, e)) => StagedMediaResultDto::Err { error: e.into(), name },
                })
                .collect())
        }
    }
}

/// §5: writes the staged files of a capture (pairs first, before its note); the embed texts in order.
pub(crate) fn write_staged(core: &Core, tokens: &[String], owner_path: &str, owner_title: &str, date: &str) -> Result<Vec<String>, IpcError> {
    let mut embeds = Vec::new();
    for (name, bytes) in take_staged(tokens) {
        let req = MediaAdd {
            bytes,
            name: name.clone(),
            owner: (!owner_title.trim().is_empty()).then(|| OwnerRef { path: owner_path.to_string(), title: owner_title.to_string() }),
            now: SystemTime::now(),
            zone_date: date.to_string(),
        };
        match core.media_add(req) {
            Ok(a) => embeds.push(a.embed),
            Err(_) => return Err(err("Io", format!("Couldn't add \"{name}\""))),
        }
    }
    Ok(embeds)
}

// ---------------------------------------------------------------- the media scheme (§3.6)

/// The answer of the `tegg-media://` scheme (ms6-trash-media §3.6).
#[doc(hidden)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

fn not_found() -> MediaResponse {
    MediaResponse { status: 404, content_type: None, body: Vec::new() }
}

/// §3.6 (D-622): what the `tegg-media://` scheme answers for one request of the webview `label`, with the open
/// vault at `vault_root`; `range` is the HTTP `Range` header, if any.
#[doc(hidden)]
pub fn media_scheme_probe(vault_root: &Path, method: &str, uri: &str, label: &str, range: Option<&str>) -> MediaResponse {
    if method != "GET" {
        return not_found();
    }
    let rest = uri.split_once("://").map(|(_, r)| r).unwrap_or(uri);
    let rest = rest.split_once('/').map(|(_, p)| p).unwrap_or("");
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let raw = rest.to_string();
    if let Some(token) = raw.strip_prefix("stage/") {
        if label != "capture" {
            return not_found();
        }
        let s = STAGED.lock().unwrap_or_else(|p| p.into_inner());
        return match s.as_ref().and_then(|m| m.get(&percent_decode(token))) {
            Some(st) => MediaResponse { status: 200, content_type: Some(st.media_type.into()), body: st.bytes.clone() },
            None => not_found(),
        };
    }
    let path = nfc(&percent_decode(&raw));
    if path.is_empty() || path.starts_with('/') || path.split('/').any(|s| s == ".." || s == "." || s.is_empty()) {
        return not_found();
    }
    if path == ".tegg" || path.starts_with(".tegg/") {
        return not_found();
    }
    let Ok(root) = vault_root.canonicalize() else { return not_found() };
    let Ok(abs) = root.join(&path).canonicalize() else { return not_found() };
    if !abs.starts_with(&root) || abs.starts_with(root.join(".tegg")) || !abs.is_file() {
        return not_found();
    }
    let Ok(bytes) = std::fs::read(&abs) else { return not_found() };
    let Some(info) = media_info(&bytes) else { return not_found() };
    if let (Some(r), "application/pdf") = (range, info.media_type) {
        if let Some((a, b)) = r.trim().strip_prefix("bytes=").and_then(|x| x.split_once('-')) {
            let len = bytes.len();
            let start: usize = a.trim().parse().unwrap_or(0);
            let end: usize = b.trim().parse::<usize>().map(|e| e.min(len.saturating_sub(1))).unwrap_or(len.saturating_sub(1));
            if start <= end && start < len {
                return MediaResponse { status: 206, content_type: Some(info.media_type.into()), body: bytes[start..=end].to_vec() };
            }
        }
    }
    MediaResponse { status: 200, content_type: Some(info.media_type.into()), body: bytes }
}

/// The registered handler (§3.6): answers on a thread through `media_scheme_probe`.
pub(crate) fn media_scheme<R: tauri::Runtime>(ctx: tauri::UriSchemeContext<'_, R>, request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let label = ctx.webview_label().to_string();
    std::thread::spawn(move || {
        let root = app.state::<AppState>().core.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|c| c.vault().root().to_path_buf());
        let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(str::to_string);
        let r = match root {
            Some(root) => media_scheme_probe(&root, request.method().as_str(), &request.uri().to_string(), &label, range.as_deref()),
            None if request.uri().path().starts_with("/stage/") => media_scheme_probe(Path::new("/nonexistent"), request.method().as_str(), &request.uri().to_string(), &label, range.as_deref()),
            None => not_found(),
        };
        let mut b = tauri::http::Response::builder().status(r.status).header("Cache-Control", "no-cache").header("Access-Control-Allow-Origin", "*");
        if let Some(ct) = r.content_type {
            b = b.header("Content-Type", ct);
        }
        responder.respond(b.body(r.body).unwrap_or_default());
    });
}
