// Slice G2, L1: the right panel's pure model (app/ui/src/graph/panelModel.ts; docs/contracts/v1-graph.md §15.1, §15.2;
// docs/acceptance/graph-panel.md R114…R117): the lower-depth offer of the 60 cap (FR-GRP-01 AC-32; D-1033), the R115
// states (FR-GRP-01 AC-29, AC-37, AC-38, AC-42), the trigger and footer texts (FR-GRP-01 AC-28, FR-GRP-02 AC-8) and the
// first-paint fit (FR-GRP-01 AC-43; D-1031). Inputs are golden results (tests/fixtures/vaults/graph-golden) and the hub
// totals of the fixture README's "Panel (G2)" table. Written from the ACs and the contract only (D-61). Modules load
// inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import type { GraphResultDto } from '../ui/src/graph/types';
import { hubLike, scenario } from './graph-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function panel(): Promise<Mod> {
  const m = await load('../ui/src/graph/panelModel.ts');
  assert.ok(m, 'ui/src/graph/panelModel.ts loads');
  return m!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** A result whose filtered walk has `total` objects (the panel never uses its nodes above 60, §15.1). */
function withTotal(total: number): GraphResultDto {
  const r = hubLike();
  return { ...r, nodes: r.nodes.slice(0, Math.min(total, r.nodes.length)), total, unfiltered: total, hidden: 0, truncated: false };
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-32

test('fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer_lower_depth', async () => {
  const m = await panel();
  // The fixture README's "Panel (G2)" table: totals at depth 1 / 2 / 3, centre included.
  const cases: [string, number[], number, number | null][] = [
    ['Rozcestník d2', [41, 161], 2, 1], ['Rozcestník d3', [41, 161, 1361], 3, 1], ['Uzel 01-a d3', [17, 21, 231], 3, 2],
    ['Paprsek 01 d2', [5, 74], 2, 1], ['Paprsek 01 d3', [5, 74, 192], 3, 1], ['Široký d1', [161], 1, null], ['Široký d2', [161, 241], 2, null],
    ['a lower depth of exactly 60 fits', [60, 61], 2, 1], ['61 at every lower depth', [61, 62, 70], 3, null], ['depth 1 never offers', [70], 1, null],
  ];
  for (const [what, totals, depth, want] of cases) {
    assert.equal(m.lowerDepthOffer(totals, depth, 60), want, `${what}: lowerDepthOffer(${JSON.stringify(totals)}, ${depth}, 60) = ${want} (D-1033)`);
  }
});

test('fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer_sixty_is_drawn', async () => {
  const m = await panel();
  const at = (r: GraphResultDto) => m.panelState({ path: 'Pages/Hub/Rozcestník.md', error: null, waiting: false, result: r, cap: 60 });
  assert.equal(at(withTotal(60)), 'graph', 'exactly 60 objects are drawn: no Too many state, no offer (R116 rule 1)');
  assert.equal(at(withTotal(61)), 'tooMany', '61 objects: Too many (D-912)');
  assert.equal(at(withTotal(41)), 'graph', 'Rozcestník at depth 1 (41): the graph');
});

// ------------------------------------------------------------------------------------------------ R115 states

test('fr_grp_01_ac29_panel_graph_on_each_route_no_file_state', async () => {
  const m = await panel();
  assert.equal(m.panelState({ path: null, error: null, waiting: false, result: null, cap: 60 }), 'noFile', 'no file (new/<type>, a virtual day): No file (D-1038)');
  assert.equal(m.panelState({ path: null, error: null, waiting: true, result: scenario('plan-d1'), cap: 60 }), 'noFile', 'No file wins over a stale result');
});

test('fr_grp_01_ac37_panel_no_links_and_all_hidden_state', async () => {
  const m = await panel();
  const st = (r: GraphResultDto) => m.panelState({ path: 'Pages/Plán čtvrtletí.md', error: null, waiting: false, result: r, cap: 60 });
  assert.equal(st(scenario('osamela-d1')), 'noLinks', 'Osamělá (no edge of any kind): No links');
  assert.equal(st(scenario('plan-h-types-none-d1')), 'allHidden', 'Plán with `None`: All hidden (the filters leave only the centre)');
  assert.equal(st(scenario('plan-every-kind-off-d1')), 'allHidden', 'Plán with every kind off: All hidden');
  assert.equal(st(scenario('plan-d1')), 'graph', 'Plán at depth 1: the graph');
  assert.equal(st(scenario('plan-a-tags-type-off-d1')), 'graph', 'a filter that leaves neighbours: the graph');
});

test('fr_grp_01_ac38_panel_loading_after_300_ms_and_while_indexing_state', async () => {
  const m = await panel();
  const p = 'Pages/Plán čtvrtletí.md';
  assert.equal(m.panelState({ path: p, error: null, waiting: true, result: null, cap: 60 }), 'loading', 'no answer 300 ms after the request: Loading');
  assert.equal(m.panelState({ path: p, error: 'NotReady', waiting: false, result: null, cap: 60 }), 'loading', 'the index isn\'t ready: Loading (D-990)');
});

test('fr_grp_01_ac42_panel_when_the_page_file_is_deleted_state', async () => {
  const m = await panel();
  const p = 'Pages/Plán čtvrtletí.md';
  assert.equal(m.panelState({ path: p, error: 'CentreInTrash', waiting: false, result: scenario('plan-d1'), cap: 60 }), 'deleted', 'CentreInTrash: Deleted (D-1039)');
  assert.equal(m.panelState({ path: p, error: 'CentreNotFound', waiting: false, result: null, cap: 60 }), 'deleted', 'CentreNotFound: Deleted');
});

// ------------------------------------------------------------------------------------------------ texts (R117)

test('fr_grp_01_ac28_panel_graph_tab_on_a_note_footer_text', async () => {
  const m = await panel();
  assert.equal(m.footerText(10), '10 objects · click a node to preview', 'Plán at depth 1');
  assert.equal(m.footerText(19), '19 objects · click a node to preview', 'Plán at depth 2');
  assert.equal(m.footerText(1), '1 object · click a node to preview', 'the singular (D-133)');
});

test('fr_grp_02_ac8_panel_filters_drive_the_walk_trigger_text', async () => {
  const m = await panel();
  assert.equal(m.triggerText(1, 0), 'Depth 1', 'nothing hidden: `Depth 1` (no ` · 0 hidden`, D-976)');
  assert.equal(m.triggerText(1, 2), 'Depth 1 · 2 hidden', 'Tags type off at depth 1');
  assert.equal(m.triggerText(2, 5), 'Depth 2 · 5 hidden', 'Tags type off at depth 2');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-43 (fit)

type Box = { w: number; top: number; bottom: number };
/** Every scaled box inside the canvas with `margin`, scaled about the pinned centre (the canvas centre). */
function fits(pos: Map<string, { x: number; y: number }>, boxes: Map<string, Box>, size: { width: number; height: number }, s: number, margin = 12): boolean {
  const cx = size.width / 2, cy = size.height / 2;
  for (const [k, p] of pos) {
    const b = boxes.get(k)!;
    const x = cx + (p.x - cx) * s, y = cy + (p.y - cy) * s;
    if (x - (b.w / 2) * s < margin - 1e-6 || x + (b.w / 2) * s > size.width - margin + 1e-6) return false;
    if (y - b.top * s < margin - 1e-6 || y + b.bottom * s > size.height - margin + 1e-6) return false;
  }
  return true;
}
function ring(n: number, radius: number, size: { width: number; height: number }) {
  const pos = new Map<string, { x: number; y: number }>([['centre', { x: size.width / 2, y: size.height / 2 }]]);
  const boxes = new Map<string, Box>([['centre', { w: 96, top: 30, bottom: 50 }]]);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pos.set(`n${i}`, { x: size.width / 2 + radius * Math.cos(a), y: size.height / 2 + radius * Math.sin(a) });
    boxes.set(`n${i}`, { w: 96, top: 17, bottom: 36 });
  }
  return { pos, boxes };
}

test('fr_grp_01_ac43_panel_canvas_size_scale_and_labels_fit', async () => {
  const m = await panel();
  const size = { width: 260, height: 640 };
  const small = ring(9, 60, size);
  assert.equal(m.panelFit(small.pos, small.boxes, size, 12), 1, 'a graph that fits at 100 % keeps 100 % (never above, D-1031)');
  for (const [w, r] of [[212, 180], [260, 240], [452, 400]] as const) {
    const sz = { width: w, height: 640 };
    const big = ring(21, r, sz);
    const s = m.panelFit(big.pos, big.boxes, sz, 12);
    assert.ok(typeof s === 'number' && s >= 0.25 && s <= 1, `canvas ${w} px: a scale in [0.25, 1] (got ${s})`);
    assert.ok(fits(big.pos, big.boxes, sz, s), `canvas ${w} px: every node box inside with a 12 px margin at ${s}`);
    assert.ok(s === 1 || !fits(big.pos, big.boxes, sz, Math.min(1, s * 1.02)), `canvas ${w} px: ${s} is the largest scale that fits (± 2 %)`);
  }
  const huge = ring(40, 5000, size);
  assert.equal(m.panelFit(huge.pos, huge.boxes, size, 12), 0.25, 'never below 25 %');
  const def = ring(21, 240, size);
  assert.equal(m.panelFit(def.pos, def.boxes, size), m.panelFit(def.pos, def.boxes, size, 12), 'the margin defaults to 12 px');
});
