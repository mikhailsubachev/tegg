// Slice G1, L5 (WebKit + fake core): the full view after changes to the vault (docs/acceptance/graph.md; D-915,
// D-980, D-981, D-990): FR-GRP-01 AC-13 (the route and labels follow renames), AC-20 (live updates within 2 s, debounced,
// no redraw for an equal result), AC-21 (a selected node that disappears), AC-22 (the centre deleted, restored, gone),
// AC-23 (no links), AC-25 (index not ready, files that can't be read), FR-GRP-06 AC-5 (the preview column updates) and
// FR-GRP-08 AC-5 (tag colour changes). Changes come from "another program" through the fake core (`setFile`,
// `renameFile`, which emit `vault:changed`). Interface docs/contracts/v1-graph.md §3, §6, §8 and v1-previews.md §2
// (`index_path_by_id`). Written from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and
// node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, canvas, clickNode, depthBtn, drawn, drawnEdges, drawnKeys, eventually, fitBtn, flat, graphHeading, graphRoute, graphVault, headingIs,
  headingText, isDisabled, kindBox, main, mainText, must, nfc, nodeAt, nodePaint, opacity, openGraph, original, pairOf, positions, previewCol,
  routeReady, samePlaces, seen, sizeBox, sleep, startGraph, swap, tagNode, titleTab, tokenColour, typeBox, waitDrawn, zoomIn,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const LIVE = 2000;

/** Starts on the note at `path` and opens its graph with ⌘⇧G, so Back has somewhere to go. */
async function graphFromNote(page: Page, path: string = P.plan) {
  const core = await startGraph(page, { at: path });
  await sleep(500);
  await page.keyboard.press('Meta+Shift+g');
  await must(graphHeading(page), `the full view of ${path} (⌘⇧G)`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_grp_01_ac13_route_and_labels_follow_renames', async ({ page }) => {
  // History: note Shrnutí → graph of Shrnutí → (Center graph here on Plán) graph of Plán.
  const core = await graphFromNote(page, P.shrnuti);
  await clickNode(page, P.plan);
  await (await must(previewCol(page).getByRole('button', { name: 'Center graph here', exact: true }), 'Center graph here')).click();
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 3000), 'on Plán\'s graph');
  const edges0 = (await drawnEdges(page)).length;
  // Another program renames the centre (same id; the title follows the name, as a rename does).
  const q4 = 'Pages/Plán Q4.md';
  await core.renameFile(P.plan, q4);
  await core.setFile(q4, swap(original(P.plan), 'title: Plán čtvrtletí', 'title: Plán Q4'));
  assert.ok(await routeReady(core, graphRoute(q4), LIVE), 'the route follows to graph/Pages/Plán Q4.md within 2 s (index_path_by_id)');
  await must(titleTab(page, 'Graph · Plán Q4'), 'the tab title', LIVE);
  // D-1022: links resolve by path, id or file name, never by title (FR-LNK-14), so Recept's `[[Plán čtvrtletí]]` breaks
  // with the rename: 9 objects and one edge fewer; everything else stays.
  assert.ok(await headingIs(page, 'Local graph of Plán Q4 · 9 objects', LIVE), `heading: ${await headingText(page)}`);
  assert.equal((await drawnEdges(page)).length, edges0 - 1, 'the same edges but Recept\'s');
  assert.ok(!(await seen(page.getByText('This object was deleted'), 300)), 'a rename is never shown as deleted');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok((await eventually(() => headingText(page, 200), (t) => t.startsWith('Local graph of Shrnutí'), 3000)).startsWith('Local graph of Shrnutí'),
    'the entry was replaced: Back leads where it did before (Shrnutí\'s graph)');
});

test('fr_grp_01_ac13_route_and_labels_follow_renames_drawn_node_keeps_its_place', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await waitDrawn(page, 10);
  const before = await positions(page);
  // Shrnutí → Souhrn with every link to it updated (the outcome of Tegg's rename job, ms4-jobs).
  const files = await core.files();
  await core.renameFile(P.shrnuti, 'Pages/Souhrn.md');
  await core.setFile('Pages/Souhrn.md', swap(files[nfc(P.shrnuti)], 'title: Shrnutí', 'title: Souhrn'));
  for (const p of [P.plan, P.bez, P.chybna]) await core.setFile(p, files[nfc(p)].replace(/\[\[Shrnutí\]\]/g, '[[Souhrn]]'));
  const name = await eventually(async () => (await nodeAt(page, 'Pages/Souhrn.md').getAttribute('aria-label').catch(() => null)) ?? '', (n) => n.startsWith('Souhrn'), LIVE);
  assert.equal(name, 'Souhrn, Page', 'only its label changes, within 2 s');
  const after = await positions(page);
  const a = before[nfc(P.shrnuti)], b = after[nfc('Pages/Souhrn.md')];
  assert.ok(a && b && Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5, `its position stays (± 0.5 px): ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  assert.equal((await drawnKeys(page)).length, 10, 'the same nodes');
});

// ------------------------------------------------------------------------------------------------ AC-20

test('fr_grp_01_ac20_live_updates_within_two_seconds', async ({ page }) => {
  const core = await openGraph(page, P.plan, { realTime: true });
  await waitDrawn(page, 10);
  const p0 = await positions(page);
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
  const k = await waitDrawn(page, 11, LIVE);
  assert.ok(k.includes(nfc(P.osamela)), 'Osamělá is added at depth 1 within 2 s (D-980)');
  const p1 = await positions(page);
  assert.deepEqual(samePlaces(p0, p1, 0.5), [], 'the other nodes keep their positions (± 0.5 px)');
  const o = p1[nfc(P.osamela)], c = p1[nfc(P.plan)];
  assert.ok(o && c && Math.hypot(o.x - c.x, o.y - c.y) <= 100, 'Osamělá starts within 100 px of Plán');
  await core.setFile(P.rozpocet, swap(original(P.rozpocet), 'podklady: "[[Plán čtvrtletí]]"\n', ''));
  const e = await eventually(async () => pairOf(await drawnEdges(page), P.plan, P.rozpocet), (x) => x?.style === 'link', LIVE);
  assert.deepEqual([e?.kinds, e?.style], [['link'], 'link'], 'Plán–Rozpočet keeps {link}, style link');
  await core.setFile(P.plan, swap(original(P.plan), 'Cíle na čtvrtletí podle [[Rozpočet 2027]].', 'Cíle na čtvrtletí.'));
  const k2 = await eventually(() => drawnKeys(page), (x) => !x.includes(nfc(P.rozpocet)), LIVE);
  assert.ok(!k2.includes(nfc(P.rozpocet)), 'Rozpočet leaves depth 1 within 2 s');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', LIVE), '10 objects with Osamělá');
  const n0 = (await core.graphCalls()).length;
  const base = (await core.files())[nfc(P.plan)];
  for (let i = 0; i < 10; i++) { await core.setFile(P.plan, `${base.trimEnd()} ${i}\n`); await sleep(45); }
  await sleep(1200);
  assert.ok((await core.graphCalls()).length - n0 <= 3, `ten changes within 500 ms: at most 3 graph_neighbourhood calls (got ${(await core.graphCalls()).length - n0})`);
  const fresh = (await drawnKeys(page)).join('|');
  // D-1022: the fake core resets its files on a reload, so a fresh query is a new mount of the page (away and Back).
  await page.keyboard.press('Meta+Shift+i');
  await eventually(() => drawnKeys(page), (k) => k.length === 0, 3000);
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 5000);
  assert.equal((await drawnKeys(page)).join('|'), fresh, 'the final graph equals a fresh query');
  const before = await positions(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__graphMutations = 0;
    const svg = document.querySelector('main [data-graph-node]')?.closest('svg');
    if (svg) new MutationObserver((m) => { w.__graphMutations += m.length; }).observe(svg, { subtree: true, attributes: true, childList: true });
  });
  await core.setFile(P.nakup, `${original(P.nakup).trimEnd()} Ještě máslo.\n`);
  await sleep(1000);
  assert.deepEqual(samePlaces(before, await positions(page), 0), [], 'an equal result: no node moves');
  assert.equal(await page.evaluate(() => (window as any).__graphMutations), 0, 'and no redraw');
});

// ------------------------------------------------------------------------------------------------ AC-21

test('fr_grp_01_ac21_selected_node_removed_clears_selection', async ({ page }) => {
  const core = await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  await clickNode(page, P.shrnuti);
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.shrnuti)}"]`), 'Shrnutí previewed');
  await core.renameFile(P.shrnuti, '.trash/Pages/Shrnutí.md');
  const k = await waitDrawn(page, 15, LIVE);
  assert.equal(k.length, 15, '15 objects within 2 s');
  for (const gone of [P.shrnuti, P.bez, P.chybna, 'tag:archiv']) assert.ok(!k.includes(nfc(gone)), `${gone} removed`);
  assert.ok(!(await drawn(page)).some((n) => n.selected), 'no data-selected');
  for (const key of k) assert.equal(await eventually(() => opacity(page, key), (x) => x === 1, 1000), 1, `${key} at full opacity`);
  await must(previewCol(page).getByText('Click a node to preview it', { exact: true }), 'the column\'s empty state');
});

// ------------------------------------------------------------------------------------------------ AC-22

async function deletedControls(page: Page) {
  for (const [what, loc] of [['depth 2', depthBtn(page, 2)], ['Pages', typeBox(page, 'Pages')], ['Links', kindBox(page, 'Links')], ['Zoom in', zoomIn(page)], ['Fit', fitBtn(page)]] as const) {
    assert.equal(await isDisabled(loc), true, `${what} aria-disabled`);
  }
}

test('fr_grp_01_ac22_centre_deleted_state', async ({ page }) => {
  const core = await graphFromNote(page, P.shrnuti);
  await core.renameFile(P.shrnuti, '.trash/Pages/Shrnutí.md');
  const live = page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: 'This object was deleted' });
  await must(live, '`This object was deleted` in a live region within 2 s', LIVE);
  assert.ok((await mainText(page)).includes('“Shrnutí” is in the trash, so there is no graph to show.'), 'the trash text (D-981)');
  await must(main(page).getByRole('button', { name: 'Back', exact: true }), '`Back`');
  assert.equal(await main(page).locator('[data-graph-node]').count(), 0, 'no node remains');
  await deletedControls(page);
  await core.renameFile('.trash/Pages/Shrnutí.md', P.shrnuti);
  assert.ok(await headingIs(page, 'Local graph of Shrnutí · 5 objects', LIVE) || (await waitDrawn(page, 5, LIVE)).length === 5, 'restoring brings the graph back within 2 s');
  await core.setFile(P.shrnuti, null);
  await must(page.getByText('“Shrnutí” no longer exists, so there is no graph to show.'), 'deleted outright: the gone text', LIVE);
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await eventually(async () => !(await seen(page.getByText('This object was deleted'), 100)), (x) => x, 3000), '⌘[ returns to the previous route');
});

test('fr_grp_01_ac22_centre_deleted_state_plan_in_trash', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await core.renameFile(P.plan, '.trash/Pages/Plán čtvrtletí.md');
  await must(page.getByText('“Plán čtvrtletí” is in the trash, so there is no graph to show.'), 'Plán in the trash within 2 s', LIVE);
  await must(page.getByText('This object was deleted', { exact: true }), 'the heading of the state');
  await deletedControls(page);
});

test('fr_grp_01_ac22_centre_deleted_state_missing_path', async ({ page }) => {
  await startGraph(page, { route: 'graph/Pages/Neexistuje.md' });
  await must(page.getByText('“Neexistuje” no longer exists, so there is no graph to show.'), 'a missing path: the gone text with the stem', 8000);
  await must(main(page).getByRole('button', { name: 'Back', exact: true }), '`Back`');
});

// ------------------------------------------------------------------------------------------------ AC-23

test('fr_grp_01_ac23_no_links_state', async ({ page }) => {
  const core = await openGraph(page, P.osamela);
  assert.deepEqual(await waitDrawn(page, 1), [nfc(P.osamela)], 'only Osamělá');
  assert.ok((await mainText(page)).includes('No links yet'), '`No links yet`');
  await must(main(page).getByRole('group', { name: 'Local graph: Osamělá has no links', exact: true }), 'the canvas name');
  assert.equal((await drawnEdges(page)).length, 0, 'no edge');
  for (const [what, loc] of [['depth 2', depthBtn(page, 2)], ['Pages', typeBox(page, 'Pages')], ['Links', kindBox(page, 'Links')], ['Size nodes by links', sizeBox(page)]] as const) {
    assert.equal(await isDisabled(loc), true, `${what} aria-disabled (D-991)`);
  }
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()} A [[Shrnutí]].\n`);
  assert.deepEqual(await waitDrawn(page, 2, LIVE), [P.osamela, P.shrnuti].map(nfc).sort(), 'the graph of Osamělá and Shrnutí within 2 s');
  assert.equal(await isDisabled(depthBtn(page, 2)), false, 'controls enabled');
});

// ------------------------------------------------------------------------------------------------ AC-25

test('fr_grp_01_ac25_indexing_and_unreadable_files', async ({ page }) => {
  const core = await startGraph(page, { at: P.shrnuti });
  await sleep(500);
  await core.graphNotReady(true);
  await page.keyboard.press('Meta+Shift+g');
  await must(page.getByRole('status').filter({ hasText: 'Building the graph…' }), 'the loading state while the index is built (D-990)', 3000);
  await core.graphNotReady(false);
  await core.emit('index:progress', { done: 26, total: 26, state: 'done' });
  await core.emit('index:progress', { done: 26, total: 26, state: 'ready' });
  assert.equal((await waitDrawn(page, 5, 3000)).length, 5, 'drawn once the index is ready, without a reload');
  const ch = (await drawn(page)).find((n) => n.key === nfc(P.chybna));
  assert.equal(ch?.name, 'Chybná hlavička, Page', 'Chybná: a Page node with its stem title');
  assert.ok(pairOf(await drawnEdges(page), P.chybna, P.shrnuti), 'and its link to Shrnutí');
  const bytes = new Uint8Array([...new TextEncoder().encode('Odkaz na [[Shrnutí]] a vadné bajty: '), 0xff, 0xfe, 0xc3, 0x2e, 0x0a]);
  await core.setFile('Pages/Vadný soubor.md', bytes);
  const k = await eventually(() => drawn(page), (n) => n.some((x) => x.key === nfc('Pages/Vadný soubor.md')), LIVE);
  assert.equal(k.find((x) => x.key === nfc('Pages/Vadný soubor.md'))?.name, 'Vadný soubor, Page', 'invalid UTF-8: a node with its stem title');
  assert.ok(!(await seen(page.getByRole('alertdialog'), 300)), 'no error dialog');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-5, FR-GRP-08 AC-5

test('fr_grp_06_ac5_preview_column_updates_live', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await clickNode(page, P.rozpocet);
  await must(previewCol(page).getByText('Rozpočet na příští rok.'), 'Rozpočet previewed');
  await core.setFile(P.rozpocet, swap(original(P.rozpocet), 'Rozpočet na příští rok.', 'Rozpočet na rok 2027.'));
  await must(previewCol(page).getByText('Rozpočet na rok 2027.'), 'the body updates within 2 s', LIVE);
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()} [[Rozpočet 2027]]\n`);
  const t = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('Projekt · 7 connections'), LIVE);
  assert.ok(t.includes('Projekt · 7 connections'), 'the connections line updates within 2 s');
});

test('fr_grp_08_ac5_tag_colour_changes_are_live', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await must(tagNode(page, 'účty'), '#Účty');
  const green = async () => (await nodePaint(page, 'tag:účty'))?.fill === (await tokenColour(page, 'type-green-bg'));
  await core.setFile(P.fUcty, swap(original(P.fUcty), 'color: blue', 'color: green'));
  assert.ok(await eventually(green, (x) => x, LIVE), 'another program\'s `color: green` shows the pill green within 2 s');
  await core.setFile(P.fUcty, swap(original(P.fUcty), 'color: blue\n', ''));
  assert.ok(await eventually(async () => (await nodePaint(page, 'tag:účty'))?.fill === (await tokenColour(page, 'hover')), (x) => x, LIVE), 'removing `color` makes it neutral');
  await core.setFile(P.fUcty, original(P.fUcty));
  await clickNode(page, 'tag:účty', { double: true });
  assert.ok(await routeReady(core, `tag/${encodeURIComponent('účty')}`, 4000) || await routeReady(core, 'tag/účty', 100), 'on tag/účty');
  await (await must(page.getByRole('button', { name: 'Tag colour', exact: true }), 'Tag colour (FR-TAG-05 AC-1)')).click();
  // D-1022: the tag page's colour choices are radio buttons (tags.md, TagDialogs).
  await (await must(page.getByRole('menuitemradio', { name: 'Green', exact: true }).or(page.getByRole('option', { name: 'Green', exact: true })).or(page.getByRole('radio', { name: 'Green', exact: true })), 'Green')).click();
  await page.keyboard.press('Meta+BracketLeft');
  await must(canvas(page), 'back on the graph', 4000);
  assert.ok(await eventually(green, (x) => x, LIVE), 'the pill is green after choosing Green on the tag page');
});
