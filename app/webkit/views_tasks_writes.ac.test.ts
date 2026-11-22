// Slice Q2-T, L5 (WebKit + fake core): what the Tasks views write, docs/acceptance/views.md part three: FR-FMT-12 AC-14
// (names, tags and dates are NFC), FR-SYN-03 AC-32 (Q2-T writes never overwrite an unread version) and FR-SYN-06 AC-50
// (browsing writes nothing; each action writes exactly its file; the L5 count of the built-app tour). Interface
// docs/contracts/v1-views.md §23.2, §26, §27.4, §30.3, §31.1, expected bytes §31.4. Clock `2026-10-14T12:00:00+02:00`,
// Europe/Prague, `cs`. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CEKA, KANBAN, NOW, SCHEDULE, T, TASK_YML, TYPE_TASK, allTab, changedFiles, click, dayGroup, doneToggle, drag, eventually, expectedTasks, fileText, fileWhen,
  filterTasks, lane, laneGrip, main, menuItem, must, mustBeOn, mutatingCalls, nfc, openTagFilter, openTasks, overlayOriginal, overlayVault, periodLanes, pickTag,
  podleStitku, qfile, runCommand, seen, selectTab, sleep, sortButton, startTasksViews, swap, tab, tabMenu, tabs, tagChips, tagList, taskCard, taskCheckbox, taskMore,
  toolbar, toolbarMenuButton, touched, uiState, viewMenu, whereIs, writesTo, type FakeCoreHandle,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const OLD_MOD = 'modified: 2026-10-01T09:00:00+02:00\n';
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-14

test('fr_fmt_12_ac14_q2t_names_and_tags_are_nfc', async ({ page }) => {
  const nfdCeka = CEKA.normalize('NFD');
  const vault = overlayVault((f) => {
    f[TASK_YML] = swap(overlayOriginal(TASK_YML), 'views: [Schedule, Kanban, Čeká na ostatní]\n', `views: [Schedule, Kanban, ${nfdCeka}]\n`);
  });
  const core = await startTasksViews(page, { route: TYPE_TASK, vault });
  const t = await eventually(() => tabs(page), (x) => x.length === 4, 5000);
  assert.deepEqual(t.map((x) => x.name), ['', SCHEDULE, KANBAN, CEKA], 'an NFD `Čeká na ostatní` in views: resolves to one tab (NFC)');
  const b = await openTasks(page, SCHEDULE);
  const all = (await periodLanes(b)).flatMap((l) => l.cards);
  assert.equal(all.filter((p) => p === nfc(T.t19)).length, 1, 'Nákup (NFD title and tag) is one card');
  assert.deepEqual(await whereIs(b, T.t19), { lane: 'period:week', day: '2026-10-15' }, '… in `čtvrtek 15.`');
  // `práce` typed in NFD selects the same chip; tagFilter keys are NFC.
  await openTagFilter(page);
  await page.keyboard.insertText('práce'.normalize('NFD'));
  await sleep(150);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1, 2000), ['práce'], 'one chip `práce`');
  const u = await eventually(() => uiState(core), (x) => !!x?.tagFilter?.['tab:task/schedule'], 2000);
  assert.deepEqual(Object.keys(u?.tagFilter ?? {}), ['tab:task/schedule'], 'the key is NFC');
  assert.deepEqual(u?.tagFilter?.['tab:task/schedule'], ['práce'], 'the value is NFC');
  // A period drag of T19 writes due and keeps its NFD title bytes.
  await click(main(page).getByRole('button', { name: /^⟦?Remove #práce⟧?$/ }).or(main(page).getByRole('button', { name: /^⟦?Clear tags⟧?$/ })).first(), 'remove the tag');
  await drag(page, taskCard(b, T.t19), lane(b, 'period:later'));
  const want = expectedTasks('tasks/nakup-later.md');
  assert.equal(await fileWhen(core, T.t19, (x) => x === want), want, 'T19 onto Later: `due:` written, the NFD title kept');
  assert.ok(want.includes(`title: ${'Nákup'.normalize('NFD')}\n`), 'the expected bytes keep the NFD title');
});

test('fr_fmt_12_ac14_q2t_names_and_tags_are_nfc_nfd_query_file_and_tag_lane', async ({ page }) => {
  const nfdFile = `.tegg/queries/${CEKA.normalize('NFD')}.yml`;
  const vault = overlayVault((f) => {
    const text = f[qfile(CEKA)];
    delete f[qfile(CEKA)];
    f[nfdFile] = text;
    f[qfile('Podle štítků')] = podleStitku();
    f[TASK_YML] = swap(overlayOriginal(TASK_YML), 'views: [Schedule, Kanban, Čeká na ostatní]\n', 'views: [Schedule, Kanban, Čeká na ostatní, Podle štítků]\n');
  });
  await startTasksViews(page, { route: TYPE_TASK, vault });
  const t = await eventually(() => tabs(page), (x) => x.length === 5, 5000);
  assert.equal(t.filter((x) => x.name === CEKA).length, 1, 'an NFD file name resolves to one tab');
  await selectTab(page, CEKA);
  assert.ok(await seen(main(page).locator('[data-query-result]').first(), 3000), 'the tab shows its query');
  const b = await openTasks(page, 'Podle štítků');
  const doma = (await periodLanes(b)).find((l) => l.id === 'tag:doma');
  assert.equal(doma?.cards.filter((p) => p === nfc(T.t19)).length, 1, 'Nákup under `#doma` once');
  assert.equal((await periodLanes(b)).filter((l) => l.id.normalize('NFC') === 'tag:doma').length, 1, 'one `doma` lane');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-32

test('fr_syn_03_ac32_q2t_writes_check_the_base', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, SCHEDULE);
  // A period drag on a file changed on disk without vault:changed.
  const ext = overlayOriginal(T.t03).replace('due: 2026-10-14', 'due: 2026-10-16');
  await core.setFile(T.t03, ext, { silent: true });
  await drag(page, taskCard(b, T.t03), lane(b, 'period:later'));
  assert.ok(await seen(alertWith(page, '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.'), 3000), 'refused with the alert');
  assert.equal(await fileText(core, T.t03), ext, 'the external bytes stay');
  assert.deepEqual(await eventually(() => whereIs(b, T.t03), (w) => w?.day === '2026-10-16', 2000), { lane: 'period:week', day: '2026-10-16' }, 'the card goes to the lane of its disk state within 2 s');
  // A done-lane drop.
  await click(doneToggle(b), '`Expand Done`');
  const ext2 = overlayOriginal(T.t02).replace('priority: Medium', 'priority: High');
  await core.setFile(T.t02, ext2, { silent: true });
  await drag(page, taskCard(b, T.t02), lane(b, 'done'));
  assert.ok(await seen(alertWith(page, '"Poslat rozpočet" changed outside Tegg. Your change wasn\'t saved.'), 3000), 'done-lane drop refused');
  assert.equal(await fileText(core, T.t02), ext2, 'T02 keeps the external bytes');
  // Same bytes with only a new mtime is no conflict.
  await core.setFile(T.t08, overlayOriginal(T.t08), { silent: true, sameBytesTouch: true });
  await drag(page, taskCard(b, T.t08), dayGroup(b, '2026-10-16'));
  const want = expectedTasks('tasks/precist-knihu-due-16.md');
  assert.equal(await fileWhen(core, T.t08, (x) => x === want), want, 'same bytes, new mtime: written');
});

test('fr_syn_03_ac32_q2t_writes_check_the_base_kanban_lane_drag', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, KANBAN);
  const ext = overlayOriginal(qfile(KANBAN)).replace('limit: 50\n', 'limit: 40\n');
  await core.setFile(qfile(KANBAN), ext, { silent: true });
  await drag(page, laneGrip(b, 'option:Waiting'), lane(b, 'option:To do'), { at: 'left' });
  assert.ok(await seen(alertWith(page, 'This query changed outside Tegg. Your change wasn\'t saved.'), 3000), 'the lane drag is refused');
  assert.equal(await fileText(core, qfile(KANBAN)), ext, 'Kanban.yml keeps the external bytes');
});

test('fr_syn_03_ac32_q2t_writes_check_the_base_restore', async ({ page }) => {
  const vault = overlayVault((f) => {
    delete f[qfile(KANBAN)];
    f[TASK_YML] = expectedTasks('types/task-overlay-without-kanban.yml');
  });
  const core = await startTasksViews(page, { route: 'type-settings/task', vault });
  const btn = await must(main(page).locator('button[data-command="types.restoreDefaultViews"]'), '`Restore default views`', 8000);
  const ext = vault.files[TASK_YML].replace('color: blue\n', 'color: teal\n');
  await core.setFile(TASK_YML, ext, { silent: true });
  await btn.click();
  assert.ok(await seen(alertWith(page, '"Tasks" changed outside Tegg. The views weren\'t changed.'), 3000), 'refused with `Conflict`');
  assert.equal(await fileText(core, TASK_YML), ext, 'task.yml keeps the external bytes');
  assert.equal(await fileText(core, qfile(KANBAN)), expectedTasks('queries/kanban-default.yml'), 'a file already created stays');
  await runCommand(page, 'Go to Queries');
  assert.ok(await seen(main(page).locator(`tr[data-query-row="${KANBAN}"]`), 3000), '… and is listed in Queries');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-50

test('fr_syn_06_ac50_tasks_views_write_only_what_the_user_changes', async ({ page }) => {
  const vault = overlayVault((f) => {
    f[qfile('Podle štítků')] = podleStitku();
    f[TASK_YML] = swap(overlayOriginal(TASK_YML), 'views: [Schedule, Kanban, Čeká na ostatní]\n', 'views: [Schedule, Kanban, Čeká na ostatní, Podle štítků]\n');
  });
  const core = await startTasksViews(page, { route: TYPE_TASK, vault });
  // The browsing tour.
  for (const name of [SCHEDULE, KANBAN, CEKA, 'Podle štítků']) {
    await selectTab(page, name);
    await click(toolbarMenuButton(page), '`View actions`');
    await must(viewMenu(page), 'menu');
    await page.keyboard.press('Escape');
    await click(sortButton(toolbar(page)), 'the sort popover');
    await sleep(150);
    await page.keyboard.press('Escape');
  }
  await click(allTab(page), 'All Tasks');
  const b = await openTasks(page, SCHEDULE);
  await click(doneToggle(b), 'unfold Done');
  await click(doneToggle(b), 'fold Done');
  await (await must(filterTasks(page), 'Filter Tasks…')).fill('za');
  await filterTasks(page).fill('');
  await pickTag(page, 'doma');
  await page.keyboard.press('Escape');
  await click(main(page).getByRole('button', { name: /^⟦?Remove #doma⟧?$/ }).or(main(page).getByRole('button', { name: /^⟦?Clear tags⟧?$/ })).first(), 'remove #doma');
  for (const p of [T.t01, T.t03, T.t04]) {
    await click(taskMore(taskCard(b, p), nfc(p.split('/').pop()!.replace(/\.md$/, ''))), 'More actions');
    await sleep(100);
    await page.keyboard.press('Escape');
  }
  await click(taskCard(b, T.t01).getByRole('link', { name: 'Zavolat Janě', exact: true }).first(), 'follow the title');
  await mustBeOn(page, 'Zavolat Janě', 'the task');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Tasks', 'Back');
  await click(main(page).getByRole('button', { name: /^⟦?Type settings⟧?$/ }), 'Type settings');
  await sleep(300);
  await page.keyboard.press('Meta+[');
  await sleep(300);
  assert.deepEqual(await writesTo(core), [], 'the tour writes no vault file');
  assert.deepEqual(await mutatingCalls(core), [], 'and sends no write command (UI state only)');
  assert.deepEqual(await changedFiles(core, vault.files), [], 'every vault file unchanged, nothing created');
  // Then each action writes exactly the files its criterion names, once each.
  const step = async (what: string, want: string[], act: () => Promise<void>) => {
    const before = await core.files();
    const n = (await writesTo(core)).length;
    await act();
    await eventually(() => changedFiles(core, before), (c) => c.length >= want.length, 3000);
    await sleep(400);
    assert.deepEqual(await changedFiles(core, before), [...want].map(nfc).sort(), `${what}: exactly ${want.join(', ')}`);
    assert.ok((await writesTo(core)).length - n <= want.length, `${what}: once each`);
  };
  let s = await openTasks(page, SCHEDULE);
  await step('checkbox', [T.t03], () => click(taskCheckbox(taskCard(s, T.t03), 'Zalít květiny'), 'checkbox'));
  await step('period drag', [T.t08], () => drag(page, taskCard(s, T.t08), dayGroup(s, '2026-10-16')));
  await click(doneToggle(s), 'unfold Done');
  await step('done-lane drop', [T.t02], () => drag(page, taskCard(s, T.t02), lane(s, 'done')));
  const k = await openTasks(page, KANBAN);
  await step('status drag', [T.t04], () => drag(page, taskCard(k, T.t04), lane(k, 'option:In progress')));
  await step('lane drag', [qfile(KANBAN)], () => drag(page, laneGrip(k, 'option:Waiting'), lane(k, 'option:To do'), { at: 'left' }));
  const tg = await openTasks(page, 'Podle štítků');
  await step('tag drag', [T.t05], () => drag(page, taskCard(tg, T.t05, 'tag:doma'), lane(tg, 'tag:čtení')));
  s = await openTasks(page, SCHEDULE);
  await step('sort change', [TASK_YML], async () => {
    await click(sortButton(toolbar(page)), 'the sort button');
    await click(page.getByRole('dialog').getByRole('button', { name: /^⟦?\+ Add sort⟧?$/ }), '+ Add sort');
    await page.keyboard.press('Escape');
  });
  await click(menuItem(await tabMenu(page, CEKA), 'Remove from Tasks page'), 'Remove Čeká');
  await sleep(500);
  await click(menuItem(await tabMenu(page, KANBAN), 'Move to trash'), 'Move Kanban to trash');
  await sleep(500);
  await step('Restore default views', [TASK_YML, qfile(KANBAN)], () => runCommand(page, 'Restore default views'));
  void NOW; void OLD_MOD; void touched; void tab; void tagList; void (null as unknown as Locator); void (null as unknown as FakeCoreHandle);
});
