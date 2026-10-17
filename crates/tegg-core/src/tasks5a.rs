//! Slice 5A-1: the task query and the Daily Note's `Tasks due` (docs/contracts/ms5-tasks.md §2.1, §2.3; D-470…D-489).
//! Stubs until 5A-1 is built: every query returns an empty, deliberately wrong result so the red tests fail on their
//! assertions, never on a build error (TS-I1). The core never decides "today", "overdue" or a section (§1).

use chrono::NaiveDate;

use crate::{Core, DayWindow, FileVersion, LinkTarget};

pub use tegg_schema::TaskState;

/// One task (R44): every indexed object whose matched type is `task`, outside `_templates/` and `.trash/`.
#[derive(Debug, Clone)]
pub struct TaskRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub status: Option<String>,
    pub state: TaskState,
    pub status_known: bool,
    pub priority: Option<String>,
    pub priority_rank: usize,
    pub due_raw: Option<String>,
    pub due: Option<NaiveDate>,
    pub completed: Option<String>,
    pub tags: Vec<String>,
    pub fm_tags: Vec<String>,
    pub source: Option<LinkTarget>,
    pub excerpt: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub version: FileVersion,
    pub read_only: bool,
}

#[derive(Debug, Clone)]
pub struct StatusOption {
    pub label: String,
    pub color: Option<String>,
    pub state: TaskState,
    pub state_raw: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TaskDefs {
    pub statuses: Vec<StatusOption>,
    pub priorities: Vec<tegg_schema::OptionDef>,
    pub unknown_states: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone)]
pub struct DailyTaskRows {
    pub overdue: Vec<TaskRow>,
    pub due: Vec<TaskRow>,
    pub completed: Vec<TaskRow>,
    pub total: usize,
}

impl Core {
    /// R44 task query (§2.1). Stub: empty.
    pub fn tasks(&self) -> Vec<TaskRow> {
        Vec::new()
    }

    /// The Task type's status and priority options (§2.1). Stub: empty.
    pub fn task_defs(&self) -> TaskDefs {
        TaskDefs { statuses: Vec::new(), priorities: Vec::new(), unknown_states: Vec::new() }
    }

    /// FR-DLY-04 AC-9 (§2.3). Stub: empty.
    pub fn daily_tasks(&self, _w: &DayWindow, _today: NaiveDate, _limit: usize) -> DailyTaskRows {
        DailyTaskRows { overdue: Vec::new(), due: Vec::new(), completed: Vec::new(), total: 0 }
    }
}
