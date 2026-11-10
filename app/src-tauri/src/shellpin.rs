//! Slice PIN IPC (docs/contracts/v1-pinned.md §2; FR-HOM-02, FR-SYN-03 AC-26): `pins_get` (read-only, one call resolves
//! every row) and `pins_apply` (one atomic write of `.tegg/pinned.yml` per call, with the version last read as base).
//! The DTOs are the contract's. Errors: `Conflict` (payload `disk`: the pins as on disk now), `Gone`, `NewerVersion`,
//! `Unreadable`, `NotPinnable`, `NoSuchPin`, `Io`, `NoVault`.

use serde::{Deserialize, Serialize};
use tauri::State;

use tegg_core::pinned::{PinError, PinOp, PinRequest, PinRow, PinState, PinTarget, Pins, PinsFileState};
use tegg_core::{Core, CoreError, VaultError};

use crate::dto::VersionDto;
use crate::{core, core_err, err, version_dto, version_from, AppState, IpcError};

/// What a pin item stores (§2 `PinStoredDto`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PinStoredDto {
    Object { id: Option<String>, path: Option<String> },
    Tag { key: String },
    Type { key: String },
    /// v1-queries §1.9 (slice Q).
    Query { name: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct PinRowDto {
    pub index: usize,
    pub target: PinStoredDto,
    /// `ok`, `pending`, `trashed`, `missing`, `noObjects`.
    pub state: String,
    pub path: Option<String>,
    pub title: Option<String>,
    pub r#type: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PinsErrorDto {
    pub line: Option<u32>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinsDto {
    pub version: Option<VersionDto>,
    /// `missing`, `ok`, `newer`, `unreadable`.
    pub state: String,
    /// Only for `unreadable`.
    pub error: Option<PinsErrorDto>,
    pub patchable: bool,
    pub index_ready: bool,
    pub rows: Vec<PinRowDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PinRequestDto {
    Object { path: String },
    Tag { key: String },
    Type { key: String },
    Query { name: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum PinOpDto {
    Pin { target: PinRequestDto, at: Option<usize> },
    Unpin { index: usize },
    Move { from: usize, to: usize },
}

/// The PIN fields of an `IpcError` (flattened into it): `disk` with `Conflict`.
#[derive(Debug, Clone, Serialize)]
pub struct PinsErrorExtra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk: Option<Box<PinsDto>>,
}

fn target_dto(t: PinTarget) -> PinStoredDto {
    match t {
        PinTarget::Object { id, path } => PinStoredDto::Object { id, path },
        PinTarget::Tag { key } => PinStoredDto::Tag { key },
        PinTarget::Type { key } => PinStoredDto::Type { key },
        PinTarget::Query { name } => PinStoredDto::Query { name },
    }
}

fn row_dto(r: PinRow) -> PinRowDto {
    let state = match r.state {
        PinState::Ok => "ok",
        PinState::Pending => "pending",
        PinState::Trashed => "trashed",
        PinState::Missing => "missing",
        PinState::NoObjects => "noObjects",
    };
    PinRowDto { index: r.index, target: target_dto(r.target), state: state.into(), path: r.path, title: r.title, r#type: r.r#type, date: r.date }
}

pub(crate) fn pins_dto(p: Pins) -> PinsDto {
    let (state, error) = match p.state {
        PinsFileState::Missing => ("missing", None),
        PinsFileState::Ok => ("ok", None),
        PinsFileState::Newer { .. } => ("newer", None),
        PinsFileState::Unreadable { line, reason } => ("unreadable", Some(PinsErrorDto { line, reason })),
    };
    PinsDto {
        version: p.version.as_ref().map(version_dto),
        state: state.into(),
        error,
        patchable: p.patchable,
        index_ready: p.index_ready,
        rows: p.rows.into_iter().map(row_dto).collect(),
    }
}

fn op_from(op: PinOpDto) -> PinOp {
    match op {
        PinOpDto::Pin { target, at } => PinOp::Pin {
            target: match target {
                PinRequestDto::Object { path } => PinRequest::Object { path },
                PinRequestDto::Tag { key } => PinRequest::Tag { key },
                PinRequestDto::Type { key } => PinRequest::Type { key },
                PinRequestDto::Query { name } => PinRequest::Query { name },
            },
            at,
        },
        PinOpDto::Unpin { index } => PinOp::Unpin { index },
        PinOpDto::Move { from, to } => PinOp::Move { from, to },
    }
}

/// §2's error kinds; a `Conflict` carries the pins as on disk now.
pub(crate) fn pins_err(core: &Core, e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => {
            IpcError { pins: Some(PinsErrorExtra { disk: Some(Box::new(pins_dto(core.pins()))) }), ..err("Conflict", "the pins file changed on disk") }
        }
        CoreError::Pin(p) => match p {
            PinError::NewerVersion => err("NewerVersion", "made by a newer version of Tegg"),
            PinError::Unreadable => err("Unreadable", "the pins file can't be read"),
            PinError::NotPinnable => err("NotPinnable", "this can't be pinned"),
            PinError::NoSuchPin => err("NoSuchPin", "no such pin"),
        },
        CoreError::Vault(VaultError::Gone) => err("Gone", "the pins file was deleted"),
        // Everything else is `Io` (§2): the UI shows `pinned.saveFailed`.
        other => match core_err(other) {
            e if e.kind == "Io" => e,
            e => err("Io", e.message),
        },
    }
}

#[tauri::command]
pub async fn pins_get(state: State<'_, AppState>) -> Result<PinsDto, IpcError> {
    Ok(pins_dto(core(&state)?.pins()))
}

#[tauri::command]
pub async fn pins_apply(state: State<'_, AppState>, base: Option<VersionDto>, op: PinOpDto) -> Result<PinsDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    core.pins_apply(base, op_from(op)).map(pins_dto).map_err(|e| pins_err(&core, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_dtos_serialize_as_the_contract_says() {
        let row = PinRowDto { index: 0, target: PinStoredDto::Object { id: None, path: Some("Pages/A.md".into()) }, state: "noObjects".into(), path: None, title: None, r#type: None, date: None };
        let dto = PinsDto { version: None, state: "ok".into(), error: None, patchable: true, index_ready: false, rows: vec![row] };
        let e = IpcError { pins: Some(PinsErrorExtra { disk: Some(Box::new(dto)) }), ..err("Conflict", "x") };
        let v = serde_json::to_value(&e).expect("serializes");
        assert_eq!(v["kind"], "Conflict");
        assert_eq!((v["disk"]["state"].as_str(), v["disk"]["indexReady"].as_bool()), (Some("ok"), Some(false)), "{v}");
        let r = &v["disk"]["rows"][0];
        assert_eq!((r["target"]["kind"].as_str(), r["target"]["id"].is_null(), r["type"].is_null()), (Some("object"), true, true), "{v}");
        let v = serde_json::to_value(err("Gone", "x")).expect("serializes");
        assert!(v.get("disk").is_none(), "{v}");
        let op: PinOpDto = serde_json::from_value(serde_json::json!({ "op": "pin", "target": { "kind": "tag", "key": "účty" }, "at": null })).expect("pin op");
        assert!(matches!(op_from(op), PinOp::Pin { target: PinRequest::Tag { .. }, at: None }));
        let op: PinOpDto = serde_json::from_value(serde_json::json!({ "op": "move", "from": 1, "to": 3 })).expect("move op");
        assert!(matches!(op_from(op), PinOp::Move { from: 1, to: 3 }));
    }
}
