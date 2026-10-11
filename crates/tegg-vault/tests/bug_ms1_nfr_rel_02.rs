//! Regression tests for bug_ms1_nfr_rel_02: `Vault::write(path, bytes, None)` silently overwrote an
//! existing file with different bytes. NFR-REL-02 / FR-SYN-03 (AC-3, AC-7, docs/acceptance/data-safety.md);
//! contract docs/contracts/ms1-core.md §3.2 `write`: `base: None` + existing file with different bytes →
//! `Err(VaultError::Conflict { disk })`, the file on disk unchanged. Written from the contract only (D-61).

mod common;

use common::*;
use tegg_vault::*;

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

const A: &str = "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŘeka teče.\n";
const B: &str = "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŽluťoučký kůň úpěl.\n";

fn same_version(a: &FileVersion, b: &FileVersion) -> bool {
    a.mtime_ns == b.mtime_ns && a.size == b.size && a.hash == b.hash
}

fn assert_conflict_matching(result: Result<WriteOutcome, VaultError>, fresh: &FileVersion) {
    match result {
        Err(VaultError::Conflict { disk }) => assert!(
            same_version(&disk, fresh),
            "Conflict.disk must equal a fresh read: {:?}/{} vs {:?}/{}",
            disk.mtime_ns, disk.size, fresh.mtime_ns, fresh.size
        ),
        other => assert!(false, "expected Err(Conflict), got {other:?}"),
    }
}

#[test]
fn bug_ms1_nfr_rel_02_write_without_base_over_different_file_is_a_conflict() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    write_raw(&root, "Pages/Řeka.md", A.as_bytes());
    let target = root.join("Pages/Řeka.md");
    let ino = inode(&target);
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let result = vault.write("Pages/Řeka.md", B.as_bytes(), None);
    let (bytes, fresh) = ok!(vault.read("Pages/Řeka.md"), "read after write");
    assert_eq!(bytes, A.as_bytes(), "Vault::read must still return A");
    assert_conflict_matching(result, &fresh);
    assert_eq!(std::fs::read(&target).expect("read target"), A.as_bytes(), "file on disk must keep bytes A");
    assert_eq!(inode(&target), ino, "file must not be replaced");
    assert_eq!(files(&root.join("Pages")), vec!["Řeka.md"], "no temporary file left");
}

#[test]
fn bug_ms1_nfr_rel_02_write_without_base_over_nfd_named_file_is_a_conflict() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    let nfd_rel = format!("Pages/{NFD_CTENI}.md");
    write_raw(&root, &nfd_rel, A.as_bytes());
    let pages = root.join("Pages");
    let names_before = raw_names(&pages);
    let nfd_path = root.join(&nfd_rel);
    let ino = inode(&nfd_path);
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let nfc_rel = format!("Pages/{NFC_CTENI}.md");
    let result = vault.write(&nfc_rel, B.as_bytes(), None);
    let (bytes, fresh) = ok!(vault.read(&nfc_rel), "read after write");
    assert_eq!(bytes, A.as_bytes(), "Vault::read must still return A");
    assert_conflict_matching(result, &fresh);
    assert_eq!(raw_names(&pages), names_before, "raw (NFD) name on disk must be unchanged");
    assert_eq!(names_before, vec![format!("{NFD_CTENI}.md").into_bytes()]);
    assert_eq!(std::fs::read(&nfd_path).expect("read nfd file"), A.as_bytes());
    assert_eq!(inode(&nfd_path), ino, "file must not be replaced");
}

#[test]
fn bug_ms1_nfr_rel_02_memfs_write_without_base_over_different_file_is_a_conflict() {
    let sb = sandbox();
    let mem = MemFs::new();
    let seeded = mem.create_dir_all(".tegg").is_ok()
        && mem.replace(".tegg/vault.yml", VAULT_YML.as_bytes()).is_ok()
        && mem.create_dir_all("Pages").is_ok()
        && mem.replace("Pages/Řeka.md", A.as_bytes()).is_ok();
    assert!(seeded, "MemFs could not be seeded");
    let vault = ok!(Vault::open_with(Box::new(mem), &sb.dirs), "open_with");
    let result = vault.write("Pages/Řeka.md", B.as_bytes(), None);
    let (bytes, fresh) = ok!(vault.read("Pages/Řeka.md"), "read after write");
    assert_eq!(bytes, A.as_bytes(), "MemFs file must keep bytes A");
    assert_conflict_matching(result, &fresh);
}
