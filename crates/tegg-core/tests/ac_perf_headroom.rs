//! NFR-PERF-03 AC-2 (docs/acceptance/performance.md): the quick switcher keeps < 100 ms per keystroke on a
//! 20,000-note generated vault. Headroom check, reported, not a release blocker. Same keystroke pattern and
//! targets as AC-1 (contract §4: release = BRD × 0.75, debug = BRD × 10).

mod common;

use std::path::Path;
use std::time::{Duration, Instant};

use common::*;
use tegg_core::{Core, CoreOptions};
use tegg_vault::AppDirs;

fn open_idle(root: &Path, dirs: &AppDirs) -> Core {
    let core = match Core::open(root, dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => {
            assert!(false, "Core::open failed: {e:?}");
            unreachable!()
        }
    };
    let _rx = core.events();
    assert!(core.wait_idle(Duration::from_secs(1200)), "indexing did not finish");
    core
}

#[test]
fn nfr_perf_03_ac2_switcher_headroom_on_20000_notes() {
    let vault = headroom_vault_20k();
    let notes = indexable_notes(&vault).len();
    assert!(notes >= 20_000, "vault has {notes} notes");
    let sb = sandbox();
    let t0 = Instant::now();
    let core = open_idle(&vault, &sb.dirs);
    println!("NFR-PERF-03 AC-2 index of {notes} notes: {:.1} s", t0.elapsed().as_secs_f64());
    assert!(!core.switcher("c", 50).is_empty(), "positive control");
    let limit = target(Duration::from_millis(100), 0.75);
    let queries = ["c", "ct", "cteni", "rozpočet 2026", "zzzzzzzzzz"];
    let mut lat = Vec::new();
    for _ in 0..20 {
        for q in queries {
            let chars: Vec<char> = q.chars().collect();
            for n in 1..=chars.len() {
                let typed: String = chars[..n].iter().collect();
                let t = Instant::now();
                let _ = core.switcher(&typed, 50);
                lat.push(t.elapsed());
            }
        }
    }
    let p = p95(&mut lat);
    println!(
        "NFR-PERF-03 AC-2 switcher p95 (20,000 notes): {:.1} ms (limit {:.1} ms, {})",
        p.as_secs_f64() * 1e3,
        limit.as_secs_f64() * 1e3,
        if cfg!(debug_assertions) { "debug" } else { "release" }
    );
    assert!(p < limit, "p95 {p:?}");
}
