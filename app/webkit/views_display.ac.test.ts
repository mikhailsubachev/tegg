// Slice Q3, L5 (WebKit + fake core): the display switch, the Group menu, own and effective display and grouping per
// usage, widths in the vault, broken values, old words, where nothing can be written, `New view`, tabs and toolbar,
// rename / duplicate / remove / trash with the new keys, the editor without View / Lanes / Group by, the query page's
// defaults, live changes, `All <plural>` on this Mac, Type settings › Views, renames reaching lane orders, NFC, base
// checks, one write per action, machine-local state, commands, the keyboard tour, themes, accessibility and strings.
// docs/acceptance/views.md part five: FR-QRY-05 AC-32…AC-36, AC-43…AC-46, FR-QRY-07 AC-32…AC-35, FR-QRY-01 AC-21,
// FR-QRY-06 AC-26, FR-QRY-09 AC-9, FR-TYP-09 AC-37, FR-TYP-01 AC-29, FR-LNK-03 AC-26, FR-FMT-12 AC-16, FR-SYN-03 AC-36,
// FR-SYN-06 AC-52 (the fake core counts), FR-STO-07 AC-16, FR-UX-03 AC-56, AC-57, FR-UX-05 AC-27, FR-UX-08 AC-27,
// NFR-OTH-02 AC-25. Interface docs/contracts/v1-views.md §39…§43 (DOM §42.1, strings §42.2, UI state §42.3, commands
// §42.4, hooks §43.1). Expected bytes tests/fixtures/queries-files/expected/views-display/ (README there). Fixture: the
// base tests/fixtures/vaults/views/ or, where a test says overlay, views-display/ over it. Written from the ACs and the
// contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, CTENI, CTENI_ID, P26_ROWS, Q, ZED, ZOB, addMenu, addView, allTab, block, blockKey, click, description, displayButton, displayFile, displaySwitch,
  displayVault, editor, eventually, expectedDisplay, expectedView, fileText, fileWhen, groupButton, groupChoice, groupItems, groupMenu, groupScope, groupsIn, isDisabled,
  groupChevron, lanesChoice, lanesPart, liveRegion, main, menuItem, must, nfc, noteRoute, notices, openGroup, openNote, original, pageKey, panelOf, paths, pressed, qfile, queryRoute,
  resizeHandle, runCommand, rx, seen, selectTab, sleep, sortButton, startViews, swap, tab, tabKey, tabMenu, tabs, tabsAre, toolbar, toolbarMenuButton, typeRoute, viewMenu, uiState, uiWrites, useQueryDisplay,
  useQueryGrouping, viewsVault, wallCards, wallHook, wallIn, writtenPaths, writes, type FakeCoreHandle,
} from './views-display-helpers';
import { startTasksViews, TYPE_TASK } from './views-tasks-helpers';
import { axeContrast } from './read-helpers';
import { commit as commitTitle, typeTitle } from './rename-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const BASE_BOOK = original(BOOK_YML);
const OVERLAY_BOOK = displayFile('.tegg/types/book.yml');
const OVERLAY_ZOB = displayFile(ZOB);
const NOT_EDITABLE = 'Open the note to change how this block shows.';
const READ_ONLY = 'Made by a newer version of Tegg. Read-only.';
const VIEWS_OUT = '"Books" changed outside Tegg. The views weren\'t changed.';
const QUERY_OUT = 'This query changed outside Tegg. Your change wasn\'t saved.';
const minusModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, '');
const tabRoot = (page: Page) => panelOf(page);
const hdr = (scope: Locator, name: string) => scope.getByRole('columnheader', { name: new RegExp(`^⟦?${name}`) });
async function widthOf(loc: Locator): Promise<number> {
  const b = await (await must(loc, 'column header')).boundingBox();
  return b ? b.width : -1;
}
/** Every vault file write and type / query write so far (paths). */
const allWrites = (core: FakeCoreHandle) => writtenPaths(core);
async function choose(page: Page, scope: Locator, id: string) {
  await openGroup(page, scope);
  await click(groupChoice(page, id), `Group › ${id}`);
}
/** A pointer resize of a column's handle to `to` px, returning the vault write count seen during the drag. */
async function resizeTo(page: Page, core: FakeCoreHandle, scope: Locator, column: string, to: number): Promise<number> {
  const h = await must(resizeHandle(scope, column), `Resize ${column}`, 5000);
  const th = hdr(scope, column);
  const w0 = await widthOf(th);
  const b = await h.boundingBox();
  assert.ok(b, `Resize ${column} has a box`);
  const x = b!.x + b!.width / 2, y = b!.y + b!.height / 2;
  const before = (await allWrites(core)).length;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((to - w0) * i) / 10, y);
  const during = (await allWrites(core)).length - before;
  await page.mouse.up();
  await sleep(200);
  return during;
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32

test('fr_qry_05_ac32_display_switch_on_a_tab', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  assert.equal(await pressed(tabRoot(page)), 'table', 'the Display group has Table pressed');
  const q0 = await fileText(core, qfile(Q.p26)), c0 = await fileText(core, CTENI);
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  const want = expectedDisplay('types/book-prectene-view-wall.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, '(1) line 13 → the block list with `    view: wall`');
  assert.deepEqual([await fileText(core, qfile(Q.p26)), await fileText(core, CTENI)], [q0, c0], '(1) the query file and Čtení untouched');
  const cards = await eventually(() => wallCards(tabRoot(page)), (c) => c.length === 8, 300);
  assert.deepEqual(cards, paths(P26_ROWS), '(2) within 300 ms R228\'s 8 cards in R193\'s order');
  assert.match(flat(await sortButton(tabRoot(page)).first().innerText()), /Finished ↓.*\+2/, '(2) the sort button still reads Finished ↓ +2');
  // (3) The query page and Čtení's block still draw the Table.
  const n1 = (await allWrites(core)).length;
  await click(displayButton(tabRoot(page), 'wall'), 'Wall again');
  await sleep(300);
  assert.equal((await allWrites(core)).length, n1, '(4) choosing the pressed display writes nothing');
  await click(displayButton(tabRoot(page), 'list'), 'List');
  const list = expectedDisplay('types/book-prectene-view-list.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === list), list, '(5) only `    view: wall` → `    view: list`');
  await openGroup(page, tabRoot(page));
  await click(useQueryDisplay(page), 'Use the query\'s display');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === BASE_BOOK), BASE_BOOK, '(6) book.yml equals the fixture byte for byte');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-33

test('fr_qry_05_ac33_display_and_grouping_in_a_block_and_on_the_query_page', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CTENI) });
  const b = block(page, Q.p26);
  await must(b, 'Čtení\'s Přečtené 2026 block', 8000);
  const book0 = await fileText(core, BOOK_YML), q0 = await fileText(core, qfile(Q.p26));
  await click(displayButton(b, 'wall'), 'Wall in the block');
  const want = expectedDisplay('notes/cteni-2026-prectene-view-wall.md');
  assert.equal(await fileWhen(core, CTENI, (t) => t === want), want, '(a) view: wall after line 11, modified: per D-55');
  assert.deepEqual([await fileText(core, BOOK_YML), await fileText(core, qfile(Q.p26))], [book0, q0], '(a) the query file and book.yml untouched');
  const hook = await eventually(() => wallHook(page), (h) => !!h?.some((x) => x.display === 'wall' && x.grouped === false && x.columns === 3));
  assert.ok(hook?.some((x) => x.display === 'wall' && x.grouped === false && x.columns === 3), '(a) the cards 3 per row inside the note column');
  await page.keyboard.press('Meta+z');
  assert.equal(minusModified(await fileWhen(core, CTENI, (t) => minusModified(t) === minusModified(original(CTENI)))), minusModified(original(CTENI)), '(a) ⌘Z restores the fence\'s lines');
  // (d) The Rozečtené block: Group › Lanes › Rows, then `To read` before `Reading`.
  const r = block(page, Q.roz);
  await openGroup(page, r);
  await click(lanesChoice(page, 'rows'), 'Lanes › Rows');
  const rows = expectedDisplay('notes/cteni-2026-rozectene-lanes-rows.md');
  assert.equal(minusModified(await fileWhen(core, CTENI, (t) => minusModified(t) === minusModified(rows))), minusModified(rows), '(d) lanes: rows after line 15');
  assert.equal(await fileText(core, qfile(Q.roz)), original(qfile(Q.roz)), '(d) Rozečtené.yml untouched');
  // (c) The query page writes the query file; usages without own values follow.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: queryRoute(Q.p26) });
  const pageBlock = main(page);
  await click(displayButton(pageBlock, 'wall'), 'Wall on query/Přečtené 2026');
  const qw = expectedDisplay('queries/prectene-2026-view-wall.yml');
  assert.equal(await fileWhen(core2, qfile(Q.p26), (t) => t === qw), qw, '(c) line 14 → view: wall, and modified:');
  assert.deepEqual(await writes(core2), [], '(c) no note or type file written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-34

test('fr_qry_05_ac34_group_menu', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  await selectTab(page, Q.vyb);
  assert.equal(flat(await groupButton(tabRoot(page)).first().innerText().catch(() => '')), 'Group', '(1) `Group` reads Group');
  await openGroup(page, tabRoot(page));
  assert.equal(flat(await groupScope(page).first().innerText().catch(() => '')), 'This tab\'s display and grouping', '(1) the scope line');
  assert.deepEqual((await groupItems(page)).map((i) => [i.text, i.checked]), [
    ['None', true], ['Author', false], ['Status', false], ['Rating', false], ['Genres', false], ['Tags', false],
    ['Finished · by period', false], ['Created · by period', false], ['Modified · by period', false],
  ], '(1) the choices; no month entry');
  assert.equal(await lanesPart(page).count(), 0, '(1) no Lanes part on a Table');
  // Esc closes, writes nothing, focuses Group.
  await page.keyboard.press('Escape');
  assert.equal(await groupMenu(page).count(), 0, 'Esc closes the menu');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-command')), 'group.open', 'the focus back on Group');
  await choose(page, tabRoot(page), 'status');
  const s2 = expectedDisplay('types/book-vyborne-group-status.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === s2), s2, '(2) `    group_by: status`');
  assert.equal(flat(await groupButton(tabRoot(page)).first().innerText()), 'Status', '(2) Group reads Status');
  assert.deepEqual((await groupsIn(tabRoot(page))).map((g) => [g.id, g.rows.length]), [['option:Read', 3]], '(2) one group, Read 3');
  const n = (await allWrites(core)).length;
  await choose(page, tabRoot(page), 'status');
  await sleep(300);
  assert.equal((await allWrites(core)).length, n, 'the checked item writes nothing');
  await click(displayButton(tabRoot(page), 'wall'), '(3) Wall');
  const s3 = expectedDisplay('types/book-vyborne-group-status-wall.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === s3), s3, '(3) `    view: wall` before group_by');
  await openGroup(page, tabRoot(page));
  assert.equal(await lanesChoice(page, 'columns').getAttribute('aria-checked'), 'true', '(3) the Lanes part, Columns checked');
  await click(lanesChoice(page, 'rows'), '(4) Rows');
  const s4 = expectedDisplay('types/book-vyborne-group-status-wall-rows.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === s4), s4, '(4) `    lanes: rows`');
  await choose(page, tabRoot(page), 'none');
  const s5 = expectedDisplay('types/book-vyborne-group-none.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === s5), s5, '(5) `    group_by: none`; lanes kept');
  await openGroup(page, tabRoot(page));
  assert.equal(await lanesPart(page).count(), 0, '(5) the Lanes part goes');
  await page.keyboard.press('Escape');
  await choose(page, tabRoot(page), 'status');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === s4), s4, '(6) the direction comes back');
  // A runtime view over Autor (only a Text attribute): None, Tags, Created · by period, Modified · by period.
});

test('fr_qry_05_ac34_group_menu_other_types_and_placement', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = swap(f[BOOK_YML], 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Knihy a autoři]\n'); });
  await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, 'Knihy a autoři'), 'tab Knihy a autoři', 8000);
  await selectTab(page, 'Knihy a autoři');
  await openGroup(page, tabRoot(page));
  assert.deepEqual((await groupItems(page)).map((i) => i.text), ['None', 'Tags', 'Created · by period', 'Modified · by period'], 'a view over [book, autor]');
  for (const [w, h] of [[1440, 900], [1024, 768], [800, 500], [2560, 1440]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.keyboard.press('Escape');
    await openGroup(page, tabRoot(page));
    const b = await groupMenu(page).first().boundingBox();
    assert.ok(b && b.x >= 8 - 0.5 && b.y >= 8 - 0.5 && b.x + b.width <= w - 8 + 0.5 && b.y + b.height <= h - 8 + 0.5, `${w} × ${h}: the menu inside the window`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-35

test('fr_qry_05_ac35_own_and_effective_values', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.roz), 'tab Rozečtené', 8000);
  await selectTab(page, Q.roz);
  assert.deepEqual(await eventually(() => wallCards(tabRoot(page)), (c) => c.length === 5), paths(['Dům u řeky', 'Kniha o horách', 'Noční vlak', 'Účetní ze Žižkova', 'Světla přístavu']), '(1) tab Rozečtené: R228\'s ungrouped wall');
  assert.equal(await main(page).locator('[data-usage-differs], .usage-dot, [aria-label*="differs" i]').count(), 0, '(2) no dot, badge or text');
  await openGroup(page, tabRoot(page));
  await click(useQueryGrouping(page), '(3) Use the query\'s grouping');
  const g = expectedDisplay('types/book-overlay-rozectene-use-query-grouping.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === g), g, '(3) lines 14…15 → `  - Rozečtené`');
  // (5) Not offered on Celá zeď (plain), on query/<name> or on All Books.
  await selectTab(page, ZED);
  await openGroup(page, tabRoot(page));
  assert.deepEqual([await useQueryGrouping(page).count(), await useQueryDisplay(page).count()], [0, 0], '(5) Celá zeď: none');
  await page.keyboard.press('Escape');
  await click(allTab(page), 'All Books');
  await openGroup(page, tabRoot(page));
  assert.deepEqual([await useQueryGrouping(page).count(), await useQueryDisplay(page).count()], [0, 0], '(5) All Books: none');
});

test('fr_qry_05_ac35_own_and_effective_values_display_and_defaults', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  await openGroup(page, tabRoot(page));
  await click(useQueryDisplay(page), '(4) Use the query\'s display');
  const d = expectedDisplay('types/book-overlay-prectene-use-query-display.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === d), d, '(4) lines 16…17 → `  - Přečtené 2026`');
  // (7) query/Rozečtené › Genres: Zobrazení block 2 regroups, tab Rozečtené stays ungrouped, no usage file written.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: queryRoute(Q.roz), vault: displayVault() });
  await choose(page, main(page), 'genres');
  await eventually(() => fileText(core2, qfile(Q.roz)), (t) => !!t?.includes('group_by: genres'));
  assert.deepEqual(await writes(core2), [], '(7) no usage file written');
  await openNote(page, 'Zobrazení knih');
  const b2 = block(page, Q.roz, 0);
  const groups = await eventually(() => groupsIn(b2), (gs) => gs.length > 0 && gs.every((x) => x.id.startsWith('option:') && ['Román', 'Detektivka', 'Eseje', 'Cestopis', 'Poezie'].some((v) => x.id.endsWith(v))), 1000);
  assert.ok(groups.length > 0, '(7) within 1 s block 2 regroups by Genres, in option order');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-36

test('fr_qry_05_ac36_broken_values', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(ZOB), vault: displayVault() });
  const b5 = block(page, Q.vyb, 0);
  await must(b5, 'Zobrazení block 5', 8000);
  assert.deepEqual(await eventually(() => notices(b5).evaluateAll((ps) => ps.map((p) => p.getAttribute('data-usage-broken'))), (k) => k.length === 3), ['view', 'group_by', 'widths'], '(a) three notices in R221 order, no lanes notice');
  assert.equal(flat(await notices(b5).first().innerText()), 'The setting view can\'t be read, so its default is used.', '(a) the notice text');
  assert.deepEqual(await writes(core), [], '(a) opening and drawing write nothing');
  await openGroup(page, b5);
  assert.equal((await groupItems(page)).find((i) => i.checked)?.id, 'none', '(a) None checked (the query\'s)');
  assert.equal(await useQueryGrouping(page).count(), 1, '(a) Use the query\'s grouping offered');
  await click(groupChoice(page, 'author'), '(a) Author');
  const want = expectedDisplay('notes/zobrazeni-b5-group-author.md');
  assert.equal(await fileWhen(core, ZOB, (t) => t === want), want, '(a) line 46 → group_by: author');
  assert.deepEqual(await eventually(() => notices(b5).evaluateAll((ps) => ps.map((p) => p.getAttribute('data-usage-broken'))), (k) => k.length === 2), ['view', 'widths'], '(a) that notice goes');
  // (d) Seskupeno podle data on its query page: an ungrouped wall of 17 with the notice.
  await page.goto('about:blank');
  await startViews(page, { route: queryRoute(Q.datum) });
  assert.equal((await eventually(() => wallCards(main(page)), (c) => c.length === 17)).length, 17, '(d) an ungrouped wall of 17 books');
  assert.equal(await main(page).locator('p.query-notice').filter({ hasText: 'The setting group_by can\'t be read, so its default is used.' }).count(), 1, '(d) the notice');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-43

test('fr_qry_05_ac43_widths_are_stored_with_the_usage', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  const ui0 = await uiWrites(core);
  const during = await resizeTo(page, core, tabRoot(page), 'Title', 300);
  assert.equal(during, 0, '(a) nothing written during the drag');
  const w1 = expectedDisplay('types/book-prectene-widths-title-300.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === w1), w1, '(a) once on release: `    widths: { title: 300 }`');
  await resizeTo(page, core, tabRoot(page), 'Author', 200);
  const w2 = expectedDisplay('types/book-prectene-widths-title-300-author-200.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === w2), w2, '(a) `    widths: { title: 300, author: 200 }`');
  assert.equal((await uiState(core))?.usageColumnWidths?.[tabKey(Q.p26)], undefined, '(a) no usageColumnWidths entry');
  assert.equal((await uiWrites(core)) - ui0, 0, '(a) no ui_state_set for a tab resize');
  const n = (await allWrites(core)).length;
  await resizeTo(page, core, tabRoot(page), 'Author', 200);
  assert.equal((await allWrites(core)).length, n, '(a) a drag that ends at its starting width writes nothing');
  // (e) A wall has no resize handles.
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  assert.equal(await tabRoot(page).getByRole('separator', { name: /^⟦?Resize / }).count(), 0, '(e) a wall: no handles');
  // (c) query/Přečtené 2026 keeps widths on this Mac.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: queryRoute(Q.p26) });
  await resizeTo(page, core2, main(page), 'Title', 280);
  const st = await eventually(() => uiState(core2), (u) => !!u?.usageColumnWidths?.[pageKey(Q.p26)]);
  assert.ok(st?.usageColumnWidths?.[pageKey(Q.p26)]?.title, '(c) usageColumnWidths["page:přečtené 2026"]');
  assert.deepEqual(await writes(core2), [], '(c) no vault file');
});

test('fr_qry_05_ac43_widths_are_stored_with_the_usage_block_and_keys', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CTENI) });
  const b = block(page, Q.p26);
  await must(b, 'Čtení\'s block', 8000);
  await resizeTo(page, core, b, 'Title', 200);
  const want = expectedDisplay('notes/cteni-2026-prectene-widths-title-200.md');
  assert.equal(await fileWhen(core, CTENI, (t) => t === want), want, '(b) widths: { title: 200 } after line 11, one autosave');
  // (f) Keys: one write on blur or 1 s after the last key; ⌫ removes the entry; Reset removes widths.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.p26);
  const h = await must(resizeHandle(tabRoot(page), 'Title'), 'Resize Title', 5000);
  await h.focus();
  const n0 = (await allWrites(core2)).length;
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await sleep(300);
  assert.equal((await allWrites(core2)).length, n0, '(f) no write per key');
  await sleep(1100);
  assert.equal((await allWrites(core2)).length - n0, 1, '(f) one write 1 s after the last key');
  await h.focus();
  await page.keyboard.press('Backspace');
  assert.equal(await fileWhen(core2, BOOK_YML, (t) => t === BASE_BOOK), BASE_BOOK, '(f) ⌫ removes that column\'s entry; empty widths go');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-44

test('fr_qry_05_ac44_widths_kept_by_0_6', async ({ page }) => {
  const ui = { usageColumnWidths: { [tabKey(Q.p26)]: { title: 200, author: 180 }, [blockKey(CTENI_ID, Q.p26, 1)]: { title: 220 } } };
  const core = await startViews(page, { route: typeRoute('book'), ui });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  assert.ok(Math.abs((await widthOf(hdr(tabRoot(page), 'Title'))) - 200) <= 1 && Math.abs((await widthOf(hdr(tabRoot(page), 'Author'))) - 180) <= 1, '(1) Title 200, Author 180');
  assert.deepEqual(await writes(core), [], '(1) opening writes nothing');
  const ui0 = await uiWrites(core);
  await resizeTo(page, core, tabRoot(page), 'Rating', 150);
  const want = expectedDisplay('types/book-prectene-widths-legacy-rating.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, '(2) the kept widths plus the new one');
  const st = await eventually(() => uiState(core), (u) => !u?.usageColumnWidths?.[tabKey(Q.p26)]);
  assert.equal(st?.usageColumnWidths?.[tabKey(Q.p26)], undefined, '(3) the 0.6.0 entry removed');
  assert.equal((await uiWrites(core)) - ui0, 1, '(3) in one ui_state_set');
  // (4) The overlay's Výborné knihy (own widths) ignores a kept entry.
  await page.goto('about:blank');
  await startViews(page, { route: typeRoute('book'), vault: displayVault(), ui: { usageColumnWidths: { [tabKey(Q.vyb)]: { title: 400 } } } });
  await selectTab(page, Q.vyb);
  assert.ok(Math.abs((await widthOf(hdr(tabRoot(page), 'Title'))) - 260) <= 1, '(4) Title 260 from the item, the kept 400 ignored');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-45

test('fr_qry_05_ac45_where_display_and_grouping_cant_be_written', async ({ page }) => {
  // Blocks without an editor: a copy of Zobrazení in the Trash view.
  const core = await startViews(page, { route: 'inbox', vault: displayVault((f) => { f[`.trash/${ZOB}`] = OVERLAY_ZOB.replace('id: 01JB5V00000000000000000031', 'id: 01JB5V00000000000000000039'); }) });
  await runCommand(page, 'Go to Trash');
  await click(main(page).getByRole('row').filter({ hasText: 'Zobrazení knih' }).first(), 'the trashed note');
  await page.keyboard.press('Enter');
  await must(block(page, Q.roz), 'block 2', 8000);
  const b2 = block(page, Q.roz);
  for (const [what, loc] of [['the display switch', displayButton(b2, 'list')], ['Group', groupButton(b2)], ['Resize Title', resizeHandle(b2, 'Title')]] as const) {
    assert.equal(await isDisabled(loc), true, `no editor: ${what} aria-disabled`);
    assert.equal(await description(loc), NOT_EDITABLE, `no editor: ${what} says why`);
  }
  assert.ok((await groupsIn(b2)).length >= 2, 'own values still apply: block 2 grouped');
  assert.ok(Math.abs((await widthOf(hdr(b2, 'Title'))) - 240) <= 1, 'own values still apply: Title 240');
  // A newer query file: read-only.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => { f[qfile(ZED)] = swap(f[qfile(ZED)], 'version: 1\n', 'version: 2\n'); }) });
  await selectTab(page, ZED);
  assert.equal(await isDisabled(displayButton(tabRoot(page), 'table')), true, 'a version 2 query: the switch disabled');
  assert.equal(await description(groupButton(tabRoot(page))), READ_ONLY, 'with the read-only reason');
  // Inline fences: no switch and no Group.
  await openNote(page, 'Čtení 2026');
  assert.equal(await main(page).locator('figure[data-query-block][data-query-form="inline"] div[data-display-switch]').count(), 0, 'inline fences: no switch');
  assert.deepEqual([...(await writes(core)), ...(await writes(core2))], [], 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-46

test('fr_qry_05_ac46_old_words_keep_reading', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.autor), 'tab Podle autora', 8000);
  for (const n of [Q.roz, Q.p26, Q.vyb, Q.zanr, Q.autor, ZED]) await selectTab(page, n);
  await openNote(page, 'Zobrazení knih');
  await sleep(500);
  assert.deepEqual(await writes(core), [], '(b) browsing every tab and Zobrazení writes nothing');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.autor);
  assert.equal(await pressed(tabRoot(page)), 'wall', '(a) `view: board` reads as wall');
  await openGroup(page, tabRoot(page));
  assert.equal(await lanesChoice(page, 'rows').getAttribute('aria-checked'), 'true', '(a) `lanes: horizontal` reads as Rows');
  await click(lanesChoice(page, 'columns'), '(c) Columns');
  const want = expectedDisplay('types/book-overlay-podle-autora-lanes-columns.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, '(c) only line 27; `    view: board` kept');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-32

test('fr_qry_07_ac32_new_view_offers_table_list_wall', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('autor') });
  await click(addView(page), 'Add view');
  const menu = await must(addMenu(page), 'Add view menu');
  const group = menu.getByRole('group', { name: rx('New view') });
  const items = await (await must(group, 'group New view')).getByRole('menuitem').evaluateAll((xs) => xs.map((x) => ((x as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));
  assert.deepEqual(items, ['Table', 'List', 'Wall'], '(1) exactly Table, List, Wall; no Board, no `by` hint');
  await click(group.getByRole('menuitem', { name: rx('Wall') }), 'Wall');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const want = expectedDisplay('queries/new-view-wall-autor.yml');
  assert.equal(await fileWhen(core, qfile('New view'), (t) => t === want), want, '(2) view: wall, no columns, group_by or lanes');
  assert.ok((await fileText(core, '.tegg/types/autor.yml'))?.includes('views: [New view]'), '(3) views: [New view]');
  assert.equal(flat(await groupButton(tabRoot(page)).first().innerText()), 'Group', '(4) Group reads Group');
  assert.ok(await seen(wallIn(tabRoot(page))), '(4) an ungrouped wall');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-33

test('fr_qry_07_ac33_tab_icons_and_toolbar', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await tabsAre(page, [Q.roz, Q.p26, Q.vyb, Q.zanr, Q.autor, ZED], 8000);
  assert.deepEqual((await tabs(page)).map((t) => t.kind), ['table', 'wall', 'wall', 'table', 'list', 'wall', 'wall'], 'data-view-kind: effective displays');
  assert.equal(await page.getByRole('radiogroup', { name: rx('Lanes') }).count(), 0, 'no radiogroup Lanes');
  await selectTab(page, Q.vyb);
  const order = await toolbar(page).first().evaluate((t) => ([...t.querySelectorAll('[data-command], [role="searchbox"], [data-display-switch]')] as HTMLElement[])
    .map((e) => e.getAttribute('data-display-switch') !== null ? 'display' : e.getAttribute('data-command') ?? e.getAttribute('role'))
    .filter((x, i, a) => x && a.indexOf(x) === i && !(x ?? '').startsWith('display.')));
  assert.deepEqual(order.filter((x) => ['searchbox', 'tags.filter', 'display', 'group.open', 'sort.open', 'view.columns', 'views.menu'].includes(x as string)),
    ['searchbox', 'tags.filter', 'display', 'group.open', 'sort.open', 'view.columns', 'views.menu'], 'R223\'s toolbar order on a Table');
  await selectTab(page, Q.p26);
  assert.equal(await toolbar(page).locator('button[data-command="view.columns"]').count(), 0, 'no Columns on a Wall');
  await core.setFile(BOOK_YML, swap(OVERLAY_BOOK, '  - name: Přečtené 2026\n    view: wall\n', '  - name: Přečtené 2026\n    view: list\n'));
  const kinds = await eventually(async () => (await tabs(page)).map((t) => t.kind), (k) => k[2] === 'list', 2000);
  assert.equal(kinds[2], 'list', 'an outside change: the icon follows within 2 s');
  assert.deepEqual(await writes(core), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-34

test('fr_qry_07_ac34_rename_duplicate_remove_trash_carry_the_keys', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await click(menuItem(await tabMenu(page, Q.vyb), 'Duplicate'), 'Duplicate');
  const dup = expectedDisplay('types/book-overlay-vyborne-duplicate.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === dup), dup, '(b) the copy\'s item with group_by, lane_order, widths');
  await core.setFile(BOOK_YML, OVERLAY_BOOK);
  await click(menuItem(await tabMenu(page, Q.zanr), 'Remove from Books page'), 'Remove');
  const rm = expectedDisplay('types/book-overlay-without-podle-zanru.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === rm), rm, '(c) lines 22…24 removed');
  await core.setFile(BOOK_YML, OVERLAY_BOOK);
  await click(menuItem(await tabMenu(page, Q.autor), 'Move to trash'), 'Move to trash');
  const tr = expectedDisplay('types/book-overlay-without-podle-autora.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === tr), tr, '(d) lines 25…27 removed');
  await page.keyboard.press('Meta+z');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === OVERLAY_BOOK), OVERLAY_BOOK, '(d) Undo restores them byte for byte');
  // (a) Rename.
  await click(menuItem(await tabMenu(page, Q.vyb), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'Rename query');
  await dlg.getByRole('textbox').first().fill('Nejlepší knihy');
  await page.keyboard.press('Enter');
  const rn = expectedDisplay('types/book-overlay-vyborne-renamed.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === rn, 5000), rn, '(a) line 18 only');
  assert.equal(await fileWhen(core, ZOB, (t) => t === expectedDisplay('notes/zobrazeni-vyborne-renamed.md')), expectedDisplay('notes/zobrazeni-vyborne-renamed.md'), '(a) Zobrazení lines 43 and 53');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-35

test('fr_qry_07_ac35_items_with_display_keys_read_and_kept', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => { f[BOOK_YML] = expectedDisplay('types/book-overlay-xbarva-input.yml'); }) });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await sleep(500);
  assert.deepEqual(await writes(core), [], 'opening writes nothing');
  await selectTab(page, Q.vyb);
  assert.equal(await pressed(tabRoot(page)), 'table', 'the item\'s Table');
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  const want = expectedDisplay('types/book-overlay-xbarva-after-display.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, '`x-barva: modrá` kept after the known keys');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-21

test('fr_qry_01_ac21_editor_without_view_lanes_group_by', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.roz), 'tab', 8000);
  await selectTab(page, Q.roz);
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  const dlg = await must(editor(page), 'Edit query');
  assert.equal(await dlg.getByRole('radiogroup', { name: rx('View') }).count(), 0, 'no View control');
  assert.equal(await dlg.getByRole('combobox', { name: rx('Group by') }).count(), 0, 'no Group by combobox');
  assert.equal(await dlg.getByText(/^⟦?Lanes⟧?$/).count(), 0, 'no Lanes control');
  assert.equal(await dlg.getByText(/^⟦?On cards⟧?$/).count(), 0, 'no On cards row');
  assert.equal(await dlg.getByRole('group', { name: rx('Sort') }).count(), 0, 'no Sort row');
  assert.equal(flat(await dlg.locator('p.qe-limit-hint').first().innerText().catch(() => '')), 'Applies to a List or Table without grouping', 'Limit with its hint');
  assert.equal(await dlg.getByRole('checkbox', { name: /Done in its own lane/ }).count(), 0, 'Rozečtené: no done-lane checkbox');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writes(core), [], 'nothing written');
  // Schedule: the done-lane checkbox shows (FR-TSK-04 AC-26).
  await page.goto('about:blank');
  await startTasksViews(page, { route: TYPE_TASK });
  await must(tab(page, 'Schedule'), 'Schedule', 8000);
  await selectTab(page, 'Schedule');
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view on Schedule');
  const d2 = await must(editor(page), 'Edit query');
  assert.equal(await d2.getByRole('checkbox', { name: /Done in its own lane, last 7 days/ }).count(), 1, 'Schedule: the done-lane checkbox');
  assert.equal(await d2.getByRole('combobox', { name: rx('Group by') }).count(), 0, 'Schedule: no Group by');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-26

test('fr_qry_06_ac26_query_page_sets_display_and_grouping_defaults', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(Q.roz) });
  assert.equal(await pressed(main(page)), 'wall', 'Wall pressed');
  await openGroup(page, main(page));
  assert.equal(flat(await groupScope(page).first().innerText()), 'Default for tabs and blocks without their own', 'the scope line');
  assert.equal((await groupItems(page)).find((i) => i.checked)?.id, 'status', 'Status checked');
  assert.equal(await lanesChoice(page, 'columns').getAttribute('aria-checked'), 'true', 'Columns checked');
  await click(groupChoice(page, 'genres'), 'Genres');
  const g = expectedView('rozectene-group-by-genres.yml');
  assert.equal(await fileWhen(core, qfile(Q.roz), (t) => t === g), g, 'Genres: the expected bytes');
  await click(displayButton(main(page), 'table'), 'Table');
  const t = expectedView('rozectene-view-table.yml');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === t), t, 'Table: the expected bytes');
  assert.deepEqual(await writes(core), [], 'no usage file');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-9

test('fr_qry_09_ac9_display_and_grouping_follow_external_changes', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  assert.equal(await pressed(tabRoot(page)), 'wall', 'setup: the tab\'s own wall');
  await core.setFile(BOOK_YML, swap(OVERLAY_BOOK, '  - name: Přečtené 2026\n    view: wall\n', '  - name: Přečtené 2026\n    view: table\n'));
  assert.equal(await eventually(() => pressed(tabRoot(page)), (p) => p === 'table', 2000), 'table', 'line 17 `view: table`: a Table within 2 s');
  await core.setFile(qfile(Q.roz), swap(original(qfile(Q.roz)), 'group_by: status\n', 'group_by: genres\n'));
  await selectTab(page, Q.roz);
  assert.ok(await seen(wallIn(tabRoot(page))), 'tab Rozečtené stays an ungrouped wall');
  assert.deepEqual(await writes(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-37

test('fr_typ_09_ac37_all_tab_display_and_grouping_on_this_mac', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(allTab(page), 'All Books', 8000);
  await click(allTab(page), 'All Books');
  assert.equal(await pressed(tabRoot(page)), 'table', 'a fresh Application Support: a Table');
  const ui0 = await uiWrites(core);
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  assert.equal((await eventually(() => wallCards(tabRoot(page)), (c) => c.length === 17)).length, 17, 'Wall: 17 cards');
  const st = await eventually(() => uiState(core), (u) => u?.allView?.book?.view === 'wall');
  assert.equal(st?.allView?.book?.view, 'wall', 'ui-state.json allView.book');
  assert.equal((await uiWrites(core)) - ui0, 1, 'once');
  await openGroup(page, tabRoot(page));
  assert.equal(flat(await groupScope(page).first().innerText()), 'Display and grouping of this page on this Mac', 'the scope line');
  assert.deepEqual([await useQueryGrouping(page).count(), await useQueryDisplay(page).count()], [0, 0], 'no Use the query\'s …');
  await click(groupChoice(page, 'status'), 'Status');
  await click(displayButton(tabRoot(page), 'table'), 'Table');
  assert.deepEqual((await eventually(() => groupsIn(tabRoot(page)), (g) => g.length === 5)).map((g) => [g.id, g.rows.length]),
    [['option:To read', 3], ['option:Reading', 3], ['option:Read', 9], ['unknown:Rozečteno', 1], ['none', 1]], 'R228\'s groups');
  assert.equal(await tabRoot(page).locator('[data-command="group.drag"]').count(), 0, 'no grips');
  assert.equal(await fileText(core, BOOK_YML), BASE_BOOK, 'book.yml byte-identical');
  assert.deepEqual(await writes(core), [], 'no vault file');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-29

test('fr_typ_01_ac29_views_section_names_displays', async ({ page }) => {
  await startViews(page, { route: 'type-settings/book', vault: displayVault() });
  const section = main(page).getByRole('region', { name: rx('Views') }).or(main(page).locator('section[data-section="views"]'));
  await must(section, 'Views section', 8000);
  const text = flat(await section.first().innerText());
  for (const [name, kind] of [[Q.roz, 'Wall'], [Q.p26, 'Wall'], [Q.vyb, 'Table · by Author'], [Q.zanr, 'List · by Genres'], [Q.autor, 'Wall · by Author'], [ZED, 'Wall']]) {
    assert.ok(new RegExp(`${name}\\s*${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text), `${name}: ${kind} (in ${text})`);
  }
  assert.ok(!/\bBoard\b/.test(text), 'no text says Board');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-26

test('fr_lnk_03_ac26_renames_reach_usage_lane_order', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute('Autoři/Lucie Horká.md'), vault: displayVault() });
  await typeTitle(page, 'Lucie Horká-Nová');
  await commitTitle(page, 'enter');
  const want = expectedDisplay('types/book-overlay-lucie-renamed.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want, 8000), want, 'line 20 → `    lane_order: ["[[Lucie Horká-Nová]]"]`');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-16

test('fr_fmt_12_ac16_display_keys_are_nfc', async ({ page }) => {
  const nfdBook = swap(OVERLAY_BOOK, '  - name: Výborné knihy\n', `  - name: ${'Výborné knihy'.normalize('NFD')}\n`);
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => { f[BOOK_YML] = nfdBook; }) });
  await must(tab(page, Q.vyb), 'the NFD-named item as one tab', 8000);
  assert.equal((await tabs(page)).filter((t) => t.name === nfc(Q.vyb)).length, 1, 'one usage');
  await selectTab(page, Q.vyb);
  await click(groupChevron(tabRoot(page), 'relation:Autoři/Eva Lindová.md'), 'fold Eva');
  const st = await eventually(() => uiState(core), (u) => !!u?.usageFolded?.[tabKey(Q.vyb)]);
  assert.deepEqual(st?.usageFolded?.[tabKey(Q.vyb)], [nfc('relation:Autoři/Eva Lindová.md')], 'fold keys and group ids NFC');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-36

test('fr_syn_03_ac36_display_writes_check_the_base', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  const outside = swap(OVERLAY_BOOK, 'description: Knihy, které', 'description: Knížky, které');
  await core.setFile(BOOK_YML, outside, { silent: true });
  await click(displayButton(tabRoot(page), 'table'), 'Table on a changed book.yml');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: VIEWS_OUT }), 3000), 'the alert');
  assert.equal(await fileText(core, BOOK_YML), outside, 'nothing written');
  // The query page.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: queryRoute(Q.roz) });
  await core2.setFile(qfile(Q.roz), `${original(qfile(Q.roz))}# jinde\n`, { silent: true });
  await choose(page, main(page), 'genres');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: QUERY_OUT }), 3000), 'the query page\'s alert');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-52 (counts)

test('fr_syn_06_ac52_display_actions_write_one_file_once', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.vyb), 'tab', 8000);
  // (a) The tour writes nothing.
  for (const n of [Q.roz, Q.p26, Q.vyb, Q.zanr, Q.autor, ZED]) {
    await selectTab(page, n);
    await openGroup(page, tabRoot(page));
    await page.keyboard.press('Escape');
    await click(displayButton(tabRoot(page), (await pressed(tabRoot(page))) as 'list' | 'table' | 'wall'), 'the pressed display');
  }
  await selectTab(page, Q.vyb);
  await displayButton(tabRoot(page), 'table').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await allWrites(core), [], '(a) browsing, menus, the pressed display and focus moves write nothing');
  // (b) One file per action.
  await click(displayButton(tabRoot(page), 'list'), 'List');
  assert.deepEqual(await eventually(() => allWrites(core), (w) => w.length === 1), [BOOK_YML], '(b) a display choice writes book.yml once');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-16

test('fr_sto_07_ac16_display_state_on_this_mac', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(Q.p26) });
  await resizeTo(page, core, main(page), 'Title', 280);
  await page.goto('about:blank');
  await startViews(page, { route: typeRoute('book') });
  await click(allTab(page), 'All Books');
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  const st = await eventually(() => uiState(core), (u) => !!u?.allView?.book);
  assert.ok(st?.allView?.book, 'allView.book');
  const keys = Object.keys(st?.usageColumnWidths ?? {});
  assert.ok(keys.every((k) => !k.startsWith('tab:') && !k.startsWith('block:')), 'never a tab: or block: width entry');
  const files = Object.keys(await core.files());
  assert.ok(!files.some((f) => f.startsWith('.tegg/') && /ui-state|allView/.test(f)), 'nothing machine-local under .tegg/');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-56, AC-57

test('fr_ux_03_ac56_display_commands', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await runCommand(page, 'Display as wall');
  const want = expectedDisplay('types/book-prectene-view-wall.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, 'Display as wall writes the item');
  await runCommand(page, 'Group by…');
  assert.ok(await seen(groupMenu(page)), 'Group by… opens the menu');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemradio', 'the checked item focused');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-command')), 'group.open', 'FR-UX-03 AC-8: Esc gives the focus back to Group');
});

test('fr_ux_03_ac57_display_keyboard_only', async ({ page }) => {
  const core = await startViews(page, { route: 'home' });
  const step = async (n: number, f: () => Promise<void>, file: string | null) => {
    const before = (await allWrites(core)).length;
    await f();
    const w = await eventually(() => allWrites(core), (x) => x.length === before + (file ? 1 : 0));
    assert.equal(w.length - before, file ? 1 : 0, `step ${n}: ${file ? 'one write' : 'no write'}`);
  };
  await step(1, () => runCommand(page, 'Go to type: Books'), null);
  await step(2, async () => { await runCommand(page, 'Next view'); await runCommand(page, 'Next view'); }, null);
  await step(3, () => runCommand(page, 'Display as wall'), BOOK_YML);
  await step(4, async () => {
    await displayButton(tabRoot(page), 'wall').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
  }, BOOK_YML);
  await step(5, async () => {
    await runCommand(page, 'Group by…');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }, BOOK_YML);
  await step(6, () => runCommand(page, 'Display as wall'), BOOK_YML);
  await step(9, () => runCommand(page, 'Use the query\'s grouping'), BOOK_YML);
  await step(10, () => runCommand(page, 'Use the query\'s display'), BOOK_YML);
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === BASE_BOOK), BASE_BOOK, 'the tour ends where it began');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-27

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac27_display_in_both_themes_${theme}`, async ({ page }) => {
    await startViews(page, { route: typeRoute('book'), vault: displayVault(), ui: { theme } });
    await must(tab(page, Q.p26), 'tab', 8000);
    for (const n of [Q.p26, Q.vyb, Q.zanr]) {
      await selectTab(page, n);
      await sleep(300);
      assert.deepEqual(await axeContrast(page), [], `${theme} ${n}: color-contrast`);
    }
    await selectTab(page, Q.autor);
    await openGroup(page, tabRoot(page));
    assert.ok(await seen(lanesPart(page)), 'the Group menu with the Lanes part');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the menu`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-27

test('fr_ux_08_ac27_display_for_voiceover', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), vault: displayVault(), reducedMotion: 'reduce' });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await selectTab(page, Q.vyb);
  const sw = await must(displaySwitch(tabRoot(page)), 'the Display group');
  assert.equal(await sw.getAttribute('aria-label'), 'Display', 'Display, group');
  assert.deepEqual(await sw.locator('button').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])),
    [['List', 'false'], ['Table', 'true'], ['Wall', 'false']], 'List / Table pressed / Wall');
  const gb = await must(groupButton(tabRoot(page)), 'Group');
  assert.deepEqual([await gb.getAttribute('aria-label'), await gb.getAttribute('aria-haspopup'), await gb.getAttribute('aria-description')], ['Group', 'menu', 'Grouped by Author'], 'Group as a menu button with its description');
  const h = tabRoot(page).locator('button.group-chevron').first();
  assert.match((await h.getAttribute('aria-label')) ?? '', /^Lucie Horká, 1 Book$/, 'a group header reads `<value>, <count> <plural>`');
  assert.equal(await h.getAttribute('aria-expanded'), 'true', 'expanded');
  await openGroup(page, tabRoot(page));
  assert.equal(await groupMenu(page).getAttribute('aria-label'), 'Group by', 'Group by, menu');
  await page.keyboard.press('Escape');
  await selectTab(page, Q.p26);
  const names = await wallIn(tabRoot(page)).locator('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')));
  assert.equal(names[0], 'Book: Mapa bez severu', 'wall cards are articles `Book: <title>` in reading order');
  await selectTab(page, Q.vyb);
  const live0 = await liveRegion(page).innerText().catch(() => '');
  await groupGripKeys(page);
  assert.notEqual(await liveRegion(page).innerText().catch(() => ''), live0, 'a group move is announced');
});
async function groupGripKeys(page: Page) {
  const header = tabRoot(page).locator('.group-header[data-group-id] button.group-chevron').nth(1);
  await header.focus();
  await runCommand(page, 'Move lane up');
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-25

test('nfr_oth_02_ac25_display_strings', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), vault: displayVault(), pseudo: true });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await selectTab(page, Q.vyb);
  const sw = await must(displaySwitch(tabRoot(page)), 'Display');
  assert.equal(await sw.getAttribute('aria-label'), '⟦Display⟧', 'the group name in ⟦ ⟧');
  assert.deepEqual(await sw.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('title'))), ['⟦List⟧', '⟦Table⟧', '⟦Wall⟧'], 'tooltips');
  await openGroup(page, tabRoot(page));
  const texts = await groupMenu(page).locator('[role="menuitemradio"]:not([data-user-content]), .menu-scope').evaluateAll((xs) => xs.map((x) => ((x as HTMLElement).innerText ?? '').trim()));
  assert.ok(texts.length > 0 && texts.every((t) => t.startsWith('⟦') && t.endsWith('⟧')), `every non-user text in ⟦ ⟧: ${JSON.stringify(texts)}`);
});
