//! Setup for the slice Q2 L4 tests (docs/acceptance/views.md; docs/contracts/v1-views.md §1): the views fixture in a
//! temporary directory (tests/fixtures/vaults/views + new-empty/.tegg), the Q2 test clock (`2026-11-19T10:00:00+01:00`,
//! Europe/Prague, region `cs`), the expected bytes of tests/fixtures/queries-files/expected/views/ and file probes. No AC
//! assertions here: a panic in this module is a setup failure, never a red test (tools/qa CONTRACT §5.2). It builds no
//! `QueryDef` (its shape changes in the build, contract §1.1), so it compiles before and after the build.
#![allow(dead_code)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{NaiveDate, Weekday};

use crate::common::{repo_root, Sandbox};
use tegg_core::queries_q::{QueryEnv, QueryResult, QuerySource};
use tegg_core::{Core, CoreOptions};

pub const NOW: &str = "2026-11-19T10:00:00+01:00";
pub const Q: &str = ".tegg/queries";
pub const BOOK: &str = ".tegg/types/book.yml";
pub const CTENI: &str = "Pages/Čtení 2026.md";
pub const ROZ: &str = "Rozečtené";
pub const P26: &str = "Přečtené 2026";
pub const VYB: &str = "Výborné knihy";
pub const ZANR: &str = "Podle žánru";
pub const AUTOR_Q: &str = "Podle autora";
pub const DATUM: &str = "Seskupeno podle data";

pub fn qpath(name: &str) -> String {
    format!("{Q}/{name}.yml")
}
pub fn b(title: &str) -> String {
    tegg_format::nfc(&format!("Books/{title}.md"))
}
pub fn bs(titles: &[&str]) -> Vec<String> {
    titles.iter().map(|t| b(t)).collect()
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
/// The views fixture in `<sandbox>/Knihovna` (without its README) with new-empty's `.tegg/` copied in.
pub fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Knihovna");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("views"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
pub fn open(root: &Path, dirs: &tegg_core::AppDirs, watch: bool) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(60));
    core
}
pub fn fixture(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/views").join(rel)).unwrap_or_else(|e| panic!("setup: fixture {rel}: {e}")))
        .expect("setup: UTF-8")
}
/// tests/fixtures/queries-files/expected/views/<rel>.
pub fn expected(rel: &str) -> String {
    let p = repo_root().join("tests/fixtures/queries-files/expected/views").join(rel);
    String::from_utf8(std::fs::read(&p).unwrap_or_else(|e| panic!("setup: {rel}: {e}"))).expect("setup: UTF-8")
}
pub fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("setup: create parent");
    }
    std::fs::write(&p, bytes).expect("setup: write");
}
pub fn disk_s(root: &Path, rel: &str) -> Option<String> {
    std::fs::read(root.join(rel)).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}
/// Bytes, mtime (ns) and inode.
pub fn stamp(root: &Path, rel: &str) -> Option<(Vec<u8>, i128, u64)> {
    let p = root.join(rel);
    let md = std::fs::metadata(&p).ok()?;
    let bytes = std::fs::read(&p).ok()?;
    Some((bytes, md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, md.ino()))
}
pub fn reread(core: &Core, paths: &[&str]) {
    core.notify_changed(&paths.iter().map(|p| p.to_string()).collect::<Vec<_>>());
    let _ = core.wait_idle(Duration::from_secs(30));
}
pub fn swapped(text: &str, from: &str, to: &str) -> String {
    if !text.contains(from) {
        panic!("setup: {from:?} not in the text");
    }
    text.replacen(from, to, 1)
}
/// The NFD spelling of the fixtures' Czech letters (the test crate has no Unicode tables).
pub fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'č' => ('c', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'), 'ř' => ('r', '\u{30C}'),
            'š' => ('s', '\u{30C}'), 'ž' => ('z', '\u{30C}'), 'ů' => ('u', '\u{30A}'), 'Č' => ('C', '\u{30C}'), 'Š' => ('S', '\u{30C}'),
            'Ž' => ('Z', '\u{30C}'), 'Ú' => ('U', '\u{301}'),
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

/// The Q2 test clock: Thursday 2026-11-19, Europe/Prague, `cs` (week Monday–Sunday).
pub fn env() -> QueryEnv {
    QueryEnv { today: NaiveDate::from_ymd_opt(2026, 11, 19).expect("date"), tz: "Europe/Prague".parse().expect("zone"), week_start: Weekday::Mon, locale: "cs".into() }
}
/// `(C)`: region `en-US` (week Sunday–Saturday).
pub fn env_us() -> QueryEnv {
    QueryEnv { today: NaiveDate::from_ymd_opt(2026, 11, 19).expect("date"), tz: "Europe/Prague".parse().expect("zone"), week_start: Weekday::Sun, locale: "en-US".into() }
}
pub fn run(core: &Core, name: &str, e: &QueryEnv) -> QueryResult {
    core.query_run(QuerySource::Saved(name.into()), None, e)
}
pub fn paths(r: &QueryResult) -> Vec<String> {
    r.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect()
}
/// The keys of a result's broken parts.
pub fn broken_keys(r: &QueryResult) -> Vec<String> {
    r.broken.iter().map(|b| b.key.clone()).collect()
}
