//! Slice G2 L4 test of the panel's totals (docs/acceptance/graph-panel.md FR-GRP-01 AC-32, R116; D-912, D-1033;
//! docs/contracts/v1-graph.md §15.1): with the panel's request (`cap: 60`, `show_all: false`), `total` and the per-depth
//! `depth_totals` (D-999) around the hub's centres are the fixture README's "Panel (G2)" numbers, so the panel can choose
//! between the graph, Too many and the lower-depth offer from one answer; at or under 60 the whole walk is kept. The
//! vault is a temporary copy of tests/fixtures/vaults/graph with the hub (its README), indexed through `Index::upsert`.
//! Written from the ACs and the contract only (D-61); every check is an assertion in this file (tools/qa CONTRACT §5.2).
//!
//! Red-test point AP-894: G2 adds no Rust code and G1 already returns `depth_totals`, so this file can pass on the red
//! commit; it is committed with `Red-First-Exempt` (see the red-test report) or with the build.

mod support;

use support::hub::{paprsek, uzel, ROZCESTNIK, SIROKY};
use support::*;
use tegg_index::{GraphRequest, GraphResult};

fn panel_req(centre: &str, depth: u8) -> GraphRequest {
    GraphRequest { cap: 60, show_all: false, ..req(centre, depth) }
}
fn run60(idx: &tegg_index::Index, centre: &str, depth: u8) -> GraphResult {
    match idx.graph_neighbourhood(&panel_req(centre, depth), &flag()) {
        Ok(r) => r,
        Err(e) => {
            assert!(false, "{centre} at depth {depth} answered {e:?}");
            unreachable!()
        }
    }
}

#[test]
fn fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer_totals() {
    let v = hub_vault();
    let idx = index(&v);
    let cases: Vec<(String, u8, Vec<usize>)> = vec![
        (ROZCESTNIK.to_string(), 3, vec![41, 161, 1361]),
        (uzel(1, 'a'), 3, vec![17, 21, 231]),
        (paprsek(1), 3, vec![5, 74, 192]),
        (SIROKY.to_string(), 2, vec![161, 241]),
    ];
    for (centre, depth, totals) in cases {
        let r = run60(&idx, &centre, depth);
        assert_eq!(r.depth_totals, totals, "{centre}: depth_totals at depth {depth} (fixture README, Panel (G2))");
        assert_eq!(r.total, *totals.last().unwrap_or(&0), "{centre}: total = the last depth's total");
    }
}

#[test]
fn fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer_whole_walk_under_sixty() {
    let v = hub_vault();
    let idx = index(&v);
    for (centre, depth, n, e) in [(ROZCESTNIK.to_string(), 1u8, 41usize, 40usize), (uzel(1, 'a'), 2, 21, 21), (paprsek(1), 1, 5, 4)] {
        let r = run60(&idx, &centre, depth);
        assert_eq!((r.total, r.nodes.len(), r.edges.len(), r.truncated), (n, n, e, false), "{centre} at depth {depth}: the whole walk with cap 60");
    }
    let r = run60(&idx, PLAN, 3);
    assert_eq!((r.total, r.nodes.len(), r.edges.len(), r.truncated, r.depth_totals.clone()), (22, 22, 25, false, vec![10, 19, 22]), "Plán at depth 3 with cap 60");
}
