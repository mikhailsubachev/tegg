// Slice "G3 in the panel" real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/
// graph-panel-g3.md "Real-app tests" — FR-GRP-02 AC-27 (once: applying presets from the panel keeps graph.yml's bytes,
// mtime and inode), AC-31 (once with the helper process: outside changes reach the panel's list and `· modified`),
// AC-32 (a relaunch restores the panel's preset and view), FR-UX-08 AC-10 (a relaunch in List), FR-UX-03 AC-38 (the
// panel without the pointer; keys sent only to Tegg, D-799), FR-SYN-03 AC-25 (the helper process replaces graph.yml
// before a panel Save: never overwritten) and FR-SYN-06 AC-41 (the tour: only Save as, Update, Rename and Delete write,
// once each, only `.tegg/graph.yml`). Interface docs/contracts/v1-graph.md §17.2, §17.3, §17.7 and ms3-shell §13.6 (the
// external helper). Always TEGG_TEST=1 with the graph test clock, a temporary Application Support (seeded
// `ui-state.json` with `rightPanel.tab: 'graph'`) and a temporary copy of the synthetic graph fixture plus
// tests/fixtures/graph-presets (D-62). Written from the ACs and the contracts only (D-61). Shared helpers:
// app/e2e/helpers/capture.ts, app/e2e/helpers/graph.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO, appiumDown, changedPaths, marks, need, needInGroup, needMenuItem, palette, paste, press, ready, shown, sleep, support, tmp, tree, typeAscii,
  waitFor, type Entry,
} from './helpers/capture.ts';
import {
  PLAN, cleanupGraph, external, externalWrite, graphCopy, graphRoute, graphStateOf, launchOn, needStarting, noteRoute, quit, textShown, type GraphCtx,
} from './helpers/graph.ts';

after(appiumDown);
process.on('exit', appiumDown);

const YML = '.tegg/graph.yml';
const PRESETS = join(REPO, 'tests/fixtures/graph-presets');
const fx = (name: string) => readFileSync(join(PRESETS, name), 'utf8');
const VALID = fx('valid.yml');
const BEZ = { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] as string[], preset: 'Bez štítků' };

/** A temp vault copy with `presets` as `.tegg/graph.yml` (null: none) and an Application Support whose `ui-state.json`
 *  has the right panel open on `tab` and, when given, `graph.panel` for this vault. */
function freshPanel(name: string, presets: string | null, o: { panel?: Record<string, unknown>; tab?: 'graph' | 'backlinks'; hub?: boolean } = {}): GraphCtx {
  const base = tmp(`g3p-${name}`);
  const vault = graphCopy(base, { hub: o.hub });
  if (presets !== null) writeFileSync(join(vault, YML), presets);
  const vaults = o.panel ? { vaults: { [vault.normalize('NFC')]: { graph: { panel: o.panel } } } } : {};
  const sup = support(base, { ui: { rightPanel: { open: true, tab: o.tab ?? 'graph' }, ...vaults } });
  return { base, vault, sup, log: join(base, 'perf-0.jsonl'), runs: 0 };
}
const panelOf = (c: GraphCtx) => graphStateOf(c.sup, c.vault, 'panel');
const fullOf = (c: GraphCtx) => graphStateOf(c.sup, c.vault, 'full');
/** Opens the panel's `Depth and filters` popover. */
async function popover(d: Awaited<ReturnType<typeof launchOn>>) {
  await (await need(d, 'Depth and filters', 5000)).click();
  await sleep(300);
}
/** Opens the preset menu from the popover's preset row (`Preset: <current>`). */
async function presetMenu(d: Awaited<ReturnType<typeof launchOn>>, current: string) {
  await (await need(d, `Preset: ${current}`, 5000)).click();
  await sleep(300);
}
async function apply(d: Awaited<ReturnType<typeof launchOn>>, current: string, name: string) {
  await presetMenu(d, current);
  await (await needMenuItem(d, name)).click();
  await sleep(500);
}
async function saveAs(d: Awaited<ReturnType<typeof launchOn>>, current: string, name: string) {
  await presetMenu(d, current);
  await (await needMenuItem(d, 'Save as new preset…')).click();
  await (await need(d, 'Name')).click();
  if (/^[\x20-\x7e]+$/.test(name)) typeAscii(name); else paste(name);
  press('enter');
  await sleep(700);
}
const listedNames = (text: string) => [...text.matchAll(/^\s*- name: "?(.*?)"?\s*$/gm)].map((m) => m[1].normalize('NFC'));
const graphReady = (c: GraphCtx, ms = 5000) => waitFor(() => marks(c.log).includes('graph-ready'), ms);

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-27

test('fr_grp_02_ac27_panel_applying_a_preset', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshPanel('ac27', VALID);
  try {
    const before = tree(c.vault);
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await graphReady(c), 'the panel draws Plán\'s graph');
    assert.ok(await textShown(d, '10 objects · click a node to preview', 3000), 'Plán in the panel');
    await popover(d);
    await apply(d, 'Default', 'Bez štítků');
    assert.ok(await textShown(d, '8 objects · click a node to preview', 3000), 'Bez štítků: 8 objects');
    assert.ok(await shown(d, 'Preset: Bez štítků', 2000), '`Preset: Bez štítků` in the popover');
    await apply(d, 'Bez štítků', 'Jen vztahy');
    assert.ok(await textShown(d, '3 objects · click a node to preview', 3000), 'Jen vztahy: 3 objects');
    await apply(d, 'Jen vztahy', 'Lidé a schůzky');
    assert.ok(await textShown(d, '2 objects · click a node to preview', 3000), 'Lidé a schůzky: 2 objects');
    await apply(d, 'Lidé a schůzky', 'Default');
    assert.ok(await textShown(d, '10 objects · click a node to preview', 3000), 'Default: 10 objects');
    assert.ok(await waitFor(() => { const p = panelOf(c); return !!p && p.preset === undefined && JSON.stringify(p.hiddenTypes ?? []) === '[]'; }, 3000), `graph.panel back to Default (${JSON.stringify(panelOf(c))})`);
    assert.equal(fullOf(c), null, 'graph.full is neither written nor created');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], '.tegg/graph.yml (and every vault file) keeps its bytes, mtime and inode');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-31

test('fr_grp_02_ac31_panel_presets_file_states_and_outside_changes', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshPanel('ac31', VALID, { panel: BEZ });
  try {
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '8 objects · click a node to preview', 5000), 'the panel on Bez štítků');
    await popover(d);
    assert.ok(await shown(d, 'Preset: Bez štítků', 3000), 'the popover open on Bez štítků');
    externalWrite(join(c.vault, YML), VALID.replace('hidden-types: [tag, kniha]', 'hidden-types: [page]'));
    assert.ok(await textShown(d, '· modified', 2000), 'another program\'s change shows `· modified` within 2 s');
    assert.ok(await textShown(d, '8 objects · click a node to preview', 500), 'the panel\'s 8 nodes stay');
    externalWrite(join(c.vault, YML), `${VALID}  - name: Nová zvenku\n    hidden-types: []\n    hidden-kinds: [tag]\n`);
    await sleep(2000);
    await presetMenu(d, 'Bez štítků');
    assert.ok(await textShown(d, 'Nová zvenku', 1000), 'a preset added outside is listed within 2 s');
    press('escape');
    external('delete', join(c.vault, YML));
    await sleep(2000);
    await presetMenu(d, 'Default').catch(() => {});
    assert.ok(!(await textShown(d, 'Jen vztahy', 800)), 'the file deleted: Default only');
    assert.ok(!existsSync(join(c.vault, YML)), 'and nothing is created');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-32, FR-UX-08 AC-10

test('fr_grp_02_ac32_panel_preset_and_view_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshPanel('ac32', VALID);
  try {
    const d = await launchOn(c, noteRoute(PLAN));
    await popover(d);
    await apply(d, 'Default', 'Bez štítků');
    press('escape');
    await (await need(d, 'List', 3000)).click();
    assert.ok(await shown(d, 'Local graph as a list', 3000), 'the panel\'s List');
    assert.ok(await waitFor(() => panelOf(c)?.preset === 'Bez štítků' && panelOf(c)?.view === 'list', 3000), `ui-state.json: graph.panel { preset, view } (${JSON.stringify(panelOf(c))})`);
    assert.equal(fullOf(c), null, 'graph.full untouched');
    await quit(c);
    const d2 = await launchOn(c, noteRoute(PLAN));
    assert.ok(await shown(d2, 'Local graph as a list', 5000), 'after a relaunch the panel opens Plán in List');
    await popover(d2);
    assert.ok(await shown(d2, 'Preset: Bez štítků', 3000), 'with `Preset: Bez štítků`');
    assert.ok(!(await textShown(d2, '· modified', 500)), 'without `· modified`');
  } finally { await cleanupGraph(c); }
});

test('fr_ux_08_ac10_panel_graph_list_switch', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshPanel('ux08ac10', null);
  try {
    const before = tree(c.vault);
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 5000), 'Plán in the panel');
    await (await needInGroup(d, 'View', 'List', 3000)).click();
    assert.ok(await shown(d, 'Local graph as a list', 3000), 'the tree `Local graph as a list`');
    assert.ok(await waitFor(() => panelOf(c)?.view === 'list', 3000), 'ui-state.json: graph.panel.view `list`');
    assert.equal(fullOf(c), null, 'not graph.full');
    await quit(c);
    const d2 = await launchOn(c, 'daily/2026-10-07');
    assert.ok(await shown(d2, 'Local graph as a list', 5000), 'after a relaunch the next note opens in List in the panel');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault write');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-38

test('fr_ux_03_ac38_panel_presets_and_list_without_the_pointer', { timeout: 300_000 }, async () => {
  await ready();
  // Depth 2 with Tags hidden, stored (no pointer): the saved file is expected/created.yml, the tree as FR-UX-03 AC-30.
  const c = freshPanel('ux03ac38', null, { tab: 'backlinks', panel: { depth: 2, hiddenTypes: ['tag'] } });
  try {
    const d = await launchOn(c, noteRoute(PLAN));
    const yml = () => (existsSync(join(c.vault, YML)) ? readFileSync(join(c.vault, YML), 'utf8') : null);
    palette('Show local graph'); // keys only to Tegg (D-799: helpers/osa.ts)
    assert.ok(await shown(d, 'Depth and filters', 3000), 'the panel\'s Graph tab');
    await sleep(400);
    press('enter');
    await sleep(300);
    press('tab');
    press('enter');
    await sleep(300);
    press('down');
    press('enter');
    await sleep(300);
    paste('Bez štítků');
    press('enter');
    assert.ok(await waitFor(() => yml() === fx('expected/created.yml'), 3000), 'the file is created as expected/created.yml');
    press('enter');
    await sleep(300);
    for (let i = 0; i < 3; i++) press('down'); // Bez štítků → Save as… → Update (aria-disabled, focusable; AP-977) → Rename
    press('enter');
    await sleep(300);
    paste('Bez tagů');
    press('enter');
    assert.ok(await waitFor(() => !!yml()?.includes('- name: Bez tagů'), 3000), 'renamed to Bez tagů');
    press('enter');
    await sleep(300);
    for (let i = 0; i < 4; i++) press('down'); // … → Delete “Bez tagů”…
    press('enter');
    await sleep(300);
    press('tab');
    press('enter');
    assert.ok(await waitFor(() => !yml()?.includes('Bez tagů'), 3000), 'deleted');
    press('escape');
    await sleep(300);
    press('tab'); // Graph
    press('tab'); // List (AP-977)
    press('space');
    assert.ok(await shown(d, 'Local graph as a list', 3000), 'Space on `List` shows the tree');
    press('tab');
    for (const k of ['down', 'right', 'left', 'left', 'right', 'end', 'home']) { press(k); await sleep(120); }
    press('space', ['option']);
    assert.ok(await shown(d, 'Preview: Plán čtvrtletí', 3000), '⌥Space previews the focused (centre) row');
    press('escape');
    await sleep(200);
    press('escape');
    await sleep(300);
    assert.ok(await shown(d, 'Local graph as a list', 1000), 'the panel stays on Graph in List');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-25

test('fr_syn_03_ac25_panel_preset_writes_check_the_base', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshPanel('syn03ac25', VALID);
  try {
    const theirs = `${VALID}  - name: Cizí\n    hidden-types: [page]\n    hidden-kinds: []\n`;
    const d = await launchOn(c, noteRoute(PLAN));
    await popover(d);
    await (await needStarting(d, 'Types', 'Tags')).click();
    await presetMenu(d, 'Default');
    await (await needMenuItem(d, 'Save as new preset…')).click();
    await (await need(d, 'Name')).click();
    typeAscii('Moje');
    const f = join(c.base, `sync-${Date.now()}.tmp`);
    writeFileSync(f, theirs);
    external('rename', f, join(c.vault, YML)); // another program replaces graph.yml before the panel's Save
    press('enter');
    await sleep(800);
    const text = () => readFileSync(join(c.vault, YML), 'utf8');
    if (await textShown(d, 'Presets changed outside Tegg. Your change wasn\'t saved.', 1000)) {
      assert.equal(text(), theirs, 'refused: the other program\'s file stays byte for byte');
      press('enter'); // the Save dialog stays open with the typed name; a second Save writes on top of the new version
    }
    assert.ok(await waitFor(() => listedNames(text()).join('|') === ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Cizí', 'Moje'].join('|'), 3000),
      `never an overwrite: the other program's presets and Moje (${listedNames(text()).join(', ')})`);
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-41

test('fr_syn_06_ac41_panel_only_preset_actions_write', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshPanel('syn06ac41', VALID, { hub: true });
  try {
    const before = tree(c.vault);
    const uiBefore = lstatSync(join(c.sup, 'ui-state.json')).ino;
    let d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 5000), 'Plán in the panel');
    await popover(d);
    let cur = 'Default';
    for (const n of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Default', 'Bez štítků']) { await apply(d, cur, n); cur = n; }
    await (await needStarting(d, 'Types', 'Tags')).click();
    await (await need(d, 'Revert', 3000)).click();
    for (const [item, close] of [['Save as new preset…', 'Cancel'], ['Rename “Bez štítků”…', null], ['Delete “Bez štítků”…', 'Cancel']] as const) {
      await presetMenu(d, cur);
      await (await needMenuItem(d, item)).click();
      await sleep(300);
      if (close) await (await need(d, close)).click(); else press('escape');
      await sleep(300);
    }
    press('escape');
    for (const v of ['List', 'Graph', 'List', 'Graph']) { await (await needInGroup(d, 'View', v)).click(); await sleep(300); }
    await (await need(d, 'Plán čtvrtletí, Page')).click();
    press('escape');
    for (const k of ['right', 'left', 'down', 'up']) press(k);
    press('space', ['option']);
    await sleep(400);
    press('escape');
    press('escape');
    for (const m of ['Object preview: Hover to preview', 'Object preview: Off', 'Object preview: Click to preview']) {
      palette(m);
      await sleep(400);
      const n = await need(d, 'Rozpočet 2027, Projekt', 3000);
      await n.moveTo().catch(() => {});
      await sleep(900);
    }
    await (await need(d, 'Rozpočet 2027, Projekt')).click();
    await (await need(d, 'In full graph', 3000)).click();
    assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(`route-ready:${graphRoute(PLAN)}`), 5000), 'the hand-over to the full view');
    press('lbracket', ['command']);
    await sleep(600);
    await quit(c);
    d = await launchOn(c, noteRoute(PLAN));
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file byte-, mtime- and inode-identical and creates nothing');
    for (const p of ['Tags/nápad.md', 'Daily/2026-10-30.md']) assert.ok(!existsSync(join(c.vault, p)), `no ${p}`);
    const step = async (what: string, f: () => Promise<void>) => {
      const t0 = tree(c.vault);
      await f();
      assert.ok(await waitFor(() => changedPaths(t0, tree(c.vault)).length > 0, 3000), `${what}: a write`);
      await sleep(600);
      assert.deepEqual(changedPaths(t0, tree(c.vault)), [YML], `${what}: exactly one file, .tegg/graph.yml`);
      const a = t0[YML] as Exclude<Entry, 'dir'> | undefined, b = tree(c.vault)[YML] as Exclude<Entry, 'dir'>;
      assert.ok(!a || a.ino !== b.ino, `${what}: a new inode (atomic)`);
    };
    await popover(d);
    await (await needStarting(d, 'Types', 'Pages')).click();
    await step('Save as', () => saveAs(d, 'Bez štítků', 'Moje'));
    await (await needStarting(d, 'Types', 'Tasks')).click();
    await step('Update', async () => { await (await need(d, 'Update')).click(); });
    const same = tree(c.vault);
    await presetMenu(d, 'Moje');
    await (await needMenuItem(d, 'Rename “Moje”…')).click();
    press('enter');
    await sleep(800);
    assert.deepEqual(changedPaths(same, tree(c.vault)), [], 'a rename to the same name writes nothing');
    await step('Rename', async () => {
      await presetMenu(d, 'Moje');
      await (await needMenuItem(d, 'Rename “Moje”…')).click();
      typeAscii(' 2');
      press('enter');
    });
    await step('Delete', async () => {
      await presetMenu(d, 'Moje 2');
      await (await needMenuItem(d, 'Delete “Moje 2”…')).click();
      await (await need(d, 'Delete')).click();
    });
    assert.ok(panelOf(c) !== null, 'ui-state.json holds the panel state');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, uiBefore, 'ui-state.json was replaced atomically (a new inode)');
  } finally { await cleanupGraph(c); }
});
