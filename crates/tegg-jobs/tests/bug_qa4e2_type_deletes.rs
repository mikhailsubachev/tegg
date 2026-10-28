//! QA review of 4E-2 (qa/reviews/4e-2-type-deletes.md): Undo of a property delete restores a note that was opened after
//! the job (M1: value-remove rows are byte rows, ms4-jobs §14.9.4), and Redo of a type delete never trashes a file the
//! Undo skipped or one changed since (m1).

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use common::{open_core, read_bytes, read_text, sandbox, write_raw};
use moves_setup::*;
use tags_setup::run_confirmed;
use tegg_jobs::{JobOp, Phase, SkipReason};

#[test]
fn bug_qa4e2_m1_fr_typ_04_ac8_undo_restores_a_note_opened_after_the_job() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, r) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "kniha".into(), key: "poznámka".into() }), "value-remove");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    core.jobs().editor_open(DUNA); // the user opens Duna, then runs `Undo delete property` from the palette
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert!(u.skipped.is_empty(), "nothing skipped: {u:?}");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna has its exact pre-job bytes");
    let (_, d) = ok!(common::run_job(&core, JobOp::Redo { job }), "Redo");
    assert!(d.skipped.is_empty(), "nothing skipped on Redo: {d:?}");
    assert!(read_text(&root, DUNA).is_some_and(|t| !t.contains("poznámka: ")), "Redo removes the line again");
}

#[test]
fn bug_qa4e2_m1_fr_typ_05_ac8_redo_never_trashes_a_file_the_undo_skipped() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, r) = ok!(run_confirmed(&core, JobOp::TypeDelete { r#type: "schůzka".into() }), "type-delete");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let novy = "---\nid: 01JB4E0000000000000000E0B9\ntype: page\ntitle: Porada\n---\nJiná porada.\n";
    write_raw(&root, PORADA, novy.as_bytes());
    core.notify_changed(&[PORADA.to_string()]);
    assert!(core.wait_idle(std::time::Duration::from_secs(10)), "setup: index idle");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert!(u.skipped.iter().any(|s| s.path == PORADA && s.reason == SkipReason::Taken), "Porada's place is taken: {u:?}");
    let (_, d) = ok!(common::run_job(&core, JobOp::Redo { job }), "Redo");
    assert_eq!(read_text(&root, PORADA).as_deref(), Some(novy), "the new Porada is never trashed by Redo: {d:?}");
    assert!(d.skipped.iter().any(|s| s.path == PORADA), "it is listed instead: {d:?}");
}
