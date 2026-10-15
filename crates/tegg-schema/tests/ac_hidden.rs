//! FR-TYP-17 Hidden properties (D-316), `tegg-schema` side: AC-1 (the `hidden:` line, L1 for the YAML) and AC-3
//! (kept consistent, L4). docs/acceptance/types.md "FR-TYP-17", BRD D-316; interface: `TypeFile.hidden: Vec<String>`,
//! `TypeOp::SetHidden(Vec<String>)` through `patch`, top-level `hidden: [a, b]` (flow list) after `preview` in the
//! canonical order (docs/contracts/ms3-shell.md §14.1.4 patch rules). Written from the ACs and the interface only
//! (D-61). Fixtures are read-only; nothing is written to disk.

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
fn sys(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/new-empty/.tegg/types/{key}.yml"))
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

fn hide(keys: &[&str]) -> TypeOp {
    TypeOp::SetHidden(keys.iter().map(|s| s.to_string()).collect())
}

/// `text` with the first occurrence of `from` replaced by `to`; the test fails if `from` isn't there (fixture drift).
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}

// ------------------------------------------------------------------------------------------------ AC-1

#[test]
fn fr_typ_17_ac1_set_hidden_writes_a_flow_list_right_after_preview() {
    // The D-90 path: the core patches the built-in default of a system type without a file.
    let page = builtin("page").map(str::to_string).unwrap_or_else(|| sys("page"));
    let one = do_patch("page", &page, vec![hide(&["created"])]);
    assert_eq!(one, Ok(Some(swap(&page, "preview: []\n", "preview: []\nhidden: [created]\n"))), "checking Created");
    let first = one.ok().flatten().unwrap_or_default();
    let two = do_patch("page", &first, vec![hide(&["created", "modified"])]);
    assert_eq!(two, Ok(Some(swap(&page, "preview: []\n", "preview: []\nhidden: [created, modified]\n"))), "then Modified: only the hidden line changes");
    let both = two.ok().flatten().unwrap_or_default();
    let p = parse("page", &both);
    assert_eq!(p.readability, Readability::Ok);
    assert_eq!(p.def.hidden, vec!["created", "modified"], "read back in order");
    assert_eq!(p.def.preview, Vec::<String>::new(), "preview unaffected");
    // The refusals of the patch rules apply to the hidden op too (AR-07 AC-3, AC-4).
    let b = ty("budoucí");
    assert_eq!(do_patch("budoucí", &b, vec![hide(&["tags"])]), Err(SchemaError::NewerVersion), "AR-07 AC-3");
    let r = ty("rozbitý");
    assert_eq!(do_patch("rozbitý", &r, vec![hide(&["tags"])]), Err(SchemaError::Invalid), "AR-07 AC-4");
}

#[test]
fn fr_typ_17_ac1_unchecking_all_writes_an_empty_flow_list() {
    // types.md FR-TYP-17 AC-1: "unchecking both writes `hidden: []`. Only that line changes."
    let page = sys("page");
    let both = swap(&page, "preview: []\n", "preview: []\nhidden: [created, modified]\n");
    assert_eq!(do_patch("page", &both, vec![hide(&[])]), Ok(Some(swap(&page, "preview: []\n", "preview: []\nhidden: []\n"))));
}

#[test]
fn fr_typ_17_ac1_hidden_goes_after_preview_and_before_template_unknown_keys_and_attributes() {
    // Canonical TOP order: … review, preview, hidden, template, attributes. An absent field is inserted right after the
    // nearest preceding canonical key; comments and unknown keys stay byte-identical.
    let n = ty("nápad");
    assert_eq!(
        do_patch("nápad", &n, vec![hide(&["hodnocení"])]),
        Ok(Some(swap(&n, "preview: [hodnocení]\n", "preview: [hodnocení]\nhidden: [hodnocení]\n"))),
        "nápad: before template"
    );
    let o = ty("osoba");
    assert_eq!(
        do_patch("osoba", &o, vec![hide(&["telefon", "tags"])]),
        Ok(Some(swap(&o, "preview: [firma]\n", "preview: [firma]\nhidden: [telefon, tags]\n"))),
        "osoba: right after preview, the unknown key poznámka-pro-mě and the comment kept"
    );
    let s = ty("schůzka");
    assert_eq!(
        do_patch("schůzka", &s, vec![hide(&["místo"])]),
        Ok(Some(swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo]\n"))),
        "schůzka"
    );
    // A file without `preview` gets `hidden` after the nearest preceding canonical key (`review`).
    let no_preview = swap(&s, "preview: [datum, účastníci]\n", "");
    assert_eq!(
        do_patch("schůzka", &no_preview, vec![hide(&["místo"])]),
        Ok(Some(swap(&no_preview, "review: false\n", "review: false\nhidden: [místo]\n"))),
        "no preview key"
    );
}

#[test]
fn fr_typ_17_ac1_an_existing_hidden_line_is_replaced_in_place() {
    let s = ty("schůzka");
    let with = swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo]\n");
    assert_eq!(
        do_patch("schůzka", &with, vec![hide(&["místo", "začátek"])]),
        Ok(Some(swap(&with, "hidden: [místo]\n", "hidden: [místo, začátek]\n")))
    );
}

#[test]
fn fr_typ_17_ac1_equal_value_writes_nothing_and_a_change_back_is_byte_identical() {
    let s = ty("schůzka");
    assert_eq!(do_patch("schůzka", &s, vec![hide(&[])]), Ok(None), "no hidden key and nothing to hide: no write (FR-SYN-06)");
    let with = swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo]\n");
    assert_eq!(do_patch("schůzka", &with, vec![hide(&["místo"])]), Ok(None), "equal list: no write");
    let more = do_patch("schůzka", &with, vec![hide(&["místo", "tags"])]).ok().flatten().unwrap_or_default();
    assert_eq!(do_patch("schůzka", &more, vec![hide(&["místo"])]), Ok(Some(with.clone())), "change back restores the bytes");
}

#[test]
fn fr_typ_17_ac1_every_property_can_be_hidden_including_universal_and_built_in() {
    let task = sys("task");
    assert_eq!(
        do_patch("task", &task, vec![hide(&["status", "due", "tags", "aliases", "source", "review", "created", "modified"])]),
        Ok(Some(swap(&task, "preview: [status, priority, due]\n", "preview: [status, priority, due]\nhidden: [status, due, tags, aliases, source, review, created, modified]\n"))),
        "built-in attributes and the universal ones; hiding isn't a built-in change (FR-TYP-06 AC-2)"
    );
    let q = sys("quick-note");
    let got = do_patch("quick-note", &q, vec![hide(&["review"])]);
    assert!(matches!(got, Ok(Some(_))), "hiding Review on a locked-review type is allowed: {got:?}");
}

#[test]
fn fr_typ_17_ac1_hidden_keys_are_written_nfc() {
    let s = ty("schůzka");
    let nfd = "mi\u{301}sto".to_string();
    assert_eq!(
        do_patch("schůzka", &s, vec![TypeOp::SetHidden(vec![nfd])]),
        Ok(Some(swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo]\n"))),
        "FR-FMT-12: NFC bytes"
    );
}

#[test]
fn fr_typ_17_ac1_canonical_write_places_hidden_after_preview() {
    let page = sys("page");
    assert_eq!(builtin("page"), Some(page.as_str()), "setup: the built-in Page file equals new-empty's page.yml (D-90)");
    let p = parse("page", &page);
    assert_eq!(p.readability, Readability::Ok);
    assert_eq!(p.def.hidden, Vec::<String>::new(), "page.yml has no `hidden:` key: nothing hidden");
    let mut def = parse("page", &page).def;
    def.hidden = vec!["created".into(), "modified".into()];
    let out = serialize(&def);
    assert_eq!(out, swap(&page, "preview: []\n", "preview: []\nhidden: [created, modified]\n"), "TOP order: preview, hidden, template, attributes");
    assert_eq!(parse("page", &out).def, def, "parse → canonical write → parse gives an equal definition (AR-07 AC-6)");
    let n = ty("nápad");
    let mut nd = parse("nápad", &n).def;
    nd.hidden = vec!["hodnocení".into()];
    let out = serialize(&nd);
    let (h, t) = (out.find("\nhidden: [hodnocení]\n"), out.find("\ntemplate: "));
    assert!(matches!((h, t), (Some(h), Some(t)) if h < t), "hidden before template:\n{out}");
    assert!(out.contains("preview: [hodnocení]\nhidden: [hodnocení]\n"), "hidden right after preview:\n{out}");
    // No hidden properties: the canonical file has no `hidden:` line (the fixtures stay byte-identical).
    assert_eq!(serialize(&parse("page", &page).def), page, "page.yml unchanged");
}

// ------------------------------------------------------------------------------------------------ AC-3

#[test]
fn fr_typ_17_ac3_removing_a_property_drops_it_from_hidden_in_the_same_write() {
    let s = ty("schůzka");
    let with = swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo, začátek]\n");
    let místo = "  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n";
    assert_eq!(
        do_patch("schůzka", &with, vec![TypeOp::RemoveAttribute("místo".into())]),
        Ok(Some(swap(&swap(&with, místo, ""), "hidden: [místo, začátek]\n", "hidden: [začátek]\n"))),
        "item removed and místo dropped from hidden in one patch"
    );
    // Together with preview (FR-TYP-04 AC-4): datum leaves attributes, preview and hidden at once.
    let both = swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [datum, místo]\n");
    let want = swap(
        &swap(&swap(&both, "  - key: datum\n    name: Datum\n    type: date\n", ""), "preview: [datum, účastníci]\n", "preview: [účastníci]\n"),
        "hidden: [datum, místo]\n",
        "hidden: [místo]\n",
    );
    assert_eq!(do_patch("schůzka", &both, vec![TypeOp::RemoveAttribute("datum".into())]), Ok(Some(want)), "datum removed from attributes, preview and hidden");
    // A property that isn't hidden: the hidden line is untouched.
    assert_eq!(
        do_patch("schůzka", &with, vec![TypeOp::RemoveAttribute("projekt".into())]),
        Ok(Some(swap(&with, "  - key: projekt\n    name: Projekt\n    type: relation\n    to: [projekt]\n", ""))),
        "hidden unchanged when the removed key isn't in it"
    );
}

#[test]
fn fr_typ_17_ac3_unknown_hidden_keys_are_read_and_kept() {
    let s = ty("schůzka");
    let with = swap(&s, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\nhidden: [místo, neexistuje, tags]\n");
    let p = parse("schůzka", &with);
    assert_eq!(p.readability, Readability::Ok, "a hand-written unknown key doesn't make the file invalid");
    assert_eq!(p.def.hidden, vec!["místo", "neexistuje", "tags"], "kept as written");
    let got = do_patch("schůzka", &with, vec![TypeOp::SetColor("blue".into())]);
    assert_eq!(got, Ok(Some(swap(&with, "color: teal\n", "color: blue\n"))), "another change keeps the hidden line byte-identical");
    let got = do_patch("schůzka", &with, vec![TypeOp::RemoveAttribute("projekt".into())]).ok().flatten().unwrap_or_default();
    assert!(got.contains("hidden: [místo, neexistuje, tags]\n"), "removing another property keeps the unknown key:\n{got}");
}

#[test]
fn fr_typ_17_ac3_hidden_leaves_preview_and_attributes_unaffected() {
    let s = ty("schůzka");
    let before = parse("schůzka", &s).def;
    let got = do_patch("schůzka", &s, vec![hide(&["datum", "účastníci"])]).ok().flatten().unwrap_or_default();
    let after = parse("schůzka", &got).def;
    assert_eq!(after.preview, before.preview, "preview properties unaffected");
    assert_eq!(after.attributes, before.attributes, "attributes unaffected");
    assert_eq!(after.hidden, vec!["datum", "účastníci"]);
}
