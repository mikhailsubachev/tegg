//! Slice G1 L4 tests of the core (docs/acceptance/graph.md; docs/contracts/v1-graph.md §1.5, §1.7, §2): FR-GRP-01 AC-9
//! (one in-flight request per window: a new request sets the running one's flag before it starts), AC-25 (`NotReady`
//! while the first index build runs, then an answer without a reopen), AC-22 (the core's `CentreInTrash` /
//! `CentreNotFound`), FR-GRP-02 AC-1 (the D-977 type list with the vault's type definitions, which only the core
//! reads), FR-SYN-06 AC-38 (the query writes nothing: bytes, mtime and inode, zero vault writes) and NFR-PERF-11 AC-2
//! (the query time alone on the reference vault, reported; outside the push run like every `nfr_perf_` test).
//! Written from the ACs and the contract only (D-61); every check is an assertion in this file.

mod common;
mod graph_setup;

use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::*;
use graph_setup::hub::ROZCESTNIK;
use graph_setup::*;
use tegg_core::{Core, CoreOptions, GraphError, GraphRequest, GraphResult, NodeId, PauseHook};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} answered {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

fn counts(r: &GraphResult) -> Vec<(String, usize)> {
    r.type_counts.clone()
}
fn tc(v: [usize; 12]) -> Vec<(String, usize)> {
    ["page", "task", "quick-note", "daily-note", "cesta", "osoba", "projekt", "schůzka", "image", "pdf", "tag", "recept"]
        .iter()
        .zip(v)
        .map(|(k, n)| (tegg_format::nfc(k), n))
        .collect()
}

#[test]
fn fr_grp_01_ac9_new_request_cancels_the_old_in_the_core() {
    let sb = sandbox();
    let root = hub_vault(&sb);
    let core = open(&root, &sb.dirs);
    let (paused_tx, paused_rx) = channel::<u8>();
    let (go_tx, go_rx) = channel::<()>();
    let go_rx = std::sync::Mutex::new(go_rx);
    let first = GraphRequest {
        pause: Some(PauseHook(Arc::new(move |level: u8| {
            if level == 1 {
                let _ = paused_tx.send(level);
                let _ = go_rx.lock().unwrap_or_else(|e| e.into_inner()).recv_timeout(Duration::from_secs(10));
            }
        }))),
        ..req(ROZCESTNIK, 3)
    };
    std::thread::scope(|s| {
        let a = s.spawn(|| core.graph_neighbourhood(WINDOW, &first));
        let paused = paused_rx.recv_timeout(Duration::from_secs(10)).is_ok();
        let b = s.spawn(|| core.graph_neighbourhood(WINDOW, &req(ROZCESTNIK, 1)));
        std::thread::sleep(Duration::from_millis(300));
        let _ = go_tx.send(());
        let a = a.join().unwrap_or(Err(GraphError::NotReady));
        let b = b.join().unwrap_or(Err(GraphError::NotReady));
        assert!(paused, "the first request reached the pause hook after level 1");
        assert_eq!(a.err(), Some(GraphError::Cancelled), "the second request from the same window cancelled the first");
        let b = ok!(b, "the second request (Rozcestník d1)");
        assert_eq!(b.nodes.len(), 41, "the second request answers normally");
    });
}

#[test]
fn fr_grp_01_ac25_indexing_and_unreadable_files_not_ready_while_indexing() {
    let sb = sandbox();
    let root = graph_vault(&sb);
    let fs = GatedFs::new(&root);
    let core = match Core::open_with(fs.clone(), &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_with: {e:?}"),
    };
    let early = core.graph_neighbourhood(WINDOW, &req(PLAN, 1));
    fs.open();
    let idle = core.wait_idle(Duration::from_secs(60));
    assert_eq!(early.err(), Some(GraphError::NotReady), "NotReady while the first index build runs (D-990)");
    assert!(idle, "setup: the index build finished");
    let r = ok!(core.graph_neighbourhood(WINDOW, &req(PLAN, 1)), "Plán d1 once the index is ready");
    assert_eq!((r.nodes.len(), r.edges.len()), (10, 11), "the graph without reopening the vault");
}

#[test]
fn fr_grp_01_ac22_centre_deleted_state_in_the_core() {
    let sb = sandbox();
    let root = graph_vault(&sb);
    let core = open(&root, &sb.dirs);
    let trashed = ".trash/Pages/Plán čtvrtletí.md";
    std::fs::rename(root.join(PLAN), root.join(trashed)).expect("setup: move Plán to .trash/");
    core.notify_changed(&[PLAN.to_string(), trashed.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(30)), "setup: change applied");
    assert_eq!(
        core.graph_neighbourhood(WINDOW, &req(PLAN, 1)).err(),
        Some(GraphError::CentreInTrash { title: tegg_format::nfc("Plán čtvrtletí") }),
        "Plán in .trash/: CentreInTrash with its title"
    );
    std::fs::remove_file(root.join(trashed)).expect("setup: delete");
    core.notify_changed(&[trashed.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(30)), "setup: change applied");
    assert_eq!(core.graph_neighbourhood(WINDOW, &req(PLAN, 1)).err(), Some(GraphError::CentreNotFound), "deleted outright: CentreNotFound");
    assert_eq!(core.graph_neighbourhood(WINDOW, &req("Pages/Neexistuje.md", 1)).err(), Some(GraphError::CentreNotFound), "a path that never existed");
}

#[test]
fn fr_grp_02_ac1_type_list_order_and_counts_in_the_core() {
    let sb = sandbox();
    let root = graph_vault(&sb);
    let core = open(&root, &sb.dirs);
    let d1 = ok!(core.graph_neighbourhood(WINDOW, &req(PLAN, 1)), "Plán d1");
    assert_eq!(counts(&d1), tc([2, 1, 0, 1, 0, 0, 1, 1, 1, 0, 2, 1]), "depth 1: every type of the vault in D-977 order, Cesty at 0, `recept` last");
    let d2 = ok!(core.graph_neighbourhood(WINDOW, &req(PLAN, 2)), "Plán d2");
    assert_eq!(counts(&d2), tc([5, 1, 0, 1, 0, 2, 1, 1, 1, 1, 5, 1]), "depth 2");
    let filtered = ok!(core.graph_neighbourhood(WINDOW, &GraphRequest { hidden_types: vec!["tag".into()], ..req(PLAN, 2) }), "Plán d2, Tags off");
    assert_eq!(counts(&filtered), counts(&d2), "the counts are the unfiltered walk's (D-976)");
    assert_eq!(filtered.nodes.len(), 14, "while the drawn walk is filtered");
}

#[test]
fn fr_syn_06_ac38_graph_tour_writes_nothing_in_the_core() {
    let sb = sandbox();
    let root = hub_vault(&sb);
    let fs = CountingFs::new(tegg_vault::LocalFs::new(&root));
    let core = match Core::open_with(fs.clone(), &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open_with: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(120)), "setup: indexed");
    let before = snapshot(&root);
    let writes = fs.write_count();
    let mut answered = 0;
    for c in [PLAN, ROZCESTNIK, "Tags/Účty.md", "Daily/2026-10-07.md", OSAMELA] {
        for d in 1..=3u8 {
            for show_all in [false, true] {
                let r = core.graph_neighbourhood(WINDOW, &GraphRequest { show_all, hidden_types: if d == 2 { vec!["tag".into()] } else { vec![] }, ..req(c, d) });
                if r.is_ok() {
                    answered += 1;
                }
            }
        }
    }
    let _ = core.graph_degree(&NodeId::Path(tegg_format::nfc(PLAN)));
    assert_eq!(answered, 30, "every request of the tour answered");
    assert_eq!(fs.write_count(), writes, "no vault write");
    assert_eq!(snapshot(&root), before, "every file keeps its bytes, mtime and inode; no file or folder is created");
}

#[test]
fn nfr_perf_11_ac2_query_and_layout_reported() {
    let sb = sandbox();
    let vault = reference_vault();
    let core = match Core::open(&vault, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: Core::open: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(600)), "setup: the reference vault is indexed");
    let mut best: Option<(usize, String)> = None;
    for o in core.objects() {
        let d = core.graph_degree(&NodeId::Path(o.path.clone()));
        if best.as_ref().is_none_or(|(bd, bp)| d > *bd || (d == *bd && o.path < *bp)) {
            best = Some((d, o.path.clone()));
        }
    }
    let (degree, centre) = best.unwrap_or((0, String::new()));
    assert!(degree > 0, "the reference vault's object with the highest vault-wide degree has links (got {degree} on {centre:?})");
    let mut samples = Vec::new();
    for i in 0..20 {
        let t0 = Instant::now();
        let r = core.graph_neighbourhood(WINDOW, &req(&centre, 2));
        samples.push(t0.elapsed());
        let r = ok!(r, format!("run {i}: depth 2 around {centre}"));
        assert!(r.nodes.len() <= 150 || r.total <= 150, "cap 150 applied");
    }
    let p = p95(&mut samples);
    println!("NFR-PERF-11 AC-2: graph_neighbourhood alone, depth 2 around {centre} (degree {degree}), p95 {} ms of 20 runs (reported; the L1 layout bench and the L6 total are reported beside it)", p.as_millis());
}
