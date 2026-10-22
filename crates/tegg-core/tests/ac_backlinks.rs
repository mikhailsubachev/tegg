//! MS4 slice 4A AC tests at the core (L4): FR-LNK-01 AC-2, AC-3 (instant order), AC-4 (panel excerpts, core part),
//! AC-7, AC-9 (index), AC-10 (own writes, core part), AC-11, AC-12; FR-LNK-02 AC-4 (keys), AC-5 (embed flag);
//! FR-LNK-04 AC-5 (write, re-resolution), AC-6 (titles), AC-7 (names), AC-8 (paths), AC-9, AC-10 (grouping,
//! counts), AC-11; FR-LNK-14 AC-6 (data), AC-7, AC-8 (groups, counts), AC-10.
//! docs/acceptance/backlinks.md; interface docs/contracts/ms4-links.md §1, §2.3, §3, §3.1. Written from the ACs and
//! the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/backlinks + new-empty/.tegg in a temporary directory on APFS (its README.md is not
//! part of the vault and isn't copied). Bytes, mtime and inode are compared with `common::snapshot`. The new error
//! kinds `PlanChanged` / `Exists` and the switcher's `duplicate` field are read through `Debug`, so this file compiles
//! before they exist (TS-I1).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{
    BacklinkEntry, BacklinksPanel, Core, CoreOptions, CreateRefusal, DuplicateDetails, LinkCreatePlan, LinkKind, OccurrenceKind,
};
use tegg_format::excerpt::RSeg;
use tegg_format::nfc;

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

const CIL: &str = "Pages/Cíl.md";
const ODKAZY: &str = "Pages/Odkazy v textu.md";
const ROZBITE: &str = "Pages/Rozbité odkazy.md";
const MARKDOWN: &str = "Pages/Markdown odkaz.md";
const NEPLATNA: &str = "Pages/Neplatná hlavička.md";
const RYCHLA: &str = "Quick Notes/Rychlá poznámka.md";
const DENNI: &str = "Daily/2026-10-07.md";
const PORADA: &str = "Schůzky/2026-10-08 Porada.md";
const STARSI: &str = "Schůzky/Starší porada.md";
const S_CHYBOU: &str = "Schůzky/Porada s chybou.md";
const BEZ_TYPU: &str = "Pages/Bez typu s vlastností.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const OSAMELA: &str = "Pages/Osamělá.md";
const DVOJNIK_P: &str = "Pages/Dvojník.md";
const DVOJNIK_Q: &str = "Quick Notes/Dvojník.md";
const Z_RYCHLYCH: &str = "Quick Notes/Z rychlých.md";
const ZE_STRANEK: &str = "Pages/Ze stránek.md";
const Z_KORENE: &str = "Z kořene.md";
const SPM: &str = "Pages/Senior Product Manager.md";
const SPM2: &str = "Pages/Senior Product Manager (2).md";
const SPM_ALFA: &str = "Osoby/SPM Alfa.md";
const SPM_VELKYMI: &str = "Quick Notes/SPM velkými.md";
const ODKAZ_SPM: &str = "Pages/Odkaz na SPM.md";
const CTENI: &str = "Pages/Čtení.md";
const CTENI2: &str = "Pages/Čtení podruhé.md";
const DALSI: &str = "Quick Notes/Další rozbitý.md";
const SABLONA: &str = "_templates/Page/Šablona.md";
const SMAZANA: &str = ".trash/Pages/Smazaná.md";

const CIL_SOURCES: [&str; 9] = [ODKAZY, ROZBITE, MARKDOWN, NEPLATNA, RYCHLA, DENNI, PORADA, STARSI, BEZ_TYPU];

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
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
/// `tests/fixtures/vaults/backlinks/` (without its README.md) plus `new-empty/.tegg/` in `<sandbox>/Trezor`.
fn backlinks_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("backlinks"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    open_dirs(root, &sb.dirs, watch)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn write_ext(root: &Path, rel: &str, text: &str) {
    write_raw(root, rel, text.as_bytes());
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
/// The bytes `@tegg/doc` `newObject` would give a new object (D-232): id, type, title, created, modified, empty body.
fn new_bytes(type_key: &str, title: &str) -> Vec<u8> {
    let quoted = if title.contains(':') || title.contains('?') || title.contains('#') { format!("\"{title}\"") } else { title.to_string() };
    format!("---\nid: 01JB4A0000000000000000N001\ntype: {type_key}\ntitle: {quoted}\ncreated: 2026-10-15T10:00:00+02:00\nmodified: 2026-10-15T10:00:00+02:00\n---\n").into_bytes()
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}

// ------------------------------------------------------------------------------------------------ panel probes

fn sources(p: &BacklinksPanel) -> BTreeSet<String> {
    p.groups.iter().flat_map(|g| g.entries.iter().map(|e| nfc(&e.source))).collect()
}
fn source_list(p: &BacklinksPanel) -> Vec<String> {
    p.groups.iter().flat_map(|g| g.entries.iter().map(|e| nfc(&e.source))).collect()
}
fn group_keys(p: &BacklinksPanel) -> Vec<(String, usize)> {
    p.groups.iter().map(|g| (nfc(&g.type_key), g.entries.len())).collect()
}
fn entry<'a>(p: &'a BacklinksPanel, source: &str) -> Option<&'a BacklinkEntry> {
    p.groups.iter().flat_map(|g| g.entries.iter()).find(|e| nfc(&e.source) == source)
}
fn seg_text(g: &RSeg) -> &str {
    match g {
        RSeg::Text { text, .. } | RSeg::Link { text, .. } => text,
    }
}
fn excerpt_text(o: &tegg_core::Occurrence) -> String {
    nfc(&o.excerpt.segments.iter().map(seg_text).collect::<String>())
}
fn here_flags(o: &tegg_core::Occurrence) -> Vec<(String, bool)> {
    o.excerpt.segments.iter().filter_map(|g| if let RSeg::Link { text, here, .. } = g { Some((nfc(text), *here)) } else { None }).collect()
}
fn backlinks(core: &Core, path: &str) -> BTreeSet<String> {
    core.backlinks(path).into_iter().map(|p| nfc(&p)).collect()
}
/// What `link_resolve(S, [target])` gives for one target (the chip's resolution).
fn resolves_to(core: &Core, from: &str, target: &str) -> Option<String> {
    core.resolve_links(from, &[target.to_string()]).into_iter().next().and_then(|t| if t.kind == LinkKind::Note || t.kind == LinkKind::Daily { t.path.map(|p| nfc(&p)) } else { None })
}

// ------------------------------------------------------------------------------------------------ FR-LNK-01

#[test]
fn fr_lnk_01_ac2_cil_panel_lists_exactly_the_nine_sources() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    assert_eq!(sources(&p), set(&CIL_SOURCES), "Cíl's panel sources (no Cíl, Šablona, Smazaná, Jana; code/fence/math/comment not counted)");
    assert_eq!(p.objects, 9, "objects = 9 linking objects");
    let list = source_list(&p);
    assert_eq!(list.len(), 9, "each source is listed once however many links it has: {list:?}");
    assert_eq!(backlinks(&core, CIL), set(&CIL_SOURCES), "Core::backlinks(\"Pages/Cíl.md\") returns the same paths");
    for not in [CIL, SABLONA, SMAZANA, JANA] {
        assert!(!list.contains(&not.to_string()), "{not} is not a source");
    }
}

#[test]
fn fr_lnk_01_ac2_invalid_frontmatter_counts_only_its_body_link() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let e = entry(&p, NEPLATNA);
    assert!(e.is_some(), "Neplatná hlavička is listed: {p:?}");
    let e = e.cloned().unwrap_or_else(|| unreachable!());
    assert_eq!(e.occurrences.len(), 1, "only the body link `Text s [[Cíl]].` (its frontmatter isn't read, NFR-REL-03)");
    assert_eq!(e.occurrences[0].kind, OccurrenceKind::Body);
    assert_eq!(excerpt_text(&e.occurrences[0]), "Text s Cíl.");
    assert!(e.read_only, "the editor can't open it: read_only (source view, NFR-REL-03)");
}

#[test]
fn fr_lnk_01_ac3_groups_in_type_order_and_entries_by_instant() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    assert_eq!(
        group_keys(&p),
        vec![("page".into(), 4), ("quick-note".into(), 1), ("daily-note".into(), 1), ("schůzka".into(), 2), ("neznámý".into(), 1)],
        "D-121 order: system types, user types, undefined types; no empty groups"
    );
    let undefined = p.groups.iter().find(|g| nfc(&g.type_key) == "neznámý");
    assert!(undefined.map(|g| !g.defined && nfc(&g.raw) == "neznámý").unwrap_or(false), "neznámý has no definition and keeps its raw value: {undefined:?}");
    let pages: Vec<String> = p.groups.first().map(|g| g.entries.iter().map(|e| nfc(&e.source)).collect()).unwrap_or_default();
    assert_eq!(pages.get(..2), Some(&strings(&[ODKAZY, ROZBITE])[..]), "modified descending first (10 Oct, 5 Oct): {pages:?}");
    assert_eq!(pages.iter().skip(2).cloned().collect::<BTreeSet<_>>(), set(&[MARKDOWN, NEPLATNA]), "entries without modified last (untyped and invalid-frontmatter sources are Pages)");
    let sch: Vec<String> = p.groups.get(3).map(|g| g.entries.iter().map(|e| nfc(&e.source)).collect()).unwrap_or_default();
    assert_eq!(sch, strings(&[PORADA, STARSI]), "Schůzky: Porada (12 Oct), Starší porada (1 Sep)");
}

#[test]
fn fr_lnk_01_ac3_order_uses_the_instant_not_the_text() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    // 08:30Z on 10 Oct is later than Odkazy v textu's 09:00+02:00 (07:00Z), though its text sorts first.
    let r = swap(&read(&root, ROZBITE), "modified: 2026-10-05T09:00:00+02:00", "modified: 2026-10-10T08:30:00+00:00");
    write_ext(&root, ROZBITE, &r);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let pages: Vec<String> = p.groups.first().map(|g| g.entries.iter().map(|e| nfc(&e.source)).collect()).unwrap_or_default();
    assert_eq!(pages.get(..2), Some(&strings(&[ROZBITE, ODKAZY])[..]), "ordered by instant: {pages:?}");
}

#[test]
fn fr_lnk_01_ac4_core_panel_excerpts_and_positions_of_odkazy_v_textu() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let e = entry(&p, ODKAZY).cloned();
    assert!(e.is_some(), "Odkazy v textu is listed");
    let e = e.unwrap_or_else(|| unreachable!());
    let texts: Vec<String> = e.occurrences.iter().map(excerpt_text).collect();
    assert_eq!(texts.len(), 5, "five excerpts (two links in one block give one): {texts:?}");
    assert_eq!(texts[..4].to_vec(), strings(&["Viz Cíl a také jiný text ve stejném odstavci.", "Bod s odkazem Cíl › Úvod", "Nadpis s Cíl", "řádek · v tabulce"]));
    assert!(e.occurrences[4].excerpt.cut_start && e.occurrences[4].excerpt.cut_end, "the long paragraph is cut on both sides");
    assert!(texts[4].chars().count() <= 160, "at most 160 characters: {}", texts[4]);
    assert_eq!(here_flags(&e.occurrences[0]), vec![("Cíl".to_string(), true), ("jiný text".to_string(), true)], "both chips point here");
    let at: Vec<(u32, u32)> = e.occurrences.iter().map(|o| (o.at.line, o.at.byte)).collect();
    assert_eq!(at, vec![(8, 4), (10, 16), (13, 12), (17, 12), (19, 194)], "at = the first link of each occurrence (line, byte)");
    let md = entry(&p, MARKDOWN).map(|e| e.occurrences.iter().map(excerpt_text).collect::<Vec<_>>()).unwrap_or_default();
    assert_eq!(md, strings(&["Markdownový odkaz první.", "Kódovaný odkaz druhý."]), "Markdown link text, URL-decoded target (D-155)");
}

#[test]
fn fr_lnk_01_ac7_resolution_is_the_same_as_the_links() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    // The named cases.
    let cases: [(&str, &str, &str); 7] = [
        (Z_RYCHLYCH, "Dvojník", DVOJNIK_Q),
        (ZE_STRANEK, "Dvojník", DVOJNIK_P),
        (Z_KORENE, "Dvojník", DVOJNIK_P),
        (Z_KORENE, "Quick Notes/Dvojník", DVOJNIK_Q),
        (ODKAZ_SPM, "Senior Product Manager", SPM),
        (ZE_STRANEK, "2026-10-07", DENNI),
        (ROZBITE, "Cíl", CIL),
    ];
    for (from, target, to) in cases {
        assert_eq!(resolves_to(&core, from, target).as_deref(), Some(to), "setup: link_resolve({from}, [{target}])");
    }
    let panel = |p: &str| sources(&core.backlinks_panel(p));
    assert_eq!(panel(DVOJNIK_Q), set(&[Z_RYCHLYCH, Z_KORENE]), "Quick Notes/Dvojník: Z rychlých (same folder) and Z kořene's path link");
    assert_eq!(panel(DVOJNIK_P), set(&[ZE_STRANEK, Z_KORENE]), "Pages/Dvojník: Ze stránek (same folder) and Z kořene (shortest path)");
    assert_eq!(panel(SPM), set(&[ODKAZ_SPM]), "[[Senior Product Manager]] → SPM only");
    for other in [SPM_ALFA, SPM_VELKYMI] {
        assert_eq!(panel(other), BTreeSet::new(), "{other}: never by title (FR-LNK-14)");
    }
    assert_eq!(panel(SPM2), set(&[ODKAZ_SPM]), "SPM 2 only through its own stem");
    assert!(panel(DENNI).contains(ZE_STRANEK), "date link first (D-162)");
    assert!(panel(CIL).contains(ROZBITE), "a missing heading still points at Cíl");
    assert_eq!(resolves_to(&core, ODKAZ_SPM, "Reading list"), None, "an alias alone never resolves (D-141)");
    // The inverse for every link of every fixture file (body and frontmatter), through link_resolve.
    let mut expect: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for o in core.objects() {
        let s = nfc(&o.path);
        if s.starts_with("_templates/") || s.starts_with(".trash/") {
            continue;
        }
        let x = tegg_format::extract(&std::fs::read(root.join(&o.path)).unwrap_or_default(), Path::new(&o.path).file_stem().and_then(|x| x.to_str()).unwrap_or(""));
        let targets: Vec<String> = x.links.iter().map(|l| l.target.clone()).filter(|t| !t.is_empty()).collect();
        for t in core.resolve_links(&o.path, &targets) {
            if let (LinkKind::Note | LinkKind::Daily, Some(p)) = (t.kind, t.path) {
                if nfc(&p) != s {
                    expect.entry(nfc(&p)).or_default().insert(s.clone());
                }
            }
        }
    }
    let mut bad = Vec::new();
    for o in core.objects() {
        let t = nfc(&o.path);
        let want = expect.get(&t).cloned().unwrap_or_default();
        let got = panel(&t);
        // If extract() has no records for Markdown links, Markdown odkaz → Cíl is checked by AC-2 instead.
        let got_wiki: BTreeSet<String> = if t == CIL && !want.contains(MARKDOWN) { got.iter().filter(|s| s.as_str() != MARKDOWN).cloned().collect() } else { got.clone() };
        if got_wiki != want {
            bad.push(format!("{t}: panel {got:?}, link_resolve {want:?}"));
        }
    }
    assert!(bad.is_empty(), "panel sources differ from link_resolve:\n{}", bad.join("\n"));
}

#[test]
fn fr_lnk_01_ac9_external_changes_update_the_index_within_2s() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, true);
    assert_eq!(core.backlinks_panel(CIL).objects, 9, "before the changes: 9 objects link to Cíl");
    let before = snapshot(&root);
    let mut touched: BTreeSet<String> = BTreeSet::new();

    // Another program adds `Viz [[Cíl]].` to Osamělá.
    write_ext(&root, OSAMELA, &format!("{}Viz [[Cíl]].\n", read(&root, OSAMELA)));
    touched.insert(OSAMELA.into());
    let t = wait_until(Duration::from_secs(2), || {
        let p = core.backlinks_panel(CIL);
        p.objects == 10 && p.groups.first().map(|g| g.entries.iter().any(|e| nfc(&e.source) == OSAMELA)).unwrap_or(false)
    });
    assert!(t.is_some(), "Osamělá in Pages within 2 s, 10 objects: {:?}", group_keys(&core.backlinks_panel(CIL)));

    // All three links removed from Rychlá poznámka.
    let r = read(&root, RYCHLA);
    let body_at = r.find("Malými").unwrap_or(r.len());
    write_ext(&root, RYCHLA, &format!("{}Bez odkazů.\n", &r[..body_at]));
    touched.insert(RYCHLA.into());
    let t = wait_until(Duration::from_secs(2), || !group_keys(&core.backlinks_panel(CIL)).iter().any(|(k, _)| k == "quick-note"));
    assert!(t.is_some(), "the Quick Notes group is gone within 2 s");

    // Starší porada moved to .trash/.
    std::fs::create_dir_all(root.join(".trash/Schůzky")).expect("setup: trash dir");
    std::fs::rename(root.join(STARSI), root.join(".trash/Schůzky/Starší porada.md")).expect("setup: move to trash");
    touched.insert(STARSI.into());
    touched.insert(".trash/Schůzky/Starší porada.md".into());
    touched.insert(".trash/Schůzky/".into());
    let t = wait_until(Duration::from_secs(2), || !sources(&core.backlinks_panel(CIL)).contains(STARSI));
    assert!(t.is_some(), "Starší porada gone within 2 s");

    // Bez typu's type becomes page.
    write_ext(&root, BEZ_TYPU, &swap(&read(&root, BEZ_TYPU), "type: neznámý", "type: page"));
    touched.insert(BEZ_TYPU.into());
    let t = wait_until(Duration::from_secs(2), || {
        let p = core.backlinks_panel(CIL);
        p.groups.first().map(|g| nfc(&g.type_key) == "page" && g.entries.iter().any(|e| nfc(&e.source) == BEZ_TYPU)).unwrap_or(false)
            && !group_keys(&p).iter().any(|(k, _)| k == "neznámý")
    });
    assert!(t.is_some(), "Bez typu moves to Pages within 2 s");

    // The poznámka property's Name becomes Komentář.
    let ty = ".tegg/types/schůzka.yml";
    write_ext(&root, ty, &swap(&read(&root, ty), "name: Poznámka", "name: Komentář"));
    touched.insert(ty.into());
    let label = || {
        entry(&core.backlinks_panel(CIL), PORADA)
            .and_then(|e| e.occurrences.iter().find(|o| o.attribute.as_deref().map(nfc).as_deref() == Some("poznámka")).and_then(|o| o.attribute_name.clone()))
            .map(|n| nfc(&n))
    };
    let t = wait_until(Duration::from_secs(2), || label().as_deref() == Some("Komentář"));
    assert!(t.is_some(), "Porada's excerpt label follows the schema within 2 s: {:?}", label());

    // Nothing written by Tegg: only the files the other program changed differ.
    let after = snapshot(&root);
    let extra: Vec<String> = changed(&before, &after).into_iter().filter(|p| !touched.contains(p)).collect();
    assert_eq!(extra, Vec::<String>::new(), "Tegg wrote nothing");
}

#[test]
fn fr_lnk_01_ac10_own_write_is_in_the_panel_when_write_returns() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let (bytes, base) = ok!(core.read_note(OSAMELA, SystemTime::now()), "read_note");
    let text = format!("{}[[Cíl]]\n", String::from_utf8(bytes).unwrap_or_default());
    let _ = ok!(core.write_note(OSAMELA, text.as_bytes(), Some(&base)), "write_note");
    // No wait: the core indexes and re-resolves its own writes before it answers (ms4-links §1).
    assert!(sources(&core.backlinks_panel(CIL)).contains(OSAMELA), "Osamělá in Cíl's panel when note_write returns");
    let (bytes, base) = ok!(core.read_note(OSAMELA, SystemTime::now()), "read_note");
    let gone = swap(&String::from_utf8(bytes).unwrap_or_default(), "[[Cíl]]\n", "");
    let _ = ok!(core.write_note(OSAMELA, gone.as_bytes(), Some(&base)), "write_note");
    assert!(!sources(&core.backlinks_panel(CIL)).contains(OSAMELA), "gone when the second note_write returns");
    assert_eq!(core.backlinks_panel(CIL).objects, 9, "back to 9");
}

#[test]
fn fr_lnk_01_ac11_lower_case_and_nfd_links_count() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let kinds: Vec<OccurrenceKind> = entry(&p, RYCHLA).map(|e| e.occurrences.iter().map(|o| o.kind).collect()).unwrap_or_default();
    assert_eq!(kinds, vec![OccurrenceKind::Body, OccurrenceKind::Body, OccurrenceKind::Embed], "[[cíl]], NFD [[Cíl]] and ![[Cíl]]: 3 excerpts");
}

#[test]
fn fr_lnk_01_ac11_nfd_named_copy_and_nfd_renamed_target() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    // A runtime NFD-named copy of Rychlá poznámka with another id and an NFD title.
    let copy = read(&root, RYCHLA).replace("01JB4A0000000000000000B005", "01JB4A0000000000000000C005");
    write_raw(&root, &tegg_nfd("Quick Notes/Rychlá poznámka (kopie).md"), tegg_nfd_title(&copy).as_bytes());
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let q: Vec<(String, String)> = p.groups.iter().filter(|g| g.type_key == "quick-note").flat_map(|g| g.entries.iter().map(|e| (e.source.clone(), e.title.clone()))).collect();
    assert_eq!(q.len(), 2, "two Quick Notes entries: {q:?}");
    for (s, t) in &q {
        assert_eq!(s, &nfc(s), "source path in NFC: {s:?}");
        assert_eq!(t, "Rychlá poznámka", "title in NFC");
    }
    assert_eq!(p.objects, 10, "badge 10 with the copy");
    drop(core);

    // Cíl's file renamed to its NFD form: panel and badge unchanged (FR-FMT-12).
    let sb2 = sandbox();
    let root2 = backlinks_vault(&sb2);
    let before = open(&root2, &sb2, false).backlinks_panel(CIL);
    std::fs::rename(root2.join(CIL), root2.join(tegg_nfd(CIL))).expect("setup: NFD rename");
    let core2 = open_dirs(&root2, &fresh_dirs(&sb2, "Fresh"), false);
    let after = core2.backlinks_panel(CIL);
    assert_eq!(after.objects, 9, "badge 9 after the NFD rename");
    assert_eq!(sources(&after), sources(&before), "same sources");
    assert_eq!(group_keys(&after), group_keys(&before), "same groups");
}

fn tegg_nfd(s: &str) -> String {
    // Decompose the Czech letters used in the fixture (í, á, č, ě, ů, ř, š, ž, ý, é) without a normalization crate.
    s.chars()
        .flat_map(|c| match c {
            'í' => vec!['i', '\u{301}'],
            'á' => vec!['a', '\u{301}'],
            'é' => vec!['e', '\u{301}'],
            'ý' => vec!['y', '\u{301}'],
            'č' => vec!['c', '\u{30C}'],
            'ě' => vec!['e', '\u{30C}'],
            'ř' => vec!['r', '\u{30C}'],
            'š' => vec!['s', '\u{30C}'],
            'ž' => vec!['z', '\u{30C}'],
            'ů' => vec!['u', '\u{30A}'],
            c => vec![c],
        })
        .collect()
}
fn tegg_nfd_title(text: &str) -> String {
    text.replace("title: Rychlá poznámka", &format!("title: {}", tegg_nfd("Rychlá poznámka")))
}

#[test]
fn fr_lnk_01_ac12_panel_identical_after_index_rebuild() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let paths: Vec<String> = core.objects().into_iter().map(|o| nfc(&o.path)).collect();
    let first: BTreeMap<String, String> = paths.iter().map(|p| (p.clone(), format!("{:?}", core.backlinks_panel(p)))).collect();
    assert_eq!(core.backlinks_panel(CIL).objects, 9, "the panel query answers (Cíl: 9 objects)");
    drop(core);
    let core = open_dirs(&root, &fresh_dirs(&sb, "Rebuilt"), false);
    let mut bad = Vec::new();
    for p in &paths {
        let again = format!("{:?}", core.backlinks_panel(p));
        if first.get(p) != Some(&again) {
            bad.push(p.clone());
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "panel data (sources, groups, order, excerpts, labels, at) identical after a rebuild");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-02

#[test]
fn fr_lnk_02_ac4_attribute_keys_and_names_in_file_order() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let porada = entry(&p, PORADA).cloned();
    assert!(porada.is_some(), "Porada is listed");
    let o = porada.map(|e| e.occurrences).unwrap_or_default();
    let got: Vec<(OccurrenceKind, Option<String>, Option<String>, String)> =
        o.iter().map(|x| (x.kind, x.attribute.as_deref().map(nfc), x.attribute_name.as_deref().map(nfc), excerpt_text(x))).collect();
    let a = |k: &str, n: Option<&str>, t: &str| (OccurrenceKind::Attribute, Some(k.to_string()), n.map(|s| s.to_string()), t.to_string());
    assert_eq!(
        got,
        vec![
            a("téma", Some("Téma"), "Cíl"),
            a("poznámka", Some("Poznámka"), "Připravit Cíl předem"),
            a("description", None, "Souvisí s Cíl"),
            a("source", None, "Cíl"),
            (OccurrenceKind::Body, None, None, "Probrali jsme Cíl.".to_string()),
        ],
        "five occurrences, frontmatter first, in file order; universal keys have no schema Name (the UI uses the catalog)"
    );
    let starsi = entry(&p, STARSI).map(|e| e.occurrences.clone()).unwrap_or_default();
    assert_eq!(starsi.len(), 1, "one excerpt for the multiple relation");
    assert_eq!(starsi.first().map(excerpt_text).unwrap_or_default(), "Jana Nováková, Cíl", "all values joined with \", \"");
    assert_eq!(starsi.first().map(here_flags).unwrap_or_default(), vec![("Jana Nováková".to_string(), false), ("Cíl".to_string(), true)], "only the Cíl chip is here");
    assert_eq!(starsi.first().and_then(|o| o.attribute_name.clone()).map(|n| nfc(&n)).as_deref(), Some("Účastníci"));
    let bez = entry(&p, BEZ_TYPU).map(|e| e.occurrences.clone()).unwrap_or_default();
    assert_eq!(bez.iter().map(|o| (o.attribute.as_deref().map(nfc), o.attribute_name.clone())).collect::<Vec<_>>(), vec![(Some("související".to_string()), None)], "raw key, no Name");
}

#[test]
fn fr_lnk_02_ac5_embed_is_flagged_and_part_of_the_one_entry() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    // A `![[…]]` inside a property value is an attribute occurrence (D-257), not an embed.
    write_ext(&root, OSAMELA, &swap(&read(&root, OSAMELA), "title: Osamělá\n", "title: Osamělá\nsource: \"![[Cíl]]\"\n"));
    let core = open(&root, &sb, false);
    let p = core.backlinks_panel(CIL);
    let entries: Vec<&BacklinkEntry> = p.groups.iter().flat_map(|g| g.entries.iter()).filter(|e| nfc(&e.source) == RYCHLA).collect();
    assert_eq!(entries.len(), 1, "the embed counts toward the one entry");
    let kinds: Vec<OccurrenceKind> = entries[0].occurrences.iter().map(|o| o.kind).collect();
    assert_eq!(kinds.last(), Some(&OccurrenceKind::Embed), "the third excerpt is the embed: {kinds:?}");
    let osamela = entry(&p, OSAMELA).map(|e| e.occurrences.iter().map(|o| (o.kind, o.attribute.clone())).collect::<Vec<_>>()).unwrap_or_default();
    assert_eq!(osamela, vec![(OccurrenceKind::Attribute, Some("source".to_string()))], "![[…]] in a value is an attribute excerpt");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-04

fn plan_create(path: &str, title: &str, type_key: &str, rewrite: Option<&str>) -> LinkCreatePlan {
    LinkCreatePlan::Create { path: path.into(), title: title.into(), type_key: type_key.into(), rewrite: rewrite.map(|s| s.to_string()) }
}
/// The plan with a `rewrite` reduced to its link text (D-287 allows `Q3 plán|Q3: plán?` with or without `[[ ]]`).
fn bare(p: LinkCreatePlan) -> LinkCreatePlan {
    match p {
        LinkCreatePlan::Create { path, title, type_key, rewrite } => LinkCreatePlan::Create {
            path: nfc(&path),
            title: nfc(&title),
            type_key,
            rewrite: rewrite.map(|r| r.trim_start_matches("[[").trim_end_matches("]]").to_string()),
        },
        other => other,
    }
}

#[test]
fn fr_lnk_04_ac5_create_writes_one_file_and_re_resolves() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let plan = core.link_create_plan(ROZBITE, "Neexistuje", None);
    assert_eq!(bare(plan.clone()), plan_create("Quick Notes/Neexistuje.md", "Neexistuje", "quick-note", None), "the plan: default type Quick Note");
    let before = snapshot(&root);
    let made = core.link_create(ROZBITE, "Neexistuje", &plan, &new_bytes("quick-note", "Neexistuje"));
    assert!(made.is_ok(), "link_create: {made:?}");
    let made = made.unwrap_or_else(|_| unreachable!());
    assert_eq!(nfc(&made.path), "Quick Notes/Neexistuje.md");
    assert_eq!(made.rewrite, None);
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), strings(&["Quick Notes/Neexistuje.md"]), "exactly one new file; Rozbité odkazy and Další rozbitý keep bytes, mtime, inode");
    // Re-resolved before link_create returned.
    for t in ["Neexistuje", "neexistuje", "Neexistuje#Kapitola", "Neexistuje|jiný popis"] {
        assert_eq!(resolves_to(&core, ROZBITE, t).as_deref(), Some("Quick Notes/Neexistuje.md"), "{t} resolves now");
    }
    assert_eq!(sources(&core.backlinks_panel("Quick Notes/Neexistuje.md")), set(&[ROZBITE, DALSI]), "the new note's panel");
    assert_eq!(backlinks(&core, "Quick Notes/Neexistuje.md"), set(&[ROZBITE, DALSI]), "Core::backlinks agrees");
    assert!(!core.broken_links().groups.iter().any(|g| g.key == "neexistuje"), "no longer broken");
}

#[test]
fn fr_lnk_04_ac5_relation_with_to_creates_the_first_allowed_type() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let to = vec!["osoba".to_string()];
    let plan = core.link_create_plan(S_CHYBOU, "Chybějící osoba", Some(&to));
    assert_eq!(bare(plan.clone()), plan_create("Osoby/Chybějící osoba.md", "Chybějící osoba", "osoba", None), "D-243: Osoba, its folder");
    let made = core.link_create(S_CHYBOU, "Chybějící osoba", &plan, &new_bytes("osoba", "Chybějící osoba"));
    assert_eq!(made.map(|m| nfc(&m.path)).ok().as_deref(), Some("Osoby/Chybějící osoba.md"));
    assert!(read(&root, "Osoby/Chybějící osoba.md").contains("type: osoba\n"), "written with type: osoba");
}

#[test]
fn fr_lnk_04_ac6_title_and_stem_come_from_the_target_as_written() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let cases: [(&str, &str, &str); 6] = [
        ("Neexistuje#Kapitola", "Quick Notes/Neexistuje.md", "Neexistuje"),
        ("Neexistuje|jiný popis", "Quick Notes/Neexistuje.md", "Neexistuje"),
        ("neexistuje", "Quick Notes/neexistuje.md", "neexistuje"),
        ("Chybí", "Quick Notes/Chybí.md", "Chybí"),
        ("Nová věc.md", "Quick Notes/Nová věc.md", "Nová věc"),
        ("Nová věc", "Quick Notes/Nová věc.md", "Nová věc"),
    ];
    for (target, path, title) in cases {
        assert_eq!(bare(core.link_create_plan(ROZBITE, target, None)), plan_create(path, title, "quick-note", None), "target {target:?}");
    }
    // A target typed in NFD → NFC title and file name.
    let nfd = tegg_nfd("Nová věc");
    assert_eq!(bare(core.link_create_plan(ROZBITE, &nfd, None)), plan_create("Quick Notes/Nová věc.md", "Nová věc", "quick-note", None), "NFD target");
}

#[test]
fn fr_lnk_04_ac7_targets_that_are_not_file_names_get_a_rewrite() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let plan = core.link_create_plan(ROZBITE, "Q3: plán?", None);
    assert_eq!(bare(plan.clone()), plan_create("Quick Notes/Q3 plán.md", "Q3: plán?", "quick-note", Some("Q3 plán|Q3: plán?")), "D-52 → stem `Q3 plán`, link text `Q3 plán|Q3: plán?`");
    assert_eq!(bare(core.link_create_plan(ROZBITE, "CON", None)), plan_create("Quick Notes/CON_.md", "CON", "quick-note", Some("CON_|CON")), "reserved stem (D-80)");
    let long = "Velmi dlouhý název poznámky ".repeat(10).trim().to_string();
    assert!(long.len() > 200, "setup: over 200 UTF-8 bytes");
    let stem = tegg_format::sanitize_file_stem(&long);
    assert_eq!(bare(core.link_create_plan(ROZBITE, &long, None)), plan_create(&format!("Quick Notes/{stem}.md"), &long, "quick-note", Some(&format!("{stem}|{long}"))), "over 200 bytes (D-51)");
    let made = core.link_create(ROZBITE, "Q3: plán?", &plan, &new_bytes("quick-note", "Q3: plán?"));
    assert!(made.as_ref().map(|m| m.rewrite.is_some()).unwrap_or(false), "link_create returns the rewrite: {made:?}");
    assert!(read(&root, "Quick Notes/Q3 plán.md").contains("title: \"Q3: plán?\"\n"), "title kept in full");
    assert!(core.broken_links().groups.iter().any(|g| g.label == "Q3: plán?"), "the link in the file stays broken until the editor rewrites it");
}

#[test]
fn fr_lnk_04_ac8_targets_with_a_folder() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let alfa = core.link_create_plan(ROZBITE, "Projekty/Alfa", None);
    assert_eq!(bare(alfa.clone()), plan_create("Projekty/Alfa.md", "Alfa", "quick-note", None), "exact path, default type");
    assert_eq!(bare(core.link_create_plan(ROZBITE, "Osoby/Eva Malá", None)), plan_create("Osoby/Eva Malá.md", "Eva Malá", "osoba", None), "Osoby is Osoba's folder");
    for bad in [".trash/X", "_templates/X", ".tegg/X", "../X", ".skryté/X", "Ná:vrh/X", "Ot?zky/X"] {
        assert_eq!(core.link_create_plan(ROZBITE, bad, None), LinkCreatePlan::Forbidden { reason: CreateRefusal::Folder }, "{bad}: D-222 folder");
    }
    let before = snapshot(&root);
    let made = core.link_create(ROZBITE, "Projekty/Alfa", &alfa, &new_bytes("quick-note", "Alfa"));
    assert_eq!(made.map(|m| nfc(&m.path)).ok().as_deref(), Some("Projekty/Alfa.md"), "folder created");
    assert_eq!(changed(&before, &snapshot(&root)), strings(&["Projekty/", "Projekty/Alfa.md"]), "the folder and the file, nothing else");
    assert_eq!(resolves_to(&core, ROZBITE, "Projekty/Alfa").as_deref(), Some("Projekty/Alfa.md"), "resolves without a rewrite");
}

#[test]
fn fr_lnk_04_ac9_broken_links_are_exactly_twelve_in_three_objects() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let b = core.broken_links();
    // D-628 (6A, D-615): `[[Smazaná]]` resolves to the trash, so it isn't broken: 11 broken links in 3 objects.
    assert_eq!((b.occurrences, b.objects), (11, 3), "11 broken links in 3 objects");
    let groups: BTreeMap<String, (String, usize)> = b.groups.iter().map(|g| (nfc(&g.key), (nfc(&g.label), g.count))).collect();
    let want: BTreeMap<String, (String, usize)> = [
        ("neexistuje", "Neexistuje", 5),
        ("q3: plán?", "Q3: plán?", 1),
        ("projekty/alfa", "Projekty/Alfa", 1),
        ("osoby/eva malá", "Osoby/Eva Malá", 1),
        ("šablona", "Šablona", 1),
        ("chybí", "Chybí", 1),
        ("chybějící osoba", "Chybějící osoba", 1),
    ]
    .into_iter()
    .map(|(k, l, n)| (k.to_string(), (l.to_string(), n)))
    .collect();
    assert_eq!(groups, want, "one group per target key (NFC, case-insensitive), labelled with the most frequent spelling");
    let src = |key: &str| b.groups.iter().find(|g| g.key == key).map(|g| g.sources.iter().map(|e| nfc(&e.source)).collect::<BTreeSet<_>>()).unwrap_or_default();
    assert_eq!(src("neexistuje"), set(&[ROZBITE, DALSI]));
    assert_eq!(src("chybějící osoba"), set(&[S_CHYBOU]));
    for not in ["2026-10-09", "chybí.png", "cíl", "nikde", "šablonový cíl", "z koše", "smazaná"] {
        assert!(!groups.contains_key(not), "{not} is not broken or not counted");
    }
}

#[test]
fn fr_lnk_04_ac10_groups_order_and_create_plans() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let b = core.broken_links();
    assert_eq!(b.groups.first().map(|g| (g.key.clone(), g.count)), Some(("neexistuje".to_string(), 5)), "count descending: Neexistuje 5 first");
    assert!(b.groups.windows(2).all(|w| w[0].count >= w[1].count), "sorted by count descending");
    let plan = |key: &str| b.groups.iter().find(|g| g.key == key).map(|g| bare(g.create.clone()));
    assert_eq!(plan("chybějící osoba"), Some(plan_create("Osoby/Chybějící osoba.md", "Chybějící osoba", "osoba", None)), "every occurrence a relation value with `to`: the first allowed type");
    assert_eq!(plan("neexistuje"), Some(plan_create("Quick Notes/Neexistuje.md", "Neexistuje", "quick-note", None)), "else the default type");
    assert_eq!(plan("projekty/alfa"), Some(plan_create("Projekty/Alfa.md", "Alfa", "quick-note", None)));
}

#[test]
fn fr_lnk_04_ac11_a_file_created_meanwhile_is_never_overwritten() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, true);
    let plan = core.link_create_plan(ROZBITE, "Neexistuje", None);
    assert_eq!(bare(plan.clone()), plan_create("Quick Notes/Neexistuje.md", "Neexistuje", "quick-note", None), "the plan when the offer opens");
    // Another program creates the file after the offer opened.
    let theirs = "---\ntitle: Neexistuje\n---\nNapsal jiný program.\n".as_bytes();
    write_raw(&root, "Quick Notes/Neexistuje.md", theirs);
    let r = core.link_create(ROZBITE, "Neexistuje", &plan, &new_bytes("quick-note", "Neexistuje"));
    let d = format!("{r:?}");
    assert!(d.starts_with("Err(Exists") && d.contains("Quick Notes/Neexistuje.md"), "Exists {{ path }}: {d}");
    assert_eq!(std::fs::read(root.join("Quick Notes/Neexistuje.md")).unwrap_or_default(), theirs.to_vec(), "the other program's bytes are kept");
}

#[test]
fn fr_lnk_04_ac11_a_changed_plan_writes_nothing() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    // The offer was planned for another type than the core now plans.
    let stale = plan_create("Osoby/Neexistuje.md", "Neexistuje", "osoba", None);
    let before = snapshot(&root);
    let r = core.link_create(ROZBITE, "Neexistuje", &stale, &new_bytes("osoba", "Neexistuje"));
    let d = format!("{r:?}");
    assert!(d.starts_with("Err(PlanChanged") && d.contains("Quick Notes/Neexistuje.md"), "PlanChanged {{ now }} with the new plan: {d}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn fr_lnk_04_ac11_io_failure_writes_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let plan = core.link_create_plan(ROZBITE, "Neexistuje", None);
    let dir = root.join("Quick Notes");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).expect("setup: read-only folder");
    let before = snapshot(&root);
    let r = core.link_create(ROZBITE, "Neexistuje", &plan, &new_bytes("quick-note", "Neexistuje"));
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("setup: restore folder");
    let d = format!("{r:?}");
    assert!(d.starts_with("Err(") && d.contains("Io"), "an Io error: {d}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing else written");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-14

fn details(created: Option<&str>, preview: &[(&str, &str)], stem: Option<&str>) -> DuplicateDetails {
    DuplicateDetails {
        created: created.map(|s| s.to_string()),
        preview: preview.iter().map(|(k, v)| (k.to_string(), serde_json::Value::String(v.to_string()))).collect(),
        stem: stem.map(|s| s.to_string()),
    }
}
fn spm_details() -> [(&'static str, DuplicateDetails); 4] {
    [
        (SPM, details(Some("2026-09-01T10:00:00+02:00"), &[], None)),
        (SPM2, details(Some("2026-10-02T00:30:00+02:00"), &[], Some("Senior Product Manager (2)"))),
        (SPM_ALFA, details(Some("2026-10-03T09:00:00+02:00"), &[("firma", "Alfa s.r.o."), ("role", "Nábor")], Some("SPM Alfa"))),
        (SPM_VELKYMI, details(None, &[], Some("SPM velkými"))),
    ]
}

#[test]
fn fr_lnk_14_ac6_switcher_items_carry_duplicate_details() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let items = core.switcher("senior", 50);
    for (path, d) in spm_details() {
        let item = items.iter().find(|i| i.path.as_deref().map(nfc).as_deref() == Some(path));
        assert!(item.is_some(), "`senior` lists {path}");
        let dbg = format!("{:?}", item);
        let want = format!("duplicate: {:?}", Some(d));
        assert!(dbg.contains(&want), "{path}: switcher item carries {want}\n  got {dbg}");
    }
    let cil = core.switcher("Cíl", 10).into_iter().find(|i| i.path.as_deref().map(nfc).as_deref() == Some(CIL));
    assert!(format!("{cil:?}").contains("duplicate: None"), "a title nobody shares has no details: {cil:?}");
}

#[test]
fn fr_lnk_14_ac6_duplicate_titles_details_data() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let groups = core.duplicate_titles();
    let spm = groups.iter().find(|g| g.key == "senior product manager");
    assert!(spm.is_some(), "the Senior Product Manager group: {groups:?}");
    let got: BTreeMap<String, DuplicateDetails> = spm.map(|g| g.objects.iter().map(|o| (nfc(&o.path), o.details.clone())).collect()).unwrap_or_default();
    let want: BTreeMap<String, DuplicateDetails> = spm_details().into_iter().map(|(p, d)| (p.to_string(), d)).collect();
    assert_eq!(got, want, "created as written, up to 2 set preview values in preview order, the stem when it differs");
}

#[test]
fn fr_lnk_14_ac7_what_counts_as_a_duplicate() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let groups = core.duplicate_titles();
    let members = |key: &str| groups.iter().find(|g| g.key == key).map(|g| g.objects.iter().map(|o| nfc(&o.path)).collect::<BTreeSet<_>>());
    assert_eq!(members("senior product manager"), Some(set(&[SPM, SPM2, SPM_ALFA, SPM_VELKYMI])), "case folding, across types; Šablona and Smazaná don't count");
    assert_eq!(members("čtení"), Some(set(&[CTENI, CTENI2])), "NFC compare; Cteni isn't folded in");
    let all: BTreeSet<String> = groups.iter().flat_map(|g| g.objects.iter().map(|o| nfc(&o.path))).collect();
    for not in ["Pages/Cteni.md", "Pages/Plán.md", "Pages/Plán (conflicted copy 2026-10-07).md", SABLONA, SMAZANA] {
        assert!(!all.contains(not), "{not} is in no duplicate group (no diacritic folding; one object per id; templates and trash ignored)");
    }
    // Untyped files use their stem (D-103): a file without frontmatter named like a title joins the group.
    drop(core);
    write_ext(&root, "Pages/Cíl kopie/Cíl.md", "Bez hlavičky.\n");
    let core = open_dirs(&root, &fresh_dirs(&sb, "Again"), false);
    let cil = core.duplicate_titles().into_iter().find(|g| g.key == "cíl").map(|g| g.objects.iter().map(|o| nfc(&o.path)).collect::<BTreeSet<_>>());
    assert_eq!(cil, Some(set(&[CIL, "Pages/Cíl kopie/Cíl.md"])), "an untyped file's stem is its title");
}

#[test]
fn fr_lnk_14_ac8_groups_rows_folders_and_backlink_counts() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let groups = core.duplicate_titles();
    let spm = groups.iter().find(|g| g.key == "senior product manager").cloned();
    assert!(spm.is_some(), "the SPM group");
    let spm = spm.unwrap_or_else(|| unreachable!());
    assert_eq!(nfc(&spm.label), "Senior Product Manager", "labelled with the most frequent spelling");
    let rows: BTreeMap<String, (String, usize)> = spm.objects.iter().map(|o| (nfc(&o.path), (nfc(&o.folder), o.backlinks))).collect();
    let want: BTreeMap<String, (String, usize)> = [(SPM, "Pages", 1), (SPM2, "Pages", 1), (SPM_ALFA, "Osoby", 0), (SPM_VELKYMI, "Quick Notes", 0)]
        .into_iter()
        .map(|(p, f, n)| (p.to_string(), (f.to_string(), n)))
        .collect();
    assert_eq!(rows, want, "folder and number of objects linking to each");
    let cteni = groups.iter().find(|g| g.key == "čtení").map(|g| (nfc(&g.label), g.objects.len()));
    assert_eq!(cteni, Some(("Čtení".to_string(), 2)));
}

#[test]
fn fr_lnk_14_ac8_exactly_two_titles_shared_by_six_objects() {
    // FR-LNK-14 AC-8's summary `2 titles shared by 6 objects` on the fixture as the AC states it.
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let groups = core.duplicate_titles();
    let sizes: Vec<(String, usize)> = groups.iter().map(|g| (g.key.clone(), g.objects.len())).collect();
    assert_eq!(sizes, vec![("senior product manager".to_string(), 4), ("čtení".to_string(), 2)], "2 titles shared by 6 objects, size descending");
}

#[test]
fn fr_lnk_14_ac8_external_title_change_updates_the_group_within_2s() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, true);
    let size = |c: &Core| c.duplicate_titles().iter().find(|g| g.key == "senior product manager").map(|g| g.objects.len()).unwrap_or(0);
    assert_eq!(size(&core), 4, "before the change: 4 objects share the title");
    write_ext(&root, SPM_VELKYMI, &swap(&read(&root, SPM_VELKYMI), "title: SENIOR PRODUCT MANAGER", "title: Velký nábor"));
    assert!(wait_until(Duration::from_secs(2), || size(&core) == 3).is_some(), "3 within 2 s");
}

#[test]
fn fr_lnk_14_ac10_new_files_never_take_a_stem_in_use() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    let jana = ok!(core.create_object("quick-note", "Jana Nováková", &new_bytes("quick-note", "Jana Nováková")), "create_object Jana");
    assert_eq!(nfc(&jana), "Quick Notes/Jana Nováková (2).md", "a stem used in Osoby/ isn't taken (vault-wide, D-291)");
    assert!(read(&root, "Quick Notes/Jana Nováková (2).md").contains("title: Jana Nováková\n"), "title unchanged");
    assert_eq!(resolves_to(&core, CIL, "Jana Nováková").as_deref(), Some(JANA), "Cíl's link still resolves to Osoby/Jana Nováková.md");
    assert_eq!(resolves_to(&core, PORADA, "Jana Nováková").as_deref(), Some(JANA), "Porada's link too");
    assert_eq!(resolves_to(&core, STARSI, "Jana Nováková").as_deref(), Some(JANA), "Starší porada's link too");
    let dvojnik = ok!(core.create_object("quick-note", "Dvojník", &new_bytes("quick-note", "Dvojník")), "create_object Dvojník");
    assert_eq!(nfc(&dvojnik), "Quick Notes/Dvojník (2).md");
    let sablona = ok!(core.create_object("quick-note", "Šablona", &new_bytes("quick-note", "Šablona")), "create_object Šablona");
    assert_eq!(nfc(&sablona), "Quick Notes/Šablona.md", "template stems don't count");
    let page = ok!(core.create_object("page", "Rychlá poznámka", &new_bytes("page", "Rychlá poznámka")), "create_object page");
    assert_eq!(nfc(&page), "Pages/Rychlá poznámka (2).md", "a stem used in Quick Notes/ isn't taken by a Page either");
}

#[test]
fn fr_lnk_14_ac10_free_stem_is_vault_wide_nfc_and_case_insensitive() {
    let sb = sandbox();
    let root = backlinks_vault(&sb);
    let core = open(&root, &sb, false);
    assert_eq!(nfc(&core.free_stem("Quick Notes", "Jana Nováková")), "Jana Nováková (2)");
    assert_eq!(nfc(&core.free_stem("Quick Notes", "jana nováková")), "jana nováková (2)", "case-insensitive");
    assert_eq!(nfc(&core.free_stem("Quick Notes", &tegg_nfd("Jana Nováková"))), "Jana Nováková (2)", "NFC compare, NFC result");
    assert_eq!(nfc(&core.free_stem("Pages", "Smazaná")), "Smazaná", "trash stems don't count");
    assert_eq!(nfc(&core.free_stem("Projekty", "Nový")), "Nový", "a free stem is kept");
    // Create from a broken link uses the same rule: Šablona and Smazaná are free.
    assert_eq!(bare(core.link_create_plan(ROZBITE, "Šablona", None)), plan_create("Quick Notes/Šablona.md", "Šablona", "quick-note", None));
}
