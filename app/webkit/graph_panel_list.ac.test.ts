// Slice "G3 in the panel", L5 (WebKit + fake core): the `Graph` / `List` switch and the List in the right panel
// (docs/acceptance/graph-panel-g3.md R125): FR-UX-08 AC-10 (the switch, its fit at 240 / 288 / 480 px, stored under
// graph.panel; AP-965), AC-11 (the tree is the panel canvas's neighbourhood; the 60 cap, AP-966), AC-12 (states, live
// updates and the narrow layout; AP-967), AC-13 (what a panel node says, R121) and FR-GRP-06 AC-10 (the preview from a
// List row; AP-969). Interface docs/contracts/v1-graph.md §17.1, §17.2, §17.4 (on §16.3, §16.4). Fixtures
// tests/fixtures/vaults/graph (its README, "Panel (G2)", the hub) and tests/fixtures/graph-presets/valid.yml. Written from
// the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { description } from './capture-helpers';
import { anyPreviewDialog, mustPreview } from './helpers';
import {
  P, VAULT_PATH, choosePreset, click, drawn, eventually, flat, graphHeading, graphVault, must, nfc, original, presetsText, runCommand, seen, sleep,
  uiWrites, viewBtn,
} from './graph-helpers';
import {
  GP, VIEWPORT, chooseDepth, closePopover, ctxPanel, fullStored, lowerBtn, openFullBtn, openPanel, openPopover, panelStored, pCanvas, pFooterText,
  pKindBox, pListTree, pNodeDescription, pNone, pRows, pSizeBox, pTypeBox, pViewBtn, pViewGroup, requests, searchOpen, startPanel, stateOpenFull,
  trigger, triggerText,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

type Core = Awaited<ReturnType<typeof openPanel>>;
async function toList(page: Page) {
  await click(pViewBtn(page, 'List'), 'the panel\'s `List` (R125)');
  await must(pListTree(page), 'the panel\'s tree `Local graph as a list`');
}
async function toGraph(page: Page) {
  await click(pViewBtn(page, 'Graph'), 'the panel\'s `Graph`');
  await must(pCanvas(page), 'the panel canvas');
}
const nodeNames = async (page: Page) => (await drawn(page, GP(page))).map((n) => n.name).sort();
const rowNames = async (page: Page) => (await pRows(page)).map((r) => r.name).sort();
async function rowCount(page: Page, n: number, what: string) {
  const got = await eventually(async () => (await pRows(page)).length, (x) => x === n, 4000);
  assert.equal(got, n, `${what}: ${n} rows (got ${got})`);
}
/** Graph → names and footer, then List → the same names and footer. */
async function sameInBoth(page: Page, what: string) {
  await sleep(400);
  const want = await nodeNames(page);
  const f = await pFooterText(page);
  await toList(page);
  assert.deepEqual(await eventually(() => rowNames(page), (n) => n.length === want.length, 3000), want, `${what}: the rows are the canvas's node set`);
  assert.equal(await pFooterText(page), f, `${what}: the List's footer gives the same count (${f})`);
  await toGraph(page);
}
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
const within = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5;

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-10

test('fr_ux_08_ac10_panel_graph_list_switch', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2, hiddenTypes: ['tag'] } });
  await must(pViewGroup(page), 'the panel toolbar\'s group `View` (R125, board GraphPanel B8)');
  assert.deepEqual([await pViewBtn(page, 'Graph').getAttribute('aria-pressed'), await pViewBtn(page, 'List').getAttribute('aria-pressed')], ['true', 'false'], '`Graph` pressed by default');
  const order = await GP(page).evaluate((m) => {
    const t = m.querySelector('[aria-label="Depth and filters"]') ?? [...m.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Depth and filters' || b.textContent?.trim().startsWith('Depth'));
    const v = [...m.querySelectorAll('[role="group"]')].find((g) => g.getAttribute('aria-label') === 'View');
    const o = m.querySelector('[data-command="graph.open"]');
    return !!t && !!v && !!o && !!(t.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(v.compareDocumentPosition(o) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, 'the switch sits between the trigger (and the spacer) and `Open full view`');
  for (const w of [240, 288, 480]) {
    const p = await page.context().newPage();
    await openPanel(p, P.plan, { panel: { depth: 2, hiddenTypes: ['tag'] }, width: w });
    assert.equal(await triggerText(p), 'Depth 2 · 5 hidden', `${w} px: the trigger reads \`Depth 2 · 5 hidden\``);
    const tp = (await GP(p).boundingBox())!;
    const parts = [await must(trigger(p), 'trigger'), await must(pViewGroup(p), 'the switch'), await must(openFullBtn(p), '`Open full view`')];
    const boxes = await Promise.all(parts.map(async (x) => (await x.boundingBox())!));
    for (const [i, b] of boxes.entries()) assert.ok(within(b, tp), `${w} px: part ${i} fully inside the tab panel (${JSON.stringify(b)} in ${JSON.stringify(tp)})`);
    assert.ok(!overlap(boxes[0], boxes[1]) && !overlap(boxes[1], boxes[2]) && !overlap(boxes[0], boxes[2]), `${w} px: no overlap (AP-965)`);
    await p.close();
  }
  const cb = (await (await must(pCanvas(page), 'the canvas')).boundingBox())!;
  const w0 = (await uiWrites(core)).length;
  await toList(page);
  assert.ok(!(await seen(GP(page).locator('[data-graph-node]'), 300)), 'the tree replaces the canvas');
  const tb = (await pListTree(page).boundingBox())!;
  assert.ok(within(tb, { x: cb.x - 1, y: cb.y - 1, width: cb.width + 2, height: cb.height + 2 }), `in the canvas's box (${JSON.stringify(tb)} in ${JSON.stringify(cb)})`);
  assert.equal(await pViewBtn(page, 'List').getAttribute('aria-pressed'), 'true', '`List` pressed');
  await sleep(300);
  const ws = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(ws.length, 1, 'one ui_state_set');
  assert.equal(ws[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.panel?.view, 'list', '`view: "list"` under graph.panel');
  assert.equal(ws[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.full, undefined, 'not graph.full');
  assert.equal(await triggerText(page), 'Depth 2 · 5 hidden', 'the trigger stays in List');
  assert.equal(await pFooterText(page), '14 objects · click a node to preview', 'and the footer');
  await openPopover(page);
  await must(pSizeBox(page), 'the popover with `Size nodes by links`');
  await closePopover(page);
  await searchOpen(page, 'Rozpočet 2027');
  await must(pListTree(page), 'the next note opens in List in the panel');
  await click(openFullBtn(page), '`Open full view`');
  await must(graphHeading(page), 'the full view', 5000);
  assert.equal(await (await must(viewBtn(page, 'Graph'), 'the full view\'s `Graph`')).getAttribute('aria-pressed'), 'true', 'the full view keeps its own view');
  assert.equal(await fullStored(core), null, 'graph.full not written');
  assert.equal(await core.writes(), 0, 'no vault write');
});

test('fr_ux_08_ac10_panel_graph_list_switch_by_the_palette_and_defaults', async ({ page, browser }) => {
  const core = await openPanel(page, P.plan);
  await must(pViewGroup(page), 'the group `View`');
  await sleep(300);
  assert.equal((await uiWrites(core)).length, 0, 'a missing graph.panel.view reads as Graph and isn\'t rewritten');
  await runCommand(page, 'Graph: Show as list');
  await must(pListTree(page), '`Graph: Show as list` shows the tree');
  assert.equal(await eventually(async () => (await panelStored(core))?.view, (v) => v === 'list', 2000), 'list', 'stored as graph.panel.view');
  const p2 = await browser.newPage();
  const c2 = await openPanel(p2, P.plan, { panel: { view: 'tabulka' } });
  assert.equal(await (await must(pViewBtn(p2, 'Graph'), '`Graph`')).getAttribute('aria-pressed'), 'true', 'an unknown view reads as Graph');
  await sleep(300);
  assert.equal((await uiWrites(c2)).length, 0, 'and isn\'t rewritten');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-11

/** R122: Plán at depth 2. */
const R122: [string, number][] = [
  ['Plán čtvrtletí, Page', 1], ['Rozpočet 2027, Projekt', 2], ['Jana Nováková, Osoba', 3], ['Výdaje 2026, Page', 3], ['#Finance, Tag', 3],
  ['Zápis z porady, Schůzka', 2], ['Petr Dvořák, Osoba', 3], ['Smlouva, PDF', 3], ['#Cestování, Tag', 3],
  ['Shrnutí, Page', 2], ['Bez hlavičky, Page', 3], ['Chybná hlavička, Page', 3], ['#Archiv, Tag', 3],
  ['#Účty, Tag', 2], ['2026-10-07, Daily Note', 2], ['#nápad, Tag', 2], ['Graf výdajů, Image', 2], ['Recept na koláč, recept', 2], ['Zaplatit fakturu, Task', 2],
];

test('fr_ux_08_ac11_panel_list_matches_the_canvas', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2 } });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 19, 4000)).length, 19, 'Plán at depth 2 in the panel');
  const canvas = await nodeNames(page);
  const req0 = (await requests(core)).at(-1);
  await toList(page);
  await rowCount(page, 19, 'Plán at depth 2');
  const r = await pRows(page);
  assert.deepEqual(r.map((x) => [x.name, x.level]), R122.map(([n, l]) => [nfc(n), l]), 'exactly R122\'s 19 rows: order and levels');
  assert.deepEqual(r.map((x) => x.name).sort(), canvas, 'the same set as the panel canvas');
  assert.equal(r.find((x) => x.name === 'Rozpočet 2027, Projekt')?.text, 'Rozpočet 2027 · Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí · 6 connections', 'Rozpočet\'s row text');
  assert.equal(await pFooterText(page), '19 objects · click a node to preview', 'the List\'s footer');
  await sleep(400);
  const reqs = await requests(core);
  assert.ok(reqs.slice(reqs.indexOf(req0!) + 1).every((q) => q.cap === 60 && q.showAll === false), 'the List\'s requests are the Graph\'s (`cap: 60`, `showAll: false`)');
});

for (const [centre, label] of [[P.plan, 'plan'], [P.rozpocet, 'rozpocet'], [P.den, 'den'], [P.osamela, 'osamela']] as const) {
  test(`fr_ux_08_ac11_panel_list_matches_the_canvas_${label}_depths`, async ({ page }) => {
    await openPanel(page, centre);
    await must(pViewGroup(page), 'the panel\'s `View` switch');
    for (const d of [1, 2, 3] as const) {
      if (centre !== P.osamela) await chooseDepth(page, d);
      await closePopover(page);
      await sameInBoth(page, `${label} depth ${d}`);
    }
  });
}

const SCENARIOS: [string, (page: Page) => Promise<void>][] = [
  ['tags_type_off', async (p) => click(pTypeBox(p, 'Tags'), 'Tags')], ['projekty_off', async (p) => click(pTypeBox(p, 'Projekty'), 'Projekty')],
  ['relations_off', async (p) => click(pKindBox(p, 'Relations'), 'Relations')], ['tags_kind_off', async (p) => click(pKindBox(p, 'Tags'), 'Tags kind')],
  ['links_off', async (p) => click(pKindBox(p, 'Links'), 'Links')], ['pages_off', async (p) => click(pTypeBox(p, 'Pages'), 'Pages')], ['types_none', async (p) => click(pNone(p), 'None')],
];
for (const [name, act] of SCENARIOS) {
  test(`fr_ux_08_ac11_panel_list_matches_the_canvas_filter_${name}`, async ({ page }) => {
    await openPanel(page, P.plan, { panel: { depth: 2 } });
    await must(pViewGroup(page), 'the panel\'s `View` switch');
    await openPopover(page);
    await act(page);
    await closePopover(page);
    await sameInBoth(page, name);
  });
}

for (const preset of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky']) {
  test(`fr_ux_08_ac11_panel_list_matches_the_canvas_preset_${preset.normalize('NFD').replace(/[^a-zA-Z]+/g, '_').toLowerCase()}`, async ({ page }) => {
    await openPanel(page, P.plan, { presets: presetsText('valid') });
    await must(pViewGroup(page), 'the panel\'s `View` switch');
    await openPopover(page);
    await choosePreset(page, preset);
    await closePopover(page);
    await sameInBoth(page, preset);
  });
}

test('fr_ux_08_ac11_panel_list_matches_the_canvas_hub', async ({ page }) => {
  await openPanel(page, P.rozcestnik, { vault: graphVault({ hub: true }) });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 41, 8000)).length, 41, 'Rozcestník at depth 1: 41 nodes');
  await toList(page);
  await rowCount(page, 41, 'Rozcestník at depth 1');
  await chooseDepth(page, 2);
  await closePopover(page);
  await must(GP(page).getByText('Too many to show here', { exact: true }), 'above the 60 cap, the Too many state in List (AP-966)', 8000);
  await must(GP(page).getByText('161 objects at depth 2', { exact: true }), '`161 objects at depth 2`');
  await must(lowerBtn(page, 1, 41), '`Depth 1 · 41`');
  await must(stateOpenFull(page), '`Open full view`');
  assert.ok(!(await seen(pListTree(page), 300)), 'and no tree');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-12

test('fr_ux_08_ac12_panel_list_states_live_updates_and_layout', async ({ page, browser }) => {
  await openPanel(page, P.osamela, { panel: { view: 'list' } });
  await must(pListTree(page), 'Osamělá in List');
  await rowCount(page, 1, 'Osamělá: one row');
  await must(GP(page).getByText('No links yet', { exact: true }), '`No links yet` as in Graph');
  const p2 = await browser.newPage();
  await openPanel(p2, P.plan, { panel: { view: 'list' } });
  await openPopover(p2);
  await click(pNone(p2), 'None');
  await closePopover(p2);
  await must(GP(p2).getByText('All 9 linked objects are hidden by the type filter.', { exact: true }), 'All hidden: R110\'s text');
  await must(GP(p2).getByRole('button', { name: 'Show all types', exact: true }), 'with its button');
  assert.deepEqual((await pRows(p2)).map((r) => r.name), ['Plán čtvrtletí, Page'], 'and the centre row');
  await p2.close();
  const p3 = await browser.newPage();
  await startPanel(p3, 'new/page', { panel: { view: 'list' } });
  await must(GP(p3).getByText('The graph appears once this note is saved.', { exact: true }), 'No file on new/page', 5000);
  await must(pViewGroup(p3), 'with the `View` switch');
  await p3.close();
});

test('fr_ux_08_ac12_panel_list_states_live_updates_and_layout_loading_and_deleted', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { view: 'list' }, realTime: true });
  await must(pListTree(page), 'Plán in List');
  await core.graphDelay(1500);
  await chooseDepth(page, 2);
  await closePopover(page);
  const t0 = Date.now();
  assert.ok(!(await seen(GP(page).getByRole('status').filter({ hasText: 'Loading…' }), 200)), 'no Loading before 300 ms');
  assert.ok(await seen(GP(page).getByRole('status').filter({ hasText: 'Loading…' }), 1000), 'Loading after 300 ms');
  assert.ok(Date.now() - t0 >= 250, 'not at once');
  await core.graphDelay(0);
  await rowCount(page, 19, 'the answer');
  await core.renameFile(P.plan, `.trash/${P.plan}`);
  await must(GP(page).getByText('This object was deleted', { exact: true }), 'Deleted after a trash move', 3000);
});

test('fr_ux_08_ac12_panel_list_states_live_updates_and_layout_live', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { view: 'list' } });
  await rowCount(page, 10, 'Plán at depth 1');
  const roz = await must(pListTree(page).getByRole('treeitem', { name: /^Rozpočet 2027, / }), 'the Rozpočet row');
  await roz.focus();
  const osamela = original(P.osamela);
  await core.setFile(P.osamela, `${osamela.trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
  const r = await eventually(() => pRows(page), (x) => x.some((y) => y.name === 'Osamělá, Page'), 2000);
  const row = r.find((y) => y.name === 'Osamělá, Page');
  assert.equal(row?.level, 2, 'another program\'s link adds `Osamělá` under `Plán čtvrtletí` within 2 s');
  assert.equal(await page.evaluate(() => (document.activeElement?.closest('[role="treeitem"]')?.getAttribute('aria-label') ?? '').normalize('NFC')), 'Rozpočet 2027, Projekt', 'without moving the focus off the focused row');
  await (await must(pListTree(page).getByRole('treeitem', { name: /^Osamělá, / }), 'the Osamělá row')).focus();
  await core.setFile(P.osamela, osamela);
  await rowCount(page, 10, 'Osamělá gone');
  assert.equal(await page.evaluate(() => (document.activeElement?.closest('[role="treeitem"]')?.getAttribute('aria-label') ?? '').normalize('NFC')), 'Plán čtvrtletí, Page', 'a removed focused row moves the focus to the centre row');
});

test('fr_ux_08_ac12_panel_list_states_live_updates_and_layout_narrow', async ({ page }) => {
  await openPanel(page, P.plan, { panel: { view: 'list', depth: 3 }, width: 240 });
  await rowCount(page, 22, 'Plán at depth 3 at 240 px');
  const first = await must(pListTree(page).getByRole('treeitem').first(), 'the first row');
  await first.focus();
  await page.keyboard.press('End');
  await sleep(200);
  const geo = await GP(page).evaluate((m) => {
    const tree = m.querySelector('[role="tree"]') as HTMLElement;
    let sc: HTMLElement | null = tree;
    while (sc && sc !== m && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const a = document.activeElement as HTMLElement;
    const ab = a.getBoundingClientRect(), sb = (sc ?? tree).getBoundingClientRect();
    return { panelTop: (m as HTMLElement).scrollTop, scrolls: !!sc && sc !== m, focusedIn: ab.top >= sb.top - 0.5 && ab.bottom <= sb.bottom + 0.5, right: tree.getBoundingClientRect().right };
  });
  assert.equal(geo.panelTop, 0, 'the tab panel doesn\'t scroll (its scrollTop stays 0)');
  assert.equal(geo.scrolls, true, 'the tree scrolls inside the canvas\'s box');
  assert.equal(geo.focusedIn, true, 'the focused row is scrolled into view');
  const wide = (await pRows(page)).filter((x) => x.box.r > geo.right + 0.5).map((x) => x.name);
  assert.deepEqual(wide, [], 'no row\'s box extends past the tree\'s right edge (AP-967)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-13

test('fr_ux_08_ac13_panel_node_descriptions', async ({ page }) => {
  await openPanel(page, P.plan);
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán at depth 1');
  const want: [string, string, string][] = [
    [P.plan, 'Plán čtvrtletí, Page', '9 connections. Centre of the graph. 1 of 10.'],
    [P.rozpocet, 'Rozpočet 2027, Projekt', '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí. 2 of 10.'],
    ['tag:účty', '#Účty, Tag', '3 connections. Tag of Plán čtvrtletí. 5 of 10.'],
    [P.ukol, 'Zaplatit fakturu, Task', '1 connection. Embedded in Plán čtvrtletí · Links to Plán čtvrtletí by relation Source. 10 of 10.'],
  ];
  for (const [k, name, desc] of want) {
    assert.equal(await pNodeDescription(page, k), desc, `${k}: ${desc}`);
    assert.equal((await drawn(page, GP(page))).find((n) => n.key === nfc(k))?.name, name, `${k}: the name stays \`${name}\``);
  }
  assert.equal(await description(pCanvas(page)), 'Use the arrow keys to move between nodes. Switch the view to List to read the same objects as a list.', 'the canvas\'s description');
  await chooseDepth(page, 2, 19);
  assert.equal(await pNodeDescription(page, P.jana), '3 connections. Linked from Rozpočet 2027 by relation Vlastník. 11 of 19.', 'Jana at depth 2');
  await chooseDepth(page, 1, 10);
  await click(pTypeBox(page, 'Tags'), 'hide Tags');
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 8, 3000)).length, 8, 'Tags hidden');
  assert.ok((await pNodeDescription(page, P.den)).endsWith('. 5 of 8.'), `with Tags hidden at depth 1 Den is \`5 of 8\`: ${await pNodeDescription(page, P.den)}`);
  await click(pTypeBox(page, 'Tags'), 'show Tags');
  await closePopover(page);
  await toList(page);
  const roz = (await pRows(page)).find((r) => r.name === 'Rozpočet 2027, Projekt');
  assert.equal(roz?.desc, '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí.', 'List rows carry the description without the position (D-1106)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-10

async function clickRow(page: Page, title: string) {
  const row = await must(pListTree(page).getByRole('treeitem', { name: new RegExp(`^${title}, `) }), `the row \`${title}\``);
  const b = (await row.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + 8);
  return row;
}
const selectedRows = async (page: Page) => (await pRows(page)).filter((r) => r.selected === 'true').map((r) => r.name);

test('fr_grp_06_ac10_panel_preview_from_list_rows', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { view: 'list' } });
  await rowCount(page, 10, 'Plán in List');
  const row = await clickRow(page, 'Rozpočet 2027');
  assert.deepEqual(await selectedRows(page), ['Rozpočet 2027, Projekt'], 'the row gets aria-selected="true"');
  const d = await mustPreview(page, 'Rozpočet 2027', '`Preview: Rozpočet 2027`');
  const t = await eventually(async () => flat(await d.innerText()), (x) => x.includes('Projekt · 6 connections'), 3000);
  for (const part of ['Projekt · 6 connections', 'Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí', 'In full graph']) assert.ok(t.includes(part), `the popover shows ${JSON.stringify(part)}`);
  assert.ok(await seen(d.getByRole('button', { name: /^Open\b/ }), 300), 'and `Open`');
  const db = (await d.boundingBox())!, pb = (await ctxPanel(page).boundingBox())!, rb = (await row.boundingBox())!;
  assert.ok(Math.abs(db.x + db.width - (pb.x - 8)) <= 1, `its right edge 8 px left of the panel (${db.x + db.width} vs ${pb.x - 8})`);
  const top = Math.min(Math.max(rb.y, 8), VIEWPORT.height - 8 - db.height);
  assert.ok(Math.abs(db.y - top) <= 1, `its top at the row's top, kept inside the window (${db.y} vs ${top})`);
  await clickRow(page, 'Zápis z porady');
  await mustPreview(page, 'Zápis z porady', 'a click on the Zápis row replaces it (one popover)');
  assert.deepEqual(await selectedRows(page), ['Zápis z porady, Schůzka'], 'and moves the selection');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 1500), 0, 'Esc closes it');
  assert.deepEqual(await selectedRows(page), [], 'and clears aria-selected');
  await clickRow(page, 'Rozpočet 2027');
  await mustPreview(page, 'Rozpočet 2027', 'again');
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note')).click({ position: { x: 20, y: 5 } });
  assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 1500), 0, 'a click on the note closes it');
  assert.deepEqual(await selectedRows(page), [], 'and clears aria-selected');
  await clickRow(page, 'Rozpočet 2027');
  await mustPreview(page, 'Rozpočet 2027', 'again');
  await click(pViewBtn(page, 'Graph'), '`Graph` while the preview is open');
  assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 1500), 0, 'switching the view closes the preview (AP-969)');
  assert.deepEqual((await drawn(page, GP(page))).filter((n) => n.selected).map((n) => n.key), [], 'and clears the selection');
  assert.equal(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim()), 'Graph', 'the focus stays on the switch button');
  assert.equal(await core.writes(), 0, 'nothing written');
});

test('fr_grp_06_ac10_panel_preview_from_list_rows_scrolled', async ({ page }) => {
  await openPanel(page, P.plan, { panel: { view: 'list', depth: 3 }, width: 240 });
  await rowCount(page, 22, 'Plán at depth 3');
  const row = await clickRow(page, 'Shrnutí');
  const d = await mustPreview(page, 'Shrnutí', 'a clicked preview');
  const tb = (await pListTree(page).boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.wheel(0, 200);
  await sleep(300);
  if (await seen(d, 200)) {
    const db = (await d.boundingBox())!, rb = (await row.boundingBox())!;
    const top = Math.min(Math.max(rb.y, 8), VIEWPORT.height - 8 - db.height);
    assert.ok(Math.abs(db.y - top) <= 1, `scrolling keeps it placed at its row (${db.y} vs ${top}), or closes it`);
  }
});
