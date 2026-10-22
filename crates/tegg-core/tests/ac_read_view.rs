//! MS3 slice 3B AC tests at the core (L4): link resolution for the read view (FR-EDT-02 AC-6, AC-8; dialect §6,
//! FR-LNK-14, D-141, D-142, FR-TPL-07, D-102) and the core side of external changes while a note is open
//! (FR-SYN-03 AC-10, AC-11). docs/acceptance/read-view.md; interface docs/contracts/ms3-shell.md §11.1
//! (`link_resolve` → `Core::resolve_links(from, targets) -> Vec<LinkTarget>`). Written from the ACs and contracts only
//! (D-61). Fixture: tests/fixtures/vaults/read-view + new-empty/.tegg, copied into a sandbox.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreEvent, CoreOptions, LinkKind, LinkTarget};
use tegg_vault::{LocalFs, VaultFs};

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

/// `tests/fixtures/vaults/read-view/` plus `new-empty/.tegg/` in `<sandbox>/Čtení`.
fn read_view_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Čtení");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("read-view"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn note(target: &str, path: &str, title: &str, ty: &str) -> LinkTarget {
    LinkTarget {
        target: target.into(),
        kind: LinkKind::Note,
        path: Some(path.into()),
        title: Some(title.into()),
        r#type: Some(ty.into()),
    }
}

fn none(target: &str, kind: LinkKind) -> LinkTarget {
    LinkTarget { target: target.into(), kind, path: None, title: None, r#type: None }
}

/// D-615, D-628 (6A): a target that resolves only in `.trash/` is `Trashed`, with the trashed path.
fn trashed(target: &str, path: &str, title: &str, ty: &str) -> LinkTarget {
    LinkTarget { target: target.into(), kind: LinkKind::Trashed, path: Some(path.into()), title: Some(title.into()), r#type: Some(ty.into()) }
}

const ODKAZY: &str = "Pages/Odkazy.md";
const CIL: &str = "Pages/Cíl.md";

#[test]
fn fr_edt_02_ac6_resolve_links_by_dialect_rules() {
    let sb = sandbox();
    let root = read_view_vault(&sb);
    // A note whose title differs from its file name: never resolved by title alone (FR-LNK-14).
    write_raw(&root, "Pages/Soubor.md", "---\ntype: page\ntitle: Jiný titulek\n---\nText.\n".as_bytes());
    let before = snapshot(&root);
    let fs = CountingFs::new(LocalFs::new(&root));
    let core = ok!(
        Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }),
        "Core::open_with"
    );
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let writes_after_open = fs.write_count();

    let nfd = "Ci\u{301}l";
    let targets = s(&[
        "Cíl", "cíl", nfd, "  Cíl  ", "Cíl#Druhá kapitola", "Cíl|jiný text", "Cíl.md", "Pages/Cíl", "Pages/Cíl.md",
        "01JB0R0000000000000000R001", "Dvojník", "Quick Notes/Dvojník", "Reading list", "Neexistuje", "Šablona", "Smazaná",
        "Jiný titulek", "Soubor",
    ]);
    let got = core.resolve_links(ODKAZY, &targets);
    assert_eq!(got.len(), targets.len(), "one result per target, same order: {got:?}");
    let want = vec![
        note("Cíl", CIL, "Cíl", "page"),
        note("cíl", CIL, "Cíl", "page"),
        note(nfd, CIL, "Cíl", "page"),
        note("  Cíl  ", CIL, "Cíl", "page"),
        note("Cíl#Druhá kapitola", CIL, "Cíl", "page"),
        note("Cíl|jiný text", CIL, "Cíl", "page"),
        note("Cíl.md", CIL, "Cíl", "page"),
        note("Pages/Cíl", CIL, "Cíl", "page"),
        note("Pages/Cíl.md", CIL, "Cíl", "page"),
        note("01JB0R0000000000000000R001", CIL, "Cíl", "page"),
        note("Dvojník", "Pages/Dvojník.md", "Dvojník", "page"),
        note("Quick Notes/Dvojník", "Quick Notes/Dvojník.md", "Dvojník", "quick-note"),
        none("Reading list", LinkKind::Unresolved),
        none("Neexistuje", LinkKind::Unresolved),
        none("Šablona", LinkKind::Unresolved),
        trashed("Smazaná", ".trash/Pages/Smazaná.md", "Smazaná", "page"), // D-628 (6A): trashed, not unresolved
        none("Jiný titulek", LinkKind::Unresolved),
        note("Soubor", "Pages/Soubor.md", "Jiný titulek", "page"),
    ];
    for (g, w) in got.iter().zip(want.iter()) {
        assert_eq!(g, w, "target {:?}", w.target);
    }

    assert_eq!(fs.write_count(), writes_after_open, "resolve_links wrote to the vault");
    assert!(core.last_opened().is_none(), "resolve_links records no recency (it isn't an open)");
    drop(core);
    assert_eq!(snapshot(&root), before, "vault changed (bytes, mtime or inode)");
}

#[test]
fn fr_edt_02_ac6_same_folder_then_shortest_path() {
    let sb = sandbox();
    let root = read_view_vault(&sb);
    let core = open(&root, &sb, false);
    let t = s(&["Dvojník"]);
    let from_qn = core.resolve_links("Quick Notes/Jiná.md", &t);
    assert_eq!(from_qn, vec![note("Dvojník", "Quick Notes/Dvojník.md", "Dvojník", "quick-note")], "same folder first");
    let from_daily = core.resolve_links("Daily/2026-10-07.md", &t);
    assert_eq!(from_daily, vec![note("Dvojník", "Pages/Dvojník.md", "Dvojník", "page")], "else the shortest path");
    let from_pages = core.resolve_links(ODKAZY, &t);
    assert_eq!(from_pages, vec![note("Dvojník", "Pages/Dvojník.md", "Dvojník", "page")], "Odkazy is in Pages/");
}

#[test]
fn fr_edt_02_ac8_date_links() {
    let sb = sandbox();
    let root = read_view_vault(&sb);
    let core = open(&root, &sb, false);
    let got = core.resolve_links(ODKAZY, &s(&["2026-10-07", "2026-10-08"]));
    assert_eq!(got.len(), 2, "one result per target: {got:?}");
    assert!(matches!(got[0].kind, LinkKind::Note | LinkKind::Daily), "[[2026-10-07]] resolves to Denní: {:?}", got[0]);
    assert_eq!(got[0].path.as_deref(), Some("Daily/2026-10-07.md"));
    assert_eq!(got[1], none("2026-10-08", LinkKind::DateMissing), "a date without a Daily Note is date-missing, not unresolved");

    // A Daily Note whose file name isn't the date is still found by its date (Index::daily_note, rule 4).
    std::fs::rename(root.join("Daily/2026-10-07.md"), root.join("Daily/Pondělí.md")).expect("rename");
    core.notify_changed(&s(&["Daily/2026-10-07.md", "Daily/Pondělí.md"]));
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after the rename");
    let got = core.resolve_links(ODKAZY, &s(&["2026-10-07"]));
    assert_eq!(got.len(), 1, "one result: {got:?}");
    assert_eq!(got[0].kind, LinkKind::Daily, "resolved through the Daily Note's date: {:?}", got[0]);
    assert_eq!(got[0].path.as_deref(), Some("Daily/Pondělí.md"));
}

fn changed_paths(rx: &std::sync::mpsc::Receiver<CoreEvent>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        if let CoreEvent::VaultChanged { paths } = ev {
            out.extend(paths);
        }
    }
    out
}

#[test]
fn fr_syn_03_ac10_external_edit_reported_within_2s_and_links_still_resolve() {
    let sb = sandbox();
    let root = read_view_vault(&sb);
    let core = open(&root, &sb, true);
    let rx = core.events();
    let _ = changed_paths(&rx);
    let before = std::fs::read_to_string(root.join(CIL)).expect("read Cíl");
    let after = before.replacen("Výplňový odstavec 3,", "Změněný odstavec 3,", 1);
    assert_ne!(before, after, "setup: paragraph above Druhá kapitola changed");
    write_raw(&root, CIL, after.as_bytes());
    let mut seen = Vec::new();
    let hit = wait_until(Duration::from_secs(2), || {
        seen.extend(changed_paths(&rx));
        seen.iter().any(|p| p == CIL)
    });
    assert!(hit.is_some(), "vault:changed for {CIL} within 2 s (NFR-PERF-08); got {seen:?}");
    let got = core.resolve_links(ODKAZY, &s(&["Cíl"]));
    assert_eq!(got, vec![note("Cíl", CIL, "Cíl", "page")], "links re-resolve after the change");
    assert_eq!(std::fs::read_to_string(root.join(CIL)).expect("read"), after, "no write by the core");
}

#[test]
fn fr_syn_03_ac11_rename_keeps_identity_and_delete_unresolves() {
    let sb = sandbox();
    let root = read_view_vault(&sb);
    let core = open(&root, &sb, true);
    let rx = core.events();
    let _ = changed_paths(&rx);
    let id = "01JB0R0000000000000000R001";

    std::fs::rename(root.join(CIL), root.join("Pages/Cíl nový.md")).expect("rename");
    let mut seen = Vec::new();
    let renamed = wait_until(Duration::from_secs(2), || {
        seen.extend(changed_paths(&rx));
        core.object("Pages/Cíl nový.md").map(|o| o.id.as_deref() == Some(id)).unwrap_or(false)
    });
    assert!(renamed.is_some(), "renamed note indexed at the new path with the same id; events {seen:?}");
    let got = core.resolve_links(ODKAZY, &s(&[id, "Cíl", "Cíl nový"]));
    assert_eq!(
        got,
        vec![
            note(id, "Pages/Cíl nový.md", "Cíl", "page"),
            none("Cíl", LinkKind::Unresolved),
            note("Cíl nový", "Pages/Cíl nový.md", "Cíl", "page"),
        ],
        "the id follows the rename; the old name no longer resolves"
    );

    std::fs::create_dir_all(root.join(".trash/Pages")).expect("trash dir");
    std::fs::rename(root.join("Pages/Cíl nový.md"), root.join(".trash/Pages/Cíl nový.md")).expect("trash");
    let gone = wait_until(Duration::from_secs(2), || core.object("Pages/Cíl nový.md").is_none());
    assert!(gone.is_some(), "moved to .trash/: no longer indexed");
    let got = core.resolve_links(ODKAZY, &s(&[id, "Cíl nový"]));
    assert_eq!(
        got,
        vec![trashed(id, ".trash/Pages/Cíl nový.md", "Cíl", "page"), trashed("Cíl nový", ".trash/Pages/Cíl nový.md", "Cíl", "page")],
        "D-615, D-628 (6A): a target only in .trash/ resolves as trashed, never as a live note"
    );
}
