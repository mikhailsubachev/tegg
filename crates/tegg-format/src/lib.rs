//! Tegg core: file names, dates, NFC and read-only extraction. Interface: docs/contracts/ms1-core.md §2.

mod extract;
/// MS4 slice 4A (docs/contracts/ms4-links.md §2): link positions, block texts, excerpt window.
pub mod excerpt;
/// MS4 slice 4B (docs/contracts/ms4-daily.md §1): the one date type.
pub mod date;
/// MS4 slice 4B (docs/contracts/ms4-daily.md §5, §6.1): daily file names and the daily template.
pub mod daily;

use chrono::{DateTime, FixedOffset, NaiveDate};
use unicode_normalization::UnicodeNormalization;

pub use extract::{body_start, parse_yaml_value, Extracted, FrontmatterError, Link};
pub use excerpt::{At, BlockKind, BlockText, Excerpt, LinkTargetInfo, Mark, RSeg, Segment, TargetKind};

/// D-51, D-52, D-68, D-80, FR-FMT-08, NFR-POR-02: title → file stem (no extension).
pub fn sanitize_file_stem(title: &str) -> String {
    let replaced: String = nfc(title)
        .chars()
        .map(|c| if "/:\\*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let trim = |s: &str| s.trim_matches(|c: char| c == ' ' || c == '.').to_string();
    let mut s = trim(&replaced.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    if s.len() > 200 {
        let mut end = 200;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s = trim(&s[..end]); // trim again: the cut may leave a trailing space or dot
    }
    if s.is_empty() {
        return "Untitled".into();
    }
    if is_windows_reserved(&s) {
        s.push('_'); // D-80
    }
    s
}

/// CON, PRN, AUX, NUL, COM1–9, LPT1–9 in any case, also with an extension (`con.txt`).
fn is_windows_reserved(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4 && (base.starts_with("COM") || base.starts_with("LPT")) && matches!(base.as_bytes()[3], b'1'..=b'9'))
}

/// FR-LNK-14, FR-STO-05: "stem.ext", "stem (2).ext", "stem (3).ext", … — the first name `taken` rejects
/// not. Candidates are NFC; the caller's `taken` decides how names compare (the vault: NFC, case-insensitive).
pub fn unique_file_name(stem: &str, ext: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let stem = nfc(stem);
    let ext = if ext.is_empty() || ext.starts_with('.') { ext.to_string() } else { format!(".{ext}") };
    (1..)
        .map(|n| if n == 1 { format!("{stem}{ext}") } else { format!("{stem} ({n}){ext}") })
        .find(|name| !taken(name))
        .expect("unbounded")
}

/// FR-FMT-09: YYYY, MM and DD tokens; anything else is literal. "YYYY-MM-DD" → "2026-10-09.md".
pub fn daily_note_file_name(date: NaiveDate, format: &str) -> String {
    let f = if format.trim().is_empty() { "YYYY-MM-DD" } else { format };
    let name = f
        .replace("YYYY", &date.format("%Y").to_string())
        .replace("MM", &date.format("%m").to_string())
        .replace("DD", &date.format("%d").to_string());
    format!("{name}.md")
}

/// FR-FMT-12.
pub fn nfc(s: &str) -> String {
    s.nfc().collect()
}

/// Same object name under Unicode normalization.
pub fn same_name(a: &str, b: &str) -> bool {
    nfc(a) == nfc(b)
}

/// FR-FMT-11: `2026-10-09`.
pub fn format_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// FR-FMT-11: ISO 8601 with offset, seconds precision: `2026-10-09T14:30:00+02:00`.
pub fn format_date_time(t: DateTime<FixedOffset>) -> String {
    t.format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// A date-only value is a calendar date, never an instant, so no time zone can shift it.
pub fn parse_date(value: &str) -> Option<NaiveDate> {
    let v = value.trim().trim_matches(|c| c == '"' || c == '\'');
    if v.len() != 10 || v.as_bytes()[4] != b'-' || v.as_bytes()[7] != b'-' {
        return None;
    }
    NaiveDate::parse_from_str(v, "%Y-%m-%d").ok()
}

/// FR-TYP-15.
pub const RESERVED_KEYS: &[&str] = &[
    "id", "type", "title", "description", "aliases", "tags", "created", "modified", "source", "review", "icon", "cover",
    "previous", "file", "import-id", "captured",
];

pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key.trim())
}

/// Read-only extraction (the index's view of a note). Invalid UTF-8 is read lossily.
pub fn extract(bytes: &[u8], stem: &str) -> Extracted {
    extract::extract_text(&String::from_utf8_lossy(bytes), stem)
}

/// D-96 / D-239 (ms3-shell §14.1.2): the key of a type name or `type` value: NFC, trimmed, lower case, each
/// whitespace run as `-`. `Quick Note` → `quick-note`. Used by `tegg-schema` (type files) and the index (matching).
pub fn type_key(name: &str) -> String {
    nfc(name).split_whitespace().collect::<Vec<_>>().join("-").to_lowercase()
}
