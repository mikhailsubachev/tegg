// MS4 slice 4B, L5 (WebKit + fake core): previous/next day and the calendar. FR-DLY-03 AC-1…AC-6. docs/acceptance/
// daily-notes.md (R17, R18); interface docs/contracts/ms4-daily.md §4 (`daily_dates`), §7.1, §7.2 (`Calendar`, the
// WAI-ARIA date-picker grid). Clock, zone and region injected; (TZ) criteria run in Europe/Prague and
// America/Los_Angeles. Written from the ACs and the contract only (D-61). Missing elements fail an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  D, ZONES, absent, calendar, calendarGrid, callsOf, caretAtEnd, cmdD, dayButton, editorBody, eventually, flat, linkSuggestions, longDate, must,
  mustBeOn, mustDaily, nextDay, original, pickDate, prevDay, runCommand, seen, sleep, startDaily, stateIs, swap, titleText, tzTag, writeCalls,
} from './daily-helpers';

const LOCAL: Record<string, string> = { 'Europe/Prague': '+02:00', 'America/Los_Angeles': '-07:00' };

async function openCalendar(page: Page) {
  await (await must(pickDate(page), 'button "Pick date"')).click();
  return must(calendar(page), 'dialog "Calendar"');
}
/** ISO dates of the shown month's days with `data-has-note="true"` (named by the long date, R18). */
async function markedDays(page: Page, region = 'en'): Promise<string[]> {
  const g = await must(calendarGrid(page), 'calendar grid');
  const labels = await g.getByRole('gridcell').getByRole('button').evaluateAll((bs) =>
    bs.filter((b) => b.getAttribute('data-has-note') === 'true').map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim()));
  const all: Record<string, string> = {};
  for (let d = 1; d <= 31; d++) for (const m of [9, 10, 11]) {
    const iso = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) && new Date(`${iso}T12:00:00Z`).getUTCMonth() === m - 1) all[longDate(iso, region)] = iso;
  }
  return labels.map((l) => all[flat(l)] ?? `?${l}`).sort();
}

// ------------------------------------------------------------------------------------------------ AC-1

for (const tz of ZONES) {
  test.describe(`previous and next in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test(`fr_dly_03_ac1_next_and_previous_are_calendar_days_${tzTag(tz)}`, async ({ page }) => {
      const core = await startDaily(page);
      await cmdD(page, '2026-10-14');
      const n0 = (await callsOf(core, 'nav_opened')).length;
      await (await must(nextDay(page), 'button "Next day"')).click();
      await mustDaily(page, '2026-10-15', 'Next day button');
      await page.keyboard.press('Alt+Meta+ArrowLeft');
      await mustDaily(page, '2026-10-14', '⌥⌘←');
      await page.keyboard.press('Alt+Meta+ArrowRight');
      await mustDaily(page, '2026-10-15', '⌥⌘→');
      await runCommand(page, 'Previous day');
      await mustDaily(page, '2026-10-14', 'palette Previous day');
      await (await must(prevDay(page), 'button "Previous day"')).click();
      await mustDaily(page, '2026-10-13', 'Previous day (virtual, whatever has notes)');
      await runCommand(page, 'Next day');
      await mustDaily(page, '2026-10-14', 'palette Next day');
      assert.equal((await callsOf(core, 'nav_opened')).length - n0, 6, 'each step is one nav_opened');
      assert.deepEqual(await writeCalls(core), [], 'no writes');
    });

    const walks: [string, string[]][] = [
      ['2026-10-24', ['2026-10-25', '2026-10-26']],
      ['2026-10-31', ['2026-11-01', '2026-11-02']],
      ['2026-12-31', ['2027-01-01']],
      ['2028-02-28', ['2028-02-29']],
    ];
    for (const [from, to] of walks) {
      test(`fr_dly_03_ac1_boundaries_from_${from}_${tzTag(tz)}`, async ({ page }) => {
        const core = await startDaily(page, { now: `${from}T12:00:00${LOCAL[tz]}` });
        await cmdD(page, from);
        for (const d of to) {
          await page.keyboard.press('Alt+Meta+ArrowRight');
          await mustDaily(page, d, `next of the previous day → ${d} (no day skipped or repeated)`);
        }
        assert.deepEqual(await writeCalls(core), [], 'no writes');
      });
    }

    test(`fr_dly_03_ac1_previous_of_1_march_${tzTag(tz)}`, async ({ page }) => {
      await startDaily(page, { now: `2026-03-01T12:00:00${tz === 'Europe/Prague' ? '+01:00' : '-08:00'}` });
      await cmdD(page, '2026-03-01');
      await page.keyboard.press('Alt+Meta+ArrowLeft');
      await mustDaily(page, '2026-02-28', 'previous of 2026-03-01');
    });
  });
}

// ------------------------------------------------------------------------------------------------ AC-2…AC-6

test.describe('calendar', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_03_ac2_shortcuts_only_on_daily_routes', async ({ page }) => {
    await startDaily(page, { at: D.zminky });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    await (await must(editorBody(page), 'body')).click();
    await page.keyboard.press('Alt+Meta+ArrowRight');
    await page.keyboard.press('Alt+Meta+ArrowLeft');
    await sleep(300);
    await mustBeOn(page, 'Zmínky', '⌥⌘← / ⌥⌘→ on a note route do what they did before 4B');
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.type(' @Zm');
    await must(linkSuggestions(page), 'the @ list');
    await page.keyboard.press('Alt+Meta+ArrowRight');
    await sleep(300);
    assert.equal(await titleText(page), '2026-10-14', 'inside the @ list the shortcut does not change the day');
    assert.ok(await seen(linkSuggestions(page), 300), 'the list stays open');
  });

  test('fr_dly_03_ac3_the_calendar_marks_days_with_notes', async ({ page }) => {
    const core = await startDaily(page, { region: 'en' });
    await cmdD(page, '2026-10-14');
    const cal = await openCalendar(page);
    assert.ok(await seen(cal.getByRole('heading', { name: 'October 2026', exact: true }), 1000), 'header October 2026');
    for (const b of ['Previous month', 'Next month']) assert.ok(await seen(cal.getByRole('button', { name: b, exact: true }), 500), `button ${b}`);
    assert.deepEqual(await markedDays(page), ['2026-10-01', '2026-10-07', '2026-10-09', '2026-10-10', '2026-10-12'], 'exactly 1, 7, 9, 10, 12 (not 5, 14, 16, 20)');
    const today = await must(dayButton(page, longDate('2026-10-14', 'en')), 'day 14');
    assert.equal(await today.getAttribute('aria-current'), 'date', 'today is aria-current="date"');
    assert.equal(await today.getAttribute('aria-selected'), 'true', 'the open date is selected');
    const d7 = await must(dayButton(page, longDate('2026-10-07', 'en')), 'day 7');
    assert.ok(flat(await d7.evaluate((e) => { const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean); return e.getAttribute('aria-description') ?? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' '); })).includes('Has a note'), 'description Has a note');
    const q = await callsOf(core, 'daily_dates');
    assert.ok(q.some((c) => (c.args as any)?.year === 2026 && (c.args as any)?.month === 10), 'the marks come from daily_dates(2026, 10)');
  });

  test('fr_dly_03_ac4_marks_are_live', async ({ page }) => {
    const core = await startDaily(page, { region: 'en' });
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.type('Dnes');
    assert.ok(await stateIs(page, 'Saved', 3000), 'Saved');
    await openCalendar(page);
    assert.ok((await eventually(() => markedDays(page), (m) => m.includes('2026-10-14'), 1000)).includes('2026-10-14'), '14 marked within 1 s of Saved');
    await core.setFile('Daily/2026-10-20.md', '---\nid: 01JB4B0000000000000000W010\ntype: daily-note\ntitle: "2026-10-20"\ndate: 2026-10-20\n---\nBudoucnost.\n');
    assert.ok((await eventually(() => markedDays(page), (m) => m.includes('2026-10-20'), 2000)).includes('2026-10-20'), 'an external 20 Oct is marked within 2 s');
    await core.setFile(D.d01, null);
    assert.ok(!(await eventually(() => markedDays(page), (m) => !m.includes('2026-10-01'), 2000)).includes('2026-10-01'), 'deleting 1 Oct unmarks it');
    await core.renameFile(D.d07, '.trash/Daily/2026-10-07.md');
    assert.ok(!(await eventually(() => markedDays(page), (m) => !m.includes('2026-10-07'), 2000)).includes('2026-10-07'), 'moving 7 Oct to .trash/ unmarks it');
    await core.setFile(D.archiv, swap(original(D.archiv), 'date: 2026-10-10', 'date: 2026-10-11'));
    const m = await eventually(() => markedDays(page), (x) => x.includes('2026-10-11') && !x.includes('2026-10-10'), 2000);
    assert.ok(m.includes('2026-10-11') && !m.includes('2026-10-10'), `Archiv's mark moves from 10 to 11: ${m.join(', ')}`);
    assert.ok(await seen(calendar(page), 200), 'the calendar stayed open');
  });

  test('fr_dly_03_ac5_choosing_a_day_and_the_keyboard', async ({ page }) => {
    const core = await startDaily(page, { region: 'en' });
    await cmdD(page, '2026-10-14');
    await openCalendar(page);
    await (await must(dayButton(page, longDate('2026-10-20', 'en')), 'day 20')).click();
    await mustDaily(page, '2026-10-20', 'clicking 20');
    assert.ok(await absent(calendar(page), 1000), 'the calendar closes');
    await cmdD(page, '2026-10-14');
    await openCalendar(page);
    const focusedName = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
    const at = async (date: string, how: string) => assert.equal(flat(await eventually(focusedName, (n) => flat(n) === longDate(date, 'en'), 1000)), longDate(date, 'en'), how);
    await at('2026-10-14', 'the focus starts on the open date');
    await page.keyboard.press('ArrowRight');
    await at('2026-10-15', 'ArrowRight: next day');
    await page.keyboard.press('ArrowDown');
    await at('2026-10-22', 'ArrowDown: next week');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await at('2026-10-14', 'ArrowLeft, ArrowUp');
    await page.keyboard.press('Home');
    await at('2026-10-11', 'Home: start of the week (Sunday in en-US)');
    await page.keyboard.press('End');
    await at('2026-10-17', 'End: end of the week');
    await page.keyboard.press('PageDown');
    await at('2026-11-17', 'PageDown: next month');
    assert.ok(await seen(calendar(page).getByRole('heading', { name: 'November 2026' }), 500), 'November shown');
    assert.deepEqual(await markedDays(page), [], 'November 2026 has no marks');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    assert.ok(await seen(calendar(page).getByRole('heading', { name: 'September 2026' }), 500), 'September shown');
    assert.deepEqual(await markedDays(page), [], 'September 2026 has no marks');
    await (await must(calendar(page).getByRole('button', { name: 'Next month', exact: true }), 'Next month')).click();
    assert.equal((await markedDays(page)).length, 5, 'October again: its five marks');
    await page.keyboard.press('Escape');
    assert.ok(await absent(calendar(page), 1000), 'Esc closes it');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()), 'Pick date', 'focus returns to Pick date');
    await openCalendar(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await mustDaily(page, '2026-10-15', '⏎ opens the focused day');
    assert.deepEqual(await writeCalls(core), [], 'opening, browsing and closing write nothing');
  });

  for (const [region, header, first] of [['cs', 'říjen 2026', 1], ['en-US', 'October 2026', 0]] as const) {
    test(`fr_dly_03_ac6_locale_${region.replace('-', '_')}`, async ({ page }) => {
      await startDaily(page, { region });
      await cmdD(page, '2026-10-14');
      const cal = await openCalendar(page);
      assert.ok(await seen(cal.getByRole('heading', { name: header, exact: true }), 1000), `header ${header}`);
      const cols = (await calendarGrid(page).getByRole('columnheader').evaluateAll((hs) => hs.map((h) => h.getAttribute('aria-label') ?? h.getAttribute('abbr') ?? h.textContent ?? ''))).map(flat);
      assert.equal(cols.length, 7, 'seven weekday columns');
      // 2026-10-11 is a Sunday, 2026-10-12 a Monday.
      const wd = (iso: string, style: 'long' | 'short' | 'narrow') => new Intl.DateTimeFormat(region, { weekday: style, timeZone: 'UTC' }).format(Date.parse(`${iso}T12:00:00Z`));
      const want = first === 1 ? '2026-10-12' : '2026-10-11';
      assert.ok([wd(want, 'long'), wd(want, 'short'), wd(want, 'narrow')].map(flat).includes(cols[0]), `the week starts on ${first === 1 ? 'Monday' : 'Sunday'} in ${region}: ${cols[0]}`);
      assert.ok(await seen(dayButton(page, longDate('2026-10-14', region)), 500), "day names come from the region's format");
    });
  }
});

