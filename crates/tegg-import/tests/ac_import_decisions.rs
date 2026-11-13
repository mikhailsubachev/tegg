//! Slice I1, L4: three owner decisions of the import engine, tested after the build (D-1569, Red-First-Exempt).
//! D-1563 (CP-9): a value that loses its key is kept as `<key>-text` (FR-IMP-15 AC-3, FR-IMP-24 AC-2);
//! D-1564 (CP-10): imported Image and PDF objects carry no `media-type`, `size`, `width`, `height` (FR-IMP-14 AC-1, AC-6);
//! D-1565 (CP-11): a stored `coverImage` / `previewImage` becomes `cover`, any other value writes no `cover` key and is
//! reported (FR-IMP-15 AC-4, FR-IMP-24 AC-2; fixture `c23-stored-covers`). Sources: docs/acceptance/import-capacities.md,
//! docs/contracts/v1-import.md §4.1, §5.3, §6, §16.2, §20. Written from the criteria, the contract and the fixtures only
//! (D-61); report rows are asserted as data (`ReportData`), never as English text.

mod common;

use std::path::Path;

use common::*;
use tegg_import::{AttrChange, FileChange, KeyReason, LinkOutcome, LinkPlace, Mapping, ObjectKind, ObjectOutcome, UnresolvedReason};

const C23: &str = "c23-stored-covers";
const MISSING: &str = "![](./Media/chyb%C3%AD.png)";

fn import_src(sb: &Sandbox, src: &Path) -> Result<Imported, String> {
    import_new(sb, src, SPACE, &Mapping::default(), &env(sb)?)
}
/// (source type, source key, change) of the Attributes rows whose source key is one of `keys`, in report order.
fn attr_rows(run: &Imported, keys: &[&str]) -> Vec<(String, String, AttrChange)> {
    run.plan.report.attributes.iter().filter(|r| keys.contains(&r.source_key.as_str())).map(|r| (r.source_type.clone(), r.source_key.clone(), r.change.clone())).collect()
}
fn pos(keys: &[String], k: &str) -> Option<usize> {
    keys.iter().position(|x| x == k)
}
fn c23_bytes(rel: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(C23).join("PKM").join(rel)).expect("setup: c23 media file")
}

// ------------------------------------------------------------------------------------------------ D-1563 (CP-9)

#[test]
fn fr_imp_15_ac3_date_beside_deadline_is_kept_as_date_text() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c12-task-dates"), "import c12");
    let p = "Tasks/Plan the release.md";
    assert_eq!(read_text(&run.root, p), read_text(&expected_dir("c12-task-dates"), p), "byte-equal to capacities-expected/c12-task-dates/{p}");
    let text = some!(read_text(&run.root, p), p);
    assert_eq!(fm_get(&text, "due").as_deref(), Some("2026-02-20"), "`due` is the deadline's day");
    assert_eq!(fm_get(&text, "date-text").as_deref(), Some("2026-02-09"), "the `date` value is kept as the day under `date-text`");
    let keys = fm_keys(&text);
    assert!(pos(&keys, "date").is_none() && pos(&keys, "deadline").is_none(), "neither `date` nor `deadline` is written as a key: {keys:?}");
    assert!(pos(&keys, "date-text") < pos(&keys, "due"), "`date-text` is at the place of the source key `date` (before `deadline`'s `due`): {keys:?}");
    assert_eq!(
        attr_rows(&run, &["date", "deadline"]).into_iter().filter(|r| r.0 == "Task").collect::<Vec<_>>(),
        [("Task".to_string(), "date".to_string(), AttrChange::Renamed { key: "date-text".into(), reason: KeyReason::KeyTaken })],
        "one Attributes row `Task · date · renamed · date-text · key already used`; nothing for `deadline`"
    );
    let yml = some!(read_text(&run.root, ".tegg/types/task.yml"), "task.yml");
    assert!(!type_attrs(&yml).iter().any(|(k, _)| k == "date-text" || k == "date"), "`date-text` is undeclared: task.yml has no such attribute");
    assert_eq!(read_bytes(&run.root, ".tegg/types/task.yml"), read_bytes(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), "types/task.yml"), "task.yml is unchanged by it");
    // A Task with only one of the two dates gets no `date-text`.
    for other in ["Tasks/Prepare budget review.md", "Tasks/Write report.md", "Tasks/Call the plumber.md"] {
        let t = some!(read_text(&run.root, other), other);
        assert!(pos(&fm_keys(&t), "date-text").is_none(), "{other}: no `date-text` (only one date, or none)");
    }
}

#[test]
fn fr_imp_15_ac3_date_text_keeps_a_value_that_is_no_date() {
    let sb = sandbox();
    let src = source(&sb, "c12-task-dates");
    edit(&src, "PKM/Tasks/Plan the release.md", "date: '2026-02-09T00:00:00.000Z'\ndeadline:", "date: příští týden\ndeadline:");
    let run = ok!(import_src(&sb, &src), "import the edited c12");
    let text = some!(read_text(&run.root, "Tasks/Plan the release.md"), "Plan the release");
    assert_eq!(fm_get(&text, "date-text").as_deref(), Some("příští týden"), "the value as written when it is no date");
    assert_eq!(fm_get(&text, "due").as_deref(), Some("2026-02-20"), "`due` is still the deadline's day");
    let keys = fm_keys(&text);
    assert!(pos(&keys, "date").is_none() && pos(&keys, "date-text") < pos(&keys, "due"), "`date-text` at the place of `date`, no `date` key: {keys:?}");
    assert!(
        attr_rows(&run, &["date"]).contains(&("Task".to_string(), "date".to_string(), AttrChange::Renamed { key: "date-text".into(), reason: KeyReason::KeyTaken })),
        "the rename is reported"
    );
    assert_eq!(read_bytes(&run.root, ".tegg/types/task.yml"), read_bytes(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), "types/task.yml"), "task.yml is unchanged");
}

#[test]
fn fr_imp_24_ac2_preview_image_beside_cover_is_kept_as_text() {
    let sb = sandbox();
    let src = source(&sb, C23);
    // `coverImage` after `previewImage`: the cover wins whatever the keys' order.
    edit(&src, "PKM/Weblinks/Tegg docs.md", "url: https://example.com/docs\n", "coverImage: '[Obal](../Images/Media/Obal.jpeg)'\nurl: https://example.com/docs\n");
    write_raw(
        &src,
        "PKM/Weblinks/Odkaz s adresou.md",
        "---\ntype: 'Weblink'\ntitle: Odkaz s adresou\ncoverImage: '[Obal](../Images/Media/Obal.jpeg)'\ntags: []\npreviewImage: https://example.com/náhled.png\nurl: https://example.com/adresa\n---\n\n".as_bytes(),
    );
    let run = ok!(import_src(&sb, &src), "import the edited c23");

    let docs = some!(read_text(&run.root, "Pages/Tegg docs.md"), "Pages/Tegg docs.md");
    assert_eq!(fm_get(&docs, "cover").as_deref(), Some("\"[[Obal]]\""), "`coverImage` gives `cover`");
    assert_eq!(fm_get(&docs, "previewImage-text").as_deref(), Some("\"![[Náhled webu.png]]\""), "the preview value is kept as text, its bound image link rewritten as in any text value (§4.1, §8 (4))");
    let keys = fm_keys(&docs);
    assert!(pos(&keys, "previewImage").is_none(), "no `previewImage` key: {keys:?}");
    assert!(pos(&keys, "previewImage-text") < pos(&keys, "url"), "`previewImage-text` at the place of `previewImage` (before `url`): {keys:?}");

    let adresa = some!(read_text(&run.root, "Pages/Odkaz s adresou.md"), "Pages/Odkaz s adresou.md");
    assert_eq!(fm_get(&adresa, "cover").as_deref(), Some("\"[[Obal]]\""), "the second Weblink's cover");
    assert_eq!(fm_get(&adresa, "previewImage-text").as_deref(), Some("https://example.com/náhled.png"), "a URL preview beside a cover is kept as written");
    assert!(pos(&fm_keys(&adresa), "previewImage").is_none(), "no `previewImage` key");

    assert_eq!(
        attr_rows(&run, &["previewImage"]),
        [("Weblink".to_string(), "previewImage".to_string(), AttrChange::Renamed { key: "previewImage-text".into(), reason: KeyReason::KeyTaken })],
        "one Attributes row `Weblink · previewImage · renamed · previewImage-text · key already used`"
    );
    for t in [".tegg/types/page.yml"] {
        let yml = some!(read_text(&run.root, t), t);
        assert!(!type_attrs(&yml).iter().any(|(k, _)| k.starts_with("previewImage") || k == "coverImage"), "{t}: `previewImage-text` is undeclared");
    }
}

// ------------------------------------------------------------------------------------------------ D-1564 (CP-10)

#[test]
fn fr_imp_14_ac1_imported_media_objects_have_no_media_attributes() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let media: Vec<&tegg_import::PlannedObject> = run.plan.objects.iter().filter(|o| matches!(o.r#type.as_deref(), Some("image") | Some("pdf")) && o.outcome == ObjectOutcome::Imported).collect();
    assert_eq!(media.len(), 4, "c05 writes 4 Image/PDF objects (three notes and the made `Untitled (44)` object)");
    for o in media {
        let p = some!(o.path.clone(), format!("{}: a planned path", o.source));
        let text = some!(read_text(&run.root, &p), p.clone());
        let keys = fm_keys(&text);
        for k in ["media-type", "size", "width", "height"] {
            assert!(pos(&keys, k).is_none(), "{p}: no `{k}` key (D-1564): {keys:?}");
        }
        assert!(o.frontmatter.iter().all(|(k, _)| !["media-type", "size", "width", "height"].contains(&k.as_str())), "{p}: nor in the planned frontmatter");
        assert!(fm_get(&text, "file").is_some_and(|v| v.starts_with("\"[[") && v.ends_with("]]\"")), "{p}: has its `file` link");
    }
}

#[test]
fn fr_imp_14_ac6_made_media_object_has_only_its_file() {
    for (fixture, source, path, file) in [
        ("c05-media-objects", "Images/Media/Untitled (44).png", None, None),
        (C23, "Weblinks/Media/Náhled webu.png", Some("Images/Náhled webu.md"), Some("\"[[Náhled webu.png]]\"")),
    ] {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let o = some!(object(&run.plan, source), format!("{fixture}: the made object of {source}"));
        assert_eq!(o.kind, ObjectKind::OrphanMedia, "{fixture}: a made media object");
        if let Some(path) = path {
            assert_eq!(o.path.as_deref(), Some(path), "{fixture}: written at {path}");
        }
        let p = some!(o.path.clone(), format!("{fixture}: a planned path"));
        let text = some!(read_text(&run.root, &p), p.clone());
        assert_eq!(fm_keys(&text), strs(&["id", "type", "title", "file", "import-id", "created", "modified"]), "{fixture}: {p} has these keys and nothing else (D-1564)");
        if let Some(file) = file {
            assert_eq!(fm_get(&text, "file").as_deref(), Some(file), "{fixture}: `file` names the attachment");
        }
    }
}

// ------------------------------------------------------------------------------------------------ D-1565 (CP-11), c23

#[test]
fn fr_imp_15_ac4_stored_cover_becomes_cover() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, C23), "import c23");
    let text = some!(read_text(&run.root, "Pages/Zahrada.md"), "Pages/Zahrada.md");
    assert_eq!(fm_get(&text, "cover").as_deref(), Some("\"[[Obal]]\""), "`coverImage` → `cover`, a link to the Image object");
    assert!(pos(&fm_keys(&text), "coverImage").is_none(), "no `coverImage` key");
    let l = some!(link(&run.plan, "Pages/Zahrada.md", "[Obal](../Images/Media/Obal.jpeg)"), "the planned cover link");
    assert_eq!((l.outcome.clone(), l.place.clone(), l.to.as_deref()), (LinkOutcome::Attachment, LinkPlace::Frontmatter { key: "coverImage".into() }, Some("_attachments/Obal.jpeg")), "a frontmatter link to the stored file");
    let obal = some!(read_text(&run.root, "Images/Obal.md"), "Images/Obal.md");
    assert_eq!(fm_get(&obal, "file").as_deref(), Some("\"[[Obal.jpeg]]\""), "the Image object is written with its file");
    assert_eq!(read_bytes(&run.root, "_attachments/Obal.jpeg"), Some(c23_bytes("Images/Media/Obal.jpeg")), "the file is copied byte for byte");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Pages/Zahrada.md", "Obal").as_deref(), Some("Images/Obal.md"), "`cover` resolves to the Image object");
}

#[test]
fn fr_imp_24_ac2_stored_preview_becomes_cover_and_missing_one_is_reported() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, C23), "import c23");

    // Stored: `cover` and a made Image object.
    let docs = some!(read_text(&run.root, "Pages/Tegg docs.md"), "Pages/Tegg docs.md");
    assert_eq!(fm_get(&docs, "cover").as_deref(), Some("\"[[Náhled webu]]\""), "a stored preview image becomes `cover`");
    let keys = fm_keys(&docs);
    assert!(pos(&keys, "previewImage").is_none() && pos(&keys, "previewImage-text").is_none(), "no `previewImage` key and nothing kept as text: {keys:?}");
    assert_eq!(read_bytes(&run.root, "_attachments/Náhled webu.png"), Some(c23_bytes("Weblinks/Media/Náhled webu.png")), "the file is copied byte for byte, keeping its name");
    let made = some!(read_text(&run.root, "Images/Náhled webu.md"), "the made Image object");
    assert_eq!((fm_get(&made, "type").as_deref(), fm_get(&made, "file").as_deref()), (Some("image"), Some("\"[[Náhled webu.png]]\"")), "an Image object for the file");
    let a = some!(run.plan.attachments.iter().find(|a| a.source == "Weblinks/Media/Náhled webu.png"), "the planned attachment");
    assert!(a.referenced, "the file is referenced (by the preview), so it isn't a D-77 orphan");
    assert!(!run.plan.report.files.iter().any(|r| r.change == FileChange::Unreferenced), "no `unreferenced` Files row");

    // Missing: no `cover`, reported as unresolved `missing file` and in Files.
    let bez = some!(read_text(&run.root, "Pages/Bez náhledu.md"), "Pages/Bez náhledu.md");
    let keys = fm_keys(&bez);
    for k in ["cover", "previewImage", "previewImage-text"] {
        assert!(pos(&keys, k).is_none(), "Bez náhledu: no `{k}` key (D-1565): {keys:?}");
    }
    let l = some!(link(&run.plan, "Weblinks/Bez náhledu.md", MISSING), "the planned preview link");
    assert_eq!(l.outcome, LinkOutcome::MissingFile, "outcome missing-file");
    assert_eq!(
        run.plan.report.unresolved.iter().map(|r| (r.note.as_str(), r.written.as_str(), &r.reason)).collect::<Vec<_>>(),
        [("Weblinks/Bez náhledu.md", MISSING, &UnresolvedReason::MissingFile)],
        "the only unresolved row: `missing file`"
    );
    assert_eq!(run.plan.report.files.len(), 1, "one Files row: {:?}", run.plan.report.files);
    assert!(
        matches!(&run.plan.report.files[0].change, FileChange::DroppedReference { written, .. } if written == MISSING) && run.plan.report.files[0].source == "Weblinks/Bez náhledu.md",
        "the Files row `droppedReference` of Bez náhledu: {:?}",
        run.plan.report.files
    );
    assert_eq!(attr_rows(&run, &["coverImage", "previewImage"]), Vec::new(), "stored and missing values give no Attributes row");

    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Pages/Tegg docs.md", "Náhled webu").as_deref(), Some("Images/Náhled webu.md"), "`cover` resolves to the made Image object");
}

#[test]
fn fr_imp_24_ac2_other_cover_values_write_no_cover_and_are_dropped() {
    let sb = sandbox();
    let src = source(&sb, C23);
    write_raw(&src, "PKM/Pages/Obal z webu.md", "---\ntype: 'Page'\ntitle: Obal z webu\ntags: []\ncoverImage: https://example.com/obal.jpg\n---\n\n".as_bytes());
    write_raw(&src, "PKM/Pages/Obal textem.md", "---\ntype: 'Page'\ntitle: Obal textem\ntags: []\ncoverImage: obal zahrady\n---\n\n".as_bytes());
    write_raw(&src, "PKM/Weblinks/Náhled z webu.md", "---\ntype: 'Weblink'\ntitle: Náhled z webu\ntags: []\npreviewImage: https://example.com/náhled.png\nurl: https://example.com/web\n---\n\n".as_bytes());
    let run = ok!(import_src(&sb, &src), "import the edited c23");
    for p in ["Pages/Obal z webu.md", "Pages/Obal textem.md", "Pages/Náhled z webu.md"] {
        let text = some!(read_text(&run.root, p), p);
        let keys = fm_keys(&text);
        for k in ["cover", "coverImage", "coverImage-text", "previewImage", "previewImage-text"] {
            assert!(pos(&keys, k).is_none(), "{p}: no `{k}` key (D-1565): {keys:?}");
        }
    }
    assert_eq!(
        attr_rows(&run, &["coverImage", "previewImage"]),
        [
            ("Page".to_string(), "coverImage".to_string(), AttrChange::Dropped { values: 2 }),
            ("Weblink".to_string(), "previewImage".to_string(), AttrChange::Dropped { values: 1 }),
        ],
        "each other value is an Attributes row `dropped` with its count (the stored and the missing ones aren't counted)"
    );
    assert_eq!(run.plan.report.unresolved.len(), 1, "still only the missing file is unresolved: {:?}", run.plan.report.unresolved);
    assert_eq!(fm_get(&some!(read_text(&run.root, "Pages/Zahrada.md"), "Zahrada"), "cover").as_deref(), Some("\"[[Obal]]\""), "the stored cover is unaffected");
    assert_eq!(tegg_import::accounting::check_plan(&run.scan.source, &run.plan), Vec::new(), "the accounting holds");
}

#[test]
fn fr_imp_05_ac6_stored_covers_are_accounted() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, C23), "import c23");
    let t = &run.plan.totals;
    let tally = |x: &tegg_import::Tally| (x.total, x.imported, x.reported);
    assert_eq!((tally(&t.objects), tally(&t.attachments), tally(&t.links)), ((4, 4, 0), (2, 2, 0), (4, 3, 1)), "c23: 4 objects, 2 attachments, 4 links, one of them missing-file (§16.2)");
    assert_eq!(run.plan.objects.len(), 5, "the made Image object is planned next to the 4 notes, in no tally");
    let raw = tegg_import::accounting::totals(&run.scan.source, SPACE);
    assert_eq!((raw.objects, raw.attachments, raw.links), (4, 2, 4), "the independent totals agree");
    assert_eq!(tegg_import::accounting::check_plan(&run.scan.source, &run.plan), Vec::new(), "the check passes on the plan");
    assert_eq!(tegg_import::accounting::check_vault(&run.scan.source, &run.plan, &run.root), Vec::new(), "the check passes on the written vault");
    assert_eq!(
        (run.plan.report.summary.objects.clone(), run.plan.report.summary.attachments.clone(), run.plan.report.summary.links.clone()),
        (t.objects.clone(), t.attachments.clone(), t.links.clone()),
        "the report's Summary is the plan's totals"
    );
}
