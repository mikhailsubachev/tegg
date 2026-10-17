//! Regression tests for the QA review of PR #45 (slice 4C): data safety of the rename engine. Named
//! `bug_45_<req-id>_…` (CLAUDE.md "Testing"); each failed before its fix.
//!
//! A "crash" is simulated by a job-point hook that panics on the job thread: the job stops mid-way and its journal
//! stays on disk, as after a SIGKILL; a second core opened on the same vault and Application Support then sees it.

#[macro_use]
mod common;

use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use tegg_core::CoreEvent;
use tegg_format::nfc;
use tegg_jobs::testing::NodeTransformer;
use tegg_jobs::{JobOp, JobPoint, Phase, ResolveChoice, RetryOutcome, SkipReason, TextOp, TransformError, Transformed, Transformer};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

/// The app's transformer path: the UI receives the text decoded lossily (`String::from_utf8_lossy`) and answers with
/// UTF-8 bytes, so invalid bytes would come back as U+FFFD.
struct LossyTransformer(NodeTransformer);
impl Transformer for LossyTransformer {
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError> {
        self.0.transform(source, String::from_utf8_lossy(bytes).as_bytes(), ops)
    }
}

/// A hook that panics at the `n`-th `AfterRead` point (1-based) of any job: the job thread dies there.
fn crash_at_read(core: &tegg_core::Core, n: usize) {
    let count = Arc::new(AtomicUsize::new(0));
    core.jobs().set_point_hook(Some(Arc::new(move |_, p: &JobPoint| {
        if matches!(p, JobPoint::AfterRead { .. }) && count.fetch_add(1, Ordering::SeqCst) + 1 == n {
            panic!("simulated crash at read {n}");
        }
    })));
}

/// Waits until the vault stops changing for 300 ms (the crashed job wrote what it wrote).
fn settle() {
    std::thread::sleep(Duration::from_millis(600));
}

// ------------------------------------------------------------------------------------------------ blocker 1

#[test]
fn bug_45_nfr_rel_03_non_utf8_linking_file_is_skipped_never_rewritten() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    // A linking file with invalid UTF-8 after its link (D-180: such a file is never written).
    let mut bad = b"---\nid: 01JB4C0000000000000000B451\ntype: page\ntitle: Rozbit\xC3\xBD\n---\nOdkaz [[Alfa]] a bajty \xFF\xFE konec.\n".to_vec();
    bad.extend_from_slice(b"");
    write_raw(&root, "Pages/Rozbitý.md", &bad);
    let core = ok!(tegg_core::Core::open(&root, &sb.dirs, tegg_core::CoreOptions { watch: false, sync: None }), "open");
    assert!(core.wait_idle(Duration::from_secs(60)), "setup: indexed");
    let t = ok!(NodeTransformer::from_repo(&repo_root()), "transformer");
    core.jobs().set_transformer(Arc::new(LossyTransformer(t)));
    let (_, report) = ok!(rename(&core, ALFA, "Gama"), "rename");
    assert_eq!(read_bytes(&root, "Pages/Rozbitý.md"), Some(bad), "the non-UTF-8 file keeps every byte");
    assert!(
        report.skipped.iter().any(|s| nfc(&s.path) == "Pages/Rozbitý.md" && s.reason == SkipReason::ReadOnly),
        "listed as skipped, read-only: {report:?}"
    );
}

// ------------------------------------------------------------------------------------------------ blocker 2, majors of the journal

/// Renames Alfa → Gama on `root` and crashes the job at its `n`-th read; returns after the job thread died.
fn crashed_rename(root: &Path, dirs: &tegg_vault::AppDirs, n: usize) {
    let core = ok!(open_core(root, dirs, false), "open");
    crash_at_read(&core, n);
    let _ = core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() });
    settle();
}

#[test]
fn bug_45_nfr_rel_02_interrupted_undo_keeps_edits_made_after_the_crash() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    // Reads: 1 = the note, 2 = Books/Vlastnosti.md, 3 = Daily/2026-10-14.md (path order) → crash before Den.
    crashed_rename(&root, &sb.dirs, 3);
    assert!(root.join(GAMA).exists(), "setup: the note was renamed before the crash");
    // After the crash, before the reopen, another app edits Vlastnosti (which the job had rewritten).
    let edited = format!("{}Upraveno v jiné aplikaci.\n", read_text(&root, VLASTNOSTI).unwrap_or_default());
    write_raw(&root, VLASTNOSTI, edited.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted rename: {i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Undo), "Undo");
    assert_eq!(read_text(&root, VLASTNOSTI), Some(edited), "the edit made after the crash is never overwritten");
    assert_eq!(read_text(&root, ALFA), Some(fixture_text(ALFA)), "the note is back with its pre-rename bytes");
}

#[test]
fn bug_45_fr_lnk_03_ac17_finish_before_the_note_was_renamed_keeps_every_link_resolving() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    crashed_rename(&root, &sb.dirs, 1); // crash at the note's own read: nothing written, the note not renamed
    assert!(root.join(ALFA).exists() && !root.join(GAMA).exists(), "setup: not renamed");
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let i = core.jobs().interrupted();
    assert_eq!(i.len(), 1, "one interrupted rename: {i:?}");
    ok!(core.jobs().resolve_interrupted(i[0].job, ResolveChoice::Finish), "Finish");
    assert!(core.wait_idle(Duration::from_secs(30)), "indexed");
    // Wherever the note is now, Odkazy's [[…]] link resolves to it.
    let note = if root.join(GAMA).exists() { GAMA } else { ALFA };
    let odkazy = read_text(&root, ODKAZY).unwrap_or_default();
    let target = if note == GAMA { "Gama" } else { "Alfa" };
    assert!(odkazy.contains(&format!("\n[[{target}]]\n")), "Odkazy links to the note where it is ({note}): {odkazy}");
    let r = core.resolve_links(ODKAZY, &[target.to_string()]);
    assert_eq!(r.first().and_then(|x| x.path.clone()).map(|p| nfc(&p)), Some(note.to_string()), "and the link resolves");
}

#[test]
fn bug_45_d387_a_new_job_after_a_restart_never_overwrites_an_unresolved_journal() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    crashed_rename(&root, &sb.dirs, 3);
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    let before = core.jobs().interrupted();
    assert_eq!(before.len(), 1, "setup: one interrupted rename");
    // A new rename (of another note) in the new session.
    ok!(rename(&core, BETA, "Béta"), "another rename");
    let after = core.jobs().interrupted();
    assert_eq!(after, before, "the unresolved journal is still there, unchanged");
    ok!(core.jobs().resolve_interrupted(before[0].job, ResolveChoice::Undo), "and it can still be resolved");
}

#[test]
fn bug_45_d387_an_interrupted_undo_is_journaled_too() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    {
        let core = ok!(open_core(&root, &sb.dirs, false), "open");
        let (job, _) = ok!(rename(&core, ALFA, "Gama"), "rename");
        crash_at_read(&core, 3);
        let _ = core.jobs().start(JobOp::Undo { job });
        settle();
    }
    let core = ok!(open_core(&root, &sb.dirs, false), "reopen");
    assert_eq!(core.jobs().interrupted().len(), 1, "the undo left a journal");
}

// ------------------------------------------------------------------------------------------------ case-only rename

/// LocalFs whose renames fail (a full disk, a sync lock): nothing may be lost.
struct NoRenameFs(LocalFs);
impl VaultFs for NoRenameFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.0.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.0.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.0.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.0.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.0.create_new(path, bytes)
    }
    fn rename_no_replace(&self, _from: &str, _to: &str) -> io::Result<()> {
        Err(io::Error::other("simulated rename failure"))
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.0.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.0.remove_file(path)
    }
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        self.0.stat(path)
    }
}

#[test]
fn bug_45_fr_syn_02_case_only_rename_never_leaves_the_note_only_in_a_temp_file() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let t = fixture_text(ALFA).replace("title: Alfa", "title: alfa");
    std::fs::remove_file(root.join(ALFA)).expect("setup");
    write_raw(&root, "Pages/alfa.md", t.as_bytes());
    let core = ok!(open_core_with(Arc::new(NoRenameFs(LocalFs::new(&root))), &sb.dirs), "open");
    let _ = rename(&core, "Pages/alfa.md", "Alfa");
    let names: Vec<String> = std::fs::read_dir(root.join("Pages")).expect("list").map(|e| nfc(&e.expect("e").file_name().to_string_lossy())).collect();
    let note = names.iter().find(|n| n.eq_ignore_ascii_case("alfa.md"));
    assert!(note.is_some(), "the note still exists under its name (not only as a temp file): {names:?}");
    let text = read_text(&root, &format!("Pages/{}", note.unwrap_or(&String::new()))).unwrap_or_default();
    assert!(text.contains("\n## Úvod\n"), "with its body: {text}");
}

// ------------------------------------------------------------------------------------------------ undo of a note written through its editor

#[test]
fn bug_45_fr_lnk_03_ac14_undo_reverts_a_note_rewritten_through_its_editor() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = Arc::new(ok!(open_core(&root, &sb.dirs, false), "open"));
    let (disk, base) = ok!(core.read_note(ODKAZY, std::time::SystemTime::now()), "read Odkazy");
    let live = format!("{}Neuložený text.\n", String::from_utf8_lossy(&disk));
    core.jobs().editor_open(ODKAZY);
    let events = core.events();
    let job = ok!(core.jobs().start(JobOp::NoteRename { path: ALFA.into(), title: "Gama".into() }), "start");
    let engine = ok!(NodeTransformer::from_repo(&repo_root()), "engine");
    let end = Instant::now() + Duration::from_secs(30);
    let mut saved = false;
    while Instant::now() < end && !saved {
        match events.recv_timeout(Duration::from_millis(200)) {
            Ok(CoreEvent::JobTransform { source, ops, live: true, .. }) if nfc(&source) == ODKAZY => {
                let Ok(Transformed::Bytes(b, _)) = engine.transform(ODKAZY, live.as_bytes(), &ops) else { panic!("setup: live transform") };
                ok!(core.write_note(ODKAZY, &b, Some(&base)), "the editor saves");
                saved = true;
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(saved, "setup: Odkazy saved through its editor");
    some!(core.jobs().wait(job, Duration::from_secs(30)), "rename report");
    core.jobs().editor_close(ODKAZY);
    let (_, undo) = ok!(run_job(&core, JobOp::Undo { job }), "undo");
    assert_eq!(undo.phase, Phase::Done, "{undo:?}");
    assert_eq!(
        read_text(&root, ODKAZY),
        Some(format!("{}Neuložený text.\n", fixture_text(ODKAZY))),
        "Odkazy links to Alfa again and keeps the text the user saved"
    );
}

// ------------------------------------------------------------------------------------------------ retry

#[test]
fn bug_45_d385_retry_after_an_undo_reverses_the_link() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, _) = ok!(rename(&core, ALFA, "Gama"), "rename");
    let edited = format!("{}Externí změna.\n", odkazy_after_gama());
    write_raw(&root, ODKAZY, edited.as_bytes());
    let (undo, report) = ok!(run_job(&core, JobOp::Undo { job }), "undo");
    assert!(report.skipped.iter().any(|s| nfc(&s.path) == ODKAZY), "setup: Odkazy skipped: {report:?}");
    let out = ok!(core.jobs().retry(undo, ODKAZY), "Retry");
    assert_eq!(out, RetryOutcome::Written, "the retry writes");
    assert_eq!(read_text(&root, ODKAZY), Some(format!("{}Externí změna.\n", fixture_text(ODKAZY))), "links back to Alfa, the external edit kept");
}

#[test]
fn bug_45_fr_fmt_08_retry_never_writes_the_renamed_note_in_place() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    let root = rename_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    // The note's folder can't be written: its rename fails and the note is skipped.
    std::fs::set_permissions(root.join("Pages"), std::fs::Permissions::from_mode(0o555)).expect("setup: read-only Pages");
    let r = rename(&core, ALFA, "Gama");
    std::fs::set_permissions(root.join("Pages"), std::fs::Permissions::from_mode(0o755)).expect("setup: writable again");
    let (job, report) = ok!(r, "rename");
    assert!(report.skipped.iter().any(|s| nfc(&s.path) == ALFA), "setup: the note was skipped: {report:?}");
    let _ = core.jobs().retry(job, ALFA);
    let t = read_text(&root, ALFA).unwrap_or_default();
    assert!(t.contains("\ntitle: Alfa\n") && t.contains("[[Alfa#Úvod]]"), "the old file never gets the new title or a link to a missing note: {t}");
    assert!(!root.join(GAMA).exists(), "no half rename");
}

// ------------------------------------------------------------------------------------------------ note without frontmatter

#[test]
fn bug_45_fr_fmt_08_a_note_without_frontmatter_is_renamed() {
    let sb = sandbox();
    let root = rename_vault(&sb);
    write_raw(&root, "Pages/Holá.md", "Jen text, žádná hlavička.\n".as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, report) = ok!(rename(&core, "Pages/Holá.md", "Oblečená"), "rename");
    assert_eq!(report.renamed, Some(("Pages/Holá.md".to_string(), "Pages/Oblečená.md".to_string())), "{report:?}");
    let t = read_text(&root, "Pages/Oblečená.md").unwrap_or_default();
    assert!(t.starts_with("---\n") && t.contains("\ntitle: Oblečená\n") && t.ends_with("Jen text, žádná hlavička.\n"), "frontmatter added with the title, body kept: {t}");
}
