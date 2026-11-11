// Slice Q, L5 (WebKit + fake core): the Queries section and the query page of docs/acceptance/queries.md R143:
// FR-QRY-06 AC-1…AC-8 (entry and list, find and sort, New query, the query page, edits reaching every block, rename,
// trash and restore, duplicate), AC-20 (`Query actions` by keyboard), FR-QRY-03 AC-4 (no host, no `this`), FR-TPL-04 AC-2
// (templates are usages, not results), FR-FMT-12 AC-9 (NFC names), FR-HOM-02 AC-28…AC-31 (pinning queries). Interface
// docs/contracts/v1-queries.md §2, §4.1…§4.6, §5 (fake core `queryCalls`, `writesTo`, `uiState`, `jobs`). Written from the ACs
// and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CREATED_DESC, P, PINS, Q, absent, actionsMenu, blockByMessage, blockInfo, backLink, block, click, description, editQueryButton, editor, editorButton, eventually, expectedFile, findField,
  focusName, gotoQueries, heading, isDisabled, main, mainName, menuItem, menuItems, must, mustBeOn, nameField, needsPage, newQueryButton, newQueryDialog,
  noteRoute, noteWrites, openNote, pageMenuButton, pinnedRow, pinnedSection, qfile, queriesEntry, queriesTable, queriesVault, queryFileText, queryRoute,
  queryRow, queryRows, queryText, queryWrites, renameDialog, resultsAre, mustResults, rowMenu, rowNamesAre, runCommand, seen, sidebar, sleep, sortButton, startQueries,
  textOf, titleField, trashRow, undoToast, usageChip, usedOn, NFD,
} from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-1

test('fr_qry_06_ac1_queries_entry_and_list', async ({ page }) => {
  const core = await startQueries(page, { route: 'inbox' });
  const entry = await must(queriesEntry(page), 'the sidebar entry `Queries`', 8000);
  assert.equal(await entry.getAttribute('aria-label'), 'Queries', 'its name');
  assert.ok((await textOf(entry)).includes('11'), 'the count 11 (unreadable included, trash excluded)');
  const order = await sidebar(page).evaluate((s) => {
    const y = (sel: string) => { const e = s.querySelector(sel) as HTMLElement | null; return e ? e.getBoundingClientRect().top : null; };
    const byText = (t: string) => { const e = [...s.querySelectorAll('a, button')].find((x) => (x.textContent ?? '').trim().startsWith(t)) as HTMLElement | undefined; return e ? e.getBoundingClientRect().top : null; };
    return { tags: byText('Tags'), queries: y('a.entry[data-command="queries.go"]'), trash: byText('Trash') };
  });
  assert.ok(order.tags !== null && order.queries !== null && order.trash !== null && order.tags < order.queries && order.queries < order.trash, 'after Tags and before Trash');
  await click(entry, 'Queries');
  await mustBeOn(page, 'Queries', 'its click opens `queries`');
  assert.equal(await entry.getAttribute('aria-current'), 'page', 'aria-current="page" on `queries`');
  assert.equal(await textOf(heading(page)), 'Queries', 'h1 Queries');
  assert.ok((await textOf(main(page))).includes('11 queries'), '`11 queries`');
  await must(findField(page), 'searchbox `Find a query…`');
  assert.ok((await textOf(sortButton(page))).includes('Created ↓'), 'sort button `Created ↓`');
  await must(newQueryButton(page), 'button `New query`');
  await must(queriesTable(page), 'table `Queries`');
  assert.deepEqual(await rowNamesAre(page, CREATED_DESC), CREATED_DESC, 'the eleven queries, Created ↓, Nečitelný last');
  const rows = await queryRows(page);
  assert.equal(rows.find((r) => r.name === Q.broken)?.state, 'unreadable', 'Nečitelný: data-query-state="unreadable"');
  assert.ok(rows.find((r) => r.name === Q.broken)?.text.includes('Can\'t be read'), 'Nečitelný reads `Can\'t be read`');
  assert.equal(rows.find((r) => r.name === Q.newer)?.state, 'newer', 'Novější verze: newer');
  assert.ok(!rows.some((r) => r.name === Q.old), 'Starý dotaz (trash) isn\'t listed');
  const hs = await queriesTable(page).getByRole('columnheader').allInnerTexts();
  assert.deepEqual(hs.map((h) => h.replace(/[↑↓\s]+$/, '').trim()).slice(0, 3), ['Query', 'Created', 'Updated'], 'columns Query, Created, Updated, ⋯');
  const f = await focusName(page);
  assert.equal(f.name, 'Queries', 'the focus moves to the heading (D-130)');
  await page.goBack().catch(() => {});
  await runCommand(page, 'Go to Queries');
  await mustBeOn(page, 'Queries', '`Go to Queries`');
  assert.deepEqual(await queryWrites(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-2

test('fr_qry_06_ac2_find_and_sort_queries', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await must(queriesTable(page), 'table `Queries`', 8000);
  const find = await must(findField(page), 'Find');
  await find.fill('ukoly');
  assert.deepEqual((await eventually(() => queryRows(page), (r) => r.length === 4)).map((r) => r.name).sort(), [Q.open, Q.table, Q.cancelled, Q.overdue].sort(), '`ukoly`: the four titles with `úkoly`');
  await find.fill('TÉTO');
  assert.deepEqual((await eventually(() => queryRows(page), (r) => r.length === 2)).map((r) => r.name).sort(), [Q.open, Q.table].sort(), '`TÉTO`: the two with `této`');
  await find.fill('');
  await click(queriesTable(page).getByRole('columnheader', { name: /Updated/ }), 'header Updated');
  // The fixture's `modified:` values: 11-02, 11-01, 10-19, 10-15, 10-09, 10-07, 10-02, 08-12, 08-01, 07-01; Nečitelný last.
  const byModified = [Q.open, Q.today, Q.all, Q.running, Q.cancelled, Q.table, Q.books, Q.overdue, Q.comments, Q.newer, Q.broken];
  assert.deepEqual(await rowNamesAre(page, byModified), byModified, 'Updated: `modified` descending, the unreadable last');
  assert.equal(await queriesTable(page).getByRole('columnheader', { name: /Updated/ }).getAttribute('aria-sort'), 'descending', 'aria-sort');
  await click(queriesTable(page).getByRole('columnheader', { name: /Updated/ }), 'header Updated again');
  const asc = [...byModified.slice(0, 10)].reverse().concat(Q.broken);
  assert.deepEqual(await rowNamesAre(page, asc), asc, 'again: ascending');
  await click(sortButton(page), 'the sort button');
  await click(page.getByRole('menuitem', { name: /Title A–Z/ }), '`Title A–Z`');
  const coll = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });
  const byTitle = (CREATED_DESC as string[]).filter((n) => n !== Q.broken).sort(coll.compare).concat(Q.broken);
  assert.deepEqual(await rowNamesAre(page, byTitle), byTitle, '`Title A–Z` with cs collation');
  const st = await eventually(() => core.uiState(), (s) => (s as any)?.queries?.sort === 'title');
  assert.equal((st as any)?.queries?.sort, 'title', 'the sort is machine-local UI state (`queries.sort`)');
  assert.deepEqual(await queryWrites(core), [], 'no vault write');
});

test('fr_qry_06_ac2_find_and_sort_queries_en_us_and_relaunch', async ({ page }) => {
  await startQueries(page, { route: 'queries', region: 'en-US', sort: 'title' });
  await must(queriesTable(page), 'table `Queries`', 8000);
  const coll = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
  const byTitle = (CREATED_DESC as string[]).filter((n) => n !== Q.broken).sort(coll.compare).concat(Q.broken);
  assert.deepEqual(await rowNamesAre(page, byTitle), byTitle, '(C) en-US collation; the stored `title` sort survives a relaunch');
  assert.ok((await textOf(sortButton(page))).includes('Title A–Z'), 'the sort button reads `Title A–Z`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-3

test('fr_qry_06_ac3_new_query_creates_one_file', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await click(newQueryButton(page), '`New query`');
  await must(newQueryDialog(page), 'dialog `New query`');
  assert.equal((await focusName(page)).name, 'Query name', '`Query name` focused');
  for (const taken of ['projekty v běhu', NFD('Projekty v běhu')]) {
    await (await must(nameField(page), 'Query name')).fill(taken);
    await click(newQueryDialog(page).getByRole('button', { name: /^⟦?Create⟧?$/ }), 'Create');
    assert.ok(await seen(newQueryDialog(page).getByText('A query with this name already exists.'), 2000), `${JSON.stringify(taken)}: the name is taken`);
  }
  await (await must(nameField(page), 'Query name')).fill('   ');
  assert.ok(await isDisabled(newQueryDialog(page).getByRole('button', { name: /^⟦?Create⟧?$/ })), 'a blank name can\'t be created');
  assert.deepEqual(await queryWrites(core), [], 'nothing created so far');
  await (await must(nameField(page), 'Query name')).fill('Úkoly na víkend');
  await click(newQueryDialog(page).getByRole('button', { name: /^⟦?Create⟧?$/ }), 'Create');
  await mustBeOn(page, 'Úkoly na víkend', 'opens `query/Úkoly na víkend`');
  await must(editor(page), 'with the editor open');
  assert.equal(await queryFileText(core, 'Úkoly na víkend'), expectedFile('created.yml'), 'byte-identical to expected/created.yml');
  assert.deepEqual(await queryWrites(core), [qfile('Úkoly na víkend')], 'one write');
  assert.equal((await core.queryCalls()).filter((c) => c.cmd === 'query_create')[0]?.args?.free, false, 'the dialog creates with `free: false` (D-1477)');
  // From the palette, with a D-52 name.
  await page.keyboard.press('Escape');
  await runCommand(page, 'New query…');
  await (await must(nameField(page), 'Query name')).fill('A/B: plán?');
  await click(newQueryDialog(page).getByRole('button', { name: /^⟦?Create⟧?$/ }), 'Create');
  assert.equal(await eventually(() => queryFileText(core, 'A B plán'), (t) => t !== undefined), expectedFile('created-a-b-plan.yml'), '`A/B: plán?` → A B plán.yml, title quoted');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-4, FR-QRY-03 AC-4

test('fr_qry_06_ac4_query_page', async ({ page }) => {
  await startQueries(page, { route: 'queries' });
  await (await must(findField(page), 'Find', 8000)).fill('běhu');
  await click(queryRow(page, Q.running), 'row Projekty v běhu');
  await mustBeOn(page, Q.running, 'the row opens `query/Projekty v běhu`');
  assert.ok((await textOf(backLink(page))).includes('All queries'), '`‹ All queries`');
  assert.equal(await textOf(heading(page)), Q.running, 'h1 the title');
  assert.ok((await textOf(main(page))).includes('Created 30 Sep 2026') || /Created .*2026/.test(await textOf(main(page))), '`Created <2026-09-30>` (D-781)');
  await must(editQueryButton(page), '`Edit query`');
  await must(pageMenuButton(page), '`⋯` (Query actions)');
  const b = block(page, Q.running);
  assert.deepEqual(await resultsAre(b, [P.cesta, P.cajovna, P.maly, P.lisabon]), [P.cesta, P.cajovna, P.maly, P.lisabon], 'its four results as a table (R146)');
  assert.ok(await seen(b.locator('table'), 1000), 'Table view');
  await must(usageChip(page, P.prehled), '`Used on` Přehled');
  await click(backLink(page), '‹ All queries');
  await mustBeOn(page, 'Queries', 'back to `queries`');
  assert.equal(await findField(page).inputValue(), 'běhu', 'with the previous find text');
});

test('fr_qry_03_ac4_query_page_without_host', async ({ page }) => {
  await startQueries(page, { route: queryRoute(Q.open) });
  await must(needsPage(page), 'the needs-page state (section[data-query-state="needsHost"])', 8000);
  const t = await textOf(needsPage(page));
  assert.ok(t.includes('Results show only on the page that uses this query'), 'its heading');
  assert.ok(t.includes('Its filters depend on that page (for example'), 'its body');
  assert.equal(await main(page).locator('[data-query-result]').count(), 0, 'no result rows');
  for (const p of [P.porada7, P.porada14, P.sablona]) await must(usageChip(page, p), `Used on: ${p}`);
  assert.ok((await textOf(usageChip(page, P.sablona))).includes('Template'), 'Šablona marked `Template`');
  const chips = await usedOn(page).locator('a[data-usage]').evaluateAll((as) => as.map((a) => a.getAttribute('data-usage')?.normalize('NFC')));
  assert.deepEqual(chips, [P.porada7, P.porada14, P.sablona], 'notes then templates, title-sorted');
  await page.evaluate((r) => { (window as any).__TEGG_ROUTE__ = r; }, queryRoute(Q.running));
  await runCommand(page, 'Go to Queries');
  await click(queryRow(page, Q.running), 'row Projekty v běhu');
  assert.deepEqual(await resultsAre(block(page, Q.running), [P.cesta, P.cajovna, P.maly, P.lisabon]), [P.cesta, P.cajovna, P.maly, P.lisabon], 'query/Projekty v běhu: four results');
  await must(usageChip(page, P.prehled), 'Used on Přehled');
});

test('fr_tpl_04_ac2_templates_are_usages_not_results', async ({ page }) => {
  await startQueries(page, { route: queryRoute(Q.open) });
  const chip = await must(usageChip(page, P.sablona), 'Used on: Šablona', 8000);
  assert.ok((await textOf(chip)).includes('Template'), 'listed as `Template`');
  assert.equal(await main(page).locator(`[data-query-result="${P.sablona}"]`).count(), 0, 'never a result');
  await click(chip, 'the Šablona chip');
  const b = block(page, Q.open);
  assert.equal((await blockInfo(b)).state, 'noResults', 'opening it shows its block with no results (it links nothing)');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-5

test('fr_qry_06_ac5_edits_apply_to_every_usage', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b7 = block(page, Q.open);
  await mustResults(b7, [P.t1, P.t2, P.t3], 'precondition', 5000);
  await runCommand(page, 'Go to Queries');
  await click(queryRow(page, Q.open), 'row Otevřené úkoly');
  await click(editQueryButton(page), '`Edit query`');
  await must(editor(page), 'the editor');
  assert.ok((await textOf(editor(page))).includes('Used on 3 notes. Changes apply everywhere.'), '`Used on 3 notes. Changes apply everywhere.`');
  await click(editorButton(page, 'Remove group'), '`Remove group`');
  await click(editorButton(page, 'Done'), 'Done');
  assert.deepEqual(await eventually(() => queryWrites(core), (w) => w.length === 1), [qfile(Q.open)], 'one write of the query file');
  await page.goBack();
  await page.goBack();
  assert.deepEqual(await resultsAre(block(page, Q.open), [P.t1, P.t2, P.t3, P.t4], 1000), [P.t1, P.t2, P.t3, P.t4], 'Porada 7 then lists T1, T2, T3, T4 within 1 s');
  assert.deepEqual(await noteWrites(core), [], 'no note written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-6

test('fr_qry_06_ac6_rename_patches_usages_and_pins', async ({ page }) => {
  const pins = '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n  - query: Otevřené úkoly z této schůzky\n';
  const vault = queriesVault((f) => { f[PINS] = pins; });
  const core = await startQueries(page, { route: 'queries', vault });
  const before = await core.files();
  const menu = await rowMenu(page, Q.open);
  await click(menuItem(menu, 'Rename…'), 'Rename…');
  const dlg = await must(renameDialog(page), 'dialog `Rename query`');
  // A taken name is refused before the job.
  await dlg.getByRole('textbox').fill('Projekty v běhu');
  await dlg.getByRole('button', { name: /^⟦?(Rename|Create)⟧?$/ }).first().click();
  assert.ok(await seen(dlg.getByText('A query with this name already exists.'), 2000), 'a taken name: refused');
  assert.equal((await core.jobs()).length, 0, 'no job ran');
  await dlg.getByRole('textbox').fill('Otevřené úkoly porady');
  await dlg.getByRole('button', { name: /^⟦?(Rename|Create)⟧?$/ }).first().click();
  const jobs = await eventually(() => core.jobs(), (j) => j.length === 1 && j[0].phase === 'done', 5000);
  assert.equal(jobs[0]?.kind, 'query-rename', 'one `query-rename` job');
  const after = await core.files();
  assert.equal(after[qfile(Q.open)], undefined, 'the old file is gone');
  assert.equal(after[qfile('Otevřené úkoly porady')], expectedFile('renamed-otevrene-ukoly-porady.yml'), 'renamed, only `title:` patched');
  for (const p of [P.porada7, P.porada14, P.sablona]) assert.equal(after[p], before[p].replace(`saved: ${Q.open}`, 'saved: Otevřené úkoly porady'), `${p}: only its \`saved:\` line`);
  assert.equal(after[PINS], pins.replace(`query: ${Q.open}`, 'query: Otevřené úkoly porady'), 'pinned.yml: only its `query:` line (FR-HOM-02 AC-30)');
  const touched = Object.keys(after).filter((p) => after[p] !== before[p]).sort();
  assert.deepEqual(touched, [qfile('Otevřené úkoly porady'), PINS, P.porada7, P.porada14, P.sablona].sort(), 'no other vault file changes');
  assert.ok((await core.backups()).some((b) => b.kind === 'query-rename'), 'the job made its backup (FR-HIS-04)');
  await page.keyboard.press('Meta+z');
  const undone = await eventually(() => core.files(), (f) => f[qfile(Q.open)] !== undefined, 5000);
  for (const p of Object.keys(before)) assert.equal(undone[p], before[p], `Undo restores ${p}`);
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-7

test('fr_qry_06_ac7_trash_keeps_blocks', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  const bytes = (await core.files())[qfile(Q.running)];
  const prehled = (await core.files())[P.prehled];
  await click(menuItem(await rowMenu(page, Q.running), 'Move to trash'), 'Move to trash');
  const moved = await eventually(() => core.files(), (f) => f['.trash/.tegg/queries/Projekty v běhu.yml'] !== undefined);
  assert.equal(moved['.trash/.tegg/queries/Projekty v běhu.yml'], bytes, 'moved to .trash/.tegg/queries/ with the same bytes');
  assert.equal(moved[qfile(Q.running)], undefined, 'gone from .tegg/queries/');
  await must(undoToast(page), 'an Undo toast');
  assert.ok((await textOf(main(page))).includes('10 queries'), 'count 10');
  assert.equal(await queryRow(page, Q.running).count(), 0, 'its row is gone');
  await click(undoToast(page), 'Undo');
  assert.equal(await eventually(() => queryFileText(core, Q.running), (t) => t === bytes), bytes, 'Undo moves it back with the same bytes');
  await click(menuItem(await rowMenu(page, Q.running), 'Move to trash'), 'Move to trash again');
  await eventually(() => queryFileText(core, Q.running), (t) => t === undefined);
  // Přehled's block: in the trash, with Restore; the fence isn't changed.
  await openNote(page, 'Přehled dotazů');
  const trashed = await must(blockByMessage(page, 'The query “Projekty v běhu” is in the trash.'), 'Přehled: `The query “Projekty v běhu” is in the trash.`', 3000);
  assert.equal((await core.files())[P.prehled], prehled, 'the fence isn\'t changed: trashing writes no note');
  await click(trashed.getByRole('button', { name: /^⟦?Restore⟧?$/ }), 'Restore in the block');
  assert.equal(await eventually(() => queryFileText(core, Q.running), (t) => t === bytes, 1000), bytes, 'restored with the same bytes');
  assert.deepEqual(await resultsAre(block(page, Q.running), [P.cesta, P.cajovna, P.maly, P.lisabon], 1000), [P.cesta, P.cajovna, P.maly, P.lisabon], 'results again within 1 s');
  // The Trash view lists it as `Projekty v běhu` · `Query`; Restore there; deleting it for good leaves the block `not found`.
  await runCommand(page, 'Go to Queries');
  await click(menuItem(await rowMenu(page, Q.running), 'Move to trash'), 'Move to trash a third time');
  await runCommand(page, 'Go to Trash');
  const row = await must(trashRow(page, Q.running), 'Trash row Projekty v běhu', 3000);
  assert.ok((await textOf(row)).includes('Query'), 'kind label `Query`');
  await row.click();
  await page.keyboard.press('Meta+Backspace');
  await click(page.getByRole('button', { name: /^⟦?Delete( permanently)?⟧?$/ }).last(), 'confirm the permanent delete');
  await eventually(() => core.files(), (f) => f['.trash/.tegg/queries/Projekty v běhu.yml'] === undefined);
  await openNote(page, 'Přehled dotazů');
  await must(blockByMessage(page, 'The query “Projekty v běhu” doesn\'t exist.'), 'then `not found`', 3000);
  assert.equal((await core.files())[P.prehled], prehled, 'Přehled untouched throughout');
  assert.deepEqual(await noteWrites(core), [], 'no note written');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-8

test('fr_qry_06_ac8_duplicate_query', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await click(menuItem(await rowMenu(page, Q.running), 'Duplicate'), 'Duplicate');
  await mustBeOn(page, 'Projekty v běhu (2)', 'opens the copy\'s query page');
  assert.equal(await queryFileText(core, 'Projekty v běhu (2)'), expectedFile('duplicate-projekty-v-behu-2.yml'), 'same bytes except title, created, modified');
  assert.ok((await textOf(main(page))).includes('Not used in any note yet.'), 'its `Used on` is empty');
  assert.deepEqual(await queryWrites(core), [qfile('Projekty v běhu (2)')], 'one write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-20

test('fr_qry_06_ac20_query_actions_by_keyboard', async ({ page }) => {
  await startQueries(page, { route: 'queries' });
  const row = await must(queryRow(page, Q.running), 'row Projekty v běhu', 8000);
  await row.focus();
  await page.keyboard.press('Shift+F10');
  const menu = await must(actionsMenu(page), 'menu `Query actions` (⇧F10)');
  assert.deepEqual(await menuItems(menu), ['Pin to sidebar', 'Rename…', 'Duplicate', 'Move to trash'], 'Pin to sidebar, Rename…, Duplicate, Move to trash');
  await page.keyboard.press('ArrowDown');
  const f1 = await focusName(page);
  await page.keyboard.press('ArrowDown');
  const f2 = await focusName(page);
  assert.notEqual(f1.name, f2.name, '↓ moves through the items');
  await page.keyboard.press('Escape');
  assert.ok(await absent(actionsMenu(page), 1000), 'Esc closes it');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('data-query-row')?.normalize('NFC')), Q.running, 'the focus returns to the row');
  // The unreadable row's menu has only `Move to trash`.
  await (await must(queryRow(page, Q.broken), 'row Nečitelný')).focus();
  await page.keyboard.press('Shift+F10');
  assert.deepEqual(await menuItems(await must(actionsMenu(page), 'menu')), ['Move to trash'], 'an unreadable file: Move to trash only');
  await page.keyboard.press('Escape');
  // The same menu from `⋯` on the query page; ⏎ on a row opens it.
  await (await must(queryRow(page, Q.running), 'row')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, Q.running, '⏎ on a row opens its page');
  await click(pageMenuButton(page), 'the page\'s ⋯');
  assert.deepEqual(await menuItems(await must(actionsMenu(page), 'menu')), ['Pin to sidebar', 'Rename…', 'Duplicate', 'Move to trash'], 'the page\'s ⋯: the same menu');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-9

test('fr_fmt_12_ac9_query_names_are_nfc', async ({ page }) => {
  const vault = queriesVault((f) => {
    // A copy of Projekty v běhu whose file name is NFD is the same name: listed once.
    f[`.tegg/queries/${NFD('Projekty v běhu')}.yml`] = f[qfile(Q.running)];
    f['Pages/NFD.md'] = `---\ntype: page\ntitle: NFD\n---\n\`\`\`query\nsaved: ${NFD('Projekty v běhu')}\n\`\`\`\n`;
  });
  const core = await startQueries(page, { route: 'queries', vault });
  await must(queriesTable(page), 'table', 8000);
  const names = (await queryRows(page)).map((r) => r.name);
  assert.equal(names.filter((n) => n === Q.running).length, 1, 'listed once, as NFC');
  await openNote(page, 'NFD');
  assert.deepEqual(await resultsAre(block(page, Q.running), [P.cesta, P.cajovna, P.maly, P.lisabon], 5000), [P.cesta, P.cajovna, P.maly, P.lisabon], 'an NFD `saved:` line resolves');
  // New query writes NFC names.
  const seeded = Object.keys(await core.files()).filter((p) => p !== p.normalize('NFC'));
  await runCommand(page, 'New query…');
  await (await must(nameField(page), 'Query name')).fill(NFD('Čtení na víkend'));
  await click(newQueryDialog(page).getByRole('button', { name: /^⟦?Create⟧?$/ }), 'Create');
  assert.ok(await eventually(() => core.files(), (f) => f[qfile('Čtení na víkend')] !== undefined), 'the file name is NFC');
  // The only NFD path is the copy this test seeded.
  assert.deepEqual(Object.keys(await core.files()).filter((p) => p !== p.normalize('NFC')), seeded, 'no NFD path written');
});
// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-28…AC-31

test('fr_hom_02_ac28_pin_a_query', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await click(menuItem(await rowMenu(page, Q.running), 'Pin to sidebar'), 'Pin to sidebar');
  const text = await eventually(() => core.files().then((f) => f[PINS]), (t) => t !== undefined);
  assert.ok(text?.endsWith('  - query: Projekty v běhu\n'), '`  - query: Projekty v běhu` appended to .tegg/pinned.yml');
  assert.deepEqual((await core.writesTo()).filter((p) => p === PINS).length, 1, 'one write');
  const row = await must(pinnedRow(page, Q.running), 'a Pinned row `Projekty v běhu`');
  assert.equal(await row.locator('[data-icon]').first().getAttribute('data-icon'), 'query', 'the funnel icon');
  assert.equal(await description(row), 'Query', 'description `Query`');
  await click(row, 'the pinned row');
  await mustBeOn(page, Q.running, 'it opens `query/Projekty v běhu`');
  await click(pageMenuButton(page), 'the page\'s ⋯');
  assert.ok((await menuItems(await must(actionsMenu(page), 'menu'))).includes('Unpin from sidebar'), 'the menus then show `Unpin from sidebar`');
});

test('fr_hom_02_ac29_query_pins_resolve_by_name', async ({ page }) => {
  const pins = '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n  - query: Otevřené úkoly tento týden\n  - query: projekty V BĚHU\n';
  const core = await startQueries(page, { route: 'inbox', vault: queriesVault((f) => { f[PINS] = pins; }) });
  const missing = await must(pinnedRow(page, 'Otevřené úkoly tento týden'), 'the reserved item is drawn', 8000);
  assert.equal(await missing.getAttribute('data-pin-state'), 'missing', 'as `Not found`');
  const ok = await must(pinnedRow(page, Q.running), '`projekty V BĚHU` resolves to Projekty v běhu');
  assert.equal(await ok.getAttribute('data-pin-state'), 'ok', 'a normal row');
  await core.setFile(qfile('Otevřené úkoly tento týden'), queryText({ title: 'Otevřené úkoly tento týden', types: ['task'] }));
  assert.equal(await eventually(() => missing.getAttribute('data-pin-state'), (s) => s === 'ok', 2000), 'ok', 'a created file makes it normal within 2 s');
  assert.equal((await core.writesTo()).filter((p) => p === PINS).length, 0, 'no pins write');
});

test('fr_hom_02_ac30_query_pins_follow_rename_and_trash', async ({ page }) => {
  const pins = '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n  - query: Projekty v běhu\n';
  const core = await startQueries(page, { route: 'queries', vault: queriesVault((f) => { f[PINS] = pins; }) });
  await must(pinnedRow(page, Q.running), 'the pinned query', 8000);
  await click(menuItem(await rowMenu(page, Q.running), 'Move to trash'), 'Move to trash');
  const row = pinnedSection(page).locator('[data-pinned-row]').first();
  assert.equal(await eventually(() => row.getAttribute('data-pin-state'), (s) => s === 'trashed'), 'trashed', 'the pin stays with `In the trash`');
  assert.equal((await core.files())[PINS], pins, 'trashing writes no pins');
  await click(row, 'the trashed pin');
  await mustBeOn(page, 'Trash', 'it opens `trash`');
  await page.goBack();
  await page.keyboard.press('Meta+z').catch(() => {});
  await click(undoToast(page), 'Undo').catch(() => {});
  assert.equal(await eventually(() => row.getAttribute('data-pin-state'), (s) => s === 'ok'), 'ok', 'restoring makes it normal');
  await click(menuItem(await rowMenu(page, Q.running), 'Rename…'), 'Rename…');
  const dlg = await must(renameDialog(page), 'Rename query');
  await dlg.getByRole('textbox').fill('Běžící projekty');
  await dlg.getByRole('button', { name: /^⟦?(Rename|Create)⟧?$/ }).first().click();
  assert.equal(await eventually(() => core.files().then((f) => f[PINS]), (t) => t !== pins, 5000), pins.replace('query: Projekty v běhu', 'query: Běžící projekty'), 'the rename patches only its `query:` line');
});

test('fr_hom_02_ac31_drag_a_query_to_pin', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  const row = await must(queryRow(page, Q.running), 'row Projekty v běhu', 8000);
  const target = await must(pinnedSection(page), 'the Pinned section');
  const a = await row.boundingBox();
  const b = await target.boundingBox();
  assert.ok(a && b, 'both have boxes');
  await page.mouse.move(a!.x + 40, a!.y + a!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a!.x + 40 + ((b!.x + b!.width / 2 - a!.x - 40) * i) / 12, a!.y + ((b!.y + b!.height / 2 - a!.y) * i) / 12);
  await sleep(50);
  await page.mouse.up();
  const text = await eventually(() => core.files().then((f) => f[PINS]), (t) => !!t && t.includes('query: Projekty v běhu'), 2000);
  assert.ok(text?.includes('  - query: Projekty v běhu'), 'pinned at the drop line');
  assert.equal((await core.writesTo()).filter((p) => p === PINS).length, 1, 'one write');
});

