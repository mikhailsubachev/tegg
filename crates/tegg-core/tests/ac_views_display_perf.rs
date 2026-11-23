//! Slice Q3 L4 guard (docs/acceptance/views.md NFR-PERF-07 AC-7, the core part; docs/contracts/v1-views.md §44): on the
//! generated reference vault (`tools/gen-vault --seed 1 --small-images`), copied, a runtime query `Zeď` (`view: wall`,
//! no `group_by`, `sort: { by: title, order: asc }`) over the type with the most objects (read from the index,
//! `Core::type_counts`): `query_run` of `Zeď` (the run a tab without own values makes) returns every row with its card
//! data (an ungrouped wall run, §34.4) and no grouping; the p95 of 20 runs is printed with the row count. Report-only
//! until the v1.0 release gate (D-1800, D-2185): the time is asserted only in release builds against the whole
//! 225 ms budget (`common::target`, ×10 in debug), the shape always. Skipped at push by `--skip nfr_perf_`; the nightly
//! `core-perf-ac` step runs it (contract §43.2). Written from the AC and the contract only (D-61).

mod common;
mod views_setup;

use std::time::{Duration, Instant};

use common::{p95, reference_vault_copy, sandbox, target};
use tegg_core::queries_q::{QuerySource, View};
use tegg_core::{Core, CoreOptions};
use views_setup::env;

#[test]
fn nfr_perf_07_ac7_ungrouped_wall_largest_type() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    let counts = core.type_counts();
    let (key, count) = counts.iter().max_by_key(|(_, n)| **n).map(|(k, n)| (k.clone(), *n)).unwrap_or_else(|| panic!("setup: no types"));
    std::fs::create_dir_all(root.join(".tegg/queries")).expect("setup: queries");
    std::fs::write(
        root.join(".tegg/queries/Zeď.yml"),
        format!("# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Zeď.\nversion: 1\ntitle: Zeď\ntypes: [{key}]\nmatch: all\nfilters: []\nsort: {{ by: title, order: asc }}\nlimit: 50\nview: wall\ncreated: 2026-11-19T10:00:00+01:00\nmodified: 2026-11-19T10:00:00+01:00\n"),
    )
    .expect("setup: Zeď.yml");
    core.notify_changed(&[".tegg/queries/Zeď.yml".to_string()]);
    let _ = core.wait_idle(Duration::from_secs(60));
    let mut samples = Vec::new();
    let mut rows = 0usize;
    let mut cards = 0usize;
    let mut shape = (None, true);
    for _ in 0..20 {
        let t0 = Instant::now();
        let r = core.query_run(QuerySource::Saved("Zeď".into()), None, &env());
        samples.push(t0.elapsed());
        rows = r.rows.len();
        cards = r.rows.iter().filter(|x| x.card.is_some()).count();
        shape = (r.def.as_ref().map(|d| d.view), r.group.is_some());
    }
    let p = p95(&mut samples);
    println!("NFR-PERF-07 AC-7: query_run of the wall over `{key}` ({count} objects in the index), {rows} rows, p95 = {p:?} (budget 225 ms)");
    assert_eq!(shape, (Some(View::Wall), false), "an ungrouped wall");
    assert_eq!((rows, cards), (count, count), "every object of the type is a row with its card data (no limit on a wall)");
    assert!(p <= target(Duration::from_millis(225), 1.0), "p95 {p:?}");
}
