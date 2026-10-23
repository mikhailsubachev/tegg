//! Tegg job engine (docs/contracts/ms4-jobs.md, architecture §5.6): plan → confirm → backup → write → report for
//! every bulk rewrite. 4C ships the engine and note rename (D-267…D-269, D-383…D-399).
//!
//! Platform-neutral (AR-03): no Tauri, no desktop APIs. The core implements [`host::Host`] over its vault and index.

use std::sync::Arc;

pub use tegg_vault::FileVersion;

mod engine;
pub mod host;
mod journal;
mod ops;
pub mod testing;
mod zip;

pub use engine::Jobs;
pub use ops::{op_from_json, op_json};

pub type JobId = u64;

// ------------------------------------------------------------------------------------------------ §1 kinds and phases

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum JobKind {
    NoteRename,
    TagRename,
    TagDelete,
    Merge,
    KeyRename,
    ValueRemove,
    TypeMove,
    FolderMove,
    TypeDelete,
    /// FR-HIS-04 AC-5 only: with `TEGG_TEST=1` and in Rust tests.
    TestBackup,
    /// ms5-capture §7.3 (5B, D-561): an Inbox action on more than one file.
    Inbox,
    /// ms4-tags §5.3 (4D-lite): restoring a backup zip (Settings › Backups).
    Restore,
}

impl JobKind {
    /// The IPC name (`note-rename`, `tag-rename`, …, `test-backup`).
    pub fn as_str(self) -> &'static str {
        match self {
            JobKind::NoteRename => "note-rename",
            JobKind::TagRename => "tag-rename",
            JobKind::TagDelete => "tag-delete",
            JobKind::Merge => "merge",
            JobKind::KeyRename => "key-rename",
            JobKind::ValueRemove => "value-remove",
            JobKind::TypeMove => "type-move",
            JobKind::FolderMove => "folder-move",
            JobKind::TypeDelete => "type-delete",
            JobKind::TestBackup => "test-backup",
            JobKind::Inbox => "inbox",
            JobKind::Restore => "restore",
        }
    }

    /// ms4-jobs §1 table.
    pub fn flags(self) -> KindFlags {
        match self {
            JobKind::NoteRename => KindFlags { needs_confirm: false, backup: false, undoable: true, cancellable: vec![Phase::Planning] },
            JobKind::TestBackup => KindFlags { needs_confirm: false, backup: true, undoable: false, cancellable: vec![Phase::Planning, Phase::Backup] },
            // ms5-capture §7.3 (D-561): the page confirms `Mark all reviewed` itself; only `SetType` makes a backup.
            JobKind::Inbox => KindFlags { needs_confirm: false, backup: false, undoable: false, cancellable: vec![Phase::Planning, Phase::Backup] },
            // ms4-tags §4.1: the UI's dialog confirms a restore; it backs up the current state first.
            JobKind::Restore => KindFlags { needs_confirm: false, backup: true, undoable: false, cancellable: vec![Phase::Planning, Phase::Backup] },
            _ => KindFlags { needs_confirm: true, backup: true, undoable: false, cancellable: vec![Phase::Planning, Phase::Confirm, Phase::Backup] },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KindFlags {
    pub needs_confirm: bool,
    pub backup: bool,
    pub undoable: bool,
    /// Phases in which `cancel` is allowed.
    pub cancellable: Vec<Phase>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Phase {
    Queued,
    Planning,
    Confirm,
    Backup,
    Writing,
    Done,
    Cancelled,
    Failed,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Queued => "queued",
            Phase::Planning => "planning",
            Phase::Confirm => "confirm",
            Phase::Backup => "backup",
            Phase::Writing => "writing",
            Phase::Done => "done",
            Phase::Cancelled => "cancelled",
            Phase::Failed => "failed",
        }
    }
    pub fn is_final(self) -> bool {
        matches!(self, Phase::Done | Phase::Cancelled | Phase::Failed)
    }
}

// ------------------------------------------------------------------------------------------------ §2 ops and plans

/// D-225: what happens to the objects of a deleted type (4E). Shape only; no planner before v1.0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeDeleteChoice {
    Trash,
    ChangeTo { r#type: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobOp {
    /// `title` as committed (NFC, trimmed by the core).
    NoteRename { path: String, title: String },
    /// Undo of an undoable job (D-385).
    Undo { job: JobId },
    Redo { job: JobId },
    /// FR-HIS-04 AC-5 only.
    TestBackup { paths: Vec<String> },
    // 4D-lite / v1.0: shapes fixed now, planners return NotImplemented until their slice.
    TagRename { from: String, to: String },
    TagDelete { tag: String, keep_text: bool },
    Merge { keep: String, others: Vec<String> },
    KeyRename { r#type: String, from: String, to: String },
    ValueRemove { r#type: String, key: String },
    TypeMove { path: String, to_type: String },
    FolderMove { r#type: String, to_folder: String },
    TypeDelete { r#type: String, objects: TypeDeleteChoice },
    /// ms5-capture §7.3 (5B, D-561): the same change applied to each of `paths` (vault paths, NFC), each against its
    /// index version; changed and read-only files are skipped. A backup zip only for `SetType` (`backup.convert`).
    Inbox { paths: Vec<String>, change: InboxJobChange },
    /// ms4-tags §5.3 (4D-lite): restore the backup zip `name` (a file name in the open vault's backup folder). The
    /// op's name is a red-test point (AP-608): the contract names only the IPC command `backup_restore(name)`.
    Restore { name: String },
}

/// ms5-capture §7.3: the change of an `inbox` job; each maps to the `@tegg/doc` `TextOp` of the same name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboxJobChange {
    /// `value`: `reviewed` or `unreviewed`.
    SetReview { value: String, now: String },
    /// Writes `type`, `review: reviewed` and `modified` (D-557).
    SetType { r#type: String, now: String },
    AddTags { tags: Vec<String>, now: String },
    /// `target`: the link text written as `[[target]]` (D-559), the same in every file.
    AppendLink { target: String, now: String },
    /// D-573: a link to the note at vault path `path`; each file gets its D-184 text from its own folder.
    AppendLinkTo { path: String, title: String, now: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobPlan {
    pub job: JobId,
    pub kind: JobKind,
    /// Files whose text may change, in path order.
    pub files: Vec<PlannedFile>,
    /// (from, to) vault paths; for note-rename at most one.
    pub renames: Vec<(String, String)>,
    pub creates: Vec<String>,
    pub trashes: Vec<String>,
    pub counts: PlanCounts,
    /// ms4-tags §4.1 (D-664): e.g. a losing Tag file of the key.
    pub warnings: Vec<PlanWarning>,
}

/// ms4-tags §4.1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanWarning {
    /// Another Tag file of the key, left alone by the job (D-664).
    DuplicateTagFile { path: String },
}

/// ms4-tags §4.2 `merge-into`: one merged object's current text, in the group's order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeOther {
    pub path: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    pub path: String,
    pub version: FileVersion,
    pub ops: Vec<TextOp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PlanCounts {
    pub files: usize,
    /// Occurrences the planner expects to rewrite.
    pub links: usize,
}

/// §2.2: what a transformer applies to one file. The TypeScript twin is `@tegg/doc` `TextOp`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextOp {
    /// Rewrites every link node whose target resolves to `from_path` from the file's own path (D-291), using `paths`
    /// (the vault's note paths before the rename).
    RetargetLinks {
        from_path: String,
        from_stem: String,
        from_title: String,
        to_path: String,
        to_stem: String,
        to_title: String,
        paths: Vec<String>,
    },
    /// The renamed note only; also touches `modified` with `now` (FR-FMT-11).
    SetTitle { title: String, now: String },
    /// ms5-capture §7.3 (5B): thin wrappers of `@tegg/doc` `applyInboxChange` for the `inbox` kind.
    SetReview { value: String, now: String },
    SetType { r#type: String, now: String },
    AddTags { tags: Vec<String>, now: String },
    AppendLink { target: String, now: String },
    /// D-573: `[[<D-184 text of to_path from the source>]]`; `paths` are the vault's note paths (D-291 resolution in
    /// `@tegg/doc`, as `RetargetLinks`).
    AppendLinkTo { to_path: String, to_title: String, paths: Vec<String>, now: String },
    /// ms4-tags §4.2 (4D-lite): every occurrence of tag `key` gets the name `to` (D-645, D-659: no `modified` change).
    RenameTag { key: String, to: String },
    /// Every occurrence of tag `key` is removed (D-644, D-661, D-662).
    RemoveTag { key: String },
    /// The kept object of a merge (D-290, D-673).
    MergeInto { others: Vec<MergeOther>, now: String },
    /// Restore through an open editor (ms4-tags §5.3).
    Replace { text: String },
}

/// A byte range in the input that was replaced (UTF-8 offsets).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Edit {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Transformed {
    Bytes(Vec<u8>, Vec<Edit>),
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransformError {
    Unavailable,
    Timeout,
    Engine(String),
}

/// D-82: Rust never edits Markdown; each planned file's new bytes come from a transformer.
pub trait Transformer: Send + Sync {
    /// `source`: the vault path of the file (for relative Markdown links). Pure: same input, same output.
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError>;
}

// ------------------------------------------------------------------------------------------------ §4, §5 reports

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SkipReason {
    Changed,
    Missing,
    Placeholder,
    ReadOnly,
    Io,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::Changed => "changed",
            SkipReason::Missing => "missing",
            SkipReason::Placeholder => "placeholder",
            SkipReason::ReadOnly => "readOnly",
            SkipReason::Io => "io",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skipped {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub written: usize,
    pub unchanged: usize,
    pub skipped: usize,
}

/// `job:progress` (FR-UX-07 AC-8). `counts` on the final event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobProgress {
    pub job: JobId,
    pub kind: JobKind,
    pub phase: Phase,
    pub done: usize,
    pub total: usize,
    pub counts: Option<Counts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobReport {
    pub job: JobId,
    pub kind: JobKind,
    /// `Done`, `Cancelled` or `Failed`.
    pub phase: Phase,
    /// (from, to) of the renamed note.
    pub renamed: Option<(String, String)>,
    pub written: Vec<String>,
    pub unchanged: Vec<String>,
    pub skipped: Vec<Skipped>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetryOutcome {
    Written,
    Unchanged,
    Skipped(SkipReason),
}

/// §8: a job journal left behind by a crash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interrupted {
    pub job: JobId,
    pub from: String,
    pub to: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveChoice {
    Finish,
    Undo,
}

#[derive(Debug)]
pub enum JobError {
    NotRenamable,
    Busy,
    NotCancellable,
    NotFound,
    NotImplemented,
    BackupFailed(String),
    /// ms4-tags §4.1: a refused tag name (§2); `error` is `empty`, `space`, `digits` or `char`.
    InvalidName { error: String, char: Option<String> },
    /// ms4-tags §4.1 (D-645): the new name is another existing tag.
    TagExists { name: String },
    /// ms4-tags §11 (D-684): a tag rename to the same spelling; no job runs.
    NothingToDo,
    /// A core error, as text (`CoreError` lives in tegg-core, which depends on this crate).
    Core(String),
}

/// Named points of a running job where the L4 sync simulator injects external changes (rename.md "Test layers",
/// FR-LNK-03 AC-15). Test-only: the hook is never set in the app; it runs on the job thread and may block it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobPoint {
    /// The plan is made and the job is still in `planning` (cancellable for every kind); no zip has been written and no
    /// file has been read for writing yet.
    AfterPlanning,
    /// `writing`: `path` was read for its write (its base version taken); its write hasn't started.
    AfterRead { path: String },
    /// `path`'s new bytes are in the temp file; the rename onto `path` hasn't happened.
    TempWritten { path: String },
}

pub type PointHook = Arc<dyn Fn(JobId, &JobPoint) + Send + Sync>;

// ------------------------------------------------------------------------------------------------ §4 engine API
