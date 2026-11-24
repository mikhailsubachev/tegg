// Slice Q3, L5 (WebKit + fake core): grouped Tables and Lists (R225; boards H1, H2): group headers, only groups with
// rows, multi-value rows under each value, flat period groups, group order by header drags, folds per usage, sort inside
// groups, no `New <Type>` rows, Schedule as a Table, and the row-element bound of a grouped Table of 1,000 rows.
// docs/acceptance/views.md part five: FR-QRY-05 AC-39…AC-42, FR-QRY-01 AC-22, FR-QRY-08 AC-4, FR-TSK-04 AC-30,
// NFR-PERF-07 AC-8 (the DOM count). Interface docs/contracts/v1-views.md §41.5, §42.1, §43.1 (`__TEGG_TEST__.groups()`).
// Expected bytes tests/fixtures/queries-files/expected/views-display/. Fixture: the base tests/fixtures/vaults/views/,
// the overlay views-display/, or tasks + views-tasks/. Written from the ACs and the contract only (D-61). Lookups go
// through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, Q, ZOB, ZOB_ID, blockKey, block, click, displayButton, displayFile, displayVault, drag, eventually, expectedDisplay, expectedView, fileText, fileWhen, groupChevron,
  groupGrip, groupHeader, groupsHook, groupsIn, main, must, nfc, noteRoute, openGroup, groupChoice, panelOf, paths, queryRoute, qfile, selectTab, sleep, startViews, tab,
  tabKey, typeRoute, uiState, uiWrites, wallIn, writes, writtenPaths, pressed,
} from './views-display-helpers';
import { startTasksViews, TYPE_TASK, TASK_YML, overlayOriginal, paths as tpaths } from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const tabRoot = (page: Page) => panelOf(page);
const LUCIE = 'relation:Autoři/Lucie Horká.md';
const EVA = 'relation:Autoři/Eva Lindová.md';
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const groupsAre = (scope: Locator, ok: (g: { id: string; rows: string[]; folded: boolean }[]) => boolean, ms = 3000) => eventually(() => groupsIn(scope), ok, ms);
const shape = (g: { id: string; rows: string[] }[]) => g.map((x) => [x.id, x.rows]);

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-39

test('fr_qry_05_ac39_grouped_table', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await selectTab(page, Q.vyb);
  const want = [[LUCIE, paths(['Čarovná mapa'])], [EVA, paths(['Cizí přístavy', 'Mapa bez severu'])]];
  assert.deepEqual(shape(await groupsAre(tabRoot(page), (g) => g.length === 2)), want, 'R228: Lucie Horká 1, then Eva Lindová 2');
  const h = await must(groupHeader(tabRoot(page), LUCIE), 'the Lucie Horká header');
  assert.equal(await h.evaluate((e) => e.tagName), 'TR', 'a full-width header row');
  assert.equal(await h.locator('td, th').count(), 1, 'one cell spanning the columns');
  assert.equal(await h.locator('a.chip').count(), 1, 'the author\'s chip');
  assert.equal(flat(await groupChevron(tabRoot(page), LUCIE).getAttribute('aria-label')), 'Lucie Horká, 1 Book', 'the chevron button\'s name');
  assert.ok((await tabRoot(page).getByRole('columnheader', { name: /^⟦?Author/ }).count()) === 1, 'the Author column stays');
  // A click on Title sorts inside every group, one item write; the groups keep their order.
  await click(tabRoot(page).getByRole('columnheader', { name: /^⟦?Title/ }), 'Title');
  const sorted = await groupsAre(tabRoot(page), (g) => g[1]?.rows[0] === paths(['Mapa bez severu'])[0]);
  assert.deepEqual(shape(sorted), [[LUCIE, paths(['Čarovná mapa'])], [EVA, paths(['Mapa bez severu', 'Cizí přístavy'])]], 'Eva Lindová: Mapa bez severu, Cizí přístavy');
  assert.deepEqual(await eventually(() => writtenPaths(core), (w) => w.length === 1), [BOOK_YML], 'one item write');
  assert.equal(await tabRoot(page).getByRole('button', { name: /^⟦?New Book/ }).count() + await tabRoot(page).locator('tr[data-new-row], [data-command="board.newIn"]').count(), 0, 'no New Book row or tile');
  // Dragging a row onto another group's header moves nothing and writes nothing.
  const n = (await writtenPaths(core)).length;
  await drag(page, tabRoot(page).locator(`tr[data-query-result="${paths(['Čarovná mapa'])[0]}"]`), groupHeader(tabRoot(page), EVA));
  assert.equal((await writtenPaths(core)).length, n, 'a row drag writes nothing (D-2182)');
});

test('fr_qry_05_ac39_grouped_table_block_and_multi_value', async ({ page }) => {
  await startViews(page, { route: noteRoute(ZOB), vault: displayVault() });
  const b2 = block(page, Q.roz);
  await must(b2, 'block 2', 8000);
  assert.deepEqual(shape(await groupsAre(b2, (g) => g.length === 2)), [['option:To read', paths(['Dům u řeky', 'Kniha o horách'])], ['option:Reading', paths(['Noční vlak', 'Účetní ze Žižkova', 'Světla přístavu'])]],
    'Zobrazení block 2: no Read group (D-2184)');
  // The base tab Přečtené 2026 grouped by Genres: 10 rows for 8 books.
  await page.goto('about:blank');
  await startViews(page, { route: typeRoute('book') });
  await selectTab(page, Q.p26);
  await openGroup(page, tabRoot(page));
  await click(groupChoice(page, 'genres'), 'Genres');
  const g = await groupsAre(tabRoot(page), (x) => x.length === 5);
  assert.deepEqual(shape(g), [
    ['option:Román', paths(['Mapa bez severu', 'Sto zimních dní', 'Čarovná mapa'])], ['option:Detektivka', paths(['Tiché město'])], ['option:Poezie', paths(['Zahrada v dešti'])],
    ['option:Eseje', paths(['Sto zimních dní', 'Kniha o čaji'])], ['option:Cestopis', paths(['Cizí přístavy', 'Čarovná mapa', 'Šest cest k moři'])],
  ], 'R228: 10 rows, no No Genres group');
  const cells = await tabRoot(page).locator(`tr[data-query-result="${paths(['Sto zimních dní'])[0]}"]`).evaluateAll((rs) => rs.map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
  assert.equal(cells.length, 2, 'Sto zimních dní in two groups');
  assert.equal(cells[0], cells[1], 'with identical cells');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-40

test('fr_qry_05_ac40_grouped_list', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.zanr), 'tab', 8000);
  await selectTab(page, Q.zanr);
  const g = await groupsAre(tabRoot(page), (x) => x.length === 6);
  assert.deepEqual(g.map((x) => [x.id, x.rows.length]), [['option:Román', 6], ['option:Detektivka', 3], ['option:Poezie', 2], ['option:Eseje', 3], ['option:Cestopis', 5], ['none', 1]], 'R228\'s groups, 20 rows');
  assert.equal(await tabRoot(page).locator('div[role="group"][data-group-id] [data-query-result]').count(), 20, 'list rows inside group elements');
  await click(displayButton(tabRoot(page), 'wall'), 'Wall');
  const want = expectedDisplay('types/book-overlay-podle-zanru-wall.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, 'line 23 → view: wall; line 24 kept');
  assert.equal(await tabRoot(page).locator('div[data-board][data-wall][data-lanes="vertical"]').count(), 1, 'columns (lanes: vertical read as columns)');
  // List on Výborné knihy: chip headers; a book with two authors under both.
  const extra = '---\nid: 01JB5V00000000000000000043\ntype: book\ntitle: Dvě ruce\nauthor: ["[[Eva Lindová]]", "[[Tomáš Rybář]]"]\nrating: Excellent\nstatus: Read\nmodified: 2026-11-18T09:00:00+01:00\n---\n';
  await page.goto('about:blank');
  await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => { f['Books/Dvě ruce.md'] = extra; }) });
  await selectTab(page, Q.vyb);
  await click(displayButton(tabRoot(page), 'list'), 'List');
  const l = await groupsAre(tabRoot(page), (x) => x.some((y) => y.rows.includes(paths(['Dvě ruce'])[0])));
  assert.deepEqual(l.filter((x) => x.rows.includes(paths(['Dvě ruce'])[0])).map((x) => x.id), [EVA, 'relation:Autoři/Tomáš Rybář.md'], 'Dvě ruce under both authors');
  assert.ok((await groupHeader(tabRoot(page), EVA).locator('a.chip').count()) === 1, 'chip headers');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-41

test('fr_qry_05_ac41_period_groups_are_flat', async ({ page }) => {
  const nova = (title: string, id: string, finished: string) => `---\nid: ${id}\ntype: book\ntitle: ${title}\nauthor: "[[Eva Lindová]]"\nstatus: Read\nfinished: ${finished}\nmodified: 2026-11-18T09:00:00+01:00\n---\n`;
  await startViews(page, { route: noteRoute(ZOB), vault: displayVault() });
  const b3 = block(page, Q.datum);
  await must(b3, 'block 3', 8000);
  const g = await groupsAre(b3, (x) => x.length === 2);
  assert.deepEqual(g.map((x) => [x.id, x.rows.length]), [['period:today', 9], ['none', 8]], 'Today & earlier 9, No Finished 8');
  assert.equal(await b3.locator('div[role="group"][data-day]').count(), 0, 'no day groups');
  assert.equal(await b3.getByRole('heading', { name: /sobota 21\./ }).count(), 0, 'no heading `sobota 21.`');
  await page.goto('about:blank');
  await startViews(page, { route: noteRoute(ZOB), vault: displayVault((f) => { f['Books/Nová kniha.md'] = nova('Nová kniha', '01JB5V00000000000000000041', '2026-11-21'); f['Books/Pozdní kniha.md'] = nova('Pozdní kniha', '01JB5V00000000000000000042', '2026-12-05'); }) });
  const g2 = await groupsAre(block(page, Q.datum), (x) => x.length === 4);
  assert.deepEqual(g2.map((x) => [x.id, x.rows.length]), [['period:today', 9], ['period:week', 1], ['period:later', 1], ['none', 8]], 'This week 1, Later 1, flat');
  assert.equal(flat(await groupHeader(block(page, Q.datum), 'period:week').innerText()).startsWith('This week'), true, 'R203\'s label');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42

test('fr_qry_05_ac42_group_order_and_folds', async ({ page }) => {
  const core = await startViews(page, { route: noteRoute(ZOB), vault: displayVault() });
  const b2 = block(page, Q.roz);
  await must(b2, 'block 2', 8000);
  // (b) Folds: a click on Reading's header.
  const u0 = await uiWrites(core);
  await click(groupChevron(b2, 'option:Reading'), 'Reading\'s chevron');
  assert.equal(await groupChevron(b2, 'option:Reading').getAttribute('aria-expanded'), 'false', '(b) aria-expanded false');
  const folded = await groupsAre(b2, (x) => x.find((y) => y.id === 'option:Reading')?.rows.length === 0);
  assert.deepEqual(folded.map((x) => [x.id, x.rows.length, x.folded]), [['option:To read', 2, false], ['option:Reading', 0, true]], '(b) rows hidden, header and count kept');
  const key = blockKey(ZOB_ID, Q.roz, 1);
  const st = await eventually(() => uiState(core), (u) => !!u?.usageFolded?.[key]);
  assert.deepEqual(st?.usageFolded?.[key], ['option:Reading'], `(b) usageFolded["${key}"]`);
  assert.equal((await uiWrites(core)) - u0, 1, '(b) one ui_state_set');
  assert.deepEqual(await writes(core), [], '(b) no vault file');
  await groupChevron(b2, 'option:To read').click({ modifiers: ['Alt'] });
  assert.deepEqual((await groupsAre(b2, (x) => x.every((y) => y.folded))).map((x) => x.folded), [true, true], '⌥-click folds every group');
  await groupChevron(b2, 'option:To read').click({ modifiers: ['Alt'] });
  // (a) Header drags: Reading above To read.
  await drag(page, groupGrip(b2, 'option:Reading'), groupHeader(b2, 'option:To read'));
  const want = expectedDisplay('notes/zobrazeni-b2-lane-order-reading.md');
  assert.equal(await fileWhen(core, ZOB, (t) => t === want), want, '(a) line 21 → lane_order: [Reading, To read, Read]');
  assert.equal(await groupGrip(b2, 'none').count(), 0, '(a) no grip on No <attribute>');
});

test('fr_qry_05_ac42_group_order_and_folds_tab_and_page', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await selectTab(page, Q.vyb);
  await drag(page, groupGrip(tabRoot(page), EVA), groupHeader(tabRoot(page), LUCIE));
  const want = expectedDisplay('types/book-overlay-vyborne-lane-order-eva.yml');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t === want), want, '(a) the tab: line 20');
  const n = (await writtenPaths(core)).length;
  await drag(page, groupGrip(tabRoot(page), EVA), groupHeader(tabRoot(page), EVA));
  assert.equal((await writtenPaths(core)).length, n, '(a) a drop at its own place writes nothing');
  // query/Rozečtené as a Table: the same drag writes FR-QRY-05 AC-19's bytes.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: queryRoute(Q.roz) });
  await click(displayButton(main(page), 'table'), 'Table');
  await eventually(() => fileText(core2, qfile(Q.roz)), (t) => !!t?.includes('view: table'));
  await core2.setFile(qfile(Q.roz), (await fileText(core2, qfile(Q.roz)))!);
  await drag(page, groupGrip(main(page), 'option:To read'), groupHeader(main(page), 'option:Reading'));
  const lo = await fileWhen(core2, qfile(Q.roz), (t) => !!t?.includes('lane_order: [To read, Reading, Read]'));
  assert.ok(lo?.includes('lane_order: [To read, Reading, Read]\n'), 'the query file\'s lane order (rozectene-lane-order-to-read-first.yml\'s line)');
  void expectedView;
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-22

test('fr_qry_01_ac22_sort_inside_groups', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  await openGroup(page, tabRoot(page));
  await click(groupChoice(page, 'genres'), 'Genres');
  await groupsAre(tabRoot(page), (x) => x.length === 5);
  const n = (await writtenPaths(core)).length;
  await click(tabRoot(page).getByRole('columnheader', { name: /^⟦?Title/ }), 'Title');
  const g = await groupsAre(tabRoot(page), (x) => x[0]?.rows[0] === paths(['Čarovná mapa'])[0]);
  assert.deepEqual(g[0], { id: 'option:Román', rows: paths(['Čarovná mapa', 'Mapa bez severu', 'Sto zimních dní']), folded: false }, 'Román by title');
  assert.deepEqual(g.map((x) => x.id), ['option:Román', 'option:Detektivka', 'option:Poezie', 'option:Eseje', 'option:Cestopis'], 'the groups keep their order');
  assert.equal((await writtenPaths(core)).length - n, 1, 'one item write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-4

test('fr_qry_08_ac4_new_objects_by_display', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.vyb), 'tab', 8000);
  await selectTab(page, Q.vyb);
  await groupsAre(tabRoot(page), (x) => x.length === 2);
  assert.equal(await tabRoot(page).locator('[data-group-id] button, .group-header button').filter({ hasText: /New Book/ }).count(), 0, 'a grouped Table: no New Book in any group');
  await selectTab(page, Q.p26);
  assert.ok(await wallIn(tabRoot(page)).count() === 1, 'setup: an ungrouped wall');
  assert.equal(await tabRoot(page).locator('button[data-command="board.newIn"]').count(), 0, 'an ungrouped wall: no tile');
  await selectTab(page, Q.autor);
  assert.ok((await tabRoot(page).locator('button[data-command="board.newIn"]').count()) > 0, 'a grouped wall keeps New <Type> in <lane>');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-30

test('fr_tsk_04_ac30_schedule_is_a_wall_grouped_by_due_period', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  await must(tab(page, 'Schedule'), 'Schedule', 8000);
  await selectTab(page, 'Schedule');
  assert.equal(await pressed(tabRoot(page)), 'wall', '(1) Wall pressed');
  assert.equal(flat(await tabRoot(page).locator('button[data-command="group.open"] .group-text').first().innerText({ timeout: 2000 }).catch(() => '')), 'Due date · by period', '(1) Group reads Due date · by period');
  await click(displayButton(tabRoot(page), 'table'), '(2) Table');
  const want = expectedDisplay('types/task-schedule-view-table.yml');
  assert.equal(await fileWhen(core, TASK_YML, (t) => t === want), want, '(2) line 11 → the block list');
  assert.equal(await fileText(core, '.tegg/queries/Schedule.yml'), overlayOriginal('.tegg/queries/Schedule.yml'), '(2) Schedule.yml untouched');
  const g = await groupsAre(tabRoot(page), (x) => x.length === 5);
  assert.deepEqual(g.map((x) => [x.id, x.rows]), [
    ['period:today', tpaths('t01', 't02', 't03', 't14')], ['period:week', tpaths('t04', 't19', 't15', 't05')], ['period:later', tpaths('t06', 't07')],
    ['none', tpaths('t08', 't09', 't17', 't16', 't18')], ['done', []],
  ], '(3) R228\'s flat groups; Done folded');
  assert.equal(g[4].folded, true, '(3) Done folded (AP-2050)');
  assert.equal(await tabRoot(page).locator('div[role="group"][data-day]').count(), 0, '(3) no day sub-headings');
  await click(displayButton(tabRoot(page), 'wall'), '(4) Wall');
  assert.ok((await tabRoot(page).locator('div[role="group"][data-day]').count()) > 0, '(4) the day groups come back');
  void nfc;
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-07 AC-8 (DOM count)

test('nfr_perf_07_ac8_grouped_table_1000_rows', async ({ page }) => {
  const opts = ['Jedna', 'Dvě', 'Tři', 'Čtyři', 'Pět', 'Šest'];
  const typeFile = ['version: 1', 'name: Položka', 'plural: Položky', 'system: false', 'folder: Položky', 'icon: box', 'color: blue', 'review: false', 'preview: [stav]',
    'views: [Po stavech]', 'attributes:', '  - key: stav', '    name: Stav', '    type: select', '    options:', ...opts.map((o) => `      - { label: ${o}, color: gray }`), ''].join('\n');
  const query = ['version: 1', 'title: Po stavech', 'types: [polozka]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: table', 'group_by: stav', 'columns: [stav]',
    'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
  const vault = displayVault((f) => {
    f['.tegg/types/polozka.yml'] = typeFile;
    f['.tegg/queries/Po stavech.yml'] = query;
    for (let i = 0; i < 1000; i++) f[`Položky/Položka ${String(i).padStart(4, '0')}.md`] = `---\nid: 01JB5V0000000000000000${String(1000 + i).padStart(4, '0')}\ntype: polozka\ntitle: Položka ${String(i).padStart(4, '0')}\nstav: ${opts[i % 6]}\n---\n`;
  });
  await startViews(page, { route: typeRoute('polozka'), vault });
  await must(tab(page, 'Po stavech'), 'tab Po stavech', 15000);
  await selectTab(page, 'Po stavech');
  const probe = await eventually(() => groupsHook(page), (h) => !!h?.some((x) => x.groups.length === 6), 5000);
  const g = probe?.find((x) => x.groups.length === 6);
  assert.ok(g, 'groups() lists the grouped Table');
  assert.deepEqual(g!.groups.map((x) => x.count), [167, 167, 167, 167, 166, 166], 'every row in its group (true counts)');
  let max = g!.domRows;
  const scroller = main(page);
  for (let i = 0; i < 40; i++) {
    await scroller.evaluate((m) => { const s = (m.closest('[data-scroll]') ?? m) as HTMLElement; s.scrollBy(0, 900); });
    await sleep(50);
    const h = (await groupsHook(page))?.find((x) => x.groups.length === 6);
    max = Math.max(max, h?.domRows ?? 999);
  }
  assert.ok(max < 80, `fewer than 80 row elements while scrolling (${max})`);
  assert.ok(await tabRoot(page).locator(`[data-query-result="${nfc('Položky/Položka 0995.md')}"]`).count() === 1, 'the last group\'s last row reached');
});
