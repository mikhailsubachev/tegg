//! v1-views §25 (Q2-T, R202; D-1777, D-1897, D-1901, D-1902, D-1913, D-1918, D-1919): the default task views
//! `Schedule` and `Kanban`, their migration and `Restore default views`. The query files are created exclusively (never
//! replacing a file, a live query of the name is left alone), then `task.yml`'s `views:` is written with one minimal,
//! base-checked write (`type_patch`). No restore point, no job. AR-03: platform-neutral (files through `Vault`).

use tegg_format::nfc;
use tegg_schema::{Readability, RuleError, SchemaError, TypeOp, TYPES_DIR};
use tegg_vault::VaultError;

use crate::queries_q::{self, name_key, QueryDef, QueryError, QUERIES_DIR};
use crate::{Core, CoreError, FileVersion, TypeInfo};

pub const TASK_VIEW_NAMES: [&str; 2] = ["Schedule", "Kanban"];

const TASK_YML: &str = "task.yml";

/// R202's bytes of `Schedule` (D-1936, D-2195): constants, equal to
/// tests/fixtures/queries-files/expected/views-tasks/queries/schedule-default.yml, so the new words of `create_text`
/// (v1-views §34.3) never reach them.
pub const SCHEDULE_TEXT: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Schedule.
version: 1
title: Schedule
types: [task]
match: all
filters:
  - status: { state_is_not: cancelled }
sort:
  - { by: due, order: asc }
  - { by: priority, order: asc }
limit: 50
view: board
group_by: { due: period }
lanes: horizontal
done_lane: { within_days: 7, folded: true }
";
/// R202's bytes of `Kanban` (D-2195), equal to expected/views-tasks/queries/kanban-default.yml.
pub const KANBAN_TEXT: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Kanban.
version: 1
title: Kanban
types: [task]
match: all
filters:
  - status: { state_is_not: cancelled }
sort:
  - { by: due, order: asc }
  - { by: priority, order: asc }
limit: 50
view: board
group_by: status
lanes: vertical
done_lane: { within_days: 7, folded: false }
";

/// R202's def of `Schedule` or `Kanban` (None for any other name): `read` of `default_task_view_text` (D-2195).
pub fn default_task_view(name: &str) -> Option<QueryDef> {
    default_task_view_text(name).map(|t| queries_q::read(t.as_bytes()).def)
}

/// R202's bytes of `Schedule` or `Kanban` (D-1936, D-2195): the constants, without `created` / `modified`, so every Mac
/// writes the same bytes. None for any other name.
pub fn default_task_view_text(name: &str) -> Option<String> {
    match name {
        "Schedule" => Some(SCHEDULE_TEXT.to_string()),
        "Kanban" => Some(KANBAN_TEXT.to_string()),
        _ => None,
    }
}

/// §25.2: the outcome of `Core::task_views_migrate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskViewsMigration {
    /// Task has a `views` key, any value (`views: []` included).
    NotNeeded,
    /// `task.yml` is missing, Newer, invalid, or its `views` unreadable, or the vault has online-only placeholders
    /// (D-1936): nothing written.
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
    fn create_default_view(&self, name: &str) -> Result<Option<String>, CoreError> {
        let q = self.q();
        if q.taken(name) {
            return Ok(None);
        }
        let text = default_task_view_text(name).expect("a default task view name");
        match q.create_query_file(name, &text) {
            Ok(_) => Ok(Some(nfc(&format!("{QUERIES_DIR}/{name}.yml")))),
            Err(CoreError::Query(QueryError::NameTaken)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// R202 (§25.2, D-1901, D-1919, D-1936): writes the default task views and `task.yml`'s `views:` once. Never alerts;
    /// the caller ignores the outcome except for logging. `Core::open` never calls it (zero-write open); the app calls
    /// it for a newly opened core, tests call it directly. Skips (writes nothing) when unsure on a synced vault: no
    /// `task.yml` yet, or online-only placeholders. `_now` is unused: the default files carry no time stamps (D-1936).
    pub fn task_views_migrate(&self, _now: &str) -> TaskViewsMigration {
        let file = match self.task_file() {
            Ok(f) => f,
            Err(e) => return TaskViewsMigration::Stopped { created: Vec::new(), reason: kind_of(&e) },
        };
        if file.base.is_none() || !self.placeholders().is_empty() {
            return TaskViewsMigration::Skipped;
        }
        if file.info.readability != Readability::Ok || file.info.views_unreadable {
            return TaskViewsMigration::Skipped;
        }
        if file.info.def.views.is_some() {
            return TaskViewsMigration::NotNeeded;
        }
        let mut created = Vec::new();
        for name in TASK_VIEW_NAMES {
            match self.create_default_view(name) {
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
    /// `_now` is unused: the default files carry no time stamps (D-1936).
    pub fn task_views_restore(&self, base: Option<&FileVersion>, _now: &str) -> Result<TaskViewsRestore, CoreError> {
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
            if let Some(p) = self.create_default_view(name)? {
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
