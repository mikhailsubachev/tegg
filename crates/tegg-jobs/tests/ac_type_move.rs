//! Slice 4E-1 AC tests of the `type-move` job (L4): docs/acceptance/type-moves.md FR-STO-04 AC-4…AC-14 (L4 parts),
//! FR-INB-02 AC-17, and of "Both parts" FR-HIS-04 AC-11 (a single-note move makes no zip; a bulk one zips first) and
//! FR-SYN-06 AC-36 (type-move part), on a temporary copy of the type-moves fixture on APFS with the real `@tegg/doc`
//! as transformer (`NodeTransformer`, D-82; `npm run build --prefix packages/doc`).
//! Interface: docs/contracts/ms4-jobs.md §14.1 (kinds), §14.2 (`JobOp::TypeMove { paths, to_type, mapping, review }`,
//! `PropertyMap`, `MapTarget`, `JobError::NotMovable`, `UnknownType`, `NoChange`), §14.3 (planner), §14.5 (writes),
//! §14.6 (undo, the §8 journal of a single move), and §4…§8 (start, plan, wait, undo, interrupted).
//! Written from the ACs and the contracts only (D-61). Every API result goes through `ok!`/`some!` or an `assert!`
//! here, so the 4E-1 stubs (`start` answers `NotImplemented`) fail on assertions (TS-I1).
//!
//! The core is opened without the watcher, so it starts no tidy job (red-test point AP-774: the tidy job of ms4-jobs
//! §14.7 runs only on a core that watches the vault; the tidy tests are in ac_folder_move.rs). The L4 clock is the
//! machine's (`Host::now`), so `modified` is checked as "changed, ISO with offset" and masked in byte comparisons.

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use common::{changed, open_core, open_core_with, read_bytes, read_text, sandbox, set, snapshot, write_raw, RecordingFs};
use moves_setup::*;
use tegg_jobs::{JobError, JobKind, JobOp, JobPoint, Phase, ResolveChoice, SkipReason};

fn run(core: &tegg_core::Core, op: JobOp) -> Result<(tegg_jobs::JobId, tegg_jobs::JobReport), String> {
    common::run_job(core, op)
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    files_only(s)
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-4

#[test]
fn fr_sto_04_ac4_no_dialog_case_moves_plan_to_knihy_at_once() {
    let f = JobKind::TypeMove.flags();
    assert_eq!((f.needs_confirm, f.undoable), (false, true), "type-move: no confirm step, undoable (ms4-jobs §14.1)");
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let counts0 = core.type_counts();
    let before = snapshot(&root);
    let (job, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "done: {report:?}");
    assert_eq!(report.kind, JobKind::TypeMove, "kind type-move");
    assert!(!root.join(PLAN).exists(), "Quick Notes/Plán.md is gone");
    let t = some!(read_text(&root, "Knihy/Plán.md"), "Knihy/Plán.md");
    assert_eq!(masked(&t), plan_moved(), "type: kniha, a new modified, no Kniha property added, review unchanged (D-224), same id");
    let m = some!(modified_of(&t), "modified");
    assert_ne!(Some(m.clone()), modified_of(&fx(PLAN)), "modified changes");
    assert!(is_iso_with_offset(m.trim_start_matches("modified: ")), "modified is ISO 8601 with offset: {m}");
    assert_eq!(report.renamed, Some((PLAN.to_string(), "Knihy/Plán.md".to_string())), "the report names the move");
    // One rename: the new path gets the final bytes in one step; the old path is only removed (FR-SYN-06 AC-11).
    let ops = fs.ops();
    let at_new: Vec<_> = ops.iter().filter(|(_, p, _)| p == "Knihy/Plán.md").collect();
    assert_eq!(at_new.len(), 1, "one write lands at Knihy/Plán.md: {:?}", ops.iter().map(|(o, p, _)| format!("{o} {p}")).collect::<Vec<_>>());
    assert_eq!(masked(&String::from_utf8_lossy(&at_new[0].2)), plan_moved(), "and it holds the final bytes");
    assert!(ops.iter().filter(|(_, p, _)| p == PLAN).all(|(o, _, _)| o == "remove_file"), "the old path is never rewritten in place");
    let o = some!(core.object("Knihy/Plán.md"), "the index has Knihy/Plán.md");
    assert_eq!(o.id.as_deref(), Some(PLAN_ID), "the id is unchanged");
    assert!(core.object(PLAN).is_none(), "the index no longer has the old path");
    let counts1 = core.type_counts();
    assert_eq!(
        (counts1.get("quick-note").copied().unwrap_or(0) + 1, counts1.get("kniha").copied().unwrap_or(0)),
        (counts0.get("quick-note").copied().unwrap_or(0), counts0.get("kniha").copied().unwrap_or(0) + 1),
        "Quick Notes −1, Knihy +1"
    );
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "a single-note type move makes no zip (board G)");
    assert_eq!(core.jobs().last_undoable(), Some(job), "undoable");
    let ch = files(changed(&before, &snapshot(&root)));
    assert_eq!(ch, set(&[PLAN, "Knihy/Plán.md", ODKAZY]), "Plán moves and Odkazy's path forms follow; nothing else");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-6

#[test]
fn fr_sto_04_ac6_duna_to_schuzka_is_the_board_a2_file() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run(&core, type_move(&[DUNA], "schůzka", duna_mapping(), false)), "type-move Duna › Schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert!(!root.join(DUNA).exists(), "Knihy/Duna.md is gone");
    let t = some!(read_text(&root, "Schůzky/Duna.md"), "Schůzky/Duna.md");
    assert_eq!(
        masked(&t),
        duna_as_schuzka(),
        "vydáno renamed in place to datum; Content lines in old schema order then one blank line; # od koho goes with poznámka; nálada stays; stav kept as written"
    );
    assert_ne!(modified_of(&t), modified_of(&fx(DUNA)), "a new modified");
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[DUNA, "Schůzky/Duna.md"]), "[[Duna]] links keep resolving by stem: no other file");
}

#[test]
fn fr_sto_04_ac6_content_lines_drop_quotes_and_keep_crlf() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run(&core, type_move(&[BABICKA], "osoba", kniha_to_osoba(), false)), "type-move Babička › Osoba");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let t = some!(read_text(&root, "Osoby/Babička.md"), "Osoby/Babička.md");
    let want = masked(&fx_swap(BABICKA, &[
        ("type: kniha", "type: osoba"),
        ("autor: 'Božena Němcová'\r\nstav: Rozečtená\r\n", ""),
        ("---\r\nBabička a vnoučata.", "---\r\n**Autor:** Božena Němcová\r\n**Stav:** Rozečtená\r\n\r\nBabička a vnoučata."),
    ]));
    assert_eq!(masked(&t), want, "quotes dropped (AP-768), CRLF kept on every line, still no final newline");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-7

#[test]
fn fr_sto_04_ac7_incoming_links_keep_resolving_odkazy_written_once() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = RecordingFs::new(&root);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    assert!(core.backlinks(PLAN).iter().any(|p| p == ODKAZY), "setup: Odkazy links to Plán before");
    let before = snapshot(&root);
    let (_, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, ODKAZY), Some(odkazy_after_plan()), "only the path forms change; [[Plán]], #Cíl, the alias, the embed and the code span stay");
    let writes: Vec<_> = fs.ops().into_iter().filter(|(o, p, _)| p == ODKAZY && o != "remove_file").collect();
    assert_eq!(writes.len(), 1, "Odkazy is written once");
    let after = snapshot(&root);
    for v in vypln() {
        assert_eq!(before.get(&v), after.get(&v), "{v}: bytes, mtime and inode unchanged");
    }
    assert!(core.backlinks("Knihy/Plán.md").iter().any(|p| p == ODKAZY), "Plán's backlinks list Odkazy after the move");
    let r = core.resolve_links(ODKAZY, &["Plán".to_string(), "Knihy/Plán".to_string()]);
    assert_eq!(r.iter().map(|x| x.path.clone().map(|p| tegg_format::nfc(&p))).collect::<Vec<_>>(), vec![Some("Knihy/Plán.md".to_string()); 2], "[[Plán]] and [[Knihy/Plán]] resolve to the moved note");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-8

#[test]
fn fr_sto_04_ac8_the_moved_notes_own_links_keep_their_targets() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let targets = vec!["Plán cesty".to_string(), "Duna".to_string()];
    let before: Vec<_> = core.resolve_links(PLAN, &targets).into_iter().map(|x| x.path).collect();
    assert_eq!(before, vec![Some(PLAN_CESTY_Q.to_string()), Some(DUNA.to_string())], "setup: [[Plán cesty]] resolves in its own folder first (D-291)");
    let (_, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let t = some!(read_text(&root, "Knihy/Plán.md"), "Knihy/Plán.md");
    assert_eq!(masked(&t), plan_moved(), "[[Quick Notes/Plán cesty|Plán cesty]], [Rozpis](<../Quick Notes/Plán cesty.md>), [[Duna]] unchanged");
    let after: Vec<_> = core
        .resolve_links("Knihy/Plán.md", &["Quick Notes/Plán cesty".to_string(), "Duna".to_string()])
        .into_iter()
        .map(|x| x.path)
        .collect();
    assert_eq!(after, before, "every link of Plán resolves to the same file before and after");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-9

#[test]
fn fr_sto_04_ac9_a_taken_stem_gets_a_suffix_and_the_link_an_alias() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run(&core, type_move(&[SESIT_Q], "kniha", vec![], false)), "type-move Sešit (QN) › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert!(!root.join(SESIT_Q).exists(), "Quick Notes/Sešit.md is gone");
    let t = some!(read_text(&root, "Knihy/Sešit (2).md"), "Knihy/Sešit (2).md (vault-wide free stem, D-291)");
    assert_eq!(masked(&t), masked(&fx_swap(SESIT_Q, &[("type: quick-note", "type: kniha")])), "title: Sešit unchanged");
    assert_eq!(read_text(&root, NA_SESIT), Some(fx_swap(NA_SESIT, &[("[[Sešit]]", "[[Sešit (2)|Sešit]]")])), "[[Sešit]] becomes [[Sešit (2)|Sešit]]");
    let r = core.resolve_links(NA_SESIT, &["Sešit (2)".to_string()]);
    assert_eq!(r.first().and_then(|x| x.path.clone()), Some("Knihy/Sešit (2).md".to_string()), "and resolves to the moved note");
    let after = snapshot(&root);
    assert_eq!(before.get(SESIT_K), after.get(SESIT_K), "Sešit (K) is not written");
    assert_eq!(files(changed(&before, &after)), set(&[SESIT_Q, "Knihy/Sešit (2).md", NA_SESIT]), "nothing else");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-10

#[test]
fn fr_sto_04_ac10_every_object_goes_to_the_root_of_its_new_types_folder() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, r1) = ok!(run(&core, type_move(&[STARY], "osoba", kniha_to_osoba(), false)), "Starý zápis › Osoba");
    let (_, r2) = ok!(run(&core, type_move(&[JINDE], "osoba", kniha_to_osoba(), false)), "Kniha jinde › Osoba");
    assert_eq!((r1.phase, r2.phase), (Phase::Done, Phase::Done), "{r1:?} {r2:?}");
    let s = some!(read_text(&root, "Osoby/Starý zápis.md"), "Osoby/Starý zápis.md (from Knihy/2025/)");
    assert_eq!(masked(&s), masked(&fx_swap(STARY, &[("type: kniha", "type: osoba"), ("autor: Neznámý\n", ""), ("---\nPoznámky", "---\n**Autor:** Neznámý\n\nPoznámky")])), "Starý zápis bytes");
    let j = some!(read_text(&root, "Osoby/Kniha jinde.md"), "Osoby/Kniha jinde.md (from Pages/)");
    assert_eq!(masked(&j), masked(&fx_swap(JINDE, &[("type: kniha", "type: osoba"), ("autor: Karel Čapek\n", ""), ("---\nVálka", "---\n**Autor:** Karel Čapek\n\nVálka")])), "Kniha jinde bytes");
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[STARY, JINDE, "Osoby/Starý zápis.md", "Osoby/Kniha jinde.md"]), "nothing else");
}

#[test]
fn fr_sto_04_ac10_a_template_changes_only_its_type_line_and_never_moves() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run(&core, type_move(&[T_KNIHA], "osoba", kniha_to_osoba(), false)), "type-move of _templates/Kniha/Kniha.md");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, T_KNIHA), Some(fx_swap(T_KNIHA, &[("type: kniha", "type: osoba")])), "only `type:` is written (ms4-jobs §14.2)");
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[T_KNIHA]), "the template stays where it is");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-11

#[test]
fn fr_sto_04_ac11_undo_and_redo_of_duna_restore_the_exact_bytes() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run(&core, type_move(&[DUNA], "schůzka", duna_mapping(), false)), "type-move Duna › Schůzka");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let moved = some!(read_bytes(&root, "Schůzky/Duna.md"), "Schůzky/Duna.md");
    assert_eq!(core.jobs().last_undoable(), Some(job), "the last undoable job (palette `Undo type change`)");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Knihy/Duna.md has its exact pre-change bytes");
    assert!(!root.join("Schůzky/Duna.md").exists(), "and is no longer in Schůzky/");
    let (_, r) = ok!(run(&core, JobOp::Redo { job }), "redo");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    assert_eq!(read_bytes(&root, "Schůzky/Duna.md"), Some(moved), "⇧⌘Z re-applies the same bytes");
    assert!(!root.join(DUNA).exists(), "Knihy/Duna.md is gone again");
}

#[test]
fn fr_sto_04_ac11_undo_restores_linking_notes_and_skips_a_file_changed_since() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, PLAN), Some(fx_bytes(PLAN)), "Plán back with its exact bytes");
    assert_eq!(read_bytes(&root, ODKAZY), Some(fx_bytes(ODKAZY)), "Odkazy back with its exact bytes");
    // A second round: Odkazy changed by another program after the move is left alone and listed.
    let (job2, _) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move again");
    let theirs = odkazy_after_plan() + "\nDopsáno jinde.\n";
    write_raw(&root, ODKAZY, theirs.as_bytes());
    let (_, u2) = ok!(run(&core, JobOp::Undo { job: job2 }), "undo again");
    assert_eq!(read_text(&root, ODKAZY), Some(theirs), "the changed file is not touched");
    assert_eq!(u2.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(ODKAZY.to_string(), SkipReason::Changed)], "and is listed");
    assert_eq!(read_bytes(&root, PLAN), Some(fx_bytes(PLAN)), "the note itself moves back");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-12

/// `start` refuses with `want`, or the job ends `failed` naming it; either way nothing is written.
fn refused(core: &tegg_core::Core, op: JobOp, want: &str) -> Result<(), String> {
    match core.jobs().start(op.clone()) {
        Err(e) => {
            let got = format!("{e:?}");
            if got.starts_with(want) { Ok(()) } else { Err(format!("{op:?}: refused with {got}, not {want}")) }
        }
        Ok(job) => match core.jobs().wait(job, Duration::from_secs(30)) {
            Some(r) if r.phase == Phase::Failed && r.error.as_deref().unwrap_or("").contains(want) => Ok(()),
            other => Err(format!("{op:?}: not refused with {want}: {other:?}")),
        },
    }
}

#[test]
fn fr_sto_04_ac12_daily_tag_image_pdf_trash_and_non_utf8_are_not_movable() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, "Daily/2026-10-27.md", b"---\nid: 01JB4E0000000000000000E091\ntype: daily-note\ntitle: \"2026-10-27\"\ndate: 2026-10-27\n---\nDnes.\n");
    write_raw(&root, "Tags/čtení.md", b"---\nid: 01JB4E0000000000000000E092\ntype: tag\ntitle: \xc4\x8dten\xc3\xad\n---\n");
    write_raw(&root, "Images/Fotka.md", b"---\nid: 01JB4E0000000000000000E093\ntype: image\ntitle: Fotka\nfile: \"[[fotka.png]]\"\n---\n");
    write_raw(&root, "PDFs/Smlouva.md", b"---\nid: 01JB4E0000000000000000E094\ntype: pdf\ntitle: Smlouva\nfile: \"[[smlouva.pdf]]\"\n---\n");
    write_raw(&root, ".trash/Pages/Starý.md", "---\nid: 01JB4E0000000000000000E095\ntype: page\ntitle: Starý\n---\nSmazaný.\n".as_bytes());
    // A Latin-1 copy of Babička (every character above U+00FF as `?`): not valid UTF-8 (D-180).
    let latin1: Vec<u8> = fx(BABICKA).chars().map(|c| if (c as u32) <= 0xFF { c as u32 as u8 } else { b'?' }).collect();
    write_raw(&root, "Knihy/Babička latin1.md", &latin1);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let mut bad = Vec::new();
    for p in ["Daily/2026-10-27.md", "Tags/čtení.md", "Images/Fotka.md", "PDFs/Smlouva.md", ".trash/Pages/Starý.md", "Knihy/Babička latin1.md"] {
        if let Err(e) = refused(&core, type_move(&[p], "page", vec![], false), "NotMovable") {
            bad.push(e);
        }
    }
    for to in ["daily-note", "tag", "image", "pdf"] {
        if let Err(e) = refused(&core, type_move(&[PLAN], to, vec![], false), "NotMovable") {
            bad.push(e);
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "Daily Note, Tag, Image and PDF are neither sources nor targets; .trash/ and non-UTF-8 files are refused (NotMovable)");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "nothing is written");
    // A movable note is moved, so the refusals above are not a general failure.
    let (_, ok_report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "a movable note");
    assert_eq!(ok_report.phase, Phase::Done, "{ok_report:?}");
}

#[test]
fn fr_sto_04_ac12_unknown_type_and_no_change_write_nothing() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let unknown = core.jobs().start(type_move(&[PLAN], "neexistuje", vec![], false));
    assert!(matches!(unknown, Err(JobError::UnknownType)), "a type without a definition: UnknownType (ms4-jobs §14.2): {unknown:?}");
    let same = core.jobs().start(type_move(&[DUNA], "kniha", vec![], false));
    assert!(matches!(same, Err(JobError::NoChange)), "the note's current type: NoChange: {same:?}");
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "nothing is written");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-13

#[test]
fn fr_sto_04_ac13_an_nfd_name_is_written_nfc_and_the_title_bytes_stay() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    write_raw(&root, "Pages/Na nápad.md", "---\nid: 01JB4E0000000000000000E096\ntype: page\ntitle: Na nápad\n---\n[[Nápad]]\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let src = some!(core.objects().into_iter().find(|o| o.id.as_deref() == Some("01JB4E0000000000000000E019")).map(|o| o.path), "Nápad in the index");
    let (_, report) = ok!(run(&core, type_move(&[src.as_str()], "kniha", vec![], false)), "type-move Nápad NFD › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let names = raw_names(&root.join("Knihy"));
    assert!(names.contains(&"Nápad.md".as_bytes().to_vec()), "Knihy/Nápad.md with an NFC name: {:?}", names.iter().map(|n| String::from_utf8_lossy(n).into_owned()).collect::<Vec<_>>());
    assert!(!names.contains(&nfd("Nápad.md").into_bytes()), "no NFD name in Knihy/");
    let t = some!(read_text(&root, "Knihy/Nápad.md"), "Knihy/Nápad.md");
    assert!(t.contains(&format!("\ntitle: {}\n", nfd("Nápad"))), "the title bytes are unchanged (NFD)");
    assert_eq!(core.resolve_link("Nápad").map(|p| tegg_format::nfc(&p)), Some("Knihy/Nápad.md".to_string()), "links to it keep resolving");
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-14

/// Starts Plán › Kniha and kills the job at Odkazy's read (after the note's rename), as bug_45_review.rs does.
fn killed_before_odkazy(root: &std::path::Path, dirs: &tegg_vault::AppDirs) -> Result<(), String> {
    let core = open_core(root, dirs, false)?;
    core.jobs().set_point_hook(Some(Arc::new(|_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { path } if path == ODKAZY) {
            panic!("simulated SIGKILL between the note's rename and Odkazy's rewrite");
        }
    })));
    core.jobs().start(type_move(&[PLAN], "kniha", vec![], false)).map_err(|e| format!("start: {e:?}"))?;
    std::thread::sleep(Duration::from_millis(1500));
    drop(core);
    Ok(())
}

#[test]
fn fr_sto_04_ac14_crash_between_the_rename_and_odkazy_then_finish() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    ok!(killed_before_odkazy(&root, &sb.dirs), "the interrupted move");
    assert!(root.join("Knihy/Plán.md").exists() && !root.join(PLAN).exists(), "the note was renamed before the crash");
    assert_eq!(read_text(&root, ODKAZY), Some(fx(ODKAZY)), "Odkazy is its pre-job version (FR-SYN-02 AC-3)");
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted type change: {i:?}");
    assert_eq!((i[0].from.as_str(), i[0].to.as_str(), i[0].done, i[0].total), (PLAN, "Knihy/Plán.md", 0, 1), "`… 0 of 1 links updated`");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Finish), "Finish");
    assert!(core.wait_idle(Duration::from_secs(30)), "indexed");
    let end = std::time::Instant::now() + Duration::from_secs(10);
    while read_text(&root, ODKAZY) != Some(odkazy_after_plan()) && std::time::Instant::now() < end {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(read_text(&root, ODKAZY), Some(odkazy_after_plan()), "Finish rewrites Odkazy as AC-7");
    assert_eq!(core.jobs().interrupted(), vec![], "resolved");
}

#[test]
fn fr_sto_04_ac14_crash_between_the_rename_and_odkazy_then_undo() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    ok!(killed_before_odkazy(&root, &sb.dirs), "the interrupted move");
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted type change: {i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Undo), "Undo");
    assert!(core.wait_idle(Duration::from_secs(30)), "indexed");
    let end = std::time::Instant::now() + Duration::from_secs(10);
    while !root.join(PLAN).exists() && std::time::Instant::now() < end {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(read_bytes(&root, PLAN), Some(fx_bytes(PLAN)), "Undo moves the note back with its old bytes");
    assert!(!root.join("Knihy/Plán.md").exists(), "nothing left in Knihy/");
    assert_eq!(read_bytes(&root, ODKAZY), Some(fx_bytes(ODKAZY)), "Odkazy keeps its pre-job bytes");
}

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-17

#[test]
fn fr_inb_02_ac17_convert_maps_moves_and_marks_reviewed() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], true)), "Inbox convert Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.kind, JobKind::TypeMove, "one type-move job (replaces the inbox SetType, ms4-jobs §14.1)");
    let t = some!(read_text(&root, "Knihy/Plán.md"), "Knihy/Plán.md");
    assert_eq!(masked(&t), plan_moved().replace("review: unreviewed", "review: reviewed"), "type: kniha, review: reviewed and modified; links as AC-8");
    assert_eq!(read_text(&root, ODKAZY), Some(odkazy_after_plan()), "linking notes as AC-7");
    assert_eq!(core.jobs().last_undoable(), Some(job), "undoable");
    assert_eq!(zip_names(&sb.dirs), Vec::<String>::new(), "a single convert makes no zip");
}

#[test]
fn fr_inb_02_ac17_bulk_convert_zips_first_moves_each_and_undoes_all() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let unreviewed = fx_swap(SESIT_Q, &[("title: Sešit\n", "title: Sešit\nreview: unreviewed\n")]);
    write_raw(&root, SESIT_Q, unreviewed.as_bytes());
    let fs = tags_setup::FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let (job, report) = ok!(run(&core, type_move(&[PLAN, SESIT_Q], "kniha", vec![], true)), "bulk convert Plán + Sešit › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let z = zip_names(&sb.dirs);
    assert_eq!(z.len(), 1, "one zip for the bulk convert: {z:?}");
    assert!(z[0].ends_with("-type-move.zip"), "<UTC time>-type-move.zip: {}", z[0]);
    assert_eq!(fs.zip_before_first_write(), Some(true), "the zip exists before the first vault write (FR-HIS-04 AC-11)");
    assert!(root.join("Knihy/Plán.md").exists() && root.join("Knihy/Sešit (2).md").exists(), "each item moved");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_bytes(&root, PLAN), Some(fx_bytes(PLAN)), "Plán restored");
    assert_eq!(read_text(&root, SESIT_Q), Some(unreviewed), "Sešit restored");
    assert_eq!(read_bytes(&root, ODKAZY), Some(fx_bytes(ODKAZY)), "Odkazy restored");
    assert_eq!(read_bytes(&root, NA_SESIT), Some(fx_bytes(NA_SESIT)), "Odkaz na sešit restored");
}

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-11, FR-SYN-06 AC-36

#[test]
fn fr_his_04_ac11_a_bulk_type_move_with_a_failed_zip_writes_nothing() {
    let f = JobKind::TypeMove.flags();
    assert!(f.cancellable.contains(&Phase::Backup), "a bulk type-move is cancellable in backup (ms4-jobs §14.1)");
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    tags_setup::read_only_backups(&sb.dirs);
    let before = snapshot(&root);
    let r = run(&core, type_move(&[PLAN, SESIT_Q], "kniha", vec![], false));
    tags_setup::writable_again(&sb.dirs);
    let (_, report) = ok!(r, "bulk type-move");
    assert_eq!(report.phase, Phase::Failed, "the job ends failed: {report:?}");
    assert!(report.error.as_deref().unwrap_or("").contains("BackupFailed"), "with BackupFailed: {:?}", report.error);
    assert_eq!(changed(&before, &snapshot(&root)), BTreeSet::new(), "the vault is byte-identical (data-safety AC-1)");
}

#[test]
fn fr_syn_06_ac36_a_type_move_writes_exactly_its_planned_files_and_undo_the_same() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let s0 = snapshot(&root);
    let (job, report) = ok!(run(&core, type_move(&[PLAN], "kniha", vec![], false)), "type-move Plán › Kniha");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let plan = some!(core.jobs().plan(job), "the plan");
    let mut planned: BTreeSet<String> = plan.files.iter().map(|f| f.path.clone()).collect();
    for (a, b) in &plan.renames {
        planned.insert(a.clone());
        planned.insert(b.clone());
    }
    let s1 = snapshot(&root);
    let wrote = files(changed(&s0, &s1));
    assert_eq!(wrote, planned, "the written files equal the plan's files");
    let (_, u) = ok!(run(&core, JobOp::Undo { job }), "undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    let s2 = snapshot(&root);
    assert_eq!(files(changed(&s1, &s2)), wrote, "Undo writes only the files the job wrote");
    for (p, e) in &s0 {
        if !wrote.contains(p) && !p.ends_with('/') {
            assert_eq!(s2.get(p), Some(e), "{p}: bytes, mtime and inode unchanged");
        }
    }
}
