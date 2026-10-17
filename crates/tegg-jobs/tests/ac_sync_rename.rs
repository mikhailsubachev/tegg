//! MS4 slice 4C AC tests with the sync simulator (L4): docs/acceptance/rename.md FR-LNK-03 AC-15 (external write,
//! delete and online-only placeholder at each named job point; Retry), and links.md FR-FMT-08 / FR-LNK-03 AC-6
//! (named by its FR-LNK-03 alias key). Interface: docs/contracts/ms4-jobs.md §4 (`Jobs::retry`), §5 (skip reasons),
//! and the test-only named job points (`JobPoint`, `Jobs::set_point_hook`) the stub defines for "the sync simulator
//! injects external writes at named job points" (rename.md "Test layers", L4). Written from the ACs and the contract
//! only (D-61).
//!
//! The "other program" writes the real file on APFS with `std::fs` (in place, like a sync client). An online-only
//! placeholder is simulated by a `VaultFs` wrapper that reports the file as a placeholder from the injection on and
//! fails its reads (ms2-core: placeholders are never read), while its bytes stay on disk.

#[macro_use]
mod common;

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use common::*;
use tegg_format::nfc;
use tegg_jobs::{JobPoint, Phase, RetryOutcome, SkipReason};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

/// LocalFs plus a set of paths that have turned into online-only placeholders.
struct SimFs {
    inner: LocalFs,
    placeholders: Mutex<HashSet<String>>,
}
impl SimFs {
    fn new(root: &Path) -> Arc<SimFs> {
        Arc::new(SimFs { inner: LocalFs::new(root), placeholders: Mutex::new(HashSet::new()) })
    }
    fn evict(&self, path: &str) {
        self.placeholders.lock().unwrap_or_else(|p| p.into_inner()).insert(nfc(path));
    }
    fn is_ph(&self, path: &str) -> bool {
        self.placeholders.lock().unwrap_or_else(|p| p.into_inner()).contains(&nfc(path))
    }
}
impl VaultFs for SimFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        if self.is_ph(path) {
            return Err(io::Error::other("online-only placeholder (sync simulator)"));
        }
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        Ok(self.is_ph(path) || self.inner.is_placeholder(path)?)
    }
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        self.inner.stat(path)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Change {
    Write,
    Delete,
    Placeholder,
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum At {
    AfterPlanning,
    AfterRead,
    TempWritten,
}

const POINTS: [At; 3] = [At::AfterPlanning, At::AfterRead, At::TempWritten];
const EXTERNAL_LINE: &str = "Externí změna z jiné aplikace.\n";

fn external_text() -> String {
    format!("{}{EXTERNAL_LINE}", fixture_text(ODKAZY))
}

struct Run {
    root: PathBuf,
    core: tegg_core::Core,
    job: u64,
    report: tegg_jobs::JobReport,
    injected: bool,
    _sb: Sandbox,
}

/// Renames Alfa → Gama on a fresh fixture copy, applying `change` to Odkazy once at `at`.
fn run(change: Change, at: At) -> Result<Run, String> {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let fs = SimFs::new(&root);
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let done = Arc::new(Mutex::new(false));
    let (r, d, f) = (root.clone(), done.clone(), fs.clone());
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        let hit = match (at, p) {
            (At::AfterPlanning, JobPoint::AfterPlanning) => true,
            (At::AfterRead, JobPoint::AfterRead { path }) => nfc(path) == ODKAZY,
            (At::TempWritten, JobPoint::TempWritten { path }) => nfc(path) == ODKAZY,
            _ => false,
        };
        let mut once = d.lock().unwrap_or_else(|p| p.into_inner());
        if !hit || *once {
            return;
        }
        *once = true;
        match change {
            Change::Write => std::fs::write(r.join(ODKAZY), external_text()).expect("sync simulator: write"),
            Change::Delete => std::fs::remove_file(r.join(ODKAZY)).expect("sync simulator: delete"),
            Change::Placeholder => f.evict(ODKAZY),
        }
    })));
    let (job, report) = rename(&core, ALFA, "Gama")?;
    let injected = *done.lock().unwrap_or_else(|p| p.into_inner());
    Ok(Run { root, core, job, report, injected, _sb: sb })
}

/// The other affected files are rewritten as without the external change.
fn others_rewritten(root: &Path) -> Vec<String> {
    let mut bad = Vec::new();
    let want = [
        (VLASTNOSTI, Some(fixture_text(VLASTNOSTI).replace("[[Alfa]]", "[[Gama]]"))),
        (DEN, Some(swapped(DEN, "[[Alfa]]", "[[Gama]]"))),
        (SABLONA, Some(swapped(SABLONA, "[[Alfa]]", "[[Gama]]"))),
        (WINDOWS, Some(swapped(WINDOWS, "[[Alfa]]", "[[Gama]]"))),
    ];
    for (p, w) in want {
        if read_text(root, p) != w {
            bad.push(p.to_string());
        }
    }
    if !root.join(GAMA).exists() || root.join(ALFA).exists() {
        bad.push("Pages/Gama.md (rename)".into());
    }
    bad
}

fn skipped_as(r: &Run, reason: SkipReason) -> bool {
    r.report.skipped.iter().any(|s| nfc(&s.path) == ODKAZY && s.reason == reason) && !r.report.written.iter().any(|p| nfc(p) == ODKAZY)
}

#[test]
fn fr_lnk_03_ac15_external_write_at_each_job_point_skips_odkazy() {
    let mut problems = Vec::new();
    for at in POINTS {
        let r = ok!(run(Change::Write, at), format!("{at:?}: rename with the sync simulator"));
        assert!(r.injected, "{at:?}: the job passed the named point (the external write happened)");
        if read_text(&r.root, ODKAZY) != Some(external_text()) {
            problems.push(format!("{at:?}: Odkazy isn't exactly the external version"));
        }
        if !skipped_as(&r, SkipReason::Changed) {
            problems.push(format!("{at:?}: Odkazy not listed as skipped/changed: {:?}", r.report));
        }
        for b in others_rewritten(&r.root) {
            problems.push(format!("{at:?}: {b} not rewritten"));
        }
        if r.report.phase != Phase::Done {
            problems.push(format!("{at:?}: phase {:?}", r.report.phase));
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "an external write to Odkazy at any point makes the job skip it and keep the external bytes");
}

#[test]
fn fr_lnk_03_ac15_retry_rewrites_only_link_bytes_keeping_the_external_edit() {
    let r = ok!(run(Change::Write, At::AfterRead), "rename with an external write after reading Odkazy");
    assert!(skipped_as(&r, SkipReason::Changed), "skipped first: {:?}", r.report);
    let out = ok!(r.core.jobs().retry(r.job, ODKAZY), "Retry");
    assert_eq!(out, RetryOutcome::Written, "Retry re-plans Odkazy against its current bytes and writes");
    assert_eq!(read_text(&r.root, ODKAZY), Some(format!("{}{EXTERNAL_LINE}", odkazy_after_gama())), "only the link bytes change; the external edit is kept");
}

#[test]
fn fr_lnk_03_ac15_deleted_during_the_job_is_missing_and_not_recreated() {
    let mut problems = Vec::new();
    for at in POINTS {
        let r = ok!(run(Change::Delete, at), format!("{at:?}: rename with the sync simulator"));
        assert!(r.injected, "{at:?}: the job passed the named point (the delete happened)");
        if r.root.join(ODKAZY).exists() {
            problems.push(format!("{at:?}: Odkazy exists again"));
        }
        if !skipped_as(&r, SkipReason::Missing) {
            problems.push(format!("{at:?}: Odkazy not skipped/missing: {:?}", r.report));
        }
        for b in others_rewritten(&r.root) {
            problems.push(format!("{at:?}: {b} not rewritten"));
        }
        if at == At::AfterRead {
            let retry = r.core.jobs().retry(r.job, ODKAZY);
            if matches!(retry, Ok(RetryOutcome::Written)) || r.root.join(ODKAZY).exists() {
                problems.push(format!("{at:?}: Retry of a missing file wrote it: {retry:?}"));
            }
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "a deleted Odkazy is skipped with reason missing and never recreated");
}

#[test]
fn fr_lnk_03_ac15_online_only_placeholder_is_not_downloaded_and_untouched() {
    let mut problems = Vec::new();
    for at in POINTS {
        let r = ok!(run(Change::Placeholder, at), format!("{at:?}: rename with the sync simulator"));
        assert!(r.injected, "{at:?}: the job passed the named point (the file became a placeholder)");
        if read_bytes(&r.root, ODKAZY) != Some(fixture(ODKAZY)) {
            problems.push(format!("{at:?}: Odkazy's bytes changed"));
        }
        if !skipped_as(&r, SkipReason::Placeholder) {
            problems.push(format!("{at:?}: Odkazy not skipped/placeholder: {:?}", r.report));
        }
        for b in others_rewritten(&r.root) {
            problems.push(format!("{at:?}: {b} not rewritten"));
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "an online-only Odkazy is skipped with reason not downloaded (placeholder)");
}

#[test]
fn fr_lnk_03_ac6_another_program_editing_a_linking_note_is_never_overwritten() {
    // links.md AC-6: the note isn't overwritten; it is listed as "link not updated" with a one-click retry.
    let r = ok!(run(Change::Write, At::TempWritten), "rename with an external write between the temp write and the rename");
    assert_eq!(read_text(&r.root, ODKAZY), Some(external_text()), "the other program's version survives");
    assert!(skipped_as(&r, SkipReason::Changed), "listed: {:?}", r.report);
    let out = ok!(r.core.jobs().retry(r.job, ODKAZY), "one-click retry");
    assert_eq!(out, RetryOutcome::Written, "the retry updates the link");
}
