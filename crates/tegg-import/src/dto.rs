//! The data types of the contract (§3, §4, §5.1, §5.3, §10, §11), as written there.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

macro_rules! dto {
    ($($item:item)*) => { $( #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")] $item )* };
}

dto! {
    pub struct ScanInfo { pub kind: SourceKind, pub name: String, pub size: Option<u64>, pub files: usize, pub unreadable: Vec<Unreadable>, pub outside_spaces: usize, pub spaces: Vec<SpaceInfo> }
    pub struct SpaceInfo { pub name: String, pub objects: usize, pub attachments: usize, pub types: Vec<TypeCount> }
    pub struct TypeCount { pub source_type: String, pub objects: usize }
    pub struct Unreadable { pub entry: String, pub reason: UnreadableReason }
    pub enum UnreadableReason { BadName, Traversal, Read, Encrypted }
    pub enum SourceKind { Zip, Folder }

    pub struct Plan {
        pub version: u32, pub space: String, pub source: ScanInfo, pub target: PlanTarget, pub mapping: Mapping, pub types: Vec<PlannedType>,
        pub objects: Vec<PlannedObject>, pub attachments: Vec<PlannedAttachment>, pub other_files: Vec<OtherFile>, pub links: Vec<PlannedLink>,
        pub report: ReportData, pub totals: Totals, pub decisions: Decisions, pub already_imported: usize, pub report_path: String, pub space_bytes: u64,
        pub backup: Option<BackupPlan>, pub needed_bytes: u64, #[serde(default, skip_serializing_if = "Stamps::is_default")] pub stamps: Stamps,
    }
    pub struct PlannedType { pub source_type: String, pub source_folder: String, pub objects: usize, pub target: TypeTarget, pub key: Option<String>, pub name: Option<String>, pub plural: Option<String>, pub folder: Option<String>, pub new: bool, pub attributes: Vec<PlannedAttr> }
    pub struct PlannedAttr { pub source_key: String, pub action: AttrAction, pub key: Option<String>, pub name: Option<String>, pub r#type: Option<String>, pub values: usize, pub nulls: usize, pub options: Vec<String>, pub merges: Vec<ValueMerge>, pub statuses: Vec<StatusMap>, pub split: Option<Split>, pub needs_look: bool }
    pub struct PlannedObject { pub source: String, pub import_id: String, pub outcome: ObjectOutcome, pub source_type: Option<String>, pub r#type: Option<String>, pub title: Option<String>, pub path: Option<String>, pub kind: ObjectKind, pub frontmatter: Vec<(String, FmValue)>, pub name_changes: Vec<NameChange> }
    pub struct PlannedAttachment { pub source: String, pub outcome: AttachmentOutcome, pub path: Option<String>, pub object: Option<String>, pub bytes: u64, pub renamed_from_generic: bool, pub referenced: bool }
    pub struct OtherFile { pub source: String, pub kind: OtherKind }
    pub struct PlannedLink { pub note: String, pub n: u32, pub line: u32, pub place: LinkPlace, pub form: LinkForm, pub written: String, pub target: String, pub outcome: LinkOutcome, pub to: Option<String>, pub simplified: bool, pub kept_as_markdown: bool }

    pub enum ObjectOutcome { Imported, Skipped, Unreadable { reason: ObjectUnreadable, line: Option<u32> } }
    pub enum ObjectUnreadable { Yaml, NoType, NotUtf8, Read, Encrypted, Engine }
    pub enum AttachmentOutcome { Imported, Unreadable { reason: AttachmentUnreadable } }
    pub enum AttachmentUnreadable { Read, Encrypted }
    pub enum ObjectKind { Note, Media, OrphanMedia, QueryStub }
    pub enum OtherKind { TagCollection, Csv, Dotfile, OutsideSpace, UnreadableEntry }
    pub enum LinkPlace { Body, Frontmatter { key: String } }
    pub enum LinkForm { Wikilink, Embed, Markdown, Image }
    pub enum AttrAction { Keep, Rename, Drop, New, Consumed, NotCreated }
    pub struct ValueMerge { pub variants: Vec<String>, pub kept: String, pub applied: bool }
    pub struct StatusMap { pub value: String, pub to: String, pub state: String, pub count: usize, pub fallback: bool }
    pub enum NameChange { Reserved, Empty, Cut, Suffix, Characters }

    pub struct Decisions { pub case_links: Vec<CaseLinkCandidate>, pub ambiguous: Vec<AmbiguousLink>, pub tag_like: Vec<TagLikeAttr> }
    pub struct CaseLinkCandidate { pub note: String, pub n: u32, pub written: String, pub target: String, pub candidate: String, pub candidate_title: String, pub confirmed: bool }
    pub struct AmbiguousLink { pub note: String, pub n: u32, pub written: String, pub title: String, pub candidates: Vec<String>, pub chosen: String }
    pub struct TagLikeAttr { pub source_type: String, pub source_key: String, pub objects: usize, pub values: Vec<String>, pub example: String, pub selected: bool }

    pub struct Totals { pub objects: Tally, pub attachments: Tally, pub links: Tally, pub other_files: Tally }
    pub struct Tally { pub total: usize, pub imported: usize, pub reported: usize }
    pub struct RawTotals { pub objects: usize, pub attachments: usize, pub links: usize, pub other_files: usize }
    pub struct BackupPlan { pub files: usize, pub bytes: u64 }
    pub struct FileStamp { pub size: u64, pub mtime_ns: String }
    pub struct EntryStamp { pub entry: String, pub size: u64, pub mtime_ns: Option<String>, pub crc32: Option<u32> }
    pub struct TypeFileStamp { pub path: String, pub version: Option<ContentStamp> }
    pub struct ContentStamp { pub size: u64, pub hash: String }

    pub enum ImportPhase { Reading, Planning, Backup, Writing, Done, Cancelled, Failed }
    pub enum WriteStep { Vault, Types, Attachments, Objects, Report }

    // §5.3
    pub struct ReportData { pub summary: ReportSummary, pub types: Vec<TypeRow>, #[serde(default)] pub no_day: Vec<NoDayRow>, pub unresolved: Vec<UnresolvedRow>, pub ambiguous: Vec<AmbiguousRow>, pub case_links: Vec<CaseRow>, pub simplified: Vec<SimplifiedRow>, pub attributes: Vec<AttributeRow>, pub merged: Vec<MergedRow>, pub dates: Vec<DateRow>, pub files: Vec<FileRow>, pub stubs: Vec<StubRow>, pub skipped: Vec<SkippedRow>, pub cleanup: Cleanup, pub not_exported: Vec<NotExported> }
    pub struct ReportSummary { pub source: String, pub space: String, pub date: String, pub objects: Tally, pub attachments: Tally, pub links: Tally, pub backup: Option<String> }
    pub struct TypeRow { pub source_type: String, pub objects: usize, pub target: Option<String>, pub new: bool }
    pub struct NoDayRow { pub note: String }
    pub struct UnresolvedRow { pub note: String, pub n: u32, pub written: String, pub reason: UnresolvedReason }
    pub struct AmbiguousRow { pub note: String, pub n: u32, pub title: String, pub chosen: String }
    pub struct CaseRow { pub note: String, pub n: u32, pub written: String, pub candidate: String, pub confirmed: bool }
    pub struct SimplifiedRow { pub note: String, pub n: u32, pub written: String, pub kept: String }
    pub struct AttributeRow { pub source_type: String, pub source_key: String, pub change: AttrChange }
    pub enum KeyReason { Reserved, InvalidKey, KeyTaken, RangeClash }
    pub struct MergedRow { pub source_type: String, pub key: String, pub variants: Vec<String>, pub kept: String }
    pub struct FileRow { pub source: String, pub change: FileChange }
    pub struct StubRow { pub note: String }
    pub struct Cleanup { pub u200b: usize, pub ufeff: usize, pub u200c: usize, pub u200d: usize, pub crlf_files: usize }
    pub enum NotExported { QueryDefinitions, TagColoursAndCollections, Comments }

    // §10
    pub struct ImportProgress { pub phase: ImportPhase, pub step: Option<WriteStep>, pub done: u64, pub total: u64, pub step_done: u64, pub step_total: u64, pub counts: Option<Totals>, pub job: Option<tegg_jobs::JobId> }

    // §4.2, §9
    pub struct MappingEntry { pub source_type: String, pub attribute: Option<String> }
    pub enum MappingReason { UnknownSourceType, UnknownSourceAttribute, UnknownTargetType, UnknownTargetAttribute, TypeNotAllowed, NameTaken, ReservedKey, EmptyName, KeyTaken, RangeCollision, DuplicateTarget, KindMismatch, UnknownStatus, UnknownVersion }
    pub enum PlanReason { Version, Target, Path, Place, TypeKey, Duplicate, Unknown }
    pub enum TransformReason { Unavailable, Timeout, Engine }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamps {
    pub source: SourceStamp,
    pub type_files: Vec<TypeFileStamp>,
}
impl Stamps {
    /// §5.4: `plan.json` leaves the key out when nothing is stamped.
    pub fn is_default(&self) -> bool {
        *self == Stamps::default()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStamp {
    pub container: Option<FileStamp>,
    pub entries: Vec<EntryStamp>,
}

/// §7.1 `FmValue`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FmValue {
    Text(String),
    Bool(bool),
    List(Vec<String>),
    Raw { raw: String },
    Date { date: String },
    Datetime { datetime: String },
    Link { link: String },
    Links { links: Vec<String> },
    AsStored {
        #[serde(rename = "asStored")]
        as_stored: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LinkOutcome {
    Resolved,
    DateMention,
    Attachment,
    External,
    Unresolved,
    OtherSpace { space: String },
    Ambiguous,
    CaseMismatch { confirmed: bool },
    SelectValue,
    MissingFile,
    InSkippedNote,
    TargetNotImported,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlanTarget {
    NewVault { parent: String, name: String },
    Existing { name: String, notes: usize },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UnresolvedReason {
    NotInExport,
    OtherSpace { space: String },
    TargetNotImported,
    MissingFile,
    InSkippedNote,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttrChange {
    Renamed { key: String, reason: KeyReason },
    Dropped { values: usize },
    New { key: String, r#type: String },
    NotCreated { nulls: usize },
    SelectValues { values: usize },
    ValueNotInOptions { value: String, objects: usize },
    SplitUnmatched { value: String, objects: usize },
    AsStored { values: usize },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DateRow {
    Unreadable { note: String, key: String, value: String },
    ImportTime { objects: usize },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileChange {
    DroppedReference { n: u32, written: String },
    Unreferenced,
    GenericName { name: String },
    NameChanged { name: String, reasons: Vec<NameChange> },
}
// §5.3: `Ignored`'s Rust field is `kind`; in JSON it is `file`, because `kind` is the tag.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SkippedRow {
    Note { source: String, reason: ObjectUnreadable, line: Option<u32> },
    Attachment { source: String, reason: AttachmentUnreadable },
    Entry { entry: String, reason: UnreadableReason },
    Ignored {
        source: String,
        #[serde(rename = "file")]
        kind: OtherKind,
    },
    Type { source_type: String, objects: usize },
}

// ---------------------------------------------------------------- §4
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Mapping {
    pub version: u32,
    pub types: BTreeMap<String, TypeMapping>,
    pub case_links: Vec<CaseLinkChoice>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct TypeMapping {
    pub to: Option<TypeTarget>,
    pub attributes: BTreeMap<String, AttrMapping>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TypeTarget {
    Existing { key: String },
    New { name: String },
    Skip,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct AttrMapping {
    pub to: Option<AttrTarget>,
    pub merge: Option<Merge>,
    pub split: Option<Split>,
    pub values: BTreeMap<String, String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttrTarget {
    Existing {
        key: String,
    },
    New {
        name: String,
        #[serde(default)]
        r#type: Option<String>,
    },
    Drop,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merge {
    Off,
    Keep { spellings: BTreeMap<String, String> },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Split {
    pub on: bool,
    #[serde(default)]
    pub to: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseLinkChoice {
    pub note: String,
    pub target: String,
    pub r#use: bool,
}

// ---------------------------------------------------------------- §11
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum ImportError {
    NotCapacities,
    UnreadableArchive,
    EncryptedArchive,
    Empty,
    SourceGone { entry: Option<String> },
    SourceChanged { entry: Option<String> },
    UnknownSpace { space: String },
    InvalidMapping { entry: MappingEntry, reason: MappingReason },
    TargetExists,
    TargetNotWritable,
    TargetInsideVault,
    TargetInsideSource,
    NoSpace { needed: u64, free: u64 },
    IndexNotReady,
    InvalidPlan { path: Option<String>, reason: PlanReason },
    TargetChanged { path: String },
    LeftoverNotTrashed { reason: String },
    BackupFailed { reason: String },
    FileAppeared { path: String },
    Write { path: String, reason: String },
    Transform { note: Option<String>, reason: TransformReason },
    NotCancellable,
    Cancelled,
    Io { reason: String },
}
