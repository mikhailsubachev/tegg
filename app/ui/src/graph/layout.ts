// Slice G1 (docs/contracts/v1-graph.md §4; ADR 0004, D-913): the layout of the full view, pure over d3-force: seeded,
// the centre pinned at the canvas centre, run to rest synchronously; with `previous`, surviving nodes stay where they
// were and new ones start next to their first kept neighbour.
import { forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
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

export function layout(model: GraphModel, size: { width: number; height: number }, previous?: Map<NodeKey, Point>): Map<NodeKey, Point> {
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
      const dist = near ? 60 : 110 * Math.max(1, n.node.depth) + 4 * i;
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
  if (free) {
    const sim = forceSimulation(nodes)
      .randomSource(rnd)
      .force('link', forceLink(links).distance(110).strength(0.6))
      .force('charge', forceManyBody().strength(-260).distanceMax(500))
      .force('collide', forceCollide<SimNode>((d) => d.r + 22))
      .stop();
    for (let i = 0; i < TICKS; i++) sim.tick();
  }
  return new Map(nodes.map((n) => [n.key, { x: n.fx ?? n.x!, y: n.fy ?? n.y! }]));
}
