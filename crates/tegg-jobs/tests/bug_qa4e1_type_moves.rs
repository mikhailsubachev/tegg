//! Regression tests for the QA review of slice 4E-1 (`qa/reviews/4e-1-type-moves.md`): backup labels (finding 2), the
//! interrupted banner's kind and title (3), R101 in Rust (4, D-833), Finish of a type move whose target was taken (6),
//! exemptions by path for notes without an `id` (12, D-839), Undo of a folder save restoring `folder:` (21, D-840) and
//! links a move would take over (11, D-838). On the type-moves fixture with the real `@tegg/doc` transformer.

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use std::sync::Arc;
use std::time::Duration;

use common::{open_core, read_bytes, read_text, sandbox, write_raw};
use moves_setup::*;
use tegg_jobs::{JobOp, JobPoint, Phase, ResolveChoice};

fn run(core: &tegg_core::Core, op: JobOp) -> Result<(tegg_jobs::JobId, tegg_jobs::JobReport), String> {
    common::run_job(core, op)
}

#[test]
fn bug_qa4e1_fr_his_04_ac11_backup_labels_name_the_plural_and_the_type() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run(&core, folder_save("kniha", "Četba")), "folder save");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let (_, r) = ok!(run(&core, type_move(&[PLAN, SESIT_Q], "kniha", vec![], true)), "bulk convert");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let labels: Vec<(String, serde_json::Value)> = core.backups().into_iter().map(|b| (b.label.key, b.label.args)).collect();
    assert!(labels.iter().any(|(k, a)| k == "backups.label.folderMove" && a["plural"] == "knihy" && a["folder"] == "Četba"), "`Move knihy to Četba`: {labels:?}");
    assert!(labels.iter().any(|(k, a)| k == "backups.label.typeMove" && a["type"] == "Kniha" && a["count"] == 2), "`Change type of 2 objects to Kniha`: {labels:?}");
}

#[test]
fn bug_qa4e1_fr_sto_04_ac5_r101_in_rust() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let p = core.type_move_plan(&[DUNA.to_string()], "schůzka");
    assert!(p.needs_dialog, "Duna › Schůzka needs the dialog");
    let row = |k: &str| p.rows.iter().find(|r| r.from == k).cloned().unwrap_or_else(|| panic!("row {k}: {:?}", p.rows));
    let keys = |k: &str| row(k).offered.into_iter().map(|(k, _)| k).collect::<Vec<_>>();
    assert_eq!((row("stav").default, row("stav").fixed), ("stav".to_string(), true), "Stav is fixed");
    assert_eq!(row("vydáno").default, "content", "Vydáno defaults to Content");
    assert_eq!(keys("vydáno"), vec!["datum".to_string(), "místo".to_string()], "Datum (Date) and Místo (Date → Text widens)");
    assert_eq!(keys("související"), vec!["místo".to_string()], "Relation → Text widens; Účastníci (Osoba only) is narrower (D-808)");
    assert_eq!(row("isbn").value, None, "ISBN is empty");
    let q = core.type_move_plan(&[PLAN.to_string()], "kniha");
    assert!(!q.needs_dialog && q.rows.is_empty(), "Plán (Quick Note, no schema) › Kniha needs no dialog: {q:?}");
}

#[test]
fn bug_qa4e1_fr_sto_04_ac14_an_interrupted_type_move_names_its_kind_and_title() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    {
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        core.jobs().set_point_hook(Some(Arc::new(|_, p: &JobPoint| {
            if matches!(p, JobPoint::AfterRead { path } if path == ODKAZY) {
                panic!("simulated kill after the note's rename");
            }
        })));
        ok!(core.jobs().start(type_move(&[PLAN], "kniha", vec![], false)), "start");
        std::thread::sleep(Duration::from_millis(1500));
    }
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "{i:?}");
    assert_eq!((i[0].kind.as_str(), i[0].title.as_deref()), ("type-move", Some("Plán")), "the banner is `Changing the type of \"Plán\"…`");
}

#[test]
fn bug_qa4e1_fr_sto_04_ac14_finish_moves_no_link_when_the_note_cannot_move() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    {
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        core.jobs().set_point_hook(Some(Arc::new(|_, p: &JobPoint| {
            if matches!(p, JobPoint::TempWritten { path } if path == PLAN) {
                panic!("simulated kill before the note's rename");
            }
        })));
        ok!(core.jobs().start(type_move(&[PLAN], "kniha", vec![], false)), "start");
        std::thread::sleep(Duration::from_millis(1500));
    }
    assert!(root.join(PLAN).exists(), "setup: the note was not moved");
    // Another note takes the target name before Finish.
    write_raw(&root, "Knihy/Plán.md", "---\nid: 01JB4E0000000000000000E0F1\ntype: kniha\ntitle: Jiný plán\n---\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "{i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Finish), "Finish");
    assert_eq!(read_text(&root, ODKAZY), Some(fx(ODKAZY)), "no link points at the other note (ms4-jobs §8, D-433)");
    assert_eq!(read_bytes(&root, PLAN), Some(fx_bytes(PLAN)), "the note stays where it was");
}

#[test]
fn bug_qa4e1_fr_sto_01_ac12_an_undone_stray_without_id_stays_exempt_by_path() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let stray = "Pages/Bez id.md";
    write_raw(&root, stray, "---\ntype: kniha\ntitle: Bez id\n---\nObsidian.\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, r) = ok!(run(&core, tidy()), "tidy");
    assert!(root.join("Knihy/Bez id.md").exists(), "setup: moved: {r:?}");
    ok!(run(&core, JobOp::Undo { job }), "undo");
    assert!(root.join(stray).exists(), "back in Pages/");
    let paths = tidy_exempt(&sb.dirs).and_then(|v| v["paths"].as_array().cloned()).unwrap_or_default();
    assert!(paths.iter().any(|p| p == stray), "exempt by path (D-839): {paths:?}");
    ok!(run(&core, tidy()), "tidy again");
    assert!(root.join(stray).exists(), "the next tidy run leaves it");
}

#[test]
fn bug_qa4e1_fr_sto_01_ac8_undo_of_a_folder_save_restores_the_folder() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = read_bytes(&root, KNIHA_YML);
    let (job, r) = ok!(run(&core, folder_save("kniha", "Četba")), "folder save");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    ok!(run(&core, JobOp::Undo { job }), "undo");
    assert_eq!(read_bytes(&root, KNIHA_YML), before, "kniha.yml has its old folder again (D-840)");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna is back in Knihy/");
    let ex = tidy_exempt(&sb.dirs).map(|v| (v["ids"].as_array().map(|a| a.len()).unwrap_or(0), v["paths"].as_array().map(|a| a.len()).unwrap_or(0)));
    assert!(ex.is_none_or(|(i, p)| i == 0 && p == 0), "a folder save's Undo exempts nothing: {ex:?}");
}

#[test]
fn bug_qa4e1_fr_sto_04_ac7_a_link_to_a_duplicate_keeps_its_target() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    // Two same-stem notes (from Obsidian); a note in Knihy/ links the other one by name.
    write_raw(&root, "Knihy/Odkaz na trasu.md", "---\nid: 01JB4E0000000000000000E0F2\ntype: kniha\ntitle: Odkaz na trasu\n---\nViz [[Plán cesty]].\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = core.resolve_links("Knihy/Odkaz na trasu.md", &["Plán cesty".to_string()]);
    let (_, r) = ok!(run(&core, type_move(&[PLAN_CESTY_Q], "kniha", vec![], false)), "Plán cesty (QN) › Kniha");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let t = read_text(&root, "Knihy/Odkaz na trasu.md").unwrap_or_default();
    let target = before.first().and_then(|x| x.path.clone()).map(|p| tegg_format::nfc(&p));
    let now = core.resolve_links("Knihy/Odkaz na trasu.md", &[t.split("[[").nth(1).and_then(|x| x.split(['|', ']']).next()).unwrap_or("").to_string()]);
    assert_eq!(now.first().and_then(|x| x.path.clone()).map(|p| tegg_format::nfc(&p)), target, "the link still reaches the note it reached before the move (D-838): {t}");
}
