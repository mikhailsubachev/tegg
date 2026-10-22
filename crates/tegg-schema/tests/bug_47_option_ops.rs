//! PR #47 QA review (minors) on the 5A-1 option ops (docs/contracts/ms5-tasks.md §2.2, D-473, AR-07 AC-5).
//! 1. MoveOption with a comment line between options moves the option's line only; the comment stays above the option
//!    it precedes.
//! 2. needOpen / needDone refuse only a change that removes the last Open / Done status: a task.yml that never had a
//!    Done-state status (hand-written, no `state:` keys) still accepts other changes.

use tegg_schema::{patch, PatchContext, RuleError, SchemaError, TypeOp};

const WITH_COMMENT: &str = "version: 1\nname: Task\nplural: Tasks\nsystem: true\nfolder: Tasks\nattributes:\n  - key: status\n    name: Status\n    type: select\n    options:\n      - { label: To do, state: open, color: gray }\n      # zvláštní stav\n      - { label: Done, state: done, color: green }\n  - key: priority\n    name: Priority\n    type: select\n    options:\n      - { label: High, color: red }\n      - { label: Low, color: blue }\n";

#[test]
fn bug_47_fr_tsk_02_move_option_keeps_a_comment_in_place() {
    let out = patch("task", WITH_COMMENT, &[TypeOp::MoveOption { attr: "status".into(), label: "To do".into(), to: 1 }], &PatchContext { others: &[] });
    let want = WITH_COMMENT.replacen(
        "      - { label: To do, state: open, color: gray }\n      # zvláštní stav\n      - { label: Done, state: done, color: green }\n",
        "      # zvláštní stav\n      - { label: Done, state: done, color: green }\n      - { label: To do, state: open, color: gray }\n",
        1,
    );
    assert_eq!(out, Ok(Some(want)), "the option moves; the comment stays with the option it precedes (Done)");
}

const NO_STATES: &str = "version: 1\nname: Task\nplural: Tasks\nsystem: true\nfolder: Tasks\nattributes:\n  - key: status\n    name: Status\n    type: select\n    options:\n      - { label: Nové, color: gray }\n      - { label: Hotové, color: green }\n  - key: priority\n    name: Priority\n    type: select\n    options:\n      - { label: High, color: red }\n      - { label: Low, color: blue }\n";

#[test]
fn bug_47_fr_tsk_02_a_file_without_done_states_accepts_other_changes() {
    let ctx = PatchContext { others: &[] };
    let out = patch("task", NO_STATES, &[TypeOp::SetOptionColor { attr: "priority".into(), label: "Low".into(), color: "teal".into() }], &ctx);
    assert_eq!(out, Ok(Some(NO_STATES.replacen("{ label: Low, color: blue }", "{ label: Low, color: teal }", 1))), "a priority colour is written (D-471: no Done state was there to lose)");
    let gone = patch("task", WITH_COMMENT, &[TypeOp::RemoveOption { attr: "status".into(), label: "Done".into() }], &ctx);
    assert_eq!(gone, Err(SchemaError::Rule(RuleError::NeedDone)), "removing the last Done status is still refused");
}
