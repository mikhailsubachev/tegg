// Slice G2 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/graph-panel.md "Real-app
// tests" — FR-GRP-01 AC-31 (a relaunch restores the panel's depth), AC-36 (⌘⇧G from the panel, once), AC-39 (once: an
// external edit appears), AC-42 (once: an external trash move), FR-GRP-02 AC-10 (both views' states after a relaunch),
// FR-NAV-05 AC-3 (the tab after a relaunch), FR-SYN-06 AC-39 (a panel tour writes nothing: every vault file keeps its
// bytes, mtime and inode; only ui-state.json in Application Support is written, atomically). Interface
// docs/contracts/v1-graph.md §15.3, §15.8 (`TEGG_ROUTE=note/<path>` with a seeded `ui-state.json` whose
// `rightPanel.tab` is `graph`; `route-ready:note/<path>`, then `graph-ready`) and ms3-shell §13.6 (the external
// helper). Always TEGG_TEST=1 with the graph test clock, a temporary Application Support and a temporary copy of the
// synthetic graph fixture (D-62). Written from the ACs and the contracts only (D-61). Shared helpers:
// app/e2e/helpers/capture.ts, app/e2e/helpers/graph.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appiumDown, changedPaths, marks, need, needInGroup, press, ready, shown, sleep, tree, waitFor } from './helpers/capture.ts';
import {
  PLAN, cleanupGraph, external, externalWrite, freshGraph, graphRoute, graphStateOf, launchOn, needStarting, noteRoute, quit, textShown,
  uiStateOf, waitRoute,
} from './helpers/graph.ts';

after(appiumDown);
process.on('exit', appiumDown);

const graphReady = (log: string, ms = 5000) => waitFor(() => marks(log).includes('graph-ready'), ms);
/** Opens the panel's `Depth and filters` popover. */
async function popover(d: Awaited<ReturnType<typeof launchOn>>) {
  await (await need(d, 'Depth and filters', 5000)).click();
  await sleep(200);
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01

test('fr_grp_01_ac31_panel_depth_default_and_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('ac31');
  try {
    const before = tree(c.vault);
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await graphReady(c.log), 'the panel draws Plán\'s graph (graph-ready)');
    assert.ok(await textShown(d, '10 objects · click a node to preview', 3000), 'depth 1 by default');
    await popover(d);
    await (await needInGroup(d, 'Depth', '2')).click();
    assert.ok(await textShown(d, '19 objects · click a node to preview', 3000), 'depth 2: 19 objects');
    assert.ok(await waitFor(() => graphStateOf(c.sup, c.vault, 'panel')?.depth === 2, 3000), `ui-state.json: graph.panel.depth 2 (${JSON.stringify(uiStateOf(c.sup)?.vaults)})`);
    assert.equal(graphStateOf(c.sup, c.vault, 'full'), null, 'graph.full is not created');
    await quit(c);
    const d2 = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d2, '19 objects · click a node to preview', 5000), 'after a relaunch the panel restores depth 2');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file is written');
  } finally { await cleanupGraph(c); }
});

test('fr_grp_01_ac36_cmd_shift_g_uses_the_panel_when_it_shows_the_graph', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('ac36', { ui: {} });
  try {
    let d = await launchOn(c, noteRoute(PLAN));
    await popover(d);
    await (await needInGroup(d, 'Depth', '2')).click();
    assert.ok(await textShown(d, '19 objects · click a node to preview', 3000), 'the panel at depth 2');
    press('escape');
    press('g', ['command', 'shift']);
    assert.ok(await waitRoute(c.log, graphRoute(PLAN), 5000), '⌘⇧G opens graph/Pages/Plán čtvrtletí.md');
    assert.ok(await textShown(d, 'Local graph of Plán čtvrtletí · 19 objects', 3000), 'at the panel\'s depth 2 (R116 rule 3)');
    assert.equal(graphStateOf(c.sup, c.vault, 'full')?.depth ?? 1, 1, 'graph.full.depth is not written by the hand-over (D-1037)');
    await quit(c);
    d = await launchOn(c, noteRoute(PLAN));
    press('backslash', ['command']);
    await sleep(500);
    press('g', ['command', 'shift']);
    assert.ok(await waitRoute(c.log, graphRoute(PLAN), 5000), '⌘⇧G with the panel closed');
    assert.ok(await textShown(d, 'Local graph of Plán čtvrtletí · 10 objects', 3000), 'the full view\'s own depth 1 (R116 rule 4)');
  } finally { await cleanupGraph(c); }
});

test('fr_grp_01_ac39_panel_live_updates_within_two_seconds', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('ac39');
  try {
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 5000), 'Plán in the panel at depth 1');
    const osamela = join(c.vault, 'Pages/Osamělá.md');
    externalWrite(osamela, `${readFileSync(osamela, 'utf8').trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
    assert.ok(await textShown(d, '11 objects · click a node to preview', 2000), 'another program\'s edit adds Osamělá within 2 s (D-980)');
    assert.ok(await shown(d, 'Osamělá, Page', 1000), 'the node Osamělá');
  } finally { await cleanupGraph(c); }
});

test('fr_grp_01_ac42_panel_when_the_page_file_is_deleted', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('ac42');
  try {
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 5000), 'Plán in the panel');
    mkdirSync(join(c.vault, '.trash/Pages'), { recursive: true });
    external('rename', join(c.vault, PLAN), join(c.vault, '.trash', PLAN));
    assert.ok(await textShown(d, 'This object was deleted', 2000), 'the Deleted state within 2 s (D-1039)');
    assert.ok(await textShown(d, '“Plán čtvrtletí” is in the trash, so there is no graph to show.', 1000), 'the trash line');
    external('rename', join(c.vault, '.trash', PLAN), join(c.vault, PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 2000), 'restoring Plán brings its graph back within 2 s');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02, FR-NAV-05

test('fr_grp_02_ac10_panel_and_full_view_state_are_separate', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('g02ac10');
  try {
    let d = await launchOn(c, noteRoute(PLAN));
    await popover(d);
    await (await needStarting(d, 'Types', 'Tags')).click();
    assert.ok(await textShown(d, '8 objects · click a node to preview', 3000), 'Tags hidden in the panel');
    assert.ok(await waitFor(() => JSON.stringify(graphStateOf(c.sup, c.vault, 'panel')?.hiddenTypes) === '["tag"]', 3000), 'graph.panel.hiddenTypes ["tag"]');
    press('escape');
    await (await need(d, 'Open full view (⇧⌘G)', 3000)).click(); // AP-896: the shortcut as the registry renders it
    assert.ok(await waitRoute(c.log, graphRoute(PLAN), 5000), 'the full view');
    await (await needInGroup(d, 'Connections', 'Relations')).click();
    assert.ok(await waitFor(() => JSON.stringify(graphStateOf(c.sup, c.vault, 'full')?.hiddenKinds) === '["relation"]', 3000), 'graph.full.hiddenKinds ["relation"]');
    assert.equal(JSON.stringify(graphStateOf(c.sup, c.vault, 'panel')?.hiddenKinds ?? []), '[]', 'graph.panel keeps its kinds');
    await quit(c);
    d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '8 objects · click a node to preview', 5000), 'after a relaunch the panel still hides Tags');
    await quit(c);
    d = await launchOn(c, graphRoute(PLAN));
    assert.ok(await textShown(d, 'Local graph of Plán čtvrtletí · 10 objects', 5000), 'the full view with its own filters (Tags visible)');
    const rel = await needInGroup(d, 'Connections', 'Relations', 5000);
    assert.equal(String(await rel.getAttribute('value')), '0', 'and Relations still off there after the relaunch');
  } finally { await cleanupGraph(c); }
});

test('fr_nav_05_ac3_graph_tab_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshGraph('nav05ac3', { tab: 'backlinks' });
  try {
    const before = tree(c.vault);
    let d = await launchOn(c, noteRoute(PLAN));
    await (await need(d, 'Graph', 5000)).click();
    assert.ok(await textShown(d, '10 objects · click a node to preview', 3000), 'the Graph tab shows Plán\'s graph');
    assert.ok(await waitFor(() => uiStateOf(c.sup)?.rightPanel?.tab === 'graph', 3000), 'rightPanel.tab: graph stored');
    await popover(d);
    await (await needInGroup(d, 'Depth', '2')).click();
    assert.ok(await waitFor(() => graphStateOf(c.sup, c.vault, 'panel')?.depth === 2, 3000), 'graph.panel.depth 2 stored');
    await quit(c);
    d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '19 objects · click a node to preview', 5000), 'after quitting and relaunching: the Graph tab with Plán\'s graph at the stored depth');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the vault\'s files are byte-identical with unchanged mtimes');
  } finally { await cleanupGraph(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-39

test('fr_syn_06_ac39_panel_graph_tour_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshGraph('syn06ac39', { hub: true });
  try {
    const before = tree(c.vault);
    const uiBefore = lstatSync(join(c.sup, 'ui-state.json')).ino;
    const d = await launchOn(c, noteRoute(PLAN));
    assert.ok(await textShown(d, '10 objects · click a node to preview', 5000), 'Plán in the panel');
    await popover(d);
    for (const n of ['2', '3', '1']) await (await needInGroup(d, 'Depth', n)).click();
    for (const t of ['Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Cesty', 'Osoby', 'Projekty', 'Schůzky', 'Images', 'PDFs', 'Tags', 'recept']) {
      await (await needStarting(d, 'Types', t)).click();
      await (await needStarting(d, 'Types', t)).click();
    }
    for (const k of ['Links', 'Relations', 'Embeds', 'Tags']) { await (await needInGroup(d, 'Connections', k)).click(); await (await needInGroup(d, 'Connections', k)).click(); }
    await (await needInGroup(d, 'Types', 'None')).click();
    await (await need(d, 'Show all types')).click();
    await popover(d);
    for (const k of ['Links', 'Relations', 'Embeds', 'Tags']) await (await needInGroup(d, 'Connections', k)).click();
    await (await need(d, 'Show everything')).click();
    await popover(d);
    await (await needInGroup(d, 'Types', 'All')).click();
    await (await need(d, 'Size nodes by links')).click();
    await (await need(d, 'Size nodes by links')).click();
    press('escape');
    for (const node of ['Rozpočet 2027, Projekt', '#Účty, Tag', '#nápad, Tag', '2026-10-07, Daily Note', 'Graf výdajů, Image', 'Plán čtvrtletí, Page']) {
      await (await need(d, node)).click();
      await sleep(300);
    }
    await (await need(d, 'Rozpočet 2027, Projekt')).click();
    await (await need(d, 'In full graph')).click();
    assert.ok(await waitRoute(c.log, graphRoute(PLAN), 5000), '`In full graph`');
    press('lbracket', ['command']);
    await sleep(500);
    await (await need(d, 'Rozpočet 2027, Projekt', 5000)).doubleClick();
    assert.ok(await waitRoute(c.log, noteRoute('Projekty/Rozpočet 2027.md'), 5000), 'a double-click opens Rozpočet');
    press('lbracket', ['command']);
    await sleep(500);
    const sep = await need(d, 'Resize panel', 3000);
    await sep.click();
    for (let i = 0; i < 3; i++) press('left');
    await quit(c);
    for (const route of [noteRoute('Projekty/Rozpočet 2027.md'), 'daily/2026-10-07', noteRoute('Images/Graf výdajů.md'), noteRoute('Pages/Osamělá.md'), 'daily/2026-10-30', noteRoute('Pages/Hub/Rozcestník.md')]) {
      const di = await launchOn(c, route);
      await sleep(800);
      if (route.includes('Rozcestník')) {
        await popover(di);
        await (await needInGroup(di, 'Depth', '2')).click();
        press('escape');
        await (await need(di, 'Depth 1 · 41', 5000)).click();
        await sleep(500);
      }
      await quit(c);
    }
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'every vault file keeps its bytes, mtime and inode; no file or folder is created');
    for (const p of ['.tegg/graph.yml', 'Tags/nápad.md', 'Daily/2026-10-30.md']) assert.ok(!existsSync(join(c.vault, p)), `no ${p}`);
    assert.ok(graphStateOf(c.sup, c.vault, 'panel') !== null, 'ui-state.json holds the panel state');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, uiBefore, 'ui-state.json was replaced atomically (a new inode)');
  } finally { await cleanupGraph(c); }
});

