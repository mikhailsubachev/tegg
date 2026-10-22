//! MS6 slice 6A AC tests at the core (L4): the trash (docs/acceptance/trash-media.md FR-HIS-01 AC-1 one rename with
//! bytes, mtime and inode kept; AC-2 never trash a changed file; AC-4 the list R70/R71 from the file system; AC-5
//! restore, ` (2)`, folder rows, recreated folders; AC-6 a trashed note is read-only at the core; AC-7 delete
//! permanently through the system trash; AC-8 empty trash and its failures; AC-10 nothing only in the index; AC-14 a
//! pair goes together, the second rename failing undoes the first, a note never takes its media; AC-15 a shared file
//! stays; FR-SYN-06 AC-30 each action writes only its files). Interface docs/contracts/ms6-trash-media.md §1
//! (`Core::trash_list`, `pair_of`, `trash_object`, `trash_restore`, `trash_delete`, `trash_empty`; `Vault::restore_dir`,
//! `remove_to`; `SystemTrash`; `Fs::changed_ns`), §1.5. Written from the ACs and the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/trash-media + new-empty/.tegg in a temporary directory, R71's trash times re-touched
//! (trash6a_setup). The system trash is a recording implementation (§1.1: L4 never touches the user's Trash).

mod common;
mod trash6a_setup;

use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreError, Moved, TrashKind, VaultError, VaultFs};
use tegg_format::nfc;
use tegg_vault::{FileVersion, FsEntry, LocalFs};
use trash6a_setup::*;

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

fn mv(from: &str, to: &str) -> Moved {
    Moved { from: from.to_string(), to: to.to_string() }
}

// ------------------------------------------------------------------------------------------------ AC-1

#[test]
fn fr_his_01_ac1_object_trash_is_one_rename_bytes_mtime_inode_kept() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let id = ident(&root, UKOL);
    let base = version(&core, UKOL);
    let moved = ok!(core.trash_object(UKOL, &base), "trash_object");
    assert_eq!(moved, vec![mv(UKOL, ".trash/Tasks/Koupit semínka.md")], "one rename, the relative path kept (FR-STO-08)");
    assert_eq!(ident(&root, ".trash/Tasks/Koupit semínka.md"), id, "the same file: inode and mtime untouched");
    assert_eq!(read(&root, ".trash/Tasks/Koupit semínka.md"), Some(fixture(UKOL)), "bytes untouched");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, strs(&[".trash/Tasks/Koupit semínka.md", UKOL]), "nothing else written");
    assert!(core.object(UKOL).is_none(), "no longer indexed");
}

#[test]
fn fr_his_01_ac1_trash_object_refuses_trash_and_tegg_paths() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let v = version(&core, T5);
    assert!(matches!(core.trash_object(T5, &v), Err(CoreError::Invalid { .. })), "a path under .trash/ is Invalid");
    let t = version(&core, ".tegg/vault.yml");
    assert!(matches!(core.trash_object(".tegg/vault.yml", &t), Err(CoreError::Invalid { .. })), "a path under .tegg/ is Invalid");
    let tpl = version(&core, SABLONA);
    let moved = ok!(core.trash_object(SABLONA, &tpl), "a template can be trashed");
    assert_eq!(moved, vec![mv(SABLONA, ".trash/_templates/Page/Page.md")], "templates can be trashed (§1.4)");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, strs(&[".trash/_templates/Page/Page.md", SABLONA]), "only the template moved");
}

// ------------------------------------------------------------------------------------------------ AC-2

#[test]
fn fr_his_01_ac2_a_changed_file_is_never_trashed() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let base = version(&core, UKOL);
    write_raw(&root, UKOL, text(&root, UKOL).replace("Mrkev a ředkvičky.", "Mrkev, ředkvičky a hrách.").as_bytes());
    let before = snap(&root);
    match core.trash_object(UKOL, &base) {
        Err(CoreError::Vault(VaultError::Conflict { disk })) => assert_ne!(disk.hash, base.hash, "Conflict carries the disk version"),
        other => assert!(false, "a file changed without an event is refused with Conflict: {other:?}"),
    }
    assert_eq!(changed(&before, &snap(&root)), Vec::<String>::new(), "nothing moves");
}

// ------------------------------------------------------------------------------------------------ AC-4

#[test]
fn fr_his_01_ac4_trash_list_rows_and_order() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let rows = core.trash_list();
    assert_eq!(rows.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), ROW_ORDER.to_vec(), "R71: newest first");
    let got: Vec<(String, TrashKind, String, String, String, Option<String>, Vec<String>, u32)> =
        rows.iter().map(|r| (r.path.clone(), r.kind, r.original.clone(), r.folder.clone(), r.title.clone(), r.type_key.clone(), r.files.clone(), r.count)).collect();
    let want = vec![
        (T3.into(), TrashKind::Object, "Images/Smazaný obrázek.md".into(), "Images".into(), "Smazaný obrázek".into(), Some("image".into()), strs(&[T3, T3_FILE]), 1),
        (T2.into(), TrashKind::Object, ZAHRADA.into(), "Pages".into(), "Zahrada".into(), Some("page".into()), strs(&[T2]), 1),
        (T4.into(), TrashKind::File, "_attachments/osiřelý.jpg".into(), "_attachments".into(), "osiřelý.jpg".into(), None, strs(&[T4]), 1),
        (T5.into(), TrashKind::Object, "Tasks/Hotovo.md".into(), "Tasks".into(), "Hotovo".into(), Some("task".into()), strs(&[T5]), 1),
        (FOLDER.into(), TrashKind::Folder, "Recepty".into(), "Recepty".into(), "Recepty".into(), None, strs(&[BABOVKA]), 1),
        (T1.into(), TrashKind::Object, "Quick Notes/Stará poznámka.md".into(), "Quick Notes".into(), "Stará poznámka".into(), Some("quick-note".into()), strs(&[T1]), 1),
    ];
    assert_eq!(got, want, "R70 rows: a pair is one row, a trashed type folder is one row");
    for w in rows.windows(2) {
        assert!(w[0].trashed_ns > w[1].trashed_ns, "trashed_ns descending: {} > {}", w[0].path, w[1].path);
    }
}

/// A file system whose `changed_ns` is the same for every entry (two entries trashed at the same time).
struct SameCtime(LocalFs);
impl VaultFs for SameCtime {
    fn list(&self) -> std::io::Result<Vec<FsEntry>> { self.0.list() }
    fn read(&self, p: &str) -> std::io::Result<(Vec<u8>, FileVersion)> { self.0.read(p) }
    fn version(&self, p: &str) -> std::io::Result<Option<FileVersion>> { self.0.version(p) }
    fn replace(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> { self.0.replace(p, b) }
    fn create_new(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> { self.0.create_new(p, b) }
    fn rename_no_replace(&self, f: &str, t: &str) -> std::io::Result<()> { self.0.rename_no_replace(f, t) }
    fn create_dir_all(&self, p: &str) -> std::io::Result<()> { self.0.create_dir_all(p) }
    fn remove_file(&self, p: &str) -> std::io::Result<()> { self.0.remove_file(p) }
    fn changed_ns(&self, p: &str) -> std::io::Result<Option<i128>> {
        Ok(self.0.version(p)?.map(|_| 1_000).or_else(|| std::fs::metadata(p).ok().map(|_| 1_000)).or(Some(1_000)))
    }
}

#[test]
fn fr_his_01_ac4_equal_times_keep_path_order() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let fs: Arc<dyn VaultFs> = Arc::new(SameCtime(LocalFs::new(&root)));
    let core = ok!(Core::open_with(fs, &sb.dirs, tegg_core::CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    let paths: Vec<String> = core.trash_list().into_iter().map(|r| r.path).collect();
    let mut want = strs(&ROW_ORDER);
    want.sort_by_key(|p| nfc(p).to_lowercase());
    assert_eq!(paths, want, "same time: path order (NFC, case-insensitive)");
}

// ------------------------------------------------------------------------------------------------ AC-5

#[test]
fn fr_his_01_ac5_restore_puts_the_file_back() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    assert!(!root.join("Quick Notes").exists(), "setup: the original folder doesn't exist");
    let id = ident(&root, T1);
    let moved = ok!(core.trash_restore(T1), "trash_restore");
    assert_eq!(moved, vec![mv(T1, "Quick Notes/Stará poznámka.md")], "one rename back; the missing folder is created");
    assert_eq!(ident(&root, "Quick Notes/Stará poznámka.md"), id, "bytes, mtime and inode untouched");
    let back = wait_until(Duration::from_secs(2), || core.object("Quick Notes/Stará poznámka.md").is_some());
    assert!(back.is_some(), "indexed again within 2 s");
    let page = ok!(core.search(&tegg_core::SearchQuery::text("Dávno smazané", chrono_tz::Europe::Prague)), "search");
    assert!(page.results.iter().any(|r| nfc(&r.path) == "Quick Notes/Stará poznámka.md"), "in search again");
    assert!(core.switcher("Stará poznámka", 10).iter().any(|i| i.path.as_deref().map(nfc).as_deref() == Some("Quick Notes/Stará poznámka.md")), "in the switcher again");
    assert!(core.backlinks("Quick Notes/Stará poznámka.md").iter().any(|p| nfc(p) == ODKAZY), "Odkazy is a backlink again");
    assert!(!core.inbox_list().iter().any(|r| nfc(&r.path) == "Quick Notes/Stará poznámka.md"), "review: reviewed keeps it out of the Inbox");
}

#[test]
fn fr_his_01_ac5_restore_into_a_taken_path_gets_a_suffix() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let live = ident(&root, ZAHRADA);
    let moved = ok!(core.trash_restore(T2), "trash_restore");
    assert_eq!(moved, vec![mv(T2, "Pages/Zahrada (2).md")], "` (2)` when the original path is taken");
    assert_eq!(read(&root, "Pages/Zahrada (2).md"), Some(fixture(T2)), "its bytes");
    assert_eq!(ident(&root, ZAHRADA), live, "the live Zahrada is untouched");
}

#[test]
fn fr_his_01_ac5_restore_a_folder_row_in_one_rename() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let dir = ident(&root, FOLDER);
    let moved = ok!(core.trash_restore(FOLDER), "trash_restore of the folder row");
    assert_eq!(moved, vec![mv(FOLDER, "Recepty")], "the whole folder in one rename (D-225)");
    assert_eq!(ident(&root, "Recepty").map(|x| x.0), dir.map(|x| x.0), "the same directory");
    assert_eq!(read(&root, "Recepty/Bábovka.md"), Some(fixture(BABOVKA)), "its files");
    assert!(!root.join(FOLDER).exists(), "gone from .trash/");
    let o = core.object("Recepty/Bábovka.md");
    assert!(o.is_some_and(|o| o.r#type == "recept"), "listed with its unknown type (D-103 shows it as Page)");
}

#[test]
fn fr_his_01_ac5_vault_restore_dir_suffix() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    write_raw(&root, "Recepty/Jiný.md", b"---\ntype: recept\ntitle: Jiny\n---\n");
    let to = ok!(core.vault().restore_dir(FOLDER), "Vault::restore_dir");
    assert_eq!(nfc(&to), "Recepty (2)", "` (2)` if the folder name is taken");
    assert_eq!(read(&root, "Recepty (2)/Bábovka.md"), Some(fixture(BABOVKA)), "moved as one folder");
}

// ------------------------------------------------------------------------------------------------ AC-6 (§1.5)

#[test]
fn fr_his_01_ac6_a_trashed_note_is_read_only_at_the_core() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let v = version(&core, T1);
    let r = core.write_note(T1, b"---\ntitle: Jinak\n---\n", Some(&v));
    assert!(matches!(r, Err(CoreError::Invalid { .. })), "note_write refuses a path under .trash/: {r:?}");
    assert_eq!(changed(&before, &snap(&root)), Vec::<String>::new(), "nothing written");
}

// ------------------------------------------------------------------------------------------------ AC-7

#[test]
fn fr_his_01_ac7_delete_permanently_goes_to_the_system_trash() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let sink = Sink::new(&sb, &root, &[]);
    let before = snap(&root);
    let r = core.trash_delete(&strs(&[T5]), &sink);
    assert_eq!(sink.got(), strs(&[T5]), "moved to the system trash (never unlinked)");
    assert!(r.removed.iter().any(|p| nfc(p) == T5) && r.failed.is_empty(), "reported removed: {r:?}");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, strs(&[T5]), "it left the vault, nothing else changed");
    let r3 = core.trash_delete(&strs(&[T3]), &sink);
    let mut got = sink.got();
    got.sort();
    assert_eq!(got, { let mut w = strs(&[T5, T3, T3_FILE]); w.sort(); w }, "both files of the pair: {r3:?}");
}

#[test]
fn fr_his_01_ac7_only_paths_under_trash() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let sink = Sink::new(&sb, &root, &[]);
    let r = core.trash_delete(&strs(&[UKOL, T1]), &sink);
    assert!(r.failed.iter().any(|(p, _)| nfc(p) == UKOL), "a live path is refused: {r:?}");
    assert_eq!(sink.got(), strs(&[T1]), "only the trashed row goes");
    assert!(root.join(UKOL).exists(), "the live note stays");
}

// ------------------------------------------------------------------------------------------------ AC-8

#[test]
fn fr_his_01_ac8_empty_trash_moves_every_top_level_entry() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let sink = Sink::new(&sb, &root, &[]);
    let r = core.trash_empty(&sink);
    let mut got = sink.got();
    got.sort();
    assert_eq!(got, strs(&[".trash/Images", ".trash/Pages", ".trash/Quick Notes", ".trash/Recepty", ".trash/Tasks", ".trash/_attachments"]), "every top-level entry");
    assert!(r.failed.is_empty(), "nothing failed: {r:?}");
    assert!(root.join(".trash").is_dir(), ".trash/ itself stays");
    assert_eq!(std::fs::read_dir(root.join(".trash")).map(|d| d.count()).unwrap_or(99), 0, ".trash/ is empty");
    assert!(core.trash_list().is_empty(), "the list is empty");
}

#[test]
fn fr_his_01_ac8_an_entry_that_cant_be_moved_stays_and_is_reported() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let sink = Sink::new(&sb, &root, &[".trash/Tasks"]);
    let r = core.trash_empty(&sink);
    assert_eq!(r.failed.iter().map(|(p, _)| nfc(p)).collect::<Vec<_>>(), strs(&[".trash/Tasks"]), "the failure is reported");
    assert!(root.join(T5).exists(), "it stays");
    assert_eq!(sink.got().len(), 5, "the others went");
}

// ------------------------------------------------------------------------------------------------ AC-10

#[test]
fn fr_his_01_ac10_nothing_only_in_the_index() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let first = {
        let core = open(&root, &sb);
        core.trash_list()
    };
    assert_eq!(first.len(), 6, "six rows");
    let dirs = fresh_dirs(&sb, "fresh-support");
    let core = match tegg_core::Core::open(&root, &dirs, tegg_core::CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: reopen: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    assert_eq!(core.trash_list(), first, "the same list, times and targets from a new index");
}

// ------------------------------------------------------------------------------------------------ AC-14, AC-15

#[test]
fn fr_his_01_ac14_a_pair_goes_together_and_comes_back_together() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    assert_eq!(core.pair_of(IMG).map(|p| nfc(&p)), Some(PNG.to_string()), "pair_of resolves file:");
    let before = snap(&root);
    let base = version(&core, IMG);
    let moved = ok!(core.trash_object(IMG, &base), "trash_object");
    assert_eq!(moved, vec![mv(IMG, ".trash/Images/Záhon.md"), mv(PNG, ".trash/_attachments/záhon.png")], "two renames, the object first");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, strs(&[".trash/Images/Záhon.md", ".trash/_attachments/záhon.png", IMG, PNG]), "only those");
    let row = core.trash_list().into_iter().find(|r| nfc(&r.path) == ".trash/Images/Záhon.md");
    assert_eq!(row.map(|r| r.files), Some(strs(&[".trash/Images/Záhon.md", ".trash/_attachments/záhon.png"])), "one row with both files");
    let back = ok!(core.trash_restore(".trash/Images/Záhon.md"), "trash_restore");
    assert_eq!(back, vec![mv(".trash/Images/Záhon.md", IMG), mv(".trash/_attachments/záhon.png", PNG)], "both come back");
    assert_eq!(read(&root, PNG), Some(fixture(PNG)), "the PNG's bytes");
}

/// A file system whose rename of one path fails (the second rename of a pair).
struct FailRename(LocalFs, &'static str);
impl VaultFs for FailRename {
    fn list(&self) -> std::io::Result<Vec<FsEntry>> { self.0.list() }
    fn read(&self, p: &str) -> std::io::Result<(Vec<u8>, FileVersion)> { self.0.read(p) }
    fn version(&self, p: &str) -> std::io::Result<Option<FileVersion>> { self.0.version(p) }
    fn replace(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> { self.0.replace(p, b) }
    fn create_new(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> { self.0.create_new(p, b) }
    fn rename_no_replace(&self, f: &str, t: &str) -> std::io::Result<()> {
        if nfc(f) == self.1 { return Err(std::io::Error::other("test: rename fails")); }
        self.0.rename_no_replace(f, t)
    }
    fn create_dir_all(&self, p: &str) -> std::io::Result<()> { self.0.create_dir_all(p) }
    fn remove_file(&self, p: &str) -> std::io::Result<()> { self.0.remove_file(p) }
    fn changed_ns(&self, p: &str) -> std::io::Result<Option<i128>> { self.0.changed_ns(p) }
}

#[test]
fn fr_his_01_ac14_a_failed_second_rename_undoes_the_first() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let fs: Arc<dyn VaultFs> = Arc::new(FailRename(LocalFs::new(&root), PNG));
    let core = ok!(Core::open_with(fs, &sb.dirs, tegg_core::CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    let before = snap(&root);
    let base = version(&core, IMG);
    let r = core.trash_object(IMG, &base);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Io(_)))), "the error is returned: {r:?}");
    assert!(root.join(IMG).exists(), "the object is renamed back");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, Vec::<String>::new(), "nothing changed (the object's rename was undone)");
    assert!(core.pair_of(IMG).is_some(), "pair_of finds the file");
}

#[test]
fn fr_his_01_ac14_trashing_a_note_never_takes_its_media() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let base = version(&core, PLAN);
    let moved = ok!(core.trash_object(PLAN, &base), "trash_object");
    assert_eq!(moved, vec![mv(PLAN, ".trash/Pages/Plán zahrady.md")], "only the note (FR-ATT-09)");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, strs(&[".trash/Pages/Plán zahrady.md", PLAN]), "Img, PNG, Pdf and PDF stay");
}

#[test]
fn fr_his_01_ac15_a_shared_file_stays() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, "Images/Záhon kopie.md", text(&root, IMG).replace("id: 01JB6A0000000000000000F004", "id: 01JB6A0000000000000000F030").replace("title: Záhon", "title: Záhon kopie").as_bytes());
    let core = open(&root, &sb);
    let base = version(&core, IMG);
    let moved = ok!(core.trash_object(IMG, &base), "trash_object");
    assert_eq!(moved, vec![mv(IMG, ".trash/Images/Záhon.md")], "only the object: the other object still uses the file");
    assert!(root.join(PNG).exists(), "the file stays");
    let row = core.trash_list().into_iter().find(|r| nfc(&r.path) == ".trash/Images/Záhon.md");
    assert_eq!(row.map(|r| r.files), Some(strs(&[".trash/Images/Záhon.md"])), "the row has no file part");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-30

#[test]
fn fr_syn_06_ac30_trash_and_restore_rename_exactly_their_files() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let s0 = snap(&root);
    let base = version(&core, UKOL);
    ok!(core.trash_object(UKOL, &base), "trash_object");
    let s1 = snap(&root);
    let mut d1 = changed(&s0, &s1);
    d1.retain(|p| !p.ends_with('/'));
    assert_eq!(d1, strs(&[".trash/Tasks/Koupit semínka.md", UKOL]), "Move to trash");
    ok!(core.trash_restore(".trash/Tasks/Koupit semínka.md"), "trash_restore");
    let mut d2 = changed(&s0, &snap(&root));
    d2.retain(|p| !p.ends_with('/'));
    assert_eq!(d2, Vec::<String>::new(), "Restore gives the vault back byte-identical, same mtime and inode");
}
