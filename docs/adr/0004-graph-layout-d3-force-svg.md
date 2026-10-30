# ADR 0004: Graph layout with d3-force, drawn as SVG

- **Status:** Accepted (owner, 2026-10-28; AP-699 → D-913; details D-985, D-992, 2026-10-29)
- **Requirements:** FR-GRP-01, FR-GRP-03, FR-GRP-05, FR-GRP-07, FR-UX-05, FR-UX-08, NFR-PERF-11, NFR-SEC-01, AR-03
- **Builds on:** D-911 (the neighbourhood query) · **Details:** `docs/contracts/v1-graph.md` §1, §4, §6; `docs/architecture.md` §5.9

## Context

The local graph (v1.0) draws an object's neighbourhood: up to 150 nodes in the full view, 60 in the panel, and up to
1,000 after `Show all` (D-912). It must be reachable by keyboard and VoiceOver (D-916), themeable from the shared tokens in
light and dark (FR-UX-05), deterministic enough to test by position (L1, L5), quiet under Reduce motion (FR-UX-08), and
drawn with the query in under 300 ms at depth 2 (NFR-PERF-11; 225 ms on the reference machine, D-986). Nothing may reach
the network (NFR-SEC-01). The graph is computed by the core (D-911); only layout and drawing are in the UI.

## Decision

1. **Layout: d3-force** (`d3-force` and its `d3-quadtree` dependency, MIT, a few tens of kB), bundled with the app.
   Link, many-body and collision forces; the centre pinned at the canvas centre (`fx`, `fy`).
2. **Deterministic:** the simulation's random source is a seeded generator, initial positions come from the node order
   of the query (which is stable, v1-graph §1.5), and the simulation runs synchronously to rest (`alpha < alphaMin` or a
   fixed tick budget) **before** the first paint. Same result and canvas size → same picture.
3. **Drawing: SVG**, one `<g>` per node with its accessible name, one `<path>` per edge, styles from CSS custom
   properties (theme tokens). React renders the SVG; d3 is used only for the numbers.
4. **Updates:** surviving nodes are fixed at their old positions while new nodes are placed next to a kept neighbour; the
   only motion is a 150 ms CSS fade of added and removed elements, none under Reduce motion (D-992). Positions are never
   stored (D-913). Nodes can't be dragged (D-985).
5. **Labels and zoom** are SVG transforms on one group; labels hide above 60 nodes unless zoomed to ≥ 150 % (D-985).

## Consequences

- **Good:** each node is a real DOM element, so focus, roles, names and axe checks work without a parallel tree; theming
  is plain CSS; layout is a pure function that L1 tests with the real library; small dependency, no WebGL.
- **Cost:** SVG slows down in the low thousands of elements. That is why the caps exist: 150 normally, 1,000 at most
  after `Show all`, which is outside the speed target (D-912). The global graph (FR-GRP-04, v1.x) may need another
  renderer and gets its own ADR.
- **Cost:** running the layout to rest before painting puts its time on the critical path; NFR-PERF-11 AC-2 reports
  layout time separately so a regression shows where it is.
- **Enforced** by: FR-GRP-01 AC-19 (seeded positions, at rest, no network request) and the existing NFR-SEC-01 checks
  (no HTTP packages, architecture §9; the L6 socket monitor). `d3-force` brings `d3-quadtree`, `d3-dispatch` and
  `d3-timer`, none of which make requests.

## Alternatives considered

- **Cytoscape.js or sigma.js (canvas/WebGL):** scale to far larger graphs, but draw on a canvas, so keyboard focus and
  VoiceOver need a parallel hidden DOM kept in step, and theming goes through their own style systems. Not needed at
  ≤ 1,000 nodes.
- **Layout in Rust** (return positions from the query): one IPC round trip less, but positions depend on the canvas size
  and the previous picture, which belong to the UI; it would also tie the core to a drawing concern (AR-03 in spirit).
- **Animated settling** (the usual force-graph look): pleasant, but untestable by position and against Reduce motion;
  rejected by D-913.
