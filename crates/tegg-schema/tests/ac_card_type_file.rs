//! Slice OC, `tegg-schema` side (L4 and L2): docs/acceptance/cards.md FR-TYP-11 AC-5, AC-6 (the card list, R209, R210),
//! AC-21, AC-23, AC-24, AC-26, AC-27, AC-28 (the bytes of the `card` line), FR-TYP-01 AC-12, AC-17, AC-19 (an attribute's
//! `icon:` line, the type icon, old names), AR-07 AC-11, FR-FMT-07 AC-36 (with the L2 property), FR-FMT-12 AC-15. BRD
//! D-2054, D-2059, D-2060, D-2067, D-2070, D-2076…D-2079, D-2097, D-2099, D-2103. Interface docs/contracts/v1-cards.md
//! §2.1…§2.4 (`card_list`, `Parsed.card_unreadable`, `Parsed.card_ignored`, `TypeOp::SetCard`,
//! `TypeOp::SetAttributeIcon`, `RuleError::CardUnreadable`, `icons::resolve_icon`, TOP order `… preview, card, hidden,
//! columns, views …`, ITEM order `key, name, type, icon, …`) and the corpus tests/fixtures/types/card-lists.json.
//! Written from the ACs and the contract only (D-61). Fixtures are read-only; runtime variants are made in memory.
//!
//! `TypeFile.card` and `AttrDef.icon` are read through the definition's `Debug` text: struct literals of `TypeFile` and
//! `AttrDef` in existing AC tests keep the red commit from adding the fields as stubs (as ac_type_columns.rs did).

use std::path::PathBuf;

use serde_json::Value;
use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
fn cards(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/cards/.tegg/types/{key}.yml"))
}
fn views(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/views/.tegg/types/{key}.yml"))
}
fn new_empty(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/new-empty/.tegg/types/{key}.yml"))
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "setup: fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}
/// The NFD spelling of the fixtures' Czech letters (no Unicode tables in the test crate).
fn nfd(t: &str) -> String {
    let mut out = String::new();
    for c in t.chars() {
        let (b, m) = match c {
            'á' => ('a', '\u{301}'),
            'é' => ('e', '\u{301}'),
            'í' => ('i', '\u{301}'),
            'ý' => ('y', '\u{301}'),
            'ú' => ('u', '\u{301}'),
            'č' => ('c', '\u{30C}'),
            'ě' => ('e', '\u{30C}'),
            'ř' => ('r', '\u{30C}'),
            'š' => ('s', '\u{30C}'),
            'ž' => ('z', '\u{30C}'),
            'ů' => ('u', '\u{30A}'),
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

const NAMES: [(&str, &str, &str); 12] = [
    ("page", "Page", "Pages"),
    ("task", "Task", "Tasks"),
    ("quick-note", "Quick Note", "Quick Notes"),
    ("daily-note", "Daily Note", "Daily"),
    ("tag", "Tag", "Tags"),
    ("image", "Image", "Images"),
    ("pdf", "PDF", "PDFs"),
    ("výlet", "Výlet", "Výlety"),
    ("článek", "Článek", "Články"),
    ("kontrola", "Kontrola", "Kontroly"),
    ("book", "Book", "Books"),
    ("autor", "Autor", "Autoři"),
];
fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others: Vec<TypeNames> = NAMES.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == key }).collect();
    patch(key, text, &ops, &PatchContext { others: &others })
}
fn set_card(keys: &[&str]) -> TypeOp {
    TypeOp::SetCard(Some(s(keys)))
}
fn icon(key: &str, name: Option<&str>) -> TypeOp {
    TypeOp::SetAttributeIcon { key: key.to_string(), icon: name.map(str::to_string) }
}

const VYLET_CARD: &str = "card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n";
const BOOK_PREVIEW: &str = "preview: [author, status]\n";
fn vylet() -> String {
    cards("výlet")
}
fn vylet_card(line: &str) -> String {
    swap(&vylet(), VYLET_CARD, line)
}
/// The `Debug` spelling of `TypeFile.card` (contract §2.1).
fn card_debug(keys: Option<&[&str]>) -> String {
    match keys {
        None => "card: None".to_string(),
        Some(k) => format!("card: Some({:?})", s(k)),
    }
}
fn reads_card(key: &str, text: &str, keys: Option<&[&str]>) -> (bool, String) {
    let dbg = format!("{:?}", parse(key, text).def);
    let want = card_debug(keys);
    (dbg.contains(&format!("{want},")) || dbg.contains(&format!("{want} }}")), dbg)
}
/// Whether the `Debug` text of attribute `attr` holds `icon: <want>` (contract §2.1 `AttrDef.icon`).
fn attr_icon_debug(text: &str, key: &str, attr: &str) -> String {
    let def = parse(key, text).def;
    def.attributes.iter().find(|a| a.key == attr).map(|a| format!("{a:?}")).unwrap_or_default()
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-5

#[test]
fn fr_typ_11_ac5_default_card_lists() {
    let corpus: Value = serde_json::from_str(&read("tests/fixtures/types/card-lists.json")).expect("setup: corpus is JSON");
    let cases = corpus.as_array().cloned().unwrap_or_default();
    assert!(cases.len() >= 30, "the corpus holds every case of R209, R210 and AC-5, AC-6, AC-26");
    let strs = |v: &Value| -> Vec<String> { v.as_array().map(|a| a.iter().map(|x| x.as_str().unwrap_or("?").to_string()).collect()).unwrap_or_default() };
    let mut bad = Vec::new();
    for c in &cases {
        let name = c["name"].as_str().unwrap_or("?");
        let key = c["key"].as_str().unwrap_or("?");
        let want = &c["expected"];
        let (got, ignored, unreadable) = match c["file"].as_str() {
            Some(text) => {
                let p = parse(key, text);
                (card_list(&p), p.card_ignored.clone(), p.card_unreadable)
            }
            None => (card_list_undefined(), Vec::new(), false),
        };
        let want_list = CardList { list: strs(&want["list"]), default: want["default"].as_bool().unwrap_or(false), keys: strs(&want["keys"]) };
        if got != want_list {
            bad.push(format!("{name}: card_list {got:?}, want {want_list:?}"));
        }
        if ignored != strs(&want["ignored"]) {
            bad.push(format!("{name}: card_ignored {ignored:?}, want {:?}", strs(&want["ignored"])));
        }
        if unreadable != want["unreadable"].as_bool().unwrap_or(false) {
            bad.push(format!("{name}: card_unreadable {unreadable}"));
        }
    }
    assert!(bad.is_empty(), "R209, R210 (card-lists.json):\n{}", bad.join("\n"));
    assert_eq!((CARD_BUILT_INS.to_vec(), CARD_FALLBACK.to_vec()), (vec!["tags", "body", "description", "source", "aliases", "created", "modified"], vec!["tags", "body", "modified"]), "the constants of §2.2");
    // default_card for a defined type (system table, user types from preview).
    assert_eq!(default_card(&parse("book", &views("book")).def), s(&["tags", "body", "author", "status", "modified"]), "Book's default");
    assert_eq!(default_card(&parse("task", &new_empty("task")).def), s(&["tags", "body", "status", "due", "priority", "recurrence", "source"]), "Task's default");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-6

#[test]
fn fr_typ_11_ac6_card_key_is_read() {
    let v = vylet();
    let keys = ["tags", "description", "stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "neznámý-klíč", "modified"];
    let (hit, dbg) = reads_card("výlet", &v, Some(&keys));
    assert!(hit, "TypeFile.card reads výlet.yml's line 12 as written (the unknown key kept): {dbg}");
    let p = parse("výlet", &v);
    let effective = s(&["tags", "description", "stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "modified"]);
    assert_eq!(card_list(&p).keys, effective, "effective keys: neznámý-klíč skipped");
    assert_eq!(p.card_ignored, s(&["neznámý-klíč"]), "the unknown key is named for the section's warning");
    // preview doesn't change a card that has `card:`.
    let no_preview = swap(&v, "preview: [stav, kraj]\n", "preview: []\n");
    assert_eq!(card_list(&parse("výlet", &no_preview)), card_list(&p), "a runtime preview: [] gives the same card");
    assert_eq!(card_list(&parse("výlet", &vylet_card("card: []\n"))).keys, Vec::<String>::new(), "card: [] gives no keys");
    assert_eq!(card_list(&parse("výlet", &vylet_card("card: [title, kraj]\n"))).keys, s(&["kraj"]), "title is always on the card and skipped as a key");
    let c = card_list(&parse("článek", &cards("článek")));
    assert_eq!((c.list.clone(), c.default, c.keys.clone()), (s(&["body", "rubrika", "source", "created"]), false, s(&["body", "rubrika", "source", "created"])), "Článek's card");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-21

#[test]
fn fr_typ_11_ac21_changing_the_card_writes_only_card() {
    // (a) book.yml without card: one line after line 11 (preview), every other byte unchanged, version kept.
    let b = views("book");
    let a = do_patch("book", &b, vec![set_card(&["body", "author", "status", "modified"])]);
    assert_eq!(a, Ok(Some(swap(&b, BOOK_PREVIEW, &format!("{BOOK_PREVIEW}card: [body, author, status, modified]\n")))), "(a) Remove Tags: card inserted after preview");
    let first = a.ok().flatten().unwrap_or_default();
    assert!(first.starts_with("# Tegg type definition") && first.contains("\nversion: 1\n"), "version: 1 stays (D-2060)");
    // (b) Remove Body: only that line changes.
    let bb = do_patch("book", &first, vec![set_card(&["author", "status", "modified"])]);
    assert_eq!(bb, Ok(Some(swap(&b, BOOK_PREVIEW, &format!("{BOOK_PREVIEW}card: [author, status, modified]\n")))), "(b) Remove Body");
    let second = bb.ok().flatten().unwrap_or_default();
    assert_eq!(do_patch("book", &second, vec![set_card(&["author", "status", "modified"])]), Ok(None), "an equal list writes nothing (FR-SYN-06)");
    // (c) výlet: removing Kraj keeps the unknown key in its place.
    let c = do_patch("výlet", &vylet(), vec![set_card(&["tags", "description", "stav", "náročnost", "vybavení", "délka", "termín", "odkaz", "průvodce", "neznámý-klíč", "modified"])]);
    assert_eq!(c, Ok(Some(vylet_card("card: [tags, description, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n"))), "(c) one line, in place");
    // (d) kontrola (no preview): after its review line.
    let k = cards("kontrola");
    assert_eq!(do_patch("kontrola", &k, vec![set_card(&["body", "modified"])]), Ok(Some(swap(&k, "review: false\n", "review: false\ncard: [body, modified]\n"))), "(d) after review");
    // (f) no version: the first change inserts `version: 1` (AR-07 AC-2).
    let no_version = swap(&vylet(), "version: 1\n", "");
    assert_eq!(do_patch("výlet", &no_version, vec![set_card(&["kraj"])]), Ok(Some(vylet_card("card: [kraj]\n"))), "(f) version: 1 first after the header, the card line changed");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-23

#[test]
fn fr_typ_11_ac23_reordering() {
    let moved = do_patch("výlet", &vylet(), vec![set_card(&["tags", "description", "kraj", "stav", "náročnost", "vybavení", "délka", "termín", "odkaz", "průvodce", "neznámý-klíč", "modified"])]);
    assert_eq!(moved, Ok(Some(vylet_card("card: [tags, description, kraj, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n"))), "Kraj above Stav: only the card line");
    let t = moved.ok().flatten().unwrap_or_default();
    let back = do_patch("výlet", &t, vec![set_card(&["tags", "description", "stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "neznámý-klíč", "modified"])]);
    assert_eq!(back, Ok(Some(vylet())), "moving back gives the fixture's bytes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-24

#[test]
fn fr_typ_11_ac24_remove_and_reset() {
    assert_eq!(do_patch("výlet", &vylet(), vec![set_card(&[])]), Ok(Some(vylet_card("card: []\n"))), "removing every row writes card: []");
    let reset = do_patch("výlet", &vylet(), vec![TypeOp::SetCard(None)]);
    assert_eq!(reset, Ok(Some(vylet_card(""))), "Reset to default removes the card line, every other byte unchanged (AP-1573)");
    let t = reset.ok().flatten().unwrap_or_default();
    assert_eq!(card_list(&parse("výlet", &t)), CardList { list: s(&["tags", "body", "stav", "kraj", "modified"]), default: true, keys: s(&["tags", "body", "stav", "kraj", "modified"]) }, "the default from preview");
    assert_eq!(do_patch("výlet", &t, vec![TypeOp::SetCard(None)]), Ok(None), "a reset without card: writes nothing");
    let block = vylet_card("card:\n  - tags\n  - kraj\n");
    assert_eq!(do_patch("výlet", &block, vec![TypeOp::SetCard(None)]), Ok(Some(vylet_card(""))), "a block list's lines all go");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-26

#[test]
fn fr_typ_11_ac26_hand_written_card() {
    // (a) repeats and title.
    let a = vylet_card("card: [tags, tags, title, kraj]\n");
    assert_eq!(card_list(&parse("výlet", &a)).keys, s(&["tags", "kraj"]), "(a) tags counted once, title skipped");
    assert_eq!(do_patch("výlet", &a, vec![set_card(&["title", "kraj"])]), Ok(Some(vylet_card("card: [title, kraj]\n"))), "(a) removing Tags removes both copies");
    // (b) NFD matches and is written NFC.
    let b = vylet_card(&format!("card: [{}, stav]\n", nfd("náročnost")));
    assert_eq!(card_list(&parse("výlet", &b)).keys, s(&["náročnost", "stav"]), "(b) NFD náročnost matches its attribute");
    assert_eq!(do_patch("výlet", &b, vec![set_card(&[&nfd("náročnost"), "kraj"])]), Ok(Some(vylet_card("card: [náročnost, kraj]\n"))), "(b) written NFC");
    // (c) a block list becomes one flow line on the next write.
    let c = vylet_card("card:\n  - tags\n  - kraj\n");
    assert_eq!(card_list(&parse("výlet", &c)).keys, s(&["tags", "kraj"]), "(c) a block list reads as a flow list");
    assert_eq!(do_patch("výlet", &c, vec![set_card(&["kraj"])]), Ok(Some(vylet_card("card: [kraj]\n"))), "(c) one flow line replaces the block");
    // (d) scalar and mapping: valid file, default card, writes refused.
    for (what, line) in [("scalar", "card: tags\n"), ("mapping", "card: { a: b }\n")] {
        let d = vylet_card(line);
        let p = parse("výlet", &d);
        assert_eq!(p.readability, Readability::Ok, "(d) {what}: the file stays valid (AR-07 AC-4 unchanged)");
        assert!(p.card_unreadable, "(d) {what}: card_unreadable");
        assert_eq!(card_list(&p).list, s(&["tags", "body", "stav", "kraj", "modified"]), "(d) {what}: R210's default for Výlet");
        assert_eq!(do_patch("výlet", &d, vec![set_card(&["kraj"])]), Err(SchemaError::Rule(RuleError::CardUnreadable)), "(d) {what}: SetCard refused");
        assert_eq!(do_patch("výlet", &d, vec![TypeOp::SetCard(None)]), Err(SchemaError::Rule(RuleError::CardUnreadable)), "(d) {what}: reset refused");
        assert_eq!(do_patch("výlet", &d, vec![TypeOp::SetColor("blue".into())]), Ok(Some(swap(&d, "color: teal\n", "color: blue\n"))), "(d) {what}: other ops keep the card line");
    }
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-27

#[test]
fn fr_typ_11_ac27_failures_and_system_types() {
    // (b) Missing system file: the built-in text plus the line (D-90).
    let task = builtin("task").map(str::to_string).unwrap_or_default();
    assert_eq!(task, new_empty("task"), "setup: the built-in task.yml is new-empty's");
    assert_eq!(
        do_patch("task", &task, vec![set_card(&["tags", "body", "status", "due", "priority", "source"])]),
        Ok(Some(swap(&task, "preview: [status, priority, due]\n", "preview: [status, priority, due]\ncard: [tags, body, status, due, priority, source]\n"))),
        "(b) removing Recurrence from Task's card: one line after preview; a card change is no BuiltInChanged"
    );
    // (c) System types: Page's card line only.
    let page = new_empty("page");
    assert_eq!(do_patch("page", &page, vec![set_card(&["body", "modified"])]), Ok(Some(swap(&page, "preview: []\n", "preview: []\ncard: [body, modified]\n"))), "(c) page.yml");
    // (d) Newer version: read, never written.
    let newer = swap(&vylet_card("card: [kraj, stav]\n"), "version: 1\n", "version: 2\n");
    assert_eq!(card_list(&parse("výlet", &newer)).keys, s(&["kraj", "stav"]), "(d) cards drawn from a newer file's card");
    assert_eq!(do_patch("výlet", &newer, vec![set_card(&["kraj"])]), Err(SchemaError::NewerVersion), "(d) never patched");
    // (e) Invalid file: the fallback list; never written.
    let broken = read("tests/fixtures/vaults/types/.tegg/types/rozbitý.yml");
    assert_eq!(card_list(&parse("rozbitý", &broken)), CardList { list: s(&["tags", "body", "modified"]), default: true, keys: s(&["tags", "body", "modified"]) }, "(e) CARD_FALLBACK");
    assert_eq!(do_patch("rozbitý", &broken, vec![set_card(&["body"])]), Err(SchemaError::Invalid), "(e) never patched");
    // (f) Tag: fixed.
    let tag = swap(&new_empty("tag"), "preview: [color]\n", "preview: [color]\ncard: [tags]\n");
    assert_eq!(card_list(&parse("tag", &tag)).list, s(&["body", "modified"]), "(f) Tag's card is fixed whatever the file says");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-28

#[test]
fn fr_typ_11_ac28_kept_consistent_with_schema_changes() {
    let with = |extra: &str| swap(&vylet_card(&format!("card: [tags, kraj, stav, {}]\n", nfd("kraj"))), "preview: [stav, kraj]\n", &format!("preview: [stav, kraj]\n{extra}"));
    let v = with("");
    let item = "  - key: kraj\n    name: Kraj\n    type: text\n    icon: map-pin\n";
    let want = swap(&swap(&vylet_card("card: [tags, stav]\n"), "preview: [stav, kraj]\n", "preview: [stav]\n"), item, "");
    assert_eq!(do_patch("výlet", &v, vec![TypeOp::RemoveAttribute("kraj".into())]), Ok(Some(want)), "the delete removes every kraj entry from card (NFD too) and preview in the same change");
    // Other ops never write the card line.
    let others: Vec<(&str, TypeOp, &str, &str)> = vec![
        ("rename Kraj", TypeOp::UpdateAttribute { key: "kraj".into(), change: AttrChange { name: Some("Region".into()), ..Default::default() } }, "    name: Kraj\n", "    name: Region\n"),
        ("widen Kraj", TypeOp::UpdateAttribute { key: "kraj".into(), change: AttrChange { r#type: Some(AttrType::LongText), ..Default::default() } }, "    name: Kraj\n    type: text\n", "    name: Kraj\n    type: long-text\n"),
        ("Name", TypeOp::SetName("Túra".into()), "name: Výlet\n", "name: Túra\n"),
        ("Plural", TypeOp::SetPlural("Túry".into()), "plural: Výlety\n", "plural: Túry\n"),
        ("icon", TypeOp::SetIcon("tent".into()), "icon: map\n", "icon: tent\n"),
        ("colour", TypeOp::SetColor("blue".into()), "color: teal\n", "color: blue\n"),
        ("folder", TypeOp::SetFolder("Túry".into()), "folder: Výlety\n", "folder: Túry\n"),
        ("review", TypeOp::SetReview(true), "review: false\n", "review: true\n"),
    ];
    let base = vylet();
    let card_ok = do_patch("výlet", &base, vec![set_card(&["kraj"])]).ok().flatten().is_some();
    assert!(card_ok, "SetCard writes (setup of the comparison below)");
    for (what, op, from, to) in others {
        let got = do_patch("výlet", &base, vec![op]);
        assert_eq!(got, Ok(Some(swap(&base, from, to))), "{what}: only its own line; card: stays byte for byte");
    }
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-12

#[test]
fn fr_typ_01_ac12_icon_on_an_attribute() {
    let v = vylet();
    for (attr, want) in [("stav", "icon: Some(\"circle-dot\")"), ("kraj", "icon: Some(\"map-pin\")"), ("délka", "icon: Some(\"ikona-ktera-neexistuje\")"), ("náročnost", "icon: None")] {
        let dbg = attr_icon_debug(&v, "výlet", attr);
        assert!(dbg.contains(want), "AttrDef.icon of {attr} is {want} as written: {dbg}");
    }
    let known: Vec<(&str, bool)> = ["circle-dot", "map-pin", "backpack", "calendar", "link", "ikona-ktera-neexistuje"].iter().map(|n| (*n, icons::resolve_icon(n).is_some())).collect();
    assert_eq!(known, vec![("circle-dot", true), ("map-pin", true), ("backpack", true), ("calendar", true), ("link", true), ("ikona-ktera-neexistuje", false)], "known = resolves to a Lucide 0.460 name");
    let naro = "  - key: náročnost\n    name: Náročnost\n    type: select\n";
    let m = do_patch("výlet", &v, vec![icon("náročnost", Some("mountain"))]);
    assert_eq!(m, Ok(Some(swap(&v, naro, &format!("{naro}    icon: mountain\n")))), "mountain for Náročnost: one line right after its type line");
    assert_eq!(do_patch("výlet", &v, vec![icon("kraj", None)]), Ok(Some(swap(&v, "    type: text\n    icon: map-pin\n", "    type: text\n"))), "None on Kraj removes only its icon line");
    assert_eq!(do_patch("výlet", &v, vec![icon("kraj", Some("map-pin"))]), Ok(None), "the current icon writes nothing");
    assert_eq!(do_patch("výlet", &v, vec![icon("kraj", Some("mountain"))]), Ok(Some(swap(&v, "    icon: map-pin\n", "    icon: mountain\n"))), "replaced in place");
    let after = m.ok().flatten().unwrap_or_default();
    assert!(after.contains("    icon: ikona-ktera-neexistuje\n") && after.contains("version: 1\n"), "délka's unknown name and version stay");
    // Built-in attribute on Task: allowed (AP-1594), no BuiltInChanged.
    let task = new_empty("task");
    let st = "  - key: status\n    name: Status\n    type: select\n";
    assert_eq!(do_patch("task", &task, vec![icon("status", Some("circle-dot"))]), Ok(Some(swap(&task, st, &format!("{st}    icon: circle-dot\n")))), "Task's built-in status gets its icon line");
    assert_eq!(do_patch("task", &task, vec![icon("tags", Some("tag"))]), Ok(None), "a universal key has no attribute item: nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-17

#[test]
fn fr_typ_01_ac17_choosing_writes_one_line() {
    let v = vylet();
    assert_eq!(do_patch("výlet", &v, vec![TypeOp::SetIcon("tent".into())]), Ok(Some(swap(&v, "icon: map\n", "icon: tent\n"))), "General: only the icon line");
    let naro = "    name: Náročnost\n    type: select\n";
    assert_eq!(do_patch("výlet", &v, vec![icon("náročnost", Some("mountain"))]), Ok(Some(swap(&v, naro, &format!("{naro}    icon: mountain\n")))), "a property icon: AC-12's bytes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-19

const R14: [&str; 24] = [
    "file-text", "check-square", "zap", "calendar", "hash", "image", "file", "book", "book-open", "lightbulb", "users", "user", "folder", "map", "star", "flag", "bookmark",
    "briefcase", "coffee", "globe", "graduation-cap", "pen-line", "utensils", "plane",
];

#[test]
fn fr_typ_01_ac19_old_names_keep_drawing() {
    assert_eq!(icons::OLD_ICON_NAMES, R14, "OLD_ICON_NAMES is types.md R14's list");
    assert_eq!(icons::LUCIDE_VERSION, "0.460.0", "Lucide 0.460.0");
    let mut bad = Vec::new();
    for n in R14 {
        match icons::resolve_icon(n) {
            None => bad.push(format!("{n}: None")),
            Some(r) => {
                let want = if n == "check-square" { "square-check-big" } else { n };
                if r.name != want || r.node.is_empty() {
                    bad.push(format!("{n}: {} ({} elements)", r.name, r.node.len()));
                }
            }
        }
    }
    assert!(bad.is_empty(), "every old name resolves (23 by name, check-square by its alias): {bad:?}");
    // The node equals the data file's (§5.1).
    let data = std::fs::read_to_string(repo().join("packages/schema/data/lucide-0.460.0.json")).unwrap_or_default();
    let json: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
    let node = &json["icons"]["square-check-big"]["n"];
    let ours: Vec<Value> = icons::resolve_icon("check-square").map(|r| r.node.iter().map(|e| Value::Array(vec![Value::String(e.tag.clone()), Value::Object(e.attrs.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect())])).collect()).unwrap_or_default();
    assert_eq!(Value::Array(ours), node.clone(), "check-square draws square-check-big's paths from the data file");
    // Files are never rewritten: the canonical name is a no-op, other changes keep the line.
    let k = cards("kontrola");
    assert_eq!(do_patch("kontrola", &k, vec![TypeOp::SetIcon("square-check-big".into())]), Ok(None), "choosing square-check-big where check-square is written writes nothing (D-2103)");
    for (what, op) in [("colour", TypeOp::SetColor("blue".into())), ("card", set_card(&["body"]))] {
        let t = do_patch("kontrola", &k, vec![op]).ok().flatten().unwrap_or_default();
        assert!(t.contains("\nicon: check-square\n"), "{what}: icon: check-square stays byte for byte");
    }
    let ne_task = new_empty("task");
    assert_eq!(do_patch("task", &ne_task, vec![TypeOp::SetIcon("square-check-big".into())]), Ok(None), "new-empty's task.yml isn't rewritten");
    assert!(icons::resolve_icon("square").is_some_and(|r| r.name == "square"), "a plain Lucide name resolves to itself");
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-11

#[test]
fn ar_07_ac11_card_and_icon_are_optional_version_1_keys() {
    let v = vylet();
    let p = parse("výlet", &v);
    assert_eq!((p.readability.clone(), CURRENT_VERSION), (Readability::Ok, 1), "a version-1 file with card and icon is Ok, never Newer");
    let (hit, dbg) = reads_card("výlet", &v, Some(&["tags", "description", "stav", "náročnost", "kraj", "vybavení", "délka", "termín", "odkaz", "průvodce", "neznámý-klíč", "modified"]));
    assert!(hit, "card read as an optional list: {dbg}");
    let (none, dbg2) = reads_card("book", &views("book"), None);
    assert!(none, "no card: None: {dbg2}");
    assert!(attr_icon_debug(&v, "výlet", "stav").contains("icon: Some(\"circle-dot\")"), "an attribute's icon as an optional string");
    // New, starter and built-in files carry neither key.
    assert_eq!(new_type_file("Čajovna", "Čajovny"), read("tests/fixtures/types/expected/čajovna.yml"), "a new type file is unchanged");
    for k in SYSTEM_KEYS {
        let b = builtin(k).unwrap_or_default();
        assert!(!b.contains("\ncard:") && !b.contains("    icon:"), "{k}: the built-in file has no card and no attribute icon");
    }
    // Every other op keeps the card lines and every icon line, a malformed card included.
    let block = vylet_card("card:\n  - tags   # první\n  - kraj\n");
    let scalar = vylet_card("card: tags\n");
    for (what, text) in [("block list with a comment", block), ("scalar", scalar)] {
        let got = do_patch("výlet", &text, vec![TypeOp::SetDescription(Some("Jiný popis.".into()))]);
        assert_eq!(got, Ok(Some(swap(&text, "description: Výlety a túry, plánované i hotové.\n", "description: Jiný popis.\n"))), "{what}: only the description line changes");
        let moved = do_patch("výlet", &text, vec![TypeOp::MoveAttribute { key: "kraj".into(), to: 0 }]).ok().flatten().unwrap_or_default();
        assert!(moved.contains("    icon: map-pin\n") && moved.contains("    icon: circle-dot\n"), "{what}: a moved item keeps its icon line");
    }
    assert!(icons::resolve_icon("map").is_some(), "icons resolve (§2.4)");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-36

#[test]
fn fr_fmt_07_ac36_type_files_with_card_and_icon_round_trip() {
    let base = vylet_card("card: [tags, kraj]   # karta\n");
    let commented = swap(&base, "views: [Výlety podle stavu]\n", "views: [Výlety podle stavu]\n# celořádkový komentář\nneznámý-klíč-nahoře: ano\n");
    let crlf = commented.replace('\n', "\r\n");
    let no_final = commented.trim_end_matches('\n').to_string();
    for (what, text, nl) in [("LF", commented.clone(), "\n"), ("CRLF", crlf, "\r\n"), ("no final newline", no_final, "\n")] {
        // A Card change: only the card line, its trailing comment kept.
        let got = do_patch("výlet", &text, vec![set_card(&["kraj", "tags"])]);
        let want = text.replacen("card: [tags, kraj]   # karta", "card: [kraj, tags]   # karta", 1);
        assert_eq!(got, Ok(Some(want)), "{what}: a Card change rewrites only its line, the comment kept");
        // An icon choice: one line in the item.
        let naro = format!("    name: Náročnost{nl}    type: select{nl}");
        let got = do_patch("výlet", &text, vec![icon("náročnost", Some("mountain"))]);
        assert_eq!(got, Ok(Some(text.replacen(&naro, &format!("{naro}    icon: mountain{nl}"), 1))), "{what}: an icon choice adds one line");
        // Reset: the card line goes.
        let got = do_patch("výlet", &text, vec![TypeOp::SetCard(None)]);
        assert_eq!(got, Ok(Some(text.replacen(&format!("card: [tags, kraj]   # karta{nl}"), "", 1))), "{what}: Reset to default removes only the card line");
        assert_eq!(do_patch("výlet", &text, vec![set_card(&["tags", "kraj"])]), Ok(None), "{what}: a no-op writes nothing");
    }
    property(FIXED_SEED, 300);
    if let Some(seed) = std::env::var("QA_SEED").ok().and_then(|v| v.parse::<u64>().ok()) {
        println!("FR-FMT-07 AC-36 property seed {seed}");
        property(seed, 300);
    }
}

const FIXED_SEED: u64 = 20261122;
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn int(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn bool(&mut self) -> bool {
        self.next() & 1 == 1
    }
}
const ATTRS: [(&str, &str, &str); 5] = [("stav", "Stav", "select"), ("kraj", "Kraj", "text"), ("náročnost", "Náročnost", "number"), ("délka", "Délka", "number"), ("odkaz", "Odkaz", "url")];
const POOL_KEYS: [&str; 9] = ["tags", "body", "modified", "stav", "kraj", "náročnost", "délka", "odkaz", "neznámý"];
const ICONS: [&str; 5] = ["mountain", "map-pin", "tent", "link", "circle-dot"];

/// One random type file (lines without EOL) and its attributes' icons.
fn random_file(r: &mut Rng) -> (Vec<String>, Option<Vec<String>>, Vec<Option<String>>, bool) {
    let mut l: Vec<String> = vec![
        "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.".into(),
        "version: 1".into(),
        "name: Výlet".into(),
        "plural: Výlety".into(),
        "system: false".into(),
        "folder: Výlety".into(),
        "icon: map".into(),
        "color: teal".into(),
        "review: false".into(),
    ];
    if r.bool() {
        l.push("# komentář nad náhledem".into());
    }
    if r.bool() {
        l.push("preview: [stav]".into());
    }
    let card: Option<Vec<String>> = if r.int(3) == 0 {
        None
    } else {
        let n = r.int(5);
        let keys: Vec<String> = (0..n).map(|_| {
            let k = POOL_KEYS[r.int(POOL_KEYS.len())];
            if r.int(4) == 0 { nfd(k) } else { k.to_string() }
        }).collect();
        if r.bool() || keys.is_empty() {
            l.push(format!("card: [{}]{}", keys.join(", "), if r.bool() { "   # karta" } else { "" }));
        } else {
            l.push("card:".into());
            for k in &keys {
                l.push(format!("  - {k}"));
            }
        }
        Some(keys)
    };
    if r.bool() {
        l.push("neznámý-klíč: hodnota".into());
    }
    l.push("attributes:".into());
    let mut icons_now = Vec::new();
    for (k, n, t) in ATTRS {
        l.push(format!("  - key: {k}"));
        l.push(format!("    name: {n}"));
        l.push(format!("    type: {t}"));
        let ic = if r.bool() { Some(ICONS[r.int(ICONS.len())].to_string()) } else { None };
        if let Some(i) = &ic {
            l.push(format!("    icon: {i}"));
        }
        if r.int(4) == 0 {
            l.push("    # poznámka u vlastnosti".into());
        }
        icons_now.push(ic);
    }
    (l, card, icons_now, r.bool())
}
fn join(lines: &[String], crlf: bool) -> String {
    let nl = if crlf { "\r\n" } else { "\n" };
    let mut t = lines.join(nl);
    t.push_str(nl);
    t
}
/// The text without the lines of the `card` key (its flow line or its block).
fn without_card(text: &str) -> String {
    let mut out = String::new();
    let mut in_block = false;
    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare.starts_with("card:") {
            in_block = bare.trim_end() == "card:";
            continue;
        }
        if in_block && bare.starts_with("  - ") {
            continue;
        }
        in_block = false;
        out.push_str(line);
    }
    out
}
/// The text without the `icon:` line of item `key` (indented four spaces).
fn without_icon(text: &str, key: &str) -> String {
    let mut out = String::new();
    let mut in_item = false;
    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare.starts_with("  - key: ") {
            in_item = bare == format!("  - key: {key}");
        } else if in_item && bare.starts_with("    icon: ") {
            continue;
        }
        out.push_str(line);
    }
    out
}

fn property(seed: u64, cases: usize) {
    let mut r = Rng(seed);
    for case in 0..cases {
        let (lines, card, icons_now, crlf) = random_file(&mut r);
        let text = join(&lines, crlf);
        if r.bool() {
            // A card op.
            let op_keys: Option<Vec<String>> = if r.int(4) == 0 { None } else { Some((0..r.int(5)).map(|_| POOL_KEYS[r.int(POOL_KEYS.len())].to_string()).collect()) };
            let got = do_patch("výlet", &text, vec![TypeOp::SetCard(op_keys.clone())]);
            let noop = match (&card, &op_keys) {
                (None, None) => true,
                (Some(c), Some(k)) => c.iter().map(|x| tegg_format::nfc(x)).collect::<Vec<_>>() == *k,
                _ => false,
            };
            if noop {
                assert_eq!(got, Ok(None), "seed {seed} case {case}: a no-op writes nothing\n{text}");
                continue;
            }
            let after = match got {
                Ok(Some(t)) => t,
                other => panic!("seed {seed} case {case}: SetCard({op_keys:?}) answered {other:?}\n{text}"),
            };
            assert_eq!(without_card(&after), without_card(&text), "seed {seed} case {case}: every line outside the card key is byte-identical\n{text}\n---\n{after}");
            let read_back = card_list(&parse("výlet", &after));
            match &op_keys {
                Some(k) => assert_eq!(read_back.list, *k, "seed {seed} case {case}: the card reads back as written (NFC)"),
                None => assert!(read_back.default, "seed {seed} case {case}: no card after a reset"),
            }
        } else {
            let i = r.int(ATTRS.len());
            let (k, _, _) = ATTRS[i];
            let new_icon = if r.int(3) == 0 { None } else { Some(ICONS[r.int(ICONS.len())].to_string()) };
            let got = do_patch("výlet", &text, vec![icon(k, new_icon.as_deref())]);
            if icons_now[i] == new_icon {
                assert_eq!(got, Ok(None), "seed {seed} case {case}: the current icon writes nothing");
                continue;
            }
            let after = match got {
                Ok(Some(t)) => t,
                other => panic!("seed {seed} case {case}: SetAttributeIcon({k}, {new_icon:?}) answered {other:?}\n{text}"),
            };
            assert_eq!(without_icon(&after, k), without_icon(&text, k), "seed {seed} case {case}: every line outside the icon line is byte-identical");
            let dbg = attr_icon_debug(&after, "výlet", k);
            let want = match &new_icon {
                Some(n) => format!("icon: Some({n:?})"),
                None => "icon: None".to_string(),
            };
            assert!(dbg.contains(&want), "seed {seed} case {case}: {k} reads back with {want}: {dbg}");
        }
    }
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-15

#[test]
fn fr_fmt_12_ac15_card_keys_and_icon_names_are_nfc() {
    let v = vylet_card(&format!("card: [{}, {}]\n", nfd("kraj"), nfd("náročnost")));
    assert_eq!(card_list(&parse("výlet", &v)).keys, s(&["kraj", "náročnost"]), "NFD card entries match their attributes");
    // An NFD attribute key in the type file matches an NFC card entry.
    let nfd_attr = swap(&vylet_card("card: [náročnost]\n"), "  - key: náročnost\n", &format!("  - key: {}\n", nfd("náročnost")));
    assert_eq!(card_list(&parse("výlet", &nfd_attr)).keys, s(&["náročnost"]), "an NFD attribute key matches (its spelling NFC-normalised)");
    assert_eq!(do_patch("výlet", &vylet(), vec![set_card(&[&nfd("náročnost")])]), Ok(Some(vylet_card("card: [náročnost]\n"))), "every card write is NFC");
    assert!(icons::resolve_icon("map").is_some(), "an ASCII Lucide name resolves");
    assert!(icons::resolve_icon("mapá").is_none(), "an icon name with a non-ASCII character is unknown");
    let odd = swap(&vylet(), "    icon: map-pin\n", "    icon: špendlík\n");
    let kept = do_patch("výlet", &odd, vec![TypeOp::SetColor("blue".into())]).ok().flatten().unwrap_or_default();
    assert!(kept.contains("    icon: špendlík\n"), "and it is kept byte for byte");
    assert!(attr_icon_debug(&odd, "výlet", "kraj").contains("icon: Some(\"špendlík\")"), "read as written");
}
