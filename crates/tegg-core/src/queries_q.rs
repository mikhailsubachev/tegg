//! Slice Q (docs/contracts/v1-queries.md §1): compile-only red-test stubs, no behaviour (TS-I1). The build replaces them.
//! Every reader answers "unreadable" or nothing, every writer refuses, so the red tests fail by assertion.
use chrono::NaiveDate;

use crate::{Core, CoreError, FileVersion, LinkTarget, TaskState};

pub const QUERIES_DIR: &str = ".tegg/queries";
pub const TRASHED_QUERIES_DIR: &str = ".trash/.tegg/queries";
pub const QUERY_VERSION: u32 = 1;
/// The first line of a file Tegg creates: HEADER + title + ".".
pub const HEADER: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Match { All, Any }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View { List, Table }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Order { Asc, Desc }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sort { pub by: String, pub order: Order }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Is, IsNot, Contains, IsEmpty, IsNotEmpty, IsAnyOf,
    HasAnyOf, HasAllOf, HasNoneOf,
    Before, After, Between, Today, ThisWeek, WithinNextDays, Overdue,
    Eq, Ne, Lt, Gt,
    LinksTo,
}

impl Op {
    /// Stub: no names yet.
    pub fn as_str(self) -> &'static str {
        ""
    }
    /// Stub: parses nothing.
    pub fn parse(_s: &str) -> Option<Op> {
        None
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum FilterItem {
    Filter { key: String, op: Op, value: serde_json::Value, src: Option<Vec<usize>> },
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
pub enum FileState { Ok, Newer { version: u64 }, Unreadable { line: Option<u32>, reason: String } }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokenReason { BadValue, Shape, Operator, NestedGroup, NotAttribute, OperatorKind, Value, NoType }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Broken { pub reason: BrokenReason, pub at: Option<Vec<usize>>, pub key: String, pub r#type: Option<String> }

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Layout;

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
pub enum FenceRead { Empty, Reference { name: String }, Inline(QueryFile), Unreadable { line: u32 } }

#[derive(Debug, Clone, PartialEq)]
pub struct QueryEnv { pub today: NaiveDate, pub tz: chrono_tz::Tz, pub week_start: chrono::Weekday, pub locale: String }

#[derive(Debug, Clone, PartialEq)]
pub enum QuerySource { Saved(String), Fence(String), Def { def: QueryDef, name: Option<String> } }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form { Reference, Inline, Unreadable, Empty, Def }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup { Ok, Newer, Unreadable, Missing, Trashed }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState { Ok, NoType, NeedsHost, NeedsContext }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskBits { pub status: Option<String>, pub state: TaskState, pub due: Option<NaiveDate> }

#[derive(Debug, Clone, PartialEq)]
pub struct QueryRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub values: serde_json::Map<String, serde_json::Value>,
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
pub struct QueryUsage { pub path: String, pub title: String, pub r#type: Option<String>, pub template: bool }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryError { NewerVersion, Unreadable, NameTaken, EmptyName, NotFound, Limit, NothingToDo }

#[derive(Debug, Clone, PartialEq)]
pub struct QueryCreate {
    pub title: String,
    pub def: Option<QueryDef>,
    pub fence: Option<String>,
    pub free: bool,
}

fn stub_def() -> QueryDef {
    QueryDef {
        title: String::new(),
        types: Vec::new(),
        r#match: Match::All,
        filters: Vec::new(),
        sort: Sort { by: String::new(), order: Order::Asc },
        limit: 0,
        view: View::List,
        columns: Vec::new(),
    }
}

fn stub_file() -> QueryFile {
    QueryFile {
        state: FileState::Unreadable { line: None, reason: "NotImplemented".into() },
        def: stub_def(),
        broken: Vec::new(),
        uses_this: false,
        created: None,
        modified: None,
        layout: Layout,
    }
}

fn stub_read(name: &str) -> QueryRead {
    QueryRead {
        name: name.to_string(),
        path: String::new(),
        lookup: Lookup::Missing,
        line: None,
        reason: Some("NotImplemented".into()),
        version: None,
        text: None,
        def: None,
        broken: Vec::new(),
        uses_this: false,
        created: None,
        modified: None,
        trashed_path: None,
    }
}

/// Stub: every file reads as unreadable.
pub fn read(_bytes: &[u8]) -> QueryFile {
    stub_file()
}
/// Stub: every body reads as unreadable.
pub fn read_fence(_body: &str) -> FenceRead {
    FenceRead::Unreadable { line: 0 }
}
/// Stub: no folding.
pub fn name_key(s: &str) -> String {
    s.to_string()
}
/// Stub: refuses.
pub fn patch(_text: &str, _file: &QueryFile, _def: &QueryDef, _now: &str) -> Result<Option<String>, QueryError> {
    Err(QueryError::Unreadable)
}
/// Stub: nothing.
pub fn create_text(_def: &QueryDef, _now: &str, _tail: Option<&str>) -> String {
    String::new()
}
/// Stub: defaults.
pub fn from_inline(_file: &QueryFile, _body: &str) -> (QueryDef, Option<String>) {
    (stub_def(), None)
}
/// Stub: nothing.
pub fn duplicate_text(_text: &str, _file: &QueryFile, _title: &str, _now: &str) -> String {
    String::new()
}
/// Stub: nothing.
pub fn retitle_text(_text: &str, _file: &QueryFile, _title: &str) -> String {
    String::new()
}

impl Core {
    pub fn queries(&self) -> Vec<QuerySummary> {
        Vec::new()
    }
    pub fn query(&self, name: &str) -> QueryRead {
        stub_read(name)
    }
    pub fn query_run(&self, _src: QuerySource, _host: Option<&str>, _env: &QueryEnv) -> QueryResult {
        QueryResult {
            form: Form::Empty,
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
            index_ready: false,
        }
    }
    pub fn query_apply(&self, _name: &str, _base: &FileVersion, _def: QueryDef, _now: &str) -> Result<QueryRead, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_revert(&self, _name: &str, _base: &FileVersion, _text: &str) -> Result<QueryRead, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_create(&self, _req: QueryCreate, _now: &str) -> Result<QueryRead, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_duplicate(&self, _name: &str, _now: &str) -> Result<QueryRead, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_trash(&self, _name: &str) -> Result<String, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_restore(&self, _name: &str) -> Result<QueryRead, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn query_usages(&self, _name: &str) -> Vec<QueryUsage> {
        Vec::new()
    }
}
