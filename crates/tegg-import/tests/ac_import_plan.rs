//! Slice I1, L4: the plan (preview), the accounting and the report Page (docs/acceptance/import-capacities.md
//! FR-IMP-05 AC-1…AC-3, AC-5…AC-7, FR-IMP-19 AC-8, AC-12 (report part), NFR-OTH-02 AC-18 (report part); R147, R150;
//! docs/contracts/v1-import.md §5, §5.3, §6, §7.4). The report's own words are checked by catalog **key**: the runs
//! use `ReportStrings` that map every key to `⟦key⟧` (the English texts marked † in §5.3 are not decided). Written
//! from the criteria, the contract and the fixtures only (D-61); every check is an assertion in this file.

mod common;

use std::collections::BTreeSet;

use common::*;
use tegg_import::accounting::{self, Class, ViolationCode};
use tegg_import::{
    AttrChange, FileChange, ImportEnv, KeyReason, LinkOutcome, Mapping, NotExported, ObjectOutcome, PlanTarget, ReportStrings, Target,
};

const R150: [&str; 14] = ["summary", "types", "unresolved", "ambiguous", "caseLinks", "simplified", "attributes", "merged", "dates", "files", "stubs", "skipped", "cleanup", "notExported"];
fn sec(k: &str) -> String {
    format!("⟦section.{k}⟧")
}
/// The environment with catalog keys as the report's words.
fn key_env(sb: &Sandbox) -> Result<ImportEnv, String> {
    let mut e = env(sb)?;
    e.strings = key_strings();
    Ok(e)
}
/// The report with code spans removed (what is left can hold links of the report's own).
fn outside_code(report: &str) -> String {
    let mut out = String::new();
    for l in report.lines() {
        let mut inside = false;
        for part in l.split('`') {
            if !inside {
                out.push_str(part);
            }
            inside = !inside;
        }
        out.push('\n');
    }
    out
}

#[test]
fn fr_imp_05_ac1_plan_carries_the_preview() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    let plan_fixture = |f: &str| {
        let scan = scan_of(&fixtures().join(f), &env)?;
        plan_of(&scan, SPACE, &target, &Mapping::default(), &env)
    };
    // Counts per source type and target type.
    let c05 = ok!(plan_fixture("c05-media-objects"), "plan c05");
    let types: Vec<(&str, usize, Option<&str>, bool)> = c05.types.iter().map(|t| (t.source_type.as_str(), t.objects, t.key.as_deref(), t.new)).collect();
    assert_eq!(types, [("Image", 2, Some("image"), false), ("PDF", 1, Some("pdf"), false), ("Page", 1, Some("page"), false)], "one row per source type, in name order, with its count and target");
    assert_eq!(c05.report.types.iter().map(|t| (t.source_type.as_str(), t.objects, t.target.as_deref(), t.new)).collect::<Vec<_>>(), [("Image", 2, Some("Image"), false), ("PDF", 1, Some("PDF"), false), ("Page", 1, Some("Page"), false)], "the report's Types rows say the same");
    assert_eq!(c05.target, PlanTarget::NewVault { parent: sb.place().to_string_lossy().into_owned(), name: VAULT_NAME.into() }, "the plan names its target");
    assert_eq!((c05.version, c05.space.as_str(), c05.report_path.as_str(), c05.already_imported), (1, SPACE, REPORT, 0), "version, space, the report's path, nothing imported before");
    // The attribute mapping (effective, written in full), dropped files, losses.
    assert_eq!(c05.mapping.version, 1, "the effective mapping has version 1");
    for t in ["Image", "PDF", "Page"] {
        assert!(c05.mapping.types.get(t).is_some_and(|m| m.to.is_some()), "the effective mapping has an entry for {t} with `to` set");
    }
    let image = some!(c05.mapping.types.get("Image"), "the Image mapping");
    for k in ["mimeType", "fileSize", "width", "height", "colors"] {
        assert_eq!(image.attributes.get(k).and_then(|a| a.to.clone()), Some(tegg_import::AttrTarget::Drop), "Image.{k} is dropped by default (D-78), and the mapping says so");
    }
    let dropped: Vec<&str> = c05.report.files.iter().filter_map(|r| match &r.change { FileChange::DroppedReference { written, .. } => Some(written.as_str()), _ => None }).collect();
    assert_eq!(dropped, ["![Preview](./Media/Manual%20preview.png)"], "the dropped files: one reference to a missing file");
    assert_eq!(c05.report.not_exported, [NotExported::QueryDefinitions, NotExported::TagColoursAndCollections, NotExported::Comments], "the losses, always the three");
    assert_eq!(c05.totals.attachments.total, 4, "attachments are counted");
    // Unresolved links and renamed attributes.
    let c09 = ok!(plan_fixture("c09-unresolved-links"), "plan c09");
    assert_eq!(c09.report.unresolved.len(), c09.links.iter().filter(|l| matches!(l.outcome, LinkOutcome::Unresolved)).count(), "one Unresolved row per unresolved link");
    assert_eq!(c09.report.unresolved.len(), 5, "the missing NOTE link, the missing title, the missing path link and the two status links");
    assert_eq!(c09.report.summary.links, c09.totals.links, "the Summary's numbers are the plan's totals");
    let c14 = ok!(plan_fixture("c14-reserved-keys"), "plan c14");
    let renamed: Vec<(&str, &AttrChange)> = c14.report.attributes.iter().filter(|r| matches!(r.change, AttrChange::Renamed { .. })).map(|r| (r.source_key.as_str(), &r.change)).collect();
    assert_eq!(renamed, [("source", &AttrChange::Renamed { key: "source-text".into(), reason: KeyReason::Reserved }), ("file", &AttrChange::Renamed { key: "file-text".into(), reason: KeyReason::Reserved })], "the renamed attributes, in source order");
    // No "dates without a year" in a Capacities plan (D-1522): the plan has no such decision.
    assert!(c14.decisions.case_links.is_empty() && c14.decisions.ambiguous.is_empty() && c14.decisions.tag_like.is_empty(), "nothing to decide for c14");
}

#[test]
fn fr_imp_05_ac2_a_dropped_plan_leaves_the_vault_byte_identical() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let before = snapshot(&root);
    let scan = ok!(scan_of(&fixtures().join("c02-typed-frontmatter"), &env), "scan");
    let plan = ok!(plan_of(&scan, SPACE, &Target::Existing(&core), &Mapping::default(), &env), "plan into the open vault");
    assert_eq!(plan.target, PlanTarget::Existing { name: "Můj trezor".into(), notes: 5 }, "the plan names the vault and its 5 notes");
    assert!(plan.objects.iter().any(|o| o.path.as_deref() == Some("Books/Book 1 (2).md")), "the plan is the full answer (it names the collision's path)");
    drop(plan);
    assert_eq!(snapshot(&root), before, "a plan that is dropped (Cancel in the preview) leaves the vault byte-identical");
    assert!(core.jobs().interrupted().is_empty(), "and no job was created");
}

#[test]
fn fr_imp_05_ac5_plan_writes_nothing() {
    let sb = sandbox();
    let env = ok!(env(&sb), "env");
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let paths = |d: &std::path::Path| snapshot(d).into_keys().collect::<BTreeSet<_>>();
    let before = (snapshot(&root), snapshot(&sb.place()), paths(&sb.dirs.root), snapshot(&fixtures()).len());
    for fixture in FIXTURES {
        let scan = ok!(scan_of(&fixtures().join(fixture), &env), format!("scan {fixture}"));
        let a = ok!(plan_of(&scan, SPACE, &new_target(&sb), &Mapping::default(), &env), format!("{fixture}: plan against a new vault"));
        let b = ok!(plan_of(&scan, SPACE, &Target::Existing(&core), &Mapping::default(), &env), format!("{fixture}: plan against the existing vault"));
        assert!(!a.objects.is_empty() && a.objects.len() == b.objects.len(), "{fixture}: both plans list the space's objects");
        let after = (snapshot(&root), snapshot(&sb.place()), paths(&sb.dirs.root), snapshot(&fixtures()).len());
        assert_eq!(after.0, before.0, "{fixture}: no file of the existing vault changed (bytes, mtime, inode), none was created");
        assert_eq!(after.1, before.1, "{fixture}: no file and no folder was created in the new vault's place");
        assert_eq!(after.2, before.2, "{fixture}: nothing was written to Application Support");
        assert_eq!(after.3, before.3, "{fixture}: nothing was created in the source");
    }
}

#[test]
fn fr_imp_05_ac6_imported_plus_reported_is_total() {
    // §6.1: the accounting module shares no code with the planner, the layout or the scanner's classification.
    let text = std::fs::read_to_string(repo_root().join("crates/tegg-import/src/accounting.rs")).unwrap_or_default();
    assert!(!text.is_empty(), "crates/tegg-import/src/accounting.rs exists");
    for l in text.lines().filter(|l| l.trim_start().starts_with("use ") || l.contains("crate::")) {
        for banned in ["layout", "planner", "mapping", "note::", "dates"] {
            assert!(!l.contains(banned), "accounting.rs doesn't use {banned}: {l}");
        }
    }
    for fixture in FIXTURES {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let t = &run.plan.totals;
        for (what, tally) in [("objects", &t.objects), ("attachments", &t.attachments), ("links", &t.links)] {
            assert_eq!(tally.imported + tally.reported, tally.total, "{fixture}: imported + reported = total for {what}");
        }
        let raw = accounting::totals(&run.scan.source, SPACE);
        assert_eq!((raw.objects, raw.attachments, raw.links), (t.objects.total, t.attachments.total, t.links.total), "{fixture}: the independent totals agree with the plan's");
        let notes = run.plan.objects.iter().filter(|o| o.kind != tegg_import::ObjectKind::OrphanMedia).count();
        assert_eq!((notes, run.plan.attachments.len(), run.plan.links.len()), (raw.objects, raw.attachments, raw.links), "{fixture}: every item is in the plan (objects: every .md of the space; a D-77 media object is planned next to them)");
        assert_eq!(accounting::check_plan(&run.scan.source, &run.plan), Vec::new(), "{fixture}: the check passes on the plan");
        assert_eq!(accounting::check_vault(&run.scan.source, &run.plan, &run.root), Vec::new(), "{fixture}: the check passes on the written vault");
    }
    // The independent counter on known texts (§6.5).
    let tvary = std::fs::read_to_string(fixtures().join("c22-link-shapes/PKM/Pages/Tvary odkazů.md")).expect("setup: fixture");
    assert_eq!(accounting::count_links(&tvary), 6, "the counter finds the 6 links of Tvary odkazů outside code");
    assert_eq!(accounting::count_links("---\nstatus: '[[in progress]]'\nurl: https://example.com\n---\n\n<https://example.com> `[[kód]]` \\[\\[ne]] [text][ref]\n"), 1, "frontmatter links count; autolinks, code, escapes and reference links don't");

    // The check itself is tested: a plan changed on purpose makes it fail.
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05");
    let codes = |p: &tegg_import::Plan| accounting::check_plan(&run.scan.source, p).into_iter().map(|v| (v.class, v.code)).collect::<Vec<_>>();
    let mut lost_object = run.plan.clone();
    lost_object.objects.retain(|o| o.source != "Pages/Trip notes.md");
    assert!(codes(&lost_object).iter().any(|(c, _)| *c == Class::Objects), "a lost object fails the check: {:?}", codes(&lost_object));
    let mut lost_attachment = run.plan.clone();
    lost_attachment.attachments.retain(|a| a.source != "Images/Media/Untitled (44).png");
    assert!(codes(&lost_attachment).iter().any(|(c, _)| *c == Class::Attachments), "a lost attachment fails the check");
    let mut lost_link = run.plan.clone();
    lost_link.links.pop();
    assert!(codes(&lost_link).iter().any(|(c, _)| *c == Class::Links), "a lost link fails the check");
    let mut lost_row = run.plan.clone();
    let n = lost_row.report.unresolved.len();
    lost_row.report.unresolved.retain(|r| r.written != "![Preview](./Media/Manual%20preview.png)");
    assert_eq!(lost_row.report.unresolved.len() + 1, n, "setup: the dropped file's row was in the plan");
    assert!(codes(&lost_row).contains(&(Class::Links, ViolationCode::MissingRow)), "a lost dropped-file row fails the check with MissingRow");
    let mut miscounted = run.plan.clone();
    miscounted.totals.objects.imported += 1;
    assert!(codes(&miscounted).contains(&(Class::Objects, ViolationCode::SumMismatch)), "imported + reported ≠ total fails with SumMismatch");
    let mut doubled = run.plan.clone();
    doubled.objects.push(doubled.objects[0].clone());
    assert!(codes(&doubled).contains(&(Class::Objects, ViolationCode::DuplicateItem)), "an object planned twice fails with DuplicateItem");
    // A file taken from another space.
    let sb2 = sandbox();
    let c01 = ok!(import_fixture(&sb2, "c01-spaces"), "import c01");
    let mut foreign = c01.plan.clone();
    foreign.objects[0].source = "../Work/Pages/Work home.md".into();
    let v = accounting::check_plan(&c01.scan.source, &foreign);
    assert!(v.iter().any(|v| v.code == ViolationCode::ForeignItem), "an object from another space fails with ForeignItem: {v:?}");
    // On the written vault: a planned file that isn't there, and a file of the run that the plan doesn't name.
    let moved = "Pages/Trip notes.md";
    let bytes = some!(read_bytes(&run.root, moved), "the written note");
    std::fs::remove_file(run.root.join(moved)).expect("setup: remove");
    let v = accounting::check_vault(&run.scan.source, &run.plan, &run.root);
    assert!(v.iter().any(|v| v.code == ViolationCode::NotWritten), "a planned object missing from the vault fails with NotWritten: {v:?}");
    write_raw(&run.root, "Pages/Navíc.md", &bytes);
    write_raw(&run.root, moved, &bytes);
    let v = accounting::check_vault(&run.scan.source, &run.plan, &run.root);
    assert!(v.iter().any(|v| v.code == ViolationCode::WrittenNotPlanned), "a file with an import-id of this run outside the plan fails with WrittenNotPlanned: {v:?}");
}

#[test]
fn fr_imp_05_ac7_plan_equals_result() {
    for fixture in FIXTURES {
        let sb = sandbox();
        let run = ok!(import_new(&sb, &fixtures().join(fixture), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), format!("import {fixture}"));
        let plan = &run.plan;
        // The set of files: the plan's paths plus the report (and the vault's own .tegg files).
        let mut want: BTreeSet<String> = plan.objects.iter().filter_map(|o| o.path.clone()).chain(plan.attachments.iter().filter_map(|a| a.path.clone())).collect();
        want.insert(plan.report_path.clone());
        let got: BTreeSet<String> = files(&run.root).into_iter().filter(|p| !p.starts_with(".tegg/")).collect();
        assert_eq!(got, want, "{fixture}: the written files are the plan's paths plus the report");
        assert_eq!(run.report.written.iter().cloned().collect::<BTreeSet<_>>(), files(&run.root), "{fixture}: the run's `written` list is every file of the new vault");
        assert_eq!(run.report.written.last(), Some(&plan.report_path), "{fixture}: the report is written last");
        assert_eq!((run.report.totals.clone(), run.report.report_path.clone()), (plan.totals.clone(), Some(plan.report_path.clone())), "{fixture}: the run's totals and report path are the plan's");
        let new_types: BTreeSet<String> = plan.types.iter().filter(|t| t.new).filter_map(|t| t.key.clone()).map(|k| format!(".tegg/types/{k}.yml")).collect();
        let written_types: BTreeSet<String> = files(&run.root).into_iter().filter(|p| p.starts_with(".tegg/types/")).filter(|p| !["page", "task", "daily-note", "quick-note", "tag", "image", "pdf"].iter().any(|s| *p == format!(".tegg/types/{s}.yml"))).collect();
        assert_eq!(written_types, new_types, "{fixture}: one type file per type the plan calls new");
        // The report's Summary and Types numbers are the plan's.
        let report = some!(read_text(&run.root, &plan.report_path), format!("{fixture}: the report Page"));
        let summary = rows(&report, &sec("summary"));
        for (label, t) in [("objects", &plan.totals.objects), ("attachments", &plan.totals.attachments), ("links", &plan.totals.links)] {
            let row = format!("⟦summary.{label}⟧ · {} ⟦summary.imported⟧ · {} ⟦summary.reported⟧ · {} ⟦summary.total⟧", t.imported, t.reported, t.total);
            assert!(summary.contains(&row), "{fixture}: the Summary row {row:?}: {summary:?}");
        }
        let type_rows = rows(&report, &sec("types"));
        assert_eq!(type_rows.len(), plan.types.len(), "{fixture}: one Types row per source type");
        for (row, t) in type_rows.iter().zip(&plan.types) {
            assert!(row.starts_with(&format!("{} · {} · ", t.source_type, t.objects)), "{fixture}: the Types row of {} starts with its name and count: {row}", t.source_type);
            assert_eq!(row.ends_with("⟦word.new⟧"), t.new, "{fixture}: `new` exactly when the plan created the type: {row}");
        }
        // Each link: a resolved one is in the written note, a reported one in its report section.
        let quoted = |section: &str, written: &str| rows(&report, &sec(section)).iter().any(|r| r.contains(&format!("`{written}`")) || r.contains(&format!("`` {written} ``")));
        for l in &plan.links {
            let at = format!("{fixture}: {} link {} {:?}", l.note, l.n, l.written);
            let note_path = path_of(plan, &l.note);
            match &l.outcome {
                LinkOutcome::Resolved | LinkOutcome::Ambiguous | LinkOutcome::CaseMismatch { confirmed: true } => {
                    let to = some!(l.to.clone(), format!("{at}: a bound link names its target"));
                    assert!(want.contains(&to), "{at}: its target {to} is a planned path");
                    let text = some!(note_path.as_deref().and_then(|p| read_text(&run.root, p)), format!("{at}: the linking note is written"));
                    let stem = to.rsplit('/').next().unwrap_or("").trim_end_matches(".md").to_string();
                    let no_ext = to.trim_end_matches(".md").to_string();
                    let hit = wikilink_targets(&text).iter().any(|t| *t == stem || *t == no_ext) || text.contains(&format!("]({stem}.md)")) || text.contains(&format!("{}.md)", stem.replace(' ', "%20")));
                    assert!(hit, "{at}: the written note links to {to}");
                    if matches!(l.outcome, LinkOutcome::Ambiguous) {
                        assert!(plan.report.ambiguous.iter().any(|r| r.note == l.note && r.n == l.n), "{at}: an ambiguous link is also a report row");
                    }
                }
                LinkOutcome::DateMention | LinkOutcome::Attachment | LinkOutcome::External | LinkOutcome::SelectValue => {}
                LinkOutcome::Unresolved | LinkOutcome::OtherSpace { .. } | LinkOutcome::MissingFile | LinkOutcome::InSkippedNote | LinkOutcome::TargetNotImported => {
                    assert!(plan.report.unresolved.iter().any(|r| r.note == l.note && r.n == l.n && r.written == l.written), "{at}: it has its Unresolved row in the plan");
                    assert!(quoted("unresolved", &l.written), "{at}: and in the report's Unresolved links section, quoted");
                }
                LinkOutcome::CaseMismatch { confirmed: false } => {
                    assert!(plan.report.case_links.iter().any(|r| r.note == l.note && r.n == l.n), "{at}: it has its case-links row in the plan");
                    assert!(quoted("caseLinks", &l.written), "{at}: and in the report's section, quoted");
                }
            }
        }
        assert_eq!(rows(&report, &sec("unresolved")).len(), plan.report.unresolved.len(), "{fixture}: as many Unresolved rows in the Page as in the plan");
    }
}

#[test]
fn fr_imp_05_ac3_the_report_is_saved_as_a_page_with_links() {
    let sb = sandbox();
    let run = ok!(import_new(&sb, &fixtures().join("c14-reserved-keys"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import c14");
    let report = some!(read_text(&run.root, REPORT), "Pages/Import report 2026-11-12 PKM.md");
    assert_eq!(fm(&report), [("id", id(2).as_str()), ("type", "page"), ("title", "Import report 2026-11-12 PKM"), ("created", NOW), ("modified", NOW)].map(|(k, v)| (k.to_string(), v.to_string())), "a Page titled as its file, with the last id and the import time");
    let attrs = rows(&report, &sec("attributes"));
    assert!(attrs.contains(&"Idea · `source` · ⟦attr.renamed⟧ · `source-text` · ⟦key.reserved⟧".to_string()), "the renamed attribute is listed (FR-TYP-15 AC-1): {attrs:?}");
    assert!(attrs.contains(&"Idea · `file` · ⟦attr.renamed⟧ · `file-text` · ⟦key.reserved⟧".to_string()), "and `file` → `file-text`: {attrs:?}");
    assert_eq!(rows(&report, &sec("types")), ["Idea · 1 · Idea · ⟦word.new⟧"], "the Types row");
    assert_eq!(rows(&report, &sec("notExported")), ["⟦notExported.queries⟧", "⟦notExported.tags⟧", "⟦notExported.comments⟧"], "the losses");
    assert_eq!(rows(&report, &sec("dates")), Vec::<String>::new(), "no Dates row: the one object has its createdAt");
}

#[test]
fn fr_imp_19_ac8_report_page() {
    // (fixture, sections that must be there, sections that must not)
    let cases: [(&str, &[&str], &[&str]); 4] = [
        ("c09-unresolved-links", &["summary", "types", "unresolved", "attributes", "dates", "notExported"], &["ambiguous", "caseLinks", "simplified", "merged", "files", "stubs", "skipped", "cleanup"]),
        ("c10-duplicate-titles", &["summary", "types", "ambiguous", "files", "notExported"], &["unresolved", "caseLinks", "simplified", "merged", "stubs", "skipped", "cleanup"]),
        ("c05-media-objects", &["summary", "types", "unresolved", "attributes", "files", "notExported"], &["ambiguous", "caseLinks", "simplified", "merged", "stubs", "skipped", "cleanup"]),
        ("c14-reserved-keys", &["summary", "types", "attributes", "notExported"], &["unresolved", "ambiguous", "caseLinks", "simplified", "merged", "dates", "files", "stubs", "skipped", "cleanup"]),
    ];
    for (fixture, present, absent) in cases {
        let sb = sandbox();
        let run = ok!(import_new(&sb, &fixtures().join(fixture), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), format!("import {fixture}"));
        assert_eq!(run.plan.report_path, REPORT, "{fixture}: the report's path");
        let report = some!(read_text(&run.root, REPORT), format!("{fixture}: the report file"));
        assert_eq!(fm_keys(&report), ["id", "type", "title", "created", "modified"], "{fixture}: a Page with an id and no import-id");
        assert_eq!((fm_get(&report, "type").as_deref(), fm_get(&report, "title").as_deref()), (Some("page"), Some("Import report 2026-11-12 PKM")), "{fixture}: type and title");
        let heads = sections(&report);
        let order: Vec<String> = R150.iter().map(|k| sec(k)).filter(|h| heads.contains(h)).collect();
        assert_eq!(heads, order, "{fixture}: R150's sections, in its order, each once");
        for k in present {
            assert!(heads.contains(&sec(k)), "{fixture}: the section {k} is there: {heads:?}");
            assert!(!rows(&report, &sec(k)).is_empty(), "{fixture}: with at least one row");
        }
        for k in absent {
            assert!(!heads.contains(&sec(k)), "{fixture}: the empty section {k} is left out: {heads:?}");
        }
        // Every link of the report resolves to an imported object; quoted source text adds no link.
        let core = ok!(open_core(&run.root, &sb.dirs), format!("{fixture}: open the written vault"));
        let imported: BTreeSet<String> = run.plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).filter_map(|o| o.path.clone()).collect();
        let targets = wikilink_targets(&outside_code(&report));
        assert!(!targets.is_empty(), "{fixture}: the report's rows link to objects");
        for t in &targets {
            let to = resolves(&core, REPORT, t);
            assert!(to.as_ref().is_some_and(|p| imported.contains(p)), "{fixture}: the report's link [[{t}]] resolves to an imported object, got {to:?}");
        }
        let broken = core.broken_links();
        let from_report = broken.groups.iter().filter(|g| format!("{g:?}").contains("Import report")).count();
        assert_eq!(from_report, 0, "{fixture}: the report adds no broken link of its own");
        for r in &run.plan.report.unresolved {
            assert!(report.contains(&format!("`{}`", r.written)), "{fixture}: the link text {:?} is quoted in a code span", r.written);
        }
    }
    // Rows of c09 and c10, by key.
    let sb = sandbox();
    let c09 = ok!(import_new(&sb, &fixtures().join("c09-unresolved-links"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import c09");
    let report = some!(read_text(&c09.root, REPORT), "the c09 report");
    assert_eq!(rows(&report, &sec("unresolved")), [
        "[[2026-02-01]] · `[[NOTE/3f2c9a1e-0000-4000-8000-000000000001]]` · ⟦reason.notInExport⟧",
        "[[2026-02-01]] · `[[Never exported]]` · ⟦reason.notInExport⟧",
        "[[Lisbon]] · `[[in progress]]` · ⟦reason.notInExport⟧",
        "[[Lisbon]] · `[Missing](../Pages/Gone.md)` · ⟦reason.notInExport⟧",
        "[[Oslo]] · `[[planned]]` · ⟦reason.notInExport⟧",
    ], "c09's Unresolved links rows: the linking object, the link text as written, the reason; by note, then position");
    assert_eq!(rows(&report, &sec("summary"))[..3], ["⟦summary.source⟧ · `c09-unresolved-links`", "⟦summary.space⟧ · PKM", "⟦summary.date⟧ · 2026-11-12"], "the Summary starts with source, space and the import day");
    let sb = sandbox();
    let c10 = ok!(import_new(&sb, &fixtures().join("c10-duplicate-titles"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import c10");
    let report = some!(read_text(&c10.root, REPORT), "the c10 report");
    let first = some!(path_of(&c10.plan, "Meetings/Tomáš  Eva (1).md"), "the first meeting by source path").trim_end_matches(".md").to_string();
    let amb = rows(&report, &sec("ambiguous"));
    assert_eq!(amb.len(), 1, "one ambiguous link: {amb:?}");
    assert!(amb[0].starts_with("[[Tomáš]] · `Tomáš : Eva` · [[") && amb[0].contains(&first), "the linking object, the title, the object chosen (the first by source path, D-76): {amb:?}");

    // A second import on the same day gets ` (2)`.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(key_env(&sb), "env");
    let one = ok!(import_into(&core, &root, &fixtures().join("c09-unresolved-links"), SPACE, &Mapping::default(), &env), "first import");
    let two = ok!(import_into(&core, &root, &fixtures().join("c09-unresolved-links"), SPACE, &Mapping::default(), &env), "second import");
    assert_eq!((one.plan.report_path.as_str(), two.plan.report_path.as_str()), (REPORT, "Pages/Import report 2026-11-12 PKM (2).md"), "the second report of the day");
    let second = some!(read_text(&root, "Pages/Import report 2026-11-12 PKM (2).md"), "the second report file");
    assert_eq!(fm_get(&second, "title").as_deref(), Some("Import report 2026-11-12 PKM (2)"), "its title is the file name without .md");
}

#[test]
fn fr_imp_19_ac12_no_undo_is_said_plainly() {
    // Into an existing vault with a backup: the Summary holds the sentence and the zip's file name.
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let env = ok!(key_env(&sb), "env");
    let run = ok!(import_into(&core, &root, &fixtures().join("c01-spaces"), SPACE, &Mapping::default(), &env), "import c01 into the vault");
    let zip = some!(run.report.backup.clone(), "the run made a backup and names the zip");
    assert!(zip.ends_with("-import.zip"), "the zip's name: {zip}");
    let report = some!(read_text(&root, &run.plan.report_path), "the report");
    let summary = report.split("## ").find(|s| s.starts_with(&sec("summary"))).unwrap_or("").to_string();
    assert!(summary.contains(&format!("⟦noUndo⟧ `{zip}`")), "the Summary ends with import.report.noUndo and the backup zip's file name: {summary}");
    assert!(core.jobs().interrupted().is_empty(), "nothing is left to undo: a finished import removes its journal");
    // English: the sentence R155 gives (not a † text).
    let sb = sandbox();
    let root = existing_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs), "open the existing vault");
    let mut english = ok!(common::env(&sb), "env");
    english.strings = ReportStrings::english();
    let run = ok!(import_into(&core, &root, &fixtures().join("c01-spaces"), SPACE, &Mapping::default(), &english), "import with English strings");
    let report = some!(read_text(&root, &run.plan.report_path), "the report");
    assert!(report.contains("This import can’t be undone. A backup from before it is in Settings › Backups. Restoring it brings back your earlier files and leaves the imported ones in place. `"), "R155's sentence, followed by the zip's name");

    // No backup: a new vault, and an existing vault with no object file.
    let sb = sandbox();
    let new = ok!(import_new(&sb, &fixtures().join("c01-spaces"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import into a new vault");
    assert_eq!(new.report.backup, None, "no backup for a new vault");
    assert!(!some!(read_text(&new.root, REPORT), "the report").contains("noUndo"), "a new vault's report doesn't hold the sentence");
    let sb = sandbox();
    let bare = sb.base.join("Prázdný trezor");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &bare.join(".tegg"), &[]);
    let core = ok!(open_core(&bare, &sb.dirs), "open the empty vault");
    let run = ok!(import_into(&core, &bare, &fixtures().join("c01-spaces"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import into the empty vault");
    assert_eq!(run.report.backup, None, "no backup for a vault with no object file");
    assert!(!some!(read_text(&bare, REPORT), "the report").contains("noUndo"), "and no sentence in its report");
}

#[test]
fn nfr_oth_02_ac18_report_words_come_from_the_catalog() {
    let sb = sandbox();
    let run = ok!(import_new(&sb, &fixtures().join("c05-media-objects"), SPACE, &Mapping::default(), &ok!(key_env(&sb), "env")), "import c05 with the pseudo-locale");
    let report = some!(read_text(&run.root, REPORT), "the report");
    let heads = sections(&report);
    assert!(heads.len() >= 5 && heads.iter().all(|h| h.starts_with("⟦section.") && h.ends_with('⟧')), "every section name is inside ⟦ ⟧: {heads:?}");
    // Every word of a row that isn't content (objects, quoted text, type names, numbers, code points) is inside ⟦ ⟧.
    for l in report.lines().filter(|l| l.starts_with("- ")) {
        let mut rest = outside_code(l);
        while let (Some(a), Some(b)) = (rest.find('⟦'), rest.find('⟧')) {
            rest.replace_range(a..b + '⟧'.len_utf8(), "");
        }
        while let (Some(a), Some(b)) = (rest.find("[["), rest.find("]]")) {
            rest.replace_range(a..b + 2, "");
        }
        let words: Vec<&str> = rest.split(|c: char| !c.is_alphabetic()).filter(|w| w.len() > 1 && !["Image", "PDF", "Page", "PKM", "image", "pdf", "text", "number"].contains(w)).collect();
        assert_eq!(words, Vec::<&str>::new(), "no text outside the catalog in the row {l:?}");
    }
    for english in ["Summary", "Types", "Unresolved links", "Attributes", "Files", "Not in the export", "imported", "reported", "total", "missing file", "dropped"] {
        assert!(!outside_code(&report).lines().filter(|l| l.starts_with("## ") || l.starts_with("- ")).any(|l| l.split(" · ").any(|f| f == english || f.ends_with(&format!(" {english}")))), "no English catalog text {english:?} with the pseudo-locale");
    }
    // With the English catalog the section names are R150's.
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c05-media-objects"), "import c05 in English");
    let report = some!(read_text(&run.root, REPORT), "the report");
    assert_eq!(sections(&report), ["Summary", "Types", "Unresolved links", "Attributes", "Files", "Not in the export"], "R150's section names, from the catalog (`ReportStrings::english()`)");
    assert!(rows(&report, "Not in the export") == ["Query definitions", "Tag colours and collections", "Comments"], "R150's fixed statements");
    // A missing key is written as the key itself (§2).
    let sb = sandbox();
    let mut bare = ok!(env(&sb), "env");
    bare.strings = ReportStrings(Default::default());
    let run = ok!(import_new(&sb, &fixtures().join("c14-reserved-keys"), SPACE, &Mapping::default(), &bare), "import with an empty catalog");
    let report = some!(read_text(&run.root, REPORT), "the report");
    assert!(sections(&report).iter().all(|h| h.contains("section.")), "with an empty catalog a section name is its key: {:?}", sections(&report));
}
