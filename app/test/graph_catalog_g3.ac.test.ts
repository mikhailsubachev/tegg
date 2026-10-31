// Slice G3, L1: the strings and the palette commands of presets, keyboard and List (docs/acceptance/graph.md R123,
// R124; NFR-OTH-02 AC-14, FR-UX-03 AC-28; app-shell R4; docs/contracts/v1-graph.md §16.3): every R124 key with its
// English text and plural forms (D-133; the Czech test catalog for 1, 3 and 5), and R123's commands in the registry
// with their ids, titles, section, `needsVault`, no shortcut, listed only on `graph/<path>`. Written from the ACs and
// the contract only (D-61). Modules load inside the tests (TS-I1).
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

/** R124: key → English text (variables in braces). `graph.connectionsCount` is checked with numbers below. */
const R124: [string, string][] = [
  ['graph.preset.label', 'Preset'], ['graph.preset.button', 'Preset: {name}'], ['graph.preset.default', 'Default'], ['graph.preset.builtIn', 'built-in'],
  ['graph.preset.modified', '· modified'], ['graph.preset.modifiedA11y', 'Modified'], ['graph.preset.menu', 'Presets'], ['graph.preset.update', 'Update'],
  ['graph.preset.revert', 'Revert'], ['graph.preset.saveAs', 'Save as new preset…'], ['graph.preset.updateNamed', 'Update “{name}”'],
  ['graph.preset.renameNamed', 'Rename “{name}”…'], ['graph.preset.deleteNamed', 'Delete “{name}”…'], ['graph.preset.notModified', 'The filters match the preset.'],
  ['graph.preset.isDefault', 'Default can\'t be changed.'], ['graph.preset.saveTitle', 'Save preset'], ['graph.preset.name', 'Name'],
  ['graph.preset.saveNote', 'Saves the types and connection kinds. Depth is not part of a preset.'], ['graph.preset.cancel', 'Cancel'], ['graph.preset.save', 'Save'],
  ['graph.preset.renameField', 'Preset name'], ['graph.preset.renameHint', '↩ save'], ['graph.preset.deleteTitle', 'Delete “{name}”?'],
  ['graph.preset.deleteNote', 'The graph keeps its current filters. Other graphs using it fall back to Default.'], ['graph.preset.delete', 'Delete'],
  ['graph.preset.err.empty', 'Enter a name.'], ['graph.preset.err.taken', 'A preset named “{name}” already exists.'], ['graph.preset.err.long', 'Use at most 100 characters.'],
  ['graph.preset.err.control', 'Names can\'t contain control characters.'], ['graph.preset.unreadable', 'The presets file can\'t be read.'],
  ['graph.preset.unreadableLine', 'The presets file can\'t be read (line {line}).'], ['graph.preset.fixFile', 'Fix .tegg/graph.yml to save presets.'],
  ['graph.preset.newer', 'Made by a newer version of Tegg. Read-only.'], ['graph.preset.changedOutside', 'Presets changed outside Tegg. Your change wasn\'t saved.'],
  ['graph.preset.saveFailed', 'Couldn\'t save the presets. Try again.'], ['graph.view', 'View'], ['graph.view.graph', 'Graph'], ['graph.view.list', 'List'],
  ['graph.list', 'Local graph as a list'], ['graph.a11y.node', '{connections}. {relation}. {position}.'], ['graph.a11y.centre', '{connections}. Centre of the graph. {position}.'],
  ['graph.a11y.position', '{index} of {total}'], ['graph.canvas.help', 'Use the arrow keys to move between nodes. Switch the view to List to read the same objects as a list.'],
  ['graph.hint.hover', 'Hover to preview · click to open'], ['graph.hint.off', 'Click to open'], ['graph.preview.emptyHover', 'Hover over a node to preview it'],
  ['graph.preview.emptyHoverNote', 'Its neighbours are highlighted; click opens the object.'], ['graph.preview.emptyOff', 'Previews are off'],
  ['graph.preview.emptyOffNote', 'Press ⌥Space on a focused node to preview it.'], ['cmd.graph.applyPreset', 'Graph: Apply preset…'],
  ['cmd.graph.savePreset', 'Graph: Save as new preset…'], ['cmd.graph.updatePreset', 'Graph: Update preset'], ['cmd.graph.revertPreset', 'Graph: Revert preset'],
  ['cmd.graph.renamePreset', 'Graph: Rename preset…'], ['cmd.graph.deletePreset', 'Graph: Delete preset…'], ['cmd.graph.showList', 'Graph: Show as list'],
  ['cmd.graph.showGraph', 'Graph: Show as graph'],
];
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-14

test('nfr_oth_02_ac14_g3_strings_in_the_catalog', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, text] of R124) {
    if (!(key in en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = ['line', 'index', 'total'].includes(m[1]) ? 7 : `«${m[1]}»`;
    const got = cat.t(key, vars);
    if (got !== fill(text, vars)) bad.push(`${key}: want ${JSON.stringify(fill(text, vars))}, got ${JSON.stringify(got)}`);
  }
  for (const [n, want] of [[1, '1 connection'], [3, '3 connections'], [5, '5 connections']] as const) {
    const got = 'graph.connectionsCount' in en ? cat.t('graph.connectionsCount', { count: n }) : 'missing';
    if (got !== want) bad.push(`graph.connectionsCount ${n}: want ${want}, got ${got}`);
  }
  assert.deepEqual(bad, [], 'every R124 key with its English text (plural forms per D-133)');
  const glued: string[] = [];
  for (const [key, text] of R124) {
    const v = en[key];
    if (key !== 'graph.preset.err.long' && typeof v === 'string' && /\d/.test(v.replace(/\{\w+\}/g, ''))) glued.push(`${key}: a number in the text (${text})`);
  }
  assert.deepEqual(glued, [], 'numbers come only through variables (D-133), `100 characters` aside');
});

test('nfr_oth_02_ac14_g3_strings_in_the_catalog_czech_plurals', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  assert.ok('graph.connectionsCount' in en, 'catalog key graph.connectionsCount');
  cat.setCatalog({ ...en, 'graph.connectionsCount': { one: '{count} spojení', few: '{count} spojení', other: '{count} spojení' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.connectionsCount', { count: n })), ['1 spojení', '3 spojení', '5 spojení'], 'Intl.PluralRules forms for 1, 3, 5');
  cat.setCatalog({ ...en, 'graph.connectionsCount': { one: '{count} vazba', few: '{count} vazby', other: '{count} vazeb' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('graph.connectionsCount', { count: n })), ['1 vazba', '3 vazby', '5 vazeb'], 'one, few, other');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-28 (registry)

const VAULT = { name: 'Graf', path: '/tmp/Graf', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: [], counts: { page: 10 }, ...(route ? { route } : {}) });
const NOTE = { id: 'note/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md', type: 'page' };
const GRAPH = { id: 'graph/<path>', param: 'Pages/Plán čtvrtletí.md', path: 'Pages/Plán čtvrtletí.md' };
const R123: [string, string][] = [
  ['graph.preset.apply', 'Graph: Apply preset…'], ['graph.preset.save', 'Graph: Save as new preset…'], ['graph.preset.update', 'Graph: Update preset'],
  ['graph.preset.revert', 'Graph: Revert preset'], ['graph.preset.rename', 'Graph: Rename preset…'], ['graph.preset.delete', 'Graph: Delete preset…'],
];
const VIEWS: [string, string][] = [['graph.view.list', 'Graph: Show as list'], ['graph.view.graph', 'Graph: Show as graph']];

test('fr_ux_03_ac28_graph_preset_and_view_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const onGraph = cmd.commands(ctx(GRAPH)) as any[];
  for (const [id, t] of R123) {
    const c = onGraph.find((x) => x.id === id);
    assert.ok(c, `${id} is listed on graph/<path>`);
    assert.deepEqual([title(c), c.section, c.needsVault, c.shortcut ?? null], [t, 'navigate', true, null], `${id}: ${t}, section navigate, needsVault, no shortcut`);
    assert.equal(typeof c.disabled, 'function', `${id}: has a disabled() reason function (R123)`);
  }
  const views = VIEWS.filter(([id]) => onGraph.some((x) => x.id === id));
  assert.equal(views.length, 1, `exactly one of Show as list / Show as graph is listed at a time: ${JSON.stringify(views)}`);
  for (const [id, t] of views) assert.equal(title(onGraph.find((x) => x.id === id)), t, `${id}: ${t}`);
  const onNote = cmd.commands(ctx(NOTE)) as any[];
  for (const [id] of [...R123, ...VIEWS]) assert.ok(!onNote.some((x) => x.id === id), `${id} isn't listed on a note`);
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(sc.filter((s) => [...R123, ...VIEWS].some(([id]) => id === s.command)), [], 'none of R123 has a shortcut (FR-UX-03 AC-7)');
});
