//! Slice AND-1, L4 (Mac host, APFS, temporary copy): docs/acceptance/android-shell.md FR-SYN-06 AC-53 "Opening a vault
//! on Android writes nothing: no tidy job, no bulk job" (D-2007, AP-2025 → D-2025; T1), through
//! `Core::open_ext(root, dirs, opts, OpenExtras { bulk_jobs: false })` (docs/contracts/android-shell.md §3.3; CP-1 →
//! D-2036 reads the AC's `CoreOptions { bulk_jobs: false, .. }` as this call).
//!
//! The shell fixture plus the Stray (`Pages/Zavolat Petrovi.md`, a Task outside `Tasks/`), the watcher on and
//! `TEGG_TEST_QUIET_MS=200`. After the index is idle, `jobs().set_ui_ready()`, 3 s, a line appended to Úvodní from
//! outside (a watcher event), 3 s more: every file except Úvodní is untouched and the Stray is still in `Pages/`. Then
//! `jobs().start(op)` refuses every bulk `JobOp` with `Unsupported` and writes nothing. Positive control: the same vault
//! opened with the desktop options moves the Stray to `Tasks/` (FR-STO-01 AC-7, 4E). The device half of the AC is
//! `app/e2e-android/android_watcher.ac.test.ts`. Written from the ACs and the contract only (D-61).

mod common;

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::{repo_root, sandbox, snapshot, wait_until, Entry};
use tegg_core::{Core, CoreOptions, OpenExtras};
use tegg_jobs::{InboxJobChange, JobOp};

const UVODNI: &str = "Pages/Úvodní stránka.md";
const STRAY: &str = "Pages/Zavolat Petrovi.md";
const STRAY_MOVED: &str = "Tasks/Zavolat Petrovi.md";
const STRAY_TEXT: &str = "---\nid: 01JAND1STRAY00000000000000\ntype: task\ntitle: Zavolat Petrovi\nstatus: todo\n---\nZavolat Petrovi kvůli chalupě.\n";

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: mkdir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        let t = to.join(e.file_name());
        if e.file_type().expect("setup: type").is_dir() {
            copy_tree(&e.path(), &t);
        } else {
            std::fs::copy(e.path(), &t).expect("setup: copy");
        }
    }
}

/// `<base>/<name>`: the shell fixture, `new-empty/.tegg/` and the Stray.
fn shell_with_stray(base: &Path, name: &str) -> PathBuf {
    let root = base.join(name);
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_tree(&fx.join("shell"), &root);
    copy_tree(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    std::fs::write(root.join(STRAY), STRAY_TEXT).expect("setup: the Stray");
    root
}

fn append_line(root: &Path, rel: &str, line: &str) {
    let mut f = std::fs::OpenOptions::new().append(true).open(root.join(rel)).expect("setup: open for append");
    f.write_all(line.as_bytes()).expect("setup: append");
}

fn changed(before: &BTreeMap<String, Entry>, after: &BTreeMap<String, Entry>, except: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for (k, v) in before {
        if except.contains(&k.as_str()) {
            continue;
        }
        match after.get(k) {
            None => out.push(format!("{k}: gone")),
            Some(a) if a != v => out.push(format!("{k}: changed")),
            _ => {}
        }
    }
    for k in after.keys() {
        if !before.contains_key(k) {
            out.push(format!("{k}: created"));
        }
    }
    out
}

/// Every bulk op of contract §3.3 (all `JobOp`s except `TestBackup`).
fn bulk_ops() -> Vec<(&'static str, JobOp)> {
    vec![
        ("FolderMove (tidy)", JobOp::FolderMove { r#type: None, to_folder: None }),
        ("FolderMove (folder save)", JobOp::FolderMove { r#type: Some("task".into()), to_folder: Some("Úkoly".into()) }),
        ("NoteRename", JobOp::NoteRename { path: UVODNI.into(), title: "Úvod".into() }),
        ("Undo", JobOp::Undo { job: 1 }),
        ("Redo", JobOp::Redo { job: 1 }),
        ("TagRename", JobOp::TagRename { from: "práce".into(), to: "zaměstnání".into() }),
        ("TagDelete", JobOp::TagDelete { tag: "práce".into(), keep_text: true }),
        ("Merge", JobOp::Merge { keep: "Pages/Bez hlavičky.md".into(), others: vec![UVODNI.into()] }),
        ("KeyRename", JobOp::KeyRename { r#type: "task".into(), from: "status".into(), to: "stav".into() }),
        ("ValueRemove", JobOp::ValueRemove { r#type: "task".into(), key: "status".into() }),
        ("TypeMove", JobOp::TypeMove { paths: vec![STRAY.into()], to_type: "page".into(), mapping: vec![], review: false, bulk: true }),
        ("TypeDelete", JobOp::TypeDelete { r#type: "recept".into() }),
        (
            "Inbox",
            JobOp::Inbox {
                paths: vec!["Quick Notes/Druhý nápad.md".into()],
                change: InboxJobChange::SetReview { value: "reviewed".into(), now: "2026-11-22T10:00:00+01:00".into() },
            },
        ),
        ("Restore", JobOp::Restore { name: "2026-11-22 10-00-00 tidy.zip".into() }),
        ("QueryRename", JobOp::QueryRename { name: "Otevřené úkoly".into(), title: "Úkoly".into() }),
    ]
}

#[test]
fn fr_syn_06_ac53_no_writes_and_no_jobs_on_android() {
    std::env::set_var("TEGG_TEST_QUIET_MS", "200");
    let sb = sandbox();

    // ---- Android options: no tidy job, no bulk job.
    let root = shell_with_stray(&sb.base, "Telefon");
    let before = snapshot(&root);
    let core = Core::open_ext(&root, &sb.dirs, CoreOptions { watch: true, sync: None }, OpenExtras { bulk_jobs: false });
    assert!(core.is_ok(), "Core::open_ext opens the shell fixture: {:?}", core.as_ref().err());
    let core = core.unwrap();
    assert!(core.wait_idle(Duration::from_secs(120)), "the index becomes idle");
    // The real `@tegg/doc` transformer when it is built (the gate builds it), so a tidy job that did start could finish.
    if let Ok(t) = tegg_jobs::testing::NodeTransformer::from_repo(&repo_root()) {
        core.jobs().set_transformer(std::sync::Arc::new(t));
    }
    core.jobs().set_ui_ready();
    std::thread::sleep(Duration::from_secs(3));
    append_line(&root, UVODNI, "Řádek z jiného programu.\n");
    std::thread::sleep(Duration::from_secs(3));
    let after = snapshot(&root);
    assert!(root.join(STRAY).is_file(), "the Stray is still in Pages/ (no tidy move on the phone, D-2007)");
    assert!(!root.join(STRAY_MOVED).exists(), "nothing was moved to Tasks/");
    assert_eq!(changed(&before, &after, &[UVODNI]), Vec::<String>::new(), "every file except Úvodní is untouched (size, hash, mtime, inode)");

    for (name, op) in bulk_ops() {
        let r = core.jobs().start(op);
        let shown = format!("{r:?}");
        assert!(r.is_err(), "jobs().start({name}) is refused with bulk_jobs: false; got {shown}");
        assert!(shown.contains("Unsupported"), "jobs().start({name}) → JobError::Unsupported; got {shown}");
    }
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(changed(&after, &snapshot(&root), &[]), Vec::<String>::new(), "the refused ops wrote nothing");
    drop(core);

    // ---- Positive control: the desktop options move the Stray to Tasks/ (the 4E tidy job).
    let root = shell_with_stray(&sb.base, "Mac");
    let core = Core::open(&root, &common::fresh_dirs(&sb, "Mac"), CoreOptions { watch: true, sync: None });
    assert!(core.is_ok(), "Core::open (desktop) opens the copy: {:?}", core.as_ref().err());
    let core = core.unwrap();
    assert!(core.wait_idle(Duration::from_secs(120)), "the desktop index becomes idle");
    if let Ok(t) = tegg_jobs::testing::NodeTransformer::from_repo(&repo_root()) {
        core.jobs().set_transformer(std::sync::Arc::new(t));
    }
    core.jobs().set_ui_ready();
    let moved = wait_until(Duration::from_secs(30), || root.join(STRAY_MOVED).is_file() && !root.join(STRAY).exists());
    assert!(moved.is_some(), "positive control: with the desktop options the tidy job moves the Stray to Tasks/");
    drop(core);
}
