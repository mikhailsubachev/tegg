//! MS4 slice 4D-lite AC tests with the sync simulator (L4): docs/acceptance/tags.md FR-TAG-04 AC-8 (an external write
//! to Rozpočet at each job point skips it `changed`, its bytes stay the external version, the rest is rewritten,
//! `Retry` re-reads and rewrites only the tag bytes; deleted (`missing`) and online-only (`placeholder`) files are
//! skipped the same way) and FR-TAG-08 AC-5 (the same rules for `tag-delete`). Interface: docs/contracts/ms4-tags.md
//! §4.4 (D-726: Retry re-applies the row's own op), ms4-jobs §4 (`Jobs::retry`), §5 (skip reasons, job points).
//! The online-only placeholder is simulated by a `VaultFs` wrapper, as in ac_sync_rename.rs. Written from the ACs
//! and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::HashSet;
use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};

use common::{open_core_with, read_text, sandbox};
use tags_setup::*;
use tegg_format::nfc;
use tegg_jobs::{JobOp, JobPoint, Phase, RetryOutcome, SkipReason};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

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
const EXTERNAL: &str = "Externí změna z jiné aplikace.\n";

struct Run {
    root: std::path::PathBuf,
    core: tegg_core::Core,
    job: u64,
    report: tegg_jobs::JobReport,
    injected: bool,
    _sb: common::Sandbox,
}

/// Runs `op` on a fresh copy, applying `change` to Rozpočet once at `at`.
fn run(op: JobOp, change: Change, at: At) -> Result<Run, String> {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = SimFs::new(&root);
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let done = Arc::new(Mutex::new(false));
    let (r, d, f) = (root.clone(), done.clone(), fs.clone());
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        let hit = match (at, p) {
            (At::AfterPlanning, JobPoint::AfterPlanning) => true,
            (At::AfterRead, JobPoint::AfterRead { path }) => nfc(path) == ROZPOCET,
            (At::TempWritten, JobPoint::TempWritten { path }) => nfc(path) == ROZPOCET,
            _ => false,
        };
        let mut once = d.lock().unwrap_or_else(|p| p.into_inner());
        if !hit || *once {
            return;
        }
        *once = true;
        match change {
            Change::Write => std::fs::write(r.join(ROZPOCET), format!("{}{EXTERNAL}", tx(ROZPOCET))).expect("sync simulator: write"),
            Change::Delete => std::fs::remove_file(r.join(ROZPOCET)).expect("sync simulator: delete"),
            Change::Placeholder => f.evict(ROZPOCET),
        }
    })));
    let (job, report) = run_confirmed(&core, op)?;
    let injected = *done.lock().unwrap_or_else(|p| p.into_inner());
    Ok(Run { root, core, job, report, injected, _sb: sb })
}

fn rename() -> JobOp {
    JobOp::TagRename { from: "účty".into(), to: "Výdaje".into() }
}
fn delete() -> JobOp {
    JobOp::TagDelete { tag: "účty".into(), keep_text: false }
}

#[test]
fn fr_tag_04_ac8_external_write_at_each_job_point_skips_rozpocet() {
    for at in POINTS {
        let r = ok!(run(rename(), Change::Write, at), &format!("tag-rename with a write at {at:?}"));
        assert!(r.injected, "{at:?}: the point was reached");
        assert_eq!(r.report.phase, Phase::Done, "{at:?}: {:?}", r.report);
        assert_eq!(r.report.skipped.iter().map(|s| (nfc(&s.path), s.reason)).collect::<Vec<_>>(), vec![(ROZPOCET.to_string(), SkipReason::Changed)], "{at:?}: Rozpočet skipped `changed`");
        let external = format!("{}{EXTERNAL}", tx(ROZPOCET));
        assert_eq!(read_text(&r.root, ROZPOCET), Some(external.clone()), "{at:?}: its bytes equal the external version");
        assert_eq!(read_text(&r.root, DEN), Some(tx_swap(DEN, &[("#ÚČTY", "#Výdaje")])), "{at:?}: the rest is rewritten");
        let retry = ok!(r.core.jobs().retry(r.job, ROZPOCET), "Retry");
        assert_eq!(retry, RetryOutcome::Written, "{at:?}: Retry writes");
        assert_eq!(read_text(&r.root, ROZPOCET), Some(external.replacen("tags: [účty, finance]", "tags: [Výdaje, finance]", 1)), "{at:?}: Retry re-reads and rewrites only the tag bytes");
    }
}

#[test]
fn fr_tag_04_ac8_deleted_and_online_only_files_are_skipped() {
    for (change, reason) in [(Change::Delete, SkipReason::Missing), (Change::Placeholder, SkipReason::Placeholder)] {
        let r = ok!(run(rename(), change, At::AfterPlanning), &format!("tag-rename with {change:?}"));
        assert_eq!(r.report.phase, Phase::Done, "{change:?}: {:?}", r.report);
        assert!(r.report.skipped.iter().any(|s| nfc(&s.path) == ROZPOCET && s.reason == reason), "{change:?}: Rozpočet skipped {reason:?}: {:?}", r.report);
        assert_eq!(read_text(&r.root, FAKTURA).map(|t| t.contains("#Výdaje")), Some(true), "{change:?}: the rest is rewritten");
    }
}

#[test]
fn fr_tag_08_ac5_tag_delete_follows_the_same_skip_and_retry_rules() {
    let r = ok!(run(delete(), Change::Write, At::AfterRead), "tag-delete with a write at AfterRead");
    assert_eq!(r.report.phase, Phase::Done, "{:?}", r.report);
    assert_eq!(r.report.kind, tegg_jobs::JobKind::TagDelete, "kind tag-delete");
    assert!(r.report.skipped.iter().any(|s| nfc(&s.path) == ROZPOCET && s.reason == SkipReason::Changed), "Rozpočet skipped `changed`");
    let retry = ok!(r.core.jobs().retry(r.job, ROZPOCET), "Retry");
    assert_eq!(retry, RetryOutcome::Written, "Retry writes");
    let external = format!("{}{EXTERNAL}", tx(ROZPOCET));
    assert_eq!(read_text(&r.root, ROZPOCET), Some(external.replacen("tags: [účty, finance]", "tags: [finance]", 1)), "Retry re-applies remove-tag to the current bytes (D-726)");
}
