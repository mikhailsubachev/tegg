// MS5 slice 5A-1, L5 (WebKit + fake core): the Tasks page and its Schedule view. FR-TSK-04 AC-1…AC-12, FR-TSK-03 AC-1,
// FR-TSK-09 AC-1, FR-TSK-01 AC-5, AC-7 (views), FR-TSK-11 AC-1…AC-3. docs/acceptance/tasks.md (R40, R41, R44, R45);
// interface docs/contracts/ms5-tasks.md §4, §6 (`task_list` re-queried on `vault:changed`, the 30 s day check), §7 (fake
// core). Clock, zone and region injected; (TZ) criteria run in Europe/Prague and America/Los_Angeles, (W) with `cs`
// and `en-US`. Written from the ACs and the contract only (D-61). Missing elements fail an assertion (TS-I1).
//
// Slice Q2-T (AC-Test-Change, D-1912; docs/acceptance/views.md "Existing criteria this slice changes (part three)"): the
// Tasks page is `type/task` on the `views-tasks` overlay (`tasksViewsVault`); R41's sections are R203's period lanes (no
// `Overdue` / `Today · <date>` sub-groups, every day of This week shown) ordered by the view's sort (R202); the header,
// tabs and toolbar are R204's (no quick-add, no date filter, a working sort button); Done is the done lane (last 7 days,
// no `Show more`, folded per usage, R206); the tag filter's options come from the tab's shown cards (done lane included)
// and are remembered per tab (D-1893); the keys are R191's; R46 follows R207. FR-TSK-04 AC-4 (date filters) is superseded
// (D-1779) and its tests are removed.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { pseudoLocale, escPreview, mustNoPreview, mustPreview, switchPreviewMode } from './helpers';
import { ui as tasksUi } from './tasks-helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import {
  NOW, O, T, ZONES, absent, card, cardPaths, cardsWhen, checkbox, dateFilter, description, eventually, fileText, flat, gotoKanban, gotoTasks,
  groupsOf, heading, isDisabled, main, mainName, moreBtn, must, mustBeOn, navs, nfc, paths, quickAdd, runCommand, sectionIds, sectionOf, seen,
  shortDate, sidebarTasks, sleep, startTasksPage, swap, tagFilter, taskText, tasksViewsVault, titleOf, tzTag, viewTab, views, writeCalls, writesOf,
  allCards, original, attr, click, textOf, activeTag, addTag, clearTagsBtn, openTagList, removeTagBtn, tagChips, tagFieldValue, tagInput, tagList, tagOption, tagOptions,
  groupBy, sortBtn,
} from './tasks-helpers';

const SUMMARY = '15 open · 2 overdue · 1 done this week';
const startTasks = startTasksPage;
async function summaryText(page: Page): Promise<string> {
  return flat(await main(page).innerText().catch(() => ''));
}
/** R203 day heading in the region. */
const dayHeading = (date: string, region: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};
/** R203's lanes of the Schedule: the period lanes' cards and the week lane's day groups `[heading, paths]`. */
async function schedule(page: Page) {
  return {
    sections: await sectionIds(page),
    today: await cardPaths(sectionOf(page, 'today')),
    week: await groupsOf(sectionOf(page, 'week')),
    later: await cardPaths(sectionOf(page, 'later')),
    none: await cardPaths(sectionOf(page, 'none')),
  };
}
const doneToggle = (page: Page) => sectionOf(page, 'done').getByRole('button', { name: /^⟦?(Expand|Collapse) Done⟧?$/ });
const sortButton = (page: Page) => main(page).locator('div.view-toolbar button[data-command="sort.open"]');
const filterTasks = (page: Page) => main(page).getByRole('searchbox', { name: /^⟦?Filter Tasks…⟧?$/ });

// ------------------------------------------------------------------------------------------------ AC-1

test.describe('the page (Europe/Prague, cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac1_sidebar_and_palette_open_the_schedule', async ({ page }) => {
    const core = await startTasks(page);
    const entry = await must(sidebarTasks(page), 'sidebar entry Tasks');
    assert.match((await textOf(entry)), /^Tasks\s*15$/, 'the sidebar count: the open tasks = 15 (D-588, AC-18)');
    await entry.click();
    await must(heading(page), 'heading Tasks');
    assert.ok((await summaryText(page)).includes(SUMMARY), `summary "${SUMMARY}" (R204)`);
    assert.equal(await attr(viewTab(page, 'Schedule'), 'aria-selected'), 'true', 'Schedule selected (the first view tab, AP-1540)');
    assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'false');
    assert.equal(await attr(viewTab(page, 'All Tasks'), 'aria-selected'), 'false', 'the tab All Tasks (R204)');
    await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings in the header (D-517)');
    await must(main(page).getByRole('button', { name: 'New Task', exact: true }), 'New Task in the header (R204)');
    for (const [what, loc] of [['textbox Add a task…', quickAdd(page)], ['group Filter', dateFilter(page)], ['tablist Group by', groupBy(page)], ['the disabled Sort', sortBtn(page, 'Priority, then due')]] as const) {
      assert.equal(await loc.count(), 0, `no ${what} (R204 "Gone")`);
    }
    const sort = await must(sortButton(page), 'the sort button (R188)');
    assert.equal(await isDisabled(sort), false, 'the sort button works');
    assert.equal(flat(await textOf(sort)), 'Due date ↑ +1', '`Due date ↑` `+1` (D-1922)');
    await must(tagFilter(page), 'tag filter');
    await must(filterTasks(page), '`Filter Tasks…`');
    const focus = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}:${a.getAttribute('aria-level') ?? ''}:${(a.textContent ?? '').trim()}` : ''; });
    assert.match(focus, /^(H1|[A-Z]+:1):.*Tasks/, `the focus is on the heading (D-130): ${focus}`);
    assert.deepEqual(await navs(core), [], 'no recency recorded (D-138)');
    assert.deepEqual(await writeCalls(core), [], 'no write');
    await runCommand(page, 'Go to Types');
    await runCommand(page, 'Go to Tasks');
    await must(heading(page), 'Go to Tasks opens the page again');
    await must(views(page), 'the tablist `Views` (R204)');
  });
});

// ------------------------------------------------------------------------------------------------ AC-2 (TZ, W)

for (const tz of ZONES) {
  test.describe(`sections in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test(`fr_tsk_04_ac2_sections_and_groups_cs_${tzTag(tz)}`, async ({ page }) => {
      await startTasks(page);
      await gotoTasks(page);
      const s = await schedule(page);
      assert.deepEqual(s.sections, ['today', 'week', 'later', 'none', 'done'], 'the five lanes in order');
      assert.deepEqual(s.today, paths('t01', 't02', 't03', 't14'), 'Today & overdue: one lane, no sub-groups (R203)');
      assert.deepEqual(s.week, [
        { heading: dayHeading('2026-10-15', 'cs'), paths: paths('t04', 't19') }, { heading: dayHeading('2026-10-16', 'cs'), paths: paths('t15') },
        { heading: dayHeading('2026-10-17', 'cs'), paths: [] }, { heading: dayHeading('2026-10-18', 'cs'), paths: paths('t05') },
      ], 'This week: every day shown, Saturday 17 empty (AP-1536)');
      assert.deepEqual(s.later, paths('t06', 't07'), 'Later');
      assert.deepEqual(s.none, paths('t08', 't09', 't17', 't16', 't18'), 'Not scheduled');
    });
  });
}

test.describe('sections with en-US (week from Sunday)', () => {
  test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

  test('fr_tsk_04_ac2_sections_en_us', async ({ page }) => {
    await startTasks(page, { region: 'en-US' });
    await gotoTasks(page);
    const s = await schedule(page);
    assert.deepEqual(s.week.map((g) => g.paths), [paths('t04', 't19'), paths('t15'), []], 'This week: Thu 15, Fri 16, Sat 17');
    assert.deepEqual(s.later, paths('t05', 't06', 't07'), 'Later: T05, T06, T07');
  });
});

test.describe('Sunday (cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac2_on_sunday_this_week_is_not_shown', async ({ page }) => {
    await startTasks(page, { now: '2026-10-18T12:00:00+02:00' });
    await gotoTasks(page);
    const s = await schedule(page);
    assert.ok(!s.sections.includes('week'), `no This week lane on the week's last day: ${s.sections}`);
    assert.deepEqual(s.later, paths('t06', 't07'), 'T06 (19 Oct) is in Later');
    assert.ok(s.today.includes(T.t05), 'T05 in Today & overdue');
  });
});

// ------------------------------------------------------------------------------------------------ AC-3, AC-5

test.describe('Done and filters (Europe/Prague, cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac3_done_is_collapsed_and_remembered', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const btn = await must(doneToggle(page), 'button Expand Done');
    assert.equal(await attr(btn, 'aria-expanded'), 'false', 'collapsed by default (Schedule.yml `folded: true`)');
    assert.match(await attr(sectionOf(page, 'done'), 'aria-label') ?? '', /^Done, 2 Tasks$/, 'Done and its count 2 (T11 is older than 7 days)');
    assert.deepEqual(await cardPaths(sectionOf(page, 'done')), [], 'no Done card while collapsed');
    await btn.click();
    assert.deepEqual(await cardsWhen(sectionOf(page, 'done'), paths('t10', 't12')), paths('t10', 't12'), 'T10, T12 (the last 7 days)');
    for (const k of ['t10', 't12'] as const) {
      const c = card(page, titleOf(T[k]));
      assert.equal(await attr(checkbox(c, titleOf(T[k])), 'aria-checked'), 'true', `${k} checked`);
      const deco = await (await must(c.getByRole('link', { name: titleOf(T[k]) }), `${k} title`)).evaluate((e) => getComputedStyle(e).textDecorationLine);
      assert.ok(deco.includes('line-through'), `${k} struck through`);
    }
    assert.ok((await textOf(card(page, titleOf(T.t10)))).includes('Completed today'), 'T10: Completed today');
    const st = await eventually(() => core.uiState(), (u) => ((u as any)?.usageFolded?.['tab:task/schedule'] ?? []).includes('!done'), 2000);
    assert.deepEqual((st as any)?.usageFolded?.['tab:task/schedule'], ['!done'], 'expanded state kept per machine, per usage (R206)');
  });

  test('fr_tsk_04_ac3_done_shows_50_then_show_more', async ({ page }) => {
    // Q2-T: boards don't page; the done lane shows every Done-state task of the last 7 days, no `Show <n> more`.
    const vault = tasksViewsVault((f) => {
      for (let i = 0; i < 60; i++) f[`Tasks/Hotovo ${String(i).padStart(2, '0')}.md`] = taskText(100 + i, `Hotovo ${String(i).padStart(2, '0')}`, `status: Done\ncompleted: 2026-10-1${i % 5}T10:00:00+02:00\n`);
    });
    await startTasks(page, { vault });
    await gotoTasks(page);
    await (await must(doneToggle(page), 'button Expand Done')).click();
    assert.equal((await eventually(() => cardPaths(sectionOf(page, 'done')), (v) => v.length >= 62)).length, 62, 'all 62 Done tasks of the last 7 days');
    assert.equal(await sectionOf(page, 'done').getByRole('button', { name: /^Show \d+ more/ }).count(), 0, 'no `Show <n> more`');
  });

  test('fr_tsk_04_ac5_tag_filter', async ({ page }) => {
    // D-518: a searchable combobox with chips; the selected tags must all match.
    const core = await startTasks(page);
    await gotoTasks(page);
    const cb = await must(tagFilter(page), 'combobox Filter by tag');
    assert.equal(await cb.getAttribute('aria-haspopup'), 'listbox', 'aria-haspopup listbox');
    assert.equal(await cb.getAttribute('aria-expanded'), 'false', 'closed at first');
    assert.ok(await seen(main(page).getByPlaceholder('Search 5 tags…', { exact: true })), 'placeholder "Search 5 tags…"');
    await cb.click();
    await must(tagList(page), 'listbox Tags (click)');
    assert.equal(await cb.getAttribute('aria-expanded'), 'true', 'aria-expanded when open');
    assert.equal(await attr(tagList(page), 'aria-multiselectable'), 'true', 'aria-multiselectable');
    // AP-1545: options and counts from the tab's shown cards, the done lane included (T10 counts for finance).
    const ALL: [string, string, boolean][] = [['doma', '4', false], ['práce', '4', false], ['finance', '2', false], ['čtení', '1', false], ['rodina', '1', false]];
    assert.deepEqual(await tagOptions(page), ALL, 'most first, ties in D-122 order; Doma, NFD doma and inline #rodina count; T10 in the done lane counts');
    assert.deepEqual(await Promise.all(ALL.map(([t]) => textOf(tagOption(page, t)).then((x) => x.startsWith(`#${t}`)))), ALL.map(() => true), 'options show #<tag>');
    await page.keyboard.press('Escape');
    assert.ok(await absent(tagList(page)), 'Esc closes the list');
    await (await must(tagInput(page), 'the tag field')).focus();
    await page.keyboard.press('ArrowDown');
    assert.ok(await seen(tagList(page)), '↓ with the field focused opens the list');
    const search = async (text: string) => {
      await tagInput(page).fill('');
      await tagInput(page).focus();
      await page.keyboard.insertText(text);
      return eventually(() => tagOptions(page).then((o) => o.map(([t]) => t)), (o) => o.length === 1, 2000);
    };
    assert.deepEqual(await search('fin'), ['finance'], '"fin" leaves #finance');
    assert.deepEqual(await search('CTE'), ['čtení'], '"CTE" leaves #čtení');
    assert.deepEqual(await search('čte'.normalize('NFD')), ['čtení'], 'NFD "čte" leaves #čtení');
    await tagInput(page).fill('');
    await tagInput(page).focus();
    await page.keyboard.insertText('prá');
    await sleep(100);
    await page.keyboard.press('Enter');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['práce'], '⏎ adds the chip #práce');
    assert.equal(await tagFieldValue(page), '', 'the field empties');
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 4), paths('t01', 't02', 't06', 't18'), 'only T01, T02, T06, T18');
    if (!(await seen(tagList(page), 300))) await page.keyboard.press('ArrowDown');
    assert.deepEqual(await eventually(() => tagOptions(page), (o) => o[0]?.[2] === true),
      [['práce', '4', true], ['finance', '1', false], ['rodina', '1', false], ['čtení', '0', false], ['doma', '0', false]], 'counts of what each tag would leave');
    for (let i = 0; i < 8 && (await activeTag(page)) !== 'finance'; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 2), ['práce', 'finance'], 'chips #práce, #finance');
    assert.deepEqual(await eventually(() => allCards(page), (c) => c.length === 1), paths('t02'), 'only T02 has both');
    assert.ok(await seen(main(page).getByText('Tasks with all selected tags', { exact: true })), 'the all-of hint with two tags');
    await tagInput(page).focus();
    await page.keyboard.press('Backspace');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['práce'], '⌫ in the empty field removes the last chip');
    await click(removeTagBtn(page, 'práce'), 'Remove #práce');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 0), [], 'Remove #práce removes it');
    assert.ok(await absent(clearTagsBtn(page)), 'no Clear tags while none is selected');
    await addTag(page, 'doma');
    await addTag(page, 'práce');
    assert.deepEqual(await allCards(page), [], 'no task has both #doma and #práce');
    await click(clearTagsBtn(page), 'Clear tags');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 0), [], 'Clear tags removes all');
    assert.equal((await allCards(page)).length, 15, 'every open task again (Done folded)');
    assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'selecting and removing tags writes nothing to the vault');
  });

  test('fr_tsk_04_ac5_a_selected_tag_without_tasks_stays_at_0', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    await addTag(page, 'čtení');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 1), ['čtení'], 'chip #čtení');
    await core.setFile(T.t08, swap(original(T.t08), 'tags: [čtení]\n', ''));
    await openTagList(page);
    const opt = await eventually(() => tagOptions(page).then((o) => o.find(([t]) => t === 'čtení') ?? null), (o) => o?.[1] === '0', 2000);
    assert.deepEqual(opt, ['čtení', '0', true], 'the selected tag stays with count 0');
    assert.deepEqual(await tagChips(page), ['čtení'], 'and stays as a chip');
    assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'nothing written');
  });

  test('fr_tsk_04_ac5_the_selection_is_remembered_per_machine', async ({ page, browser }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    await addTag(page, 'práce');
    await addTag(page, 'finance');
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 2), ['práce', 'finance']);
    const st = await eventually(() => core.uiState() as Promise<any>, (u) => (u?.tagFilter?.['tab:task/schedule'] ?? []).length === 2, 2000);
    assert.deepEqual(st?.tagFilter?.['tab:task/schedule'], ['práce', 'finance'], 'ui_state_set stores the tab\'s selection (D-1893, machine-local)');
    const p2 = await browser.newPage({ timezoneId: 'Europe/Prague' });
    const core2 = await startTasks(p2, { uiState: st });
    await gotoTasks(p2);
    assert.deepEqual(await eventually(() => tagChips(p2), (c) => c.length === 2), ['práce', 'finance'], 'chips restored');
    assert.deepEqual(await eventually(() => allCards(p2), (c) => c.length === 1), paths('t02'), 'and the filter applies');
    assert.deepEqual((await writeCalls(core2)).filter((c) => c !== 'ui_state_set'), [], 'nothing written');
    await p2.close();
  });

  test('fr_tsk_04_ac5_at_most_12_options', async ({ page }) => {
    const extra = ['jaro', 'léto', 'podzim', 'zima', 'ráno', 'večer', 'účty', 'škola', 'auto', 'zahrada'];
    const vault = tasksViewsVault((f) => {
      extra.forEach((t, i) => { f[`Tasks/Štítek ${i + 1}.md`] = taskText(i + 1, `Štítek ${i + 1}`, `status: To do\ntags: [${t}]\n`); });
    });
    await startTasks(page, { vault });
    await gotoTasks(page);
    assert.ok(await seen(main(page).getByPlaceholder('Search 15 tags…', { exact: true })), 'placeholder counts all 15 tags');
    await openTagList(page);
    const opts = await tagOptions(page);
    assert.equal(opts.length, 12, `at most 12 options: ${opts.map(([t]) => t).join(', ')}`);
    assert.deepEqual(opts.slice(0, 2).map(([t]) => t), ['doma', 'práce'], 'most used first');
    await tagInput(page).focus();
    await page.keyboard.insertText('zah');
    assert.deepEqual(await eventually(() => tagOptions(page).then((o) => o.map(([t]) => t)), (o) => o.length === 1), ['zahrada'], 'search reaches tags beyond the first 12');
  });
});

// ------------------------------------------------------------------------------------------------ AC-6, FR-TSK-11

test.describe('what is never a task (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac6_never_shown', async ({ page }) => {
    await startTasks(page);
    await gotoTasks(page);
    await (await must(doneToggle(page), 'Done')).click();
    const shown = await eventually(() => allCards(page), (v) => v.length >= 17);
    assert.deepEqual([...shown].sort(), Object.values(T).filter((p) => p !== T.t13 && p !== T.t11).map(nfc).sort(), 'every task but T13 (Cancelled) and T11 (Done before the last 7 days)');
    const text = flat(await main(page).innerText());
    for (const w of ['Zavolat dodavateli', 'Poslat zápis', 'Objednat projektor', 'Něco udělat', 'Smazaný úkol', 'Se stavem']) assert.ok(!text.includes(w), `"${w}" is not on the page`);
    assert.equal(await main(page).locator('article[data-board-card="Projekty/Web.md"]').count(), 0, 'Web (a Projekt) is not on the page');
  });

  test('fr_tsk_11_ac1_a_new_checklist_item_changes_no_view', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const before = { cards: await allCards(page), text: (await main(page).innerText()).includes(SUMMARY) };
    assert.equal(before.cards.length, 15, '15 cards with Done collapsed (open tasks)');
    await core.setFile(O.porada, `${original(O.porada)}\n- [ ] Nový bod\n`);
    await sleep(500);
    assert.deepEqual(await allCards(page), before.cards, 'no lane changes');
    assert.ok((await main(page).innerText()).includes(SUMMARY), 'the counts stay');
  });

  test('fr_tsk_11_ac2_toggling_a_checklist_item_writes_only_its_note', async ({ page }) => {
    const core = await startTasks(page, { at: O.porada });
    await mustBeOn(page, 'Porada', 'Porada', 5000);
    const box = await must(main(page).getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).getByRole('checkbox').first(), 'checklist checkbox Zavolat dodavateli');
    await box.click();
    const t = await eventually(() => fileText(core, O.porada), (x) => !!x?.includes('- [x] Zavolat dodavateli'), 3000);
    assert.ok(t?.includes('- [x] Zavolat dodavateli'), '[ ] → [x]');
    assert.deepEqual([...new Set((await core.writesTo()).map(nfc))], [O.porada], 'only Pages/Porada.md');
    await gotoTasks(page);
    assert.ok((await main(page).innerText()).includes(SUMMARY), 'no task view changes');
  });

  test('fr_tsk_11_ac3_a_checklist_inside_a_task_body', async ({ page }) => {
    const vault = tasksViewsVault((f) => { f[T.t04] = `${original(T.t04)}- [ ] krok\n`; });
    const core = await startTasks(page, { vault, at: T.t04 });
    await mustBeOn(page, 'Koupit dárek', 'T04', 5000);
    await (await must(main(page).getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).getByRole('checkbox').first(), 'the checkbox of `krok` in the body')).click();
    const t = await eventually(() => fileText(core, T.t04), (x) => !!x?.includes('- [x] krok'), 3000);
    assert.ok(t?.includes('- [x] krok') && t.includes('status: Waiting'), 'the body line changes, the status doesn\'t');
    await gotoTasks(page);
    assert.equal(await attr(card(page, 'Koupit dárek'), 'data-state'), 'open', 'T04 still open (Waiting)');
  });
});

// ------------------------------------------------------------------------------------------------ AC-7, AC-8

test.describe('live (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac7_external_changes_update_the_page', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    await (await must(doneToggle(page), 'Done')).click();
    await (await must(card(page, titleOf(T.t06)), 'card T06')).focus();
    await core.setFile('Tasks/Nový.md', taskText(1, 'Nový', 'status: To do\ndue: 2026-10-14\n'));
    assert.ok((await eventually(() => cardPaths(sectionOf(page, 'today')), (v) => v.includes('Tasks/Nový.md'), 2000)).includes('Tasks/Nový.md'), 'Nový in Today & overdue within 2 s');
    await core.setFile(T.t07, swap(original(T.t07), 'due: 2026-12-01', 'due: 2026-10-15'));
    assert.ok((await eventually(() => cardPaths(sectionOf(page, 'week')), (v) => v.includes(T.t07))).includes(T.t07), 'T07 moves to This week');
    await core.setFile(T.t08, null);
    assert.ok(!(await eventually(() => allCards(page), (v) => !v.includes(T.t08))).includes(T.t08), 'deleted T08 removed');
    await core.renameFile(T.t09, `.trash/${T.t09}`);
    assert.ok(!(await eventually(() => allCards(page), (v) => !v.includes(T.t09))).includes(T.t09), 'T09 moved to .trash/ removed');
    await core.setFile(T.t16, swap(original(T.t16), 'type: task', 'type: page'));
    assert.ok(!(await eventually(() => allCards(page), (v) => !v.includes(T.t16))).includes(T.t16), 'T16 now a page: removed');
    await core.renameFile(T.t03, 'Tasks/Zalít kytky.md');
    assert.ok((await eventually(() => allCards(page), (v) => v.includes('Tasks/Zalít kytky.md'))).includes('Tasks/Zalít kytky.md'), 'renamed T03 keeps its card');
    assert.equal(await attr(doneToggle(page), 'aria-expanded'), 'true', 'Done stays expanded');
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('article[data-board-card]')?.getAttribute('data-board-card') ?? null);
    assert.equal(focused && nfc(focused), T.t06, 'the focused card keeps the focus');
    assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'nothing written');
  });

  test('fr_tsk_04_ac8_midnight_recomputes', async ({ page }) => {
    const core = await startTasks(page, { now: '2026-10-14T23:59:58+02:00', install: true });
    await gotoTasks(page);
    await page.clock.runFor(61_000);
    const today = await eventually(() => cardPaths(sectionOf(page, 'today')), (x) => x.includes(T.t04) && x.includes(T.t19), 3000);
    assert.ok(today.includes(T.t04) && today.includes(T.t19), 'T04 and T19 move to Today & overdue');
    assert.ok((await textOf(card(page, titleOf(T.t03)))).includes(`${shortDate('2026-10-14', 'cs')} · Yesterday`), 'T03: <Wed 14 Oct> · Yesterday');
    assert.ok(flat(await main(page).innerText()).includes('15 open · 4 overdue · 1 done this week'), 'the summary follows (T01, T02, T03, T14 overdue)');
    assert.match((await textOf(sidebarTasks(page))), /^Tasks\s*15$/, 'the sidebar count follows (open tasks, D-588: still 15)');
    assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'nothing written');
  });

  test('fr_tsk_04_ac8_a_zone_change_recomputes', async ({ page }) => {
    await startTasks(page, { now: '2026-10-15T00:30:00+02:00', install: true });
    await gotoTasks(page);
    assert.ok((await cardPaths(sectionOf(page, 'today'))).includes(T.t04), 'Prague, 15 Oct 00:30: T04 due today');
    await page.evaluate(() => { (window as any).__TEGG_TZ__ = 'America/Los_Angeles'; });
    await page.clock.runFor(61_000);
    const w = await eventually(() => cardPaths(sectionOf(page, 'week')), (x) => x.includes(T.t04), 3000);
    assert.ok(w.includes(T.t04), 'Los Angeles, 14 Oct 15:30: T04 back in This week, without a restart');
  });
});

// ------------------------------------------------------------------------------------------------ AC-9, AC-10

test.describe('opening and keyboard (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac9_opening_a_task_and_back', async ({ page }) => {
    // D-943: the steps run with Object preview Off; click mode (AP-812) follows.
    const core = await startTasks(page, setPreviewMode('off', { uiState: tasksUi() }));
    await gotoTasks(page);
    await addTag(page, 'práce');
    await page.keyboard.press('Escape');
    await (await must(doneToggle(page), 'Done')).click();
    await (await must(card(page, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'title link')).click();
    await mustBeOn(page, 'Zavolat Janě', 'the title opens note/<path>', 5000);
    assert.ok((await navs(core)).includes(T.t01), 'nav_opened records it');
    await page.keyboard.press('Meta+BracketLeft');
    await must(heading(page), 'Back to tasks');
    assert.equal(await attr(viewTab(page, 'Schedule'), 'aria-selected'), 'true', 'the same tab');
    assert.deepEqual(await tagChips(page), ['práce'], 'the tag selection kept');
    assert.equal(await attr(doneToggle(page), 'aria-expanded'), 'true', 'Done expanded kept');
    await (await must(card(page, 'Poslat rozpočet'), 'card')).focus();
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Poslat rozpočet', '⏎ on the focused card', 5000);
    await page.keyboard.press('Meta+BracketLeft');
    await must(heading(page), 'Back again');
    await (await must(moreBtn(card(page, 'Zavolat Janě'), 'Zavolat Janě'), 'More')).click();
    await (await must(page.getByRole('menuitem', { name: 'Open', exact: true }), 'menu Open')).click();
    await mustBeOn(page, 'Zavolat Janě', 'More › Open', 5000);
    // Click to preview (D-943, AP-812): a click on a card title previews; a double-click and ⏎ open.
    await page.keyboard.press('Meta+BracketLeft');
    await must(heading(page), 'Back (before click mode)');
    await switchPreviewMode(page, core, 'click');
    const title = () => card(page, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true });
    await (await must(title(), 'title link (click mode)')).click();
    await mustPreview(page, 'Zavolat Janě', 'click mode: a click on the card title previews the task');
    assert.ok(await seen(heading(page), 500), 'click mode: the click keeps the Tasks page');
    await escPreview(page, 'click mode: the card preview');
    await (await must(title(), 'title link (double-click)')).dblclick();
    await mustBeOn(page, 'Zavolat Janě', 'click mode: a double-click on the title opens note/<path>', 5000);
    await mustNoPreview(page, 'click mode: after the double-click', 300);
  });

  test('fr_tsk_04_ac10_keyboard_only', async ({ page }) => {
    // Q2-T (R191, D-1905): the board keys: Tab reaches the first card; horizontal ←/→ inside a row, ↑/↓ between rows.
    const core = await startTasks(page);
    await gotoTasks(page);
    await (await must(filterTasks(page), '`Filter Tasks…`')).focus();
    let path: string | null = null;
    for (let i = 0; i < 30 && !path; i++) {
      await page.keyboard.press('Tab');
      path = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('article[data-board-card]')?.getAttribute('data-board-card') ?? null);
    }
    assert.equal(path && nfc(path), T.t01, 'Tab reaches the first card (T01) after the toolbar');
    await page.keyboard.press('ArrowRight');
    const next = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('article[data-board-card]')?.getAttribute('data-board-card') ?? null);
    assert.equal(next && nfc(next), T.t02, '→ moves inside the row');
    await (await must(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'the checkbox of T03')).focus();
    await page.keyboard.press('Space');
    const w = await eventually(() => writesOf(core, T.t03), (x) => x.length === 1, 2000);
    assert.equal(w.length, 1, 'Space toggles the checkbox of T03 (one write)');
    await (await must(card(page, 'Zavolat Janě'), 'T01')).focus();
    await page.keyboard.press('Shift+F10');
    await must(page.getByRole('menu'), '⇧F10 opens the card menu');
    await page.keyboard.press('Escape');
    assert.ok(await absent(page.getByRole('menu')), 'Esc closes it');
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Zavolat Janě', '⏎ opens the focused task', 5000);
  });
});

// ------------------------------------------------------------------------------------------------ AC-11, AC-12

/** Words outside ⟦ ⟧ and outside `data-user-content`, ignoring the region's date words (Intl, ms5-tasks §6.1). */
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
      for (const o of [{ weekday: 'short', day: 'numeric', month: 'short' }, { weekday: 'long', day: 'numeric' }] as Intl.DateTimeFormatOptions[]) {
        for (const p of new Intl.DateTimeFormat((window as any).__TEGG_REGION__ ?? 'cs', { ...o, timeZone: 'UTC' }).formatToParts(Date.UTC(2026, mo, d))) dateWords.add(p.value.trim());
      }
    }
    const outside = all.replace(/⟦[^⟦⟧]*⟧/g, ' ');
    return (outside.match(/[\p{L}][\p{L}'’]*/gu) ?? []).filter((w, i, a) => a.indexOf(w) === i && !dateWords.has(w));
  });
}

test.describe('strings and themes (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac11_pseudo_locale_marks_every_ui_text', async ({ page }) => {
    await startTasks(page, { prelude: pseudoLocale });
    await runCommand(page, '⟦Go to Tasks⟧');
    await must(main(page).getByRole('heading', { level: 1, name: /^⟦?Tasks⟧?$/ }), 'heading Tasks (the plural is user content)');
    await (await must(doneToggle(page), 'Done')).click();
    const fails: string[] = [];
    const u1 = await unmarked(page);
    if (u1.length) fails.push(`schedule: ${u1.join(' ')}`);
    await (await must(main(page).getByRole('button', { name: /More actions for/ }).first(), 'a card menu')).click();
    const menu = await page.getByRole('menu').allInnerTexts();
    if (menu.some((t) => t.replace(/⟦[^⟦⟧]*⟧/g, '').replace(/\b(To do|In progress|Waiting|Done|Cancelled|High|Medium|Low|None)\b/g, '').match(/\p{L}/u))) fails.push(`menu: ${menu.join(' | ')}`);
    await page.keyboard.press('Escape');
    await (await must(main(page).getByRole('tab', { name: 'Kanban', exact: true }), 'tab Kanban (a query name: user content)')).click();
    await sleep(300);
    const u2 = await unmarked(page);
    if (u2.length) fails.push(`kanban: ${u2.join(' ')}`);
    assert.deepEqual(fails, [], 'only titles, tag names, status and priority labels, query names and body text are outside ⟦ ⟧');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`fr_tsk_04_ac12_both_themes_${theme}`, async ({ page }) => {
      await startTasks(page, { theme });
      await gotoTasks(page);
      await (await must(doneToggle(page), 'Done')).click();
      await (await must(moreBtn(card(page, 'Zavolat Janě'), 'Zavolat Janě'), 'More')).click();
      assert.deepEqual(await axeContrast(page), [], `tasks ${theme}: axe color-contrast`);
      await page.keyboard.press('Escape');
      await gotoKanban(page, 'Status');
      assert.deepEqual(await axeContrast(page), [], `kanban by status ${theme}`);
      await gotoKanban(page, 'Tag');
      assert.deepEqual(await axeContrast(page), [], `kanban by tag ${theme}`);
      const chip = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return { danger: css.getPropertyValue('--danger').trim(), dangerBg: css.getPropertyValue('--danger-bg').trim() };
      });
      assert.ok(chip.danger !== '' && chip.dangerBg !== '', `${theme}: the danger and danger-bg tokens are set`);
    });
  }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-03 AC-1, FR-TSK-09 AC-1, FR-TSK-01 AC-5, AC-7

test.describe('order and overdue (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_03_ac1_priority_defines_the_order', async ({ page }) => {
    // Q2-T: the view's sort (R202: due, then priority) gives R41's order on the fixture (R208).
    const vault = tasksViewsVault((f) => {
      f['Tasks/A úkol.md'] = taskText(1, 'A úkol', 'status: To do\n');
      f['Tasks/B úkol.md'] = taskText(2, 'B úkol', 'status: To do\npriority: None\n');
      f['Tasks/C úkol.md'] = taskText(3, 'C úkol', 'status: To do\npriority: Low\n');
    });
    await startTasks(page, { vault });
    await gotoTasks(page);
    assert.deepEqual(await cardPaths(sectionOf(page, 'today')), paths('t01', 't02', 't03', 't14'), 'Today & overdue by due, then priority');
    assert.deepEqual(await cardPaths(sectionOf(page, 'none')), [T.t08, 'Tasks/C úkol.md', 'Tasks/B úkol.md', 'Tasks/A úkol.md', T.t09, T.t17, T.t16, T.t18],
      'Medium, Low, None, then no priority by title (AP-407)');
  });

  for (const tz of ZONES) {
    test.describe(`overdue ${tz}`, () => {
      test.use({ timezoneId: tz });

      test(`fr_tsk_09_ac1_overdue_marks_${tzTag(tz)}`, async ({ page }) => {
        await startTasks(page);
        await gotoTasks(page);
        await (await must(doneToggle(page), 'Done')).click();
        await sleep(200);
        const over = await main(page).evaluate((m) => ([...m.querySelectorAll('[data-overdue="true"]')] as HTMLElement[]).map((e) => (e.closest('article')?.getAttribute('data-board-card') ?? e.getAttribute('data-path') ?? '').normalize('NFC')));
        assert.deepEqual([...new Set(over)].sort(), paths('t01', 't02').sort(), 'exactly T01 and T02');
      });

      test(`fr_tsk_01_ac5_late_utc_evening_${tzTag(tz)}`, async ({ page }) => {
        const core = await startTasks(page, { now: '2026-10-14T22:30:00Z' });
        await gotoTasks(page);
        const t03 = await must(card(page, 'Zalít květiny'), 'T03');
        const want = tz === 'Europe/Prague' ? 'true' : 'false';
        assert.equal(await attr(t03, 'data-overdue'), want, `T03 overdue in ${tz}: ${want}`);
        assert.equal(await attr(card(page, 'Bez stavu'), 'data-overdue'), want, `T14 likewise`);
        const label = (await textOf(t03));
        assert.ok(tz === 'Europe/Prague' ? label.includes(`${shortDate('2026-10-14', 'cs')} · Yesterday`) : label.includes('Today'), `T03 label in ${tz}: ${label}`);
        assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'no write changes due');
      });
    });
  }

  for (const [n, at] of [['first', '2026-10-14T00:00:00+02:00'], ['last', '2026-10-14T23:59:59+02:00']] as const) {
    test(`fr_tsk_01_ac5_the_${n}_second_of_the_day_is_today`, async ({ page }) => {
      await startTasks(page, { now: at });
      await gotoTasks(page);
      assert.ok((await cardPaths(sectionOf(page, 'today'))).includes(T.t03), `${at}: T03 due today`);
      assert.ok((await textOf(card(page, 'Zalít květiny'))).includes('Today'), `${at}: T03 \`Today\``);
    });
  }

  test('fr_tsk_01_ac7_views_are_identical_after_a_reload', async ({ page }) => {
    await startTasks(page);
    await gotoTasks(page);
    const a = await schedule(page);
    const k1 = await (async () => { await gotoKanban(page, 'Status'); return cardPaths(main(page)); })();
    await page.reload();
    await gotoTasks(page);
    await (await must(viewTab(page, 'Schedule'), 'Schedule')).click();
    assert.deepEqual(await schedule(page), a, 'the Schedule from a fresh read');
    assert.ok(a.later.length > 0, 'the Schedule has cards');
    await gotoKanban(page, 'Status');
    assert.deepEqual(await cardPaths(main(page)), k1, 'the Kanban from a fresh read');
  });
});

void dateFilter; void original; void isDisabled; void mainName; void absent; void description; void tagOption; void NOW;
