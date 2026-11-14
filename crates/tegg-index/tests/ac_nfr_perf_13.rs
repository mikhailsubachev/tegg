//! Slice REL L4 benchmark (nightly `core-perf-ac`, skipped by the push step's `--skip nfr_perf_`):
//! docs/acceptance/related.md NFR-PERF-13 AC-1, docs/contracts/v1-related.md §1.13. On the 20,000-note generated vault it
//! times `Index::related(path, false, &RelatedParams::default(), &[], &by_code_point)` for 25 objects (20 chosen by seed 1
//! among those with ≥ 5 distinct stems, plus the 5 with the most), 20 runs each, and prints p95 overall and for the 5
//! largest. The 75 ms target (75 % of 100 ms, D-59) is asserted only when `VERIFY_GATE=release` (report-only before the
//! v1.0 release gate, as D-940). Written from the ACs and the contract only (D-61).

mod support;
#[path = "support/perf20k.rs"]
mod perf20k;

use std::time::{Duration, Instant};

use tegg_index::related::by_code_point;
use tegg_index::{Index, RelatedParams};

fn p95(v: &mut [Duration]) -> Duration {
    v.sort();
    let i = ((v.len() as f64) * 0.95).ceil() as usize;
    v[i.saturating_sub(1).min(v.len() - 1)]
}

#[test]
fn nfr_perf_13_ac1_related_list_under_target() {
    let root = perf20k::headroom_vault_20k();
    let tmp = tempfile::tempdir().expect("setup: tempdir");
    let idx: Index = support::index_at(&root, tmp.path());
    let mut objs: Vec<(String, usize)> = Vec::new();
    for (rel, _) in support::files(&root) {
        if !tegg_index::is_indexable(&rel) {
            continue;
        }
        if let Some(t) = idx.rel_terms(&tegg_format::nfc(&rel)) {
            let n = t.title.iter().chain(&t.body).collect::<std::collections::BTreeSet<_>>().len();
            objs.push((tegg_format::nfc(&rel), n));
        }
    }
    assert!(objs.len() >= 20_000, "every generated note has a rel row ({} found)", objs.len());
    let eligible: Vec<&(String, usize)> = objs.iter().filter(|o| o.1 >= 5).collect();
    assert!(eligible.len() >= 25, "at least 25 objects with ≥ 5 distinct stems");
    let mut seed: u64 = 1;
    let mut chosen: Vec<String> = Vec::new();
    while chosen.len() < 20 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let p = &eligible[(seed % eligible.len() as u64) as usize].0;
        if !chosen.contains(p) {
            chosen.push(p.clone());
        }
    }
    let mut by_size = objs.clone();
    by_size.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let largest: Vec<String> = by_size.iter().take(5).map(|o| o.0.clone()).collect();
    let p = RelatedParams::default();
    let mut all = Vec::new();
    let mut big = Vec::new();
    for path in chosen.iter().chain(largest.iter()) {
        for _ in 0..20 {
            let t0 = Instant::now();
            let l = idx.related(path, false, &p, &[], &by_code_point);
            let dt = t0.elapsed();
            assert!(l.is_some(), "{path}: index_related answers");
            all.push(dt);
            if largest.contains(path) {
                big.push(dt);
            }
        }
    }
    let (pa, pb) = (p95(&mut all), p95(&mut big));
    println!("NFR-PERF-13 AC-1: p95 {:.2} ms over 25 objects × 20 runs; the 5 largest: p95 {:.2} ms", pa.as_secs_f64() * 1e3, pb.as_secs_f64() * 1e3);
    if std::env::var("VERIFY_GATE").as_deref() == Ok("release") {
        assert!(pa < Duration::from_millis(75), "p95 {:?} is under 75 ms (D-59)", pa);
    }
}
