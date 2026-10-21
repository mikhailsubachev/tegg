//! v0.52 feedback AC tests at the core (L4): `Core::resolve_links` carries the review and task fields of each resolved
//! target (docs/acceptance/embeds.md FR-LNK-07 AC-10; D-601; docs/contracts/ms3-shell.md §11.1: `review`, `status`,
//! `due`, `completed` are the trimmed string values of those frontmatter keys of the resolved object, null when
//! unresolved or not a string; read-only, from the index). Written from the AC and the contract only (D-61).
//!
//! The new fields are read through `LinkTarget`'s `Debug` output (`review: Some("unreviewed")`), so the file compiles
//! before they exist and fails on an assertion (TS-I1).
//!
//! Fixture: `new-empty/.tegg` plus synthetic notes (the AC's tasks, Quick Notes and Pages) in a temporary directory.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions, LinkTarget};

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
const PREHLED: &str = "Pages/Přehled.md";
const PRIPRAVIT: &str = "Tasks/Připravit poznámky.md";

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
fn note(n: u32, r#type: &str, title: &str, keys: &str, body: &str) -> String {
    format!("---\nid: 01JB52000000000000000C{n:04}\ntype: {}\ntitle: {title}\n{keys}created: {STAMP}\nmodified: {STAMP}\n---\n{body}", r#type)
}
fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Odkazy");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"));
    write_raw(&root, PRIPRAVIT, note(1, "task", "Připravit poznámky", "status: To do\ndue: 2026-10-23\n", "").as_bytes());
    write_raw(&root, "Tasks/Sebrat ceny letenek.md", note(2, "task", "Sebrat ceny letenek", "status: Done\ndue: 2026-10-17\ncompleted: 2026-10-18T09:00:00+02:00\n", "").as_bytes());
    write_raw(&root, "Tasks/Zeptat se Petra.md", note(3, "task", "Zeptat se Petra", "status: \"  Waiting  \"\ndue: 2026-10-22\n", "").as_bytes());
    write_raw(&root, "Quick Notes/Nápad na podcast.md", note(4, "quick-note", "Nápad na podcast", "review: unreviewed\n", "").as_bytes());
    write_raw(&root, "Pages/Plán.md", note(5, "page", "Plán", "", "").as_bytes());
    write_raw(&root, "Pages/Číselný stav.md", note(6, "page", "Číselný stav", "status: 3\nreview: [a, b]\n", "").as_bytes());
    let body = "Odkazy: [[Připravit poznámky]] [[Sebrat ceny letenek]] [[Zeptat se Petra]] [[Nápad na podcast]] [[Plán]] [[Číselný stav]] [[Chybí]].\n";
    write_raw(&root, PREHLED, note(7, "page", "Přehled", "", body).as_bytes());
    root
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn targets(t: &[&str]) -> Vec<String> {
    t.iter().map(|s| s.to_string()).collect()
}
/// The `Debug` text of one field of a resolved target, e.g. `Some("To do")` or `None`; `<missing>` when the field
/// doesn't exist on `LinkTarget`.
fn field(t: &LinkTarget, name: &str) -> String {
    let dbg = format!("{t:?}");
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
fn fields(t: &LinkTarget) -> [String; 4] {
    [field(t, "review"), field(t, "status"), field(t, "due"), field(t, "completed")]
}
fn some(s: &str) -> String {
    format!("Some({s:?})")
}
const NONE: &str = "None";

// ------------------------------------------------------------------------------------------------ FR-LNK-07 AC-10

#[test]
fn fr_lnk_07_ac10_resolve_links_returns_review_status_due_completed() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb);
    let r = core.resolve_links(PREHLED, &targets(&["Připravit poznámky", "Nápad na podcast", "Sebrat ceny letenek", "Plán"]));
    assert_eq!(r.len(), 4, "one result per target");
    assert_eq!(fields(&r[0]), [NONE.to_string(), some("To do"), some("2026-10-23"), NONE.to_string()], "Připravit poznámky: review, status, due, completed (D-601)");
    assert_eq!(fields(&r[1]), [some("unreviewed"), NONE.to_string(), NONE.to_string(), NONE.to_string()], "Nápad na podcast: review unreviewed");
    assert_eq!(fields(&r[2]), [NONE.to_string(), some("Done"), some("2026-10-17"), some("2026-10-18T09:00:00+02:00")], "Sebrat ceny letenek: a done task's fields");
    assert_eq!(fields(&r[3]), [NONE.to_string(), NONE.to_string(), NONE.to_string(), NONE.to_string()], "Plán: a Page without these keys");
}

#[test]
fn fr_lnk_07_ac10_values_are_trimmed_strings_and_null_otherwise() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb);
    let r = core.resolve_links(PREHLED, &targets(&["Zeptat se Petra", "Číselný stav", "Chybí"]));
    assert_eq!(r.len(), 3, "one result per target");
    assert_eq!(field(&r[0], "status"), some("Waiting"), "a quoted value with spaces is trimmed");
    assert_eq!([field(&r[1], "status"), field(&r[1], "review")], [NONE.to_string(), NONE.to_string()], "a number or a list is not a string: null");
    assert_eq!(fields(&r[2]), [NONE.to_string(), NONE.to_string(), NONE.to_string(), NONE.to_string()], "an unresolved target: all null");
}

#[test]
fn fr_lnk_07_ac10_fields_follow_an_external_change() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb);
    let before = core.resolve_links(PREHLED, &targets(&["Připravit poznámky"]));
    assert_eq!(field(&before[0], "status"), some("To do"), "before: To do");
    let changed = note(1, "task", "Připravit poznámky", "status: Done\ndue: 2026-10-23\ncompleted: 2026-10-19T09:30:00+02:00\n", "");
    std::fs::write(root.join(PRIPRAVIT), changed).expect("setup: external write");
    core.notify_changed(&[PRIPRAVIT.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(30)), "the change is indexed");
    let after = core.resolve_links(PREHLED, &targets(&["Připravit poznámky"]));
    assert_eq!(fields(&after[0]), [NONE.to_string(), some("Done"), some("2026-10-23"), some("2026-10-19T09:30:00+02:00")], "after the change: Done with completed");
}
