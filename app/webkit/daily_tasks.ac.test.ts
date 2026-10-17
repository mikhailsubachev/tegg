// MS5 slice 5A-1, L5 (WebKit + fake core): the Daily Note's `Tasks due` section (replaces the D-271 placeholder).
// FR-DLY-04 AC-8…AC-14. docs/acceptance/tasks.md (R43, R44; D-485, D-328); interface docs/contracts/ms5-tasks.md §2.3
// (`daily_tasks` with the UI's day window and today), §5 (the checkbox writes the task only), §6.2 (`DailyTasks.tsx`).
// Clock 2026-10-14T12:00:00+02:00; (TZ) also America/Los_Angeles. Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { cmdD, gotoDaily, section, virtualMarker } from './daily-helpers';
import {
  NOW, O, T, callsOf, click, description, eventually, fileText, fileWhen, flat, must, mustBeOn, nfc, original, seen, shortDate, startTasks, swap,
  taskText, tasksVault, textOf, writeCalls, attr,
} from './tasks-helpers';

/** Row titles of `Tasks due`, in order, from the R43 checkboxes (`Complete "<t>"` / `Mark "<t>" not done`). */
async function rows(page: Page): Promise<string[]> {
  const s = await must(section(page, 'Tasks due'), 'region "Tasks due"');
  const names = await s.getByRole('checkbox').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? ''));
  return names.map((n) => nfc(/^(?:Complete|Mark) "(.*)"(?: not done)?$/.exec(n)?.[1] ?? n));
}
async function rowsWhen(page: Page, ok: (r: string[]) => boolean, ms = 2000) {
  return eventually(() => rows(page), ok, ms);
}
const row = (page: Page, title: string) => section(page, 'Tasks due').getByRole('checkbox', { name: new RegExp(`^(Complete|Mark) "${title}"`) })
  .locator('xpath=ancestor::*[self::li or @role="listitem" or @role="row" or @data-path][1]');

test.describe('Tasks due in Europe/Prague', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_04_ac8_the_section_is_built', async ({ page }) => {
    await startTasks(page);
    await cmdD(page, '2026-10-14');
    const s = await must(section(page, 'Tasks due'), 'region "Tasks due"');
    assert.equal(await s.locator('[data-placeholder="daily-tasks"]').count(), 0, 'no data-placeholder="daily-tasks"');
    assert.ok(!(await textOf(s)).includes('Coming in MS5'), 'no Coming in MS5');
    const tops: number[] = [];
    for (const n of ['Quick Notes', 'Tasks due', 'Created', 'Modified'] as const) tops.push((await (await must(section(page, n), n)).boundingBox())?.y ?? -1);
    assert.ok(tops.every((y, i) => i === 0 || y > tops[i - 1]), `still second after Quick Notes (D-328): ${tops.join(', ')}`);
    assert.ok((await rows(page)).length > 0, 'it lists tasks');
  });

  test('fr_dly_04_ac9_what_each_date_lists', async ({ page }) => {
    await startTasks(page);
    await cmdD(page, '2026-10-14');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 5), ['Zavolat Janě', 'Poslat rozpočet', 'Zalít květiny', 'Bez stavu', 'Zaplatit fakturu'], '14 Oct: overdue, due today, completed today');
    for (const t of ['Zavolat Janě', 'Poslat rozpočet']) assert.match(await textOf(row(page, t)), /overdue|Yesterday/, `${t}: overdue highlight`);
    assert.equal(await attr(section(page, 'Tasks due').getByRole('checkbox', { name: 'Mark "Zaplatit fakturu" not done' }), 'aria-checked'), 'true', 'T10 checked');
    await gotoDaily(page, '2026-10-09');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 1), ['Zavolat Janě'], '9 Oct (written): T01 only');
    await gotoDaily(page, '2026-10-15');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 2), ['Koupit dárek', 'Nákup'], '15 Oct: T04, T19');
    await gotoDaily(page, '2026-10-05');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 1), ['Objednat lístky'], '5 Oct: T11 completed that evening');
    await gotoDaily(page, '2026-10-10');
    assert.deepEqual(await rows(page), [], '10 Oct: T13 (Cancelled) never listed');
    assert.ok((await textOf(section(page, 'Tasks due'))).includes('Nothing yet'), 'Nothing yet');
  });

  test('fr_dly_04_ac10_rows', async ({ page }) => {
    const core = await startTasks(page);
    await cmdD(page, '2026-10-14');
    await rowsWhen(page, (r) => r.length === 5);
    const r1 = row(page, 'Zavolat Janě');
    const text = await textOf(r1);
    assert.ok(text.includes(`${shortDate('2026-10-09', 'cs')} · 5 days overdue`), `due chip: ${text}`);
    const src = await must(r1.locator('[data-link-kind]').filter({ hasText: 'Porada' }), 'source chip');
    assert.equal(await description(src), 'Source: Porada');
    assert.ok(!text.includes('Domluvit') && !text.includes('#práce') && !text.includes('High'), 'no body, tags or priority');
    assert.ok((await r1.locator('[data-icon], svg').count()) > 0, 'the type icon');
    await click(r1.getByRole('link', { name: 'Zavolat Janě', exact: true }), 'title link');
    await mustBeOn(page, 'Zavolat Janě', 'the title opens the task', 5000);
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_04_ac11_first_matching_section', async ({ page }) => {
    const vault = tasksVault((f) => { f['Tasks/Dnešní.md'] = taskText(5, 'Dnešní', 'status: To do\ndue: 2026-10-14\n').replace(/created: .*\nmodified: .*\n/, 'created: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n'); });
    await startTasks(page, { vault });
    await cmdD(page, '2026-10-14');
    const r = await rowsWhen(page, (x) => x.includes('Dnešní'));
    assert.ok(r.includes('Zaplatit fakturu') && r.includes('Dnešní'), 'both in Tasks due');
    const modified = flat(await section(page, 'Modified').innerText());
    const createdS = flat(await section(page, 'Created').innerText());
    assert.ok(!modified.includes('Zaplatit fakturu'), 'T10 not in Modified');
    assert.ok(!createdS.includes('Dnešní'), 'the new task not in Created');
  });

  test('fr_dly_04_ac12_completing_never_writes_the_daily_note', async ({ page }) => {
    const core = await startTasks(page);
    await cmdD(page, '2026-10-14');
    await rowsWhen(page, (r) => r.length === 5);
    await click(section(page, 'Tasks due').getByRole('checkbox', { name: 'Complete "Zalít květiny"', exact: true }), 'check T03');
    const t = await fileWhen(core, T.t03, (x) => x !== original(T.t03));
    assert.ok(t?.includes(`completed: ${NOW}`), 'T03 written');
    assert.deepEqual([...new Set((await core.writesTo()).map(nfc))], [T.t03], 'only the task file');
    assert.equal(await fileText(core, 'Daily/2026-10-14.md'), undefined, 'no Daily/2026-10-14.md');
    assert.ok(await seen(virtualMarker(page)), 'the note stays virtual');
    const want = ['Zavolat Janě', 'Poslat rozpočet', 'Bez stavu', 'Zalít květiny', 'Zaplatit fakturu'];
    assert.deepEqual(await rowsWhen(page, (r) => JSON.stringify(r) === JSON.stringify(want), 1000), want, 'within 1 s T03 moves from group (2) to group (3), newest first');
    await gotoDaily(page, '2026-10-09');
    await rowsWhen(page, (r) => r.length === 1);
    await click(section(page, 'Tasks due').getByRole('checkbox', { name: 'Complete "Zavolat Janě"', exact: true }), 'check T01');
    await fileWhen(core, T.t01, (x) => x !== original(T.t01));
    assert.deepEqual([...new Set((await core.writesTo()).map(nfc))], [T.t03, T.t01], 'on the written 9 Oct note only T01 is written');
    assert.equal(await fileText(core, O.d09), original(O.d09), 'the Daily Note keeps its bytes');
  });

  test('fr_dly_04_ac13_live_and_limits', async ({ page }) => {
    const vault = tasksVault((f) => { for (let i = 0; i < 55; i++) f[`Tasks/Hromada ${String(i).padStart(2, '0')}.md`] = taskText(200 + i, `Hromada ${String(i).padStart(2, '0')}`, 'status: To do\ndue: 2026-10-20\n'); });
    const core = await startTasks(page, { vault });
    await cmdD(page, '2026-10-14');
    await gotoDaily(page, '2026-10-15');
    await rowsWhen(page, (r) => r.length === 2);
    await core.setFile(T.t07, swap(original(T.t07), 'due: 2026-12-01', 'due: 2026-10-15'));
    assert.ok((await rowsWhen(page, (r) => r.includes('Obnovit pas'))).includes('Obnovit pas'), 'an external due change adds the row within 2 s');
    await gotoDaily(page, '2026-10-20');
    assert.equal((await rowsWhen(page, (r) => r.length >= 50)).length, 50, 'at most 50 rows');
    await must(section(page, 'Tasks due').getByRole('button', { name: 'Show 5 more', exact: true }), 'Show 5 more');
    await gotoDaily(page, '2026-10-22');
    assert.ok((await textOf(section(page, 'Tasks due'))).includes('Nothing yet'), 'Nothing yet with no rows');
    assert.deepEqual((await core.writesTo()).filter((p) => p.startsWith('Daily/')), [], 'nothing is written into a Daily Note');
  });

  test('fr_dly_04_ac14_keyboard', async ({ page }) => {
    const core = await startTasks(page);
    await cmdD(page, '2026-10-14');
    await rowsWhen(page, (r) => r.length === 5);
    const qn = await section(page, 'Quick Notes').getByRole('link').count();
    await (await must(section(page, 'Quick Notes').getByRole('link').last().or(section(page, 'Quick Notes')), 'Quick Notes')).focus();
    const seenOrder: string[] = [];
    for (let i = 0; i < 4; i++) { // the 4th stop is the next row's checkbox, where Space acts
      await page.keyboard.press('Tab');
      seenOrder.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.getAttribute('role') ?? a.tagName.toLowerCase()}:${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim()}` : ''; }));
    }
    assert.match(seenOrder[0], /^checkbox:Complete "Zavolat Janě"$/, `first the checkbox after the Quick Notes rows (${qn}): ${seenOrder.join(' | ')}`);
    assert.match(seenOrder[1], /^(link|a):.*Zavolat Janě/, 'then the title');
    assert.match(seenOrder[2], /Porada/, 'then the source chip');
    assert.match(seenOrder[3], /^checkbox:Complete "Poslat rozpočet"$/, 'then the next row');
    await page.keyboard.press('Space');
    assert.ok((await fileWhen(core, T.t02, (x) => x !== original(T.t02)))?.includes('status: Done'), 'Space toggles it');
    // T02 moved to the completed rows; the title of the first row is reached by keyboard again.
    await (await must(row(page, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'title Zavolat Janě')).focus();
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Zavolat Janě', '⏎ on the title opens the task', 5000);
    void callsOf;
  });
});

test.describe('Tasks due in America/Los_Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('fr_dly_04_ac9_completed_on_its_local_day', async ({ page }) => {
    await startTasks(page);
    await cmdD(page, '2026-10-14');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 5), ['Zavolat Janě', 'Poslat rozpočet', 'Zalít květiny', 'Bez stavu', 'Zaplatit fakturu'], '14 Oct in Los Angeles');
    await gotoDaily(page, '2026-10-05');
    assert.deepEqual(await rowsWhen(page, (r) => r.length === 1), ['Objednat lístky'], '5 Oct: T11 at 09:00 local');
  });
});
