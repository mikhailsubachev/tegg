//! Slice I1, L4: media, metadata and clean-up (docs/acceptance/import-capacities.md FR-IMP-14 AC-1…AC-4, AC-6…AC-8;
//! FR-IMP-15 AC-1…AC-8; FR-IMP-17 AC-1…AC-4; R149; docs/contracts/v1-import.md §5.2, §7.1, §7.3, §8 (4)). Written
//! from the criteria, the contract and the fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::path::Path;

use common::*;
use tegg_format::nfc;
use tegg_import::{AttachmentOutcome, Cleanup, DateRow, FileChange, LinkOutcome, Mapping, ObjectKind, ObjectOutcome, UnresolvedReason};

fn import_src(sb: &Sandbox, src: &Path) -> Result<Imported, String> {
    import_new(sb, src, SPACE, &Mapping::default(), &env(sb)?)
}
fn attachment<'a>(run: &'a Imported, source: &str) -> Option<&'a tegg_import::PlannedAttachment> {
    run.plan.attachments.iter().find(|a| a.source == source)
}
fn media_bytes(rel: &str) -> Vec<u8> {
    std::fs::read(fixtures().join("c05-media-objects/PKM").join(rel)).expect("setup: media file")
}

// ------------------------------------------------------------------------------------------------ FR-IMP-14

#[test]
fn fr_imp_14_ac1_image_object_with_its_file() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let o = some!(object(&run.plan, "Images/Mapa řeky.md"), "the Image note");
    assert_eq!((o.kind.clone(), o.r#type.as_deref(), o.path.as_deref(), o.title.as_deref()), (ObjectKind::Media, Some("image"), Some("Images/Mapa řeky.md"), Some("Mapa řeky")), "an Image object in Images/");
    let text = some!(read_text(&run.root, "Images/Mapa řeky.md"), "Images/Mapa řeky.md");
    for (k, v) in [("type", "image"), ("title", "Mapa řeky"), ("description", "Map of the river"), ("tags", "[travel]"), ("source-text", "upload"), ("file", "\"[[Mapa řeky.jpeg]]\""), ("import-id", "capacities:PKM/Images/Mapa řeky.md")] {
        assert_eq!(fm_get(&text, k).as_deref(), Some(v), "Images/Mapa řeky.md has `{k}: {v}`");
    }
    assert!(!fm_keys(&text).iter().any(|k| k == "source" || k == "url"), "no `source` key (D-75) and `url: null` omitted");
    assert_eq!(read_bytes(&run.root, "_attachments/Mapa řeky.jpeg"), Some(media_bytes("Images/Media/Mapa řeky.jpeg")), "the file is in _attachments/, byte for byte");
    let a = some!(attachment(&run, "Images/Media/Mapa řeky.jpeg"), "the planned attachment");
    assert_eq!((a.outcome.clone(), a.path.as_deref(), a.object.as_deref(), a.bytes, a.referenced, a.renamed_from_generic), (AttachmentOutcome::Imported, Some("_attachments/Mapa řeky.jpeg"), Some("Images/Mapa řeky.md"), 22, true, false), "planned with its object, size and name");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(core.object("Images/Mapa řeky.md").map(|o| o.r#type), Some("image".to_string()), "Tegg reads it as an Image");
}

#[test]
fn fr_imp_14_ac2_media_line_becomes_an_embed() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    assert_eq!(body(&some!(read_text(&run.root, "Images/Mapa řeky.md"), "the Image object")), "\n\nMedia: ![[Mapa řeky.jpeg]]\n", "`Media: ![Image](./Media/Mapa%20%C5%99eky.jpeg)` → `![[Mapa řeky.jpeg]]`; the rest of the line stays");
    let l = some!(link(&run.plan, "Images/Mapa řeky.md", "![Image](./Media/Mapa%20%C5%99eky.jpeg)"), "the planned link");
    assert_eq!((l.outcome.clone(), l.to.as_deref(), l.target.as_str()), (LinkOutcome::Attachment, Some("_attachments/Mapa řeky.jpeg"), "./Media/Mapa řeky.jpeg"), "outcome attachment, bound to the copied file; the destination is decoded");
}

#[test]
fn fr_imp_14_ac3_generic_names_are_renamed_after_the_owning_note() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let a = some!(attachment(&run, "Images/Media/image (3).png"), "the generic file");
    assert_eq!((a.path.as_deref(), a.renamed_from_generic, a.object.as_deref()), (Some("_attachments/Whiteboard sketch 1.png"), true, Some("Images/image (3).md")), "`image (3).png` → `<owning note title> <n>.png`");
    assert_eq!(read_bytes(&run.root, "_attachments/Whiteboard sketch 1.png"), Some(media_bytes("Images/Media/image (3).png")), "the renamed file holds the source bytes");
    assert!(!files(&run.root).contains("_attachments/image (3).png"), "no file under the generic name");
    let obj = some!(read_text(&run.root, "Images/Whiteboard sketch.md"), "the Image object, named after its title");
    assert_eq!((fm_get(&obj, "file").as_deref(), body(&obj).as_str()), (Some("\"[[Whiteboard sketch 1.png]]\""), "\n\nMedia: ![[Whiteboard sketch 1.png]]\n"), "its `file` and its embed follow the new name");
    assert!(run.plan.report.files.iter().any(|r| r.source == "Images/Media/image (3).png" && r.change == FileChange::GenericName { name: "Whiteboard sketch 1.png".into() }), "the report's Files section lists the renamed generic name");
    // An unreferenced file keeps its name, generic or not (D-77).
    assert_eq!(some!(attachment(&run, "Images/Media/Untitled (44).png"), "the unreferenced file").path.as_deref(), Some("_attachments/Untitled (44).png"), "`Untitled (44).png` has no owning note: it keeps its name");
}

#[test]
fn fr_imp_14_ac4_missing_file_reference_is_dropped_and_reported() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let w = "![Preview](./Media/Manual%20preview.png)";
    let l = some!(link(&run.plan, "PDFs/Manual.md", w), "the reference to the missing preview image");
    assert_eq!((l.outcome.clone(), l.to.clone()), (LinkOutcome::MissingFile, None), "outcome `missing file`");
    let text = some!(read_text(&run.root, "PDFs/Manual.md"), "PDFs/Manual.md");
    assert!(!text.contains("Preview") && !text.contains("preview.png"), "the reference is dropped from the body");
    assert!(body(&text).starts_with("\n\nMedia: ![[Manual.pdf]]\n"), "the rest of the body stays");
    assert!(run.plan.report.files.iter().any(|r| r.source == "PDFs/Manual.md" && matches!(&r.change, FileChange::DroppedReference { written, .. } if written == w)), "listed in the report's Files section");
    assert!(run.plan.report.unresolved.iter().any(|r| r.note == "PDFs/Manual.md" && r.written == w && r.reason == UnresolvedReason::MissingFile), "and as an unresolved link, reason `missing file`");
    assert!(!files(&run.root).iter().any(|p| p.contains("preview")), "no file is invented for it");
    // `previewImage: null` is not a reference (c06).
    let sb = sandbox();
    let c06 = ok!(import_fixture(&sb, "c06-weblinks"), "import c06");
    assert!(c06.plan.report.files.is_empty() && !c06.plan.links.iter().any(|l| l.outcome == LinkOutcome::MissingFile), "`previewImage: null` reports nothing");
}

#[test]
fn fr_imp_14_ac6_unreferenced_media_is_imported_with_an_object() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let a = some!(attachment(&run, "Images/Media/Untitled (44).png"), "the media file no note references");
    assert_eq!((a.outcome.clone(), a.path.as_deref(), a.referenced, a.object.as_deref()), (AttachmentOutcome::Imported, Some("_attachments/Untitled (44).png"), false, Some("Images/Media/Untitled (44).png")), "imported into _attachments/, with an object of its own");
    let o = some!(object(&run.plan, "Images/Media/Untitled (44).png"), "its Image object (source: the media file's path)");
    assert_eq!((o.kind.clone(), o.outcome.clone(), o.r#type.as_deref(), o.title.as_deref(), o.path.as_deref(), o.import_id.as_str()), (ObjectKind::OrphanMedia, ObjectOutcome::Imported, Some("image"), Some("Untitled (44)"), Some("Images/Untitled (44).md"), "capacities:PKM/Images/Media/Untitled (44).png"), "titled after the file");
    let text = some!(read_text(&run.root, "Images/Untitled (44).md"), "Images/Untitled (44).md");
    assert_eq!((fm_get(&text, "type").as_deref(), fm_get(&text, "title").as_deref(), fm_get(&text, "file").as_deref(), body(&text).as_str()), (Some("image"), Some("Untitled (44)"), Some("\"[[Untitled (44).png]]\""), "![[Untitled (44).png]]\n"), "an Image object with `file` and the embed as its body");
    assert_eq!(read_bytes(&run.root, "_attachments/Untitled (44).png"), Some(media_bytes("Images/Media/Untitled (44).png")), "the file, byte for byte");
    assert!(run.plan.report.files.iter().any(|r| r.source == "Images/Media/Untitled (44).png" && r.change == FileChange::Unreferenced), "listed in the report (D-77)");
    assert_eq!((run.plan.totals.attachments.total, run.plan.totals.attachments.imported, run.plan.totals.objects.total), (4, 4, 4), "it is an attachment, not one of R147's objects (every .md of the space)");
    assert_eq!(run.plan.objects.len(), 5, "the plan lists it with the four notes");
}

#[test]
fn fr_imp_14_ac7_attachments_copied_whole() {
    let sb = sandbox();
    let src = source(&sb, "c05-media-objects");
    // Two attachments that would get the same name (compared case-insensitively, NFC).
    let second = "druhý obrázek, jiné bajty".as_bytes();
    write_raw(&src, "PKM/Pages/Media/MAPA ŘEKY.jpeg", second);
    append(&src, "PKM/Pages/Trip notes.md", "\n![Druhá](./Media/MAPA%20%C5%98EKY.jpeg)\n");
    let before = snapshot(&src);
    let run = ok!(import_src(&sb, &src), "import c05 with a second map");
    assert_eq!(snapshot(&src), before, "the source, its Media/ folders included, is untouched (copied, never moved)");
    let got: BTreeSet<String> = files(&run.root).into_iter().filter(|p| p.starts_with("_attachments/")).collect();
    assert_eq!(got, set(&["_attachments/Mapa řeky.jpeg", "_attachments/MAPA ŘEKY (2).jpeg", "_attachments/Untitled (44).png", "_attachments/Whiteboard sketch 1.png", "_attachments/Manual.pdf"]), "the five attachments; the name taken case-insensitively gets ` (2)`");
    for a in &run.plan.attachments {
        let to = some!(a.path.clone(), format!("{} has a planned path", a.source));
        assert_eq!(read_bytes(&run.root, &to), read_bytes(&src, &format!("PKM/{}", a.source)), "{to} holds exactly the bytes of {} (same SHA-256)", a.source);
        assert_eq!(a.bytes as usize, read_bytes(&src, &format!("PKM/{}", a.source)).map(|b| b.len()).unwrap_or(0), "{}: the planned size", a.source);
    }
    let trip = some!(read_text(&run.root, "Pages/Trip notes.md"), "Trip notes");
    assert_eq!(body(&trip), "\n![[Mapa řeky.jpeg]]\n\n[[Mapa řeky]]\n\n![[MAPA ŘEKY (2).jpeg]]\n", "each embed points at its own file");
    assert_eq!(read_bytes(&run.root, "_attachments/MAPA ŘEKY (2).jpeg").as_deref(), Some(second), "the second file has its own bytes");
    assert!(run.plan.report.files.iter().any(|r| r.source == "Pages/Media/MAPA ŘEKY.jpeg" && matches!(&r.change, FileChange::NameChanged { name, reasons } if name == "MAPA ŘEKY (2).jpeg" && reasons == &[tegg_import::NameChange::Suffix])), "the changed name is a Files row");
    assert_eq!(temp_files(&run.root), Vec::<String>::new(), "no partly copied file is left");
}

#[test]
fn fr_imp_14_ac8_pdf_objects_and_embeds() {
    let sb = sandbox();
    let src = source(&sb, "c05-media-objects");
    append(&src, "PKM/Pages/Trip notes.md", "\nNávod: [Manual](../PDFs/Media/Manual.pdf)\n");
    let run = ok!(import_src(&sb, &src), "import c05 with a plain link to a media file");
    let pdf = some!(read_text(&run.root, "PDFs/Manual.md"), "PDFs/Manual.md");
    assert_eq!((fm_get(&pdf, "type").as_deref(), fm_get(&pdf, "title").as_deref(), fm_get(&pdf, "file").as_deref(), fm_get(&pdf, "source-text").as_deref()), (Some("pdf"), Some("Manual"), Some("\"[[Manual.pdf]]\""), Some("upload")), "a PDF object in PDFs/ with `file: \"[[Manual.pdf]]\"`");
    assert_eq!(read_bytes(&run.root, "_attachments/Manual.pdf"), Some(media_bytes("PDFs/Media/Manual.pdf")), "the PDF file is in _attachments/");
    let trip = some!(read_text(&run.root, "Pages/Trip notes.md"), "Trip notes");
    assert_eq!(body(&trip), "\n![[Mapa řeky.jpeg]]\n\n[[Mapa řeky]]\n\nNávod: [[Manual.pdf|Manual]]\n", "image syntax → an embed of the file; the wikilink → the Image object; a plain link to a media file stays a link (D-1560)");
    let l = some!(link(&run.plan, "Pages/Trip notes.md", "[Manual](../PDFs/Media/Manual.pdf)"), "the plain link");
    assert_eq!((l.outcome.clone(), l.to.as_deref()), (LinkOutcome::Attachment, Some("_attachments/Manual.pdf")), "outcome attachment");
    let w = some!(link(&run.plan, "Pages/Trip notes.md", "[[Mapa řeky]]"), "the wikilink");
    assert_eq!((w.outcome.clone(), w.to.as_deref()), (LinkOutcome::Resolved, Some("Images/Mapa řeky.md")), "an ordinary link to the Image object");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Pages/Trip notes.md", "Mapa řeky").as_deref(), Some("Images/Mapa řeky.md"), "[[Mapa řeky]] resolves to the Image object");
    assert_eq!(core.object("PDFs/Manual.md").map(|o| o.r#type), Some("pdf".to_string()), "Tegg reads the PDF object");
    let back: Vec<String> = core.backlinks("PDFs/Manual.md").iter().map(|p| nfc(p)).collect();
    assert!(back.contains(&"Pages/Trip notes.md".to_string()), "the link to the file counts as a link to its PDF object (FR-ATT-07): {back:?}");
}

// ------------------------------------------------------------------------------------------------ FR-IMP-15

#[test]
fn fr_imp_15_ac1_created_and_modified_are_the_original_values() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c15-common-attributes"), "import c15");
    let text = some!(read_text(&run.root, "Pages/Garden plan.md"), "Garden plan");
    assert_eq!((fm_get(&text, "created").as_deref(), fm_get(&text, "modified").as_deref()), (Some("2026-01-05T09:00:00+01:00"), Some("2026-03-05T18:30:00+01:00")), "createdAt → created, lastUpdated → modified: the original instants, not the import time");
    assert!(!fm_keys(&text).iter().any(|k| k == "createdAt" || k == "lastUpdated"), "the source keys are not written");
    assert!(!run.plan.report.dates.iter().any(|r| matches!(r, DateRow::ImportTime { .. })), "no import-time row");
    // Objects without them get the import time, counted in the report (D-1538 (4)).
    let sb = sandbox();
    let c12 = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    for p in files(&c12.root).iter().filter(|p| p.starts_with("Tasks/")) {
        let t = some!(read_text(&c12.root, p), p);
        assert_eq!((fm_get(&t, "created").as_deref(), fm_get(&t, "modified").as_deref()), (Some(NOW), Some(NOW)), "{p}: the import time, with the zone's offset");
    }
    assert_eq!(c12.plan.report.dates.last(), Some(&DateRow::ImportTime { objects: 4 }), "counted in the report: the last Dates row");
    assert!(c12.plan.objects.iter().all(|o| !o.frontmatter.iter().any(|(k, _)| k == "created" || k == "modified")), "the plan leaves created / modified out when the import time is used");
}

#[test]
fn fr_imp_15_ac2_reviewed_becomes_review() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c13-daily-notes"), "import c13");
    let review = |p: &str| read_text(&run.root, p).and_then(|t| fm_get(&t, "review"));
    assert_eq!((review("Daily/2026-02-02.md").as_deref(), review("Daily/2026-02-03.md").as_deref()), (Some("reviewed"), Some("unreviewed")), "reviewed: true → review: reviewed; false → unreviewed");
    for p in ["Daily/2026-02-02.md", "Daily/2026-02-03.md"] {
        assert!(!fm_keys(&some!(read_text(&run.root, p), p)).iter().any(|k| k == "reviewed"), "{p}: no `reviewed` key");
    }
}

#[test]
fn fr_imp_15_ac3_task_dates() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    let get = |f: &str, k: &str| read_text(&run.root, &format!("Tasks/{f}.md")).and_then(|t| fm_get(&t, k));
    assert_eq!(get("Plan the release", "due").as_deref(), Some("2026-02-20"), "`deadline` → `due`");
    assert_eq!(get("Prepare budget review", "due").as_deref(), Some("2026-02-09"), "falling back to `date` when `deadline` is empty (FR-TSK-13)");
    assert_eq!(get("Write report", "due").as_deref(), Some("2026-03-01"), "the same fallback");
    assert_eq!(get("Call the plumber", "due"), None, "no date at all: no `due`");
    assert_eq!(get("Prepare budget review", "completed").as_deref(), Some("2026-04-23T17:11:34+02:00"), "`completed` → the completed date-time, in the zone's offset");
    assert_eq!(get("Plan the release", "completed"), None, "null is omitted");
    for f in ["Plan the release", "Prepare budget review", "Write report", "Call the plumber"] {
        assert_eq!(get(f, "deadline"), None, "{f}: no `deadline` key is written");
    }
}

#[test]
fn fr_imp_15_ac4_icon_aliases_and_description_are_kept() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c15-common-attributes"), "import c15");
    let text = some!(read_text(&run.root, "Pages/Garden plan.md"), "Garden plan");
    assert_eq!((fm_get(&text, "icon").as_deref(), fm_get(&text, "aliases").as_deref(), fm_get(&text, "description").as_deref()), (Some("🌱"), Some("[Garden]"), Some("Beds and paths")), "icon → icon, aliases and description kept");
    assert!(!fm_keys(&text).iter().any(|k| k == "cover" || k == "coverImage"), "`coverImage: null` writes no cover");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    // Tegg resolves links by name, not by alias: the alias is written and indexed only.
    assert_eq!(core.object("Pages/Garden plan.md").map(|o| o.aliases), Some(strs(&["Garden"])), "Tegg reads the alias");
}

#[test]
fn fr_imp_15_ac5_every_object_gets_an_id_and_an_import_id() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c01-spaces"), "import c01");
    let want = [("Pages/Links across spaces.md", 1), ("Pages/PKM home.md", 2), ("Tasks/PKM task.md", 3)];
    for (p, n) in want {
        let t = some!(read_text(&run.root, p), p);
        assert_eq!((fm_get(&t, "id"), fm_get(&t, "import-id")), (Some(id(n)), Some(format!("capacities:PKM/{p}"))), "{p}: a new id (in write order) and import-id: capacities:<space>/<source path>");
    }
    assert_eq!(fm_get(&some!(read_text(&run.root, REPORT), "the report"), "id"), Some(id(4)), "the report takes the last id");
}

#[test]
fn fr_imp_15_ac6_frontmatter_shape() {
    let sb = sandbox();
    let c15 = ok!(import_fixture(&sb, "c15-common-attributes"), "import c15");
    assert_eq!(read_text(&c15.root, "Pages/Garden plan.md"), read_text(&expected_dir("c15-common-attributes"), "Pages/Garden plan.md"), "c15: byte-equal to the expected output");
    let sb = sandbox();
    let c12 = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    for p in ["Tasks/Call the plumber.md", "Tasks/Prepare budget review.md", "Tasks/Write report.md"] {
        assert_eq!(read_text(&c12.root, p), read_text(&expected_dir("c12-task-dates"), p), "c12: {p} is byte-equal to the expected output");
    }
    let plan = some!(read_text(&c12.root, "Tasks/Plan the release.md"), "Plan the release");
    let keys = fm_keys(&plan);
    assert_eq!((&keys[..4], &keys[keys.len() - 4..]), (&strs(&["id", "type", "title", "status"])[..], &strs(&["tags", "import-id", "created", "modified"])[..]), "R149's order around the attributes");
    assert_eq!((fm_get(&plan, "type").as_deref(), fm_get(&plan, "status").as_deref(), fm_get(&plan, "due").as_deref(), fm_get(&plan, "tags").as_deref()), (Some("task"), Some("In progress"), Some("2026-02-20"), Some("[]")), "`type` is the type key; `tags: []` in the source is written as `tags: []`");
    assert_eq!(keys.iter().collect::<BTreeSet<_>>().len(), keys.len(), "no key is written twice: {keys:?}");
    // A multi-line description and one with ": " or "#" round-trip to the same string.
    for desc in ["První řádek\ndruhý řádek", "Poznámka: s dvojtečkou # a mříží", "  mezery okolo  ", "[hranaté] {složené} 'uvozovky' \"dvojité\""] {
        let sb = sandbox();
        let src = source(&sb, "c15-common-attributes");
        edit(&src, "PKM/Pages/Garden plan.md", "description: Beds and paths\n", &format!("description: {}\n", serde_json::to_string(desc).expect("setup: JSON string")));
        let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import c15 with another description");
        let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
        let o = some!(core.object("Pages/Garden plan.md"), "the object in the index");
        assert_eq!(o.attributes.get("description").and_then(|v| v.as_str()), Some(desc), "the description {desc:?} round-trips to the same string");
        let keys = fm_keys(&some!(read_text(&run.root, "Pages/Garden plan.md"), "the file"));
        assert_eq!(keys, ["id", "type", "title", "description", "aliases", "icon", "tags", "import-id", "created", "modified"], "the keys in R149's order, whatever the description holds");
    }
}

#[test]
fn fr_imp_15_ac7_import_id() {
    for fixture in FIXTURES {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let mut seen = BTreeSet::new();
        for o in run.plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported) {
            let p = some!(o.path.clone(), format!("{fixture}: {} has a path", o.source));
            assert_eq!(o.import_id, format!("capacities:PKM/{}", o.source), "{fixture}: {p}: capacities:<space>/<path inside the space>, with `/`, NFC, not URL-encoded");
            assert!(nfc(&o.import_id) == o.import_id && !o.import_id.contains('%') && !o.import_id.contains('\\'), "{fixture}: {p}: NFC, not encoded");
            let text = some!(read_text(&run.root, &p), format!("{fixture}: {p}"));
            let lines: Vec<&str> = text.lines().filter(|l| l.starts_with("import-id:")).collect();
            assert_eq!(lines.len(), 1, "{fixture}: {p}: exactly one import-id");
            let core_value = lines[0]["import-id:".len()..].trim().trim_matches('"').trim_matches('\'');
            assert_eq!(core_value, o.import_id, "{fixture}: {p}: the written value");
            assert!(seen.insert(o.import_id.clone()), "{fixture}: {p}: unique in the run");
        }
        assert!(!some!(read_text(&run.root, REPORT), format!("{fixture}: the report")).contains("import-id"), "{fixture}: the report Page has none");
        for t in files(&run.root).iter().filter(|p| p.starts_with(".tegg/")) {
            assert!(!some!(read_text(&run.root, t), t).contains("import-id"), "{fixture}: {t} has none");
        }
        // Tegg reads each one back as written (quoted as YAML needs).
        let core = ok!(open_core(&run.root, &sb.dirs), format!("{fixture}: open the written vault"));
        for o in run.plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported) {
            let got = o.path.as_deref().and_then(|p| core.object(p)).and_then(|i| i.attributes.get("import-id").and_then(|v| v.as_str().map(str::to_string)));
            assert_eq!(got.as_deref(), Some(o.import_id.as_str()), "{fixture}: {}: the index reads the same import-id", o.source);
        }
    }
    let sb = sandbox();
    let c10 = ok!(import_fixture(&sb, "c10-duplicate-titles"), "import c10");
    assert_eq!(some!(object(&c10.plan, "Meetings/Tomáš  Eva (1).md"), "the meeting").import_id, "capacities:PKM/Meetings/Tomáš  Eva (1).md", "the criterion's example");
    // The same export imported twice gives the same import-ids and different ids.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(env(&sb), "env");
    let one = ok!(import_into(&core, &root, &fixtures().join("c12-task-dates"), SPACE, &Mapping::default(), &env), "first import");
    let two = ok!(import_into(&core, &root, &fixtures().join("c12-task-dates"), SPACE, &Mapping::default(), &env), "second import");
    let ids = |r: &Imported| r.plan.objects.iter().filter_map(|o| o.path.as_deref().and_then(|p| read_text(&root, p))).map(|t| (fm_get(&t, "import-id"), fm_get(&t, "id"))).collect::<Vec<_>>();
    let (a, b) = (ids(&one), ids(&two));
    assert_eq!(a.len(), 4, "four Tasks each time");
    assert_eq!(a.iter().map(|x| &x.0).collect::<Vec<_>>(), b.iter().map(|x| &x.0).collect::<Vec<_>>(), "the same import-ids");
    let all: BTreeSet<&Option<String>> = a.iter().chain(b.iter()).map(|x| &x.1).collect();
    assert_eq!(all.len(), 8, "and eight different ids");
}

#[test]
fn fr_imp_15_ac8_content_kept() {
    let sb = sandbox();
    let c18 = ok!(import_fixture(&sb, "c18-checklists"), "import c18");
    assert_eq!(body(&some!(read_text(&c18.root, "Pages/Packing.md"), "Packing")), "\n- [ ] passport\n- [x] tickets\n  - [ ] charger\n* [ ] snacks\n", "every checklist line is byte-identical");
    assert!(!files(&c18.root).iter().any(|p| p.starts_with("Tasks/")), "no Task object is created (FR-IMP-18 is not built)");
    assert_eq!(c18.plan.objects.len(), 1, "one object");
    let sb = sandbox();
    let c19 = ok!(import_fixture(&sb, "c19-ai-chat"), "import c19");
    let chat = some!(read_text(&c19.root, "Pages/Chat about gardens.md"), "the AI chat, a Page");
    assert_eq!((fm_get(&chat, "type").as_deref(), body(&chat).as_str()), (Some("page"), "\n**User:** How deep?\n\n**AI:** 30 cm.\n"), "a Page with its body unchanged");
}

// ------------------------------------------------------------------------------------------------ FR-IMP-17

#[test]
fn fr_imp_17_ac1_invisible_characters_are_removed_and_counted() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c17-invisible-chars"), "import c17");
    let o = some!(object(&run.plan, "Pages/Plan.md"), "the note");
    assert_eq!((o.title.as_deref(), o.path.as_deref(), o.name_changes.clone()), (Some("Plan"), Some("Pages/Plan.md"), Vec::new()), "title `Plan`, file `Plan.md`");
    let text = some!(read_text(&run.root, "Pages/Plan.md"), "Pages/Plan.md");
    assert_eq!(text, format!("---\nid: {}\ntype: page\ntitle: Plan\ntags: []\nimport-id: capacities:PKM/Pages/Plan.md\ncreated: {NOW}\nmodified: {NOW}\n---\n\nPlan: flights, hotel. Coder 👩\u{200d}💻 stays.\n", id(1)), "BOM and U+200B removed from the title and the body; the 👩‍💻 sequence byte-identical");
    assert_eq!(run.plan.report.cleanup, Cleanup { u200b: 3, ufeff: 1, u200c: 0, u200d: 0, crlf_files: 0 }, "the count is reported");
    // U+200C / U+200D outside an emoji sequence, and in an attribute value.
    let sb = sandbox();
    let src = source(&sb, "c17-invisible-chars");
    append(&src, "PKM/Pages/Plan.md", "\nSlovo\u{200c}slovo a spoj\u{200d}ka.\n");
    edit(&src, "PKM/Pages/Plan.md", "tags: []\n", "tags: []\npoznámka: 'ti\u{200b}chá'\n");
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import the changed c17");
    let text = some!(read_text(&run.root, "Pages/Plan.md"), "Pages/Plan.md");
    assert!(text.ends_with("\nSlovoslovo a spojka.\n") && text.contains("\npoznámka: tichá\n"), "removed from bodies and attributes");
    assert_eq!(run.plan.report.cleanup, Cleanup { u200b: 4, ufeff: 1, u200c: 1, u200d: 1, crlf_files: 0 }, "each character counted");
}

#[test]
fn fr_imp_17_ac2_nfc_and_lf() {
    let sb = sandbox();
    let src = source(&sb, "c15-common-attributes");
    let text = read_text(&src, "PKM/Pages/Garden plan.md").expect("setup: fixture");
    // A CRLF copy with an NFD title and an NFD link target; an NFD file name.
    let nfd = text.replace("title: Garden plan", "title: Za\u{301}hrada").replace("Plan.\n", "Plan. [[Za\u{301}hrada]]\n").replace('\n', "\r\n");
    std::fs::remove_file(src.join("PKM/Pages/Garden plan.md")).expect("setup: remove");
    write_raw(&src, "PKM/Pages/Za\u{301}hrada.md", nfd.as_bytes());
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &ok!(env(&sb), "env")), "import the CRLF and NFD copy");
    let o = &run.plan.objects[0];
    assert_eq!((o.source.as_str(), o.title.as_deref(), o.path.as_deref()), ("Pages/Záhrada.md", Some("Záhrada"), Some("Pages/Záhrada.md")), "names and the title are NFC");
    let on_disk: Vec<String> = std::fs::read_dir(run.root.join("Pages")).expect("setup: Pages").flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert!(on_disk.contains(&"Záhrada.md".to_string()), "the file name on disk is NFC: {on_disk:?}");
    let out = some!(read_text(&run.root, "Pages/Záhrada.md"), "the written file");
    assert!(!out.contains('\r'), "line endings are LF");
    assert_eq!(nfc(&out), out, "all text is NFC");
    assert_eq!((fm_get(&out, "title").as_deref(), body(&out).as_str()), (Some("Záhrada"), "\nPlan. [[Záhrada]]\n"), "the title and the link target are NFC; the link resolves to the note itself");
    assert_eq!(run.plan.report.cleanup.crlf_files, 1, "the file with CRLF is counted");
    assert_eq!(some!(link(&run.plan, "Pages/Záhrada.md", "[[Za\u{301}hrada]]"), "the NFD link").outcome, LinkOutcome::Resolved, "an NFD target resolves");
}

#[test]
fn fr_imp_17_ac3_template_scaffolding_is_kept() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import c02");
    assert_eq!(body(&some!(read_text(&run.root, "Ideas/Idea.md"), "Idea")), "\n### Content\n\nText with `[[not a link]]` in code.\n\n```\n[[also not a link]]\n```\n", "Capacities' `### Content` scaffolding and the code are kept as they are");
    let sb = sandbox();
    let c05 = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    assert!(body(&some!(read_text(&c05.root, "Images/Mapa řeky.md"), "the Image object")).starts_with("\n\nMedia: "), "the `Media:` scaffolding line and the empty lines stay");
}

#[test]
fn fr_imp_17_ac4_cleanup_counts_and_code() {
    let sb = sandbox();
    let src = source(&sb, "c17-invisible-chars");
    let code = "V kódu `a\u{200b}b` zůstává.\n\n```\nblok\u{200b} s \u{feff}BOM a \u{200c}\u{200d}\n```\n";
    append(&src, "PKM/Pages/Plan.md", &format!("\n{code}"));
    write_raw(&src, "PKM/Pages/Druhá.md", "---\r\ntype: 'Page'\r\ntitle: Druhá\r\ntags: []\r\n---\r\n\r\nŘádek\u{200b}.\r\n\r\n```\r\nkód\u{200b}\r\n```\r\n".as_bytes());
    let mut env = ok!(env(&sb), "env");
    env.strings = key_strings();
    let run = ok!(import_new(&sb, &src, SPACE, &Mapping::default(), &env), "import c17 with code");
    assert_eq!(run.plan.report.cleanup, Cleanup { u200b: 4, ufeff: 1, u200c: 0, u200d: 0, crlf_files: 1 }, "the number removed per character (code not counted) and the files with CRLF");
    let plan = some!(read_text(&run.root, "Pages/Plan.md"), "Pages/Plan.md");
    assert!(plan.ends_with(&format!("stays.\n\n{code}")), "invisible characters inside a code span and fenced code are kept: the code is byte-identical to the source");
    let second = some!(read_text(&run.root, "Pages/Druhá.md"), "Pages/Druhá.md");
    assert_eq!(body(&second), "\nŘádek.\n\n```\nkód\u{200b}\n```\n", "a code block is byte-identical to the source apart from CRLF → LF");
    let report = some!(read_text(&run.root, REPORT), "the report");
    assert_eq!(rows(&report, "⟦section.cleanup⟧"), ["U+200B · 4", "U+FEFF · 1", "⟦cleanup.crlf⟧ · 1"], "the report's Clean-up section: one row per count above 0");
}
