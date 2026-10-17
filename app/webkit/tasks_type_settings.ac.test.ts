// MS5 slice 5A-1, L5 (WebKit + fake core): status and priority definitions in `type-settings/task`. FR-TSK-02 AC-2…AC-9,
// AC-13; FR-TSK-03 AC-2; FR-TSK-01 AC-6. docs/acceptance/tasks.md (R44, R46); interface docs/contracts/ms5-tasks.md
// §2.2 (one op per action, one line per op; `needOpen` / `needDone`, `optionUsed`), §6.2 (the `State` select, `Used by
// <n>`), §7 (fake schema applies the ops). Every type-file write is checked by bytes; no task file may be written.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  O, T, attr, card, cardPaths, click, column, columnIds, description, eventually, fileText, fileWhen, gotoKanban, gotoTasks, groupsOf, isDisabled, main,
  must, mustBeOn, original, runCommand, sectionOf, seen, sleep, startTasks, swap, taskText, tasksVault, textOf, touched, nfc, checkbox,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const YML = O.taskYml;
const WAITING = '      - { label: Waiting, state: open, color: yellow }\n';
const props = (page: Page) => main(page).getByRole('region', { name: 'Properties', exact: true });
const property = (page: Page, name: string) => props(page).getByRole('group', { name, exact: true });
const option = (page: Page, prop: string, label: string) => property(page, prop).getByRole('list', { name: 'Options' }).getByRole('listitem').filter({ hasText: label });
const typeWrites = async (core: Awaited<ReturnType<typeof startTasks>>) => (await core.writesTo()).map(nfc);

async function gotoTaskSettings(page: Page) {
  await runCommand(page, 'Go to type: Tasks');
  await mustBeOn(page, 'Tasks', 'type page Tasks', 5000);
  await click(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings');
  await must(page.getByRole('heading', { level: 1, name: 'Task type settings', exact: true }), 'Task type settings', 5000);
}
async function expand(page: Page, name: string) {
  const g = await must(property(page, name), `property ${name}`);
  const edit = g.getByRole('button', { name: `Edit ${name}`, exact: true });
  if (await seen(edit, 500)) await edit.click();
  return g;
}
async function setState(page: Page, label: string, state: string) {
  await click(option(page, 'Status', label).getByRole('combobox', { name: /^State\b/ }), `State of ${label}`);
  await click(page.getByRole('option', { name: state, exact: true }), `State ${state}`);
}

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_tsk_02_ac2_colour_and_order_of_status_options', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTaskSettings(page);
  const g = await expand(page, 'Status');
  for (const f of ['Name', 'Key in frontmatter']) {
    const x = g.getByRole('textbox', { name: f, exact: true });
    if (await seen(x, 300)) assert.equal(await description(x), "Built-in properties can't be changed", `${f} locked`);
  }
  const label = option(page, 'Status', 'Waiting').getByRole('textbox', { name: 'Option label' });
  assert.notEqual(await description(label), 'Coming in MS5', 'status labels are editable in 5A (changes FR-TYP-06 AC-2)');
  await click(option(page, 'Status', 'Waiting').getByRole('button', { name: 'Change color of Waiting', exact: true }), 'Change color of Waiting');
  await click(page.getByRole('menuitemradio', { name: 'Purple', exact: true }).or(page.getByRole('radio', { name: 'Purple', exact: true })), 'Purple');
  assert.equal(await fileWhen(core, YML, (t) => !!t?.includes('color: purple }')), swap(original(YML), WAITING, '      - { label: Waiting, state: open, color: purple }\n'), 'only that line');
  await (await must(option(page, 'Status', 'Waiting').getByRole('button', { name: 'Drag to reorder Waiting', exact: true }), 'handle')).focus();
  await page.keyboard.press('Alt+ArrowUp');
  const moved = await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Waiting') < t.indexOf('label: In progress'));
  assert.equal(moved, swap(original(YML), '      - { label: In progress, state: in-progress, color: blue }\n' + WAITING, '      - { label: Waiting, state: open, color: purple }\n      - { label: In progress, state: in-progress, color: blue }\n'), 'only the moved line');
  assert.deepEqual([...new Set(await typeWrites(core))], [YML], 'only task.yml written, no task file');
  await gotoKanban(page, 'Status');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[1] === 'Waiting', 2000), ['To do', 'Waiting', 'In progress', 'Done', 'no-status'], 'the Kanban follows within 2 s');
  assert.ok(await seen(column(page, 'Waiting').locator('[data-color="purple"]')), 'the new colour on the column');
});

// ------------------------------------------------------------------------------------------------ AC-3, AC-4

test('fr_tsk_02_ac3_add_a_status_with_a_state', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTaskSettings(page);
  const g = await expand(page, 'Status');
  await click(g.getByRole('button', { name: 'Add option', exact: true }), 'Add option');
  const row = g.getByRole('list', { name: 'Options' }).getByRole('listitem').last();
  const state = await must(row.getByRole('combobox', { name: /^State\b/ }), 'the State select');
  assert.equal(await textOf(state), 'Open', 'default Open');
  await state.click();
  assert.deepEqual((await page.getByRole('option').allInnerTexts()).map((x) => x.trim()), ['Open', 'In progress', 'Done', 'Cancelled'], 'the four states');
  await click(page.getByRole('option', { name: 'Done', exact: true }), 'Done');
  await click(row.getByRole('button', { name: /^Change color of/ }), 'colour');
  await click(page.getByRole('menuitemradio', { name: 'Teal', exact: true }).or(page.getByRole('radio', { name: 'Teal', exact: true })), 'Teal');
  const lbl = await must(row.getByRole('textbox', { name: 'Option label' }), 'label');
  await lbl.fill('Delegováno');
  await lbl.press('Enter');
  assert.equal(await fileWhen(core, YML, (t) => !!t?.includes('Delegováno')), swap(original(YML), '      - { label: Cancelled, state: cancelled, color: red }\n', '      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Delegováno, state: done, color: teal }\n'), 'exactly the appended line');
  await core.setFile('Tasks/Předáno.md', taskText(1, 'Předáno', 'status: Delegováno\n'));
  await gotoTasks(page);
  await click(sectionOf(page, 'done').getByRole('button', { name: /^Done\b/ }), 'Done');
  assert.ok((await eventually(() => cardPaths(sectionOf(page, 'done')), (v) => v.includes('Tasks/Předáno.md'))).includes('Tasks/Předáno.md'), 'in the Done section');
  assert.equal(await attr(checkbox(card(page, 'Předáno'), 'Předáno'), 'aria-checked'), 'true', 'checked');
  await gotoKanban(page, 'Status');
  const ids = await columnIds(page);
  assert.equal(ids.indexOf('Delegováno'), ids.indexOf('Done') + 1, 'a Delegováno column after Done');
});

test('fr_tsk_02_ac4_change_the_state_of_a_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  await setState(page, 'Waiting', 'In progress');
  assert.equal(await fileWhen(core, YML, (t) => !!t?.includes('label: Waiting, state: in-progress')), swap(original(YML), WAITING, '      - { label: Waiting, state: in-progress, color: yellow }\n'), 'only state in that line');
  assert.deepEqual([...new Set(await typeWrites(core))], [YML], 'no task file');
  await gotoTasks(page);
  assert.equal(await attr(card(page, 'Koupit dárek'), 'data-state'), 'in-progress', 'T04 counts as In progress');
  assert.ok((await groupsOf(sectionOf(page, 'week')))[0]?.paths.includes(T.t04), 'still open, still in This week');
});

// ------------------------------------------------------------------------------------------------ AC-5…AC-7

test('fr_tsk_02_ac5_used_labels_are_read_only', async ({ page }) => {
  const vault = tasksVault((f) => { delete f[T.t13]; });
  const core = await startTasks(page, { vault });
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  assert.ok(await seen(option(page, 'Status', 'To do').getByText('Used by 10')), 'To do: Used by 10');
  const used = option(page, 'Status', 'To do').getByRole('textbox', { name: 'Option label' });
  assert.equal(await isDisabled(used), true, 'read-only');
  assert.equal(await description(used), 'Renaming used options comes in v1.0', 'AP-403');
  const free = await must(option(page, 'Status', 'Cancelled').getByRole('textbox', { name: 'Option label' }), 'Cancelled label');
  await free.fill('Zrušeno');
  await free.press('Enter');
  assert.equal(await fileWhen(core, YML, (t) => !!t?.includes('Zrušeno')), swap(original(YML), 'label: Cancelled,', 'label: Zrušeno,'), 'only the label');
  assert.deepEqual([...new Set(await typeWrites(core))], [YML], 'no task file');
});

test('fr_tsk_02_ac6_removing_a_used_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  await click(option(page, 'Status', 'Waiting').getByRole('button', { name: 'Remove option Waiting', exact: true }), 'Remove option Waiting');
  const d = await must(page.getByRole('dialog'), 'the remove dialog');
  assert.ok((await textOf(d)).includes('1 object uses "Waiting". Its value stays in the file and shows as not an option.'), 'FR-TYP-03 AC-5 text');
  await click(d.getByRole('button', { name: 'Remove', exact: true }), 'Remove');
  assert.equal(await fileWhen(core, YML, (t) => !t?.includes('label: Waiting')), swap(original(YML), WAITING, ''), 'only that line');
  assert.equal(await fileText(core, T.t04), original(T.t04), 'T04 untouched');
  await gotoKanban(page, 'Status');
  const c = await must(column(page, 'no-status').getByRole('article', { name: 'Task: Koupit dárek' }), 'T04 in No status');
  assert.equal(await description(await must(c.locator('[data-status]'), 'chip')), 'Not a status');
  await gotoTasks(page);
  assert.ok((await groupsOf(sectionOf(page, 'week')))[0]?.paths.includes(T.t04), 'T04 stays in This week (Open)');
});

test('fr_tsk_02_ac7_keep_one_open_and_one_done_status', async ({ page }) => {
  // A copy whose only Open-state status is To do (Waiting is In progress), so each refusal is a single action.
  const vault = tasksVault((f) => { f[YML] = swap(f[YML], WAITING, '      - { label: Waiting, state: in-progress, color: yellow }\n'); });
  const core = await startTasks(page, { vault });
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  await click(option(page, 'Status', 'Done').getByRole('button', { name: 'Remove option Done', exact: true }), 'Remove option Done');
  const d = page.getByRole('dialog');
  if (await seen(d, 500)) await click(d.getByRole('button', { name: 'Remove', exact: true }), 'Remove');
  assert.ok(await seen(page.getByText('Keep at least one status with the state Done.'), 2000), 'removing the last Done status is refused');
  await setState(page, 'Done', 'Open');
  assert.ok(await seen(page.getByText('Keep at least one status with the state Done.'), 2000), 'changing its state is refused');
  await setState(page, 'To do', 'Done');
  assert.ok(await seen(page.getByText('Keep at least one status with the state Open.'), 2000), 'changing the last Open status is refused');
  assert.equal(await fileText(core, YML), vault.files[YML], 'nothing written');
  assert.deepEqual(await typeWrites(core), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ AC-8, AC-9

test('fr_tsk_02_ac8_the_app_follows_states_not_labels', async ({ page }) => {
  const vault = tasksVault((f) => {
    f[YML] = swap(f[YML], '      - { label: Done, state: done, color: green }\n', '      - { label: Hotovo, state: done, color: green }\n      - { label: Odloženo, state: cancelled, color: gray }\n');
    for (const p of [T.t10, T.t11, T.t12]) f[p] = swap(f[p], 'status: Done', 'status: Hotovo');
    f['Tasks/Odložený.md'] = taskText(2, 'Odložený', 'status: Odloženo\ndue: 2026-10-09\n');
  });
  const core = await startTasks(page, { vault });
  await gotoTasks(page);
  assert.ok((await textOf(main(page))).includes('15 open · 2 overdue · 2 due today'), 'counts follow the states (Odloženo is not open)');
  await click(sectionOf(page, 'done').getByRole('button', { name: /^Done\b/ }), 'Done');
  assert.ok(!(await cardPaths(main(page))).includes('Tasks/Odložený.md'), 'Odloženo is in no section');
  assert.equal(await attr(card(page, 'Odložený'), 'data-overdue'), null, 'never overdue');
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'check T03');
  assert.ok((await fileWhen(core, T.t03, (t) => t !== original(T.t03)))?.includes('status: Hotovo'), 'checking writes status: Hotovo');
  await gotoKanban(page, 'Status');
  assert.ok(!(await cardPaths(main(page))).includes('Tasks/Odložený.md'), 'and no column');
});

test('fr_tsk_02_ac9_missing_and_unknown_values', async ({ page }) => {
  const vault = tasksVault((f) => {
    f[YML] = swap(f[YML], '      - { label: Cancelled, state: cancelled, color: red }\n', '      - { label: Cancelled, state: cancelled, color: red }\n      - { label: Blokováno, color: red }\n      - { label: Pozastaveno, state: blocked, color: purple }\n');
  });
  const core = await startTasks(page, { vault });
  await gotoTasks(page);
  assert.ok((await groupsOf(sectionOf(page, 'today')))[1]?.paths.includes(T.t14), 'T14 in Today');
  assert.ok((await cardPaths(sectionOf(page, 'week'))).includes(T.t15), 'T15 in This week');
  await gotoKanban(page, 'Status');
  assert.deepEqual(await cardPaths(column(page, 'no-status')), [T.t14, T.t15], 'both in No status');
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  assert.ok(await seen(option(page, 'Status', 'Pozastaveno').getByRole('status').filter({ hasText: 'Unknown state "blocked". Using Open.' })), 'the warning next to that option');
  assert.equal(await textOf(option(page, 'Status', 'Blokováno').getByRole('combobox', { name: /^State\b/ })), 'Open', 'no state shows Open');
  assert.deepEqual(await typeWrites(core), [], 'reading, showing and opening type settings write nothing');
  assert.deepEqual([await fileText(core, YML), await fileText(core, T.t14), await fileText(core, T.t15)], [vault.files[YML], original(T.t14), original(T.t15)], 'bytes unchanged');
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_tsk_02_ac13_type_file_changes_from_outside', async ({ page }) => {
  const vault = tasksVault((f) => { delete f[T.t13]; });
  const core = await startTasks(page, { vault });
  await gotoKanban(page, 'Status');
  const ext = swap(swap(swap(original(YML), 'label: Cancelled,', 'label: Zrušeno,'), WAITING, '      - { label: Waiting, state: open, color: purple }\n'),
    '      - { label: Done, state: done, color: green }\n', '      - { label: Done, state: done, color: green }\n      - { label: Delegováno, state: done, color: teal }\n');
  await core.setFile(YML, ext);
  assert.ok((await eventually(() => columnIds(page), (c) => c.includes('Delegováno'), 2000)).includes('Delegováno'), 'the Kanban shows Delegováno within 2 s');
  assert.ok(await seen(column(page, 'Waiting').locator('[data-color="purple"]'), 2000), 'and the new colour');
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  assert.ok(await seen(option(page, 'Status', 'Zrušeno')), 'type settings shows the rename');
  assert.deepEqual(await typeWrites(core), [], 'no write');
  await core.setFile(YML, swap(ext, 'color: teal }', 'color: blue }'), { silent: true });
  await click(option(page, 'Status', 'Waiting').getByRole('button', { name: 'Change color of Waiting', exact: true }), 'Change color');
  await click(page.getByRole('menuitemradio', { name: 'Green', exact: true }).or(page.getByRole('radio', { name: 'Green', exact: true })), 'Green');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: /^Changed outside Tegg\. Your change to .* wasn't saved\.$/ }), 2000), 'Conflict and the FR-TYP-01 AC-7 message');
  assert.ok((await fileText(core, YML))?.includes('color: blue }'), 'the external bytes stay');
  await core.setFile(YML, null);
  await gotoKanban(page, 'Status');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[3] === 'Done' && !c.includes('Delegováno'), 2000), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'the built-in statuses apply (D-90)');
  await gotoTaskSettings(page);
  await expand(page, 'Status');
  await click(option(page, 'Status', 'Waiting').getByRole('button', { name: 'Change color of Waiting', exact: true }), 'Change color');
  await click(page.getByRole('menuitemradio', { name: 'Purple', exact: true }).or(page.getByRole('radio', { name: 'Purple', exact: true })), 'Purple');
  assert.equal(await fileWhen(core, YML, (t) => t !== undefined), swap(original(YML), WAITING, '      - { label: Waiting, state: open, color: purple }\n'), 'the whole default file with only that change (FR-TYP-06 AC-4)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-03 AC-2, FR-TSK-01 AC-6

test('fr_tsk_03_ac2_priority_options', async ({ page }) => {
  const vault = tasksVault((f) => {
    f['Tasks/Nízká.md'] = taskText(3, 'Nízká', 'status: To do\npriority: Low\n');
    f['Tasks/Střední.md'] = taskText(4, 'Střední', 'status: To do\npriority: Medium\n');
  });
  const core = await startTasks(page, { vault });
  await gotoTaskSettings(page);
  await expand(page, 'Priority');
  await (await must(option(page, 'Priority', 'Low').getByRole('button', { name: 'Drag to reorder Low', exact: true }), 'handle Low')).focus();
  await page.keyboard.press('Alt+ArrowUp');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Low') < t.indexOf('label: Medium')),
    swap(original(YML), '      - { label: Medium, color: orange }\n      - { label: Low, color: blue }\n', '      - { label: Low, color: blue }\n      - { label: Medium, color: orange }\n'), 'only the moved line');
  await gotoTasks(page);
  const none = await eventually(() => cardPaths(sectionOf(page, 'none')), (v) => v.indexOf('Tasks/Nízká.md') >= 0 && v.indexOf('Tasks/Nízká.md') < v.indexOf('Tasks/Střední.md'), 2000);
  assert.ok(none.indexOf('Tasks/Nízká.md') < none.indexOf('Tasks/Střední.md'), 'Low now precedes Medium wherever sorted by priority');
  await gotoTaskSettings(page);
  const g = await expand(page, 'Priority');
  await click(g.getByRole('button', { name: 'Add option', exact: true }), 'Add option');
  const lbl = await must(g.getByRole('list', { name: 'Options' }).getByRole('textbox', { name: 'Option label' }).last(), 'new label');
  await lbl.fill('Kritická');
  await lbl.press('Enter');
  await fileWhen(core, YML, (t) => !!t?.includes('Kritická'));
  await (await must(option(page, 'Priority', 'Kritická').getByRole('button', { name: 'Drag to reorder Kritická', exact: true }), 'handle')).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+ArrowUp');
  const t = await fileWhen(core, YML, (x) => !!x && x.indexOf('label: Kritická') < x.indexOf('label: High'));
  assert.ok(t && t.indexOf('label: Kritická') < t.indexOf('label: High'), 'Kritická first');
  const used = option(page, 'Priority', 'High').getByRole('textbox', { name: 'Option label' });
  assert.equal(await isDisabled(used), true, 'a used priority label is read-only');
  assert.deepEqual([...new Set(await typeWrites(core))], [YML], 'no task file written');
});

test('fr_tsk_01_ac6_own_attributes_on_task', async ({ page }) => {
  const vault = tasksVault((f) => { f[YML] = `${f[YML]}  - key: projekt\n    name: Projekt\n    type: relation\n    to: [projekt]\n`; });
  const core = await startTasks(page, { vault, at: T.t01 });
  await mustBeOn(page, 'Zavolat Janě', 'T01', 5000);
  await click(page.getByRole('region', { name: 'Properties', exact: true }).getByRole('button', { name: 'Add Projekt', exact: true }), 'Projekt relation (Add Projekt, FR-TYP-02)');
  await page.keyboard.type('Web');
  await sleep(200);
  await page.keyboard.press('Enter');
  const t = await fileWhen(core, T.t01, (x) => !!x?.includes('projekt:'));
  assert.ok(t?.includes('projekt: "[[Web]]"\n'), 'projekt: "[[Web]]" in T01');
  assert.equal(await fileText(core, O.web), original(O.web), 'Web untouched');
  await gotoTasks(page);
  assert.ok((await groupsOf(sectionOf(page, 'today')))[0]?.paths.includes(T.t01), 'T01 still in every view as before');
  assert.ok(!(await cardPaths(main(page))).includes(O.web), 'Web stays out of every task view');
  void touched;
});
