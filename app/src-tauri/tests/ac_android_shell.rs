//! Slice AND-1, L1 (Mac host, temporary folders): the shell's pure functions of docs/contracts/android-shell.md §4, §5.1,
//! for docs/acceptance/android-shell.md
//! - FR-STO-07 AC-15: `platform::app_dirs_for(&Platform)` (F7; CP-2 → D-2037: on Android the dir is
//!   `Context.getFilesDir()`, passed in as `files_dir`);
//! - FR-VLT-01 AC-24: `vaultfind::find_vaults(root)` (RA6);
//! - FR-VLT-01 AC-25, L1 part: `vaultfind::resolve_typed_path(input, shared_root, private_root, need_vault)` (RA4);
//! - FR-VLT-01 AC-19, AC-20, supporting L1: `start::start_state(access, remembered, opened)` (RA3; the AC tests are L5
//!   and LA, these cases pin the pure decision the shell makes before any `Core::open`).
//!
//! Written from the ACs and the contract only (D-61).

use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use tegg_app_lib::platform::{app_dirs_for, Platform};
use tegg_app_lib::start::{start_state, StartState};
use tegg_app_lib::vaultfind::{find_vaults, resolve_typed_path, PathRefusal};

struct Tmp(PathBuf);
impl Drop for Tmp {
    fn drop(&mut self) {
        // Give locked folders their permissions back so the tree can be removed.
        fn unlock(p: &Path) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.flatten() {
                    if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        unlock(&e.path());
                    }
                }
            }
        }
        unlock(&self.0);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn tmp(tag: &str) -> Tmp {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let p = std::env::temp_dir().join(format!("tegg-and1-{tag}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&p).expect("setup: temp dir");
    Tmp(p.canonicalize().expect("setup: canonical temp dir"))
}

/// `á` and `í` decomposed (NFD bytes).
fn nfd(s: &str) -> String {
    s.replace('á', "a\u{301}").replace('í', "i\u{301}").replace('é', "e\u{301}")
}

fn os(s: &str) -> &OsStr {
    OsStr::from_bytes(s.as_bytes())
}

fn vault_at(dir: &Path) {
    std::fs::create_dir_all(dir.join(".tegg")).expect("setup: .tegg");
    std::fs::write(dir.join(".tegg/vault.yml"), "version: 1\n").expect("setup: vault.yml");
}

/// Every path under `root` (dirs with a trailing `/`), for "nothing was created or changed".
fn listing(root: &Path) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    fn walk(root: &Path, d: &Path, out: &mut BTreeSet<String>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default();
            let md = std::fs::symlink_metadata(&p);
            if md.as_ref().map(|m| m.is_dir()).unwrap_or(false) {
                out.insert(format!("{rel}/"));
                walk(root, &p, out);
            } else {
                out.insert(format!("{rel} {}", md.map(|m| m.len()).unwrap_or(0)));
            }
        }
    }
    walk(root, root, &mut out);
    out
}

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-15

#[test]
fn fr_sto_07_ac15_app_dirs_from_the_platform() {
    let mac = |preview: bool, test: bool, app_support: Option<&str>| Platform::MacOs {
        home: PathBuf::from("/Users/t"),
        preview,
        test,
        app_support: app_support.map(String::from),
    };
    let root = |p: &Platform| app_dirs_for(p).root;
    assert_eq!(root(&mac(false, false, None)), PathBuf::from("/Users/t/Library/Application Support/Tegg"), "macOS, no preview");
    assert_eq!(root(&mac(true, false, None)), PathBuf::from("/Users/t/Library/Application Support/Tegg Preview"), "macOS, preview");
    assert_eq!(root(&mac(false, true, Some("/tmp/x"))), PathBuf::from("/tmp/x"), "macOS, TEGG_TEST=1 and TEGG_APP_SUPPORT=/tmp/x");
    assert_eq!(root(&mac(true, true, Some("/tmp/x"))), PathBuf::from("/tmp/x"), "macOS preview, TEGG_TEST=1 and TEGG_APP_SUPPORT");
    assert_eq!(root(&mac(false, false, Some("/tmp/x"))), PathBuf::from("/Users/t/Library/Application Support/Tegg"), "TEGG_APP_SUPPORT without TEGG_TEST is ignored");
    assert_eq!(root(&mac(false, true, Some(""))), PathBuf::from("/Users/t/Library/Application Support/Tegg"), "an empty TEGG_APP_SUPPORT is ignored");

    let files = PathBuf::from("/data/user/0/app.tegg.preview/files");
    assert_eq!(root(&Platform::Android { files_dir: files.clone() }), files, "Android: exactly the platform's files dir");
    std::env::set_var("HOME", "/data/user/0/app.tegg.preview/home");
    assert_eq!(root(&Platform::Android { files_dir: files.clone() }), files, "Android with $HOME set: still the files dir, never $HOME");
    let test_files = PathBuf::from("/data/user/0/app.tegg.desktop/files");
    assert_eq!(root(&Platform::Android { files_dir: test_files.clone() }), test_files, "Android, the test APK's files dir (no constant)");
}

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-24

#[test]
fn fr_vlt_01_ac24_find_vaults() {
    use std::os::unix::fs::PermissionsExt;
    let t = tmp("find");
    let r = &t.0;
    let poznamky = nfd("Poznámky");
    vault_at(&r.join("Documents/Staré/Archiv"));
    vault_at(&r.join("Notes"));
    vault_at(&r.join("Documents").join(os(&poznamky)));
    vault_at(&r.join("Documents/Tegg"));
    vault_at(&r.join("Documents/Tegg/Projects/Inner"));
    vault_at(&r.join("Documents/A/B/C/Deep"));
    vault_at(&r.join("Android/data/Hidden"));
    vault_at(&r.join("Android/Vault"));
    vault_at(&r.join(".hidden/Vault"));
    std::os::unix::fs::symlink(r.join("Notes"), r.join("Documents/Link")).expect("setup: symlink");
    std::fs::create_dir_all(r.join("Documents/Fake/.tegg/vault.yml")).expect("setup: vault.yml as a folder");
    vault_at(&r.join("Documents/Locked/Inside"));
    std::fs::set_permissions(r.join("Documents/Locked"), std::fs::Permissions::from_mode(0o000)).expect("setup: chmod 000");
    let names: Vec<Vec<u8>> = std::fs::read_dir(r.join("Documents")).expect("setup").filter_map(|e| e.ok()).map(|e| e.file_name().as_bytes().to_vec()).collect();
    assert!(names.contains(&poznamky.as_bytes().to_vec()), "setup: Documents/Poznámky is stored in NFD bytes");

    let got: Vec<(String, Vec<u8>)> = find_vaults(r).into_iter().map(|v| (v.name, v.path.as_os_str().as_bytes().to_vec())).collect();
    let want: Vec<(String, Vec<u8>)> = vec![
        ("Archiv".into(), r.join("Documents/Staré/Archiv").as_os_str().as_bytes().to_vec()),
        ("Notes".into(), r.join("Notes").as_os_str().as_bytes().to_vec()),
        ("Poznámky".into(), r.join("Documents").join(os(&poznamky)).as_os_str().as_bytes().to_vec()),
        ("Tegg".into(), r.join("Documents/Tegg").as_os_str().as_bytes().to_vec()),
    ];
    let show = |v: &[(String, Vec<u8>)]| v.iter().map(|(n, p)| format!("{n} @ {}", String::from_utf8_lossy(p))).collect::<Vec<_>>();
    assert_eq!(show(&got), show(&want), "exactly the four vaults, by name (depth 1–3; not inside a vault, under Android/, hidden, linked, fake or locked)");
    assert_eq!(got, want, "names NFC, paths the on-disk bytes (Poznámky's folder in NFD)");
    assert_eq!(got[2].0.as_bytes(), "Poznámky".as_bytes(), "Poznámky's name is NFC");

    let t60 = tmp("find60");
    for i in (1..=60).rev() {
        vault_at(&t60.0.join(format!("Trezor {i:02}")));
    }
    let got: Vec<String> = find_vaults(&t60.0).into_iter().map(|v| v.name).collect();
    let want: Vec<String> = (1..=50).map(|i| format!("Trezor {i:02}")).collect();
    assert_eq!(got, want, "60 vaults at depth 1: the first 50 by name");
}

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-25 (L1)

#[test]
fn fr_vlt_01_ac25_typed_path() {
    let t = tmp("typed");
    let shared = t.0.join("storage/emulated/0");
    let private = t.0.join("data/user/0/app.tegg.desktop/files");
    std::fs::create_dir_all(&shared).expect("setup");
    std::fs::create_dir_all(&private).expect("setup");
    let vault = shared.join("Documents/tegg-la-x/shell");
    vault_at(&vault);
    let poznamky = shared.join("Documents").join(os(&nfd("Poznámky")));
    vault_at(&poznamky);
    let s = shared.to_string_lossy().into_owned();
    let p = private.to_string_lossy().into_owned();
    let before = listing(&t.0);

    let ok = |input: &str, need: bool| resolve_typed_path(input, &shared, &private, need);
    let want = Ok(vault.clone());
    assert_eq!(ok(&format!("{s}/Documents/tegg-la-x/shell"), true), want, "the full path opens");
    assert_eq!(ok(&format!("  {s}/Documents/tegg-la-x/shell/  "), true), want, "spaces around and one trailing / are removed");
    assert_eq!(ok("/sdcard/Documents/tegg-la-x/shell", true), want, "/sdcard/ is read as the shared root");
    assert_eq!(ok(" /sdcard/Documents/tegg-la-x/shell/", true), want, "/sdcard/ with a trailing / and a space");
    assert_eq!(ok("Documents/tegg-la-x/shell", true), Err(PathRefusal::FullPath), "a relative path → FullPath");
    assert_eq!(ok(&p, true), Err(PathRefusal::OutsideShared), "the app's private storage → OutsideShared (AP-2015)");
    assert_eq!(ok(&p, false), Err(PathRefusal::OutsideShared), "private storage as a New vault location → OutsideShared");
    assert_eq!(ok(&format!("{s}/../../data"), true), Err(PathRefusal::OutsideShared), "<shared>/../../data → OutsideShared (lexical ..)");
    assert_eq!(ok(&format!("{s}/Documents/tegg-la-x/chybí"), true), Err(PathRefusal::NotFound), "a missing folder → NotFound");
    assert_eq!(ok(&format!("{s}/Documents/tegg-la-x"), true), Err(PathRefusal::NotAVault), "a folder without .tegg/vault.yml → NotAVault (AP-2035)");
    assert_eq!(ok(&format!("{s}/Documents"), false), Ok(shared.join("Documents")), "need_vault false: an existing shared folder is a New vault location");

    // NFC typed, NFD on disk (and the other way round): the on-disk path.
    for typed in ["Poznámky".to_string(), nfd("Poznámky")] {
        let got = ok(&format!("{s}/Documents/{typed}"), true);
        let bytes = got.as_ref().map(|p| p.as_os_str().as_bytes().to_vec()).unwrap_or_default();
        assert_eq!(bytes, poznamky.as_os_str().as_bytes().to_vec(), "typed {:x?}: the result is the on-disk (NFD) path; got {got:?}", typed.as_bytes());
    }
    assert_eq!(listing(&t.0), before, "no typed path created or changed anything");
}

// ------------------------------------------------------------------------------------------------ RA3 (AC-19, AC-20)

fn state(s: &StartState) -> String {
    match s {
        StartState::NeedsAccess { path } => format!("needsAccess {path:?}"),
        StartState::Opening { name, path } => format!("opening {name:?} {path:?}"),
        StartState::Open { .. } => "open".into(),
        StartState::Failed { path, kind } => format!("failed {path:?} {kind:?}"),
        StartState::None => "none".into(),
    }
}

#[test]
fn fr_vlt_01_ac20_start_state_asks_for_access_first() {
    let remembered = PathBuf::from("/storage/emulated/0/Documents/tegg-la-x/shell");
    let path = remembered.to_string_lossy().into_owned();
    assert_eq!(state(&start_state(false, Some(&remembered), None)), state(&StartState::NeedsAccess { path: Some(path.clone()) }), "access off, a remembered vault: needsAccess naming it");
    assert_eq!(state(&start_state(false, None, None)), state(&StartState::NeedsAccess { path: None }), "access off, nothing remembered: needsAccess without a path");
    assert_eq!(
        state(&start_state(false, Some(&remembered), Some(Err("NotFound".into())))),
        state(&StartState::NeedsAccess { path: Some(path) }),
        "access is checked before any open result counts"
    );
}

#[test]
fn fr_vlt_01_ac19_start_state_opening_and_failed() {
    let remembered = PathBuf::from("/storage/emulated/0/Documents/tegg-la-x/shell");
    let path = remembered.to_string_lossy().into_owned();
    assert_eq!(state(&start_state(true, Some(&remembered), None)), state(&StartState::Opening { name: "shell".into(), path: path.clone() }), "access on, remembered, not opened yet: opening {{ name, path }}");
    assert_eq!(state(&start_state(true, None, None)), state(&StartState::None), "access on, nothing remembered: none");
    assert_eq!(
        state(&start_state(true, Some(&remembered), Some(Err("NotFound".into())))),
        state(&StartState::Failed { path, kind: "NotFound".into() }),
        "the remembered folder is gone: failed {{ path, kind }}"
    );
    let nfd_dir = PathBuf::from(format!("/storage/emulated/0/Documents/{}", nfd("Poznámky")));
    assert_eq!(
        state(&start_state(true, Some(&nfd_dir), None)),
        state(&StartState::Opening { name: "Poznámky".into(), path: nfd_dir.to_string_lossy().into_owned() }),
        "opening names the vault in NFC and keeps the on-disk path"
    );
}
