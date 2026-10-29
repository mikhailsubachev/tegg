//! Slice G1 (docs/contracts/v1-graph.md §1; D-900…D-905, D-911, D-971…D-979): the local graph's neighbourhood query,
//! plain Rust over the index's link and tag tables (AR-03: no Tauri or desktop dependency). It reads only the index:
//! no vault file, no recency (D-138).
//!
//! STUB (G1 red tests, TS-I1): the types are the contract's; `graph_neighbourhood` answers `Err(NotImplemented)` and
//! `graph_degree` answers 0 until slice G1 is built. The `NotImplemented` variant is removed by the build.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::Serialize;

use crate::Index;

/// The four connection kinds (R108). Strength order: Embed > Relation > Link > Tag (D-902).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    Link,
    Relation,
    Embed,
    Tag,
}

/// A node: an object by its vault path (NFC), or a tag node by its key (D-974). Serializes as `{"path": …}` or
/// `{"tag": …}` (§1.6).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeId {
    Path(String),
    Tag(String),
}

/// §1.5: set → the query ends with `Err(Cancelled)`; checked between BFS levels and every 256 rows.
pub type CancelFlag = Arc<AtomicBool>;

/// §1.5 test hook (L4 only): run after each BFS level with the level just finished (1, 2, …), so a test can set the
/// flag or start a second request at a known point (FR-GRP-01 AC-9).
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
    /// STUB: until slice G1 is built (TS-I1); removed by the build.
    NotImplemented,
}

impl Index {
    /// §1: the neighbourhood of `req.centre`. STUB until G1 is built.
    pub fn graph_neighbourhood(&self, req: &GraphRequest, cancel: &CancelFlag) -> Result<GraphResult, GraphError> {
        let _ = (req, cancel);
        Err(GraphError::NotImplemented)
    }

    /// Vault-wide degree of one object (D-975); the same number as `GraphNode.degree`. STUB until G1 is built.
    pub fn graph_degree(&self, id: &NodeId) -> usize {
        let _ = id;
        0
    }
}
