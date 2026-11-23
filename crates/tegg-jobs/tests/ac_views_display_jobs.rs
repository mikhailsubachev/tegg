//! Slice Q3, the jobs (L4): docs/acceptance/views.md part five FR-QRY-07 AC-34 (a) (the `query-rename` job patches
//! only the name token of a `views:` item and the `saved:` lines of fences; the item's and fences' own `view`, `group_by`,
//! `lane_order`, `widths` lines keep their bytes and still apply; Undo restores every byte) and FR-LNK-03 AC-26 (the 4C
//! `note-rename` job also patches `"[[…]]"` entries in the `lane_order` of `views:` items, with no `modified:` change
//! (D-1467), and in reference fences' `lane_order` lines of notes that have no other link to the renamed note; base
//! check, backup and Undo; D-2193). Interface docs/contracts/v1-views.md §36.3, §38. Real `Core` host and
//! `NodeTransformer` (`npm run build --prefix packages/doc`), a temporary copy of tests/fixtures/vaults/views with the
//! overlay views-display/ plus new-empty/.tegg; expected bytes tests/fixtures/queries-files/expected/views-display/.
//! These tests use only interfaces that exist before the build (`JobOp::QueryRename`, `rename`, files on disk,
//! `TypeInfo.view_items`), so they compile now and fail by assertion. Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{changed, copy_dir, open_core, read_text, rename, repo_root, run_job, sandbox, snapshot, write_raw, Sandbox};
use tegg_jobs::{JobOp, JobPoint, Phase};
use tegg_schema::{UsageGroupBy, UsageValue};

const BOOK: &str = ".tegg/types/book.yml";
const ZOB: &str = "Pages/Zobrazení knih.md";
const AUTORKY: &str = "Pages/Autorky.md";
const LUCIE: &str = "Autoři/Lucie Horká.md";
const VYB: &str = "Výborné knihy";
const NEJ: &str = "Nejlepší knihy";

fn qpath(name: &str) -> String {
    format!(".tegg/queries/{name}.yml")
}
fn fx(dir: &str, rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults").join(dir).join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
fn exp(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected/views-display").join(rel)).expect("setup: expected")).expect("setup: UTF-8")
}
fn overlay(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Knihovna");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("views"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fxv.join("views-display"), &root, &["README.md"]);
    root
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| tegg_format::nfc(s)).collect()
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|k| !k.ends_with('/')).map(|k| tegg_format::nfc(&k)).collect()
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-34 (a)

#[test]
fn fr_qry_07_ac34_rename_duplicate_remove_trash_carry_the_keys() {
    let sb = sandbox();
    let root = overlay(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_job(&core, JobOp::QueryRename { name: VYB.into(), title: NEJ.into() }), "rename Výborné knihy");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, BOOK), Some(exp("types/book-overlay-vyborne-renamed.yml")), "book.yml: line 18 only; lines 19…21 keep their bytes");
    assert_eq!(read_text(&root, ZOB), Some(exp("notes/zobrazeni-vyborne-renamed.md")), "Zobrazení: lines 43 and 53; lines 44…48 kept; no modified: change");
    let touched = files(changed(&before, &snapshot(&root)));
    assert_eq!(touched, set(&[&qpath(VYB), &qpath(NEJ), BOOK, ZOB]), "nothing else changes");
    // The renamed tab keeps its own grouping, lane order and widths.
    let t = some!(core.type_get("book"), "type_get(book)");
    let item = t.view_items.unwrap_or_default().into_iter().find(|i| tegg_format::nfc(&i.name) == NEJ);
    assert_eq!(
        item.map(|i| (i.group_by, i.lane_order, i.widths)),
        Some((UsageValue::Set(UsageGroupBy::Key("author".into())), UsageValue::Set(vec!["[[Lucie Horká]]".to_string()]), UsageValue::Set(vec![("title".to_string(), 260), ("author".to_string(), 180)]))),
        "the renamed item's own keys still read"
    );
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    for (dir, rel) in [("views-display", BOOK), ("views-display", ZOB)] {
        assert_eq!(read_text(&root, rel), Some(fx(dir, rel)), "Undo restores {rel} byte for byte");
    }
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-26

#[test]
fn fr_lnk_03_ac26_renames_reach_usage_lane_order() {
    let sb = sandbox();
    let root = overlay(&sb);
    write_raw(&root, AUTORKY, exp("notes/lane-order-fence-input.md").as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let zob0 = read_text(&root, ZOB);
    let (job, report) = ok!(rename(&core, LUCIE, "Lucie Horká-Nová"), "rename Lucie Horká in Tegg");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, BOOK), Some(exp("types/book-overlay-lucie-renamed.yml")), "book.yml: only line 20's value; no other byte");
    assert_eq!(read_text(&root, AUTORKY), Some(exp("notes/lane-order-fence-renamed.md")), "Autorky: the fence's lane_order value only, no modified: change");
    assert_eq!(read_text(&root, ZOB), zob0, "Zobrazení (no Lucie in a lane order) untouched");
    for b in ["Books/Čarovná mapa.md", "Books/Dům u řeky.md", "Books/Zahrada v dešti.md"] {
        assert!(read_text(&root, b).is_some_and(|t| t.contains("[[Lucie Horká-Nová]]")), "{b}: its author value");
    }
    // D-2211: a note rename makes no backup zip (D-269); Undo below restores the old bytes.
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_text(&root, BOOK), Some(fx("views-display", BOOK)), "Undo restores book.yml");
    assert_eq!(read_text(&root, AUTORKY), Some(exp("notes/lane-order-fence-input.md")), "Undo restores Autorky");
}

#[test]
fn fr_lnk_03_ac26_renames_reach_usage_lane_order_base_check() {
    // book.yml changed on disk after planning stops the job before any write.
    let sb = sandbox();
    let root = overlay(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let (at_tx, go_rx) = (Mutex::new(Some(at_tx)), Mutex::new(go_rx));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if *p == JobPoint::AfterPlanning {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: LUCIE.into(), title: "Lucie Horká-Nová".into() }), "start");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let outside = fx("views-display", BOOK).replace("    widths: { title: 260, author: 180 }\n", "    widths: { title: 300, author: 180 }\n");
    write_raw(&root, BOOK, outside.as_bytes());
    let _ = go_tx.send(());
    let report = some!(core.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_ne!(report.phase, Phase::Done, "the job stops: {report:?}");
    assert_eq!(files(changed(&before, &snapshot(&root))), set(&[BOOK]), "no write but the outside change");
    assert_eq!(read_text(&root, BOOK), Some(outside), "book.yml keeps the outside change");
}
