//! Preview v0.55 panel feedback AC tests at the core (L3): FR-LNK-01 AC-24 (D-633): each backlink entry carries the
//! source's `review`, `status`, `due` and `completed` as D-601 (the trimmed string values of those frontmatter keys, or
//! null), from the index, in `backlinks_panel` (IPC `index_backlinks`) and `daily_backlinks`; identical after the index
//! is deleted and rebuilt (AR-01). docs/acceptance/backlinks.md FR-LNK-01 AC-22, AC-24; interface
//! docs/contracts/ms4-links.md §3, §9.1 (the core's `BacklinkEntry` gains `review`, `status`, `due`, `completed`).
//! Written from the ACs and the contract only (D-61).
//!
//! The new fields are read through the `Debug` output of each `BacklinkEntry` (`review: Some("unreviewed")`), with its
//! `occurrences` cut out, so the file compiles before they exist and fails on an assertion (TS-I1). A field that doesn't
//! exist reads as `<missing>`.
//!
//! Fixture: `new-empty/.tegg` plus the AC-22 sources (synthetic, Czech titles) in a temporary directory; one status is
//! written with surrounding spaces to check the trimming, and two sources also link the Daily Note `2026-10-19`.

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::NaiveDate;
use common::*;
use tegg_core::{BacklinkEntry, BacklinksPanel, Core, CoreOptions};
use tegg_format::nfc;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const STAMP: &str = "2026-10-10T09:00:00+02:00";
const CIL: &str = "Pages/Cíl panelu.md";
const DAILY: &str = "Daily/2026-10-19.md";

/// (path, type, extra frontmatter keys, whether it also links the Daily Note).
const SOURCES: [(&str, &str, &str, bool); 10] = [
    ("Tasks/Uklidit štítky.md", "task", "status: To do\n", false),
    ("Tasks/Připravit poznámky.md", "task", "status: To do\ndue: 2026-10-23\n", false),
    ("Tasks/Projít osnovu.md", "task", "status: In progress\ndue: 2026-10-19\n", false),
    ("Tasks/Poslat rozpočet.md", "task", "status: To do\ndue: 2026-10-16\n", false),
    ("Tasks/Zeptat se Petra.md", "task", "status: \"  Waiting  \"\ndue: 2026-10-22\n", false),
    ("Tasks/Sebrat ceny letenek.md", "task", "status: Done\ndue: 2026-10-17\ncompleted: 2026-10-18T09:00:00+02:00\n", true),
    ("Tasks/Objednat kyvadlo.md", "task", "status: Cancelled\ncompleted: 2026-10-17T16:00:00+02:00\n", false),
    ("Quick Notes/Nápad na podcast.md", "quick-note", "review: unreviewed\n", true),
    ("Quick Notes/Hotová myšlenka.md", "quick-note", "review: reviewed\n", false),
    ("Pages/Plán.md", "page", "", false),
];

/// The expected `[review, status, due, completed]` of each source, as `Debug` text of an `Option<String>`.
fn expected() -> BTreeMap<String, [String; 4]> {
    let s = |v: &str| format!("Some({v:?})");
    let n = || "None".to_string();
    let mut m = BTreeMap::new();
    m.insert("Tasks/Uklidit štítky.md".to_string(), [n(), s("To do"), n(), n()]);
    m.insert("Tasks/Připravit poznámky.md".to_string(), [n(), s("To do"), s("2026-10-23"), n()]);
    m.insert("Tasks/Projít osnovu.md".to_string(), [n(), s("In progress"), s("2026-10-19"), n()]);
    m.insert("Tasks/Poslat rozpočet.md".to_string(), [n(), s("To do"), s("2026-10-16"), n()]);
    m.insert("Tasks/Zeptat se Petra.md".to_string(), [n(), s("Waiting"), s("2026-10-22"), n()]);
    m.insert("Tasks/Sebrat ceny letenek.md".to_string(), [n(), s("Done"), s("2026-10-17"), s("2026-10-18T09:00:00+02:00")]);
    m.insert("Tasks/Objednat kyvadlo.md".to_string(), [n(), s("Cancelled"), n(), s("2026-10-17T16:00:00+02:00")]);
    m.insert("Quick Notes/Nápad na podcast.md".to_string(), [s("unreviewed"), n(), n(), n()]);
    m.insert("Quick Notes/Hotová myšlenka.md".to_string(), [s("reviewed"), n(), n(), n()]);
    m.insert("Pages/Plán.md".to_string(), [n(), n(), n(), n()]);
    m
}

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn title_of(path: &str) -> String {
    let stem = path.rsplit('/').next().expect("setup: stem");
    stem.trim_end_matches(".md").to_string()
}
fn note(n: usize, r#type: &str, title: &str, keys: &str, body: &str) -> String {
    format!("---\nid: 01JB63300000000000000C{n:04}\ntype: {}\ntitle: {title}\n{keys}created: {STAMP}\nmodified: {STAMP}\n---\n{body}", r#type)
}
fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Panel");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"));
    write_raw(&root, CIL, note(1, "page", "Cíl panelu", "", "Cíl, na který odkazují úkoly i poznámky.\n").as_bytes());
    write_raw(
        &root,
        DAILY,
        "---\nid: 01JB63300000000000000D0001\ntype: daily-note\ntitle: \"2026-10-19\"\ndate: 2026-10-19\nreview: reviewed\ncreated: 2026-10-19T08:00:00+02:00\nmodified: 2026-10-19T08:00:00+02:00\n---\nPondělí.\n"
            .as_bytes(),
    );
    for (i, (path, ty, keys, daily)) in SOURCES.iter().enumerate() {
        let body = if *daily { "Viz [[Cíl panelu]] a [[2026-10-19]].\n" } else { "Viz [[Cíl panelu]].\n" };
        write_raw(&root, path, note(i + 10, ty, &title_of(path), keys, body).as_bytes());
    }
    root
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("setup: date")
}
fn entries(p: &BacklinksPanel) -> Vec<&BacklinkEntry> {
    p.groups.iter().flat_map(|g| g.entries.iter()).collect()
}

/// The `Debug` text of an entry without its `occurrences: [...]` (excerpt link targets must not be read as the entry's
/// own fields).
fn entry_debug(e: &BacklinkEntry) -> String {
    let dbg = format!("{e:?}");
    let Some(start) = dbg.find("occurrences: [") else { return dbg };
    let open = start + "occurrences: ".len();
    let (mut depth, mut in_str, mut esc, mut end) = (0i32, false, false, dbg.len());
    for (i, ch) in dbg[open..].char_indices() {
        if in_str {
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '[' | '{' | '(' => depth += 1,
            ']' | '}' | ')' => {
                depth -= 1;
                if depth == 0 {
                    end = open + i + ch.len_utf8();
                    break;
                }
            }
            _ => {}
        }
    }
    format!("{}{}", &dbg[..start], &dbg[end..])
}
/// One field of an entry as `Debug` text of an `Option<String>` (`Some("To do")` / `None`), `<missing>` when absent.
fn field(e: &BacklinkEntry, name: &str) -> String {
    let dbg = entry_debug(e);
    let key = format!("{name}: ");
    let Some(at) = dbg.find(&format!(" {key}")).map(|i| i + 1 + key.len()) else { return "<missing>".to_string() };
    let rest = &dbg[at..];
    if rest.starts_with("None") {
        return "None".to_string();
    }
    if let Some(s) = rest.strip_prefix("Some(\"") {
        let mut out = String::new();
        let mut esc = false;
        for ch in s.chars() {
            if esc {
                out.push(ch);
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                break;
            } else {
                out.push(ch);
            }
        }
        return format!("Some({out:?})");
    }
    rest.split([',', '}']).next().unwrap_or("").trim().to_string()
}
fn fields(e: &BacklinkEntry) -> [String; 4] {
    [field(e, "review"), field(e, "status"), field(e, "due"), field(e, "completed")]
}
fn by_source(p: &BacklinksPanel) -> BTreeMap<String, [String; 4]> {
    entries(p).into_iter().map(|e| (nfc(&e.source), fields(e))).collect()
}

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-24

#[test]
fn fr_lnk_01_ac24_index_backlinks_entries_carry_review_status_due_completed() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    let p = core.backlinks_panel(CIL);
    assert_eq!(p.objects, 10, "Cíl panelu has the 10 AC-22 sources");
    let got = by_source(&p);
    let want = expected();
    assert_eq!(got.keys().cloned().collect::<Vec<_>>(), want.keys().cloned().collect::<Vec<_>>(), "one entry per source");
    for (path, w) in &want {
        assert_eq!(got.get(path), Some(w), "{path}: [review, status, due, completed] are the trimmed frontmatter strings or null (D-633, D-601)");
    }
}

#[test]
fn fr_lnk_01_ac24_sebrat_and_napad_exactly() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    let got = by_source(&core.backlinks_panel(CIL));
    let s = |v: &str| format!("Some({v:?})");
    assert_eq!(
        got.get("Tasks/Sebrat ceny letenek.md").cloned(),
        Some(["None".to_string(), s("Done"), s("2026-10-17"), s("2026-10-18T09:00:00+02:00")]),
        "Sebrat ceny letenek: null review, Done, 2026-10-17, 2026-10-18T09:00:00+02:00"
    );
    assert_eq!(
        got.get("Quick Notes/Nápad na podcast.md").cloned(),
        Some([s("unreviewed"), "None".to_string(), "None".to_string(), "None".to_string()]),
        "Nápad na podcast: review unreviewed, the task fields null"
    );
    assert_eq!(got.get("Tasks/Zeptat se Petra.md").map(|f| f[1].clone()), Some(s("Waiting")), "a padded status is trimmed");
}

#[test]
fn fr_lnk_01_ac24_daily_backlinks_entries_carry_the_same_fields() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    let p = core.daily_backlinks(day("2026-10-19"));
    let got = by_source(&p);
    let want = expected();
    assert_eq!(
        got.keys().cloned().collect::<Vec<_>>(),
        vec!["Quick Notes/Nápad na podcast.md".to_string(), "Tasks/Sebrat ceny letenek.md".to_string()],
        "the Daily Note 2026-10-19 has the two sources that link it"
    );
    for (path, f) in &got {
        assert_eq!(Some(f), want.get(path), "{path}: daily_backlinks carries the same fields as index_backlinks (D-633)");
    }
}

#[test]
fn fr_lnk_01_ac24_fields_identical_after_index_rebuild() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open_dirs(&root, &sb.dirs);
    let first = by_source(&core.backlinks_panel(CIL));
    let first_daily = by_source(&core.daily_backlinks(day("2026-10-19")));
    let first_dbg = format!("{:?}", core.backlinks_panel(CIL));
    assert_eq!(first, expected(), "the fields before the rebuild");
    drop(core);
    let core = open_dirs(&root, &fresh_dirs(&sb, "Rebuilt"));
    assert_eq!(by_source(&core.backlinks_panel(CIL)), first, "index_backlinks fields identical after deleting and rebuilding the index (AR-01)");
    assert_eq!(by_source(&core.daily_backlinks(day("2026-10-19"))), first_daily, "daily_backlinks fields identical after the rebuild");
    assert_eq!(format!("{:?}", core.backlinks_panel(CIL)), first_dbg, "the whole answer identical after the rebuild");
}
