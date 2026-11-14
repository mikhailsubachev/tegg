//! Setup for the slice REL L4 tests of the core (docs/contracts/v1-related.md §1.11, §7; fixture
//! tests/fixtures/vaults/related/README.md): the fixture in a temporary directory (+ new-empty/.tegg; its README isn't a
//! vault file), opening the core (with or without the watcher, or over a counting file system), the fixture's short
//! names, the index database through the system `sqlite3`, and small readers. No AC assertions here: a panic in this
//! module is a setup failure, never a red test (tools/qa CONTRACT §5.2). Synthetic data only (D-50, D-62).
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use crate::common::{repo_root, Sandbox};
use tegg_core::{AppDirs, Core, CoreOptions};
use tegg_vault::{LocalFs, VaultFs};

pub const SOUHVEZDI: &str = "Pages/Souhvězdí.md";
pub const ROZPOCET: &str = "Pages/Rozpočet na offsite 2027.md";
pub const DEN: &str = "Daily/2026-09-30.md";
pub const UKOL: &str = "Tasks/Poslat návrh rozpočtu financím.md";
pub const TERMINY_A: &str = "Pages/Důležité termíny školení.md";
pub const TERMINY_B: &str = "Pages/Dulezite terminy skoleni.md";
pub const SKOLENI: &str = "Quick Notes/Školení a dodavatel.md";
pub const KNIHA: &str = "Pages/Kniha vzpomínek.md";
pub const POZNAMKY: &str = "Quick Notes/Poznamky ke knize.md";
pub const ZAHRADA: &str = "Pages/Zahrada na jaře.md";
pub const VCELSTVO: &str = "Pages/Včelstvo na zimu.md";
pub const PROHLIDKA: &str = "Pages/Jarní prohlídka úlu.md";
pub const SABLONA: &str = "_templates/Page/Včelí deník.md";
pub const STARY: &str = ".trash/Pages/Starý úl.md";
pub const STARY_RESTORED: &str = "Pages/Starý úl.md";
pub const SVATBA: &str = "Pages/Svatba Petra a Lucie.md";
pub const HIKING: &str = "Pages/Hiking in the mountains.md";
pub const GEAR: &str = "Pages/gear list.md";

pub fn nfc(s: &str) -> String {
    tegg_format::nfc(s)
}
pub fn nfd(s: &str) -> String {
    // Enough for the fixture: decompose the Czech letters with an acute, caron or ring.
    let mut out = String::new();
    for c in nfc(s).chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'Ú' => ('U', '\u{301}'), 'Á' => ('A', '\u{301}'), 'Í' => ('I', '\u{301}'), 'č' => ('c', '\u{30C}'),
            'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'), 'ž' => ('z', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'),
            'ť' => ('t', '\u{30C}'), 'ď' => ('d', '\u{30C}'), 'Š' => ('S', '\u{30C}'), 'Č' => ('C', '\u{30C}'), 'Ř' => ('R', '\u{30C}'),
            'Ž' => ('Z', '\u{30C}'), 'ů' => ('u', '\u{30A}'),
            _ => {
                out.push(c);
                continue;
            }
        };
        out.push(base);
        out.push(mark);
    }
    out
}

/// Every object with a `rel` row (39).
pub fn objects() -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    for (rel, _) in files(&fixture_dir()) {
        if rel == "README.md" || rel.starts_with("_templates/") || rel.starts_with(".trash/") || !rel.ends_with(".md") {
            continue;
        }
        v.push(nfc(&rel));
    }
    v.sort();
    v
}

pub fn fixture_dir() -> PathBuf {
    repo_root().join("tests/fixtures/vaults/related")
}
pub fn fixture_text(rel: &str) -> String {
    String::from_utf8(std::fs::read(fixture_dir().join(rel)).expect("setup: fixture file")).expect("setup: UTF-8")
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

/// Every file under `root`, by its relative path as the file system spells it.
pub fn files(root: &Path) -> Vec<(String, PathBuf)> {
    fn walk(root: &Path, d: &Path, out: &mut Vec<(String, PathBuf)>) {
        for e in std::fs::read_dir(d).expect("setup: read_dir") {
            let e = e.expect("setup: entry");
            let p = e.path();
            if e.file_type().expect("setup: type").is_dir() {
                walk(root, &p, out);
            } else {
                out.push((p.strip_prefix(root).expect("setup: prefix").to_string_lossy().into_owned(), p));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

/// The related fixture in `<sandbox>/<name>`.
pub fn related_vault_named(sb: &Sandbox, name: &str) -> PathBuf {
    let root = sb.base.join(name);
    copy_dir(&fixture_dir(), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
pub fn related_vault(sb: &Sandbox) -> PathBuf {
    related_vault_named(sb, "Related")
}

pub fn open(root: &Path, dirs: &AppDirs, watch: bool) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    if !core.wait_idle(Duration::from_secs(120)) {
        panic!("setup: indexing did not finish");
    }
    core
}
pub fn open_with(fs: Arc<dyn VaultFs>, dirs: &AppDirs) -> Core {
    let core = match Core::open_with(fs, dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_with: {e:?}"),
    };
    if !core.wait_idle(Duration::from_secs(120)) {
        panic!("setup: indexing did not finish");
    }
    core
}
pub fn local_fs(root: &Path) -> LocalFs {
    LocalFs::new(root)
}

/// The index database of an open core (`<vault local dir>/index.sqlite`, contract §1.5).
pub fn index_db(core: &Core) -> PathBuf {
    core.vault().local_dir().join("index.sqlite")
}
/// Runs SQL on a database with the system `sqlite3`; `Err` with its stderr when it fails.
pub fn sqlite(db: &Path, sql: &str) -> Result<String, String> {
    let out = Command::new("/usr/bin/sqlite3").arg(db).arg(sql).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// The files of the machine-local dir other than the index database (recency, last-opened, …), with their bytes.
pub fn local_state(core: &Core) -> Vec<(String, Vec<u8>)> {
    let dir = core.vault().local_dir();
    let mut out = Vec::new();
    for (rel, p) in files(&dir) {
        if rel.starts_with("index.sqlite") {
            continue;
        }
        out.push((rel, std::fs::read(&p).unwrap_or_default()));
    }
    out
}

/// Some small, deterministic text from `Burst/` notes (the crash test's 500-file burst).
pub fn burst_note(i: usize, cycle: usize) -> String {
    const W: [&str; 12] = ["kytara", "zahrada", "rozpočet", "včelstvo", "školení", "teleskop", "potok", "matka", "domek", "plot", "léto", "řeka"];
    let a = W[(i + cycle) % W.len()];
    let b = W[(i * 7 + cycle * 3) % W.len()];
    let c = W[(i * 11 + 5) % W.len()];
    format!("---\ntype: page\ntitle: Dávka {i:03}\n---\nPoznámka o {a}, {b} a {c}. Cyklus {cycle}.\n")
}
