// v0.52 feedback, L5 (WebKit + fake core): the capture window. docs/acceptance/capture.md FR-CAP-01 AC-19 (the due
// calendar, D-602), AC-21 (links from the capture window, D-603), FR-CAP-04 AC-9 (review only on review types, D-604).
// Interface docs/contracts/ms5-capture.md §16.1 (`capture_suggest`, 80 ms debounce, `@` date rows), §16.2 (`newObject`
// review rule, the fake `capture_create` rule, `capture.hintSaves` `Saves to {plural}`, `capture.savedTo`
// `Saved to {plural}`), §16.3 (strings of the due dialog), §2.2, §3.3. Written from the ACs and the contracts only
// (D-61). Every lookup goes through `must`/node:assert (TS-I1). Clock 2026-10-14T12:00:00+02:00, Europe/Prague.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, callsOf, capText, capValue, chooseType, click, creates, dueBtn, eventually, flat, gotoInbox, groupRegion, inboxVault, must, nfc, seen,
  sidebarCount, sleep, startCapture, startMain, typeInCapture, type FakeCoreHandle,
} from './capture-helpers';
import { tokenColour } from './read-helpers';
import { shortDate } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const masked = (t: string) => t.replace(/^id: .*$/m, 'id: <ULID>');
async function saveWithKeys(page: Page) {
  await page.keyboard.press('Meta+Enter');
  await sleep(250);
}

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-19

const dueDialog = (page: Page) => page.getByRole('dialog', { name: 'Pick a due date', exact: true });
const day = (dlg: Locator, n: number) => dlg.getByRole('gridcell', { name: new RegExp(`^${n}\\b`) }).first();
const dueLabel = (iso: string) => `Due: ${shortDate(iso, 'en-US')}`;
async function dueText(page: Page): Promise<string> {
  return flat(await (await must(dueBtn(page), 'button "Due: …"')).innerText());
}
async function openDue(page: Page): Promise<Locator> {
  await click(dueBtn(page), 'button "Due: …"');
  return must(dueDialog(page), 'dialog "Pick a due date" (D-602)', 1500);
}
async function startTask(page: Page): Promise<FakeCoreHandle> {
  return startCapture(page, { kind: 'task', region: 'en-US' });
}

test('fr_cap_01_ac19_no_date_chip_and_the_dialog', async ({ page }) => {
  await startTask(page);
  assert.equal(await dueText(page), 'Due: No date', 'with no date the chip reads "Due: No date"');
  const icon = await must(dueBtn(page).locator('svg[data-icon="calendar"]'), 'the calendar icon');
  const colour = await icon.evaluate((e) => getComputedStyle(e).color);
  assert.ok([await tokenColour(page, 'muted'), await tokenColour(page, 'faint')].includes(colour), `a grey calendar icon (muted or faint, got ${colour})`);
  const dlg = await openDue(page);
  assert.ok((await dlg.getByRole('textbox').count()) >= 1, 'the typed-date field (D-537)');
  for (const b of ['Today', 'Tomorrow', 'Next week', 'Fri', 'No date']) await must(dlg.getByRole('button', { name: b, exact: true }), `button ${b}`);
  assert.ok(await seen(dlg.getByText('October 2026', { exact: true }), 1000), 'the month October 2026');
  for (const b of ['Previous month', 'Next month']) {
    const nav = dlg.getByRole('button', { name: b, exact: true }).or(dlg.getByRole('button', { name: b === 'Previous month' ? '‹' : '›', exact: true }));
    await must(nav, `button ${b} (‹ / ›)`);
  }
  const grid = await must(dlg.getByRole('grid'), 'the D-587 month grid');
  const first = flat(await grid.getByRole('gridcell').first().evaluate((c) => c.getAttribute('aria-label') ?? (c.textContent ?? '')));
  assert.match(first, /^28\b/, `weeks start on Monday: the first day is Mon 28 Sep (got ${first})`);
  const ring = async (n: number) => day(dlg, n).evaluate((c) => {
    const b = (c.querySelector('button') as HTMLElement | null) ?? (c as HTMLElement);
    const s = getComputedStyle(b);
    return { current: c.getAttribute('aria-current') ?? b.getAttribute('aria-current'), look: `${s.boxShadow}|${s.outlineStyle}|${s.borderTopStyle}|${s.borderTopColor}` };
  });
  const today = await ring(14), next = await ring(15);
  assert.ok(today.current === 'date' || today.look !== next.look, 'Wed 14 Oct is ringed as today');
});

test('fr_cap_01_ac19_quick_picks_days_and_months', async ({ page }) => {
  await startTask(page);
  let dlg = await openDue(page);
  await click(dlg.getByRole('button', { name: 'Fri', exact: true }), 'Fri');
  assert.ok(await eventually(() => dueDialog(page).count(), (n) => n === 0, 1000) === 0, 'Fri closes the dialog');
  assert.equal(await dueText(page), dueLabel('2026-10-16'), 'Fri sets 2026-10-16 (R55 due label)');
  dlg = await openDue(page);
  await (await must(day(dlg, 20), 'day 20')).click();
  assert.equal(await eventually(() => dueText(page), (t) => t === dueLabel('2026-10-20'), 1000), dueLabel('2026-10-20'), 'day 20 sets 2026-10-20');
  dlg = await openDue(page);
  await click(dlg.getByRole('button', { name: 'Next week', exact: true }), 'Next week');
  assert.equal(await eventually(() => dueText(page), (t) => t === dueLabel('2026-10-19'), 1000), dueLabel('2026-10-19'), 'Next week sets next Monday 2026-10-19');
  dlg = await openDue(page);
  await click(dlg.getByRole('button', { name: 'Next month', exact: true }).or(dlg.getByRole('button', { name: '›', exact: true })), '›');
  assert.ok(await seen(dlg.getByText('November 2026', { exact: true }), 1000), '› shows November');
  await (await must(day(dlg, 3), 'day 3 of November')).click();
  assert.equal(await eventually(() => dueText(page), (t) => t === dueLabel('2026-11-03'), 1000), dueLabel('2026-11-03'), 'day 3 sets 2026-11-03');
  dlg = await openDue(page);
  await click(dlg.getByRole('button', { name: 'No date', exact: true }), 'No date');
  assert.equal(await eventually(() => dueText(page), (t) => t === 'Due: No date', 1000), 'Due: No date', 'No date clears it');
});

test('fr_cap_01_ac19_keyboard_and_escape', async ({ page }) => {
  const core = await startTask(page);
  let dlg = await openDue(page);
  await (await must(day(dlg, 14), 'day 14')).locator('button').or(day(dlg, 14)).first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => dueText(page), (t) => t === dueLabel('2026-10-22'), 1000), dueLabel('2026-10-22'), '→ then ↓ moves to 22 Oct and ⏎ picks it');
  dlg = await openDue(page);
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => dueDialog(page).count(), (n) => n === 0, 1000), 0, 'Esc closes the dialog');
  assert.equal(await dueText(page), dueLabel('2026-10-22'), 'without a change');
  assert.ok(await seen(capText(page), 300), 'the window stays open');
  assert.equal((await core.captureLog()).hides, 0, 'Esc in the dialog never hides the window');
});

test('fr_cap_01_ac19_the_saved_file_has_the_chosen_due', async ({ page }) => {
  const core = await startTask(page);
  await typeInCapture(page, 'Zavolat kominíkovi');
  const dlg = await openDue(page);
  await click(dlg.getByRole('button', { name: 'Fri', exact: true }), 'Fri');
  await capText(page).focus();
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.match(c[0].text, /^due: 2026-10-16$/m, 'due: 2026-10-16 (R57)');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-21

const JANA = 'Pages/Jana Nováková.md';
const ROZPOCET = 'Pages/Rozpočet domácnosti.md';
function linksVault() {
  return inboxVault((f) => {
    f[nfc(JANA)] = '---\nid: 01JB5B0000000000000000L001\ntype: page\ntitle: Jana Nováková\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nKolegyně z práce.\n';
    f[nfc(ROZPOCET)] = '---\nid: 01JB5B0000000000000000L002\ntype: page\ntitle: Rozpočet domácnosti\naliases: [Peníze]\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nTajný text rozpočtu.\n';
  });
}
const suggestions = (page: Page) => page.getByRole('listbox', { name: 'Link suggestions', exact: true });
async function clearText(page: Page) {
  await capText(page).fill('');
  await capText(page).focus();
}

test('fr_cap_01_ac21_brackets_list_and_insert_a_link', async ({ page }) => {
  const core = await startCapture(page, { vault: linksVault() });
  await capText(page).focus();
  await page.keyboard.type('[[Plán');
  const list = await must(suggestions(page), 'listbox "Link suggestions" (D-603)', 2000);
  const opt = await must(list.getByRole('option').filter({ hasText: 'Plán webu' }), 'option Plán webu');
  assert.ok((await opt.locator('svg[data-icon="file-text"]').count()) >= 1, 'with the Page icon');
  const [lb, tb] = [await list.boundingBox(), await capText(page).boundingBox()];
  assert.ok(!!lb && !!tb && lb.y >= tb.y, 'the list is below the caret line');
  assert.equal((await list.getByRole('option').allInnerTexts()).filter((t) => /^Create\b/.test(flat(t))).length, 0, 'no Create row');
  await page.keyboard.press('Enter');
  assert.equal(await capValue(page), '[[Plán webu]]', '⏎ inserts [[Plán webu]]');
  assert.ok(await eventually(() => suggestions(page).count(), (n) => n === 0, 1000) === 0, 'the list closes');
  const calls = await callsOf(core, 'capture_suggest');
  assert.ok(calls.length >= 1, 'the list comes from capture_suggest');
  const queries = calls.map((c) => String((c.args as any)?.query ?? ''));
  assert.equal(queries[queries.length - 1], 'Plán', 'the last query is "Plán"');
  assert.deepEqual(queries.filter((q, i) => i > 0 && q === queries[i - 1]), [], 'one call per query change (no repeated query)');
  for (const c of calls) for (const row of (c.result ?? []) as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(row).sort(), ['alias', 'link', 'title', 'type'], 'rows carry only link, title, type, alias');
  }
});

test('fr_cap_01_ac21_at_lists_people_and_dates', async ({ page }) => {
  await startCapture(page, { vault: linksVault() });
  await capText(page).focus();
  await page.keyboard.type('@Jan');
  const list = await must(suggestions(page), 'listbox "Link suggestions" for @Jan', 2000);
  await (await must(list.getByRole('option').filter({ hasText: 'Jana Nováková' }), 'option Jana Nováková')).click();
  assert.equal(await capValue(page), '[[Jana Nováková]]', 'choosing it inserts [[Jana Nováková]]');
  await clearText(page);
  await page.keyboard.type('@today');
  const l2 = await must(suggestions(page), 'listbox for @today', 2000);
  await must(l2.getByRole('option').filter({ hasText: /^\s*Today/ }), 'option Today');
  await page.keyboard.press('Enter');
  assert.equal(await capValue(page), '[[2026-10-14]]', '@today inserts [[2026-10-14]] (D-331)');
});

test('fr_cap_01_ac21_alias_match_and_escape', async ({ page }) => {
  await startCapture(page, { vault: linksVault() });
  await capText(page).focus();
  await page.keyboard.type('[[Peníze');
  const list = await must(suggestions(page), 'listbox for an alias', 2000);
  await must(list.getByRole('option').filter({ hasText: 'Rozpočet domácnosti' }), 'option Rozpočet domácnosti (alias Peníze)');
  await page.keyboard.press('Enter');
  assert.equal(await capValue(page), '[[Rozpočet domácnosti|Peníze]]', 'an alias match inserts [[<link>|<alias>]] (FR-TYP-08)');
  await clearText(page);
  await page.keyboard.type('[[Plán');
  await must(suggestions(page), 'the list again', 2000);
  await page.keyboard.press('Escape');
  assert.ok(await eventually(() => suggestions(page).count(), (n) => n === 0, 1000) === 0, 'Esc closes the list');
  assert.equal(await capValue(page), '[[Plán', 'and keeps the typed text');
  assert.ok(await seen(capText(page), 300), 'the window stays open');
  const html = nfc(await page.evaluate(() => document.documentElement.outerHTML));
  assert.ok(!html.includes('Tajný text rozpočtu') && !html.includes('Kolegyně z práce'), 'no body text reaches the capture DOM (NFR-SEC-03)');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-9

const hint = (page: Page, text: string) => page.getByText(text, { exact: true });

test('fr_cap_04_ac9_a_task_capture_has_no_review_and_stays_out_of_the_inbox', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const mainPage = await ctx.newPage();
  const capPage = await ctx.newPage();
  const v = inboxVault();
  await startMain(mainPage, { vault: v });
  await gotoInbox(mainPage);
  const before = await sidebarCount(mainPage);
  const cap = await startCapture(capPage, { vault: v, kind: 'task' });
  await typeInCapture(capPage, 'Zavolat kominíkovi');
  assert.ok(await seen(hint(capPage, 'Saves to Tasks'), 1000), 'the footer hint reads "Saves to Tasks" (D-604)');
  assert.equal(await hint(capPage, 'Lands in the Inbox · unreviewed').count(), 0, 'not the Inbox hint');
  await saveWithKeys(capPage);
  const c = await creates(cap);
  assert.equal(c.length, 1, 'one capture_create');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'no review line (… created, modified)');
  assert.deepEqual(await cap.writesTo(), ['Tasks/Zavolat kominíkovi.md'], 'the file is written');
  await sleep(1200);
  assert.equal(await sidebarCount(mainPage), before, 'the Inbox count doesn\'t change');
  assert.equal(await groupRegion(mainPage, 'today').locator('[data-path="Tasks/Zavolat kominíkovi.md"]').count(), 0, 'the task is not in the Inbox');
  await ctx.close();
});

test('fr_cap_04_ac9_page_has_no_review_and_review_types_keep_it', async ({ page }) => {
  const core = await startCapture(page);
  await chooseType(page, 'Page');
  await typeInCapture(page, 'Koupit dárek pro Janu');
  assert.ok(await seen(hint(page, 'Saves to Pages'), 1000), 'Page: the hint reads "Saves to Pages"');
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: page\ntitle: Koupit dárek pro Janu\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'Page: no review line');
  // Review types keep `review: unreviewed` and the Inbox hint.
  for (const [type, folder] of [['Quick Note', 'Quick Notes'], ['Nápad', 'Nápady']] as const) {
    const p = await page.context().newPage();
    const k = await startCapture(p);
    await chooseType(p, type);
    await typeInCapture(p, 'Čajovna u řeky');
    assert.ok(await seen(hint(p, 'Lands in the Inbox · unreviewed'), 1000), `${type}: "Lands in the Inbox · unreviewed"`);
    await saveWithKeys(p);
    const x = await creates(k);
    assert.equal(x.length, 1, `${type}: one capture`);
    assert.match(x[0].text, /^review: unreviewed$/m, `${type}: review: unreviewed`);
    assert.deepEqual(await k.writesTo(), [`${folder}/Čajovna u řeky.md`], `${type}: written`);
    await p.close();
  }
});

test('fr_cap_04_ac9_the_saved_panel_names_the_folder', async ({ page }) => {
  const core = await startCapture(page, { hash: '#saved' });
  await sleep(300);
  await core.showSaved({ typeName: 'Task', title: 'Zavolat kominíkovi', path: 'Tasks/Zavolat kominíkovi.md' });
  assert.ok(await seen(page.getByText('Saved to Tasks', { exact: true }), 2000), 'a Task: "Saved to Tasks" (D-604)');
  assert.equal(await page.getByText('Saved to Inbox', { exact: true }).count(), 0, 'not "Saved to Inbox"');
  await core.showSaved({ typeName: 'Quick Note', title: 'Koupit chleba', path: 'Quick Notes/Koupit chleba.md' });
  assert.ok(await seen(page.getByText('Saved to Inbox', { exact: true }), 2000), 'a Quick Note: "Saved to Inbox"');
});
