//! MS5 slice 5B AC tests at the core (L4): portable vault settings (docs/acceptance/capture.md FR-VLT-05, FR-SET-01,
//! R58; docs/contracts/ms5-capture.md §5.1; D-541, D-551). FR-VLT-05 AC-1 (`default-type` matched by D-239; unusable
//! values give Quick Note; reading never writes), AC-7 (a renamed default type stays the default; a deleted one gives
//! Quick Note without rewriting `vault.yml`); FR-SET-01 AC-2 (the default type writes one line, as the key), AC-3 (a
//! stale base is refused with `Conflict`), AC-4 (`daily-format`: one line; the next Daily Note's name; D-336 formats
//! refused), AC-5 (the daily notes folder through the Daily Note type file), AC-6 (`attachments`: one line, nothing
//! moved or created; D-222 folders refused), AC-9 (missing keys read as defaults; the first change appends its key).
//! Interface: `Core::vault_settings`, `vault_settings_patch`, `VaultKey`, `VaultSettings` (new); `type_patch`,
//! `type_get`, `daily_draft`, `daily_view` (existing). Written from the ACs and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/inbox + new-empty/.tegg in a temporary directory.

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::NaiveDate;
use common::*;
use tegg_core::{Core, CoreError, CoreOptions, VaultError, VaultKey};
use tegg_format::nfc;
use tegg_schema::TypeOp;

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
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("date")
}
/// `vault.yml` with its `default-type:` line replaced (`None` removes it).
fn with_default(root: &Path, line: Option<&str>) {
    let y = read(root, YML);
    let i = y.find("default-type:").expect("fixture default-type line");
    let end = i + y[i..].find('\n').expect("eol") + 1;
    let out = match line {
        Some(l) => format!("{}{l}\n{}", &y[..i], &y[end..]),
        None => format!("{}{}", &y[..i], &y[end..]),
    };
    write_raw(root, YML, out.as_bytes());
}

// ------------------------------------------------------------------------------------------------ FR-VLT-05 AC-1

#[test]
fn fr_vlt_05_ac1_default_type_values_are_matched_by_key() {
    let nfd_napad = "na\u{301}pad";
    let cases: Vec<(Option<String>, &str, bool)> = vec![
        (Some("default-type: Quick Note".into()), "quick-note", true),
        (Some("default-type: quick-note".into()), "quick-note", true),
        (Some("default-type: nápad".into()), "nápad", true),
        (Some("default-type: Nápad".into()), "nápad", true),
        (Some(format!("default-type: {nfd_napad}")), "nápad", true),
        (Some("default-type: Daily Note".into()), "daily-note", true),
        (None, "quick-note", false),
        (Some("default-type: \"\"".into()), "quick-note", false),
        (Some("default-type: [a, b]".into()), "quick-note", false),
        (Some("default-type: Neexistuje".into()), "quick-note", false),
    ];
    for (line, key, valid) in cases {
        let sb = sandbox();
        let root = inbox_vault(&sb);
        with_default(&root, line.as_deref());
        let core = open(&root, &sb);
        let before = snapshot(&root);
        let s = core.vault_settings();
        assert_eq!((s.default_type.key.as_str(), s.default_type.valid), (key, valid), "{line:?}: key and validity (D-239, D-541)");
        assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "{line:?}: reading never writes vault.yml");
    }
}

#[test]
fn fr_vlt_05_ac1_the_raw_value_is_kept_for_the_warning() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    with_default(&root, Some("default-type: Neexistuje"));
    let core = open(&root, &sb);
    let s = core.vault_settings();
    assert_eq!(s.default_type.raw.as_deref(), Some("Neexistuje"), "the stored value, for `The default type \"Neexistuje\" doesn't exist.`");
    assert!(s.version.is_some(), "vault.yml's version (the base of a change)");
}

// ------------------------------------------------------------------------------------------------ FR-VLT-05 AC-7

#[test]
fn fr_vlt_05_ac7_a_renamed_default_type_stays_and_a_deleted_one_falls_back() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    with_default(&root, Some("default-type: nápad"));
    let core = open(&root, &sb);
    let yml = snapshot(&root).get(YML).cloned();
    let v = core.type_get("nápad").and_then(|t| t.version);
    ok!(core.type_patch("nápad", v.as_ref(), &[TypeOp::SetName("Myšlenka".into())]), "rename Nápad to Myšlenka");
    let s = core.vault_settings();
    assert_eq!((s.default_type.key.as_str(), s.default_type.valid), ("nápad", true), "the key stays (D-221): still the default");
    assert_eq!(snapshot(&root).get(YML).cloned(), yml, "vault.yml unchanged");
    std::fs::remove_file(root.join(".tegg/types/nápad.yml")).expect("setup: delete the type file outside Tegg");
    core.notify_changed(&strs(&[".tegg/types/nápad.yml"]));
    assert!(
        wait_until(Duration::from_secs(2), || {
            let s = core.vault_settings();
            s.default_type.key == "quick-note" && !s.default_type.valid
        })
        .is_some(),
        "a deleted default type gives Quick Note with the warning"
    );
    assert_eq!(snapshot(&root).get(YML).cloned(), yml, "vault.yml is not rewritten until the user picks a type");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-2

#[test]
fn fr_set_01_ac2_the_default_type_writes_one_line_as_the_key() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    let before = snapshot(&root);
    let base = core.vault_settings().version;
    assert!(base.is_some(), "vault.yml's version");
    let s = ok!(core.vault_settings_patch(base, VaultKey::DefaultType, "nápad".into()), "patch default-type");
    assert_eq!(read(&root, YML), original.replacen("default-type: Quick Note\n", "default-type: nápad\n", 1), "only that line changes; the comment and other lines are byte-identical");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[YML]), "one write, no other file");
    assert_eq!((s.default_type.key.as_str(), s.default_type.valid), ("nápad", true), "the new setting");
    let again = snapshot(&root);
    ok!(core.vault_settings_patch(s.version, VaultKey::DefaultType, "nápad".into()), "the same value");
    assert_eq!(changed(&again, &snapshot(&root)), Vec::<String>::new(), "choosing the current value writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-3

#[test]
fn fr_set_01_ac3_a_stale_base_is_refused() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let base = core.vault_settings().version;
    assert!(base.is_some(), "vault.yml's version");
    let theirs = read(&root, YML).replacen("attachments: _attachments\n", "attachments: Soubory\n", 1);
    write_raw(&root, YML, theirs.as_bytes()); // no event
    let r = core.vault_settings_patch(base, VaultKey::DefaultType, "nápad".into());
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "Conflict: {r:?}");
    assert_eq!(read(&root, YML), theirs, "the file keeps the external bytes");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-4

#[test]
fn fr_set_01_ac4_daily_format_writes_one_line_and_names_the_next_daily_note() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    let base = core.vault_settings().version;
    let s = ok!(core.vault_settings_patch(base, VaultKey::DailyFormat, "DD.MM.YYYY".into()), "patch daily-format");
    assert_eq!(read(&root, YML), original.replacen("daily-format: YYYY-MM-DD\n", "daily-format: DD.MM.YYYY\n", 1), "only the daily-format line");
    assert_eq!(s.daily_format, "DD.MM.YYYY");
    core.notify_changed(&strs(&[YML]));
    let draft = ok!(core.daily_draft(day("2026-10-14")), "daily_draft");
    assert_eq!(nfc(&draft.path), "Daily/14.10.2026.md", "the next first write's name");
    assert_eq!(core.daily_view(day("2026-10-13")).path.map(|p| nfc(&p)).as_deref(), Some("Daily/2026-10-13.md"), "existing Daily Notes keep their names");
}

#[test]
fn fr_set_01_ac4_rejected_formats_write_nothing() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let base = core.vault_settings().version;
    assert!(base.is_some(), "vault.yml's version");
    let before = snapshot(&root);
    for f in ["YYYY/MM/DD", "YYYY:MM:DD", "MM-YYYY", ""] {
        let r = core.vault_settings_patch(base.clone(), VaultKey::DailyFormat, f.into());
        assert!(matches!(r, Err(CoreError::Invalid { .. })), "{f:?}: Invalid with a reason (D-336): {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-5

#[test]
fn fr_set_01_ac5_the_daily_notes_folder_is_the_daily_note_type_folder() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let file = ".tegg/types/daily-note.yml";
    let original = read(&root, file);
    let before = snapshot(&root);
    let v = core.type_get("daily-note").and_then(|t| t.version);
    ok!(core.type_patch("daily-note", v.as_ref(), &[TypeOp::SetFolder("Deník".into())]), "type_patch daily-note folder");
    assert_eq!(read(&root, file), original.replacen("folder: Daily\n", "folder: Deník\n", 1), "only the folder: line");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[file]), "one file");
    assert_eq!(core.vault_settings().daily_format, "YYYY-MM-DD", "vault.yml's settings are unchanged");
    assert_eq!(nfc(&ok!(core.daily_draft(day("2026-10-14")), "daily_draft").path), "Deník/2026-10-14.md", "the next first write goes to Deník/");
    assert_eq!(core.daily_view(day("2026-10-13")).path.map(|p| nfc(&p)).as_deref(), Some("Daily/2026-10-13.md"), "written Daily Notes stay and are found by date (D-226)");
}

#[test]
fn fr_set_01_ac5_a_vault_without_the_type_file_gets_the_default_file_and_bad_folders_are_refused() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    std::fs::remove_file(root.join(".tegg/types/daily-note.yml")).expect("setup: no daily-note.yml");
    let core = open(&root, &sb);
    for bad in [".trash", "../Jinde", "_templates/X"] {
        let before = snapshot(&root);
        let r = core.type_patch("daily-note", None, &[TypeOp::SetFolder(bad.into())]);
        assert!(r.is_err(), "{bad}: refused (D-222): {r:?}");
        assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "{bad}: nothing written");
    }
    ok!(core.type_patch("daily-note", None, &[TypeOp::SetFolder("Deník".into())]), "type_patch without the file");
    let made = read(&root, ".tegg/types/daily-note.yml");
    assert!(made.contains("\nfolder: Deník\n") && made.contains("\nname: Daily Note\n"), "the whole default file with folder: Deník (D-90)");
    assert_eq!(core.vault_settings().daily_format, "YYYY-MM-DD", "vault.yml's settings are unchanged");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-6

#[test]
fn fr_set_01_ac6_attachments_writes_one_line_and_moves_nothing() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = open(&root, &sb);
    let original = read(&root, YML);
    let before = snapshot(&root);
    let base = core.vault_settings().version;
    let s = ok!(core.vault_settings_patch(base, VaultKey::Attachments, "Přílohy".into()), "patch attachments");
    assert_eq!(read(&root, YML), original.replacen("attachments: _attachments\n", "attachments: Přílohy\n", 1), "only the attachments line");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[YML]), "no file or folder is moved or created");
    assert_eq!(s.attachments, "Přílohy");
    let base = s.version;
    let again = snapshot(&root);
    for bad in [".trash", "../Jinde", "_templates/X"] {
        let r = core.vault_settings_patch(base.clone(), VaultKey::Attachments, bad.into());
        assert!(matches!(r, Err(CoreError::Invalid { .. })), "{bad}: Invalid (D-222): {r:?}");
    }
    assert_eq!(changed(&again, &snapshot(&root)), Vec::<String>::new(), "nothing written for refused folders");
}

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-9

#[test]
fn fr_set_01_ac9_missing_keys_read_as_defaults_and_the_first_change_appends() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let y = read(&root, YML);
    let stripped: String = y.lines().filter(|l| !l.starts_with("default-type:") && !l.starts_with("daily-format:") && !l.starts_with("attachments:")).map(|l| format!("{l}\n")).collect();
    write_raw(&root, YML, stripped.as_bytes());
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let s = core.vault_settings();
    assert_eq!((s.default_type.key.as_str(), s.daily_format.as_str(), s.attachments.as_str()), ("quick-note", "YYYY-MM-DD", "_attachments"), "the defaults");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written by reading");
    ok!(core.vault_settings_patch(s.version, VaultKey::Attachments, "Přílohy".into()), "first change");
    assert_eq!(read(&root, YML), format!("{stripped}attachments: Přílohy\n"), "only that key, appended after the last entry");
}
