//! links.md FR-LNK-14 AC-5 at the core (L4): a duplicate-suffix file is not treated as a sync conflict (data-safety
//! FR-SYN-04 AC-2: "A Tegg duplicate-title file `Title (2).md` with its own `id` is **not** a conflict").
//!
//! Written from docs/acceptance/links.md, data-safety.md FR-SYN-04 AC-2 and the public interface only (D-61):
//! `Core::create_object` (ms3-shell §14.2.3, ms4-links §3.1) and `Core::conflicts` (ms2-core §2.3). Red until
//! AP-718 (D-757): it found that Tegg's own `(2)`/`(3)` files were flagged as Google Drive copies. The existing
//! FR-SYN-04 AC-2 test checks a `(2)` file whose content differs; this one checks duplicates made from the same type
//! template, whose lines are nearly identical (D-111's 90 % threshold), created through Tegg and synced in from
//! another device.
//!
//! Vault: `tests/fixtures/vaults/new-empty/.tegg` (read-only fixture) copied into a temporary directory; every note
//! is synthetic, with Czech diacritics.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Conflict, ConflictKind, Core, CoreOptions};
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
/// The bytes `@tegg/doc` `newObject` gives a new object made from a type template with a 30-line checklist body
/// (D-232): `id`, `created` and `modified` differ per object (created `minute` minutes after 10:00), the rest is
/// the template, so more than 90 % of the lines are equal (the D-111 "nearly identical" threshold).
fn templated_bytes(id: &str, minute: u32, title: &str) -> Vec<u8> {
    let body: String = (1..=30).map(|i| format!("- [ ] Bod {i}: připravit podklady, ověřit rozpočet a čtení smlouvy.\n")).collect();
    format!("---\nid: {id}\ntype: page\ntitle: {title}\ncreated: 2026-10-15T10:{minute:02}:00+02:00\nmodified: 2026-10-15T10:{minute:02}:00+02:00\n---\n## Kontrolní seznam\n\n{body}")
        .into_bytes()
}

// ------------------------------------------------------------------------------------------------ FR-LNK-14 AC-5

#[test]
fn fr_lnk_14_ac5_duplicate_suffix_files_are_not_sync_conflicts() {
    let sb = sandbox();
    let root = empty_vault(&sb);
    let core = open(&root, &sb.dirs);
    // Three objects made from the same template minutes apart: > 90 % of their lines are equal, each has its own id.
    let ids = ["01JB4A0000000000000000D021", "01JB4A0000000000000000D022", "01JB4A0000000000000000D023"];
    let paths: Vec<String> =
        ids.iter().zip([0u32, 7, 23]).map(|(id, m)| nfc(&ok!(core.create_object("page", SPM, &templated_bytes(id, m, SPM)), format!("create_object {id}")))).collect();
    assert_eq!(paths[1], "Pages/Senior Product Manager (2).md", "setup: the second is a duplicate-suffix file");
    assert_eq!(paths[2], "Pages/Senior Product Manager (3).md", "setup: the third too");
    assert_eq!(core.conflicts(), Vec::<Conflict>::new(), "no conflict for Tegg duplicate-suffix files with their own id");

    // Rebuilt from the files alone (fresh Application Support, AR-01): still no conflict.
    drop(core);
    let fresh = fresh_dirs(&sb, "Jiný Mac");
    let reopened = open(&root, &fresh);
    assert_eq!(reopened.conflicts(), Vec::<Conflict>::new(), "no conflict after a full re-index either");
}

#[test]
fn fr_lnk_14_ac5_a_synced_in_duplicate_suffix_file_is_not_a_conflict_while_a_copy_name_is() {
    let sb = sandbox();
    let root = empty_vault(&sb);
    let core = open(&root, &sb.dirs);
    let first = nfc(&ok!(core.create_object("page", SPM, &templated_bytes("01JB4A0000000000000000D031", 0, SPM)), "create_object"));
    assert_eq!(first, "Pages/Senior Product Manager.md", "setup");
    // Another device created the second object (its own id) and the sync client delivered it.
    let second = "Pages/Senior Product Manager (2).md";
    write_raw(&root, second, &templated_bytes("01JB4A0000000000000000D032", 12, SPM));
    // Positive control: a Dropbox conflict-copy name with nearly identical content and another id is a possible
    // conflict (FR-SYN-04 AC-2), so the detector is active in this vault.
    let copy = "Pages/Senior Product Manager (conflicted copy 2026-10-07).md";
    write_raw(&root, copy, &templated_bytes("01JB4A0000000000000000D033", 0, SPM));
    core.notify_changed(&[second.to_string(), copy.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(60)), "change processing did not become idle within 60 s");
    let got = core.conflicts();
    assert_eq!(
        got,
        vec![Conflict { kind: ConflictKind::PossibleCopy, primary: first.clone(), others: vec![copy.to_string()] }],
        "only the conflict-copy name is a possible conflict; the ` (2)` file is a duplicate title, not a conflict"
    );
}
