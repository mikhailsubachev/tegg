//! Slice 4E-2 AC tests of the `value-remove` job (L4): docs/acceptance/type-moves.md FR-TYP-04 AC-6 (the counts the
//! dialog shows; `isbn` with no values writes only the type file, no zip), AC-7 (the job: zip first, Duna's line goes
//! with its value lines and the `# od koho` comment stays, Bez autora, Článek and the templates untouched, the type file
//! last), AC-8 (Undo gives the exact bytes back; files changed since are skipped and listed), AC-9 (a Kniha changed by
//! another program is skipped `changed` and listed; the type file still changes; Retry removes the line), AC-10 (an open
//! note gets the op through its editor, D-386; L4 only by D-841), cancel during `writing` (board D3), and of "Both
//! parts" FR-HIS-04 AC-11 (value-remove part) and FR-SYN-06 AC-36 (value-remove part); also FR-TYP-06 AC-1, AC-2 for
//! this job (a system type or a built-in key is refused). On a temporary copy of the type-moves fixture on APFS with the
//! real `@tegg/doc` transformer (`NodeTransformer`, D-82; `npm run build --prefix packages/doc`).
//! Interface: docs/contracts/ms4-jobs.md §14.9.1 (`JobOp::ValueRemove { r#type, key }`, flags, `JobError::UnknownType`,
//! `SystemType`, `BuiltIn`, `UnknownProperty`, backup label `backups.label.valueRemove`), §14.9.2 (planner,
//! `PlanCounts.empty`, `TextOp::RemoveKey`, the type file written last through `Host::remove_property`, open notes),
//! §14.9.4 (undo rows, cancel during `writing`), §4…§7 (start, confirm, plan, wait, retry, undo), §5.1 (job points).
//! Written from the ACs and the contracts only (D-61). Every API result goes through `ok!`/`some!` or an `assert!` here,
//! so the 4E-2 stubs (`start` answers `NotImplemented`) fail on assertions (TS-I1).
//!
//! The L4 clock is the machine's; `modified` must not change at all here (a schema edit, FR-TYP-04 AC-5's rule), so
//! every byte comparison is exact.

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::collections::BTreeSet;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{changed, open_core, open_core_with, read_bytes, read_text, repo_root, sandbox, set, snapshot, write_raw, RecordingFs};
use moves_setup::*;
use tags_setup::{confirm_when_asked, run_confirmed};
use tegg_core::CoreEvent;
use tegg_jobs::testing::NodeTransformer;
use tegg_jobs::{JobError, JobId, JobKind, JobOp, JobPoint, Phase, RetryOutcome, SkipReason, TextOp, Transformed, Transformer};

/// The poznámka item of kniha.yml (the fixture's bytes).
const POZNAMKA_ITEM: &str = "  - key: poznámka\n    name: Poznámka\n    type: text\n";
const ISBN_ITEM: &str = "  - key: isbn\n    name: ISBN\n    type: text\n";
const DUNA_LINE: &str = "poznámka: Půjčená od Petra\n";
/// A second Kniha with a value, made at runtime where a test needs two files (cancel between files).
const STARY_LINE: &str = "poznámka: Z půdy\n";

fn remove(key: &str) -> JobOp {
    JobOp::ValueRemove { r#type: "kniha".into(), key: key.into() }
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    files_only(s)
}
fn without(text: &str, part: &str) -> String {
    if text.matches(part).count() != 1 {
        panic!("setup: {part:?} must occur once");
    }
    text.replacen(part, "", 1)
}
fn duna_after() -> String {
    without(&fx(DUNA), DUNA_LINE)
}
fn kniha_after() -> String {
    without(&fx(KNIHA_YML), POZNAMKA_ITEM)
}
/// Starý zápis with a poznámka value (runtime addition; the fixture stays as it is).
fn stary_with_value() -> String {
    fx_swap(STARY, &[("autor: Neznámý\n", &format!("autor: Neznámý\n{STARY_LINE}"))])
}
/// Waits for `job` to reach `confirm` (its progress event), ≤ 30 s.
fn reached_confirm(rx: &std::sync::mpsc::Receiver<CoreEvent>, job: JobId) -> bool {
    let end = Instant::now() + Duration::from_secs(30);
    while Instant::now() < end {
        if let Ok(CoreEvent::JobProgress(p)) = rx.recv_timeout(Duration::from_millis(50)) {
            if p.job == job && p.phase == Phase::Confirm {
                return true;
            }
            if p.job == job && p.phase.is_final() {
                return false;
            }
        }
    }
    false
}
/// Positions of the recorded file-system operations that land on `path` (writes and renames; not removals).
fn ops_on(fs: &RecordingFs, path: &str) -> Vec<usize> {
    fs.ops().iter().enumerate().filter(|(_, (o, p, _))| p == path && o != "remove_file" && o != "create_dir_all").map(|(i, _)| i).collect()
}

// ------------------------------------------------------------------------------------------------ flags

#[test]
fn fr_typ_04_ac7_value_remove_confirms_backs_up_and_is_undoable_and_cancellable_while_writing() {
    let f = JobKind::ValueRemove.flags();
    assert_eq!((f.needs_confirm, f.backup, f.undoable), (true, true, true), "value-remove: confirm, zip, undoable in memory (ms4-jobs §14.1, §14.9.1)");
    assert_eq!(f.cancellable, vec![Phase::Planning, Phase::Confirm, Phase::Backup, Phase::Writing], "cancellable in planning, confirm, backup and writing (board D3)");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-6

#[test]
fn fr_typ_04_ac6_the_plan_counts_one_value_and_one_empty_line() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let usage = core.type_usage("kniha");
    assert_eq!((usage.values.get("poznámka").copied(), usage.values.get("isbn").copied()), (Some(1), Some(0)), "type_usage: Duna has a poznámka value, no Kniha has an isbn (the UI's no-value check, §14.9.2)");
    let before = snapshot(&root);
    let rx = core.events();
    let job = ok!(core.jobs().start(remove("poznámka")), "start value-remove kniha.poznámka");
    assert!(reached_confirm(&rx, job), "the job stops in confirm (the dialog's step)");
    let plan = some!(core.jobs().plan(job), "the plan in confirm");
    assert_eq!(plan.kind, JobKind::ValueRemove, "kind value-remove");
    assert_eq!((plan.counts.files, plan.counts.empty), (1, 1), "`from 1 kniha; 1 has no value`: Duna has a value, Bez autora's line is empty (AP-769)");
    assert_eq!(plan.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(), vec![DUNA.to_string()], "only Duna is planned: not Bez autora (empty), Článek (another type), the templates or the type file");
    assert_eq!(plan.files[0].ops, vec![TextOp::RemoveKey { key: "poznámka".into() }], "one remove-key op (ms4-jobs §14.9.2)");
    ok!(core.jobs().cancel(job), "Cancel in confirm");
    let report = some!(core.jobs().wait(job, Duration::from_secs(10)), "report");
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "Cancel in the dialog writes nothing");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "and makes no zip");
}

#[test]
fn fr_typ_04_ac6_isbn_without_values_changes_only_the_type_file_without_a_zip() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let rx = core.events();
    let job = ok!(core.jobs().start(remove("isbn")), "start value-remove kniha.isbn");
    assert!(reached_confirm(&rx, job), "the job stops in confirm");
    let plan = some!(core.jobs().plan(job), "plan");
    assert_eq!((plan.counts.files, plan.counts.empty, plan.files.len()), (0, 0, 0), "no Kniha has an isbn line");
    ok!(confirm_when_asked(&core, job), "confirm");
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, KNIHA_YML), Some(without(&fx(KNIHA_YML), ISBN_ITEM)), "the isbn item is removed from kniha.yml");
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[KNIHA_YML]), "only kniha.yml is written");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "a count of 0 confirms the type-file write without a zip (ms4-jobs §14.9.2)");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-7

#[test]
fn fr_typ_04_ac7_the_job_removes_dunas_line_then_the_property() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove kniha.poznámka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::ValueRemove, "kind value-remove");
    assert_eq!(read_text(&root, DUNA), Some(duna_after()), "Duna loses its poznámka line; `# od koho` stays (AP-769); modified unchanged");
    assert_eq!(read_text(&root, KNIHA_YML), Some(kniha_after()), "kniha.yml loses the poznámka item (preview [autor, stav] has no poznámka)");
    for p in [BEZ, CLANEK, T_KNIHA, T_RECENZE] {
        assert_eq!(read_bytes(&root, p), Some(fx_bytes(p)), "{p} is untouched (empty line, other type, templates: AP-769)");
    }
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[DUNA, KNIHA_YML]), "only Duna and kniha.yml are written");
    assert!(report.written.iter().any(|p| p == DUNA), "Duna is reported written: {report:?}");
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip: {z:?}");
    assert!(z[0].ends_with("-value-remove.zip"), "<UTC time>-value-remove.zip: {}", z[0]);
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip exists before the first vault write (FR-HIS-04 AC-11)");
    let label = core.backups().first().map(|b| (b.label.key.clone(), b.label.args.clone()));
    assert_eq!(label.as_ref().map(|(k, _)| k.as_str()), Some("backups.label.valueRemove"), "label key (ms4-jobs §14.9.1): {label:?}");
    assert!(label.as_ref().is_some_and(|(_, a)| a.to_string().contains("Poznámka")), "the label names the property (`Delete property Poznámka`): {label:?}");
    assert_eq!(core.jobs().last_undoable(), Some(job), "undoable (AP-767)");
}

#[test]
fn fr_typ_04_ac7_the_type_file_is_written_after_every_object() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, STARY, stary_with_value().as_bytes());
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let (_, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove kniha.poznámka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let (d, s, k) = (ops_on(&fs, DUNA), ops_on(&fs, STARY), ops_on(&fs, KNIHA_YML));
    assert_eq!((d.len(), s.len()), (1, 1), "each object is written once: Duna {d:?}, Starý zápis {s:?}");
    assert!(!k.is_empty() && k.iter().all(|i| *i > d[0] && *i > s[0]), "kniha.yml is written last (ms4-jobs §14.9.2): kniha {k:?}, Duna {d:?}, Starý zápis {s:?}");
    assert_eq!(read_text(&root, STARY), Some(fx(STARY)), "Starý zápis loses the runtime line, back to the fixture bytes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-8

#[test]
fn fr_typ_04_ac8_undo_restores_the_exact_bytes() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna has its exact pre-job bytes");
    assert_eq!(read_bytes(&root, KNIHA_YML), Some(fx_bytes(KNIHA_YML)), "kniha.yml has its exact pre-job bytes (the property is back)");
    assert_eq!(core.type_get("kniha").map(|t| t.version.is_some()), Some(true), "the type is readable");
}

#[test]
fn fr_typ_04_ac8_a_file_changed_since_is_skipped_and_listed() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let theirs = format!("{}Dopsáno jinde.\n", duna_after());
    write_raw(&root, DUNA, theirs.as_bytes());
    core.notify_changed(&[DUNA.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "setup: index idle");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(u.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(DUNA.to_string(), SkipReason::Changed)], "Duna is skipped `changed` and listed");
    assert_eq!(read_text(&root, DUNA), Some(theirs), "Duna keeps the other program's bytes (NFR-REL-02)");
    assert_eq!(read_bytes(&root, KNIHA_YML), Some(fx_bytes(KNIHA_YML)), "kniha.yml is restored");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-9

#[test]
fn fr_typ_04_ac9_a_kniha_changed_meanwhile_is_skipped_the_type_file_still_changes_and_retry_removes_the_line() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = format!("{}Dopsáno jinde.\n", fx(DUNA));
    let (r, t) = (root.clone(), theirs.clone());
    let once = Arc::new(Mutex::new(false));
    let o2 = once.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == DUNA) {
            let mut d = o2.lock().unwrap_or_else(|e| e.into_inner());
            if !*d {
                *d = true;
                write_raw(&r, DUNA, t.as_bytes()); // another program, between the read and the write
            }
        }
    })));
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove");
    core.jobs().set_point_hook(None);
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(DUNA.to_string(), SkipReason::Changed)], "Duna is skipped `changed` and listed");
    assert_eq!(read_text(&root, DUNA), Some(theirs.clone()), "Duna keeps its line (the other program's bytes)");
    assert_eq!(read_text(&root, KNIHA_YML), Some(kniha_after()), "the type file is still changed (skipped ones too, ms4-jobs §14.9.2)");
    let r = ok!(core.jobs().retry(job, DUNA), "Retry Duna");
    assert_eq!(r, RetryOutcome::Written, "Retry writes from the current bytes (D-398)");
    assert_eq!(read_text(&root, DUNA), Some(without(&theirs, DUNA_LINE)), "the line goes; the other program's text stays");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-10 (L4 only, D-841)

/// The editor side of D-386 in the test: Duna is "open" with unsaved body text; the core sends its op as a live
/// `JobTransform`; the "editor" applies it to its live text with the real engine and saves through `write_note`.
#[test]
fn fr_typ_04_ac10_an_open_note_loses_the_line_through_its_editor_and_keeps_unsaved_text() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let (disk, base) = ok!(core.read_note(DUNA, std::time::SystemTime::now()), "read Duna");
    let live = format!("{}Neuložený text v editoru.\n", String::from_utf8_lossy(&disk));
    core.jobs().editor_open(DUNA);
    let events = core.events();
    let job = ok!(core.jobs().start(remove("poznámka")), "start value-remove");
    ok!(confirm_when_asked(&core, job), "confirm");
    let engine = ok!(NodeTransformer::from_repo(&repo_root()), "NodeTransformer");
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut saved = false;
    while Instant::now() < deadline && !saved {
        match events.recv_timeout(Duration::from_millis(200)) {
            Ok(CoreEvent::JobTransform { source, ops, live: true, .. }) if tegg_format::nfc(&source) == DUNA => {
                assert_eq!(ops, vec![TextOp::RemoveKey { key: "poznámka".into() }], "the editor gets the remove-key op");
                let t = ok!(engine.transform(DUNA, live.as_bytes(), &ops), "transform the live document");
                let Transformed::Bytes(bytes, _) = t else {
                    assert!(false, "the live document loses the poznámka line");
                    unreachable!()
                };
                ok!(core.write_note(DUNA, &bytes, Some(&base)), "the editor's autosave writes Duna");
                saved = true;
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(saved, "the job sent Duna's op to its editor (live JobTransform, D-386)");
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert!(report.written.iter().any(|p| tegg_format::nfc(p) == DUNA), "counted written when the editor's save lands: {report:?}");
    assert_eq!(read_text(&root, DUNA), Some(format!("{}Neuložený text v editoru.\n", duna_after())), "the line is gone and the unsaved text is kept");
    assert_eq!(ops_on(&fs, DUNA).len(), 1, "Duna is written once (the editor's save); the core never wrote it itself");
    assert_eq!(read_text(&root, KNIHA_YML), Some(kniha_after()), "the type file follows");
}

// ------------------------------------------------------------------------------------------------ cancel (board D3, ms4-jobs §14.9.4)

#[test]
fn fr_typ_04_ac8_cancel_while_writing_reverses_the_rows_and_keeps_the_property() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let stary = stary_with_value();
    write_raw(&root, STARY, stary.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    // Path order: Knihy/2025/Starý zápis.md is written first; the job stops before Duna's write.
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let (at_tx, go_rx) = (Mutex::new(Some(at_tx)), Mutex::new(go_rx));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == DUNA) {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(10));
            }
        }
    })));
    let job = ok!(core.jobs().start(remove("poznámka")), "start value-remove");
    ok!(confirm_when_asked(&core, job), "confirm");
    let reached = at_rx.recv_timeout(Duration::from_secs(30)).is_ok();
    let c = core.jobs().cancel(job);
    let _ = go_tx.send(());
    assert!(reached, "the job reached Duna's write after writing Starý zápis");
    assert!(c.is_ok(), "cancellable in writing (board D3): {c:?}");
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    core.jobs().set_point_hook(None);
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    assert_eq!(read_text(&root, STARY), Some(stary), "the row written so far is reversed: Starý zápis has its line again");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna is never written");
    assert_eq!(read_bytes(&root, KNIHA_YML), Some(fx_bytes(KNIHA_YML)), "a cancelled value-remove never writes the type file");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-11

#[test]
fn fr_his_04_ac11_a_value_remove_with_a_failed_zip_writes_nothing() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    tags_setup::read_only_backups(&sb.dirs);
    let r = run_confirmed(&core, remove("poznámka"));
    tags_setup::writable_again(&sb.dirs);
    let (_, report) = ok!(r, "value-remove");
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or("").contains("BackupFailed"), "BackupFailed: {:?}", report.error);
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical (data-safety AC-1); the property stays");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-36

#[test]
fn fr_syn_06_ac36_a_value_remove_writes_exactly_its_planned_files_and_undo_the_same() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, STARY, stary_with_value().as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let s0 = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, remove("poznámka")), "value-remove");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let plan = some!(core.jobs().plan(job), "the plan");
    let mut planned: BTreeSet<String> = plan.files.iter().map(|f| f.path.clone()).collect();
    planned.insert(KNIHA_YML.into()); // the type file, written last (§14.9.2)
    let s1 = snapshot(&root);
    let wrote = files(changed(&s0, &s1));
    assert_eq!(wrote, planned, "the written files equal the plan's files and the type file; every other file keeps bytes, mtime and inode");
    assert_eq!(wrote, set(&[STARY, DUNA, KNIHA_YML]), "Starý zápis, Duna and kniha.yml");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(files(changed(&s1, &snapshot(&root))), wrote, "Undo writes only the files the job wrote");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-06 AC-1, AC-2 (this job)

#[test]
fn fr_typ_06_ac2_value_remove_refuses_built_in_system_and_unknown_keys() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let r = core.jobs().start(JobOp::ValueRemove { r#type: "task".into(), key: "status".into() });
    assert!(matches!(r, Err(JobError::BuiltIn) | Err(JobError::SystemType)), "Task's built-in `status` is refused (FR-TYP-06 AC-2): {r:?}");
    let r = core.jobs().start(JobOp::ValueRemove { r#type: "kniha".into(), key: "nálada".into() });
    assert!(matches!(r, Err(JobError::UnknownProperty)), "nálada is not a Kniha property: UnknownProperty: {r:?}");
    let r = core.jobs().start(JobOp::ValueRemove { r#type: "recept".into(), key: "mouka".into() });
    assert!(matches!(r, Err(JobError::UnknownType)), "recept has no definition: UnknownType: {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "nothing is written");
    // The control: a real property of a user type starts.
    let r = core.jobs().start(remove("isbn"));
    assert!(r.is_ok(), "kniha.isbn starts: {r:?}");
    if let Ok(job) = r {
        let _ = core.jobs().cancel(job);
    }
}
