//! Slice Q IPC (docs/contracts/v1-queries.md §2; FR-QRY-01…09, FR-SYN-03 AC-28, AC-29): saved queries in
//! `.tegg/queries/`, the query block's runs and the `query-rename` job. The DTOs are the contract's, hand-written in
//! `app/ui/src/ipc/queries.ts` (as pins). Errors: `Conflict` (payload `disk`: the query as on disk now), `Gone`,
//! `NewerVersion`, `Unreadable`, `NameTaken`, `EmptyName`, `NotFound`, `Limit`, `NothingToDo`, `Io`, `NoVault`.
//! `query_run` never fails for a file state (they are `lookup` / `form`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use tegg_core::queries_q::{
    Broken, BrokenReason, FilterItem, Form, Lookup, Match, Op, Order, QueryCreate, QueryDef, QueryEnv, QueryError, QueryRead, QueryResult,
    QueryRow, QuerySource, QuerySummary, QueryUsage, RunState, Sort, View,
};
use tegg_core::tegg_jobs::{JobError, JobOp};
use tegg_core::{Core, CoreError, VaultError};

use crate::dto::{LinkTargetDto, VersionDto};
use crate::{core, core_err, err, version_dto, version_from, AppState, IpcError};

// ------------------------------------------------------------------------------------------------ DTOs (§2)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FilterItemDto {
    Filter { key: String, op: String, value: Value, src: Option<Vec<usize>> },
    Group { r#match: String, filters: Vec<FilterItemDto>, src: Option<Vec<usize>> },
    Raw { src: Vec<usize> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortDto {
    pub by: String,
    pub order: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryDefDto {
    pub title: String,
    pub types: Vec<String>,
    pub r#match: String,
    pub filters: Vec<FilterItemDto>,
    pub sort: SortDto,
    pub limit: u32,
    pub view: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrokenDto {
    pub reason: String,
    pub at: Option<Vec<usize>>,
    pub key: String,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySummaryDto {
    pub name: String,
    pub title: String,
    pub path: String,
    pub state: String,
    pub line: Option<u32>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub uses_this: bool,
    pub version: VersionDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDto {
    pub name: String,
    pub path: String,
    pub state: String,
    pub line: Option<u32>,
    pub reason: Option<String>,
    pub version: Option<VersionDto>,
    pub text: Option<String>,
    pub def: Option<QueryDefDto>,
    pub broken: Vec<BrokenDto>,
    pub uses_this: bool,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub trashed_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum QuerySourceDto {
    Saved { name: String },
    Fence { body: String },
    Def { def: QueryDefDto, name: Option<String> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEnvDto {
    pub today: String,
    pub zone: String,
    /// ISO 1 (Monday) … 7 (Sunday).
    pub week_start: u32,
    pub locale: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryTaskDto {
    pub status: Option<String>,
    pub state: String,
    pub due: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub values: serde_json::Map<String, Value>,
    pub links: Vec<LinkTargetDto>,
    pub task: Option<QueryTaskDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultDto {
    pub form: String,
    pub name: Option<String>,
    pub lookup: Option<String>,
    pub line: Option<u32>,
    pub version: Option<VersionDto>,
    pub def: Option<QueryDefDto>,
    pub state: String,
    pub broken: Vec<BrokenDto>,
    pub targets: Vec<String>,
    pub uses_relative: bool,
    pub total: usize,
    pub rows: Vec<QueryRowDto>,
    pub index_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryUsageDto {
    pub path: String,
    pub title: String,
    pub r#type: Option<String>,
    pub template: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryApplyDto {
    pub query: QueryDto,
    /// The bytes before the commit (its Undo, `query_revert`); null when nothing was written.
    pub undo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryJobDto {
    pub job_id: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryTrashedDto {
    pub trashed: String,
}

/// `query:stale` (§1.7).
#[derive(Debug, Clone, Serialize)]
pub struct QueryStaleDto {
    pub types: Vec<String>,
    pub paths: Vec<String>,
}

/// The Q fields of an `IpcError` (flattened into it): `disk` with `Conflict`.
#[derive(Debug, Clone, Serialize)]
pub struct QueryErrorExtra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disk: Option<Box<QueryDto>>,
}

// ------------------------------------------------------------------------------------------------ conversions

fn match_str(m: Match) -> &'static str {
    match m {
        Match::All => "all",
        Match::Any => "any",
    }
}

fn item_dto(i: FilterItem) -> FilterItemDto {
    match i {
        FilterItem::Filter { key, op, value, src } => FilterItemDto::Filter { key, op: op.as_str().into(), value, src },
        FilterItem::Group { r#match, filters, src } => FilterItemDto::Group { r#match: match_str(r#match).into(), filters: filters.into_iter().map(item_dto).collect(), src },
        FilterItem::Raw { src } => FilterItemDto::Raw { src },
    }
}

pub(crate) fn def_dto(d: QueryDef) -> QueryDefDto {
    QueryDefDto {
        title: d.title,
        types: d.types,
        r#match: match_str(d.r#match).into(),
        filters: d.filters.into_iter().map(item_dto).collect(),
        sort: SortDto { by: d.sort.by, order: if d.sort.order == Order::Desc { "desc" } else { "asc" }.into() },
        limit: d.limit,
        view: if d.view == View::Table { "table" } else { "list" }.into(),
        columns: d.columns,
    }
}

fn item_from(i: FilterItemDto) -> Result<FilterItem, IpcError> {
    Ok(match i {
        FilterItemDto::Filter { key, op, value, src } => FilterItem::Filter { key, op: Op::parse(&op).ok_or_else(|| err("Io", format!("unknown operator {op}")))?, value, src },
        FilterItemDto::Group { r#match, filters, src } => FilterItem::Group {
            r#match: if r#match == "any" { Match::Any } else { Match::All },
            filters: filters.into_iter().map(item_from).collect::<Result<_, _>>()?,
            src,
        },
        FilterItemDto::Raw { src } => FilterItem::Raw { src },
    })
}

pub(crate) fn def_from(d: QueryDefDto) -> Result<QueryDef, IpcError> {
    Ok(QueryDef {
        title: d.title,
        types: d.types,
        r#match: if d.r#match == "any" { Match::Any } else { Match::All },
        filters: d.filters.into_iter().map(item_from).collect::<Result<_, _>>()?,
        sort: Sort { by: d.sort.by, order: if d.sort.order == "desc" { Order::Desc } else { Order::Asc } },
        limit: d.limit,
        view: if d.view == "table" { View::Table } else { View::List },
        columns: d.columns,
    })
}

fn broken_dto(b: Broken) -> BrokenDto {
    let reason = match b.reason {
        BrokenReason::BadValue => "badValue",
        BrokenReason::Shape => "shape",
        BrokenReason::Operator => "operator",
        BrokenReason::NestedGroup => "nestedGroup",
        BrokenReason::NotAttribute => "notAttribute",
        BrokenReason::OperatorKind => "operatorKind",
        BrokenReason::Value => "value",
        BrokenReason::NoType => "noType",
    };
    BrokenDto { reason: reason.into(), at: b.at, key: b.key, r#type: b.r#type }
}

fn lookup_str(l: Lookup) -> &'static str {
    match l {
        Lookup::Ok => "ok",
        Lookup::Newer => "newer",
        Lookup::Unreadable => "unreadable",
        Lookup::Missing => "missing",
        Lookup::Trashed => "trashed",
    }
}

fn summary_dto(s: QuerySummary) -> QuerySummaryDto {
    QuerySummaryDto {
        name: s.name,
        title: s.title,
        path: s.path,
        state: lookup_str(s.lookup).into(),
        line: s.line,
        created: s.created,
        modified: s.modified,
        uses_this: s.uses_this,
        version: version_dto(&s.version),
    }
}

pub(crate) fn query_dto(q: QueryRead) -> QueryDto {
    QueryDto {
        name: q.name,
        path: q.path,
        state: lookup_str(q.lookup).into(),
        line: q.line,
        reason: q.reason,
        version: q.version.as_ref().map(version_dto),
        text: q.text,
        def: q.def.map(def_dto),
        broken: q.broken.into_iter().map(broken_dto).collect(),
        uses_this: q.uses_this,
        created: q.created,
        modified: q.modified,
        trashed_path: q.trashed_path,
    }
}

fn row_dto(r: QueryRow) -> QueryRowDto {
    QueryRowDto {
        path: r.path,
        id: r.id,
        title: r.title,
        r#type: r.r#type,
        created: r.created,
        modified: r.modified,
        values: r.values,
        links: Vec::new(),
        task: r.task.map(|t| QueryTaskDto { status: t.status, state: t.state.as_str().into(), due: t.due.map(|d| d.format("%Y-%m-%d").to_string()) }),
    }
}

fn result_dto(r: QueryResult) -> QueryResultDto {
    let form = match r.form {
        Form::Reference => "reference",
        Form::Inline => "inline",
        Form::Unreadable => "unreadable",
        Form::Empty => "empty",
        Form::Def => "def",
    };
    let state = match r.state {
        RunState::Ok => "ok",
        RunState::NoType => "noType",
        RunState::NeedsHost => "needsHost",
        RunState::NeedsContext => "needsContext",
    };
    QueryResultDto {
        form: form.into(),
        name: r.name,
        lookup: r.lookup.map(|l| lookup_str(l).into()),
        line: r.line,
        version: r.version.as_ref().map(version_dto),
        def: r.def.map(def_dto),
        state: state.into(),
        broken: r.broken.into_iter().map(broken_dto).collect(),
        targets: r.targets,
        uses_relative: r.uses_relative,
        total: r.rows.len(),
        rows: r.rows.into_iter().map(row_dto).collect(),
        index_ready: r.index_ready,
    }
}

fn usage_dto(u: QueryUsage) -> QueryUsageDto {
    QueryUsageDto { path: u.path, title: u.title, r#type: u.r#type, template: u.template }
}

fn env_from(e: &QueryEnvDto) -> Result<QueryEnv, IpcError> {
    let today = chrono::NaiveDate::parse_from_str(&e.today, "%Y-%m-%d").map_err(|_| err("Io", "malformed date"))?;
    // D-104, D-1449: dates compare in the zone the UI sends; an unknown zone is refused, never read as UTC
    // (`Io`, as a malformed date: v1-queries §2's kinds).
    let tz: chrono_tz::Tz = e.zone.parse().map_err(|_| err("Io", "malformed zone"))?;
    let week_start = match e.week_start {
        2 => chrono::Weekday::Tue,
        3 => chrono::Weekday::Wed,
        4 => chrono::Weekday::Thu,
        5 => chrono::Weekday::Fri,
        6 => chrono::Weekday::Sat,
        7 => chrono::Weekday::Sun,
        _ => chrono::Weekday::Mon,
    };
    Ok(QueryEnv { today, tz, week_start, locale: e.locale.clone() })
}

/// §2's error kinds; a `Conflict` carries the query as on disk now.
pub(crate) fn query_err(core: &Core, name: &str, e: CoreError) -> IpcError {
    match e {
        CoreError::Vault(VaultError::Conflict { .. }) => {
            IpcError { query: Some(QueryErrorExtra { disk: Some(Box::new(query_dto(core.query(name)))) }), ..err("Conflict", "the query file changed on disk") }
        }
        CoreError::Vault(VaultError::Gone) => err("Gone", "the query file was deleted"),
        CoreError::Query(q) => match q {
            QueryError::NewerVersion => err("NewerVersion", "made by a newer version of Tegg"),
            QueryError::Unreadable => err("Unreadable", "the query file can't be read"),
            QueryError::NameTaken => err("NameTaken", "a query with this name exists"),
            QueryError::EmptyName => err("EmptyName", "a query needs a name"),
            QueryError::NotFound => err("NotFound", "no such query"),
            QueryError::Limit => err("Limit", "the limit is outside 1…1000"),
            QueryError::NothingToDo => err("NothingToDo", "nothing to do"),
        },
        // Everything else is `Io` (§2.1): the UI shows `query.saveFailed`.
        other => match core_err(other) {
            e if e.kind == "Io" => e,
            e => err("Io", e.message),
        },
    }
}

fn job_refusal(e: JobError) -> IpcError {
    match e {
        JobError::QueryExists { name } => IpcError { name: Some(name.clone()), ..err("NameTaken", format!("{name} already exists")) },
        JobError::QueryUnreadable => err("Unreadable", "the query can't be read"),
        JobError::NotFound => err("NotFound", "no such query"),
        JobError::NothingToDo => err("NothingToDo", "the same name"),
        JobError::InvalidName { .. } => err("EmptyName", "a query needs a name"),
        other => crate::job_err(other),
    }
}

// ------------------------------------------------------------------------------------------------ commands

#[tauri::command]
pub async fn queries_list(state: State<'_, AppState>) -> Result<Vec<QuerySummaryDto>, IpcError> {
    Ok(core(&state)?.queries().into_iter().map(summary_dto).collect())
}

#[tauri::command]
pub async fn query_get(state: State<'_, AppState>, name: String) -> Result<QueryDto, IpcError> {
    Ok(query_dto(core(&state)?.query(&name)))
}

#[tauri::command]
pub async fn query_run(state: State<'_, AppState>, source: QuerySourceDto, host: Option<String>, env: QueryEnvDto) -> Result<QueryResultDto, IpcError> {
    let core = core(&state)?;
    let env = env_from(&env)?;
    let src = match source {
        QuerySourceDto::Saved { name } => QuerySource::Saved(name),
        QuerySourceDto::Fence { body } => QuerySource::Fence(body),
        QuerySourceDto::Def { def, name } => QuerySource::Def { def: def_from(def)?, name },
    };
    Ok(result_dto(core.query_run(src, host.as_deref(), &env)))
}

#[tauri::command]
pub async fn query_apply(state: State<'_, AppState>, name: String, base: VersionDto, def: QueryDefDto, now: String) -> Result<QueryApplyDto, IpcError> {
    let core = core(&state)?;
    let base = version_from(&base)?;
    let before = core.query(&name);
    let r = core.query_apply(&name, &base, def_from(def)?, &now).map_err(|e| query_err(&core, &name, e))?;
    let undo = (r.version.as_ref().is_some_and(|v| !v.same_content(&base))).then_some(before.text).flatten();
    Ok(QueryApplyDto { query: query_dto(r), undo })
}

#[tauri::command]
pub async fn query_revert(state: State<'_, AppState>, name: String, base: VersionDto, text: String) -> Result<QueryDto, IpcError> {
    let core = core(&state)?;
    let base = version_from(&base)?;
    core.query_revert(&name, &base, &text).map(query_dto).map_err(|e| query_err(&core, &name, e))
}

#[tauri::command]
pub async fn query_create(state: State<'_, AppState>, title: String, def: Option<QueryDefDto>, fence: Option<String>, free: bool, now: String) -> Result<QueryDto, IpcError> {
    let core = core(&state)?;
    let def = def.map(def_from).transpose()?;
    core.query_create(QueryCreate { title: title.clone(), def, fence, free }, &now).map(query_dto).map_err(|e| query_err(&core, &title, e))
}

#[tauri::command]
pub async fn query_duplicate(state: State<'_, AppState>, name: String, now: String) -> Result<QueryDto, IpcError> {
    let core = core(&state)?;
    core.query_duplicate(&name, &now).map(query_dto).map_err(|e| query_err(&core, &name, e))
}

#[tauri::command]
pub async fn query_rename(state: State<'_, AppState>, name: String, title: String) -> Result<QueryJobDto, IpcError> {
    let core = core(&state)?;
    let id = core.jobs().start(JobOp::QueryRename { name, title }).map_err(job_refusal)?;
    Ok(QueryJobDto { job_id: id as u32 })
}

#[tauri::command]
pub async fn query_trash(state: State<'_, AppState>, name: String) -> Result<QueryTrashedDto, IpcError> {
    let core = core(&state)?;
    core.query_trash(&name).map(|trashed| QueryTrashedDto { trashed }).map_err(|e| query_err(&core, &name, e))
}

#[tauri::command]
pub async fn query_restore(state: State<'_, AppState>, name: String) -> Result<QueryDto, IpcError> {
    let core = core(&state)?;
    core.query_restore(&name).map(query_dto).map_err(|e| query_err(&core, &name, e))
}

#[tauri::command]
pub async fn query_usages(state: State<'_, AppState>, name: String) -> Result<Vec<QueryUsageDto>, IpcError> {
    Ok(core(&state)?.query_usages(&name).into_iter().map(usage_dto).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_dtos_serialize_as_the_contract_says() {
        let def: QueryDefDto = serde_json::from_value(serde_json::json!({
            "title": "Dotaz", "types": ["task"], "match": "any",
            "filters": [{ "kind": "filter", "key": "status", "op": "is_not", "value": "Done", "src": [0] },
                        { "kind": "group", "match": "all", "filters": [], "src": null }, { "kind": "raw", "src": [2] }],
            "sort": { "by": "due", "order": "asc" }, "limit": 50, "view": "table", "columns": ["status"]
        }))
        .expect("def parses");
        let d = def_from(def).expect("def converts");
        assert_eq!((d.r#match, d.view, d.filters.len()), (Match::Any, View::Table, 3));
        let v = serde_json::to_value(def_dto(d)).expect("serializes");
        assert_eq!((v["filters"][0]["kind"].as_str(), v["filters"][0]["op"].as_str(), v["filters"][1]["match"].as_str()), (Some("filter"), Some("is_not"), Some("all")), "{v}");
        let src: QuerySourceDto = serde_json::from_value(serde_json::json!({ "kind": "fence", "body": "saved: A\n" })).expect("source");
        assert!(matches!(src, QuerySourceDto::Fence { .. }));
        let env: QueryEnvDto = serde_json::from_value(serde_json::json!({ "today": "2026-11-10", "zone": "Europe/Prague", "weekStart": 7, "locale": "cs" })).expect("env");
        assert_eq!(env_from(&env).map(|e| e.week_start).ok(), Some(chrono::Weekday::Sun));
        let bad: QueryEnvDto = serde_json::from_value(serde_json::json!({ "today": "2026-11-10", "zone": "Mars/Olympus", "weekStart": 1, "locale": "cs" })).expect("env");
        assert_eq!(env_from(&bad).err().map(|e| e.kind), Some("Io".to_string()), "an unknown zone is an error, not UTC (D-104)");
        let e = IpcError { query: Some(QueryErrorExtra { disk: None }), ..err("Gone", "x") };
        let v = serde_json::to_value(&e).expect("serializes");
        assert!(v.get("disk").is_none(), "{v}");
    }
}
