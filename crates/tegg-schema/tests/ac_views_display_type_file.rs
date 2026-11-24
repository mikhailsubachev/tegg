//! Slice Q3, L4 at `tegg-schema` (docs/acceptance/views.md part five, R220, R221; AR-07 AC-12): `views:` items with own
//! `view`, `group_by`, `lanes`, `lane_order`, `widths` (`Parsed.view_items`, `ViewItem`, Absent / Set / Broken, old
//! words read as `Wall`, `Columns`, `Rows`), the ops `TypeOp::SetViewDisplay`, `SetViewGroup`, `SetViewLanes`,
//! `SetViewLaneOrder`, `SetViewWidths`, `CopyViewSettings` (R221 key order, field-level bytes of CP-35 / D-2200, no-ops,
//! plain items, new words only for the changed key), `SetViews` / `SetViewsSource` / `rename_view` with the new keys.
//! Criteria: the type-file bytes of FR-QRY-05 AC-32, AC-34, AC-35, AC-40, AC-42, AC-43, AC-46 (c), FR-QRY-07 AC-34,
//! AC-35, FR-FMT-12 AC-16, FR-FMT-07 AC-37, AR-07 AC-12. Interface docs/contracts/v1-views.md §35, §36. Inputs:
//! tests/fixtures/vaults/views/ (base) and views-display/ (overlay) `.tegg/types/book.yml`, views-tasks/ `task.yml`;
//! expected bytes tests/fixtures/queries-files/expected/views-display/types/; the L3 corpus
//! tests/fixtures/queries-files/expected-views-display.json (`items`). Written from the ACs and the contract only (D-61).
//! Nothing is written to disk.

use std::path::PathBuf;

use serde_json::{json, Value};
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
    read("tests/fixtures/vaults/views-display/.tegg/types/book.yml")
}
fn task() -> String {
    read("tests/fixtures/vaults/views-tasks/.tegg/types/task.yml")
}
fn expected(name: &str) -> String {
    read(&format!("tests/fixtures/queries-files/expected/views-display/types/{name}"))
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "setup: {from:?} in the text");
    text.replacen(from, to, 1)
}
/// Lines `from..=to` (1-based) of a text, each with its `\n`.
fn lines(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').skip(from - 1).take(to + 1 - from).collect()
}
fn nfd(s: &str) -> String {
    s.replace('é', "e\u{301}").replace('č', "c\u{30C}").replace('ř', "r\u{30C}").replace('ž', "z\u{30C}").replace('ý', "y\u{301}").replace('í', "i\u{301}").replace('á', "a\u{301}")
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
fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others: Vec<TypeNames<'static>> = NAMES.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == key }).collect();
    patch(key, text, &ops, &PatchContext { others: &others })
}
/// One write; a refusal or no write is an assertion failure.
fn wrote(text: &str, ops: Vec<TypeOp>, what: &str) -> String {
    wrote_k("book", text, ops, what)
}
fn wrote_k(key: &str, text: &str, ops: Vec<TypeOp>, what: &str) -> String {
    match do_patch(key, text, ops) {
        Ok(Some(t)) => t,
        other => {
            assert!(false, "{what}: expected a write, got {other:?}");
            unreachable!()
        }
    }
}
/// No write: `Ok(None)`.
fn no_write(text: &str, ops: Vec<TypeOp>, what: &str) {
    let r = do_patch("book", text, ops);
    assert!(matches!(r, Ok(None)), "{what}: no write, got {r:?}");
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn display(name: &str, v: Option<UsageView>) -> TypeOp {
    TypeOp::SetViewDisplay { name: name.into(), view: v }
}
fn group(name: &str, g: Option<UsageGroupBy>) -> TypeOp {
    TypeOp::SetViewGroup { name: name.into(), group_by: g }
}
fn key(k: &str) -> Option<UsageGroupBy> {
    Some(UsageGroupBy::Key(k.into()))
}
fn lanes(name: &str, l: Option<UsageLanes>) -> TypeOp {
    TypeOp::SetViewLanes { name: name.into(), lanes: l }
}
fn lane_order(name: &str, l: Option<&[&str]>) -> TypeOp {
    TypeOp::SetViewLaneOrder { name: name.into(), lane_order: l.map(strs) }
}
fn widths(name: &str, w: Option<&[(&str, u32)]>) -> TypeOp {
    TypeOp::SetViewWidths { name: name.into(), widths: w.map(|w| w.iter().map(|(k, v)| (k.to_string(), *v)).collect()) }
}
fn set_views(v: &[&str]) -> TypeOp {
    TypeOp::SetViews(strs(v))
}
const P26: &str = "Přečtené 2026";
const VYB: &str = "Výborné knihy";
const ROZ: &str = "Rozečtené";
const ZANR: &str = "Podle žánru";
const AUTOR: &str = "Podle autora";
const ZED: &str = "Celá zeď";

fn uv<T: Clone>(v: &UsageValue<T>, f: impl Fn(&T) -> Value) -> (Value, bool) {
    match v {
        UsageValue::Absent => (Value::Null, false),
        UsageValue::Broken => (Value::Null, true),
        UsageValue::Set(x) => (f(x), false),
    }
}
/// A ViewItem as expected-views-display.json writes it (ViewItemDto).
fn item_json(i: &ViewItem) -> Value {
    let (view, view_b) = uv(&i.view, |v| json!(match v { UsageView::List => "list", UsageView::Table => "table", UsageView::Wall => "wall" }));
    let (group, group_b) = uv(&i.group_by, |g| match g {
        UsageGroupBy::None => json!({ "none": true }),
        UsageGroupBy::Key(k) => json!({ "none": false, "key": k, "period": false }),
        UsageGroupBy::Period(k) => json!({ "none": false, "key": k, "period": true }),
    });
    let (lanes, lanes_b) = uv(&i.lanes, |l| json!(match l { UsageLanes::Columns => "columns", UsageLanes::Rows => "rows" }));
    let (lo, lo_b) = uv(&i.lane_order, |l| json!(l));
    let (w, w_b) = uv(&i.widths, |w| Value::Array(w.iter().map(|(k, v)| json!([k, v])).collect()));
    let (sort, sort_b) = uv(&i.sort, |s| Value::Array(s.iter().map(|l| json!({ "by": l.by, "order": if l.order == UsageOrder::Asc { "asc" } else { "desc" } })).collect()));
    let (cols, cols_b) = uv(&i.columns, |c| json!(c));
    json!({
        "name": i.name, "sort": sort, "sortBroken": sort_b, "columns": cols, "columnsBroken": cols_b, "view": view, "viewBroken": view_b,
        "group": group, "groupBroken": group_b, "lanes": lanes, "lanesBroken": lanes_b, "laneOrder": lo, "laneOrderBroken": lo_b,
        "widths": w, "widthsBroken": w_b, "plain": i.plain,
    })
}
fn corpus_items() -> Value {
    let c: Value = serde_json::from_str(&read("tests/fixtures/queries-files/expected-views-display.json")).expect("setup: corpus JSON");
    c["items"].clone()
}
fn items_of(text: &str) -> Value {
    Value::Array(parse("book", text).view_items.unwrap_or_default().iter().map(item_json).collect())
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-12

#[test]
fn ar_07_ac12_display_keys_are_version_1() {
    assert_eq!(CURRENT_VERSION, 1, "CURRENT_VERSION stays 1");
    let p = parse("book", &overlay());
    assert_eq!(p.readability, Readability::Ok, "an item with the new keys and version 1: Ok, never Newer");
    assert!(!p.views_unreadable, "the overlay's views are readable");
    assert_eq!(p.def.views, Some(strs(&[ROZ, P26, VYB, ZANR, AUTOR, ZED])), "TypeFile.views: the six names");
    // L3: the items as the corpus writes them (`board` read as wall, `vertical` / `horizontal` as columns / rows).
    assert_eq!(items_of(&overlay()), corpus_items(), "Parsed.view_items equal expected-views-display.json `items`");
    // Broken values never make `views` unreadable.
    let broken = swap(&overlay(), "    view: wall\n", "    view: kanban\n    lanes: diagonal\n    widths: široké\n");
    let pb = parse("book", &broken);
    assert!(!pb.views_unreadable, "broken item values: views still readable");
    let i = pb.view_items.unwrap_or_default().into_iter().find(|i| i.name == P26);
    assert_eq!(i.map(|i| (i.view, i.lanes, i.widths)), Some((UsageValue::Broken, UsageValue::Broken, UsageValue::Broken)), "view, lanes and widths Broken");
    // New, starter and built-in type files are unchanged (no `views`).
    for (name, bytes) in STARTER_FILES {
        assert!(!String::from_utf8_lossy(bytes).contains("\nviews:"), "starter {name}: no views key");
    }
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32 (bytes)

#[test]
fn fr_qry_05_ac32_display_switch_on_a_tab() {
    let a = wrote(&base(), vec![display(P26, Some(UsageView::Wall))], "(1) Wall");
    assert_eq!(a, expected("book-prectene-view-wall.yml"), "(1) line 13 → the block list with `    view: wall`");
    no_write(&a, vec![display(P26, Some(UsageView::Wall))], "(4) Wall again");
    let b = wrote(&a, vec![display(P26, Some(UsageView::List))], "(5) List");
    assert_eq!(b, expected("book-prectene-view-list.yml"), "(5) only `    view: wall` → `    view: list`");
    assert_eq!(wrote(&b, vec![display(P26, None)], "(6) Use the query's display"), base(), "(6) the flow line back: book.yml equals the fixture");
    no_write(&base(), vec![display(P26, None)], "removing an absent view");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-34 (bytes)

#[test]
fn fr_qry_05_ac34_group_menu() {
    let s2 = wrote(&base(), vec![group(VYB, key("status"))], "(2) Status");
    assert_eq!(s2, expected("book-vyborne-group-status.yml"), "(2) `    group_by: status`");
    no_write(&s2, vec![group(VYB, key("status"))], "the checked item");
    let s3 = wrote(&s2, vec![display(VYB, Some(UsageView::Wall))], "(3) Wall");
    assert_eq!(s3, expected("book-vyborne-group-status-wall.yml"), "(3) `    view: wall` before `    group_by: status`");
    let s4 = wrote(&s3, vec![lanes(VYB, Some(UsageLanes::Rows))], "(4) Rows");
    assert_eq!(s4, expected("book-vyborne-group-status-wall-rows.yml"), "(4) `    lanes: rows` after group_by");
    let s5 = wrote(&s4, vec![group(VYB, Some(UsageGroupBy::None))], "(5) None");
    assert_eq!(s5, expected("book-vyborne-group-none.yml"), "(5) `    group_by: none`; `    lanes: rows` stays");
    assert_eq!(wrote(&s5, vec![group(VYB, key("status"))], "(6) Status again"), s4, "(6) the direction comes back (lanes kept)");
    // A period grouping writes the one-line flow mapping.
    let p = wrote(&base(), vec![group(P26, Some(UsageGroupBy::Period("finished".into())))], "a period grouping");
    assert!(p.contains("  - name: Přečtené 2026\n    group_by: { finished: period }\n"), "`group_by: {{ finished: period }}`: {p}");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-35 (bytes)

#[test]
fn fr_qry_05_ac35_own_and_effective_values() {
    let o = overlay();
    assert_eq!(wrote(&o, vec![group(ROZ, None)], "(3) Use the query's grouping"), expected("book-overlay-rozectene-use-query-grouping.yml"), "(3) lines 14…15 → `  - Rozečtené`");
    assert_eq!(wrote(&o, vec![display(P26, None)], "(4) Use the query's display"), expected("book-overlay-prectene-use-query-display.yml"), "(4) lines 16…17 → `  - Přečtené 2026`");
    // (6) Status on Rozečtené: equal to the query's, yet an own value (AP-2054).
    assert_eq!(wrote(&o, vec![group(ROZ, key("status"))], "(6) Status"), expected("book-overlay-rozectene-group-status.yml"), "(6) `    group_by: status`");
    // `Use the query's grouping` removes group_by, lanes and lane_order in one write.
    let g = wrote(&o, vec![group(VYB, None)], "Use the query's grouping on Výborné knihy");
    assert_eq!(g, swap(&o, &lines(&o, 19, 20), ""), "group_by and lane_order removed, widths kept");
    let z = wrote(&o, vec![group(ZANR, None)], "Use the query's grouping on Podle žánru");
    assert_eq!(z, swap(&o, "    lanes: vertical\n", ""), "lanes removed with it (D-2192)");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-40 (bytes)

#[test]
fn fr_qry_05_ac40_grouped_list() {
    let t = wrote(&overlay(), vec![display(ZANR, Some(UsageView::Wall))], "Wall on Podle žánru");
    assert_eq!(t, expected("book-overlay-podle-zanru-wall.yml"), "line 23 → `    view: wall`; line 24 `    lanes: vertical` keeps its bytes");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42 (bytes)

#[test]
fn fr_qry_05_ac42_group_order_and_folds() {
    let o = overlay();
    let t = wrote(&o, vec![lane_order(VYB, Some(&["[[Eva Lindová]]", "[[Lucie Horká]]"]))], "Eva above Lucie");
    assert_eq!(t, expected("book-overlay-vyborne-lane-order-eva.yml"), "line 20 → D-230 quoting, one flow line");
    no_write(&o, vec![lane_order(VYB, Some(&["[[Lucie Horká]]"]))], "a drop at its own place");
    // Reset lane order on a usage: `lane_order: []` (the query has one) or removal (D-2192).
    let r = wrote(&o, vec![lane_order(VYB, Some(&[]))], "lane_order: []");
    assert_eq!(r, swap(&o, "    lane_order: [\"[[Lucie Horká]]\"]\n", "    lane_order: []\n"), "`    lane_order: []`");
    assert_eq!(wrote(&o, vec![lane_order(VYB, None)], "removal"), swap(&o, "    lane_order: [\"[[Lucie Horká]]\"]\n", ""), "the own key removed");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-43 (bytes)

#[test]
fn fr_qry_05_ac43_widths_are_stored_with_the_usage() {
    let a = wrote(&base(), vec![widths(P26, Some(&[("title", 300)]))], "(a) Title 300");
    assert_eq!(a, expected("book-prectene-widths-title-300.yml"), "(a) `    widths: {{ title: 300 }}`");
    let b = wrote(&a, vec![widths(P26, Some(&[("title", 300), ("author", 200)]))], "(a) Author 200");
    assert_eq!(b, expected("book-prectene-widths-title-300-author-200.yml"), "(a) `    widths: {{ title: 300, author: 200 }}`");
    no_write(&b, vec![widths(P26, Some(&[("author", 200), ("title", 300)]))], "the same widths in another order (compared as maps)");
    assert_eq!(wrote(&b, vec![widths(P26, Some(&[("title", 300)]))], "(f) ⌫ on Author"), a, "(f) ⌫ removes that column's entry");
    assert_eq!(wrote(&b, vec![widths(P26, None)], "(f) Reset column widths"), base(), "(f) Reset removes widths; the item turns plain again");
    assert_eq!(wrote(&a, vec![widths(P26, Some(&[]))], "an empty list"), base(), "an empty list removes widths");
    // AC-44: the 0.6.0 widths plus the change, as the UI computes them.
    let l = wrote(&base(), vec![widths(P26, Some(&[("title", 200), ("author", 180), ("rating", 150)]))], "AC-44 Rating 150");
    assert_eq!(l, expected("book-prectene-widths-legacy-rating.yml"), "AC-44: `    widths: {{ title: 200, author: 180, rating: 150 }}`");
    // A widths change keeps the item's other keys' lines (overlay Výborné knihy).
    let o = overlay();
    let v = wrote(&o, vec![widths(VYB, Some(&[("title", 300), ("author", 180)]))], "overlay Výborné knihy Title 300");
    assert_eq!(v, swap(&o, "    widths: { title: 260, author: 180 }\n", "    widths: { title: 300, author: 180 }\n"), "only line 21");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-46 (items)

#[test]
fn fr_qry_05_ac46_old_words_keep_reading() {
    let o = overlay();
    let items = parse("book", &o).view_items.unwrap_or_default();
    let autor = items.iter().find(|i| i.name == AUTOR).cloned();
    assert_eq!(autor.map(|i| (i.view, i.lanes)), Some((UsageValue::Set(UsageView::Wall), UsageValue::Set(UsageLanes::Rows))), "(a) `board` / `horizontal` read as Wall / Rows");
    let zanr = items.iter().find(|i| i.name == ZANR).cloned();
    assert_eq!(zanr.map(|i| i.lanes), Some(UsageValue::Set(UsageLanes::Columns)), "(a) `vertical` reads as Columns");
    // (c) Columns on Podle autora: only line 27; line 26 `view: board` keeps its bytes.
    assert_eq!(wrote(&o, vec![lanes(AUTOR, Some(UsageLanes::Columns))], "(c) Columns"), expected("book-overlay-podle-autora-lanes-columns.yml"), "(c) line 27 only");
    // (b) Values equal to the old words: no write.
    no_write(&o, vec![lanes(AUTOR, Some(UsageLanes::Rows))], "(b) Rows on `lanes: horizontal`");
    no_write(&o, vec![display(AUTOR, Some(UsageView::Wall))], "(b) Wall on `view: board`");
    no_write(&o, vec![lanes(ZANR, Some(UsageLanes::Columns))], "(b) Columns on `lanes: vertical`");
    // (b) Another key of the same item changes: the old words keep their bytes.
    let g = wrote(&o, vec![group(AUTOR, key("status"))], "(b) Status on Podle autora");
    assert_eq!(g, swap(&o, "    view: board\n    lanes: horizontal\n", "    view: board\n    group_by: status\n    lanes: horizontal\n"), "(b) `group_by` inserted; board and horizontal kept");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-37 (type file)

#[test]
fn fr_fmt_07_ac37_display_keys_round_trip() {
    let o = overlay();
    // CRLF and no-final-newline copies keep their line endings.
    let crlf = o.replace('\n', "\r\n");
    assert_eq!(wrote(&crlf, vec![lanes(AUTOR, Some(UsageLanes::Columns))], "CRLF Columns"), expected("book-overlay-podle-autora-lanes-columns-crlf.yml"), "the CRLF copy");
    let nonl = o.strip_suffix('\n').unwrap_or(&o).to_string();
    assert_eq!(wrote(&nonl, vec![lanes(AUTOR, Some(UsageLanes::Columns))], "no-newline Columns"), expected("book-overlay-podle-autora-lanes-columns-no-newline.yml"), "the no-final-newline copy");
    // Every type op other than the views ops keeps lines 13…28 byte for byte.
    let views = lines(&o, 13, 28);
    for (what, op) in [
        ("colour", TypeOp::SetColor("red".into())),
        ("description", TypeOp::SetDescription(Some("Jiný popis knih.".into()))),
        ("columns", TypeOp::SetColumns(strs(&["author", "rating"]))),
        ("preview", TypeOp::SetPreview(strs(&["rating"]))),
        ("remove property", TypeOp::RemoveAttribute("rating".into())),
    ] {
        let t = wrote(&o, vec![op], what);
        assert!(t.contains(&views), "{what}: lines 13…28 byte-identical");
    }
    // The ops keep every item they don't name, and an op on one item keeps the other items' lines (old words included).
    let t = wrote(&o, vec![display(P26, Some(UsageView::Table))], "Table on Přečtené 2026");
    assert_eq!(t, swap(&o, "  - name: Přečtené 2026\n    view: wall\n", "  - name: Přečtené 2026\n    view: table\n"), "only line 17");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-34 (bytes)

#[test]
fn fr_qry_07_ac34_rename_duplicate_remove_trash_carry_the_keys() {
    let o = overlay();
    // (a) The query rename patches only the item's name token.
    assert_eq!(rename_view(&o, VYB, "Nejlepší knihy"), Some(expected("book-overlay-vyborne-renamed.yml")), "(a) line 18 only; lines 19…21 kept");
    // (b) Duplicate: the names with the copy after the original, then the copy's settings in one patch.
    let names = [ROZ, P26, VYB, "Výborné knihy (2)", ZANR, AUTOR, ZED];
    let d = wrote(&o, vec![set_views(&names), TypeOp::CopyViewSettings { from: VYB.into(), to: "Výborné knihy (2)".into() }], "(b) Duplicate");
    assert_eq!(d, expected("book-overlay-vyborne-duplicate.yml"), "(b) lines 18…21 copied after line 21 with the new name");
    // (c) Remove from Books page, then Show a saved query (a plain name at the end).
    let c = wrote(&o, vec![set_views(&[ROZ, P26, VYB, AUTOR, ZED])], "(c) Remove Podle žánru");
    assert_eq!(c, expected("book-overlay-without-podle-zanru.yml"), "(c) lines 22…24 removed");
    assert_eq!(wrote(&c, vec![set_views(&[ROZ, P26, VYB, AUTOR, ZED, ZANR])], "(c) Show a saved query"), expected("book-overlay-readded-podle-zanru.yml"), "(c) added back as a plain name");
    // (d) Move to trash from the view menu: lines 25…27 removed; Undo restores them byte for byte.
    let t = wrote(&o, vec![set_views(&[ROZ, P26, VYB, ZANR, ZED])], "(d) trash Podle autora");
    assert_eq!(t, expected("book-overlay-without-podle-autora.yml"), "(d) lines 25…27 removed");
    assert_eq!(wrote(&t, vec![TypeOp::SetViewsSource(lines(&o, 13, 28))], "(d) Undo"), o, "(d) Undo restores lines 13…28");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-35 (bytes)

#[test]
fn fr_qry_07_ac35_items_with_display_keys_read_and_kept() {
    let o = overlay();
    // A sort change on Celá zeď: line 28 → name + sort; lines 14…27 keep their bytes.
    let s = wrote(&o, vec![TypeOp::SetViewSort { name: ZED.into(), sort: Some(vec![UsageSort { by: "title".into(), order: UsageOrder::Desc }]) }], "sort on Celá zeď");
    assert_eq!(s, expected("book-overlay-cela-zed-sort-desc.yml"), "line 28 → `  - name: Celá zeď` / `    sort: {{ by: title, order: desc }}`");
    // An unknown item key survives a display change, after the known keys.
    let x = expected("book-overlay-xbarva-input.yml");
    assert_eq!(wrote(&x, vec![display(VYB, Some(UsageView::Wall))], "x-barva + Wall"), expected("book-overlay-xbarva-after-display.yml"), "`x-barva: modrá` kept after the known keys");
    // An NFD item name resolves as its NFC form.
    let n = swap(&o, "  - name: Výborné knihy\n", &format!("  - name: {}\n", nfd(VYB)));
    assert_eq!(parse("book", &n).view_items.map(|i| i.into_iter().map(|x| x.name).collect::<Vec<_>>()), Some(strs(&[ROZ, P26, VYB, ZANR, AUTOR, ZED])), "the NFD name reads as NFC");
    // Listed twice with different views: the first item wins (read and write).
    let twice = swap(&o, "  - Celá zeď\n", "  - Celá zeď\n  - name: Rozečtené\n    view: table\n");
    let first = parse("book", &twice).view_items.unwrap_or_default().into_iter().find(|i| i.name == ROZ);
    assert_eq!(first.map(|i| (i.view, i.group_by)), Some((UsageValue::Absent, UsageValue::Set(UsageGroupBy::None))), "the first `Rozečtené` item wins");
    let w = wrote(&twice, vec![display(ROZ, Some(UsageView::List))], "List on the repeated name");
    assert!(w.contains("  - name: Rozečtené\n    view: list\n    group_by: none\n") && w.contains("  - name: Rozečtené\n    view: table\n"), "the first item gets the write, the second keeps its lines: {w}");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-16 (items)

#[test]
fn fr_fmt_12_ac16_display_keys_are_nfc() {
    let o = overlay();
    let n = swap(&swap(&swap(&o, "  - name: Výborné knihy\n", &format!("  - name: {}\n", nfd(VYB))), "[[Lucie Horká]]", &nfd("[[Lucie Horká]]")), "    group_by: author\n", "    group_by: author\n");
    let n = swap(&n, "    widths: { title: 260, author: 180 }\n", "    widths: { title: 260, author: 180, poznámka: 90 }\n");
    let n = swap(&n, "poznámka: 90", &format!("{}: 90", nfd("poznámka")));
    let item = parse("book", &n).view_items.unwrap_or_default().into_iter().find(|i| i.name == VYB);
    assert_eq!(item.as_ref().map(|i| i.lane_order.clone()), Some(UsageValue::Set(strs(&["[[Lucie Horká]]"]))), "an NFD lane_order value reads as NFC");
    assert_eq!(
        item.map(|i| i.widths),
        Some(UsageValue::Set(vec![("title".into(), 260), ("author".into(), 180), ("poznámka".into(), 90)])),
        "an NFD widths key reads as NFC"
    );
    // A write of the new keys is NFC; the NFD name and the NFD value the user didn't change keep their bytes.
    let w = wrote(&n, vec![display(VYB, Some(UsageView::List))], "List on the NFD-named item");
    assert!(w.contains(&format!("  - name: {}\n    view: list\n", nfd(VYB))), "the name line keeps its NFD bytes; `view: list` inserted");
    assert!(w.contains(&nfd("[[Lucie Horká]]")), "the unchanged NFD lane_order value keeps its bytes");
    let l = wrote(&n, vec![lane_order(VYB, Some(&[&nfd("[[Eva Lindová]]")]))], "an NFD lane_order change");
    assert!(l.contains("    lane_order: [\"[[Eva Lindová]]\"]\n"), "written NFC: {l}");
    let g = wrote(&base(), vec![group(P26, Some(UsageGroupBy::Key(nfd("žánry"))))], "an NFD group key");
    assert!(g.contains("    group_by: žánry\n"), "the group key written NFC: {g}");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-30, FR-TSK-05 AC-23 (task.yml bytes)

#[test]
fn fr_tsk_04_ac30_schedule_is_a_wall_grouped_by_due_period() {
    let t = task();
    let a = wrote_k("task", &t, vec![display("Schedule", Some(UsageView::Table))], "(2) Table on Schedule");
    assert_eq!(a, expected("task-schedule-view-table.yml"), "(2) line 11 → the block list with `    view: table`");
    assert_eq!(wrote_k("task", &a, vec![display("Schedule", None)], "(5) Use the query's display"), t, "(5) line 11 back byte for byte");
}

#[test]
fn fr_tsk_05_ac23_kanban_is_a_wall_lane_order_on_the_tab() {
    let t = task();
    let a = wrote_k("task", &t, vec![lane_order("Kanban", Some(&["Waiting", "To do", "In progress", "Done", "Rozpracováno"]))], "(2) Waiting before To do");
    assert_eq!(a, expected("task-kanban-lane-order-waiting.yml"), "(2) the Kanban item's lane_order");
}
