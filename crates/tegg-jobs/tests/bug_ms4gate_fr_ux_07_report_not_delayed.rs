//! Regression test from the MS4 milestone gate (D-749): a job's report waited for its progress heartbeat thread to
//! finish a 200 ms sleep, so every job ended up to 200 ms late (FR-UX-07: the toast says done when the job is done)
//! and the rename property test ran for hours at QA_PROPERTY_SCALE 100. Named `bug_<issue>_<req-id>_…` (CLAUDE.md
//! "Testing"); it failed before the fix.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use tegg_jobs::Phase;
use tegg_vault::MemFs;

fn vault() -> Arc<MemFs> {
    let fs = Arc::new(MemFs::new());
    let fx = repo_root().join("tests/fixtures/vaults/new-empty/.tegg");
    for e in std::fs::read_dir(fx.join("types")).expect("setup: types").flatten() {
        let bytes = std::fs::read(e.path()).expect("setup: type file");
        fs.write_external(&format!(".tegg/types/{}", e.file_name().to_string_lossy()), &bytes).expect("setup");
    }
    fs.write_external(".tegg/vault.yml", &std::fs::read(fx.join("vault.yml")).expect("setup: vault.yml")).expect("setup");
    fs.write_external("Pages/Alfa.md", b"---\ntype: page\ntitle: Alfa\n---\nText.\n").expect("setup");
    fs.write_external("Pages/Odkaz.md", b"---\ntype: page\ntitle: Odkaz\n---\nViz [[Alfa]].\n").expect("setup");
    fs
}

#[test]
fn bug_ms4gate_fr_ux_07_a_small_rename_reports_without_waiting_for_the_heartbeat() {
    let fs = vault();
    let sb = sandbox();
    let core = open_core_with(fs, &sb.dirs).expect("setup: core");
    let mut times = Vec::new();
    let mut title = "Alfa".to_string();
    for i in 0..7 {
        let next = format!("Alfa {i}");
        let path = format!("Pages/{title}.md");
        let t0 = Instant::now();
        let (_, report) = ok!(rename(&core, &path, &next), "rename");
        times.push(t0.elapsed());
        assert_eq!(report.phase, Phase::Done, "rename {i} is done: {report:?}");
        title = next;
    }
    times.sort();
    let median = times[times.len() / 2];
    assert!(median < Duration::from_millis(150), "a two-note rename reports within 150 ms (median {median:?}, all {times:?})");
}
