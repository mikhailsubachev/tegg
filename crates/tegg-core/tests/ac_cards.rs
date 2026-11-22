//! Slice OC L4 tests on the core (docs/acceptance/cards.md; docs/contracts/v1-cards.md §1, §3, §13): the card list in
//! `TypeInfo.card` (FR-TYP-11 AC-5, AC-6), card data on board runs, Task rows and embeds against
//! tests/fixtures/vaults/cards/expected-card-data.json (AC-7…AC-17, AC-18, FR-EMB-02 AC-21), the live update of a card
//! list (AC-19), the type-file writes of `Core::type_patch` with `TypeOp::SetCard` / `SetAttributeIcon` (AC-21, AC-27,
//! AC-28's no-value path, FR-TYP-01 AC-12, AC-17, AC-19, FR-SYN-03 AC-33), `Core::type_card_example` (AC-25), the
//! duplicate details line (FR-LNK-14 AC-15), NFC (FR-FMT-12 AC-15), the kill harness (FR-SYN-02 AC-14) and NFR-POR-01
//! AC-7 (the written type files parse with the `yaml` npm package). The test clock is `2026-11-19T10:00:00+01:00`,
//! Europe/Prague, `en-US`. Compiles against the compile-only stubs of slice OC and uses only the contract's public
//! interface; `TypeFile.card` and `AttrDef.icon` are read through `Debug` (see ac_card_type_file.rs). Written from the
//! ACs, the fixtures and the contract only (D-61); every check is an assertion in this file.

mod cards_setup;
mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use cards_setup::*;
use common::{repo_root, sandbox, snapshot, wait_until, Entry};
use serde_json::{json, Value};
use tegg_core::cards::{is_empty_value, CardData};
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, LinkTarget, VaultError};
use tegg_schema::{CardList, TypeOp};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} answered {:?}", $what, e);
                unreachable!()
            }
        }
    };
}
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

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}
fn list(l: &[&str], default: bool) -> CardList {
    CardList { list: s(l), default, keys: s(l) }
}
fn card_of(core: &Core, key: &str) -> CardList {
    core.type_get(key).map(|t| t.card).unwrap_or_default()
}
fn base(core: &Core, key: &str) -> FileVersion {
    let t = some!(core.type_get(key), format!("type_get({key})"));
    some!(t.version, format!("type_get({key}).version"))
}
fn set_card(core: &Core, key: &str, keys: Option<&[&str]>) -> Result<(), CoreError> {
    let b = base(core, key);
    core.type_patch(key, Some(&b), &[TypeOp::SetCard(keys.map(s))]).map(|_| ())
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k) && !k.ends_with('/')).map(|k| tegg_format::nfc(k)).collect()
}
fn link_json(l: &LinkTarget, full: bool) -> Value {
    let kind = format!("{:?}", l.kind).to_lowercase();
    if full {
        json!({ "target": l.target, "kind": kind, "path": l.path, "title": l.title, "type": l.r#type })
    } else {
        json!({ "target": l.target, "kind": kind, "path": l.path })
    }
}
/// CardData as the corpus spells it (contract §3.2, §13).
fn card_json(c: &CardData) -> Value {
    json!({
        "type": c.r#type, "title": c.title, "keys": c.keys, "values": Value::Object(c.values.clone()), "excerpt": c.excerpt,
        "links": c.links.iter().map(|l| link_json(l, true)).collect::<Vec<_>>(), "unreviewed": c.unreviewed,
        "file": c.file.as_ref().map(|f| link_json(f, false)),
    })
}
fn rows_by_path(core: &Core, name: &str) -> BTreeMap<String, Option<CardData>> {
    run(core, name).rows.iter().map(|r| (tegg_format::nfc(&r.path), r.card.clone())).collect()
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-5

#[test]
fn fr_typ_11_ac5_default_card_lists() {
    let sb = sandbox();
    let root = vault(&sb);
    let before = snapshot(&root);
    let core = open(&root, &sb.dirs, false);
    let want: Vec<(&str, CardList)> = vec![
        ("book", list(&["tags", "body", "author", "status", "modified"], true)),
        ("autor", list(&["tags", "body", "poznámka", "modified"], true)),
        ("kontrola", list(&["tags", "body", "modified"], true)),
        ("page", list(&["tags", "body", "modified"], true)),
        ("task", list(&["tags", "body", "status", "due", "priority", "recurrence", "source"], true)),
        ("quick-note", list(&["body", "created"], true)),
        ("daily-note", list(&["body", "modified"], true)),
        ("image", list(&["width", "height", "size", "created"], true)),
        ("pdf", list(&["tags", "pages", "size", "created"], true)),
        ("tag", list(&["body", "modified"], true)),
        ("článek", list(&["body", "rubrika", "source", "created"], false)),
    ];
    let got: Vec<(&str, CardList)> = want.iter().map(|(k, _)| (*k, card_of(&core, k))).collect();
    assert_eq!(got, want, "type_get returns each type's card list and whether it is the default (R210)");
    let v = card_of(&core, "výlet");
    assert_eq!((v.list.len(), v.default, v.keys.len()), (12, false, 11), "Výlet: its card: as written, 11 effective keys");
    let all: Vec<(String, CardList)> = core.types().into_iter().map(|t| (t.key.clone(), t.card.clone())).collect();
    assert!(all.iter().all(|(_, c)| !c.list.is_empty() || c.default), "vault_types carries every card list: {all:?}");
    // Drawing writes no type file: boards, the seven-type board, Karty's embeds, every type.
    drop(core);
    add_seven(&root);
    let before = { let mut b = before; b.extend(snapshot(&root).into_iter().filter(|(k, _)| k.contains("Sedm"))); b };
    let core = open(&root, &sb.dirs, false);
    for q in [STAV_Q, "Rozečtené", SEVEN] {
        let _ = run(&core, q);
    }
    let _ = core.embed_load(&s(&[SNEZKA, UCETNI, CHATY, VYHLIDKA, PRAVIDLA]));
    for t in core.types() {
        let _ = core.type_get(&t.key);
        let _ = core.type_card_example(&t.key);
    }
    let types_changed: Vec<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| p.starts_with(".tegg/types/")).collect();
    assert_eq!(types_changed, Vec::<String>::new(), "no .tegg/types/*.yml changes bytes, mtime or inode");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-6

#[test]
fn fr_typ_11_ac6_card_key_is_read() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let rows = rows_by_path(&core, STAV_Q);
    let sn = some!(rows.get(SNEZKA).cloned().flatten(), "Sněžka's card on Výlety podle stavu");
    assert_eq!(sn.keys, s(&["tags", "description", "stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "modified"]), "the card's effective keys");
    assert!(!sn.values.contains_key("neznámý-klíč") && !sn.values.contains_key("poznámka"), "neither the unknown key nor poznámka is read");
    // The index rebuilt from the files gives the same card data (AR-01).
    let fresh = common::fresh_dirs(&sb, "Rebuilt");
    let again = open(&root, &fresh, false);
    assert_eq!(rows_by_path(&again, STAV_Q), rows, "the same card data after the index is deleted and rebuilt");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-7…AC-17

#[test]
fn fr_typ_11_ac7_the_parts_of_a_card() {
    let sb = sandbox();
    let root = vault(&sb);
    add_seven(&root);
    let core = open(&root, &sb.dirs, false);
    let want = expected_cards();
    let want = some!(want["cards"].as_object(), "expected-card-data.json `cards`");
    let mut bad = Vec::new();
    let mut seen = 0usize;
    for q in [SEVEN, STAV_Q, "Rozečtené"] {
        let r = run(&core, q);
        assert!(!r.rows.is_empty(), "{q} has rows");
        for row in &r.rows {
            let p = tegg_format::nfc(&row.path);
            let Some(w) = want.get(&p) else { continue };
            seen += 1;
            match &row.card {
                None => bad.push(format!("{q} {p}: no card data")),
                Some(c) if card_json(c) != *w => bad.push(format!("{q} {p}:\n got  {}\n want {}", card_json(c), w)),
                _ => {}
            }
        }
    }
    assert!(seen >= 20, "the boards hold the corpus's objects ({seen})");
    assert!(bad.is_empty(), "card data per contract §3.2 (expected-card-data.json):\n{}", bad.join("\n"));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-18, FR-EMB-02 AC-21

#[test]
fn fr_typ_11_ac18_one_read_per_list() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, STAV_Q);
    let row = some!(r.rows.iter().find(|x| tegg_format::nfc(&x.path) == SNEZKA), "Sněžka on Výlety podle stavu");
    let c = some!(row.card.clone(), "QueryRow.card on a board run");
    assert_eq!(c.values.len(), 11, "card.values holds 11 entries: {:?}", c.values.keys().collect::<Vec<_>>());
    assert_eq!(c.excerpt, None, "no body on Výlet's card: no excerpt read");
    assert_eq!(row.excerpt, "", "the row's own excerpt stays a string (D-1999)");
    assert_eq!(c.links.iter().map(|l| (l.target.clone(), l.path.clone())).collect::<Vec<_>>(), vec![("Eva Lindová".to_string(), Some("Autoři/Eva Lindová.md".to_string()))], "card.links holds Eva Lindová, resolved");
    // A Table run carries no card (v1-views §24.4).
    let t = run(&core, "Přečtené 2026");
    assert!(!t.rows.is_empty() && t.rows.iter().all(|r| r.card.is_none()), "Přečtené 2026 (a Table) has no card data");
    // Rozečtené's books carry the excerpt (body on Book's default list).
    let roz = run(&core, "Rozečtené");
    let u = some!(roz.rows.iter().find(|x| tegg_format::nfc(&x.path) == UCETNI).and_then(|x| x.card.clone()), "Účetní ze Žižkova's card");
    assert_eq!(u.excerpt.as_deref(), Some("Kriminálka z kanceláře nad hospodou."), "the excerpt when body is effective");
}

#[test]
fn fr_emb_02_ac21_card_embeds_load_in_one_batch() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let want = expected_cards();
    let notes = core.embed_load(&s(&[SNEZKA, UCETNI, CHATY, VYHLIDKA, PRAVIDLA]));
    assert_eq!(notes.len(), 5, "one batch of five");
    let mut bad = Vec::new();
    for n in &notes {
        let p = tegg_format::nfc(&n.path);
        match &n.card {
            None => bad.push(format!("{p}: EmbedNote.card is None")),
            Some(c) if card_json(c) != want["cards"][&p] => bad.push(format!("{p}: {}", card_json(c))),
            _ => {}
        }
    }
    assert!(bad.is_empty(), "every card embed carries its card data in the batch:\n{}", bad.join("\n"));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-19

#[test]
fn fr_typ_11_ac19_cards_follow_changes() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let before = snapshot(&root);
    // Another program adds card: to book.yml.
    let book = fixture(BOOK);
    write(&root, BOOK, swapped(&book, "preview: [author, status]\n", "preview: [author, status]\ncard: [tags, kraj]\n").as_bytes());
    let followed = wait_until(Duration::from_secs(2), || card_of(&core, "book").list == s(&["tags", "kraj"]));
    assert!(followed.is_some(), "book.yml's new card: is read within 2 s (vault:changed): {:?}", card_of(&core, "book"));
    // Removing card: from výlet.yml gives its default from preview.
    write(&root, VYLET, swapped(&fixture(VYLET), "card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n", "").as_bytes());
    let def = wait_until(Duration::from_secs(2), || card_of(&core, "výlet") == list(&["tags", "body", "stav", "kraj", "modified"], true));
    assert!(def.is_some(), "the default `tags, body, stav, kraj, modified` within 2 s");
    let sn = rows_by_path(&core, STAV_Q).get(SNEZKA).cloned().flatten();
    assert_eq!(sn.map(|c| (c.keys, c.excerpt)), Some((s(&["tags", "body", "stav", "kraj", "modified"]), Some("Z Pece přes Obří důl na vrchol a zpět lanovkou.".to_string()))), "Sněžka then shows its body");
    let written: Vec<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| p != BOOK && p != VYLET).collect();
    assert_eq!(written, Vec::<String>::new(), "Tegg writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-21

#[test]
fn fr_typ_11_ac21_changing_the_card_writes_only_card() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let ino0 = stamp(&root, BOOK).map(|x| x.2);
    ok!(set_card(&core, "book", Some(&["body", "author", "status", "modified"])), "Remove Tags");
    let want = swapped(&fixture(BOOK), "preview: [author, status]\n", "preview: [author, status]\ncard: [body, author, status, modified]\n");
    assert_eq!(disk_s(&root, BOOK), Some(want), "(a) one line inserted after line 11, every other byte unchanged");
    assert_ne!(stamp(&root, BOOK).map(|x| x.2), ino0, "written through a temporary file (new inode, FR-SYN-02)");
    assert_eq!(changed(&before, &snapshot(&root)), vec![BOOK.to_string()], "only book.yml is written; no note");
    assert_eq!(card_of(&core, "book"), list(&["body", "author", "status", "modified"], false), "the core's card list follows the write");
    // (e) five quick changes, each on the previous result: five writes, the same end bytes.
    let seq: [&[&str]; 5] = [&["author", "status", "modified"], &["status", "modified"], &["modified"], &["modified", "author"], &["author"]];
    for k in seq {
        ok!(set_card(&core, "book", Some(k)), format!("SetCard {k:?}"));
    }
    assert_eq!(disk_s(&root, BOOK), Some(swapped(&fixture(BOOK), "preview: [author, status]\n", "preview: [author, status]\ncard: [author]\n")), "(e) the final bytes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-25

#[test]
fn fr_typ_11_ac25_the_example_card() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, ".tegg/types/prázdný.yml", "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Prázdný\nplural: Prázdné\nsystem: false\nfolder: Prázdné\nicon: file-text\ncolor: gray\nreview: false\nattributes: []\n".as_bytes());
    let core = open(&root, &sb.dirs, false);
    let ex = some!(core.type_card_example("výlet"), "type_card_example(výlet)");
    assert_eq!(ex.path, SNEZKA, "the most recently modified Výlet");
    assert_eq!(ex.card.keys, s(&["stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "poznámka", "tags", "body", "description", "source", "aliases", "created", "modified"]), "every candidate key: attributes in schema order, then CARD_BUILT_INS");
    assert_eq!(ex.card.excerpt.as_deref(), Some("Z Pece přes Obří důl na vrchol a zpět lanovkou."), "the excerpt is always read");
    assert_eq!(core.type_card_example("článek").map(|e| e.path), Some(BEZ.to_string()), "Článek: Bez zdroje");
    assert_eq!(core.type_card_example("prázdný"), None, "no object: None");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-27

#[test]
fn fr_typ_11_ac27_failures_and_system_types() {
    let sb = sandbox();
    let root = vault(&sb);
    std::fs::remove_file(root.join(".tegg/types/task.yml")).expect("setup: no task.yml");
    let core = open(&root, &sb.dirs, false);
    // (a) Conflict: changed on disk since it was read.
    let stale = base(&core, "výlet");
    write(&root, VYLET, swapped(&fixture(VYLET), "color: teal\n", "color: blue\n").as_bytes());
    let before = snapshot(&root);
    let r = core.type_patch("výlet", Some(&stale), &[TypeOp::SetCard(Some(s(&["kraj"])))]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "(a) Conflict, got {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "(a) nothing written");
    // (b) Missing system file: new-empty's task.yml plus one line.
    ok!(core.type_patch("task", None, &[TypeOp::SetCard(Some(s(&["tags", "body", "status", "due", "priority", "source"])))]), "(b) remove Recurrence from Task's card");
    let want = swapped(&fixture(".tegg/types/task.yml"), "preview: [status, priority, due]\n", "preview: [status, priority, due]\ncard: [tags, body, status, due, priority, source]\n");
    assert_eq!(disk_s(&root, ".tegg/types/task.yml"), Some(want), "(b) the file is created with the line (D-90)");
    // (c) Page: its card line only.
    let before = snapshot(&root);
    ok!(set_card(&core, "page", Some(&["body", "modified"])), "(c) Page's card");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/page.yml".to_string()], "(c) only page.yml");
    assert!(disk_s(&root, ".tegg/types/page.yml").is_some_and(|t| t.contains("preview: []\ncard: [body, modified]\n")), "(c) after preview");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-28

#[test]
fn fr_typ_11_ac28_kept_consistent_with_schema_changes() {
    let sb = sandbox();
    let root = vault(&sb);
    // The no-value path (type-moves.md FR-TYP-04 AC-6): no object holds kraj.
    for p in [SNEZKA, PALAVA] {
        let t = fixture(p);
        let line = t.lines().find(|l| l.starts_with("kraj:")).map(|l| format!("{l}\n")).unwrap_or_default();
        write(&root, p, swapped(&t, &line, "").as_bytes());
    }
    write(&root, VYLET, swapped(&fixture(VYLET), "preview: [stav, kraj]\n", "preview: [stav, kraj]\nhidden: [kraj]\ncolumns: [kraj, stav]\n").as_bytes());
    let core = open(&root, &sb.dirs, false);
    let b = base(&core, "výlet");
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::RemoveAttribute("kraj".into())]), "delete Kraj");
    let t = disk_s(&root, VYLET).unwrap_or_default();
    assert!(t.contains("card: [tags, description, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n"), "kraj leaves card: in the same write: {t}");
    assert!(t.contains("preview: [stav]\n") && t.contains("hidden: []\n") && t.contains("columns: [stav]\n") && !t.contains("key: kraj"), "and leaves preview, hidden, columns and the item");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-12, AC-17

#[test]
fn fr_typ_01_ac12_icon_on_an_attribute() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let info = some!(core.type_get("výlet"), "type_get(výlet)");
    let dbg: Vec<(String, String)> = info.def.attributes.iter().map(|a| (a.key.clone(), format!("{a:?}"))).collect();
    for (k, want) in [("stav", "icon: Some(\"circle-dot\")"), ("délka", "icon: Some(\"ikona-ktera-neexistuje\")"), ("náročnost", "icon: None")] {
        let d = dbg.iter().find(|(x, _)| x == k).map(|(_, d)| d.clone()).unwrap_or_default();
        assert!(d.contains(want), "type_get: {k}'s icon as written ({want}): {d}");
    }
    let before = snapshot(&root);
    let b = base(&core, "výlet");
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::SetAttributeIcon { key: "náročnost".into(), icon: Some("mountain".into()) }]), "mountain for Náročnost");
    let naro = "    name: Náročnost\n    type: select\n";
    assert_eq!(disk_s(&root, VYLET), Some(swapped(&fixture(VYLET), naro, &format!("{naro}    icon: mountain\n"))), "one line after the item's type line");
    assert_eq!(changed(&before, &snapshot(&root)), vec![VYLET.to_string()], "only výlet.yml");
}

#[test]
fn fr_typ_01_ac17_choosing_writes_one_line() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let b = base(&core, "výlet");
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::SetAttributeIcon { key: "kraj".into(), icon: Some("mountain".into()) }]), "mountain for Kraj");
    assert_eq!(disk_s(&root, VYLET), Some(swapped(&fixture(VYLET), "    icon: map-pin\n", "    icon: mountain\n")), "the property icon line");
    let b = base(&core, "výlet");
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::SetIcon("tent".into())]), "tent from General");
    let want = swapped(&swapped(&fixture(VYLET), "    icon: map-pin\n", "    icon: mountain\n"), "icon: map\n", "icon: tent\n");
    assert_eq!(disk_s(&root, VYLET), Some(want), "only icon: map → icon: tent");
    let t = some!(core.type_get("výlet"), "type_get");
    assert_eq!((t.icon.as_str(), tegg_schema::icons::resolve_icon(&t.icon).map(|r| r.name)), ("tent", Some("tent")), "the core's type icon follows and resolves");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-19

#[test]
fn fr_typ_01_ac19_old_names_keep_drawing() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let k0 = stamp(&root, KONTROLA);
    let _ = run(&core, "Rozečtené");
    let b = base(&core, "kontrola");
    ok!(core.type_patch("kontrola", Some(&b), &[TypeOp::SetIcon("square-check-big".into())]), "choosing square-check-big");
    assert_eq!(stamp(&root, KONTROLA), k0, "kontrola.yml is never rewritten: bytes, mtime and inode");
    let b = base(&core, "kontrola");
    ok!(core.type_patch("kontrola", Some(&b), &[TypeOp::SetCard(Some(s(&["body"])))]), "a card change");
    assert!(disk_s(&root, KONTROLA).is_some_and(|t| t.contains("\nicon: check-square\n") && t.contains("review: false\ncard: [body]\n")), "the icon line stays byte for byte");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-14 AC-15

#[test]
fn fr_lnk_14_ac15_details_from_the_card_list() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, "Pages/Sněžka z Pece.md", b"---\ntype: page\ntitle: Sn\xc4\x9b\xc5\xbeka z Pece\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\nStr\xc3\xa1nka.\n");
    let core = open(&root, &sb.dirs, true);
    let details = |core: &Core| -> Vec<(String, Value)> {
        core.duplicate_titles().into_iter().flat_map(|g| g.objects).find(|o| tegg_format::nfc(&o.path) == SNEZKA).map(|o| o.details.preview).unwrap_or_default()
    };
    assert_eq!(details(&core), vec![("stav".to_string(), json!("Hotový")), ("náročnost".to_string(), json!("Střední"))], "the first two set pill values of Výlet's card list");
    ok!(set_card(&core, "výlet", Some(&["kraj", "stav"])), "card: [kraj, stav]");
    let follows = wait_until(Duration::from_secs(2), || details(&core) == vec![("kraj".to_string(), json!("Královéhradecký")), ("stav".to_string(), json!("Hotový"))]);
    assert!(follows.is_some(), "after card: [kraj, stav]: Královéhradecký, Hotový within 2 s: {:?}", details(&core));
    let sw = core.switcher("Sněžka", 10);
    assert!(format!("{sw:?}").contains("Královéhradecký"), "the switcher's duplicate details use the same values: {sw:?}");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-15

#[test]
fn fr_fmt_12_ac15_card_keys_and_icon_names_are_nfc() {
    let sb = sandbox();
    let root = vault(&sb);
    write(&root, VYLET, swapped(&fixture(VYLET), "  - key: náročnost\n", &format!("  - key: {}\n", nfd("náročnost"))).as_bytes());
    write(&root, SNEZKA, swapped(&fixture(SNEZKA), "Z Pece", &format!("#{} Z Pece", nfd("rodina"))).as_bytes());
    let core = open(&root, &sb.dirs, false);
    let sn = some!(rows_by_path(&core, STAV_Q).get(SNEZKA).cloned().flatten(), "Sněžka's card");
    assert_eq!(sn.values.get("náročnost"), Some(&json!("Střední")), "an NFD attribute key with its NFC value in Sněžka draws the pill");
    assert_eq!(sn.values.get("tags"), Some(&json!(["hory", "zima", "rodina", "výhled"])), "an NFD #rodina counts as rodina, once");
    ok!(set_card(&core, "výlet", Some(&[&nfd("náročnost"), &nfd("kraj")])), "an NFD card write");
    assert!(disk_s(&root, VYLET).is_some_and(|t| t.contains("card: [náročnost, kraj]\n")), "written NFC");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-33

#[test]
fn fr_syn_03_ac33_card_and_icon_writes_check_the_base() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let ops: Vec<(&str, TypeOp)> = vec![
        ("Card remove", TypeOp::SetCard(Some(s(&["tags"])))),
        ("Reset", TypeOp::SetCard(None)),
        ("property icon", TypeOp::SetAttributeIcon { key: "kraj".into(), icon: Some("mountain".into()) }),
        ("None", TypeOp::SetAttributeIcon { key: "kraj".into(), icon: None }),
        ("type icon", TypeOp::SetIcon("tent".into())),
    ];
    for (what, op) in ops {
        let stale = base(&core, "výlet");
        let other = swapped(&disk_s(&root, VYLET).unwrap_or_default(), "description: ", "description: Jinak. ");
        write(&root, VYLET, other.as_bytes());
        let r = core.type_patch("výlet", Some(&stale), &[op]);
        assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "{what}: Conflict, got {r:?}");
        assert_eq!(disk_s(&root, VYLET), Some(other), "{what}: nothing written");
        reread(&core, &[VYLET]);
    }
    // Same bytes, only a new mtime: no conflict (D-175).
    let b = base(&core, "výlet");
    let same = disk_s(&root, VYLET).unwrap_or_default();
    std::thread::sleep(Duration::from_millis(20));
    write(&root, VYLET, same.as_bytes());
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::SetCard(Some(s(&["kraj"])))]), "a touched file is no conflict");
    assert!(disk_s(&root, VYLET).is_some_and(|t| t.contains("\ncard: [kraj]\n")), "the card line is written");
}

// ------------------------------------------------------------------------------------------------ NFR-POR-01 AC-7

#[test]
fn nfr_por_01_ac7_type_files_with_card_are_plain() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    ok!(set_card(&core, "book", Some(&["body", "author"])), "book card");
    let b = base(&core, "výlet");
    ok!(core.type_patch("výlet", Some(&b), &[TypeOp::SetAttributeIcon { key: "náročnost".into(), icon: Some("mountain".into()) }]), "an icon");
    let files = [BOOK, VYLET];
    let script = r#"const fs=require('fs');const Y=require(process.argv[1]);const out={};for(const p of process.argv.slice(3)){out[p.split(process.argv[2]+'/')[1]]=Y.parse(fs.readFileSync(p,'utf8'));}console.log(JSON.stringify(out));"#;
    let yaml = repo_root().join("app/node_modules/yaml");
    let out = Command::new("node")
        .arg("-e").arg(script).arg(yaml.to_string_lossy().to_string()).arg(root.to_string_lossy().to_string())
        .args(files.iter().map(|f| root.join(f).to_string_lossy().to_string()))
        .stderr(Stdio::inherit()).output();
    let out = ok!(out, "node runs");
    let v: Value = ok!(serde_json::from_slice(&out.stdout), "the yaml package parses every written type file");
    assert_eq!(v[BOOK]["card"], json!(["body", "author"]), "card is a list of strings");
    let naro = v[VYLET]["attributes"].as_array().and_then(|a| a.iter().find(|x| x["key"] == "náročnost").cloned()).unwrap_or(Value::Null);
    assert_eq!(naro["icon"], json!("mountain"), "icon is a string");
    let notes: Vec<String> = changed(&before, &snapshot(&root)).into_iter().filter(|p| !p.starts_with(".tegg/types/")).collect();
    assert_eq!(notes, Vec::<String>::new(), "no object file is written");
}

// ------------------------------------------------------------------------------------------------ the empty rule (§3.2)

#[test]
fn fr_typ_11_ac8_empty_values_draw_nothing() {
    let corpus: Value = serde_json::from_str(&std::fs::read_to_string(repo_root().join("tests/fixtures/types/card-empty.json")).expect("setup: card-empty.json")).expect("setup: JSON");
    let bad: Vec<String> = corpus.as_array().cloned().unwrap_or_default().iter().filter(|c| is_empty_value(&c["value"]) != c["empty"].as_bool().unwrap_or(false)).map(|c| c.to_string()).collect();
    assert!(bad.is_empty(), "cards::is_empty_value follows R212's last row (card-empty.json): {bad:?}");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-14

const KILL_TEST: &str = "fr_syn_02_ac14_card_and_icon_writes_are_atomic";
const KILL_CYCLES: usize = 200;

fn kill_child(root: &Path, app: &Path, ready: &Path, kind: &str) -> ! {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    let mut i = 0usize;
    while start.elapsed() < Duration::from_secs(20) {
        i += 1;
        let (key, op) = match kind {
            "card" => ("book", TypeOp::SetCard(Some(if i % 2 == 1 { s(&["body", "author", "status", "modified"]) } else { s(&["author", "status", "modified"]) }))),
            _ => ("výlet", TypeOp::SetAttributeIcon { key: "náročnost".into(), icon: if i % 2 == 1 { Some("mountain".into()) } else { None } }),
        };
        let Some(v) = core.type_get(key).and_then(|t| t.version) else { std::process::exit(3) };
        if core.type_patch(key, Some(&v), &[op]).is_err() {
            std::fs::write(ready.with_extension("failed"), b"type_patch failed").ok();
            std::process::exit(3)
        }
    }
    std::process::exit(0)
}

#[test]
fn fr_syn_02_ac14_card_and_icon_writes_are_atomic() {
    if let Ok(dir) = std::env::var("TEGG_CARDS_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_CARDS_KILL_READY").expect("setup: ready path"));
        let kind = std::env::var("TEGG_CARDS_KILL_KIND").expect("setup: kind");
        kill_child(&dir.join("vault"), &dir.join("app"), &ready, &kind);
    }
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = vault(&sb);
    std::fs::create_dir_all(&work).expect("setup: work dir");
    std::fs::rename(&root, work.join("vault")).expect("setup: move the vault");
    let root = work.join("vault");
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let book = fixture(BOOK);
    let vylet = fixture(VYLET);
    let naro = "    name: Náročnost\n    type: select\n";
    let cases: Vec<(&str, &str, Vec<String>)> = vec![
        ("card", BOOK, vec![book.clone(), swapped(&book, "preview: [author, status]\n", "preview: [author, status]\ncard: [body, author, status, modified]\n"), swapped(&book, "preview: [author, status]\n", "preview: [author, status]\ncard: [author, status, modified]\n")]),
        ("icon", VYLET, vec![vylet.clone(), swapped(&vylet, naro, &format!("{naro}    icon: mountain\n"))]),
    ];
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x4f43_4341_5244_53;
    let mut bad: Vec<String> = Vec::new();
    for (kind, rel, allowed) in &cases {
        let mut wrote = 0usize;
        for cycle in 0..KILL_CYCLES {
            std::fs::write(root.join(rel), &allowed[0]).expect("setup: restore the file");
            let ready = work.join(format!("ready-{kind}-{cycle}"));
            let mut child = Command::new(&exe)
                .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
                .env("TEGG_CARDS_KILL_CHILD", &work)
                .env("TEGG_CARDS_KILL_READY", &ready)
                .env("TEGG_CARDS_KILL_KIND", kind)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("setup: spawn the writer");
            let deadline = Instant::now() + Duration::from_secs(20);
            while !ready.exists() && Instant::now() < deadline && child.try_wait().ok().flatten().is_none() {
                std::thread::sleep(Duration::from_micros(300));
            }
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            std::thread::sleep(Duration::from_micros(200 + seed % 3000));
            let _ = child.kill();
            let _ = child.wait();
            if ready.with_extension("failed").exists() {
                bad.push(format!("{kind} cycle {cycle}: the writer failed"));
            }
            let now = String::from_utf8(std::fs::read(root.join(rel)).unwrap_or_default()).unwrap_or_default();
            if now != allowed[0] {
                wrote += 1;
            }
            if !allowed.contains(&now) {
                bad.push(format!("{kind} cycle {cycle}: torn or unexpected file ({} bytes)", now.len()));
            }
            for e in std::fs::read_dir(root.join(".tegg/types")).map(|rd| rd.flatten().collect::<Vec<_>>()).unwrap_or_default() {
                if e.file_name().to_string_lossy().contains("tegg-tmp") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
            if bad.len() > 10 {
                break;
            }
        }
        if wrote == 0 {
            bad.push(format!("{kind}: the writer never committed a change"));
        }
    }
    // A leftover temp file is never read as a type.
    write(&root, ".tegg/types/.book.yml.4242.tegg-tmp", b"version: 1\nname: Polovina\n");
    let core = open(&root, &sb.dirs, false);
    if core.types().iter().any(|t| t.key.contains("tegg-tmp") || t.name == "Polovina") {
        bad.push("a temp file is read as a type".into());
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill each type file is its complete old or new bytes");
}
