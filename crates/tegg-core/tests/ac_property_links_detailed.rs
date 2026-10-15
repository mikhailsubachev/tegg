//! FR-LNK-02 AC-2 (docs/acceptance/types.md): backlink records name the attribute key (`backlinks_detailed`,
//! docs/contracts/ms3-shell.md §15.4). Written from the AC and the contract only (D-61). Fixture: tests/fixtures/vaults/types
//! + new-empty/.tegg in a temporary directory; setup helpers as in ac_property_links.rs.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

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
fn fr_lnk_02_ac2_backlinks_name_the_attribute_key() {
    let sb = sandbox();
    let root = types_vault(&sb);
    with_text_links(&root);
    // A body link (runtime): Obyčejná's body mentions Jana, so its record has no attribute.
    let mut o = read(&root, OBYCEJNA);
    o.push_str("\nPotkal jsem [[Jana Nováková]] v kanceláři.\n");
    write_raw(&root, OBYCEJNA, o.as_bytes());
    let core = open(&root, &sb, false);
    let detailed = |path: &str| -> Vec<(String, Option<String>)> {
        core.backlinks_detailed(path)
            .into_iter()
            .map(|b| (tegg_format::nfc(&b.source), b.attribute.map(|a| tegg_format::nfc(&a))))
            .collect()
    };
    let jana = detailed(JANA);
    let has = |v: &[(String, Option<String>)], s: &str, a: Option<&str>| v.iter().any(|(src, at)| src == s && at.as_deref() == a);
    assert!(has(&jana, PORADA, Some("místo")), "Porada → Jana from místo: {jana:?}");
    assert!(has(&jana, PORADA, Some("účastníci")), "Porada → Jana from the relation účastníci: {jana:?}");
    assert_eq!(jana.iter().filter(|(s, a)| s == PORADA && a.as_deref() == Some("místo")).count(), 1, "the mixed value is one link: {jana:?}");
    assert!(has(&jana, PRAZDNA, Some("místo")), "Prázdná schůzka → Jana from místo: {jana:?}");
    assert!(has(&jana, OBYCEJNA, None), "a body link has no attribute: {jana:?}");
    let r = detailed(ROZPOCET);
    assert!(has(&r, OBYCEJNA, Some("description")), "Obyčejná → Rozpočet from description: {r:?}");
    assert!(has(&r, OBYCEJNA, Some("source")), "Obyčejná → Rozpočet from source: {r:?}");
    assert!(has(&r, PORADA, Some("projekt")), "Porada → Rozpočet from projekt: {r:?}");
    // Contract §15.4: sorted by source, then attribute.
    let mut sorted = jana.clone();
    sorted.sort();
    assert_eq!(jana, sorted, "sorted by source then attribute");
}
