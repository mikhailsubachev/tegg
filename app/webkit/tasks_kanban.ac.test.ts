// MS5 slice 5A-1, L5 (WebKit + fake core): the Kanban. FR-TSK-05 AC-1…AC-12. docs/acceptance/tasks.md (R40, R42,
// R44); interface docs/contracts/ms5-tasks.md §4 (`kanban`), §5 (one `note_write` per drop with the row's version as
// base, through @tegg/doc), §6.2 (pointer drag, `Alt` adds only), §7 (fake core: `setFile` silent, versions).
// Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs. Written from the ACs and the contract only (D-61).
//
// Slice Q2-T (AC-Test-Change, D-1912; docs/acceptance/views.md "Existing criteria this slice changes (part three)"): the
// Kanban is the `Kanban` tab of `type/task` (views-tasks overlay) and the Kanban by tag is the runtime view `Podle štítků`
// (FR-TSK-05 AC-21; no `Group by` tablist, AP-1542). Lanes per D-1791 (T15's unknown value is its own lane `Rozpracováno`
// before `No Status`); all of a card's tags on it (no `also in`, D-1769); the drop label `Drop to set Status: <lane>`
// (R192); `+` opens a draft (FR-QRY-08); R187's 236 px lanes; the board keys and R207's commands replace ⌥←/⌥→ (D-1905).
// The date-filter part of AC-9 is superseded (D-1779); its tag part stands. Lanes never disappear under the tag filter
// (v1-views §29.6).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustBeDraft } from './helpers';
import {
  NOW, T, attr, callsOf, card, cardPaths, click, column, columnIds, columns, drag, eventually, fileText, fileWhen, gotoKanban,
  groupBy, liveTexts, main, must, nfc, paths, runCommand, seen, sleep, startTasksPage, swap, addTag, tagChips, taskText,
  tasksViewsVault, textOf, titleOf, touched, viewTab, writeCalls, writesOf, mustBeOn, viewsOriginal,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const startTasks = startTasksPage;
const original = viewsOriginal;
const OLD_MOD = 'modified: 2026-10-01T09:00:00+02:00\n';
const cardIn = (page: Page, col: string, title: string) => column(page, col).getByRole('article', { name: `Task: ${title}`, exact: true });
async function noteWrites(core: Awaited<ReturnType<typeof startTasks>>) {
  return (await callsOf(core, 'note_write')).filter((c) => c.ok !== false);
}
/** The drop label shown while dragging (part one's `div.board-drop`, or the lane's own text). */
async function dropText(page: Page, col: string): Promise<string> {
  const a = await page.locator('div.board-drop').first().innerText({ timeout: 300 }).catch(() => '');
  return `${a} ${await textOf(column(page, col), 300)}`;
}
const focusedLane = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('section[data-lane]')?.getAttribute('data-lane')?.normalize('NFC') ?? null);

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_tsk_05_ac1_kanban_by_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'true', 'Kanban selected');
  assert.equal(await groupBy(page).count(), 0, 'no `Group by` tablist (AP-1542)');
  assert.deepEqual(await columnIds(page), ['option:To do', 'option:In progress', 'option:Waiting', 'option:Done', 'unknown:Rozpracováno', 'none'],
    'no Cancelled lane; T15\'s unknown value its own lane; No Status last (D-1791)');
  assert.deepEqual(await columns(page), {
    'option:To do': paths('t01', 't03', 't19', 't05', 't06', 't07', 't08', 't17', 't16', 't18'), 'option:In progress': paths('t02', 't09'), 'option:Waiting': paths('t04'),
    'option:Done': paths('t10', 't12'), 'unknown:Rozpracováno': paths('t15'), none: paths('t14'),
  }, 'R208 cards in R208 order');
  assert.equal(await attr(column(page, 'To do'), 'aria-label'), 'To do, 10 Tasks', 'lane `<label>, <count>`');
  assert.equal(await attr(column(page, 'no-status'), 'aria-label'), 'No Status, 1 Task', '`No Status` (R192 `board.none`)');
  const dot = await column(page, 'To do').locator('[data-color], [data-dot]').count();
  assert.ok(dot > 0, 'the option colour');
  assert.ok(!(await textOf(main(page))).includes('Drag a card to another column to change its status.'), 'no `tasks.board.hint*` (R204 "Gone")');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
  await runCommand(page, 'Show Schedule');
  await runCommand(page, 'Show Kanban');
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'true', 'Show Kanban opens type/task on Kanban');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_tsk_05_ac2_drag_to_change_the_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const from = await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03 in To do');
  let label = '';
  await drag(page, from, column(page, 'In progress'), { during: async () => { label = await dropText(page, 'In progress'); } });
  assert.ok(label.includes('Drop to set Status: In progress'), `the drop label over the target (R192): ${label}`);
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length >= 1);
  assert.equal(w.length, 1, 'one note_write of T03');
  assert.equal(String((w[0].args as any).text), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), 'only status and modified');
  assert.ok(await seen(cardIn(page, 'In progress', 'Zalít květiny')), 'the card shows in In progress');
  assert.ok((await liveTexts(page)).includes('Moved "Zalít květiny" to In progress') || (await page.locator('div.sr-live').allInnerTexts()).some((t) => t.includes('Moved "Zalít květiny" to In progress')), 'live region');
  await drag(page, await must(cardIn(page, 'In progress', 'Zalít květiny'), 'T03'), column(page, 'Done'));
  assert.ok((await fileWhen(core, T.t03, (t) => !!t?.includes('completed:')))?.includes(`completed: ${NOW}`), 'Done sets completed');
  await drag(page, await must(cardIn(page, 'Done', 'Zalít květiny'), 'T03 in Done'), column(page, 'To do'));
  assert.ok(!(await fileWhen(core, T.t03, (t) => !t?.includes('completed:')))?.includes('completed:'), 'back to To do removes it');
  const n = (await noteWrites(core)).length;
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'To do'));
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'no-status'));
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'unknown:Rozpracováno'));
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), main(page).getByRole('heading', { level: 1 }));
  assert.equal((await noteWrites(core)).length, n, 'same lane, No Status, the unknown lane, outside: nothing written');
  assert.ok(await seen(cardIn(page, 'To do', 'Úklid garáže')), 'the card is put back');
  await drag(page, await must(cardIn(page, 'no-status', 'Bez stavu'), 'T14'), column(page, 'Waiting'));
  assert.equal(await fileWhen(core, T.t14, (t) => !!t?.includes('status: Waiting')), original(T.t14).replace(OLD_MOD, `modified: ${NOW}\nstatus: Waiting\n`), 'T14: status appended after the last entry');
});

// ------------------------------------------------------------------------------------------------ AC-3…AC-7

test('fr_tsk_05_ac3_kanban_by_tag', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Tag');
  assert.deepEqual(await columnIds(page), ['tag:čtení', 'tag:doma', 'tag:finance', 'tag:práce', 'tag:rodina', 'none'], 'tag lanes, then No Tags');
  assert.deepEqual(await columns(page), {
    'tag:čtení': paths('t08'), 'tag:doma': paths('t03', 't04', 't19', 't05'), 'tag:finance': paths('t02', 't10'), 'tag:práce': paths('t01', 't02', 't06', 't18'), 'tag:rodina': paths('t18'),
    none: paths('t14', 't15', 't07', 't09', 't17', 't16', 't12'),
  }, 'R208 by tag: Done-state cards of the last 7 days stay in their lanes (R201); Cancelled not shown');
  const tags = await cardIn(page, '#finance', 'Poslat rozpočet').locator('span.card-tag').allInnerTexts();
  assert.deepEqual(tags.map((t) => t.trim()).sort(), ['#finance', '#práce'], 'T02 shows all of its tags');
  assert.ok(!(await textOf(cardIn(page, '#finance', 'Poslat rozpočet'))).includes('also in'), 'no `also in` (D-1769)');
  await addTag(page, 'doma'); // D-518: the tag filter is a combobox
  const c = await eventually(() => columns(page), (v) => (v['tag:práce'] ?? ['x']).length === 0);
  assert.deepEqual(c['tag:doma'], paths('t03', 't04', 't19', 't05'), '#doma: its four cards');
  assert.deepEqual(Object.keys(c), ['tag:čtení', 'tag:doma', 'tag:finance', 'tag:práce', 'tag:rodina', 'none'], 'every lane stays shown (§29.6)');
  assert.deepEqual(Object.entries(c).filter(([k]) => k !== 'tag:doma').flatMap(([, v]) => v), [], 'the other lanes are empty');
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
  await drag(page, await must(cardIn(page, '#doma', 'Zalít květiny'), 'T03'), column(page, '#finance'), { alt: true, during: async () => { label = await dropText(page, '#finance'); } });
  assert.ok(label.includes('finance'), `Alt label names #finance: ${label}`);
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), touched(swap(original(T.t03), 'tags: [doma]', 'tags: [doma, finance]')), 'tags: [doma, finance]');
  assert.ok(await seen(cardIn(page, '#doma', 'Zalít květiny')) && await seen(cardIn(page, '#finance', 'Zalít květiny')), 'T03 in both lanes');
  const t02 = await must(cardIn(page, '#finance', 'Poslat rozpočet'), 'T02');
  await drag(page, t02, column(page, '#práce'), { alt: true });
  assert.equal((await writesOf(core, T.t02)).length, 0, 'Alt onto a tag the task has: nothing written');
});

test('fr_tsk_05_ac6_inline_tags_stay', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  await drag(page, await must(cardIn(page, '#rodina', 'Štítek v textu'), 'T18 in rodina'), column(page, '#doma'));
  assert.equal(await fileWhen(core, T.t18, (t) => t !== original(T.t18)), touched(swap(original(T.t18), 'tags: [práce]', 'tags: [práce, doma]')), 'tags: [práce, doma], body unchanged');
  const live = [...await liveTexts(page), ...await page.locator('div.sr-live').allInnerTexts()];
  assert.ok(live.some((t) => t.includes('#rodina is in the text of "Štítek v textu" and stays.')), 'the non-modal note');
  assert.ok(await seen(cardIn(page, '#rodina', 'Štítek v textu')), 'T18 stays in rodina');
});

test('fr_tsk_05_ac7_no_tag_and_no_status_are_not_drop_targets', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Tag');
  let label = 'unset';
  await drag(page, await must(cardIn(page, '#doma', 'Koupit dárek'), 'T04'), column(page, 'no-tag'), { during: async () => { label = await dropText(page, 'no-tag'); } });
  assert.ok(!/Drop to/.test(label), `no drop label on No Tags: ${label}`);
  await drag(page, await must(cardIn(page, '#doma', 'Koupit dárek'), 'T04'), column(page, '#doma'));
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
  assert.ok(await seen(cardIn(page, '#doma', 'Koupit dárek')), 'the card returns');
  await gotoKanban(page, 'Status');
  await drag(page, await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03'), column(page, 'no-status'));
  assert.deepEqual(await writeCalls(core), [], 'No Status: nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_tsk_05_ac8_keyboard_moves', async ({ page }) => {
  // Q2-T (R191, R207, D-1905): `Move card to next lane` / `previous lane`; ⌥←/⌥→ do nothing.
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await (await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03')).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await writesOf(core, T.t03)).length, 0, '⌥→ does nothing');
  await runCommand(page, 'Move card to next lane');
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), 'next lane');
  assert.equal(await eventually(() => focusedLane(page), (l) => l === 'option:In progress', 2000), 'option:In progress', 'the focus stays on the moved card in its new lane');
  await (await must(cardIn(page, 'To do', 'Zavolat Janě'), 'T01')).focus();
  await runCommand(page, 'Move card to previous lane');
  await sleep(300);
  assert.equal((await writesOf(core, T.t01)).length, 0, 'at the first lane nothing happens');
  await (await must(cardIn(page, 'Done', 'Vrátit knihy'), 'T12')).focus();
  await runCommand(page, 'Move card to next lane');
  await sleep(300);
  assert.equal((await writesOf(core, T.t12)).length, 0, '`Rozpracováno` and `No Status` are skipped: nothing after Done');
  await (await must(cardIn(page, 'Waiting', 'Koupit dárek'), 'T04')).focus();
  await runCommand(page, 'Move card to previous lane');
  assert.ok((await fileWhen(core, T.t04, (t) => t !== original(T.t04)))?.includes('status: In progress'), 'the palette command moves it back one lane');
  await click(main(page).getByRole('button', { name: 'More actions for "Úklid garáže"', exact: true }), 'More of T05');
  await click(page.getByRole('menuitem', { name: 'Move to', exact: true }), 'Move to');
  await click(page.getByRole('menuitem', { name: 'Waiting', exact: true }).or(page.getByRole('menuitemradio', { name: 'Waiting', exact: true })), 'Move to › Waiting');
  assert.ok((await fileWhen(core, T.t05, (t) => t !== original(T.t05)))?.includes('status: Waiting'), 'Move to › Waiting');
  await gotoKanban(page, 'Tag');
  await click(main(page).getByRole('button', { name: 'More actions for "Přečíst knihu"', exact: true }), 'More of T08');
  await click(page.getByRole('menuitem', { name: 'Also add to', exact: true }), 'Also add to');
  await click(page.getByRole('menuitem', { name: /^#?doma$/ }), 'Also add to › doma');
  assert.equal(await fileWhen(core, T.t08, (t) => t !== original(T.t08)), touched(swap(original(T.t08), 'tags: [čtení]', 'tags: [čtení, doma]')), 'Also add to = Alt-drag');
});

// ------------------------------------------------------------------------------------------------ AC-9, AC-10

test('fr_tsk_05_ac9_all_selected_tags_restrict_every_column', async ({ page }) => {
  // D-518: the tag filter of FR-TSK-04 AC-5 keeps only tasks with every selected tag, in every lane; each tab keeps its
  // own selection (D-1893).
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await addTag(page, 'práce');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['práce'], 'chip #práce');
  const one = await eventually(() => columns(page), (c) => c['option:To do']?.length === 3);
  assert.deepEqual([one['option:To do'], one['option:In progress'], one['option:Waiting'], one['option:Done']], [paths('t01', 't06', 't18'), paths('t02'), [], []], '#práce per lane');
  await addTag(page, 'finance');
  const both = await eventually(() => columns(page), (c) => Object.values(c).flat().length === 1);
  assert.deepEqual(Object.values(both).flat(), paths('t02'), '#práce and #finance: only T02');
  assert.deepEqual(both['option:In progress'], paths('t02'), 'in In progress');
  await gotoKanban(page, 'Tag');
  assert.deepEqual(await tagChips(page), [], '`Podle štítků` has its own selection');
  await addTag(page, 'práce');
  await addTag(page, 'finance');
  const t = await eventually(() => columns(page), (c) => Object.values(c).flat().length === 2);
  for (const id of ['tag:finance', 'tag:práce']) assert.deepEqual(t[id], paths('t02'), `${id}: only T02`);
  assert.equal(Object.keys(t).length, 6, 'every lane stays shown');
  assert.deepEqual(await writeCalls(core), [], 'filtering writes nothing');
});

test('fr_tsk_05_ac10_an_external_change_during_a_drag', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const ext = swap(original(T.t03), 'status: To do', 'status: Waiting');
  await drag(page, await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03'), column(page, 'In progress'), { during: async () => { await core.setFile(T.t03, ext, { silent: true }); } });
  await sleep(300);
  assert.equal(await fileText(core, T.t03), ext, 'nothing written: the file keeps the external bytes');
  assert.ok(await seen(cardIn(page, 'Waiting', 'Zalít květiny'), 2000), 'the card returns to the lane of its disk state (Waiting) within 2 s');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.' }), 2000), 'the FR-TSK-02 AC-11 alert');
  await drag(page, await must(cardIn(page, 'To do', 'Úklid garáže'), 'T05'), column(page, 'In progress'), { during: async () => { await core.setFile(T.t05, null, { silent: true }); } });
  await sleep(300);
  assert.equal(await fileText(core, T.t05), undefined, 'a task deleted while dragged is never written');
  assert.ok(await eventually(async () => !(await seen(card(page, 'Úklid garáže'), 200)), (x) => x, 2000), 'its card disappears');
});

// ------------------------------------------------------------------------------------------------ AC-11, AC-12

test('fr_tsk_05_ac11_new_task_in_a_column', async ({ page }) => {
  // Q2-T (FR-QRY-08 AC-2, FR-TSK-10 AC-13): a lane's `New Task in <lane>` opens the unsaved draft new/task pre-filled.
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await click(column(page, 'Waiting').getByRole('button', { name: 'New Task in Waiting', exact: true }), 'New Task in Waiting');
  await mustBeDraft(page, 'New Task in Waiting');
  assert.deepEqual(await core.writesTo(), [], 'nothing written before the first change');
  await page.keyboard.type('Zalít zahradu');
  await page.keyboard.press('Enter');
  const t = await fileWhen(core, 'Tasks/Zalít zahradu.md', (x) => x !== undefined);
  assert.ok(t && /^status: Waiting$/m.test(t) && !/^due:/m.test(t), `status: Waiting, no due: ${t}`);
  await gotoKanban(page, 'Tag');
  await click(column(page, '#doma').getByRole('button', { name: 'New Task in doma', exact: true }), 'New Task in doma');
  await mustBeDraft(page, 'New Task in doma');
  await page.keyboard.type('Vynést koš');
  await page.keyboard.press('Enter');
  const t2 = await fileWhen(core, 'Tasks/Vynést koš.md', (x) => x !== undefined);
  assert.ok(t2 && /^tags: \[doma\]$/m.test(t2), `tags: [doma]: ${t2}`);
  await gotoKanban(page, 'Tag');
  const n = (await core.writesTo()).length;
  await click(column(page, '#doma').getByRole('button', { name: 'New Task in doma', exact: true }), 'New Task in doma again');
  await mustBeDraft(page, 'New Task in doma again');
  await page.keyboard.press('Meta+[');
  await sleep(200);
  assert.equal((await core.writesTo()).length, n, 'a draft left unchanged writes nothing');
});

test('fr_tsk_05_ac12_many_statuses_scroll', async ({ page }) => {
  const extra = ['Na schválení', 'Zablokováno', 'Čeká na díly', 'Testuje se'].map((l) => `      - { label: ${l}, state: open, color: purple }\n`).join('');
  const vault = tasksViewsVault((f) => { f['.tegg/types/task.yml'] = swap(f['.tegg/types/task.yml'], '      - { label: Done, state: done, color: green }\n', `${extra}      - { label: Done, state: done, color: green }\n`); });
  await startTasks(page, { vault });
  await gotoKanban(page, 'Status');
  assert.equal((await columnIds(page)).filter((c) => c.startsWith('option:')).length, 8, '9 options minus Cancelled');
  const board = await main(page).evaluate((m) => {
    const lanes = [...m.querySelectorAll('section[data-lane]')] as HTMLElement[];
    const scroller = (lanes[0]?.closest('div.board-scroll') ?? lanes[0]?.parentElement) as HTMLElement | null;
    return { scroll: scroller ? scroller.scrollWidth > scroller.clientWidth : false, width: lanes[0]?.getBoundingClientRect().width ?? 0 };
  });
  assert.equal(board.scroll, true, 'the board scrolls horizontally');
  assert.equal(Math.round(board.width), 236, 'lanes keep R187\'s 236 px width');
  await (await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03')).focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  const visible = await column(page, 'Done').evaluate((e) => { const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });
  assert.equal(visible, true, 'the last lane is reachable by keyboard and scrolled into view');
});

void titleOf; void taskText; void cardPaths; void nfc; void mustBeOn;
