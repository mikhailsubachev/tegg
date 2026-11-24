//! Slice Q (docs/contracts/v1-queries.md §1; R138…R146; D-1433…D-1504): saved queries in `.tegg/queries/<name>.yml`,
//! the ```` ```query ```` block's fence forms, and the evaluator over the index. Platform-neutral (AR-03): files go
//! through `Vault`, the index through the core's lock (one lock per evaluation, D-1448). No query definition is stored
//! in the index (AR-01, FR-STO-06 AC-3); nothing is cached: every call reads the files.
//!
//! Reading (R138, R139) parses values with `yaml_rust2`; writing (R138 write rules, D-1436, D-1454…D-1458) replaces only
//! the lines of the top-level keys whose effective value changed, with the graph presets' line scanner; every other
//! byte (comments, unknown keys, CRLF, a missing final newline, a BOM) stays, and every write is read back first.
//! The TypeScript twin is `app/ui/test/fake-queries.ts` (L3: `tests/fixtures/queries-files/`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock, Mutex};

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, TimeZone};
use serde_json::{json, Value};
use tegg_format::nfc;
use tegg_index::QueryObject;
use tegg_jobs::host::QueryPatch;
use tegg_vault::{VaultError, WriteOutcome};
use yaml_rust2::{Yaml, YamlLoader};

use crate::graph_presets::{blank, comment, content, indent, join, key_at, open_flow_line, split, Line};
use crate::yaml_text::top;
use crate::{lock, Core, CoreError, CoreEvent, FileVersion, LinkTarget, TaskDefs, TaskRow, TaskState};

pub const QUERIES_DIR: &str = ".tegg/queries";
pub const TRASHED_QUERIES_DIR: &str = ".trash/.tegg/queries";
pub const QUERY_VERSION: u32 = 1;
/// The first line of a file Tegg creates: HEADER + title + ".".
pub const HEADER: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ";

/// R138 create order (v1-views §1.4, D-1783); also the order "the nearest earlier / later known key" is looked up in.
/// Q2-T (v1-views §24.3, R201): `done_lane` right after `lane_order`.
const ORDER: [&str; 15] = ["version", "title", "types", "match", "filters", "sort", "limit", "view", "group_by", "lanes", "lane_order", "done_lane", "columns", "created", "modified"];
/// The keys a commit compares (the title is the rename job's, D-1454).
const COMMIT_KEYS: [&str; 11] = ["types", "match", "filters", "sort", "limit", "view", "group_by", "lanes", "lane_order", "done_lane", "columns"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Match {
    All,
    Any,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    List,
    Table,
    /// Slice Q2 (v1-views §1.1, R185); slice Q3 renames Board to Wall (v1-views §34.1, D-2172): written `wall`, the old
    /// word `board` read as Wall (D-2179).
    Wall,
}
/// Wall lanes (v1-views §1.1, R185); slice Q3 renames Vertical / Horizontal to Columns / Rows (§34.1): written
/// `columns` / `rows`, the old words read as them (D-2179). A missing `lanes` reads as Columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lanes {
    Columns,
    Rows,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Order {
    Asc,
    Desc,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sort {
    pub by: String,
    pub order: Order,
}

impl Match {
    fn as_str(self) -> &'static str {
        match self {
            Match::All => "all",
            Match::Any => "any",
        }
    }
}
impl View {
    fn as_str(self) -> &'static str {
        match self {
            View::List => "list",
            View::Table => "table",
            View::Wall => "wall",
        }
    }
}
impl Lanes {
    fn as_str(self) -> &'static str {
        match self {
            Lanes::Columns => "columns",
            Lanes::Rows => "rows",
        }
    }
}
impl Order {
    fn as_str(self) -> &'static str {
        match self {
            Order::Asc => "asc",
            Order::Desc => "desc",
        }
    }
}

/// R139 operators; `as_str()` / `parse()` use the YAML names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Is,
    IsNot,
    Contains,
    IsEmpty,
    IsNotEmpty,
    IsAnyOf,
    HasAnyOf,
    HasAllOf,
    HasNoneOf,
    Before,
    After,
    Between,
    Today,
    ThisWeek,
    WithinNextDays,
    Overdue,
    Eq,
    Ne,
    Lt,
    Gt,
    LinksTo,
    /// v1-views §24.1, §24.4 (Q2-T, AP-1533): `state_is` / `state_is_not` on a Select that carries states.
    StateIs,
    StateIsNot,
}

const OPS: [Op; 23] = [
    Op::Is,
    Op::IsNot,
    Op::Contains,
    Op::IsEmpty,
    Op::IsNotEmpty,
    Op::IsAnyOf,
    Op::HasAnyOf,
    Op::HasAllOf,
    Op::HasNoneOf,
    Op::Before,
    Op::After,
    Op::Between,
    Op::Today,
    Op::ThisWeek,
    Op::WithinNextDays,
    Op::Overdue,
    Op::Eq,
    Op::Ne,
    Op::Lt,
    Op::Gt,
    Op::LinksTo,
    Op::StateIs,
    Op::StateIsNot,
];

impl Op {
    pub fn as_str(self) -> &'static str {
        match self {
            Op::Is => "is",
            Op::IsNot => "is_not",
            Op::Contains => "contains",
            Op::IsEmpty => "is_empty",
            Op::IsNotEmpty => "is_not_empty",
            Op::IsAnyOf => "is_any_of",
            Op::HasAnyOf => "has_any_of",
            Op::HasAllOf => "has_all_of",
            Op::HasNoneOf => "has_none_of",
            Op::Before => "before",
            Op::After => "after",
            Op::Between => "between",
            Op::Today => "today",
            Op::ThisWeek => "this_week",
            Op::WithinNextDays => "within_next_days",
            Op::Overdue => "overdue",
            Op::Eq => "eq",
            Op::Ne => "ne",
            Op::Lt => "lt",
            Op::Gt => "gt",
            Op::LinksTo => "links_to",
            Op::StateIs => "state_is",
            Op::StateIsNot => "state_is_not",
        }
    }
    pub fn parse(s: &str) -> Option<Op> {
        OPS.iter().copied().find(|o| o.as_str() == s)
    }
}

/// `src`: where the item came from in the file (top-level index, then the index inside its group), so a commit can keep
/// an unchanged item's lines (§1.4). None for an item made in the editor.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterItem {
    Filter { key: String, op: Op, value: Value, src: Option<Vec<usize>> },
    Group { r#match: Match, filters: Vec<FilterItem>, src: Option<Vec<usize>> },
    Raw { src: Vec<usize> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryDef {
    pub title: String,
    pub types: Vec<String>,
    pub r#match: Match,
    pub filters: Vec<FilterItem>,
    /// The levels as written, in file order (repeats kept, v1-views §1.2); a missing or broken `sort` reads as
    /// `[modified desc]`, `sort: []` as `[]` (D-1806).
    pub sort: Vec<Sort>,
    pub limit: u32,
    pub view: View,
    /// `group_by` as written (NFC, trimmed); None = absent or broken. In a commit None means "unchanged" (§1.4).
    pub group_by: Option<String>,
    pub lanes: Lanes,
    /// None = key absent (the default order); a commit with None removes the key (Reset lane order, D-1792).
    pub lane_order: Option<Vec<String>>,
    pub columns: Vec<String>,
    /// Q2-T (v1-views §24.1, CP-23, D-1915): `group_by` was the mapping `{ <key>: period }`. Always false when
    /// `group_by` is None.
    pub group_period: bool,
    /// Q2-T (R201, D-1898): None = key absent, or present and broken (then in `broken`). A commit with None removes the
    /// key (§24.3).
    pub done_lane: Option<DoneLane>,
    /// Q3 (v1-views §34.1; D-2191, CP-32, D-2197): the file says `group_by: none`. Always false when `group_by` is
    /// Some. In a commit, `group_by: None` with `group_none: true` removes a valid `group_by` line (§34.3).
    pub group_none: bool,
}

/// v1-views §24.1 (Q2-T, R201): `within_days` 1…366; a missing `folded` reads as false.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DoneLane {
    pub within_days: u32,
    pub folded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileState {
    Ok,
    Newer { version: u64 },
    Unreadable { line: Option<u32>, reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokenReason {
    BadValue,
    Shape,
    Operator,
    NestedGroup,
    NotAttribute,
    OperatorKind,
    Value,
    NoType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Broken {
    pub reason: BrokenReason,
    pub at: Option<Vec<usize>>,
    pub key: String,
    pub r#type: Option<String>,
}

/// One top-level key's lines (`start..end`, 0-based, the trailing comment / blank lines left out).
#[derive(Debug, Clone, PartialEq, Eq)]
struct KeyRange {
    key: String,
    start: usize,
    end: usize,
}

/// One item of a `filters:` block list.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ItemRange {
    start: usize,
    end: usize,
    dash: usize,
    children: Option<Vec<ItemRange>>,
}

/// The line layout of a readable file (private): what a commit patches.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Layout {
    lines: Vec<Line>,
    keys: Vec<KeyRange>,
    items: Option<Vec<ItemRange>>,
    eol: String,
    final_nl: bool,
    header: usize,
    bom: bool,
    /// Top-level keys as written (NFC).
    present: Vec<String>,
    /// `title` / `columns` were read from the file (not a default).
    title_set: bool,
    columns_set: bool,
    readable: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryFile {
    pub state: FileState,
    pub def: QueryDef,
    pub broken: Vec<Broken>,
    pub uses_this: bool,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub(crate) layout: Layout,
}

#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum FenceRead {
    Empty,
    Reference { name: String },
    Inline(QueryFile),
    Unreadable { line: u32 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryEnv {
    pub today: NaiveDate,
    pub tz: chrono_tz::Tz,
    pub week_start: chrono::Weekday,
    pub locale: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum QuerySource {
    Saved(String),
    Fence(String),
    Def { def: QueryDef, name: Option<String> },
    /// v1-views §17.1 (D-1853): a view tab, the first `views:` item named `name` of type `type_key`.
    View { type_key: String, name: String },
}

/// v1-views §17.1 (R194): a usage's kind, its own values as read and its effective values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageKind {
    Tab,
    Block,
}
/// Q3 (v1-views §34.1): a usage's own grouping as read.
pub use tegg_format::usage::{UsageGroupBy, UsageLanes, UsageView};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageSettings {
    pub sort: Option<Vec<Sort>>,
    pub columns: Option<Vec<String>>,
    /// Q3 (v1-views §34.1): None = absent or broken (then in `UsageRun.broken`); `group_by` valid at run time;
    /// `lane_order: Some(vec![])` = `lane_order: []`; `widths` in file order, keys NFC.
    pub view: Option<View>,
    pub group_by: Option<UsageGroupBy>,
    pub lanes: Option<Lanes>,
    pub lane_order: Option<Vec<String>>,
    pub widths: Option<Vec<(String, u32)>>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageRun {
    pub kind: UsageKind,
    pub own: UsageSettings,
    pub broken: Vec<Broken>,
    pub sort: Vec<Sort>,
    pub columns: Vec<String>,
    /// Q3 effective values (v1-views §34.1, R220): the own valid value, else the query file's (`group_by` None: not
    /// grouped; `widths`: the own valid widths, else empty).
    pub view: View,
    pub group_by: Option<String>,
    pub group_period: bool,
    pub lanes: Lanes,
    pub lane_order: Option<Vec<String>>,
    pub widths: Vec<(String, u32)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Reference,
    Inline,
    Unreadable,
    Empty,
    Def,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    Ok,
    Newer,
    Unreadable,
    Missing,
    Trashed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Ok,
    NoType,
    NeedsHost,
    NeedsContext,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskBits {
    pub status: Option<String>,
    pub state: TaskState,
    pub due: Option<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub values: serde_json::Map<String, Value>,
    pub links: Vec<LinkTarget>,
    pub task: Option<TaskBits>,
    /// v1-views §1.1: the index's version of the file (a card move's base), its excerpt, and whether it isn't UTF-8.
    pub version: FileVersion,
    pub excerpt: String,
    pub read_only: bool,
    /// Q2-T (v1-views §24.1): the object's tag keys (frontmatter and inline, tags.md R79: NFC, case-folded), sorted,
    /// unique.
    pub tags: Vec<String>,
    /// Q2-T (CP-24, D-1916): for an object of type `task`, ms5-tasks §2.1's `TaskRow`, from the same index read.
    pub task_row: Option<TaskRow>,
    /// v1-cards §3.3 (slice OC): the card data on board runs (every row, its own type's keys); None on List and Table.
    pub card: Option<crate::cards::CardData>,
}

/// v1-views §1.1 (R187): a board's lanes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaneKind {
    Option,
    Unknown,
    Tag,
    Relation,
    Unresolved,
    None,
    /// Q2-T (v1-views §24.1): the period lanes `period:today|week|later` and the done lane `done`.
    Period,
    Done,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneCard {
    pub row: usize,
    pub raw: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lane {
    pub id: String,
    pub kind: LaneKind,
    pub value: Option<String>,
    pub label: String,
    pub color: Option<String>,
    pub target: Option<String>,
    pub excluded: bool,
    pub drop_target: bool,
    pub cards: Vec<LaneCard>,
    /// Q2-T: the `week` lane's day groups, every day from tomorrow to the week's last day (empty ones included);
    /// empty for every other lane.
    pub days: Vec<DayGroup>,
    /// Q2-T: Some(n) on the done lane and on each Done-state option lane that `done_lane` limits (R201); else None.
    pub done_within: Option<u32>,
}
/// v1-views §24.1 (Q2-T, R203): one day of the `week` lane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayGroup {
    pub date: NaiveDate,
    pub cards: Vec<LaneCard>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupKind {
    Select,
    MultiSelect,
    Tags,
    Relation { multiple: bool },
    /// Q2-T (v1-views §24.4): a period grouping; `date_time` for a Date-time attribute, `created` or `modified`.
    Period { date_time: bool },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grouping {
    pub key: String,
    pub kind: GroupKind,
    pub name: String,
    pub lanes: Vec<Lane>,
}
/// A type file that lists a query in `views:` (v1-views §1.1, D-1804).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewUsage {
    pub type_key: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryResult {
    pub form: Form,
    pub name: Option<String>,
    pub lookup: Option<Lookup>,
    pub line: Option<u32>,
    pub version: Option<FileVersion>,
    pub def: Option<QueryDef>,
    pub state: RunState,
    pub broken: Vec<Broken>,
    pub targets: Vec<String>,
    pub uses_relative: bool,
    pub rows: Vec<QueryRow>,
    pub index_ready: bool,
    /// v1-views §1.1: Some only with `view: board` and a valid `group_by` (§1.6).
    pub group: Option<Grouping>,
    /// v1-views §17.1 (D-1854): a tab's or a reference block's own and effective `sort` / `columns`; None for
    /// `query/<name>`, inline fences, the editor's def and queries without a def.
    pub usage: Option<UsageRun>,
    /// Q2-T (CP-24, D-1916): `Core::task_defs()` when any row has `task_row`; else None.
    pub task_defs: Option<TaskDefs>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuerySummary {
    pub name: String,
    pub title: String,
    pub path: String,
    pub lookup: Lookup,
    pub line: Option<u32>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub uses_this: bool,
    pub version: FileVersion,
    /// v1-views §1.1: None when Unreadable.
    pub view: Option<View>,
    pub types: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryRead {
    pub name: String,
    pub path: String,
    pub lookup: Lookup,
    pub line: Option<u32>,
    pub reason: Option<String>,
    pub version: Option<FileVersion>,
    pub text: Option<String>,
    pub def: Option<QueryDef>,
    pub broken: Vec<Broken>,
    pub uses_this: bool,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub trashed_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryUsage {
    pub path: String,
    pub title: String,
    pub r#type: Option<String>,
    pub template: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError {
    NewerVersion,
    Unreadable,
    NameTaken,
    EmptyName,
    NotFound,
    Limit,
    NothingToDo,
    /// §11 (D-1510): the first index build after open hasn't ended; a rename waits for it (FR-QRY-06 AC-22).
    IndexNotReady,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryCreate {
    pub title: String,
    pub def: Option<QueryDef>,
    pub fence: Option<String>,
    pub free: bool,
}

// ------------------------------------------------------------------------------------------------ names and values

fn trim_ws(s: &str) -> &str {
    s.trim_matches(char::is_whitespace)
}

/// D-1434: names compare trimmed, NFC, case-insensitively (no locale), as graph presets (D-907).
pub fn name_key(s: &str) -> String {
    nfc(trim_ws(s)).to_lowercase()
}

fn default_def(title: &str, columns: Vec<String>) -> QueryDef {
    QueryDef {
        title: nfc(title),
        types: Vec::new(),
        r#match: Match::All,
        filters: Vec::new(),
        sort: vec![Sort { by: "modified".into(), order: Order::Desc }],
        limit: 50,
        view: View::List,
        group_by: None,
        lanes: Lanes::Columns,
        lane_order: None,
        columns,
        group_period: false,
        done_lane: None,
        group_none: false,
    }
}

/// The default `columns` without a schema: `[modified]` for one type (the twin's rule), else `[type, modified]`.
fn columns_no_schema(types: &[String]) -> Vec<String> {
    if types.len() == 1 {
        vec!["modified".into()]
    } else {
        vec!["type".into(), "modified".into()]
    }
}

/// A YAML value as JSON: strings and keys NFC (R139).
fn json_of(y: &Yaml) -> Value {
    match y {
        Yaml::String(s) => Value::String(nfc(s)),
        Yaml::Integer(n) => json!(*n),
        Yaml::Real(r) => r.parse::<f64>().ok().and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or(Value::Null),
        Yaml::Boolean(b) => Value::Bool(*b),
        Yaml::Array(a) => Value::Array(a.iter().map(json_of).collect()),
        Yaml::Hash(h) => Value::Object(h.iter().map(|(k, v)| (nfc(&key_text(k)), json_of(v))).collect()),
        _ => Value::Null,
    }
}

fn key_text(k: &Yaml) -> String {
    match k {
        Yaml::String(s) => s.clone(),
        Yaml::Integer(n) => n.to_string(),
        Yaml::Real(r) => r.clone(),
        Yaml::Boolean(b) => b.to_string(),
        _ => String::new(),
    }
}

/// A value normalised for comparisons (strings and keys NFC).
fn norm_value(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(nfc(s)),
        Value::Array(a) => Value::Array(a.iter().map(norm_value).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, x)| (nfc(k), norm_value(x))).collect()),
        other => other.clone(),
    }
}

/// `YYYY-MM-DDTHH:MM[:SS[.f]](Z|±HH:MM)` (ISO 8601 with an offset).
fn iso_dt(s: &str) -> bool {
    let b = s.as_bytes();
    let d = |i: usize| b.get(i).is_some_and(u8::is_ascii_digit);
    if b.len() < 17 || !(0..4).all(d) || b[4] != b'-' || !d(5) || !d(6) || b[7] != b'-' || !d(8) || !d(9) || b[10] != b'T' || !d(11) || !d(12) || b[13] != b':' || !d(14) || !d(15) {
        return false;
    }
    let mut i = 16;
    if b.get(i) == Some(&b':') {
        if !d(i + 1) || !d(i + 2) {
            return false;
        }
        i += 3;
        if b.get(i) == Some(&b'.') {
            i += 1;
            let s0 = i;
            while d(i) {
                i += 1;
            }
            if i == s0 {
                return false;
            }
        }
    }
    match b.get(i) {
        Some(b'Z') => i + 1 == b.len(),
        Some(b'+' | b'-') => i + 6 == b.len() && d(i + 1) && d(i + 2) && b[i + 3] == b':' && d(i + 4) && d(i + 5),
        _ => false,
    }
}

fn parse_dt(s: &str) -> Option<DateTime<FixedOffset>> {
    if !iso_dt(s) {
        return None;
    }
    DateTime::parse_from_rfc3339(s).ok().or_else(|| {
        // No seconds: `…T10:00+01:00`.
        let (a, b) = s.split_at(16);
        DateTime::parse_from_rfc3339(&format!("{a}:00{b}")).ok()
    })
}

fn parse_day(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    (s.len() == 10).then(|| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()).flatten()
}

// ------------------------------------------------------------------------------------------------ reading (R138, R139)

fn unreadable_file(line: Option<u32>, reason: impl Into<String>) -> QueryFile {
    QueryFile {
        state: FileState::Unreadable { line, reason: reason.into() },
        def: default_def("", columns_no_schema(&[])),
        broken: Vec::new(),
        uses_this: false,
        created: None,
        modified: None,
        layout: Layout::default(),
    }
}

fn str_list(y: &Yaml) -> Option<Vec<String>> {
    match y {
        Yaml::Array(a) => a.iter().map(|v| v.as_str().map(str::to_string)).collect(),
        _ => None,
    }
}

/// One `sort` level (v1-views §1.2): a mapping with a non-blank string `by` and an `order` of asc / desc / missing.
fn sort_level(v: &Yaml) -> Option<Sort> {
    let Yaml::Hash(_) = v else { return None };
    let Yaml::String(by) = &v["by"] else { return None };
    if trim_ws(by).is_empty() {
        return None;
    }
    let order = match &v["order"] {
        Yaml::BadValue | Yaml::Null => Order::Asc,
        Yaml::String(s) if s == "asc" => Order::Asc,
        Yaml::String(s) if s == "desc" => Order::Desc,
        _ => return None,
    };
    Some(Sort { by: nfc(trim_ws(by)), order })
}

/// Parses one filter item (R139) at `src`; `in_group`: nested groups are `NestedGroup`.
fn read_item(raw: &Yaml, src: Vec<usize>, in_group: bool, broken: &mut Vec<Broken>) -> FilterItem {
    let mut bad = |reason: BrokenReason, key: String, src: Vec<usize>| {
        broken.push(Broken { reason, at: Some(src.clone()), key, r#type: None });
        FilterItem::Raw { src }
    };
    let Yaml::Hash(h) = raw else {
        let key = raw.as_str().map(nfc).unwrap_or_default();
        return bad(BrokenReason::Shape, key, src);
    };
    let Some((k0, v)) = h.iter().next() else { return bad(BrokenReason::Shape, String::new(), src) };
    let key = nfc(&key_text(k0));
    if key == "group" {
        if in_group {
            return bad(BrokenReason::NestedGroup, key, src);
        }
        let Yaml::Hash(g) = v else { return bad(BrokenReason::Shape, key, src) };
        let m = match g.get(&Yaml::String("match".into())) {
            None => Some(Match::All),
            Some(Yaml::String(s)) if s == "all" => Some(Match::All),
            Some(Yaml::String(s)) if s == "any" => Some(Match::Any),
            Some(_) => None,
        };
        let fl = match g.get(&Yaml::String("filters".into())) {
            None => Some(Vec::new()),
            Some(Yaml::Array(a)) => Some(a.clone()),
            Some(_) => None,
        };
        let (Some(m), Some(fl)) = (m, fl) else { return bad(BrokenReason::Shape, key, src) };
        let filters = fl
            .iter()
            .enumerate()
            .map(|(j, x)| {
                let mut s = src.clone();
                s.push(j);
                read_item(x, s, true, broken)
            })
            .collect();
        return FilterItem::Group { r#match: m, filters, src: Some(src) };
    }
    match v {
        Yaml::Array(_) => bad(BrokenReason::Shape, key, src),
        Yaml::Hash(ops) => {
            let mut it = ops.iter();
            match (it.next(), it.next()) {
                (Some((o, val)), None) => match o.as_str().and_then(Op::parse) {
                    Some(op) => FilterItem::Filter { key, op, value: json_of(val), src: Some(src) },
                    None => bad(BrokenReason::Operator, key, src),
                },
                _ => bad(BrokenReason::Operator, key, src),
            }
        }
        other => FilterItem::Filter { key, op: Op::Is, value: json_of(other), src: Some(src) },
    }
}

fn uses_this_in(items: &[FilterItem]) -> bool {
    items.iter().any(|i| match i {
        FilterItem::Filter { value, .. } => value.as_str() == Some("this"),
        FilterItem::Group { filters, .. } => uses_this_in(filters),
        FilterItem::Raw { .. } => false,
    })
}

fn rank(b: &Broken) -> usize {
    let pos = |k: &str| ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
    let base = if b.reason == BrokenReason::NoType {
        pos("types")
    } else if b.at.is_none() {
        pos(&b.key)
    } else {
        pos("filters")
    };
    let at = b.at.clone().unwrap_or_default();
    base * 10000 + at.first().copied().unwrap_or(0) * 100 + at.get(1).copied().unwrap_or(0)
}

/// The text without a leading BOM, and whether it had one.
fn strip_bom(text: &str) -> (&str, bool) {
    match text.strip_prefix('\u{FEFF}') {
        Some(t) => (t, true),
        None => (text, false),
    }
}

/// Line ranges of the top-level keys and of the `filters:` items.
fn layout_of(text: &str, raw_items: Option<&[Yaml]>, bom: bool) -> Layout {
    let lines = split(text);
    let t: Vec<&str> = lines.iter().map(|l| l.body.as_str()).collect();
    let eol = lines.first().map(|l| l.eol.clone()).filter(|e| !e.is_empty()).unwrap_or_else(|| "\n".into());
    let final_nl = lines.last().is_none_or(|l| !l.eol.is_empty());
    let mut starts: Vec<(String, usize)> = Vec::new();
    for (i, b) in t.iter().enumerate() {
        if indent(b) != 0 || !content(b) || b.starts_with("---") || b.starts_with("...") {
            continue;
        }
        if let Some((k, _)) = key_at(b, 0) {
            starts.push((nfc(&k), i));
        }
    }
    let keys: Vec<KeyRange> = starts
        .iter()
        .enumerate()
        .map(|(n, (k, at))| {
            let mut end = starts.get(n + 1).map(|x| x.1).unwrap_or(t.len());
            while end > at + 1 && !content(t[end - 1]) {
                end -= 1;
            }
            KeyRange { key: k.clone(), start: *at, end }
        })
        .collect();
    let mut header = 0;
    while header < t.len() && comment(t[header]) {
        header += 1;
    }
    let f = keys.iter().find(|k| k.key == "filters");
    let items = match (f, raw_items) {
        (Some(f), Some(raw)) => {
            let colon = key_at(t[f.start], 0).map(|x| x.1).unwrap_or(0);
            let inline = t[f.start][colon + 1..].trim();
            if inline.is_empty() || inline.starts_with('#') {
                items_in(&t, f.start + 1, f.end, raw)
            } else if raw.is_empty() {
                Some(Vec::new())
            } else {
                None
            }
        }
        (None, _) => Some(Vec::new()),
        (Some(_), None) => None,
    };
    Layout { lines, keys, items, eol, final_nl, header, bom, readable: true, ..Default::default() }
}

fn is_dash(rest: &str) -> bool {
    rest == "-" || rest.starts_with("- ")
}

fn items_in(t: &[&str], from: usize, to: usize, raw: &[Yaml]) -> Option<Vec<ItemRange>> {
    let mut out: Vec<ItemRange> = Vec::new();
    let mut d: Option<usize> = None;
    for (i, b) in t.iter().enumerate().take(to).skip(from) {
        if !content(b) {
            continue;
        }
        let ind = indent(b);
        let dd = *d.get_or_insert(ind);
        if ind == dd && is_dash(&b[ind..]) {
            out.push(ItemRange { start: i, end: to, dash: dd, children: None });
        }
    }
    for n in 0..out.len().saturating_sub(1) {
        out[n].end = out[n + 1].start;
    }
    if out.len() != raw.len() {
        return None;
    }
    for (n, it) in out.iter_mut().enumerate() {
        let Yaml::Hash(h) = &raw[n] else { continue };
        let Some((k0, g)) = h.iter().next() else { continue };
        if k0.as_str() != Some("group") {
            continue;
        }
        let kids: Vec<Yaml> = match &g["filters"] {
            Yaml::Array(a) => a.clone(),
            _ => Vec::new(),
        };
        for i in it.start + 1..it.end {
            let s = t[i].trim_start();
            if let Some(rest) = s.strip_prefix("filters:") {
                let rest = rest.trim();
                if rest.is_empty() || rest.starts_with('#') {
                    it.children = items_in(t, i + 1, it.end, &kids);
                    break;
                }
            }
        }
    }
    Some(out)
}

/// The line of the first top-level key `k` (1-based).
fn line_of_key(text: &str, k: &str) -> Option<u32> {
    split(text).iter().position(|l| key_at(&l.body, 0).is_some_and(|(x, _)| nfc(&x) == k)).map(|i| i as u32 + 1)
}

/// R138 read rules (pure: no schema, no index, no disk). A missing or broken `title` reads as "", missing `columns` as
/// the no-schema default; the core fills both in from the file's name and the type's columns.
pub fn read(bytes: &[u8]) -> QueryFile {
    let Ok(text) = std::str::from_utf8(bytes) else { return unreadable_file(None, "The file isn't valid UTF-8.") };
    read_text(text)
}

fn read_text(text: &str) -> QueryFile {
    let (text, bom) = strip_bom(text);
    let docs = match YamlLoader::load_from_str(text) {
        Ok(d) => d,
        Err(e) => {
            let line = open_flow_line(text, e.marker().index()).or(Some(e.marker().line())).filter(|l| *l > 0);
            return unreadable_file(line.and_then(|l| u32::try_from(l).ok()), e.info().to_string());
        }
    };
    let mut def = default_def("", Vec::new());
    let top = match docs.into_iter().next() {
        None | Some(Yaml::Null) => {
            let mut layout = layout_of(text, Some(&[][..]), bom);
            def.columns = columns_no_schema(&[]);
            layout.readable = true;
            return QueryFile { state: FileState::Ok, def, broken: Vec::new(), uses_this: false, created: None, modified: None, layout };
        }
        Some(Yaml::Hash(h)) => h,
        Some(_) => return unreadable_file(Some(1), "The top level isn't a mapping."),
    };
    let get = |k: &str| top.get(&Yaml::String(k.into()));
    let version = match get("version") {
        None => 1,
        Some(Yaml::Integer(n)) if *n >= 1 => *n as u64,
        Some(_) => return unreadable_file(line_of_key(text, "version"), "`version` isn't a positive integer."),
    };
    let mut broken: Vec<Broken> = Vec::new();
    let mut bad_key = |k: &str| broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: k.into(), r#type: None });
    let mut title_set = false;
    if let Some(v) = get("title") {
        match v {
            Yaml::String(s) if !trim_ws(s).is_empty() => {
                def.title = nfc(trim_ws(s));
                title_set = true;
            }
            _ => bad_key("title"),
        }
    }
    if let Some(v) = get("types") {
        match str_list(v) {
            Some(l) => def.types = l.iter().map(|t| nfc(trim_ws(t))).collect(),
            None => bad_key("types"),
        }
    }
    if let Some(v) = get("match") {
        match v.as_str() {
            Some("all") => def.r#match = Match::All,
            Some("any") => def.r#match = Match::Any,
            _ => bad_key("match"),
        }
    }
    let raw_items: Option<Vec<Yaml>> = match get("filters") {
        None | Some(Yaml::Null) => Some(Vec::new()),
        Some(Yaml::Array(a)) => Some(a.clone()),
        Some(_) => {
            bad_key("filters");
            None
        }
    };
    if let Some(v) = get("sort") {
        // v1-views §1.2 (D-1768, D-1806): R138's single mapping, or a list of such mappings (`[]`: zero levels).
        let ok = match v {
            Yaml::Hash(_) => sort_level(v).map(|s| vec![s]),
            Yaml::Array(a) => a.iter().map(sort_level).collect::<Option<Vec<Sort>>>(),
            _ => None,
        };
        match ok {
            Some(levels) => def.sort = levels,
            None => bad_key("sort"),
        }
    }
    if let Some(v) = get("limit") {
        match v {
            Yaml::Integer(n) if (1..=1000).contains(n) => def.limit = *n as u32,
            _ => bad_key("limit"),
        }
    }
    if let Some(v) = get("view") {
        match v.as_str() {
            Some("list") => def.view = View::List,
            Some("table") => def.view = View::Table,
            // v1-views §34.2 (D-2172, D-2179): `wall`, and the old word `board` read as Wall.
            Some("wall") | Some("board") => def.view = View::Wall,
            _ => bad_key("view"),
        }
    }
    // v1-views §34.2 (R220): read with every display; the exact string `none` is "not grouped" (D-2191, CP-32, D-2197).
    if let Some(v) = get("group_by") {
        match v {
            Yaml::String(s) if s == "none" => def.group_none = true,
            _ => match group_by_of(v) {
                Some((key, period)) => {
                    def.group_by = Some(key);
                    def.group_period = period;
                }
                None => bad_key("group_by"),
            },
        }
    }
    if let Some(v) = get("lanes") {
        match v.as_str() {
            // v1-views §34.2 (D-2179): the old words `vertical` / `horizontal` read as Columns / Rows.
            Some("columns") | Some("vertical") => def.lanes = Lanes::Columns,
            Some("rows") | Some("horizontal") => def.lanes = Lanes::Rows,
            _ => bad_key("lanes"),
        }
    }
    if let Some(v) = get("lane_order") {
        match str_list(v) {
            Some(l) => def.lane_order = Some(l.iter().map(|x| nfc(x)).collect()),
            None => bad_key("lane_order"),
        }
    }
    // Q2-T (v1-views §24.2, R201): read with every `view`, used only by a board.
    if let Some(v) = get("done_lane") {
        match done_lane_of(v) {
            Some(d) => def.done_lane = Some(d),
            None => bad_key("done_lane"),
        }
    }
    let mut columns_set = false;
    match get("columns").map(str_list) {
        Some(Some(l)) => {
            def.columns = l.iter().map(|c| nfc(c)).collect();
            columns_set = true;
        }
        Some(None) => {
            bad_key("columns");
            def.columns = columns_no_schema(&def.types);
        }
        // Q2-T (v1-views §24.2, D-1927 RT-5): a board without `columns` reads as `[]` (a board never uses it, D-1891).
        None if def.view == View::Wall => def.columns = Vec::new(),
        None => def.columns = columns_no_schema(&def.types),
    }
    let mut filter_broken = Vec::new();
    def.filters = raw_items.as_deref().unwrap_or(&[]).iter().enumerate().map(|(i, r)| read_item(r, vec![i], false, &mut filter_broken)).collect();
    broken.extend(filter_broken);
    broken.sort_by_key(rank);
    let iso = |k: &str| get(k).and_then(|v| v.as_str()).filter(|s| iso_dt(s)).map(str::to_string);
    let mut layout = layout_of(text, raw_items.as_deref(), bom);
    layout.present = top.keys().map(|k| nfc(&key_text(k))).collect();
    layout.title_set = title_set;
    layout.columns_set = columns_set;
    let state = if version > u64::from(QUERY_VERSION) { FileState::Newer { version } } else { FileState::Ok };
    QueryFile { state, uses_this: uses_this_in(&def.filters), def, broken, created: iso("created"), modified: iso("modified"), layout }
}

/// v1-views §24.2 (R201): a non-blank string → (key, false); a mapping with exactly one entry `<non-blank key>: period`
/// → (key, true); None for every other value.
fn group_by_of(v: &Yaml) -> Option<(String, bool)> {
    match v {
        Yaml::String(s) if !trim_ws(s).is_empty() => Some((nfc(trim_ws(s)), false)),
        Yaml::Hash(h) if h.len() == 1 => match h.iter().next() {
            Some((Yaml::String(k), Yaml::String(p))) if !trim_ws(k).is_empty() && p == "period" => Some((nfc(trim_ws(k)), true)),
            _ => None,
        },
        _ => None,
    }
}

/// v1-views §24.2 (R201): a mapping with `within_days` an integer 1…366 and an optional boolean `folded`, no other entry.
fn done_lane_of(v: &Yaml) -> Option<DoneLane> {
    let Yaml::Hash(h) = v else { return None };
    let mut within: Option<u32> = None;
    let mut folded = false;
    for (k, x) in h {
        match (k.as_str()?, x) {
            ("within_days", Yaml::Integer(n)) if (1..=366).contains(n) => within = Some(*n as u32),
            ("folded", Yaml::Boolean(b)) => folded = *b,
            _ => return None,
        }
    }
    within.map(|within_days| DoneLane { within_days, folded })
}

/// The `columns` default of a file without the key: none on a board (v1-views §24.2), else the type's columns.
fn fill_columns(f: &mut QueryFile, defs: &Defs) {
    if !f.layout.columns_set {
        f.def.columns = if f.def.view == View::Wall { Vec::new() } else { columns_default(defs, &f.def.types) };
    }
}

/// R140: a fence body as written.
pub fn read_fence(body: &str) -> FenceRead {
    if body.lines().all(|l| blank(l) || comment(l)) {
        return FenceRead::Empty;
    }
    let docs = match YamlLoader::load_from_str(body) {
        Ok(d) => d,
        Err(e) => {
            let line = open_flow_line(body, e.marker().index()).or(Some(e.marker().line())).filter(|l| *l > 0).unwrap_or(1);
            return FenceRead::Unreadable { line: line as u32 };
        }
    };
    let Some(Yaml::Hash(h)) = docs.into_iter().next() else { return FenceRead::Unreadable { line: 1 } };
    match h.get(&Yaml::String("saved".into())) {
        Some(Yaml::String(s)) if !trim_ws(s).is_empty() => FenceRead::Reference { name: nfc(trim_ws(s)) },
        Some(_) => FenceRead::Unreadable { line: line_of_key(body, "saved").unwrap_or(1) },
        None => FenceRead::Inline(read_text(body)),
    }
}

// ------------------------------------------------------------------------------------------------ writing (§1.4)

/// D-230 (`yaml_text::scalar`): plain when YAML reads it back as the same string, else JSON double quotes. `flow`: also
/// valid inside a flow collection (`[a, b]`, `{ by: x }`).
fn scalar_in(v: &str, flow: bool) -> String {
    let s = nfc(v);
    let same = match top(&if flow { format!("k: [{s}]") } else { format!("k: {s}") }) {
        Some(y) if flow => matches!(&y["k"], Yaml::Array(a) if a.len() == 1 && a[0].as_str() == Some(s.as_str())),
        Some(y) => y["k"].as_str() == Some(s.as_str()),
        None => false,
    };
    let plain = !s.is_empty()
        && !s.starts_with(|c: char| c.is_whitespace() || "-?:,[]{}#&*!|>'\"%@`".contains(c))
        && !s.ends_with(char::is_whitespace)
        && !s.contains(": ")
        && !s.contains(" #")
        && (!flow || !s.contains([',', '[', ']', '{', '}']))
        && same;
    if plain {
        s
    } else {
        serde_json::to_string(&s).unwrap_or_default()
    }
}

fn value_text(v: &Value) -> String {
    match v {
        Value::String(s) => scalar_in(s, true),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => format!("[{}]", a.iter().map(value_text).collect::<Vec<_>>().join(", ")),
        Value::Object(m) => format!("{{ {} }}", m.iter().map(|(k, x)| format!("{}: {}", scalar_in(k, true), value_text(x))).collect::<Vec<_>>().join(", ")),
    }
}

fn flow_list(xs: &[String]) -> String {
    format!("[{}]", xs.iter().map(|x| scalar_in(x, true)).collect::<Vec<_>>().join(", "))
}

/// One item's lines at `dash` indent (R138 style).
fn item_lines(it: &FilterItem, dash: usize) -> Vec<String> {
    let d = " ".repeat(dash);
    match it {
        FilterItem::Group { r#match, filters, .. } => {
            let k = " ".repeat(dash + 4);
            let inner: Vec<String> = filters.iter().flat_map(|f| item_lines(f, dash + 6)).collect();
            let mut out = vec![format!("{d}- group:"), format!("{k}match: {}", r#match.as_str())];
            if inner.is_empty() {
                out.push(format!("{k}filters: []"));
            } else {
                out.push(format!("{k}filters:"));
                out.extend(inner);
            }
            out
        }
        FilterItem::Raw { .. } => Vec::new(),
        FilterItem::Filter { key, op, value, .. } => {
            let key = scalar_in(key, true);
            if *op == Op::Is {
                vec![format!("{d}- {key}: {}", value_text(value))]
            } else {
                vec![format!("{d}- {key}: {{ {}: {} }}", op.as_str(), value_text(value))]
            }
        }
    }
}

/// v1-views §1.4 (D-1768): one level → `sort: { by, order }`; two or more → `sort:` and one `  - { … }` line per level;
/// none → `sort: []` (D-1806).
fn sort_lines(levels: &[Sort]) -> Vec<String> {
    let one = |x: &Sort| format!("{{ by: {}, order: {} }}", scalar_in(&x.by, true), x.order.as_str());
    match levels {
        [] => vec!["sort: []".into()],
        [x] => vec![format!("sort: {}", one(x))],
        _ => std::iter::once("sort:".to_string()).chain(levels.iter().map(|x| format!("  - {}", one(x)))).collect(),
    }
}

/// The lines of one top-level key (none: the key isn't written, e.g. `lane_order: None`).
fn key_lines(k: &str, def: &QueryDef) -> Vec<String> {
    match k {
        "sort" => sort_lines(&def.sort),
        // v1-views §24.3 (R201): a period grouping is one flow mapping `group_by: { <key>: period }`.
        "group_by" => def.group_by.iter().map(|g| if def.group_period { format!("group_by: {{ {}: period }}", scalar_in(g, true)) } else { format!("group_by: {}", scalar_in(g, false)) }).collect(),
        "lanes" => vec![format!("lanes: {}", def.lanes.as_str())],
        "lane_order" => def.lane_order.iter().map(|o| format!("lane_order: {}", flow_list(o))).collect(),
        // v1-views §24.3: one flow line, both keys always written; None writes no line (the key is removed).
        "done_lane" => def.done_lane.iter().map(|d| format!("done_lane: {{ within_days: {}, folded: {} }}", d.within_days, d.folded)).collect(),
        other => top_line(other, def).into_iter().collect(),
    }
}

fn top_line(k: &str, def: &QueryDef) -> Option<String> {
    Some(match k {
        "types" => format!("types: {}", flow_list(&def.types)),
        "match" => format!("match: {}", def.r#match.as_str()),
        "limit" => format!("limit: {}", def.limit),
        "view" => format!("view: {}", def.view.as_str()),
        "columns" => format!("columns: {}", flow_list(&def.columns)),
        _ => return None,
    })
}

/// The semantic form of filters: `src` dropped except for raw items (which are their source, unless `keep_raw` is off).
fn norm_items(items: &[FilterItem], keep_raw: bool) -> Value {
    Value::Array(
        items
            .iter()
            .map(|i| match i {
                FilterItem::Filter { key, op, value, .. } => json!({ "k": "f", "key": nfc(key), "op": op.as_str(), "value": norm_value(value) }),
                FilterItem::Group { r#match, filters, .. } => json!({ "k": "g", "match": r#match.as_str(), "filters": norm_items(filters, keep_raw) }),
                FilterItem::Raw { src } => json!({ "k": "r", "src": if keep_raw { json!(src) } else { Value::Null } }),
            })
            .collect(),
    )
}

fn same_item(a: &FilterItem, b: &FilterItem) -> bool {
    norm_items(std::slice::from_ref(a), true) == norm_items(std::slice::from_ref(b), true)
}

fn effective(def: &QueryDef, k: &str, keep_raw: bool) -> Value {
    match k {
        "types" => json!(def.types.iter().map(|t| nfc(t)).collect::<Vec<_>>()),
        "match" => json!(def.r#match.as_str()),
        "filters" => norm_items(&def.filters, keep_raw),
        "sort" => json!(def.sort.iter().map(|s| json!([nfc(&s.by), s.order.as_str()])).collect::<Vec<_>>()),
        "limit" => json!(def.limit),
        "view" => json!(def.view.as_str()),
        // v1-views §24.3: the effective value is `(group_by, group_period)`.
        "group_by" => json!(def.group_by.as_ref().map(|g| (nfc(trim_ws(g)), def.group_period))),
        "done_lane" => json!(def.done_lane.map(|d| (d.within_days, d.folded))),
        "lanes" => json!(def.lanes.as_str()),
        "lane_order" => json!(def.lane_order.as_ref().map(|o| o.iter().map(|x| nfc(x)).collect::<Vec<_>>())),
        "columns" => json!(def.columns.iter().map(|c| nfc(c)).collect::<Vec<_>>()),
        _ => Value::Null,
    }
}

/// Index of a trailing comment's leading whitespace on a one-line value (outside quotes), if any.
fn trailing_comment_at(line: &str, from: usize) -> Option<usize> {
    let b = line.as_bytes();
    let mut q: Option<u8> = None;
    let mut i = from;
    while i < b.len() {
        let c = b[i];
        match q {
            Some(b'"') => {
                if c == b'\\' {
                    i += 1;
                } else if c == b'"' {
                    q = None;
                }
            }
            Some(_) => {
                if c == b'\'' {
                    q = None;
                }
            }
            None => {
                if c == b'"' || c == b'\'' {
                    q = Some(c);
                } else if c == b'#' && i > 0 && (b[i - 1] == b' ' || b[i - 1] == b'\t') {
                    let mut s = i;
                    while s > from && (b[s - 1] == b' ' || b[s - 1] == b'\t') {
                        s -= 1;
                    }
                    return Some(s);
                }
            }
        }
        i += 1;
    }
    None
}

/// The filters block of a commit: unchanged items keep their own lines (full-line comments dropped, D-1436); a changed
/// item's first line is re-emitted and its extra-key lines kept; raw items keep their lines.
fn filters_block(def: &QueryDef, file: &QueryFile) -> Vec<String> {
    if def.filters.is_empty() {
        return vec!["filters: []".into()];
    }
    let l = &file.layout;
    let t: Vec<&str> = l.lines.iter().map(|x| x.body.as_str()).collect();
    let old = &file.def.filters;
    let mut out = vec!["filters:".to_string()];
    for it in &def.filters {
        let src = match it {
            FilterItem::Filter { src, .. } | FilterItem::Group { src, .. } => src.clone(),
            FilterItem::Raw { src } => Some(src.clone()),
        };
        let at = src.filter(|s| s.len() == 1).map(|s| s[0]);
        let range = at.and_then(|a| l.items.as_ref().and_then(|v| v.get(a)));
        let was = at.and_then(|a| old.get(a));
        let reindent = |s: &str| -> String {
            match range {
                Some(r) if r.dash > 2 => s.get(r.dash - 2..).unwrap_or("").to_string(),
                Some(r) if r.dash < 2 => format!("{}{s}", " ".repeat(2 - r.dash)),
                _ => s.to_string(),
            }
        };
        let own: Vec<String> = range.map(|r| t[r.start..r.end].iter().filter(|x| content(x)).map(|x| reindent(x)).collect()).unwrap_or_default();
        if matches!(it, FilterItem::Raw { .. }) || (was.is_some_and(|w| same_item(it, w)) && range.is_some()) {
            out.extend(own);
            continue;
        }
        let fresh = item_lines(it, 2);
        if let (Some(_), Some(FilterItem::Filter { .. }), FilterItem::Filter { .. }) = (range, was, it) {
            // Extra keys: lines at the item's key indent that start another key, with their deeper lines.
            let mut extra = Vec::new();
            let mut in_extra = false;
            for s in own.iter().skip(1) {
                let ind = indent(s);
                if ind == 4 && key_at(s, 4).is_some() {
                    in_extra = true;
                } else if ind <= 4 {
                    in_extra = false;
                }
                if in_extra {
                    extra.push(s.clone());
                }
            }
            out.extend(fresh);
            out.extend(extra);
        } else {
            out.extend(fresh);
        }
    }
    out
}

fn place_of(l: &Layout, k: &str) -> usize {
    let idx = ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
    for j in (0..idx).rev() {
        if let Some(r) = l.keys.iter().find(|x| x.key == ORDER[j]) {
            return r.end;
        }
    }
    for o in ORDER.iter().skip(idx + 1) {
        if let Some(r) = l.keys.iter().find(|x| x.key == *o) {
            return r.start;
        }
    }
    l.lines.len()
}

fn finish(l: &Layout, mut out: Vec<Line>) -> String {
    for x in out.iter_mut() {
        if x.eol.is_empty() {
            x.eol = l.eol.clone();
        }
    }
    if !l.final_nl {
        if let Some(x) = out.last_mut() {
            x.eol.clear();
        }
    }
    format!("{}{}", if l.bom { "\u{FEFF}" } else { "" }, join(&out))
}

/// A commit: the new text, or None when it equals `text` (no write). `def.title` is ignored (a title change is the
/// rename job). Err for Newer / Unreadable files.
pub fn patch(text: &str, file: &QueryFile, def: &QueryDef, now: &str) -> Result<Option<String>, QueryError> {
    match file.state {
        FileState::Newer { .. } => return Err(QueryError::NewerVersion),
        FileState::Unreadable { .. } => return Err(QueryError::Unreadable),
        FileState::Ok => {}
    }
    if !file.layout.readable {
        return Err(QueryError::Unreadable);
    }
    if !(1..=1000).contains(&def.limit) {
        return Err(QueryError::Limit);
    }
    let l = &file.layout;
    // v1-views §1.4: `group_by: None` in `def` means "unchanged" (a commit never removes it), except §34.3 (D-2191,
    // CP-32, D-2197): `group_none` removes a valid `group_by` line; a file already ungrouped or broken is unchanged.
    let compared = |k: &&str| *k != "group_by" || def.group_by.is_some() || (def.group_none && file.def.group_by.is_some());
    let changed: Vec<&str> = COMMIT_KEYS.iter().copied().filter(compared).filter(|k| effective(&file.def, k, true) != effective(def, k, true)).collect();
    if changed.is_empty() {
        return Ok(None);
    }
    let mut edits: Vec<(usize, usize, Vec<String>, usize)> = Vec::new();
    for k in changed.iter().copied().chain(std::iter::once("modified")) {
        let mut lines = match k {
            "filters" => filters_block(def, file),
            "modified" => vec![format!("modified: {now}")],
            other => key_lines(other, def),
        };
        let order = ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
        match l.keys.iter().find(|x| x.key == k) {
            Some(r) => {
                // A one-line key keeps its trailing comment (D-1457); `sort` and `lane_order` keep the first line's
                // comment when their shape changes (v1-views §1.4). A removed `lane_order` takes its lines with it.
                if !lines.is_empty() && ((r.end - r.start == 1 && lines.len() == 1) || matches!(k, "sort" | "lane_order")) {
                    let old = &l.lines[r.start].body;
                    if let Some((_, colon)) = key_at(old, 0) {
                        if let Some(c) = trailing_comment_at(old, colon + 1) {
                            lines[0].push_str(&old[c..]);
                        }
                    }
                }
                edits.push((r.start, r.end, lines, order));
            }
            None if lines.is_empty() => {}
            None => {
                let at = place_of(l, k);
                edits.push((at, at, lines, order));
            }
        }
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0).then(b.3.cmp(&a.3)));
    let mut out = l.lines.clone();
    for (start, end, lines, _) in edits {
        let add: Vec<Line> = lines.into_iter().map(|t| Line { body: t, eol: l.eol.clone() }).collect();
        out.splice(start..end, add);
    }
    let next = finish(l, out);
    // Read-back check (D-1458): the new text must read as exactly `def` (the title aside).
    let back = read_text(&next);
    let ok = back.state == FileState::Ok
        && COMMIT_KEYS
            .iter()
            .filter(|k| **k != "columns" || back.layout.present.iter().any(|p| p == "columns"))
            .filter(|k| compared(k))
            .all(|k| effective(&back.def, k, false) == effective(def, k, false));
    if !ok {
        return Err(QueryError::Unreadable);
    }
    Ok((next != text).then_some(next))
}

/// A new file (R138 create order). `tail`: lines copied verbatim after `modified` (Save as query…, §1.5).
pub fn create_text(def: &QueryDef, now: &str, tail: Option<&str>) -> String {
    create_text_at(def, Some(now), tail)
}

/// v1-views §25.1 (D-1936): a new file without `created` / `modified`, so the same definition gives the same bytes on
/// every Mac (the default task views). Both keys are optional when read (R138); a later commit inserts `modified`.
pub fn create_text_unstamped(def: &QueryDef) -> String {
    create_text_at(def, None, None)
}

fn create_text_at(def: &QueryDef, now: Option<&str>, tail: Option<&str>) -> String {
    let mut l = vec![format!("{HEADER}{}.", nfc(&def.title)), "version: 1".into(), format!("title: {}", scalar_in(&def.title, false))];
    l.push(top_line("types", def).unwrap_or_default());
    l.push(top_line("match", def).unwrap_or_default());
    if def.filters.is_empty() {
        l.push("filters: []".into());
    } else {
        l.push("filters:".into());
        l.extend(def.filters.iter().flat_map(|f| item_lines(f, 2)));
    }
    // v1-views §34.3 (R221): `group_by` when set (any display), `lanes` only on a grouped wall, `lane_order` only when
    // set; Q2-T (§24.3): `done_lane` when set (any view), and a wall with empty `columns` writes none (D-1910).
    for k in ["sort", "limit", "view", "group_by", "lanes", "lane_order", "done_lane", "columns"] {
        if k == "lanes" && (def.view != View::Wall || def.group_by.is_none()) {
            continue;
        }
        if k == "columns" && def.view == View::Wall && def.columns.is_empty() {
            continue;
        }
        l.extend(key_lines(k, def));
    }
    if let Some(now) = now {
        l.push(format!("created: {now}"));
        l.push(format!("modified: {now}"));
    }
    if let Some(t) = tail {
        let t = t.replace("\r\n", "\n");
        l.extend(t.strip_suffix('\n').unwrap_or(&t).split('\n').map(str::to_string));
    }
    format!("{}\n", l.join("\n"))
}

/// `Save as query…`: the inline fence's definition and its unknown keys and comments (top level), as `create_text`
/// inputs.
pub fn from_inline(file: &QueryFile, body: &str) -> (QueryDef, Option<String>) {
    let mut keep: Vec<String> = Vec::new();
    let mut in_unknown = false;
    for l in split(body) {
        let t = l.body.as_str();
        if blank(t) {
            continue;
        }
        if indent(t) == 0 && comment(t) {
            keep.push(t.to_string());
            in_unknown = false;
            continue;
        }
        if indent(t) == 0 {
            in_unknown = key_at(t, 0).is_some_and(|(k, _)| {
                let k = nfc(&k);
                !ORDER.contains(&k.as_str()) && k != "saved"
            });
            if in_unknown {
                keep.push(t.to_string());
            }
            continue;
        }
        if in_unknown {
            keep.push(t.to_string());
        }
    }
    (file.def.clone(), (!keep.is_empty()).then(|| keep.join("\n")))
}

/// Line edits of `duplicate_text` / `retitle_text`: a replaced line (or a removed one), and lines inserted before an
/// original line index.
struct Edits {
    set: BTreeMap<usize, Option<String>>,
    ins: Vec<(usize, String)>,
}

impl Edits {
    fn new() -> Edits {
        Edits { set: BTreeMap::new(), ins: Vec::new() }
    }
    /// Replaces (or inserts) one top-level one-line key, keeping a trailing comment.
    fn set_key(&mut self, l: &Layout, k: &str, line: String, insert_at: usize) {
        match l.keys.iter().find(|x| x.key == k) {
            Some(r) => {
                let old = &l.lines[r.start].body;
                let tail = match key_at(old, 0).and_then(|(_, colon)| trailing_comment_at(old, colon + 1)) {
                    Some(c) if r.end - r.start == 1 => old[c..].to_string(),
                    _ => String::new(),
                };
                self.set.insert(r.start, Some(format!("{line}{tail}")));
                for i in r.start + 1..r.end {
                    self.set.insert(i, None);
                }
            }
            None => self.ins.push((insert_at, line)),
        }
    }
    fn apply(&self, l: &Layout) -> String {
        let mut out: Vec<Line> = Vec::new();
        for (i, x) in l.lines.iter().enumerate() {
            for (_, t) in self.ins.iter().filter(|(at, _)| *at == i) {
                out.push(Line { body: t.clone(), eol: l.eol.clone() });
            }
            match self.set.get(&i) {
                Some(Some(t)) => out.push(Line { body: t.clone(), eol: x.eol.clone() }),
                Some(None) => {}
                None => out.push(x.clone()),
            }
        }
        for (_, t) in self.ins.iter().filter(|(at, _)| *at >= l.lines.len()) {
            out.push(Line { body: t.clone(), eol: l.eol.clone() });
        }
        finish(l, out)
    }
}

fn place_after_known(l: &Layout, k: &str) -> usize {
    let idx = ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
    for j in (0..idx).rev() {
        if let Some(r) = l.keys.iter().find(|x| x.key == ORDER[j]) {
            return r.end;
        }
    }
    for o in ORDER.iter().skip(idx + 1) {
        if let Some(r) = l.keys.iter().find(|x| x.key == *o) {
            return r.start;
        }
    }
    l.header
}

fn layout_for(text: &str, file: &QueryFile) -> Layout {
    if file.layout.readable {
        file.layout.clone()
    } else {
        let (t, bom) = strip_bom(text);
        layout_of(t, Some(&[][..]), bom)
    }
}

/// Duplicate: `text` with only the `title:`, `created:`, `modified:` lines replaced (inserted at the R138 place when
/// missing).
pub fn duplicate_text(text: &str, file: &QueryFile, title: &str, now: &str) -> String {
    let l = layout_for(text, file);
    let mut e = Edits::new();
    e.set_key(&l, "title", format!("title: {}", scalar_in(title, false)), place_after_known(&l, "title"));
    e.set_key(&l, "created", format!("created: {now}"), place_after_known(&l, "created"));
    e.set_key(&l, "modified", format!("modified: {now}"), place_after_known(&l, "modified"));
    e.apply(&l)
}

/// Rename: `text` with only the `title:` line replaced (inserted after `version`, else first after the header comment
/// lines, when missing). No `modified` change (FR-QRY-06 AC-6).
pub fn retitle_text(text: &str, file: &QueryFile, title: &str) -> String {
    let l = layout_for(text, file);
    let at = l.keys.iter().find(|x| x.key == "version").map(|v| v.end).unwrap_or(l.header);
    let mut e = Edits::new();
    e.set_key(&l, "title", format!("title: {}", scalar_in(title, false)), at);
    e.apply(&l)
}

/// D-184: the stem when it is unique among `paths`, else the path without `.md`.
fn link_text(path: &str, paths: &[String]) -> String {
    let stem_of = |p: &str| {
        let n = p.rsplit('/').next().unwrap_or(p);
        n.strip_suffix(".md").unwrap_or(n).to_string()
    };
    let stem = stem_of(path);
    let same = paths.iter().filter(|x| stem_of(x).to_lowercase() == stem.to_lowercase()).count();
    if same <= 1 {
        stem
    } else {
        path.strip_suffix(".md").unwrap_or(path).to_string()
    }
}

/// D-291 from the vault root over `paths`: a path form, else the stem (root first, then the shortest path).
fn resolve_root(target: &str, paths: &[String]) -> Option<String> {
    let t = nfc(trim_ws(target)).to_lowercase();
    let t = t.strip_suffix(".md").unwrap_or(&t).to_string();
    if t.is_empty() {
        return None;
    }
    let no_md = |p: &str| p.strip_suffix(".md").unwrap_or(p).to_lowercase();
    if let Some(hit) = paths.iter().find(|p| no_md(p) == t) {
        return Some(hit.clone());
    }
    if t.contains('/') {
        return None;
    }
    let mut c: Vec<&String> = paths.iter().filter(|p| no_md(p.rsplit('/').next().unwrap_or(p)) == t).collect();
    c.sort_by(|a, b| a.contains('/').cmp(&b.contains('/')).then(a.chars().count().cmp(&b.chars().count())).then(a.as_bytes().cmp(b.as_bytes())));
    c.first().map(|s| (*s).clone())
}

/// The job patches of §1.8: `"[[…]]"` value tokens replaced in place; None when nothing matches or the file is Newer /
/// Unreadable. Full-line comments and trailing comments are never rewritten, a single-quoted value stays single-quoted
/// (FR-FMT-07), and the result is read back first (D-1458, FR-LNK-03 AC-23): unless it reads as the same query with only
/// the intended link values changed, nothing is written (None).
pub fn patch_job_text(text: &str, file: &QueryFile, patches: &[QueryPatch]) -> Option<String> {
    let _ = file;
    let read = read_text(text);
    if read.state != FileState::Ok || !read.layout.readable {
        return None;
    }
    let l = &read.layout;
    // The `filters` items and (v1-views §1.10) the `lane_order` entries.
    let ranges: Vec<(usize, usize)> = l.keys.iter().filter(|k| k.key == "filters" || k.key == "lane_order").map(|k| (k.start, k.end)).collect();
    if ranges.is_empty() {
        return None;
    }
    let mut lines = l.lines.clone();
    let mut want = read.def.clone();
    let mut changed = false;
    for p in patches {
        let QueryPatch::ObjectMoved { from, to, paths } = p else { continue };
        let before: Vec<String> = paths.iter().map(|x| nfc(x)).collect();
        let (from, to) = (nfc(from), nfc(to));
        let after: Vec<String> = before.iter().map(|x| if *x == from { to.clone() } else { x.clone() }).collect();
        let to_text = link_text(&to, &after);
        // The new inner text of a link whose target resolves to `from`, keeping its `|alias` / `#heading` part.
        let moved = |inner: &str| -> Option<String> {
            let cut = inner.find(['|', '#']);
            let (target, rest) = match cut {
                Some(i) => (&inner[..i], &inner[i..]),
                None => (inner, ""),
            };
            (resolve_root(target, &before).as_deref() == Some(from.as_str())).then(|| format!("{to_text}{rest}"))
        };
        for line in lines.iter_mut().enumerate().filter(|(i, _)| ranges.iter().any(|(a, b)| a <= i && i < b)).map(|(_, x)| x) {
            // A full-line comment is never rewritten; on a value line only the part before a trailing comment is.
            if comment(&line.body) {
                continue;
            }
            let cut = trailing_comment_at(&line.body, 0).unwrap_or(line.body.len());
            let (code, tail) = line.body.split_at(cut);
            let (new, hit) = replace_links(code, |inner, q| {
                moved(inner).map(|n| {
                    let link = format!("[[{n}]]");
                    if q == '\'' {
                        format!("'{}'", link.replace('\'', "''"))
                    } else {
                        serde_json::to_string(&link).unwrap_or_default()
                    }
                })
            });
            if hit {
                line.body = format!("{new}{tail}");
                changed = true;
            }
        }
        for item in want.filters.iter_mut() {
            move_links_in(item, &moved);
        }
        for x in want.lane_order.iter_mut().flatten() {
            let mut v = Value::String(x.clone());
            move_link_value(&mut v, &moved);
            if let Value::String(n) = v {
                *x = n;
            }
        }
    }
    if !changed {
        return None;
    }
    let next = format!("{}{}", if l.bom { "\u{FEFF}" } else { "" }, join(&lines));
    // Read-back check (D-1458): the same query, only the intended link values changed, nothing else.
    let back = read_text(&next);
    let ok = back.state == FileState::Ok
        && back.layout.readable
        && back.def == want
        && back.broken == read.broken
        && back.uses_this == read.uses_this
        && back.created == read.created
        && back.modified == read.modified
        && back.layout.present == read.layout.present
        && back.layout.lines.len() == read.layout.lines.len();
    if !ok {
        return None;
    }
    (next != text).then_some(next)
}

/// The values a job patch must change in `item`: each string `[[inner]]` for which `moved(inner)` answers.
fn move_link_value(v: &mut Value, moved: &impl Fn(&str) -> Option<String>) {
    match v {
        Value::String(s) => {
            if let Some(inner) = s.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
                if !inner.contains(']') {
                    if let Some(n) = moved(inner) {
                        *s = format!("[[{n}]]");
                    }
                }
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| move_link_value(x, moved)),
        _ => {}
    }
}

fn move_links_in(item: &mut FilterItem, moved: &impl Fn(&str) -> Option<String>) {
    match item {
        FilterItem::Filter { value: v, .. } => move_link_value(v, moved),
        FilterItem::Group { filters, .. } => filters.iter_mut().for_each(|x| move_links_in(x, moved)),
        FilterItem::Raw { .. } => {}
    }
}

/// Replaces each quoted `"[[…]]"` / `'[[…]]'` token of `s` for which `f(inner)` answers a replacement.
fn replace_links(s: &str, f: impl Fn(&str, char) -> Option<String>) -> (String, bool) {
    let mut out = String::new();
    let mut rest = s;
    let mut hit = false;
    loop {
        let found = ["\"[[", "'[["].iter().filter_map(|p| rest.find(p).map(|i| (i, p.as_bytes()[0] as char))).min_by_key(|x| x.0);
        let Some((i, q)) = found else { break };
        let after = &rest[i + 3..];
        let close = format!("]]{q}");
        match after.find(&close) {
            Some(j) if !after[..j].contains(']') => {
                let inner = &after[..j];
                out.push_str(&rest[..i]);
                match f(inner, q) {
                    Some(r) => {
                        out.push_str(&r);
                        hit = true;
                    }
                    None => out.push_str(&rest[i..i + 3 + j + 3]),
                }
                rest = &after[j + 3..];
            }
            _ => {
                out.push_str(&rest[..i + 1]);
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    (out, hit)
}

// ------------------------------------------------------------------------------------------------ types and columns

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Text,
    Select,
    Review,
    Multi,
    Tags,
    Date,
    DateTime,
    Number,
    Checkbox,
    Relation,
    Unsupported,
    Links,
}

#[derive(Debug, Clone)]
struct AttrInfo {
    kind: Kind,
    /// Select options: (label NFC, raw `state`).
    options: Vec<(String, Option<String>)>,
}

fn universal(key: &str) -> Option<Kind> {
    Some(match key {
        "title" | "aliases" => Kind::Text,
        "tags" => Kind::Tags,
        "created" | "modified" => Kind::DateTime,
        "review" => Kind::Review,
        "source" => Kind::Relation,
        _ => return None,
    })
}

fn kind_of_attr(t: &str) -> Kind {
    match t {
        "text" | "long-text" | "url" | "email" => Kind::Text,
        "select" => Kind::Select,
        "multi-select" => Kind::Multi,
        "date" => Kind::Date,
        "date-time" => Kind::DateTime,
        "number" | "rating" | "currency" => Kind::Number,
        "checkbox" => Kind::Checkbox,
        "relation" => Kind::Relation,
        _ => Kind::Unsupported,
    }
}

/// The attribute `key` of one type: universal attributes, schema attributes (date-range halves `<key>-start` /
/// `<key>-end`); None when the type lacks it.
fn attr_of(t: Option<&tegg_schema::TypeFile>, key: &str) -> Option<AttrInfo> {
    if let Some(kind) = universal(key) {
        return Some(AttrInfo { kind, options: Vec::new() });
    }
    for a in &t?.attributes {
        let k = nfc(&a.key);
        if matches!(a.r#type, tegg_schema::AttrType::DateRange) && (key == format!("{k}-start") || key == format!("{k}-end")) {
            return Some(AttrInfo { kind: Kind::Date, options: Vec::new() });
        }
        if k == key {
            let options = a.options.iter().map(|o| (nfc(&o.label), tegg_schema::option_state(o).map(str::to_string))).collect();
            return Some(AttrInfo { kind: kind_of_attr(a.r#type.as_str()), options });
        }
    }
    None
}

fn ops_of(kind: Kind) -> &'static [Op] {
    use Op::*;
    match kind {
        Kind::Links => &[LinksTo],
        Kind::Text => &[Is, IsNot, Contains, IsEmpty, IsNotEmpty],
        Kind::Select | Kind::Review => &[Is, IsNot, IsAnyOf, IsEmpty],
        Kind::Multi | Kind::Tags => &[HasAnyOf, HasAllOf, HasNoneOf],
        Kind::Date | Kind::DateTime => &[Is, Before, After, Between, Today, ThisWeek, WithinNextDays, Overdue, IsEmpty],
        Kind::Number => &[Eq, Ne, Lt, Gt, Between],
        Kind::Checkbox => &[Is],
        Kind::Relation => &[LinksTo, IsEmpty, IsNotEmpty],
        Kind::Unsupported => &[],
    }
}

/// type-columns.md §3: the effective type-page columns of one type.
fn effective_columns(t: Option<&tegg_schema::TypeFile>) -> Vec<String> {
    let Some(t) = t else { return vec!["modified".into()] };
    let review = matches!(t.review, tegg_schema::Review::On | tegg_schema::Review::Locked);
    let attrs: Vec<String> = t.attributes.iter().map(|a| nfc(&a.key)).collect();
    let mut out: Vec<String> = Vec::new();
    if let Some(cols) = &t.columns {
        let mut choices: HashSet<String> = attrs.iter().cloned().collect();
        choices.extend(["tags", "source", "aliases", "created", "modified"].iter().map(|s| s.to_string()));
        if review {
            choices.insert("review".into());
        }
        for k in cols.iter().map(|c| nfc(c)) {
            if choices.contains(&k) && !out.contains(&k) {
                out.push(k);
            }
        }
        return out;
    }
    for k in t.preview.iter().map(|c| nfc(c)) {
        if (attrs.contains(&k) || ["tags", "source", "aliases", "created"].contains(&k.as_str())) && !out.contains(&k) {
            out.push(k);
        }
    }
    out.push("modified".into());
    out
}

type Defs = BTreeMap<String, tegg_schema::TypeFile>;

fn columns_default(defs: &Defs, types: &[String]) -> Vec<String> {
    if types.len() == 1 {
        effective_columns(defs.get(&types[0]))
    } else {
        vec!["type".into(), "modified".into()]
    }
}

/// The pure read with the core's defaults: a missing or broken `title` is the file's name, missing `columns` the
/// single type's effective columns (§1.4 Create).
fn read_named(bytes: &[u8], name: &str, defs: &Defs) -> QueryFile {
    let mut f = read(bytes);
    if f.layout.readable {
        if !f.layout.title_set {
            f.def.title = nfc(name);
        }
        fill_columns(&mut f, defs);
    } else {
        f.def = default_def(name, columns_default(defs, &[]));
    }
    f
}

// ------------------------------------------------------------------------------------------------ collation (D-1450)

type Coll = icu_collator::CollatorBorrowed<'static>;

static COLLATORS: LazyLock<Mutex<HashMap<String, Arc<Coll>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// ICU4X collation for `locale`, strength primary, numeric on: the twin of `Intl.Collator(locale, { sensitivity:
/// 'base', numeric: true })` (D-122, D-1450). An unknown locale collates as the root.
pub(crate) fn collator(locale: &str) -> Arc<Coll> {
    let mut m = lock(&COLLATORS);
    if let Some(c) = m.get(locale) {
        return c.clone();
    }
    let loc: icu_locale_core::Locale = locale.parse().unwrap_or(icu_locale_core::Locale::UNKNOWN);
    let mut prefs = icu_collator::CollatorPreferences::from(&loc);
    prefs.numeric_ordering = Some(icu_collator::preferences::CollationNumericOrdering::True);
    let mut o = icu_collator::options::CollatorOptions::default();
    o.strength = Some(icu_collator::options::Strength::Primary);
    let c = icu_collator::Collator::try_new(prefs, o)
        .or_else(|_| icu_collator::Collator::try_new(Default::default(), o))
        .expect("the root collation is compiled in");
    let c = Arc::new(c);
    m.insert(locale.to_string(), c.clone());
    c
}

// ------------------------------------------------------------------------------------------------ the evaluator (§1.6)

fn fold(s: &str) -> String {
    tegg_index::fold(&nfc(s))
}

/// tags.md R79's tag key.
fn tag_key(s: &str) -> String {
    let t = nfc(trim_ws(s));
    t.strip_prefix('#').unwrap_or(&t).to_lowercase()
}

fn is_empty_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.trim().is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

/// The non-blank values as text (lists flattened one level).
fn strs(v: Option<&Value>) -> Vec<String> {
    let one = |x: &Value| match x {
        Value::Null => None,
        Value::String(s) if s.trim().is_empty() => None,
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        other => Some(other.to_string()),
    };
    match v {
        None => Vec::new(),
        Some(Value::Array(a)) => a.iter().filter_map(one).collect(),
        Some(x) => one(x).into_iter().collect(),
    }
}

/// `"[[target|alias]]"` → `target` (NFC, trimmed).
fn link_target_of(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    let inner = s.strip_prefix("[[")?.strip_suffix("]]")?;
    if inner.contains(']') {
        return None;
    }
    let t = inner.split(['|', '#']).next().unwrap_or("");
    Some(nfc(trim_ws(t)))
}

fn is_date_value(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.len() == 10 && parse_day(s).is_some())
}

/// A date as written; a date-time by its local date in `tz` (D-104); None otherwise.
fn local_date(v: Option<&Value>, tz: &chrono_tz::Tz) -> Option<NaiveDate> {
    let s = v?.as_str()?.trim();
    if s.len() == 10 {
        return parse_day(s);
    }
    parse_dt(s).map(|t| t.with_timezone(tz).date_naive())
}

/// v1-views §24.4 (tasks.md AP-414): a Date value's valid `YYYY-MM-DD` (quoted or not); None for an impossible date, a
/// date-time or text.
fn strict_date(v: Option<&Value>) -> Option<NaiveDate> {
    tegg_format::date::parse_date(v?.as_str()?.trim())
}

/// A Date-time / `created` / `modified` value's local date in `tz` (the instant, D-104); None without a valid instant.
fn instant_date(v: Option<&Value>, tz: &chrono_tz::Tz) -> Option<NaiveDate> {
    let ms = instant_ms(v, tz)?;
    DateTime::from_timestamp_millis(ms).map(|t| t.with_timezone(tz).date_naive())
}

/// An instant in ms: a date-time as written, a date at its local midnight in `tz`.
fn instant_ms(v: Option<&Value>, tz: &chrono_tz::Tz) -> Option<i64> {
    let s = v?.as_str()?.trim();
    if let Some(t) = parse_dt(s) {
        return Some(t.timestamp_millis());
    }
    let d = (s.len() == 10).then(|| parse_day(s)).flatten()?;
    let mid = d.and_hms_opt(0, 0, 0)?;
    tz.from_local_datetime(&mid).earliest().map(|t| t.timestamp_millis()).or_else(|| Some(mid.and_utc().timestamp_millis()))
}

#[derive(Debug, Clone)]
struct Check {
    kind: Kind,
    needs_date: bool,
    /// A link or relation value resolved once (`this` → the host).
    target: Option<String>,
}

enum Active<'f> {
    Filter { key: String, op: Op, value: &'f Value, c: Check },
    Group { r#match: Match, items: Vec<Active<'f>> },
}

struct Ctx<'a> {
    objs: &'a [QueryObject<'a>],
    by_path: HashMap<&'a str, usize>,
    defs: &'a Defs,
    env: &'a QueryEnv,
    host: Option<String>,
    host_obj: Option<usize>,
    host_daily: Option<NaiveDate>,
}

/// v1-views §23.1 (R44): the four known states.
const STATES: [&str; 4] = ["open", "in-progress", "done", "cancelled"];

fn known_state(s: &str) -> bool {
    STATES.contains(&s)
}

/// v1-views §23.1: an attribute carries states when it is a Select with at least one option of a known state.
fn carries_states(a: &AttrInfo) -> bool {
    a.kind == Kind::Select && a.options.iter().any(|(_, st)| st.as_deref().is_some_and(known_state))
}

impl Ctx<'_> {
    /// v1-views §23.1 (tasks.md R44): the object's state for the Select `key`: the matching option's known state (labels
    /// NFC-exact, D-1808); a missing value, an unknown value or an option without a known state → `open`.
    fn state_of(&self, o: &QueryObject, key: &str) -> &'static str {
        let Some(v) = o.attributes.get(key).and_then(Value::as_str).map(|s| nfc(trim_ws(s))) else { return "open" };
        let st = attr_of(self.defs.get(o.r#type), key).and_then(|a| a.options.into_iter().find(|(l, _)| *l == v)).and_then(|(_, st)| st);
        STATES.iter().copied().find(|x| Some(*x) == st.as_deref()).unwrap_or("open")
    }

    fn status_state(&self, o: &QueryObject) -> String {
        let s = o.attributes.get("status").and_then(Value::as_str);
        attr_of(self.defs.get(o.r#type), "status")
            .and_then(|a| a.options.into_iter().find(|(l, _)| s.is_some_and(|s| fold(l) == fold(s))))
            .and_then(|(_, st)| st)
            .unwrap_or_else(|| "open".into())
    }
}

/// Run-time validity of one filter (R139): Err((reason, type)) when broken.
fn check(key: &str, op: Op, v: &Value, chosen: &[String], defs: &Defs) -> Result<Check, (BrokenReason, Option<String>)> {
    if key == "links_to" || key == "linked_from" {
        let ok = op == Op::Is && (v.as_str() == Some("this") || link_target_of(v).is_some());
        return if ok {
            Ok(Check { kind: Kind::Links, needs_date: false, target: None })
        } else if op == Op::Is {
            Err((BrokenReason::Value, None))
        } else {
            Err((BrokenReason::OperatorKind, None))
        };
    }
    let mut info: Option<AttrInfo> = None;
    if chosen.is_empty() {
        match universal(key) {
            Some(kind) => info = Some(AttrInfo { kind, options: Vec::new() }),
            None => return Err((BrokenReason::NotAttribute, None)),
        }
    } else {
        for t in chosen {
            let Some(a) = attr_of(defs.get(t), key) else { return Err((BrokenReason::NotAttribute, Some(t.clone()))) };
            if info.as_ref().is_some_and(|i| i.kind != a.kind) {
                return Err((BrokenReason::NotAttribute, Some(t.clone())));
            }
            if info.is_none() {
                info = Some(a);
            }
        }
    }
    let info = info.expect("set above");
    let kind = info.kind;
    // v1-views §24.4 (AP-1533, FR-QRY-02 AC-9): `key` a Select that carries states in every chosen type, the value a
    // known state.
    if matches!(op, Op::StateIs | Op::StateIsNot) {
        let every = !chosen.is_empty() && chosen.iter().all(|t| attr_of(defs.get(t), key).is_some_and(|a| carries_states(&a)));
        if !every {
            return Err((BrokenReason::OperatorKind, None));
        }
        if !v.as_str().is_some_and(known_state) {
            return Err((BrokenReason::Value, None));
        }
        return Ok(Check { kind, needs_date: false, target: None });
    }
    if !ops_of(kind).contains(&op) {
        return Err((BrokenReason::OperatorKind, None));
    }
    let str_list = |v: &Value| v.as_array().is_some_and(|a| !a.is_empty() && a.iter().all(Value::is_string));
    let this = v.as_str() == Some("this");
    let mut needs_date = false;
    let ok = match op {
        Op::IsEmpty | Op::IsNotEmpty | Op::Today | Op::ThisWeek | Op::Overdue => *v == Value::Bool(true),
        Op::Is | Op::IsNot => {
            if kind == Kind::Checkbox {
                v.is_boolean()
            } else if matches!(kind, Kind::Date | Kind::DateTime) {
                needs_date = this;
                is_date_value(v) || (op == Op::Is && this)
            } else {
                v.is_string() || v.is_number()
            }
        }
        Op::Contains => v.is_string() || v.is_number(),
        Op::IsAnyOf | Op::HasAnyOf | Op::HasAllOf | Op::HasNoneOf => str_list(v),
        Op::Before | Op::After => {
            needs_date = this;
            is_date_value(v) || this
        }
        Op::Between => match v.as_array() {
            Some(a) if a.len() == 2 && kind == Kind::Number => a.iter().all(Value::is_number) && a[0].as_f64() <= a[1].as_f64(),
            Some(a) if a.len() == 2 => a.iter().all(is_date_value) && a[0].as_str() <= a[1].as_str(),
            _ => false,
        },
        Op::WithinNextDays => v.as_i64().is_some_and(|n| (0..=3650).contains(&n)),
        Op::Eq | Op::Ne | Op::Lt | Op::Gt => v.is_number(),
        Op::LinksTo => this || link_target_of(v).is_some(),
        // Checked above.
        Op::StateIs | Op::StateIsNot => false,
    };
    if !ok {
        return Err((BrokenReason::Value, None));
    }
    Ok(Check { kind, needs_date, target: None })
}

fn active_items<'f>(items: &'f [FilterItem], chosen: &[String], defs: &Defs, broken: &mut Vec<Broken>) -> Vec<Active<'f>> {
    let mut out = Vec::new();
    for it in items {
        match it {
            FilterItem::Raw { .. } => {}
            FilterItem::Group { r#match, filters, .. } => {
                let inner = active_items(filters, chosen, defs, broken);
                if !inner.is_empty() {
                    out.push(Active::Group { r#match: *r#match, items: inner });
                }
            }
            FilterItem::Filter { key, op, value, src } => {
                let key = nfc(key);
                match check(&key, *op, value, chosen, defs) {
                    Ok(c) => out.push(Active::Filter { key, op: *op, value, c }),
                    Err((reason, ty)) => broken.push(Broken { reason, at: src.clone(), key, r#type: ty }),
                }
            }
        }
    }
    out
}

fn walk_active<'f>(items: &mut [Active<'f>], f: &mut dyn FnMut(&str, Op, &'f Value, &mut Check)) {
    for a in items {
        match a {
            Active::Group { items, .. } => walk_active(items, f),
            Active::Filter { key, op, value, c } => f(key, *op, value, c),
        }
    }
}

fn matches(key: &str, op: Op, v: &Value, c: &Check, o: &QueryObject, ctx: &Ctx) -> bool {
    if c.kind == Kind::Links {
        let Some(x) = c.target.as_deref() else { return false };
        if key == "links_to" {
            return x != o.path && o.links.iter().any(|(_, p)| *p == x);
        }
        let from = if Some(x) == ctx.host.as_deref() { ctx.host_obj } else { ctx.by_path.get(x).copied() };
        return from.is_some_and(|i| ctx.objs[i].links.iter().any(|(_, p)| *p == o.path));
    }
    if matches!(op, Op::StateIs | Op::StateIsNot) {
        let hit = v.as_str() == Some(ctx.state_of(o, key));
        return hit == (op == Op::StateIs);
    }
    let raw: Option<Value> = match key {
        "title" => Some(Value::String(o.title.to_string())),
        "tags" => Some(json!(o.tags)),
        _ => o.attributes.get(key).cloned(),
    };
    let raw = raw.as_ref();
    match op {
        Op::IsEmpty => return is_empty_value(raw),
        Op::IsNotEmpty => return !is_empty_value(raw),
        _ => {}
    }
    let text_of = |v: &Value| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    match c.kind {
        Kind::Text | Kind::Select | Kind::Review => {
            let vals: Vec<String> = strs(raw).iter().map(|s| fold(s)).collect();
            match op {
                Op::Is => vals.contains(&fold(&text_of(v))),
                Op::IsNot => !vals.is_empty() && !vals.contains(&fold(&text_of(v))),
                Op::Contains => {
                    let w = fold(&text_of(v));
                    vals.iter().any(|x| x.contains(&w))
                }
                Op::IsAnyOf => v.as_array().is_some_and(|a| a.iter().any(|w| vals.contains(&fold(&text_of(w))))),
                _ => false,
            }
        }
        Kind::Multi | Kind::Tags => {
            let norm = |s: &str| if c.kind == Kind::Tags { tag_key(s) } else { fold(s) };
            let vals: HashSet<String> = strs(raw).iter().map(|s| norm(s)).collect();
            let want: Vec<String> = v.as_array().map(|a| a.iter().map(|w| norm(&text_of(w))).collect()).unwrap_or_default();
            match op {
                Op::HasAnyOf => want.iter().any(|w| vals.contains(w)),
                Op::HasAllOf => want.iter().all(|w| vals.contains(w)),
                Op::HasNoneOf => !want.iter().any(|w| vals.contains(w)),
                _ => false,
            }
        }
        Kind::Date | Kind::DateTime => {
            let Some(d) = local_date(raw, &ctx.env.tz) else { return false };
            let day = |x: &Value| if x.as_str() == Some("this") { ctx.host_daily } else { x.as_str().and_then(parse_day) };
            let today = ctx.env.today;
            match op {
                Op::Is => day(v) == Some(d),
                Op::Before => day(v).is_some_and(|x| d < x),
                Op::After => day(v).is_some_and(|x| d > x),
                Op::Between => {
                    let a = v.as_array();
                    match (a.and_then(|a| a.first()).and_then(day), a.and_then(|a| a.get(1)).and_then(day)) {
                        (Some(x), Some(y)) => x <= d && d <= y,
                        _ => false,
                    }
                }
                Op::Today => d == today,
                Op::ThisWeek => {
                    let back = (today.weekday().num_days_from_monday() as i64 - ctx.env.week_start.num_days_from_monday() as i64).rem_euclid(7);
                    let s = today - Duration::days(back);
                    s <= d && d <= s + Duration::days(6)
                }
                Op::WithinNextDays => v.as_i64().is_some_and(|n| today <= d && d <= today + Duration::days(n)),
                Op::Overdue => d < today && (o.r#type != "task" || matches!(ctx.status_state(o).as_str(), "open" | "in-progress")),
                _ => false,
            }
        }
        Kind::Number => {
            let Some(n) = raw.filter(|x| x.is_number()).and_then(Value::as_f64) else { return false };
            let w = v.as_f64();
            match op {
                Op::Eq => w == Some(n),
                Op::Ne => w.is_some_and(|w| w != n),
                Op::Lt => w.is_some_and(|w| n < w),
                Op::Gt => w.is_some_and(|w| n > w),
                Op::Between => {
                    let a = v.as_array();
                    match (a.and_then(|a| a.first()).and_then(Value::as_f64), a.and_then(|a| a.get(1)).and_then(Value::as_f64)) {
                        (Some(x), Some(y)) => x <= n && n <= y,
                        _ => false,
                    }
                }
                _ => false,
            }
        }
        Kind::Checkbox => {
            let is_true = raw == Some(&Value::Bool(true));
            if *v == Value::Bool(true) {
                is_true
            } else {
                !is_true
            }
        }
        Kind::Relation => {
            let Some(x) = c.target.as_deref() else { return false };
            o.links.iter().any(|(a, p)| a.is_some_and(|a| nfc(a) == key) && *p == x)
        }
        Kind::Unsupported | Kind::Links => false,
    }
}

fn eval_items(items: &[Active], m: Match, o: &QueryObject, ctx: &Ctx) -> bool {
    if items.is_empty() {
        return true;
    }
    let one = |a: &Active| match a {
        Active::Group { r#match, items } => eval_items(items, *r#match, o, ctx),
        Active::Filter { key, op, value, c } => matches(key, *op, value, c, o, ctx),
    };
    match m {
        Match::All => items.iter().all(one),
        Match::Any => items.iter().any(one),
    }
}

#[derive(Debug, Clone)]
struct SortKey {
    empty: bool,
    n: f64,
    s: String,
}

/// One checked sort level (§1.6).
struct Level {
    by: String,
    order: Order,
    kind: Kind,
    /// Select / review options, folded, in schema order.
    options: Vec<String>,
}

/// The kind of one sort key, checked as slice Q's single `sort` (title / created / modified / an attribute of every
/// chosen type with one kind); None when invalid.
fn level_of(by: &str, order: Order, chosen: &[String], defs: &Defs) -> Option<Level> {
    let fixed = match by {
        "title" => Some(Kind::Text),
        "created" | "modified" => Some(Kind::DateTime),
        _ => None,
    };
    if let Some(kind) = fixed {
        return Some(Level { by: by.to_string(), order, kind, options: Vec::new() });
    }
    let infos: Vec<Option<AttrInfo>> = if chosen.is_empty() { vec![attr_of(None, by)] } else { chosen.iter().map(|t| attr_of(defs.get(t), by)).collect() };
    match infos.first().cloned().flatten() {
        Some(f) if f.kind != Kind::Unsupported && infos.iter().all(|a| a.as_ref().is_some_and(|a| a.kind == f.kind)) => {
            Some(Level { by: by.to_string(), order, kind: f.kind, options: f.options.iter().map(|(l, _)| fold(l)).collect() })
        }
        _ => None,
    }
}

/// Whether every level of `sort` is valid for the chosen types (§1.6 checks, run time; `[]` is valid, D-1806).
fn sort_ok(sort: &[Sort], chosen: &[String], defs: &Defs) -> bool {
    sort.iter().all(|x| level_of(&nfc(trim_ws(&x.by)), x.order, chosen, defs).is_some())
}

/// v1-views §34.4: whether a grouping resolves for the chosen types (the evaluator's own rules: an attribute grouping
/// of kind Select, Multi-select or Relation, or `tags`; a period grouping of a Date / Date-time key).
fn group_ok(key: &str, period: bool, chosen: &[String], defs: &Defs) -> bool {
    if period {
        period_attr(key, chosen, defs).is_some()
    } else {
        group_attr(key, chosen, defs).is_some()
    }
}

/// v1-views §17.1, §17.2, §34.4 (R194, R220; D-1853, D-1854): a usage's own values against the query's def: the broken
/// entries and the effective `sort`, `columns`, `view`, grouping, `lanes`, `lane_order` and `widths`. An own value that
/// is broken (shape, or a `by` / grouping not valid for the query's types) gives the query file's effective value.
/// `columns_set`: the query file has a `columns` key (CP-33, D-2198: else a List or Table usage takes the create default).
fn usage_run(kind: UsageKind, raw: &tegg_format::usage::UsageRaw, def: &QueryDef, defs: &Defs, columns_set: bool) -> UsageRun {
    use tegg_format::usage::{UsageOrder, UsageValue};
    let chosen: Vec<String> = def.types.iter().map(|t| nfc(t)).collect();
    let bad = |k: &str| Broken { reason: BrokenReason::BadValue, at: None, key: k.into(), r#type: None };
    let mut broken: Vec<Broken> = Vec::new();
    let own_sort: Option<Vec<Sort>> = match &raw.sort {
        UsageValue::Absent => None,
        UsageValue::Broken => {
            broken.push(bad("sort"));
            None
        }
        UsageValue::Set(levels) => {
            let levels: Vec<Sort> = levels.iter().map(|l| Sort { by: nfc(trim_ws(&l.by)), order: if l.order == UsageOrder::Asc { Order::Asc } else { Order::Desc } }).collect();
            if sort_ok(&levels, &chosen, defs) {
                Some(levels)
            } else {
                broken.push(bad("sort"));
                None
            }
        }
    };
    // Shape only: Set → Some, Broken → a broken entry and None.
    fn shape<T: Clone, U>(v: &UsageValue<T>, key: &str, broken: &mut Vec<Broken>, f: impl Fn(&T) -> U) -> Option<U> {
        match v {
            UsageValue::Absent => None,
            UsageValue::Broken => {
                broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: key.into(), r#type: None });
                None
            }
            UsageValue::Set(x) => Some(f(x)),
        }
    }
    let own_columns: Option<Vec<String>> = shape(&raw.columns, "columns", &mut broken, |c| c.iter().map(|x| nfc(x)).collect());
    let own_view: Option<View> = shape(&raw.view, "view", &mut broken, |v| match v {
        UsageView::List => View::List,
        UsageView::Table => View::Table,
        UsageView::Wall => View::Wall,
    });
    // A grouping key is checked against the query's types (§34.4); `none` is always valid.
    let own_group: Option<UsageGroupBy> = match &raw.group_by {
        UsageValue::Absent => None,
        UsageValue::Broken => {
            broken.push(bad("group_by"));
            None
        }
        UsageValue::Set(g) => {
            let ok = match g {
                UsageGroupBy::None => true,
                UsageGroupBy::Key(k) => group_ok(k, false, &chosen, defs),
                UsageGroupBy::Period(k) => group_ok(k, true, &chosen, defs),
            };
            if ok {
                Some(g.clone())
            } else {
                broken.push(bad("group_by"));
                None
            }
        }
    };
    let own_lanes: Option<Lanes> = shape(&raw.lanes, "lanes", &mut broken, |l| match l {
        UsageLanes::Columns => Lanes::Columns,
        UsageLanes::Rows => Lanes::Rows,
    });
    let own_lane_order: Option<Vec<String>> = shape(&raw.lane_order, "lane_order", &mut broken, |l| l.iter().map(|x| nfc(x)).collect());
    let own_widths: Option<Vec<(String, u32)>> = shape(&raw.widths, "widths", &mut broken, |w| w.iter().map(|(k, x)| (nfc(k), *x)).collect());
    let query_sort = if sort_ok(&def.sort, &chosen, defs) { def.sort.clone() } else { vec![Sort { by: "modified".into(), order: Order::Desc }] };
    let view = own_view.unwrap_or(def.view);
    let (group_by, group_period) = match &own_group {
        Some(UsageGroupBy::None) => (None, false),
        Some(UsageGroupBy::Key(k)) => (Some(k.clone()), false),
        Some(UsageGroupBy::Period(k)) => (Some(k.clone()), true),
        None => (def.group_by.clone(), def.group_period),
    };
    // CP-33 (D-2198): a query file without `columns` shown as a List or Table takes the create default.
    let query_columns = if !columns_set && def.view == View::Wall && view != View::Wall { columns_default(defs, &def.types) } else { def.columns.clone() };
    UsageRun {
        kind,
        sort: own_sort.clone().unwrap_or(query_sort),
        columns: own_columns.clone().unwrap_or(query_columns),
        view,
        group_by,
        group_period,
        lanes: own_lanes.unwrap_or(def.lanes),
        lane_order: own_lane_order.clone().or_else(|| def.lane_order.clone()),
        widths: own_widths.clone().unwrap_or_default(),
        own: UsageSettings { sort: own_sort, columns: own_columns, view: own_view, group_by: own_group, lanes: own_lanes, lane_order: own_lane_order, widths: own_widths },
        broken,
    }
}

/// v1-views §1.6 (D-1768, D-1806): the levels of `def.sort` (repeats of a `by` dropped after its first level), compared
/// level by level with slice Q's rules per kind, empty values last at every level in both orders; ties after the last
/// level by title (collation), then path (NFC bytes). Any invalid level makes the whole `sort` broken: `[modified desc]`.
fn sort_rows(hits: &mut [usize], def: &QueryDef, chosen: &[String], ctx: &Ctx, broken: &mut Vec<Broken>) {
    let coll = collator(&ctx.env.locale);
    let mut seen: HashSet<String> = HashSet::new();
    let wanted: Vec<(String, Order)> = def.sort.iter().map(|x| (nfc(trim_ws(&x.by)), x.order)).filter(|(b, _)| seen.insert(b.clone())).collect();
    let levels: Vec<Level> = match wanted.iter().map(|(b, o)| level_of(b, *o, chosen, ctx.defs)).collect::<Option<Vec<Level>>>() {
        Some(l) => l,
        None => {
            broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: "sort".into(), r#type: None });
            vec![Level { by: "modified".into(), order: Order::Desc, kind: Kind::DateTime, options: Vec::new() }]
        }
    };
    let none = SortKey { empty: true, n: 0.0, s: String::new() };
    let key_of = |lv: &Level, o: &QueryObject| -> SortKey {
        if lv.by == "title" {
            return SortKey { empty: false, n: 0.0, s: o.title.to_string() };
        }
        let raw: Option<Value> = if lv.by == "tags" { Some(json!(o.tags)) } else { o.attributes.get(lv.by.as_str()).cloned() };
        let raw = raw.as_ref();
        match lv.kind {
            Kind::Number => match raw.filter(|x| x.is_number()).and_then(Value::as_f64) {
                Some(n) => SortKey { empty: false, n, s: String::new() },
                None => none.clone(),
            },
            // v1-views §24.4 (CP-31, D-1923): a Date attribute sorts by its valid `YYYY-MM-DD` only; anything else is empty.
            Kind::Date => match strict_date(raw) {
                Some(d) => SortKey { empty: false, n: f64::from(d.num_days_from_ce()), s: String::new() },
                None => none.clone(),
            },
            Kind::DateTime => match instant_ms(raw, &ctx.env.tz) {
                Some(n) => SortKey { empty: false, n: n as f64, s: String::new() },
                None => none.clone(),
            },
            Kind::Checkbox => match raw.and_then(Value::as_bool) {
                Some(b) => SortKey { empty: false, n: if b { 1.0 } else { 0.0 }, s: String::new() },
                None => none.clone(),
            },
            Kind::Select | Kind::Review => match strs(raw).into_iter().next() {
                Some(s) => {
                    let i = lv.options.iter().position(|x| *x == fold(&s)).unwrap_or(lv.options.len());
                    SortKey { empty: false, n: i as f64, s }
                }
                None => none.clone(),
            },
            _ => match strs(raw).into_iter().next() {
                Some(s) => SortKey { empty: false, n: 0.0, s },
                None => none.clone(),
            },
        }
    };
    let keys: HashMap<usize, Vec<SortKey>> = hits.iter().map(|i| (*i, levels.iter().map(|lv| key_of(lv, &ctx.objs[*i])).collect())).collect();
    hits.sort_by(|a, b| {
        for (n, lv) in levels.iter().enumerate() {
            let (x, y) = (&keys[a][n], &keys[b][n]);
            if x.empty != y.empty {
                return if x.empty { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
            }
            if !x.empty {
                let c = x.n.partial_cmp(&y.n).unwrap_or(std::cmp::Ordering::Equal).then_with(|| coll.compare(&x.s, &y.s));
                if c != std::cmp::Ordering::Equal {
                    return if lv.order == Order::Desc { c.reverse() } else { c };
                }
            }
        }
        let (oa, ob) = (&ctx.objs[*a], &ctx.objs[*b]);
        coll.compare(oa.title, ob.title).then_with(|| nfc(oa.path).as_bytes().cmp(nfc(ob.path).as_bytes()))
    });
}

// ------------------------------------------------------------------------------------------------ grouping (§1.6)

/// The grouping key resolved (D-1769, D-1770, D-1807): `tags`, or an attribute of every chosen type with the same
/// groupable kind. Options: (label NFC, colour) of the first chosen type.
struct GroupAttr {
    key: String,
    kind: GroupKind,
    name: String,
    options: Vec<(String, Option<String>)>,
    /// Q2-T: each option's effective state (`open` without a known one), aligned with `options`.
    states: Vec<&'static str>,
}

fn group_attr(group_by: &str, chosen: &[String], defs: &Defs) -> Option<GroupAttr> {
    let key = nfc(trim_ws(group_by));
    if key == "tags" {
        return Some(GroupAttr { key, kind: GroupKind::Tags, name: "Tags".into(), options: Vec::new(), states: Vec::new() });
    }
    let mut found: Option<GroupAttr> = None;
    for t in chosen {
        let a = defs.get(t)?.attributes.iter().find(|a| nfc(&a.key) == key)?;
        let kind = match a.r#type {
            tegg_schema::AttrType::Select => GroupKind::Select,
            tegg_schema::AttrType::MultiSelect => GroupKind::MultiSelect,
            tegg_schema::AttrType::Relation => GroupKind::Relation { multiple: a.multiple },
            _ => return None,
        };
        match &found {
            Some(f) if f.kind != kind => return None,
            Some(_) => {}
            None => {
                found = Some(GroupAttr {
                    key: key.clone(),
                    kind,
                    name: nfc(&a.name),
                    options: a.options.iter().map(|o| (nfc(&o.label), o.color.as_ref().map(|c| nfc(c)))).collect(),
                    states: a.options.iter().map(|o| STATES.iter().copied().find(|x| Some(*x) == tegg_schema::option_state(o)).unwrap_or("open")).collect(),
                })
            }
        }
    }
    found
}

/// One lane a row belongs to while grouping: its sort key, then the lane.
struct Pending {
    lane: Lane,
    /// Lane order inside its kind group: 0 option, 1 unknown / tag / relation, 2 unresolved.
    rank: (u8, usize, String),
}

/// R187 excluded option lanes (D-1791): from the top-level valid filters on the grouping key under `match: all`.
fn excluded_labels(def: &QueryDef, active: &[Active], g: &GroupAttr) -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();
    if def.r#match != Match::All || !matches!(g.kind, GroupKind::Select | GroupKind::MultiSelect) {
        return out;
    }
    let text_of = |v: &Value| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let list = |v: &Value| -> Vec<String> { v.as_array().map(|a| a.iter().map(|x| fold(&text_of(x))).collect()).unwrap_or_default() };
    for a in active {
        let Active::Filter { key, op, value, .. } = a else { continue };
        if *key != g.key {
            continue;
        }
        for (label, _) in &g.options {
            let f = fold(label);
            let hit = match (g.kind, op) {
                (GroupKind::Select, Op::Is) => f != fold(&text_of(value)),
                (GroupKind::Select, Op::IsNot) => f == fold(&text_of(value)),
                (GroupKind::Select, Op::IsAnyOf) => !list(value).contains(&f),
                (_, Op::IsEmpty) => true,
                (GroupKind::MultiSelect, Op::HasNoneOf) => list(value).contains(&f),
                _ => false,
            };
            if hit {
                out.insert(label.clone());
            }
        }
    }
    out
}

/// v1-views §24.4 (AP-1533): under `match: all`, a top-level valid `state_is` / `state_is_not` filter on the grouping
/// key hides the lanes of the states it excludes. Whether a lane of `state` is hidden.
fn hidden_state(def: &QueryDef, active: &[Active], g: &GroupAttr, state: &str) -> bool {
    if def.r#match != Match::All || g.kind != GroupKind::Select {
        return false;
    }
    active.iter().any(|a| match a {
        Active::Filter { key, op: Op::StateIs, value, .. } if *key == g.key => value.as_str() != Some(state),
        Active::Filter { key, op: Op::StateIsNot, value, .. } if *key == g.key => value.as_str() == Some(state),
        _ => false,
    })
}

/// v1-views §1.6: the board's lanes and cards for `hits` (rows' order); None when `group_by` doesn't resolve. Q2-T:
/// `done` is a valid `done_lane` (§24.4): on a board grouped by `status`, each Done-state option lane gets `done_within`.
fn group_rows(hits: &[usize], def: &QueryDef, chosen: &[String], ctx: &Ctx, active: &[Active], resolve: &dyn Fn(&str) -> Option<String>, done: Option<DoneLane>) -> Option<Grouping> {
    let g = group_attr(def.group_by.as_deref()?, chosen, ctx.defs)?;
    let coll = collator(&ctx.env.locale);
    let excluded = excluded_labels(def, active, &g);
    let mut lanes: Vec<Pending> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let option_lane = |label: &str, color: &Option<String>| Lane {
        id: format!("option:{label}"),
        kind: LaneKind::Option,
        value: Some(label.to_string()),
        label: label.to_string(),
        color: color.clone(),
        target: None,
        excluded: excluded.contains(label),
        drop_target: true,
        cards: Vec::new(),
        days: Vec::new(),
        done_within: None,
    };
    for (i, (label, color)) in g.options.iter().enumerate() {
        if index.contains_key(&format!("option:{label}")) {
            continue;
        }
        index.insert(format!("option:{label}"), lanes.len());
        lanes.push(Pending { lane: option_lane(label, color), rank: (0, i, String::new()) });
    }
    let mut none: Vec<LaneCard> = Vec::new();
    // Tag spellings seen per key (D-185: the most frequent, the first on a tie).
    let mut spellings: HashMap<String, Vec<(String, usize)>> = HashMap::new();
    let all_paths: Vec<String> = ctx.objs.iter().map(|o| o.path.to_string()).collect();
    for (row, &oi) in hits.iter().enumerate() {
        let o = &ctx.objs[oi];
        // (lane id, a new lane when unseen, the raw values that put the row there)
        let mut placed: Vec<(String, Option<Pending>, Vec<String>)> = Vec::new();
        let put = |id: String, make: &dyn Fn() -> Pending, raw: String, placed: &mut Vec<(String, Option<Pending>, Vec<String>)>| {
            match placed.iter_mut().find(|p| p.0 == id) {
                Some(p) => {
                    if !raw.is_empty() {
                        p.2.push(raw);
                    }
                }
                None => placed.push((id, Some(make()), if raw.is_empty() { Vec::new() } else { vec![raw] })),
            }
        };
        let raw_value = o.attributes.get(g.key.as_str());
        match g.kind {
            GroupKind::Select | GroupKind::MultiSelect => {
                for v in strs(raw_value) {
                    let n = nfc(&v);
                    let t = nfc(trim_ws(&v));
                    if t.is_empty() {
                        continue;
                    }
                    if let Some((oi, (label, color))) = g.options.iter().enumerate().find(|(_, (l, _))| *l == t) {
                        let (label, color) = (label.clone(), color.clone());
                        put(format!("option:{label}"), &|| Pending { lane: option_lane(&label, &color), rank: (0, oi, String::new()) }, n, &mut placed);
                    } else {
                        let tt = t.clone();
                        put(
                            format!("unknown:{t}"),
                            &|| Pending {
                                lane: Lane { id: format!("unknown:{tt}"), kind: LaneKind::Unknown, value: Some(tt.clone()), label: tt.clone(), color: None, target: None, excluded: false, drop_target: false, cards: Vec::new(), days: Vec::new(), done_within: None },
                                rank: (1, 0, tt.clone()),
                            },
                            n,
                            &mut placed,
                        );
                    }
                }
            }
            GroupKind::Tags => {
                let fm: Vec<String> = strs(o.attributes.get("tags")).into_iter().map(|x| nfc(&x)).collect();
                for (i, k) in o.tags.iter().enumerate() {
                    let k = nfc(k);
                    if k.is_empty() {
                        continue;
                    }
                    let spelled = o.tag_spellings.get(i).map(|s| nfc(s)).unwrap_or_else(|| k.clone());
                    let e = spellings.entry(k.clone()).or_default();
                    match e.iter_mut().find(|(s, _)| *s == spelled) {
                        Some(x) => x.1 += 1,
                        None => e.push((spelled, 1)),
                    }
                    if placed.iter().any(|p| p.0 == format!("tag:{k}")) {
                        continue;
                    }
                    let raws: Vec<String> = fm.iter().filter(|x| tag_key(x) == k).cloned().collect();
                    let kk = k.clone();
                    placed.push((
                        format!("tag:{k}"),
                        Some(Pending {
                            lane: Lane { id: format!("tag:{kk}"), kind: LaneKind::Tag, value: Some(kk.clone()), label: kk.clone(), color: None, target: None, excluded: false, drop_target: true, cards: Vec::new(), days: Vec::new(), done_within: None },
                            rank: (1, 0, kk.clone()),
                        }),
                        raws,
                    ));
                }
            }
            GroupKind::Relation { .. } => {
                let mut used: Vec<bool> = vec![false; o.attr_links.len()];
                for v in strs(raw_value) {
                    let n = nfc(&v);
                    let text = link_target_of(&Value::String(v.clone())).unwrap_or_else(|| nfc(trim_ws(&v)));
                    if text.is_empty() {
                        continue;
                    }
                    let hit = o.attr_links.iter().enumerate().find(|(i, (a, t, _))| !used[*i] && nfc(a) == g.key && nfc(trim_ws(t)) == text);
                    let target: Option<String> = match hit {
                        Some((i, (_, _, p))) => {
                            used[i] = true;
                            p.map(|p| p.to_string())
                        }
                        None => resolve(&text),
                    };
                    match target {
                        Some(p) => {
                            let p = nfc(&p);
                            let title = ctx.by_path.get(p.as_str()).map(|i| ctx.objs[*i].title.to_string()).unwrap_or_else(|| {
                                let n = p.rsplit('/').next().unwrap_or(&p);
                                n.strip_suffix(".md").unwrap_or(n).to_string()
                            });
                            let value = format!("[[{}]]", link_text(&p, &all_paths));
                            let pp = p.clone();
                            put(
                                format!("relation:{p}"),
                                &|| Pending {
                                    lane: Lane { id: format!("relation:{pp}"), kind: LaneKind::Relation, value: Some(value.clone()), label: nfc(&title), color: None, target: Some(pp.clone()), excluded: false, drop_target: true, cards: Vec::new(), days: Vec::new(), done_within: None },
                                    rank: (1, 0, nfc(&title)),
                                },
                                n,
                                &mut placed,
                            );
                        }
                        None => {
                            let tt = text.clone();
                            put(
                                format!("unresolved:{text}"),
                                &|| Pending {
                                    lane: Lane { id: format!("unresolved:{tt}"), kind: LaneKind::Unresolved, value: Some(format!("[[{tt}]]")), label: tt.clone(), color: None, target: None, excluded: false, drop_target: false, cards: Vec::new(), days: Vec::new(), done_within: None },
                                    rank: (2, 0, tt.clone()),
                                },
                                n,
                                &mut placed,
                            );
                        }
                    }
                }
            }
            // Period groupings are `group_period`'s.
            GroupKind::Period { .. } => {}
        }
        if placed.is_empty() {
            none.push(LaneCard { row, raw: Vec::new() });
            continue;
        }
        for (id, make, raw) in placed {
            let at = match index.get(&id) {
                Some(&at) => at,
                None => {
                    let Some(p) = make else { continue };
                    index.insert(id.clone(), lanes.len());
                    lanes.push(p);
                    lanes.len() - 1
                }
            };
            lanes[at].lane.cards.push(LaneCard { row, raw });
        }
    }
    for p in lanes.iter_mut().filter(|p| p.lane.kind == LaneKind::Tag) {
        if let Some(best) = spellings.get(p.lane.value.as_deref().unwrap_or("")).and_then(|v| {
            let max = v.iter().map(|x| x.1).max()?;
            v.iter().find(|x| x.1 == max).map(|x| x.0.clone())
        }) {
            p.lane.label = best;
        }
    }
    lanes.sort_by(|a, b| a.rank.0.cmp(&b.rank.0).then(a.rank.1.cmp(&b.rank.1)).then_with(|| coll.compare(&a.rank.2, &b.rank.2)).then_with(|| a.lane.id.as_bytes().cmp(b.lane.id.as_bytes())));
    let mut out: Vec<Lane> = lanes.into_iter().map(|p| p.lane).collect();
    // `lane_order` moves its listed lanes to the front, in its order; an entry matching no lane is ignored.
    if let Some(order) = &def.lane_order {
        let mut front: Vec<Lane> = Vec::new();
        for e in order {
            let e = nfc(e);
            let pos = out.iter().position(|l| match l.kind {
                LaneKind::Option | LaneKind::Unknown => l.value.as_deref() == Some(e.as_str()),
                LaneKind::Tag => l.value.as_deref() == Some(tag_key(&e).as_str()),
                LaneKind::Relation => {
                    let t = link_target_of(&Value::String(e.clone())).unwrap_or_else(|| nfc(trim_ws(&e)));
                    resolve(&t).map(|p| nfc(&p)) == l.target || l.value.as_deref() == Some(e.as_str())
                }
                LaneKind::Unresolved => l.value.as_deref() == Some(e.as_str()),
                LaneKind::None | LaneKind::Period | LaneKind::Done => false,
            });
            if let Some(i) = pos {
                front.push(out.remove(i));
            }
        }
        front.extend(out);
        out = front;
    }
    if !none.is_empty() {
        out.push(Lane { id: "none".into(), kind: LaneKind::None, value: None, label: String::new(), color: None, target: None, excluded: false, drop_target: false, cards: none, days: Vec::new(), done_within: None });
    }
    // Q2-T (§24.4): hidden state lanes leave the board (an unknown value counts as `open`); a valid done lane limits
    // the Done-state option lanes of a board grouped by `status`.
    let state_of_lane = |l: &Lane| -> Option<&'static str> {
        match l.kind {
            LaneKind::Option => g.options.iter().position(|(x, _)| Some(x.as_str()) == l.value.as_deref()).map(|i| g.states[i]),
            LaneKind::Unknown => Some("open"),
            _ => None,
        }
    };
    out.retain(|l| !state_of_lane(l).is_some_and(|st| hidden_state(def, active, &g, st)));
    if let Some(d) = done.filter(|_| g.key == "status" && g.kind == GroupKind::Select) {
        for l in out.iter_mut().filter(|l| l.kind == LaneKind::Option) {
            if state_of_lane(l) == Some("done") {
                l.done_within = Some(d.within_days);
            }
        }
    }
    Some(Grouping { key: g.key, kind: g.kind, name: g.name, lanes: out })
}

/// v1-views §24.4 (D-1776, AP-1536): a period grouping's key: `created` / `modified`, or an attribute of kind Date or
/// Date-time of every chosen type with the same kind. (key, date_time, Name); None when invalid.
fn period_attr(group_by: &str, chosen: &[String], defs: &Defs) -> Option<(String, bool, String)> {
    let key = nfc(trim_ws(group_by));
    match key.as_str() {
        "created" => return Some((key, true, "Created".into())),
        "modified" => return Some((key, true, "Modified".into())),
        _ => {}
    }
    let mut found: Option<(bool, String)> = None;
    for t in chosen {
        let a = defs.get(t)?.attributes.iter().find(|a| nfc(&a.key) == key)?;
        let dt = match a.r#type {
            tegg_schema::AttrType::Date => false,
            tegg_schema::AttrType::DateTime => true,
            _ => return None,
        };
        match &found {
            Some((f, _)) if *f != dt => return None,
            Some(_) => {}
            None => found = Some((dt, nfc(&a.name))),
        }
    }
    found.map(|(dt, name)| (key, dt, name))
}

/// The done lane's colour: the first chosen type's first Done-state `status` option's (FR-UX-05 AC-25).
fn done_color(chosen: &[String], defs: &Defs) -> Option<String> {
    let t = defs.get(chosen.first()?)?;
    let a = t.attributes.iter().find(|a| nfc(&a.key) == "status")?;
    a.options.iter().find(|o| tegg_schema::option_state(o) == Some("done")).and_then(|o| o.color.as_ref().map(|c| nfc(c)))
}

/// v1-views §24.4 (R203): a period board's lanes `period:today`, `period:week` (with its day groups; absent when today
/// is the week's last day), `period:later`, `none` and, with a valid done lane, `done`. `done_rows`: the object indices
/// that go to the done lane. Cards in `rows` order.
fn group_period(hits: &[usize], def: &QueryDef, chosen: &[String], ctx: &Ctx, done: Option<DoneLane>, done_rows: &HashSet<usize>) -> Option<Grouping> {
    let (key, date_time, name) = period_attr(def.group_by.as_deref()?, chosen, ctx.defs)?;
    let env = ctx.env;
    let today = env.today;
    let back = (today.weekday().num_days_from_monday() as i64 - env.week_start.num_days_from_monday() as i64).rem_euclid(7);
    let last = today - Duration::days(back) + Duration::days(6);
    let drop = !date_time;
    let lane = |id: &str, kind: LaneKind, value: Option<&str>, drop_target: bool| Lane {
        id: id.into(),
        kind,
        value: value.map(str::to_string),
        label: String::new(),
        color: None,
        target: None,
        excluded: false,
        drop_target,
        cards: Vec::new(),
        days: Vec::new(),
        done_within: None,
    };
    let mut today_l = lane("period:today", LaneKind::Period, Some("today"), drop);
    let mut week = (today != last).then(|| {
        let mut w = lane("period:week", LaneKind::Period, Some("week"), drop);
        let mut d = today + Duration::days(1);
        while d <= last {
            w.days.push(DayGroup { date: d, cards: Vec::new() });
            d += Duration::days(1);
        }
        w
    });
    let mut later = lane("period:later", LaneKind::Period, Some("later"), drop);
    let mut none = lane("none", LaneKind::None, None, drop);
    let mut done_l = done.map(|d| Lane { color: done_color(chosen, ctx.defs), done_within: Some(d.within_days), ..lane("done", LaneKind::Done, None, true) });
    for (row, &oi) in hits.iter().enumerate() {
        let card = LaneCard { row, raw: Vec::new() };
        if let Some(l) = done_l.as_mut().filter(|_| done_rows.contains(&oi)) {
            l.cards.push(card);
            continue;
        }
        let v = ctx.objs[oi].attributes.get(key.as_str());
        let date = if date_time { instant_date(v, &env.tz) } else { strict_date(v) };
        match date {
            None => none.cards.push(card),
            Some(d) if d <= today => today_l.cards.push(card),
            Some(d) if d <= last => {
                let w = week.as_mut().expect("a day after today up to the week's last day exists");
                if let Some(g) = w.days.iter_mut().find(|g| g.date == d) {
                    g.cards.push(card.clone());
                }
                w.cards.push(card);
            }
            Some(_) => later.cards.push(card),
        }
    }
    let mut periods: Vec<Lane> = std::iter::once(today_l).chain(week).chain(std::iter::once(later)).collect();
    // `lane_order`: only the exact ids `today`, `week`, `later` match; listed lanes move to the front in its order.
    if let Some(order) = &def.lane_order {
        let mut front: Vec<Lane> = Vec::new();
        for e in order {
            let e = nfc(e);
            if let Some(i) = periods.iter().position(|l| l.value.as_deref() == Some(e.as_str())) {
                front.push(periods.remove(i));
            }
        }
        front.extend(periods);
        periods = front;
    }
    periods.push(none);
    periods.extend(done_l);
    Some(Grouping { key, kind: GroupKind::Period { date_time }, name, lanes: periods })
}

/// What `evaluate` answers.
struct Evaluated {
    state: RunState,
    broken: Vec<Broken>,
    targets: Vec<String>,
    uses_relative: bool,
    rows: Vec<QueryRow>,
    group: Option<Grouping>,
    /// Q2-T: the object index of each row (`rows` order), for the task rows built under the same lock (§24.4).
    hits: Vec<usize>,
}

/// v1-views §24.4 (D-1898): a done lane is valid when every chosen type's `status` carries states and has an option of
/// state `done`.
fn done_lane_ok(chosen: &[String], defs: &Defs) -> bool {
    !chosen.is_empty()
        && chosen.iter().all(|t| attr_of(defs.get(t), "status").is_some_and(|a| carries_states(&a) && a.options.iter().any(|(_, st)| st.as_deref() == Some("done"))))
}

fn row_of(o: &QueryObject, def: &QueryDef, ctx: &Ctx, group_key: Option<&str>) -> QueryRow {
    let mut cols: Vec<String> = def.columns.iter().map(|c| nfc(c)).collect();
    // D-1769: a board's rows also carry the grouping key.
    if let Some(k) = group_key {
        if !cols.iter().any(|c| c == k) {
            cols.push(k.to_string());
        }
    }
    // Q2-T (D-1891, D-1904): a board's cards show each row type's Preview properties (a date range as its halves).
    if group_key.is_some() {
        if let Some(t) = ctx.defs.get(o.r#type) {
            for p in t.preview.iter().map(|p| nfc(p)) {
                let range = t.attributes.iter().any(|a| nfc(&a.key) == p && matches!(a.r#type, tegg_schema::AttrType::DateRange));
                let keys = if range { vec![format!("{p}-start"), format!("{p}-end")] } else { vec![p] };
                for k in keys {
                    if !cols.contains(&k) {
                        cols.push(k);
                    }
                }
            }
        }
    }
    for k in ["type", "tags"] {
        if !cols.iter().any(|c| c == k) {
            cols.push(k.into());
        }
    }
    // Q2-T (F3, D-1904): the links of the row's frontmatter values it carries (relations, `source`, links in text
    // values), as the type page's rows (`index_type_rows`), resolved by the index.
    let links: Vec<LinkTarget> = o
        .attr_links
        .iter()
        .filter(|(a, _, _)| {
            let a = nfc(a);
            a != "type" && a != "tags" && cols.contains(&a)
        })
        .map(|(_, t, to)| crate::tasks5a::query_link(ctx.objs, &ctx.by_path, nfc(trim_ws(t)), *to))
        .collect();
    // D-2221 (R222): the row also carries the values of the sort keys, columns or not, so the app's quick re-sort after
    // a sort change gives this order. `title` is the row's own.
    for x in &def.sort {
        let k = nfc(trim_ws(&x.by));
        if k != "title" && !cols.contains(&k) {
            cols.push(k);
        }
    }
    let mut values = serde_json::Map::new();
    for k in cols {
        let v = match k.as_str() {
            "type" => json!(o.r#type),
            "tags" => json!(o.tags),
            other => o.attributes.get(other).cloned().unwrap_or(Value::Null),
        };
        values.insert(k, v);
    }
    let s = |k: &str| o.attributes.get(k).and_then(Value::as_str).map(str::to_string);
    let task = (o.r#type == "task").then(|| TaskBits {
        status: s("status"),
        state: TaskState::parse(&ctx.status_state(o)).unwrap_or(TaskState::Open),
        due: local_date(o.attributes.get("due"), &ctx.env.tz),
    });
    QueryRow {
        path: o.path.to_string(),
        id: o.id.map(str::to_string),
        title: o.title.to_string(),
        r#type: o.r#type.to_string(),
        created: s("created"),
        modified: s("modified"),
        values,
        links,
        task,
        version: FileVersion { mtime_ns: 0, size: 0, hash: [0; 32] },
        excerpt: String::new(),
        read_only: false,
        // v1-views §24.1: tag keys (NFC, case-folded), sorted, unique.
        tags: o.tags.iter().map(|t| tag_key(t)).filter(|t| !t.is_empty()).collect::<BTreeSet<String>>().into_iter().collect(),
        task_row: None,
        card: None,
    }
}

/// `group_broken`: the effective `group_by` was present but couldn't be read (a broken key in the file the usage didn't
/// replace): the usage still counts as grouped for the done lane.
fn evaluate(objs: &[QueryObject], resolve: &dyn Fn(&str) -> Option<String>, defs: &Defs, def: &QueryDef, host: Option<&str>, env: &QueryEnv, group_broken: bool) -> Evaluated {
    let mut broken: Vec<Broken> = Vec::new();
    let chosen: Vec<String> = def.types.iter().map(|t| nfc(t)).collect();
    let missing: Vec<&String> = chosen.iter().filter(|t| !defs.contains_key(*t) && !objs.iter().any(|o| o.r#type == t.as_str())).collect();
    if !missing.is_empty() {
        broken.extend(missing.into_iter().map(|t| Broken { reason: BrokenReason::NoType, at: None, key: t.clone(), r#type: None }));
        return Evaluated { state: RunState::NoType, broken, targets: Vec::new(), uses_relative: false, rows: Vec::new(), group: None, hits: Vec::new() };
    }
    let by_path: HashMap<&str, usize> = objs.iter().enumerate().map(|(i, o)| (o.path, i)).collect();
    let host = host.map(nfc);
    let host_obj = host.as_deref().and_then(|h| by_path.get(h).copied());
    let ctx = Ctx { objs, defs, env, host_daily: host_obj.and_then(|i| objs[i].daily), host: host.clone(), host_obj, by_path };
    let mut active = active_items(&def.filters, &chosen, defs, &mut broken);
    let (mut uses_this, mut date_this, mut relative) = (false, false, false);
    let mut targets: BTreeSet<String> = BTreeSet::new();
    walk_active(&mut active, &mut |_, op, v, c| {
        let this = v.as_str() == Some("this");
        if this {
            uses_this = true;
            if c.needs_date {
                date_this = true;
            }
        }
        if matches!(op, Op::Today | Op::ThisWeek | Op::WithinNextDays | Op::Overdue) || c.needs_date {
            relative = true;
        }
        if matches!(c.kind, Kind::Links | Kind::Relation) {
            c.target = if this {
                host.clone()
            } else {
                let t = link_target_of(v).and_then(|t| resolve(&t));
                if let Some(p) = &t {
                    targets.insert(p.clone());
                }
                t
            };
        }
    });
    if uses_this && ctx.host.is_none() {
        return Evaluated { state: RunState::NeedsHost, broken, targets: Vec::new(), uses_relative: relative, rows: Vec::new(), group: None, hits: Vec::new() };
    }
    if date_this && ctx.host_daily.is_none() {
        return Evaluated { state: RunState::NeedsContext, broken, targets: ctx.host.iter().cloned().collect(), uses_relative: relative, rows: Vec::new(), group: None, hits: Vec::new() };
    }
    if uses_this {
        if let Some(h) = &ctx.host {
            targets.insert(h.clone());
        }
    }
    let mut hits: Vec<usize> = objs
        .iter()
        .enumerate()
        .filter(|(_, o)| Some(o.path) != ctx.host.as_deref() && (chosen.is_empty() || chosen.iter().any(|t| t == o.r#type)))
        .filter(|(_, o)| eval_items(&active, def.r#match, o, &ctx))
        .map(|(i, _)| i)
        .collect();
    // Q2-T (v1-views §24.4, D-1898): a board's done lane. Invalid → broken, no done-lane behaviour; valid → Done rows
    // outside `within_days` leave `rows` (not shown, not counted, not offered by the tag filter).
    // v1-views §34.4 (D-2188): the done lane applies whenever the usage has a grouping, in every display; an ungrouped
    // usage (no `group_by`, or `none`) ignores it. A grouping that doesn't resolve or can't be read keeps R201's
    // done-lane rows, as the ACs count them (FR-QRY-01 AC-18, FR-QRY-05 AC-36 (d): "the 17 non-Cancelled tasks").
    let grouped = def.group_by.is_some() || (group_broken && !def.group_none);
    let mut done: Option<DoneLane> = None;
    let mut done_rows: HashSet<usize> = HashSet::new();
    if let Some(d) = def.done_lane.filter(|_| grouped) {
        if done_lane_ok(&chosen, defs) {
            done = Some(d);
            relative = true;
            let first = env.today - Duration::days(i64::from(d.within_days) - 1);
            hits.retain(|&i| {
                let o = &objs[i];
                if ctx.state_of(o, "status") != "done" {
                    return true;
                }
                let day = instant_date(o.attributes.get("completed"), &env.tz).or_else(|| instant_date(o.attributes.get("modified"), &env.tz));
                let within = day.is_some_and(|d| first <= d && d <= env.today);
                if within {
                    done_rows.insert(i);
                }
                within
            });
        } else {
            broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: "done_lane".into(), r#type: None });
        }
    }
    sort_rows(&mut hits, def, &chosen, &ctx, &mut broken);
    // v1-views §34.4 (R220): every display groups its rows when it has a grouping; a `group_by` that doesn't resolve is
    // a broken part and the results are drawn ungrouped. Q2-T: a period grouping (§24.4). No grouping (absent or
    // `none`): ungrouped, no notice.
    let group = if def.group_by.is_some() {
        let g = if def.group_period { group_period(&hits, def, &chosen, &ctx, done, &done_rows) } else { group_rows(&hits, def, &chosen, &ctx, &active, resolve, done) };
        if g.is_some() && def.group_period {
            relative = true;
        }
        if g.is_none() && !broken.iter().any(|b| b.key == "group_by" && b.at.is_none()) {
            broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: "group_by".into(), r#type: None });
        }
        g
    } else {
        None
    };
    // D-1769 / D-1891: a grouped wall's rows also carry the grouping key and the Preview properties.
    let gk = group.as_ref().filter(|_| def.view == View::Wall).map(|g| g.key.clone());
    let rows = hits.iter().map(|i| row_of(&objs[*i], def, &ctx, gk.as_deref())).collect();
    let mut targets: Vec<String> = targets.into_iter().collect();
    targets.sort_by(|a, b| nfc(a).as_bytes().cmp(nfc(b).as_bytes()));
    Evaluated { state: RunState::Ok, broken, targets, uses_relative: relative, rows, group, hits }
}

// ------------------------------------------------------------------------------------------------ the core (§1.5)

fn stem_of(p: &str) -> String {
    let n = p.rsplit('/').next().unwrap_or(p);
    nfc(n.strip_suffix(".yml").unwrap_or(n))
}

/// A `.tegg/queries/<file>.yml` path (direct child, not a dot or temp file): what `vault:changed` reports (§1.7).
pub(crate) fn is_query_path(p: &str) -> bool {
    is_query_file(p)
}

fn is_query_file(p: &str) -> bool {
    let Some(name) = p.strip_prefix(&format!("{QUERIES_DIR}/")) else { return false };
    !name.is_empty() && !name.contains('/') && !name.starts_with('.') && name.ends_with(".yml") && !name.contains(".tegg-tmp")
}

/// `<stem>` or `<stem> (n)` → (stem, n), n = 1 without a suffix.
fn split_suffix(stem: &str) -> (String, u32) {
    if let Some(body) = stem.strip_suffix(')') {
        if let Some((base, n)) = body.rsplit_once(" (") {
            if let Ok(n) = n.parse::<u32>() {
                return (base.to_string(), n);
            }
        }
    }
    (stem.to_string(), 1)
}

fn query_err(e: QueryError) -> CoreError {
    CoreError::Query(e)
}


impl Core {
    pub(crate) fn q(&self) -> QCore<'_> {
        QCore { shared: &self.shared }
    }
    /// Every readable or unreadable `.tegg/queries/*.yml` (direct children, not dot files), in name order.
    pub fn queries(&self) -> Vec<QuerySummary> {
        self.q().queries()
    }
    /// One query by name (`name_key`): live first, else the newest trashed one → `Trashed`, else `Missing`.
    pub fn query(&self, name: &str) -> QueryRead {
        self.q().query(name)
    }
    /// §1.6: one file read (a reference), then one index lock for the whole evaluation.
    pub fn query_run(&self, src: QuerySource, host: Option<&str>, env: &QueryEnv) -> QueryResult {
        self.q().query_run(src, host, env)
    }
    /// A commit (one atomic write). Base check as `pins_apply` (D-175): Vault(Conflict { disk }) / Vault(Gone).
    pub fn query_apply(&self, name: &str, base: &FileVersion, def: QueryDef, now: &str) -> Result<QueryRead, CoreError> {
        self.q().query_apply(name, base, def, now)
    }
    /// Undo of a commit (§2): writes `text` if the file is still `base`.
    pub fn query_revert(&self, name: &str, base: &FileVersion, text: &str) -> Result<QueryRead, CoreError> {
        self.q().query_revert(name, base, text)
    }
    /// An exclusive create (RENAME_EXCL); `free` takes a ` (n)` name (D-1477).
    pub fn query_create(&self, req: QueryCreate, now: &str) -> Result<QueryRead, CoreError> {
        self.q().query_create(req, now)
    }
    /// `<stem> (n)` with only `title:`, `created:`, `modified:` changed (FR-QRY-06 AC-8).
    pub fn query_duplicate(&self, name: &str, now: &str) -> Result<QueryRead, CoreError> {
        self.q().query_duplicate(name, now)
    }
    /// Moves the file to `.trash/.tegg/queries/` (a free ` (n)` stem when taken), bytes unchanged. No base.
    pub fn query_trash(&self, name: &str) -> Result<String, CoreError> {
        self.q().query_trash(name)
    }
    /// Moves the newest trashed file of `name` back (a free ` (n)` stem when taken), bytes unchanged.
    pub fn query_restore(&self, name: &str) -> Result<QueryRead, CoreError> {
        self.q().query_restore(name)
    }
    /// v1-views §1.5 (D-1804): type files (`.tegg/types/*.yml`, readable, not Newer) whose `views` lists `name`
    /// (`name_key`), type-key order.
    pub fn query_view_usages(&self, name: &str) -> Vec<ViewUsage> {
        self.q().query_view_usages(name)
    }
    /// Indexed notes then templates that use `name`, each with its title and type, path order.
    pub fn query_usages(&self, name: &str) -> Vec<QueryUsage> {
        self.q().query_usages(name)
    }
    pub(crate) fn query_pin(&self, name: &str) -> (Lookup, Option<String>, Option<String>) {
        self.q().query_pin(name)
    }
    pub(crate) fn query_live_name(&self, name: &str) -> Option<String> {
        self.q().query_live_name(name)
    }
    pub(crate) fn query_trash_rows(&self) -> Vec<(String, String)> {
        self.q().query_trash_rows()
    }
    pub(crate) fn query_restore_path(&self, from: &str, stem: &str) -> Result<QueryRead, CoreError> {
        self.q().query_restore_path(from, stem)
    }
}

/// The queries module's core side over the shared state, so the job host (`jobs4c`) reaches it too.
pub(crate) struct QCore<'a> {
    pub(crate) shared: &'a crate::Shared,
}

impl QCore<'_> {
    /// Live query files (NFC paths), in NFC stem byte order, one per NFC name.
    fn live_query_paths(&self) -> Vec<String> {
        let mut v: Vec<String> = self.shared.vault.list_dir(QUERIES_DIR).unwrap_or_default().into_iter().map(|p| nfc(&p)).filter(|p| is_query_file(p)).collect();
        v.sort_by(|a, b| stem_of(a).as_bytes().cmp(stem_of(b).as_bytes()));
        v.dedup();
        v
    }

    /// D-1475: exact NFC stem first, else the first name-key match in NFC byte order.
    fn find_live(&self, name: &str) -> Option<String> {
        let paths = self.live_query_paths();
        let n = nfc(trim_ws(name));
        let k = name_key(&n);
        paths.iter().find(|p| stem_of(p) == n).or_else(|| paths.iter().find(|p| name_key(&stem_of(p)) == k)).cloned()
    }

    /// The newest trashed file of `name` (`<stem>.yml` or `<stem> (n).yml`; the highest `n` is the newest).
    fn find_trashed(&self, name: &str) -> Option<String> {
        let k = name_key(name);
        let files = self.shared.vault.list_dir(TRASHED_QUERIES_DIR).unwrap_or_default();
        files
            .into_iter()
            .map(|p| nfc(&p))
            .filter(|p| p.ends_with(".yml"))
            .filter_map(|p| {
                let s = stem_of(&p);
                if name_key(&s) == k {
                    return Some((1, p));
                }
                let (base, n) = split_suffix(&s);
                (n > 1 && name_key(&base) == k).then_some((n, p))
            })
            .max_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)))
            .map(|(_, p)| p)
    }

    fn defs(&self) -> Defs {
        self.shared.type_defs()
    }

    fn read_of(&self, path: &str, defs: &Defs) -> Option<(QueryFile, FileVersion, Vec<u8>)> {
        let (bytes, v) = self.shared.vault.read(path).ok()?;
        Some((read_named(&bytes, &stem_of(path), defs), v, bytes))
    }

    fn query_read(&self, path: &str, file: &QueryFile, v: FileVersion, bytes: &[u8]) -> QueryRead {
        let (lookup, line, reason) = match &file.state {
            FileState::Ok => (Lookup::Ok, None, None),
            FileState::Newer { .. } => (Lookup::Newer, None, None),
            FileState::Unreadable { line, reason } => (Lookup::Unreadable, *line, Some(reason.clone())),
        };
        QueryRead {
            name: stem_of(path),
            path: path.to_string(),
            lookup,
            line,
            reason,
            version: Some(v),
            text: std::str::from_utf8(bytes).ok().map(str::to_string),
            def: (lookup != Lookup::Unreadable).then(|| file.def.clone()),
            broken: file.broken.clone(),
            uses_this: file.uses_this,
            created: file.created.clone(),
            modified: file.modified.clone(),
            trashed_path: None,
        }
    }

    /// Every readable or unreadable `.tegg/queries/*.yml` (direct children, not dot files), in name order. Reads the files
    /// every call (no cache, as `pins()`).
    pub(crate) fn queries(&self) -> Vec<QuerySummary> {
        let defs = self.defs();
        self.live_query_paths()
            .into_iter()
            .filter_map(|p| {
                let (f, v, _) = self.read_of(&p, &defs)?;
                let (lookup, line) = match &f.state {
                    FileState::Ok => (Lookup::Ok, None),
                    FileState::Newer { .. } => (Lookup::Newer, None),
                    FileState::Unreadable { line, .. } => (Lookup::Unreadable, *line),
                };
                let name = stem_of(&p);
                let title = if lookup == Lookup::Unreadable { name.clone() } else { f.def.title.clone() };
                let readable = lookup != Lookup::Unreadable;
                let (view, types) = if readable { (Some(f.def.view), Some(f.def.types.clone())) } else { (None, None) };
                Some(QuerySummary { name, title, path: p, lookup, line, created: f.created, modified: f.modified, uses_this: f.uses_this, version: v, view, types })
            })
            .collect()
    }

    /// One query by name (`name_key`): live first, else the newest trashed one → `Trashed`, else `Missing`.
    pub(crate) fn query(&self, name: &str) -> QueryRead {
        let defs = self.defs();
        if let Some(p) = self.find_live(name) {
            if let Some((f, v, bytes)) = self.read_of(&p, &defs) {
                return self.query_read(&p, &f, v, &bytes);
            }
        }
        let asked = nfc(trim_ws(name));
        let mut out = QueryRead {
            name: asked.clone(),
            path: format!("{QUERIES_DIR}/{asked}.yml"),
            lookup: Lookup::Missing,
            line: None,
            reason: None,
            version: None,
            text: None,
            def: None,
            broken: Vec::new(),
            uses_this: false,
            created: None,
            modified: None,
            trashed_path: None,
        };
        if let Some(t) = self.find_trashed(name) {
            out.lookup = Lookup::Trashed;
            out.text = self.shared.vault.read(&t).ok().and_then(|(b, _)| String::from_utf8(b).ok());
            out.trashed_path = Some(t);
        }
        out
    }

    pub(crate) fn query_run(&self, src: QuerySource, host: Option<&str>, env: &QueryEnv) -> QueryResult {
        // v1-cards §3.1: the definitions and card lists of this run (a type-file change not yet reported is read first).
        let cd = self.shared.card_defs();
        let defs = cd.defs.clone();
        let index_ready = self.shared.graph_ready.load(Ordering::SeqCst);
        let base = |form: Form| QueryResult {
            form,
            name: None,
            lookup: None,
            line: None,
            version: None,
            def: None,
            state: RunState::Ok,
            broken: Vec::new(),
            targets: Vec::new(),
            uses_relative: false,
            rows: Vec::new(),
            index_ready,
            group: None,
            usage: None,
            task_defs: None,
        };
        let run = |mut r: QueryResult, def: QueryDef, syntactic: Vec<Broken>, usage: Option<(UsageKind, tegg_format::usage::UsageRaw)>, columns_set: bool| -> QueryResult {
            // v1-views §17.2, §34.4: a usage's effective `sort`, `columns`, display, grouping, `lanes` and `lane_order`
            // run the query; `def` stays the file's (CP-12, D-1854).
            let usage = usage.map(|(kind, raw)| usage_run(kind, &raw, &def, &defs, columns_set));
            let eval_def = match &usage {
                Some(u) => QueryDef {
                    sort: u.sort.clone(),
                    columns: u.columns.clone(),
                    view: u.view,
                    group_none: u.group_by.is_none() && (def.group_none || matches!(u.own.group_by, Some(UsageGroupBy::None))),
                    group_by: u.group_by.clone(),
                    group_period: u.group_period,
                    lanes: u.lanes,
                    lane_order: u.lane_order.clone(),
                    ..def.clone()
                },
                None => def.clone(),
            };
            // §34.4 (R220): a query's syntactic broken entry that a valid own value replaces is dropped in that usage's run.
            let syntactic: Vec<Broken> = match &usage {
                Some(u) => syntactic
                    .into_iter()
                    .filter(|b| {
                        b.at.is_some()
                            || !match b.key.as_str() {
                                "view" => u.own.view.is_some(),
                                "group_by" => u.own.group_by.is_some(),
                                "lanes" => u.own.lanes.is_some(),
                                "lane_order" => u.own.lane_order.is_some(),
                                _ => false,
                            }
                    })
                    .collect(),
                None => syntactic,
            };
            let group_broken = eval_def.group_by.is_none() && syntactic.iter().any(|b| b.at.is_none() && b.key == "group_by");
            // One index lock for the evaluation, the grouping and the rows' versions and excerpts (§1.6).
            let (e, task_defs) = {
                let idx = lock(&self.shared.index);
                idx.with_query_objects(|objs, resolve| {
                    let mut e = evaluate(objs, resolve, &defs, &eval_def, host, env, group_broken);
                    // Versions, excerpts and read-only flags serve the board's cards and moves (a List or Table run reads
                    // no note text for them; QA review of Q2; NFR-PERF-07, NFR-PERF-08), and Q2-T's task rows (CP-24,
                    // D-1916), all under this one lock.
                    // v1-views §34.4: every wall run, grouped or not, fills the cards.
                    let board = eval_def.view == View::Wall;
                    let mut tdefs: Option<TaskDefs> = None;
                    let mut by_path: Option<crate::tasks5a::PathMap> = None;
                    for (row, &oi) in e.rows.iter_mut().zip(e.hits.iter()) {
                        let o = &objs[oi];
                        let task = o.r#type == "task";
                        if !board && !task {
                            continue;
                        }
                        // v1-cards §3.3: the excerpt (a note text read) only where a card draws it: board runs whose
                        // row's type has `body` among its card keys (FR-TYP-11 AC-18).
                        let keys = cd.keys(o.r#type);
                        let body = board && keys.iter().any(|k| k == "body");
                        let st = if body { idx.note_state(&row.path) } else { idx.note_version(&row.path) };
                        let Some(st) = st else { continue };
                        let paths = by_path.get_or_insert_with(|| objs.iter().enumerate().map(|(i, o)| (o.path, i)).collect());
                        let card = crate::cards::card_data(o, objs, paths, &keys, defs.get(o.r#type), body.then_some(st.excerpt.as_str()));
                        if task {
                            let td = tdefs.get_or_insert_with(|| crate::tasks5a::task_defs_in(&defs));
                            row.task_row = crate::tasks5a::query_task_row(o, objs, paths, td, st.clone()).map(|mut t| {
                                t.card = card.clone();
                                t
                            });
                        }
                        if board {
                            row.version = st.version;
                            row.excerpt = card.excerpt.clone().unwrap_or_default();
                            row.read_only = !st.utf8;
                            row.card = Some(card);
                        }
                    }
                    let any = e.rows.iter().any(|r| r.task_row.is_some());
                    (e, tdefs.filter(|_| any))
                })
            };
            // v1-cards §3.2: Image and PDF cards' files, resolved after the index lock.
            let mut e = e;
            let mut cache = None;
            self.shared.fill_files(e.rows.iter_mut().filter_map(|r| r.card.as_mut().map(|c| (r.path.as_str(), c))), &mut cache);
            let mut broken = syntactic;
            // A `group_by` read as a bad value is also unresolved at run time: listed once.
            let had_group_by = broken.iter().any(|b| b.key == "group_by" && b.at.is_none());
            broken.extend(e.broken.into_iter().filter(|b| !(had_group_by && b.key == "group_by" && b.at.is_none())));
            broken.sort_by_key(rank);
            r.def = Some(def);
            r.state = e.state;
            r.broken = broken;
            r.targets = e.targets;
            r.uses_relative = e.uses_relative;
            r.rows = e.rows;
            r.group = e.group;
            r.usage = usage;
            r.task_defs = task_defs;
            r
        };
        let saved = |name: &str, form: Form, usage: Option<(UsageKind, tegg_format::usage::UsageRaw)>| -> QueryResult {
            let mut r = base(form);
            let Some(p) = self.find_live(name) else {
                r.name = Some(nfc(trim_ws(name)));
                r.lookup = Some(if self.find_trashed(name).is_some() { Lookup::Trashed } else { Lookup::Missing });
                return r;
            };
            r.name = Some(stem_of(&p));
            let Some((f, v, _)) = self.read_of(&p, &defs) else {
                r.lookup = Some(Lookup::Missing);
                return r;
            };
            r.version = Some(v);
            match f.state {
                FileState::Unreadable { line, .. } => {
                    r.lookup = Some(Lookup::Unreadable);
                    r.line = line;
                    r
                }
                FileState::Newer { .. } => {
                    r.lookup = Some(Lookup::Newer);
                    run(r, f.def, f.broken, usage, f.layout.columns_set)
                }
                FileState::Ok => {
                    r.lookup = Some(Lookup::Ok);
                    run(r, f.def, f.broken, usage, f.layout.columns_set)
                }
            }
        };
        match src {
            QuerySource::Saved(name) => saved(&name, Form::Reference, None),
            // v1-views §17.2 (D-1853): the first `views:` item with the name key; none → no own values.
            QuerySource::View { type_key, name } => {
                let want = name_key(&name);
                let item = self.shared.read_type(&type_key).and_then(|t| t.view_items).and_then(|items| items.into_iter().find(|i| name_key(&i.name) == want));
                let raw = match item {
                    Some(i) => tegg_format::usage::UsageRaw { sort: i.sort, columns: i.columns, view: i.view, group_by: i.group_by, lanes: i.lanes, lane_order: i.lane_order, widths: i.widths },
                    None => tegg_format::usage::UsageRaw::default(),
                };
                saved(&name, Form::Reference, Some((UsageKind::Tab, raw)))
            }
            QuerySource::Def { def, name } => {
                let mut r = base(Form::Def);
                if let Some(n) = &name {
                    r.name = Some(nfc(n));
                    r.version = self.find_live(n).and_then(|p| self.shared.vault.version(&p).ok().flatten());
                }
                run(r, def, Vec::new(), None, true)
            }
            QuerySource::Fence(body) => match read_fence(&body) {
                FenceRead::Empty => base(Form::Empty),
                FenceRead::Unreadable { line } => QueryResult { line: Some(line), ..base(Form::Unreadable) },
                FenceRead::Reference { name } => saved(&name, Form::Reference, Some((UsageKind::Block, tegg_format::query_fence::fence_usage(&body)))),
                FenceRead::Inline(mut f) => {
                    if let FileState::Unreadable { line, .. } = f.state {
                        return QueryResult { line: Some(line.unwrap_or(1)), ..base(Form::Unreadable) };
                    }
                    fill_columns(&mut f, &defs);
                    run(base(Form::Inline), f.def, f.broken, None, true)
                }
            },
        }
    }

    /// The live file of `name` read for a write, with the base check of `pins_apply` (D-175).
    fn query_for_write(&self, name: &str, base: &FileVersion) -> Result<(String, Vec<u8>, FileVersion), CoreError> {
        let p = self.find_live(name).ok_or(CoreError::Vault(VaultError::Gone))?;
        let (bytes, v) = match self.shared.vault.read(&p) {
            Ok(x) => x,
            Err(VaultError::NotFound) => return Err(CoreError::Vault(VaultError::Gone)),
            Err(VaultError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Err(CoreError::Vault(VaultError::Gone)),
            Err(e) => return Err(e.into()),
        };
        if !base.same_content(&v) {
            return Err(CoreError::Vault(VaultError::Conflict { disk: v }));
        }
        Ok((p, bytes, v))
    }

    fn write_query(&self, path: &str, bytes: &[u8], base: &FileVersion) -> Result<(), CoreError> {
        if let WriteOutcome::Written(_) = self.shared.vault.write(path, bytes, Some(base))? {
            self.shared.emit(CoreEvent::VaultChanged { paths: vec![path.to_string()] });
        }
        Ok(())
    }

    /// A commit (one atomic write). Base check as `pins_apply` (D-175): Vault(Conflict { disk }) / Vault(Gone).
    pub(crate) fn query_apply(&self, name: &str, base: &FileVersion, def: QueryDef, now: &str) -> Result<QueryRead, CoreError> {
        let defs = self.defs();
        let (p, bytes, _) = self.query_for_write(name, base)?;
        let file = read_named(&bytes, &stem_of(&p), &defs);
        let text = std::str::from_utf8(&bytes).map_err(|_| query_err(QueryError::Unreadable))?;
        if let Some(new) = patch(text, &file, &def, now).map_err(query_err)? {
            self.write_query(&p, new.as_bytes(), base)?;
        }
        Ok(self.query(&stem_of(&p)))
    }

    /// Undo of a commit (§2): writes `text` if the file is still `base`.
    pub(crate) fn query_revert(&self, name: &str, base: &FileVersion, text: &str) -> Result<QueryRead, CoreError> {
        let defs = self.defs();
        let p = self.find_live(name).ok_or(CoreError::Vault(VaultError::Gone))?;
        if let Some((f, _, _)) = self.read_of(&p, &defs) {
            match f.state {
                FileState::Newer { .. } => return Err(query_err(QueryError::NewerVersion)),
                FileState::Unreadable { .. } => return Err(query_err(QueryError::Unreadable)),
                FileState::Ok => {}
            }
        }
        let (p, _, _) = self.query_for_write(name, base)?;
        self.write_query(&p, text.as_bytes(), base)?;
        Ok(self.query(&stem_of(&p)))
    }

    pub(crate) fn taken(&self, stem: &str) -> bool {
        let k = name_key(stem);
        self.live_query_paths().iter().any(|p| name_key(&stem_of(p)) == k)
    }

    pub(crate) fn create_query_file(&self, stem: &str, text: &str) -> Result<QueryRead, CoreError> {
        let path = format!("{QUERIES_DIR}/{stem}.yml");
        match self.shared.vault.create_exact(&path, text.as_bytes()) {
            Ok(_) => {}
            Err(VaultError::NameTaken) => return Err(query_err(QueryError::NameTaken)),
            Err(e) => return Err(e.into()),
        }
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path] });
        Ok(self.query(stem))
    }

    pub(crate) fn query_create(&self, req: QueryCreate, now: &str) -> Result<QueryRead, CoreError> {
        let defs = self.defs();
        let mut title = nfc(trim_ws(&req.title));
        if title.is_empty() {
            return Err(query_err(QueryError::EmptyName));
        }
        let mut stem = nfc(&tegg_format::sanitize_file_stem(&title));
        if stem.is_empty() {
            return Err(query_err(QueryError::EmptyName));
        }
        if self.taken(&stem) {
            if !req.free {
                return Err(query_err(QueryError::NameTaken));
            }
            let mut n = 2;
            while self.taken(&format!("{stem} ({n})")) {
                n += 1;
            }
            stem = format!("{stem} ({n})");
            title = format!("{title} ({n})");
        }
        let (def, tail) = match &req.fence {
            Some(body) => match read_fence(body) {
                FenceRead::Inline(mut f) if !matches!(f.state, FileState::Unreadable { .. }) => {
                    fill_columns(&mut f, &defs);
                    let (mut d, tail) = from_inline(&f, body);
                    d.title = title.clone();
                    (d, tail)
                }
                _ => return Err(query_err(QueryError::Unreadable)),
            },
            None => match req.def {
                Some(mut d) => {
                    d.title = title.clone();
                    (d, None)
                }
                None => (default_def(&title, columns_default(&defs, &[])), None),
            },
        };
        if !(1..=1000).contains(&def.limit) {
            return Err(query_err(QueryError::Limit));
        }
        let text = create_text(&def, now, tail.as_deref());
        self.create_query_file(&stem, &text)
    }

    pub(crate) fn query_duplicate(&self, name: &str, now: &str) -> Result<QueryRead, CoreError> {
        let defs = self.defs();
        let p = self.find_live(name).ok_or(query_err(QueryError::NotFound))?;
        let (f, _, bytes) = self.read_of(&p, &defs).ok_or(query_err(QueryError::NotFound))?;
        match f.state {
            FileState::Newer { .. } => return Err(query_err(QueryError::NewerVersion)),
            FileState::Unreadable { .. } => return Err(query_err(QueryError::Unreadable)),
            FileState::Ok => {}
        }
        let text = String::from_utf8(bytes).map_err(|_| query_err(QueryError::Unreadable))?;
        let base = stem_of(&p);
        let mut n = 2;
        while self.taken(&format!("{base} ({n})")) {
            n += 1;
        }
        let out = duplicate_text(&text, &f, &format!("{} ({n})", f.def.title), now);
        self.create_query_file(&format!("{base} ({n})"), &out)
    }

    /// Moves the file to `.trash/.tegg/queries/<stem>.yml` (a free ` (n)` stem when taken), bytes unchanged. No base.
    pub(crate) fn query_trash(&self, name: &str) -> Result<String, CoreError> {
        let p = self.find_live(name).ok_or(query_err(QueryError::NotFound))?;
        let to = self.shared.vault.trash(&p)?;
        self.drop_file_cache_q();
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![p, to.clone()] });
        Ok(to)
    }

    /// Moves the trashed file `from` back to `.tegg/queries/<stem>.yml` (a free ` (n)` stem when taken), bytes unchanged.
    pub(crate) fn query_restore_path(&self, from: &str, stem: &str) -> Result<QueryRead, CoreError> {
        let mut to_stem = stem.to_string();
        let mut n = 2;
        while self.taken(&to_stem) {
            to_stem = format!("{stem} ({n})");
            n += 1;
        }
        let to = format!("{QUERIES_DIR}/{to_stem}.yml");
        self.shared.vault.move_back(from, &to)?;
        self.shared.vault.prune_trash(from);
        self.drop_file_cache_q();
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![from.to_string(), to] });
        Ok(self.query(&to_stem))
    }

    /// Moves the newest trashed file of `name` back (a free ` (n)` stem when taken), bytes unchanged.
    pub(crate) fn query_restore(&self, name: &str) -> Result<QueryRead, CoreError> {
        let t = self.find_trashed(name).ok_or(query_err(QueryError::NotFound))?;
        let st = stem_of(&t);
        // The query's own name: a ` (n)` the trash added is dropped again (D-1474).
        let stem = if name_key(&st) != name_key(name) { split_suffix(&st).0 } else { st };
        self.query_restore_path(&t, &stem)
    }

    /// Indexed notes (`Index::query_usages`) then templates, each with its title and type, path order.
    pub(crate) fn query_usages(&self, name: &str) -> Vec<QueryUsage> {
        let k = name_key(name);
        let mut out: Vec<QueryUsage> = {
            let idx = lock(&self.shared.index);
            idx.query_usages(&k)
                .into_iter()
                .filter_map(|p| idx.object(&p).map(|o| QueryUsage { path: nfc(&p), title: o.title, r#type: Some(o.r#type), template: false }))
                .collect()
        };
        out.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
        let mut templates: Vec<String> =
            self.shared.vault.list_files().unwrap_or_default().into_iter().map(|p| nfc(&p)).filter(|p| p.starts_with("_templates/") && p.ends_with(".md")).collect();
        templates.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        for p in templates {
            let Ok((bytes, _)) = self.shared.vault.read(&p) else { continue };
            let text = String::from_utf8_lossy(&bytes);
            if !tegg_format::query_fences(&text).iter().any(|f| f.saved.as_deref().is_some_and(|s| name_key(s) == k)) {
                continue;
            }
            let stem = p.rsplit('/').next().unwrap_or(&p).trim_end_matches(".md").to_string();
            let title = nfc(&tegg_format::extract(&bytes, &stem).title);
            out.push(QueryUsage { path: p, title, r#type: None, template: true });
        }
        out
    }

    /// v1-views §1.5: the type files whose `views` names the query (`name_key`), type-key order.
    pub(crate) fn query_view_usages(&self, name: &str) -> Vec<ViewUsage> {
        let k = name_key(name);
        let mut out: Vec<ViewUsage> = Vec::new();
        for p in self.shared.vault.list_dir(".tegg/types").unwrap_or_default() {
            let p = nfc(&p);
            let Some(file) = p.strip_prefix(".tegg/types/") else { continue };
            let Some(key) = file.strip_suffix(".yml") else { continue };
            if key.is_empty() || key.starts_with('.') || key.contains('/') || key.contains(".tegg-tmp") {
                continue;
            }
            let Ok((bytes, _)) = self.shared.vault.read(&p) else { continue };
            let Ok(text) = std::str::from_utf8(&bytes) else { continue };
            let parsed = tegg_schema::parse(key, text);
            if parsed.readability != tegg_schema::Readability::Ok {
                continue;
            }
            if parsed.def.views.iter().flatten().any(|v| name_key(v) == k) {
                out.push(ViewUsage { type_key: key.to_string(), path: p.clone() });
            }
        }
        out.sort_by(|a, b| a.type_key.as_bytes().cmp(b.type_key.as_bytes()));
        out
    }

    /// Notes and templates that use `name` (the rename job's usages), path order.
    /// v1-views §38 (D-2193): the notes the index lists with a reference fence whose own `lane_order` has an `[[…]]`
    /// entry resolving (D-291, from the vault root) to `from_path`. Each is read once; nothing is written.
    pub(crate) fn fence_lane_order_paths(&self, from_path: &str) -> Vec<String> {
        let from = nfc(from_path);
        let candidates = lock(&self.shared.index).query_usage_paths_all();
        let paths: Vec<String> = self.shared.vault.list_files().unwrap_or_default().into_iter().filter(|p| p.ends_with(".md") && !p.split('/').any(|c| c.starts_with('.'))).map(|p| nfc(&p)).collect();
        let mut out = Vec::new();
        for p in candidates {
            let Ok((bytes, _)) = self.shared.vault.read(&p) else { continue };
            let text = String::from_utf8_lossy(&bytes);
            let hit = tegg_format::query_fences(&text).iter().any(|f| match tegg_format::query_fence::fence_usage(&f.body).lane_order {
                tegg_format::usage::UsageValue::Set(l) => l.iter().any(|e| {
                    let Some(inner) = e.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) else { return false };
                    let target = inner.split(['|', '#']).next().unwrap_or("");
                    resolve_root(target, &paths).as_deref() == Some(from.as_str())
                }),
                _ => false,
            });
            if hit {
                out.push(nfc(&p));
            }
        }
        out
    }

    pub(crate) fn query_usage_paths(&self, name: &str) -> Vec<String> {
        self.query_usages(name).into_iter().map(|u| u.path).collect()
    }

    fn drop_file_cache_q(&self) {
        *lock(&self.shared.files) = None;
    }

    /// Slice Q (§1.9): the pin row of a query: its live file (readable or not) → `(Ok, path, title)`; a trashed one →
    /// `(Trashed, trashed path, title)`; else Missing.
    pub(crate) fn query_pin(&self, name: &str) -> (Lookup, Option<String>, Option<String>) {
        let defs = self.defs();
        if let Some(p) = self.find_live(name) {
            let title = self.read_of(&p, &defs).map(|(f, _, _)| if f.layout.readable { f.def.title } else { stem_of(&p) }).unwrap_or_else(|| stem_of(&p));
            return (Lookup::Ok, Some(title), Some(p));
        }
        if let Some(t) = self.find_trashed(name) {
            let title = self.read_of(&t, &defs).map(|(f, _, _)| if f.layout.readable { f.def.title } else { stem_of(&t) }).unwrap_or_else(|| stem_of(&t));
            return (Lookup::Trashed, Some(title), Some(t));
        }
        (Lookup::Missing, None, None)
    }

    /// The live name of a query (its file's stem), for a pin (§1.9).
    pub(crate) fn query_live_name(&self, name: &str) -> Option<String> {
        self.find_live(name).map(|p| stem_of(&p))
    }

    /// §1.10: the Trash view's rows of trashed query files.
    pub(crate) fn query_trash_rows(&self) -> Vec<(String, String)> {
        let defs = self.defs();
        let mut v: Vec<String> = self.shared.vault.list_dir(TRASHED_QUERIES_DIR).unwrap_or_default().into_iter().map(|p| nfc(&p)).filter(|p| p.ends_with(".yml") && !stem_of(p).starts_with('.')).collect();
        v.sort();
        v.into_iter()
            .map(|p| {
                let title = self.read_of(&p, &defs).map(|(f, _, _)| if f.layout.readable { f.def.title } else { stem_of(&p) }).unwrap_or_else(|| stem_of(&p));
                (p, title)
            })
            .collect()
    }

    /// §1.8: the rename job's refusals and plan (the query file before and after, the usages at scan time).
    pub(crate) fn query_rename_plan(&self, name: &str, title: &str) -> Result<tegg_jobs::host::QueryRenamePlan, QueryError> {
        // §11 (D-1510, FR-QRY-06 AC-22): refused at once while the first index build runs; the flag is read without the
        // index lock, so the refusal never waits for the build.
        if !self.shared.graph_ready.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(QueryError::IndexNotReady);
        }
        let defs = self.defs();
        let p = self.find_live(name).ok_or(QueryError::NotFound)?;
        let (bytes, v) = self.shared.vault.read(&p).map_err(|_| QueryError::NotFound)?;
        let f = read_named(&bytes, &stem_of(&p), &defs);
        match f.state {
            FileState::Newer { .. } => return Err(QueryError::NewerVersion),
            FileState::Unreadable { .. } => return Err(QueryError::Unreadable),
            FileState::Ok => {}
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| QueryError::Unreadable)?;
        let title = nfc(trim_ws(title));
        let stem = nfc(&tegg_format::sanitize_file_stem(&title));
        if title.is_empty() || stem.is_empty() {
            return Err(QueryError::EmptyName);
        }
        let from_name = stem_of(&p);
        if title == f.def.title && stem == from_name {
            return Err(QueryError::NothingToDo);
        }
        let k = name_key(&stem);
        if let Some(other) = self.live_query_paths().into_iter().find(|x| *x != p && name_key(&stem_of(x)) == k) {
            let _ = other;
            return Err(QueryError::NameTaken);
        }
        let to = format!("{QUERIES_DIR}/{stem}.yml");
        let post = retitle_text(text, &f, &title).into_bytes();
        let usages = self.query_usage_paths(&from_name).into_iter().filter_map(|u| self.shared.vault.version(&u).ok().flatten().map(|v| (u, v))).collect();
        // v1-views §1.10 (D-1762): every type file whose `views:` names the query gets its entry patched.
        let views = self
            .query_view_usages(&from_name)
            .into_iter()
            .filter_map(|u| {
                let (pre, pre_v) = self.shared.vault.read(&u.path).ok()?;
                let post = tegg_schema::rename_view(std::str::from_utf8(&pre).ok()?, &from_name, &stem)?.into_bytes();
                Some(tegg_jobs::host::ViewsRow { path: u.path, pre, pre_v, post })
            })
            .collect();
        Ok(tegg_jobs::host::QueryRenamePlan { from: p, to, from_name, to_name: stem, pre: bytes, pre_v: v, post, usages, views })
    }

    /// The name another query already has (`NameTaken`'s `existing`), for the job's refusal.
    pub(crate) fn query_name_taken_by(&self, title: &str, own: &str) -> Option<String> {
        let k = name_key(&tegg_format::sanitize_file_stem(&nfc(trim_ws(title))));
        let own = self.find_live(own);
        self.live_query_paths().into_iter().find(|x| Some(x) != own.as_ref() && name_key(&stem_of(x)) == k).map(|x| stem_of(&x))
    }

    /// §1.8: patches every live query file a patch matches, each against the version just read.
    pub(crate) fn patch_query_files(&self, patches: &[QueryPatch]) -> Vec<(String, Result<Option<tegg_jobs::host::FileWrite>, tegg_jobs::host::WriteError>)> {
        use tegg_jobs::host::{FileWrite, WriteError};
        let mut out = Vec::new();
        for p in self.live_query_paths() {
            let Ok((pre, pre_v)) = self.shared.vault.read(&p) else { continue };
            let Ok(text) = std::str::from_utf8(&pre) else { continue };
            let file = read(&pre);
            let Some(post) = patch_job_text(text, &file, patches) else { continue };
            let r = match self.shared.vault.write(&p, post.as_bytes(), Some(&pre_v)) {
                Ok(WriteOutcome::Written(post_v)) => {
                    self.shared.emit(CoreEvent::VaultChanged { paths: vec![p.clone()] });
                    Ok(Some(FileWrite { path: p.clone(), pre: pre.clone(), pre_v, post: post.into_bytes(), post_v }))
                }
                Ok(WriteOutcome::Unchanged) => Ok(None),
                Err(VaultError::Conflict { .. }) => Err(WriteError::Changed),
                Err(VaultError::Gone) | Err(VaultError::NotFound) => Err(WriteError::Missing),
                Err(e) => Err(WriteError::Io(format!("{e:?}"))),
            };
            out.push((p, r));
        }
        out
    }
}
