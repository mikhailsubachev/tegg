//! Slice I1 (docs/contracts/v1-import.md §9.4, §9.5, §12.2): the file access the import engine gets from `tegg-vault`.
//! The staged exclusive create never truncates or replaces; the folder helpers refuse a folder without the marker
//! `.tegg-import`; the probes create nothing. Unit-level tests of the implementation (the acceptance tests are
//! `crates/tegg-import/tests/ac_import_*.rs`).

mod common;

use std::io::{self, Cursor, Read};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use common::*;
use tegg_vault::*;

fn vault(sb: &Sandbox) -> (PathBuf, Vault) {
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    write_raw(&root, "Pages/Staré.md", b"moje\n");
    let v = Vault::open(&root, &sb.dirs).expect("setup: open");
    (root, v)
}
fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).expect("read_dir").map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}
fn hash(b: &[u8]) -> [u8; 32] {
    *blake3::hash(b).as_bytes()
}

#[test]
fn stage_then_commit_creates_the_file_with_the_staged_bytes_and_keeps_the_file_id() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    let bytes = "Příliš žluťoučký kůň\n".repeat(10_000).into_bytes();
    let staged = v.stage_new("Pages/Nová.md", "i7", &mut Cursor::new(bytes.clone())).expect("stage");
    assert_eq!(staged.path, "Pages/Nová.md");
    assert_eq!(staged.temp, "Pages/.Nová.md.i7.tegg-tmp");
    assert_eq!((staged.version.size, staged.version.hash), (bytes.len() as u64, hash(&bytes)));
    assert_eq!(std::fs::read(root.join(&staged.temp)).expect("temp"), bytes, "the temp file is complete");
    assert!(!root.join("Pages/Nová.md").exists(), "nothing is at the final name before the commit");
    assert_eq!(v.file_id(&staged.temp).expect("id"), Some(staged.file_id));
    let id = staged.file_id;
    let version = v.commit_new(staged).expect("commit");
    assert_eq!((version.size, version.hash), (bytes.len() as u64, hash(&bytes)));
    assert_eq!(std::fs::read(root.join("Pages/Nová.md")).expect("file"), bytes);
    assert_eq!(v.file_id("Pages/Nová.md").expect("id"), Some(id), "the rename keeps the file id");
    assert_eq!(names(&root.join("Pages")), ["Nová.md", "Staré.md"], "no temp file is left");
    assert_eq!(v.version("Pages/Nová.md").expect("version").map(|x| x.same_content(&version)), Some(true));
}

#[test]
fn stage_never_truncates_an_existing_temp_file_and_creates_no_folder() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    write_raw(&root, "Pages/.Nová.md.i7.tegg-tmp", b"someone else's bytes");
    let e = v.stage_new("Pages/Nová.md", "i7", &mut Cursor::new(b"new".to_vec()));
    assert!(matches!(e, Err(VaultError::Io(ref x)) if x.kind() == io::ErrorKind::AlreadyExists), "{e:?}");
    assert_eq!(std::fs::read(root.join("Pages/.Nová.md.i7.tegg-tmp")).expect("temp"), b"someone else's bytes", "the existing file is untouched");
    // A missing folder is an error; the staged create makes no folder (the import logs each folder first).
    assert!(v.stage_new("Nikde/Nová.md", "i7", &mut Cursor::new(b"x".to_vec())).is_err());
    assert!(!root.join("Nikde").exists());
    // A tag can't leave the folder.
    assert!(v.stage_new("Pages/Nová.md", "../x", &mut Cursor::new(b"x".to_vec())).is_err());
    assert!(v.stage_new("Pages/Nová.md", "", &mut Cursor::new(b"x".to_vec())).is_err());
}

#[test]
fn a_failing_source_leaves_no_temp_file() {
    struct Failing(usize);
    impl Read for Failing {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.0 == 0 {
                return Err(io::Error::new(io::ErrorKind::StorageFull, "injected"));
            }
            self.0 -= 1;
            buf[..4].copy_from_slice(b"data");
            Ok(4)
        }
    }
    let sb = sandbox();
    let (root, v) = vault(&sb);
    let e = v.stage_new("Pages/Nová.md", "i7", &mut Failing(3));
    assert!(matches!(e, Err(VaultError::Io(ref x)) if x.kind() == io::ErrorKind::StorageFull), "{e:?}");
    assert_eq!(names(&root.join("Pages")), ["Staré.md"]);
}

#[test]
fn commit_answers_name_taken_removes_the_temp_file_and_never_touches_the_file_there() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    let before = std::fs::metadata(root.join("Pages/Staré.md")).expect("md");
    // The same name, in another letter case and in NFD: taken on every volume (NFC, case-folded).
    for name in ["Pages/Staré.md", "Pages/STARÉ.md", "Pages/Stare\u{301}.md"] {
        let staged = v.stage_new(name, "i7", &mut Cursor::new(b"import".to_vec())).expect("stage");
        let temp = root.join(&staged.temp);
        assert!(temp.exists());
        assert!(matches!(v.commit_new(staged), Err(VaultError::NameTaken)), "{name}");
        assert!(!temp.exists(), "{name}: the temp file is removed");
    }
    let after = std::fs::metadata(root.join("Pages/Staré.md")).expect("md");
    assert_eq!(std::fs::read(root.join("Pages/Staré.md")).expect("read"), b"moje\n");
    assert_eq!((before.ino(), before.mtime(), before.mtime_nsec()), (after.ino(), after.mtime(), after.mtime_nsec()), "the owner's file: same inode, same mtime");
    assert_eq!(names(&root.join("Pages")), ["Staré.md"]);
    // A folder with that name is taken too.
    std::fs::create_dir(root.join("Pages/Složka")).expect("setup");
    let staged = v.stage_new("Pages/Složka", "i7", &mut Cursor::new(b"x".to_vec())).expect("stage");
    assert!(matches!(v.commit_new(staged), Err(VaultError::NameTaken)));
    // A file that arrives between the stage and the commit is never replaced, even with equal bytes.
    let staged = v.stage_new("Pages/Pozdě.md", "i7", &mut Cursor::new("stejné".as_bytes().to_vec())).expect("stage");
    write_raw(&root, "Pages/Pozdě.md", b"stejn\xc3\xa9");
    let ino = std::fs::metadata(root.join("Pages/Pozdě.md")).expect("md").ino();
    assert!(matches!(v.commit_new(staged), Err(VaultError::NameTaken)));
    assert_eq!(std::fs::metadata(root.join("Pages/Pozdě.md")).expect("md").ino(), ino, "the arrived file stays the arrived file");
    assert_eq!(names(&root.join("Pages")), ["Pozdě.md", "Složka", "Staré.md"]);
}

#[test]
fn discard_staged_and_remove_temp_remove_only_temp_files() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    let staged = v.stage_new("Pages/Nová.md", "i7", &mut Cursor::new(b"x".to_vec())).expect("stage");
    v.discard_staged(staged);
    assert_eq!(names(&root.join("Pages")), ["Staré.md"]);
    write_raw(&root, "Pages/.Staré.md.i7.tegg-tmp", b"t");
    write_raw(&root, "Pages/.Staré.md.tegg-tmp", b"t");
    assert!(matches!(v.remove_temp("Pages/Staré.md", Some("i8")), Ok(false)), "another run's tag: nothing removed");
    assert!(matches!(v.remove_temp("Pages/Staré.md", Some("i7")), Ok(true)));
    assert!(matches!(v.remove_temp("Pages/Staré.md", None), Ok(true)));
    assert!(matches!(v.remove_temp("Pages/Staré.md", None), Ok(false)));
    assert_eq!(names(&root.join("Pages")), ["Staré.md"], "the file itself is never removed by remove_temp");
}

#[test]
fn write_with_runs_the_hook_between_the_temp_file_and_the_rename() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    let (_, base) = v.read("Pages/Staré.md").expect("read");
    let seen: Mutex<Option<(bool, Vec<u8>)>> = Mutex::new(None);
    let calls = AtomicUsize::new(0);
    let out = v.write_with("Pages/Staré.md", b"nov\xc3\xa9\n", Some(&base), &|| {
        calls.fetch_add(1, Ordering::SeqCst);
        *seen.lock().expect("seen") = Some((root.join("Pages/.Staré.md.tegg-tmp").exists(), std::fs::read(root.join("Pages/Staré.md")).expect("read")));
        Ok(())
    });
    assert!(matches!(out, Ok(WriteOutcome::Written(_))), "{out:?}");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(seen.lock().expect("seen").clone(), Some((true, b"moje\n".to_vec())), "at the hook the temp file exists and the file still has its old bytes");
    assert_eq!(std::fs::read(root.join("Pages/Staré.md")).expect("read"), b"nov\xc3\xa9\n");
    // A failing hook fails the write, removes the temp file and leaves the file as it was.
    let (_, base) = v.read("Pages/Staré.md").expect("read");
    let out = v.write_with("Pages/Staré.md", b"jin\xc3\xa9\n", Some(&base), &|| Err(io::Error::new(io::ErrorKind::StorageFull, "injected")));
    assert!(matches!(out, Err(VaultError::Io(ref e)) if e.kind() == io::ErrorKind::StorageFull), "{out:?}");
    assert_eq!(std::fs::read(root.join("Pages/Staré.md")).expect("read"), b"nov\xc3\xa9\n");
    assert_eq!(names(&root.join("Pages")), ["Staré.md"]);
    // Unchanged bytes and a changed base never reach the hook.
    let never = || -> io::Result<()> { panic!("the hook must not run") };
    assert!(matches!(v.write_with("Pages/Staré.md", b"nov\xc3\xa9\n", Some(&base), &never), Ok(WriteOutcome::Unchanged)));
    let stale = FileVersion { mtime_ns: 0, size: 1, hash: [0; 32] };
    assert!(matches!(v.write_with("Pages/Staré.md", b"x", Some(&stale), &never), Err(VaultError::Conflict { .. })));
}

#[test]
fn vault_folder_helpers() {
    let sb = sandbox();
    let (root, v) = vault(&sb);
    assert!(v.dir_exists("Pages") && !v.dir_exists("Books") && !v.dir_exists("Pages/Staré.md"));
    v.create_dir("Books/Sub").expect("create");
    assert!(v.dir_exists("Books/Sub"));
    assert!(!v.remove_empty_dir("Books"), "a folder that holds something stays");
    assert!(v.remove_empty_dir("Books/Sub") && v.remove_empty_dir("Books"));
    assert!(!root.join("Books").exists());
    assert!(!v.remove_empty_dir("Pages") && root.join("Pages/Staré.md").exists());
    assert!(!v.remove_empty_dir("Nikde") && !v.remove_empty_dir(""));
}

#[test]
fn the_free_functions_work_on_a_bare_local_fs_and_on_mem_fs() {
    let sb = sandbox();
    let dir = sb.base.join("Nový.tegg-importing");
    create_external_dir_new(&dir).expect("create");
    assert!(create_external_dir_new(&dir).is_err(), "an existing folder is an error");
    let fs = LocalFs::new(&dir);
    let staged = stage_new_on(&fs, ".tegg-import", "i1", &mut Cursor::new(b"{}".to_vec())).expect("stage at the root");
    assert_eq!(staged.temp, "..tegg-import.i1.tegg-tmp");
    commit_new_on(&fs, staged).expect("commit");
    fs.create_dir_new("Pages").expect("dir");
    assert_eq!(fs.create_dir_new("Pages").map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists));
    let staged = stage_new_on(&fs, "Pages/A.md", "i1", &mut Cursor::new(b"a".to_vec())).expect("stage");
    commit_new_on(&fs, staged).expect("commit");
    let staged = stage_new_on(&fs, "Pages/a.md", "i1", &mut Cursor::new(b"b".to_vec())).expect("stage");
    assert_eq!(commit_new_on(&fs, staged).map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists));
    let staged = stage_new_on(&fs, "Pages/B.md", "i1", &mut Cursor::new(b"b".to_vec())).expect("stage");
    discard_staged_on(&fs, staged);
    assert_eq!(names(&dir.join("Pages")), ["A.md"]);
    assert_eq!(list_external_dir(&dir).expect("list"), [(".tegg-import".to_string(), false), ("Pages".to_string(), true)]);

    // The in-memory twin gives the same answers.
    let mem = MemFs::new();
    mem.create_dir_all("Pages").expect("dir");
    let staged = stage_new_on(&mem, "Pages/A.md", "i1", &mut Cursor::new(b"a".to_vec())).expect("stage");
    let id = staged.file_id;
    assert_eq!(mem.file_id("Pages/.A.md.i1.tegg-tmp").expect("id"), Some(id));
    commit_new_on(&mem, staged).expect("commit");
    assert_eq!(mem.file_id("Pages/A.md").expect("id"), Some(id), "a rename keeps the id");
    let staged = stage_new_on(&mem, "Pages/a.md", "i1", &mut Cursor::new(b"b".to_vec())).expect("stage");
    assert_eq!(commit_new_on(&mem, staged).map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists));
    assert_eq!(mem.read("Pages/A.md").expect("read").0, b"a");
    assert_eq!(mem.version("Pages/.a.md.i1.tegg-tmp").expect("version"), None, "the temp file is removed");
    assert_eq!(mem.create_dir_new("Pages").map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists));
    assert!(mem.is_dir("Pages").expect("is_dir") && !mem.is_dir("Pages/A.md").expect("is_dir"));
}

#[test]
fn rename_dir_no_replace_never_replaces_or_merges() {
    let sb = sandbox();
    let from = sb.base.join("A.tegg-importing");
    write_raw(&from, "Pages/x.md", b"x");
    // Taken by an empty folder, a folder with files, and a file: always AlreadyExists, both sides unchanged.
    for taken in ["empty", "full", "file"] {
        let to = sb.base.join(taken);
        match taken {
            "empty" => std::fs::create_dir(&to).expect("setup"),
            "full" => write_raw(&to, "mine.md", b"mine"),
            _ => write_raw(&sb.base, taken, b"a file"),
        }
        let e = rename_dir_no_replace(&from, &to);
        assert_eq!(e.map_err(|e| e.kind()), Err(io::ErrorKind::AlreadyExists), "{taken}");
        assert!(from.join("Pages/x.md").exists(), "{taken}: the source stays");
        assert!(!to.join("Pages").exists(), "{taken}: nothing is merged");
    }
    assert_eq!(std::fs::read(sb.base.join("full/mine.md")).expect("read"), b"mine");
    assert_eq!(std::fs::read(sb.base.join("file")).expect("read"), b"a file");
    let to = sb.base.join("A");
    rename_dir_no_replace(&from, &to).expect("rename");
    assert!(!from.exists() && to.join("Pages/x.md").exists());
    assert!(rename_dir_no_replace(&sb.base.join("file"), &sb.base.join("B")).is_err(), "only folders");
    assert!(sb.base.join("file").exists() && !sb.base.join("B").exists());
}

#[test]
fn remove_dir_tree_and_trash_import_leftover_refuse_a_folder_without_the_marker() {
    struct Sink(Mutex<Vec<PathBuf>>, PathBuf, bool);
    impl SystemTrash for Sink {
        fn trash(&self, abs: &Path) -> io::Result<()> {
            self.0.lock().expect("calls").push(abs.to_path_buf());
            if self.2 {
                std::fs::rename(abs, self.1.join(abs.file_name().expect("name")))?;
            }
            Ok(())
        }
    }
    struct NoTrash;
    impl SystemTrash for NoTrash {
        fn trash(&self, _: &Path) -> io::Result<()> {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "no trash"))
        }
    }
    let sb = sandbox();
    let bin = sb.base.join("Trash");
    std::fs::create_dir(&bin).expect("setup");
    let plain = sb.base.join("Moje složka");
    write_raw(&plain, "Pages/důležité.md", b"data");
    let sink = Sink(Mutex::new(Vec::new()), bin.clone(), true);
    assert!(remove_dir_tree(&plain).is_err());
    assert!(trash_import_leftover(&plain, &sink).is_err());
    assert!(remove_dir_tree(&sb.base.join("Nikde")).is_err());
    // A folder named like the marker isn't the marker; a symbolic link to a marked folder isn't a marked folder.
    std::fs::create_dir(plain.join(".tegg-import")).expect("setup");
    assert!(remove_dir_tree(&plain).is_err() && trash_import_leftover(&plain, &sink).is_err());
    let marked = sb.base.join("X.tegg-importing");
    write_raw(&marked, ".tegg-import", b"{}");
    write_raw(&marked, "Pages/a.md", b"a");
    let link = sb.base.join("link");
    std::os::unix::fs::symlink(&marked, &link).expect("setup");
    assert!(remove_dir_tree(&link).is_err() && trash_import_leftover(&link, &sink).is_err());
    assert_eq!(std::fs::read(plain.join("Pages/důležité.md")).expect("read"), b"data", "nothing was removed");
    assert!(marked.join("Pages/a.md").exists());
    assert_eq!(sink.0.lock().expect("calls").len(), 0, "the sink was never called for an unmarked folder");

    // A failing sink, and a sink that says Ok but moves nothing: an error, the folder stays whole.
    assert!(trash_import_leftover(&marked, &NoTrash).is_err());
    let lazy = Sink(Mutex::new(Vec::new()), bin.clone(), false);
    assert!(trash_import_leftover(&marked, &lazy).is_err());
    assert!(marked.join("Pages/a.md").exists() && marked.join(".tegg-import").exists());
    // The move: one call, for the whole folder.
    trash_import_leftover(&marked, &sink).expect("trash");
    assert_eq!(*sink.0.lock().expect("calls"), [marked.clone()]);
    assert!(!marked.exists() && bin.join("X.tegg-importing/Pages/a.md").exists());

    // remove_dir_tree removes the run's own marked folder whole.
    let own = sb.base.join("Y.tegg-importing");
    write_raw(&own, ".tegg-import", b"{}");
    write_raw(&own, "_attachments/a.png", b"png");
    remove_dir_tree(&own).expect("remove");
    assert!(!own.exists());
}

#[test]
fn append_local_file_appends_whole_lines_and_creates_the_file_and_its_folder() {
    let sb = sandbox();
    let log = sb.dirs.root.join("jobs/abc/7.log");
    append_local_file(&log, b"D\tBooks").expect("append");
    append_local_file(&log, "C\tBooks/Kniha č. 1.md\t3\tabc".as_bytes()).expect("append");
    assert_eq!(std::fs::read_to_string(&log).expect("read"), "D\tBooks\nC\tBooks/Kniha č. 1.md\t3\tabc\n");
    assert_eq!(names(log.parent().expect("dir")), ["7.log"], "no temp file: the log is appended in place");
}

#[test]
fn probes_read_only_and_create_nothing() {
    let sb = sandbox();
    let place = sb.base.join("Místo");
    std::fs::create_dir(&place).expect("setup");
    let snapshot = || snapshot_skipping(&sb.base, &[]);
    let before = snapshot();

    let p = probe_new_vault(&place, "Nový").expect("probe");
    assert_eq!(p, NewVaultProbe { parent: place.clone(), parent_is_dir: true, writable: true, final_exists: false, temp_exists: false, marker: None, inside_vault: false });
    // A missing parent, and a file as the parent.
    let p = probe_new_vault(&sb.base.join("Nikde/Hluboko"), "Nový").expect("probe");
    assert_eq!((p.parent.clone(), p.parent_is_dir, p.writable), (sb.base.join("Nikde/Hluboko"), false, false));
    assert_eq!(snapshot(), before, "the probes created nothing");

    write_raw(&sb.base, "soubor", b"x");
    let p = probe_new_vault(&sb.base.join("soubor"), "Nový").expect("probe");
    assert_eq!((p.parent_is_dir, p.writable), (false, false));

    // The final name and the temporary folder, with and without its marker.
    std::fs::create_dir(place.join("Nový")).expect("setup");
    std::fs::create_dir(place.join("Nový.tegg-importing")).expect("setup");
    let p = probe_new_vault(&place, "Nový").expect("probe");
    assert_eq!((p.final_exists, p.temp_exists, p.marker.clone()), (true, true, None));
    write_raw(&place, "Nový.tegg-importing/.tegg-import", b"{\"version\":1,\"run\":\"1-2\"}");
    assert_eq!(probe_new_vault(&place, "Nový").expect("probe").marker.as_deref(), Some("{\"version\":1,\"run\":\"1-2\"}"));
    write_raw(&place, "Nový.tegg-importing/.tegg-import", &[0xff, 0xfe, b'x']);
    assert!(probe_new_vault(&place, "Nový").expect("probe").marker.is_some(), "a marker that isn't UTF-8 is still a marker");

    // A read-only parent.
    let ro = sb.base.join("Jen ke čtení");
    std::fs::create_dir(&ro).expect("setup");
    let mut perm = std::fs::metadata(&ro).expect("md").permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut perm, 0o555);
    std::fs::set_permissions(&ro, perm.clone()).expect("setup");
    let p = probe_new_vault(&ro, "Nový").expect("probe");
    std::os::unix::fs::PermissionsExt::set_mode(&mut perm, 0o755);
    std::fs::set_permissions(&ro, perm).expect("cleanup");
    assert_eq!((p.parent_is_dir, p.writable), (true, false), "access(W_OK | X_OK) says no; no probe file was tried");
    assert_eq!(names(&ro), Vec::<String>::new());

    // Inside a vault, through a symbolic link too; `.git` for the real-export run's refusal.
    let vault = sb.base.join("Trezor");
    manual_vault(&vault);
    std::fs::create_dir_all(vault.join("Pages/Hluboko")).expect("setup");
    assert!(probe_new_vault(&vault.join("Pages/Hluboko"), "Nový").expect("probe").inside_vault);
    assert!(probe_new_vault(&vault.join("Pages/Zatím není"), "Nový").expect("probe").inside_vault, "a place that doesn't exist yet, under a vault");
    let link = sb.base.join("odkaz");
    std::os::unix::fs::symlink(vault.join("Pages"), &link).expect("setup");
    let p = probe_new_vault(&link, "Nový").expect("probe");
    assert_eq!((p.parent.clone(), p.inside_vault), (vault.join("Pages"), true), "the link is resolved");
    assert!(has_entry_at_or_above(&link.join("Hluboko"), ".tegg").expect("probe"));
    assert!(!has_entry_at_or_above(&place, ".git").expect("probe"));
    write_raw(&sb.base, "repo/.git", b"gitdir: elsewhere\n");
    assert!(has_entry_at_or_above(&sb.base.join("repo/a/b/c"), ".git").expect("probe"), "a `.git` file (a worktree) counts");
    assert_eq!(resolve_existing(&link.join("Není/tu.md")).expect("resolve"), vault.join("Pages/Není/tu.md"));
    assert!(is_inside(&link.join("Hluboko"), &vault).expect("inside") && is_inside(&vault, &vault).expect("inside"));
    assert!(!is_inside(&place, &vault).expect("inside") && !is_inside(&sb.base.join("Trezor 2"), &vault).expect("inside"));
}

#[test]
fn external_folder_reads_and_never_leaves_its_root() {
    let sb = sandbox();
    let src = sb.base.join("Export");
    write_raw(&src, "PKM/Pages/Čtení.md", b"abc");
    write_raw(&src, "PKM/Images/Media/a.png", b"12345");
    write_raw(&sb.base, "tajné.txt", b"secret");
    let f = ExternalFolder::new(&src);
    let list = f.list().expect("list");
    assert_eq!(list.iter().map(|(p, s, _)| (tegg_format::nfc(p), *s)).collect::<Vec<_>>(), [("PKM/Images/Media/a.png".to_string(), 5), ("PKM/Pages/Čtení.md".to_string(), 3)]);
    for (rel, size, mtime) in &list {
        assert_eq!(f.stat(rel).expect("stat"), Some((*size, *mtime)));
        let mut b = Vec::new();
        f.open(rel).expect("open").read_to_end(&mut b).expect("read");
        assert_eq!(b.len() as u64, *size);
    }
    assert_eq!(f.stat("PKM/Není.md").expect("stat"), None);
    for bad in ["../tajné.txt", "PKM/../../tajné.txt", "/etc/hosts", ""] {
        assert!(f.open(bad).is_err() && f.stat(bad).is_err(), "{bad}");
    }
    assert!(f.open("PKM/Pages").is_err(), "a folder is not opened");
    assert_eq!(stat_external(&src.join("PKM/Pages/Čtení.md")).expect("stat").map(|x| x.0), Some(3));
    assert_eq!(stat_external(&src.join("nic")).expect("stat"), None);
    let mut b = String::new();
    open_external_file(&sb.base.join("tajné.txt")).expect("open").read_to_string(&mut b).expect("read");
    assert_eq!(b, "secret");
}

#[test]
fn free_space_and_volume_id_answer_for_a_path_that_does_not_exist_yet() {
    let sb = sandbox();
    let missing = sb.base.join("a/b/c");
    assert!(free_space(&missing).expect("free") > 0);
    assert_eq!(volume_id(&missing).expect("volume"), volume_id(&sb.base).expect("volume"));
    assert!(!missing.exists() && !sb.base.join("a").exists());
}

#[test]
fn empty_vault_is_exported() {
    assert!(EMPTY_VAULT.iter().any(|(p, _)| *p == ".tegg/vault.yml"));
    assert_eq!(EMPTY_VAULT.iter().filter(|(p, _)| p.starts_with(".tegg/types/")).count(), 7);
}
