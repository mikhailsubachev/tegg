//! MS4 slice 4F, `tegg-schema` side (L4): FR-EMB-02 AC-6 (the `embed` values and the R31 defaults, D-417) and AC-7
//! (the bytes of `TypeOp::SetEmbed`: the line `embed: <mode>` after `hidden` if present, else after `preview`; replaced
//! in place; no write for the same value; a missing system file patched from its built-in text, D-90).
//! docs/acceptance/embeds.md (R31, FR-EMB-02 AC-6, AC-7); interface docs/contracts/ms4-embeds.md §3. Written from the
//! ACs and the contract only (D-61). Fixtures are read only; nothing is written to disk.

use std::path::PathBuf;

use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
/// A user type file of the embeds fixture.
fn ty(key: &str) -> String {
    read(&format!("tests/fixtures/vaults/embeds/.tegg/types/{key}.yml"))
}
/// A system type file of new-empty (the files the embeds fixture gets at test time).
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
const USER: [(&str, &str, &str); 4] = [("osoba", "Osoba", "Osoby"), ("recept", "Recept", "Recepty"), ("kniha", "Kniha", "Knihy"), ("místo", "Místo", "Místa")];

fn names(self_key: &str) -> Vec<TypeNames<'static>> {
    SYSTEM.iter().chain(USER.iter()).map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == self_key }).collect()
}
fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others = names(key);
    patch(key, text, &ops, &PatchContext { others: &others })
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn embed(m: EmbedMode) -> TypeOp {
    TypeOp::SetEmbed(m)
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-6

#[test]
fn fr_emb_02_ac6_embed_mode_parse_is_case_insensitive_and_trimmed() {
    let cases: [(&str, Option<EmbedMode>); 12] = [
        ("full", Some(EmbedMode::Full)),
        ("card", Some(EmbedMode::Card)),
        ("link", Some(EmbedMode::Link)),
        ("FULL", Some(EmbedMode::Full)),
        ("Card", Some(EmbedMode::Card)),
        ("  link  ", Some(EmbedMode::Link)),
        (" Full\t", Some(EmbedMode::Full)),
        ("obrovský", None),
        ("", None),
        ("cards", None),
        ("full card", None),
        ("plný", None),
    ];
    for (raw, want) in cases {
        assert_eq!(EmbedMode::parse(raw), want, "parse({raw:?})");
    }
    assert_eq!([EmbedMode::Full.as_str(), EmbedMode::Card.as_str(), EmbedMode::Link.as_str()], ["full", "card", "link"]);
}

#[test]
fn fr_emb_02_ac6_r31_built_in_defaults() {
    let want: [(&str, EmbedMode); 12] = [
        ("page", EmbedMode::Full),
        ("quick-note", EmbedMode::Full),
        ("daily-note", EmbedMode::Full),
        ("task", EmbedMode::Card),
        ("tag", EmbedMode::Card),
        ("image", EmbedMode::Card),
        ("pdf", EmbedMode::Card),
        ("osoba", EmbedMode::Card),
        ("recept", EmbedMode::Card),
        ("kniha", EmbedMode::Card),
        ("místo", EmbedMode::Card),
        ("neznámý-typ", EmbedMode::Card),
    ];
    for (key, mode) in want {
        assert_eq!(default_embed(key), mode, "default_embed({key:?})");
        assert_eq!(effective_embed(key, None), mode, "effective_embed({key:?}, None)");
        assert_eq!(effective_embed(key, Some("obrovský")), mode, "an unknown value gives the R31 default for {key:?}");
    }
    assert_eq!(effective_embed("recept", Some("full")), EmbedMode::Full, "Recept's embed: full");
    assert_eq!(effective_embed("kniha", Some("link")), EmbedMode::Link, "Kniha's embed: link");
    assert_eq!(effective_embed("page", Some(" CARD ")), EmbedMode::Card, "any case, trimmed");
    assert_eq!(effective_embed("task", Some("Full")), EmbedMode::Full);
}

#[test]
fn fr_emb_02_ac6_type_files_give_the_raw_value_and_reading_is_ok() {
    let r = parse("recept", &ty("recept"));
    assert_eq!((r.readability.clone(), r.embed_raw.clone()), (Readability::Ok, Some("full".to_string())), "recept");
    let k = parse("kniha", &ty("kniha"));
    assert_eq!((k.readability.clone(), k.embed_raw.clone()), (Readability::Ok, Some("link".to_string())), "kniha");
    let m = parse("místo", &ty("místo"));
    assert_eq!(m.readability, Readability::Ok, "an unknown embed value isn't an error (D-417)");
    assert_eq!(m.embed_raw, Some("obrovský".to_string()), "místo's raw value");
    assert_eq!(effective_embed("místo", m.embed_raw.as_deref()), EmbedMode::Card, "místo → card");
    let o = parse("osoba", &ty("osoba"));
    assert_eq!((o.readability.clone(), o.embed_raw.clone()), (Readability::Ok, None), "osoba has no embed key");
    for (key, _, _) in SYSTEM {
        let p = parse(key, &sys(key));
        assert_eq!(p.embed_raw, None, "{key}: new-empty's system files have no embed key");
    }
    // Trimmed raw value; the case is kept as written.
    let spaced = swap(&ty("recept"), "embed: full\n", "embed:   Full  \n");
    let s = parse("recept", &spaced);
    assert_eq!(s.embed_raw, Some("Full".to_string()), "raw value trimmed");
    assert_eq!(effective_embed("recept", s.embed_raw.as_deref()), EmbedMode::Full);
}

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-7

#[test]
fn fr_emb_02_ac7_osoba_full_inserts_one_line_after_preview_then_card_replaces_it() {
    let o = ty("osoba");
    let full = swap(&o, "preview: [firma, role]\n", "preview: [firma, role]\nembed: full\n");
    assert_eq!(do_patch("osoba", &o, vec![embed(EmbedMode::Full)]), Ok(Some(full.clone())), "Full: exactly the line `embed: full` after preview");
    let card = swap(&o, "preview: [firma, role]\n", "preview: [firma, role]\nembed: card\n");
    assert_eq!(do_patch("osoba", &full, vec![embed(EmbedMode::Card)]), Ok(Some(card.clone())), "Card afterwards: the key stays, its value changes");
    assert_eq!(parse("osoba", &card).embed_raw, Some("card".to_string()), "read back");
    assert_eq!(parse("osoba", &card).readability, Readability::Ok);
}

#[test]
fn fr_emb_02_ac7_same_value_writes_nothing() {
    let o = ty("osoba");
    let full = swap(&o, "preview: [firma, role]\n", "preview: [firma, role]\nembed: full\n");
    assert_eq!(do_patch("osoba", &full, vec![embed(EmbedMode::Full)]), Ok(None), "the file already says full: no write");
    assert_eq!(do_patch("recept", &ty("recept"), vec![embed(EmbedMode::Full)]), Ok(None), "recept already full");
    assert_eq!(do_patch("kniha", &ty("kniha"), vec![embed(EmbedMode::Link)]), Ok(None), "kniha already link");
    // Red guard: a different value does write.
    assert!(matches!(do_patch("kniha", &ty("kniha"), vec![embed(EmbedMode::Card)]), Ok(Some(_))), "kniha → card writes");
}

#[test]
fn fr_emb_02_ac7_unknown_value_is_replaced_in_place() {
    let m = ty("místo");
    assert_eq!(
        do_patch("místo", &m, vec![embed(EmbedMode::Card)]),
        Ok(Some(swap(&m, "embed: obrovský\n", "embed: card\n"))),
        "choosing Card on místo replaces the unknown value in place (it isn't a no-op: the file doesn't say card)"
    );
    assert_eq!(do_patch("místo", &m, vec![embed(EmbedMode::Link)]), Ok(Some(swap(&m, "embed: obrovský\n", "embed: link\n"))));
    assert_eq!(
        do_patch("kniha", &ty("kniha"), vec![embed(EmbedMode::Full)]),
        Ok(Some(swap(&ty("kniha"), "embed: link\n", "embed: full\n"))),
        "kniha: link → full in place"
    );
}

#[test]
fn fr_emb_02_ac7_embed_goes_after_hidden_when_present() {
    let o = ty("osoba");
    let hidden = swap(&o, "preview: [firma, role]\n", "preview: [firma, role]\nhidden: [created]\n");
    assert_eq!(
        do_patch("osoba", &hidden, vec![embed(EmbedMode::Link)]),
        Ok(Some(swap(&hidden, "hidden: [created]\n", "hidden: [created]\nembed: link\n"))),
        "after hidden (D-417)"
    );
    let page = sys("page");
    assert_eq!(do_patch("page", &page, vec![embed(EmbedMode::Card)]), Ok(Some(swap(&page, "preview: []\n", "preview: []\nembed: card\n"))), "page: after preview");
}

#[test]
fn fr_emb_02_ac7_task_from_its_built_in_text() {
    // D-90: the core materialises a system type without a file from its built-in text, then patches it.
    let task = builtin("task").map(str::to_string).unwrap_or_else(|| sys("task"));
    assert_eq!(task, sys("task"), "setup: the built-in Task is new-empty's task.yml");
    let out = do_patch("task", &task, vec![embed(EmbedMode::Full)]);
    assert_eq!(
        out,
        Ok(Some(swap(&task, "preview: [status, priority, due]\n", "preview: [status, priority, due]\nembed: full\n"))),
        "task.yml: `embed: full` after `preview: [status, priority, due]`, every other byte the built-in file's"
    );
    let written = out.ok().flatten().unwrap_or_default();
    let p = parse("task", &written);
    assert_eq!((p.readability, p.embed_raw.clone()), (Readability::Ok, Some("full".to_string())));
    assert_eq!(effective_embed("task", p.embed_raw.as_deref()), EmbedMode::Full);
    assert_eq!(p.def, parse("task", &task).def, "the type definition is otherwise unchanged");
}

#[test]
fn fr_emb_02_ac7_refusals_of_the_patch_rules_apply() {
    // AR-07 AC-3, AC-4: a newer or invalid type file is never patched.
    let newer = swap(&ty("osoba"), "version: 1\n", "version: 2\n");
    assert_eq!(do_patch("osoba", &newer, vec![embed(EmbedMode::Full)]), Err(SchemaError::NewerVersion), "newer version");
    let invalid = swap(&ty("osoba"), "name: Osoba\n", "name: \"Osoba\n");
    assert_eq!(do_patch("osoba", &invalid, vec![embed(EmbedMode::Full)]), Err(SchemaError::Invalid), "invalid YAML");
    // Red guard: the same file with version 1 is patched.
    assert!(matches!(do_patch("osoba", &ty("osoba"), vec![embed(EmbedMode::Full)]), Ok(Some(_))), "osoba → full writes");
}
