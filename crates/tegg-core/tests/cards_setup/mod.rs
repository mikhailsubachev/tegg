//! Setup for the slice OC L4 tests (docs/acceptance/cards.md; docs/contracts/v1-cards.md §3): the cards fixture in a
//! temporary directory (tests/fixtures/vaults/views + new-empty/.tegg + the cards/ overlay, READMEs and the expected
//! card data excluded; the two attachments of the overlay README copied in), the test clock (`2026-11-19T10:00:00+01:00`,
//! Europe/Prague, `en-US`), file probes and runtime queries. No AC assertions here: a panic in this module is a setup
//! failure, never a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{NaiveDate, Weekday};

use crate::common::{repo_root, Sandbox};
use tegg_core::queries_q::{QueryEnv, QueryResult, QuerySource};
use tegg_core::{Core, CoreOptions};

pub const NOW: &str = "2026-11-19T10:00:00+01:00";
pub const VYLET: &str = ".tegg/types/výlet.yml";
pub const CLANEK: &str = ".tegg/types/článek.yml";
pub const KONTROLA: &str = ".tegg/types/kontrola.yml";
pub const BOOK: &str = ".tegg/types/book.yml";
pub const STAV_Q: &str = "Výlety podle stavu";
pub const SNEZKA: &str = "Výlety/Sněžka z Pece.md";
pub const MACHOVO: &str = "Výlety/Okolo Máchova jezera.md";
pub const PALAVA: &str = "Výlety/Pálava na kole.md";
pub const MAGISTRALA: &str = "Výlety/Krkonošská magistrála.md";
pub const CHATY: &str = "Články/Horské chaty.md";
pub const PODKLADY: &str = "Články/Podklady k výletům.md";
pub const BEZ: &str = "Články/Bez zdroje.md";
pub const TEXTOVY: &str = "Články/Textový zdroj.md";
pub const ODKAZ: &str = "Články/Odkaz na výlet.md";
pub const KONTROLA_KOLA: &str = "Kontroly/Kontrola kola.md";
pub const NAPAD: &str = "Quick Notes/Nápad na výlet.md";
pub const VYHLIDKA: &str = "Images/Vyhlídka na Pálavě.md";
pub const PRAVIDLA: &str = "PDFs/Pravidla tábora.md";
pub const KARTY: &str = "Pages/Karty.md";
pub const UCETNI: &str = "Books/Účetní ze Žižkova.md";

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
/// The base, new-empty's `.tegg/` and the overlay in `<sandbox>/Výlety a knihy`, with the README's attachments.
pub fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Výlety a knihy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("views"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fx.join("cards"), &root, &["README.md", "expected-card-data.json"]);
    std::fs::create_dir_all(root.join("_attachments")).expect("setup: _attachments");
    std::fs::copy(fx.join("trash-media/_attachments/záhon.png"), root.join("_attachments/vyhlidka.png")).expect("setup: png");
    std::fs::copy(fx.join("trash-media/_attachments/Rozpočet.pdf"), root.join("_attachments/pravidla-tabora.pdf")).expect("setup: pdf");
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
    let fx = repo_root().join("tests/fixtures/vaults");
    for base in ["cards", "views"] {
        if let Ok(b) = std::fs::read(fx.join(base).join(rel)) {
            return String::from_utf8(b).expect("setup: UTF-8");
        }
    }
    String::from_utf8(std::fs::read(fx.join("new-empty").join(rel)).unwrap_or_else(|e| panic!("setup: fixture {rel}: {e}"))).expect("setup: UTF-8")
}
pub fn expected_cards() -> serde_json::Value {
    let p = repo_root().join("tests/fixtures/vaults/cards/expected-card-data.json");
    serde_json::from_str(&std::fs::read_to_string(p).expect("setup: expected-card-data.json")).expect("setup: JSON")
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
pub fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (b, m) = match c {
            'á' => ('a', '\u{301}'),
            'í' => ('i', '\u{301}'),
            'ý' => ('y', '\u{301}'),
            'č' => ('c', '\u{30C}'),
            'ě' => ('e', '\u{30C}'),
            'ř' => ('r', '\u{30C}'),
            'š' => ('s', '\u{30C}'),
            'ž' => ('z', '\u{30C}'),
            o => {
                out.push(o);
                continue;
            }
        };
        out.push(b);
        out.push(m);
    }
    out
}
pub fn env() -> QueryEnv {
    QueryEnv { today: NaiveDate::from_ymd_opt(2026, 11, 19).expect("date"), tz: "Europe/Prague".parse().expect("zone"), week_start: Weekday::Sun, locale: "en-US".into() }
}
pub fn run(core: &Core, name: &str) -> QueryResult {
    core.query_run(QuerySource::Saved(name.into()), None, &env())
}
pub fn qpath(name: &str) -> String {
    format!(".tegg/queries/{name}.yml")
}
/// A runtime board query in R138's create style.
pub fn board_query(title: &str, types: &[&str], group_by: &str) -> String {
    format!(
        "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {title}.\nversion: 1\ntitle: {title}\ntypes: [{}]\nmatch: all\nfilters: []\nsort: {{ by: title, order: asc }}\nlimit: 50\nview: board\ngroup_by: {group_by}\nlanes: vertical\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n",
        types.join(", ")
    )
}
/// The runtime seven-type board of FR-TYP-11 AC-7.
pub const SEVEN: &str = "Sedm typů";
pub fn add_seven(root: &Path) {
    write(root, &qpath(SEVEN), board_query(SEVEN, &["výlet", "článek", "kontrola", "quick-note", "image", "pdf", "book"], "tags").as_bytes());
}
