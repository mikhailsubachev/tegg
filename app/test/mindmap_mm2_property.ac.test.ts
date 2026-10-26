// Slice MM2, L2 property: docs/acceptance/mindmap.md FR-MMP-02 AC-27 on random trees (contract
// docs/contracts/mm-mindmap.md §6.2): the `spider` layout of a random mindmap is deterministic (deep-equal twice); its
// nodes stay in outline order, root first; every non-root node has a side, by its first-level branch's position (1st,
// 3rd, … right; 2nd, 4th, … left) and its descendants take the branch's side; left-side nodes end at or before the
// root's left edge (x + w ≤ root x) and right-side nodes start at or after its right edge (x ≥ root x + root w); the
// root has no side; `right` of the same tree has no sides and names itself `right`; tones are the same in both
// layouts. Random callouts as app/test/mindmap_property.ac.test.ts (depth 1–5, 1–40 items, Czech words, NFC and
// NFD, every marker, 2- and 4-space indents, titles with and without fold markers, CRLF and LF, with and without a
// final newline), plus a random metadata token. Written from the AC and the contract only (D-61).
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock), printed as `seed = N`;
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) runs 10 seeds × 1,000 cases.
import { test } from 'vitest';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import { mindmapTree, parse, type MindItem } from '@tegg/doc';
import { layoutMindmap, textMeasurer, type MindLayout } from '../ui/src/mindmap/layout.ts';

const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? 20261026 : random + i)) : [20261026, random];
const RUNS = scale >= 100 ? 1000 : 100;
console.log(`mindmap spider property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);

const WORDS = ['Kořen', 'Větev', 'Žluťoučký kůň', 'Příprava', 'Účet', 'Řeka', 'Čtení', 'Dovolená velkého týmu na horách', 'Šňůra', 'Plán'];
const arb = fc.record({
  title: fc.option(fc.constantFrom(...WORDS), { nil: null }),
  fold: fc.constantFrom('', '+', '-'),
  meta: fc.constantFrom<string | null>(null, 'spider', 'foo', 'SPIDER', ''),
  marker: fc.constantFrom('-', '*', '+', '1.', '1)'),
  wide: fc.boolean(),
  check: fc.boolean(),
  steps: fc.array(fc.integer({ min: -4, max: 1 }), { maxLength: 39 }),
  words: fc.array(fc.nat(WORDS.length - 1), { minLength: 40, maxLength: 40 }),
  crlf: fc.boolean(),
  finalNewline: fc.boolean(),
  nfd: fc.boolean(),
});
type Case = typeof arb extends fc.Arbitrary<infer U> ? U : never;

function build(c: Case): string {
  const depths = [0];
  for (const s of c.steps) depths.push(Math.max(0, Math.min(4, depths[depths.length - 1] + s)));
  const ordered = c.marker.length === 2;
  const counters: number[] = [];
  const indents = [''];
  const lines: string[] = [];
  for (const [i, d] of depths.entries()) {
    counters.length = d + 1;
    counters[d] = (counters[d] ?? 0) + 1;
    const marker = ordered ? `${counters[d]}${c.marker[1]}` : c.marker;
    const word = WORDS[c.words[i]];
    lines.push(`${indents[d]}${marker} ${!ordered && c.check ? '[ ] ' : ''}${c.nfd ? word.normalize('NFD') : word} ${i + 1}`);
    indents.length = d + 1;
    indents[d + 1] = indents[d] + (c.wide ? '    ' : ' '.repeat(marker.length + 1));
  }
  const head = `> [!mindmap${c.meta === null ? '' : `|${c.meta}`}]${c.fold}${c.title ? ` ${c.title}` : ''}`;
  let text = `---\nid: 01JBMM0000000000000000P004\ntype: page\ntitle: Mapa\n---\n${[head, ...lines.map((l) => `> ${l}`)].join('\n')}`;
  if (c.finalNewline) text += '\n';
  if (c.crlf) text = text.replace(/\n/g, '\r\n');
  return text;
}
/** The ids the layout must list, in outline order, root first (§2: 'root' for a synthesized root, else the paths). */
function expectedIds(items: MindItem[]): string[] {
  const out: string[] = [];
  const walk = (it: MindItem[]) => it.forEach((i) => { out.push(i.path.join('.')); walk(i.children); });
  walk(items);
  return items.length > 1 ? ['root', ...out] : out;
}
/** The side each node must have: by the first-level branch's position (the root's children, or the top-level items). */
function expectedSides(items: MindItem[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const branches = items.length > 1 ? items : items[0]?.children ?? [];
  if (items.length > 1) out.root = null;
  else if (items[0]) out[items[0].path.join('.')] = null;
  const mark = (it: MindItem, side: string) => { out[it.path.join('.')] = side; it.children.forEach((k) => mark(k, side)); };
  branches.forEach((b, i) => mark(b, i % 2 === 0 ? 'right' : 'left'));
  return out;
}

test('fr_mmp_02_ac27_spider_layout_of_a_random_tree_is_deterministic_sided_and_ordered', { timeout: 600_000 }, () => {
  const failures: string[] = [];
  for (const seed of SEEDS) {
    try {
      fc.assert(
        fc.property(arb, (c) => {
          const mark = failures.length;
          const text = build(c);
          const raw = parse(text).blocks[0]?.raw ?? '';
          const t = mindmapTree(raw, 'Mapa');
          if (!t) { failures.push(`no tree: ${JSON.stringify(text)}`); return false; }
          const a: MindLayout = layoutMindmap(t, textMeasurer, { layout: 'spider' });
          const b: MindLayout = layoutMindmap(t, textMeasurer, { layout: 'spider' });
          if (JSON.stringify(a) !== JSON.stringify(b)) failures.push('spider twice differs');
          if (a.layout !== 'spider') failures.push(`layout ${a.layout}`);
          const ids = expectedIds(t.items);
          if (JSON.stringify(a.nodes.map((n) => n.id)) !== JSON.stringify(ids)) failures.push(`order ${a.nodes.map((n) => n.id).join(' ')} ≠ ${ids.join(' ')}`);
          const sides = expectedSides(t.items);
          const root = a.nodes[0];
          for (const n of a.nodes) {
            const side = (n as { side?: string }).side ?? null;
            if (side !== sides[n.id]) { failures.push(`${n.id}: side ${side} ≠ ${sides[n.id]}`); break; }
            if (root && side === 'left' && n.x + n.w > root.x) { failures.push(`${n.id}: left node ends at ${n.x + n.w} > root x ${root.x}`); break; }
            if (root && side === 'right' && n.x < root.x + root.w) { failures.push(`${n.id}: right node starts at ${n.x} < root right edge ${root.x + root.w}`); break; }
            if (n.w < 48 || n.w > 200 || n.h < 32 || n.x < 0 || n.y < 0) { failures.push(`${n.id}: box ${[n.x, n.y, n.w, n.h].join(',')}`); break; }
          }
          if (a.connectors.length !== a.nodes.length - 1) failures.push(`${a.connectors.length} connectors for ${a.nodes.length} nodes`);
          const r = layoutMindmap(t, textMeasurer, { layout: 'right' });
          if (r.layout !== 'right' || r.nodes.some((n) => (n as { side?: string }).side !== undefined)) failures.push('right has sides or a wrong name');
          if (JSON.stringify(r.nodes.map((n) => n.tone)) !== JSON.stringify(a.nodes.map((n) => n.tone))) failures.push('tones differ between the layouts');
          if (failures.length > mark) failures.push(`case: ${JSON.stringify(text)}`);
          return failures.length === mark;
        }),
        { seed, numRuns: RUNS, endOnFailure: true },
      );
    } catch (e) {
      failures.push(String(e).split('\n').slice(0, 4).join('\n'));
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`);
});
