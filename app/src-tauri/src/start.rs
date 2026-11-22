//! docs/contracts/android-shell.md §5.1 (FR-VLT-01 AC-18…AC-22, RA3): the start state on Android, as a pure function.
//! Compiled on every target. Red-commit stub (compile only): always `None`.

use std::path::Path;

use crate::dto::VaultInfo;

/// RA3's states.
pub enum StartState {
    NeedsAccess { path: Option<String> },
    Opening { name: String, path: String },
    Open { vault: VaultInfo },
    Failed { path: String, kind: String },
    None,
}

/// Red-commit stub.
pub fn start_state(_access: bool, _remembered: Option<&Path>, _opened: Option<Result<VaultInfo, String>>) -> StartState {
    StartState::None
}
