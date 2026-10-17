// MS5 slice 5A-1, L5 (WebKit + fake core): the Tasks page and its Schedule view. FR-TSK-04 AC-1…AC-12, FR-TSK-03 AC-1,
// FR-TSK-09 AC-1, FR-TSK-01 AC-5, AC-7 (views), FR-TSK-11 AC-1…AC-3. docs/acceptance/tasks.md (R40, R41, R44, R45);
// interface docs/contracts/ms5-tasks.md §4, §6 (`task_list` re-queried on `vault:changed`, the 30 s day check), §7 (fake
// core). Clock, zone and region injected; (TZ) criteria run in Europe/Prague and America/Los_Angeles, (W) with `cs`
// and `en-US`. Written from the ACs and the contract only (D-61). Missing elements fail an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  NOW, O, T, ZONES, absent, card, cardPaths, cardsWhen, checkbox, dateFilter, description, eventually, fileText, filterBtn, flat, gotoKanban, gotoTasks,
  groupsOf, heading, isDisabled, main, mainName, moreBtn, must, mustBeOn, navs, nfc, paths, pressed, quickAdd, runCommand, sectionIds, sectionOf, seen,
  shortDate, sidebarTasks, sleep, sortBtn, startTasks, swap, tagBtn, tagFilter, taskText, tasksVault, titleOf, tzTag, viewTab, views, writeCalls, writesOf,
  allCards, original, attr, click, textOf,
} from './tasks-helpers';

const SUMMARY = '15 open · 2 overdue · 2 due today';
async function summaryText(page: Page): Promise<string> {
  return flat(await main(page).innerText().catch(() => ''));
}
/** The R41 day groups of the Schedule as `[heading, paths]`. */
async function schedule(page: Page) {
  return {
    sections: await sectionIds(page),
    today: await groupsOf(sectionOf(page, 'today')),
    week: await groupsOf(sectionOf(page, 'week')),
    later: await cardPaths(sectionOf(page, 'later')),
    none: await cardPaths(sectionOf(page, 'none')),
  };
}
const doneToggle = (page: Page) => sectionOf(page, 'done').getByRole('button', { name: /^Done\b/ });

// ------------------------------------------------------------------------------------------------ AC-1

test.describe('the page (Europe/Prague, cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac1_sidebar_and_palette_open_the_schedule', async ({ page }) => {
    const core = await startTasks(page);
    const entry = await must(sidebarTasks(page), 'sidebar entry Tasks');
    assert.match((await textOf(entry)), /^Tasks\s*4$/, 'the sidebar count: overdue + due today = 4 (AP-411)');
    await entry.click();
    await must(heading(page), 'heading Tasks');
    assert.ok((await summaryText(page)).includes(SUMMARY), `summary "${SUMMARY}"`);
    assert.equal(await attr(viewTab(page, 'Schedule'), 'aria-selected'), 'true', 'Schedule selected');
    assert.equal(await attr(viewTab(page, 'Kanban'), 'aria-selected'), 'false');
    await must(quickAdd(page), 'quick-add row');
    assert.equal(await pressed(filterBtn(page, 'All')), 'true', 'All pressed');
    const sort = await must(sortBtn(page, 'Priority, then due'), 'Sort "Priority, then due"');
    assert.equal(await isDisabled(sort), true, 'Sort aria-disabled');
    assert.equal(await description(sort), 'Coming in v1.0', 'Sort: Coming in v1.0 (AP-407)');
    await must(tagFilter(page), 'tag filter');
    const focus = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}:${a.getAttribute('aria-level') ?? ''}:${(a.textContent ?? '').trim()}` : ''; });
    assert.match(focus, /^(H1|[A-Z]+:1):.*Tasks/, `the focus is on the heading (D-130): ${focus}`);
    assert.deepEqual(await navs(core), [], 'no recency recorded (D-138)');
    assert.deepEqual(await writeCalls(core), [], 'no write');
    await runCommand(page, 'Go to Types');
    await runCommand(page, 'Go to Tasks');
    await must(heading(page), 'Go to Tasks opens the page again');
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
      assert.deepEqual(s.sections, ['today', 'week', 'later', 'none', 'done'], 'the five sections in order');
      assert.deepEqual(s.today, [{ heading: 'Overdue', paths: paths('t01', 't02') }, { heading: `Today · ${shortDate('2026-10-14', 'cs')}`, paths: paths('t03', 't14') }], 'Today & overdue');
      assert.deepEqual(s.week.map((g) => g.paths), [paths('t04', 't19'), paths('t15'), paths('t05')], 'This week: Thu 15, Fri 16, Sun 18; no group for Sat 17');
      assert.deepEqual(s.later, paths('t06', 't07'), 'Later');
      assert.deepEqual(s.none, paths('t08', 't09', 't17', 't16', 't18'), 'Not scheduled');
      const hint = (await textOf(sectionOf(page, 'week')));
      assert.ok(hint.includes(`${shortDate('2026-10-15', 'cs')} – ${shortDate('2026-10-18', 'cs')} · sorted by due date`), `This week hint by the region: ${hint}`);
      const later = (await textOf(sectionOf(page, 'later')));
      assert.ok(later.includes(`Due after ${shortDate('2026-10-18', 'cs')}`), `Later hint names the day after the week: ${later}`);
    });
  });
}

test.describe('sections with en-US (week from Sunday)', () => {
  test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

  test('fr_tsk_04_ac2_sections_en_us', async ({ page }) => {
    await startTasks(page, { region: 'en-US' });
    await gotoTasks(page);
    const s = await schedule(page);
    assert.deepEqual(s.week.map((g) => g.paths), [paths('t04', 't19'), paths('t15')], 'This week: Thu 15, Fri 16');
    assert.deepEqual(s.later, paths('t05', 't06', 't07'), 'Later: T05, T06, T07');
    const hint = (await textOf(sectionOf(page, 'week')));
    assert.ok(hint.includes(`${shortDate('2026-10-15', 'en-US')} – ${shortDate('2026-10-17', 'en-US')} · sorted by due date`), `Thursday to Saturday: ${hint}`);
  });

  test('fr_tsk_04_ac4_date_filters_en_us', async ({ page }) => {
    await startTasks(page, { region: 'en-US' });
    await gotoTasks(page);
    assert.equal(await description(filterBtn(page, 'This week')), '7', 'This week 7 in en-US');
    await click(filterBtn(page, 'This week'), 'button This week');
    assert.equal((await allCards(page)).length, 7, '7 cards');
  });
});

test.describe('Sunday (cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac2_on_sunday_this_week_is_not_shown', async ({ page }) => {
    await startTasks(page, { now: '2026-10-18T12:00:00+02:00' });
    await gotoTasks(page);
    const s = await schedule(page);
    assert.ok(!s.sections.includes('week'), `no This week section on the week's last day: ${s.sections}`);
    assert.deepEqual(s.later, paths('t06', 't07'), 'T06 (19 Oct) is in Later');
  });
});

// ------------------------------------------------------------------------------------------------ AC-3…AC-5

test.describe('Done and filters (Europe/Prague, cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac3_done_is_collapsed_and_remembered', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const btn = await must(doneToggle(page), 'button Done');
    assert.equal(await attr(btn, 'aria-expanded'), 'false', 'collapsed by default (AP-405)');
    assert.match((await textOf(btn)), /^Done\s*3$/, 'Done and its count 3');
    assert.deepEqual(await cardPaths(sectionOf(page, 'done')), [], 'no Done card while collapsed');
    await btn.click();
    assert.deepEqual(await cardsWhen(sectionOf(page, 'done'), paths('t10', 't12', 't11')), paths('t10', 't12', 't11'), 'T10, T12, T11');
    for (const k of ['t10', 't12', 't11'] as const) {
      const c = card(page, titleOf(T[k]));
      assert.equal(await attr(checkbox(c, titleOf(T[k])), 'aria-checked'), 'true', `${k} checked`);
      const deco = await (await must(c.getByRole('link', { name: titleOf(T[k]) }), `${k} title`)).evaluate((e) => getComputedStyle(e).textDecorationLine);
      assert.ok(deco.includes('line-through'), `${k} struck through`);
    }
    assert.ok((await textOf(card(page, titleOf(T.t10)))).includes('Completed today'), 'T10: Completed today');
    assert.ok((await textOf(card(page, titleOf(T.t11)))).includes(`Completed ${shortDate('2026-10-05', 'cs')}`), 'T11: Completed <date>');
    const st = await eventually(() => core.uiState(), (u) => u?.tasks?.doneExpanded === true, 2000);
    assert.equal(st?.tasks?.doneExpanded, true, 'expanded state kept per machine (ui_state_set, AP-411)');
  });

  test('fr_tsk_04_ac3_done_shows_50_then_show_more', async ({ page }) => {
    const vault = tasksVault((f) => {
      for (let i = 0; i < 60; i++) f[`Tasks/Hotovo ${String(i).padStart(2, '0')}.md`] = taskText(100 + i, `Hotovo ${String(i).padStart(2, '0')}`, `status: Done\ncompleted: 2026-10-0${1 + (i % 9)}T10:00:00+02:00\n`);
    });
    await startTasks(page, { vault });
    await gotoTasks(page);
    await (await must(doneToggle(page), 'button Done')).click();
    assert.equal((await eventually(() => cardPaths(sectionOf(page, 'done')), (v) => v.length >= 50)).length, 50, 'at most 50 cards');
    await must(sectionOf(page, 'done').getByRole('button', { name: 'Show 13 more', exact: true }), 'Show 13 more (63 Done tasks)');
  });

  test('fr_tsk_04_ac4_date_filters_cs', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const counts = await Promise.all((['All', 'Today', 'This week'] as const).map((n) => description(filterBtn(page, n))));
    assert.deepEqual(counts, ['15', '4', '8'], 'All 15, Today 4, This week 8');
    await click(filterBtn(page, 'Today'), 'button Today');
    assert.equal(await pressed(filterBtn(page, 'Today')), 'true');
    assert.deepEqual((await sectionIds(page)).filter((x) => x !== 'done'), ['today'], 'Today: only Today & overdue');
    assert.equal((await cardPaths(sectionOf(page, 'today'))).length, 4, '4 cards');
    await (await must(doneToggle(page), 'Done')).click();
    assert.deepEqual(await cardsWhen(sectionOf(page, 'done'), paths('t10')), paths('t10'), 'Done: completed today');
    await click(filterBtn(page, 'This week'), 'button This week');
    assert.deepEqual((await sectionIds(page)).filter((x) => x !== 'done'), ['today', 'week'], 'This week: Today & overdue and This week');
    assert.equal((await cardPaths(sectionOf(page, 'today'))).length + (await cardPaths(sectionOf(page, 'week'))).length, 8, '8 cards in cs');
    assert.deepEqual(await cardPaths(sectionOf(page, 'done')), paths('t10'), 'Done: completed this week (from Monday)');
    await click(filterBtn(page, 'All'), 'button All');
    assert.deepEqual((await sectionIds(page)), ['today', 'week', 'later', 'none', 'done'], 'All: every section');
    assert.deepEqual(await writeCalls(core), [], 'filters write nothing to the vault');
  });

  test('fr_tsk_04_ac5_tag_filter', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const tf = await must(tagFilter(page), 'group Filter by tag');
    const names = (await tf.getByRole('button').allInnerTexts()).map(flat).filter((n) => n.startsWith('#'));
    assert.deepEqual(names.map((n) => n.replace(/\s*\d+$/, '')), ['#čtení', '#doma', '#finance', '#práce', '#rodina'], 'D-122 order');
    const counts = await Promise.all(['čtení', 'doma', 'finance', 'práce', 'rodina'].map((t) => description(tagBtn(page, t))));
    assert.deepEqual(counts, ['1', '4', '1', '4', '1'], 'counts of open tasks (Doma, NFD doma and inline #rodina count; T10 not)');
    await click(tagBtn(page, 'doma'), 'button doma');
    assert.equal(await pressed(tagBtn(page, 'doma')), 'true');
    assert.deepEqual((await allCards(page)).sort(), paths('t03', 't04', 't19', 't05').sort(), 'only T03, T04, T19, T05');
    await click(tagBtn(page, 'finance'), 'button finance');
    assert.ok((await allCards(page)).includes(T.t02), 'T02 added');
    assert.ok(await seen(main(page).getByText('Showing tasks with any of the selected tags', { exact: true })), 'the any-of note');
    await (await must(tf.getByRole('button', { name: 'Clear', exact: true }), 'Clear')).click();
    assert.equal(await pressed(tagBtn(page, 'doma')), 'false', 'Clear releases the tags');
    await click(tagBtn(page, 'čtení'), 'button čtení');
    await core.setFile(T.t08, swap(original(T.t08), 'tags: [čtení]\n', ''));
    assert.equal(await eventually(() => description(tagBtn(page, 'čtení')), (d) => d === '0'), '0', 'a selected tag without tasks stays with count 0');
    assert.equal(await pressed(tagBtn(page, 'čtení')), 'true', 'and stays pressed');
  });
});

// ------------------------------------------------------------------------------------------------ AC-6, FR-TSK-11

test.describe('what is never a task (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac6_never_shown', async ({ page }) => {
    await startTasks(page);
    await gotoTasks(page);
    await (await must(doneToggle(page), 'Done')).click();
    const shown = await eventually(() => allCards(page), (v) => v.length >= 18);
    assert.deepEqual([...shown].sort(), Object.values(T).filter((p) => p !== T.t13).map(nfc).sort(), 'every task but T13 (Cancelled)');
    const text = flat(await main(page).innerText());
    for (const w of ['Zavolat dodavateli', 'Poslat zápis', 'Objednat projektor', 'Něco udělat', 'Smazaný úkol', 'Web', 'Se stavem']) assert.ok(!text.includes(w), `"${w}" is not on the page`);
  });

  test('fr_tsk_11_ac1_a_new_checklist_item_changes_no_view', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    const before = { cards: await allCards(page), text: (await main(page).innerText()).includes(SUMMARY) };
    assert.equal(before.cards.length, 15 + 0, '15 cards with Done collapsed (open tasks)');
    await core.setFile(O.porada, `${original(O.porada)}\n- [ ] Nový bod\n`);
    await sleep(500);
    assert.deepEqual(await allCards(page), before.cards, 'no section changes');
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
    const vault = tasksVault((f) => { f[T.t04] = `${original(T.t04)}- [ ] krok\n`; });
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
    const today = await eventually(() => groupsOf(sectionOf(page, 'today')), (g) => !!g[1]?.paths.includes('Tasks/Nový.md'), 2000);
    assert.ok(today[1]?.paths.includes('Tasks/Nový.md'), 'Nový in Today within 2 s');
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
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-path') ?? null);
    assert.equal(focused && nfc(focused), T.t06, 'the focused card keeps the focus');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_tsk_04_ac8_midnight_recomputes', async ({ page }) => {
    const core = await startTasks(page, { now: '2026-10-14T23:59:58+02:00', install: true });
    await gotoTasks(page);
    await page.clock.runFor(61_000);
    const g = await eventually(() => groupsOf(sectionOf(page, 'today')), (x) => !!x[0]?.paths.includes(T.t03), 3000);
    assert.ok(g[0]?.paths.includes(T.t03), 'T03 moves to Overdue');
    assert.ok((await textOf(card(page, titleOf(T.t03)))).includes(`${shortDate('2026-10-14', 'cs')} · Yesterday`), 'T03: <Wed 14 Oct> · Yesterday');
    assert.deepEqual(g[1]?.paths, paths('t04', 't19'), 'T04 and T19 move to Today');
    assert.ok(flat(await main(page).innerText()).includes('15 open · 4 overdue · 2 due today'), 'the summary follows (T03, T14 overdue; T04, T19 due)');
    assert.match((await textOf(sidebarTasks(page))), /^Tasks\s*6$/, 'the sidebar count follows');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_tsk_04_ac8_a_zone_change_recomputes', async ({ page }) => {
    await startTasks(page, { now: '2026-10-15T00:30:00+02:00', install: true });
    await gotoTasks(page);
    assert.ok((await groupsOf(sectionOf(page, 'today')))[0]?.paths.includes(T.t03), 'Prague, 15 Oct 00:30: T03 overdue');
    await page.evaluate(() => { (window as any).__TEGG_TZ__ = 'America/Los_Angeles'; });
    await page.clock.runFor(61_000);
    const g = await eventually(() => groupsOf(sectionOf(page, 'today')), (x) => !!x[1]?.paths.includes(T.t03), 3000);
    assert.ok(g[1]?.paths.includes(T.t03), 'Los Angeles, 14 Oct 15:30: T03 due today again, without a restart');
  });
});

// ------------------------------------------------------------------------------------------------ AC-9, AC-10

test.describe('opening and keyboard (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac9_opening_a_task_and_back', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    await click(filterBtn(page, 'This week'), 'button This week');
    await (await must(doneToggle(page), 'Done')).click();
    await (await must(card(page, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'title link')).click();
    await mustBeOn(page, 'Zavolat Janě', 'the title opens note/<path>', 5000);
    assert.ok((await navs(core)).includes(T.t01), 'nav_opened records it');
    await page.keyboard.press('Meta+BracketLeft');
    await must(heading(page), 'Back to tasks');
    assert.equal(await pressed(filterBtn(page, 'This week')), 'true', 'filter kept');
    assert.equal(await attr(doneToggle(page), 'aria-expanded'), 'true', 'Done expanded kept');
    await (await must(card(page, 'Poslat rozpočet'), 'card')).focus();
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Poslat rozpočet', '⏎ on the focused card', 5000);
    await page.keyboard.press('Meta+BracketLeft');
    await must(heading(page), 'Back again');
    await (await must(moreBtn(card(page, 'Zalít květiny'), 'Zalít květiny'), 'More')).click();
    await (await must(page.getByRole('menuitem', { name: 'Open', exact: true }), 'menu Open')).click();
    await mustBeOn(page, 'Zalít květiny', 'More › Open', 5000);
  });

  test('fr_tsk_04_ac10_keyboard_only', async ({ page }) => {
    const core = await startTasks(page);
    await gotoTasks(page);
    await (await must(quickAdd(page), 'quick-add row')).focus();
    let path: string | null = null;
    for (let i = 0; i < 30 && !path; i++) {
      await page.keyboard.press('Tab');
      path = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-path]')?.getAttribute('data-path') ?? null);
    }
    assert.equal(path && nfc(path), T.t01, 'Tab reaches the first card (T01) after the toolbar');
    await page.keyboard.press('ArrowDown');
    const next = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-path]')?.getAttribute('data-path') ?? null);
    assert.equal(next && nfc(next), T.t02, '↓ moves in reading order');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    const w = await eventually(() => writesOf(core, T.t03), (x) => x.length === 1, 2000);
    assert.equal(w.length, 1, 'Space toggles the checkbox of T03 (one write)');
    await page.keyboard.press('Shift+F10');
    await must(page.getByRole('menu'), '⇧F10 opens the card menu');
    await page.keyboard.press('Escape');
    assert.ok(await absent(page.getByRole('menu')), 'Esc closes it');
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Zalít květiny', '⏎ opens the focused task', 5000);
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
      for (const p of new Intl.DateTimeFormat((window as any).__TEGG_REGION__ ?? 'cs', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(Date.UTC(2026, mo, d))) dateWords.add(p.value.trim());
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
    await must(main(page).getByRole('heading', { level: 1, name: '⟦Tasks⟧' }), 'heading ⟦Tasks⟧');
    await (await must(doneToggle(page).or(sectionOf(page, 'done').getByRole('button').first()), 'Done')).click();
    const fails: string[] = [];
    const u1 = await unmarked(page);
    if (u1.length) fails.push(`tasks: ${u1.join(' ')}`);
    await (await must(main(page).getByRole('button', { name: /More actions for/ }).first(), 'a card menu')).click();
    const menu = await page.getByRole('menu').allInnerTexts();
    if (menu.some((t) => t.replace(/⟦[^⟦⟧]*⟧/g, '').match(/\p{L}/u))) fails.push(`menu: ${menu.join(' | ')}`);
    await page.keyboard.press('Escape');
    await (await must(main(page).getByRole('tablist', { name: '⟦Task views⟧', exact: true }).getByRole('tab', { name: '⟦Kanban⟧' }), 'tab ⟦Kanban⟧')).click();
    await sleep(300);
    const u2 = await unmarked(page);
    if (u2.length) fails.push(`kanban: ${u2.join(' ')}`);
    assert.deepEqual(fails, [], 'only titles, tag names, status and priority labels and body text are outside ⟦ ⟧');
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
    const vault = tasksVault((f) => {
      f['Tasks/A úkol.md'] = taskText(1, 'A úkol', 'status: To do\n');
      f['Tasks/B úkol.md'] = taskText(2, 'B úkol', 'status: To do\npriority: None\n');
      f['Tasks/C úkol.md'] = taskText(3, 'C úkol', 'status: To do\npriority: Low\n');
    });
    await startTasks(page, { vault });
    await gotoTasks(page);
    assert.deepEqual((await groupsOf(sectionOf(page, 'today')))[0]?.paths, paths('t01', 't02'), 'T01 (High) before T02 (Medium)');
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
        const over = await main(page).evaluate((m) => ([...m.querySelectorAll('[data-overdue="true"]')] as HTMLElement[]).map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC')));
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
        assert.deepEqual(await writeCalls(core), [], 'no write changes due');
      });
    });
  }

  for (const [n, at] of [['first', '2026-10-14T00:00:00+02:00'], ['last', '2026-10-14T23:59:59+02:00']] as const) {
    test(`fr_tsk_01_ac5_the_${n}_second_of_the_day_is_today`, async ({ page }) => {
      await startTasks(page, { now: at });
      await gotoTasks(page);
      assert.ok((await groupsOf(sectionOf(page, 'today')))[1]?.paths.includes(T.t03), `${at}: T03 due today`);
    });
  }

  test('fr_tsk_01_ac7_views_are_identical_after_a_reload', async ({ page }) => {
    await startTasks(page);
    await gotoTasks(page);
    const a = await schedule(page);
    const k1 = await (async () => { await gotoKanban(page, 'Status'); return cardPaths(main(page)); })();
    await page.reload();
    await gotoTasks(page);
    assert.deepEqual(await schedule(page), a, 'the Schedule from a fresh read');
    assert.ok(a.later.length > 0, 'the Schedule has cards');
    await gotoKanban(page, 'Status');
    assert.deepEqual(await cardPaths(main(page)), k1, 'the Kanban from a fresh read');
  });
});

void dateFilter; void original; void isDisabled; void mainName; void absent;
