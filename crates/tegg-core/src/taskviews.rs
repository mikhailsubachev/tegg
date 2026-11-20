//! v1-views §25 (Q2-T, R202): the default task views `Schedule` and `Kanban`, their migration and `Restore default
//! views`. Compile-only stubs (D-1912): no default definition, the migration writes nothing, the restore is refused.
//! AR-03: platform-neutral.

use crate::queries_q::QueryDef;
use crate::{Core, CoreError, FileVersion, TypeInfo};

pub const TASK_VIEW_NAMES: [&str; 2] = ["Schedule", "Kanban"];

/// R202's def of `Schedule` or `Kanban` (None for any other name). Stub: None for every name.
pub fn default_task_view(_name: &str) -> Option<QueryDef> {
    None
}

/// §25.2: the outcome of `Core::task_views_migrate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskViewsMigration {
    NotNeeded,
    Skipped,
    Done { created: Vec<String>, views: Vec<String> },
    Stopped { created: Vec<String>, reason: String },
}

/// §25.3: the outcome of `Core::task_views_restore`.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskViewsRestore {
    pub created: Vec<String>,
    pub names: Option<Vec<String>>,
    pub before: Option<String>,
    pub info: TypeInfo,
}

impl Core {
    /// R202. Stub: writes nothing and reports `Stopped` with reason `NotImplemented`.
    pub fn task_views_migrate(&self, _now: &str) -> TaskViewsMigration {
        TaskViewsMigration::Stopped { created: Vec::new(), reason: "NotImplemented".into() }
    }

    /// R202 `Restore default views`. Stub: refused with `NotImplemented`, nothing written.
    pub fn task_views_restore(&self, _base: Option<&FileVersion>, _now: &str) -> Result<TaskViewsRestore, CoreError> {
        Err(CoreError::NotImplemented)
    }
}
