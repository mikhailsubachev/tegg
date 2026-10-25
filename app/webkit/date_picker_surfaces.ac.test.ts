// Preview v0.68 feedback, L5 (WebKit + fake core): the one date picker on every other surface (D-763;
// docs/feedback/ms6-v068.md F10, boards `MainProperties`, `QuickCapture`). docs/acceptance/date-picker.md R89,
// FR-TSK-09 AC-5 (task card menus), FR-DLY-03 AC-7 (the Daily Notes calendar), FR-DLY-08 AC-9 (`@` › `Pick a date…`),
// FR-CAP-01 AC-22 (the capture renders the same component), FR-UX-05 AC-9 (themes, strings, keyboard). Clocks: tasks
// 2026-10-14T10:00:00+02:00 (Wednesday), daily and capture their helpers' 2026-10-14T12:00:00+02:00 (the same
// Wednesday); Europe/Prague, region `cs` unless stated. Written from the ACs only (D-61); every lookup goes through
// `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import {
  T, card, click, fileWhen, gotoKanban, gotoTasks, main, moreBtn, original, startTasks, swap, titleOf, touched, writesOf,
} from './tasks-helpers';
import { D, caretAtEnd, cmdD, editorBody, fileWhen as dailyFile, linkSuggestions, mustBeOn, mustDaily, pickDate, startDaily } from './daily-helpers';
import { dueBtn, startCapture } from './capture-helpers';
import { openTypes, P, props } from './types-helpers';
import {
  HINT, QUICK_PICKS, calendarDialog, closed, dateField, dateName, dayIn, dueDialog, flat, focusInside, focusLabel, focusedDay, longDate, pickDialog,
  weekdays,
} from './v068-helpers';
import { eventually, must, seen, sleep } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW10 = '2026-10-14T10:00:00+02:00';
const ui = (theme: 'light' | 'dark', week?: string) => ({
  version: 1 as const, theme, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' as const },
  ...(week ? { dateTime: { date: 'region', time: 'region', week } } : {}),
});

// ------------------------------------------------------------------------------------------------ FR-TSK-09 AC-5

async function dueFromMenu(page: Page, scope: Locator, title: string): Promise<Locator> {
  await click(moreBtn(scope, title), `More actions for "${title}"`);
  await click(page.getByRole('menuitem', { name: 'Due date…', exact: true }), 'Due date…');
  return must(pickDialog(page), `"Due date…" opens "Pick date" directly (${title})`, 1500);
}

test('fr_tsk_09_ac5_card_menu_opens_pick_date_and_writes_once', async ({ page }) => {
  const core = await startTasks(page, { now: NOW10 });
  await gotoTasks(page);
  const t03 = titleOf(T.t03);
  let dlg = await dueFromMenu(page, card(page, t03), t03);
  assert.equal(await page.getByRole('textbox', { name: 'Due date', exact: true }).count(), 0, 'no separate Due date textbox');
  assert.equal(await page.getByRole('button', { name: 'Choose date', exact: true }).count(), 0, 'no Choose date button');
  await (await must(dayIn(dlg, '2026-10-20', 'cs'), 'day 20')).click();
  const want = touched(swap(original(T.t03), 'due: 2026-10-14', 'due: 2026-10-20'), NOW10);
  assert.equal(await fileWhen(core, T.t03, (t) => t !== original(T.t03)), want, 'due: 2026-10-20 and modified, every other byte unchanged');
  await sleep(300);
  assert.equal((await writesOf(core, T.t03)).length, 1, 'written once');
  dlg = await dueFromMenu(page, card(page, t03), t03);
  await (await must(dlg.getByRole('button', { name: 'No date', exact: true }), 'No date')).click();
  const none = touched(original(T.t03).replace(/^due: .*\n/m, ''), NOW10);
  assert.equal(await fileWhen(core, T.t03, (t) => !/^due:/m.test(t ?? '')), none, 'No date removes due:');
  // The quick-add Due chip is unchanged (a token only): no picker there.
  const qa = main(page).locator('[data-quick-add]');
  assert.equal(await qa.getByRole('button', { name: /Pick date|Choose date/ }).count(), 0, 'no picker opener in the quick-add row');
});

test('fr_tsk_09_ac5_kanban_card_menu_opens_the_same_dialog', async ({ page }) => {
  const core = await startTasks(page, { now: NOW10 });
  await gotoKanban(page, 'Status');
  const t01 = titleOf(T.t01);
  const scope = main(page).getByRole('article', { name: `Task: ${t01}`, exact: true });
  const dlg = await dueFromMenu(page, scope, t01);
  for (const b of [...QUICK_PICKS, 'No date']) await must(dlg.getByRole('button', { name: b, exact: true }), `Kanban: ${b}`);
  await must(dateField(dlg), 'Kanban: textbox "Date"');
  await page.keyboard.press('Escape');
  assert.ok(await closed(pickDialog(page)), 'Esc closes it');
  assert.equal((await writesOf(core, T.t01)).length, 0, 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-DLY-03 AC-7

test('fr_dly_03_ac7_daily_calendar_is_the_same_picker', async ({ page }) => {
  await startDaily(page, { region: 'cs' });
  await cmdD(page, '2026-10-14');
  await click(pickDate(page), 'button "Pick date" (daily header)');
  let cal = await must(calendarDialog(page), 'dialog "Calendar" (R18 keeps its name)');
  for (const b of QUICK_PICKS) await must(cal.getByRole('button', { name: b, exact: true }), `quick pick ${b}`);
  await must(dateField(cal), 'textbox "Date"');
  assert.equal(await cal.getByRole('button', { name: 'No date', exact: true }).count(), 0, 'no No date in the Daily Notes calendar');
  const marked = await cal.getByRole('grid').locator('[data-has-note="true"]').count();
  assert.ok(marked > 0, 'the data-has-note marks stay');
  await click(cal.getByRole('button', { name: 'Tomorrow', exact: true }), 'Tomorrow');
  await mustDaily(page, '2026-10-15', 'Tomorrow opens daily/2026-10-15');
  await click(pickDate(page), 'Pick date');
  cal = await must(calendarDialog(page), 'Calendar again');
  const f = await must(dateField(cal), 'textbox "Date"');
  await f.fill('fri');
  await f.press('Enter');
  await mustDaily(page, '2026-10-16', '"fri" opens daily/2026-10-16');
});

// ------------------------------------------------------------------------------------------------ FR-DLY-08 AC-9

async function mention(page: Page, q: string) {
  await caretAtEnd(page);
  await page.keyboard.type(` @${q}`);
  await must(linkSuggestions(page), 'the @ list');
}
const count = (s: string | undefined, x: string) => (s ?? '').split(x).length - 1;

test('fr_dly_08_ac9_pick_a_date_in_the_at_list', async ({ page }) => {
  const core = await startDaily(page, { at: D.zminky, region: 'cs' });
  await mustBeOn(page, 'Zmínky', 'landing', 5000);
  await mention(page, 'Ko');
  const caret = await page.evaluate(() => { const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect(); return r ? { x: r.left, top: r.top, bottom: r.bottom } : null; });
  await click(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'row Pick a date…');
  let dlg = await must(pickDialog(page), 'dialog "Pick date" from the @ list', 1500);
  const b = await dlg.boundingBox();
  assert.ok(caret && b && Math.abs(b.x - caret.x) <= 300 && (Math.abs(b.y - caret.bottom) <= 48 || Math.abs(b.y + b.height - caret.top) <= 48), `anchored at the caret (${JSON.stringify({ caret, b })})`);
  assert.equal(await dlg.getByRole('button', { name: 'No date', exact: true }).count(), 0, 'no No date');
  await page.keyboard.press('Escape');
  assert.ok(await closed(pickDialog(page)), 'Esc closes the picker');
  assert.ok(await seen(linkSuggestions(page), 1000) && (await editorBody(page).innerText()).includes('@Ko'), 'Esc returns to the list with the query intact');
  await click(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'row Pick a date… again');
  dlg = await must(pickDialog(page), 'Pick date again');
  await (await must(dayIn(dlg, '2026-10-20', 'cs'), 'day 20')).click();
  const t = await dailyFile(core, D.zminky, (x) => !!x?.includes('. [[2026-10-20]]'), 3000);
  assert.ok(t?.includes('Kolize [[2026-10-16]]. [[2026-10-20]]') && !t.includes('@Ko'), '[[2026-10-20]] at the @ position');
  const before = count(t, '[[2026-10-16]]');
  await mention(page, 'Ko');
  await click(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'row Pick a date…');
  dlg = await must(pickDialog(page), 'Pick date (typed)');
  const f = await must(dateField(dlg), 'textbox "Date"');
  await f.fill('fri');
  await f.press('Enter');
  const t2 = await dailyFile(core, D.zminky, (x) => count(x, '[[2026-10-16]]') === before + 1, 3000);
  assert.equal(count(t2, '[[2026-10-16]]'), before + 1, '"fri" inserts [[2026-10-16]]');
  assert.ok(!t2?.includes('@Ko'), 'the query is replaced');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-22

/** Quick-pick names, the grid's class and a plain day's class (21 Oct: neither today nor a value). */
async function anatomy(dlg: Locator) {
  const quick = (await dlg.getByRole('button').allInnerTexts()).map(flat).filter((t) => (QUICK_PICKS as readonly string[]).includes(t) || t === 'No date');
  const grid = await dlg.getByRole('grid').first().getAttribute('class');
  const day = await dayIn(dlg, '2026-10-21', 'cs').getAttribute('class');
  return { quick, grid, day };
}

test('fr_cap_01_ac22_capture_and_app_pickers_are_one_component', async ({ page, browser }) => {
  await startCapture(page, { kind: 'task', region: 'cs', dateTime: { date: 'region', time: 'region', week: 'sunday' } });
  await click(dueBtn(page), 'button "Due: …"');
  const cap = await must(dueDialog(page), 'dialog "Pick a due date" (FR-CAP-01 AC-19)');
  const capDays = await weekdays(cap);
  assert.match(capDays[0] ?? '', /^(ne|neděle|su|sun|sunday)/i, `capture: the grid starts on Sunday (${capDays.join(' ')})`);
  const a = await anatomy(cap);
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague', viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date('2026-10-14T12:00:00+02:00'));
  await openTypes(p2, P.porada, { region: 'cs', uiState: ui('light', 'sunday') });
  await click(props(p2).getByRole('button', { name: dateName('Datum: ', '2026-10-07') }), 'button "Datum: 7. 10. 2026"');
  const app = await must(pickDialog(p2), 'dialog "Pick date"');
  const appDays = await weekdays(app);
  assert.match(appDays[0] ?? '', /^(ne|neděle|su|sun|sunday)/i, `app: the grid starts on Sunday (${appDays.join(' ')})`);
  const b = await anatomy(app);
  assert.deepEqual(a, b, 'the same quick picks and grid classes (one component)');
  // The same keyboard: → moves the focused day by one in both.
  for (const [pg, dlg] of [[page, cap], [p2, app]] as const) {
    await (await must(dayIn(dlg, '2026-10-21', 'cs'), 'day 21')).focus();
    await pg.keyboard.press('ArrowRight');
    assert.equal(await focusedDay(pg), longDate('2026-10-22', 'cs'), '→ moves to 22');
  }
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-9

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac9_pick_date_themes_attribute_panel_${theme}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW10));
    await openTypes(page, P.porada, { region: 'cs', uiState: ui(theme) });
    await click(props(page).getByRole('button', { name: dateName('Datum: ', '2026-10-07') }), 'Datum');
    await must(pickDialog(page), 'Pick date');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with Pick date open`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: every colour is a token (FR-UX-05 AC-5)`);
  });
  test(`fr_ux_05_ac9_pick_date_themes_task_card_${theme}`, async ({ page }) => {
    await startTasks(page, { now: NOW10, theme });
    await gotoTasks(page);
    await dueFromMenu(page, card(page, titleOf(T.t03)), titleOf(T.t03));
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: token colours`);
  });
  test(`fr_ux_05_ac9_pick_date_themes_at_list_${theme}`, async ({ page }) => {
    await startDaily(page, { at: D.zminky, region: 'cs', uiState: ui(theme) });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    await mention(page, 'Ko');
    await click(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'Pick a date…');
    await must(pickDialog(page), 'Pick date');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: token colours`);
  });
}

test('fr_ux_05_ac9_every_r89_text_is_a_catalog_key', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW10));
  await openTypes(page, P.porada, { region: 'cs', prelude: pseudoLocale });
  await click(props(page).getByRole('button', { name: /Datum/ }).first(), 'the Datum opener');
  const dlg = await must(page.getByRole('dialog', { name: '⟦Pick date⟧', exact: true }), 'dialog "⟦Pick date⟧"');
  for (const b of [...QUICK_PICKS, 'No date']) await must(dlg.getByRole('button', { name: `⟦${b}⟧`, exact: true }), `button ⟦${b}⟧`);
  for (const b of ['Previous month', 'Next month']) await must(dlg.getByRole('button', { name: `⟦${b}⟧`, exact: true }), `button ⟦${b}⟧`);
  await must(dlg.getByRole('textbox', { name: '⟦Date⟧', exact: true }), 'textbox ⟦Date⟧');
  await must(dlg.getByText(`⟦${HINT}⟧`, { exact: true }), `hint ⟦${HINT}⟧`);
});

test('fr_ux_05_ac9_pick_date_by_keyboard_only', async ({ page }) => {
  const core = await (async () => { await page.clock.setFixedTime(new Date(NOW10)); return openTypes(page, P.porada, { region: 'cs' }); })();
  const opener = await must(props(page).getByRole('button', { name: dateName('Datum: ', '2026-10-07') }), 'Datum opener');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = await must(pickDialog(page), 'Pick date by ⏎');
  assert.equal(await eventually(() => focusedDay(page), (d) => d === longDate('2026-10-07', 'cs'), 1000), longDate('2026-10-07', 'cs'), 'the focus starts on the value\'s day');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await focusInside(dlg), `Tab ${i + 1} stays inside the dialog`);
  }
  await (await must(dayIn(dlg, '2026-10-07', 'cs'), 'day 7')).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusedDay(page), longDate('2026-10-15', 'cs'), '↓ a week, → a day');
  await page.keyboard.press('Escape');
  assert.ok(await closed(pickDialog(page)), 'Esc closes');
  assert.match(await focusLabel(page), /^Datum: /, 'the focus is back on the opener');
  await page.keyboard.press('Enter');
  await must(pickDialog(page), 'reopened by ⏎');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  assert.ok(await closed(pickDialog(page)), 'Space picks and closes');
  const t = await eventually(async () => (await core.files())[P.porada], (x) => !!x?.includes('datum: 2026-10-08'), 2500);
  assert.ok(t?.includes('datum: 2026-10-08\n'), 'Space picked 8 Oct');
});
