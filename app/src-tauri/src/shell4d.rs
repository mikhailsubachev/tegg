//! Slice 4D-lite shell (docs/contracts/ms4-tags.md §3, §4.4, §5.2; D-636…D-678): the tag, merge and backup IPC
//! commands of the main window. Stubs until the slice is built: every command answers `NotImplemented` (TS-I1).

use tauri::State;

use crate::dto::*;
use crate::{core, err, AppState};

fn not_yet<T>(what: &str) -> Result<T, IpcError> {
    Err(err("NotImplemented", &format!("{what} comes with 4D-lite (ms4-tags)")))
}

#[tauri::command]
pub async fn tag_objects(state: State<'_, AppState>, key: String) -> Result<Vec<TagObjectRowDto>, IpcError> {
    let _ = (core(&state)?, key);
    not_yet("tag_objects")
}

#[tauri::command]
pub async fn tag_usage(state: State<'_, AppState>, key: String) -> Result<TagUsageDto, IpcError> {
    let _ = (core(&state)?, key);
    not_yet("tag_usage")
}

#[tauri::command]
pub async fn tag_new_path(state: State<'_, AppState>, name: String) -> Result<TagNewPathDto, IpcError> {
    let _ = (core(&state)?, name);
    not_yet("tag_new_path")
}

#[tauri::command]
pub async fn tag_rename(state: State<'_, AppState>, from: String, to: String) -> Result<JobStartDto, IpcError> {
    let _ = (core(&state)?, from, to);
    not_yet("tag_rename")
}

#[tauri::command]
pub async fn tag_delete(state: State<'_, AppState>, key: String) -> Result<JobStartDto, IpcError> {
    let _ = (core(&state)?, key);
    not_yet("tag_delete")
}

#[tauri::command]
pub async fn merge_start(state: State<'_, AppState>, keep: String, others: Vec<String>) -> Result<JobStartDto, IpcError> {
    let _ = (core(&state)?, keep, others);
    not_yet("merge_start")
}

#[tauri::command]
pub async fn job_plan(state: State<'_, AppState>, job_id: u32) -> Result<Option<JobPlanDto>, IpcError> {
    let _ = (core(&state)?, job_id);
    Ok(None)
}

#[tauri::command]
pub async fn backup_reveal(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    let _ = (core(&state)?, name);
    not_yet("backup_reveal")
}
