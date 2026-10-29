//! Slice G1 (docs/contracts/v1-graph.md §1.5, §2; D-911, D-990): the local graph through the core. The query itself is
//! `tegg_index::graph`; the core keeps one in-flight request per window (a new request sets the previous one's
//! `CancelFlag` before it starts) and answers `NotReady` while the vault's first index build runs.
//!
//! STUB (G1 red tests, TS-I1): answers `Err(NotImplemented)` / 0 until slice G1 is built.

use crate::Core;
use tegg_index::{GraphError, GraphRequest, GraphResult, NodeId};

impl Core {
    /// §1.5, §2 `graph_neighbourhood`: read-only, no recency. `window` names the calling window (the shell passes the
    /// Tauri window label): a new call from the same window cancels the running one. STUB until G1 is built.
    pub fn graph_neighbourhood(&self, window: &str, req: &GraphRequest) -> Result<GraphResult, GraphError> {
        let _ = (window, req);
        Err(GraphError::NotImplemented)
    }

    /// D-975: the vault-wide degree of one node (the preview's `<n> connections`). STUB until G1 is built.
    pub fn graph_degree(&self, id: &NodeId) -> usize {
        let _ = id;
        0
    }
}
