// MS5 slice 5A-1, L5 (WebKit + fake core): no writes but the user's. FR-TSK-04 AC-13 (opening and browsing send no
// write command), FR-SYN-06 AC-20 (the browsing tour counts zero write commands; the vault check is L6), FR-SYN-06
// AC-21 (each action writes exactly one path). docs/acceptance/tasks.md; interface docs/contracts/ms5-tasks.md §3
// (`task_list`, `daily_tasks` read-only), §5, §7 (`writesTo` per path). Written from the ACs and the contract only
// (D-61). `ui_state_set` is machine-local (D-128) and isn't a vault write.
//
// Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row FR-TSK-04 AC-13, FR-SYN-06 AC-20, AC-21): the tour of
// FR-SYN-06 AC-50 on `type/task` (tabs, folds and the tag filter write only ui-state.json; no date filter, no `Group by`);
// the quick-add action goes (D-1780); moves use R207's `Move card to next lane` (no ⌥→, D-1905); a period move is one write.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { cmdD, gotoDaily, section } from './daily-helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import { ui as tasksUi } from './tasks-helpers';
import {
  O, T, card, checkbox, click, column, eventually, fileWhen, gotoKanban, gotoTasks, main, moreBtn, must, mustBeOn, nfc, viewsOriginal as original,
  runCommand, sectionOf, seen, sleep, startTasksPage as startTasks, addTag, clearTagsBtn, removeTagBtn, writeCalls, writtenSince, viewTab,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function everyMenu(page: Page) {
  const buttons = main(page).getByRole('button', { name: /^More actions for "/ });
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    await buttons.nth(i).click();
    await must(page.getByRole('menu'), `card menu ${i + 1}`);
    await page.keyboard.press('Escape');
  }
  return n;
}

test('fr_tsk_04_ac13_opening_and_browsing_write_nothing', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await click(viewTab(page, 'Podle štítků'), 'tab Podle štítků');
  await click(viewTab(page, 'All Tasks'), 'tab All Tasks');
  await click(viewTab(page, 'Schedule'), 'tab Schedule');
  // D-518: the tag filter is a combobox; add each tag, remove it with its chip button, then ⌫ and Clear tags.
  for (const t of ['čtení', 'doma', 'finance', 'práce', 'rodina']) { await addTag(page, t); await click(removeTagBtn(page, t), `Remove #${t}`); }
  await addTag(page, 'doma'); await addTag(page, 'práce'); await page.keyboard.press('Backspace'); await page.keyboard.press('Escape');
  await click(clearTagsBtn(page), 'Clear tags');
  const done = sectionOf(page, 'done').getByRole('button', { name: /^(Expand|Collapse) Done$/ });
  await click(done, 'Expand Done'); await click(done, 'Collapse Done'); await click(done, 'Expand Done');
  assert.ok((await everyMenu(page)) >= 15, 'every card menu opened and closed');
  await (await must(card(page, 'Zavolat Janě'), 'card')).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await page.mouse.wheel(0, 2000);
  await sleep(300);
  assert.deepEqual(await writeCalls(core), [], 'no write command');
});

test('fr_syn_06_ac20_a_browsing_tour_sends_no_write', async ({ page }) => {
  // D-949: the tour opens titles and the source chip with a single click, so it runs under preview.mode = off.
  const core = await startTasks(page, setPreviewMode('off', { uiState: tasksUi() }));
  await gotoTasks(page);
  await click(sectionOf(page, 'done').getByRole('button', { name: /^Expand Done$/ }), 'Expand Done');
  for (const title of ['Zavolat Janě', 'Zalít květiny']) {
    await click(card(page, title).getByRole('link', { name: title, exact: true }), `title ${title}`);
    await mustBeOn(page, title, title, 5000);
    await page.keyboard.press('Meta+BracketLeft');
    await gotoTasks(page);
  }
  await click(card(page, 'Zavolat Janě').locator('[data-link-kind]'), 'source chip');
  await mustBeOn(page, 'Porada', 'Porada', 5000);
  await page.keyboard.press('Meta+BracketLeft');
  await gotoKanban(page, 'Status');
  await gotoKanban(page, 'Tag');
  await runCommand(page, 'Go to type: Tasks');
  await click(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  await must(page.getByRole('heading', { level: 1, name: 'Task type settings', exact: true }), 'Task type settings', 5000);
  await cmdD(page, '2026-10-14');
  await must(section(page, 'Tasks due').getByRole('checkbox').first(), 'Tasks due rows');
  await gotoDaily(page, '2026-10-09');
  await gotoDaily(page, '2026-10-15');
  assert.deepEqual(await writeCalls(core), [], 'zero write commands on the tour');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});

test('fr_syn_06_ac21_each_action_writes_exactly_one_file', async ({ page }) => {
  const core = await startTasks(page);
  const step = async (what: string, want: string, act: () => Promise<void>) => {
    const from = (await core.writesTo()).length;
    await act();
    const got = await eventually(() => writtenSince(core, from), (w) => w.length >= 1, 2000);
    await sleep(300);
    assert.deepEqual(await writtenSince(core, from), [nfc(want)], `${what}: exactly ${want}`);
    void got;
  };
  await gotoTasks(page);
  await step('checkbox', T.t03, () => click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'check T03'));
  await gotoKanban(page, 'Status');
  await step('status move', T.t04, async () => { await (await must(column(page, 'Waiting').getByRole('article', { name: 'Task: Koupit dárek' }), 'T04')).focus(); await runCommand(page, 'Move card to previous lane'); });
  await gotoKanban(page, 'Tag');
  await step('tag move', T.t08, async () => { await (await must(column(page, '#čtení').getByRole('article', { name: 'Task: Přečíst knihu' }), 'T08')).focus(); await runCommand(page, 'Move card to next lane'); });
  await gotoTasks(page);
  await (await must(viewTab(page, 'Schedule'), 'tab Schedule')).click();
  await step('period move', T.t07, async () => { await (await must(sectionOf(page, 'later').getByRole('article', { name: 'Task: Obnovit pas' }), 'T07')).focus(); await runCommand(page, 'Move card to previous lane'); });
  await runCommand(page, 'Go to type: Tasks');
  await click(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  const g = main(page).getByRole('region', { name: 'Properties', exact: true }).getByRole('group', { name: 'Status', exact: true });
  const edit = g.getByRole('button', { name: 'Edit Status', exact: true });
  if (await seen(edit, 500)) await edit.click();
  await step('status colour', O.taskYml, async () => {
    await click(g.getByRole('button', { name: 'Change color of Waiting', exact: true }), 'Change color of Waiting');
    await click(page.getByRole('menuitemradio', { name: 'Purple', exact: true }).or(page.getByRole('radio', { name: 'Purple', exact: true })), 'Purple');
  });
  await cmdD(page, '2026-10-14');
  await step('daily checkbox', T.t14, () => click(section(page, 'Tasks due').getByRole('checkbox', { name: 'Complete "Bez stavu"', exact: true }), 'check T14 in Tasks due'));
  const all = (await core.writesTo()).map(nfc);
  assert.ok(!all.some((p) => p.startsWith('Tags/') || p.startsWith('Daily/')), 'no Tag file, no Daily Note');
  assert.ok((await fileWhen(core, T.t14, (t) => t !== original(T.t14)))?.includes('status: Done'), 'T14 completed');
  void moreBtn;
});
