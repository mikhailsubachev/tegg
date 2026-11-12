//! Slice I1, L4: input (docs/acceptance/import-capacities.md FR-IMP-07 AC-1, AC-2, AC-5…AC-9, AC-12; FR-IMP-22 AC-1,
//! AC-2; R147, R153; docs/contracts/v1-import.md §3, §5, §5.4, §11). Zip variants and broken archives are built at
//! test time with the helpers' own zip writer (never committed, never the system `unzip`). Written from the criteria,
//! the contract and the fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

use common::*;
use tegg_import::{
    AttachmentOutcome, Control, ImportError, LinkOutcome, Mapping, ObjectOutcome, ObjectUnreadable, OtherKind, SkippedRow, SourceKind, Target, UnreadableReason,
    UnresolvedReason,
};
use unicode_free::nfd;

/// NFD of the few Czech letters the fixtures use (no dependency on a normalization crate in the tests).
mod unicode_free {
    pub fn nfd(s: &str) -> String {
        let mut out = String::new();
        for c in s.chars() {
            match c {
                'á' => out.push_str("a\u{301}"), 'é' => out.push_str("e\u{301}"), 'í' => out.push_str("i\u{301}"), 'ó' => out.push_str("o\u{301}"),
                'ú' => out.push_str("u\u{301}"), 'ý' => out.push_str("y\u{301}"), 'š' => out.push_str("s\u{30c}"), 'č' => out.push_str("c\u{30c}"),
                'ř' => out.push_str("r\u{30c}"), 'ž' => out.push_str("z\u{30c}"), 'ě' => out.push_str("e\u{30c}"), 'ů' => out.push_str("u\u{30a}"),
                'ň' => out.push_str("n\u{30c}"), 'ť' => out.push_str("t\u{30c}"), 'ď' => out.push_str("d\u{30c}"), 'Ž' => out.push_str("Z\u{30c}"),
                'Č' => out.push_str("C\u{30c}"), 'Š' => out.push_str("S\u{30c}"), 'Ú' => out.push_str("U\u{301}"),
                _ => out.push(c),
            }
        }
        out
    }
}

fn bytes_of(root: &Path) -> Vec<(String, Vec<u8>)> {
    snapshot(root).into_iter().map(|(k, v)| (k, v.bytes)).collect()
}

#[test]
fn fr_imp_07_ac1_zip_and_folder_give_the_same_result() {
    for fixture in FIXTURES {
        let (a, b) = (sandbox(), sandbox());
        let zip = zip_fixture(&a, fixture);
        let from_zip = ok!(import_new(&a, &zip, SPACE, &Mapping::default(), &ok!(env(&a), "env")), format!("{fixture}: import the zip"));
        let from_dir = ok!(import_fixture(&b, fixture), format!("{fixture}: import the folder"));
        assert_eq!(from_zip.scan.info.kind, SourceKind::Zip, "{fixture}: the scan says zip");
        assert_eq!(from_zip.scan.info.size, std::fs::metadata(&zip).ok().map(|m| m.len()), "{fixture}: with the zip file's size");
        assert_eq!((from_dir.scan.info.kind.clone(), from_dir.scan.info.size), (SourceKind::Folder, None), "{fixture}: a folder has no size (D-1544)");
        assert_eq!(from_zip.scan.info.spaces, from_dir.scan.info.spaces, "{fixture}: the same spaces and counts");
        // The two plans differ only in what depends on the container (§5.4); target parents differ per sandbox.
        let (mut pz, mut pd) = (from_zip.plan.normalized(), from_dir.plan.normalized());
        assert!(from_zip.plan.same_as(&from_zip.plan) && !pz.objects.is_empty(), "{fixture}: same_as is reflexive and the plan has objects");
        pz.source.files = pd.source.files;
        assert_eq!(pz.objects, pd.objects, "{fixture}: equal planned objects");
        pd.target = pz.target.clone();
        assert_eq!(pz, pd, "{fixture}: equal normalized plans for the zip and the folder");
        assert_eq!(bytes_of(&from_zip.root), bytes_of(&from_dir.root), "{fixture}: byte-identical written vaults");
    }
}

#[test]
fn fr_imp_07_ac2_zip_names_are_utf8_and_nfc() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    for fixture in ["c05-media-objects", "c10-duplicate-titles", "c11-file-names"] {
        let dir = fixtures().join(fixture);
        let plain = ok!(scan_of(&dir, &env), format!("{fixture}: scan the folder"));
        let want = ok!(plan_of(&plain, SPACE, &target, &Mapping::default(), &env), format!("{fixture}: plan the folder"));
        // (a) names without the UTF-8 flag, (b) NFD names, (c) both, with `\` separators.
        let variants: [(&str, Box<dyn Fn(&mut ZipEntry)>); 3] = [
            ("no UTF-8 flag", Box::new(|e| e.utf8_flag = false)),
            ("NFD names", Box::new(|e| e.name = nfd(&String::from_utf8_lossy(&e.name)).into_bytes())),
            ("NFD, no flag, backslashes", Box::new(|e| {
                e.utf8_flag = false;
                e.name = nfd(&String::from_utf8_lossy(&e.name)).replace('/', "\\").into_bytes();
            })),
        ];
        for (what, change) in variants {
            let mut entries = entries_of(&dir, "");
            entries.iter_mut().for_each(|e| change(e));
            let zip = sb.base.join("varianty").join(what).join(format!("{fixture}.zip"));
            write_zip(&zip, &entries);
            let scan = ok!(scan_of(&zip, &env), format!("{fixture}, {what}: scan"));
            assert_eq!(scan.info.unreadable, Vec::new(), "{fixture}, {what}: 0 unreadable entries");
            let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), format!("{fixture}, {what}: plan"));
            let sources = |p: &tegg_import::Plan| p.objects.iter().map(|o| o.source.clone()).chain(p.attachments.iter().map(|a| a.source.clone())).collect::<Vec<_>>();
            assert_eq!(sources(&plan), sources(&want), "{fixture}, {what}: the same source paths, NFC, with `/`");
            assert!(sources(&plan).iter().all(|s| tegg_format::nfc(s) == *s), "{fixture}, {what}: every name is NFC");
            assert!(plan.same_as(&want), "{fixture}, {what}: the same plan as the NFC folder");
        }
    }
    // A name near 255 bytes with diacritics, an emoji and `?`.
    let long = format!("PKM/Pages/{} 🌊 proč?.md", "Žluťoučký kůň ".repeat(11)); // 11 × 20 bytes + the rest
    assert_setup(long.rsplit('/').next().is_some_and(|n| (235..=255).contains(&n.len())), "the generated name is near 255 bytes");
    let mut entries = entries_of(&fixtures().join("c11-file-names"), "");
    entries.push(ZipEntry::new(&long, "---\ntype: 'Page'\ntitle: Dlouhé jméno souboru\ntags: []\n---\n\nText.\n".as_bytes()));
    let zip = sb.base.join("dlouhé").join("c11-file-names.zip");
    write_zip(&zip, &entries);
    let scan = ok!(scan_of(&zip, &env), "scan the zip with a long name");
    assert_eq!(scan.info.unreadable, Vec::new(), "the long name is read");
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan it");
    let o = some!(object(&plan, &long["PKM/".len()..]), "the object with the long file name, by its exact UTF-8 name");
    assert_eq!((o.outcome.clone(), o.path.as_deref()), (ObjectOutcome::Imported, Some("Pages/Dlouhé jméno souboru.md")), "imported under its title");
}

#[test]
fn fr_imp_07_ac5_layouts() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    // One space and no space folder: `c13-daily-notes` with `PKM/` stripped, in a folder named `Deník 2026`.
    let single = sb.base.join("zdroj").join("Deník 2026");
    copy_dir(&fixtures().join("c13-daily-notes/PKM"), &single, &[]);
    let scan = ok!(scan_of(&single, &env), "scan the single-space export");
    assert_eq!(scan.info.spaces.iter().map(|s| (s.name.as_str(), s.objects)).collect::<Vec<_>>(), [("Deník 2026", 2)], "one space named after the source folder");
    let plan = ok!(plan_of(&scan, "Deník 2026", &target, &Mapping::default(), &env), "plan it");
    let plain_scan = ok!(scan_of(&fixtures().join("c13-daily-notes"), &env), "scan the plain form");
    let plain = ok!(plan_of(&plain_scan, SPACE, &target, &Mapping::default(), &env), "plan the plain form");
    let shape = |p: &tegg_import::Plan| (p.objects.iter().map(|o| (o.source.clone(), o.path.clone(), o.frontmatter.iter().filter(|(k, _)| k != "import-id").cloned().collect::<Vec<_>>())).collect::<Vec<_>>(), p.links.clone(), p.totals.clone());
    assert_eq!(shape(&plan), shape(&plain), "the same objects, paths, values, links and totals as the plain form");
    assert_eq!(plan.objects[0].import_id, "capacities:Deník 2026/DailyNotes/2026-02-02.md", "import-id uses the space's name");
    // The same as a zip: the space is named after the zip file without `.zip`.
    let zip = zip_dir(&sb, &single);
    let zscan = ok!(scan_of(&zip, &env), "scan the single-space zip");
    assert_eq!(zscan.info.spaces.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Deník 2026"], "named after the zip file, without .zip");
    assert!(ok!(plan_of(&zscan, "Deník 2026", &target, &Mapping::default(), &env), "plan the zip").same_as(&plan), "the zip gives the same plan");

    // A zip with one wrapper folder around the spaces, and a file outside every space.
    let c01 = fixtures().join("c01-spaces");
    let mut wrapped = entries_of(&c01, "export/");
    wrapped.push(ZipEntry::new("export/Čti mě.txt", "mimo prostory".as_bytes()));
    let wzip = sb.base.join("obal").join("c01-spaces.zip");
    write_zip(&wzip, &wrapped);
    let wscan = ok!(scan_of(&wzip, &env), "scan the wrapped zip");
    let pscan = ok!(scan_of(&c01, &env), "scan the plain folder");
    assert_eq!(wscan.info.spaces, pscan.info.spaces, "the wrapper folder is skipped: the same three spaces");
    assert_eq!((wscan.info.outside_spaces, pscan.info.outside_spaces), (1, 0), "the file outside every space is counted");
    let wplan = ok!(plan_of(&wscan, SPACE, &target, &Mapping::default(), &env), "plan the wrapped zip");
    let pplan = ok!(plan_of(&pscan, SPACE, &target, &Mapping::default(), &env), "plan the plain folder");
    assert_eq!((&wplan.objects, &wplan.links, &wplan.attachments), (&pplan.objects, &pplan.links, &pplan.attachments), "the same plan as the plain form");
    assert_eq!(wplan.other_files.iter().filter(|f| f.kind == OtherKind::OutsideSpace).map(|f| f.source.as_str()).collect::<Vec<_>>(), ["Čti mě.txt"], "…and it is an other file of the plan");
    assert!(wplan.report.skipped.iter().any(|r| matches!(r, SkippedRow::Ignored { source, kind: OtherKind::OutsideSpace } if source == "Čti mě.txt")), "…with its row in the report's Skipped section");
    assert_eq!(wplan.totals.other_files.reported, 1, "…counted as reported");
}

#[test]
fn fr_imp_07_ac6_file_classes() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    let src = source(&sb, "c08-tag-collections");
    write_raw(&src, "PKM/.DS_Store", b"\0\0\0\x01Bud1");
    write_raw(&src, "PKM/Pages/.Skrytá.md", "---\ntype: 'Page'\ntitle: Skrytá\n---\n".as_bytes());
    let scan = ok!(scan_of(&src, &env), "scan c08 with two dotfiles");
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    let others: Vec<(&str, &OtherKind)> = plan.other_files.iter().map(|f| (f.source.as_str(), &f.kind)).collect();
    assert_eq!(others, [(".DS_Store", &OtherKind::Dotfile), ("Pages/.Skrytá.md", &OtherKind::Dotfile), ("Tags/Areas.csv", &OtherKind::TagCollection), ("Tags/Topics.csv", &OtherKind::TagCollection)], "two dotfiles and two tag collections (the BOM one too)");
    assert_eq!(plan.objects.iter().map(|o| o.source.as_str()).collect::<Vec<_>>(), ["Pages/Tagged.md"], "the .md files that aren't dotfiles are the objects");
    assert_eq!(plan.attachments, Vec::new(), "nothing else is an attachment");
    for f in &plan.other_files {
        assert!(plan.report.skipped.iter().any(|r| matches!(r, SkippedRow::Ignored { source, kind } if *source == f.source && *kind == f.kind)), "{} is reported", f.source);
    }
    assert_eq!((plan.totals.objects.total, plan.totals.attachments.total, plan.totals.other_files.total), (1, 0, 4), "the totals by class");

    let media = ok!(scan_of(&fixtures().join("c05-media-objects"), &env), "scan c05");
    let mplan = ok!(plan_of(&media, SPACE, &target, &Mapping::default(), &env), "plan c05");
    assert_eq!(mplan.attachments.iter().map(|a| a.source.as_str()).collect::<Vec<_>>(), ["Images/Media/Mapa řeky.jpeg", "Images/Media/Untitled (44).png", "Images/Media/image (3).png", "PDFs/Media/Manual.pdf"], "the four Media/ files are the attachments");
    assert!(mplan.attachments.iter().all(|a| a.outcome == AttachmentOutcome::Imported), "all imported");
    assert_eq!(media.info.spaces.iter().map(|s| (s.objects, s.attachments)).collect::<Vec<_>>(), [(4, 4)], "the scan counts 4 objects and 4 attachments");
}

#[test]
fn fr_imp_07_ac7_unreadable_items_are_reported() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    let scan = ok!(scan_of(&fixtures().join("c02-typed-frontmatter"), &env), "scan c02");
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan c02");
    let broken = some!(object(&plan, "Pages/Broken frontmatter.md"), "Broken frontmatter is an object of the plan");
    assert_eq!(broken.outcome, ObjectOutcome::Unreadable { reason: ObjectUnreadable::Yaml, line: Some(3) }, "unreadable, with its reason and line");
    assert_eq!(broken.path, None, "no target path");
    assert_eq!(links_of(&plan, "Pages/Broken frontmatter.md").iter().map(|l| (l.written.as_str(), &l.outcome)).collect::<Vec<_>>(), [("[[Idea]]", &LinkOutcome::InSkippedNote)], "its link is `in a skipped note`");
    assert!(plan.report.skipped.contains(&SkippedRow::Note { source: "Pages/Broken frontmatter.md".into(), reason: ObjectUnreadable::Yaml, line: Some(3) }), "the report's Skipped row");
    assert!(plan.report.unresolved.iter().any(|r| r.note == "Pages/Broken frontmatter.md" && r.written == "[[Idea]]" && r.reason == UnresolvedReason::InSkippedNote), "the link's row");
    assert_eq!(plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).count(), 7, "the other seven objects are imported");
    assert_eq!((plan.totals.objects.total, plan.totals.objects.imported, plan.totals.objects.reported), (8, 7, 1), "imported + reported = total");

    // A zip entry with an invalid UTF-8 name, and one whose stored CRC is wrong (a failing read): counted, and the plan completes.
    let mut entries = entries_of(&fixtures().join("c02-typed-frontmatter"), "");
    let mut bad = ZipEntry::new("x", b"---\ntype: 'Page'\ntitle: X\n---\n");
    bad.name = b"PKM/Pages/\xff\xfe.md".to_vec();
    entries.push(bad);
    let zip = sb.base.join("vadné").join("c02-typed-frontmatter.zip");
    write_zip(&zip, &entries);
    let mut raw = std::fs::read(&zip).expect("setup: read zip");
    let needle = b"PKM/Books/Book 3.md";
    let hits: Vec<usize> = raw.windows(needle.len()).enumerate().filter(|(_, w)| w == needle).map(|(i, _)| i).collect();
    assert_setup(hits.len() == 2, "the entry name is in the local header and the central directory");
    for at in hits {
        // The CRC field: 16 bytes before the name in a local header (30-byte header), 30 before it in a central one (46).
        let crc_at = if &raw[at - 30..at - 26] == b"PK\x03\x04" { at - 16 } else { at - 30 };
        raw[crc_at] ^= 0xff;
    }
    std::fs::write(&zip, raw).expect("setup: write zip");
    let zscan = ok!(scan_of(&zip, &env), "the scan completes");
    assert!(zscan.info.unreadable.iter().any(|u| u.reason == UnreadableReason::BadName), "the invalid name is counted: {:?}", zscan.info.unreadable);
    let zplan = ok!(plan_of(&zscan, SPACE, &target, &Mapping::default(), &env), "the plan completes");
    assert_eq!(zplan.other_files.iter().filter(|f| f.kind == OtherKind::UnreadableEntry).count(), 1, "the nameless entry is an other file of kind unreadableEntry");
    assert!(zplan.report.skipped.iter().any(|r| matches!(r, SkippedRow::Entry { reason: UnreadableReason::BadName, .. })), "…with a Skipped row");
    let b3 = some!(object(&zplan, "Books/Book 3.md"), "Book 3 is still an object, by its name");
    assert_eq!(b3.outcome, ObjectOutcome::Unreadable { reason: ObjectUnreadable::Read, line: None }, "a failing read is `unreadable`, reason read");
    assert_eq!((zplan.totals.objects.total, zplan.totals.objects.imported, zplan.totals.objects.reported), (8, 6, 2), "counted, never dropped");
    assert_eq!(tegg_import::accounting::check_plan(&zscan.source, &zplan), Vec::new(), "the accounting holds");
}

#[test]
fn fr_imp_07_ac8_source_is_read_only() {
    let sb = sandbox();
    let env0 = ok!(env(&sb), "env");
    let dir = source(&sb, "c05-media-objects");
    let zip = zip_dir(&sb, &dir);
    let sources_before = (snapshot(&dir), snapshot(&sb.base.join("zipy")));
    let untouched = |what: &str| assert_eq!((snapshot(&dir), snapshot(&sb.base.join("zipy"))), sources_before, "{what}: every file of the folder source and the zip itself are untouched (bytes, mtime, inode)");
    for src in [&dir, &zip] {
        let target = new_target(&sb);
        // Scan and plan.
        let scan = ok!(scan_of(src, &env0), "scan");
        let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env0), "plan");
        untouched("after scan and plan");
        // Cancel before the write phase.
        let mut env = env0.clone();
        let run = ok!(tegg_import::start(plan.clone(), &scan, &target, &env0), "start");
        let _ = run.cancel();
        let _ = run.wait(std::time::Duration::from_secs(120));
        untouched("after a cancel (or a finished run when the cancel came too late)");
        let _ = std::fs::remove_dir_all(sb.new_vault());
        // A failure in the write phase.
        let points = Points::default();
        env.points = Some(hook(&points, |_, p| if matches!(p, tegg_import::ImportPoint::TempWritten { kind: tegg_import::FileKind::Object, .. }) { tegg_import::PointAction::Fail(std::io::ErrorKind::StorageFull) } else { tegg_import::PointAction::Continue }));
        let failed = ok!(run_plan(plan.clone(), &scan, &target, &env), "a run that fails");
        assert_eq!(failed.phase, tegg_jobs::Phase::Failed, "the injected failure fails the run");
        untouched("after a failure");
        // A finished write.
        let done = ok!(run_plan(plan, &scan, &target, &env0), "a run that finishes");
        assert_eq!(done.phase, tegg_jobs::Phase::Done, "the import finished: {:?}", done.error);
        untouched("after a write");
        let _ = std::fs::remove_dir_all(sb.new_vault());
    }
    // Nothing of the zip was extracted next to it, into the vault place or into Application Support.
    let stray: Vec<String> = snapshot(&sb.base).into_keys().filter(|k| !k.starts_with("zdroj/") && !k.starts_with("zipy/") && !k.ends_with('/') && (k.ends_with("Mapa řeky.jpeg") || k.ends_with("Manual.pdf"))).collect();
    assert_eq!(stray, Vec::<String>::new(), "no extracted copy of a source file is left anywhere in the sandbox");

    // Entries named with `../`, an absolute path or a drive letter: never written anywhere, reported as unreadable.
    let mut entries = entries_of(&fixtures().join("c01-spaces"), "");
    for name in ["../zlo-1.md", "PKM/Pages/../../../zlo-2.md", "/tmp/zlo-3.md", "C:\\zlo-4.md"] {
        entries.push(ZipEntry::new(name, "---\ntype: 'Page'\ntitle: Zlo\n---\n".as_bytes()));
    }
    let evil = sb.base.join("zlo").join("c01-spaces.zip");
    write_zip(&evil, &entries);
    let scan = ok!(scan_of(&evil, &env0), "scan the zip with unsafe names");
    assert_eq!(scan.info.unreadable.iter().filter(|u| u.reason == UnreadableReason::Traversal).count(), 4, "four entries are `Traversal`: {:?}", scan.info.unreadable);
    let target = new_target(&sb);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env0), "plan");
    assert_eq!(plan.objects.len(), 3, "none of them is an object of the space");
    assert_eq!(plan.other_files.iter().filter(|f| f.kind == OtherKind::UnreadableEntry).count(), 4, "they are other files of kind unreadableEntry");
    assert_eq!(plan.report.skipped.iter().filter(|r| matches!(r, SkippedRow::Entry { reason: UnreadableReason::Traversal, .. })).count(), 4, "each with a Skipped row");
    let done = ok!(run_plan(plan, &scan, &target, &env0), "write");
    assert_eq!(done.phase, tegg_jobs::Phase::Done, "the import finished: {:?}", done.error);
    let zlo: Vec<String> = snapshot(&sb.base).into_keys().filter(|k| k.contains("zlo-")).collect();
    assert_eq!(zlo, Vec::<String>::new(), "no such entry was written anywhere");
    assert!(!Path::new("/tmp/zlo-3.md").exists(), "…nor at its absolute path");
}

#[test]
fn fr_imp_07_ac9_refusals_write_nothing() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let ctl = Control::default();
    let before = snapshot(&sb.base);
    let err = |r: Result<tegg_import::Scan, ImportError>| r.err();
    assert_eq!(err(tegg_import::scan(&fixtures().join("x01-not-capacities"), &env, &ctl)), Some(ImportError::NotCapacities), "x01-not-capacities");
    assert_eq!(snapshot(&sb.base), before, "nothing created");

    let good = zip_fixture(&sb, "c01-spaces");
    let bytes = std::fs::read(&good).expect("setup: read zip");
    let truncated = sb.base.join("zipy/zkrácený.zip");
    std::fs::write(&truncated, &bytes[..bytes.len() / 2]).expect("setup: write");
    let not_zip = sb.base.join("zipy/není-zip.zip");
    std::fs::write(&not_zip, "Tohle není zip.").expect("setup: write");
    let mut locked = entries_of(&fixtures().join("c01-spaces"), "");
    locked.iter_mut().for_each(|e| e.encrypted = true);
    let encrypted = sb.base.join("zipy/zamčený.zip");
    write_zip(&encrypted, &locked);
    let empty = sb.base.join("zdroj/prázdný");
    write_raw(&empty, "PKM/Tags/Areas.csv", b"Title,Description\n");
    let before = snapshot(&sb.base);
    assert_eq!(err(tegg_import::scan(&truncated, &env, &ctl)), Some(ImportError::UnreadableArchive), "a truncated zip");
    assert_eq!(err(tegg_import::scan(&not_zip, &env, &ctl)), Some(ImportError::UnreadableArchive), "a file that is not a zip");
    assert_eq!(err(tegg_import::scan(&encrypted, &env, &ctl)), Some(ImportError::EncryptedArchive), "a password-protected zip");
    assert!(matches!(err(tegg_import::scan(&sb.base.join("zdroj/není tu"), &env, &ctl)), Some(ImportError::SourceGone { .. })), "a source that isn't there");
    assert!(matches!(err(tegg_import::scan(&empty, &env, &ctl)), Some(ImportError::NotCapacities | ImportError::Empty)), "an export with no object");
    assert_eq!(snapshot(&sb.base), before, "no refusal created anything");

    // Target refusals, at plan time and again at start.
    let src = source(&sb, "c01-spaces");
    let scan = ok!(scan_of(&src, &env), "scan c01");
    let plan_err = |t: &Target<'_>| tegg_import::plan(&scan, SPACE, t, &Mapping::default(), &env, &ctl).err();
    let taken = sb.base.join("obsazeno");
    write_raw(&taken, &format!("{VAULT_NAME}/Poznámka.md"), "moje".as_bytes());
    let read_only = sb.base.join("jen pro čtení");
    std::fs::create_dir_all(&read_only).expect("setup: dir");
    let inside_vault = existing_vault(&sb).join("Pages");
    let before = snapshot(&sb.base);
    assert_eq!(plan_err(&Target::NewVault { parent: taken.clone(), name: VAULT_NAME.into() }), Some(ImportError::TargetExists), "the folder exists");
    assert_eq!(plan_err(&Target::NewVault { parent: sb.base.join("není"), name: VAULT_NAME.into() }), Some(ImportError::TargetNotWritable), "the place doesn't exist");
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&read_only, std::fs::Permissions::from_mode(0o555)).expect("setup: chmod");
        assert_eq!(plan_err(&Target::NewVault { parent: read_only.clone(), name: VAULT_NAME.into() }), Some(ImportError::TargetNotWritable), "the place can't be written");
        std::fs::set_permissions(&read_only, std::fs::Permissions::from_mode(0o755)).expect("setup: chmod back");
    }
    assert_eq!(plan_err(&Target::NewVault { parent: inside_vault, name: VAULT_NAME.into() }), Some(ImportError::TargetInsideVault), "inside a vault (a .tegg/ above the place)");
    assert_eq!(plan_err(&Target::NewVault { parent: src.join("PKM"), name: VAULT_NAME.into() }), Some(ImportError::TargetInsideSource), "inside the source");
    assert_eq!(plan_err(&Target::NewVault { parent: src.clone(), name: VAULT_NAME.into() }), Some(ImportError::TargetInsideSource), "the source folder itself");
    assert!(matches!(plan_err(&Target::NewVault { parent: sb.place(), name: "A/B".into() }), Some(ImportError::InvalidPlan { reason: tegg_import::PlanReason::Target, .. })), "a name that isn't a sanitized stem");
    assert!(matches!(tegg_import::plan(&scan, "Neznámý", &new_target(&sb), &Mapping::default(), &env, &ctl).err(), Some(ImportError::UnknownSpace { .. })), "an unknown space");
    assert_eq!(snapshot(&sb.base), before, "no refusal created anything in a target place");

    // The source changes between the plan and the start of the write: SourceChanged, nothing created.
    let target = new_target(&sb);
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan");
    append(&src, "PKM/Pages/PKM home.md", "Připsáno po plánu.\n");
    let place_before = snapshot(&sb.place());
    let r = tegg_import::start(plan.clone(), &scan, &target, &env).err();
    assert!(matches!(r, Some(ImportError::SourceChanged { .. })), "a source whose size or modification time differs is refused at start: {r:?}");
    assert!(matches!(tegg_import::plan(&scan, SPACE, &target, &Mapping::default(), &env, &ctl).err(), Some(ImportError::SourceChanged { .. })), "…and by a plan from the old scan");
    assert_eq!(snapshot(&sb.place()), place_before, "nothing was created in the target place");
    // …and a target that appeared since the plan: TargetExists at start.
    let scan2 = ok!(scan_of(&src, &env), "scan again");
    let plan2 = ok!(plan_of(&scan2, SPACE, &target, &Mapping::default(), &env), "plan again");
    write_raw(&sb.place(), &format!("{VAULT_NAME}/Poznámka.md"), "moje".as_bytes());
    let place_before = snapshot(&sb.place());
    assert_eq!(tegg_import::start(plan2, &scan2, &target, &env).err(), Some(ImportError::TargetExists), "the folder appeared since the plan");
    assert_eq!(snapshot(&sb.place()), place_before, "the folder that appeared is untouched");
}

#[test]
fn fr_imp_07_ac12_no_space_counts_uncompressed_and_backup() {
    const MB: u64 = 1_000_000;
    let sb = sandbox();
    let mut env = ok!(env(&sb), "env");
    // A zip whose space is about 200 MB uncompressed and far under 1 MB compressed.
    let mut entries = entries_of(&fixtures().join("c01-spaces"), "");
    entries.push(ZipEntry::new("PKM/Images/Media/velký.bin", &vec![0u8; (200 * MB) as usize]));
    let zip = sb.base.join("velký").join("c01-spaces.zip");
    write_zip(&zip, &entries);
    let zip_size = std::fs::metadata(&zip).expect("setup: zip").len();
    assert_setup(zip_size < MB, "the zip is under 1 MB");
    let scan = ok!(scan_of(&zip, &env), "scan the zip (its directory)");
    let target = new_target(&sb);
    env.disk = Arc::new(FixedDisk { free: 100 * MB, other: None });
    let r = tegg_import::plan(&scan, SPACE, &target, &Mapping::default(), &env, &Control::default());
    match r {
        Err(ImportError::NoSpace { needed, free }) => {
            assert_eq!(free, 100 * MB, "free is the injected free space");
            assert!((220 * MB..221 * MB).contains(&needed), "needed is the uncompressed size of the space plus 10% (not the zip's {zip_size} bytes): {needed}");
        }
        other => assert!(false, "100 MB free: NoSpace at plan time, got {:?}", other.map(|p| p.needed_bytes)),
    }
    assert!(!sb.new_vault().exists() && !sb.importing().exists(), "nothing written");
    env.disk = Arc::new(FixedDisk { free: 300 * MB, other: None });
    let plan = ok!(tegg_import::plan(&scan, SPACE, &target, &Mapping::default(), &env, &Control::default()), "300 MB free: the plan succeeds");
    assert!((200 * MB..201 * MB).contains(&plan.space_bytes), "space_bytes is the uncompressed size of the space's entries: {}", plan.space_bytes);
    assert_eq!(plan.needed_bytes, (plan.space_bytes * 11).div_ceil(10), "needed = ceil(1.1 × space_bytes) for a new vault");
    assert_eq!(plan.backup, None, "no backup for a new vault");

    // An existing vault that gets a backup: the backup's size is added on the same volume…
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = (snapshot(&root), snapshot(&sb.dirs.root));
    let small = ok!(scan_of(&fixtures().join("c01-spaces"), &env), "scan c01");
    env.disk = Arc::new(FixedDisk { free: 300 * MB, other: None });
    let p = ok!(tegg_import::plan(&small, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control::default()), "plan into the existing vault");
    let backup = some!(p.backup.clone(), "the plan expects a backup");
    let md_and_tegg: u64 = snapshot(&root).iter().filter(|(k, _)| !k.ends_with('/') && (k.ends_with(".md") || k.starts_with(".tegg/"))).map(|(_, v)| v.bytes.len() as u64).sum();
    assert_eq!(backup.bytes, md_and_tegg, "the backup's size is the size of the files it will hold (every .md and every file under .tegg/)");
    assert_eq!(p.needed_bytes, (p.space_bytes * 11).div_ceil(10) + backup.bytes, "same volume: the backup's size is added to needed");
    env.disk = Arc::new(FixedDisk { free: p.needed_bytes - 1, other: None });
    let r = tegg_import::plan(&small, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control::default()).err();
    assert_eq!(r, Some(ImportError::NoSpace { needed: p.needed_bytes, free: p.needed_bytes - 1 }), "one byte short on the shared volume");
    env.disk = Arc::new(FixedDisk { free: p.needed_bytes, other: None });
    assert!(tegg_import::plan(&small, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control::default()).is_ok(), "exactly enough");
    // …and checked against the backup folder's own volume otherwise.
    env.disk = Arc::new(FixedDisk { free: 300 * MB, other: Some((sb.dirs.root.clone(), backup.bytes - 1)) });
    let r = tegg_import::plan(&small, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control::default()).err();
    assert_eq!(r, Some(ImportError::NoSpace { needed: backup.bytes, free: backup.bytes - 1 }), "the backup folder's volume is one byte short: needed and free are that volume's");
    env.disk = Arc::new(FixedDisk { free: (p.space_bytes * 11).div_ceil(10), other: Some((sb.dirs.root.clone(), backup.bytes)) });
    let other = ok!(tegg_import::plan(&small, SPACE, &Target::Existing(&core), &Mapping::default(), &env, &Control::default()), "both volumes have exactly enough");
    assert_eq!(other.needed_bytes, (p.space_bytes * 11).div_ceil(10), "another volume: the backup isn't added to the target's needed");
    assert_eq!((snapshot(&root), snapshot(&sb.dirs.root)), before, "nothing written by any of these plans");
}

#[test]
fn fr_imp_22_ac1_scan_lists_spaces_with_counts() {
    let sb = sandbox();
    let scan = ok!(scan_of(&fixtures().join("c01-spaces"), &ok!(env(&sb), "env")), "scan c01");
    let spaces: Vec<(String, usize, Vec<(String, usize)>)> = scan.info.spaces.iter().map(|s| (s.name.clone(), s.objects, s.types.iter().map(|t| (t.source_type.clone(), t.objects)).collect())).collect();
    let types = |pages: usize| vec![("Page".to_string(), pages), ("Task".to_string(), 1)];
    assert_eq!(spaces, [("PKM".to_string(), 3, types(2)), ("Work".to_string(), 3, types(2)), ("IDC".to_string(), 2, types(1))], "by object count, largest first, ties by name; type counts by `type:` value in name order");
    assert_eq!((scan.info.name.as_str(), scan.info.files, scan.info.outside_spaces, scan.info.unreadable.len()), ("c01-spaces", 8, 0, 0), "the source's name and file count");
}

#[test]
fn fr_imp_22_ac2_only_the_selected_space_is_imported() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c01-spaces"), "import PKM of c01");
    assert_eq!(run.plan.objects.iter().map(|o| o.source.as_str()).collect::<Vec<_>>(), ["Pages/Links across spaces.md", "Pages/PKM home.md", "Tasks/PKM task.md"], "only PKM's objects are planned");
    let note = "Pages/Links across spaces.md";
    let other = LinkOutcome::OtherSpace { space: "Work".into() };
    assert_eq!(links_of(&run.plan, note).iter().map(|l| (l.written.as_str(), &l.outcome, &l.to)).collect::<Vec<_>>(), [("[[Quarterly plan]]", &other, &None), ("[Work home](../../Work/Pages/Work%20home.md)", &other, &None)], "both links to Work are `other space: Work`");
    let reasons: Vec<&UnresolvedReason> = run.plan.report.unresolved.iter().filter(|r| r.note == note).map(|r| &r.reason).collect();
    assert_eq!(reasons, [&UnresolvedReason::OtherSpace { space: "Work".into() }; 2], "reported as unresolved with the target space's name");
    let written: BTreeSet<String> = files(&run.root).into_iter().filter(|p| !p.starts_with(".tegg/")).collect();
    assert_eq!(written, set(&["Pages/Links across spaces.md", "Pages/PKM home.md", "Tasks/PKM task.md", REPORT]), "only PKM's files are written");
    let text = some!(read_text(&run.root, note), "the linking note");
    assert_eq!(body(&text), "\nSee [[Quarterly plan]] and [Work home](../../Work/Pages/Work%20home.md).\n", "the links stay as the source wrote them");
    let all = snapshot(&run.root).into_values().map(|e| String::from_utf8_lossy(&e.bytes).into_owned()).collect::<String>();
    assert!(!all.contains("Budget.") && !all.contains("IDC task"), "no content of Work or IDC is in the vault");
}
