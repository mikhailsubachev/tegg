//! MS3 slice 3D AC tests for `tegg-schema` (L4): AR-07 AC-1…AC-6; FR-TYP-01 AC-3, AC-5 (rules); FR-TYP-02 AC-1, AC-2,
//! AC-5; FR-TYP-03 AC-1, AC-2, AC-5…AC-7, AC-9, AC-11; FR-TYP-04 AC-4; FR-TYP-06 AC-2, AC-3; FR-TYP-11 AC-1, AC-2;
//! FR-TYP-12 AC-1, AC-2. docs/acceptance/types.md, interface docs/contracts/ms3-shell.md §14.1 and the shared corpora
//! tests/fixtures/types/{values,rules}.json (D-241). Written from the ACs and the contract only (D-61). Fixtures are
//! read-only; nothing is written to disk.

use std::path::PathBuf;

use serde_json::{Map, Value};
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
fn corpus(name: &str) -> Value {
    serde_json::from_str(&read(&format!("tests/fixtures/types/{name}"))).expect("setup: corpus JSON")
}
fn nfc(s: &str) -> String {
    tegg_format::nfc(s)
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

/// The types fixture's names, for rules and patch contexts (`self_key` marks the edited type).
fn names(self_key: &str) -> Vec<TypeNames<'static>> {
    SYSTEM.iter().chain(USER.iter()).map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == self_key }).collect()
}

fn do_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
    let others = names(key);
    patch(key, text, &ops, &PatchContext { others: &others })
}

fn attr(key: &str, name: &str, t: AttrType) -> AttrDef {
    AttrDef { key: key.into(), name: name.into(), r#type: t, default: None, required: false, options: vec![], to: None, multiple: false, description: None, built_in: false }
}

/// `text` with the first occurrence of `from` replaced by `to`; the test fails if `from` isn't there (fixture drift).
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}

fn reason(e: &RuleError) -> (String, Option<String>, Option<String>) {
    let f = |f: &Field| {
        match f {
            Field::Name => "name",
            Field::Plural => "plural",
            Field::Folder => "folder",
            Field::AttrKey => "attrKey",
            Field::AttrName => "attrName",
            Field::OptionLabel => "optionLabel",
        }
        .to_string()
    };
    match e {
        RuleError::Empty { field } => ("empty".into(), Some(f(field)), None),
        RuleError::ForbiddenChar { field } => ("forbiddenChar".into(), Some(f(field)), None),
        RuleError::KeyTaken => ("keyTaken".into(), None, None),
        RuleError::KeyTooLong => ("keyTooLong".into(), None, None),
        RuleError::FolderTaken => ("folderTaken".into(), None, None),
        RuleError::FolderInvalid => ("folderInvalid".into(), None, None),
        RuleError::ReservedKey { key } => ("reservedKey".into(), None, Some(key.clone())),
        RuleError::AttrKeyTaken => ("attrKeyTaken".into(), None, None),
        RuleError::AttrKeyInvalid => ("attrKeyInvalid".into(), None, None),
        RuleError::RangeCollision => ("rangeCollision".into(), None, None),
        RuleError::OptionEmpty => ("optionEmpty".into(), None, None),
        RuleError::OptionDuplicate => ("optionDuplicate".into(), None, None),
        RuleError::OptionUsed { label } => ("optionUsed".into(), None, Some(label.clone())),
        RuleError::PreviewFull => ("previewFull".into(), None, None),
        #[allow(unreachable_patterns)]
        _ => ("<other>".into(), None, None),
    }
}

/// Compares a rule outcome with a corpus expectation (`null` = allowed; `field`/`key` compared when given).
fn rule_matches(got: &Result<(), RuleError>, expect: &Value) -> bool {
    match (got, expect) {
        (Ok(()), Value::Null) => true,
        (Err(e), Value::Object(o)) => {
            let (r, f, k) = reason(e);
            o.get("reason").and_then(Value::as_str) == Some(r.as_str())
                && o.get("field").map_or(true, |x| x.as_str() == f.as_deref())
                && o.get("key").map_or(true, |x| x.as_str() == k.as_deref())
        }
        _ => false,
    }
}

fn attr_type(s: &str) -> AttrType {
    match s {
        "text" => AttrType::Text,
        "long-text" => AttrType::LongText,
        "number" => AttrType::Number,
        "checkbox" => AttrType::Checkbox,
        "date" => AttrType::Date,
        "date-time" => AttrType::DateTime,
        "date-range" => AttrType::DateRange,
        "select" => AttrType::Select,
        "multi-select" => AttrType::MultiSelect,
        "url" => AttrType::Url,
        "email" => AttrType::Email,
        "relation" => AttrType::Relation,
        "file" => AttrType::File,
        "color" => AttrType::Color,
        "recurrence" => AttrType::Recurrence,
        other => AttrType::Other(other.into()),
    }
}

/// A corpus attribute item (`{ key, name, type, options, to, multiple, required }`) as an `AttrDef`.
fn attr_from_json(v: &Value) -> AttrDef {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    AttrDef {
        key: s("key"),
        name: s("name"),
        r#type: attr_type(&s("type")),
        default: v.get("default").cloned(),
        required: v.get("required").and_then(Value::as_bool).unwrap_or(false),
        options: v
            .get("options")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|o| OptionDef {
                        label: o["label"].as_str().unwrap_or("").into(),
                        color: o.get("color").and_then(Value::as_str).map(String::from),
                        extra: vec![],
                    })
                    .collect()
            })
            .unwrap_or_default(),
        to: v.get("to").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()),
        multiple: v.get("multiple").and_then(Value::as_bool).unwrap_or(false),
        description: None,
        built_in: false,
    }
}

/// A type definition from `{ key, attributes: [{ key, type }] }` (rules corpus).
fn type_from_json(v: &Value) -> TypeFile {
    let key = v["key"].as_str().unwrap_or("").to_string();
    TypeFile {
        key: key.clone(),
        declared_version: Some(1),
        name: key.clone(),
        plural: key.clone(),
        system: false,
        folder: key.clone(),
        icon: "file-text".into(),
        color: "gray".into(),
        description: None,
        review: Review::Off,
        preview: vec![],
        hidden: vec![],
        columns: None,
        template: None,
        attributes: v["attributes"]
            .as_array()
            .map(|a| a.iter().map(|x| attr(x["key"].as_str().unwrap_or(""), x["key"].as_str().unwrap_or(""), attr_type(x["type"].as_str().unwrap_or("")))).collect())
            .unwrap_or_default(),
    }
}

/// The frontmatter of a note (or of a YAML snippet) as the index's JSON attributes (tegg-format `extract`).
fn frontmatter(yaml_or_note: &str) -> Map<String, Value> {
    let text = if yaml_or_note.starts_with("---\n") { yaml_or_note.to_string() } else { format!("---\n{yaml_or_note}---\n") };
    match tegg_format::extract(text.as_bytes(), "x").attributes {
        Some(Value::Object(m)) => m,
        other => panic!("setup: frontmatter didn't parse: {other:?}"),
    }
}

fn validity_json(v: &Validity) -> Value {
    match v {
        Validity::Empty => serde_json::json!({ "state": "empty" }),
        Validity::Valid => serde_json::json!({ "state": "valid" }),
        Validity::Invalid { items } => serde_json::json!({ "state": "invalid", "items": items }),
    }
}

fn attrs_of(key: &str) -> Vec<AttrDef> {
    parse(key, &ty(key)).def.attributes
}

// ------------------------------------------------------------------------------------------------ AR-07

#[test]
fn ar_07_ac1_current_version_and_the_new_type_file() {
    assert_eq!(CURRENT_VERSION, 1, "CURRENT_VERSION");
    assert_eq!(new_type_file("Čajovna", "Čajovny"), read("tests/fixtures/types/expected/čajovna.yml"), "new user type bytes");
    assert_eq!(new_type_file(&"C\u{30C}ajovna".to_string(), "C\u{30C}ajovny"), read("tests/fixtures/types/expected/čajovna.yml"), "NFD input gives NFC bytes");
}

#[test]
fn ar_07_ac1_every_written_type_file_starts_with_header_and_version_1() {
    let first = format!("{HEADER}version: 1\n");
    let mut written: Vec<(String, String)> = vec![("new type".into(), new_type_file("Čajovna", "Čajovny"))];
    for (k, _, _) in SYSTEM {
        written.push((format!("builtin {k}"), builtin(k).unwrap_or("").to_string()));
    }
    for (path, bytes) in STARTER_FILES.iter().filter(|(p, _)| p.starts_with(".tegg/types/")) {
        written.push((format!("starter {path}"), String::from_utf8_lossy(bytes).to_string()));
    }
    assert_eq!(STARTER_FILES.iter().filter(|(p, _)| p.starts_with(".tegg/types/")).count(), 7, "seven starter type files");
    let p = do_patch("osoba", &ty("osoba"), vec![TypeOp::SetColor("teal".into())]);
    written.push(("patched osoba".into(), p.ok().flatten().unwrap_or_default()));
    let def = parse("projekt", &ty("projekt")).def;
    written.push(("serialize(projekt)".into(), serialize(&def)));
    for (what, text) in &written {
        assert!(text.starts_with(&first), "{what}: must start with the header and `version: 1`:\n{text}");
    }
}

#[test]
fn ar_07_ac2_missing_version_reads_as_1_and_the_first_change_inserts_it() {
    let orig = ty("osoba");
    let without = swap(&orig, "version: 1\n", "");
    let p = parse("osoba", &without);
    assert_eq!(p.readability, Readability::Ok, "a missing version is no warning");
    assert_eq!(p.def.declared_version, None);
    assert_eq!(p.def.name, "Osoba");
    assert_eq!(do_patch("osoba", &without, vec![]), Ok(None), "nothing to write without a change");
    let got = do_patch("osoba", &without, vec![TypeOp::SetColor("teal".into())]);
    let want = swap(&orig, "color: purple\n", "color: teal\n");
    assert_eq!(got, Ok(Some(want)), "version: 1 first after the header, only the color line changed");
}

#[test]
fn ar_07_ac3_newer_version_is_read_and_never_patched() {
    let text = ty("budoucí");
    let p = parse("budoucí", &text);
    assert_eq!(p.readability, Readability::Newer(2));
    assert_eq!((p.def.name.as_str(), p.def.plural.as_str(), p.def.folder.as_str(), p.def.color.as_str()), ("Budoucí", "Budoucí", "Budoucí", "blue"));
    assert_eq!(p.def.attributes.iter().map(|a| (a.key.as_str(), a.r#type.clone())).collect::<Vec<_>>(), vec![("hodnota", AttrType::Text)]);
    assert_eq!(do_patch("budoucí", &text, vec![TypeOp::SetColor("red".into())]), Err(SchemaError::NewerVersion));
}

#[test]
fn ar_07_ac4_invalid_files_report_the_line_and_are_never_patched() {
    let broken = ty("rozbitý");
    let p = parse("rozbitý", &broken);
    match &p.readability {
        Readability::Invalid { line, message } => {
            assert_eq!(*line, 4, "unclosed quote opens on line 4");
            assert!(!message.trim().is_empty(), "an error message");
        }
        other => assert!(false, "rozbitý.yml must be Invalid, got {other:?}"),
    }
    assert_eq!((p.def.name.as_str(), p.def.plural.as_str()), ("rozbitý", "rozbitý"), "name and plural fall back to the key");
    assert_eq!(do_patch("rozbitý", &broken, vec![TypeOp::SetColor("blue".into())]), Err(SchemaError::Invalid));

    let osoba = ty("osoba");
    for v in ["version: 0", "version: \"1\"", "version: 1.5", "version: -1", "version: jedna"] {
        let text = swap(&osoba, "version: 1", v);
        let r = parse("osoba", &text).readability;
        assert!(matches!(r, Readability::Invalid { line: 2, .. }), "{v}: must be Invalid at line 2, got {r:?}");
    }
    let structural = [
        ("attributes not a list", swap(&osoba, "attributes:\n  - key: e-mail", "attributes: e-mail\nx:\n  - key: e-mail")),
        ("item without key", swap(&osoba, "  - key: firma\n    name: Firma", "  - name: Firma")),
        ("item without type", swap(&osoba, "    name: Telefon\n    type: text\n", "    name: Telefon\n")),
        ("duplicate attribute key", swap(&osoba, "  - key: telefon", "  - key: firma")),
        ("top level not a mapping", format!("{HEADER}- a\n- b\n")),
    ];
    for (what, text) in structural {
        let r = parse("osoba", &text).readability;
        assert!(matches!(r, Readability::Invalid { .. }), "{what}: must be Invalid, got {r:?}");
    }
    // Missing optional fields are no fault (§14.1.1).
    let minimal = format!("{HEADER}version: 1\nattributes: []\n");
    let m = parse("minimální", &minimal);
    assert_eq!(m.readability, Readability::Ok);
    assert_eq!(
        (m.def.name.as_str(), m.def.plural.as_str(), m.def.folder.as_str(), m.def.icon.as_str(), m.def.color.as_str(), m.def.review, m.def.system),
        ("minimální", "minimální", "minimální", "file-text", "gray", Review::Off, false)
    );
}

#[test]
fn ar_07_ac5_each_general_field_changes_only_its_line() {
    let orig = ty("osoba");
    let one = |op: TypeOp| do_patch("osoba", &orig, vec![op]);
    assert_eq!(one(TypeOp::SetColor("teal".into())), Ok(Some(swap(&orig, "color: purple\n", "color: teal\n"))), "color");
    assert_eq!(one(TypeOp::SetName("Člověk".into())), Ok(Some(swap(&orig, "name: Osoba\n", "name: Člověk\n"))), "name");
    assert_eq!(one(TypeOp::SetPlural("Lidé".into())), Ok(Some(swap(&orig, "plural: Osoby\n", "plural: Lidé\n"))), "plural");
    assert_eq!(one(TypeOp::SetFolder("Lidé/Kontakty".into())), Ok(Some(swap(&orig, "folder: Osoby\n", "folder: Lidé/Kontakty\n"))), "folder");
    assert_eq!(one(TypeOp::SetIcon("briefcase".into())), Ok(Some(swap(&orig, "icon: user\n", "icon: briefcase\n"))), "icon");
    assert_eq!(one(TypeOp::SetReview(true)), Ok(Some(swap(&orig, "review: false\n", "review: true\n"))), "review");
    assert_eq!(one(TypeOp::SetPreview(vec!["firma".into(), "e-mail".into()])), Ok(Some(swap(&orig, "preview: [firma]\n", "preview: [firma, e-mail]\n"))), "preview");

    // An absent field is inserted after the nearest preceding canonical key (`color`), before `review`.
    let got = one(TypeOp::SetDescription(Some("Lidé z práce.".into()))).ok().flatten().unwrap_or_default();
    let line = "description: Lidé z práce.\n";
    assert!(got.contains(line), "description line written:\n{got}");
    assert_eq!(got.replacen(line, "", 1), orig, "nothing else changed");
    let (c, d, r) = (got.find("color: purple").unwrap_or(usize::MAX), got.find(line).unwrap_or(0), got.find("review: false").unwrap_or(0));
    assert!(c < d && d < r, "description sits after color and before review");
    assert_eq!(got.lines().count(), orig.lines().count() + 1);

    // Adding a property appends one item at the end of `attributes`.
    let add = one(TypeOp::AddAttribute(attr("telefon-do-práce", "Telefon do práce", AttrType::Text)));
    assert_eq!(add, Ok(Some(format!("{orig}  - key: telefon-do-práce\n    name: Telefon do práce\n    type: text\n"))), "add property");
}

#[test]
fn ar_07_ac5_change_back_is_written_and_an_equal_value_writes_nothing() {
    let orig = ty("osoba");
    let teal = do_patch("osoba", &orig, vec![TypeOp::SetColor("teal".into())]).ok().flatten().unwrap_or_default();
    assert_eq!(do_patch("osoba", &teal, vec![TypeOp::SetColor("purple".into())]), Ok(Some(orig.clone())), "change back is written, byte-identical to the original");
    for op in [
        TypeOp::SetColor("purple".into()),
        TypeOp::SetName("Osoba".into()),
        TypeOp::SetPlural("Osoby".into()),
        TypeOp::SetFolder("Osoby".into()),
        TypeOp::SetIcon("user".into()),
        TypeOp::SetReview(false),
        TypeOp::SetPreview(vec!["firma".into()]),
        TypeOp::SetDescription(None),
    ] {
        let what = format!("{op:?}");
        assert_eq!(do_patch("osoba", &orig, vec![op]), Ok(None), "{what}: equal value writes nothing (FR-SYN-06)");
    }
    // Ops apply in order, all or nothing: a refused op leaves nothing written.
    let r = do_patch("osoba", &orig, vec![TypeOp::SetColor("teal".into()), TypeOp::SetFolder("../ven".into())]);
    assert_eq!(r, Err(SchemaError::Rule(RuleError::FolderInvalid)));
}

#[test]
fn ar_07_ac6_round_trip_of_every_fixture_type_file() {
    let mut files: Vec<(String, String)> = Vec::new();
    for dir in ["new-empty/.tegg/types", "new-starter/.tegg/types", "shell/.tegg/types", "types/.tegg/types"] {
        let abs = repo().join("tests/fixtures/vaults").join(dir);
        let mut names: Vec<_> = std::fs::read_dir(&abs).expect("setup: fixture dir").map(|e| e.expect("entry").file_name().to_string_lossy().to_string()).collect();
        names.sort();
        for n in names {
            let key = nfc(n.trim_end_matches(".yml"));
            if key == "rozbitý" {
                continue;
            }
            files.push((key, std::fs::read_to_string(abs.join(&n)).expect("setup: read")));
        }
    }
    assert!(files.len() >= 23, "setup: fixture type files");
    for (key, text) in &files {
        let p = parse(key, text);
        assert!(!matches!(p.readability, Readability::Invalid { .. }), "{key}: must parse, got {:?}", p.readability);
        assert_eq!(do_patch(key, text, vec![]), Ok(None), "{key}: no change, nothing to write");
        let canonical = serialize(&p.def);
        let again = parse(key, &canonical);
        assert_eq!(again.def, p.def, "{key}: parse → canonical write → parse gives an equal definition");
        if !text.contains('#') || text.matches('#').count() == 1 {
            // Files in the canonical layout (no comment besides the header, no unknown key) serialize to their own bytes.
            if !text.contains("poznámka-pro-mě") && !text.contains("\nviews:") {
                assert_eq!(&canonical, text, "{key}: canonical write of an unchanged canonical file is byte-identical");
            }
        }
    }
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 rules

#[test]
fn fr_typ_01_ac3_type_name_rules_from_the_corpus() {
    let c = corpus("rules.json");
    let ctx: Vec<(String, String, String)> = c["types"].as_array().expect("types").iter().map(|t| (t["key"].as_str().unwrap().into(), t["name"].as_str().unwrap().into(), t["folder"].as_str().unwrap().into())).collect();
    let others: Vec<TypeNames> = ctx.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: false }).collect();
    let mut bad = Vec::new();
    for case in c["typeNames"].as_array().expect("typeNames") {
        let (name, plural) = (case["name"].as_str().unwrap(), case["plural"].as_str().unwrap());
        let got = check_type_name(name, plural, &others, true);
        let ok = match (&got, &case["expect"]) {
            (Ok(key), Value::Null) => *key == nfc(name).trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("-"),
            (Ok(_), _) => false,
            (Err(e), exp) => rule_matches(&Err(e.clone()), exp),
        };
        if !ok {
            bad.push(format!("{name:?} / {plural:?}: got {got:?}, want {}", case["expect"]));
        }
    }
    assert!(bad.is_empty(), "type name rules:\n{}", bad.join("\n"));
}

#[test]
fn fr_typ_01_ac3_type_key_matches_the_corpus() {
    let c = corpus("rules.json");
    let mut bad = Vec::new();
    for pair in c["typeKey"].as_array().expect("typeKey") {
        let (input, want) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
        if type_key(input) != want {
            bad.push(format!("{input:?} → {:?}, want {want:?}", type_key(input)));
        }
    }
    assert!(bad.is_empty(), "type_key (D-96):\n{}", bad.join("\n"));
}

#[test]
fn fr_typ_01_ac4_name_and_plural_patch_only_their_line_and_follow_the_rules() {
    let orig = ty("schůzka");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetName("Porada".into())]), Ok(Some(swap(&orig, "name: Schůzka\n", "name: Porada\n"))));
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetPlural("Porady".into())]), Ok(Some(swap(&orig, "plural: Schůzky\n", "plural: Porady\n"))));
    assert_eq!(
        do_patch("schůzka", &orig, vec![TypeOp::SetDescription(Some("Všechny porady.".into()))]),
        Ok(Some(swap(&orig, "description: Porady a schůzky.\n", "description: Všechny porady.\n")))
    );
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetDescription(None)]), Ok(Some(swap(&orig, "description: Porady a schůzky.\n", ""))), "a cleared description removes its line");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetName("Po:rada".into())]), Err(SchemaError::Rule(RuleError::ForbiddenChar { field: Field::Name })));
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetPlural("  ".into())]), Err(SchemaError::Rule(RuleError::Empty { field: Field::Plural })));
    // A name YAML would read as something else is written double-quoted (§14.1.4 scalars).
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetName("True".into())]), Ok(Some(swap(&orig, "name: Schůzka\n", "name: \"True\"\n"))));
}

#[test]
fn fr_typ_01_ac5_folder_rules_from_the_corpus() {
    let c = corpus("rules.json");
    let ctx: Vec<(String, String, String)> = c["types"].as_array().expect("types").iter().map(|t| (t["key"].as_str().unwrap().into(), t["name"].as_str().unwrap().into(), t["folder"].as_str().unwrap().into())).collect();
    let mut bad = Vec::new();
    for case in c["folders"].as_array().expect("folders") {
        let folder = case["folder"].as_str().unwrap();
        let me = case["self"].as_str().unwrap_or("");
        let others: Vec<TypeNames> = ctx.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: k == me }).collect();
        let got = check_folder(folder, &others);
        let ok = match (&got, &case["expect"]) {
            (Ok(v), Value::Null) => Some(v.as_str()) == case["result"].as_str(),
            (Ok(_), _) => false,
            (Err(e), exp) => rule_matches(&Err(e.clone()), exp),
        };
        if !ok {
            bad.push(format!("{folder:?} (self {me:?}): got {got:?}, want {} / {}", case["expect"], case["result"]));
        }
    }
    assert!(bad.is_empty(), "folder rules:\n{}", bad.join("\n"));
}

#[test]
fn fr_typ_01_ac5_folder_change_writes_only_the_folder_line() {
    let orig = ty("schůzka");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetFolder("Práce/Porady".into())]), Ok(Some(swap(&orig, "folder: Schůzky\n", "folder: Práce/Porady\n"))));
    for bad in ["", "/abs", "../ven", ".skryté", "_templates", "_attachments/x", ".trash", ".tegg", "Osoby"] {
        let r = do_patch("schůzka", &orig, vec![TypeOp::SetFolder(bad.into())]);
        assert!(matches!(r, Err(SchemaError::Rule(_))), "{bad:?}: refused with a rule error, got {r:?}");
    }
}

// ------------------------------------------------------------------------------------------------ FR-TYP-02

#[test]
fn fr_typ_02_ac1_offered_types_in_r10_order() {
    let got: Vec<&str> = AttrType::OFFERED.iter().map(|t| t.as_str()).collect();
    assert_eq!(got, vec!["text", "long-text", "number", "checkbox", "date", "date-time", "date-range", "select", "multi-select", "url", "email", "relation"]);
    for t in AttrType::OFFERED.iter() {
        assert!(t.editable(), "{t:?} is editable");
        assert_eq!(&AttrType::parse(t.as_str()), t, "parse(as_str) round trip");
    }
    for s in ["rating", "currency", "file", "color", "recurrence"] {
        assert!(!AttrType::OFFERED.iter().any(|t| t.as_str() == s), "{s} is not offered");
        assert!(!AttrType::parse(s).editable(), "{s} is read-only");
    }
    assert_eq!(AttrType::parse("file"), AttrType::File);
    assert_eq!(AttrType::parse("color"), AttrType::Color);
    assert_eq!(AttrType::parse("recurrence"), AttrType::Recurrence);
}

#[test]
fn fr_typ_02_ac2_validity_corpus() {
    let c = corpus("values.json");
    let mut bad = Vec::new();
    for case in c["cases"].as_array().expect("cases") {
        let a = attr_from_json(&case["attr"]);
        let fm = frontmatter(case["yaml"].as_str().unwrap());
        let got = validity_json(&validate(&a, &fm));
        if got != case["expect"] {
            bad.push(format!("{}: got {got}, want {}", case["name"], case["expect"]));
        }
    }
    assert!(bad.is_empty(), "validity (R10, D-231):\n{}", bad.join("\n"));
}

fn invalid_keys(type_key: &str, note: &str) -> Vec<String> {
    let fm = frontmatter(&read(&format!("tests/fixtures/vaults/types/{note}")));
    attrs_of(type_key).iter().filter(|a| matches!(validate(a, &fm), Validity::Invalid { .. })).map(|a| a.key.clone()).collect()
}

#[test]
fn fr_typ_02_ac2_validity_on_the_fixture_objects() {
    assert_eq!(attrs_of("projekt").len(), 7, "setup through parse: projekt has seven attributes");
    assert_eq!(invalid_keys("projekt", "Projekty/Rozpočet 2027.md"), Vec::<String>::new(), "Rozpočet: every value valid");
    assert_eq!(invalid_keys("projekt", "Projekty/Chybné hodnoty.md"), vec!["stav", "období", "rozpočet", "aktivní", "oblasti", "web"], "Chybné");
    let ve = invalid_keys("schůzka", "Pages/Schůzka ve stránkách.md");
    assert!(ve.contains(&"datum".to_string()) && ve.contains(&"účastníci".to_string()), "Ve stránkách: datum and účastníci invalid, got {ve:?}");
    assert!(!ve.contains(&"začátek".to_string()) && !ve.contains(&"místo".to_string()), "Ve stránkách: empty values are never invalid, got {ve:?}");
    assert_eq!(invalid_keys("osoba", "Osoby/Petr Dvořák.md"), vec!["e-mail"], "Petr");
    assert_eq!(invalid_keys("osoba", "Osoby/Jana Nováková.md"), Vec::<String>::new(), "Jana");
    // Chybné's oblasti: only the second item (`Koníčky`) is invalid; `Práce` is shown normally.
    let fm = frontmatter(&read("tests/fixtures/vaults/types/Projekty/Chybné hodnoty.md"));
    let oblasti = attrs_of("projekt").into_iter().find(|a| a.key == "oblasti");
    assert_eq!(oblasti.map(|a| validate(&a, &fm)), Some(Validity::Invalid { items: vec![1] }));
}

#[test]
fn fr_typ_02_ac5_unsupported_type_is_read_and_kept_byte_for_byte() {
    let orig = ty("osoba");
    let a = attrs_of("osoba");
    let h = a.iter().find(|x| x.key == "hodnocení");
    assert_eq!(h.map(|x| x.r#type.clone()), Some(AttrType::Other("rating".into())), "hodnocení is kept as `rating`");
    assert_eq!(h.map(|x| x.r#type.editable()), Some(false));
    let item = "  - key: hodnocení\n    name: Hodnocení\n    type: rating\n";
    for op in [TypeOp::SetColor("teal".into()), TypeOp::SetPreview(vec![]), TypeOp::AddAttribute(attr("web", "Web", AttrType::Url))] {
        let what = format!("{op:?}");
        let got = do_patch("osoba", &orig, vec![op]).ok().flatten().unwrap_or_default();
        assert!(got.contains(item), "{what}: the rating item is kept byte for byte:\n{got}");
    }
    // Deletion is the one change allowed on it.
    assert_eq!(do_patch("osoba", &orig, vec![TypeOp::RemoveAttribute("hodnocení".into())]), Ok(Some(swap(&orig, item, ""))));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-03

#[test]
fn fr_typ_03_ac1_key_derivation_corpus() {
    let c = corpus("rules.json");
    let mut bad = Vec::new();
    for pair in c["deriveAttrKey"].as_array().expect("deriveAttrKey") {
        let (input, want) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
        if derive_attr_key(input) != want {
            bad.push(format!("{input:?} → {:?}, want {want:?}", derive_attr_key(input)));
        }
    }
    assert!(bad.is_empty(), "derive_attr_key (D-223):\n{}", bad.join("\n"));
}

#[test]
fn fr_typ_03_ac1_add_property_appends_exactly_three_lines() {
    let orig = ty("osoba");
    let got = do_patch("osoba", &orig, vec![TypeOp::AddAttribute(attr("telefon-do-práce", "Telefon do práce", AttrType::Text))]);
    assert_eq!(got, Ok(Some(format!("{orig}  - key: telefon-do-práce\n    name: Telefon do práce\n    type: text\n"))));
    // `attributes: []` becomes `attributes:` plus the item.
    let empty = ty("prázdný");
    let got = do_patch("prázdný", &empty, vec![TypeOp::AddAttribute(attr("obsah", "Obsah", AttrType::LongText))]);
    assert_eq!(got, Ok(Some(swap(&empty, "attributes: []\n", "attributes:\n  - key: obsah\n    name: Obsah\n    type: long-text\n"))));
}

#[test]
fn fr_typ_03_ac2_attribute_key_rules_from_the_corpus() {
    let c = corpus("rules.json");
    let mut bad = Vec::new();
    for case in c["attrKeys"].as_array().expect("attrKeys") {
        let def = type_from_json(&case["type"]);
        let key = case["key"].as_str().unwrap();
        let t = attr_type(case["attrType"].as_str().unwrap());
        let got = check_attr_key(key, &def, &t);
        if !rule_matches(&got, &case["expect"]) {
            bad.push(format!("{} / {key:?} as {t:?}: got {got:?}, want {}", def.key, case["expect"]));
        }
    }
    assert!(bad.is_empty(), "attribute key rules (D-223, FR-TYP-15):\n{}", bad.join("\n"));
}

#[test]
fn fr_typ_03_ac2_add_with_a_refused_key_writes_nothing() {
    let orig = ty("projekt");
    for (key, want) in [
        ("source", RuleError::ReservedKey { key: "source".into() }),
        ("stav", RuleError::AttrKeyTaken),
        ("období-start", RuleError::RangeCollision),
        ("1rok", RuleError::AttrKeyInvalid),
    ] {
        let r = do_patch("projekt", &orig, vec![TypeOp::AddAttribute(attr(key, key, AttrType::Text))]);
        assert_eq!(r, Err(SchemaError::Rule(want)), "{key}");
    }
}

#[test]
fn fr_typ_03_ac5_options_change_only_the_options_lines_and_labels_are_checked() {
    let orig = ty("projekt");
    let opts = |labels: &[(&str, &str)]| labels.iter().map(|(l, c)| OptionDef { label: (*l).into(), color: Some((*c).into()), extra: vec![] }).collect::<Vec<_>>();
    let change = |o: Vec<OptionDef>| TypeOp::UpdateAttribute { key: "stav".into(), change: AttrChange { options: Some(o), ..Default::default() } };
    let added = do_patch("projekt", &orig, vec![change(opts(&[("Plánovaný", "gray"), ("Běží", "blue"), ("Hotovo", "green"), ("Pozastaveno", "yellow")]))]);
    assert_eq!(added, Ok(Some(swap(&orig, "      - { label: Hotovo, color: green }\n", "      - { label: Hotovo, color: green }\n      - { label: Pozastaveno, color: yellow }\n"))), "add option");
    let reordered = do_patch("projekt", &orig, vec![change(opts(&[("Běží", "blue"), ("Plánovaný", "gray"), ("Hotovo", "green")]))]);
    assert_eq!(
        reordered,
        Ok(Some(swap(&orig, "      - { label: Plánovaný, color: gray }\n      - { label: Běží, color: blue }\n", "      - { label: Běží, color: blue }\n      - { label: Plánovaný, color: gray }\n"))),
        "reorder"
    );
    let removed = do_patch("projekt", &orig, vec![change(opts(&[("Plánovaný", "gray"), ("Hotovo", "green")]))]);
    assert_eq!(removed, Ok(Some(swap(&orig, "      - { label: Běží, color: blue }\n", ""))), "remove");
    assert_eq!(do_patch("projekt", &orig, vec![change(opts(&[("Plánovaný", "gray"), ("běží", "blue")]))]), Err(SchemaError::Rule(RuleError::OptionDuplicate)), "case-insensitive duplicate");
    assert_eq!(do_patch("projekt", &orig, vec![change(opts(&[("Plánovaný", "gray"), ("  ", "blue")]))]), Err(SchemaError::Rule(RuleError::OptionEmpty)), "empty label");
}

#[test]
fn fr_typ_03_ac6_default_is_written_in_the_item() {
    let orig = ty("projekt");
    let op = TypeOp::UpdateAttribute { key: "stav".into(), change: AttrChange { default: Some(Some(Value::String("Běží".into()))), ..Default::default() } };
    assert_eq!(do_patch("projekt", &orig, vec![op]), Ok(Some(swap(&orig, "    default: Plánovaný\n", "    default: Běží\n"))));
    let set = TypeOp::UpdateAttribute { key: "rozpočet".into(), change: AttrChange { default: Some(Some(serde_json::json!(1000))), ..Default::default() } };
    assert_eq!(do_patch("projekt", &orig, vec![set]), Ok(Some(swap(&orig, "    name: Rozpočet\n    type: number\n", "    name: Rozpočet\n    type: number\n    default: 1000\n"))));
}

#[test]
fn fr_typ_03_ac7_required_true_written_and_unchecking_removes_the_key() {
    let orig = ty("projekt");
    let off = TypeOp::UpdateAttribute { key: "stav".into(), change: AttrChange { required: Some(false), ..Default::default() } };
    assert_eq!(do_patch("projekt", &orig, vec![off]), Ok(Some(swap(&orig, "    required: true\n", ""))));
    let on = TypeOp::UpdateAttribute { key: "web".into(), change: AttrChange { required: Some(true), ..Default::default() } };
    assert_eq!(do_patch("projekt", &orig, vec![on]), Ok(Some(swap(&orig, "    name: Web\n    type: url\n", "    name: Web\n    type: url\n    required: true\n"))));
}

fn items(text: &str) -> (String, Vec<String>) {
    let at = text.find("attributes:\n").expect("setup: attributes") + "attributes:\n".len();
    let (head, rest) = text.split_at(at);
    let mut out: Vec<String> = Vec::new();
    for line in rest.split_inclusive('\n') {
        if line.starts_with("  - ") {
            out.push(String::new());
        }
        if let Some(last) = out.last_mut() {
            last.push_str(line);
        }
    }
    (head.to_string(), out)
}

#[test]
fn fr_typ_03_ac9_reorder_moves_items_unchanged() {
    let orig = ty("schůzka");
    let (head, it) = items(&orig);
    let pos = |k: &str| it.iter().position(|i| i.starts_with(&format!("  - key: {k}\n"))).expect("setup: item");
    let mut want = it.clone();
    let m = want.remove(pos("místo"));
    want.insert(pos("datum"), m);
    let got = do_patch("schůzka", &orig, vec![TypeOp::MoveAttribute { key: "místo".into(), to: 0 }]);
    assert_eq!(got, Ok(Some(format!("{head}{}", want.concat()))), "Místo above Datum, each item byte-identical");
    let mut down = it.clone();
    let d = down.remove(0);
    down.insert(1, d);
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::MoveAttribute { key: "datum".into(), to: 1 }]), Ok(Some(format!("{head}{}", down.concat()))), "⌥↓ on Datum");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::MoveAttribute { key: "datum".into(), to: 0 }]), Ok(None), "no move, nothing written");
}

#[test]
fn fr_typ_03_ac11_type_change_writes_the_type_line_and_drops_options_that_no_longer_apply() {
    let orig = ty("schůzka");
    let to = |k: &str, t: AttrType| TypeOp::UpdateAttribute { key: k.into(), change: AttrChange { r#type: Some(t), ..Default::default() } };
    assert_eq!(
        do_patch("schůzka", &orig, vec![to("místo", AttrType::Number)]),
        Ok(Some(swap(&orig, "    name: Místo\n    type: text\n", "    name: Místo\n    type: number\n"))),
        "místo Text → Number"
    );
    assert_eq!(
        do_patch("schůzka", &orig, vec![to("účastníci", AttrType::Text)]),
        Ok(Some(swap(&orig, "    type: relation\n    to: [osoba]\n    multiple: true\n", "    type: text\n"))),
        "relation → text drops to and multiple"
    );
    let p = ty("projekt");
    assert_eq!(
        do_patch("projekt", &p, vec![to("oblasti", AttrType::Text)]),
        Ok(Some(swap(&p, "    type: multi-select\n    options:\n      - { label: Práce, color: blue }\n      - { label: Rodina, color: green }\n      - { label: Zdraví, color: red }\n", "    type: text\n"))),
        "multi-select → text drops options"
    );
    assert_eq!(
        do_patch("projekt", &p, vec![to("oblasti", AttrType::Select)]),
        Ok(Some(swap(&p, "    type: multi-select\n", "    type: select\n"))),
        "multi-select → select keeps options"
    );
}

// ------------------------------------------------------------------------------------------------ FR-TYP-04, -06, -11, -12

#[test]
fn fr_typ_04_ac4_delete_property_removes_its_item_and_its_preview_key_in_one_write() {
    let orig = ty("schůzka");
    let místo = "  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n";
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::RemoveAttribute("místo".into())]), Ok(Some(swap(&orig, místo, ""))), "místo removed");
    let want = swap(&swap(&orig, "  - key: datum\n    name: Datum\n    type: date\n", ""), "preview: [datum, účastníci]\n", "preview: [účastníci]\n");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::RemoveAttribute("datum".into())]), Ok(Some(want)), "datum removed from attributes and preview");
}

#[test]
fn fr_typ_06_ac2_built_in_attributes_are_locked() {
    let task = sys("task");
    let p = parse("task", &task);
    let built: Vec<(&str, bool)> = p.def.attributes.iter().map(|a| (a.key.as_str(), a.built_in)).collect();
    assert_eq!(built, vec![("status", true), ("priority", true), ("due", true), ("completed", true), ("recurrence", true)]);
    let refused = [
        TypeOp::UpdateAttribute { key: "status".into(), change: AttrChange { name: Some("Stav".into()), ..Default::default() } },
        TypeOp::UpdateAttribute { key: "due".into(), change: AttrChange { r#type: Some(AttrType::DateTime), ..Default::default() } },
        TypeOp::UpdateAttribute { key: "priority".into(), change: AttrChange { required: Some(true), ..Default::default() } },
        TypeOp::UpdateAttribute { key: "status".into(), change: AttrChange { options: Some(vec![OptionDef { label: "Hotovo".into(), color: Some("green".into()), extra: vec![] }]), ..Default::default() } },
        TypeOp::RemoveAttribute("due".into()),
        TypeOp::RemoveAttribute("recurrence".into()),
    ];
    for op in refused {
        let what = format!("{op:?}");
        assert_eq!(do_patch("task", &task, vec![op]), Err(SchemaError::BuiltInChanged), "{what}");
    }
    // Task status options keep their extra `state` field when read.
    let status = p.def.attributes.iter().find(|a| a.key == "status");
    assert_eq!(status.map(|s| s.options.first().map(|o| o.extra.clone())), Some(Some(vec![("state".to_string(), Value::String("open".into()))])));
}

#[test]
fn fr_typ_06_ac3_what_can_change_on_system_types() {
    let task = sys("task");
    let add = do_patch("task", &task, vec![TypeOp::AddAttribute(attr("kontext", "Kontext", AttrType::Text))]);
    assert_eq!(add, Ok(Some(format!("{task}  - key: kontext\n    name: Kontext\n    type: text\n"))), "kontext after recurrence");
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetIcon("flag".into())]), Ok(Some(swap(&task, "icon: check-square\n", "icon: flag\n"))));
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetColor("red".into())]), Ok(Some(swap(&task, "color: blue\n", "color: red\n"))));
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetFolder("Úkoly".into())]), Ok(Some(swap(&task, "folder: Tasks\n", "folder: Úkoly\n"))));
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetPreview(vec!["status".into(), "due".into()])]), Ok(Some(swap(&task, "preview: [status, priority, due]\n", "preview: [status, due]\n"))));
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetName("Úkol".into())]), Err(SchemaError::SystemTypeName));
    assert_eq!(do_patch("task", &task, vec![TypeOp::SetPlural("Úkoly".into())]), Err(SchemaError::SystemTypeName));
}

#[test]
fn fr_typ_11_ac1_preview_is_a_flow_list_of_at_most_four_keys() {
    let orig = ty("schůzka");
    let set = |k: &[&str]| TypeOp::SetPreview(k.iter().map(|s| s.to_string()).collect());
    assert_eq!(do_patch("schůzka", &orig, vec![set(&["datum", "účastníci", "tags"])]), Ok(Some(swap(&orig, "preview: [datum, účastníci]\n", "preview: [datum, účastníci, tags]\n"))));
    assert_eq!(do_patch("schůzka", &orig, vec![set(&["účastníci", "datum"])]), Ok(Some(swap(&orig, "preview: [datum, účastníci]\n", "preview: [účastníci, datum]\n"))), "reorder");
    assert_eq!(do_patch("schůzka", &orig, vec![set(&[])]), Ok(Some(swap(&orig, "preview: [datum, účastníci]\n", "preview: []\n"))), "remove all");
    assert_eq!(do_patch("schůzka", &orig, vec![set(&["datum", "účastníci", "tags", "source", "modified"])]), Err(SchemaError::Rule(RuleError::PreviewFull)));
}

#[test]
fn fr_typ_11_ac2_unknown_preview_keys_are_ignored_with_a_warning_and_kept() {
    let orig = ty("osoba");
    let text = swap(&orig, "preview: [firma]\n", "preview: [firma, neexistuje, tags]\n");
    let p = parse("osoba", &text);
    assert_eq!(p.readability, Readability::Ok);
    assert_eq!(p.def.preview, vec!["firma", "neexistuje", "tags"], "kept as written");
    assert_eq!(p.preview_ignored, vec!["neexistuje"], "neither a property nor a universal attribute");
    let got = do_patch("osoba", &text, vec![TypeOp::SetColor("teal".into())]).ok().flatten().unwrap_or_default();
    assert!(got.contains("preview: [firma, neexistuje, tags]\n"), "kept in the file:\n{got}");
}

#[test]
fn fr_typ_12_ac1_review_switch_writes_only_its_line_and_is_off_for_new_and_starter_types() {
    assert!(new_type_file("Čajovna", "Čajovny").contains("\nreview: false\n"), "off for new types");
    let starter: Vec<_> = STARTER_FILES.iter().filter(|(p, _)| p.starts_with(".tegg/types/")).collect();
    assert_eq!(starter.len(), 7, "setup: seven starter types");
    for (path, bytes) in starter {
        assert_eq!(parse("x", &String::from_utf8_lossy(bytes)).def.review, Review::Off, "{path}: review off");
    }
    let orig = ty("schůzka");
    assert_eq!(do_patch("schůzka", &orig, vec![TypeOp::SetReview(true)]), Ok(Some(swap(&orig, "review: false\n", "review: true\n"))));
    let n = ty("nápad");
    assert_eq!(do_patch("nápad", &n, vec![TypeOp::SetReview(false)]), Ok(Some(swap(&n, "review: true\n", "review: false\n"))));
}

#[test]
fn fr_typ_12_ac2_locked_review_is_refused() {
    for key in ["quick-note", "daily-note"] {
        let text = sys(key);
        assert_eq!(parse(key, &text).def.review, Review::Locked, "{key}: locked");
        assert_eq!(do_patch(key, &text, vec![TypeOp::SetReview(false)]), Err(SchemaError::ReviewLocked), "{key}");
        assert_eq!(do_patch(key, &text, vec![TypeOp::SetReview(true)]), Err(SchemaError::ReviewLocked), "{key}");
    }
}
