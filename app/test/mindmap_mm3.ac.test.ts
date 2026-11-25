// Slice MM3, L1: folds in the layout, the map's navigation function, and the MM3 strings and commands
// (docs/acceptance/mindmap.md part three, R229, R230, R233; contract docs/contracts/mm-mindmap.md §7.1, §7.2, §7.5).
// FR-MMP-02 AC-43 (R230's golden values with the Measurer: fold controls, `+` points, folded maps laid out without the
// hidden nodes, the layout equal again after unfolding), AC-37 and AC-38 (the navigation function: ↑ / ↓ among siblings,
// then the nearest visible node of the same depth in outline order; nothing on a root; Home / End; hidden nodes never
// reached), NFR-OTH-02 AC-29 (R233's catalog keys, the plural message, the pseudo-locale, a Czech test catalog), and the
// registry side of FR-UX-03 AC-62 (the two commands). Modules load dynamically (TS-I1): the layout ignores `folded` and
// has no `fold` / `plus`, and `nav.ts` doesn't exist yet, so every test fails on an assertion. Written from the ACs and
// the contract only (D-61).
import { beforeEach, test } from 'vitest';
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
const VICE = () => mapOf('Pages/Více kořenů.md', 'Více kořenů');
const BRATRANCI = () => mapOf('Pages/Bratranci.md', 'Bratranci');

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

// ------------------------------------------------------------------------------------------------ AC-43

test('fr_mmp_02_ac43_strom_unfolded_fold_controls_and_plus_points', async () => {
  const l = await lay(STROM());
  assert.deepEqual([l.width, l.height], [271, 152], 'the R92 layout is unchanged without folds');
  const bad: string[] = [];
  const folds: [string, unknown][] = [['Kořen', [85, 86, false, 6]], ['Alfa', [193, 36, false, 2]], ['Beta', [193, 96, false, 1]], ['A1', null], ['A2', null], ['B1', null], ['Gama', null]];
  for (const [n, want] of folds) if (JSON.stringify(foldOf(l, n)) !== JSON.stringify(want)) bad.push(`${n}: fold ${JSON.stringify(foldOf(l, n))} ≠ ${JSON.stringify(want)}`);
  const plus: [string, number[]][] = [['Kořen', [55, 86]], ['Alfa', [163, 36]], ['A1', [271, 16]], ['Gama', [163, 136]]];
  for (const [n, want] of plus) if (JSON.stringify(plusOf(l, n)) !== JSON.stringify(want)) bad.push(`${n}: plus ${JSON.stringify(plusOf(l, n))} ≠ ${JSON.stringify(want)}`);
  assert.deepEqual(bad, [], 'R230 golden values, Strom with nothing folded: fold controls on the elbow points (only nodes with children), `+` on the outer edges');
});

test('fr_mmp_02_ac43_strom_with_alfa_folded_and_with_koren_folded', async () => {
  const a = await lay(STROM(), ['0.0']);
  assert.deepEqual(a.nodes.map((n) => n.lines.join(' ')), ['Kořen', 'Alfa', 'Beta', 'B1', 'Gama'], 'Alfa folded: A1 and A2 are not laid out');
  const want: [string, number[]][] = [['Kořen', [0, 40, 55, 32]], ['Alfa', [115, 0, 48, 32]], ['Beta', [115, 40, 48, 32]], ['B1', [223, 40, 48, 32]], ['Gama', [115, 80, 48, 32]]];
  assert.deepEqual(want.map(([n]) => boxOf(a, n)), want.map(([, b]) => b), 'R230 boxes with Alfa folded (Alfa laid out as a leaf)');
  assert.deepEqual([a.width, a.height], [271, 112], 'layout 271 × 112');
  assert.deepEqual([foldOf(a, 'Kořen'), foldOf(a, 'Alfa'), foldOf(a, 'Beta')], [[85, 56, false, 6], [193, 16, true, 2], [193, 56, false, 1]], 'fold controls; Alfa folded with 2 hidden');
  assert.ok(!a.connectors.some((c) => c.from === '0.0'), 'no connector to a hidden node');
  const k = await lay(STROM(), ['0']);
  assert.deepEqual(k.nodes.map((n) => n.id), ['0'], 'Kořen folded: only the root is laid out');
  assert.deepEqual(boxOf(k, 'Kořen'), [0, 0, 55, 32], 'Kořen (0, 0, 55, 32)');
  assert.deepEqual(foldOf(k, 'Kořen'), [85, 16, true, 6], 'its control at (85, 16) showing +6');
  assert.deepEqual([k.width, k.height], [93, 32], 'layout 93 × 32: the control (85) + 8 (AP-2117)');
  assert.equal(k.connectors.length, 0, 'no connectors');
});

test('fr_mmp_02_ac43_pavouk_spider_with_alfa_folded', async () => {
  const l = await lay(PAVOUK(), ['0.0'], 'spider');
  const want: [string, number[], string | null][] = [
    ['Střed', [223, 20, 55, 32], null], ['Alfa', [338, 0, 48, 32], 'right'], ['Gama', [338, 40, 48, 32], 'right'],
    ['Beta', [115, 0, 48, 32], 'left'], ['B1', [0, 0, 48, 32], 'left'], ['Delta', [108, 40, 55, 32], 'left'],
  ];
  assert.deepEqual(l.nodes.map((n) => n.lines.join(' ')).sort(), want.map((w) => w[0]).sort(), 'A1 and A2 are not laid out');
  assert.deepEqual(want.map(([n]) => boxOf(l, n)), want.map(([, b]) => b), 'R230 boxes for Pavouk with Alfa folded');
  assert.deepEqual(want.map(([n]) => byName(l, n)?.side ?? null), want.map(([, , s]) => s), 'sides kept');
  assert.deepEqual([foldOf(l, 'Alfa'), foldOf(l, 'Beta'), foldOf(l, 'Střed')], [[416, 16, true, 2], [78, 16, false, 1], [308, 36, false, 7]],
    'fold controls Alfa (416, 16) +2, Beta (78, 16), Střed on its right elbow (308, 36) (AP-2114)');
  // RT-6: R230 gives the width as 386, but AP-2117 (D-2618) makes the layout contain every control: 416 + 8 = 424.
  assert.deepEqual([l.width, l.height], [424, 72], 'layout 424 × 72 (the rightmost control 416 + 8, AP-2117; RT-6)');
  assert.deepEqual([plusOf(l, 'Beta'), plusOf(l, 'Střed'), plusOf(l, 'Alfa')], [[115, 16], [278, 36], [386, 16]], '`+` on the outer edge: Beta\'s left edge, the spider root\'s right edge, Alfa\'s right edge (AP-2118)');
});

test('fr_mmp_02_ac43_unfolding_gives_the_unfolded_layout_again', async () => {
  const m = await layoutMod();
  const s = STROM();
  const plain = m.layoutMindmap(s, m.textMeasurer) as Layout;
  assert.ok(plain.nodes.every((n) => n.plus), 'every node has its `+` point (mm-mindmap §7.1)');
  m.layoutMindmap(s, m.textMeasurer, { folded: new Set(['0.0', '0.1']) });
  assert.deepEqual(m.layoutMindmap(s, m.textMeasurer, { folded: new Set() }), plain, 'an empty fold set gives the unfolded layout (deep equality)');
  const folded = m.layoutMindmap(s, m.textMeasurer, { folded: new Set(['0.0']) }) as Layout;
  assert.notDeepEqual(folded, plain, 'a fold changes the layout');
  assert.deepEqual(m.layoutMindmap(s, m.textMeasurer, { folded: new Set(['9.9']) }), plain, 'unknown ids are ignored');
  const p = PAVOUK();
  assert.deepEqual(m.layoutMindmap(p, m.textMeasurer, { layout: 'spider', folded: new Set() }), m.layoutMindmap(p, m.textMeasurer, { layout: 'spider' }), 'Pavouk: the same');
});

// ------------------------------------------------------------------------------------------------ AC-37, AC-38 (the navigation function)

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

test('fr_mmp_02_ac54_navigation_function_on_vyjezd_pavouk_and_vice_korenu', async () => {
  const v = await lay(VYJEZD());
  const got: Record<string, string[]> = {
    '↓ from Program': await walk(v, 'Program', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Doprava': await walk(v, 'Doprava', ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    '↓ from Přehled Q4': await walk(v, 'Přehled Q4', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Lisabon': await walk(v, 'Lisabon', ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    '↑ ↓ on the root': await walk(v, 'Výjezd 2026', ['ArrowUp', 'ArrowDown']),
    'Home, End from Lisabon': await walk(v, 'Lisabon', ['Home', 'End']),
  };
  assert.deepEqual(got, {
    '↓ from Program': ['Místo', 'Doprava', '—'],
    '↑ from Doprava': ['Místo', 'Program', '—'],
    '↓ from Přehled Q4': ['Plán 2027', 'Lisabon', '—'],
    '↑ from Lisabon': ['Plán 2027', 'Přehled Q4', '—'],
    '↑ ↓ on the root': ['—', '—'],
    'Home, End from Lisabon': ['Výjezd 2026', 'Doprava'],
  }, 'Výjezd: siblings, then the cousin at the same depth (D-2600, AP-2111); nothing on the root (AP-2112)');
  const p = await lay(PAVOUK(), null, 'spider');
  assert.deepEqual({
    '↓ from A2': await walk(p, 'A2', ['ArrowDown']),
    '↑ from B1': await walk(p, 'B1', ['ArrowUp']),
    '↓ from Alfa': await walk(p, 'Alfa', ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']),
  }, {
    '↓ from A2': ['B1'],
    '↑ from B1': ['A2'],
    '↓ from Alfa': ['Beta', 'Gama', 'Delta', '—'],
  }, 'Pavouk: outline order whatever the side');
  const t = await lay(VICE());
  assert.deepEqual({
    '↓ from Rodina': await walk(t, 'Rodina', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↓ from Porady': await walk(t, 'Porady', ['ArrowDown']),
    '↑ ↓ on Témata': await walk(t, 'Témata', ['ArrowUp', 'ArrowDown']),
  }, {
    '↓ from Rodina': ['Práce', 'Zdraví', '—'],
    '↓ from Porady': ['—'],
    '↑ ↓ on Témata': ['—', '—'],
  }, 'Více kořenů: the top-level items are siblings; the synthesized root has none');
});

test('fr_mmp_02_ac38_cousins_across_a_childless_parent_and_across_grandparents', async () => {
  const b = await lay(BRATRANCI());
  assert.deepEqual({
    '↓ from A2': await walk(b, 'A2', ['ArrowDown']),
    '↑ from G1': await walk(b, 'G1', ['ArrowUp']),
    '↓ from A2a': await walk(b, 'A2a', ['ArrowDown']),
    '↑ from G1a': await walk(b, 'G1a', ['ArrowUp']),
    '↓ from G2': await walk(b, 'G2', ['ArrowDown']),
    '↑ from A1': await walk(b, 'A1', ['ArrowUp']),
    '↓ from Beta': await walk(b, 'Beta', ['ArrowDown']),
  }, {
    '↓ from A2': ['G1'],
    '↑ from G1': ['A2'],
    '↓ from A2a': ['G1a'],
    '↑ from G1a': ['A2a'],
    '↓ from G2': ['—'],
    '↑ from A1': ['—'],
    '↓ from Beta': ['Gama'],
  }, 'Bratranci: the nearest visible node of the same depth in outline order (AP-2111)');
  const gamaFolded = await lay(BRATRANCI(), ['0.2']);
  assert.deepEqual(await walk(gamaFolded, 'A2', ['ArrowDown']), ['—'], 'with Gama folded, ↓ from A2 does nothing (hidden nodes are never reached)');
});

test('fr_mmp_02_ac41_folded_nodes_unfold_by_the_key_towards_their_children', async () => {
  // R229 rows ← → (D-2605, AP-2113, AP-2114): the key towards the children of a folded node unfolds it.
  const v = await lay(VYJEZD(), ['0.0']);
  assert.deepEqual(await walk(v, 'Program', ['ArrowRight']), ['unfold Program'], 'right: → on folded Program unfolds it');
  const p = await lay(PAVOUK(), ['0.1'], 'spider');
  assert.deepEqual(await walk(p, 'Beta', ['ArrowRight']), ['Střed'], 'spider, folded Beta (left): → goes to the parent');
  assert.deepEqual(await walk(p, 'Beta', ['ArrowLeft']), ['unfold Beta'], '← unfolds it');
  const r = await lay(PAVOUK(), ['0'], 'spider');
  assert.deepEqual([await walk(r, 'Střed', ['ArrowLeft']), await walk(r, 'Střed', ['ArrowRight'])], [['unfold Střed'], ['unfold Střed']], 'a folded spider root: either key unfolds it');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-29 (L1), FR-UX-03 AC-62 (registry)

async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'catalog module loads');
  return cat!;
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const R233: [string, string, Record<string, string | number>][] = [
  ['mindmap.collapseNode', 'Collapse Program', { node: 'Program' }],
  ['mindmap.expandNode', 'Expand Program, 2 hidden', { node: 'Program', count: 2 }],
  ['mindmap.hiddenCount', '+2', { count: 2 }],
  ['mindmap.addChild', 'Add child to Doprava', { node: 'Doprava' }],
  ['cmd.mindmap.toggleFold', 'Fold or unfold mindmap node', {}],
  ['cmd.mindmap.addChild', 'Add child to mindmap node', {}],
];

test('nfr_oth_02_ac29_r233_texts_are_catalog_keys_with_a_plural_expand_message', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const bad = R233.filter(([k]) => !(k in en)).map(([k]) => `${k}: missing`);
  assert.deepEqual(bad, [], 'every R233 key is in the catalog (mm-mindmap §7.5)');
  const texts = R233.map(([k, , v]) => cat.t(k, v));
  assert.deepEqual(texts, R233.map(([, text]) => text), 'their English texts');
  assert.equal(cat.t('mindmap.expandNode', { node: 'Program', count: 1 }), 'Expand Program, 1 hidden', 'count 1');
  assert.equal(typeof en['mindmap.expandNode'], 'object', '`Expand {node}, {count} hidden` is a plural message (D-133)');
  const pseudo = cat.pseudo(cat.en) as Record<string, unknown>;
  cat.setCatalog(pseudo, 'en');
  const wrapped = R233.map(([k, , v]) => cat.t(k, v)).filter((s: string) => !/^⟦.*⟧$/s.test(s));
  assert.deepEqual(wrapped, [], 'the pseudo-locale wraps every R233 text; the node text stays inside the frame');
  assert.ok(String(cat.t('mindmap.expandNode', { node: 'Program', count: 2 })).includes('Program'), 'the node text is the user\'s content');
});

test('nfr_oth_02_ac29_czech_test_catalog_uses_the_plural_forms', async () => {
  const cat = await catalog();
  assert.equal(typeof (cat.en as Record<string, unknown>)['mindmap.expandNode'], 'object', 'the English message has plural forms (D-133)');
  cat.setCatalog({ 'mindmap.expandNode': { one: 'ONE {node} {count}', few: 'FEW {node} {count}', many: 'MANY {node} {count}', other: 'OTHER {node} {count}' } }, 'cs');
  const rules = new Intl.PluralRules('cs');
  const got = [1, 2, 5, 21].map((n) => cat.t('mindmap.expandNode', { node: 'Program', count: n }));
  // RT-7: for whole numbers Czech has one (1), few (2–4) and other (0, 5+, 21); `many` is for fractions.
  assert.deepEqual(got, [1, 2, 5, 21].map((n) => `${rules.select(n).toUpperCase()} Program ${n}`), 'one / few / other by Intl.PluralRules(cs)');
});

test('fr_ux_03_ac62_toggle_fold_and_add_child_commands_are_registered', async () => {
  const cat = await catalog();
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cmd, 'commands module loads');
  const ctx = {
    vault: { name: 'Mapy', path: '/tmp/Mapy', placeholders: 0 },
    types: [{ key: 'page', name: 'Page', plural: 'Pages', folder: 'Pages', icon: 'file-text', color: 'gray', system: true, invalid: false }],
    counts: { page: 25 },
    route: { id: 'note/<path>', path: 'Pages/Výjezd 2026.md' },
  };
  const list = cmd!.commands(ctx) as { id: string; title: string; section?: string; needsVault?: boolean; shortcut?: string; due?: unknown }[];
  const bad: string[] = [];
  for (const [id, key, text] of [['mindmap.toggleFold', 'cmd.mindmap.toggleFold', 'Fold or unfold mindmap node'], ['mindmap.addChild', 'cmd.mindmap.addChild', 'Add child to mindmap node']]) {
    const c = list.find((x) => x.id === id);
    if (!c) { bad.push(`${id}: not registered`); continue; }
    if (c.title !== key || cat.t(c.title) !== text) bad.push(`${id}: title ${c.title} = ${cat.t(c.title)}`);
    if (c.section !== 'edit' || c.needsVault !== true) bad.push(`${id}: section ${c.section}, needsVault ${c.needsVault}`);
    if ((c.shortcut ?? null) !== null || (c.due ?? null) !== null) bad.push(`${id}: shortcut ${c.shortcut}, due ${JSON.stringify(c.due)} (none, built)`);
  }
  assert.deepEqual(bad, [], 'R233: section edit, needsVault, no shortcut, built (AP-2122)');
});
