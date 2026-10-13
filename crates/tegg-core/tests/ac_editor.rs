//! MS3 slice 3C AC tests at the core (L4): the D-175 write rule (version equality by size + hash, an mtime-only
//! change is not a conflict), the invalid-UTF-8 write refusal (D-180) and the save after an external rename.
//! docs/acceptance/editor.md (FR-SYN-03 AC-16, AC-18, NFR-REL-03 AC-7); interface docs/contracts/ms3-shell.md §13.1 and ms1-core §3.2. Written from the
//! ACs and contracts only (D-61). Fixture: tests/fixtures/vaults/editor + new-empty/.tegg, copied into a sandbox.
//!
//! Only the existing public API is used so the file compiles before 3C (`core-rust-check`). New Rust names the
//! contract doesn't spell out (`read_note`'s `utf8`, `index_tags`, `note_create_exact`, `note_trash`) aren't called
//! here; see the test author's report (AP list). `CoreError::NotUtf8` is matched by its Debug name. L4 checks that
//! already hold before 3C (FR-FMT-12 AC-6's NFD-path write, §13.1 rule 1 "disk equals new bytes → Unchanged") are
//! not in this red file (check-red needs every test red); they are covered at L5/L6.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{Core, CoreOptions, VaultFs, WriteOutcome};
use tegg_vault::LocalFs;

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

/// `tests/fixtures/vaults/editor/` plus `new-empty/.tegg/` in `<sandbox>/Editor`.
fn editor_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Editor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("editor"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    let fs: Arc<dyn VaultFs> = Arc::new(LocalFs::new(root));
    let core = ok!(Core::open_with(fs, &sb.dirs, CoreOptions { watch, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn set_mtime(p: &Path, t: SystemTime) {
    let f = std::fs::OpenOptions::new().write(true).open(p).expect("open for mtime");
    f.set_modified(t).expect("set mtime");
}

const DESET: &str = "Pages/Deset bloků.md";

#[test]
fn fr_syn_03_ac16_mtime_only_change_is_not_a_conflict() {
    let sb = sandbox();
    let root = editor_vault(&sb);
    let core = open(&root, &sb, false);
    let (bytes, base) = ok!(core.read_note(DESET, SystemTime::now()), "read_note");
    // A sync client rewrites the file with identical bytes: only the mtime changes (D-175, AP-119).
    set_mtime(&root.join(DESET), SystemTime::now() + Duration::from_secs(120));
    let disk = std::fs::read(root.join(DESET)).expect("read");
    assert_eq!(disk, bytes, "setup: same bytes on disk");
    let mine = String::from_utf8(bytes.clone()).expect("utf8").replacen("Pátý blok", "Pátý upravený blok", 1);
    let res = core.write_note(DESET, mine.as_bytes(), Some(&base));
    assert!(matches!(res, Ok(WriteOutcome::Written(_))), "an mtime-only change must not be a Conflict (D-175): {res:?}");
    assert_eq!(std::fs::read(root.join(DESET)).expect("read"), mine.as_bytes(), "the new bytes are on disk");
}

#[test]
fn nfr_rel_03_ac7_write_refused_for_a_note_read_as_invalid_utf8() {
    let sb = sandbox();
    let root = editor_vault(&sb);
    let path = "Pages/Neplatné UTF-8.md";
    let mut raw = b"---\ntype: page\n---\nP\xC5\x99ed chybou \xFF za chybou.\n".to_vec();
    write_raw(&root, path, &raw);
    let core = open(&root, &sb, false);
    let (bytes, base) = ok!(core.read_note(path, SystemTime::now()), "read_note");
    assert_eq!(bytes, raw, "read_note returns the bytes as on disk");
    let before = snapshot(&root);
    // The UI never sends this (it opens the file read-only); the core refuses it as defence in depth (D-180).
    let text = String::from_utf8_lossy(&raw).into_owned();
    let res = core.write_note(path, text.as_bytes(), Some(&base));
    let shown = format!("{res:?}");
    assert!(res.is_err() && shown.contains("NotUtf8"), "write_note after a non-UTF-8 read → Err(CoreError::NotUtf8), got {shown}");
    drop(core);
    assert_eq!(snapshot(&root), before, "the invalid file is never written (bytes, mtime, inode)");
    raw.clear();
}

#[test]
fn fr_syn_03_ac18_after_external_rename_save_goes_to_new_path_without_conflict() {
    let sb = sandbox();
    let root = editor_vault(&sb);
    let core = open(&root, &sb, true);
    let (bytes, base) = ok!(core.read_note(DESET, SystemTime::now()), "read_note");
    let id = core.object(DESET).and_then(|o| o.id.clone());
    assert!(id.is_some(), "Deset bloků has an id");
    // Another program moves the note (same id) to Quick Notes; Finder-style copy-then-delete gives a new mtime.
    let new_path = "Quick Notes/Deset bloků.md";
    std::fs::write(root.join(new_path), &bytes).expect("copy");
    std::fs::remove_file(root.join(DESET)).expect("remove old");
    let moved = wait_until(Duration::from_secs(3), || core.object(new_path).map(|o| o.id == id).unwrap_or(false));
    assert!(moved.is_some(), "the renamed note is indexed at the new path with the same id");
    let mine = String::from_utf8(bytes).expect("utf8").replacen("Pátý blok", "Pátý blok po přesunu", 1);
    // The renamed file's bytes equal the old base: the save goes to the new path with no conflict (AC-18, D-175).
    let res = core.write_note(new_path, mine.as_bytes(), Some(&base));
    assert!(matches!(res, Ok(WriteOutcome::Written(_))), "save to the new path with the old base (same bytes): {res:?}");
    assert_eq!(std::fs::read(root.join(new_path)).expect("read"), mine.as_bytes(), "edit saved at the new path");
    assert!(!root.join(DESET).exists(), "no file created at the old path");
}
