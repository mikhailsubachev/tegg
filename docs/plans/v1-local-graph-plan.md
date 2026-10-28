# Local graph (v1.0): plan and open points (2026-10-23)

Status: **decided, 2026-10-28.** AP-686…AP-706 were accepted by the owner as proposed: D-900…D-920 (BRD v1.107, AP-686 → D-900 … AP-706 → D-920). Next: the ACs (`docs/acceptance/graph.md`) and a contract, per slice (D-919). The board fixes in §5 are separate: they change the design boards, not the BRD.

## 1. Scope

- **In:** FR-GRP-01, -02, -03, -05, -06, -07, -08; the graph-node part of FR-TAG-05 (D-275, D-707); the Graph tab of FR-NAV-05.
- **Out:** FR-GRP-04 global graph (v1.x, D-35).
- **Designs** (canvas page `Graph`, copies in `design/edit-note-page/`):

| Board | Covers |
| --- | --- |
| `Graph.dc.html`, `GraphDark.dc.html` | full view: toolbar (depth, Recenter), filter column (preset, types, connections, node size), canvas, preview column |
| `GraphPanel.dc.html` | the Graph tab of the right panel (A), the depth and filters popover (B), the node preview popover (C), panel → full view |
| `GraphStates.dc.html` | no links, all hidden by the filter, loading, too many nodes; full view and panel |
| `GraphDetails.dc.html` | tag nodes in tag colours (A), hover to preview (B), keyboard, VoiceOver and the List view (C), filter presets (D) |

## 2. Dependencies

- **Object previews first.** FR-GRP-03 and -06 reuse the content-first preview of FR-LNK-08…12 (D-37, D-38), which is also v1.0 and not built. The graph cannot ship before it (AP-705).
- **Index.** The link index already stores occurrences by kind (`OccurrenceKind`: Body, Attribute, Embed; ms4-links), attachment embeds already resolve to the Image or PDF object (links.md FR-ATT-07 AC-2), and tags are indexed (ms4-tags). The graph needs a neighbourhood query on top (AP-696); no new extraction.
- **Existing AC test.** FR-NAV-05 AC-1 (inbox.md) expects the Graph tab to be an aria-disabled `Coming in v1.0` placeholder. Turning it on changes that test (AP-706).

## 3. Proposed slices

| Slice | Content | Requirements |
| --- | --- | --- |
| **P** Object previews | click / hover / off setting, content-first popover, everywhere objects are referenced except the graph | FR-LNK-08…13 |
| **G1** Graph core and full view | neighbourhood query, layout, `graph/<path>` route, full view with filters (no presets yet), preview column, empty / loading / too-many states, live updates | FR-GRP-01, -02 (without presets), -03, -05, -06, -07, -08, FR-TAG-05 (graph part) |
| **G2** Graph in the panel | the Graph tab, depth and filters popover, preview popover, panel → full view, ⌘⇧G | FR-GRP-01 (panel), FR-NAV-05 |
| **G3** Presets, keyboard, List | filter presets, keyboard map, VoiceOver, List view, hover mode in the graph | FR-GRP-02 (presets), FR-UX-03, FR-UX-08, FR-LNK-12 (graph) |

G2 and G3 can run in parallel after G1.

## 4. Points for the owner

### 4.1 What the graph shows

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-686 | **What counts as an edge** | An edge joins two objects when one refers to the other through: a **link** in the body (`[[…]]`, also `#Heading` and `#^block` links, counted as links to the object), a **relation attribute** value, an **embed** (`![[…]]`; an attachment embed `![[photo.png]]` counts as an embed of its Image or PDF object, as backlinks do, FR-ATT-07 AC-2), a **tag** (`tags:` or inline `#tag`, both to the Tag node), or a **date mention** of an existing Daily note (it is a link to that note). **Not** edges: unresolved links and dates without a Daily note (no ghost nodes), links to itself, anything in `_templates/` (FR-TPL-07) or `.trash/` | Show unresolved links as faint dashed ghost nodes (more noise; ghost nodes can't be previewed or opened) |
| AP-687 | **Connection kinds and FR-GRP-02's toggles** | Four connection toggles, the same labels in the full view and the panel: `Links`, `Relations`, `Embeds`, `Tags`. A link counts in both directions (outgoing and backlink), as on every board. **FR-GRP-02 is reworded**: "toggles for links, relations, embeds and tags" instead of "backlinks / outgoing links / attribute relations / embeds" | Split `Links` into `Outgoing links` and `Backlinks` (the BRD as written; direction is only clear at depth 1, so at depth 2–3 the toggles are hard to predict) |
| AP-688 | **One edge per pair, no arrows** | Two objects joined in several ways get **one** line, drawn in the style of the strongest kind (embed > relation > link > tag). No arrowheads. Direction and every kind are named in words where it matters: the preview header (`Linked from 2026-10-07 Weekly Sync by relation Project`), VoiceOver and the List view | Arrowheads for direction (clutter at 150 nodes); one line per kind (parallel lines) |
| AP-689 | **How depth is walked** | Breadth-first from the centre, following edges in both directions; a node's depth is its shortest distance in steps. **Tag nodes and Daily notes are leaves**: they are shown when reached but not walked through, so one `#q4` or one busy day doesn't pull hundreds of objects into depth 2 | Tags are leaves, Daily notes are walked (Daily notes are often the real connection between a meeting and its people) |
| AP-690 | **Filters and the walk** | The walk follows only **visible** types and connection kinds, so every drawn node is connected to the centre through drawn nodes (no floating islands). The centre is always drawn, whatever its type. The control `Depth 1 · 2 hidden` and the type counts report how many objects the filter removed at this depth | Walk everything, then hide filtered nodes (shows "what is near", but leaves unconnected nodes floating) |
| AP-691 | **Default depth** | Both views start at depth 1 (FR-GRP-01). Depth is remembered per view with the filters (AP-692). The full view opened from the panel takes the panel's depth (as `GraphPanel` shows); opened from the palette or ⌘⇧G with no panel, it uses its own remembered depth | Depth is never remembered, always 1 |
| AP-692 | **Where state is saved** | **Per-view state** (depth, type and connection filters, node size, Graph or List, current preset): machine-local, in `ui-state.json` under `graph.panel` and `graph.full`, per vault (types differ per vault), not per object (FR-STO-07). **Presets**: portable, in the vault as `.tegg/graph.yml` (they name vault types, like `.tegg/queries/*.yml`); written atomically and only when a preset is saved, updated, renamed or deleted (FR-SYN-02, -06) | Presets machine-local too (lost when the vault moves to another Mac; never synced to mobile) |
| AP-693 | **Preset rules** | As `GraphDetails` D: one list for both views; a preset holds types and connection kinds, not depth; `Default` (all types, all connections) is built in, not stored, not renamable. A preset stores the **hidden** types, so a type created later shows in every preset. Names are unique (case-insensitive, NFC), not empty. An unknown type key in the file is ignored and kept on save; an unreadable `graph.yml` gives only `Default` and is never rewritten without a user change | Store the visible types (a new type is hidden in every existing preset) |
| AP-694 | **Node size** (FR-GRP-07) | Off by default in both views (the full-view board shows it on; §5 B6). When on, size follows the object's number of connections **in the whole vault**, in three steps, so a node doesn't change size when the depth changes | Count connections in the drawn graph only |
| AP-695 | **Tag nodes** (FR-GRP-08, D-707) | As `GraphDetails` A: a pill `#name`, tint fill and colour border and text from the tag's colour token, `None` as the neutral chip; dotted, thin edges. Tag colours apply from the start (the graph is v1.0, so D-707's "graph nodes v1.0" is met). Virtual tags (no Tag file, D-694) are shown too. Click previews the Tag object; double-click opens its tag page | Tags as circles with a `#` icon like other objects |
| AP-696 | **The legend in the panel** (FR-GRP-05) | The full view's filter column is the legend (icon, colour, name, count). In the panel the popover's type list is the legend; no extra strip under the graph. FR-GRP-05 is reworded: "the filter list doubles as the legend" | A one-line legend strip of the visible types under the panel graph (costs graph height) |

### 4.2 How it is built

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-697 | **Neighbourhood query in the core** (AR-03) | A platform-neutral query in `tegg-index`: `graph_neighbourhood(centre, depth, visible types, visible kinds, cap) → { nodes, edges, hiddenCount, total, truncated }`, nodes carrying path, title, type, depth, vault-wide degree, tag colour, and edges their kinds and direction. Cancellable: a new request cancels the running one (`GraphStates` 2). Rebuilding the index gives the same result (AR-01) | Build the graph in TypeScript from per-note link queries (many IPC round trips at depth 3) |
| AP-698 | **Size caps and a speed target** | As `GraphStates` 3: the panel draws at most **60** nodes and offers a lower depth or the full view above that; the full view draws at most **150** (most connected first; the centre and depth 1 always kept), with a banner (`Depth 2 · 86`, `Filter types…`, `Show all`). `Show all` draws up to **1,000** nodes, once, not remembered; above 1,000 only a lower depth or filters are offered. Labels hide above 60 visible nodes and show on zoom or hover. **New NFR-PERF-11**: the local graph at depth 2 is drawn in < 300 ms p95 on the 5,000-note reference vault (query plus layout); the loading state appears only after 300 ms | No `Show all` (simpler; the user can't see a big neighbourhood at all) |
| AP-699 | **Layout and library** (needs ADR 0004) | Force-directed layout with **d3-force** (MIT, small, bundled, no network, NFR-SEC-01), drawn as SVG with one focusable element per node (keyboard and VoiceOver, AP-702). The centre is pinned in the middle; the layout is seeded so the same graph at the same size gives the same picture (testable at L4); it runs to rest before the first paint, with no settling animation under Reduce motion (FR-UX-08). Positions are not stored. On a live update surviving nodes keep their place and new ones start next to their neighbour | Cytoscape.js or sigma.js (WebGL; scales further but canvas-drawn, so keyboard and VoiceOver need a parallel DOM) |
| AP-700 | **Full-view route and history** | Route `graph/<path>` (NFC, like `note/<path>`), tab title `Graph · <title>`, a TBD route no more (app-shell R1). It opens in a new tab from the panel, the palette and ⌘⇧G. `Center graph here`, Recenter on another node and the `C` key change the route's centre and push a history entry, so Back returns to the previous centre. After a rename (4C) the route follows the new path | Centring replaces the history entry (Back leaves the graph at once) |
| AP-701 | **Live updates and deleted objects** | The graph redraws when the index reports a change to any drawn object, debounced, within NFR-PERF-08 (< 2 s). A selected node that disappears loses the selection and its preview closes. If the **centre** is deleted, the full view shows `This object was deleted` with `Back` and the panel shows nothing for it (the note is gone too; new state, §5 B12) | Freeze the graph until the user presses Recenter |

### 4.3 Interaction

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-702 | **Keyboard, VoiceOver, List view** (FR-UX-03, FR-UX-08) | As `GraphDetails` C: Tab lands on the centre node; arrows move to the nearest node in that direction; Return previews (as the preview setting says); ⌘Return opens, ⌘⇧Return in a new tab; `C` centres; `+` `−` `0` zoom in, out, fit; Esc closes the preview, then leaves the graph. Single keys work only while focus is in the graph. VoiceOver reads title, type, connection count, how it is linked to the centre, and position (`2 of 9`). A `Graph` / `List` switch exists in **both** views (remembered per view, AP-692); the List view is the same neighbourhood as an indented tree | List view only in the full view |
| AP-703 | **Preview in the graph** (FR-GRP-06, FR-LNK-10) | The graph uses the standard content-first preview unchanged: in the full view's right column, in the panel as the popover beside the panel (`GraphPanel` C). The graph adds one line under the type: `Project · 4 connections`. **Hover mode uses the same preview**, not a compact card (§5 B5); the ring-fill during the hover delay and the 300 ms grace when leaving stay as drawn | A compact hover card as drawn in `GraphDetails` B (a second preview design to build and keep in step with FR-LNK-10) |
| AP-704 | **Shortcut and palette commands** | ⌘⇧G `Open graph` on any object route (the full view of the current object); Tegg has no ⌘G / ⌘⇧G find, so nothing is shadowed (to be rechecked if in-note find is added). Palette: `Show local graph` (opens the panel on Graph), `Open graph` (⌘⇧G), `Graph: Depth 1` / `2` / `3`, `Graph: Recenter`, `Graph: Apply preset…`, `Graph: Show as list` / `Show as graph`. Graph commands are listed only when a graph is open | No shortcut; palette only |

### 4.4 Order and tests

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-705 | **Slices** | §3: P (object previews) first, then G1, then G2 and G3 in parallel. Each slice ships its real-app tests (D-382) | One graph slice that also builds the preview (one long branch) |
| AP-706 | **AC and BRD text changes** | Approve the `AC-Test-Change` for FR-NAV-05 AC-1 when G2 lands (Graph tab enabled; Outline stays `Coming in v1.0`). Clean up in the same BRD version: FR-NAV-05 and FR-UX-02 still list an Attributes tab (removed by D-127); `requirements-coverage.md` FR-GRP-05 still says "the object's own icon (FR-TYP-14)" (removed by D-217); FR-GRP-02 and -05 wording per AP-687 and AP-696 | — |

## 5. Board fixes (design only, no decision needed)

Most are on the full view, which predates the other four boards. **Applied on the canvas on 2026-10-23** (version 107) and copied to `design/edit-note-page/`. The full view has new board props: `depth2` (the depth-2 state), `sizeByLinks` and `presetModified`. The dark copies are `GraphPanelDark`, `GraphStatesDark` and `GraphDetailsDark`.

| # | Board | Fix |
| --- | --- | --- |
| B1 | Graph, GraphDark | Remove the 72 px tinted cover band at the top of the preview column (D-217: no covers) |
| B2 | Graph, GraphDark | Tags edge sample in `Connections`: thin dotted, as `GraphDetails` A, not solid |
| B3 | Graph, GraphDark, GraphPanel B | One set of connection labels in both views: `Links`, `Relations`, `Embeds`, `Tags` (AP-687) |
| B4 | Graph, GraphDark | Tags appear once as a type (with the `#` pill swatch) and once as a connection kind; keep both but draw the type swatch as a pill so the list matches the canvas (AP-695) |
| B5 | GraphDetails B | Hover preview: the standard content-first preview (header, preview-attribute strip, rendered body), not the compact card; drop `Edited Thu` (no relative weekday dates elsewhere) (AP-703) |
| B6 | Graph, GraphDark | `Size nodes by links` unticked by default (AP-694) |
| B7 | Graph, GraphDark | Depth 1 selected as the default state (AP-691); keep a depth-2 variant only as a second state if wanted |
| B8 | Graph, GraphDark | Add the `Graph` / `List` switch to the toolbar (AP-702); same in the panel toolbar (GraphPanel A) |
| B9 | Graph, GraphDark | Preset select shows the `· modified` state with `Update` / `Revert` as in `GraphDetails` D2 |
| B10 | Graph, GraphDark | Preview header: `Project · 4 connections` plus the relation line (`Linked from … by relation Project`) as VoiceOver reads it (AP-688), and the buttons `Center graph here`, `Open ↩` as now |
| B11 | GraphDetails A | Replace the note "Until then every tag node uses the None style" with "Tag nodes use the tag's colour (D-707)" (AP-695) |
| B12 | GraphStates | New state: centre object deleted (full view `This object was deleted` + `Back`) (AP-701) |
| B13 | Graph, GraphDark | Footer version `v0.49` → current, or drop it from the board |
| B14 | all Graph boards | Dark renderings of `GraphPanel`, `GraphStates`, `GraphDetails` (the `dark` prop exists; check each in dark for FR-UX-05, notably tag pills and the hover ring) |

## 6. What changes once decided

- **BRD:** one D-xx per AP; FR-GRP-02, -05 reworded (AP-687, AP-696); NFR-PERF-11 added (AP-698); FR-NAV-05 / FR-UX-02 cleanup (AP-706); §11 v1.0 row names slices P, G1–G3.
- **Architecture:** ADR 0004 graph layout and rendering (AP-699); the neighbourhood query in `docs/architecture.md` (AP-697).
- **Vault layout:** `.tegg/graph.yml` (AP-692) in CLAUDE.md's vault layout and FR-STO.
- **Docs:** `docs/acceptance/graph.md` (ACs per FR-GRP, from the boards after §5), `docs/contracts/v1-graph.md`, app-shell R1/R2 (`graph` route built, Graph tab built), `requirements-coverage.md`.
