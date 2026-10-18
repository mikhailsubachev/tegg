//! MS4 slice 4B (docs/contracts/ms4-daily.md §1, §3): Daily Notes in the core.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime};
use serde_json::Value;
use tegg_format::daily::{expand_template, file_stem, new_daily_note};
use tegg_format::{nfc, type_key};

use crate::{Core, CoreError, CoreEvent, FileVersion, VaultError};
use tegg_vault::WriteOutcome;

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
    /// D-345: the bytes a first write of this date would have with an empty edit: frontmatter (D-324) + expanded
    /// template body (D-322, D-325); `id`, `created`, `modified` are the placeholders `{{id}}` / `{{now}}` (§4).
    pub text: String,
    /// D-345: the part after the frontmatter (the editor's virtual content).
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

const TEMPLATE: &str = "_templates/Daily Note/Daily Note.md";
const DEFAULT_FORMAT: &str = "YYYY-MM-DD";

/// A value of `created`/`modified` in a day window (§1, D-339): an instant by `[start, end)`; an offset-less
/// date-time or a date by its local date text.
pub(crate) fn in_window(v: &Value, w: &DayWindow) -> Option<(i64, String)> {
    let s = v.as_str()?.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return (t >= w.start && t < w.end).then(|| (t.timestamp(), s.to_string()));
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(t) = NaiveDateTime::parse_from_str(s, f) {
            return (t.date() == w.date).then(|| (t.and_utc().timestamp() - w.start.offset().local_minus_utc() as i64, s.to_string()));
        }
    }
    let d = tegg_format::date::parse_date(s)?;
    (d == w.date).then(|| (w.start.timestamp(), s.to_string()))
}

impl Core {
    pub fn daily_view(&self, date: NaiveDate) -> DailyView {
        let idx = self.index();
        let path = idx.daily_note(date);
        let duplicates = idx.daily_duplicates(date);
        let review = path.as_deref().and_then(|p| idx.object(p)).and_then(|o| o.attributes.get("review").and_then(|v| v.as_str()).map(|s| s.trim().to_string())).filter(|r| r == "unreviewed" || r == "reviewed");
        DailyView { date, path, duplicates, review }
    }

    /// Dates in `year-month` that have a winner (calendar marks, FR-DLY-03 AC-3); sorted ascending.
    pub fn daily_dates(&self, year: i32, month: u32) -> Vec<NaiveDate> {
        self.index().daily_dates(year, month)
    }

    /// FR-FMT-09, D-336: the stem from `daily-format` and whether it fell back to `YYYY-MM-DD`.
    fn daily_stem(&self, date: NaiveDate) -> (String, bool) {
        let fmt: Option<Option<String>> = self.shared.vault.read(".tegg/vault.yml").ok().and_then(|(b, _)| {
            let docs = yaml_rust2::YamlLoader::load_from_str(&String::from_utf8_lossy(&b)).ok()?;
            let v = &docs.first()?["daily-format"];
            if v.is_badvalue() || v.is_null() {
                None
            } else {
                Some(v.as_str().map(str::to_string))
            }
        });
        match fmt {
            None => (file_stem(DEFAULT_FORMAT, date).unwrap_or_default(), false),
            Some(Some(f)) => match file_stem(&f, date) {
                Ok(s) => (s, false),
                Err(_) => (file_stem(DEFAULT_FORMAT, date).unwrap_or_default(), true),
            },
            Some(None) => (file_stem(DEFAULT_FORMAT, date).unwrap_or_default(), true),
        }
    }

    fn daily_folder(&self) -> String {
        self.type_get("daily-note").filter(|t| !t.invalid).map(|t| t.folder.trim_end_matches('/').to_string()).unwrap_or_else(|| "Daily".into())
    }

    pub fn daily_draft(&self, date: NaiveDate) -> Result<DailyDraft, CoreError> {
        let (keys, body, template_invalid) = match self.shared.vault.read(TEMPLATE) {
            Ok((b, _)) => {
                let x = expand_template(&String::from_utf8_lossy(&b), date);
                (x.keys, x.body, x.invalid.then(|| TEMPLATE.to_string()))
            }
            Err(_) => (Vec::new(), String::new(), None),
        };
        let (stem, format_fallback) = self.daily_stem(date);
        let folder = self.daily_folder();
        let stem = self.free_stem(&folder, &stem);
        let path = if folder.is_empty() { format!("{stem}.md") } else { format!("{folder}/{stem}.md") };
        let text = new_daily_note(date, &keys, &body, "{{id}}", "{{now}}");
        Ok(DailyDraft { text, body, template_keys: keys, template_invalid, path, format_fallback })
    }

    /// The first write (§4.1, D-326): never into or over another file; the typed text is never lost to a race.
    pub fn daily_create(&self, date: NaiveDate, bytes: &[u8]) -> Result<DailyCreated, CoreError> {
        let attrs = match tegg_format::extract(bytes, "x").attributes {
            Some(Value::Object(m)) => m,
            _ => return Err(CoreError::DailyMismatch),
        };
        let want = tegg_format::format_date(date);
        let text = |k: &str| attrs.get(k).and_then(|v| v.as_str()).map(|s| nfc(s.trim()));
        let ok = text("type").is_some_and(|t| type_key(&t) == "daily-note")
            && text("date").and_then(|d| d.get(..10).and_then(tegg_format::date::parse_date)) == Some(date)
            && text("title").as_deref() == Some(want.as_str());
        if !ok {
            return Err(CoreError::DailyMismatch);
        }
        let folder = self.daily_folder();
        // Files in the folder the index hasn't seen yet (another device, D-326) are indexed first.
        let unseen: Vec<String> = {
            let idx = self.index();
            let f = nfc(&folder);
            self.shared
                .vault
                .list_files()
                .unwrap_or_default()
                .into_iter()
                .filter(|p| p.ends_with(".md") && p.rsplit_once('/').map(|(d, _)| nfc(d) == f).unwrap_or(f.is_empty()) && idx.object(p).is_none())
                .collect()
        };
        for p in &unseen {
            if let Ok((b, v)) = self.shared.vault.read(p) {
                let _ = self.index().upsert(p, &b, &v);
            }
        }
        let (stem, _) = self.daily_stem(date);
        let id = text("id").filter(|i| !i.is_empty());
        let at = |s: &str| if folder.is_empty() { format!("{s}.md") } else { format!("{folder}/{s}.md") };
        // A file at the path with this write's `id` is this write, landed by an attempt that reported an error after
        // the rename (PR #38 review): the newer bytes replace it atomically, never a second file (FR-SYN-06).
        let ours = |path: &str| -> Option<Result<FileVersion, CoreError>> {
            let (b, v) = self.shared.vault.read(path).ok()?;
            if b.as_slice() == bytes {
                return Some(Ok(v));
            }
            let theirs = match tegg_format::extract(&b, "x").attributes {
                Some(Value::Object(m)) => m.get("id").and_then(|v| v.as_str()).map(|s| nfc(s.trim())),
                _ => None,
            };
            if id.is_none() || theirs != id {
                return None;
            }
            Some(match self.shared.vault.write(path, bytes, Some(&v)) {
                Ok(WriteOutcome::Written(n)) => Ok(n),
                Ok(WriteOutcome::Unchanged) => Ok(v),
                Err(e) => Err(e.into()),
            })
        };
        let planned = at(&stem);
        let mut tries = 0;
        let (path, version) = match ours(&planned) {
            Some(r) => (planned, r?),
            None => loop {
                let path = at(&self.free_stem(&folder, &stem));
                match self.shared.vault.create_exact(&path, bytes) {
                    Ok(v) => break (path, v),
                    Err(VaultError::NameTaken) if tries < 20 => {
                        if let Some(r) = ours(&path) {
                            break (path, r?);
                        }
                        tries += 1;
                        if let Ok((b, v)) = self.shared.vault.read(&path) {
                            let _ = self.index().upsert(&path, &b, &v);
                        }
                    }
                    Err(e) => match ours(&path) {
                        Some(r) => break (path, r?),
                        None => return Err(e.into()),
                    },
                }
            },
        };
        self.index().upsert(&path, bytes, &version)?;
        let mut changed = unseen;
        changed.push(path.clone());
        self.shared.emit(CoreEvent::VaultChanged { paths: changed });
        let mut duplicates: Vec<String> = {
            let idx = self.index();
            let mut all = idx.daily_duplicates(date);
            all.extend(idx.daily_note(date));
            all
        };
        duplicates.retain(|p| *p != path);
        Ok(DailyCreated { path, version, duplicates })
    }

    /// D-348: the backlinks panel of a date: of its winner, or of the date links to it while virtual.
    pub fn daily_backlinks(&self, date: NaiveDate) -> crate::BacklinksPanel {
        let winner = self.index().daily_note(date);
        match winner {
            Some(p) => self.backlinks_panel(&p),
            None => self.date_backlinks_panel(date),
        }
    }

    /// D-271, D-328: the three live sections for one day window.
    pub fn daily_context(&self, w: &DayWindow, limit: usize) -> DailyContextPage {
        let (objects, own) = {
            let idx = self.index();
            (idx.objects(), idx.daily_note(w.date))
        };
        let listed = self.daily_task_paths(w); // D-328: listed in Tasks due, not repeated (FR-DLY-04 AC-11)
        let row = |o: &crate::ObjectInfo, at: String| ContextRow { path: o.path.clone(), title: o.title.clone(), r#type: o.r#type.clone(), at };
        let (mut q, mut c, mut m): (Vec<(i64, ContextRow)>, Vec<(i64, ContextRow)>, Vec<(i64, ContextRow)>) = (vec![], vec![], vec![]);
        for o in objects.iter().filter(|o| Some(&o.path) != own.as_ref() && !listed.contains(&nfc(&o.path))) {
            let created = o.attributes.get("created").and_then(|v| in_window(v, w));
            let modified = o.attributes.get("modified").and_then(|v| in_window(v, w));
            match (o.r#type.as_str(), created, modified) {
                ("quick-note", Some((t, at)), _) => q.push((t, row(o, at))),
                (_, Some((t, at)), _) => c.push((t, row(o, at))),
                (_, None, Some((t, at))) => m.push((t, row(o, at))),
                _ => {}
            }
        }
        let fin = |mut v: Vec<(i64, ContextRow)>| {
            v.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.path.cmp(&b.1.path)));
            let n = v.len();
            (v.into_iter().take(limit).map(|x| x.1).collect::<Vec<_>>(), n)
        };
        let ((qn, a), (cn, b), (mn, cc)) = (fin(q), fin(c), fin(m));
        DailyContextPage { sections: DailyContext { quick_notes: qn, created: cn, modified: mn }, totals: [a, b, cc] }
    }
}

/// §1 test helper: the local day `date` in the IANA zone `tz`, local midnight to the next local midnight. Only for
/// tests (`cfg(test)` or the `test-hooks` feature); product code never uses it. STUB: a zero-length UTC window.
#[cfg(any(test, feature = "test-hooks"))]
pub fn window(date: NaiveDate, tz: &str) -> DayWindow {
    use chrono::TimeZone;
    let tz: chrono_tz::Tz = tz.parse().unwrap_or(chrono_tz::UTC);
    let at = |d: NaiveDate| tz.from_local_datetime(&d.and_hms_opt(0, 0, 0).expect("midnight")).earliest().expect("local midnight").fixed_offset();
    DayWindow { date, start: at(date), end: at(date.succ_opt().expect("next day")) }
}
