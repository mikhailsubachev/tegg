// Slice G2, L1: the strings and the commands of the graph in the right panel (docs/acceptance/graph-panel.md R117,
// NFR-OTH-02 AC-13, FR-UX-03 AC-21; docs/contracts/v1-graph.md §15.6). Written from the ACs and the contract only
// (D-61). Modules load inside the tests (TS-I1).
//
// Red-test point AP-895: `ShellContext` has no field for the right panel, so "listed while the panel shows the Graph
// tab" is given as `ctx.panel = { open, tab }` (the panel as drawn on the current route).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** R117: the keys G2 adds, with their English text. */
const R117: [string, string][] = [
  ['graph.panel.filters', 'Depth and filters'], ['graph.panel.trigger', 'Depth {depth}'],
  ['graph.panel.filtersNote', 'Remembered for the panel; the full view keeps its own.'], ['graph.panel.openFull', 'Open full view'],
  ['graph.panel.openFullShortcut', 'Open full view ({shortcut})'], ['graph.panel.loading', 'Loading…'], ['graph.panel.tooMany', 'Too many to show here'],
  ['graph.panel.tooManyCount', '{count} objects at depth {depth}'], ['graph.panel.noFile', 'The graph appears once this note is saved.'],
  ['graph.panel.inFullGraph', 'In full graph'], ['cmd.graph.showLocal', 'Show local graph'],
];
/** R117's plural keys (D-133). */
const PLURALS: [string, Record<string, string | number>, string][] = [
  ['graph.panel.footer', { count: 1 }, '1 object · click a node to preview'], ['graph.panel.footer', { count: 10 }, '10 objects · click a node to preview'],
  ['graph.panel.triggerHidden', { depth: 1, count: 2 }, 'Depth 1 · 2 hidden'], ['graph.panel.triggerHidden', { depth: 2, count: 1 }, 'Depth 2 · 1 hidden'],
];
// Slice "G3 in the panel" (R128, AP-964 = D-1134, AC-test change AP-974 = D-1144): the two footer keys per mode.
const R128_KEYS = ['graph.panel.footerHover', 'graph.panel.footerOff'];
const G2_KEYS = new Set([...R117.map(([k]) => k), ...PLURALS.map(([k]) => k), ...R128_KEYS]);
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

test('nfr_oth_02_ac13_panel_graph_strings_in_the_catalog', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, text] of R117) {
    if (!(key in en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = m[1] === 'count' || m[1] === 'depth' ? 3 : `«${m[1]}»`;
    const got = cat.t(key, vars);
    if (got !== fill(text, vars)) bad.push(`${key}: want ${JSON.stringify(fill(text, vars))}, got ${JSON.stringify(got)}`);
  }
  for (const [key, vars, want] of PLURALS) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every R117 key with its English text (plural forms per D-133)');
  const panelKeys = Object.keys(en).filter((k) => k.startsWith('graph.panel.') || k === 'cmd.graph.showLocal');
  assert.deepEqual(panelKeys.filter((k) => !G2_KEYS.has(k)), [], 'G2 adds exactly the R117 keys (and "G3 in the panel" R128\'s two footer keys)');
});

test('nfr_oth_02_ac13_panel_graph_strings_in_the_catalog_czech_plurals', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['graph.panel.footer', 'graph.panel.triggerHidden']) assert.ok(k in en, `catalog key ${k}`);
  cat.setCatalog({
    ...en,
    'graph.panel.footer': { one: '{count} objekt · klikněte na uzel', few: '{count} objekty · klikněte na uzel', other: '{count} objektů · klikněte na uzel' },
    'graph.panel.triggerHidden': { one: 'Hloubka {depth} · {count} skrytý', few: 'Hloubka {depth} · {count} skryté', other: 'Hloubka {depth} · {count} skrytých' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.panel.footer', { count: n })),
    ['1 objekt · klikněte na uzel', '3 objekty · klikněte na uzel', '5 objektů · klikněte na uzel'], 'graph.panel.footer: one, few, other (Intl.PluralRules)');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.panel.triggerHidden', { depth: 2, count: n })),
    ['Hloubka 2 · 1 skrytý', 'Hloubka 2 · 3 skryté', 'Hloubka 2 · 5 skrytých'], 'graph.panel.triggerHidden: one, few, other');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-21

const VAULT = { name: 'Graf', path: '/tmp/Graf', placeholders: 0 };
type Panel = { open: boolean; tab: 'backlinks' | 'outline' | 'graph' } | undefined;
const ctx = (route: Record<string, unknown> | null, panel?: Panel) => ({ vault: VAULT, types: [], counts: { page: 10 }, ...(route ? { route } : {}), ...(panel ? { panel } : {}) });
const NOTE = { id: 'note/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md', type: 'page' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-10-07', date: '2026-10-07', path: 'Daily/2026-10-07.md' };
const NEW = { id: 'new/<type>', param: 'page', type: 'page', path: null };
const GRAPH = { id: 'graph/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md' };
const TAG = { id: 'tag/<key>', param: 'účty', key: 'účty' };
const ON_GRAPH: Panel = { open: true, tab: 'graph' };

test('fr_ux_03_ac21_panel_graph_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const find = (list: any[], id: string) => list.find((c) => c.id === id);
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['new', NEW]] as const) {
    const c = find(cmd.commands(ctx(route, { open: false, tab: 'backlinks' })) as any[], 'panel.graph');
    assert.ok(c, `panel.graph is listed on ${what} (like panel.backlinks, D-918)`);
    assert.deepEqual([title(c), c.section, c.needsVault, c.shortcut ?? null, c.due ?? null], ['Show local graph', 'view', true, null, null],
      `${what}: \`Show local graph\`, section view, needsVault, no shortcut, not a placeholder`);
  }
  for (const [what, route] of [['tag/<key>', TAG], ['graph/<path>', GRAPH], ['search', { id: 'search' }], ['tasks', { id: 'tasks' }]] as const) {
    assert.equal(find(cmd.commands(ctx(route)) as any[], 'panel.graph'), undefined, `panel.graph is not listed on ${what}`);
  }
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(sc.filter((s) => s.command.startsWith('graph.') || s.command === 'panel.graph'), [{ keys: '⇧⌘G', command: 'graph.open' }], 'no new shortcut: ⌘⇧G stays the one graph shortcut (R4)');
  // `Graph: Depth n` while the panel shows the Graph tab (D-1035); `Graph: Recenter` only on graph/<path>.
  const withPanel = cmd.commands(ctx(NOTE, ON_GRAPH)) as any[];
  for (const [id, t] of [['graph.depth1', 'Graph: Depth 1'], ['graph.depth2', 'Graph: Depth 2'], ['graph.depth3', 'Graph: Depth 3']] as const) {
    const c = find(withPanel, id);
    assert.ok(c, `${id} is listed on a note while the panel shows Graph`);
    assert.deepEqual([title(c), c.section, c.needsVault], [t, 'navigate', true], `${id}: ${t}`);
  }
  assert.equal(find(withPanel, 'graph.recenter'), undefined, '`Graph: Recenter` is not listed on a note with the panel on Graph');
  for (const p of [{ open: true, tab: 'backlinks' }, { open: false, tab: 'graph' }] as Panel[]) {
    const list = cmd.commands(ctx(NOTE, p)) as any[];
    for (const id of ['graph.depth1', 'graph.depth2', 'graph.depth3', 'graph.recenter']) assert.equal(find(list, id), undefined, `${id} not listed with the panel ${JSON.stringify(p)}`);
  }
  assert.ok(find(cmd.commands(ctx(GRAPH)) as any[], 'graph.recenter'), '`Graph: Recenter` stays on graph/<path>');
  const depth2 = find(withPanel, 'graph.depth2');
  const calls: string[] = [];
  const actions = { graphCommand: (id: string) => calls.push(id) };
  await depth2?.run({ ...ctx(NOTE, ON_GRAPH), actions } as any);
  assert.deepEqual(calls, ['depth2'], 'it runs the graph command (the panel\'s depth there)');
});
