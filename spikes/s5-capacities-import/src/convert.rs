//! Value conversions the importer will apply: file names (FR-FMT-08, D-51, D-52, D-68) and dates (FR-IMP-09, D-56).

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

/// D-52 / D-68: forbidden characters → space, spaces collapsed, leading/trailing spaces and dots trimmed,
/// ≤ 200 UTF-8 bytes cut at a character boundary (D-51), NFC (FR-FMT-12).
pub fn sanitize_file_name(title: &str) -> String {
    let replaced: String = title.nfc()
        .map(|c| if "/:\\*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let mut s = replaced.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    let trim = |s: &str| s.trim_matches(|c: char| c == ' ' || c == '.').to_string();
    s = trim(&s);
    if s.len() > 200 {
        let mut end = 200;
        while !s.is_char_boundary(end) { end -= 1 }
        s = trim(&s[..end]);
    }
    if s.is_empty() { "Untitled".into() } else { s }
}

/// FR-LNK-14: `Name`, `Name (2)`, `Name (3)` … unique per folder, compared case-insensitively (APFS default).
#[derive(Default)]
pub struct NameAllocator(std::collections::HashSet<String>);

impl NameAllocator {
    pub fn allocate(&mut self, stem: &str, ext: &str) -> String {
        let mut n = 1;
        loop {
            let candidate = if n == 1 { format!("{stem}{ext}") } else { format!("{stem} ({n}){ext}") };
            if self.0.insert(candidate.to_lowercase()) { return candidate }
            n += 1;
        }
    }
}

static GENERIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(untitled|image|pasted image|screenshot)( \(\d+\))?$").unwrap());

/// FR-IMP-14 AC-3: generic media names are renamed after the owning note.
pub fn is_generic_media_name(stem: &str) -> bool { GENERIC.is_match(stem.trim()) }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DateValue {
    /// FR-IMP-09 AC-1: UTC midnight → date-only.
    DateOnly(String),
    /// FR-IMP-09 AC-2: other UTC date-times → local zone with offset (D-56).
    DateTime(String),
    /// FR-IMP-09 AC-3: `start -> end`.
    Range(String, String),
}

static RANGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(\S+)\s*->\s*(\S+)\s*$").unwrap());

pub fn parse_date(s: &str, tz: Tz) -> Option<DateValue> {
    let s = s.trim();
    if let Some(c) = RANGE.captures(s) {
        let a = parse_date(&c[1], tz)?;
        let b = parse_date(&c[2], tz)?;
        let flat = |v: DateValue| match v { DateValue::DateOnly(x) | DateValue::DateTime(x) => Some(x), _ => None };
        return Some(DateValue::Range(flat(a)?, flat(b)?));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") { return Some(DateValue::DateOnly(d.to_string())) }
    let dt = DateTime::parse_from_rfc3339(s).ok()?;
    let utc = dt.with_timezone(&Utc);
    if s.ends_with('Z') && utc.time() == chrono::NaiveTime::MIN {
        return Some(DateValue::DateOnly(utc.date_naive().to_string()));
    }
    Some(DateValue::DateTime(utc.with_timezone(&tz).format("%Y-%m-%dT%H:%M:%S%:z").to_string()))
}
