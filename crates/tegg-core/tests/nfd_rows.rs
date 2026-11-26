//! D-2554 (docs/contracts/android-edit.md §3.1, FR-FMT-12, FR-INB-02, FR-TSK-02): Inbox rows and task rows of a file
//! stored under a name whose bytes differ from its NFC form are `read_only` from the core, through a `LocalFs` that
//! resolves names as on Android (`tegg_vault::testing::resolving_fs`); an NFC-named file's rows stay writable. The
//! desktop's `LocalFs` (no name resolution on macOS) never marks them. Not an AC test.

mod common;

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions, VaultFs};

fn nfd(s: &str) -> String {
    s.replace('á', "a\u{301}").replace('Ú', "U\u{301}").replace('í', "i\u{301}").replace('č', "c\u{30C}")
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

/// `dir/name` written under the NFD bytes of `name`.
fn write_nfd(root: &Path, dir: &str, name: &str, text: &str) {
    let stored = nfd(name);
    assert_ne!(stored.as_bytes(), name.as_bytes(), "setup: {name} has a decomposable letter");
    std::fs::write(root.join(dir).join(OsStr::from_bytes(stored.as_bytes())), text).expect("setup: NFD-named file");
}

fn vault(sb: &Sandbox) -> std::path::PathBuf {
    let root = sb.base.join("Trezor");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"));
    for d in ["Tasks", "Quick Notes"] {
        std::fs::create_dir_all(root.join(d)).expect("setup: folder");
    }
    let task = |id: &str, title: &str| format!("---\nid: {id}\ntype: task\ntitle: {title}\nstatus: To do\n---\n");
    let quick = |id: &str, title: &str| format!("---\nid: {id}\ntype: quick-note\ntitle: {title}\nreview: unreviewed\n---\nText.\n");
    write_nfd(&root, "Tasks", "Úkol pro Evu.md", &task("01JA0S0000000000000000NFD1", "Úkol pro Evu"));
    std::fs::write(root.join("Tasks/Úkol čistý.md"), task("01JA0S0000000000000000NFC1", "Úkol čistý")).expect("setup: NFC task");
    write_nfd(&root, "Quick Notes", "Poznámka na cestě.md", &quick("01JA0S0000000000000000NFD2", "Poznámka na cestě"));
    std::fs::write(root.join("Quick Notes/Poznámka čistá.md"), quick("01JA0S0000000000000000NFC2", "Poznámka čistá")).expect("setup: NFC quick note");
    root
}

fn open(fs: Arc<dyn VaultFs>, sb: &Sandbox) -> Core {
    let core = Core::open_with(fs, &sb.dirs, CoreOptions { watch: false, sync: None }).expect("Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn read_only_by_title(core: &Core) -> (Vec<(String, bool)>, Vec<(String, bool)>) {
    let mut inbox: Vec<(String, bool)> = core.inbox_list().into_iter().map(|r| (r.title, r.read_only)).collect();
    let mut tasks: Vec<(String, bool)> = core.tasks().into_iter().map(|r| (r.title, r.read_only)).collect();
    inbox.sort();
    tasks.sort();
    (inbox, tasks)
}

#[test]
fn d2554_nfd_named_inbox_and_task_rows_are_read_only_on_the_phone() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(Arc::new(tegg_vault::testing::resolving_fs(&root)), &sb);
    let (inbox, tasks) = read_only_by_title(&core);
    assert_eq!(inbox, vec![("Poznámka na cestě".to_string(), true), ("Poznámka čistá".to_string(), false)], "Inbox rows");
    assert_eq!(tasks, vec![("Úkol pro Evu".to_string(), true), ("Úkol čistý".to_string(), false)], "task rows");
}

#[cfg(target_os = "macos")]
#[test]
fn d2554_desktop_rows_are_unchanged() {
    let sb = sandbox();
    let root = vault(&sb);
    let core = open(Arc::new(tegg_vault::LocalFs::new(&root)), &sb);
    let (inbox, tasks) = read_only_by_title(&core);
    assert!(inbox.len() == 2 && inbox.iter().all(|(_, ro)| !ro), "macOS Inbox rows are writable: {inbox:?}");
    assert!(tasks.len() == 2 && tasks.iter().all(|(_, ro)| !ro), "macOS task rows are writable: {tasks:?}");
}
