// Slice Q2.1, L5 (WebKit + fake core): per-usage sort, columns, widths and folds, and the trash of a view from its menu.
// docs/acceptance/views.md part two: FR-QRY-07 AC-20…AC-26, FR-QRY-01 AC-14…AC-16, FR-QRY-05 AC-24…AC-27, FR-QRY-09 AC-8,
// FR-FMT-12 AC-13, FR-SYN-03 AC-31, FR-SYN-06 AC-49 (the fake core counts), FR-STO-07 AC-11, FR-TPL-04 AC-3, FR-LNK-03
// AC-25 (the UI part), FR-UX-03 AC-52, NFR-OTH-02 AC-22. Interface docs/contracts/v1-views.md §12…§21 (DOM §19.1, strings
// §19.2, UI state §19.3, commands §19.4, hooks §21.1). Expected bytes tests/fixtures/queries-files/expected/views-usage/
// (README there). Fixture: the base tests/fixtures/vaults/views/ or, where a test says overlay, views-usage/ over it.
// Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  A, B, BOOK_YML, CESTY, CESTY_ID, CTENI, CTENI_ID, P26_ROWS, Q, addMenu, addView, allTab, block, blockKey, board, bookWithViews, callsOf, click, columnsScope, description,
  drag, editor, eventually, main, expectedUsage, expectedView, fileText, fileWhen, isDisabled, lane, menuItem, must, near, noteRoute, openNote, original, overlayFile,
  overlayVault, pageKey, panelHeaders, panelOf, panelRowsAre, pseudoLocale, qfile, queryRoute, rx, runCommand, seen, selectTab, selectedTab, sleep, sortButton,
  sortDialog, sortLevels, sortScope, startViews, swap, tab, tabKey, tabMenu, tabsAre, textOf, toolbar, toolbarMenuButton, typeRoute, uiState, uiWrites, usageNotice,
  usageRoot, usages, viewMenu, viewQuery, viewsVault, writes, type FakeCoreHandle,
} from './views-usage-helpers';
import { attributeBox, done, editorButton, filterRows, operatorBox, pickOption, valueControl } from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const hdr = (scope: Locator, name: string) => scope.getByRole('columnheader', { name: new RegExp(`^⟦?${name}`) });
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
const VIEWS_OUT = '"Books" changed outside Tegg. The views weren\'t changed.';
const NOT_EDITABLE = 'Open the note to change how this block shows.';
const BROKEN_SORT = 'The setting sort can\'t be read, so its default is used.';
const OVERLAY_BOOK = overlayFile('.tegg/types/book.yml');
const OVERLAY_CESTY = overlayFile(CESTY);
const columnsMenu = (page: Page) => page.getByRole('menu', { name: rx('Columns') });
const tabColumns = (page: Page) => toolbar(page).locator('button[data-command="view.columns"]');
const blockColumns = (b: Locator) => b.locator('.query-header').getByRole('button', { name: rx('Columns') });
const blockEdit = (b: Locator) => b.locator('.query-header').getByRole('button', { name: rx('Edit query') });
const check = (page: Page, name: string) => columnsMenu(page).getByRole('menuitemcheckbox', { name: rx(name) });
const button = (scope: Locator, name: string) => scope.getByRole('button', { name: rx(name) });
/** A block's row titles, in order (`data-query-result`). */
async function blockRows(b: Locator): Promise<string[]> {
  return b.evaluate((el) => ([...el.querySelectorAll('[data-query-result]')] as HTMLElement[]).map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC').split('/').pop()!.replace(/\.md$/, ''))).catch(() => []);
}
const rowsAre = (b: Locator, want: string[], ms = 3000) => eventually(() => blockRows(b), (r) => JSON.stringify(r) === JSON.stringify(want), ms);
const headersOf = (b: Locator) => b.locator('table thead th').evaluateAll((hs) => hs.map((h) => ((h as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'))).catch(() => [] as string[]);
/** Changes a file on disk without `vault:changed`. */
async function silently(core: FakeCoreHandle, rel: string, text?: string) {
  await core.setFile(rel, text ?? `${await fileText(core, rel)}# změněno jinde\n`, { silent: true });
  return fileText(core, rel);
}
const TITLE_ASC = ['Cizí přístavy', 'Čarovná mapa', 'Kniha o čaji', 'Mapa bez severu', 'Sto zimních dní', 'Šest cest k moři', 'Tiché město', 'Zahrada v dešti'];
const TAB_P26 = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu', 'Sto zimních dní', 'Šest cest k moři', 'Tiché město', 'Kniha o čaji', 'Zahrada v dešti'];
const VYB_ROWS = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu'];
const minusModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, '');
/** Counts every `role="alert"` element the page adds from now on (one alert node at a time is shown; a new alert is a
 *  new node), so a check can ask for a new alert per action. */
async function countAlerts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __alertsShown?: string[] };
    w.__alertsShown = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const nd of m.addedNodes) {
        if (!(nd instanceof HTMLElement)) continue;
        for (const el of [nd, ...nd.querySelectorAll('[role="alert"]')]) if (el.getAttribute('role') === 'alert') w.__alertsShown!.push(el.textContent ?? '');
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
}
const alertsShown = (page: Page, text: string) => page.evaluate((x) => ((window as unknown as { __alertsShown?: string[] }).__alertsShown ?? []).filter((a) => a.includes(x)).length, text);
/** `Add filter` in the open editor, then attribute / condition / value by the pointer. */
async function addFilter(page: Page, attr: string, op: string, value: string) {
  const n = await filterRows(page).count();
  await click(editorButton(page, 'Add filter'), 'Add filter');
  const row = filterRows(page).nth(n);
  await click(attributeBox(row), 'Attribute');
  await pickOption(page, attr);
  await click(operatorBox(row), 'Condition');
  await pickOption(page, op);
  await click(valueControl(row).first(), 'Value');
  await pickOption(page, value);
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-20

test('fr_qry_07_ac20_trash_from_the_view_menu_removes_the_tab', async ({ page }) => {
  const vault = viewsVault((f) => { f['Pages/Výběr.md'] = '---\ntype: page\ntitle: Výběr\n---\n```query\nsaved: Výborné knihy\n```\n'; });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  await selectTab(page, Q.vyb);
  await click(menuItem(await tabMenu(page, Q.vyb), 'Move to trash'), 'Move to trash');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-trash-vyborne.yml')), expectedUsage('types/book-trash-vyborne.yml'), '(1) book.yml line 13 only');
  assert.equal(await fileWhen(core, `.trash/${qfile(Q.vyb)}`, (x) => x !== undefined), original(qfile(Q.vyb)), '(2) moved with the same bytes');
  const order = (await core.calls()).map((c) => c.cmd).filter((c) => c === 'type_patch' || c === 'query_trash');
  assert.deepEqual(order, ['type_patch', 'query_trash'], 'views: first, then the move');
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26]), ['', Q.roz, Q.p26], 'the tab is gone');
  assert.equal(await selectedTab(page), Q.p26, 'the previous tab is selected');
  assert.ok(await seen(page.getByText('Moved “Výborné knihy” to the trash'), 2000), 'the toast');
  assert.ok(await seen(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }), 500), 'with Undo');
  await click(addView(page), 'Add view');
  assert.equal(await (await must(addMenu(page), 'Add view menu')).locator(`[data-query="${Q.vyb}"]`).count(), 0, 'Add view doesn\'t offer it');
  await page.keyboard.press('Escape');
  await openNote(page, 'Výběr');
  assert.ok(await seen(main(page).getByText('The query “Výborné knihy” is in the trash.'), 3000), 'a note\'s block shows the trashed state');
  assert.deepEqual((await writes(core)).filter((p) => p.startsWith('Pages/')), [], 'no note is written');
});

test('fr_qry_07_ac20_trash_from_the_view_menu_removes_the_tab_overlay', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  await click(toolbarMenuButton(page), 'the toolbar ⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Move to trash'), 'Move to trash');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-without-prectene.yml')), expectedUsage('types/book-overlay-without-prectene.yml'), 'lines 13…20 → one flow line');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'Čtení not written');
  assert.equal(await fileText(core, CESTY), OVERLAY_CESTY, 'Cesty not written');
});

test('fr_qry_07_ac20_trash_from_the_view_menu_removes_the_tab_newer_type_file', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = swap(f[BOOK_YML], 'version: 1\n', 'version: 2\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.vyb), 'tab', 8000);
  const menu = await tabMenu(page, Q.vyb);
  const item = menuItem(menu, 'Move to trash');
  assert.equal(await isDisabled(item), true, 'Move to trash aria-disabled');
  assert.equal(await description(item), await description(menuItem(menu, 'Remove from Books page')), 'with the reason `Remove` has');
  await item.click({ force: true }).catch(() => undefined);
  await sleep(300);
  assert.deepEqual(await writes(core), [], 'nothing written');
  assert.deepEqual((await core.queryCalls()).map((c) => c.cmd), [], 'no query_trash');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-21

async function trashVyb(page: Page) {
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  await selectTab(page, Q.vyb);
  await click(menuItem(await tabMenu(page, Q.vyb), 'Move to trash'), 'Move to trash');
}

test('fr_qry_07_ac21_trash_undo_and_failures', async ({ page }) => {
  // (a) Undo in the toast: the file back, book.yml back to its exact bytes, the tab back and selected.
  const core = await startViews(page, { route: typeRoute('book') });
  await trashVyb(page);
  await fileWhen(core, `.trash/${qfile(Q.vyb)}`, (x) => x !== undefined);
  const before = (await core.typeCalls()).length;
  await click(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first(), 'Undo');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML)), original(BOOK_YML), '(a) book.yml byte-identical to the fixture');
  assert.equal(await fileText(core, qfile(Q.vyb)), original(qfile(Q.vyb)), '(a) the query file back');
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26, Q.vyb]), ['', Q.roz, Q.p26, Q.vyb], '(a) the tab back at its place');
  assert.equal(await selectedTab(page), Q.vyb, '(a) and selected');
  const undo = (await core.typeCalls()).slice(before);
  assert.deepEqual(undo.map((c) => c.ops.map((o: any) => o.op)), [['viewsSource']], '(a) one type_patch with viewsSource');
  assert.equal(undo[0]?.ops[0]?.source, 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', '(a) the views lines as they were');
});

test('fr_qry_07_ac21_trash_undo_and_failures_overlay_cmd_z', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await click(menuItem(await tabMenu(page, Q.p26), 'Move to trash'), 'Move to trash');
  await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-without-prectene.yml'));
  await panelOf(page).click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('Meta+z');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === OVERLAY_BOOK), OVERLAY_BOOK, '⌘Z on the page: the overlay\'s bytes, lines 15…19 included');
});

test('fr_qry_07_ac21_trash_undo_and_failures_refusals', async ({ page }) => {
  // (c) book.yml changed on disk without vault:changed: refused before anything moves.
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab', 8000);
  const disk = await silently(core, BOOK_YML);
  await click(menuItem(await tabMenu(page, Q.vyb), 'Move to trash'), 'Move to trash');
  assert.ok(await seen(alertWith(page, VIEWS_OUT), 3000), '(c) the alert');
  assert.equal(await fileText(core, BOOK_YML), disk, '(c) no write');
  assert.equal(await fileText(core, qfile(Q.vyb)), original(qfile(Q.vyb)), '(c) no move');
  // (d) The move fails: the views: write is reverted with its returned version; the tab is back.
  await core.setFile(BOOK_YML, original(BOOK_YML));
  await sleep(300);
  await core.queriesFail('query_trash', 'Io');
  await click(menuItem(await tabMenu(page, Q.vyb), 'Move to trash'), 'Move to trash');
  assert.ok(await seen(alertWith(page, '“Výborné knihy” couldn\'t be moved to the trash. The view is back on the page.'), 3000), '(d) views.trashFailed');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML)), original(BOOK_YML), '(d) book.yml equals its bytes before');
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26, Q.vyb]), ['', Q.roz, Q.p26, Q.vyb], '(d) the tab is back');
  const tc = await core.typeCalls();
  assert.equal(tc.at(-1)?.ops[0]?.op, 'viewsSource', '(d) the revert is a viewsSource op');
  // (e) Undo when book.yml changed since the trash: the query is restored, the tab isn't.
  await trashVyb(page);
  await fileWhen(core, `.trash/${qfile(Q.vyb)}`, (x) => x !== undefined);
  await silently(core, BOOK_YML);
  await click(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first(), 'Undo');
  assert.equal(await fileWhen(core, qfile(Q.vyb), (x) => x !== undefined), original(qfile(Q.vyb)), '(e) the query restored');
  assert.ok(await seen(alertWith(page, VIEWS_OUT), 3000), '(e) views.changedOutside');
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26]), ['', Q.roz, Q.p26], '(e) the tab stays gone');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-22

test('fr_qry_07_ac22_trashed_elsewhere_keeps_the_tab', async ({ page }) => {
  const vault = viewsVault((f) => { f['.tegg/types/autor.yml'] = swap(f['.tegg/types/autor.yml'], 'preview: [poznámka]\n', 'preview: [poznámka]\nviews: [Výborné knihy]\n'); });
  const core = await startViews(page, { route: queryRoute(Q.vyb), vault });
  await click(main(page).getByRole('button', { name: rx('Query actions') }).first(), 'the query page\'s ⋯');
  await click(page.getByRole('menuitem', { name: rx('Move to trash') }), 'Move to trash');
  await fileWhen(core, `.trash/${qfile(Q.vyb)}`, (x) => x !== undefined);
  assert.equal(await fileText(core, BOOK_YML), original(BOOK_YML), 'book.yml untouched');
  assert.equal((await core.typeCalls()).length, 0, 'no type_patch');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.vyb);
  assert.equal(await eventually(() => tab(page, Q.vyb).getAttribute('data-view-state'), (s) => s === 'trashed'), 'trashed', 'the tab stays, trashed (once run, §4.3)');
  await click(panelOf(page).getByRole('button', { name: rx('Restore') }), 'Restore');
  await fileWhen(core, qfile(Q.vyb), (x) => x !== undefined);
  // From the Books tab: only book.yml; the Autoři page keeps a trashed tab.
  await click(menuItem(await tabMenu(page, Q.vyb), 'Move to trash'), 'Move to trash');
  await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-trash-vyborne.yml'));
  assert.deepEqual((await core.typeCalls()).map((c) => c.key), ['book'], 'only book.yml is written');
  await runCommand(page, 'Go to type: Autoři');
  await selectTab(page, Q.vyb);
  assert.equal(await eventually(() => tab(page, Q.vyb).getAttribute('data-view-state'), (s) => s === 'trashed'), 'trashed', 'the other type page keeps a trashed tab');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-23

test('fr_qry_07_ac23_tab_sort_is_its_own', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await selectTab(page, Q.vyb);
  assert.deepEqual(await panelRowsAre(page, VYB_ROWS, 5000), VYB_ROWS, 'precondition');
  // (a) ⇧-click on Finished.
  await (await must(hdr(panelOf(page), 'Finished'), 'header Finished')).click({ modifiers: ['Shift'] });
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-vyborne-shift-finished.yml')), expectedUsage('types/book-vyborne-shift-finished.yml'), '(a) book.yml: seven lines');
  assert.deepEqual((await writes(core)).filter((p) => !p.startsWith('.tegg/types/')), [], '(a) no note written');
  assert.deepEqual((await core.typeCalls()).map((c) => c.ops), [[{ op: 'viewSort', name: Q.vyb, sort: [{ by: 'title', order: 'asc' }, { by: 'finished', order: 'asc' }] }]], '(a) one type_patch viewSort');
  assert.deepEqual((await core.queryCalls()).map((c) => c.cmd), [], '(a) the query file untouched');
  // (b) The popover (scope `This tab's sort`): Remove Finished.
  await click(sortButton(toolbar(page)), 'sort');
  await must(sortDialog(page), 'Sort');
  assert.equal(flat(await textOf(sortScope(page))), 'This tab\'s sort', '(b) the scope line');
  await click(sortLevels(page).nth(1).getByRole('button', { name: rx('Remove') }), 'Remove Finished');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-vyborne-sort-title-only.yml')), expectedUsage('types/book-vyborne-sort-title-only.yml'), '(b) one own level stays');
  // (c) Use the query's sort.
  await click(sortDialog(page).getByRole('button', { name: rx('Use the query\'s sort') }), 'Use the query\'s sort');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML)), original(BOOK_YML), '(c) book.yml equals the fixture');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.vyb}"] a`).first(), 'query/Výborné knihy');
  assert.equal(await fileText(core, qfile(Q.vyb)), original(qfile(Q.vyb)), 'the query file unchanged');
  // + Add sort on the Rozečtené board tab.
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.roz);
  await click(sortButton(toolbar(page)), 'sort');
  await click(sortDialog(page).getByRole('button', { name: rx('+ Add sort') }), '+ Add sort');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-rozectene-sort-add.yml')), expectedUsage('types/book-rozectene-sort-add.yml'), 'Rozečtené\'s own three levels');
});

test('fr_qry_07_ac23_tab_sort_is_its_own_overlay', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, TAB_P26, 5000), TAB_P26, 'R200: the tab\'s own order');
  await click(hdr(panelOf(page), 'Finished'), 'header Finished');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-prectene-click-finished.yml')), expectedUsage('types/book-overlay-prectene-click-finished.yml'), 'lines 16…18 only');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), 'the query file untouched');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-24

test('fr_qry_07_ac24_tab_columns_are_its_own', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await click(tabColumns(page), 'Columns');
  await must(columnsMenu(page), 'menu Columns');
  assert.equal(flat(await textOf(columnsScope(page))), 'Columns of this tab', 'the scope line');
  await click(check(page, 'Genres'), 'Genres');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-prectene-columns-genres.yml')), expectedUsage('types/book-prectene-columns-genres.yml'), 'line 13 → five lines');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), 'the query file untouched');
  await page.keyboard.press('Escape');
  await drag(page, hdr(panelOf(page), 'Finished'), hdr(panelOf(page), 'Author'), { at: 'left' });
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-prectene-columns-reordered.yml')), expectedUsage('types/book-prectene-columns-reordered.yml'), 'the header drag');
  await click(tabColumns(page), 'Columns');
  await click(columnsMenu(page).getByRole('menuitem', { name: rx('Use the query\'s columns') }), 'Use the query\'s columns');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML)), original(BOOK_YML), 'back to the fixture');
  // New property… Stran (Number): the attribute, then the item's columns.
  await click(tabColumns(page), 'Columns');
  await click(columnsMenu(page).getByRole('menuitem', { name: rx('New property…') }), 'New property…');
  await page.keyboard.type('Stran');
  await click(page.getByRole('combobox', { name: rx('Type') }), 'the type');
  await click(page.getByRole('option', { name: rx('Number') }), 'Number');
  await click(page.getByRole('button', { name: rx('Add') }), 'Add');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-new-property-stran-2.yml')), expectedUsage('types/book-new-property-stran-2.yml'), 'the attribute, then `stran` in the item');
  const tc = (await core.typeCalls()).slice(-2);
  assert.deepEqual(tc.map((c) => c.ops.map((o: any) => o.op)), [['addAttribute'], ['viewColumns']], 'two type_patch calls');
  await openNote(page, 'Čtení 2026');
  assert.deepEqual((await headersOf(block(page, Q.p26))).length, 4, 'Čtení\'s block keeps the query\'s columns (Title + three)');
});

test('fr_qry_07_ac24_tab_columns_are_its_own_overlay', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await click(tabColumns(page), 'Columns');
  assert.equal(await check(page, 'Genres').getAttribute('aria-checked'), 'true', 'Genres checked (own columns)');
  await click(check(page, 'Genres'), 'uncheck Genres');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-prectene-no-genres.yml')), expectedUsage('types/book-overlay-prectene-no-genres.yml'), 'line 19 only');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-25

test('fr_qry_07_ac25_views_items_read_and_kept', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, TAB_P26, 5000), TAB_P26, 'R200 rows');
  assert.deepEqual((await panelHeaders(page)).map(flat), ['Title ↑²', 'Author', 'Rating ↑¹', 'Finished', 'Genres'], 'R200 headers');
  assert.equal(flat(await textOf(sortButton(toolbar(page)))), 'Rating ↑ +1', 'the sort button');
  for (const n of [Q.roz, Q.vyb]) { await selectTab(page, n); }
  assert.deepEqual(await panelRowsAre(page, VYB_ROWS, 3000), VYB_ROWS, 'Výborné knihy as R193');
  assert.deepEqual(await writes(core), [], 'reading writes nothing');
  assert.equal((await core.typeCalls()).length, 0, 'no type_patch');
});

test('fr_qry_07_ac25_views_items_read_and_kept_variants', async ({ page }) => {
  // (a) A mapping item without `name`: views unreadable.
  const a = overlayVault((f) => { f[BOOK_YML] = swap(f[BOOK_YML], '  - name: Přečtené 2026\n    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n    columns: [author, rating, finished, genres]\n', '  - sort: { by: title }\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault: a });
  await must(allTab(page), 'All Books', 8000);
  assert.deepEqual(await tabsAre(page, []), [''], '(a) only All Books');
  assert.equal(await isDisabled(addView(page)), true, '(a) Add view aria-disabled');
  assert.equal(await description(addView(page)), 'The views setting in .tegg/types/book.yml can\'t be read. Fix it in the file to change views.', '(a) the reason');
  // (b) sort: sideways: the query's sort and the notice.
  await core.setFile(BOOK_YML, swap(OVERLAY_BOOK, '    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n', '    sort: sideways\n'));
  await must(tab(page, Q.p26), 'the tabs', 3000);
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, P26_ROWS, 3000), P26_ROWS, '(b) the query\'s order');
  assert.ok(await seen(usageNotice(panelOf(page), 'sort').filter({ hasText: BROKEN_SORT }), 2000), '(b) the notice');
  // (c) x-barva and a comment: kept through Výborné knihy's change; the key stays through its own.
  await core.setFile(BOOK_YML, expectedUsage('types/book-overlay-xbarva-input.yml'));
  await sleep(500);
  await selectTab(page, Q.vyb);
  await (await must(hdr(panelOf(page), 'Finished'), 'Finished')).click({ modifiers: ['Shift'] });
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-xbarva-after-vyborne.yml')), expectedUsage('types/book-overlay-xbarva-after-vyborne.yml'), '(c) the Přečtené 2026 item\'s lines kept');
  await selectTab(page, Q.p26);
  await click(hdr(panelOf(page), 'Finished'), 'Finished');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-xbarva-after-prectene.yml')), expectedUsage('types/book-overlay-xbarva-after-prectene.yml'), '(c) x-barva kept, the comment gone');
  // (d) Repeated with different settings: one tab; Remove removes both.
  await core.setFile(BOOK_YML, swap(OVERLAY_BOOK, '  - Výborné knihy\n', '  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n'));
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26, Q.vyb]), ['', Q.roz, Q.p26, Q.vyb], '(d) one tab');
  await click(menuItem(await tabMenu(page, Q.p26), 'Remove from Books page'), 'Remove');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-without-prectene.yml')), expectedUsage('types/book-overlay-without-prectene.yml'), '(d) both items removed');
  // (f) NFD name: written NFC on the next change.
  await core.setFile(BOOK_YML, expectedUsage('types/book-overlay-nfd-input.yml'));
  await must(tab(page, Q.p26), 'the NFD tab resolves', 3000);
  await selectTab(page, Q.p26);
  await click(hdr(panelOf(page), 'Finished'), 'Finished');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-nfd-after-change.yml')), expectedUsage('types/book-overlay-nfd-after-change.yml'), '(f) NFC');
});

test('fr_qry_07_ac25_views_items_read_and_kept_quoted_name', async ({ page }) => {
  const vault = overlayVault((f) => {
    f[BOOK_YML] = expectedUsage('types/book-overlay-quoted-name-input.yml');
    f[qfile('Čtu, až bude čas')] = viewQuery({ title: 'Čtu, až bude čas', view: 'table', sort: '{ by: modified, order: desc }', columns: ['author'] });
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, 'Čtu, až bude čas'), 'tab', 8000);
  await selectTab(page, 'Čtu, až bude čas');
  await click(hdr(panelOf(page), 'Title'), 'Title');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-quoted-name.yml')), expectedUsage('types/book-overlay-quoted-name.yml'), '(e) written quoted');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-26

test('fr_qry_07_ac26_rename_duplicate_remove_with_settings', async ({ page }) => {
  const ui = { usageColumnWidths: { [tabKey(Q.p26)]: { title: 300 }, [blockKey(CESTY_ID, Q.p26, 1)]: { title: 200 } } };
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault(), ui });
  await must(tab(page, Q.p26), 'tab', 8000);
  // (b) Duplicate copies the own settings, selects the copy.
  await selectTab(page, Q.p26);
  await click(menuItem(await tabMenu(page, Q.p26), 'Duplicate'), 'Duplicate');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-duplicate.yml')), expectedUsage('types/book-overlay-duplicate.yml'), '(b) the copy\'s item after line 19');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === 'Přečtené 2026 (2)'), 'Přečtené 2026 (2)', '(b) the copy is selected');
  const dup = (await core.typeCalls()).at(-1);
  // D-2214 (CP-35, D-2200): the copy's item lines come from one `viewCopy` op.
  assert.deepEqual(dup?.ops.map((o: any) => o.op), ['views', 'viewCopy'], '(b) one type_patch: views and viewCopy');
  assert.equal((await uiState(core))?.usageColumnWidths?.[tabKey('Přečtené 2026 (2)')], undefined, '(b) widths not copied');
});

test('fr_qry_07_ac26_rename_duplicate_remove_with_settings_rename_and_remove', async ({ page }) => {
  const ui = { usageColumnWidths: { [tabKey(Q.p26)]: { title: 300 }, [blockKey(CESTY_ID, Q.p26, 1)]: { title: 200 } } };
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault(), ui });
  await must(tab(page, Q.p26), 'tab', 8000);
  // (a) Rename… runs the job: only the name: value and the saved: lines.
  await click(menuItem(await tabMenu(page, Q.p26), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'Rename query');
  await dlg.getByRole('textbox').first().fill('Přečtené letos');
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-renamed.yml'), 3000), expectedUsage('types/book-overlay-renamed.yml'), '(a) book.yml line 15');
  assert.equal(await fileText(core, CESTY), expectedUsage('notes/knihy-na-cesty-renamed.md'), '(a) Cesty lines 11 and 19');
  const st = await eventually(() => uiState(core), (u) => u?.usageColumnWidths?.[tabKey('Přečtené letos')]?.title === 300, 2000);
  assert.deepEqual([st?.usageColumnWidths?.[tabKey('Přečtené letos')], st?.usageColumnWidths?.[blockKey(CESTY_ID, 'Přečtené letos', 1)]], [{ title: 300 }, { title: 200 }], '(a) the usage keys move');
  await click(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first(), 'Undo');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === OVERLAY_BOOK, 3000), OVERLAY_BOOK, '(a) Undo restores book.yml');
  // (c) Remove; Show a saved query re-adds a plain name.
  await must(tab(page, Q.p26), 'tab back', 3000);
  await click(menuItem(await tabMenu(page, Q.p26), 'Remove from Books page'), 'Remove');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-without-prectene.yml')), expectedUsage('types/book-overlay-without-prectene.yml'), '(c) removed with its settings');
  await click(addView(page), 'Add view');
  await click((await must(addMenu(page), 'Add view')).locator(`[data-query="${Q.p26}"]`), 'Přečtené 2026');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-readded-prectene.yml')), expectedUsage('types/book-overlay-readded-prectene.yml'), '(c) a plain name');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-14

test('fr_qry_01_ac14_block_sort_is_its_own', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CTENI) });
  const blk = block(page, Q.p26);
  await must(blk, 'Čtení\'s block', 8000);
  // (a) A click on Rating: one autosave of Čtení.
  await click(hdr(blk, 'Rating'), 'header Rating');
  assert.equal(await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-click-rating.md')), expectedUsage('notes/cteni-2026-click-rating.md'), '(a) Čtení: the sort line and modified:');
  assert.deepEqual(await writes(core), [CTENI], '(a) one write');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), '(a) the query file untouched');
  assert.equal(await fileText(core, BOOK_YML), original(BOOK_YML), '(a) book.yml untouched');
  // (c) ⇧-click on Finished.
  await (await must(hdr(blk, 'Finished'), 'Finished')).click({ modifiers: ['Shift'] });
  assert.equal(await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-shift-finished.md')), expectedUsage('notes/cteni-2026-shift-finished.md'), '(c) two own levels');
  // (b) ⌘Z with the focus on the block's header undoes the last block write.
  await (await must(hdr(blk, 'Finished'), 'Finished')).focus();
  await page.keyboard.press('Meta+z');
  assert.equal(await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-click-rating.md')), expectedUsage('notes/cteni-2026-click-rating.md'), '(b) ⌘Z restores the fence\'s lines');
  // (d) The popover: scope, Use the query's sort.
  await click(sortButton(blk), 'the block\'s sort');
  await must(sortDialog(page), 'Sort');
  assert.equal(flat(await textOf(sortScope(page))), 'This block\'s sort', '(d) the scope');
  await click(sortDialog(page).getByRole('button', { name: rx('Use the query\'s sort') }), 'Use the query\'s sort');
  const d = await fileWhen(core, CTENI, (x) => minusModified(x) === minusModified(original(CTENI)));
  assert.equal(minusModified(d), minusModified(original(CTENI)), '(d) the sort lines removed: the body equals the fixture\'s');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  assert.equal(flat(await textOf(sortButton(toolbar(page)))), 'Finished ↓ +2', 'the tab still shows the query\'s sort');
});

test('fr_qry_01_ac14_block_sort_is_its_own_overlay', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b1 = block(page, Q.p26, 0), b2 = block(page, Q.p26, 1);
  await must(b1, 'block 1', 8000);
  await click(hdr(b1, 'Author'), 'block 1 Author');
  assert.equal(await fileWhen(core, CESTY, (x) => x === expectedUsage('notes/knihy-na-cesty-b1-click-author.md')), expectedUsage('notes/knihy-na-cesty-b1-click-author.md'), 'block 1: line 12');
  assert.deepEqual(await rowsAre(b2, P26_ROWS), P26_ROWS, 'block 2 keeps the query\'s order');
});

test('fr_qry_01_ac14_block_sort_is_its_own_callout', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b5 = block(page, Q.vyb, 1);
  await must(b5, 'block 5', 8000);
  await click(hdr(b5, 'Finished'), 'block 5 Finished');
  assert.equal(await fileWhen(core, CESTY, (x) => x === expectedUsage('notes/knihy-na-cesty-b5-click-finished.md')), expectedUsage('notes/knihy-na-cesty-b5-click-finished.md'), 'block 5: `> sort:` after line 42');
});

test('fr_qry_01_ac14_block_sort_is_its_own_without_an_editor', async ({ page }) => {
  const vault = viewsVault((f) => { f['.trash/Pages/Stará četba.md'] = '---\ntype: page\ntitle: Stará četba\n---\n```query\nsaved: Přečtené 2026\n```\n'; });
  const core = await startViews(page, { route: 'inbox', vault });
  await runCommand(page, 'Go to Trash');
  await click(main(page).getByRole('row').filter({ hasText: 'Stará četba' }).first(), 'the trashed note');
  await page.keyboard.press('Enter');
  const blk = block(page, Q.p26);
  await must(blk, 'its block', 8000);
  assert.equal(await isDisabled(sortButton(blk)), true, 'the sort button aria-disabled');
  assert.equal(await sortButton(blk).getAttribute('aria-description'), NOT_EDITABLE, 'with query.block.usageNotEditable');
  await hdr(blk, 'Rating').click({ force: true });
  await sleep(300);
  assert.deepEqual(await writes(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-15

test('fr_qry_01_ac15_query_page_sets_the_defaults', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(Q.p26), vault: overlayVault() });
  await must(hdr(main(page), 'Rating'), 'the query page\'s table', 8000);
  await click(sortButton(main(page)), 'sort');
  await must(sortDialog(page), 'Sort');
  assert.equal(flat(await textOf(sortScope(page))), 'Default for tabs and blocks without their own sort', 'the scope line');
  assert.equal(await sortDialog(page).getByRole('button', { name: rx('Use the query\'s sort') }).count(), 0, 'no `Use the query\'s sort` on the page');
  await page.keyboard.press('Escape');
  await click(hdr(main(page), 'Rating'), 'header Rating');
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-click-rating.yml')), expectedView('prectene-2026-click-rating.yml'), 'the query file (Q2\'s expected bytes)');
  assert.equal(await fileText(core, BOOK_YML), OVERLAY_BOOK, 'book.yml untouched');
  // Cesty's block 2 (no own sort) follows; block 1 (own sort) doesn't.
  await openNote(page, 'Knihy na cesty');
  const rating = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu', 'Sto zimních dní', 'Šest cest k moři', 'Tiché město', 'Kniha o čaji', 'Zahrada v dešti'];
  assert.deepEqual(await rowsAre(block(page, Q.p26, 1), rating, 1000), rating, 'block 2 follows within 1 s');
  assert.deepEqual(await rowsAre(block(page, Q.p26, 0), TITLE_ASC, 1000), TITLE_ASC, 'block 1 keeps its own order');
  // The editor's per-usage line.
  await click(blockEdit(block(page, Q.p26, 0)), 'Edit query from block 1');
  assert.ok(flat(await textOf(await must(editor(page), 'editor'))).includes('Sort and columns are set on each tab and block.'), 'query.editor.perUsage');
  assert.equal(await editor(page).locator('p[data-per-usage]').count(), 1, 'p[data-per-usage]');
});

test('fr_qry_01_ac15_query_page_sets_the_defaults_columns', async ({ page }) => {
  // `Columns` on the query page writes the query file's `columns` (the defaults) with its scope line.
  const core = await startViews(page, { route: queryRoute(Q.p26) });
  const pb = await must(main(page).locator('figure[data-query-block]').first(), 'the query page\'s block', 8000);
  await must(hdr(pb, 'Rating'), 'the query page\'s table', 8000);
  await click(blockColumns(pb), 'Columns');
  await must(columnsMenu(page), 'menu Columns');
  assert.equal(flat(await textOf(columnsScope(page))), 'Default for tabs and blocks without their own columns', 'the scope line');
  await click(check(page, 'Genres'), 'Genres');
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-columns-genres.yml')), expectedView('prectene-2026-columns-genres.yml'), 'the query file\'s columns (Q2\'s expected bytes)');
  await page.keyboard.press('Escape');
  assert.equal(await fileText(core, BOOK_YML), original(BOOK_YML), 'book.yml untouched');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'Čtení untouched');
});

test('fr_qry_01_ac15_query_page_sets_the_defaults_filter_from_a_block', async ({ page }) => {
  // The editor opened from Cesty's block 1 writes the query file (shared): `rating: Excellent` leaves 3 rows in every
  // usage of `Přečtené 2026`, each in its own order.
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b1 = await must(block(page, Q.p26, 0), 'Cesty\'s block 1', 8000);
  await click(blockEdit(b1), 'Edit query from block 1');
  await must(editor(page), 'the editor');
  await addFilter(page, 'Rating', 'is', 'Excellent');
  await done(page);
  assert.ok((await fileWhen(core, qfile(Q.p26), (x) => !!x && x.includes('rating: Excellent')))?.includes('rating: Excellent'), 'the filter is in the query file');
  assert.equal(minusModified(await fileText(core, CESTY)), minusModified(OVERLAY_CESTY), 'Cesty\'s fences untouched');
  assert.equal(await fileText(core, BOOK_YML), OVERLAY_BOOK, 'book.yml untouched');
  const byTitle = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu'];
  const byQuery = ['Mapa bez severu', 'Cizí přístavy', 'Čarovná mapa']; // finished ↓, rating ↑, title ↑
  assert.deepEqual(await rowsAre(block(page, Q.p26, 0), byTitle), byTitle, 'block 1: its own `title ↑`');
  assert.deepEqual(await rowsAre(block(page, Q.p26, 1), byQuery), byQuery, 'block 2: the query\'s sort');
  await openNote(page, 'Čtení 2026');
  assert.deepEqual(await rowsAre(block(page, Q.p26), byQuery), byQuery, 'Čtení\'s block: the query\'s sort');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, byTitle), byTitle.map((x) => x.normalize('NFC')), 'the tab: its own `rating ↑, title ↑`');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.p26}"] a`).first(), 'query/Přečtené 2026');
  assert.deepEqual(await rowsAre(main(page), byQuery), byQuery, 'the query page: the query\'s sort');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-16

test('fr_qry_01_ac16_effective_and_broken_usage_values', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b4 = block(page, Q.vyb, 0);
  await must(b4, 'block 4', 8000);
  assert.deepEqual(await rowsAre(b4, VYB_ROWS), VYB_ROWS, 'R200 rows');
  assert.ok(await seen(usageNotice(b4, 'sort').filter({ hasText: BROKEN_SORT }), 2000), 'the notice');
  assert.deepEqual((await headersOf(b4)).map(flat), ['Title ↑', 'Author', 'Status', 'Finished'], 'R200 headers');
  assert.deepEqual(await writes(core), [], 'opening and drawing write nothing');
  await click(hdr(b4, 'Title'), 'Title');
  assert.equal(await fileWhen(core, CESTY, (x) => x === expectedUsage('notes/knihy-na-cesty-b4-click-title.md')), expectedUsage('notes/knihy-na-cesty-b4-click-title.md'), 'lines 35…37 → one line');
  // A block of a version 2 query: controls aria-disabled, its own values still apply.
  await core.setFile(qfile(Q.vyb), swap(original(qfile(Q.vyb)), 'version: 1\n', 'version: 2\n'));
  await sleep(500);
  assert.equal(await isDisabled(sortButton(b4)), true, 'a Newer query: sort aria-disabled');
  assert.equal(await sortButton(b4).getAttribute('aria-description'), 'Made by a newer version of Tegg. Read-only.', 'query.block.readOnly');
  assert.deepEqual(await rowsAre(b4, ['Mapa bez severu', 'Čarovná mapa', 'Cizí přístavy']), ['Mapa bez severu', 'Čarovná mapa', 'Cizí přístavy'], 'its own `title ↓` still applies');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-24…AC-27

test('fr_qry_05_ac24_block_columns_are_its_own', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CTENI) });
  const blk = block(page, Q.p26);
  await must(blk, 'block', 8000);
  await click(blockColumns(blk), 'Columns');
  await must(columnsMenu(page), 'menu');
  assert.equal(flat(await textOf(columnsScope(page))), 'Columns of this block', 'the scope line');
  await click(check(page, 'Genres'), 'Genres');
  assert.equal(await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-columns-genres.md')), expectedUsage('notes/cteni-2026-columns-genres.md'), 'a line after line 11');
  assert.equal(await fileText(core, qfile(Q.p26)), original(qfile(Q.p26)), 'the query file untouched');
});

test('fr_qry_05_ac24_block_columns_are_its_own_drag', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CTENI) });
  const blk = block(page, Q.p26);
  await must(blk, 'block', 8000);
  await drag(page, hdr(blk, 'Finished'), hdr(blk, 'Author'), { at: 'left' });
  assert.equal(await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-columns-reordered.md')), expectedUsage('notes/cteni-2026-columns-reordered.md'), 'the header drag');
});

test('fr_qry_05_ac24_block_columns_are_its_own_overlay', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b1 = block(page, Q.p26, 0);
  await must(b1, 'block 1', 8000);
  await click(blockColumns(b1), 'Columns');
  await click(check(page, 'Rating'), 'Rating');
  assert.equal(await fileWhen(core, CESTY, (x) => x === expectedUsage('notes/knihy-na-cesty-b1-columns-rating.md')), expectedUsage('notes/knihy-na-cesty-b1-columns-rating.md'), 'line 13');
  await page.keyboard.press('Escape');
  await click(blockColumns(b1), 'Columns');
  await click(columnsMenu(page).getByRole('menuitem', { name: rx('Use the query\'s columns') }), 'Use the query\'s columns');
  assert.equal(await fileWhen(core, CESTY, (x) => x === expectedUsage('notes/knihy-na-cesty-b1-columns-reset.md')), expectedUsage('notes/knihy-na-cesty-b1-columns-reset.md'), 'line 13 removed');
});

test('fr_qry_05_ac25_widths_per_usage', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b2 = block(page, Q.p26, 1);
  const handle = b2.getByRole('separator', { name: rx('Resize Title') });
  await must(handle, 'block 2\'s Resize Title', 8000);
  await b2.scrollIntoViewIfNeeded();
  const w0 = await uiWrites(core);
  const th = hdr(b2, 'Title');
  await drag(page, handle, { dx: 200 - (await th.boundingBox())!.width, dy: 0 });
  const w2 = (await th.boundingBox())!.width;
  assert.ok(near(w2, 200), `Title 200 px in block 2 (${w2})`);
  // Slice Q3 (AC-Test-Change, D-2196; D-2177): a block's resize writes `widths` into its fence once, when the drag ends;
  // it is a vault write, not a ui-state.json entry.
  const key = blockKey(CESTY_ID, Q.p26, 2);
  const cesty = await fileWhen(core, CESTY, (t) => !!t && /saved: Přečtené 2026\n(?:[^`]*\n)?widths: \{ title: 200 \}\n```/.test(t));
  assert.ok(cesty && /widths: \{ title: 200 \}/.test(cesty), 'block 2\'s fence gets `widths: { title: 200 }`');
  assert.equal((await uiState(core))?.usageColumnWidths?.[key], undefined, `no usageColumnWidths["${key}"]`);
  assert.equal((await uiWrites(core)) - w0, 0, 'no ui_state_set');
  assert.ok(!near((await hdr(block(page, Q.p26, 0), 'Title').boundingBox())!.width, 200), 'block 1 keeps its width');
  assert.deepEqual(await writes(core), [CESTY], 'one note write');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  assert.ok(!near((await hdr(panelOf(page), 'Title').boundingBox())!.width, 200), 'the tab keeps R130\'s default');
  const th2 = hdr(panelOf(page), 'Title');
  await drag(page, panelOf(page).getByRole('separator', { name: rx('Resize Title') }), { dx: 300 - (await th2.boundingBox())!.width, dy: 0 });
  // Slice Q3 (D-2177): the tab's widths go into its views: item.
  assert.ok(await fileWhen(core, BOOK_YML, (t) => !!t && t.includes('    widths: { title: 300 }\n')), 'the tab\'s item gets `    widths: { title: 300 }`');
  assert.equal((await uiState(core))?.usageColumnWidths?.[tabKey(Q.p26)], undefined, 'no ui-state.json entry for the tab');
  assert.equal(await usageRoot(page, tabKey(Q.p26)).count(), 1, 'the tabpanel carries data-usage-key');
});

test('fr_qry_05_ac26_on_cards_per_usage', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(CESTY), vault: overlayVault() });
  const b3 = block(page, Q.roz);
  const bd = await must(board(page, Q.roz).first(), 'block 3\'s board', 8000);
  // Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row part two FR-QRY-05 AC-26; D-1891): superseded for boards:
  // block 3's `columns: [rating]` is kept and ignored; its cards are R193's author chip only; no `On cards` row; nothing
  // is written.
  const cesty = await fileText(core, CESTY);
  const first = bd.locator('article[data-board-card]').first();
  await must(first, 'a card of block 3');
  assert.ok(await seen(first.locator('footer a.chip[data-attribute="author"]'), 2000), 'block 3\'s cards show the author chip (Book\'s preview)');
  assert.equal(await bd.locator('[data-attribute="rating"]').count(), 0, 'no Rating pill from `columns: [rating]`');
  await click(blockEdit(b3), 'Edit query');
  const e = await must(editor(page), 'the editor');
  assert.equal(await e.getByRole('group', { name: rx('On cards') }).count(), 0, 'no `On cards` row');
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.equal(await fileText(core, CESTY), cesty, 'Cesty is never rewritten');
  assert.equal(await fileText(core, qfile(Q.roz)), original(qfile(Q.roz)), 'the query file untouched');
  void check; void expectedUsage; void fileWhen;
  void lane;
});

test('fr_qry_05_ac27_folds_per_usage', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.zanr), 'tab', 8000);
  await selectTab(page, Q.zanr);
  await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'Collapse Román');
  const st = await eventually(() => uiState(core), (u) => (u?.usageFolded?.['tab:book/podle žánru'] ?? []).includes('option:Román'));
  assert.deepEqual(st?.usageFolded?.['tab:book/podle žánru'], ['option:Román'], 'usageFolded["tab:book/podle žánru"]');
  assert.deepEqual(await writes(core), [], 'no vault file changes');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.zanr}"] a`).first(), 'query/Podle žánru');
  const pb = await must(board(page, Q.zanr), 'the page\'s board', 5000);
  assert.equal(await lane(pb, 'option:Román').getAttribute('data-folded'), null, 'open on the query page');
  assert.equal(st?.usageFolded?.[pageKey(Q.zanr)], undefined, 'no page key');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-8

test('fr_qry_09_ac8_usage_settings_follow_external_changes', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await core.setFile(BOOK_YML, swap(OVERLAY_BOOK, '    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n', '    sort: { by: title, order: desc }\n'));
  const desc = [...TITLE_ASC].reverse();
  assert.deepEqual(await panelRowsAre(page, desc, 2000), desc, 'the tab reorders within 2 s');
  assert.equal((await core.typeCalls()).length + (await writes(core)).length, 0, 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-13

test('fr_fmt_12_ac13_usage_settings_are_nfc', async ({ page }) => {
  const vault = overlayVault((f) => { f[CESTY] = f[CESTY].replace('saved: Přečtené 2026\n```\n\nRozečtené', `saved: ${'Přečtené 2026'.normalize('NFD')}\n\`\`\`\n\nRozečtené`); });
  const core = await startViews(page, { route: noteRoute(CESTY), vault });
  const b2 = block(page, Q.p26, 1);
  const handle = b2.getByRole('separator', { name: rx('Resize Title') });
  await must(handle, 'block 2 (NFD saved:)', 8000);
  await b2.scrollIntoViewIfNeeded();
  await drag(page, handle, { dx: 60, dy: 0 });
  // Slice Q3 (AC-Test-Change, D-2196; D-2177): the widths go into the NFD block's fence; its NFD `saved:` line keeps its
  // bytes and the new line is NFC; no ui-state.json key.
  const t = await fileWhen(core, CESTY, (x) => !!x && x.includes(`saved: ${'Přečtené 2026'.normalize('NFD')}\nwidths: { title: `));
  assert.ok(t?.includes(`saved: ${'Přečtené 2026'.normalize('NFD')}\nwidths: { title: `), 'the NFD saved: line kept, `widths:` after it');
  assert.deepEqual(Object.keys((await uiState(core))?.usageColumnWidths ?? {}), [], 'no usageColumnWidths key');
  const probe = await usages(page);
  assert.ok(probe && probe.every((u) => u.key === u.key.normalize('NFC')), 'usages(): NFC keys');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-31

test('fr_syn_03_ac31_usage_writes_check_the_base', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  const actions: [string, () => Promise<void>][] = [
    ['a header click', () => click(hdr(panelOf(page), 'Finished'), 'Finished')],
    ['a popover change', async () => { await click(sortButton(toolbar(page)), 'sort'); await must(sortDialog(page), 'Sort'); await click(sortLevels(page).nth(1).getByRole('button', { name: rx('Remove') }), 'Remove Title'); await page.keyboard.press('Escape'); }],
    ['a Columns change', async () => { await click(tabColumns(page), 'Columns'); await click(check(page, 'Genres'), 'Genres'); await page.keyboard.press('Escape'); }],
    ['a header drag', () => drag(page, hdr(panelOf(page), 'Finished'), hdr(panelOf(page), 'Author'), { at: 'left' })],
    ['Use the query\'s sort', async () => { await click(sortButton(toolbar(page)), 'sort'); await click(sortDialog(page).getByRole('button', { name: rx('Use the query\'s sort') }), 'Use'); await page.keyboard.press('Escape'); }],
  ];
  await countAlerts(page);
  for (const [what, act] of actions) {
    const disk = await silently(core, BOOK_YML);
    const n = await alertsShown(page, VIEWS_OUT);
    await act();
    assert.ok(await eventually(() => alertsShown(page, VIEWS_OUT), (c) => c > n, 3000), `${what}: a new alert`);
    assert.ok(await seen(alertWith(page, VIEWS_OUT), 1000), `${what}: the alert shows`);
    assert.equal(await fileText(core, BOOK_YML), disk, `${what}: nothing written`);
  }
  assert.ok((await core.typeCalls()).every((c) => c.ok === false), 'every type_patch refused');
  assert.ok((await core.typeCalls()).length >= actions.length, 'and each was a type_patch (not a query file write)');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-49

test('fr_syn_06_ac49_each_usage_action_writes_one_file', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  for (const n of [Q.roz, Q.p26, Q.vyb]) {
    await selectTab(page, n);
    await click(sortButton(toolbar(page)), 'sort');
    await page.keyboard.press('Escape');
    await click(toolbarMenuButton(page), '⋯');
    await page.keyboard.press('Escape');
    if (n === Q.roz) continue; // a board with vertical lanes: no Columns, no folding
    // A table tab: its Columns menu opened and closed. Slice Q3 (AC-Test-Change, D-2196; D-2177): a resize writes the
    // usage now, so the read-only tour has no resizes.
    await click(tabColumns(page), 'Columns');
    await must(columnsMenu(page), 'menu Columns');
    await page.keyboard.press('Escape');
  }
  await openNote(page, 'Knihy na cesty');
  const b1 = await must(block(page, Q.p26, 0), 'Cesty', 8000);
  await click(blockColumns(b1), 'block 1: Columns');
  await must(columnsMenu(page), 'menu Columns');
  await page.keyboard.press('Escape');
  // Folding: a lane of a board with horizontal lanes (`query/Podle žánru`), closed and opened again.
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.zanr}"] a`).first(), 'query/Podle žánru');
  const zb = await must(board(page, Q.zanr), 'Podle žánru\'s board', 5000);
  await click(lane(zb, 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'Collapse Román');
  await click(lane(zb, 'option:Román').getByRole('button', { name: rx('Expand Román') }), 'Expand Román');
  await openNote(page, 'Čtení 2026');
  assert.deepEqual(await writes(core), [], 'the tour writes nothing');
  assert.equal((await core.typeCalls()).length, 0, 'no type_patch');
  // One action per usage, one file each.
  await click(hdr(block(page, Q.p26), 'Rating'), 'Čtení: Rating');
  await fileWhen(core, CTENI, (x) => x === expectedUsage('notes/cteni-2026-click-rating.md'));
  assert.deepEqual(await writes(core), [CTENI], 'a block: its note');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  await click(hdr(panelOf(page), 'Finished'), 'tab: Finished');
  await fileWhen(core, BOOK_YML, (x) => x === expectedUsage('types/book-overlay-prectene-click-finished.yml'));
  assert.deepEqual((await core.typeCalls()).map((c) => c.key), ['book'], 'a tab: book.yml once');
  assert.deepEqual((await core.queryCalls()).map((c) => c.cmd), [], 'no query file write');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-11

test('fr_sto_07_ac11_usage_state_is_machine_local', async ({ page }) => {
  const ui = { queryColumnWidths: { [Q.p26]: { title: 200 } }, boardFolded: { [Q.zanr]: ['option:Román'] } };
  const core = await startViews(page, { route: noteRoute(CTENI), ui });
  const blk = block(page, Q.p26);
  const th = hdr(blk, 'Title');
  await must(th, 'block', 8000);
  assert.ok(!near((await th.boundingBox())!.width, 200), '0.4.0\'s queryColumnWidths isn\'t read');
  await drag(page, blk.getByRole('separator', { name: rx('Resize Title') }), { dx: 40, dy: 0 });
  // Slice Q3 (AC-Test-Change, D-2196; D-2177): the block's widths go into its fence (a vault write), never ui-state.json.
  assert.ok(await fileWhen(core, CTENI, (t) => !!t && /saved: Přečtené 2026\nwidths: \{ title: \d+ \}\n/.test(t)), 'the fence gets its widths');
  const st = await uiState(core);
  assert.equal(st?.usageColumnWidths?.[blockKey(CTENI_ID, Q.p26, 1)], undefined, 'no usageColumnWidths entry for the block');
  assert.deepEqual([st?.queryColumnWidths, st?.boardFolded], [ui.queryColumnWidths, ui.boardFolded], '0.4.0 keys stay unchanged');
  assert.equal(Object.keys(await core.files()).filter((k) => /ui-state/.test(k)).length, 0, 'nothing in the vault');
});

// ------------------------------------------------------------------------------------------------ FR-TPL-04 AC-3

test('fr_tpl_04_ac3_template_usage_settings_are_copied', async ({ page }) => {
  const vault = viewsVault((f) => {
    f['_templates/Page/Seznam knih.md'] = expectedUsage('templates/seznam-knih.md');
    f['.tegg/types/page.yml'] = swap(f['.tegg/types/page.yml'], 'preview: []\n', 'preview: []\ntemplate: _templates/Page/Seznam knih.md\n');
  });
  const core = await startViews(page, { route: 'inbox', vault });
  await page.keyboard.press('Meta+n');
  await must(page.getByRole('dialog', { name: /^⟦?New object⟧?$/ }), 'the type picker');
  await page.keyboard.type('Page');
  await page.keyboard.press('Enter');
  await must(page.getByRole('textbox', { name: 'Title', exact: true }).and(page.locator(':focus')), 'the Title field');
  await page.keyboard.type('Seznam na léto');
  await page.keyboard.press('Enter');
  const path = await eventually(async () => Object.keys(await core.files()).find((p) => p.startsWith('Pages/Seznam na léto')), (p) => !!p, 3000);
  assert.ok(path, 'the new Page exists');
  assert.ok((await core.files())[path!].endsWith(expectedUsage('notes/seznam-knih-new.md')), 'the fence copied byte for byte');
  const blk = block(page, Q.p26);
  assert.deepEqual(await rowsAre(blk, TITLE_ASC, 3000), TITLE_ASC, 'its block orders by title');
  const before = await fileText(core, '_templates/Page/Seznam knih.md');
  await click(hdr(blk, 'Title'), 'Title');
  await fileWhen(core, path!, (x) => !!x && x.includes('sort: { by: title, order: desc }'));
  assert.ok((await fileText(core, path!))?.includes('saved: Přečtené 2026\nsort: { by: title, order: desc }\n'), 'a click writes the new note');
  assert.equal(await fileText(core, '_templates/Page/Seznam knih.md'), before, 'not the template');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-25 (UI)

test('fr_lnk_03_ac25_rename_keeps_usage_settings', async ({ page }) => {
  const ui = { usageColumnWidths: { [tabKey(Q.p26)]: { title: 300 }, [pageKey(Q.p26)]: { author: 180 } }, typeViews: { lastTab: { book: Q.p26 } } };
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault(), ui });
  await must(tab(page, Q.p26), 'tab', 8000);
  const n0 = await uiWrites(core);
  await click(menuItem(await tabMenu(page, Q.p26), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'Rename query');
  await dlg.getByRole('textbox').first().fill('Přečtené letos');
  await page.keyboard.press('Enter');
  const st = await eventually(() => uiState(core), (u) => !!u?.usageColumnWidths?.[tabKey('Přečtené letos')], 3000);
  assert.deepEqual(st?.usageColumnWidths, { [tabKey('Přečtené letos')]: { title: 300 }, [pageKey('Přečtené letos')]: { author: 180 } }, 'R198\'s keys move after done');
  assert.equal(st?.typeViews?.lastTab?.book, 'Přečtené letos', 'lastTab follows');
  assert.equal((await uiWrites(core)) - n0, 1, 'in one ui_state_set');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-52

test('fr_ux_03_ac52_usage_commands', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: overlayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await runCommand(page, 'Use the query\'s sort');
  const want = swap(OVERLAY_BOOK, '    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n', '');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === want), want, 'the palette command removes the item\'s sort');
  await runCommand(page, 'Use the query\'s columns');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === original(BOOK_YML)), original(BOOK_YML), 'then the columns: a plain item, the flow line again (the base book.yml)');
  // Slice Q2-T (AC-Test-Change, D-1912; D-1891): `Use the query's columns` isn't listed for a board usage.
  await selectTab(page, Q.roz);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Use the query');
  await sleep(300);
  assert.ok(!(await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).some((o) => o.includes('Use the query\'s columns')), 'not listed on the board Rozečtené');
  await page.keyboard.press('Escape');
  void callsOf;
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-22

test('nfr_oth_02_ac22_usage_strings', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), vault: overlayVault(), pseudo: true });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await click(sortButton(toolbar(page)), 'sort');
  await must(sortDialog(page), 'Sort');
  assert.equal(flat(await textOf(sortScope(page))), '⟦This tab\'s sort⟧', 'the scope line in ⟦ ⟧');
  assert.equal(flat(await textOf(sortDialog(page).getByRole('button', { name: rx('Use the query\'s sort') }))), '⟦Use the query\'s sort⟧', 'the button in ⟦ ⟧');
  void pseudoLocale;
});

void A;
