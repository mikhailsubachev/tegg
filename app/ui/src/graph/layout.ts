// Slice G1 (docs/contracts/v1-graph.md §4; ADR 0004, D-913): the layout of the full view, pure over d3-force: seeded,
// the centre pinned at the canvas centre, run to rest synchronously; with `previous`, surviving nodes stay where they
// were and new ones start next to their first kept neighbour.
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { sortKey, type GraphModel, type NodeKey } from './graphModel';

export type Point = { x: number; y: number };

type SimNode = SimulationNodeDatum & { key: NodeKey; r: number };

/** A small deterministic generator (LCG), so the same graph at the same size gives the same picture (D-913). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TICKS = 300;

/** Force settings; the panel (slice G2, D-1031) draws a tighter picture than the full view. */
export type LayoutOpts = {
  distance?: number; charge?: number; gap?: number;
  /** Slice G2 (D-1031): keep every free node's box inside the canvas with `margin`, pulled towards the centre line
   *  (`squeeze`, the narrow panel), so the first paint fits at 100 % whenever it can. */
  bounds?: { margin: number; box: (key: NodeKey) => { w: number; top: number; bottom: number }; squeeze?: number };
};

export function layout(model: GraphModel, size: { width: number; height: number }, previous?: Map<NodeKey, Point>, opts: LayoutOpts = {}): Map<NodeKey, Point> {
  const distance = opts.distance ?? 110, charge = opts.charge ?? -260, gap = opts.gap ?? 22;
  const cx = size.width / 2, cy = size.height / 2;
  const bySort = new Map(model.nodes.map((n) => [n.sortKey, n]));
  const neighbours = new Map<NodeKey, NodeKey[]>();
  for (const e of model.edges) {
    const a = bySort.get(sortKey(e.a)), b = bySort.get(sortKey(e.b));
    if (!a || !b) continue;
    neighbours.set(a.key, [...(neighbours.get(a.key) ?? []), b.key]);
    neighbours.set(b.key, [...(neighbours.get(b.key) ?? []), a.key]);
  }
  const rnd = seeded(0x7e99);
  const placed = new Map<NodeKey, Point>();
  const nodes: SimNode[] = [];
  const ordered = [...model.nodes].sort((a, b) => a.node.depth - b.node.depth);
  ordered.forEach((n, i) => {
    const sim: SimNode = { key: n.key, r: n.size / 2 };
    const old = previous?.get(n.key);
    if (n.centre) {
      sim.x = sim.fx = cx;
      sim.y = sim.fy = cy;
    } else if (old) {
      sim.x = sim.fx = old.x;
      sim.y = sim.fy = old.y;
    } else {
      // A new node starts next to its first placed neighbour (D-913), else on a ring by depth.
      const near = (neighbours.get(n.key) ?? []).map((k) => placed.get(k)).find((p) => !!p);
      const angle = rnd() * 2 * Math.PI;
      const dist = near ? (distance * 6) / 11 : distance * Math.max(1, n.node.depth) + 4 * i;
      const from = near ?? { x: cx, y: cy };
      sim.x = from.x + Math.cos(angle) * dist;
      sim.y = from.y + Math.sin(angle) * dist;
    }
    placed.set(n.key, { x: sim.x!, y: sim.y! });
    nodes.push(sim);
  });
  const index = new Map(nodes.map((n) => [n.key, n]));
  const links: SimulationLinkDatum<SimNode>[] = [];
  for (const e of model.edges) {
    const a = bySort.get(sortKey(e.a)), b = bySort.get(sortKey(e.b));
    if (a && b) links.push({ source: index.get(a.key)!, target: index.get(b.key)! });
  }
  const free = nodes.some((n) => n.fx === undefined);
  const b = opts.bounds;
  const clamp = () => {
    if (!b) return;
    for (const n of nodes) {
      if (n.fx !== undefined) continue;
      const box = b.box(n.key);
      const lo = b.margin + box.w / 2, hi = size.width - b.margin - box.w / 2;
      const top = b.margin + box.top, bottom = size.height - b.margin - box.bottom;
      if (lo <= hi) n.x = Math.min(hi, Math.max(lo, n.x!)); else n.x = cx;
      if (top <= bottom) n.y = Math.min(bottom, Math.max(top, n.y!)); else n.y = cy;
    }
  };
  if (free) {
    clamp();
    const sim = forceSimulation(nodes)
      .randomSource(rnd)
      .force('link', forceLink(links).distance(distance).strength(0.6))
      .force('charge', forceManyBody().strength(charge).distanceMax(500))
      .force('collide', forceCollide<SimNode>((d) => d.r + gap))
      .stop();
    if (b?.squeeze) sim.force('x', forceX<SimNode>(cx).strength(b.squeeze)).force('y', forceY<SimNode>(cy).strength(b.squeeze / 6));
    for (let i = 0; i < TICKS; i++) { sim.tick(); clamp(); }
  }
  return new Map(nodes.map((n) => [n.key, { x: n.fx ?? n.x!, y: n.fy ?? n.y! }]));
}
