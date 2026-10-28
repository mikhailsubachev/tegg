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

pub use engine::{Jobs, JobsRef};
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
            // ms4-jobs §14.1 (D-812): no confirm step (the mapping dialog is the UI's, D-805 has none); a single type move
            // makes no zip (a bulk one does, like the inbox convert); both are undoable.
            JobKind::TypeMove => KindFlags { needs_confirm: false, backup: false, undoable: true, cancellable: vec![Phase::Planning, Phase::Backup] },
            JobKind::FolderMove => KindFlags { needs_confirm: false, backup: true, undoable: true, cancellable: vec![Phase::Planning, Phase::Backup] },
            // ms4-jobs §14.9.1: confirm, zip, undoable in memory; cancellable while writing (boards D3, F2).
            JobKind::ValueRemove | JobKind::TypeDelete => KindFlags { needs_confirm: true, backup: true, undoable: true, cancellable: vec![Phase::Planning, Phase::Confirm, Phase::Backup, Phase::Writing] },
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
    /// ms4-jobs §14.9.2 (4E-2, D-807, D-814): removes `key` from every object of `r#type` that has a value, then the
    /// property from the type file. Stub until 4E-2 is built: `start` answers `NotImplemented` (TS-I1).
    ValueRemove { r#type: String, key: String },
    /// ms4-jobs §14.2 (4E-1): one or more notes to `to_type` (a type key). `mapping` applies to every note (D-813: one
    /// mapping per type pair); `review`: write `review: reviewed` too (an Inbox convert, D-557). Stub until 4E-1 is
    /// built: `start` answers `NotImplemented` (TS-I1).
    TypeMove { paths: Vec<String>, to_type: String, mapping: Vec<PropertyMap>, review: bool, bulk: bool },
    /// ms4-jobs §14.2: `to_folder: Some(f)`: the folder save of `r#type` (D-805), every object of the type outside `f`
    /// and its subfolders. `None` with `r#type: None`: the tidy job over every defined type (D-811).
    FolderMove { r#type: Option<String>, to_folder: Option<String> },
    /// ms4-jobs §14.9.3 (4E-2, D-809, D-815): trashes every object of `r#type`, then its templates and, last, its
    /// definition (`TypeDeleteChoice` went with D-809). Stub until 4E-2 is built: `start` answers `NotImplemented`.
    TypeDelete { r#type: String },
    /// ms5-capture §7.3 (5B, D-561): the same change applied to each of `paths` (vault paths, NFC), each against its
    /// index version; changed and read-only files are skipped. A backup zip only for `SetType` (`backup.convert`).
    Inbox { paths: Vec<String>, change: InboxJobChange },
    /// ms4-tags §5.3 (4D-lite): restore the backup zip `name` (a file name in the open vault's backup folder). The
    /// op's name is a red-test point (AP-671): the contract names only the IPC command `backup_restore(name)`.
    Restore { name: String },
}

/// ms4-jobs §14.2 (D-813): one schema property of the old type; only schema properties are mapped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyMap {
    pub from: String,
    pub to: MapTarget,
}

/// ms4-jobs §14.2: where a mapped property goes (D-804).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MapTarget {
    /// A property key of the new type (renamed in place when it differs from `from`, D-230).
    Property(String),
    /// A `**Name:** value` line at the start of the body (D-813).
    Content,
}

/// ms4-jobs §14.5: a property key, or the literal `content`.
pub type MapTargetDto = String;

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
    /// ms4-tags §4.1 (D-718): e.g. a losing Tag file of the key.
    pub warnings: Vec<PlanWarning>,
}

/// ms4-tags §4.1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanWarning {
    /// Another Tag file of the key, left alone by the job (D-718).
    DuplicateTagFile { path: String },
}

/// ms4-tags §5.2 (D-733): one backup zip of the open vault.
#[derive(Debug, Clone, PartialEq)]
pub struct BackupInfo {
    pub name: String,
    pub kind: String,
    /// ISO 8601 (the manifest's UTC time, else the name's).
    pub time: String,
    pub label: BackupLabel,
    /// Vault files in the zip (the manifest not counted).
    pub files: usize,
}

/// The catalog key and arguments of a backup's operation label (D-724).
#[derive(Debug, Clone, PartialEq)]
pub struct BackupLabel {
    pub key: String,
    pub args: serde_json::Value,
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
    /// ms4-jobs §14.9.2 (4E-2): objects of the type with the key but no value (`<m> have no value`, FR-TYP-04 AC-6).
    pub empty: usize,
    /// ms4-jobs §14.9.3 (4E-2): the type's template files a `type-delete` trashes (`the <k> <Name> templates`).
    pub templates: usize,
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
    /// ms4-tags §4.2 (4D-lite): every occurrence of tag `key` gets the name `to` (D-699, D-713: no `modified` change).
    RenameTag { key: String, to: String },
    /// Every occurrence of tag `key` is removed (D-698, D-715, D-716).
    RemoveTag { key: String },
    /// The kept object of a merge (D-290, D-727).
    MergeInto { others: Vec<MergeOther>, now: String },
    /// Restore through an open editor (ms4-tags §5.3).
    Replace { text: String },
    /// ms4-jobs §14.4 (4E-1, D-804, D-813): `map` in old schema order (`(from, key or "content")`); `labels` are the old
    /// properties' display names for the Content lines.
    MapProperties { map: Vec<(String, MapTargetDto)>, labels: Vec<(String, String)> },
    /// ms4-jobs §14.4 (D-810): rewrite links in this note that would resolve to another file from `to_path` than from
    /// `from_path`; `paths` are the vault's note paths.
    KeepTargets { from_path: String, to_path: String, paths: Vec<String> },
    /// ms4-jobs §14.3 (D-826, D-829): a type move's own type change: `type` and, unless `now` is `None` (a template),
    /// `modified`; never `review`.
    ChangeType { r#type: String, now: Option<String>, id: Option<String> },
    /// D-838: in a note that doesn't move, rewrite every link whose resolution (D-291) would change when `from_path`
    /// becomes `to_path`, so it keeps its target; `paths` are the vault's note paths before the move.
    HoldTargets { from_path: String, to_path: String, paths: Vec<String> },
    /// 4E-1 (D-810, D-838, QA N1): every link of the file keeps its target when all `moves` (from, to) happen together,
    /// the file itself possibly among them; `paths` are the vault's note paths before the moves, `files` its other files
    /// (attachments: a relative link to one follows a moved note only when it names an existing file, QA 4 N2). Shared,
    /// never copied per file (QA 4 M7′).
    Relink { moves: Arc<Vec<(String, String)>>, paths: Arc<Vec<String>>, files: Arc<Vec<String>> },
    /// ms4-jobs §14.4, §14.9.2 (4E-2, D-814): removes the frontmatter entry `key` with its value lines; full-line
    /// comments above it stay; no `modified` change.
    RemoveKey { key: String },
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
    /// D-849: an undo or redo whose target path exists again.
    Taken,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            SkipReason::Changed => "changed",
            SkipReason::Missing => "missing",
            SkipReason::Placeholder => "placeholder",
            SkipReason::ReadOnly => "readOnly",
            SkipReason::Io => "io",
            SkipReason::Taken => "taken",
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
    /// ms4-jobs §14.7 (4E-1): every (from, to) a type or folder move really made.
    pub moved: Vec<(String, String)>,
    /// ms4-jobs §14.9.3 (4E-2, D-815): a `type-delete` that skipped an object kept the definition and templates
    /// (`1 object was not changed, so the type was kept.`, FR-TYP-05 AC-9).
    pub kept_type: bool,
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
    /// `rename` or `type-move` (§14.6): which banner text the app shows.
    pub kind: String,
    /// The note's title, for `Changing the type of "<title>" was interrupted…`.
    pub title: Option<String>,
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
    /// ms4-tags §4.1 (D-699): the new name is another existing tag.
    TagExists { name: String },
    /// ms4-tags §11 (D-738): a tag rename to the same spelling; no job runs.
    NothingToDo,
    /// ms4-jobs §14.2 (4E-1): a Daily Note, Tag, Image or PDF as source or target, a file last read as not UTF-8, or a
    /// path under `.trash/`; nothing is written.
    NotMovable,
    /// ms4-jobs §14.2: `to_type` has no definition.
    UnknownType,
    /// ms4-jobs §14.2: the target is the note's current type.
    NoChange,
    /// ms4-jobs §14.9.1 (4E-2): a system type (FR-TYP-06 AC-1); nothing is planned.
    SystemType,
    /// ms4-jobs §14.9.1 (4E-2): a built-in attribute (FR-TYP-06 AC-2); nothing is planned.
    BuiltIn,
    /// ms4-jobs §14.9.1 (4E-2): the type has no item with that key.
    UnknownProperty,
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
    /// D-823: right before the backup zip (kinds with a zip); the job is still cancellable here.
    BeforeBackup,
}

pub type PointHook = Arc<dyn Fn(JobId, &JobPoint) + Send + Sync>;

// ------------------------------------------------------------------------------------------------ §4 engine API
