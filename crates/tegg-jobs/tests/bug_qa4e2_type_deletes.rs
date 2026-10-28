//! QA review of 4E-2 (qa/reviews/4e-2-type-deletes.md): Undo of a property delete restores a note that was opened after
//! the job (M1: value-remove rows are byte rows, ms4-jobs §14.9.4), and Redo of a type delete never trashes a file the
//! Undo skipped or one changed since (m1).

#[macro_use]
mod common;
mod moves_setup;
mod tags_setup;

use common::{open_core, read_bytes, read_text, sandbox, write_raw};
use moves_setup::*;
use tags_setup::run_confirmed;
use tegg_jobs::{JobOp, Phase, SkipReason};

#[test]
fn bug_qa4e2_major1_fr_typ_04_ac8_undo_restores_a_note_opened_after_the_job() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, r) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "kniha".into(), key: "poznámka".into() }), "value-remove");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    core.jobs().editor_open(DUNA); // the user opens Duna, then runs `Undo delete property` from the palette
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert!(u.skipped.is_empty(), "nothing skipped: {u:?}");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna has its exact pre-job bytes");
    let (_, d) = ok!(common::run_job(&core, JobOp::Redo { job }), "Redo");
    assert!(d.skipped.is_empty(), "nothing skipped on Redo: {d:?}");
    assert!(read_text(&root, DUNA).is_some_and(|t| !t.contains("poznámka: ")), "Redo removes the line again");
}

#[test]
fn bug_qa4e2_minor1_fr_typ_05_ac8_redo_never_trashes_a_file_the_undo_skipped() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (job, r) = ok!(run_confirmed(&core, JobOp::TypeDelete { r#type: "schůzka".into() }), "type-delete");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    let novy = "---\nid: 01JB4E0000000000000000E0B9\ntype: page\ntitle: Porada\n---\nJiná porada.\n";
    write_raw(&root, PORADA, novy.as_bytes());
    core.notify_changed(&[PORADA.to_string()]);
    assert!(core.wait_idle(std::time::Duration::from_secs(10)), "setup: index idle");
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert!(u.skipped.iter().any(|s| s.path == PORADA && s.reason == SkipReason::Taken), "Porada's place is taken: {u:?}");
    let (_, d) = ok!(common::run_job(&core, JobOp::Redo { job }), "Redo");
    assert_eq!(read_text(&root, PORADA).as_deref(), Some(novy), "the new Porada is never trashed by Redo: {d:?}");
    assert!(d.skipped.iter().any(|s| s.path == PORADA), "it is listed instead: {d:?}");
    // Second review N5: D-815 on redo too: the object it skipped keeps the definition and the templates.
    assert!(d.kept_type, "keptType on redo: {d:?}");
    assert!(root.join(".tegg/types/schůzka.yml").exists() && root.join("_templates/Schůzka/Schůzka.md").exists(), "the type and its template stay");
}

// QA review of 4E-2, M2 (D-857) and m2 (D-858).

#[test]
fn bug_qa4e2_major2_fr_typ_04_ac8_a_type_file_changed_meanwhile_reverses_the_job() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let theirs = format!("{}# upraveno jinde\n", fx(KNIHA_YML));
    let (r2, t2) = (root.clone(), theirs.clone());
    core.jobs().set_point_hook(Some(std::sync::Arc::new(move |_, p: &tegg_jobs::JobPoint| {
        if matches!(p, tegg_jobs::JobPoint::AfterRead { path } if path == DUNA) {
            write_raw(&r2, KNIHA_YML, t2.as_bytes()); // another program edits the type file during the job
        }
    })));
    let (_, r) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "kniha".into(), key: "poznámka".into() }), "value-remove");
    core.jobs().set_point_hook(None);
    assert_eq!(r.phase, Phase::Failed, "the job fails on the type file: {r:?}");
    assert_eq!(read_bytes(&root, DUNA), Some(fx_bytes(DUNA)), "Duna's line is back: the vault is as before the job (D-857)");
    assert_eq!(read_text(&root, KNIHA_YML), Some(theirs), "the other program's type file is never overwritten");
}

#[test]
fn bug_qa4e2_major2_fr_typ_05_ac8_a_definition_gone_meanwhile_reverses_the_job() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let r2 = root.clone();
    core.jobs().set_point_hook(Some(std::sync::Arc::new(move |_, p: &tegg_jobs::JobPoint| {
        if matches!(p, tegg_jobs::JobPoint::AfterRead { path } if path == RETRO) {
            let _ = std::fs::remove_file(r2.join(".tegg/types/schůzka.yml")); // removed by another program
        }
    })));
    let (_, r) = ok!(run_confirmed(&core, JobOp::TypeDelete { r#type: "schůzka".into() }), "type-delete");
    core.jobs().set_point_hook(None);
    assert_eq!(r.phase, Phase::Failed, "the job fails on the definition: {r:?}");
    for p in [PORADA, RETRO, SCH_JINDE, T_SCHUZKA] {
        assert_eq!(read_bytes(&root, p), Some(fx_bytes(p)), "{p} is back at its path (D-857)");
    }
}

#[test]
fn bug_qa4e2_minor2_fr_typ_04_ac9_an_anchored_entry_skips_its_note_read_only() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let anchored = fx(DUNA).replace("poznámka: Půjčená od Petra\n", "poznámka: &kdo Půjčená od Petra\npůjčil: *kdo\n");
    write_raw(&root, DUNA, anchored.as_bytes());
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let (_, r) = ok!(run_confirmed(&core, JobOp::ValueRemove { r#type: "kniha".into(), key: "poznámka".into() }), "value-remove");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    assert_eq!(r.skipped.iter().map(|s| (s.path.clone(), s.reason)).collect::<Vec<_>>(), vec![(DUNA.to_string(), SkipReason::ReadOnly)], "Duna is skipped readOnly and listed (D-858), not `unchanged`");
    assert_eq!(read_text(&root, DUNA), Some(anchored), "the anchored entry stays (NFR-REL-03)");
}

// Second QA review of 4E-2 (qa/reviews/4e-2-type-deletes-2.md).

/// The real file system, counting full listings of the vault.
struct CountingFs {
    inner: tegg_vault::LocalFs,
    lists: std::sync::atomic::AtomicUsize,
}
impl tegg_vault::VaultFs for CountingFs {
    fn list(&self) -> std::io::Result<Vec<tegg_vault::FsEntry>> {
        self.lists.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.inner.list()
    }
    fn read(&self, path: &str) -> std::io::Result<(Vec<u8>, tegg_vault::FileVersion)> { self.inner.read(path) }
    fn version(&self, path: &str) -> std::io::Result<Option<tegg_vault::FileVersion>> { self.inner.version(path) }
    fn replace(&self, path: &str, bytes: &[u8]) -> std::io::Result<tegg_vault::FileVersion> { self.inner.replace(path, bytes) }
    fn create_new(&self, path: &str, bytes: &[u8]) -> std::io::Result<tegg_vault::FileVersion> { self.inner.create_new(path, bytes) }
    fn rename_no_replace(&self, from: &str, to: &str) -> std::io::Result<()> { self.inner.rename_no_replace(from, to) }
    fn create_dir_all(&self, path: &str) -> std::io::Result<()> { self.inner.create_dir_all(path) }
    fn remove_file(&self, path: &str) -> std::io::Result<()> { self.inner.remove_file(path) }
    fn remove_empty_dir(&self, path: &str) -> std::io::Result<()> { self.inner.remove_empty_dir(path) }
    fn stat(&self, path: &str) -> std::io::Result<Option<(i128, u64)>> { self.inner.stat(path) }
}

#[test]
fn bug_qa4e2_n1_fr_typ_05_ac8_undo_of_a_type_delete_does_not_list_the_vault_per_row() {
    let sb = sandbox();
    let root = moves_vault(&sb);
    let fs = std::sync::Arc::new(CountingFs { inner: tegg_vault::LocalFs::new(&root), lists: Default::default() });
    let core = ok!(common::open_core_with(fs.clone(), &sb.dirs), "open");
    let (job, r) = ok!(run_confirmed(&core, JobOp::TypeDelete { r#type: "schůzka".into() }), "type-delete");
    assert_eq!(r.phase, Phase::Done, "{r:?}");
    assert!(core.wait_idle(std::time::Duration::from_secs(10)));
    let before = fs.lists.load(std::sync::atomic::Ordering::SeqCst);
    let (_, u) = ok!(common::run_job(&core, JobOp::Undo { job }), "Undo");
    assert_eq!(u.phase, Phase::Done, "{u:?}");
    let lists = fs.lists.load(std::sync::atomic::Ordering::SeqCst) - before;
    assert!(lists < u.written.len(), "the undo of {} rows listed the vault {lists} times (never once per row, QA 4E-2 N1)", u.written.len());
    // m7: a templates folder made again meanwhile is `taken`, never merged into.
    let (job2, _) = ok!(run_confirmed(&core, JobOp::TypeDelete { r#type: "schůzka".into() }), "type-delete again");
    write_raw(&root, "_templates/Schůzka/Nová.md", b"---\ntype: sch\xc5\xafzka\n---\n");
    let (_, u2) = ok!(common::run_job(&core, JobOp::Undo { job: job2 }), "Undo again");
    assert!(u2.skipped.iter().any(|s| s.path == "_templates/Schůzka" && s.reason == SkipReason::Taken), "the templates folder's place is taken (D-849): {u2:?}");
    assert!(root.join(".trash/_templates/Schůzka/Schůzka.md").exists(), "the trashed templates stay in the trash");
}
