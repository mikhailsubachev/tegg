// MS5 slice 5A-1 preview feedback, L5 (WebKit + fake core): the `All Tasks` view. FR-TSK-04 AC-15 (D-516): `type/task`
// is the Tasks page's third view, under the Tasks header; Task is not in the sidebar Types list (app-shell FR-UX-02
// AC-4 changed); the sidebar entry `Tasks` is current on the three routes and opens the last one shown (D-481).
// docs/acceptance/tasks.md (R40, R45 R1 note), types.md FR-TYP-09; interface docs/contracts/ms5-tasks.md §6.
// Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs. Written from the ACs and the contract only (D-61).
// Missing elements fail an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mainName, openNote, typeEntries, typesList } from './helpers';
import { rowTitles, typeTable } from './types-helpers';
import {
  T, attr, click, eventually, flat, gotoTasks, heading, main, must, mustBeOn, runCommand, seen, sectionOf, sidebarTasks, sleep, startTasksPage,
  titleOf, viewTab, views, writeCalls, column,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// Slice Q2-T (AC-Test-Change, D-1912; views.md part three): `type/task` with the views of the overlay; tablist `Views`, tab
// `All Tasks` (AP-1540); the remembered tab is `typeViews.lastTab.task` (D-1765); tabs add no history entry (D-1790); the
// first open shows the first view tab (D-1903); the summary `… done this week` (R204).
const SUMMARY = '15 open · 2 overdue · 1 done this week';
const startTasks = startTasksPage;
const ALL_TITLES = Object.values(T).map(titleOf).sort();

type View = 'Schedule' | 'Kanban' | 'All Tasks';
/** The selected tab of `Task views`, or null. */
async function selectedView(page: Page): Promise<string | null> {
  if (!(await seen(views(page), 2000))) return null;
  return views(page).first().evaluate((l) => ([...l.querySelectorAll('[role="tab"]')] as HTMLElement[])
    .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
}
async function mustShow(page: Page, view: View, how: string) {
  assert.equal(await eventually(() => selectedView(page), (v) => v === view, 3000), view, `${how}: ${view} selected`);
  if (view === 'All Tasks') await must(typeTable(page, 'Tasks'), `${how}: table Tasks`, 3000);
  if (view === 'Schedule') await must(sectionOf(page, 'today'), `${how}: Schedule sections`, 3000);
  if (view === 'Kanban') await must(column(page, 'To do'), `${how}: Kanban columns`, 3000);
}
async function sidebarCurrent(page: Page): Promise<string | null> {
  return attr(sidebarTasks(page), 'aria-current');
}

test('fr_tsk_04_ac15_task_is_not_in_the_types_list', async ({ page }) => {
  await startTasks(page);
  await must(typesList(page), 'Types list');
  const entries = await eventually(() => typeEntries(page), (v) => v.some(([l]) => l.startsWith('Pages')), 3000);
  assert.ok(entries.some(([l]) => l.startsWith('Pages')), `the Types list is shown: ${JSON.stringify(entries)}`);
  assert.deepEqual(entries.filter(([l]) => /^Tasks?\b/.test(l)), [], 'no Tasks entry in the Types list (D-516)');
  assert.ok(await seen(sidebarTasks(page)), 'the Tasks entry at the top stays');
});

test('fr_tsk_04_ac15_all_tasks_tab_opens_the_task_type_page', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await must(heading(page), 'heading Tasks');
  await mustBeOn(page, 'Tasks', 'type/task under the Tasks header');
  assert.ok(flat(await main(page).innerText()).includes(SUMMARY), `the summary "${SUMMARY}"`);
  assert.equal(await attr(viewTab(page, 'All Tasks'), 'aria-selected'), 'true', 'All Tasks selected');
  assert.equal(await attr(viewTab(page, 'Schedule'), 'aria-selected'), 'false');
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'false');
  await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  await must(main(page).getByRole('button', { name: 'New Task', exact: true }), 'New Task');
  await must(main(page).getByRole('searchbox', { name: 'Filter Tasks…', exact: true }), 'field Filter Tasks…');
  await must(main(page).getByRole('button', { name: 'Columns', exact: true }), 'Columns control');
  await must(typeTable(page, 'Tasks'), 'table Tasks');
  const rows = await eventually(() => rowTitles(page, 'Tasks'), (r) => r.length >= 19, 3000);
  assert.deepEqual(rows.map((r) => r.normalize('NFC')).sort(), ALL_TITLES, 'rows T01…T19 (Done and Cancelled included; no Šablona, Smazaný, Bez hlavičky)');
  assert.equal(await sidebarCurrent(page), 'page', 'the sidebar Tasks entry is current on type/task');
  assert.deepEqual(await writeCalls(core), [], 'showing the view writes nothing');
});

test('fr_tsk_04_ac15_sidebar_entry_is_current_on_all_three_views', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  for (const v of ['Schedule', 'Kanban', 'All Tasks', 'Schedule'] as View[]) {
    await click(viewTab(page, v), `tab ${v}`);
    await mustShow(page, v, `tab ${v}`);
    assert.equal(await eventually(() => sidebarCurrent(page), (c) => c === 'page', 2000), 'page', `${v}: sidebar Tasks has aria-current="page"`);
  }
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Inbox');
  assert.notEqual(await sidebarCurrent(page), 'page', 'not current elsewhere');
  assert.deepEqual(await writeCalls(core), [], 'switching views writes nothing');
});

test('fr_tsk_04_ac15_sidebar_entry_opens_the_last_view', async ({ page, browser }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await mustShow(page, 'All Tasks', 'tab All Tasks');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Inbox');
  await click(sidebarTasks(page), 'sidebar Tasks');
  await mustShow(page, 'All Tasks', 'the sidebar entry after All Tasks');
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await mustShow(page, 'Kanban', 'tab Kanban');
  await runCommand(page, 'Go to Inbox');
  await click(sidebarTasks(page), 'sidebar Tasks');
  await mustShow(page, 'Kanban', 'the sidebar entry after Kanban');
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await mustShow(page, 'All Tasks', 'tab All Tasks again');
  // Remembered per machine (D-1765): a new start with the stored UI state opens All Tasks (`lastTab.task: null`).
  const st = await eventually(() => core.uiState() as Promise<any>, (u) => u?.typeViews?.lastTab?.task === null, 2000);
  assert.equal(st?.typeViews?.lastTab?.task, null, 'typeViews.lastTab.task is stored with ui_state_set (null: All Tasks)');
  const p2 = await browser.newPage({ timezoneId: 'Europe/Prague' });
  const core2 = await startTasks(p2, { uiState: st });
  await click(sidebarTasks(p2), 'sidebar Tasks after a relaunch');
  await mustShow(p2, 'All Tasks', 'relaunch: the sidebar entry');
  assert.deepEqual(await writeCalls(core2), [], 'nothing written');
  await p2.close();
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac15_tabs_back_and_forward', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await mustShow(page, 'Schedule', 'Go to Tasks');
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await mustShow(page, 'All Tasks', 'tab All Tasks');
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await mustShow(page, 'Kanban', 'Kanban leads to tasks/kanban');
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await mustShow(page, 'All Tasks', 'All Tasks again');
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await mustShow(page, 'Kanban', 'Kanban again');
  // Q2-T (D-1790): switching tabs adds no history entry; Back leaves type/task, Forward returns on the same tab.
  await page.keyboard.press('Meta+BracketLeft');
  assert.notEqual(await eventually(() => mainName(page), (n) => n !== 'Tasks', 3000), 'Tasks', 'Back leaves the Tasks page');
  await page.keyboard.press('Meta+BracketRight');
  await mustShow(page, 'Kanban', 'Forward returns on the remembered tab');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac15_go_to_type_and_the_type_chip_open_all_tasks', async ({ page }) => {
  const core = await startTasks(page);
  await runCommand(page, 'Go to type: Tasks');
  // Q2-T (D-1903): the first open shows the first view tab.
  await mustShow(page, 'Schedule', 'Go to type: Tasks');
  await must(heading(page), 'the Tasks header');
  await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  await openNote(page, titleOf(T.t01));
  await click(main(page).getByRole('link', { name: 'Type: Task', exact: true }), 'type chip Type: Task (D-369)');
  await mustShow(page, 'Schedule', 'the type chip (the remembered tab)');
  await sleep(100);
  assert.equal(await sidebarCurrent(page), 'page', 'the sidebar Tasks entry is current');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});
