// Slice G1, L5 (WebKit + fake core): the full view `graph/<path>` (docs/acceptance/graph.md R108…R113): the route,
// opening and history (FR-GRP-01 AC-10…AC-12, AC-14), edges and their lines (AC-3), the cap and its banners (AC-15…
// AC-17), labels and layout (AC-18, AC-19), loading and cancelling (AC-9, AC-24), Czech names (AC-26), the narrow
// window (AC-27), filters (FR-GRP-02 AC-1…AC-6), click and double-click (FR-GRP-03), icons, labels and zoom (FR-GRP-05
// AC-1…AC-3), the preview column (FR-GRP-06 AC-1…AC-4), node sizes (FR-GRP-07), tag pills (FR-GRP-08 AC-1…AC-3), no
// writes (FR-SYN-06 AC-38), commands (FR-UX-03 AC-20) and strings (NFR-OTH-02 AC-12). Interface
// docs/contracts/v1-graph.md §2…§8 (fake core `graph_neighbourhood` with `graphDelay`, `graphNotReady`, `graphCalls`)
// and v1-previews.md §3, §7 (the preview in the column). Fixture tests/fixtures/vaults/graph (its README, the hub of
// make-hub.mjs). Written from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and
// node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import {
  NFD, P, TITLE, allBtn, atDepth, banner, callsOf, canvas, canvasCentre, centerHereBtn, checked, click, clickEmpty, clickNode, depthBtn,
  depthGroup, drawn, drawnEdges, drawnKeys, edgeStyle, eventually, filters, filtersBtn, fitBtn, flat, fullState, graphHeading, graphRoute, graphVault,
  headingIs, headingText, hiddenStatus, isDisabled, kindBox, kindsGroup, loadingStatus, main, mainName, mainText, marks, must, nfc, nodeAt,
  nodeOf, nodePaint, noneBtn, opacity, openBtn, openGraph, pairOf, positions, pressed, previewCol, recenterBtn, routeReady, runCommand,
  samePlaces, seen, sizeBox, sleep, startGraph, tagNode, textOf, titleTab, tokenColour, typeBox, typeRows, typesGroup, ui, uiWrites,
  waitDrawn, zoomIn, zoomOut, absent, READMEROWS, VAULT_PATH,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

/** Plán at depth 2: every pair and its R108 style (fixture README, E1…E22, E27). */
const EDGES_D2: [string, string, string][] = [
  [P.plan, P.rozpocet, 'relation'], [P.plan, P.zapis, 'link'], [P.plan, P.shrnuti, 'embed'], [P.plan, P.graf, 'embed'], [P.plan, P.ukol, 'embed'],
  [P.plan, P.den, 'link'], [P.plan, 'tag:účty', 'tag'], [P.plan, 'tag:nápad', 'tag'], [P.recept, P.plan, 'link'], [P.rozpocet, P.jana, 'relation'],
  [P.rozpocet, P.vydaje, 'relation'], [P.rozpocet, 'tag:účty', 'tag'], [P.rozpocet, 'tag:finance', 'tag'], [P.zapis, P.jana, 'relation'],
  [P.zapis, P.petr, 'relation'], [P.zapis, P.rozpocet, 'embed'], [P.zapis, P.smlouva, 'embed'], [P.zapis, 'tag:cestování', 'tag'],
  [P.shrnuti, 'tag:archiv', 'tag'], [P.bez, P.shrnuti, 'link'], [P.chybna, P.shrnuti, 'link'],
];
/** R108 lines: width and whether dashed or dotted. */
const LINE: Record<string, { width: number; dashed: boolean }> = {
  embed: { width: 3, dashed: false }, relation: { width: 1.5, dashed: true }, link: { width: 1.5, dashed: false }, tag: { width: 1, dashed: true },
};

async function depth(page: Page, d: 1 | 2 | 3, n: number) {
  await click(depthBtn(page, d), `depth ${d}`);
  const k = await waitDrawn(page, n, 4000);
  assert.equal(k.length, n, `depth ${d}: ${n} nodes drawn (got ${k.length})`);
}
const navCalls = async (core: Awaited<ReturnType<typeof startGraph>>) => (await callsOf(core, 'nav_opened')).length;

// ------------------------------------------------------------------------------------------------ FR-GRP-01: route, opening, history

test('fr_grp_01_ac10_graph_route_title_and_nfc', async ({ page }) => {
  const core = await startGraph(page, { route: `graph/${NFD(P.plan)}` });
  await must(graphHeading(page), 'the full view of Plán from an NFD route', 8000);
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects'), `heading: ${await headingText(page)}`);
  await must(titleTab(page, 'Graph · Plán čtvrtletí'), 'the title bar\'s tab `Graph · Plán čtvrtletí`');
  assert.ok(await routeReady(core, graphRoute(P.plan)), 'route-ready for the NFC route');
  assert.ok(!(await marks(core)).some((m) => m.includes(NFD('Plán'))), 'no route is recorded in NFD');
  assert.equal(await navCalls(core), 0, 'showing the graph calls nav_opened zero times (D-138)');
  assert.ok(!(await seen(page.getByRole('complementary', { name: 'Context panel' }), 500)), 'no right panel on the graph route (D-988)');
  await page.keyboard.press('Meta+Backslash');
  await sleep(300);
  assert.ok(!(await seen(page.getByRole('complementary', { name: 'Context panel' }), 300)), '⌘\\ does nothing there');
  await depth(page, 2, 19);
  const s = (await core.uiState()) as any;
  assert.deepEqual(Object.keys(s?.vaults ?? {}), [nfc(VAULT_PATH)], 'the `vaults` key is the NFC vault path (D-993)');
});

test('fr_grp_01_ac11_cmd_shift_g_and_palette_open_the_full_view', async ({ page }) => {
  const core = await startGraph(page, { at: P.plan });
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 5000);
  await page.keyboard.press('Meta+Shift+g');
  await must(graphHeading(page), '⌘⇧G opens the full view', 5000);
  assert.ok(await routeReady(core, graphRoute(P.plan)), 'graph/Pages/Plán čtvrtletí.md');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 3000), 'Plán čtvrtletí', 'Back returns to the note (a history entry, D-970)');
  await runCommand(page, 'Open graph');
  await must(graphHeading(page), 'the palette\'s `Open graph`', 5000);
});

for (const [route, target] of [['daily/2026-10-07', P.den], [`tag/${encodeURIComponent('účty')}`, P.fUcty], [`note/${P.graf}`, P.graf]] as const) {
  test(`fr_grp_01_ac11_cmd_shift_g_and_palette_open_the_full_view_from_${route.split('/')[0]}`, async ({ page }) => {
    const core = await startGraph(page, { route });
    await sleep(800);
    await page.keyboard.press('Meta+Shift+g');
    await must(graphHeading(page), `⌘⇧G on ${route}`, 5000);
    assert.ok(await routeReady(core, graphRoute(target)), `opens graph/${target}`);
  });
}

for (const route of ['daily/2026-10-30', 'tag/n%C3%A1pad', 'new/page', 'search', 'tasks', 'type/page']) {
  test(`fr_grp_01_ac11_cmd_shift_g_and_palette_open_the_full_view_disabled_on_${route.replace(/[^a-z0-9-]+/gi, '_')}`, async ({ page }) => {
    const core = await startGraph(page, { route });
    await sleep(800);
    await page.keyboard.press('Meta+k');
    await must(page.getByRole('dialog', { name: 'Command palette' }), 'the palette');
    await page.getByRole('combobox', { name: 'Command query' }).fill('Open graph');
    const opt = await must(page.getByRole('listbox', { name: 'Commands' }).getByRole('option').filter({ hasText: 'Open graph' }), '`Open graph` listed');
    assert.equal(await opt.getAttribute('aria-disabled'), 'true', `Open graph is aria-disabled on ${route} (D-987)`);
    await page.keyboard.press('Escape');
    const before = (await marks(core)).length;
    await page.keyboard.press('Meta+Shift+g');
    await sleep(500);
    assert.ok(!(await marks(core)).slice(before).some((m) => m.startsWith('route-ready:graph/')), '⌘⇧G does nothing');
    assert.ok(!(await seen(page.getByRole('alertdialog'), 300)), 'and shows no error');
  });
}

test('fr_grp_01_ac12_center_here_and_recenter_push_history', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  assert.equal(await isDisabled(recenterBtn(page)), true, 'Recenter is aria-disabled with nothing selected (D-984)');
  await clickNode(page, P.plan);
  assert.equal(await isDisabled(recenterBtn(page)), true, 'and with the centre selected');
  await clickNode(page, P.rozpocet);
  await click(centerHereBtn(page), 'Center graph here');
  assert.ok(await headingIs(page, 'Local graph of Rozpočet 2027 · 7 objects'), `heading after centring: ${await headingText(page)}`);
  await must(titleTab(page, 'Graph · Rozpočet 2027'), 'tab title');
  assert.ok(await routeReady(core, graphRoute(P.rozpocet)), 'route graph/Projekty/Rozpočet 2027.md');
  assert.deepEqual(await drawnKeys(page), [P.plan, P.rozpocet, P.zapis, P.jana, P.vydaje, 'tag:účty', 'tag:finance'].map(nfc).sort(), 'depth 1 of Rozpočet');
  assert.ok(!(await drawn(page)).some((n) => n.selected), 'nothing is selected after centring (D-983)');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects'), 'Back returns to Plán');
  await page.keyboard.press('Meta+BracketRight');
  assert.ok(await headingIs(page, 'Local graph of Rozpočet 2027 · 7 objects'), 'Forward to Rozpočet');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects'), 'Back again');
  await clickNode(page, P.rozpocet);
  await click(recenterBtn(page), 'Recenter with Rozpočet selected');
  assert.ok(await headingIs(page, 'Local graph of Rozpočet 2027 · 7 objects'), 'Recenter does the same');
});

test('fr_grp_01_ac14_depth_defaults_to_one_and_is_remembered', async ({ page, browser }) => {
  const core = await openGraph(page, P.plan);
  assert.equal(await pressed(depthBtn(page, 1)), 'true', 'depth 1 pressed with no stored state (D-905)');
  assert.equal((await uiWrites(core)).length, 0, 'nothing written on open');
  await depth(page, 2, 19);
  assert.equal(await pressed(depthBtn(page, 2)), 'true', 'depth 2 pressed');
  assert.equal((await uiWrites(core)).length, 1, 'one ui_state_set for the change');
  assert.equal((await fullState(core))?.depth, 2, 'graph.full.depth = 2 for this vault (D-993)');
  assert.equal(await core.writes(), 0, 'no vault write (FR-SYN-06 AC-38)');
  // The next graph, any centre, in a new page with the stored state: depth 2; another vault: depth 1.
  const p2 = await browser.newPage();
  await openGraph(p2, P.den, { uiState: (await core.uiState())! });
  assert.equal(await pressed(depthBtn(p2, 2)), 'true', 'the next graph starts at depth 2');
  await p2.close();
  const p3 = await browser.newPage();
  const other = { ...graphVault(), name: 'Jiný' };
  await openGraph(p3, P.plan, { vault: other, uiState: (await core.uiState())! });
  assert.equal(await pressed(depthBtn(p3, 1)), 'true', 'a second vault still starts at depth 1');
  await p3.close();
  for (const bad of [7, 'dva', null]) {
    const p4 = await browser.newPage();
    const c4 = await openGraph(p4, P.plan, { graph: { depth: bad } });
    assert.equal(await pressed(depthBtn(p4, 1)), 'true', `a stored depth ${JSON.stringify(bad)} reads as 1`);
    assert.equal((await uiWrites(c4)).length, 0, 'and isn\'t rewritten');
    await p4.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01: edges, cap, labels, layout

test('fr_grp_01_ac3_one_edge_per_pair_in_the_strongest_style', async ({ page }) => {
  await openGraph(page, P.plan);
  await depth(page, 2, 19);
  const all = await drawnEdges(page);
  assert.equal(all.length, 21, `21 [data-graph-edge] at depth 2 (got ${all.length})`);
  assert.equal(new Set(all.map((e) => e.pair)).size, 21, 'one per pair');
  for (const [a, b, style] of EDGES_D2) {
    const e = pairOf(all, a, b);
    assert.equal(e?.style, style, `${a} – ${b}: data-style ${style}`);
    const cs = await edgeStyle(page, a, b);
    assert.ok(cs, `${a} – ${b}: computed style`);
    assert.equal(parseFloat(cs!.width), LINE[style].width, `${a} – ${b}: ${LINE[style].width} px (R108)`);
    assert.equal(cs!.dash !== 'none' && cs!.dash !== '', LINE[style].dashed, `${a} – ${b}: ${LINE[style].dashed ? 'dashed or dotted' : 'solid'}`);
  }
  const arrows = await canvas(page).evaluate((svg) => svg.querySelectorAll('marker, [marker-start], [marker-end]').length
    + [...svg.querySelectorAll('[data-graph-edge]')].filter((e) => { const s = getComputedStyle(e); return (s.markerStart && s.markerStart !== 'none') || (s.markerEnd && s.markerEnd !== 'none'); }).length);
  assert.equal(arrows, 0, 'no arrowheads (D-902)');
});

test('fr_grp_01_ac15_cap_keeps_the_most_connected_150', async ({ page }) => {
  const core = await openGraph(page, P.rozcestnik, { vault: graphVault({ hub: true }) });
  assert.equal((await waitDrawn(page, 41, 6000)).length, 41, 'depth 1: 41 nodes');
  assert.ok(!(await seen(banner(page), 500)), 'no banner at depth 1');
  await depth(page, 2, 150);
  assert.equal((await drawnEdges(page)).length, 149, '149 edges');
  const keys = await drawnKeys(page);
  for (let n = 30; n <= 40; n++) assert.ok(!keys.includes(nfc(`Pages/Hub/Uzel ${n}-c.md`)), `Uzel ${n}-c is not drawn`);
  for (let n = 1; n <= 29; n++) assert.ok(keys.includes(nfc(`Pages/Hub/Uzel ${String(n).padStart(2, '0')}-c.md`)), `Uzel ${n}-c is drawn`);
  assert.ok(await headingIs(page, 'Local graph of Rozcestník · 150 of 161 objects'), `heading: ${await headingText(page)}`);
  const b = flat(await textOf(banner(page)));
  assert.ok(b.includes('161 objects at depth 2.') && b.includes('Showing the 150 most connected; labels hidden.'), `banner: ${b}`);
  await must(main(page).getByRole('button', { name: 'Filter types…', exact: true }), '`Filter types…`');
  await must(main(page).getByRole('button', { name: 'Show all', exact: true }), '`Show all`');
  await click(main(page).getByRole('button', { name: 'Filter types…', exact: true }), 'Filter types…');
  assert.equal(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()), 'All', 'the focus moves to the Types `All` button');
  await click(main(page).getByRole('button', { name: 'Depth 1 · 41', exact: true }), '`Depth 1 · 41`');
  assert.equal((await waitDrawn(page, 41)).length, 41, 'back at depth 1');
  assert.equal((await fullState(core))?.depth, 1, 'and remembered');
});

test('fr_grp_01_ac16_show_all_once_and_not_above_1000', async ({ page, browser }) => {
  const vault = graphVault({ hub: true });
  const core = await openGraph(page, P.rozcestnik, { vault });
  await depth(page, 2, 150);
  await click(main(page).getByRole('button', { name: 'Show all', exact: true }), 'Show all');
  assert.equal((await waitDrawn(page, 161, 5000)).length, 161, 'Show all draws 161');
  assert.equal((await drawnEdges(page)).length, 160, '160 edges');
  assert.equal(flat(await textOf(banner(page))), 'Showing all 161 objects.', 'the banner (D-979)');
  assert.ok(!JSON.stringify(await core.uiState()).includes('showAll'), 'ui-state.json holds no show-all value');
  await depth(page, 1, 41);
  await depth(page, 2, 150);
  await depth(page, 3, 150);
  const b = flat(await textOf(banner(page)));
  assert.ok(b.includes('1,361 objects at depth 3.') && b.includes('Too many to show at once: choose a lower depth or filter types.'), `banner above 1,000: ${b}`);
  await must(main(page).getByRole('button', { name: 'Depth 2 · 161', exact: true }), '`Depth 2 · 161`');
  assert.ok(!(await seen(main(page).getByRole('button', { name: 'Show all', exact: true }), 300)), 'no `Show all` above 1,000');
  const p2 = await browser.newPage();
  await openGraph(p2, P.rozcestnik, { vault, region: 'cs', uiState: (await core.uiState())! });
  await waitDrawn(p2, 150, 6000);
  assert.ok(flat(await textOf(banner(p2))).includes('1 361 objects at depth 3.'), 'the region\'s grouping in `cs`');
  await p2.close();
});

test('fr_grp_01_ac17_depth_one_is_never_cut', async ({ page }) => {
  await openGraph(page, P.siroky, { vault: graphVault({ hub: true }) });
  assert.equal((await waitDrawn(page, 161, 6000)).length, 161, 'depth 1: all 161 nodes');
  assert.equal((await drawnEdges(page)).length, 160, '160 edges');
  assert.ok(!(await seen(banner(page), 500)), 'no banner');
  assert.equal(await nodeLabelsShown(page), 1, 'labels hidden (above 60), except the centre');
  await depth(page, 2, 161);
  const b = flat(await textOf(banner(page)));
  assert.ok(b.includes('241 objects at depth 2.') && b.includes('Showing the 161 most connected; labels hidden.'), `banner: ${b}`);
  await must(main(page).getByRole('button', { name: 'Depth 1 · 161', exact: true }), '`Depth 1 · 161`');
  await click(main(page).getByRole('button', { name: 'Show all', exact: true }), 'Show all');
  assert.equal((await waitDrawn(page, 241, 5000)).length, 241, 'Show all draws 241');
});

/** Labels shown: the number of drawn nodes whose label element is visible. */
async function nodeLabelsShown(page: Page): Promise<number> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).filter((g) => {
    const t = g.querySelector('text');
    if (!t) return false;
    const s = getComputedStyle(t);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && t.getBoundingClientRect().width > 0;
  }).length).catch(() => -1);
}

test('fr_grp_01_ac18_labels_hide_above_sixty_and_return_on_zoom_or_hover', async ({ page, browser }) => {
  const long = 'Velmi dlouhý název poznámky o rozpočtu, plánování čtvrtletí a všech dalších věcech pro celý tým';
  const vault = graphVault({ edit: (f) => { f['Pages/Dlouhý název.md'] = `---\nid: 01JBGR0000000000000000R033\ntype: page\ntitle: ${long}\n---\nViz [[Plán čtvrtletí]].\n`; } });
  await openGraph(page, P.plan, { vault });
  for (const [d, n] of [[1, 11], [2, 20], [3, 23]] as const) {
    if (d > 1) await depth(page, d, n);
    assert.equal(await nodeLabelsShown(page), n, `depth ${d}: every label shown (≤ 60 nodes)`);
  }
  const label = await nodeAt(page, 'Pages/Dlouhý název.md').locator('text').first().evaluate((t) => ({ w: (t as SVGGraphicsElement).getBoundingClientRect().width, s: (t.textContent ?? '').trim() })).catch(() => ({ w: 999, s: '' }));
  assert.ok(label.w <= 150.5 && label.s.endsWith('…'), `a long label is cut at 150 px with …: ${JSON.stringify(label)}`);
  assert.equal(await nodeAt(page, 'Pages/Dlouhý název.md').getAttribute('aria-label'), `${long}, Page`, 'the full title stays in the accessible name');
  const p2 = await browser.newPage();
  await openGraph(p2, P.rozcestnik, { vault: graphVault({ hub: true }) });
  await waitDrawn(p2, 41, 6000);
  assert.equal(await nodeLabelsShown(p2), 41, 'Rozcestník at depth 1 (41): labels shown');
  await depth(p2, 2, 150);
  assert.equal(await nodeLabelsShown(p2), 1, '150 nodes at 100 %: only the centre\'s label');
  await clickNode(p2, 'Pages/Hub/Paprsek 01.md');
  assert.equal(await nodeLabelsShown(p2), 2, 'and the selected node\'s');
  const box = await nodeAt(p2, 'Pages/Hub/Paprsek 02.md').boundingBox();
  assert.ok(box, 'Paprsek 02 has a box');
  await p2.mouse.move(box!.x + box!.width / 2, box!.y + 8);
  assert.equal(await eventually(() => nodeLabelsShown(p2), (n) => n === 3, 1000), 3, 'and the hovered node\'s');
  await click(zoomIn(p2), 'Zoom in (125 %)');
  await click(zoomIn(p2), 'Zoom in (156 %)');
  assert.equal(await eventually(() => nodeLabelsShown(p2), (n) => n === 150, 1000), 150, 'zoomed to ≥ 150 %: every label');
  for (let i = 0; i < 4; i++) await click(zoomOut(p2), 'Zoom out');
  await p2.mouse.move(1, 1);
  assert.equal(await eventually(() => nodeLabelsShown(p2), (n) => n === 2, 1000), 2, 'below 60 %: only the centre\'s and the selected node\'s');
  await p2.close();
});

test('fr_grp_01_ac19_seeded_layout_centre_pinned_at_rest', async ({ page, browser }) => {
  const net: string[] = [];
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://localhost')) net.push(r.url()); });
  const core = await openGraph(page, P.plan);
  await depth(page, 2, 19);
  const c = await canvasCentre(page);
  const pos = await positions(page);
  assert.ok(c && pos[nfc(P.plan)] && Math.abs(pos[nfc(P.plan)].x - c.x) <= 0.5 && Math.abs(pos[nfc(P.plan)].y - c.y) <= 0.5, `the centre at the canvas centre: ${JSON.stringify(pos[nfc(P.plan)])} / ${JSON.stringify(c)}`);
  assert.ok(await eventually(async () => (await marks(core)).includes('graph-ready'), (x) => x, 3000), 'graph-ready mark');
  const samples: Record<string, { x: number; y: number }>[] = [];
  for (let i = 0; i < 30; i++) { samples.push(await positions(page)); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null)))); }
  for (const s of samples) assert.deepEqual(samePlaces(samples[0], s, 0), [], 'no node moves after graph-ready');
  const p2 = await browser.newPage();
  await openGraph(p2, P.plan, { graph: { depth: 2 } });
  await waitDrawn(p2, 19);
  assert.deepEqual(samePlaces(pos, await positions(p2), 0.01), [], 'the same positions in a second page load (± 0.01 px)');
  await p2.close();
  for (const reduce of ['reduce', 'no-preference'] as const) {
    const p3 = await browser.newPage();
    await p3.emulateMedia({ reducedMotion: reduce });
    await openGraph(p3, P.plan);
    await waitDrawn(p3, 10);
    const a = await positions(p3);
    await sleep(500);
    assert.deepEqual(samePlaces(a, await positions(p3), 0), [], `at rest at the first paint (${reduce})`);
    await p3.close();
  }
  assert.ok(!JSON.stringify(await core.uiState()).match(/"x"|positions/), 'positions aren\'t stored (D-913)');
  assert.deepEqual(net, [], 'no network request (NFR-SEC-01)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01: loading, cancel

/** Records, in the page, when the loading text first appears (Date.now) — before the app's scripts run. */
async function watchLoading(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__loadingSeen = [] as number[];
    const check = () => { if ((document.body?.textContent ?? '').includes('Building the graph…') || document.querySelector('[data-graph-skeleton]')) w.__loadingSeen.push(Date.now()); };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

test('fr_grp_01_ac24_loading_state_after_300_ms', async ({ page }) => {
  await watchLoading(page);
  const core = await openGraph(page, P.plan, { realTime: true });
  await waitDrawn(page, 10);
  await core.graphDelay(250);
  await page.evaluate(() => { (window as any).__loadingSeen = []; });
  await click(depthBtn(page, 2), 'depth 2');
  assert.equal((await waitDrawn(page, 19, 3000)).length, 19, 'the graph appears when the 250 ms answer arrives');
  assert.deepEqual(await page.evaluate(() => (window as any).__loadingSeen.length), 0, 'no loading element at any time for 250 ms');
  await core.graphDelay(800);
  await page.evaluate(() => { (window as any).__loadingSeen = []; });
  const n0 = (await core.graphCalls()).length;
  await click(depthBtn(page, 3), 'depth 3');
  await must(loadingStatus(page), 'the loading state', 1500);
  const calls = await callsOf(core, 'graph_neighbourhood');
  const sent = calls[calls.length - 1]?.at ?? 0;
  const first = await page.evaluate(() => (window as any).__loadingSeen[0] as number);
  assert.ok(first - sent >= 300 - 17, `loading appears no earlier than 300 ms after the request (± 1 frame): ${first - sent} ms`);
  assert.equal(await isDisabled(depthBtn(page, 1)), false, 'depth buttons stay enabled');
  assert.equal((await waitDrawn(page, 22, 3000)).length, 22, 'replaced by the graph');
  assert.ok((await core.graphCalls()).length > n0, 'one more request');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await click(depthBtn(page, 1), 'depth 1');
  await click(depthBtn(page, 2), 'depth 2 with Reduce motion');
  await must(loadingStatus(page), 'the loading state again', 1500);
  const anims = await page.evaluate(() => (document.getAnimations?.() ?? []).filter((a) => a.playState === 'running').length);
  assert.equal(anims, 0, 'its ring doesn\'t rotate under Reduce motion');
});

test('fr_grp_01_ac9_new_request_cancels_the_old', async ({ page }) => {
  const core = await openGraph(page, P.rozcestnik, { vault: graphVault({ hub: true }), realTime: true });
  await waitDrawn(page, 41, 6000);
  await core.graphDelay(1500);
  await click(depthBtn(page, 3), 'depth 3');
  await must(loadingStatus(page), 'the loading state (board GraphStates 2)', 1500);
  await core.graphDelay(0);
  await click(depthBtn(page, 1), 'depth 1 while loading');
  assert.equal((await waitDrawn(page, 41, 3000)).length, 41, 'the depth-1 result: 41 nodes');
  await sleep(2000);
  assert.equal((await drawnKeys(page)).length, 41, 'the depth-3 answer, if it arrives, is dropped');
  assert.equal(await pressed(depthBtn(page, 1)), 'true', 'depth 1 stays pressed');
  const reqs = (await core.graphCalls()) as any[];
  assert.equal(reqs[reqs.length - 1]?.depth, 1, 'the last request is depth 1');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01: Czech names, narrow window

test('fr_grp_01_ac26_nfd_names_and_links_are_one_node', async ({ page, browser }) => {
  const nfdLink = `---\nid: 01JBGR0000000000000000R030\ntype: page\ntitle: NFD odkaz\ncreated: 2026-10-28T09:00:00+01:00\nmodified: 2026-10-28T09:00:00+01:00\n---\nOdkaz na [[${NFD('Plán čtvrtletí')}]].\n`;
  const vault = graphVault({ edit: (f) => { f['Pages/NFD odkaz.md'] = nfdLink; } });
  await openGraph(page, P.plan, { vault });
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 11 objects'), `heading: ${await headingText(page)}`);
  const e = pairOf(await drawnEdges(page), 'Pages/NFD odkaz.md', P.plan);
  assert.equal(e?.style, 'link', 'one link edge to Plán');
  assert.equal((await drawn(page)).filter((n) => n.name.startsWith('Plán čtvrtletí')).length, 1, 'not a second Plán');
  const en = await drawnKeys(page);
  for (const k of en) assert.equal(k, nfc(k), 'NFC keys');
  const p2 = await browser.newPage();
  await openGraph(p2, P.plan, { vault, region: 'cs' });
  assert.deepEqual(await drawnKeys(p2), en, 'the same result with region cs');
  assert.deepEqual(samePlaces(await positions(page), await positions(p2), 0.01), [], 'and the same layout');
  await p2.close();
});

test('fr_grp_01_ac27_narrow_window_filters_popover_and_preview_overlay', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await openGraph(page, P.plan);
  assert.ok(!(await seen(filters(page), 500)), 'the filter column is not shown below 960 px');
  const btn = await must(filtersBtn(page), 'the `Filters` button (D-988)');
  assert.equal(await btn.getAttribute('aria-haspopup'), 'dialog', 'aria-haspopup="dialog"');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded false');
  await btn.click();
  await must(typesGroup(page), 'the popover with the Types fieldset');
  await must(kindsGroup(page), 'and Connections');
  assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded true');
  await page.keyboard.press('Escape');
  assert.ok(await absent(typesGroup(page), 1000), 'Esc closes it');
  assert.equal(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()), 'Filters', 'the focus returns to the button');
  await btn.click();
  await click(typeBox(page, 'Tags'), 'untick Tags in the popover');
  assert.equal((await waitDrawn(page, 8)).length, 8, 'a filter change redraws');
  await clickEmpty(page);
  assert.ok(await absent(typesGroup(page), 1000), 'a click outside closes it');
  const before = await canvas(page).boundingBox();
  await clickNode(page, P.rozpocet);
  await must(previewCol(page), 'the preview column over the canvas');
  const after = await canvas(page).boundingBox();
  assert.deepEqual(after, before, 'the canvas keeps its size');
  const col = await previewCol(page).boundingBox();
  assert.ok(col && before && Math.abs(col.x + col.width - (before.x + before.width)) <= 1, 'from the right edge');
  const node = await nodeAt(page, P.rozpocet).boundingBox();
  assert.ok(node && col && node.x + node.width <= col.x, 'the node stays visible');
  await page.keyboard.press('Escape');
  assert.ok(await absent(previewCol(page), 1000), 'Esc closes the preview overlay');
  await page.setViewportSize({ width: 1440, height: 980 });
  assert.ok(!(await seen(filtersBtn(page), 500)), 'at 1,440 × 980 the button is absent');
  await must(filters(page), 'both columns beside the canvas');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02

test('fr_grp_02_ac1_type_list_order_and_counts', async ({ page }) => {
  await openGraph(page, P.plan);
  const rows = await typeRows(page);
  assert.deepEqual(rows.map((r) => r.replace(/\s*\d+$/, '')), READMEROWS, 'the D-977 order');
  assert.deepEqual(rows.map((r) => Number(/(\d+)$/.exec(r)?.[1] ?? NaN)), [2, 1, 0, 1, 0, 0, 1, 1, 1, 0, 2, 1], 'counts at depth 1');
  await depth(page, 2, 19);
  assert.deepEqual((await typeRows(page)).map((r) => Number(/(\d+)$/.exec(r)?.[1] ?? NaN)), [5, 1, 0, 1, 0, 2, 1, 1, 1, 1, 5, 1], 'counts at depth 2');
  await click(typeBox(page, 'Tags'), 'untick Tags');
  await waitDrawn(page, 14);
  assert.deepEqual((await typeRows(page)).map((r) => Number(/(\d+)$/.exec(r)?.[1] ?? NaN)), [5, 1, 0, 1, 0, 2, 1, 1, 1, 1, 5, 1], 'counts don\'t change with a filter (D-976)');
  const muted = await tokenColour(page, 'muted');
  const zero = await typesGroup(page).locator('label, [role="checkbox"]').filter({ hasText: /^Cesty/ }).first().evaluate((e) => {
    const c = [...e.querySelectorAll('*')].reverse().find((x) => /^\d+$/.test((x.textContent ?? '').trim()));
    return c ? getComputedStyle(c).color : null;
  }).catch(() => null);
  assert.equal(zero, muted, 'a 0 count is muted');
});

test('fr_grp_02_ac2_hidden_types_are_not_walked', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await click(typeBox(page, 'Tags'), 'untick Tags');
  assert.equal((await waitDrawn(page, 8)).length, 8, 'Tags off d1: 8 nodes');
  assert.equal((await drawnEdges(page)).length, 8, '8 edges');
  assert.equal(flat(await textOf(hiddenStatus(page))), '2 hidden', '`2 hidden`');
  await depth(page, 2, 14);
  assert.equal((await drawnEdges(page)).length, 15, '15 edges');
  assert.equal(flat(await textOf(hiddenStatus(page))), '5 hidden', '`5 hidden`');
  await click(typeBox(page, 'Tags'), 'tick Tags again');
  await click(typeBox(page, 'Projekty'), 'untick Projekty');
  const k = await waitDrawn(page, 16);
  assert.equal(k.length, 16, 'Projekty off d2: 16 nodes');
  for (const gone of [P.rozpocet, P.vydaje, 'tag:finance']) assert.ok(!k.includes(nfc(gone)), `${gone} not drawn`);
  assert.equal((await drawnEdges(page)).length, 15, '15 edges');
  assert.equal(flat(await textOf(hiddenStatus(page))), '3 hidden', '`3 hidden`');
  await click(typeBox(page, 'Projekty'), 'tick Projekty');
  await depth(page, 1, 10);
  await click(typeBox(page, 'Pages'), 'untick Pages');
  const g = await waitDrawn(page, 9);
  assert.ok(g.includes(nfc(P.plan)) && !g.includes(nfc(P.shrnuti)), 'Plán stays, Shrnutí hidden');
  assert.equal(flat(await textOf(hiddenStatus(page))), '1 hidden', '`1 hidden`');
  const last = ((await core.graphCalls()) as any[]).at(-1);
  assert.deepEqual(last?.hiddenTypes, ['page'], 'the request carries the hidden keys');
});

test('fr_grp_02_ac3_connection_toggles_both_directions', async ({ page }) => {
  await openGraph(page, P.plan);
  await depth(page, 2, 19);
  await click(kindBox(page, 'Relations'), 'Relations off');
  const k = await waitDrawn(page, 16);
  for (const gone of [P.jana, P.petr, P.vydaje]) assert.ok(!k.includes(nfc(gone)), `${gone} hidden`);
  assert.equal((await drawnEdges(page)).length, 17, '17 edges');
  assert.equal(flat(await textOf(hiddenStatus(page))), '3 hidden', '`3 hidden`');
  const all = await drawnEdges(page);
  assert.equal(pairOf(all, P.plan, P.rozpocet)?.style, 'link', 'Plán–Rozpočet drawn as link (D-973)');
  assert.equal(pairOf(all, P.plan, P.ukol)?.style, 'embed', 'Plán–Úkol embed');
  assert.equal(pairOf(all, P.zapis, P.rozpocet)?.style, 'embed', 'Zápis–Rozpočet embed');
  await click(kindBox(page, 'Relations'), 'Relations on');
  await depth(page, 1, 10);
  await click(kindBox(page, 'Links'), 'Links off');
  assert.deepEqual(await waitDrawn(page, 7), [P.plan, P.rozpocet, P.shrnuti, P.graf, P.ukol, 'tag:účty', 'tag:nápad'].map(nfc).sort(), 'Links off d1: 7 nodes');
  assert.equal(flat(await textOf(hiddenStatus(page))), '3 hidden', '`3 hidden` (Recept goes with Zápis and Den)');
  await click(kindBox(page, 'Links'), 'Links on');
  await click(kindBox(page, 'Tags'), 'Tags kind off');
  assert.equal((await waitDrawn(page, 8)).length, 8, 'Tags kind off: 8 nodes');
  assert.equal((await drawnEdges(page)).length, 8, '8 edges');
  assert.equal(flat(await textOf(hiddenStatus(page))), '2 hidden', '`2 hidden`');
  assert.equal(await checked(typeBox(page, 'Tags')), true, 'the Tags type stays ticked');
});

test('fr_grp_02_ac4_all_none_and_all_hidden', async ({ page }) => {
  await openGraph(page, P.plan);
  await click(noneBtn(page), 'None');
  assert.deepEqual(await waitDrawn(page, 1), [nfc(P.plan)], 'Plán alone');
  assert.ok((await mainText(page)).includes('All 9 linked objects are hidden by the type filter.'), 'the type-filter text');
  await click(main(page).getByRole('button', { name: 'Show all types', exact: true }), 'Show all types');
  assert.equal((await waitDrawn(page, 10)).length, 10, 'every type ticked again');
  await click(noneBtn(page), 'None');
  await click(allBtn(page), 'All');
  assert.equal((await waitDrawn(page, 10)).length, 10, '`All` ticks every type');
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) await click(kindBox(page, k), `${k} off`);
  await waitDrawn(page, 1);
  assert.ok((await mainText(page)).includes('All 9 linked objects are hidden by the filters.'), 'the filters text (D-991)');
  await click(main(page).getByRole('button', { name: 'Show everything', exact: true }), 'Show everything');
  assert.equal((await waitDrawn(page, 10)).length, 10, 'every type and kind back on');
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) assert.equal(await checked(kindBox(page, k)), true, `${k} on`);
  await depth(page, 2, 19);
  await click(noneBtn(page), 'None at depth 2');
  await waitDrawn(page, 1);
  assert.ok((await mainText(page)).includes('All 18 linked objects are hidden by the type filter.'), 'depth 2: 18');
});

test('fr_grp_02_ac5_filters_remembered_per_view_and_vault', async ({ page, browser }) => {
  const core = await openGraph(page, P.plan);
  await click(typeBox(page, 'Tags'), 'untick Tags');
  await waitDrawn(page, 8);
  await click(kindBox(page, 'Relations'), 'Relations off');
  await waitDrawn(page, 8);
  const w = await uiWrites(core);
  assert.equal(w.length, 2, 'one write per change');
  const full = await fullState(core);
  assert.deepEqual([full?.hiddenTypes, full?.hiddenKinds], [['tag'], ['relation']], 'the hidden keys under graph.full (D-977)');
  assert.ok(!JSON.stringify(await core.uiState()).includes('"panel"'), 'graph.panel is never written by the full view');
  const kniha = 'version: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: blue\nreview: false\npreview: []\nattributes: []\n';
  const p2 = await browser.newPage();
  const stored = (await core.uiState()) as any;
  stored.vaults[VAULT_PATH].graph.full.hiddenTypes = ['tag', 'neznámý'];
  const c2 = await openGraph(p2, P.den, { uiState: stored, vault: graphVault({ edit: (f) => { f['.tegg/types/kniha.yml'] = kniha; } }) });
  assert.equal(await checked(typeBox(p2, 'Tags')), false, 'Tags stays hidden for another centre');
  assert.equal(await checked(typeBox(p2, 'Knihy')), true, 'a type created later is visible');
  await click(kindBox(p2, 'Links'), 'Links off');
  await sleep(300);
  assert.deepEqual((await fullState(c2))?.hiddenTypes, ['tag', 'neznámý'], 'an unknown key is ignored and kept');
  await p2.close();
  const p3 = await browser.newPage();
  await openGraph(p3, P.plan, { uiState: stored, vault: { ...graphVault(), name: 'Jiný' } });
  assert.equal(await checked(typeBox(p3, 'Tags')), true, 'another vault keeps its own filters');
  await p3.close();
});

test('fr_grp_02_ac6_filter_change_keeps_positions_and_selection', async ({ page }) => {
  await openGraph(page, P.plan);
  await depth(page, 2, 19);
  const before = await positions(page);
  await clickNode(page, P.rozpocet);
  await click(typeBox(page, 'Tags'), 'untick Tags');
  await waitDrawn(page, 14);
  const after = await positions(page);
  assert.deepEqual(samePlaces(before, after, 0.5, Object.keys(after)), [], 'nodes present before and after keep their positions (± 0.5 px)');
  assert.ok((await drawn(page)).find((n) => n.key === nfc(P.rozpocet))?.selected, 'the selection stays while Rozpočet is drawn');
  await click(typeBox(page, 'Projekty'), 'untick Projekty');
  await waitDrawn(page, 11);
  assert.ok(!(await drawn(page)).some((n) => n.selected), 'the selection clears when the node is no longer drawn');
  await must(previewCol(page).getByText('Click a node to preview it', { exact: true }), 'the column\'s empty state');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-03

test('fr_grp_03_ac1_click_selects_highlights_and_previews', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await depth(page, 2, 19);
  const n0 = (await core.calls()).length;
  await clickNode(page, P.rozpocet);
  assert.ok((await drawn(page)).find((n) => n.key === nfc(P.rozpocet))?.selected, 'data-selected on Rozpočet');
  const near = [P.plan, P.jana, P.vydaje, 'tag:účty', 'tag:finance', P.zapis, P.rozpocet].map(nfc);
  for (const k of await drawnKeys(page)) {
    const o = await eventually(() => opacity(page, k), (x) => x === (near.includes(k) ? 1 : 0.3), 1000);
    assert.equal(o, near.includes(k) ? 1 : 0.3, `${k}: opacity ${near.includes(k) ? 1 : 0.3}`);
  }
  const hl = await tokenColour(page, 'hl');
  for (const [a, b] of EDGES_D2) {
    const touches = a === P.rozpocet || b === P.rozpocet;
    const s = await edgeStyle(page, a, b);
    if (touches) assert.equal(s?.stroke, hl, `${a}–${b}: --hl`);
    else assert.equal(s?.opacity, 0.35, `${a}–${b}: 0.35`);
  }
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'the column previews Rozpočet');
  await clickNode(page, P.jana);
  assert.ok((await drawn(page)).find((n) => n.key === nfc(P.jana))?.selected, 'a click on Jana moves the selection');
  await clickEmpty(page);
  assert.ok(!(await drawn(page)).some((n) => n.selected), 'a click on empty canvas clears it (D-983)');
  const after = (await core.calls()).slice(n0).map((c) => c.cmd);
  assert.ok(!after.includes('nav_opened'), 'no nav_opened');
  assert.equal(await core.writes(), 0, 'no write');
});

for (const [k, route] of [[P.rozpocet, `note/${P.rozpocet}`], [P.den, 'daily/2026-10-07'], [P.graf, `note/${P.graf}`], ['tag:účty', 'tag/účty'], ['tag:nápad', 'tag/nápad']] as const) {
  test(`fr_grp_03_ac2_double_click_opens_the_object_${k.replace(/[^a-z0-9]+/gi, '_')}`, async ({ page }) => {
    const core = await openGraph(page, P.plan);
    await clickNode(page, k, { double: true });
    const want = route.startsWith('tag/') ? `tag/${encodeURIComponent(route.slice(4))}` : route;
    assert.ok(await routeReady(core, want, 4000) || await routeReady(core, route, 100), `opens ${route}`);
    if (!k.startsWith('tag:')) assert.equal((await callsOf(core, 'nav_opened')).length, 1, 'one nav_opened for an object');
    assert.equal(await core.writes(), 0, 'nothing written (no Tags/nápad.md)');
    await page.keyboard.press('Meta+BracketLeft');
    assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 4000), 'Back returns to the graph');
  });
}

test('fr_grp_03_ac2_double_click_opens_the_object_back_keeps_depth_filters_and_positions', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await depth(page, 2, 19);
  await click(typeBox(page, 'Tags'), 'untick Tags');
  await waitDrawn(page, 14);
  const before = await positions(page);
  await clickNode(page, P.rozpocet, { double: true });
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'note/Projekty/Rozpočet 2027.md');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal((await waitDrawn(page, 14, 4000)).length, 14, 'the same depth and filters after Back');
  assert.equal(await pressed(depthBtn(page, 2)), 'true', 'depth 2');
  assert.deepEqual(samePlaces(before, await positions(page), 0.5), [], 'the same positions');
});

test('fr_grp_03_ac3_cmd_double_click_opens_in_place_until_tabs', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const pages = page.context().pages().length;
  await clickNode(page, P.rozpocet, { double: true, meta: true });
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'opens Rozpočet in the current view (D-925, D-970)');
  assert.equal(page.context().pages().length, pages, 'no window or tab is created');
  assert.equal(await page.getByRole('tab').count(), 1, 'one title-bar tab');
});

for (const mode of ['hover', 'off'] as const) {
  test(`fr_grp_03_ac4_g1_uses_click_mode_and_hover_highlights_${mode}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { previewMode: mode });
    await must(main(page).getByText('Click to preview · double-click to open', { exact: true }), 'the hint (D-983)');
    const box = await (await must(nodeAt(page, P.rozpocet), 'Rozpočet')).boundingBox();
    assert.ok(box, 'Rozpočet has a box');
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
    await sleep(1600);
    assert.ok(!(await seen(page.locator('[data-preview-path]'), 200)), 'hovering never opens a preview in G1');
    assert.equal(await eventually(() => opacity(page, P.den), (x) => x === 0.3, 1000), 0.3, 'hovering Rozpočet dims Den, not its neighbour');
    assert.equal(await opacity(page, P.plan), 1, 'and keeps Plán, its neighbour');
    assert.ok(!(await drawn(page)).some((n) => n.selected), 'hover doesn\'t change the selection');
    await clickNode(page, P.rozpocet);
    await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'a click previews (click mode)');
    await clickNode(page, P.rozpocet, { double: true });
    assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a double-click opens');
  });
}

test('fr_grp_03_ac4_g1_uses_click_mode_and_hover_highlights_neighbours', async ({ page }) => {
  await openGraph(page, P.plan);
  await depth(page, 2, 19);
  const box = await (await must(nodeAt(page, P.jana), 'Jana')).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 10);
  const near = [P.jana, P.rozpocet, P.zapis].map(nfc);
  for (const k of await drawnKeys(page)) {
    const o = await eventually(() => opacity(page, k), (x) => x === (near.includes(k) ? 1 : 0.3), 1000);
    assert.equal(o, near.includes(k) ? 1 : 0.3, `hovering Jana: ${k} at ${near.includes(k) ? 1 : 0.3}`);
  }
  assert.ok(!(await drawn(page)).some((n) => n.selected), 'without selecting');
  assert.ok(!(await seen(previewCol(page).locator('[data-preview-path]'), 200)), 'nor previewing');
});

test('fr_grp_03_ac5_centre_node_previews_and_opens', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await clickNode(page, P.plan);
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.plan)}"]`), 'the centre previews');
  assert.equal(await isDisabled(centerHereBtn(page)), true, '`Center graph here` is aria-disabled for the centre');
  await clickNode(page, P.plan, { double: true });
  assert.ok(await routeReady(core, `note/${P.plan}`, 4000), 'a double-click opens note/Pages/Plán čtvrtletí.md');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-05

const TYPE_PAINT: [string, string, string][] = [
  [P.plan, 'file-text', 'gray'], [P.shrnuti, 'file-text', 'gray'], [P.vydaje, 'file-text', 'gray'], [P.bez, 'file-text', 'gray'], [P.chybna, 'file-text', 'gray'],
  [P.rozpocet, 'folder', 'orange'], [P.beta, 'folder', 'orange'], [P.zapis, 'users', 'teal'], [P.jana, 'user', 'purple'], [P.petr, 'user', 'purple'],
  [P.ukol, 'check-square', 'blue'], [P.den, 'calendar', 'purple'], [P.graf, 'image', 'teal'], [P.smlouva, 'file', 'red'], [P.vylet, 'zap', 'yellow'],
  [P.recept, 'file-text', 'gray'],
];

test('fr_grp_05_ac1_type_icon_and_colour_per_node', async ({ page, browser }) => {
  await openGraph(page, P.plan, { graph: { depth: 3 } });
  await waitDrawn(page, 22);
  const nodesNow = await drawn(page);
  for (const [k, icon, colour] of TYPE_PAINT) {
    const n = nodesNow.find((x) => x.key === nfc(k));
    assert.equal(n?.icon, icon, `${k}: data-icon ${icon}`);
    const paint = await nodePaint(page, k);
    assert.equal(paint?.fill, await tokenColour(page, `type-${colour}-bg`), `${k}: fill --type-${colour}-bg`);
    assert.equal(paint?.stroke, await tokenColour(page, `type-${colour}`), `${k}: border --type-${colour}`);
    assert.equal(paint?.icon, await tokenColour(page, `type-${colour}`), `${k}: icon --type-${colour}`);
  }
  const p2 = await browser.newPage();
  const vault = graphVault({ edit: (f) => { f[P.rozpocet] = f[P.rozpocet].replace('title: Rozpočet 2027\n', 'title: Rozpočet 2027\nicon: rocket\ncover: "[[graf.png]]"\n'); } });
  await openGraph(p2, P.plan, { vault });
  assert.equal((await drawn(p2)).find((x) => x.key === nfc(P.rozpocet))?.icon, 'folder', 'icon: / cover: change nothing (D-217)');
  await p2.close();
});

test('fr_grp_05_ac2_filter_list_is_the_legend', async ({ page }) => {
  await openGraph(page, P.plan);
  const rows = await typeRows(page);
  assert.equal(rows.length, 12, 'one row per type');
  const swatches = await typesGroup(page).evaluate((g) => ([...g.querySelectorAll('[data-icon]')] as HTMLElement[]).map((e) => e.getAttribute('data-icon')));
  assert.deepEqual(swatches.slice(0, 10), ['file-text', 'check-square', 'zap', 'calendar', 'plane', 'user', 'folder', 'users', 'image', 'file'], 'swatches with the type icons');
  assert.ok(await typesGroup(page).locator('[data-swatch="pill"], [data-pill]').count() >= 1, 'the Tag row has a pill swatch');
  assert.equal(await main(page).getByRole('region', { name: /legend/i }).count() + await main(page).locator('[data-graph-legend]').count(), 0, 'no other legend element (D-910)');
});

test('fr_grp_05_ac3_labels_below_nodes_and_zoom', async ({ page }) => {
  await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  const geo = await main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => {
    const shape = g.querySelector('circle, rect, ellipse') as SVGGraphicsElement | null;
    const t = g.querySelector('text') as SVGGraphicsElement | null;
    const s = t ? getComputedStyle(t) : null;
    return { key: (g.getAttribute('data-path') ?? `tag:${g.getAttribute('data-tag-key')}`).normalize('NFC'), depth: Number(g.getAttribute('data-depth')),
      shapeBottom: shape?.getBoundingClientRect().bottom ?? NaN, labelTop: t?.getBoundingClientRect().top ?? NaN, size: s ? parseFloat(s.fontSize) : NaN, weight: s?.fontWeight ?? '', tag: !!g.getAttribute('data-tag-key') };
  }));
  assert.equal(geo.length, 19, 'every node');
  for (const n of geo.filter((x) => !x.tag)) {
    assert.ok(n.labelTop >= n.shapeBottom + 4 - 0.5, `${n.key}: label below the node (+ 4 px)`);
    const want = n.depth === 0 ? [14, '650'] : n.depth === 1 ? [12, null] : [11, null];
    assert.equal(n.size, want[0], `${n.key}: ${want[0]} px`);
    if (want[1]) assert.equal(n.weight, want[1], 'the centre: 650');
  }
  /** The zoom, from the centre's 68 px circle as drawn. */
  const scale = () => nodeAt(page, P.plan).locator('circle').first().evaluate((c) => c.getBoundingClientRect().width / 68).catch(() => NaN);
  const s0 = await scale();
  await click(zoomIn(page), 'Zoom in');
  assert.ok(Math.abs((await scale()) / s0 - 1.25) < 0.01, '× 1.25');
  for (let i = 0; i < 12; i++) await click(zoomIn(page), 'Zoom in').catch(() => {});
  assert.ok(Math.abs((await scale()) - 4) < 0.01, 'at most 400 %');
  for (let i = 0; i < 20; i++) await click(zoomOut(page), 'Zoom out').catch(() => {});
  assert.ok(Math.abs((await scale()) - 0.25) < 0.01, 'at least 25 %');
  await click(fitBtn(page), 'Fit to screen');
  const cb = await canvas(page).boundingBox();
  const bounds = await main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => g.getBoundingClientRect()).reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 }));
  assert.ok(cb && bounds.l >= cb.x + 24 - 1 && bounds.t >= cb.y + 24 - 1 && bounds.r <= cb.x + cb.width - 24 + 1 && bounds.b <= cb.y + cb.height - 24 + 1, 'Fit to screen: every node inside with a 24 px margin');
  const before = await positions(page);
  const box = await nodeAt(page, P.jana).boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 8);
  await page.mouse.down(); await page.mouse.move(box!.x + 80, box!.y + 80); await page.mouse.up();
  assert.deepEqual(samePlaces(before, await positions(page), 0.5), [], 'nodes can\'t be dragged (D-985)');
  await page.mouse.move(cb!.x + 10, cb!.y + 10);
  await page.mouse.down(); await page.mouse.move(cb!.x + 60, cb!.y + 40); await page.mouse.up();
  const panned = await positions(page);
  const dx = panned[nfc(P.plan)].x - before[nfc(P.plan)].x, dy = panned[nfc(P.plan)].y - before[nfc(P.plan)].y;
  assert.ok(Math.abs(dx - 50) <= 1 && Math.abs(dy - 30) <= 1, `dragging the empty canvas pans: ${dx}, ${dy}`);
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06

test('fr_grp_06_ac1_preview_column_with_the_connections_line', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const n0 = (await core.calls()).length;
  await clickNode(page, P.rozpocet);
  const col = await must(previewCol(page), 'the Preview column');
  await must(col.locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'data-preview-path="Projekty/Rozpočet 2027.md"');
  const text = flat(await col.innerText());
  for (const part of ['Rozpočet 2027', 'Projekt', 'Projekt · 6 connections', 'Vlastník', 'Jana Nováková', 'Termín', 'Dec 31, 2026', 'Rozpočet na příští rok.']) {
    assert.ok(text.includes(part), `the column shows ${JSON.stringify(part)}: ${text}`);
  }
  assert.ok(await col.locator('[data-icon="folder"]').count() >= 1, 'the folder icon');
  const btns = await col.getByRole('button').allInnerTexts();
  const ci = btns.findIndex((b) => b.includes('Center graph here')), oi = btns.findIndex((b) => /^Open/.test(b.trim()));
  assert.ok(ci >= 0 && oi > ci, `\`Center graph here\` then \`Open\`: ${JSON.stringify(btns)}`);
  assert.equal(await col.locator('[data-preview-resize]').count(), 0, 'no resize handle in the column');
  assert.equal(await page.getByRole('dialog').filter({ has: page.locator('[data-preview-path]') }).count(), 0, 'no preview dialog at the same time');
  await clickEmpty(page);
  const cmds = (await core.calls()).slice(n0).map((c) => c.cmd);
  assert.ok(cmds.includes('embed_load') && !cmds.includes('note_read') && !cmds.includes('nav_opened'), `content from embed_load only: ${cmds.join(', ')}`);
});

test('fr_grp_06_ac2_every_kind_of_node_previews', async ({ page }) => {
  const core = await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  const want: [string, string[]][] = [
    [P.jana, ['Osoba · 3 connections', 'Firma', 'Alfa s.r.o.', 'Vede Projekt Beta.']],
    ['tag:účty', ['#Účty', 'Tag', 'Tag · 3 connections', '3 objects', 'Rozpočet 2027', 'Plán čtvrtletí', 'Faktury']],
    ['tag:nápad', ['#nápad', '2 objects']],
    [P.den, ['Daily Note · 2 connections', 'Date', 'Oct 7, 2026', 'Ráno: Nákupní seznam.']],
    [P.graf, ['Image · 1 connection', 'Width', '64', 'Height', '48']],
    [P.chybna, ['Page · 1 connection', 'This note\'s properties can\'t be read.', 'Text s odkazem na Shrnutí.']],
  ];
  for (const [k, parts] of want) {
    await clickNode(page, k);
    const text = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (t) => parts.every((p) => t.includes(p)), 3000);
    for (const p of parts) assert.ok(text.includes(p), `${k}: ${JSON.stringify(p)} in ${text}`);
    assert.equal(await previewCol(page).locator('[data-preview-path]').count(), 1, `${k}: one preview at a time`);
    if (k === P.graf) assert.ok(await previewCol(page).locator('img').count() >= 1, 'Graf: the image');
  }
  await clickNode(page, 'tag:účty');
  const order = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('Faktury'), 2000);
  // D-1022: the D-982 line (`Tag of Plán čtvrtletí`) comes before the object list; the order is checked within the list.
  const list = order.slice(order.indexOf('3 objects'));
  assert.ok(list.indexOf('Rozpočet 2027') < list.indexOf('Plán čtvrtletí') && list.indexOf('Plán čtvrtletí') < list.indexOf('Faktury'), 'most recently modified first');
  assert.equal(await core.writes(), 0, 'nothing written');
});

test('fr_grp_06_ac3_connection_in_words', async ({ page }) => {
  await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  const want: [string, string][] = [
    [P.rozpocet, 'Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí'],
    [P.shrnuti, 'Embedded in Plán čtvrtletí · Links to Plán čtvrtletí'],
    [P.ukol, 'Embedded in Plán čtvrtletí · Links to Plán čtvrtletí by relation Source'],
    [P.recept, 'Links to Plán čtvrtletí'], [P.den, 'Linked from Plán čtvrtletí'], ['tag:účty', 'Tag of Plán čtvrtletí'],
    [P.jana, 'Linked from Rozpočet 2027 by relation Vlastník'],
  ];
  for (const [k, line] of want) {
    await clickNode(page, k);
    const t = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes(line), 3000);
    assert.ok(t.includes(line), `${k}: ${line}`);
  }
  await clickNode(page, P.plan);
  const c = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('Page · 9 connections'), 3000);
  assert.ok(!/Linked from|Links to|Embedded in|Tag of/.test(c), 'the centre has no connection line');
});

test('fr_grp_06_ac3_connection_in_words_tag_centre', async ({ page }) => {
  await openGraph(page, P.fUcty);
  await clickNode(page, P.faktury);
  const t = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('Links to #Účty · Tagged #Účty'), 3000);
  assert.ok(t.includes('Links to #Účty · Tagged #Účty'), `Faktury with #účty the centre: ${t}`);
});

test('fr_grp_06_ac4_open_center_and_empty_column', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const col = await must(previewCol(page), 'the column');
  const t = flat(await col.innerText());
  assert.ok(t.includes('Click a node to preview it') && t.includes('Its neighbours are highlighted; double-click opens the object.'), `the empty state: ${t}`);
  await clickNode(page, P.rozpocet);
  await click(openBtn(page, 'Rozpočet 2027'), 'Open');
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'Open opens the object');
  await page.keyboard.press('Meta+BracketLeft');
  await must(graphHeading(page), 'back on the graph', 4000);
  await clickNode(page, P.rozpocet);
  await (await must(openBtn(page, 'Rozpočet 2027'), 'Open')).focus();
  await page.keyboard.press('Enter');
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), '⏎ in the column opens it too');
  await page.keyboard.press('Meta+BracketLeft');
  await must(graphHeading(page), 'back on the graph', 4000);
  await clickNode(page, P.rozpocet);
  await click(centerHereBtn(page), 'Center graph here');
  assert.ok(await headingIs(page, 'Local graph of Rozpočet 2027 · 7 objects'), 'centres as FR-GRP-01 AC-12');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-07

test('fr_grp_07_ac1_size_by_links_off_by_default', async ({ page }) => {
  await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  assert.equal(await checked(sizeBox(page)), false, 'unticked by default (D-908)');
  const sizes = await main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => {
    const c = g.querySelector('circle') as SVGCircleElement | null;
    return { key: (g.getAttribute('data-path') ?? '').normalize('NFC'), step: g.getAttribute('data-size-step'), depth: Number(g.getAttribute('data-depth')), d: c ? c.getBoundingClientRect().width : null };
  }));
  for (const s of sizes) {
    if (s.d === null) continue; // tag pills
    const want = s.depth === 0 ? ['centre', 68] : ['default', s.depth === 1 ? 44 : 38];
    assert.deepEqual([s.step, Math.round(s.d)], want, `${s.key}: ${want.join(', ')} px`);
  }
});

test('fr_grp_07_ac2_three_steps_by_vault_degree', async ({ page, browser }) => {
  const core = await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  await click(sizeBox(page), 'Size nodes by links');
  const steps = await eventually(async () => Object.fromEntries((await drawn(page)).map((n) => [n.key, n.step])), (s) => s[nfc(P.rozpocet)] === 'medium', 2000);
  for (const [k, s] of Object.entries(steps)) {
    const want = k === nfc(P.plan) ? 'centre' : [P.rozpocet, P.zapis].map(nfc).includes(k) ? 'medium' : 'small';
    assert.equal(s, want, `${k}: ${want}`);
  }
  assert.equal((await fullState(core))?.sizeByLinks, true, 'stored as sizeByLinks: true');
  const vault = graphVault({ hub: true });
  const stored = (await core.uiState())!;
  for (const [centre, want] of [['Pages/Hub/Paprsek 01.md', { [P.rozcestnik]: 'large', 'Pages/Hub/Uzel 01-a.md': 'medium', 'Pages/Hub/Uzel 01-b.md': 'medium', 'Pages/Hub/Uzel 01-c.md': 'small' }],
    ['Pages/Hub/List 01-a-01.md', { [P.siroky]: 'large', 'Pages/Hub/Uzel 01-a.md': 'medium' }]] as const) {
    const p2 = await browser.newPage();
    await openGraph(p2, centre, { vault, uiState: { ...stored, vaults: { [VAULT_PATH]: { graph: { full: { depth: 1, sizeByLinks: true } } } } } as any });
    const got = Object.fromEntries((await drawn(p2)).map((n) => [n.key, n.step]));
    for (const [k, s] of Object.entries(want)) assert.equal(got[nfc(k)], s, `${centre}'s graph: ${k} ${s}`);
    await p2.close();
  }
  for (const [centre, d] of [[P.plan, 1], [P.plan, 3], [P.fUcty, 1]] as const) {
    const p3 = await browser.newPage();
    await openGraph(p3, centre, { graph: { depth: d, sizeByLinks: true } });
    assert.equal((await drawn(p3)).find((n) => n.key === nfc(P.rozpocet))?.step, 'medium', `Rozpočet medium in ${centre} d${d}`);
    await p3.close();
  }
});

test('fr_grp_07_ac3_degree_ignores_filters_templates_and_trash', async ({ page }) => {
  const link = '---\ntype: page\ntitle: Odkaz\n---\nViz [[Rozpočet 2027]].\n';
  await openGraph(page, P.plan, {
    graph: { hiddenTypes: ['tag'], hiddenKinds: ['relation'], sizeByLinks: true },
    vault: graphVault({ edit: (f) => { f['_templates/Page/Odkaz na rozpočet.md'] = link; f['.trash/Pages/Odkaz na rozpočet.md'] = link; } }),
  });
  assert.equal((await drawn(page)).find((n) => n.key === nfc(P.rozpocet))?.step, 'medium', 'Rozpočet stays medium');
  await clickNode(page, P.rozpocet);
  const t = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('6 connections'), 3000);
  assert.ok(t.includes('Projekt · 6 connections'), 'its preview line stays `6 connections`');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-08

const PILLS: [string, string, string | null][] = [
  ['účty', '#Účty', 'blue'], ['finance', '#Finance', 'orange'], ['zdraví', '#Zdraví', 'green'], ['archiv', '#Archiv', null], ['cestování', '#Cestování', null], ['nápad', '#nápad', null],
];

test('fr_grp_08_ac1_tag_pills_in_tag_colours', async ({ page }) => {
  await openGraph(page, P.plan, { graph: { depth: 3 } });
  await waitDrawn(page, 22);
  for (const [key, text, colour] of PILLS) {
    const el = await must(tagNode(page, key), `#${key}`);
    assert.equal(flat(await el.textContent()), text, `${key}: the pill reads ${text}`);
    const paint = await nodePaint(page, `tag:${key}`);
    const fill = await tokenColour(page, colour ? `type-${colour}-bg` : 'hover');
    const ink = await tokenColour(page, colour ? `type-${colour}` : 'muted');
    assert.equal(paint?.fill, fill, `${key}: fill ${colour ? `--type-${colour}-bg` : '--hover'}`);
    assert.equal(paint?.stroke, ink, `${key}: border`);
    assert.equal(paint?.text, ink, `${key}: text`);
    assert.equal(parseFloat(paint?.strokeWidth ?? '0'), 1.5, `${key}: 1.5 px border`);
  }
  const s = await edgeStyle(page, P.plan, 'tag:účty');
  assert.equal(parseFloat(s?.width ?? '0'), 1, 'tag edges are 1 px');
  assert.ok(s && s.dash !== 'none', 'dotted');
});

test('fr_grp_08_ac2_tag_nodes_follow_type_and_kind_filters', async ({ page, browser }) => {
  await openGraph(page, P.plan);
  await click(typeBox(page, 'Tags'), 'Tags type off');
  await waitDrawn(page, 8);
  assert.equal(await tagNode(page, 'účty').count(), 0, 'no pills with the Tags type off');
  await click(typeBox(page, 'Tags'), 'Tags type on');
  await click(kindBox(page, 'Tags'), 'Tags kind off');
  await waitDrawn(page, 8);
  assert.equal(await tagNode(page, 'nápad').count(), 0, 'no pills with the Tags kind off');
  const p2 = await browser.newPage();
  await openGraph(p2, P.faktury, { graph: { hiddenKinds: ['tag'] } });
  assert.deepEqual(await waitDrawn(p2, 2), [P.faktury, 'tag:účty'].map(nfc).sort(), 'a tag reached by `[[Účty]]` still shows as a pill');
  await p2.close();
});

test('fr_grp_08_ac3_tag_click_previews_double_click_opens', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await clickNode(page, 'tag:nápad');
  const t = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (x) => x.includes('#nápad'), 3000);
  assert.ok(t.includes('#nápad') && t.includes('2 objects'), 'the virtual tag previews');
  await clickNode(page, 'tag:nápad', { double: true });
  assert.ok(await routeReady(core, `tag/${encodeURIComponent('nápad')}`, 4000) || await routeReady(core, 'tag/nápad', 100), 'opens tag/nápad');
  assert.equal(await core.writes(), 0, 'virtual tags write nothing');
  assert.equal((await core.files())['Tags/nápad.md'], undefined, 'no Tags/nápad.md');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06, FR-UX-03, NFR-OTH-02

test('fr_syn_06_ac38_graph_tour_writes_nothing', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: graphVault({ hub: true }) });
  const filesBefore = JSON.stringify(await core.files());
  for (const d of [2, 3, 1] as const) await click(depthBtn(page, d), `depth ${d}`);
  for (const t of ['Pages', 'Tags', 'Projekty']) { await click(typeBox(page, t), `${t} off`); await click(typeBox(page, t), `${t} on`); }
  for (const k of ['Links', 'Relations', 'Embeds', 'Tags'] as const) { await click(kindBox(page, k), `${k} off`); await click(kindBox(page, k), `${k} on`); }
  await click(noneBtn(page), 'None');
  await click(main(page).getByRole('button', { name: 'Show all types', exact: true }), 'Show all types');
  await click(allBtn(page), 'All');
  await click(sizeBox(page), 'Size nodes by links');
  await click(zoomIn(page), 'Zoom in'); await click(zoomOut(page), 'Zoom out'); await click(fitBtn(page), 'Fit');
  for (const k of [P.rozpocet, 'tag:účty', 'tag:nápad', P.den, P.graf]) await clickNode(page, k);
  await click(centerHereBtn(page), 'Center graph here');
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketRight');
  assert.equal(await core.writes(), 0, 'zero write commands to the fake core');
  assert.equal(JSON.stringify(await core.files()), filesBefore, 'every vault file as before');
  const allowed = new Set(['graph_neighbourhood', 'ui_state_set', 'embed_load', 'tag_objects', 'perf_mark', 'index_path_by_id']);
  const odd = (await core.calls()).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:') && !allowed.has(c) && /write|create|trash|rename|delete|patch/.test(c));
  assert.deepEqual(odd, [], 'no write command at all');
});

test('fr_ux_03_ac20_graph_commands_and_shortcut', async ({ page }) => {
  await openGraph(page, P.plan);
  await runCommand(page, 'Graph: Depth 2');
  assert.equal((await waitDrawn(page, 19)).length, 19, '`Graph: Depth 2` from the palette');
  await clickNode(page, P.rozpocet);
  await runCommand(page, 'Graph: Recenter');
  assert.ok((await eventually(() => headingText(page, 200), (t) => t.startsWith('Local graph of Rozpočet 2027 · '), 3000)).startsWith('Local graph of Rozpočet 2027 · '), '`Graph: Recenter` centres on the selected node');
  for (const loc of [depthBtn(page, 1), depthBtn(page, 3), typeBox(page, 'Pages'), kindBox(page, 'Links'), sizeBox(page), zoomIn(page), zoomOut(page), fitBtn(page)]) {
    const el = await must(loc, 'a graph control');
    await el.focus();
    assert.ok(await el.evaluate((e) => e === document.activeElement), 'reachable by keyboard (FR-UX-03 AC-8)');
  }
  await clickNode(page, P.zapis);
  for (const loc of [centerHereBtn(page), openBtn(page, 'Zápis z porady')]) {
    const el = await must(loc, 'a preview-column button');
    await el.focus();
    assert.ok(await el.evaluate((e) => e === document.activeElement), 'the column\'s buttons are reachable');
  }
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Show local graph');
  await sleep(200);
  assert.ok(!(await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).some((t) => t.includes('Show local graph')), 'no `Show local graph` in G1');
});

test('nfr_oth_02_ac12_graph_strings_in_the_catalog', async ({ page }) => {
  await openGraph(page, P.plan, { prelude: pseudoLocale, vault: graphVault({ hub: true }) });
  await clickNode(page, P.rozpocet);
  const leaks = await page.evaluate(() => {
    const user = (e: Element | null) => !!e?.closest('[data-user-content]');
    const out: string[] = [];
    const m = document.querySelector('main');
    if (!m) return ['no main'];
    const walker = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t || user(n.parentElement) || /^[\d\s.,·:#%×]+$/.test(t)) continue;
      if (!/^⟦[\s\S]*⟧$/.test(t)) out.push(t);
    }
    for (const e of m.querySelectorAll('[aria-label]')) {
      const l = e.getAttribute('aria-label') ?? '';
      if (l && !user(e) && !l.includes('⟦')) out.push(`aria-label: ${l}`);
    }
    return out;
  });
  assert.deepEqual(leaks, [], 'every visible text and accessible name of the full view is in ⟦ ⟧ except user content');
  await must(page.getByText('⟦Source⟧').or(page.getByText(/⟦Links to .* by relation ⟦?Podklady/)), 'relation names from the catalog');
});
