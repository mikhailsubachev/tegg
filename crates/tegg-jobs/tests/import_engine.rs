//! Slice I1 (docs/contracts/v1-import.md §9, §9.6, §10, §12.1): the engine's side of an import, through the core's
//! host on a temporary vault: `Jobs::start_import` (phases, the backup's time, cancel in `queued` / `planning` /
//! `backup`, `NotCancellable` in `writing`), the journal's lines and the roll-back from a log alone (`Undo` after a
//! kill). Implementation tests; the acceptance tests are `crates/tegg-import/tests/ac_import_*.rs`.

mod common;

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::*;
use tegg_core::Core;
use tegg_jobs::{import_journal as journal, FileVersion, ImportCtx, ImportJob, JobError, JobKind, Phase, ResolveChoice};

type Step = Box<dyn Fn(&ImportCtx<'_>) -> Result<(), String> + Send + Sync>;

/// An import whose calls are closures; it records the order of the engine's calls.
struct Fake {
    calls: Mutex<Vec<String>>,
    backup: bool,
    prepare: Step,
    before_backup: Step,
    after_backup: Step,
    write: Step,
}

fn nothing() -> Step {
    Box::new(|_| Ok(()))
}
fn fake() -> Fake {
    Fake { calls: Mutex::new(Vec::new()), backup: true, prepare: nothing(), before_backup: nothing(), after_backup: nothing(), write: nothing() }
}

impl Fake {
    fn note(&self, what: &str) {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).push(what.to_string());
    }
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl ImportJob for Fake {
    fn title(&self) -> String {
        "PKM".into()
    }
    fn source(&self) -> String {
        "export.zip".into()
    }
    fn prepare(&self, ctx: &ImportCtx<'_>) -> Result<usize, String> {
        self.note("prepare");
        (self.prepare)(ctx).map(|_| 2)
    }
    fn needs_backup(&self, _: &ImportCtx<'_>) -> bool {
        self.note("needs_backup");
        self.backup
    }
    fn backup_time(&self) -> Option<chrono::DateTime<chrono::Utc>> {
        chrono::DateTime::parse_from_rfc3339("2026-11-12T10:00:00+01:00").ok().map(|t| t.with_timezone(&chrono::Utc))
    }
    fn before_backup(&self, ctx: &ImportCtx<'_>) -> Result<(), String> {
        self.note("before_backup");
        (self.before_backup)(ctx)
    }
    fn after_backup(&self, ctx: &ImportCtx<'_>, zip: &str) -> Result<(), String> {
        self.note(&format!("after_backup {zip}"));
        (self.after_backup)(ctx)
    }
    fn write(&self, ctx: &ImportCtx<'_>) -> Result<(), String> {
        self.note("write");
        (self.write)(ctx)
    }
    fn finished(&self, phase: Phase, error: Option<&str>) {
        self.note(&format!("finished {} {}", phase.as_str(), error.unwrap_or("-")));
    }
}

fn vault(sb: &Sandbox) -> (PathBuf, Core) {
    let root = rename_vault(sb);
    let core = open_core(&root, &sb.dirs, false).expect("setup: open the vault");
    (root, core)
}
fn zips(sb: &Sandbox) -> Vec<String> {
    snapshot(&sb.dirs.root.join("backups")).into_keys().filter(|k| k.ends_with(".zip")).map(|k| k.rsplit('/').next().unwrap_or_default().to_string()).collect()
}
fn journal_files(sb: &Sandbox) -> Vec<String> {
    snapshot(&sb.dirs.root.join("jobs")).into_keys().filter(|k| k.ends_with(".json") || k.ends_with(".log")).collect()
}
/// One created file by §9.4's sequence: `C`, the staged temp file, `T`, the commit, `K`.
fn create(ctx: &ImportCtx<'_>, path: &str, bytes: &[u8]) -> Result<(), String> {
    let v = FileVersion::of(bytes);
    journal::intent(ctx.host, ctx.job, path, v.size, &v.hash).map_err(|e| e.to_string())?;
    let staged = ctx.host.stage_new(path, &journal::temp_tag(ctx.job), &mut std::io::Cursor::new(bytes.to_vec())).map_err(|e| format!("{e:?}"))?;
    journal::temp(ctx.host, ctx.job, path, staged.file_id).map_err(|e| e.to_string())?;
    match ctx.host.commit_new(staged) {
        Ok(_) => journal::created(ctx.host, ctx.job, path).map_err(|e| e.to_string()),
        Err(e) => {
            journal::not_created(ctx.host, ctx.job, path).map_err(|e| e.to_string())?;
            Err(format!("{path}: {e:?}"))
        }
    }
}
const NOTE: &[u8] = "---\nid: 01JB5V00000000000000000001\ntype: page\ntitle: Dovezená\n---\nPříliš žluťoučký kůň.\n".as_bytes();

#[test]
fn an_import_runs_through_planning_backup_and_writing_and_leaves_no_journal() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let events = core.events();
    let mut job = fake();
    job.write = Box::new(|ctx| {
        journal::begin(ctx.host, ctx.job, "PKM", "export.zip", 2, None).map_err(|e| e.to_string())?;
        assert!(!ctx.host.dir_exists("Books/Nové"), "setup: the folder is new");
        journal::dir(ctx.host, ctx.job, "Books/Nové").map_err(|e| e.to_string())?;
        ctx.host.create_dir("Books/Nové").map_err(|e| format!("{e:?}"))?;
        create(ctx, "Books/Nové/Dovezená.md", NOTE)?;
        ctx.step(1);
        if !ctx.host.dir_exists("_attachments") {
            journal::dir(ctx.host, ctx.job, "_attachments").map_err(|e| e.to_string())?;
            ctx.host.create_dir("_attachments").map_err(|e| format!("{e:?}"))?;
        }
        create(ctx, "_attachments/obrázek.png", b"\x89PNG")?;
        ctx.step(2);
        Ok(())
    });
    let job = Arc::new(job);
    let id = core.jobs().start_import(job.clone()).expect("start");
    let report = core.jobs().wait(id, Duration::from_secs(30)).expect("report");
    assert_eq!((report.kind, report.phase, report.error.clone()), (JobKind::Import, Phase::Done, None));
    assert_eq!(job.calls(), ["prepare", "needs_backup", "before_backup", "after_backup 20261112-090000-import.zip", "write", "finished done -"]);
    assert_eq!(zips(&sb), ["20261112-090000-import.zip"], "the zip's time is the job's, in UTC");
    assert_eq!(read_bytes(&root, "Books/Nové/Dovezená.md").as_deref(), Some(NOTE));
    assert_eq!(temp_files(&root), Vec::<String>::new());
    assert_eq!(journal_files(&sb), Vec::<String>::new(), "a finished import has no journal");
    assert!(core.jobs().interrupted().is_empty());
    // The created note is indexed, and every job event names the kind; phases in order, a final event with done == total.
    assert!(core.wait_idle(Duration::from_secs(10)));
    assert!(core.resolve_links("Pages/Alfa.md", &["Dovezená".to_string()]).first().is_some_and(|l| l.path.as_deref() == Some("Books/Nové/Dovezená.md")), "the index knows the created note");
    let mut phases: Vec<(Phase, usize, usize)> = Vec::new();
    let mut changed: Vec<String> = Vec::new();
    while let Ok(e) = events.try_recv() {
        match e {
            tegg_core::CoreEvent::JobProgress(p) if p.job == id => {
                assert_eq!(p.kind.as_str(), "import");
                phases.push((p.phase, p.done, p.total));
            }
            tegg_core::CoreEvent::VaultChanged { paths } => changed.extend(paths),
            _ => {}
        }
    }
    let mut order: Vec<Phase> = phases.iter().map(|p| p.0).collect();
    order.dedup();
    assert_eq!(order, [Phase::Queued, Phase::Planning, Phase::Backup, Phase::Writing, Phase::Done]);
    assert_eq!(phases.last(), Some(&(Phase::Done, 2, 2)));
    assert!(changed.contains(&"Books/Nové/Dovezená.md".to_string()) && changed.contains(&"_attachments/obrázek.png".to_string()), "vault:changed after each committed create: {changed:?}");

    // A second import in the same clock second takes the next free second; no backup when the job says so.
    let second = Arc::new(fake());
    let id2 = core.jobs().start_import(second.clone()).expect("start");
    assert!(id2 > id);
    assert_eq!(core.jobs().wait(id2, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Done));
    assert_eq!(zips(&sb), ["20261112-090000-import.zip", "20261112-090001-import.zip"]);
    let mut none = fake();
    none.backup = false;
    let none = Arc::new(none);
    let id3 = core.jobs().start_import(none.clone()).expect("start");
    assert_eq!(core.jobs().wait(id3, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Done));
    assert_eq!(none.calls(), ["prepare", "needs_backup", "write", "finished done -"]);
    assert_eq!(zips(&sb).len(), 2);
}

#[test]
fn a_failed_prepare_or_backup_writes_nothing_and_a_failed_write_keeps_its_journal_for_the_job_to_resolve() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let before = snapshot(&root);
    let mut job = fake();
    job.prepare = Box::new(|_| Err("SourceChanged".into()));
    let job = Arc::new(job);
    let id = core.jobs().start_import(job.clone()).expect("start");
    let r = core.jobs().wait(id, Duration::from_secs(30)).expect("report");
    assert_eq!((r.phase, r.error.as_deref()), (Phase::Failed, Some("SourceChanged")));
    assert_eq!(job.calls(), ["prepare", "finished failed SourceChanged"]);
    assert_eq!((zips(&sb), snapshot(&root) == before), (Vec::new(), true));

    // The backup folder is a file: BackupFailed, `write` never called.
    std::fs::write(sb.dirs.root.join("backups"), b"a file").expect("setup");
    let job = Arc::new(fake());
    let id = core.jobs().start_import(job.clone()).expect("start");
    let r = core.jobs().wait(id, Duration::from_secs(30)).expect("report");
    assert!(r.phase == Phase::Failed && r.error.as_deref().is_some_and(|e| e.starts_with("BackupFailed: ")), "{r:?}");
    assert!(!job.calls().contains(&"write".to_string()) && snapshot(&root) == before);
    std::fs::remove_file(sb.dirs.root.join("backups")).expect("setup");

    // A write that fails after its own roll-back: the engine reports `failed`; the job removed its journal.
    let mut job = fake();
    job.backup = false;
    job.write = Box::new(|ctx| {
        journal::begin(ctx.host, ctx.job, "PKM", "export.zip", 2, None).map_err(|e| e.to_string())?;
        create(ctx, "Pages/Dovezená.md", NOTE)?;
        let e = create(ctx, "Pages/Alfa.md", b"import").expect_err("Alfa exists");
        let kept = journal::roll_back(ctx.host, ctx.job);
        journal::finish(ctx.host, ctx.job);
        assert_eq!(kept, Vec::<String>::new());
        Err(format!("FileAppeared: {e}"))
    });
    let id = core.jobs().start_import(Arc::new(job)).expect("start");
    let r = core.jobs().wait(id, Duration::from_secs(30)).expect("report");
    assert!(r.phase == Phase::Failed && r.error.as_deref().is_some_and(|e| e.starts_with("FileAppeared: Pages/Alfa.md")), "{r:?}");
    assert!(snapshot(&root) == before, "the created note is removed again, Alfa (with its `N` line) is untouched: same bytes, mtime and inode");
    assert_eq!(journal_files(&sb), Vec::<String>::new());
}

#[test]
fn cancel_in_queued_planning_and_backup_and_not_in_writing() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let before = snapshot(&root);
    let hold = |flag: &Arc<AtomicBool>, go: &Arc<AtomicBool>| -> Step {
        let (f, g) = (flag.clone(), go.clone());
        Box::new(move |_| {
            f.store(true, Ordering::SeqCst);
            wait_until(Duration::from_secs(30), || g.load(Ordering::SeqCst));
            Ok(())
        })
    };

    // Queued: a second import waits behind the first, leaves the queue at once and never reaches `prepare`.
    let (held, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let mut first = fake();
    first.backup = false;
    first.prepare = hold(&held, &go);
    let first_id = core.jobs().start_import(Arc::new(first)).expect("start");
    assert!(wait_until(Duration::from_secs(30), || held.load(Ordering::SeqCst)));
    let second = Arc::new(fake());
    let second_id = core.jobs().start_import(second.clone()).expect("start");
    assert!(core.jobs().report(second_id).is_none());
    assert!(matches!(core.jobs().cancel(second_id), Ok(())));
    let r = core.jobs().report(second_id).expect("the report is there when cancel returns");
    assert_eq!((r.phase, r.kind), (Phase::Cancelled, JobKind::Import));
    assert_eq!(second.calls(), ["finished cancelled -"], "finished exactly once, nothing else");
    assert!(matches!(core.jobs().cancel(second_id), Err(JobError::NotCancellable)), "a finished job can't be cancelled");
    go.store(true, Ordering::SeqCst);
    assert_eq!(core.jobs().wait(first_id, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Done));
    assert_eq!(second.calls(), ["finished cancelled -"]);

    // Planning: a cancel during `prepare` ends the job after it, with no backup.
    let (held, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let mut job = fake();
    let (f, g) = (held.clone(), go.clone());
    job.prepare = Box::new(move |ctx| {
        f.store(true, Ordering::SeqCst);
        wait_until(Duration::from_secs(30), || g.load(Ordering::SeqCst));
        assert!(ctx.cancelled(), "the job sees the cancel");
        Ok(())
    });
    let job = Arc::new(job);
    let id = core.jobs().start_import(job.clone()).expect("start");
    assert!(wait_until(Duration::from_secs(30), || held.load(Ordering::SeqCst)));
    assert!(matches!(core.jobs().cancel(id), Ok(())));
    go.store(true, Ordering::SeqCst);
    assert_eq!(core.jobs().wait(id, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Cancelled));
    assert_eq!(job.calls(), ["prepare", "finished cancelled -"]);

    // Before the zip (still `planning`) and after it (`backup`): cancelled, and no zip is left.
    for at in ["before", "after"] {
        let (held, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
        let mut job = fake();
        if at == "before" {
            job.before_backup = hold(&held, &go);
        } else {
            job.after_backup = hold(&held, &go);
        }
        let job = Arc::new(job);
        let id = core.jobs().start_import(job.clone()).expect("start");
        assert!(wait_until(Duration::from_secs(30), || held.load(Ordering::SeqCst)));
        assert_eq!(zips(&sb).len(), usize::from(at == "after"), "{at}");
        assert!(matches!(core.jobs().cancel(id), Ok(())), "{at}");
        go.store(true, Ordering::SeqCst);
        assert_eq!(core.jobs().wait(id, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Cancelled), "{at}");
        assert_eq!(zips(&sb), Vec::<String>::new(), "{at}: no zip, whole or partial, is left");
        assert!(!job.calls().contains(&"write".to_string()), "{at}");
    }

    // Writing: NotCancellable, and the import finishes.
    let (held, go) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let mut job = fake();
    job.backup = false;
    job.write = hold(&held, &go);
    let id = core.jobs().start_import(Arc::new(job)).expect("start");
    assert!(wait_until(Duration::from_secs(30), || held.load(Ordering::SeqCst)));
    assert!(matches!(core.jobs().cancel(id), Err(JobError::NotCancellable)));
    go.store(true, Ordering::SeqCst);
    assert_eq!(core.jobs().wait(id, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Done));
    assert!(snapshot(&root) == before, "none of these jobs wrote a vault file");
}

// ------------------------------------------------------------------------------------------------ the roll-back from a log

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn c_line(path: &str, bytes: &[u8]) -> String {
    let v = FileVersion::of(bytes);
    format!("C\t{path}\t{}\t{}\n", v.size, hex(&v.hash))
}
fn ino(root: &Path, rel: &str) -> u64 {
    std::fs::metadata(root.join(rel)).expect("setup: metadata").ino()
}
/// Writes job 7's journal by hand, as a killed run would have left it.
fn leave_journal(sb: &Sandbox, core: &Core, log: &str) {
    let key = core.jobs().backup_dir().and_then(|d| d.file_name().map(|n| n.to_string_lossy().into_owned())).expect("setup: vault key");
    let dir = sb.dirs.root.join("jobs").join(key);
    std::fs::create_dir_all(&dir).expect("setup");
    std::fs::write(dir.join("7.json"), br#"{"job":7,"kind":"import","title":"PKM","source":"export.zip","total":9,"backup":null}"#).expect("setup");
    std::fs::write(dir.join("7.log"), log).expect("setup");
}

#[test]
fn undo_after_a_kill_removes_only_what_the_log_proves_the_run_created() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let page_yml = ".tegg/types/page.yml";
    let task_yml = ".tegg/types/task.yml";
    let tag_yml = ".tegg/types/tag.yml";
    let pre = read_bytes(&root, page_yml).expect("setup");
    let post = [pre.as_slice(), b"# extended by the import\n"].concat();
    let task_pre = read_bytes(&root, task_yml).expect("setup");
    let tag_pre = read_bytes(&root, tag_yml).expect("setup");
    let r_line = |path: &str, post: &[u8], pre: &[u8]| {
        let (a, b) = (FileVersion::of(post), FileVersion::of(pre));
        format!("R\t{path}\t{}\t{}\t{}\t{}\t{}\n", a.size, hex(&a.hash), b.size, hex(&b.hash), hex(pre))
    };
    let before = snapshot(&root);

    // What the "run" left on disk.
    write_raw(&root, page_yml, &post); // R: replaced, still the post version → restored
    write_raw(&root, tag_yml, b"name: Tag\n# edited by the user after the import\n"); // R: neither pre nor post → kept
    write_raw(&root, ".tegg/types/.page.yml.tegg-tmp", b"left by the kill"); // R's temp file
    write_raw(&root, "Books/Nové/K.md", b"created");
    write_raw(&root, "Books/Nové/Změněná.md", "created, then edited by the user\n".as_bytes());
    write_raw(&root, "Books/Nové/T.md", b"renamed, K line lost");
    write_raw(&root, "Books/Nové/Cizí.md", b"same bytes");
    write_raw(&root, "Books/Nové/N.md", b"arrived");
    write_raw(&root, "Books/Nové/JenC.md", b"intent only");
    write_raw(&root, "Books/Nové/.Nedopsaná.md.i7.tegg-tmp", b"half");
    write_raw(&root, "Books/Nové/.Nedopsaná.md.i8.tegg-tmp", b"another run's");
    write_raw(&root, "Books/Jiné/Zůstane.md", b"created");
    write_raw(&root, "Books/Jiné/Uživatelův.md", b"the user's, put there meanwhile");
    write_raw(&root, ".trash/Books/Nové/Koš.md", b"created");
    let after_kill = snapshot(&root);

    let log = [
        r_line(page_yml, &post, &pre),
        r_line(task_yml, &[task_pre.as_slice(), b"# x\n"].concat(), &task_pre), // the replace never happened → nothing to do
        r_line(tag_yml, &[tag_pre.as_slice(), b"# x\n"].concat(), &tag_pre),
        "D\tBooks/Nové\n".into(),
        "D\tBooks/Jiné\n".into(),
        "D\tBooks/Prázdná a pryč\n".into(),
        c_line("Books/Nové/K.md", b"created"),
        format!("T\tBooks/Nové/K.md\t{}\n", 1),
        "K\tBooks/Nové/K.md\n".into(),
        c_line("Books/Nové/Změněná.md", b"created"),
        "K\tBooks/Nové/Změněná.md\n".into(),
        c_line("Books/Nové/T.md", b"renamed, K line lost"),
        format!("T\tBooks/Nové/T.md\t{}\n", ino(&root, "Books/Nové/T.md")),
        // A byte-identical file that arrived at the planned path: another file id, so not the run's.
        c_line("Books/Nové/Cizí.md", b"same bytes"),
        format!("T\tBooks/Nové/Cizí.md\t{}\n", ino(&root, "Books/Nové/Cizí.md") + 1),
        // `N`: never touched, even with the logged bytes and the logged id.
        c_line("Books/Nové/N.md", b"arrived"),
        format!("T\tBooks/Nové/N.md\t{}\n", ino(&root, "Books/Nové/N.md")),
        "N\tBooks/Nové/N.md\n".into(),
        c_line("Books/Nové/JenC.md", b"intent only"),
        c_line("Books/Nové/Nedopsaná.md", b"half and more"),
        c_line("Books/Jiné/Zůstane.md", b"created"),
        "K\tBooks/Jiné/Zůstane.md\n".into(),
        // Created, then moved to `.trash/` by the owner: absent at its path; the roll-back never looks in `.trash/`.
        c_line("Books/Nové/Koš.md", b"created"),
        "K\tBooks/Nové/Koš.md\n".into(),
        // A torn last line.
        "K\tBooks/Nové/JenC.md".into(),
    ]
    .concat();
    drop(core);
    leave_journal(&sb, &open_core(&root, &sb.dirs, false).expect("setup"), &log);

    // The next open lists it, with Undo only.
    let core = open_core(&root, &sb.dirs, false).expect("open");
    let list = core.jobs().interrupted();
    assert_eq!(list.iter().map(|i| (i.job, i.kind.as_str(), i.title.as_deref(), i.from.as_str(), i.to.as_str(), i.done, i.total)).collect::<Vec<_>>(), [(7, "import", Some("PKM"), "export.zip", "", 4, 9)]);
    assert!(matches!(core.jobs().resolve_interrupted(7, ResolveChoice::Finish), Err(JobError::NotImplemented)));
    assert!(snapshot(&root) == after_kill, "Finish changed nothing");
    assert_eq!(journal_files(&sb).len(), 2, "and the journal is still there");
    // A new job never takes the journal's id.
    let later = core.jobs().start_import(Arc::new(fake())).expect("start");
    assert!(later > 7);
    assert_eq!(core.jobs().wait(later, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Done));
    let zips_before = zips(&sb);

    assert!(matches!(core.jobs().resolve_interrupted(7, ResolveChoice::Undo), Ok(7)));
    let after = snapshot(&root);
    let left: Vec<String> = after.keys().filter(|k| !before.contains_key(*k)).cloned().collect();
    assert_eq!(
        left,
        [
            ".trash/Books/",
            ".trash/Books/Nové/",
            ".trash/Books/Nové/Koš.md",
            "Books/Jiné/",
            "Books/Jiné/Uživatelův.md",
            "Books/Nové/",
            "Books/Nové/.Nedopsaná.md.i8.tegg-tmp",
            "Books/Nové/Cizí.md",
            "Books/Nové/JenC.md",
            "Books/Nové/N.md",
            "Books/Nové/Změněná.md",
        ],
        "removed: K.md (K, unchanged), T.md (T with the file's id), Zůstane.md, the run's temp files; everything else stays"
    );
    for kept in [".trash/Books/Nové/Koš.md", "Books/Jiné/Uživatelův.md", "Books/Nové/Cizí.md", "Books/Nové/JenC.md", "Books/Nové/N.md", "Books/Nové/Změněná.md", "Books/Nové/.Nedopsaná.md.i8.tegg-tmp"] {
        assert!(after.get(kept) == after_kill.get(kept), "{kept}: untouched (bytes, mtime, inode)");
    }
    assert_eq!(read_bytes(&root, page_yml), Some(pre.clone()), "the extended type file has its bytes from before");
    assert!(after.get(task_yml) == before.get(task_yml), "a type file that still holds the pre bytes is not written");
    assert_eq!(read_bytes(&root, tag_yml).as_deref(), Some(&b"name: Tag\n# edited by the user after the import\n"[..]), "a type file that is neither version is kept");
    assert!(!root.join(".tegg/types/.page.yml.tegg-tmp").exists(), "the replace's temp file is removed whatever its age");
    assert_eq!(journal_files(&sb), Vec::<String>::new(), "both journal files are gone");
    assert!(core.jobs().interrupted().is_empty());
    assert_eq!(zips(&sb), zips_before, "the backup zips stay");
    assert!(matches!(core.jobs().resolve_interrupted(7, ResolveChoice::Undo), Err(JobError::NotFound)));
}

#[test]
fn roll_back_in_process_lists_a_changed_file_as_kept_and_restores_the_type_file() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let page_yml = ".tegg/types/page.yml";
    let pre = read_bytes(&root, page_yml).expect("setup");
    let kept: Arc<Mutex<Vec<String>>> = Arc::default();
    let hooked = Arc::new(AtomicUsize::new(0));
    let (k, r, h, p) = (kept.clone(), root.clone(), hooked.clone(), pre.clone());
    let mut job = fake();
    job.backup = false;
    job.write = Box::new(move |ctx| {
        journal::begin(ctx.host, ctx.job, "PKM", "export.zip", 3, None).map_err(|e| e.to_string())?;
        // The extended type file: `R`, then the base-checked write with the per-call hook.
        let (bytes, base) = ctx.host.read(".tegg/types/page.yml").map_err(|e| format!("{e:?}"))?;
        assert_eq!(bytes, p);
        let post = [bytes.as_slice(), b"# extended\n"].concat();
        journal::replace_intent(ctx.host, ctx.job, ".tegg/types/page.yml", &FileVersion::of(&post), &base, &bytes).map_err(|e| e.to_string())?;
        let wrote = ctx.host.write_hooked(".tegg/types/page.yml", &post, &base, &|| {
            h.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        assert!(matches!(wrote, Ok(tegg_jobs::host::Wrote::Written(_))), "{wrote:?}");
        create(ctx, "Pages/První.md", NOTE)?;
        create(ctx, "Pages/Druhá.md", NOTE)?;
        // The user edits the first one; then a create fails.
        std::fs::write(r.join("Pages/První.md"), "upraveno uživatelem\n").expect("setup");
        let e = create(ctx, "Pages/Alfa.md", NOTE).expect_err("taken");
        *k.lock().unwrap_or_else(|x| x.into_inner()) = journal::roll_back(ctx.host, ctx.job);
        journal::finish(ctx.host, ctx.job);
        Err(e)
    });
    let before = snapshot(&root);
    let id = core.jobs().start_import(Arc::new(job)).expect("start");
    assert_eq!(core.jobs().wait(id, Duration::from_secs(30)).map(|r| r.phase), Some(Phase::Failed));
    assert_eq!(hooked.load(Ordering::SeqCst), 1);
    assert_eq!(kept.lock().unwrap_or_else(|x| x.into_inner()).clone(), ["Pages/První.md"]);
    let after = snapshot(&root);
    assert_eq!(after.keys().filter(|k| !before.contains_key(*k)).cloned().collect::<Vec<_>>(), ["Pages/První.md"]);
    assert_eq!(read_bytes(&root, page_yml), Some(pre));
    assert_eq!(read_text(&root, "Pages/První.md").as_deref(), Some("upraveno uživatelem\n"));
    assert!(after.get("Pages/Alfa.md") == before.get("Pages/Alfa.md"));
    assert_eq!((temp_files(&root), journal_files(&sb)), (Vec::new(), Vec::new()));
}

#[test]
fn a_panic_in_the_job_leaves_the_journal_and_no_report() {
    let sb = sandbox();
    let (root, core) = vault(&sb);
    let mut job = fake();
    job.backup = false;
    job.write = Box::new(|ctx| {
        journal::begin(ctx.host, ctx.job, "PKM", "export.zip", 2, None).map_err(|e| e.to_string())?;
        create(ctx, "Pages/Dovezená.md", NOTE)?;
        panic!("simulated kill after the first file");
    });
    let job = Arc::new(job);
    let id = core.jobs().start_import(job.clone()).expect("start");
    assert!(wait_until(Duration::from_secs(30), || job.calls().contains(&"write".to_string()) && root.join("Pages/Dovezená.md").exists()));
    assert!(core.jobs().wait(id, Duration::from_millis(500)).is_none(), "a killed run never reports");
    assert!(!job.calls().iter().any(|c| c.starts_with("finished")));
    assert_eq!(journal_files(&sb).len(), 2);
    drop(core);
    let core = open_core(&root, &sb.dirs, false).expect("reopen");
    assert_eq!(core.jobs().interrupted().iter().map(|i| (i.job, i.done, i.total)).collect::<Vec<_>>(), [(id, 1, 2)]);
    assert!(core.jobs().resolve_interrupted(id, ResolveChoice::Undo).is_ok());
    assert!(!root.join("Pages/Dovezená.md").exists() && journal_files(&sb).is_empty());
}
