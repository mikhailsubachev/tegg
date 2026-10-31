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
Read from the in-memory vault-wide graph (`GraphData`), which is derived from the index on first use and dropped on every
index change; nothing is stored, so a rebuild gives the same numbers (AR-01).

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
| `GraphCanvas.tsx` | SVG `role="group"`: one `<g data-graph-node tabindex="-1">` per node (G3 adds roving focus), one `<line data-graph-edge>` per edge (R109 data attributes), zoom and pan (D-985), selection and hover highlight (D-983), fades per D-992 (none under Reduce motion). |
| `GraphFilters.tsx` | `complementary` `Graph filters`: Types (`All`, `None`, one checkbox per type in D-121 order then Tag then undefined types, D-977), Connections, `Size nodes by links`. Slot above Types for G3's preset select. |

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

- The Rust `UiState` carries `vaults` in its flattened map of other fields (kept on write), so no typed field is needed.
- Written through `ui_state_set` once per committed change (a depth, a filter click, `All`/`None`, `Show all types`,
  `Show everything`, `Size nodes by links`); never on open, never for `Show all` (D-979).
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

## 12. Red-test decisions (D-994…D-1009, BRD v1.114; red tests 6313cbd)

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

## 13. Build decisions (D-1021…D-1027, BRD v1.115)

Owner, 2026-10-30, as proposed:

1. **D-1021** `d3-force` 3.0.0 and its dependencies are the one exception to FR-FMT-05 AC-6's d3 ban (ADR 0004).
2. **D-1022** the AC-test changes of the build (app-shell R1/R4 rows, the R2 tab staying TBD, FR-GRP-06 AC-2, FR-GRP-01 AC-13, AC-20, FR-GRP-08 AC-5).
3. **D-1023** `Open graph` disabled reason: `cmd.needsObject` (`Open an object first`).
4. **D-1024** slice P's ↩ after `Open` is `preview.openKey`.
5. **D-1025** first paint at 100 % (amends D-985).
6. **D-1026** fade-in only (amends D-992).
7. **D-1027** the column's `data-preview-path` is empty for a virtual tag.

## 14. Build notes (QA review of the G1 build)

- The preview column is inlined in `GraphPage.tsx` (no `GraphPreviewColumn.tsx`).
- The type order is built from the core's cached type definitions and the graph's cached type keys: no file listing per
  request (NFR-PERF-11).
- `graph-request` is marked when the request is sent; the NFR-PERF-11 benchmark estimates the centre from the vault's files
  (`app/e2e/perf_graph.ts`), so the test build writes no `graph-centre:` mark (D-1003's mark is unused; open point for the
  owner).
- A trashed centre is found at `.trash/<same path>` only; a centre the trash renamed on a name clash shows as gone
  (follow-up).
- The DTOs in `ui/src/graph/types.ts` are hand-written beside `shellg1.rs` (not generated yet; follow-up).

## 15. Slice G2: the graph in the right panel

Interfaces of slice G2 for the test author (D-61) and the build. ACs: `docs/acceptance/graph-panel.md` (R114…R117,
FR-GRP-01 AC-28…AC-44, FR-GRP-02 AC-7…AC-10, FR-GRP-03 AC-6…AC-9, FR-GRP-05 AC-5, AC-6, FR-GRP-06 AC-6…AC-9,
FR-GRP-07 AC-4, FR-GRP-08 AC-6, FR-NAV-05 AC-1 (changed, inbox.md), AC-2, AC-3, NFR-PERF-11 AC-3, FR-SYN-06 AC-39,
FR-UX-03 AC-21, FR-UX-05 AC-16, NFR-OTH-02 AC-13). Open points D-1030…D-1043 (→ D-1030…D-1043); this section follows
their proposals and is amended where a decision differs. Boards: `GraphPanel`(`Dark`) A, B, C, `GraphStates`(`Dark`)
panel variants. G2 adds **no IPC command, no event and no Rust code**; it writes nothing to the vault. G3 appends §16
(presets, keyboard, List; it adds `view` and `preset` to `GraphViewStateDto` and the `.tegg/graph.yml` store, which
this section does not define).

### 15.1 The request (§1, §2; D-912, R116)

The panel calls the existing `graph_neighbourhood` with:

```ts
const req: GraphRequestDto = { centre, depth: panel.depth ?? 1, hiddenTypes: panel.hiddenTypes ?? [],
                               hiddenKinds: panel.hiddenKinds ?? [], cap: 60, showAll: false };
```

- `centre`: the page's object path, NFC: `note/<path>` → `<path>`; `daily/<date>` → the day's file (`daily_view`'s
  `path`, as `objectPathOf` for `graph.open`). `new/<type>`, a virtual day, and a page whose file is gone send **no**
  request (R115 No file, Deleted).
- `total > 60` → the Too many state, nothing drawn; the result's `nodes` are not used. Otherwise every node of the
  result is drawn (`truncated` is false then, because R111 keeps everything when `total ≤ cap`).
- Lower depth (D-1033): `lowerDepthOffer(depthTotals, depth, 60)` = the largest `d' < depth` with
  `depthTotals[d'-1] <= 60`, or `null`.
- Errors as §3: `CentreInTrash` / `CentreNotFound` → the panel's Deleted state (after `index_path_by_id(objectId)` as
  the full view does); `NotReady` → Loading; `Cancelled` → ignored (a newer request is running).
- Requests are sent only while the panel is shown **and** its tab is `graph` (FR-GRP-01 AC-40). One in-flight graph
  request per window (§1.5) still holds: the panel and the full view are never shown together (D-988).

### 15.2 Modules (`app/ui/src/graph/`)

| Module | Owns |
| --- | --- |
| `panelModel.ts` | Pure, L1: `lowerDepthOffer(depthTotals, depth, cap)`; `panelState(input) → 'graph' \| 'noLinks' \| 'allHidden' \| 'loading' \| 'tooMany' \| 'noFile' \| 'deleted'`; `triggerText(depth, hidden)`; `footerText(count)`; `panelFit(positions, nodeBoxes, size, margin = 12) → scale` (≤ 1, ≥ 0.25, centre pinned; D-1031); `PANEL_SCALE` (R114 sizes). |
| `GraphPanel.tsx` | The `tabpanel` `Graph`: request lifecycle (§6 rules: 300 ms loading, latest-request-wins, debounced re-query), R115 states, selection, the popover hand-over (§15.4), the trigger and its popover, `Open full view`. |
| `GraphFilters.tsx` | Gains `variant: 'column' \| 'popover'`; the popover variant renders the `Depth` `radiogroup` first, then Types, Connections, `Size nodes by links` and `graph.panel.filtersNote`, with a slot after `Depth` for G3's preset row. |
| `GraphCanvas.tsx` | Gains `scale: 'full' \| 'panel'` (R114 sizes and the label width 96 px; panel: no zoom buttons, no hint, labels always shown, fit per `panelFit`) and `onSelect(node \| null)`, `onOpen(node)`, `selected` as controlled props (unchanged semantics). |

```ts
// GraphPanel.tsx
export function GraphPanel(props: {
  /** The page's object; null path = no file (new/<type>, a virtual day) → R115 No file. */
  centre: { path: string | null; title: string; objectId: string | null };
  vaultPath: string;                                   // NFC; the `vaults` key (D-993)
  state: GraphViewStateDto;                            // vaults[vaultPath].graph.panel, defaults applied by the reader
  onState(next: GraphViewStateDto): void;              // one ui_state_set per committed change (§15.3)
  onOpen(node: GraphNodeDto): void;                    // double-click / `Open`: the shell's open (route + nav_opened)
  onOpenFull(handover: GraphHandover): void;           // `Open full view`, `In full graph`, ⌘⇧G (§15.5)
  refresh: number;                                     // the shell's refresh tick (own saves, type changes)
  width: number;                                       // the panel's drawn width; canvas = width − 28
  types: TypeDefDto[];                                 // type order, names, icons (D-994 via the core, D-998 phrases)
}): JSX.Element;
```

`ContextPanel` (`shell/Frame.tsx`) renders `<GraphPanel>` for `tab === 'graph'` when `PANEL_TABS`' `graph` row is built,
the same way it renders `BacklinksPanel`; the Backlinks badge keeps counting (`BadgeCount`).

### 15.3 Machine-local state (§5; D-906, D-993)

```ts
type UiStateDto = {
  // … as before …
  vaults?: Record<string, { graph?: { full?: GraphViewStateDto; panel?: GraphViewStateDto } }>;
};
// GraphViewStateDto is §5's type, unchanged: { depth?, hiddenTypes?, hiddenKinds?, sizeByLinks? }.
```

- `graph.panel` is written only by the panel, `graph.full` only by the full view (FR-GRP-02 AC-10). Written through
  `ui_state_set` once per committed change: a depth radio, a palette `Graph: Depth n` while the panel shows Graph, the
  offer `Depth <d'> · <m>`, a type or kind checkbox, `All`, `None`, `Show all types`, `Show everything`, `Size nodes by
  links`. Never on open, never on a hand-over (D-1037).
- Missing or invalid values read as the defaults and are left as they are until the user changes that value (§5).
- `rightPanel.tab: 'graph'` and `rightPanel.open` are the existing fields (ms3-shell §2); `Show local graph` sets both in
  one write.

### 15.4 The node preview in the panel (§7; D-917, D-982; D-1034, D-1041)

```ts
preview.show(
  { path: node.path ?? '', fragment: null, kind: node.tagKey ? 'tag' : 'note', key: node.tagKey ?? undefined },
  { el: nodeElement },                       // the node's <g>, inside `.context-panel[data-preview-side="left"]`
  'click',
  { placement: 'popover' },
  graphLines(node, result, types),           // line 1 `<Type> · <n> connections`; line 2 the D-982 phrase, none for the centre
  { label: t('graph.panel.inFullGraph'), run: () => onOpenFull({ depth, select: node.id }) },
);
```

- Placement and size are slice P's for panel references (v1-previews §3.3, `data-preview-side="left"`: left of the
  panel, top at the anchor's top, the stored or default size); no new placement code.
- `GraphPanel` watches `usePreview().current`: when it no longer targets the selected node (any close reason, or another
  surface's preview), the selection clears. A selected node missing from a new result closes the preview
  (`close('outside')`) and clears the selection (D-915; the slice P `gone` state is not shown for graph nodes).
- The panel never shows `Center graph here`.

### 15.5 To the full view (D-905, D-970; R116; D-1036, D-1037)

```ts
type GraphHandover = { depth: 1 | 2 | 3; select: NodeIdDto | null };
// shell/history.ts
export type HistoryEntry = { route: Route; scrollTop: number; graph?: GraphHandover };
// App.tsx: go(route, opts?: { graph?: GraphHandover })  → push(route) with the hand-over on the new entry
```

- `Open full view` and `In full graph` call `onOpenFull`; the shell pushes `graph/<centre path>` (NFC) with the
  hand-over on the new entry. The node selected when the toolbar button's `pointerdown` arrived is handed over (the
  outside-click close comes after it is read).
- `graph.open` (⌘⇧G, `Open graph`): when the panel is shown with tab `graph` and a centre path, it runs the same
  hand-over (the panel's depth and current selection); otherwise unchanged (§3, the full view's own depth).
  `Open full view` carries `data-command="graph.open"`; `aria-disabled` with `cmd.needsObject` where `graph.open` is
  disabled (D-1023).
- `GraphPage` reads `entry.graph` first: `depth` overrides `graph.full.depth` for that entry only (not written);
  `select` is applied after the first result when that node is drawn, and the column previews it. Back / Forward to the
  entry restore its hand-over. A depth change in the full view writes `graph.full` as before and updates the entry's
  `graph.depth`, so Back / Forward show what was last seen.
- Back from the full view shows the note with the panel as it was (`graph.panel` unchanged; no selection).

### 15.6 Commands and registry

| Id | Title (R117) | Section | Listed / enabled | Runs |
| --- | --- | --- | --- | --- |
| `panel.graph` | `cmd.graph.showLocal` `Show local graph` | `view` | on `note/<path>`, `daily/<date>`, `new/<type>` (as `panel.backlinks`) | opens the panel on `graph` (one `ui_state_set`), focus on `Depth and filters` |
| `graph.depth1`…`depth3` | R112 | `navigate` | also while the panel is shown with tab `graph` (D-1035) | sets the panel's depth there; the full view's on `graph/<path>` |
| `graph.recenter` | R112 | `navigate` | only on `graph/<path>` (unchanged) | — |
| `graph.open` | R112 | `navigate` | unchanged (§3) | §15.5 |

- `PANEL_TABS` row `graph` becomes `status: { built: true, due: { milestone: 'v1.0' } }`, `reqs: ['FR-GRP-01',
  'FR-NAV-05']` (app-shell R2, in the commit that builds G2). The tab keeps `data-command="panel.graph"`, now a
  registered command.
- No new shortcut (R4 unchanged). Strings: every R117 key in the English catalog, plurals per D-133.

### 15.7 Live updates and timing (§6; D-980, D-1026)

- While the Graph tab is shown: `vault:changed` (any paths) or a `refresh` tick → debounced 300 ms → the same request;
  equal result → nothing redrawn; otherwise the layout runs with `previous` (surviving nodes fixed, new ones next to a
  kept neighbour, 150 ms fade-in, none under Reduce motion).
- A centre change (navigation, rename) → a new request with no `previous` (a fresh seeded layout) and no selection; a
  rename keeps the layout when `objectId` is unchanged (node keys, §4).
- Loading only when no answer arrived 300 ms after the request; the panel's loading has no animation at all.
- Marks: `perfMark('graph-request')` / `perfMark('graph-ready')` as §6, for NFR-PERF-11 AC-3, without a `detail`
  (the IPC `perf_mark` takes a name only): the panel and the full view are never shown together (D-988), so the marks
  of a run are the shown view's.

### 15.8 Fake core and test hooks

- No new handle. `graphCalls()` (§8) records the panel's requests (with `cap: 60`); `graphDelay`, `graphNotReady`,
  `setFile`, `rename`, `trash`, `restore` as G1. `uiState()` exposes `vaults[…].graph.panel` and `rightPanel`.
- L5 start option `rightPanel: { open: true, tab: 'graph', width }` through `__TEGG_UI_STATE__`.
- L6: `TEGG_ROUTE=note/<path>` with a seeded `ui-state.json` (`rightPanel.tab: 'graph'`); `route-ready:note/<path>` then
  `perfMark('graph-ready')` for the panel.

### 15.9 Test layout

| Layer | Files |
| --- | --- |
| L1 | `app/test/graph_panel_model.ac.test.ts` (`lowerDepthOffer`, `panelState`, texts, `panelFit`), `graph_panel_catalog.ac.test.ts` (R117) |
| L5 | `app/webkit/graph_panel.ac.test.ts` (tab, routes, depth, cap, filters, selection, preview, hand-over, ⌘⇧G, states), `graph_panel_live.ac.test.ts` (live, renames, deleted, requests only while shown), `graph_panel_themes.ac.test.ts`; `app/webkit/sidebar_5b.ac.test.ts` (FR-NAV-05 AC-1, changed with the trailer) |
| L6 | `app/e2e/graph_panel.ac.test.ts` (relaunch, ⌘⇧G, external edit and trash, FR-SYN-06 AC-39), `app/e2e/nfr_perf_11_graph_panel.ac.test.ts` (outside the push run, report-only until the v1.0 release gate) |

### 15.10 Contract choices (no owner decision needed)

1. The panel reuses `graph_neighbourhood` with `cap: 60` and decides Too many from `total`, so the core has no
   panel-specific parameter (§9's seam).
2. `GraphFilters` and `GraphCanvas` take a variant instead of being copied, so the panel and the full view can't drift.
3. The hand-over lives on the history entry, not in the route string: `graph/<path>` stays the one route form (D-914)
   and no view state reaches the URL or `ui-state.json`.
4. The panel queries nothing while its Graph tab is hidden; switching to it asks once.
5. `panel.graph` is both the tab's command and `Show local graph`, as `panel.backlinks` is for `Show backlinks`.


### 15.11 Build notes and open points of the G2 build (AP-900 → D-1050…AP-905 → D-1055, for the owner)

Build notes (no decision needed):

- The panel's layout keeps every free node's box inside the canvas with the 12 px margin and pulls nodes towards the
  vertical centre line (`layout(…, { bounds, squeeze })`), so `panelFit` gives 100 % whenever the graph fits (Plán up to
  depth 3 at 260 px); `buildModel(result, { sizeByLinks, scale: 'panel' })` and `GraphCanvas scale="panel"` carry R114's
  sizes. A width change moves no node and re-centres (no re-layout, no request).
- The panel re-asks after the page's own save (`NotePage onWritten` → the `refresh` tick), since the watcher doesn't
  report Tegg's own writes.
- Back returns to a note with its caret (graph.md FR-GRP-01 AC-11, AC-34 here): the history entry keeps the editor's
  selection (`HistoryEntry.caret`, `NotePageApi.caret`, `NotePage restoreCaret`).
- `ShellActions.showLocalGraph` runs `panel.graph`; `GraphPanel` exposes `commandRef` (depth, hand-over) for
  `Graph: Depth n` and ⌘⇧G while the panel shows the Graph tab (D-1035, D-1036).

Open points:

| AP | Point | Proposal |
| --- | --- | --- |
| AP-900 → D-1050 | Test defect: `graph-panel-helpers.ts` `graphPanel` names the tab panel `'Graph'` with `exact: true`, which the pseudo-locale (`⟦Graph⟧`) never matches, so `nfr_oth_02_ac13_panel_graph_strings_in_the_catalog` (WebKit) fails in `openPanel` before its checks. | `name: /^⟦?Graph⟧?$/` (as `graphTab`); a corrected copy passes. |
| AP-901 → D-1051 | Test defect: `fr_grp_01_ac28_panel_graph_tab_on_a_note` counts every `nav_opened`, including the landing route's own (D-138 records opening `note/<path>`), so it reads 1. | Count from after `openPanel` (`navCount` delta); a corrected copy passes. |
| AP-902 → D-1052 | Test defect: the 800 × 500 part of `fr_grp_06_ac7_panel_preview_opens_left_of_the_panel` starts with `sidebarOpen: false`, but `start` waits for the Sidebar (not drawn when closed) and `startPanel` resets the viewport to 1,440 × 980. | `startPanel(…, { sidebarOpen: false, frame: 'none' })`, then `setViewportSize(800 × 500)`; a corrected copy passes. |
| AP-903 → D-1053 | Test defect: L1 `fr_ux_03_ac21_panel_graph_commands` gives the daily route as `id: 'daily/<date>'` (the contract's notation); the registry's route id is `daily/YYYY-MM-DD`, so `panel.graph` (listed like `panel.backlinks`) isn't found there. | `id: 'daily/YYYY-MM-DD'` in the test; a corrected copy passes all three L1 checks. |
| AP-904 → D-1054 | A rename moves the file, then rewrites links in steps (4C); a query in between draws a neighbourhood missing the not-yet-rewritten linkers (FR-GRP-01 AC-41 "keeps the 10 nodes"). | While a `note-rename` job (4C) reports `job:progress` without an end phase, a centre change (shown as Loading) and live re-asks wait for its end (at most 5 s), then ask once. |
| AP-905 → D-1055 | Test timing: `fr_ux_05_ac16_panel_graph_in_light_and_dark_light` runs axe right after the preview popover appears, during slice P's 120 ms fade-in; about 1 run in 4 reports `color-contrast` on the popover's text. | Wait until the popover is fully shown (or emulate Reduce motion) before axe, as the R115 states part does with `sleep(200)`. |

## 16. Slice G3: presets, keyboard, List

Public interfaces of slice G3, for the test author (D-61) and the build. ACs: `docs/acceptance/graph.md` part two
(R118…R124; FR-GRP-02 AC-11…AC-25, FR-SYN-03 AC-22…AC-24, FR-SYN-02 AC-8, FR-SYN-06 AC-40, FR-FMT-07 AC-27,
FR-FMT-12 AC-7, NFR-POR-01 AC-3, FR-STO-06 AC-1, FR-LNK-12 AC-8…AC-13, FR-UX-03 AC-22…AC-30, FR-UX-08 AC-1…AC-9,
FR-UX-05 AC-17, NFR-OTH-02 AC-14). Decisions: D-906, D-907, D-916…D-918, D-923, D-925, D-928, D-929, D-942, D-970;
AP-920…AP-945, accepted as proposed: D-1080…D-1105 (BRD v1.119). Fixtures:
`tests/fixtures/vaults/graph/` and `tests/fixtures/graph-presets/`. §15 is slice G2's.

G3 is the first graph slice that **writes a vault file**: `.tegg/graph.yml`, only on `save`, `update`, `rename` and
`delete` (D-906). Everything else it stores is machine-local (`ui-state.json`, §16.4).

### 16.1 The presets module (`tegg-core`, AR-03)

A new module `crates/tegg-core/src/graph_presets.rs`, platform-neutral (no Tauri or desktop dependency; it reads and
writes through `Vault`, like `settings5b.rs` and `types3d.rs`). Nothing about presets is in the index (AR-01).

```rust
pub const GRAPH_YML: &str = ".tegg/graph.yml";
pub const PRESETS_VERSION: u32 = 1;

pub struct GraphPreset {
    pub name: String,                 // NFC, trimmed, as listed
    pub hidden_types: Vec<String>,    // raw keys, NFC, file order; unknown keys kept (D-907)
    pub hidden_kinds: Vec<String>,    // raw values; only link/relation/embed/tag take effect
}

pub enum PresetsState { Missing, Ok, Newer { version: u64 }, Unreadable { line: Option<u32>, reason: String } }

pub struct GraphPresets {
    pub version: Option<FileVersion>, // the file's version as read; None when Missing
    pub state: PresetsState,
    pub presets: Vec<GraphPreset>,    // listed presets in file order (R118 read rules); empty when Unreadable
}

pub enum PresetOp {
    Save { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Update { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Rename { from: String, to: String },
    Delete { name: String },
}

pub enum PresetError { NameEmpty, NameTaken { existing: String }, NameTooLong, NameControl, NoSuchPreset, NewerVersion, Unreadable }

impl Core {
    /// Reads `.tegg/graph.yml`; never writes, never creates.
    pub fn graph_presets(&self) -> GraphPresets;
    /// One operation = at most one atomic write (FR-SYN-02). `base` is `GraphPresets.version` as last read.
    /// Errors: `Vault(Conflict { disk })` when the disk content differs from `base` (D-175: size + hash), also when
    /// `base` is None and the file exists (created with RENAME_EXCL semantics); `Vault(Gone)` when `base` is Some and
    /// the file is missing; `Preset(PresetError)`; `NotUtf8`; `Io`. An operation whose result equals the disk bytes
    /// writes nothing and returns Ok.
    pub fn graph_presets_apply(&self, base: Option<FileVersion>, op: PresetOp) -> Result<GraphPresets, CoreError>;
}
```

- **Parsing** with `yaml_rust2` for values plus a line scanner for positions (the `settings5b.rs` approach), so a patch
  knows each item's line range. `Unreadable.line` is the parser's 1-based line, when it gives one.
- **Validation** (AP-928): names trimmed and NFC; `NameEmpty`, `NameTaken { existing }` (case-insensitive after NFC,
  against listed presets and `Default`; a rename to a case variant of its own name is allowed), `NameTooLong` (> 100
  characters, counted as Unicode scalar values), `NameControl` (any `Cc` character). `NoSuchPreset` when `Update`,
  `Rename` or `Delete` names a preset not listed (the UI treats it like a conflict: reload, alert).
- **Writing** by R118's write rules (AP-921). The type order for `hidden-types` is the core's cached type order (D-994:
  system and user types in D-121 order, `tag`, then undefined keys as found), then keys not in it in their previous
  order. Quoting by `settings5b::scalar` (moved to a shared helper). New file: the header comment line of
  `expected/created.yml`, `version: 1`, `presets:`, the item, LF.
- **Refusals**: `Newer` → `PresetError::NewerVersion` for every op; `Unreadable` → `PresetError::Unreadable` for every
  op (AP-922): the file is never replaced.
- **Watcher**: `vault:changed` already carries `.tegg/…` paths (ms3-shell §3); the core drops its cached presets when
  `.tegg/graph.yml` is named. Other files in `.tegg/` (sync conflict copies) are ignored by this module (AP-925).

### 16.2 IPC

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `graph_presets_get` | — | `GraphPresetsDto` | `Core::graph_presets`. Read-only. |
| `graph_presets_apply` | `base: VersionDto \| null`, `op: PresetOpDto` | `GraphPresetsDto` (the new state) | `Core::graph_presets_apply`. Errors below. Calls are serialized in the UI (one in flight). |

```ts
type GraphPresetDto = { name: string; hiddenTypes: string[]; hiddenKinds: string[] };
type GraphPresetsDto = {
  version: VersionDto | null;
  state: 'missing' | 'ok' | 'newer' | 'unreadable';
  error: { line: number | null; reason: string } | null;   // only for 'unreadable'
  presets: GraphPresetDto[];
};
type PresetOpDto =
  | { op: 'save'; name: string; hiddenTypes: string[]; hiddenKinds: string[] }
  | { op: 'update'; name: string; hiddenTypes: string[]; hiddenKinds: string[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'delete'; name: string };
// IpcError.kind: 'Conflict' (payload `disk: GraphPresetsDto`), 'Gone', 'NameEmpty', 'NameTaken' (`existing`),
// 'NameTooLong', 'NameControl', 'NoSuchPreset', 'NewerVersion', 'Unreadable', 'NotUtf8', 'Io'.
```

UI handling (AP-924): `Conflict`, `Gone`, `NoSuchPreset` → load the returned or re-read state, show
`graph.preset.changedOutside`, keep the Save dialog or rename field open with the typed text; name errors → the R119
message under the field; `Io` → `graph.preset.saveFailed`. No error changes the view's filters.

### 16.3 UI modules (`app/ui/src/graph/`)

| Module | Owns |
| --- | --- |
| `presets.ts` | Pure: `currentPreset(view, presets)` (NFC, case-insensitive name match; dangling → Default, AP-930), `isModified(view, preset)` (NFC set comparison, AP-929), `validateName(name, presets, renaming?)` (mirrors §16.1, for live messages), `applyPreset(view, preset)` → the next `GraphViewStateDto`. L1-tested. |
| `PresetControl.tsx` | R119: the label, `Preset: <name>` button, the modified row, the `Presets` menu, the Save dialog, the rename field, the delete `alertdialog`, the alert. Props `{ view: 'full' \| 'panel'; state; onState }`, so G2 mounts it in the panel. Mounted in `GraphFilters.tsx`'s slot above `Types`. Holds the last `GraphPresetsDto` and re-reads it on `vault:changed` naming `.tegg/graph.yml`. |
| `keyboard.ts` | Pure: `nearestInDirection(positions, from, dir, sortKeys)` (R120 rule, AP-934), `graphKeyAction(event, mode, target)` → `'focusDir' \| 'preview' \| 'open' \| 'centre' \| 'zoomIn' \| 'zoomOut' \| 'fit' \| 'escape' \| null` (R120's table; null with ⌘/⌃/⌥ except ⌘⏎, ⌘⇧⏎, ⌥Space). |
| `hover.ts` | The hover controller for nodes and List rows (D-942 cancel rules, `usePreview().hoverDelay`), the ring's start and stop, the column rule of AP-941 (keeps the preview while the pointer is over canvas or column; 300 ms grace after leaving both). |
| `GraphCanvas.tsx` | Adds roving focus (`tabindex="0"` on one node, the centre by default, AP-935), the `--focus` ring (`:focus-visible`), `[data-hover-ring]`, key handling through `keyboard.ts`, panning a focused node into view, the canvas `aria-description` (`graph.canvas.help`). |
| `GraphList.tsx` | R122: `tree` `Local graph as a list`, roving `treeitem`s, WAI-ARIA tree keys, the same inputs through `keyboard.ts` and `hover.ts`; collapse state in memory only. |
| `graphModel.ts` | Adds `nodeDescription(node, result, types, index)` (R121), `positionOrder(result)` (the result's node order), `listTree(result)` → `{ key, parentKey, level, children }[]` (AP-938). |
| `GraphPage.tsx` | The `View` switch (`group` `View`, `Graph` / `List`), the hint per mode, the column's empty texts per mode (AP-943), passing `onView` writes. |

Commands (`shell/commands.ts`): R123's ids, registered with the G1 graph-route rule; `graphCommand` widens to
`'depth1' | 'depth2' | 'depth3' | 'recenter' | 'preset.apply' | 'preset.save' | 'preset.update' | 'preset.revert' |
'preset.rename' | 'preset.delete' | 'view.list' | 'view.graph'`, and commands get `disabled()` reasons
(`graph.preset.notModified`, `graph.preset.fixFile`, `graph.preset.newer`, a new `graph.preset.isDefault`
`Default can't be changed.`). Strings: every R124 key in the English catalog, plurals per D-133.

### 16.4 Machine-local state (§5 amended)

```ts
type GraphViewStateDto = {
  depth?: 1 | 2 | 3; hiddenTypes?: string[]; hiddenKinds?: EdgeKindDto[]; sizeByLinks?: boolean;  // G1
  view?: 'graph' | 'list';   // G3: missing or unknown → 'graph', not rewritten (D-906, AP-940)
  preset?: string;           // G3: the current preset's name, NFC; missing → Default; a name not listed → Default
                             //     label, kept until the next change (AP-930)
};
```

- One `ui_state_set` per committed change, as G1: applying a preset or Default (filters and `preset` together),
  `Revert`, a successful `save` (`preset` = the new name), the `View` switch. A Tegg `rename` updates `preset` in every
  view under the vault that named the old name, and a Tegg `delete` removes it there, in one `ui_state_set` after the
  file write succeeded. A filter change keeps `preset` (the view becomes modified).
- `hiddenKinds` may now hold values from a preset that aren't kinds (`backlink`): kept on write, ignored on read (§5).

### 16.5 Keyboard, focus and hover details

- Key handling is on the canvas `svg` and the `tree` (one `keydown` listener each); single keys never act from other
  elements (FR-UX-03 AC-27). `+` matches `+`, `=` and `NumpadAdd`; `−` matches `-`, `−` and `NumpadSubtract`; `0`
  matches `0` and `Numpad0`.
- ⏎ in click mode calls the G1 select-and-preview path with `origin: 'key'` and keeps the focus on the node (AP-935);
  in hover and Off it opens. ⌘⏎ and ⌘⇧⏎ open in the current view (AP-933). ⌥Space calls `show(…, 'key', column)`.
- The second Esc focuses the page's `h1` (`tabindex="-1"`, as D-130).
- Hover: `pointermove` over a node restarts the delay; the ring is an SVG element with a CSS animation of
  `stroke-dashoffset` lasting `hoverDelay` ms (none under `prefers-reduced-motion`); at the end the page calls
  `show(target, anchor, 'hover', { placement: 'column', container })` with the D-982 lines.

### 16.6 Fake core and test hooks

- `app/ui/test/fake-presets.ts`, installed by `installFakeCore`: `graph_presets_get` and `graph_presets_apply` over the
  fake's `.tegg/graph.yml`, a TypeScript twin of §16.1's parser and patcher. It is checked against the Rust module on
  every `tests/fixtures/graph-presets/` input and `expected/` output (the L4 and L1 tests read the same files).
- Handle additions: `presetCalls()` (ops in order with their bases), `presetsFail(kind)` (the next apply fails with
  `Io`, `Conflict`, …), and the existing `setFile('.tegg/graph.yml', text, { silent: true })` to make a
  base stale (D-1110) (FR-SYN-03 AC-22). `writes()` counts `graph.yml` writes as vault writes.
- L6: the helper process of ms3-shell §13.6 replaces, deletes and copies `.tegg/graph.yml` (FR-GRP-02 AC-19, AC-23,
  FR-SYN-03 AC-23); the data-safety AC-3 kill harness gains a `graph-presets` mode (FR-SYN-02 AC-8).

### 16.7 Test layout

| Layer | Files |
| --- | --- |
| L0 | AR-03 check covers `graph_presets.rs` (unchanged rule) |
| L1 | `app/test/graph_presets.ac.test.ts` (model, validation, the TS patcher vs `expected/`), `graph_keyboard.ac.test.ts` (R120 reference cases, key table), `graph_a11y.ac.test.ts` (R121 texts, `listTree`), `graph_catalog.ac.test.ts` (R123, R124) |
| L2 | `crates/tegg-core/tests/ac_graph_presets_props.rs` (patch invariants), fast-check twins for the patcher and `nearestInDirection` |
| L4 | `crates/tegg-core/tests/ac_graph_presets.rs` (read rules, every `expected/` file, conflicts, `Gone`, RENAME_EXCL, atomic writes, NFC, index-free) |
| L5 | `app/webkit/graph_presets.ac.test.ts`, `graph_keyboard.ac.test.ts`, `graph_list.ac.test.ts`, `graph_hover.ac.test.ts`, `graph_themes.ac.test.ts` (G3 states) |
| L6 | `app/e2e/graph_presets.ac.test.ts` (FR-SYN-06 AC-40 tour, external and synced changes, relaunch, kill harness) |

### 16.8 Contract choices (no owner decision needed)

1. One `graph_presets_apply` command with an op enum, not four commands: one place for the base check and the patcher.
2. The core validates names again even though the UI does (the UI's check is for live messages only).
3. Presets are re-read on `vault:changed` of `.tegg/graph.yml`, not pushed by a new event.
4. The NFC, case-insensitive name match is done in both the core and `presets.ts` from the same rule; neither depends
   on the region (FR-FMT-12 AC-7).

### 16.9 Red-test decisions (D-1106…D-1119, BRD v1.120; red tests b3eee45)

Owner, 2026-10-30, as proposed:

- **D-1106** graphModel signatures: `nodeDescription(node, result, types, index)` takes the 1-based `<i>`; `null` leaves the position out (List rows); `positionOrder` returns node keys; `listTree` returns rows in pre-order with `level` = depth (0 for the centre), `parentKey` null for the centre, `children` as node keys in result order.
- **D-1107** keyboard.ts signatures: `nearestInDirection(Map<NodeKey, Point>, from, 'left'|'right'|'up'|'down', Map<NodeKey, string>)` → `NodeKey | null`; `graphKeyAction(KeyLike, 'click'|'hover'|'off', 'node'|'row')`; plain Space, Tab and other letters → `null`; ⇧C still centres; the List handles the tree keys (↑ ↓ ← → Home End) itself.
- **D-1108** presets.ts return shapes: `currentPreset` returns `null` for Default; `validateName` returns `{ kind: 'NameEmpty' | 'NameTaken' (existing) | 'NameTooLong' | 'NameControl' } | null`, as the core; `applyPreset(view, null)` removes `preset` and keeps depth, `sizeByLinks` and `view`.
- **D-1109** The TypeScript twin's entry points: `presetsRead(text | null, utf8)` and `presetsPatch(text | null, op, typeOrder, utf8)` → `{ text, presets } | { error }` in `app/ui/test/fake-presets.ts`.
- **D-1110** Fake-core hook name: §16.6's `setFile(…, { event: false })` is the existing `{ silent: true }`.
- **D-1111** FR-LNK-12 AC-8 in the red commit: Its test first requires G3's hover ring in hover mode, then switches to click mode by the palette and checks G1's behaviour, so it is red before the build.
- **D-1112** FR-UX-08 AC-3 token contrast: The token part already holds; the contrast is computed in the L5 test after the ring checks.
- **D-1113** FR-SYN-02 AC-8 kill harness: At L4, re-running the test binary on a minimal vault (as `tegg-vault/tests/ac_crash.rs`), alternating `[kniha]` and `[tag, kniha]`; temp files are recognised by their `.tegg-tmp` suffix; no L6 harness mode.
- **D-1114** An update with unchanged sets: Writes nothing, even when a `hidden-*` key is missing in the entry (FR-SYN-06 AC-40); AC-20's update of `Bez druhů` is tested with a real change.
- **D-1115** Name rules in detail: `NameTaken.existing` is `Default` for Default; U+0085 is a control character; length counts Unicode scalar values (100 × `ř` allowed, 101 refused).
- **D-1116** Unreadable files: An unreadable existing file has `version: Some`; a save with no base onto it may answer `Preset(Unreadable)` or `Conflict`.
- **D-1117** List row text: The centre row reads `<title> · <n> connections` (no phrase); a row's own text excludes its children; the row description keeps its final period.
- **D-1118** Hover tests and the clock: FR-LNK-12 AC-13's delay change goes `Go to Settings: Previews` → Home on the slider → ⌘[ and is checked by the ring animation's duration; the hover controller's timers run on the page clock (`page.clock.install`).
- **D-1119** L6 scope: The synced atomic replace uses the existing helper's `rename` from a temp file; FR-GRP-02 AC-19's L6 test covers `invalid-yaml` only.

### 16.10 Build decisions (D-1120…D-1127, BRD v1.121)

Owner, 2026-10-30, as proposed:

- **D-1120** Unreadable line of an unclosed flow collection: When the YAML error falls inside a `[` or `{` still open, `Unreadable.line` is the line where the outermost one opened (`invalid-yaml.yml` → line 5); otherwise the parser's 1-based line.
- **D-1121** Empty presets files: An empty file, a comments-only file, or `presets:` with no value (null) read as `ok` with no presets, not as unreadable.
- **D-1122** Files that can't be patched by lines: A readable file whose presets can't be located line by line (a non-empty flow `presets: [...]`, a `- {name: x}` item, a quoted key the scanner can't find, items that don't line up with the parsed YAML) lists its presets but every write is refused with `Unreadable`, so the file is never rewritten.
- **D-1123** Name check order: `NameControl` on the raw input (any Cc character, so a leading or trailing tab is refused), then trimming of Unicode White_Space (not U+FEFF), NFC, `NameEmpty`, `NameTooLong` (> 100 scalar values), `NameTaken`; matching compares `nfc(trim(s))` lower-cased.
- **D-1124** Indentation of new items and the version line: A saved item copies the last existing item's dash and key indentation (2 / 4 spaces when there is none); a missing `version: 1` goes after the leading run of comment lines and is added only by an operation that changes the file.
- **D-1125** A rename that meets an external change: The rename field closes and the alert shows (FR-SYN-03 AC-22); the Save dialog still stays open with the typed name. Amends contract §16.2.
- **D-1126** G3 red-test corrections: `graph-helpers.ts` `menuRadio` matches the name up to a space or the end (`(?=\s|$)`, as JavaScript's `\b` fails after `ů`, `í`); FR-UX-03 AC-27's last step uses a fresh page; FR-UX-03 AC-23 and AC-25 wait for the graph to be ready before reading the route marks. Applied with the `AC-Test-Change` trailer.
- **D-1127** When `route-ready:graph/<path>` is marked: In the same commit that first shows the result (a layout effect), not after the next frame; `graph-ready` keeps its frame wait. Amends contract §3.

- **D-1128** AR-03 list in the presets test: the forbidden strings are built from parts, so the repository's AR-03
  scan of test files doesn't flag the test itself.

- **D-1129** Comments, safe writes and unpatchable files in `graph.yml`: Comment and blank lines never end a preset or a value range, at any column: a preset runs from its `- ` line to its last content line (comments inside it go with it on delete, comments after it stay); a block value runs over its deeper lines and compact `- ` lines, and comments between them are replaced on update. Before every write the new text is parsed back and must give exactly the expected presets and other keys, else the write is refused with `Unreadable`. A leading BOM stays first; `version: 1` goes after leading comments, `%` directives and the first `---`. A file with several YAML documents or a flow item (`- {…}`) lists its presets but is never written; an item that defines an anchor used elsewhere can't be deleted or updated (D-1122).

### 16.11 Build notes (no owner decision)

- **Merged after G2 (ff1e8f7).** The right panel's graph (`GraphPanel.tsx`) mounts the shared `GraphCanvas` without G3's
  keyboard props, so the panel has no tab stop, focus ring, hover ring, keyboard map or preset control yet; the G3
  canvas props are optional for that reason. Hooking G3 up in the panel (the "Seams: what G3 leaves for G2" table of
  graph.md part two: `PresetControl view="panel"`, `graph.panel.view` / `.preset`, the List switch, the keys, the hover
  popover) is a follow-up slice.
- No presets cache in the core: every call reads `.tegg/graph.yml`, so `vault:changed` needs no invalidation. `scalar`
  and `top` moved to `crates/tegg-core/src/yaml_text.rs` (shared with `settings5b.rs`).
- `IpcError` gains a flattened `presets` extra (`#[ts(skip)]`): `Conflict` carries `disk: GraphPresetsDto`, `NameTaken`
  carries `existing`. The generated TS type still names `disk?: TypeDto`; the UI casts it (follow-up: generate it).
- WebKit moves the focus to `<body>` when Tab leaves a focused SVG `<g>`, so `GraphCanvas` handles Tab and ⇧Tab itself
  (next or previous tab stop outside the canvas).
- In List view the tree comes before the filter column in the DOM (CSS `order` keeps the column on the left), so Tab
  from the `View` switch reaches the tree first; Graph view keeps G1's order.
- A pointer press hides the node focus ring (`data-pointer` on the SVG) until the next key (FR-UX-08 AC-3).
- List rows' descriptions drop the position (D-1106); `· modified` shows once, in the button, and the row under it holds
  `Update` / `Revert`; panning a focused node into view is instant in every motion setting; the hover ring stays full
  while its preview is shown.

## 17. G3 in the panel

Interfaces of the follow-up slice "G3 in the panel" for the test author (D-61) and the build. ACs:
`docs/acceptance/graph-panel-g3.md` (R125…R128; FR-GRP-01 AC-45, FR-GRP-02 AC-26…AC-34, FR-GRP-06 AC-10, FR-LNK-12
AC-14…AC-18, FR-UX-03 AC-31…AC-38, FR-UX-08 AC-10…AC-15, FR-SYN-03 AC-25, FR-SYN-06 AC-41, FR-UX-05 AC-18,
NFR-OTH-02 AC-15). AP-960…AP-974 were accepted as proposed: D-1130…D-1144 (BRD v1.128). It hooks up §16's pieces in §15's panel ("Merged after G2", §16.11). **No IPC command, no event, no
Rust change**: the panel uses `graph_neighbourhood` (§15.1, unchanged), `graph_presets_get` / `graph_presets_apply`
(§16.2) and `ui_state_set`. The only vault file it can write is `.tegg/graph.yml`, through `PresetControl`.

### 17.1 Modules touched (`app/ui/src/graph/`, `app/ui/src/App.tsx`, `shell/`)

| Module | Change |
| --- | --- |
| `GraphPanel.tsx` | Holds `presets: GraphPresetsDto \| null` (read on mount, again each time the popover opens, and on `vault:changed` naming `.tegg/graph.yml`); passes `<PresetControl view="panel" …>` into `GraphFilters`' popover slot after `Depth` (§15.2); renders the `View` switch (R125) and, for `view === 'list'`, `GraphList` in the canvas's box; owns `focusKey`, the hover controller (§17.4), the ring, the key handler (`keyboard.ts`), `describe` / `help` (R121) and passes them to `GraphCanvas` as `GraphPage` does; the footer per mode; the panel's commands and status (§17.5). Its outside-click and Esc handlers of the popover ignore events inside `[data-preset-layer]` (R125, FR-GRP-02 AC-33). |
| `GraphCanvas.tsx` | No new prop. The panel now passes `onKey`, `focusKey`, `onFocusKey`, `describe`, `help`, `ring`, `onNodePointer`, `onPan`; the "no tab stop without `onKey`" branch stays for other callers. |
| `GraphList.tsx` | Gains `variant?: 'full' \| 'panel'` (default `'full'`): the panel's row layout (AP-967: 12 px indent per level, title cut with `…`, phrase and count wrapped) and its own scroll container; rows carry `data-graph-row="<node key>"` (the popover's anchor). Inputs unchanged. |
| `PresetControl.tsx` | No API change. `view="panel"` renders the label and the button on one row (board `GraphPanel` B); every layer it opens carries `data-preset-layer`. |
| `hover.ts` | `graphHover(host, opts?: { grace: 'column' \| 'popover' })`, default `'column'` (§16.3, AP-941). `'popover'` (the panel): the hover preview hides 300 ms after the pointer has left both the node it shows and the popover (`area('popover', inside)`); the empty canvas counts as outside (D-917, D-923). The cancel rules of D-942 are the same. |
| `panelModel.ts` | `footerText(count, mode: 'click' \| 'hover' \| 'off' = 'click')` (R128; the default keeps G2's L1 test as it is). |
| `GraphFilters.tsx` | No change (the popover slot exists, §15.2). |
| `App.tsx`, `shell/commands.ts` | Commands routing (§17.5). `GraphPanelProps` gains `onViews` (as `GraphPage`, §16.4: a Tegg rename or delete changes `preset` in both views in one `ui_state_set`) and `onFocusTab(): void` (AP-960: the second Esc focuses the `Context panel`'s `tab` `Graph`). |

```ts
// GraphPanel.tsx (additions to §15.2's props)
export type GraphPanelProps = {
  // … §15.2 …
  onViews(f: (g: { full?: GraphViewStateDto; panel?: GraphViewStateDto }) =>
                 { full?: GraphViewStateDto; panel?: GraphViewStateDto }): void;
  onFocusTab(): void;
};
export type GraphPanelCommands = {
  depth(d: 1 | 2 | 3): void;            // G2, unchanged
  openFull(): void;                     // G2, unchanged (R116 rule 3)
  command(id: GraphCommandId): void;    // R127: 'preset.*', 'view.list', 'view.graph' (and 'depth1'…'depth3')
  status(): GraphStatus;                // { view, stored, modified, file } of graph.panel and the panel's presets
  state(): 'graph' | 'noLinks' | 'allHidden' | 'loading' | 'tooMany' | 'noFile' | 'deleted' | null;  // AP-972
};
```

### 17.2 Machine-local state (§15.3, §16.4)

- `graph.panel` gains §16.4's `view` and `preset`; the type `GraphViewStateDto` is unchanged. Written only by the panel
  (and by a Tegg rename or delete of a preset, in both views, §16.4), once per committed change: applying a preset or
  Default (filters and `preset` together), `Revert`, a successful `save`, the `View` switch, plus G2's changes.
- Missing or invalid `view` / `preset` read as Graph / Default and are left as they are (§16.4).
- The hand-over (§15.5) is unchanged: `GraphHandover = { depth, select }`; the panel's `preset` and `view` are never
  copied to the full view, and the hand-over writes nothing (D-905, D-1037; FR-GRP-01 AC-45). `select` is the selected
  node, or the previewed node for `In full graph` from a hover or ⌥Space preview (AP-973).

### 17.3 Presets in the panel (§16.1–§16.3)

- The panel's `PresetControl` gets `state={presets}`, `onState={setPresets}`, `graph={state}`, `onApply={onState}`,
  `onRenamed` (both views through `onViews`, as `GraphPage.onRenamed`).
- Every write passes the version of the panel's last read as base (§16.1). Because Tegg's own writes produce no
  `vault:changed` (§15.11), the panel re-reads `graph_presets_get` when it mounts and each time the popover opens, so a
  write made in the full view before is never the panel's stale base (FR-SYN-03 AC-25's last case; a stale base would
  only give a false `Conflict`, never an overwrite, since the core checks it).
- `isModified(graph.panel, current)` per view (AP-929, AP-931): an `Update` in either view writes the file and leaves
  the other view's filters as they are.

### 17.4 Keyboard, focus and hover in the panel (§16.5)

- Keys: one `keydown` handler for the canvas (`GraphCanvas onKey`) and one for the tree (`GraphList onKey`), mapped by
  `graphKeyAction(event, mode, 'node' | 'row')` (§16.3); R126's panel differences: `'centre'` does nothing (AP-962);
  `'zoomIn'` / `'zoomOut'` multiply the view's zoom by `ZOOM_STEP` within `ZOOM_MIN`…`ZOOM_MAX`, `'fit'` sets
  `panelFit(…)` with the centre pinned (AP-963); `'open'` on the centre does nothing (D-1042); `'escape'`: closes the
  preview if one is shown (or hides a hover preview), else calls `onFocusTab()` (AP-960).
- ⏎ in click mode and ⌥Space call `preview.show(target, { el }, 'key', { placement: 'popover' }, lines, inFullGraph)`;
  slice P moves the focus into the popover (D-924, AP-961) and its Esc returns it to the anchor (the node's `<g>` or the
  row).
- Arrows: `nearestInDirection(positions, focusKey, dir, sortKeys)` on the panel's layout positions; the panel pans the
  newly focused node into view with a 24 px margin (as `GraphPage.panInto`).
- Hover: `graphHover(host, { grace: 'popover' })`; `ring` only on canvas nodes; nothing starts while the filters
  popover or a `[data-preset-layer]` is open (AP-970); a mode change cancels it (FR-LNK-12 AC-18).
- Clicks per mode (R126): click mode → select and preview (G2); hover and Off → `onOpen(node)` unless the node is the
  centre (D-1042).
- The `View` switch closes a shown node preview (`close('outside')`) and clears the selection (AP-969).

### 17.5 Commands routing (R127; §15.6, §16.3)

```ts
// App.tsx (sketch)
graphCommand: (id) => {
  if (route?.id === 'graph/<path>') graphCommand.current?.(id);           // the full view, unchanged
  else if (panelShowsGraph.current && id !== 'recenter') panelGraph.current?.command(id);
},
graphStatus: () => {
  if (route?.id === 'graph/<path>') return /* §16.3, with graph.full.view */;
  if (panelShowsGraph.current && panelGraph.current) {
    const st = panelGraph.current.status();
    const v = uiRef.current?.vaults?.[vaultKey]?.graph?.panel?.view;      // the stored view leads the palette's list
    return { ...st, view: v === 'list' ? 'list' : 'graph' };
  }
  return null;
},
```

- `shell/commands.ts` keeps the listing rule `r?.id === 'graph/<path>' || panelGraph` (already merged); the `disabled()`
  reasons read `graphStatus()` and, for the panel, `panelGraph.current.state()`: `noFile` / `deleted` (and a pending
  day) → `cmd.needsObject` for the preset and view commands; `noLinks` → `graph.noLinks` for the preset commands
  (AP-972). The memo of `commands(ctx)` also depends on `graph.panel.view`.
- `graph.preset.*` from the palette (after the palette gave the focus back, D-139): open the popover, then the layer
  (`PresetActions` of the panel's control); a popover opened this way closes with that layer and the focus returns to
  the element focused before the palette (AP-968 c).
- No new command id, no shortcut (R4 unchanged except the "while the right panel shows the Graph tab" note on R123's
  rows).

### 17.6 Strings

R128: `graph.panel.footerHover`, `graph.panel.footerOff` (plurals, D-133), only if AP-964 is accepted as proposed;
everything else reuses R112, R117, R124.

### 17.7 Fake core and test hooks

- No new fake-core handle: `graphCalls()`, `presetCalls()`, `presetsFail(kind)`, `setFile(…, { silent: true })`
  (D-1110), `writes()`, `writesTo()`, `uiState()` as §15.8, §16.6.
- `app/webkit/graph-panel-helpers.ts` gains, without changing existing exports: `StartPanel.presets?: string | null`
  (text of `.tegg/graph.yml`, via `presetsVault`), `StartPanel.hoverDelay?: number`, `GraphState` with `view` and
  `preset`; panel-scoped locators `pViewGroup`, `pViewBtn(page, 'Graph' | 'List')`, `pListTree`, `pTreeRows`,
  `pRows(page)` (as `rows`, inside the tab panel), `pTabStops(page)`, `pFocused(page)`, `pHoverRing(page)`,
  `pFooterText(page)` (matching every R128 / R117 footer). G3's `presetBtn`, `presetMenu`, `menuRadio`, `saveDialog`,
  `deleteConfirm`, `presetState`, `choosePreset`, `saveAs` are page-scoped already and are reused.
- L6: the ms3-shell §13.6 helper process replaces `.tegg/graph.yml` before a panel `Save` (FR-SYN-03 AC-25); the
  relaunch reads the seeded `ui-state.json` with `graph.panel.view` and `.preset`.

### 17.8 Test layout

| Layer | Files |
| --- | --- |
| L1 | `app/test/graph_panel_g3.ac.test.ts` (`footerText` per mode, R128 keys and plurals, R127 listing with `panel: { open: true, tab: 'graph' }`, the AP-972 reasons) |
| L5 | `app/webkit/graph_panel_presets.ac.test.ts` (FR-GRP-02 AC-26…AC-33, FR-SYN-03 AC-25, FR-GRP-01 AC-45), `graph_panel_keyboard.ac.test.ts` (FR-UX-03 AC-31…AC-38), `graph_panel_list.ac.test.ts` (FR-UX-08 AC-10…AC-13, FR-GRP-06 AC-10), `graph_panel_hover.ac.test.ts` (FR-LNK-12 AC-14…AC-18, FR-UX-08 AC-14), `graph_panel_themes_g3.ac.test.ts` (FR-UX-05 AC-18, NFR-OTH-02 AC-15) |
| L6 | `app/e2e/graph_panel_g3.ac.test.ts` (graph-panel-g3.md "Real-app tests") |

### 17.9 Contract choices (no owner decision needed)

1. The panel mounts G3's modules (`PresetControl`, `GraphList`, `keyboard.ts`, `hover.ts`, `graphModel`'s descriptions)
   instead of copies, so panel and full view can't drift; differences are options (`grace`, `variant`) or the panel's
   own key handler.
2. The panel keeps its own `GraphPresetsDto` and re-reads it on mount and popover open rather than sharing a store with
   the full view: the two are never shown together (D-988), and the core's base check stays the only guard.
3. Commands keep their ids; `App.tsx` routes them to whichever graph is shown (R127).

### 17.10 Red-test decisions (D-1145…D-1153, BRD v1.129; red tests 1d3bae0)

Owner, 2026-10-30, as proposed:

- **D-1145** `GraphStatus` gains an optional `state` (the panel's `noFile` / `deleted` / `pending` / `noLinks` / `ready`), filled by `App.graphStatus` from the panel graph, so R123's commands give the D-1142 reasons.
- **D-1146** FR-UX-03 AC-38 starts with `graph.panel = { depth: 2, hiddenTypes: ['tag'] }` in `ui-state.json`; the `.tegg/graph.yml` it writes must equal `tests/fixtures/graph-presets/expected/created.yml` byte for byte.
- **D-1147** `aria-disabled` menu items stay focusable (WAI-ARIA): in the preset menu `Rename…` is ↓3 and `Delete…` ↓4; `Graph` and `List` are separate tab stops.
- **D-1148** The focus ring's contrast is computed inside the L5 test; no L1 test (it would pass before the build).
- **D-1149** Each such test first requires a feature only this slice adds, as D-1111.
- **D-1150** Unreachable from the panel (disabled while the filters match); the tours test a rename to the same name instead, and the L4 tests keep covering D-1114.
- **D-1151** The L6 test asserts the safe outcome (no lost external change) whether the watcher reloads before `Save` or a Conflict appears; the strict Conflict check stays in L5.
- **D-1152** By the ring element's bounding box without stroke: 10 px wider than a circle node, 8 px wider than a tag pill.
- **D-1153** The pressed button's background is `--bg`; the `View` group's background is `--hover`.

### 17.11 Build decisions (D-1154…D-1160, BRD v1.130; build 879c9d8)

Owner, 2026-10-30, as proposed:

- **D-1154** The title bar's current-page tab always shows the open title, so the L5 check "no tab named Rozpočet" after ⌘⇧⏎ becomes "one title-bar tab" (`[role="tab"][data-command="tab.current"]`), as G3's own check; the panel's own tabs don't count (AC-test change).
- **D-1155** ⌘⏎ / ⌘⇧⏎ from the graph focuses the page heading `h1` (`tabindex="-1"`, D-130); a click open keeps the caret in the body (D-247, D-255).
- **D-1156** Not a tab stop, as in G2: Tab from `List` lands on the tree's first row (AC-38); the button stays reachable by ⌘⇧G and the palette.
- **D-1157** The preset error alert is a preset layer (`data-preset-layer`): Esc closes it first, one layer at a time, in the panel and the full view.
- **D-1158** The node keeps its focus ring (`data-focus-held`) until the focus comes back to the graph or moves elsewhere (FR-UX-08 AC-14 with D-1131).
- **D-1159** The canvas is the window's last tab stop: Tab wraps to the window's first tab stop and ⇧Tab from there returns to the canvas.
- **D-1160** Dropped: R4 has no R123 rows; contract §17.5 already states that R123's commands act on the panel while it shows the Graph tab.

### 17.12 QA decisions (D-1161…D-1163, BRD v1.131)

Owner, 2026-10-30, from the QA review of G3 in the panel:

- **D-1161** `nfr_oth_02_ac15_panel_g3_strings_in_the_catalog` runs `Object preview: Hover to preview` and `Object preview: Off` without `.catch`, so a failed mode switch fails the test, and finds the footer by each mode's own pseudo-locale text (`graph.panel.footerHover`, `graph.panel.footerOff`), not by any `⟦…objects…⟧` text.
- **D-1162** `tabNeighbour` on the panel's canvas skips a button without an explicit `tabindex`, as WebKit's own Tab: ⇧Tab from Plán focuses `List`, the last `View` button, and `Open full view` stays out of the tab order (D-1156). The full view's canvas keeps its toolbar buttons as neighbours (FR-UX-03 AC-22).
- **D-1163** The catalog key `graph.a11y.name` `{title}, {type}` names a canvas node (`[data-graph-node]`) and a List `treeitem`. `data-user-content` sits only on the row title and the node label `<text>`, so the pseudo-locale check (NFR-OTH-02 AC-15) covers the rows' and nodes' catalog texts and `aria-description`.
