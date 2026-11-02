//! MS5 slice 5A-1 AC tests for `tegg-schema` (L4): the Task status `state` and the option ops of
//! docs/contracts/ms5-tasks.md §2.2 (D-471, D-473). FR-TSK-02 AC-1 (shipped states), AC-2 (colour, order, built-ins
//! locked), AC-3 (add with state), AC-4 (change a state), AC-5 (rename of unused labels, `optionUsed`), AC-6 (remove),
//! AC-7 (`needOpen` / `needDone`), AC-9 (absent and unknown states); FR-TSK-03 AC-2 (priority options). The shared
//! corpus tests/fixtures/types/ops-5a.json gives the exact one-line edits (AR-07 AC-5). Written from
//! docs/acceptance/tasks.md and the contract only (D-61). Fixtures are read-only; nothing is written to disk.
//!
//! The usage counts for `optionUsed` go through `tegg_schema::patch_with_usage` (the contract names a new
//! `PatchContext.used` field; adding a field would change the existing AC tests that build `PatchContext` literally, so
//! the stub exposes the counts as a parameter; see the red-commit report, AP-430).

use std::path::PathBuf;

use serde_json::Value;
use tegg_schema::*;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn read(rel: &str) -> String {
    std::fs::read_to_string(repo().join(rel)).unwrap_or_else(|e| panic!("setup: read {rel}: {e}"))
}
fn task_yml() -> String {
    read("tests/fixtures/vaults/new-empty/.tegg/types/task.yml")
}
fn corpus() -> Value {
    serde_json::from_str(&read("tests/fixtures/types/ops-5a.json")).expect("setup: corpus JSON")
}

const SYSTEM: [(&str, &str, &str); 7] = [
    ("page", "Page", "Pages"),
    ("task", "Task", "Tasks"),
    ("quick-note", "Quick Note", "Quick Notes"),
    ("daily-note", "Daily Note", "Daily"),
    ("tag", "Tag", "Tags"),
    ("image", "Image", "Images"),
    ("pdf", "PDF", "PDFs"),
];
fn names() -> Vec<TypeNames<'static>> {
    SYSTEM.iter().map(|(k, n, f)| TypeNames { key: k, name: n, folder: f, is_self: *k == "task" }).collect()
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or_else(|| panic!("setup: corpus field {k} in {v}")).to_string()
}
/// A corpus op as a `TypeOp` (setup; an unknown op is a corpus error).
fn op(v: &Value) -> TypeOp {
    match s(v, "op").as_str() {
        "setOptionState" => TypeOp::SetOptionState { attr: s(v, "attr"), label: s(v, "label"), state: s(v, "state") },
        "setOptionColor" => TypeOp::SetOptionColor { attr: s(v, "attr"), label: s(v, "label"), color: s(v, "color") },
        "moveOption" => TypeOp::MoveOption { attr: s(v, "attr"), label: s(v, "label"), to: v["to"].as_u64().expect("setup: to") as usize },
        "removeOption" => TypeOp::RemoveOption { attr: s(v, "attr"), label: s(v, "label") },
        "renameOption" => TypeOp::RenameOption { attr: s(v, "attr"), from: s(v, "from"), to: s(v, "to") },
        "addOption" => {
            let o = &v["option"];
            let extra = match o.get("state").and_then(Value::as_str) {
                Some(st) => vec![("state".to_string(), Value::String(st.to_string()))],
                None => vec![],
            };
            TypeOp::AddOption { attr: s(v, "attr"), option: OptionDef { label: s(o, "label"), color: o.get("color").and_then(Value::as_str).map(str::to_string), extra } }
        }
        other => panic!("setup: unknown corpus op {other}"),
    }
}
fn reason(e: &SchemaError) -> String {
    match e {
        SchemaError::Rule(RuleError::NeedOpen) => "needOpen".into(),
        SchemaError::Rule(RuleError::NeedDone) => "needDone".into(),
        SchemaError::Rule(RuleError::OptionUsed { label }) => format!("optionUsed:{label}"),
        SchemaError::Rule(RuleError::OptionDuplicate) => "optionDuplicate".into(),
        SchemaError::Rule(RuleError::OptionEmpty) => "optionEmpty".into(),
        other => format!("{other:?}"),
    }
}

/// Runs every corpus case tagged `ac` and returns one message per mismatch (empty = all as specified).
fn run_cases(ac: &str) -> (usize, Vec<String>) {
    let base = task_yml();
    let c = corpus();
    let others = names();
    let mut n = 0;
    let mut bad = Vec::new();
    for case in c["cases"].as_array().expect("setup: cases") {
        if case["ac"].as_str() != Some(ac) {
            continue;
        }
        n += 1;
        let name = s(case, "name");
        let ops: Vec<TypeOp> = case["ops"].as_array().expect("setup: ops").iter().map(op).collect();
        let used_owned: Vec<(String, usize)> = case
            .get("used")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|p| (p[0].as_str().expect("setup").to_string(), p[1].as_u64().expect("setup") as usize)).collect())
            .unwrap_or_default();
        let used: Vec<(&str, usize)> = used_owned.iter().map(|(l, k)| (l.as_str(), *k)).collect();
        let got = patch_with_usage("task", &base, &ops, &PatchContext { others: &others }, &used);
        if let Some(err) = case.get("error").and_then(Value::as_str) {
            let want = match case.get("label").and_then(Value::as_str) {
                Some(l) => format!("{err}:{l}"),
                None => err.to_string(),
            };
            match &got {
                Err(e) if reason(e) == want => {}
                other => bad.push(format!("{name}: want the refusal {want}, nothing written; got {other:?}")),
            }
        } else if case.get("unchanged").and_then(Value::as_bool) == Some(true) {
            if got != Ok(None) {
                bad.push(format!("{name}: want nothing to write; got {got:?}"));
            }
        } else {
            let mut want = base.clone();
            for r in case["replace"].as_array().expect("setup: replace") {
                let (from, to) = (r[0].as_str().expect("setup"), r[1].as_str().expect("setup"));
                want = want.replacen(from, to, 1);
            }
            match &got {
                Ok(Some(t)) if *t == want => {
                    let back = parse("task", t);
                    if back.readability != Readability::Ok {
                        bad.push(format!("{name}: the written file doesn't read back: {:?}", back.readability));
                    }
                }
                other => bad.push(format!("{name}: want exactly the corpus edit\n--- want\n{want}--- got\n{other:?}")),
            }
        }
    }
    (n, bad)
}

fn assert_cases(ac: &str, min: usize) {
    let (n, bad) = run_cases(ac);
    assert!(n >= min, "the corpus has {n} cases for {ac}, expected at least {min}");
    assert!(bad.is_empty(), "{ac}: {} of {n} corpus cases differ:\n{}", bad.len(), bad.join("\n"));
}

// ------------------------------------------------------------------------------------------------ FR-TSK-02

#[test]
fn fr_tsk_02_ac1_shipped_task_statuses_have_the_five_states() {
    let p = parse("task", &task_yml());
    assert_eq!(p.readability, Readability::Ok, "the shipped task.yml reads");
    let st = p.def.attributes.iter().find(|a| a.key == "status").expect("setup: status attribute");
    let labels: Vec<&str> = st.options.iter().map(|o| o.label.as_str()).collect();
    assert_eq!(labels, ["To do", "In progress", "Waiting", "Done", "Cancelled"], "the five statuses in order (D-25)");
    let raw: Vec<Option<&str>> = st.options.iter().map(option_state).collect();
    assert_eq!(raw, [Some("open"), Some("in-progress"), Some("open"), Some("done"), Some("cancelled")], "option_state reads `state` from the option");
    let states: Vec<Option<TaskState>> = raw.iter().map(|r| r.and_then(TaskState::parse)).collect();
    assert_eq!(
        states,
        [Some(TaskState::Open), Some(TaskState::InProgress), Some(TaskState::Open), Some(TaskState::Done), Some(TaskState::Cancelled)],
        "states Open, In progress, Open, Done, Cancelled"
    );
}

#[test]
fn fr_tsk_02_ac2_colour_and_order_change_one_line_each() {
    assert_cases("FR-TSK-02/AC-2", 3);
}

#[test]
fn fr_tsk_02_ac2_status_and_priority_stay_built_in() {
    let base = task_yml();
    let others = names();
    let ctx = PatchContext { others: &others };
    // The option lines are editable (red until the ops exist) …
    let colour = patch("task", &base, &[TypeOp::SetOptionColor { attr: "priority".into(), label: "Low".into(), color: "teal".into() }], &ctx);
    assert_eq!(
        colour,
        Ok(Some(base.replacen("      - { label: Low, color: blue }\n", "      - { label: Low, color: teal }\n", 1))),
        "a priority option's colour is one line"
    );
    // … while removing the properties or changing their type stays refused (FR-TYP-06 AC-2).
    for key in ["status", "priority"] {
        assert_eq!(patch("task", &base, &[TypeOp::RemoveAttribute(key.into())], &ctx), Err(SchemaError::BuiltInChanged), "remove {key}");
        let change = AttrChange { r#type: Some(AttrType::Text), ..Default::default() };
        assert_eq!(patch("task", &base, &[TypeOp::UpdateAttribute { key: key.into(), change }], &ctx), Err(SchemaError::BuiltInChanged), "change the type of {key}");
    }
}

#[test]
fn fr_tsk_02_ac3_add_a_status_with_its_state() {
    assert_cases("FR-TSK-02/AC-3", 2);
}

#[test]
fn fr_tsk_02_ac4_change_the_state_of_a_status() {
    assert_cases("FR-TSK-02/AC-4", 1);
}

#[test]
fn fr_tsk_02_ac5_rename_only_unused_labels() {
    assert_cases("FR-TSK-02/AC-5", 2);
}

#[test]
fn fr_tsk_02_ac6_remove_a_used_status_writes_only_its_line() {
    assert_cases("FR-TSK-02/AC-6", 1);
}

#[test]
fn fr_tsk_02_ac7_keep_one_open_and_one_done_status() {
    assert_cases("FR-TSK-02/AC-7", 5);
}

#[test]
fn fr_tsk_02_ac9_absent_and_unknown_states_are_open() {
    let text = task_yml().replacen(
        "      - { label: Cancelled, state: cancelled, color: red }\n",
        "      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Blokováno, color: red }\n      - { label: Čeká na schválení, state: blocked, color: purple }\n",
        1,
    );
    let p = parse("task", &text);
    assert_eq!(p.readability, Readability::Ok, "the edited task.yml reads (an unknown state is no error)");
    let st = p.def.attributes.iter().find(|a| a.key == "status").expect("setup: status");
    let get = |l: &str| st.options.iter().find(|o| o.label == l).unwrap_or_else(|| panic!("setup: option {l}"));
    assert_eq!(option_state(get("Done")), Some("done"), "a known state is read");
    assert_eq!(option_state(get("Blokováno")), None, "no `state` key");
    assert_eq!(option_state(get("Čeká na schválení")), Some("blocked"), "the raw unknown state is kept for the warning");
    assert_eq!(TaskState::parse("blocked"), None, "an unknown state isn't a TaskState (the caller uses Open, D-471)");
    assert_eq!(TaskState::parse("in-progress"), Some(TaskState::InProgress));
}

// ------------------------------------------------------------------------------------------------ FR-TSK-03

#[test]
fn fr_tsk_03_ac2_priority_options_order_add_remove_rename() {
    assert_cases("FR-TSK-03/AC-2", 5);
}

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-17 (L4)
// D-1357 (v0.113 feedback): the Kanban writes a column move as the `moveOption` of type settings
// (docs/contracts/ms5-tasks.md §14), with `to` in the full `status` list, hidden `Cancelled` included. The op exists
// since FR-TSK-02 AC-2, so these bytes are green before the build; the red part (the Kanban sends it) is L5,
// app/webkit/tasks_kanban_columns.ac.test.ts.

#[test]
fn fr_tsk_05_ac17_column_moves_move_one_status_line() {
    let base = task_yml();
    let others = names();
    let ctx = PatchContext { others: &others };
    let todo = "      - { label: To do, state: open, color: gray }\n";
    let in_progress = "      - { label: In progress, state: in-progress, color: blue }\n";
    let waiting = "      - { label: Waiting, state: open, color: yellow }\n";
    let done = "      - { label: Done, state: done, color: green }\n";
    let cancelled = "      - { label: Cancelled, state: cancelled, color: red }\n";
    let shipped = [todo, in_progress, waiting, done, cancelled].concat();
    assert!(base.contains(&shipped), "setup: the shipped status lines");
    let mv = |text: &str, label: &str, to: usize| patch("task", text, &[TypeOp::MoveOption { attr: "status".into(), label: label.into(), to }], &ctx);
    // `Waiting` dropped before `To do` (index 0).
    let first = base.replacen(&shipped, &[waiting, todo, in_progress, done, cancelled].concat(), 1);
    assert_eq!(mv(&base, "Waiting", 0), Ok(Some(first.clone())), "Waiting before To do moves only the Waiting line");
    // `To do` (index 1) dropped after the last status column `Done` (index 3): 3 + 1 − 1 = 3, before `Cancelled`.
    let second = first.replacen(&[waiting, todo, in_progress, done, cancelled].concat(), &[waiting, in_progress, done, todo, cancelled].concat(), 1);
    assert_eq!(mv(&first, "To do", 3), Ok(Some(second)), "To do just after Done; Cancelled keeps its place");
}
