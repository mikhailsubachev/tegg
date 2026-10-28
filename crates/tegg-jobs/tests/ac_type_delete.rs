//! Slice 4E-2 AC tests of the `type-delete` job (L4): docs/acceptance/type-moves.md FR-TYP-05 AC-7 (zip first; Porada,
//! Retro and Schůzka jinde to `.trash/` with their relative paths, bytes and inodes; then `_templates/Schůzka/` and,
//! last, `.tegg/types/schůzka.yml`; Odkazy's links resolve as trashed; nothing else written), AC-8 (Undo brings the
//! three objects, the template and the type file back with their bytes, the type first; Cancel while writing restores
//! the objects already trashed and keeps the type; a failed job leaves the type), AC-9 (an object changed by another
//! program is skipped `changed`, the definition and template are kept, `keptType`), and types.md FR-TYP-05 AC-4 in its
//! D-809 / D-842 form on the types fixture; of "Both parts" FR-HIS-04 AC-11 (type-delete part) and FR-SYN-06 AC-36
//! (type-delete part); FR-TYP-06 AC-1 for this job (a system type is refused). On a temporary copy of the fixture on
//! APFS with the real `@tegg/doc` transformer (`NodeTransformer`).
//! Interface: docs/contracts/ms4-jobs.md §14.9.1 (`JobOp::TypeDelete { r#type }`, flags, `JobError::UnknownType`,
//! `SystemType`, label `backups.label.typeDelete`), §14.9.3 (planner: objects, `PlanCounts.templates`, order with the
//! definition last, `JobReport.kept_type`), §14.9.4 (trash rows, undo, cancel during `writing`), §4…§7, §5.1 (job
//! points: `AfterRead` before each object's trash is red-test point AP-797).
//! Written from the ACs and the contracts only (D-61). Every API result goes through `ok!`/`some!` or an `assert!`.
//! FR-TYP-05 AC-10 (restore brings the type back) is crates/tegg-core/tests/ac_trash_restore_type.rs.

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{changed, copy_dir, open_core, open_core_with, read_bytes, read_text, repo_root, sandbox, set, snapshot, write_raw, RecordingFs, Sandbox};
use moves_setup::*;
use tags_setup::{confirm_when_asked, run_confirmed};
use tegg_core::LinkKind;
use tegg_jobs::{JobError, JobKind, JobOp, JobPoint, Phase, SkipReason};

const SCHUZKA_YML: &str = ".tegg/types/schůzka.yml";
/// The three Schůzky and where FR-STO-08 AC-5's rule puts them.
const THREE: [(&str, &str); 3] = [
    (SCH_JINDE, ".trash/Pages/Schůzka jinde.md"),
    (PORADA, ".trash/Schůzky/Porada.md"),
    (RETRO, ".trash/Schůzky/Retro.md"),
];
const T_SCHUZKA_TRASHED: &str = ".trash/_templates/Schůzka/Schůzka.md";
const SCHUZKA_YML_TRASHED: &str = ".trash/.tegg/types/schůzka.yml";

fn delete(key: &str) -> JobOp {
    JobOp::TypeDelete { r#type: key.into() }
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    files_only(s)
}
/// Every path the full delete changes: the five sources and their five trash paths.
fn ten() -> BTreeSet<String> {
    let mut s: BTreeSet<String> = THREE.iter().flat_map(|(a, b)| [a.to_string(), b.to_string()]).collect();
    for p in [T_SCHUZKA, T_SCHUZKA_TRASHED, SCHUZKA_YML, SCHUZKA_YML_TRASHED] {
        s.insert(p.into());
    }
    s
}
/// Positions of the recorded renames whose source is `from` (`rename_from:<from>`).
fn renames_from(fs: &RecordingFs, from: &str) -> Vec<usize> {
    let tag = format!("rename_from:{from}");
    fs.ops().iter().enumerate().filter(|(_, (o, _, _))| *o == tag || o.starts_with(&format!("{tag}/"))).map(|(i, _)| i).collect()
}
/// Positions of the recorded operations that land on `to` or under it (a folder rename lands on the folder).
fn landing_on(fs: &RecordingFs, to: &str) -> Vec<usize> {
    fs.ops().iter().enumerate().filter(|(_, (o, p, _))| o.starts_with("rename_from:") && (p == to || to.starts_with(&format!("{p}/")))).map(|(i, _)| i).collect()
}

// ------------------------------------------------------------------------------------------------ flags

#[test]
fn fr_typ_05_ac7_type_delete_confirms_backs_up_and_is_undoable_and_cancellable_while_writing() {
    let f = JobKind::TypeDelete.flags();
    assert_eq!((f.needs_confirm, f.backup, f.undoable), (true, true, true), "type-delete: confirm, zip, undoable in memory (ms4-jobs §14.9.1)");
    assert_eq!(f.cancellable, vec![Phase::Planning, Phase::Confirm, Phase::Backup, Phase::Writing], "cancellable while writing too (board F2)");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-7

#[test]
fn fr_typ_05_ac7_the_plan_counts_three_objects_and_one_template() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let rx = core.events();
    let job = ok!(core.jobs().start(delete("schůzka")), "start type-delete schůzka");
    let mut confirm = false;
    let end = std::time::Instant::now() + Duration::from_secs(30);
    while std::time::Instant::now() < end && !confirm {
        if let Ok(tegg_core::CoreEvent::JobProgress(p)) = rx.recv_timeout(Duration::from_millis(50)) {
            confirm = p.job == job && p.phase == Phase::Confirm;
        }
    }
    assert!(confirm, "the job stops in confirm (the dialog reads its plan)");
    let plan = some!(core.jobs().plan(job), "plan");
    assert_eq!(plan.kind, JobKind::TypeDelete, "kind type-delete");
    assert_eq!((plan.counts.files, plan.counts.templates), (3, 1), "`3 schůzky … and the Schůzka template` (R99 F1)");
    let objects: BTreeSet<String> = plan.trashes.iter().take(3).cloned().collect();
    assert_eq!(objects, set(&[PORADA, RETRO, SCH_JINDE]), "the three objects are trashed first: {:?}", plan.trashes);
    assert_eq!(plan.trashes.last().map(String::as_str), Some(SCHUZKA_YML), "the definition is last (D-809): {:?}", plan.trashes);
    assert!(plan.files.iter().all(|f| f.path != ODKAZY), "linking notes are not written (they show trashed, ms4-jobs §14.9.3)");
    ok!(core.jobs().cancel(job), "Cancel in confirm");
    let report = some!(core.jobs().wait(job, Duration::from_secs(10)), "report");
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "Cancel in the dialog writes nothing");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "no zip");
}

#[test]
fn fr_typ_05_ac7_the_job_trashes_the_objects_then_the_template_then_the_definition() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::TypeDelete, "kind type-delete");
    assert!(!report.kept_type, "every object was trashed, so the type went too");
    let after = snapshot(&root);
    let mut bad = Vec::new();
    for (from, to) in THREE {
        let (b, a) = (before.get(from), after.get(to));
        if root.join(from).exists() || a.map(|e| (&e.bytes, e.ino)) != b.map(|e| (&e.bytes, e.ino)) {
            bad.push(format!("{from} → {to}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "each Schůzka is in .trash/ at its relative path with its bytes and inode (one rename, FR-STO-08 AC-5)");
    assert_eq!(read_bytes(&root, T_SCHUZKA_TRASHED), Some(fx_bytes(T_SCHUZKA)), "_templates/Schůzka/ is in the trash");
    assert_eq!(read_bytes(&root, SCHUZKA_YML_TRASHED), Some(fx_bytes(SCHUZKA_YML)), "schůzka.yml is in the trash with its bytes");
    assert!(!root.join(SCHUZKA_YML).exists() && !root.join("_templates/Schůzka").exists(), "the definition and the template folder are gone");
    assert_eq!(files(changed(&before, &after)), ten(), "only those files: Odkazy and every other file keep bytes, mtime and inode");
    assert!(core.type_get("schůzka").map(|t| t.exists) != Some(true), "the type no longer exists");
    let r = core.resolve_links(ODKAZY, &["Porada".to_string(), "Retro".to_string()]);
    assert_eq!(r.iter().map(|x| x.kind.clone()).collect::<Vec<_>>(), vec![LinkKind::Trashed, LinkKind::Trashed], "Odkazy's [[Porada]] and [[Retro]] resolve as trashed (the chip, 6A)");
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip: {z:?}");
    assert!(z[0].ends_with("-type-delete.zip"), "<UTC time>-type-delete.zip: {}", z[0]);
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip exists before the first vault write (FR-HIS-04 AC-11)");
    let label = core.backups().first().map(|b| (b.label.key.clone(), b.label.args.clone()));
    assert_eq!(label.as_ref().map(|(k, _)| k.as_str()), Some("backups.label.typeDelete"), "label key (ms4-jobs §14.9.1): {label:?}");
    assert!(label.as_ref().is_some_and(|(_, a)| a.to_string().contains("Schůzka")), "the label names the type (`Delete type Schůzka`): {label:?}");
    assert_eq!(core.jobs().last_undoable(), Some(job), "undoable (AP-767)");
}

#[test]
fn fr_typ_05_ac7_the_definition_is_trashed_last() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let (_, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let def = renames_from(&fs, SCHUZKA_YML);
    let tpl = renames_from(&fs, "_templates/Schůzka");
    let objects: Vec<usize> = THREE.iter().flat_map(|(p, _)| renames_from(&fs, p)).collect();
    assert_eq!(def.len(), 1, "schůzka.yml is moved once: {def:?}");
    assert!(!tpl.is_empty() && objects.len() == 3, "the template and the three objects are moved: template {tpl:?}, objects {objects:?}");
    assert!(objects.iter().all(|o| tpl.iter().all(|t| o < t)) && tpl.iter().all(|t| *t < def[0]), "objects, then the template, then the definition (D-809): objects {objects:?}, template {tpl:?}, definition {def:?}");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-8

#[test]
fn fr_typ_05_ac8_undo_brings_everything_back_with_its_bytes_type_first() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let s0 = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let s1 = snapshot(&root);
    let mark = fs.ops().len();
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    let s2 = snapshot(&root);
    let bytes = |m: &std::collections::BTreeMap<String, common::Entry>| m.iter().filter(|(k, _)| !k.ends_with('/') && !k.starts_with(".trash/")).map(|(k, e)| (k.clone(), e.bytes.clone())).collect::<Vec<_>>();
    assert_eq!(bytes(&s2), bytes(&s0), "every path and every byte outside .trash/ as before the delete");
    for (_, to) in THREE {
        assert!(!root.join(to).exists(), "{to} left the trash");
    }
    assert_eq!(core.type_get("schůzka").map(|t| t.exists), Some(true), "the type exists again");
    assert_eq!(files(changed(&s1, &s2)), ten(), "Undo writes only the files the job wrote (FR-SYN-06 AC-36)");
    let back: Vec<usize> = landing_on(&fs, SCHUZKA_YML).into_iter().filter(|i| *i >= mark).collect();
    let objs: Vec<usize> = THREE.iter().flat_map(|(p, _)| landing_on(&fs, p)).filter(|i| *i >= mark).collect();
    assert!(!back.is_empty() && objs.len() == 3 && objs.iter().all(|o| *o > back[0]), "the type file comes back before the objects (ms4-jobs §14.9.4): type {back:?}, objects {objs:?}");
}

#[test]
fn fr_typ_05_ac8_undo_never_overwrites_a_path_taken_meanwhile() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let novy = "---\nid: 01JB4E0000000000000000E0A1\ntype: page\ntitle: Porada\n---\nNová porada jinde.\n";
    write_raw(&root, PORADA, novy.as_bytes());
    core.notify_changed(&[PORADA.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "setup: index idle");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(read_text(&root, PORADA).as_deref(), Some(novy), "the new Schůzky/Porada.md is never overwritten");
    assert_eq!(read_bytes(&root, ".trash/Schůzky/Porada.md"), Some(fx_bytes(PORADA)), "the trashed Porada stays in the trash");
    assert!(u.skipped.iter().any(|s| s.path.contains("Porada")), "and is listed (ms4-jobs §14.9.4 `taken`, red-test point AP-798): {u:?}");
    assert_eq!(read_bytes(&root, RETRO), Some(fx_bytes(RETRO)), "the others come back");
}

#[test]
fn fr_typ_05_ac8_cancel_while_writing_restores_the_trashed_objects_and_keeps_the_type() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    // Path order: Pages/Schůzka jinde.md, Schůzky/Porada.md, then Retro: the job stops before Retro's trash.
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let (at_tx, go_rx) = (Mutex::new(Some(at_tx)), Mutex::new(go_rx));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == RETRO) {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(10));
            }
        }
    })));
    let job = ok!(core.jobs().start(delete("schůzka")), "start type-delete");
    ok!(confirm_when_asked(&core, job), "confirm");
    let reached = at_rx.recv_timeout(Duration::from_secs(30)).is_ok();
    let c = core.jobs().cancel(job);
    let _ = go_tx.send(());
    assert!(reached, "the job reached Retro after trashing the first two");
    assert!(c.is_ok(), "cancellable in writing (board F2): {c:?}");
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    core.jobs().set_point_hook(None);
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    let after = snapshot(&root);
    for (from, _) in THREE {
        assert_eq!(after.get(from).map(|e| &e.bytes), before.get(from).map(|e| &e.bytes), "{from} is back at its path with its bytes");
    }
    assert_eq!(read_bytes(&root, SCHUZKA_YML), Some(fx_bytes(SCHUZKA_YML)), "the type stays (the definition is last)");
    assert_eq!(read_bytes(&root, T_SCHUZKA), Some(fx_bytes(T_SCHUZKA)), "the template stays");
    assert!(after.keys().all(|k| !k.starts_with(".trash/")), "nothing is left in the trash: {:?}", after.keys().filter(|k| k.starts_with(".trash/")).collect::<Vec<_>>());
}

#[test]
fn fr_typ_05_ac8_a_failed_job_leaves_the_type_in_place() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    tags_setup::read_only_backups(&sb.dirs);
    let r = run_confirmed(&core, delete("schůzka"));
    tags_setup::writable_again(&sb.dirs);
    let (_, report) = ok!(r, "type-delete");
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or("").contains("BackupFailed"), "BackupFailed (FR-HIS-04 AC-11): {:?}", report.error);
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical; the type is in place (data-safety AC-1)");
    assert_eq!(core.type_get("schůzka").map(|t| t.exists), Some(true), "Schůzka still exists");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-9

#[test]
fn fr_typ_05_ac9_a_skipped_object_keeps_the_type() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = format!("{}Dopsáno jinde.\n", fx(RETRO));
    let (r, t) = (root.clone(), theirs.clone());
    let once = Arc::new(Mutex::new(false));
    let o2 = once.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == RETRO) {
            let mut d = o2.lock().unwrap_or_else(|e| e.into_inner());
            if !*d {
                *d = true;
                write_raw(&r, RETRO, t.as_bytes()); // another program, before Retro is trashed
            }
        }
    })));
    let (_, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka");
    core.jobs().set_point_hook(None);
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(RETRO.to_string(), SkipReason::Changed)], "Retro is skipped `changed`");
    assert!(report.kept_type, "keptType: `1 object was not changed, so the type was kept.` (AP-770)");
    assert_eq!(read_text(&root, RETRO), Some(theirs), "Retro stays with the other program's bytes");
    assert_eq!(read_bytes(&root, ".trash/Schůzky/Porada.md"), Some(fx_bytes(PORADA)), "Porada is trashed");
    assert_eq!(read_bytes(&root, ".trash/Pages/Schůzka jinde.md"), Some(fx_bytes(SCH_JINDE)), "Schůzka jinde is trashed");
    assert_eq!(read_bytes(&root, SCHUZKA_YML), Some(fx_bytes(SCHUZKA_YML)), "the definition is kept");
    assert_eq!(read_bytes(&root, T_SCHUZKA), Some(fx_bytes(T_SCHUZKA)), "the template is kept");
    assert_eq!(core.type_get("schůzka").map(|t| t.exists), Some(true), "Retro still has its type");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-36

#[test]
fn fr_syn_06_ac36_a_type_delete_writes_exactly_its_planned_files_and_undo_the_same() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let s0 = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let plan = some!(core.jobs().plan(job), "the plan");
    let s1 = snapshot(&root);
    let wrote = files(changed(&s0, &s1));
    let sources: BTreeSet<String> = wrote.iter().filter(|p| !p.starts_with(".trash/")).cloned().collect();
    let planned: BTreeSet<String> = plan.trashes.iter().flat_map(|p| {
        // A planned folder (the templates) stands for the files under it.
        let under: Vec<String> = s0.keys().filter(|k| !k.ends_with('/') && k.starts_with(&format!("{p}/"))).cloned().collect();
        if under.is_empty() { vec![p.clone()] } else { under }
    }).collect();
    assert_eq!(sources, planned, "the files that left their paths equal the plan's trashes");
    assert_eq!(wrote, ten(), "and nothing else changed: every other file keeps bytes, mtime and inode");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(files(changed(&s1, &snapshot(&root))), wrote, "Undo writes only the files the job wrote");
}

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-05 AC-4 (D-809, D-842)

/// tests/fixtures/vaults/types (without README.md) plus new-empty/.tegg in `<sandbox>/Typy`.
fn types_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Typy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("types"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}

#[test]
fn fr_typ_05_ac4_a_type_with_objects_is_deleted_with_its_objects_and_undone() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let s0 = snapshot(&root);
    let objects = [
        ("Schůzky/2026-10-07 Porada.md", ".trash/Schůzky/2026-10-07 Porada.md"),
        ("Schůzky/Prázdná schůzka.md", ".trash/Schůzky/Prázdná schůzka.md"),
        ("Pages/Schůzka ve stránkách.md", ".trash/Pages/Schůzka ve stránkách.md"),
    ];
    let (job, report) = ok!(run_confirmed(&core, delete("schůzka")), "type-delete schůzka (types fixture)");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(fs.zip_before_first_write(), Some(true), "the backup zip comes first (D-57, NFR-REL-04 AC-1)");
    let s1 = snapshot(&root);
    let mut bad = Vec::new();
    for (from, to) in objects {
        if s1.contains_key(from) || s1.get(to).map(|e| &e.bytes) != s0.get(from).map(|e| &e.bytes) {
            bad.push(format!("{from} → {to}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "the 3 files are in .trash/ with their relative paths (FR-STO-08 AC-5)");
    assert_eq!(s1.get(SCHUZKA_YML_TRASHED).map(|e| &e.bytes), s0.get(SCHUZKA_YML).map(|e| &e.bytes), "then the definition is removed as AC-1 (to the trash)");
    assert!(!s1.contains_key(SCHUZKA_YML), "no live schůzka.yml");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo (the status element's)");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    let s2 = snapshot(&root);
    let live = |m: &std::collections::BTreeMap<String, common::Entry>| m.iter().filter(|(k, _)| !k.ends_with('/') && !k.starts_with(".trash/")).map(|(k, e)| (k.clone(), e.bytes.clone())).collect::<Vec<_>>();
    assert_eq!(live(&s2), live(&s0), "Undo restores the files and the definition");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-06 AC-1 (this job)

#[test]
fn fr_typ_06_ac1_type_delete_refuses_system_and_unknown_types() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    for key in ["page", "task", "quick-note", "daily-note", "tag", "image", "pdf"] {
        let r = core.jobs().start(delete(key));
        assert!(matches!(r, Err(JobError::SystemType)), "{key}: a system type is refused (FR-TYP-06 AC-1): {r:?}");
    }
    let r = core.jobs().start(delete("recept"));
    assert!(matches!(r, Err(JobError::UnknownType)), "recept has no definition: UnknownType: {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "nothing is written");
}
