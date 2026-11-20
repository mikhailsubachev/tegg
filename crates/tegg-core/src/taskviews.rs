//! v1-views §25 (Q2-T, R202; D-1777, D-1897, D-1901, D-1902, D-1913, D-1918, D-1919): the default task views
//! `Schedule` and `Kanban`, their migration and `Restore default views`. The query files are created exclusively (never
//! replacing a file, a live query of the name is left alone), then `task.yml`'s `views:` is written with one minimal,
//! base-checked write (`type_patch`). No restore point, no job. AR-03: platform-neutral (files through `Vault`).

use serde_json::Value;
use tegg_format::nfc;
use tegg_schema::{Readability, RuleError, SchemaError, TypeOp, TYPES_DIR};
use tegg_vault::VaultError;

use crate::queries_q::{self, name_key, FilterItem, Lanes, Match, Op, Order, QueryDef, QueryError, Sort, View, DoneLane, QUERIES_DIR};
use crate::{Core, CoreError, FileVersion, TypeInfo};

pub const TASK_VIEW_NAMES: [&str; 2] = ["Schedule", "Kanban"];

const TASK_YML: &str = "task.yml";

/// R202's def of `Schedule` or `Kanban` (None for any other name). `create_text(&def, now, None)` gives R202's bytes.
pub fn default_task_view(name: &str) -> Option<QueryDef> {
    let (group_by, period, lanes, folded) = match name {
        "Schedule" => ("due", true, Lanes::Horizontal, true),
        "Kanban" => ("status", false, Lanes::Vertical, false),
        _ => return None,
    };
    Some(QueryDef {
        title: name.into(),
        types: vec!["task".into()],
        r#match: Match::All,
        filters: vec![FilterItem::Filter { key: "status".into(), op: Op::StateIsNot, value: Value::String("cancelled".into()), src: None }],
        sort: vec![Sort { by: "due".into(), order: Order::Asc }, Sort { by: "priority".into(), order: Order::Asc }],
        limit: 50,
        view: View::Board,
        group_by: Some(group_by.into()),
        lanes,
        lane_order: None,
        columns: Vec::new(),
        group_period: period,
        done_lane: Some(DoneLane { within_days: 7, folded }),
    })
}

/// §25.2: the outcome of `Core::task_views_migrate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskViewsMigration {
    /// Task has a `views` key, any value (`views: []` included).
    NotNeeded,
    /// `task.yml` is Newer, invalid, or its `views` unreadable: nothing written.
    Skipped,
    /// `created`: vault paths; `views`: the names written.
    Done { created: Vec<String>, views: Vec<String> },
    /// A create or the views write failed; `reason` = the error kind. Files already created stay.
    Stopped { created: Vec<String>, reason: String },
}

/// §25.3: the outcome of `Core::task_views_restore`.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskViewsRestore {
    /// Vault paths of the default files created, in R202 order.
    pub created: Vec<String>,
    /// The `views` names written; None when `views:` was already complete.
    pub names: Option<Vec<String>>,
    /// `TypeInfo.views_source` before the write (None: no `views` key).
    pub before: Option<String>,
    /// After.
    pub info: TypeInfo,
}

/// The Task type file as on disk now (bytes and version), or None without a file (the built-in definition, D-90).
struct TaskFile {
    info: TypeInfo,
    base: Option<FileVersion>,
}

/// A short name of an error's kind (`Stopped.reason`).
fn kind_of(e: &CoreError) -> String {
    let head = |s: String| s.split(['(', ' ', '{']).next().unwrap_or("").to_string();
    match e {
        CoreError::Vault(v) => head(format!("{v:?}")),
        CoreError::Query(q) => head(format!("{q:?}")),
        CoreError::Schema(SchemaError::Rule(r)) => head(format!("{r:?}")),
        CoreError::Schema(s) => head(format!("{s:?}")),
        other => head(format!("{other:?}")),
    }
}

impl Core {
    fn task_file(&self) -> Result<TaskFile, CoreError> {
        let path = format!("{TYPES_DIR}/{TASK_YML}");
        match self.shared.vault.read(&path) {
            Ok((bytes, v)) => Ok(TaskFile { info: crate::types3d::info("task", Some(&bytes), Some(v.clone())), base: Some(v) }),
            Err(VaultError::NotFound) => Ok(TaskFile { info: crate::types3d::info("task", None, None), base: None }),
            Err(VaultError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(TaskFile { info: crate::types3d::info("task", None, None), base: None }),
            Err(e) => Err(e.into()),
        }
    }

    /// §25.2 step 2: creates the default file `name` unless a live query resolves to it (D-1434). Ok(Some(path)) when
    /// created, Ok(None) when the name is taken (a create race's `NameTaken` included).
    fn create_default_view(&self, name: &str, now: &str) -> Result<Option<String>, CoreError> {
        let q = self.q();
        if q.taken(name) {
            return Ok(None);
        }
        let def = default_task_view(name).expect("a default task view name");
        match q.create_query_file(name, &queries_q::create_text(&def, now, None)) {
            Ok(_) => Ok(Some(nfc(&format!("{QUERIES_DIR}/{name}.yml")))),
            Err(CoreError::Query(QueryError::NameTaken)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// R202 (§25.2, D-1901, D-1919): writes the default task views and `task.yml`'s `views:` once. Never alerts; the
    /// caller ignores the outcome except for logging. `Core::open` never calls it (zero-write open); the app calls it
    /// for a newly opened core, tests call it directly.
    pub fn task_views_migrate(&self, now: &str) -> TaskViewsMigration {
        let file = match self.task_file() {
            Ok(f) => f,
            Err(e) => return TaskViewsMigration::Stopped { created: Vec::new(), reason: kind_of(&e) },
        };
        if file.base.is_some() {
            if file.info.readability != Readability::Ok || file.info.views_unreadable {
                return TaskViewsMigration::Skipped;
            }
            if file.info.def.views.is_some() {
                return TaskViewsMigration::NotNeeded;
            }
        }
        let mut created = Vec::new();
        for name in TASK_VIEW_NAMES {
            match self.create_default_view(name, now) {
                Ok(Some(p)) => created.push(p),
                Ok(None) => {}
                Err(e) => return TaskViewsMigration::Stopped { created, reason: kind_of(&e) },
            }
        }
        let views: Vec<String> = TASK_VIEW_NAMES.iter().map(|s| s.to_string()).collect();
        // A changed `task.yml` since the read above is a Conflict: nothing written, the next open retries (FR-QRY-07 AC-29).
        match self.type_patch("task", file.base.as_ref(), &[TypeOp::SetViews(views.clone())]) {
            Ok(_) => TaskViewsMigration::Done { created, views },
            Err(e) => TaskViewsMigration::Stopped { created, reason: kind_of(&e) },
        }
    }

    /// R202 `Restore default views` (§25.3, CP-26, D-1918): creates the missing default files (exclusively), then writes
    /// `views:` with `Schedule` first and `Kanban` right after it when missing. `Err(Query(NothingToDo))` when both names
    /// are listed and resolve to live queries. A refused type write returns its error; files already created stay.
    pub fn task_views_restore(&self, base: Option<&FileVersion>, now: &str) -> Result<TaskViewsRestore, CoreError> {
        let file = self.task_file()?;
        match &file.info.readability {
            Readability::Newer(_) => return Err(CoreError::Schema(SchemaError::NewerVersion)),
            Readability::Invalid { .. } => return Err(CoreError::Schema(SchemaError::Invalid)),
            Readability::Ok => {}
        }
        if file.info.views_unreadable {
            return Err(CoreError::Schema(SchemaError::Rule(RuleError::ViewsUnreadable)));
        }
        let names: Vec<String> = file.info.def.views.clone().unwrap_or_default();
        let listed = |n: &str| names.iter().any(|x| name_key(x) == name_key(n));
        let q = self.q();
        if TASK_VIEW_NAMES.iter().all(|n| listed(n) && q.taken(n)) {
            return Err(CoreError::Query(QueryError::NothingToDo));
        }
        let before = file.info.views_source.clone().filter(|_| file.info.def.views.is_some());
        let mut created = Vec::new();
        for name in TASK_VIEW_NAMES {
            if let Some(p) = self.create_default_view(name, now)? {
                created.push(p);
            }
        }
        let mut next = names.clone();
        if !listed("Schedule") {
            next.insert(0, "Schedule".into());
        }
        if !listed("Kanban") {
            let at = next.iter().position(|x| name_key(x) == name_key("Schedule")).map(|i| i + 1).unwrap_or(0);
            next.insert(at, "Kanban".into());
        }
        if next == names && file.info.def.views.is_some() {
            return Ok(TaskViewsRestore { created, names: None, before, info: file.info });
        }
        let info = self.type_patch("task", base, &[TypeOp::SetViews(next.clone())])?;
        Ok(TaskViewsRestore { created, names: Some(next), before, info })
    }
}
