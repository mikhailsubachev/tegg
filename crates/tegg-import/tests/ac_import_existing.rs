//! Slice I1, L4: importing into an existing vault (docs/acceptance/import-capacities.md FR-IMP-03 AC-6…AC-8,
//! FR-IMP-11 AC-7, FR-IMP-14 AC-9, FR-IMP-20 AC-1 (the count), AC-2, FR-IMP-22 AC-3, AC-4, FR-HIS-04 AC-1, AC-12,
//! AC-13; docs/contracts/v1-import.md §4.1, §5.2, §9.1, §9.3, §12.3; ms4-jobs §6). The target is a temporary copy of
//! `target-existing-vault` with `new-empty/.tegg/` copied in; every pre-existing file is compared by bytes, mtime
//! and inode. Written from the criteria, the contract and the fixtures only (D-61); every check is an assertion here.

mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use tegg_core::Core;
use tegg_format::nfc;
use tegg_import::{
    AttrAction, Control, FileChange, ImportError, ImportPoint, LinkOutcome, Mapping, MappingEntry, MappingReason, NameChange, PointAction, Target, TypeTarget,
};

const BOOK_YML: &str = ".tegg/types/book.yml";

struct Vault {
    sb: Sandbox,
    root: PathBuf,
    core: Core,
}
/// The existing vault, opened. `prepare` changes the temporary copy before it is opened.
fn vault(prepare: impl FnOnce(&Path)) -> Result<Vault, String> {
    let sb = sandbox();
    let root = existing_vault(&sb);
    prepare(&root);
    let core = open_core(&root, &sb.dirs)?;
    Ok(Vault { sb, root, core })
}
fn import(v: &Vault, src: &Path, space: &str) -> Result<Imported, String> {
    import_into(&v.core, &v.root, src, space, &Mapping::default(), &env(&v.sb)?)
}

#[test]
fn fr_imp_03_ac6_existing_files_are_untouched() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let before = snapshot(&v.root);
    assert_setup(before.contains_key(".trash/Pages/Links across spaces.md") && before.contains_key("_attachments/Mapa řeky.jpeg"), "the vault has its trash and its attachment");
    let c01 = ok!(import(&v, &fixtures().join("c01-spaces"), SPACE), "import c01 into the vault");
    let after1 = snapshot(&v.root);
    assert_eq!(touched(&before, &after1), BTreeSet::new(), "after c01: every file that existed before, the ones in .trash/ too, is untouched; none moved or renamed");
    assert_eq!(added(&before, &after1), c01.report.written.iter().cloned().collect(), "the files that appeared are exactly the ones the run says it wrote");
    assert_eq!(c01.report.written.len(), 4, "three objects and the report");

    let c02 = ok!(import(&v, &fixtures().join("c02-typed-frontmatter"), SPACE), "import c02 into the vault");
    let after2 = snapshot(&v.root);
    assert_eq!(touched(&after1, &after2), set(&[BOOK_YML]), "after c02: the one exception is .tegg/types/book.yml");
    let (old, new) = (String::from_utf8_lossy(&before[BOOK_YML].bytes).into_owned(), String::from_utf8_lossy(&after2[BOOK_YML].bytes).into_owned());
    assert!(new.starts_with(&old) && new.len() > old.len(), "book.yml differs from before only by appended text");
    assert_eq!(type_attrs(&new), [("author", "text"), ("pages", "text"), ("rating", "number"), ("medium", "select"), ("language", "select"), ("finished", "checkbox")].map(|(k, t)| (k.to_string(), t.to_string())), "the appended attribute entries, after the vault's own");
    let mut expected: BTreeSet<String> = c02.report.written.iter().cloned().collect();
    expected.remove(BOOK_YML);
    assert_eq!(added(&after1, &after2), expected, "everything else the run wrote is a new file");
    assert!(added(&after1, &after2).contains(".tegg/types/idea.yml") && added(&after1, &after2).contains("Ideas/Idea.md"), "idea.yml and the folder Ideas/ are new");
    assert_eq!(temp_files(&v.root), Vec::<String>::new(), "no temporary file is left");
}

#[test]
fn fr_imp_03_ac7_collisions_get_suffixes_and_links_stay_right() {
    // Across folders (D-1558): the user's own Page `Book 2` and a note linking to it with the bare [[Book 2]].
    let own_book2 = "---\nid: 01JB5T00000000000000000007\ntype: page\ntitle: Book 2\ntags: []\ncreated: 2026-10-04T09:00:00+02:00\nmodified: 2026-10-04T09:00:00+02:00\n---\nVlastní stránka o druhé knize.\n";
    let reader = "---\nid: 01JB5T00000000000000000008\ntype: page\ntitle: Čtenář\ntags: []\ncreated: 2026-10-04T09:00:00+02:00\nmodified: 2026-10-04T09:00:00+02:00\n---\nČtu [[Book 2]] a plním [[PKM task]].\n";
    let v = ok!(vault(|root| {
        write_raw(root, "Pages/Book 2.md", own_book2.as_bytes());
        write_raw(root, "Pages/Čtenář.md", reader.as_bytes());
    }), "open the existing vault");
    let own_links = |core: &Core| (resolves(core, "Pages/Čtenář.md", "Book 2"), resolves(core, "Pages/Čtenář.md", "PKM task"), resolves(core, "Pages/Týden.md", "2026-02-02"));
    let links_before = own_links(&v.core);
    assert_eq!(links_before, (Some("Pages/Book 2.md".into()), Some("Tasks/PKM task.md".into()), Some("Daily/2026-02-02.md".into())), "setup: the user's links before the import");
    let before = snapshot(&v.root);

    let c01_src = source(&v.sb, "c01-spaces");
    append(&c01_src, "PKM/Pages/Links across spaces.md", "\nDomů: [[PKM home]].\n");
    let c01 = ok!(import(&v, &c01_src, SPACE), "import c01");
    assert_eq!((path_of(&c01.plan, "Tasks/PKM task.md").as_deref(), path_of(&c01.plan, "Pages/PKM home.md").as_deref(), path_of(&c01.plan, "Pages/Links across spaces.md").as_deref()), (Some("Tasks/PKM task (2).md"), Some("Pages/PKM home (2).md"), Some("Pages/Links across spaces.md")), "the user's Task and the already imported Page keep their files; the same-named file in .trash/ doesn't count");
    assert!(c01.plan.report.files.iter().any(|r| r.source == "Tasks/PKM task.md" && r.change == FileChange::NameChanged { name: "PKM task (2).md".into(), reasons: vec![NameChange::Suffix] }), "the suffix is a Files row");
    let home2 = some!(read_text(&v.root, "Pages/PKM home (2).md"), "the imported PKM home");
    assert_eq!(body(&home2), "\n[[PKM task (2)|PKM task]]\n", "the imported link names the imported Task's file");
    assert_eq!(resolves(&v.core, "Pages/PKM home (2).md", "PKM task (2)").as_deref(), Some("Tasks/PKM task (2).md"), "and resolves to the imported object, never to the user's same-named one");
    let across = some!(read_text(&v.root, "Pages/Links across spaces.md"), "the imported Links across spaces");
    assert!(across.ends_with("\nDomů: [[PKM home (2)|PKM home]].\n"), "a link to PKM home names the new copy");
    assert_eq!(resolves(&v.core, "Pages/Links across spaces.md", "PKM home (2)").as_deref(), Some("Pages/PKM home (2).md"), "and resolves to it");

    let c02_src = source(&v.sb, "c02-typed-frontmatter");
    append(&c02_src, "PKM/Ideas/Idea.md", "\nViz [[Book 1]] a [[Book 2]].\n");
    let c02 = ok!(import(&v, &c02_src, SPACE), "import c02");
    assert_eq!((path_of(&c02.plan, "Books/Book 1.md").as_deref(), path_of(&c02.plan, "Books/Book 2.md").as_deref(), path_of(&c02.plan, "Books/Book 3.md").as_deref()), (Some("Books/Book 1 (2).md"), Some("Books/Book 2 (2).md"), Some("Books/Book 3.md")), "Book 1 collides in its folder, Book 2 with the user's Pages/Book 2.md (vault-wide, D-1558)");
    let idea = some!(read_text(&v.root, "Ideas/Idea.md"), "the imported Idea");
    assert!(idea.ends_with("\nViz [[Book 1 (2)|Book 1]] a [[Book 2 (2)|Book 2]].\n"), "the imported links name the imported files: {idea}");
    for (t, to) in [("Book 1 (2)", "Books/Book 1 (2).md"), ("Book 2 (2)", "Books/Book 2 (2).md")] {
        assert_eq!(resolves(&v.core, "Ideas/Idea.md", t).as_deref(), Some(to), "[[{t}]] resolves to the imported Book");
    }
    // No existing note's link changed its target, and no existing file changed.
    assert_eq!(own_links(&v.core), links_before, "the user's [[Book 2]], [[PKM task]] and [[2026-02-02]] resolve as before");
    let after = snapshot(&v.root);
    assert_eq!(touched(&before, &after), set(&[BOOK_YML]), "every pre-existing file is untouched (book.yml gained attributes)");
    // Names are compared case-insensitively and in NFC.
    let v2 = ok!(vault(|root| {
        std::fs::rename(root.join("Tasks/PKM task.md"), root.join("Tasks/pkm TASK.md")).expect("setup: rename");
        write_raw(root, "Pages/Links across spa\u{301}ces.md", own_book2.replace("Book 2", "Jiná").as_bytes());
    }), "open a vault whose Task differs in case");
    let run = ok!(import(&v2, &fixtures().join("c01-spaces"), SPACE), "import c01");
    assert_eq!(path_of(&run.plan, "Tasks/PKM task.md").as_deref(), Some("Tasks/PKM task (2).md"), "`pkm TASK.md` takes the name case-insensitively");
    assert_eq!(path_of(&run.plan, "Pages/Links across spaces.md").as_deref(), Some("Pages/Links across spaces.md"), "a name that differs by a letter is free");
}

#[test]
fn fr_imp_03_ac8_existing_type_gains_attributes_only() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let run = ok!(import(&v, &fixtures().join("c02-typed-frontmatter"), SPACE), "import c02");
    let t = some!(run.plan.types.iter().find(|t| t.source_type == "Book"), "the Book type");
    assert_eq!((t.target.clone(), t.key.as_deref(), t.new), (TypeTarget::Existing { key: "book".into() }, Some("book"), false), "source type Book maps by default onto the vault's Book");
    let actions: Vec<(&str, AttrAction, Option<&str>, Option<&str>)> = t.attributes.iter().filter(|a| a.action != AttrAction::Consumed).map(|a| (a.source_key.as_str(), a.action.clone(), a.key.as_deref(), a.r#type.as_deref())).collect();
    assert_eq!(actions, [("author", AttrAction::Keep, Some("author"), Some("text")), ("medium", AttrAction::New, Some("medium"), Some("select")), ("language", AttrAction::New, Some("language"), Some("select")), ("pages", AttrAction::Keep, Some("pages"), Some("text")), ("finished", AttrAction::New, Some("finished"), Some("checkbox"))], "author and pages onto the existing attributes; medium, language, finished new");
    let book3 = some!(read_text(&v.root, "Books/Book 3.md"), "an imported Book");
    assert_eq!((fm_get(&book3, "author").as_deref(), fm_get(&book3, "pages").as_deref(), fm_get(&book3, "type").as_deref()), (Some("Author 3"), Some("\"102\""), Some("book")), "`pages` (number in the source, text in the vault) is written as text");
    assert_eq!(fm_get(&some!(read_text(&v.root, "Books/Book 1 (2).md"), "Book 1 (2)"), "pages").as_deref(), Some("\"100\""), "pages: \"100\"");
    let yml = some!(read_text(&v.root, BOOK_YML), "book.yml");
    assert_eq!(type_attrs(&yml).iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["author", "pages", "rating", "medium", "language", "finished"], "medium, language and finished are appended in source order");
    assert_eq!(type_options(&yml, "language"), ["ENG", "CZE"], "with their options");
    let own = some!(read_text(&v.root, "Books/Book 1.md"), "the user's own Book");
    assert!(own.contains("pages: asi tři sta\n"), "the user's Book is as it was");

    // A mapping onto an existing attribute whose kind can't hold every value is refused before any write.
    let v = ok!(vault(|_| {}), "open the existing vault again");
    let before = (snapshot(&v.root), snapshot(&v.sb.dirs.root).into_keys().collect::<BTreeSet<_>>());
    let env = ok!(env(&v.sb), "env");
    let scan = ok!(scan_of(&fixtures().join("c02-typed-frontmatter"), &env), "scan c02");
    let m = ok!(mapping(r#"{"types":{"Book":{"attributes":{"author":{"to":{"kind":"existing","key":"rating"}}}}}}"#), "the mapping");
    let r = tegg_import::plan(&scan, SPACE, &Target::Existing(&v.core), &m, &env, &Control::default()).err();
    assert_eq!(r, Some(ImportError::InvalidMapping { entry: MappingEntry { source_type: "Book".into(), attribute: Some("author".into()) }, reason: MappingReason::KindMismatch }), "`author` (text) onto `rating` (number) is refused with the attribute named");
    assert_eq!((snapshot(&v.root), snapshot(&v.sb.dirs.root).into_keys().collect::<BTreeSet<_>>()), before, "nothing was written");
    // The other direction converts without loss and is allowed: pages (number) onto the text attribute `author`.
    let m = ok!(mapping(r#"{"types":{"Book":{"attributes":{"pages":{"to":{"kind":"existing","key":"author"}},"author":{"to":{"kind":"drop"}}}}}}"#), "the mapping");
    let p = ok!(tegg_import::plan(&scan, SPACE, &Target::Existing(&v.core), &m, &env, &Control::default()), "a number onto a text attribute converts without loss");
    assert!(p.objects.iter().any(|o| o.frontmatter.iter().any(|(k, v)| k == "author" && *v == tegg_import::FmValue::Text("100".into()))), "planned as text");
}

#[test]
fn fr_imp_11_ac7_day_that_already_has_a_daily_note() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let day = chrono::NaiveDate::from_ymd_opt(2026, 2, 2).expect("setup: date");
    assert_setup(v.core.daily_note(day).as_deref() == Some("Daily/2026-02-02.md") && resolves(&v.core, "Pages/Týden.md", "2026-02-02").as_deref() == Some("Daily/2026-02-02.md"), "before the import the day opens the user's note");
    let before = snapshot(&v.root);
    let src = source(&v.sb, "c13-daily-notes");
    write_raw(&src, "PKM/Pages/Pondělí.md", "---\ntype: 'Page'\ntitle: Pondělí\ntags: []\n---\n\nZápis z [[Date/2026-02-02]].\n".as_bytes());
    let run = ok!(import(&v, &src, SPACE), "import c13 into the vault");
    assert_eq!((path_of(&run.plan, "DailyNotes/2026-02-02.md").as_deref(), path_of(&run.plan, "DailyNotes/2026-02-03.md").as_deref()), (Some("Daily/2026-02-02 (2).md"), Some("Daily/2026-02-03.md")), "the imported day gets ` (2)` (D-1529); a day the vault doesn't have keeps its name");
    let imported = some!(read_text(&v.root, "Daily/2026-02-02 (2).md"), "the imported day");
    assert_eq!((fm_get(&imported, "type").as_deref(), fm_get(&imported, "date").as_deref(), fm_get(&imported, "title").as_deref(), fm_get(&imported, "import-id").as_deref()), (Some("daily-note"), Some("2026-02-02"), Some("\"2026-02-02\""), Some("capacities:PKM/DailyNotes/2026-02-02.md")), "a Daily Note of that date with an import-id");
    assert_eq!(fm_get(&imported, "created").as_deref(), Some(NOW), "its `created` is the import time: the newest of the day's notes");
    assert_eq!(touched(&before, &snapshot(&v.root)), BTreeSet::new(), "Daily/2026-02-02.md, Pages/Týden.md and every other file are untouched");

    let check = |core: &Core, what: &str| {
        assert_eq!(core.daily_note(day).as_deref(), Some("Daily/2026-02-02.md"), "{what}: the note the date opens is still the user's: a note without import-id comes first (D-1546)");
        assert_eq!(resolves(core, "Pages/Týden.md", "2026-02-02").as_deref(), Some("Daily/2026-02-02.md"), "{what}: the user's [[2026-02-02]] resolves to the same file as before the import");
        assert_eq!(resolves(core, "Pages/Pondělí.md", "2026-02-02").as_deref(), Some("Daily/2026-02-02.md"), "{what}: the imported date mention opens the same note, the day's");
        let view = core.daily_view(day);
        assert_eq!(view.duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), ["Daily/2026-02-02 (2).md"], "{what}: the day's note shows D-319's notice naming the imported note");
        let group: Option<BTreeSet<String>> = core.duplicate_titles().into_iter().find(|g| g.key == "2026-02-02").map(|g| g.objects.iter().map(|o| nfc(&o.path)).collect());
        assert_eq!(group, Some(set(&["Daily/2026-02-02.md", "Daily/2026-02-02 (2).md"])), "{what}: both are on the Duplicate titles page");
        let next = chrono::NaiveDate::from_ymd_opt(2026, 2, 3).expect("setup: date");
        assert_eq!(core.daily_note(next).as_deref(), Some("Daily/2026-02-03.md"), "{what}: 3 Feb opens the imported note");
    };
    check(&v.core, "after the import");
    assert!(some!(read_text(&v.root, "Pages/Pondělí.md"), "the imported Page").ends_with("\nZápis z [[2026-02-02]].\n"), "the imported date mention is written as [[2026-02-02]], never as a path to the imported note");
    assert!(run.plan.report.files.iter().any(|r| r.source == "DailyNotes/2026-02-02.md" && r.change == FileChange::NameChanged { name: "2026-02-02 (2).md".into(), reasons: vec![NameChange::Suffix] }), "the report's Files section lists the day");
    // The same after the index is deleted and rebuilt (AR-01).
    let rebuilt = ok!(open_core(&v.root, &fresh_dirs(&v.sb, "Jiný Mac")), "open the vault with no index");
    check(&rebuilt, "after a rebuild");
}

#[test]
fn fr_imp_14_ac9_existing_attachment_is_never_replaced() {
    for nfd_copy in [false, true] {
        let v = ok!(vault(|root| {
            if nfd_copy {
                // An NFD copy of the existing name collides the same way.
                std::fs::rename(root.join("_attachments/Mapa řeky.jpeg"), root.join("_attachments/Mapa r\u{30c}eky.jpeg")).expect("setup: rename");
            }
        }), "open the existing vault");
        let before = snapshot(&v.root);
        let own = before["_attachments/Mapa řeky.jpeg"].clone();
        let run = ok!(import(&v, &fixtures().join("c05-media-objects"), SPACE), "import c05 into the vault");
        let after = snapshot(&v.root);
        assert_eq!(after.get("_attachments/Mapa řeky.jpeg"), Some(&own), "NFD copy {nfd_copy}: the user's own file is untouched (bytes, mtime, inode)");
        assert_eq!(touched(&before, &after), BTreeSet::new(), "NFD copy {nfd_copy}: no pre-existing file changed");
        let source_bytes = std::fs::read(fixtures().join("c05-media-objects/PKM/Images/Media/Mapa řeky.jpeg")).expect("setup: source image");
        assert_eq!(read_bytes(&v.root, "_attachments/Mapa řeky (2).jpeg"), Some(source_bytes), "NFD copy {nfd_copy}: the imported image is `Mapa řeky (2).jpeg`, with the source file's bytes (same SHA-256)");
        let image = some!(read_text(&v.root, "Images/Mapa řeky.md"), "the Image object");
        assert_eq!((fm_get(&image, "file").as_deref(), body(&image).as_str()), (Some("\"[[Mapa řeky (2).jpeg]]\""), "\n\nMedia: ![[Mapa řeky (2).jpeg]]\n"), "NFD copy {nfd_copy}: the Image object's `file` and its body follow the new name");
        assert!(body(&some!(read_text(&v.root, "Pages/Trip notes.md"), "Trip notes")).starts_with("\n![[Mapa řeky (2).jpeg]]\n"), "NFD copy {nfd_copy}: Trip notes embeds the imported file");
        assert!(run.plan.report.files.iter().any(|r| r.source == "Images/Media/Mapa řeky.jpeg" && r.change == FileChange::NameChanged { name: "Mapa řeky (2).jpeg".into(), reasons: vec![NameChange::Suffix] }), "NFD copy {nfd_copy}: the report's Files section lists the changed name");
        let l = some!(link(&run.plan, "Pages/Trip notes.md", "![Map](../Images/Media/Mapa%20%C5%99eky.jpeg)"), "the embed");
        assert_eq!((l.outcome.clone(), l.to.as_deref()), (LinkOutcome::Attachment, Some("_attachments/Mapa řeky (2).jpeg")), "NFD copy {nfd_copy}: bound to the imported file");
        // Each reference resolves to the imported file in Tegg's index: the Image object owns it.
        let back: BTreeSet<String> = v.core.backlinks("Images/Mapa řeky.md").iter().map(|p| nfc(p)).collect();
        assert!(back.contains("Pages/Trip notes.md"), "NFD copy {nfd_copy}: the embed in Trip notes is a link to the imported Image object (FR-ATT-07): {back:?}");
    }
}

#[test]
fn fr_imp_20_ac1_the_plan_counts_already_imported_objects() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let env = ok!(env(&v.sb), "env");
    let scan = ok!(scan_of(&fixtures().join("c01-spaces"), &env), "scan c01");
    let plan = ok!(plan_of(&scan, SPACE, &Target::Existing(&v.core), &Mapping::default(), &env), "plan PKM against the vault");
    assert_eq!(plan.already_imported, 1, "the count the Where step and the preview warn with");
    // After an import of the same space the count is every object of the space.
    let run = ok!(import(&v, &fixtures().join("c01-spaces"), SPACE), "import PKM");
    assert_eq!(run.plan.already_imported, 1, "the run's plan had the same count");
    let again = ok!(plan_of(&scan, SPACE, &Target::Existing(&v.core), &Mapping::default(), &env), "plan PKM again");
    assert_eq!(again.already_imported, 3, "importing again would duplicate all three objects");
}

#[test]
fn fr_imp_20_ac2_repeat_detection() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let env = ok!(env(&v.sb), "env");
    let scan = ok!(scan_of(&fixtures().join("c01-spaces"), &env), "scan c01");
    let count = |core: &Core, space: &str| plan_of(&scan, space, &Target::Existing(core), &Mapping::default(), &env).map(|p| p.already_imported);
    assert_eq!(ok!(count(&v.core, "PKM"), "plan PKM"), 1, "PKM: Pages/PKM home.md; the object in .trash/ with a matching import-id isn't counted");
    assert_eq!(ok!(count(&v.core, "Work"), "plan Work"), 0, "Work: nothing imported before");
    let new = ok!(plan_of(&scan, SPACE, &new_target(&v.sb), &Mapping::default(), &env), "plan against a new vault");
    assert_eq!(new.already_imported, 0, "a new-vault target gives 0");
    // The whole import-id string is compared, in NFC.
    let home = some!(read_text(&v.root, "Pages/PKM home.md"), "the earlier import");
    for (value, want, what) in [("\"capacities:PKM/Pages/PKM home.md \"", 0, "a trailing space is another string"), ("\"capacities:pkm/Pages/PKM home.md\"", 0, "case matters"), ("\"capacities:PKM/Pages/PKM home.md\"", 1, "the exact string")] {
        let (_, ver) = ok!(v.core.read_note("Pages/PKM home.md", std::time::SystemTime::now()), "read the note");
        let text = home.replace("\"capacities:PKM/Pages/PKM home.md\"", value);
        ok!(v.core.write_note("Pages/PKM home.md", text.as_bytes(), Some(&ver)), "write the note");
        assert!(v.core.wait_idle(Duration::from_secs(30)), "idle");
        assert_eq!(ok!(count(&v.core, "PKM"), "plan PKM"), want, "{what}");
    }
    // The same after the index is deleted and rebuilt (AR-01): the count comes from the files.
    let rebuilt = ok!(open_core(&v.root, &fresh_dirs(&v.sb, "Jiný Mac")), "open the vault with no index");
    assert_eq!(ok!(count(&rebuilt, "PKM"), "plan PKM"), 1, "the same count from a fresh index");
}

#[test]
fn fr_imp_22_ac3_second_space_maps_onto_existing_types() {
    let sb = sandbox();
    let first = ok!(import_fixture(&sb, "c01-spaces"), "import PKM into a new vault");
    let core = ok!(open_core(&first.root, &sb.dirs), "open the new vault");
    let env = ok!(env(&sb), "env");
    let second = ok!(import_into(&core, &first.root, &fixtures().join("c01-spaces"), "Work", &Mapping::default(), &env), "import Work into the same vault");
    let types: Vec<(&str, TypeTarget, bool)> = second.plan.types.iter().map(|t| (t.source_type.as_str(), t.target.clone(), t.new)).collect();
    assert_eq!(types, [("Page", TypeTarget::Existing { key: "page".into() }, false), ("Task", TypeTarget::Existing { key: "task".into() }, false)], "Work's Tasks → the existing Task type, its Pages → Page");
    let written: BTreeSet<String> = files(&first.root).into_iter().filter(|p| !p.starts_with(".tegg/")).collect();
    assert_eq!(written, set(&["Pages/Links across spaces.md", "Pages/PKM home.md", "Tasks/PKM task.md", REPORT, "Pages/Quarterly plan.md", "Pages/Work home.md", "Tasks/Work task.md", "Pages/Import report 2026-11-12 Work.md"]), "both spaces' objects and their two reports");
    assert_eq!(fm_get(&some!(read_text(&first.root, "Tasks/Work task.md"), "Work task"), "import-id").as_deref(), Some("capacities:Work/Tasks/Work task.md"), "the second space's import-id names its space");
    assert_eq!(second.plan.already_imported, 0, "nothing of Work was imported before");
}

#[test]
fn fr_imp_22_ac4_second_space_matches_vault_types() {
    let sb = sandbox();
    let first = ok!(import_fixture(&sb, "c02-typed-frontmatter"), "import PKM of c02 into a new vault");
    // No mapping from the first run is stored anywhere: only the type files, the objects and the report.
    let stored: Vec<String> = snapshot(&sb.base).into_keys().filter(|k| !k.starts_with("zdroj/") && (k.contains("mapping") || k.contains("import-mappings"))).collect();
    assert_eq!(stored, Vec::<String>::new(), "no mapping file in the vault or in Application Support");
    // Another export that has a `Book` type (the plural differs in case; one more attribute).
    let other = sb.base.join("zdroj").join("druhý export");
    write_raw(&other, "Práce/BOOKS/Kniha A.md", "---\ntype: 'book'\ntitle: Kniha A\ntags: []\nauthor: Autorka\npages: 250\nfinished: true\nseries: Řada\n---\n\nText.\n".as_bytes());
    for (dirs, what) in [(sb.dirs.clone(), "this Mac"), (fresh_dirs(&sb, "Jiný Mac"), "another Mac (no index, no Application Support)")] {
        let core = ok!(open_core(&first.root, &dirs), format!("{what}: open the vault"));
        let mut env = ok!(env(&sb), "env");
        env.dirs = dirs.clone();
        let scan = ok!(scan_of(&other, &env), "scan the second export");
        let plan = ok!(plan_of(&scan, "Práce", &Target::Existing(&core), &Mapping::default(), &env), format!("{what}: plan against the vault"));
        let t = some!(plan.types.iter().find(|t| t.source_type == "book"), "the source type");
        assert_eq!((t.target.clone(), t.key.as_deref(), t.name.as_deref(), t.new), (TypeTarget::Existing { key: "book".into() }, Some("book"), Some("Book"), false), "{what}: the existing Book is proposed (matched by name, NFC, case-insensitive), not marked New");
        let attrs: Vec<(&str, AttrAction, Option<&str>)> = t.attributes.iter().filter(|a| a.action != AttrAction::Consumed).map(|a| (a.source_key.as_str(), a.action.clone(), a.key.as_deref())).collect();
        assert_eq!(attrs, [("author", AttrAction::Keep, Some("author")), ("pages", AttrAction::Keep, Some("pages")), ("finished", AttrAction::Keep, Some("finished")), ("series", AttrAction::New, Some("series"))], "{what}: its attributes are matched by key; only the unknown one is new");
        assert!(plan.types.iter().all(|t| !t.new), "{what}: nothing is marked New");
    }
    // A type matched by its plural.
    let by_plural = sb.base.join("zdroj").join("třetí export");
    write_raw(&by_plural, "Práce/Knihy/Kniha B.md", "---\ntype: 'Books'\ntitle: Kniha B\ntags: []\n---\n".as_bytes());
    let core = ok!(open_core(&first.root, &sb.dirs), "open the vault");
    let env = ok!(env(&sb), "env");
    let plan = ok!(plan_of(&ok!(scan_of(&by_plural, &env), "scan"), "Práce", &Target::Existing(&core), &Mapping::default(), &env), "plan");
    assert_eq!(plan.types.iter().map(|t| (t.target.clone(), t.new)).collect::<Vec<_>>(), [(TypeTarget::Existing { key: "book".into() }, false)], "a source type equal to the vault type's plural is matched too");
}

#[test]
fn fr_his_04_ac1_importing_into_a_non_empty_vault_makes_a_backup_first() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    assert_eq!(import_backups(&v.sb.dirs), Vec::<PathBuf>::new(), "setup: no backup yet");
    let run = ok!(import(&v, &fixtures().join("c01-spaces"), SPACE), "import c01 into the non-empty vault");
    let zips = import_backups(&v.sb.dirs);
    assert_eq!(zips.len(), 1, "one backup zip");
    assert_eq!(zips[0].file_name().map(|n| n.to_string_lossy().into_owned()), run.report.backup, "the run names it");
    assert!(run.plan.backup.is_some(), "and the plan expected it");
}

#[test]
fn fr_his_04_ac12_backup_before_import() {
    let v = ok!(vault(|_| {}), "open the existing vault");
    let before = snapshot(&v.root);
    let mut env = ok!(env(&v.sb), "env");
    // At `AfterBackup` the zip is complete and no vault file is written yet.
    let seen: Arc<Mutex<Option<(Vec<PathBuf>, bool)>>> = Arc::default();
    let points = Points::default();
    let (s, root, dirs, b) = (seen.clone(), v.root.clone(), v.sb.dirs.clone(), before.clone());
    env.points = Some(hook(&points, move |_, p| {
        if matches!(p, ImportPoint::AfterBackup) {
            *s.lock().unwrap_or_else(|e| e.into_inner()) = Some((import_backups(&dirs), snapshot(&root) == b));
        }
        PointAction::Continue
    }));
    let run = ok!(import_into(&v.core, &v.root, &fixtures().join("c01-spaces"), SPACE, &Mapping::default(), &env), "import c01 into the vault");
    let (zips, untouched) = some!(seen.lock().unwrap_or_else(|e| e.into_inner()).clone(), "the run raised AfterBackup");
    assert_eq!((zips.len(), untouched), (1, true), "the zip is in the vault's backup folder before any vault file is created");
    let order = points.seen();
    let backup_at = order.iter().position(|p| matches!(p, ImportPoint::AfterBackup));
    let first_file = order.iter().position(|p| file_point(p).is_some());
    assert!(backup_at < first_file && backup_at.is_some(), "AfterBackup comes before the first file point");
    let name = zips[0].file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let stamp = name.strip_suffix("-import.zip").unwrap_or("");
    assert!(stamp.len() == 15 && stamp.char_indices().all(|(i, c)| if i == 8 { c == '-' } else { c.is_ascii_digit() }), "named <UTC yyyymmdd-hhmmss>-import.zip: {name}");
    assert_eq!(run.report.backup.as_deref(), Some(name.as_str()), "the run's report names the zip");
    let held = read_zip(&zips[0]);
    let want: BTreeSet<String> = before.keys().filter(|k| !k.ends_with('/') && (k.ends_with(".md") || k.starts_with(".tegg/"))).cloned().collect();
    assert_eq!(held.keys().map(|k| nfc(k)).collect::<BTreeSet<_>>(), want, "it holds every .md (those in .trash/ too) and every file under .tegg/, with NFC UTF-8 names");
    assert!(held.keys().all(|k| nfc(k) == *k), "the names are NFC");
    for (k, bytes) in &held {
        assert_eq!(Some(bytes), before.get(&nfc(k)).map(|e| &e.bytes), "{k} is in the zip as it was");
    }
    assert!(!held.contains_key("_attachments/Mapa řeky.jpeg"), "attachments are not in the backup (ms4-jobs §6)");

    // Rotation keeps the newest 10.
    let folder = zips[0].parent().expect("setup: backup folder").to_path_buf();
    for i in 0..10 {
        std::fs::write(folder.join(format!("2026010{i}-000000-import.zip")), b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0").expect("setup: an older backup");
    }
    let env2 = ok!(common::env(&v.sb), "env");
    let run2 = ok!(import_into(&v.core, &v.root, &fixtures().join("c12-task-dates"), SPACE, &Mapping::default(), &env2), "a second import");
    let names: Vec<String> = import_backups(&v.sb.dirs).iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).collect();
    assert_eq!(names.len(), 10, "ten zips are kept: {names:?}");
    assert!(names.contains(&name) && run2.report.backup.as_ref().is_some_and(|n| names.contains(n)), "the two newest are among them");
    assert!(!names.contains(&"20260100-000000-import.zip".to_string()), "the oldest is gone");

    // The backup made to fail: `failed` with BackupFailed, the vault untouched.
    let v = ok!(vault(|_| {}), "open another copy");
    let before = snapshot(&v.root);
    std::fs::write(v.sb.dirs.root.join("backups"), b"this is a file, not a folder").expect("setup: block the backup folder");
    let env = ok!(common::env(&v.sb), "env");
    let scan = ok!(scan_of(&fixtures().join("c01-spaces"), &env), "scan");
    let target = Target::Existing(&v.core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    let report = ok!(run_plan(plan, &scan, &target, &env), "the run");
    assert_eq!(report.phase, tegg_jobs::Phase::Failed, "the job ends failed");
    assert!(matches!(report.error, Some(ImportError::BackupFailed { .. })), "with BackupFailed: {:?}", report.error);
    assert_eq!(snapshot(&v.root), before, "the vault is untouched");
    assert!(report.written.is_empty() && report.backup.is_none(), "nothing written, no backup named");

    // Cancelling during the backup leaves the vault untouched and removes the partial zip.
    let v = ok!(vault(|_| {}), "open another copy");
    let before = snapshot(&v.root);
    let mut env = ok!(common::env(&v.sb), "env");
    let (at_backup, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let (a, g) = (at_backup.clone(), go.clone());
    env.points = Some(Arc::new(move |p: &ImportPoint| {
        if matches!(p, ImportPoint::BeforeBackup) {
            a.store(true, Ordering::SeqCst);
            wait_until(Duration::from_secs(30), || g.load(Ordering::SeqCst));
        }
        PointAction::Continue
    }));
    let scan = ok!(scan_of(&fixtures().join("c01-spaces"), &env), "scan");
    let target = Target::Existing(&v.core);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    let run = ok!(tegg_import::start(plan, &scan, &target, &env), "start");
    assert!(wait_until(Duration::from_secs(60), || at_backup.load(Ordering::SeqCst)), "the run reached the backup");
    let cancelled = run.cancel();
    go.store(true, Ordering::SeqCst);
    assert_eq!(cancelled, Ok(()), "cancel is accepted in `backup`");
    let report = some!(run.wait(Duration::from_secs(60)), "the final report");
    assert_eq!((report.phase, report.error.clone()), (tegg_jobs::Phase::Cancelled, None), "the job ends cancelled");
    assert_eq!(snapshot(&v.root), before, "the vault is untouched");
    assert_eq!(snapshot(&v.sb.dirs.root.join("backups")).into_keys().filter(|k| !k.ends_with('/')).collect::<Vec<_>>(), Vec::<String>::new(), "no zip, whole or partial, is left");
}

#[test]
fn fr_his_04_ac13_no_backup_for_a_new_vault() {
    // A new vault: no zip.
    let sb = sandbox();
    let new = ok!(import_fixture(&sb, "c01-spaces"), "import into a new vault");
    assert_eq!((import_backups(&sb.dirs), new.report.backup.clone(), new.plan.backup.clone()), (Vec::new(), None, None), "importing into a new vault makes no zip");

    // (what, files of the vault besides new-empty's .tegg/, the fixture, a backup?)
    let own_book = std::fs::read(fixtures().join("target-existing-vault/.tegg/types/book.yml")).expect("setup: book.yml");
    let trashed = std::fs::read(fixtures().join("target-existing-vault/.trash/Pages/Links across spaces.md")).expect("setup: trashed note");
    let template = "---\ntype: page\ntitle: Šablona\n---\nŠablona.\n".as_bytes().to_vec();
    let cases: [(&str, Vec<(&str, Vec<u8>)>, &str, bool); 6] = [
        ("an open vault that holds no object file (only .tegg/)", vec![], "c01-spaces", false),
        ("a vault with only an object in .trash/", vec![(".trash/Pages/Links across spaces.md", trashed.clone())], "c01-spaces", true),
        ("a vault with only a template in _templates/", vec![("_templates/Page/Šablona.md", template)], "c01-spaces", true),
        ("a vault with no .md but the user's book.yml, importing c02 (which extends it)", vec![(BOOK_YML, own_book.clone())], "c02-typed-frontmatter", true),
        ("the same vault importing c01 (no type file changes)", vec![(BOOK_YML, own_book.clone())], "c01-spaces", false),
        ("a vault with only a non-.md file", vec![("_attachments/obrázek.png", b"png".to_vec())], "c01-spaces", false),
    ];
    for (what, extra, fixture, backup) in cases {
        let sb = sandbox();
        let root = sb.base.join("Trezor");
        copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
        for (p, bytes) in &extra {
            write_raw(&root, p, bytes);
        }
        let core = ok!(open_core(&root, &sb.dirs), format!("{what}: open"));
        let run = ok!(import_into(&core, &root, &fixtures().join(fixture), SPACE, &Mapping::default(), &ok!(env(&sb), "env")), format!("{what}: import {fixture}"));
        let zips = import_backups(&sb.dirs);
        assert_eq!((zips.len() == 1, run.report.backup.is_some(), run.plan.backup.is_some()), (backup, backup, backup), "{what}: a backup is made: {backup}");
        if backup {
            let held = read_zip(&zips[0]);
            for (p, bytes) in &extra {
                assert_eq!(held.get(*p), Some(bytes), "{what}: the zip holds {p} as it was");
            }
            assert!(held.contains_key(".tegg/vault.yml"), "{what}: and the files under .tegg/");
        }
    }
}
