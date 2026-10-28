//! MS4 slice 4C AC tests of the job engine (L4): docs/acceptance/rename.md FR-HIS-04 AC-4, AC-5 (engine part, on the
//! test-only `test-backup` kind), FR-UX-07 AC-8, AC-10; and the existing criteria this slice verifies at the engine:
//! data-safety NFR-REL-04 / FR-HIS-04 AC-1…AC-3 (engine part), search-navigation FR-UX-07 AC-3 (job part), AC-4
//! (note-rename part). Interface: docs/contracts/ms4-jobs.md §1 (kinds and flags), §4 (API, `job:progress`),
//! §6 (backups), §7 (cancel) and the test-only named job points. Written from the ACs and the contract only (D-61).

#[macro_use]
mod common;

use std::collections::BTreeSet;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::*;
use tegg_core::CoreEvent;
use tegg_jobs::{JobError, JobKind, JobOp, JobPoint, JobProgress, Phase};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

// ------------------------------------------------------------------------------------------------ helpers

/// Every file under `<Application Support>/backups/` (relative, NFC).
fn backups(dirs: &tegg_vault::AppDirs) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else {
                out.push(p);
            }
        }
    }
    walk(&dirs.root.join("backups"), &mut out);
    out.sort();
    out
}
fn zips(dirs: &tegg_vault::AppDirs) -> Vec<PathBuf> {
    backups(dirs).into_iter().filter(|p| p.extension().is_some_and(|e| e == "zip")).collect()
}

/// The entry names of a zip file, from its central directory (UTF-8 names; no decompression needed to list them).
fn zip_names(path: &Path) -> Vec<String> {
    let b = std::fs::read(path).unwrap_or_default();
    let u16_at = |i: usize| b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]) as usize).unwrap_or(0);
    let u32_at = |i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize).unwrap_or(0);
    let Some(eocd) = (0..b.len().saturating_sub(21)).rev().find(|&i| b[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]) else { return Vec::new() };
    let (count, mut at) = (u16_at(eocd + 10), u32_at(eocd + 16));
    let mut names = Vec::new();
    for _ in 0..count {
        if b.get(at..at + 4) != Some(&[0x50, 0x4b, 0x01, 0x02]) {
            break;
        }
        let (n, x, c) = (u16_at(at + 28), u16_at(at + 30), u16_at(at + 32));
        names.push(String::from_utf8_lossy(b.get(at + 46..at + 46 + n).unwrap_or_default()).into_owned());
        at += 46 + n + x + c;
    }
    names
}

/// Every `.md` file and every file under `.tegg/` of the vault (relative, NFC) — what a backup must hold.
fn backup_set(root: &Path) -> BTreeSet<String> {
    snapshot(root).into_keys().filter(|k| !k.ends_with('/') && (k.ends_with(".md") || k.starts_with(".tegg/"))).collect()
}

/// LocalFs that notes, at the first vault write, whether a zip already existed in the backups folder.
struct FirstWriteFs {
    inner: LocalFs,
    backups: PathBuf,
    first: Mutex<Option<bool>>,
}
impl FirstWriteFs {
    fn mark(&self) {
        let mut f = self.first.lock().unwrap_or_else(|p| p.into_inner());
        if f.is_none() {
            let mut any = false;
            fn walk(d: &Path, any: &mut bool) {
                if let Ok(rd) = std::fs::read_dir(d) {
                    for e in rd.flatten() {
                        let p = e.path();
                        if p.is_dir() {
                            walk(&p, any)
                        } else if p.extension().is_some_and(|x| x == "zip") {
                            *any = true
                        }
                    }
                }
            }
            walk(&self.backups, &mut any);
            *f = Some(any);
        }
    }
}
impl VaultFs for FirstWriteFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.mark();
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.mark();
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.mark();
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.mark();
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.mark();
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        self.inner.stat(path)
    }
}

fn test_backup_op() -> JobOp {
    JobOp::TestBackup { paths: vec![BETA.to_string()] }
}

/// Collects the `job:progress` events of `job` with their arrival times until a final phase (or the timeout).
fn progress_of(rx: &std::sync::mpsc::Receiver<CoreEvent>, timeout: Duration) -> Vec<(Instant, JobProgress)> {
    let end = Instant::now() + timeout;
    let mut out = Vec::new();
    while Instant::now() < end {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(CoreEvent::JobProgress(p)) => {
                let last = p.phase.is_final();
                out.push((Instant::now(), p));
                if last {
                    break;
                }
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    out
}

/// The rename fixture plus a hub `Pages/Rozbočovač.md` linked from 500 notes (created at runtime, rename.md).
fn hub_vault(sb: &Sandbox) -> PathBuf {
    let root = rename_vault(sb);
    write_raw(&root, "Pages/Rozbočovač.md", "---\nid: 01JB4C0000000000000000H000\ntype: page\ntitle: Rozbočovač\n---\nCíl pěti set odkazů.\n".as_bytes());
    for i in 0..500 {
        let n = format!("{i:03}");
        let text = format!("---\nid: 01JB4C000000000000000H{n:0>4}\ntype: page\ntitle: Odkaz {n}\n---\nZmínka o [[Rozbočovač]] číslo {n}.\n");
        write_raw(&root, &format!("Odkazující/Odkaz {n}.md"), text.as_bytes());
    }
    root
}

// ------------------------------------------------------------------------------------------------ §1 kinds

#[test]
fn fr_his_04_ac5_kind_flags_backup_for_every_kind_but_note_rename() {
    let f = JobKind::NoteRename.flags();
    assert_eq!((f.needs_confirm, f.backup, f.undoable, f.cancellable.clone()), (false, false, true, vec![Phase::Planning]), "note-rename (D-268, D-269, D-385, D-393)");
    for k in [JobKind::TagRename, JobKind::TagDelete, JobKind::Merge, JobKind::KeyRename, JobKind::ValueRemove, JobKind::TypeDelete] {
        let f = k.flags();
        assert!(f.needs_confirm && f.backup && !f.undoable, "{k:?}: confirm, backup, no undo (D-269, D-395)");
        let c: BTreeSet<&str> = f.cancellable.iter().map(|p| p.as_str()).collect();
        assert_eq!(c, ["backup", "confirm", "planning"].into_iter().collect(), "{k:?}: cancellable in planning, confirm, backup");
    }
    // ms4-jobs §14.1 (D-812, D-828): type and folder moves have no confirm step, are undoable and cancellable in
    // planning and backup; only a folder move (and a bulk type move, decided by the planner) makes a zip.
    for (k, backup) in [(JobKind::TypeMove, false), (JobKind::FolderMove, true)] {
        let f = k.flags();
        assert_eq!((f.needs_confirm, f.backup, f.undoable), (false, backup, true), "{k:?} (ms4-jobs §14.1)");
        let c: BTreeSet<&str> = f.cancellable.iter().map(|p| p.as_str()).collect();
        assert_eq!(c, ["backup", "planning"].into_iter().collect(), "{k:?}: cancellable in planning, backup");
    }
    let f = JobKind::TestBackup.flags();
    assert!(!f.needs_confirm && f.backup && !f.undoable, "test-backup backs up");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-4

#[test]
fn fr_his_04_ac4_note_rename_makes_no_zip() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = backups(&sb.dirs);
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(backups(&sb.dirs), before, "the backups folder listing is unchanged (D-269)");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-5 / NFR-REL-04 AC-1…AC-3

fn backed_up_run(sb: &Sandbox, root: &Path) -> Result<(tegg_jobs::JobReport, Option<bool>), String> {
    let fs = Arc::new(FirstWriteFs { inner: LocalFs::new(root), backups: sb.dirs.root.join("backups"), first: Mutex::new(None) });
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let (_, report) = run_job(&core, test_backup_op())?;
    let first = *fs.first.lock().unwrap_or_else(|p| p.into_inner());
    Ok((report, first))
}

#[test]
fn fr_his_04_ac5_zip_before_the_first_write_with_every_md_and_tegg_file() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    // An NFD-named note, to check the zip names are NFC.
    write_raw(&root, &"Pages/Čtení.md".replace("Č", "C\u{30C}").replace("í", "i\u{301}"), b"---\ntitle: Cteni\n---\n");
    let want = backup_set(&root);
    let (report, first) = ok!(backed_up_run(&sb, &root), "test-backup job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_ne!(first, Some(false), "no vault write before the zip exists");
    let z = zips(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip in Application Support/backups/<vault>/: {z:?}");
    let name = z[0].file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    assert!(name.len() == "20261017-101500-test-backup.zip".len() && name.ends_with("-test-backup.zip"), "name <UTC yyyymmdd-hhmmss>-<kind>.zip: {name}");
    let names: BTreeSet<String> = zip_names(&z[0]).into_iter().filter(|n| !n.ends_with('/')).collect();
    assert_eq!(names, want, "every .md and .tegg/ file, NFC names");
}

#[test]
fn nfr_rel_04_ac2_backup_holds_every_md_file_and_tegg() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    write_raw(&root, "_attachments/obrázek.png", &[0x89, 0x50, 0x4e, 0x47]);
    let want = backup_set(&root);
    let (_, _) = ok!(backed_up_run(&sb, &root), "test-backup job");
    let z = zips(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip: {z:?}");
    let names: BTreeSet<String> = zip_names(&z[0]).into_iter().filter(|n| !n.ends_with('/')).collect();
    assert_eq!(names, want, "all .md and .tegg/; attachments only when the job touches them");
}

fn read_only_backups(sb: &Sandbox) {
    let b = sb.dirs.root.join("backups");
    std::fs::create_dir_all(&b).expect("setup: backups dir");
    std::fs::set_permissions(&b, std::fs::Permissions::from_mode(0o555)).expect("setup: read-only backups");
}
fn writable_again(sb: &Sandbox) {
    let _ = std::fs::set_permissions(sb.dirs.root.join("backups"), std::fs::Permissions::from_mode(0o755));
}

#[test]
fn fr_his_04_ac5_failed_zip_ends_backup_failed_and_writes_nothing() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    read_only_backups(&sb);
    let before = snapshot(&root);
    let job = core.jobs().start(test_backup_op());
    let report = job.as_ref().ok().and_then(|j| core.jobs().wait(*j, Duration::from_secs(60)));
    writable_again(&sb);
    let report = some!(report, format!("a report for the test-backup job ({job:?})"));
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or("").contains("BackupFailed"), "with BackupFailed: {report:?}");
    assert_eq!(report.written, Vec::<String>::new(), "writes nothing");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical (bytes, mtime, inode)");
}

#[test]
fn nfr_rel_04_ac1_operation_does_not_start_when_the_backup_fails() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    read_only_backups(&sb);
    let before = snapshot(&root);
    let r = run_job(&core, test_backup_op());
    writable_again(&sb);
    let (_, report) = ok!(r, "test-backup job");
    assert_eq!((report.phase, report.written.len()), (Phase::Failed, 0), "{report:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "nothing in the vault changes");
}

fn rotation(sb: &Sandbox, root: &Path) -> Result<(Vec<String>, Vec<String>), String> {
    let core = open_core(root, &sb.dirs, false)?;
    run_job(&core, test_backup_op())?;
    let first = zips(&sb.dirs);
    let dir = first.first().and_then(|p| p.parent()).map(Path::to_path_buf).ok_or("no zip after the first job")?;
    // Nine older zips of other kinds (2020), so the folder holds 10 before the 11th.
    for i in 1..=9 {
        std::fs::write(dir.join(format!("20200101-0000{i:02}-tag-rename.zip")), b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0").map_err(|e| e.to_string())?;
    }
    let before: Vec<String> = zips(&sb.dirs).iter().filter_map(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).collect();
    std::thread::sleep(Duration::from_millis(1100)); // a new second for the new name
    run_job(&core, test_backup_op())?;
    let after: Vec<String> = zips(&sb.dirs).iter().filter_map(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).collect();
    Ok((before, after))
}

#[test]
fn fr_his_04_ac5_the_eleventh_zip_deletes_the_oldest() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let (before, after) = ok!(rotation(&sb, &root), "two test-backup jobs");
    assert_eq!(before.len(), 10, "setup: ten zips before the 11th: {before:?}");
    assert_eq!(after.len(), 10, "ten zips are kept: {after:?}");
    assert!(!after.contains(&"20200101-000001-tag-rename.zip".to_string()), "the oldest is deleted");
}

#[test]
fn nfr_rel_04_ac3_newest_ten_backups_are_kept() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let (before, after) = ok!(rotation(&sb, &root), "two test-backup jobs");
    let mut want: Vec<String> = before.clone();
    want.sort();
    want.remove(0);
    let mut got = after.clone();
    got.sort();
    assert_eq!(got.len(), 10, "{got:?}");
    assert_eq!(got[..9], want[..9], "the nine newest of the old ones survive, plus the new one");
}

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-8, AC-4

#[test]
fn fr_ux_07_ac8_job_progress_rules_on_the_500_backlink_hub() {
    let sb = sandbox();
    let root = hub_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let rx = core.events();
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: "Pages/Rozbočovač.md".into(), title: "Uzel".into() }), "start the hub rename");
    let ev: Vec<(Instant, JobProgress)> = progress_of(&rx, Duration::from_secs(120)).into_iter().filter(|(_, p)| p.job == job).collect();
    assert!(!ev.is_empty(), "job:progress events for the job");
    let allowed: BTreeSet<&str> = ["planning", "backup", "writing", "done", "cancelled", "failed"].into_iter().collect();
    let mut problems = Vec::new();
    let mut total_at_writing: Option<usize> = None;
    for (i, (t, p)) in ev.iter().enumerate() {
        if p.kind != JobKind::NoteRename {
            problems.push(format!("event {i}: kind {:?}", p.kind));
        }
        if !allowed.contains(p.phase.as_str()) {
            problems.push(format!("event {i}: phase {}", p.phase.as_str()));
        }
        if i > 0 {
            let (t0, p0) = &ev[i - 1];
            if p.done < p0.done {
                problems.push(format!("event {i}: done decreased {} → {}", p0.done, p.done));
            }
            // 500 ms plus 100 ms of receive slack on the test thread.
            if t.duration_since(*t0) > Duration::from_millis(600) {
                problems.push(format!("event {i}: {} ms since the previous one", t.duration_since(*t0).as_millis()));
            }
        }
        if p.phase == Phase::Writing && total_at_writing.is_none() {
            total_at_writing = Some(p.total);
        }
        if let Some(tw) = total_at_writing {
            if p.total != tw {
                problems.push(format!("event {i}: total changed after writing started ({tw} → {})", p.total));
            }
        }
    }
    let (_, last) = ev.last().cloned().unwrap_or_else(|| (Instant::now(), ev[0].1.clone()));
    assert_eq!(problems, Vec::<String>::new(), "progress rules");
    assert_eq!(last.phase, Phase::Done, "the last event is done");
    assert_eq!(last.done, last.total, "the last event has done == total");
    let c = some!(last.counts, "the final event carries counts");
    assert_eq!(c.written + c.unchanged + c.skipped, last.total, "written + unchanged + skipped = total: {c:?}");
    assert_eq!((c.written, c.skipped), (501, 0), "the hub and its 500 linking notes written");
}

#[test]
fn fr_ux_07_ac4_note_rename_reports_job_progress() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let rx = core.events();
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), "start");
    let ev: Vec<JobProgress> = progress_of(&rx, Duration::from_secs(60)).into_iter().map(|(_, p)| p).filter(|p| p.job == job).collect();
    assert!(ev.len() >= 2, "at least a start and a final event: {ev:?}");
    assert!(ev.windows(2).all(|w| w[1].done >= w[0].done), "done never decreases: {ev:?}");
    let last = ev.last().cloned();
    assert_eq!(last.as_ref().map(|p| (p.phase, p.done == p.total)), Some((Phase::Done, true)), "the last event is done with done == total");
    assert_eq!(last.and_then(|p| p.counts).map(|c| (c.written, c.unchanged, c.skipped)), Some((6, 0, 0)), "Gama + 5 linking files written");
}

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-10, AC-3

/// Blocks the job at `point` until the test releases it (or 5 s pass); tells the test when it got there.
fn block_at(core: &tegg_core::Core, want: fn(&JobPoint) -> bool) -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>) {
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let at_tx = Mutex::new(Some(at_tx));
    let go_rx = Mutex::new(go_rx);
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if want(p) {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    (at_rx, go_tx)
}

#[test]
fn fr_ux_07_ac10_cancel_in_planning_stops_within_1s_and_leaves_the_vault_identical() {
    for (name, op) in [("note-rename", JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), ("test-backup", test_backup_op())] {
        let sb = sandbox();
        let root = rename_vault(&sb);
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        let before = snapshot(&root);
        let (at, go) = block_at(&core, |p| *p == JobPoint::AfterPlanning);
        let job = ok!(core.jobs().start(op), format!("{name}: start"));
        assert!(at.recv_timeout(Duration::from_secs(30)).is_ok(), "{name}: the job reached the end of planning");
        let t0 = Instant::now();
        let c = core.jobs().cancel(job);
        let _ = go.send(());
        assert!(c.is_ok(), "{name}: cancel is allowed in planning: {c:?}");
        let report = some!(core.jobs().wait(job, Duration::from_secs(5)), format!("{name}: report"));
        assert!(t0.elapsed() <= Duration::from_secs(1), "{name}: stops within 1 s ({} ms)", t0.elapsed().as_millis());
        assert_eq!(report.phase, Phase::Cancelled, "{name}: {report:?}");
        assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "{name}: the vault is byte-identical");
        assert_eq!(zips(&sb.dirs), Vec::<PathBuf>::new(), "{name}: no zip");
    }
}

#[test]
fn fr_ux_07_ac10_note_rename_is_not_cancellable_while_writing() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (at, go) = block_at(&core, |p| matches!(p, JobPoint::AfterRead { .. }));
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), "start");
    assert!(at.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached writing");
    let c = core.jobs().cancel(job);
    let _ = go.send(());
    assert!(matches!(c, Err(JobError::NotCancellable)), "NotCancellable during writing (D-393): {c:?}");
    let report = some!(core.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_eq!(report.phase, Phase::Done, "the rename completes; its remedy is Undo: {report:?}");
}

#[test]
fn fr_ux_07_ac3_cancelled_job_emits_a_final_cancelled_event_and_writes_nothing() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let rx = core.events();
    let before = snapshot(&root);
    let (at, go) = block_at(&core, |p| *p == JobPoint::AfterPlanning);
    let job = ok!(core.jobs().start(test_backup_op()), "start");
    assert!(at.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let c = core.jobs().cancel(job);
    let _ = go.send(());
    assert!(c.is_ok(), "cancel: {c:?}");
    let ev: Vec<JobProgress> = progress_of(&rx, Duration::from_secs(5)).into_iter().map(|(_, p)| p).filter(|p| p.job == job).collect();
    assert_eq!(ev.last().map(|p| p.phase), Some(Phase::Cancelled), "a final progress event with the cancelled state: {ev:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical");
}
