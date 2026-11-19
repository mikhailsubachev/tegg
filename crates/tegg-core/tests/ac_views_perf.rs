//! Slice Q2 L4 benchmark (docs/acceptance/views.md NFR-PERF-07 AC-3, the core part; docs/contracts/v1-views.md §1.6):
//! on the generated 5,000-note vault (`tools/gen-vault --seed 1 --small-images`), copied, with a runtime type `karta`
//! (`fáze` Select with 5 options) and 500 objects (100, 100, 100, 100, 50 per option, 50 without a value) and the view
//! `Karty` (`view: board`, `group_by: fáze`, `columns: [tags]`): `query_run` with grouping returns its 6 lanes in
//! ≤ 100 ms p95 of 20 runs. Times are printed and asserted in release builds (`common::target`: ×10 in debug builds),
//! the lanes always. Skipped at push by `--skip nfr_perf_` (contract §6.1). Compiles against the stubs of D-1813.
//! Written from the AC and the contract only (D-61).

mod common;
mod views_setup;

use std::time::{Duration, Instant};

use common::{p95, reference_vault_copy, sandbox, target};
use tegg_core::queries_q::QuerySource;
use tegg_core::{Core, CoreOptions};
use views_setup::env;

const OPTS: [&str; 5] = ["Nápad", "Rozpracováno", "Čeká", "Hotovo", "Zrušeno"];

#[test]
fn nfr_perf_07_ac3_board_500_cards_6_lanes() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    std::fs::create_dir_all(root.join(".tegg/types")).expect("setup: types");
    std::fs::create_dir_all(root.join(".tegg/queries")).expect("setup: queries");
    std::fs::create_dir_all(root.join("Karty")).expect("setup: Karty");
    let mut t = String::from("# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Karta\nplural: Karty\nsystem: false\nfolder: Karty\nicon: file\ncolor: gray\nreview: false\npreview: [fáze]\nviews: [Karty]\nattributes:\n  - key: fáze\n    name: Fáze\n    type: select\n    options:\n");
    for o in OPTS {
        t.push_str(&format!("      - {{ label: {o}, color: gray }}\n"));
    }
    std::fs::write(root.join(".tegg/types/karta.yml"), t).expect("setup: karta.yml");
    std::fs::write(root.join(".tegg/queries/Karty.yml"), "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Karty.\nversion: 1\ntitle: Karty\ntypes: [karta]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: board\ngroup_by: fáze\nlanes: vertical\ncolumns: [tags]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n").expect("setup: Karty.yml");
    for i in 0..500 {
        let o = if i < 400 { Some(OPTS[i / 100]) } else if i < 450 { Some(OPTS[4]) } else { None };
        let f = o.map(|o| format!("fáze: {o}\n")).unwrap_or_default();
        std::fs::write(root.join(format!("Karty/Karta {i:03}.md")), format!("---\ntype: karta\ntitle: Karta {i:03}\n{f}tags: [štítek{}]\n---\nKarta číslo {i:03}.\n", i % 7)).expect("setup: card");
    }
    let core = match Core::open(&root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open: {e:?}"),
    };
    let _ = core.wait_idle(Duration::from_secs(600));
    let mut samples = Vec::new();
    let mut counts: Vec<usize> = Vec::new();
    for _ in 0..20 {
        let t0 = Instant::now();
        let r = core.query_run(QuerySource::Saved("Karty".into()), None, &env());
        samples.push(t0.elapsed());
        counts = r.group.map(|g| g.lanes.iter().map(|l| l.cards.len()).collect()).unwrap_or_default();
    }
    assert_eq!(counts, vec![100, 100, 100, 100, 50, 50], "6 lanes: 100, 100, 100, 100, 50 and 50 without a value");
    let p = p95(&mut samples);
    println!("NFR-PERF-07 AC-3: query_run with grouping, 500 cards, p95 = {p:?} (target 100 ms)");
    assert!(p <= target(Duration::from_millis(100), 1.0), "p95 {p:?}");
}
