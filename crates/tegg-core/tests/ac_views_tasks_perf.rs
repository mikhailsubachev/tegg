//! Slice Q2-T L4 benchmark (docs/acceptance/views.md NFR-PERF-07 AC-5, the core part; docs/contracts/v1-views.md §24.4,
//! §31.2): on the generated reference vault (`tools/gen-vault --seed 1 --small-images`, ≈ 750 tasks), copied, with R202's
//! `Schedule.yml` and `Kanban.yml`: `query_run` with period grouping and `done_lane` (Schedule) and with the status
//! grouping and `done_lane` (Kanban) each returns in ≤ 100 ms p95 of 20 runs. Times are printed and asserted in release
//! builds (`common::target`: ×10 in debug builds); the lanes always. Skipped at push by `--skip nfr_perf_` (contract
//! §6.1); report-only until the v1.0 release gate (D-1800). A new file rather than an addition to `ac_views_perf.rs`, so
//! no existing AC test file changes (TS-I3). Written from the AC and the contract only (D-61).

mod common;
mod views_setup;
mod views_tasks_setup;

use std::time::{Duration, Instant};

use common::{p95, reference_vault_copy, sandbox, target};
use tegg_core::queries_q::QuerySource;
use tegg_core::{Core, CoreOptions};
use views_tasks_setup::{env, exp, KANBAN, SCHEDULE};

#[test]
fn nfr_perf_07_ac5_tasks_boards() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    std::fs::create_dir_all(root.join(".tegg/queries")).expect("setup: queries");
    std::fs::write(root.join(SCHEDULE), exp("queries/schedule-default.yml")).expect("setup: Schedule.yml");
    std::fs::write(root.join(KANBAN), exp("queries/kanban-default.yml")).expect("setup: Kanban.yml");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    for (name, first) in [("Schedule", "period:today"), ("Kanban", "option:To do")] {
        let mut samples = Vec::new();
        let mut ids: Vec<String> = Vec::new();
        let mut cards = 0usize;
        for _ in 0..20 {
            let t0 = Instant::now();
            let r = core.query_run(QuerySource::Saved(name.into()), None, &env());
            samples.push(t0.elapsed());
            ids = r.group.as_ref().map(|g| g.lanes.iter().map(|l| l.id.clone()).collect()).unwrap_or_default();
            cards = r.group.as_ref().map(|g| g.lanes.iter().map(|l| l.cards.len()).sum()).unwrap_or(0);
        }
        assert_eq!(ids.first().map(String::as_str), Some(first), "{name}: a board with its lanes ({ids:?})");
        assert!(cards > 0, "{name}: cards on the board");
        let p = p95(&mut samples);
        println!("NFR-PERF-07 AC-5: query_run {name}, {cards} cards, p95 = {p:?} (target 100 ms)");
        assert!(p <= target(Duration::from_millis(100), 1.0), "{name}: p95 {p:?}");
    }
}
