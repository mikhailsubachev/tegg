//! Slice AND-2 (docs/contracts/android-phone.md §4.4, D-2074): the scheme check of `android_open_url`, pure and
//! compiled on every target so the host tests can run it. Compile-only stub for the red AC tests: it refuses every URL
//! until the build (no behaviour).

/// True exactly when the trimmed URL parses and its scheme, case-insensitive, is `http`, `https`, `mailto` or `tel`.
pub fn open_url_allowed(_url: &str) -> bool {
    false
}
