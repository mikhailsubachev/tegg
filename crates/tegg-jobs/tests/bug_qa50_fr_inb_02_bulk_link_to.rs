//! QA review of PR #50 (FR-INB-02 AC-8, AC-12; D-573): a bulk `Link to…` is one `inbox` job carrying the target's vault
//! path; each file gets the D-184 text of the target from its own folder. Bytes from the real `@tegg/doc` transformer.

#[macro_use]
mod common;

use std::collections::BTreeSet;
use std::path::PathBuf;

use common::*;
use tegg_jobs::{InboxJobChange, JobOp, Phase};

const NOW: &str = "2026-10-14T12:00:00+02:00";
const Q1: &str = "Quick Notes/Koupit mléko.md";
const P1: &str = "Pages/Zachycená stránka.md";
const DP: &str = "Pages/Dvojník.md";

fn inbox_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Doručené");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("inbox"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}

#[test]
fn bug_qa50_fr_inb_02_bulk_link_to_writes_the_d184_text_per_folder() {
    let sb = sandbox();
    let root = inbox_vault(&sb);
    let core = ok!(open_core(&root, &sb.dirs, false), "open");
    let before = snapshot(&root);
    let change = InboxJobChange::AppendLinkTo { path: DP.into(), title: "Dvojník".into(), now: NOW.into() };
    let (_, report) = ok!(run_job(&core, JobOp::Inbox { paths: vec![Q1.into(), P1.into()], change }), "inbox job");
    assert_eq!(report.phase, Phase::Done, "{report:?}");
    let want: BTreeSet<String> = [Q1, P1].iter().map(|s| s.to_string()).collect();
    assert_eq!(changed(&before, &snapshot(&root)), want, "exactly the two items");
    let q1 = read_text(&root, Q1).unwrap_or_default();
    let p1 = read_text(&root, P1).unwrap_or_default();
    assert!(q1.ends_with("\n\n[[Pages/Dvojník|Dvojník]]\n"), "from Quick Notes/ the stem is DQ, so the path form:\n{q1}");
    assert!(p1.ends_with("\n\n[[Dvojník]]\n"), "from Pages/ the stem resolves to DP:\n{p1}");
    assert!(q1.contains(&format!("modified: {NOW}")) && p1.contains(&format!("modified: {NOW}")), "modified set");
}
