//! Slice G1 (docs/contracts/v1-graph.md §1.5, §1.7, §2; D-911, D-990, D-994, D-995): the local graph through the core.
//! The query itself is `tegg_index::graph`; the core keeps one in-flight request per window (a new request sets the
//! previous one's `CancelFlag` before it starts), answers `NotReady` while the first build of an empty index runs,
//! fills the D-977 type order from the type definitions, and tells a trashed centre from a missing one.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tegg_format::nfc;
use tegg_index::{GraphError, GraphRequest, GraphResult, NodeId};

use crate::{lock, Core};

/// D-121: system types before and after the user types; then `tag` and the undefined values (D-977).
const FIRST: [&str; 4] = ["page", "task", "quick-note", "daily-note"];
const LAST: [&str; 2] = ["image", "pdf"];

impl Core {
    /// §1.5, §2 `graph_neighbourhood`: read-only, no recency. `window` names the calling window (the shell passes the
    /// Tauri window label): a new call from the same window cancels the running one.
    pub fn graph_neighbourhood(&self, window: &str, req: &GraphRequest) -> Result<GraphResult, GraphError> {
        if !self.shared.graph_ready.load(Ordering::SeqCst) {
            return Err(GraphError::NotReady);
        }
        let flag: tegg_index::CancelFlag = Arc::new(AtomicBool::new(false));
        if let Some(old) = lock(&self.shared.graph_flags).insert(window.to_string(), flag.clone()) {
            old.store(true, Ordering::SeqCst);
        }
        // The graph is an `Arc` snapshot: the walk runs without the index lock (§1.5).
        let data = lock(&self.shared.index).graph_data();
        let mut req = req.clone();
        if req.type_order.is_empty() {
            req.type_order = self.graph_type_order(&data);
        }
        let result = data.query(&req, &flag);
        {
            let mut flags = lock(&self.shared.graph_flags);
            if flags.get(window).is_some_and(|f| Arc::ptr_eq(f, &flag)) {
                flags.remove(window);
            }
        }
        match result {
            Err(GraphError::CentreNotFound) => Err(self.trashed_centre(&req.centre).map_or(GraphError::CentreNotFound, |title| GraphError::CentreInTrash { title })),
            other => other,
        }
    }

    /// D-975: the vault-wide degree of one node (the preview's `<n> connections`).
    pub fn graph_degree(&self, id: &NodeId) -> usize {
        lock(&self.shared.index).graph_degree(id)
    }

    /// D-977, D-994: defined types in D-121 order (user types by name), then `tag`, then undefined values. Reads the
    /// cached definitions and the graph's type keys: no file listing per request (NFR-PERF-11).
    fn graph_type_order(&self, data: &tegg_index::graph::GraphData) -> Vec<String> {
        let types: Vec<tegg_schema::TypeFile> = self.shared.type_defs().into_values().collect();
        let defined: std::collections::BTreeSet<String> = types.iter().map(|t| nfc(&t.key)).collect();
        let mut order: Vec<String> = FIRST.iter().filter(|k| defined.contains(**k)).map(|k| k.to_string()).collect();
        let mut user: Vec<(String, String)> = types
            .iter()
            .filter(|t| !t.system && !FIRST.contains(&t.key.as_str()) && !LAST.contains(&t.key.as_str()) && t.key != "tag")
            .map(|t| (nfc(&t.name), nfc(&t.key)))
            .collect();
        user.sort();
        order.extend(user.into_iter().map(|(_, k)| k));
        order.extend(LAST.iter().filter(|k| defined.contains(**k)).map(|k| k.to_string()));
        order.push("tag".into());
        let undefined: Vec<String> = data.type_keys().iter().filter(|k| !defined.contains(*k) && *k != "tag").cloned().collect();
        order.extend(undefined);
        order
    }

    /// D-981: the title of `centre` when the file sits in `.trash/` (its stem when it has none).
    fn trashed_centre(&self, centre: &str) -> Option<String> {
        let trashed = format!(".trash/{}", nfc(centre));
        let (bytes, _) = self.shared.vault.read(&trashed).ok()?;
        let base = trashed.rsplit('/').next().unwrap_or(&trashed);
        let stem = base.strip_suffix(".md").unwrap_or(base);
        Some(nfc(&tegg_format::extract(&bytes, stem).title))
    }
}
