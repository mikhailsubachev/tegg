//! docs/contracts/android-shell.md §5.1 (FR-VLT-01 AC-18…AC-22, RA3): the start state on Android, as a pure function.
//! Compiled on every target.

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

/// The state for the access check, the remembered vault and the open result so far. Access comes first: without it
/// no open result counts (F5, D-2016), so a vault never shows empty.
pub fn start_state(access: bool, remembered: Option<&Path>, opened: Option<Result<VaultInfo, String>>) -> StartState {
    let path = remembered.map(|p| p.to_string_lossy().into_owned());
    if !access {
        return StartState::NeedsAccess { path };
    }
    let Some(remembered) = remembered else { return StartState::None };
    let path = path.unwrap_or_default();
    match opened {
        None => StartState::Opening { name: remembered.file_name().map(|n| tegg_format::nfc(&n.to_string_lossy())).unwrap_or_default(), path },
        Some(Ok(vault)) => StartState::Open { vault },
        Some(Err(kind)) => StartState::Failed { path, kind },
    }
}
