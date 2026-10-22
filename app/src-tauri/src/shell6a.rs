//! Slice 6A shell (docs/contracts/ms6-trash-media.md §1.1, §3.6, §4, §5; D-609…D-623): the trash and media IPC
//! commands of the main window, the capture window's `capture_media_add`, the `SystemTrash` of macOS
//! (`NSFileManager trashItemAtURL`) and the read-only `tegg-media://` scheme.
//! 6A stub (ms6-trash-media §4): every command fails with `NotImplemented`; the scheme probe answers 501 (TS-I1).

use std::path::Path;

use tauri::State;

use crate::dto::*;
use crate::{err, AppState};

fn not_yet<T>() -> Result<T, IpcError> {
    Err(err("NotImplemented", "6A stub (ms6-trash-media §4)"))
}

/// §4 `trash_list`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn trash_list(_state: State<'_, AppState>) -> Result<Vec<TrashEntryDto>, IpcError> {
    not_yet()
}

/// §4 `object_trash`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn object_trash(_state: State<'_, AppState>, path: String, base: VersionDto) -> Result<Vec<MovedDto>, IpcError> {
    let _ = (path, base);
    not_yet()
}

/// §4 `trash_restore`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn trash_restore(_state: State<'_, AppState>, path: String) -> Result<Vec<MovedDto>, IpcError> {
    let _ = path;
    not_yet()
}

/// §4 `trash_delete`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn trash_delete(_state: State<'_, AppState>, paths: Vec<String>) -> Result<TrashRemovalDto, IpcError> {
    let _ = paths;
    not_yet()
}

/// §4 `trash_empty`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn trash_empty(_state: State<'_, AppState>) -> Result<TrashRemovalDto, IpcError> {
    not_yet()
}

/// §4 `media_add`: raw body (the bytes) with the headers `x-tegg-name`, `x-tegg-owner`, `x-tegg-owner-title`,
/// `x-tegg-date`. 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn media_add(_state: State<'_, AppState>, _request: tauri::ipc::Request<'_>) -> Result<MediaAddedDto, IpcError> {
    not_yet()
}

/// §4 `media_add_paths` (drop and picker). 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn media_add_paths(
    _state: State<'_, AppState>,
    paths: Vec<String>,
    owner: Option<String>,
    owner_title: Option<String>,
    date: String,
) -> Result<Vec<MediaAddResultDto>, IpcError> {
    let _ = (paths, owner, owner_title, date);
    not_yet()
}

/// §4 `media_pick`: the system's open dialog (`TEGG_TEST_PICK_FILES` in tests). 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn media_pick(kind: String) -> Result<Vec<String>, IpcError> {
    let _ = kind;
    not_yet()
}

/// §4 `media_open` (`NSWorkspace openURL`; `TEGG_TEST_REVEAL` records `open <path>`). 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn media_open(_state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    let _ = path;
    not_yet()
}

/// §4 `media_reveal` (`activateFileViewerSelectingURLs`; `TEGG_TEST_REVEAL` records `reveal <path>`).
/// 6A stub (ms6-trash-media §4).
#[tauri::command]
pub(crate) async fn media_reveal(_state: State<'_, AppState>, path: String) -> Result<(), IpcError> {
    let _ = path;
    not_yet()
}

/// §5 `capture_media_add`: stages files in shell memory, never the vault. 6A stub (ms6-trash-media §5).
#[tauri::command]
pub(crate) async fn capture_media_add(_request: tauri::ipc::Request<'_>) -> Result<Vec<StagedMediaResultDto>, IpcError> {
    not_yet()
}

/// The answer of the `tegg-media://` scheme (ms6-trash-media §3.6).
#[doc(hidden)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// §3.6 (D-622): what the `tegg-media://` scheme answers for one request of the webview `label`, with the open
/// vault at `vault_root`; `range` is the HTTP `Range` header, if any. The scheme handler registered with
/// `register_asynchronous_uri_scheme_protocol` answers through this function (L4: `ac_media_scheme.rs`).
/// 6A stub (ms6-trash-media §3.6): `501` for everything.
#[doc(hidden)]
pub fn media_scheme_probe(vault_root: &Path, method: &str, uri: &str, label: &str, range: Option<&str>) -> MediaResponse {
    let _ = (vault_root, method, uri, label, range);
    MediaResponse { status: 501, content_type: None, body: Vec::new() }
}
