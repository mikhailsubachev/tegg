// Slice MM, L2 property: docs/acceptance/mindmap.md FR-FMT-07 AC-24 (c), its layout part: for random mindmap callouts
// (depth 1–5, 1–40 items, Czech words in NFC and NFD, markers `-`, `*`, `+`, `1.`, `1)`, checklist items, 2- and
// 4-space indents, titles with and without fold markers, CRLF and LF, with and without a final newline), the layout of
// the tree read back after a load–save round trip equals the layout before the save, and has one node per item (plus a
// synthesized root). The editor parts of (c) are packages/editor/test/mindmap.property.ac.test.ts. Interfaces:
// docs/contracts/mm-mindmap.md §1.2, §2. Written from the AC and the contract only (D-61).
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock), printed as `seed = N`;
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) runs 10 seeds × 1,000 cases.
import { test } from 'vitest';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import { mindmapTree, parse, serialize } from '@tegg/doc';
import { layoutMindmap, textMeasurer } from '../ui/src/mindmap/layout.ts';

const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? 20261025 : random + i)) : [20261025, random];
const RUNS = scale >= 100 ? 1000 : 100;
console.log(`mindmap layout property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);

const WORDS = ['Kořen', 'Větev', 'Žluťoučký kůň', 'Příprava', 'Účet', 'Řeka', 'Čtení', 'Dovolená velkého týmu na horách', 'Šňůra', 'Plán'];
const arb = fc.record({
  title: fc.option(fc.constantFrom(...WORDS), { nil: null }),
  fold: fc.constantFrom('', '+', '-'),
  marker: fc.constantFrom('-', '*', '+', '1.', '1)'),
  wide: fc.boolean(),
  check: fc.boolean(),
  steps: fc.array(fc.integer({ min: -4, max: 1 }), { maxLength: 39 }),
  words: fc.array(fc.nat(WORDS.length - 1), { minLength: 40, maxLength: 40 }),
  crlf: fc.boolean(),
  finalNewline: fc.boolean(),
  nfd: fc.boolean(),
});
type Case = fc.Arbitrary<typeof arb extends fc.Arbitrary<infer T> ? T : never> extends fc.Arbitrary<infer U> ? U : never;

function build(c: Case): { text: string; items: number; top: number } {
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
  const head = `> [!mindmap]${c.fold}${c.title ? ` ${c.title}` : ''}`;
  let text = `---\nid: 01JBMM0000000000000000P002\ntype: page\ntitle: Mapa\n---\n${[head, ...lines.map((l) => `> ${l}`)].join('\n')}`;
  if (c.finalNewline) text += '\n';
  if (c.crlf) text = text.replace(/\n/g, '\r\n');
  return { text, items: depths.length, top: depths.filter((d) => d === 0).length };
}

test('fr_fmt_07_ac24_c_layout_of_the_tree_read_back_equals_the_layout_before', { timeout: 600_000 }, () => {
  const failures: string[] = [];
  for (const seed of SEEDS) {
    try {
      fc.assert(
        fc.property(arb, (c) => {
          const mark = failures.length;
          const { text, items, top } = build(c);
          const raw = parse(text).blocks[0]?.raw ?? '';
          const t0 = mindmapTree(raw, 'Mapa');
          if (!t0) { failures.push(`no tree: ${JSON.stringify(text)}`); return false; }
          const before = layoutMindmap(t0, textMeasurer);
          const want = items + (top > 1 ? 1 : 0);
          if (before.nodes.length !== want) failures.push(`${before.nodes.length} nodes, want ${want}`);
          const back = parse(serialize(parse(text))).blocks[0]?.raw ?? '';
          const t1 = mindmapTree(back, 'Mapa');
          if (!t1 || JSON.stringify(layoutMindmap(t1, textMeasurer)) !== JSON.stringify(before)) failures.push('the layout read back differs');
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
