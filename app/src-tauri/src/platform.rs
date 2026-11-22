//! docs/contracts/android-shell.md §4.1 (FR-STO-07 AC-12, F7): where machine-local data lives, from the platform.
//! Compiled on every target. Red-commit stub (compile only): no behaviour yet.

use std::path::PathBuf;

use tegg_vault::AppDirs;

/// What `app_dirs_for` needs to know about the platform.
pub enum Platform {
    MacOs { home: PathBuf, preview: bool, test: bool, app_support: Option<String> },
    Android { files_dir: PathBuf },
}

/// Red-commit stub: answers an empty root.
pub fn app_dirs_for(_p: &Platform) -> AppDirs {
    AppDirs { root: PathBuf::new() }
}
