//! Slice G1 L4 tests of the neighbourhood query in `tegg-index` (docs/acceptance/graph.md R108, R111, R113;
//! docs/contracts/v1-graph.md §1): FR-GRP-01 AC-1…AC-9, AC-15…AC-17, AC-25, AC-26, FR-GRP-02 AC-2, AC-3, FR-GRP-07 AC-2,
//! AC-3, FR-GRP-08 AC-4. The vault is a temporary copy of tests/fixtures/vaults/graph (+ new-empty/.tegg, the two runtime
//! attachments; the hub of its README where a criterion needs it), indexed through `Index::upsert`. Expected values come
//! from the fixture README and the hand-made golden tests/fixtures/vaults/graph-golden/expected.json (shared with the
//! TypeScript reference walk, contract §8). Written from the ACs and the contract only (D-61); every check is an
//! assertion in this file (tools/qa CONTRACT §5.2).
//!
//! The index alone doesn't read `.tegg/types/`, so `type_counts` is checked here for its non-zero entries only; the full
//! D-977 list (with `cesta` at 0 and the D-121 order) is checked through the core (crates/tegg-core/tests/ac_graph.rs).

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use support::hub::{list, paprsek, uzel, ROZCESTNIK, SIROKY};
use support::*;
use tegg_index::{EdgeKind, GraphError, GraphRequest, GraphResult, NodeId, PauseHook};

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

fn run(idx: &tegg_index::Index, r: &GraphRequest) -> Result<GraphResult, GraphError> {
    idx.graph_neighbourhood(r, &flag())
}
fn keys_at(r: &GraphResult, depth: u8) -> BTreeSet<String> {
    r.nodes.iter().filter(|n| n.depth == depth).map(|n| sort_key(&n.id)).collect()
}
fn key_set(r: &GraphResult) -> BTreeSet<String> {
    r.nodes.iter().map(|n| sort_key(&n.id)).collect()
}
fn set(v: &[&str]) -> BTreeSet<String> {
    v.iter().map(|s| nfc(s)).collect()
}
fn tk(key: &str) -> String {
    format!("tag:{}", nfc(key))
}
/// The ways of one edge as (kind, from sort key, key).
fn ways(r: &GraphResult, a: &NodeId, b: &NodeId) -> Vec<(EdgeKind, String, Option<String>)> {
    match edge(r, a, b) {
        Some(e) => e.ways.iter().map(|w| (w.kind, sort_key(&w.from), w.key.clone())).collect(),
        None => Vec::new(),
    }
}
fn w(kind: EdgeKind, from: &str, key: Option<&str>) -> (EdgeKind, String, Option<String>) {
    (kind, nfc(from), key.map(nfc))
}
/// Every node is joined to the centre through kept nodes (FR-GRP-02 AC-2's L2 invariant, on one result).
fn connected(r: &GraphResult) -> bool {
    let Some(c) = r.nodes.first() else { return false };
    let mut seen = BTreeSet::from([sort_key(&c.id)]);
    let mut grew = true;
    while grew {
        grew = false;
        for (a, b) in edge_pairs(r) {
            if seen.contains(&a) && seen.insert(b.clone()) {
                grew = true;
            }
            if seen.contains(&b) && seen.insert(a.clone()) {
                grew = true;
            }
        }
    }
    seen == key_set(r)
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01

#[test]
fn fr_grp_01_ac1_every_edge_kind_from_plan() {
    let v = graph_vault();
    let idx = index(&v);
    let r = ok!(run(&idx, &req(PLAN, 1)), "Plán, depth 1");
    assert_eq!(r.nodes.len(), 10, "10 nodes: {:?}", node_list(&r));
    assert_eq!(keys_at(&r, 0), set(&[PLAN]), "Plán at depth 0");
    assert_eq!(
        keys_at(&r, 1),
        [ROZPOCET, ZAPIS, SHRNUTI, GRAF, UKOL, DEN, RECEPT].iter().map(|s| nfc(s)).chain([tk("účty"), tk("nápad")]).collect::<BTreeSet<_>>(),
        "depth 1"
    );
    assert_eq!(r.edges.len(), 11, "11 edges: {:?}", edge_pairs(&r));
    use EdgeKind::*;
    let want: Vec<(NodeId, NodeId, Vec<(EdgeKind, String, Option<String>)>)> = vec![
        (p(PLAN), p(ROZPOCET), vec![w(Relation, ROZPOCET, Some("podklady")), w(Link, PLAN, None)]),
        (p(PLAN), p(ZAPIS), vec![w(Link, PLAN, None)]),
        (p(PLAN), p(SHRNUTI), vec![w(Embed, PLAN, None), w(Link, SHRNUTI, None)]),
        (p(PLAN), p(GRAF), vec![w(Embed, PLAN, None)]),
        (p(PLAN), p(UKOL), vec![w(Embed, PLAN, None), w(Relation, UKOL, Some("source"))]),
        (p(PLAN), p(DEN), vec![w(Link, PLAN, None)]),
        (p(PLAN), t("účty"), vec![w(Tag, PLAN, None)]),
        (p(PLAN), t("nápad"), vec![w(Tag, PLAN, None)]),
        (p(RECEPT), p(PLAN), vec![w(Link, RECEPT, None)]),
        (p(ROZPOCET), t("účty"), vec![w(Tag, ROZPOCET, None)]),
        (p(ZAPIS), p(ROZPOCET), vec![w(Embed, ZAPIS, None), w(Relation, ZAPIS, Some("projekt"))]),
    ];
    for (a, b, ws) in want {
        assert_eq!(ways(&r, &a, &b), ws, "{} – {}: kinds and directions", sort_key(&a), sort_key(&b));
    }
}

#[test]
fn fr_grp_01_ac2_templates_trash_unresolved_and_self_links_are_not_edges() {
    let v = graph_vault();
    let idx = index(&v);
    for c in OBJECTS {
        for d in 1..=3u8 {
            let r = ok!(run(&idx, &req(c, d)), format!("{c}, depth {d}"));
            for n in &r.nodes {
                let path = n.path.clone().unwrap_or_default();
                assert!(!path.starts_with("_templates/") && !path.starts_with(".trash/"), "{c} d{d}: node {path} under _templates/ or .trash/");
                assert!(!["Neexistující poznámka", "Nikde", "2026-10-30"].contains(&n.title.as_str()), "{c} d{d}: ghost node {}", n.title);
            }
            for e in &r.edges {
                assert_ne!(e.a, e.b, "{c} d{d}: a self-edge on {}", sort_key(&e.a));
            }
            assert!(edge(&r, &p(ZAPIS), &p(DEN)).is_none(), "{c} d{d}: Zápis's `datum` is not an edge to Den (D-972)");
        }
    }
    assert_eq!(idx.graph_degree(&p(PLAN)), 9, "Plán's vault-wide degree (Šablona and Smazaná don't count)");
    assert_eq!(idx.graph_degree(&t("účty")), 3, "#účty's degree (Šablona's and Smazaná's tags don't count)");
    assert_eq!(idx.graph_degree(&p(OSAMELA)), 0, "Osamělá");
    let osamela = ok!(run(&idx, &req(OSAMELA, 3)), "Osamělá, depth 3");
    assert_eq!((osamela.nodes.len(), osamela.edges.len()), (1, 0), "Osamělá alone");
}

#[test]
fn fr_grp_01_ac3_one_edge_per_pair_in_the_strongest_style() {
    let v = graph_vault();
    let idx = index(&v);
    let r = ok!(run(&idx, &req(PLAN, 2)), "Plán, depth 2");
    assert_eq!(r.edges.len(), 21, "21 edges at depth 2");
    let pairs = edge_pairs(&r);
    let unique: BTreeSet<_> = pairs.iter().cloned().collect();
    assert_eq!(unique.len(), pairs.len(), "one edge per pair: {pairs:?}");
    for e in &r.edges {
        assert!(sort_key(&e.a) < sort_key(&e.b), "a < b by sort key: {} / {}", sort_key(&e.a), sort_key(&e.b));
    }
    let style = |r: &GraphResult, a: NodeId, b: NodeId| edge(r, &a, &b).map(|e| e.style);
    assert_eq!(style(&r, p(PLAN), p(ROZPOCET)), Some(EdgeKind::Relation), "Plán–Rozpočet relation");
    assert_eq!(style(&r, p(PLAN), p(SHRNUTI)), Some(EdgeKind::Embed), "Plán–Shrnutí embed");
    assert_eq!(style(&r, p(PLAN), p(UKOL)), Some(EdgeKind::Embed), "Plán–Úkol embed");
    assert_eq!(style(&r, p(ZAPIS), p(ROZPOCET)), Some(EdgeKind::Embed), "Zápis–Rozpočet embed");
    let jana = ok!(run(&idx, &req(JANA, 1)), "Jana, depth 1");
    assert_eq!(style(&jana, p(JANA), p(BETA)), Some(EdgeKind::Relation), "Jana–Beta relation (link one way, relation the other)");
    let fakt = ok!(run(&idx, &req(FAKTURY, 1)), "Faktury, depth 1");
    assert_eq!(style(&fakt, p(FAKTURY), t("účty")), Some(EdgeKind::Link), "Faktury–#účty link (a link and a tag)");
}

#[test]
fn fr_grp_01_ac4_breadth_first_with_tags_and_daily_notes_as_leaves() {
    let v = graph_vault();
    let idx = index(&v);
    let counts: Vec<(usize, usize)> = (1..=3u8)
        .map(|d| {
            let r = ok!(run(&idx, &req(PLAN, d)), format!("Plán, depth {d}"));
            (r.nodes.len(), r.edges.len())
        })
        .collect();
    assert_eq!(counts, vec![(10, 11), (19, 21), (22, 25)], "nodes and edges at depths 1, 2, 3");
    let r = ok!(run(&idx, &req(PLAN, 3)), "Plán, depth 3");
    let depth: BTreeMap<String, u8> = node_list(&r).into_iter().collect();
    let want: Vec<(String, u8)> = [
        (PLAN, 0), (ROZPOCET, 1), (ZAPIS, 1), (SHRNUTI, 1), (GRAF, 1), (UKOL, 1), (DEN, 1), (RECEPT, 1), (JANA, 2), (VYDAJE, 2), (PETR, 2),
        (SMLOUVA, 2), (BEZ, 2), (CHYBNA, 2), (BETA, 3), (VYLET, 3),
    ]
    .iter()
    .map(|(k, d)| (nfc(k), *d))
    .chain([(tk("účty"), 1), (tk("nápad"), 1), (tk("finance"), 2), (tk("cestování"), 2), (tk("archiv"), 2), (tk("zdraví"), 3)])
    .collect();
    assert_eq!(depth, want.into_iter().collect::<BTreeMap<_, _>>(), "each node's depth from Plán (README)");
    assert!(!depth.contains_key(&nfc(NAKUP)), "Nákup is reached only through Den (a leaf)");
    assert!(!depth.contains_key(&nfc(FAKTURY)), "Faktury is reached only through #účty (a leaf)");
}

#[test]
fn fr_grp_01_ac5_tag_daily_and_image_centres() {
    let v = graph_vault();
    let idx = index(&v);
    let shape = |c: &str, d: u8| {
        let r = ok!(run(&idx, &req(c, d)), format!("{c}, depth {d}"));
        (r.nodes.len(), r.edges.len())
    };
    assert_eq!(shape(F_UCTY, 1), (4, 4), "#účty d1");
    assert_eq!(shape(F_UCTY, 2), (14, 16), "#účty d2");
    assert_eq!(shape(DEN, 1), (3, 2), "Den d1");
    assert_eq!(shape(DEN, 2), (11, 12), "Den d2");
    assert_eq!(shape(FAKTURY, 1), (2, 1), "Faktury d1");
    assert_eq!(shape(FAKTURY, 2), (2, 1), "Faktury d2 (#účty is reached and not walked)");
    assert_eq!(shape(GRAF, 1), (2, 1), "Graf d1");
    let u = ok!(run(&idx, &req(F_UCTY, 1)), "#účty d1");
    assert_eq!(u.nodes.first().map(|n| (n.id.clone(), n.depth)), Some((t("účty"), 0)), "a Tag file centre starts at its tag node");
    assert_eq!(keys_at(&u, 1), set(&[PLAN, ROZPOCET, FAKTURY]), "#účty's depth 1");
    let d = ok!(run(&idx, &req(DEN, 1)), "Den d1");
    assert_eq!(keys_at(&d, 1), set(&[PLAN, NAKUP]), "Den's depth 1");
    let g = ok!(run(&idx, &req(GRAF, 1)), "Graf d1");
    assert_eq!(ways(&g, &p(PLAN), &p(GRAF)), vec![w(EdgeKind::Embed, PLAN, None)], "embed Plán→Graf");
}

#[test]
fn fr_grp_01_ac6_all_edges_among_drawn_nodes() {
    let v = graph_vault();
    let idx = index(&v);
    let r = ok!(run(&idx, &req(PLAN, 1)), "Plán d1");
    assert!(edge(&r, &p(ROZPOCET), &t("účty")).is_some(), "Rozpočet–#účty (both at depth 1, one a leaf)");
    assert!(edge(&r, &p(ZAPIS), &p(ROZPOCET)).is_some(), "Zápis–Rozpočet (both at depth 1)");
    let d = ok!(run(&idx, &req(DEN, 2)), "Den d2");
    assert!(edge(&d, &p(ROZPOCET), &t("účty")).is_some(), "Den d2: Rozpočet–#účty");
    let g = golden();
    for s in g["scenarios"].as_array().expect("setup") {
        let r = ok!(run(&idx, &golden_req(s)), s["name"].as_str().unwrap_or("?"));
        let keys = key_set(&r);
        for (a, b) in edge_pairs(&r) {
            assert!(keys.contains(&a) && keys.contains(&b), "{}: edge {a}–{b} has an end outside the result", s["name"]);
        }
    }
}

#[test]
fn fr_grp_01_ac7_result_shape_on_the_fixture() {
    let v = graph_vault();
    let idx = index(&v);
    let r = ok!(run(&idx, &req(PLAN, 3)), "Plán d3");
    let n = |id: NodeId| node(&r, &id).map(|n| (n.path.clone(), n.title.clone(), n.type_key.clone(), n.depth, n.degree, n.tag_key.clone(), n.color.clone()));
    let s = |x: &str| Some(nfc(x));
    assert_eq!(n(p(ROZPOCET)), Some((s(ROZPOCET), nfc("Rozpočet 2027"), "projekt".into(), 1, 6, None, None)), "Rozpočet");
    assert_eq!(n(p(CHYBNA)), Some((s(CHYBNA), nfc("Chybná hlavička"), "page".into(), 2, 1, None, None)), "Chybná: the stem, a Page");
    assert_eq!(n(p(BEZ)).map(|x| (x.1, x.2)), Some((nfc("Bez hlavičky"), "page".into())), "Bez hlavičky: a Page (D-103)");
    assert_eq!(n(p(RECEPT)).map(|x| x.2), Some("recept".to_string()), "Recept: the raw type key (no definition)");
    assert_eq!(n(t("účty")), Some((s(F_UCTY), nfc("Účty"), "tag".into(), 1, 3, s("účty"), s("blue"))), "#účty");
    assert_eq!(n(t("finance")).map(|x| (x.1, x.6)), Some((nfc("Finance"), s("orange"))), "#finance");
    assert_eq!(n(t("zdraví")).map(|x| (x.1, x.6)), Some((nfc("Zdraví"), s("green"))), "#zdraví");
    assert_eq!(n(t("archiv")).map(|x| (x.1, x.6)), Some((nfc("Archiv"), None)), "#archiv: no colour");
    assert_eq!(n(t("cestování")).map(|x| (x.1, x.6)), Some((nfc("Cestování"), None)), "#cestování: magenta is not a token (D-707)");
    assert_eq!(n(t("nápad")), Some((None, nfc("nápad"), "tag".into(), 1, 2, s("nápad"), None)), "#nápad: virtual, no path");
    assert_eq!(node(&r, &p(ROZPOCET)).and_then(|x| x.object_id.clone()), s("01JBGR0000000000000000R002"), "Rozpočet's objectId");
    assert_eq!(node(&r, &t("účty")).and_then(|x| x.object_id.clone()), s("01JBGR0000000000000000R019"), "#účty's objectId: its Tag file's id");
    assert_eq!(ways(&r, &p(ROZPOCET), &p(JANA)), vec![w(EdgeKind::Relation, ROZPOCET, Some("vlastník"))], "a relation carries its key");
    assert_eq!((r.total, r.unfiltered, r.hidden, r.truncated), (22, 22, 0, false), "total, unfiltered, hidden, truncated");
    let tags = r.type_counts.iter().find(|(k, _)| k == "tag").map(|(_, n)| *n);
    assert_eq!(tags, Some(6), "type_counts has `tag` with 6 at depth 3");
}

#[test]
fn fr_grp_01_ac7_result_shape_on_the_fixture_every_golden_scenario() {
    let v = graph_vault();
    let idx = index(&v);
    let g = golden();
    let mut bad = Vec::new();
    for s in g["scenarios"].as_array().expect("setup") {
        let name = s["name"].as_str().unwrap_or("?").to_string();
        let want = golden_dto(&g, s);
        match run(&idx, &golden_req(s)) {
            Ok(r) => {
                let got = dto(&r);
                if without_counts(&got) != without_counts(&want) {
                    bad.push(format!("{name}:\n  got  {}\n  want {}", without_counts(&got), without_counts(&want)));
                } else if nonzero_counts(&got) != nonzero_counts(&want) {
                    bad.push(format!("{name}: type counts {:?}, want {:?}", nonzero_counts(&got), nonzero_counts(&want)));
                }
            }
            Err(e) => bad.push(format!("{name}: {e:?}")),
        }
    }
    assert!(bad.is_empty(), "{} of {} golden scenarios differ:\n{}", bad.len(), g["scenarios"].as_array().map_or(0, |a| a.len()), bad.join("\n"));
}

#[test]
fn fr_grp_01_ac8_deterministic_and_rebuild_stable() {
    let v = graph_vault();
    let idx = index(&v);
    let mut reqs: Vec<GraphRequest> = OBJECTS.iter().flat_map(|c| (1..=3u8).map(move |d| req(c, d))).collect();
    reqs.extend(golden()["scenarios"].as_array().expect("setup").iter().map(golden_req));
    let first: Vec<String> = reqs
        .iter()
        .map(|r| {
            let a = ok!(run(&idx, r), format!("{} d{}", r.centre, r.depth));
            let b = ok!(run(&idx, r), format!("{} d{} again", r.centre, r.depth));
            let (ja, jb) = (serde_json::to_string(&a).unwrap_or_default(), serde_json::to_string(&b).unwrap_or_default());
            assert_eq!(ja, jb, "{} d{}: two calls, same JSON", r.centre, r.depth);
            ja
        })
        .collect();
    drop(idx);
    let rebuilt = index_at(&v.root, &v.tmp.path().join("rebuilt"));
    for (r, want) in reqs.iter().zip(first) {
        let c = ok!(run(&rebuilt, r), format!("{} d{} after a rebuild", r.centre, r.depth));
        assert_eq!(serde_json::to_string(&c).unwrap_or_default(), want, "{} d{}: same JSON after deleting and rebuilding the index (AR-01)", r.centre, r.depth);
    }
}

#[test]
fn fr_grp_01_ac9_new_request_cancels_the_old() {
    let v = hub_vault();
    let idx = index(&v);
    let control = ok!(run(&idx, &req(ROZCESTNIK, 3)), "positive control: Rozcestník d3 without a cancel");
    assert_eq!(control.nodes.len(), 150, "the control draws 150");
    let cancel = flag();
    let levels = Arc::new(Mutex::new(Vec::<u8>::new()));
    let (c2, l2) = (cancel.clone(), levels.clone());
    let r = GraphRequest {
        pause: Some(PauseHook(Arc::new(move |level: u8| {
            l2.lock().unwrap_or_else(|e| e.into_inner()).push(level);
            if level == 1 {
                c2.store(true, Ordering::SeqCst);
            }
        }))),
        ..req(ROZCESTNIK, 3)
    };
    let got = idx.graph_neighbourhood(&r, &cancel);
    assert_eq!(got.err(), Some(GraphError::Cancelled), "the flag set after level 1 ends the request as Cancelled, with no result");
    assert_eq!(levels.lock().unwrap_or_else(|e| e.into_inner()).first().copied(), Some(1), "the pause hook ran after level 1");
}

#[test]
fn fr_grp_01_ac15_cap_keeps_the_most_connected_150() {
    let v = hub_vault();
    let idx = index(&v);
    let d1 = ok!(run(&idx, &req(ROZCESTNIK, 1)), "Rozcestník d1");
    assert_eq!((d1.total, d1.nodes.len(), d1.edges.len(), d1.truncated), (41, 41, 40, false), "depth 1: all 41");
    let d2 = ok!(run(&idx, &req(ROZCESTNIK, 2)), "Rozcestník d2");
    assert_eq!((d2.total, d2.truncated, d2.nodes.len(), d2.edges.len()), (161, true, 150, 149), "depth 2: total 161, truncated, 150 kept, 149 edges");
    let mut want: BTreeSet<String> = BTreeSet::from([nfc(ROZCESTNIK)]);
    for n in 1..=40 {
        want.insert(nfc(&paprsek(n)));
        want.insert(nfc(&uzel(n, 'a')));
        want.insert(nfc(&uzel(n, 'b')));
        if n <= 29 {
            want.insert(nfc(&uzel(n, 'c')));
        }
    }
    assert_eq!(key_set(&d2), want, "the centre, 40 Paprsek, 80 Uzel a/b and Uzel 01-c…29-c (degree, then path)");
    for n in 30..=40 {
        assert!(!key_set(&d2).contains(&nfc(&uzel(n, 'c'))), "Uzel {n}-c is dropped");
    }
    assert_eq!((d2.unfiltered, d2.hidden), (161, 0), "the cap's dropped nodes are not `hidden` (D-976)");
}

#[test]
fn fr_grp_01_ac16_show_all_once_and_not_above_1000() {
    let v = hub_vault();
    let idx = index(&v);
    let all = ok!(run(&idx, &GraphRequest { show_all: true, ..req(ROZCESTNIK, 2) }), "Rozcestník d2, Show all");
    assert_eq!((all.nodes.len(), all.edges.len(), all.truncated), (161, 160, false), "Show all draws 161 nodes and 160 edges");
    let d2 = ok!(run(&idx, &req(ROZCESTNIK, 2)), "Rozcestník d2");
    let d3 = ok!(run(&idx, &req(ROZCESTNIK, 3)), "Rozcestník d3");
    assert_eq!((d3.total, d3.nodes.len(), d3.edges.len(), d3.truncated), (1361, 150, 149, true), "depth 3: 1,361 objects, 150 kept");
    assert_eq!(key_set(&d3), key_set(&d2), "no depth-3 node fits: the same 150 as at depth 2");
    let d3all = ok!(run(&idx, &GraphRequest { show_all: true, ..req(ROZCESTNIK, 3) }), "Rozcestník d3, Show all");
    assert_eq!((d3all.nodes.len(), d3all.truncated), (150, true), "Show all above 1,000 is ignored");
}

#[test]
fn fr_grp_01_ac17_depth_one_is_never_cut() {
    let v = hub_vault();
    let idx = index(&v);
    let d1 = ok!(run(&idx, &req(SIROKY, 1)), "Široký d1");
    assert_eq!((d1.total, d1.nodes.len(), d1.edges.len(), d1.truncated), (161, 161, 160, false), "depth 1 above the cap: all 161, not truncated");
    let d2 = ok!(run(&idx, &req(SIROKY, 2)), "Široký d2");
    assert_eq!((d2.total, d2.nodes.len(), d2.edges.len(), d2.truncated), (241, 161, 160, true), "depth 2: 241 objects, the same 161 drawn");
    assert_eq!(key_set(&d2), key_set(&d1), "the 161 of depth 1");
    let all = ok!(run(&idx, &GraphRequest { show_all: true, ..req(SIROKY, 2) }), "Široký d2, Show all");
    assert_eq!(all.nodes.len(), 241, "Show all draws 241");
}

#[test]
fn fr_grp_01_ac25_indexing_and_unreadable_files() {
    let v = graph_vault();
    let vadny = "Pages/Vadný soubor.md";
    let mut bytes = "Odkaz na [[Shrnutí]] a vadné bajty: ".as_bytes().to_vec();
    bytes.extend_from_slice(&[0xFF, 0xFE, 0xC3, b'.', b'\n']);
    write(&v.root, vadny, &bytes);
    let idx = index(&v);
    let r = ok!(run(&idx, &req(SHRNUTI, 1)), "Shrnutí d1");
    let ch = node(&r, &p(CHYBNA)).map(|n| (n.title.clone(), n.type_key.clone()));
    assert_eq!(ch, Some((nfc("Chybná hlavička"), "page".to_string())), "Chybná is a Page node with its stem title");
    assert_eq!(ways(&r, &p(CHYBNA), &p(SHRNUTI)), vec![w(EdgeKind::Link, CHYBNA, None)], "its body link to Shrnutí");
    let own = ok!(run(&idx, &req(vadny, 1)), "the invalid UTF-8 file as the centre");
    assert_eq!(own.nodes.first().map(|n| (n.title.clone(), n.depth)), Some((nfc("Vadný soubor"), 0)), "a node with its stem title");
    let indexed = idx.backlinks(&nfc(SHRNUTI)).contains(&nfc(vadny));
    assert_eq!(edge(&r, &p(vadny), &p(SHRNUTI)).is_some(), indexed, "Shrnutí's graph has the invalid file's link exactly when the index has it");
}

#[test]
fn fr_grp_01_ac26_nfd_names_and_links_are_one_node() {
    let v = graph_vault();
    let odkaz = "Pages/NFD odkaz.md";
    let text = format!(
        "---\nid: 01JBGR0000000000000000R030\ntype: page\ntitle: NFD odkaz\ncreated: 2026-10-28T09:00:00+01:00\nmodified: 2026-10-28T09:00:00+01:00\n---\nOdkaz na [[{}]].\n",
        nfd("Plán čtvrtletí")
    );
    write(&v.root, odkaz, text.as_bytes());
    std::fs::rename(v.root.join(SHRNUTI), v.root.join(nfd(SHRNUTI))).expect("setup: NFD rename");
    let idx = index(&v);
    let r = ok!(run(&idx, &req(PLAN, 1)), "Plán d1");
    assert_eq!(r.nodes.len(), 11, "11 objects with the NFD link: {:?}", node_list(&r));
    assert_eq!(node(&r, &p(odkaz)).map(|n| n.depth), Some(1), "NFD odkaz at depth 1");
    assert_eq!(ways(&r, &p(odkaz), &p(PLAN)), vec![w(EdgeKind::Link, odkaz, None)], "one link edge to Plán");
    assert_eq!(r.nodes.iter().filter(|n| n.title == nfc("Plán čtvrtletí")).count(), 1, "not a second Plán, not a ghost");
    assert_eq!(node(&r, &p(SHRNUTI)).map(|n| (n.path.clone(), n.title.clone())), Some((Some(nfc(SHRNUTI)), nfc("Shrnutí"))), "the NFD-named file is the NFC node Shrnutí");
    for c in [PLAN, SHRNUTI, odkaz] {
        for d in 1..=3u8 {
            let x = ok!(run(&idx, &req(c, d)), format!("{c} d{d}"));
            for n in &x.nodes {
                assert_eq!(n.title, nfc(&n.title), "NFC title");
                assert_eq!(n.path.clone().map(|p| nfc(&p)), n.path, "NFC path");
            }
        }
    }
    let by_nfd = ok!(run(&idx, &GraphRequest { centre: nfd(PLAN), ..req(PLAN, 1) }), "Plán asked by its NFD path");
    assert_eq!(serde_json::to_string(&by_nfd).unwrap_or_default(), serde_json::to_string(&r).unwrap_or_default(), "the same answer for the NFD centre");
}

#[test]
fn fr_grp_01_ac22_centre_deleted_state_unknown_path_and_invalid_depth() {
    let v = graph_vault();
    let idx = index(&v);
    assert_eq!(run(&idx, &req(PLAN, 0)).err(), Some(GraphError::InvalidDepth), "depth 0");
    assert_eq!(run(&idx, &req(PLAN, 4)).err(), Some(GraphError::InvalidDepth), "depth 4");
    assert_eq!(run(&idx, &req("Pages/Neexistuje.md", 1)).err(), Some(GraphError::CentreNotFound), "a path that doesn't exist");
    assert!(run(&idx, &req(PLAN, 1)).is_ok(), "positive control: Plán d1 answers");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02

#[test]
fn fr_grp_02_ac2_hidden_types_are_not_walked() {
    let v = graph_vault();
    let idx = index(&v);
    let tag_off = |d: u8| GraphRequest { hidden_types: vec!["tag".into()], ..req(PLAN, d) };
    let a = ok!(run(&idx, &tag_off(1)), "Tags type off, d1");
    assert_eq!((a.nodes.len(), a.edges.len(), a.hidden), (8, 8, 2), "Tags off at depth 1: 8 nodes, 8 edges, 2 hidden");
    let b = ok!(run(&idx, &tag_off(2)), "Tags type off, d2");
    assert_eq!((b.nodes.len(), b.edges.len(), b.hidden), (14, 15, 5), "Tags off at depth 2: 14, 15, 5 hidden");
    let c = ok!(run(&idx, &GraphRequest { hidden_types: vec!["projekt".into()], ..req(PLAN, 2) }), "Projekty off, d2");
    assert_eq!((c.nodes.len(), c.edges.len(), c.hidden), (16, 15, 3), "Projekty off at depth 2: 16, 15, 3 hidden");
    for gone in [p(ROZPOCET), p(VYDAJE), t("finance")] {
        assert!(node(&c, &gone).is_none(), "Projekty off: {} is not drawn", sort_key(&gone));
    }
    let g = ok!(run(&idx, &GraphRequest { hidden_types: vec!["page".into()], ..req(PLAN, 1) }), "Pages off, d1");
    assert_eq!((g.nodes.len(), g.hidden), (9, 1), "Pages off at depth 1: 9 nodes, 1 hidden");
    assert_eq!(g.nodes.first().map(|n| n.id.clone()), Some(p(PLAN)), "the centre is always drawn");
    assert!(node(&g, &p(SHRNUTI)).is_none(), "Shrnutí hidden");
    let unknown = ok!(run(&idx, &GraphRequest { hidden_types: vec!["kniha".into()], ..req(PLAN, 1) }), "an unknown type key");
    assert_eq!(unknown.nodes.len(), 10, "an unknown hidden key is ignored (D-977)");
    for r in [&a, &b, &c, &g] {
        assert!(connected(r), "every drawn node is joined to the centre through drawn nodes: {:?}", node_list(r));
        assert_eq!(r.hidden, r.unfiltered - r.total, "hidden = unfiltered − total");
    }
}

#[test]
fn fr_grp_02_ac3_connection_toggles_both_directions() {
    let v = graph_vault();
    let idx = index(&v);
    let d = ok!(run(&idx, &GraphRequest { hidden_kinds: vec![EdgeKind::Relation], ..req(PLAN, 2) }), "Relations off, d2");
    assert_eq!((d.nodes.len(), d.edges.len(), d.hidden), (16, 17, 3), "Relations off at depth 2: 16, 17, 3 hidden");
    for gone in [JANA, PETR, VYDAJE] {
        assert!(node(&d, &p(gone)).is_none(), "{gone} is hidden");
    }
    let style = |r: &GraphResult, a: NodeId, b: NodeId| edge(r, &a, &b).map(|e| e.style);
    assert_eq!(style(&d, p(PLAN), p(ROZPOCET)), Some(EdgeKind::Link), "Plán–Rozpočet stays, drawn as link (D-973)");
    assert_eq!(ways(&d, &p(PLAN), &p(ROZPOCET)).len(), 2, "its ways still list the hidden relation");
    assert_eq!(style(&d, p(PLAN), p(UKOL)), Some(EdgeKind::Embed), "Plán–Úkol stays embed");
    assert_eq!(style(&d, p(ZAPIS), p(ROZPOCET)), Some(EdgeKind::Embed), "Zápis–Rozpočet stays embed");
    let f = ok!(run(&idx, &GraphRequest { hidden_kinds: vec![EdgeKind::Link], ..req(PLAN, 1) }), "Links off, d1");
    assert_eq!(key_set(&f), [PLAN, ROZPOCET, SHRNUTI, GRAF, UKOL].iter().map(|s| nfc(s)).chain([tk("účty"), tk("nápad")]).collect(), "Links off: 7 nodes");
    assert_eq!(f.hidden, 3, "Links off: 3 hidden (Zápis, Den and Recept, which links to Plán)");
    let e = ok!(run(&idx, &GraphRequest { hidden_kinds: vec![EdgeKind::Tag], ..req(PLAN, 1) }), "Tags kind off, d1");
    assert_eq!((e.nodes.len(), e.edges.len(), e.hidden), (8, 8, 2), "Tags kind off: 8, 8, 2 hidden");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-07

#[test]
fn fr_grp_07_ac2_three_steps_by_vault_degree() {
    let v = hub_vault();
    let idx = index(&v);
    let want: Vec<(NodeId, usize)> = vec![
        (p(PLAN), 9), (p(ROZPOCET), 6), (p(ZAPIS), 6), (p(SHRNUTI), 4), (p(JANA), 3), (p(PETR), 3), (t("účty"), 3), (p(DEN), 2), (p(VYLET), 2),
        (t("nápad"), 2), (p(BETA), 1), (p(VYDAJE), 1), (p(BEZ), 1), (p(CHYBNA), 1), (p(UKOL), 1), (p(NAKUP), 1), (p(GRAF), 1), (p(SMLOUVA), 1),
        (p(FAKTURY), 1), (p(RECEPT), 1), (t("finance"), 1), (t("zdraví"), 1), (t("archiv"), 1), (t("cestování"), 1), (p(OSAMELA), 0),
        (p(ROZCESTNIK), 40), (p(&paprsek(1)), 4), (p(&uzel(1, 'a')), 16), (p(&uzel(1, 'b')), 16), (p(&uzel(1, 'c')), 1),
        (p(&list(1, 'a', 1)), 2), (p(&list(1, 'a', 3)), 1), (p(SIROKY), 160),
    ];
    let got: Vec<(NodeId, usize)> = want.iter().map(|(id, _)| (id.clone(), idx.graph_degree(id))).collect();
    assert_eq!(got, want, "vault-wide degrees (README)");
    let mut seen = Vec::new();
    for (c, d) in [(PLAN, 1u8), (PLAN, 2), (PLAN, 3), (F_UCTY, 1)] {
        let r = ok!(run(&idx, &req(c, d)), format!("{c} d{d}"));
        seen.push(node(&r, &p(ROZPOCET)).map(|n| n.degree));
        for n in &r.nodes {
            assert_eq!(n.degree, idx.graph_degree(&n.id), "{c} d{d}: {}'s degree equals graph_degree", sort_key(&n.id));
        }
    }
    assert_eq!(seen, vec![Some(6); 4], "Rozpočet's degree doesn't change with depth or centre");
    let sp = ok!(run(&idx, &req(&paprsek(1), 1)), "Paprsek 01 d1");
    assert_eq!(sp.nodes.len(), 5, "Paprsek 01 d1: 5 nodes");
    let li = ok!(run(&idx, &req(&list(1, 'a', 1), 1)), "List 01-a-01 d1");
    assert_eq!(key_set(&li), set(&[&list(1, 'a', 1), &uzel(1, 'a'), SIROKY]), "List 01-a-01 d1: Uzel 01-a and Široký");
}

#[test]
fn fr_grp_07_ac3_degree_ignores_filters_templates_and_trash() {
    let v = graph_vault();
    let idx = index(&v);
    let r = ok!(
        run(&idx, &GraphRequest { hidden_types: vec!["tag".into()], hidden_kinds: vec![EdgeKind::Relation], ..req(PLAN, 2) }),
        "Plán d2 with Tags and Relations hidden"
    );
    assert_eq!(node(&r, &p(ROZPOCET)).map(|n| n.degree), Some(6), "Rozpočet stays at 6 with filters");
    let link = "---\ntype: page\ntitle: Odkaz\n---\nViz [[Rozpočet 2027]].\n";
    write(&v.root, "_templates/Page/Odkaz na rozpočet.md", link.as_bytes());
    write(&v.root, ".trash/Pages/Odkaz na rozpočet.md", link.as_bytes());
    let again = index(&v);
    assert_eq!(again.graph_degree(&p(ROZPOCET)), 6, "a template or trashed note linking Rozpočet changes nothing");
    let r2 = ok!(run(&again, &req(PLAN, 1)), "Plán d1 after the runtime files");
    assert_eq!(node(&r2, &p(ROZPOCET)).map(|n| n.degree), Some(6), "Rozpočet's degree in the result");
}

// ------------------------------------------------------------------------------------------------ FR-GRP-08

#[test]
fn fr_grp_08_ac4_one_node_per_tag_key() {
    let v = graph_vault();
    write(
        &v.root,
        "Tags/Účty (2).md",
        "---\nid: 01JBGR0000000000000000R031\ntype: tag\ntitle: účty\ncreated: 2026-10-15T09:00:00+02:00\nmodified: 2026-10-15T09:00:00+02:00\n---\n".as_bytes(),
    );
    let velka = "Pages/Velká písmena.md";
    write(
        &v.root,
        velka,
        "---\nid: 01JBGR0000000000000000R032\ntype: page\ntitle: Velká písmena\ncreated: 2026-10-16T09:00:00+02:00\nmodified: 2026-10-16T09:00:00+02:00\n---\nPoznámka s #ÚČTY.\n".as_bytes(),
    );
    let idx = index(&v);
    let f = ok!(run(&idx, &req(FAKTURY, 1)), "Faktury d1");
    assert_eq!(key_set(&f), BTreeSet::from([nfc(FAKTURY), tk("účty")]), "tags:, [[Účty]] reach the one node of účty");
    assert_eq!(f.edges.len(), 1, "one edge");
    assert_eq!(node(&f, &t("účty")).and_then(|n| n.path.clone()), Some(nfc(F_UCTY)), "the node's file is the winner");
    let big = ok!(run(&idx, &req(velka, 1)), "the #ÚČTY note d1");
    assert_eq!(key_set(&big), BTreeSet::from([nfc(velka), tk("účty")]), "inline #ÚČTY joins the node of účty");
    assert_eq!(idx.graph_degree(&t("účty")), 4, "#účty now joins Plán, Rozpočet, Faktury and the new note");
    let plan = ok!(run(&idx, &req(PLAN, 3)), "Plán d3");
    assert!(plan.nodes.iter().all(|n| n.path.as_deref() != Some(&nfc("Tags/Účty (2).md"))), "the losing duplicate is no node");
    assert_eq!(run(&idx, &req("Tags/Účty (2).md", 1)).err(), Some(GraphError::CentreNotFound), "a losing duplicate as the centre (D-694)");
}
