//! AC tests for the recent-vaults list (D-219): FR-VLT-01 AC-17, L4 part (docs/acceptance/app-shell.md,
//! docs/contracts/ms3-shell.md §12.5). Written from the ACs and the contract only (D-61).
//!
//! Interface expected: `Vault::recent(&AppDirs) -> Vec<RecentVault>` with `RecentVault { name, path, exists }`,
//! most recent first, at most 9, recorded by `Vault::open` and `Vault::create` on success, NFC-normalized path,
//! no duplicates, `exists` checked at call time, stored under Application Support (FR-STO-07).

mod common;

use common::*;
use std::path::{Path, PathBuf};
use tegg_vault::*;

/// (name, path, exists) of every entry, in order.
fn recent(dirs: &AppDirs) -> Vec<(String, PathBuf, bool)> {
    Vault::recent(dirs).iter().map(|r| (r.name.to_string(), PathBuf::from(&r.path), r.exists)).collect()
}

fn vault_at(sb: &Sandbox, rel: &str) -> PathBuf {
    let p = sb.base.join(rel);
    manual_vault(&p);
    p
}

fn open(p: &Path, dirs: &AppDirs) -> bool {
    Vault::open(p, dirs).is_ok()
}

fn name_of(p: &Path) -> String {
    p.file_name().unwrap().to_string_lossy().into_owned()
}

#[test]
fn fr_vlt_01_ac17_opened_vaults_are_listed_most_recent_first() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    let b = vault_at(&sb, "Čtenářský deník");
    assert!(open(&a, &sb.dirs) && open(&b, &sb.dirs), "setup: open A then B");
    assert_eq!(
        recent(&sb.dirs),
        vec![(name_of(&b), b.clone(), true), (name_of(&a), a.clone(), true)],
        "B first, then A"
    );
}

#[test]
fn fr_vlt_01_ac17_created_vault_is_recorded_first() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    assert!(open(&a, &sb.dirs), "setup: open A");
    let parent = sb.base.join("Dokumenty");
    std::fs::create_dir_all(&parent).expect("parent dir");
    let created = Vault::create(&parent, "Nový trezor", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let got = recent(&sb.dirs);
    assert_eq!(got.len(), 2, "two entries: {got:?}");
    assert_eq!(got[0], ("Nový trezor".to_string(), parent.join("Nový trezor"), true), "created vault first");
    assert_eq!(got[1], (name_of(&a), a.clone(), true));
}

#[test]
fn fr_vlt_01_ac17_reopening_moves_to_front_without_duplicates() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    let b = vault_at(&sb, "Trezor B");
    assert!(open(&a, &sb.dirs) && open(&b, &sb.dirs) && open(&a, &sb.dirs), "setup: A, B, A");
    let paths: Vec<PathBuf> = recent(&sb.dirs).into_iter().map(|e| e.1).collect();
    assert_eq!(paths, vec![a, b]);
}

#[test]
fn fr_vlt_01_ac17_nfd_and_nfc_paths_are_one_entry() {
    let sb = sandbox();
    let nfc = vault_at(&sb, NFC_CTENI);
    let nfd = sb.base.join(NFD_CTENI);
    assert!(open(&nfc, &sb.dirs), "setup: open by NFC path");
    assert!(open(&nfd, &sb.dirs), "setup: open the same folder by NFD path");
    let got = recent(&sb.dirs);
    assert_eq!(got.len(), 1, "one entry for one folder: {got:?}");
    assert_eq!(got[0].1.to_str(), nfc.to_str(), "the stored path is NFC");
    assert_eq!(got[0].0, NFC_CTENI, "the name is NFC");
}

#[test]
fn fr_vlt_01_ac17_keeps_the_nine_most_recent() {
    let sb = sandbox();
    let mut all = Vec::new();
    for i in 1..=11 {
        let p = vault_at(&sb, &format!("Trezor č. {i}"));
        assert!(open(&p, &sb.dirs), "setup: open {i}");
        all.push(p);
    }
    let paths: Vec<PathBuf> = recent(&sb.dirs).into_iter().map(|e| e.1).collect();
    let want: Vec<PathBuf> = all.iter().rev().take(9).cloned().collect();
    assert_eq!(paths, want, "11 → 3, most recent first");
}

#[test]
fn fr_vlt_01_ac17_exists_is_checked_at_call_time() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    let b = vault_at(&sb, "Přesunutý trezor");
    assert!(open(&b, &sb.dirs) && open(&a, &sb.dirs), "setup");
    assert_eq!(recent(&sb.dirs).iter().map(|e| e.2).collect::<Vec<_>>(), vec![true, true]);
    std::fs::remove_dir_all(&b).expect("remove B");
    assert_eq!(recent(&sb.dirs), vec![(name_of(&a), a.clone(), true), (name_of(&b), b.clone(), false)]);
    manual_vault(&b);
    assert_eq!(recent(&sb.dirs)[1].2, true, "back again → exists");
}

#[test]
fn fr_vlt_01_ac17_failed_open_is_not_recorded() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    let plain = sb.base.join("Obyčejná složka");
    std::fs::create_dir_all(&plain).expect("plain dir");
    assert!(open(&a, &sb.dirs), "setup: open A");
    assert!(!open(&plain, &sb.dirs), "setup: a folder without .tegg/ doesn't open");
    assert!(!open(&sb.base.join("Neexistuje"), &sb.dirs), "setup: a missing folder doesn't open");
    assert_eq!(recent(&sb.dirs), vec![(name_of(&a), a, true)]);
}

#[test]
fn fr_vlt_01_ac17_list_lives_in_app_support_not_in_the_vault() {
    let sb = sandbox();
    let a = vault_at(&sb, "Trezor A");
    let b = vault_at(&sb, "Trezor B");
    let before_a = snapshot(&a);
    let before_b = snapshot(&b);
    assert!(open(&a, &sb.dirs) && open(&b, &sb.dirs), "setup");
    assert_eq!(recent(&sb.dirs).len(), 2, "both recorded");
    assert_eq!(snapshot(&a), before_a, "vault A unchanged by recording");
    assert_eq!(snapshot(&b), before_b, "vault B unchanged by recording");
    // Another Application Support root (another Mac) has its own, empty list.
    let other = AppDirs { root: sb.base.join("Jiná podpora/Tegg") };
    std::fs::create_dir_all(&other.root).expect("other app support");
    assert_eq!(recent(&other), vec![], "machine-local");
}

#[test]
fn fr_vlt_01_ac17_empty_without_any_vault() {
    // Red guard: the list works at all (another sandbox with one opened vault lists it), so "empty" isn't vacuous.
    let other = sandbox();
    let a = vault_at(&other, "Trezor A");
    assert!(open(&a, &other.dirs), "setup: open A");
    assert_eq!(recent(&other.dirs).len(), 1, "an opened vault is listed");
    let sb = sandbox();
    assert_eq!(recent(&sb.dirs), vec![]);
}
