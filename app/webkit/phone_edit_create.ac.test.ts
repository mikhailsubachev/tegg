// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, creating on the phone:
// - FR-VLT-05 AC-16 (`New` opens the type sheet), AC-17 (a choice opens an unsaved draft);
// - FR-NAV-01 AC-25 (D-1343's create buttons on Search), FR-LNK-04 AC-14 (the Create offer as a sheet), FR-DLY-02
//   AC-11 (Today is virtual until a keystroke).
// Contract docs/contracts/android-edit.md §7.2, §7.5 (focus and `android_ime`), §10.3 (the type sheet), §10.4 (the offer),
// §10.7 (Search, Today), §2.4 rows 6, 7, 9, 10, §11.1 (the `hidden` flush). Fixtures: inbox/, search/ + search-page/,
// backlinks/, daily/ (each with new-empty/.tegg/), at 2026-10-14 12:00 Prague.
// Red-test readings (reported): `default-type: Daily Note` is the vault setting's key `daily-note` in `.tegg/vault.yml`;
// the Create offer's rewrite case is one `link_create` that also rewrites the source (contract §2.4 row 9; the AC's "one
// more note_write" is that rewrite of the source file); a draft's "drops its history entry" is that a second Back
// doesn't return to it.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, assertWritesExactly, assertZeroWrites, barButton, bodyFocused, eventually, fileStateOf, flat, h1Is, h1Text, keyboard, loadVault, main,
  must, needBody, nfc, noteBody, notice, panel, phonePage, runById, saveState, searchField, seen, settledWriteCalls, sleep, startPhone, systemBack, tap, titleField, typeSheet,
  visibility, writeCalls, writesSeen,
} from './phone-helpers';
import { inboxVault } from './capture-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

const NOT_SAVED = 'Not saved yet. Start typing to create this note.';
const withDefault = (key: string) => inboxVault((f) => { f['.tegg/vault.yml'] = `${(f['.tegg/vault.yml'] ?? 'version: 1\n').replace(/\n?$/, '\n')}default-type: ${key}\n`; });
const activeIsH1 = (page: Page) => page.evaluate(() => { const a = document.activeElement; return !!a && a.tagName === 'H1' && !!a.closest('header, [role="banner"]'); });
const optionNames = (page: Page) => typeSheet(page).getByRole('listbox', { name: 'Types' }).getByRole('option').evaluateAll((os) => os.map((o) => ((o as HTMLElement).innerText ?? '').split('\n')[0].trim().normalize('NFC')));

// ------------------------------------------------------------------------------------------------ FR-VLT-05 AC-16

test('fr_vlt_05_ac16_new_opens_the_type_sheet', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW });
  const before = await fileStateOf(core);
  const nw = await must(barButton(page, 'New'), 'the bottom bar\'s New');
  assert.equal(await nw.getAttribute('aria-disabled'), null, 'New is enabled (no aria-disabled)');
  assert.equal(await nw.getAttribute('aria-description'), null, 'no phone.newLater');
  for (const how of ['scrim', 'Close', 'Back', 'command'] as const) {
    if (how === 'command') assert.equal(await runById(page, 'object.new'), 'ok', 'object.new opens it too'); else await tap(page, nw, 'New');
    const sheet = await must(typeSheet(page), `${how}: the sheet "New object"`);
    assert.equal(await sheet.getAttribute('aria-modal'), 'true', 'a modal bottom sheet');
    const field = sheet.getByRole('combobox', { name: 'Choose a type' });
    await must(field, 'the combobox Choose a type');
    assert.equal(await field.evaluate((e) => e === document.activeElement), false, 'Choose a type isn\'t focused at opening (the keyboard stays hidden)');
    assert.deepEqual(await core.imeCalls(), [], 'no android_ime');
    assert.deepEqual(await optionNames(page), ['Page', 'Task', 'Quick Note', 'Nápad', 'Schůzka'], 'Types in FR-VLT-05 AC-8\'s order');
    const sel = sheet.getByRole('option', { selected: true });
    assert.match(flat(await sel.innerText()), /^Quick Note\b.*Default/, 'Quick Note is selected and marked Default');
    if (how === 'scrim') await page.touchscreen.tap(206, 60);
    else if (how === 'Close') await sheet.getByRole('button', { name: 'Close' }).click();
    else await systemBack(page);
    if (how !== 'command') assert.ok(!(await seen(typeSheet(page), 500)), `${how} closes it`);
    else await systemBack(page);
    assert.equal(await h1Text(page), 'Inbox', `${how}: the route stays`);
  }
  // after a tap on the field, typing filters (AC-11)
  await tap(page, nw, 'New');
  const field = typeSheet(page).getByRole('combobox', { name: 'Choose a type' });
  await field.tap();
  await field.pressSequentially('sch');
  assert.deepEqual(await eventually(() => optionNames(page), (n) => n.length === 1, 1500), ['Schůzka'], 'typing filters');
  await systemBack(page);
  await assertZeroWrites(core, before, 'the type sheet');
  // with default-type: nápad, Nápad is the default
  const p2 = await phonePage(browser);
  await startPhone(p2, { vault: withDefault('nápad'), route: 'inbox', now: EDIT_NOW });
  await tap(p2, barButton(p2, 'New'), 'New');
  assert.match(flat(await typeSheet(p2).getByRole('option', { selected: true }).innerText()), /^Nápad\b.*Default/, 'with default-type: nápad, Nápad is selected and marked Default');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-VLT-05 AC-17

test('fr_vlt_05_ac17_choice_opens_an_unsaved_draft', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW });
  const before = await fileStateOf(core);
  // Nápad: the draft, then Back untouched writes nothing and drops its history entry
  await tap(page, barButton(page, 'New'), 'New');
  await tap(page, typeSheet(page).getByRole('option', { name: /^Nápad\b/ }), 'Nápad');
  const title = await must(titleField(page), 'Title');
  assert.ok(await eventually(() => title.evaluate((e) => e === document.activeElement || e.contains(document.activeElement)), (v) => v, 1500), 'Title in edit mode');
  assert.deepEqual(await core.imeCalls(), [true], 'with the keyboard (android_ime(true))');
  assert.equal(await h1Text(page), 'New Nápad', 'the h1 New Nápad');
  await must(main(page).getByText(NOT_SAVED, { exact: true }), 'Not saved yet…');
  await systemBack(page);
  assert.ok(await h1Is(page, 'Inbox'), 'Back leaves the draft');
  assert.equal(await systemBack(page), 'background', 'the draft\'s history entry is dropped (Back from the Inbox goes to the background)');
  await assertZeroWrites(core, before, 'an untouched draft');
  // the first write creates Nápady/<title>.md with the template's values
  await tap(page, barButton(page, 'New'), 'New');
  await tap(page, typeSheet(page).getByRole('option', { name: /^Nápad\b/ }), 'Nápad');
  await must(titleField(page), 'Title');
  await ime(page, [{ text: 'Čajovna' }, { enter: true }]);
  const w = await settledWriteCalls(core, 1, 3000);
  assert.deepEqual(w, [{ cmd: 'note_create', path: 'Nápady/Čajovna.md' }], 'D-522\'s first write: Nápady/Čajovna.md');
  const t = (await core.files())['Nápady/Čajovna.md'] ?? '';
  for (const re of [/^type: nápad$/m, /^hodnocení: 3$/m, /^oblast: osobní$/m, /^review: unreviewed$/m]) assert.match(t, re, `the first write holds ${re.source}`);
  // Task: new/task; its first write holds status: To do
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW });
  await tap(p2, barButton(p2, 'New'), 'New');
  await tap(p2, typeSheet(p2).getByRole('option', { name: /^Task\b/ }), 'Task');
  await must(titleField(p2), 'the new/task draft\'s Title');
  assert.equal(await h1Text(p2), 'New Task', 'new/task');
  await ime(p2, [{ text: 'Zalít kytky' }, { enter: true }]);
  await settledWriteCalls(c2, 1, 3000);
  assert.match((await c2.files())['Tasks/Zalít kytky.md'] ?? '', /^status: To do$/m, 'status: To do (D-470)');
  await p2.close();
  // default-type: Daily Note: the default row opens today's Daily Note
  const p3 = await phonePage(browser);
  await startPhone(p3, { vault: withDefault('daily-note'), route: 'inbox', now: EDIT_NOW });
  await tap(p3, barButton(p3, 'New'), 'New');
  await tap(p3, typeSheet(p3).getByRole('option', { selected: true }), 'the default row');
  assert.ok(await h1Is(p3, '2026-10-14') || await h1Is(p3, 'Wednesday 14 October 2026'), 'the default row opens today\'s Daily Note (D-353)');
  await p3.close();
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-25

const searchVault = () => loadVault('Hledání', ['search', 'search-page', 'new-empty/.tegg']);

test('fr_nav_01_ac25_create_from_search_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: searchVault(), route: 'search', now: EDIT_NOW });
  const before = await fileStateOf(core);
  const q = await must(searchField(page), 'Search query');
  assert.equal(await page.getByRole('button', { name: /^Create “/ }).count(), 0, 'no text: no create buttons');
  await q.fill('cteni');
  const count = await must(main(page).getByRole('status').filter({ hasText: /results?/ }).first(), 'the count line', 3000);
  const line = count.locator('xpath=..');
  await must(line.getByRole('button', { name: 'Create “cteni”' }), 'the count line ends with Create “cteni”');
  await must(line.getByRole('button', { name: 'as…' }), 'and as…');
  // the search key opens the first result and never creates
  await q.press('Enter');
  await sleep(600);
  assert.notEqual(await h1Text(page), 'Search', 'the search key opens the first result');
  assert.deepEqual(await writesSeen(core), [], 'and never creates');
  await systemBack(page);
  // as… opens the type sheet
  await (await must(searchField(page), 'Search query')).fill('cteni');
  await (await must(main(page).getByRole('button', { name: 'as…' }), 'as…')).click();
  await must(typeSheet(page), 'as… opens the type sheet');
  await systemBack(page);
  await assertZeroWrites(core, before, 'search, the search key, as…');
  // Create “cteni” writes exactly Quick Notes/cteni.md and opens it, title fixed, no keyboard
  await (await must(main(page).getByRole('button', { name: 'Create “cteni”' }), 'Create “cteni”')).click();
  await settledWriteCalls(core, 1, 3000);
  await assertWritesExactly(core, before, [{ cmd: 'note_create', path: 'Quick Notes/cteni.md' }], 'Create “cteni”');
  assert.ok(await h1Is(page, 'cteni'), 'it opens the new note');
  assert.equal(await titleField(page).count(), 0, 'its title is fixed (FR-EDT-01 AC-18)');
  assert.ok(await eventually(() => activeIsH1(page), (v) => v, 1500), 'no caret: the focus on the h1 (FR-EDT-01 AC-16)');
  assert.deepEqual(await core.imeCalls(), [], 'no keyboard');
  // the empty state with both buttons
  const p2 = await phonePage(browser);
  await startPhone(p2, { vault: searchVault(), route: 'search', now: EDIT_NOW });
  await (await must(searchField(p2), 'Search query')).fill('borůvkový koláč');
  await must(main(p2).getByText('No matches. Create “borůvkový koláč”?', { exact: true }), 'No matches. Create “borůvkový koláč”?', 3000);
  await must(main(p2).getByRole('button', { name: 'Create “borůvkový koláč”' }), 'Create “borůvkový koláč”');
  await must(main(p2).getByRole('button', { name: 'as…' }), 'as…');
  assert.equal(await main(p2).getByText(/^Nothing matches/).count(), 0, 'AND-2\'s Nothing matches … is gone');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-LNK-04 AC-14

const backlinksVault = () => loadVault('Odkazy', ['backlinks', 'new-empty/.tegg']);
const ROZBITE = 'Pages/Rozbité odkazy.md';
const offer = (page: Page) => page.getByRole('dialog', { name: 'Create note' });
async function tapLink(page: Page, text: string) {
  const chip = noteBody(page).locator('[data-wikilink], .chip, a').filter({ hasText: text }).first();
  await tap(page, chip, `[[${text}]]`);
}

test('fr_lnk_04_ac14_create_offer_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  let core = await startPhone(page, { vault: backlinksVault(), route: `note/${ROZBITE}`, now: EDIT_NOW });
  let before = await fileStateOf(core);
  await needBody(page, 'Rozbité odkazy');
  await tapLink(page, 'Neexistuje');
  const o = await must(offer(page), 'the sheet "Create note"');
  await must(o.getByText('No note named "Neexistuje"', { exact: true }), 'No note named "Neexistuje"');
  await must(o.getByText('Type: Quick Note', { exact: false }), 'Type: Quick Note');
  assert.equal(await notice(page).filter({ hasText: /No note named/ }).count(), 0, 'AND-2\'s notice is no longer shown');
  await (await must(o.getByRole('button', { name: 'Create "Neexistuje"' }), 'Create "Neexistuje"')).click();
  await settledWriteCalls(core, 1, 3000);
  await assertWritesExactly(core, before, [{ cmd: 'link_create', path: 'Quick Notes/Neexistuje.md' }], 'Create "Neexistuje"');
  assert.ok(await h1Is(page, 'Neexistuje'), 'it opens the new note');
  assert.equal(await titleField(page).count(), 0, 'with its title fixed');
  assert.deepEqual(await core.imeCalls(), [], 'no keyboard');
  await page.close();
  // [[Q3: plán?]]: created as AC-7 says, the clicked link rewritten in the source
  page = await phonePage(browser);
  core = await startPhone(page, { vault: backlinksVault(), route: `note/${ROZBITE}`, now: EDIT_NOW });
  before = await fileStateOf(core);
  await needBody(page, 'Rozbité odkazy');
  await tapLink(page, 'Q3: plán?');
  await (await must(offer(page).getByRole('button', { name: /^Create "/ }), 'Create')).click();
  const w = await eventually(() => writeCalls(core), (x) => x.length >= 1, 3000);
  assert.equal(w[0].cmd, 'link_create', 'link_create first');
  assert.deepEqual(w.slice(1).map((x) => [x.cmd, x.path]).filter(([c, p]) => !(c === 'note_write' && p === nfc(ROZBITE))), [], 'one link_create, then only the rewrite of the clicked link');
  const files = await core.files();
  const made = Object.keys(files).filter((p) => !(p in before.files));
  assert.equal(made.length, 1, `one new file: ${made}`);
  assert.ok(!files[nfc(ROZBITE)].includes('[[Q3: plán?]]') && files[nfc(ROZBITE)] !== before.files[nfc(ROZBITE)], 'the clicked link is rewritten in the source (the one more write)');
  await page.close();
  // AC-11's re-check: a file that appears meanwhile isn't overwritten
  page = await phonePage(browser);
  core = await startPhone(page, { vault: backlinksVault(), route: `note/${ROZBITE}`, now: EDIT_NOW });
  await needBody(page, 'Rozbité odkazy');
  await tapLink(page, 'Neexistuje');
  await must(offer(page), 'the offer');
  const appeared = '---\nid: 01JBAN3000000000000000N001\ntype: page\ntitle: Neexistuje\n---\nUž existuje.\n';
  await core.setFile('Pages/Neexistuje.md', appeared, { silent: true });
  await offer(page).getByRole('button', { name: /^Create "/ }).click();
  await sleep(1200);
  assert.equal((await core.files())['Pages/Neexistuje.md'], appeared, 'the appeared file keeps its bytes');
  assert.ok(!Object.keys(await core.files()).includes('Quick Notes/Neexistuje.md'), 'no second file (the re-check)');
  await page.close();
  // in a read view, Create is aria-disabled for the rewrite case only
  page = await phonePage(browser);
  core = await startPhone(page, { vault: backlinksVault(), route: `note/${ROZBITE}`, now: EDIT_NOW, nfdNames: [ROZBITE] });
  await must(saveState(page).filter({ hasText: 'Read-only' }), 'the read view');
  await tap(page, main(page).locator('[data-wikilink], .chip, a').filter({ hasText: 'Q3: plán?' }).first(), '[[Q3: plán?]]');
  assert.equal(await (await must(offer(page).getByRole('button', { name: /^Create "/ }), 'Create')).getAttribute('aria-disabled'), 'true', 'the rewrite case: Create aria-disabled');
  await systemBack(page);
  await tap(page, main(page).locator('[data-wikilink], .chip, a').filter({ hasText: /^Neexistuje$/ }).first(), '[[Neexistuje]]');
  assert.notEqual(await (await must(offer(page).getByRole('button', { name: /^Create "/ }), 'Create')).getAttribute('aria-disabled'), 'true', 'no rewrite: Create enabled');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-DLY-02 AC-11

const dailyVault = () => loadVault('Deník', ['daily', 'new-empty/.tegg']);

test('fr_dly_02_ac11_today_virtual_until_a_keystroke_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: dailyVault(), route: 'inbox', now: EDIT_NOW });
  const before = await fileStateOf(core);
  await (await must(barButton(page, 'Today'), 'Today')).click();
  const body = await needBody(page, 'virtual daily/2026-10-14');
  await must(main(page).getByText(NOT_SAVED, { exact: true }), 'Not saved yet…');
  assert.deepEqual(await core.imeCalls(), [], 'no keyboard on opening');
  assert.equal(await bodyFocused(page), false, 'no caret on opening');
  await body.tap();
  await keyboard(page, true);
  await ime(page, [{ text: '[[' }]);
  await must(panel(page, 'Link suggestions'), 'a panel');
  await page.keyboard.press('Escape');
  await ime(page, [{ backspace: true }, { backspace: true }]);
  await keyboard(page, false);
  await systemBack(page);
  await sleep(1500);
  await assertZeroWrites(core, before, 'opening, tapping, panels without a choice and leaving');
  // typing Dnes: exactly Daily/2026-10-14.md once, through daily_create
  await (await must(barButton(page, 'Today'), 'Today')).click();
  await (await needBody(page, 'Today')).tap();
  await keyboard(page, true);
  await ime(page, [{ text: 'Dnes' }]);
  await sleep(1500);
  await assertWritesExactly(core, before, [{ cmd: 'daily_create', path: 'Daily/2026-10-14.md' }], 'Dnes');
  const t = (await core.files())['Daily/2026-10-14.md'] ?? '';
  const keys = t.split('\n').slice(1, t.indexOf('\n---') > 0 ? undefined : 0).map((l) => l.split(':')[0]).filter((k) => /^[a-z]+$/.test(k));
  assert.deepEqual(keys.filter((k) => ['id', 'type', 'title', 'date', 'review', 'created', 'modified'].includes(k)), ['id', 'type', 'title', 'date', 'review', 'created', 'modified'], 'AC-2\'s frontmatter order');
  assert.match(t, /^date: 2026-10-14$/m, 'date: 2026-10-14');
  assert.ok(!(await seen(main(page).getByText(NOT_SAVED, { exact: true }), 300)), 'the marker goes');
  // HOME within 50 ms of the keystroke flushes it (AC-4)
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: dailyVault(), route: 'daily/2026-10-14', now: EDIT_NOW });
  await (await needBody(p2, 'Today')).tap();
  await keyboard(p2, true);
  await ime(p2, [{ text: 'D' }]);
  await visibility(p2, 'hidden');
  const w = await settledWriteCalls(c2, 1, 1000);
  assert.deepEqual(w, [{ cmd: 'daily_create', path: 'Daily/2026-10-14.md' }], 'the hidden flush writes the day');
  await p2.close();

});
