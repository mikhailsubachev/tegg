//! Slice Q2.1, L4 at `tegg-schema` (docs/acceptance/views.md R196; AR-07 AC-10; the type-file bytes of FR-QRY-07 AC-23…
//! AC-26; FR-FMT-12 AC-13 for items; FR-FMT-07 AC-34 for other ops): `views:` items read as a name or a mapping with a
//! string `name` and own `sort` / `columns` (`Parsed.view_items`, `ViewItem`), `TypeOp::SetViewSort`, `SetViewColumns`,
//! `SetViews` with items (the first item kept, a block list while any item has own settings, the flow line otherwise,
//! unchanged items keep their lines, changed items re-emitted with unknown keys after the known ones), `rename_view` on
//! mapping items, refusals (`ViewNotListed`). Interface docs/contracts/v1-views.md §14 (D-1840, D-1843, D-1855, D-1857).
//! Inputs: tests/fixtures/vaults/views/ (base) and views-usage/ (overlay) `.tegg/types/book.yml`; expected bytes
//! tests/fixtures/queries-files/expected/views-usage/types/. Written from the ACs and the contract only (D-61). Nothing
//! is written to disk.

use std::path::PathBuf;

use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
fn base() -> String {
    read("tests/fixtures/vaults/views/.tegg/types/book.yml")
}
fn overlay() -> String {
    read("tests/fixtures/vaults/views-usage/.tegg/types/book.yml")
}
fn expected(name: &str) -> String {
    read(&format!("tests/fixtures/queries-files/expected/views-usage/types/{name}"))
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "setup: {from:?} in the text");
    text.replacen(from, to, 1)
}
/// Lines `from..=to` (1-based) of a text, each with its `\n`.
fn lines(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').skip(from - 1).take(to + 1 - from).collect()
}
const LINE13: &str = "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n";
fn nfd(s: &str) -> String {
    s.replace('é', "e\u{301}").replace('č', "c\u{30C}").replace('ř', "r\u{30C}").replace('ž', "z\u{30C}").replace('Č', "C\u{30C}").replace('ý', "y\u{301}").replace('í', "i\u{301}")
}
const NAMES: [(&str, &str, &str); 9] = [
    ("page", "Page", "Pages"),
    ("task", "Task", "Tasks"),
    ("quick-note", "Quick Note", "Quick Notes"),
    ("daily-note", "Daily Note", "Daily"),
    ("tag", "Tag", "Tags"),
    ("image", "Image", "Images"),
    ("pdf", "PDF", "PDFs"),
    ("book", "Book", "Books"),
    ("autor", "Autor", "Autoři"),
];
fn do_patch(text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others: Vec<TypeNames<'static>> = NAMES.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == "book" }).collect();
    patch("book", text, &ops, &PatchContext { others: &others })
}
/// One op; asserts a write.
fn wrote(text: &str, ops: Vec<TypeOp>, what: &str) -> String {
    match do_patch(text, ops) {
        Ok(Some(t)) => t,
        other => {
            assert!(false, "{what}: expected a write, got {other:?}");
            unreachable!()
        }
    }
}
fn s(by: &str, asc: bool) -> UsageSort {
    UsageSort { by: by.into(), order: if asc { UsageOrder::Asc } else { UsageOrder::Desc } }
}
fn view_sort(name: &str, sort: Option<Vec<UsageSort>>) -> TypeOp {
    TypeOp::SetViewSort { name: name.into(), sort }
}
fn view_cols(name: &str, cols: Option<&[&str]>) -> TypeOp {
    TypeOp::SetViewColumns { name: name.into(), columns: cols.map(|c| c.iter().map(|x| x.to_string()).collect()) }
}
fn set_views(v: &[&str]) -> TypeOp {
    TypeOp::SetViews(v.iter().map(|s| s.to_string()).collect())
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn plain(name: &str) -> ViewItem {
    ViewItem { name: name.into(), sort: UsageValue::Absent, columns: UsageValue::Absent, plain: true }
}
fn overlay_items() -> Vec<ViewItem> {
    vec![
        plain("Rozečtené"),
        ViewItem {
            name: "Přečtené 2026".into(),
            sort: UsageValue::Set(vec![s("rating", true), s("title", true)]),
            columns: UsageValue::Set(strs(&["author", "rating", "finished", "genres"])),
            plain: false,
        },
        plain("Výborné knihy"),
    ]
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-10

#[test]
fn ar_07_ac10_views_items_are_version_1() {
    assert_eq!(CURRENT_VERSION, 1, "CURRENT_VERSION stays 1");
    let p = parse("book", &overlay());
    assert_eq!(p.readability, Readability::Ok, "a mapping item with version 1: Ok, never Newer");
    assert!(!p.views_unreadable, "the overlay's views are readable");
    assert_eq!(p.def.views, Some(strs(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])), "TypeFile.views: the names (D-1855)");
    assert_eq!(p.view_items, Some(overlay_items()), "Parsed.view_items: the items with their own values");
    // Flow-style mapping items and unknown item keys are valid too.
    let flow = swap(&base(), LINE13, "views: [Rozečtené, { name: Přečtené 2026, columns: [author], x-barva: modrá }]\n");
    let pf = parse("book", &flow);
    assert!(!pf.views_unreadable, "a flow mapping item is readable");
    assert_eq!(
        pf.view_items,
        Some(vec![plain("Rozečtené"), ViewItem { name: "Přečtené 2026".into(), sort: UsageValue::Absent, columns: UsageValue::Set(strs(&["author"])), plain: false }]),
        "flow items, the unknown key ignored"
    );
    assert_eq!(parse("book", &swap(&base(), LINE13, "views:\n  - name: Rozečtené\n")).view_items, Some(vec![plain("Rozečtené")]), "a mapping with only `name` is plain");
    assert_eq!(parse("book", &base()).view_items, Some(vec![plain("Rozečtené"), plain("Přečtené 2026"), plain("Výborné knihy")]), "the base's plain names");
    // Not a string `name`: the whole views is unreadable.
    for bad in ["views:\n  - sort: { by: title, order: asc }\n", "views:\n  - name: [a]\n", "views:\n  - name: \"  \"\n", "views: [Rozečtené, 3]\n", "views: [Rozečtené, [x]]\n"] {
        let p = parse("book", &swap(&base(), LINE13, bad));
        assert_eq!(p.readability, Readability::Ok, "{bad:?}: the type file stays Ok");
        assert!(p.views_unreadable, "{bad:?}: views_unreadable");
        assert_eq!((p.def.views, p.view_items), (None, None), "{bad:?}: no names, no items");
    }
    // Every other op keeps the overlay's views lines byte-identical.
    let views = lines(&overlay(), 13, 20);
    for (what, op) in [
        ("colour", TypeOp::SetColor("red".into())),
        ("description", TypeOp::SetDescription(Some("Jiný popis knih.".into()))),
        ("columns", TypeOp::SetColumns(strs(&["author", "rating"]))),
        ("preview", TypeOp::SetPreview(strs(&["rating"]))),
        ("remove property", TypeOp::RemoveAttribute("genres".into())),
    ] {
        let t = wrote(&overlay(), vec![op], what);
        assert!(t.contains(&views), "{what}: lines 13…20 byte-identical");
    }
    for (name, bytes) in STARTER_FILES {
        assert!(!String::from_utf8_lossy(bytes).contains("\nviews:"), "starter {name}: no views key");
    }
    for key in SYSTEM_KEYS {
        assert!(!builtin(key).unwrap_or_default().contains("\nviews:"), "built-in {key}: no views key");
    }
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-23 (bytes)

#[test]
fn fr_qry_07_ac23_tab_sort_is_its_own() {
    // (a) ⇧-click on Finished on the base's Výborné knihy tab.
    let a = wrote(&base(), vec![view_sort("Výborné knihy", Some(vec![s("title", true), s("finished", true)]))], "(a)");
    assert_eq!(a, expected("book-vyborne-shift-finished.yml"), "(a) line 13 → seven lines");
    // (b) Remove the Finished level: one level stays own (equal to the query's, AP-1522).
    let b = wrote(&a, vec![view_sort("Výborné knihy", Some(vec![s("title", true)]))], "(b)");
    assert_eq!(b, expected("book-vyborne-sort-title-only.yml"), "(b) `    sort: {{ by: title, order: asc }}`");
    // (c) Use the query's sort: the plain item, the flow line again.
    assert_eq!(do_patch(&b, vec![view_sort("Výborné knihy", None)]), Ok(Some(base())), "(c) book.yml equals the fixture");
    // The overlay: a click on Finished on Přečtené 2026 replaces lines 16…18 only.
    assert_eq!(do_patch(&overlay(), vec![view_sort("Přečtené 2026", Some(vec![s("finished", true)]))]), Ok(Some(expected("book-overlay-prectene-click-finished.yml"))), "overlay: lines 16…18");
    let crlf = overlay().replace('\n', "\r\n");
    assert_eq!(do_patch(&crlf, vec![view_sort("Přečtené 2026", Some(vec![s("finished", true)]))]), Ok(Some(expected("book-overlay-prectene-click-finished-crlf.yml"))), "CRLF kept");
    // + Add sort on the Rozečtené board tab: the query's two levels plus title ↑ (D-1864).
    assert_eq!(
        do_patch(&base(), vec![view_sort("Rozečtené", Some(vec![s("status", true), s("modified", false), s("title", true)]))]),
        Ok(Some(expected("book-rozectene-sort-add.yml"))),
        "Rozečtené's own three levels"
    );
    // The same own value again writes nothing; `sort: []` is an own value (D-1806).
    assert_eq!(do_patch(&expected("book-vyborne-sort-title-only.yml"), vec![view_sort("Výborné knihy", Some(vec![s("title", true)]))]), Ok(None), "no-op: no write");
    assert!(wrote(&base(), vec![view_sort("Výborné knihy", Some(vec![]))], "sort: []").contains("  - name: Výborné knihy\n    sort: []\n"), "zero levels: `sort: []`");
    assert_eq!(do_patch(&base(), vec![view_sort("Podle žánru", Some(vec![s("title", true)]))]), Err(SchemaError::Rule(RuleError::ViewNotListed)), "a name not in views: ViewNotListed");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-24 (bytes)

#[test]
fn fr_qry_07_ac24_tab_columns_are_its_own() {
    let g = wrote(&base(), vec![view_cols("Přečtené 2026", Some(&["author", "rating", "finished", "genres"]))], "Columns › Genres");
    assert_eq!(g, expected("book-prectene-columns-genres.yml"), "line 13 → five lines");
    let r = wrote(&g, vec![view_cols("Přečtené 2026", Some(&["finished", "author", "rating", "genres"]))], "header drag");
    assert_eq!(r, expected("book-prectene-columns-reordered.yml"), "Finished before Author");
    assert_eq!(do_patch(&r, vec![view_cols("Přečtené 2026", None)]), Ok(Some(base())), "Use the query's columns: the fixture's bytes");
    // New property… Stran: the attribute (one write), then the item's columns (a second write).
    let attr = AttrDef { key: "stran".into(), name: "Stran".into(), r#type: AttrType::Number, default: None, required: false, options: vec![], to: None, multiple: false, description: None, built_in: false, icon: None };
    let one = wrote(&base(), vec![TypeOp::AddAttribute(attr)], "New property Stran");
    assert_eq!(one, expected("book-new-property-stran-1.yml"), "the attribute appended");
    assert_eq!(do_patch(&one, vec![view_cols("Přečtené 2026", Some(&["author", "rating", "finished", "stran"]))]), Ok(Some(expected("book-new-property-stran-2.yml"))), "then the item's columns");
    // The overlay: unchecking Genres replaces line 19 only.
    assert_eq!(do_patch(&overlay(), vec![view_cols("Přečtené 2026", Some(&["author", "rating", "finished"]))]), Ok(Some(expected("book-overlay-prectene-no-genres.yml"))), "overlay: line 19");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-25

#[test]
fn fr_qry_07_ac25_views_items_read_and_kept() {
    // (b) A broken own sort is read as Broken (the tab uses the query's sort).
    let sideways = swap(&overlay(), &lines(&overlay(), 16, 18), "    sort: sideways\n");
    let items = parse("book", &sideways).view_items;
    assert_eq!(items.as_ref().map(|i| i[1].sort.clone()), Some(UsageValue::Broken), "(b) sort: sideways → Broken");
    assert_eq!(items.as_ref().map(|i| i[1].columns.clone()), Some(UsageValue::Set(strs(&["author", "rating", "finished", "genres"]))), "(b) its columns still read");
    // (c) x-barva and a comment inside the item: kept through another tab's change; the key kept, the comment gone, on its own.
    let x = expected("book-overlay-xbarva-input.yml");
    assert_eq!(parse("book", &x).view_items.map(|i| i[1].clone()), Some(overlay_items()[1].clone()), "(c) the unknown key is ignored when read");
    let v = wrote(&x, vec![view_sort("Výborné knihy", Some(vec![s("title", true), s("finished", true)]))], "(c) Výborné knihy");
    assert_eq!(v, expected("book-overlay-xbarva-after-vyborne.yml"), "(c) the Přečtené 2026 item's lines kept byte for byte");
    assert_eq!(do_patch(&v, vec![view_sort("Přečtené 2026", Some(vec![s("finished", true)]))]), Ok(Some(expected("book-overlay-xbarva-after-prectene.yml"))), "(c) its own change: x-barva after the known keys, the comment gone");
    // (d) A repeated name with different settings: one tab, the first item's settings; Remove removes both.
    let dup = swap(&overlay(), "  - Výborné knihy\n", "  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n");
    let di = parse("book", &dup).view_items.unwrap_or_default();
    assert_eq!(di.len(), 4, "(d) every item kept in view_items");
    let first = wrote(&dup, vec![view_cols("Přečtené 2026", Some(&["author", "rating", "finished"]))], "(d) a change on the repeated name");
    assert!(first.contains("    columns: [author, rating, finished]\n  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n"), "(d) only the first item changes:\n{first}");
    assert_eq!(do_patch(&dup, vec![set_views(&["Rozečtené", "Výborné knihy"])]), Ok(Some(expected("book-overlay-without-prectene.yml"))), "(d) Remove removes both items");
    // (e) A quoted name is written quoted (D-230).
    assert_eq!(
        do_patch(&expected("book-overlay-quoted-name-input.yml"), vec![view_sort("Čtu, až bude čas", Some(vec![s("title", true)]))]),
        Ok(Some(expected("book-overlay-quoted-name.yml"))),
        "(e) `  - name: \"Čtu, až bude čas\"`"
    );
    // A plain base views: is never turned into a block list by a names-only op.
    assert_eq!(do_patch(&base(), vec![set_views(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])]), Ok(Some(swap(&base(), LINE13, "views: [Výborné knihy, Rozečtené, Přečtené 2026]\n"))), "flow stays flow");
    // SetViews keeps a kept name's item with its settings, and a dragged block list keeps unchanged items' lines.
    let dragged = wrote(&overlay(), vec![set_views(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])], "a tab drag on the overlay");
    assert!(dragged.contains("views:\n  - Výborné knihy\n  - Rozečtené\n  - name: Přečtené 2026\n    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n    columns: [author, rating, finished, genres]\nattributes:\n"), "the item moves with its lines:\n{dragged}");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-26 (bytes)

#[test]
fn fr_qry_07_ac26_rename_duplicate_remove_with_settings() {
    // (a) rename_view patches only the item's `name:` value.
    assert_eq!(rename_view(&overlay(), "Přečtené 2026", "Přečtené letos"), Some(expected("book-overlay-renamed.yml")), "(a) line 15 only");
    assert_eq!(rename_view(&overlay(), &nfd("přečtené 2026"), "Přečtené letos"), Some(expected("book-overlay-renamed.yml")), "(a) by name key (NFD, case)");
    let flow = swap(&base(), LINE13, "views: [Rozečtené, { name: Přečtené 2026, columns: [author] }]\n");
    assert_eq!(rename_view(&flow, "Přečtené 2026", "Přečtené letos"), Some(swap(&flow, "{ name: Přečtené 2026,", "{ name: Přečtené letos,")), "(a) a flow mapping's name token, style kept");
    // (b) Duplicate: one patch, the copy right after the original with its own sort and columns.
    let dup = do_patch(
        &overlay(),
        vec![
            set_views(&["Rozečtené", "Přečtené 2026", "Přečtené 2026 (2)", "Výborné knihy"]),
            view_sort("Přečtené 2026 (2)", Some(vec![s("rating", true), s("title", true)])),
            view_cols("Přečtené 2026 (2)", Some(&["author", "rating", "finished", "genres"])),
        ],
    );
    assert_eq!(dup, Ok(Some(expected("book-overlay-duplicate.yml"))), "(b) lines 15…19 copied with the new name after line 19");
    // (c) Remove from Books page; Show a saved query adds a plain name.
    let removed = wrote(&overlay(), vec![set_views(&["Rozečtené", "Výborné knihy"])], "(c) remove");
    assert_eq!(removed, expected("book-overlay-without-prectene.yml"), "(c) lines 13…20 → one flow line");
    assert_eq!(do_patch(&removed, vec![set_views(&["Rozečtené", "Výborné knihy", "Přečtené 2026"])]), Ok(Some(expected("book-overlay-readded-prectene.yml"))), "(c) re-added as a plain name");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-13 (items)

#[test]
fn fr_fmt_12_ac13_usage_settings_are_nfc() {
    let input = expected("book-overlay-nfd-input.yml");
    let items = parse("book", &input).view_items;
    assert_eq!(items.as_ref().map(|i| i[1].name.clone()), Some("Přečtené 2026".to_string()), "an NFD name reads NFC");
    assert_eq!(do_patch(&input, vec![view_sort("Přečtené 2026", Some(vec![s("finished", true)]))]), Ok(Some(expected("book-overlay-nfd-after-change.yml"))), "the change writes NFC");
    let by = swap(&overlay(), "      - { by: title, order: asc }\n", &format!("      - {{ by: {}, order: asc }}\n", nfd("hodnocení")));
    assert_eq!(parse("book", &by).view_items.map(|i| i[1].sort.clone()), Some(UsageValue::Set(vec![s("rating", true), s("hodnocení", true)])), "an NFD `by` reads NFC");
    let t = wrote(&base(), vec![view_cols(&nfd("Přečtené 2026"), Some(&[&nfd("poznámka"), "author"]))], "NFD op values");
    assert!(t.contains("  - name: Přečtené 2026\n    columns: [poznámka, author]\n"), "names and column keys written NFC:\n{t}");
    assert!(do_patch(&overlay(), vec![view_sort(&nfd("PŘEČTENÉ 2026"), Some(vec![s("finished", true)]))]).is_ok_and(|t| t == Some(expected("book-overlay-prectene-click-finished.yml"))), "the op's name matches by name key");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-34 (type file)

#[test]
fn fr_fmt_07_ac34_usage_settings_round_trip() {
    assert_eq!(parse("book", &overlay()).view_items.map(|i| i.len()), Some(3), "the overlay's items are read");
    let views = lines(&overlay(), 13, 20);
    for (what, op) in [
        ("a new attribute", TypeOp::AddAttribute(AttrDef { key: "stran".into(), name: "Stran".into(), r#type: AttrType::Number, default: None, required: false, options: vec![], to: None, multiple: false, description: None, built_in: false, icon: None })),
        ("columns", TypeOp::SetColumns(strs(&["author", "status"]))),
        ("a description", TypeOp::SetDescription(None)),
    ] {
        let t = wrote(&overlay(), vec![op], what);
        assert!(t.contains(&views), "{what}: lines 13…20 kept");
    }
    assert_eq!(do_patch(&overlay(), vec![set_views(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])]), Ok(None), "the same items: no write");
    assert_eq!(do_patch(&overlay(), vec![view_sort("Přečtené 2026", Some(vec![s("rating", true), s("title", true)]))]), Ok(None), "the same own sort: no write");
    let nonl = overlay().trim_end_matches('\n').to_string();
    assert_eq!(do_patch(&nonl, vec![view_sort("Přečtené 2026", Some(vec![s("finished", true)]))]), Ok(Some(expected("book-overlay-prectene-click-finished.yml").trim_end_matches('\n').to_string())), "no final newline kept");
}
