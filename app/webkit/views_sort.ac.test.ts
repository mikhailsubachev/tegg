// Slice Q2, L5 (WebKit + fake core): multi-level sort, group by and the editor of docs/acceptance/views.md R185, R188,
// R189: FR-QRY-01 AC-8 (the order, cs and en-US; broken lists), AC-9 (the sort popover, one write per change), AC-10 (the
// file shapes of `sort`), AC-11 (header click and ⇧-click), AC-12 (the editor for a view), AC-13 (what `Group by` offers)
// and FR-QRY-05 AC-23 (column widths per query, shared by a tab and its blocks). Interface docs/contracts/v1-views.md §2,
// §4.3, §4.4, §4.7. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CTENI, P26_ROWS, Q, block, bookWithViews, click, description, drag, editor, eventually, expectedView, fileText, fileWhen, main, menuItem, must, openNote,
  original, panelHeaders, panelOf, panelRowsAre, qfile, queryRoute, rx, runCommand, seen, selectTab, sleep, sortButton, sortDialog, sortLevels, startViews,
  swap, tab, textOf, toolbar, toolbarMenuButton, typeRoute, uiState, uiWrites, viewMenu, viewQuery, viewsVault, writes, BOOK_YML, near,
} from './views-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const VYB_ROWS = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu'];
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const header = (scope: Locator, name: string) => scope.getByRole('columnheader', { name: new RegExp(`^⟦?${name}`) });
async function openP26(page: Page) {
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  assert.deepEqual(await panelRowsAre(page, P26_ROWS, 5000), P26_ROWS, 'precondition: R193\'s order');
}
async function openSort(page: Page, scope: Locator): Promise<Locator> {
  await click(sortButton(scope), 'the sort button');
  return must(sortDialog(page), 'dialog `Sort`');
}
/** The popover's rows as `aria-label`s. */
const levelLabels = (page: Page) => sortLevels(page).evaluateAll((ls) => ls.map((l) => (l.getAttribute('aria-label') ?? '').normalize('NFC')));

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-8

test('fr_qry_01_ac8_multi_level_order', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  await openP26(page);
  assert.deepEqual((await panelHeaders(page)).map(flat), ['Title ↑³', 'Author', 'Rating ↑²', 'Finished ↓¹'], 'headers Title ↑³, Author, Rating ↑², Finished ↓¹ (R193)');
});

test('fr_qry_01_ac8_multi_level_order_en_us', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), region: 'en-US' });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  const want = ['Mapa bez severu', 'Sto zimních dní', 'Čarovná mapa', 'Cizí přístavy', 'Šest cest k moři', 'Kniha o čaji', 'Tiché město', 'Zahrada v dešti'];
  assert.deepEqual(await panelRowsAre(page, want, 5000), want, '(C) en-US: Čarovná mapa before Cizí přístavy');
});

test('fr_qry_01_ac8_multi_level_order_broken_lists', async ({ page }) => {
  const missing = viewQuery({ title: 'Bez pořadí', view: 'table', columns: ['finished'], sort: '\n  - { by: finished, order: desc }\n  - { by: title }' });
  const scalar = viewQuery({ title: 'Skalár', view: 'table', columns: ['finished'], sort: '\n  - { by: finished, order: desc }\n  - title' });
  const vault = viewsVault((f) => {
    f[qfile('Bez pořadí')] = missing;
    f[qfile('Skalár')] = scalar;
    f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Bez pořadí, Skalár]\n');
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, 'Bez pořadí'), 'tab Bez pořadí', 8000);
  await selectTab(page, 'Bez pořadí');
  assert.deepEqual((await panelHeaders(page)).map(flat).filter((h) => /[↑↓]/.test(h)), ['Title ↑²', 'Finished ↓¹'], 'a missing `order` reads as asc');
  await selectTab(page, 'Skalár');
  assert.ok(await seen(panelOf(page).getByText('The setting sort can\'t be read, so its default is used.'), 3000), 'a scalar item: the sort notice');
  assert.equal(await fileText(core, qfile('Skalár')), scalar, 'the file isn\'t rewritten');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-9

test('fr_qry_01_ac9_sort_popover_writes_each_change_once', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await openP26(page);
  const dlg = await openSort(page, toolbar(page));
  assert.equal(await sortButton(toolbar(page)).getAttribute('aria-haspopup'), 'dialog', 'the sort button opens a dialog');
  assert.deepEqual(await levelLabels(page), ['Sort by Finished, Newest first', 'then by Rating, Excellent first', 'then by Title, A → Z'], 'three rows');
  for (const b of ['+ Add sort', 'Clear']) assert.ok(await seen(dlg.getByRole('button', { name: rx(b) }), 500), b);
  const level = (i: number) => sortLevels(page).nth(i);
  const pick = async (box: Locator, option: string) => { await click(box, 'combobox'); await click(page.getByRole('option', { name: rx(option) }).first(), option); };
  const steps: [string, () => Promise<void>, string][] = [
    ['(a) Rating: Bad first', () => pick(level(1).getByRole('combobox', { name: rx('Order') }), 'Bad first'), 'prectene-2026-sort-rating-desc.yml'],
    ['(b) Title row first', () => drag(page, level(2).getByRole('button', { name: rx('Drag to change the order') }), level(0), { at: 'left' }), 'prectene-2026-sort-title-first.yml'],
    ['(c) Remove two levels', async () => { await click(level(2).getByRole('button', { name: rx('Remove') }), 'Remove'); await sleep(200); await click(level(1).getByRole('button', { name: rx('Remove') }), 'Remove'); }, 'prectene-2026-sort-one-level.yml'],
    ['(d) + Add sort', () => click(dlg.getByRole('button', { name: rx('+ Add sort') }), '+ Add sort'), 'prectene-2026-sort-add-created.yml'],
    ['(e) Clear', () => click(dlg.getByRole('button', { name: rx('Clear') }), 'Clear'), 'prectene-2026-sort-cleared.yml'],
  ];
  let n = 0;
  for (const [what, act, exp] of steps) {
    const t0 = Date.now();
    await act();
    assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView(exp)), expectedView(exp), `${what}: the file`);
    n += what.startsWith('(c)') ? 2 : 1;
    assert.equal((await writes(core)).filter((p) => p === qfile(Q.p26)).length, n, `${what}: one write per change`);
    assert.ok(Date.now() - t0 < 3000, `${what}: in time`);
  }
  assert.deepEqual(await levelLabels(page), ['Sort by Modified, Newest first'], '(e) one level shown');
  // The column combobox never offers a column used at another level.
  await click(dlg.getByRole('button', { name: rx('+ Add sort') }), '+ Add sort');
  await click(level(1).getByRole('combobox', { name: rx('then by') }), 'the column combobox');
  assert.equal(await page.getByRole('option', { name: rx('Modified') }).count(), 0, 'Modified (level 1) isn\'t offered at level 2');
  await page.keyboard.press('Escape');
  const w = (await writes(core)).length;
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.equal((await writes(core)).length, w, 'Esc closes and writes nothing more');
});

test('fr_qry_01_ac9_sort_popover_writes_each_change_once_in_a_block_and_on_the_query_page', async ({ page }) => {
  await startViews(page, { route: queryRoute(Q.p26) });
  await must(sortButton(main(page)), 'query/Přečtené 2026: the sort button', 8000);
  await openSort(page, main(page));
  assert.deepEqual(await levelLabels(page), ['Sort by Finished, Newest first', 'then by Rating, Excellent first', 'then by Title, A → Z'], 'query/<name>: the same rows');
  await page.keyboard.press('Escape');
  await openNote(page, 'Čtení 2026');
  const blk = block(page, Q.p26);
  const sb = await must(sortButton(blk), 'the block\'s sort button', 5000);
  assert.equal(flat(await textOf(sb.locator('span.sort-count'))), '3', 'an icon with `3`');
  await openSort(page, blk);
  assert.equal((await levelLabels(page)).length, 3, 'the block\'s popover');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-10

test('fr_qry_01_ac10_sort_file_shapes', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru, Podle autora, Seskupeno podle data]\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  // Opening, running and drawing every fixture query writes nothing.
  for (const n of [Q.roz, Q.p26, Q.vyb, Q.zanr, Q.autor, Q.datum]) { await must(tab(page, n), `tab ${n}`, 8000); await selectTab(page, n); await sleep(200); }
  assert.deepEqual(await writes(core), [], 'one-level files are never rewritten into a list');
  await selectTab(page, Q.vyb);
  assert.deepEqual(await panelRowsAre(page, VYB_ROWS, 3000), VYB_ROWS, 'Výborné knihy (R193)');
  await header(panelOf(page), 'Finished').click({ modifiers: ['Shift'] });
  assert.equal(await fileWhen(core, qfile(Q.vyb), (x) => x === expectedView('vyborne-knihy-sort-two-levels.yml')), expectedView('vyborne-knihy-sort-two-levels.yml'), '(a) the three lines in place of line 8');
  const dlg = await openSort(page, toolbar(page));
  await click(sortLevels(page).nth(1).getByRole('button', { name: rx('Remove') }), 'Remove Finished');
  assert.equal(await fileWhen(core, qfile(Q.vyb), (x) => x === expectedView('vyborne-knihy-sort-back-to-one.yml')), expectedView('vyborne-knihy-sort-back-to-one.yml'), '(b) back to one line: the fixture except modified');
  await page.keyboard.press('Escape');
  assert.ok(dlg, 'the popover was open');
  await selectTab(page, Q.zanr);
  await openSort(page, toolbar(page));
  await click(sortDialog(page).getByRole('button', { name: rx('+ Add sort') }), '+ Add sort');
  const z = await fileWhen(core, qfile(Q.zanr), (x) => x === expectedView('podle-zanru-sort-add-level.yml'));
  assert.equal(z, expectedView('podle-zanru-sort-add-level.yml'), '(c) `sort:   # jedna úroveň` and two items; comments and x-barva stay');
  assert.ok(z?.includes('version: 1\n'), '(d) version: 1 unchanged');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-11

test('fr_qry_01_ac11_header_click_and_shift_click', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await openP26(page);
  const p = panelOf(page);
  await click(header(p, 'Rating'), 'Rating');
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-click-rating.yml')), expectedView('prectene-2026-click-rating.yml'), '(a) `sort: { by: rating, order: asc }`');
  const a = ['Cizí přístavy', 'Čarovná mapa', 'Mapa bez severu', 'Sto zimních dní', 'Šest cest k moři', 'Tiché město', 'Kniha o čaji', 'Zahrada v dešti'];
  assert.deepEqual(await panelRowsAre(page, a), a, '(a) Excellent, Good, Bad; title inside');
  assert.deepEqual((await panelHeaders(page)).map(flat).filter((h) => /[↑↓]/.test(h)), ['Rating ↑'], '(a) headers `Rating ↑` only');
  await click(header(p, 'Rating'), 'Rating again');
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-click-rating-desc.yml')), expectedView('prectene-2026-click-rating-desc.yml'), '(b) flipped');
  await header(p, 'Finished').click({ modifiers: ['Shift'] });
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-shift-finished.yml')), expectedView('prectene-2026-shift-finished.yml'), '(c) Finished added as level 2');
  assert.equal(await header(p, 'Rating').getAttribute('aria-sort'), 'descending', 'aria-sort on the first level only');
  assert.equal(await header(p, 'Finished').getAttribute('aria-sort'), null, 'not on level 2');
  assert.equal(await description(header(p, 'Finished')), 'Sort level 2, ascending', 'level 2: its description');
  await header(p, 'Finished').click({ modifiers: ['Shift'] });
  assert.ok(await fileWhen(core, qfile(Q.p26), (x) => !!x && x.includes('  - { by: finished, order: desc }\n')), '(c) ⇧-click again flips it in place');
  await header(p, 'Author').focus();
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-click-author.yml')), expectedView('prectene-2026-click-author.yml'), '(d) ⏎ on Author: the only level, ascending');
  assert.equal((await writes(core)).filter((x) => x === qfile(Q.p26)).length, 5, 'each step is one write');
  await header(p, 'Rating').focus();
  await page.keyboard.press('Shift+Enter');
  assert.ok(await fileWhen(core, qfile(Q.p26), (x) => !!x && x.includes('  - { by: author, order: asc }\n  - { by: rating, order: asc }\n')), '⇧⏎ acts as ⇧-click');
  // On All Books ⇧-click acts as a plain click (one machine-local level).
  await click(main(page).locator('[role="tab"][data-view-tab=""]'), 'All Books');
  const n = (await writes(core)).length;
  await header(panelOf(page), 'Rating').click({ modifiers: ['Shift'] });
  await sleep(300);
  assert.equal((await writes(core)).length, n, 'All Books: no vault write');
  assert.equal((await panelHeaders(page)).filter((h) => /[↑↓]/.test(h)).length, 1, 'one level');
});

test('fr_qry_01_ac11_header_click_and_shift_click_block_follows', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await openP26(page);
  await click(header(panelOf(page), 'Rating'), 'Rating');
  await fileWhen(core, qfile(Q.p26), (x) => x === expectedView('prectene-2026-click-rating.yml'));
  await openNote(page, 'Čtení 2026');
  const blk = block(page, Q.p26);
  assert.ok(await eventually(async () => flat(await textOf(header(blk, 'Rating'))), (t) => t === 'Rating ↑', 1000), 'the block in Čtení follows within 1 s');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-12, AC-13

test('fr_qry_01_ac12_the_editor_for_a_view', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.roz), 'tab Rozečtené', 8000);
  await selectTab(page, Q.roz);
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  const e = await must(editor(page), 'Edit query');
  const t = flat(await textOf(e));
  assert.ok(t.includes('Used on the Books page and 1 note. Changes apply everywhere.'), 'the usage notice');
  assert.ok(t.includes('fixed: a view of the Books page'), 'the Show hint');
  assert.equal(await e.getByRole('button', { name: rx('Remove Book') }).count(), 0, 'no `Remove Book`');
  assert.equal(await e.getByRole('button', { name: rx('Type') }).count(), 0, 'no `Type` button');
  const view = e.getByRole('radiogroup', { name: rx('View') });
  assert.equal(await view.getByRole('radio', { name: rx('Board') }).getAttribute('aria-checked'), 'true', 'Board checked');
  const gb = e.getByRole('combobox', { name: rx('Group by') });
  assert.equal(flat(await gb.inputValue().catch(() => textOf(gb))), 'Status', '`Group by` Status');
  assert.equal(await description(gb), 'one lane per option', 'hint');
  assert.ok(await seen(e.getByRole('radiogroup', { name: rx('Lanes') }), 500), '`Lanes`');
  assert.ok(flat(await textOf(e.getByRole('group', { name: rx('On cards') }))).includes('Author, Rating'), '`On cards` Author, Rating');
  assert.equal(await e.getByText('Sort', { exact: true }).count(), 0, 'no Sort row');
  assert.equal(await e.getByRole('spinbutton', { name: rx('Limit') }).count() + await e.getByRole('textbox', { name: rx('Limit') }).count(), 0, 'no Limit with Board');
  await click(gb, 'Group by');
  await click(page.getByRole('option', { name: rx('Genres') }), 'Genres');
  await click(e.getByRole('button', { name: rx('Done') }), 'Done');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-group-by-genres.yml')), expectedView('rozectene-group-by-genres.yml'), 'only group_by and modified');
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  await click(editor(page).getByRole('radiogroup', { name: rx('View') }).getByRole('radio', { name: rx('Table') }), 'Table');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-view-table.yml')), expectedView('rozectene-view-table.yml'), 'only view: table and modified; group_by, lanes, lane_order stay');
  assert.equal((await writes(core)).filter((p) => p === qfile(Q.roz)).length, 2, 'one write per commit');
  // Opened from Čtení's block, Show is editable.
  await openNote(page, 'Čtení 2026');
  await click(block(page, Q.roz).getByRole('button', { name: rx('Edit query') }), 'the block\'s Edit query');
  assert.ok(await seen(editor(page).getByRole('button', { name: rx('Type') }), 2000), 'from a block: Show is editable');
});

test('fr_qry_01_ac13_group_by_choices', async ({ page }) => {
  const vault = viewsVault((f) => {
    f[qfile('Autoři tabule')] = viewQuery({ title: 'Autoři tabule', types: ['autor'], extra: ['group_by: tags'], columns: ['poznámka'] });
    f['.tegg/types/autor.yml'] = swap(f['.tegg/types/autor.yml'], 'preview: [poznámka]\n', 'preview: [poznámka]\nviews: [Autoři tabule]\n');
  });
  await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.roz), 'tab Rozečtené', 8000);
  await selectTab(page, Q.roz);
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  await click(editor(page).getByRole('combobox', { name: rx('Group by') }), 'Group by');
  const opts = (await page.getByRole('option').allInnerTexts()).map(flat);
  assert.deepEqual(opts, ['Author', 'Status', 'Rating', 'Genres', 'Tags'], 'Book: Author, Status, Rating, Genres, then Tags; no Finished');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to type: Autoři');
  await selectTab(page, 'Autoři tabule');
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  await click(editor(page).getByRole('combobox', { name: rx('Group by') }), 'Group by');
  assert.deepEqual((await page.getByRole('option').allInnerTexts()).map(flat), ['Tags'], 'Autor: only Tags');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-23

test('fr_qry_05_ac23_widths_per_query_shared_by_tab_and_blocks', async ({ page }) => {
  const vault = viewsVault((f) => { f['Pages/Druhá stránka.md'] = '---\ntype: page\ntitle: Druhá stránka\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\nDruhá.\n\n```query\nsaved: Přečtené 2026\n```\n'; });
  const core = await startViews(page, { route: `note/${CTENI}`, vault });
  const blk = block(page, Q.p26);
  const handle = blk.getByRole('separator', { name: rx('Resize Title') });
  await must(handle, 'the block\'s `Resize Title` handle', 8000);
  for (const n of ['Author', 'Rating', 'Finished']) assert.ok(await seen(blk.getByRole('separator', { name: rx(`Resize ${n}`) }), 500), `Resize ${n}`);
  const w0 = await uiWrites(core);
  const th = header(blk, 'Title');
  const start = (await th.boundingBox())!;
  await drag(page, handle, { dx: 200 - start.width, dy: 0 });
  assert.ok(near((await th.boundingBox())!.width, 200), 'Title 200 px in the block');
  const ui = await eventually(() => uiState(core), (u) => u?.queryColumnWidths?.[Q.p26]?.title === 200);
  assert.equal(ui?.queryColumnWidths?.[Q.p26]?.title, 200, 'queryColumnWidths["Přečtené 2026"].title = 200');
  assert.equal((await uiWrites(core)) - w0, 1, 'once on release');
  assert.deepEqual(await writes(core), [], 'no vault file changes');
  await openNote(page, 'Druhá stránka');
  assert.ok(near((await header(block(page, Q.p26), 'Title').boundingBox())!.width, 200), 'a second block of the query shows 200 px');
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.p26);
  assert.ok(near((await header(panelOf(page), 'Title').boundingBox())!.width, 200), 'the tab shows 200 px');
  await click(main(page).locator('[role="tab"][data-view-tab=""]'), 'All Books');
  assert.ok(!near((await header(panelOf(page), 'Title').boundingBox())!.width, 200), 'All Books keeps its own Title width');
  void original;
});
