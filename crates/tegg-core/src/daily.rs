//! MS4 slice 4B (docs/contracts/ms4-daily.md §1, §3): Daily Notes in the core. STUBS until 4B is built: every call
//! returns a deliberately wrong value (an empty list, `None`, or `Err(NotImplemented)`), never a panic, so the 4B
//! red tests fail on their assertions (TS-I1, tools/qa CONTRACT §5.2).

use chrono::{DateTime, FixedOffset, NaiveDate};

use crate::{Core, CoreError, FileVersion};

/// §1: one local calendar day, `[start, end)`, each end with its own offset (a DST day is 23 or 25 h). Built by the
/// UI; the core never reads the system zone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayWindow {
    pub date: NaiveDate,
    pub start: DateTime<FixedOffset>,
    pub end: DateTime<FixedOffset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyView {
    pub date: NaiveDate,
    /// The winner's path, or None: the note is virtual.
    pub path: Option<String>,
    /// Losers, in winner order (D-319 notice).
    pub duplicates: Vec<String>,
    /// `review:` of the winner: "unreviewed" | "reviewed" | None (missing or unknown counts as unreviewed, D-330).
    pub review: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DailyDraft {
    /// The bytes a first write of this date would have with an empty edit: frontmatter (D-324) + expanded template
    /// body (D-322, D-325); `id`, `created`, `modified` are the placeholders `{{id}}` / `{{now}}` (§4).
    pub body: String,
    /// Template keys to write after `date`, in template order, reserved keys removed (D-325).
    pub template_keys: Vec<(String, String)>,
    /// Some when the template's frontmatter didn't parse: the template's vault path (FR-DLY-06 AC-5 message).
    pub template_invalid: Option<String>,
    /// The file name the first write will use: daily-format applied (FR-FMT-09), fallback per D-336, then free_stem.
    pub path: String,
    /// True when daily-format was invalid and YYYY-MM-DD was used (D-336 message).
    pub format_fallback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextRow {
    pub path: String,
    pub title: String,
    pub r#type: String,
    /// The instant as written.
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DailyContext {
    pub quick_notes: Vec<ContextRow>,
    pub created: Vec<ContextRow>,
    pub modified: Vec<ContextRow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DailyCreated {
    pub path: String,
    pub version: FileVersion,
    /// Paths that now share the date.
    pub duplicates: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DailyContextPage {
    pub sections: DailyContext,
    /// Totals of quick_notes, created, modified.
    pub totals: [usize; 3],
}

impl Core {
    pub fn daily_view(&self, date: NaiveDate) -> DailyView {
        DailyView { date, path: None, duplicates: Vec::new(), review: None }
    }

    /// Dates in `year-month` that have a winner (calendar marks, FR-DLY-03 AC-3); sorted ascending.
    pub fn daily_dates(&self, _year: i32, _month: u32) -> Vec<NaiveDate> {
        Vec::new()
    }

    pub fn daily_draft(&self, _date: NaiveDate) -> Result<DailyDraft, CoreError> {
        Err(CoreError::NotImplemented)
    }

    /// The first write (§4.1).
    pub fn daily_create(&self, _date: NaiveDate, _bytes: &[u8]) -> Result<DailyCreated, CoreError> {
        Err(CoreError::NotImplemented)
    }

    /// D-271, D-328: the three live sections for one day window.
    pub fn daily_context(&self, _w: &DayWindow, _limit: usize) -> DailyContextPage {
        DailyContextPage::default()
    }
}

/// §1 test helper: the local day `date` in the IANA zone `tz`, local midnight to the next local midnight. Only for
/// tests (`cfg(test)` or the `test-hooks` feature); product code never uses it. STUB: a zero-length UTC window.
#[cfg(any(test, feature = "test-hooks"))]
pub fn window(date: NaiveDate, _tz: &str) -> DayWindow {
    let t = date.and_hms_opt(0, 0, 0).map(|d| d.and_utc().fixed_offset()).unwrap_or_default();
    DayWindow { date, start: t, end: t }
}
