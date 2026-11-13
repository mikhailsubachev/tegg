//! FR-IMP-09 (ported from the S5 spike, `convert.rs`): Capacities date values, with the zone injected (§2).

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::Tz;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DateValue {
    /// A plain `YYYY-MM-DD`, or a UTC-midnight date-time written with `Z` (AC-1).
    Date(String),
    /// Another date-time: the same instant with the zone's offset, seconds precision (AC-2).
    DateTime(String),
    /// `a -> b`, both ends of one kind (AC-3).
    Range(Box<DateValue>, Box<DateValue>),
}

/// `None`: not a date (kept as written, D-1545 (3)).
pub(crate) fn parse(s: &str, zone: Tz) -> Option<DateValue> {
    let s = s.trim();
    if let Some((a, b)) = s.split_once("->") {
        let (a, b) = (single(a.trim(), zone)?, single(b.trim(), zone)?);
        return (std::mem::discriminant(&a) == std::mem::discriminant(&b)).then(|| DateValue::Range(Box::new(a), Box::new(b)));
    }
    single(s, zone)
}

fn single(s: &str, zone: Tz) -> Option<DateValue> {
    if s.len() == 10 {
        return NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().map(|d| DateValue::Date(d.format("%Y-%m-%d").to_string()));
    }
    let t = DateTime::parse_from_rfc3339(s).ok()?.with_timezone(&Utc);
    if s.ends_with('Z') && t.time() == NaiveTime::MIN {
        return Some(DateValue::Date(t.date_naive().format("%Y-%m-%d").to_string()));
    }
    Some(DateValue::DateTime(local(t, zone)))
}

/// An instant with the zone's offset, seconds precision (FR-FMT-11).
pub(crate) fn local(t: DateTime<Utc>, zone: Tz) -> String {
    t.with_timezone(&zone).format("%Y-%m-%dT%H:%M:%S%:z").to_string()
}

/// A date-time string as an instant in the zone (`createdAt`: never date-only).
pub(crate) fn instant(s: &str, zone: Tz) -> Option<String> {
    DateTime::parse_from_rfc3339(s.trim()).ok().map(|t| local(t.with_timezone(&Utc), zone))
}

/// The day of a value: the date itself, or the local day of a date-time.
pub(crate) fn day(s: &str, zone: Tz) -> Option<String> {
    match single(s.trim(), zone)? {
        DateValue::Date(d) => Some(d),
        DateValue::DateTime(t) => Some(t[..10].to_string()),
        DateValue::Range(..) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::{America::New_York, Europe::Prague, Pacific::Kiritimati};

    #[test]
    fn midnight_is_a_date_in_every_zone() {
        for z in [Prague, New_York, Kiritimati] {
            assert_eq!(parse("2026-03-19T00:00:00.000Z", z), Some(DateValue::Date("2026-03-19".into())));
            assert_eq!(parse("2026-03-01T00:00:00.000Z -> 2026-05-31T00:00:00.000Z", z), Some(DateValue::Range(Box::new(DateValue::Date("2026-03-01".into())), Box::new(DateValue::Date("2026-05-31".into())))));
        }
    }
    #[test]
    fn other_date_times_get_the_offset() {
        assert_eq!(parse("2026-04-07T19:46:20.601Z", Prague), Some(DateValue::DateTime("2026-04-07T21:46:20+02:00".into())));
        assert_eq!(parse("2026-04-07T19:46:20.601Z", Kiritimati), Some(DateValue::DateTime("2026-04-08T09:46:20+14:00".into())));
        assert_eq!(parse("Jun 26", Prague), None);
        assert_eq!(parse("2026-07-01 -> 2026-07-14", Prague).map(|v| matches!(v, DateValue::Range(..))), Some(true));
        assert_eq!(parse("2026-07-01 -> 2026-04-07T19:46:20.601Z", Prague), None);
        assert_eq!(day("2026-02-20T23:30:00.000Z", Prague).as_deref(), Some("2026-02-21"));
    }
}
