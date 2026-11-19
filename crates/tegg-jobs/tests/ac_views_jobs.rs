//! Slice Q2, the jobs (L4): docs/acceptance/views.md FR-QRY-07 AC-8 (the `query-rename` job also patches every type
//! file's `views:` entry naming the query, one line each, base-checked, with the backup and Undo; D-1434, D-1762) and
//! FR-LNK-03 AC-24 (the same for several type files and a type file changed since the scan; the 4C `note-rename` job
//! rewrites relation link values in a query file's `lane_order`, never its `modified:`, D-1467, AP-1508). Interface
//! docs/contracts/v1-views.md §1.10 (`QueryRenamePlan.views`, `ViewsRow`, write order, report `written`), v1-queries §1.8,
//! ms4-jobs §4…§8. Real `Core` host and `NodeTransformer` (`npm run build --prefix packages/doc`), a temporary copy of
//! tests/fixtures/vaults/views plus new-empty/.tegg; expected bytes tests/fixtures/queries-files/expected/views/. These
//! tests use only interfaces that exist before the build (`JobOp::QueryRename`, `JobOp::NoteRename`, files on disk), so
//! they compile now and fail by assertion. Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{changed, copy_dir, open_core, read_text, rename, repo_root, run_job, sandbox, snapshot, write_raw, Sandbox};
use tags_setup::{zip_entries, zips};
use tegg_jobs::{JobOp, JobPoint, Phase};

const Q: &str = ".tegg/queries";
const BOOK: &str = ".tegg/types/book.yml";
const AUTOR: &str = ".tegg/types/autor.yml";
const CTENI: &str = "Pages/Čtení 2026.md";
const P26: &str = "Přečtené 2026";
const LETOS: &str = "Přečtené letos";
const AUTOR_Q: &str = "Podle autora";
const MAREK: &str = "Autoři/Marek Sova.md";

fn qpath(name: &str) -> String {
    format!("{Q}/{name}.yml")
}
fn fx(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/views").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
fn expected(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected/views").join(rel)).expect("setup: expected")).expect("setup: UTF-8")
}
fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Knihovna");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("views"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| tegg_format::nfc(s)).collect()
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|k| !k.ends_with('/')).map(|k| tegg_format::nfc(&k)).collect()
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "setup: {from:?} in the text");
    text.replacen(from, to, 1)
}
fn query_rename(name: &str, title: &str) -> JobOp {
    JobOp::QueryRename { name: name.into(), title: title.into() }
}
const AUTOR_VIEWS: &str = "preview: [poznámka]\nviews: [Přečtené 2026, Autoři]\n";

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-8

#[test]
fn fr_qry_07_ac8_rename_patches_views() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_job(&core, query_rename(P26, LETOS)), "rename Přečtené 2026");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, &qpath(LETOS)), Some(expected("prectene-letos-renamed.yml")), "the query file: only its title: line");
    assert_eq!(read_text(&root, CTENI), Some(expected("cteni-2026-renamed.md")), "Čtení: only its saved: line");
    assert_eq!(read_text(&root, BOOK), Some(expected("types/book-views-renamed.yml")), "book.yml line 13: views: [Rozečtené, Přečtené letos, Výborné knihy]");
    let touched = files(changed(&before, &snapshot(&root)));
    assert_eq!(touched, set(&[&qpath(P26), &qpath(LETOS), CTENI, BOOK]), "nothing else in the vault changes");
    assert!(report.written.iter().any(|p| tegg_format::nfc(p) == BOOK), "the report lists book.yml as written: {:?}", report.written);
    let zip = zips(&sb.dirs).into_iter().last();
    assert!(
        zip.as_ref().is_some_and(|z| zip_entries(z).iter().any(|(n, b)| tegg_format::nfc(n) == BOOK && *b == fx(BOOK).into_bytes())),
        "the job's backup (FR-HIS-04) holds book.yml's old bytes"
    );
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    for rel in [BOOK, CTENI] {
        assert_eq!(read_text(&root, rel), Some(fx(rel)), "Undo restores {rel}");
    }
    assert_eq!(read_text(&root, &qpath(P26)), Some(fx(&qpath(P26))), "Undo: the old query file");
    assert_eq!(read_text(&root, &qpath(LETOS)), None, "Undo: no new file");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-24

#[test]
fn fr_lnk_03_ac24_renames_patch_views_and_lane_values() {
    // (a) Every type file whose views: names the query gets one line patched (book.yml and a runtime autor.yml).
    let sb = sandbox();
    let root = vault(&sb);
    let autor = swap(&fx(AUTOR), "preview: [poznámka]\n", AUTOR_VIEWS);
    write_raw(&root, AUTOR, autor.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_job(&core, query_rename(P26, LETOS)), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, BOOK), Some(expected("types/book-views-renamed.yml")), "(a) book.yml");
    assert_eq!(read_text(&root, AUTOR), Some(swap(&autor, "views: [Přečtené 2026, Autoři]\n", "views: [Přečtené letos, Autoři]\n")), "(a) autor.yml: only its views line");
    // (b) The 4C rename of Marek Sova rewrites the lane_order link value, not modified:, and the books' author.
    let lo = "lane_order: [\"[[Marek Sova]]\", \"[[Eva Lindová]]\"]\n";
    let q = swap(&fx(&qpath(AUTOR_Q)), "group_by: author\n", &format!("group_by: author\n{lo}"));
    write_raw(&root, &qpath(AUTOR_Q), q.as_bytes());
    core.notify_changed(&[qpath(AUTOR_Q)]);
    let _ = core.wait_idle(Duration::from_secs(30));
    let (_, r2) = ok!(rename(&core, MAREK, "Marek Sovák"), "rename Marek Sova in Tegg");
    assert_eq!(r2.phase, Phase::Done, "{r2:?}");
    assert_eq!(read_text(&root, &qpath(AUTOR_Q)), Some(expected("podle-autora-lane-order-marek-sovak.yml")), "(b) only the lane_order value; modified untouched (D-1467)");
    for b in ["Books/Kniha o horách.md", "Books/Kniha o čaji.md", "Books/Čtvrtá zima.md"] {
        assert!(read_text(&root, b).is_some_and(|t| t.contains("author: \"[[Marek Sovák]]\"\n")), "(b) {b}: its author value");
    }
}

#[test]
fn fr_lnk_03_ac24_renames_patch_views_and_lane_values_base_check() {
    // (a) A type file changed on disk since the scan stops the job before any write.
    let sb = sandbox();
    let root = vault(&sb);
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
    let job = ok!(core.jobs().start(query_rename(P26, LETOS)), "start");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let changed_book = swap(&fx(BOOK), "description: Knihy, které", "description: Knížky, které");
    write_raw(&root, BOOK, changed_book.as_bytes());
    let _ = go_tx.send(());
    let report = some!(core.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_ne!(report.phase, Phase::Done, "the job stops: {report:?}");
    let after = snapshot(&root);
    let touched = files(changed(&before, &after));
    assert_eq!(touched, set(&[BOOK]), "no write but the outside change to book.yml");
    assert_eq!(read_text(&root, BOOK), Some(changed_book), "book.yml keeps the outside change");
}
