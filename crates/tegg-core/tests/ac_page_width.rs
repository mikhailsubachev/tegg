//! Slice PW (page width, Normal / Wide) AC tests at the core (L4): docs/acceptance/page-width.md FR-SET-01 AC-11 (the
//! vault default `page-width` writes exactly one appended line after `daily-format: YYYY-MM-DD`; every other byte of
//! `.tegg/vault.yml` is unchanged; an equal value writes nothing), AC-12 (reading of every listed value: unknown,
//! empty and wrongly cased values read as `normal` and are never rewritten; `vault_settings_patch` refuses `Wide`,
//! `huge` and an empty value with `Invalid` and writes nothing; ` wide ` is trimmed; a stale base is `Conflict`),
//! FR-SYN-06 AC-35 L4 part (the setting writes exactly one file, `.tegg/vault.yml`, atomically: temp + rename, so the
//! file gets a new inode and no other entry appears). Interface: docs/contracts/page-width.md §2 (`VaultKey::PageWidth`,
//! `VaultSettings.page_width`, `Core::vault_settings`, `Core::vault_settings_patch`, `CoreError::Invalid { .. }`,
//! `CoreError::Vault(VaultError::Conflict { .. })`). Written from the ACs and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory (its `vault.yml` has no `page-width:`
//! line and ends with `daily-format: YYYY-MM-DD`).

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreError, CoreOptions, VaultError, VaultKey};
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

const YML: &str = ".tegg/vault.yml";
const LAST_LINE: &str = "daily-format: YYYY-MM-DD\n";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn inbox_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Doručené");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("inbox"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = ok!(Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).unwrap_or_default()
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
/// Appends `line` (without a newline) to the fixture's `vault.yml`, after its last entry.
fn with_page_width(root: &Path, line: &str) {
    let y = read(root, YML);
    assert!(y.ends_with(LAST_LINE), "setup: the fixture's vault.yml ends with the daily-format line");
    write_raw(root, YML, format!("{y}{line}\n").as_bytes());
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-11

#[test]
fn fr_set_01_ac11_wide_appends_exactly_one_line_after_daily_format() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    assert!(!original.contains("page-width"), "setup: no page-width line in the fixture");
    assert!(original.starts_with("# Tegg vault settings"), "setup: the fixture's comment line");
    let before = snapshot(&root);
    let s0 = core.vault_settings();
    assert_eq!(s0.page_width, "normal", "no line: normal");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "reading writes nothing");
    let base = s0.version;
    assert!(base.is_some(), "vault.yml's version is the base");
    let s = ok!(core.vault_settings_patch(base, VaultKey::PageWidth, "wide".into()), "patch page-width wide");
    assert_eq!(s.page_width, "wide", "the new setting");
    assert_eq!(read(&root, YML), format!("{original}page-width: wide\n"), "exactly the line `page-width: wide` appended after `daily-format: YYYY-MM-DD`; every other byte, the comment included, unchanged");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[YML]), "one write, no other file");
}

#[test]
fn fr_set_01_ac11_normal_changes_only_that_line_and_an_equal_value_writes_nothing() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    let s = ok!(core.vault_settings_patch(core.vault_settings().version, VaultKey::PageWidth, "wide".into()), "patch wide");
    let s = ok!(core.vault_settings_patch(s.version, VaultKey::PageWidth, "normal".into()), "patch normal");
    assert_eq!(s.page_width, "normal");
    assert_eq!(read(&root, YML), format!("{original}page-width: normal\n"), "only the page-width line changes to `page-width: normal`");
    let again = snapshot(&root);
    let s2 = ok!(core.vault_settings_patch(s.version, VaultKey::PageWidth, "normal".into()), "the same value");
    assert_eq!(s2.page_width, "normal");
    assert_eq!(changed(&again, &snapshot(&root)), Vec::<String>::new(), "choosing the checked value writes nothing (no mtime churn, FR-SYN-06)");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-12

#[test]
fn fr_set_01_ac12_every_listed_value_reads_as_wide_or_normal_without_writing() {
    let cases: [(Option<&str>, &str); 7] = [
        (None, "normal"),
        (Some("page-width: wide"), "wide"),
        (Some("page-width: normal"), "normal"),
        (Some("page-width: Wide"), "normal"),
        (Some("page-width: huge"), "normal"),
        (Some("page-width:"), "normal"),
        (Some("page-width: 1200"), "normal"),
    ];
    for (line, want) in cases {
        let sb = sandbox();
        let root = inbox_vault(&sb);
        if let Some(l) = line {
            with_page_width(&root, l);
        }
        let text = read(&root, YML);
        let core = open(&root, &sb);
        let before = snapshot(&root);
        let s = core.vault_settings();
        assert_eq!(s.page_width, want, "{line:?}: page_width (unknown reads as normal, case-sensitive, AP-754)");
        assert_eq!(s.daily_format, "YYYY-MM-DD", "{line:?}: the other settings still read");
        assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "{line:?}: reading writes nothing");
        assert_eq!(read(&root, YML), text, "{line:?}: an unknown value is never rewritten");
    }
}

#[test]
fn fr_set_01_ac12_invalid_values_are_refused_and_surrounding_spaces_are_trimmed() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    let base = core.vault_settings().version;
    assert!(base.is_some(), "vault.yml's version");
    let before = snapshot(&root);
    for bad in ["Wide", "huge", "", "  "] {
        let r = core.vault_settings_patch(base.clone(), VaultKey::PageWidth, bad.into());
        assert!(matches!(r, Err(CoreError::Invalid { .. })), "{bad:?}: Invalid (normal | wide only, case-sensitive): {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written for refused values");
    assert_eq!(core.vault_settings().page_width, "normal", "still normal");
    let s = ok!(core.vault_settings_patch(base, VaultKey::PageWidth, " wide ".into()), "patch ` wide `");
    assert_eq!(s.page_width, "wide", "trimmed");
    assert_eq!(read(&root, YML), format!("{original}page-width: wide\n"), "written as `page-width: wide`, without the spaces");
}

#[test]
fn fr_set_01_ac12_a_stale_base_is_conflict_and_writes_nothing() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let base = core.vault_settings().version;
    assert!(base.is_some(), "vault.yml's version");
    let theirs = format!("{}page-width: wide\n", read(&root, YML).replacen("attachments: _attachments\n", "attachments: Soubory\n", 1));
    write_raw(&root, YML, theirs.as_bytes()); // outside Tegg, no event
    let before = snapshot(&root);
    let r = core.vault_settings_patch(base, VaultKey::PageWidth, "normal".into());
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "Conflict: {r:?}");
    assert_eq!(read(&root, YML), theirs, "the file keeps the external bytes");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-35 (L4)

#[test]
fn fr_syn_06_ac35_the_setting_writes_one_file_atomically() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let ino_before = before.get(YML).map(|e| e.ino);
    assert!(ino_before.is_some(), "setup: vault.yml in the snapshot");
    let s = ok!(core.vault_settings_patch(core.vault_settings().version, VaultKey::PageWidth, "wide".into()), "patch wide");
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), strs(&[YML]), "exactly one file changed, `.tegg/vault.yml`; no temp file left behind");
    assert_ne!(after.get(YML).map(|e| e.ino), ino_before, "written as temp + rename (FR-SYN-02): a new inode, never in place");
    let s2 = ok!(core.vault_settings_patch(s.version, VaultKey::PageWidth, "normal".into()), "patch normal");
    assert_eq!(s2.page_width, "normal");
    let after2 = snapshot(&root);
    assert_eq!(changed(&after, &after2), strs(&[YML]), "the second change: again only vault.yml");
    assert_ne!(after2.get(YML).map(|e| e.ino), after.get(YML).map(|e| e.ino), "the second write is atomic too");
}
