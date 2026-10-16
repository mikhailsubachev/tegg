//! Regression for the PR #38 QA review (FR-DLY-02 AC-10, FR-SYN-06): an `Io` error reported after the first write's
//! file is already in place (e.g. a failed directory fsync) must not lead to a second Daily Note on the retry.
mod common;

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::NaiveDate;
use common::*;
use tegg_core::{Core, CoreOptions};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

/// Writes the file, then reports an error once (as if the fsync after the rename failed).
struct LateError {
    inner: LocalFs,
    fired: AtomicBool,
}
impl VaultFs for LateError {
    fn list(&self) -> io::Result<Vec<FsEntry>> { self.inner.list() }
    fn read(&self, p: &str) -> io::Result<(Vec<u8>, FileVersion)> { self.inner.read(p) }
    fn version(&self, p: &str) -> io::Result<Option<FileVersion>> { self.inner.version(p) }
    fn replace(&self, p: &str, b: &[u8]) -> io::Result<FileVersion> { self.inner.replace(p, b) }
    fn create_new(&self, p: &str, b: &[u8]) -> io::Result<FileVersion> {
        let v = self.inner.create_new(p, b)?;
        if p.contains("2026-10-14") && !self.fired.swap(true, Ordering::SeqCst) {
            return Err(io::Error::other("fsync failed after rename (test)"));
        }
        Ok(v)
    }
    fn rename_no_replace(&self, f: &str, t: &str) -> io::Result<()> { self.inner.rename_no_replace(f, t) }
    fn create_dir_all(&self, p: &str) -> io::Result<()> { self.inner.create_dir_all(p) }
    fn remove_file(&self, p: &str) -> io::Result<()> { self.inner.remove_file(p) }
    fn is_placeholder(&self, p: &str) -> io::Result<bool> { self.inner.is_placeholder(p) }
}

#[test]
fn bug_38_fr_dly_02_io_after_rename_never_makes_a_second_file() {
    let sb = sandbox();
    let root = sb.base.join("Deník");
    std::fs::create_dir_all(&root).expect("setup");
    let empty = repo_root().join("tests/fixtures/vaults/new-empty/.tegg");
    for e in std::fs::read_dir(&empty).expect("setup") {
        let e = e.expect("setup");
        if e.file_type().expect("setup").is_dir() {
            std::fs::create_dir_all(root.join(".tegg").join(e.file_name())).expect("setup");
            for f in std::fs::read_dir(e.path()).expect("setup") {
                let f = f.expect("setup");
                std::fs::copy(f.path(), root.join(".tegg").join(e.file_name()).join(f.file_name())).expect("setup");
            }
        } else {
            std::fs::create_dir_all(root.join(".tegg")).expect("setup");
            std::fs::copy(e.path(), root.join(".tegg").join(e.file_name())).expect("setup");
        }
    }
    let fs = Arc::new(LateError { inner: LocalFs::new(&root), fired: AtomicBool::new(false) });
    let core = Core::open_with(fs as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }).expect("open");
    assert!(core.wait_idle(Duration::from_secs(30)));
    let d = NaiveDate::from_ymd_opt(2026, 10, 14).expect("date");
    let bytes = "---\nid: 01JB4B0000000000000000B038\ntype: daily-note\ntitle: \"2026-10-14\"\ndate: 2026-10-14\nreview: unreviewed\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\nDnes\n";
    let first = core.daily_create(d, bytes.as_bytes());
    let made = match first {
        Ok(m) => m,
        Err(_) => core.daily_create(d, bytes.as_bytes()).expect("the retry"),
    };
    assert_eq!(made.path, "Daily/2026-10-14.md");
    let names: Vec<String> = std::fs::read_dir(root.join("Daily")).expect("Daily/").filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".md")).collect();
    assert_eq!(names, vec!["2026-10-14.md".to_string()], "exactly one Daily Note file");
}
