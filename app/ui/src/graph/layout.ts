// Slice G1 (docs/contracts/v1-graph.md §4; ADR 0004, D-913): the layout of the full view, pure over d3-force: seeded,
// the centre pinned at the canvas centre, run to rest synchronously; with `previous`, surviving nodes stay where they
// were and new ones start next to their first kept neighbour.
//
// STUB (G1 red tests, TS-I1): answers no positions until slice G1 is built (the build adds d3-force).
import type { GraphModel, NodeKey } from './graphModel';

export type Point = { x: number; y: number };

export function layout(model: GraphModel, size: { width: number; height: number }, previous?: Map<NodeKey, Point>): Map<NodeKey, Point> {
  void model;
  void size;
  void previous;
  return new Map();
}
