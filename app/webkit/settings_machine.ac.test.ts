// MS5 slice 5B, L5 (WebKit + fake core): machine settings, docs/acceptance/capture.md R58 — `settings/menu-bar`
// (FR-SET-05 AC-1, L5 for the page), `settings/shortcuts` and the hotkey notice (FR-CAP-05 AC-5 L5 part from the fake
// core's hotkey states, AC-8), `settings/date-time` (FR-SET-03 AC-1…AC-5). Interface docs/contracts/ms5-capture.md §5.2
// (`shell_settings`, `shell_settings_set`, `hotkeys`, `hotkeys_retry`, `hotkeys:state`, `UiStateDto.dateTime`,
// `i18n/dates.ts`), §11.2. Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  callsOf, cardAt, click, description, eventually, flat, focusName, gotoInbox, inboxVault, isDisabled, main, must, runCommand, seen, sleep,
  startMain, ui, vaultWrites,
} from './capture-helpers';
import { pseudoLocale } from './helpers';
import { calendar, calendarGrid, pickDate } from './daily-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const sw = (page: Page, name: string) => main(page).getByRole('switch', { name, exact: true });
const checked = async (page: Page, name: string) => (await (await must(sw(page, name), `switch ${name}`)).getAttribute('aria-checked')) ?? String(await sw(page, name).isChecked());
const combo = (page: Page, name: string) => main(page).getByRole('combobox', { name, exact: true });
async function choose(page: Page, name: string, option: string) {
  const c = await must(combo(page, name), `combobox ${name}`);
  if (await c.evaluate((e) => e.tagName === 'SELECT')) await c.selectOption({ label: option });
  else { await c.click(); await click(page.getByRole('option', { name: option, exact: true }), `option ${option}`); }
  await sleep(200);
}
async function comboText(page: Page, name: string): Promise<string> {
  const c = await must(combo(page, name), `combobox ${name}`);
  return flat(await c.evaluate((e) => (e as HTMLSelectElement).selectedOptions?.[0]?.text ?? (e as HTMLInputElement).value ?? e.textContent ?? ''));
}

// ------------------------------------------------------------------------------------------------ FR-SET-05 AC-1 (L5)

test('fr_set_05_ac1_the_menu_bar_page_defaults_and_storage', async ({ page }) => {
  const core = await startMain(page);
  await runCommand(page, 'Go to Settings: Menu bar and startup');
  assert.equal(await checked(page, 'Show Tegg in the menu bar'), 'true', 'Show Tegg in the menu bar: on');
  assert.equal(await checked(page, 'Open Tegg at login'), 'false', 'Open Tegg at login: off');
  assert.equal(await description(sw(page, 'Open Tegg at login')), 'Tegg starts in the menu bar without opening a window.', 'the description');
  await click(sw(page, 'Show Tegg in the menu bar'), 'Show Tegg in the menu bar');
  await click(sw(page, 'Open Tegg at login'), 'Open Tegg at login');
  assert.deepEqual(await core.shellCalls(), [{ showStatusItem: false, openAtLogin: false }, { showStatusItem: false, openAtLogin: true }], 'stored through shell_settings_set (Application Support)');
  assert.deepEqual(await vaultWrites(core), [], 'no vault write; nothing under .tegg/');
  assert.deepEqual(await core.writesTo(), [], 'every vault file untouched');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-05 AC-5, AC-8

const TAKEN = [{ id: 'quick-capture' as const, keys: '⌃⌥Space', state: 'taken' as const }, { id: 'new-task' as const, keys: '⌃⌥T', state: 'active' as const }];

test('fr_cap_05_ac5_a_taken_hotkey_on_the_shortcuts_page_and_the_notice', async ({ page }) => {
  const core = await startMain(page, { hotkeys: TAKEN });
  const notice = page.getByText("⌃⌥Space couldn't be set up because another app uses it. Quick Capture still works from the menu bar.", { exact: true });
  assert.ok(await seen(notice, 3000), 'the once-per-launch non-modal notice');
  assert.equal(await page.getByRole('alertdialog').count(), 0, 'not modal');
  await click(page.getByRole('link', { name: 'Shortcut settings', exact: true }).or(page.getByRole('button', { name: 'Shortcut settings', exact: true })), 'link Shortcut settings');
  const table = await must(main(page).getByRole('table', { name: 'Global shortcuts', exact: true }), 'table Global shortcuts');
  const rows = (await table.getByRole('row').allInnerTexts()).map(flat);
  assert.ok(rows.some((r) => r.includes('Quick Capture') && r.includes('⌃⌥Space') && r.includes('Not available: another app uses this shortcut.')), `Quick Capture row: ${rows.join(' | ')}`);
  assert.ok(rows.some((r) => r.includes('New Task') && r.includes('⌃⌥T') && r.includes('Active')), 'New Task: Active');
  await must(table.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  // Try again asks the shell; the state event updates the row.
  await click(table.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.equal((await callsOf(core, 'hotkeys_retry')).length, 1, 'hotkeys_retry');
  await core.setHotkeys([{ id: 'quick-capture', keys: '⌃⌥Space', state: 'active' }, { id: 'new-task', keys: '⌃⌥T', state: 'active' }]);
  const after = await eventually(async () => (await table.getByRole('row').allInnerTexts()).map(flat), (r) => r.some((x) => x.includes('Quick Capture') && x.includes('Active')), 1000);
  assert.ok(after.some((x) => x.includes('Quick Capture') && x.includes('Active')), 'Active within 1 s');
  await page.reload();
  await sleep(500);
  await runCommand(page, 'Go to Settings: Shortcuts'); // a reload starts on the landing route, not the last page
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
  const app = await must(main(page).getByRole('table', { name: 'App shortcuts', exact: true }).or(page.getByRole('table', { name: 'App shortcuts', exact: true })), 'table App shortcuts (R4, read-only)');
  assert.ok(flat(await app.innerText()).includes('⌘K'), 'lists R4');
});

test('fr_cap_05_ac8_change_is_disabled_until_v1', async ({ page }) => {
  const core = await startMain(page);
  await runCommand(page, 'Go to Settings: Shortcuts');
  const table = await must(main(page).getByRole('table', { name: 'Global shortcuts', exact: true }), 'table Global shortcuts');
  const change = table.getByRole('button', { name: 'Change…', exact: true });
  assert.equal(await change.count(), 2, 'one Change… per row');
  for (let i = 0; i < 2; i++) {
    assert.equal(await isDisabled(change.nth(i)), true, 'aria-disabled');
    assert.equal(await description(change.nth(i)), 'Coming in v1.0', 'Coming in v1.0');
    await change.nth(i).click({ force: true });
  }
  assert.deepEqual((await core.calls()).filter((c) => /hotkey|shell_settings_set/.test(c.cmd) && c.cmd !== 'hotkeys').map((c) => c.cmd), [], 'Change… does nothing; the shortcuts are not stored');
});

// ------------------------------------------------------------------------------------------------ FR-SET-03

test('fr_set_03_ac1_the_date_and_time_page', async ({ page }) => {
  const core = await startMain(page);
  await runCommand(page, 'Go to Settings: Date & time');
  for (const name of ['Date format', 'Time format', 'First day of week']) assert.equal(await comboText(page, name), 'Region', `${name}: Region`);
  assert.ok(await seen(main(page).getByText('14. 10. 2026', { exact: false }), 1000), 'a live example (cs-CZ medium date)');
  assert.deepEqual(await vaultWrites(core), [], 'opening writes nothing');
  // Also from the Settings section list.
  await runCommand(page, 'Go to Settings: Appearance');
  await click(main(page).getByRole('link', { name: 'Date & time', exact: true }).or(main(page).getByRole('tab', { name: 'Date & time', exact: true })), 'section Date & time');
  assert.equal(await comboText(page, 'Date format'), 'Region');
});

test('fr_set_03_ac2_dates_follow_the_setting_and_files_do_not_change', async ({ page }) => {
  const core = await startMain(page, { at: 'Tasks/Zavolat instalatérovi.md' });
  await runCommand(page, 'Go to Settings: Date & time');
  await choose(page, 'Date format', 'ISO (2026-10-14)');
  await choose(page, 'Time format', '24-hour');
  const st = await core.uiState();
  assert.deepEqual(st?.dateTime, { date: 'iso', time: '24', week: 'region' }, 'stored in UiStateDto.dateTime');
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's
  assert.ok(await seen(main(page).getByText('2026-10-15', { exact: true }), 3000), 'the attribute panel shows due as 2026-10-15');
  await gotoInbox(page);
  const q1 = await must(cardAt(page, 'Quick Notes/Koupit mléko.md'), 'Q1 card');
  assert.ok(flat(await q1.innerText()).includes('Captured 2026-10-14 08:15'), 'the Inbox footer in ISO with 24-hour time');
  await runCommand(page, 'Go to Settings: Date & time');
  await choose(page, 'Date format', 'Long (14 October 2026)');
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's
  assert.ok(await seen(main(page).getByText('15 October 2026', { exact: true }), 3000), 'Long: 15 October 2026');
  assert.deepEqual(await vaultWrites(core), [], 'no vault file is written by the change or by showing');
});

test('fr_set_03_ac3_first_day_of_week', async ({ page }) => {
  const v = inboxVault((f) => {
    f['Tasks/V neděli.md'] = '---\nid: 01JB5B0000000000000000R401\ntype: task\ntitle: V neděli\nstatus: To do\ndue: 2026-10-18\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n';
  });
  await startMain(page, { vault: v, dateTime: { date: 'region', time: 'region', week: 'sunday' } });
  await runCommand(page, 'Go to Tasks');
  const later = main(page).locator('[data-section="later"] [data-path="Tasks/V neděli.md"]');
  assert.ok(await seen(later, 3000), 'with Sunday, This week is Sun 11 – Sat 17: Sunday 18 is later (D-474)');
  await page.keyboard.press('Meta+d');
  await click(pickDate(page), 'Pick date');
  await must(calendar(page), 'dialog Calendar');
  const first = flat(await calendarGrid(page).getByRole('columnheader').first().innerText());
  assert.match(first, /^(ne|neděle|Ne)/i, `the calendar starts on Sunday: ${first}`);
  const p2 = await page.context().newPage();
  await startMain(p2, { vault: inboxVault((f) => { f['Tasks/V neděli.md'] = v.files['Tasks/V neděli.md']; }), dateTime: { date: 'region', time: 'region', week: 'monday' }, region: 'en-US' });
  await runCommand(p2, 'Go to Tasks');
  assert.ok(await seen(main(p2).locator('[data-section="week"] [data-path="Tasks/V neděli.md"]'), 3000), 'with Monday (in en-US), Sunday 18 is in This week');
});

test('fr_set_03_ac4_per_machine_never_in_the_vault', async ({ page }) => {
  const core = await startMain(page);
  await runCommand(page, 'Go to Settings: Date & time');
  await choose(page, 'First day of week', 'Sunday');
  assert.equal((await core.uiState())?.dateTime?.week, 'sunday', 'stored in Application Support (UiStateDto)');
  assert.ok(!(await core.writesTo()).some((p) => p.startsWith('.tegg/')), 'nothing under .tegg/');
  const p2 = await page.context().newPage();
  await startMain(p2, { vault: { ...inboxVault(), name: 'Druhý' }, uiState: { ...ui(), dateTime: (await core.uiState())!.dateTime } });
  await runCommand(p2, 'Go to Settings: Date & time');
  assert.equal(await comboText(p2, 'First day of week'), 'Sunday', 'a second vault shows the same choices');
});

test('fr_set_03_ac5_keyboard_and_pseudo_locale', async ({ page }) => {
  await startMain(page, { prelude: pseudoLocale });
  await runCommand(page, '⟦Go to Settings: Date & time⟧');
  await must(combo(page, '⟦Date format⟧'), 'the pseudo-localized combobox');
  const c = await must(combo(page, '⟦Date format⟧'), 'Date format');
  await c.focus();
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  assert.notEqual(await comboText(page, '⟦Date format⟧'), '⟦Region⟧', '↓ changes the choice');
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, '⟦Time format⟧', 'Tab reaches the next control');
  const leaks = await main(page).evaluate((m) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { const t = (n.textContent ?? '').trim(); if (t && !t.includes('⟦') && !/^[\d.:\s/-]+$/.test(t)) out.push(t); }
    return out;
  });
  assert.deepEqual(leaks, [], 'every text is a catalog string (examples are dates)');
});
