//! Slice Q, the jobs (L4): docs/acceptance/queries.md FR-QRY-06 AC-6 (the `query-rename` job renames the file, patches
//! only its `title:` line, only the `saved:` line of every usage, notes and templates, and only the pin's `query:` line,
//! with a backup and Undo; refusals before the job; a usage changed since the scan is never overwritten), FR-HOM-02 AC-30
//! (rename reaches pins), FR-SYN-03 AC-29 (the job refuses unreadable and newer queries), FR-FMT-06 AC-5 (other lines of
//! a reference fence survive a rename), FR-LNK-03 AC-23 (the 4C rename patches `"[[…]]"` values in query files, never
//! `modified`, never `this`), FR-QRY-03 AC-5 (renaming the host keeps the context) and FR-QRY-09 AC-3 (deleting an
//! attribute leaves query files alone; the filter becomes a broken part). Interface docs/contracts/v1-queries.md §1.8
//! (`JobOp::QueryRename`, `JobError::QueryExists` / `QueryUnreadable`, `Host::patch_queries`), ms4-jobs §4…§8. Real
//! `Core` host and `NodeTransformer` (`npm run build --prefix packages/doc`), a temporary copy of the queries fixture.
//! Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{changed, copy_dir, open_core, read_text, rename, repo_root, run_job, sandbox, snapshot, write_raw, Sandbox};
use tags_setup::{run_confirmed, zip_entries, zips};
use tegg_core::queries_q::{BrokenReason, Lookup, QueryEnv, QuerySource};
use tegg_core::Core;
use tegg_jobs::{JobError, JobOp, JobPoint, Phase};

const Q: &str = ".tegg/queries";
const PINS: &str = ".tegg/pinned.yml";
const P7: &str = "Schůzky/2026-10-07 Týdenní porada.md";
const P14: &str = "Schůzky/2026-10-14 Týdenní porada.md";
const SABLONA: &str = "_templates/Schůzka/Schůzka.md";
const LISABON: &str = "Projekty/Výjezd Lisabon 2026.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const T1: &str = "Tasks/Poslat návrh rozpočtu Janě.md";
const T2: &str = "Tasks/Zarezervovat místo v Lisabonu.md";
const T3: &str = "Tasks/Připravit program výjezdu.md";
const OTEVRENE: &str = "Otevřené úkoly z této schůzky";
const PORADY: &str = "Otevřené úkoly porady";
const PROJEKTY: &str = "Projekty v běhu";

fn qpath(name: &str) -> String {
    format!("{Q}/{name}.yml")
}
fn fx(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/queries").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}
fn expected(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files").join(rel)).expect("setup: expected")).expect("setup: UTF-8")
}
fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Dotazy");
    let fxv = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fxv.join("queries"), &root, &["README.md"]);
    copy_dir(&fxv.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn pins_file(items: &[&str]) -> String {
    let mut s = String::from("# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n");
    for i in items {
        s.push_str(&format!("  - {i}\n"));
    }
    s
}
fn env() -> QueryEnv {
    QueryEnv {
        today: chrono::NaiveDate::from_ymd_opt(2026, 11, 10).expect("date"),
        tz: "Europe/Prague".parse().expect("zone"),
        week_start: chrono::Weekday::Mon,
        locale: "cs".into(),
    }
}
fn result_paths(core: &Core, name: &str, host: Option<&str>) -> Vec<String> {
    core.query_run(QuerySource::Saved(name.into()), host, &env()).rows.iter().map(|r| tegg_format::nfc(&r.path)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn files(s: BTreeSet<String>) -> BTreeSet<String> {
    s.into_iter().filter(|k| !k.ends_with('/')).collect()
}
fn swap_saved(text: &str, from: &str, to: &str) -> String {
    let a = format!("saved: {from}\n");
    assert!(text.contains(&a), "setup: {a:?} in the text");
    text.replacen(&a, &format!("saved: {to}\n"), 1)
}
fn query_rename(name: &str, title: &str) -> JobOp {
    JobOp::QueryRename { name: name.into(), title: title.into() }
}

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-6

#[test]
fn fr_qry_06_ac6_rename_patches_usages_and_pins() {
    let sb = sandbox();
    let root = vault(&sb);
    let pins = pins_file(&[&format!("query: {OTEVRENE}"), "type: projekt"]);
    write_raw(&root, PINS, pins.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(run_job(&core, query_rename(OTEVRENE, PORADY)), "rename the query");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(report.renamed.clone().map(|(a, b)| (tegg_format::nfc(&a), tegg_format::nfc(&b))), Some((qpath(OTEVRENE), qpath(PORADY))), "renamed: the file");
    assert_eq!(read_text(&root, &qpath(PORADY)), Some(expected("expected/renamed-otevrene-ukoly-porady.yml")), "only the title: line");
    assert_eq!(read_text(&root, &qpath(OTEVRENE)), None, "the old file is gone");
    for n in [P7, P14, SABLONA] {
        assert_eq!(read_text(&root, n), Some(swap_saved(&fx(n), OTEVRENE, PORADY)), "{n}: only its saved: line");
    }
    assert_eq!(read_text(&root, PINS), Some(pins_file(&[&format!("query: {PORADY}"), "type: projekt"])), "only the pin's query: line (FR-HOM-02 AC-30)");
    let touched = files(changed(&before, &snapshot(&root)));
    assert_eq!(touched, set(&[&qpath(OTEVRENE), &qpath(PORADY), P7, P14, SABLONA, PINS]), "every other vault file is untouched");
    let zip = zips(&sb.dirs).into_iter().last();
    assert!(zip.as_ref().is_some_and(|z| zip_entries(z).iter().any(|(n, b)| tegg_format::nfc(n) == qpath(OTEVRENE) && *b == fx(&qpath(OTEVRENE)).into_bytes())), "the job's backup (FR-HIS-04) holds the query file");
    assert_eq!(result_paths(&core, PORADY, Some(P7)), strs(&[T1, T2, T3]), "the blocks keep their results");
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_text(&root, &qpath(OTEVRENE)), Some(fx(&qpath(OTEVRENE))), "Undo: the old name and bytes");
    assert_eq!(read_text(&root, &qpath(PORADY)), None, "Undo: no new file");
    for n in [P7, P14, SABLONA] {
        assert_eq!(read_text(&root, n), Some(fx(n)), "Undo: {n}");
    }
    assert_eq!(read_text(&root, PINS), Some(pins), "Undo: the pins");
}

#[test]
fn fr_qry_06_ac6_rename_refusals_before_the_job() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let r = core.jobs().start(query_rename(OTEVRENE, "projekty V BĚHU"));
    assert!(matches!(&r, Err(JobError::QueryExists { name }) if tegg_format::nfc(name) == PROJEKTY), "a name taken by another query: {r:?}");
    let r = core.jobs().start(query_rename(OTEVRENE, OTEVRENE));
    assert!(matches!(r, Err(JobError::NothingToDo)), "the same name: nothing to do ({r:?})");
    let r = core.jobs().start(query_rename("Neexistující dotaz", "Cokoli"));
    assert!(matches!(r, Err(JobError::NotFound)), "no such query: {r:?}");
    let r = core.jobs().start(query_rename(OTEVRENE, "   "));
    assert!(r.is_err(), "an empty name is refused: {r:?}");
    let r = core.jobs().start(query_rename(OTEVRENE, "otevřené úkoly Z TÉTO schůzky"));
    assert!(r.is_ok(), "another case of its own name is a rename (its own name excluded): {r:?}");
    if let Ok(job) = r {
        let _ = core.jobs().wait(job, Duration::from_secs(60));
    }
    let after = files(changed(&before, &snapshot(&root)));
    assert!(!after.iter().any(|p| p.starts_with("Pages/") || p.starts_with("Projekty/")), "refusals write nothing: {after:?}");
}

/// A usage changed on disk after the job's scan is never overwritten (ms4-jobs base check; FR-QRY-06 AC-6).
#[test]
fn fr_qry_06_ac6_changed_usage_is_never_overwritten() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = fx(P14) + "\nPřipsáno jinde.\n";
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
    let job = ok!(core.jobs().start(query_rename(OTEVRENE, PORADY)), "start");
    assert!(at_rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the job reached the end of planning");
    write_raw(&root, P14, theirs.as_bytes());
    let _ = go_tx.send(());
    let report = some!(core.jobs().wait(job, Duration::from_secs(60)), "report");
    assert_eq!(read_text(&root, P14), Some(theirs), "the changed usage keeps the other program's bytes");
    assert!(!report.written.iter().any(|p| tegg_format::nfc(p) == P14), "not a written row: {report:?}");
}

#[test]
fn fr_syn_03_ac29_rename_refuses_unreadable_queries() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    for name in ["Nečitelný", "Novější verze"] {
        let r = core.jobs().start(query_rename(name, &format!("{name} 2")));
        assert!(matches!(r, Err(JobError::QueryUnreadable)), "{name}: refused before the job ({r:?})");
    }
    assert_eq!(files(changed(&before, &snapshot(&root))), BTreeSet::new(), "bytes, mtime and inode kept");
}

#[test]
fn fr_hom_02_ac30_query_pins_follow_rename() {
    let sb = sandbox();
    let root = vault(&sb);
    let pins = pins_file(&["tag: finance", &format!("query: {PROJEKTY}"), "query: Jiný dotaz"]);
    write_raw(&root, PINS, pins.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_job(&core, query_rename(PROJEKTY, "Běžící projekty")), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(read_text(&root, PINS), Some(pins_file(&["tag: finance", "query: Běžící projekty", "query: Jiný dotaz"])), "only that query: line");
    assert!(report.written.iter().any(|p| p == PINS), "pinned.yml is a written row of the job");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-5

#[test]
fn fr_fmt_06_ac5_reference_fence_keeps_other_lines() {
    let sb = sandbox();
    let root = vault(&sb);
    let note = "Pages/Poznámka s dotazem.md";
    let text = format!("Úvod.\n\n- seznam\n\n  ```query\n  saved: {PROJEKTY}\n  # moje poznámka\n  x-pohled: úzký\n  ```\n\n> ```query\n> saved: {PROJEKTY}\n> ```\n");
    write_raw(&root, note, text.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(run_job(&core, query_rename(PROJEKTY, "Běžící projekty")), "rename");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let want = text.replace(&format!("saved: {PROJEKTY}\n"), "saved: Běžící projekty\n");
    assert_eq!(read_text(&root, note), Some(want), "only the saved: values; the other lines and container prefixes stay");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-23

#[test]
fn fr_lnk_03_ac23_renames_patch_query_files() {
    let sb = sandbox();
    let root = vault(&sb);
    let odkazy = "# Ruční dotaz s odkazy.\nversion: 1\ntitle: Odkazy\ntypes: []\nmatch: all\nfilters:\n  - links_to: \"[[Výjezd Lisabon 2026]]\"\n  - vlastník: { links_to: \"[[Jana Nováková]]\" }\n  - linked_from: this\nsort: { by: title, order: asc }\nlimit: 50\nview: list\ncolumns: [type, modified]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n";
    write_raw(&root, &qpath("Odkazy"), odkazy.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let (job, report) = ok!(rename(&core, LISABON, "Výjezd Lisabon 2027"), "rename Lisabon");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let one = odkazy.replace("\"[[Výjezd Lisabon 2026]]\"", "\"[[Výjezd Lisabon 2027]]\"");
    assert_eq!(read_text(&root, &qpath("Odkazy")), Some(one.clone()), "only that value; modified unchanged; this untouched");
    assert!(report.written.iter().any(|p| tegg_format::nfc(p) == qpath("Odkazy")), "the query file is a written row");
    let after = snapshot(&root);
    for q in [PROJEKTY, OTEVRENE, "Vše, co sem odkazuje"] {
        assert_eq!(after.get(&qpath(q)), before.get(&qpath(q)), "{q}: doesn't mention Lisabon, untouched");
    }
    let (_, u) = ok!(run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    assert_eq!(read_text(&root, &qpath("Odkazy")), Some(odkazy.to_string()), "Undo restores the query file");
    let (_, r2) = ok!(rename(&core, JANA, "Jana Svobodová"), "rename Jana");
    assert_eq!(r2.phase, Phase::Done, "{r2:?}");
    assert_eq!(read_text(&root, &qpath("Odkazy")), Some(odkazy.replace("\"[[Jana Nováková]]\"", "\"[[Jana Svobodová]]\"")), "the relation value");
    let p7 = snapshot(&root).get(&qpath(OTEVRENE)).cloned();
    let (_, r3) = ok!(rename(&core, P7, "2026-10-07 Porada"), "rename Porada 7");
    assert_eq!(r3.phase, Phase::Done, "{r3:?}");
    assert_eq!(snapshot(&root).get(&qpath(OTEVRENE)).cloned(), p7, "`this` is never rewritten");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-03 AC-5

#[test]
fn fr_qry_03_ac5_host_rename_keeps_context() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    assert_eq!(result_paths(&core, OTEVRENE, Some(P7)), strs(&[T1, T2, T3]), "three before");
    let queries_before = snapshot(&root.join(Q));
    let (_, report) = ok!(rename(&core, P7, "2026-10-07 Porada"), "rename in Tegg");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let renamed = "Schůzky/2026-10-07 Porada.md";
    assert_eq!(result_paths(&core, OTEVRENE, Some(renamed)), strs(&[T1, T2, T3]), "the 4C job rewrote the links: still three");
    // Outside Tegg: the links break, then come back.
    std::fs::rename(root.join(renamed), root.join("Schůzky/Jinak.md")).expect("setup: external rename");
    core.notify_changed(&[renamed.to_string(), "Schůzky/Jinak.md".to_string()]);
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(result_paths(&core, OTEVRENE, Some("Schůzky/Jinak.md")), Vec::<String>::new(), "broken links: no objects match");
    std::fs::rename(root.join("Schůzky/Jinak.md"), root.join(renamed)).expect("setup: rename back");
    core.notify_changed(&[renamed.to_string(), "Schůzky/Jinak.md".to_string()]);
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(result_paths(&core, OTEVRENE, Some(renamed)), strs(&[T1, T2, T3]), "renamed back: three again");
    assert_eq!(snapshot(&root.join(Q)), queries_before, "no query file is written");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-3

#[test]
fn fr_qry_09_ac3_type_jobs_patch_queries() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root.join(Q));
    let (_, report) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "projekt".into(), key: "stav".into() }), "delete the stav attribute");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    assert_eq!(snapshot(&root.join(Q)), before, "deleting an attribute doesn't touch query files");
    let r = core.query_run(QuerySource::Saved(PROJEKTY.into()), None, &env());
    assert_eq!(r.lookup, Some(Lookup::Ok), "still readable");
    assert!(r.broken.iter().any(|b| b.reason == BrokenReason::NotAttribute && b.key == "stav"), "the filter is a broken part: {:?}", r.broken);
    assert_eq!(r.rows.len(), 5, "ignored as if absent: every project");
}
