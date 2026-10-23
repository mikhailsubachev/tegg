//! Setup helpers for the slice 4C AC tests (docs/contracts/ms4-jobs.md). No AC assertions live here: a panic in this
//! file is a setup failure, never a red test (tools/qa CONTRACT §5.2). Helpers only touch temporary directories and
//! the committed synthetic fixtures (read-only, D-62). The `ok!` macro turns an `Err` of the API under test into an
//! assertion **in the test file** that uses it (so a stub's `NotImplemented` is red for an assertion, TS-I1).
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tegg_core::{Core, CoreOptions};
use tegg_jobs::testing::NodeTransformer;
use tegg_jobs::{JobId, JobOp, JobReport};
use tegg_vault::{AppDirs, FileVersion, FsEntry, LocalFs, VaultFs};

#[macro_export]
macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

#[macro_export]
macro_rules! some {
    ($e:expr, $what:expr) => {
        match $e {
            Some(v) => v,
            None => {
                assert!(false, "{}: got None", $what);
                unreachable!()
            }
        }
    };
}

// ------------------------------------------------------------------------------------------------ fixture paths

pub const ALFA: &str = "Pages/Alfa.md";
pub const GAMA: &str = "Pages/Gama.md";
pub const ODKAZY: &str = "Pages/Odkazy.md";
pub const KOD: &str = "Pages/Kód.md";
pub const VLASTNOSTI: &str = "Books/Vlastnosti.md";
pub const NFD_ODKAZ: &str = "Pages/NFD odkaz.md";
pub const CAJ: &str = "Pages/Čaj o páté.md";
pub const DVOJNIK: &str = "Pages/Alfa (2).md";
pub const JINDE: &str = "Projekty/Alfa.md";
pub const MISTNI: &str = "Projekty/Místní.md";
pub const SABLONA: &str = "_templates/Page/Page.md";
pub const KOS: &str = ".trash/Pages/Starý.md";
pub const DEN: &str = "Daily/2026-10-14.md";
pub const WINDOWS: &str = "Pages/Windows.md";
pub const BETA: &str = "Pages/Beta.md";
pub const ALFA_ID: &str = "01JB4C0000000000000000R001";

pub fn vyplne() -> Vec<String> {
    (1..=40).map(|i| format!("Pages/Výplň {i:02}.md")).collect()
}

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo root")
}

// ------------------------------------------------------------------------------------------------ sandbox

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

/// `tests/fixtures/vaults/rename/` (without its README.md) plus `new-empty/.tegg/` in `<sandbox>/Trezor`.
pub fn rename_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("rename"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}

/// The fixture bytes of a vault path (read-only).
pub fn fixture(rel: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/vaults/rename").join(rel)).expect("setup: fixture file")
}
pub fn fixture_text(rel: &str) -> String {
    String::from_utf8(fixture(rel)).expect("setup: fixture is UTF-8")
}

pub fn write_raw(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("setup: create parent");
    }
    std::fs::write(&p, bytes).expect("setup: write file");
}
pub fn read_text(root: &Path, rel: &str) -> Option<String> {
    std::fs::read(root.join(rel)).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}
pub fn read_bytes(root: &Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}

/// One `NodeTransformer` per test binary (D-749): it answers each request on its own, so cores can share it, and a
/// property test opening thousands of cores no longer starts a Node process for each.
pub fn transformer() -> Result<Arc<NodeTransformer>, String> {
    static T: OnceLock<Result<Arc<NodeTransformer>, String>> = OnceLock::new();
    T.get_or_init(|| NodeTransformer::from_repo(&repo_root()).map(Arc::new).map_err(|e| format!("NodeTransformer (npm run build --prefix packages/doc): {e}")))
        .clone()
}

/// Opens the core (no watcher unless asked), waits for the index, and installs the real `@tegg/doc` transformer
/// (`NodeTransformer`, ms4-jobs §2.2). Returns the transformer start result for the test to assert on.
pub fn open_core(root: &Path, dirs: &AppDirs, watch: bool) -> Result<Core, String> {
    let core = Core::open(root, dirs, CoreOptions { watch, sync: None }).map_err(|e| format!("Core::open: {e:?}"))?;
    if !core.wait_idle(Duration::from_secs(120)) {
        return Err("indexing did not become idle within 120 s".into());
    }
    core.jobs().set_transformer(transformer()?);
    Ok(core)
}
pub fn open_core_with(fs: Arc<dyn VaultFs>, dirs: &AppDirs) -> Result<Core, String> {
    let core = Core::open_with(fs, dirs, CoreOptions { watch: false, sync: None }).map_err(|e| format!("Core::open_with: {e:?}"))?;
    if !core.wait_idle(Duration::from_secs(120)) {
        return Err("indexing did not become idle within 120 s".into());
    }
    core.jobs().set_transformer(transformer()?);
    Ok(core)
}

/// Starts a job and waits for its report (60 s). `Err` carries what went wrong, for the test to assert on.
pub fn run_job(core: &Core, op: JobOp) -> Result<(JobId, JobReport), String> {
    let job = core.jobs().start(op.clone()).map_err(|e| format!("Jobs::start({op:?}): {e:?}"))?;
    let report = core.jobs().wait(job, Duration::from_secs(60)).ok_or_else(|| format!("no report for job {job} within 60 s"))?;
    Ok((job, report))
}
pub fn rename(core: &Core, path: &str, title: &str) -> Result<(JobId, JobReport), String> {
    run_job(core, JobOp::NoteRename { path: path.into(), title: title.into() })
}

// ------------------------------------------------------------------------------------------------ snapshots

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub bytes: Vec<u8>,
    pub mtime_ns: i128,
    pub ino: u64,
}

/// Every file under `root` (dot-folders included): bytes, mtime and inode; directories listed with `/` and zeroes.
/// Keys are NFC.
pub fn snapshot(root: &Path) -> BTreeMap<String, Entry> {
    let mut out = BTreeMap::new();
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Entry>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd {
            let e = e.expect("entry");
            let p = e.path();
            let rel = tegg_format::nfc(&p.strip_prefix(root).expect("rel").to_string_lossy());
            let md = std::fs::symlink_metadata(&p).expect("metadata");
            if md.is_dir() {
                out.insert(format!("{rel}/"), Entry { bytes: Vec::new(), mtime_ns: 0, ino: 0 });
                walk(root, &p, out);
            } else {
                let mtime_ns = md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128;
                out.insert(rel, Entry { bytes: std::fs::read(&p).expect("read"), mtime_ns, ino: md.ino() });
            }
        }
    }
    walk(root, root, &mut out);
    out
}

/// Paths whose entry differs (bytes, mtime or inode), appeared or disappeared.
pub fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).cloned().collect()
}
pub fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
pub fn temp_files(root: &Path) -> Vec<String> {
    snapshot(root).into_keys().filter(|k| k.contains(".tegg-tmp")).collect()
}

/// The text with `modified:` blanked (for the renamed note, whose `modified` the title change touches).
pub fn no_modified(t: &str) -> String {
    t.lines().map(|l| if l.starts_with("modified:") { "modified: <x>" } else { l }).collect::<Vec<_>>().join("\n")
}

pub fn wait_until(timeout: Duration, mut f: impl FnMut() -> bool) -> bool {
    let t0 = Instant::now();
    loop {
        if f() {
            return true;
        }
        if t0.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ------------------------------------------------------------------------------------------------ the expected bytes

/// Odkazy after Alfa → Gama (FR-LNK-03 AC-7, D-383): every link form kept, near misses unchanged.
pub fn odkazy_after_gama() -> String {
    fixture_text(ODKAZY)
        .replacen("[[Alfa]]\n", "[[Gama]]\n", 1)
        .replace("[[Alfa|vlastní text]]", "[[Gama|vlastní text]]")
        .replace("\n[[Alfa#Úvod]]", "\n[[Gama#Úvod]]")
        .replace("[[Alfa#^b1]]", "[[Gama#^b1]]")
        .replace("![[Alfa]]", "![[Gama]]")
        .replace("![[Alfa#Úvod]]", "![[Gama#Úvod]]")
        .replace("[[Pages/Alfa]]", "[[Pages/Gama]]")
        .replace("[[Alfa.md]]", "[[Gama.md]]")
        .replace("[Alfa](Alfa.md)", "[Alfa](Gama.md)")
        .replace("[jinak](../Pages/Alfa.md)", "[jinak](../Pages/Gama.md)")
}

/// The fixture text of `rel` with every `from` replaced by `to` (a linking file whose only change is its links).
pub fn swapped(rel: &str, from: &str, to: &str) -> String {
    let t = fixture_text(rel);
    assert_setup(t.contains(from), &format!("fixture {rel} contains {from:?}"));
    t.replace(from, to)
}

pub fn assert_setup(ok: bool, what: &str) {
    if !ok {
        panic!("setup: {what}");
    }
}

// ------------------------------------------------------------------------------------------------ a counting / recording file system

/// A `VaultFs` over `LocalFs` that records every write operation with its target path and the bytes written, so a
/// test can check "one write per affected file" and that no intermediate state was ever written (FR-SYN-06 AC-11).
pub struct RecordingFs {
    pub inner: LocalFs,
    pub root: PathBuf,
    pub ops: Mutex<Vec<(String, String, Vec<u8>)>>, // (op, path, bytes)
}

impl RecordingFs {
    pub fn new(root: &Path) -> Arc<RecordingFs> {
        Arc::new(RecordingFs { inner: LocalFs::new(root), root: root.to_path_buf(), ops: Mutex::new(Vec::new()) })
    }
    pub fn ops(&self) -> Vec<(String, String, Vec<u8>)> {
        self.ops.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    fn rec(&self, op: &str, path: &str, bytes: &[u8]) {
        self.ops.lock().unwrap_or_else(|p| p.into_inner()).push((op.to_string(), tegg_format::nfc(path), bytes.to_vec()));
    }
}

impl VaultFs for RecordingFs {
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
        self.rec("replace", path, bytes);
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.rec("create_new", path, bytes);
        self.inner.create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        // The bytes that land at `to`: the content of `from` at the moment of the rename.
        let bytes = std::fs::read(self.root.join(from)).unwrap_or_default();
        self.rec(&format!("rename_from:{}", tegg_format::nfc(from)), to, &bytes);
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.rec("create_dir_all", path, b"");
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.rec("remove_file", path, b"");
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        self.inner.stat(path)
    }
}
