//! MS4 slice 4B (docs/contracts/ms4-daily.md §5, §6.1, §12): daily file names from `daily-format` (FR-FMT-09, D-336,
//! D-361) and the daily template (D-270, D-325, D-346, D-362). The TypeScript twins are in `@tegg/doc` `daily.ts`;
//! both follow the shared corpora in tests/fixtures/format/dates/.

use chrono::{Duration, NaiveDate};
use yaml_rust2::{Yaml, YamlLoader};

/// The format can't give a valid daily file name (D-336): no `DD`/`D` token, a D-52 forbidden or control character,
/// or an empty stem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadFormat;

/// Tokens `YYYY`, `MM`, `M`, `DD`, `D`, longest first; a backslash makes the next character literal (D-361); any
/// other character is copied as written. Returns the text and whether a day token was used.
pub fn format_date(date: NaiveDate, format: &str) -> (String, bool) {
    let c: Vec<char> = format.chars().collect();
    let (mut out, mut day, mut i) = (String::new(), false, 0);
    let at = |i: usize, t: &str| t.chars().enumerate().all(|(k, ch)| c.get(i + k) == Some(&ch));
    while i < c.len() {
        if c[i] == '\\' {
            if let Some(&n) = c.get(i + 1) {
                out.push(n);
            }
            i += 2;
        } else if at(i, "YYYY") {
            out.push_str(&date.format("%Y").to_string());
            i += 4;
        } else if at(i, "MM") {
            out.push_str(&date.format("%m").to_string());
            i += 2;
        } else if at(i, "M") {
            out.push_str(&date.format("%-m").to_string());
            i += 1;
        } else if at(i, "DD") {
            out.push_str(&date.format("%d").to_string());
            day = true;
            i += 2;
        } else if at(i, "D") {
            out.push_str(&date.format("%-d").to_string());
            day = true;
            i += 1;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    (out, day)
}

pub fn file_stem(format: &str, date: NaiveDate) -> Result<String, BadFormat> {
    let (s, day) = format_date(date, format);
    if !day || s.chars().any(|c| "/\\:*?\"<>|".contains(c) || c.is_control()) {
        return Err(BadFormat);
    }
    if s.trim_matches(|c: char| c == ' ' || c == '.').is_empty() {
        return Err(BadFormat);
    }
    Ok(crate::sanitize_file_stem(&s))
}

/// The twin of `@tegg/doc` `expandDailyTemplate` (§6.1).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExpandedTemplate {
    /// Non-ignored template keys in template order: (key, the key's source lines).
    pub keys: Vec<(String, String)>,
    pub body: String,
    pub invalid: bool,
}

/// D-346: the template keys the first write never takes from the template.
pub const IGNORED_TEMPLATE_KEYS: [&str; 7] = ["id", "type", "title", "date", "review", "created", "modified"];

/// `{{date}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{date:FORMAT}}` relative to `date`; anything else stays as written.
pub fn expand_variables(text: &str, date: NaiveDate) -> String {
    let iso = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let Some(j) = after.find("}}") else {
            out.push_str(&rest[i..]);
            rest = "";
            break;
        };
        let name = &after[..j];
        let value = match name {
            "date" => Some(iso(date)),
            "yesterday" => Some(iso(date - Duration::days(1))),
            "tomorrow" => Some(iso(date + Duration::days(1))),
            _ => name.strip_prefix("date:").map(|f| format_date(date, f).0),
        };
        match value {
            Some(v) => out.push_str(&v),
            None => out.push_str(&rest[i..i + 2 + j + 2]),
        }
        rest = &after[j + 2..];
    }
    out.push_str(rest);
    out
}

fn split_lines(s: &str) -> Vec<&str> {
    s.split_inclusive('\n').collect()
}

fn is_fence(line: &str) -> bool {
    line.trim_end_matches(['\n', '\r']) == "---"
}

pub fn expand_template(template_text: &str, date: NaiveDate) -> ExpandedTemplate {
    let lines = split_lines(template_text);
    if lines.first().map_or(true, |l| !is_fence(l)) {
        return ExpandedTemplate { keys: vec![], body: expand_variables(template_text, date), invalid: false };
    }
    let Some(close) = lines.iter().skip(1).position(|l| is_fence(l)).map(|p| p + 1) else {
        // D-362: opened, never closed.
        return ExpandedTemplate { keys: vec![], body: expand_variables(template_text, date), invalid: true };
    };
    let fm: String = lines[1..close].concat();
    let body: String = lines[close + 1..].concat();
    let valid = match YamlLoader::load_from_str(&fm) {
        Ok(docs) => matches!(docs.first(), None | Some(Yaml::Hash(_)) | Some(Yaml::Null)),
        Err(_) => false,
    };
    if !valid {
        return ExpandedTemplate { keys: vec![], body: expand_variables(&body, date), invalid: true };
    }
    let mut keys: Vec<(String, String)> = Vec::new();
    for line in &lines[1..close] {
        let top = !line.starts_with([' ', '\t', '#', '-', '\n', '\r']) && line.contains(':');
        if top {
            let k = line[..line.find(':').unwrap()].trim().trim_matches(|c| c == '"' || c == '\'').to_string();
            keys.push((k, line.to_string()));
        } else if let Some(last) = keys.last_mut() {
            last.1.push_str(line);
        }
    }
    keys.retain(|(k, _)| !IGNORED_TEMPLATE_KEYS.contains(&k.as_str()));
    ExpandedTemplate { keys, body: expand_variables(&body, date), invalid: false }
}

/// §6.2 (D-324, D-347): the first-write bytes. `id` and `now` may be the draft placeholders `{{id}}`, `{{now}}`.
pub fn new_daily_note(date: NaiveDate, keys: &[(String, String)], body: &str, id: &str, now: &str) -> String {
    let d = date.format("%Y-%m-%d");
    let mut s = format!("---\nid: {id}\ntype: daily-note\ntitle: \"{d}\"\ndate: {d}\n");
    for (_, lines) in keys {
        s.push_str(lines);
        if !lines.ends_with('\n') {
            s.push('\n');
        }
    }
    s.push_str(&format!("review: unreviewed\ncreated: {now}\nmodified: {now}\n---\n"));
    s.push_str(body);
    s
}

/// An instant the D-319/D-335 winner rule compares (PR #38 review, D-365): nanoseconds since 1970 UTC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Instant {
    /// With an offset (or `Z`).
    At(i128),
    /// Without one: read in the machine's zone (D-339, D-365).
    Local(i128),
}

impl Instant {
    pub fn nanos(self) -> i128 {
        match self {
            Instant::At(n) | Instant::Local(n) => n,
        }
    }
}

/// `YYYY-MM-DD[T| ]HH:MM[:SS[.f…]]` with `Z`, `±HH:MM` or no offset; anything else (a date alone, text) is None.
/// The twin of `@tegg/doc` `instantOf`; both follow tests/fixtures/format/dates/winner-instants.json.
pub fn instant(v: &str) -> Option<Instant> {
    use chrono::{NaiveDateTime, TimeZone};
    static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})?$").expect("regex")
    });
    let c = RE.captures(v.trim())?;
    let date = crate::date::parse_date(&c[1])?;
    let (h, m) = (c[2].parse::<u32>().ok()?, c[3].parse::<u32>().ok()?);
    let s = c.get(4).map_or(Some(0), |x| x.as_str().parse::<u32>().ok())?;
    let frac = c.get(5).map_or(0i128, |x| format!("{:0<9}", x.as_str()).parse::<i128>().unwrap_or(0));
    let naive: NaiveDateTime = date.and_hms_opt(h, m, s)?;
    match c.get(6).map(|x| x.as_str()) {
        Some(z) => {
            let off = if z == "Z" { 0 } else {
                let sign = if z.starts_with('-') { -1 } else { 1 };
                sign * (z[1..3].parse::<i32>().ok()? * 3600 + z[4..6].parse::<i32>().ok()? * 60)
            };
            let secs = naive.and_utc().timestamp() as i128 - off as i128;
            Some(Instant::At(secs * 1_000_000_000 + frac))
        }
        None => {
            let t = chrono::Local.from_local_datetime(&naive).earliest()?;
            Some(Instant::Local(t.timestamp() as i128 * 1_000_000_000 + frac))
        }
    }
}
