//! docs/contracts/android-shell.md §4.1 (FR-STO-07 AC-12, F7): where machine-local data lives, from the platform.
//! Compiled on every target.

use std::path::PathBuf;

use tegg_vault::AppDirs;

/// What `app_dirs_for` needs to know about the platform.
pub enum Platform {
    MacOs { home: PathBuf, preview: bool, test: bool, app_support: Option<String> },
    /// `files_dir` is `Context.getFilesDir()` from the platform (CP-2 → D-2037), never a constant or `$HOME`.
    Android { files_dir: PathBuf },
}

/// The machine-local root (FR-STO-07): Application Support on the Mac (the release build keeps the preview's folder,
/// D-118, D-1514; `TEGG_APP_SUPPORT` only with `TEGG_TEST=1`), the app's private files folder on Android.
pub fn app_dirs_for(p: &Platform) -> AppDirs {
    match p {
        Platform::MacOs { home, preview, test, app_support } => {
            let root = app_support.as_deref().filter(|s| *test && !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| {
                home.join("Library/Application Support").join(if *preview { "Tegg Preview" } else { "Tegg" })
            });
            AppDirs { root }
        }
        Platform::Android { files_dir } => AppDirs { root: files_dir.clone() },
    }
}
