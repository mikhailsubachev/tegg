//! Setup for the slice PIN L4 tests (docs/contracts/v1-pinned.md §1): the pinned fixture in a temporary directory
//! (tests/fixtures/vaults/pinned + new-empty/.tegg, Čajovna renamed to its NFD name as the fixture README says) with one
//! of tests/fixtures/pinned-files/ as `.tegg/pinned.yml` (or none), the expected bytes, ops and file probes. No AC
//! assertions here: a panic in this module is a setup failure, never a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::common::{repo_root, Sandbox};
use tegg_core::pinned::{PinOp, PinRequest};
use tegg_core::{AppDirs, Core, CoreOptions};

pub const YML: &str = ".tegg/pinned.yml";
pub const COPY_A: &str = ".tegg/pinned (conflicted copy 2026-11-07).yml";
pub const COPY_B: &str = ".tegg/pinned 2.yml";
pub const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
pub const LISABON: &str = "Projekty/Výjezd Lisabon 2026.md";
pub const PORADA: &str = "Schůzky/2026-10-07 Týdenní porada.md";
pub const CAJOVNA: &str = "Pages/Čajovna.md";
pub const UKOL: &str = "Tasks/Poslat návrh rozpočtu.md";
pub const ODKAZY: &str = "Pages/Odkazy.md";
pub const PLAN: &str = "Pages/Plán.md";
pub const PLAN2: &str = "Pages/Plán (2).md";
pub const BEZ: &str = "Pages/Bez hlavičky.md";
pub const KOS: &str = ".trash/Pages/Starý plán.md";
pub const STITEK: &str = "Tags/Offsite.md";

pub fn id(nn: &str) -> String {
    format!("01JB5P000000000000000000{nn}")
}
pub fn fx_dir() -> PathBuf {
    repo_root().join("tests/fixtures/pinned-files")
}
pub fn fx(name: &str) -> Vec<u8> {
    std::fs::read(fx_dir().join(name)).unwrap_or_else(|e| panic!("setup: fixture {name}: {e}"))
}
pub fn fxs(name: &str) -> String {
    String::from_utf8(fx(name)).expect("setup: fixture is UTF-8")
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
/// The NFD spelling of the fixtures' Czech letters (the test crate has no Unicode tables).
pub fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'č' => ('c', '\u{30C}'), 'ď' => ('d', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'),
            'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'), 'ť' => ('t', '\u{30C}'), 'ž' => ('z', '\u{30C}'), 'ů' => ('u', '\u{30A}'),
            'Č' => ('C', '\u{30C}'), 'Š' => ('S', '\u{30C}'), 'Ž' => ('Z', '\u{30C}'), 'Ř' => ('R', '\u{30C}'), 'Ú' => ('U', '\u{301}'),
            other => {
                out.push(other);
                continue;
            }
        };
        out.push(base);
        out.push(mark);
    }
    out
}
/// The pinned fixture in `<sandbox>/<name>` with `bytes` as `.tegg/pinned.yml` (None: no file).
pub fn vault_named(sb: &Sandbox, name: &str, bytes: Option<&[u8]>) -> PathBuf {
    let root = sb.base.join(name);
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("pinned"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::rename(root.join(CAJOVNA), root.join(nfd(CAJOVNA))).expect("setup: NFD name of Čajovna");
    if let Some(b) = bytes {
        std::fs::write(root.join(YML), b).expect("setup: write pinned.yml");
    }
    root
}
pub fn vault_with(sb: &Sandbox, bytes: Option<&[u8]>) -> PathBuf {
    vault_named(sb, "Pinned", bytes)
}
pub fn vault_fx(sb: &Sandbox, name: &str) -> PathBuf {
    vault_with(sb, Some(&fx(name)))
}
pub fn open(root: &Path, dirs: &AppDirs) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(60));
    core
}
pub fn disk(root: &Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}
pub fn disk_s(root: &Path, rel: &str) -> Option<String> {
    disk(root, rel).map(|b| String::from_utf8_lossy(&b).into_owned())
}
pub fn stamp(root: &Path, rel: &str) -> Option<(Vec<u8>, i128, u64)> {
    let p = root.join(rel);
    let md = std::fs::metadata(&p).ok()?;
    let bytes = std::fs::read(&p).ok()?;
    Some((bytes, md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, md.ino()))
}
pub fn ino(root: &Path, rel: &str) -> Option<u64> {
    std::fs::metadata(root.join(rel)).ok().map(|m| m.ino())
}
pub fn replace_atomically(root: &Path, rel: &str, bytes: &[u8]) {
    let tmp = root.parent().expect("setup: vault parent").join(format!("ext-{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes).expect("setup: write temp");
    std::fs::rename(&tmp, root.join(rel)).expect("setup: rename over");
}
pub fn reread(core: &Core, paths: &[&str]) {
    core.notify_changed(&paths.iter().map(|p| p.to_string()).collect::<Vec<_>>());
    let _ = core.wait_idle(Duration::from_secs(30));
}
pub fn crlf(text: &str) -> String {
    text.replace('\n', "\r\n")
}
/// `text` without the lines `from..=to` (1-based, LF).
pub fn lines_cut(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').enumerate().filter(|(i, _)| *i + 1 < from || *i + 1 > to).map(|(_, l)| l).collect()
}

pub fn pin_obj(path: &str, at: Option<usize>) -> PinOp {
    PinOp::Pin { target: PinRequest::Object { path: path.to_string() }, at }
}
pub fn pin_tag(key: &str, at: Option<usize>) -> PinOp {
    PinOp::Pin { target: PinRequest::Tag { key: key.to_string() }, at }
}
pub fn pin_type(key: &str, at: Option<usize>) -> PinOp {
    PinOp::Pin { target: PinRequest::Type { key: key.to_string() }, at }
}
pub fn unpin(index: usize) -> PinOp {
    PinOp::Unpin { index }
}
pub fn mv(from: usize, to: usize) -> PinOp {
    PinOp::Move { from, to }
}
