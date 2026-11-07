//! Slice PIN L4 benchmark: docs/acceptance/pinned.md FR-HOM-02 AC-25 (AP-1237): 200 pins of mixed kinds on the
//! generated 5,000-note vault (`tools/gen-vault --seed 1 --small-images`) are all resolved, in file order, by one
//! `Core::pins` with p95 ≤ 50 ms on the reference machine (report-only until MS8, D-152: the time is printed and only
//! asserted under `TEGG_PERF_STRICT=1`). Interface docs/contracts/v1-pinned.md §1.3. Written from the AC and the contract
//! only (D-61).

mod common;

use std::time::{Duration, Instant};

use common::{indexable_notes, p95, reference_vault_copy, sandbox};
use tegg_core::pinned::PinState;
use tegg_core::{Core, CoreOptions};

#[test]
fn fr_hom_02_ac25_many_pins_one_read() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    let notes = indexable_notes(&root);
    assert!(notes.len() >= 200, "setup: the reference vault has notes");
    let mut lines = vec!["# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.".to_string(), "version: 1".into(), "pins:".into()];
    for i in 0..200 {
        match i % 4 {
            0 | 1 => lines.push(format!("  - path: {}", notes[i * 7 % notes.len()])),
            2 => lines.push(format!("  - tag: štítek-{i}")),
            _ => lines.push(format!("  - type: druh-{i}")),
        }
    }
    std::fs::write(root.join(".tegg/pinned.yml"), lines.join("\n") + "\n").expect("setup: pinned.yml");
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    let p = core.pins();
    assert_eq!(p.rows.len(), 200, "all 200 rows, no cap");
    assert!(p.rows.iter().enumerate().all(|(i, r)| r.index == i), "in file order");
    let objects_ok = p.rows.iter().filter(|r| matches!(r.state, PinState::Ok)).count();
    assert!(objects_ok >= 100, "the 100 object pins resolve ({objects_ok} ok)");
    let mut samples: Vec<Duration> = (0..20).map(|_| { let t = Instant::now(); let _ = core.pins(); t.elapsed() }).collect();
    let p95v = p95(&mut samples);
    println!("FR-HOM-02 AC-25: pins() p95 = {p95v:?} for 200 pins (target 50 ms, report-only until MS8)");
    if std::env::var("TEGG_PERF_STRICT").is_ok() {
        assert!(p95v <= Duration::from_millis(50), "p95 {p95v:?} ≤ 50 ms");
    }
}
