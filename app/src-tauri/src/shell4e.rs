//! Slice 4E-1 IPC (ms4-jobs §14.7): the type move with its R101 plan, the folder preview, the tidy job on demand and
//! the UI's transform bridge being ready (D-819). The folder save goes through `type_patch` (lib.rs, D-822).

use serde::{Deserialize, Serialize};
use tauri::State;
use tegg_core::tegg_jobs::{JobOp, MapTarget, PropertyMap};

use crate::dto::JobStartDto;
use crate::{core, job_err, AppState, IpcError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRowDto {
    pub from: String,
    pub name: String,
    pub kind: String,
    pub value: Option<String>,
    pub default: String,
    /// D-821: the targets of the same or a wider value type, with their display names.
    pub offered: Vec<OfferDto>,
    pub fixed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OfferDto {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeMovePlanDto {
    pub rows: Vec<MapRowDto>,
    pub needs_dialog: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapDto {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMaybeDto {
    pub job_id: Option<u32>,
}

#[tauri::command]
pub async fn type_move_plan(state: State<'_, AppState>, paths: Vec<String>, to_type: String) -> Result<TypeMovePlanDto, IpcError> {
    let core = core(&state)?;
    let p = core.type_move_plan(&paths, &to_type);
    let rows = p
        .rows
        .into_iter()
        .map(|r| MapRowDto { from: r.from, name: r.name, kind: r.kind, value: r.value, default: r.default, offered: r.offered.into_iter().map(|(key, name)| OfferDto { key, name }).collect(), fixed: r.fixed })
        .collect();
    Ok(TypeMovePlanDto { rows, needs_dialog: p.needs_dialog })
}

#[tauri::command]
pub async fn type_move(state: State<'_, AppState>, paths: Vec<String>, to_type: String, mapping: Vec<MapDto>, review: bool, bulk: Option<bool>) -> Result<JobMaybeDto, IpcError> {
    let mapping = mapping
        .into_iter()
        .map(|m| PropertyMap { from: m.from, to: if m.to == "content" { MapTarget::Content } else { MapTarget::Property(m.to) } })
        .collect();
    let bulk = bulk.unwrap_or(false) || paths.len() > 1;
    let id = core(&state)?.jobs().start(JobOp::TypeMove { paths, to_type, mapping, review, bulk }).map_err(job_err)?;
    Ok(JobMaybeDto { job_id: Some(id as u32) })
}

#[derive(Debug, Clone, Serialize)]
pub struct CountDto {
    pub count: u32,
}

#[tauri::command]
pub async fn folder_move_preview(state: State<'_, AppState>, r#type: String, folder: String) -> Result<CountDto, IpcError> {
    Ok(CountDto { count: core(&state)?.folder_move_count(&r#type, &folder) as u32 })
}

#[tauri::command]
pub async fn tidy_now(state: State<'_, AppState>) -> Result<JobMaybeDto, IpcError> {
    let id = core(&state)?.jobs().start(JobOp::FolderMove { r#type: None, to_folder: None }).map_err(job_err)?;
    Ok(JobMaybeDto { job_id: Some(id as u32) })
}

/// D-819: the UI's `job:transform` bridge listens; the core's tidy job may start.
#[tauri::command]
pub async fn jobs_ready(state: State<'_, AppState>) -> Result<(), IpcError> {
    core(&state)?.jobs().set_ui_ready();
    Ok(())
}

// ---------------------------------------------------------------- slice 4E-2 (ms4-jobs §14.9.6)

/// Starts a `value-remove` job (FR-TYP-04 AC-6…AC-9) that stops in `confirm`; the dialog reads `job_plan`. Stub until
/// 4E-2 is built: answers `NotImplemented` (TS-I1).
#[tauri::command]
pub async fn value_remove_start(state: State<'_, AppState>, r#type: String, key: String) -> Result<JobStartDto, IpcError> {
    let _ = (core(&state)?, r#type, key);
    Err(job_err(tegg_core::tegg_jobs::JobError::NotImplemented))
}

/// Starts a `type-delete` job (FR-TYP-05 AC-6…AC-9) that stops in `confirm`. Stub until 4E-2 is built: answers
/// `NotImplemented` (TS-I1).
#[tauri::command]
pub async fn type_delete_start(state: State<'_, AppState>, r#type: String) -> Result<JobStartDto, IpcError> {
    let _ = (core(&state)?, r#type);
    Err(job_err(tegg_core::tegg_jobs::JobError::NotImplemented))
}
