//! Configurable type-page columns at the core (L4, temporary APFS copy): docs/acceptance/type-columns.md FR-TYP-09
//! AC-18 (d) (`type_rows` fills a value for every effective column key, from the index only), AC-20 (one atomic write of
//! the type file, no note touched), AC-27 (a) Conflict, (b) a missing `task.yml`, (c) a newer file, (d) an invalid file,
//! AC-28 (the watcher), FR-TYP-11 AC-4 (b) (a preview change on a type with `columns`). BRD D-1240, D-1243, D-241.
//! Interface: docs/contracts/type-columns.md §1, §2 (`TypeOp::SetColumns` through `Core::type_patch`, `type_rows`
//! values for the effective columns) and docs/contracts/ms3-shell.md §14.1, §14.2. The 4E delete-property job's part of
//! AC-26 is in crates/tegg-jobs/tests/ac_type_columns.rs (the job runs in `tegg-jobs`). Written from the ACs and the
//! contracts only (D-61). Fixture: tests/fixtures/vaults/types + new-empty/.tegg copied into a sandbox; bytes, mtime and
//! inode compared with `common::snapshot`.
//!
//! `TypeFile.columns` (contract §1) is read through the `Debug` text of `TypeInfo.def`; see the note in
//! crates/tegg-schema/tests/ac_type_columns.rs.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, TypeInfo, VaultError};
use tegg_schema::{SchemaError, TypeOp};
use tegg_vault::{LocalFs, VaultFs};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const PORADA: &str = "Schůzky/2026-10-07 Porada.md";
const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
const SCHUZKA: &str = ".tegg/types/schůzka.yml";
const PREVIEW_S: &str = "preview: [datum, účastníci]\n";

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("create dir");
    for e in std::fs::read_dir(from).expect("read_dir") {
        let e = e.expect("entry");
        if e.file_type().expect("type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("copy");
        }
    }
}
/// `tests/fixtures/vaults/types/` plus `new-empty/.tegg/` in `<sandbox>/Trezor` (type-columns.md "Fixtures").
fn types_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("types"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}
fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open_counting(root: &Path, sb: &Sandbox) -> (Core, Arc<CountingFs<LocalFs>>) {
    let fs = CountingFs::new(LocalFs::new(root));
    let core = ok!(Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    (core, fs)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
fn fixture(rel: &str) -> String {
    std::fs::read_to_string(repo_root().join("tests/fixtures").join(rel)).expect("setup: fixture")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| tegg_format::nfc(k)).collect()
}
fn get(core: &Core, key: &str) -> TypeInfo {
    match core.type_get(key) {
        Some(t) => t,
        None => {
            assert!(false, "type_get({key:?}) returned None");
            unreachable!()
        }
    }
}
fn base(core: &Core, key: &str) -> FileVersion {
    match get(core, key).version {
        Some(v) => v,
        None => {
            assert!(false, "type_get({key:?}).version is None");
            unreachable!()
        }
    }
}
fn cols(keys: &[&str]) -> TypeOp {
    TypeOp::SetColumns(keys.iter().map(|s| s.to_string()).collect())
}
/// `TypeFile.columns` as its `Debug` text (`columns: None` / `columns: Some([..])`), contract §1.
fn columns_debug(keys: Option<&[&str]>) -> String {
    match keys {
        None => "columns: None".to_string(),
        Some(k) => format!("columns: Some({:?})", k.iter().map(|s| s.to_string()).collect::<Vec<String>>()),
    }
}
fn reads_columns(info: &TypeInfo, keys: Option<&[&str]>) -> bool {
    let dbg = format!("{:?}", info.def);
    let want = columns_debug(keys);
    dbg.contains(&format!("{want},")) || dbg.contains(&format!("{want} }}"))
}
fn row_value(core: &Core, key: &str, path: &str, col: &str) -> Option<serde_json::Value> {
    core.type_rows(key).into_iter().find(|r| tegg_format::nfc(&r.path) == path).and_then(|r| r.values.get(col).cloned())
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-18 (d)

#[test]
fn fr_typ_09_ac18_rows_hold_a_value_for_every_effective_column_from_the_index() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, SCHUZKA, swap(&read(&root, SCHUZKA), PREVIEW_S, &format!("{PREVIEW_S}columns: [místo, datum, tags, source]\n")).as_bytes());
    write_raw(&root, PORADA, swap(&read(&root, PORADA), "místo:\n", "místo: Zasedačka\n").as_bytes());
    write_raw(&root, ".tegg/types/projekt.yml", swap(&read(&root, ".tegg/types/projekt.yml"), "preview: [stav, období]\n", "preview: [stav, období]\ncolumns: [web, rozpočet, období, created]\n").as_bytes());
    let (core, fs) = open_counting(&root, &sb);
    let reads0 = fs.read_paths().len();
    let rows = core.type_rows("schůzka");
    assert_eq!(fs.read_paths().len(), reads0, "no note is read for the rows (D-241)");
    let porada = rows.iter().find(|r| tegg_format::nfc(&r.path) == PORADA);
    let p = match porada {
        Some(p) => p,
        None => {
            assert!(false, "Porada row");
            unreachable!()
        }
    };
    assert_eq!(p.values.get("místo"), Some(&serde_json::json!("Zasedačka")), "a column that isn't in preview has real values: {:?}", p.values);
    assert_eq!(p.values.get("datum"), Some(&serde_json::json!("2026-10-07")), "datum");
    assert_eq!(p.values.get("tags"), Some(&serde_json::json!(["finance", "q4"])), "a universal column (tags) is a row value too");
    let r = core.type_rows("projekt");
    let rz = r.iter().find(|x| tegg_format::nfc(&x.path) == ROZPOCET);
    let rz = match rz {
        Some(x) => x,
        None => {
            assert!(false, "Rozpočet row");
            unreachable!()
        }
    };
    assert!(rz.values.contains_key("web") && rz.values.contains_key("rozpočet"), "projekt columns web, rozpočet are filled: {:?}", rz.values);
    assert!(rz.values.contains_key("období-start") && rz.values.contains_key("období-end"), "a date-range column as its two halves: {:?}", rz.values);
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-20

#[test]
fn fr_typ_09_ac20_a_columns_change_is_one_atomic_write_of_the_type_file_only() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let orig = read(&root, SCHUZKA);
    let before = snapshot(&root);
    let b = base(&core, "schůzka");
    let info = ok!(core.type_patch("schůzka", Some(&b), &[cols(&["datum", "účastníci", "modified", "místo"])]), "type_patch columns");
    let want = swap(&orig, PREVIEW_S, &format!("{PREVIEW_S}columns: [datum, účastníci, modified, místo]\n"));
    assert_eq!(read(&root, SCHUZKA), want, "one line inserted after line 11; the preview line unchanged");
    assert!(reads_columns(&info, Some(&["datum", "účastníci", "modified", "místo"])), "the returned TypeInfo reads the new columns: {:?}", info.def);
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), vec![SCHUZKA.to_string()], "only schůzka.yml; no note file, no temp file left");
    assert_ne!(before.get(SCHUZKA).map(|e| e.ino), after.get(SCHUZKA).map(|e| e.ino), "written atomically (temp file + rename: a new inode)");
    // (b) unchecking Modified: the base is the result of the previous write.
    let b2 = base(&core, "schůzka");
    let _ = ok!(core.type_patch("schůzka", Some(&b2), &[cols(&["datum", "účastníci", "místo"])]), "second write");
    assert_eq!(read(&root, SCHUZKA), swap(&orig, PREVIEW_S, &format!("{PREVIEW_S}columns: [datum, účastníci, místo]\n")), "only the columns line changes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-27

#[test]
fn fr_typ_09_ac27_a_columns_write_on_a_changed_file_is_refused() {
    let sb = sandbox();
    let root = types_vault(&sb);
    let core = open(&root, &sb, false);
    let b = base(&core, "schůzka");
    let _ = ok!(core.type_patch("schůzka", Some(&b), &[cols(&["místo"])]), "first columns write");
    assert!(read(&root, SCHUZKA).contains("columns: [místo]\n"), "setup: the first write is on disk");
    let stale = base(&core, "schůzka");
    let theirs = swap(&read(&root, SCHUZKA), "color: teal\n", "color: red\n");
    std::thread::sleep(Duration::from_millis(20));
    write_raw(&root, SCHUZKA, theirs.as_bytes());
    let before = snapshot(&root);
    let r = core.type_patch("schůzka", Some(&stale), &[cols(&["místo", "datum"])]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "(a) Conflict, got {r:?}");
    assert_eq!(read(&root, SCHUZKA), theirs, "(a) the other program's bytes stay");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "(a) nothing is written");
}

#[test]
fn fr_typ_09_ac27_a_missing_task_file_is_created_with_the_columns_line() {
    let sb = sandbox();
    let root = types_vault(&sb);
    std::fs::remove_file(root.join(".tegg/types/task.yml")).expect("delete task.yml");
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let _ = ok!(core.type_patch("task", None, &[cols(&["status", "priority", "due", "modified", "completed"])]), "first columns change of task");
    let want = swap(&fixture("vaults/new-empty/.tegg/types/task.yml"), "preview: [status, priority, due]\n", "preview: [status, priority, due]\ncolumns: [status, priority, due, modified, completed]\n");
    assert_eq!(read(&root, ".tegg/types/task.yml"), want, "(b) new-empty's task.yml plus one columns line after preview (D-90, FR-TYP-06 AC-4)");
    assert_eq!(changed(&before, &snapshot(&root)), vec![".tegg/types/task.yml".to_string()], "(b) only task.yml is created");
    // If the file appears meanwhile, Conflict as (a).
    let sb2 = sandbox();
    let root2 = types_vault(&sb2);
    std::fs::remove_file(root2.join(".tegg/types/task.yml")).expect("delete task.yml");
    let core2 = open(&root2, &sb2, false);
    let theirs = swap(&fixture("vaults/new-empty/.tegg/types/task.yml"), "color: blue\n", "color: red\n");
    write_raw(&root2, ".tegg/types/task.yml", theirs.as_bytes());
    let r = core2.type_patch("task", None, &[cols(&["completed"])]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "(b) a file that appeared meanwhile: Conflict, got {r:?}");
    assert_eq!(read(&root2, ".tegg/types/task.yml"), theirs, "(b) the appeared file keeps its bytes");
}

#[test]
fn fr_typ_09_ac27_newer_and_invalid_files_are_read_and_never_written() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, ".tegg/types/budoucí.yml", swap(&read(&root, ".tegg/types/budoucí.yml"), "preview: []\n", "preview: []\ncolumns: [hodnota, created]\n").as_bytes());
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let t = get(&core, "budoucí");
    assert!(reads_columns(&t, Some(&["hodnota", "created"])), "(c) a newer file's columns are read (D-1240): {:?}", t.def);
    let b = base(&core, "budoucí");
    let r = core.type_patch("budoucí", Some(&b), &[cols(&["hodnota"])]);
    assert!(matches!(r, Err(CoreError::Schema(SchemaError::NewerVersion))), "(c) refused NewerVersion, got {r:?}");
    let rb = get(&core, "rozbitý");
    let r2 = core.type_patch("rozbitý", rb.version.as_ref(), &[cols(&["modified"])]);
    assert!(matches!(r2, Err(CoreError::Schema(SchemaError::Invalid))), "(d) an invalid file is refused, got {r2:?}");
    let _ = core.type_rows("budoucí");
    let _ = core.type_rows("rozbitý");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "(c), (d): every file keeps its bytes");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-28

#[test]
fn fr_typ_09_ac28_an_external_columns_change_is_seen_within_2s_and_nothing_is_written() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, PORADA, swap(&read(&root, PORADA), "místo:\n", "místo: Zasedačka\n").as_bytes());
    let core = open(&root, &sb, true);
    let limit = Duration::from_secs(2);
    assert!(reads_columns(&get(&core, "schůzka"), None), "setup: no columns key (fallback): {:?}", get(&core, "schůzka").def);
    let orig = read(&root, SCHUZKA);
    let theirs = swap(&orig, PREVIEW_S, &format!("{PREVIEW_S}columns: [místo, datum]\n"));
    write_raw(&root, SCHUZKA, theirs.as_bytes());
    let before = snapshot(&root);
    let seen = wait_until(limit, || reads_columns(&get(&core, "schůzka"), Some(&["místo", "datum"])) && row_value(&core, "schůzka", PORADA, "místo") == Some(serde_json::json!("Zasedačka")));
    assert!(seen.is_some(), "the new columns and the místo values within 2 s (NFR-PERF-08); def {:?}", get(&core, "schůzka").def);
    write_raw(&root, SCHUZKA, orig.as_bytes());
    let back = wait_until(limit, || reads_columns(&get(&core, "schůzka"), None));
    assert!(back.is_some(), "deleting the columns line from outside returns to the fallback within 2 s");
    let mut after = snapshot(&root);
    let mut b2 = before.clone();
    after.remove(SCHUZKA);
    b2.remove(SCHUZKA);
    assert_eq!(changed(&b2, &after), Vec::<String>::new(), "the core writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-4 (b)

#[test]
fn fr_typ_11_ac4_a_preview_change_on_a_type_with_columns_writes_only_preview_and_keeps_the_columns() {
    let sb = sandbox();
    let root = types_vault(&sb);
    write_raw(&root, SCHUZKA, swap(&read(&root, SCHUZKA), PREVIEW_S, &format!("{PREVIEW_S}columns: [místo, datum]\n")).as_bytes());
    write_raw(&root, PORADA, swap(&read(&root, PORADA), "místo:\n", "místo: Zasedačka\n").as_bytes());
    let core = open(&root, &sb, false);
    let orig = read(&root, SCHUZKA);
    let b = base(&core, "schůzka");
    let _ = ok!(core.type_patch("schůzka", Some(&b), &[TypeOp::SetPreview(vec!["účastníci".into()])]), "preview change");
    assert_eq!(read(&root, SCHUZKA), swap(&orig, PREVIEW_S, "preview: [účastníci]\n"), "only the preview line changes; columns stays");
    assert_eq!(row_value(&core, "schůzka", PORADA, "místo"), Some(serde_json::json!("Zasedačka")), "the type page's columns don't change: místo is still a row value");
    assert!(reads_columns(&get(&core, "schůzka"), Some(&["místo", "datum"])), "columns read as before: {:?}", get(&core, "schůzka").def);
}
