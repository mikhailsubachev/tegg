//! Slice AND-2 (docs/contracts/android-phone.md §4.4, D-2192): the scheme check of `android_open_url`, pure and
//! compiled on every target so the host tests can run it.

/// True exactly when the trimmed URL parses and its scheme, case-insensitive, is `http`, `https`, `mailto` or `tel`.
/// `javascript:`, `file:`, `data:`, `content:`, `intent:`, relative and empty URLs are refused.
pub fn open_url_allowed(url: &str) -> bool {
    let url = url.trim();
    let Some(colon) = url.find(':') else { return false };
    let scheme = &url[..colon];
    let rest = &url[colon + 1..];
    // RFC 3986 scheme: a letter, then letters, digits, `+`, `-` or `.`.
    let valid = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid {
        return false;
    }
    match scheme.to_ascii_lowercase().as_str() {
        // A web URL needs a host: `https://example.org`, not `https:` or `https:///x`.
        "http" | "https" => rest.strip_prefix("//").is_some_and(|r| r.split(['/', '?', '#']).next().is_some_and(|h| !h.is_empty())),
        "mailto" | "tel" => !rest.is_empty(),
        _ => false,
    }
}
