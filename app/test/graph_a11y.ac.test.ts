// Slice G3, L1 and L2: what VoiceOver reads and the List tree, as pure functions of a graph result
// (app/ui/src/graph/graphModel.ts `nodeDescription`, `positionOrder`, `listTree`; docs/contracts/v1-graph.md §16.3;
// docs/acceptance/graph.md R121, R122, AP-937, AP-938): FR-UX-08 AC-1 (each node's description and position at depths
// 1 and 2 and after a filter change), AC-6 (the tree of Plán at depth 2 is R122's, every golden scenario's tree has the
// canvas's node set with each node under its first neighbour one step closer; L2: the same for random results).
// Inputs are golden results (tests/fixtures/vaults/graph-golden), so the tests don't depend on the query. Written from
// the ACs and the contract only (D-61). Modules load inside the tests; every call goes through `run` (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { GraphEdgeDto, GraphNodeDto, GraphResultDto } from '../ui/src/graph/types';
import { PLAN, RELATION_NAMES, golden, expand, node, scenario } from './graph-data';

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
  for (const f of ['nodeDescription', 'positionOrder', 'listTree']) assert.equal(typeof m![f], 'function', `graphModel.${f} (§16.3)`);
  return m!;
}
/** fast-check's own error wraps the first AssertionError; rethrown as one so the report names it. */
function check(f: () => void) {
  try {
    f();
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    assert.fail(`AssertionError in a property: ${(e as Error)?.message ?? e}`);
  }
}
function run<T>(what: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    assert.fail(`${what} threw: ${(e as Error)?.message ?? e}`);
  }
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const nfc = (s: string) => s.normalize('NFC');
const sk = (n: GraphNodeDto) => ('path' in n.id ? n.id.path : `tag:${n.id.tag}`);
const must = (r: GraphResultDto, key: string): GraphNodeDto => {
  const n = node(r, key);
  if (!n) throw new Error(`setup: ${key} in the golden result`);
  return n;
};
/** positionOrder as sort keys. */
function order(m: Mod, r: GraphResultDto): string[] {
  const keys = run('positionOrder', () => m.positionOrder(r)) as string[];
  const byKey = new Map(r.nodes.map((n) => [m.nodeKey(n) as string, sk(n)]));
  return keys.map((k) => byKey.get(k) ?? `<unknown ${k}>`);
}
const R = {
  rozpocet: 'Projekty/Rozpočet 2027.md', zapis: 'Schůzky/Zápis z porady.md', shrnuti: 'Pages/Shrnutí.md', den: 'Daily/2026-10-07.md', graf: 'Images/Graf výdajů.md',
  recept: 'Pages/Recept na koláč.md', ukol: 'Tasks/Zaplatit fakturu.md', jana: 'Osoby/Jana Nováková.md', petr: 'Osoby/Petr Dvořák.md', smlouva: 'PDFs/Smlouva.md',
  bez: 'Pages/Bez hlavičky.md', chybna: 'Pages/Chybná hlavička.md', vydaje: 'Pages/Výdaje 2026.md',
};
const D1 = [PLAN, R.rozpocet, R.zapis, R.shrnuti, 'tag:účty', R.den, 'tag:nápad', R.graf, R.recept, R.ukol].map(nfc);
const D2 = [...D1, R.jana, R.petr, R.smlouva, R.bez, R.chybna, R.vydaje, 'tag:archiv', 'tag:cestování', 'tag:finance'].map(nfc);

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-1

test('fr_ux_08_ac1_node_descriptions_and_positions', async () => {
  const m = await model();
  const d1 = scenario('plan-d1');
  const d2 = scenario('plan-d2');
  assert.deepEqual(order(m, d1), D1, 'R121: the order at depth 1 (depth, degree descending, sort key)');
  assert.deepEqual(order(m, d2), D2, 'R121: the order at depth 2 (19)');
  const desc = (r: GraphResultDto, key: string, i: number | null) => run(`nodeDescription(${key})`, () => m.nodeDescription(must(r, key), r, RELATION_NAMES, i));
  assert.equal(desc(d1, PLAN, 1), '9 connections. Centre of the graph. 1 of 10.', 'the centre');
  assert.equal(desc(d1, R.rozpocet, 2), '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí. 2 of 10.', 'Rozpočet');
  assert.equal(desc(d1, 'tag:účty', 5), '3 connections. Tag of Plán čtvrtletí. 5 of 10.', '#účty');
  assert.equal(desc(d1, R.ukol, 10), '1 connection. Embedded in Plán čtvrtletí · Links to Plán čtvrtletí by relation Source. 10 of 10.', 'Úkol (the `one` plural form)');
  assert.equal(desc(d2, R.jana, 11), '3 connections. Linked from Rozpočet 2027 by relation Vlastník. 11 of 19.', 'Jana at depth 2: to the first neighbour one step closer');
  const noTags = scenario('plan-a-tags-type-off-d1');
  assert.equal(order(m, noTags).indexOf(nfc(R.den)) + 1, 5, 'with Tags hidden at depth 1, Den is 5th');
  const deg = must(noTags, R.den).degree;
  assert.equal(desc(noTags, R.den, 5), `${deg} connection${deg === 1 ? '' : 's'}. Linked from Plán čtvrtletí. 5 of 8.`, 'Den: `5 of 8`');
  assert.equal(desc(d1, R.rozpocet, null), '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí.', 'without the position (a List row, R122)');
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'the catalog loads');
  const en = cat!.en as Record<string, unknown>;
  cat!.setCatalog({ ...en, 'graph.connectionsCount': { one: '{count} spojení', few: '{count} spojení', other: '{count} spojení' }, 'graph.a11y.position': '{index} z {total}' }, 'cs');
  assert.equal(desc(d1, 'tag:účty', 5), '3 spojení. Tag of Plán čtvrtletí. 5 z 10.', 'the texts come from the catalog (graph.connectionsCount, graph.a11y.position)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-6

type Row = { key: string; parentKey: string | null; level: number; children: string[] };
function tree(m: Mod, r: GraphResultDto): { sk: string; parent: string | null; level: number; children: string[] }[] {
  const rows = run('listTree', () => m.listTree(r)) as Row[];
  assert.ok(Array.isArray(rows), 'listTree returns rows');
  const byKey = new Map(r.nodes.map((n) => [m.nodeKey(n) as string, sk(n)]));
  const s = (k: string | null) => (k === null ? null : byKey.get(k) ?? `<unknown ${k}>`);
  return rows.map((x) => ({ sk: s(x.key)!, parent: s(x.parentKey), level: x.level, children: x.children.map((c) => s(c)!) }));
}
/** The D-982 line-2 rule: the first neighbour one step closer, by sort key. */
function parentOf(r: GraphResultDto, n: GraphNodeDto): string | null {
  if (n.depth === 0) return null;
  const nb = (e: GraphEdgeDto) => {
    const a = 'path' in e.a ? e.a.path : `tag:${e.a.tag}`, b = 'path' in e.b ? e.b.path : `tag:${e.b.tag}`;
    return a === sk(n) ? b : b === sk(n) ? a : null;
  };
  const depth = new Map(r.nodes.map((x) => [sk(x), x.depth]));
  return r.edges.map(nb).filter((x): x is string => x !== null && depth.get(x) === n.depth - 1).sort()[0] ?? null;
}

test('fr_ux_08_ac6_list_tree_matches_the_canvas', async () => {
  const m = await model();
  const t = tree(m, scenario('plan-d2'));
  const want: [string, number, string | null][] = [
    [PLAN, 0, null],
    [R.rozpocet, 1, PLAN], [R.jana, 2, R.rozpocet], [R.vydaje, 2, R.rozpocet], ['tag:finance', 2, R.rozpocet],
    [R.zapis, 1, PLAN], [R.petr, 2, R.zapis], [R.smlouva, 2, R.zapis], ['tag:cestování', 2, R.zapis],
    [R.shrnuti, 1, PLAN], [R.bez, 2, R.shrnuti], [R.chybna, 2, R.shrnuti], ['tag:archiv', 2, R.shrnuti],
    ['tag:účty', 1, PLAN], [R.den, 1, PLAN], ['tag:nápad', 1, PLAN], [R.graf, 1, PLAN], [R.recept, 1, PLAN], [R.ukol, 1, PLAN],
  ];
  assert.deepEqual(t.map((x) => [x.sk, x.level, x.parent]), want.map(([k, l, p]) => [nfc(k), l, p === null ? null : nfc(p)]), 'R122: the 19 rows of Plán at depth 2 (pre-order, levels, parents)');
  assert.deepEqual(t[0].children, [R.rozpocet, R.zapis, R.shrnuti, 'tag:účty', R.den, 'tag:nápad', R.graf, R.recept, R.ukol].map(nfc), 'the centre\'s children in the result order');
  for (const s of golden().scenarios) {
    const r = expand(golden(), s);
    const rows = tree(m, r);
    assert.deepEqual(rows.map((x) => x.sk).sort(), r.nodes.map(sk).sort(), `${s.name}: one row per drawn node`);
    for (const x of rows) {
      const n = must(r, x.sk);
      assert.equal(x.parent, parentOf(r, n), `${s.name}: ${x.sk} sits under its first neighbour one step closer`);
      assert.equal(x.level, n.depth, `${s.name}: ${x.sk} level = depth`);
    }
  }
});

/** A random result: a BFS layering with extra edges between adjacent or equal levels. */
const randomResult = fc.record({
  depths: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 14 }),
  links: fc.array(fc.tuple(fc.nat(30), fc.nat(30)), { maxLength: 20 }),
  parents: fc.array(fc.nat(30), { minLength: 14, maxLength: 14 }),
  degrees: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 15, maxLength: 15 }),
}).map(({ depths, links, parents, degrees }) => {
  const ds = [0, ...[...depths].sort()];
  for (let i = 1; i < ds.length; i++) ds[i] = Math.min(ds[i], ds[i - 1] + 1);
  const nodes: GraphNodeDto[] = ds.map((d, i) => ({ id: { path: `Pages/N${String(i).padStart(2, '0')}.md` }, objectId: null, path: `Pages/N${String(i).padStart(2, '0')}.md`, title: `Uzel ${i}`, typeKey: 'page', depth: d, degree: degrees[i], tagKey: null, color: null }));
  const edges = new Map<string, GraphEdgeDto>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    edges.set(`${x}-${y}`, { a: nodes[x].id, b: nodes[y].id, style: 'link', ways: [{ kind: 'link', from: nodes[x].id, key: null }] });
  };
  for (let i = 1; i < nodes.length; i++) {
    const up = nodes.map((n, j) => [n, j] as const).filter(([n]) => n.depth === nodes[i].depth - 1);
    add(i, up[parents[i - 1] % up.length][1]);
  }
  for (const [a, b] of links) {
    const x = a % nodes.length, y = b % nodes.length;
    if (Math.abs(nodes[x].depth - nodes[y].depth) <= 1) add(x, y);
  }
  const ordered = [...nodes].sort((p, q) => p.depth - q.depth || q.degree - p.degree || (sk(p) < sk(q) ? -1 : 1));
  return { nodes: ordered, edges: [...edges.values()], total: nodes.length, unfiltered: nodes.length, hidden: 0, truncated: false, typeCounts: [['page', nodes.length]] } as GraphResultDto;
});

test('fr_ux_08_ac6_list_tree_matches_the_canvas_property', async () => {
  const m = await model();
  check(() => fc.assert(fc.property(randomResult, (r) => {
    const rows = tree(m, r);
    assert.deepEqual(rows.map((x) => x.sk).sort(), r.nodes.map(sk).sort(), 'every drawn node is one row');
    const at = new Map(rows.map((x, i) => [x.sk, i]));
    for (const x of rows) {
      const n = must(r, x.sk);
      assert.equal(x.parent, parentOf(r, n), `${x.sk}: under its first neighbour one step closer`);
      if (x.parent !== null) assert.ok(at.get(x.parent)! < at.get(x.sk)!, `${x.sk}: after its parent (pre-order)`);
      const pos = r.nodes.map(sk);
      assert.deepEqual(x.children, [...x.children].sort((a, b) => pos.indexOf(a) - pos.indexOf(b)), `${x.sk}: children in the result order`);
    }
  }), { seed: 1030, numRuns: 200 }));
});
