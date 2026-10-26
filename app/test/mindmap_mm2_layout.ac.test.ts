// Slice MM2, L1: the `spider` layout (docs/acceptance/mindmap.md R96; contract docs/contracts/mm-mindmap.md §6.2).
// FR-MMP-02 AC-27: with the Measurer, `layoutMindmap` of Pavouk with `spider` equals R96's boxes, sides, tones and
// connector points exactly; Pavouk with `right` and Strom with `spider` likewise; `opts.layout` defaults to the tree's;
// the same tree twice gives deep-equal results; `right` of every slice-MM fixture note is unchanged from AC-11 (R92) and
// carries no `side`; every call is counted. Written from the ACs and the contract only (D-61); the stub ignores
// `layout` and returns no `side`, so every test fails on an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mindmapTree, parse, type MindmapTree } from '@tegg/doc';
import { layoutMindmap, layoutCount, textMeasurer, type MindLayout } from '../ui/src/mindmap/layout.ts';

const REPO = resolve(import.meta.dirname, '../..');
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
const blocks = (text: string) => parse(text).blocks.map((b) => b.raw);
function tree(raw: string, title: string): MindmapTree {
  const t = mindmapTree(raw, title);
  assert.ok(t, `mindmapTree of ${JSON.stringify(raw.split('\n')[0])} (mm-mindmap §1.2)`);
  return t!;
}
const PAVOUK = () => tree(blocks(fx('Pages/Pavouk.md'))[0], 'Pavouk');
const STROM = () => tree(blocks(fx('Pages/Rozložení.md'))[0], 'Rozložení');
const box = (l: MindLayout, id: string) => {
  const n = l.nodes.find((x) => x.id === id);
  return n ? [n.x, n.y, n.w, n.h] : null;
};
const conn = (l: MindLayout, from: string, to: string) => l.connectors.find((c) => c.from === from && c.to === to)?.points ?? null;
const sideOf = (l: MindLayout, id: string) => (l.nodes.find((x) => x.id === id) as { side?: string } | undefined)?.side ?? null;
const toneOf = (l: MindLayout, id: string) => l.nodes.find((x) => x.id === id)?.tone ?? null;

/** R96: Pavouk in `spider`, boxes as (x, y, width, height) with side and tone. */
const PAVOUK_SPIDER: [string, string, number[], string | null, string][] = [
  ['0', 'Střed', [216, 40, 55, 32], null, 'root'],
  ['0.0', 'Alfa', [331, 20, 48, 32], 'right', 'blue'],
  ['0.0.0', 'A1', [439, 0, 48, 32], 'right', 'plain'],
  ['0.0.1', 'A2', [439, 40, 48, 32], 'right', 'plain'],
  ['0.1', 'Beta', [108, 20, 48, 32], 'left', 'orange'],
  ['0.1.0', 'B1', [0, 20, 48, 32], 'left', 'plain'],
  ['0.2', 'Gama', [331, 80, 48, 32], 'right', 'purple'],
  ['0.3', 'Delta', [108, 60, 48, 32], 'left', 'teal'],
];

test('fr_mmp_02_ac27_pavouk_spider_golden_boxes_sides_tones_and_connectors', () => {
  const l = layoutMindmap(PAVOUK(), textMeasurer, { layout: 'spider' });
  assert.equal(l.layout, 'spider', 'the layout names itself');
  assert.deepEqual(l.nodes.map((n) => n.id), PAVOUK_SPIDER.map((w) => w[0]), 'nodes in outline order, root first');
  const bad: string[] = [];
  for (const [id, text, b, side, tone] of PAVOUK_SPIDER) {
    if (JSON.stringify(box(l, id)) !== JSON.stringify(b)) bad.push(`${text}: box ${JSON.stringify(box(l, id))} ≠ ${JSON.stringify(b)}`);
    if (sideOf(l, id) !== side) bad.push(`${text}: side ${sideOf(l, id)} ≠ ${side}`);
    if (toneOf(l, id) !== tone) bad.push(`${text}: tone ${toneOf(l, id)} ≠ ${tone}`);
    if (JSON.stringify(l.nodes.find((n) => n.id === id)?.lines) !== JSON.stringify([text])) bad.push(`${text}: lines`);
  }
  assert.deepEqual(bad, [], 'R96 golden values for Pavouk (spider)');
  assert.deepEqual([l.width, l.height], [487, 112], 'layout 487 × 112');
  assert.deepEqual(conn(l, '0', '0.0'), [[271, 56], [301, 56], [301, 36], [331, 36]], 'Střed → Alfa (right, as R92)');
  assert.deepEqual(conn(l, '0', '0.2')?.at(-1), [331, 96], 'Střed → Gama ends at Gama\'s left edge centre');
  assert.deepEqual(conn(l, '0.0', '0.0.0'), [[379, 36], [409, 36], [409, 16], [439, 16]], 'Alfa → A1');
  assert.deepEqual(conn(l, '0', '0.1'), [[216, 56], [186, 56], [186, 36], [156, 36]], 'Střed → Beta leaves the root\'s left edge, ends at Beta\'s right edge');
  assert.deepEqual(conn(l, '0', '0.3')?.at(-1), [156, 76], 'Střed → Delta ends at Delta\'s right edge centre');
  assert.deepEqual(conn(l, '0.1', '0.1.0'), [[108, 36], [78, 36], [78, 36], [48, 36]], 'Beta → B1: four points even with a zero-length vertical segment');
  assert.equal(l.connectors.length, 7, 'one connector per child');
});

test('fr_mmp_02_ac27_pavouk_right_golden_boxes', () => {
  const l = layoutMindmap(PAVOUK(), textMeasurer, { layout: 'right' });
  assert.equal(l.layout, 'right');
  const want: [string, string, number[]][] = [
    ['0', 'Střed', [0, 90, 55, 32]], ['0.0', 'Alfa', [115, 20, 48, 32]], ['0.0.0', 'A1', [223, 0, 48, 32]], ['0.0.1', 'A2', [223, 40, 48, 32]],
    ['0.1', 'Beta', [115, 80, 48, 32]], ['0.1.0', 'B1', [223, 80, 48, 32]], ['0.2', 'Gama', [115, 120, 48, 32]], ['0.3', 'Delta', [115, 160, 48, 32]],
  ];
  const bad: string[] = [];
  for (const [id, text, b] of want) {
    if (JSON.stringify(box(l, id)) !== JSON.stringify(b)) bad.push(`${text}: ${JSON.stringify(box(l, id))} ≠ ${JSON.stringify(b)}`);
    if (sideOf(l, id) !== null) bad.push(`${text}: side ${sideOf(l, id)} in right`);
  }
  assert.deepEqual(bad, [], 'R96: Pavouk laid out as right (the switch)');
  assert.deepEqual([l.width, l.height], [271, 192], 'layout 271 × 192');
  assert.deepEqual(l.nodes.map((n) => n.tone), ['root', 'blue', 'plain', 'plain', 'orange', 'plain', 'purple', 'teal'], 'tones by position, as in spider');
});

test('fr_mmp_02_ac27_strom_spider_golden_boxes', () => {
  const l = layoutMindmap(STROM(), textMeasurer, { layout: 'spider' });
  assert.equal(l.layout, 'spider');
  const want: [string, string, number[], string | null][] = [
    ['0', 'Kořen', [216, 40, 55, 32], null], ['0.0', 'Alfa', [331, 20, 48, 32], 'right'], ['0.0.0', 'A1', [439, 0, 48, 32], 'right'], ['0.0.1', 'A2', [439, 40, 48, 32], 'right'],
    ['0.1', 'Beta', [108, 40, 48, 32], 'left'], ['0.1.0', 'B1', [0, 40, 48, 32], 'left'], ['0.2', 'Gama', [331, 80, 48, 32], 'right'],
  ];
  const bad: string[] = [];
  for (const [id, text, b, side] of want) {
    if (JSON.stringify(box(l, id)) !== JSON.stringify(b)) bad.push(`${text}: ${JSON.stringify(box(l, id))} ≠ ${JSON.stringify(b)}`);
    if (sideOf(l, id) !== side) bad.push(`${text}: side ${sideOf(l, id)} ≠ ${side}`);
  }
  assert.deepEqual(bad, [], 'R96: Strom as spider (left height 32 shifted down by 40)');
  assert.deepEqual([l.width, l.height], [487, 112], 'layout 487 × 112');
  assert.deepEqual(conn(l, '0', '0.1'), [[216, 56], [186, 56], [186, 56], [156, 56]], 'Kořen → Beta');
  assert.deepEqual(conn(l, '0', '0.0'), [[271, 56], [301, 56], [301, 36], [331, 36]], 'Kořen → Alfa');
});

test('fr_mmp_02_ac27_layout_defaults_to_the_tree_and_is_deterministic', () => {
  const p = PAVOUK();
  assert.equal(p.layout, 'spider', 'Pavouk\'s stored layout');
  const a = layoutMindmap(p, textMeasurer);
  assert.equal(a.layout, 'spider', 'opts.layout defaults to tree.layout');
  assert.deepEqual(a, layoutMindmap(p, textMeasurer, { layout: 'spider' }), 'the same as an explicit spider');
  assert.deepEqual(layoutMindmap(PAVOUK(), textMeasurer, { layout: 'spider' }), a, 'the same tree twice: deep-equal');
  const s = STROM();
  assert.deepEqual(layoutMindmap(s, textMeasurer, { layout: 'spider' }), layoutMindmap(s, textMeasurer, { layout: 'spider' }), 'Strom spider twice');
  const n0 = layoutCount();
  layoutMindmap(p, textMeasurer, { layout: 'spider' });
  assert.equal(layoutCount(), n0 + 1, 'every call is counted');
  const nz = tree(blocks(fx('Pages/Neznámé metadata.md'))[0], 'Neznámé metadata');
  assert.equal(layoutMindmap(nz, textMeasurer).layout, 'right', 'unknown metadata: right');
  const m2 = tree(blocks(fx('Pages/Metadata.md'))[1], 'Metadata');
  const ml = layoutMindmap(m2, textMeasurer);
  assert.equal(ml.layout, 'spider', 'Metadata (2): spider');
  assert.deepEqual(ml.nodes.map((n) => [n.id, sideOf(ml, n.id)]), [['root', null], ['0', 'right'], ['1', 'left'], ['2', 'right']], 'a synthesized root: the top-level items alternate right, left, right');
});

test('fr_mmp_02_ac27_right_is_unchanged_for_the_slice_mm_notes', () => {
  const notes: [string, string][] = [
    ['Pages/Rozložení.md', 'Rozložení'], ['Pages/Výjezd 2026.md', 'Výjezd 2026'], ['Pages/Uzly.md', 'Uzly'], ['Pages/Nákup.md', 'Nákup'], ['Pages/Postup.md', 'Postup'],
    ['Pages/Více kořenů.md', 'Více kořenů'], ['Pages/Bez titulku.md', 'Bez titulku'], ['Pages/Složené.md', 'Složené'], ['Pages/Z Obsidianu.md', 'Z Obsidianu'],
  ];
  const bad: string[] = [];
  for (const [path, title] of notes) {
    for (const [k, raw] of blocks(fx(path)).entries()) {
      const t = mindmapTree(raw, title);
      if (!t) continue;
      const l = layoutMindmap(t, textMeasurer);
      if (l.layout !== 'right') bad.push(`${path} block ${k + 1}: layout ${l.layout}`);
      if (l.nodes.some((n) => 'side' in n && (n as { side?: string }).side !== undefined)) bad.push(`${path} block ${k + 1}: a side in right`);
      if (JSON.stringify(layoutMindmap(t, textMeasurer, { layout: 'right' })) !== JSON.stringify(l)) bad.push(`${path} block ${k + 1}: explicit right differs`);
    }
  }
  assert.deepEqual(bad, [], 'every slice-MM mindmap is right without sides');
  // R92's golden Strom (AC-11) still holds through the new option.
  const l = layoutMindmap(STROM(), textMeasurer, { layout: 'right' });
  assert.deepEqual(['0', '0.0', '0.0.0', '0.0.1', '0.1', '0.1.0', '0.2'].map((id) => box(l, id)), [[0, 70, 55, 32], [115, 20, 48, 32], [223, 0, 48, 32], [223, 40, 48, 32], [115, 80, 48, 32], [223, 80, 48, 32], [115, 120, 48, 32]], 'Strom right (R92)');
  assert.deepEqual([l.width, l.height], [271, 152]);
});
