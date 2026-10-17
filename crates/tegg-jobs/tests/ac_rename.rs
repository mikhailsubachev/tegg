//! MS4 slice 4C AC tests at the core (L4): note rename end to end on a temporary copy of the rename fixture on APFS,
//! with the real `@tegg/doc` engine as transformer (`NodeTransformer`, D-82).
//! docs/acceptance/rename.md FR-FMT-08 AC-6 (L1 `sanitize` cases + L4), AC-7, AC-8, AC-10; FR-LNK-03 AC-7, AC-8,
//! AC-10…AC-14, AC-18 (conflict path); FR-SYN-06 AC-10, AC-11; and the existing criteria this slice verifies:
//! links.md FR-FMT-08 / FR-LNK-03 AC-1…AC-5 (named by their FR-LNK-03 alias keys, because rename.md reuses the
//! FR-FMT-08 AC-5/AC-6 numbers), data-safety FR-SYN-06 AC-2 (rename part), AC-3.
//! Interface: docs/contracts/ms4-jobs.md §2…§9. Written from the ACs and the contract only (D-61).
//!
//! Every API result goes through `ok!`/`some!` (an assertion in this file), so the 4C stubs fail on assertions.

#[macro_use]
mod common;

use std::collections::BTreeSet;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use tegg_core::CoreEvent;
use tegg_format::{extract, nfc, sanitize_file_stem};
use tegg_jobs::testing::NodeTransformer;
use tegg_jobs::{JobOp, JobPoint, Phase, SkipReason, TextOp, Transformed, Transformer};

fn gama_bytes_ok(root: &std::path::Path) -> Result<String, String> {
    read_text(root, GAMA).ok_or_else(|| "Pages/Gama.md is missing".to_string())
}

/// Alfa after its own rename to `title` (stem `stem`): `title:` changed (quoted per formatScalar when needed), self-link
/// retargeted, `modified` touched (blanked here), every other byte kept.
fn alfa_after(title_line: &str, self_link: &str) -> String {
    no_modified(&fixture_text(ALFA).replace("title: Alfa", title_line).replace("[[Alfa#Úvod]]", self_link))
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-7

#[test]
fn fr_lnk_03_ac7_every_link_form_rewritten_end_to_end() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename Alfa → Gama");
    assert_eq!(report.phase, Phase::Done, "the job ends done: {report:?}");
    assert_eq!(report.renamed, Some((ALFA.to_string(), GAMA.to_string())), "renamed Pages/Alfa.md → Pages/Gama.md");
    assert_eq!(read_text(&root, ODKAZY), Some(odkazy_after_gama()), "Odkazy: every form rewritten, near misses and every other byte identical");
    assert!(!root.join(ALFA).exists(), "Pages/Alfa.md no longer exists");
    let g = ok!(gama_bytes_ok(&root), "Pages/Gama.md");
    assert_eq!(no_modified(&g), alfa_after("title: Gama", "[[Gama#Úvod]]"), "Gama: same id, title: Gama, self-link [[Gama#Úvod]] in the same write");
    assert!(g.contains(&format!("id: {ALFA_ID}\n")), "same id");
}

#[test]
fn fr_lnk_03_ac1_all_forms_from_fifty_notes_follow_the_rename() {
    // links.md AC-1: A linked from 50 notes in all forms (incl. relation and list of relations) → all link to B.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let forms = ["[[Alfa]]", "[[Alfa|alias]]", "[[Alfa#Úvod]]", "[[Alfa#^b1]]", "![[Alfa]]"];
    for i in 0..50 {
        let n = format!("{i:02}");
        let text = format!(
            "---\nid: 01JB4C00000000000000000{n}Z\ntype: page\ntitle: Odkazující {n}\nvztah: \"[[Alfa]]\"\nseznam:\n  - \"[[Alfa]]\"\n  - \"[[Beta]]\"\n---\n{}\n",
            forms.join("\n\n")
        );
        write_raw(&root, &format!("Odkazující/Odkazující {n}.md"), text.as_bytes());
    }
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, ALFA, "Bravo"), "rename Alfa → Bravo");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let mut wrong = Vec::new();
    for i in 0..50 {
        let rel = format!("Odkazující/Odkazující {i:02}.md");
        let t = read_text(&root, &rel).unwrap_or_default();
        let want_body = "[[Bravo]]\n\n[[Bravo|alias]]\n\n[[Bravo#Úvod]]\n\n[[Bravo#^b1]]\n\n![[Bravo]]\n";
        if !t.ends_with(want_body) || !t.contains("vztah: \"[[Bravo]]\"\n") || !t.contains("  - \"[[Bravo]]\"\n  - \"[[Beta]]\"\n") {
            wrong.push(rel);
        }
    }
    assert_eq!(wrong, Vec::<String>::new(), "every linking note links to Bravo with alias, heading and block parts kept");
    assert!(root.join("Pages/Bravo.md").exists() && !root.join(ALFA).exists(), "the file is Bravo.md");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-8

#[test]
fn fr_lnk_03_ac8_frontmatter_links_end_to_end() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    ok!(rename(&core, ALFA, "Gama"), "rename");
    let want = fixture_text(VLASTNOSTI)
        .replace("autor: \"[[Alfa]]\"", "autor: \"[[Gama]]\"")
        .replace("zdroje: [\"[[Alfa]]\", \"[[Beta]]\"]", "zdroje: [\"[[Gama]]\", \"[[Beta]]\"]")
        .replace("poznámka: viz [[Alfa]]", "poznámka: viz [[Gama]]")
        .replace("x-extra: [[Alfa]]", "x-extra: [[Gama]]");
    assert_eq!(read_text(&root, VLASTNOSTI), Some(want), "relation, flow list, text value and unknown key rewritten; quoting, order and every other byte kept");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-10

#[test]
fn fr_lnk_03_ac10_renaming_pages_alfa_leaves_links_resolving_elsewhere() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename Pages/Alfa.md");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let after = snapshot(&root);
    for p in [MISTNI, JINDE, DVOJNIK] {
        assert_eq!(before.get(p), after.get(p), "{p} untouched (its links resolve to Projekty/Alfa.md or it is Dvojník)");
    }
    assert_eq!(read_text(&root, ODKAZY), Some(odkazy_after_gama()), "the links that resolved to Pages/Alfa.md were rewritten");
}

#[test]
fn fr_lnk_03_ac10_renaming_projekty_alfa_rewrites_only_mistni() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, JINDE, "Delta"), "rename Projekty/Alfa.md → Delta");
    assert_eq!(report.renamed, Some((JINDE.to_string(), "Projekty/Delta.md".to_string())), "{report:?}");
    assert_eq!(read_text(&root, MISTNI), Some(swapped(MISTNI, "[[Alfa]]", "[[Delta]]")), "Místní's [[Alfa]] follows");
    let ch = changed(&before, &snapshot(&root));
    assert_eq!(ch, set(&[JINDE, MISTNI, "Projekty/Delta.md"]), "only that link's file and the renamed note change; Dvojník, Odkazy and the rest untouched");
}

#[test]
fn fr_lnk_03_ac10_link_via_alias_is_unchanged() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    // Alfa gets an alias; a note links to the alias text only.
    let alfa = fixture_text(ALFA).replace("title: Alfa\n", "title: Alfa\naliases: [Alef]\n");
    write_raw(&root, ALFA, alfa.as_bytes());
    write_raw(&root, "Pages/Přes alias.md", "---\nid: 01JB4C0000000000000000R201\ntype: page\ntitle: Přes alias\n---\nOdkaz přes alias: [[Alef]]\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let res = |c: &tegg_core::Core| c.resolve_links("Pages/Přes alias.md", &["Alef".to_string()]).into_iter().map(|t| (t.kind, t.path)).collect::<Vec<_>>();
    let was = res(&core);
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(before.get("Pages/Přes alias.md"), snapshot(&root).get("Pages/Přes alias.md"), "the alias link's file is untouched");
    let now = res(&core);
    let moved: Vec<_> = was.iter().map(|(k, p)| (*k, p.as_ref().map(|p| if p == ALFA { GAMA.to_string() } else { p.clone() }))).collect();
    assert_eq!(now, moved, "the alias link resolves as before (to the renamed note if it did)");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-11

#[test]
fn fr_lnk_03_ac11_nfd_link_rewritten_in_nfc_only_link_bytes() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, CAJ, "Čaj o šesté"), "rename Čaj o páté → Čaj o šesté");
    assert_eq!(report.renamed, Some((CAJ.to_string(), "Pages/Čaj o šesté.md".to_string())), "{report:?}");
    let nfd_link = format!("[[{}]]", "Čaj o páté".chars().collect::<String>().replace("Č", "C\u{30C}").replace("á", "a\u{301}").replace("é", "e\u{301}"));
    let original = fixture(NFD_ODKAZ);
    assert_setup(String::from_utf8_lossy(&original).contains(&nfd_link), "fixture holds the NFD link");
    let want = String::from_utf8_lossy(&original).replace(&nfd_link, "[[Čaj o šesté]]").into_bytes();
    assert_eq!(read_bytes(&root, NFD_ODKAZ), Some(want), "only the link bytes change, written in NFC");
}

#[test]
fn fr_lnk_03_ac11_crlf_and_missing_final_newline_kept() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    ok!(rename(&core, ALFA, "Gama"), "rename");
    let want = swapped(WINDOWS, "Odkaz: [[Alfa]]", "Odkaz: [[Gama]]");
    assert!(want.contains("\r\n") && !want.ends_with('\n'), "setup: CRLF without a final newline");
    assert_eq!(read_text(&root, WINDOWS), Some(want), "CRLF and the missing final newline are kept; only the link bytes change");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-12, links.md AC-3

#[test]
fn fr_lnk_03_ac12_code_and_trash_untouched_template_and_daily_rewritten() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let after = snapshot(&root);
    assert_eq!(before.get(KOD), after.get(KOD), "Kód untouched (links in code)");
    assert_eq!(before.get(KOS), after.get(KOS), ".trash/Pages/Starý.md untouched");
    assert_eq!(read_text(&root, SABLONA), Some("Nová stránka. Viz [[Gama]].\n".to_string()), "the template is rewritten (D-391)");
    assert_eq!(read_text(&root, DEN), Some(swapped(DEN, "[[Alfa]]", "[[Gama]]")), "the Daily Note: only its link bytes change");
}

#[test]
fn fr_lnk_03_ac3_links_in_code_are_not_changed() {
    // links.md AC-3 at L4: a note with the same link in code and in text: only the text link follows.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let kod_plus = format!("{}Mimo kód: [[Alfa]]\n", fixture_text(KOD));
    write_raw(&root, KOD, kod_plus.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    ok!(rename(&core, ALFA, "Gama"), "rename");
    let want = format!("{}Mimo kód: [[Gama]]\n", fixture_text(KOD));
    assert_eq!(read_text(&root, KOD), Some(want), "code span, fence and indented block keep [[Alfa]]; the text link follows");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-13, links.md AC-2

fn gama_set() -> BTreeSet<String> {
    set(&[ALFA, GAMA, ODKAZY, VLASTNOSTI, DEN, SABLONA, WINDOWS])
}

#[test]
fn fr_lnk_03_ac13_only_linking_files_change() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    ok!(rename(&core, ALFA, "Gama"), "rename");
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), gama_set(), "exactly Alfa (renamed), Odkazy, Vlastnosti, Den, the template and Windows.md change");
    for v in vyplne() {
        assert_eq!(before.get(&v), after.get(&v), "{v} untouched (bytes, mtime, inode)");
    }
    assert_eq!(temp_files(&root), Vec::<String>::new(), "no .tegg-tmp remains");
}

#[test]
fn fr_lnk_03_ac2_only_notes_with_a_link_are_written_atomically() {
    // links.md AC-2 (FR-SYN-06): only notes containing a link to A are written, each atomically (no write in place).
    let sb = sandbox();
    let root = rename_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(changed(&before, &snapshot(&root)), gama_set(), "only linking notes and the renamed note change");
    let touched: BTreeSet<String> = fs.ops().into_iter().filter(|(op, _, _)| op != "create_dir_all").map(|(_, p, _)| p).filter(|p| !p.contains(".tegg-tmp")).collect();
    let allowed = gama_set();
    let extra: Vec<_> = touched.difference(&allowed).cloned().collect();
    assert_eq!(extra, Vec::<String>::new(), "no write operation targets another file");
}

#[test]
fn fr_syn_06_ac2_rename_writes_the_note_and_its_linking_files_only() {
    // data-safety AC-2 (rename part): a rename writes the note plus the files its links require, nothing else.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    let written: BTreeSet<String> = report.written.iter().map(|p| nfc(p)).collect();
    assert_eq!(written, set(&[GAMA, ODKAZY, VLASTNOSTI, DEN, SABLONA, WINDOWS]), "the report's written files");
    assert_eq!(changed(&before, &snapshot(&root)), gama_set());
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-14, links.md AC-5

#[test]
fn fr_lnk_03_ac14_undo_restores_every_byte_and_redo_reapplies() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let pre = snapshot(&root);
    let (job, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let post = snapshot(&root);
    assert_eq!(core.jobs().last_undoable(), Some(job), "the rename is the last undoable job");
    let (_, undo) = ok!(run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(undo.phase, Phase::Done, "{undo:?}");
    assert!(root.join(ALFA).exists() && !root.join(GAMA).exists(), "the file is Pages/Alfa.md again");
    let now = snapshot(&root);
    let mut diff = Vec::new();
    for p in gama_set() {
        if pre.get(&p).map(|e| &e.bytes) != now.get(&p).map(|e| &e.bytes) {
            diff.push(p);
        }
    }
    assert_eq!(diff, Vec::<String>::new(), "every file the job wrote has its pre-rename bytes");
    let (_, redo) = ok!(run_job(&core, JobOp::Redo { job }), "redo");
    assert_eq!(redo.phase, Phase::Done, "{redo:?}");
    let again = snapshot(&root);
    let mut diff = Vec::new();
    for p in gama_set() {
        if post.get(&p).map(|e| &e.bytes) != again.get(&p).map(|e| &e.bytes) {
            diff.push(p);
        }
    }
    assert_eq!(diff, Vec::<String>::new(), "redo re-applies the rename to the same bytes");
}

#[test]
fn fr_lnk_03_ac14_undo_skips_a_file_changed_since_and_lists_it() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let pre = snapshot(&root);
    let (job, _) = ok!(rename(&core, ALFA, "Gama"), "rename");
    let edited = format!("{}\nZměna po přejmenování.\n", odkazy_after_gama());
    write_raw(&root, ODKAZY, edited.as_bytes());
    let (_, undo) = ok!(run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(read_text(&root, ODKAZY), Some(edited), "Odkazy changed since the rename is not reverted");
    assert!(undo.skipped.iter().any(|s| nfc(&s.path) == ODKAZY && s.reason == SkipReason::Changed), "listed as changed: {undo:?}");
    for p in [VLASTNOSTI, DEN, SABLONA, WINDOWS, ALFA] {
        assert_eq!(read_bytes(&root, p), pre.get(p).map(|e| e.bytes.clone()), "{p} has its pre-rename bytes");
    }
}

#[test]
fn fr_lnk_03_ac5_rename_is_undoable_as_one_action() {
    // links.md AC-5: one undo restores the file name and all link changes.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let pre = snapshot(&root);
    let (job, _) = ok!(rename(&core, ALFA, "Gama"), "rename");
    ok!(run_job(&core, JobOp::Undo { job }), "one undo");
    let now = snapshot(&root);
    let bytes = |m: &std::collections::BTreeMap<String, Entry>| m.iter().filter(|(k, _)| !k.ends_with('/')).map(|(k, e)| (k.clone(), e.bytes.clone())).collect::<Vec<_>>();
    assert_eq!(bytes(&now), bytes(&pre), "every path and every byte as before the rename");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-18 (conflict path)

/// The editor side of D-386 in the test: Odkazy is "open" with an unsaved edit; the core sends its transformation as a
/// live `JobTransform`; the "editor" applies it to its live text with the real engine and saves through `write_note`.
#[test]
fn fr_lnk_03_ac18_open_note_rewritten_through_the_editor_keeps_unsaved_text() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = Arc::new(ok!(open_core(&root, &sb.dirs, false), "open"));
    let (disk, base) = ok!(core.read_note(ODKAZY, std::time::SystemTime::now()), "read Odkazy");
    let live = format!("{}Neuložený text v editoru.\n", String::from_utf8_lossy(&disk));
    core.jobs().editor_open(ODKAZY);
    let events = core.events();
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), "start rename");
    let engine = ok!(NodeTransformer::from_repo(&repo_root()), "NodeTransformer");
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut saved = false;
    while Instant::now() < deadline && !saved {
        match events.recv_timeout(Duration::from_millis(200)) {
            Ok(CoreEvent::JobTransform { source, ops, live: true, .. }) if nfc(&source) == ODKAZY => {
                let t = ok!(engine.transform(ODKAZY, live.as_bytes(), &ops), "transform the live document");
                let Transformed::Bytes(bytes, _) = t else {
                    assert!(false, "the live document's links are rewritten");
                    unreachable!()
                };
                ok!(core.write_note(ODKAZY, &bytes, Some(&base)), "the editor's autosave writes Odkazy");
                saved = true;
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(saved, "the job sent Odkazy's transformation to its editor (live JobTransform)");
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    assert!(report.written.iter().any(|p| nfc(p) == ODKAZY), "counted written when the editor's save lands: {report:?}");
    assert_eq!(read_text(&root, ODKAZY), Some(format!("{}Neuložený text v editoru.\n", odkazy_after_gama())), "the file has the user's edit and the new links");
}

#[test]
fn fr_lnk_03_ac18_editor_closed_without_saving_is_skipped_never_overwritten() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    core.jobs().editor_open(ODKAZY);
    let events = core.events();
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), "start rename");
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut sent = false;
    while Instant::now() < deadline && !sent {
        if let Ok(CoreEvent::JobTransform { source, live: true, .. }) = events.recv_timeout(Duration::from_millis(200)) {
            sent = nfc(&source) == ODKAZY;
        }
    }
    assert!(sent, "the open note's transformation goes to the editor");
    core.jobs().editor_close(ODKAZY);
    let report = some!(core.jobs().wait(job, Duration::from_secs(30)), "report");
    assert!(report.skipped.iter().any(|s| nfc(&s.path) == ODKAZY && s.reason == SkipReason::Changed), "skipped: changed: {report:?}");
    assert_eq!(before.get(ODKAZY), snapshot(&root).get(ODKAZY), "the core never wrote Odkazy itself");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-6 (L1 sanitize + L4), links.md AC-4

#[test]
fn fr_fmt_08_ac6_sanitized_stem_full_title_kept() {
    // L1: the sanitize rules (FR-FMT-08 AC-1…AC-3).
    assert_eq!(sanitize_file_stem("Q3: plan/budget"), "Q3 plan budget");
    let nfd = "Čaj: ř/ž".replace("Č", "C\u{30C}").replace("ř", "r\u{30C}").replace("ž", "z\u{30C}");
    assert_eq!(sanitize_file_stem(&nfd), "Čaj ř ž", "NFD input gives the NFC stem");
    let long = "Žluťoučký kůň úpěl ďábelské ódy ".repeat(8).trim().to_string();
    assert!(long.len() >= 250, "setup: a title of at least 250 bytes ({})", long.len());
    let stem = sanitize_file_stem(&long);
    assert!(stem.len() <= 200 && long.starts_with(stem.trim_end()), "stem ≤ 200 bytes, cut at a character boundary: {} bytes", stem.len());

    // L4: the rename uses them, and the full title stays in `title:` (exact line for the AC's example).
    for (title, stem) in [("Q3: plan/budget".to_string(), "Q3 plan budget".to_string()), (nfd.clone(), "Čaj ř ž".to_string()), (long.clone(), stem.clone())] {
        let sb = sandbox();
        let root = rename_vault(&sb);
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        let (_, report) = ok!(rename(&core, ALFA, &title), "rename");
        let to = format!("Pages/{stem}.md");
        assert_eq!(report.renamed, Some((ALFA.to_string(), to.clone())), "{title:?}: {report:?}");
        let t = read_text(&root, &to).unwrap_or_default();
        assert_eq!(extract(t.as_bytes(), &stem).title, nfc(&title), "{to}: the full title (NFC) is kept in title:");
        if stem == "Q3 plan budget" {
            assert!(t.lines().any(|l| l == "title: \"Q3: plan/budget\""), "{to}: title: \"Q3: plan/budget\": {t}");
        }
    }
}

#[test]
fn fr_lnk_03_ac4_forbidden_characters_give_file_title_and_aliased_links() {
    // links.md AC-4.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    ok!(rename(&core, ALFA, "Q3: plan/budget"), "rename");
    let t = read_text(&root, "Pages/Q3 plan budget.md").unwrap_or_default();
    assert!(t.contains("\ntitle: \"Q3: plan/budget\"\n"), "file Q3 plan budget.md with the full title: {t}");
    let o = read_text(&root, ODKAZY).unwrap_or_default();
    assert!(o.contains("\n[[Q3 plan budget|Q3: plan/budget]]\n"), "links are [[Q3 plan budget|Q3: plan/budget]]: {o}");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-7

#[test]
fn fr_fmt_08_ac7_no_op_commits_write_nothing() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let nfd = " Čaj o páté ".replace("Č", "C\u{30C}").replace("á", "a\u{301}").replace("é", "e\u{301}");
    for (path, title) in [(ALFA, "Alfa".to_string()), (ALFA, "  Alfa\t".to_string()), (CAJ, nfd)] {
        let before = snapshot(&root);
        let (_, report) = ok!(rename(&core, path, &title), "commit");
        assert_eq!(report.phase, Phase::Done, "{path} {title:?}: {report:?}");
        assert_eq!(report.written, Vec::<String>::new(), "{path} {title:?}: nothing written");
        assert_eq!(report.renamed, None, "{path} {title:?}: no rename");
        assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "{path} {title:?}: the vault is untouched");
    }
}

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-8

#[test]
fn fr_fmt_08_ac8_same_stem_different_title_writes_title_and_auto_aliases_only() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    write_raw(&root, "Pages/Q3 plan budget.md", "---\nid: 01JB4C0000000000000000R301\ntype: page\ntitle: \"Q3: plan/budget\"\nmodified: 2026-10-01T09:00:00+02:00\n---\nPlán.\n".as_bytes());
    let linking = "---\nid: 01JB4C0000000000000000R302\ntype: page\ntitle: Plánování\n---\nAuto: [[Q3 plan budget|Q3: plan/budget]]\n\nVlastní: [[Q3 plan budget|jiný text]]\n";
    write_raw(&root, "Pages/Plánování.md", linking.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, "Pages/Q3 plan budget.md", "Q3 plan budget?"), "commit Q3 plan budget?");
    assert_eq!(report.renamed, None, "same stem: no file is renamed: {report:?}");
    let t = read_text(&root, "Pages/Q3 plan budget.md").unwrap_or_default();
    assert!(t.contains("\ntitle: Q3 plan budget?\n"), "title: written plain, quoted only when YAML requires it (dialect §3): {t}");
    assert_eq!(
        read_text(&root, "Pages/Plánování.md"),
        Some(linking.replace("[[Q3 plan budget|Q3: plan/budget]]", "[[Q3 plan budget|Q3 plan budget?]]")),
        "the auto-alias equal to the old title is updated, the other alias kept (D-383)"
    );
    assert_eq!(changed(&before, &snapshot(&root)), set(&["Pages/Q3 plan budget.md", "Pages/Plánování.md"]), "nothing else changes");
}

/// The fixture with Alfa as `Pages/alfa.md` titled `alfa`, without the other `Alfa` stems (Projekty/Alfa.md,
/// Pages/Alfa (2).md), so the case-only change meets no other same-stem file (see the AP note in the red-commit report).
fn lower_alfa_vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = rename_vault(sb);
    let t = fixture_text(ALFA).replace("title: Alfa", "title: alfa").replace("[[Alfa#Úvod]]", "[[alfa#Úvod]]");
    std::fs::remove_file(root.join(ALFA)).expect("setup");
    write_raw(&root, "Pages/alfa.md", t.as_bytes());
    std::fs::remove_dir_all(root.join("Projekty")).expect("setup");
    std::fs::remove_file(root.join(DVOJNIK)).expect("setup");
    write_raw(&root, "Pages/Malá.md", "---\nid: 01JB4C0000000000000000R303\ntype: page\ntitle: Malá\n---\nMalým: [[alfa]]\n".as_bytes());
    root
}

#[test]
fn fr_fmt_08_ac8_case_only_change_renames_on_case_insensitive_apfs() {
    let sb = sandbox();
    let root = lower_alfa_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, "Pages/alfa.md", "Alfa"), "commit alfa → Alfa");
    assert_eq!(report.renamed, Some(("Pages/alfa.md".to_string(), ALFA.to_string())), "{report:?}");
    let names: Vec<String> = std::fs::read_dir(root.join("Pages")).expect("list").map(|e| nfc(&e.expect("entry").file_name().to_string_lossy())).collect();
    assert!(names.iter().any(|n| n == "Alfa.md") && !names.iter().any(|n| n == "alfa.md"), "the directory listing shows Alfa.md: {names:?}");
    assert_eq!(read_text(&root, "Pages/Malá.md").as_deref(), Some("---\nid: 01JB4C0000000000000000R303\ntype: page\ntitle: Malá\n---\nMalým: [[Alfa]]\n"), "links follow the new spelling");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-10

#[test]
fn fr_fmt_08_ac10_stem_chosen_at_the_jobs_start_never_over_a_new_file() {
    // (a) Pages/Gama.md created externally after the vault opened, before the commit.
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, true), "open");
    let external = "Cizí soubor vytvořený jinde.\n";
    write_raw(&root, GAMA, external.as_bytes());
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "commit Gama");
    assert_eq!(report.renamed, Some((ALFA.to_string(), "Pages/Gama (2).md".to_string())), "(a) {report:?}");
    assert_eq!(read_text(&root, GAMA).as_deref(), Some(external), "(a) the external file is never overwritten");
    assert!(read_text(&root, ODKAZY).unwrap_or_default().contains("\n[[Gama (2)]]\n"), "(a) links follow to Gama (2)");

    // (b) created after the plan chose `Gama` (the sync simulator at the named point AfterPlanning).
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let r2 = root.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if *p == JobPoint::AfterPlanning && !r2.join(GAMA).exists() {
            std::fs::write(r2.join(GAMA), "Cizí soubor vytvořený jinde.\n").expect("external create");
        }
    })));
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "commit Gama");
    assert_eq!(report.renamed, Some((ALFA.to_string(), "Pages/Gama (2).md".to_string())), "(b) RENAME_EXCL fails over to the next free stem: {report:?}");
    assert_eq!(read_text(&root, GAMA).as_deref(), Some(external), "(b) the external file is never overwritten");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-10, AC-11, data-safety AC-3

#[test]
fn fr_syn_06_ac10_planned_file_with_equal_bytes_is_counted_unchanged_and_untouched() {
    // Odkazy's `[[Alfa]]`-spelled links resolve to `alfa.md`; after the case-only rename to `Alfa` their rewritten
    // bytes equal the current ones.
    let sb = sandbox();
    let root = lower_alfa_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(rename(&core, "Pages/alfa.md", "Alfa"), "commit alfa → Alfa");
    assert!(report.unchanged.iter().any(|p| nfc(p) == ODKAZY), "Odkazy counted unchanged: {report:?}");
    assert!(!report.written.iter().any(|p| nfc(p) == ODKAZY), "and not written");
    assert_eq!(before.get(ODKAZY), snapshot(&root).get(ODKAZY), "Odkazy untouched (bytes, mtime, inode)");
}

#[test]
fn fr_syn_06_ac3_bulk_rename_writes_only_files_whose_content_changes() {
    let sb = sandbox();
    let root = lower_alfa_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    ok!(rename(&core, "Pages/alfa.md", "Alfa"), "rename");
    let ch = changed(&before, &snapshot(&root));
    assert_eq!(ch, set(&["Pages/alfa.md", ALFA, "Pages/Malá.md"]), "only the renamed note and the file whose links change; Odkazy, Vlastnosti, Den, the template and Windows keep their bytes, mtime and inode");
}

#[test]
fn fr_syn_06_ac11_one_write_per_file_and_title_plus_rename_in_one_step() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    ok!(rename(&core, ALFA, "Gama"), "rename");
    let ops = fs.ops();
    for p in [ODKAZY, VLASTNOSTI, DEN, SABLONA, WINDOWS] {
        let n = ops.iter().filter(|(op, path, _)| path == p && (op == "replace" || op == "create_new" || op.starts_with("rename_from:"))).count();
        assert_eq!(n, 1, "{p} is written exactly once ({ops:?})", ops = ops.iter().map(|(o, p, _)| format!("{o} {p}")).collect::<Vec<_>>());
    }
    let to_gama: Vec<_> = ops.iter().filter(|(op, path, _)| path == GAMA && op != "remove_file").collect();
    assert!(!to_gama.is_empty(), "Pages/Gama.md is created");
    for (op, _, bytes) in &to_gama {
        let t = String::from_utf8_lossy(bytes);
        assert!(t.contains("\ntitle: Gama\n") && !t.contains("\ntitle: Alfa\n"), "{op}: Pages/Gama.md never holds title: Alfa");
    }
    assert!(!ops.iter().any(|(op, path, _)| path == ALFA && (op == "replace" || op == "create_new")), "Pages/Alfa.md is never rewritten in place before the rename (one atomic step)");
}

// ------------------------------------------------------------------------------------------------ the plan (ms4-jobs §2.1)

#[test]
fn fr_lnk_03_ac7_plan_lists_the_note_and_every_linking_file_with_retarget_ops() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, _) = ok!(rename(&core, ALFA, "Gama"), "rename");
    let plan = some!(core.jobs().plan(job), "the plan of the job");
    let files: BTreeSet<String> = plan.files.iter().map(|f| nfc(&f.path)).collect();
    assert_eq!(files, set(&[ALFA, ODKAZY, VLASTNOSTI, DEN, SABLONA, WINDOWS]), "planned files: the note and every file with a link resolving to it");
    assert_eq!(plan.renames, vec![(ALFA.to_string(), GAMA.to_string())], "one rename pair");
    let odk = plan.files.iter().find(|f| nfc(&f.path) == ODKAZY);
    let ok_op = odk.map(|f| f.ops.iter().any(|o| matches!(o, TextOp::RetargetLinks { from_path, to_path, to_stem, .. } if from_path == ALFA && to_path == GAMA && to_stem == "Gama"))).unwrap_or(false);
    assert!(ok_op, "Odkazy's op retargets Pages/Alfa.md → Pages/Gama.md");
}
