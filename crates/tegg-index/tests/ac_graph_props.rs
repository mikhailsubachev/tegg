//! Slice G1 property tests (L2) of the neighbourhood query (docs/acceptance/graph.md R108; docs/contracts/v1-graph.md
//! §1.1…§1.3): FR-GRP-01 AC-2 (templates, trash, self-links and unresolved links are never in a result), AC-4 (depth is
//! the shortest distance in the graph where tag nodes and Daily Notes other than the centre have no onward step; every
//! node at depth ≥ 2 has a neighbour one step closer that is the centre or not a leaf), AC-6 (every edge among drawn
//! nodes with a visible kind is returned, none with an end outside), FR-GRP-02 AC-2 (hidden types are not entered, every
//! drawn node is joined to the centre through drawn nodes, `hidden = unfiltered − total`). Written from the ACs and the
//! contract only (D-61).
//!
//! Random vaults are synthetic (Czech titles, D-50) and small (never above the 150 cap), built in memory: every object
//! has a unique title equal to its stem, so a `[[title]]` link resolves to exactly that object. The test keeps its own
//! list of the references it wrote (the model) and checks the query against the graph those references make.
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 steps. Every seed is printed (`seed = N`).

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use tegg_index::{CancelFlag, EdgeKind, GraphRequest, GraphResult, Index, NodeId};
use tegg_vault::FileVersion;

const FIXED_SEED: u64 = 20_261_029;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}
fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn seeds() -> Vec<u64> {
    let r = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    });
    if scale() >= 100 {
        (0..10).map(|i| if i == 0 { FIXED_SEED } else { r.wrapping_add(i) }).collect()
    } else {
        vec![FIXED_SEED, r]
    }
}
fn steps() -> usize {
    if scale() >= 100 {
        1000
    } else {
        8
    }
}

const STEMS: [&str; 12] = ["Čtení", "Řeka", "Žába", "Úkol", "Šnek", "Ďábel", "Kůň", "Ťuk", "Měsíc", "Níže", "Dům", "Píseň"];
const TAGS: [&str; 3] = ["účty", "zdraví", "výlet"];

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Key {
    Obj(usize),
    Tag(&'static str),
}

struct Obj {
    path: String,
    title: String,
    ty: &'static str,
    daily: bool,
}

/// A random vault: its files and the references the generator wrote (`(from, to, kind)`, `to` an object or tag).
struct World {
    objs: Vec<Obj>,
    files: Vec<(String, String)>,
    refs: Vec<(usize, Key, EdgeKind)>,
}

fn world(rng: &mut Rng) -> World {
    let n = 4 + rng.below(12);
    let mut objs = Vec::new();
    for i in 0..n {
        let kind = rng.below(5);
        let (ty, daily) = match kind {
            0 => ("daily-note", true),
            1 => ("task", false),
            2 => ("projekt", false),
            _ => ("page", false),
        };
        let title = if daily { format!("2026-10-{:02}", 1 + i) } else { format!("{} {i}", STEMS[rng.below(STEMS.len())]) };
        let folder = match ty {
            "daily-note" => "Daily",
            "task" => "Tasks",
            "projekt" => "Projekty",
            _ => "Pages",
        };
        objs.push(Obj { path: format!("{folder}/{title}.md"), title, ty, daily });
    }
    let mut refs = Vec::new();
    let mut files = Vec::new();
    for i in 0..n {
        let mut body = String::new();
        let mut front = format!("---\nid: 01JBGP{:020}\ntype: {}\ntitle: {}\n", i, objs[i].ty, objs[i].title);
        if objs[i].daily {
            front.push_str(&format!("date: {}\n", objs[i].title));
        }
        let mut tags = Vec::new();
        for t in TAGS {
            if rng.chance(20) {
                tags.push(t);
                refs.push((i, Key::Tag(t), EdgeKind::Tag));
            }
        }
        if !tags.is_empty() {
            front.push_str(&format!("tags: [{}]\n", tags.join(", ")));
        }
        if rng.chance(30) {
            let j = rng.below(n);
            front.push_str(&format!("vztah: \"[[{}]]\"\n", objs[j].title));
            if j != i {
                refs.push((i, Key::Obj(j), EdgeKind::Relation));
            }
        }
        front.push_str("---\n");
        for _ in 0..rng.below(4) {
            let j = rng.below(n);
            let embed = rng.chance(25);
            body.push_str(&format!("{}[[{}]] text. ", if embed { "!" } else { "" }, objs[j].title));
            if j != i {
                refs.push((i, Key::Obj(j), if embed { EdgeKind::Embed } else { EdgeKind::Link }));
            }
        }
        if rng.chance(30) {
            body.push_str(&format!("[[{}]] ", objs[i].title)); // self-link
        }
        if rng.chance(30) {
            body.push_str("[[Nikde nic]] [[2026-12-31]] "); // unresolved, a date without a note
        }
        if rng.chance(20) {
            let t = TAGS[rng.below(TAGS.len())];
            body.push_str(&format!("#{t} "));
            refs.push((i, Key::Tag(t), EdgeKind::Tag));
        }
        files.push((objs[i].path.clone(), format!("{front}{body}\n")));
    }
    // Templates and the trash link and tag everything; they never count.
    let all: Vec<String> = objs.iter().map(|o| format!("[[{}]]", o.title)).collect();
    files.push(("_templates/Page/Šablona.md".into(), format!("---\ntype: page\ntags: [účty, zdraví]\n---\n{}\n", all.join(" "))));
    files.push(("_templates/Page/Šablona.md".replace("Šablona", "Druhá"), format!("{}\n", all.join(" "))));
    files.push((".trash/Pages/Smazaná.md".into(), format!("---\ntype: page\ntags: [výlet]\n---\n{} #účty\n", all.join(" "))));
    World { objs, files, refs }
}

fn version(bytes: &[u8]) -> FileVersion {
    let mut hash = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        hash[i % 32] ^= *b;
    }
    FileVersion { mtime_ns: 1_790_000_000_000_000_000, size: bytes.len() as u64, hash }
}
fn build(w: &World, dir: &std::path::Path) -> Index {
    let mut idx = Index::open(&dir.join("index.sqlite")).expect("setup: Index::open");
    for (p, t) in &w.files {
        idx.upsert(p, t.as_bytes(), &version(t.as_bytes())).expect("setup: upsert");
    }
    idx
}
fn nfc(s: &str) -> String {
    tegg_format::nfc(s)
}
fn key_of(w: &World, k: &Key) -> String {
    match k {
        Key::Obj(i) => nfc(&w.objs[*i].path),
        Key::Tag(t) => format!("tag:{}", nfc(t)),
    }
}
fn sk(id: &NodeId) -> String {
    match id {
        NodeId::Path(p) => p.clone(),
        NodeId::Tag(k) => format!("tag:{k}"),
    }
}

/// The model: pair → kinds, from the generator's references.
fn pairs(w: &World) -> BTreeMap<(String, String), BTreeSet<EdgeKind>> {
    let mut out: BTreeMap<(String, String), BTreeSet<EdgeKind>> = BTreeMap::new();
    for (from, to, kind) in &w.refs {
        let (a, b) = (key_of(w, &Key::Obj(*from)), key_of(w, to));
        let pair = if a <= b { (a, b) } else { (b, a) };
        out.entry(pair).or_default().insert(*kind);
    }
    out
}
fn is_leaf(w: &World, key: &str) -> bool {
    key.starts_with("tag:") || w.objs.iter().any(|o| o.daily && nfc(&o.path) == key)
}
fn type_of(w: &World, key: &str) -> String {
    if key.starts_with("tag:") {
        return "tag".into();
    }
    w.objs.iter().find(|o| nfc(&o.path) == key).map(|o| o.ty.to_string()).unwrap_or_default()
}
/// The walk the criteria describe, over the model: BFS from the centre over pairs with a visible kind, not entering
/// hidden types, leaves (tags, Daily Notes) not expanded unless they are the centre.
fn model_walk(w: &World, centre: &str, depth: u8, hidden_types: &[String], hidden_kinds: &[EdgeKind]) -> BTreeMap<String, u8> {
    let pairs = pairs(w);
    let mut adj: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for ((a, b), kinds) in &pairs {
        if kinds.iter().any(|k| !hidden_kinds.contains(k)) {
            adj.entry(a.clone()).or_default().insert(b.clone());
            adj.entry(b.clone()).or_default().insert(a.clone());
        }
    }
    let mut out = BTreeMap::from([(centre.to_string(), 0u8)]);
    let mut q = VecDeque::from([centre.to_string()]);
    while let Some(k) = q.pop_front() {
        let d = out[&k];
        if d >= depth || (k != centre && is_leaf(w, &k)) {
            continue;
        }
        for n in adj.get(&k).cloned().unwrap_or_default() {
            if out.contains_key(&n) || hidden_types.contains(&type_of(w, &n)) {
                continue;
            }
            out.insert(n.clone(), d + 1);
            q.push_back(n);
        }
    }
    out
}

struct Case {
    centre: String,
    depth: u8,
    hidden_types: Vec<String>,
    hidden_kinds: Vec<EdgeKind>,
}
fn case(w: &World, rng: &mut Rng) -> Case {
    let c = rng.below(w.objs.len());
    let mut hidden_types = Vec::new();
    for t in ["page", "task", "projekt", "daily-note", "tag"] {
        if rng.chance(15) {
            hidden_types.push(t.to_string());
        }
    }
    let mut hidden_kinds = Vec::new();
    for k in [EdgeKind::Link, EdgeKind::Relation, EdgeKind::Embed, EdgeKind::Tag] {
        if rng.chance(15) {
            hidden_kinds.push(k);
        }
    }
    Case { centre: nfc(&w.objs[c].path), depth: 1 + rng.below(3) as u8, hidden_types, hidden_kinds }
}
fn ask(idx: &Index, c: &Case) -> Option<GraphResult> {
    let r = GraphRequest { centre: c.centre.clone(), depth: c.depth, hidden_types: c.hidden_types.clone(), hidden_kinds: c.hidden_kinds.clone(), cap: 150, ..Default::default() };
    let flag: CancelFlag = Default::default();
    idx.graph_neighbourhood(&r, &flag).ok()
}

/// Runs `check` on random vaults and cases; returns the failures (seed, step, message).
fn property(check: impl Fn(&World, &Case, &GraphResult) -> Result<(), String>) -> Vec<String> {
    let mut bad = Vec::new();
    for seed in seeds() {
        println!("seed = {seed}");
        let mut rng = Rng::new(seed);
        for step in 0..steps() {
            let w = world(&mut rng);
            let dir = tempfile::tempdir().expect("setup: tempdir");
            let idx = build(&w, dir.path());
            for _ in 0..4 {
                let c = case(&w, &mut rng);
                match ask(&idx, &c) {
                    Some(r) => {
                        if let Err(m) = check(&w, &c, &r) {
                            bad.push(format!("seed {seed} step {step} centre {} d{} hidden {:?} {:?}: {m}", c.centre, c.depth, c.hidden_types, c.hidden_kinds));
                        }
                    }
                    None => bad.push(format!("seed {seed} step {step} centre {} d{}: no answer", c.centre, c.depth)),
                }
                if bad.len() > 5 {
                    return bad;
                }
            }
        }
    }
    bad
}

#[test]
fn fr_grp_01_ac2_templates_trash_unresolved_and_self_links_are_not_edges_property() {
    let bad = property(|_, _, r| {
        for n in &r.nodes {
            let p = n.path.clone().unwrap_or_default();
            if p.starts_with("_templates/") || p.starts_with(".trash/") {
                return Err(format!("node {p}"));
            }
            if n.title == "Nikde nic" || n.title == "2026-12-31" {
                return Err(format!("ghost node {}", n.title));
            }
        }
        if let Some(e) = r.edges.iter().find(|e| e.a == e.b) {
            return Err(format!("self-edge {}", sk(&e.a)));
        }
        Ok(())
    });
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn fr_grp_01_ac4_breadth_first_with_tags_and_daily_notes_as_leaves_property() {
    let bad = property(|w, c, r| {
        let got: BTreeMap<String, u8> = r.nodes.iter().map(|n| (sk(&n.id), n.depth)).collect();
        let want = model_walk(w, &c.centre, c.depth, &c.hidden_types, &c.hidden_kinds);
        if got != want {
            return Err(format!("nodes and depths {got:?}, want {want:?}"));
        }
        let adj: BTreeSet<(String, String)> = r.edges.iter().flat_map(|e| [(sk(&e.a), sk(&e.b)), (sk(&e.b), sk(&e.a))]).collect();
        for (k, d) in &got {
            if *d >= 2 && !got.iter().any(|(m, dm)| *dm == d - 1 && adj.contains(&(k.clone(), m.clone())) && (*m == c.centre || !is_leaf(w, m))) {
                return Err(format!("{k} at depth {d} has no neighbour one step closer that is the centre or not a leaf"));
            }
        }
        Ok(())
    });
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn fr_grp_01_ac6_all_edges_among_drawn_nodes_property() {
    let bad = property(|w, c, r| {
        let keys: BTreeSet<String> = r.nodes.iter().map(|n| sk(&n.id)).collect();
        let got: BTreeSet<(String, String)> = r.edges.iter().map(|e| (sk(&e.a), sk(&e.b))).collect();
        let want: BTreeSet<(String, String)> = pairs(w)
            .into_iter()
            .filter(|((a, b), kinds)| keys.contains(a) && keys.contains(b) && kinds.iter().any(|k| !c.hidden_kinds.contains(k)))
            .map(|(p, _)| p)
            .collect();
        if got != want {
            return Err(format!("edges {got:?}, want {want:?}"));
        }
        for e in &r.edges {
            let kinds: BTreeSet<EdgeKind> = e.ways.iter().map(|w| w.kind).collect();
            let model = pairs(w).get(&(sk(&e.a), sk(&e.b))).cloned().unwrap_or_default();
            if kinds != model {
                return Err(format!("{}–{} kinds {kinds:?}, want {model:?}", sk(&e.a), sk(&e.b)));
            }
        }
        Ok(())
    });
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn fr_grp_02_ac2_hidden_types_are_not_walked_property() {
    let bad = property(|w, c, r| {
        let Some(first) = r.nodes.first() else { return Err("no centre".into()) };
        if sk(&first.id) != c.centre {
            return Err(format!("the first node is {}, not the centre", sk(&first.id)));
        }
        for n in r.nodes.iter().skip(1) {
            if c.hidden_types.contains(&type_of(w, &sk(&n.id))) {
                return Err(format!("{} of a hidden type is drawn", sk(&n.id)));
            }
        }
        let mut seen = BTreeSet::from([c.centre.clone()]);
        loop {
            let before = seen.len();
            for e in &r.edges {
                let (a, b) = (sk(&e.a), sk(&e.b));
                if seen.contains(&a) {
                    seen.insert(b.clone());
                }
                if seen.contains(&b) {
                    seen.insert(a);
                }
            }
            if seen.len() == before {
                break;
            }
        }
        if seen.len() != r.nodes.len() {
            return Err("a drawn node is not joined to the centre through drawn nodes".into());
        }
        let unfiltered = model_walk(w, &c.centre, c.depth, &[], &[]).len();
        if (r.total, r.unfiltered, r.hidden) != (r.nodes.len(), unfiltered, unfiltered - r.nodes.len()) {
            return Err(format!("total {} unfiltered {} hidden {}; want {}, {unfiltered}, {}", r.total, r.unfiltered, r.hidden, r.nodes.len(), unfiltered - r.nodes.len()));
        }
        Ok(())
    });
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}
