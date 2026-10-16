//! MS4 slice 4B (docs/contracts/ms4-daily.md §5, §6.1): daily file names from `daily-format` (FR-FMT-09, D-336) and the
//! daily template (D-270, D-325). STUBS until 4B is built: wrong values on purpose (TS-I1).

use chrono::NaiveDate;

/// The format can't give a valid daily file name (D-336): no `DD`/`D` token, a D-52 forbidden or control character,
/// or an empty stem after `sanitize_file_stem`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadFormat;

/// Tokens `YYYY`, `MM`, `M`, `DD`, `D`, longest first; any other character copied as written.
pub fn file_stem(_format: &str, _date: NaiveDate) -> Result<String, BadFormat> {
    Err(BadFormat)
}

/// The twin of `@tegg/doc` `expandDailyTemplate` (§6.1).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExpandedTemplate {
    /// Non-reserved template keys in template order: (key, the key's source lines).
    pub keys: Vec<(String, String)>,
    pub body: String,
    pub invalid: bool,
}

pub fn expand_template(_template_text: &str, _date: NaiveDate) -> ExpandedTemplate {
    ExpandedTemplate::default()
}
