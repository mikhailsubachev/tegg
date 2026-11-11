// Slice Q, L5 (WebKit + fake core): the query block of docs/acceptance/queries.md R140, R141, R144: FR-QRY-05 AC-1…AC-9
// (List and Table, the Columns menu, header sorts, rows as references, read-only cells, virtualized tables), FR-QRY-06
// AC-9…AC-16, AC-18, AC-19 (insert, the new query from the note, every block state, Show more, inline fences, two blocks of
// one query, usages, deleting a block, source and trash views), FR-QRY-08 AC-1 (the new-object footer), FR-QRY-03 AC-1,
// AC-3, AC-5, AC-6 (`this`), FR-TPL-04 AC-1 (a block in a template), FR-EDT-02 AC-24, AC-25 (one atom; undo and reload).
// Interface docs/contracts/v1-queries.md §3, §4.3, §4.4, §5. Written from the ACs and the contract only (D-61). Lookups go
// through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, P, Q, TITLES, anyBlock, block, blockButton, blockByMessage, blockColumns, blockEdit, blockInfo, blockMessage, blockNotice, blockSaveAs, blockStateIs,
  click, columnsMenu, description, editor, editorBody, eventually, expectedFile, headers, isDisabled, main, mainName, menuItems, must, mustBeOn, newObjectButton,
  noteRoute, noteWith, noteWrites, openEditor, openNote, picker, pickerOptions, qfile, queriesVault, queryFileText, queryText, queryWrites, resultLinks, results,
  resultsAre, mustResults, runCommand, seen, showMore, sleep, startQueries, textOf, tokenColor, usageChip, writeCalls, done, nameField, newQueryDialog, titleField, queryRoute,
} from './queries-helpers';
import { shortDate } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const OPEN7 = [P.t1, P.t2, P.t3];
const TABLE7 = [P.t5, P.t1, P.t2, P.t3, P.t4];
const RUNNING = [P.cesta, P.cajovna, P.maly, P.lisabon];

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-1, AC-2

test('fr_qry_05_ac1_list_rows_are_chips', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.open);
  assert.deepEqual(await resultsAre(b, OPEN7, 8000), OPEN7, 'three results');
  const list = await must(b.getByRole('list', { name: Q.open }), 'list named by the title');
  assert.equal(await list.getByRole('listitem').count(), 3, 'three listitems');
  const first = b.locator(`a[data-query-result="${P.t1}"]`);
  const t = await textOf(first);
  assert.ok(t.includes(TITLES.t1) && t.includes(shortDate('2026-11-12', 'cs')) && t.includes('To do'), `T1's chip: title, due date, status (${t})`);
  // The chip itself carries the type icon (`data-icon` on the `a`); its drawn icon is the task box, as in Backlinks (D-600).
  assert.equal(await first.getAttribute('data-icon'), 'check-square', 'the Task icon');
  assert.ok((await textOf(b.locator(`a[data-query-result="${P.t2}"]`))).includes('In progress') && (await textOf(b.locator(`a[data-query-result="${P.t3}"]`))).includes('In progress'), 'T2, T3: In progress');
  // An overdue date is --danger, weight 600 (T7 in Úkoly po termínu).
  await openNote(page, 'Přehled dotazů');
  const over = block(page, Q.overdue).locator(`a[data-query-result="${P.t7}"]`);
  await must(over, 'T7 in Úkoly po termínu');
  const due = await over.evaluate((a, d) => { const e = [...a.querySelectorAll('*')].find((x) => (x.textContent ?? '').trim() === d) as HTMLElement | undefined; return e ? [getComputedStyle(e).color, getComputedStyle(e).fontWeight] : null; }, shortDate('2026-11-09', 'cs'));
  assert.deepEqual(due, [await tokenColor(page, '--danger'), '600'], 'overdue: --danger, weight 600');
});

test('fr_qry_05_ac2_single_type_table', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  assert.deepEqual(await resultsAre(b, TABLE7, 8000), TABLE7, 'rows in R146\'s order');
  assert.deepEqual((await headers(b)).map((h) => h.replace(/\s*[↑↓]$/, '')), ['Title', 'Status', 'Priority', 'Due date', 'Modified'], 'Title, then `columns:` in order');
  const cb = b.locator(`tr[data-query-result="${P.t1}"] [role="checkbox"]`);
  assert.equal(await cb.getAttribute('aria-disabled'), 'true', 'Title shows the read-only task checkbox');
  const t4 = await textOf(b.locator(`tr[data-query-result="${P.t4}"]`));
  assert.ok(t4.includes('—'), 'T4\'s empty due cell shows `—`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-3, AC-4, AC-5

test('fr_qry_05_ac3_columns_menu_per_query', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  assert.ok(await seen(blockColumns(b), 1000), 'Table view: `Columns` next to `Edit query`');
  assert.equal(await blockColumns(block(page, Q.open)).count(), 0, 'List view: no `Columns`');
  await click(blockColumns(b), 'Columns');
  const menu = await must(columnsMenu(page), 'the Columns menu');
  const items = await menuItems(menu);
  assert.deepEqual(items.slice(0, 1), ['Title'], 'Title first');
  assert.ok(items.includes('Tags') && items.includes('Source') && items.includes('Aliases') && items.includes('Created') && items.includes('Modified') && items[items.length - 1].startsWith('New property'), 'R130\'s rows, then `New property…`');
  assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Title' }).getAttribute('aria-disabled'), 'true', 'Title checked and aria-disabled');
  assert.ok(!(await textOf(menu)).includes('Up to 4 columns'), 'no limit message (AP-1294)');
  const typeBefore = (await core.files())['.tegg/types/task.yml'];
  await click(menu.getByRole('menuitemcheckbox', { name: 'Tags' }), 'check Tags');
  const t1 = await eventually(() => queryFileText(core, Q.table), (t) => !!t && t.includes('columns: [status, priority, due, modified, tags]'));
  assert.ok(t1?.includes('columns: [status, priority, due, modified, tags]'), 'Tags appended, committed in one write');
  await click(columnsMenu(page).getByRole('menuitemcheckbox', { name: 'Modified' }), 'uncheck Modified');
  const t2 = await eventually(() => queryFileText(core, Q.table), (t) => !!t && t.includes('columns: [status, priority, due, tags]'));
  assert.ok(t2?.includes('columns: [status, priority, due, tags]'), 'Modified removed');
  assert.deepEqual(await queryWrites(core), [qfile(Q.table), qfile(Q.table)], 'one write per change');
  assert.equal((await core.files())['.tegg/types/task.yml'], typeBefore, 'the type file is untouched (`columns:` is per query)');
});

test('fr_qry_05_ac4_mixed_types_table', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.lisabon) });
  const b = block(page, Q.all);
  assert.deepEqual(await resultsAre(b, [P.dotaz, P.t2, P.porada7, P.bez], 8000), [P.dotaz, P.t2, P.porada7, P.bez], 'rows Dotaz, T2, Porada 7, Bez hlavičky');
  assert.deepEqual(await headers(b), ['Title', 'Type', 'Tags', 'Modified ↓'], 'headers Title, Type, Tags, Modified ↓');
  const row = async (p: string) => textOf(b.locator(`tr[data-query-result="${p}"]`));
  assert.ok((await row(P.dotaz)).includes('Quick Note') && (await row(P.dotaz)).includes('#finance'), 'Dotaz: Quick Note, #finance');
  assert.ok((await row(P.t2)).includes('Task') && (await row(P.t2)).includes('#offsite'), 'T2: Task, #offsite');
  assert.ok((await row(P.porada7)).includes('Schůzka') && (await row(P.porada7)).includes('—'), 'Porada 7: Schůzka, —');
  assert.ok((await row(P.bez)).includes('Page'), 'Bez hlavičky: Page');
  for (const p of [P.dotaz, P.t2, P.porada7, P.bez]) assert.ok(await b.locator(`tr[data-query-result="${p}"] [data-icon]`).count() >= 1, `${p}: its own type icon`);
  await click(blockColumns(b), 'Columns');
  const menu = await must(columnsMenu(page), 'the mixed Columns menu');
  assert.deepEqual((await menuItems(menu)).filter((x) => !x.startsWith('Mixed')), ['Title', 'Type', 'Tags', 'Source', 'Aliases', 'Created', 'Modified'], 'only the universal rows plus Type');
  assert.ok((await textOf(menu)).includes('Mixed types: only columns every object has.'), 'the mixed note');
  assert.ok(!(await textOf(menu)).includes('New property'), 'no `New property…`');
});

test('fr_qry_05_ac5_mixed_view_drops_type_columns', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  await openEditor(b, page);
  await click(editor(page).getByRole('button', { name: /^⟦?Type⟧?$/ }), '`Type`');
  await click(page.getByRole('option', { name: /Schůzka/ }).first(), 'Schůzka');
  await done(page);
  const t = await eventually(() => queryFileText(core, Q.table), (x) => !!x && x.includes('columns: [modified, type]'));
  assert.ok(t?.includes('types: [task, schůzka]') && t.includes('columns: [modified, type]'), '`columns: [modified, type]` in one write');
  assert.equal((await queryWrites(core)).length, 1, 'one write');
  await openEditor(block(page, Q.table), page);
  await click(editor(page).getByRole('button', { name: /^⟦?Remove Schůzka⟧?$/ }), 'Remove Schůzka');
  await done(page);
  const t2 = await eventually(() => queryFileText(core, Q.table), (x) => !!x && x.includes('types: [task]'));
  assert.ok(t2?.includes('columns: [modified, type]'), 'removing Schůzka doesn\'t bring them back');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-6, AC-7, AC-8, AC-9

test('fr_qry_05_ac6_header_click_sorts', async ({ page }) => {
  // The fixture's table is already sorted `due` ascending, so a first click would toggle it to descending; the runtime
  // copy starts descending (empty last) so the AC's sequence (ascending, then descending, one write each) holds.
  const vault = queriesVault((f) => {
    f[P.porada14] = f[P.porada14] + '\n```query\nsaved: Úkoly z této schůzky\n```\n';
    f[qfile(Q.table)] = f[qfile(Q.table)].replace('sort: { by: due, order: asc }', 'sort: { by: due, order: desc }');
  });
  const core = await startQueries(page, { route: noteRoute(P.porada7), vault });
  const b = block(page, Q.table);
  await mustResults(b, [P.t3, P.t2, P.t1, P.t5, P.t4], 'precondition (due descending, empty last)', 8000);
  const due = b.getByRole('columnheader', { name: /Due date/ });
  await click(due, 'Due date');
  assert.equal(await eventually(() => due.getAttribute('aria-sort'), (s) => s === 'ascending'), 'ascending', '`Due date ↑`');
  assert.deepEqual(await resultsAre(b, TABLE7), TABLE7, 'ascending, empty last');
  assert.ok((await queryFileText(core, Q.table))?.includes('sort: { by: due, order: asc }'), '`sort:` written (ascending)');
  await click(due, 'Due date again');
  assert.equal(await eventually(() => due.getAttribute('aria-sort'), (s) => s === 'descending'), 'descending', 'a second click: descending');
  assert.deepEqual(await resultsAre(b, [P.t3, P.t2, P.t1, P.t5, P.t4]), [P.t3, P.t2, P.t1, P.t5, P.t4], 'descending, empty last');
  assert.ok((await queryFileText(core, Q.table))?.includes('sort: { by: due, order: desc }'), '`sort:` written');
  assert.equal((await queryWrites(core)).length, 2, 'each click writes once');
  await openNote(page, '2026-10-14 Týdenní porada');
  const b14 = block(page, Q.table);
  assert.deepEqual(await resultsAre(b14, [P.t6], 1000), [P.t6], 'the second fence of the query in Porada 14 follows (D-1494)');
  assert.equal(await b14.getByRole('columnheader', { name: /Due date/ }).getAttribute('aria-sort'), 'descending', 'with the same sort');
  // ⏎ / Space on a focused header do the same.
  const pr = b14.getByRole('columnheader', { name: /Priority/ });
  await (await must(pr, 'Priority header')).focus();
  await page.keyboard.press('Enter');
  assert.ok(await eventually(() => queryFileText(core, Q.table), (t) => !!t && t.includes('sort: { by: priority, order: asc }')), '⏎ sorts');
  await page.keyboard.press('Space');
  assert.ok(await eventually(() => queryFileText(core, Q.table), (t) => !!t && t.includes('sort: { by: priority, order: desc }')), 'Space sorts');
});

test('fr_qry_05_ac7_rows_are_references', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.porada7), preview: 'hover' });
  const b = block(page, Q.open);
  await mustResults(b, OPEN7, 'precondition', 8000);
  const chip = b.locator(`a[data-query-result="${P.t1}"]`);
  await chip.hover();
  await must(page.getByRole('dialog', { name: `Preview: ${TITLES.t1}` }), 'Hover: resting 1,000 ms previews', 2500);
  await page.mouse.move(5, 5);
  await click(chip, 'T1 chip');
  await mustBeOn(page, TITLES.t1, 'Hover: a click opens');
  await page.goBack();
  await mustBeOn(page, TITLES.porada7, 'one history entry');
  const row = block(page, Q.table).locator(`tr[data-query-result="${P.t5}"]`);
  await row.hover();
  await must(page.getByRole('dialog', { name: `Preview: ${TITLES.t5}` }), 'a table row previews too', 2500);
  // Header buttons keep their jobs.
  await page.mouse.move(5, 5);
  await click(blockEdit(b), 'Edit query');
  await must(editor(page), 'the pencil opens the editor, no preview');
});

test('fr_qry_05_ac8_read_only_cells_two_views', async ({ page }) => {
  const vault = queriesVault((f) => { f[qfile('Desky')] = queryText({ title: 'Desky', types: ['projekt'], view: 'board', columns: ['stav'] }); f['Pages/Desky.md'] = noteWith('Desky', ['Desky']); });
  const core = await startQueries(page, { route: noteRoute(P.porada7), vault });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  const before = await writeCalls(core);
  const cell = b.locator(`tr[data-query-result="${P.t1}"] td`).nth(1);
  await cell.click();
  await cell.dblclick();
  await page.keyboard.type('xyz');
  await sleep(300);
  assert.deepEqual(await writeCalls(core), before, 'a click, double-click or typing on a cell sends no write');
  const cb = b.locator(`tr[data-query-result="${P.t1}"] [role="checkbox"]`);
  assert.equal(await cb.getAttribute('aria-disabled'), 'true', 'the task checkbox is aria-disabled');
  assert.equal(await description(cb), 'Edit the task to change it.', 'with `Edit the task to change it.`');
  await openEditor(block(page, Q.open), page);
  const views = await editor(page).getByRole('radio').or(editor(page).getByRole('button', { name: /^(List|Table|Board|Calendar)$/ })).allInnerTexts();
  assert.deepEqual(views.filter((v) => /List|Table|Board|Calendar/.test(v)).map((v) => v.trim()), ['List', 'Table'], 'the View control has only List and Table');
  await page.keyboard.press('Escape');
  await openNote(page, 'Desky');
  const d = block(page, 'Desky');
  assert.ok((await textOf(blockNotice(d))).includes('The setting view can\'t be read, so its default is used.'), '`view: board` is a broken part');
  assert.ok(await seen(d.getByRole('list'), 1000), 'shown as List');
  assert.ok((await queryFileText(core, 'Desky'))?.includes('view: board'), 'kept in the file');
});

test('fr_qry_05_ac9_long_results_are_virtualized', async ({ page }) => {
  const vault = queriesVault((f) => {
    for (let i = 0; i < 1000; i++) f[`Pages/Velký ${String(i).padStart(4, '0')}.md`] = `---\ntype: page\ntitle: Velký ${String(i).padStart(4, '0')}\ntags: [hromada]\n---\nŘádek.\n`;
    f[qfile('Hromada')] = queryText({ title: 'Hromada', types: ['page'], filters: ['tags: { has_any_of: [hromada] }'], view: 'table', limit: 1000, columns: ['tags'] });
  });
  await startQueries(page, { route: queryRoute('Hromada'), vault });
  const b = block(page, 'Hromada');
  await must(b.locator('tr[data-query-result]'), 'table rows', 15000);
  assert.ok((await b.locator('tr[data-query-result]').count()) < 80, 'fewer than 80 row elements at the top');
  const seenRows = new Set<string>();
  // Scroll the table's scroll container in 400 px steps (about 12 rows, less than the rendered window). A synthetic
  // wheel at the pointer's 0,0 scrolls the sidebar, and queued wheel events in WebKit land in bursts that jump past
  // rows, so the step is applied to the scroller directly and each step waits for the window to follow.
  const scrollStep = () => b.locator('table').first().evaluate((t) => {
    let e: HTMLElement | null = t.parentElement;
    while (e && !(e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement;
    if (!e) return null;
    e.scrollTop += 400;
    return e.scrollTop + e.clientHeight >= e.scrollHeight - 1;
  });
  for (let i = 0; i < 200; i++) {
    for (const p of await results(b)) seenRows.add(p);
    assert.ok((await b.locator('tr[data-query-result]').count()) < 80, `fewer than 80 row elements while scrolling (step ${i})`);
    const end = await scrollStep();
    assert.notEqual(end, null, 'the table is inside a scroll container');
    await sleep(80);
    if (end) { await sleep(200); for (const p of await results(b)) seenRows.add(p); break; }
  }
  assert.equal(seenRows.size, 1000, 'every row is reachable');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-9, AC-10

test('fr_qry_06_ac9_insert_saved_query_block', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  const body = await must(editorBody(page), 'Note body', 8000);
  await body.getByText('Cesta týmu do Lisabonu.').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/quer');
  const opt = await must(page.getByRole('option', { name: /Query/ }), 'slash item `Query`');
  assert.ok((await textOf(opt)).includes('A live list of objects'), 'with `A live list of objects`');
  await page.keyboard.press('Enter');
  await must(picker(page), 'dialog `Choose a query`');
  const opts = (await pickerOptions(page).allInnerTexts()).map((t) => t.split('\n')[0].trim());
  const coll = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });
  const readable = [Q.all, Q.today, Q.open, Q.table, Q.running, Q.books, Q.cancelled, Q.overdue, Q.comments, Q.newer].sort(coll.compare);
  assert.deepEqual(opts, ['New query', ...readable], '`New query` first, then the ten readable queries by title (cs)');
  await page.keyboard.type('běhu');
  await page.keyboard.press('Enter');
  const b = block(page, Q.running);
  // D-1497: the host is never its own result, so the block in Lisabon shows three (the AC said four).
  const inLisabon = RUNNING.filter((p) => p !== P.lisabon);
  assert.deepEqual(await resultsAre(b, inLisabon, 3000), inLisabon, 'the block shows three results (D-1497)');
  const text = await eventually(() => core.files().then((f) => f[P.lisabon]), (t) => !!t && t.includes('saved: Projekty v běhu'));
  assert.ok(text?.includes('Cesta týmu do Lisabonu.\n\n```query\nsaved: Projekty v běhu\n```\n\n```query\nsaved: Vše, co sem odkazuje\n```'), 'the fence as a new block after the paragraph');
  assert.deepEqual(await noteWrites(core), [P.lisabon], 'one autosave');
  // Esc in the picker inserts nothing (from the palette's `Insert query`).
  const n = (await core.writesTo()).length;
  await runCommand(page, 'Insert query');
  await must(picker(page), 'the picker from `Insert query`');
  await page.keyboard.press('Escape');
  await sleep(1500);
  assert.equal((await core.writesTo()).length, n, 'Esc writes nothing');
});

test('fr_qry_06_ac10_new_query_from_the_note', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  const body = await must(editorBody(page), 'Note body', 8000);
  await body.getByText('Cesta týmu do Lisabonu.').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/quer');
  await page.keyboard.press('Enter');
  await must(picker(page), 'Choose a query');
  await page.keyboard.press('Enter'); // `New query` is first
  const b = block(page, 'Untitled query');
  assert.equal((await blockInfo(b)).state, 'draft', 'an `Untitled query` draft block');
  assert.ok((await textOf(b)).includes('Choose types and filters to start. Until then the block shows nothing.'), 'the draft text');
  await must(editor(page), 'the editor opens at once');
  assert.equal(await titleField(page).evaluate((e) => { const i = e as HTMLInputElement; return i.selectionStart === 0 && i.selectionEnd === i.value.length; }), true, 'with the title selected');
  await page.keyboard.press('Escape');
  await sleep(1500);
  assert.equal(await anyBlock(page).filter({ has: page.locator('[data-query-state="draft"]') }).count() + await main(page).locator('figure[data-query-state="draft"]').count(), 0, 'Esc right away drops the draft');
  assert.deepEqual(await core.writesTo(), [], 'no note write, no query file');
  // Again, with Task: the first commit creates the file and writes the fence in one autosave.
  await core.setFile(qfile('Untitled query'), queryText({ title: 'Untitled query' }), { silent: true });
  await body.getByText('Cesta týmu do Lisabonu.').click();
  await page.keyboard.press('End');
  await page.keyboard.type('/quer');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await click(editor(page).getByRole('button', { name: /^⟦?Type⟧?$/ }), 'Type');
  await click(page.getByRole('option', { name: /^Task/ }).first(), 'Task');
  await done(page);
  const created = await eventually(() => queryFileText(core, 'Untitled query (2)'), (t) => t !== undefined);
  assert.ok(created?.includes('types: [task]'), '`Untitled query (2).yml` (the name was taken)');
  const text = await eventually(() => core.files().then((f) => f[P.lisabon]), (t) => !!t && t.includes('saved: Untitled query (2)'));
  assert.ok(text?.includes('```query\nsaved: Untitled query (2)\n```'), 'the fence names the created query (D-1495)');
  assert.deepEqual(await noteWrites(core), [P.lisabon], 'one autosave');
  assert.equal((await core.queryCalls()).find((c) => c.cmd === 'query_create')?.args?.free, true, 'the draft creates with `free: true`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-11, AC-12

test('fr_qry_06_ac11_empty_and_broken_states', async ({ page }) => {
  const vault = queriesVault((f) => {
    f[qfile('Dvě knihy')] = queryText({ title: 'Dvě knihy', types: ['kniha', 'neexistuje'] });
    f['Pages/Typy.md'] = noteWith('Typy', ['Dvě knihy']);
  });
  const core = await startQueries(page, { route: noteRoute(P.prehled), vault });
  const z = block(page, Q.cancelled);
  assert.equal(await blockStateIs(z, 'noResults', 8000), 'noResults', 'Zrušené úkoly: no results');
  assert.ok((await textOf(z)).includes('No objects match.'), '`No objects match.`');
  await must(blockButton(z, 'Edit query'), 'and `Edit query`');
  const k = block(page, Q.books);
  assert.deepEqual(await resultsAre(k, [P.krakatit]), [P.krakatit], 'Knihy s hodnocením: Krakatit');
  assert.equal(await textOf(blockNotice(k)), 'The filter hodnocení uses an attribute the Kniha type doesn\'t have, so it is ignored. Fix filter', 'the notice and `Fix filter`');
  assert.equal((await blockInfo(k)).broken, '1', 'data-query-broken="1"');
  await click(blockButton(k, 'Fix filter'), 'Fix filter');
  const row = editor(page).locator('[role="group"][data-filter="0"]');
  assert.equal(await row.getAttribute('data-broken'), 'notAttribute', 'that row is broken');
  assert.equal(await description(row), 'Ignored: not an attribute of Kniha', 'its description');
  assert.equal(await row.evaluate((e) => getComputedStyle(e).color), await tokenColor(page, '--danger'), 'drawn in --danger');
  await page.keyboard.press('Escape');
  const kniha = (await core.files())['.tegg/types/kniha.yml'];
  await core.setFile('.tegg/types/kniha.yml', `${kniha}  - key: hodnocení\n    name: Hodnocení\n    type: number\n`);
  assert.equal(await blockStateIs(k, 'noResults', 2000), 'noResults', 'with `hodnocení` in kniha.yml the filter counts: No objects match.');
  assert.deepEqual(await queryWrites(core), [], 'the query file is never rewritten');
  await openNote(page, 'Typy');
  const t = block(page, 'Dvě knihy');
  assert.equal(await blockStateIs(t, 'noType'), 'noType', 'types [kniha, neexistuje]: noType');
  assert.ok((await textOf(t)).includes('The type neexistuje doesn\'t exist.'), 'the notice');
  assert.deepEqual(await results(t), [], 'no results');
});

test('fr_qry_06_ac12_missing_trashed_unreadable', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.prehled) });
  const before = (await core.files())[P.prehled];
  const miss = blockByMessage(page, 'The query “Neexistující dotaz” doesn\'t exist.');
  await must(miss, 'not found', 8000);
  assert.equal((await blockInfo(miss)).state, 'notFound', 'state notFound');
  await must(blockButton(miss, 'Choose a query…'), '`Choose a query…`');
  await click(blockButton(miss, 'Create it'), 'Create it');
  assert.ok(await eventually(() => queryFileText(core, Q.missing), (t) => t !== undefined), '`Neexistující dotaz.yml` created');
  await must(editor(page), 'the editor opens on the block');
  await page.keyboard.press('Escape');
  const created = block(page, Q.missing);
  assert.equal((await results(created)).length, 20, 'the default query lists every object but the host (D-1492)');
  assert.equal((await core.files())[P.prehled], before, 'no note write');
  // Choose a query… on a not-found fence rewrites only its `saved:` line.
  const mid = before.replace('saved: Neexistující dotaz', 'saved: Jiný neexistující');
  await core.setFile(P.prehled, mid);
  const other = blockByMessage(page, 'The query “Jiný neexistující” doesn\'t exist.');
  await click(blockButton(other, 'Choose a query…'), 'Choose a query…');
  await must(picker(page), 'the picker');
  await page.keyboard.type('Zrušené');
  await page.keyboard.press('Enter');
  const noMod = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, '');
  const after = await eventually(() => core.files().then((f) => f[P.prehled]), (t) => !!t && t.includes('saved: Zrušené úkoly\n```\n\n```query\nsaved: Starý dotaz'));
  assert.equal(noMod(after), noMod(mid.replace('saved: Jiný neexistující', 'saved: Zrušené úkoly')), 'only that fence\'s `saved:` line changes');
  const old = blockByMessage(page, 'The query “Starý dotaz” is in the trash.');
  await must(blockButton(old, 'Restore'), 'Starý dotaz: in the trash with `Restore`');
  const bad = blockByMessage(page, 'This query can\'t be read (line 5).');
  await click(blockButton(bad, 'Open query'), 'Open query');
  await mustBeOn(page, Q.broken, 'the query page');
  assert.ok((await textOf(main(page))).includes('This query can\'t be read (line 5).'), 'the same notice');
  const eb = main(page).getByRole('button', { name: /^⟦?Edit query⟧?$/ });
  assert.ok((await eb.count()) === 0 || (await isDisabled(eb)), 'no editing');
  assert.equal(await queryFileText(core, Q.broken), queriesVault().files[qfile(Q.broken)], 'its bytes stay');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.newer}"]`), 'Novější verze');
  const nb = block(page, Q.newer);
  assert.deepEqual(await resultsAre(nb, [P.jana]), [P.jana], 'Novější verze: Jana');
  assert.equal((await blockInfo(nb)).readonly !== null, true, 'data-query-readonly');
  assert.equal(await main(page).locator('button[aria-haspopup="dialog"]').filter({ hasText: /Edit query/ }).first().getAttribute('aria-disabled'), 'true', '`Edit query` aria-disabled');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-13, AC-14, AC-15

test('fr_qry_06_ac13_show_more_pages', async ({ page }) => {
  const vault = queriesVault((f) => {
    f[qfile('Pět')] = queryText({ title: 'Pět', limit: 5, columns: ['type', 'modified'] });
    f[P.prehled] = f[P.prehled] + '\n```query\nsaved: Pět\n```\n';
  });
  const core = await startQueries(page, { route: noteRoute(P.prehled), vault });
  const b = block(page, 'Pět');
  await eventually(() => results(b), (r) => r.length === 5, 8000);
  assert.equal((await results(b)).length, 5, '5 rows');
  assert.equal((await blockInfo(b)).description, '20 results', 'the count is the total, 20 (21 objects minus the host)');
  for (let shown = 5; shown < 20; shown += 5) {
    assert.equal(await textOf(showMore(b)), `Show 5 more (out of 20)`, `${shown} shown: Show 5 more (out of 20)`);
    await click(showMore(b), 'Show more');
    assert.equal((await eventually(() => results(b), (r) => r.length === shown + 5)).length, shown + 5, `${shown + 5} shown`);
  }
  assert.ok(!(await seen(showMore(b), 500)), 'all 20 shown, the button goes');
  assert.deepEqual(await queryWrites(core), [], 'paging isn\'t written');
  await runCommand(page, 'Go to Queries');
  await page.goBack();
  assert.equal((await eventually(() => results(block(page, 'Pět')), (r) => r.length === 5)).length, 5, 'reset when the note is opened again');
});

test('fr_qry_06_ac14_inline_fences_are_read_only', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.prehled) });
  const b = block(page, Q.inline);
  assert.deepEqual(await resultsAre(b, [P.krakatit], 8000), [P.krakatit], 'Ruční dotaz: Krakatit');
  await must(blockSaveAs(b), '`Save as query…`');
  assert.equal(await blockEdit(b).count() + await blockColumns(b).count(), 0, 'no `Edit query`, no `Columns`');
  const broken = main(page).locator('figure[data-query-block][data-query-form="unreadable"]').first();
  await must(broken, 'the inline fence with invalid YAML');
  assert.ok((await textOf(broken)).includes('title: [rozbitý'), 'shows its text');
  await click(blockSaveAs(b), 'Save as query…');
  const dlg = await must(newQueryDialog(page), 'the name dialog');
  assert.equal(await nameField(page).inputValue(), Q.inline, 'prefilled `Ruční dotaz`');
  await click(dlg.getByRole('button', { name: /^⟦?Create⟧?$/ }), 'Create');
  assert.equal(await eventually(() => queryFileText(core, Q.inline), (t) => t !== undefined), expectedFile('saved-rucni-dotaz.yml'), 'Ruční dotaz.yml with the fence\'s keys, its comment after them');
  const text = await eventually(() => core.files().then((f) => f[P.prehled]), (t) => !!t && t.includes('saved: Ruční dotaz'));
  assert.ok(text?.includes('```query\nsaved: Ruční dotaz\n```'), 'the fence body is replaced');
  assert.deepEqual(await noteWrites(core), [P.prehled], 'one note write');
  assert.deepEqual(await resultsAre(block(page, Q.inline), [P.krakatit]), [P.krakatit], 'the same result');
});

test('fr_qry_06_ac15_same_query_twice_in_a_note', async ({ page }) => {
  const vault = queriesVault((f) => { f[P.porada7] = f[P.porada7].replace('Další porada:', '```query\nsaved: Otevřené úkoly z této schůzky\n```\n\nDalší porada:'); });
  const core = await startQueries(page, { route: noteRoute(P.porada7), vault });
  const a = block(page, Q.open, 0);
  const b = block(page, Q.open, 1);
  assert.deepEqual([await resultsAre(a, OPEN7, 8000), await resultsAre(b, OPEN7)], [OPEN7, OPEN7], 'two identical blocks');
  await openEditor(b, page);
  await click(editor(page).getByRole('button', { name: /^⟦?Remove group⟧?$/ }), 'Remove group');
  await done(page);
  assert.equal((await eventually(() => queryWrites(core), (w) => w.length === 1)).length, 1, 'one commit');
  assert.deepEqual([await resultsAre(a, [P.t1, P.t2, P.t3, P.t4], 1000), await resultsAre(b, [P.t1, P.t2, P.t3, P.t4], 1000)], [[P.t1, P.t2, P.t3, P.t4], [P.t1, P.t2, P.t3, P.t4]], 'both show the change within 1 s');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-16, AC-18, AC-19

test('fr_qry_06_ac16_usages_by_name', async ({ page }) => {
  const vault = queriesVault((f) => {
    f['.trash/Pages/Starý zápis.md'] = noteWith('Starý zápis', [Q.open]);
    f['Pages/Jinak psané.md'] = noteWith('Jinak psané', ['otevřené ÚKOLY z této schůzky']);
    f['Pages/NFD psané.md'] = noteWith('NFD psané', [Q.open.normalize('NFD')]);
  });
  const core = await startQueries(page, { route: `query/${Q.open}`, vault });
  await must(usageChip(page, P.porada7), 'Used on: Porada 7', 8000);
  const chips = await main(page).locator('a[data-usage]').evaluateAll((as) => as.map((a) => a.getAttribute('data-usage')?.normalize('NFC')));
  assert.deepEqual(chips, [P.porada7, P.porada14, 'Pages/Jinak psané.md', 'Pages/NFD psané.md', P.sablona], 'notes by title (another case and NFD included), then the template');
  assert.ok(!chips.includes('.trash/Pages/Starý zápis.md'), 'a fence in .trash/ is no usage');
  await openNote(page, 'Jinak psané');
  assert.notEqual((await blockInfo(block(page, Q.open))).state, 'notFound', 'the other-case name resolves (AP-1291)');
  await openNote(page, 'NFD psané');
  assert.notEqual((await blockInfo(block(page, Q.open))).state, 'notFound', 'the NFD name resolves');
});

test('fr_qry_06_ac16_usages_follow_edits', async ({ page }) => {
  const core = await startQueries(page, { route: `query/${Q.open}` });
  await must(usageChip(page, P.porada14), 'Used on: Porada 14', 8000);
  await core.setFile(P.porada14, (await core.files())[P.porada14].replace(`\`\`\`query\nsaved: ${Q.open}\n\`\`\`\n`, ''));
  assert.ok(await eventually(() => usageChip(page, P.porada14).count(), (n) => n === 0, 1000) === 0, 'deleting the block from Porada 14 removes it from `Used on` within 1 s');
});

test('fr_qry_06_ac18_deleting_a_block_keeps_the_query', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  const b = block(page, Q.all);
  await mustResults(b, [P.dotaz, P.t2, P.porada7, P.bez], 'precondition', 8000);
  const before = await core.files();
  await b.locator('.query-header').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Backspace');
  const text = await eventually(() => core.files().then((f) => f[P.lisabon]), (t) => !!t && !t.includes('saved: Vše, co sem odkazuje'));
  assert.ok(text && !text.includes('```query'), 'the block is gone from Lisabon');
  assert.deepEqual(await core.writesTo(), [P.lisabon], 'only Lisabon is written (one autosave)');
  assert.equal(await queryFileText(core, Q.all), before[qfile(Q.all)], '`Vše, co sem odkazuje.yml` untouched');
  await page.keyboard.press('Meta+z');
  const back = await eventually(() => core.files().then((f) => f[P.lisabon]), (t) => !!t && t.includes('saved: Vše, co sem odkazuje'));
  assert.equal(back?.slice(back.indexOf('---\n', 4)), before[P.lisabon].slice(before[P.lisabon].indexOf('---\n', 4)), 'Undo brings the fence back byte for byte');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.all}"]`), Q.all);
  await must(usageChip(page, P.lisabon), 'still used on Lisabon after the undo');
});

test('fr_qry_06_ac19_block_in_source_and_trash_views', async ({ page }) => {
  const vault = queriesVault((f) => { f['.trash/Pages/Starý zápis.md'] = noteWith('Starý zápis', [Q.running]); });
  const core = await startQueries(page, { route: noteRoute(P.porada7), vault });
  await mustResults(block(page, Q.open), OPEN7, 'precondition', 8000);
  await page.keyboard.press('Alt+Meta+u');
  assert.ok(await eventually(() => textOf(main(page)), (t) => t.includes('```query\nsaved: Otevřené úkoly z této schůzky\n```') || t.includes('```query saved: Otevřené úkoly z této schůzky ```')), 'the source view shows the fence as written');
  await page.keyboard.press('Alt+Meta+u');
  await runCommand(page, 'Go to Trash');
  await click(main(page).getByRole('row').filter({ hasText: 'Starý zápis' }).first(), 'the trashed note');
  await page.keyboard.press('Enter');
  assert.deepEqual(await resultsAre(block(page, Q.running), RUNNING, 3000), RUNNING, 'a trashed note shows its blocks with results');
  assert.deepEqual(await core.writesTo(), [], 'and writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-1

test('fr_qry_08_ac1_new_object_from_the_block', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.open);
  await mustResults(b, OPEN7, 'precondition', 8000);
  const btn = await must(newObjectButton(b), 'the footer `New Task`');
  assert.ok((await textOf(btn)).includes('New Task') || (await textOf(btn)).includes('New task'), 'New Task');
  assert.equal(await description(btn), '· links to this note', 'with `· links to this note`');
  await click(btn, 'New Task');
  // The new object's title gets the focus once its page is drawn; typing earlier loses keystrokes.
  await must(page.getByRole('textbox', { name: 'Title', exact: true }).and(page.locator(':focus')), 'the focused Title field');
  await page.keyboard.type('Objednat letenky');
  // D-522: typing the title writes nothing; its commit (⏎) is the first write.
  await page.keyboard.press('Enter');
  const path = await eventually(async () => Object.keys(await core.files()).find((p) => p.startsWith('Tasks/Objednat')), (p) => !!p, 3000);
  assert.ok(path, 'the first keystroke saves it');
  const t = (await core.files())[path!];
  assert.ok(t.includes('source: "[[2026-10-07 Týdenní porada]]"'), 'with `source: "[[2026-10-07 Týdenní porada]]"`');
  assert.ok(!t.includes('status: Done'), '`status is not Done` isn\'t pre-filled as a value');
  await page.goBack();
  // The new task has no due date and no priority, so the first block's group (due within 14 days or priority High)
  // can't list it; Porada 7's table block of the same host (`links_to: this` only) is the one that must follow.
  assert.ok((await eventually(() => results(block(page, Q.table)), (r) => r.includes(path!), 1000)).includes(path!), 'the block lists it within 1 s');
  for (const name of [Q.all, Q.today]) {
    await openNote(page, name === Q.all ? TITLES.lisabon : '2026-11-10');
    assert.equal(await newObjectButton(block(page, name)).count(), 0, `${name}: several types / no type: no footer`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-03 AC-1, AC-3, AC-5, AC-6

test('fr_qry_03_ac1_this_is_the_host', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.open);
  assert.deepEqual(await resultsAre(b, OPEN7, 8000), OPEN7, 'Porada 7: T1, T2, T3');
  assert.ok((await textOf(b.locator('.query-header'))).includes('3'), 'count 3');
  await openEditor(b, page);
  assert.ok((await textOf(editor(page).locator('[role="group"][data-filter="0"]'))).includes('This note · 2026-10-07 Týdenní porada'), 'Links to · is: `This note · 2026-10-07 Týdenní porada`');
  await page.keyboard.press('Escape');
  await openNote(page, TITLES.porada14);
  const b14 = block(page, Q.open);
  assert.deepEqual(await resultsAre(b14, [P.t6]), [P.t6], 'Porada 14: T6');
  await openEditor(b14, page);
  assert.ok((await textOf(editor(page).locator('[role="group"][data-filter="0"]'))).includes('This note · 2026-10-14 Týdenní porada'), '`… 2026-10-14 Týdenní porada`');
});

test('fr_qry_03_ac3_daily_note_date_context', async ({ page }) => {
  const vault = queriesVault((f) => {
    f['Daily/2026-11-09.md'] = '---\nid: 01JB5Q0000000000000000DN09\ntype: daily-note\ntitle: 2026-11-09\ndate: 2026-11-09\n---\n```query\nsaved: Vytvořeno v tento den\n```\n';
    f[P.lisabon] = f[P.lisabon] + '\n```query\nsaved: Vytvořeno v tento den\n```\n';
  });
  await startQueries(page, { route: noteRoute(P.den), vault });
  assert.deepEqual(await resultsAre(block(page, Q.today), [P.t7, P.krakatit, P.dotaz], 8000), [P.t7, P.krakatit, P.dotaz], 'Den: T7, Krakatit, Dotaz');
  await openNote(page, '2026-11-09');
  assert.equal(await blockStateIs(block(page, Q.today), 'noResults'), 'noResults', 'Daily/2026-11-09 in Prague: nothing');
  await openNote(page, TITLES.lisabon);
  const l = block(page, Q.today);
  assert.equal(await blockStateIs(l, 'needsContext'), 'needsContext', 'in Lisabon: needs context');
  assert.ok((await textOf(l)).includes('This filter needs the note it is used on.'), 'the message');
  assert.deepEqual(await results(l), [], 'no results');
});

test.describe('(Z) New York', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('fr_qry_03_ac3_daily_note_date_context_new_york', async ({ page }) => {
    const vault = queriesVault((f) => { f['Daily/2026-11-09.md'] = '---\nid: 01JB5Q0000000000000000DN09\ntype: daily-note\ntitle: 2026-11-09\ndate: 2026-11-09\n---\n```query\nsaved: Vytvořeno v tento den\n```\n'; });
    await startQueries(page, { route: noteRoute('Daily/2026-11-09.md'), vault });
    assert.deepEqual(await resultsAre(block(page, Q.today), [P.t7, P.krakatit], 8000), [P.t7, P.krakatit], 'America/New_York: Krakatit and T7 fall on the 9th');
  });
});

test('fr_qry_03_ac5_host_rename_keeps_context', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.open);
  await mustResults(b, OPEN7, 'precondition', 8000);
  await (await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title')).click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('2026-10-07 Porada');
  await page.keyboard.press('Enter');
  await eventually(() => core.jobs(), (j) => j.some((x) => x.kind === 'note-rename' && x.phase === 'done'), 5000);
  assert.deepEqual(await resultsAre(block(page, Q.open), OPEN7, 2000), OPEN7, 'Tegg\'s rename keeps the three results');
  const writesBefore = (await core.queryCalls()).length;
  await core.renameFile('Schůzky/2026-10-07 Porada.md', 'Schůzky/2026-10-07 Jinak.md');
  await openNote(page, '2026-10-07 Porada');
  assert.equal(await blockStateIs(block(page, Q.open), 'noResults', 2000), 'noResults', 'an outside rename (links broken): `No objects match.` within 2 s');
  await core.renameFile('Schůzky/2026-10-07 Jinak.md', 'Schůzky/2026-10-07 Porada.md');
  assert.deepEqual(await resultsAre(block(page, Q.open), OPEN7, 2000), OPEN7, 'renaming it back restores three');
  assert.equal((await core.queryCalls()).length, writesBefore, 'nothing is written by the block');
});

test('fr_qry_03_ac6_this_inside_an_embed', async ({ page }) => {
  // Schůzka is a user type, so its embeds default to `card` (embeds.md R31); `|full` makes the embed show the body.
  const vault = queriesVault((f) => { f['Pages/Vložená porada.md'] = '---\ntype: page\ntitle: Vložená porada\n---\nOdkaz na [[Výjezd Lisabon 2026]].\n\n![[2026-10-07 Týdenní porada|full]]\n'; });
  await startQueries(page, { route: noteRoute('Pages/Vložená porada.md'), vault });
  const b = block(page, Q.open);
  assert.deepEqual(await resultsAre(b, OPEN7, 8000), OPEN7, 'the embedded body\'s block runs with this = Porada 7');
});

// ------------------------------------------------------------------------------------------------ FR-TPL-04 AC-1

test('fr_tpl_04_ac1_template_block_uses_the_new_note', async ({ page }) => {
  const core = await startQueries(page, { route: 'inbox' });
  await page.keyboard.press('Meta+n');
  await must(page.getByRole('dialog', { name: /^⟦?New object⟧?$/ }), 'the type picker (D-1432)');
  await page.keyboard.type('Schůzka');
  await page.keyboard.press('Enter');
  // The new object's title gets the focus once its page is drawn; typing earlier loses keystrokes.
  await must(page.getByRole('textbox', { name: 'Title', exact: true }).and(page.locator(':focus')), 'the focused Title field');
  await page.keyboard.type('2026-11-10 Porada');
  // D-522: typing the title writes nothing; its commit (⏎) is the first write.
  await page.keyboard.press('Enter');
  const path = await eventually(async () => Object.keys(await core.files()).find((p) => p.startsWith('Schůzky/2026-11-10 Porada')), (p) => !!p, 3000);
  assert.ok(path, 'the new Schůzka exists');
  assert.ok((await core.files())[path!].includes('```query\nsaved: Otevřené úkoly z této schůzky\n```'), 'Šablona\'s body with the fence unchanged');
  const b = block(page, Q.open);
  assert.equal(await blockStateIs(b, 'noResults', 3000), 'noResults', 'its block: No objects match.');
  await core.setFile('Tasks/Úkol nové porady.md', '---\nid: 01JB5Q0000000000000000NEW1\ntype: task\ntitle: Úkol nové porady\nstatus: To do\npriority: Low\ndue: 2026-11-12\nsource: "[[2026-11-10 Porada]]"\n---\n');
  assert.deepEqual(await resultsAre(b, ['Tasks/Úkol nové porady.md'], 1000), ['Tasks/Úkol nové porady.md'], 'a task with its source: listed within 1 s');
  await openNote(page, TITLES.porada7);
  assert.deepEqual(await resultsAre(block(page, Q.open), OPEN7), OPEN7, 'Porada 7\'s block is unchanged');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-24, AC-25

test('fr_edt_02_ac24_query_block_is_one_atom', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const orig = (await core.files())[P.porada7];
  await mustResults(block(page, Q.open), OPEN7, 'precondition', 8000);
  const blocks = await page.evaluate(() => (window as any).__TEGG_TEST__?.queryBlocks?.() ?? null);
  assert.ok(Array.isArray(blocks), '`window.__TEGG_TEST__.queryBlocks()` (contract §3.2)');
  assert.deepEqual(blocks.map((b: any) => [b.source.includes('Otevřené'), b.nested, b.draft]), [[true, false, false], [false, false, false]], 'two top-level blocks');
  // Move the cursor through every block of Porada 7, Lisabon, Přehled and Den, then leave: nothing written.
  const body = await must(editorBody(page), 'Note body');
  await body.click();
  await page.keyboard.press('Meta+ArrowUp');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  for (const t of [TITLES.lisabon, 'Přehled dotazů', '2026-11-10']) {
    await openNote(page, t);
    await (await must(editorBody(page), 'Note body')).click();
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown');
  }
  await sleep(1500);
  assert.deepEqual(await core.writesTo(), [], 'opening the notes and moving through every block writes nothing');
  await openNote(page, TITLES.porada7);
  // Select the first block from the paragraph below with ↑, move it down with ⇧⌘↓.
  await (await must(editorBody(page).getByText('Další porada:'), 'the last paragraph')).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+Meta+ArrowDown');
  const moved = await eventually(() => core.files().then((f) => f[P.porada7]), (t) => !!t && t.indexOf('saved: Úkoly z této schůzky') < t.indexOf('saved: Otevřené úkoly z této schůzky'));
  assert.ok(moved && moved.indexOf('saved: Úkoly z této schůzky') < moved.indexOf('saved: Otevřené úkoly z této schůzky'), '⇧⌘↓ moves the selected block as a whole');
  // Typing never edits the fence text.
  await page.keyboard.type('x');
  await sleep(1200);
  assert.ok(!(await core.files())[P.porada7].includes('saved: Otevřené úkoly z této schůzkyx'), 'typing never edits the fence');
  void orig;
});

test('fr_edt_02_ac24_copy_and_paste_the_fence_bytes', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  const b = block(page, Q.all);
  await mustResults(b, [P.dotaz, P.t2, P.porada7, P.bez], 'precondition', 8000);
  await b.locator('.query-header').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Meta+c');
  const clip = await page.evaluate(async () => navigator.clipboard?.readText?.().catch(() => null) ?? null);
  if (clip !== null) assert.equal(clip.trimEnd(), '```query\nsaved: Vše, co sem odkazuje\n```', 'as plain text: the exact fence bytes');
  await (await must(editorBody(page).getByText('Cesta týmu do Lisabonu.'), 'paragraph')).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+v');
  const text = await eventually(() => core.files().then((f) => f[P.lisabon]), (t) => !!t && (t.match(/saved: Vše, co sem odkazuje/g) ?? []).length === 2);
  assert.equal((text?.match(/```query\nsaved: Vše, co sem odkazuje\n```/g) ?? []).length, 2, '⌘C / ⌘V paste the exact fence bytes into Tegg');
});

test('fr_edt_02_ac25_query_block_undo_and_reload', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const orig = (await core.files())[P.porada7];
  const b = block(page, Q.open);
  await mustResults(b, OPEN7, 'precondition', 8000);
  await b.locator('.query-header').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Backspace');
  await eventually(() => core.files().then((f) => f[P.porada7]), (t) => !!t && !t.includes('saved: Otevřené'));
  await page.keyboard.press('Meta+z');
  const back = await eventually(() => core.files().then((f) => f[P.porada7]), (t) => !!t && t.includes('saved: Otevřené'));
  assert.equal(back?.replace(/^modified: .*$/m, ''), orig.replace(/^modified: .*$/m, ''), '⌘Z after a delete restores the exact previous bytes');
  // An external change while the block's editor is open closes the editor without a commit.
  await openEditor(block(page, Q.open), page);
  await click(editor(page).getByRole('button', { name: /^⟦?Remove group⟧?$/ }), 'Remove group');
  const ext = (await core.files())[P.porada7].replace('Krátká', 'Krátká').replace('Program:', 'Program (upraveno):');
  await core.setFile(P.porada7, ext);
  assert.ok(await eventually(() => editor(page).count(), (n) => n === 0, 3000) === 0, 'the note reloads and the editor closes');
  assert.deepEqual(await queryWrites(core), [], 'without a commit: the query file isn\'t written');
});

void NOW; void mainName; void isDisabled; void blockMessage; void sleep;
