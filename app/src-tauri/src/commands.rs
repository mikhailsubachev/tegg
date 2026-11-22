//! docs/contracts/android-shell.md §2.1 (AR-03 AC-9, RA2): the IPC command lists per platform, in source order of the
//! desktop `generate_handler!`. Compiled on every target. Red-commit stub (compile only): the lists are empty.

/// Every command the desktop registers (unchanged from `7ff0fc0b`).
pub const DESKTOP: &[&str] = &[];
/// `DESKTOP` minus RA2's groups P1…P5, J, V, O, then `ANDROID_ONLY`.
pub const ANDROID: &[&str] = &[];
/// The four Android-only commands.
pub const ANDROID_ONLY: &[&str] = &[];
