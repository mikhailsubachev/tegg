// Slice Q2, L5 (WebKit + fake core): the type page's views of docs/acceptance/views.md R184, R186, R190, R193: FR-QRY-07
// AC-1…AC-15, AC-17, AC-18 (tabs from `views:`, `All <plural>`, a view tab, New view, Show a saved query, tab drag and Move
// view, the view menu, rename, duplicate, remove, trash, odd values, the remembered tab, which pages have views, live
// changes, the old placeholders, column drags), FR-QRY-06 AC-23…AC-25 (page marks, `Used on`, wide query pages) and
// FR-TYP-09 AC-35 (the wide type page). Interface docs/contracts/v1-views.md §2, §4.1…§4.7. Written from the ACs and the
// contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_BOOKS, AUTOR_YML, B, BOOK_YML, CTENI, NFD, P26_ROWS, Q, ROZ_LANES, addMenu, addView, allTab, block, board, bookWithViews, callsOf, click, columnsButton,
  description, drag, editor, eventually, expectedView, fileText, fileWhen, filterField, isDisabled, lanesOf, main, menuItem, menuTexts, must, mustBeOn, mustLanes,
  near, nfc, noteRoute, original, panelHeaders, panelOf, panelRows, panelRowsAre, qfile, queriesRow, queryRoute, runCommand, seen, selectTab, selectedTab, sleep,
  sortButton, startViews, swap, tab, tabMenu, tablist, tabNames, tabs, tabsAre, tagFilterButton, textOf, toolbar, toolbarMenuButton, typeRoute, uiState, uiWrites,
  viewMenu, viewQuery, viewsOps, viewsVault, writeCalls, writes, lanesGroup, laneRadio, rx, mainName, openNote, drag as dragTo, REPO,
} from './views-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const VIEWS3 = [Q.roz, Q.p26, Q.vyb];

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-1, AC-2

test('fr_qry_07_ac1_tabs_come_from_views', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tablist(page), 'the tablist `Views` (div[role=tablist][data-views-tablist])', 8000);
  assert.equal(await tablist(page).getAttribute('aria-label'), 'Views', 'tablist named `Views`');
  assert.deepEqual(await tabsAre(page, VIEWS3), ['', ...VIEWS3], 'tabs All Books, Rozečtené, Přečtené 2026, Výborné knihy (R193)');
  const t = await tabs(page);
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-07 AC-33): the icon kind is the tab's effective display; `board` is `wall`.
  assert.deepEqual(t.map((x) => x.kind), ['table', 'wall', 'table', 'table'], 'icons: table, wall, table, table');
  assert.equal(t[0].text, 'All Books', '`All Books` first');
  assert.equal(await selectedTab(page), '', '`All Books` selected on the first open');
  assert.equal(await addView(page).getAttribute('aria-haspopup'), 'menu', '`Add view` after the tabs, a menu button');
  assert.equal(await addView(page).getAttribute('aria-label'), 'Add view', '`Add view` name');
  assert.ok(await seen(main(page).getByText('17 Books', { exact: true }), 2000), 'the header count `17 Books` (typePage.countPlural, the plural as written, D-1816)');
  const runs = (await callsOf(core, 'query_run')).length;
  assert.equal(runs, 0, 'All Books runs no query (it keeps index_type_rows)');
  assert.ok((await callsOf(core, 'queries_list')).length >= 1, 'the page asks queries_list (tab icons, offers)');
  assert.deepEqual(await writeCalls(core), [], 'opening the page writes nothing');
  await runCommand(page, 'Go to type: Autoři');
  await mustBeOn(page, 'Autoři', 'type/autor');
  assert.deepEqual(await tabsAre(page, []), [''], 'type/autor (no `views`): only `All Autoři`');
  assert.ok(await seen(addView(page), 2000), 'and `Add view`');
  assert.deepEqual(await writeCalls(core), [], 'still nothing written');
});

test('fr_qry_07_ac2_all_tab_is_the_type_page', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const all = await must(allTab(page), 'tab `All Books`', 8000);
  assert.equal(await all.getAttribute('aria-haspopup'), null, 'no menu on `All Books`');
  assert.equal(await all.locator('[data-view-chevron]').count(), 0, 'no chevron');
  assert.deepEqual(await panelRowsAre(page, ALL_BOOKS), ALL_BOOKS, 'the R193 table, Modified ↓');
  assert.deepEqual((await panelHeaders(page)).map((h) => h.replace(/\s+/g, ' ')), ['Title', 'Author', 'Rating', 'Status', 'Modified ↓'], 'headers Title, Author, Rating, Status, Modified ↓');
  await all.click({ button: 'right' });
  assert.ok(!(await seen(viewMenu(page), 500)), 'a right-click on All opens no menu');
  await all.focus();
  await page.keyboard.press('Shift+F10');
  assert.ok(!(await seen(viewMenu(page), 500)), '⇧F10 on All opens no menu');
  // Dragging All does nothing; nothing drops before it.
  await drag(page, all, tab(page, Q.vyb));
  await drag(page, tab(page, Q.vyb), allTab(page), { at: 'left' });
  assert.deepEqual(await tabsAre(page, [Q.vyb, Q.roz, Q.p26]), ['', Q.vyb, Q.roz, Q.p26], 'a drop before All lands after it');
  // The header click sorts machine-locally (typeSort) and writes no vault file.
  const before = (await writes(core)).length;
  await click(panelOf(page).getByRole('columnheader', { name: /^Title/ }), 'header Title');
  assert.equal((await writes(core)).length, before, 'the header click writes no vault file');
  assert.ok((await uiState(core))?.typeSort, 'typeSort is machine-local');
  // Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row part one FR-QRY-07 AC-2; D-1892): `All Books` gets the
  // tag filter and multi-level sort (a list of levels on this Mac, AP-1544).
  assert.ok(Array.isArray((await uiState(core))?.typeSort?.book), 'typeSort.book is a list of levels');
  assert.ok(await seen(tagFilterButton(page).or(toolbar(page).getByRole('combobox', { name: rx('Filter by tag') })).first(), 1000), '`Filter by tag` on All Books');
  assert.ok(await seen(sortButton(toolbar(page)), 1000), 'the sort button on All Books');
  assert.ok(await seen(columnsButton(page).or(main(page).getByRole('button', { name: rx('Columns') })).first(), 1000), '`Columns` on All Books');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-3

test('fr_qry_07_ac3_a_view_tab_shows_its_query', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  const runs0 = (await callsOf(core, 'query_run')).length;
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, P26_ROWS), P26_ROWS, 'Přečtené 2026: R193\'s 8 rows');
  assert.equal((await callsOf(core, 'query_run')).length - runs0, 1, 'one query_run for the opened tab');
  for (const [what, loc] of [['Filter Books…', filterField(page)], ['Filter by tag', tagFilterButton(page)], ['Columns', columnsButton(page)], ['View actions', toolbarMenuButton(page)]] as const) {
    assert.ok(await seen(loc, 2000), `toolbar: ${what}`);
  }
  const sb = await must(sortButton(toolbar(page)), 'the sort button');
  assert.equal(flat(await textOf(sb)), 'Finished ↓ +2', 'sort button `Finished ↓` `+2`');
  assert.equal(await panelOf(page).locator('.query-filters, [data-filter-summary]').count(), 0, 'no filter summary');
  // The text filter narrows, writes nothing, and is kept per tab while the page is open.
  await (await must(filterField(page), 'Filter Books…')).fill('mapa');
  assert.deepEqual(await panelRowsAre(page, ['Mapa bez severu', 'Čarovná mapa']), ['Mapa bez severu', 'Čarovná mapa'], '`mapa`: Mapa bez severu, Čarovná mapa (folded)');
  await selectTab(page, Q.roz);
  assert.ok(await seen(board(page, Q.roz), 3000), 'Rozečtené shows its board');
  // Slice Q3 (AC-Test-Change, D-2196; R223): the display switch, then `Group` reading Status; no `Lanes` radiogroup.
  const sw = toolbar(page).locator('div[role="group"][data-display-switch]');
  for (const [what, loc] of [['Filter Books…', filterField(page)], ['Filter by tag', tagFilterButton(page)], ['Display', sw], ['Group', toolbar(page).locator('button[data-command="group.open"]')], ['View actions', toolbarMenuButton(page)]] as const) {
    assert.ok(await seen(loc, 2000), `wall toolbar: ${what}`);
  }
  assert.equal(await sw.locator('button[aria-pressed="true"]').getAttribute('data-display'), 'wall', '`Wall` pressed');
  assert.equal(flat(await textOf(toolbar(page).locator('button[data-command="group.open"]'))), 'Status', '`Group` reads Status');
  assert.equal(await page.getByRole('radiogroup', { name: rx('Lanes') }).count(), 0, 'no `Lanes` radiogroup (D-2173)');
  assert.equal(await columnsButton(page).count(), 0, 'no `Columns` on a board');
  assert.ok(await seen(main(page).getByText('17 Books', { exact: true }), 500), '`17 Books` on every tab (R193, D-1816)');
  assert.equal(await filterField(page).inputValue(), '', 'Rozečtené keeps its own (empty) filter text');
  await selectTab(page, Q.p26);
  assert.equal(await filterField(page).inputValue(), 'mapa', 'back on Přečtené 2026: `mapa` again (D-1796)');
  // Leaving the page clears the filter text.
  await runCommand(page, 'Go to Inbox');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  assert.equal(await filterField(page).inputValue(), '', 'leaving the page clears it');
  // Q2.1 (D-1842, FR-QRY-07 AC-24): the Columns step moves to the query page, where Columns › Genres writes the query
  // file once (only `columns:` and `modified:`), book.yml untouched.
  const book = await fileText(core, BOOK_YML);
  await runCommand(page, 'Go to Queries');
  await click(queriesRow(page, Q.p26).locator('a').first(), 'query/Přečtené 2026');
  await click(main(page).locator('.query-header').getByRole('button', { name: rx('Columns') }), 'Columns');
  const menu = await must(page.getByRole('menu', { name: rx('Columns') }), 'menu Columns');
  await click(menu.getByRole('menuitemcheckbox', { name: rx('Genres') }), 'check Genres');
  const t = await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-columns-genres.yml'));
  assert.equal(t, expectedView('prectene-2026-columns-genres.yml'), 'Přečtené 2026.yml: columns: [author, rating, finished, genres] and modified');
  assert.deepEqual((await writes(core)).filter((p) => p.startsWith('.tegg/')), [qfile(Q.p26)], 'one write');
  assert.equal(await fileText(core, BOOK_YML), book, 'book.yml untouched');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-4

test('fr_qry_07_ac4_new_view_creates_a_query_and_a_tab', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('autor') });
  await click(addView(page), 'Add view');
  const menu = await must(addMenu(page), 'menu `Add view`');
  await click(menuItem(menu, 'Table'), 'Table');
  assert.ok(await seen(tab(page, 'New view'), 2000), 'a draft tab `New view`');
  assert.equal(await tab(page, 'New view').getAttribute('data-view-state'), 'draft', 'the tab is a draft');
  await must(editor(page), 'the editor `Edit query`');
  assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'New view', 'its title `New view` selected');
  assert.deepEqual(await writeCalls(core), [], 'nothing written yet');
  // (a) Esc right away removes the tab, nothing written.
  await page.keyboard.press('Escape');
  assert.ok(await eventually(async () => (await tab(page, 'New view').count()) === 0, (x) => x, 2000), '(a) Esc: the draft tab goes');
  assert.deepEqual(await writeCalls(core), [], '(a) nothing written');
  // (b) Done creates the query file, then writes autor.yml.
  await click(addView(page), 'Add view');
  await click(menuItem(await must(addMenu(page), 'menu'), 'Table'), 'Table');
  await must(editor(page), 'the editor');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const q = await fileWhen(core, qfile('New view'), (x) => x !== undefined);
  assert.equal(q, expectedView('new-view-autor.yml'), '(b) New view.yml as R185 Create');
  assert.equal(await fileWhen(core, AUTOR_YML, (x) => x === expectedView('types/autor-views-new-view.yml')), expectedView('types/autor-views-new-view.yml'), '(b) autor.yml gains `views: [New view]` after line 10');
  assert.deepEqual(await viewsOps(core), [['New view']], 'one views write');
  assert.equal(await selectedTab(page), 'New view', 'the tab stays selected');
  assert.equal((await callsOf(core, 'query_create')).length, 1, 'one query_create (free: true)');
  assert.equal(((await callsOf(core, 'query_create'))[0].args as any)?.free, true, 'exclusive create with a free name');
});

test('fr_qry_07_ac4_new_view_creates_a_query_and_a_tab_board_and_refusal', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await click(addView(page), 'Add view');
  const menu = await must(addMenu(page), 'menu `Add view`');
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-07 AC-32): no `Board` entry; `Wall` writes `view: wall` with no group_by,
  // lanes or columns (board B), and has no `by …` hint.
  assert.equal(await menuItem(menu, 'Board').count(), 0, 'no `Board` entry');
  const wallItem = menuItem(menu, 'Wall');
  assert.equal(await description(wallItem), '', '`Wall` has no hint');
  await click(wallItem, 'Wall');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const wantNew = readFileSync(join(REPO, 'tests/fixtures/queries-files/expected/views-display/queries/new-view-wall-book.yml'), 'utf8');
  assert.equal(await fileWhen(core, qfile('New view'), (x) => x !== undefined), wantNew, '(c) New view.yml: view: wall, no group_by, lanes or columns');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-new-view.yml')), expectedView('types/book-views-new-view.yml'), '(c) views: [… , New view]');
  // A second New view is `New view (2)`; a refused type-file write leaves the query and alerts.
  // The type file changes on disk without `vault:changed`: the views write after the create is refused (Conflict).
  await core.setFile(BOOK_YML, swap(await fileText(core, BOOK_YML), 'description: Knihy, které', 'description: Knížky, které'), { silent: true });
  await click(addView(page), 'Add view');
  await click(menuItem(await must(addMenu(page), 'menu'), 'Table'), 'Table');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  assert.ok(await fileWhen(core, qfile('New view (2)'), (x) => x !== undefined), 'the second is `New view (2)` (D-1477)');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: 'The view was saved as a query but couldn\'t be added to the Books page.' }), 3000), '(d) the refusal alert');
  assert.ok(!(await tabNames(page)).includes('New view (2)'), '(d) the tab isn\'t added');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-5

test('fr_qry_07_ac5_show_a_saved_query', async ({ page }) => {
  const vault = viewsVault((f) => {
    f[qfile('Novější pohled')] = viewQuery({ title: 'Novější pohled', view: 'table' }).replace('version: 1', 'version: 2');
    f[qfile('Nečitelný pohled')] = 'version: 1\ntitle: [nečitelný\n';
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await click(addView(page), 'Add view');
  const menu = await must(addMenu(page), 'menu `Add view`');
  const saved = menu.getByRole('group', { name: rx('Show a saved query') });
  const items = await saved.getByRole('menuitem').evaluateAll((xs) => xs.map((x) => [(x.getAttribute('data-query') ?? '').normalize('NFC'), x.getAttribute('aria-disabled') === 'true', x.getAttribute('aria-description') ?? '']));
  assert.deepEqual(items, [
    ['Novější pohled', false, ''], ['Podle autora', false, ''], ['Podle žánru', false, ''], ['Seskupeno podle data', false, ''],
    ['Autoři', true, 'Shows Autor, not Book'], ['Knihy a autoři', true, 'Shows several types, not only Book'], ['Knihy odkazované odsud', true, 'Needs the note it is used on'],
    ['Nečitelný pohled', true, 'Can\'t be read'],
  ], 'enabled first by title, then greyed by title with their reasons (R193)');
  await saved.locator('[data-query="Autoři"]').click({ force: true }); // D-1826: a plain click (the item is aria-disabled)
  assert.deepEqual(await writeCalls(core), [], 'activating a greyed item writes nothing');
  await click(saved.locator(`[data-query="${Q.zanr}"]`), 'Podle žánru');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-podle-zanru.yml')), expectedView('types/book-views-podle-zanru.yml'), 'views: [… , Podle žánru] (line 13 only)');
  assert.equal(await selectedTab(page), Q.zanr, 'the tab is added and selected');
  assert.ok(await seen(board(page, Q.zanr), 3000), 'and shows its board');
  assert.equal(await fileText(core, qfile(Q.zanr)), original(qfile(Q.zanr)), 'the query file is untouched');
  await click(addView(page), 'Add view');
  assert.equal(await (await must(addMenu(page), 'menu')).locator(`[data-query="${Q.zanr}"]`).count(), 0, 'no longer listed');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to type: Autoři');
  await click(addView(page), 'Add view on Autoři');
  const a = (await must(addMenu(page), 'menu')).getByRole('group', { name: rx('Show a saved query') });
  assert.equal(await a.locator('[data-query="Autoři"]').getAttribute('aria-disabled'), null, 'on Autoři the enabled item is `Autoři`');
  assert.equal(await a.locator(`[data-query="${Q.odsud}"]`).getAttribute('aria-description'), 'Shows Book, not Autor', 'the type reason comes first (AP-1515)');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-6

test('fr_qry_07_ac6_reorder_tabs_writes_views_once', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  // A click, a drop at its own place and Esc write nothing.
  await drag(page, tab(page, Q.p26), { dx: 3, dy: 0 });
  await drag(page, tab(page, Q.p26), tab(page, Q.p26));
  await drag(page, tab(page, Q.vyb), tab(page, Q.roz), { esc: true, at: 'left' });
  assert.deepEqual(await viewsOps(core), [], 'a click, its own place, Esc: no write');
  await drag(page, tab(page, Q.vyb), tab(page, Q.roz), { at: 'left' });
  assert.deepEqual(await tabsAre(page, [Q.vyb, Q.roz, Q.p26]), ['', Q.vyb, Q.roz, Q.p26], 'All Books, Výborné knihy, Rozečtené, Přečtené 2026');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-dragged.yml')), expectedView('types/book-views-dragged.yml'), 'book.yml line 13 only');
  assert.deepEqual(await viewsOps(core), [[Q.vyb, Q.roz, Q.p26]], 'one write');
  // Move view right / left from the palette.
  await core.setFile(BOOK_YML, original(BOOK_YML));
  assert.deepEqual(await tabsAre(page, VIEWS3), ['', ...VIEWS3], 'the fixture order again (external)');
  await selectTab(page, Q.roz);
  await runCommand(page, 'Move view right');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-move-right.yml')), expectedView('types/book-views-move-right.yml'), 'Move view right: views: [Přečtené 2026, Rozečtené, Výborné knihy]');
  await core.setFile(BOOK_YML, original(BOOK_YML));
  await tabsAre(page, VIEWS3);
  await selectTab(page, Q.roz);
  const n = (await viewsOps(core)).length;
  await runCommand(page, 'Move view left');
  await sleep(300);
  assert.equal((await viewsOps(core)).length, n, 'Move view left on the first view tab writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-7

test('fr_qry_07_ac7_the_views_menu', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.p26);
  const want = ['Edit view', 'Rename…', 'Duplicate', 'Open as query', 'Remove from Books page', 'Move to trash'];
  // The selected tab's chevron.
  await click(tab(page, Q.p26).locator('[data-view-chevron]'), 'the chevron');
  let menu = await must(viewMenu(page), 'menu `View actions` (chevron)');
  assert.deepEqual(await menuTexts(menu), want, 'the items');
  assert.equal(await description(menuItem(menu, 'Open as query')), 'Queries ›', 'Open as query: `Queries ›`');
  assert.equal(await description(menuItem(menu, 'Remove from Books page')), 'Keeps the query in Queries', 'Remove: its description');
  assert.equal(await menu.getByRole('separator').count(), 1, 'one separator');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-view-tab')?.normalize('NFC') ?? null), Q.p26, 'Esc returns the focus to the tab');
  // A right-click on another view tab and ⇧F10 on the focused one.
  menu = await tabMenu(page, Q.vyb);
  assert.deepEqual(await menuTexts(menu), want, 'right-click: the same menu');
  await page.keyboard.press('Escape');
  await tab(page, Q.p26).focus();
  await page.keyboard.press('Shift+F10');
  menu = await must(viewMenu(page), 'menu (⇧F10)');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await mustBeOn(page, Q.p26, 'Open as query: query/Přečtené 2026');
  await page.goBack();
  await must(tablist(page), 'back on type/book (one history entry)');
  // Edit view opens the editor; the toolbar's ⋯ has the same items, plus Reset lane order on a board with lane_order.
  await selectTab(page, Q.roz);
  await click(toolbarMenuButton(page), '⋯');
  menu = await must(viewMenu(page), 'menu (toolbar)');
  assert.deepEqual(await menuTexts(menu), [...want, 'Reset lane order'], 'the toolbar menu adds `Reset lane order` on Rozečtené');
  await click(menuItem(menu, 'Edit view'), 'Edit view');
  assert.ok(await seen(editor(page), 2000), 'Edit view opens the editor (R189)');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-8, AC-9

test('fr_qry_07_ac8_rename_patches_views', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), ui: { usageColumnWidths: { [`tab:book/${nfc(Q.p26).toLowerCase()}`]: { title: 200 } }, typeViews: { lastTab: { book: Q.p26 } } } });
  assert.equal(await eventually(() => selectedTab(page), (s) => s === Q.p26, 5000), Q.p26, 'the remembered tab opens');
  const menu = await tabMenu(page, Q.p26);
  await click(menuItem(menu, 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'dialog `Rename query`');
  const field = dlg.getByRole('textbox').first();
  await field.fill(Q.vyb);
  await page.keyboard.press('Enter');
  assert.ok(await seen(dlg.getByText('A query with this name already exists.'), 2000), 'a taken name is refused before the job');
  assert.equal((await core.jobs()).length, 0, 'no job for a taken name');
  await field.fill('Přečtené letos');
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-renamed.yml'), 3000), expectedView('types/book-views-renamed.yml'), 'book.yml line 13 patched');
  assert.equal(await fileText(core, qfile('Přečtené letos')), expectedView('prectene-letos-renamed.yml'), 'the query file renamed, title only');
  assert.equal(await fileText(core, CTENI), expectedView('cteni-2026-renamed.md'), 'Čtení\'s `saved:` line');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === 'Přečtené letos', 1000), 'Přečtené letos', 'the tab reads `Přečtené letos` within 1 s and stays selected');
  // Q2.1 (R198, D-1845): widths are per usage key; the tab's key moves to the new name.
  const ui = await eventually(() => uiState(core), (u) => u?.usageColumnWidths?.['tab:book/přečtené letos']?.title === 200, 2000);
  assert.equal(ui?.usageColumnWidths?.['tab:book/přečtené letos']?.title, 200, 'its widths follow the new name (AP-1513, R198)');
  assert.equal(ui?.typeViews?.lastTab?.book, 'Přečtené letos', 'and the remembered tab');
  const job = (await core.jobs()).at(-1);
  assert.ok(job?.written.includes(BOOK_YML), 'the job reports book.yml as written');
  await click(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first(), 'Undo');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML), 3000), original(BOOK_YML), 'Undo restores book.yml');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), 'and the query file');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'and Čtení');
});

test('fr_qry_07_ac9_duplicate_adds_a_tab_after_the_original', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await click(menuItem(await tabMenu(page, Q.vyb), 'Duplicate'), 'Duplicate');
  assert.ok(await fileWhen(core, qfile('Výborné knihy (2)'), (x) => x !== undefined), '`Výborné knihy (2).yml` created');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-duplicate.yml')), expectedView('types/book-views-duplicate.yml'), 'the copy right after the original');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === 'Výborné knihy (2)'), 'Výborné knihy (2)', 'and selected');
  assert.equal((await callsOf(core, 'query_duplicate')).length, 1, 'one query_duplicate');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-10, AC-11

test('fr_qry_07_ac10_remove_keeps_the_query', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.p26);
  await click(menuItem(await tabMenu(page, Q.p26), 'Remove from Books page'), 'Remove');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-removed.yml')), expectedView('types/book-views-removed.yml'), 'line 13: views: [Rozečtené, Výborné knihy]');
  assert.equal(await selectedTab(page), Q.roz, 'the previous tab is selected');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), 'the query file is untouched');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'Čtení is untouched');
  await click(addView(page), 'Add view');
  assert.ok(await seen((await must(addMenu(page), 'menu')).locator(`[data-query="${Q.p26}"]`), 1000), 'offered again under Show a saved query');
  await page.keyboard.press('Escape');
  for (const n of [Q.roz, Q.vyb]) await click(menuItem(await tabMenu(page, n), 'Remove from Books page'), `Remove ${n}`);
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-empty.yml')), expectedView('types/book-views-empty.yml'), 'views: [] (the key stays)');
  assert.equal(await selectedTab(page), '', 'All Books selected');
});

test('fr_qry_07_ac11_trashed_views_keep_their_tab', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = swap(f[BOOK_YML], 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', 'views: [Rozečtené, Výborné knihy, Odložené]\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await selectTab(page, Q.odlozene);
  assert.equal(await eventually(() => tab(page, Q.odlozene).getAttribute('data-view-state'), (s) => s === 'trashed'), 'trashed', 'Odložené: the trashed state from the start');
  const book = await fileText(core, BOOK_YML);
  await selectTab(page, Q.vyb);
  // Q2.1 (D-1835): `Move to trash` from the view's menu now removes the tab (FR-QRY-07 AC-20); a query trashed
  // elsewhere (here a helper moving its file into .trash/.tegg/queries/, AC-22) keeps its tab in the trashed state.
  await core.setFile(`.trash/${qfile(Q.vyb)}`, original(qfile(Q.vyb)));
  await core.setFile(qfile(Q.vyb), null);
  assert.equal(await fileWhen(core, `.trash/${qfile(Q.vyb)}`, (x) => x !== undefined), original(qfile(Q.vyb)), 'moved to .trash/.tegg/queries/ with the same bytes');
  assert.ok(await seen(panelOf(page).getByText('The query “Výborné knihy” is in the trash.'), 2000), 'the trashed text');
  assert.equal(await fileText(core, BOOK_YML), book, 'book.yml untouched');
  await click(panelOf(page).getByRole('button', { name: rx('Restore') }), 'Restore');
  assert.equal(await fileWhen(core, qfile(Q.vyb), (x) => x !== undefined, 1000), original(qfile(Q.vyb)), 'Restore brings the file back');
  assert.deepEqual(await panelRowsAre(page, ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu'], 1000), ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu'], 'and the results within 1 s');
  await core.setFile(`.trash/${qfile(Q.odlozene)}`, null);
  await selectTab(page, Q.odlozene);
  assert.equal(await eventually(() => tab(page, Q.odlozene).getAttribute('data-view-state'), (s) => s === 'missing'), 'missing', 'deleted for good: the not-found state');
  assert.ok(await seen(panelOf(page).getByRole('button', { name: rx('Remove from Books page') }), 1000), 'with `Remove from Books page`');
  assert.equal(await fileText(core, BOOK_YML), book, 'still no type-file write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-12

test('fr_qry_07_ac12_odd_views_and_broken_views', async ({ page }) => {
  // (a) a name with no query; (b) case and NFD repeats show one tab; Remove writes every copy away.
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews(`views: [Rozečtené, rozečtené, ${NFD('Rozečtené')}, Ztracený pohled, Rozečtené]\n`); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  assert.deepEqual(await tabsAre(page, [Q.roz, 'Ztracený pohled'], 8000), ['', Q.roz, 'Ztracený pohled'], '(a, b) one Rozečtené tab, and Ztracený pohled');
  await selectTab(page, 'Ztracený pohled');
  assert.equal(await eventually(() => tab(page, 'Ztracený pohled').getAttribute('data-view-state'), (s) => s === 'missing'), 'missing', '(a) not-found state');
  assert.ok(await seen(panelOf(page).getByRole('button', { name: rx('Remove from Books page') }), 1000), '(a) with `Remove from Books page`');
  assert.deepEqual(await writeCalls(core), [], 'the odd values are kept until a tab change');
  await click(menuItem(await tabMenu(page, Q.roz), 'Remove from Books page'), 'Remove Rozečtené');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => !!x && !x.normalize('NFC').toLowerCase().includes('rozečtené')), bookWithViews('views: [Ztracený pohled]\n'), '(b) Remove writes every copy away');
});

test('fr_qry_07_ac12_odd_views_and_broken_views_block_list', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views:\n  - Rozečtené\n  - Přečtené 2026\n  - Výborné knihy\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  assert.deepEqual(await tabsAre(page, VIEWS3, 8000), ['', ...VIEWS3], '(c) the block list in order');
  assert.deepEqual(await writeCalls(core), [], '(c) kept until a tab change');
  await click(menuItem(await tabMenu(page, Q.p26), 'Remove from Books page'), 'Remove');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-block-to-flow.yml')), expectedView('types/book-views-block-to-flow.yml'), '(c) one flow line in its place');
});

test('fr_qry_07_ac12_odd_views_and_broken_views_scalar', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: Rozečtené\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const add = await must(addView(page), 'Add view', 8000);
  assert.deepEqual(await tabsAre(page, []), [''], '(d) only All Books');
  assert.equal(await isDisabled(add), true, '(d) Add view aria-disabled');
  assert.equal(await description(add), 'The views setting in .tegg/types/book.yml can\'t be read. Fix it in the file to change views.', '(d) the reason');
  await add.click({ force: true });
  assert.ok(!(await seen(addMenu(page), 500)), '(d) no menu');
  assert.deepEqual(await writeCalls(core), [], '(d) no write');
});

test('fr_qry_07_ac12_odd_views_and_broken_views_newer_type_file', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = swap(f[BOOK_YML], 'version: 1\n', 'version: 2\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  assert.deepEqual(await tabsAre(page, VIEWS3, 8000), ['', ...VIEWS3], '(e) its tabs');
  assert.equal(await isDisabled(addView(page)), true, '(e) Add view aria-disabled');
  assert.ok((await description(addView(page))).length > 0, '(e) with AR-07 AC-3\'s reason');
  await drag(page, tab(page, Q.vyb), tab(page, Q.roz), { at: 'left' });
  const menu = await tabMenu(page, Q.p26);
  assert.equal(await isDisabled(menuItem(menu, 'Remove from Books page')), true, '(e) Remove aria-disabled');
  assert.deepEqual(await viewsOps(core), [], '(e) a drag writes nothing');
});

test('fr_qry_07_ac12_odd_views_and_broken_views_types_and_unreadable', async ({ page }) => {
  const vault = viewsVault((f) => {
    f[qfile(Q.roz)] = swap(f[qfile(Q.roz)], 'types: [book]\n', 'types: [book, autor]\n');
    f[qfile(Q.vyb)] = 'version: 1\ntitle: [nečitelný\n';
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.roz), 'tab Rozečtené', 8000);
  await selectTab(page, Q.roz);
  assert.ok(await seen(panelOf(page).getByText('This view shows Book and Autor, not only Book. Edit view to fix it.'), 3000), '(f) the types notice');
  assert.equal(await tab(page, Q.roz).getAttribute('data-view-state'), 'types', '(f) state `types`, the tab kept');
  await selectTab(page, Q.vyb);
  assert.equal(await eventually(() => tab(page, Q.vyb).getAttribute('data-view-state'), (s) => s === 'unreadable'), 'unreadable', '(g) the unreadable state');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-13, AC-14, AC-15

test('fr_qry_07_ac13_last_tab_per_type_is_machine_local', async ({ page }) => {
  const core = await startViews(page, { route: 'inbox' });
  await runCommand(page, 'Go to type: Books');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === ''), '', 'the first open shows All Books');
  const u0 = await uiWrites(core);
  await selectTab(page, Q.roz);
  const ui = await eventually(() => uiState(core), (u) => u?.typeViews?.lastTab?.book === Q.roz);
  assert.equal(ui?.typeViews?.lastTab?.book, Q.roz, 'typeViews.lastTab.book: "Rozečtené"');
  assert.ok((await uiWrites(core)) - u0 <= 1, 'at most one ui_state_set per switch');
  await runCommand(page, 'Go to type: Autoři');
  await runCommand(page, 'Go to type: Books');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === Q.roz), Q.roz, 'back on Books: Rozečtené');
  await page.goBack();
  await mustBeOn(page, 'Autoři', 'Back from type/book goes to the page before it (no tab history)');
  await page.goBack();
  await page.goBack();
  assert.equal(await mainName(page), 'Inbox', 'tab switches added no history entry');
  assert.deepEqual(await writeCalls(core).then((w) => w.filter((c) => c !== 'ui_state_set')), [], 'no vault write');
});

test('fr_qry_07_ac13_last_tab_per_type_is_machine_local_gone', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: 'Smazaný pohled' } } } });
  await must(tablist(page), 'tablist', 8000);
  assert.equal(await eventually(() => selectedTab(page), (s) => s === ''), '', 'a remembered name no longer in views: opens All Books');
});

test('fr_qry_07_ac14_which_type_pages_have_views', async ({ page }) => {
  const vault = viewsVault((f) => {
    delete f['.tegg/types/page.yml'];
    f['.tegg/types/task.yml'] = (f['.tegg/types/task.yml'] ?? '') + 'views: [Rozečtené]\n';
  });
  const core = await startViews(page, { route: typeRoute('page'), vault });
  assert.ok(await seen(addView(page), 8000), 'type/page: Add view');
  for (const plural of ['Quick Notes', 'Daily Notes', 'Images', 'PDFs', 'Books', 'Autoři']) {
    await runCommand(page, `Go to type: ${plural}`);
    await mustBeOn(page, plural, `type page ${plural}`);
    assert.ok(await seen(addView(page), 3000), `${plural}: Add view`);
  }
  // Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row part one FR-QRY-07 AC-14): Task has views (D-1787's
  // exception ends): the Tasks page has `Add view`.
  await runCommand(page, 'Go to Tasks');
  assert.ok(await seen(addView(page), 3000), 'the Tasks page has Add view');
  assert.ok((await fileText(core, '.tegg/types/task.yml'))?.endsWith('views: [Rozečtené]\n'), 'its hand-written views: is kept');
  await runCommand(page, 'Go to type: Pages');
  await click(addView(page), 'Add view on Pages');
  await click(menuItem(await must(addMenu(page), 'menu'), 'Table'), 'Table');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const pageYml = await eventually(() => fileText(core, '.tegg/types/page.yml'), (x) => x !== undefined, 3000);
  const newEmpty = viewsVault().files['.tegg/types/page.yml'];
  assert.ok(newEmpty, 'setup: new-empty has page.yml');
  const lines = (pageYml ?? '').split('\n');
  const at = lines.findIndex((l) => l.startsWith('views: '));
  assert.equal(lines[at], 'views: [New view]', 'the first view on type/page creates page.yml with one views: line (D-90)');
  assert.equal([...lines.slice(0, at), ...lines.slice(at + 1)].join('\n'), newEmpty, 'equal to new-empty\'s page.yml plus that line');
  // An undefined type (type/recept) has no tabs and no Add view.
  await core.setFile('Recepty/Bramboračka.md', '---\ntype: recept\ntitle: Bramboračka\n---\nPolévka.\n');
  await runCommand(page, 'Go to type: recept');
  await sleep(500);
  assert.equal(await tablist(page).count(), 0, 'type/recept: no tabs');
  assert.equal(await addView(page).count(), 0, 'type/recept: no Add view');
});

test('fr_qry_07_ac15_views_follow_external_changes', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.roz);
  const w0 = await writeCalls(core);
  await core.setFile(BOOK_YML, bookWithViews('views: [Výborné knihy, Rozečtené]\n'));
  assert.deepEqual(await tabsAre(page, [Q.vyb, Q.roz], 2000), ['', Q.vyb, Q.roz], 'the tabs follow within 2 s');
  assert.equal(await selectedTab(page), Q.roz, 'the selected tab is kept');
  await core.setFile(qfile(Q.roz), swap(original(qfile(Q.roz)), 'lanes: vertical\n', 'lanes: horizontal\n'));
  assert.equal(await eventually(() => board(page, Q.roz).getAttribute('data-lanes'), (v) => v === 'horizontal', 2000), 'horizontal', 'lanes: horizontal shows within 2 s');
  await core.setFile(qfile('Nové'), viewQuery({ title: 'Nové', view: 'table' }));
  await core.setFile(BOOK_YML, bookWithViews('views: [Výborné knihy, Nové]\n'));
  assert.deepEqual(await tabsAre(page, [Q.vyb, 'Nové'], 2000), ['', Q.vyb, 'Nové'], 'a new query added to views: shows within 2 s');
  assert.equal(await selectedTab(page), '', 'Rozečtené no longer listed: All Books');
  assert.deepEqual(await writeCalls(core), w0, 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-17, AC-18

test('fr_qry_07_ac17_view_placeholders_removed', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  await must(tablist(page), 'tablist', 8000);
  // D-2214: slice Q3 builds `Group` (R223); only `Filter` stays absent.
  for (const n of ['Filter']) assert.equal(await main(page).getByRole('button', { name: n, exact: true }).count(), 0, `no \`${n}\` control on the type page`);
  assert.equal(await isDisabled(addView(page)), false, 'Add view is built (not aria-disabled)');
  assert.equal(await main(page).getByText('Coming in v1.0').count(), 0, 'no `Coming in v1.0`');
  await click(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  await must(page.getByRole('heading', { level: 1, name: 'Book type settings', exact: true }), 'Book type settings', 5000);
  // Slice OC (D-2071, types.md FR-TYP-01 AC-25): the Views section lists the real views, nothing says `Coming in`.
  const views = main(page).getByRole('region', { name: 'Views', exact: true });
  assert.equal(await views.count(), 1, 'Type settings has the Views section');
  assert.equal(await views.getByText(/Coming in/).count(), 0, 'no `Coming in` control in it');
});

test('fr_qry_07_ac18_columns_reorder_by_header_drag', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.p26);
  const h = (n: string) => panelOf(page).getByRole('columnheader', { name: new RegExp(`^${n}`) });
  await must(h('Finished'), 'header Finished', 5000);
  await drag(page, h('Finished'), h('Finished'));
  await drag(page, h('Title'), h('Rating'));
  assert.deepEqual(await writes(core), [], 'a drop in the same place and a Title drag write nothing');
  const n = (await writes(core)).length;
  await h('Author').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await writes(core)).length, n, '⌥←/⌥→ on a view\'s header do nothing');
  // `All Books` keeps its own drag (D-1244): ⌥→ on its focused Author header writes book.yml's columns.
  await click(allTab(page), 'All Books');
  await panelOf(page).getByRole('columnheader', { name: /^Author/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  assert.ok(await fileWhen(core, BOOK_YML, (x) => !!x && x.includes('columns: [rating, author, status, modified]\n')), 'All Books: ⌥→ moves Author (book.yml columns)');
  // Q2.1 (D-1842; FR-QRY-07 AC-24, FR-QRY-05 AC-24): a drag on a tab writes its item, in a block its fence; the
  // reorder with its expected bytes moves to the query page, which writes the query file.
  const book = await fileText(core, BOOK_YML);
  await runCommand(page, 'Go to Queries');
  await click(queriesRow(page, Q.p26).locator('a').first(), 'query/Přečtené 2026');
  const ph = (n: string) => main(page).getByRole('columnheader', { name: new RegExp(`^${n}`) });
  await must(ph('Finished'), 'the query page: header Finished', 5000);
  const w0 = (await writes(core)).length;
  await dragTo(page, ph('Finished'), ph('Author'), { at: 'left' });
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-columns-reordered.yml')), expectedView('prectene-2026-columns-reordered.yml'), 'only columns: and modified:');
  assert.deepEqual((await writes(core)).slice(w0), [qfile(Q.p26)], 'one write');
  assert.equal(await fileText(core, BOOK_YML), book, 'book.yml untouched');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'Čtení untouched');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-23…AC-25, FR-TYP-09 AC-35

test('fr_qry_06_ac23_views_are_marked_on_the_queries_page', async ({ page }) => {
  const core = await startViews(page, { route: 'queries' });
  await must(queriesRow(page, Q.roz), 'row Rozečtené', 8000);
  for (const n of VIEWS3) assert.equal(flat(await textOf(queriesRow(page, n).locator('span.page-mark'))), 'Books page', `${n}: the mark \`Books page\``);
  for (const n of [Q.zanr, Q.autor, Q.datum, Q.autori, Q.obe, Q.odsud]) assert.equal(await queriesRow(page, n).locator('span.page-mark').count(), 0, `${n}: no mark`);
  assert.ok((await textOf(main(page))).includes('9 queries'), '`9 queries`');
  await core.setFile(BOOK_YML, bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]\n'));
  assert.ok(await seen(queriesRow(page, Q.zanr).locator('span.page-mark'), 1000), 'adding Podle žánru as a tab adds its mark within 1 s');
  await core.setFile(AUTOR_YML, swap(original(AUTOR_YML), 'preview: [poznámka]\n', 'preview: [poznámka]\nviews: [Rozečtené]\n'));
  assert.equal(await eventually(() => queriesRow(page, Q.roz).locator('span.page-mark').count(), (c) => c === 2), 2, 'a tab on two type files: both marks');
  await page.getByRole('searchbox', { name: rx('Find a query…') }).fill('page');
  await sleep(300);
  assert.equal(await main(page).locator('tr[data-query-row]').count(), 0, '`Find a query…` matches titles only, not the mark');
});

test('fr_qry_06_ac24_used_on_names_the_type_page', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(Q.p26) });
  const chips = main(page).getByRole('list', { name: rx('Used on') });
  await must(chips, '`Used on`', 8000);
  const first = chips.locator('a').first();
  assert.equal(await first.getAttribute('data-usage-type'), 'book', 'the type page chip first');
  assert.equal(flat(await textOf(first)), 'Books page', 'reads `Books page`');
  assert.ok(await seen(chips.locator(`a[data-usage="${CTENI}"]`), 1000), 'then Čtení');
  assert.ok((await callsOf(core, 'query_view_usages')).length >= 1, 'query_view_usages is asked (D-1804)');
  await click(first, 'the Books page chip');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === Q.p26), Q.p26, 'opens type/book on that tab');
});

async function contentBox(page: Page) {
  return main(page).evaluate((m) => {
    const c = (m.querySelector('[data-views-tablist]')?.closest('.page-column, .page-wide, [data-page]') ?? m.firstElementChild) as HTMLElement | null;
    const r = c?.getBoundingClientRect();
    return { width: r?.width ?? 0, maxWidth: c ? getComputedStyle(c).maxWidth : '', pane: m.getBoundingClientRect().width };
  });
}

/** The page container (the first element with 40 px side padding) against the centre pane. */
async function wide(page: Page) {
  return main(page).evaluate((el) => {
    const c = ([...el.querySelectorAll('*')] as HTMLElement[]).find((x) => getComputedStyle(x).paddingLeft === '40px' && getComputedStyle(x).paddingRight === '40px') ?? null;
    const r = c?.getBoundingClientRect();
    return { pane: el.getBoundingClientRect().width, content: r ? r.width - 80 : 0, maxWidth: c ? getComputedStyle(c).maxWidth : 'no 40 px container' };
  });
}
for (const [suffix, route] of [['', 'queries'], ['_query_page', queryRoute(Q.p26)]] as const) {
  test(`fr_qry_06_ac25_queries_pages_are_wide${suffix}`, async ({ page }) => {
    await startViews(page, { route });
    await mustBeOn(page, route === 'queries' ? 'Queries' : Q.p26, route);
    for (const [w, h] of [[1440, 900], [2560, 1440]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(300);
      const m = await wide(page);
      // Slice Q2-T (AC-Test-Change, D-1912; D-1890, FR-TYP-09 AC-36): at most 1,600 px of content, centred; the 1,440 ×
      // 900 numbers stand.
      const want = Math.min(m.pane - 80, 1600);
      assert.ok(near(m.content, want), `${route} at ${w}: content ${want} px (${JSON.stringify(m)})`);
      assert.equal(m.maxWidth, '1680px', `${route} at ${w}: max-width 1680px (border-box, 40 px padding, v1-views §29.8)`);
    }
  });
}

test('fr_typ_09_ac35_type_page_is_wide', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  await must(tablist(page), 'tablist', 8000);
  const measure = () => main(page).evaluate((el) => {
    const t = el.querySelector('[data-views-tablist]') as HTMLElement | null;
    let c: HTMLElement | null = t;
    while (c && c !== el && getComputedStyle(c).paddingLeft !== '40px') c = c.parentElement;
    const r = c?.getBoundingClientRect();
    return { pane: el.getBoundingClientRect().width, content: r ? r.width - 80 : 0, maxWidth: c ? getComputedStyle(c).maxWidth : '' };
  });
  for (const name of ['', ...VIEWS3]) {
    if (name) await selectTab(page, name);
    const m = await measure();
    assert.ok(near(m.pane, 1208), `the centre pane is 1,208 px (${m.pane})`);
    assert.ok(near(m.content, 1128), `${name || 'All Books'}: content 1,128 ± 1 px (${m.content})`);
    assert.equal(m.maxWidth, '1680px', 'computed max-width 1680px (slice Q2-T, D-1890, v1-views §29.8)');
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await sleep(300);
  assert.ok(near((await measure()).content, 1600), 'at 2,560 × 1,440: 1,600 ± 1 px, centred (slice Q2-T AC-Test-Change, D-1912; D-1890)');
  await page.setViewportSize({ width: 1440, height: 900 });
  // D-1827: type pages have no right panel.
  await openNote(page, 'Čtení 2026');
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Čtení\'s body');
  const bb = await body.boundingBox();
  const pane = await main(page).boundingBox();
  assert.ok(bb && pane && bb.width <= 761 && near(bb.x - pane.x, pane.x + pane.width - (bb.x + bb.width), 2), `Čtení keeps its centred column, max 760 px (${JSON.stringify(bb)})`);
  const blk = await block(page, Q.p26).boundingBox();
  assert.ok(blk && blk.x >= bb!.x - 1 && blk.x + blk.width <= bb!.x + bb!.width + 1, 'its blocks stay inside it');
});

const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
void [B, ROZ_LANES, lanesOf, mustLanes, panelRows, nfc, noteRoute];
