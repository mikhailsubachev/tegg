//! QA review of 4E-2 (qa/reviews/4e-2-type-deletes.md, B1): after a type delete the real Trash view lists each trashed
//! object as its own row (D-851: the deleted type's folder still counts as a type folder), never `.trash/.tegg/`, and
//! restoring the Porada row brings the type file back (FR-TYP-05 AC-10).

mod common;
mod trash6a_setup;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::Moved;
use tegg_format::nfc;
use trash6a_setup::{copy_dir, open, read};

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

const PORADA: &str = "Schůzky/Porada.md";
const RETRO: &str = "Schůzky/Retro.md";
const SCH_JINDE: &str = "Pages/Schůzka jinde.md";
const T_SCHUZKA: &str = "_templates/Schůzka/Schůzka.md";
const SCHUZKA_YML: &str = ".tegg/types/schůzka.yml";
const TRASHED_PORADA: &str = ".trash/Schůzky/Porada.md";
const TRASHED_YML: &str = ".trash/.tegg/types/schůzka.yml";

fn fx(rel: &str) -> Vec<u8> {
    std::fs::read(repo_root().join("tests/fixtures/vaults/type-moves").join(rel)).expect("setup: fixture file")
}
/// The type-moves vault after FR-TYP-05 AC-7, built on disk.
fn deleted_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Přesuny");
    let fixtures = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fixtures.join("type-moves"), &root, &["README.md"]);
    copy_dir(&fixtures.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    for rel in [PORADA, RETRO, SCH_JINDE, T_SCHUZKA, SCHUZKA_YML] {
        to_trash(&root, rel);
    }
    std::fs::remove_dir(root.join("_templates/Schůzka")).expect("setup: the emptied template folder goes with it");
    root
}
fn to_trash(root: &Path, rel: &str) {
    let to = root.join(".trash").join(rel);
    std::fs::create_dir_all(to.parent().expect("setup: parent")).expect("setup: trash folder");
    std::fs::rename(root.join(rel), &to).expect("setup: move to the trash");
}
fn moved_set(m: &[Moved]) -> BTreeSet<(String, String)> {
    m.iter().map(|x| (nfc(&x.from), nfc(&x.to))).collect()
}
fn pair(a: &str, b: &str) -> (String, String) {
    (a.to_string(), b.to_string())
}

/// The second case of AC-10: with a type of the key `schůzka` defined again, only the object is restored. Run first by
/// the test below, so this already-working case never makes the file green on its own (check-red, CONTRACT §5.2).
#[test]
fn bug_qa4e2_b1_fr_typ_05_ac10_the_real_trash_lists_each_object_of_a_deleted_type() {
    let sb = sandbox();
    let root = deleted_vault(&sb);
    let core = open(&root, &sb);
    let rows = core.trash_list();
    let paths: BTreeSet<String> = rows.iter().map(|r| nfc(&r.path)).collect();
    for p in [TRASHED_PORADA, ".trash/Schůzky/Retro.md", ".trash/Pages/Schůzka jinde.md"] {
        assert!(paths.contains(p), "{p} is its own row (not inside a `Schůzky` folder row): {paths:?}");
    }
    assert!(!paths.contains(".trash/Schůzky"), "no folder row for the deleted type's folder: {paths:?}");
    assert!(paths.iter().all(|p| !p.starts_with(".trash/.tegg")), "`.trash/.tegg/` is never a row: {paths:?}");
    let moved = ok!(core.trash_restore(TRASHED_PORADA), "restore the Porada row");
    assert_eq!(moved_set(&moved), BTreeSet::from([pair(TRASHED_PORADA, PORADA), pair(TRASHED_YML, SCHUZKA_YML)]), "the row brings the type file back");
    let _ = (RETRO, SCH_JINDE, T_SCHUZKA, fx as fn(&str) -> Vec<u8>, Path::new("."), Duration::ZERO);
}
