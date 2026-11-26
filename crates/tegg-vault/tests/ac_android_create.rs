//! Slice AND-3, L4 (Mac host, temporary folders): docs/acceptance/android-edit.md FR-SYN-02 AC-17 "A create never
//! replaces a file" (D-2047; AP-2078 → D-2513; T1), through docs/contracts/android-edit.md §3.2:
//! - `tegg_vault::name_taken(listing, name)`: true when one folder's listing holds `name` under NFC and Unicode lower
//!   case (shared storage compares names that way; a case-sensitive host doesn't, so the check is name-blind);
//! - `tegg_vault::testing::no_clobber_via(from, to, primitive)` with a primitive that fails `ENOSYS` (no hard links, as
//!   on Android's FUSE): a target that exists, one that exists in another case or normalization (`nákup.md` in NFD for
//!   `Nákup.md`) and a free one; only the free one is renamed, and every existing file keeps its bytes, inode and mtime.
//! Written from the ACs and the contract only (D-61).

use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use tegg_vault::name_taken;
use tegg_vault::testing::no_clobber_via;

struct Tmp(PathBuf);
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn tmp(tag: &str) -> Tmp {
    let p = std::env::temp_dir().join(format!("tegg-and3-{tag}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::create_dir_all(&p).expect("setup: temp dir");
    Tmp(p)
}
fn state(p: &Path) -> (Vec<u8>, u64, i64, i64) {
    let md = std::fs::symlink_metadata(p).expect("setup: stat");
    (std::fs::read(p).expect("setup: read"), md.ino(), md.mtime(), md.mtime_nsec())
}
fn enosys(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::from_raw_os_error(libc_enosys()))
}
/// ENOSYS (78 on macOS, 38 on Linux).
fn libc_enosys() -> i32 {
    if cfg!(target_os = "macos") { 78 } else { 38 }
}

#[test]
fn fr_syn_02_ac17_create_never_replaces_a_file() {
    // name_taken: NFC and Unicode lower case, one folder's listing as on disk
    let nfd_lower = "na\u{301}kup.md".to_string();
    let rows: Vec<(Vec<String>, &str, bool)> = vec![
        (vec!["Nákup.md".into()], "Nákup.md", true),
        (vec!["nákup.md".into()], "Nákup.md", true),
        (vec![nfd_lower.clone()], "Nákup.md", true),
        (vec!["NÁKUP.MD".into()], "Nákup.md", true),
        (vec!["Na\u{301}kup.md".into(), "Jiný.md".into()], "nákup.md", true),
        (vec!["Nákup (2).md".into(), "Nákupy.md".into()], "Nákup.md", false),
        (vec![], "Nákup.md", false),
        (vec!["Žluťoučký kůň.md".into()], "ŽLUŤOUČKÝ KŮŇ.md", true),
        (vec!["Zlutoucky kun.md".into()], "Žluťoučký kůň.md", false),
    ];
    let got: Vec<bool> = rows.iter().map(|(l, n, _)| name_taken(l, n)).collect();
    let want: Vec<bool> = rows.iter().map(|(_, _, w)| *w).collect();
    assert_eq!(got, want, "name_taken over {:?}", rows.iter().map(|(l, n, _)| (l.clone(), *n)).collect::<Vec<_>>());

    // no_clobber_via with ENOSYS: an existing target is refused and kept
    let t = tmp("create");
    let dir = t.0.join("Quick Notes");
    std::fs::create_dir_all(&dir).expect("setup: folder");
    let existing = dir.join("Nákup.md");
    std::fs::write(&existing, "---\nid: 01JBAN3000000000000000X001\ntitle: Nákup\n---\nZ jiného zařízení.\n").expect("setup: existing");
    let before = state(&existing);
    let tmpf = dir.join(".Nákup.md.tegg-tmp");
    std::fs::write(&tmpf, "---\ntitle: Nákup\n---\nZ telefonu.\n").expect("setup: temp file");
    let r = no_clobber_via(&tmpf, &existing, &enosys);
    assert_eq!(r.as_ref().map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists), "an existing target is refused with AlreadyExists");
    assert_eq!(state(&existing), before, "the existing file keeps its bytes, inode and mtime");

    // a target that exists in another case or normalization: refused, whatever the host's file system compares
    let other = t.0.join("Jinde");
    std::fs::create_dir_all(&other).expect("setup: folder");
    let stored = other.join(&nfd_lower);
    std::fs::write(&stored, "Uloženo v NFD a malými písmeny.\n").expect("setup: nfd file");
    let stored_before = state(&stored);
    let tmp2 = other.join(".Nákup.md.tegg-tmp");
    std::fs::write(&tmp2, "Nové.\n").expect("setup: temp file");
    let r = no_clobber_via(&tmp2, &other.join("Nákup.md"), &enosys);
    assert_eq!(r.as_ref().map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists), "a name taken in another case and normalization is refused");
    assert_eq!(state(&stored), stored_before, "the NFD file keeps its bytes, inode and mtime");
    let names: Vec<String> = std::fs::read_dir(&other).expect("list").filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.ends_with(".tegg-tmp")).collect();
    assert_eq!(names, vec![nfd_lower.clone()], "no second file appears beside it");

    // a free name: renamed
    let tmp3 = dir.join(".Nákup (2).md.tegg-tmp");
    std::fs::write(&tmp3, "Z telefonu.\n").expect("setup: temp file");
    let free = dir.join("Nákup (2).md");
    let r = no_clobber_via(&tmp3, &free, &enosys);
    assert!(r.is_ok(), "a free name is created: {r:?}");
    assert_eq!(std::fs::read_to_string(&free).ok().as_deref(), Some("Z telefonu.\n"), "the new file holds the temp file's bytes");
    assert!(!tmp3.exists(), "the temp file is gone");
    assert_eq!(state(&existing), before, "the existing file is still untouched");
}
