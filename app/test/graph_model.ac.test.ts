// Slice G1, L1: the full view's pure view model (app/ui/src/graph/graphModel.ts; docs/contracts/v1-graph.md §4, §7):
// node keys and sort keys (§1.6), the size steps of R113 (FR-GRP-07 AC-1, AC-2; D-975), the label rules (FR-GRP-01
// AC-18; D-985), the connection phrases of D-982 (FR-GRP-06 AC-3), and the heading and depth-status texts (FR-GRP-01
// AC-15, FR-GRP-02 AC-2; D-976). Inputs are golden results (tests/fixtures/vaults/graph-golden), so these tests don't
// depend on the query. Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import type { GraphNodeDto, GraphResultDto } from '../ui/src/graph/types';
import { PLAN, RELATION_NAMES, node, scenario } from './graph-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function model(): Promise<Mod> {
  const m = await load('../ui/src/graph/graphModel.ts');
  assert.ok(m, 'ui/src/graph/graphModel.ts loads');
  return m!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const must = (r: GraphResultDto, key: string): GraphNodeDto => {
  const n = node(r, key);
  if (!n) throw new Error(`setup: ${key} in the golden result`);
  return n;
};

// ------------------------------------------------------------------------------------------------ keys

test('fr_grp_01_ac13_route_and_labels_follow_renames_node_key_is_the_object_id', async () => {
  const m = await model();
  const r = scenario('plan-d3');
  assert.equal(m.nodeKey(must(r, PLAN)), '01JBGR0000000000000000R001', 'an object with an id: its objectId');
  assert.equal(m.nodeKey(must(r, 'Pages/Bez hlavičky.md')), 'Pages/Bez hlavičky.md', 'no id: the sort key (path)');
  assert.equal(m.nodeKey(must(r, 'tag:nápad')), 'tag:nápad', 'a virtual tag: tag:<key>');
  assert.equal(m.nodeKey(must(r, 'tag:účty')), '01JBGR0000000000000000R019', 'a tag with a Tag file: its file\'s id');
  assert.equal(m.sortKey({ tag: 'účty' }), 'tag:účty', 'sort key of a tag node');
  assert.equal(m.sortKey({ path: 'Pages/Shrnutí.md' }), 'Pages/Shrnutí.md', 'sort key of an object');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-07

test('fr_grp_07_ac1_size_by_links_off_by_default_model', async () => {
  const m = await model();
  const r = scenario('plan-d2');
  const mod = m.buildModel(r, { sizeByLinks: false });
  const by = (k: string) => (mod.nodes as any[]).find((n) => n.sortKey === k.normalize('NFC'));
  assert.equal(mod.nodes.length, 19, 'one model node per result node');
  assert.deepEqual([by(PLAN)?.step, by(PLAN)?.size, by(PLAN)?.centre], ['centre', 68, true], 'the centre: 68 px');
  for (const n of mod.nodes as any[]) {
    if (n.centre) continue;
    assert.equal(n.step, 'default', `${n.sortKey}: default`);
    assert.equal(n.size, n.node.depth === 1 ? 44 : 38, `${n.sortKey}: 44 px at depth 1, 38 deeper`);
  }
});

test('fr_grp_07_ac2_three_steps_by_vault_degree_steps', async () => {
  const m = await model();
  assert.deepEqual([0, 1, 4, 5, 6, 16, 19, 20, 40, 160].map((d) => m.sizeStep(d)),
    ['small', 'small', 'small', 'medium', 'medium', 'medium', 'medium', 'large', 'large', 'large'], 'small 0–4, medium 5–19, large ≥ 20 (D-975)');
  const r = scenario('plan-d2');
  const mod = m.buildModel(r, { sizeByLinks: true });
  const steps = Object.fromEntries((mod.nodes as any[]).map((n) => [n.sortKey, [n.step, n.size]]));
  assert.equal(Object.keys(steps).length, 19, 'every node');
  for (const [k, v] of Object.entries(steps)) {
    const want = k === PLAN.normalize('NFC') ? ['centre', 68]
      : ['Projekty/Rozpočet 2027.md', 'Schůzky/Zápis z porady.md'].includes(k) ? ['medium', 44] : ['small', 36];
    assert.deepEqual(v, want, `${k}`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-18

test('fr_grp_01_ac18_labels_hide_above_sixty_and_return_on_zoom_or_hover_rules', async () => {
  const m = await model();
  const v = (drawn: number, zoom: number, who: Partial<{ centre: boolean; selected: boolean; hovered: boolean }> = {}) =>
    m.labelVisible({ drawn, zoom, centre: false, selected: false, hovered: false, ...who });
  assert.equal(v(41, 1), true, '≤ 60 nodes at 100 %: shown');
  assert.equal(v(60, 1), true, '60 nodes: shown');
  assert.equal(v(61, 1), false, 'more than 60: hidden');
  assert.equal(v(150, 1), false, '150 at 100 %: hidden');
  assert.equal(v(150, 1.5), true, '150 at 150 %: shown');
  assert.equal(v(41, 0.59), false, 'below 60 %: hidden even with ≤ 60 nodes');
  for (const who of [{ centre: true }, { selected: true }, { hovered: true }]) {
    assert.equal(v(150, 1, who), true, `${Object.keys(who)[0]}: always shown`);
    assert.equal(v(41, 0.25, who), true, `${Object.keys(who)[0]}: shown at 25 %`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-3

test('fr_grp_06_ac3_connection_in_words', async () => {
  const m = await model();
  const r = scenario('plan-d2');
  const say = (key: string, res = r) => m.connectionPhrase(must(res, key), res, RELATION_NAMES);
  assert.equal(say('Projekty/Rozpočet 2027.md'), 'Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí', 'Rozpočet');
  assert.equal(say('Pages/Shrnutí.md'), 'Embedded in Plán čtvrtletí · Links to Plán čtvrtletí', 'Shrnutí');
  assert.equal(say('Tasks/Zaplatit fakturu.md'), 'Embedded in Plán čtvrtletí · Links to Plán čtvrtletí by relation Source', 'Úkol (reserved `source`, D-971)');
  assert.equal(say('Pages/Recept na koláč.md'), 'Links to Plán čtvrtletí', 'Recept');
  assert.equal(say('Daily/2026-10-07.md'), 'Linked from Plán čtvrtletí', 'Den');
  assert.equal(say('tag:účty'), 'Tag of Plán čtvrtletí', '#účty');
  assert.equal(say('Osoby/Jana Nováková.md'), 'Linked from Rozpočet 2027 by relation Vlastník', 'Jana at depth 2: its first neighbour one step closer by path');
  assert.equal(say(PLAN), null, 'the centre has no such line');
  const u = scenario('ucty-d1');
  assert.equal(say('Pages/Faktury.md', u), 'Links to #Účty · Tagged #Účty', 'Faktury with #účty as the centre');
});

// ------------------------------------------------------------------------------------------------ texts (R109, R112)

test('fr_grp_01_ac15_cap_keeps_the_most_connected_150_heading_text', async () => {
  const m = await model();
  assert.equal(m.headingCount(scenario('plan-d1')), '10 objects', 'Plán d1');
  assert.equal(m.headingCount(scenario('plan-d2')), '19 objects', 'Plán d2');
  assert.equal(m.headingCount(scenario('osamela-d1')), '1 object', 'one object (plural forms, D-133)');
  const nodes = scenario('plan-d3').nodes;
  const capped = { ...scenario('plan-d3'), nodes: Array.from({ length: 150 }, (_, i) => nodes[i % nodes.length]), total: 161, unfiltered: 161, truncated: true };
  assert.equal(m.headingCount(capped), '150 of 161 objects', 'truncated: `<shown> of <n> objects` (D-976)');
});

test('fr_grp_02_ac2_hidden_types_are_not_walked_hidden_status', async () => {
  const m = await model();
  assert.equal(m.hiddenText(scenario('plan-a-tags-type-off-d1')), '2 hidden', 'Tags off, depth 1');
  assert.equal(m.hiddenText(scenario('plan-b-tags-type-off-d2')), '5 hidden', 'Tags off, depth 2');
  assert.equal(m.hiddenText(scenario('plan-c-projekty-off-d2')), '3 hidden', 'Projekty off, depth 2');
  assert.equal(m.hiddenText(scenario('plan-d1')), null, 'absent when 0 (R109)');
});
