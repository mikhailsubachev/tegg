// MS5 slice 5B, L5 (WebKit + fake core): single-item Inbox actions, docs/acceptance/inbox.md R60 and FR-INB-02 AC-1
// (mark reviewed: bytes, dimmed in place, counts, live region), AC-3 (an external change: Conflict, reload, alert), AC-4
// (a failed write, Try again), AC-5 (Convert to), AC-6 (Append to, Today's note), AC-7 (append failures), AC-8 (Link to),
// AC-9 (Add tags), AC-10 (Move to trash: Coming in MS6, the 5B part), AC-11 (keyboard), AC-15 (no undo); FR-SYN-06
// AC-27 (L5: writes per path). Interface docs/contracts/ms5-capture.md §7.3 (one `note_write` with the loaded version as
// base; Append to: target first, then the item; `daily_create` for a virtual today), §7.4, §11.2. Written from the ACs
// and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CARD, I, NOW, callsOf, cardAt, cardNamed, click, description, eventually, fileText, flat, inboxVault, isDisabled, liveSays, main, must,
  nfc, openTriage, original, reviewedBox, reviewedText, seen, sidebarCount, sleep, startInbox, swap, triageMenu, vaultWrites, type FakeCoreHandle,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function writesOf(core: FakeCoreHandle, path: string) {
  return (await callsOf(core, 'note_write')).filter((c) => nfc(String((c.args as any)?.path ?? '')) === nfc(path));
}
const picker = (page: Page, verb: 'Append' | 'Link', title: string) => page.getByRole('dialog', { name: `${verb} "${title}" to…`, exact: true });
/** `Add tags…` on the focused card (#): the tag field, `tag`, ⏎. If the field stays open (the commit gesture isn't
 *  specified, red-test point AP-508), ⌘↩ applies it. */
async function addTagTo(page: Page, card: string, tag: string) {
  await (await must(cardNamed(page, card), card)).focus();
  await page.keyboard.press('#');
  const field = await must(page.getByRole('combobox', { name: 'Add tag…', exact: true }), 'the tag field (capture.md FR-CAP-01 AC-6)');
  await field.focus();
  await page.keyboard.insertText(tag);
  await page.keyboard.press('Enter');
  await sleep(500);
  if (await seen(page.getByRole('combobox', { name: 'Add tag…', exact: true }), 100)) await page.keyboard.press('Meta+Enter');
}
async function pick(page: Page, verb: 'Append' | 'Link', title: string, query: string, option: string | RegExp) {
  const d = await must(picker(page, verb, title), `dialog ${verb} "${title}" to…`);
  await (await must(d.getByRole('combobox', { name: 'Find an object', exact: true }), 'combobox Find an object')).fill(query);
  await sleep(200);
  await click(d.getByRole('option', { name: option }).first(), `option ${String(option)}`);
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_inb_02_ac1_mark_reviewed_and_back', async ({ page }) => {
  const core = await startInbox(page);
  const v0 = await core.version(I.Q1);
  const card = await must(cardNamed(page, CARD.Q1), 'Q1 card');
  await click(reviewedBox(card), 'Reviewed');
  const w = await writesOf(core, I.Q1);
  assert.equal(w.length, 1, 'one note_write');
  assert.deepEqual((w[0].args as any).base, v0, 'with the version the page loaded');
  assert.equal(await fileText(core, I.Q1), reviewedText(I.Q1), 'only review and modified change');
  assert.equal(await reviewedBox(card).getAttribute('aria-checked') ?? String(await reviewedBox(card).isChecked()), 'true', 'checked');
  assert.equal(await card.getAttribute('data-review'), 'reviewed', 'dimmed in place (AP-484)');
  assert.ok(await seen(main(page).getByText('12 to review', { exact: true }), 1000), 'the summary shows 12');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '12', 1000), '12', 'the sidebar count shows 12');
  assert.ok(await liveSays(page, 'Marked "Koupit mléko" reviewed'), 'live region');
  await click(reviewedBox(card), 'Reviewed (uncheck)');
  assert.equal(await fileText(core, I.Q1), reviewedText(I.Q1).replace('review: reviewed', 'review: unreviewed'), 'unchecking writes review: unreviewed back');
  await click(reviewedBox(card), 'Reviewed (again)');
  await page.keyboard.press('Meta+d');
  await page.keyboard.press('Meta+Shift+i');
  await must(main(page).getByRole('heading', { level: 1, name: 'Inbox' }), 'back on inbox');
  assert.equal(await cardAt(page, I.Q1).count(), 0, 'a checked card leaves the list when the user leaves inbox');
});

// ------------------------------------------------------------------------------------------------ AC-3, AC-4

test('fr_inb_02_ac3_an_external_change_is_not_overwritten', async ({ page }) => {
  const core = await startInbox(page);
  const card = await must(cardNamed(page, CARD.Q1), 'Q1');
  const theirs = swap(original(I.Q1), 'Polotučné, 2 litry.', 'Polotučné, 3 litry.');
  await core.setFile(I.Q1, theirs, { silent: true });
  await click(reviewedBox(card), 'Reviewed');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: `"Koupit mléko" changed outside Tegg. Your change wasn't saved.` }), 2000), 'the non-modal alert');
  assert.equal(await fileText(core, I.Q1), theirs, 'the file keeps the external bytes');
  assert.ok(await eventually(async () => flat(await card.innerText().catch(() => '')).includes('3 litry'), (x) => x, 2000), 'the card reloads from disk within 2 s');
});

test('fr_inb_02_ac4_a_failed_write_offers_try_again', async ({ page }) => {
  const core = await startInbox(page);
  const card = await must(cardNamed(page, CARD.Q1), 'Q1');
  await core.writeControl({ fail: 'Io', path: I.Q1 });
  await click(reviewedBox(card), 'Reviewed');
  const alert = await must(page.getByRole('alert').filter({ hasText: 'Couldn’t save "Koupit mléko". Try again.' }), 'the alert', 2000);
  assert.equal(await reviewedBox(card).getAttribute('aria-checked') ?? String(await reviewedBox(card).isChecked()), 'false', 'the checkbox returns to unchecked');
  assert.equal(await fileText(core, I.Q1), original(I.Q1), 'no partial write');
  await core.writeControl({ fail: null, path: null });
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.equal(await eventually(() => fileText(core, I.Q1), (t) => t === reviewedText(I.Q1), 2000), reviewedText(I.Q1), 'written with the current base');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_inb_02_ac5_convert_to', async ({ page }) => {
  const core = await startInbox(page);
  const menu = await openTriage(page, 'Koupit mléko');
  const group = await must(menu.getByRole('group', { name: 'Convert to', exact: true }), 'group Convert to');
  const items = await group.getByRole('menuitem').evaluateAll((es) => es.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  assert.deepEqual(items.map((x) => x.replace(/\s*\d$/, '')), ['Page', 'Task', 'Nápad', 'Schůzka'], 'the capture targets but Quick Note');
  assert.deepEqual(items.map((x) => /(\d)$/.exec(x)?.[1]), ['1', '2', '3', '4'], 'numbered 1…4');
  await click(group.getByRole('menuitem', { name: /^Task/ }), 'Task');
  const want = swap(reviewedText(I.Q1), 'type: quick-note', 'type: task');
  assert.equal(await eventually(() => fileText(core, I.Q1), (t) => t === want, 2000), want, 'type, review and modified only; no status');
  assert.deepEqual(await core.writesTo(), [nfc(I.Q1)], 'one write; the file stays');
  assert.ok(await liveSays(page, 'Converted "Koupit mléko" to Task'), 'live region');
  // N1 to Page keeps hodnocení; D1 can't be converted.
  const m2 = await openTriage(page, 'Aplikace na čaj');
  await click(m2.getByRole('menuitem', { name: /^Page/ }), 'Page');
  assert.ok((await eventually(() => fileText(core, I.N1), (t) => !!t?.includes('type: page'), 2000))?.includes('hodnocení: 2'), 'N1 keeps hodnocení: 2');
  const m3 = await openTriage(page, '2026-10-13');
  const first = m3.getByRole('group', { name: 'Convert to' }).getByRole('menuitem').first();
  assert.equal(await isDisabled(first), true, 'D1: Convert to aria-disabled');
  assert.equal(await description(first), "Daily notes can't change type.", 'the reason');
});

// ------------------------------------------------------------------------------------------------ AC-6, AC-7

const APPENDED = `\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n`;

test('fr_inb_02_ac6_append_to_writes_the_target_then_the_item', async ({ page }) => {
  const core = await startInbox(page);
  await openTriage(page, 'Bez stavu');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Append to…', exact: true }), 'Append to…');
  const d = await must(picker(page, 'Append', 'Bez stavu'), 'Append picker');
  const first = flat(await d.getByRole('option').first().innerText());
  assert.ok(first.startsWith("Today's note"), `Today's note first: ${first}`);
  await pick(page, 'Append', 'Bez stavu', 'Plán', /Plán webu/);
  const target = original(I.P2).replace(/^modified: .*$/m, `modified: ${NOW}`) + APPENDED;
  assert.equal(await eventually(() => fileText(core, I.P2), (t) => t === target, 2000), target, 'the target: its body, then the section with the re-targeted link');
  assert.equal(await fileText(core, I.Q4), swap(original(I.Q4), 'modified: 2026-10-10T10:00:00+02:00\n---\n', `modified: ${NOW}\nreview: reviewed\n---\n`), 'then the item: review and modified only');
  assert.deepEqual(await core.writesTo(), [nfc(I.P2), nfc(I.Q4)], 'two writes, target first');
  assert.ok(await liveSays(page, 'Appended "Bez stavu" to "Plán webu"'), 'live region');
});

test('fr_inb_02_ac6_append_to_a_virtual_todays_note', async ({ page }) => {
  const core = await startInbox(page);
  await openTriage(page, 'Koupit mléko');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Append to…', exact: true }), 'Append to…');
  const d = await must(picker(page, 'Append', 'Koupit mléko'), 'Append picker');
  await click(d.getByRole('option').first(), "Today's note");
  const calls = await eventually(() => callsOf(core, 'daily_create'), (c) => c.length === 1, 2000);
  assert.equal(calls.length, 1, 'the first write of the virtual today (FR-DLY-02 AC-2)');
  const t = await fileText(core, 'Daily/2026-10-14.md');
  assert.ok(t?.endsWith('## Koupit mléko\n\nPolotučné, 2 litry.\n'), `the appended section as the body: ${t}`);
});

test('fr_inb_02_ac7_a_changed_target_writes_neither_file', async ({ page }) => {
  const core = await startInbox(page);
  await core.setFile(I.P2, original(I.P2) + '\nDopsáno jinde.\n', { silent: true });
  await openTriage(page, 'Bez stavu');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Append to…', exact: true }), 'Append to…');
  await pick(page, 'Append', 'Bez stavu', 'Plán', /Plán webu/);
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: `"Plán webu" changed outside Tegg. Your change wasn't saved.` }), 2000), 'the alert names the target');
  assert.deepEqual(await core.writesTo(), [], 'nothing written to either file');
});

test('fr_inb_02_ac7_a_failed_item_write_is_retried_alone', async ({ page }) => {
  const core = await startInbox(page);
  await core.writeControl({ fail: 'Io', path: I.Q4 });
  await openTriage(page, 'Bez stavu');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Append to…', exact: true }), 'Append to…');
  await pick(page, 'Append', 'Bez stavu', 'Plán', /Plán webu/);
  const alert = await must(page.getByRole('alert').filter({ hasText: 'Couldn’t save "Bez stavu". Try again.' }), 'the item alert', 2000);
  assert.ok((await fileText(core, I.P2))?.endsWith(APPENDED), 'the target was written');
  assert.equal(await fileText(core, I.Q4), original(I.Q4), 'the item stays unreviewed');
  await core.writeControl({ fail: null, path: null });
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  await eventually(() => fileText(core, I.Q4), (t) => t !== original(I.Q4), 2000);
  assert.equal((await fileText(core, I.P2))!.split('## Bez stavu').length, 2, 'no second append');
  assert.ok((await fileText(core, I.Q4))?.includes('review: reviewed'), 'Try again writes only the item');
});

// ------------------------------------------------------------------------------------------------ AC-8, AC-9

test('fr_inb_02_ac8_link_to', async ({ page }) => {
  const core = await startInbox(page);
  await openTriage(page, 'Koupit mléko');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Link to…', exact: true }), 'Link to…');
  await pick(page, 'Link', 'Koupit mléko', 'Plán', /Plán webu/);
  const base = original(I.Q1).replace(/^modified: .*$/m, `modified: ${NOW}`);
  assert.equal(await eventually(() => fileText(core, I.Q1), (t) => t === `${base}\n[[Plán webu]]\n`, 2000), `${base}\n[[Plán webu]]\n`, 'only Q1: a blank line and [[Plán webu]]; review unchanged');
  assert.deepEqual(await core.writesTo(), [nfc(I.Q1)], 'only the item');
  assert.ok(await liveSays(page, 'Linked "Koupit mléko" to "Plán webu"'), 'live region');
  // DP from Quick Notes/ is written with its D-184 target.
  await openTriage(page, 'Koupit mléko');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Link to…', exact: true }), 'Link to…');
  const d = await must(picker(page, 'Link', 'Koupit mléko'), 'picker');
  await (await must(d.getByRole('combobox', { name: 'Find an object' }), 'field')).fill('Dvojník');
  await sleep(200);
  const options = await d.getByRole('option').allInnerTexts();
  const i = options.findIndex((o) => /Dvojník/.test(o) && /\bPage\b/.test(o));
  assert.ok(i >= 0, `DP among ${options.join(' | ')}`);
  await d.getByRole('option').nth(i).click();
  assert.ok((await eventually(() => fileText(core, I.Q1), (t) => !!t?.includes('[[Pages/Dvojník|Dvojník]]'), 2000))?.endsWith('\n[[Pages/Dvojník|Dvojník]]\n'), '[[Pages/Dvojník|Dvojník]] (D-184)');
});

test('fr_inb_02_ac9_add_tags', async ({ page }) => {
  const core = await startInbox(page);
  await addTagTo(page, CARD.Q1, 'doma');
  const want = swap(original(I.Q1), 'tags: [nákup]', 'tags: [nákup, doma]').replace(/^modified: .*$/m, `modified: ${NOW}`);
  assert.equal(await eventually(() => fileText(core, I.Q1), (t) => t === want, 2000), want, 'tags: [nákup, doma] and modified');
  await addTagTo(page, CARD.Q2, 'doma');
  const q2 = swap(original(I.Q2), 'modified: 2026-10-13T21:40:00+02:00\n---\n', `modified: ${NOW}\ntags: [doma]\n---\n`);
  assert.equal(await eventually(() => fileText(core, I.Q2), (t) => t === q2, 2000), q2, 'Q2 gets tags: [doma] after the last entry');
  assert.ok(!(await core.writesTo()).some((p) => p.startsWith('Tags/')), 'no Tags/ file (D-185)');
});

// ------------------------------------------------------------------------------------------------ AC-10 [MS6], 5B part

test('fr_inb_02_ac10_move_to_trash_comes_with_ms6', async ({ page }) => {
  const core = await startInbox(page);
  const menu = await openTriage(page, 'Koupit mléko');
  const trash = menu.getByRole('menuitem', { name: 'Move to trash', exact: true });
  assert.equal(await isDisabled(trash), true, 'aria-disabled in the triage menu');
  assert.equal(await description(trash), 'Coming in MS6', 'Coming in MS6');
  await page.keyboard.press('Escape');
  await (await must(cardNamed(page, CARD.Q1), 'Q1')).focus();
  await page.keyboard.press('Space');
  const bar = await must(main(page).getByRole('toolbar', { name: '1 selected' }), 'the selection toolbar');
  assert.equal(await isDisabled(bar.getByRole('button', { name: 'Move to trash', exact: true })), true, 'aria-disabled in the toolbar');
  await page.keyboard.press('Escape');
  await (await must(cardNamed(page, CARD.Q1), 'Q1')).focus();
  await page.keyboard.press('Backspace');
  await sleep(300);
  assert.equal(await page.getByRole('alert').count(), 0, '⌫ does nothing and shows no error');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-11, AC-15

test('fr_inb_02_ac11_keyboard_only', async ({ page }) => {
  const core = await startInbox(page);
  await (await must(cardNamed(page, CARD.Q6), 'Q6 (first card)')).focus();
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path')?.normalize('NFC') ?? null);
  assert.ok(focused && focused !== nfc(I.Q6), `the arrows move the focus between cards: ${focused}`);
  await (await must(cardNamed(page, CARD.Q1), 'Q1')).focus();
  await page.keyboard.press('r');
  assert.equal(await eventually(() => fileText(core, I.Q1), (t) => t === reviewedText(I.Q1), 1000), reviewedText(I.Q1), 'R toggles reviewed');
  await page.keyboard.press('r');
  await page.keyboard.press('c');
  await must(triageMenu(page).getByRole('group', { name: 'Convert to' }), 'C opens Convert to');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path')?.normalize('NFC') ?? null), nfc(I.Q1), 'Esc returns the focus to the card');
  await page.keyboard.press('a');
  await must(picker(page, 'Append', 'Koupit mléko'), 'A opens Append');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await must(picker(page, 'Link', 'Koupit mléko'), 'L opens Link');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await must(main(page).getByRole('textbox', { name: /Note body/ }), '⏎ opens the item', 3000);
});

test('fr_inb_02_ac15_cmd_z_does_nothing', async ({ page }) => {
  const core = await startInbox(page);
  await click(reviewedBox(await must(cardNamed(page, CARD.Q1), 'Q1')), 'Reviewed');
  const after = await fileText(core, I.Q1);
  assert.equal(after, reviewedText(I.Q1), 'reviewed');
  await page.keyboard.press('Meta+z');
  await sleep(300);
  assert.equal(await fileText(core, I.Q1), after, '⌘Z writes nothing');
  assert.equal((await writesOf(core, I.Q1)).length, 1, 'one write only');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-27 (L5)

test('fr_syn_06_ac27_each_action_writes_only_its_files', async ({ page }) => {
  const core = await startInbox(page, { vault: inboxVault() });
  let n = 0;
  const since = async () => { const w = await core.writesTo(); const out = w.slice(n); n = w.length; return out; };
  await click(reviewedBox(await must(cardNamed(page, CARD.Q1), 'Q1')), 'mark reviewed');
  assert.deepEqual(await since(), [nfc(I.Q1)], 'mark reviewed: the item');
  await openTriage(page, 'Nápad na článek');
  await click(triageMenu(page).getByRole('menuitem', { name: /^Page/ }), 'convert');
  assert.deepEqual(await eventually(() => core.writesTo().then((w) => w.slice(n)), (w) => w.length > 0, 2000), [nfc(I.Q2)], 'convert: the item');
  n = (await core.writesTo()).length;
  await openTriage(page, 'Bez stavu');
  await click(triageMenu(page).getByRole('menuitem', { name: 'Append to…', exact: true }), 'Append to…');
  await pick(page, 'Append', 'Bez stavu', 'Plán', /Plán webu/);
  assert.deepEqual(await eventually(() => core.writesTo().then((w) => w.slice(n)), (w) => w.length >= 2, 2000), [nfc(I.P2), nfc(I.Q4)], 'append: the target, then the item');
  n = (await core.writesTo()).length;
  assert.ok(!(await core.writesTo()).some((p) => p.startsWith('Tags/') || p.startsWith('.tegg/')), 'no Tag file, type file or vault.yml');
});
