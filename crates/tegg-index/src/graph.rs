//! Slice G1 (docs/contracts/v1-graph.md §1; D-900…D-905, D-911, D-971…D-979, D-994, D-999): the local graph's
//! neighbourhood query, plain Rust over the index's links and tags (AR-03: no Tauri or desktop dependency). It reads
//! only the index: no vault file, no recency (D-138).
//!
//! The vault-wide graph (`GraphData`: one node per object or tag key, one entry per joined pair with every way it is
//! joined) is derived from the index on first use and dropped on every index change, like the link caches; nothing
//! of it is stored, so a rebuilt index gives the same answers (AR-01). A query walks that graph without the index
//! lock (the core clones the `Arc`), so a new request from the same window can cancel it (§1.5).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tegg_format::nfc;

use crate::{is_note_target, Index, Resolved};

/// The four connection kinds (R108). Strength order: Embed > Relation > Link > Tag (D-902).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Link,
    Relation,
    Embed,
    Tag,
}

impl EdgeKind {
    /// D-902: 0 is the strongest.
    fn strength(self) -> u8 {
        match self {
            EdgeKind::Embed => 0,
            EdgeKind::Relation => 1,
            EdgeKind::Link => 2,
            EdgeKind::Tag => 3,
        }
    }
}

/// A node: an object by its vault path (NFC), or a tag node by its key (D-974). Serializes as `{"path": …}` or
/// `{"tag": …}` (§1.6).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeId {
    Path(String),
    Tag(String),
}

impl NodeId {
    /// §1.6: the path for objects, `tag:<key>` for tag nodes, compared by code points.
    pub fn sort_key(&self) -> String {
        match self {
            NodeId::Path(p) => p.clone(),
            NodeId::Tag(k) => format!("tag:{k}"),
        }
    }
}

/// §1.5: set → the query ends with `Err(Cancelled)`; checked between BFS levels and every 256 rows.
pub type CancelFlag = Arc<AtomicBool>;

/// §1.5 test hook (L4 only, D-996): run after each BFS level with the level just finished (1, 2, …), so a test can
/// set the flag or start a second request at a known point (FR-GRP-01 AC-9).
#[cfg(any(test, feature = "test-hooks"))]
#[derive(Clone)]
pub struct PauseHook(pub Arc<dyn Fn(u8) + Send + Sync>);

#[cfg(any(test, feature = "test-hooks"))]
impl std::fmt::Debug for PauseHook {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PauseHook")
    }
}

/// §1. Construct with `..Default::default()` so the test-hook field stays optional.
#[derive(Debug, Clone, Default)]
pub struct GraphRequest {
    /// Vault path, NFC (D-914).
    pub centre: String,
    /// 1..=3; anything else → `InvalidDepth`.
    pub depth: u8,
    /// Type keys, `tag` for tag nodes; unknown keys are ignored (D-977).
    pub hidden_types: Vec<String>,
    pub hidden_kinds: Vec<EdgeKind>,
    /// 150 in the full view (D-912); G2 passes 60.
    pub cap: usize,
    /// D-979: draw the whole walk up to 1,000.
    pub show_all: bool,
    /// D-994: the D-977 type list without counts, filled by the core from the type definitions; `type_counts`
    /// follows it. Empty: the counted keys only, by code point.
    pub type_order: Vec<String>,
    #[cfg(any(test, feature = "test-hooks"))]
    pub pause: Option<PauseHook>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphResult {
    /// The kept nodes, in walk order: depth, then degree desc, then sort key (R111, §1.6).
    pub nodes: Vec<GraphNode>,
    /// Every edge among kept nodes with a visible kind (D-974, D-973).
    pub edges: Vec<GraphEdge>,
    /// The filtered walk at this depth, centre included.
    pub total: usize,
    /// The walk with no filter, centre included.
    pub unfiltered: usize,
    /// `unfiltered − total` (D-976).
    pub hidden: usize,
    /// The cap dropped nodes.
    pub truncated: bool,
    /// Every type key of the vault (§1.7) with its count in the unfiltered walk, centre included (D-976).
    pub type_counts: Vec<(String, usize)>,
    /// D-999: the filtered total at each depth from 1 to the requested one, centre included.
    pub depth_totals: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphNode {
    pub id: NodeId,
    /// The frontmatter `id` (NFC), if any; tag nodes: the winning Tag file's id.
    pub object_id: Option<String>,
    /// NFC; None for a virtual tag (D-694); the winning Tag file for a tag with a file.
    pub path: Option<String>,
    /// Title, else the stem (D-103, D-990); a tag: its display name (D-711).
    pub title: String,
    /// `tag` for tag nodes; the raw value for an undefined type (D-121).
    pub type_key: String,
    pub depth: u8,
    /// Vault-wide (D-975).
    pub degree: usize,
    pub tag_key: Option<String>,
    /// Tag nodes: one of the eight tokens, else None (D-707).
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GraphEdge {
    /// `a` < `b` by sort key (§1.6).
    pub a: NodeId,
    pub b: NodeId,
    /// Every way the pair is joined, visible or not (§1.6 order).
    pub ways: Vec<EdgeWay>,
    /// The strongest visible kind (D-973).
    pub style: EdgeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct EdgeWay {
    pub kind: EdgeKind,
    /// The object that holds the reference.
    pub from: NodeId,
    /// The frontmatter key for a Relation (D-971).
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphError {
    CentreNotFound,
    CentreInTrash { title: String },
    InvalidDepth,
    Cancelled,
    NotReady,
}

/// The eight type colour tokens (types.md R14, D-236, D-707).
const TAG_COLORS: [&str; 8] = ["gray", "blue", "green", "orange", "purple", "red", "teal", "yellow"];
/// D-971: frontmatter keys whose links are never edges (`file:` is the object itself; `icon`, `cover` unused, D-217).
const NOT_EDGE_KEYS: [&str; 3] = ["file", "icon", "cover"];
/// D-912: `Show all` and depth 1 never draw more.
const MAX_DRAWN: usize = 1000;

#[derive(Debug, Clone)]
struct NodeInfo {
    object_id: Option<String>,
    path: Option<String>,
    title: String,
    type_key: String,
    tag_key: Option<String>,
    color: Option<String>,
    /// D-903: Tag nodes and Daily Notes are shown but not walked through (the centre always is).
    leaf: bool,
}

/// The vault-wide graph derived from the index (see the module comment).
#[derive(Debug, Default)]
pub struct GraphData {
    nodes: HashMap<NodeId, NodeInfo>,
    /// Neighbours per node, by sort key (deterministic walks).
    adj: HashMap<NodeId, Vec<NodeId>>,
    /// Ways per pair, keyed `(a, b)` with `a` < `b` by sort key, §1.6 order.
    pairs: HashMap<(NodeId, NodeId), Vec<EdgeWay>>,
    /// NFC path → node (a winning Tag file is its tag node; losing Tag files are absent, D-694).
    by_path: HashMap<String, NodeId>,
    /// §1.7: every type key of the indexed objects (NFC), sorted.
    type_keys: Vec<String>,
}

fn ordered(a: NodeId, b: NodeId) -> (NodeId, NodeId) {
    if a.sort_key() <= b.sort_key() {
        (a, b)
    } else {
        (b, a)
    }
}

fn instant_ns(v: Option<&Value>) -> Option<i128> {
    let s = v?.as_str()?.trim();
    chrono::DateTime::parse_from_rfc3339(s).ok().and_then(|d| d.timestamp_nanos_opt()).map(|n| n as i128)
}
fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(nfc)
}
fn stem(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    nfc(base.strip_suffix(".md").unwrap_or(base))
}
/// The file name a link names (alias and subpath removed), NFC, lower case: how an attachment link finds its object.
fn file_name_key(target: &str) -> String {
    let t = target.split('|').next().unwrap_or(target).split('#').next().unwrap_or(target).trim();
    nfc(t.rsplit('/').next().unwrap_or(t)).to_lowercase()
}

impl GraphData {
    fn build(idx: &Index) -> GraphData {
        let mut keyed: Vec<(String, &crate::Meta)> = idx.metas.values().map(|m| (nfc(&m.path), m)).collect();
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
        let metas: Vec<&crate::Meta> = keyed.into_iter().map(|(_, m)| m).collect();

        // Tag files per key (ms4-tags §1.1): the oldest valid `created` wins, then path order.
        let mut tag_files: BTreeMap<String, Vec<(Option<i128>, String)>> = BTreeMap::new();
        for m in metas.iter().filter(|m| m.s.r#type == "tag" && m.s.type_single) {
            let name = text(m.s.attributes.get("title")).unwrap_or_else(|| stem(&m.path));
            tag_files.entry(tegg_format::tag_key(&name)).or_default().push((instant_ns(m.s.attributes.get("created")), nfc(&m.path)));
        }
        for v in tag_files.values_mut() {
            v.sort_by(|a, b| match (a.0, b.0) {
                (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.1.cmp(&b.1)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.1.cmp(&b.1),
            });
        }
        let winner_of: HashMap<String, String> = tag_files.iter().map(|(k, v)| (v[0].1.clone(), k.clone())).collect();
        let losers: HashSet<String> = tag_files.values().flat_map(|v| v.iter().skip(1).map(|(_, p)| p.clone())).collect();
        let by_nfc: HashMap<String, &crate::Meta> = metas.iter().map(|m| (nfc(&m.path), *m)).collect();

        let mut g = GraphData { type_keys: metas.iter().map(|m| nfc(&m.s.r#type)).collect::<BTreeSet<_>>().into_iter().collect(), ..GraphData::default() };
        for m in &metas {
            let path = nfc(&m.path);
            if losers.contains(&path) || winner_of.contains_key(&path) {
                continue;
            }
            let id = NodeId::Path(path.clone());
            g.by_path.insert(path.clone(), id.clone());
            g.nodes.insert(
                id,
                NodeInfo {
                    object_id: m.s.id.as_deref().map(nfc),
                    path: Some(path),
                    title: nfc(&m.s.title),
                    type_key: nfc(&m.s.r#type),
                    tag_key: None,
                    color: None,
                    leaf: m.s.r#type == "daily-note",
                },
            );
        }
        // Tag nodes: every key with an occurrence or a Tag file (D-694, D-711).
        let spellings: HashMap<String, String> = idx.tags().into_iter().map(|t| (t.key, t.spelling)).collect();
        let mut keys: BTreeSet<String> = spellings.keys().cloned().collect();
        keys.extend(tag_files.keys().cloned());
        for key in keys {
            let winner = tag_files.get(&key).and_then(|v| v.first()).and_then(|(_, p)| by_nfc.get(p).copied());
            let id = NodeId::Tag(key.clone());
            let (object_id, path, title, color) = match winner {
                Some(w) => (
                    w.s.id.as_deref().map(nfc),
                    Some(nfc(&w.path)),
                    text(w.s.attributes.get("title")).unwrap_or_else(|| stem(&w.path)),
                    text(w.s.attributes.get("color")).map(|c| c.to_lowercase()).filter(|c| TAG_COLORS.contains(&c.as_str())),
                ),
                None => (None, None, spellings.get(&key).map(|s| nfc(s)).unwrap_or_else(|| key.clone()), None),
            };
            if let Some(p) = &path {
                g.by_path.insert(p.clone(), id.clone());
            }
            g.nodes.insert(id, NodeInfo { object_id, path, title, type_key: "tag".into(), tag_key: Some(key), color, leaf: true });
        }
        // Image and PDF objects by the file their `file:` names (FR-ATT-07: an attachment embed is an embed of them).
        let mut media: HashMap<String, NodeId> = HashMap::new();
        for m in metas.iter().filter(|m| matches!(m.s.r#type.as_str(), "image" | "pdf")) {
            let Some(id) = g.by_path.get(&nfc(&m.path)).cloned() else { continue };
            for (i, t) in m.s.links.iter().enumerate() {
                if m.s.link_attrs.get(i).and_then(|a| a.as_deref()) == Some("file") {
                    media.entry(file_name_key(t)).or_insert_with(|| id.clone());
                }
            }
        }

        let mut ways: HashMap<(NodeId, NodeId), BTreeSet<(u8, String, Option<String>, NodeId, EdgeKind)>> = HashMap::new();
        let mut add = |from: &NodeId, to: NodeId, kind: EdgeKind, key: Option<String>| {
            if *from == to {
                return;
            }
            ways.entry(ordered(from.clone(), to)).or_default().insert((kind.strength(), from.sort_key(), key, from.clone(), kind));
        };
        idx.with_links(|l| {
            for m in &metas {
                let Some(from) = g.by_path.get(&nfc(&m.path)).cloned() else { continue };
                let res = l.resolved.get(&m.path);
                for (i, t) in m.s.links.iter().enumerate() {
                    let attr = m.s.link_attrs.get(i).cloned().flatten();
                    let (kind, key) = match &attr {
                        Some(k) if NOT_EDGE_KEYS.contains(&k.as_str()) => continue,
                        Some(k) => (EdgeKind::Relation, Some(nfc(k))),
                        None if m.s.link_meta.get(i).is_some_and(|x| x.embed) => (EdgeKind::Embed, None),
                        None => (EdgeKind::Link, None),
                    };
                    let to = match res.and_then(|r| r.get(i)) {
                        Some(Resolved::Note(p) | Resolved::Daily(p)) => g.by_path.get(&nfc(p)).cloned(),
                        Some(Resolved::Unresolved) if !is_note_target(t) => media.get(&file_name_key(t)).cloned(),
                        _ => None,
                    };
                    if let Some(to) = to {
                        add(&from, to, kind, key);
                    }
                }
                for k in &m.s.tags {
                    let to = NodeId::Tag(nfc(k));
                    if g.nodes.contains_key(&to) {
                        add(&from, to, EdgeKind::Tag, None);
                    }
                }
            }
        });
        for ((a, b), set) in ways {
            g.adj.entry(a.clone()).or_default().push(b.clone());
            g.adj.entry(b.clone()).or_default().push(a.clone());
            g.pairs.insert((a, b), set.into_iter().map(|(_, _, key, from, kind)| EdgeWay { kind, from, key }).collect());
        }
        for v in g.adj.values_mut() {
            v.sort_by_key(|n| n.sort_key());
        }
        g
    }

    fn degree(&self, id: &NodeId) -> usize {
        self.adj.get(id).map_or(0, Vec::len)
    }

    fn ways(&self, a: &NodeId, b: &NodeId) -> &[EdgeWay] {
        self.pairs.get(&ordered(a.clone(), b.clone())).map_or(&[], Vec::as_slice)
    }

    /// The node a request or a caller names: a path (a winning Tag file → its tag node), or a tag key.
    fn resolve(&self, id: &NodeId) -> Option<NodeId> {
        match id {
            NodeId::Path(p) => self.by_path.get(&nfc(p)).cloned(),
            NodeId::Tag(k) => {
                let id = NodeId::Tag(nfc(k));
                self.nodes.contains_key(&id).then_some(id)
            }
        }
    }

    /// §1.7: every type key of the indexed objects (NFC), sorted.
    pub fn type_keys(&self) -> &[String] {
        &self.type_keys
    }

    /// D-975: the vault-wide degree of a node (0 for an unknown one).
    pub fn degree_of(&self, id: &NodeId) -> usize {
        self.resolve(id).map_or(0, |n| self.degree(&n))
    }

    /// §1.2: breadth-first from the centre; `filter` applies the hidden types and kinds. Returns each reached node
    /// with its depth, in discovery order.
    fn walk(&self, centre: &NodeId, depth: u8, filter: Option<(&HashSet<String>, &HashSet<EdgeKind>)>, cancel: &CancelFlag, req: &GraphRequest) -> Result<Vec<(NodeId, u8)>, GraphError> {
        let mut seen: HashSet<NodeId> = HashSet::from([centre.clone()]);
        let mut out = vec![(centre.clone(), 0u8)];
        let mut frontier = vec![centre.clone()];
        let mut rows = 0usize;
        for level in 1..=depth {
            let mut next = Vec::new();
            for n in &frontier {
                if n != centre && self.nodes.get(n).is_some_and(|i| i.leaf) {
                    continue;
                }
                for m in self.adj.get(n).map_or(&[][..], Vec::as_slice) {
                    rows += 1;
                    if rows % 256 == 0 && cancel.load(Ordering::SeqCst) {
                        return Err(GraphError::Cancelled);
                    }
                    if seen.contains(m) {
                        continue;
                    }
                    if let Some((types, kinds)) = filter {
                        if self.nodes.get(m).is_some_and(|i| types.contains(&i.type_key)) {
                            continue;
                        }
                        if self.ways(n, m).iter().all(|w| kinds.contains(&w.kind)) {
                            continue;
                        }
                    }
                    seen.insert(m.clone());
                    out.push((m.clone(), level));
                    next.push(m.clone());
                }
            }
            if filter.is_some() {
                #[cfg(any(test, feature = "test-hooks"))]
                if let Some(h) = &req.pause {
                    (h.0)(level);
                }
            }
            if cancel.load(Ordering::SeqCst) {
                return Err(GraphError::Cancelled);
            }
            frontier = next;
        }
        let _ = req;
        Ok(out)
    }

    /// §1, §1.3, §1.6: the neighbourhood of `req.centre`.
    pub fn query(&self, req: &GraphRequest, cancel: &CancelFlag) -> Result<GraphResult, GraphError> {
        if !(1..=3).contains(&req.depth) {
            return Err(GraphError::InvalidDepth);
        }
        let centre = self.resolve(&NodeId::Path(req.centre.clone())).ok_or(GraphError::CentreNotFound)?;
        let types: HashSet<String> = req.hidden_types.iter().map(|t| nfc(t)).collect();
        let kinds: HashSet<EdgeKind> = req.hidden_kinds.iter().copied().collect();
        let filtered = self.walk(&centre, req.depth, Some((&types, &kinds)), cancel, req)?;
        let unfiltered = self.walk(&centre, req.depth, None, cancel, req)?;
        let visible = |a: &NodeId, b: &NodeId| self.ways(a, b).iter().any(|w| !kinds.contains(&w.kind));

        let depth_of: HashMap<NodeId, u8> = filtered.iter().cloned().collect();
        let rank = |a: &(NodeId, u8), b: &(NodeId, u8)| a.1.cmp(&b.1).then_with(|| self.degree(&b.0).cmp(&self.degree(&a.0))).then_with(|| a.0.sort_key().cmp(&b.0.sort_key()));
        let mut ranked = filtered.clone();
        ranked.sort_by(rank);
        let total = filtered.len();
        let kept: Vec<(NodeId, u8)> = if total <= req.cap || (req.show_all && total <= MAX_DRAWN) {
            ranked
        } else {
            // R111: the centre and depth 1 (at most 1,000), then depth by depth while a place is free, each with a
            // kept neighbour one step closer.
            let mut kept: Vec<(NodeId, u8)> = ranked.iter().filter(|x| x.1 == 0).cloned().collect();
            kept.extend(ranked.iter().filter(|x| x.1 == 1).take(MAX_DRAWN).cloned());
            let mut kept_set: HashSet<NodeId> = kept.iter().map(|x| x.0.clone()).collect();
            for d in 2..=req.depth {
                for (n, nd) in ranked.iter().filter(|x| x.1 == d) {
                    if kept.len() >= req.cap {
                        break;
                    }
                    let near = self.adj.get(n).is_some_and(|v| v.iter().any(|m| depth_of.get(m) == Some(&(d - 1)) && kept_set.contains(m) && visible(n, m)));
                    if near {
                        kept_set.insert(n.clone());
                        kept.push((n.clone(), *nd));
                    }
                }
            }
            kept
        };
        let truncated = kept.len() < total;
        let kept_set: HashSet<&NodeId> = kept.iter().map(|x| &x.0).collect();

        let nodes: Vec<GraphNode> = kept
            .iter()
            .map(|(id, d)| {
                let i = &self.nodes[id];
                GraphNode {
                    id: id.clone(),
                    object_id: i.object_id.clone(),
                    path: i.path.clone(),
                    title: i.title.clone(),
                    type_key: i.type_key.clone(),
                    depth: *d,
                    degree: self.degree(id),
                    tag_key: i.tag_key.clone(),
                    color: i.color.clone(),
                }
            })
            .collect();
        let mut edges: Vec<GraphEdge> = Vec::new();
        for (a, _) in &kept {
            for b in self.adj.get(a).map_or(&[][..], Vec::as_slice) {
                if !kept_set.contains(b) || a.sort_key() >= b.sort_key() {
                    continue;
                }
                let ways = self.ways(a, b);
                let Some(style) = ways.iter().filter(|w| !kinds.contains(&w.kind)).map(|w| w.kind).min_by_key(|k| k.strength()) else { continue };
                edges.push(GraphEdge { a: a.clone(), b: b.clone(), ways: ways.to_vec(), style });
            }
        }
        edges.sort_by(|x, y| (x.a.sort_key(), x.b.sort_key()).cmp(&(y.a.sort_key(), y.b.sort_key())));

        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for (id, _) in &unfiltered {
            *counts.entry(self.nodes[id].type_key.clone()).or_default() += 1;
        }
        let mut type_counts: Vec<(String, usize)> = req.type_order.iter().map(|k| (k.clone(), counts.remove(k).unwrap_or(0))).collect();
        type_counts.extend(counts);
        let depth_totals = (1..=req.depth).map(|d| filtered.iter().filter(|x| x.1 <= d).count()).collect();
        Ok(GraphResult { nodes, edges, total, unfiltered: unfiltered.len(), hidden: unfiltered.len() - total, truncated, type_counts, depth_totals })
    }
}

impl Index {
    /// The vault-wide graph, derived on first use after a change (module comment).
    pub fn graph_data(&self) -> Arc<GraphData> {
        if let Some(g) = self.graph.borrow().as_ref() {
            return g.clone();
        }
        let g = Arc::new(GraphData::build(self));
        *self.graph.borrow_mut() = Some(g.clone());
        g
    }

    /// §1: the neighbourhood of `req.centre`.
    pub fn graph_neighbourhood(&self, req: &GraphRequest, cancel: &CancelFlag) -> Result<GraphResult, GraphError> {
        self.graph_data().query(req, cancel)
    }

    /// Vault-wide degree of one object (D-975); the same number as `GraphNode.degree`.
    pub fn graph_degree(&self, id: &NodeId) -> usize {
        self.graph_data().degree_of(id)
    }

    /// §1.7: every type key of the indexed objects (NFC), sorted; the core adds the undefined ones to the type list.
    pub fn type_keys(&self) -> Vec<String> {
        let keys: BTreeSet<String> = self.metas.values().map(|m| nfc(&m.s.r#type)).collect();
        keys.into_iter().collect()
    }
}
