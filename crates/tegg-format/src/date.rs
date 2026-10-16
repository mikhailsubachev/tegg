//! MS4 slice 4B (docs/contracts/ms4-daily.md §1): the one date type. STUB until 4B is built: returns `None` so the
//! red tests fail on their assertions (TS-I1).

use chrono::NaiveDate;

/// Exactly `^\d{4}-\d{2}-\d{2}$` (ASCII digits) with a valid calendar day (D-332); anything else is `None`.
pub fn parse_date(_s: &str) -> Option<NaiveDate> {
    None
}
