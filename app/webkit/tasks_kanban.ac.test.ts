// MS5 slice 5A-1, L5 (WebKit + fake core): the Kanban. FR-TSK-05 AC-1…AC-12. docs/acceptance/tasks.md (R40, R42,
// R44); interface docs/contracts/ms5-tasks.md §4 (`kanban`), §5 (one `note_write` per drop with the row's version as
// base, through @tegg/doc), §6.2 (pointer drag, `Alt` adds only, ⌥←/⌥→), §7 (fake core: `setFile` silent, versions).
// Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs. Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, T, attr, callsOf, card, cardPaths, click, column, columnIds, columns, description, drag, eventually, fileText, fileWhen, filterBtn, gotoKanban,
  groupBy, isDisabled, liveTexts, main, must, nfc, original, paths, quickAdd, runCommand, seen, sleep, sortBtn, startTasks, swap, tagBtn, taskText,
  tasksVault, textOf, titleOf, touched, viewTab, writeCalls, writesOf, mustBeOn,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const OLD_MOD = 'modified: 2026-10-01T09:00:00+02:00\n';
const cardIn = (page: Page, col: string, title: string) => column(page, col).getByRole('article', { name: `Task: ${title}`, exact: true });
async function noteWrites(core: Awaited<ReturnType<typeof startTasks>>) {
  return (await callsOf(core, 'note_write')).filter((c) => c.ok !== false);
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_tsk_05_ac1_kanban_by_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'true', 'Kanban selected');
  assert.equal(await attr(groupBy(page).getByRole('tab', { name: 'Status', exact: true }), 'aria-selected'), 'true', 'Group by Status');
  assert.deepEqual(await columnIds(page), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'no Cancelled column; No status last');
  assert.deepEqual(await columns(page), {
    'To do': paths('t01', 't03', 't19', 't05', 't06', 't07', 't08', 't17', 't16', 't18'), 'In progress': paths('t02', 't09'), Waiting: paths('t04'),
    Done: paths('t10', 't12'), 'no-status': paths('t14', 't15'),
  }, 'R42 cards in R42 order');
  const head = await must(column(page, 'To do').getByRole('heading', { level: 2 }), 'column heading');
  assert.match(await textOf(head), /^To do\s*10$/, 'heading `<label> <count>`');
  const dot = await column(page, 'To do').locator('[data-color], [data-dot]').count();
  assert.ok(dot > 0, 'the option colour dot');
  assert.ok((await textOf(main(page))).includes('Drag a card to another column to change its status. Done shows tasks completed in the last 7 days; Cancelled is hidden.'), 'the status hint');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
  await runCommand(page, 'Show Schedule');
  await runCommand(page, 'Show Kanban');
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'true', 'Show Kanban opens tasks/kanban');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_tsk_05_ac2_drag_to_change_the_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const from = await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03 in To do');
  let label = '';
  await drag(page, from, column(page, 'In progress'), { during: async () => { label = await textOf(column(page, 'In progress'), 500); } });
  assert.ok(label.includes('Drop to set status: In progress'), `the drop label over the target: ${label}`);
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length >= 1);
  assert.equal(w.length, 1, 'one note_write of T03');
  assert.equal(String((w[0].args as any).text), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), 'only status and modified');
  assert.ok(await seen(cardIn(page, 'In progress', 'Zalít květiny')), 'the card shows in In progress');
  assert.ok((await liveTexts(page)).includes('Moved "Zalít květiny" to In progress'), 'live region');
  await drag(page, await must(cardIn(page, 'In progress', 'Zalít květiny'), 'T03'), column(page, 'Done'));
  assert.ok((await fileWhen(core, T.t03, (t) => !!t?.includes('completed:')))?.includes(`completed: ${NOW}`), 'Done sets completed');
  await drag(page, await must(cardIn(page, 'Done', 'Zalít květiny'), 'T03 in Done'), column(page, 'To do'));
  assert.ok(!(await fileWhen(core, T.t03, (t) => !t?.includes('completed:')))?.includes('completed:'), 'back to To do removes it');
  const n = (await noteWrites(core)).length;
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'To do'));
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'no-status'));
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), main(page).getByRole('heading', { level: 1 }));
  assert.equal((await noteWrites(core)).length, n, 'same column, No status, outside: nothing written');
  assert.ok(await seen(cardIn(page, 'To do', 'Úklid garáže')), 'the card is put back');
  await drag(page, await must(cardIn(page, 'no-status', 'Bez stavu'), 'T14'), column(page, 'Waiting'));
  assert.equal(await fileWhen(core, T.t14, (t) => !!t?.includes('status: Waiting')), original(T.t14).replace(OLD_MOD, `modified: ${NOW}\nstatus: Waiting\n`), 'T14: status appended after the last entry');
});

// ------------------------------------------------------------------------------------------------ AC-3…AC-7

test('fr_tsk_05_ac3_kanban_by_tag', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Tag');
  assert.deepEqual(await columnIds(page), ['#čtení', '#doma', '#finance', '#práce', '#rodina', 'no-tag'], 'tag columns, then No tag');
  assert.deepEqual(await columns(page), {
    '#čtení': paths('t08'), '#doma': paths('t03', 't04', 't19', 't05'), '#finance': paths('t02'), '#práce': paths('t01', 't02', 't06', 't18'), '#rodina': paths('t18'),
    'no-tag': paths('t14', 't15', 't07', 't09', 't17', 't16'),
  }, 'R42 by tag; Done and Cancelled not shown');
  assert.ok((await textOf(cardIn(page, '#finance', 'Poslat rozpočet'))).includes('also in #práce'), 'T02 in finance: also in #práce');
  assert.ok((await textOf(cardIn(page, '#práce', 'Poslat rozpočet'))).includes('also in #finance'), 'T02 in práce: also in #finance');
  assert.ok((await textOf(main(page))).includes('Grouped by tag: a task with several tags shows in each tag’s column.'), 'the tag hint');
  await click(tagBtn(page, 'doma'), 'tag #doma');
  assert.deepEqual(await eventually(() => columnIds(page), (v) => v.length === 1), ['#doma'], 'only doma, no No tag');
});

test('fr_tsk_05_ac4_drag_moves_the_tag', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  await drag(page, await must(cardIn(page, '#doma', 'Koupit dárek'), 'T04'), column(page, '#práce'));
  assert.equal(await fileWhen(core, T.t04, (t) => t !== original(T.t04)), touched(swap(original(T.t04), 'tags: [doma]', 'tags: [práce]')), 'T04: [doma] → [práce]');
  await drag(page, await must(cardIn(page, '#doma', 'Úklid garáže'), 'T05'), column(page, '#čtení'));
  assert.equal(await fileWhen(core, T.t05, (t) => t !== original(T.t05)), touched(swap(original(T.t05), 'tags: [Doma]', 'tags: [čtení]')), 'T05: Doma removed (case-insensitive)');
  await drag(page, await must(cardIn(page, '#doma', 'Nákup'), 'T19'), column(page, '#práce'));
  assert.equal(await fileWhen(core, T.t19, (t) => t !== original(T.t19)), touched(swap(original(T.t19), `tags: [${'doma'.normalize('NFD')}]`, 'tags: [práce]')), 'T19: NFD entry replaced, NFD title kept');
  await drag(page, await must(cardIn(page, '#finance', 'Poslat rozpočet'), 'T02'), column(page, '#práce'));
  assert.equal(await fileWhen(core, T.t02, (t) => t !== original(T.t02)), touched(swap(original(T.t02), 'tags: [práce, finance]', 'tags: [práce]')), 'T02: only finance goes');
  await drag(page, await must(cardIn(page, 'no-tag', 'Obnovit pas'), 'T07'), column(page, '#doma'));
  assert.equal(await fileWhen(core, T.t07, (t) => t !== original(T.t07)), original(T.t07).replace(OLD_MOD, `modified: ${NOW}\ntags: [doma]\n`), 'T07: tags appended');
});

test('fr_tsk_05_ac5_alt_drag_adds_only', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  let label = '';
  await drag(page, await must(cardIn(page, '#doma', 'Zalít květiny'), 'T03'), column(page, '#finance'), { alt: true, during: async () => { label = await textOf(column(page, '#finance'), 500); } });
  assert.ok(label.includes('Drop to add #finance'), `Alt label: ${label}`);
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), touched(swap(original(T.t03), 'tags: [doma]', 'tags: [doma, finance]')), 'tags: [doma, finance]');
  assert.ok(await seen(cardIn(page, '#doma', 'Zalít květiny')) && await seen(cardIn(page, '#finance', 'Zalít květiny')), 'T03 in both columns');
  const t02 = await must(cardIn(page, '#finance', 'Poslat rozpočet'), 'T02');
  await drag(page, t02, column(page, '#práce'), { alt: true });
  assert.equal((await writesOf(core, T.t02)).length, 0, 'Alt onto a tag the task has: nothing written');
});

test('fr_tsk_05_ac6_inline_tags_stay', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  await drag(page, await must(cardIn(page, '#rodina', 'Štítek v textu'), 'T18 in rodina'), column(page, '#doma'));
  assert.equal(await fileWhen(core, T.t18, (t) => t !== original(T.t18)), touched(swap(original(T.t18), 'tags: [práce]', 'tags: [práce, doma]')), 'tags: [práce, doma], body unchanged');
  assert.ok((await liveTexts(page)).some((t) => t.includes('#rodina is in the text of "Štítek v textu" and stays.')), 'the non-modal note');
  assert.ok(await seen(cardIn(page, '#rodina', 'Štítek v textu')), 'T18 stays in rodina');
});

test('fr_tsk_05_ac7_no_tag_and_no_status_are_not_drop_targets', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  let label = 'unset';
  await drag(page, await must(cardIn(page, '#doma', 'Koupit dárek'), 'T04'), column(page, 'no-tag'), { during: async () => { label = await textOf(column(page, 'no-tag'), 300); } });
  assert.ok(!/Drop to/.test(label), `no drop label on No tag: ${label}`);
  await drag(page, await must(cardIn(page, '#doma', 'Koupit dárek'), 'T04'), column(page, '#doma'));
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
  assert.ok(await seen(cardIn(page, '#doma', 'Koupit dárek')), 'the card returns');
  await gotoKanban(page, 'Status');
  await drag(page, await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03'), column(page, 'no-status'));
  assert.deepEqual(await writeCalls(core), [], 'No status: nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_tsk_05_ac8_keyboard_moves', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await (await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03')).focus();
  await page.keyboard.press('Alt+ArrowRight');
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), '⌥→: next column');
  const f = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-column]')?.getAttribute('data-column') ?? null);
  assert.equal(f, 'In progress', 'the focus stays on the moved card in its new column');
  assert.ok((await liveTexts(page)).includes('Moved "Zalít květiny" to In progress'), 'announced');
  await (await must(cardIn(page, 'To do', 'Zavolat Janě'), 'T01')).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await sleep(300);
  assert.equal((await writesOf(core, T.t01)).length, 0, 'at the first real column nothing happens');
  await (await must(cardIn(page, 'Done', 'Vrátit knihy'), 'T12')).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await writesOf(core, T.t12)).length, 0, 'No status is skipped: nothing after Done');
  await (await must(cardIn(page, 'Waiting', 'Koupit dárek'), 'T04')).focus();
  await runCommand(page, 'Move task to previous column');
  assert.ok((await fileWhen(core, T.t04, (t) => t !== original(T.t04)))?.includes('status: In progress'), 'the palette command moves it back one column');
  await click(main(page).getByRole('button', { name: 'More actions for "Úklid garáže"', exact: true }), 'More of T05');
  await click(page.getByRole('menuitem', { name: 'Move to', exact: true }), 'Move to');
  await click(page.getByRole('menuitem', { name: 'Waiting', exact: true }).or(page.getByRole('menuitemradio', { name: 'Waiting', exact: true })), 'Move to › Waiting');
  assert.ok((await fileWhen(core, T.t05, (t) => t !== original(T.t05)))?.includes('status: Waiting'), 'Move to › Waiting');
  await gotoKanban(page, 'Tag');
  await click(main(page).getByRole('button', { name: 'More actions for "Přečíst knihu"', exact: true }), 'More of T08');
  await click(page.getByRole('menuitem', { name: 'Also add to', exact: true }), 'Also add to');
  await click(page.getByRole('menuitem', { name: '#doma', exact: true }), 'Also add to › #doma');
  assert.equal(await fileWhen(core, T.t08, (t) => t !== original(T.t08)), touched(swap(original(T.t08), 'tags: [čtení]', 'tags: [čtení, doma]')), 'Also add to = Alt-drag');
});

// ------------------------------------------------------------------------------------------------ AC-9, AC-10

test('fr_tsk_05_ac9_filters_apply_to_every_column', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Status');
  await click(filterBtn(page, 'Today'), 'filter Today');
  assert.deepEqual(await eventually(() => columns(page), (c) => c['To do']?.length === 2), {
    'To do': paths('t01', 't03'), 'In progress': paths('t02'), Waiting: [], Done: paths('t10'), 'no-status': paths('t14'),
  }, 'Today per column');
  assert.ok((await textOf(column(page, 'Waiting'))).includes('No tasks'), 'Waiting: No tasks');
  const sort = await must(sortBtn(page, 'Due date'), 'Sort "Due date"');
  assert.equal(await isDisabled(sort), true, 'aria-disabled (AP-407)');
  assert.equal(await description(sort), 'Coming in v1.0');
});

test('fr_tsk_05_ac10_an_external_change_during_a_drag', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const ext = swap(original(T.t03), 'status: To do', 'status: Waiting');
  await drag(page, await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03'), column(page, 'In progress'), { during: async () => { await core.setFile(T.t03, ext, { silent: true }); } });
  await sleep(300);
  assert.equal(await fileText(core, T.t03), ext, 'nothing written: the file keeps the external bytes');
  assert.ok(await seen(cardIn(page, 'Waiting', 'Zalít květiny'), 2000), 'the card returns to the column of its disk state (Waiting) within 2 s');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.' }), 2000), 'the FR-TSK-02 AC-11 alert');
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'In progress'), { during: async () => { await core.setFile(T.t05, null, { silent: true }); } });
  await sleep(300);
  assert.equal(await fileText(core, T.t05), undefined, 'a task deleted while dragged is never written');
  assert.ok(await eventually(async () => !(await seen(card(page, 'Úklid garáže'), 200)), (x) => x, 2000), 'its card disappears');
});

// ------------------------------------------------------------------------------------------------ AC-11, AC-12

test('fr_tsk_05_ac11_new_task_in_a_column', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await click(column(page, 'Waiting').getByRole('button', { name: 'New task in Waiting', exact: true }), 'New task in Waiting');
  const field = await must(column(page, 'Waiting').getByRole('textbox'), 'a quick-add field at the top of Waiting');
  await field.fill('Zalít zahradu');
  await field.press('Enter');
  const created = await eventually(() => callsOf(core, 'note_create'), (c) => c.length === 1);
  assert.equal(created.length, 1, 'one create');
  const t = await fileWhen(core, 'Tasks/Zalít zahradu.md', (x) => x !== undefined);
  assert.ok(t && /^status: Waiting$/m.test(t) && !/^due:/m.test(t), `status: Waiting, no due: ${t}`);
  await gotoKanban(page, 'Tag');
  await click(column(page, '#doma').getByRole('button', { name: 'New task in #doma', exact: true }), 'New task in #doma');
  const f2 = await must(column(page, '#doma').getByRole('textbox'), 'field in #doma');
  await f2.fill('Vynést koš #zahrada');
  await f2.press('Enter');
  const t2 = await fileWhen(core, 'Tasks/Vynést koš.md', (x) => x !== undefined);
  assert.ok(t2 && /^tags: \[doma, zahrada\]$/m.test(t2), `tags: [doma, zahrada]: ${t2}`);
  await click(column(page, '#doma').getByRole('button', { name: 'New task in #doma', exact: true }), 'New task in #doma again');
  await (await must(column(page, '#doma').getByRole('textbox'), 'field')).fill('Nic');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal((await callsOf(core, 'note_create')).length, 2, 'Esc writes nothing');
  void quickAdd;
});

test('fr_tsk_05_ac12_many_statuses_scroll', async ({ page }) => {
  const extra = ['Na schválení', 'Zablokováno', 'Čeká na díly', 'Testuje se'].map((l) => `      - { label: ${l}, state: open, color: purple }\n`).join('');
  const vault = tasksVault((f) => { f['.tegg/types/task.yml'] = swap(f['.tegg/types/task.yml'], '      - { label: Done, state: done, color: green }\n', `${extra}      - { label: Done, state: done, color: green }\n`); });
  await startTasks(page, { vault });
  await gotoKanban(page, 'Status');
  assert.equal((await columnIds(page)).filter((c) => c !== 'no-status').length, 8, '9 options minus Cancelled');
  const board = await main(page).evaluate((m) => {
    const cols = [...m.querySelectorAll('[data-column]')] as HTMLElement[];
    const scroller = cols[0]?.parentElement;
    const cardEl = m.querySelector('[data-column] [data-path]') as HTMLElement | null;
    return { scroll: scroller ? scroller.scrollWidth > scroller.clientWidth : false, width: cardEl?.getBoundingClientRect().width ?? 0 };
  });
  assert.equal(board.scroll, true, 'the board scrolls horizontally');
  assert.equal(Math.round(board.width), 272, 'cards keep their 272 px width');
  await (await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03')).focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('Alt+ArrowRight');
  const visible = await column(page, 'Done').evaluate((e) => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });
  assert.equal(visible, true, 'the last column is reachable by keyboard and scrolled into view');
});

void titleOf; void taskText; void cardPaths; void nfc;
