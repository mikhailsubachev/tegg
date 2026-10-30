//! Slice G3 IPC (docs/contracts/v1-graph.md §16.2): `graph_presets_get` (read-only) and `graph_presets_apply` (one
//! atomic write of `.tegg/graph.yml` per call, with the version last read as base). The DTOs are the contract's.
//!
//! Red-test stub (TS-I1): both commands answer `NotImplemented`; the core's `graph_presets` /
//! `graph_presets_apply` are stubs too (crates/tegg-core/src/graph_presets.rs).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::dto::VersionDto;
use crate::{core, err, AppState, IpcError};

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

#[tauri::command]
pub async fn graph_presets_get(state: State<'_, AppState>) -> Result<GraphPresetsDto, IpcError> {
    let _core = core(&state)?;
    Err(err("NotImplemented", "graph presets are not built yet (G3)"))
}

#[tauri::command]
pub async fn graph_presets_apply(state: State<'_, AppState>, base: Option<VersionDto>, op: PresetOpDto) -> Result<GraphPresetsDto, IpcError> {
    let _core = core(&state)?;
    let _ = (base, op);
    Err(err("NotImplemented", "graph presets are not built yet (G3)"))
}
