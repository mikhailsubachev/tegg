//! Slice AND-1, Mac host: docs/acceptance/android-shell.md
//! - FR-FMT-12 AC-17, L1 part: `tegg_vault::on_disk_name(listing, nfc_name)` (docs/contracts/android-shell.md §3.2,
//!   D-2029) returns the listed entry whose NFC form equals the name, `Missing` when none does and `Ambiguous` when two
//!   do;
//! - FR-VLT-01 AC-27, L4 part: the recent-vaults list keeps the on-disk path of a vault folder stored in NFD bytes, with
//!   the NFC name, and opening it again from the list adds no second entry (AC-17: paths compared after NFC).
//!
//! Written from the ACs and the contract only (D-61). Temporary folders only.

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use tegg_vault::{on_disk_name, AppDirs, OnDiskName, Vault};

/// "Poznámka" / "Poznámky" with `á` decomposed (a + U+0301).
fn nfd(s: &str) -> String {
    s.replace('á', "a\u{301}").replace('Ú', "U\u{301}").replace('í', "i\u{301}")
}

fn describe(r: &OnDiskName) -> String {
    match r {
        OnDiskName::Found(s) => format!("Found({:?} bytes {:x?})", s, s.as_bytes()),
        OnDiskName::Missing => "Missing".into(),
        OnDiskName::Ambiguous => "Ambiguous".into(),
    }
}

#[test]
fn fr_fmt_12_ac17_nfd_names_on_android() {
    let nfc_name = "Poznámka.md";
    let nfd_name = nfd(nfc_name);
    assert_ne!(nfc_name.as_bytes(), nfd_name.as_bytes(), "setup: the two spellings differ in bytes");

    // The NFD entry is found for the NFC name, and its listed bytes are returned.
    let listing = vec!["Úvodní stránka.md".to_string(), nfd_name.clone(), "Zavolat Evě.md".to_string()];
    let got = on_disk_name(&listing, nfc_name);
    assert!(matches!(&got, OnDiskName::Found(s) if s.as_bytes() == nfd_name.as_bytes()), "NFD entry for the NFC name: got {}", describe(&got));

    // An NFC entry is found as it is.
    let listing = vec![nfc_name.to_string(), "Druhý nápad.md".to_string()];
    let got = on_disk_name(&listing, nfc_name);
    assert!(matches!(&got, OnDiskName::Found(s) if s.as_bytes() == nfc_name.as_bytes()), "NFC entry: got {}", describe(&got));

    // An entry whose name is NFD on disk and in another component (a folder) is found the same way.
    let listing = vec![nfd("Úvodní"), "Pages".to_string()];
    let got = on_disk_name(&listing, "Úvodní");
    assert!(matches!(&got, OnDiskName::Found(s) if s.as_bytes() == nfd("Úvodní").as_bytes()), "NFD folder name: got {}", describe(&got));

    // Nothing with that NFC form: Missing. Case is not folded (only the normalisation is).
    let listing = vec!["Poznamka.md".to_string(), "poznámka.md".to_string()];
    let got = on_disk_name(&listing, nfc_name);
    assert!(matches!(got, OnDiskName::Missing), "no entry with that NFC form → Missing: got {}", describe(&got));
    let got = on_disk_name(&[], nfc_name);
    assert!(matches!(got, OnDiskName::Missing), "empty listing → Missing: got {}", describe(&got));

    // Both spellings in one folder: a name conflict, neither is chosen (AP-2029).
    let listing = vec![nfc_name.to_string(), nfd_name.clone()];
    let got = on_disk_name(&listing, nfc_name);
    assert!(matches!(got, OnDiskName::Ambiguous), "NFC and NFD entries of one name → Ambiguous: got {}", describe(&got));
    let listing = vec![nfd_name.clone(), "Jiná.md".to_string(), nfc_name.to_string()];
    let got = on_disk_name(&listing, nfc_name);
    assert!(matches!(got, OnDiskName::Ambiguous), "in any order → Ambiguous: got {}", describe(&got));
}

struct Tmp(PathBuf);
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn tmp(tag: &str) -> Tmp {
    let p = std::env::temp_dir().join(format!("tegg-and1-{tag}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::create_dir_all(&p).expect("setup: temp dir");
    Tmp(p.canonicalize().expect("setup: canonical temp dir"))
}

/// A minimal Tegg vault at `root` (the `new-empty` fixture's `.tegg/`).
fn make_vault(root: &Path) {
    let fx = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/new-empty/.tegg");
    fn copy(from: &Path, to: &Path) {
        std::fs::create_dir_all(to).expect("setup: mkdir");
        for e in std::fs::read_dir(from).expect("setup: read fixture") {
            let e = e.expect("setup: entry");
            let t = to.join(e.file_name());
            if e.file_type().expect("setup: type").is_dir() {
                copy(&e.path(), &t);
            } else {
                std::fs::copy(e.path(), &t).expect("setup: copy");
            }
        }
    }
    copy(&fx, &root.join(".tegg"));
}

#[test]
fn fr_vlt_01_ac27_recent_vaults_keep_disk_path() {
    let t = tmp("recent");
    let app = t.0.join("files");
    std::fs::create_dir_all(&app).expect("setup: app dir");
    let dirs = AppDirs { root: app };
    let docs = t.0.join("Documents");
    let nfd_name = nfd("Poznámky");
    let disk = docs.join(OsStr::from_bytes(nfd_name.as_bytes()));
    make_vault(&disk);
    // The listing holds the NFD bytes (APFS keeps the spelling it was given).
    let listed: Vec<Vec<u8>> = std::fs::read_dir(&docs).expect("setup: list").map(|e| e.expect("entry").file_name().as_bytes().to_vec()).collect();
    assert_eq!(listed, vec![nfd_name.as_bytes().to_vec()], "setup: the folder is stored in NFD bytes");

    let v = Vault::open(&disk, &dirs);
    assert!(v.is_ok(), "the NFD-named vault opens: {:?}", v.err());
    drop(v);
    let recent = Vault::recent(&dirs);
    assert_eq!(recent.len(), 1, "one entry after the first open: {recent:?}");
    assert_eq!(recent[0].name, "Poznámky", "the name is NFC");
    assert_eq!(recent[0].name.as_bytes(), "Poznámky".as_bytes(), "the name's bytes are NFC");
    assert!(recent[0].exists, "exists: true");
    assert_eq!(
        recent[0].path.as_os_str().as_bytes(),
        disk.as_os_str().as_bytes(),
        "the stored path is the on-disk one (NFD bytes), so it reopens where names aren't normalised (T2)"
    );

    // Opening it again from the list doesn't add a second entry.
    let again = recent[0].path.clone();
    let v = Vault::open(&again, &dirs);
    assert!(v.is_ok(), "reopening from the list works: {:?}", v.err());
    drop(v);
    let recent = Vault::recent(&dirs);
    assert_eq!(recent.len(), 1, "reopening from the list adds no entry: {recent:?}");
    assert_eq!(recent[0].path.as_os_str().as_bytes(), disk.as_os_str().as_bytes(), "still the on-disk path");

    // Typed in NFC (APFS finds the same folder): still one entry, compared after NFC (AC-17).
    let typed = docs.join("Poznámky");
    let v = Vault::open(&typed, &dirs);
    assert!(v.is_ok(), "the NFC spelling opens the same folder on APFS: {:?}", v.err());
    drop(v);
    assert_eq!(Vault::recent(&dirs).len(), 1, "one entry for both spellings");
}

/// Slice AND-3, L4 (Mac host): docs/acceptance/android-edit.md FR-FMT-12 AC-18 "A note stored under an NFD name stays
/// read-only on the phone" (D-2048; AP-2077 → D-2512; T1), the refusal on the host (docs/contracts/android-edit.md §3.1):
/// through a `LocalFs` that resolves names as on Android (`tegg_vault::testing::resolving_fs`, red-test decision D-2546),
/// a write, a rename (the trash's move) and a removal of a note stored under an NFD name fail with `PermissionDenied`
/// and change nothing (bytes, name bytes, inode, mtime), a read goes through, and `on_disk_name` reports the stored bytes
/// that differ from the NFC form (the core's `nfdName`). `.tegg/pinned.yml` (an ASCII path) is still written.
#[test]
fn fr_fmt_12_ac18_nfd_named_note_read_only_on_the_phone() {
    use std::os::unix::fs::MetadataExt;
    use tegg_vault::testing::resolving_fs;
    use tegg_vault::VaultFs;

    let t = tmp("nfd-ro");
    let root = t.0.join("Trezor");
    std::fs::create_dir_all(root.join("Pages")).expect("setup: Pages");
    std::fs::create_dir_all(root.join(".tegg")).expect("setup: .tegg");
    let nfd_name = nfd("Poznámka.md");
    let stored = root.join("Pages").join(OsStr::from_bytes(nfd_name.as_bytes()));
    let text = "---\nid: 01JA0S0000000000000000AND1\ntype: page\ntitle: Poznámka\n---\n- [ ] Úkol v poznámce\n";
    std::fs::write(&stored, text).expect("setup: the NFD-named note");
    std::fs::write(root.join(".tegg/pinned.yml"), "version: 1\npinned: []\n").expect("setup: pinned.yml");
    let snap = || {
        let md = std::fs::symlink_metadata(&stored).expect("stat");
        let names: Vec<Vec<u8>> = std::fs::read_dir(root.join("Pages")).expect("list").filter_map(|e| e.ok()).map(|e| e.file_name().as_bytes().to_vec()).collect();
        (std::fs::read(&stored).expect("read"), names, md.ino(), md.mtime(), md.mtime_nsec())
    };
    let before = snap();

    // the field: the listing holds other bytes than the NFC name
    let listing: Vec<String> = std::fs::read_dir(root.join("Pages")).expect("list").filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    let got = on_disk_name(&listing, "Poznámka.md");
    assert!(matches!(&got, OnDiskName::Found(s) if s.as_bytes() != "Poznámka.md".as_bytes()), "on_disk_name finds the stored NFD bytes (nfdName): {}", describe(&got));

    let fs = resolving_fs(&root);
    let read = fs.read("Pages/Poznámka.md");
    assert!(read.is_ok(), "a read goes through: {:?}", read.err());
    let w = fs.replace("Pages/Poznámka.md", b"---\ntitle: Poznamka\n---\nPrepsano.\n");
    assert_eq!(w.as_ref().map(|_| ()).map_err(|e| e.kind()), Err(std::io::ErrorKind::PermissionDenied), "a write to the NFD-named note is refused");
    let mv = fs.rename_no_replace("Pages/Poznámka.md", ".trash/Pages/Poznámka.md");
    assert_eq!(mv.as_ref().map_err(|e| e.kind()), Err(std::io::ErrorKind::PermissionDenied), "a move to the trash is refused");
    let rm = fs.remove_file("Pages/Poznámka.md");
    assert_eq!(rm.as_ref().map_err(|e| e.kind()), Err(std::io::ErrorKind::PermissionDenied), "a removal is refused");
    assert_eq!(snap(), before, "its bytes, name bytes, inode and mtime are unchanged");
    let pin = fs.replace(".tegg/pinned.yml", b"version: 1\npinned:\n  - id: 01JA0S0000000000000000AND1\n");
    assert!(pin.is_ok(), "Pin still writes .tegg/pinned.yml: {:?}", pin.err());
}
