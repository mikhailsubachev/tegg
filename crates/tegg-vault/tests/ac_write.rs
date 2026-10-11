//! AC tests for the one write function and vault layout operations (docs/contracts/ms1-core.md §3.2):
//! FR-SYN-02 / NFR-REL-01 (AC-1, AC-2, AC-4), FR-SYN-06 (AC-2), FR-FMT-07 AC-2, FR-FMT-12 (AC-1…AC-3),
//! FR-STO-01 / -03 / -05 / -08 / -09 (AC-2, AC-3, AC-5, AC-6).
//! Written from the ACs and the contract only (D-61). Results under test are matched and asserted.

mod common;

use common::*;
use std::path::Path;
use std::time::{Duration, SystemTime};
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

fn open(sb: &Sandbox, root: &Path) -> Result<Vault, OpenError> {
    Vault::open(root, &sb.dirs)
}

const V1: &str = "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŘeka teče.\n";
const V2: &str = "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŘeka teče do moře.\n";

fn vault_with_note(sb: &Sandbox) -> std::path::PathBuf {
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    write_raw(&root, "Pages/Řeka.md", V1.as_bytes());
    write_raw(&root, "Pages/Most.md", "Most.\n".as_bytes());
    write_raw(&root, "Tasks/Úkol.md", "Úkol.\n".as_bytes());
    root
}

// ---------------------------------------------------------------- FR-SYN-02 / NFR-REL-01

#[test]
fn fr_syn_02_ac1_write_replaces_the_file_by_rename_not_in_place() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let target = root.join("Pages/Řeka.md");
    let outside_link = sb.base.join("pevný odkaz.md");
    std::fs::hard_link(&target, &outside_link).expect("hard link");
    let old_inode = inode(&target);
    let vault = ok!(open(&sb, &root), "open");
    let (bytes, version) = ok!(vault.read("Pages/Řeka.md"), "read");
    assert_eq!(bytes, V1.as_bytes());
    let outcome = ok!(vault.write("Pages/Řeka.md", V2.as_bytes(), Some(&version)), "write");
    assert!(matches!(&outcome, WriteOutcome::Written(v) if v.size == V2.len() as u64), "outcome {outcome:?}");
    assert_eq!(std::fs::read(&target).expect("read target"), V2.as_bytes());
    // An in-place write would have changed the shared inode; an atomic rename leaves the old one intact.
    assert_eq!(std::fs::read(&outside_link).expect("read link"), V1.as_bytes());
    assert_ne!(inode(&target), old_inode);
    assert_eq!(files(&root.join("Pages")), vec!["Most.md", "Řeka.md"], "no temporary file is left behind");
}

#[test]
fn fr_syn_02_ac1_new_file_is_created_atomically_with_no_base() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let outcome = ok!(vault.write("Pages/Nová.md", "Nová poznámka.\n".as_bytes(), None), "write");
    assert!(matches!(&outcome, WriteOutcome::Written(v) if v.size == "Nová poznámka.\n".len() as u64), "outcome {outcome:?}");
    assert_eq!(std::fs::read(root.join("Pages/Nová.md")).expect("read"), "Nová poznámka.\n".as_bytes());
    assert_eq!(files(&root.join("Pages")), vec!["Most.md", "Nová.md", "Řeka.md"]);
}

#[test]
fn fr_syn_02_ac1_returned_version_matches_a_fresh_read() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let (_, v1) = ok!(vault.read("Pages/Řeka.md"), "read");
    let written = ok!(vault.write("Pages/Řeka.md", V2.as_bytes(), Some(&v1)), "write");
    let (bytes, v2) = ok!(vault.read("Pages/Řeka.md"), "read again");
    assert_eq!(bytes, V2.as_bytes());
    assert_eq!(written, WriteOutcome::Written(v2.clone()));
    assert_ne!(v1.hash, v2.hash);
}

#[test]
fn fr_syn_02_ac2_temporary_file_is_dot_name_tegg_tmp_in_the_same_folder() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    // Occupy the temporary name with a non-empty directory: a write that uses `.Řeka.md.tegg-tmp` in the
    // same folder cannot proceed, and the target must stay intact.
    write_raw(&root, "Pages/.Řeka.md.tegg-tmp/blokuje", b"x");
    let vault = ok!(open(&sb, &root), "open");
    let (_, version) = ok!(vault.read("Pages/Řeka.md"), "read");
    let result = vault.write("Pages/Řeka.md", V2.as_bytes(), Some(&version));
    assert!(matches!(result, Err(VaultError::Io(_))), "expected an I/O error, got {result:?}");
    assert_eq!(std::fs::read(root.join("Pages/Řeka.md")).expect("read"), V1.as_bytes());
}

#[test]
fn fr_syn_02_ac2_temporary_files_are_not_listed_as_vault_files() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    write_raw(&root, "Pages/.Řeka.md.tegg-tmp", "napůl zapsáno".as_bytes());
    let vault = ok!(open(&sb, &root), "open");
    let mut managed = ok!(vault.managed_files(), "managed_files");
    managed.sort();
    assert_eq!(managed, vec![".tegg/vault.yml", "Pages/Most.md", "Pages/Řeka.md", "Tasks/Úkol.md"]);
}

#[test]
fn fr_syn_02_ac4_leftover_temp_files_older_than_a_minute_are_deleted() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    write_raw(&root, "Pages/.Řeka.md.tegg-tmp", "napůl".as_bytes());
    write_raw(&root, "Tasks/.Úkol.md.tegg-tmp", "napůl".as_bytes());
    write_raw(&root, ".Kořen.md.tegg-tmp", "napůl".as_bytes());
    write_raw(&root, "Pages/.uživatelský skrytý soubor", "nesahat".as_bytes());
    let vault = ok!(open(&sb, &root), "open");
    let removed = vault.clean_temp_files(SystemTime::now() + Duration::from_secs(120));
    assert!(matches!(removed, Ok(3)), "removed {removed:?}");
    assert_eq!(
        files(&root),
        vec![".tegg/vault.yml", "Pages/.uživatelský skrytý soubor", "Pages/Most.md", "Pages/Řeka.md", "Tasks/Úkol.md"]
    );
}

#[test]
fn fr_syn_02_ac4_recent_temp_files_are_kept() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    write_raw(&root, "Pages/.Řeka.md.tegg-tmp", "právě se zapisuje".as_bytes());
    let mtime = std::fs::metadata(root.join("Pages/.Řeka.md.tegg-tmp")).expect("meta").modified().expect("mtime");
    let vault = ok!(open(&sb, &root), "open");
    let removed = vault.clean_temp_files(mtime + Duration::from_secs(30));
    assert!(matches!(removed, Ok(0)), "removed {removed:?}");
    assert!(root.join("Pages/.Řeka.md.tegg-tmp").exists());
    let removed = vault.clean_temp_files(mtime + Duration::from_secs(61));
    assert!(matches!(removed, Ok(1)), "removed {removed:?}");
    assert!(!root.join("Pages/.Řeka.md.tegg-tmp").exists());
}

// ---------------------------------------------------------------- FR-SYN-06, FR-FMT-07 AC-2

#[test]
fn fr_syn_06_ac2_saving_a_note_writes_exactly_one_file() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let (_, version) = ok!(vault.read("Pages/Řeka.md"), "read");
    let before = snapshot(&root);
    let outcome = vault.write("Pages/Řeka.md", V2.as_bytes(), Some(&version));
    assert!(matches!(outcome, Ok(WriteOutcome::Written(_))), "outcome {outcome:?}");
    let after = snapshot(&root);
    let keys = |m: &std::collections::BTreeMap<String, Entry>| m.keys().cloned().collect::<Vec<_>>();
    assert_eq!(keys(&after), keys(&before), "no file added or removed");
    let changed: Vec<&String> = after.iter().filter(|(k, v)| before.get(*k) != Some(*v)).map(|(k, _)| k).collect();
    assert_eq!(changed, vec!["Pages/Řeka.md"]);
}

#[test]
fn fr_fmt_07_ac2_saving_unchanged_bytes_does_not_touch_the_file() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let (bytes, version) = ok!(vault.read("Pages/Řeka.md"), "read");
    let before = snapshot(&root);
    let outcome = vault.write("Pages/Řeka.md", &bytes, Some(&version));
    assert!(matches!(outcome, Ok(WriteOutcome::Unchanged)), "outcome {outcome:?}");
    assert_eq!(snapshot(&root), before, "mtime, inode and bytes unchanged");
}

#[test]
fn fr_fmt_07_ac2_saving_unchanged_bytes_without_a_base_does_not_touch_the_file() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let before = snapshot(&root);
    let outcome = vault.write("Pages/Řeka.md", V1.as_bytes(), None);
    assert!(matches!(outcome, Ok(WriteOutcome::Unchanged)), "outcome {outcome:?}");
    assert_eq!(snapshot(&root), before);
}

// ---------------------------------------------------------------- FR-FMT-12

#[test]
fn fr_fmt_12_ac1_nfd_file_name_is_listed_and_read_by_its_nfc_name() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    write_raw(&root, &format!("Pages/{NFD_CTENI}.md"), "Kniha o čtení.\n".as_bytes());
    assert_eq!(raw_names(&root.join("Pages")), vec![format!("{NFD_CTENI}.md").into_bytes()], "setup: NFD name on disk");
    let vault = ok!(open(&sb, &root), "open");
    let managed = ok!(vault.managed_files(), "managed_files");
    let nfc_path = format!("Pages/{NFC_CTENI}.md");
    assert!(managed.contains(&nfc_path), "{managed:?}");
    assert!(!managed.contains(&format!("Pages/{NFD_CTENI}.md")), "{managed:?}");
    let (bytes, _) = ok!(vault.read(&nfc_path), "read by NFC name");
    assert_eq!(bytes, "Kniha o čtení.\n".as_bytes());
}

#[test]
fn fr_fmt_12_ac2_file_names_written_by_the_vault_are_nfc() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    let vault = ok!(open(&sb, &root), "open");
    let (path, _) = ok!(vault.create_file("Pages", NFD_CTENI, "md", "Text.\n".as_bytes()), "create_file");
    assert_eq!(path, format!("Pages/{NFC_CTENI}.md"));
    assert_eq!(raw_names(&root.join("Pages")), vec![format!("{NFC_CTENI}.md").into_bytes()]);
}

#[test]
fn fr_fmt_12_ac3_nfc_name_next_to_an_nfd_file_is_a_name_conflict_not_an_overwrite() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    write_raw(&root, &format!("Pages/{NFD_CTENI}.md"), "Původní obsah.\n".as_bytes());
    let vault = ok!(open(&sb, &root), "open");
    let (path, _) = ok!(vault.create_file("Pages", NFC_CTENI, "md", "Nový obsah.\n".as_bytes()), "create_file");
    assert_eq!(path, format!("Pages/{NFC_CTENI} (2).md"));
    assert_eq!(std::fs::read(root.join(format!("Pages/{NFD_CTENI}.md"))).expect("read"), "Původní obsah.\n".as_bytes());
    assert_eq!(raw_names(&root.join("Pages")).len(), 2);
}

// ---------------------------------------------------------------- FR-STO-01 / -03 / -05 / -08 / -09

#[test]
fn fr_sto_01_ac2_first_object_of_a_type_creates_the_type_folder() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    let vault = ok!(open(&sb, &root), "open");
    assert!(!root.join("Books").exists(), "setup");
    let (path, version) = ok!(vault.create_file("Books", "Kniha o řece", "md", "---\ntype: book\n---\n".as_bytes()), "create_file");
    assert_eq!(path, "Books/Kniha o řece.md");
    assert_eq!(version.size, "---\ntype: book\n---\n".len() as u64);
    assert_eq!(std::fs::read(root.join("Books/Kniha o řece.md")).expect("read"), "---\ntype: book\n---\n".as_bytes());
}

#[test]
fn fr_sto_01_ac3_second_attachment_with_the_same_name_gets_a_2_suffix() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    let vault = ok!(open(&sb, &root), "open");
    let (p1, _) = ok!(vault.create_file("_attachments", "photo", "png", &[1, 1, 1]), "first");
    let (p2, _) = ok!(vault.create_file("_attachments", "photo", "png", &[2, 2, 2]), "second");
    let (p3, _) = ok!(vault.create_file("_attachments", "Photo", "png", &[3, 3, 3]), "third, other case");
    assert_eq!([p1.as_str(), p2.as_str(), p3.as_str()], ["_attachments/photo.png", "_attachments/photo (2).png", "_attachments/Photo (3).png"]);
    assert_eq!(std::fs::read(root.join("_attachments/photo.png")).expect("read"), vec![1, 1, 1]);
    assert_eq!(std::fs::read(root.join("_attachments/photo (2).png")).expect("read"), vec![2, 2, 2]);
}

#[test]
fn fr_sto_01_ac5_trash_keeps_the_relative_path_and_restore_puts_it_back() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let trashed = ok!(vault.trash("Pages/Řeka.md"), "trash");
    assert_eq!(trashed, ".trash/Pages/Řeka.md");
    assert!(!root.join("Pages/Řeka.md").exists());
    assert_eq!(std::fs::read(root.join(".trash/Pages/Řeka.md")).expect("read trashed"), V1.as_bytes());
    let restored = ok!(vault.restore(&trashed), "restore");
    assert_eq!(restored, "Pages/Řeka.md");
    assert_eq!(std::fs::read(root.join("Pages/Řeka.md")).expect("read restored"), V1.as_bytes());
    assert!(!root.join(".trash/Pages/Řeka.md").exists());
}

#[test]
fn fr_sto_01_ac5_trash_path_taken_gets_a_suffix() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    write_raw(&root, ".trash/Pages/Řeka.md", "Starší smazaná verze.\n".as_bytes());
    let vault = ok!(open(&sb, &root), "open");
    let trashed = ok!(vault.trash("Pages/Řeka.md"), "trash");
    assert_eq!(trashed, ".trash/Pages/Řeka (2).md");
    assert_eq!(std::fs::read(root.join(".trash/Pages/Řeka.md")).expect("read"), "Starší smazaná verze.\n".as_bytes());
    assert_eq!(std::fs::read(root.join(".trash/Pages/Řeka (2).md")).expect("read"), V1.as_bytes());
}

#[test]
fn fr_sto_01_ac5_restore_to_a_taken_path_gets_a_suffix() {
    let sb = sandbox();
    let root = vault_with_note(&sb);
    let vault = ok!(open(&sb, &root), "open");
    let trashed = ok!(vault.trash("Pages/Řeka.md"), "trash");
    write_raw(&root, "Pages/Řeka.md", "Nová Řeka.\n".as_bytes());
    let restored = ok!(vault.restore(&trashed), "restore");
    assert_eq!(restored, "Pages/Řeka (2).md");
    assert_eq!(std::fs::read(root.join("Pages/Řeka.md")).expect("read"), "Nová Řeka.\n".as_bytes());
    assert_eq!(std::fs::read(root.join("Pages/Řeka (2).md")).expect("read"), V1.as_bytes());
}

#[test]
fn fr_sto_01_ac6_only_markdown_attachments_and_tegg_files_are_managed() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let vault = ok!(open(&sb, &root), "open");
    let mut managed = ok!(vault.managed_files(), "managed_files");
    managed.sort();
    assert_eq!(
        managed,
        vec![
            ".tegg/types/page.yml",
            ".tegg/vault.yml",
            "Images/Mapa řeky.md",
            "Pages/Netypovaná.md",
            "Pages/Rozbitá.md",
            "Tasks/Zavolat Tomášovi.md",
            "_attachments/manuál.pdf",
            "_attachments/mapa.png",
        ]
    );
}

#[test]
fn fr_sto_01_ac6_unmanaged_files_are_never_modified_moved_or_deleted() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let unmanaged = ["Docs/zpráva.docx", "Docs/poznámky.txt", ".obsidian/app.json", ".obsidian/snippets/poznámka.md", ".git/HEAD"];
    let pick = |s: &std::collections::BTreeMap<String, Entry>| unmanaged.iter().map(|k| s.get(*k).cloned()).collect::<Vec<_>>();
    let before = pick(&snapshot(&root));
    let vault = ok!(open(&sb, &root), "open");
    let trashed = ok!(vault.trash("Pages/Netypovaná.md"), "trash");
    let restored = vault.restore(&trashed);
    assert!(restored.is_ok(), "restore: {:?}", restored.err());
    let cleaned = vault.clean_temp_files(SystemTime::now() + Duration::from_secs(3600));
    assert!(matches!(cleaned, Ok(0)), "clean: {cleaned:?}");
    let written = vault.write("Pages/Nová.md", "Nová.\n".as_bytes(), None);
    assert!(matches!(written, Ok(WriteOutcome::Written(_))), "write: {written:?}");
    drop(vault);
    assert_eq!(pick(&snapshot(&root)), before);
    assert!(before.iter().all(|e| e.is_some()), "setup: every unmanaged file exists");
}
