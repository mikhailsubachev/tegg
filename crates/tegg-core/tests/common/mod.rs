//! Setup helpers for the tegg-core AC tests (docs/contracts/ms2-core.md). No assertions live here: a panic in
//! this file is a setup failure, never a red test (tools/qa CONTRACT §5.2). Helpers only touch temporary
//! directories, the committed synthetic fixtures (read-only) and the generated reference vault (D-62).
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tegg_vault::{AppDirs, FileVersion, FsEntry, MemFs, VaultFs};

pub const NFD_CTENI: &str = "C\u{30C}teni\u{301}"; // "Čtení" decomposed
pub const NFC_CTENI: &str = "\u{10C}ten\u{ED}";

// Fixture objects of tests/fixtures/vaults/search (search-navigation.md).
pub const CTENI: &str = "Pages/Čtení knih.md";
pub const ROZPOCET: &str = "Pages/Rozpočet 2026.md";
pub const PROJEKT: &str = "Pages/Projekt a rozpočet.md";
pub const TOMAS: &str = "Tasks/Zavolat Tomášovi.md";
pub const NAPAD: &str = "Quick Notes/Nápad na výlet.md";
pub const OBYCEJNA: &str = "Pages/Obyčejná poznámka.md";
pub const TEMPLATE: &str = "_templates/Page/Šablona stránky.md";
pub const TRASHED: &str = ".trash/Pages/Smazaný rozpočet.md";

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo root")
}

pub struct Sandbox {
    pub tmp: tempfile::TempDir,
    pub base: PathBuf,
    pub dirs: AppDirs,
}

pub fn sandbox() -> Sandbox {
    let tmp = tempfile::tempdir().expect("tempdir");
    let base = tmp.path().canonicalize().expect("canonical tempdir");
    let app = base.join("Application Support").join("Tegg");
    std::fs::create_dir_all(&app).expect("app support dir");
    Sandbox { tmp, base, dirs: AppDirs { root: app } }
}

/// A second Application Support stand-in in the same sandbox (a "fresh machine" without an index).
pub fn fresh_dirs(sb: &Sandbox, name: &str) -> AppDirs {
    let app = sb.base.join(name).join("Tegg");
    std::fs::create_dir_all(&app).expect("app support dir");
    AppDirs { root: app }
}

pub fn write_raw(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(&p, bytes).expect("write file");
}

fn copy_tree(from: &Path, to: &Path, skip_top: &[&str]) {
    std::fs::create_dir_all(to).expect("create dir");
    for e in std::fs::read_dir(from).expect("read_dir") {
        let e = e.expect("entry");
        let name = e.file_name();
        if skip_top.iter().any(|s| name == std::ffi::OsStr::new(s)) {
            continue;
        }
        let ty = e.file_type().expect("file type");
        if ty.is_dir() {
            copy_tree(&e.path(), &to.join(&name), &[]);
        } else {
            std::fs::copy(e.path(), to.join(&name)).expect("copy file");
        }
    }
}

/// `tests/fixtures/vaults/search/` plus `new-empty/.tegg/` copied into `<sandbox>/Trezor`.
pub fn search_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_tree(&fx.join("search"), &root, &[]);
    copy_tree(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}

/// The search fixture loaded into a `MemFs` (files only), for in-memory and sync-adapter tests.
pub fn search_memfs() -> Arc<MemFs> {
    let sb = sandbox();
    let root = search_vault(&sb);
    let fs = Arc::new(MemFs::new());
    for (rel, bytes) in files_with_bytes(&root) {
        fs.write_external(&rel, &bytes).expect("memfs write");
    }
    fs
}

/// A minimal vault in a `MemFs`: `.tegg/` from the new-empty fixture plus the given files.
pub fn memfs_vault(files: &[(&str, &str)]) -> Arc<MemFs> {
    let fs = Arc::new(MemFs::new());
    let fx = repo_root().join("tests/fixtures/vaults/new-empty");
    for (rel, bytes) in files_with_bytes(&fx) {
        fs.write_external(&rel, &bytes).expect("memfs write");
    }
    for (p, text) in files {
        fs.write_external(p, text.as_bytes()).expect("memfs write");
    }
    fs
}

/// Relative path (NFC as stored by the fixture) → bytes, every regular file.
pub fn files_with_bytes(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut entries: Vec<_> = std::fs::read_dir(dir).expect("read_dir").map(|e| e.expect("entry")).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            if e.file_type().expect("type").is_dir() {
                walk(root, &p, out);
            } else {
                let rel = p.strip_prefix(root).expect("rel").to_string_lossy().replace('\\', "/");
                out.push((rel, std::fs::read(&p).expect("read")));
            }
        }
    }
    walk(root, root, &mut out);
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub bytes_hash: u64,
    pub len: u64,
    pub mtime_ns: i128,
    pub ino: u64,
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Every file under `root` (dot-folders included): bytes, mtime and inode. Directory entries are listed with
/// zeroes so created folders show up too.
pub fn snapshot(root: &Path) -> BTreeMap<String, Entry> {
    let mut out = BTreeMap::new();
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Entry>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd {
            let e = e.expect("entry");
            let p = e.path();
            let rel = p.strip_prefix(root).expect("rel").to_string_lossy().to_string();
            let md = std::fs::symlink_metadata(&p).expect("metadata");
            if md.is_dir() {
                out.insert(format!("{rel}/"), Entry { bytes_hash: 0, len: 0, mtime_ns: 0, ino: 0 });
                walk(root, &p, out);
            } else {
                let bytes = std::fs::read(&p).expect("read");
                let mtime_ns = md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128;
                out.insert(rel, Entry { bytes_hash: fnv(&bytes), len: md.len(), mtime_ns, ino: md.ino() });
            }
        }
    }
    walk(root, root, &mut out);
    out
}

/// A `VaultFs` wrapper that counts calls, so tests can check "zero writes" and "never read".
pub struct CountingFs<T: VaultFs> {
    pub inner: T,
    pub writes: AtomicUsize,
    pub reads: std::sync::Mutex<Vec<String>>,
}

impl<T: VaultFs> CountingFs<T> {
    pub fn new(inner: T) -> Arc<CountingFs<T>> {
        Arc::new(CountingFs { inner, writes: AtomicUsize::new(0), reads: std::sync::Mutex::new(Vec::new()) })
    }
    pub fn write_count(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }
    pub fn read_paths(&self) -> Vec<String> {
        self.reads.lock().expect("lock").clone()
    }
}

impl<T: VaultFs> VaultFs for CountingFs<T> {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.reads.lock().expect("lock").push(path.to_string());
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
}

/// Polls `f` every 20 ms until it returns true or `timeout` passes; returns the elapsed time on success.
pub fn wait_until(timeout: Duration, mut f: impl FnMut() -> bool) -> Option<Duration> {
    let t0 = Instant::now();
    loop {
        if f() {
            return Some(t0.elapsed());
        }
        if t0.elapsed() > timeout {
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ---------------------------------------------------------------- performance (contract §4)

/// The latency target to assert: `brd × factor` in release builds (D-59: 0.75 for latencies, 0.6 for the
/// full index), `brd × 10` in debug builds (catches gross regressions only).
pub fn target(brd: Duration, release_factor: f64) -> Duration {
    if cfg!(debug_assertions) {
        brd * 10
    } else {
        brd.mul_f64(release_factor)
    }
}

pub fn p95(samples: &mut [Duration]) -> Duration {
    samples.sort();
    let i = ((samples.len() as f64) * 0.95).ceil() as usize;
    samples[i.saturating_sub(1).min(samples.len() - 1)]
}

fn target_dir() -> PathBuf {
    if let Ok(t) = std::env::var("CARGO_TARGET_DIR") {
        return PathBuf::from(t);
    }
    // <target>/<profile>/deps/<test binary>
    let exe = std::env::current_exe().expect("current exe");
    exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).expect("target dir").to_path_buf()
}

/// The reference vault (gen-vault `--seed 1`, small images), generated once per `target/` directory and
/// reused; `TEGG_REF_VAULT=<dir>` overrides it. Read-only for tests: copy it before changing files.
pub fn reference_vault() -> PathBuf {
    if let Ok(p) = std::env::var("TEGG_REF_VAULT") {
        return PathBuf::from(p);
    }
    let dest = target_dir().join("tegg-ref-vault-seed1-small");
    if dest.join(".tegg/vault.yml").exists() {
        return dest;
    }
    let tmp = target_dir().join(format!("tegg-ref-vault.tmp-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let mut o = gen_vault::Options::reference(1);
    o.full_images = false;
    gen_vault::generate(&tmp, &o).expect("generate reference vault");
    if std::fs::rename(&tmp, &dest).is_err() {
        let _ = std::fs::remove_dir_all(&tmp); // another test process generated it first
    }
    assert_setup(dest.join(".tegg/vault.yml").exists());
    dest
}

fn assert_setup(ok: bool) {
    if !ok {
        panic!("setup: reference vault missing");
    }
}

/// A private copy of the reference vault's Markdown (no `_attachments/`), for tests that change files.
pub fn reference_vault_copy(sb: &Sandbox) -> PathBuf {
    let src = reference_vault();
    let dst = sb.base.join("RefCopy");
    copy_tree(&src, &dst, &["_attachments"]);
    dst
}

/// Notes the index must contain (contract §1): `*.md` outside dot-folders and `_templates/`, no temp files.
pub fn indexable_notes(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(dir).expect("read_dir") {
            let e = e.expect("entry");
            let name = e.file_name().to_string_lossy().to_string();
            let p = e.path();
            if e.file_type().expect("type").is_dir() {
                if name.starts_with('.') || (dir == root && name == "_templates") {
                    continue;
                }
                walk(root, &p, out);
            } else if name.ends_with(".md") && !name.starts_with('.') {
                out.push(p.strip_prefix(root).expect("rel").to_string_lossy().to_string());
            }
        }
    }
    walk(root, root, &mut out);
    out.sort();
    out
}

pub fn tree_digest(root: &Path) -> u64 {
    gen_vault::tree_digest(root).expect("tree digest")
}
