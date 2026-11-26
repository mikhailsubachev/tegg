//! Slice 5A-1: the task query and the Daily Note's `Tasks due` (docs/contracts/ms5-tasks.md §2.1, §2.3; D-470…D-489).
//! The core returns raw and parsed values only; it never decides "today", "overdue" or a section (§1). Every field
//! comes from the indexed file (AR-01), so a rebuilt index gives the same rows (FR-TSK-01 AC-7).

use std::collections::BTreeSet;

use chrono::NaiveDate;
use serde_json::Value;
use tegg_format::nfc;
use tegg_schema::{option_state, OptionDef, TypeFile};

use crate::daily::in_window;
use crate::types3d::link_inner;
use crate::{Core, DayWindow, FileVersion, LinkTarget, ObjectInfo, Resolver};

pub use tegg_schema::TaskState;

/// One task (R44): every indexed object whose matched type is `task`, outside `_templates/` and `.trash/`.
#[derive(Debug, Clone, PartialEq)]
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
    /// v1-cards §3.3 (slice OC): the Task card's data with Task's keys, from the same index read.
    pub card: crate::cards::CardData,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatusOption {
    pub label: String,
    pub color: Option<String>,
    pub state: TaskState,
    pub state_raw: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskDefs {
    pub statuses: Vec<StatusOption>,
    pub priorities: Vec<OptionDef>,
    pub unknown_states: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone)]
pub struct DailyTaskRows {
    pub overdue: Vec<TaskRow>,
    pub due: Vec<TaskRow>,
    pub completed: Vec<TaskRow>,
    pub total: usize,
}

/// A scalar frontmatter value as written (NFC); lists, maps and null aren't one.
fn scalar(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(nfc(s)),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn options<'a>(def: &'a TypeFile, key: &str) -> &'a [OptionDef] {
    def.attributes.iter().find(|a| a.key == key).map(|a| a.options.as_slice()).unwrap_or(&[])
}

/// The Task type as the vault defines it, else the built-in file (D-90).
fn task_type(core: &Core) -> TypeFile {
    task_type_in(core.shared.type_defs())
}

fn task_type_in(mut defs: std::collections::BTreeMap<String, TypeFile>) -> TypeFile {
    defs.remove("task").unwrap_or_else(|| tegg_schema::parse("task", tegg_schema::builtin("task").unwrap_or("")).def)
}

/// v1-views §24.4 (CP-24, D-1916): `Core::task_defs()` from type definitions already read (a query run's).
pub(crate) fn task_defs_in(defs: &std::collections::BTreeMap<String, TypeFile>) -> TaskDefs {
    match defs.get("task") {
        Some(t) => defs_of(t),
        None => defs_of(&task_type_in(Default::default())),
    }
}

fn defs_of(def: &TypeFile) -> TaskDefs {
    let mut unknown = Vec::new();
    let statuses = options(def, "status")
        .iter()
        .map(|o| {
            let raw = option_state(o).map(str::to_string);
            let state = raw.as_deref().and_then(TaskState::parse);
            if state.is_none() {
                unknown.push((o.label.clone(), raw.clone()));
            }
            StatusOption { label: o.label.clone(), color: o.color.clone(), state: state.unwrap_or(TaskState::Open), state_raw: raw }
        })
        .collect();
    TaskDefs { statuses, priorities: options(def, "priority").to_vec(), unknown_states: unknown }
}

impl Core {
    /// R44 task query (§2.1): unsorted, one index read per row, no file read.
    pub fn tasks(&self) -> Vec<TaskRow> {
        let defs = defs_of(&task_type(self));
        let all = self.objects();
        let resolver = Resolver::new(&all, &self.shared);
        let mut rows: Vec<TaskRow> = {
            let idx = self.index();
            all.iter().filter(|o| o.r#type == "task").filter_map(|o| row(o, &defs, &resolver, idx.note_state(&o.path)?)).collect()
        };
        // android-edit §3.1 (D-2554): a file stored under an NFD name is read-only on the phone (never on macOS).
        self.shared.mark_nfd_read_only(rows.iter_mut().map(|r| (r.path.as_str(), &mut r.read_only)));
        // v1-cards §3.3: every row's card from one index read.
        let paths: Vec<String> = rows.iter().map(|r| nfc(&r.path)).collect();
        let mut cards = self.cards_for(&paths);
        for r in &mut rows {
            if let Some(c) = cards.remove(&nfc(&r.path)) {
                r.card = c;
            }
        }
        rows
    }

    /// The Task type's status and priority options (§2.1).
    pub fn task_defs(&self) -> TaskDefs {
        defs_of(&task_type(self))
    }

    /// FR-DLY-04 AC-9 (§2.3, D-485): overdue (only on today's note), due on the date, completed in the window.
    pub fn daily_tasks(&self, w: &DayWindow, today: NaiveDate, limit: usize) -> DailyTaskRows {
        let rows = self.tasks();
        let open = |r: &TaskRow| matches!(r.state, TaskState::Open | TaskState::InProgress);
        let by_title = |a: &TaskRow, b: &TaskRow| a.title.to_lowercase().cmp(&b.title.to_lowercase()).then_with(|| nfc(&a.path).cmp(&nfc(&b.path)));
        let mut overdue: Vec<TaskRow> = if w.date == today { rows.iter().filter(|r| open(r) && r.due.is_some_and(|d| d < today)).cloned().collect() } else { Vec::new() };
        overdue.sort_by(|a, b| a.due.cmp(&b.due).then(a.priority_rank.cmp(&b.priority_rank)).then_with(|| by_title(a, b)));
        let mut due: Vec<TaskRow> = rows.iter().filter(|r| open(r) && r.due == Some(w.date)).cloned().collect();
        due.sort_by(|a, b| a.priority_rank.cmp(&b.priority_rank).then_with(|| by_title(a, b)));
        let mut completed: Vec<(i64, TaskRow)> = rows
            .iter()
            .filter(|r| r.state == TaskState::Done)
            .filter_map(|r| Some((in_window(&Value::String(r.completed.clone()?), w)?.0, r.clone())))
            .collect();
        completed.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| by_title(&a.1, &b.1)));
        let completed: Vec<TaskRow> = completed.into_iter().map(|x| x.1).collect();
        let total = overdue.len() + due.len() + completed.len();
        let mut left = limit;
        let mut take = |v: Vec<TaskRow>| {
            let n = v.len().min(left);
            left -= n;
            v.into_iter().take(n).collect::<Vec<_>>()
        };
        let (overdue, due, completed) = (take(overdue), take(due), take(completed));
        DailyTaskRows { overdue, due, completed, total }
    }

    /// D-328: paths `daily_context` leaves out of Created and Modified because Tasks due lists them for the window
    /// (due on the date or completed in it; overdue rows depend on today and aren't excluded).
    pub(crate) fn daily_task_paths(&self, w: &DayWindow) -> BTreeSet<String> {
        let d = self.daily_tasks(w, NaiveDate::MIN, usize::MAX);
        d.due.iter().chain(&d.completed).map(|r| nfc(&r.path)).collect()
    }
}

fn row(o: &ObjectInfo, defs: &TaskDefs, resolver: &Resolver, st: tegg_index::NoteState) -> Option<TaskRow> {
    let fm = o.attributes.as_object()?;
    let source = fm.get("source").and_then(link_inner).and_then(|t| resolver.resolve(&o.path, &[t]).into_iter().next());
    Some(build(Fields { path: &o.path, id: o.id.as_deref(), title: &o.title, tags: &o.tags }, fm, defs, source, st))
}

/// v1-views §24.4 (CP-24, D-1916): a query row's `TaskRow`, from the query evaluator's index read (no file read, no
/// second lock). `source` resolves through the index's own resolution of the object's `source` link.
pub(crate) fn query_task_row(o: &tegg_index::QueryObject, objs: &[tegg_index::QueryObject], by_path: &PathMap, defs: &TaskDefs, st: tegg_index::NoteState) -> Option<TaskRow> {
    let fm = o.attributes.as_object()?;
    let source = fm.get("source").and_then(link_inner).map(|t| {
        let to = o.attr_links.iter().find(|(a, _, _)| nfc(a) == "source").and_then(|(_, _, p)| *p);
        query_link(objs, by_path, t, to)
    });
    Some(build(Fields { path: o.path, id: o.id, title: o.title, tags: o.tags }, fm, defs, source, st))
}

struct Fields<'a> {
    path: &'a str,
    id: Option<&'a str>,
    title: &'a str,
    tags: &'a [String],
}

fn build(o: Fields, fm: &serde_json::Map<String, Value>, defs: &TaskDefs, source: Option<LinkTarget>, st: tegg_index::NoteState) -> TaskRow {
    let status = scalar(fm.get("status"));
    let opt = status.as_ref().and_then(|s| defs.statuses.iter().find(|o| o.label == *s));
    let priority = scalar(fm.get("priority"));
    let priority_rank = priority.as_ref().and_then(|p| defs.priorities.iter().position(|o| o.label == *p)).unwrap_or(defs.priorities.len());
    let due_raw = scalar(fm.get("due"));
    let due = due_raw.as_deref().and_then(|d| tegg_format::date::parse_date(d.trim()));
    let mut tags: Vec<String> = o.tags.iter().map(|t| nfc(t)).collect::<BTreeSet<_>>().into_iter().collect();
    tags.retain(|t| !t.is_empty());
    let fm_tags = match fm.get("tags") {
        Some(Value::Array(items)) => items.iter().filter_map(|v| scalar(Some(v))).collect(),
        Some(v) => scalar(Some(v)).into_iter().collect(),
        None => Vec::new(),
    };
    TaskRow {
        path: o.path.to_string(),
        id: o.id.map(str::to_string),
        title: o.title.to_string(),
        status_known: status.is_none() || opt.is_some(),
        state: opt.map(|o| o.state).unwrap_or(TaskState::Open),
        status,
        priority,
        priority_rank,
        due_raw,
        due,
        completed: scalar(fm.get("completed")),
        tags,
        fm_tags,
        source,
        excerpt: st.excerpt,
        created: scalar(fm.get("created")),
        modified: scalar(fm.get("modified")),
        version: st.version,
        read_only: !st.utf8,
        card: crate::cards::CardData::default(),
    }
}

/// A run's objects by path (built once per run; QA S2 of Q2-T, NFR-PERF-07).
pub(crate) type PathMap<'a> = std::collections::HashMap<&'a str, usize>;

/// A link target from the query evaluator's index read (v1-views §24.4): `to` is the index's resolution of `target`.
pub(crate) fn query_link(objs: &[tegg_index::QueryObject], by_path: &PathMap, target: String, to: Option<&str>) -> LinkTarget {
    let date = {
        let bare = target.split(['|', '#']).next().unwrap_or("").trim();
        bare.len() == 10 && chrono::NaiveDate::parse_from_str(bare, "%Y-%m-%d").is_ok()
    };
    match to.and_then(|p| by_path.get(p)).map(|&i| &objs[i]) {
        Some(x) => LinkTarget {
            target,
            kind: if date && x.daily.is_some() { crate::LinkKind::Daily } else { crate::LinkKind::Note },
            path: Some(x.path.to_string()),
            title: Some(x.title.to_string()),
            r#type: Some(x.r#type.to_string()),
        },
        None => LinkTarget { target, kind: if date { crate::LinkKind::DateMissing } else { crate::LinkKind::Unresolved }, path: None, title: None, r#type: None },
    }
}
