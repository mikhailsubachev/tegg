//! Slice Q IPC (docs/contracts/v1-queries.md §2; FR-QRY-01…09, FR-SYN-03 AC-28, AC-29): saved queries in
//! `.tegg/queries/`, the query block's runs and the `query-rename` job. The DTOs are the contract's, hand-written in
//! `app/ui/src/ipc/queries.ts` (as pins). Errors: `Conflict` (payload `disk`: the query as on disk now), `Gone`,
//! `NewerVersion`, `Unreadable`, `NameTaken`, `EmptyName`, `NotFound`, `Limit`, `NothingToDo`, `Io`, `NoVault`.
//! `query_run` never fails for a file state (they are `lookup` / `form`). Slice Q2-T (v1-views §27): period groupings,
//! the done lane, state operators, task rows and `task_views_restore`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use tegg_core::queries_q::{
    Broken, BrokenReason, FilterItem, Form, GroupKind, Grouping, Lane, LaneKind, Lanes, Lookup, Match, Op, Order, QueryCreate, QueryDef, QueryEnv,
    QueryError, QueryRead, QueryResult, QueryRow, QuerySource, QuerySummary, QueryUsage, RunState, Sort, UsageKind, UsageRun, View, ViewUsage,
};
use tegg_core::queries_q::{DayGroup, DoneLane};
use tegg_core::tegg_jobs::{JobError, JobOp};
use tegg_core::{Core, CoreError, VaultError};

use crate::dto::{LinkTargetDto, TaskDefsDto, TaskRowDto, TypeDto, VersionDto};
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

/// v1-views §2: `sort` is the list of levels; `groupBy`, `lanes`, `laneOrder` are the board keys (R185).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDefDto {
    pub title: String,
    pub types: Vec<String>,
    pub r#match: String,
    pub filters: Vec<FilterItemDto>,
    pub sort: Vec<SortDto>,
    pub limit: u32,
    /// `list`, `table` or `board`.
    pub view: String,
    pub group_by: Option<String>,
    /// `vertical` or `horizontal`.
    pub lanes: String,
    pub lane_order: Option<Vec<String>>,
    pub columns: Vec<String>,
    /// Slice Q2-T (v1-views §27.2, CP-23): `groupBy` is a period mapping `{ <key>: period }`. Missing reads as false.
    #[serde(default)]
    pub group_period: bool,
    /// Slice Q2-T (R201): null = no `done_lane` (a commit with null removes the key, §24.3). Missing reads as null.
    #[serde(default)]
    pub done_lane: Option<DoneLaneDto>,
}

/// Slice Q2-T (v1-views §27.2, R201).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneLaneDto {
    pub within_days: u32,
    pub folded: bool,
}

/// Slice Q2-T (v1-views §27.2, R203): one day of the `period:week` lane.
#[derive(Debug, Clone, Serialize)]
pub struct DayGroupDto {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub cards: Vec<LaneCardDto>,
}

/// v1-views §2 (R187): one card of a lane: `row` indexes `QueryResultDto.rows`.
#[derive(Debug, Clone, Serialize)]
pub struct LaneCardDto {
    pub row: usize,
    pub raw: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneDto {
    pub id: String,
    /// `option`, `unknown`, `tag`, `relation`, `unresolved`, `none`, `period` or `done`.
    pub kind: String,
    pub value: Option<String>,
    pub label: String,
    pub color: Option<String>,
    pub target: Option<String>,
    pub excluded: bool,
    pub drop_target: bool,
    pub cards: Vec<LaneCardDto>,
    /// Slice Q2-T: the `period:week` lane's day groups; [] otherwise.
    pub days: Vec<DayGroupDto>,
    /// Slice Q2-T: the done lane's and the limited Done-state option lanes' `within_days`; else null.
    pub done_within: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingDto {
    pub key: String,
    /// `select`, `multiSelect`, `tags`, `relation` or `period`.
    pub kind: String,
    /// A relation's `multiple`; false for the other kinds.
    pub multiple: bool,
    pub name: String,
    pub lanes: Vec<LaneDto>,
    /// Slice Q2-T: a period grouping by a Date-time attribute, `created` or `modified` (no drops, D-1917).
    pub date_time: bool,
}

/// v1-views §2 (D-1804): a type file whose `views:` lists a query.
#[derive(Debug, Clone, Serialize)]
pub struct ViewUsageDto {
    pub r#type: String,
    pub path: String,
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
    /// v1-views §2: `list`, `table` or `board`; null when unreadable.
    pub view: Option<String>,
    /// v1-views §2: the query's types; null when unreadable.
    pub types: Option<Vec<String>>,
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
    /// v1-views §17.3 (D-1853): a view tab, the first `views:` item named `name` of type `type`.
    View { r#type: String, name: String },
}

/// v1-views §17.3 (R194): a usage's own values, broken entries and effective values.
#[derive(Debug, Clone, Serialize)]
pub struct UsageOwnDto {
    pub sort: Option<Vec<SortDto>>,
    pub columns: Option<Vec<String>>,
}
#[derive(Debug, Clone, Serialize)]
pub struct UsageRunDto {
    /// `tab` or `block`.
    pub kind: String,
    pub own: UsageOwnDto,
    pub broken: Vec<BrokenDto>,
    pub sort: Vec<SortDto>,
    pub columns: Vec<String>,
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
#[serde(rename_all = "camelCase")]
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
    /// v1-views §2: the index's version of the file (a card move's base), its excerpt, and not UTF-8.
    pub version: VersionDto,
    pub excerpt: String,
    pub read_only: bool,
    /// Slice Q2-T (v1-views §24.1): the tag keys (NFC, case-folded), sorted, unique.
    pub tags: Vec<String>,
    /// Slice Q2-T (CP-24, D-1916): ms5-tasks §3's row for an object of type `task`; else null.
    pub task_row: Option<TaskRowDto>,
    /// Slice OC (v1-cards §3.3): the card data on board runs; null on List and Table runs.
    pub card: Option<crate::shellcards::CardDataDto>,
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
    /// v1-views §2: a board's lanes; null unless `view: board` with a valid `group_by`.
    pub group: Option<GroupingDto>,
    /// v1-views §17.3 (D-1854): a tab's or a reference block's usage; null otherwise.
    pub usage: Option<UsageRunDto>,
    /// Slice Q2-T (CP-24, D-1916): the Task definitions when any row has `taskRow`; else null.
    pub task_defs: Option<TaskDefsDto>,
}

/// Slice Q2-T (v1-views §25.3, §27.2): what `task_views_restore` did; `type` is the Task type after the write.
#[derive(Debug, Clone, Serialize)]
pub struct TaskViewsRestoreDto {
    pub created: Vec<String>,
    pub names: Option<Vec<String>>,
    pub before: Option<String>,
    pub r#type: TypeDto,
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
        sort: d.sort.into_iter().map(|s| SortDto { by: s.by, order: if s.order == Order::Desc { "desc" } else { "asc" }.into() }).collect(),
        limit: d.limit,
        view: view_str(d.view).into(),
        group_by: d.group_by,
        lanes: if d.lanes == Lanes::Horizontal { "horizontal" } else { "vertical" }.into(),
        lane_order: d.lane_order,
        columns: d.columns,
        group_period: d.group_period,
        done_lane: d.done_lane.map(|x| DoneLaneDto { within_days: x.within_days, folded: x.folded }),
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
        sort: d.sort.into_iter().map(|s| Sort { by: s.by, order: if s.order == "desc" { Order::Desc } else { Order::Asc } }).collect(),
        limit: d.limit,
        view: match d.view.as_str() {
            "table" => View::Table,
            "board" => View::Board,
            _ => View::List,
        },
        group_by: d.group_by,
        lanes: if d.lanes == "horizontal" { Lanes::Horizontal } else { Lanes::Vertical },
        lane_order: d.lane_order,
        columns: d.columns,
        // v1-views §24.3: `groupPeriod` with `groupBy`; a null `doneLane` removes the key when the file has one.
        group_period: d.group_period,
        done_lane: d.done_lane.map(|x| DoneLane { within_days: x.within_days, folded: x.folded }),
    })
}

fn view_str(v: View) -> &'static str {
    match v {
        View::List => "list",
        View::Table => "table",
        View::Board => "board",
    }
}

fn lane_dto(l: Lane) -> LaneDto {
    let kind = match l.kind {
        LaneKind::Option => "option",
        LaneKind::Unknown => "unknown",
        LaneKind::Tag => "tag",
        LaneKind::Relation => "relation",
        LaneKind::Unresolved => "unresolved",
        LaneKind::None => "none",
        LaneKind::Period => "period",
        LaneKind::Done => "done",
    };
    LaneDto {
        id: l.id,
        kind: kind.into(),
        value: l.value,
        label: l.label,
        color: l.color,
        target: l.target,
        excluded: l.excluded,
        drop_target: l.drop_target,
        cards: l.cards.into_iter().map(card_dto).collect(),
        days: l.days.into_iter().map(|d: DayGroup| DayGroupDto { date: d.date.format("%Y-%m-%d").to_string(), cards: d.cards.into_iter().map(card_dto).collect() }).collect(),
        done_within: l.done_within,
    }
}

fn card_dto(c: tegg_core::queries_q::LaneCard) -> LaneCardDto {
    LaneCardDto { row: c.row, raw: c.raw }
}

fn grouping_dto(g: Grouping) -> GroupingDto {
    let (kind, multiple, date_time) = match g.kind {
        GroupKind::Select => ("select", false, false),
        GroupKind::MultiSelect => ("multiSelect", false, false),
        GroupKind::Tags => ("tags", false, false),
        GroupKind::Relation { multiple } => ("relation", multiple, false),
        GroupKind::Period { date_time } => ("period", false, date_time),
    };
    GroupingDto { key: g.key, kind: kind.into(), multiple, name: g.name, lanes: g.lanes.into_iter().map(lane_dto).collect(), date_time }
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
        view: s.view.map(|v| view_str(v).into()),
        types: s.types,
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
        links: r.links.into_iter().map(crate::link_dto).collect(),
        task: r.task.map(|t| QueryTaskDto { status: t.status, state: t.state.as_str().into(), due: t.due.map(|d| d.format("%Y-%m-%d").to_string()) }),
        version: version_dto(&r.version),
        excerpt: r.excerpt,
        read_only: r.read_only,
        tags: r.tags,
        task_row: r.task_row.map(crate::task_dto),
        card: r.card.map(crate::shellcards::card_dto),
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
        group: r.group.map(grouping_dto),
        usage: r.usage.map(usage_run_dto),
        task_defs: r.task_defs.map(crate::task_defs_dto),
    }
}

fn sort_dtos(l: Vec<Sort>) -> Vec<SortDto> {
    l.into_iter().map(|s| SortDto { by: s.by, order: if s.order == Order::Desc { "desc" } else { "asc" }.into() }).collect()
}

fn usage_run_dto(u: UsageRun) -> UsageRunDto {
    UsageRunDto {
        kind: match u.kind {
            UsageKind::Tab => "tab",
            UsageKind::Block => "block",
        }
        .into(),
        own: UsageOwnDto { sort: u.own.sort.map(sort_dtos), columns: u.own.columns },
        broken: u.broken.into_iter().map(broken_dto).collect(),
        sort: sort_dtos(u.sort),
        columns: u.columns,
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
            QueryError::IndexNotReady => err("IndexNotReady", "the index is still loading"),
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
        // §11 (D-1510, FR-QRY-06 AC-22).
        JobError::IndexNotReady => err("IndexNotReady", "the index is still loading"),
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
        QuerySourceDto::View { r#type, name } => QuerySource::View { type_key: r#type, name },
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

/// v1-views §2 (D-1804): the type files whose `views:` lists `name` (read-only).
#[tauri::command]
pub async fn query_view_usages(state: State<'_, AppState>, name: String) -> Result<Vec<ViewUsageDto>, IpcError> {
    Ok(core(&state)?.query_view_usages(&name).into_iter().map(|u: ViewUsage| ViewUsageDto { r#type: u.type_key, path: u.path }).collect())
}

/// Slice Q2-T (v1-views §25.3, §27.1; CP-26, D-1918): `Restore default views`. Errors as `type_patch` (`Conflict` with
/// `disk`, `NewerVersion`, `Invalid`, `Rule` `viewsUnreadable`, `Io`) plus `NothingToDo` when nothing is missing.
#[tauri::command]
pub async fn task_views_restore(state: State<'_, AppState>, base: Option<VersionDto>, now: String) -> Result<TaskViewsRestoreDto, IpcError> {
    let core = core(&state)?;
    let base = base.as_ref().map(version_from).transpose()?;
    match core.task_views_restore(base.as_ref(), &now) {
        Ok(r) => Ok(TaskViewsRestoreDto { created: r.created, names: r.names, before: r.before, r#type: crate::type_dto(r.info) }),
        Err(CoreError::Query(QueryError::NothingToDo)) => Err(err("NothingToDo", "the default views are there")),
        Err(e) => Err(crate::type_err(&core, "task", e)),
    }
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
            "sort": [{ "by": "due", "order": "asc" }, { "by": "title", "order": "desc" }], "limit": 50, "view": "board",
            "groupBy": "status", "lanes": "horizontal", "laneOrder": ["Done"], "columns": ["status"]
        }))
        .expect("def parses");
        let d = def_from(def).expect("def converts");
        assert_eq!((d.r#match, d.view, d.filters.len(), d.sort.len(), d.lanes), (Match::Any, View::Board, 3, 2, Lanes::Horizontal));
        let v = serde_json::to_value(def_dto(d)).expect("serializes");
        assert_eq!((v["sort"][1]["order"].as_str(), v["groupBy"].as_str(), v["laneOrder"][0].as_str(), v["view"].as_str()), (Some("desc"), Some("status"), Some("Done"), Some("board")), "{v}");
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
