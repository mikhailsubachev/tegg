//! The canned answers of the Import window's fake core (docs/contracts/v1-import-window.md §7.1) follow the engine.
//! No AC key (§9.1, "L4 (fixture check)"): it guards the L5 tests' data, so a DTO change in the engine fails the gate.
//!
//! - **Generated** files (`examples/window_fixtures.rs` writes them; the implementer adds that generator and runs it):
//!   this test makes the same scans and plans in memory with the engine and compares them with the committed JSON.
//!   The conventions it uses (and the generator must use; the contract leaves them open, see the red-test report):
//!   the test clock, Europe/Prague and ids of `testing::env` (`common::env`); every source is a temporary copy named
//!   after its fixture (`ScanInfo.name` = `c01-spaces`); `c05+c07` is one folder `c05+c07` whose space `PKM` holds the
//!   files of both fixtures' `PKM`; the zipped `c01-spaces` is `c01-spaces.zip` (its `size` is not compared: it depends
//!   on the zip writer); a new-vault plan targets `Capacities · <space>` and its `target.parent` is written as
//!   `/fake/parent`; an existing-vault plan targets a copy of `target-existing-vault` with `new-empty/.tegg` (folder
//!   name `target-existing-vault`); `stamps` is left out. File names: `scan-<fixture>.json`, `scan-c01-spaces-zip.json`,
//!   `plan-<fixture>-<space>-<new|existing>.json`.
//! - **Hand-written** files (committed with the red tests): each deserializes as the engine's `ScanInfo` / `Plan`, its
//!   `totals` agree with its lists (v1-import §5.1), and the Where answer `where-osobni.json` and the plan used with it
//!   (`plan-board.json`) carry the same `alreadyImported` (§7.1, §3.9).
//!
//! Written from the contracts only (D-61). One test, so the file is red until the generated files exist.
mod common;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use common::*;
use serde_json::Value;
use tegg_import::{Mapping, Plan, ScanInfo, Target};

fn window_dir() -> PathBuf {
    repo_root().join("tests/fixtures/import/window")
}
/// The committed file as JSON; an assertion (not a setup panic) when it is missing or isn't JSON.
fn committed(name: &str) -> Value {
    let p = window_dir().join(name);
    assert!(p.is_file(), "tests/fixtures/import/window/{name} is committed (v1-import-window §7.1)");
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    let v: Result<Value, _> = serde_json::from_str(&text);
    assert!(v.is_ok(), "{name} is JSON: {:?}", v.as_ref().err());
    v.unwrap_or(Value::Null)
}
/// The first JSON pointer where `a` and `b` differ (None: equal).
fn first_diff(a: &Value, b: &Value, at: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let keys: BTreeSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter().find_map(|k| match (x.get(k), y.get(k)) {
                (Some(p), Some(q)) => first_diff(p, q, &format!("{at}/{k}")),
                _ => Some(format!("{at}/{k} (present on one side only)")),
            })
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{at} (length {} vs {})", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| first_diff(p, q, &format!("{at}/{i}")))
        }
        _ => (a != b).then(|| format!("{at}: {a} vs {b}")),
    }
}
fn as_u64(v: &Value, ptr: &str) -> u64 {
    v.pointer(ptr).and_then(Value::as_u64).unwrap_or(u64::MAX)
}

/// v1-import §5.1's totals, recomputed from the plan's lists.
fn check_totals(name: &str, plan: &Plan) {
    let objects: Vec<_> = plan.objects.iter().filter(|o| o.kind != tegg_import::ObjectKind::OrphanMedia).collect();
    let imported = objects.iter().filter(|o| o.outcome == tegg_import::ObjectOutcome::Imported).count();
    assert_eq!((plan.totals.objects.total, plan.totals.objects.imported, plan.totals.objects.reported), (objects.len(), imported, objects.len() - imported), "{name}: totals.objects");
    let att_imp = plan.attachments.iter().filter(|a| a.outcome == tegg_import::AttachmentOutcome::Imported).count();
    assert_eq!((plan.totals.attachments.total, plan.totals.attachments.imported, plan.totals.attachments.reported), (plan.attachments.len(), att_imp, plan.attachments.len() - att_imp), "{name}: totals.attachments");
    let link_imp = plan.links.iter().filter(|l| l.outcome.imported()).count();
    assert_eq!((plan.totals.links.total, plan.totals.links.imported, plan.totals.links.reported), (plan.links.len(), link_imp, plan.links.len() - link_imp), "{name}: totals.links");
    assert_eq!((plan.totals.other_files.total, plan.totals.other_files.imported, plan.totals.other_files.reported), (plan.other_files.len(), 0, plan.other_files.len()), "{name}: totals.otherFiles");
    assert_eq!(plan.report.summary.objects, plan.totals.objects, "{name}: report.summary.objects = totals.objects");
    let per_type: usize = plan.types.iter().map(|t| t.objects).sum();
    assert_eq!(per_type, objects.len(), "{name}: the types' counts add up to the objects");
}

/// The engine's answers, generated as `examples/window_fixtures.rs` must generate them (conventions: the file header).
struct Generated {
    sb: Sandbox,
    env: tegg_import::ImportEnv,
}
impl Generated {
    fn new() -> Generated {
        let sb = sandbox();
        let env = ok!(env(&sb), "the test environment (NodeTransformer)");
        Generated { sb, env }
    }
    /// A copy of the fixtures' files in one folder named `name` (`c05+c07` merges both).
    fn source(&self, name: &str, fixtures: &[&str]) -> PathBuf {
        let to = self.sb.base.join("zdroj").join(name);
        if !to.exists() {
            for f in fixtures {
                copy_dir(&common::fixtures().join(f), &to, &[]);
            }
        }
        to
    }
    fn scan(&self, path: &Path) -> tegg_import::Scan {
        ok!(scan_of(path, &self.env), format!("scan of {}", path.display()))
    }
    fn plan_new(&self, scan: &tegg_import::Scan, space: &str) -> Value {
        let parent = self.sb.base.join("Trezory");
        let target = Target::NewVault { parent, name: format!("Capacities · {space}") };
        let plan = ok!(plan_of(scan, space, &target, &Mapping::default(), &self.env), format!("plan {space} into a new vault"));
        let mut v = serde_json::to_value(&plan).unwrap_or(Value::Null);
        if let Some(t) = v.get_mut("target").and_then(Value::as_object_mut) {
            t.insert("parent".into(), Value::String("/fake/parent".into()));
        }
        strip(v)
    }
    fn plan_existing(&self, scan: &tegg_import::Scan, space: &str, tag: &str) -> Value {
        let root = self.sb.base.join(tag).join("target-existing-vault");
        copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
        copy_dir(&common::fixtures().join("target-existing-vault"), &root, &[]);
        let core = ok!(open_core(&root, &self.sb.dirs), "open target-existing-vault");
        let plan = ok!(plan_of(scan, space, &Target::Existing(&core), &Mapping::default(), &self.env), format!("plan {space} into target-existing-vault"));
        strip(serde_json::to_value(&plan).unwrap_or(Value::Null))
    }
}
fn strip(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.remove("stamps");
    }
    v
}
fn scan_json(scan: &tegg_import::Scan) -> Value {
    serde_json::to_value(&scan.info).unwrap_or(Value::Null)
}
fn same(name: &str, generated: &Value) {
    let c = committed(name);
    let d = first_diff(&c, generated, "");
    assert!(d.is_none(), "{name} differs from the engine's answer at {}", d.unwrap_or_default());
}

#[test]
fn window_fixtures_follow_the_engine() {
    // ---------------------------------------------------------------- hand-written
    for name in ["plan-board.json", "plan-decisions.json"] {
        let v = committed(name);
        assert!(v.get("stamps").is_none(), "{name}: `stamps` is left out");
        let plan: Result<Plan, _> = serde_json::from_value(v);
        assert!(plan.is_ok(), "{name} deserializes as the engine's Plan: {:?}", plan.as_ref().err());
        let plan = plan.unwrap();
        check_totals(name, &plan);
        let back = serde_json::to_value(&plan).unwrap_or(Value::Null);
        let d = first_diff(&committed(name), &strip(back), "");
        assert!(d.is_none(), "{name} is in the engine's serde form (round trip): {}", d.unwrap_or_default());
    }
    for name in ["scan-board.json", "scan-decisions.json", "scan-unreadable.json"] {
        let s: Result<ScanInfo, _> = serde_json::from_value(committed(name));
        assert!(s.is_ok(), "{name} deserializes as the engine's ScanInfo: {:?}", s.as_ref().err());
    }
    let board = committed("plan-board.json");
    let decisions = committed("plan-decisions.json");
    let unreadable = committed("scan-unreadable.json");
    assert_eq!(committed("scan-board.json"), board["source"], "scan-board.json is plan-board.json's source");
    assert_eq!(committed("scan-decisions.json"), decisions["source"], "scan-decisions.json is plan-decisions.json's source");
    assert!(unreadable["unreadable"].as_array().is_some_and(|a| !a.is_empty()), "scan-unreadable.json has unreadable entries");
    // FR-IMP-10 AC-13's plan: 3 case-only links, 2 ambiguous, no tag-like attribute.
    assert_eq!(
        (decisions["decisions"]["caseLinks"].as_array().map(Vec::len), decisions["decisions"]["ambiguous"].as_array().map(Vec::len), decisions["decisions"]["tagLike"].as_array().map(Vec::len)),
        (Some(3), Some(2), Some(0)),
        "plan-decisions.json: 3 caseLinks, 2 ambiguous, 0 tagLike"
    );
    // The repeat count agrees (§7.1, §3.9): where-osobni.json (38) goes with plan-board.json.
    let where_ = committed("where-osobni.json");
    assert_eq!(as_u64(&where_, "/current/alreadyImported"), 38, "where-osobni.json: current.alreadyImported = 38");
    assert_eq!(as_u64(&where_, "/current/notes"), 1180, "where-osobni.json: current.notes = 1180");
    assert_eq!(where_.pointer("/current/name").and_then(Value::as_str), Some("Osobní"), "where-osobni.json: the open vault is Osobní");
    assert_eq!(as_u64(&board, "/alreadyImported"), as_u64(&where_, "/current/alreadyImported"), "plan-board.json and where-osobni.json carry the same alreadyImported");
    assert_eq!(board.pointer("/target/kind").and_then(Value::as_str), Some("existing"), "plan-board.json targets the open vault");
    assert_eq!(as_u64(&board, "/target/notes"), 1180, "plan-board.json: the vault's 1,180 notes");

    // ---------------------------------------------------------------- generated (examples/window_fixtures.rs)
    let g = Generated::new();
    let c01 = g.source("c01-spaces", &["c01-spaces"]);
    let c01_scan = g.scan(&c01);
    same("scan-c01-spaces.json", &scan_json(&c01_scan));
    for space in ["PKM", "Work", "IDC"] {
        same(&format!("plan-c01-spaces-{space}-new.json"), &g.plan_new(&c01_scan, space));
    }
    let c01_existing = g.plan_existing(&c01_scan, "PKM", "c01");
    assert_eq!(as_u64(&c01_existing, "/alreadyImported"), 1, "c01-spaces PKM against target-existing-vault: alreadyImported 1 (the fake's default where, §7.1)");
    same("plan-c01-spaces-PKM-existing.json", &c01_existing);
    // The zip: the same scan as the folder, `kind: zip` and a size (not compared byte for byte).
    let zip = zip_dir(&g.sb, &c01);
    let mut zip_scan = scan_json(&g.scan(&zip));
    let mut zipped = committed("scan-c01-spaces-zip.json");
    assert_eq!(zipped["kind"], Value::String("zip".into()), "scan-c01-spaces-zip.json: kind zip");
    assert!(zipped["size"].as_u64().is_some_and(|n| n > 0), "scan-c01-spaces-zip.json: the zip's size");
    for v in [&mut zip_scan, &mut zipped] {
        if let Some(o) = v.as_object_mut() {
            o.insert("size".into(), Value::Null);
        }
    }
    let d = first_diff(&zipped, &zip_scan, "");
    assert!(d.is_none(), "scan-c01-spaces-zip.json differs from the engine's answer at {}", d.unwrap_or_default());

    for fixture in ["c12-task-dates", "c09-unresolved-links"] {
        let src = g.source(fixture, &[fixture]);
        let scan = g.scan(&src);
        same(&format!("scan-{fixture}.json"), &scan_json(&scan));
        same(&format!("plan-{fixture}-PKM-new.json"), &g.plan_new(&scan, "PKM"));
    }
    let merged = g.source("c05+c07", &["c05-media-objects", "c07-query-shells"]);
    let merged_scan = g.scan(&merged);
    same("scan-c05+c07.json", &scan_json(&merged_scan));
    same("plan-c05+c07-PKM-new.json", &g.plan_new(&merged_scan, "PKM"));
    let merged_existing = g.plan_existing(&merged_scan, "PKM", "c05c07");
    same("plan-c05+c07-PKM-existing.json", &merged_existing);
    // FR-IMP-21 AC-5's tag-like attribute is in c09's plan.
    let c09 = committed("plan-c09-unresolved-links-PKM-new.json");
    assert_eq!(c09.pointer("/decisions/tagLike/0/sourceKey").and_then(Value::as_str), Some("status"), "c09: the tag-like Trip.status");
}
