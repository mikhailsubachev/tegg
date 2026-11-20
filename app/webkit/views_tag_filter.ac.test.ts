// Slice Q2-T, L5 (WebKit + fake core): the tag filter on every view tab and `All <plural>`, multi-level sort on
// `All <plural>` and the machine-local state of docs/acceptance/views.md part three (R206, R208): FR-QRY-07 AC-30 (the tag
// filter on every tab), FR-QRY-01 AC-20 (multi-level sort on `All <plural>`) and FR-STO-07 AC-12 (tag filters, `All`
// sorts and old Tasks keys are machine-local). On the views fixture at part one's clock and on the tasks overlay.
// Interface docs/contracts/v1-views.md §29.6, §29.7, §30.1, §30.3. Written from the ACs and the contract only (D-61).
// Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ALL_BOOKS, BOOK_YML, CTENI, Q, allTab, board, click, description, eventually, lanes, main, menuItem, must, openNote, panelOf, panelRows, panelRowsAre, rx, runCommand,
  seen, selectTab, sleep, sortButton, sortDialog, sortLevels, startViews, tab, tabMenu, toolbar, typeRoute, uiState, viewsVault, writes,
} from './views-helpers';
import {
  KANBAN, SCHEDULE, TYPE_TASK, doneToggle, openTagFilter, openTasks, pickTag, startTasksViews, tagChips, tagOptionTexts, writesTo,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const header = (scope: Locator, name: string) => scope.getByRole('columnheader', { name: new RegExp(`^⟦?${name}`) });
const headerTexts = (page: Page) => panelOf(page).locator('[role="columnheader"]').evaluateAll((hs) => hs.map((h) => ((h as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));
const tagButton = (page: Page) => toolbar(page).getByRole('button', { name: rx('Filter by tag') }).or(toolbar(page).getByRole('combobox', { name: rx('Filter by tag') })).first();
const filterBooks = (page: Page) => toolbar(page).getByRole('searchbox', { name: rx('Filter Books…') });
async function domBefore(page: Page, a: Locator, b: Locator): Promise<boolean> {
  const ha = await a.first().elementHandle({ timeout: 1000 }).catch(() => null);
  const hb = await b.first().elementHandle({ timeout: 1000 }).catch(() => null);
  if (!ha || !hb) return false;
  return page.evaluate(([x, y]) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING), [ha, hb] as const);
}
/** R208: `All Books` sorted by Status ↑ then Title ↑. */
const BY_STATUS_TITLE = ['Dům u řeky', 'Kniha o horách', 'Ostrov bez jména', 'Noční vlak', 'Světla přístavu', 'Účetní ze Žižkova', 'Cizí přístavy', 'Čarovná mapa', 'Čtvrtá zima',
  'Kniha o čaji', 'Mapa bez severu', 'Sto zimních dní', 'Šest cest k moři', 'Tiché město', 'Zahrada v dešti', 'Zápisník z Tater', 'Písně z dálky'];

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-30

test('fr_qry_07_ac30_tag_filter_on_every_tab', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: null } } } });
  await must(filterBooks(page), '`Filter Books…` on All Books', 8000);
  await must(tagButton(page), '`Filter by tag` on All Books');
  assert.ok(await domBefore(page, filterBooks(page), tagButton(page)), '`Filter by tag` after `Filter Books…`');
  await openTagFilter(page);
  assert.deepEqual(await tagOptionTexts(page), ['#doporučené 2', '#odloženo 1', '#večerní 1'], 'All Books: R208\'s options');
  await pickTag(page, 'doporučené');
  await page.keyboard.press('Escape');
  assert.deepEqual(await panelRowsAre(page, ['Dům u řeky', 'Mapa bez severu']), ['Dům u řeky', 'Mapa bez severu'], '`#doporučené` leaves Dům u řeky, Mapa bez severu');
  // Rozečtené: the tags of its 5 cards; Ostrov bez jména excluded by the view's filter.
  await selectTab(page, Q.roz);
  const b = await must(board(page, Q.roz), 'the Rozečtené board', 5000);
  assert.deepEqual(await tagChips(page), [], 'Rozečtené has its own (empty) selection');
  await openTagFilter(page);
  assert.deepEqual(await tagOptionTexts(page), ['#doporučené 1', '#večerní 1'], 'Rozečtené: `#doporučené 1`, `#večerní 1`; no `#odloženo`');
  await pickTag(page, 'doporučené');
  await page.keyboard.press('Escape');
  const ls = await eventually(() => lanes(b), (l) => l.flatMap((x) => x.cards).length === 1, 2000);
  assert.deepEqual(ls.flatMap((x) => x.cards), ['Books/Dům u řeky.md'], 'only Dům u řeky\'s card');
  assert.equal(ls.length, 3, 'every lane stays shown');
  const u = await eventually(() => uiState(core), (x) => !!x?.tagFilter?.['tab:book/rozečtené'], 2000);
  assert.deepEqual(u?.tagFilter?.['all:book'], ['doporučené'], 'tagFilter["all:book"]');
  assert.deepEqual(u?.tagFilter?.['tab:book/rozečtené'], ['doporučené'], 'tagFilter["tab:book/rozečtené"]');
  // Another tab and another page keep it.
  await selectTab(page, Q.p26);
  assert.deepEqual(await tagChips(page), [], 'Přečtené 2026: no selection');
  await runCommand(page, 'Go to Inbox');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.roz);
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1, 2000), ['doporučené'], 'another page and back: kept');
  await click(allTab(page), 'All Books');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1, 2000), ['doporučené'], 'All Books kept');
  // Čtení's three query blocks have no Filter by tag.
  await openNote(page, 'Čtení 2026');
  await must(main(page).locator('figure[data-query-block]').first(), 'Čtení\'s blocks', 5000);
  assert.equal(await main(page).locator('figure[data-query-block]').getByRole('button', { name: rx('Filter by tag') }).count(), 0, 'no `Filter by tag` on a query block (D-1894)');
  // The same on every type page with views.
  for (const plural of ['Pages', 'Autoři']) {
    await runCommand(page, `Go to type: ${plural}`);
    assert.ok(await seen(tagButton(page), 3000), `type page ${plural}: \`Filter by tag\` on All ${plural}`);
  }
  assert.deepEqual(await writes(core), [], 'selecting tags writes nothing to the vault');
  void CTENI;
});

test('fr_qry_07_ac30_tag_filter_on_every_tab_after_a_relaunch', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: Q.roz } }, tagFilter: { 'all:book': ['doporučené'], 'tab:book/rozečtené': ['večerní'] } } });
  await must(board(page, Q.roz), 'Rozečtené', 8000);
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1, 3000), ['večerní'], 'Rozečtené\'s selection after a relaunch');
  await click(allTab(page), 'All Books');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1, 3000), ['doporučené'], 'All Books\' selection after a relaunch');
});

test('fr_qry_07_ac30_tag_filter_on_every_tab_all_tasks', async ({ page }) => {
  await startTasksViews(page, { route: TYPE_TASK, ui: { typeViews: { lastTab: { task: null } } } });
  await must(tagButton(page), '`Filter by tag` on All Tasks', 8000);
  await openTagFilter(page);
  assert.ok((await tagOptionTexts(page)).length > 0, 'All Tasks offers tags');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-20

test('fr_qry_01_ac20_multi_level_sort_on_all_tab', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: null } } } });
  await panelRowsAre(page, ALL_BOOKS, 8000);
  const u0 = (await core.calls()).filter((c) => c.cmd === 'ui_state_set').length;
  await click(header(panelOf(page), 'Status'), 'header Status');
  await page.keyboard.down('Shift');
  await click(header(panelOf(page), 'Title'), 'header Title');
  await page.keyboard.up('Shift');
  assert.deepEqual(await panelRowsAre(page, BY_STATUS_TITLE, 3000), BY_STATUS_TITLE, 'R208\'s order: Status ↑, then Title ↑');
  const hs = (await headerTexts(page)).map(flat);
  assert.ok(hs.includes('Status ↑¹') && hs.includes('Title ↑²'), `headers \`Status ↑¹\`, \`Title ↑²\` (${hs.join(' | ')})`);
  assert.equal(await header(panelOf(page), 'Status').getAttribute('aria-sort'), 'ascending', 'aria-sort on Status');
  assert.equal(await header(panelOf(page), 'Title').getAttribute('aria-sort'), null, 'not on Title');
  assert.equal(await description(header(panelOf(page), 'Title')), 'Sort level 2, ascending', 'Title: `Sort level 2, ascending`');
  const u = await eventually(() => uiState(core), (x) => Array.isArray(x?.typeSort?.book) && x.typeSort.book.length === 2, 2000);
  assert.deepEqual(u?.typeSort?.book, [{ by: 'status', order: 'asc' }, { by: 'title', order: 'asc' }], 'typeSort.book as a list of two levels');
  assert.equal((await core.calls()).filter((c) => c.cmd === 'ui_state_set').length - u0, 2, 'once per change');
  await click(sortButton(toolbar(page)), 'the sort button on All Books');
  const dlg = await must(sortDialog(page), 'dialog `Sort`');
  assert.equal(flat(await dlg.locator('p.sort-scope[data-scope="thisMac"]').innerText().catch(() => '')), 'Sort of this page on this Mac', 'scope `Sort of this page on this Mac`');
  assert.equal(await sortLevels(page).count(), 2, 'the R188 controls with two levels');
  assert.equal(await dlg.getByRole('button', { name: rx('Use the query\'s sort') }).count(), 0, 'no `Use the query\'s sort`');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writes(core), [], 'no vault file changes (D-1241)');
});

test('fr_qry_01_ac20_multi_level_sort_on_all_tab_0_4_value_reads_as_one_level', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: null } }, typeSort: { book: { column: 'title', dir: 'asc' } } } });
  await must(header(panelOf(page), 'Title'), 'All Books', 8000);
  const rows = await eventually(() => panelRows(page), (r) => r.length === 17, 3000);
  assert.equal(rows[0], 'Cizí přístavy', 'a 0.4.x single value reads as one level (Title ↑)');
  assert.equal(await header(panelOf(page), 'Title').getAttribute('aria-sort'), 'ascending', 'Title ↑');
  await click(sortButton(toolbar(page)), 'the sort button on All Books');
  await must(sortDialog(page), 'dialog `Sort`');
  assert.deepEqual(await sortLevels(page).evaluateAll((ls) => ls.map((l) => (l.getAttribute('aria-label') ?? '').normalize('NFC'))), ['Sort by Title, A → Z'], 'the popover shows it as one level');
});

test('fr_qry_01_ac20_multi_level_sort_on_all_tab_all_tasks', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK, ui: { typeViews: { lastTab: { task: null } } } });
  await must(header(panelOf(page), 'Title'), 'All Tasks', 8000);
  await click(header(panelOf(page), 'Title'), 'header Title');
  await page.keyboard.down('Shift');
  await click(header(panelOf(page), 'Due date'), 'header Due date');
  await page.keyboard.up('Shift');
  const u = await eventually(() => core.uiState() as Promise<any>, (x) => Array.isArray(x?.typeSort?.task) && x.typeSort.task.length === 2, 2000);
  assert.deepEqual(u?.typeSort?.task, [{ by: 'title', order: 'asc' }, { by: 'due', order: 'asc' }], 'All Tasks behaves the same');
  assert.deepEqual(await writesTo(core), [], 'no vault write');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-12

test('fr_sto_07_ac12_tag_filters_and_sorts_are_machine_local', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), ui: { typeViews: { lastTab: { book: null } } } });
  await must(tagButton(page), '`Filter by tag`', 8000);
  await pickTag(page, 'doporučené');
  await page.keyboard.press('Escape');
  await click(header(panelOf(page), 'Status'), 'header Status');
  await selectTab(page, Q.roz);
  await pickTag(page, 'večerní');
  await page.keyboard.press('Escape');
  const u = await eventually(() => uiState(core), (x) => !!x?.tagFilter?.['tab:book/rozečtené'] && Array.isArray(x?.typeSort?.book), 2000);
  assert.deepEqual(u?.tagFilter, { 'all:book': ['doporučené'], 'tab:book/rozečtené': ['večerní'] }, 'tagFilter keys');
  assert.deepEqual(u?.typeSort?.book, [{ by: 'status', order: 'asc' }], 'typeSort.book a list');
  assert.deepEqual(await writes(core), [], 'nothing under the vault changes');
  // Renaming Rozečtené in Tegg moves its tagFilter entry.
  await click(menuItem(await tabMenu(page, Q.roz), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'dialog `Rename query`');
  await dlg.getByRole('textbox').first().fill('Čtu teď');
  await page.keyboard.press('Enter');
  const u2 = await eventually(() => uiState(core), (x) => !!x?.tagFilter?.['tab:book/čtu teď'], 5000);
  assert.deepEqual(u2?.tagFilter?.['tab:book/čtu teď'], ['večerní'], 'the entry moves to the new name');
  assert.equal(u2?.tagFilter?.['tab:book/rozečtené'], undefined, 'the old key goes');
  void BOOK_YML;
  void viewsVault;
});

test('fr_sto_07_ac12_tag_filters_and_sorts_are_machine_local_tasks_keys', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, SCHEDULE);
  await click(doneToggle(b), '`Expand Done`');
  await pickTag(page, 'práce');
  await page.keyboard.press('Escape');
  const u = await eventually(() => core.uiState() as Promise<any>, (x) => !!x?.tagFilter?.['tab:task/schedule'] && !!x?.usageFolded?.['tab:task/schedule'], 2000);
  assert.deepEqual(u?.tagFilter?.['tab:task/schedule'], ['práce'], 'tagFilter["tab:task/schedule"]');
  assert.deepEqual(u?.usageFolded?.['tab:task/schedule'], ['!done'], 'usageFolded["tab:task/schedule"]');
  assert.deepEqual(await writesTo(core), [], 'nothing under the vault changes');
});

test('fr_sto_07_ac12_tag_filters_and_sorts_are_machine_local_0_4_tasks_keys', async ({ page }) => {
  const old = { view: 'kanban', groupBy: 'tag', dateFilter: 'today', tags: ['práce'], doneExpanded: true };
  const core = await startTasksViews(page, { route: TYPE_TASK, ui: { tasks: old } });
  assert.equal(await eventually(() => main(page).locator('[role="tab"][aria-selected="true"]').getAttribute('data-view-tab').catch(() => null), (x) => x === KANBAN, 5000), KANBAN, 'opens `Kanban`');
  assert.deepEqual(await tagChips(page), [], 'no tag selected');
  const s = await openTasks(page, SCHEDULE);
  assert.equal(await eventually(() => doneToggle(s).getAttribute('aria-expanded'), (x) => x === 'true', 3000), 'true', 'the Schedule done lane unfolded');
  const u = await eventually(() => core.uiState() as Promise<any>, (x) => x?.typeViews?.lastTab?.task !== undefined, 2000);
  assert.deepEqual(u?.tasks, old, 'the old keys stay in the file unchanged');
  assert.equal(u?.tagFilter?.['tab:task/kanban'], undefined, 'the old tag selection is dropped');
});

void seen;
void sleep;
void tab;
