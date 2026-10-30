//! Setup for the slice G1 L4 tests of `tegg-index` (docs/contracts/v1-graph.md §1, §8; fixture
//! tests/fixtures/vaults/graph/README.md, golden tests/fixtures/vaults/graph-golden/expected.json). No assertions about
//! the criteria here: a panic in this module is a setup failure, never a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

pub mod hub;

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde_json::{json, Value};
use tegg_index::{CancelFlag, EdgeKind, GraphEdge, GraphNode, GraphRequest, GraphResult, Index, NodeId};
use tegg_vault::FileVersion;

pub const PLAN: &str = "Pages/Plán čtvrtletí.md";
pub const ROZPOCET: &str = "Projekty/Rozpočet 2027.md";
pub const ZAPIS: &str = "Schůzky/Zápis z porady.md";
pub const JANA: &str = "Osoby/Jana Nováková.md";
pub const PETR: &str = "Osoby/Petr Dvořák.md";
pub const BETA: &str = "Projekty/Projekt Beta.md";
pub const SHRNUTI: &str = "Pages/Shrnutí.md";
pub const VYDAJE: &str = "Pages/Výdaje 2026.md";
pub const BEZ: &str = "Pages/Bez hlavičky.md";
pub const UKOL: &str = "Tasks/Zaplatit fakturu.md";
pub const DEN: &str = "Daily/2026-10-07.md";
pub const NAKUP: &str = "Pages/Nákupní seznam.md";
pub const GRAF: &str = "Images/Graf výdajů.md";
pub const SMLOUVA: &str = "PDFs/Smlouva.md";
pub const FAKTURY: &str = "Pages/Faktury.md";
pub const VYLET: &str = "Quick Notes/Nápad na výlet.md";
pub const RECEPT: &str = "Pages/Recept na koláč.md";
pub const OSAMELA: &str = "Pages/Osamělá.md";
pub const CHYBNA: &str = "Pages/Chybná hlavička.md";
pub const F_UCTY: &str = "Tags/Účty.md";
pub const SABLONA: &str = "_templates/Page/Šablona.md";
pub const SMAZANA: &str = ".trash/Pages/Smazaná.md";

/// Every object of the fixture (not the template, not the trash), as a centre.
pub const OBJECTS: [&str; 24] = [
    PLAN, ROZPOCET, ZAPIS, JANA, PETR, BETA, SHRNUTI, VYDAJE, BEZ, UKOL, DEN, NAKUP, GRAF, SMLOUVA, FAKTURY, VYLET, RECEPT, OSAMELA, CHYBNA,
    F_UCTY, "Tags/Finance.md", "Tags/Zdraví.md", "Tags/Archiv.md", "Tags/Cestování.md",
];

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("setup: repo root")
}
pub fn nfc(s: &str) -> String {
    tegg_format::nfc(s)
}
pub fn nfd(s: &str) -> String {
    // Enough for the fixture's names: decompose the Czech letters with an acute, caron or ring.
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'Ú' => ('U', '\u{301}'), 'č' => ('c', '\u{30C}'), 'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'),
            'ž' => ('z', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'), 'ť' => ('t', '\u{30C}'), 'ď' => ('d', '\u{30C}'),
            'Š' => ('S', '\u{30C}'), 'Č' => ('C', '\u{30C}'), 'ů' => ('u', '\u{30A}'),
            _ => {
                out.push(c);
                continue;
            }
        };
        out.push(base);
        out.push(mark);
    }
    out
}

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        let name = e.file_name();
        if skip.iter().any(|s| name == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(&name), &[]);
        } else {
            std::fs::copy(e.path(), to.join(&name)).expect("setup: copy");
        }
    }
}

pub struct Vault {
    pub tmp: tempfile::TempDir,
    pub root: PathBuf,
}

/// `graph/` (without README.md and make-hub.*) + `new-empty/.tegg` + the two runtime attachments, in `<tmp>/Graf`.
pub fn graph_vault() -> Vault {
    let tmp = tempfile::tempdir().expect("setup: tempdir");
    let root = tmp.path().canonicalize().expect("setup: canonical").join("Graf");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("graph"), &root, &["README.md", "make-hub.mjs", "make-hub.d.mts"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(root.join("_attachments")).expect("setup: _attachments");
    std::fs::copy(fx.join("trash-media/_attachments/záhon.png"), root.join("_attachments/graf.png")).expect("setup: graf.png");
    std::fs::copy(fx.join("trash-media/_attachments/Rozpočet.pdf"), root.join("_attachments/Smlouva.pdf")).expect("setup: Smlouva.pdf");
    Vault { tmp, root }
}
pub fn hub_vault() -> Vault {
    let v = graph_vault();
    hub::write_hub(&v.root);
    v
}

pub fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).expect("setup: parent");
    }
    std::fs::write(&p, bytes).expect("setup: write");
}
pub fn fixture_text(rel: &str) -> String {
    String::from_utf8(std::fs::read(repo_root().join("tests/fixtures/vaults/graph").join(rel)).expect("setup: fixture")).expect("setup: UTF-8")
}

fn version_of(p: &Path, bytes: &[u8]) -> FileVersion {
    let md = std::fs::metadata(p).expect("setup: metadata");
    let mut hash = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        hash[i % 32] = hash[i % 32].wrapping_mul(31).wrapping_add(*b);
    }
    FileVersion { mtime_ns: md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, size: bytes.len() as u64, hash }
}

/// Every file of the vault, by its relative path as the file system spells it.
pub fn files(root: &Path) -> Vec<(String, PathBuf)> {
    fn walk(root: &Path, d: &Path, out: &mut Vec<(String, PathBuf)>) {
        for e in std::fs::read_dir(d).expect("setup: read_dir") {
            let e = e.expect("setup: entry");
            let p = e.path();
            if e.file_type().expect("setup: type").is_dir() {
                walk(root, &p, out);
            } else {
                let rel = p.strip_prefix(root).expect("setup: prefix").to_string_lossy().into_owned();
                out.push((rel, p));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

/// A fresh index (in `db_dir`) of every file of the vault, through the index's own `upsert` (excluded paths ignored).
pub fn index_at(root: &Path, db_dir: &Path) -> Index {
    let mut idx = Index::open(&db_dir.join("index.sqlite")).expect("setup: Index::open");
    for (rel, p) in files(root) {
        if !tegg_index::is_indexable(&rel) {
            continue;
        }
        let bytes = std::fs::read(&p).expect("setup: read");
        idx.upsert(&rel, &bytes, &version_of(&p, &bytes)).expect("setup: upsert");
    }
    idx
}
pub fn index(v: &Vault) -> Index {
    let db = v.tmp.path().join(format!("db-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    index_at(&v.root, &db)
}

pub fn flag() -> CancelFlag {
    Arc::new(AtomicBool::new(false))
}
pub fn req(centre: &str, depth: u8) -> GraphRequest {
    GraphRequest { centre: nfc(centre), depth, cap: 150, ..Default::default() }
}
pub fn kind(s: &str) -> EdgeKind {
    match s {
        "link" => EdgeKind::Link,
        "relation" => EdgeKind::Relation,
        "embed" => EdgeKind::Embed,
        "tag" => EdgeKind::Tag,
        other => panic!("setup: kind {other}"),
    }
}
pub fn kind_name(k: EdgeKind) -> &'static str {
    match k {
        EdgeKind::Link => "link",
        EdgeKind::Relation => "relation",
        EdgeKind::Embed => "embed",
        EdgeKind::Tag => "tag",
    }
}

/// The §1.6 sort key: the path for objects, `tag:<key>` for tag nodes.
pub fn sort_key(id: &NodeId) -> String {
    match id {
        NodeId::Path(p) => p.clone(),
        NodeId::Tag(k) => format!("tag:{k}"),
    }
}
pub fn p(path: &str) -> NodeId {
    NodeId::Path(nfc(path))
}
pub fn t(key: &str) -> NodeId {
    NodeId::Tag(nfc(key))
}

fn id_json(id: &NodeId) -> Value {
    match id {
        NodeId::Path(p) => json!({ "path": p }),
        NodeId::Tag(k) => json!({ "tag": k }),
    }
}
fn node_json(n: &GraphNode) -> Value {
    json!({ "id": id_json(&n.id), "objectId": n.object_id, "path": n.path, "title": n.title, "typeKey": n.type_key, "depth": n.depth,
            "degree": n.degree, "tagKey": n.tag_key, "color": n.color })
}
fn edge_json(e: &GraphEdge) -> Value {
    json!({ "a": id_json(&e.a), "b": id_json(&e.b), "style": kind_name(e.style),
            "ways": e.ways.iter().map(|w| json!({ "kind": kind_name(w.kind), "from": id_json(&w.from), "key": w.key })).collect::<Vec<_>>() })
}
/// The result in the DTO shape of contract §2 (camelCase), field by field.
pub fn dto(r: &GraphResult) -> Value {
    json!({ "nodes": r.nodes.iter().map(node_json).collect::<Vec<_>>(), "edges": r.edges.iter().map(edge_json).collect::<Vec<_>>(),
            "total": r.total, "unfiltered": r.unfiltered, "hidden": r.hidden, "truncated": r.truncated,
            "typeCounts": r.type_counts.iter().map(|(k, n)| json!([k, n])).collect::<Vec<_>>() })
}

pub fn golden() -> Value {
    let p = repo_root().join("tests/fixtures/vaults/graph-golden/expected.json");
    serde_json::from_slice(&std::fs::read(p).expect("setup: golden")).expect("setup: golden JSON")
}
/// A golden scenario's request.
pub fn golden_req(s: &Value) -> GraphRequest {
    let r = &s["req"];
    GraphRequest {
        centre: r["centre"].as_str().expect("setup: centre").to_string(),
        depth: r["depth"].as_u64().expect("setup: depth") as u8,
        hidden_types: r["hiddenTypes"].as_array().expect("setup").iter().map(|v| v.as_str().expect("setup").to_string()).collect(),
        hidden_kinds: r["hiddenKinds"].as_array().expect("setup").iter().map(|v| kind(v.as_str().expect("setup"))).collect(),
        cap: r["cap"].as_u64().expect("setup") as usize,
        show_all: r["showAll"].as_bool().expect("setup"),
        ..Default::default()
    }
}
/// A golden scenario expanded to the DTO (graph-golden/README.md). `with_type_counts`: false leaves `typeCounts` out
/// (the index alone doesn't know the vault's type definitions; the core test checks them).
pub fn golden_dto(g: &Value, s: &Value) -> Value {
    let nodes: Vec<Value> = s["nodes"]
        .as_array()
        .expect("setup")
        .iter()
        .map(|nd| {
            let mut n = g["nodes"][nd[0].as_str().expect("setup")].clone();
            n["depth"] = nd[1].clone();
            n
        })
        .collect();
    let edges: Vec<Value> = s["edges"]
        .as_array()
        .expect("setup")
        .iter()
        .map(|id| {
            let id = id.as_str().expect("setup");
            let mut e = g["edges"][id].clone();
            if let Some(st) = s["styles"].get(id) {
                e["style"] = st.clone();
            }
            e
        })
        .collect();
    let order = g["typeOrder"].as_array().expect("setup");
    let counts = s["typeCounts"].as_array().expect("setup");
    let tc: Vec<Value> = order.iter().zip(counts.iter()).map(|(k, n)| json!([k, n])).collect();
    json!({ "nodes": nodes, "edges": edges, "total": s["total"], "unfiltered": s["unfiltered"], "hidden": s["hidden"], "truncated": s["truncated"], "typeCounts": tc })
}
/// `typeCounts` as a map without the zero entries (what the index alone can know).
pub fn nonzero_counts(v: &Value) -> BTreeMap<String, u64> {
    v["typeCounts"].as_array().map(|a| a.iter().filter(|x| x[1].as_u64().unwrap_or(0) > 0).map(|x| (x[0].as_str().unwrap_or("").to_string(), x[1].as_u64().unwrap_or(0))).collect()).unwrap_or_default()
}
pub fn without_counts(v: &Value) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("typeCounts");
    }
    v
}

/// Node sort keys with depths, in result order.
pub fn node_list(r: &GraphResult) -> Vec<(String, u8)> {
    r.nodes.iter().map(|n| (sort_key(&n.id), n.depth)).collect()
}
/// Unordered pairs of sort keys.
pub fn pair(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}
pub fn edge_pairs(r: &GraphResult) -> Vec<(String, String)> {
    r.edges.iter().map(|e| pair(&sort_key(&e.a), &sort_key(&e.b))).collect()
}
pub fn edge<'a>(r: &'a GraphResult, a: &NodeId, b: &NodeId) -> Option<&'a GraphEdge> {
    r.edges.iter().find(|e| (&e.a == a && &e.b == b) || (&e.a == b && &e.b == a))
}
pub fn node<'a>(r: &'a GraphResult, id: &NodeId) -> Option<&'a GraphNode> {
    r.nodes.iter().find(|n| &n.id == id)
}
