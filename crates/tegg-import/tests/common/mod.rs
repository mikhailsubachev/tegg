//! Setup helpers for the slice I1 AC tests (docs/contracts/v1-import.md §16.1). No AC assertions live here: a panic in
//! this file is a setup failure, never a red test (tools/qa CONTRACT §5.2). Helpers touch only temporary directories
//! and the committed synthetic fixtures (read-only, D-62). They are built on the contract's public surface only:
//! `tegg_import::{scan, plan, start}`, `ImportEnv` and `testing::env`. The `ok!` / `some!` macros turn an `Err` / `None`
//! of the API under test into an assertion **in the test file** that uses them (a stub's error is red for an
//! assertion, TS-I1).
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tegg_core::{Core, CoreOptions};
use tegg_import::{Control, Disk, ImportEnv, ImportPoint, ImportReport, Mapping, Plan, PlannedLink, PlannedObject, PointAction, ReportStrings, Scan, Target};
use tegg_jobs::testing::NodeTransformer;
use tegg_vault::AppDirs;

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

// ------------------------------------------------------------------------------------------------ fixtures

/// Every Capacities fixture `c01`…`c22` (tests/fixtures/import/capacities/README.md).
pub const FIXTURES: [&str; 22] = [
    "c01-spaces",
    "c02-typed-frontmatter",
    "c03-utc-midnight-dates",
    "c04-date-ranges",
    "c05-media-objects",
    "c06-weblinks",
    "c07-query-shells",
    "c08-tag-collections",
    "c09-unresolved-links",
    "c10-duplicate-titles",
    "c11-file-names",
    "c12-task-dates",
    "c13-daily-notes",
    "c14-reserved-keys",
    "c15-common-attributes",
    "c16-comma-people",
    "c17-invisible-chars",
    "c18-checklists",
    "c19-ai-chat",
    "c20-file-name-edges",
    "c21-value-variants",
    "c22-link-shapes",
];
pub const SPACE: &str = "PKM";
pub const VAULT_NAME: &str = "Capacities · PKM";
pub const NOW: &str = "2026-11-12T10:00:00+01:00";
pub const REPORT: &str = "Pages/Import report 2026-11-12 PKM.md";

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("setup: repo root")
}
pub fn fixtures() -> PathBuf {
    repo_root().join("tests/fixtures/import/capacities")
}
pub fn expected_dir(fixture: &str) -> PathBuf {
    repo_root().join("tests/fixtures/import/capacities-expected").join(fixture)
}
/// The id the injected source gives to the `n`-th object written (1-based).
pub fn id(n: usize) -> String {
    format!("01JB5V000000000000000000{n:02}")
}

pub struct Sandbox {
    pub tmp: tempfile::TempDir,
    pub base: PathBuf,
    pub dirs: AppDirs,
}
pub fn sandbox() -> Sandbox {
    let tmp = tempfile::tempdir().expect("setup: tempdir");
    let base = tmp.path().canonicalize().expect("setup: canonical tempdir");
    let app = base.join("Application Support").join("Tegg");
    std::fs::create_dir_all(&app).expect("setup: app support dir");
    std::fs::create_dir_all(base.join("Trezory")).expect("setup: vault place");
    Sandbox { tmp, base, dirs: AppDirs { root: app } }
}
impl Sandbox {
    /// The place new vaults are written to.
    pub fn place(&self) -> PathBuf {
        self.base.join("Trezory")
    }
    pub fn new_vault(&self) -> PathBuf {
        self.place().join(VAULT_NAME)
    }
    pub fn importing(&self) -> PathBuf {
        self.place().join(format!("{VAULT_NAME}.tegg-importing"))
    }
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
/// A temporary copy of a fixture export, in `<sandbox>/zdroj/<name>` (the folder keeps the fixture's name, §5.4).
pub fn source(sb: &Sandbox, fixture: &str) -> PathBuf {
    let to = sb.base.join("zdroj").join(fixture);
    copy_dir(&fixtures().join(fixture), &to, &[]);
    to
}
/// A temporary copy of `target-existing-vault` with `new-empty/.tegg/` copied in first (the fixture's README).
pub fn existing_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Můj trezor");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fixtures().join("target-existing-vault"), &root, &[]);
    root
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
/// Replaces `from` (which must be there, once) by `to` in a file of a temporary copy.
pub fn edit(root: &Path, rel: &str, from: &str, to: &str) {
    let t = read_text(root, rel).unwrap_or_else(|| panic!("setup: {rel} exists"));
    assert_setup(t.matches(from).count() == 1, &format!("{rel} contains {from:?} once"));
    write_raw(root, rel, t.replace(from, to).as_bytes());
}
pub fn append(root: &Path, rel: &str, text: &str) {
    let t = read_text(root, rel).unwrap_or_else(|| panic!("setup: {rel} exists"));
    write_raw(root, rel, format!("{t}{text}").as_bytes());
}
pub fn assert_setup(ok: bool, what: &str) {
    if !ok {
        panic!("setup: {what}");
    }
}

// ------------------------------------------------------------------------------------------------ snapshots

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub bytes: Vec<u8>,
    pub mtime_ns: i128,
    pub ino: u64,
}
/// Every file under `root` (dot-folders included): bytes, mtime and inode; directories listed with `/` and zeroes.
/// Keys are NFC. A missing root is an empty map.
pub fn snapshot(root: &Path) -> BTreeMap<String, Entry> {
    let mut out = BTreeMap::new();
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Entry>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = tegg_format::nfc(&p.strip_prefix(root).expect("setup: rel").to_string_lossy());
            let Ok(md) = std::fs::symlink_metadata(&p) else { continue };
            if md.is_dir() {
                out.insert(format!("{rel}/"), Entry { bytes: Vec::new(), mtime_ns: 0, ino: 0 });
                walk(root, &p, out);
            } else {
                let mtime_ns = md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128;
                out.insert(rel, Entry { bytes: std::fs::read(&p).unwrap_or_default(), mtime_ns, ino: md.ino() });
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
/// The pre-existing entries of `before` that are not untouched in `after` (bytes, mtime, inode), folders left out.
pub fn touched(before: &BTreeMap<String, Entry>, after: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    before.iter().filter(|(k, v)| !k.ends_with('/') && after.get(*k) != Some(v)).map(|(k, _)| k.clone()).collect()
}
/// The files (not folders) of `after` that `before` didn't have.
pub fn added(before: &BTreeMap<String, Entry>, after: &BTreeMap<String, Entry>) -> BTreeSet<String> {
    after.keys().filter(|k| !k.ends_with('/') && !before.contains_key(*k)).cloned().collect()
}
pub fn files(root: &Path) -> BTreeSet<String> {
    snapshot(root).into_keys().filter(|k| !k.ends_with('/')).collect()
}
pub fn temp_files(root: &Path) -> Vec<String> {
    snapshot(root).into_keys().filter(|k| k.contains(".tegg-tmp")).collect()
}
pub fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
pub fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
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
        std::thread::sleep(Duration::from_millis(10));
    }
}

// ------------------------------------------------------------------------------------------------ zips, built at test time

pub struct ZipEntry {
    pub name: Vec<u8>,
    pub data: Vec<u8>,
    /// General-purpose bit 11 ("names are UTF-8").
    pub utf8_flag: bool,
    /// General-purpose bit 0: the entry needs a password (the data is then 12 header bytes + the content, undecodable).
    pub encrypted: bool,
    pub deflate: bool,
}
impl ZipEntry {
    pub fn new(name: &str, data: &[u8]) -> ZipEntry {
        ZipEntry { name: name.as_bytes().to_vec(), data: data.to_vec(), utf8_flag: true, encrypted: false, deflate: true }
    }
}
/// A minimal zip writer (no zip64): full control over names (raw bytes), flags and methods, which the cases of
/// FR-IMP-07 AC-2, AC-8 and AC-9 need. Deflate through `flate2`.
pub fn write_zip(path: &Path, entries: &[ZipEntry]) {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for e in entries {
        let crc = crc32fast::hash(&e.data);
        let mut body = if e.deflate {
            let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            enc.write_all(&e.data).expect("setup: deflate");
            enc.finish().expect("setup: deflate")
        } else {
            e.data.clone()
        };
        if e.encrypted {
            let mut b = vec![0x5a; 12];
            b.append(&mut body);
            body = b;
        }
        let flags: u16 = (if e.utf8_flag { 1 << 11 } else { 0 }) | (e.encrypted as u16);
        let method: u16 = if e.deflate { 8 } else { 0 };
        let offset = out.len() as u32;
        let fields = |v: &mut Vec<u8>| {
            v.extend_from_slice(&20u16.to_le_bytes());
            v.extend_from_slice(&flags.to_le_bytes());
            v.extend_from_slice(&method.to_le_bytes());
            v.extend_from_slice(&0x5000u16.to_le_bytes()); // 10:00:00
            v.extend_from_slice(&0x5b6cu16.to_le_bytes()); // 2025-11-12
            v.extend_from_slice(&crc.to_le_bytes());
            v.extend_from_slice(&(body.len() as u32).to_le_bytes());
            v.extend_from_slice(&(e.data.len() as u32).to_le_bytes());
            v.extend_from_slice(&(e.name.len() as u16).to_le_bytes());
            v.extend_from_slice(&0u16.to_le_bytes());
        };
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        fields(&mut out);
        out.extend_from_slice(&e.name);
        out.extend_from_slice(&body);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&0x031eu16.to_le_bytes());
        fields(&mut central);
        central.extend_from_slice(&[0u8; 10]); // comment len, disk, internal attrs, external attrs (2+2+2+4)
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(&e.name);
    }
    let start = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).expect("setup: zip folder");
    }
    std::fs::write(path, out).expect("setup: write zip");
}
/// The entries of a zip written by Tegg (central directory; stored or deflate): name → bytes. Empty when unreadable.
pub fn read_zip(path: &Path) -> BTreeMap<String, Vec<u8>> {
    use std::io::Read;
    let mut out = BTreeMap::new();
    let Ok(raw) = std::fs::read(path) else { return out };
    let u16_at = |i: usize| raw.get(i..i + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let u32_at = |i: usize| raw.get(i..i + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let Some(eocd) = (0..raw.len().saturating_sub(21)).rev().find(|i| raw[*i..].starts_with(b"PK\x05\x06")) else { return out };
    let (Some(count), Some(mut at)) = (u16_at(eocd + 10), u32_at(eocd + 16)) else { return out };
    for _ in 0..count {
        let (Some(method), Some(csize), Some(nlen), Some(elen), Some(clen), Some(local)) = (u16_at(at + 10), u32_at(at + 20), u16_at(at + 28), u16_at(at + 30), u16_at(at + 32), u32_at(at + 42)) else { break };
        let Some(name) = raw.get(at + 46..at + 46 + nlen) else { break };
        let (Some(lnlen), Some(lelen)) = (u16_at(local + 26), u16_at(local + 28)) else { break };
        let start = local + 30 + lnlen + lelen;
        let Some(data) = raw.get(start..start + csize) else { break };
        let mut bytes = Vec::new();
        if method == 8 {
            let _ = flate2::read::DeflateDecoder::new(data).read_to_end(&mut bytes);
        } else {
            bytes = data.to_vec();
        }
        out.insert(String::from_utf8_lossy(name).into_owned(), bytes);
        at += 46 + nlen + elen + clen;
    }
    out
}
/// The files of a folder as zip entries, names relative to `dir` with `/`, NFC, in path order.
pub fn entries_of(dir: &Path, prefix: &str) -> Vec<ZipEntry> {
    snapshot(dir).into_iter().filter(|(k, _)| !k.ends_with('/')).map(|(k, v)| ZipEntry::new(&format!("{prefix}{k}"), &v.bytes)).collect()
}
/// `<folder name>.zip` of an export folder, in `<sandbox>/zipy/` (§5.4: the zip is named after the fixture folder).
pub fn zip_dir(sb: &Sandbox, dir: &Path) -> PathBuf {
    let name = dir.file_name().expect("setup: folder name").to_string_lossy().into_owned();
    let path = sb.base.join("zipy").join(format!("{name}.zip"));
    write_zip(&path, &entries_of(dir, ""));
    path
}
pub fn zip_fixture(sb: &Sandbox, fixture: &str) -> PathBuf {
    zip_dir(sb, &fixtures().join(fixture))
}

/// A generated export folder of about `bytes` bytes, deterministic for `seed`: space `PKM` with `notes` Pages (titles
/// from a pool with Czech diacritics, emoji, forbidden characters and duplicates; wikilinks and path links between
/// them, some unresolved) and media files that fill the size. Returns the folder.
pub fn generated_export(sb: &Sandbox, name: &str, notes: usize, bytes: u64, seed: u64) -> PathBuf {
    let root = sb.base.join("generováno").join(name);
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    const POOL: [&str; 12] = ["Žluťoučký kůň", "Plán 2026", "Tomáš : Eva", "Úkol č. 1", "Řeka 🌊", "CON", "Otázka?", "Šťáva/džus", "Článek", "Článek", "nul", "Dlouhý název s háčky a čárkami"];
    let title = |i: usize, r: u64| if r % 4 == 0 { POOL[(r / 4) as usize % POOL.len()].to_string() } else { format!("{} {i}", POOL[(r / 4) as usize % POOL.len()]) };
    let titles: Vec<String> = (0..notes).map(|i| title(i, next())).collect();
    for (i, t) in titles.iter().enumerate() {
        let mut body = String::new();
        for _ in 0..(next() % 4) {
            let j = (next() as usize) % notes;
            match next() % 5 {
                0 => body += &format!("Viz [[{}]].\n\n", titles[j]),
                1 => body += &format!("Také [odkaz](../Pages/N{j:05}.md) a `[[v kódu]]`.\n\n"),
                2 => body += "Chybí [[Neexistuje nikde]].\n\n",
                3 => body += "Web [příklad](https://example.com/a).\n\n",
                _ => body += "Žluťoučký kůň úpěl ďábelské ódy.\u{200b}\n\n",
            }
        }
        let quoted = t.replace('\'', "''");
        write_raw(&root, &format!("PKM/Pages/N{i:05}.md"), format!("---\ntype: 'Page'\ntitle: '{quoted}'\ntags: []\n---\n\n{body}").as_bytes());
    }
    let mut left = bytes;
    let mut k = 0usize;
    while left > 0 {
        let n = left.min(4 * 1024 * 1024) as usize;
        let mut data = vec![0u8; n];
        for (i, b) in data.iter_mut().enumerate().step_by(509) {
            *b = (next() as u8) ^ (i as u8);
        }
        write_raw(&root, &format!("PKM/Images/Media/soubor {k:04}.bin"), &data);
        left -= n as u64;
        k += 1;
    }
    root
}

// ------------------------------------------------------------------------------------------------ environment

/// One `NodeTransformer` per test binary (as `tegg-jobs/tests/common`): the real `@tegg/doc`, built by
/// `npm run build --prefix packages/doc`.
pub fn transformer() -> Result<Arc<NodeTransformer>, String> {
    static T: OnceLock<Result<Arc<NodeTransformer>, String>> = OnceLock::new();
    T.get_or_init(|| NodeTransformer::from_repo(&repo_root()).map(Arc::new).map_err(|e| format!("NodeTransformer (npm run build --prefix packages/doc): {e}"))).clone()
}
/// `testing::env`: the test clock, Europe/Prague, ids `01JB5V…nn` from `01`, English strings, no hook; with a trash
/// sink of the sandbox (`<sandbox>/Koš`) and free space far above any fixture.
pub fn env(sb: &Sandbox) -> Result<ImportEnv, String> {
    let t: Arc<dyn tegg_jobs::Transformer> = transformer()?;
    let mut e = tegg_import::testing::env(&sb.dirs, t);
    e.trash = Arc::new(Trash { dir: sb.base.join("Koš") });
    Ok(e)
}
pub fn env_in(sb: &Sandbox, zone: chrono_tz::Tz) -> Result<ImportEnv, String> {
    let mut e = env(sb)?;
    e.zone = zone;
    Ok(e)
}
/// The three zones of the criteria marked (Z).
pub const ZONES: [chrono_tz::Tz; 3] = [chrono_tz::Europe::Prague, chrono_tz::America::New_York, chrono_tz::Pacific::Kiritimati];

/// A `SystemTrash` that moves into a folder of the sandbox (the seam of ms6-trash-media §1.1, public in `tegg-vault`).
pub struct Trash {
    pub dir: PathBuf,
}
impl tegg_vault::SystemTrash for Trash {
    fn trash(&self, abs: &Path) -> io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let name = abs.file_name().ok_or_else(|| io::Error::other("no name"))?;
        std::fs::rename(abs, self.dir.join(name))
    }
}
/// A `SystemTrash` that answers an error and moves nothing (D-1559).
pub struct NoTrash;
impl tegg_vault::SystemTrash for NoTrash {
    fn trash(&self, _: &Path) -> io::Result<()> {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "the Trash is not available"))
    }
}
/// Injected free space (FR-IMP-07 AC-12): `free` for a path under `other.0` is `other.1` on volume 2, else `free` on volume 1.
pub struct FixedDisk {
    pub free: u64,
    pub other: Option<(PathBuf, u64)>,
}
impl Disk for FixedDisk {
    fn free(&self, path: &Path) -> io::Result<u64> {
        Ok(match &self.other {
            Some((dir, free)) if path.starts_with(dir) => *free,
            _ => self.free,
        })
    }
    fn volume(&self, path: &Path) -> io::Result<u64> {
        Ok(match &self.other {
            Some((dir, _)) if path.starts_with(dir) => 2,
            _ => 1,
        })
    }
}
/// Catalog keys as the report's words: `⟦key⟧` (NFR-OTH-02 AC-18's pseudo-locale), under both spellings of the key
/// (with and without the `import.report.` prefix; the contract's §2 and §5.3 don't say which the map uses).
pub fn key_strings() -> ReportStrings {
    const KEYS: &[&str] = &[
        "section.summary", "section.types", "section.unresolved", "section.ambiguous", "section.caseLinks", "section.simplified", "section.attributes",
        "section.merged", "section.dates", "section.files", "section.stubs", "section.skipped", "section.cleanup", "section.notExported",
        "summary.source", "summary.space", "summary.date", "summary.objects", "summary.attachments", "summary.links", "summary.imported", "summary.reported",
        "summary.total", "noUndo", "reason.notInExport", "reason.otherSpace", "reason.targetNotImported", "reason.missingFile", "reason.inSkippedNote",
        "word.new", "word.confirmed", "word.leftUnresolved", "word.notImported", "attr.renamed", "attr.dropped", "attr.new", "attr.notCreated",
        "attr.selectValues", "attr.valueNotInOptions", "attr.splitUnmatched", "attr.asStored", "key.reserved", "key.invalidKey", "key.keyTaken",
        "key.rangeClash", "date.unreadable", "date.importTime", "file.droppedReference", "file.unreferenced", "file.genericName", "name.reserved",
        "name.empty", "name.cut", "name.suffix", "name.characters", "skip.yaml", "skip.noType", "skip.notUtf8", "skip.read", "skip.encrypted", "skip.engine",
        "skip.badName", "skip.traversal", "skip.tagCollection", "skip.csv", "skip.dotfile", "skip.outsideSpace", "skip.unreadableEntry", "skip.type",
        "cleanup.crlf", "notExported.queries", "notExported.tags", "notExported.comments", "type.noDay",
    ];
    let mut m = BTreeMap::new();
    for k in KEYS {
        let text = if *k == "reason.otherSpace" { "⟦reason.otherSpace {space}⟧".to_string() } else { format!("⟦{k}⟧") };
        m.insert(k.to_string(), text.clone());
        m.insert(format!("import.report.{k}"), text);
    }
    ReportStrings(m)
}

// ------------------------------------------------------------------------------------------------ hooks (§2.1)

/// Records every point of a run, in order.
#[derive(Clone, Default)]
pub struct Points(pub Arc<Mutex<Vec<ImportPoint>>>);
impl Points {
    pub fn seen(&self) -> Vec<ImportPoint> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}
/// A hook that records every point and calls `at` with the point's index (0-based) and the point.
pub fn hook(points: &Points, at: impl Fn(usize, &ImportPoint) -> PointAction + Send + Sync + 'static) -> tegg_import::PointHook {
    let p = points.clone();
    Arc::new(move |pt: &ImportPoint| {
        let i = {
            let mut v = p.0.lock().unwrap_or_else(|e| e.into_inner());
            v.push(pt.clone());
            v.len() - 1
        };
        at(i, pt)
    })
}
/// The points of one run with no failure: the list a kill loop walks. `Err` when the recording run didn't finish.
pub fn record_points(run: impl FnOnce(ImportEnv) -> Result<Imported, String>, mut env: ImportEnv) -> Result<Vec<ImportPoint>, String> {
    let points = Points::default();
    env.points = Some(hook(&points, |_, _| PointAction::Continue));
    run(env)?;
    Ok(points.seen())
}
/// A hook that "kills" at the `n`-th point: it sets `fired` and panics (the engine runs no roll-back and no clean-up
/// when the hook panics, §2.1).
pub fn kill_at(n: usize, fired: &Arc<AtomicBool>) -> tegg_import::PointHook {
    let count = Arc::new(AtomicUsize::new(0));
    let fired = fired.clone();
    Arc::new(move |_pt: &ImportPoint| {
        if count.fetch_add(1, Ordering::SeqCst) == n {
            fired.store(true, Ordering::SeqCst);
            panic!("kill point {n} (test harness: this panic is the kill)");
        }
        PointAction::Continue
    })
}
/// Is this point one of the three file points (`BeforeTemp`, `TempWritten`, `Renamed`)?
pub fn file_point(p: &ImportPoint) -> Option<(&str, tegg_import::FileKind)> {
    match p {
        ImportPoint::BeforeTemp { path, kind } | ImportPoint::TempWritten { path, kind } | ImportPoint::Renamed { path, kind } => Some((path.as_str(), *kind)),
        _ => None,
    }
}

// ------------------------------------------------------------------------------------------------ the pipeline

pub struct Imported {
    pub scan: Scan,
    pub plan: Plan,
    pub report: ImportReport,
    /// The written vault's folder (a new vault's final folder as the report names it, or the existing vault).
    pub root: PathBuf,
}
pub fn scan_of(path: &Path, env: &ImportEnv) -> Result<Scan, String> {
    tegg_import::scan(path, env, &Control::default()).map_err(|e| format!("scan({}): {e:?}", path.display()))
}
pub fn new_target(sb: &Sandbox) -> Target<'static> {
    Target::NewVault { parent: sb.place(), name: VAULT_NAME.to_string() }
}
pub fn plan_of(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv) -> Result<Plan, String> {
    tegg_import::plan(scan, space, target, mapping, env, &Control::default()).map_err(|e| format!("plan({space}): {e:?}"))
}
/// `start` and wait for the final report (120 s). A report whose phase isn't `Done` is still `Ok`: the test asserts it.
pub fn run_plan(plan: Plan, scan: &Scan, target: &Target<'_>, env: &ImportEnv) -> Result<ImportReport, String> {
    let run = tegg_import::start(plan, scan, target, env).map_err(|e| format!("start: {e:?}"))?;
    run.wait(Duration::from_secs(120)).ok_or_else(|| "no final report within 120 s".to_string())
}
/// Scan, plan and write `src` (a folder or a zip) into a new vault `<sandbox>/Trezory/Capacities · PKM`.
pub fn import_new(sb: &Sandbox, src: &Path, space: &str, mapping: &Mapping, env: &ImportEnv) -> Result<Imported, String> {
    let scan = scan_of(src, env)?;
    let target = new_target(sb);
    let plan = plan_of(&scan, space, &target, mapping, env)?;
    let report = run_plan(plan.clone(), &scan, &target, env)?;
    if report.phase != tegg_jobs::Phase::Done {
        return Err(format!("the import ended {:?}: {:?}", report.phase, report.error));
    }
    let root = report.vault.clone().ok_or_else(|| "a finished new-vault import names its folder".to_string())?;
    Ok(Imported { scan, plan, report, root })
}
/// Scan, plan and write into an open vault.
pub fn import_into(core: &Core, root: &Path, src: &Path, space: &str, mapping: &Mapping, env: &ImportEnv) -> Result<Imported, String> {
    let scan = scan_of(src, env)?;
    let target = Target::Existing(core);
    let plan = plan_of(&scan, space, &target, mapping, env)?;
    let report = run_plan(plan.clone(), &scan, &target, env)?;
    if report.phase != tegg_jobs::Phase::Done {
        return Err(format!("the import ended {:?}: {:?}", report.phase, report.error));
    }
    let _ = core.wait_idle(Duration::from_secs(60));
    Ok(Imported { scan, plan, report, root: root.to_path_buf() })
}
/// A fixture's space `PKM` into a new vault with the default mapping.
pub fn import_fixture(sb: &Sandbox, fixture: &str) -> Result<Imported, String> {
    import_new(sb, &fixtures().join(fixture), SPACE, &Mapping::default(), &env(sb)?)
}
/// Opens a vault (no watcher), waits for the index and installs the real transformer.
pub fn open_core(root: &Path, dirs: &AppDirs) -> Result<Core, String> {
    let core = Core::open(root, dirs, CoreOptions { watch: false, sync: None }).map_err(|e| format!("Core::open: {e:?}"))?;
    if !core.wait_idle(Duration::from_secs(120)) {
        return Err("indexing did not become idle within 120 s".into());
    }
    core.jobs().set_transformer(transformer()?);
    Ok(core)
}
/// A second Application Support stand-in in the same sandbox (a machine without an index).
pub fn fresh_dirs(sb: &Sandbox, name: &str) -> AppDirs {
    let app = sb.base.join(name).join("Tegg");
    std::fs::create_dir_all(&app).expect("setup: app support dir");
    AppDirs { root: app }
}
/// The import backups under `<Application Support>/Tegg/backups/` (ms4-jobs §6): absolute paths of `*-import.zip`, sorted.
pub fn import_backups(dirs: &AppDirs) -> Vec<PathBuf> {
    let root = dirs.root.join("backups");
    let mut v: Vec<PathBuf> = snapshot(&root).into_keys().filter(|k| k.ends_with("-import.zip")).map(|k| root.join(k)).collect();
    v.sort();
    v
}
/// A mapping from its JSON form (§4). `Err` when it doesn't deserialize.
pub fn mapping(json: &str) -> Result<Mapping, String> {
    serde_json::from_str(json).map_err(|e| format!("the mapping JSON: {e}"))
}

// ------------------------------------------------------------------------------------------------ reading plans and written files

pub fn object<'a>(plan: &'a Plan, source: &str) -> Option<&'a PlannedObject> {
    plan.objects.iter().find(|o| o.source == source)
}
pub fn path_of(plan: &Plan, source: &str) -> Option<String> {
    object(plan, source).and_then(|o| o.path.clone())
}
pub fn links_of<'a>(plan: &'a Plan, note: &str) -> Vec<&'a PlannedLink> {
    plan.links.iter().filter(|l| l.note == note).collect()
}
/// The link of `note` whose source text is `written` (the first).
pub fn link<'a>(plan: &'a Plan, note: &str, written: &str) -> Option<&'a PlannedLink> {
    plan.links.iter().find(|l| l.note == note && l.written == written)
}
/// The frontmatter block's top-level lines as (key, value text), in order. Empty when the text has no frontmatter.
pub fn fm(text: &str) -> Vec<(String, String)> {
    let Some(rest) = text.strip_prefix("---\n") else { return Vec::new() };
    let Some(end) = rest.find("\n---\n").or_else(|| rest.strip_suffix("\n---").map(|r| r.len())) else { return Vec::new() };
    rest[..end]
        .lines()
        .filter(|l| !l.starts_with(' ') && !l.starts_with('#') && !l.starts_with('-'))
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_string(), v.trim().to_string())))
        .collect()
}
pub fn fm_keys(text: &str) -> Vec<String> {
    fm(text).into_iter().map(|(k, _)| k).collect()
}
/// The value text of a top-level frontmatter key, as written (quotes included).
pub fn fm_get(text: &str, key: &str) -> Option<String> {
    fm(text).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
}
/// The text after the frontmatter's closing line.
pub fn body(text: &str) -> String {
    match text.strip_prefix("---\n").and_then(|r| r.find("\n---\n").map(|i| r[i + 5..].to_string())) {
        Some(b) => b,
        None => text.to_string(),
    }
}
/// The `## ` headings of a report Page, in order.
pub fn sections(report: &str) -> Vec<String> {
    report.lines().filter_map(|l| l.strip_prefix("## ").map(str::to_string)).collect()
}
/// The rows (`- …` lines, without the marker) of the section headed `## <name>`.
pub fn rows(report: &str, name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    for l in report.lines() {
        if let Some(h) = l.strip_prefix("## ") {
            inside = h == name;
        } else if inside {
            if let Some(r) = l.strip_prefix("- ") {
                out.push(r.to_string());
            }
        }
    }
    out
}
/// (key, type) of every attribute of a type file's text, in order; and the option labels of attribute `key`.
pub fn type_attrs(yml: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for l in yml.lines() {
        if let Some(k) = l.strip_prefix("  - key: ") {
            out.push((k.trim().to_string(), String::new()));
        } else if let (Some(t), Some(last)) = (l.strip_prefix("    type: "), out.last_mut()) {
            last.1 = t.trim().to_string();
        }
    }
    out
}
pub fn type_options(yml: &str, key: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    for l in yml.lines() {
        if let Some(k) = l.strip_prefix("  - key: ") {
            inside = k.trim() == key;
        } else if inside {
            if let Some(i) = l.find("label: ") {
                let rest = &l[i + 7..];
                out.push(rest.split([',', '}']).next().unwrap_or("").trim().trim_matches('"').to_string());
            }
        }
    }
    out
}
/// Does `[[target]]` (a link text as written, without brackets) resolve from `from` to `to` in the vault's index?
pub fn resolves(core: &Core, from: &str, target: &str) -> Option<String> {
    core.resolve_links(from, &[target.to_string()]).first().and_then(|l| l.path.clone()).map(|p| tegg_format::nfc(&p))
}
/// The targets of every `[[…]]` in a text (alias and subpath cut), outside nothing: a plain scan for test checks.
pub fn wikilink_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("[[") {
        let after = &rest[i + 2..];
        let Some(j) = after.find("]]") else { break };
        let inner = &after[..j];
        out.push(inner.split(['|', '#']).next().unwrap_or("").trim_end_matches('\\').to_string());
        rest = &after[j + 2..];
    }
    out
}
