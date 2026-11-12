//! STUB of `tegg-import` (docs/contracts/v1-import.md): every type and signature of the contract, no behaviour.
//! Each call answers a deliberately wrong result (`ImportError::Io { reason: "stub" }`, empty lists), so the red tests
//! fail on their assertions (TS-I1).
#![allow(unused_variables, dead_code)]
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub mod accounting;
pub mod mapping {
    pub use crate::{AttrMapping, AttrTarget, CaseLinkChoice, Mapping, MappingEntry, MappingReason, Merge, Split, TypeMapping, TypeTarget};
}
pub mod plan {
    pub use crate::dto::*;
}
pub mod real_export;
pub mod testing;
mod dto;
pub use dto::*;

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
    fn free(&self, _: &Path) -> io::Result<u64> {
        Ok(0)
    }
    fn volume(&self, _: &Path) -> io::Result<u64> {
        Ok(0)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportStrings(pub BTreeMap<String, String>);
impl ReportStrings {
    pub fn english() -> ReportStrings {
        ReportStrings::default()
    }
}
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
#[derive(Clone, Default)]
pub struct Control {
    pub cancel: CancelToken,
    pub progress: Option<Arc<dyn Fn(&ImportProgress) + Send + Sync>>,
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
pub struct Source {
    _private: (),
}
pub struct Scan {
    pub source: Arc<Source>,
    pub info: ScanInfo,
}
pub fn scan(path: &Path, env: &ImportEnv, ctl: &Control) -> Result<Scan, ImportError> {
    Err(ImportError::Io { reason: "stub".into() })
}

// ---------------------------------------------------------------- §5
pub enum Target<'a> {
    NewVault { parent: PathBuf, name: String },
    Existing(&'a tegg_core::Core),
}
pub fn plan(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv, ctl: &Control) -> Result<Plan, ImportError> {
    Err(ImportError::Io { reason: "stub".into() })
}
impl Plan {
    pub fn normalized(&self) -> Plan {
        self.clone()
    }
    pub fn same_as(&self, other: &Plan) -> bool {
        false
    }
}
impl LinkOutcome {
    pub fn imported(&self) -> bool {
        false
    }
}

// ---------------------------------------------------------------- §9
pub fn start(plan: Plan, scan: &Scan, target: &Target<'_>, env: &ImportEnv) -> Result<ImportRun, ImportError> {
    Err(ImportError::Io { reason: "stub".into() })
}
pub struct ImportRun {
    _private: (),
}
impl ImportRun {
    pub fn job(&self) -> tegg_jobs::JobId {
        0
    }
    pub fn cancel(&self) -> Result<(), ImportError> {
        Err(ImportError::Io { reason: "stub".into() })
    }
    pub fn wait(&self, timeout: Duration) -> Option<ImportReport> {
        None
    }
    pub fn report(&self) -> Option<ImportReport> {
        None
    }
    pub fn on_progress(&self, sink: Arc<dyn Fn(&ImportProgress) + Send + Sync>) {}
}
#[derive(Clone, Debug)]
pub struct ImportReport {
    pub job: tegg_jobs::JobId,
    pub phase: tegg_jobs::Phase,
    pub error: Option<ImportError>,
    pub vault: Option<PathBuf>,
    pub vault_name: String,
    pub written: Vec<String>,
    pub report_path: Option<String>,
    pub renamed: Vec<(String, String)>,
    pub backup: Option<String>,
    pub kept: Vec<String>,
    pub totals: Totals,
}
