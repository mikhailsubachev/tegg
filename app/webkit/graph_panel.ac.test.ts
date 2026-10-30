// Slice G2, L5 (WebKit + fake core): the local graph in the right panel (docs/acceptance/graph-panel.md R114…R117): the
// Graph tab on every route (FR-GRP-01 AC-28, AC-29), the centre following the page (AC-30), depth and the 60 cap
// (AC-31…AC-33), the hand-over to the full view (AC-34…AC-36), the R115 states (AC-37, AC-38), size, width and labels
// (AC-43), Czech names (AC-44), the popover and filters (FR-GRP-02 AC-7…AC-10), click and double-click (FR-GRP-03
// AC-6…AC-9), icons and colours (FR-GRP-05 AC-5), the node preview beside the panel (FR-GRP-06 AC-6…AC-8), node sizes
// (FR-GRP-07 AC-4), tag pills (FR-GRP-08 AC-6), `Show local graph` and the remembered tab (FR-NAV-05 AC-2, AC-3), no
// writes (FR-SYN-06 AC-39, L5 part), commands (FR-UX-03 AC-21) and strings (NFR-OTH-02 AC-13). Interface
// docs/contracts/v1-graph.md §15 (on §1…§8; fake core `graphCalls`, `graphDelay`, `graphNotReady`) and v1-previews.md
// §3 (the popover). Fixture tests/fixtures/vaults/graph (its README, "Panel (G2)", and the hub of make-hub.mjs). Written
// from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and node:assert, so a missing
// element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { description } from './capture-helpers';
import { anyPreviewDialog, mustPreview, previewDialog, pseudoLocale } from './helpers';
import { colourTile, swatch } from './tags-helpers';
import {
  NFD, READMEROWS, VAULT_PATH, callsOf, checked, click, clickEmpty, clickNode, depthBtn, drawn, drawnEdges, drawnKeys, edgeStyle, eventually, flat,
  fullState, graphHeading, graphVault, headingIs, headingText, isDisabled, mainName, marks, must, nfc, nodeAt, nodeOf, nodePaint, opacity, pairOf,
  positions, pressed, previewCol, routeReady, runCommand, samePlaces, seen, sleep, tagNode, tokenColour, typeBox, kindBox, typeRows, waitDrawn,
} from './graph-helpers';
import {
  FILTERS_NOTE, GP, P, VIEWPORT, anyLowerBtn, backlinksTab, chooseDepth, circleSizes, closePopover, ctxPanel, depthRadio, depthRadios, footerIs,
  footerText, graphOpenKeys, graphPanel, graphTab, labelsShown, lowerBtn, navCount, nodeGeometry, noteRoute, openFullBtn, openPanel, openPopover,
  panelStored, panelText, pAll, pCanvas, pKindBox, pKinds, pNone, popover, pSizeBox, pTypeBox, pTypes, requests, searchOpen, startPanel, stateOpenFull,
  tagRoute, trigger, triggerIs, triggerText, uiSetCount,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

/** Plán at depth 1 (fixture README): 10 nodes. */
const D1 = [P.plan, P.rozpocet, P.zapis, P.shrnuti, P.graf, P.ukol, P.den, 'tag:účty', 'tag:nápad', P.recept].map(nfc).sort();
/** Rozpočet at depth 1: 7 nodes. */
const ROZ1 = [P.rozpocet, P.plan, P.jana, P.vydaje, 'tag:účty', 'tag:finance', P.zapis].map(nfc).sort();
/** Plán at depth 1: E1–E9, E12, E16 with their R108 styles. */
const EDGES_D1: [string, string, string][] = [
  [P.plan, P.rozpocet, 'relation'], [P.plan, P.zapis, 'link'], [P.plan, P.shrnuti, 'embed'], [P.plan, P.graf, 'embed'], [P.plan, P.ukol, 'embed'],
  [P.plan, P.den, 'link'], [P.plan, 'tag:účty', 'tag'], [P.plan, 'tag:nápad', 'tag'], [P.recept, P.plan, 'link'], [P.rozpocet, 'tag:účty', 'tag'],
  [P.zapis, P.rozpocet, 'embed'],
];
const keysIn = (page: Page) => drawnKeys(page, GP(page));
const waitIn = (page: Page, n: number, ms = 3000) => waitDrawn(page, n, ms, GP(page));
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
const lastReq = async (core: Awaited<ReturnType<typeof openPanel>>) => (await requests(core)).at(-1);
const selectedIn = async (page: Page) => (await drawn(page, GP(page))).filter((n) => n.selected).map((n) => n.key);
const graphMarks = async (core: Awaited<ReturnType<typeof openPanel>>, path: string) => (await marks(core)).map(nfc).filter((m) => m === `route-ready:graph/${nfc(path)}`).length;
const LIVE = 2000;

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-28, AC-29

test('fr_grp_01_ac28_panel_graph_tab_on_a_note', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await must(GP(page).getByRole('group', { name: 'Local graph: Plán čtvrtletí and the objects linked to it, 1 level deep', exact: true }), 'the canvas named per R109');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, D1), 3000), D1, 'exactly G1\'s depth-1 result: 10 nodes');
  const all = await drawnEdges(page, GP(page));
  assert.equal(all.length, 11, `11 edges (got ${all.length})`);
  for (const [a, b, style] of EDGES_D1) assert.equal(pairOf(all, a, b)?.style, style, `${a} – ${b}: ${style}`);
  assert.equal(await triggerText(page), 'Depth 1', 'the trigger reads `Depth 1`');
  assert.equal(await footerText(page), '10 objects · click a node to preview', 'the footer');
  assert.equal(await labelsShown(page), 10, 'every label is shown (R114)');
  assert.deepEqual(await lastReq(core), { centre: nfc(P.plan), depth: 1, hiddenTypes: [], hiddenKinds: [], cap: 60, showAll: false }, 'the request (§15.1)');
  assert.equal(await navCount(core), 0, 'showing it calls nav_opened zero times');
});

for (const [route, keys, edgesN, footer] of [
  ['daily/2026-10-07', [P.den, P.plan, P.nakup], 2, '3 objects · click a node to preview'],
  [noteRoute(P.graf), [P.graf, P.plan], 1, '2 objects · click a node to preview'],
  [noteRoute(P.bez), [P.bez, P.shrnuti], 1, '2 objects · click a node to preview'],
  [noteRoute(P.chybna), [P.chybna, P.shrnuti], 1, '2 objects · click a node to preview'],
] as const) {
  test(`fr_grp_01_ac29_panel_graph_on_each_route_${route.replace(/[^a-z0-9-]+/gi, '_')}`, async ({ page }) => {
    await startPanel(page, route);
    const want = keys.map(nfc).sort();
    assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, want), 5000), want, `${route}: ${want.join(', ')}`);
    const e = await drawnEdges(page, GP(page));
    assert.equal(e.length, edgesN, `${route}: ${edgesN} edge(s)`);
    if (route.includes('Graf')) assert.equal(pairOf(e, P.graf, P.plan)?.style, 'embed', 'the embed edge');
    if (route.includes('hlavi')) assert.equal(e[0]?.style, 'link', 'one link edge to Shrnutí');
    assert.equal(await footerText(page), footer, `${route}: footer`);
  });
}

for (const route of ['daily/2026-10-30', 'new/page']) {
  test(`fr_grp_01_ac29_panel_graph_on_each_route_no_file_${route.replace(/[^a-z0-9-]+/gi, '_')}`, async ({ page }) => {
    const core = await startPanel(page, route);
    await must(GP(page).getByText('The graph appears once this note is saved.', { exact: true }), `${route}: the No file state (R115, D-1038)`, 5000);
    assert.equal((await drawn(page, GP(page))).length, 0, 'no node');
    assert.equal(await isDisabled(trigger(page)), true, 'the trigger is aria-disabled');
    assert.equal(await isDisabled(openFullBtn(page)), true, '`Open full view` is aria-disabled');
    await sleep(600);
    assert.equal((await core.graphCalls()).length, 0, 'no graph_neighbourhood call');
  });
}

for (const route of [tagRoute('účty'), tagRoute('nápad'), `graph/${nfc(P.plan)}`, 'search', 'tasks', 'type/page']) {
  test(`fr_grp_01_ac29_panel_graph_on_each_route_no_panel_on_${route.replace(/[^a-z0-9-]+/gi, '_')}`, async ({ page }) => {
    await startPanel(page, route);
    await sleep(800);
    assert.ok(!(await seen(ctxPanel(page), 300)), `${route}: no right panel (D-127, D-1040)`);
    await page.keyboard.press('Meta+Backslash');
    await sleep(300);
    assert.ok(!(await seen(ctxPanel(page), 300)), `${route}: ⌘\\ does nothing (D-988)`);
    // Control: the same start on a note shows the panel's Graph tab.
    const p2 = await page.context().newPage();
    await openPanel(p2, P.plan);
    assert.ok(await seen(pCanvas(p2), 3000), 'control: the panel shows on a note');
    await p2.close();
  });
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-30

test('fr_grp_01_ac30_panel_centre_follows_navigation', async ({ page }) => {
  const core = await openPanel(page, P.plan, { realTime: true });
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, D1), 3000), D1, 'Plán\'s 10 nodes');
  const planPos = await positions(page, GP(page));
  await clickNode(page, P.zapis, {}, GP(page));
  await searchOpen(page, 'Rozpočet 2027');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, ROZ1), LIVE), ROZ1, 'redrawn around Rozpočet within 2 s');
  assert.ok(await footerIs(page, '7 objects · click a node to preview'), `footer: ${await footerText(page)}`);
  assert.deepEqual(await selectedIn(page), [], 'nothing is selected after a navigation');
  await page.keyboard.press('Meta+BracketLeft');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, D1), LIVE), D1, 'Back: Plán\'s 10 nodes');
  assert.deepEqual(samePlaces(planPos, await positions(page, GP(page)), 0.01), [], 'the same centre again: the same seeded layout (± 0.01 px)');
  assert.deepEqual(await selectedIn(page), [], 'nothing selected after Back');
  await page.keyboard.press('Meta+BracketRight');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, ROZ1), LIVE), ROZ1, 'Forward: Rozpočet\'s 7');
  // The answer for Plán arrives after 800 ms; going Forward to Rozpočet before it draws only Rozpočet.
  await page.keyboard.press('Meta+BracketLeft');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, D1), LIVE), D1, 'Back on Plán');
  await page.keyboard.press('Meta+BracketRight');
  await eventually(() => keysIn(page), (k) => same(k, ROZ1), LIVE);
  await core.graphDelay(800);
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(100);
  await page.keyboard.press('Meta+BracketRight');
  const seenSets: string[] = [];
  const end = Date.now() + 2500;
  while (Date.now() < end) { seenSets.push((await keysIn(page)).join('|')); await sleep(25); }
  assert.ok(!seenSets.includes(D1.join('|')), 'the late answer for Plán is never drawn (one request per window)');
  assert.deepEqual(await keysIn(page), ROZ1, 'only Rozpočet\'s graph');
  await core.graphDelay(0);
  // Depth belongs to the panel: depth 2 on Rozpočet, then Back draws Plán at depth 2.
  await chooseDepth(page, 2);
  await closePopover(page);
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal((await waitIn(page, 19, LIVE)).length, 19, 'Back: Plán at the panel\'s depth 2 (D-906)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-31

test('fr_grp_01_ac31_panel_depth_default_and_remembered', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  assert.equal(await triggerText(page), 'Depth 1', 'no graph entry: depth 1 (D-905)');
  await openPopover(page);
  assert.equal(await depthRadio(page, 1).getAttribute('aria-checked'), 'true', 'radio 1 checked');
  const n0 = await uiSetCount(core);
  await chooseDepth(page, 2, 19);
  assert.equal((await drawnEdges(page, GP(page))).length, 21, '21 edges at depth 2');
  assert.ok(await triggerIs(page, 'Depth 2'), `trigger: ${await triggerText(page)}`);
  assert.equal(await footerText(page), '19 objects · click a node to preview', 'footer');
  await sleep(300);
  assert.equal((await uiSetCount(core)) - n0, 1, 'one ui_state_set for the change');
  assert.equal((await panelStored(core))?.depth, 2, 'vaults[<vault>].graph.panel.depth = 2');
  assert.equal(await fullState(core), null, 'graph.full is not written or created');
  await closePopover(page);
  await searchOpen(page, 'Rozpočet 2027');
  assert.ok(await triggerIs(page, 'Depth 2'), 'the next note opens at depth 2 in the panel');
  const r = await eventually(() => lastReq(core), (x) => x?.centre === nfc(P.rozpocet), 3000);
  assert.equal(r?.depth, 2, 'its request has depth 2');
  await page.keyboard.press('Meta+BracketLeft');
  await waitIn(page, 19, LIVE);
  await click(backlinksTab(page), 'tab "Backlinks"');
  await runCommand(page, 'Open graph');
  await must(graphHeading(page), 'the full view from the palette', 5000);
  assert.equal(await pressed(depthBtn(page, 1)), 'true', 'the full view still starts at depth 1 (R116 rule 4)');
});

test('fr_grp_01_ac31_panel_depth_default_and_remembered_depth_three', async ({ page }) => {
  await openPanel(page, P.plan);
  await chooseDepth(page, 3, 22);
  assert.equal((await drawnEdges(page, GP(page))).length, 25, 'depth 3: 25 edges');
});

for (const bad of [7, 'dva', null, 0]) {
  test(`fr_grp_01_ac31_panel_depth_default_and_remembered_invalid_${String(bad)}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { panel: { depth: bad } });
    assert.ok(await triggerIs(page, 'Depth 1'), `a stored panel depth ${JSON.stringify(bad)} reads as 1`);
    assert.equal((await waitIn(page, 10)).length, 10, '10 nodes');
    await sleep(400);
    assert.equal(await uiSetCount(core), 0, 'and isn\'t rewritten');
  });
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-32, AC-33

test('fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer', async ({ page }) => {
  const core = await openPanel(page, P.rozcestnik, { vault: graphVault({ hub: true }) });
  assert.equal((await waitIn(page, 41, 8000)).length, 41, 'depth 1: all 41 nodes');
  assert.equal((await drawnEdges(page, GP(page))).length, 40, '40 edges');
  assert.equal(await labelsShown(page), 41, 'each with its label');
  await chooseDepth(page, 2);
  await closePopover(page);
  await must(GP(page).getByText('Too many to show here', { exact: true }), 'Too many (R115)', 5000);
  assert.equal(await eventually(async () => (await drawn(page, GP(page))).length, (n) => n === 0, 2000), 0, 'nothing drawn');
  assert.ok((await panelText(page)).includes('161 objects at depth 2'), `\`161 objects at depth 2\`: ${await panelText(page)}`);
  await must(lowerBtn(page, 1, 41), '`Depth 1 · 41`');
  await must(stateOpenFull(page), '`Open full view`');
  assert.equal(await footerText(page, 300), '', 'no footer');
  const r = await lastReq(core);
  assert.deepEqual([r?.depth, r?.cap, r?.showAll], [2, 60, false], 'the request had cap 60');
  await chooseDepth(page, 3);
  await closePopover(page);
  assert.ok(await eventually(() => panelText(page), (t) => t.includes('1,361 objects at depth 3'), 5000).then((t) => t.includes('1,361 objects at depth 3')), '`1,361 objects at depth 3`');
  await must(lowerBtn(page, 1, 41), 'still `Depth 1 · 41` (depth 2 doesn\'t fit either, D-1033)');
  assert.equal(await anyLowerBtn(page).count(), 1, 'one offer');
});

for (const [path, depth, text, offer] of [
  ['Pages/Hub/Uzel 01-a.md', 3, '231 objects at depth 3', [2, 21]],
  ['Pages/Hub/Paprsek 01.md', 2, '74 objects at depth 2', [1, 5]],
  [P.siroky, 1, '161 objects at depth 1', null],
] as const) {
  test(`fr_grp_01_ac32_panel_cap_sixty_and_lower_depth_offer_${path.replace(/[^a-z0-9]+/gi, '_')}`, async ({ page }) => {
    await openPanel(page, path, { vault: graphVault({ hub: true }), panel: { depth } });
    await must(GP(page).getByText('Too many to show here', { exact: true }), `${path} at depth ${depth}: Too many`, 8000);
    assert.ok((await panelText(page)).includes(text), `${text}: ${await panelText(page)}`);
    if (offer) await must(lowerBtn(page, offer[0], offer[1]), `\`Depth ${offer[0]} · ${offer[1]}\``);
    else assert.equal(await anyLowerBtn(page).count(), 0, 'no lower depth fits: no offer');
    await must(stateOpenFull(page), '`Open full view`');
  });
}

test('fr_grp_01_ac33_panel_offer_lower_depth_and_full_view', async ({ page, browser }) => {
  const vault = graphVault({ hub: true });
  const core = await openPanel(page, 'Pages/Hub/Uzel 01-a.md', { vault, panel: { depth: 3 } });
  await click(lowerBtn(page, 2, 21), '`Depth 2 · 21`', 8000);
  assert.equal((await waitIn(page, 21, 5000)).length, 21, '21 nodes');
  assert.equal((await drawnEdges(page, GP(page))).length, 21, '21 edges');
  assert.equal(await eventually(async () => (await panelStored(core))?.depth, (d) => d === 2, 2000), 2, 'graph.panel.depth: 2 stored');
  const p2 = await browser.newPage();
  const c2 = await openPanel(p2, P.rozcestnik, { vault, panel: { depth: 2 } });
  await click(stateOpenFull(p2), '`Open full view`', 8000);
  assert.ok(await routeReady(c2, `graph/${nfc(P.rozcestnik)}`, 6000), 'graph/Pages/Hub/Rozcestník.md');
  assert.ok(await headingIs(p2, 'Local graph of Rozcestník · 150 of 161 objects', 6000), `at depth 2, G1's 150-node view: ${await headingText(p2)}`);
  assert.equal(await pressed(depthBtn(p2, 2)), 'true', 'depth 2 pressed');
  await p2.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(p2), (n) => n === 'Rozcestník', 4000), 'Rozcestník', 'Back: the note (a new history entry)');
  await must(GP(p2).getByText('Too many to show here', { exact: true }), 'the panel on Graph at depth 2 with Too many', 5000);
  assert.equal(await triggerText(p2), 'Depth 2', 'depth 2');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-34…AC-36

async function caret(page: Page): Promise<{ t: string; o: number } | null> {
  return page.evaluate(() => {
    const s = getSelection();
    return s && s.anchorNode ? { t: (s.anchorNode.textContent ?? '').normalize('NFC'), o: s.anchorOffset } : null;
  });
}

test('fr_grp_01_ac34_panel_to_full_view_takes_depth_not_filters', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2, hiddenTypes: ['tag'] }, full: { depth: 1 } });
  assert.equal((await waitIn(page, 14)).length, 14, 'the panel at depth 2 with Tags hidden: 14 nodes');
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note body');
  await body.click({ position: { x: 60, y: 10 } });
  await page.keyboard.press('End');
  const c0 = await caret(page);
  const keys = await graphOpenKeys(page);
  await click(GP(page).getByRole('button', { name: `Open full view (${keys})`, exact: true }), `\`Open full view (${keys})\` (rendered from the registry)`);
  assert.ok(await routeReady(core, `graph/${nfc(P.plan)}`, 5000), 'graph/Pages/Plán čtvrtletí.md');
  assert.equal(await pressed(depthBtn(page, 2)), 'true', '`2` pressed: the panel\'s depth');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 19 objects', 4000), `19 objects: ${await headingText(page)}`);
  assert.equal(await checked(typeBox(page, 'Tags')), true, 'Tags visible: the panel\'s filters are not copied');
  await sleep(300);
  assert.equal((await fullState(core))?.depth, 1, 'graph.full.depth stays 1 (D-1037)');
  assert.deepEqual(await panelStored(core), { depth: 2, hiddenTypes: ['tag'] }, 'graph.panel unchanged');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back: note/Pages/Plán čtvrtletí.md');
  assert.equal((await waitIn(page, 14, 3000)).length, 14, 'the panel on Graph at depth 2 with Tags hidden');
  assert.ok(await triggerIs(page, 'Depth 2 · 5 hidden'), `trigger: ${await triggerText(page)}`);
  assert.deepEqual(await selectedIn(page), [], 'nothing selected');
  assert.deepEqual(await eventually(() => caret(page), (c) => JSON.stringify(c) === JSON.stringify(c0), 2000), c0, 'its caret is restored');
  await page.keyboard.press('Meta+BracketRight');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 19 objects', 4000), 'Forward: the full view at depth 2 again');
  assert.equal(await pressed(depthBtn(page, 2)), 'true', 'depth 2 on that entry');
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000);
  await page.keyboard.press('Meta+Backslash');
  assert.ok(!(await seen(ctxPanel(page), 800)), 'the panel closed');
  await runCommand(page, 'Open graph');
  await must(graphHeading(page), 'the full view by the palette', 5000);
  assert.equal(await pressed(depthBtn(page, 1)), 'true', 'with the panel closed it starts at the full view\'s depth 1');
});

/** Opens the full view from the panel `how`, and waits for a new `route-ready:graph/<Plán>`. */
async function handOver(page: Page, core: Awaited<ReturnType<typeof openPanel>>, how: 'inFullGraph' | 'button' | 'key', title?: string) {
  const n = await graphMarks(core, P.plan);
  if (how === 'inFullGraph') await click(previewDialog(page, title!).getByRole('button', { name: 'In full graph', exact: true }), '`In full graph` in the preview');
  if (how === 'button') await click(openFullBtn(page), '`Open full view`');
  if (how === 'key') await page.keyboard.press('Meta+Shift+g');
  const got = await eventually(() => graphMarks(core, P.plan), (x) => x > n, 5000);
  assert.ok(got > n, `${how}: opens graph/Pages/Plán čtvrtletí.md`);
  await must(graphHeading(page), 'the full view', 4000);
}
async function backToNote(page: Page) {
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on the note');
  await waitIn(page, 10, 4000);
}

test('fr_grp_01_ac35_panel_selection_handed_to_the_full_view', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  for (const how of ['inFullGraph', 'button', 'key'] as const) {
    await clickNode(page, P.rozpocet, {}, GP(page));
    await mustPreview(page, 'Rozpočet 2027', `${how}: Rozpočet previewed`);
    await handOver(page, core, how, 'Rozpočet 2027');
    const sel = await eventually(async () => (await drawn(page)).filter((n) => n.selected).map((n) => n.key), (s) => s.length > 0, 3000);
    assert.deepEqual(sel, [nfc(P.rozpocet)], `${how}: Rozpočet is data-selected in the full view`);
    const col = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (t) => t.includes('Projekt · 6 connections'), 3000);
    assert.ok(col.includes('Projekt · 6 connections'), `${how}: the Preview column shows Rozpočet: ${col}`);
    await backToNote(page);
    assert.deepEqual(await selectedIn(page), [], `${how}: Back shows the panel with nothing selected`);
  }
  await clickNode(page, 'tag:nápad', {}, GP(page));
  await handOver(page, core, 'button');
  const tag = await eventually(async () => (await drawn(page)).filter((n) => n.selected).map((n) => n.key), (s) => s.length > 0, 3000);
  assert.deepEqual(tag, ['tag:nápad'], 'the #nápad pill is selected in the full view');
  assert.equal(await core.writes(), 0, 'a virtual tag: nothing written');
  assert.equal((await core.files())['Tags/nápad.md'], undefined, 'no Tags/nápad.md');
  await backToNote(page);
  await handOver(page, core, 'button');
  await sleep(500);
  assert.deepEqual((await drawn(page)).filter((n) => n.selected).map((n) => n.key), [], 'nothing selected in the panel: nothing selected in the full view');
});

test('fr_grp_01_ac35_panel_selection_handed_to_the_full_view_hidden_there', async ({ page }) => {
  const core = await openPanel(page, P.plan, { full: { hiddenTypes: ['projekt'] } });
  await clickNode(page, P.rozpocet, {}, GP(page));
  await mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
  await handOver(page, core, 'button');
  await sleep(500);
  assert.deepEqual((await drawn(page)).filter((n) => n.selected).map((n) => n.key), [], 'a node the full view doesn\'t draw is not selected (D-1037)');
  await must(previewCol(page).getByText('Click a node to preview it', { exact: true }), 'the column\'s empty state');
});

test('fr_grp_01_ac36_cmd_shift_g_uses_the_panel_when_it_shows_the_graph', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2 }, full: { depth: 1 } });
  await waitIn(page, 19);
  const back = async () => {
    await page.keyboard.press('Meta+BracketLeft');
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on the note');
  };
  const opened = async (how: string, want: 1 | 2) => {
    await must(graphHeading(page), `${how}: the full view`, 5000);
    assert.equal(await pressed(depthBtn(page, want)), 'true', `${how}: depth ${want}`);
  };
  await page.keyboard.press('Meta+Shift+g');
  await opened('⌘⇧G with the panel on Graph', 2);
  await back();
  await waitIn(page, 19, 4000);
  await runCommand(page, 'Open graph');
  await opened('`Open graph` with the panel on Graph', 2);
  await back();
  await click(backlinksTab(page), 'tab "Backlinks"');
  await page.keyboard.press('Meta+Shift+g');
  await opened('⌘⇧G with the panel on Backlinks', 1);
  await back();
  await page.keyboard.press('Meta+Backslash');
  assert.ok(!(await seen(ctxPanel(page), 800)), 'the panel closed');
  await page.keyboard.press('Meta+Shift+g');
  await opened('⌘⇧G with the panel closed', 1);
  assert.equal((await fullState(core))?.depth, 1, 'graph.full.depth stays 1');
});

for (const route of ['new/page', 'daily/2026-10-30']) {
  test(`fr_grp_01_ac36_cmd_shift_g_uses_the_panel_when_it_shows_the_graph_disabled_on_${route.replace(/[^a-z0-9-]+/gi, '_')}`, async ({ page }) => {
    const core = await startPanel(page, route);
    await must(GP(page), `${route}: the Graph tab panel`, 5000);
    assert.equal(await isDisabled(openFullBtn(page)), true, '`Open full view` is aria-disabled');
    assert.equal(await description(openFullBtn(page)), 'Open an object first', 'with the description `Open an object first` (D-1023)');
    await page.keyboard.press('Meta+Shift+g');
    await sleep(600);
    assert.ok(!(await marks(core)).some((m) => m.startsWith('route-ready:graph/')), '⌘⇧G does nothing');
  });
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-37, AC-38

test('fr_grp_01_ac37_panel_no_links_and_all_hidden', async ({ page, browser }) => {
  const core = await openPanel(page, P.osamela);
  assert.deepEqual(await waitIn(page, 1), [nfc(P.osamela)], 'only Osamělá');
  await must(GP(page).getByText('No links yet', { exact: true }), '`No links yet`');
  await must(GP(page).getByRole('group', { name: 'Local graph: Osamělá has no links', exact: true }), 'the canvas name');
  assert.equal(await footerText(page, 300), '', 'no footer');
  assert.equal(await isDisabled(trigger(page)), true, 'the trigger is aria-disabled');
  assert.equal(await isDisabled(openFullBtn(page)), false, '`Open full view` is enabled');
  await core.setFile(P.osamela, `${(await core.files())[nfc(P.osamela)].trimEnd()}\n[[Shrnutí]]\n`);
  assert.deepEqual(await eventually(() => keysIn(page), (k) => k.length === 2, LIVE), [P.osamela, P.shrnuti].map(nfc).sort(), 'Osamělá and Shrnutí within 2 s');
  assert.equal(await isDisabled(trigger(page)), false, 'the trigger enabled');
  const p2 = await browser.newPage();
  const c2 = await openPanel(p2, P.plan);
  await openPopover(p2);
  await click(pNone(p2), 'None');
  assert.deepEqual(await waitIn(p2, 1), [nfc(P.plan)], 'Plán alone');
  assert.ok((await panelText(p2)).includes('All 9 linked objects are hidden by the type filter.'), `the type-filter text: ${await panelText(p2)}`);
  const n0 = await uiSetCount(c2);
  await click(GP(p2).getByRole('button', { name: 'Show all types', exact: true }), '`Show all types`');
  assert.equal((await waitIn(p2, 10)).length, 10, 'every type ticked again');
  await sleep(300);
  assert.equal((await uiSetCount(c2)) - n0, 1, 'one ui_state_set');
  await openPopover(p2);
  const ticks = await pTypes(p2).getByRole('checkbox').evaluateAll((b) => b.map((e) => (e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true'));
  assert.ok(ticks.length === 12 && ticks.every(Boolean), `every type ticked: ${JSON.stringify(ticks)}`);
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) await click(pKindBox(p2, k), `${k} off`);
  await waitIn(p2, 1);
  assert.ok((await panelText(p2)).includes('All 9 linked objects are hidden by the filters.'), 'the filters text (D-991)');
  await must(GP(p2).getByRole('button', { name: 'Show everything', exact: true }), '`Show everything`');
  assert.equal(await isDisabled(trigger(p2)), false, 'the trigger stays enabled');
  await p2.close();
});

/** Records, in the page, when a loading element first appears in a tab panel (Date.now), before the app's scripts run. */
async function watchLoading(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__loadingSeen = [] as number[];
    const check = () => {
      const tp = [...document.querySelectorAll('[role="tabpanel"]')];
      if (tp.some((e) => (e.textContent ?? '').includes('Loading…') || e.querySelector('[data-graph-skeleton]'))) w.__loadingSeen.push(Date.now());
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const runningIn = (page: Page) => graphPanel(page).evaluate((tp) => (document.getAnimations?.() ?? []).filter((a) => {
  const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
  return a.playState === 'running' && !!t && tp.contains(t);
}).length).catch(() => -1);

test('fr_grp_01_ac38_panel_loading_after_300_ms_and_while_indexing', async ({ page }) => {
  await watchLoading(page);
  const core = await openPanel(page, P.plan, { realTime: true });
  await waitIn(page, 10);
  await core.graphDelay(250);
  await page.evaluate(() => { (window as any).__loadingSeen = []; });
  await chooseDepth(page, 2, 19);
  assert.equal(await page.evaluate(() => (window as any).__loadingSeen.length), 0, 'no Loading… and no skeleton for a 250 ms answer');
  for (const reduce of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion: reduce });
    await core.graphDelay(800);
    await page.evaluate(() => { (window as any).__loadingSeen = []; });
    const target = reduce === 'reduce' ? 1 : 3;
    await chooseDepth(page, target);
    await must(graphPanel(page).getByRole('status').filter({ hasText: 'Loading…' }), `${reduce}: \`Loading…\` in a status`, 1500);
    const calls = await callsOf(core, 'graph_neighbourhood');
    const sent = calls[calls.length - 1]?.at ?? 0;
    const first = await page.evaluate(() => (window as any).__loadingSeen[0] as number);
    assert.ok(first - sent >= 300 - 17, `${reduce}: loading no earlier than 300 ms after the request (± 1 frame): ${first - sent} ms`);
    assert.equal(await runningIn(page), 0, `${reduce}: no running animation while loading`);
    assert.equal(await isDisabled(trigger(page)), false, 'the trigger stays enabled');
    assert.equal((await waitIn(page, target === 3 ? 22 : 10, 3000)).length, target === 3 ? 22 : 10, `${reduce}: replaced by the graph`);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await core.graphDelay(1500);
  await chooseDepth(page, 3);
  await must(graphPanel(page).getByRole('status').filter({ hasText: 'Loading…' }), 'loading depth 3', 2000);
  await core.graphDelay(0);
  await chooseDepth(page, 2, 19);
  await sleep(2000);
  assert.equal((await keysIn(page)).length, 19, 'only the depth-2 answer is drawn');
  assert.equal((await lastReq(core))?.depth, 2, 'the last request is depth 2');
  await closePopover(page);
  await core.graphNotReady(true);
  await searchOpen(page, 'Rozpočet 2027');
  await must(graphPanel(page).getByRole('status').filter({ hasText: 'Loading…' }), 'Loading while the index isn\'t ready (D-990)', 3000);
  await core.graphNotReady(false);
  await core.emit('index:progress', { done: 26, total: 26, state: 'done' });
  const k = await eventually(() => keysIn(page), (x) => x.length > 0, 3000);
  assert.ok(k.length > 0 && k.includes(nfc(P.rozpocet)), 'drawn once the index is done, without a reload');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-43, AC-44

test('fr_grp_01_ac43_panel_canvas_size_scale_and_labels', async ({ page }) => {
  for (const w of [240, 288, 480]) {
    const p = await page.context().newPage();
    await p.setViewportSize(VIEWPORT);
    await openPanel(p, P.plan, { width: w });
    await waitIn(p, 10);
    const cb = await pCanvas(p).first().boundingBox();
    assert.ok(cb && Math.abs(cb.width - (w - 28)) <= 1, `panel ${w} px: canvas ${w - 28} px (got ${cb?.width})`);
    await p.close();
  }
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  const geo = await nodeGeometry(page);
  for (const n of geo) {
    if (n.key === nfc(P.plan)) assert.ok(Math.abs((n.d ?? 0) - 52) <= 0.5, `the centre is 52 px (got ${n.d})`);
    else if (n.key.startsWith('tag:')) assert.ok(Math.abs((n.pillH ?? 0) - 22) <= 0.5, `${n.key}: pill 22 px high (got ${n.pillH})`);
    else assert.ok(Math.abs((n.d ?? 0) - 34) <= 0.5, `${n.key}: 34 px at depth 1 (got ${n.d})`);
  }
  assert.ok((await circleSizes(nodeAt(page, P.plan, GP(page)))).some((d) => Math.abs(d - 60) <= 0.5), 'the centre\'s ring at 60 px');
  const cb = (await pCanvas(page).first().boundingBox())!;
  const inside = (g: Awaited<ReturnType<typeof nodeGeometry>>) => g.filter((n) => n.box.l < cb.x + 12 - 0.5 || n.box.t < cb.y + 12 - 0.5 || n.box.r > cb.x + cb.width - 12 + 0.5 || n.box.b > cb.y + cb.height - 12 + 0.5).map((n) => n.key);
  assert.deepEqual(inside(geo), [], 'first paint: every node box inside the canvas with a 12 px margin');
  const pos = await positions(page, GP(page));
  const c = pos[nfc(P.plan)];
  assert.ok(c && Math.abs(c.x - (cb.x + cb.width / 2)) <= 0.5 && Math.abs(c.y - (cb.y + cb.height / 2)) <= 0.5, 'the centre at the canvas centre (± 0.5 px)');
  assert.ok(cb.height >= 600, `the canvas is ≥ 600 px high at 1,440 × 980 (got ${cb.height})`);
  // Labels: at most 96 px, Den's `2026-10-07` not cut.
  const labels = await GP(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => {
    const t = g.querySelector('text') as SVGGraphicsElement | null;
    return { key: (g.getAttribute('data-path') ?? `tag:${g.getAttribute('data-tag-key')}`).normalize('NFC'), w: t?.getBoundingClientRect().width ?? 999, s: (t?.textContent ?? '').trim() };
  }));
  for (const l of labels) assert.ok(l.w <= 96.5, `${l.key}: label ≤ 96 px (got ${l.w})`);
  assert.equal(labels.find((l) => l.key === nfc(P.den))?.s, '2026-10-07', 'Den\'s label isn\'t cut');
  // A width change keeps every offset from the centre and asks nothing.
  const n0 = (await core.graphCalls()).length;
  const off = (p: Record<string, { x: number; y: number }>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { x: v.x - p[nfc(P.plan)].x, y: v.y - p[nfc(P.plan)].y }]));
  const sep = await must(page.getByRole('separator', { name: 'Resize panel' }), 'separator "Resize panel"');
  await sep.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await sleep(400);
  const cb2 = (await pCanvas(page).first().boundingBox())!;
  assert.ok(Math.abs(cb2.width - cb.width - 48) <= 1, `the canvas follows the width (+48 px): ${cb.width} → ${cb2.width}`);
  assert.deepEqual(samePlaces(off(pos), off(await positions(page, GP(page))), 0.5), [], 'every node keeps its offset from the centre (± 0.5 px)');
  assert.equal((await core.graphCalls()).length, n0, 'no graph_neighbourhood for a width change');
  // ⌘-scroll zooms 25 %…400 %, labels stay; dragging the empty canvas pans.
  const scale = async () => ((await circleSizes(nodeAt(page, P.plan, GP(page)))).sort((a, b) => a - b)[0] ?? NaN) / 52;
  const cb3 = (await pCanvas(page).first().boundingBox())!;
  await page.mouse.move(cb3.x + cb3.width / 2, cb3.y + cb3.height / 2);
  await page.keyboard.down('Meta');
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up('Meta');
  await sleep(200);
  assert.ok(Math.abs((await scale()) - 4) < 0.02, `zoom in stops at 400 % (got ${await scale()})`);
  assert.equal(await labelsShown(page), 10, 'labels shown at 400 %');
  await page.keyboard.down('Meta');
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 120);
  await page.keyboard.up('Meta');
  await sleep(200);
  assert.ok(Math.abs((await scale()) - 0.25) < 0.02, `zoom out stops at 25 % (got ${await scale()})`);
  assert.equal(await labelsShown(page), 10, 'labels shown at 25 %');
  const before = await positions(page, GP(page));
  await page.mouse.move(cb3.x + 6, cb3.y + 6);
  await page.mouse.down(); await page.mouse.move(cb3.x + 56, cb3.y + 36, { steps: 6 }); await page.mouse.up();
  const after = await positions(page, GP(page));
  const dx = after[nfc(P.plan)].x - before[nfc(P.plan)].x, dy = after[nfc(P.plan)].y - before[nfc(P.plan)].y;
  assert.ok(Math.abs(dx - 50) <= 1 && Math.abs(dy - 30) <= 1, `dragging the empty canvas pans (D-985): ${dx}, ${dy}`);
});

test('fr_grp_01_ac43_panel_canvas_size_scale_and_labels_deeper_and_narrow', async ({ page }) => {
  const long = 'Dlouhý název poznámky o rozpočtu, plánování čtvrtletí a všech dalších věcech pro tým';
  const title = long.padEnd(80, 'x').slice(0, 80);
  assert.equal([...title].length, 80, 'setup: an 80-character title');
  const vault = graphVault({ edit: (f) => { f['Pages/Dlouhý.md'] = `---\nid: 01JBGR0000000000000000R033\ntype: page\ntitle: ${title}\n---\nViz [[Plán čtvrtletí]].\n`; } });
  await openPanel(page, P.plan, { vault, panel: { depth: 2 } });
  await waitIn(page, 20);
  for (const n of await nodeGeometry(page)) if (n.depth === 2 && !n.key.startsWith('tag:')) assert.ok(Math.abs((n.d ?? 0) - 26) <= 0.5, `${n.key}: 26 px at depth 2 (got ${n.d})`);
  const t = await nodeAt(page, 'Pages/Dlouhý.md', GP(page)).locator('text').first().evaluate((e) => ({ w: (e as SVGGraphicsElement).getBoundingClientRect().width, s: (e.textContent ?? '').trim() })).catch(() => ({ w: 999, s: '' }));
  assert.ok(t.w <= 96.5 && t.s.endsWith('…'), `an 80-character title is cut at 96 px with …: ${JSON.stringify(t)}`);
  assert.equal(await nodeAt(page, 'Pages/Dlouhý.md', GP(page)).getAttribute('aria-label'), `${title}, Page`, 'the full title in the accessible name');
  const p2 = await page.context().newPage();
  await p2.setViewportSize(VIEWPORT);
  await openPanel(p2, P.plan, { width: 240, panel: { depth: 3 } });
  await waitIn(p2, 22);
  const cb = (await pCanvas(p2).first().boundingBox())!;
  const out = (await nodeGeometry(p2)).filter((n) => n.box.l < cb.x + 12 - 0.5 || n.box.t < cb.y + 12 - 0.5 || n.box.r > cb.x + cb.width - 12 + 0.5 || n.box.b > cb.y + cb.height - 12 + 0.5);
  assert.deepEqual(out.map((n) => n.key), [], 'Plán at depth 3 (22 nodes) at 240 px: every node fits (D-1031)');
  const d = (await circleSizes(nodeAt(p2, P.plan, GP(p2)))).sort((a, b) => a - b)[0] ?? 999;
  assert.ok(d <= 52.5, `the scale is at most 100 % (centre ${d} px)`);
  await p2.close();
});

test('fr_grp_01_ac44_panel_nfd_paths_are_one_centre', async ({ page, browser }) => {
  const core = await startPanel(page, `note/${NFD(P.plan)}`);
  assert.deepEqual(await eventually(() => keysIn(page), (k) => same(k, D1), 5000), D1, 'an NFD route: the same 10 nodes');
  assert.equal((await lastReq(core))?.centre, nfc(P.plan), 'the request\'s centre is NFC');
  await chooseDepth(page, 2, 19);
  await sleep(300);
  assert.deepEqual(Object.keys(((await core.uiState()) as any)?.vaults ?? {}), [nfc(VAULT_PATH)], 'the `vaults` key is the NFC vault path');
  const nfdLink = `---\nid: 01JBGR0000000000000000R030\ntype: page\ntitle: NFD odkaz\ncreated: 2026-10-28T09:00:00+01:00\nmodified: 2026-10-28T09:00:00+01:00\n---\n[[${NFD('Plán čtvrtletí')}]]\n`;
  const vault = graphVault({ edit: (f) => { f['Pages/NFD odkaz.md'] = nfdLink; } });
  const p2 = await browser.newPage();
  await openPanel(p2, P.plan, { vault });
  const k = await waitDrawn(p2, 11, 3000, GP(p2));
  assert.equal(k.length, 11, 'Plán\'s panel shows 11 nodes');
  assert.ok(pairOf(await drawnEdges(p2, GP(p2)), 'Pages/NFD odkaz.md', P.plan), '`NFD odkaz` linked once');
  assert.equal((await drawn(p2, GP(p2))).filter((n) => n.name.startsWith('Plán čtvrtletí')).length, 1, 'no second Plán');
  const p3 = await browser.newPage();
  await openPanel(p3, P.plan, { vault, region: 'cs' });
  assert.deepEqual(await waitDrawn(p3, 11, 3000, GP(p3)), k, 'the same result with region cs');
  assert.equal(await footerText(p3), '11 objects · click a node to preview', 'and the same texts');
  await p2.close();
  await p3.close();
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-7…AC-10

test('fr_grp_02_ac7_panel_depth_and_filters_popover', async ({ page }) => {
  await openPanel(page, P.plan);
  const t = await must(trigger(page), 'button "Depth and filters"');
  assert.equal(await t.getAttribute('aria-haspopup'), 'dialog', 'aria-haspopup="dialog"');
  assert.equal(await t.getAttribute('aria-expanded'), 'false', 'aria-expanded false');
  assert.equal(await description(t), 'Depth 1', 'its visible text as aria-description');
  await t.click();
  const d = await must(popover(page), 'dialog "Depth and filters"');
  assert.equal(await d.getAttribute('aria-modal'), 'false', 'aria-modal="false"');
  assert.equal(await t.getAttribute('aria-expanded'), 'true', 'aria-expanded true');
  const db = (await d.boundingBox())!, pb = (await ctxPanel(page).boundingBox())!, tb = (await t.boundingBox())!;
  assert.ok(Math.abs(db.width - 268) <= 1, `268 px wide (got ${db.width})`);
  assert.ok(Math.abs(db.x + db.width - (pb.x - 8)) <= 1, `its right edge 8 px left of the panel (${db.x + db.width} vs ${pb.x - 8})`);
  assert.ok(Math.abs(db.y - Math.min(tb.y, VIEWPORT.height - 8 - db.height)) <= 1, `its top at the trigger's top (${db.y} vs ${tb.y})`);
  assert.equal(await depthRadio(page, 1).evaluate((e) => e === document.activeElement), true, 'the focus on the checked Depth radio (1)');
  const y = async (loc: ReturnType<typeof pTypes>) => (await (await must(loc, 'a popover part')).boundingBox())!.y;
  const parts = [await y(depthRadios(page)), await y(pTypes(page)), await y(pKinds(page)), await y(pSizeBox(page)), await y(popover(page).getByText(FILTERS_NOTE, { exact: true }))];
  assert.deepEqual([...parts].sort((a, b) => a - b), parts, 'Depth, Types, Connections, Size nodes by links, the note — in this order');
  const rows = await typeRows(page);
  assert.deepEqual(rows, ['Pages 2', 'Tasks 1', 'Quick Notes 0', 'Daily Notes 1', 'Cesty 0', 'Osoby 0', 'Projekty 1', 'Schůzky 1', 'Images 1', 'PDFs 0', 'Tags 2', 'recept 1'], 'the type rows of the unfiltered walk (D-976, D-977)');
  assert.equal(rows.map((r) => r.replace(/\s*\d+$/, '')).join('|'), READMEROWS.join('|'), 'the D-977 order');
  assert.ok(await pTypes(page).locator('[data-swatch="pill"]').count() >= 1, 'the Tag row with the pill swatch');
  assert.equal(await popover(page).getByRole('combobox').count() + await popover(page).getByText(/^Preset/).count(), 0, 'no preset control (G3)');
  await page.keyboard.press('ArrowDown');
  assert.equal((await waitIn(page, 19)).length, 19, 'an arrow moves within the radiogroup and applies at once');
  assert.ok(await seen(popover(page), 300), 'with the popover open');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(popover(page), 800)), 'Esc closes it');
  assert.equal(await trigger(page).evaluate((e) => e === document.activeElement), true, 'the focus returns to the trigger');
  assert.equal(await t.getAttribute('aria-expanded'), 'false', 'aria-expanded false');
  await t.click();
  await must(popover(page), 'open again');
  await page.mouse.click(400, 500);
  assert.ok(!(await seen(popover(page), 800)), 'a click outside closes it');
});

test('fr_grp_02_ac8_panel_filters_drive_the_walk', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await openPopover(page);
  const counts0 = await typeRows(page);
  await click(pTypeBox(page, 'Tags'), 'Tags off');
  assert.equal((await waitIn(page, 8)).length, 8, 'Tags off d1: 8 nodes');
  assert.equal((await drawnEdges(page, GP(page))).length, 8, '8 edges');
  assert.ok(await triggerIs(page, 'Depth 1 · 2 hidden'), `trigger: ${await triggerText(page)}`);
  assert.deepEqual((await lastReq(core))?.hiddenTypes, ['tag'], 'the request carries hiddenTypes ["tag"]');
  assert.equal((await lastReq(core))?.cap, 60, 'and cap 60');
  await chooseDepth(page, 2, 14);
  assert.equal((await drawnEdges(page, GP(page))).length, 15, '15 edges');
  assert.ok(await triggerIs(page, 'Depth 2 · 5 hidden'), `trigger: ${await triggerText(page)}`);
  await click(pTypeBox(page, 'Tags'), 'Tags on');
  await click(pTypeBox(page, 'Projekty'), 'Projekty off');
  assert.equal((await waitIn(page, 16)).length, 16, 'Projekty off d2: 16 nodes');
  assert.ok(await triggerIs(page, 'Depth 2 · 3 hidden'), `trigger: ${await triggerText(page)}`);
  await click(pTypeBox(page, 'Projekty'), 'Projekty on');
  await waitIn(page, 19);
  await click(pKindBox(page, 'Relations'), 'Relations off');
  assert.equal((await waitIn(page, 16)).length, 16, 'Relations off d2: 16 nodes');
  assert.equal((await drawnEdges(page, GP(page))).length, 17, '17 edges');
  assert.equal(pairOf(await drawnEdges(page, GP(page)), P.plan, P.rozpocet)?.style, 'link', 'Plán–Rozpočet drawn as link (D-973)');
  assert.deepEqual((await lastReq(core))?.hiddenKinds, ['relation'], 'hiddenKinds ["relation"]');
  await click(pKindBox(page, 'Relations'), 'Relations on');
  await chooseDepth(page, 1, 10);
  await click(pKindBox(page, 'Links'), 'Links off');
  assert.equal((await waitIn(page, 7)).length, 7, 'Links off d1: 7 nodes');
  assert.ok(await triggerIs(page, 'Depth 1 · 3 hidden'), `trigger: ${await triggerText(page)}`);
  assert.deepEqual(await typeRows(page), counts0, 'the type counts don\'t change with the filters');
});

test('fr_grp_02_ac9_panel_all_and_none', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await openPopover(page);
  let n = await uiSetCount(core);
  await click(pNone(page), 'None');
  assert.equal((await waitIn(page, 1)).length, 1, '`None`: the All hidden state');
  assert.ok((await panelText(page)).includes('All 9 linked objects are hidden by the type filter.'), 'FR-GRP-01 AC-37\'s text');
  await sleep(300);
  assert.equal((await uiSetCount(core)) - n, 1, '`None` is one ui_state_set');
  n = await uiSetCount(core);
  await click(pAll(page), 'All');
  assert.equal((await waitIn(page, 10)).length, 10, '`All` ticks every type again');
  await sleep(300);
  assert.equal((await uiSetCount(core)) - n, 1, '`All` is one ui_state_set');
});

test('fr_grp_02_ac10_panel_and_full_view_state_are_separate', async ({ page, browser }) => {
  const core = await openPanel(page, P.plan);
  await openPopover(page);
  const n0 = await uiSetCount(core);
  await click(pTypeBox(page, 'Tags'), 'Tags off in the panel');
  await waitIn(page, 8);
  await sleep(300);
  assert.equal((await uiSetCount(core)) - n0, 1, 'written once');
  assert.deepEqual((await panelStored(core))?.hiddenTypes, ['tag'], 'graph.panel.hiddenTypes ["tag"]');
  assert.equal(await fullState(core), null, 'graph.full absent');
  await closePopover(page);
  await click(openFullBtn(page), '`Open full view`');
  await must(graphHeading(page), 'the full view of Plán', 5000);
  assert.equal(await checked(typeBox(page, 'Tags')), true, 'the full view ticks Tags');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 4000), `10 objects: ${await headingText(page)}`);
  await click(kindBox(page, 'Relations'), 'Relations off in the full view');
  await sleep(300);
  assert.deepEqual((await fullState(core))?.hiddenKinds, ['relation'], 'graph.full.hiddenKinds ["relation"]');
  const ps = await panelStored(core);
  assert.deepEqual([ps?.hiddenTypes, (ps?.hiddenKinds as string[] | undefined) ?? []], [['tag'], []], 'graph.panel as it was');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal((await waitIn(page, 8, 4000)).length, 8, 'back on the note: the panel still hides Tags');
  await openPopover(page);
  assert.equal(await checked(pKindBox(page, 'Relations')), true, 'and shows Relations');
  const stored = (await core.uiState()) as any;
  const p2 = await browser.newPage();
  await openPanel(p2, P.plan, { vault: { ...graphVault(), name: 'Jiný' }, uiState: stored });
  assert.equal((await waitDrawn(p2, 10, 3000, GP(p2))).length, 10, 'a second vault starts with no hidden type in its panel');
  await p2.close();
  const kniha = 'version: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: blue\nreview: false\npreview: []\nattributes: []\n';
  const p3 = await browser.newPage();
  const c3 = await openPanel(p3, P.plan, { vault: graphVault({ edit: (f) => { f['.tegg/types/kniha.yml'] = kniha; } }), panel: { hiddenTypes: ['tag', 'neznámý'] } });
  assert.equal((await waitDrawn(p3, 8, 3000, GP(p3))).length, 8, 'an unknown key is ignored');
  await openPopover(p3);
  assert.equal(await checked(pTypeBox(p3, 'Knihy')), true, 'a type created later is visible');
  await click(pKindBox(p3, 'Links'), 'Links off');
  await sleep(300);
  assert.deepEqual((await panelStored(c3))?.hiddenTypes, ['tag', 'neznámý'], 'and the unknown key is kept');
  await p3.close();
});

// ------------------------------------------------------------------------------------------------ FR-GRP-03 AC-6…AC-9

test('fr_grp_03_ac6_panel_click_selects_and_previews', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  const n0 = (await core.calls()).length;
  await clickNode(page, P.rozpocet, {}, GP(page));
  assert.deepEqual(await selectedIn(page), [nfc(P.rozpocet)], 'data-selected on Rozpočet');
  const near = [P.rozpocet, P.plan, P.zapis, 'tag:účty'].map(nfc);
  for (const k of D1) {
    const want = near.includes(k) ? 1 : 0.3;
    assert.equal(await eventually(() => opacity(page, k, GP(page)), (x) => x === want, 1000), want, `${k}: opacity ${want}`);
  }
  const hl = await tokenColour(page, 'hl');
  for (const [a, b] of EDGES_D1) {
    const s = await edgeStyle(page, a, b, GP(page));
    if (a === P.rozpocet || b === P.rozpocet) assert.equal(s?.stroke, hl, `${a}–${b}: --hl`);
    else assert.equal(s?.opacity, 0.35, `${a}–${b}: 0.35`);
  }
  await mustPreview(page, 'Rozpočet 2027', 'the preview popover');
  await clickNode(page, P.zapis, {}, GP(page));
  assert.deepEqual(await selectedIn(page), [nfc(P.zapis)], 'a click on Zápis moves the selection');
  await mustPreview(page, 'Zápis z porady', 'one popover, with Zápis');
  await clickEmpty(page, GP(page));
  assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 1500), 0, 'a click on the empty canvas closes the popover');
  assert.deepEqual(await selectedIn(page), [], 'and clears the selection (D-1041)');
  const cmds = (await core.calls()).slice(n0).map((c) => c.cmd);
  assert.ok(!cmds.includes('nav_opened'), 'no nav_opened');
  assert.equal(await mainName(page), 'Plán čtvrtletí', 'no route change');
  assert.equal(await core.writes(), 0, 'no write');
});

for (const meta of [false, true]) {
  test(`fr_grp_03_ac7_panel_double_click_opens_and_the_panel_follows${meta ? '_cmd' : ''}`, async ({ page }) => {
    const core = await openPanel(page, P.plan);
    const cases: [string, string, number | null][] = [[P.rozpocet, noteRoute(P.rozpocet), 7], [P.den, 'daily/2026-10-07', 3], [P.graf, noteRoute(P.graf), 2], ['tag:účty', 'tag/účty', null], ['tag:nápad', 'tag/nápad', null]];
    for (const [k, route, n] of cases) {
      await waitIn(page, 10, 4000);
      const nav0 = await navCount(core);
      await clickNode(page, k, { double: true, meta }, GP(page));
      const want = route.startsWith('tag/') ? tagRoute(route.slice(4)) : route;
      assert.ok(await routeReady(core, want, 4000) || await routeReady(core, route, 100), `${k}: opens ${route}`);
      if (n !== null) {
        assert.equal((await navCount(core)) - nav0, 1, `${k}: one nav_opened`);
        assert.equal((await waitIn(page, n, LIVE)).length, n, `${k}: the panel shows its ${n} nodes`);
      } else {
        assert.ok(!(await seen(ctxPanel(page), 500)), `${route}: no panel there (D-1040)`);
      }
      await page.keyboard.press('Meta+BracketLeft');
      assert.equal(await eventually(() => mainName(page), (x) => x === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back returns to Plán');
      assert.ok(await seen(pCanvas(page), 3000), 'with the panel on Graph');
    }
    assert.equal(await core.writes(), 0, 'nothing written (no Tags/nápad.md)');
  });
}

test('fr_grp_03_ac8_panel_centre_node', async ({ page }) => {
  const core = await startPanel(page, 'daily/2026-10-07');
  await waitIn(page, 3, 5000);
  await clickNode(page, P.plan, { double: true }, GP(page));
  assert.ok(await routeReady(core, noteRoute(P.plan), 4000), 'on Plán (from Den\'s panel)');
  await waitIn(page, 10, LIVE);
  await clickNode(page, P.plan, {}, GP(page));
  const d = await mustPreview(page, 'Plán čtvrtletí', 'a click on the centre previews it');
  const t = await eventually(async () => flat(await d.innerText().catch(() => '')), (x) => x.includes('Page · 9 connections'), 3000);
  assert.ok(t.includes('Page · 9 connections'), `\`Page · 9 connections\`: ${t}`);
  assert.ok(!/Linked from|Links to|Embedded in|Tag of/.test(t), 'no connection phrase for the centre (D-982)');
  await page.keyboard.press('Escape');
  const nav0 = await navCount(core);
  const ready0 = (await marks(core)).length;
  await clickNode(page, P.plan, { double: true }, GP(page));
  await sleep(700);
  assert.equal((await navCount(core)) - nav0, 0, 'a double-click on the centre calls nav_opened zero times');
  assert.ok(!(await marks(core)).slice(ready0).some((m) => m.startsWith('route-ready:')), 'and keeps the route');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await eventually(async () => (await keysIn(page)).length === 3, (x) => x, 4000), 'no history entry: one Back returns to Den');
});

for (const mode of ['hover', 'off'] as const) {
  test(`fr_grp_03_ac9_panel_uses_click_mode_${mode}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { previewMode: mode });
    await waitIn(page, 10);
    assert.equal(await footerText(page), '10 objects · click a node to preview', 'the footer of click mode');
    const box = await (await must(nodeAt(page, P.rozpocet, GP(page)), 'Rozpočet')).boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
    await sleep(1600);
    assert.equal(await anyPreviewDialog(page).count(), 0, 'hovering opens no preview');
    assert.equal(await eventually(() => opacity(page, P.den, GP(page)), (x) => x === 0.3, 1000), 0.3, 'hovering Rozpočet dims Den');
    assert.equal(await opacity(page, P.plan, GP(page)), 1, 'and keeps Plán, its neighbour');
    assert.deepEqual(await selectedIn(page), [], 'without selecting');
    await clickNode(page, P.rozpocet, {}, GP(page));
    await mustPreview(page, 'Rozpočet 2027', 'a click previews (click mode, D-983)');
    await clickNode(page, P.rozpocet, { double: true }, GP(page));
    assert.ok(await routeReady(core, noteRoute(P.rozpocet), 4000), 'a double-click opens');
  });
}

// ------------------------------------------------------------------------------------------------ FR-GRP-05 AC-5

const TYPE_PAINT: [string, string, string][] = [
  [P.plan, 'file-text', 'gray'], [P.shrnuti, 'file-text', 'gray'], [P.vydaje, 'file-text', 'gray'], [P.bez, 'file-text', 'gray'], [P.chybna, 'file-text', 'gray'],
  [P.rozpocet, 'folder', 'orange'], [P.beta, 'folder', 'orange'], [P.zapis, 'users', 'teal'], [P.jana, 'user', 'purple'], [P.petr, 'user', 'purple'],
  [P.ukol, 'check-square', 'blue'], [P.den, 'calendar', 'purple'], [P.graf, 'image', 'teal'], [P.smlouva, 'file', 'red'], [P.vylet, 'zap', 'yellow'],
  [P.recept, 'file-text', 'gray'],
];

test('fr_grp_05_ac5_panel_type_icons_and_colours', async ({ page }) => {
  await openPanel(page, P.plan, { panel: { depth: 3 } });
  await waitIn(page, 22);
  const now = await drawn(page, GP(page));
  for (const [k, icon, colour] of TYPE_PAINT) {
    assert.equal(now.find((x) => x.key === nfc(k))?.icon, icon, `${k}: data-icon ${icon}`);
    const paint = await nodePaint(page, k, GP(page));
    assert.equal(paint?.fill, await tokenColour(page, `type-${colour}-bg`), `${k}: fill --type-${colour}-bg`);
    assert.equal(paint?.stroke, await tokenColour(page, `type-${colour}`), `${k}: border --type-${colour}`);
    assert.equal(paint?.icon, await tokenColour(page, `type-${colour}`), `${k}: icon --type-${colour}`);
  }
  assert.equal(await graphPanel(page).locator('[data-graph-legend]').count() + await graphPanel(page).getByRole('region', { name: /legend/i }).count(), 0, 'no legend element in the panel (D-910)');
  await openPopover(page);
  assert.equal((await typeRows(page)).length, 12, 'the popover\'s type list is the legend');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-6…AC-8

test('fr_grp_06_ac6_panel_preview_popover_content', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  const n0 = (await core.calls()).length;
  await clickNode(page, P.rozpocet, {}, GP(page));
  const d = await mustPreview(page, 'Rozpočet 2027', 'dialog "Preview: Rozpočet 2027"');
  assert.equal(nfc((await d.getAttribute('data-preview-path')) ?? ''), nfc(P.rozpocet), 'data-preview-path="Projekty/Rozpočet 2027.md"');
  const text = await eventually(async () => flat(await d.innerText()), (t) => t.includes('Rozpočet na příští rok.'), 3000);
  for (const part of ['Rozpočet 2027', 'Projekt', 'Projekt · 6 connections', 'Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí', 'Vlastník', 'Jana Nováková', 'Termín', 'Dec 31, 2026', 'Rozpočet na příští rok.']) {
    assert.ok(text.includes(part), `the popover shows ${JSON.stringify(part)}: ${text}`);
  }
  assert.ok(await d.locator('[data-icon="folder"]').count() >= 1, 'the folder icon');
  const btns = (await d.getByRole('button').allInnerTexts()).map(flat);
  const fi = btns.findIndex((b) => b === 'In full graph'), oi = btns.findIndex((b) => /^Open\b/.test(b));
  assert.ok(fi >= 0 && oi > fi, `\`In full graph\` then \`Open\` (D-1034): ${JSON.stringify(btns)}`);
  assert.ok(!btns.some((b) => b.includes('Center graph here')), 'no `Center graph here`');
  const cmds = (await core.calls()).slice(n0).map((c) => c.cmd);
  assert.ok(cmds.includes('embed_load') && !cmds.includes('note_read') && !cmds.includes('nav_opened'), `content from embed_load only: ${cmds.join(', ')}`);
  const want: [string, string, string[]][] = [
    ['tag:účty', '#Účty', ['Tag · 3 connections']], ['tag:nápad', '#nápad', ['2 objects']], [P.den, '2026-10-07', ['Daily Note · 2 connections', 'Ráno: Nákupní seznam.']],
    [P.graf, 'Graf výdajů', ['Image · 1 connection']],
  ];
  for (const [k, title, parts] of want) {
    await clickNode(page, k, {}, GP(page));
    const dk = await mustPreview(page, title, `${k} previews`);
    const t = await eventually(async () => flat(await dk.innerText().catch(() => '')), (x) => parts.every((p) => x.includes(p)), 3000);
    for (const p of parts) assert.ok(t.includes(p), `${k}: ${JSON.stringify(p)} in ${t}`);
    if (k === P.graf) assert.ok(await dk.locator('img').count() >= 1, 'Graf: the image');
  }
  assert.equal(await core.writes(), 0, '#nápad neutral: nothing written');
  const p2 = await page.context().newPage();
  await p2.setViewportSize(VIEWPORT);
  await openPanel(p2, P.plan, { panel: { depth: 2 } });
  await waitIn(p2, 19);
  await clickNode(p2, P.chybna, {}, GP(p2));
  const dc = await mustPreview(p2, 'Chybná hlavička', 'Chybná previews');
  assert.ok((await eventually(async () => flat(await dc.innerText()), (x) => x.includes('can\'t be read'), 3000)).includes('This note\'s properties can\'t be read.'), 'Chybná with its notice');
  await p2.close();
});

test('fr_grp_06_ac7_panel_preview_opens_left_of_the_panel', async ({ page }) => {
  await openPanel(page, P.plan);
  await waitIn(page, 10);
  await clickNode(page, P.rozpocet, {}, GP(page));
  const d = await mustPreview(page, 'Rozpočet 2027', 'the popover');
  const place = async () => {
    const db = (await d.boundingBox())!, pb = (await ctxPanel(page).boundingBox())!, nb = (await nodeAt(page, P.rozpocet, GP(page)).boundingBox())!;
    return { db, pb, nb };
  };
  const { db, pb, nb } = await place();
  assert.ok(Math.abs(db.x + db.width - (pb.x - 8)) <= 1, `right edge 8 px left of the panel: ${db.x + db.width} vs ${pb.x - 8}`);
  const top = Math.min(Math.max(nb.y, 8), VIEWPORT.height - 8 - db.height);
  assert.ok(Math.abs(db.y - top) <= 1, `top at the node's top, kept inside the window: ${db.y} vs ${top}`);
  assert.ok(Math.abs(db.width - 380) <= 1 && db.height <= 480 + 1, `the standard size (380 wide, ≤ 480 high): ${db.width} × ${db.height}`);
  assert.ok(db.x + db.width <= pb.x, 'it never covers the panel');
  const sep = await must(page.getByRole('separator', { name: 'Resize panel' }), 'separator');
  await sep.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await sleep(300);
  if (await seen(d, 300)) {
    const again = await place();
    assert.ok(Math.abs(again.db.x + again.db.width - (again.pb.x - 8)) <= 1, `the panel 64 px wider re-places it at once: ${again.db.x + again.db.width} vs ${again.pb.x - 8}`);
  } else {
    await clickNode(page, P.rozpocet, {}, GP(page));
    const d2 = await mustPreview(page, 'Rozpočet 2027', 'again');
    const b2 = (await d2.boundingBox())!, p2b = (await ctxPanel(page).boundingBox())!;
    assert.ok(Math.abs(b2.x + b2.width - (p2b.x - 8)) <= 1, 'left of the wider panel');
  }
  const small = await page.context().newPage();
  await small.setViewportSize({ width: 800, height: 500 });
  await startPanel(small, noteRoute(P.plan), { sidebarOpen: false });
  await waitDrawn(small, 10, 5000, GP(small));
  await clickNode(small, P.recept, {}, GP(small));
  const ds = await mustPreview(small, 'Recept na koláč', 'at 800 × 500');
  const sb = (await ds.boundingBox())!;
  assert.ok(sb.x >= 8 - 0.5 && sb.y >= 8 - 0.5 && sb.x + sb.width <= 800 - 8 + 0.5 && sb.y + sb.height <= 500 - 8 + 0.5, `inside the window: ${JSON.stringify(sb)}`);
  await small.close();
});

test('fr_grp_06_ac8_panel_preview_closes_and_clears_the_selection', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  const allOne = async (what: string) => {
    assert.deepEqual(await selectedIn(page), [], `${what}: the selection is cleared`);
    for (const k of D1) assert.equal(await eventually(() => opacity(page, k, GP(page)), (x) => x === 1, 1000), 1, `${what}: ${k} at opacity 1`);
  };
  const open = async () => {
    if (!(await seen(pCanvas(page), 500))) await click(graphTab(page), 'tab "Graph"');
    await waitIn(page, 10, 4000);
    await clickNode(page, P.rozpocet, {}, GP(page));
    return mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
  };
  const closed = async (what: string) => assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 1500), 0, `${what} closes it`);
  await open();
  await page.keyboard.press('Escape');
  await closed('Esc');
  assert.equal(nfc(await page.evaluate(() => (document.activeElement?.closest('[data-graph-node]') as Element | null)?.getAttribute('data-path') ?? '')), nfc(P.rozpocet), 'Esc returns the focus to the node');
  await allOne('Esc');
  const d = await open();
  await click(d.getByRole('button', { name: 'Close preview', exact: true }), '`Close preview`');
  await closed('`Close preview`');
  assert.equal(nfc(await page.evaluate(() => (document.activeElement?.closest('[data-graph-node]') as Element | null)?.getAttribute('data-path') ?? '')), nfc(P.rozpocet), 'the focus on the node');
  await allOne('Close preview');
  await open();
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note')).click({ position: { x: 20, y: 5 } });
  await closed('a click on the note');
  await allOne('the note');
  await open();
  await clickEmpty(page, GP(page));
  await closed('a click on the empty canvas');
  await open();
  const tb = (await trigger(page).boundingBox())!;
  await page.mouse.click(tb.x + tb.width + 20, tb.y + tb.height / 2);
  await closed('a click on the toolbar');
  await open();
  await click(backlinksTab(page), 'tab "Backlinks"');
  await closed('a tab change');
  await open();
  await page.keyboard.press('Meta+Backslash');
  await closed('⌘\\');
  await page.keyboard.press('Meta+Backslash');
  await open();
  await page.setViewportSize({ width: 700, height: 980 });
  await closed('the panel closing by itself (window too narrow)');
  await page.setViewportSize(VIEWPORT);
  if (!(await seen(ctxPanel(page), 800))) await page.keyboard.press('Meta+Backslash');
  await open();
  await searchOpen(page, 'Výdaje 2026');
  await closed('a route change');
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000);
  const d2 = await open();
  await (await must(d2.getByRole('button', { name: /^Open\b/ }), '`Open`')).focus();
  await page.keyboard.press('Enter');
  assert.ok(await routeReady(core, noteRoute(P.rozpocet), 4000), '⏎ on `Open` opens the object (FR-GRP-03 AC-7)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-07 AC-4, FR-GRP-08 AC-6

test('fr_grp_07_ac4_panel_size_by_links', async ({ page, browser }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2 } });
  await waitIn(page, 19);
  await openPopover(page);
  assert.equal(await checked(pSizeBox(page)), false, 'unticked with no stored state');
  for (const n of await drawn(page, GP(page))) if (n.key !== nfc(P.plan)) assert.equal(n.step, 'default', `${n.key}: data-size-step="default"`);
  const n0 = await uiSetCount(core);
  await click(pSizeBox(page), 'Size nodes by links');
  await eventually(async () => (await drawn(page, GP(page))).find((x) => x.key === nfc(P.rozpocet))?.step, (s) => s === 'medium', 2000);
  for (const g of await nodeGeometry(page)) {
    if (g.key.startsWith('tag:')) continue;
    const want = g.key === nfc(P.plan) ? ['centre', 52] : [P.rozpocet, P.zapis].map(nfc).includes(g.key) ? ['medium', 34] : ['small', 26];
    assert.equal(g.step, want[0], `${g.key}: ${want[0]}`);
    assert.ok(Math.abs((g.d ?? 0) - (want[1] as number)) <= 0.5, `${g.key}: ${want[1]} px (got ${g.d})`);
  }
  await sleep(300);
  assert.equal((await uiSetCount(core)) - n0, 1, 'written once');
  assert.equal((await panelStored(core))?.sizeByLinks, true, 'graph.panel.sizeByLinks: true');
  assert.equal(await fullState(core), null, 'graph.full unchanged');
  const p2 = await browser.newPage();
  await openPanel(p2, 'Pages/Hub/Paprsek 01.md', { vault: graphVault({ hub: true }), panel: { depth: 1, sizeByLinks: true } });
  await waitDrawn(p2, 5, 8000, GP(p2));
  const r = (await nodeGeometry(p2)).find((g) => g.key === nfc(P.rozcestnik));
  assert.deepEqual([r?.step, Math.round(r?.d ?? 0)], ['large', 44], 'Paprsek 01 at depth 1: Rozcestník large (44 px)');
  await p2.close();
});

const PILLS: [string, string, string | null][] = [
  ['účty', '#Účty', 'blue'], ['finance', '#Finance', 'orange'], ['zdraví', '#Zdraví', 'green'], ['archiv', '#Archiv', null], ['cestování', '#Cestování', null], ['nápad', '#nápad', null],
];

test('fr_grp_08_ac6_panel_tag_pills', async ({ page }) => {
  await openPanel(page, P.plan, { panel: { depth: 3 } });
  await waitIn(page, 22);
  const geo = await nodeGeometry(page);
  for (const [key, text, colour] of PILLS) {
    const el = await must(tagNode(page, key, GP(page)), `#${key}`);
    assert.equal(flat(await el.textContent()), text, `${key}: the pill reads ${text}`);
    const paint = await nodePaint(page, `tag:${key}`, GP(page));
    const fill = await tokenColour(page, colour ? `type-${colour}-bg` : 'hover');
    const ink = await tokenColour(page, colour ? `type-${colour}` : 'muted');
    assert.deepEqual([paint?.fill, paint?.stroke, paint?.text], [fill, ink, ink], `${key}: fill, border, text (${colour ?? 'neutral'})`);
    const h = geo.find((g) => g.key === nfc(`tag:${key}`))?.pillH ?? 0;
    assert.ok(Math.abs(h - 22) <= 0.5, `${key}: 22 px high (got ${h})`);
  }
  await clickNode(page, 'tag:účty', { double: true }, GP(page));
  await click(colourTile(page), 'the Tag colour tile on tag/účty', 5000);
  await click(swatch(page, 'Green'), 'Green');
  await sleep(300);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+BracketLeft');
  await waitIn(page, 22, 4000);
  const green = await tokenColour(page, 'type-green-bg');
  assert.equal(await eventually(async () => (await nodePaint(page, 'tag:účty', GP(page)))?.fill, (f) => f === green, 2000), green, 'Back: the pill is green');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-2, AC-3

test('fr_nav_05_ac2_show_local_graph_opens_the_tab', async ({ page }) => {
  const core = await startPanel(page, noteRoute(P.plan), { open: false, tab: 'backlinks' });
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 5000);
  assert.ok(!(await seen(ctxPanel(page), 500)), 'the panel is closed');
  const n0 = await uiSetCount(core);
  await runCommand(page, 'Show local graph');
  await must(graphPanel(page), 'the Context panel on the Graph tab', 3000);
  assert.equal(await graphTab(page).getAttribute('aria-selected'), 'true', 'the Graph tab selected');
  assert.equal(await eventually(() => trigger(page).evaluate((e) => e === document.activeElement).catch(() => false), (f) => f, 2000), true, 'the focus on `Depth and filters`');
  await sleep(300);
  const writes = (await callsOf(core, 'ui_state_set')).slice(n0).map((c) => (c.args as any)?.state?.rightPanel);
  assert.equal(writes.length, 1, `one write: ${JSON.stringify(writes)}`);
  assert.deepEqual([writes[0]?.open, writes[0]?.tab], [true, 'graph'], 'rightPanel.open: true, tab: graph');
  await click(backlinksTab(page), 'tab "Backlinks"');
  await runCommand(page, 'Show local graph');
  assert.equal(await eventually(() => graphTab(page).getAttribute('aria-selected'), (s) => s === 'true', 2000), 'true', 'from Backlinks it switches to Graph');
});

const listed = async (page: Page, q: string) => {
  await page.keyboard.press('Meta+k');
  await must(page.getByRole('dialog', { name: 'Command palette' }), 'the palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill(q);
  await sleep(250);
  const opts = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map(flat);
  await page.keyboard.press('Escape');
  return opts.some((o) => o.startsWith(q));
};
test('fr_nav_05_ac2_show_local_graph_opens_the_tab_listed_per_route', async ({ page, browser }) => {
  // One test for every route, so it is red while the command is missing (the routes without it pass on their own).
  const got: string[] = [];
  for (const [route, want] of [[noteRoute(P.plan), true], ['daily/2026-10-07', true], ['new/page', true], [tagRoute('účty'), false], [`graph/${nfc(P.plan)}`, false], ['search', false], ['tasks', false]] as const) {
    const p = route === noteRoute(P.plan) ? page : await browser.newPage();
    await startPanel(p, route, { open: false, tab: 'backlinks' });
    await sleep(800);
    if ((await listed(p, 'Show local graph')) !== want) got.push(`${route}: ${want ? 'not listed' : 'listed'}`);
    if (p !== page) await p.close();
  }
  assert.deepEqual(got, [], '`Show local graph` is listed on note/<path>, daily/<date>, new/<type> and not on tag/<key>, graph/<path>, search, tasks');
});

test('fr_nav_05_ac3_graph_tab_remembered', async ({ page }) => {
  const core = await startPanel(page, noteRoute(P.plan), { tab: 'backlinks' });
  await click(graphTab(page), 'tab "Graph"', 5000);
  await must(pCanvas(page), 'the graph', 3000);
  assert.equal(await eventually(async () => ((await core.uiState()) as any)?.rightPanel?.tab, (t) => t === 'graph', 2000), 'graph', 'rightPanel.tab: graph stored (FR-UX-02 AC-10)');
  const sel = () => graphTab(page).getAttribute('aria-selected');
  await searchOpen(page, 'Rozpočet 2027');
  assert.equal(await sel(), 'true', 'another note keeps the Graph tab');
  await page.keyboard.press('Meta+Backslash');
  await page.keyboard.press('Meta+Backslash');
  await must(graphTab(page), 'the panel again');
  assert.equal(await sel(), 'true', '⌘\\ twice keeps it');
  await page.keyboard.press('Meta+Shift+Backslash');
  await sleep(300);
  await page.keyboard.press('Meta+Shift+Backslash');
  await must(graphTab(page), 'the panel after focus mode');
  assert.equal(await sel(), 'true', 'focus mode on and off keeps it');
  await must(pCanvas(page), 'and the graph is drawn');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-39, FR-UX-03 AC-21, NFR-OTH-02 AC-13

test('fr_syn_06_ac39_panel_graph_tour_writes_nothing', async ({ page }) => {
  const core = await openPanel(page, P.plan, { vault: graphVault({ hub: true }) });
  const filesBefore = JSON.stringify(await core.files());
  for (const d of [2, 3, 1] as const) await chooseDepth(page, d);
  for (const t of ['Pages', 'Tags', 'Projekty']) { await click(pTypeBox(page, t), `${t} off`); await click(pTypeBox(page, t), `${t} on`); }
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) { await click(pKindBox(page, k), `${k} off`); await click(pKindBox(page, k), `${k} on`); }
  await click(pNone(page), 'None');
  await click(GP(page).getByRole('button', { name: 'Show all types', exact: true }), 'Show all types');
  await openPopover(page);
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) await click(pKindBox(page, k), `${k} off`);
  await click(GP(page).getByRole('button', { name: 'Show everything', exact: true }), 'Show everything');
  await openPopover(page);
  await click(pAll(page), 'All');
  await click(pSizeBox(page), 'Size nodes by links');
  await closePopover(page);
  for (const k of [P.rozpocet, 'tag:účty', 'tag:nápad', P.den, P.graf]) { await clickNode(page, k, {}, GP(page)); await sleep(200); }
  await click(previewDialog(page, 'Graf výdajů').getByRole('button', { name: 'In full graph', exact: true }), 'In full graph');
  await page.keyboard.press('Meta+BracketLeft');
  await clickNode(page, P.rozpocet, { double: true }, GP(page));
  await page.keyboard.press('Meta+BracketLeft');
  await searchOpen(page, 'Osamělá');
  await searchOpen(page, 'Rozcestník');
  await chooseDepth(page, 2);
  await click(lowerBtn(page, 1, 41), '`Depth 1 · 41`', 8000);
  await waitIn(page, 41, 5000);
  const sep = await must(page.getByRole('separator', { name: 'Resize panel' }), 'separator "Resize panel"');
  await sep.focus();
  await page.keyboard.press('ArrowLeft');
  await sleep(500);
  assert.equal(await core.writes(), 0, 'zero write commands to the fake core');
  assert.equal(JSON.stringify(await core.files()), filesBefore, 'every vault file as before');
  const odd = (await core.calls()).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:') && c !== 'ui_state_set' && /write|create|trash|rename|delete|patch/.test(c));
  assert.deepEqual(odd, [], 'no write command at all');
  assert.ok((await requests(core)).some((r) => r.cap === 60), 'the panel asked graph_neighbourhood with cap 60');
});

test('fr_ux_03_ac21_panel_graph_commands', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  await runCommand(page, 'Graph: Depth 2');
  assert.equal((await waitIn(page, 19)).length, 19, '`Graph: Depth 2` sets the panel\'s depth');
  assert.equal(await eventually(async () => (await panelStored(core))?.depth, (d) => d === 2, 2000), 2, 'stored, as the popover');
  assert.equal(await listed(page, 'Graph: Recenter'), false, '`Graph: Recenter` is not listed on a note');
  assert.equal(await listed(page, 'Show local graph'), true, '`Show local graph` is listed');
  const reach = async (loc: ReturnType<typeof trigger>, what: string) => {
    const el = await must(loc, what);
    const ok = (await el.getAttribute('data-command')) !== null || await el.evaluate((e) => { (e as HTMLElement).focus(); return e === document.activeElement; });
    assert.ok(ok, `${what}: a registered command or reachable by Tab (FR-UX-03 AC-8)`);
  };
  await reach(graphTab(page), 'the Graph tab');
  assert.equal(await graphTab(page).getAttribute('data-command'), 'panel.graph', 'the tab carries data-command="panel.graph"');
  await reach(trigger(page), 'the trigger');
  await reach(openFullBtn(page), '`Open full view`');
  assert.equal(await openFullBtn(page).first().getAttribute('data-command'), 'graph.open', '`Open full view` carries data-command="graph.open"');
  await openPopover(page);
  for (const [loc, what] of [[depthRadio(page, 1), 'radio 1'], [depthRadio(page, 3), 'radio 3'], [pTypeBox(page, 'Pages'), 'Pages'], [pKindBox(page, 'Links'), 'Links'], [pAll(page), 'All'], [pNone(page), 'None'], [pSizeBox(page), 'Size nodes by links']] as const) await reach(loc, what);
  await closePopover(page);
  await clickNode(page, P.zapis, {}, GP(page));
  const d = await mustPreview(page, 'Zápis z porady', 'a node preview');
  await reach(d.getByRole('button', { name: 'In full graph', exact: true }), '`In full graph`');
  await reach(d.getByRole('button', { name: /^Open\b/ }), '`Open`');
});

test('nfr_oth_02_ac13_panel_graph_strings_in_the_catalog', async ({ page }) => {
  await openPanel(page, P.plan, { prelude: pseudoLocale });
  await waitIn(page, 10);
  await click(GP(page).getByRole('button', { name: /^⟦?Depth and filters⟧?$/ }), 'the trigger (pseudo-locale)');
  await must(page.getByRole('dialog', { name: /^⟦Depth and filters⟧$/ }), 'the popover in ⟦ ⟧');
  const leaks = await page.evaluate(() => {
    const user = (e: Element | null) => !!e?.closest('[data-user-content]');
    const roots = [...document.querySelectorAll('[role="tabpanel"], [role="dialog"]')];
    if (roots.length === 0) return ['no tab panel'];
    const out: string[] = [];
    for (const r of roots) {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? '').trim();
        if (!t || user(n.parentElement) || /^[\d\s.,·:#%×]+$/.test(t)) continue;
        if (!/^⟦[\s\S]*⟧$/.test(t)) out.push(t);
      }
      for (const e of r.querySelectorAll('[aria-label], [aria-description]')) {
        for (const a of ['aria-label', 'aria-description']) {
          const l = e.getAttribute(a) ?? '';
          if (l && !user(e) && !l.includes('⟦')) out.push(`${a}: ${l}`);
        }
      }
    }
    return out;
  });
  assert.deepEqual(leaks, [], 'every visible text and accessible name of the Graph tab and its popover is in ⟦ ⟧ except user content');
  await page.keyboard.press('Escape');
  await clickNode(page, P.rozpocet, {}, GP(page));
  await must(page.getByRole('dialog', { name: /Preview/ }).getByRole('button', { name: /^⟦In full graph⟧$/ }), 'the preview\'s `In full graph` in ⟦ ⟧');
});
