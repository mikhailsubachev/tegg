// Slice G1, L1: the layout (app/ui/src/graph/layout.ts with the real d3-force; docs/contracts/v1-graph.md §4; ADR 0004,
// D-913): FR-GRP-01 AC-19 (seeded, the centre pinned at the canvas centre, at rest, the same positions on every run),
// AC-20 (with `previous`, surviving nodes keep their positions and a new node starts next to its kept neighbour),
// AC-13 (a renamed node keeps its place: keys are objectIds), and NFR-PERF-11 AC-2 (the layout time alone for a
// 150-node result, reported). Inputs are golden results (tests/fixtures/vaults/graph-golden). Written from the ACs and
// the contract only (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { GraphResultDto } from '../ui/src/graph/types';
import { PLAN, hubLike, node, scenario } from './graph-data';

type Mod = Record<string, any>;
type Pt = { x: number; y: number };
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const model = await load('../ui/src/graph/graphModel.ts');
  const lay = await load('../ui/src/graph/layout.ts');
  assert.ok(model && lay, 'graphModel.ts and layout.ts load');
  return { model: model!, lay: lay! };
}
const SIZE = { width: 820, height: 640 };
const keyOf = (m: Mod, r: GraphResultDto, k: string) => {
  const n = node(r, k);
  if (!n) throw new Error(`setup: ${k}`);
  return m.nodeKey(n) as string;
};
async function place(r: GraphResultDto, previous?: Map<string, Pt>): Promise<{ pos: Map<string, Pt>; model: Mod }> {
  const { model, lay } = await mods();
  const vm = model.buildModel(r, { sizeByLinks: false });
  return { pos: lay.layout(vm, SIZE, previous) as Map<string, Pt>, model };
}
const close = (a: Pt | undefined, b: Pt | undefined, tol: number) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

test('fr_grp_01_ac19_seeded_layout_centre_pinned_at_rest_positions', async () => {
  const r = scenario('plan-d2');
  const { pos: a, model } = await place(r);
  const { pos: b } = await place(scenario('plan-d2'));
  assert.equal(a.size, 19, 'a position for every node');
  const c = a.get(keyOf(model, r, PLAN));
  assert.ok(close(c, { x: 410, y: 320 }, 0.5), `the centre at the canvas centre (410, 320): ${JSON.stringify(c)}`);
  for (const [k, p] of a) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${k}: a finite position`);
    assert.ok(close(p, b.get(k), 0.01), `${k}: the same position on a second run (${JSON.stringify(p)} / ${JSON.stringify(b.get(k))})`);
  }
  const pts = [...a.values()];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 1, 'no two nodes at the same place');
  }
  const { pos: again } = await place(r, a);
  for (const [k, p] of a) assert.ok(close(p, again.get(k), 0.01), `${k}: at rest (laid out again from its own positions, nothing moves)`);
});

test('fr_grp_01_ac20_live_updates_within_two_seconds_layout_keeps_positions', async () => {
  const d1 = scenario('plan-d1');
  const { pos: before, model } = await place(d1);
  assert.equal(before.size, 10, 'positions for depth 1');
  const plan = d1.nodes[0];
  const osamela = { id: { path: 'Pages/Osamělá.md' }, objectId: '01JBGR0000000000000000R018', path: 'Pages/Osamělá.md', title: 'Osamělá', typeKey: 'page', depth: 1, degree: 1, tagKey: null, color: null };
  const grown: GraphResultDto = {
    ...d1, nodes: [...d1.nodes, osamela], total: 11, unfiltered: 11,
    edges: [...d1.edges, { a: osamela.id, b: plan.id, style: 'link', ways: [{ kind: 'link', from: osamela.id, key: null }] }],
  };
  const { pos: after } = await place(grown, before);
  for (const [k, p] of before) assert.ok(close(p, after.get(k), 0.5), `${k} keeps its position (± 0.5 px)`);
  const o = after.get(model.nodeKey(osamela)), c = after.get(model.nodeKey(plan));
  assert.ok(o && c && Math.hypot(o.x - c.x, o.y - c.y) <= 100, `Osamělá starts within 100 px of Plán: ${JSON.stringify(o)} / ${JSON.stringify(c)}`);
});

test('fr_grp_01_ac13_route_and_labels_follow_renames_layout_keeps_the_place', async () => {
  const r = scenario('plan-d2');
  const { pos: before, model } = await place(r);
  const renamed: GraphResultDto = {
    ...r,
    nodes: r.nodes.map((n) => ('path' in n.id && n.id.path === 'Pages/Shrnutí.md' ? { ...n, id: { path: 'Pages/Souhrn.md' }, path: 'Pages/Souhrn.md', title: 'Souhrn' } : n)),
    edges: r.edges.map((e) => {
      const f = (id: any) => ('path' in id && id.path === 'Pages/Shrnutí.md' ? { path: 'Pages/Souhrn.md' } : id);
      return { ...e, a: f(e.a), b: f(e.b), ways: e.ways.map((w) => ({ ...w, from: f(w.from) })) };
    }),
  };
  const { pos: after } = await place(renamed, before);
  const k = '01JBGR0000000000000000R007';
  assert.equal(keyOf(model, renamed, 'Pages/Souhrn.md'), k, 'the renamed node keeps its key (objectId)');
  assert.ok(close(before.get(k), after.get(k), 0.5), `Shrnutí → Souhrn keeps its position: ${JSON.stringify(before.get(k))} / ${JSON.stringify(after.get(k))}`);
});

test('nfr_perf_11_ac2_query_and_layout_reported', async () => {
  const r = hubLike();
  const times: number[] = [];
  let size = 0;
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const { pos } = await place(r);
    times.push(performance.now() - t0);
    size = pos.size;
  }
  times.sort((a, b) => a - b);
  console.log(`NFR-PERF-11 AC-2: layout alone, 150 nodes / 149 edges (the hub's Rozcestník at depth 2), p95 ${times[Math.ceil(0.95 * times.length) - 1].toFixed(1)} ms of 20 runs (reported)`);
  assert.equal(size, 150, 'the layout placed all 150 nodes');
});
