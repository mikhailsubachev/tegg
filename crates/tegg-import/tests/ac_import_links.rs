//! Slice I1, L4: links, titles and file names, query stubs (docs/acceptance/import-capacities.md FR-IMP-10
//! AC-1…AC-12, FR-IMP-11 AC-1…AC-6, FR-IMP-16 AC-1…AC-3; docs/contracts/v1-import.md §5.2, §6.5, §8). Links are read
//! by `@tegg/doc` (`import-scan`, D-1551) and written in Tegg's own link form (D-184); resolution is checked in the
//! written vault's index (ms4-links §1). Written from the criteria, the contract and the fixtures only (D-61); every
//! check is an assertion in this file.

mod common;

use std::collections::BTreeSet;
use std::path::Path;

use common::*;
use tegg_format::{nfc, sanitize_file_stem};
use tegg_import::{FileChange, LinkForm, LinkOutcome, LinkPlace, Mapping, NameChange, ObjectKind, ObjectOutcome, UnresolvedReason};

fn written(run: &Imported, source: &str) -> Option<String> {
    path_of(&run.plan, source).and_then(|p| read_text(&run.root, &p))
}
fn import_src(sb: &Sandbox, src: &Path) -> Result<Imported, String> {
    import_new(sb, src, SPACE, &Mapping::default(), &env(sb)?)
}
fn unquoted(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim_matches('"').to_string())
}
fn nfd_tomas() -> &'static str {
    "Toma\u{301}s\u{30c}"
}

// ------------------------------------------------------------------------------------------------ FR-IMP-10

#[test]
fn fr_imp_10_ac1_wikilinks_bind_by_source_file() {
    let sb = sandbox();
    let src = source(&sb, "c06-weblinks");
    append(&src, "PKM/Pages/Reading list.md", "\nTaké [[Rust book|kniha o Rustu]].\n");
    let run = ok!(import_src(&sb, &src), "import c06");
    assert_eq!(body(&some!(written(&run, "Pages/Reading list.md"), "Reading list")), "\n[[Rust book]]\n\nTaké [[Rust book|kniha o Rustu]].\n", "[[Title]] and [[Title|alias]] are wikilinks to the imported file");
    for l in links_of(&run.plan, "Pages/Reading list.md") {
        assert_eq!((&l.outcome, l.to.as_deref(), &l.form), (&LinkOutcome::Resolved, Some("Pages/Rust book.md"), &LinkForm::Wikilink), "{}: resolved to the imported Weblink's Page", l.written);
    }
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Pages/Reading list.md", "Rust book").as_deref(), Some("Pages/Rust book.md"), "it resolves in Tegg's index");
    drop(core);
    // A target whose file name differs from its title: the link follows the file (c11).
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    let stem = sanitize_file_stem("1:1 2026-03-19 Jana");
    assert_eq!(stem, "1 1 2026-03-19 Jana", "setup: the stem of the title (AP-2)");
    assert_eq!(body(&some!(written(&run, "People/Jana.md"), "Jana")), format!("\n[[{stem}|1:1 2026-03-19 Jana]]\n"), "the link names the file and keeps the title as its text (D-184)");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "People/Jana.md", &stem), Some(format!("Meetings/{stem}.md")), "and resolves to the meeting");
}

#[test]
fn fr_imp_10_ac2_relative_markdown_links_become_wikilinks() {
    let sb = sandbox();
    let src = source(&sb, "c12-task-dates");
    append(&src, "PKM/Tasks/Write report.md", "Navazuje na [text](../Tasks/Plan%20the%20release.md).\n");
    let run = ok!(import_src(&sb, &src), "import c12 with a path link");
    assert!(some!(written(&run, "Tasks/Write report.md"), "Write report").ends_with("\nNavazuje na [[Plan the release|text]].\n"), "`[text](../Tasks/Plan%20the%20release.md)` → `[[Plan the release|text]]`");
    let l = some!(link(&run.plan, "Tasks/Write report.md", "[text](../Tasks/Plan%20the%20release.md)"), "the planned link");
    assert_eq!((l.form.clone(), l.target.as_str(), l.outcome.clone(), l.to.as_deref()), (LinkForm::Markdown, "../Tasks/Plan the release.md", LinkOutcome::Resolved, Some("Tasks/Plan the release.md")), "the destination decoded, bound to the Task");
    // Other escapes (c10): diacritics and unencoded parentheses.
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c10-duplicate-titles"), "import c10");
    let second = some!(path_of(&run.plan, "Meetings/Tomáš  Eva (1).md"), "the meeting exported as `… (1).md`");
    let stem = second.trim_start_matches("Meetings/").trim_end_matches(".md").to_string();
    let text = some!(written(&run, "People/Tomáš.md"), "Tomáš");
    assert!(text.contains(&format!("\n[[{stem}|Tomáš : Eva]]\n")), "the path link is a wikilink to that file with the link's text: {text}");
}

#[test]
fn fr_imp_10_ac3_date_links_become_daily_note_links() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c09-unresolved-links"), "import c09");
    let l = some!(link(&run.plan, "DailyNotes/2026-02-01.md", "[[Date/2026-02-03]]"), "the date link");
    assert_eq!(l.outcome, LinkOutcome::DateMention, "a date mention, also with no Daily Note of that date in the export");
    assert!(!run.plan.report.unresolved.iter().any(|r| r.written == "[[Date/2026-02-03]]"), "it isn't unresolved");
    assert!(some!(written(&run, "DailyNotes/2026-02-01.md"), "the day").contains("Mentioned [[2026-02-03]] and"), "written as [[2026-02-03]]");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let broken: Vec<String> = core.broken_links().groups.iter().map(|g| g.key.clone()).collect();
    assert!(!broken.iter().any(|k| k.contains("2026-02-03")), "the date link is not a broken link (it opens the virtual Daily Note): {broken:?}");
}

#[test]
fn fr_imp_10_ac4_unresolvable_targets_are_kept_and_reported() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c09-unresolved-links"), "import c09");
    let note = "DailyNotes/2026-02-01.md";
    let uuid = "[[NOTE/3f2c9a1e-0000-4000-8000-000000000001]]";
    assert_eq!(some!(link(&run.plan, note, uuid), "the NOTE link").outcome, LinkOutcome::Unresolved, "unresolved");
    assert!(some!(written(&run, note), "the day").contains(&format!("a missing {uuid}.")), "kept as text");
    let rows: Vec<(&str, &str, &UnresolvedReason)> = run.plan.report.unresolved.iter().filter(|r| r.note == note).map(|r| (r.note.as_str(), r.written.as_str(), &r.reason)).collect();
    assert_eq!(rows, [(note, uuid, &UnresolvedReason::NotInExport), (note, "[[Never exported]]", &UnresolvedReason::NotInExport)], "listed in the report with the source note");
}

#[test]
fn fr_imp_10_ac5_relation_attributes_point_at_the_imported_object() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    let meeting = some!(written(&run, "Meetings/11 2026-03-19 Jana.md"), "the meeting");
    assert_eq!(fm_get(&meeting, "peopleInvolved").as_deref(), Some("\"[[Jana]]\""), "`'[[Jana]]'` → `\"[[Jana]]\"`");
    let l = some!(link(&run.plan, "Meetings/11 2026-03-19 Jana.md", "[[Jana]]"), "the relation's link");
    assert_eq!((l.place.clone(), l.outcome.clone(), l.to.as_deref()), (LinkPlace::Frontmatter { key: "peopleInvolved".into() }, LinkOutcome::Resolved, Some("People/Jana.md")), "a frontmatter link bound to the Person titled `Jana ` (trimmed)");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, &some!(path_of(&run.plan, "Meetings/11 2026-03-19 Jana.md"), "path"), "Jana").as_deref(), Some("People/Jana.md"), "it resolves to the imported Person");
}

#[test]
fn fr_imp_10_ac6_ambiguous_and_case_only_links() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c10-duplicate-titles"), "import c10");
    let first = "Meetings/Tomáš  Eva (1).md"; // the first by source path ("(" sorts before ".")
    let l = some!(link(&run.plan, "People/Tomáš.md", "[[Tomáš : Eva]]"), "the title link");
    assert_eq!((l.outcome.clone(), l.to.clone()), (LinkOutcome::Ambiguous, path_of(&run.plan, first)), "ambiguous, bound to the first by source path (D-76)");
    assert_eq!(run.plan.report.ambiguous.iter().map(|r| (r.note.as_str(), r.title.as_str(), r.chosen.as_str())).collect::<Vec<_>>(), [("People/Tomáš.md", "Tomáš : Eva", first)], "listed as ambiguous with the object chosen");
    let d = &run.plan.decisions.ambiguous;
    assert_eq!(d.iter().map(|a| (a.candidates.clone(), a.chosen.as_str())).collect::<Vec<_>>(), [(strs(&[first, "Meetings/Tomáš  Eva.md"]), first)], "the plan's candidates, in path order");
    assert_eq!((run.plan.totals.links.total, run.plan.totals.links.imported, run.plan.totals.links.reported), (2, 1, 1), "an ambiguous link is written as a link and counted as reported (R147)");

    // A match that differs only in case: shown for confirmation, not resolved (D-81).
    let sb = sandbox();
    let src = source(&sb, "c20-file-name-edges");
    edit(&src, "PKM/Pages/Odkazy.md", "Odkaz: [[Tomáš]]", "Odkaz: [[tomáš]]");
    let run = ok!(import_src(&sb, &src), "import c20 with a case-only link");
    let l = some!(link(&run.plan, "Pages/Odkazy.md", "[[tomáš]]"), "the case-only link");
    assert_eq!((l.outcome.clone(), l.to.clone()), (LinkOutcome::CaseMismatch { confirmed: false }, None), "a case mismatch, not bound");
    let c = &run.plan.decisions.case_links;
    assert_eq!(c.iter().map(|c| (c.note.as_str(), c.written.as_str(), c.target.as_str(), c.candidate.as_str(), c.candidate_title.as_str(), c.confirmed)).collect::<Vec<_>>(), [("Pages/Odkazy.md", "[[tomáš]]", "tomáš", "People/Tomáš.md", "Tomáš", false)], "shown in the preview for confirmation");
    assert!(some!(written(&run, "Pages/Odkazy.md"), "Odkazy").contains("Odkaz: [[tomáš]]\n"), "written as in the source");
    assert_eq!(run.plan.report.case_links.iter().map(|r| (r.written.as_str(), r.candidate.as_str(), r.confirmed)).collect::<Vec<_>>(), [("[[tomáš]]", "People/Tomáš.md", false)], "reported as left unresolved");
    // Confirmed by the mapping: resolved and reported as confirmed.
    let sb2 = sandbox();
    let src = source(&sb2, "c20-file-name-edges");
    edit(&src, "PKM/Pages/Odkazy.md", "Odkaz: [[Tomáš]]", "Odkaz: [[tomáš]]");
    let m = ok!(mapping(r#"{"caseLinks":[{"note":"Pages/Odkazy.md","target":"tomáš","use":true}]}"#), "the mapping");
    let run = ok!(import_new(&sb2, &src, SPACE, &m, &ok!(env(&sb2), "env")), "import with the link confirmed");
    let l = some!(link(&run.plan, "Pages/Odkazy.md", "[[tomáš]]"), "the case-only link");
    assert_eq!((l.outcome.clone(), l.to.as_deref()), (LinkOutcome::CaseMismatch { confirmed: true }, Some("People/Tomáš.md")), "confirmed and bound");
    assert!(some!(written(&run, "Pages/Odkazy.md"), "Odkazy").contains("Odkaz: [[Tomáš|tomáš]]\n"), "written as a link to the Person, the source text as its alias");
    assert_eq!(run.plan.report.case_links.iter().map(|r| r.confirmed).collect::<Vec<_>>(), [true], "reported as confirmed");
}

#[test]
fn fr_imp_10_ac7_parser_finds_every_link() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c22-link-shapes"), "import c22");
    let note = "Pages/Tvary odkazů.md";
    let got: Vec<(LinkForm, &LinkOutcome, Option<&str>)> = links_of(&run.plan, note).iter().map(|l| (l.form.clone(), &l.outcome, l.to.as_deref())).collect();
    let cil = Some("Pages/Cíl.md");
    assert_eq!(got, [
        (LinkForm::Markdown, &LinkOutcome::Resolved, cil), // the link wrapping an image
        (LinkForm::Image, &LinkOutcome::External, None),   // the remote image inside it
        (LinkForm::Markdown, &LinkOutcome::Resolved, cil), // over two lines
        (LinkForm::Markdown, &LinkOutcome::Resolved, cil), // brackets in its text
        (LinkForm::Markdown, &LinkOutcome::Resolved, cil), // bold text
        (LinkForm::Markdown, &LinkOutcome::External, None), // the web link
    ], "exactly 6 links outside code: four to Cíl, two external");
    let lines: Vec<u32> = links_of(&run.plan, note).iter().map(|l| l.line).collect();
    assert_eq!(lines, [7, 7, 9, 12, 14, 23], "each with its 1-based line, frontmatter lines counted");
    assert_eq!(links_of(&run.plan, note).iter().map(|l| l.n).collect::<BTreeSet<_>>().len(), 6, "numbered once each");
    let raw = std::fs::read_to_string(fixtures().join("c22-link-shapes/PKM").join(note)).expect("setup: fixture");
    assert_eq!(tegg_import::accounting::count_links(&raw), 6, "the independent counter agrees");
    assert_eq!(tegg_import::accounting::totals(&run.scan.source, SPACE).links, run.plan.links.len(), "…on the whole space too");

    let sb = sandbox();
    let c10 = ok!(import_fixture(&sb, "c10-duplicate-titles"), "import c10");
    let l = some!(link(&c10.plan, "People/Tomáš.md", "[Tomáš : Eva](../Meetings/Tom%C3%A1%C5%A1%20%20Eva%20(1).md)"), "the path link with unencoded parentheses");
    assert_eq!((l.outcome.clone(), l.to.clone(), l.target.as_str()), (LinkOutcome::Resolved, path_of(&c10.plan, "Meetings/Tomáš  Eva (1).md"), "../Meetings/Tomáš  Eva (1).md"), "it resolves to the second `Tomáš : Eva` (F1)");
    let raw = std::fs::read_to_string(fixtures().join("c10-duplicate-titles/PKM/People/Tomáš.md")).expect("setup: fixture");
    assert_eq!((tegg_import::accounting::count_links(&raw), links_of(&c10.plan, "People/Tomáš.md").len()), (2, 2), "the independent counter agrees on c10");
}

#[test]
fn fr_imp_10_ac8_nfd_targets_resolve() {
    let sb = sandbox();
    let src = source(&sb, "c20-file-name-edges");
    edit(&src, "PKM/Pages/Odkazy.md", "[[Tomáš]]", &format!("[[{}]]", nfd_tomas()));
    let run = ok!(import_src(&sb, &src), "import c20 with an NFD link");
    let nfd_link = format!("[[{}]]", nfd_tomas());
    let l = some!(link(&run.plan, "Pages/Odkazy.md", &nfd_link), "the NFD link, as written");
    assert_eq!((l.outcome.clone(), l.to.as_deref(), l.target.as_str()), (LinkOutcome::Resolved, Some("People/Tomáš.md"), "Tomáš"), "it resolves to the Person; the target is read as NFC");
    let text = some!(written(&run, "Pages/Odkazy.md"), "Odkazy");
    assert!(text.contains("Odkaz: [[Tomáš]]\n") && nfc(&text) == text, "the written link is NFC");
    // A zip whose entry names are NFD gives the same plan as the NFC folder.
    let dir = fixtures().join("c20-file-name-edges");
    let mut entries = entries_of(&dir, "");
    let mut changed = 0;
    for e in entries.iter_mut() {
        let name = String::from_utf8_lossy(&e.name).into_owned();
        let d = name.replace('á', "a\u{301}").replace('š', "s\u{30c}").replace('í', "i\u{301}");
        changed += (d != name) as usize;
        e.name = d.into_bytes();
    }
    assert_setup(changed >= 2, "some entry names were decomposed");
    let zip = sb.base.join("nfd").join("c20-file-name-edges.zip");
    write_zip(&zip, &entries);
    let env = ok!(env(&sb), "env");
    let target = new_target(&sb);
    let from_zip = ok!(plan_of(&ok!(scan_of(&zip, &env), "scan the NFD zip"), SPACE, &target, &Mapping::default(), &env), "plan the NFD zip");
    let from_dir = ok!(plan_of(&ok!(scan_of(&dir, &env), "scan the folder"), SPACE, &target, &Mapping::default(), &env), "plan the folder");
    assert!(from_zip.same_as(&from_dir), "the NFD zip gives the same plan as the NFC folder");
    assert_eq!(from_zip.objects.iter().map(|o| o.source.as_str()).collect::<Vec<_>>(), ["Pages/CON.md", "Pages/Odkazy.md", "Pages/Otazníky.md", "People/Tomáš.md"], "source paths are NFC");
}

#[test]
fn fr_imp_10_ac9_only_link_spans_change() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c22-link-shapes"), "import c22");
    let exp = expected_dir("c22-link-shapes");
    for p in ["Pages/Tvary odkazů.md", "Pages/Cíl.md"] {
        assert_eq!(read_text(&run.root, p), read_text(&exp, p), "{p} is byte-equal to the expected output");
    }
    let src = std::fs::read_to_string(fixtures().join("c22-link-shapes/PKM/Pages/Tvary odkazů.md")).expect("setup: fixture");
    let out = some!(read_text(&run.root, "Pages/Tvary odkazů.md"), "the written note");
    let code = "V kódu: `[[Cíl]]` a `[x](../Pages/C%C3%ADl.md)`\n\n```\n[[Cíl]]\n[x](../Pages/C%C3%ADl.md)\n```\n";
    assert!(src.contains(code) && out.contains(code), "the code span and the fenced block are byte-identical to the source");
    let (src_lines, out_lines): (Vec<&str>, Vec<&str>) = (body(&src).lines().map(|_| "").collect(), body(&out).lines().map(|_| "").collect());
    assert_eq!(out_lines.len() + 1, src_lines.len(), "one line fewer: the two-line link is one wikilink");
    for l in body(&src).lines().filter(|l| !l.contains("](../Pages/") || l.starts_with("V kódu") || l.starts_with("[x]")) {
        if l != "Text přes dva řádky: [první řádek" {
            assert!(body(&out).lines().any(|o| o == l), "the line without a link is byte-identical: {l:?}");
        }
    }
    let note = "Pages/Tvary odkazů.md";
    let flags: Vec<(bool, bool)> = links_of(&run.plan, note).iter().map(|l| (l.simplified, l.kept_as_markdown)).collect();
    assert_eq!(flags, [(true, false), (false, false), (false, false), (false, true), (true, false), (false, false)], "simplified: the image link and the bold link; kept as Markdown: the link with brackets (D-1552)");
    let rows: Vec<(&str, &str)> = run.plan.report.simplified.iter().map(|r| (r.written.as_str(), r.kept.as_str())).collect();
    assert_eq!(rows, [("[![logo](https://example.com/logo.png)](../Pages/C%C3%ADl.md)", "logo"), ("[**tučný** cíl](../Pages/C%C3%ADl.md)", "tučný cíl")], "the report lists the two simplified links with the plain text kept");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(core.backlinks("Pages/Cíl.md").iter().map(|p| nfc(p)).collect::<Vec<_>>(), [note], "Cíl has the note as its backlink (the wikilinks and the kept Markdown link resolve)");
    assert_eq!(core.broken_links().occurrences, 0, "no broken link in the written vault");
}

#[test]
fn fr_imp_10_ac10_written_links_resolve() {
    for fixture in FIXTURES {
        let sb = sandbox();
        let run = ok!(import_fixture(&sb, fixture), format!("import {fixture}"));
        let core = ok!(open_core(&run.root, &sb.dirs), format!("{fixture}: open the written vault"));
        for l in run.plan.links.iter().filter(|l| l.outcome == LinkOutcome::Resolved) {
            let at = format!("{fixture}: {} link {} {:?}", l.note, l.n, l.written);
            let to = some!(l.to.clone(), format!("{at}: a resolved link names its file"));
            let from = some!(path_of(&run.plan, &l.note), format!("{at}: the linking note is written"));
            let text = some!(read_text(&run.root, &from), format!("{at}: {from}"));
            let mut targets = wikilink_targets(&text);
            if l.kept_as_markdown {
                targets.push(to.clone()); // a kept Markdown link: checked through the backlink below
            }
            let hit = targets.iter().any(|t| resolves(&core, &from, t).as_deref() == Some(to.as_str()) || *t == to);
            assert!(hit, "{at}: a link of the written note resolves in Tegg's index to the planned file {to}; its links: {targets:?}");
            assert!(core.backlinks(&to).iter().any(|p| nfc(p) == from), "{at}: {to} has {from} as a backlink");
        }
    }
    // Duplicate titles: each object has its own file, and a link to each resolves to the right one.
    let sb = sandbox();
    let src = source(&sb, "c10-duplicate-titles");
    write_raw(&src, "PKM/Pages/Rozcestník.md", "---\ntype: 'Page'\ntitle: Rozcestník\ntags: []\n---\n\n[a](../Weblinks/Article.md) [b](../Weblinks/Article%20(1).md) [c](../Weblinks/Article%20(2).md) [d](../Meetings/Tom%C3%A1%C5%A1%20%20Eva.md) [e](../Meetings/Tom%C3%A1%C5%A1%20%20Eva%20(1).md)\n".as_bytes());
    let run = ok!(import_src(&sb, &src), "import c10 with links to every duplicate");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let hub = some!(read_text(&run.root, "Pages/Rozcestník.md"), "the hub");
    let targets = wikilink_targets(&hub);
    assert_eq!(targets.len(), 5, "five wikilinks: {hub}");
    for (t, source) in targets.iter().zip(["Weblinks/Article.md", "Weblinks/Article (1).md", "Weblinks/Article (2).md", "Meetings/Tomáš  Eva.md", "Meetings/Tomáš  Eva (1).md"]) {
        let planned = some!(path_of(&run.plan, source), format!("{source} is planned"));
        assert_eq!(resolves(&core, "Pages/Rozcestník.md", t), Some(planned.clone()), "the link written for {source} resolves to its own file {planned}");
        let url = fm_get(&some!(read_text(&run.root, &planned), &planned), "url");
        if let Some(n) = source.strip_prefix("Weblinks/Article") {
            let want = match n { ".md" => "0", " (1).md" => "1", _ => "2" };
            assert_eq!(url, Some(format!("https://example.com/{want}")), "{planned} is the object exported as {source}");
        }
    }
    let articles: BTreeSet<String> = ["Weblinks/Article (1).md", "Weblinks/Article (2).md", "Weblinks/Article.md"].iter().filter_map(|s| path_of(&run.plan, s)).collect();
    assert_eq!(articles, set(&["Pages/Article.md", "Pages/Article (2).md", "Pages/Article (3).md"]), "Article, Article (2), Article (3)");
}

#[test]
fn fr_imp_10_ac11_unresolved_links_kept() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c09-unresolved-links"), "import c09");
    let exp = expected_dir("c09-unresolved-links");
    for p in ["Daily/2026-02-01.md", "Trips/Lisbon.md", "Trips/Oslo.md"] {
        assert_eq!(read_text(&run.root, p), read_text(&exp, p), "{p} is byte-equal to the expected output: the links are in the bodies byte for byte, nothing added around them");
    }
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let broken: BTreeSet<String> = core.broken_links().groups.iter().map(|g| g.key.clone()).collect();
    for key in ["note/3f2c9a1e-0000-4000-8000-000000000001", "never exported"] {
        assert!(broken.contains(key), "Tegg's index reports [[{key}]] as a broken link (so it is on the Broken links page): {broken:?}");
    }
    let reported: BTreeSet<&str> = run.plan.report.unresolved.iter().map(|r| r.written.as_str()).collect();
    for w in ["[[NOTE/3f2c9a1e-0000-4000-8000-000000000001]]", "[[Never exported]]", "[Missing](../Pages/Gone.md)"] {
        assert!(reported.contains(w), "the report lists {w} with its note");
    }
    let written: BTreeSet<String> = files(&run.root).into_iter().filter(|p| !p.starts_with(".tegg/")).collect();
    assert_eq!(written, set(&["Daily/2026-02-01.md", "Trips/Lisbon.md", "Trips/Oslo.md", REPORT]), "no object is created for a missing target");
}

#[test]
fn fr_imp_10_ac12_external_links_untouched() {
    let sb = sandbox();
    let c22 = ok!(import_fixture(&sb, "c22-link-shapes"), "import c22");
    let note = "Pages/Tvary odkazů.md";
    let out = some!(read_text(&c22.root, note), "the written note");
    assert!(out.ends_with("\nWeb: [příklad](https://example.com/) zůstává.\n"), "the web link is byte-identical");
    let web = some!(link(&c22.plan, note, "[příklad](https://example.com/)"), "the web link");
    assert_eq!((web.outcome.clone(), web.to.clone(), web.simplified), (LinkOutcome::External, None, false), "outcome external");
    let r = &c22.plan.report;
    let listed = |w: &str| r.unresolved.iter().any(|x| x.written == w) || r.simplified.iter().any(|x| x.written == w) || r.ambiguous.iter().any(|x| x.title == w) || r.case_links.iter().any(|x| x.written == w);
    assert!(!listed("[příklad](https://example.com/)"), "an external link is in no report list");
    // The one exception: an external image inside a link that is rewritten to a wikilink.
    let img = some!(link(&c22.plan, note, "![logo](https://example.com/logo.png)"), "the image inside the link");
    assert_eq!(img.outcome, LinkOutcome::External, "counted with the outcome external");
    assert!(!out.contains("logo.png") && out.contains("[[Cíl|logo]]"), "it is not in the written body: the wikilink keeps only its alt text");
    assert!(listed("[![logo](https://example.com/logo.png)](../Pages/C%C3%ADl.md)"), "its link is in the report as simplified");
    assert_eq!((c22.plan.totals.links.total, c22.plan.totals.links.imported, c22.plan.totals.links.reported), (6, 6, 0), "externals are counted as imported (R147)");

    let sb = sandbox();
    let src = source(&sb, "c06-weblinks");
    let extra = "\nPošta <eva@example.com>, [e-mail](mailto:eva@example.com), [tel](tel:+420123456789), [kotva](#nahoře) a ![vzdálený](https://example.com/o.png).\n";
    append(&src, "PKM/Pages/Reading list.md", extra);
    let c06 = ok!(import_src(&sb, &src), "import c06 with more external links");
    assert!(some!(read_text(&c06.root, "Pages/Reading list.md"), "Reading list").ends_with(extra), "every URL with a scheme, mailto:, tel: and #… is byte-identical");
    let ext: Vec<&str> = links_of(&c06.plan, "Pages/Reading list.md").iter().filter(|l| l.outcome == LinkOutcome::External).map(|l| l.written.as_str()).collect();
    assert_eq!(ext, ["[e-mail](mailto:eva@example.com)", "[tel](tel:+420123456789)", "[kotva](#nahoře)", "![vzdálený](https://example.com/o.png)"], "four external links; the autolink is not a counted link (§6.5)");
    assert!(c06.plan.report.unresolved.is_empty() && c06.plan.report.simplified.is_empty(), "none of them is in a report list");
}

// ------------------------------------------------------------------------------------------------ FR-IMP-11

#[test]
fn fr_imp_11_ac1_title_comes_from_the_frontmatter() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    let o = some!(object(&run.plan, "Meetings/11 2026-03-19 Jana.md"), "the meeting");
    assert_eq!((o.title.as_deref(), o.path.as_deref()), (Some("1:1 2026-03-19 Jana"), Some("Meetings/1 1 2026-03-19 Jana.md")), "the title from `title:`, the file from the sanitized title (AP-2)");
    assert_eq!(o.name_changes, [NameChange::Characters], "the file name differs from the title: characters replaced");
    let text = some!(read_text(&run.root, "Meetings/1 1 2026-03-19 Jana.md"), "the written file");
    assert_eq!(unquoted(fm_get(&text, "title")).as_deref(), Some("1:1 2026-03-19 Jana"), "`title` holds the full title");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(core.object("Meetings/1 1 2026-03-19 Jana.md").map(|o| o.title), Some("1:1 2026-03-19 Jana".to_string()), "Tegg reads the title back");
    assert!(run.plan.report.files.iter().any(|r| r.source == "Meetings/11 2026-03-19 Jana.md" && r.change == FileChange::NameChanged { name: "1 1 2026-03-19 Jana.md".into(), reasons: vec![NameChange::Characters] }), "the changed name is a Files row");
}

#[test]
fn fr_imp_11_ac2_trailing_spaces_in_titles_are_trimmed() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    let o = some!(object(&run.plan, "People/Jana.md"), "Jana");
    assert_eq!((o.title.as_deref(), o.path.as_deref(), o.name_changes.clone()), (Some("Jana"), Some("People/Jana.md"), Vec::new()), "`'Jana '` is trimmed");
    assert_eq!(fm_get(&some!(read_text(&run.root, "People/Jana.md"), "the file"), "title").as_deref(), Some("Jana"), "written without the space");
}

#[test]
fn fr_imp_11_ac3_seventeen_articles() {
    let sb = sandbox();
    let src = source(&sb, "c10-duplicate-titles");
    for i in 3..=16 {
        write_raw(&src, &format!("PKM/Weblinks/Article ({i}).md"), format!("---\ntype: 'Weblink'\ntitle: Article\ntags: []\nurl: https://example.com/{i}\n---\n\n").as_bytes());
    }
    let links: String = (0..=16).map(|i| if i == 0 { "[0](../Weblinks/Article.md)\n\n".to_string() } else { format!("[{i}](../Weblinks/Article%20({i}).md)\n\n") }).collect();
    write_raw(&src, "PKM/Pages/Seznam.md", format!("---\ntype: 'Page'\ntitle: Seznam\ntags: []\n---\n\n{links}").as_bytes());
    let run = ok!(import_src(&sb, &src), "import c10 with 17 Articles");
    let articles: Vec<&tegg_import::PlannedObject> = run.plan.objects.iter().filter(|o| o.source.starts_with("Weblinks/")).collect();
    assert_eq!(articles.len(), 17, "17 Weblinks");
    assert!(articles.iter().all(|o| o.title.as_deref() == Some("Article")), "17 objects titled Article");
    let names: BTreeSet<String> = articles.iter().filter_map(|o| o.path.clone()).collect();
    let want: BTreeSet<String> = (1..=17).map(|i| if i == 1 { "Pages/Article.md".to_string() } else { format!("Pages/Article ({i}).md") }).collect();
    assert_eq!(names, want, "files Article.md, Article (2).md … Article (17).md (FR-LNK-14)");
    // Named in source-path order: the first by path keeps the bare name.
    assert_eq!(articles.iter().map(|o| o.source.as_str()).next(), Some("Weblinks/Article (1).md"), "setup: `Article (1).md` is the first by code point");
    assert_eq!(articles[0].path.as_deref(), Some("Pages/Article.md"), "the first by source path is Article.md");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let hub = some!(read_text(&run.root, "Pages/Seznam.md"), "the list");
    let targets = wikilink_targets(&hub);
    assert_eq!(targets.len(), 17, "17 wikilinks");
    for (i, t) in targets.iter().enumerate() {
        let to = some!(resolves(&core, "Pages/Seznam.md", t), format!("link {i} resolves"));
        assert_eq!(fm_get(&some!(read_text(&run.root, &to), &to), "url"), Some(format!("https://example.com/{i}")), "link {i} points at the Article with url …/{i}");
        assert!(hub.contains(&format!("[[{t}|{i}]]")), "written with the link's text as the alias");
    }
    for p in &want {
        assert_eq!(fm_get(&some!(read_text(&run.root, p), p), "title").as_deref(), Some("Article"), "{p} is titled Article");
    }
}

#[test]
fn fr_imp_11_ac4_reserved_and_empty_names() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c20-file-name-edges"), "import c20");
    assert_eq!((path_of(&run.plan, "Pages/CON.md").as_deref(), path_of(&run.plan, "Pages/Otazníky.md").as_deref()), (Some("Pages/CON_.md"), Some("Pages/Untitled.md")), "CON → CON_.md, ??? → Untitled.md (D-80)");
    assert_eq!(fm_get(&some!(read_text(&run.root, "Pages/CON_.md"), "CON_.md"), "title").as_deref(), Some("CON"), "title: CON");
    assert_eq!(unquoted(fm_get(&some!(read_text(&run.root, "Pages/Untitled.md"), "Untitled.md"), "title")).as_deref(), Some("???"), "title: \"???\"");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let odkazy = some!(read_text(&run.root, "Pages/Odkazy.md"), "Odkazy");
    assert_eq!(body(&odkazy), "\nOdkaz: [[Tomáš]]\n\n[[CON_|CON]] a [[Untitled|???]]\n", "the links name the files and keep the titles as their text");
    assert_eq!((resolves(&core, "Pages/Odkazy.md", "CON_").as_deref(), resolves(&core, "Pages/Odkazy.md", "Untitled").as_deref()), (Some("Pages/CON_.md"), Some("Pages/Untitled.md")), "[[CON]] and [[???]] resolve to them");
    let rows: Vec<(&str, &FileChange)> = run.plan.report.files.iter().map(|r| (r.source.as_str(), &r.change)).collect();
    assert_eq!(rows, [("Pages/CON.md", &FileChange::NameChanged { name: "CON_.md".into(), reasons: vec![NameChange::Reserved] }), ("Pages/Otazníky.md", &FileChange::NameChanged { name: "Untitled.md".into(), reasons: vec![NameChange::Empty] })], "the report's Files section lists both names");
}

#[test]
fn fr_imp_11_ac5_long_and_special_titles() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c11-file-names"), "import c11");
    let title = "Žluťoučký kůň úpěl ďábelské ódy ".repeat(8).trim_end().to_string();
    assert_setup(title.len() > 200, "the fixture's title is over 200 bytes");
    let o = some!(object(&run.plan, "Pages/Long title.md"), "the long title");
    let path = some!(o.path.clone(), "its path");
    let stem = path.trim_start_matches("Pages/").trim_end_matches(".md").to_string();
    assert!(stem.len() <= 200 && stem.len() > 180, "a stem of at most 200 UTF-8 bytes: {} bytes", stem.len());
    assert!(title.starts_with(&stem), "cut at a character boundary: the stem is a prefix of the title");
    assert_eq!(nfc(&stem), stem, "never inside a combining sequence: the stem is NFC");
    assert_eq!(stem, sanitize_file_stem(&title), "the stem is `sanitize_file_stem` of the title (§5.2)");
    assert_eq!((o.title.as_deref(), o.name_changes.clone()), (Some(title.as_str()), vec![NameChange::Cut]), "the full title is kept; the name change is `cut`");
    assert_eq!(fm_get(&some!(read_text(&run.root, &path), "the file"), "title"), Some(title.clone()), "`title:` holds the full title");
    let special = some!(object(&run.plan, "Pages/Heading  and brackets.md"), "the title with # and [ ]");
    let spath = some!(special.path.clone(), "its path");
    assert!(!spath.contains(['#', '[', ']']), "#, [ and ] are replaced (D-68): {spath}");
    assert_eq!(spath, format!("Pages/{}.md", sanitize_file_stem("Heading #1 and [brackets]")), "by `sanitize_file_stem`");
    assert_eq!(unquoted(fm_get(&some!(read_text(&run.root, &spath), "the file"), "title")).as_deref(), Some("Heading #1 and [brackets]"), "the title is kept");
    // A link to the long title resolves.
    let sb = sandbox();
    let src = source(&sb, "c11-file-names");
    append(&src, "PKM/People/Jana.md", &format!("\n[[{title}]] a [[Heading #1 and [brackets]]]\n"));
    let run = ok!(import_src(&sb, &src), "import c11 with a link to the long title");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let jana = some!(read_text(&run.root, "People/Jana.md"), "Jana");
    assert!(jana.contains(&format!("[[{stem}|{title}]]")), "the link names the cut file name and keeps the title as its text");
    assert_eq!(resolves(&core, "People/Jana.md", &stem), Some(path.clone()), "and resolves");
}

#[test]
fn fr_imp_11_ac6_daily_notes() {
    let sb = sandbox();
    let src = source(&sb, "c13-daily-notes");
    write_raw(&src, "PKM/Pages/Týden.md", "---\ntype: 'Page'\ntitle: Týden\ntags: []\n---\n\nV pondělí [[Date/2026-02-02]].\n".as_bytes());
    let run = ok!(import_src(&sb, &src), "import c13");
    assert_eq!((path_of(&run.plan, "DailyNotes/2026-02-02.md").as_deref(), path_of(&run.plan, "DailyNotes/2026-02-03.md").as_deref()), (Some("Daily/2026-02-02.md"), Some("Daily/2026-02-03.md")), "written into Daily/ under the day");
    let day = some!(read_text(&run.root, "Daily/2026-02-02.md"), "Daily/2026-02-02.md");
    let head: Vec<(String, String)> = fm(&day).into_iter().filter(|(k, _)| !["id", "created", "modified"].contains(&k.as_str())).collect();
    let want = [("type", "daily-note"), ("title", "\"2026-02-02\""), ("date", "2026-02-02"), ("review", "reviewed"), ("tags", "[]"), ("import-id", "capacities:PKM/DailyNotes/2026-02-02.md")];
    assert_eq!(head, want.map(|(k, v)| (k.to_string(), v.to_string())), "type daily-note, the fixed title of the day, `date`, `review` per FR-IMP-15 AC-2");
    assert_eq!(body(&day), "\n09:15\n\nStand-up.\n\n21:30\n\nRead.\n", "the timestamp lines are unchanged");
    let next = some!(read_text(&run.root, "Daily/2026-02-03.md"), "Daily/2026-02-03.md");
    assert_eq!((fm_get(&next, "review").as_deref(), body(&next).as_str()), (Some("unreviewed"), "\n7:05\n\nRun.\n"), "the other day: `7:05` unchanged, review unreviewed");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    let d = chrono::NaiveDate::from_ymd_opt(2026, 2, 2).expect("setup: date");
    assert_eq!(core.daily_note(d).as_deref(), Some("Daily/2026-02-02.md"), "Tegg's index finds the day's note by `date`");
    assert!(some!(read_text(&run.root, "Pages/Týden.md"), "Týden").ends_with("\nV pondělí [[2026-02-02]].\n"), "the date link is written as [[2026-02-02]]");
    assert_eq!(resolves(&core, "Pages/Týden.md", "2026-02-02").as_deref(), Some("Daily/2026-02-02.md"), "and resolves to the imported day");
    assert_eq!(some!(link(&run.plan, "Pages/Týden.md", "[[Date/2026-02-02]]"), "the planned link").outcome, LinkOutcome::DateMention, "a date mention");
}

// ------------------------------------------------------------------------------------------------ FR-IMP-16

#[test]
fn fr_imp_16_ac1_query_becomes_a_page_with_an_empty_query_fence() {
    let sb = sandbox();
    let run = ok!(import_fixture(&sb, "c07-query-shells"), "import c07");
    let open = some!(read_text(&run.root, "Pages/Open tasks.md"), "Pages/Open tasks.md");
    let head: Vec<(String, String)> = fm(&open).into_iter().filter(|(k, _)| !["id", "created", "modified", "import-id"].contains(&k.as_str())).collect();
    assert_eq!(head, [("type", "page"), ("title", "Open tasks"), ("description", "Tasks not done"), ("tags", "[needs-rebuilding]")].map(|(k, v)| (k.to_string(), v.to_string())), "a Page with its title and description and the tag needs-rebuilding");
    let b = body(&open);
    let lines: Vec<&str> = b.lines().collect();
    let n = lines.len();
    assert!(n >= 4, "a note line, a blank line and the fence: {b:?}");
    assert_eq!(&lines[n - 3..], ["", "```query", "```"], "an empty ```query fence under the note");
    assert!(!lines[n - 4].trim().is_empty() && lines[..n - 3].iter().filter(|l| !l.trim().is_empty()).count() == 1, "one line of text above it, saying the definition wasn't exported: {b:?}");
    let other = some!(object(&run.plan, "Queries/All books where.md"), "the other query");
    assert_eq!((other.kind.clone(), other.title.as_deref(), other.path.clone()), (ObjectKind::QueryStub, Some("All Books where ..."), Some(format!("Pages/{}.md", sanitize_file_stem("All Books where ...")))), "the second stub, with its title");
    let text = some!(other.path.as_deref().and_then(|p| read_text(&run.root, p)), "its file");
    assert!(!fm_keys(&text).iter().any(|k| k == "description" || k == "icon"), "null description and icon are omitted");
    assert!(text.ends_with("\n\n```query\n```\n"), "it ends with the empty fence");
    assert!(!files(&run.root).iter().any(|p| p.starts_with(".tegg/queries/")), "no file under .tegg/queries/");
}

#[test]
fn fr_imp_16_ac2_the_report_lists_all_stubs() {
    let sb = sandbox();
    let mut env = ok!(env(&sb), "env");
    env.strings = key_strings();
    let run = ok!(import_new(&sb, &fixtures().join("c07-query-shells"), SPACE, &Mapping::default(), &env), "import c07");
    assert_eq!(run.plan.report.stubs.iter().map(|s| s.note.as_str()).collect::<Vec<_>>(), ["Queries/All books where.md", "Queries/Open tasks.md"], "both stubs, by note");
    let report = some!(read_text(&run.root, REPORT), "the report");
    let rows = rows(&report, "⟦section.stubs⟧");
    assert_eq!(rows.len(), 2, "two rows in the Query stubs section: {rows:?}");
    assert!(rows[1] == "[[Open tasks]]" && rows[0].starts_with("[[") && rows[0].ends_with("]]"), "each row links to its stub: {rows:?}");
    assert!(run.plan.report.not_exported.contains(&tegg_import::NotExported::QueryDefinitions), "and the losses name the query definitions");
}

#[test]
fn fr_imp_16_ac3_links_to_stubs_resolve() {
    let sb = sandbox();
    let src = source(&sb, "c07-query-shells");
    write_raw(&src, "PKM/Pages/Přehled.md", "---\ntype: 'Page'\ntitle: Přehled\ntags: []\n---\n\nViz [[Open tasks]].\n".as_bytes());
    let run = ok!(import_src(&sb, &src), "import c07 with a link to a query");
    let l = some!(link(&run.plan, "Pages/Přehled.md", "[[Open tasks]]"), "the link to the query");
    assert_eq!((l.outcome.clone(), l.to.as_deref()), (LinkOutcome::Resolved, Some("Pages/Open tasks.md")), "resolved to the stub");
    let core = ok!(open_core(&run.root, &sb.dirs), "open the written vault");
    assert_eq!(resolves(&core, "Pages/Přehled.md", "Open tasks").as_deref(), Some("Pages/Open tasks.md"), "the written link resolves to the stub");
    assert!(!snapshot(&run.root).keys().any(|k| k.starts_with(".tegg/queries")), "no file and no folder under .tegg/queries/ is created by an import");
    assert!(run.plan.objects.iter().all(|o| o.outcome == ObjectOutcome::Imported), "all three objects are imported");
}
