//! Setup for the MS6 slice 6A L4 tests (no AC assertions here): the trash-media fixture in a temporary directory
//! (tests/fixtures/vaults/trash-media + new-empty/.tegg; its README.md and make-media.mjs aren't vault files), R71's
//! trash times re-touched in order (git stores no ctime, docs/contracts/ms6-trash-media.md §9.3), a recording
//! `SystemTrash` (§1.1) and small file helpers. A failure here is a setup failure, never an AC assertion.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::common::{repo_root, snapshot, Entry, Sandbox};
use tegg_core::{Core, CoreOptions, FileVersion, SystemTrash};
use tegg_format::nfc;

pub const NOW: &str = "2026-10-22T10:00:00+02:00";
pub const PLAN: &str = "Pages/Plán zahrady.md";
pub const UKOL: &str = "Tasks/Koupit semínka.md";
pub const ODKAZY: &str = "Pages/Odkazy.md";
pub const IMG: &str = "Images/Záhon.md";
pub const PNG: &str = "_attachments/záhon.png";
pub const PDF_OBJ: &str = "PDFs/Rozpočet.md";
pub const PDF: &str = "_attachments/Rozpočet.pdf";
pub const T1: &str = ".trash/Quick Notes/Stará poznámka.md";
pub const T2: &str = ".trash/Pages/Zahrada.md";
pub const ZAHRADA: &str = "Pages/Zahrada.md";
pub const T3: &str = ".trash/Images/Smazaný obrázek.md";
pub const T3_FILE: &str = ".trash/_attachments/Smazaný obrázek.png";
pub const T4: &str = ".trash/_attachments/osiřelý.jpg";
pub const T5: &str = ".trash/Tasks/Hotovo.md";
pub const FOLDER: &str = ".trash/Recepty";
pub const BABOVKA: &str = ".trash/Recepty/Bábovka.md";
pub const SABLONA: &str = "_templates/Page/Page.md";
/// R71: newest first.
pub const ROW_ORDER: [&str; 6] = [T3, T2, T4, T5, FOLDER, T1];

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

/// The fixture vault in `sb`, with R71's trash times (oldest first, ≥ 25 ms apart).
pub fn tm_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Zahrada");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("trash-media"), &root, &["README.md", "make-media.mjs"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    touch_trash(&root);
    root
}

/// Renames each trashed entry out of `.trash/` and back, in R71's order (T1, Folder, T5, T4, T2, T3 with its file).
pub fn touch_trash(root: &Path) {
    let order: [&[&str]; 6] = [&[T1], &[FOLDER], &[T5], &[T4], &[T2], &[T3, T3_FILE]];
    for group in order {
        for rel in group {
            let p = root.join(rel);
            let tmp = root.join(".touch-6a");
            std::fs::rename(&p, &tmp).expect("setup: touch out");
            std::fs::rename(&tmp, &p).expect("setup: touch back");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

pub fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = match Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    if !core.wait_idle(Duration::from_secs(60)) {
        panic!("setup: indexing did not become idle within 60 s");
    }
    core
}

pub fn read(root: &Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}
pub fn text(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
pub fn fixture(rel: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/vaults/trash-media").join(rel)).expect("setup: fixture file")
}
pub fn sample(name: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/media").join(name)).expect("setup: sample file")
}
pub fn version(core: &Core, rel: &str) -> FileVersion {
    match core.vault().version(rel) {
        Ok(Some(v)) => v,
        other => panic!("setup: version of {rel}: {other:?}"),
    }
}
/// NFC paths whose entry differs (bytes, mtime or inode), appeared or disappeared.
pub fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
pub fn snap(root: &Path) -> BTreeMap<String, Entry> {
    snapshot(root).into_iter().map(|(k, v)| (nfc(&k), v)).collect()
}
pub fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
/// The entry of `rel` (file or directory) as (inode, mtime), for "the same file" checks across a rename.
pub fn ident(root: &Path, rel: &str) -> Option<(u64, i128)> {
    use std::os::unix::fs::MetadataExt;
    let md = std::fs::symlink_metadata(root.join(rel)).ok()?;
    Some((md.ino(), md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128))
}

/// A recording system trash (§1.1): moves each entry into `dir` (a counter on collision) and records its
/// vault-relative path; entries listed in `fail` are refused with an error and stay.
pub struct Sink {
    pub root: PathBuf,
    pub dir: PathBuf,
    pub got: Mutex<Vec<String>>,
    pub fail: Vec<String>,
}
impl Sink {
    pub fn new(sb: &Sandbox, root: &Path, fail: &[&str]) -> Sink {
        let dir = sb.base.join("system-trash");
        std::fs::create_dir_all(&dir).expect("setup: system trash dir");
        Sink { root: root.to_path_buf(), dir, got: Mutex::new(Vec::new()), fail: strs(fail) }
    }
    pub fn got(&self) -> Vec<String> {
        self.got.lock().map(|g| g.clone()).unwrap_or_default()
    }
}
impl SystemTrash for Sink {
    fn trash(&self, abs: &Path) -> std::io::Result<()> {
        let rel = nfc(&abs.strip_prefix(&self.root).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| abs.to_string_lossy().to_string()));
        if self.fail.iter().any(|f| *f == rel) {
            return Err(std::io::Error::other("test: can't move this one"));
        }
        let mut n = 0;
        let name = abs.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let mut to = self.dir.join(&name);
        while to.exists() {
            n += 1;
            to = self.dir.join(format!("{n} {name}"));
        }
        std::fs::rename(abs, &to)?;
        if let Ok(mut g) = self.got.lock() {
            g.push(rel);
        }
        Ok(())
    }
}
