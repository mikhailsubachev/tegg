//! AC tests for creating and opening vaults (docs/contracts/ms1-core.md §3.2): FR-VLT-01, FR-VLT-02 (empty
//! vault), FR-STO-01 AC-1/AC-4 (FR-STO-06), FR-STO-07 AC-1, FR-SYN-06 AC-1, FR-TYP-10 AC-2, NFR-REL-03 AC-2.
//! Written from the ACs and the contract only (D-61). Results under test are matched and asserted.

mod common;

use common::*;
use std::path::{Path, PathBuf};
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

const EMPTY_VAULT_FILES: [&str; 8] = [
    ".tegg/types/daily-note.yml",
    ".tegg/types/image.yml",
    ".tegg/types/page.yml",
    ".tegg/types/pdf.yml",
    ".tegg/types/quick-note.yml",
    ".tegg/types/tag.yml",
    ".tegg/types/task.yml",
    ".tegg/vault.yml",
];

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn parent_in(sb: &Sandbox, rel: &str) -> PathBuf {
    let p = sb.base.join(rel);
    std::fs::create_dir_all(&p).expect("parent dir");
    p
}

// ---------------------------------------------------------------- FR-VLT-01

#[test]
fn fr_vlt_01_ac2_create_makes_the_vault_folder_with_vault_yml_and_type_definitions_only() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let vault = ok!(Vault::create(&parent, "Moje poznámky", VaultKind::Empty, &sb.dirs), "create");
    let root = parent.join("Moje poznámky");
    assert!(same_path(vault.root(), &root), "root is {:?}", vault.root());
    assert_eq!(files(&root), EMPTY_VAULT_FILES.to_vec());
    assert_eq!(dirs_of(&root), vec![".tegg", ".tegg/types"]);
    assert_eq!(files(&parent).len(), EMPTY_VAULT_FILES.len(), "nothing else written next to the vault");
}

#[test]
fn fr_vlt_01_ac2_vault_name_is_sanitized_like_a_file_name() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let a = ok!(Vault::create(&parent, "Q3: plán/rozpočet", VaultKind::Empty, &sb.dirs), "create Q3");
    assert!(same_path(a.root(), &parent.join("Q3 plán rozpočet")), "root is {:?}", a.root());
    let b = ok!(Vault::create(&parent, "CON", VaultKind::Empty, &sb.dirs), "create CON");
    assert!(same_path(b.root(), &parent.join("CON_")), "root is {:?}", b.root());
    let mut names: Vec<String> =
        std::fs::read_dir(&parent).expect("read parent").map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    assert_eq!(names, vec!["CON_", "Q3 plán rozpočet"]);
}

#[test]
fn fr_vlt_01_ac2_created_vault_is_open_and_reopens() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let vault = ok!(Vault::create(&parent, "Řeka", VaultKind::Empty, &sb.dirs), "create");
    let (bytes, _) = ok!(vault.read(".tegg/vault.yml"), "read vault.yml");
    assert_eq!(top_level_scalars(&String::from_utf8_lossy(&bytes)).get("default-type").map(String::as_str), Some("Quick Note"));
    let again = ok!(Vault::open(&parent.join("Řeka"), &sb.dirs), "reopen");
    assert!(same_path(again.root(), &parent.join("Řeka")));
}

#[test]
fn fr_vlt_01_ac3_create_in_an_existing_non_empty_folder_is_refused_and_touches_nothing() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let target = parent.join("Existující");
    write_raw(&target, "poznámka.md", "Moje poznámka o řece.\n".as_bytes());
    write_raw(&target, ".obsidian/app.json", b"{}\n");
    let before = snapshot(&target);
    let result = Vault::create(&parent, "Existující", VaultKind::Empty, &sb.dirs);
    assert!(matches!(result, Err(CreateError::NotEmpty)), "expected NotEmpty, got {:?}", result.as_ref().err());
    assert_eq!(snapshot(&target), before);
}

#[test]
fn fr_vlt_01_ac4_opening_a_tegg_vault_writes_nothing() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let before = snapshot(&root);
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    assert!(same_path(vault.root(), &root));
    drop(vault);
    assert_eq!(snapshot(&root), before);
}

#[test]
fn fr_vlt_01_ac5_plain_markdown_folder_is_not_a_tegg_vault_and_is_untouched() {
    let sb = sandbox();
    let root = sb.base.join("Poznámky");
    write_raw(&root, "Řeka.md", "# Řeka\n\nText.\n".as_bytes());
    write_raw(&root, "Podsložka/Most.md", "Most přes řeku.\n".as_bytes());
    let before = snapshot(&root);
    let result = Vault::open(&root, &sb.dirs);
    assert!(matches!(result, Err(OpenError::NotATeggVault)), "expected NotATeggVault, got {:?}", result.as_ref().err());
    assert_eq!(snapshot(&root), before);
}

#[test]
fn fr_vlt_01_ac5_obsidian_vault_is_not_a_tegg_vault_and_is_untouched() {
    let sb = sandbox();
    let root = sb.base.join("Obsidian trezor");
    write_raw(&root, ".obsidian/app.json", b"{\"legacyEditor\":false}\n");
    write_raw(&root, "Denní/2026-10-09.md", "Dnešní záznam.\n".as_bytes());
    let before = snapshot(&root);
    let result = Vault::open(&root, &sb.dirs);
    assert!(matches!(result, Err(OpenError::NotATeggVault)), "expected NotATeggVault, got {:?}", result.as_ref().err());
    assert_eq!(snapshot(&root), before);
}

#[test]
fn fr_vlt_01_ac5_missing_folder_is_reported_and_not_created() {
    let sb = sandbox();
    let root = sb.base.join("Neexistuje");
    let result = Vault::open(&root, &sb.dirs);
    assert!(matches!(result, Err(OpenError::Missing)), "expected Missing, got {:?}", result.as_ref().err());
    assert!(!root.exists(), "the folder must not be created");
}

#[test]
fn fr_vlt_01_ac6_vaults_in_sync_provider_folders_are_created_and_opened_like_any_other() {
    let sb = sandbox();
    let parents = [
        "Library/CloudStorage/GoogleDrive-jana@example.com/My Drive",
        "Library/Mobile Documents/com~apple~CloudDocs",
        "Library/CloudStorage/Dropbox",
        "Dokumenty",
    ];
    let mut seen = Vec::new();
    for rel in parents {
        let parent = parent_in(&sb, rel);
        let created = Vault::create(&parent, "Trezor", VaultKind::Empty, &sb.dirs).is_ok();
        let listed = files(&parent.join("Trezor"));
        let opened = Vault::open(&parent.join("Trezor"), &sb.dirs).is_ok();
        seen.push((rel, created, listed, opened));
    }
    let want: Vec<_> =
        parents.iter().map(|rel| (*rel, true, EMPTY_VAULT_FILES.iter().map(|s| s.to_string()).collect::<Vec<_>>(), true)).collect();
    assert_eq!(seen, want);
}

#[test]
fn fr_vlt_01_ac7_opened_vault_is_remembered_in_app_support() {
    let sb = sandbox();
    let a = sb.base.join("Trezor A");
    let b = sb.base.join("Trezor B");
    manual_vault(&a);
    manual_vault(&b);
    let _va = ok!(Vault::open(&a, &sb.dirs), "open A");
    let remembered = Vault::last_opened(&sb.dirs);
    assert!(matches!(&remembered, Some((p, true)) if same_path(p, &a)), "remembered {remembered:?}");
    assert!(!files(&sb.dirs.root).is_empty(), "the remembered path is stored under Application Support");
    let _vb = ok!(Vault::open(&b, &sb.dirs), "open B");
    let remembered = Vault::last_opened(&sb.dirs);
    assert!(matches!(&remembered, Some((p, true)) if same_path(p, &b)), "remembered {remembered:?}");
}

#[test]
fn fr_vlt_01_ac7_created_vault_is_remembered() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let _v = ok!(Vault::create(&parent, "Nový trezor", VaultKind::Empty, &sb.dirs), "create");
    let remembered = Vault::last_opened(&sb.dirs);
    assert!(matches!(&remembered, Some((p, true)) if same_path(p, &parent.join("Nový trezor"))), "remembered {remembered:?}");
}

#[test]
fn fr_vlt_01_ac7_missing_remembered_vault_is_not_reopened_or_recreated() {
    let sb = sandbox();
    let root = sb.base.join("Přesunutý trezor");
    manual_vault(&root);
    let opened = Vault::open(&root, &sb.dirs).is_ok();
    assert!(opened, "open");
    let remembered_before = Vault::last_opened(&sb.dirs);
    assert!(matches!(&remembered_before, Some((p, true)) if same_path(p, &root)), "remembered {remembered_before:?}");
    let old_path = root.canonicalize().expect("canonical vault path");
    std::fs::remove_dir_all(&root).expect("remove vault");
    let remembered_after = Vault::last_opened(&sb.dirs);
    assert!(
        matches!(&remembered_after, Some((p, false)) if p == &root || p == &old_path),
        "the old path is returned as missing, got {remembered_after:?}"
    );
    assert!(!root.exists(), "the vault must not be recreated");
}

// ---------------------------------------------------------------- FR-VLT-02 (empty vault)

#[test]
fn fr_vlt_02_ac1_system_types_are_the_seven_brd_types() {
    assert_eq!(SYSTEM_TYPES.to_vec(), vec!["Page", "Task", "Quick Note", "Daily Note", "Tag", "Image", "PDF"]);
}

#[test]
fn fr_vlt_02_ac1_empty_vault_has_one_definition_per_system_type() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let created = Vault::create(&parent, "Prázdný", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let root = parent.join("Prázdný");
    let want = [
        ("daily-note.yml", "Daily Note", "Daily"),
        ("image.yml", "Image", "Images"),
        ("page.yml", "Page", "Pages"),
        ("pdf.yml", "PDF", "PDFs"),
        ("quick-note.yml", "Quick Note", "Quick Notes"),
        ("tag.yml", "Tag", "Tags"),
        ("task.yml", "Task", "Tasks"),
    ];
    let mut got = Vec::new();
    for (file, _, _) in want {
        let text = std::fs::read_to_string(root.join(".tegg/types").join(file)).unwrap_or_default();
        let kv = top_level_scalars(&text);
        let has = |k: &str| kv.contains_key(k);
        got.push((
            file,
            kv.get("name").cloned().unwrap_or_default(),
            kv.get("folder").cloned().unwrap_or_default(),
            kv.get("system").cloned().unwrap_or_default(),
            has("plural") && has("version") && has("attributes"),
        ));
    }
    let want: Vec<_> = want.iter().map(|(f, n, d)| (*f, n.to_string(), d.to_string(), "true".to_string(), true)).collect();
    assert_eq!(got, want);
}

#[test]
fn fr_vlt_02_ac1_empty_vault_has_no_notes_templates_or_type_folders() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let created = Vault::create(&parent, "Prázdný", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let root = parent.join("Prázdný");
    let top: Vec<String> = dirs_of(&root).into_iter().filter(|d| !d.contains('/')).collect();
    assert_eq!(top, vec![".tegg"]);
    assert!(files(&root).iter().all(|f| f.starts_with(".tegg/")), "{:?}", files(&root));
}

#[test]
fn fr_vlt_02_ac3_new_empty_vaults_are_deterministic_apart_from_ids_and_timestamps() {
    let sb = sandbox();
    let p1 = parent_in(&sb, "Jeden");
    let p2 = parent_in(&sb, "Dva");
    let c1 = Vault::create(&p1, "Trezor", VaultKind::Empty, &sb.dirs).is_ok();
    let c2 = Vault::create(&p2, "Trezor", VaultKind::Empty, &AppDirs { root: sb.base.join("Jiná podpora") }).is_ok();
    assert!(c1 && c2, "create both");
    let read_all = |root: &Path| -> Vec<(String, String)> {
        files(root).into_iter().map(|f| (f.clone(), mask_generated(&std::fs::read_to_string(root.join(&f)).unwrap_or_default()))).collect()
    };
    let a = read_all(&p1.join("Trezor"));
    let b = read_all(&p2.join("Trezor"));
    assert_eq!(a.len(), EMPTY_VAULT_FILES.len());
    assert_eq!(a, b);
}

#[test]
fn fr_vlt_02_ac3_new_vault_files_are_lf_utf8_without_bom() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let created = Vault::create(&parent, "Trezor", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let root = parent.join("Trezor");
    let listed = files(&root);
    assert_eq!(listed.len(), EMPTY_VAULT_FILES.len());
    let bad: Vec<String> = listed
        .into_iter()
        .filter(|f| {
            let b = std::fs::read(root.join(f)).unwrap_or_default();
            b.is_empty() || b.starts_with(&[0xEF, 0xBB, 0xBF]) || b.contains(&b'\r') || std::str::from_utf8(&b).is_err() || !b.ends_with(b"\n")
        })
        .collect();
    assert_eq!(bad, Vec::<String>::new());
}

#[test]
fn fr_vlt_02_ac3_new_empty_vault_matches_the_committed_fixture() {
    let fixture = repo_root().join("tests/fixtures/vaults/new-empty");
    assert!(fixture.is_dir(), "fixture {fixture:?} must be committed (FR-VLT-02 AC-3)");
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let created = Vault::create(&parent, "new-empty", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let root = parent.join("new-empty");
    let read_all = |r: &Path| -> Vec<(String, String)> {
        files(r).into_iter().map(|f| (f.clone(), mask_generated(&std::fs::read_to_string(r.join(&f)).unwrap_or_default()))).collect()
    };
    assert_eq!(read_all(&root), read_all(&fixture));
}

// ---------------------------------------------------------------- FR-STO-01 / FR-STO-06 / FR-STO-07

#[test]
fn fr_sto_01_ac1_vault_operations_write_only_inside_the_vault_and_app_support() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    write_raw(&sb.base, "Sousední/cizí.md", "Cizí soubor.\n".as_bytes());
    write_raw(&parent, "vedle trezoru.txt", b"x\n");
    let root = parent.join("Trezor");
    let skip = [root.as_path(), sb.dirs.root.as_path()];
    let before = snapshot_skipping(&sb.base, &skip);
    let vault = ok!(Vault::create(&parent, "Trezor", VaultKind::Empty, &sb.dirs), "create");
    let note = vault.create_file("Pages", "Řeka", "md", "Řeka.\n".as_bytes());
    assert!(matches!(&note, Ok((p, _)) if p == "Pages/Řeka.md"), "create note: {:?}", note.as_ref().err());
    let (_, base) = ok!(vault.read("Pages/Řeka.md"), "read");
    let written = vault.write("Pages/Řeka.md", "Řeka teče.\n".as_bytes(), Some(&base));
    assert!(matches!(written, Ok(WriteOutcome::Written(_))), "write: {written:?}");
    let created = vault.create_file("_attachments", "foto", "png", &[1, 2, 3]);
    assert!(created.is_ok(), "create_file: {:?}", created.err());
    let trashed = ok!(vault.trash("Pages/Řeka.md"), "trash");
    let restored = vault.restore(&trashed);
    assert!(restored.is_ok(), "restore: {:?}", restored.err());
    drop(vault);
    let reopened = Vault::open(&root, &sb.dirs).is_ok();
    assert!(reopened, "reopen");
    // Everything outside the vault folder and Application Support is unchanged (bytes, mtime, inode).
    assert_eq!(snapshot_skipping(&sb.base, &skip), before);
}

#[test]
fn fr_sto_01_ac4_vault_settings_are_human_readable_yaml() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Dokumenty");
    let created = Vault::create(&parent, "Trezor", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    let text = std::fs::read_to_string(parent.join("Trezor/.tegg/vault.yml")).unwrap_or_default();
    let kv = top_level_scalars(&text);
    let got = (
        kv.contains_key("version"),
        kv.get("default-type").cloned(),
        kv.get("attachments").cloned(),
        kv.get("daily-format").cloned(),
    );
    assert_eq!(got, (true, Some("Quick Note".into()), Some("_attachments".into()), Some("YYYY-MM-DD".into())));
}

#[test]
fn fr_sto_01_ac4_copied_vault_opens_on_another_mac_from_its_files_alone() {
    let sb = sandbox();
    let parent = parent_in(&sb, "Mac A");
    let created = Vault::create(&parent, "Trezor", VaultKind::Empty, &sb.dirs).is_ok();
    assert!(created, "create");
    write_raw(&parent.join("Trezor"), "Pages/Řeka.md", "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŘeka.\n".as_bytes());
    let copy = sb.base.join("Mac B/Trezor");
    copy_tree(&parent.join("Trezor"), &copy);
    let before = snapshot(&copy);
    let other_mac = AppDirs { root: sb.base.join("Mac B Application Support/Tegg") };
    let vault = ok!(Vault::open(&copy, &other_mac), "open the copy");
    let (bytes, _) = ok!(vault.read("Pages/Řeka.md"), "read");
    assert_eq!(bytes, "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: page\n---\nŘeka.\n".as_bytes());
    assert_eq!(files(&copy), files(&parent.join("Trezor")));
    drop(vault);
    assert_eq!(snapshot(&copy), before);
}

#[test]
fn fr_sto_07_ac1_machine_local_dir_is_under_app_support_and_outside_the_vault() {
    let sb = sandbox();
    let a = sb.base.join("Trezor A");
    let b = sb.base.join("Trezor B");
    manual_vault(&a);
    manual_vault(&b);
    let va = ok!(Vault::open(&a, &sb.dirs), "open A");
    let vb = ok!(Vault::open(&b, &sb.dirs), "open B");
    let la = va.local_dir();
    let lb = vb.local_dir();
    let vaults = sb.dirs.root.join("vaults");
    assert_eq!(la.parent(), Some(vaults.as_path()), "local dir {la:?}");
    assert_eq!(lb.parent(), Some(vaults.as_path()), "local dir {lb:?}");
    assert_ne!(la, lb);
    assert!(!la.starts_with(&a) && !lb.starts_with(&b));
    let va2 = ok!(Vault::open(&a, &sb.dirs), "reopen A");
    assert_eq!(va2.local_dir(), la, "the vault key is stable");
}

#[test]
fn fr_sto_07_ac1_opening_and_using_a_vault_puts_nothing_machine_local_into_it() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let written = vault.write("Pages/Nová.md", "Nová poznámka.\n".as_bytes(), None);
    assert!(matches!(written, Ok(WriteOutcome::Written(_))), "write: {written:?}");
    drop(vault);
    // Only the note itself is new in the vault: no index, cache, window state or recent list.
    let expected = sandbox();
    let expected_root = expected.base.join("Trezor");
    rich_vault(&expected_root);
    write_raw(&expected_root, "Pages/Nová.md", "Nová poznámka.\n".as_bytes());
    assert_eq!(files(&root), files(&expected_root));
    assert_eq!(dirs_of(&root), dirs_of(&expected_root));
}

// ---------------------------------------------------------------- FR-SYN-06 AC-1, FR-TYP-10 AC-2, NFR-REL-03 AC-2

#[test]
fn fr_syn_06_ac1_opening_reading_and_listing_the_vault_writes_nothing() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let before = snapshot(&root);
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let managed = ok!(vault.managed_files(), "managed_files");
    assert!(managed.iter().any(|p| p == "Tasks/Zavolat Tomášovi.md"), "{managed:?}");
    for p in &managed {
        let r = vault.read(p);
        assert!(r.is_ok(), "read {p}: {:?}", r.err());
    }
    drop(vault);
    assert_eq!(snapshot(&root), before);
}

#[test]
fn fr_typ_10_ac2_untyped_file_is_never_written_by_open_and_read() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let path = root.join("Pages/Netypovaná.md");
    let before = snapshot(&root).get("Pages/Netypovaná.md").cloned();
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let (bytes, _) = ok!(vault.read("Pages/Netypovaná.md"), "read");
    assert_eq!(bytes, std::fs::read(&path).expect("raw read"));
    drop(vault);
    assert_eq!(snapshot(&root).get("Pages/Netypovaná.md").cloned(), before);
}

#[test]
fn nfr_rel_03_ac2_file_with_invalid_frontmatter_is_never_rewritten_automatically() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    rich_vault(&root);
    let before = snapshot(&root).get("Pages/Rozbitá.md").cloned();
    let vault = ok!(Vault::open(&root, &sb.dirs), "open");
    let managed = ok!(vault.managed_files(), "managed_files");
    assert!(managed.iter().any(|p| p == "Pages/Rozbitá.md"), "{managed:?}");
    let (bytes, _) = ok!(vault.read("Pages/Rozbitá.md"), "read");
    assert_eq!(bytes, "---\nstav: nový\nstav: hotový\n---\nTělo.\n".as_bytes());
    let cleaned = vault.clean_temp_files(std::time::SystemTime::now());
    assert!(matches!(cleaned, Ok(0)), "clean_temp_files: {cleaned:?}");
    drop(vault);
    assert_eq!(snapshot(&root).get("Pages/Rozbitá.md").cloned(), before);
}
