// Slice "G3 in the panel", L1: the footer per preview mode and its strings (docs/acceptance/graph-panel-g3.md R128,
// NFR-OTH-02 AC-15, AP-964 = D-1134), R123's commands while the right panel shows the Graph tab (R127, FR-UX-03 AC-37,
// AP-932, AP-972 = D-1142) and the List's count against the canvas's (FR-UX-08 AC-11, `listTree`, AP-938). Interface
// docs/contracts/v1-graph.md §17.1 (`footerText(count, mode = 'click')`), §17.5 (commands routing), §17.6 (strings),
// §16.3 (`listTree`). Golden results: tests/fixtures/vaults/graph-golden (test/graph-data.ts). Written from the ACs and
// the contracts only (D-61). Modules load inside the tests (TS-I1).
//
// Red-test point AP-975: `ShellContext` carries no panel state for AP-972's reasons; the test gives it as
// `GraphStatus.state` (the panel's `GraphPanelCommands.state()`, §17.1), returned by `actions.graphStatus()`.
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { golden, expand } from './graph-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  const pm = await load('../ui/src/graph/panelModel.ts');
  assert.ok(cat && cmd && pm, 'catalog, commands and panelModel modules load');
  return { cat: cat!, cmd: cmd!, pm: pm! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-15

/** R117's keys (G2) and R128's two footer keys (AP-964 as proposed). */
const R117_KEYS = [
  'graph.panel.filters', 'graph.panel.trigger', 'graph.panel.triggerHidden', 'graph.panel.filtersNote', 'graph.panel.openFull',
  'graph.panel.openFullShortcut', 'graph.panel.loading', 'graph.panel.tooMany', 'graph.panel.tooManyCount', 'graph.panel.noFile',
  'graph.panel.inFullGraph', 'graph.panel.footer',
];
const R128: [string, Record<string, number>, string][] = [
  ['graph.panel.footerHover', { count: 1 }, '1 object · hover to preview'], ['graph.panel.footerHover', { count: 10 }, '10 objects · hover to preview'],
  ['graph.panel.footerOff', { count: 1 }, '1 object · click to open'], ['graph.panel.footerOff', { count: 10 }, '10 objects · click to open'],
];

test('nfr_oth_02_ac15_panel_g3_strings_in_the_catalog', async () => {
  const { cat, pm } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of R128) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R128\'s two footer keys with their English text, plural by Intl.PluralRules (D-133)');
  const footer: [number, string | undefined, string][] = [
    [10, undefined, '10 objects · click a node to preview'], [10, 'click', '10 objects · click a node to preview'], [1, 'click', '1 object · click a node to preview'],
    [10, 'hover', '10 objects · hover to preview'], [1, 'hover', '1 object · hover to preview'],
    [10, 'off', '10 objects · click to open'], [1, 'off', '1 object · click to open'],
  ];
  const texts = footer.map(([n, mode]) => (mode === undefined ? pm.footerText(n) : pm.footerText(n, mode)));
  assert.deepEqual(texts, footer.map(([, , w]) => w), '`footerText(count, mode = \'click\')` per mode (§17.1; the default keeps G2\'s text)');
  const panelKeys = Object.keys(en).filter((k) => k.startsWith('graph.panel.'));
  const allowed = new Set([...R117_KEYS, 'graph.panel.footerHover', 'graph.panel.footerOff']);
  assert.deepEqual(panelKeys.filter((k) => !allowed.has(k)), [], 'no other `graph.panel.*` key than R117\'s and R128\'s (the rest of `graph.*` is checked by NFR-OTH-02 AC-12)');
});

test('nfr_oth_02_ac15_panel_g3_strings_in_the_catalog_czech_plurals', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['graph.panel.footerHover', 'graph.panel.footerOff']) assert.ok(k in en, `catalog key ${k} (R128)`);
  cat.setCatalog({
    ...en,
    'graph.panel.footerHover': { one: '{count} objekt · najeďte pro náhled', few: '{count} objekty · najeďte pro náhled', other: '{count} objektů · najeďte pro náhled' },
    'graph.panel.footerOff': { one: '{count} objekt · kliknutím otevřete', few: '{count} objekty · kliknutím otevřete', other: '{count} objektů · kliknutím otevřete' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.panel.footerHover', { count: n })),
    ['1 objekt · najeďte pro náhled', '3 objekty · najeďte pro náhled', '5 objektů · najeďte pro náhled'], 'graph.panel.footerHover: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.panel.footerOff', { count: n })),
    ['1 objekt · kliknutím otevřete', '3 objekty · kliknutím otevřete', '5 objektů · kliknutím otevřete'], 'graph.panel.footerOff: one, few, other');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-37 (registry)

const VAULT = { name: 'Graf', path: '/tmp/Graf', placeholders: 0 };
type Panel = { open: boolean; tab: 'backlinks' | 'outline' | 'graph' };
type Status = { view: 'graph' | 'list'; stored: boolean; modified: boolean; file: 'missing' | 'ok' | 'newer' | 'unreadable'; state?: string | null };
const NOTE = { id: 'note/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md', type: 'page' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-10-07', date: '2026-10-07', path: 'Daily/2026-10-07.md' };
const NEW = { id: 'new/<type>', param: 'page', type: 'page', path: null };
const ON_GRAPH: Panel = { open: true, tab: 'graph' };
const R123: [string, string][] = [
  ['graph.preset.apply', 'Graph: Apply preset…'], ['graph.preset.save', 'Graph: Save as new preset…'], ['graph.preset.update', 'Graph: Update preset'],
  ['graph.preset.revert', 'Graph: Revert preset'], ['graph.preset.rename', 'Graph: Rename preset…'], ['graph.preset.delete', 'Graph: Delete preset…'],
];
const PRESET_IDS = R123.map(([id]) => id);
const VIEW_IDS = ['graph.view.list', 'graph.view.graph'];
function ctxOf(route: Record<string, unknown>, panel: Panel | undefined, status: Status | null, calls: string[] = []) {
  return {
    vault: VAULT, types: [], counts: { page: 10 }, route, ...(panel ? { panel } : {}),
    actions: { graphStatus: () => status, graphCommand: (id: string) => calls.push(id) },
  };
}
const ST = (o: Partial<Status> = {}): Status => ({ view: 'graph', stored: false, modified: false, file: 'missing', ...o });

test('fr_ux_03_ac37_graph_commands_act_on_the_panel', async () => {
  const { cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const list = (route: Record<string, unknown>, panel: Panel | undefined, status: Status | null, calls?: string[]) => cmd.commands(ctxOf(route, panel, status, calls)) as any[];
  const find = (l: any[], id: string) => l.find((c) => c.id === id);
  const reason = (l: any[], id: string) => { const c = find(l, id); return c ? (c.disabled?.() ?? null) : 'not listed'; };

  // R127: listed while the panel shows Graph on note, daily and new routes; the view command by graph.panel.view.
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['new', NEW]] as const) {
    const l = list(route, ON_GRAPH, ST());
    for (const [id, t] of R123) {
      const c = find(l, id);
      assert.ok(c, `${what}: ${id} is listed while the panel shows Graph (R127)`);
      assert.deepEqual([title(c), c.section, c.needsVault, c.shortcut ?? null], [t, 'navigate', true, null], `${what}: ${id} reads \`${t}\``);
    }
    assert.ok(find(l, 'graph.view.list') && !find(l, 'graph.view.graph'), `${what}: \`Show as list\` only, while graph.panel.view is Graph (AP-932)`);
    assert.equal(find(l, 'graph.recenter'), undefined, `${what}: no \`Graph: Recenter\` (D-1035)`);
  }
  const inList = list(NOTE, ON_GRAPH, ST({ view: 'list' }));
  assert.ok(find(inList, 'graph.view.graph') && !find(inList, 'graph.view.list'), 'in List: `Show as graph` only');

  // They act on the panel: the command is routed to the shown graph (§17.5).
  const calls: string[] = [];
  const l0 = list(NOTE, ON_GRAPH, ST(), calls);
  for (const id of ['graph.preset.apply', 'graph.preset.save', 'graph.view.list']) await find(l0, id)?.run(ctxOf(NOTE, ON_GRAPH, ST(), calls));
  assert.deepEqual(calls, ['preset.apply', 'preset.save', 'view.list'], 'running them calls graphCommand with the panel\'s ids');

  // R123's reasons from the panel's status.
  const def = list(NOTE, ON_GRAPH, ST({ file: 'ok' }));
  assert.deepEqual(['graph.preset.update', 'graph.preset.rename', 'graph.preset.delete'].map((id) => reason(def, id)),
    ['Default can\'t be changed.', 'Default can\'t be changed.', 'Default can\'t be changed.'], 'Default current: Update, Rename, Delete aria-disabled with `Default can\'t be changed.`');
  const stored = list(NOTE, ON_GRAPH, ST({ file: 'ok', stored: true }));
  assert.deepEqual(['graph.preset.update', 'graph.preset.revert'].map((id) => reason(stored, id)),
    ['The filters match the preset.', 'The filters match the preset.'], 'a stored preset, not modified: Update and Revert with `The filters match the preset.`');
  assert.deepEqual(['graph.preset.apply', 'graph.preset.save', 'graph.preset.rename', 'graph.preset.delete'].map((id) => reason(stored, id)), [null, null, null, null], 'the others enabled');
  for (const [file, text] of [['unreadable', 'Fix .tegg/graph.yml to save presets.'], ['newer', 'Made by a newer version of Tegg. Read-only.']] as const) {
    const l = list(NOTE, ON_GRAPH, ST({ file, stored: true, modified: true }));
    assert.deepEqual(['graph.preset.save', 'graph.preset.update', 'graph.preset.rename', 'graph.preset.delete'].map((id) => reason(l, id)), [text, text, text, text], `${file}: \`${text}\``);
    assert.equal(reason(l, 'graph.preset.apply'), null, `${file}: Apply stays enabled`);
  }

  // AP-972 (D-1142): the panel's No file, Deleted (and a pending day) and No links states (AP-975: `state` in the status).
  for (const state of ['noFile', 'deleted']) {
    const l = list(state === 'noFile' ? NEW : NOTE, ON_GRAPH, ST({ state }));
    for (const id of [...PRESET_IDS, 'graph.view.list']) assert.equal(reason(l, id), 'Open an object first', `${state}: ${id} aria-disabled with \`Open an object first\``);
  }
  const noLinks = list(NOTE, ON_GRAPH, ST({ state: 'noLinks' }));
  for (const id of PRESET_IDS) assert.equal(reason(noLinks, id), 'No links yet', `noLinks: ${id} aria-disabled with \`No links yet\``);
  assert.equal(reason(noLinks, 'graph.view.list'), null, 'noLinks: the view command stays enabled (the List shows the centre row)');

  // With the panel on Backlinks or closed, none of them (G2 FR-UX-03 AC-21 unchanged).
  for (const p of [{ open: true, tab: 'backlinks' }, { open: false, tab: 'graph' }] as Panel[]) {
    const l = list(NOTE, p, null);
    for (const id of [...PRESET_IDS, ...VIEW_IDS, 'graph.depth1']) assert.equal(find(l, id), undefined, `${id} not listed with the panel ${JSON.stringify(p)}`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-11 (L1)

test('fr_ux_08_ac11_panel_list_matches_the_canvas', async () => {
  const { pm } = await mods();
  const gm = await load('../ui/src/graph/graphModel.ts');
  assert.ok(gm && typeof gm.listTree === 'function' && typeof gm.nodeKey === 'function', 'graphModel.listTree and nodeKey (§16.3)');
  const g = golden();
  const bad: string[] = [];
  for (const s of g.scenarios) {
    const r = expand(g, s);
    const rows = gm!.listTree(r) as { key: string }[];
    const nodes = r.nodes.map((n) => gm!.nodeKey(n) as string).sort();
    const keys = rows.map((x) => x.key).sort();
    if (JSON.stringify(keys) !== JSON.stringify(nodes)) bad.push(`${s.name}: rows ${keys.length} vs nodes ${nodes.length}`);
    for (const mode of ['click', 'hover', 'off'] as const) {
      const fromRows = pm.footerText(rows.length, mode), fromNodes = pm.footerText(r.nodes.length, mode);
      const want = { click: `${r.nodes.length} ${r.nodes.length === 1 ? 'object' : 'objects'} · click a node to preview`, hover: `${r.nodes.length} ${r.nodes.length === 1 ? 'object' : 'objects'} · hover to preview`, off: `${r.nodes.length} ${r.nodes.length === 1 ? 'object' : 'objects'} · click to open` }[mode];
      if (fromRows !== fromNodes || fromRows !== want) bad.push(`${s.name} ${mode}: List footer ${JSON.stringify(fromRows)}, Graph footer ${JSON.stringify(fromNodes)}, want ${JSON.stringify(want)}`);
    }
  }
  assert.deepEqual(bad, [], 'for every golden scenario the List\'s rows are the canvas\'s node set and both footers give the same count, in each mode (AP-938, AP-964)');
});
