// Slice Q2-T, L5 (WebKit + fake core): Schedule and Kanban as saved queries, and the query features Q2-T adds, of
// docs/acceptance/views.md part three (R201…R203, R207, R208): FR-TSK-04 AC-26 (Schedule and Kanban are queries; the
// editor; Duplicate; a reference fence), FR-TYP-01 AC-11 (Restore default views), FR-QRY-01 AC-17 (period grouping on any
// date attribute) and AC-19 (multi-level sort on the Tasks views). Interface docs/contracts/v1-views.md §24.3, §25.3,
// §27.4, §29.7, §29.9, §29.10, §30.1, §30.4, §31.1, expected bytes §31.4. Clock `2026-10-14T12:00:00+02:00`,
// Europe/Prague, `cs`. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CEKA, KANBAN, PR, PROJEKTY_BOARD, PROJEKT_YML, SCHEDULE, T, TASK_YML, TYPE_TASK, board, changedFiles, click, dayGroup, description, drag, editor, eventually,
  expectedTasks, fileText, fileWhen, flat, isDisabled, lane, laneCards, main, menuItem, must, mustBeOn, nfc, openTasks, overlayOriginal, overlayVault, panelOf,
  paths, periodLanes, qfile, queriesRow, runCommand, rx, seen, selectTab, selectedTab, sleep, sortButton, sortDialog, sortLevels, startTasksViews, swap, tab, tabMenu,
  tabsAre, taskCard, textOf, toolbar, toolbarMenuButton, viewMenu, whereIs, writesTo, type FakeCoreHandle,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function editView(page: Page): Promise<Locator> {
  await click(toolbarMenuButton(page), '`View actions`');
  await click(menuItem(await must(viewMenu(page), 'menu `View actions`'), 'Edit view'), 'Edit view');
  return must(editor(page), 'the editor `Edit query`');
}
const doneLaneBox = (e: Locator) => e.locator('input[type="checkbox"][data-done-lane]');
const levelLabels = (page: Page) => sortLevels(page).evaluateAll((ls) => ls.map((l) => (l.getAttribute('aria-label') ?? '').normalize('NFC')));
async function pick(page: Page, box: Locator, option: string) {
  await click(box, 'combobox');
  await click(page.getByRole('option', { name: rx(option) }).first(), option);
}
const restoreButton = (page: Page) => main(page).locator('button[data-command="types.restoreDefaultViews"]');
const projektVault = () => overlayVault((f) => { f[PROJEKT_YML] = swap(f[PROJEKT_YML], 'preview: [status, due]\n', `preview: [status, due]\nviews: [${PROJEKTY_BOARD}]\n`); });

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-26

test('fr_tsk_04_ac26_schedule_and_kanban_are_queries', async ({ page }) => {
  const core = await startTasksViews(page, { route: 'queries' });
  for (const n of [SCHEDULE, KANBAN]) {
    await must(queriesRow(page, n), `row ${n}`, 8000);
    assert.equal(flat(await textOf(queriesRow(page, n).locator('span.page-mark'))), 'Tasks page', `${n}: the mark \`Tasks page\``);
  }
  await runCommand(page, 'Go to Tasks');
  await openTasks(page, SCHEDULE);
  const e = await editView(page);
  const t = flat(await textOf(e));
  assert.equal(await e.getByRole('button', { name: rx('Type') }).count(), 0, '`Show` fixed to Task');
  assert.ok(/Status/.test(t) && t.includes('state is not') && t.includes('Cancelled'), `the filter row \`Status\` \`state is not\` \`Cancelled\` (${t})`);
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-01 AC-21, D-2175): the editor has no View, Group by or Lanes row; the
  // done-lane checkbox and its writes stand (AP-2050).
  assert.equal(await e.getByRole('radiogroup', { name: rx('View') }).count(), 0, 'no `View`');
  assert.equal(await e.getByRole('combobox', { name: rx('Group by') }).count(), 0, 'no `Group by`');
  const box = await must(doneLaneBox(e), 'the done-lane checkbox');
  assert.equal(await box.isChecked(), true, 'checked');
  assert.equal(flat(await box.getAttribute('aria-label') ?? await e.getByText(/Done in its own lane/).first().innerText()), 'Done in its own lane, last 7 days', '`Done in its own lane, last 7 days`');
  assert.equal(await e.getByRole('radiogroup', { name: rx('Lanes') }).count(), 0, 'no `Lanes`');
  assert.equal(await e.getByRole('group', { name: rx('On cards') }).count(), 0, 'no `On cards` row (D-1891)');
  // Unchecking and Done writes Schedule.yml once.
  await box.uncheck();
  await click(e.getByRole('button', { name: rx('Done') }), 'Done');
  const off = expectedTasks('queries/schedule-no-done-lane.yml');
  assert.equal(await fileWhen(core, qfile(SCHEDULE), (x) => x === off), off, 'only the done_lane line goes, modified set');
  assert.equal((await writesTo(core)).filter((p) => p === qfile(SCHEDULE)).length, 1, 'once');
  const b = await openTasks(page, SCHEDULE);
  assert.ok((await eventually(() => laneCards(b, 'period:today'), (c) => c.includes(T.t10), 3000)).includes(T.t10), 'Done-state tasks then show in their period lanes by `due`');
  const e2 = await editView(page);
  await doneLaneBox(e2).check();
  await click(e2.getByRole('button', { name: rx('Done') }), 'Done');
  const on = expectedTasks('queries/schedule-done-lane-again.yml');
  assert.equal(await fileWhen(core, qfile(SCHEDULE), (x) => x === on), on, 'checking it again writes `done_lane: { within_days: 7, folded: true }` at R201\'s place');
  // Duplicate on Kanban.
  await click(menuItem(await tabMenu(page, KANBAN), 'Duplicate'), 'Duplicate');
  assert.ok(await fileWhen(core, qfile('Kanban (2)'), (x) => x !== undefined), '`Kanban (2).yml` created');
  assert.deepEqual(await tabsAre(page, [SCHEDULE, KANBAN, 'Kanban (2)', CEKA]), ['', SCHEDULE, KANBAN, 'Kanban (2)', CEKA], 'its tab after Kanban');
});

test('fr_tsk_04_ac26_schedule_and_kanban_are_queries_in_a_reference_fence', async ({ page }) => {
  const note = 'Pages/Plán týdne.md';
  const text = '---\nid: 01JB5A0000000000000000W930\ntype: page\ntitle: Plán týdne\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nTýden.\n\n```query\nsaved: Schedule\n```\n';
  const vault = overlayVault((f) => { f[note] = text; });
  const core = await startTasksViews(page, { route: `note/${note}`, vault });
  const fig = main(page).locator('figure[data-query-block][data-query-name="Schedule"]').first();
  await must(fig, 'the reference block `saved: Schedule`', 8000);
  const b = await must(board(page).first(), 'its period board', 5000);
  assert.deepEqual((await eventually(() => periodLanes(b), (l) => l.length === 5, 5000)).map((l) => l.id), ['period:today', 'period:week', 'period:later', 'none', 'done'], 'the same period board');
  const fb = (await fig.boundingBox())!;
  const bb = (await b.boundingBox())!;
  assert.ok(bb.width <= fb.width + 1, `sized to the note column (${bb.width} ≤ ${fb.width})`);
  await drag(page, taskCard(b, T.t08), dayGroup(b, '2026-10-16'));
  const want = expectedTasks('tasks/precist-knihu-due-16.md');
  assert.equal(await fileWhen(core, T.t08, (x) => x === want), want, 'a drag in it writes as AC-25');
  assert.equal(await fileText(core, note), text, 'the note holding the block isn\'t written');
  assert.deepEqual(await changedFiles(core, vault.files), [nfc(T.t08)], 'only the task');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-11

test('fr_typ_01_ac11_restore_default_views', async ({ page }) => {
  const core = await startTasksViews(page, { route: 'type-settings/task' });
  // Slice OC (types.md FR-TYP-01 AC-27, AP-1595): the button moved into the `Views` section.
  const section = main(page).locator('section[aria-labelledby]').filter({ has: page.getByRole('heading', { level: 2, name: rx('Views') }) });
  await must(section, 'the section `Views`', 8000);
  const btn = await must(restoreButton(page), 'button `Restore default views`');
  assert.equal(flat(await btn.innerText()), 'Restore default views', 'its name');
  assert.equal(await isDisabled(btn), true, 'aria-disabled while both are listed and live');
  assert.equal(await description(btn), 'Schedule and Kanban are on the Tasks page.', 'the reason');
  // Move to trash on the Kanban tab.
  await runCommand(page, 'Go to Tasks');
  await must(tab(page, KANBAN), 'tab Kanban', 5000);
  await click(menuItem(await tabMenu(page, KANBAN), 'Move to trash'), 'Move to trash');
  const without = expectedTasks('types/task-overlay-without-kanban.yml');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === without), without, 'precondition: `views: [Schedule, Čeká na ostatní]`');
  await click(main(page).getByRole('button', { name: rx('Type settings') }), '`Type settings` in the header');
  const b2 = await must(restoreButton(page), 'button `Restore default views`', 5000);
  assert.equal(await isDisabled(b2), false, 'enabled after the trash');
  assert.equal(await description(b2), 'Brings back Schedule and Kanban if they were removed or deleted.', 'the hint');
  const files0 = await core.files();
  const trashed = Object.keys(files0).find((k) => k.startsWith('.trash/') && k.includes('Kanban'));
  await b2.click();
  assert.equal(await fileWhen(core, qfile(KANBAN), (x) => x !== undefined), expectedTasks('queries/kanban-default.yml'), 'Kanban.yml created with R202\'s bytes');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === overlayOriginal(TASK_YML)), overlayOriginal(TASK_YML), 'line 11 `views: [Schedule, Kanban, Čeká na ostatní]`');
  if (trashed) assert.equal((await core.files())[trashed], files0[trashed], 'the trashed copy stays in .trash/');
  assert.ok(await seen(page.getByText('Restored Kanban'), 2000), 'the toast `Restored Kanban`');
  await click(page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first(), 'Undo');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === without), without, 'Undo puts line 11\'s old bytes back');
  assert.equal(await fileWhen(core, qfile(KANBAN), (x) => x === undefined), undefined, 'Undo trashes the new file');
});

test('fr_typ_01_ac11_restore_default_views_after_remove_and_with_a_changed_kanban', async ({ page }) => {
  const changedKanban = swap(overlayOriginal(qfile(KANBAN)), 'lanes: vertical\n', 'lanes: vertical\nlane_order: [Waiting, To do]\n');
  const vault = overlayVault((f) => { f[qfile(KANBAN)] = changedKanban; });
  const core = await startTasksViews(page, { route: TYPE_TASK, vault });
  await must(tab(page, SCHEDULE), 'tab Schedule', 8000);
  await click(menuItem(await tabMenu(page, SCHEDULE), 'Remove from Tasks page'), 'Remove from Tasks page');
  const without = expectedTasks('types/task-overlay-without-schedule.yml');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === without), without, 'precondition: Schedule removed, its file kept');
  const files0 = await core.files();
  // The palette `Restore default views` on type/task does the same.
  await runCommand(page, 'Restore default views');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === overlayOriginal(TASK_YML)), overlayOriginal(TASK_YML), 'only `views: [Schedule, Kanban, Čeká na ostatní]` is written');
  assert.deepEqual(await changedFiles(core, files0), [TASK_YML], 'no file created; Kanban.yml (with its lane_order) never replaced');
  assert.equal(await fileText(core, qfile(KANBAN)), changedKanban, 'the changed Kanban.yml kept');
});

test('fr_typ_01_ac11_restore_default_views_refused_on_an_external_change', async ({ page }) => {
  const vault = overlayVault((f) => { f[TASK_YML] = expectedTasks('types/task-overlay-without-schedule.yml'); });
  const core = await startTasksViews(page, { route: 'type-settings/task', vault });
  const btn = await must(restoreButton(page), 'button `Restore default views`', 8000);
  const ext = vault.files[TASK_YML].replace('color: blue\n', 'color: red\n');
  assert.notEqual(ext, vault.files[TASK_YML], 'setup: an external edit');
  await core.setFile(TASK_YML, ext, { silent: true });
  await btn.click();
  assert.ok(await seen(page.getByText('"Tasks" changed outside Tegg. The views weren\'t changed.'), 3000), 'the alert (FR-SYN-03 AC-32)');
  await sleep(300);
  assert.equal(await fileText(core, TASK_YML), ext, 'the external bytes stay');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-17

test('fr_qry_01_ac17_period_grouping_for_any_date', async ({ page }) => {
  const core = await startTasksViews(page, { route: 'type/projekt', vault: projektVault() });
  const b = await openTasks(page, PROJEKTY_BOARD);
  const ls = await eventually(() => periodLanes(b), (l) => l.length === 4, 5000);
  assert.deepEqual(ls.map((l) => [l.id, l.cards]), [['period:today', [PR.web]], ['period:week', [PR.stehovani]], ['period:later', [PR.kucharka]], ['none', [PR.zahrada]]].map(([i, c]) => [i, (c as string[]).map(nfc)]), 'R208: Today & earlier Web; This week Stěhování; Later Kuchařka; No Due date Zahrada; no done lane');
  assert.deepEqual(ls.map((l) => l.label.split(',')[0]), ['Today & earlier', 'This week', 'Later', 'No Due date'], 'AP-1536 labels');
  assert.deepEqual(ls[1].days.map((d) => [d.date, d.cards.length]), [['2026-10-15', 0], ['2026-10-16', 1], ['2026-10-17', 0], ['2026-10-18', 0]], 'four day groups, `pátek 16.` Stěhování');
  for (const p of [PR.web, PR.kucharka]) assert.ok(await seen(taskCard(b, p).locator('span.card-pill[data-attribute="status"]'), 1000), `${p}: the Status pill (preview [status, due])`);
  // Drags write the date key once.
  await drag(page, taskCard(b, PR.zahrada), lane(b, 'period:later'));
  const zl = expectedTasks('projekty/zahrada-later.md');
  assert.equal(await fileWhen(core, PR.zahrada, (x) => x === zl), zl, 'Zahrada onto Later: `due: 2026-10-19` and modified');
  await drag(page, taskCard(b, PR.web), lane(b, 'none'));
  const wn = expectedTasks('projekty/web-no-due.md');
  assert.equal(await fileWhen(core, PR.web, (x) => x === wn), wn, 'Web onto No Due date: its due line removed');
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-05 AC-34): the choices are in the Group menu; the write moves to
  // query/Projekty podle termínu with the same bytes.
  const e = await editView(page);
  assert.equal(await doneLaneBox(e).count(), 0, 'no done-lane checkbox for Projekt');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Queries');
  await click(queriesRow(page, PROJEKTY_BOARD).locator('a').first(), `query/${PROJEKTY_BOARD}`);
  await click(main(page).locator('button[data-command="group.open"]'), 'Group');
  const gm = await must(page.locator('div[role="menu"][data-popup="group"]'), 'menu Group by');
  const opts = (await gm.locator('[role="menuitemradio"][data-group-choice]').allInnerTexts()).map(flat);
  assert.deepEqual(opts.slice(-3), ['Due date · by period', 'Created · by period', 'Modified · by period'], `after the attribute choices (${opts.join(', ')})`);
  await click(gm.locator('[role="menuitemradio"][data-group-choice="period:created"]'), 'Created · by period');
  const created = expectedTasks('queries/projekty-group-created.yml');
  assert.equal(await fileWhen(core, qfile(PROJEKTY_BOARD), (x) => x === created), created, 'only `group_by: { created: period }   # podle termínu` and modified');
  await runCommand(page, 'Go to type: Projekty');
  const b2 = await openTasks(page, PROJEKTY_BOARD);
  const all = await eventually(() => laneCards(b2, 'period:today'), (c) => c.length === 4, 3000);
  assert.equal(all.length, 4, 'every project in `Today & earlier` (created 1 Oct)');
});

test('fr_qry_01_ac17_period_grouping_for_any_date_on_the_query_page', async ({ page }) => {
  await startTasksViews(page, { route: `query/${PROJEKTY_BOARD}` });
  const b = await must(board(page), 'the board', 8000);
  const ls = await eventually(() => periodLanes(b), (l) => l.length === 4, 5000);
  assert.deepEqual(ls.map((l) => l.id), ['period:today', 'period:week', 'period:later', 'none'], 'the same lanes on query/Projekty podle termínu');
  assert.equal(await b.getAttribute('data-lanes'), 'vertical', 'vertical');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-19

test('fr_qry_01_ac19_sort_on_the_tasks_views', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, SCHEDULE);
  await click(sortButton(toolbar(page)), 'the sort button');
  const dlg = await must(sortDialog(page), 'dialog `Sort`');
  assert.equal(flat(await textOf(dlg.locator('p.sort-scope'))), 'This tab\'s sort', 'scope `This tab\'s sort`');
  assert.deepEqual(await levelLabels(page), ['Sort by Due date, Oldest first', 'then by Priority, High first'], 'Due date Oldest first, then Priority High first');
  await click(sortLevels(page).nth(1).getByRole('button', { name: rx('Remove') }), 'Remove level 2');
  await sleep(200);
  await pick(page, sortLevels(page).nth(0).getByRole('combobox', { name: rx('Sort by') }), 'Title');
  await sleep(200);
  const level = await levelLabels(page);
  if (level[0] !== 'Sort by Title, A → Z') await pick(page, sortLevels(page).nth(0).getByRole('combobox', { name: rx('Order') }), 'A → Z');
  const want = expectedTasks('types/task-overlay-schedule-sort-title.yml');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === want), want, 'task.yml: line 11 becomes the block with `- name: Schedule` and `sort: { by: title, order: asc }`');
  assert.equal(await fileText(core, qfile(SCHEDULE)), overlayOriginal(qfile(SCHEDULE)), 'Schedule.yml untouched');
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  const byTitle = [
    ['period:today', paths('t14', 't02', 't03', 't01')], ['period:later', paths('t07', 't06')], ['none', paths('t09', 't08', 't17', 't16', 't18')],
  ] as const;
  for (const [id, cards] of byTitle) assert.deepEqual(await eventually(() => laneCards(b, id), (c) => JSON.stringify(c) === JSON.stringify(cards), 1000), [...cards], `${id} by title`);
  assert.ok(Date.now() - t0 < 1500, 'promptly (300 ms target, polled)');
  const days = (await periodLanes(b)).find((l) => l.id === 'period:week')?.days.find((d) => d.date === '2026-10-15')?.cards;
  assert.deepEqual(days, paths('t04', 't19'), '`čtvrtek 15.` Koupit dárek, Nákup');
  const doneToggleBtn = b.locator('section[data-lane="done"]').getByRole('button', { name: /^⟦?Expand Done⟧?$/ });
  if (await seen(doneToggleBtn, 500)) await doneToggleBtn.click();
  assert.deepEqual(await eventually(() => laneCards(b, 'done'), (c) => c.length === 2, 2000), paths('t12', 't10'), 'the done lane too: Vrátit knihy, Zaplatit fakturu');
  // `Use the query's sort` writes line 11 back byte for byte.
  await click(sortButton(toolbar(page)), 'the sort button');
  await click((await must(sortDialog(page), 'dialog')).getByRole('button', { name: rx('Use the query\'s sort') }), '`Use the query\'s sort`');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === overlayOriginal(TASK_YML)), overlayOriginal(TASK_YML), 'line 11 back byte for byte');
  await page.keyboard.press('Escape');
  // On Kanban `+ Add sort` adds Title as a third level for that tab only.
  await selectTab(page, KANBAN);
  await click(sortButton(toolbar(page)), 'the sort button');
  await click((await must(sortDialog(page), 'dialog')).getByRole('button', { name: rx('+ Add sort') }), '+ Add sort');
  const k = expectedTasks('types/task-overlay-kanban-add-title.yml');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === k), k, 'Kanban: Title as a third level, that tab only');
  assert.equal(await fileText(core, qfile(KANBAN)), overlayOriginal(qfile(KANBAN)), 'Kanban.yml untouched');
  await page.keyboard.press('Escape');
  // On Čeká na ostatní a header click writes that tab's views: item.
  await selectTab(page, CEKA);
  await click(panelOf(page).getByRole('columnheader', { name: /^⟦?Priority/ }), 'header Priority');
  assert.ok((await fileWhen(core, TASK_YML, (x) => !!x?.includes(`- name: ${CEKA}`)))?.includes(`- name: ${CEKA}`), 'a header click writes the Čeká tab\'s own sort (FR-QRY-07 AC-23)');
  assert.equal(await fileText(core, qfile(CEKA)), overlayOriginal(qfile(CEKA)), 'Čeká na ostatní.yml untouched');
});

void mustBeOn;
void selectedTab;
void whereIs;
void (null as unknown as FakeCoreHandle);
