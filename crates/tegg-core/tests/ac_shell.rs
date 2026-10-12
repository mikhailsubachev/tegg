//! MS3 slice 3A AC tests at the core (L4): FR-UX-02 AC-3 (type counts), AC-5 (counts follow external changes),
//! AC-6 (type file names in NFD). docs/acceptance/app-shell.md; interface docs/contracts/ms3-shell.md §2
//! (`vault_types`, `index_type_counts`, `index_list` → `Core::types`, `Core::type_counts`, `Core::list_type`).
//! Written from the ACs and contracts only (D-61). Fixture: tests/fixtures/vaults/shell + new-empty/.tegg.

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use tegg_core::{Core, CoreEvent, CoreOptions};
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

/// `tests/fixtures/vaults/shell/` plus `new-empty/.tegg/` in `<sandbox>/Trezor`.
fn shell_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Trezor");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("shell"), &root);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"));
    root
}

fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}

fn counts(pairs: &[(&str, usize)]) -> BTreeMap<String, usize> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

#[test]
fn fr_ux_02_ac3_type_counts_from_the_core_without_writes() {
    let sb = sandbox();
    let root = shell_vault(&sb);
    let before = snapshot(&root);
    let fs = CountingFs::new(LocalFs::new(&root));
    let core = ok!(
        Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }),
        "Core::open_with"
    );
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    let writes_after_open = fs.write_count();

    let got = core.type_counts();
    assert_eq!(got, counts(&[("page", 2), ("quick-note", 2), ("task", 1), ("schůzka", 1), ("recept", 1)]));

    // Lists use the same exclusions (template and trashed page never listed).
    let mut pages: Vec<String> = core.list_type("page").into_iter().map(|o| o.path).collect();
    pages.sort();
    assert_eq!(pages, vec!["Pages/Bez hlavičky.md".to_string(), "Pages/Úvodní stránka.md".to_string()]);
    let mut qn: Vec<String> = core.list_type("quick-note").into_iter().map(|o| o.title).collect();
    qn.sort();
    assert_eq!(qn, vec!["Druhý nápad".to_string(), "Nápad na čtvrtek".to_string()]);
    assert_eq!(core.list_type("cesta").len(), 0);

    assert_eq!(fs.write_count(), writes_after_open, "type counts and lists wrote to the vault");
    assert_eq!(writes_after_open, 0, "opening the vault wrote to it");
    drop(core);
    assert_eq!(snapshot(&root), before, "vault changed (bytes, mtime or inode)");
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
fn fr_ux_02_ac5_counts_follow_external_changes_within_2s() {
    let sb = sandbox();
    let root = shell_vault(&sb);
    let core = open(&root, &sb, true);
    let rx = core.events();
    let _ = changed_paths(&rx);
    let limit = Duration::from_secs(2); // NFR-PERF-08
    let qn = |c: &Core| c.type_counts().get("quick-note").copied().unwrap_or(0);

    // Created by another program.
    let new_note = "---\ntype: quick-note\ntitle: Třetí nápad\n---\nDalší nápad.\n";
    write_raw(&root, "Quick Notes/Třetí nápad.md", new_note.as_bytes());
    let t0 = Instant::now();
    let mut seen = Vec::new();
    let ok_created = wait_until(limit, || {
        seen.extend(changed_paths(&rx));
        qn(&core) == 3 && seen.iter().any(|p| p == "Quick Notes/Třetí nápad.md")
    });
    assert!(ok_created.is_some(), "after create: quick-note = {}, vault:changed paths {:?}, after {:?}", qn(&core), seen, t0.elapsed());

    // Moved into the trash by another program.
    std::fs::create_dir_all(root.join(".trash/Quick Notes")).expect("trash dir");
    std::fs::rename(root.join("Quick Notes/Třetí nápad.md"), root.join(".trash/Quick Notes/Třetí nápad.md")).expect("move");
    let ok_trashed = wait_until(limit, || qn(&core) == 2);
    assert!(ok_trashed.is_some(), "after move to .trash: quick-note = {}", qn(&core));

    // Deleted by another program: the type disappears from the counts; its definition stays.
    std::fs::remove_file(root.join("Schůzky/2026-10-07 Porada.md")).expect("delete");
    let ok_deleted = wait_until(limit, || !core.type_counts().contains_key("schůzka"));
    assert!(ok_deleted.is_some(), "after delete: counts {:?}", core.type_counts());
    assert!(core.types().iter().any(|t| t.key == "schůzka"), "the Schůzka definition must stay listed");
    assert_eq!(core.type_counts(), counts(&[("page", 2), ("quick-note", 2), ("task", 1), ("recept", 1)]));
}

#[test]
fn fr_ux_02_ac6_type_file_in_nfd_listed_once_in_nfc() {
    let sb = sandbox();
    let root = shell_vault(&sb);
    let core = open(&root, &sb, true);
    let nfc = root.join(".tegg/types/čajovna.yml");
    let nfd = root.join(".tegg/types/c\u{30C}ajovna.yml");
    let tmp = root.join(".tegg/types/rename-tmp.yml");
    std::fs::rename(&nfc, &tmp).expect("rename to temp");
    std::fs::rename(&tmp, &nfd).expect("rename to NFD");
    let names: Vec<_> = std::fs::read_dir(root.join(".tegg/types")).expect("ls").map(|e| e.expect("e").file_name()).collect();
    assert!(names.iter().any(|n| n.to_string_lossy() == "c\u{30C}ajovna.yml"), "setup: NFD name not stored: {names:?}");

    let _ = wait_until(Duration::from_secs(2), || core.types().iter().filter(|t| t.key == "čajovna").count() == 1);
    let types = core.types();
    let matches: Vec<_> = types.iter().filter(|t| t.key.chars().filter(|c| *c != '\u{30C}').collect::<String>().replace('č', "c") == "cajovna").collect();
    assert_eq!(matches.len(), 1, "listed exactly once: {types:?}");
    let t = matches[0];
    assert_eq!((t.key.as_str(), t.name.as_str(), t.plural.as_str()), ("čajovna", "Čajovna", "Čajovny"), "NFC key, name and plural");
    assert!(!t.invalid, "the NFD-named file must be read");
    // `type/čajovna` resolves: the NFC key finds the definition.
    assert_eq!(types.iter().filter(|t| t.key == "čajovna").count(), 1);
}
