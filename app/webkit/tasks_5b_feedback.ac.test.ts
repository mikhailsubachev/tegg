// MS5 slice 5B preview feedback, L5 (WebKit + fake core): docs/acceptance/tasks.md FR-TSK-04 AC-18 (the sidebar count is
// the open tasks, D-588), FR-TSK-05 AC-14 (no status chip on the Kanban by status, D-589) and FR-TSK-09 AC-4 (D-587; since
// D-763 the card menu's `Due date…` opens the one date picker `Pick date`, date-picker.md FR-TSK-09 AC-5); docs/feedback/ms5-5b.md F4, F6, F2. Interface:
// tasks.md R40, R43, types.md R10 (the `Choose date` month grid, ms3-shell §14 `dialog` `Choose date`), the fake core of
// ms5-tasks §7. Clock 2026-10-14T12:00 Europe/Prague, region `cs`. Written from the ACs and the public interfaces only
// (D-61). Every lookup goes through `must`, so a missing control fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  T, callsOf, card, cardPaths, checkbox, click, column, description, eventually, fileWhen, flat, gotoKanban, gotoTasks, main, moreBtn,
  must, original, runCommand, sectionOf, sidebarTasks, sleep, startTasks, swap, tasksVault, textOf, titleOf, touched, writeCalls, writesOf,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-18

/** The number the sidebar entry `Tasks` shows ('' when none). */
async function tasksCount(page: Page): Promise<string> {
  const e = await must(sidebarTasks(page), 'sidebar entry Tasks');
  return flat(await e.innerText()).replace(/^Tasks/, '').trim();
}

test('fr_tsk_04_ac18_the_sidebar_count_is_the_open_tasks', async ({ page, browser }) => {
  await startTasks(page);
  // Landed on Home: no visit to `tasks` yet (the count needs none).
  // The count comes from the core after the frame shows: wait for it rather than reading at once.
  assert.equal(await eventually(() => tasksCount(page), (c) => c === '15', 5000), '15', 'the sidebar shows the open tasks (Open or In progress: 15), not overdue + due today (D-588)');
  assert.equal(await description(sidebarTasks(page)), '15 open tasks', 'with the description "15 open tasks"');
  await runCommand(page, 'Go to type: Projekty');
  await sleep(300);
  assert.equal(await tasksCount(page), '15', 'the same count on another route');
  await gotoTasks(page);
  await click(checkbox(card(page, titleOf(T.t03)), titleOf(T.t03)), 'complete T03');
  assert.equal(await eventually(() => tasksCount(page), (c) => c === '14', 2000), '14', 'after completing T03: 14 within 2 s');
  await runCommand(page, 'Go to Inbox');
  await sleep(300);
  assert.equal(await tasksCount(page), '14', 'the same count after leaving tasks');

  // A vault copy whose tasks are all Done or Cancelled (T10, T11, T12 Done; T13 Cancelled): no number.
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const p2 = await ctx.newPage();
  const open = Object.values(T).filter((p) => ![T.t10, T.t11, T.t12, T.t13].includes(p as never));
  await startTasks(p2, { vault: tasksVault((f) => { for (const p of open) delete f[p]; }) });
  assert.equal(await tasksCount(p2), '', 'no number when no task is open');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-14

const cardIn = (page: Page, col: string, title: string) => column(page, col).getByRole('article', { name: `Task: ${title}`, exact: true });

test('fr_tsk_05_ac14_no_status_chip_on_the_board_by_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await must(cardIn(page, 'In progress', titleOf(T.t02)), 'T02 in In progress');
  const chips: Record<string, string[]> = {};
  for (const col of ['To do', 'In progress', 'Waiting', 'Done']) {
    chips[col] = await column(page, col).first().evaluate((c) =>
      ([...c.querySelectorAll('article[data-path], [role="article"][data-path]')] as HTMLElement[])
        .filter((a) => a.querySelector('[data-status]'))
        .map((a) => (a.getAttribute('data-path') ?? '').normalize('NFC')));
  }
  assert.deepEqual(chips, { 'To do': [], 'In progress': [], Waiting: [], Done: [] }, 'no card in a status column shows the status chip (data-status absent, D-589)');
  assert.ok(!(await textOf(cardIn(page, 'In progress', titleOf(T.t02)))).includes('In progress'), 'T02 in In progress: no "In progress" chip');
  assert.ok(!(await textOf(cardIn(page, 'Waiting', titleOf(T.t04)))).includes('Waiting'), 'T04 in Waiting: no "Waiting" chip');
  // T15 in `No status` still shows its raw value with `Not a status` (AC-9).
  const t15 = await must(cardIn(page, 'no-status', titleOf(T.t15)), 'T15 in No status');
  const raw = await must(t15.locator('[data-status]'), 'T15: the status chip');
  assert.equal(await textOf(raw), 'Rozpracováno', 'the raw value');
  assert.equal(await description(raw), 'Not a status', 'Not a status');
  // Grouped by tag, T02's card shows `In progress` as before (R43).
  await gotoKanban(page, 'Tag');
  const t02 = await must(cardIn(page, '#finance', titleOf(T.t02)), 'T02 in #finance');
  assert.equal(await textOf(await must(t02.locator('[data-status]'), 'T02: status chip by tag')), 'In progress', 'by tag: the chip In progress');
  // The Schedule is unchanged: T04 shows `Waiting`.
  await gotoTasks(page);
  const t04 = await must(card(page, titleOf(T.t04)), 'T04 on Schedule');
  assert.equal(await textOf(await must(t04.locator('[data-status]'), 'T04: status chip on Schedule')), 'Waiting', 'Schedule: the chip Waiting');
  assert.deepEqual(await writeCalls(core), [], 'showing writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-09 AC-4

// D-763 (date-picker.md FR-TSK-09 AC-5, replacing AC-4's `Choose date`): `Due date…` opens the one date picker
// `Pick date` directly; its typed field is the textbox `Date`. The `Choose date` button and the `Due date` textbox go.
const calendar = (page: Page) => page.getByRole('dialog', { name: 'Pick date', exact: true });
const dueField = (page: Page) => calendar(page).getByRole('textbox', { name: 'Date', exact: true });
/** Days are named by the long date (R89); `day(n)` matches the day number as a whole word in the name. */
const day = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);

/** Opens `More actions for "<title>"` › `Due date…` on the Schedule card: the dialog `Pick date`. */
async function openDueDate(page: Page, title: string) {
  await click(moreBtn(card(page, title), title), `More actions for "${title}"`);
  await click(page.getByRole('menuitem', { name: 'Due date…', exact: true }), 'Due date…');
  await must(calendar(page), 'dialog "Pick date" of the card menu (D-763)');
}
/** The focused grid day's accessible name, '' when the focus isn't on a day of the grid. */
async function focusedDay(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.closest('[role="grid"]')) return '';
    return (a.getAttribute('aria-label') ?? a.closest('[role="gridcell"]')?.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

test('fr_tsk_09_ac4_due_date_opens_pick_date_and_choosing_writes_once', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await openDueDate(page, titleOf(T.t03));
  assert.equal(await page.getByRole('button', { name: 'Choose date', exact: true }).count(), 0, 'no Choose date button (D-763)');
  // The month of the current due date with the due day (14 Oct) focused; arrows move.
  assert.match(await eventually(() => focusedDay(page), (d) => day(14).test(d), 1000), day(14), 'the due day (14) is focused');
  await page.keyboard.press('ArrowRight');
  assert.match(await focusedDay(page), day(15), '→ moves to 15');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  assert.match(await focusedDay(page), day(21), '↓ moves a week to 21');
  await page.keyboard.press('ArrowUp');
  assert.match(await focusedDay(page), day(14), '↑ moves back to 14');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => calendar(page).count(), (n) => n === 0, 1000), 0, 'Esc closes the dialog');
  assert.deepEqual(await writeCalls(core), [], 'nothing written yet');
  // Choosing 20 October: ↓ (21), ← (20), ⏎.
  await openDueDate(page, titleOf(T.t03));
  await eventually(() => focusedDay(page), (d) => day(14).test(d), 1000);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  assert.match(await focusedDay(page), day(20), '20 is focused');
  await page.keyboard.press('Enter');
  const want = touched(swap(original(T.t03), 'due: 2026-10-14', 'due: 2026-10-20'));
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), want, 'Tasks/Zalít květiny.md: due: 2026-10-20 and modified, every other byte unchanged');
  await sleep(300);
  assert.equal((await writesOf(core, T.t03)).length, 1, 'written once');
  assert.equal(await page.getByRole('menu').count(), 0, 'the menu closes');
  // 20 Oct is after the current week (Mon 12 – Sun 18 Oct in `cs`), so R41 puts it in Later.
  const later = await eventually(() => cardPaths(sectionOf(page, 'later')), (p) => p.includes(T.t03), 2000);
  assert.ok(later.includes(T.t03), 'the card moves to the section of 20 Oct (R41: Later)');
});

test('fr_tsk_09_ac4_no_due_date_opens_today_and_typing_still_works', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  // T08 has no due date: the grid opens on today's month with today (14) focused.
  await openDueDate(page, titleOf(T.t08));
  assert.match(await eventually(() => focusedDay(page), (d) => day(14).test(d), 1000), day(14), 'today (14) is focused');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
  // Typing a date in the picker's `Date` field and ⏎ still works (FR-TSK-02 AC-10's write path), on T07.
  await openDueDate(page, titleOf(T.t07));
  await dueField(page).fill('16. 10. 2026');
  await dueField(page).press('Enter');
  assert.equal(await fileWhen(core, T.t07, (t) => t !== original(T.t07)), touched(swap(original(T.t07), 'due: 2026-12-01', 'due: 2026-10-16')), 'typed date: only due and modified');
  // The quick-add `Due` chip is unchanged (a token only, no picker opener).
  const qa = main(page).locator('[data-quick-add]');
  assert.equal(await qa.getByRole('button', { name: /Choose date|Pick date/ }).count(), 0, 'no picker in the quick-add row');
  assert.equal((await callsOf(core, 'note_write')).length, 1, 'one write in all');
});
