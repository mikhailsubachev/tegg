// Preview v0.94 feedback, L5 (WebKit + fake core): the title search on the Schedule and the Kanban.
// docs/acceptance/tasks.md R40 row `Search`, FR-TSK-04 AC-19 (matching, sections), AC-20 (what the search doesn't
// change), AC-21 (keyboard, lifetime, writes, the palette command, strings and themes), FR-TSK-05 AC-16 (the Kanban
// keeps its columns); AP-1180…AP-1184 → D-1280…D-1284. Interface docs/contracts/ms5-tasks.md §13: the type page's
// field (`searchbox` `Filter Tasks…`, `typePage.filter` / `typePage.noMatch` with the Task plural), `TasksPage` state
// only (never in `TasksUiDto`), palette command `tasks.search` `Filter tasks` with `data-command="tasks.search"` on the
// field. Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region `cs`. Written from the ACs and the contract only
// (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  NOW, T, absent, addTag, allCards, attr, callsOf, card, cardPaths, click, column, columnIds, columns, description, drag, eventually, fileWhen,
  filterBtn, flat, gotoKanban, gotoTasks, groupBy, groupsOf, heading, liveTexts, main, must, mustBeOn, nfc, openTagList, original, paths, quickAdd,
  runCommand, sectionIds, sectionOf, seen, shortDate, sidebarTasks, sleep, sortBtn, startTasks, swap, tagChips, tagOptions, taskText, textOf, touched,
  viewTab, writeCalls, writesOf,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const SUMMARY = '15 open · 2 overdue · 2 due today';
/** R40 (v0.94): the view's title search, the type page's field. */
const searchBox = (page: Page) => main(page).getByRole('searchbox', { name: 'Filter Tasks…', exact: true });
const noMatch = (page: Page, text: string) => main(page).getByRole('status').filter({ hasText: `No Tasks match "${text}"` });
const doneToggle = (page: Page) => sectionOf(page, 'done').getByRole('button', { name: /^Done\b/ });
const cardIn = (page: Page, col: string, title: string) => column(page, col).getByRole('article', { name: `Task: ${title}`, exact: true });

/** Puts `text` into the search field the way a user types it (focus, clear, insert). */
async function search(page: Page, text: string): Promise<Locator> {
  const f = await must(searchBox(page), 'searchbox "Filter Tasks…" (R40, v0.94)');
  await f.fill('');
  await f.focus();
  await page.keyboard.insertText(text);
  await sleep(150);
  return f;
}
async function fieldValue(page: Page): Promise<string> {
  const f = await must(searchBox(page), 'searchbox "Filter Tasks…"');
  return nfc(await f.inputValue());
}
async function fieldFocused(page: Page): Promise<boolean> {
  if (!(await seen(searchBox(page), 1000))) return false;
  return searchBox(page).first().evaluate((e) => e === document.activeElement);
}
async function focusedPath(page: Page): Promise<string | null> {
  const p = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-path]')?.getAttribute('data-path') ?? null);
  return p && nfc(p);
}
/** The search field sits right before `Sort` on the toolbar row, and `Sort` stays the row's last control (R40, AC-16). */
async function fieldBeforeSort(page: Page, sortLabel: string) {
  const f = await must(searchBox(page), 'searchbox "Filter Tasks…"');
  assert.equal(await f.getAttribute('placeholder'), 'Filter Tasks…', 'placeholder `Filter Tasks…` (typePage.filter, Task plural)');
  const sort = await must(sortBtn(page, sortLabel), `Sort "${sortLabel}"`);
  const handle = await f.elementHandle();
  const r = await sort.evaluate((s, field) => {
    const m = s.closest('main, [role="main"]') ?? document.body;
    const sel = 'button, input, select, textarea, a[href], [role="button"], [role="combobox"], [role="searchbox"], [role="tab"], [role="link"]';
    const ctrls = ([...m.querySelectorAll(sel)] as HTMLElement[]).filter((e) => e.getClientRects().length > 0);
    const i = ctrls.indexOf(s as HTMLElement);
    const prev = i > 0 ? ctrls[i - 1] : null;
    const sr = s.getBoundingClientRect();
    const fr = (field as HTMLElement).getBoundingClientRect();
    const after = ctrls.slice(i + 1).filter((e) => { const b = e.getBoundingClientRect(); return b.top < sr.bottom && b.bottom > sr.top && b.left >= sr.right - 0.5; });
    const f = field as HTMLElement;
    return { prevIsField: !!prev && (prev === f || f.contains(prev) || prev.contains(f)), sameRow: fr.top < sr.bottom && fr.bottom > sr.top, leftOf: fr.right <= sr.left + 0.5, after: after.length };
  }, handle);
  assert.equal(r.prevIsField, true, 'the search field is the control right before Sort');
  assert.equal(r.sameRow, true, 'on the toolbar row of Sort');
  assert.equal(r.leftOf, true, 'left of Sort');
  assert.equal(r.after, 0, 'Sort stays the last control of its row (AC-16)');
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-19

test('fr_tsk_04_ac19_the_field_is_right_before_sort', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await fieldBeforeSort(page, 'Priority, then due');
  assert.equal(await fieldValue(page), '', 'empty at first');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac19_za_leaves_t01_t03_and_t10', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await search(page, 'za');
  assert.deepEqual(await eventually(() => sectionIds(page), (s) => s.join() === 'today,done'), ['today', 'done'], 'only Today & overdue and Done are shown');
  assert.deepEqual(await groupsOf(sectionOf(page, 'today')), [
    { heading: 'Overdue', paths: paths('t01') },
    { heading: `Today · ${shortDate('2026-10-14', 'cs')}`, paths: paths('t03') },
  ], '`Overdue` T01, `Today` T03');
  const h = flat(await (await must(sectionOf(page, 'today').getByRole('heading', { level: 2 }), 'heading of Today & overdue')).innerText());
  assert.match(h, /^Today & overdue\s*2\b/, `the section count follows the cards: ${h}`);
  const done = await must(doneToggle(page), 'button Done');
  assert.equal(await done.getAttribute('aria-expanded'), 'false', 'Done stays collapsed');
  assert.match(flat(await done.innerText()), /^Done\s*1$/, 'Done 1');
  await done.click();
  assert.deepEqual(await eventually(() => cardPaths(sectionOf(page, 'done')), (v) => v.length > 0), paths('t10'), 'in Done: T10');
  assert.deepEqual(await writeCalls(core), [], 'typing writes nothing');
});

test('fr_tsk_04_ac19_case_and_diacritics_are_folded', async ({ page }) => {
  await startTasks(page);
  await gotoTasks(page);
  for (const q of ['ZALIT', 'zalít', 'kvetiny']) {
    await search(page, q);
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t03'), `${JSON.stringify(q)} leaves only T03`);
    assert.deepEqual(await sectionIds(page), ['today'], `${q}: only Today & overdue`);
  }
  for (const q of ['nakup', 'nákup'.normalize('NFD')]) {
    await search(page, q);
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t19'), `${JSON.stringify(q)} leaves only T19 (NFD title)`);
    assert.deepEqual(await sectionIds(page), ['week'], `${q}: only This week`);
    assert.equal((await groupsOf(sectionOf(page, 'week'))).length, 1, 'one day group (Thu 15)');
  }
});

test('fr_tsk_04_ac19_body_and_tags_are_not_matched', async ({ page }) => {
  await startTasks(page);
  await gotoTasks(page);
  for (const q of ['schuzku', 'doma']) {
    await search(page, q);
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 0), [], `${q}: no card`);
    assert.deepEqual(await sectionIds(page), [], `${q}: no section`);
    assert.ok(await seen(noMatch(page, q), 2000), `the status No Tasks match "${q}"`);
  }
});

test('fr_tsk_04_ac19_combines_with_the_tag_and_date_filters', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await addTag(page, 'práce');
  assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['práce'], 'chip #práce');
  await search(page, 'za');
  assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t01'), '#práce + `za` leaves T01');
  await click(main(page).getByRole('button', { name: 'Clear tags', exact: true }), 'Clear tags');
  await click(filterBtn(page, 'Today'), 'filter Today');
  await search(page, 'kvetiny');
  assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t03'), 'Today + `kvetiny` leaves T03');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac19_only_hidden_tasks_match_cesta', async ({ page }) => {
  await startTasks(page);
  await gotoTasks(page);
  await search(page, 'cesta');
  assert.deepEqual(await eventually(() => sectionIds(page), (s) => s.length === 0), [], 'no section is shown (T13 is Cancelled)');
  assert.ok(await seen(noMatch(page, 'cesta'), 2000), 'the status `No Tasks match "cesta"`');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-20

test('fr_tsk_04_ac20_the_search_changes_no_count', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await search(page, 'za');
  assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 2), paths('t01', 't03'), 'the search applies (control)');
  assert.ok(flat(await main(page).innerText()).includes(SUMMARY), `the summary stays "${SUMMARY}"`);
  assert.deepEqual(await Promise.all((['All', 'Today', 'This week'] as const).map((n) => description(filterBtn(page, n)))), ['15', '4', '8'], 'All 15, Today 4, This week 8');
  assert.match(flat(await (await must(sidebarTasks(page), 'sidebar Tasks')).innerText()), /^Tasks\s*15$/, 'the sidebar count stays 15 (AC-18)');
  await openTagList(page);
  assert.deepEqual(await tagOptions(page), [['doma', '4', false], ['práce', '4', false], ['čtení', '1', false], ['finance', '1', false], ['rodina', '1', false]],
    'the tag options keep the counts of AC-5');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-21

test('fr_tsk_04_ac21_arrow_down_to_the_cards_and_escape_clears', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await search(page, 'za');
  await eventually(() => allCards(page), (c) => c.length === 2);
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedPath(page), (p) => p === T.t01, 1000), T.t01, '↓ moves the focus to the first shown card (T01)');
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedPath(page), (p) => p === T.t03, 1000), T.t03, 'AC-10\'s ↓ works from there (T03)');
  await (await must(searchBox(page), 'the field')).focus();
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => fieldValue(page), (v) => v === '', 1000), '', 'Esc clears the text');
  assert.deepEqual(await eventually(() => sectionIds(page), (s) => s.length === 5), ['today', 'week', 'later', 'none', 'done'], 'every section comes back');
  assert.equal(await fieldFocused(page), true, 'the focus stays in the field');
  assert.deepEqual(await writeCalls(core), [], 'typing, clearing and moving the focus write nothing');
});

test('fr_tsk_04_ac21_the_text_is_not_remembered', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await search(page, 'kvetiny');
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await must(groupBy(page), 'the Kanban');
  assert.equal(await fieldValue(page), '', 'Schedule → Kanban: the field is empty');
  assert.ok((await allCards(page)).length > 2, 'every Kanban card is shown');
  await search(page, 'kvetiny');
  await click(viewTab(page, 'Schedule'), 'tab Schedule');
  await must(sectionOf(page, 'today'), 'the Schedule');
  assert.equal(await fieldValue(page), '', 'Kanban → Schedule: the field is empty');
  await search(page, 'kvetiny');
  await runCommand(page, 'Go to Types');
  await runCommand(page, 'Go to Tasks');
  await must(heading(page), 'Tasks again');
  assert.equal(await fieldValue(page), '', 'leaving tasks and coming back: empty');
  await search(page, 'kvetiny');
  await eventually(() => allCards(page), (c) => c.length === 1);
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedPath(page), (p) => p === T.t03, 1000), T.t03, 'the focus on T03');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Zalít květiny', '⏎ opens T03', 5000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(heading(page), 'Back to tasks');
  assert.equal(await fieldValue(page), '', 'Back after opening a card: empty (D-1282)');
  assert.equal((await sectionIds(page)).length, 5, 'and every section is shown');
  await search(page, 'kvetiny');
  await page.reload();
  await gotoTasks(page);
  assert.equal(await fieldValue(page), '', 'after a restart: empty');
  const sets = (await callsOf(core, 'ui_state_set')).map((c) => JSON.stringify(c.args ?? null));
  assert.deepEqual(sets.filter((s) => s.includes('kvetiny')), [], 'no ui_state_set holds the text');
  assert.ok(!JSON.stringify(await core.uiState()).includes('kvetiny'), 'no ui-state value holds it');
});

test('fr_tsk_04_ac21_quick_add_while_searching', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await search(page, 'kolo');
  assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t09'), '`kolo` leaves T09');
  const qa = await must(quickAdd(page), 'textbox "Add a task…"');
  await qa.fill('Zavolat do servisu');
  await qa.press('Enter');
  const created = await eventually(() => callsOf(core, 'note_create'), (c) => c.filter((x) => x.ok !== false).length === 1);
  assert.equal(created.filter((x) => x.ok !== false).length, 1, 'one note_create');
  const text = await fileWhen(core, 'Tasks/Zavolat do servisu.md', (t) => t !== undefined);
  assert.match(text ?? '', new RegExp(`^---\\nid: [0-9A-HJKMNP-TV-Z]{26}\\ntype: task\\ntitle: Zavolat do servisu\\nstatus: To do\\n(?:priority: .*\\n)?(?:due: \\d{4}-\\d{2}-\\d{2}\\n)?created: ${NOW.replace(/\+/g, '\\+')}\\nmodified: ${NOW.replace(/\+/g, '\\+')}\\n---\\n$`),
    `the FR-TSK-10 AC-1 shape: ${JSON.stringify(text)}`);
  assert.ok(await eventually(() => liveTexts(page).then((t) => t.includes('Created "Zavolat do servisu"')), (x) => x, 2000), 'the live region says Created "Zavolat do servisu"');
  assert.equal(await fieldValue(page), 'kolo', 'the field keeps `kolo` (D-1283)');
  await sleep(300);
  assert.deepEqual(await allCards(page), paths('t09'), 'its card isn\'t shown');
  await core.setFile('Tasks/Nové kolo.md', taskText(1, 'Nové kolo', 'status: To do\n'));
  assert.deepEqual(await eventually(() => cardPaths(sectionOf(page, 'none')), (v) => v.includes('Tasks/Nové kolo.md'), 2000), ['Tasks/Nové kolo.md', T.t09],
    'an external `Nové kolo` shows in Not scheduled within 2 s (no priority, by title: before Opravit kolo)');
});

const tasksUiKanban = { view: 'kanban' as const, groupBy: 'status' as const, dateFilter: 'all' as const, tags: [] as string[], doneExpanded: false };

test('fr_tsk_04_ac21_palette_filter_tasks_on_the_task_views', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const f = await must(searchBox(page), 'the Schedule field');
  assert.equal(await f.getAttribute('data-command'), 'tasks.search', 'the field carries data-command="tasks.search" (§13)');
  await (await must(quickAdd(page), 'quick-add')).focus();
  await runCommand(page, 'Filter tasks');
  assert.equal(await eventually(() => fieldFocused(page), (x) => x, 1500), true, 'tasks: the focus is in the field');
  await click(viewTab(page, 'Kanban'), 'tab Kanban');
  await must(groupBy(page), 'the Kanban');
  await runCommand(page, 'Filter tasks');
  assert.equal(await eventually(() => fieldFocused(page), (x) => x, 1500), true, 'tasks/kanban: the focus is in the field');
  await click(viewTab(page, 'All tasks'), 'tab All tasks');
  await must(main(page).getByRole('table', { name: 'Tasks', exact: true }), 'type/task');
  await runCommand(page, 'Filter tasks');
  assert.equal(await eventually(() => fieldFocused(page), (x) => x, 1500), true, 'type/task: the focus is in `Filter Tasks…`');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_04_ac21_palette_filter_tasks_from_a_note_opens_the_schedule', async ({ page }) => {
  await startTasks(page, { at: T.t01 });
  await mustBeOn(page, 'Zavolat Janě', 'landing on T01', 5000);
  await runCommand(page, 'Filter tasks');
  await must(heading(page), 'the command opens tasks', 5000);
  assert.equal(await attr(viewTab(page, 'Schedule'), 'aria-selected'), 'true', 'the Schedule');
  assert.equal(await eventually(() => fieldFocused(page), (x) => x, 1500), true, 'with the focus in the field');
});

test('fr_tsk_04_ac21_palette_filter_tasks_from_a_note_opens_the_last_view', async ({ page }) => {
  await startTasks(page, { at: T.t01, tasksUi: tasksUiKanban });
  await mustBeOn(page, 'Zavolat Janě', 'landing on T01', 5000);
  await runCommand(page, 'Filter tasks');
  await must(heading(page), 'the command opens the task views', 5000);
  assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'true', 'tasks/kanban, the last view (D-481)');
  assert.equal(await eventually(() => fieldFocused(page), (x) => x, 1500), true, 'with the focus in the field');
});

/** Words outside ⟦ ⟧ and outside `data-user-content` in `main`, ignoring the region's date words (as AC-11's test). */
async function unmarked(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    let all = '';
    const walk = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.hasAttribute('data-user-content')) { all += ' '; return; }
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (el.getClientRects().length === 0 && el.tagName !== 'BODY') return;
      }
      if (n.nodeType === Node.TEXT_NODE) { all += n.textContent; return; }
      for (const c of n.childNodes) walk(c);
    };
    const m = document.querySelector('main, [role="main"]');
    if (m) walk(m);
    const dateWords = new Set<string>();
    for (let d = 1; d <= 31; d++) for (const mo of [0, 9, 10, 11]) {
      for (const p of new Intl.DateTimeFormat((window as any).__TEGG_REGION__ ?? 'cs', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(Date.UTC(2026, mo, d))) dateWords.add(p.value.trim());
    }
    const outside = all.replace(/⟦[^⟦⟧]*⟧/g, ' ');
    return (outside.match(/[\p{L}][\p{L}'’]*/gu) ?? []).filter((w, i, a) => a.indexOf(w) === i && !dateWords.has(w));
  });
}

test('fr_tsk_04_ac21_pseudo_locale_with_the_search', async ({ page }) => {
  await startTasks(page, { prelude: pseudoLocale });
  await runCommand(page, '⟦Go to Tasks⟧');
  await must(main(page).getByRole('heading', { level: 1, name: '⟦Tasks⟧' }), 'heading ⟦Tasks⟧');
  const f = await must(main(page).getByRole('searchbox'), 'the search field');
  assert.match(nfc((await f.getAttribute('aria-label')) ?? (await f.getAttribute('placeholder')) ?? ''), /^⟦.*Tasks.*⟧$/, 'its name is a catalog message');
  await f.fill('za');
  await sleep(300);
  assert.deepEqual(await unmarked(page), [], 'with `za` typed: only user content outside ⟦ ⟧');
  await f.fill('cesta');
  const st = await must(main(page).getByRole('status').filter({ hasText: 'cesta' }), 'the no-match status');
  assert.match(nfc(flat(await st.innerText())), /^⟦.*"cesta".*⟧$/, 'the no-match status is one catalog message');
  assert.deepEqual(await unmarked(page), [], 'with the no-match status: only user content outside ⟦ ⟧');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tsk_04_ac21_themes_with_the_search_${theme}`, async ({ page }) => {
    await startTasks(page, { theme });
    await gotoTasks(page);
    await search(page, 'za');
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 2), paths('t01', 't03'), 'the search applies (control)');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with \`za\``);
    await search(page, 'cesta');
    await must(noMatch(page, 'cesta'), 'the no-match status');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with the no-match status`);
    await gotoKanban(page, 'Status');
    await search(page, 'za');
    assert.deepEqual(await axeContrast(page), [], `${theme}: Kanban with \`za\``);
  });
}

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-16

test('fr_tsk_05_ac16_the_field_on_the_kanban', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Status');
  await fieldBeforeSort(page, 'Due date');
});

test('fr_tsk_05_ac16_by_status_keeps_its_columns', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const ids = ['To do', 'In progress', 'Waiting', 'Done', 'no-status'];
  assert.deepEqual(await columnIds(page), ids, 'R42 columns (control)');
  const f = await must(searchBox(page), 'searchbox "Filter Tasks…"');
  await f.focus();
  await page.keyboard.type('z');
  await sleep(150);
  assert.deepEqual(await columnIds(page), ids, 'after `z`: the same columns');
  await page.keyboard.type('a');
  const got = await eventually(() => columns(page), (c) => (c['To do'] ?? []).length === 2);
  assert.deepEqual(await columnIds(page), ids, 'after `za`: the same columns');
  assert.deepEqual(got, { 'To do': paths('t01', 't03'), 'In progress': [], Waiting: [], Done: paths('t10'), 'no-status': [] }, '`za` per column');
  const head = async (id: string) => flat(await (await must(column(page, id).getByRole('heading', { level: 2 }), `heading of ${id}`)).innerText());
  assert.match(await head('To do'), /^To do\s*2$/, 'To do 2');
  assert.match(await head('Done'), /^Done\s*1$/, 'Done 1');
  for (const id of ['In progress', 'Waiting', 'no-status']) {
    assert.match(await head(id), /\s0$/, `${id}: count 0`);
    assert.ok((await textOf(column(page, id))).includes('No tasks'), `${id}: No tasks`);
  }
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_05_ac16_by_tag_keeps_its_columns', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Tag');
  const ids = ['#čtení', '#doma', '#finance', '#práce', '#rodina', 'no-tag'];
  assert.deepEqual(await columnIds(page), ids, 'R42 tag columns (control)');
  await search(page, 'za');
  const got = await eventually(() => columns(page), (c) => (c['#doma'] ?? []).length === 1);
  assert.deepEqual(await columnIds(page), ids, 'the same columns');
  assert.deepEqual(got, { '#čtení': [], '#doma': paths('t03'), '#finance': [], '#práce': paths('t01'), '#rodina': [], 'no-tag': [] }, '`za`: doma T03, práce T01');
  for (const id of ['#čtení', '#finance', '#rodina', 'no-tag']) assert.ok((await textOf(column(page, id))).includes('No tasks'), `${id}: No tasks`);
});

test('fr_tsk_05_ac16_cesta_empties_every_column', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Status');
  const ids = await columnIds(page);
  await search(page, 'cesta');
  assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 0), [], 'every column empty');
  assert.deepEqual(await columnIds(page), ids, 'no column disappears');
  assert.ok(await seen(noMatch(page, 'cesta'), 2000), 'the status `No Tasks match "cesta"`');
});

test('fr_tsk_05_ac16_drag_and_new_task_while_searching', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await search(page, 'za');
  await eventually(() => columns(page), (c) => (c['To do'] ?? []).length === 2);
  await drag(page, await must(cardIn(page, 'To do', 'Zalít květiny'), 'T03 in To do'), column(page, 'In progress'));
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length >= 1);
  assert.equal(w.length, 1, 'one note_write of T03');
  assert.equal(String((w[0].args as any).text), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), 'the bytes of AC-2');
  assert.ok(await seen(cardIn(page, 'In progress', 'Zalít květiny'), 2000), 'the card stays shown, in In progress (it still matches)');
  await click(column(page, 'Waiting').getByRole('button', { name: 'New task in Waiting', exact: true }), 'New task in Waiting');
  const field = await must(column(page, 'Waiting').getByRole('textbox'), 'a quick-add field in Waiting');
  await field.fill('Koupit mléko');
  await field.press('Enter');
  const t = await fileWhen(core, 'Tasks/Koupit mléko.md', (x) => x !== undefined);
  assert.ok(t && /^status: Waiting$/m.test(t), `created as AC-11 although the title doesn't match: ${t}`);
  assert.equal(await fieldValue(page), 'za', 'the search keeps `za`');
  assert.ok(await absent(card(page, 'Koupit mléko'), 1000), 'its card isn\'t shown');
});
