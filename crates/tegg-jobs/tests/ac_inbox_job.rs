//! MS5 slice 5B AC tests of the job engine's `inbox` kind (L4): docs/acceptance/inbox.md FR-INB-02 AC-12 (a bulk action
//! writes exactly its files, each by the single-item rule; a file changed without an event is skipped and listed),
//! AC-14 (bulk convert makes a backup zip first; cancelling in planning leaves the vault and Application Support
//! untouched; other bulk actions make no zip), FR-INB-01 AC-9 (a read-only file is skipped, never written).
//! Interface: docs/contracts/ms5-capture.md §7.3 (`JobOp::Inbox { paths, change: InboxJobChange }`, kind `inbox`:
//! `needsConfirm: false`, backup only for `SetType` (`backup.convert`), not undoable, cancellable in planning and backup;
//! skips `changed` and `readOnly`) and ms4-jobs.md §4 (engine API), §6 (backups: `<UTC yyyymmdd-hhmmss>-<kind>.zip`).
//! The bytes come from the real `@tegg/doc` transformer (`NodeTransformer`; `npm run build --prefix packages/doc`).
//! Written from the ACs and the contracts only (D-61).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory.

#[macro_use]
mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use tegg_jobs::{InboxJobChange, JobKind, JobOp, JobPoint, Phase, SkipReason};

const NOW: &str = "2026-10-14T12:00:00+02:00";
const Q1: &str = "Quick Notes/Koupit mléko.md";
const Q2: &str = "Quick Notes/Nápad na článek.md";
const Q4: &str = "Quick Notes/Bez stavu.md";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn inbox_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Doručené");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("inbox"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn fx(rel: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/inbox").join(rel)).expect("setup: fixture file")
}
fn sw(text: &str, from: &str, to: &str) -> String {
    assert_setup(text.contains(from), &format!("fixture contains {from:?}"));
    text.replacen(from, to, 1)
}
fn zips(dirs: &tegg_vault::AppDirs) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "zip") {
                out.push(p);
            }
        }
    }
    walk(&dirs.root.join("backups"), &mut out);
    out.sort();
    out
}
fn inbox(paths: &[&str], change: InboxJobChange) -> JobOp {
    JobOp::Inbox { paths: paths.iter().map(|p| p.to_string()).collect(), change }
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn mark_reviewed() -> InboxJobChange {
    InboxJobChange::SetReview { value: "reviewed".into(), now: NOW.into() }
}
/// Q1, Q2, Q4 after FR-INB-02 AC-1 and AC-2's rule.
fn reviewed_bytes() -> Vec<(&'static str, String)> {
    vec![
        (Q1, sw(&sw(&fx(Q1), "review: unreviewed", "review: reviewed"), "modified: 2026-10-14T08:15:00+02:00", &format!("modified: {NOW}"))),
        (Q2, sw(&sw(&fx(Q2), "review: unreviewed", "review: reviewed"), "modified: 2026-10-13T21:40:00+02:00", &format!("modified: {NOW}"))),
        (Q4, sw(&fx(Q4), "modified: 2026-10-10T10:00:00+02:00\n---\n", &format!("modified: {NOW}\nreview: reviewed\n---\n"))),
    ]
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-12

#[test]
fn fr_inb_02_ac12_bulk_mark_reviewed_writes_exactly_the_three_files() {
    assert_eq!(JobKind::Inbox.as_str(), "inbox", "the kind's IPC name");
    let f = JobKind::Inbox.flags();
    assert_eq!((f.needs_confirm, f.undoable), (false, false), "no confirm step (the page confirms itself), no undo (D-561)");
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_job(&core, inbox(&[Q1, Q2, Q4], mark_reviewed())), "inbox job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::Inbox, "kind inbox");
    assert_eq!(report.written.iter().cloned().collect::<BTreeSet<_>>(), set(&[Q1, Q2, Q4]), "the three items written");
    assert_eq!(changed(&before, &snapshot(&root)), set(&[Q1, Q2, Q4]), "exactly those three files");
    for (p, want) in reviewed_bytes() {
        assert_eq!(read_text(&root, p).as_deref(), Some(want.as_str()), "{p}: AC-1's rule");
    }
    assert_eq!(zips(&sb.dirs), Vec::<PathBuf>::new(), "bulk mark reviewed makes no zip (D-561)");
}

#[test]
fn fr_inb_02_ac12_a_file_changed_without_an_event_is_skipped() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = fx(Q2) + "Dopsáno jinde.\n";
    write_raw(&root, Q2, theirs.as_bytes()); // after indexing, no event: the index version is stale
    let (_, report) = ok!(run_job(&core, inbox(&[Q1, Q2, Q4], mark_reviewed())), "inbox job");
    assert_eq!(report.written.iter().cloned().collect::<BTreeSet<_>>(), set(&[Q1, Q4]), "the other two are written: {report:?}");
    assert_eq!(report.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(Q2.to_string(), SkipReason::Changed)], "Q2 skipped as changed");
    assert_eq!(read_text(&root, Q2).as_deref(), Some(theirs.as_str()), "Q2 keeps the external bytes");
}

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-9

#[test]
fn fr_inb_01_ac9_a_read_only_file_is_skipped_by_a_bulk_job() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let mut bytes = fx(Q1).into_bytes();
    let at = bytes.windows(4).position(|w| w == b"Polo").expect("fixture body");
    bytes.insert(at, 0xFF);
    let ro = "Quick Notes/Koupit mléko kopie.md";
    write_raw(&root, ro, &bytes);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_job(&core, inbox(&[ro, Q4], mark_reviewed())), "inbox job");
    assert_eq!(report.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(ro.to_string(), SkipReason::ReadOnly)], "the read-only copy is skipped and listed");
    assert_eq!(changed(&before, &snapshot(&root)), set(&[Q4]), "only Q4 is written; the copy never is");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-14

#[test]
fn fr_inb_02_ac14_bulk_convert_makes_a_backup_zip_first() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    // At the job's first read for writing, the zip must already exist.
    let zip_first: Arc<Mutex<Option<bool>>> = Arc::new(Mutex::new(None));
    let (dirs, seen) = (sb.dirs.clone(), zip_first.clone());
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { .. }) {
            let mut s = seen.lock().unwrap_or_else(|e| e.into_inner());
            if s.is_none() {
                *s = Some(!zips(&dirs).is_empty());
            }
        }
    })));
    let before = snapshot(&root);
    let (_, report) = ok!(run_job(&core, inbox(&[Q1, Q2], InboxJobChange::SetType { r#type: "nápad".into(), now: NOW.into() })), "bulk convert");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let z = zips(&sb.dirs);
    assert_eq!(z.len(), 1, "one backup zip: {z:?}");
    let name = z[0].file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    assert!(name.ends_with("-inbox.zip"), "<UTC time>-inbox.zip: {name}");
    assert_eq!(*zip_first.lock().unwrap_or_else(|e| e.into_inner()), Some(true), "the zip exists before the first write");
    assert_eq!(changed(&before, &snapshot(&root)), set(&[Q1, Q2]), "then the two files");
    let q1 = sw(&sw(&sw(&fx(Q1), "type: quick-note", "type: nápad"), "review: unreviewed", "review: reviewed"), "modified: 2026-10-14T08:15:00+02:00", &format!("modified: {NOW}"));
    assert_eq!(read_text(&root, Q1).as_deref(), Some(q1.as_str()), "Q1 by AC-5's rule");
}

#[test]
fn fr_inb_02_ac14_cancelling_a_bulk_convert_in_planning_leaves_everything() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let (at_tx, go_rx) = (Mutex::new(Some(at_tx)), Mutex::new(go_rx));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if *p == JobPoint::AfterPlanning {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    let before = snapshot(&root);
    let job = ok!(core.jobs().start(inbox(&[Q1, Q2], InboxJobChange::SetType { r#type: "nápad".into(), now: NOW.into() })), "start");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let c = core.jobs().cancel(job);
    let _ = go_tx.send(());
    assert!(c.is_ok(), "cancellable in planning: {c:?}");
    let report = some!(core.jobs().wait(job, Duration::from_secs(10)), "report");
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is untouched");
    assert_eq!(zips(&sb.dirs), Vec::<PathBuf>::new(), "no zip");
}

#[test]
fn fr_inb_02_ac14_other_bulk_actions_make_no_zip() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    for (what, change) in [
        ("mark reviewed", mark_reviewed()),
        ("mark unreviewed", InboxJobChange::SetReview { value: "unreviewed".into(), now: NOW.into() }),
        ("link to", InboxJobChange::AppendLink { target: "Plán webu".into(), now: NOW.into() }),
        ("add tags", InboxJobChange::AddTags { tags: vec!["doma".into()], now: NOW.into() }),
    ] {
        let (_, report) = ok!(run_job(&core, inbox(&[Q1, Q2], change)), format!("{what}"));
        assert_eq!(report.phase, Phase::Done, "{what}: {report:?}");
        assert!(!report.written.is_empty(), "{what}: writes the items");
        assert_eq!(zips(&sb.dirs), Vec::<PathBuf>::new(), "{what}: no zip (D-561)");
    }
    let q1 = read_text(&root, Q1).unwrap_or_default();
    assert!(q1.contains("\ntags: [nákup, doma]\n") && q1.ends_with("\n[[Plán webu]]\n"), "the add-tags and link-to changes are in Q1:\n{q1}");
}
