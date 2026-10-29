# Contract: local graph, core and full view (v1.0 slice G1)

Public interfaces of slice G1, for the test author (D-61) and the build. ACs: `docs/acceptance/graph.md` (R108…R113,
FR-GRP-01…03, -05…08, FR-TAG-05 AC-9, NFR-PERF-11, FR-SYN-06 AC-38, FR-UX-03 AC-20, FR-UX-05 AC-15, NFR-OTH-02 AC-12).
Decisions: D-900…D-920 (BRD v1.109), D-970…D-993 (BRD v1.111). Layout and rendering: ADR 0004 (D-913). Boards:
`design/edit-note-page/Graph.dc.html`, `GraphDark`, `GraphStates`(`Dark`), `GraphDetails`(`Dark`) A. Fixture:
`tests/fixtures/vaults/graph/` (its README has every expected count). G2 (panel) and G3 (presets, keyboard, List)
build on the seams in §9.

G1 **writes nothing to the vault**. The only file it writes is `ui-state.json` in Application Support (§5).

## 1. The neighbourhood query (`tegg-index`, D-911, AR-03)

A new module `crates/tegg-index/src/graph.rs`, plain Rust over the index's link and tag tables, with no Tauri or
desktop dependency (architecture-rules AR-03 check). It reads only the index: no vault file, no recency (D-138).

```rust
pub enum EdgeKind { Link, Relation, Embed, Tag }        // strength order: Embed > Relation > Link > Tag (D-902)

pub struct GraphRequest {
    pub centre: String,                 // vault path, NFC (D-914)
    pub depth: u8,                      // 1..=3; anything else → InvalidDepth
    pub hidden_types: Vec<String>,      // type keys, `tag` for tag nodes; unknown keys are ignored (D-977)
    pub hidden_kinds: Vec<EdgeKind>,
    pub cap: usize,                     // 150 in the full view (D-912); G2 passes 60
    pub show_all: bool,                 // D-979: draw the whole walk up to 1,000
}

pub struct GraphResult {
    pub nodes: Vec<GraphNode>,          // the kept nodes, in walk order: depth, then degree desc, then path (R111)
    pub edges: Vec<GraphEdge>,          // every edge among kept nodes with a visible kind (D-974, D-973)
    pub total: usize,                   // filtered walk at this depth, centre included
    pub unfiltered: usize,              // the walk with no filter, centre included
    pub hidden: usize,                  // unfiltered − total (D-976)
    pub truncated: bool,                // the cap dropped nodes
    pub type_counts: Vec<(String, usize)>, // every type key of the vault (§1.7) with its count in the unfiltered walk, centre included (D-976); order §1.6
}

pub struct GraphNode {
    pub id: NodeId,                     // Path(String) for objects, Tag(key) for tag nodes
    pub object_id: Option<String>,      // the frontmatter `id` (NFC), if any; tag nodes: the winning Tag file's id
    pub path: Option<String>,           // NFC; None for a virtual tag (D-694); the winning Tag file for a tag with a file
    pub title: String,                  // title, else the stem (D-103, D-990); a tag: its display name (D-711)
    pub type_key: String,               // `tag` for tag nodes; the raw value for an undefined type (D-121)
    pub depth: u8,
    pub degree: usize,                  // vault-wide, D-975
    pub tag_key: Option<String>,
    pub color: Option<String>,          // tag nodes: one of the eight tokens, else None (D-707)
}

pub struct GraphEdge {
    pub a: NodeId, pub b: NodeId,       // a < b by sort key (§1.6)
    pub ways: Vec<EdgeWay>,             // every way the pair is joined, visible or not; order §1.6
    pub style: EdgeKind,                // the strongest **visible** kind (D-973)
}
pub struct EdgeWay {
    pub kind: EdgeKind,
    pub from: NodeId,                   // the object that holds the reference
    pub key: Option<String>,            // the frontmatter key for a Relation (D-971)
}

pub enum GraphError { CentreNotFound, CentreInTrash { title: String }, InvalidDepth, Cancelled, NotReady }

impl Index {
    pub fn graph_neighbourhood(&self, req: &GraphRequest, cancel: &CancelFlag) -> Result<GraphResult, GraphError>;
    /// Vault-wide degree of one object (D-975); the same number as `GraphNode.degree`.
    pub fn graph_degree(&self, id: &NodeId) -> usize;
}
```

### 1.1 Edges (R108; D-900, D-971, D-972, D-974)

Derived at query time from what the index already stores; no new extraction and no new table.

| Kind | From the index |
| --- | --- |
| Embed | link rows with `OccurrenceKind::Embed`, resolved (ms4-links §1); an attachment embed through its Image or PDF object (FR-ATT-07) |
| Relation | link rows with `OccurrenceKind::Attribute`, every key except `file`, `icon`, `cover` (D-971) |
| Link | link rows with `OccurrenceKind::Body`, `#Heading` and `#^block` targets as the object; `[[YYYY-MM-DD]]` resolving to an existing Daily Note (D-972) |
| Tag | tag occurrences (`tags:`, inline `#tag`) to the node of their tag key; a Body or Attribute link to a winning Tag file reaches the same node (D-974) |

Excluded: unresolved targets, self-references (also through the object's own `file:`), sources and targets under
`_templates/` or `.trash/`, losing duplicate Tag files (D-694). One `GraphEdge` per unordered pair (D-902).

### 1.2 The walk (D-903, D-904, D-974)

Breadth-first from the centre over edges whose kinds are not all hidden, both directions. The centre is always entered
and expanded, also when its type is hidden or it is a leaf (D-974). A centre path that is a winning Tag file starts at
that tag's `Tag(key)` node; a losing duplicate Tag file as the centre answers `CentreNotFound` (it is not a node, D-694).
A node of a hidden type is not entered. Tag nodes and Daily Notes other than the centre are entered but not expanded. A node's depth is its
first-reached distance. `unfiltered` is the same walk with no hidden types or kinds.

### 1.3 The cap (R111, D-978, D-979)

1. `total ≤ cap`, or `show_all` and `total ≤ 1000`: keep everything.
2. Otherwise keep the centre and every depth-1 node (the 1,000 highest by rule 3 if depth 1 is larger).
3. Fill up to `cap` depth by depth; within a depth by `degree` descending, then path in NFC code-point order (tag
   nodes by `tag:<key>`). Only nodes with a kept neighbour one step closer are eligible.
4. `truncated` is true when rule 3 dropped any node. `show_all` above 1,000 is ignored (rule 2 and 3 apply).

### 1.4 Degree (D-975)

The number of distinct nodes joined to the object by any edge of §1.1, over the whole vault, independent of the request.
Computed per query for the returned nodes (one grouped SQL over the link and tag tables); not stored in the index, so a
rebuild gives the same numbers (AR-01).

### 1.5 Cancellation and determinism (D-911, AR-01)

- `CancelFlag` is an `Arc<AtomicBool>` checked between BFS levels and every 256 rows; set → `Err(Cancelled)`.
- `tegg-core` keeps one in-flight graph request per window: a new `graph_neighbourhood` sets the previous flag first.
- Same index → same result, byte for byte in its JSON form (order §1.6). Locale never takes part.
- While the first index build runs → `Err(NotReady)` (D-990); the UI shows the loading state and asks again on
  `index:progress` `state: 'done'` (D-1005).
- Test hook (L4 only, `#[cfg(any(test, feature = "test-hooks"))]`): `GraphRequest` may carry a pause callback run after
  each BFS level, so tests set the flag or start a second request at a known point (FR-GRP-01 AC-9).

### 1.6 Order of everything in the result (AR-01, D-911)

- **Sort key** of a node: its path (NFC) for objects, `tag:<key>` for tag nodes; compared by Unicode code points.
- `nodes`: depth ascending, then degree descending, then sort key (R111).
- `edges`: by `(a, b)` sort keys, where `a` is the smaller sort key of the pair.
- `ways` inside an edge: kind strength (Embed, Relation, Link, Tag), then `from`'s sort key, then `key` (none first).
- `type_counts`: the D-977 list order (system and user types in D-121 order, then `tag`, then undefined type values by
  code point).
- JSON field order is the struct order above (serde default); `NodeId` serializes as `{"path": …}` or `{"tag": …}`.

### 1.7 Type keys of the vault (D-977)

`type_counts` lists every defined type (from `.tegg/types/`), `tag`, and every distinct `type` value without a
definition found in the index outside `_templates/` and `.trash/` (raw, NFC), each with its count in the unfiltered walk
(0 when absent). The filter column renders this list, so no other read is needed for undefined types.

## 2. IPC

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `graph_neighbourhood` | `req: GraphRequestDto` | `GraphResultDto` | Read-only, no recency. Errors `CentreNotFound`, `CentreInTrash { title }`, `InvalidDepth`, `Cancelled`, `NotReady`. A new call from the same window cancels the running one. |
| `index_path_by_id` | unchanged (v1-previews §2) | | Follows an external rename of the centre (D-914). |

```ts
type EdgeKindDto = 'link' | 'relation' | 'embed' | 'tag';
type NodeIdDto = { path: string } | { tag: string };   // serde: externally tagged enum, `#[serde(rename_all = "lowercase")]`
type GraphRequestDto = { centre: string; depth: 1 | 2 | 3; hiddenTypes: string[]; hiddenKinds: EdgeKindDto[];
                         cap: number; showAll: boolean };
type GraphNodeDto = { id: NodeIdDto; objectId: string | null; path: string | null; title: string; typeKey: string; depth: number;
                      degree: number; tagKey: string | null; color: string | null };
type GraphEdgeDto = { a: NodeIdDto; b: NodeIdDto; style: EdgeKindDto;
                      ways: { kind: EdgeKindDto; from: NodeIdDto; key: string | null }[] };
type GraphResultDto = { nodes: GraphNodeDto[]; edges: GraphEdgeDto[]; total: number; unfiltered: number;
                        hidden: number; truncated: boolean; typeCounts: [string, number][] };
```

Generated from Rust like the other DTOs (architecture §6). No new event.

## 3. Route, opening and history (D-914, D-970, D-987, D-988)

- `graph/<path>` in the route registry (app-shell R1; `RouteDef` built, no longer TBD). `parseRoute` normalizes the
  path to NFC. Page `app/ui/src/graph/GraphPage.tsx`. Title `Graph · <title>` (`graph.tabTitle`) for the title bar's
  tab and the window. `route-ready:graph/<path>` is written once the first graph (or state) has painted.
- No right panel on this route (D-988): `Frame` hides it and ⌘\ is a no-op there. Below 960 px of centre-pane width the
  filter column collapses into a `Filters` popover button and the preview column overlays the canvas.
- Opened by `graph.open` (⌘⇧G, palette `Open graph`) from `note/<path>`, `daily/<date>` with a file, `tag/<key>` with
  a Tag file (the winning file's path) and media notes; disabled elsewhere (D-987). Until tabs (D-970) it pushes a
  history entry in the current view.
- Centring (`Center graph here`, `Recenter` = the selected node, D-984) pushes `graph/<new path>`. A rename of the
  centre replaces the current entry: Tegg's rename through the job's path map; an external rename through the centre's
  `objectId` from the last result. On `CentreNotFound` the page first calls `index_path_by_id(objectId)`; a path →
  replace the route and ask again; `null` → the gone state. A centre without an `id` (Bez hlavičky) shows the gone
  state after an external rename (D-981 can't follow it).
- Errors map to R110: `CentreInTrash` → the trash text; `CentreNotFound` → the gone text (title from the last result, or
  the path's stem). A later `vault:changed` re-asks, so a restore brings the graph back (D-981).

## 4. UI modules (`app/ui/src/graph/`)

| Module | Owns |
| --- | --- |
| `graphModel.ts` | Pure: `GraphResultDto` → view model (node sizes per R113 and D-975 steps, label rules D-985, the connection phrases of D-982 from `ways`, heading and banner texts). L1-tested without the DOM. |
| `layout.ts` | Pure over d3-force (ADR 0004): `layout(model, size, previous?) → Map<NodeKey, {x, y}>`, where `NodeKey` is `objectId` when present, else the sort key (§1.6), so a renamed node keeps its place and its selection (FR-GRP-01 AC-13). Seeded, centre pinned at the canvas centre, run to rest synchronously (no rAF ticks); with `previous`, surviving nodes are fixed at their old positions and new ones start next to their first kept neighbour (D-913). |
| `GraphPage.tsx` | The route: request lifecycle (§6), state (§5), the 300 ms loading rule (D-912), R110 states, history. |
| `GraphCanvas.tsx` | SVG `role="group"`: one `<g data-graph-node tabindex="-1">` per node (G3 adds roving focus), one `<path data-graph-edge>` per edge (R109 data attributes), zoom and pan (D-985), selection and hover highlight (D-983), fades per D-992 (none under Reduce motion). |
| `GraphFilters.tsx` | `complementary` `Graph filters`: Types (`All`, `None`, one checkbox per type in D-121 order then Tag then undefined types, D-977), Connections, `Size nodes by links`. Slot above Types for G3's preset select. |
| `GraphPreviewColumn.tsx` | Mounts the slice P preview with `host.placement = 'column'` (§7). |

Commands (`shell/commands.ts`, section `navigate`, `needsVault: true`): `graph.open` (⌘⇧G), `graph.depth1`…`depth3`,
`graph.recenter`; the last four are registered with `when: route is graph/*`. Strings: every R112 key in the English
catalog, plurals per D-133.

## 5. Machine-local state (D-906, D-993)

```ts
type UiStateDto = {
  // … as before (version stays 1) …
  /** G1 (D-993): per-vault state, keyed by the vault's absolute path, NFC. */
  vaults?: Record<string, { graph?: { full?: GraphViewStateDto; panel?: GraphViewStateDto /* G2 */ } }>;
};
type GraphViewStateDto = {
  depth?: 1 | 2 | 3;            // missing or invalid → 1 (D-905)
  hiddenTypes?: string[];       // unknown keys kept on write (D-977)
  hiddenKinds?: EdgeKindDto[];  // unknown values dropped on read, kept on write
  sizeByLinks?: boolean;        // missing → false (D-908)
  // G3 adds: view?: 'graph' | 'list'; preset?: string
};
```

- Written through `ui_state_set` once per committed change (a depth, a filter click, `All`/`None`, `Show all types`,
  `Show everything`, `Size nodes by links`); never on open, never for `Show all` (D-979). The Rust `UiState` gains
  `vaults: Option<BTreeMap<String, VaultUi>>` with `#[serde(default)]`; unknown fields kept as for the other parts.
- An invalid stored value is read as its default and left as is until the user changes that value.

## 6. Requests, live updates and timing (D-911, D-912, D-980, D-992)

- Every depth, filter, centre or `Show all` change calls `graph_neighbourhood`; the UI also aborts its own wait and
  drops a late answer whose request id isn't the latest.
- `vault:changed` (any paths) → debounced 300 ms → re-query with the same request; if the result equals the drawn one
  (deep equality of nodes, edges and counts) nothing is redrawn; otherwise the layout runs with `previous` (D-980).
  `index:progress` `done` after `NotReady` → re-query (D-1005).
- A selected node missing from the new result clears the selection and the column's preview (D-915).
- `Show all` stays on across live updates while centre, depth and filters stay (D-979).
- Loading state only when no answer arrived 300 ms after the request; controls stay enabled.
- Marks: `perfMark('graph-request')` when the request is sent; `perfMark('graph-ready')` after the next animation frame
  once nodes and edges are painted at rest. NFR-PERF-11 (D-986) measures between them.

## 7. The preview seam, widened (D-982; amends v1-previews §7)

G1's build changes slice P's `show` signature in one commit with both slices' tests green:

```ts
show(target, anchor, origin: PreviewOrigin, host?: PreviewHost, extraLines?: string[],
     extraAction?: { label: string; run: () => void; disabled?: boolean }): void
```

- Only the last argument of slice P's signature changes: `extraLine?: string` becomes `extraLines?: string[]` (D-982),
  and `extraAction` is added. `origin` and `host` stay as slice P defines them. Each line renders after the type name, in
  order (previews.md FR-LNK-10 AC-16 keeps passing with one line).
- `extraAction` renders before `Open` (`Center graph here`, disabled for the centre and virtual tags, D-987).
- The graph passes line 1 `<Type> · <n> connections` (`graph.preview.connections`, n = `degree`) and, except for the
  centre, line 2 from `graphModel.connectionPhrase(node, result)` (D-982). A relation is named by the property's Name
  from the source's type; the reserved keys `source` and `description` by the catalog (`graph.relKey.*`); any other
  undefined key by its raw key (D-971).

## 8. Fake core and test hooks

- `app/ui/test/fake-graph.ts`, installed by `installFakeCore`: `graph_neighbourhood` as a TypeScript reference walk of
  §1 over the fake's files, with the real `@tegg/doc` extraction and the ms3-shell §11.1 resolution rules; tag keys and
  colours as `fake-tags.ts`. It is checked against the Rust query on the fixture (same JSON for every centre, depth and
  filter scenario of the fixture README; L4 test reads a golden file the L1 test also reads).
- Handle additions: `graphDelay(ms)` (answers after `ms`, cancellable), `graphNotReady(on)`, `graphCalls()` (requests
  in order). Existing `setFile`, `rename`, `trash`, `restore` emit `vault:changed` as before.
- `ui_state_get/set` keep `vaults`. `writes()` counts vault writes: 0 for every graph test (FR-SYN-06 AC-38).
- Hub: `tests/fixtures/vaults/graph/make-hub.mjs` (G1 red-test commit) writes the hub files of the fixture README into
  a temporary vault copy; L4 tests use a Rust twin in `crates/tegg-index/tests/support/hub.rs`.
- L6 (`TEGG_TEST=1`): `TEGG_ROUTE=graph/<path>`; `route-ready:graph/<path>` and the perf marks; the window is sized
  1,440 × 980.

## 9. Seams for G2 and G3

| Seam | G1 | Later |
| --- | --- | --- |
| Query | `cap` and `show_all` are parameters | G2 calls with `cap: 60`, `showAll: false`; R111 keeps depth 1 whole, so the panel checks `total > 60` and shows the lower-depth / full-view offer instead of drawing (D-912) |
| State | `vaults[path].graph.full` | G2 `graph.panel`; G3 `view`, `preset` |
| Filter column | slot above Types | G3 preset select (`.tegg/graph.yml`, D-907) |
| Toolbar | depth, `<n> hidden`, Recenter | G3 `Graph` / `List` switch (D-916) |
| Preview | `host.placement = 'column'`, `extra` | G2 `'popover'`; G3 hover mode |
| Nodes | SVG `<g>` with accessible names, `tabindex="-1"` | G3 roving tabindex, keys, VoiceOver position |
| Input | click mode in every setting (D-983) | G3 follows FR-LNK-12 |

## 10. Test layout

| Layer | Files |
| --- | --- |
| L0 | AR-03 check covers `tegg-index` (unchanged rule) |
| L1 | `app/test/graph_model.ac.test.ts` (counts, sizes, labels, phrases, texts), `graph_layout.ac.test.ts` (seed, centre, rest, `previous`), `graph_catalog.ac.test.ts`, `graph_reference.ac.test.ts` (reference walk vs golden) |
| L2 | `crates/tegg-index/tests/ac_graph_props.rs` (walk invariants, exclusions), fast-check twin in `app/test/graph_props.ac.test.ts` |
| L4 | `crates/tegg-index/tests/ac_graph.rs` (fixture counts, shape, cap, degree, rebuild, cancel), `crates/tegg-core/tests/ac_graph.rs` (one in-flight request, `NotReady`) |
| L5 | `app/webkit/graph.ac.test.ts` (route, states, filters, selection, preview column, history), `graph_live.ac.test.ts`, `graph_themes.ac.test.ts` |
| L6 | `app/e2e/graph.ac.test.ts` (relaunch state, external edit and rename, FR-SYN-06 AC-38), `app/e2e/nfr_perf_11_graph.ac.test.ts` (outside the push run, report-only until the v1.0 release gate) |

## 11. Contract choices (no owner decision needed)

1. The query takes hidden, not visible, types and kinds, so the UI's stored state maps one to one (D-977).
2. Degree is computed per query rather than stored: one grouped read per result, and nothing to keep in step on writes.
3. Cancellation is a flag checked by the query, not a dropped thread: SQLite reads stay on the index's pool.
4. `NodeId` separates tag nodes from object nodes, so a virtual tag and a Tag file share one node by key (D-974).
5. The layout is synchronous and pure; the page never animates the simulation itself, only CSS fades (D-992).

## 12. Red-test decisions (D-994…D-1009, BRD v1.112; red tests 6313cbd)

Owner, 2026-10-29, AP-851…AP-866 as proposed. They amend the sections above where they differ:

1. **D-994** `GraphRequest.type_order: Vec<String>` from `tegg-core` (the index doesn't read `.tegg/types/`); `type_counts` follow it (§1.7).
2. **D-995** `Core::graph_neighbourhood(&self, window: &str, req: GraphRequest)` and `Core::graph_degree(&self, id)`.
3. **D-996** `GraphRequest.pause: Option<PauseHook>`, `PauseHook(Arc<dyn Fn(u8) + Send + Sync>)`, called after each BFS level, `test-hooks` feature only (§1.5).
4. **D-997** `GraphError::NotImplemented` is stub-only; the build removes it.
5. **D-998** `graphModel.ts`: `sortKey`, `nodeKey`, `sizeStep`, `buildModel(result, { sizeByLinks })`, `labelVisible`, `headingCount`, `hiddenText`, `connectionPhrase(node, result, types)` (relation Names from the type definitions, §7).
6. **D-999** `GraphResult.depth_totals: Vec<usize>` / `depthTotals: number[]`: the filtered total per depth, centre included, for `Depth <d−1> · <m>`.
7. **D-1000** `CentreInTrash`'s title travels in `IpcError.name`.
8. **D-1001** `data-a` / `data-b` are sort keys (§1.6); `data-kinds` is space-separated.
9. **D-1002** DOM: type checkbox name `<Plural> <count>`; tag node name `#<name>, Tag`; `data-swatch="pill"` on the Tag row; labels are SVG `<text>`; objects `circle`, pills `rect`; `data-icon` on the node or a descendant.
10. **D-1003** the test build writes `graph-centre:<path>` for the NFR-PERF-11 centre; the L1 layout bench uses a 150-node hub-shaped result.
11. **D-1004** FR-GRP-01 AC-13's external renames change the title (centre) or rewrite the links (drawn node).
12. **D-1005** `index:progress` ends with `state: 'done'` (ms2-shell), not `ready`.
13. **D-1006**, **D-1007** FR-SYN-06 AC-38: `#nápad` is selected and previewed, not centred; only the graph's own write (`ui-state.json`) is checked in Application Support.
14. **D-1008** a note with unreadable frontmatter has `objectId: null`.
15. **D-1009** the window title is checked in L6; L5 checks the title bar's tab.
