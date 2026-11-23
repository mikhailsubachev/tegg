//! Slice Q2-T L4 at `tegg-core` (docs/acceptance/views.md part three, R201…R208; docs/contracts/v1-views.md §24…§27,
//! §31): the period grouping of `query_run` (`group_by: { <key>: period }`, lanes `period:today|week|later`, `none`,
//! day groups, `done_lane`, `done_within`, date and date-time keys, regions, zones), the state operators, hidden lanes,
//! strict Date sorts, `QueryRow.tags` / `task_row`, `QueryResult.task_defs`, the query-file writes of `query_apply` with
//! the Q2-T keys against tests/fixtures/queries-files/expected/views-tasks/, the default task views
//! (`taskviews::default_task_view`, `Core::task_views_migrate`, `Core::task_views_restore`), the period-drag writes
//! through `write_note` with their base, the watcher, the kill harnesses (FR-QRY-07 AC-29, FR-SYN-02 AC-13) and the L3
//! corpus tests/fixtures/queries-files/expected-views-tasks.json. Inputs: the base tasks fixture
//! (tests/fixtures/vaults/tasks + new-empty/.tegg), the overlay views-tasks/, new-empty for a new vault, and the views
//! fixture for FR-QRY-05 AC-28. Test clock `2026-10-14T12:00:00+02:00`, Europe/Prague, `cs` (injected: `QueryEnv`,
//! `now`); `en-US` and Los Angeles where a criterion says so. Migrations run only where a test calls them (D-1913).
//! Compiles against the contract's Q2-T interface (a compile-only stubs commit precedes it, as D-1813); written from
//! the ACs, the fixtures and the contract only (D-61); every check is an assertion in this file.

mod common;
mod views_setup;
mod views_tasks_setup;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

use common::{fresh_dirs, repo_root, sandbox, snapshot, wait_until, Entry, Sandbox};
use serde_json::{json, Value};
use tegg_core::queries_q::{self, DoneLane, FilterItem, GroupKind, LaneKind, Lanes, Op, QueryDef, QueryResult, QuerySource};
use tegg_core::taskviews::{default_task_view, default_task_view_text, TaskViewsMigration, TaskViewsRestore, TASK_VIEW_NAMES};
use tegg_core::{Core, CoreError, CoreOptions, FileVersion, VaultError};
use tegg_schema::TypeOp;
use views_setup::{copy_dir, disk_s, nfd, open, reread, run, stamp, swapped, write};
use views_tasks_setup::*;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} answered {:?}", $what, e);
                unreachable!()
            }
        }
    };
}
macro_rules! some {
    ($e:expr, $what:expr) => {
        match $e {
            Some(v) => v,
            None => {
                assert!(false, "{}: got None", $what);
                unreachable!()
            }
        }
    };
}

const OLD_MOD: &str = "modified: 2026-10-01T09:00:00+02:00\n";

// ------------------------------------------------------------------------------------------------ helpers (asserting)

fn paths(r: &QueryResult) -> Vec<String> {
    r.rows.iter().map(|x| tegg_format::nfc(&x.path)).collect()
}
fn broken_keys(r: &QueryResult) -> Vec<String> {
    r.broken.iter().map(|b| b.key.clone()).collect()
}
fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
/// A result's lanes as the corpus writes them (`id`, `dropTarget`, `doneWithin`, `paths`, `days`).
fn lanes_json(r: &QueryResult, what: &str) -> Value {
    let g = some!(r.group.as_ref(), format!("{what}: QueryResult.group"));
    let p = |row: usize| tegg_format::nfc(&r.rows[row].path);
    Value::Array(
        g.lanes
            .iter()
            .map(|l| {
                json!({
                    "id": tegg_format::nfc(&l.id),
                    "dropTarget": l.drop_target,
                    "doneWithin": l.done_within,
                    "paths": l.cards.iter().map(|c| p(c.row)).collect::<Vec<_>>(),
                    "days": l.days.iter().map(|d| json!({ "date": d.date.format("%Y-%m-%d").to_string(), "paths": d.cards.iter().map(|c| p(c.row)).collect::<Vec<_>>() })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}
/// (lane id, card paths) of every lane.
fn lanes(r: &QueryResult, what: &str) -> Vec<(String, Vec<String>)> {
    let g = some!(r.group.as_ref(), format!("{what}: QueryResult.group"));
    g.lanes.iter().map(|l| (tegg_format::nfc(&l.id), l.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect())).collect()
}
fn lane_ids(r: &QueryResult, what: &str) -> Vec<String> {
    lanes(r, what).into_iter().map(|(i, _)| i).collect()
}
/// The card paths of one lane (asserts it exists).
fn lane(r: &QueryResult, id: &str, what: &str) -> Vec<String> {
    let l = lanes(r, what);
    match l.into_iter().find(|(i, _)| i == id) {
        Some((_, p)) => p,
        None => {
            assert!(false, "{what}: no lane {id} in {:?}", lane_ids(r, what));
            unreachable!()
        }
    }
}
/// The card paths of the `period:week` day group of `date`.
fn day(r: &QueryResult, date: &str, what: &str) -> Vec<String> {
    let g = some!(r.group.as_ref(), format!("{what}: QueryResult.group"));
    let w = some!(g.lanes.iter().find(|l| l.id == "period:week"), format!("{what}: the period:week lane"));
    let d = some!(w.days.iter().find(|d| d.date.format("%Y-%m-%d").to_string() == date), format!("{what}: day group {date}"));
    d.cards.iter().map(|c| tegg_format::nfc(&r.rows[c.row].path)).collect()
}
fn kind_of(k: &GroupKind) -> (&'static str, bool) {
    match k {
        GroupKind::Period { date_time } => ("period", *date_time),
        GroupKind::Select => ("select", false),
        GroupKind::MultiSelect => ("multiSelect", false),
        GroupKind::Tags => ("tags", false),
        GroupKind::Relation { .. } => ("relation", false),
    }
}
/// One corpus `groups` entry against a run: None when it matches, else what differs.
fn group_mismatch(core: &Core, g: &Value) -> Option<String> {
    let name = g["query"].as_str().unwrap_or("");
    let r = run(core, name, &env_of(&g["env"]));
    let want_broken: Vec<String> = sorted(g["broken"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default());
    let got_broken = sorted(broken_keys(&r).into_iter().filter(|k| ["group_by", "done_lane", "lane_order", "filters"].contains(&k.as_str())).collect());
    let note = g["note"].as_str().unwrap_or("");
    if want_broken != got_broken {
        return Some(format!("{note}: broken {got_broken:?}, want {want_broken:?}"));
    }
    if g["kind"].is_null() {
        if r.group.is_some() {
            return Some(format!("{note}: a group, want none"));
        }
        let want: Vec<String> = g["paths"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        if paths(&r) != want {
            return Some(format!("{note}: rows {:?}, want {want:?}", paths(&r)));
        }
        return None;
    }
    let Some(gr) = r.group.as_ref() else { return Some(format!("{note}: no group (broken {:?})", broken_keys(&r))) };
    let (k, dtm) = kind_of(&gr.kind);
    if k != g["kind"].as_str().unwrap_or("") || dtm != g["dateTime"].as_bool().unwrap_or(false) {
        return Some(format!("{note}: kind {k} dateTime {dtm}"));
    }
    if gr.key != g["key"].as_str().unwrap_or("") {
        return Some(format!("{note}: key {}", gr.key));
    }
    let got = lanes_json(&r, note);
    if got != g["lanes"] {
        return Some(format!("{note}:\n got  {got}\n want {}", g["lanes"]));
    }
    None
}
fn check_groups(core: &Core, groups: &[Value]) {
    let bad: Vec<String> = groups.iter().filter_map(|g| group_mismatch(core, g)).collect();
    assert_eq!(bad, Vec::<String>::new(), "the runs equal the L3 corpus (expected-views-tasks.json)");
}
/// Write every corpus `reads` text whose file isn't in the vault yet.
fn write_corpus_queries(root: &Path, c: &Value) {
    for r in c["reads"].as_array().expect("setup: reads") {
        let p = r["path"].as_str().expect("setup: path");
        if !root.join(p).exists() {
            write(root, p, r["text"].as_str().expect("setup: text").as_bytes());
        }
    }
}
fn current(core: &Core, name: &str) -> (QueryDef, FileVersion) {
    let r = core.query(name);
    let d = some!(r.def.clone(), format!("query({name}).def"));
    let v = some!(r.version.clone(), format!("query({name}).version"));
    (d, v)
}
fn commit(core: &Core, name: &str, edit: impl FnOnce(&mut QueryDef)) -> Result<(), CoreError> {
    let (mut d, v) = current(core, name);
    edit(&mut d);
    core.query_apply(name, &v, d, NOW).map(|_| ())
}
fn type_base(core: &Core) -> Option<FileVersion> {
    core.type_get("task").and_then(|t| t.version)
}
/// Files (not folders) that differ between two snapshots: changed, added or removed.
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let mut keys: Vec<&String> = a.keys().chain(b.keys()).filter(|k| !k.ends_with('/')).collect();
    keys.sort();
    keys.dedup();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| tegg_format::nfc(k)).collect()
}
fn mig(m: &TaskViewsMigration) -> String {
    match m {
        TaskViewsMigration::NotNeeded => "NotNeeded".into(),
        TaskViewsMigration::Skipped => "Skipped".into(),
        TaskViewsMigration::Done { created, views } => {
            format!("Done {{ created: {:?}, views: {views:?} }}", created.iter().map(|c| tegg_format::nfc(c)).collect::<Vec<_>>())
        }
        TaskViewsMigration::Stopped { created, reason } => format!("Stopped {{ created: {created:?}, reason: {reason} }}"),
    }
}
fn rest(r: &Result<TaskViewsRestore, CoreError>) -> String {
    match r {
        Ok(x) => format!(
            "Ok {{ created: {:?}, names: {:?}, before: {:?} }}",
            x.created.iter().map(|c| tegg_format::nfc(c)).collect::<Vec<_>>(),
            x.names,
            x.before.as_deref().map(str::trim_end)
        ),
        Err(e) => format!("Err({e:?})"),
    }
}
fn is_conflict<T>(r: &Result<T, CoreError>) -> bool {
    matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. })))
}
fn err_of<T>(r: &Result<T, CoreError>) -> String {
    match r {
        Ok(_) => "Ok".into(),
        Err(e) => format!("{e:?}"),
    }
}
/// One write through the core's one write function with the version last read as base (a drop's write path, §26).
fn drop_write(core: &Core, path: &str, text: &str) -> Result<(), CoreError> {
    let (_, v) = core.read_note(path, SystemTime::now())?;
    core.write_note(path, text.as_bytes(), Some(&v)).map(|_| ())
}
/// The trash operation of a view tab as the UI orders it (part two §15): `views:` without the name, then `query_trash`.
fn trash_view(core: &Core, names_after: &[&str], name: &str) {
    let v = type_base(core);
    ok!(core.type_patch("task", v.as_ref(), &[TypeOp::SetViews(strs(names_after))]), "type_patch (views without the trashed tab)");
    ok!(core.query_trash(name), format!("query_trash({name})"));
    let _ = core.wait_idle(Duration::from_secs(30));
}
/// T03 checked (tasks.md FR-TSK-02 AC-10's bytes at the clock).
fn t03_checked() -> String {
    swapped(&swapped(&base_fx("Tasks/Zalít květiny.md"), "status: To do\n", "status: Done\n"), OLD_MOD, &format!("modified: {NOW}\ncompleted: {NOW}\n"))
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-23

#[test]
fn fr_tsk_04_ac23_schedule_lanes() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let c = corpus();
    let mut groups = corpus_groups(&c, "R208 Schedule");
    groups.extend(corpus_groups(&c, "(TZ) Los Angeles"));
    groups.extend(corpus_groups(&c, "FR-TSK-04 AC-23"));
    check_groups(&core, &groups);
    let r = run(&core, "Schedule", &env());
    let g = some!(r.group.as_ref(), "Schedule: group");
    assert_eq!((g.key.as_str(), kind_of(&g.kind), g.name.as_str()), ("due", ("period", false), "Due date"), "grouped by the Date `due` by period, named by the attribute");
    let kinds: Vec<(String, LaneKind, String)> = g.lanes.iter().map(|l| (l.id.clone(), l.kind, l.label.clone())).collect();
    assert_eq!(
        kinds,
        vec![
            ("period:today".to_string(), LaneKind::Period, String::new()),
            ("period:week".to_string(), LaneKind::Period, String::new()),
            ("period:later".to_string(), LaneKind::Period, String::new()),
            ("none".to_string(), LaneKind::None, String::new()),
            ("done".to_string(), LaneKind::Done, String::new()),
        ],
        "period lanes, the no-value lane and the done lane; labels empty (the UI names them)"
    );
    let vals: Vec<Option<String>> = g.lanes.iter().map(|l| l.value.clone()).collect();
    assert_eq!(vals, vec![Some("today".into()), Some("week".into()), Some("later".into()), None, None], "values: the lane_order ids");
    assert!(g.lanes.iter().all(|l| !l.excluded), "period lanes are never hatched (R203)");
    assert_eq!(g.lanes.last().map(|l| l.color.clone()), Some(Some("green".to_string())), "the done lane has the Done option's colour (FR-UX-05 AC-25)");
    assert!(r.uses_relative, "a valid period grouping re-runs at midnight (uses_relative)");
    // T16 (2026-02-30) and T17 (a date-time) are no date: Not scheduled (R203); each Task row carries its TaskRow (CP-24).
    let none = lane(&r, "none", "Schedule");
    assert!(none.contains(&t(16)) && none.contains(&t(17)), "T16 and T17 in Not scheduled: {none:?}");
    let missing: Vec<String> = r.rows.iter().filter(|x| x.task_row.as_ref().map(|tr| tegg_format::nfc(&tr.path)) != Some(tegg_format::nfc(&x.path))).map(|x| x.path.clone()).collect();
    assert_eq!(missing, Vec::<String>::new(), "every Task row has `task_row` for its own path (D-1916)");
    let t16 = some!(r.rows.iter().find(|x| tegg_format::nfc(&x.path) == t(16)), "T16 row");
    let tr = some!(t16.task_row.as_ref(), "T16 task_row");
    assert_eq!((tr.due_raw.as_deref(), tr.due), (Some("2026-02-30"), None), "T16: due_raw kept, no valid due (Invalid due date)");
    let defs = some!(r.task_defs.as_ref(), "Schedule: task_defs");
    assert_eq!(defs.statuses.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(), vec!["To do", "In progress", "Waiting", "Done", "Cancelled"], "task_defs from Core::task_defs()");
    // QueryRow.tags: frontmatter and inline, NFC, case-folded (T05 `Doma`, T18 inline `#rodina`, T19 NFD `doma`).
    let tags = |n: usize| r.rows.iter().find(|x| tegg_format::nfc(&x.path) == t(n)).map(|x| x.tags.clone()).unwrap_or_default();
    assert_eq!((tags(5), tags(18), tags(19)), (strs(&["doma"]), strs(&["práce", "rodina"]), strs(&["doma"])), "row tags as the tag filter needs them");
    // A board of another type: no task rows, no task_defs.
    let p = run(&core, PROJEKTY, &env());
    assert!(p.rows.iter().all(|x| x.task_row.is_none()) && p.task_defs.is_none(), "Projekty: no task_row, no task_defs");
    assert_eq!(snapshot(&root), before, "running the boards writes nothing");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-24

#[test]
fn fr_tsk_04_ac24_the_done_lane() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    check_groups(&core, &corpus_groups(&corpus(), "FR-TSK-04 AC-24"));
    let r = run(&core, "Schedule", &env());
    let g = some!(r.group.as_ref(), "Schedule: group");
    let done = some!(g.lanes.iter().find(|l| l.id == "done"), "the done lane");
    assert_eq!((done.done_within, done.drop_target), (Some(7), true), "done_within 7, a drop target");
    assert!(!paths(&r).contains(&t(11)), "T11 (completed 9 days ago) is in no lane and not in rows");
    let (d, _) = current(&core, "Schedule");
    assert_eq!(d.done_lane, Some(DoneLane { within_days: 7, folded: true }), "Schedule.yml's done_lane read");
    // Checking T03 on its card: tasks.md FR-TSK-02 AC-10's bytes, one write; the card moves to Done (3).
    ok!(drop_write(&core, &t(3), &t03_checked()), "the checkbox write of T03");
    reread(&core, &[&t(3)]);
    let r = run(&core, "Schedule", &env());
    assert_eq!(lane(&r, "done", "after checking T03"), ts(&[10, 3, 12]), "Done 3: T10, T03 (due 14 Oct, priority High before Low), T12");
    ok!(drop_write(&core, &t(3), &base_fx("Tasks/Zalít květiny.md").replace(OLD_MOD, &format!("modified: {NOW}\n"))), "unchecking T03");
    reread(&core, &[&t(3)]);
    assert_eq!(lane(&run(&core, "Schedule", &env()), "period:today", "after unchecking"), ts(&[1, 2, 3, 14]), "back in Today & overdue");
    // A runtime `done_lane: { within_days: 30, folded: false }`: T11 back, unfolded.
    let s = fx(SCHEDULE);
    write(&root, SCHEDULE, swapped(&s, "done_lane: { within_days: 7, folded: true }\n", "done_lane: { within_days: 30, folded: false }\n").as_bytes());
    reread(&core, &[SCHEDULE]);
    let r = run(&core, "Schedule", &env());
    assert_eq!(lane(&r, "done", "within 30"), ts(&[11, 10, 12]), "Done 3 (T11 back), sorted by due");
    assert_eq!(some!(r.group.as_ref(), "group").lanes.last().and_then(|l| l.done_within), Some(30), "done_within 30");
    assert_eq!(current(&core, "Schedule").0.done_lane, Some(DoneLane { within_days: 30, folded: false }), "read as written");
    // Removing the key: Done-state tasks in their period lanes by due.
    write(&root, SCHEDULE, swapped(&s, "done_lane: { within_days: 7, folded: true }\n", "").as_bytes());
    reread(&core, &[SCHEDULE]);
    let r = run(&core, "Schedule", &env());
    assert_eq!(lane_ids(&r, "no done_lane"), strs(&["period:today", "period:week", "period:later", "none"]), "no done lane");
    assert_eq!(lane(&r, "period:today", "no done_lane"), ts(&[11, 1, 2, 10, 3, 14]), "T11 and T10 by due in Today & overdue");
    assert_eq!(lane(&r, "none", "no done_lane"), ts(&[8, 9, 17, 16, 18, 12]), "T12 (no due) in Not scheduled");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-25

#[test]
fn fr_tsk_04_ac25_period_drags_write_due_once() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let cases: [(&str, usize, &str, &str, &str); 7] = [
        ("(a) T08 onto pátek 16.", 8, "tasks/precist-knihu-due-16.md", "day:2026-10-16", ""),
        ("(b) T07 onto Today & overdue", 7, "tasks/obnovit-pas-due-14.md", "period:today", ""),
        ("(c) T03 onto Later", 3, "tasks/zalit-kvetiny-due-19.md", "period:later", ""),
        ("(d) T04 onto Not scheduled", 4, "tasks/koupit-darek-no-due.md", "none", ""),
        ("(e) T02 onto Done", 2, "tasks/poslat-rozpocet-done.md", "done", "due: 2026-10-13\n"),
        ("(f) T12 from Done onto Today & overdue", 12, "tasks/vratit-knihy-reopened.md", "period:today", ""),
        ("(g) T16 onto čtvrtek 15.", 16, "tasks/spatne-datum-due-15.md", "day:2026-10-15", ""),
    ];
    for (what, n, rel, target, kept) in cases {
        let p = t(n);
        let old_ino = stamp(&root, &p).map(|s| s.2);
        let before = snapshot(&root);
        let want = exp(rel);
        ok!(drop_write(&core, &p, &want), format!("{what}: the write"));
        let after = snapshot(&root);
        assert_eq!(changed(&before, &after), vec![p.clone()], "{what}: exactly one file is written (no query, type or other note)");
        assert_eq!(disk_s(&root, &p), Some(want.clone()), "{what}: bytes as expected/views-tasks/{rel}");
        assert_ne!(stamp(&root, &p).map(|s| s.2), old_ino, "{what}: a temporary file renamed in Tasks/ (new inode)");
        if !kept.is_empty() {
            assert!(want.contains(kept), "{what}: `due` kept");
        }
        reread(&core, &[&p]);
        let r = run(&core, "Schedule", &env());
        let holds = if let Some(d) = target.strip_prefix("day:") { day(&r, d, what) } else { lane(&r, target, what) };
        assert!(holds.contains(&p), "{what}: the card is in {target} after the re-run: {holds:?}");
    }
    // (TZ) Los Angeles: the same local date, never shifted; (W) en-US: Later starts on Sunday 18.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    ok!(drop_write(&core2, &t(7), &exp("tasks/obnovit-pas-due-14-la.md")), "(b) Los Angeles");
    reread(&core2, &[&t(7)]);
    assert!(lane(&run(&core2, "Schedule", &env_la()), "period:today", "LA").contains(&t(7)), "(b) LA: T07 in Today & overdue (due 2026-10-14)");
    ok!(drop_write(&core2, &t(3), &exp("tasks/zalit-kvetiny-due-18-en-us.md")), "(c) en-US");
    reread(&core2, &[&t(3)]);
    assert!(lane(&run(&core2, "Schedule", &env_us()), "period:later", "en-US").contains(&t(3)), "(c) en-US: due 2026-10-18 is Later");
    assert!(day(&run(&core2, "Schedule", &env()), "2026-10-18", "cs").contains(&t(3)), "the same file in cs: neděle 18.");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-26

#[test]
fn fr_tsk_04_ac26_schedule_and_kanban_are_queries() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let names: Vec<String> = core.queries().into_iter().map(|q| q.name).collect();
    assert!(names.iter().any(|n| n == "Schedule") && names.iter().any(|n| n == "Kanban"), "Schedule and Kanban are saved queries: {names:?}");
    let (d, _) = current(&core, "Schedule");
    assert_eq!((d.types.clone(), d.group_by.clone(), d.group_period, d.lanes, d.done_lane), (strs(&["task"]), Some("due".to_string()), true, Lanes::Rows, Some(DoneLane { within_days: 7, folded: true })), "Schedule's definition");
    let f: Vec<(String, Op, Value)> = d.filters.iter().filter_map(|x| if let FilterItem::Filter { key, op, value, .. } = x { Some((key.clone(), *op, value.clone())) } else { None }).collect();
    assert_eq!(f, vec![("status".to_string(), Op::StateIsNot, json!("cancelled"))], "the filter row `Status` `state is not` `Cancelled`");
    assert!(d.columns.is_empty(), "no `columns` on the default board");
    // Unchecking the done lane: only that line and modified (D-1898 (e)); then the Done tasks are in their lanes.
    let before = snapshot(&root);
    ok!(commit(&core, "Schedule", |d| d.done_lane = None), "done lane unchecked");
    assert_eq!(disk_s(&root, SCHEDULE), Some(exp("queries/schedule-no-done-lane.yml")), "Schedule.yml without its done_lane line");
    assert_eq!(changed(&before, &snapshot(&root)), vec![SCHEDULE.to_string()], "one file");
    let r = run(&core, "Schedule", &env());
    assert!(lane(&r, "period:today", "no done lane").contains(&t(10)) && lane(&r, "none", "no done lane").contains(&t(12)), "Done-state tasks by due");
    ok!(commit(&core, "Schedule", |d| d.done_lane = Some(DoneLane { within_days: 7, folded: true })), "done lane checked again");
    assert_eq!(disk_s(&root, SCHEDULE), Some(exp("queries/schedule-done-lane-again.yml")), "done_lane back at R201's place");
    // Duplicate on Kanban.
    ok!(core.query_duplicate("Kanban", NOW), "query_duplicate(Kanban)");
    let dup = some!(disk_s(&root, &qp("Kanban (2)")), "Kanban (2).yml");
    assert!(dup.contains("title: Kanban (2)\n") && dup.contains("group_by: status\n") && dup.contains("done_lane: { within_days: 7, folded: false }\n"), "the copy keeps the Q2-T keys:\n{dup}");
    // A reference fence `saved: Schedule` draws the same period board.
    let fence = core.query_run(QuerySource::Fence("saved: Schedule\n".into()), None, &env());
    assert_eq!(lanes_json(&fence, "fence"), lanes_json(&run(&core, "Schedule", &env()), "saved"), "the fence's lanes equal the tab's");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-27

#[test]
fn fr_tsk_04_ac27_live_and_midnight() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, true);
    let s = || run(&core, "Schedule", &env());
    write(&root, &t(7), swapped(&base_fx(&t(7)), "due: 2026-12-01\n", "due: 2026-10-15\n").as_bytes());
    assert!(wait_until(Duration::from_secs(2), || day(&s(), "2026-10-15", "live").contains(&t(7))).is_some(), "T07 moves to čtvrtek 15. within 2 s");
    write(&root, &t(3), swapped(&swapped(&base_fx(&t(3)), "status: To do\n", "status: Done\n"), OLD_MOD, &format!("{OLD_MOD}completed: 2026-10-14T10:00:00+02:00\n")).as_bytes());
    assert!(wait_until(Duration::from_secs(2), || lane(&s(), "done", "live").contains(&t(3))).is_some(), "T03 moves to Done");
    write(&root, "Tasks/Nový.md", b"---\ntype: task\ntitle: Nov\xc3\xbd\nstatus: To do\ndue: 2026-10-14\n---\n");
    assert!(wait_until(Duration::from_secs(2), || lane(&s(), "period:today", "live").contains(&"Tasks/Nový.md".to_string())).is_some(), "a new task appears in Today & overdue");
    write(&root, SCHEDULE, swapped(&fx(SCHEDULE), "lanes: horizontal\n", "lanes: vertical\n").as_bytes());
    assert!(wait_until(Duration::from_secs(2), || s().def.map(|d| d.lanes) == Some(Lanes::Columns)).is_some(), "lanes: vertical is read");
    // Midnight and zone changes are a new env: recomputed, nothing written.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    let before = snapshot(&root2);
    let r = run(&core2, "Schedule", &env_at((2026, 10, 15), "Europe/Prague", "cs"));
    assert_eq!(lane(&r, "period:today", "after midnight"), ts(&[1, 2, 3, 14, 4, 19]), "T03 overdue, T04 and T19 in Today & overdue");
    let wk = some!(r.group.as_ref().and_then(|g| g.lanes.iter().find(|l| l.id == "period:week")), "This week");
    assert_eq!(wk.days.iter().map(|d| d.date.format("%Y-%m-%d").to_string()).collect::<Vec<_>>(), strs(&["2026-10-16", "2026-10-17", "2026-10-18"]), "čtvrtek 15. leaves This week");
    let la = run(&core2, "Schedule", &env_at((2026, 10, 14), "America/Los_Angeles", "cs"));
    assert_eq!(lane(&la, "period:today", "LA"), ts(&[1, 2, 3, 14]), "the zone change: Los Angeles is still on 14 Oct");
    assert!(r.uses_relative, "uses_relative (the UI's day check re-runs)");
    assert_eq!(snapshot(&root2), before, "nothing is written");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-28 (rows)

// The tag filter itself is UI (L1 `tagOptions`, L5); the core's part is `QueryRow.tags` (checked in AC-23 above and here
// for every Schedule row against R208's options).
#[test]
fn fr_tsk_04_ac28_text_and_tag_filters() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, "Schedule", &env());
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for row in &r.rows {
        for tg in &row.tags {
            *counts.entry(tg.clone()).or_default() += 1;
        }
    }
    let want: BTreeMap<String, usize> = [("doma", 4), ("práce", 4), ("finance", 2), ("čtení", 1), ("rodina", 1)].iter().map(|(k, v)| (k.to_string(), *v)).collect();
    assert_eq!(counts, want, "R208's tag options from the rows (done lane included: T10 counts for finance)");
    let prace: Vec<String> = sorted(r.rows.iter().filter(|x| x.tags.iter().any(|k| k == "práce")).map(|x| tegg_format::nfc(&x.path)).collect());
    assert_eq!(prace, sorted(ts(&[1, 2, 6, 18])), "#práce leaves T01, T02, T06, T18");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-19

#[test]
fn fr_tsk_05_ac19_kanban_lanes() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    // Runtime: options Delegováno (done) and Odloženo (cancelled), with a task each.
    write(&root, TASK_YML, swapped(&fx(TASK_YML), "      - { label: Cancelled, state: cancelled, color: red }\n", "      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Delegováno, state: done, color: purple }\n      - { label: Odloženo, state: cancelled, color: gray }\n").as_bytes());
    write(&root, "Tasks/Předat klíče.md", "---\ntype: task\ntitle: Předat klíče\nstatus: Delegováno\ncompleted: 2026-10-13T08:00:00+02:00\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-13T08:00:00+02:00\n---\n".as_bytes());
    write(&root, "Tasks/Odložený výlet.md", b"---\ntype: task\ntitle: Odlo\xc5\xbeen\xc3\xbd v\xc3\xbdlet\nstatus: Odlo\xc5\xbeeno\ndue: 2026-10-14\n---\n");
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, "Kanban", &env());
    assert_eq!(
        lane_ids(&r, "Kanban"),
        strs(&["option:To do", "option:In progress", "option:Waiting", "option:Done", "option:Delegováno", "unknown:Rozpracováno", "none"]),
        "no Cancelled or Odloženo lane (hidden by state_is_not cancelled), Delegováno after Done, then the unknown value, No Status last"
    );
    let g = some!(r.group.as_ref(), "Kanban group");
    let by = |id: &str| g.lanes.iter().find(|l| l.id == id).map(|l| (l.done_within, l.drop_target, l.excluded, l.kind));
    assert_eq!(by("option:Done"), Some((Some(7), true, false, LaneKind::Option)), "Done: limited to 7 days");
    assert_eq!(by("option:Delegováno"), Some((Some(7), true, false, LaneKind::Option)), "Delegováno: a Done-state option, also limited");
    assert_eq!(by("unknown:Rozpracováno").map(|x| x.1), Some(false), "the unknown-value lane is no drop target");
    assert_eq!(by("none").map(|x| x.1), Some(false), "No Status is no drop target");
    assert!(!paths(&r).contains(&"Tasks/Odložený výlet.md".to_string()), "an Odloženo task is on no tab but All Tasks");
    assert!(!paths(&run(&core, "Schedule", &env())).contains(&"Tasks/Odložený výlet.md".to_string()), "nor on Schedule");
    // The corpus's Kanban (without the runtime options).
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    check_groups(&core2, &corpus_groups(&corpus(), "R208 Kanban"));
    // Reordering Waiting above In progress in Type settings reorders the lanes (no lane_order in Kanban.yml).
    let k_before = stamp(&root2, KANBAN);
    ok!(core2.type_patch("task", type_base(&core2).as_ref(), &[TypeOp::MoveOption { attr: "status".into(), label: "Waiting".into(), to: 1 }]), "MoveOption Waiting");
    let _ = core2.wait_idle(Duration::from_secs(30));
    assert_eq!(lane_ids(&run(&core2, "Kanban", &env()), "after MoveOption")[..4].to_vec(), strs(&["option:To do", "option:Waiting", "option:In progress", "option:Done"]), "the lanes follow the option order");
    assert_eq!(stamp(&root2, KANBAN), k_before, "Kanban.yml untouched");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-20

#[test]
fn fr_tsk_05_ac20_kanban_drags_and_lane_order() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    ok!(commit(&core, "Kanban", |d| d.lane_order = Some(strs(&["Waiting", "To do", "In progress", "Done", "Rozpracováno"]))), "the Waiting lane dragged before To do");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-lane-order-waiting.yml")), "lane_order inserted after `lanes: vertical`");
    assert_eq!(changed(&before, &snapshot(&root)), vec![KANBAN.to_string()], "Kanban.yml only: task.yml and every task file keep bytes, mtime and inode");
    assert_eq!(
        lane_ids(&run(&core, "Kanban", &env()), "lane_order"),
        strs(&["option:Waiting", "option:To do", "option:In progress", "option:Done", "unknown:Rozpracováno", "none"]),
        "the lanes in the new order, No Status last"
    );
    ok!(commit(&core, "Kanban", |d| d.lane_order = None), "Reset lane order");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-lane-order-reset.yml")), "the line removed");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-13

#[test]
fn fr_tsk_10_ac13_new_tasks_without_quick_add() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let p = "Tasks/Zavolat do servisu.md";
    let text = exp("tasks/zavolat-do-servisu-new.md").replacen("---\n", "---\nid: 01JB5A0000000000000000F001\n", 1);
    ok!(core.create_exact(p, text.as_bytes()), "the draft's first write");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(changed(&before, &snapshot(&root)), vec![p.to_string()], "one file created");
    assert_eq!(disk_s(&root, p).map(|s| without_id(&s)), Some(exp("tasks/zavolat-do-servisu-new.md")), "status To do, no due");
    assert_eq!(lane(&run(&core, "Schedule", &env()), "none", "after the create"), [ts(&[8, 9, 17, 16, 18]), vec![p.to_string()]].concat(), "the card shows in Not scheduled");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-27

#[test]
fn fr_qry_07_ac27_a_new_vault_gets_default_views() {
    let sb = sandbox();
    let root = new_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let m = core.task_views_migrate(NOW);
    assert_eq!(mig(&m), mig(&TaskViewsMigration::Done { created: vec![SCHEDULE.into(), KANBAN.into()], views: strs(&["Schedule", "Kanban"]) }), "the migration of a new vault");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[KANBAN, SCHEDULE, TASK_YML]), "nothing else differs from new-empty");
    assert_eq!(disk_s(&root, TASK_YML), Some(exp("types/task-migrated.yml")), "task.yml: new-empty's with line 11 `views: [Schedule, Kanban]`");
    assert_eq!(disk_s(&root, SCHEDULE), Some(exp("queries/schedule-default.yml")), "Schedule.yml: R202's bytes");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-default.yml")), "Kanban.yml: R202's bytes");
    assert_eq!(TASK_VIEW_NAMES, ["Schedule", "Kanban"], "the default names");
    for n in TASK_VIEW_NAMES {
        let d = some!(default_task_view(n), format!("default_task_view({n})"));
        // D-1936: no `created` / `modified`, the same bytes on every Mac.
        assert_eq!(queries_q::create_text_unstamped(&d), exp(&format!("queries/{}-default.yml", n.to_lowercase())), "create_text_unstamped(default_task_view({n})) gives R202's bytes");
        assert_eq!(default_task_view_text(n), Some(exp(&format!("queries/{}-default.yml", n.to_lowercase()))), "default_task_view_text({n})");
    }
    assert!(default_task_view("Čeká na ostatní").is_none(), "no default for other names");
    drop(core);
    let after = snapshot(&root);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(mig(&core.task_views_migrate(NOW)), "NotNeeded", "reopening: nothing to do");
    assert_eq!(snapshot(&root), after, "reopening writes nothing");
    assert!(run(&core, "Schedule", &env()).group.is_some(), "the new vault's Schedule is a period board");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-28

/// The base fixture with `edit` applied to its files before the core opens; returns (sandbox, root, core).
fn migrate_case(edit: impl FnOnce(&Path)) -> (Sandbox, PathBuf, Core) {
    let sb = sandbox();
    let root = base_vault(&sb);
    edit(&root);
    let core = open(&root, &sb.dirs, false);
    (sb, root, core)
}

#[test]
fn fr_qry_07_ac28_an_existing_vault_is_migrated_once() {
    let (sb, root, core) = migrate_case(|_| {});
    let before = snapshot(&root);
    let m = core.task_views_migrate(NOW);
    assert_eq!(mig(&m), mig(&TaskViewsMigration::Done { created: vec![SCHEDULE.into(), KANBAN.into()], views: strs(&["Schedule", "Kanban"]) }), "the base is migrated");
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), strs(&[KANBAN, SCHEDULE, TASK_YML]), "every other vault file keeps bytes, mtime and inode");
    assert_eq!(disk_s(&root, TASK_YML), Some(exp("types/task-migrated.yml")), "task.yml: only line 11 inserted");
    assert_eq!((disk_s(&root, SCHEDULE), disk_s(&root, KANBAN)), (Some(exp("queries/schedule-default.yml")), Some(exp("queries/kanban-default.yml"))), "R202's bytes");
    check_groups(&core, &corpus_groups(&corpus(), "R208 Schedule, cs, Prague"));
    assert_eq!(mig(&core.task_views_migrate(NOW)), "NotNeeded", "a second run in the session");
    drop(core);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(mig(&core.task_views_migrate(NOW)), "NotNeeded", "closing and reopening");
    drop(core);
    let core = open(&root, &fresh_dirs(&sb, "Druhý Mac"), false);
    assert_eq!(mig(&core.task_views_migrate(NOW)), "NotNeeded", "the migrated copy on a second Mac");
    assert_eq!(snapshot(&root), after, "they write nothing");

    // (a) no task.yml (not synced yet, D-1936): nothing written, no alert (Skipped).
    let (_sa, ra, ca) = migrate_case(|r| std::fs::remove_file(r.join(TASK_YML)).expect("setup: remove task.yml"));
    let ba = snapshot(&ra);
    assert_eq!(mig(&ca.task_views_migrate(NOW)), "Skipped", "(a) without task.yml");
    assert_eq!(snapshot(&ra), ba, "(a) nothing written (no task.yml, no query file)");

    // (a′) online-only placeholders (an iCloud stub, FR-VLT-03): nothing written; the open without them migrates (D-1936).
    let (sp, rp, cp) = migrate_case(|r| write(r, "Tasks/.Nový úkol.md.icloud", b"bplist00 stub"));
    assert!(!cp.placeholders().is_empty(), "setup check: the stub is a placeholder");
    let bp = snapshot(&rp);
    assert_eq!(mig(&cp.task_views_migrate(NOW)), "Skipped", "(a′) with an online-only file");
    assert_eq!(snapshot(&rp), bp, "(a′) nothing written");
    drop(cp);
    std::fs::remove_file(rp.join("Tasks/.Nový úkol.md.icloud")).expect("setup: the file arrived");
    let cp = open(&rp, &sp.dirs, false);
    assert!(mig(&cp.task_views_migrate(NOW)).starts_with("Done"), "(a′) the next open migrates");

    // (b) a user Schedule.yml (a Table of Pages): neither read for content nor written.
    let user = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Schedule.\nversion: 1\ntitle: Schedule\ntypes: [page]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: table\ncolumns: [modified]\ncreated: 2026-09-01T08:00:00+02:00\nmodified: 2026-09-01T08:00:00+02:00\n";
    for file in ["Schedule", "schedule"] {
        let (_sb, rb, cb) = migrate_case(|r| write(r, &qp(file), user.as_bytes()));
        let st = stamp(&rb, &qp(file));
        let m = cb.task_views_migrate(NOW);
        assert_eq!(mig(&m), mig(&TaskViewsMigration::Done { created: vec![KANBAN.into()], views: strs(&["Schedule", "Kanban"]) }), "(b) {file}.yml: only Kanban created");
        assert_eq!(stamp(&rb, &qp(file)), st, "(b) {file}.yml: bytes, mtime and inode kept");
        assert_eq!(list_files(&rb, ".tegg/queries").len(), 2, "(b) {file}.yml: no second Schedule file: {:?}", list_files(&rb, ".tegg/queries"));
        assert_eq!(disk_s(&rb, TASK_YML), Some(exp("types/task-migrated.yml")), "(b) views written");
        let tab = paths(&cb.query_run(QuerySource::View { type_key: "task".into(), name: "Schedule".into() }, None, &env()));
        // `Tasks/Bez hlavičky.md` has no frontmatter: a Page (D-103, D-1929).
        assert!(!tab.is_empty() && tab.iter().all(|p| p.starts_with("Pages/") || p == "Tasks/Bez hlavičky.md"), "(b) the Schedule tab shows the user's query: {tab:?}");
    }

    // (c) `views: []` or a hand-written list: nothing written.
    for v in ["views: []\n", "views: [Moje]\n"] {
        let (_sc, rc, cc) = migrate_case(|r| write(r, TASK_YML, swapped(&base_fx(".tegg/types/task.yml"), "preview: [status, priority, due]\n", &format!("preview: [status, priority, due]\n{v}")).as_bytes()));
        let b = snapshot(&rc);
        assert_eq!(mig(&cc.task_views_migrate(NOW)), "NotNeeded", "(c) {v:?}");
        assert_eq!(snapshot(&rc), b, "(c) {v:?}: nothing written");
    }

    // (d) a newer task.yml or an unreadable `views`: nothing written, no alert (Skipped).
    for (from, to) in [("version: 1\n", "version: 2\n"), ("preview: [status, priority, due]\n", "preview: [status, priority, due]\nviews: Schedule\n")] {
        let (_sd, rd, cd) = migrate_case(|r| write(r, TASK_YML, swapped(&base_fx(".tegg/types/task.yml"), from, to).as_bytes()));
        let b = snapshot(&rd);
        assert_eq!(mig(&cd.task_views_migrate(NOW)), "Skipped", "(d) {to:?}");
        assert_eq!(snapshot(&rd), b, "(d) {to:?}: nothing written");
    }

    // (e) a read-only `.tegg/queries/`: nothing written; the next open with the folder writable migrates.
    let (se, re, ce) = migrate_case(|r| std::fs::create_dir_all(r.join(".tegg/queries")).expect("setup: queries dir"));
    set_writable(&re.join(".tegg/queries"), false);
    let b = snapshot(&re);
    let m = ce.task_views_migrate(NOW);
    let after_ro = snapshot(&re);
    set_writable(&re.join(".tegg/queries"), true);
    assert!(mig(&m).starts_with("Stopped { created: []"), "(e) stopped before any write: {}", mig(&m));
    assert_eq!(changed(&b, &after_ro), Vec::<String>::new(), "(e) nothing written (task.yml included)");
    drop(ce);
    let ce = open(&re, &se.dirs, false);
    assert!(mig(&ce.task_views_migrate(NOW)).starts_with("Done"), "(e) the next open migrates");
    assert_eq!(disk_s(&re, TASK_YML), Some(exp("types/task-migrated.yml")), "(e) then the line is written");
}

// ------------------------------------------------------------------------------------------------ kill harnesses

const KILL_CYCLES: usize = 200;

fn child_core(root: &Path, app: &Path, ready: &Path) -> Core {
    let dirs = tegg_core::AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    let _ = core.wait_idle(Duration::from_secs(30));
    std::fs::write(ready, b"ready").ok();
    core
}
fn child_fail(ready: &Path, e: String) -> ! {
    std::fs::write(ready.with_extension("failed"), e).ok();
    std::process::exit(3)
}
/// The child side of every Q2-T kill harness (contract §31.1: TEGG_TASKS_KILL_CHILD / _READY / _KIND).
fn kill_child() {
    let Ok(dir) = std::env::var("TEGG_TASKS_KILL_CHILD") else { return };
    let dir = PathBuf::from(dir);
    let ready = PathBuf::from(std::env::var("TEGG_TASKS_KILL_READY").expect("setup: ready path"));
    let kind = std::env::var("TEGG_TASKS_KILL_KIND").expect("setup: kind");
    let core = child_core(&dir.join("vault"), &dir.join("app"), &ready);
    match kind.as_str() {
        "migrate" => {
            let _ = core.task_views_migrate(NOW);
        }
        "period" => {
            let a = base_fx("Tasks/Zalít květiny.md");
            let b = exp("tasks/zalit-kvetiny-no-due.md");
            let start = Instant::now();
            let mut i = 0usize;
            while start.elapsed() < Duration::from_secs(20) {
                i += 1;
                let text = if i % 2 == 1 { &b } else { &a };
                if let Err(e) = drop_write(&core, &t(3), text) {
                    child_fail(&ready, format!("{e:?}"))
                }
            }
        }
        _ => {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(20) {
                let r = core.task_views_restore(type_base(&core).as_ref(), NOW);
                let x = match r {
                    Ok(x) => x,
                    Err(e) => child_fail(&ready, format!("restore: {e:?}")),
                };
                if let Err(e) = core.type_patch("task", x.info.version.as_ref(), &[TypeOp::SetViewsSource(x.before.clone().unwrap_or_default())]) {
                    child_fail(&ready, format!("undo views: {e:?}"))
                }
                if let Err(e) = core.query_trash("Kanban") {
                    child_fail(&ready, format!("undo trash: {e:?}"))
                }
            }
        }
    }
    std::process::exit(0)
}
/// One killed child: spawn the test binary on `test`, wait for ready, kill after a random 0.2…3.2 ms (`period`), or
/// 0.2…25.2 ms for `migrate` and `restore`, whose last write follows two or three durable writes (D-1889, D-1929).
fn kill_once(test: &str, work: &Path, kind: &str, cycle: usize, seed: &mut u64) -> Option<String> {
    let exe = std::env::current_exe().expect("setup: test binary");
    let ready = work.join(format!("ready-{kind}-{cycle}"));
    let mut child = Command::new(&exe)
        .args(["--exact", test, "--nocapture", "--test-threads=1"])
        .env("TEGG_TASKS_KILL_CHILD", work)
        .env("TEGG_TASKS_KILL_READY", &ready)
        .env("TEGG_TASKS_KILL_KIND", kind)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("setup: spawn the writer");
    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready.exists() && Instant::now() < deadline && child.try_wait().ok().flatten().is_none() {
        std::thread::sleep(Duration::from_micros(300));
    }
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    let window = if kind == "period" { 3000 } else { 25_000 };
    std::thread::sleep(Duration::from_micros(200 + *seed % window));
    let _ = child.kill();
    let _ = child.wait();
    let failed = ready.with_extension("failed");
    failed.exists().then(|| std::fs::read_to_string(&failed).unwrap_or_default())
}
fn temp_files(root: &Path, dirs: &[&str]) -> Vec<String> {
    dirs.iter().flat_map(|d| list_files(root, d)).filter(|n| n.contains("tegg-tmp")).collect()
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-29

const KILL_MIGRATE: &str = "fr_qry_07_ac29_migration_survives_crashes";

#[test]
fn fr_qry_07_ac29_migration_survives_crashes() {
    kill_child();
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/tasks"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let orig = base_fx(".tegg/types/task.yml");
    let (migrated, sch, kan) = (exp("types/task-migrated.yml"), exp("queries/schedule-default.yml"), exp("queries/kanban-default.yml"));
    let check_dirs = fresh_dirs(&sb, "Kontrola");
    let mut seed: u64 = 0x5132_5441_534b_29;
    let mut bad: Vec<String> = Vec::new();
    let mut wrote = 0usize;
    for cycle in 0..KILL_CYCLES {
        std::fs::write(root.join(TASK_YML), &orig).expect("setup: reset task.yml");
        for f in list_files(&root, ".tegg/queries") {
            let _ = std::fs::remove_file(root.join(&f));
        }
        if let Some(e) = kill_once(KILL_MIGRATE, &work, "migrate", cycle, &mut seed) {
            bad.push(format!("cycle {cycle}: the child failed: {e}"));
        }
        let tk = disk_s(&root, TASK_YML).unwrap_or_default();
        if tk != orig && tk != migrated {
            bad.push(format!("cycle {cycle}: task.yml torn ({} bytes)", tk.len()));
        }
        if tk != orig {
            wrote += 1;
        }
        for (p, want) in [(SCHEDULE, &sch), (KANBAN, &kan)] {
            if let Some(s) = disk_s(&root, p) {
                if &s != want {
                    bad.push(format!("cycle {cycle}: {p} torn ({} bytes)", s.len()));
                }
            }
        }
        let names: Vec<String> = list_files(&root, ".tegg/queries").into_iter().filter(|n| !n.contains("tegg-tmp")).collect();
        if names.iter().any(|n| n.contains("(2)")) {
            bad.push(format!("cycle {cycle}: a numbered copy {names:?}"));
        }
        for l in temp_files(&root, &[".tegg/queries", ".tegg/types"]) {
            let _ = std::fs::remove_file(root.join(l));
        }
        // The reopen that completes it gives AC-28's result.
        let core = open(&root, &check_dirs, false);
        let _ = core.task_views_migrate(NOW);
        drop(core);
        if (disk_s(&root, TASK_YML), disk_s(&root, SCHEDULE), disk_s(&root, KANBAN)) != (Some(migrated.clone()), Some(sch.clone()), Some(kan.clone())) {
            bad.push(format!("cycle {cycle}: the reopen didn't complete the migration ({:?})", list_files(&root, ".tegg/queries")));
        }
        if bad.len() > 10 {
            break;
        }
    }
    if wrote == 0 {
        bad.push("the migration never reached its views write before a kill".into());
    }
    // task.yml changed on disk between the creates and the views write: the external bytes are never lost.
    let theirs = swapped(&orig, "color: blue\n", "color: green\n");
    let theirs_migrated = swapped(&migrated, "color: blue\n", "color: green\n");
    for trial in 0..40u64 {
        std::fs::write(root.join(TASK_YML), &orig).expect("setup: reset task.yml");
        for f in list_files(&root, ".tegg/queries") {
            let _ = std::fs::remove_file(root.join(&f));
        }
        let core = open(&root, &check_dirs, false);
        let p = root.join(TASK_YML);
        let th = theirs.clone();
        let delay = (trial * 97) % 3000;
        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_micros(delay));
            std::fs::write(p, th).expect("setup: the other program's write");
        });
        let _ = core.task_views_migrate(NOW);
        writer.join().expect("setup: writer thread");
        if disk_s(&root, TASK_YML) == Some(migrated.clone()) {
            bad.push(format!("trial {trial}: the views write overwrote the external change"));
        }
        reread(&core, &[TASK_YML]);
        let _ = core.task_views_migrate(NOW);
        if disk_s(&root, TASK_YML) != Some(theirs_migrated.clone()) {
            bad.push(format!("trial {trial}: the next run doesn't write the line on top of the external bytes: {:?}", disk_s(&root, TASK_YML)));
        }
        if bad.len() > 10 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "every file is absent or complete; task.yml is the original or the original plus line 11; reopening completes it");
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-11

#[test]
fn fr_typ_01_ac11_restore_default_views() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    let r = core.task_views_restore(type_base(&core).as_ref(), NOW);
    assert!(matches!(r, Err(CoreError::Query(queries_q::QueryError::NothingToDo))), "both listed and live: NothingToDo, got {}", rest(&r));
    assert_eq!(snapshot(&root), before, "nothing written");
    // After Move to trash on Kanban: the file is created exclusively, then line 11 written; the trashed copy stays.
    trash_view(&core, &["Schedule", CEKA], "Kanban");
    assert_eq!(disk_s(&root, TASK_YML), Some(exp("types/task-overlay-without-kanban.yml")), "setup check: views without Kanban");
    let trashed = list_files(&root, ".trash/.tegg/queries");
    let r = core.task_views_restore(type_base(&core).as_ref(), NOW);
    assert_eq!(rest(&r), format!("Ok {{ created: {:?}, names: Some({:?}), before: Some({:?}) }}", vec![KANBAN], strs(&["Schedule", "Kanban", CEKA]), "views: [Schedule, Čeká na ostatní]"), "the restore's report");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-default.yml")), "Kanban.yml: R202's bytes");
    assert_eq!(disk_s(&root, TASK_YML), Some(fx(TASK_YML)), "line 11 `views: [Schedule, Kanban, Čeká na ostatní]` (the overlay's task.yml)");
    assert_eq!(list_files(&root, ".trash/.tegg/queries"), trashed, "the trashed copy stays in .trash/.tegg/queries/");
    // Undo: views back to its exact old bytes, then the created file to the trash.
    let x = ok!(r, "restore");
    ok!(core.type_patch("task", x.info.version.as_ref(), &[TypeOp::SetViewsSource(x.before.clone().unwrap_or_default())]), "Undo: viewsSource");
    let tr = ok!(core.query_trash("Kanban"), "Undo: query_trash");
    assert_eq!(disk_s(&root, TASK_YML), Some(exp("types/task-overlay-without-kanban.yml")), "Undo: line 11's old bytes");
    assert!(!root.join(KANBAN).exists() && tr.contains("Kanban (2)"), "Undo: the new file in the trash as `Kanban (2).yml`: {tr}");
    // Remove from Tasks page on Schedule (the file kept): the restore writes only views.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    ok!(core2.type_patch("task", type_base(&core2).as_ref(), &[TypeOp::SetViews(strs(&["Kanban", CEKA]))]), "Remove from Tasks page");
    assert_eq!(disk_s(&root2, TASK_YML), Some(exp("types/task-overlay-without-schedule.yml")), "setup check");
    let b2 = snapshot(&root2);
    let r = core2.task_views_restore(type_base(&core2).as_ref(), NOW);
    assert_eq!(rest(&r), format!("Ok {{ created: [], names: Some({:?}), before: Some({:?}) }}", strs(&["Schedule", "Kanban", CEKA]), "views: [Kanban, Čeká na ostatní]"), "only views");
    assert_eq!(changed(&b2, &snapshot(&root2)), vec![TASK_YML.to_string()], "only task.yml written");
    assert_eq!(disk_s(&root2, TASK_YML), Some(fx(TASK_YML)), "Schedule inserted first");
    // A changed Kanban.yml (a lane_order line) is never replaced.
    let sb3 = sandbox();
    let root3 = overlay_vault(&sb3);
    write(&root3, KANBAN, swapped(&fx(KANBAN), "lanes: vertical\n", "lanes: vertical\nlane_order: [Waiting]\n").as_bytes());
    write(&root3, TASK_YML, exp("types/task-overlay-without-kanban.yml").as_bytes());
    let core3 = open(&root3, &sb3.dirs, false);
    let k3 = stamp(&root3, KANBAN);
    let r = core3.task_views_restore(type_base(&core3).as_ref(), NOW);
    assert_eq!(rest(&r), format!("Ok {{ created: [], names: Some({:?}), before: Some({:?}) }}", strs(&["Schedule", "Kanban", CEKA]), "views: [Schedule, Čeká na ostatní]"), "the live Kanban is used");
    assert_eq!(stamp(&root3, KANBAN), k3, "the changed Kanban.yml keeps bytes, mtime and inode");
    // No `views` key before (a base vault): Undo removes the key (SetViewsSource("")).
    let sb4 = sandbox();
    let root4 = base_vault(&sb4);
    let core4 = open(&root4, &sb4.dirs, false);
    let r = core4.task_views_restore(type_base(&core4).as_ref(), NOW);
    assert_eq!(rest(&r), format!("Ok {{ created: {:?}, names: Some({:?}), before: None }}", vec![SCHEDULE, KANBAN], strs(&["Schedule", "Kanban"])), "both created, then views");
    assert_eq!(disk_s(&root4, TASK_YML), Some(exp("types/task-migrated.yml")), "the migration's bytes");
    let x = ok!(r, "restore on the base");
    ok!(core4.type_patch("task", x.info.version.as_ref(), &[TypeOp::SetViewsSource(String::new())]), "Undo with an empty source");
    assert_eq!(disk_s(&root4, TASK_YML), Some(base_fx(".tegg/types/task.yml")), "the views key removed: new-empty's bytes");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-17

#[test]
fn fr_qry_01_ac17_period_grouping_for_any_date() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let c = corpus();
    let core = open(&root, &sb.dirs, false);
    check_groups(&core, &corpus_groups(&c, "R208 Projekty"));
    let r = run(&core, PROJEKTY, &env());
    assert_eq!(some!(r.group.as_ref(), "group").name, "Due date", "Grouping.name = the attribute's Name");
    // Zahrada onto Later; Web onto No Due date: one write each.
    let before = snapshot(&root);
    ok!(drop_write(&core, "Projekty/Zahrada.md", &exp("projekty/zahrada-later.md")), "Zahrada onto Later");
    ok!(drop_write(&core, "Projekty/Web.md", &exp("projekty/web-no-due.md")), "Web onto No Due date");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&["Projekty/Web.md", "Projekty/Zahrada.md"]), "two files, once each");
    reread(&core, &["Projekty/Zahrada.md", "Projekty/Web.md"]);
    let r = run(&core, PROJEKTY, &env());
    assert_eq!((lane(&r, "period:later", "after"), lane(&r, "none", "after")), (strs(&["Projekty/Kuchařka.md", "Projekty/Zahrada.md"]), strs(&["Projekty/Web.md"])), "Zahrada in Later, Web in No Due date");
    // The editor: `Created · by period`, Done: only group_by (comment kept) and modified.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    ok!(commit(&core2, PROJEKTY, |d| {
        d.group_by = Some("created".into());
        d.group_period = true;
    }), "Group by Created · by period");
    assert_eq!(disk_s(&root2, &qp(PROJEKTY)), Some(exp("queries/projekty-group-created.yml")), "`group_by: {{ created: period }}   # podle termínu`");
    let r = run(&core2, PROJEKTY, &env());
    let g = some!(r.group.as_ref(), "created group");
    assert_eq!((kind_of(&g.kind), g.name.as_str()), (("period", true), "Created"), "a date-time key");
    let want = corpus_groups(&c, "FR-QRY-01 AC-17")[0]["lanes"].clone();
    assert_eq!(lanes_json(&r, "created"), want, "every project in Today & earlier (created 1 Oct); no lane is a drop target (D-1917)");
    write(&root2, &qp("Podle změny"), swapped(&exp("queries/projekty-group-created.yml"), "group_by: { created: period }", "group_by: { modified: period }").replace("Projekty podle termínu", "Podle změny").as_bytes());
    reread(&core2, &[&qp("Podle změny")]);
    let m = run(&core2, "Podle změny", &env());
    assert_eq!(m.group.as_ref().map(|g| (kind_of(&g.kind), g.name.clone())), Some((("period", true), "Modified".to_string())), "`modified` by period");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-18

#[test]
fn fr_qry_01_ac18_period_and_done_lane_read_rules() {
    let c = corpus();
    // L3: the reads of the corpus through the core's reader.
    let mut bad = Vec::new();
    for r in c["reads"].as_array().expect("reads") {
        let name = r["name"].as_str().unwrap_or("");
        let f = queries_q::read(r["text"].as_str().unwrap_or("").as_bytes());
        let d = &r["def"];
        let def = &f.def;
        let mut diff = Vec::new();
        let cmp = |k: &str, got: Value, diff: &mut Vec<String>| {
            if let Some(w) = d.get(k) {
                if &got != w {
                    diff.push(format!("{k}: {got} ≠ {w}"));
                }
            }
        };
        cmp("title", json!(def.title), &mut diff);
        cmp("types", json!(def.types), &mut diff);
        cmp("limit", json!(def.limit), &mut diff);
        cmp("groupBy", json!(def.group_by), &mut diff);
        cmp("groupPeriod", json!(def.group_period), &mut diff);
        cmp("laneOrder", json!(def.lane_order), &mut diff);
        cmp("columns", json!(def.columns), &mut diff);
        // Slice Q3 (D-2179, D-2203): the DTO words are `columns` / `rows`.
        cmp("lanes", json!(if def.lanes == Lanes::Rows { "rows" } else { "columns" }), &mut diff);
        cmp("doneLane", def.done_lane.map(|x| json!({ "withinDays": x.within_days, "folded": x.folded })).unwrap_or(Value::Null), &mut diff);
        cmp("sort", json!(def.sort.iter().map(|s| json!({ "by": s.by, "order": if s.order == queries_q::Order::Asc { "asc" } else { "desc" } })).collect::<Vec<_>>()), &mut diff);
        let filters: Vec<Value> = def
            .filters
            .iter()
            .map(|x| match x {
                FilterItem::Filter { key, op, value, src } => json!({ "kind": "filter", "key": key, "op": op.as_str(), "value": value, "src": src }),
                other => json!(format!("{other:?}")),
            })
            .collect();
        cmp("filters", Value::Array(filters), &mut diff);
        let want_broken: Vec<String> = r["broken"].as_array().map(|a| a.iter().filter_map(|b| b["key"].as_str().map(String::from)).collect()).unwrap_or_default();
        let got_broken: Vec<String> = f.broken.iter().map(|b| b.key.clone()).collect();
        if sorted(want_broken.clone()) != sorted(got_broken.clone()) {
            diff.push(format!("broken {got_broken:?} ≠ {want_broken:?}"));
        }
        if !diff.is_empty() {
            bad.push(format!("{name}: {}", diff.join("; ")));
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "queries_q::read of every corpus file (L3)");
    // L4: the runs of the runtime variants, each drawn without rewriting the file.
    let sb = sandbox();
    let root = overlay_vault(&sb);
    write_corpus_queries(&root, &c);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    check_groups(&core, &corpus_groups(&c, "FR-QRY-01 AC-18"));
    // Slice Q3 (D-2179): a broken group_by on a wall draws the ungrouped wall (cards), not a List.
    for q in ["Rozvrh po měsících", "Rozvrh dvě období"] {
        let r = core.query_run(QuerySource::Saved(q.into()), None, &env());
        assert!(r.group.is_none() && !r.rows.is_empty() && r.rows.iter().all(|x| x.card.is_some()), "{q}: an ungrouped wall with the notice");
    }
    assert_eq!(current(&core, "Rozvrh bez folded").0.done_lane, Some(DoneLane { within_days: 7, folded: false }), "`folded` missing = false");
    assert_eq!(snapshot(&root), before, "no variant is rewritten");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-02 AC-9

#[test]
fn fr_qry_02_ac9_state_operators() {
    assert_eq!((Op::parse("state_is"), Op::parse("state_is_not")), (Some(Op::StateIs), Some(Op::StateIsNot)), "the YAML names");
    assert_eq!((Op::StateIs.as_str(), Op::StateIsNot.as_str()), ("state_is", "state_is_not"), "and back");
    let c = corpus();
    let filters = c["filters"].as_array().expect("filters").clone();
    let sb = sandbox();
    let root = base_vault(&sb);
    for f in &filters {
        write(&root, &qp(f["name"].as_str().unwrap_or("")), f["text"].as_str().unwrap_or("").as_bytes());
    }
    let core = open(&root, &sb.dirs, false);
    let check = |core: &Core, what: &str| {
        let mut bad = Vec::new();
        for f in &filters {
            let name = f["name"].as_str().unwrap_or("");
            let r = run(core, name, &env());
            let want_broken: Vec<(String, String)> = f["broken"].as_array().map(|a| a.iter().map(|b| (b["key"].as_str().unwrap_or("").to_string(), b["reason"].as_str().unwrap_or("").to_string())).collect()).unwrap_or_default();
            let got_broken: Vec<(String, String)> = r
                .broken
                .iter()
                .map(|b| {
                    let reason = match b.reason {
                        queries_q::BrokenReason::OperatorKind => "operatorKind",
                        queries_q::BrokenReason::Value => "value",
                        _ => "other",
                    };
                    (b.key.clone(), reason.to_string())
                })
                .collect();
            if want_broken != got_broken {
                bad.push(format!("{what} {name}: broken {got_broken:?}, want {want_broken:?}"));
            }
            if let Some(want) = f["paths"].as_array() {
                let want: Vec<String> = want.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                if sorted(paths(&r)) != want {
                    bad.push(format!("{what} {name}: {:?}, want {want:?}", sorted(paths(&r))));
                }
            }
        }
        bad
    };
    assert_eq!(check(&core, "fixture"), Vec::<String>::new(), "FR-QRY-02 AC-9's results (corpus `filters`)");
    // Renaming the Cancelled option leaves the results unchanged (states, not labels). T13 Zrušená cesta uses it, so its
    // value is renamed too, as the option rename does (D-1929).
    write(&root, TASK_YML, swapped(&base_fx(".tegg/types/task.yml"), "label: Cancelled,", "label: Zrušeno,").as_bytes());
    write(&root, &t(13), swapped(&base_fx(&t(13)), "status: Cancelled\n", "status: Zrušeno\n").as_bytes());
    reread(&core, &[TASK_YML, &t(13)]);
    assert_eq!(check(&core, "Zrušeno"), Vec::<String>::new(), "a renamed Cancelled option changes no result");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-28

#[test]
fn fr_qry_05_ac28_cards_follow_preview_properties() {
    let sb = sandbox();
    let root = views_setup::vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let roz = qp("Rozečtené");
    let st = stamp(&root, &roz);
    let r = run(&core, "Rozečtené", &views_setup::env());
    assert!(r.group.is_some(), "Rozečtené is drawn as a board");
    assert_eq!(stamp(&root, &roz), st, "`columns: [author, rating]` kept byte for byte; nothing rewritten");
    // `New view` › Board writes no `columns` (D-1910); a board with its own columns keeps them.
    let mut d = some!(core.query("Rozečtené").def, "Rozečtené def");
    d.title = "Nový pohled".into();
    d.columns = vec![];
    d.lane_order = None;
    let text = queries_q::create_text(&d, NOW, None);
    assert!(!text.lines().any(|l| l.starts_with("columns:")), "a Board with empty columns writes none:\n{text}");
    d.columns = strs(&["author"]);
    assert!(queries_q::create_text(&d, NOW, None).contains("\ncolumns: [author]\n"), "a board with columns keeps them");
    d.columns = vec![];
    d.view = queries_q::View::Table;
    assert!(queries_q::create_text(&d, NOW, None).contains("\ncolumns: []\n"), "a Table writes `columns` always (part one)");
    let mut b = some!(core.query("Rozečtené").def, "Rozečtené def");
    b.title = "Nová tabule".into();
    b.columns = vec![];
    b.lane_order = None;
    let created = ok!(core.query_create(queries_q::QueryCreate { title: "Nová tabule".into(), def: Some(b), fence: None, free: false }, NOW), "query_create Board");
    let t = some!(disk_s(&root, &created.path), "the created file");
    assert!(!t.lines().any(|l| l.starts_with("columns:")), "the created board file has no columns line:\n{t}");
}

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-3

#[test]
fn fr_qry_08_ac3_period_lanes_pre_fill_dates() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let p = "Projekty/Nový projekt.md";
    let text = format!("---\ntype: projekt\ntitle: Nový projekt\nstatus: To do\ndue: 2026-10-18\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    ok!(core.create_exact(p, text.as_bytes()), "the draft's first write (pre-filled with the week's last day)");
    let tk = "Tasks/Nový úkol.md";
    let text2 = format!("---\ntype: task\ntitle: Nový úkol\nstatus: To do\ndue: 2026-10-14\ncreated: {NOW}\nmodified: {NOW}\n---\n");
    ok!(core.create_exact(tk, text2.as_bytes()), "a Task from Today & overdue");
    let _ = core.wait_idle(Duration::from_secs(30));
    assert_eq!(disk_s(&root, p), Some(text), "the date as YYYY-MM-DD");
    assert!(day(&run(&core, PROJEKTY, &env()), "2026-10-18", "Projekty").contains(&p.to_string()), "the project shows in neděle 18.");
    assert!(lane(&run(&core, "Schedule", &env()), "period:today", "Schedule").contains(&tk.to_string()), "the task shows in Today & overdue");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-35

#[test]
fn fr_fmt_07_ac35_q2t_keys_round_trip() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let c = corpus();
    write_corpus_queries(&root, &c);
    let core = open(&root, &sb.dirs, false);
    let before = snapshot(&root);
    for r in c["reads"].as_array().expect("reads") {
        let n = r["name"].as_str().unwrap_or("");
        let _ = run(&core, n, &env());
        let _ = run(&core, n, &env_us());
    }
    let _ = core.query_run(QuerySource::View { type_key: "task".into(), name: "Schedule".into() }, None, &env());
    assert_eq!(snapshot(&root), before, "opening, running and drawing every Q2-T file writes nothing");
    // A commit of the unchanged definition writes nothing.
    for n in ["Schedule", "Kanban", PROJEKTY] {
        ok!(commit(&core, n, |_| {}), format!("{n}: unchanged commit"));
    }
    assert_eq!(snapshot(&root), before, "an unchanged commit writes nothing");
    // Switch lanes: one line and modified; CRLF and no-final-newline copies keep their bytes. Slice Q3 (D-2179): the
    // writer emits `lanes: columns` (expected/views-display/queries/schedule-lanes-columns*.yml).
    let q3 = |rel: &str| String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/queries-files/expected/views-display").join(rel)).expect("setup: expected")).expect("setup: UTF-8");
    ok!(commit(&core, "Schedule", |d| d.lanes = Lanes::Columns), "Switch lanes");
    assert_eq!(disk_s(&root, SCHEDULE), Some(q3("queries/schedule-lanes-columns.yml")), "lanes: columns");
    for (variant, input, want) in [("crlf", fx(SCHEDULE).replace('\n', "\r\n"), "queries/schedule-lanes-columns-crlf.yml"), ("no-newline", fx(SCHEDULE).trim_end_matches('\n').to_string(), "queries/schedule-lanes-columns-no-newline.yml")] {
        write(&root, SCHEDULE, input.as_bytes());
        reread(&core, &[SCHEDULE]);
        ok!(commit(&core, "Schedule", |d| d.lanes = Lanes::Columns), format!("Switch lanes ({variant})"));
        assert_eq!(disk_s(&root, SCHEDULE), Some(q3(want)), "{variant}: bytes kept");
    }
    // The lane drag, Reset lane order, the editor's group_by and done-lane changes.
    ok!(commit(&core, "Kanban", |d| d.lane_order = Some(strs(&["Waiting", "To do", "In progress", "Done", "Rozpracováno"]))), "lane drag");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-lane-order-waiting.yml")), "lane_order");
    ok!(commit(&core, "Kanban", |d| d.lane_order = None), "Reset lane order");
    assert_eq!(disk_s(&root, KANBAN), Some(exp("queries/kanban-lane-order-reset.yml")), "reset");
    ok!(commit(&core, PROJEKTY, |d| d.group_by = Some("created".into())), "group_by created");
    assert_eq!(disk_s(&root, &qp(PROJEKTY)), Some(exp("queries/projekty-group-created.yml")), "the comment kept");
    write(&root, SCHEDULE, fx(SCHEDULE).as_bytes());
    reread(&core, &[SCHEDULE]);
    ok!(commit(&core, "Schedule", |d| d.done_lane = None), "done lane off");
    assert_eq!(disk_s(&root, SCHEDULE), Some(exp("queries/schedule-no-done-lane.yml")), "done_lane removed");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-14

#[test]
fn fr_fmt_12_ac14_q2t_names_and_tags_are_nfc() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    // An NFD `Čeká na ostatní` in views: and an NFD file name.
    write(&root, TASK_YML, swapped(&fx(TASK_YML), "views: [Schedule, Kanban, Čeká na ostatní]\n", &format!("views: [{}, Kanban, {}]\n", nfd("Schedule"), nfd(CEKA))).as_bytes());
    let ceka = fx(&qp(CEKA));
    std::fs::remove_file(root.join(qp(CEKA))).expect("setup: remove NFC file");
    write(&root, &format!(".tegg/queries/{}.yml", nfd(CEKA)), ceka.as_bytes());
    let core = open(&root, &sb.dirs, false);
    let r = run(&core, "Schedule", &env());
    let n19 = r.rows.iter().filter(|x| tegg_format::nfc(&x.path) == t(19)).count();
    assert_eq!(n19, 1, "Nákup is one row");
    assert_eq!(day(&r, "2026-10-15", "Schedule"), ts(&[4, 19]), "one card in čtvrtek 15.");
    assert_eq!(r.rows.iter().find(|x| tegg_format::nfc(&x.path) == t(19)).map(|x| x.tags.clone()), Some(strs(&["doma"])), "its NFD tag is the NFC key `doma`");
    let v = core.query_run(QuerySource::View { type_key: "task".into(), name: nfd(CEKA) }, None, &env());
    assert_eq!(paths(&v), ts(&[4]), "the NFD tab name and the NFD file resolve to Čeká na ostatní");
    assert!(core.query(CEKA).def.is_some(), "query(NFC name) finds the NFD file");
    // A period drag of T19 keeps its NFD title bytes.
    ok!(drop_write(&core, &t(19), &exp("tasks/nakup-later.md")), "T19 onto Later");
    assert_eq!(std::fs::read(root.join(t(19))).ok(), Some(exp("tasks/nakup-later.md").into_bytes()), "NFD title kept, due written");
    reread(&core, &[&t(19)]);
    assert!(lane(&run(&core, "Schedule", &env()), "period:later", "after").contains(&t(19)), "T19 in Later");
    // The migration's names are NFC.
    let sb2 = sandbox();
    let root2 = base_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    let _ = core2.task_views_migrate(NOW);
    assert_eq!(list_files(&root2, ".tegg/queries"), strs(&[KANBAN, SCHEDULE]), "NFC file names");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-13

const KILL_ATOMIC: &str = "fr_syn_02_ac13_q2t_writes_are_atomic";

#[test]
fn fr_syn_02_ac13_q2t_writes_are_atomic() {
    kill_child();
    let sb = sandbox();
    let work = sb.base.join("kill");
    let root = work.join("vault");
    copy_dir(&repo_root().join("tests/fixtures/vaults/tasks"), &root, &["README.md"]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&repo_root().join("tests/fixtures/vaults/views-tasks"), &root, &["README.md"]);
    std::fs::create_dir_all(work.join("app")).expect("setup: app dir");
    let mut seed: u64 = 0x5132_5441_534b_13;
    let mut bad: Vec<String> = Vec::new();
    // period: Zalít květiny `due` 2026-10-14 ↔ removed, through note_write.
    let (a, b) = (base_fx("Tasks/Zalít květiny.md"), exp("tasks/zalit-kvetiny-no-due.md"));
    let mut wrote = 0usize;
    for cycle in 0..KILL_CYCLES {
        std::fs::write(root.join(t(3)), &a).expect("setup: reset T03");
        if let Some(e) = kill_once(KILL_ATOMIC, &work, "period", cycle, &mut seed) {
            bad.push(format!("period {cycle}: the writer failed: {e}"));
        }
        let now = disk_s(&root, &t(3)).unwrap_or_default();
        if now != a {
            wrote += 1;
        }
        if now != a && now != b {
            bad.push(format!("period {cycle}: torn ({} bytes)", now.len()));
        }
        for l in temp_files(&root, &["Tasks"]) {
            let _ = std::fs::remove_file(root.join(l));
        }
        if bad.len() > 10 {
            break;
        }
    }
    if wrote == 0 {
        bad.push("period: the writer never committed".into());
    }
    // restore: Restore default views / Undo on the overlay after trashing Kanban.
    {
        let core = open(&root, &fresh_dirs(&sb, "Příprava"), false);
        trash_view(&core, &["Schedule", CEKA], "Kanban");
    }
    let (without, with, kan) = (exp("types/task-overlay-without-kanban.yml"), fx(TASK_YML), exp("queries/kanban-default.yml"));
    let original_kanban = fx(KANBAN);
    let mut wrote = 0usize;
    for cycle in 0..KILL_CYCLES {
        std::fs::write(root.join(TASK_YML), &without).expect("setup: reset task.yml");
        let _ = std::fs::remove_file(root.join(KANBAN));
        for f in list_files(&root, ".trash/.tegg/queries") {
            if f.contains("Kanban (") {
                let _ = std::fs::remove_file(root.join(&f));
            }
        }
        if let Some(e) = kill_once(KILL_ATOMIC, &work, "restore", cycle, &mut seed) {
            bad.push(format!("restore {cycle}: the writer failed: {e}"));
        }
        let tk = disk_s(&root, TASK_YML).unwrap_or_default();
        if tk != without {
            wrote += 1;
        }
        if tk != without && tk != with {
            bad.push(format!("restore {cycle}: task.yml torn ({} bytes)", tk.len()));
        }
        if let Some(k) = disk_s(&root, KANBAN) {
            if k != kan {
                bad.push(format!("restore {cycle}: Kanban.yml torn ({} bytes)", k.len()));
            }
        }
        for f in list_files(&root, ".trash/.tegg/queries").into_iter().filter(|f| !f.contains("tegg-tmp")) {
            let s = disk_s(&root, &f).unwrap_or_default();
            if s != kan && s != original_kanban {
                bad.push(format!("restore {cycle}: {f} torn ({} bytes)", s.len()));
            }
        }
        for l in temp_files(&root, &[".tegg/queries", ".tegg/types", ".trash/.tegg/queries"]) {
            let _ = std::fs::remove_file(root.join(l));
        }
        if bad.len() > 10 {
            break;
        }
    }
    if wrote == 0 {
        bad.push("restore: the writer never committed".into());
    }
    // A leftover temp file is never listed as a query, type or object.
    std::fs::write(root.join(TASK_YML), &with).expect("setup: task.yml");
    std::fs::write(root.join(KANBAN), &kan).expect("setup: Kanban.yml");
    write(&root, ".tegg/queries/.Kanban.yml.4242.tegg-tmp", b"version: 1\ntitle: Polovina\n");
    write(&root, ".tegg/types/.task.yml.4242.tegg-tmp", b"version: 1\nname: Polovina\n");
    write(&root, "Tasks/.Zalít květiny.md.4242.tegg-tmp", b"---\ntype: task\ntitle: Polovina\n---\n");
    let core = open(&root, &fresh_dirs(&sb, "Kontrola"), false);
    if core.query("Polovina").def.is_some() || core.queries().iter().any(|q| q.path.contains("tegg-tmp")) || run(&core, "Schedule", &env()).rows.iter().any(|r| r.path.contains("tegg-tmp")) {
        bad.push("a temp file is listed".into());
    }
    assert_eq!(bad, Vec::<String>::new(), "after every kill each file is its complete old or new bytes");
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-32

#[test]
fn fr_syn_03_ac32_q2t_writes_check_the_base() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let outside = |rel: &str, from: &str, to: &str| -> String {
        let theirs = swapped(&disk_s(&root, rel).unwrap_or_default(), from, to);
        std::thread::sleep(Duration::from_millis(20));
        write(&root, rel, theirs.as_bytes());
        theirs
    };
    // A period drag and a done-lane drop on a file changed on disk without an event.
    for (n, rel, from, to) in [(3, "tasks/zalit-kvetiny-due-19.md", "priority: Low\n", "priority: High\n"), (2, "tasks/poslat-rozpocet-done.md", "priority: Medium\n", "priority: High\n")] {
        let p = t(n);
        let (_, v) = ok!(core.read_note(&p, SystemTime::now()), "read_note");
        let theirs = outside(&p, from, to);
        let r = core.write_note(&p, exp(rel).as_bytes(), Some(&v));
        assert!(is_conflict(&r), "T{n:02}: Conflict, got {}", err_of(&r));
        assert_eq!(disk_s(&root, &p), Some(theirs), "T{n:02}: the external bytes stay");
    }
    // A Kanban lane drag on a changed Kanban.yml.
    let (mut d, v) = current(&core, "Kanban");
    let theirs = outside(KANBAN, "title: Kanban\n", "title: Kanban\n# změna\n");
    d.lane_order = Some(strs(&["Waiting"]));
    let r = core.query_apply("Kanban", &v, d, NOW);
    assert!(is_conflict(&r), "lane drag: Conflict, got {}", err_of(&r));
    assert_eq!(disk_s(&root, KANBAN), Some(theirs), "Kanban.yml: nothing written");
    // Restore default views on a changed task.yml: refused; the created file stays and is listed in Queries.
    let sb2 = sandbox();
    let root2 = overlay_vault(&sb2);
    let core2 = open(&root2, &sb2.dirs, false);
    trash_view(&core2, &["Schedule", CEKA], "Kanban");
    let v2 = type_base(&core2);
    let theirs = swapped(&disk_s(&root2, TASK_YML).unwrap_or_default(), "color: blue\n", "color: green\n");
    std::thread::sleep(Duration::from_millis(20));
    write(&root2, TASK_YML, theirs.as_bytes());
    let r = core2.task_views_restore(v2.as_ref(), NOW);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "restore: Conflict, got {}", rest(&r));
    assert_eq!(disk_s(&root2, TASK_YML), Some(theirs), "task.yml: the external bytes stay");
    assert_eq!(disk_s(&root2, KANBAN), Some(exp("queries/kanban-default.yml")), "the file already created stays");
    let _ = core2.wait_idle(Duration::from_secs(30));
    assert!(core2.queries().iter().any(|q| q.name == "Kanban"), "and is listed in Queries");
    // The Undo's views write on a changed task.yml.
    let sb3 = sandbox();
    let root3 = overlay_vault(&sb3);
    let core3 = open(&root3, &sb3.dirs, false);
    trash_view(&core3, &["Schedule", CEKA], "Kanban");
    let x = ok!(core3.task_views_restore(type_base(&core3).as_ref(), NOW), "restore");
    let theirs = swapped(&disk_s(&root3, TASK_YML).unwrap_or_default(), "color: blue\n", "color: green\n");
    std::thread::sleep(Duration::from_millis(20));
    write(&root3, TASK_YML, theirs.as_bytes());
    let r = core3.type_patch("task", x.info.version.as_ref(), &[TypeOp::SetViewsSource(x.before.clone().unwrap_or_default())]);
    assert!(is_conflict(&r), "Undo on a changed task.yml: Conflict, got {}", err_of(&r));
    assert_eq!(disk_s(&root3, TASK_YML), Some(theirs), "nothing written");
    // The same bytes with only a new mtime are no conflict (D-175).
    let p = t(4);
    let (_, v) = ok!(core.read_note(&p, SystemTime::now()), "read_note T04");
    let same = disk_s(&root, &p).unwrap_or_default();
    std::thread::sleep(Duration::from_millis(20));
    write(&root, &p, same.as_bytes());
    let r = core.write_note(&p, exp("tasks/koupit-darek-no-due.md").as_bytes(), Some(&v));
    assert!(r.is_ok(), "same bytes, new mtime: written ({})", err_of(&r));
}
