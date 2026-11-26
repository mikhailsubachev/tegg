// Slice MM3 follow-up, L1: the fold control on the node's edge, the `+` past it, and spider ↑ / ↓ on one side
// (docs/acceptance/mindmap.md part four, R234, R235; contract docs/contracts/mm-mindmap.md §7.7; D-2672…D-2676, bug #170).
// FR-MMP-02 AC-56 (R234's golden values with the Measurer: fold controls on the outer edge, `+` 24 px past it on nodes
// with children, layout sizes that contain every control and every such `+`; a control left of 0 shifts the drawing)
// and AC-58 (the navigation function: in `spider`, ↑ / ↓ consider only nodes on the focused node's side). Modules load
// dynamically (TS-I1), so a missing export fails an assertion. Written from the ACs and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mindmapTree, parse, type MindmapTree } from '@tegg/doc';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
const REPO = resolve(import.meta.dirname, '../..');
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
function mapOf(rel: string, title: string, k = 0): MindmapTree {
  const raws = parse(fx(rel)).blocks.map((b) => b.raw).filter((r) => mindmapTree(r, title) !== null);
  assert.ok(raws[k], `setup: ${rel} holds mindmap block ${k + 1}`);
  return mindmapTree(raws[k], title)!;
}
const STROM = () => mapOf('Pages/Rozložení.md', 'Rozložení');
const PAVOUK = () => mapOf('Pages/Pavouk.md', 'Pavouk');
const VYJEZD = () => mapOf('Pages/Výjezd 2026.md', 'Výjezd 2026');

type Node = { id: string; depth: number; x: number; y: number; w: number; h: number; lines: string[]; side?: string; fold?: { x: number; y: number; folded: boolean; hidden: number }; plus?: { x: number; y: number } };
type Layout = { width: number; height: number; nodes: Node[]; connectors: { from: string; to: string }[] };

async function layoutMod(): Promise<Mod> {
  const m = await load('../ui/src/mindmap/layout.ts');
  assert.ok(m && typeof m.layoutMindmap === 'function', 'layout.ts exports layoutMindmap');
  return m!;
}
async function lay(tree: MindmapTree, folded: string[] | null = null, layout?: 'right' | 'spider'): Promise<Layout> {
  const m = await layoutMod();
  const opts: Record<string, unknown> = {};
  if (folded) opts.folded = new Set(folded);
  if (layout) opts.layout = layout;
  return m.layoutMindmap(tree, m.textMeasurer, opts) as Layout;
}
const byName = (l: Layout, name: string) => l.nodes.find((n) => n.lines.join(' ') === name);
const boxOf = (l: Layout, name: string) => { const n = byName(l, name); return n ? [n.x, n.y, n.w, n.h] : null; };
const foldOf = (l: Layout, name: string) => { const f = byName(l, name)?.fold; return f ? [f.x, f.y, f.folded, f.hidden] : null; };
const plusOf = (l: Layout, name: string) => { const p = byName(l, name)?.plus; return p ? [p.x, p.y] : null; };
/** Compares named values and lists every difference (one assertion with the whole picture). */
function diff(label: string, got: (n: string) => unknown, want: [string, unknown][]): string[] {
  return want.filter(([n, w]) => JSON.stringify(got(n)) !== JSON.stringify(w)).map(([n, w]) => `${label} ${n}: ${JSON.stringify(got(n))} ≠ ${JSON.stringify(w)}`);
}

// ------------------------------------------------------------------------------------------------ AC-56

test('fr_mmp_02_ac56_strom_nothing_folded_controls_on_the_edge_and_plus_past_them', async () => {
  const l = await lay(STROM());
  const bad = [
    ...diff('box', (n) => boxOf(l, n), [['Kořen', [0, 70, 55, 32]], ['Alfa', [115, 20, 48, 32]], ['A1', [223, 0, 48, 32]], ['A2', [223, 40, 48, 32]], ['Beta', [115, 80, 48, 32]], ['B1', [223, 80, 48, 32]], ['Gama', [115, 120, 48, 32]]]),
    ...diff('fold', (n) => foldOf(l, n), [['Kořen', [55, 86, false, 6]], ['Alfa', [163, 36, false, 2]], ['Beta', [163, 96, false, 1]], ['A1', null], ['A2', null], ['B1', null], ['Gama', null]]),
    ...diff('plus', (n) => plusOf(l, n), [['Kořen', [79, 86]], ['Alfa', [187, 36]], ['Beta', [187, 96]], ['A1', [271, 16]], ['Gama', [163, 136]]]),
  ];
  if (l.width !== 271 || l.height !== 152) bad.push(`layout ${l.width} × ${l.height} ≠ 271 × 152`);
  assert.deepEqual(bad, [], 'R234, Strom with nothing folded: fold controls on the outer edge, `+` 24 px past it on nodes with children, on the edge of leaves; R92\'s boxes');
});

test('fr_mmp_02_ac56_strom_with_alfa_folded', async () => {
  const l = await lay(STROM(), ['0.0']);
  assert.deepEqual(l.nodes.map((n) => n.lines.join(' ')), ['Kořen', 'Alfa', 'Beta', 'B1', 'Gama'], 'Alfa folded: A1 and A2 are not laid out');
  const bad = [
    ...diff('box', (n) => boxOf(l, n), [['Kořen', [0, 40, 55, 32]], ['Alfa', [115, 0, 48, 32]], ['Beta', [115, 40, 48, 32]], ['B1', [223, 40, 48, 32]], ['Gama', [115, 80, 48, 32]]]),
    ...diff('fold', (n) => foldOf(l, n), [['Kořen', [55, 56, false, 6]], ['Alfa', [163, 16, true, 2]], ['Beta', [163, 56, false, 1]]]),
    ...diff('plus', (n) => plusOf(l, n), [['Alfa', [187, 16]]]),
  ];
  if (l.width !== 271 || l.height !== 112) bad.push(`layout ${l.width} × ${l.height} ≠ 271 × 112`);
  assert.deepEqual(bad, [], 'R234, Strom with Alfa folded: R230\'s boxes; Alfa\'s control on its right edge showing +2, its `+` 24 px past it');
});

test('fr_mmp_02_ac56_strom_with_koren_folded', async () => {
  const l = await lay(STROM(), ['0']);
  assert.deepEqual(l.nodes.map((n) => n.id), ['0'], 'Kořen folded: only the root is laid out');
  assert.deepEqual({ box: boxOf(l, 'Kořen'), fold: foldOf(l, 'Kořen'), plus: plusOf(l, 'Kořen'), size: [l.width, l.height], connectors: l.connectors.length },
    { box: [0, 0, 55, 32], fold: [55, 16, true, 6], plus: [79, 16], size: [87, 32], connectors: 0 },
    'R234: Kořen (0, 0, 55, 32), its control (55, 16) showing +6, its `+` (79, 16); layout 87 × 32 (the `+` 79 + 8, D-2676); no connector stub (D-2672)');
});

test('fr_mmp_02_ac56_pavouk_spider_with_alfa_folded', async () => {
  const l = await lay(PAVOUK(), ['0.0'], 'spider');
  const bad = [
    ...diff('box', (n) => boxOf(l, n), [['Střed', [223, 20, 55, 32]], ['Alfa', [338, 0, 48, 32]], ['Gama', [338, 40, 48, 32]], ['Beta', [115, 0, 48, 32]], ['B1', [0, 0, 48, 32]], ['Delta', [108, 40, 55, 32]]]),
    ...diff('fold', (n) => foldOf(l, n), [['Alfa', [386, 16, true, 2]], ['Beta', [115, 16, false, 1]], ['Střed', [278, 36, false, 7]]]),
    ...diff('plus', (n) => plusOf(l, n), [['Alfa', [410, 16]], ['Beta', [91, 16]], ['Střed', [302, 36]]]),
  ];
  if (l.width !== 418 || l.height !== 72) bad.push(`layout ${l.width} × ${l.height} ≠ 418 × 72`);
  assert.equal(l.nodes.some((n) => n.lines.join(' ') === 'A1' || n.lines.join(' ') === 'A2'), false, 'A1 and A2 are not laid out');
  assert.deepEqual(bad, [], 'R234, Pavouk with Alfa folded: Beta\'s control on its left edge and its `+` 24 px left of it; Střed\'s on its right edge (AP-2114); layout 418 × 72 (Alfa\'s `+` 410 + 8)');
});

test('fr_mmp_02_ac56_the_layout_contains_every_control_and_a_control_left_of_zero_shifts_the_drawing', async () => {
  // R234 "Layout" (D-2676): the extent covers every fold control and the `+` of every node with children (centre ± 8);
  // a control or `+` left of 0 shifts the whole drawing right. Pavouk with Beta folded puts Beta (a node with
  // children) in the outermost left column, so its `+` (24 px left of its left edge) would lie left of 0.
  const bad: string[] = [];
  const cases: [string, Layout][] = [
    ['Strom', await lay(STROM())], ['Strom, Alfa folded', await lay(STROM(), ['0.0'])], ['Strom, Kořen folded', await lay(STROM(), ['0'])],
    ['Pavouk', await lay(PAVOUK(), null, 'spider')], ['Pavouk, Alfa folded', await lay(PAVOUK(), ['0.0'], 'spider')],
    ['Pavouk, Beta folded', await lay(PAVOUK(), ['0.1'], 'spider')], ['Pavouk, Střed folded', await lay(PAVOUK(), ['0'], 'spider')],
  ];
  for (const [what, l] of cases) {
    for (const n of l.nodes) {
      if (!n.fold) continue;
      const name = n.lines.join(' ');
      if (!n.plus) { bad.push(`${what}: ${name} has no \`+\``); continue; }
      for (const [k, p] of [['fold', n.fold], ['plus', n.plus]] as const) {
        if (p.x - 8 < 0 || p.x + 8 > l.width || p.y - 8 < 0 || p.y + 8 > l.height) bad.push(`${what}: ${name}'s ${k} (${p.x}, ${p.y}) ± 8 is outside ${l.width} × ${l.height}`);
      }
    }
  }
  const b = cases[5][1];
  const left = Math.min(...b.nodes.map((n) => n.x), ...b.nodes.filter((n) => n.fold).flatMap((n) => [n.fold!.x - 8, (n.plus?.x ?? 0) - 8]));
  if (left !== 0) bad.push(`Pavouk, Beta folded: the drawing's left extent is ${left}, not 0 (shifted right just enough)`);
  const x = (name: string) => byName(b, name)?.x ?? NaN;
  if (x('Beta') - x('Delta') !== 7 || x('Střed') - x('Delta') !== 115) bad.push(`Pavouk, Beta folded: the shift moves every node alike (Beta − Delta ${x('Beta') - x('Delta')}, want 7; Střed − Delta ${x('Střed') - x('Delta')}, want 115)`);
  const beta = byName(b, 'Beta');
  if (!beta?.fold || beta.fold.x !== beta.x || !beta.plus || beta.plus.x !== beta.x - 24) bad.push(`Pavouk, Beta folded: Beta (x ${beta?.x}) fold ${JSON.stringify(beta?.fold)}, plus ${JSON.stringify(beta?.plus)}: want the control on its left edge, the \`+\` 24 px left of it`);
  assert.deepEqual(bad, [], 'every fold control and every `+` of a node with children lies inside the layout (D-2676)');
});

// ------------------------------------------------------------------------------------------------ AC-58 (the navigation function)

type Nav = (layout: Layout, from: string, key: string) => { focus?: string; unfold?: string } | null;
async function navMod(): Promise<Nav> {
  const m = await load('../ui/src/mindmap/nav.ts');
  assert.ok(m && typeof m.navigateMindmap === 'function', 'app/ui/src/mindmap/nav.ts exports navigateMindmap (mm-mindmap §7.2)');
  return m!.navigateMindmap as Nav;
}
/** Presses `keys` from `start` (node texts) and returns the focused node text after each, or `—` when nothing happens. */
async function walk(l: Layout, start: string, keys: string[]): Promise<string[]> {
  const nav = await navMod();
  const names = new Map(l.nodes.map((n) => [n.id, n.lines.join(' ')]));
  let at = byName(l, start)?.id;
  assert.ok(at, `setup: node ${start}`);
  const out: string[] = [];
  for (const k of keys) {
    const r = nav(l, at!, k);
    if (r && r.focus) { at = r.focus; out.push(names.get(r.focus) ?? `?${r.focus}`); } else out.push(r && r.unfold ? `unfold ${names.get(r.unfold)}` : '—');
  }
  return out;
}

test('fr_mmp_02_ac58_up_and_down_stay_on_one_side_of_pavouk_and_right_is_unchanged', async () => {
  const p = await lay(PAVOUK(), null, 'spider');
  const v = await lay(VYJEZD());
  // Pavouk laid out as `right`: no sides, so R229's rows (outline order) stand.
  const pr = await lay(PAVOUK(), null, 'right');
  assert.deepEqual({
    '↓ from Alfa': await walk(p, 'Alfa', ['ArrowDown', 'ArrowDown']),
    '↑ from Gama': await walk(p, 'Gama', ['ArrowUp', 'ArrowUp']),
    '↓ from Beta': await walk(p, 'Beta', ['ArrowDown', 'ArrowDown']),
    '↑ from Delta': await walk(p, 'Delta', ['ArrowUp', 'ArrowUp']),
    '↓ from A1': await walk(p, 'A1', ['ArrowDown', 'ArrowDown']),
    '↑ ↓ on B1': await walk(p, 'B1', ['ArrowUp', 'ArrowDown']),
    '↑ ↓ on Střed': await walk(p, 'Střed', ['ArrowUp', 'ArrowDown']),
    'Výjezd: ↓ from Program': await walk(v, 'Program', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    'Výjezd: ↓ from Přehled Q4': await walk(v, 'Přehled Q4', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    'Výjezd: ↑ from Lisabon': await walk(v, 'Lisabon', ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    'Pavouk as right: ↓ from Alfa': await walk(pr, 'Alfa', ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']),
  }, {
    '↓ from Alfa': ['Gama', '—'],
    '↑ from Gama': ['Alfa', '—'],
    '↓ from Beta': ['Delta', '—'],
    '↑ from Delta': ['Beta', '—'],
    '↓ from A1': ['A2', '—'],
    '↑ ↓ on B1': ['—', '—'],
    '↑ ↓ on Střed': ['—', '—'],
    'Výjezd: ↓ from Program': ['Místo', 'Doprava', '—'],
    'Výjezd: ↓ from Přehled Q4': ['Plán 2027', 'Lisabon', '—'],
    'Výjezd: ↑ from Lisabon': ['Plán 2027', 'Přehled Q4', '—'],
    'Pavouk as right: ↓ from Alfa': ['Beta', 'Gama', 'Delta', '—'],
  }, 'R235 (D-2674): in `spider` siblings on the same side, then the same depth on the same side; nothing at the ends or on the root. In `right` AC-54\'s walks are unchanged');
});
