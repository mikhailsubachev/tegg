//! MS4 slice 4D-lite AC tests of the `merge` job (L4): docs/acceptance/tags.md FR-LNK-14 AC-12 (what merge writes,
//! by byte diff), AC-13 (conflicts at job points; a change to the kept or merged object stops the merge before any
//! write, D-673), AC-14 (Tag files merge too), on a temporary copy of the tags fixture with the real `@tegg/doc`
//! engine (`NodeTransformer`). Interface: docs/contracts/ms4-tags.md §4.1 (`JobOp::Merge`, the merge planner,
//! `merge-into`, `RetargetLinks`, trash moves), ms4-jobs §4, §5 (retry, job points). Written from the ACs and the
//! contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use common::{changed, no_modified, open_core, open_core_with, read_text, sandbox, snapshot};
use tags_setup::*;
use tegg_format::nfc;
use tegg_jobs::{JobKind, JobOp, JobPoint, Phase, RetryOutcome, SkipReason};

fn merge_op(keep: &str, others: &[&str]) -> JobOp {
    JobOp::Merge { keep: keep.into(), others: others.iter().map(|s| s.to_string()).collect() }
}
fn files_only(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|p| !p.ends_with('/')).collect()
}
/// Schůzka after the merge (D-673; the `aliases` position is red-test point AP-609), `modified` blanked.
fn schuzka_merged() -> String {
    no_modified(
        &[
            "---",
            "id: 01JB4D0000000000000000G012",
            "type: page",
            "title: Schůzka",
            "x-místo: Brno",
            "aliases: [porada]",
            "tags: [čtení]",
            "created: 2026-09-01T09:00:00+02:00",
            "modified: x",
            "---",
            "Zápis A.",
            "",
            "## SCHŮZKA (merged)",
            "",
            "Zápis B.",
            "",
        ]
        .join("\n"),
    )
}

#[test]
fn fr_lnk_14_ac12_what_merge_writes() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let fs = FirstWriteFs::new(&root, &sb.dirs);
    let core = ok!(open_core_with(fs.clone(), &sb.dirs), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_confirmed(&core, merge_op(SCHUZKA, &[SCHUZKA2])), "merge Schůzka ← schůzka (2)");
    assert_eq!((report.phase, report.kind), (Phase::Done, JobKind::Merge), "{report:?}");
    assert_eq!(fs.zip_before_first_write(), Some(true), "a zip first");
    assert!(zips(&sb.dirs).iter().any(|z| zip_name(z).ends_with("-merge.zip")), "<UTC>-merge.zip");
    let kept = some!(read_text(&root, SCHUZKA), "Schůzka");
    assert_eq!(no_modified(&kept), schuzka_merged(), "tags added, x-místo: Brno kept, the merged section after Zápis A.");
    assert_ne!(kept.lines().find(|l| l.starts_with("modified:")), tx(SCHUZKA).lines().find(|l| l.starts_with("modified:")), "modified touched");
    assert_eq!(read_text(&root, NA_SCHUZKU), Some(tx_swap(NA_SCHUZKU, &[("[[schůzka (2)]]", "[[Schůzka]]")])), "[[schůzka (2)]] → [[Schůzka]], [[Schůzka]] unchanged (D-383)");
    let after = snapshot(&root);
    let trashed = format!(".trash/{SCHUZKA2}");
    assert_eq!(after.get(&trashed).map(|e| e.bytes.clone()), before.get(SCHUZKA2).map(|e| e.bytes.clone()), "the merged object moves to .trash/ with its bytes");
    assert_eq!(files_only(changed(&before, &after)), [SCHUZKA.to_string(), NA_SCHUZKU.into(), SCHUZKA2.into(), trashed].into(), "no other file changes");
    assert_ne!(core.jobs().last_undoable(), Some(job), "no Undo (D-290, D-395)");
    assert!(!core.duplicate_titles().iter().any(|g| g.objects.iter().any(|o| nfc(&o.path) == SCHUZKA)), "the group leaves Duplicate titles");
}

#[test]
fn fr_lnk_14_ac13_a_linking_file_changed_at_a_job_point_is_skipped() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let external = format!("{}Externí řádek.\n", tx(NA_SCHUZKU));
    let (r, e, done) = (root.clone(), external.clone(), Arc::new(Mutex::new(false)));
    let d = done.clone();
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if let JobPoint::AfterRead { path } = p {
            let mut once = d.lock().unwrap_or_else(|x| x.into_inner());
            if nfc(path) == NA_SCHUZKU && !*once {
                *once = true;
                std::fs::write(r.join(NA_SCHUZKU), &e).expect("sync simulator: write");
            }
        }
    })));
    let (job, report) = ok!(run_confirmed(&core, merge_op(SCHUZKA, &[SCHUZKA2])), "merge");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert!(report.skipped.iter().any(|s| nfc(&s.path) == NA_SCHUZKU && s.reason == SkipReason::Changed), "Na schůzku skipped `changed`: {report:?}");
    assert_eq!(read_text(&root, NA_SCHUZKU), Some(external.clone()), "the external version stays");
    assert_eq!(no_modified(&read_text(&root, SCHUZKA).unwrap_or_default()), schuzka_merged(), "the merge itself is done");
    let retry = ok!(core.jobs().retry(job, NA_SCHUZKU), "Retry");
    assert_eq!(retry, RetryOutcome::Written, "Retry rewrites");
    assert_eq!(read_text(&root, NA_SCHUZKU), Some(external.replacen("[[schůzka (2)]]", "[[Schůzka]]", 1)), "only the link changes");
}

#[test]
fn fr_lnk_14_ac13_a_change_to_the_merged_object_stops_the_merge() {
    for (target, what) in [(SCHUZKA2, "the merged object"), (SCHUZKA, "the kept object")] {
        let sb = sandbox();
        let root = tags_vault(&sb);
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        let external = format!("{}Externí změna.\n", tx(target));
        let (r, e, t) = (root.clone(), external.clone(), target.to_string());
        let once = Arc::new(Mutex::new(false));
        core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
            let mut o = once.lock().unwrap_or_else(|x| x.into_inner());
            if matches!(p, JobPoint::AfterPlanning) && !*o {
                *o = true;
                std::fs::write(r.join(&t), &e).expect("sync simulator: write");
            }
        })));
        let before = snapshot(&root);
        let (_, report) = ok!(run_confirmed(&core, merge_op(SCHUZKA, &[SCHUZKA2])), "merge");
        assert_eq!(report.phase, Phase::Failed, "{what}: the merge stops `failed`: {report:?}");
        assert_eq!(report.error.as_deref(), Some(format!("changed:{target}").as_str()), "{what}: the alert says which changed (D-673)");
        assert_eq!(files_only(changed(&before, &snapshot(&root))), [target.to_string()].into(), "{what}: nothing written by Tegg; only the external change");
    }
}

#[test]
fn fr_lnk_14_ac14_tag_files_merge_too() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (_, report) = ok!(run_confirmed(&core, merge_op(F_DVOJI, &[F_DVOJI2])), "merge dvojí ← Dvojí (2)");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(no_modified(&read_text(&root, F_DVOJI).unwrap_or_default()), no_modified(&tx(F_DVOJI)), "no body added, color: red kept");
    assert!(root.join(format!(".trash/{F_DVOJI2}")).exists() && !root.join(F_DVOJI2).exists(), "F-Dvojí2 moved to .trash/");
    let rows = core.tag_rows();
    let d = rows.iter().find(|r| r.key == "dvojí");
    assert_eq!(d.map(|r| (r.count, r.color.clone(), r.losers.clone())), Some((1, Some("red".into()), vec![])), "the tag keeps count 1 and red, no loser");
    let ch = files_only(changed(&before, &snapshot(&root)));
    assert_eq!(ch, [F_DVOJI.to_string(), F_DVOJI2.into(), format!(".trash/{F_DVOJI2}")].into(), "nothing else");
}
