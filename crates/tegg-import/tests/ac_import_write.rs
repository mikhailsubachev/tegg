//! Slice I1, L4 with the crash harness: the write phase (docs/acceptance/import-capacities.md FR-IMP-03 AC-3, AC-4,
//! AC-5, AC-12…AC-15, all T1; R149; docs/contracts/v1-import.md §2.1, §9.2, §9.4, §9.5, §9.6; ms4-jobs §8). A **kill**
//! is a point hook that panics (the engine then runs no roll-back and no clean-up, §2.1) and, once, a child process of
//! this test binary killed with SIGKILL. Kill loops walk **every** point a recording run raised. An injected failure
//! is `PointAction::Fail`. The owner's pre-existing files are always compared byte for byte, with mtime and inode.
//! Written from the criteria, the contract and the fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_import::{FileKind, ImportEnv, ImportError, ImportPoint, ImportReport, Mapping, PointAction, Target};
use tegg_jobs::{Phase, ResolveChoice};

const BOOK_YML: &str = ".tegg/types/book.yml";

fn bytes_of(root: &Path) -> BTreeMap<String, Vec<u8>> {
    snapshot(root).into_iter().filter(|(k, _)| !k.ends_with('/')).map(|(k, v)| (k, v.bytes)).collect()
}
/// Plans `fixture` against a new vault and starts the write with `env`; waits for the end (or `fired`, for a kill).
fn run_new(sb: &Sandbox, src: &Path, env: &ImportEnv, fired: Option<&Arc<AtomicBool>>) -> Result<Option<ImportReport>, String> {
    let plain = common::env(sb)?;
    let scan = scan_of(src, &plain)?;
    let target = new_target(sb);
    let plan = plan_of(&scan, SPACE, &target, &Mapping::default(), &plain)?;
    let run = tegg_import::start(plan, &scan, &target, env).map_err(|e| format!("start: {e:?}"))?;
    Ok(wait_run(&run, fired))
}
fn wait_run(run: &tegg_import::ImportRun, fired: Option<&Arc<AtomicBool>>) -> Option<ImportReport> {
    match fired {
        // A killed run never reports: wait for the kill, then give the unwinding thread a moment.
        Some(f) => {
            let mut report = None;
            wait_until(Duration::from_secs(120), || {
                report = run.report();
                f.load(Ordering::SeqCst) || report.is_some()
            });
            report.or_else(|| run.wait(Duration::from_millis(300)))
        }
        None => run.wait(Duration::from_secs(120)),
    }
}
/// The same against an open vault.
fn run_into(sb: &Sandbox, core: &tegg_core::Core, src: &Path, env: &ImportEnv, fired: Option<&Arc<AtomicBool>>) -> Result<Option<ImportReport>, String> {
    let plain = common::env(sb)?;
    let scan = scan_of(src, &plain)?;
    let target = Target::Existing(core);
    let plan = plan_of(&scan, SPACE, &target, &Mapping::default(), &plain)?;
    let run = tegg_import::start(plan, &scan, &target, env).map_err(|e| format!("start: {e:?}"))?;
    Ok(wait_run(&run, fired))
}
/// A hook that fails with `kind` at the `nth` (1-based) point matching `pick`.
fn fail_at(nth: usize, kind: std::io::ErrorKind, pick: impl Fn(&ImportPoint) -> bool + Send + Sync + 'static) -> tegg_import::PointHook {
    let n = AtomicUsize::new(0);
    Arc::new(move |p: &ImportPoint| if pick(p) && n.fetch_add(1, Ordering::SeqCst) + 1 == nth { PointAction::Fail(kind) } else { PointAction::Continue })
}
/// A hook that calls `act` once, at the `nth` (1-based) point matching `pick`.
fn act_at(nth: usize, pick: impl Fn(&ImportPoint) -> bool + Send + Sync + 'static, act: impl Fn(&ImportPoint) + Send + Sync + 'static) -> tegg_import::PointHook {
    let n = AtomicUsize::new(0);
    Arc::new(move |p: &ImportPoint| {
        if pick(p) && n.fetch_add(1, Ordering::SeqCst) + 1 == nth {
            act(p);
        }
        PointAction::Continue
    })
}
fn is_object_before(p: &ImportPoint) -> bool {
    matches!(p, ImportPoint::BeforeTemp { kind: FileKind::Object, .. })
}
/// The journal logs under `<Application Support>/Tegg/jobs/` (§9.6), concatenated.
fn journal(dirs: &tegg_vault::AppDirs) -> String {
    snapshot(&dirs.root.join("jobs")).into_iter().filter(|(k, _)| k.ends_with(".log")).map(|(_, v)| String::from_utf8_lossy(&v.bytes).into_owned()).collect()
}
/// The end state both the failure and `Undo` must give: nothing added, nothing but book.yml's mtime / inode changed,
/// book.yml's bytes as before, no temp file, no folder the vault didn't have.
fn assert_rolled_back(root: &Path, before: &BTreeMap<String, Entry>, what: &str) {
    let after = snapshot(root);
    assert_eq!(added(before, &after), BTreeSet::new(), "{what}: every file the run created is removed");
    let t = touched(before, &after);
    assert!(t.is_subset(&set(&[BOOK_YML])), "{what}: every other pre-existing file is untouched (bytes, mtime, inode): {t:?}");
    assert_eq!(after.get(BOOK_YML).map(|e| &e.bytes), before.get(BOOK_YML).map(|e| &e.bytes), "{what}: book.yml again has its bytes from before the run");
    let dirs = |s: &BTreeMap<String, Entry>| s.keys().filter(|k| k.ends_with('/')).cloned().collect::<BTreeSet<_>>();
    assert_eq!(dirs(&after), dirs(before), "{what}: a folder the run created is removed when empty; the folders that existed stay");
    assert_eq!(temp_files(root), Vec::<String>::new(), "{what}: no .tegg-tmp file is left");
}

// ------------------------------------------------------------------------------------------------ AC-3

#[test]
fn fr_imp_03_ac3_atomic_writes_survive_a_kill() {
    let src = fixtures().join("c05-media-objects");
    // The reference: a full run, and every point it raises.
    let reference_sb = sandbox();
    let points = Points::default();
    let mut env = ok!(env(&reference_sb), "env");
    env.points = Some(hook(&points, |_, _| PointAction::Continue));
    let done = some!(ok!(run_new(&reference_sb, &src, &env, None), "the reference run"), "its report");
    assert_eq!(done.phase, Phase::Done, "the reference run finished: {:?}", done.error);
    let reference = bytes_of(&reference_sb.new_vault());
    let seen = points.seen();
    // Every file: BeforeTemp, TempWritten, Renamed, in that order, created exactly once.
    let per_file: Vec<(String, FileKind)> = seen.iter().filter_map(|p| match p { ImportPoint::Renamed { path, kind } => Some((path.clone(), *kind)), _ => None }).collect();
    assert_eq!(per_file.iter().map(|(p, _)| p.clone()).collect::<BTreeSet<_>>().len(), per_file.len(), "each file is renamed into place once");
    assert_eq!(per_file.iter().filter(|(p, _)| p != ".tegg-import").map(|(p, _)| p.clone()).collect::<BTreeSet<_>>(), reference.keys().cloned().collect(), "every file of the vault was created through the three file points");
    for (path, kind) in &per_file {
        let i = |want: &ImportPoint| seen.iter().position(|p| p == want);
        let (b, t, r) = (i(&ImportPoint::BeforeTemp { path: path.clone(), kind: *kind }), i(&ImportPoint::TempWritten { path: path.clone(), kind: *kind }), i(&ImportPoint::Renamed { path: path.clone(), kind: *kind }));
        assert!(b.is_some() && b < t && t < r, "{path}: before the temp file, after it, after the rename, in this order");
    }
    let kinds: Vec<FileKind> = per_file.iter().map(|(_, k)| *k).collect();
    let mut order = kinds.clone();
    order.dedup();
    assert_eq!(order, [FileKind::Marker, FileKind::VaultFile, FileKind::Attachment, FileKind::Object, FileKind::Report], "R149's order: the marker, the vault's own files, attachments, objects, the report");
    assert_eq!(kinds.iter().filter(|k| **k == FileKind::Attachment).count(), 4, "four attachments");

    // The kill, at each point in turn.
    for (i, point) in seen.iter().enumerate() {
        let sb = sandbox();
        let fired = Arc::new(AtomicBool::new(false));
        let mut env = ok!(common::env(&sb), "env");
        env.points = Some(kill_at(i, &fired));
        let report = ok!(run_new(&sb, &src, &env, Some(&fired)), format!("kill {i} at {point:?}: start"));
        assert!(fired.load(Ordering::SeqCst), "kill {i}: the run reached {point:?}");
        assert!(report.is_none_or(|r| r.phase != Phase::Done) || matches!(point, ImportPoint::AfterFinalRename), "kill {i}: a killed run doesn't report Done");
        let finished = matches!(point, ImportPoint::AfterFinalRename);
        assert_eq!(sb.new_vault().exists(), finished, "kill {i} at {point:?}: a folder with the final name exists only when it is complete");
        let on_disk = if finished { sb.new_vault() } else { sb.importing() };
        for (path, bytes) in bytes_of(&on_disk) {
            if path.contains(".tegg-tmp") || path == ".tegg-import" {
                continue;
            }
            assert_eq!(Some(&bytes), reference.get(&path), "kill {i} at {point:?}: {path} is either absent or complete (the bytes of a full run): no partly written .md, no partly copied attachment under its final name");
        }
        // A kill before the marker exists leaves a folder without it: the engine never removes or writes into such a
        // folder (FR-IMP-03 AC-14), so the next import of that name answers TargetExists and the folder stays.
        if !finished && sb.importing().exists() && !sb.importing().join(".tegg-import").exists() {
            let left = snapshot(&sb.importing());
            let next = run_new(&sb, &src, &ok!(common::env(&sb), "env"), None);
            assert!(matches!(&next, Err(e) if e.contains("TargetExists")), "kill {i} at {point:?}: a leftover without the marker is TargetExists: {:?}", next.map(|r| r.map(|r| r.phase)));
            assert_eq!(snapshot(&sb.importing()), left, "kill {i}: and it is left as it was");
            assert!(left.keys().all(|k| k.contains(".tegg-tmp") || k.ends_with('/')), "kill {i}: it holds no file under a final name: {:?}", left.keys().collect::<Vec<_>>());
            continue;
        }
        // Reopening: the next import of that name moves the leftover to the Trash and writes a whole vault.
        if !finished {
            let again = some!(ok!(run_new(&sb, &src, &ok!(common::env(&sb), "env"), None), format!("kill {i}: the next import")), "its report");
            assert_eq!(again.phase, Phase::Done, "kill {i}: the next import finishes: {:?}", again.error);
        }
        let vault: BTreeMap<String, Vec<u8>> = bytes_of(&sb.new_vault()).into_iter().filter(|(k, _)| k != ".tegg-import").collect();
        assert_eq!(vault, reference, "kill {i} at {point:?}: the vault is complete, with no .tegg-tmp file");
        assert!(!sb.importing().exists(), "kill {i}: no temporary folder is left in the place");
    }
}

#[test]
fn fr_imp_03_ac3_a_sigkilled_import_leaves_whole_files_only() {
    const NAME: &str = "fr_imp_03_ac3_a_sigkilled_import_leaves_whole_files_only";
    let src = fixtures().join("c05-media-objects");
    if let (Ok(base), Ok(n)) = (std::env::var("TEGG_IMPORT_KILL_BASE"), std::env::var("TEGG_IMPORT_KILL_AT")) {
        // The child: runs the import and stops for ever at point `n` (its parent kills it with SIGKILL).
        let base = PathBuf::from(base);
        let sb = Sandbox { tmp: tempfile::tempdir().expect("setup: tempdir"), base: base.clone(), dirs: tegg_vault::AppDirs { root: base.join("Application Support/Tegg") } };
        let n: usize = n.parse().expect("setup: point index");
        let count = AtomicUsize::new(0);
        let mut env = ok!(env(&sb), "child: env");
        env.points = Some(Arc::new(move |_p: &ImportPoint| {
            if count.fetch_add(1, Ordering::SeqCst) == n {
                std::fs::write(base.join("ready"), b"1").expect("child: ready file");
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            PointAction::Continue
        }));
        let report = ok!(run_new(&sb, &src, &env, None), "child: the import");
        assert!(report.is_some_and(|r| r.phase == Phase::Done), "child: the import finished before point {n} (the parent then sees no ready file)");
        return;
    }
    let reference_sb = sandbox();
    let points = Points::default();
    let mut env = ok!(env(&reference_sb), "env");
    env.points = Some(hook(&points, |_, _| PointAction::Continue));
    let done = some!(ok!(run_new(&reference_sb, &src, &env, None), "the reference run"), "its report");
    assert_eq!(done.phase, Phase::Done, "the reference run finished: {:?}", done.error);
    let reference = bytes_of(&reference_sb.new_vault());
    let total = points.seen().len();
    assert!(total > 30, "the run raised its points: {total}");
    // Every seventh point, and the three points of one attachment.
    let first_attachment = points.seen().iter().position(|p| matches!(p, ImportPoint::BeforeTemp { kind: FileKind::Attachment, .. })).unwrap_or(0);
    let picks: BTreeSet<usize> = (0..total).step_by(7).chain(first_attachment..first_attachment + 3).collect();
    for i in picks {
        let sb = sandbox();
        let mut child = std::process::Command::new(std::env::current_exe().expect("setup: test binary"))
            .args(["--exact", NAME, "--test-threads", "1"])
            .env("TEGG_IMPORT_KILL_BASE", &sb.base)
            .env("TEGG_IMPORT_KILL_AT", i.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("setup: spawn the child");
        let ready = wait_until(Duration::from_secs(120), || sb.base.join("ready").exists() || child.try_wait().ok().flatten().is_some());
        let stopped_at_point = ready && sb.base.join("ready").exists();
        let _ = child.kill(); // SIGKILL
        let _ = child.wait();
        assert!(stopped_at_point, "SIGKILL {i}: the child reached point {i} of the write");
        let finished = sb.new_vault().exists();
        let on_disk = if finished { sb.new_vault() } else { sb.importing() };
        for (path, bytes) in bytes_of(&on_disk) {
            if !path.contains(".tegg-tmp") && path != ".tegg-import" {
                assert_eq!(Some(&bytes), reference.get(&path), "SIGKILL {i}: {path} is absent or complete");
            }
        }
        if finished {
            assert_eq!(bytes_of(&sb.new_vault()).into_iter().filter(|(k, _)| k != ".tegg-import").collect::<BTreeMap<_, _>>(), reference, "SIGKILL {i}: a folder with the final name is complete");
        } else if sb.importing().join(".tegg-import").exists() {
            let again = some!(ok!(run_new(&sb, &src, &ok!(common::env(&sb), "env"), None), format!("SIGKILL {i}: the next import")), "its report");
            assert_eq!(again.phase, Phase::Done, "SIGKILL {i}: the next import finishes: {:?}", again.error);
            assert_eq!(bytes_of(&sb.new_vault()), reference, "SIGKILL {i}: and writes the whole vault, with no .tegg-tmp file");
            assert!(snapshot(&sb.base.join("Koš")).keys().any(|k| k.ends_with(".tegg-import")), "SIGKILL {i}: the dead run's leftover is in the Trash, with its marker");
        }
    }
}

// ------------------------------------------------------------------------------------------------ AC-4

#[test]
fn fr_imp_03_ac4_failed_new_vault_leaves_nothing() {
    for point in ["before the temp file", "after the temp file"] {
        let sb = sandbox();
        let src = source(&sb, "c01-spaces");
        let before = (snapshot(&src), snapshot(&sb.place()));
        let mut env = ok!(env(&sb), "env");
        let after_temp = point == "after the temp file";
        env.points = Some(fail_at(3, std::io::ErrorKind::StorageFull, move |p| if after_temp { matches!(p, ImportPoint::TempWritten { kind: FileKind::Object, .. }) } else { is_object_before(p) }));
        let report = some!(ok!(run_new(&sb, &src, &env, None), "the failing run"), "its report");
        assert_eq!(report.phase, Phase::Failed, "{point}: ENOSPC on the 3rd object write ends the job failed");
        match &report.error {
            Some(ImportError::Write { path, reason }) => assert!(path == "Tasks/PKM task.md" && !reason.is_empty(), "{point}: with the reason, naming the file: {path} / {reason}"),
            other => assert!(false, "{point}: the error is Write, got {other:?}"),
        }
        assert!(report.written.is_empty() && report.vault.is_none(), "{point}: nothing is reported as written");
        assert!(!sb.new_vault().exists(), "{point}: no folder named `Capacities · PKM` exists in the chosen place");
        assert!(!sb.importing().exists(), "{point}: the temporary folder the engine wrote into is removed");
        assert_eq!((snapshot(&src), snapshot(&sb.place())), before, "{point}: the source is untouched and the place is as before");
        assert_eq!(snapshot(&sb.base.join("Koš")).len(), 0, "{point}: the run's own folder is removed, not moved to the Trash");
        // A second run with the failure removed succeeds.
        let second = some!(ok!(run_new(&sb, &src, &ok!(common::env(&sb), "env"), None), "the second run"), "its report");
        assert_eq!((second.phase, second.vault.clone()), (Phase::Done, Some(sb.new_vault())), "{point}: the second run succeeds: {:?}", second.error);
        assert_eq!(files(&sb.new_vault()).into_iter().filter(|p| !p.starts_with(".tegg/")).collect::<BTreeSet<_>>(), set(&["Pages/Links across spaces.md", "Pages/PKM home.md", "Tasks/PKM task.md", REPORT]), "{point}: and writes the whole vault");
    }
}

// ------------------------------------------------------------------------------------------------ AC-5

#[test]
fn fr_imp_03_ac5_failed_import_into_a_vault_rolls_back() {
    let src = fixtures().join("c02-typed-frontmatter");
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = snapshot(&root);
    let mut env = ok!(env(&sb), "env");
    env.points = Some(fail_at(3, std::io::ErrorKind::PermissionDenied, is_object_before));
    let report = some!(ok!(run_into(&sb, &core, &src, &env, None), "the failing run"), "its report");
    assert_eq!(report.phase, Phase::Failed, "an injected failure on the 3rd object write ends the job failed");
    assert!(matches!(&report.error, Some(ImportError::Write { path, .. }) if path == "Books/Book 3.md"), "naming the file: {:?}", report.error);
    assert_rolled_back(&root, &before, "after the failure");
    assert_eq!(report.kept, Vec::<String>::new(), "nothing was kept");
    assert_eq!(import_backups(&sb.dirs).len(), 1, "the backup zip exists (FR-HIS-04 AC-12)");
    assert_eq!(journal(&sb.dirs), "", "the journal is gone after the roll-back");
    assert!(core.jobs().interrupted().is_empty(), "nothing is left interrupted");

    // A created file the user changed meanwhile is kept and listed.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = snapshot(&root);
    let mut env = ok!(common::env(&sb), "env");
    let r = root.clone();
    let n = AtomicUsize::new(0);
    env.points = Some(Arc::new(move |p: &ImportPoint| {
        if is_object_before(p) && n.fetch_add(1, Ordering::SeqCst) + 1 == 3 {
            append(&r, "Books/Book 1 (2).md", "Připsáno uživatelem během importu.\n");
            return PointAction::Fail(std::io::ErrorKind::PermissionDenied);
        }
        PointAction::Continue
    }));
    let report = some!(ok!(run_into(&sb, &core, &src, &env, None), "the failing run"), "its report");
    assert_eq!((report.phase, report.kept.clone()), (Phase::Failed, strs(&["Books/Book 1 (2).md"])), "the changed file is kept and listed");
    let after = snapshot(&root);
    assert_eq!(added(&before, &after), set(&["Books/Book 1 (2).md"]), "it is the only file of the run left");
    assert!(String::from_utf8_lossy(&after["Books/Book 1 (2).md"].bytes).ends_with("Připsáno uživatelem během importu.\n"), "with the user's change");
    assert_eq!(after.get(BOOK_YML).map(|e| &e.bytes), before.get(BOOK_YML).map(|e| &e.bytes), "book.yml is restored");

    // Kill: at each write point in turn, for the change of book.yml, for idea.yml, for every object and the report
    // (c02), and for the attachment points (c05).
    for fixture in ["c02-typed-frontmatter", "c05-media-objects"] {
        let src = fixtures().join(fixture);
        let rec_sb = sandbox();
        let rec_root = existing_vault(&rec_sb);
        let rec_core = ok!(open_core(&rec_root, &rec_sb.dirs), "open the vault for the recording run");
        let points = Points::default();
        let mut env = ok!(common::env(&rec_sb), "env");
        env.points = Some(hook(&points, |_, _| PointAction::Continue));
        let done = some!(ok!(run_into(&rec_sb, &rec_core, &src, &env, None), "the recording run"), "its report");
        assert_eq!(done.phase, Phase::Done, "{fixture}: the recording run finished: {:?}", done.error);
        let seen = points.seen();
        let wanted: Vec<usize> = seen.iter().enumerate().filter(|(_, p)| file_point(p).is_some_and(|(_, k)| fixture == "c02-typed-frontmatter" || k == FileKind::Attachment)).map(|(i, _)| i).collect();
        if fixture == "c02-typed-frontmatter" {
            let files: BTreeSet<&str> = wanted.iter().filter_map(|i| file_point(&seen[*i]).map(|(p, _)| p)).collect();
            assert_eq!(files.len(), 10, "{fixture}: book.yml, idea.yml, seven objects and the report have their points: {files:?}");
            assert_eq!(wanted.len(), 30, "{fixture}: three points per file");
            assert_eq!(file_point(&seen[wanted[0]]), Some((BOOK_YML, FileKind::TypeFile)), "{fixture}: the type files come first");
        } else {
            assert_eq!(wanted.len(), 12, "{fixture}: three points for each of the four attachments");
        }
        for i in wanted {
            let point = &seen[i];
            let (path, _) = some!(file_point(point), "a file point");
            let sb = sandbox();
            let root = existing_vault(&sb);
            let before = snapshot(&root);
            let fired = Arc::new(AtomicBool::new(false));
            {
                let core = ok!(open_core(&root, &sb.dirs), "open the vault");
                let mut env = ok!(common::env(&sb), "env");
                env.points = Some(kill_at(i, &fired));
                let _ = ok!(run_into(&sb, &core, &src, &env, Some(&fired)), format!("{fixture}, kill {i}: start"));
                assert!(fired.load(Ordering::SeqCst), "{fixture}, kill {i}: the run reached {point:?}");
            }
            // What a kill leaves: the journal already names the path, and no file of the run exists that it doesn't name.
            let log = journal(&sb.dirs);
            let line = if path == BOOK_YML { format!("R\t{path}\t") } else { format!("C\t{path}\t") };
            assert!(log.lines().any(|l| l.starts_with(&line)), "{fixture}, kill {i} at {point:?}: the intent for {path} is on disk before the write: {log:?}");
            let killed = snapshot(&root);
            for f in added(&before, &killed).iter().filter(|f| !f.contains(".tegg-tmp")) {
                assert!(log.lines().any(|l| l.starts_with(&format!("C\t{f}\t"))), "{fixture}, kill {i}: the file {f} exists, so the journal names it");
            }
            let t = touched(&before, &killed);
            assert!(t.is_subset(&set(&[BOOK_YML])), "{fixture}, kill {i}: no other pre-existing file changed: {t:?}");
            // The next open lists the import as interrupted, with Undo only.
            let core = ok!(open_core(&root, &sb.dirs), format!("{fixture}, kill {i}: the next open of the vault"));
            let list = core.jobs().interrupted();
            assert_eq!(list.iter().map(|x| (x.kind.as_str(), x.title.as_deref(), x.from.as_str(), x.to.as_str())).collect::<Vec<_>>(), [("import", Some("PKM"), fixture, "")], "{fixture}, kill {i}: the import is listed under interrupted");
            let job = list[0].job;
            assert!(core.jobs().resolve_interrupted(job, ResolveChoice::Finish).is_err(), "{fixture}, kill {i}: an import is never resumed (Undo only)");
            ok!(core.jobs().resolve_interrupted(job, ResolveChoice::Undo), format!("{fixture}, kill {i}: Undo"));
            assert_rolled_back(&root, &before, &format!("{fixture}, kill {i} at {point:?}, after Undo"));
            assert!(core.jobs().interrupted().is_empty(), "{fixture}, kill {i}: nothing is interrupted any more");
            assert_eq!(journal(&sb.dirs), "", "{fixture}, kill {i}: the journal is gone");
            assert_eq!(import_backups(&sb.dirs).len(), 1, "{fixture}, kill {i}: the backup zip stays");
        }
    }
}

// ------------------------------------------------------------------------------------------------ AC-12

#[test]
fn fr_imp_03_ac12_arriving_file_is_never_replaced() {
    let arrived = "---\ntitle: Přišlo odjinud\n---\nSoubor, který přinesla synchronizace.\n";
    // (a) Between plan and write: the planned path is taken; the object gets the next name and the links follow.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let src = source(&sb, "c01-spaces");
    append(&src, "PKM/Pages/Links across spaces.md", "\nDomů: [[PKM home]].\n");
    let env = ok!(env(&sb), "env");
    let scan = ok!(scan_of(&src, &env), "scan");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    assert_eq!(path_of(&plan, "Pages/PKM home.md").as_deref(), Some("Pages/PKM home (2).md"), "the plan names Pages/PKM home (2).md");
    write_raw(&root, "Pages/PKM home (2).md", arrived.as_bytes());
    let before = snapshot(&root);
    let report = ok!(run_plan(plan.clone(), &scan, &target, &env), "the write");
    assert_eq!(report.phase, Phase::Done, "the import finishes: {:?}", report.error);
    let after = snapshot(&root);
    assert_eq!(touched(&before, &after), BTreeSet::new(), "the arrived file and every other file keep bytes, mtime and inode");
    assert_eq!(report.renamed, [("Pages/PKM home (2).md".to_string(), "Pages/PKM home (3).md".to_string())], "the run reports the changed path");
    let home = some!(read_text(&root, "Pages/PKM home (3).md"), "the imported object under its new name");
    assert_eq!(fm_get(&home, "import-id").as_deref(), Some("capacities:PKM/Pages/PKM home.md"), "it is the imported PKM home");
    assert!(some!(read_text(&root, "Pages/Links across spaces.md"), "the linking note").ends_with("\nDomů: [[PKM home (3)|PKM home]].\n"), "every imported link to it is written with the new name");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(resolves(&core, "Pages/Links across spaces.md", "PKM home (3)").as_deref(), Some("Pages/PKM home (3).md"), "and resolves to the imported object");
    assert_eq!(added(&before, &after), report.written.iter().cloned().collect(), "the written files are the plan's as re-checked, plus the report (FR-IMP-05 AC-7)");
    assert!(report.written.contains(&"Pages/PKM home (3).md".to_string()) && !report.written.contains(&"Pages/PKM home (2).md".to_string()), "with the new path");
    let text = some!(read_text(&root, &some!(report.report_path.clone(), "the report's path")), "the report");
    assert!(text.lines().any(|l| l.starts_with("- [[PKM home (3)") && l.contains("`PKM home (3).md`")), "the report's Files section lists the changed name: {text}");

    // (b) During the write phase: a file put at a planned, not yet written path fails that create; nothing is replaced.
    type Put = (&'static str, &'static str, fn(&ImportPoint) -> bool, &'static str);
    let cases: [Put; 5] = [
        ("after the 1st object write, at a later object's path", "c01-spaces", |p| matches!(p, ImportPoint::Renamed { kind: FileKind::Object, .. }), "Tasks/PKM task (2).md"),
        ("between an object's temp file and its rename", "c01-spaces", |p| matches!(p, ImportPoint::TempWritten { kind: FileKind::Object, path } if path == "Pages/PKM home (2).md"), "Pages/PKM home (2).md"),
        ("after the 1st attachment, at a later attachment's path", "c05-media-objects", |p| matches!(p, ImportPoint::Renamed { kind: FileKind::Attachment, .. }), "_attachments/Manual.pdf"),
        ("between an attachment's temp file and its rename", "c05-media-objects", |p| matches!(p, ImportPoint::TempWritten { kind: FileKind::Attachment, path } if path == "_attachments/Manual.pdf"), "_attachments/Manual.pdf"),
        ("at a new type file's path, before its temp file", "c02-typed-frontmatter", |p| matches!(p, ImportPoint::BeforeTemp { kind: FileKind::TypeFile, path } if path == ".tegg/types/idea.yml"), ".tegg/types/idea.yml"),
    ];
    for (what, fixture, pick, path) in cases {
        let sb = sandbox();
        let root = existing_vault(&sb);
        let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
        let before = snapshot(&root);
        let mut env = ok!(common::env(&sb), "env");
        let (r, bytes) = (root.clone(), arrived.as_bytes().to_vec());
        let placed: Arc<std::sync::Mutex<Option<Entry>>> = Arc::default();
        let pl = placed.clone();
        env.points = Some(act_at(1, pick, move |_| {
            write_raw(&r, path, &bytes);
            *pl.lock().unwrap_or_else(|e| e.into_inner()) = snapshot(&r).get(path).cloned();
        }));
        let report = some!(ok!(run_into(&sb, &core, &fixtures().join(fixture), &env, None), format!("{what}: the run")), "its report");
        let entry = some!(placed.lock().unwrap_or_else(|e| e.into_inner()).clone(), format!("{what}: the hook placed the file"));
        assert_eq!(report.phase, Phase::Failed, "{what}: the job ends failed");
        assert!(matches!(&report.error, Some(ImportError::FileAppeared { path: p }) if p == path) || (path.ends_with(".yml") && matches!(&report.error, Some(ImportError::TargetChanged { path: p }) if p == path)), "{what}: naming the path {path}: {:?}", report.error);
        let after = snapshot(&root);
        assert_eq!(after.get(path), Some(&entry), "{what}: the arrived file keeps bytes, mtime and inode: no rename of the run replaced it");
        assert_eq!(added(&before, &after), set(&[path]), "{what}: the roll-back removed every file of the run and never the arrived one");
        let t = touched(&before, &after);
        assert!(t.is_subset(&set(&[BOOK_YML])), "{what}: every pre-existing file is untouched: {t:?}");
        assert_eq!(after.get(BOOK_YML).map(|e| &e.bytes), before.get(BOOK_YML).map(|e| &e.bytes), "{what}: book.yml has its bytes from before");
        assert_eq!((temp_files(&root), report.kept.clone()), (Vec::new(), Vec::new()), "{what}: no temp file left; the arrived file is not `kept` (it was never the run's)");
    }
}

// ------------------------------------------------------------------------------------------------ AC-13

#[test]
fn fr_imp_03_ac13_type_file_changed_since_the_plan() {
    const SERIES: &str = "  - key: series\n    name: Series\n    type: text\n";
    let src = fixtures().join("c02-typed-frontmatter");
    // Changed between the plan and the start: refused, no backup, nothing created.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(env(&sb), "env");
    let scan = ok!(scan_of(&src, &env), "scan");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    assert!(plan.stamps.type_files.iter().any(|s| s.path == BOOK_YML && s.version.is_some()), "the plan recorded the content of book.yml");
    assert!(plan.stamps.type_files.iter().any(|s| s.path == ".tegg/types/idea.yml" && s.version.is_none()), "and that idea.yml was absent");
    append(&root, BOOK_YML, SERIES);
    let before = snapshot(&root);
    let r = tegg_import::start(plan.clone(), &scan, &target, &env).err();
    assert_eq!(r, Some(ImportError::TargetChanged { path: BOOK_YML.into() }), "starting the write is refused with TargetChanged naming the file");
    assert_eq!(snapshot(&root), before, "no vault file is created, and book.yml keeps the external bytes");
    assert_eq!(import_backups(&sb.dirs), Vec::<PathBuf>::new(), "no backup is made");
    // A changed modification time with equal content is not a change (§9.2).
    let sb2 = sandbox();
    let root2 = existing_vault(&sb2);
    let core2 = ok!(open_core(&root2, &sb2.dirs), "open another copy");
    let env2 = ok!(common::env(&sb2), "env");
    let scan2 = ok!(scan_of(&src, &env2), "scan");
    let plan2 = ok!(plan_of(&scan2, SPACE, &Target::Existing(&core2), &Mapping::default(), &env2), "plan");
    let same = std::fs::read(root2.join(BOOK_YML)).expect("setup: book.yml");
    std::fs::write(root2.join(BOOK_YML), &same).expect("setup: rewrite with equal bytes");
    let touched_only = ok!(run_plan(plan2, &scan2, &Target::Existing(&core2), &env2), "the run after a touch");
    assert_eq!(touched_only.phase, Phase::Done, "equal content with a new modification time doesn't block the import: {:?}", touched_only.error);

    // Changed later, after the backup and before the type file is written: failed, nothing added.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = snapshot(&root);
    let mut env = ok!(common::env(&sb), "env");
    let r = root.clone();
    env.points = Some(act_at(1, |p| matches!(p, ImportPoint::AfterBackup), move |_| append(&r, BOOK_YML, SERIES)));
    let report = some!(ok!(run_into(&sb, &core, &src, &env, None), "the run"), "its report");
    assert_eq!((report.phase, report.error.clone()), (Phase::Failed, Some(ImportError::TargetChanged { path: BOOK_YML.into() })), "the check is repeated immediately before the type file is replaced");
    let after = snapshot(&root);
    assert_eq!(added(&before, &after), BTreeSet::new(), "nothing was added: the type file comes before every other write");
    assert_eq!(touched(&before, &after), set(&[BOOK_YML]), "only book.yml differs from before the run…");
    assert_eq!(String::from_utf8_lossy(&after[BOOK_YML].bytes), format!("{}{SERIES}", String::from_utf8_lossy(&before[BOOK_YML].bytes)), "…and it keeps the external bytes");
    assert_eq!(import_backups(&sb.dirs).len(), 1, "the backup was made before");
    // The same between the type file's temp file and its rename is the accepted window (D-84): not tested.

    // A new plan against the changed file succeeds, and book.yml holds `series` and the appended import attributes.
    core.notify_changed(&[BOOK_YML.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(30)), "idle");
    let again = ok!(import_into(&core, &root, &src, SPACE, &Mapping::default(), &ok!(common::env(&sb), "env")), "plan again and write");
    let yml = some!(read_text(&root, BOOK_YML), "book.yml");
    assert_eq!(type_attrs(&yml).iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["author", "pages", "rating", "series", "medium", "language", "finished"], "`series` and the appended import attributes");
    assert!(again.report.written.contains(&"Books/Book 3.md".to_string()), "the import wrote its objects");

    // The check covers every type file the plan read to match a type: here task.yml (c12 maps Task onto it).
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(common::env(&sb), "env");
    let scan = ok!(scan_of(&fixtures().join("c12-task-dates"), &env), "scan c12");
    let target = Target::Existing(&core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan c12");
    append(&root, ".tegg/types/task.yml", "  - key: effort\n    name: Effort\n    type: number\n");
    let before = snapshot(&root);
    assert_eq!(tegg_import::start(plan, &scan, &target, &env).err(), Some(ImportError::TargetChanged { path: ".tegg/types/task.yml".into() }), "a matched type file that the run doesn't extend is checked too");
    assert_eq!(snapshot(&root), before, "nothing written");
}

// ------------------------------------------------------------------------------------------------ AC-14

#[test]
fn fr_imp_03_ac14_temporary_folder_and_final_rename() {
    let src = fixtures().join("c01-spaces");
    // The marker is the first file created in `<name>.tegg-importing`, holds the run id, and is gone at the end.
    let sb = sandbox();
    let points = Points::default();
    let marker: Arc<std::sync::Mutex<Option<(String, Vec<String>)>>> = Arc::default();
    let (m, dir) = (marker.clone(), sb.importing());
    let mut env = ok!(env(&sb), "env");
    env.points = Some(hook(&points, move |_, p| {
        if matches!(p, ImportPoint::Renamed { kind: FileKind::Marker, .. }) {
            let text = std::fs::read_to_string(dir.join(".tegg-import")).unwrap_or_default();
            *m.lock().unwrap_or_else(|e| e.into_inner()) = Some((text, files(&dir).into_iter().collect()));
        }
        PointAction::Continue
    }));
    let report = some!(ok!(run_new(&sb, &src, &env, None), "the run"), "its report");
    assert_eq!(report.phase, Phase::Done, "the import finishes: {:?}", report.error);
    let first = points.seen().into_iter().find_map(|p| file_point(&p).map(|(path, kind)| (path.to_string(), kind)));
    assert_eq!(first, Some((".tegg-import".to_string(), FileKind::Marker)), "the first file the engine creates is the marker");
    let (text, then) = some!(marker.lock().unwrap_or_else(|e| e.into_inner()).clone(), "the marker was written into the temporary folder");
    assert_eq!(then, [".tegg-import"], "…when the folder held nothing else");
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let run_id = json["run"].as_str().unwrap_or("").to_string();
    assert_eq!(json["version"], 1, "the marker: {text}");
    let (ms, pid) = run_id.split_once('-').unwrap_or(("", ""));
    assert_eq!((ms, pid), ("1794474000000", std::process::id().to_string().as_str()), "the run id is <clock in ms>-<process id> (D-1556): {run_id}");
    assert!(!files(&sb.new_vault()).contains(".tegg-import") && !sb.importing().exists(), "a finished vault doesn't hold the marker; the temporary folder is gone");

    // Clean-up: a marked leftover of a run that isn't running goes to the system Trash, whole, and the import goes on.
    for marker_text in [r#"{"version":1,"run":"1700000000000-1","started":"2026-11-11T10:00:00+01:00"}"#, "tohle není JSON"] {
        let sb = sandbox();
        write_raw(&sb.importing(), ".tegg-import", marker_text.as_bytes());
        write_raw(&sb.importing(), "Pages/Rozepsáno.md", "---\ntitle: Rozepsáno\n---\nZbytek po pádu.\n".as_bytes());
        write_raw(&sb.importing(), "_attachments/.obrázek.png.i7.tegg-tmp", b"polovina");
        let leftover = bytes_of(&sb.importing());
        let env = ok!(common::env(&sb), "env");
        let scan = ok!(scan_of(&src, &env), "scan");
        let plan = ok!(plan_of(&scan, SPACE, &new_target(&sb), &Mapping::default(), &env), "a marked leftover of a dead run is not a refusal in plan");
        assert_eq!(bytes_of(&sb.importing()), leftover, "plan leaves it alone");
        let report = ok!(run_plan(plan, &scan, &new_target(&sb), &env), "the run");
        assert_eq!((report.phase, report.vault.clone()), (Phase::Done, Some(sb.new_vault())), "the import goes on: {:?}", report.error);
        assert_eq!(bytes_of(&sb.base.join("Koš").join(format!("{VAULT_NAME}.tegg-importing"))), leftover, "every file of the leftover is in the Trash, unchanged");
        assert!(!files(&sb.new_vault()).iter().any(|p| p.contains("Rozepsáno") || p.contains("tegg-tmp")), "nothing of the leftover is in the new vault");
    }
    // When the move fails, the start is refused: nothing removed, nothing created.
    let sb = sandbox();
    write_raw(&sb.importing(), ".tegg-import", br#"{"version":1,"run":"1700000000000-1","started":"2026-11-11T10:00:00+01:00"}"#);
    write_raw(&sb.importing(), "Pages/Rozepsáno.md", "Zbytek.\n".as_bytes());
    let mut env = ok!(common::env(&sb), "env");
    env.trash = Arc::new(NoTrash);
    let scan = ok!(scan_of(&src, &env), "scan");
    let plan = ok!(plan_of(&scan, SPACE, &new_target(&sb), &Mapping::default(), &env), "plan");
    let before = snapshot(&sb.place());
    let r = tegg_import::start(plan, &scan, &new_target(&sb), &env).err();
    assert!(matches!(r, Some(ImportError::LeftoverNotTrashed { .. })), "a failed move to the Trash refuses the start: {r:?}");
    assert_eq!(snapshot(&sb.place()), before, "nothing is removed and nothing is created in the chosen place");
    // A folder without the marker (the user's own) is never removed or written into: TargetExists.
    let sb = sandbox();
    write_raw(&sb.importing(), "Poznámka.md", "Moje vlastní složka.\n".as_bytes());
    let env = ok!(common::env(&sb), "env");
    let scan = ok!(scan_of(&src, &env), "scan");
    let before = snapshot(&sb.place());
    assert_eq!(tegg_import::plan(&scan, SPACE, &new_target(&sb), &Mapping::default(), &env, &tegg_import::Control::default()).err(), Some(ImportError::TargetExists), "plan answers TargetExists");
    // …also when it appears between the plan and the start.
    std::fs::remove_dir_all(sb.importing()).expect("setup: remove");
    let plan = ok!(plan_of(&scan, SPACE, &new_target(&sb), &Mapping::default(), &env), "plan with the place free");
    write_raw(&sb.importing(), "Poznámka.md", "Moje vlastní složka.\n".as_bytes());
    assert_eq!(tegg_import::start(plan, &scan, &new_target(&sb), &env).err(), Some(ImportError::TargetExists), "start answers TargetExists");
    assert_eq!(bytes_of(&sb.place()), before.into_iter().filter(|(k, _)| !k.ends_with('/')).map(|(k, v)| (k, v.bytes)).collect(), "the user's folder is neither removed nor written into");
    assert_eq!(snapshot(&sb.base.join("Koš")).len(), 0, "and nothing went to the Trash");
    // A run that is running in this process: a second import of the same name into the same place is TargetExists.
    let sb = sandbox();
    let mut env = ok!(common::env(&sb), "env");
    let (hold, release) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let (h, rl) = (hold.clone(), release.clone());
    env.points = Some(act_at(1, |p| matches!(p, ImportPoint::Renamed { kind: FileKind::Marker, .. }), move |_| {
        h.store(true, Ordering::SeqCst);
        wait_until(Duration::from_secs(60), || rl.load(Ordering::SeqCst));
    }));
    let plain = ok!(common::env(&sb), "env");
    let scan = ok!(scan_of(&src, &plain), "scan");
    let plan = ok!(plan_of(&scan, SPACE, &new_target(&sb), &Mapping::default(), &plain), "plan");
    let first = ok!(tegg_import::start(plan.clone(), &scan, &new_target(&sb), &env), "start the first run");
    assert!(wait_until(Duration::from_secs(60), || hold.load(Ordering::SeqCst)), "the first run wrote its marker");
    let second = tegg_import::start(plan, &scan, &new_target(&sb), &plain).err();
    let replan = tegg_import::plan(&scan, SPACE, &new_target(&sb), &Mapping::default(), &plain, &tegg_import::Control::default()).err();
    release.store(true, Ordering::SeqCst);
    assert_eq!((second, replan), (Some(ImportError::TargetExists), Some(ImportError::TargetExists)), "while the first run writes, start and plan answer TargetExists");
    assert_eq!(first.wait(Duration::from_secs(120)).map(|r| r.phase), Some(Phase::Done), "and the first run finishes undisturbed");
    assert_eq!(snapshot(&sb.base.join("Koš")).len(), 0, "nothing of the running run went to the Trash");

    // The final rename: a folder or a file put at the final name during the write phase is never replaced or merged.
    for as_folder in [true, false] {
        let sb = sandbox();
        let mut env = ok!(common::env(&sb), "env");
        let place = sb.place();
        env.points = Some(act_at(1, |p| matches!(p, ImportPoint::BeforeFinalRename), move |_| {
            if as_folder {
                write_raw(&place.join(VAULT_NAME), "Poznámka.md", "Přišlo během importu.\n".as_bytes());
            } else {
                write_raw(&place, VAULT_NAME, "Soubor se stejným jménem.\n".as_bytes());
            }
        }));
        let report = some!(ok!(run_new(&sb, &src, &env, None), "the run"), "its report");
        assert_eq!(report.phase, Phase::Done, "folder {as_folder}: the import finishes: {:?}", report.error);
        let second = sb.place().join(format!("{VAULT_NAME} (2)"));
        assert_eq!((report.vault.clone(), report.vault_name.as_str()), (Some(second.clone()), "Capacities · PKM (2)"), "folder {as_folder}: the vault gets the next free name, and the job's result names it");
        assert_eq!(files(&second).into_iter().filter(|p| !p.starts_with(".tegg/")).collect::<BTreeSet<_>>(), set(&["Pages/Links across spaces.md", "Pages/PKM home.md", "Tasks/PKM task.md", REPORT]), "folder {as_folder}: the whole vault is there");
        if as_folder {
            assert_eq!(bytes_of(&sb.new_vault()).into_iter().collect::<Vec<_>>(), [("Poznámka.md".to_string(), "Přišlo během importu.\n".as_bytes().to_vec())], "the folder that arrived is untouched: nothing merged into it");
        } else {
            assert_eq!(std::fs::read(sb.new_vault()).ok().as_deref(), Some("Soubor se stejným jménem.\n".as_bytes()), "the file that arrived is untouched");
        }
        assert!(!sb.importing().exists(), "folder {as_folder}: the temporary folder is gone");
    }
}

// ------------------------------------------------------------------------------------------------ AC-15

#[test]
fn fr_imp_03_ac15_source_changes_during_the_write() {
    const LATER: &str = "PKM/PDFs/Media/Manual.pdf"; // the last attachment in source-path order
    for existing in [false, true] {
        for delete in [true, false] {
            let what = format!("{} vault, the file is {}", if existing { "existing" } else { "new" }, if delete { "deleted" } else { "replaced by another size" });
            let sb = sandbox();
            let src = source(&sb, "c05-media-objects");
            let root = existing_vault(&sb);
            let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
            let before = snapshot(&root);
            let mut env = ok!(env(&sb), "env");
            let s = src.clone();
            env.points = Some(act_at(1, |p| matches!(p, ImportPoint::Renamed { kind: FileKind::Attachment, .. }), move |_| {
                if delete {
                    std::fs::remove_file(s.join(LATER)).expect("setup: delete the media file");
                } else {
                    std::fs::write(s.join(LATER), b"%PDF-1.4 a different file of another size, put there during the import").expect("setup: replace the media file");
                }
            }));
            let report = some!(if existing { ok!(run_into(&sb, &core, &src, &env, None), format!("{what}: the run")) } else { ok!(run_new(&sb, &src, &env, None), format!("{what}: the run")) }, "its report");
            let source_after = snapshot(&src);
            assert_eq!(report.phase, Phase::Failed, "{what}: the job ends failed");
            let entry = "PDFs/Media/Manual.pdf";
            if delete {
                assert!(matches!(&report.error, Some(ImportError::SourceGone { entry: Some(e) }) if e == entry), "{what}: SourceGone naming the entry: {:?}", report.error);
            } else {
                assert!(matches!(&report.error, Some(ImportError::SourceChanged { entry: Some(e) }) if e == entry), "{what}: SourceChanged naming the entry: {:?}", report.error);
            }
            // The roll-back of AC-4 (new vault) or AC-5 (existing vault).
            if existing {
                assert_rolled_back(&root, &before, &what);
            } else {
                assert!(!sb.new_vault().exists() && !sb.importing().exists(), "{what}: no vault folder and no temporary folder is left");
                assert_eq!(snapshot(&root), before, "{what}: the open vault was never touched");
            }
            let stray: Vec<String> = snapshot(&sb.base).into_keys().filter(|k| !k.starts_with("zdroj/") && k.ends_with("Manual.pdf")).collect();
            assert_eq!(stray, Vec::<String>::new(), "{what}: no attachment exists under a final name with bytes other than the planned ones");
            assert_eq!(snapshot(&src), source_after, "{what}: the engine itself never writes to the source");
            assert_eq!(source_after.contains_key(LATER), !delete, "{what}: the source is as the test left it");
        }
    }
    // A note changed after the plan is never rendered with the plan's link indexes (§9.2 step 5).
    let sb = sandbox();
    let src = source(&sb, "c05-media-objects");
    let mut env = ok!(env(&sb), "env");
    let s = src.clone();
    env.points = Some(act_at(1, |p| matches!(p, ImportPoint::BeforeChecks), move |_| {
        std::thread::sleep(Duration::from_millis(20));
        append(&s, "PKM/Pages/Trip notes.md", "\n[[Mapa řeky]] znovu.\n");
    }));
    let report = some!(ok!(run_new(&sb, &src, &env, None), "the run"), "its report");
    assert!(report.phase == Phase::Failed && matches!(&report.error, Some(ImportError::SourceChanged { .. })), "a source note changed after `start` fails the run with SourceChanged: {:?} {:?}", report.phase, report.error);
    assert!(!sb.new_vault().exists() && !sb.importing().exists(), "nothing was written");
}
