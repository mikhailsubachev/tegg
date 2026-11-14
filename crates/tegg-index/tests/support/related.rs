//! Setup for the slice REL L4 tests of `tegg-index` (docs/contracts/v1-related.md §1, §7; fixture
//! tests/fixtures/vaults/related/README.md): a temporary copy of the fixture with `new-empty/.tegg`, an index built with
//! `Index::upsert` of every indexable file, the fixture's short names and small readers. No assertions about the
//! criteria here: a panic in this module is a setup failure, never a red test (tools/qa CONTRACT §5.2). Synthetic data
//! only (D-50, D-62). Included by the test files with `#[path = "support/related.rs"]`.
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use tegg_index::{Index, RelatedList, RelatedParams};
use tegg_vault::FileVersion;
use unicode_normalization::UnicodeNormalization;

// The fixture's objects (README "Objects").
pub const SOUHVEZDI: &str = "Pages/Souhvězdí.md";
pub fn hvezda(n: u32) -> String {
    format!("Pages/Hvězda {n:02}.md")
}
pub const ROZPOCET: &str = "Pages/Rozpočet na offsite 2027.md";
pub const DEN: &str = "Daily/2026-09-30.md";
pub const UKOL: &str = "Tasks/Poslat návrh rozpočtu financím.md";
pub const TERMINY_A: &str = "Pages/Důležité termíny školení.md";
pub const TERMINY_B: &str = "Pages/Dulezite terminy skoleni.md";
pub const SKOLENI: &str = "Quick Notes/Školení a dodavatel.md";
pub const KNIHA: &str = "Pages/Kniha vzpomínek.md";
pub const POZNAMKY: &str = "Quick Notes/Poznamky ke knize.md";
pub const ZAHRADA: &str = "Pages/Zahrada na jaře.md";
pub const ZAHON: &str = "Pages/Záhon s rajčaty.md";
pub const SEMINKA: &str = "Quick Notes/Semínka na jaro.md";
pub const VCELSTVO: &str = "Pages/Včelstvo na zimu.md";
pub const PROHLIDKA: &str = "Pages/Jarní prohlídka úlu.md";
pub const VCELARENI: &str = "Tags/Včelaření.md";
pub const UL: &str = "Images/Úl u lesa.md";
pub const NAVOD: &str = "PDFs/Návod ke krmení.md";
pub const SABLONA: &str = "_templates/Page/Včelí deník.md";
pub const STARY: &str = ".trash/Pages/Starý úl.md";
pub const STARY_RESTORED: &str = "Pages/Starý úl.md";
pub const HIKING: &str = "Pages/Hiking in the mountains.md";
pub const TRAIL: &str = "Pages/Trail notes.md";
pub const TURA: &str = "Pages/Túra v horách.md";
pub const GEAR: &str = "Pages/gear list.md";
pub const MLEKO: &str = "Quick Notes/Koupit mléko.md";
pub const BUBEN: &str = "Quick Notes/Buben.md";
pub const KYTARA: &str = "Quick Notes/Kytara.md";
pub const KROUZEK: &str = "Pages/Hudební kroužek.md";
pub const SVATBA: &str = "Pages/Svatba Petra a Lucie.md";
pub const PRAZDNA: &str = "Pages/Prázdná.md";

/// Every object with a `rel` row (39: not the template, not the trash).
pub fn objects() -> Vec<String> {
    let mut v: Vec<String> = vec![SOUHVEZDI.to_string()];
    v.extend((1..=12).map(hvezda));
    for p in [
        ROZPOCET, DEN, UKOL, TERMINY_A, TERMINY_B, SKOLENI, KNIHA, POZNAMKY, ZAHRADA, ZAHON, SEMINKA, VCELSTVO, PROHLIDKA, VCELARENI, UL,
        NAVOD, HIKING, TRAIL, TURA, GEAR, MLEKO, BUBEN, KYTARA, KROUZEK, SVATBA, PRAZDNA,
    ] {
        v.push(p.to_string());
    }
    v.into_iter().map(|p| nfc(&p)).collect()
}

pub fn nfc(s: &str) -> String {
    s.nfc().collect()
}
pub fn nfd(s: &str) -> String {
    s.nfd().collect()
}
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("setup: repo root")
}
pub fn fixture_dir() -> PathBuf {
    repo_root().join("tests/fixtures/vaults/related")
}
/// The committed bytes of a fixture file, as text.
pub fn fixture_text(rel: &str) -> String {
    String::from_utf8(std::fs::read(fixture_dir().join(rel)).expect("setup: fixture file")).expect("setup: UTF-8")
}

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        let name = e.file_name();
        if skip.iter().any(|s| name == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(&name), &[]);
        } else {
            std::fs::copy(e.path(), to.join(&name)).expect("setup: copy");
        }
    }
}

pub struct Vault {
    pub tmp: tempfile::TempDir,
    pub root: PathBuf,
}

/// `related/` (without README.md) + `new-empty/.tegg` in `<tmp>/Related` (contract §7).
pub fn related_vault() -> Vault {
    let tmp = tempfile::tempdir().expect("setup: tempdir");
    let root = tmp.path().canonicalize().expect("setup: canonical").join("Related");
    copy_dir(&fixture_dir(), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    Vault { tmp, root }
}

pub fn version_of(p: &Path, bytes: &[u8]) -> FileVersion {
    let md = std::fs::metadata(p).expect("setup: metadata");
    let mut hash = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        hash[i % 32] = hash[i % 32].wrapping_mul(31).wrapping_add(*b);
    }
    FileVersion { mtime_ns: md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, size: bytes.len() as u64, hash }
}

/// Every file of the vault, by its relative path as the file system spells it.
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

/// A fresh index (in `<tmp>/<db>`) of every indexable file of the vault, through `Index::upsert`.
pub fn index_named(v: &Vault, db: &str) -> Index {
    let dir = v.tmp.path().join(db);
    std::fs::create_dir_all(&dir).expect("setup: db dir");
    let mut idx = Index::open(&dir.join("index.sqlite")).expect("setup: Index::open");
    for (rel, p) in files(&v.root) {
        if !tegg_index::is_indexable(&rel) {
            continue;
        }
        let bytes = std::fs::read(&p).expect("setup: read");
        idx.upsert(&rel, &bytes, &version_of(&p, &bytes)).expect("setup: upsert");
    }
    idx
}
pub fn index(v: &Vault) -> Index {
    index_named(v, "db")
}

/// Writes `bytes` at `rel` in the vault and upserts it (an external change, as the watcher would report it).
pub fn put(idx: &mut Index, v: &Vault, rel: &str, bytes: &[u8]) {
    let p = v.root.join(rel);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).expect("setup: parent");
    }
    std::fs::write(&p, bytes).expect("setup: write");
    idx.upsert(rel, bytes, &version_of(&p, bytes)).expect("setup: upsert");
}
/// Removes `rel` from the vault and the index.
pub fn drop_file(idx: &mut Index, v: &Vault, rel: &str) {
    let _ = std::fs::remove_file(v.root.join(rel));
    idx.remove(rel).expect("setup: remove");
}

/// Equal titles in code-point order (the test's collator; every fixture tie is ordered the same by `cs`, `en-US` and
/// the root collation, contract CP-2).
pub fn code_points(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}
/// `Index::related` with the default parameters, no extra linked paths.
pub fn related(idx: &Index, path: &str, shown: bool) -> Option<RelatedList> {
    idx.related(&nfc(path), shown, &RelatedParams::default(), &[], &code_points)
}
pub fn paths(l: &RelatedList) -> Vec<String> {
    l.entries.iter().map(|e| nfc(&e.path)).collect()
}
pub fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| nfc(s)).collect()
}
pub fn owned(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| nfc(s)).collect()
}

/// Folded words of a text (letters and digits between other characters), for the tests' own counts.
pub fn folded_words(text: &str) -> Vec<String> {
    tegg_index::fold(text).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}
/// The body after the frontmatter (the whole text when it has none).
pub fn body_of(text: &str) -> String {
    text[tegg_format::body_start(text)..].to_string()
}
