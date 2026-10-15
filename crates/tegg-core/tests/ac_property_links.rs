//! MS3 3D follow-up AC tests at the core (L4): FR-LNK-02 AC-2, AC-3 (links in text property values in the index,
//! D-249, D-257). docs/acceptance/types.md; interface docs/contracts/ms3-shell.md §15.4. Written from the ACs and the
//! contract only (D-61). Fixture: tests/fixtures/vaults/types + new-empty/.tegg in a temporary directory.
//!
//! The attribute key of each backlink is in `backlinks_detailed` (§15.4), which doesn't exist yet; calling it would
//! be a compile error, not a red assertion (TS-I1). These tests use `backlinks` (sources) on notes whose only link
//! to the target is the text value (Obyčejná → Rozpočet 2027, Prázdná schůzka → Jana / Petr), so the source proves
//! the text-value link. The attribute-key check is listed as a contract gap in the red-commit report.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{Core, CoreOptions};

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
const PRAZDNA: &str = "Schůzky/Prázdná schůzka.md";
const OBYCEJNA: &str = "Pages/Obyčejná stránka.md";
const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
const JANA: &str = "Osoby/Jana Nováková.md";
const PETR: &str = "Osoby/Petr Dvořák.md";

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
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
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
fn backlinks(core: &Core, path: &str) -> Vec<String> {
    let mut v: Vec<String> = core.backlinks(path).into_iter().map(|p| tegg_format::nfc(&p)).collect();
    v.sort();
    v.dedup();
    v
}
/// The runtime edits of FR-EDT-07 AC-18 and FR-TYP-08 AC-14 (as files), plus Prázdná schůzka's `místo` → Jana.
fn with_text_links(root: &Path) {
    let p = swap(&read(root, PORADA), "místo:\n", "místo: \"u [[Jana Nováková]] doma\"\n");
    write_raw(root, PORADA, p.as_bytes());
    let o = swap(&read(root, OBYCEJNA), "místo: Praha\n", "místo: Praha\ndescription: \"Viz [[Rozpočet 2027]]\"\nsource: \"[[Rozpočet 2027]]\"\n");
    write_raw(root, OBYCEJNA, o.as_bytes());
    let z = swap(&read(root, PRAZDNA), "title: Prázdná schůzka\n", "title: Prázdná schůzka\nmísto: \"u [[Jana Nováková]] doma\"\n");
    write_raw(root, PRAZDNA, z.as_bytes());
}

#[test]
fn fr_lnk_02_ac2_backlinks_include_text_value_links() {
    let sb = sandbox();
    let root = types_vault(&sb);
    with_text_links(&root);
    let core = open(&root, &sb, false);
    let jana = backlinks(&core, JANA);
    assert!(jana.contains(&PORADA.to_string()), "Porada (místo and účastníci): {jana:?}");
    assert!(jana.contains(&PRAZDNA.to_string()), "Prázdná schůzka, whose only link to Jana is místo: {jana:?}");
    let r = backlinks(&core, ROZPOCET);
    assert!(r.contains(&OBYCEJNA.to_string()), "Obyčejná, whose only links to Rozpočet are description and source: {r:?}");
}

#[test]
fn fr_lnk_02_ac2_clearing_and_external_change_move_the_backlink_within_2s() {
    let sb = sandbox();
    let root = types_vault(&sb);
    with_text_links(&root);
    let core = open(&root, &sb, true);
    assert!(backlinks(&core, JANA).contains(&PRAZDNA.to_string()), "setup: Prázdná schůzka links Jana through místo");
    // The user clears místo (a core write with the base version).
    let (bytes, base) = ok!(core.read_note(PRAZDNA, SystemTime::now()), "read_note");
    let text = String::from_utf8(bytes).unwrap_or_default();
    let cleared = swap(&text, "místo: \"u [[Jana Nováková]] doma\"\n", "");
    let _ = ok!(core.write_note(PRAZDNA, cleared.as_bytes(), Some(&base)), "write_note");
    let gone = wait_until(Duration::from_secs(2), || !backlinks(&core, JANA).contains(&PRAZDNA.to_string()));
    assert!(gone.is_some(), "the místo backlink is gone within 2 s: {:?}", backlinks(&core, JANA));
    // Another program writes místo: "[[Petr Dvořák]]".
    let now = read(&root, PRAZDNA);
    let ext = swap(&now, "title: Prázdná schůzka\n", "title: Prázdná schůzka\nmísto: \"[[Petr Dvořák]]\"\n");
    std::fs::write(root.join(PRAZDNA), ext.as_bytes()).unwrap_or(());
    let moved = wait_until(Duration::from_secs(2), || backlinks(&core, PETR).contains(&PRAZDNA.to_string()));
    assert!(moved.is_some(), "moved to Petr within 2 s: {:?}", backlinks(&core, PETR));
    assert!(!backlinks(&core, JANA).contains(&PRAZDNA.to_string()), "not back at Jana");
}

#[test]
fn fr_lnk_02_ac2_backlinks_identical_after_index_rebuild() {
    let sb = sandbox();
    let root = types_vault(&sb);
    with_text_links(&root);
    let core = open(&root, &sb, false);
    let all = |c: &Core| [JANA, PETR, ROZPOCET].iter().map(|p| backlinks(c, p)).collect::<Vec<_>>();
    let before = all(&core);
    assert!(before[2].contains(&OBYCEJNA.to_string()), "red guard: text-value links are indexed: {:?}", before[2]);
    let local = core.vault().local_dir();
    drop(core);
    ok!(std::fs::remove_dir_all(&local), "delete index dir");
    let core = open(&root, &sb, false);
    assert_eq!(all(&core), before, "identical after a rebuild (AR-01)");
}

#[test]
fn fr_lnk_02_ac3_indexing_writes_nothing_and_unclosed_links_are_not_counted() {
    let sb = sandbox();
    let root = types_vault(&sb);
    with_text_links(&root);
    let z = swap(&read(&root, PRAZDNA), "místo: \"u [[Jana Nováková]] doma\"\n", "místo: \"u [[Petr Dvořák doma\"\n");
    write_raw(&root, PRAZDNA, z.as_bytes());
    let before = snapshot(&root);
    let core = open(&root, &sb, true);
    assert!(backlinks(&core, ROZPOCET).contains(&OBYCEJNA.to_string()), "red guard: description/source links are indexed");
    assert!(!backlinks(&core, PETR).contains(&PRAZDNA.to_string()), "[[ without ]] is text, not a link");
    let _ = core.backlinks(JANA);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(snapshot(&root), before, "extracting and indexing write no file, add no key");
}
