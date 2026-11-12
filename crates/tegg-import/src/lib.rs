//! `tegg-import`: the Capacities import engine (docs/contracts/v1-import.md, slice I1). Scan, plan and write, with no
//! window: platform-neutral (AR-03), every file access through `tegg-vault` (AR-04), every byte of a note from
//! `@tegg/doc` through the transformer (D-82, D-1534).
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub mod accounting;
mod dates;
mod dto;
mod existing;
mod layout;
pub mod mapping;
mod newvault;
mod note;
pub mod plan;
mod planner;
pub mod real_export;
mod render;
mod run;
mod source;
pub mod testing;
pub use dto::*;
pub use run::{start, ImportReport, ImportRun};
pub use source::Source;

// ---------------------------------------------------------------- §2
#[derive(Clone)]
pub struct ImportEnv {
    pub clock: Arc<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync>,
    pub zone: chrono_tz::Tz,
    pub ids: Arc<dyn Fn() -> String + Send + Sync>,
    pub transformer: Arc<dyn tegg_jobs::Transformer>,
    pub dirs: tegg_vault::AppDirs,
    pub disk: Arc<dyn Disk>,
    pub trash: Arc<dyn tegg_vault::SystemTrash>,
    pub strings: ReportStrings,
    pub points: Option<PointHook>,
}
pub trait Disk: Send + Sync {
    fn free(&self, path: &Path) -> io::Result<u64>;
    fn volume(&self, path: &Path) -> io::Result<u64>;
}
pub struct SystemDisk;
impl Disk for SystemDisk {
    fn free(&self, path: &Path) -> io::Result<u64> {
        tegg_vault::free_space(path)
    }
    fn volume(&self, path: &Path) -> io::Result<u64> {
        tegg_vault::volume_id(path)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportStrings(pub BTreeMap<String, String>);
impl ReportStrings {
    /// R155 and §5.3's catalog table, under the full keys (`import.report.…`).
    pub fn english() -> ReportStrings {
        ReportStrings(REPORT_ENGLISH.iter().map(|(k, v)| (format!("import.report.{k}"), v.to_string())).collect())
    }
    /// The text of a key given without the prefix; a missing key is written as the full key itself (§2).
    pub(crate) fn word(&self, key: &str) -> String {
        let full = format!("import.report.{key}");
        self.0.get(&full).cloned().unwrap_or(full)
    }
}
const REPORT_ENGLISH: &[(&str, &str)] = &[
    ("section.summary", "Summary"), ("section.types", "Types"), ("section.unresolved", "Unresolved links"), ("section.ambiguous", "Ambiguous links"),
    ("section.caseLinks", "Links that differ only in case"), ("section.simplified", "Simplified links"), ("section.attributes", "Attributes"),
    ("section.merged", "Merged values"), ("section.dates", "Dates"), ("section.files", "Files"), ("section.stubs", "Query stubs"),
    ("section.skipped", "Skipped"), ("section.cleanup", "Clean-up"), ("section.notExported", "Not in the export"),
    ("summary.source", "Source"), ("summary.space", "Space"), ("summary.date", "Date"), ("summary.objects", "Objects"),
    ("summary.attachments", "Attachments"), ("summary.links", "Links"), ("summary.imported", "imported"), ("summary.reported", "reported"),
    ("summary.total", "total"),
    ("noUndo", "This import can’t be undone. A backup from before it is in Settings › Backups. Restoring it brings back your earlier files and leaves the imported ones in place."),
    ("reason.notInExport", "not in the export"), ("reason.otherSpace", "in another space: {space}"), ("reason.targetNotImported", "target not imported"),
    ("reason.missingFile", "missing file"), ("reason.inSkippedNote", "in a skipped note"),
    ("word.new", "new"), ("word.confirmed", "confirmed"), ("word.leftUnresolved", "left unresolved"), ("word.notImported", "not imported"),
    ("type.noDay", "Daily Note with no readable day, imported as a Page"),
    ("attr.renamed", "renamed"), ("attr.dropped", "dropped"), ("attr.new", "new"), ("attr.notCreated", "not created, no values"),
    ("attr.selectValues", "link values turned into select values"), ("attr.valueNotInOptions", "value not in the type’s options"),
    ("attr.splitUnmatched", "no object with this name, kept as text"), ("attr.asStored", "kept as stored"),
    ("key.reserved", "reserved key"), ("key.invalidKey", "not a valid key"), ("key.keyTaken", "key already used"), ("key.rangeClash", "clashes with a date range"),
    ("date.unreadable", "not a date, kept as written"), ("date.importTime", "objects without a creation date; the import time was used"),
    ("file.droppedReference", "reference to a missing file dropped"), ("file.unreferenced", "no note referenced it"), ("file.genericName", "generic name renamed"),
    ("name.reserved", "reserved name"), ("name.empty", "no valid character"), ("name.cut", "cut to 200 bytes"), ("name.suffix", "name taken"),
    ("name.characters", "characters replaced"),
    ("skip.yaml", "frontmatter isn’t valid YAML"), ("skip.noType", "no type"), ("skip.notUtf8", "not UTF-8"), ("skip.read", "couldn’t be read"),
    ("skip.encrypted", "password-protected"), ("skip.engine", "couldn’t be converted"), ("skip.badName", "unreadable name"), ("skip.traversal", "unsafe path"),
    ("skip.tagCollection", "tag collection"), ("skip.csv", "CSV file"), ("skip.dotfile", "hidden file"), ("skip.outsideSpace", "outside every space"),
    ("skip.unreadableEntry", "unreadable entry"), ("skip.type", "type not imported"),
    ("cleanup.crlf", "files with CRLF"),
    ("notExported.queries", "Query definitions"), ("notExported.tags", "Tag colours and collections"), ("notExported.comments", "Comments"),
    // Not in §5.3's table: the one line of a query stub's body (FR-IMP-16 AC-1).
    ("stub.note", "This query was imported from Capacities. Its definition wasn’t exported, so it needs rebuilding."),
];
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);
impl CancelToken {
    pub fn new() -> CancelToken {
        CancelToken::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst)
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
/// A progress sink (§10).
pub type ProgressFn = Arc<dyn Fn(&ImportProgress) + Send + Sync>;
#[derive(Clone, Default)]
pub struct Control {
    pub cancel: CancelToken,
    pub progress: Option<ProgressFn>,
}
pub type PointHook = Arc<dyn Fn(&ImportPoint) -> PointAction + Send + Sync>;
pub enum PointAction {
    Continue,
    Fail(io::ErrorKind),
}
#[derive(Clone, Debug, PartialEq)]
pub enum ImportPoint {
    BeforeChecks,
    Rendered,
    BeforeBackup,
    AfterBackup,
    BeforeTemp { path: String, kind: FileKind },
    TempWritten { path: String, kind: FileKind },
    Renamed { path: String, kind: FileKind },
    BeforeFinalRename,
    AfterFinalRename,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    Marker,
    VaultFile,
    TypeFile,
    Attachment,
    Object,
    Report,
}

// ---------------------------------------------------------------- §3
pub struct Scan {
    pub source: Arc<Source>,
    pub info: ScanInfo,
}
/// §3: reads the directory of a `.zip` file or a folder. Writes nothing anywhere.
pub fn scan(path: &Path, env: &ImportEnv, ctl: &Control) -> Result<Scan, ImportError> {
    let _ = env;
    let (source, info) = source::scan(path, ctl)?;
    Ok(Scan { source: Arc::new(source), info })
}

// ---------------------------------------------------------------- §5
pub enum Target<'a> {
    NewVault { parent: PathBuf, name: String },
    Existing(&'a tegg_core::Core),
}
/// §5: the plan of one space. Read-only and deterministic.
pub fn plan(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv, ctl: &Control) -> Result<Plan, ImportError> {
    planner::plan(scan, space, target, mapping, env, ctl)
}
