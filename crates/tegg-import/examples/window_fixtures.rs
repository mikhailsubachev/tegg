//! Generates the canned answers of the Import window's fake core (docs/contracts/v1-import-window.md §7.1) into
//! `tests/fixtures/import/window/`:
//!
//! ```sh
//! cargo run -p tegg-import --example window_fixtures -- --out tests/fixtures/import/window
//! ```
//!
//! The conventions are those of `tests/ac_import_window_fixtures.rs` (its header), which regenerates the same files in
//! memory and compares them: the test clock, Europe/Prague and the ids of `testing::env`, each source a temporary copy
//! named after its fixture, `c05+c07` one folder whose space `PKM` holds both fixtures' files, the zip
//! `c01-spaces.zip`, new-vault plans into `Capacities · <space>` with `target.parent` written as `/fake/parent`,
//! existing-vault plans against a copy of `target-existing-vault`, `stamps` left out. The calls are made in the
//! test's order, so the ids the environment hands out agree. The hand-written files of that folder are not touched.
//! Needs the built `@tegg/doc` (`npm run build --prefix packages/doc`).
#[path = "../tests/common/mod.rs"]
#[allow(dead_code, unused_imports, unused_macros)]
mod common;

use std::path::{Path, PathBuf};

use common::*;
use serde_json::Value;
use tegg_import::{Mapping, Target};

struct Generated {
    sb: Sandbox,
    env: tegg_import::ImportEnv,
}
impl Generated {
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
        scan_of(path, &self.env).unwrap_or_else(|e| panic!("scan of {}: {e}", path.display()))
    }
    fn plan_new(&self, scan: &tegg_import::Scan, space: &str) -> Value {
        let parent = self.sb.base.join("Trezory");
        let target = Target::NewVault { parent, name: format!("Capacities · {space}") };
        let plan = plan_of(scan, space, &target, &Mapping::default(), &self.env).unwrap_or_else(|e| panic!("plan {space}: {e}"));
        let mut v = serde_json::to_value(&plan).expect("plan as JSON");
        if let Some(t) = v.get_mut("target").and_then(Value::as_object_mut) {
            t.insert("parent".into(), Value::String("/fake/parent".into()));
        }
        strip(v)
    }
    fn plan_existing(&self, scan: &tegg_import::Scan, space: &str, tag: &str) -> Value {
        let root = self.sb.base.join(tag).join("target-existing-vault");
        copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
        copy_dir(&common::fixtures().join("target-existing-vault"), &root, &[]);
        let core = open_core(&root, &self.sb.dirs).expect("open target-existing-vault");
        let plan = plan_of(scan, space, &Target::Existing(&core), &Mapping::default(), &self.env).unwrap_or_else(|e| panic!("plan {space} existing: {e}"));
        strip(serde_json::to_value(&plan).expect("plan as JSON"))
    }
}
fn strip(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.remove("stamps");
    }
    v
}
fn scan_json(scan: &tegg_import::Scan) -> Value {
    serde_json::to_value(&scan.info).expect("scan as JSON")
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut out: Option<PathBuf> = None;
    while let Some(a) = args.next() {
        if a == "--out" {
            out = args.next().map(PathBuf::from);
        }
    }
    let out = out.unwrap_or_else(|| repo_root().join("tests/fixtures/import/window"));
    std::fs::create_dir_all(&out).expect("the output folder");
    let write = |name: &str, v: &Value| {
        let mut text = serde_json::to_string_pretty(v).expect("JSON");
        text.push('\n');
        std::fs::write(out.join(name), text).unwrap_or_else(|e| panic!("write {name}: {e}"));
        println!("{name}");
    };

    let sb = sandbox();
    let env = env(&sb).expect("the test environment (NodeTransformer)");
    let g = Generated { sb, env };

    let c01 = g.source("c01-spaces", &["c01-spaces"]);
    let c01_scan = g.scan(&c01);
    write("scan-c01-spaces.json", &scan_json(&c01_scan));
    for space in ["PKM", "Work", "IDC"] {
        write(&format!("plan-c01-spaces-{space}-new.json"), &g.plan_new(&c01_scan, space));
    }
    write("plan-c01-spaces-PKM-existing.json", &g.plan_existing(&c01_scan, "PKM", "c01"));
    let zip = zip_dir(&g.sb, &c01);
    write("scan-c01-spaces-zip.json", &scan_json(&g.scan(&zip)));

    for fixture in ["c12-task-dates", "c09-unresolved-links"] {
        let src = g.source(fixture, &[fixture]);
        let scan = g.scan(&src);
        write(&format!("scan-{fixture}.json"), &scan_json(&scan));
        write(&format!("plan-{fixture}-PKM-new.json"), &g.plan_new(&scan, "PKM"));
    }
    let merged = g.source("c05+c07", &["c05-media-objects", "c07-query-shells"]);
    let merged_scan = g.scan(&merged);
    write("scan-c05+c07.json", &scan_json(&merged_scan));
    write("plan-c05+c07-PKM-new.json", &g.plan_new(&merged_scan, "PKM"));
    write("plan-c05+c07-PKM-existing.json", &g.plan_existing(&merged_scan, "PKM", "c05c07"));
}
