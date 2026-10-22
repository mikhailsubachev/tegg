//! v0.52 feedback AC tests at the core (L4): `Core::capture_create` and the review workflow (docs/acceptance/capture.md
//! FR-CAP-04 AC-9; D-604; docs/contracts/ms5-capture.md §3.3 step 2: the bytes carry `review: unreviewed` exactly when
//! the type's review workflow is on (locked or on); a review type without it, or another type with any `review` key →
//! `NotACapture`). Written from the AC and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory (Quick Note: review locked; Nápad:
//! review true; Task, Page, Schůzka: review off).

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreError, CoreOptions};
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

const NOW: &str = "2026-10-14T12:00:00+02:00";
const ID: &str = "01JB5B0000000000000000N052";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn inbox_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Doručené");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("inbox"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
fn changed(a: &std::collections::BTreeMap<String, Entry>, b: &std::collections::BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
/// R57 bytes (D-604): `extra` lines after `title`, then `review: unreviewed` only when `review` is true.
fn bytes(r#type: &str, title: &str, extra: &str, review: bool) -> String {
    let r = if review { "review: unreviewed\n" } else { "" };
    format!("---\nid: {ID}\ntype: {}\ntitle: {title}\n{extra}{r}created: {NOW}\nmodified: {NOW}\n---\n", r#type)
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-9

#[test]
fn fr_cap_04_ac9_task_and_page_captures_have_no_review_line() {
    for (key, title, extra, want) in [
        ("task", "Zavolat kominíkovi", "status: To do\n", "Tasks/Zavolat kominíkovi.md"),
        ("page", "Koupit dárek pro Janu", "", "Pages/Koupit dárek pro Janu.md"),
        ("schůzka", "Porada o rozpočtu", "", "Schůzky/Porada o rozpočtu.md"),
    ] {
        let sb = sandbox();
        let root = inbox_vault(&sb);
        let core = open(&root, &sb);
        let before = snapshot(&root);
        let b = bytes(key, title, extra, false);
        let r = core.capture_create(key, title, b.as_bytes());
        assert!(r.is_ok(), "{key}: a capture without `review` is accepted (review workflow off, D-604), got {r:?}");
        let path = nfc(&r.unwrap_or_default());
        assert_eq!(path, want, "{key}: the type's folder");
        assert_eq!(read(&root, &path), b, "{key}: exactly the bytes, no review line");
        assert_eq!(changed(&before, &snapshot(&root)), vec![want.to_string()], "{key}: one file");
    }
}

#[test]
fn fr_cap_04_ac9_refuses_a_review_key_on_types_without_the_workflow() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    for (key, title, extra, review_line) in [
        ("task", "Zavolat kominíkovi", "status: To do\n", "review: unreviewed\n"),
        ("task", "Zavolat kominíkovi", "status: To do\n", "review: reviewed\n"),
        ("page", "Koupit dárek pro Janu", "", "review: unreviewed\n"),
    ] {
        let b = format!("---\nid: {ID}\ntype: {key}\ntitle: {title}\n{extra}{review_line}created: {NOW}\nmodified: {NOW}\n---\n");
        let r = core.capture_create(key, title, b.as_bytes());
        assert!(matches!(r, Err(CoreError::NotACapture)), "{key} with {}: NotACapture (D-604), got {r:?}", review_line.trim());
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn fr_cap_04_ac9_review_types_still_need_unreviewed() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    // Red guard: a Task capture without `review` is a valid capture now (D-604).
    let task = core.capture_create("task", "Zavolat kominíkovi", bytes("task", "Zavolat kominíkovi", "status: To do\n", false).as_bytes());
    assert!(task.is_ok(), "guard: a Task capture without review is accepted, got {task:?}");
    let before = snapshot(&root);
    for (key, title, extra) in [("quick-note", "Koupit chleba", ""), ("nápad", "Čajovna", "hodnocení: 1\n")] {
        let r = core.capture_create(key, title, bytes(key, title, extra, false).as_bytes());
        assert!(matches!(r, Err(CoreError::NotACapture)), "{key} without review: unreviewed → NotACapture, got {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
    for (key, title, extra, want) in [("quick-note", "Koupit chleba", "", "Quick Notes/Koupit chleba.md"), ("nápad", "Čajovna", "hodnocení: 1\n", "Nápady/Čajovna.md")] {
        let b = bytes(key, title, extra, true);
        let path = nfc(&ok!(core.capture_create(key, title, b.as_bytes()), format!("capture_create({key}) with review: unreviewed")));
        assert_eq!(path, want, "{key}: written");
        assert_eq!(read(&root, &path), b, "{key}: with review: unreviewed");
    }
}
