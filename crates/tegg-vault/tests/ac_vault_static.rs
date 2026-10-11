//! Static and "already passing" AC checks for MS1: AR-03 AC-1/AC-5 (core crates don't depend on the
//! platform), AR-04 AC-1 and FR-SYN-02 AC-1 (file access only through the local `VaultFs`), FR-VLT-01 AC-1
//! (nothing is written before a vault is chosen). These hold for the skeleton too, so they cannot be red.

mod common;

use common::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use tegg_vault::*;

fn rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd {
        let p = e.expect("entry").path();
        if p.is_dir() {
            rust_sources(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

/// Source files under `crates/<crate>/src` with their contents, comments stripped line by line.
fn crate_sources() -> Vec<(String, String, String)> {
    let crates = repo_root().join("crates");
    let mut out = Vec::new();
    for e in std::fs::read_dir(&crates).expect("crates dir") {
        let dir = e.expect("entry").path();
        let name = dir.file_name().expect("name").to_string_lossy().into_owned();
        let mut files = Vec::new();
        rust_sources(&dir.join("src"), &mut files);
        for f in files {
            let text = std::fs::read_to_string(&f).expect("read source");
            let code: String = text
                .lines()
                .map(|l| l.split("//").next().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            out.push((name.clone(), f.strip_prefix(&crates).expect("rel").to_string_lossy().into_owned(), code));
        }
    }
    out
}

#[test]
fn ar_03_ac1_core_crates_do_not_depend_on_tauri_appkit_or_the_app() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let out = Command::new(cargo)
        .current_dir(repo_root())
        .args(["tree", "--workspace", "-e", "normal,build", "--prefix", "none", "--format", "{p}", "--offline"])
        .output()
        .expect("run cargo tree");
    assert!(out.status.success(), "cargo tree failed: {}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8_lossy(&out.stdout);
    let forbidden: Vec<&str> = text
        .lines()
        .filter(|l| {
            let name = l.split_whitespace().next().unwrap_or("");
            name == "tauri"
                || name.starts_with("tauri-")
                || name.starts_with("objc2")
                || name == "objc"
                || name == "cocoa"
                || name.starts_with("cocoa-")
                || name == "icrate"
                || l.contains("src-tauri")
                || l.contains("/app/")
        })
        .collect();
    assert_eq!(forbidden, Vec::<&str>::new());
    assert!(text.lines().any(|l| l.starts_with("tegg-vault ")), "cargo tree lists the workspace");
}

#[test]
fn ar_03_ac5_core_crates_reference_no_menu_bar_or_hotkey_symbols() {
    let needles = ["NSStatusItem", "NSStatusBar", "global_hotkey", "global_shortcut", "GlobalShortcut", "TrayIcon", "tray_icon", "menu_bar"];
    let hits: Vec<String> = crate_sources()
        .into_iter()
        .filter(|(_, _, code)| needles.iter().any(|n| code.contains(n)))
        .map(|(_, f, _)| f)
        .collect();
    assert_eq!(hits, Vec::<String>::new());
}

#[test]
fn ar_04_ac1_no_direct_file_system_access_outside_tegg_vault() {
    let needles = ["std::fs", "tokio::fs", "notify::", "use notify", "File::create", "OpenOptions"];
    let hits: Vec<String> = crate_sources()
        .into_iter()
        .filter(|(krate, _, code)| krate != "tegg-vault" && needles.iter().any(|n| code.contains(n)))
        .map(|(_, f, _)| f)
        .collect();
    assert_eq!(hits, Vec::<String>::new());
}

#[test]
fn fr_syn_02_ac1_file_writing_apis_appear_in_at_most_one_tegg_vault_source_file() {
    let writes = ["File::create", "OpenOptions", "fs::write", "tokio::fs"];
    let hits: Vec<String> = crate_sources()
        .into_iter()
        .filter(|(krate, _, code)| krate == "tegg-vault" && writes.iter().any(|n| code.contains(n)))
        .map(|(_, f, _)| f)
        .collect();
    assert!(hits.len() <= 1, "file-writing APIs must live only in the local VaultFs implementation: {hits:?}");
}

#[test]
fn fr_vlt_01_ac1_nothing_is_written_to_app_support_before_a_vault_is_chosen() {
    let sb = sandbox();
    assert_eq!(Vault::last_opened(&sb.dirs), None);
    assert_eq!(files(&sb.dirs.root), Vec::<String>::new());
    assert_eq!(dirs_of(&sb.dirs.root), Vec::<String>::new());
}
