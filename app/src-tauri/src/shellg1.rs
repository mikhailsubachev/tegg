//! Slice G1 IPC (docs/contracts/v1-graph.md §2): `graph_neighbourhood`, read-only, no recency. A new call from the same
//! window cancels the running one (the core keys requests by the window's label, §1.5). The DTOs are the contract's;
//! the build generates their TypeScript into ui/src/ipc/types.ts with the other DTOs (architecture §6).

use serde::{Deserialize, Serialize};
use tauri::State;
use tegg_core::{EdgeKind, GraphError, GraphRequest, GraphResult, NodeId};

use crate::{core, err, AppState, IpcError};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKindDto {
    Link,
    Relation,
    Embed,
    Tag,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeIdDto {
    Path(String),
    Tag(String),
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRequestDto {
    pub centre: String,
    pub depth: u8,
    pub hidden_types: Vec<String>,
    pub hidden_kinds: Vec<EdgeKindDto>,
    pub cap: u32,
    pub show_all: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeDto {
    pub id: NodeIdDto,
    pub object_id: Option<String>,
    pub path: Option<String>,
    pub title: String,
    pub type_key: String,
    pub depth: u8,
    pub degree: u32,
    pub tag_key: Option<String>,
    pub color: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct GraphWayDto {
    pub kind: EdgeKindDto,
    pub from: NodeIdDto,
    pub key: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct GraphEdgeDto {
    pub a: NodeIdDto,
    pub b: NodeIdDto,
    pub style: EdgeKindDto,
    pub ways: Vec<GraphWayDto>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResultDto {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
    pub total: u32,
    pub unfiltered: u32,
    pub hidden: u32,
    pub truncated: bool,
    pub type_counts: Vec<(String, u32)>,
    /// D-999: the filtered total at each depth from 1 to the requested one.
    pub depth_totals: Vec<u32>,
}

fn kind_in(k: EdgeKindDto) -> EdgeKind {
    match k {
        EdgeKindDto::Link => EdgeKind::Link,
        EdgeKindDto::Relation => EdgeKind::Relation,
        EdgeKindDto::Embed => EdgeKind::Embed,
        EdgeKindDto::Tag => EdgeKind::Tag,
    }
}
fn kind_out(k: EdgeKind) -> EdgeKindDto {
    match k {
        EdgeKind::Link => EdgeKindDto::Link,
        EdgeKind::Relation => EdgeKindDto::Relation,
        EdgeKind::Embed => EdgeKindDto::Embed,
        EdgeKind::Tag => EdgeKindDto::Tag,
    }
}
fn id_out(id: NodeId) -> NodeIdDto {
    match id {
        NodeId::Path(p) => NodeIdDto::Path(p),
        NodeId::Tag(k) => NodeIdDto::Tag(k),
    }
}
fn result_out(r: GraphResult) -> GraphResultDto {
    GraphResultDto {
        nodes: r
            .nodes
            .into_iter()
            .map(|n| GraphNodeDto {
                id: id_out(n.id),
                object_id: n.object_id,
                path: n.path,
                title: n.title,
                type_key: n.type_key,
                depth: n.depth,
                degree: n.degree as u32,
                tag_key: n.tag_key,
                color: n.color,
            })
            .collect(),
        edges: r
            .edges
            .into_iter()
            .map(|e| GraphEdgeDto {
                a: id_out(e.a),
                b: id_out(e.b),
                style: kind_out(e.style),
                ways: e.ways.into_iter().map(|w| GraphWayDto { kind: kind_out(w.kind), from: id_out(w.from), key: w.key }).collect(),
            })
            .collect(),
        total: r.total as u32,
        unfiltered: r.unfiltered as u32,
        hidden: r.hidden as u32,
        truncated: r.truncated,
        type_counts: r.type_counts.into_iter().map(|(k, n)| (k, n as u32)).collect(),
        depth_totals: r.depth_totals.into_iter().map(|n| n as u32).collect(),
    }
}
fn graph_err(e: GraphError) -> IpcError {
    match e {
        GraphError::CentreNotFound => err("CentreNotFound", "the centre doesn't exist"),
        // The trashed object's title travels in `name` (red-test point AP-857).
        GraphError::CentreInTrash { title } => IpcError { name: Some(title.clone()), ..err("CentreInTrash", format!("“{title}” is in the trash")) },
        GraphError::InvalidDepth => err("InvalidDepth", "depth must be 1, 2 or 3"),
        GraphError::Cancelled => err("Cancelled", "a newer graph request"),
        GraphError::NotReady => err("NotReady", "the index is being built"),
    }
}

#[tauri::command]
pub async fn graph_neighbourhood(window: tauri::Window, state: State<'_, AppState>, req: GraphRequestDto) -> Result<GraphResultDto, IpcError> {
    let core = core(&state)?;
    let r = GraphRequest {
        centre: tegg_format::nfc(&req.centre),
        depth: req.depth,
        hidden_types: req.hidden_types,
        hidden_kinds: req.hidden_kinds.into_iter().map(kind_in).collect(),
        cap: req.cap as usize,
        show_all: req.show_all,
        ..Default::default()
    };
    core.graph_neighbourhood(window.label(), &r).map(result_out).map_err(graph_err)
}
