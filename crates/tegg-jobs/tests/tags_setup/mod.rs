//! Setup for the MS4 slice 4D-lite L4 job tests (docs/acceptance/tags.md; docs/contracts/ms4-tags.md §4, §5): the tags
//! fixture in a temporary directory, the confirm step of the tag jobs, the backup folder and a stored-zip reader
//! (the backups are stored entries, ms4-jobs §6), and a file system that notes whether a zip existed at the first vault
//! write. No AC assertions here: a panic in this file is a setup failure (tools/qa CONTRACT §5.2); results go back to
//! the test files as `Result`s for them to assert on.
#![allow(dead_code)]

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::common::{copy_dir, repo_root, Sandbox};
use tegg_core::Core;
use tegg_jobs::{JobId, JobOp, JobReport};
use tegg_vault::{AppDirs, FileVersion, FsEntry, LocalFs, VaultFs};

pub const NOW_PREFIX: &str = "2026-10-";
pub const ROZPOCET: &str = "Pages/Rozpočet.md";
pub const NAJEM: &str = "Tasks/Zaplatit nájem.md";
pub const BANKA: &str = "Tasks/Zavolat bance.md";
pub const FAKTURA: &str = "Quick Notes/Faktura.md";
pub const DEN: &str = "Daily/2026-10-20.md";
pub const DVAKRAT: &str = "Pages/Dvakrát.md";
pub const KOD: &str = "Pages/Kód.md";
pub const WEB: &str = "Projekty/Web.md";
pub const LOMITKO: &str = "Pages/Lomítko.md";
pub const KNIHA: &str = "Pages/Kniha.md";
pub const ODKAZ: &str = "Pages/Odkaz na štítek.md";
pub const SCHUZKA: &str = "Pages/Schůzka.md";
pub const SCHUZKA2: &str = "Pages/schůzka (2).md";
pub const NA_SCHUZKU: &str = "Pages/Odkaz na schůzku.md";
pub const SABLONA: &str = "_templates/Page/Page.md";
pub const KOS: &str = ".trash/Pages/Starý.md";
pub const F_UCTY: &str = "Tags/Účty.md";
pub const F_AB: &str = "Tags/a b.md";
pub const F_DVOJI: &str = "Tags/dvojí.md";
pub const F_DVOJI2: &str = "Tags/Dvojí (2).md";
pub const F_NEZNAMA: &str = "Tags/neznámá.md";

pub fn vypln(n: u32) -> String {
    format!("Pages/Výplň {n:02}.md")
}
/// `s` with `ú`, `č`, `Ú`, `Č` decomposed (the fixture's NFD bytes).
pub fn nfd(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'ú' => vec!['u', '\u{301}'],
            'č' => vec!['c', '\u{30C}'],
            'Ú' => vec!['U', '\u{301}'],
            'Č' => vec!['C', '\u{30C}'],
            c => vec![c],
        })
        .collect()
}

/// tests/fixtures/vaults/tags (without README.md) plus new-empty/.tegg in `<sandbox>/Štítky`.
pub fn tags_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Štítky");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("tags"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
pub fn tx(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/tags").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
/// The fixture text of `rel` with each pair swapped once (each `from` must be in the text).
pub fn tx_swap(rel: &str, pairs: &[(&str, &str)]) -> String {
    let mut t = tx(rel);
    for (a, b) in pairs {
        if !t.contains(a) {
            panic!("setup: {a:?} not in {rel}");
        }
        t = t.replacen(a, b, 1);
    }
    t
}

/// Starts `op`, confirms it once it waits in `confirm` (the dialog's button, ms4-tags §4.4), waits for the report.
pub fn run_confirmed(core: &Core, op: JobOp) -> Result<(JobId, JobReport), String> {
    let job = core.jobs().start(op.clone()).map_err(|e| format!("Jobs::start({op:?}): {e:?}"))?;
    confirm_when_asked(core, job)?;
    let report = core.jobs().wait(job, Duration::from_secs(60)).ok_or_else(|| format!("no report for job {job} within 60 s"))?;
    Ok((job, report))
}
/// Confirms `job` as soon as it is in `confirm` (≤ 30 s), unless it ended first.
pub fn confirm_when_asked(core: &Core, job: JobId) -> Result<(), String> {
    let end = Instant::now() + Duration::from_secs(30);
    loop {
        if core.jobs().confirm(job).is_ok() {
            return Ok(());
        }
        if core.jobs().report(job).is_some() {
            return Ok(());
        }
        if Instant::now() > end {
            return Err(format!("job {job} never asked for confirmation"));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

// ------------------------------------------------------------------------------------------------ backups

/// Every zip under `<Application Support>/backups/` (any vault folder), sorted.
pub fn zips(dirs: &AppDirs) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(d: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "zip") {
                out.push(p);
            }
        }
    }
    walk(&dirs.root.join("backups"), &mut out);
    out.sort();
    out
}
pub fn zip_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// The entries of a stored zip, in file order, by its local headers (names UTF-8). Empty when unreadable.
pub fn zip_entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let b = std::fs::read(path).unwrap_or_default();
    let u16_at = |i: usize| b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]) as usize).unwrap_or(0);
    let u32_at = |i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize).unwrap_or(0);
    let mut out = Vec::new();
    let mut at = 0usize;
    while b.get(at..at + 4) == Some(&[0x50, 0x4b, 0x03, 0x04]) {
        let (size, n, x) = (u32_at(at + 18), u16_at(at + 26), u16_at(at + 28));
        let name = String::from_utf8_lossy(b.get(at + 30..at + 30 + n).unwrap_or_default()).into_owned();
        let data = at + 30 + n + x;
        out.push((name, b.get(data..data + size).unwrap_or_default().to_vec()));
        at = data + size;
    }
    out
}
/// The `tegg-backup.json` manifest if it is the zip's first entry (ms4-tags §5.1).
pub fn manifest(path: &Path) -> Option<serde_json::Value> {
    let e = zip_entries(path);
    let (name, bytes) = e.first()?;
    if name != "tegg-backup.json" {
        return None;
    }
    serde_json::from_slice(bytes).ok()
}
pub fn sha256_hex(bytes: &[u8]) -> String {
    // A small SHA-256 (FIPS 180-4) so the tests need no extra crate.
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut m = bytes.to_vec();
    let bits = (bytes.len() as u64).wrapping_mul(8);
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&bits.to_be_bytes());
    for chunk in m.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// Makes `backups/` and every vault folder already in it (`backups/<vault>/`) read-only (AP-616, D-687):
/// a folder a job already created stays writable under Unix permissions if only its parent is read-only.
pub fn read_only_backups(dirs: &AppDirs) {
    use std::os::unix::fs::PermissionsExt;
    let b = dirs.root.join("backups");
    std::fs::create_dir_all(&b).expect("setup: backups dir");
    for d in backup_subdirs(&b) {
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o555)).expect("setup: read-only vault backups");
    }
    std::fs::set_permissions(&b, std::fs::Permissions::from_mode(0o555)).expect("setup: read-only backups");
}
pub fn writable_again(dirs: &AppDirs) {
    use std::os::unix::fs::PermissionsExt;
    let b = dirs.root.join("backups");
    let _ = std::fs::set_permissions(&b, std::fs::Permissions::from_mode(0o755));
    for d in backup_subdirs(&b) {
        let _ = std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755));
    }
}
fn backup_subdirs(b: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(b)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}

/// LocalFs that notes, at the first vault write, whether a zip already existed in the backups folder.
pub struct FirstWriteFs {
    pub inner: LocalFs,
    pub backups: PathBuf,
    pub first: Mutex<Option<bool>>,
}
impl FirstWriteFs {
    pub fn new(root: &Path, dirs: &AppDirs) -> Arc<FirstWriteFs> {
        Arc::new(FirstWriteFs { inner: LocalFs::new(root), backups: dirs.root.join("backups"), first: Mutex::new(None) })
    }
    fn mark(&self) {
        let mut f = self.first.lock().unwrap_or_else(|p| p.into_inner());
        if f.is_none() {
            let mut any = false;
            fn walk(d: &Path, any: &mut bool) {
                let Ok(rd) = std::fs::read_dir(d) else { return };
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        walk(&p, any);
                    } else if p.extension().is_some_and(|x| x == "zip") {
                        *any = true;
                    }
                }
            }
            walk(&self.backups, &mut any);
            *f = Some(any);
        }
    }
    pub fn zip_before_first_write(&self) -> Option<bool> {
        *self.first.lock().unwrap_or_else(|p| p.into_inner())
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
