//! Slice G3 (docs/contracts/v1-graph.md §16.1; FR-GRP-02, D-906, D-907; AP-920…AP-945 → D-1080…D-1105): the graph's
//! filter presets in the vault file `.tegg/graph.yml`. Platform-neutral (AR-03): reads and writes only through `Vault`.
//! Nothing about presets is in the index (AR-01).
//!
//! Red-test stub (TS-I1): the types and signatures of the contract, no behaviour. `graph_presets` answers an
//! `Unreadable` state and `graph_presets_apply` answers `Err(NotImplemented)`; nothing is read or written.

use tegg_vault::FileVersion;

use crate::{Core, CoreError};

/// The presets file (R118).
pub const GRAPH_YML: &str = ".tegg/graph.yml";
/// The current format version (AR-07).
pub const PRESETS_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphPreset {
    /// NFC, trimmed, as listed.
    pub name: String,
    /// Raw keys, NFC, file order; unknown keys kept (D-907).
    pub hidden_types: Vec<String>,
    /// Raw values; only link/relation/embed/tag take effect.
    pub hidden_kinds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetsState {
    Missing,
    Ok,
    Newer { version: u64 },
    Unreadable { line: Option<u32>, reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphPresets {
    /// The file's version as read; None when Missing.
    pub version: Option<FileVersion>,
    pub state: PresetsState,
    /// Listed presets in file order (R118 read rules); empty when Unreadable.
    pub presets: Vec<GraphPreset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetOp {
    Save { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Update { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Rename { from: String, to: String },
    Delete { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetError {
    NameEmpty,
    NameTaken { existing: String },
    NameTooLong,
    NameControl,
    NoSuchPreset,
    NewerVersion,
    Unreadable,
}

impl Core {
    /// Reads `.tegg/graph.yml`; never writes, never creates. (Stub: not implemented.)
    pub fn graph_presets(&self) -> GraphPresets {
        GraphPresets { version: None, state: PresetsState::Unreadable { line: None, reason: "NotImplemented".into() }, presets: Vec::new() }
    }

    /// One operation = at most one atomic write (FR-SYN-02). `base` is `GraphPresets.version` as last read.
    /// (Stub: not implemented.)
    pub fn graph_presets_apply(&self, base: Option<FileVersion>, op: PresetOp) -> Result<GraphPresets, CoreError> {
        let _ = (base, op);
        Err(CoreError::NotImplemented)
    }
}
