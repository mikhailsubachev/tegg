//! MS5 slice 5A-1 AC tests at the core (L4): FR-TSK-01 AC-1, AC-4 (bytes through the core write), AC-7; FR-TSK-02
//! AC-1…AC-9, AC-11 (base check), AC-13; FR-TSK-03 AC-2; FR-TSK-04 AC-7 (events); FR-TSK-05 AC-10 (base check);
//! FR-TSK-10 AC-1 (write), AC-5, AC-7; FR-TSK-11 AC-1; FR-DLY-04 AC-9, AC-11. docs/acceptance/tasks.md (R44);
//! interface docs/contracts/ms5-tasks.md §2 (`Core::tasks`, `task_defs`, `daily_tasks`, the §2.2 option ops through
//! `type_patch`) and §5 (every task write is one `write_note` with the row's version as base). Written from the ACs and
//! the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/tasks + new-empty/.tegg in a temporary directory on APFS (its README.md isn't a vault
//! file). Bytes, mtime and inode are compared with `common::snapshot`. The core has no clock and no zone (§1): "now"
//! is a value the test writes into the bytes; day windows are built here with chrono-tz.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::{NaiveDate, TimeZone};
use common::*;
use tegg_core::{Core, CoreError, CoreEvent, CoreOptions, DayWindow, LinkKind, TaskRow, TaskState, VaultError};
use tegg_format::nfc;
use tegg_schema::{OptionDef, RuleError, SchemaError, TypeOp};
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const T01: &str = "Tasks/Zavolat Janě.md";
const T02: &str = "Tasks/Poslat rozpočet.md";
const T03: &str = "Tasks/Zalít květiny.md";
const T04: &str = "Tasks/Koupit dárek.md";
const T05: &str = "Tasks/Úklid garáže.md";
const T06: &str = "Tasks/Příprava prezentace.md";
const T07: &str = "Tasks/Obnovit pas.md";
const T08: &str = "Tasks/Přečíst knihu.md";
const T09: &str = "Tasks/Opravit kolo.md";
const T10: &str = "Tasks/Zaplatit fakturu.md";
const T11: &str = "Tasks/Objednat lístky.md";
const T12: &str = "Tasks/Vrátit knihy.md";
const T13: &str = "Tasks/Zrušená cesta.md";
const T14: &str = "Tasks/Bez stavu.md";
const T15: &str = "Tasks/Cizí stav.md";
const T16: &str = "Tasks/Špatné datum.md";
const T17: &str = "Tasks/S časem.md";
const T18: &str = "Tasks/Štítek v textu.md";
const T19: &str = "Tasks/Nákup.md";
const ALL: [&str; 19] = [T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19];
const PORADA: &str = "Pages/Porada.md";
const WEB: &str = "Projekty/Web.md";
const SE_STAVEM: &str = "Pages/Se stavem.md";
const BEZ_HLAVICKY: &str = "Tasks/Bez hlavičky.md";
const SABLONA: &str = "_templates/Task/Task.md";
const SMAZANY: &str = ".trash/Tasks/Smazaný úkol.md";
const TASK_YML: &str = ".tegg/types/task.yml";

const PRAGUE: chrono_tz::Tz = chrono_tz::Europe::Prague;
const LA: chrono_tz::Tz = chrono_tz::America::Los_Angeles;
const NOW: &str = "2026-10-14T12:00:00+02:00";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
/// `tests/fixtures/vaults/tasks/` (without its README.md) plus `new-empty/.tegg/` in `<sandbox>/<name>`.
fn tasks_vault_named(sb: &Sandbox, name: &str) -> PathBuf {
    let root = sb.base.join(name);
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("tasks"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn tasks_vault(sb: &Sandbox) -> PathBuf {
    tasks_vault_named(sb, "Úkoly")
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch: false, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    open_dirs(root, &sb.dirs)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
/// An external change the core is told about (watch: false): write, then `notify_changed`, then idle.
fn ext_write(core: &Core, root: &Path, rel: &str, text: &str) {
    write_raw(root, rel, text.as_bytes());
    core.notify_changed(&[rel.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after an external write");
}
fn ext_delete(core: &Core, root: &Path, rel: &str) {
    std::fs::remove_file(root.join(rel)).expect("setup: delete");
    core.notify_changed(&[rel.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after an external delete");
}
fn ext_move(core: &Core, root: &Path, from: &str, to: &str) {
    let dst = root.join(to);
    std::fs::create_dir_all(dst.parent().expect("setup: parent")).expect("setup: mkdir");
    std::fs::rename(root.join(from), dst).expect("setup: rename");
    core.notify_changed(&[from.to_string(), to.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after an external move");
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("setup: date")
}
/// ms4-daily §1: local midnight to the next local midnight in `tz`.
fn window(date: &str, tz: chrono_tz::Tz) -> DayWindow {
    let d = day(date);
    let at = |x: NaiveDate| tz.from_local_datetime(&x.and_hms_opt(0, 0, 0).expect("setup: midnight")).earliest().expect("setup: local midnight").fixed_offset();
    DayWindow { date: d, start: at(d), end: at(d.succ_opt().expect("setup: next day")) }
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn nil() -> Vec<String> {
    Vec::new()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}
fn paths(rows: &[TaskRow]) -> Vec<String> {
    rows.iter().map(|r| nfc(&r.path)).collect()
}
fn sorted_paths(core: &Core) -> Vec<String> {
    let mut p = paths(&core.tasks());
    p.sort();
    p
}
fn row(core: &Core, path: &str) -> Option<TaskRow> {
    core.tasks().into_iter().find(|r| nfc(&r.path) == nfc(path))
}
fn need_row(core: &Core, path: &str) -> TaskRow {
    let r = row(core, path);
    assert!(r.is_some(), "the task query returns {path}");
    r.unwrap()
}
fn task_text(n: u32, title: &str, keys: &str, body: &str) -> String {
    format!("---\nid: 01JB5A0000000000000000R{n:03}\ntype: task\ntitle: {title}\n{keys}created: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n{body}")
}
fn type_base(core: &Core) -> Option<FileVersion> {
    core.type_get("task").and_then(|t| t.version)
}
fn opt(label: &str, color: &str, state: Option<&str>) -> OptionDef {
    OptionDef {
        label: label.into(),
        color: Some(color.into()),
        extra: state.map(|s| vec![("state".to_string(), serde_json::Value::String(s.into()))]).unwrap_or_default(),
    }
}
const WAITING_LINE: &str = "      - { label: Waiting, state: open, color: yellow }\n";

/// Every field of a row except `version`, for "identical after a rebuild" checks.
fn fields(r: &TaskRow) -> String {
    format!(
        "{}|{:?}|{}|{:?}|{:?}|{}|{:?}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{}|{:?}|{:?}|{}",
        nfc(&r.path), r.id, r.title, r.status, r.state, r.status_known, r.priority, r.priority_rank, r.due_raw, r.due, r.completed, r.tags, r.fm_tags,
        r.source.as_ref().map(|s| (s.kind, s.path.clone())), r.excerpt, r.created, r.modified, r.read_only
    )
}

// ------------------------------------------------------------------------------------------------ FR-TSK-01

#[test]
fn fr_tsk_01_ac1_the_task_query_returns_exactly_t01_to_t19() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let mut want = strs(&ALL);
    want.sort();
    assert_eq!(sorted_paths(&core), want, "exactly T01…T19 (R44)");
    let got = sorted_paths(&core);
    for never in [WEB, SE_STAVEM, BEZ_HLAVICKY, SABLONA, SMAZANY, PORADA] {
        assert!(!got.contains(&never.to_string()), "{never} is never a task");
    }
}

#[test]
fn fr_tsk_01_ac1_row_fields_follow_r44() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let t01 = need_row(&core, T01);
    assert_eq!(t01.id.as_deref(), Some("01JB5A0000000000000000E001"));
    assert_eq!(t01.title, "Zavolat Janě");
    assert_eq!(t01.status.as_deref(), Some("To do"));
    assert_eq!(t01.state, TaskState::Open);
    assert!(t01.status_known, "To do is an option");
    assert_eq!((t01.priority.as_deref(), t01.priority_rank), (Some("High"), 0), "High ranks first");
    assert_eq!((t01.due_raw.as_deref(), t01.due), (Some("2026-10-09"), Some(day("2026-10-09"))));
    assert_eq!(t01.completed, None);
    assert_eq!((t01.tags.clone(), t01.fm_tags.clone()), (strs(&["práce"]), strs(&["práce"])));
    let src = t01.source.clone();
    assert_eq!(src.as_ref().map(|s| (s.kind, s.path.clone().map(|p| nfc(&p)))), Some((LinkKind::Note, Some(PORADA.to_string()))), "source resolves to Porada");
    assert_eq!(t01.excerpt, "Domluvit schůzku na příští týden.", "the body start as plain text");
    assert_eq!((t01.created.as_deref(), t01.modified.as_deref()), (Some("2026-10-01T09:00:00+02:00"), Some("2026-10-01T09:00:00+02:00")));
    assert!(!t01.read_only);

    let st = |p: &str| need_row(&core, p).state;
    assert_eq!([st(T02), st(T09)], [TaskState::InProgress; 2], "In progress");
    assert_eq!([st(T10), st(T11), st(T12)], [TaskState::Done; 3], "Done");
    assert_eq!(st(T13), TaskState::Cancelled);
    assert_eq!([st(T04), st(T14), st(T15)], [TaskState::Open; 3], "Waiting, missing and unknown are Open (D-471)");
    let rank = |p: &str| need_row(&core, p).priority_rank;
    assert_eq!([rank(T02), rank(T03), rank(T07), rank(T09)], [1, 2, 3, 4], "Medium 1, Low 2, None 3, missing = options.len() (AP-407)");
    let t14 = need_row(&core, T14);
    assert_eq!((t14.status.clone(), t14.status_known), (None, true), "no status key");
    let t15 = need_row(&core, T15);
    assert_eq!((t15.status.as_deref(), t15.status_known), (Some("Rozpracováno"), false), "not an option");
    let t16 = need_row(&core, T16);
    assert_eq!((t16.due_raw.as_deref(), t16.due), (Some("2026-02-30"), None), "an impossible date isn't a due date (D-484)");
    let t17 = need_row(&core, T17);
    assert_eq!((t17.due_raw.as_deref(), t17.due), (Some("2026-10-15T09:00:00+02:00"), None), "a date-time isn't a due date");
    let t18 = need_row(&core, T18);
    assert_eq!((t18.tags.clone(), t18.fm_tags.clone()), (strs(&["práce", "rodina"]), strs(&["práce"])), "inline tags join, sorted (D-185)");
    let t05 = need_row(&core, T05);
    assert_eq!((t05.tags.clone(), t05.fm_tags.clone()), (strs(&["doma"]), strs(&["Doma"])), "tag keys are case-folded, fm_tags as written");
    let t19 = need_row(&core, T19);
    assert_eq!(nfc(&t19.title), "Nákup");
    assert_eq!(t19.tags, strs(&["doma"]), "NFD tag bytes give the NFC key");
    let t10 = need_row(&core, T10);
    assert_eq!(t10.completed.as_deref(), Some("2026-10-14T09:30:00+02:00"));
    assert_eq!(need_row(&core, T12).completed, None, "reading never adds `completed`");
}

#[test]
fn fr_tsk_01_ac1_type_matching_decides_not_the_folder() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let t03 = read(&root, T03);
    write_raw(&root, "Pages/Velké T.md", swap(&swap(&t03, "type: task", "type: Task"), "E003", "R001").as_bytes());
    write_raw(&root, "Pages/Úkol česky.md", swap(&swap(&t03, "type: task", "type: úkol"), "E003", "R002").as_bytes());
    let core = open(&root, &sb);
    let got = sorted_paths(&core);
    assert!(got.contains(&"Pages/Velké T.md".to_string()), "`type: Task` matches task (FR-TYP-13 AC-1): {got:?}");
    assert!(!got.contains(&"Pages/Úkol česky.md".to_string()), "`type: úkol` is another type");
    assert_eq!(got.len(), 20, "T01…T19 plus the copy");
}

#[test]
fn fr_tsk_01_ac4_completed_bytes_through_the_core_write() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let r = need_row(&core, T03);
    let before = snapshot(&root);
    let orig = read(&root, T03);
    let done = swap(&swap(&orig, "status: To do", "status: Done"), "modified: 2026-10-01T09:00:00+02:00\n", &format!("modified: {NOW}\ncompleted: {NOW}\n"));
    ok!(core.write_note(T03, done.as_bytes(), Some(&r.version)), "write_note with the row's version");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[T03]), "one file");
    assert_eq!(read(&root, T03), done, "the bytes as written");
    let after = need_row(&core, T03);
    assert_eq!((after.state, after.completed.as_deref()), (TaskState::Done, Some(NOW)), "the row follows the write");
    // Back to To do: the line is removed, the base is the new version.
    let undone = swap(&swap(&done, "status: Done", "status: To do"), &format!("completed: {NOW}\n"), "");
    ok!(core.write_note(T03, undone.as_bytes(), Some(&after.version)), "write_note back");
    let back = need_row(&core, T03);
    assert_eq!((back.state, back.completed.clone()), (TaskState::Open, None));
    assert_eq!(need_row(&core, T12).completed, None, "indexing never fixes `completed` (T12)");
}

#[test]
fn fr_tsk_01_ac7_a_rebuilt_index_gives_the_same_rows() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let rows = |core: &Core| {
        let mut v: Vec<String> = core.tasks().iter().map(fields).collect();
        v.sort();
        v
    };
    let (first, defs) = {
        let core = open(&root, &sb);
        (rows(&core), format!("{:?}", core.task_defs().statuses.iter().map(|s| (s.label.clone(), s.state)).collect::<Vec<_>>()))
    };
    assert_eq!(first.len(), 19, "19 rows before the rebuild");
    let fresh = fresh_dirs(&sb, "Bez indexu");
    let core = open_dirs(&root, &fresh);
    assert_eq!(rows(&core), first, "every field identical after deleting the index (AR-01)");
    assert_eq!(format!("{:?}", core.task_defs().statuses.iter().map(|s| (s.label.clone(), s.state)).collect::<Vec<_>>()), defs);
}

// ------------------------------------------------------------------------------------------------ FR-TSK-02

#[test]
fn fr_tsk_02_ac1_default_statuses_and_states() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    write_raw(&root, "Tasks/Čekající dlouho.md", task_text(1, "Čekající dlouho", "status: Waiting\ndue: 2026-10-01\n", "").as_bytes());
    let core = open(&root, &sb);
    let defs = core.task_defs();
    let got: Vec<(String, TaskState)> = defs.statuses.iter().map(|s| (s.label.clone(), s.state)).collect();
    let want: Vec<(String, TaskState)> = [("To do", TaskState::Open), ("In progress", TaskState::InProgress), ("Waiting", TaskState::Open), ("Done", TaskState::Done), ("Cancelled", TaskState::Cancelled)]
        .iter()
        .map(|(l, s)| (l.to_string(), *s))
        .collect();
    assert_eq!(got, want, "the five statuses of new-empty task.yml with their states (D-25)");
    assert_eq!(defs.priorities.iter().map(|o| o.label.clone()).collect::<Vec<_>>(), strs(&["High", "Medium", "Low", "None"]));
    assert_eq!(need_row(&core, T04).state, TaskState::Open, "T04 (Waiting) is open");
    let w = need_row(&core, "Tasks/Čekající dlouho.md");
    assert_eq!((w.state, w.due), (TaskState::Open, Some(day("2026-10-01"))), "a Waiting task with a past due is open (overdue in the UI)");
}

#[test]
fn fr_tsk_02_ac2_colour_and_order_write_one_line_of_task_yml_only() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::SetOptionColor { attr: "status".into(), label: "Waiting".into(), color: "purple".into() }]), "colour");
    let want = swap(&yml, WAITING_LINE, "      - { label: Waiting, state: open, color: purple }\n");
    assert_eq!(read(&root, TASK_YML), want, "only the Waiting line changes (AR-07 AC-5)");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "no task file is written");
    let mid = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::MoveOption { attr: "status".into(), label: "Waiting".into(), to: 1 }]), "move");
    let moved = swap(
        &want,
        "      - { label: In progress, state: in-progress, color: blue }\n      - { label: Waiting, state: open, color: purple }\n",
        "      - { label: Waiting, state: open, color: purple }\n      - { label: In progress, state: in-progress, color: blue }\n",
    );
    assert_eq!(read(&root, TASK_YML), moved, "only the moved line changes place");
    assert_eq!(changed(&mid, &snapshot(&root)), strs(&[TASK_YML]));
    let defs = core.task_defs();
    assert_eq!(defs.statuses.iter().map(|s| (s.label.clone(), s.color.clone())).collect::<Vec<_>>()[..3].to_vec(), vec![
        ("To do".to_string(), Some("gray".to_string())),
        ("Waiting".to_string(), Some("purple".to_string())),
        ("In progress".to_string(), Some("blue".to_string())),
    ], "task_defs follows the file");
    assert!(matches!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::RemoveAttribute("status".into())]), Err(CoreError::Schema(SchemaError::BuiltInChanged))), "status stays built in");
}

#[test]
fn fr_tsk_02_ac3_add_a_status_with_state_done() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::AddOption { attr: "status".into(), option: opt("Delegováno", "teal", Some("done")) }]), "add");
    assert_eq!(
        read(&root, TASK_YML),
        swap(&yml, "      - { label: Cancelled, state: cancelled, color: red }\n", "      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Delegováno, state: done, color: teal }\n"),
        "exactly the appended line"
    );
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]));
    ext_write(&core, &root, "Tasks/Předáno.md", &task_text(2, "Předáno", "status: Delegováno\n", ""));
    assert_eq!(need_row(&core, "Tasks/Předáno.md").state, TaskState::Done, "a Delegováno task is Done");
    assert_eq!(core.task_defs().statuses.last().map(|s| (s.label.clone(), s.state)), Some(("Delegováno".to_string(), TaskState::Done)));
}

#[test]
fn fr_tsk_02_ac4_change_a_state_without_touching_tasks() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::SetOptionState { attr: "status".into(), label: "Waiting".into(), state: "in-progress".into() }]), "state");
    assert_eq!(read(&root, TASK_YML), swap(&yml, WAITING_LINE, "      - { label: Waiting, state: in-progress, color: yellow }\n"));
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "no task file written");
    let t04 = need_row(&core, T04);
    assert_eq!((t04.state, t04.due), (TaskState::InProgress, Some(day("2026-10-15"))), "T04 is In progress and still due 15 Oct");
}

#[test]
fn fr_tsk_02_ac5_used_labels_are_read_only_unused_can_be_renamed() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    std::fs::remove_file(root.join(T13)).expect("setup: no T13");
    let core = open(&root, &sb);
    let usage = core.type_usage("task");
    let st = usage.options.get("status").cloned().unwrap_or_default();
    assert_eq!(st.get("To do").copied(), Some(10), "To do: 10 tasks (FR-TYP-03 AC-5)");
    assert_eq!(st.get("Cancelled").copied().unwrap_or(0), 0, "Cancelled unused without T13");
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    let r = core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::RenameOption { attr: "status".into(), from: "To do".into(), to: "Úkol".into() }]);
    assert!(
        matches!(&r, Err(CoreError::Schema(SchemaError::Rule(RuleError::OptionUsed { label }))) if label == "To do"),
        "renaming a used label is refused with optionUsed: {:?}",
        r.as_ref().map(|_| ())
    );
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::RenameOption { attr: "status".into(), from: "Cancelled".into(), to: "Zrušeno".into() }]), "rename unused");
    assert_eq!(read(&root, TASK_YML), swap(&yml, "label: Cancelled,", "label: Zrušeno,"), "only the label");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "no task file written");
}

#[test]
fn fr_tsk_02_ac6_removing_a_used_status_keeps_the_value() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::RemoveOption { attr: "status".into(), label: "Waiting".into() }]), "remove");
    assert_eq!(read(&root, TASK_YML), swap(&yml, WAITING_LINE, ""), "only the Waiting line goes");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "T04's file is untouched");
    let t04 = need_row(&core, T04);
    assert_eq!((t04.status.as_deref(), t04.status_known, t04.state), (Some("Waiting"), false, TaskState::Open), "raw value kept, not a status, Open (D-471)");
}

#[test]
fn fr_tsk_02_ac7_the_last_open_or_done_status_stays() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let base = type_base(&core);
    assert!(base.is_some(), "task.yml has a version");
    let r1 = core.type_patch("task", base.as_ref(), &[TypeOp::RemoveOption { attr: "status".into(), label: "Done".into() }]);
    assert!(matches!(r1, Err(CoreError::Schema(SchemaError::Rule(RuleError::NeedDone)))), "removing the last Done status: needDone");
    let r2 = core.type_patch("task", base.as_ref(), &[TypeOp::SetOptionState { attr: "status".into(), label: "Done".into(), state: "open".into() }]);
    assert!(matches!(r2, Err(CoreError::Schema(SchemaError::Rule(RuleError::NeedDone)))), "changing its state: needDone");
    let r3 = core.type_patch("task", base.as_ref(), &[
        TypeOp::RemoveOption { attr: "status".into(), label: "To do".into() },
        TypeOp::RemoveOption { attr: "status".into(), label: "Waiting".into() },
    ]);
    assert!(matches!(r3, Err(CoreError::Schema(SchemaError::Rule(RuleError::NeedOpen)))), "removing both Open statuses: needOpen");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn fr_tsk_02_ac8_the_app_uses_states_not_labels() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    // Done → Hotovo (no task uses either before the copy is made: T10…T12 move to `Hotovo`), and Odloženo cancelled.
    let yml = read(&root, TASK_YML);
    let yml = swap(&yml, "      - { label: Done, state: done, color: green }\n", "      - { label: Hotovo, state: done, color: green }\n      - { label: Odloženo, state: cancelled, color: gray }\n");
    write_raw(&root, TASK_YML, yml.as_bytes());
    for p in [T10, T11, T12] {
        let t = read(&root, p);
        write_raw(&root, p, swap(&t, "status: Done", "status: Hotovo").as_bytes());
    }
    write_raw(&root, "Tasks/Odložený.md", task_text(3, "Odložený", "status: Odloženo\ndue: 2026-10-14\n", "").as_bytes());
    let core = open(&root, &sb);
    let defs = core.task_defs();
    let first_done = defs.statuses.iter().find(|s| s.state == TaskState::Done).map(|s| s.label.clone());
    assert_eq!(first_done.as_deref(), Some("Hotovo"), "checking writes the first Done-state status (D-472)");
    assert_eq!(need_row(&core, "Tasks/Odložený.md").state, TaskState::Cancelled, "Odloženo is Cancelled");
    assert_eq!(need_row(&core, T10).state, TaskState::Done, "Hotovo is Done");
    let d = core.daily_tasks(&window("2026-10-14", PRAGUE), day("2026-10-14"), 50);
    let listed: Vec<String> = d.overdue.iter().chain(&d.due).chain(&d.completed).map(|r| nfc(&r.path)).collect();
    assert!(!listed.contains(&"Tasks/Odložený.md".to_string()), "a Cancelled-state task is never in Tasks due: {listed:?}");
    assert!(listed.contains(&T10.to_string()), "T10 (Hotovo) completed today is listed: {listed:?}");
}

#[test]
fn fr_tsk_02_ac9_missing_and_unknown_values_are_open_and_never_written() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let yml = read(&root, TASK_YML);
    let yml = swap(
        &yml,
        "      - { label: Cancelled, state: cancelled, color: red }\n",
        "      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Blokováno, color: red }\n      - { label: Pozastaveno, state: blocked, color: purple }\n",
    );
    write_raw(&root, TASK_YML, yml.as_bytes());
    let before = snapshot(&root);
    let core = open(&root, &sb);
    let defs = core.task_defs();
    let st = |l: &str| defs.statuses.iter().find(|s| s.label == l).map(|s| (s.state, s.state_raw.clone()));
    assert_eq!(st("Blokováno"), Some((TaskState::Open, None)), "no state: Open");
    assert_eq!(st("Pozastaveno"), Some((TaskState::Open, Some("blocked".to_string()))), "unknown state: Open, raw kept");
    assert_eq!(defs.unknown_states, vec![("Blokováno".to_string(), None), ("Pozastaveno".to_string(), Some("blocked".to_string()))], "the type-settings warnings");
    let t14 = need_row(&core, T14);
    let t15 = need_row(&core, T15);
    assert_eq!((t14.state, t15.state, t15.status_known), (TaskState::Open, TaskState::Open, false));
    let _ = core.type_get("task");
    let _ = core.type_usage("task");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "reading, indexing and type settings write nothing (bytes, mtime, inode)");
}

#[test]
fn fr_tsk_02_ac11_a_stale_base_is_a_conflict_and_writes_nothing() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let r = need_row(&core, T03);
    let external = format!("{}Přidáno jiným programem.\n", read(&root, T03));
    write_raw(&root, T03, external.as_bytes()); // other bytes on disk, the core isn't told
    let mine = swap(&read(&root, T03), "status: To do", "status: Done");
    let res = core.write_note(T03, mine.as_bytes(), Some(&r.version));
    assert!(matches!(res, Err(CoreError::Vault(VaultError::Conflict { .. }))), "the write with the row's version is refused: {res:?}");
    assert_eq!(read(&root, T03), external, "the file keeps the external bytes (NFR-REL-02)");
}

#[test]
fn fr_tsk_05_ac10_a_change_during_a_drag_is_a_conflict() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let r = need_row(&core, T03);
    let external = swap(&read(&root, T03), "priority: Low", "priority: High");
    write_raw(&root, T03, external.as_bytes());
    let drop = swap(&read(&root, T03), "status: To do", "status: In progress");
    assert!(matches!(core.write_note(T03, drop.as_bytes(), Some(&r.version)), Err(CoreError::Vault(VaultError::Conflict { .. }))), "the drop's write gets Conflict");
    assert_eq!(read(&root, T03), external);
    // Deleted while dragged: a write with the old base never recreates it.
    std::fs::remove_file(root.join(T03)).expect("setup: delete");
    let res = core.write_note(T03, drop.as_bytes(), Some(&r.version));
    assert!(res.is_err(), "no write to a deleted task");
    assert!(!root.join(T03).exists(), "the file stays deleted");
}

#[test]
fn fr_tsk_02_ac13_type_file_changes_from_outside() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    std::fs::remove_file(root.join(T13)).expect("setup: no T13 (Cancelled unused)");
    let core = open(&root, &sb);
    let old = type_base(&core);
    let yml = read(&root, TASK_YML);
    let ext = swap(&swap(&swap(&yml, "label: Cancelled,", "label: Zrušeno,"), "label: Waiting, state: open, color: yellow", "label: Waiting, state: open, color: purple"),
        "      - { label: Done, state: done, color: green }\n", "      - { label: Done, state: done, color: green }\n      - { label: Delegováno, state: done, color: teal }\n");
    let before = snapshot(&root);
    ext_write(&core, &root, TASK_YML, &ext);
    let labels: Vec<(String, Option<String>)> = core.task_defs().statuses.iter().map(|s| (s.label.clone(), s.color.clone())).collect();
    assert_eq!(labels.iter().map(|x| x.0.clone()).collect::<Vec<_>>(), strs(&["To do", "In progress", "Waiting", "Done", "Delegováno", "Zrušeno"]), "the external edit shows");
    assert_eq!(labels[2].1.as_deref(), Some("purple"));
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "only the external write; the core writes nothing");
    let r = core.type_patch("task", old.as_ref(), &[TypeOp::SetOptionColor { attr: "priority".into(), label: "Low".into(), color: "teal".into() }]);
    assert!(matches!(r, Err(CoreError::Vault(VaultError::Conflict { .. }))), "an old base gets Conflict (FR-TYP-01 AC-7)");
    // task.yml deleted: the built-in statuses apply (D-90); the first change writes the whole default file plus it.
    ext_delete(&core, &root, TASK_YML);
    assert_eq!(core.task_defs().statuses.iter().map(|s| s.label.clone()).collect::<Vec<_>>(), strs(&["To do", "In progress", "Waiting", "Done", "Cancelled"]));
    ok!(core.type_patch("task", None, &[TypeOp::SetOptionColor { attr: "status".into(), label: "Waiting".into(), color: "purple".into() }]), "first change after the delete");
    let shipped = std::fs::read_to_string(repo_root().join("tests/fixtures/vaults/new-empty/.tegg/types/task.yml")).expect("setup");
    assert_eq!(read(&root, TASK_YML), swap(&shipped, WAITING_LINE, "      - { label: Waiting, state: open, color: purple }\n"), "the default file with only that change (FR-TYP-06 AC-4)");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-03

#[test]
fn fr_tsk_03_ac2_reordering_priorities_changes_the_ranks() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let yml = read(&root, TASK_YML);
    let before = snapshot(&root);
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::MoveOption { attr: "priority".into(), label: "Low".into(), to: 1 }]), "move Low");
    assert_eq!(
        read(&root, TASK_YML),
        swap(&yml, "      - { label: Medium, color: orange }\n      - { label: Low, color: blue }\n", "      - { label: Low, color: blue }\n      - { label: Medium, color: orange }\n"),
        "only the moved line"
    );
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "no task file written");
    assert_eq!((need_row(&core, T03).priority_rank, need_row(&core, T02).priority_rank), (1, 2), "T03 (Low) now ranks before T02 (Medium)");
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::AddOption { attr: "priority".into(), option: opt("Kritická", "red", None) }]), "add Kritická");
    ok!(core.type_patch("task", type_base(&core).as_ref(), &[TypeOp::MoveOption { attr: "priority".into(), label: "Kritická".into(), to: 0 }]), "move it first");
    assert_eq!(core.task_defs().priorities.iter().map(|o| o.label.clone()).collect::<Vec<_>>(), strs(&["Kritická", "High", "Low", "Medium", "None"]));
    assert_eq!(changed(&before, &snapshot(&root)), strs(&[TASK_YML]), "still no task file written");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-7 (events)

#[test]
fn fr_tsk_04_ac7_external_changes_update_the_task_query() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let events = core.events();
    let id03 = need_row(&core, T03).id;
    ext_write(&core, &root, "Tasks/Nový.md", &task_text(4, "Nový", "status: To do\ndue: 2026-10-14\n", ""));
    let n = need_row(&core, "Tasks/Nový.md");
    assert_eq!((n.state, n.due), (TaskState::Open, Some(day("2026-10-14"))), "a new task appears");
    ext_write(&core, &root, T07, &swap(&read(&root, T07), "due: 2026-12-01", "due: 2026-10-15"));
    assert_eq!(need_row(&core, T07).due, Some(day("2026-10-15")), "T07's new due");
    ext_delete(&core, &root, T08);
    assert!(row(&core, T08).is_none(), "a deleted task disappears");
    ext_move(&core, &root, T06, ".trash/Tasks/Příprava prezentace.md");
    assert!(row(&core, T06).is_none(), "a task moved to .trash/ disappears");
    ext_write(&core, &root, T09, &swap(&read(&root, T09), "type: task", "type: page"));
    assert!(row(&core, T09).is_none(), "a task whose type becomes page disappears");
    ext_move(&core, &root, T03, "Tasks/Zalít kytky.md");
    let moved = need_row(&core, "Tasks/Zalít kytky.md");
    assert_eq!(moved.id, id03, "a renamed file keeps its id (the card stays)");
    let mut seen = BTreeSet::new();
    while let Ok(e) = events.try_recv() {
        if let CoreEvent::VaultChanged { paths } = e {
            seen.extend(paths.into_iter().map(|p| nfc(&p)));
        }
    }
    for p in ["Tasks/Nový.md", T07, T08, T09] {
        assert!(seen.contains(p), "vault:changed names {p} (the UI re-queries tasks, NFR-PERF-08): {seen:?}");
    }
    assert_eq!(core.tasks().len(), 19 - 3 + 1, "16 tasks after the changes");
}

// ------------------------------------------------------------------------------------------------ FR-TSK-10

fn quick_add_bytes(id: &str, title_yaml: &str, extra: &str) -> String {
    format!("---\nid: {id}\ntype: task\ntitle: {title_yaml}\nstatus: To do\n{extra}created: {NOW}\nmodified: {NOW}\n---\n")
}

#[test]
fn fr_tsk_10_ac1_quick_add_creates_one_file_through_the_creation_path() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let before = snapshot(&root);
    let bytes = quick_add_bytes("01JB5A0000000000000000N001", "Zavolat do servisu", "priority: High\ndue: 2026-10-15\ntags: [auto]\n");
    let path = ok!(core.create_object("task", "Zavolat do servisu", bytes.as_bytes()), "create_object");
    assert_eq!(nfc(&path), "Tasks/Zavolat do servisu.md");
    assert_eq!(read(&root, "Tasks/Zavolat do servisu.md"), bytes, "exactly the bytes");
    let ch = changed(&before, &snapshot(&root));
    assert_eq!(ch, strs(&["Tasks/Zavolat do servisu.md"]), "one file, no Tags/auto.md (D-185)");
    let r = need_row(&core, "Tasks/Zavolat do servisu.md");
    assert_eq!((r.status.as_deref(), r.priority_rank, r.due, r.tags.clone()), (Some("To do"), 0, Some(day("2026-10-15")), strs(&["auto"])), "indexed at once");
}

#[test]
fn fr_tsk_10_ac5_titles_and_file_names() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let t01 = snapshot(&root).get(T01).cloned();
    let p1 = ok!(core.create_object("task", "Q3: plán/rozpočet", quick_add_bytes("01JB5A0000000000000000N002", "\"Q3: plán/rozpočet\"", "").as_bytes()), "Q3");
    assert_eq!(nfc(&p1), "Tasks/Q3 plán rozpočet.md", "forbidden characters become spaces (FR-FMT-08)");
    let p2 = ok!(core.create_object("task", "Zavolat Janě", quick_add_bytes("01JB5A0000000000000000N003", "Zavolat Janě", "").as_bytes()), "duplicate");
    assert_eq!(nfc(&p2), "Tasks/Zavolat Janě (2).md", "a free stem (D-291)");
    assert_eq!(snapshot(&root).get(T01).cloned(), t01, "T01 keeps bytes, mtime and inode");
    let nfd = "Zalít květiny dnes".chars().collect::<String>();
    let nfd: String = tegg_format::nfc(&nfd).chars().flat_map(|c| match c { 'í' => vec!['i', '\u{301}'], 'ě' => vec!['e', '\u{30C}'], x => vec![x] }).collect();
    let p3 = ok!(core.create_object("task", &nfd, quick_add_bytes("01JB5A0000000000000000N004", "Zalít květiny dnes", "").as_bytes()), "NFD title");
    assert_eq!(p3, "Tasks/Zalít květiny dnes.md", "the path is NFC (FR-FMT-12)");
    let long = "Příliš žluťoučký kůň úpěl ďábelské ódy ".repeat(6);
    let long = long.trim().to_string();
    assert!(long.len() >= 250, "setup: a title of 250+ UTF-8 bytes");
    let p4 = ok!(core.create_object("task", &long, quick_add_bytes("01JB5A0000000000000000N005", &long, "").as_bytes()), "long title");
    let stem = Path::new(&p4).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    assert!(stem.len() <= 200, "stem ≤ 200 UTF-8 bytes (D-51): {}", stem.len());
    for p in [&p1, &p2, &p3, &p4] {
        assert!(row(&core, p).is_some(), "{p} is a task row at once");
    }
}

/// A `VaultFs` over `LocalFs` whose `create_new` fails with `Io` (FR-TSK-10 AC-7).
struct FailCreate {
    inner: LocalFs,
}
impl VaultFs for FailCreate {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, _path: &str, _bytes: &[u8]) -> io::Result<FileVersion> {
        Err(io::Error::other("injected: disk full"))
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
}

#[test]
fn fr_tsk_10_ac7_a_failed_create_leaves_no_file() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let fs: Arc<dyn VaultFs> = Arc::new(FailCreate { inner: LocalFs::new(&root) });
    let core = ok!(Core::open_with(fs, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    assert_eq!(core.tasks().len(), 19, "the vault's 19 tasks");
    let before = snapshot(&root);
    let r = core.create_object("task", "Zavolat do servisu", quick_add_bytes("01JB5A0000000000000000N006", "Zavolat do servisu", "").as_bytes());
    assert!(r.is_err(), "the create fails");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "no file and no temp file left");
    assert_eq!(core.tasks().len(), 19, "no row for it");
    let _ = SystemTime::now();
}

// ------------------------------------------------------------------------------------------------ FR-TSK-11

#[test]
fn fr_tsk_11_ac1_checklist_items_are_never_tasks() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    let rows = core.tasks();
    assert_eq!(rows.len(), 19, "19 tasks, one per file");
    let files: BTreeSet<String> = rows.iter().map(|r| nfc(&r.path)).collect();
    assert_eq!(files.len(), 19, "no two rows share a file");
    for r in &rows {
        assert!(root.join(&r.path).is_file(), "{} has a file of its own", r.path);
        for item in ["Zavolat dodavateli", "Poslat zápis", "Objednat projektor", "Něco udělat"] {
            assert_ne!(r.title, item, "a checklist item is never a task");
        }
    }
    assert!(!files.contains(PORADA) && !files.contains(BEZ_HLAVICKY));
    assert_eq!(core.list_type("task").len(), 19, "the index has no Task object without its own file");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-04

fn daily(core: &Core, date: &str, today: &str, tz: chrono_tz::Tz) -> [Vec<String>; 3] {
    let d = core.daily_tasks(&window(date, tz), day(today), 50);
    [paths(&d.overdue), paths(&d.due), paths(&d.completed)]
}

#[test]
fn fr_dly_04_ac9_tasks_due_of_each_date() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    let core = open(&root, &sb);
    assert_eq!(daily(&core, "2026-10-14", "2026-10-14", PRAGUE), [strs(&[T01, T02]), strs(&[T03, T14]), strs(&[T10])], "today: overdue, due today, completed today");
    let d = core.daily_tasks(&window("2026-10-14", PRAGUE), day("2026-10-14"), 50);
    assert_eq!(d.total, 5);
    assert_eq!(daily(&core, "2026-10-09", "2026-10-14", PRAGUE), [nil(), strs(&[T01]), nil()], "a past note: T01 only, no overdue repeat");
    assert_eq!(daily(&core, "2026-10-15", "2026-10-14", PRAGUE), [nil(), strs(&[T04, T19]), nil()], "15 Oct: T04, T19 (T17's date-time is no due date)");
    assert_eq!(daily(&core, "2026-10-05", "2026-10-14", PRAGUE), [nil(), nil(), strs(&[T11])], "5 Oct: T11 completed that evening");
    assert_eq!(daily(&core, "2026-10-05", "2026-10-14", LA), [nil(), nil(), strs(&[T11])], "5 Oct in Los Angeles: 09:00 the same day");
    assert_eq!(daily(&core, "2026-10-10", "2026-10-14", PRAGUE), [nil(), nil(), nil()], "T13 (Cancelled) is never listed");
    let capped = core.daily_tasks(&window("2026-10-14", PRAGUE), day("2026-10-14"), 3);
    assert_eq!([paths(&capped.overdue), paths(&capped.due), paths(&capped.completed)], [strs(&[T01, T02]), strs(&[T03]), nil()], "the limit caps the three lists in order");
    assert_eq!(capped.total, 5, "total counts all");
}

#[test]
fn fr_dly_04_ac11_tasks_due_is_the_first_matching_section() {
    let sb = sandbox();
    let root = tasks_vault(&sb);
    write_raw(&root, "Tasks/Dnešní.md", format!("---\nid: 01JB5A0000000000000000R005\ntype: task\ntitle: Dnešní\nstatus: To do\ndue: 2026-10-14\ncreated: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n---\n").as_bytes());
    let core = open(&root, &sb);
    let w = window("2026-10-14", PRAGUE);
    let d = core.daily_tasks(&w, day("2026-10-14"), 50);
    let listed: Vec<String> = paths(&d.overdue).into_iter().chain(paths(&d.due)).chain(paths(&d.completed)).collect();
    assert!(listed.contains(&T10.to_string()) && listed.contains(&"Tasks/Dnešní.md".to_string()), "both in Tasks due: {listed:?}");
    let ctx = core.daily_context(&w, 50).sections;
    let modified: Vec<String> = ctx.modified.iter().map(|r| nfc(&r.path)).collect();
    let created: Vec<String> = ctx.created.iter().map(|r| nfc(&r.path)).collect();
    assert!(!modified.contains(&T10.to_string()), "T10 isn't repeated in Modified (D-328): {modified:?}");
    assert!(!created.contains(&"Tasks/Dnešní.md".to_string()), "the new task isn't repeated in Created: {created:?}");
}
