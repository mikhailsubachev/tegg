// Slice Q2-T, L5 (WebKit + fake core): the Tasks page on views of docs/acceptance/views.md part three (R202, R204, R206,
// R208): FR-TSK-04 AC-22 (header, tabs and toolbar), AC-29 (routes, history and the remembered tab), FR-TSK-10 AC-13 (new
// tasks without the quick-add row), FR-QRY-07 AC-27 (a new vault gets the default views) and AC-28 (an existing vault is
// migrated once; the fake core's `taskViews` option, §31.1). Interface docs/contracts/v1-views.md §25, §29.1, §29.2,
// §30.1, §30.3, §30.4, §31.1. Clock `2026-10-14T12:00:00+02:00`, Europe/Prague, region `cs`. Written from the ACs and the
// contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustBeDraft, start, pressNewObject } from './helpers';
import {
  CEKA, KANBAN, NOW, O, SCHEDULE, SUMMARY, T, TASK_YML, TYPE_TASK, addMenu, addView, allTab, baseOriginal, baseVault, board, changedFiles, click, drag, editor, eventually,
  expectedTasks, fileText, fileWhen, filterTasks, flat, gone, history, lanesGroup, laneRadio, main, mainName, menuItem, must, mustBeOn, mutatingCalls, newInLane, newTaskButton,
  nfc, openTagFilter, openTasks, overlayOriginal, overlayVault, paths, pickTag, qfile, rx, runCommand, scheduleBoard, scheduleCs, seen, selectTab, selectedTab, shapeWhen,
  sidebarTasks, sleep, sortButton, startTasksViews, tab, tablist, tabs, tagChips, tasksHeading, tasksSummary, textOf, toolbar, toolbarMenuButton, typeSettingsButton, uiState,
  writesTo, doneToggle, taskCard, laneShape,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** True when the elements are in this DOM order (each before the next). */
async function inDomOrder(page: Page, locs: Locator[]): Promise<boolean> {
  const handles = [];
  for (const l of locs) handles.push(await l.first().elementHandle({ timeout: 1000 }).catch(() => null));
  if (handles.some((h) => !h)) return false;
  return page.evaluate((els) => els.every((e, i) => i === 0 || !!(els[i - 1]!.compareDocumentPosition(e!) & Node.DOCUMENT_POSITION_FOLLOWING)), handles);
}
const propertiesRegion = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
/** D-1929 (harness): `history.length` starts at 2 in WebKit (`about:blank`, then the page), so "no history entry" is
 *  measured by a spy: the number of `history.pushState` calls since the page loaded. */
const spyPushState = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __pushes: number };
  w.__pushes = 0;
  const h = window.history;
  const push = h.pushState.bind(h);
  h.pushState = (...a: Parameters<History['pushState']>) => { w.__pushes++; return push(...a); };
});
const pushes = (page: Page) => page.evaluate(() => (window as unknown as { __pushes: number }).__pushes);
/** The vault file whose path starts with `prefix`, once it exists. */
const fileStarting = (core: Awaited<ReturnType<typeof startTasksViews>>, prefix: string, ms = 3000) =>
  eventually(async () => Object.keys(await core.files()).find((k) => k.startsWith(nfc(prefix))), (x) => !!x, ms);

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-22

test('fr_tsk_04_ac22_header_tabs_and_toolbar', async ({ page }) => {
  const core = await startTasksViews(page);
  const entry = await must(sidebarTasks(page), 'the sidebar entry `Tasks`');
  await entry.click();
  await mustBeOn(page, 'Tasks', 'the sidebar entry Tasks opens type/task');
  assert.equal(await entry.getAttribute('aria-current'), 'page', 'the entry is aria-current="page" on type/task');
  await must(tasksHeading(page), 'heading `Tasks`');
  assert.equal(flat(await textOf(tasksSummary(page))), SUMMARY, `the summary \`${SUMMARY}\` (R208)`);
  assert.equal(await main(page).getByText(/^\d+ Tasks$/).count(), 0, 'no count `<n> Tasks` in its place (AP-1540)');
  await must(typeSettingsButton(page), '`Type settings` right of the heading');
  await must(newTaskButton(page), '`New Task` right of the heading');
  assert.ok(await inDomOrder(page, [tasksHeading(page), typeSettingsButton(page), newTaskButton(page)]), 'heading, then `Type settings`, then `New Task`');
  // Tabs (R208): All Tasks, Schedule (board, selected), Kanban (board), Čeká na ostatní (table), Add view.
  assert.equal(await tablist(page).getAttribute('aria-label').then((x) => (x ?? '').replace(/[⟦⟧]/g, '')), 'Views', 'the tablist is `Views`');
  const t = await eventually(() => tabs(page), (x) => x.length === 4, 5000);
  assert.deepEqual(t.map((x) => [x.name, x.text, x.kind, x.selected]),
    [['', 'All Tasks', 'table', false], [SCHEDULE, SCHEDULE, 'board', true], [KANBAN, KANBAN, 'board', false], [CEKA, CEKA, 'table', false]],
    'tabs `All Tasks` (table, as every `All <plural>`, D-1929), `Schedule` (board, selected on the first open), `Kanban` (board), `Čeká na ostatní` (table)');
  await must(addView(page), '`Add view` after the tabs');
  // The Schedule toolbar, in order.
  await must(scheduleBoard(page), 'the Schedule board', 5000);
  const field = filterTasks(page);
  const tags = toolbar(page).getByRole('button', { name: rx('Filter by tag') }).or(toolbar(page).getByRole('combobox', { name: rx('Filter by tag') })).first();
  const lanes = lanesGroup(toolbar(page));
  const sort = sortButton(toolbar(page));
  const menu = toolbarMenuButton(page);
  for (const [what, loc] of [['Filter Tasks…', field], ['Filter by tag', tags], ['Lanes', lanes], ['the sort button', sort], ['View actions', menu]] as const) await must(loc, `toolbar: ${what}`);
  assert.ok(await inDomOrder(page, [field, tags, lanes, sort, menu]), 'in order: `Filter Tasks…`, `Filter by tag`, `Lanes`, the sort button, `View actions`');
  assert.equal(await laneRadio(toolbar(page), 'Horizontal').getAttribute('aria-checked'), 'true', '`Horizontal` checked');
  assert.equal(flat(await textOf(sort)), 'Due date ↑ +1', 'the sort button `Due date ↑` `+1` (D-1922)');
  const g = gone(page);
  for (const [what, loc] of [['textbox `Add a task…`', g.quickAdd], ['[data-quick-add]', g.quickAddAttr], ['group `Filter`', g.dateFilter], ['tablist `Group by`', g.groupBy], ['tablist `Task views`', g.taskViews], ['an aria-disabled `Sort`', g.disabledSort]] as const) {
    assert.equal(await loc.count(), 0, `no ${what}`);
  }
  assert.deepEqual(await mutatingCalls(core), [], 'opening the page sends no write command');
  assert.deepEqual(await writesTo(core), [], 'no vault write');
  // `Go to Tasks` opens the same page.
  await runCommand(page, 'Go to Inbox');
  await runCommand(page, 'Go to Tasks');
  await mustBeOn(page, 'Tasks', '`Go to Tasks` opens type/task');
  assert.equal(await selectedTab(page), SCHEDULE, 'on the Schedule tab');
});

test('fr_tsk_04_ac22_header_tabs_and_toolbar_tab_drag_writes_line_11_once', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  await must(tab(page, CEKA), 'tab Čeká na ostatní', 8000);
  await drag(page, tab(page, CEKA), tab(page, SCHEDULE), { at: 'left' });
  const want = overlayOriginal(TASK_YML).replace('views: [Schedule, Kanban, Čeká na ostatní]\n', 'views: [Čeká na ostatní, Schedule, Kanban]\n');
  assert.equal(await fileWhen(core, TASK_YML, (x) => x === want), want, 'task.yml: line 11 only, `views: [Čeká na ostatní, Schedule, Kanban]`');
  assert.deepEqual(await changedFiles(core, overlayVault().files), [TASK_YML], 'only task.yml changes');
  assert.equal((await core.calls()).filter((c) => c.cmd === 'type_patch').length, 1, 'one type_patch');
});

test('fr_tsk_04_ac22_header_tabs_and_toolbar_add_view_works_as_on_books', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  await must(tab(page, SCHEDULE), 'tab Schedule', 8000);
  await click(addView(page), 'Add view');
  await click(menuItem(await must(addMenu(page), 'menu `Add view`'), 'Table'), 'Table');
  assert.ok(await seen(tab(page, 'New view'), 2000), 'a draft tab `New view`');
  assert.deepEqual(await writesTo(core), [], 'nothing written yet');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const q = await fileWhen(core, qfile('New view'), (x) => x !== undefined);
  assert.ok(q?.includes('types: [task]\n') && q.includes('view: table\n'), `New view.yml: a Table of Task (${JSON.stringify(q)})`);
  const y = await fileWhen(core, TASK_YML, (x) => !!x?.includes('New view'));
  assert.equal(y, overlayOriginal(TASK_YML).replace('views: [Schedule, Kanban, Čeká na ostatní]\n', 'views: [Schedule, Kanban, Čeká na ostatní, New view]\n'), 'task.yml line 11 gains `New view`');
  assert.equal(await selectedTab(page), 'New view', 'the new tab is selected');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-29

test('fr_tsk_04_ac29_routes_and_the_remembered_tab', async ({ page }) => {
  await spyPushState(page);
  await startTasksViews(page, { route: 'tasks' });
  await mustBeOn(page, 'Tasks', 'the alias `tasks` shows type/task');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === SCHEDULE, 5000), SCHEDULE, 'no remembered tab: the first view tab, Schedule');
  assert.equal(await pushes(page), 0, 'no history entry for the alias (history.replace)');
  assert.equal(await tablist(page).count(), 1, 'the type page with its `Views` tablist, not a 5A page');
});

test('fr_tsk_04_ac29_routes_and_the_remembered_tab_kanban_alias', async ({ page }) => {
  await spyPushState(page);
  await startTasksViews(page, { route: 'tasks/kanban', ui: { typeViews: { lastTab: { task: CEKA } } } });
  await mustBeOn(page, 'Tasks', '`tasks/kanban` shows type/task');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === KANBAN, 5000), KANBAN, '`tasks/kanban` opens the Kanban tab (Kanban is listed)');
  assert.equal(await pushes(page), 0, 'no history entry for the alias');
});

test('fr_tsk_04_ac29_routes_and_the_remembered_tab_alias_uses_the_remembered_tab', async ({ page }) => {
  await startTasksViews(page, { route: 'tasks', ui: { typeViews: { lastTab: { task: CEKA } } } });
  assert.equal(await eventually(() => selectedTab(page), (s) => s === CEKA, 5000), CEKA, '`tasks` opens the remembered tab, Čeká na ostatní');
  await startTasksViews(page, { route: 'tasks', ui: { typeViews: { lastTab: { task: null } } } });
  assert.equal(await eventually(() => selectedTab(page), (s) => s === '', 5000), '', '`lastTab.task: null`: All Tasks was chosen');
});

test('fr_tsk_04_ac29_routes_and_the_remembered_tab_back_keeps_tab_folds_tags_and_scroll', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, SCHEDULE);
  await click(doneToggle(b), '`Expand Done`');
  await pickTag(page, 'doma');
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['doma'], 'precondition: #doma selected');
  const h0 = await history(page);
  await selectTab(page, KANBAN);
  await selectTab(page, SCHEDULE);
  assert.equal(await history(page), h0, 'switching tabs adds no history entry (D-1790)');
  await page.setViewportSize({ width: 1440, height: 500 });
  const scroller = main(page).locator('.page-scroll, [data-scroll-root]').first();
  const top = await page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement | null;
    const s = [m, ...(m ? [...m.querySelectorAll('*')] : [])].find((e) => e && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 20 && getComputedStyle(e as HTMLElement).overflowY !== 'visible') as HTMLElement | undefined;
    if (!s) return -1;
    s.scrollTop = 120;
    return s.scrollTop;
  });
  void scroller;
  const t03 = taskCard(await scheduleBoard(page), T.t03);
  await click(t03.locator('a[data-card-title]').or(t03.getByRole('link', { name: 'Zalít květiny', exact: true })).first(), 'the title of Zalít květiny');
  await mustBeOn(page, 'Zalít květiny', 'opening Zalít květiny from its card');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Tasks', 'Back returns to type/task');
  assert.equal(await selectedTab(page), SCHEDULE, 'on the same tab');
  const bb = await must(scheduleBoard(page), 'the Schedule board');
  assert.equal(await doneToggle(bb).getAttribute('aria-expanded'), 'true', 'the done lane still expanded');
  assert.deepEqual(await tagChips(page), ['doma'], 'the tag selection kept');
  if (top > 0) {
    const back = await page.evaluate(() => {
      const m = document.querySelector('main') as HTMLElement | null;
      const s = [m, ...(m ? [...m.querySelectorAll('*')] : [])].find((e) => e && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 20 && getComputedStyle(e as HTMLElement).overflowY !== 'visible') as HTMLElement | undefined;
      return s?.scrollTop ?? -1;
    });
    assert.ok(Math.abs(back - top) <= 2, `the same scroll position (${back} vs ${top})`);
  }
  assert.deepEqual(await writesTo(core), [], 'nothing written to the vault');
});

test('fr_tsk_04_ac29_routes_and_the_remembered_tab_from_0_4_ui_state', async ({ page }) => {
  // A 0.4.x ui-state.json whose last Tasks view is `kanban` (R202 "Old UI state").
  const core = await startTasksViews(page, { route: TYPE_TASK, ui: { tasks: { view: 'kanban', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false } } });
  assert.equal(await eventually(() => selectedTab(page), (s) => s === KANBAN, 5000), KANBAN, 'the first open after the update shows Kanban');
  const u = await eventually(() => uiState(core), (x) => x?.typeViews?.lastTab?.task === KANBAN, 3000);
  assert.equal(u?.typeViews?.lastTab?.task, KANBAN, '`typeViews.lastTab.task` filled from the 0.4.x key');
  assert.deepEqual(u?.tasks, { view: 'kanban', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false }, 'the old keys stay unchanged');
});

test('fr_tsk_04_ac29_routes_and_the_remembered_tab_filter_tasks_go_to_type_and_the_type_chip', async ({ page }) => {
  await startTasksViews(page, { route: `note/${O.porada}` });
  await mustBeOn(page, 'Porada', 'precondition: the note Porada');
  await runCommand(page, 'Filter tasks');
  await mustBeOn(page, 'Tasks', '`Filter tasks` from a note opens type/task');
  const f = await must(filterTasks(page), '`Filter Tasks…` of the current tab');
  assert.ok(await eventually(() => f.evaluate((e) => e === document.activeElement), (x) => x, 2000), 'the focus is in `Filter Tasks…`');
  await runCommand(page, 'Go to Inbox');
  await runCommand(page, 'Go to type: Tasks');
  await mustBeOn(page, 'Tasks', '`Go to type: Tasks` leads to type/task');
  assert.equal(await tablist(page).count(), 1, 'the type page with views');
  await runCommand(page, 'Go to Inbox');
  await startTasksViews(page, { route: `note/${T.t03}` });
  await mustBeOn(page, 'Zalít květiny', 'a task note');
  await click(main(page).getByRole('link', { name: /^⟦?Type: Task⟧?$/ }).or(page.getByRole('button', { name: /^⟦?Type: Task⟧?$/ })).first(), 'the type chip `Type: Task`');
  await mustBeOn(page, 'Tasks', 'the type chip leads to type/task');
  assert.equal(await tablist(page).count(), 1, 'the type page with views');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-13

test('fr_tsk_10_ac13_new_tasks_without_quick_add', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  for (const name of [SCHEDULE, KANBAN, CEKA, '']) {
    if (name === '') await click(allTab(page), 'All Tasks'); else await selectTab(page, name);
    await sleep(200);
    assert.equal(await gone(page).quickAdd.count(), 0, `${name || 'All Tasks'}: no textbox \`Add a task…\``);
    assert.equal(await gone(page).quickAddAttr.count(), 0, `${name || 'All Tasks'}: no [data-quick-add]`);
  }
  // (a) `New Task` in the header opens the unsaved draft new/task.
  await click(newTaskButton(page), '`New Task`');
  await mustBeDraft(page, '`New Task` (header)');
  assert.ok(await seen(propertiesRegion(page).getByText('To do', { exact: true }), 3000), 'Status `To do` in the attribute panel');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Tasks', 'back on the Tasks page');
  assert.deepEqual(await writesTo(core), [], 'leaving it unchanged writes nothing');
  await runCommand(page, 'New Task');
  await mustBeDraft(page, 'palette `New Task`');
  await page.keyboard.press('Meta+[');
  await pressNewObject(page, '⌘N › Task', 'Task');
  await mustBeDraft(page, '⌘N › Task');
  await page.keyboard.type('Zavolat do servisu');
  await page.keyboard.press('Enter');
  const p = 'Tasks/Zavolat do servisu.md';
  const text = await fileWhen(core, p, (x) => x !== undefined);
  assert.ok(text !== undefined, 'Tasks/Zavolat do servisu.md is created');
  assert.ok(text!.includes('type: task\n') && text!.includes('title: Zavolat do servisu\n') && text!.includes('status: To do\n'), 'status: To do');
  assert.ok(!/^due:/m.test(text!), 'no due');
  // RT-6 (D-1927): the generated `id:` line after `---` is removed before comparing the whole file.
  assert.equal(text!.replace(/^---\nid: [0-9A-Z]{26}\n/, '---\n'), expectedTasks('tasks/zavolat-do-servisu-new.md'), 'the whole file without its `id:` line (RT-6)');
  assert.deepEqual((await writesTo(core)).filter((x) => x === p), [p], 'created once');
  await runCommand(page, 'Go to Tasks');
  const b = await openTasks(page, SCHEDULE);
  assert.ok(await eventually(async () => (await laneShape(b)).find((l) => l.id === 'none')?.cards.includes(p) ?? false, (x) => x, 1000), 'its card shows in `Not scheduled` within 1 s');
});

test('fr_tsk_10_ac13_new_tasks_without_quick_add_lane_tiles', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const cases: [string, string, string | null][] = [['period:today', 'Today & overdue', '2026-10-14'], ['period:week', 'This week', '2026-10-18'], ['period:later', 'Later', '2026-10-19'], ['none', 'Not scheduled', null]];
  for (const [i, [id, label, due]] of cases.entries()) {
    const b = await openTasks(page, SCHEDULE);
    const tile = await must(newInLane(b, id), `the tile of ${label}`);
    assert.equal(await tile.getAttribute('aria-label'), `New Task in ${label}`, `\`New Task in ${label}\``);
    const n = (await writesTo(core)).length;
    await tile.click();
    await mustBeDraft(page, `New Task in ${label}`);
    assert.equal((await writesTo(core)).length, n, `${label}: nothing written before the first change`);
    await page.keyboard.type(`Úkol z dlaždice ${i + 1}`);
    await page.keyboard.press('Enter');
    const f = await fileStarting(core, `Tasks/Úkol z dlaždice ${i + 1}`);
    const t = f ? await fileText(core, f) : undefined;
    assert.ok(t !== undefined, `${label}: the task is created`);
    if (due) assert.ok(t!.includes(`due: ${due}\n`), `${label}: pre-filled \`due: ${due}\` (${JSON.stringify(t)})`);
    else assert.ok(!/^due:/m.test(t!), `${label}: no due`);
    await runCommand(page, 'Go to Tasks');
  }
  const b = await openTasks(page, SCHEDULE);
  assert.equal(await newInLane(b, 'done').count(), 0, 'the done lane has no tile');
  const k = await openTasks(page, KANBAN);
  await click(newInLane(k, 'option:Waiting'), '`New Task in Waiting`');
  await mustBeDraft(page, 'New Task in Waiting');
  assert.ok(await seen(propertiesRegion(page).getByText('Waiting', { exact: true }), 3000), 'Status `Waiting` pre-filled (FR-QRY-08)');
  // Text typed on a board's draft is never parsed for tokens.
  await page.keyboard.type('Zavolat kominíkovi tomorrow !high #doma');
  await page.keyboard.press('Enter');
  const f = await fileStarting(core, 'Tasks/Zavolat kominíkovi');
  const t = f ? await fileText(core, f) : '';
  assert.ok(/^title: .*tomorrow !high/m.test(t ?? ''), `the title keeps the tokens (${JSON.stringify(t)})`);
  assert.ok(!/^priority:/m.test(t ?? '') && !/^due:/m.test(t ?? '') && !/^tags:/m.test(t ?? ''), 'no priority, due or tags parsed');
  assert.ok((t ?? '').includes('status: Waiting\n'), 'status: Waiting');
});

test('fr_tsk_10_ac13_new_tasks_without_quick_add_en_us', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK, region: 'en-US' });
  for (const [id, due] of [['period:week', '2026-10-17'], ['period:later', '2026-10-18']] as const) {
    const b = await openTasks(page, SCHEDULE);
    await click(newInLane(b, id), `the tile of ${id}`);
    await mustBeDraft(page, `en-US ${id}`);
    await page.keyboard.type(`Úkol ${id.replace('period:', '')}`);
    await page.keyboard.press('Enter');
    const f = await fileStarting(core, `Tasks/Úkol ${id.replace('period:', '')}`);
    assert.ok(f && (await fileText(core, f))?.includes(`due: ${due}\n`), `en-US ${id}: due ${due}`);
    await runCommand(page, 'Go to Tasks');
  }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-27, AC-28

test('fr_qry_07_ac27_a_new_vault_gets_default_views', async ({ page }) => {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, 'cs');
  await page.clock.setFixedTime(new Date(NOW));
  const PARENT = '/Users/test/Trezory';
  const core = await start(page, { vault: null, pickDir: PARENT, ...({ taskViews: true } as object) });
  const chooser = page.getByRole('main', { name: 'Choose a vault' });
  await click(chooser.getByRole('button', { name: 'Create new vault' }), 'Create new vault');
  const form = page.getByRole('form', { name: 'New vault' }).or(page.getByRole('dialog', { name: 'New vault' })).first();
  await (await must(form.getByRole('textbox', { name: 'Vault name' }), 'Vault name')).fill('Můj trezor');
  await click(form.getByRole('button', { name: 'Choose…' }), 'Choose…');
  await click(form.getByRole('button', { name: 'Create', exact: true }), 'Create');
  await mustBeOn(page, 'Inbox', 'the new vault opens');
  const files = await eventually(() => core.files(), (f) => f[qfile(SCHEDULE)] !== undefined && f[qfile(KANBAN)] !== undefined, 3000);
  assert.equal(files[qfile(SCHEDULE)], expectedTasks('queries/schedule-default.yml'), 'Schedule.yml: R202\'s bytes, the clock as stamp');
  assert.equal(files[qfile(KANBAN)], expectedTasks('queries/kanban-default.yml'), 'Kanban.yml: R202\'s bytes');
  assert.equal(files[TASK_YML], expectedTasks('types/task-migrated.yml'), 'task.yml: new-empty\'s plus line 11 `views: [Schedule, Kanban]`');
  await click(sidebarTasks(page), 'the sidebar entry Tasks');
  await mustBeOn(page, 'Tasks', 'type/task');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === SCHEDULE, 5000), SCHEDULE, 'on Schedule');
});

test('fr_qry_07_ac28_an_existing_vault_is_migrated_once', async ({ page }) => {
  const before = baseVault().files;
  const core = await startTasksViews(page, { vault: baseVault(), taskViews: true, route: TYPE_TASK });
  const files = await eventually(() => core.files(), (f) => f[TASK_YML]?.includes('views:') ?? false, 5000);
  assert.equal(files[qfile(SCHEDULE)], expectedTasks('queries/schedule-default.yml'), 'Schedule.yml created with R202\'s bytes');
  assert.equal(files[qfile(KANBAN)], expectedTasks('queries/kanban-default.yml'), 'Kanban.yml created with R202\'s bytes');
  assert.equal(files[TASK_YML], expectedTasks('types/task-migrated.yml'), 'task.yml: only line 11 inserted');
  assert.deepEqual(await changedFiles(core, before), [qfile(KANBAN), qfile(SCHEDULE), TASK_YML].sort(), 'every other vault file keeps its bytes');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === SCHEDULE, 5000), SCHEDULE, 'the page shows Schedule');
  const b = await must(scheduleBoard(page), 'the Schedule board', 5000);
  const want = scheduleCs().slice(0, 4);
  assert.deepEqual((await shapeWhen(b, [...want, { id: 'done', cards: [] }], 5000)).slice(0, 4), want, 'R208\'s Schedule');
  assert.deepEqual(await core.backups(), [], 'no restore point');
});

test('fr_qry_07_ac28_an_existing_vault_is_migrated_once_reopen_writes_nothing', async ({ page }) => {
  // The migrated copy (the overlay's task.yml carries a `views` key): opening it with migrations on writes nothing.
  const migrated = baseVault((f) => {
    f[qfile(SCHEDULE)] = expectedTasks('queries/schedule-default.yml');
    f[qfile(KANBAN)] = expectedTasks('queries/kanban-default.yml');
    f[TASK_YML] = expectedTasks('types/task-migrated.yml');
  });
  const core = await startTasksViews(page, { vault: migrated, taskViews: true, route: TYPE_TASK });
  await must(tab(page, SCHEDULE), 'tab Schedule', 8000);
  await sleep(500);
  assert.deepEqual(await changedFiles(core, migrated.files), [], 'reopening writes nothing');
  assert.deepEqual(await writesTo(core), [], 'no write');
});

test('fr_qry_07_ac28_an_existing_vault_is_migrated_once_variants', async ({ page }) => {
  // (a) No task.yml (D-1936, AC-Test-Change: the vault may not have synced yet): nothing is written, no default views.
  let v = baseVault((f) => { delete f[TASK_YML]; });
  let core = await startTasksViews(page, { vault: v, taskViews: true });
  await sleep(1000);
  let files = await core.files();
  assert.equal(files[TASK_YML], undefined, '(a) no task.yml created');
  assert.equal(files[qfile(SCHEDULE)], undefined, '(a) no Schedule.yml');
  assert.equal(files[qfile(KANBAN)], undefined, '(a) no Kanban.yml');
  // (b) A user Schedule.yml (a Table of Pages): kept; Kanban.yml created; views written; the tab shows the user's query.
  for (const name of ['Schedule', 'schedule']) { // ('Schedule' has no letter NFD changes; the other case is the variant)
    const user = `version: 1\ntitle: ${name}\ntypes: [page]\nview: table\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n`;
    v = baseVault((f) => { f[`.tegg/queries/${name}.yml`] = user; });
    core = await startTasksViews(page, { vault: v, taskViews: true, route: TYPE_TASK });
    files = await eventually(() => core.files(), (f) => f[TASK_YML]?.includes('views:') ?? false, 5000);
    assert.equal(files[`.tegg/queries/${name}.yml`], user, `(b) ${JSON.stringify(name)}: neither read for content nor written`);
    assert.equal(files[qfile(KANBAN)], expectedTasks('queries/kanban-default.yml'), `(b) ${JSON.stringify(name)}: Kanban.yml created`);
    assert.equal(Object.keys(files).filter((k) => /^\.tegg\/queries\/schedule/i.test(k.normalize('NFC'))).length, 1, `(b) ${JSON.stringify(name)}: no second Schedule file`);
    assert.equal(files[TASK_YML], expectedTasks('types/task-migrated.yml'), `(b) ${JSON.stringify(name)}: views: [Schedule, Kanban]`);
  }
  await must(tab(page, SCHEDULE), '(b) the Schedule tab', 5000);
  await selectTab(page, SCHEDULE);
  assert.equal(await board(page, SCHEDULE).count(), 0, '(b) the Schedule tab shows the user\'s Table, not a board');
  // (c), (d): nothing is written, no alert.
  const base = baseOriginal(TASK_YML);
  const line = 'preview: [status, priority, due]\n';
  for (const [what, edit] of [
    ['(c) views: []', (t: string) => t.replace(line, `${line}views: []\n`)], ['(c) views: [Moje]', (t: string) => t.replace(line, `${line}views: [Moje]\n`)],
    ['(d) version: 2', (t: string) => t.replace('version: 1\n', 'version: 2\n')], ['(d) views: Schedule', (t: string) => t.replace(line, `${line}views: Schedule\n`)],
  ] as const) {
    assert.ok(base.includes(line), 'setup: task.yml has the preview line');
    v = baseVault((f) => { f[TASK_YML] = edit(base); });
    core = await startTasksViews(page, { vault: v, taskViews: true });
    await sleep(600);
    assert.deepEqual(await changedFiles(core, v.files), [], `${what}: nothing is written`);
    assert.equal(await page.getByRole('alert').count(), 0, `${what}: no alert`);
  }
});
