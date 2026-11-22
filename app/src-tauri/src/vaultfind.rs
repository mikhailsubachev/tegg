//! docs/contracts/android-shell.md §4.2, §4.3 (FR-VLT-01 AC-24…AC-26, RA4, RA6): finding vaults in shared storage and
//! reading a typed path. Compiled on every target. Red-commit stub (compile only): no behaviour yet.

use std::path::{Path, PathBuf};

/// One vault `find_vaults` found: the NFC folder name and the on-disk path.
pub struct FoundVault {
    pub name: String,
    pub path: PathBuf,
}

/// Why `resolve_typed_path` refuses a path (RA4; the `IpcError` kinds `FullPath`, `OutsideShared`, `NotFound`,
/// `NotATeggVault`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathRefusal {
    FullPath,
    OutsideShared,
    NotFound,
    NotAVault,
}

/// Red-commit stub: finds nothing.
pub fn find_vaults(_root: &Path) -> Vec<FoundVault> {
    Vec::new()
}

/// Red-commit stub: refuses everything as `NotFound`.
pub fn resolve_typed_path(_input: &str, _shared_root: &Path, _private_root: &Path, _need_vault: bool) -> Result<PathBuf, PathRefusal> {
    Err(PathRefusal::NotFound)
}
