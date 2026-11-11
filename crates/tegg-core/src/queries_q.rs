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
use crate::{lock, Core, CoreError, CoreEvent, FileVersion, LinkTarget, TaskState};

pub const QUERIES_DIR: &str = ".tegg/queries";
pub const TRASHED_QUERIES_DIR: &str = ".trash/.tegg/queries";
pub const QUERY_VERSION: u32 = 1;
/// The first line of a file Tegg creates: HEADER + title + ".".
pub const HEADER: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ";

/// R138 create order; also the order "the nearest earlier / later known key" is looked up in (§1.4).
const ORDER: [&str; 11] = ["version", "title", "types", "match", "filters", "sort", "limit", "view", "columns", "created", "modified"];
/// The keys a commit compares (the title is the rename job's, D-1454).
const COMMIT_KEYS: [&str; 7] = ["types", "match", "filters", "sort", "limit", "view", "columns"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Match {
    All,
    Any,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    List,
    Table,
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
}

const OPS: [Op; 21] = [
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
    pub sort: Sort,
    pub limit: u32,
    pub view: View,
    pub columns: Vec<String>,
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
        sort: Sort { by: "modified".into(), order: Order::Desc },
        limit: 50,
        view: View::List,
        columns,
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
        let ok = match v {
            Yaml::Hash(_) => match (&v["by"], &v["order"]) {
                (Yaml::String(by), o) if !trim_ws(by).is_empty() => match o {
                    Yaml::BadValue | Yaml::Null => Some((by.clone(), Order::Asc)),
                    Yaml::String(s) if s == "asc" => Some((by.clone(), Order::Asc)),
                    Yaml::String(s) if s == "desc" => Some((by.clone(), Order::Desc)),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        match ok {
            Some((by, order)) => def.sort = Sort { by: nfc(trim_ws(&by)), order },
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
            _ => bad_key("view"),
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

fn top_line(k: &str, def: &QueryDef) -> Option<String> {
    Some(match k {
        "types" => format!("types: {}", flow_list(&def.types)),
        "match" => format!("match: {}", def.r#match.as_str()),
        "sort" => format!("sort: {{ by: {}, order: {} }}", scalar_in(&def.sort.by, true), def.sort.order.as_str()),
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
        "sort" => json!([nfc(&def.sort.by), def.sort.order.as_str()]),
        "limit" => json!(def.limit),
        "view" => json!(def.view.as_str()),
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
    let changed: Vec<&str> = COMMIT_KEYS.iter().copied().filter(|k| effective(&file.def, k, true) != effective(def, k, true)).collect();
    if changed.is_empty() {
        return Ok(None);
    }
    let mut edits: Vec<(usize, usize, Vec<String>, usize)> = Vec::new();
    for k in changed.iter().copied().chain(std::iter::once("modified")) {
        let mut lines = match k {
            "filters" => filters_block(def, file),
            "modified" => vec![format!("modified: {now}")],
            other => vec![top_line(other, def).unwrap_or_default()],
        };
        let order = ORDER.iter().position(|x| *x == k).unwrap_or(ORDER.len());
        match l.keys.iter().find(|x| x.key == k) {
            Some(r) => {
                // A one-line key keeps its trailing comment (D-1457).
                if r.end - r.start == 1 && lines.len() == 1 {
                    let old = &l.lines[r.start].body;
                    if let Some((_, colon)) = key_at(old, 0) {
                        if let Some(c) = trailing_comment_at(old, colon + 1) {
                            lines[0].push_str(&old[c..]);
                        }
                    }
                }
                edits.push((r.start, r.end, lines, order));
            }
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
            .all(|k| effective(&back.def, k, false) == effective(def, k, false));
    if !ok {
        return Err(QueryError::Unreadable);
    }
    Ok((next != text).then_some(next))
}

/// A new file (R138 create order). `tail`: lines copied verbatim after `modified` (Save as query…, §1.5).
pub fn create_text(def: &QueryDef, now: &str, tail: Option<&str>) -> String {
    let mut l = vec![format!("{HEADER}{}.", nfc(&def.title)), "version: 1".into(), format!("title: {}", scalar_in(&def.title, false))];
    l.push(top_line("types", def).unwrap_or_default());
    l.push(top_line("match", def).unwrap_or_default());
    if def.filters.is_empty() {
        l.push("filters: []".into());
    } else {
        l.push("filters:".into());
        l.extend(def.filters.iter().flat_map(|f| item_lines(f, 2)));
    }
    for k in ["sort", "limit", "view", "columns"] {
        l.push(top_line(k, def).unwrap_or_default());
    }
    l.push(format!("created: {now}"));
    l.push(format!("modified: {now}"));
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
    let f = l.keys.iter().find(|k| k.key == "filters")?;
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
        for line in lines.iter_mut().take(f.end).skip(f.start) {
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
fn move_links_in(item: &mut FilterItem, moved: &impl Fn(&str) -> Option<String>) {
    fn value(v: &mut Value, moved: &impl Fn(&str) -> Option<String>) {
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
            Value::Array(a) => a.iter_mut().for_each(|x| value(x, moved)),
            _ => {}
        }
    }
    match item {
        FilterItem::Filter { value: v, .. } => value(v, moved),
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
        if !f.layout.columns_set {
            f.def.columns = columns_default(defs, &f.def.types);
        }
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
fn collator(locale: &str) -> Arc<Coll> {
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

impl Ctx<'_> {
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

fn sort_rows(hits: &mut [usize], def: &QueryDef, chosen: &[String], ctx: &Ctx, broken: &mut Vec<Broken>) {
    let coll = collator(&ctx.env.locale);
    let mut by = nfc(&def.sort.by);
    let mut order = def.sort.order;
    let mut options: Vec<String> = Vec::new();
    let mut kind = match by.as_str() {
        "title" => Some(Kind::Text),
        "created" | "modified" => Some(Kind::DateTime),
        _ => None,
    };
    if kind.is_none() {
        let infos: Vec<Option<AttrInfo>> = if chosen.is_empty() { vec![attr_of(None, &by)] } else { chosen.iter().map(|t| attr_of(ctx.defs.get(t), &by)).collect() };
        let first = infos.first().cloned().flatten();
        match first {
            Some(f) if f.kind != Kind::Unsupported && infos.iter().all(|a| a.as_ref().is_some_and(|a| a.kind == f.kind)) => {
                options = f.options.iter().map(|(l, _)| fold(l)).collect();
                kind = Some(f.kind);
            }
            _ => {
                broken.push(Broken { reason: BrokenReason::BadValue, at: None, key: "sort".into(), r#type: None });
                by = "modified".into();
                order = Order::Desc;
                kind = Some(Kind::DateTime);
            }
        }
    }
    let kind = kind.expect("set above");
    let none = SortKey { empty: true, n: 0.0, s: String::new() };
    let key_of = |o: &QueryObject| -> SortKey {
        if by == "title" {
            return SortKey { empty: false, n: 0.0, s: o.title.to_string() };
        }
        let raw: Option<Value> = if by == "tags" { Some(json!(o.tags)) } else { o.attributes.get(by.as_str()).cloned() };
        let raw = raw.as_ref();
        match kind {
            Kind::Number => match raw.filter(|x| x.is_number()).and_then(Value::as_f64) {
                Some(n) => SortKey { empty: false, n, s: String::new() },
                None => none.clone(),
            },
            Kind::Date | Kind::DateTime => match instant_ms(raw, &ctx.env.tz) {
                Some(n) => SortKey { empty: false, n: n as f64, s: String::new() },
                None => none.clone(),
            },
            Kind::Checkbox => match raw.and_then(Value::as_bool) {
                Some(b) => SortKey { empty: false, n: if b { 1.0 } else { 0.0 }, s: String::new() },
                None => none.clone(),
            },
            Kind::Select | Kind::Review => match strs(raw).into_iter().next() {
                Some(s) => {
                    let i = options.iter().position(|x| *x == fold(&s)).unwrap_or(options.len());
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
    let keys: HashMap<usize, SortKey> = hits.iter().map(|i| (*i, key_of(&ctx.objs[*i]))).collect();
    hits.sort_by(|a, b| {
        let (x, y) = (&keys[a], &keys[b]);
        if x.empty != y.empty {
            return if x.empty { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Less };
        }
        if !x.empty {
            let c = x.n.partial_cmp(&y.n).unwrap_or(std::cmp::Ordering::Equal).then_with(|| coll.compare(&x.s, &y.s));
            if c != std::cmp::Ordering::Equal {
                return if order == Order::Desc { c.reverse() } else { c };
            }
        }
        let (oa, ob) = (&ctx.objs[*a], &ctx.objs[*b]);
        coll.compare(oa.title, ob.title).then_with(|| nfc(oa.path).as_bytes().cmp(nfc(ob.path).as_bytes()))
    });
}

/// What `evaluate` answers.
struct Evaluated {
    state: RunState,
    broken: Vec<Broken>,
    targets: Vec<String>,
    uses_relative: bool,
    rows: Vec<QueryRow>,
}

fn row_of(o: &QueryObject, def: &QueryDef, ctx: &Ctx) -> QueryRow {
    let mut cols: Vec<String> = def.columns.iter().map(|c| nfc(c)).collect();
    for k in ["type", "tags"] {
        if !cols.iter().any(|c| c == k) {
            cols.push(k.into());
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
        links: Vec::new(),
        task,
    }
}

fn evaluate(objs: &[QueryObject], resolve: &dyn Fn(&str) -> Option<String>, defs: &Defs, def: &QueryDef, host: Option<&str>, env: &QueryEnv) -> Evaluated {
    let mut broken: Vec<Broken> = Vec::new();
    let chosen: Vec<String> = def.types.iter().map(|t| nfc(t)).collect();
    let missing: Vec<&String> = chosen.iter().filter(|t| !defs.contains_key(*t) && !objs.iter().any(|o| o.r#type == t.as_str())).collect();
    if !missing.is_empty() {
        broken.extend(missing.into_iter().map(|t| Broken { reason: BrokenReason::NoType, at: None, key: t.clone(), r#type: None }));
        return Evaluated { state: RunState::NoType, broken, targets: Vec::new(), uses_relative: false, rows: Vec::new() };
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
        return Evaluated { state: RunState::NeedsHost, broken, targets: Vec::new(), uses_relative: relative, rows: Vec::new() };
    }
    if date_this && ctx.host_daily.is_none() {
        return Evaluated { state: RunState::NeedsContext, broken, targets: ctx.host.iter().cloned().collect(), uses_relative: relative, rows: Vec::new() };
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
    sort_rows(&mut hits, def, &chosen, &ctx, &mut broken);
    let rows = hits.iter().map(|i| row_of(&objs[*i], def, &ctx)).collect();
    let mut targets: Vec<String> = targets.into_iter().collect();
    targets.sort_by(|a, b| nfc(a).as_bytes().cmp(nfc(b).as_bytes()));
    Evaluated { state: RunState::Ok, broken, targets, uses_relative: relative, rows }
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
    fn q(&self) -> QCore<'_> {
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
                Some(QuerySummary { name, title, path: p, lookup, line, created: f.created, modified: f.modified, uses_this: f.uses_this, version: v })
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
        let defs = self.defs();
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
        };
        let run = |mut r: QueryResult, def: QueryDef, syntactic: Vec<Broken>| -> QueryResult {
            let e = lock(&self.shared.index).with_query_objects(|objs, resolve| evaluate(objs, resolve, &defs, &def, host, env));
            let mut broken = syntactic;
            broken.extend(e.broken);
            broken.sort_by_key(rank);
            r.def = Some(def);
            r.state = e.state;
            r.broken = broken;
            r.targets = e.targets;
            r.uses_relative = e.uses_relative;
            r.rows = e.rows;
            r
        };
        let saved = |name: &str, form: Form| -> QueryResult {
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
                    run(r, f.def, f.broken)
                }
                FileState::Ok => {
                    r.lookup = Some(Lookup::Ok);
                    run(r, f.def, f.broken)
                }
            }
        };
        match src {
            QuerySource::Saved(name) => saved(&name, Form::Reference),
            QuerySource::Def { def, name } => {
                let mut r = base(Form::Def);
                if let Some(n) = &name {
                    r.name = Some(nfc(n));
                    r.version = self.find_live(n).and_then(|p| self.shared.vault.version(&p).ok().flatten());
                }
                run(r, def, Vec::new())
            }
            QuerySource::Fence(body) => match read_fence(&body) {
                FenceRead::Empty => base(Form::Empty),
                FenceRead::Unreadable { line } => QueryResult { line: Some(line), ..base(Form::Unreadable) },
                FenceRead::Reference { name } => saved(&name, Form::Reference),
                FenceRead::Inline(mut f) => {
                    if let FileState::Unreadable { line, .. } = f.state {
                        return QueryResult { line: Some(line.unwrap_or(1)), ..base(Form::Unreadable) };
                    }
                    if !f.layout.columns_set {
                        f.def.columns = columns_default(&defs, &f.def.types);
                    }
                    run(base(Form::Inline), f.def, f.broken)
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

    fn taken(&self, stem: &str) -> bool {
        let k = name_key(stem);
        self.live_query_paths().iter().any(|p| name_key(&stem_of(p)) == k)
    }

    fn create_query_file(&self, stem: &str, text: &str) -> Result<QueryRead, CoreError> {
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
                    if !f.layout.columns_set {
                        f.def.columns = columns_default(&defs, &f.def.types);
                    }
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

    /// Notes and templates that use `name` (the rename job's usages), path order.
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
        Ok(tegg_jobs::host::QueryRenamePlan { from: p, to, from_name, to_name: stem, pre: bytes, pre_v: v, post, usages })
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
