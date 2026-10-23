//! Setup for the MS4 slice 4D-lite L4 tests of the core (no AC assertions here): the tags fixture in a temporary
//! directory (tests/fixtures/vaults/tags + new-empty/.tegg; its README.md isn't a vault file), the core with or
//! without the watcher, small file helpers and R80 (docs/acceptance/tags.md). A failure here is a setup failure,
//! never an AC assertion.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::common::{repo_root, Sandbox};
use tegg_core::{AppDirs, Core, CoreOptions, TagRow};

pub const NOW: &str = "2026-10-22T10:00:00+02:00";
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
pub const F_PRAZDNY: &str = "Tags/prázdný.md";
pub const F_DVOJI: &str = "Tags/dvojí.md";
pub const F_DVOJI2: &str = "Tags/Dvojí (2).md";
pub const F_NEZNAMA: &str = "Tags/neznámá.md";
pub const F_CIZI: &str = "Pages/Cizí štítek.md";
pub const F_KOS: &str = ".trash/Tags/starý.md";

pub fn vypln(n: u32) -> String {
    format!("Pages/Výplň {n:02}.md")
}
pub fn at(s: &str) -> String {
    format!("{s}:00+02:00")
}

/// R80 as (key, display name, Tag file, colour, count, Last used as written), key order.
pub fn r80() -> Vec<(String, String, Option<String>, Option<String>, usize, Option<String>)> {
    let row = |k: &str, n: &str, f: Option<&str>, c: Option<&str>, count: usize, last: Option<&str>| {
        (k.to_string(), n.to_string(), f.map(str::to_string), c.map(str::to_string), count, last.map(at))
    };
    vec![
        row("a/b", "a/b", Some(F_AB), None, 1, Some("2026-10-18T09:00")),
        row("cizí", "cizí", Some(F_CIZI), None, 0, None),
        row("dvojí", "dvojí", Some(F_DVOJI), Some("red"), 1, Some("2026-10-19T12:00")),
        row("finance", "finance", None, None, 2, Some("2026-10-21T09:00")),
        row("neznámá", "neznámá", Some(F_NEZNAMA), None, 1, Some("2026-09-10T09:00")),
        row("prázdný", "prázdný", Some(F_PRAZDNY), Some("teal"), 0, None),
        row("účty", "Účty", Some(F_UCTY), Some("blue"), 6, Some("2026-10-22T08:00")),
        row("účty-2026", "účty-2026", None, None, 1, Some("2026-10-01T09:00")),
        row("účty/archiv", "účty/archiv", None, None, 1, Some("2026-10-15T12:00")),
        row("čtení", "čtení", None, None, 2, Some("2026-09-10T09:00")),
    ]
}
pub fn summary(rows: &[TagRow]) -> Vec<(String, String, Option<String>, Option<String>, usize, Option<String>)> {
    rows.iter().map(|r| (r.key.clone(), r.name.clone(), r.file.as_ref().map(|f| f.path.clone()), r.color.clone(), r.count, r.last_used.clone())).collect()
}
pub fn row<'a>(rows: &'a [TagRow], key: &str) -> Option<&'a TagRow> {
    rows.iter().find(|r| r.key == key)
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

/// The tags fixture plus new-empty/.tegg in `<sandbox>/Štítky`.
pub fn tags_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Štítky");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("tags"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
pub fn fixture(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/tags").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}

pub fn open(root: &Path, dirs: &AppDirs, watch: bool) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    if !core.wait_idle(Duration::from_secs(60)) {
        panic!("setup: indexing did not finish");
    }
    core
}

pub fn read(root: &Path, rel: &str) -> Option<String> {
    std::fs::read(root.join(rel)).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}
pub fn write(root: &Path, rel: &str, text: &str) {
    crate::common::write_raw(root, rel, text.as_bytes());
}
pub fn swap(text: &str, from: &str, to: &str) -> String {
    if !text.contains(from) {
        panic!("setup: {from:?} not in the text");
    }
    text.replacen(from, to, 1)
}
/// Every `.md` file of the vault (relative, NFC) except under `.trash/` and `_templates/`.
pub fn tag_files_on_disk(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = crate::common::snapshot(root).into_keys().filter(|k| k.starts_with("Tags/") && k.ends_with(".md")).map(|k| tegg_format::nfc(&k)).collect();
    out.sort();
    out
}
