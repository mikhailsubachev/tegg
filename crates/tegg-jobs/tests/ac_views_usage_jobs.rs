//! Slice Q2.1, the jobs (L4): docs/acceptance/views.md FR-LNK-03 AC-25 and FR-QRY-07 AC-26 (a): the `query-rename` job
//! patches only the `name:` value of a `views:` mapping item (block or flow style kept, own `sort` / `columns` and unknown
//! keys untouched) and only the `saved:` line of each fence (a fence's own `sort:` / `columns:` lines keep their bytes),
//! with its base check, backup and Undo; a type file whose item changed on disk since the scan stops the job before any
//! write. Interface docs/contracts/v1-views.md §14.3 (D-1843), part one §1.10, ms4-jobs §4…§8. Real `Core` host and
//! `NodeTransformer` (`npm run build --prefix packages/doc`), a temporary copy of tests/fixtures/vaults/views with the
//! overlay views-usage/ plus new-empty/.tegg; expected bytes tests/fixtures/queries-files/expected/views-usage/ and
//! expected/views/. Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{changed, copy_dir, open_core, read_text, repo_root, run_job, sandbox, snapshot, write_raw, Sandbox};
use tags_setup::{zip_entries, zips};
use tegg_jobs::{JobOp, JobPoint, Phase};

const Q: &str = ".tegg/queries";
const BOOK: &str = ".tegg/types/book.yml";
const AUTOR: &str = ".tegg/types/autor.yml";
const CTENI: &str = "Pages/Čtení 2026.md";
const CESTY: &str = "Pages/Knihy na cesty.md";
const P26: &str = "Přečtené 2026";
const LETOS: &str = "Přečtené letos";

fn qpath(name: &str) -> String {
    format!("{Q}/{name}.yml")
}
fn fx(dir: &str, rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults").join(dir).join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
fn expected(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected").join(rel)).expect("setup: expected")).expect("setup: UTF-8")
}
fn overlay(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Knihovna");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("views"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fxv.join("views-usage"), &root, &["README.md"]);
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
const AUTOR_FLOW: &str = "preview: [poznámka]\nviews: [{ name: Přečtené 2026, columns: [author] }, Autoři]\n";

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-26 (a)

#[test]
fn fr_qry_07_ac26_rename_duplicate_remove_with_settings() {
    let sb = sandbox();
    let root = overlay(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_job(&core, query_rename(P26, LETOS)), "rename Přečtené 2026");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, BOOK), Some(expected("views-usage/types/book-overlay-renamed.yml")), "book.yml: line 15 only, the item's sort and columns kept");
    assert_eq!(read_text(&root, CESTY), Some(expected("views-usage/notes/knihy-na-cesty-renamed.md")), "Cesty: lines 11 and 19, block 1's sort:/columns: kept, no modified: change");
    assert_eq!(read_text(&root, CTENI), Some(expected("views/cteni-2026-renamed.md")), "Čtení: line 11");
    assert_eq!(read_text(&root, &qpath(LETOS)), Some(expected("views/prectene-letos-renamed.yml")), "the query file");
    let touched = files(changed(&before, &snapshot(&root)));
    assert_eq!(touched, set(&[&qpath(P26), &qpath(LETOS), CTENI, CESTY, BOOK]), "nothing else changes");
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    for rel in [BOOK, CESTY] {
        assert_eq!(read_text(&root, rel), Some(fx("views-usage", rel)), "Undo restores {rel}");
    }
    assert_eq!(read_text(&root, CTENI), Some(fx("views", CTENI)), "Undo restores Čtení");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-25

#[test]
fn fr_lnk_03_ac25_rename_keeps_usage_settings() {
    // A flow mapping item in a second type file: only its name token; the backup holds the old bytes.
    let sb = sandbox();
    let root = overlay(&sb);
    let autor = swap(&fx("views", AUTOR), "preview: [poznámka]\n", AUTOR_FLOW);
    write_raw(&root, AUTOR, autor.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_job(&core, query_rename(P26, LETOS)), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, AUTOR), Some(swap(&autor, "{ name: Přečtené 2026,", "{ name: Přečtené letos,")), "autor.yml: the flow item's name token only");
    assert_eq!(read_text(&root, BOOK), Some(expected("views-usage/types/book-overlay-renamed.yml")), "book.yml: the block item's name only");
    let zip = zips(&sb.dirs).into_iter().last();
    assert!(
        zip.as_ref().is_some_and(|z| zip_entries(z).iter().any(|(n, b)| tegg_format::nfc(n) == BOOK && *b == fx("views-usage", BOOK).into_bytes())),
        "the job's backup (FR-HIS-04) holds the overlay book.yml's bytes"
    );
    // A type file whose item changed on disk since the scan stops the job before any write.
    let sb2 = sandbox();
    let root2 = overlay(&sb2);
    let core2 = ok!(open_core(&root2, &sb2.dirs, false), "open");
    let before = snapshot(&root2);
    let (at_tx, at_rx) = channel::<()>();
    let (go_tx, go_rx) = channel::<()>();
    let (at_tx, go_rx) = (Mutex::new(Some(at_tx)), Mutex::new(go_rx));
    core2.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if *p == JobPoint::AfterPlanning {
            if let Some(tx) = at_tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(5));
            }
        }
    })));
    let job = ok!(core2.jobs().start(query_rename(P26, LETOS)), "start");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    let item_changed = swap(&fx("views-usage", BOOK), "    columns: [author, rating, finished, genres]\n", "    columns: [author, rating]\n");
    write_raw(&root2, BOOK, item_changed.as_bytes());
    let _ = go_tx.send(());
    let report = some!(core2.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_ne!(report.phase, Phase::Done, "the job stops: {report:?}");
    assert_eq!(files(changed(&before, &snapshot(&root2))), set(&[BOOK]), "no write but the outside change");
    assert_eq!(read_text(&root2, BOOK), Some(item_changed), "book.yml keeps the outside change");
}
