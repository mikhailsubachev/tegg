//! Slice 4E-1 AC tests of the `folder-move` job (L4): docs/acceptance/type-moves.md FR-STO-01 AC-8 (folder save),
//! AC-9 (tidy), AC-10 (after the quiet period, injected), AC-11 (skips and later retries, with the sync simulator's job
//! points), AC-12 (undo and the exemption list), AC-13 (progress, cancel in planning, restore of the zip), and of "Both
//! parts" FR-HIS-04 AC-11 (folder-move part) and FR-SYN-06 AC-36 (folder-move part); on a temporary copy of the
//! type-moves fixture on APFS with the real `@tegg/doc` transformer (`NodeTransformer`, D-82).
//! Interface: docs/contracts/ms4-jobs.md §14.1 (kind flags), §14.2 (`JobOp::FolderMove { r#type, to_folder }`), §14.3
//! (planner), §14.6 (undo, `tidy-exempt.json`), §14.7 (the tidy job at vault open and after `TEGG_TEST_QUIET_MS` without
//! a watcher event; `type_patch` writes the folder first), ms4-jobs §4…§6, ms4-tags §5.3 (restore).
//! Written from the ACs and the contracts only (D-61). Every API result goes through `ok!`/`some!` or an `assert!`
//! here, so the 4E-1 stubs fail on assertions (TS-I1).
//!
//! Red-test points (see the red-test report): the Rust `Core::type_patch` is taken to write the type file only and the
//! caller starts the `folder-move` job (AP-775, the IPC `type_patch` does both); the tidy job is started by a core that
//! watches the vault (AP-774); a pending FR-SYN-04 conflict and a cancel during `backup` have no L4 injection point
//! (AP-778), so AC-11 and AC-13 cover "changed meanwhile" and cancel in `planning` here.

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::collections::BTreeSet;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{changed, open_core, open_core_with, read_bytes, read_text, sandbox, set, snapshot, wait_until, write_raw};
use moves_setup::*;
use tegg_core::CoreEvent;
use tegg_jobs::{JobKind, JobOp, JobPoint, Phase, SkipReason};
use tegg_schema::TypeOp;

/// The quiet period these tests inject (the product's is 30 s, AP-766).
const QUIET_MS: u64 = 2000;

fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    files_only(s)
}
fn run(core: &tegg_core::Core, op: JobOp) -> Result<(tegg_jobs::JobId, tegg_jobs::JobReport), String> {
    common::run_job(core, op)
}
/// Writes `folder: <f>` into the type file through the core (as the IPC `type_patch` does first, ms4-jobs §14.7).
fn set_folder(core: &tegg_core::Core, key: &str, folder: &str) -> Result<(), String> {
    let base = core.type_get(key).and_then(|t| t.version);
    core.type_patch(key, base.as_ref(), &[TypeOp::SetFolder(folder.into())]).map(|_| ()).map_err(|e| format!("type_patch: {e:?}"))
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-8

#[test]
fn fr_sto_01_ac8_saving_a_new_folder_moves_the_six_knihy() {
    let f = JobKind::FolderMove.flags();
    assert_eq!((f.needs_confirm, f.backup, f.undoable), (false, true, true), "folder-move: no confirmation (D-805), zip, undoable (ms4-jobs §14.1)");
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    ok!(set_folder(&core, "kniha", "Četba"), "folder: Četba");
    assert!(read_text(&root, KNIHA_YML).unwrap_or_default().contains("\nfolder: Četba\n"), "kniha.yml has folder: Četba");
    let (_, report) = ok!(run(&core, folder_save("kniha", "Četba")), "folder-move kniha → Četba");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::FolderMove, "kind folder-move");
    let mut bad = Vec::new();
    for (from, to) in SIX {
        if root.join(from).exists() || read_bytes(&root, to) != Some(fx_bytes(from)) {
            bad.push(format!("{from} → {to}"));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "each of the six is in Četba/ (Starý zápis at its root) with its exact bytes: no modified, no link change");
    assert!(root.join(DOCX).exists() && root.join("Knihy").is_dir() && root.join("Knihy/2025").is_dir(), "seznam.docx and the emptied folders stay (data-safety AC-6)");
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip: {z:?}");
    assert!(z[0].ends_with("-folder-move.zip"), "<UTC time>-folder-move.zip: {}", z[0]);
    let label = core.backups().first().map(|b| (b.label.key.clone(), b.label.args.clone()));
    assert!(label.as_ref().is_some_and(|(_, a)| a.to_string().contains("Četba")), "the zip's label names the folder (`Move knihy to Četba`): {label:?}");
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip exists before the first move (FR-HIS-04 AC-11)");
    let mut want: BTreeSet<String> = SIX.iter().flat_map(|(a, b)| [a.to_string(), b.to_string()]).collect();
    want.insert(KNIHA_YML.into());
    assert_eq!(files(changed(&before, &snapshot(&root))), want, "the six, their new paths and kniha.yml; nothing else");
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-9

#[test]
fn fr_sto_01_ac9_the_tidy_job_moves_the_two_strays_only() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, ".trash/Pages/Stará kniha.md", "---\nid: 01JB4E0000000000000000E097\ntype: kniha\ntitle: Stará kniha\n---\n".as_bytes());
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_bytes(&root, "Knihy/Kniha jinde.md"), Some(fx_bytes(JINDE)), "Kniha jinde → Knihy/ with its bytes");
    assert_eq!(read_bytes(&root, "Schůzky/Schůzka jinde.md"), Some(fx_bytes(SCH_JINDE)), "Schůzka jinde → Schůzky/ with its bytes");
    assert_eq!(
        files(changed(&before, &snapshot(&root))),
        set(&[JINDE, "Knihy/Kniha jinde.md", SCH_JINDE, "Schůzky/Schůzka jinde.md"]),
        "never moved: Volná (no type), Recept (no definition), _templates/, .trash/, Starý zápis (a subfolder of its type's folder), seznam.docx"
    );
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip (`Tidy folders`): {z:?}");
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip comes first");
}

#[test]
fn fr_sto_01_ac9_with_nothing_to_move_the_tidy_job_writes_nothing_and_shows_nothing() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    std::fs::remove_file(root.join(JINDE)).expect("setup: no Kniha stray");
    std::fs::remove_file(root.join(SCH_JINDE)).expect("setup: no Schůzka stray");
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let rx = core.events();
    let before = snapshot(&root);
    let (job, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "an empty plan ends done: {report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "no write");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "no zip (D-811)");
    let mut after_planning = Vec::new();
    while let Ok(ev) = rx.recv_timeout(Duration::from_millis(200)) {
        if let CoreEvent::JobProgress(p) = ev {
            if p.job == job && !matches!(p.phase, Phase::Queued | Phase::Planning | Phase::Done) {
                after_planning.push(p.phase);
            }
        }
    }
    assert_eq!(after_planning, Vec::<Phase>::new(), "no progress event after planning (nothing is shown)");
}

#[test]
fn fr_sto_01_ac9_on_vault_open_the_strays_are_moved() {
    inject_quiet(QUIET_MS);
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, true), "open with the watcher");
    let rx = core.events();
    let job = first_job_of(&rx, JobKind::FolderMove, 20_000);
    assert!(job.is_some(), "the core starts a folder-move (tidy) job at vault open, after the first index");
    let moved = wait_until(Duration::from_secs(20), || root.join("Knihy/Kniha jinde.md").exists() && root.join("Schůzky/Schůzka jinde.md").exists());
    assert!(moved, "both strays are moved to their folders");
    assert!(root.join(STARY).exists() && root.join(VOLNA).exists() && root.join(RECEPT).exists(), "the others stay");
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-10

#[test]
fn fr_sto_01_ac10_an_external_stray_moves_after_the_quiet_period_not_before() {
    inject_quiet(QUIET_MS);
    let sb = sandbox();
    let root = moves_vault(&sb);
    std::fs::remove_file(root.join(JINDE)).expect("setup");
    std::fs::remove_file(root.join(SCH_JINDE)).expect("setup");
    let core = ok!(open_core(&root, &sb.dirs, true), "open with the watcher");
    std::thread::sleep(Duration::from_millis(QUIET_MS + 1000)); // the open-time tidy (nothing to move) is over
    let nova = "---\nid: 01JB4E0000000000000000E098\ntype: kniha\ntitle: Nová kniha\n---\nZ jiného programu.\n";
    let t0 = Instant::now();
    write_raw(&root, "Pages/Nová kniha.md", nova.as_bytes());
    std::thread::sleep(Duration::from_millis(QUIET_MS / 2));
    assert!(root.join("Pages/Nová kniha.md").exists(), "not moved before the quiet period");
    let moved = wait_until(Duration::from_millis(QUIET_MS * 4), || root.join("Knihy/Nová kniha.md").exists());
    assert!(moved, "moved to Knihy/ after the quiet period");
    assert!(t0.elapsed() >= Duration::from_millis(QUIET_MS), "not before {QUIET_MS} ms of quiet");
    assert_eq!(read_text(&root, "Knihy/Nová kniha.md").as_deref(), Some(nova), "with its bytes");
    drop(core);
}

#[test]
fn fr_sto_01_ac10_events_keep_resetting_the_quiet_period() {
    inject_quiet(QUIET_MS);
    let sb = sandbox();
    let root = moves_vault(&sb);
    std::fs::remove_file(root.join(JINDE)).expect("setup");
    std::fs::remove_file(root.join(SCH_JINDE)).expect("setup");
    let core = ok!(open_core(&root, &sb.dirs, true), "open with the watcher");
    std::thread::sleep(Duration::from_millis(QUIET_MS + 1000));
    write_raw(&root, "Pages/Nová kniha.md", b"---\nid: 01JB4E0000000000000000E098\ntype: kniha\ntitle: Nova\n---\n");
    // Keep the vault busy (a note being typed in) for three quiet periods: a write every QUIET_MS / 4.
    let busy_until = Instant::now() + Duration::from_millis(QUIET_MS * 3);
    let mut n = 0;
    let mut early = false;
    while Instant::now() < busy_until {
        n += 1;
        write_raw(&root, "Pages/Výplň 01.md", format!("---\nid: 01JB4E0000000000000000E031\ntype: page\ntitle: Výplň 01\n---\nPsaní {n}.\n").as_bytes());
        std::thread::sleep(Duration::from_millis(QUIET_MS / 4));
        early |= root.join("Knihy/Nova.md").exists() || !root.join("Pages/Nová kniha.md").exists();
    }
    assert!(!early, "the stray is not moved while events keep coming");
    let moved = wait_until(Duration::from_millis(QUIET_MS * 4), || !root.join("Pages/Nová kniha.md").exists() && root.join("Knihy/Nová kniha.md").exists());
    assert!(moved, "moved after the quiet period that follows the last event");
    drop(core);
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-11

#[test]
fn fr_sto_01_ac11_a_stray_changed_meanwhile_is_skipped_and_moved_by_the_next_run() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = fx(JINDE) + "Dopsáno jinde.\n";
    let (r, t) = (root.clone(), theirs.clone());
    let done = Arc::new(Mutex::new(false));
    let d2 = done.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == JINDE) {
            let mut d = d2.lock().unwrap_or_else(|e| e.into_inner());
            if !*d {
                *d = true;
                write_raw(&r, JINDE, t.as_bytes()); // another program, between planning and the write
            }
        }
    })));
    let (_, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(JINDE.to_string(), SkipReason::Changed)], "Kniha jinde is skipped `changed` and listed");
    assert_eq!(read_text(&root, JINDE), Some(theirs.clone()), "not moved, not written");
    assert!(root.join("Schůzky/Schůzka jinde.md").exists(), "the other stray is moved");
    core.jobs().set_point_hook(None);
    let (_, again) = ok!(run(&core, tidy()), "the next tidy run");
    assert_eq!(again.phase, Phase::Done, "{again:?}");
    assert_eq!(read_text(&root, "Knihy/Kniha jinde.md"), Some(theirs), "the next run moves it, with the other program's bytes");
}

#[test]
fn fr_sto_01_ac11_a_linking_note_changed_meanwhile_is_skipped_and_listed() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let linking = "Pages/Na knihu.md";
    let text = "---\nid: 01JB4E0000000000000000E099\ntype: page\ntitle: Na knihu\n---\n[[Pages/Kniha jinde]]\n";
    write_raw(&root, linking, text.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = format!("{text}Dopsáno jinde.\n");
    let (r, t) = (root.clone(), theirs.clone());
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == linking) {
            write_raw(&r, linking, t.as_bytes());
        }
    })));
    let (_, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert!(root.join("Knihy/Kniha jinde.md").exists(), "the stray is moved");
    assert_eq!(read_text(&root, linking), Some(theirs), "the changed linking note is not written");
    assert!(report.skipped.iter().any(|s| s.path == linking && s.reason == SkipReason::Changed), "and is listed `changed` (ms4-jobs §5): {report:?}");
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-12

#[test]
fn fr_sto_01_ac12_undo_moves_the_strays_back_and_later_tidy_runs_leave_them() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(core.jobs().last_undoable(), Some(job), "the tidy job is undoable (AP-767)");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, JINDE), Some(fx_bytes(JINDE)), "Kniha jinde back with its pre-job bytes");
    assert_eq!(read_bytes(&root, SCH_JINDE), Some(fx_bytes(SCH_JINDE)), "Schůzka jinde back with its pre-job bytes");
    let ex = tidy_exempt(&sb.dirs);
    let ids: BTreeSet<String> = ex.as_ref().and_then(|v| v["ids"].as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    assert_eq!(ex.as_ref().map(|v| v["version"].clone()), Some(serde_json::json!(1)), "tidy-exempt.json version 1: {ex:?}");
    assert_eq!(ids, set(&[JINDE_ID, SCH_JINDE_ID]), "both ids are exempt (ms4-jobs §14.6)");
    let before = snapshot(&root);
    let zips = zip_names(&sb.dirs).len();
    let (_, again) = ok!(run(&core, tidy()), "the next tidy run");
    assert_eq!(again.phase, Phase::Done, "{again:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the next tidy run doesn't move them again");
    assert_eq!(zip_names(&sb.dirs).len(), zips, "and makes no zip");
    // Until their type's folder changes: the folder save moves Kniha jinde and its id leaves the list.
    ok!(set_folder(&core, "kniha", "Četba"), "folder: Četba");
    let (_, fm) = ok!(run(&core, folder_save("kniha", "Četba")), "folder-move kniha → Četba");
    assert_eq!(fm.phase, Phase::Done, "{fm:?}");
    assert!(root.join("Četba/Kniha jinde.md").exists(), "moved by the folder save");
    let left: BTreeSet<String> = tidy_exempt(&sb.dirs).and_then(|v| v["ids"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())).unwrap_or_default();
    assert_eq!(left, set(&[SCH_JINDE_ID]), "Kniha jinde's id leaves the list when its type's folder changes");
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-13

/// The fixture plus 494 more Knihy in `Knihy/` (500 Kniha objects; the AC's reference vault is used at L6).
fn five_hundred(root: &std::path::Path) {
    for i in 1..=494 {
        write_raw(root, &format!("Knihy/Kniha {i:03}.md"), format!("---\nid: 01JB4E00000000000000K{i:05}\ntype: kniha\ntitle: Kniha {i:03}\nautor: Autor číslo {i}\n---\nObsah knihy {i}.\n").as_bytes());
    }
}

#[test]
fn fr_sto_01_ac13_progress_of_a_500_object_folder_move() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    five_hundred(&root);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    assert_eq!(core.list_type("kniha").len(), 500, "setup: 500 Knihy");
    ok!(set_folder(&core, "kniha", "Četba"), "folder: Četba");
    let rx = core.events();
    let (_, report) = ok!(run(&core, folder_save("kniha", "Četba")), "folder-move of 500");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let ev = progress_until_final(&rx, JobKind::FolderMove, 5000);
    let writing: Vec<_> = ev.iter().filter(|p| p.phase == Phase::Writing).collect();
    assert!(!writing.is_empty(), "progress events while writing: {ev:?}");
    assert!(writing.iter().all(|p| p.total == 500), "total 500 (`Moving knihy · <done> of 500`)");
    assert!(writing.windows(2).all(|w| w[0].done <= w[1].done), "done never decreases (FR-UX-07 AC-8)");
    assert!(ev.last().is_some_and(|p| p.phase == Phase::Done && p.counts.is_some()), "a final event with counts");
    assert_eq!(std::fs::read_dir(root.join("Četba")).map(|d| d.count()).unwrap_or(0), 500, "all 500 in Četba/");
}

#[test]
fn fr_sto_01_ac13_cancel_in_planning_leaves_the_vault_and_makes_no_zip() {
    let sb = sandbox();
    let root = moves_vault(&sb);
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
    let job = ok!(core.jobs().start(tidy()), "start the tidy job");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let c = core.jobs().cancel(job);
    let _ = go_tx.send(());
    assert!(c.is_ok(), "cancellable in planning: {c:?}");
    let report = some!(core.jobs().wait(job, Duration::from_secs(10)), "report");
    assert_eq!(report.phase, Phase::Cancelled, "{report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "no zip");
}

#[test]
fn fr_sto_01_ac13_restoring_the_zip_moves_every_file_back() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    ok!(set_folder(&core, "kniha", "Četba"), "folder: Četba");
    let (_, report) = ok!(run(&core, folder_save("kniha", "Četba")), "folder-move kniha → Četba");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "the job's zip: {z:?}");
    let (_, restore) = ok!(run(&core, JobOp::Restore { name: z[0].clone() }), "restore the zip (ms4-tags §5.3)");
    assert_eq!(restore.phase, Phase::Done, "{restore:?}");
    let mut bad = Vec::new();
    for (from, to) in SIX {
        if read_bytes(&root, from) != Some(fx_bytes(from)) || root.join(to).exists() {
            bad.push(from.to_string());
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "every file is back at its pre-job path with its pre-job bytes");
    assert_eq!(read_bytes(&root, KNIHA_YML), before.get(KNIHA_YML).map(|e| e.bytes.clone()), "kniha.yml as before the job");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-11

#[test]
fn fr_his_04_ac11_a_folder_move_with_a_failed_zip_writes_nothing() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    tags_setup::read_only_backups(&sb.dirs);
    let r = run(&core, tidy());
    tags_setup::writable_again(&sb.dirs);
    let (_, report) = ok!(r, "the tidy job");
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or("").contains("BackupFailed"), "BackupFailed: {:?}", report.error);
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical (data-safety AC-1)");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-36

#[test]
fn fr_syn_06_ac36_a_folder_move_writes_exactly_its_planned_files_and_undo_the_same() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let s0 = snapshot(&root);
    let (job, report) = ok!(run(&core, tidy()), "the tidy job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let plan = some!(core.jobs().plan(job), "the plan");
    let mut planned: BTreeSet<String> = plan.files.iter().map(|f| f.path.clone()).collect();
    for (a, b) in &plan.renames {
        planned.insert(a.clone());
        planned.insert(b.clone());
    }
    let s1 = snapshot(&root);
    let wrote = files(changed(&s0, &s1));
    assert_eq!(wrote, planned, "the written files equal the plan's files");
    assert!(!wrote.is_empty(), "the tidy job moved the strays");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    let s2 = snapshot(&root);
    assert_eq!(files(changed(&s1, &s2)), wrote, "Undo writes only the files the job wrote");
}
