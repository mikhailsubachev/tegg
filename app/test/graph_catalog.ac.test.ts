// Slice G1, L1: the strings, the route registry, the commands and the shortcut of the local graph
// (docs/acceptance/graph.md R112, FR-UX-03 AC-20, FR-GRP-01 AC-10, NFR-OTH-02 AC-12, FR-TAG-05 AC-9; app-shell R1, R4;
// docs/contracts/v1-graph.md §3, §4). Written from the ACs and the contract only (D-61). Modules load inside the tests
// (TS-I1); every test starts with a check that fails until G1 is built, so none passes on the stubs.
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
  const routes = await load('../ui/src/shell/routes.ts');
  assert.ok(reg && cat && cmd && routes, 'registry, catalog, commands and routes modules load');
  return { reg: reg!, cat: cat!, cmd: cmd!, routes: routes! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** R112: key → English text (variables in braces). Plural keys are checked with numbers below. */
const R112: [string, string][] = [
  ['graph.tabTitle', 'Graph · {title}'], ['graph.heading', 'Local graph of'], ['graph.countTruncated', '{shown} of {count} objects'],
  ['graph.depth', 'Depth'], ['graph.hidden', '{count} hidden'], ['graph.recenter', 'Recenter'], ['graph.filters', 'Graph filters'],
  ['graph.types', 'Types'], ['graph.types.all', 'All'], ['graph.types.none', 'None'], ['graph.connections', 'Connections'],
  ['graph.filtersButton', 'Filters'], ['graph.kind.links', 'Links'], ['graph.kind.relations', 'Relations'], ['graph.kind.embeds', 'Embeds'],
  ['graph.kind.tags', 'Tags'], ['graph.sizeByLinks', 'Size nodes by links'], ['graph.zoomIn', 'Zoom in'], ['graph.zoomOut', 'Zoom out'],
  ['graph.fit', 'Fit to screen'], ['graph.hint.click', 'Click to preview · double-click to open'], ['graph.preview.label', 'Preview'],
  ['graph.preview.empty', 'Click a node to preview it'], ['graph.preview.emptyNote', 'Its neighbours are highlighted; double-click opens the object.'],
  ['graph.centerHere', 'Center graph here'], ['graph.noLinks', 'No links yet'], ['graph.noLinks.canvas', 'Local graph: {title} has no links'],
  ['graph.showAllTypes', 'Show all types'], ['graph.showEverything', 'Show everything'], ['graph.loading', 'Building the graph…'],
  ['graph.tooMany', '{count} objects at depth {depth}.'], ['graph.tooMany.showing', 'Showing the {shown} most connected; labels hidden.'],
  ['graph.tooMany.over', 'Too many to show at once: choose a lower depth or filter types.'], ['graph.shownAll', 'Showing all {count} objects.'],
  ['graph.lowerDepth', 'Depth {depth} · {count}'], ['graph.filterTypes', 'Filter types…'], ['graph.showAll', 'Show all'],
  ['graph.deleted', 'This object was deleted'], ['graph.deleted.trash', '“{title}” is in the trash, so there is no graph to show.'],
  ['graph.deleted.gone', '“{title}” no longer exists, so there is no graph to show.'], ['graph.back', 'Back'],
  ['graph.rel.linkFrom', 'Linked from {title}'], ['graph.rel.linkTo', 'Links to {title}'], ['graph.rel.relationFrom', 'Linked from {title} by relation {name}'],
  ['graph.rel.relationTo', 'Links to {title} by relation {name}'], ['graph.rel.embedFrom', 'Embedded in {title}'], ['graph.rel.embedTo', 'Embeds {title}'],
  ['graph.rel.tagOf', 'Tag of {title}'], ['graph.rel.taggedWith', 'Tagged {title}'], ['graph.relKey.source', 'Source'], ['graph.relKey.description', 'Description'],
  ['cmd.graph.open', 'Open graph'], ['cmd.graph.depth1', 'Graph: Depth 1'], ['cmd.graph.depth2', 'Graph: Depth 2'], ['cmd.graph.depth3', 'Graph: Depth 3'],
  ['cmd.graph.recenter', 'Graph: Recenter'],
];
/** R112's plural keys: (key, vars, text) for 1 and 5. */
const PLURALS: [string, Record<string, string | number>, string][] = [
  ['graph.count', { count: 1 }, '1 object'], ['graph.count', { count: 5 }, '5 objects'],
  ['graph.preview.connections', { type: 'Image', count: 1 }, 'Image · 1 connection'], ['graph.preview.connections', { type: 'Projekt', count: 6 }, 'Projekt · 6 connections'],
  ['graph.allHidden.types', { count: 9 }, 'All 9 linked objects are hidden by the type filter.'],
  ['graph.allHidden.filters', { count: 9 }, 'All 9 linked objects are hidden by the filters.'],
  ['graph.canvas', { title: 'Plán čtvrtletí', count: 1 }, 'Local graph: Plán čtvrtletí and the objects linked to it, 1 level deep'],
  ['graph.canvas', { title: 'Plán čtvrtletí', count: 2 }, 'Local graph: Plán čtvrtletí and the objects linked to it, 2 levels deep'],
];
const ALL_KEYS = new Set([...R112.map(([k]) => k), ...PLURALS.map(([k]) => k)]);
/** G3's keys (graph.md R124), which this G1 check leaves out (AP-944, D-1104). */
const R124_KEYS = new Set([
  'graph.preset.label', 'graph.preset.button', 'graph.preset.default', 'graph.preset.builtIn', 'graph.preset.modified', 'graph.preset.modifiedA11y',
  'graph.preset.menu', 'graph.preset.update', 'graph.preset.revert', 'graph.preset.saveAs', 'graph.preset.updateNamed', 'graph.preset.renameNamed',
  'graph.preset.deleteNamed', 'graph.preset.notModified', 'graph.preset.isDefault', 'graph.preset.saveTitle', 'graph.preset.name', 'graph.preset.saveNote',
  'graph.preset.cancel', 'graph.preset.save', 'graph.preset.renameField', 'graph.preset.renameHint', 'graph.preset.deleteTitle', 'graph.preset.deleteNote',
  'graph.preset.delete', 'graph.preset.err.empty', 'graph.preset.err.taken', 'graph.preset.err.long', 'graph.preset.err.control', 'graph.preset.unreadable',
  'graph.preset.unreadableLine', 'graph.preset.fixFile', 'graph.preset.newer', 'graph.preset.changedOutside', 'graph.preset.saveFailed', 'graph.view',
  'graph.view.graph', 'graph.view.list', 'graph.list', 'graph.connectionsCount', 'graph.a11y.node', 'graph.a11y.centre', 'graph.a11y.position',
  'graph.canvas.help', 'graph.hint.hover', 'graph.hint.off', 'graph.preview.emptyHover', 'graph.preview.emptyHoverNote', 'graph.preview.emptyOff',
  'graph.preview.emptyOffNote', 'cmd.graph.applyPreset', 'cmd.graph.savePreset', 'cmd.graph.updatePreset', 'cmd.graph.revertPreset',
  'cmd.graph.renamePreset', 'cmd.graph.deletePreset', 'cmd.graph.showList', 'cmd.graph.showGraph',
]);

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

test('nfr_oth_02_ac12_graph_strings_in_the_catalog', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, text] of R112) {
    if (!(key in en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = m[1] === 'count' || m[1] === 'shown' || m[1] === 'depth' ? 7 : `«${m[1]}»`;
    const got = cat.t(key, vars);
    if (got !== fill(text, vars)) bad.push(`${key}: want ${JSON.stringify(fill(text, vars))}, got ${JSON.stringify(got)}`);
  }
  for (const [key, vars, want] of PLURALS) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every R112 key with its English text (plural forms per D-133)');
  const extra = Object.keys(en).filter((k) => (k.startsWith('graph.') || k.startsWith('cmd.graph.')) && !ALL_KEYS.has(k) && !R124_KEYS.has(k));
  assert.deepEqual(extra, [], 'G1 adds exactly the R112 keys (G3\'s R124 keys aside, AP-944)');
});

test('nfr_oth_02_ac12_graph_strings_in_the_catalog_czech_plurals', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['graph.count', 'graph.hidden', 'graph.preview.connections']) assert.ok(k in en, `catalog key ${k}`);
  cat.setCatalog({
    ...en,
    'graph.count': { one: '{count} objekt', few: '{count} objekty', other: '{count} objektů' },
    'graph.hidden': { one: '{count} skrytý', few: '{count} skryté', other: '{count} skrytých' },
    'graph.preview.connections': { one: '{type} · {count} spojení', few: '{type} · {count} spojení', other: '{type} · {count} spojení' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.count', { count: n })), ['1 objekt', '3 objekty', '5 objektů'], 'graph.count: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.hidden', { count: n })), ['1 skrytý', '3 skryté', '5 skrytých'], 'graph.hidden: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.preview.connections', { type: 'Projekt', count: n })), ['Projekt · 1 spojení', 'Projekt · 3 spojení', 'Projekt · 5 spojení'], 'graph.preview.connections');
});

// ------------------------------------------------------------------------------------------------ registry (R1, R4)

const VAULT = { name: 'Graf', path: '/tmp/Graf', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: [], counts: { page: 10 }, ...(route ? { route } : {}) });
const NOTE = { id: 'note/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md', type: 'page' };
const GRAPH = { id: 'graph/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md' };

test('fr_grp_01_ac10_graph_route_title_and_nfc_registry', async () => {
  const { reg, routes } = await mods();
  const r = (reg.ROUTES as any[]).find((x) => x.id === 'graph/<path>');
  assert.ok(r, 'R1: the route graph/<path>');
  assert.equal(r.status.built, true, 'graph/<path> is built');
  assert.equal(r.design, 'Graph', 'board Graph');
  assert.ok(!(reg.ROUTES as any[]).some((x) => x.id === 'graph'), 'the TBD row `graph` is replaced');
  const nfd = 'graph/Pages/Plán čtvrtletí.md'.normalize('NFD');
  assert.deepEqual(routes.parseRoute(nfd), { id: 'graph/<path>', param: 'Pages/Plán čtvrtletí.md' }, 'parseRoute normalizes the path to NFC');
  assert.equal(routes.routeString({ id: 'graph/<path>', param: 'Pages/Plán čtvrtletí.md'.normalize('NFD') }), 'graph/Pages/Plán čtvrtletí.md', 'routeString is NFC');
  // D-1022: the right panel's Graph tab (R2) stays `Coming in v1.0` until G2; only the route placeholder must be gone.
  assert.ok(!(reg.ROUTES as any[]).some((x) => String(x.id).startsWith('graph') && !x.status.built), 'no unbuilt `graph` route placeholder');
});

test('fr_ux_03_ac20_graph_commands_and_shortcut', async () => {
  const { reg, cat, cmd } = await mods();
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(sc.filter((s) => s.command.startsWith('graph.')), [{ keys: '⇧⌘G', command: 'graph.open' }], '⌘⇧G Open graph, the one graph shortcut (R4)');
  const keys = sc.map((s) => s.keys);
  assert.equal(keys.filter((k) => k === '⇧⌘G').length, 1, 'no other command on ⌘⇧G (FR-UX-03 AC-7)');
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const onNote = cmd.commands(ctx(NOTE)) as any[];
  const open = onNote.find((c) => c.id === 'graph.open');
  assert.ok(open, 'graph.open on a note');
  assert.deepEqual([title(open), open.section, open.needsVault, open.shortcut], ['Open graph', 'navigate', true, '⇧⌘G'], 'Open graph: section navigate, needsVault, ⌘⇧G');
  assert.equal(open.disabled?.() ?? null, null, 'enabled on a note');
  for (const id of ['graph.depth1', 'graph.depth2', 'graph.depth3', 'graph.recenter']) {
    assert.ok(!onNote.some((c) => c.id === id), `${id} is not listed on a note`);
  }
  const onGraph = cmd.commands(ctx(GRAPH)) as any[];
  const want: [string, string][] = [['graph.depth1', 'Graph: Depth 1'], ['graph.depth2', 'Graph: Depth 2'], ['graph.depth3', 'Graph: Depth 3'], ['graph.recenter', 'Graph: Recenter']];
  for (const [id, t] of want) {
    const c = onGraph.find((x) => x.id === id);
    assert.ok(c, `${id} on graph/<path>`);
    assert.equal(title(c), t, `${id}: ${t}`);
    assert.equal(c.section, 'navigate', `${id}: section navigate`);
    assert.equal(c.needsVault, true, `${id}: needsVault`);
  }
  for (const route of [{ id: 'search' }, { id: 'tasks' }, { id: 'type/<type>', param: 'page' }, { id: 'new/<type>', param: 'page' }]) {
    const c = (cmd.commands(ctx(route)) as any[]).find((x) => x.id === 'graph.open');
    assert.ok(c && typeof c.disabled === 'function' && c.disabled() !== null, `Open graph is listed disabled on ${route.id} (D-987)`);
  }
  const all = [onNote, onGraph].flat().map(title);
  for (const t of ['Show local graph']) {
    assert.ok(!all.includes(t), `${t} is not in the registry before G2`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-TAG-05 AC-9

const COLOURS = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'];
const tokenOf = (v: string) => /^var\(--([\w-]+)\)$/.exec(String(v).trim())?.[1] ?? null;

test('fr_tag_05_ac9_graph_tag_pills_contrast', async () => {
  const chip = await load('../ui/src/tags/chip.ts');
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(chip && tok && con, 'tags/chip.ts, theme tokens and contrast load');
  const bad: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const t = tok!.themes[theme] as Record<string, string>;
    if (!t.canvas) { bad.push(`${theme}: no --canvas token (the graph canvas, R113)`); continue; }
    for (const c of [...COLOURS, null]) {
      const s = chip!.tagChipStyle(c);
      const fg = tokenOf(s.color), bg = tokenOf(s.background);
      if (!fg || !bg || !t[fg] || !t[bg]) { bad.push(`${theme} ${c}: unknown tokens`); continue; }
      for (const on of [bg, 'canvas']) {
        const r = con!.ratio(t[fg], t[on]);
        if (r < 4.5) bad.push(`${theme} ${c ?? 'neutral'}: ${fg} on ${on} = ${r.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'pill text on the pill fill and on --canvas ≥ 4.5:1 for the eight colours and the neutral chip, light and dark (D-709, D-129)');
});
