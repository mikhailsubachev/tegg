//! Slice I1, L4: type, attribute and value mapping (docs/acceptance/import-capacities.md FR-IMP-08 AC-1…AC-12, AC-17;
//! FR-IMP-09 AC-1…AC-6 (Z); FR-IMP-21 AC-1…AC-4; FR-IMP-24 AC-1…AC-3; FR-TYP-15 AC-1, AC-3; R148;
//! docs/contracts/v1-import.md §4, §4.1, §4.2, §7.2, §7.3). A mapping is data (JSON, §4); the default mapping is
//! `Mapping::default()`. Criteria marked (Z) run with Europe/Prague, America/New_York and Pacific/Kiritimati injected.
//! Written from the criteria, the contract and the fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::path::Path;

use common::*;
use tegg_import::{
    AttrAction, AttrChange, AttrTarget, Control, DateRow, ImportError, KeyReason, LinkOutcome, Mapping, MappingEntry, MappingReason, NotExported, ObjectKind,
    ObjectOutcome, OtherKind, SkippedRow, StatusMap, TypeTarget, UnresolvedReason, ValueMerge,
};

/// Import a source folder's `PKM` into a new vault with a mapping given as JSON.
fn import_with(sb: &Sandbox, src: &Path, json: &str) -> Result<Imported, String> {
    import_new(sb, src, SPACE, &mapping(json)?, &env(sb)?)
}
/// The written text of the object whose source path is `source`.
fn written(run: &Imported, source: &str) -> Option<String> {
    path_of(&run.plan, source).and_then(|p| read_text(&run.root, &p))
}
fn attr<'a>(run: &'a Imported, source_type: &str, key: &str) -> Option<&'a tegg_import::PlannedAttr> {
    run.plan.types.iter().find(|t| t.source_type == source_type).and_then(|t| t.attributes.iter().find(|a| a.source_key == key))
}
fn kv(text: &str) -> Vec<(String, String)> {
    fm(text).into_iter().filter(|(k, _)| !["id", "import-id", "created", "modified"].contains(&k.as_str())).collect()
}
fn pairs(v: &[(&str, &str)]) -> Vec<(String, String)> {
    v.iter().map(|(k, x)| (k.to_string(), x.to_string())).collect()
}
fn plan_err(sb: &Sandbox, src: &Path, json: &str) -> Result<Option<ImportError>, String> {
    let env = env(sb)?;
    let scan = scan_of(src, &env)?;
    Ok(tegg_import::plan(&scan, SPACE, &new_target(sb), &mapping(json)?, &env, &Control::default()).err())
}

// ------------------------------------------------------------------------------------------------ FR-IMP-08

#[test]
fn fr_imp_08_ac1_default_type_mapping() {
    let cases: [(&str, &[(&str, &str, bool)]); 7] = [
        ("c02-typed-frontmatter", &[("Book", "book", true), ("Idea", "idea", true), ("Page", "page", false)]),
        ("c05-media-objects", &[("Image", "image", false), ("PDF", "pdf", false), ("Page", "page", false)]),
        ("c06-weblinks", &[("Page", "page", false), ("Weblink", "page", false)]),
        ("c07-query-shells", &[("Query", "page", false)]),
        ("c12-task-dates", &[("Task", "task", false)]),
        ("c13-daily-notes", &[("DailyNote", "daily-note", false)]),
        ("c19-ai-chat", &[("AIChat", "page", false)]),
    ];
    for (fixture, want) in cases {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let got: Vec<(&str, Option<&str>, bool)> = run.plan.types.iter().map(|t| (t.source_type.as_str(), t.key.as_deref(), t.new)).collect();
        assert_eq!(got, want.iter().map(|(s, k, n)| (*s, Some(*k), *n)).collect::<Vec<_>>(), "{fixture}: R148's default target per source type");
        for o in run.plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported && o.kind != ObjectKind::OrphanMedia) {
            let (_, key, _) = some!(want.iter().find(|(s, _, _)| Some(*s) == o.source_type.as_deref()), format!("{fixture}: {} has a known source type", o.source));
            let text = some!(written(&run, &o.source), format!("{fixture}: {} is written", o.source));
            assert_eq!(fm_get(&text, "type").as_deref(), Some(*key), "{fixture}: {} is written with `type: {key}`", o.source);
        }
        if fixture == "c07-query-shells" {
            assert!(run.plan.objects.iter().all(|o| o.kind == ObjectKind::QueryStub), "queries are stubs (FR-IMP-16)");
        }
    }
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02");
    assert_eq!(run.plan.mapping.types.get("Book").and_then(|t| t.to.clone()), Some(TypeTarget::New { name: "Book".into() }), "any other type → a new type with the same name; the effective mapping says so");
    assert_eq!(run.plan.mapping.types.get("Page").and_then(|t| t.to.clone()), Some(TypeTarget::Existing { key: "page".into() }), "Page → the system type");
}

#[test]
fn fr_imp_08_ac2_attributes_map_to_existing_new_or_drop() {
    // New attributes with an inferred kind (D-1526): checkbox, number, select, text; date, date-time, date range, relation.
    let kinds = |run: &Imported, t: &str| run.plan.types.iter().find(|x| x.source_type == t).map(|x| x.attributes.iter().filter(|a| a.action == AttrAction::New).map(|a| (a.source_key.clone(), a.r#type.clone().unwrap_or_default())).collect::<Vec<_>>()).unwrap_or_default();
    let p = |v: &[(&str, &str)]| pairs(v);
    let sb = sandbox();
    let c02 = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02");
    assert_eq!(kinds(&c02, "Book"), p(&[("author", "text"), ("medium", "select"), ("language", "select"), ("pages", "number"), ("finished", "checkbox")]), "Book's new attributes, in source order");
    for k in ["type", "title", "tags"] {
        assert_eq!(attr(&c02, "Book", k).map(|a| a.action.clone()), Some(AttrAction::Consumed), "`{k}` is one of R148's on-purpose rows");
    }
    let sb = sandbox();
    let c03 = ok!(import_fixture(&sb, "c03-utc-midnight-dates"), "import c03");
    assert_eq!(kinds(&c03, "Meeting"), p(&[("date", "date"), ("followUp", "date-time")]), "all UTC-midnight date-times → date; other date-times → date-time");
    assert_eq!(attr(&c03, "Meeting", "followUp").map(|a| (a.values, a.nulls)), Some((1, 1)), "values and nulls are counted");
    let sb = sandbox();
    let c04 = ok!(import_fixture(&sb, "c04-date-ranges"), "import c04");
    assert_eq!((kinds(&c04, "Project"), kinds(&c04, "Trip")), (p(&[("timeFrame", "date-range")]), p(&[("dates", "date-range")])), "`a -> b` → date range");
    let sb = sandbox();
    let c11 = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    assert_eq!(kinds(&c11, "Meeting"), p(&[("date", "date"), ("peopleInvolved", "relation")]), "all `[[links]]` → relation; the key stays `peopleInvolved` (D-1553)");
    // An existing attribute (Task's own), and `drop` from the mapping, reported.
    let sb = sandbox();
    let c21 = ok!(import_with(&sb, &fixtures().join("c21-value-variants"), r#"{"types":{"Task":{"attributes":{"people":{"to":{"kind":"drop"}}}}}}"#), "import c21 with people dropped");
    assert_eq!(attr(&c21, "Task", "people").map(|a| (a.action.clone(), a.key.clone())), Some((AttrAction::Drop, None)), "`people` is dropped by the mapping");
    assert!(c21.plan.report.attributes.iter().any(|r| r.source_type == "Task" && r.source_key == "people" && r.change == AttrChange::Dropped { values: 2 }), "and reported with its value count");
    assert!(!some!(written(&c21, "Tasks/Zavolat instalatéra.md"), "the Task").contains("people"), "it isn't written");
    assert_eq!(attr(&c21, "Task", "priority").map(|a| (a.action.clone(), a.key.clone())), Some((AttrAction::Consumed, Some("priority".into()))), "Task `priority` maps onto the Task type's attribute");
}

#[test]
fn fr_imp_08_ac3_select_values_merge_case_insensitively() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02");
    let language = some!(attr(&run, "Book", "language"), "Book.language");
    assert_eq!(language.merges, [ValueMerge { variants: strs(&["ENG", "eng"]), kept: "ENG".into(), applied: true }], "the preview shows the merge of ENG / eng into ENG (the spelling used by more objects)");
    assert_eq!(language.options, ["ENG", "CZE"], "the options after the merge, in first-seen order");
    assert!(run.plan.report.merged.iter().any(|m| m.source_type == "Book" && m.key == "language" && m.variants == ["ENG", "eng"] && m.kept == "ENG"), "the report's Merged values row");
    assert_eq!(fm_get(&some!(written(&run, "Books/Book 2.md"), "Book 2"), "language").as_deref(), Some("ENG"), "Book 2's `eng` is written as ENG");
    // A choice of the canonical spelling.
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c02-typed-frontmatter"), r#"{"types":{"Book":{"attributes":{"language":{"merge":{"kind":"keep","spellings":{"eng":"eng"}}}}}}}"#), "import c02 keeping `eng`");
    assert_eq!(some!(attr(&run, "Book", "language"), "Book.language").merges, [ValueMerge { variants: strs(&["ENG", "eng"]), kept: "eng".into(), applied: true }], "the mapping picks the other spelling");
    for (book, want) in [("Book 1", "eng"), ("Book 2", "eng"), ("Book 4", "CZE")] {
        assert_eq!(fm_get(&some!(written(&run, &format!("Books/{book}.md")), book), "language").as_deref(), Some(want), "{book}'s language");
    }
    assert_eq!(type_options(&some!(read_text(&run.root, ".tegg/types/book.yml"), "book.yml"), "language"), ["eng", "CZE"], "the select's options use the kept spelling");
}

#[test]
fn fr_imp_08_ac4_task_statuses_map_to_semantic_states() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    let status = |f: &str| written(&run, &format!("Tasks/{f}.md")).and_then(|t| fm_get(&t, "status"));
    assert_eq!([status("Call the plumber"), status("Plan the release"), status("Prepare budget review"), status("Write report")].map(|s| s.unwrap_or_default()), ["To do", "In progress", "Done", "To do"], "Not Started → To do, In Progress → In progress, Done → Done, empty → To do");
    let mut maps = some!(attr(&run, "Task", "status"), "Task.status").statuses.clone();
    maps.sort_by(|a, b| a.value.cmp(&b.value));
    let m = |value: &str, to: &str, state: &str, fallback: bool| StatusMap { value: value.into(), to: to.into(), state: state.into(), count: 1, fallback };
    assert_eq!(maps, [m("", "To do", "open", true), m("Done", "Done", "done", false), m("In Progress", "In progress", "in progress", false), m("Not Started", "To do", "open", true)], "each source value with its status, state and count; `Not Started` and the empty value by fallback (D-1527 (3))");
    assert_eq!(read_bytes(&run.root, ".tegg/types/task.yml"), read_bytes(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), "types/task.yml"), "task.yml gains no status");
    // A mapping names another existing status; an unknown one is refused.
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c12-task-dates"), r#"{"types":{"Task":{"attributes":{"status":{"values":{"Not Started":"Waiting","":"Cancelled"}}}}}}"#), "import with status values");
    let status = |f: &str| written(&run, &format!("Tasks/{f}.md")).and_then(|t| fm_get(&t, "status"));
    assert_eq!((status("Call the plumber").as_deref(), status("Write report").as_deref()), (Some("Waiting"), Some("Cancelled")), "the mapping's `values` are applied");
    let sb = sandbox();
    let e = ok!(plan_err(&sb, &fixtures().join("c12-task-dates"), r#"{"types":{"Task":{"attributes":{"status":{"values":{"Done":"Hotovo"}}}}}}"#), "plan");
    assert_eq!(e, Some(ImportError::InvalidMapping { entry: MappingEntry { source_type: "Task".into(), attribute: Some("status".into()) }, reason: MappingReason::UnknownStatus }), "a status the Task type doesn't have");
}

#[test]
fn fr_imp_08_ac5_comma_separated_people_can_be_split() {
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c16-comma-people"), r#"{"types":{"Project":{"attributes":{"people":{"split":{"on":true}}}}}}"#), "import c16 with split on");
    assert_eq!(fm_get(&some!(written(&run, "Projects/Launch.md"), "Launch"), "people").as_deref(), Some("[Jana, Tomáš, Eva]"), "a text list, items trimmed");
    assert_eq!(fm_get(&some!(written(&run, "Projects/Move.md"), "Move"), "people").as_deref(), Some("[Petr Novák, Eva]"), "a name with a space is one item");
    let sb = sandbox();
    let off = ok!(import_fixture(&sb, "c16-comma-people"), "import c16 with the default mapping");
    assert_eq!(fm_get(&some!(written(&off, "Projects/Launch.md"), "Launch"), "people").as_deref(), Some("Jana, Tomáš, Eva"), "with split off the text is written unchanged");
}

#[test]
fn fr_imp_08_ac6_mapping_as_data() {
    // The contract's JSON example deserializes with the structs as written (§4), and `{}` is the default mapping.
    let example = r#"{ "version": 1, "types": {
        "Book": { "to": { "kind": "new", "name": "Kniha" }, "attributes": {
            "author": { "to": { "kind": "new", "name": "autor", "type": "text" } },
            "finished": { "to": { "kind": "new", "name": "přečteno", "type": "checkbox" } },
            "language": { "merge": { "kind": "keep", "spellings": { "eng": "ENG" } } },
            "domain": { "to": { "kind": "drop" } } } },
        "Idea": { "to": { "kind": "existing", "key": "page" } },
        "Person": { "to": { "kind": "skip" } },
        "Task": { "attributes": { "status": { "values": { "Not Started": "To do", "": "To do" } },
            "people": { "to": { "kind": "new", "name": "people", "type": "relation" }, "split": { "on": true, "to": "Person" } } } },
        "Trip": { "attributes": { "status": { "to": { "kind": "new", "name": "status", "type": "select" } } } } },
      "caseLinks": [ { "note": "Pages/Odkazy.md", "target": "tomáš", "use": true } ] }"#;
    let parsed = ok!(mapping(example), "the contract's example");
    assert_eq!(parsed.types.get("Person").and_then(|t| t.to.clone()), Some(TypeTarget::Skip), "Person → skip");
    assert_eq!(parsed.types.get("Book").and_then(|t| t.attributes.get("author")).and_then(|a| a.to.clone()), Some(AttrTarget::New { name: "autor".into(), r#type: Some("text".into()) }), "author → new `autor`");
    assert_eq!(parsed.case_links.len(), 1, "one confirmed case-only link");
    assert_eq!(ok!(mapping("{}"), "{}"), Mapping::default(), "`{{}}` is the default mapping");
    assert!(mapping(r#"{"typos":{}}"#).is_err(), "an unknown field is an error");

    let sb = sandbox();
    let json = r#"{"types":{"Book":{"to":{"kind":"new","name":"Kniha"},"attributes":{"author":{"to":{"kind":"new","name":"autor","type":"text"}},"finished":{"to":{"kind":"new","name":"přečteno","type":"checkbox"}}}},"Idea":{"to":{"kind":"existing","key":"page"}}}}"#;
    let run = ok!(import_with(&sb, &fixtures().join("c02-typed-frontmatter"), json), "import c02 with the mapping");
    let yml = some!(read_text(&run.root, ".tegg/types/kniha.yml"), ".tegg/types/kniha.yml");
    for line in ["version: 1", "name: Kniha", "plural: Books", "folder: Books", "system: false"] {
        assert!(yml.lines().any(|l| l == line), "kniha.yml has the line {line:?} (plural and folder stay Books)");
    }
    assert_eq!(type_attrs(&yml), pairs(&[("autor", "text"), ("medium", "select"), ("language", "select"), ("pages", "number"), ("přečteno", "checkbox")]), "the attributes: renamed ones under their new keys, the others by default");
    assert!(!files(&run.root).contains(".tegg/types/book.yml") && !files(&run.root).contains(".tegg/types/idea.yml"), "no book.yml and no idea.yml");
    for i in 1..=6 {
        let text = some!(read_text(&run.root, &format!("Books/Book {i}.md")), format!("Books/Book {i}.md"));
        assert_eq!(kv(&text), pairs(&[("type", "kniha"), ("title", &format!("Book {i}")), ("autor", &format!("Author {i}")), ("medium", ["E-Book", "Paper"][(i + 1) % 2]), ("language", ["ENG", "ENG", "ENG", "CZE", "CZE", "ENG"][i - 1]), ("pages", &(99 + i).to_string()), ("přečteno", ["false", "true"][(i + 1) % 2]), ("tags", "[reading]")]), "Book {i}: type kniha, with autor and přečteno, the rest by default");
    }
    let idea = some!(read_text(&run.root, "Pages/Idea.md"), "Idea is a Page in Pages/");
    assert_eq!(fm_get(&idea, "type").as_deref(), Some("page"), "Idea's type");
    let types: Vec<(&str, Option<&str>, Option<&str>, Option<&str>, bool)> = run.plan.types.iter().map(|t| (t.source_type.as_str(), t.key.as_deref(), t.name.as_deref(), t.folder.as_deref(), t.new)).collect();
    assert_eq!(types, [("Book", Some("kniha"), Some("Kniha"), Some("Books"), true), ("Idea", Some("page"), Some("Page"), Some("Pages"), false), ("Page", Some("page"), Some("Page"), Some("Pages"), false)], "the plan's types say so");
    assert_eq!(run.plan.report.types.iter().map(|t| (t.source_type.as_str(), t.target.as_deref(), t.new)).collect::<Vec<_>>(), [("Book", Some("Kniha"), true), ("Idea", Some("Page"), false), ("Page", Some("Page"), false)], "and the report's Types section");
}

#[test]
fn fr_imp_08_ac7_skipped_type() {
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c10-duplicate-titles"), r#"{"types":{"Person":{"to":{"kind":"skip"}}}}"#), "import c10 with Person skipped");
    assert!(!files(&run.root).iter().any(|p| p.starts_with("People/")), "no People/ file is written");
    assert!(!files(&run.root).contains(".tegg/types/person.yml"), "and no Person type");
    let tomas = some!(object(&run.plan, "People/Tomáš.md"), "Tomáš is in the plan");
    assert_eq!((tomas.outcome.clone(), tomas.path.clone()), (ObjectOutcome::Skipped, None), "skipped by the mapping");
    assert!(links_of(&run.plan, "People/Tomáš.md").iter().all(|l| l.outcome == LinkOutcome::InSkippedNote) && links_of(&run.plan, "People/Tomáš.md").len() == 2, "its two links are `in a skipped note`");
    assert!(run.plan.report.skipped.contains(&SkippedRow::Type { source_type: "Person".into(), objects: 1 }), "the report's Skipped section names the type with its count");
    assert_eq!(tegg_import::accounting::check_plan(&run.scan.source, &run.plan), Vec::new(), "the accounting passes on the plan");
    assert_eq!(tegg_import::accounting::check_vault(&run.scan.source, &run.plan, &run.root), Vec::new(), "and on the written vault");
    assert_eq!((run.plan.totals.objects.imported, run.plan.totals.objects.reported), (5, 1), "5 imported, 1 reported");

    // Links from imported notes to a skipped object stay as written: `target not imported`.
    let sb = sandbox();
    let src = source(&sb, "c20-file-name-edges");
    let run = ok!(import_with(&sb, &src, r#"{"types":{"Person":{"to":{"kind":"skip"}}}}"#), "import c20 with Person skipped");
    let l = some!(link(&run.plan, "Pages/Odkazy.md", "[[Tomáš]]"), "the link to the skipped Person");
    assert_eq!((l.outcome.clone(), l.to.clone()), (LinkOutcome::TargetNotImported, None), "target not imported");
    assert!(run.plan.report.unresolved.iter().any(|r| r.note == "Pages/Odkazy.md" && r.written == "[[Tomáš]]" && r.reason == UnresolvedReason::TargetNotImported), "reported with that reason");
    assert!(some!(written(&run, "Pages/Odkazy.md"), "Odkazy").contains("Odkaz: [[Tomáš]]\n"), "kept as written in the source");

    // Attachments referenced only by skipped notes are still imported as D-77 media.
    let sb = sandbox();
    let src = source(&sb, "c05-media-objects");
    append(&src, "PKM/Pages/Trip notes.md", "\n![x](../Images/Media/Untitled%20(44).png)\n");
    let run = ok!(import_with(&sb, &src, r#"{"types":{"Page":{"to":{"kind":"skip"}}}}"#), "import c05 with Page skipped");
    assert!(!files(&run.root).iter().any(|p| p.starts_with("Pages/") && *p != REPORT), "Trip notes is not written");
    assert!(links_of(&run.plan, "Pages/Trip notes.md").iter().all(|l| l.outcome == LinkOutcome::InSkippedNote) && links_of(&run.plan, "Pages/Trip notes.md").len() == 3, "its three links are `in a skipped note`");
    let attachments: BTreeSet<String> = files(&run.root).into_iter().filter(|p| p.starts_with("_attachments/")).collect();
    assert_eq!(attachments.len(), 4, "all four attachments are in _attachments/: {attachments:?}");
    assert!(attachments.contains("_attachments/Untitled (44).png"), "Untitled (44).png keeps its name");
    let orphan = some!(run.plan.objects.iter().find(|o| o.source == "Images/Media/Untitled (44).png"), "an Image object for the media no imported note references");
    assert_eq!((orphan.kind.clone(), orphan.title.as_deref(), orphan.r#type.as_deref()), (ObjectKind::OrphanMedia, Some("Untitled (44)"), Some("image")), "titled after the file");
    assert!(run.plan.report.files.iter().any(|r| r.source == "Images/Media/Untitled (44).png" && r.change == tegg_import::FileChange::Unreferenced), "with its report row");
    assert_eq!(tegg_import::accounting::check_vault(&run.scan.source, &run.plan, &run.root), Vec::new(), "the accounting passes");
}

#[test]
fn fr_imp_08_ac8_new_type_definition() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02");
    let yml = some!(read_text(&run.root, ".tegg/types/book.yml"), ".tegg/types/book.yml");
    let parsed = tegg_schema::parse("book", &yml);
    assert!(format!("{parsed:?}").len() > 0 && !yml.is_empty(), "book.yml is read by tegg-schema");
    for line in ["version: 1", "name: Book", "plural: Books", "system: false", "folder: Books"] {
        assert!(yml.lines().any(|l| l == line), "book.yml has the line {line:?}");
    }
    let page = std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/new-empty/.tegg/types/page.yml")).expect("setup: page.yml");
    assert_eq!(yml.lines().next(), page.lines().next(), "the type file's header line, as every Tegg type file");
    assert_eq!(type_attrs(&yml), pairs(&[("author", "text"), ("medium", "select"), ("language", "select"), ("pages", "number"), ("finished", "checkbox")]), "the attributes with their kinds, in source order");
    assert_eq!((type_options(&yml, "medium"), type_options(&yml, "language")), (strs(&["E-Book", "Paper"]), strs(&["ENG", "CZE"])), "select options in first-seen order; `eng` merged into ENG");
    let t = some!(run.plan.types.iter().find(|t| t.source_type == "Book"), "the planned type");
    assert_eq!((t.key.as_deref(), t.name.as_deref(), t.plural.as_deref(), t.folder.as_deref(), t.source_folder.as_str(), t.new, t.objects), (Some("book"), Some("Book"), Some("Books"), Some("Books"), "Books", true, 6), "name = the `type:` value, plural and folder = the export folder's name");
    let idea = some!(read_text(&run.root, ".tegg/types/idea.yml"), "idea.yml");
    assert_eq!(type_attrs(&idea), Vec::new(), "Idea has no attribute");

    // An attribute whose values are all null isn't created, and is reported with its count.
    let sb = sandbox();
    let src = source(&sb, "c02-typed-frontmatter");
    for i in 1..=6 {
        edit(&src, &format!("PKM/Books/Book {i}.md"), "finished:", "edition: null\nfinished:");
    }
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import c02 with an all-null attribute");
    assert_eq!(attr(&run, "Book", "edition").map(|a| (a.action.clone(), a.nulls)), Some((AttrAction::NotCreated, 6)), "`edition` is not created");
    assert!(run.plan.report.attributes.iter().any(|r| r.source_key == "edition" && r.change == AttrChange::NotCreated { nulls: 6 }), "and reported with its count");
    let yml = some!(read_text(&run.root, ".tegg/types/book.yml"), "book.yml");
    assert!(!type_attrs(&yml).iter().any(|(k, _)| k == "edition"), "book.yml has no `edition`");
    assert!(!some!(written(&run, "Books/Book 1.md"), "Book 1").contains("edition"), "and no Book has the key");

    // With Book 5 and Book 6 removed (4 Books, 2 values, not fewer than half): text.
    let sb = sandbox();
    let src = source(&sb, "c02-typed-frontmatter");
    for b in ["Book 5", "Book 6"] {
        std::fs::remove_file(src.join(format!("PKM/Books/{b}.md"))).expect("setup: remove");
    }
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import c02 with four Books");
    let yml = some!(read_text(&run.root, ".tegg/types/book.yml"), "book.yml");
    assert_eq!(type_attrs(&yml), pairs(&[("author", "text"), ("medium", "text"), ("language", "text"), ("pages", "number"), ("finished", "checkbox")]), "with 4 Books `medium` and `language` are text (D-1526, D-1545)");
}

#[test]
fn fr_imp_08_ac9_technical_attributes_dropped_by_default() {
    const TECHNICAL: [&str; 7] = ["mimeType", "fileSize", "width", "height", "colors", "domain", "iframeUrl"];
    for (fixture, want) in [("c05-media-objects", vec![("Image", "mimeType", 2), ("Image", "fileSize", 1), ("Image", "width", 1), ("Image", "height", 1), ("PDF", "mimeType", 1)]), ("c06-weblinks", vec![("Weblink", "domain", 1)])] {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        for p in files(&run.root).iter().filter(|p| p.ends_with(".md") && !p.starts_with('.') && **p != REPORT) {
            let keys = fm_keys(&some!(read_text(&run.root, p), p));
            for k in TECHNICAL {
                assert!(!keys.iter().any(|x| x == k), "{fixture}: {p} has no `{k}`");
            }
        }
        for (t, k, n) in want {
            assert!(run.plan.report.attributes.iter().any(|r| r.source_type == t && r.source_key == k && r.change == AttrChange::Dropped { values: n }), "{fixture}: {t}.{k} is in the report's Attributes section as dropped with {n} value(s): {:?}", run.plan.report.attributes);
        }
    }
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c06-weblinks"), r#"{"types":{"Weblink":{"attributes":{"domain":{"to":{"kind":"new","name":"domain","type":"text"}}}}}}"#), "import c06 keeping domain");
    assert_eq!(fm_get(&some!(written(&run, "Weblinks/Rust book.md"), "Rust book"), "domain").as_deref(), Some("example.com"), "with a mapping that keeps `domain` as text it is written");
}

#[test]
fn fr_imp_08_ac10_value_variants() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c21-value-variants"), "import c21");
    let priority = some!(attr(&run, "Task", "priority"), "Task.priority");
    assert_eq!(priority.merges, [ValueMerge { variants: strs(&["High", "HIgh"]), kept: "High".into(), applied: true }], "HIgh and High merge into High (a tie by count: the one matching an existing option of the Task type); nothing is proposed for Low");
    let prio = |f: &str, r: &Imported| written(r, &format!("Tasks/{f}.md")).and_then(|t| fm_get(&t, "priority"));
    assert_eq!([prio("Koupit lístky", &run), prio("Zavolat instalatéra", &run), prio("Napsat zprávu", &run)].map(|p| p.unwrap_or_default()), ["High", "High", "Low"], "written: High on both Tasks, Low unchanged");
    assert!(!run.plan.report.attributes.iter().any(|r| matches!(r.change, AttrChange::ValueNotInOptions { .. })), "no value outside the Task type's options");
    // With the merge switched off.
    let sb = sandbox();
    let off = ok!(import_with(&sb, &fixtures().join("c21-value-variants"), r#"{"types":{"Task":{"attributes":{"priority":{"merge":{"kind":"off"}}}}}}"#), "import c21 with the merge off");
    assert_eq!(prio("Zavolat instalatéra", &off).as_deref(), Some("HIgh"), "HIgh is written as its own value");
    assert!(off.plan.report.attributes.contains(&tegg_import::AttributeRow { source_type: "Task".into(), source_key: "priority".into(), change: AttrChange::ValueNotInOptions { value: "HIgh".into(), objects: 1 } }), "and listed as a value not in the Task type's options");
    assert_eq!(some!(attr(&off, "Task", "priority"), "Task.priority").merges.iter().map(|m| m.applied).collect::<Vec<_>>(), [false], "the proposal is still shown, not applied");
    assert!(off.plan.report.merged.is_empty(), "no Merged values row");
    // c21's `people` is rightly appended to the Task type (R148): task.yml gains exactly the planned attribute(s), appended,
    // and nothing else in it changes (the merge being off doesn't touch the priority options).
    let before = some!(read_text(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), "types/task.yml"), "the fixture's task.yml");
    let after = some!(read_text(&off.root, ".tegg/types/task.yml"), "the written task.yml");
    let planned: Vec<(String, String)> = off.plan.types.iter().filter(|t| t.source_type == "Task").flat_map(|t| t.attributes.iter()).filter(|a| a.action == AttrAction::New).map(|a| (a.key.clone().unwrap_or_default(), a.r#type.clone().unwrap_or_default())).collect();
    assert!(after.starts_with(&before), "task.yml keeps its bytes and only gains appended attributes:\n{after}");
    assert_eq!(type_attrs(&after), [type_attrs(&before), planned.clone()].concat(), "task.yml gains exactly the planned attribute(s): {planned:?}");
    // Values that differ by more than case or surrounding spaces are never merged by default.
    let sb = sandbox();
    let src = source(&sb, "c21-value-variants");
    edit(&src, "PKM/Tasks/Napsat zprávu.md", "priority: Low", "priority: ' High '");
    edit(&src, "PKM/Tasks/Koupit lístky.md", "priority: High", "priority: Hihg");
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import the changed c21");
    let merges = some!(attr(&run, "Task", "priority"), "Task.priority").merges.clone();
    assert_eq!(merges.len(), 1, "one merge: {merges:?}");
    assert_eq!(merges[0].variants.iter().cloned().collect::<BTreeSet<_>>(), set(&["HIgh", " High "]), "surrounding spaces and case merge; the typo `Hihg` doesn't");
    assert_eq!(prio("Koupit lístky", &run).as_deref(), Some("Hihg"), "the typo is written as it is");
}

#[test]
fn fr_imp_08_ac11_split_comma_lists() {
    let sb = sandbox();
    let json = r#"{"types":{"Task":{"attributes":{"people":{"to":{"kind":"new","name":"people","type":"relation"},"split":{"on":true,"to":"Person"}}}}}}"#;
    let src = source(&sb, "c21-value-variants");
    let run = ok!(import_with(&sb, &src, json), "import c21 with people split into links");
    let people = |f: &str, r: &Imported| written(r, &format!("Tasks/{f}.md")).and_then(|t| fm_get(&t, "people"));
    assert_eq!(people("Zavolat instalatéra", &run).as_deref(), Some(r#"["[[Jana]]", "[[Tomáš]]"]"#), "Zavolat instalatéra's people");
    assert_eq!(people("Koupit lístky", &run).as_deref(), Some(r#"["[[Jana]]"]"#), "Koupit lístky's people");
    assert_eq!(people("Napsat zprávu", &run), None, "null is omitted");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    for (name, to) in [("Jana", "People/Jana.md"), ("Tomáš", "People/Tomáš.md")] {
        assert_eq!(resolves(&core, "Tasks/Zavolat instalatéra.md", name).as_deref(), Some(to), "[[{name}]] resolves to the imported Person");
    }
    let task = some!(read_text(&run.root, ".tegg/types/task.yml"), "task.yml");
    assert_eq!(type_attrs(&task).last(), Some(&("people".to_string(), "relation".to_string())), "the Task type gains the relation attribute, appended");
    drop(core);
    // A name with no object of that type stays as plain text and is reported; a comma inside [[…]] doesn't split.
    let sb = sandbox();
    let src = source(&sb, "c21-value-variants");
    edit(&src, "PKM/Tasks/Koupit lístky.md", "people: Jana", "people: ' Jana ,Eva, [[Novák, Petr]]'");
    let run = ok!(import_with(&sb, &src, json), "import with an unmatched name");
    assert_eq!(people("Koupit lístky", &run).as_deref(), Some(r#"["[[Jana]]", Eva, "[[Novák, Petr]]"]"#), "items trimmed; Eva stays text; the comma inside [[…]] doesn't split");
    assert!(run.plan.report.attributes.contains(&tegg_import::AttributeRow { source_type: "Task".into(), source_key: "people".into(), change: AttrChange::SplitUnmatched { value: "Eva".into(), objects: 1 } }), "the unmatched name is reported");
    // No target type: a text list. Split off: unchanged.
    let sb = sandbox();
    let list = ok!(import_with(&sb, &fixtures().join("c16-comma-people"), r#"{"types":{"Project":{"attributes":{"people":{"split":{"on":true}}}}}}"#), "import c16, split with no target type");
    assert_eq!(fm_get(&some!(written(&list, "Projects/Launch.md"), "Launch"), "people").as_deref(), Some("[Jana, Tomáš, Eva]"), "a text list");
    let sb = sandbox();
    let off = ok!(import_with(&sb, &fixtures().join("c16-comma-people"), r#"{"types":{"Project":{"attributes":{"people":{"split":{"on":false}}}}}}"#), "import c16, split off");
    assert_eq!(fm_get(&some!(written(&off, "Projects/Launch.md"), "Launch"), "people").as_deref(), Some("Jana, Tomáš, Eva"), "the text unchanged");
}

#[test]
fn fr_imp_08_ac12_invalid_mapping_refused() {
    let entry = |t: &str, a: Option<&str>| MappingEntry { source_type: t.into(), attribute: a.map(str::to_string) };
    let new_attr = |name: &str| format!(r#"{{"to":{{"kind":"new","name":"{name}","type":"text"}}}}"#);
    let book = |attrs: &str| format!(r#"{{"types":{{"Book":{{"attributes":{{{attrs}}}}}}}}}"#);
    let cases: Vec<(String, MappingEntry, MappingReason, &str)> = vec![
        (book(&format!(r#""author":{},"medium":{}"#, new_attr("stejné"), new_attr("stejné"))), entry("Book", Some("medium")), MappingReason::DuplicateTarget, "two source attributes onto one target key"),
        (book(&format!(r#""author":{}"#, new_attr("source"))), entry("Book", Some("author")), MappingReason::ReservedKey, "a new attribute named with a reserved key"),
        (book(&format!(r#""author":{}"#, new_attr(""))), entry("Book", Some("author")), MappingReason::EmptyName, "an empty attribute name"),
        (book(&format!(r#""author":{}"#, new_attr("!!!"))), entry("Book", Some("author")), MappingReason::EmptyName, "an attribute name whose derived key is empty"),
        (book(&format!(r#""author":{}"#, new_attr("pages"))), entry("Book", Some("author")), MappingReason::KeyTaken, "a given name whose key is another attribute of the type"),
        (book(r#""author":{"to":{"kind":"existing","key":"neexistuje"}}"#), entry("Book", Some("author")), MappingReason::UnknownTargetAttribute, "an unknown target attribute"),
        (book(r#""neexistuje":{"to":{"kind":"drop"}}"#), entry("Book", Some("neexistuje")), MappingReason::UnknownSourceAttribute, "an unknown source attribute"),
        (book(r#""author":{"to":{"kind":"new","name":"autor","type":"barva"}}"#), entry("Book", Some("author")), MappingReason::KindMismatch, "a type that isn't an R10 key"),
        (r#"{"types":{"Book":{"to":{"kind":"new","name":"Page"}}}}"#.into(), entry("Book", None), MappingReason::NameTaken, "a new type named as an existing type"),
        (r#"{"types":{"Book":{"to":{"kind":"new","name":"pages"}}}}"#.into(), entry("Book", None), MappingReason::NameTaken, "…or as an existing type's plural, case-insensitively"),
        (r#"{"types":{"Book":{"to":{"kind":"new","name":"Nápad"}},"Idea":{"to":{"kind":"new","name":"nápad"}}}}"#.into(), entry("Idea", None), MappingReason::NameTaken, "two new types of the mapping with one name"),
        (r#"{"types":{"Book":{"to":{"kind":"new","name":"???"}}}}"#.into(), entry("Book", None), MappingReason::EmptyName, "a new type name that sanitizes to an empty folder name"),
        (r#"{"types":{"Book":{"to":{"kind":"existing","key":"kniha"}}}}"#.into(), entry("Book", None), MappingReason::UnknownTargetType, "an unknown target type (a new vault has only the seven system types)"),
        (r#"{"types":{"Book":{"to":{"kind":"existing","key":"task"}}}}"#.into(), entry("Book", None), MappingReason::TypeNotAllowed, "Task for a source type that doesn't default to it (D-1527 (6))"),
        (r#"{"types":{"Kniha":{"to":{"kind":"skip"}}}}"#.into(), entry("Kniha", None), MappingReason::UnknownSourceType, "a source type the space doesn't have"),
        (r#"{"version":2}"#.into(), entry("", None), MappingReason::UnknownVersion, "a version above 1"),
    ];
    let sb = sandbox();
    let before = snapshot(&sb.base);
    for (json, want_entry, want_reason, what) in cases {
        let e = ok!(plan_err(&sb, &fixtures().join("c02-typed-frontmatter"), &json), format!("{what}: plan"));
        match e {
            Some(ImportError::InvalidMapping { entry, reason }) => {
                // §4.2 lists two reasons that fit two new attributes with one name; either names the problem.
                let same = reason == want_reason || (want_reason == MappingReason::DuplicateTarget && reason == MappingReason::KeyTaken);
                assert!(same, "{what}: the reason is {want_reason:?}, got {reason:?}");
                if want_reason != MappingReason::UnknownVersion {
                    assert_eq!(entry.source_type, want_entry.source_type, "{what}: the error names the entry's type");
                    if want_reason != MappingReason::DuplicateTarget {
                        assert_eq!(entry.attribute, want_entry.attribute, "{what}: and its attribute");
                    } else {
                        assert!(matches!(entry.attribute.as_deref(), Some("author" | "medium")), "{what}: and one of the two attributes");
                    }
                }
            }
            other => assert!(false, "{what}: InvalidMapping {want_reason:?}, got {other:?}"),
        }
    }
    let sb5 = sandbox();
    let e = ok!(plan_err(&sb5, &fixtures().join("c05-media-objects"), r#"{"types":{"Image":{"to":{"kind":"existing","key":"page"}}}}"#), "plan");
    assert_eq!(e, Some(ImportError::InvalidMapping { entry: entry("Image", None), reason: MappingReason::TypeNotAllowed }), "Image can't be retargeted (D-1544)");
    assert_eq!(snapshot(&sb.base), before, "the target is untouched: nothing was created by any refused plan");
}

#[test]
fn fr_imp_08_ac17_a_daily_note_without_a_day_becomes_a_page() {
    let sb = sandbox();
    let src = source(&sb, "c13-daily-notes");
    // `date:` removed, title and file name `Poznámky bez data`; another imported note links to it.
    let text = read_text(&src, "PKM/DailyNotes/2026-02-03.md").expect("setup: fixture");
    std::fs::remove_file(src.join("PKM/DailyNotes/2026-02-03.md")).expect("setup: remove");
    write_raw(&src, "PKM/DailyNotes/Poznámky bez data.md", text.replace("title: '2026-02-03'\n", "title: Poznámky bez data\n").replace("date: '2026-02-03T00:00:00.000Z'\n", "").as_bytes());
    append(&src, "PKM/DailyNotes/2026-02-02.md", "\nViz [[Poznámky bez data]].\n");
    let mut env = ok!(env(&sb), "env");
    env.strings = key_strings();
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &env), "import the changed c13");
    let o = some!(object(&run.plan, "DailyNotes/Poznámky bez data.md"), "the Daily Note with no readable day is in the plan");
    assert_eq!((o.outcome.clone(), o.r#type.as_deref(), o.path.as_deref(), o.title.as_deref()), (ObjectOutcome::Imported, Some("page"), Some("Pages/Poznámky bez data.md"), Some("Poznámky bez data")), "planned as a Page in Pages/ (D-1561)");
    assert_eq!(o.import_id, "capacities:PKM/DailyNotes/Poznámky bez data.md", "with its import-id");
    assert!(!o.frontmatter.iter().any(|(k, _)| k == "date"), "no `date` key is planned");
    let written = some!(read_text(&run.root, "Pages/Poznámky bez data.md"), "Pages/Poznámky bez data.md");
    assert_eq!(kv(&written), pairs(&[("type", "page"), ("title", "Poznámky bez data"), ("review", "unreviewed"), ("tags", "[]")]), "written as a Page, without a `date` key");
    assert_eq!(fm_get(&written, "import-id").as_deref(), Some("capacities:PKM/DailyNotes/Poznámky bez data.md"), "its import-id");
    assert_eq!(body(&written), "\n7:05\n\nRun.\n", "its body, unchanged");
    assert!(!files(&run.root).iter().any(|p| p.starts_with("Daily/") && p.contains("Poznámky")), "nothing for it in Daily/");
    // The other day is still a Daily Note, and its link resolves to the Page.
    let day = some!(read_text(&run.root, "Daily/2026-02-02.md"), "Daily/2026-02-02.md");
    assert!(day.ends_with("\nViz [[Poznámky bez data]].\n"), "the link to it is written as a link to the Page");
    let l = some!(link(&run.plan, "DailyNotes/2026-02-02.md", "[[Poznámky bez data]]"), "the planned link");
    assert_eq!((l.outcome.clone(), l.to.as_deref()), (LinkOutcome::Resolved, Some("Pages/Poznámky bez data.md")), "resolved to the Page");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Daily/2026-02-02.md", "Poznámky bez data").as_deref(), Some("Pages/Poznámky bez data.md"), "and it resolves in Tegg's index");
    assert_eq!(core.object("Pages/Poznámky bez data.md").map(|o| o.r#type), Some("page".to_string()), "indexed as a Page");
    // The report lists it with its title and the reason (catalog key `import.report.type.noDay`; the text is not decided).
    let report = some!(read_text(&run.root, REPORT), "the report");
    let types = rows(&report, "⟦section.types⟧");
    let row = types.iter().find(|r| r.contains("⟦type.noDay⟧"));
    assert!(row.is_some_and(|r| r.contains("[[Poznámky bez data]]")), "a Types-section row with the reason key and a link to the object: {types:?}");
    // The accounting holds: nothing skipped.
    assert_eq!((run.plan.totals.objects.total, run.plan.totals.objects.imported, run.plan.totals.objects.reported), (2, 2, 0), "both notes are imported");
    assert!(run.plan.report.skipped.is_empty(), "nothing skipped");
    assert_eq!(tegg_import::accounting::check_vault(&run.scan.source, &run.plan, &run.root), Vec::new(), "the accounting holds on the written vault");
}

// ------------------------------------------------------------------------------------------------ FR-IMP-09

#[test]
fn fr_imp_09_ac1_utc_midnight_is_a_date_in_every_zone() {
    for zone in ZONES {
        let sb = sandbox();
        let run = ok!(import_new(&sb, &fixtures().join("c03-utc-midnight-dates"), SPACE, &Mapping::default(), &ok!(env_in(&sb, zone), "env")), format!("import c03 in {zone}"));
        assert_eq!(fm_get(&some!(written(&run, "Meetings/Weekly sync.md"), "Weekly sync"), "date").as_deref(), Some("2026-03-19"), "{zone}: '2026-03-19T00:00:00.000Z' → 2026-03-19, date-only");
        assert_eq!(fm_get(&some!(written(&run, "Meetings/Retro.md"), "Retro"), "date").as_deref(), Some("2026-04-02"), "{zone}: Retro's date");
    }
}

#[test]
fn fr_imp_09_ac2_other_date_times_get_the_local_offset() {
    for (zone, follow, created) in [(ZONES[0], "2026-04-07T21:46:20+02:00", "2026-04-07T21:46:20+02:00"), (ZONES[1], "2026-04-07T15:46:20-04:00", "2026-04-07T15:46:20-04:00"), (ZONES[2], "2026-04-08T09:46:20+14:00", "2026-04-08T09:46:20+14:00")] {
        let sb = sandbox();
        let c03 = ok!(import_new(&sb, &fixtures().join("c03-utc-midnight-dates"), SPACE, &Mapping::default(), &ok!(env_in(&sb, zone), "env")), format!("import c03 in {zone}"));
        assert_eq!(fm_get(&some!(written(&c03, "Meetings/Retro.md"), "Retro"), "followUp").as_deref(), Some(follow), "{zone}: '2026-04-07T19:46:20.601Z' with the zone's offset, seconds precision");
        let sb = sandbox();
        let c05 = ok!(import_new(&sb, &fixtures().join("c05-media-objects"), SPACE, &Mapping::default(), &ok!(env_in(&sb, zone), "env")), format!("import c05 in {zone}"));
        assert_eq!(fm_get(&some!(written(&c05, "Images/Mapa řeky.md"), "Mapa řeky"), "created").as_deref(), Some(created), "{zone}: createdAt → created, the same instant");
    }
}

#[test]
fn fr_imp_09_ac3_arrow_text_becomes_a_date_range() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c04-date-ranges"), "import c04");
    assert_eq!(kv(&some!(written(&run, "Trips/Lisbon.md"), "Lisbon")), pairs(&[("type", "trip"), ("title", "Lisbon"), ("dates-start", "2026-07-01"), ("dates-end", "2026-07-14"), ("tags", "[]")]), "`2026-07-01 -> 2026-07-14` → dates-start / dates-end");
    let trip = some!(read_text(&run.root, ".tegg/types/trip.yml"), "trip.yml");
    assert_eq!(type_attrs(&trip), pairs(&[("dates", "date-range")]), "the Trip type's attribute is a date range");
}

#[test]
fn fr_imp_09_ac4_null_is_omitted() {
    let sb = sandbox();
    let c03 = ok!(import_fixture(&sb, "c03-utc-midnight-dates"), "import c03");
    let weekly = some!(written(&c03, "Meetings/Weekly sync.md"), "Weekly sync");
    assert_eq!(kv(&weekly), pairs(&[("type", "meeting"), ("title", "Weekly sync"), ("date", "2026-03-19"), ("tags", "[]")]), "`followUp: null` is omitted, not written as null");
    assert!(!weekly.contains("null"), "no `null` anywhere");
    let sb = sandbox();
    let c12 = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    for p in files(&c12.root).iter().filter(|p| p.starts_with("Tasks/")) {
        let t = some!(read_text(&c12.root, p), p);
        assert!(!t.contains("null") && !fm_keys(&t).iter().any(|k| k == "priority"), "{p}: null values are omitted (no `priority`, no `null`)");
    }
    let exp = expected_dir("c12-task-dates");
    for p in ["Tasks/Call the plumber.md", "Tasks/Prepare budget review.md", "Tasks/Write report.md"] {
        assert_eq!(read_text(&c12.root, p), read_text(&exp, p), "{p} is byte-equal to the expected output");
    }
}

#[test]
fn fr_imp_09_ac5_unreadable_date_is_kept() {
    for as_date in [false, true] {
        let sb = sandbox();
        let json = if as_date { r#"{"types":{"Meeting":{"attributes":{"date":{"to":{"kind":"new","name":"date","type":"date"}}}}}}"# } else { "{}" };
        let run = ok!(import_with(&sb, &fixtures().join("c21-value-variants"), json), format!("import c21 (date attribute: {as_date})"));
        let kind = if as_date { "date" } else { "text" };
        assert_eq!(type_attrs(&some!(read_text(&run.root, ".tegg/types/meeting.yml"), "meeting.yml")), pairs(&[("date", kind)]), "meeting.yml: `date` is {kind} (a mixed attribute is text, D-1526)");
        assert_eq!(fm_get(&some!(written(&run, "Meetings/Retro.md"), "Retro"), "date").as_deref(), Some("2026-06-12"), "Retro's UTC-midnight date-time is converted, whatever the attribute's kind (D-1545 (3))");
        assert_eq!(fm_get(&some!(written(&run, "Meetings/Porada.md"), "Porada"), "date").as_deref(), Some("Jun 26"), "Porada's `Jun 26` is written unchanged, no year added");
        assert_eq!(run.plan.report.dates.iter().filter(|r| matches!(r, DateRow::Unreadable { .. })).collect::<Vec<_>>(), [&DateRow::Unreadable { note: "Meetings/Porada.md".into(), key: "date".into(), value: "Jun 26".into() }], "the report's Dates section lists the object, the key and the value");
    }
}

#[test]
fn fr_imp_09_ac6_midnight_ranges() {
    for zone in ZONES {
        let sb = sandbox();
        let run = ok!(import_new(&sb, &fixtures().join("c04-date-ranges"), SPACE, &Mapping::default(), &ok!(env_in(&sb, zone), "env")), format!("import c04 in {zone}"));
        assert_eq!(kv(&some!(written(&run, "Projects/Garden.md"), "Garden")), pairs(&[("type", "project"), ("title", "Garden"), ("timeFrame-start", "2026-03-01"), ("timeFrame-end", "2026-05-31"), ("tags", "[]")]), "{zone}: a range of two UTC-midnight date-times is two date-only values");
    }
}

// ------------------------------------------------------------------------------------------------ FR-IMP-21

#[test]
fn fr_imp_21_ac1_tags_are_virtual() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c08-tag-collections"), "import c08");
    assert_eq!(fm_get(&some!(written(&run, "Pages/Tagged.md"), "Tagged"), "tags").as_deref(), Some("[Learning, Archive]"), "the tags are written on the object");
    assert!(!files(&run.root).iter().any(|p| p.starts_with("Tags/")), "Tags/ holds no file after the import (FR-TAG-03)");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    // The index stores tag names in lower case: compare case-insensitively (the file keeps `[Learning, Archive]`, above).
    let tags: BTreeSet<String> = core.object("Pages/Tagged.md").map(|o| o.tags.into_iter().map(|t| t.to_lowercase()).collect()).unwrap_or_default();
    assert_eq!(tags, set(&["learning", "archive"]), "Tegg's index has both tags");
}

#[test]
fn fr_imp_21_ac2_tag_collections_are_reported_not_imported() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c08-tag-collections"), "import c08");
    assert_eq!(run.plan.other_files.iter().map(|f| (f.source.as_str(), &f.kind)).collect::<Vec<_>>(), [("Tags/Areas.csv", &OtherKind::TagCollection), ("Tags/Topics.csv", &OtherKind::TagCollection)], "the two header-only CSVs are tag collections");
    assert!(run.plan.report.not_exported.contains(&NotExported::TagColoursAndCollections), "reported as `Tag colours and collections` not in the export");
    assert_eq!(run.plan.report.skipped.iter().filter(|r| matches!(r, SkippedRow::Ignored { kind: OtherKind::TagCollection, .. })).count(), 2, "each with its Skipped row");
    assert_eq!(run.plan.types.iter().map(|t| t.source_type.as_str()).collect::<Vec<_>>(), ["Page"], "no type and no object comes from a collection");
    assert!(!files(&run.root).iter().any(|p| p.ends_with(".csv")), "no CSV is copied into the vault");
}

#[test]
fn fr_imp_21_ac3_link_values_to_tag_like_objects_are_a_candidate() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c09-unresolved-links"), "import c09");
    let t = &run.plan.decisions.tag_like;
    assert_eq!(t.len(), 1, "one candidate attribute: {t:?}");
    assert_eq!((t[0].source_type.as_str(), t[0].source_key.as_str(), t[0].objects, t[0].values.clone(), t[0].example.as_str(), t[0].selected), ("Trip", "status", 2, strs(&["in progress", "planned"]), "[[in progress]]", false), "Trip.status: every value is a link with no matching object");
}

#[test]
fn fr_imp_21_ac4_link_values_become_select_values() {
    let sb = sandbox();
    let run = ok!(import_with(&sb, &fixtures().join("c09-unresolved-links"), r#"{"types":{"Trip":{"attributes":{"status":{"to":{"kind":"new","name":"status","type":"select"}}}}}}"#), "import c09 with Trip.status as a select");
    assert_eq!(fm_get(&some!(written(&run, "Trips/Lisbon.md"), "Lisbon"), "status").as_deref(), Some("in progress"), "Lisbon gets `status: in progress`");
    assert_eq!(fm_get(&some!(written(&run, "Trips/Oslo.md"), "Oslo"), "status").as_deref(), Some("planned"), "Oslo gets `status: planned`");
    let trip = some!(read_text(&run.root, ".tegg/types/trip.yml"), "trip.yml");
    assert_eq!((type_attrs(&trip), type_options(&trip, "status")), (pairs(&[("status", "select")]), strs(&["in progress", "planned"])), "the new type's status is a select with the options");
    let l = some!(link(&run.plan, "Trips/Lisbon.md", "[[in progress]]"), "the link value");
    assert_eq!(l.outcome, LinkOutcome::SelectValue, "its outcome is `select value`");
    assert!(!run.plan.report.unresolved.iter().any(|r| r.written == "[[in progress]]" || r.written == "[[planned]]"), "not in the report's Unresolved links");
    assert!(run.plan.report.attributes.contains(&tegg_import::AttributeRow { source_type: "Trip".into(), source_key: "status".into(), change: AttrChange::SelectValues { values: 2 } }), "in its Attributes section");
    assert!(run.plan.decisions.tag_like.iter().all(|t| t.selected), "the candidate is marked selected");
    assert_eq!(tegg_import::accounting::check_plan(&run.scan.source, &run.plan), Vec::new(), "the accounting holds");
    // Default mapping: a candidate, written as the link it was, reported as unresolved.
    let sb = sandbox();
    let def = ok!(import_fixture(&sb, "c09-unresolved-links"), "import c09 with the default mapping");
    assert_eq!(fm_get(&some!(written(&def, "Trips/Lisbon.md"), "Lisbon"), "status").as_deref(), Some("\"[[in progress]]\""), "the value is written as the link it was");
    assert_eq!(some!(link(&def.plan, "Trips/Lisbon.md", "[[in progress]]"), "the link value").outcome, LinkOutcome::Unresolved, "and reported as unresolved");
    for p in ["Daily/2026-02-01.md", "Trips/Lisbon.md", "Trips/Oslo.md"] {
        assert_eq!(read_text(&def.root, p), read_text(&expected_dir("c09-unresolved-links"), p), "{p} is byte-equal to the expected output");
    }
}

// ------------------------------------------------------------------------------------------------ FR-IMP-24

#[test]
fn fr_imp_24_ac1_weblink_becomes_a_page_with_url_and_description() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c06-weblinks"), "import c06");
    let text = some!(written(&run, "Weblinks/Rust book.md"), "Rust book");
    assert_eq!(path_of(&run.plan, "Weblinks/Rust book.md").as_deref(), Some("Pages/Rust book.md"), "written in Pages/");
    assert_eq!(kv(&text), pairs(&[("type", "page"), ("title", "Rust book"), ("description", "The book"), ("url", "https://example.com/a-very-long-article-url-that-capacities-folds-into-multiple-lines-of-yaml"), ("topic", "Programming"), ("tags", "[]")]), "url and description kept; domain and iframeUrl dropped; category null omitted; topic a text attribute");
    assert_eq!(fm_get(&text, "created").as_deref(), Some("2026-04-20T12:35:19+02:00"), "createdAt → created");
    let page = some!(read_text(&run.root, ".tegg/types/page.yml"), "page.yml");
    let attrs = type_attrs(&page);
    assert!(attrs.contains(&("url".to_string(), "url".to_string())) || attrs.contains(&("url".to_string(), "text".to_string())), "the Page type gains `url`: {attrs:?}");
    assert!(attrs.contains(&("topic".to_string(), "text".to_string())), "and `topic` as text: {attrs:?}");
}

#[test]
fn fr_imp_24_ac2_a_missing_preview_image_is_not_a_reference() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c06-weblinks"), "import c06");
    assert!(run.plan.report.files.is_empty() && run.plan.report.unresolved.is_empty(), "`previewImage: null` reports nothing");
    let text = some!(written(&run, "Weblinks/Rust book.md"), "Rust book");
    assert!(!fm_keys(&text).iter().any(|k| k == "cover" || k == "previewImage"), "no cover and no previewImage key");
    assert_eq!(run.plan.attachments, Vec::new(), "no attachment");
}

#[test]
fn fr_imp_24_ac3_weblink_url() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c06-weblinks"), "import c06");
    let text = some!(written(&run, "Weblinks/Rust book.md"), "Rust book");
    assert!(text.contains("\nurl: https://example.com/a-very-long-article-url-that-capacities-folds-into-multiple-lines-of-yaml\n"), "the folded `>-` URL is written as one line");
    assert!(!text.contains(">-") && !text.contains("category"), "no block scalar, and `category: null` is omitted");
    assert_eq!(attr(&run, "Weblink", "category").map(|a| a.action.clone()), Some(AttrAction::NotCreated), "`category` has only null values: not created");
    assert!(links_of(&run.plan, "Weblinks/Rust book.md").iter().all(|l| l.written == "[[Reading list]]"), "the URL value is not a link of the plan (a bare URL in frontmatter isn't one)");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-15

#[test]
fn fr_typ_15_ac1_source_becomes_source_text() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c14-reserved-keys"), "import c14");
    let p = "Ideas/Feedback loops.md";
    assert_eq!(read_text(&run.root, p), read_text(&expected_dir("c14-reserved-keys"), p), "{p} is byte-equal to the expected output: source-text: kniha, file-text: notes.txt");
    assert!(run.plan.report.attributes.contains(&tegg_import::AttributeRow { source_type: "Idea".into(), source_key: "source".into(), change: AttrChange::Renamed { key: "source-text".into(), reason: KeyReason::Reserved } }), "listed in the report");
    let idea = some!(read_text(&run.root, ".tegg/types/idea.yml"), "idea.yml");
    assert_eq!(type_attrs(&idea), pairs(&[("source-text", "text"), ("file-text", "text")]), "the new type has the renamed attributes");
}

#[test]
fn fr_typ_15_ac3_every_reserved_key_is_renamed() {
    // The key list comes from the schema's reserved-key list, so a key reserved later is covered.
    const ON_PURPOSE: [&str; 6] = ["title", "description", "aliases", "tags", "icon", "type"];
    let extra: Vec<&str> = tegg_format::RESERVED_KEYS.iter().copied().filter(|k| !ON_PURPOSE.contains(k) && *k != "source" && *k != "file").collect();
    for k in ["id", "created", "modified", "review", "cover", "previous", "captured", "import-id"] {
        assert!(extra.contains(&k), "setup: `{k}` is a reserved key of FR-TYP-15");
    }
    let sb = sandbox();
    let src = source(&sb, "c14-reserved-keys");
    let lines: String = extra.iter().map(|k| format!("{k}: hodnota {k}\n")).collect();
    edit(&src, "PKM/Ideas/Feedback loops.md", "file: notes.txt\n", &format!("file: notes.txt\n{lines}"));
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import the changed c14");
    let text = some!(written(&run, "Ideas/Feedback loops.md"), "Feedback loops");
    let mut want = vec![("type", "idea".to_string()), ("title", "Feedback loops".to_string()), ("source-text", "kniha".to_string()), ("file-text", "notes.txt".to_string())];
    let renamed: Vec<String> = extra.iter().map(|k| format!("{k}-text")).collect();
    for (k, r) in extra.iter().zip(&renamed) {
        want.push((r.as_str(), format!("hodnota {k}")));
    }
    want.push(("tags", "[]".to_string()));
    assert_eq!(kv(&text), want.iter().map(|(k, v)| (k.to_string(), v.clone())).collect::<Vec<_>>(), "each reserved key is written as <key>-text with its value, at its source place");
    assert_eq!((fm_get(&text, "id"), fm_get(&text, "import-id"), fm_get(&text, "created"), fm_get(&text, "modified")), (Some(id(1)), Some("capacities:PKM/Ideas/Feedback loops.md".into()), Some("2026-05-01T13:28:04+02:00".into()), Some(NOW.into())), "the object's own id, import-id, created and modified are the ones the import sets");
    for k in extra.iter().chain(["source", "file"].iter()) {
        assert!(run.plan.report.attributes.contains(&tegg_import::AttributeRow { source_type: "Idea".into(), source_key: k.to_string(), change: AttrChange::Renamed { key: format!("{k}-text"), reason: KeyReason::Reserved } }), "`{k}` is listed in the report's Attributes section as renamed");
    }
    for k in ON_PURPOSE {
        assert!(!fm_keys(&text).iter().any(|x| *x == format!("{k}-text")), "`{k}` keeps its R148 meaning and gets no -text");
    }
}
