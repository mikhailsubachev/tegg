//! Setup for the slice G1 L4 tests of the core (docs/contracts/v1-graph.md §1.5, §2, §8): the graph fixture in a
//! temporary directory (tests/fixtures/vaults/graph + new-empty/.tegg + the README's runtime attachments; its README and
//! make-hub.* aren't vault files), the hub (the Rust twin shared with tegg-index's tests), a vault file system whose note
//! reads wait for a gate (the first index build "running"), and requests. No AC assertions here: a panic in this module
//! is a setup failure, never a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

#[path = "../../../tegg-index/tests/support/hub.rs"]
pub mod hub;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::common::{repo_root, Sandbox};
use tegg_core::{AppDirs, Core, CoreOptions, GraphRequest};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

pub const WINDOW: &str = "main";
pub const PLAN: &str = "Pages/Plán čtvrtletí.md";
pub const OSAMELA: &str = "Pages/Osamělá.md";

pub fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}

/// The graph fixture in `<sandbox>/Graf`.
pub fn graph_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Graf");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("graph"), &root, &["README.md", "make-hub.mjs", "make-hub.d.mts"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(root.join("_attachments")).expect("setup: _attachments");
    std::fs::copy(fx.join("trash-media/_attachments/záhon.png"), root.join("_attachments/graf.png")).expect("setup: graf.png");
    std::fs::copy(fx.join("trash-media/_attachments/Rozpočet.pdf"), root.join("_attachments/Smlouva.pdf")).expect("setup: Smlouva.pdf");
    root
}
pub fn hub_vault(sb: &Sandbox) -> PathBuf {
    let root = graph_vault(sb);
    hub::write_hub(&root);
    root
}

pub fn open(root: &Path, dirs: &AppDirs) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    if !core.wait_idle(Duration::from_secs(120)) {
        panic!("setup: indexing did not finish");
    }
    core
}

pub fn req(centre: &str, depth: u8) -> GraphRequest {
    GraphRequest { centre: tegg_format::nfc(centre), depth, cap: 150, ..Default::default() }
}

/// A local vault file system whose reads of notes (`.md` outside `.tegg/`) wait until `open()` (at most 20 s), so the
/// vault's first index build is still running while a test asks for a graph.
pub struct GatedFs {
    pub inner: LocalFs,
    gate: Arc<(Mutex<bool>, Condvar)>,
}
impl GatedFs {
    pub fn new(root: &Path) -> Arc<GatedFs> {
        Arc::new(GatedFs { inner: LocalFs::new(root), gate: Arc::new((Mutex::new(false), Condvar::new())) })
    }
    pub fn open(&self) {
        let (m, c) = &*self.gate;
        *m.lock().unwrap_or_else(|e| e.into_inner()) = true;
        c.notify_all();
    }
    fn wait(&self, path: &str) {
        if !path.ends_with(".md") || path.starts_with(".tegg/") {
            return;
        }
        let (m, c) = &*self.gate;
        let g = m.lock().unwrap_or_else(|e| e.into_inner());
        let _ = c.wait_timeout_while(g, Duration::from_secs(20), |open| !*open);
    }
}
impl VaultFs for GatedFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.wait(path);
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
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        self.inner.stat(path)
    }
}
