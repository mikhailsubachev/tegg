// Slice MM, L1: the map's layout (docs/acceptance/mindmap.md R92; contract docs/contracts/mm-mindmap.md §2).
// FR-MMP-02 AC-11 (R92's golden boxes, lines and connector points for Strom and Zalomení with the Measurer; the same
// result twice, in another time zone and after a load–save round trip; outline order with the root first; nothing
// but a pure value), FR-MMP-02 AC-12 (tones by position: Paleta, Výjezd, Více kořenů), FR-MMP-02 AC-9 (node text for
// wrapping: chips, ` …`, hard breaks; the 200 px node of (f), D-774). `layoutMindmap` exists as a stub returning an
// empty layout, so every test fails on an assertion (TS-I1). Written from the ACs and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mindmapTree, parse, serialize, type MindmapTree } from '@tegg/doc';
import { layoutMindmap, layoutCount, PALETTE, textMeasurer, type MindLayout } from '../ui/src/mindmap/layout.ts';

const REPO = resolve(import.meta.dirname, '../..');
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
const blocks = (text: string) => parse(text).blocks.map((b) => b.raw);
function tree(raw: string, title: string): MindmapTree {
  const t = mindmapTree(raw, title);
  assert.ok(t, `mindmapTree of ${JSON.stringify(raw.split('\n')[0])} (mm-mindmap §1.2)`);
  return t!;
}
const ROZ = () => blocks(fx('Pages/Rozložení.md'));
const box = (l: MindLayout, id: string) => {
  const n = l.nodes.find((x) => x.id === id);
  return n ? [n.x, n.y, n.w, n.h] : null;
};
const conn = (l: MindLayout, from: string, to: string) => l.connectors.find((c) => c.from === from && c.to === to)?.points ?? null;

test('fr_mmp_02_ac11_strom_golden_boxes_and_connectors', () => {
  const l = layoutMindmap(tree(ROZ()[0], 'Rozložení'), textMeasurer);
  const want: [string, string, number[]][] = [
    ['0', 'Kořen', [0, 70, 55, 32]], ['0.0', 'Alfa', [115, 20, 48, 32]], ['0.0.0', 'A1', [223, 0, 48, 32]], ['0.0.1', 'A2', [223, 40, 48, 32]],
    ['0.1', 'Beta', [115, 80, 48, 32]], ['0.1.0', 'B1', [223, 80, 48, 32]], ['0.2', 'Gama', [115, 120, 48, 32]],
  ];
  assert.deepEqual(l.nodes.map((n) => n.id), want.map((w) => w[0]), 'nodes in outline order, root first, ids = item paths');
  for (const [id, text, b] of want) {
    assert.deepEqual(box(l, id), b, `${text} (x, y, width, height)`);
    assert.deepEqual(l.nodes.find((n) => n.id === id)?.lines, [text], `${text}: one line`);
  }
  assert.deepEqual(l.nodes.map((n) => n.depth), [0, 1, 2, 2, 1, 2, 1], 'depths');
  assert.deepEqual([l.width, l.height], [271, 152], 'layout 271 × 152');
  assert.deepEqual(conn(l, '0', '0.0'), [[55, 86], [85, 86], [85, 36], [115, 36]], 'Kořen → Alfa');
  assert.deepEqual(conn(l, '0', '0.2')?.at(-1), [115, 136], 'Kořen → Gama ends at Gama\'s left edge centre');
  assert.deepEqual(conn(l, '0.0', '0.0.0'), [[163, 36], [193, 36], [193, 16], [223, 16]], 'Alfa → A1');
  assert.equal(l.connectors.length, 6, 'one connector per child');
});

test('fr_mmp_02_ac11_zalomeni_wraps_within_180_px_in_a_200_px_node', () => {
  const l = layoutMindmap(tree(ROZ()[1], 'Rozložení'), textMeasurer);
  assert.deepEqual(box(l, '0'), [0, 18, 62, 32], 'Krátký');
  assert.deepEqual(box(l, '0.0'), [122, 0, 200, 68], 'the long node: 200 px wide, 14 + 18 × 3 high');
  assert.deepEqual(l.nodes.find((n) => n.id === '0.0')?.lines, ['Velmi dlouhý text uzlu,', 'který se musí zalomit do', 'více řádků'], 'greedy wrap at word boundaries, nothing cut');
  assert.deepEqual([l.width, l.height], [322, 68], 'layout 322 × 68');
});

test('fr_mmp_02_ac11_a_word_wider_than_180_px_breaks_between_characters', () => {
  const word = 'Nejnepravděpodobnějšími'.repeat(2); // 46 characters = 322 px
  const l = layoutMindmap(tree(`> [!mindmap]\n> - ${word}`, 'X'), textMeasurer);
  const n = l.nodes[0];
  assert.ok(n, 'one node');
  assert.equal(n.w, 200, 'a long text: 200 px');
  assert.ok(n.lines.length >= 2 && n.lines.every((x) => textMeasurer(x) <= 180), `lines within 180 px: ${JSON.stringify(n.lines)}`);
  assert.equal(n.lines.join(''), word, 'nothing lost');
  assert.equal(n.h, 14 + 18 * n.lines.length, 'height = 14 + 18 × lines');
});

test('fr_mmp_02_ac11_identical_twice_in_another_zone_and_after_a_round_trip', () => {
  const text = fx('Pages/Rozložení.md');
  const zone = process.env.TZ;
  try {
    const raws = blocks(text);
    const a = raws.map((r) => layoutMindmap(tree(r, 'Rozložení'), textMeasurer));
    assert.ok(a.every((x) => x.nodes.length > 0), 'layouts with nodes');
    const b = raws.map((r) => layoutMindmap(tree(r, 'Rozložení'), textMeasurer));
    assert.deepEqual(b, a, 'the same list twice');
    process.env.TZ = 'America/Los_Angeles';
    const c = raws.map((r) => layoutMindmap(tree(r, 'Rozložení'), textMeasurer));
    assert.deepEqual(c, a, 'another time zone');
    const d = blocks(serialize(parse(text))).map((r) => layoutMindmap(tree(r, 'Rozložení'), textMeasurer));
    assert.deepEqual(d, a, 'after a load–save round trip');
    const n0 = layoutCount();
    layoutMindmap(tree(raws[0], 'Rozložení'), textMeasurer);
    assert.equal(layoutCount(), n0 + 1, 'every call is counted (layoutCount, §2)');
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('fr_mmp_02_ac12_tones_by_position', () => {
  assert.deepEqual([...PALETTE], ['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red'], 'R92 palette order');
  const p = layoutMindmap(tree(ROZ()[2], 'Rozložení'), textMeasurer);
  assert.deepEqual(p.nodes.map((n) => [n.lines.join(' '), n.tone]), [
    ['Barvy', 'root'], ['Jedna', 'blue'], ['Dvě', 'orange'], ['Tři', 'purple'], ['Čtyři', 'teal'], ['Pět', 'green'], ['Šest', 'yellow'], ['Sedm', 'red'], ['Osm', 'blue'],
  ], 'Paleta: palette[i mod 7]');
  const v = layoutMindmap(tree(blocks(fx('Pages/Výjezd 2026.md'))[1], 'Výjezd 2026'), textMeasurer);
  assert.deepEqual(v.nodes.map((n) => [n.lines.join(' '), n.tone]), [
    ['Výjezd 2026', 'root'], ['Program', 'blue'], ['Přehled Q4', 'plain'], ['Plán 2027', 'plain'], ['Místo', 'orange'], ['Lisabon', 'plain'], ['Doprava', 'purple'],
  ], 'Výjezd: first-level nodes coloured, deeper neutral');
  const vk = layoutMindmap(tree(blocks(fx('Pages/Více kořenů.md'))[0], 'Více kořenů'), textMeasurer);
  assert.deepEqual(vk.nodes.map((n) => [n.id, n.lines.join(' '), n.tone]), [
    ['root', 'Témata', 'root'], ['0', 'Rodina', 'blue'], ['1', 'Práce', 'orange'], ['1.0', 'Porady', 'plain'], ['2', 'Zdraví', 'purple'],
  ], 'Více kořenů: the synthesized root (id root) and the top-level items as first level');
});

test('fr_mmp_02_ac9_node_text_chips_more_and_breaks', () => {
  const u = layoutMindmap(tree(blocks(fx('Pages/Uzly.md'))[0], 'Uzly'), textMeasurer);
  const lines = (id: string) => u.nodes.find((n) => n.id === id)?.lines ?? null;
  assert.equal(u.nodes.length, 12, 'Uzly: 12 nodes');
  assert.deepEqual(lines('0.1'), ['Odkaz na Lisabon a', '#cestování'], 'link chip as its title, tag chip `#value` (one word each)');
  assert.deepEqual(lines('0.4'), ['Fotka fotka.png'], 'a file chip: the file name');
  assert.deepEqual(lines('0.5'), ['Velmi dlouhý text uzlu,', 'který se musí zalomit do', 'více řádků'], '(f) the long text on 3 lines');
  assert.equal(u.nodes.find((n) => n.id === '0.5')?.w, 200, '(f) in a 200 px node');
  assert.deepEqual(lines('0.6'), ['Odstavec navíc …'], '(g) ` …`');
  assert.deepEqual(lines('0.7'), ['Položka s kódem …'], '(h) ` …`');
  assert.deepEqual(lines('0.8'), ['Položka s citací …'], '(i) ` …`');
  assert.deepEqual(lines('0.10'), ['Řádek jedna', 'řádek dva'], '(k) a hard break is a new line, no `…`');
  const e = layoutMindmap(tree('> [!mindmap]\n> -\n>   - dítě', 'X'), textMeasurer);
  assert.deepEqual(e.nodes[0] && [e.nodes[0].w, e.nodes[0].h], [48, 32], 'an empty node is 48 px (D-774)');
  const chip = layoutMindmap(tree('> [!mindmap]\n> - Cíl: [[Složka/Lisabon.md]] a [[Lisabon|hlavní město]]', 'X'), textMeasurer);
  // 27 scalar values (189 px) wrap within 180 px (R92); the alias chip `hlavní město` stays one unbreakable word.
  assert.deepEqual(chip.nodes[0]?.lines, ['Cíl: Lisabon a', 'hlavní město'], 'a link chip: the alias, else the last path segment without .md');
  const extra = layoutMindmap(tree('> [!mindmap]\n> - [[Lisabon]]', 'X'), textMeasurer, { chipExtra: 30 });
  assert.equal(extra.nodes[0]?.w, 7 * 7 + 30 + 20, 'chipExtra widens a chip word');
});
