//! Regression test for the owner's report on preview v0.117: on a type page, a Text property's `[[Test note]]` showed as
//! raw text, not as a link chip. A type page's cells show a value out of edit mode, so links inside Text, Long text and
//! `source` values are chips there as in the panel (D-249, D-257; types.md FR-EDT-07 AC-18, FR-TYP-08 AC-14). For that
//! `type_rows` resolves every `[[…]]` inside those values, not only whole-value relations. FR-TYP-09. The L5 part is
//! app/webkit/bug_v0117_fr_typ_09_links_in_text_cells.test.ts.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions};

const PORADA: &str = "Schůzky/2026-10-07 Porada.md";
const SCHUZKA: &str = ".tegg/types/schůzka.yml";

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

fn types_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("types"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn swap(root: &Path, rel: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.join(rel)).expect("read");
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    write_raw(root, rel, text.replacen(from, to, 1).as_bytes());
}

#[test]
fn bug_v0117_fr_typ_09_links_inside_text_and_source_values_are_resolved() {
    let sb = sandbox();
    let root = types_vault(&sb);
    swap(&root, SCHUZKA, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\ncolumns: [místo, source]\n");
    swap(&root, PORADA, "místo:\n", "místo: \"u [[Jana Nováková]] doma\"\nsource: \"Viz [[Rozpočet 2027]] a [[Neexistuje]]\"\n");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("Core::open failed: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let rows = core.type_rows("schůzka");
    let porada = rows.iter().find(|r| tegg_format::nfc(&r.path) == PORADA).expect("Porada's row");
    let resolved = |name: &str| porada.links.iter().find(|l| tegg_format::nfc(&l.target) == name).and_then(|l| l.path.clone());
    assert_eq!(resolved("Jana Nováková").as_deref(), Some("Osoby/Jana Nováková.md"), "the link inside the Text value místo");
    assert_eq!(resolved("Rozpočet 2027").as_deref(), Some("Projekty/Rozpočet 2027.md"), "a link inside mixed source text");
    assert!(porada.links.iter().any(|l| tegg_format::nfc(&l.target) == "Neexistuje" && l.path.is_none()), "an unresolved link is listed, without a path");
}

#[test]
fn bug_v0117_fr_typ_09_a_source_list_keeps_its_links() {
    let sb = sandbox();
    let root = types_vault(&sb);
    swap(&root, SCHUZKA, "preview: [datum, účastníci]\n", "preview: [datum, účastníci]\ncolumns: [source]\n");
    swap(&root, PORADA, "místo:\n", "místo:\nsource:\n  - \"[[Rozpočet 2027]]\"\n  - \"[[Jana Nováková]]\"\n");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("Core::open failed: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let rows = core.type_rows("schůzka");
    let porada = rows.iter().find(|r| tegg_format::nfc(&r.path) == PORADA).expect("Porada's row");
    for name in ["Rozpočet 2027", "Jana Nováková"] {
        assert!(porada.links.iter().any(|l| tegg_format::nfc(&l.target).starts_with(name) && l.path.is_some()), "{name} in a source list resolves (QA review)");
    }
}
