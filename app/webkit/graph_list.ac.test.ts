// Slice G3, L5 (WebKit + fake core): the `Graph` / `List` switch and the List view (docs/acceptance/graph.md part two,
// R122, AP-938…AP-940): FR-UX-08 AC-5 (the switch, stored per view, the selection kept), AC-6 (the tree is the same
// neighbourhood: R122's 19 rows, the canvas's node set at depths 1–3 for four centres, with the G1 filter scenarios and
// each preset of `valid`, the cap and its banner on the hub), AC-7 (R110 states and live updates in List), AC-8 (rows
// take the node inputs by mode) and FR-UX-03 AC-30 (the WAI-ARIA tree keys). Interface docs/contracts/v1-graph.md
// §16.3, §16.4. Fixtures tests/fixtures/vaults/graph (its README, the hub) and tests/fixtures/graph-presets/valid.yml.
// Written from the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, VAULT_PATH, banner, choosePreset, click, depthBtn, drawn, isDisabled, eventually, fitBtn, flat, focused, fullState, graphVault, hint, kindBox,
  listTree, main, must, nfc, noneBtn, openGraph, original, presetsText, presetsVault, previewCol, routeReady, rows, seen, sleep, startGraph, graphRoute,
  stateText, treeRow, typeBox, uiG3, uiWrites, viewBtn, viewGroup, waitDrawn, zoomIn, loadingStatus, hoverRing,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

async function toList(page: Page) {
  await click(viewBtn(page, 'List'), '`List` (R122)');
  await must(listTree(page), 'the tree `Local graph as a list`');
}
const names = async (page: Page) => (await rows(page)).map((r) => r.name).sort();
const nodeNames = async (page: Page) => (await drawn(page)).map((n) => n.name).sort();
async function rowCount(page: Page, n: number, what: string) {
  const got = await eventually(async () => (await rows(page)).length, (x) => x === n, 4000);
  assert.equal(got, n, `${what}: ${n} rows (got ${got})`);
}

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-5

test('fr_ux_08_ac5_graph_list_switch_remembered', async ({ page, browser }) => {
  const core = await openGraph(page, P.plan);
  await must(viewGroup(page), 'the group `View` (R122)');
  assert.deepEqual([await viewBtn(page, 'Graph').getAttribute('aria-pressed'), await viewBtn(page, 'List').getAttribute('aria-pressed')], ['true', 'false'], '`Graph` pressed by default');
  const order = await page.evaluate(() => {
    const find = (n: string) => [...document.querySelectorAll('main [role="group"], main button')].find((e) => e.getAttribute('aria-label') === n || (e.tagName === 'BUTTON' && e.textContent?.trim() === n));
    const d = find('Depth'), v = find('View'), r = find('Recenter');
    return !!d && !!v && !!r && !!(d.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(v.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, 'between the depth group and `Recenter` (board Graph B8)');
  await click(main(page).locator(`[data-graph-node][data-path="${nfc(P.rozpocet)}"]`), 'select Rozpočet');
  const w0 = (await uiWrites(core)).length;
  await toList(page);
  assert.ok(!(await seen(main(page).locator('[data-graph-node]'), 300)), 'the tree replaces the canvas');
  for (const loc of [zoomIn(page), fitBtn(page), hint(page, 'Click to preview · double-click to open')]) assert.ok(!(await seen(loc, 200)), 'no zoom buttons and no hint in List');
  assert.equal(await viewBtn(page, 'List').getAttribute('aria-pressed'), 'true', '`List` pressed');
  assert.equal((await focused(page)).name, 'List', 'the focus stays on the switch button');
  const writes = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(writes.length, 1, 'one ui_state_set');
  assert.equal(writes[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.full?.view, 'list', '`view: "list"` under graph.full');
  assert.equal(writes[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.panel, undefined, 'not graph.panel');
  assert.equal((await rows(page)).find((r) => r.name === 'Rozpočet 2027, Projekt')?.selected, 'true', 'Rozpočet stays selected (its row `aria-selected="true"`)');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'and previewed');
  await click(viewBtn(page, 'Graph'), 'Graph');
  assert.ok((await drawn(page)).find((n) => n.key === nfc(P.rozpocet))?.selected, 'and back in Graph');
  await toList(page);
  assert.equal(await core.writes(), 0, 'no vault write');
  const p2 = await browser.newPage();
  await openGraph(p2, P.den, { uiState: (await core.uiState())! });
  await must(listTree(p2), 'the next graph opened starts in List');
  await p2.close();
  for (const v of [undefined, 'tabulka']) {
    const p3 = await browser.newPage();
    const c3 = await openGraph(p3, P.plan, { uiState: uiG3({ full: v === undefined ? { depth: 1 } : { view: v } }) });
    assert.equal(await viewBtn(p3, 'Graph').getAttribute('aria-pressed'), 'true', `view ${v ?? 'missing'}: Graph`);
    assert.equal((await uiWrites(c3)).length, 0, `view ${v ?? 'missing'}: not rewritten`);
    await p3.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-6

/** R122: Plán at depth 2 (levels by indent). */
const R122: [string, number][] = [
  ['Plán čtvrtletí, Page', 1], ['Rozpočet 2027, Projekt', 2], ['Jana Nováková, Osoba', 3], ['Výdaje 2026, Page', 3], ['#Finance, Tag', 3],
  ['Zápis z porady, Schůzka', 2], ['Petr Dvořák, Osoba', 3], ['Smlouva, PDF', 3], ['#Cestování, Tag', 3],
  ['Shrnutí, Page', 2], ['Bez hlavičky, Page', 3], ['Chybná hlavička, Page', 3], ['#Archiv, Tag', 3],
  ['#Účty, Tag', 2], ['2026-10-07, Daily Note', 2], ['#nápad, Tag', 2], ['Graf výdajů, Image', 2], ['Recept na koláč, recept', 2], ['Zaplatit fakturu, Task', 2],
];

test('fr_ux_08_ac6_list_tree_matches_the_canvas', async ({ page }) => {
  await openGraph(page, P.plan, { graph: { depth: 2 } });
  await waitDrawn(page, 19);
  const canvasNames = await nodeNames(page);
  await toList(page);
  await rowCount(page, 19, 'Plán at depth 2');
  const r = await rows(page);
  assert.deepEqual(r.map((x) => [x.name, x.level]), R122.map(([n, l]) => [nfc(n), l]), 'R122: the 19 rows, their order and `aria-level` = depth + 1');
  assert.deepEqual(r.map((x) => x.name).sort(), canvasNames, 'the same set as the canvas');
  const row = (n: string) => r.find((x) => x.name === nfc(n));
  assert.equal(row('Rozpočet 2027, Projekt')?.text, 'Rozpočet 2027 · Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí · 6 connections', 'Rozpočet\'s row');
  assert.equal(row('Jana Nováková, Osoba')?.text, 'Jana Nováková · Linked from Rozpočet 2027 by relation Vlastník · 3 connections', 'Jana\'s row');
  assert.ok(/^Plán čtvrtletí · 9 connections$/.test(row('Plán čtvrtletí, Page')?.text ?? ''), `no phrase on the centre row: ${row('Plán čtvrtletí, Page')?.text}`);
  assert.equal(row('Rozpočet 2027, Projekt')?.desc, '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí.', 'the description without the position');
  assert.deepEqual(r.filter((x) => x.expanded !== null).map((x) => [x.name, x.expanded]), [['Plán čtvrtletí, Page', 'true'], ['Rozpočet 2027, Projekt', 'true'], ['Zápis z porady, Schůzka', 'true'], ['Shrnutí, Page', 'true']].map(([n, e]) => [nfc(n), e]),
    'every item with children `aria-expanded="true"` at first');
  assert.deepEqual(r.filter((x) => x.tabindex === '0').map((x) => x.name), ['Plán čtvrtletí, Page'], 'one tab stop, the centre row');
});

const SCENARIOS: [string, (page: Page) => Promise<void>][] = [
  ['tags_type_off', async (p) => click(typeBox(p, 'Tags'), 'Tags')], ['projekty_off', async (p) => click(typeBox(p, 'Projekty'), 'Projekty')],
  ['relations_off', async (p) => click(kindBox(p, 'Relations'), 'Relations')], ['tags_kind_off', async (p) => click(kindBox(p, 'Tags'), 'Tags kind')],
  ['links_off', async (p) => click(kindBox(p, 'Links'), 'Links')], ['pages_off', async (p) => click(typeBox(p, 'Pages'), 'Pages')], ['types_none', async (p) => click(noneBtn(p), 'None')],
];
for (const [centre, label] of [[P.plan, 'plan'], [P.fUcty, 'ucty'], [P.den, 'den'], [P.osamela, 'osamela']] as const) {
  test(`fr_ux_08_ac6_list_tree_matches_the_canvas_${label}_depths`, async ({ page }) => {
    await openGraph(page, centre);
    for (const d of [1, 2, 3] as const) {
      await click(viewBtn(page, 'Graph'), 'Graph').catch(() => {});
      if (!(await isDisabled(depthBtn(page, d)))) await click(depthBtn(page, d), `depth ${d}`); // Osamělá: no links, the depths may be disabled (R110)
      await sleep(400);
      const want = await nodeNames(page);
      await toList(page);
      assert.deepEqual(await eventually(() => names(page), (n) => n.length === want.length, 3000), want, `${label} depth ${d}: the canvas's node set`);
    }
  });
}
for (const [name, act] of SCENARIOS) {
  test(`fr_ux_08_ac6_list_tree_matches_the_canvas_filter_${name}`, async ({ page }) => {
    await openGraph(page, P.plan, { graph: { depth: 2 } });
    await waitDrawn(page, 19);
    await act(page);
    await sleep(500);
    const want = await nodeNames(page);
    await toList(page);
    assert.deepEqual(await eventually(() => names(page), (n) => n.length === want.length, 3000), want, `${name}: the canvas's node set`);
  });
}
test('fr_ux_08_ac6_list_tree_matches_the_canvas_presets', async ({ page }) => {
  await openGraph(page, P.plan, { vault: presetsVault(presetsText('valid')) });
  for (const p of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky']) {
    await click(viewBtn(page, 'Graph'), 'Graph').catch(() => {});
    await choosePreset(page, p);
    await sleep(400);
    const want = await nodeNames(page);
    await toList(page);
    assert.deepEqual(await eventually(() => names(page), (n) => n.length === want.length, 3000), want, `${p}: the canvas's node set`);
  }
});
test('fr_ux_08_ac6_list_tree_matches_the_canvas_cap', async ({ page }) => {
  await openGraph(page, P.rozcestnik, { vault: graphVault({ hub: true }), graph: { depth: 2 } });
  await waitDrawn(page, 150, 8000);
  const b = flat(await (await must(banner(page), 'the cap banner')).innerText());
  await toList(page);
  await rowCount(page, 150, 'Rozcestník at depth 2');
  assert.equal(flat(await (await must(banner(page), 'the banner in List')).innerText()), b, 'the same banner');
  await click(main(page).getByRole('button', { name: 'Show all', exact: true }), 'Show all');
  await rowCount(page, 161, '`Show all`');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-7

test('fr_ux_08_ac7_list_states_and_live_updates', async ({ page }) => {
  const core = await openGraph(page, P.osamela, { uiState: uiG3({ full: { view: 'list' } }) });
  await must(listTree(page), 'List');
  await rowCount(page, 1, 'Osamělá');
  await must(stateText(page).filter({ hasText: 'No links yet' }), '`No links yet` in List');
  await startGraph(page, { route: graphRoute(P.plan), uiState: uiG3({ full: { view: 'list' } }) });
  await must(listTree(page), 'Plán in List', 8000);
  await click(noneBtn(page), 'None');
  await must(main(page).getByText(/^All \d+ linked objects are hidden by the type filter\.$/), 'all hidden: the R110 text in List');
  await click(main(page).getByRole('button', { name: 'Show all types', exact: true }), 'Show all types');
  await rowCount(page, 10, 'back to 10');
  const row = await must(treeRow(page, 'Plán čtvrtletí'), 'the Plán row');
  await row.focus();
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
  await rowCount(page, 11, 'another program\'s edit adds a row within 2 s');
  const r = await rows(page);
  const i = r.findIndex((x) => x.name === 'Osamělá, Page');
  assert.ok(i > 0 && r[i].level === 2, 'the row `Osamělá` under `Plán čtvrtletí`');
  assert.equal((await focused(page)).name, 'Plán čtvrtletí, Page', 'the focus stays on the focused row');
  await core.graphDelay(800);
  await click(depthBtn(page, 2), 'depth 2');
  await sleep(350);
  await must(loadingStatus(page), 'loading after 300 ms in List');
  await core.graphDelay(0);
  await sleep(800);
  await core.setFile(P.plan, null);
  await must(stateText(page).filter({ hasText: 'This object was deleted' }), 'the centre deleted, in List', 3000);
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-8

test('fr_ux_08_ac8_list_rows_follow_the_preview_mode', async ({ page }) => {
  const core = await openGraph(page, P.plan, { uiState: uiG3({ full: { view: 'list' } }) });
  const row = await must(treeRow(page, 'Rozpočet 2027'), 'the `Rozpočet 2027` row');
  await row.click();
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'click mode: a click previews');
  await row.dblclick();
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a double-click opens');
});

test('fr_ux_08_ac8_list_rows_follow_the_preview_mode_hover', async ({ page }) => {
  const core = await openGraph(page, P.plan, { uiState: uiG3({ full: { view: 'list' }, preview: { mode: 'hover', hoverDelay: 400 } }) });
  const row = await must(treeRow(page, 'Rozpočet 2027'), 'the `Rozpočet 2027` row');
  const b = (await row.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + b.height / 2);
  await page.mouse.move(b.x + 24, b.y + b.height / 2);
  await sleep(150);
  assert.ok(!(await seen(hoverRing(page), 200)), 'no ring on a row (as R103 rows)');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'hover mode: resting for the delay previews', 2000);
  await row.click();
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a click opens');
});

test('fr_ux_08_ac8_list_rows_follow_the_preview_mode_off', async ({ page }) => {
  const core = await openGraph(page, P.plan, { uiState: uiG3({ full: { view: 'list' }, preview: { mode: 'off' } }) });
  await click(treeRow(page, 'Rozpočet 2027'), 'the `Rozpočet 2027` row');
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'Off: a click opens');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-30

test('fr_ux_03_ac30_list_tree_keyboard', async ({ page }) => {
  const core = await openGraph(page, P.plan, { uiState: uiG3({ full: { view: 'list', depth: 2 } }) });
  await rowCount(page, 19, 'List from Plán at depth 2');
  const sw = await must(viewBtn(page, 'List'), 'List');
  await sw.focus();
  for (let i = 0; i < 6 && (await focused(page)).role !== 'treeitem'; i++) await page.keyboard.press('Tab');
  const at = async () => (await focused(page)).name;
  assert.equal(await at(), 'Plán čtvrtletí, Page', 'Tab lands on the `Plán čtvrtletí` row');
  await page.keyboard.press('ArrowDown');
  assert.equal(await at(), 'Rozpočet 2027, Projekt', '↓ to Rozpočet 2027');
  await page.keyboard.press('ArrowRight');
  assert.equal(await at(), 'Jana Nováková, Osoba', '→ to its first child');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await at(), 'Rozpočet 2027, Projekt', '← back to the parent');
  await page.keyboard.press('ArrowLeft');
  const r = await rows(page);
  assert.equal(r.find((x) => x.name === 'Rozpočet 2027, Projekt')?.expanded, 'false', '← collapses it');
  assert.deepEqual(r.filter((x) => ['Jana Nováková, Osoba', 'Výdaje 2026, Page', '#Finance, Tag'].includes(x.name) && x.visible).map((x) => x.name), [], 'its 3 children hidden');
  await page.keyboard.press('ArrowRight');
  assert.equal((await rows(page)).find((x) => x.name === 'Rozpočet 2027, Projekt')?.expanded, 'true', '→ expands it');
  await page.keyboard.press('End');
  assert.equal(await at(), 'Zaplatit fakturu, Task', 'End: the last visible row');
  await page.keyboard.press('Home');
  assert.equal(await at(), 'Plán čtvrtletí, Page', 'Home: the first');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), '⏎ previews (click mode)');
  assert.equal(await at(), 'Rozpočet 2027, Projekt', 'the focus stays on the row');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(previewCol(page).locator('[data-preview-path]'), 500)), 'Esc closes the preview');
  await page.keyboard.press('Alt+Space');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), '⌥Space previews');
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  assert.ok(await routeReady(core, graphRoute(P.rozpocet), 4000), '`C` centres on Rozpočet');
  await page.keyboard.press('Meta+BracketLeft');
  await must(treeRow(page, 'Rozpočet 2027'), 'Back to Plán in List', 4000);
  const row = await must(treeRow(page, 'Rozpočet 2027'), 'the Rozpočet row');
  await row.focus();
  await page.keyboard.press('Meta+Enter');
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), '⌘⏎ opens');
  assert.equal((await fullState(core))?.view, 'list', 'the view stays stored as List');
});
