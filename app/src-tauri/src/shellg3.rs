//! Slice G3 IPC (docs/contracts/v1-graph.md §16.2): `graph_presets_get` (read-only) and `graph_presets_apply` (one
//! atomic write of `.tegg/graph.yml` per call, with the version last read as base). The DTOs are the contract's.
//! Errors (§16.2): `Conflict` (payload `disk`: the presets as on disk now), `Gone`, `NameEmpty`, `NameTaken`
//! (`existing`), `NameTooLong`, `NameControl`, `NoSuchPreset`, `NewerVersion`, `Unreadable`, `NotUtf8`, `Io`.

use serde::{Deserialize, Serialize};
use tauri::State;

use tegg_core::{Core, CoreError, GraphPresets, PresetError, PresetOp, PresetsState, VaultError};

use crate::dto::VersionDto;
use crate::{core, core_err, err, version_dto, version_from, AppState, IpcError};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPresetDto {
    pub name: String,
    pub hidden_types: Vec<String>,
    pub hidden_kinds: Vec<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct PresetsErrorDto {
    pub line: Option<u32>,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct GraphPresetsDto {
    pub version: Option<VersionDto>,
    /// `missing`, `ok`, `newer`, `unreadable`.
    pub state: String,
    /// Only for `unreadable`.
    pub error: Option<PresetsErrorDto>,
    pub presets: Vec<GraphPresetDto>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum PresetOpDto {
    Save {
        name: String,
        #[serde(rename = "hiddenTypes")]
        hidden_types: Vec<String>,
        #[serde(rename = "hiddenKinds")]
        hidden_kinds: Vec<String>,
    },
    Update {
        name: String,
        #[serde(rename = "hiddenTypes")]
        hidden_types: Vec<String>,
        #[serde(rename = "hiddenKinds")]
        hidden_kinds: Vec<String>,
    },
    Rename { from: String, to: String },
    Delete { name: String },
}

/// The G3 fields of an `IpcError` (flattened into it): `disk` with `Conflict`, `existing` with `NameTaken`.
#[derive(Debug, Clone, Serialize)]
pub struct PresetsErrorExtra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk: Option<Box<GraphPresetsDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing: Option<String>,
}

pub(crate) fn presets_dto(p: GraphPresets) -> GraphPresetsDto {
    let (state, error) = match p.state {
        PresetsState::Missing => ("missing", None),
        PresetsState::Ok => ("ok", None),
        PresetsState::Newer { .. } => ("newer", None),
        PresetsState::Unreadable { line, reason } => ("unreadable", Some(PresetsErrorDto { line, reason })),
    };
    GraphPresetsDto {
        version: p.version.as_ref().map(version_dto),
        state: state.into(),
        error,
        presets: p.presets.into_iter().map(|x| GraphPresetDto { name: x.name, hidden_types: x.hidden_types, hidden_kinds: x.hidden_kinds }).collect(),
    }
}

fn op_from(op: PresetOpDto) -> PresetOp {
    match op {
        PresetOpDto::Save { name, hidden_types, hidden_kinds } => PresetOp::Save { name, hidden_types, hidden_kinds },
        PresetOpDto::Update { name, hidden_types, hidden_kinds } => PresetOp::Update { name, hidden_types, hidden_kinds },
        PresetOpDto::Rename { from, to } => PresetOp::Rename { from, to },
        PresetOpDto::Delete { name } => PresetOp::Delete { name },
    }
}

/// §16.2's error kinds; a `Conflict` carries the presets as on disk now.
pub(crate) fn presets_err(core: &Core, e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => IpcError {
            presets: Some(PresetsErrorExtra { disk: Some(Box::new(presets_dto(core.graph_presets()))), existing: None }),
            ..err("Conflict", "the presets file changed on disk")
        },
        CoreError::Preset(p) => match p {
            PresetError::NameEmpty => err("NameEmpty", "the name is empty"),
            PresetError::NameTaken { existing } => {
                IpcError { presets: Some(PresetsErrorExtra { disk: None, existing: Some(existing.clone()) }), ..err("NameTaken", format!("a preset named {existing} exists")) }
            }
            PresetError::NameTooLong => err("NameTooLong", "the name has more than 100 characters"),
            PresetError::NameControl => err("NameControl", "the name holds a control character"),
            PresetError::NoSuchPreset => err("NoSuchPreset", "no such preset"),
            PresetError::NewerVersion => err("NewerVersion", "made by a newer version of Tegg"),
            PresetError::Unreadable => err("Unreadable", "the presets file can't be read"),
        },
        // `Gone`, `NotUtf8`, and `Io` for everything else.
        other => core_err(other),
    }
}

#[tauri::command]
pub async fn graph_presets_get(state: State<'_, AppState>) -> Result<GraphPresetsDto, IpcError> {
    Ok(presets_dto(core(&state)?.graph_presets()))
}

#[tauri::command]
pub async fn graph_presets_apply(state: State<'_, AppState>, base: Option<VersionDto>, op: PresetOpDto) -> Result<GraphPresetsDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    core.graph_presets_apply(base, op_from(op)).map(presets_dto).map_err(|e| presets_err(&core, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_error_payloads_serialize_as_the_contract_says() {
        let dto = GraphPresetsDto { version: None, state: "ok".into(), error: None, presets: vec![] };
        let e = IpcError { presets: Some(PresetsErrorExtra { disk: Some(Box::new(dto)), existing: None }), ..err("Conflict", "x") };
        let v = serde_json::to_value(&e).expect("serializes");
        assert_eq!(v["kind"], "Conflict");
        assert_eq!(v["disk"]["state"], "ok", "{v}");
        assert!(v["disk"]["presets"].is_array() && v.get("existing").is_none(), "{v}");
        let e = IpcError { presets: Some(PresetsErrorExtra { disk: None, existing: Some("Bez štítků".into()) }), ..err("NameTaken", "x") };
        let v = serde_json::to_value(&e).expect("serializes");
        assert_eq!((v["existing"].as_str(), v.get("disk").is_none()), (Some("Bez štítků"), true), "{v}");
        let v = serde_json::to_value(err("Gone", "x")).expect("serializes");
        assert!(v.get("disk").is_none() && v.get("existing").is_none(), "{v}");
    }
}
