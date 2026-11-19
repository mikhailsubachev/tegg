//! Slice Q2, L4 at `tegg-schema` (docs/acceptance/views.md R184, AR-07 AC-9; FR-QRY-07 AC-4, AC-6, AC-8, AC-10, AC-12,
//! AC-14 and FR-FMT-07 AC-33 / FR-FMT-12 AC-12 for the type-file bytes): `TypeFile.views` read from a flow or block list,
//! `Parsed.views_unreadable`, `TypeOp::SetViews` (one flow line at the TOP place after `columns`, a block list replaced,
//! `views: []`, D-230 quoting, NFC, no-op without a write, refused when unreadable), every other op keeping the `views`
//! bytes, new / starter / built-in files without `views`, `rename_view`. Interface docs/contracts/v1-views.md §1.3.
//! Inputs: tests/fixtures/vaults/views/.tegg/types/; expected bytes tests/fixtures/queries-files/expected/views/types/.
//! Written from the ACs and the contract only (D-61). Nothing is written to disk.

use std::path::PathBuf;

use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
fn book() -> String {
    read("tests/fixtures/vaults/views/.tegg/types/book.yml")
}
fn autor() -> String {
    read("tests/fixtures/vaults/views/.tegg/types/autor.yml")
}
fn expected(name: &str) -> String {
    read(&format!("tests/fixtures/queries-files/expected/views/types/{name}"))
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "setup: {from:?} in the text");
    text.replacen(from, to, 1)
}
const LINE13: &str = "views: [Rozečtené, Přečtené 2026, Výborné knihy]\n";
fn book_with(line: &str) -> String {
    swap(&book(), LINE13, line)
}
fn nfd(s: &str) -> String {
    s.replace('é', "e\u{301}").replace('č', "c\u{30C}").replace('ř', "r\u{30C}").replace('ž', "z\u{30C}").replace('Č', "C\u{30C}")
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
fn names(self_key: &str) -> Vec<TypeNames<'static>> {
    NAMES.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == self_key }).collect()
}
fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others = names(key);
    patch(key, text, &ops, &PatchContext { others: &others })
}
fn set_views(v: &[&str]) -> TypeOp {
    TypeOp::SetViews(v.iter().map(|s| s.to_string()).collect())
}
fn views_of(key: &str, text: &str) -> Option<Vec<String>> {
    parse(key, text).def.views
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-9

#[test]
fn ar_07_ac9_views_is_an_optional_version_1_key() {
    assert_eq!(CURRENT_VERSION, 1, "CURRENT_VERSION stays 1");
    let cases: Vec<(&str, String, Option<Vec<String>>)> = vec![
        ("the fixture's flow list", book(), Some(strs(&["Rozečtené", "Přečtené 2026", "Výborné knihy"]))),
        ("a block list", book_with("views:\n  - Rozečtené\n  - Přečtené 2026\n"), Some(strs(&["Rozečtené", "Přečtené 2026"]))),
        ("an empty list", book_with("views: []\n"), Some(vec![])),
        ("a quoted name", book_with("views: [\"Čtu, až bude čas\"]\n"), Some(strs(&["Čtu, až bude čas"]))),
        ("an NFD name (read NFC)", book_with(&format!("views: [{}]\n", nfd("Rozečtené"))), Some(strs(&["Rozečtené"]))),
        ("absent", autor(), None),
    ];
    for (what, text, want) in cases {
        let p = parse("book", &text);
        assert_eq!(p.readability, Readability::Ok, "{what}: Ok with version 1, never Newer");
        assert!(!p.views_unreadable, "{what}: readable");
        assert_eq!(p.def.views, want, "{what}: TypeFile.views");
    }
    for bad in ["views: Rozečtené\n", "views: { a: b }\n", "views: [Rozečtené, [x]]\n"] {
        let p = parse("book", &book_with(bad));
        assert_eq!(p.readability, Readability::Ok, "{bad:?}: the type file stays Ok");
        assert!(p.views_unreadable, "{bad:?}: Parsed.views_unreadable");
        assert_eq!(p.def.views, None, "{bad:?}: views reads as None");
    }
}

#[test]
fn ar_07_ac9_views_is_an_optional_version_1_key_new_starter_and_built_in_files() {
    assert_eq!(views_of("book", &book()), Some(strs(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])), "setup: the fixture's views are read");
    assert_eq!(new_type_file("Čajovna", "Čajovny"), read("tests/fixtures/types/expected/čajovna.yml"), "a new type file is byte-identical to its fixture (no views)");
    for (name, bytes) in STARTER_FILES {
        assert!(!String::from_utf8_lossy(bytes).contains("\nviews:"), "starter {name}: no views key");
    }
    for key in SYSTEM_KEYS {
        let text = builtin(key).map(str::to_string).unwrap_or_default();
        assert!(!text.contains("\nviews:"), "built-in {key}: no views key (D-90)");
        assert_eq!(views_of(key, &text), None, "built-in {key}: views None");
    }
    let def = parse("book", &book()).def;
    assert!(serialize(&def).contains(LINE13), "serialize writes views when the definition has them");
    assert_eq!(parse("book", &serialize(&def)).def, def, "parse → canonical write → parse is equal (AR-07 AC-6)");
}

#[test]
fn ar_07_ac9_views_is_an_optional_version_1_key_other_ops_keep_its_bytes() {
    assert_eq!(views_of("book", &book_with("views:\n  - Rozečtené\n")), Some(strs(&["Rozečtené"])), "setup: a block list is read");
    for (what, lines) in [("flow", LINE13), ("block", "views:\n  - Rozečtené\n  - Výborné knihy\n"), ("scalar", "views: Rozečtené\n"), ("mapping", "views: { a: b }\n")] {
        let s = book_with(lines);
        let ops: Vec<(&str, TypeOp)> = vec![
            ("colour", TypeOp::SetColor("red".into())),
            ("description", TypeOp::SetDescription(Some("Jiný popis.".into()))),
            ("preview", TypeOp::SetPreview(vec!["rating".into()])),
            ("columns", TypeOp::SetColumns(vec!["author".into(), "rating".into()])),
            ("move property", TypeOp::MoveAttribute { key: "genres".into(), to: 0 }),
            ("remove property", TypeOp::RemoveAttribute("finished".into())),
        ];
        for (op_name, op) in ops {
            match do_patch("book", &s, vec![op]) {
                Ok(Some(t)) => assert!(t.contains(lines), "{what}, {op_name}: the views lines stay byte-identical:\n{t}"),
                other => assert!(false, "{what}, {op_name}: expected a write, got {other:?}"),
            }
        }
    }
    // Every readable runtime variant of FR-QRY-07 AC-12 round-trips (AR-07 AC-6).
    for line in [LINE13, "views: [Rozečtené, rozečtené, Rozečtené]\n", "views: [Ztracený pohled]\n", "views:\n  - Rozečtené\n", "views: []\n"] {
        let t = book_with(line);
        assert_eq!(do_patch("book", &t, vec![]), Ok(None), "{line:?}: no change writes nothing");
        let p = parse("book", &t);
        assert!(p.def.views.is_some(), "{line:?}: read");
        assert_eq!(parse("book", &serialize(&p.def)).def, p.def, "{line:?}: round trip");
    }
}

// ------------------------------------------------------------------------------------------------ the SetViews bytes

#[test]
fn fr_qry_07_ac4_new_view_creates_a_query_and_a_tab() {
    assert_eq!(do_patch("autor", &autor(), vec![set_views(&["New view"])]), Ok(Some(expected("autor-views-new-view.yml"))), "(b) inserted after line 10 (TOP place)");
    assert_eq!(
        do_patch("book", &book(), vec![set_views(&["Rozečtené", "Přečtené 2026", "Výborné knihy", "New view"])]),
        Ok(Some(expected("book-views-new-view.yml"))),
        "(c) line 13 only"
    );
    assert_eq!(do_patch("autor", &autor(), vec![set_views(&["Čtu, až bude čas"])]), Ok(Some(swap(&autor(), "preview: [poznámka]\n", "preview: [poznámka]\nviews: [\"Čtu, až bude čas\"]\n"))), "D-230 quoting");
}

#[test]
fn fr_qry_07_ac5_show_a_saved_query() {
    assert_eq!(
        do_patch("book", &book(), vec![set_views(&["Rozečtené", "Přečtené 2026", "Výborné knihy", "Podle žánru"])]),
        Ok(Some(expected("book-views-podle-zanru.yml"))),
        "line 13 only"
    );
}

#[test]
fn fr_qry_07_ac6_reorder_tabs_writes_views_once() {
    assert_eq!(do_patch("book", &book(), vec![set_views(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])]), Ok(Some(expected("book-views-dragged.yml"))), "the drag");
    assert_eq!(do_patch("book", &book(), vec![set_views(&["Přečtené 2026", "Rozečtené", "Výborné knihy"])]), Ok(Some(expected("book-views-move-right.yml"))), "Move view right");
    assert_eq!(do_patch("book", &book(), vec![set_views(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])]), Ok(None), "the same list: no write");
}

#[test]
fn fr_qry_07_ac9_duplicate_adds_a_tab_after_the_original() {
    assert_eq!(
        do_patch("book", &book(), vec![set_views(&["Rozečtené", "Přečtené 2026", "Výborné knihy", "Výborné knihy (2)"])]),
        Ok(Some(expected("book-views-duplicate.yml"))),
        "the copy after the original"
    );
}

#[test]
fn fr_qry_07_ac10_remove_keeps_the_query() {
    assert_eq!(do_patch("book", &book(), vec![set_views(&["Rozečtené", "Výborné knihy"])]), Ok(Some(expected("book-views-removed.yml"))), "remove one");
    assert_eq!(do_patch("book", &expected("book-views-removed.yml"), vec![set_views(&[])]), Ok(Some(expected("book-views-empty.yml"))), "the last ones: `views: []`, the key stays");
}

#[test]
fn fr_qry_07_ac12_odd_views_and_broken_views() {
    let block = book_with("views:\n  - Rozečtené\n  - Přečtené 2026\n  - Výborné knihy\n");
    assert_eq!(do_patch("book", &block, vec![set_views(&["Rozečtené", "Výborné knihy"])]), Ok(Some(expected("book-views-block-to-flow.yml"))), "(c) a block list becomes one flow line in its place");
    let dup = book_with("views: [Rozečtené, rozečtené, Ztracený pohled]\n");
    assert_eq!(do_patch("book", &dup, vec![set_views(&["Ztracený pohled"])]), Ok(Some(book_with("views: [Ztracený pohled]\n"))), "(b) Remove of every copy");
    for bad in ["views: Rozečtené\n", "views: { a: b }\n"] {
        let r = do_patch("book", &book_with(bad), vec![set_views(&["Rozečtené"])]);
        assert_eq!(r, Err(SchemaError::Rule(RuleError::ViewsUnreadable)), "(d) {bad:?}: refused");
    }
    let newer = swap(&book(), "version: 1\n", "version: 2\n");
    assert!(do_patch("book", &newer, vec![set_views(&["Rozečtené"])]).is_err(), "(e) a version 2 file: refused");
    assert_eq!(views_of("book", &newer), Some(strs(&["Rozečtené", "Přečtené 2026", "Výborné knihy"])), "(e) its tabs are still read");
}

#[test]
fn fr_qry_07_ac14_which_type_pages_have_views() {
    let page = builtin("page").map(str::to_string).unwrap_or_default();
    match do_patch("page", &page, vec![set_views(&["New view"])]) {
        Ok(Some(t)) => {
            let lines: Vec<&str> = t.split('\n').collect();
            let at = lines.iter().position(|l| l.starts_with("views: "));
            assert_eq!(at.map(|i| lines[i]), Some("views: [New view]"), "the built-in page.yml gains one views line (D-90)");
            let without: Vec<&str> = lines.iter().enumerate().filter(|(i, _)| Some(*i) != at).map(|(_, l)| *l).collect();
            assert_eq!(without.join("\n"), page, "and nothing else");
        }
        other => assert!(false, "a write of the built-in page.yml, got {other:?}"),
    }
    let task = builtin("task").map(str::to_string).unwrap_or_default();
    let hand = format!("{task}views: [Rozečtené]\n");
    let p = parse("task", &hand);
    assert_eq!(p.def.views, Some(strs(&["Rozečtené"])), "a hand-written views: in task.yml is read (and kept)");
    assert_eq!(do_patch("task", &hand, vec![TypeOp::SetColor("red".into())]).map(|t| t.map(|t| t.contains("views: [Rozečtené]\n"))), Ok(Some(true)), "and kept by other ops");
}

#[test]
fn fr_qry_07_ac8_rename_patches_views() {
    assert_eq!(rename_view(&book(), "Přečtené 2026", "Přečtené letos"), Some(expected("book-views-renamed.yml")), "the flow entry in place");
    assert_eq!(rename_view(&book(), "přečtené 2026", "Přečtené letos"), Some(expected("book-views-renamed.yml")), "by name key (case-insensitive)");
    assert_eq!(rename_view(&book(), &nfd("Přečtené 2026"), "Přečtené letos"), Some(expected("book-views-renamed.yml")), "and NFC");
    let block = book_with("views:\n  - Rozečtené\n  - Přečtené 2026\n");
    assert_eq!(rename_view(&block, "Přečtené 2026", "Čtu, až bude čas"), Some(book_with("views:\n  - Rozečtené\n  - \"Čtu, až bude čas\"\n")), "a block entry, D-230 quoting");
    assert_eq!(rename_view(&book(), "Podle žánru", "Žánry"), None, "nothing matches: None");
    assert_eq!(rename_view(&autor(), "Přečtené 2026", "X"), None, "no views: None");
    assert_eq!(rename_view(&book_with("views: Přečtené 2026\n"), "Přečtené 2026", "X"), None, "unreadable: None");
}

#[test]
fn fr_fmt_07_ac33_type_files_and_notes_round_trip() {
    let crlf = book().replace('\n', "\r\n");
    assert_eq!(do_patch("book", &crlf, vec![set_views(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])]), Ok(Some(expected("book-views-crlf-dragged.yml"))), "CRLF kept");
    let nonl = book().trim_end_matches('\n').to_string();
    assert_eq!(do_patch("book", &nonl, vec![set_views(&["Výborné knihy", "Rozečtené", "Přečtené 2026"])]), Ok(Some(expected("book-views-no-newline-dragged.yml"))), "no final newline kept");
}

#[test]
fn fr_fmt_12_ac12_view_names_and_lanes_are_nfc() {
    assert_eq!(
        do_patch("book", &book(), vec![TypeOp::SetViews(vec![nfd("Výborné knihy"), nfd("Rozečtené"), "Přečtené 2026".into()])]),
        Ok(Some(expected("book-views-dragged.yml"))),
        "the views write is NFC"
    );
}
