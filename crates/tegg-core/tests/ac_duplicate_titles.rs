//! links.md FR-LNK-14 AC-1 (a second and a third object with the same title get ` (2)` and ` (3)`) at the core (L4).
//!
//! Written from docs/acceptance/links.md and the public interface only (D-61): `Core::create_object` (ms3-shell
//! §14.2.3, free stems vault-wide per ms4-links §3.1). These tests were added after the behaviour was built (Red-First-Exempt, owner 2026-10-24).
//! The later criterion backlinks.md FR-LNK-14 AC-10 covers only ` (2)`; this adds the third duplicate and titles
//! the same across types.
//!
//! Vault: `tests/fixtures/vaults/new-empty/.tegg` (read-only fixture) copied into a temporary directory; every note
//! is synthetic, with Czech diacritics.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions};
use tegg_format::nfc;

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

const SPM: &str = "Senior Product Manager";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

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
/// An empty vault with the system types (`new-empty/.tegg`) in `<sandbox>/Trezor`.
fn empty_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"));
    root
}
fn open(root: &Path, dirs: &tegg_vault::AppDirs) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
/// The bytes `@tegg/doc` `newObject` gives a new object of `type_key` made from a template with a 20-line body:
/// only `id` differs between two objects of the same title (same `created`/`modified`, injected time).
fn templated_bytes(id: &str, type_key: &str, title: &str) -> Vec<u8> {
    let body: String = (1..=20).map(|i| format!("- Bod {i}: připravit podklady, ověřit rozpočet a čtení smlouvy.\n")).collect();
    format!("---\nid: {id}\ntype: {type_key}\ntitle: {title}\ncreated: 2026-10-15T10:00:00+02:00\nmodified: 2026-10-15T10:00:00+02:00\n---\n## Šablona schůzky\n\n{body}")
        .into_bytes()
}
fn titles_of(root: &Path, rel: &str) -> Option<String> {
    read(root, rel).lines().find_map(|l| l.strip_prefix("title: ").map(str::to_string))
}

// ------------------------------------------------------------------------------------------------ FR-LNK-14 AC-1

#[test]
fn fr_lnk_14_ac1_second_and_third_object_with_the_same_title_get_suffixes_2_and_3() {
    let sb = sandbox();
    let root = empty_vault(&sb);
    let core = open(&root, &sb.dirs);
    let ids = ["01JB4A0000000000000000D001", "01JB4A0000000000000000D002", "01JB4A0000000000000000D003"];
    let paths: Vec<String> =
        ids.iter().map(|id| nfc(&ok!(core.create_object("page", SPM, &templated_bytes(id, "page", SPM)), format!("create_object {id}")))).collect();
    assert_eq!(
        paths,
        vec![
            "Pages/Senior Product Manager.md".to_string(),
            "Pages/Senior Product Manager (2).md".to_string(),
            "Pages/Senior Product Manager (3).md".to_string(),
        ],
        "the second gets ` (2)`, the third ` (3)`"
    );
    for p in &paths {
        assert_eq!(titles_of(&root, p).as_deref(), Some(SPM), "{p} keeps `title: {SPM}` (no suffix in the title)");
    }
    // The first file is not touched by the later creations.
    assert_eq!(read(&root, &paths[0]).into_bytes(), templated_bytes(ids[0], "page", SPM), "the first object keeps its bytes");
}

#[test]
fn fr_lnk_14_ac1_suffixes_with_czech_title_across_types() {
    let sb = sandbox();
    let root = empty_vault(&sb);
    let core = open(&root, &sb.dirs);
    let t = "Čtení před poradou";
    let a = nfc(&ok!(core.create_object("quick-note", t, &templated_bytes("01JB4A0000000000000000D011", "quick-note", t)), "first"));
    let b = nfc(&ok!(core.create_object("page", t, &templated_bytes("01JB4A0000000000000000D012", "page", t)), "second"));
    let c = nfc(&ok!(core.create_object("quick-note", t, &templated_bytes("01JB4A0000000000000000D013", "quick-note", t)), "third"));
    assert_eq!(
        (a.as_str(), b.as_str(), c.as_str()),
        ("Quick Notes/Čtení před poradou.md", "Pages/Čtení před poradou (2).md", "Quick Notes/Čtení před poradou (3).md"),
        "suffixes count vault-wide (D-291), whatever the type"
    );
    for p in [&a, &b, &c] {
        assert_eq!(titles_of(&root, p).as_deref(), Some(t), "{p} keeps the title as typed");
    }
}
