//! Slice 4E-2 AC tests at the core (L4): docs/acceptance/type-moves.md FR-TYP-05 AC-10 (D-809, AP-770 → D-815):
//! restoring an object of a deleted type from the Trash view restores the object and the type file; the templates stay
//! in the trash; when a type with that key exists again, only the object is restored; of several trashed copies of the
//! definition (` (n)`), the latest (highest `n`) comes back. Interface docs/contracts/ms4-jobs.md §14.9.5
//! (`Core::trash_restore(path)` lists the restored type file in its returned `Moved`s), ms6-trash-media.md §1.4.
//!
//! The vault is the type-moves fixture (+ new-empty/.tegg) in the state FR-TYP-05 AC-7 leaves it in, made on disk
//! directly (Porada, Retro, Schůzka jinde, `_templates/Schůzka/` and `.tegg/types/schůzka.yml` under `.trash/` with
//! their relative paths), so this file depends on the restore only, not on the type-delete job. Written from the ACs and
//! the contracts only (D-61). Results go through `ok!` or `assert!`, so the 4E-2 behaviour missing fails on assertions.

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
fn type_defined_again_only_the_object_is_restored() {
    let sb = sandbox();
    let root = deleted_vault(&sb);
    let fresh = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Schůzka\nplural: Schůzky\nsystem: false\nfolder: Schůzky\nicon: users\ncolor: gray\nreview: false\npreview: []\nattributes: []\n".as_bytes();
    write_raw(&root, SCHUZKA_YML, fresh);
    let core = open(&root, &sb);
    assert_eq!(core.type_get("schůzka").map(|t| t.exists), Some(true), "setup: a type with the key schůzka exists again");
    let moved = ok!(core.trash_restore(TRASHED_PORADA), "trash_restore Porada");
    assert_eq!(moved_set(&moved), BTreeSet::from([pair(TRASHED_PORADA, PORADA)]), "only the object is restored");
    assert_eq!(read(&root, PORADA), Some(fx(PORADA)), "Porada is back");
    assert_eq!(read(&root, SCHUZKA_YML), Some(fresh.to_vec()), "the existing definition is untouched");
    assert_eq!(read(&root, TRASHED_YML), Some(fx(SCHUZKA_YML)), "the trashed definition stays in the trash");
}

#[test]
fn fr_typ_05_ac10_restoring_porada_brings_its_type_back_unless_the_type_exists_again() {
    type_defined_again_only_the_object_is_restored();
    let sb = sandbox();
    let root = deleted_vault(&sb);
    let core = open(&root, &sb);
    assert!(core.type_get("schůzka").map(|t| t.exists) != Some(true), "setup: Schůzka has no definition");
    let moved = ok!(core.trash_restore(TRASHED_PORADA), "trash_restore Porada");
    assert_eq!(
        moved_set(&moved),
        BTreeSet::from([pair(TRASHED_PORADA, PORADA), pair(TRASHED_YML, SCHUZKA_YML)]),
        "the note and its type file are restored in the same call and both are listed (ms4-jobs §14.9.5)"
    );
    assert_eq!(read(&root, PORADA), Some(fx(PORADA)), "Schůzky/Porada.md with its bytes");
    assert_eq!(read(&root, SCHUZKA_YML), Some(fx(SCHUZKA_YML)), ".tegg/types/schůzka.yml with its bytes");
    assert!(!root.join(TRASHED_YML).exists(), "the type file left the trash");
    assert_eq!(read(&root, ".trash/_templates/Schůzka/Schůzka.md"), Some(fx(T_SCHUZKA)), "the template stays in the trash (AP-770)");
    assert!(!root.join(T_SCHUZKA).exists(), "and is not restored");
    assert!(root.join(".trash/Schůzky/Retro.md").exists() && root.join(".trash/Pages/Schůzka jinde.md").exists(), "the other objects stay in the trash");
    let back = wait_until(Duration::from_secs(2), || core.type_get("schůzka").map(|t| t.exists) == Some(true));
    assert!(back.is_some(), "Schůzka is a defined type again: the restored note is not an orphan");
    assert_eq!(core.type_usage("schůzka").objects, 1, "Porada is its one object");
}

#[test]
fn fr_typ_05_ac10_the_latest_trashed_definition_comes_back() {
    let sb = sandbox();
    let root = deleted_vault(&sb);
    // An older delete left `.trash/.tegg/types/schůzka.yml`; the latest one took ` (2)` (ms6-trash-media §1.4).
    let latest = std::fs::read(root.join(TRASHED_YML)).expect("setup: the trashed definition");
    std::fs::rename(root.join(TRASHED_YML), root.join(".trash/.tegg/types/schůzka (2).yml")).expect("setup: the latest copy");
    let older = String::from_utf8(latest.clone()).expect("setup: UTF-8").replace("color: teal\n", "color: gray\n");
    write_raw(&root, TRASHED_YML, older.as_bytes());
    let core = open(&root, &sb);
    let moved = ok!(core.trash_restore(TRASHED_PORADA), "trash_restore Porada");
    assert_eq!(
        moved_set(&moved),
        BTreeSet::from([pair(TRASHED_PORADA, PORADA), pair(".trash/.tegg/types/schůzka (2).yml", SCHUZKA_YML)]),
        "the highest ` (n)` is the latest trashed definition (ms4-jobs §14.9.5)"
    );
    assert_eq!(read(&root, SCHUZKA_YML), Some(latest), "its bytes");
    assert_eq!(read(&root, TRASHED_YML), Some(older.into_bytes()), "the older copy stays in the trash");
}
