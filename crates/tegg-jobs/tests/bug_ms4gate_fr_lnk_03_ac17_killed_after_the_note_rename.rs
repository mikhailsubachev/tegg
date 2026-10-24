//! Regression tests from the MS4 milestone gate (D-755): a note rename killed after the note's own rename but before
//! the journal recorded it. Finish looked for the note at its old path, found nothing and returned, and the journal
//! was removed: the note kept its new name and every link kept the old one (FR-LNK-03 AC-17; 500 broken links in the
//! real-app crash test). Undo couldn't move the note back either. Named `bug_<issue>_<req-id>_…` (CLAUDE.md
//! "Testing"); each failed before its fix.
//!
//! The kill is simulated as in bug_45_review.rs: a job-point hook panics at the first linking file's read (the note
//! is renamed and journaled by then), and the note's line is taken out of the journal log, which is the state a kill
//! between the rename and its log line leaves.

#[macro_use]
mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_format::nfc;
use tegg_jobs::{JobOp, JobPoint, ResolveChoice};

fn crash_at_read(core: &tegg_core::Core, n: usize) {
    let count = Arc::new(AtomicUsize::new(0));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { .. }) && count.fetch_add(1, Ordering::SeqCst) + 1 == n {
            panic!("simulated crash at read {n}");
        }
    })));
}

fn logs(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(logs(&p));
        } else if p.extension().is_some_and(|x| x == "log") {
            out.push(p);
        }
    }
    out
}

/// Renames Alfa → Gama and kills the job after the note's rename, before its journal line.
fn killed_after_the_note_rename(root: &Path, dirs: &tegg_vault::AppDirs) {
    let core = ok!(open_core(root, dirs, false), "open");
    crash_at_read(&core, 2); // the second read is the first linking file's: the note is renamed by then
    let _ = core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() });
    std::thread::sleep(Duration::from_millis(500));
    drop(core);
    assert!(!root.join(ALFA).exists() && root.join(GAMA).exists(), "setup: the note is renamed");
    let l = logs(&dirs.root);
    assert_eq!(l.len(), 1, "setup: one journal log: {l:?}");
    let text = std::fs::read_to_string(&l[0]).expect("setup: log");
    let kept: String = text.lines().filter(|line| !line.contains(&format!("\t{ALFA}\t"))).map(|line| format!("{line}\n")).collect();
    assert_ne!(kept, text, "setup: the note's line was in the log");
    std::fs::write(&l[0], kept).expect("setup: log without the note's line");
}

#[test]
fn bug_ms4gate_fr_lnk_03_ac17_finish_after_the_note_rename_updates_every_link() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    killed_after_the_note_rename(&root, &sb.dirs);
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted rename: {i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Finish), "Finish");
    assert!(core.wait_idle(Duration::from_secs(30)), "indexed");
    assert!(root.join(GAMA).exists() && !root.join(ALFA).exists(), "the note stays renamed");
    let odkazy = read_text(&root, ODKAZY).unwrap_or_default();
    assert!(odkazy.contains("\n[[Gama]]\n"), "Finish rewrote Odkazy's link to the new name: {odkazy}");
    let r = core.resolve_links(ODKAZY, &["Gama".to_string()]);
    assert_eq!(r.first().and_then(|x| x.path.clone()).map(|p| nfc(&p)), Some(GAMA.to_string()), "and it resolves to the note");
}

#[test]
fn bug_ms4gate_fr_lnk_03_ac17_undo_after_the_note_rename_moves_the_note_back() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    killed_after_the_note_rename(&root, &sb.dirs);
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted rename: {i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Undo), "Undo");
    assert!(core.wait_idle(Duration::from_secs(30)), "indexed");
    assert!(root.join(ALFA).exists() && !root.join(GAMA).exists(), "Undo moved the note back to Alfa");
    let odkazy = read_text(&root, ODKAZY).unwrap_or_default();
    assert!(odkazy.contains("\n[[Alfa]]\n"), "Odkazy still links to Alfa: {odkazy}");
    let r = core.resolve_links(ODKAZY, &["Alfa".to_string()]);
    assert_eq!(r.first().and_then(|x| x.path.clone()).map(|p| nfc(&p)), Some(ALFA.to_string()), "and it resolves to the note");
}
