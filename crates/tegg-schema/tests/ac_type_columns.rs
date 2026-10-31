//! Configurable type-page columns, `tegg-schema` side (L4): docs/acceptance/type-columns.md FR-TYP-09 AC-20, AC-21,
//! AC-25, AC-26, AC-27 (c) (the bytes of the `columns` line), AR-07 AC-8 (`columns` is an optional key of version 1);
//! BRD D-1240, D-1243, D-1245, D-1251. Interface: docs/contracts/type-columns.md §1 (`TypeFile.columns:
//! Option<Vec<String>>`, `Parsed.columns_unreadable`, `Parsed.columns_ignored`, `TypeOp::SetColumns`,
//! `RuleError::ColumnsUnreadable`, TOP order `… preview, hidden, columns, embed, template, attributes`) and
//! docs/contracts/ms3-shell.md §14.1.4 (patch rules). Written from the ACs and the contracts only (D-61). Fixtures are
//! read-only; the runtime variants of the ACs' fixture table are made here in memory; nothing is written to disk.
//!
//! `TypeFile.columns` is read through the definition's `Debug` text (`columns: Some([..])` / `columns: None`): a struct
//! literal of `TypeFile` in an existing AC test (ac_schema.rs) keeps the red commit from adding the field as a stub.

use std::path::PathBuf;

use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
fn ty(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/types/.tegg/types/{key}.yml"))
}

const SYSTEM: [(&str, &str, &str); 7] = [
    ("page", "Page", "Pages"),
    ("task", "Task", "Tasks"),
    ("quick-note", "Quick Note", "Quick Notes"),
    ("daily-note", "Daily Note", "Daily"),
    ("tag", "Tag", "Tags"),
    ("image", "Image", "Images"),
    ("pdf", "PDF", "PDFs"),
];
const USER: [(&str, &str, &str); 6] = [
    ("schůzka", "Schůzka", "Schůzky"),
    ("osoba", "Osoba", "Osoby"),
    ("projekt", "Projekt", "Projekty"),
    ("nápad", "Nápad", "Nápady"),
    ("prázdný", "Prázdný", "Prázdné"),
    ("budoucí", "Budoucí", "Budoucí"),
];

fn names(self_key: &str) -> Vec<TypeNames<'static>> {
    SYSTEM.iter().chain(USER.iter()).map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == self_key }).collect()
}
fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others = names(key);
    patch(key, text, &ops, &PatchContext { others: &others })
}
fn cols(keys: &[&str]) -> TypeOp {
    TypeOp::SetColumns(keys.iter().map(|s| s.to_string()).collect())
}
/// `text` with the first occurrence of `from` replaced by `to`; fails if `from` isn't there (fixture drift).
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
/// The `Debug` spelling of `TypeFile.columns` (contract §1): `None` or `Some(["a", "b"])`.
fn columns_debug(keys: Option<&[&str]>) -> String {
    match keys {
        None => "columns: None".to_string(),
        Some(k) => format!("columns: Some({:?})", k.iter().map(|s| s.to_string()).collect::<Vec<String>>()),
    }
}
/// Whether `parse(key, text).def` reads `columns` as `keys` (contract §1).
fn reads_columns(key: &str, text: &str, keys: Option<&[&str]>) -> (bool, String) {
    let dbg = format!("{:?}", parse(key, text).def);
    let want = columns_debug(keys);
    // `columns: Some([..])` is followed by `,` or ` }` in the derived Debug text.
    let hit = dbg.contains(&format!("{want},")) || dbg.contains(&format!("{want} }}"));
    (hit, dbg)
}
fn assert_reads(key: &str, text: &str, keys: Option<&[&str]>, what: &str) {
    let (hit, dbg) = reads_columns(key, text, keys);
    assert!(hit, "{what}: TypeFile.columns reads as {} (contract §1); definition: {dbg}", columns_debug(keys));
}

const PREVIEW_S: &str = "preview: [datum, účastníci]\n";
fn schuzka() -> String {
    ty("schůzka")
}
/// The fixture `schůzka.yml` with `line` inserted right after its `preview:` line.
fn schuzka_with(line: &str) -> String {
    swap(&schuzka(), PREVIEW_S, &format!("{PREVIEW_S}{line}"))
}
const NFD_MISTO: &str = "mi\u{301}sto";

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-20

#[test]
fn fr_typ_09_ac20_set_columns_inserts_one_flow_line_after_preview() {
    let s = schuzka();
    let one = do_patch("schůzka", &s, vec![cols(&["datum", "účastníci", "modified", "místo"])]);
    assert_eq!(one, Ok(Some(schuzka_with("columns: [datum, účastníci, modified, místo]\n"))), "(a) checking Místo: one line after line 11, every other byte unchanged");
    let first = one.ok().flatten().unwrap_or_default();
    assert_reads("schůzka", &first, Some(&["datum", "účastníci", "modified", "místo"]), "read back");
    let two = do_patch("schůzka", &first, vec![cols(&["datum", "účastníci", "místo"])]);
    assert_eq!(two, Ok(Some(schuzka_with("columns: [datum, účastníci, místo]\n"))), "(b) unchecking Modified: only the columns line changes");
    let second = two.ok().flatten().unwrap_or_default();
    assert_eq!(do_patch("schůzka", &second, vec![cols(&["datum", "účastníci", "místo"])]), Ok(None), "an unchanged list on an existing key writes nothing (FR-SYN-06)");
    assert_eq!(
        do_patch("schůzka", &second, vec![cols(&[])]),
        Ok(Some(schuzka_with("columns: []\n"))),
        "(c) unchecking every item writes `columns: []` (the key is never removed once written)"
    );
    assert!(second.contains(PREVIEW_S), "the preview line is untouched");
}

#[test]
fn fr_typ_09_ac20_columns_line_placement_follows_the_top_order() {
    // (d) osoba: between `preview: [firma]` and the unknown key; comment and final newline byte-identical (AR-07 AC-5).
    let o = ty("osoba");
    assert_eq!(
        do_patch("osoba", &o, vec![cols(&["modified"])]),
        Ok(Some(swap(&o, "preview: [firma]\npoznámka-pro-mě:", "preview: [firma]\ncolumns: [modified]\npoznámka-pro-mě:"))),
        "osoba.yml: unchecking Firma"
    );
    // (d) with `hidden: [místo]` after preview, the columns line goes after the hidden line.
    let h = schuzka_with("hidden: [místo]\n");
    assert_eq!(
        do_patch("schůzka", &h, vec![cols(&["datum", "účastníci", "modified", "místo"])]),
        Ok(Some(swap(&h, "hidden: [místo]\n", "hidden: [místo]\ncolumns: [datum, účastníci, modified, místo]\n"))),
        "after the hidden line (TOP order … preview, hidden, columns, template, attributes; D-1243)"
    );
    // (d) nápad: between preview and template.
    let n = ty("nápad");
    assert_eq!(
        do_patch("nápad", &n, vec![cols(&["hodnocení", "modified", "review"])]),
        Ok(Some(swap(&n, "preview: [hodnocení]\ntemplate:", "preview: [hodnocení]\ncolumns: [hodnocení, modified, review]\ntemplate:"))),
        "nápad.yml: checking Review"
    );
}

#[test]
fn fr_typ_09_ac20_a_file_without_version_gets_version_1_with_the_first_columns_write() {
    // (f) as AR-07 AC-2: `version: 1` first after the header comment, and nothing else but the columns line.
    let o = ty("osoba");
    let no_version = swap(&o, "version: 1\n", "");
    let got = do_patch("osoba", &no_version, vec![cols(&["modified"])]);
    assert_eq!(got, Ok(Some(swap(&o, "preview: [firma]\n", "preview: [firma]\ncolumns: [modified]\n"))), "version: 1 written back, plus the columns line");
}

#[test]
fn fr_typ_09_ac20_seeding_keeps_preview_as_written() {
    // (e) the UI seeds from the shown columns; the schema writes the given list and leaves `preview: [datum, neznámý]`.
    let s = swap(&schuzka(), PREVIEW_S, "preview: [datum, neznámý]\n");
    assert_eq!(
        do_patch("schůzka", &s, vec![cols(&["datum", "modified", "místo"])]),
        Ok(Some(swap(&s, "preview: [datum, neznámý]\n", "preview: [datum, neznámý]\ncolumns: [datum, modified, místo]\n"))),
        "preview stays as written"
    );
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-21

#[test]
fn fr_typ_09_ac21_no_limit_on_columns() {
    let p = ty("projekt");
    let all = ["stav", "období", "modified", "rozpočet", "aktivní", "oblasti", "web", "poznámka", "tags", "source", "aliases", "created"];
    let got = do_patch("projekt", &p, vec![cols(&all)]);
    assert_eq!(
        got,
        Ok(Some(swap(&p, "preview: [stav, období]\n", "preview: [stav, období]\ncolumns: [stav, období, modified, rozpočet, aktivní, oblasti, web, poznámka, tags, source, aliases, created]\n"))),
        "12 keys in one flow line, no PreviewFull; preview unchanged"
    );
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-25

#[test]
fn fr_typ_09_ac25_hand_written_entries_are_read_reported_and_kept() {
    let s = schuzka_with("columns: [datum, neznámý, datum, title, místo]\n");
    let p = parse("schůzka", &s);
    assert_eq!(p.readability, Readability::Ok, "a hand-written list is a readable file");
    assert_reads("schůzka", &s, Some(&["datum", "neznámý", "datum", "title", "místo"]), "(a) every entry as written");
    assert_eq!(p.columns_ignored, vec!["neznámý".to_string()], "(a) the unknown key is reported once; `title` and repeats are not warnings (D-1245)");
    assert!(!p.columns_unreadable, "a list is readable");
    assert_eq!(
        do_patch("schůzka", &s, vec![cols(&["datum", "neznámý", "datum", "title", "místo", "created"])]),
        Ok(Some(schuzka_with("columns: [datum, neznámý, datum, title, místo, created]\n"))),
        "(a) checking Created keeps every hand-written entry in place"
    );
    assert_eq!(
        do_patch("schůzka", &s, vec![cols(&["neznámý", "title", "místo", "created"])]),
        Ok(Some(schuzka_with("columns: [neznámý, title, místo, created]\n"))),
        "(a) the list the UI sends after unchecking Datum is written as given"
    );
}

#[test]
fn fr_typ_09_ac25_nfd_entries_match_and_are_written_nfc() {
    let s = schuzka_with(&format!("columns: [datum, {NFD_MISTO}]\n"));
    let p = parse("schůzka", &s);
    assert_eq!(p.readability, Readability::Ok, "readable");
    assert_reads("schůzka", &s, Some(&["datum", NFD_MISTO]), "(b) the NFD entry is kept as written");
    assert_eq!(p.columns_ignored, Vec::<String>::new(), "(b) the NFD `místo` matches the attribute Místo: not ignored (FR-FMT-12)");
    assert_eq!(
        do_patch("schůzka", &s, vec![TypeOp::SetColumns(vec!["datum".into(), NFD_MISTO.into(), "created".into()])]),
        Ok(Some(schuzka_with("columns: [datum, místo, created]\n"))),
        "(b) the next write writes every entry in NFC"
    );
}

#[test]
fn fr_typ_09_ac25_block_list_is_read_and_replaced_by_one_flow_line() {
    let s = schuzka_with("columns:\n  - datum\n  - místo\n");
    assert_reads("schůzka", &s, Some(&["datum", "místo"]), "(c) a block list reads like a flow list");
    assert_eq!(do_patch("schůzka", &s, vec![cols(&["datum", "místo"])]), Ok(None), "the same list writes nothing");
    assert_eq!(
        do_patch("schůzka", &s, vec![cols(&["datum", "místo", "created"])]),
        Ok(Some(schuzka_with("columns: [datum, místo, created]\n"))),
        "(c) the next write replaces the block lines with one flow line; the other lines unchanged"
    );
}

#[test]
fn fr_typ_09_ac25_a_value_that_is_not_a_list_keeps_the_file_valid_and_refuses_columns_writes() {
    for (what, line) in [("scalar", "columns: datum\n"), ("mapping", "columns: { a: b }\n"), ("list with a non-string", "columns: [datum, [a, b]]\n")] {
        let s = schuzka_with(line);
        let p = parse("schůzka", &s);
        assert_eq!(p.readability, Readability::Ok, "{what}: the type file stays valid (AR-07 AC-4 unchanged)");
        assert!(p.columns_unreadable, "{what}: Parsed.columns_unreadable (contract §1)");
        assert_reads("schůzka", &s, None, &format!("{what}: columns reads as None (fallback columns)"));
        assert_eq!(do_patch("schůzka", &s, vec![cols(&["datum"])]), Err(SchemaError::Rule(RuleError::ColumnsUnreadable)), "{what}: SetColumns is refused");
        // Other type settings still work and keep the hand-written line byte-identical (AR-07 AC-8).
        let c = do_patch("schůzka", &s, vec![TypeOp::SetColor("red".into())]);
        assert_eq!(c, Ok(Some(swap(&s, "color: teal\n", "color: red\n"))), "{what}: a colour change keeps the columns line");
    }
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-26

#[test]
fn fr_typ_09_ac26_remove_attribute_removes_every_columns_entry_in_the_same_write() {
    let s = swap(&schuzka(), PREVIEW_S, &format!("preview: [datum, místo]\nhidden: [místo]\ncolumns: [datum, místo, {NFD_MISTO}, modified, místo]\n"));
    let item = "  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n";
    let want = swap(&swap(&s, item, ""), &format!("preview: [datum, místo]\nhidden: [místo]\ncolumns: [datum, místo, {NFD_MISTO}, modified, místo]\n"), "preview: [datum]\nhidden: []\ncolumns: [datum, modified]\n"); // D-1256: `hidden: []` stays (FR-TYP-17 AC-1)
    assert_eq!(
        do_patch("schůzka", &s, vec![TypeOp::RemoveAttribute("místo".into())]),
        Ok(Some(want)),
        "(a) the item, its preview and hidden keys and every columns entry (repeats and NFD spellings) go in one change"
    );
}

#[test]
fn fr_typ_09_ac26_other_schema_changes_never_write_columns() {
    let line = "columns: [místo, datum]\n";
    let s = schuzka_with(line);
    assert_reads("schůzka", &s, Some(&["místo", "datum"]), "setup: the runtime columns are read");
    let rename = TypeOp::UpdateAttribute { key: "místo".into(), change: AttrChange { name: Some("Místo konání".into()), ..Default::default() } };
    let widen = TypeOp::UpdateAttribute { key: "místo".into(), change: AttrChange { r#type: Some(AttrType::parse("long-text")), ..Default::default() } };
    let ops: Vec<(&str, TypeOp)> = vec![
        ("(b) rename Místo", rename),
        ("(c) widen Místo to Long text (D-808)", widen),
        ("(d) Name", TypeOp::SetName("Porada".into())),
        ("(d) Plural", TypeOp::SetPlural("Porady".into())),
        ("(d) icon", TypeOp::SetIcon("calendar".into())),
        ("(d) colour", TypeOp::SetColor("red".into())),
        ("(d) folder", TypeOp::SetFolder("Porady".into())),
        ("(d) review workflow", TypeOp::SetReview(true)),
        ("FR-TYP-11 AC-4 (b) preview", TypeOp::SetPreview(vec!["účastníci".into()])),
        ("hidden", TypeOp::SetHidden(vec!["projekt".into()])),
    ];
    for (what, op) in ops {
        let got = do_patch("schůzka", &s, vec![op]);
        let text = match &got {
            Ok(Some(t)) => t.clone(),
            other => {
                assert!(false, "{what}: expected a write, got {other:?}");
                unreachable!()
            }
        };
        assert!(text.contains(line), "{what}: the columns line is byte-identical:\n{text}");
        assert_reads("schůzka", &text, Some(&["místo", "datum"]), what);
    }
    // (d) turning the review workflow off keeps a `review` entry in the file.
    let n = swap(&ty("nápad"), "preview: [hodnocení]\n", "preview: [hodnocení]\ncolumns: [hodnocení, review]\n");
    let off = do_patch("nápad", &n, vec![TypeOp::SetReview(false)]);
    assert_eq!(off, Ok(Some(swap(&n, "review: true\n", "review: false\n"))), "(d) review off: only the review line changes, `review` stays in columns");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-27 (c)

#[test]
fn fr_typ_09_ac27_a_newer_file_columns_are_read_and_never_written() {
    let b = swap(&ty("budoucí"), "preview: []\n", "preview: []\ncolumns: [hodnota, created]\n");
    let p = parse("budoucí", &b);
    assert_eq!(p.readability, Readability::Newer(2), "setup: version 2 is Newer");
    assert_reads("budoucí", &b, Some(&["hodnota", "created"]), "(c) D-1240 applies to reading a newer file");
    assert_eq!(do_patch("budoucí", &b, vec![cols(&["hodnota"])]), Err(SchemaError::NewerVersion), "(c) never written (AR-07 AC-3)");
}

// ------------------------------------------------------------------------------------------------ AR-07 AC-8

#[test]
fn ar_07_ac8_columns_is_an_optional_list_of_version_1() {
    assert_eq!(CURRENT_VERSION, 1, "CURRENT_VERSION stays 1 (D-1251)");
    let cases: [(&str, String, Option<&[&str]>); 4] = [
        ("flow list", schuzka_with("columns: [místo, datum]\n"), Some(&["místo", "datum"])),
        ("empty list", schuzka_with("columns: []\n"), Some(&[])),
        ("block list", schuzka_with("columns:\n  - datum\n  - místo\n"), Some(&["datum", "místo"])),
        ("absent", schuzka(), None),
    ];
    for (what, text, want) in cases {
        let p = parse("schůzka", &text);
        assert_eq!(p.readability, Readability::Ok, "{what}: Ok with version 1, never Newer");
        assert!(!p.columns_unreadable, "{what}: readable");
        assert_reads("schůzka", &text, want, what);
    }
}

#[test]
fn ar_07_ac8_new_starter_and_built_in_files_are_written_without_columns() {
    assert_eq!(new_type_file("Čajovna", "Čajovny"), read("tests/fixtures/types/expected/čajovna.yml"), "FR-TYP-01 AC-2: byte-identical to čajovna.yml");
    for (name, bytes) in STARTER_FILES {
        let text = String::from_utf8_lossy(bytes);
        assert!(!text.contains("\ncolumns:"), "starter {name}: no columns key (R11)");
    }
    for key in SYSTEM_KEYS {
        let text = builtin(key).map(str::to_string).unwrap_or_default();
        assert!(!text.contains("\ncolumns:"), "built-in {key}: no columns key (D-90)");
        assert_reads(key, &text, None, &format!("built-in {key}"));
    }
    // The D-90 path: the first columns change of a system type without a file patches its built-in default.
    let task = builtin("task").map(str::to_string).unwrap_or_default();
    assert_eq!(
        do_patch("task", &task, vec![cols(&["status", "priority", "due", "modified", "completed"])]),
        Ok(Some(swap(&task, "preview: [status, priority, due]\n", "preview: [status, priority, due]\ncolumns: [status, priority, due, modified, completed]\n"))),
        "AC-27 (b): the built-in task.yml plus one columns line after preview"
    );
}

#[test]
fn ar_07_ac8_every_other_op_leaves_the_columns_lines_byte_identical() {
    let variants: [(&str, &str); 4] = [
        ("flow", "columns: [místo, datum]\n"),
        ("block", "columns:\n  - datum\n  - místo\n"),
        ("scalar", "columns: datum\n"),
        ("mapping", "columns: { a: b }\n"),
    ];
    assert_reads("schůzka", &schuzka_with(variants[1].1), Some(&["datum", "místo"]), "setup: the block list is read");
    assert!(parse("schůzka", &schuzka_with(variants[2].1)).columns_unreadable, "setup: the scalar is unreadable");
    for (what, lines) in variants {
        let s = schuzka_with(lines);
        let attr = AttrDef {
            key: "telefon".into(),
            name: "Telefon".into(),
            r#type: AttrType::parse("text"),
            default: None,
            required: false,
            options: vec![],
            to: None,
            multiple: false,
            description: None,
            built_in: false,
        };
        let ops: Vec<(&str, TypeOp)> = vec![
            ("colour", TypeOp::SetColor("red".into())),
            ("description", TypeOp::SetDescription(Some("Jiný popis.".into()))),
            ("preview", TypeOp::SetPreview(vec!["místo".into()])),
            ("hidden", TypeOp::SetHidden(vec!["projekt".into()])),
            ("add property", TypeOp::AddAttribute(attr)),
            ("move property", TypeOp::MoveAttribute { key: "místo".into(), to: 0 }),
            ("remove another property", TypeOp::RemoveAttribute("projekt".into())),
        ];
        for (op_name, op) in ops {
            match do_patch("schůzka", &s, vec![op]) {
                Ok(Some(t)) => assert!(t.contains(lines), "{what}, {op_name}: the columns lines stay byte-identical:\n{t}"),
                other => assert!(false, "{what}, {op_name}: expected a write, got {other:?}"),
            }
        }
    }
}

#[test]
fn ar_07_ac8_round_trip_of_the_readable_columns_variants() {
    let variants: Vec<(&str, String, &[&str])> = vec![
        ("[místo, datum]", schuzka_with("columns: [místo, datum]\n"), &["místo", "datum"]),
        ("[]", schuzka_with("columns: []\n"), &[]),
        ("hand-written", schuzka_with("columns: [datum, neznámý, datum, title, místo]\n"), &["datum", "neznámý", "datum", "title", "místo"]),
        ("block list", schuzka_with("columns:\n  - datum\n  - místo\n"), &["datum", "místo"]),
    ];
    for (what, text, keys) in variants {
        let p = parse("schůzka", &text);
        assert_eq!(p.readability, Readability::Ok, "{what}: readable");
        assert_reads("schůzka", &text, Some(keys), what);
        assert_eq!(do_patch("schůzka", &text, vec![]), Ok(None), "{what}: parse then no change writes nothing (AR-07 AC-6)");
        let again = parse("schůzka", &serialize(&p.def));
        assert_eq!(again.def, p.def, "{what}: parse → canonical write → parse gives an equal definition (AR-07 AC-6)");
    }
    let b = swap(&ty("budoucí"), "preview: []\n", "preview: []\ncolumns: [hodnota, created]\n");
    assert_reads("budoucí", &b, Some(&["hodnota", "created"]), "budoucí with columns");
    assert_eq!(parse("budoucí", &serialize(&parse("budoucí", &b).def)).def, parse("budoucí", &b).def, "budoucí: round trip");
}
