//! MS4 slice 4B (docs/contracts/ms4-daily.md §1): the one date type. Shared corpus tests/fixtures/format/dates/cases.json.

use chrono::NaiveDate;

/// Exactly `^\d{4}-\d{2}-\d{2}$` (ASCII digits) with a valid calendar day (D-332); anything else is `None`.
pub fn parse_date(s: &str) -> Option<NaiveDate> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s[r].parse::<u32>().ok();
    NaiveDate::from_ymd_opt(n(0..4)? as i32, n(5..7)?, n(8..10)?)
}
