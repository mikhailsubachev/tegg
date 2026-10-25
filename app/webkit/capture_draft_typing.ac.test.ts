// MS5 slice 5B, L5 (WebKit + fake core): the capture draft stored while typing, docs/acceptance/capture.md FR-CAP-01
// AC-15 (D-585; AC-8's draft rule as context). Interface docs/contracts/ms5-capture.md §15 item 9: the capture page calls
// `capture_draft_set(draft)` 500 ms after the last change to the text, type, chips, Due or Priority (trailing debounce,
// one call per quiet period), `capture_draft_set(null)` when the text is empty and no chip is left, and on Esc, ⌘↩
// success and `Discard`; the fake core records the calls and `core.draft()` returns the stored draft (§11.2).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, callsOf, capText, capValue, chips, chooseType, click, creates, discardBtn, dueBtn, eventually, flat, must, nfc, prioBtn, removeChip,
  sleep, startCapture, tagInput, typeBtn, typeInCapture, vaultWrites, type FakeCoreHandle,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

type Draft = { text: string; type: string; tags: string[]; due: string | null; priority: string | null };
const view = (d: Draft | null) => (d ? { text: nfc(d.text), type: d.type, tags: d.tags.map(nfc), due: d.due, priority: d.priority } : null);
/** The draft the page stored, as soon as `ok` holds (real timers; the store comes about 500 ms after the change). */
async function draftWhen(core: FakeCoreHandle, ok: (d: Draft | null) => boolean, ms = 1500) {
  return view(await eventually(() => core.draft() as Promise<Draft | null>, (d) => ok(view(d)), ms));
}
/** The `draft` argument of every `capture_draft_set` call, in order. */
async function stores(core: FakeCoreHandle): Promise<(Draft | null)[]> {
  return (await callsOf(core, 'capture_draft_set')).map((c) => view(((c.args as any)?.draft ?? null) as Draft | null));
}
async function addTag(page: Page, tag: string) {
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText(tag);
  await page.keyboard.press('Enter');
}

// ------------------------------------------------------------------------------------------------ the debounce

test('fr_cap_01_ac15_typing_stores_the_draft_500_ms_after_the_last_key', async ({ page }) => {
  const core = await startCapture(page, { install: true });
  await page.clock.pauseAt(new Date(Date.parse(NOW) + 60_000));
  await (await must(capText(page), 'textbox "Capture text"')).focus();
  const text = 'Koupit žluťoučký meloun';
  for (const ch of text) {
    await page.keyboard.insertText(ch);
    await page.clock.runFor(100);
  }
  const typingMs = text.length * 100;
  const during = (await stores(core)).length;
  assert.ok(during <= Math.floor(typingMs / 500), `at most one store per 500 ms while typing, not one per keystroke (${during} stores for ${text.length} keys in ${typingMs} ms)`);
  // 100 ms of the quiet period have passed; 450 ms after the last key the full text isn't stored yet.
  await page.clock.runFor(350);
  await sleep(100);
  assert.equal((await stores(core)).filter((d) => d?.text === nfc(text)).length, 0, 'no store of the final text before about 500 ms after the last key');
  await page.clock.runFor(150);
  await sleep(150);
  const full = (await stores(core)).filter((d) => d?.text === nfc(text));
  assert.equal(full.length, 1, `one store of the final text about 500 ms after the last key (stores: ${JSON.stringify(await stores(core))})`);
  assert.deepEqual(view(await core.draft() as Draft | null), { text: nfc(text), type: 'quick-note', tags: [], due: null, priority: null }, 'AC-8\'s draft in Application Support');
  const n = (await stores(core)).length;
  await page.clock.runFor(3000);
  await sleep(100);
  assert.equal((await stores(core)).length, n, 'no further store without a change (one call per quiet period)');
  assert.equal((await core.captureLog()).hides, 0, 'the window stays open');
  assert.equal(nfc(await capValue(page)), nfc(text), 'and keeps the text');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
  assert.deepEqual(await core.writesTo(), [], 'no vault file');
});

// ------------------------------------------------------------------------------------------------ type, chips, Due, Priority

test('fr_cap_01_ac15_type_chip_due_and_priority_changes_are_stored', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Zavolat kominíkovi');
  let d = await draftWhen(core, (x) => x?.text === 'Zavolat kominíkovi');
  assert.equal(d?.text, 'Zavolat kominíkovi', 'the typed text is stored while the window is open');
  await chooseType(page, 'Task');
  d = await draftWhen(core, (x) => x?.type === 'task');
  assert.equal(d?.type, 'task', 'a type change is stored');
  await addTag(page, 'doma');
  d = await draftWhen(core, (x) => JSON.stringify(x?.tags) === '["doma"]');
  assert.deepEqual(d?.tags, ['doma'], 'a chip is stored');
  await click(dueBtn(page), 'Due');
  await (await must(page.getByRole('dialog', { name: 'Pick a due date', exact: true }).getByRole('textbox', { name: 'Date', exact: true }), 'textbox Date of Pick a due date (D-763)')).fill('15. 10. 2026');
  await page.keyboard.press('Enter');
  assert.equal(flat(await dueBtn(page).innerText()), 'Due: Tomorrow', 'Due set');
  d = await draftWhen(core, (x) => x?.due === '2026-10-15');
  assert.equal(d?.due, '2026-10-15', 'a Due change is stored (YYYY-MM-DD, FR-FMT-11)');
  await click(prioBtn(page), 'Priority');
  await click(page.getByRole('menuitemradio', { name: 'High', exact: true }).or(page.getByRole('menuitem', { name: 'High', exact: true })), 'High');
  d = await draftWhen(core, (x) => x?.priority === 'High');
  assert.deepEqual(d, { text: 'Zavolat kominíkovi', type: 'task', tags: ['doma'], due: '2026-10-15', priority: 'High' }, 'a Priority change is stored, with everything else');
  assert.equal((await core.captureLog()).hides, 0, 'the window stays open');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
  assert.deepEqual(await core.writesTo(), [], 'no vault file');
});

test('fr_cap_01_ac15_a_draft_stored_while_typing_is_restored_after_a_relaunch', async ({ page, context }) => {
  const core = await startCapture(page, { kind: 'task' });
  await typeInCapture(page, 'Objednat dřevo\nNa zimu, 3 m³.');
  await addTag(page, 'chata');
  await click(prioBtn(page), 'Priority');
  await click(page.getByRole('menuitemradio', { name: 'Low', exact: true }).or(page.getByRole('menuitem', { name: 'Low', exact: true })), 'Low');
  const stored = await eventually(() => core.draft(), (x) => x?.priority === 'Low' && x?.tags?.[0] === 'chata', 1500);
  assert.deepEqual(view(stored as Draft | null), { text: 'Objednat dřevo\nNa zimu, 3 m³.', type: 'task', tags: ['chata'], due: null, priority: 'Low' }, 'stored without Esc');
  // A relaunch: a new capture page whose Application Support holds that draft (AC-8's rule for the next open).
  const page2 = await context.newPage();
  await startCapture(page2, { draft: stored, trigger: 'status-item', kind: 'default' });
  assert.equal(nfc(await capValue(page2)), 'Objednat dřevo\nNa zimu, 3 m³.', 'the text');
  assert.equal(flat(await typeBtn(page2).getAttribute('aria-label')), 'Type: Task', 'the type');
  assert.deepEqual(await chips(page2), ['chata'], 'the chips');
  assert.equal(flat(await prioBtn(page2).innerText()), 'Priority: Low', 'the fields');
  const caret = await capText(page2).evaluate((e) => [(e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).value.length]);
  assert.equal(caret[0], caret[1], 'caret at the end');
});

// ------------------------------------------------------------------------------------------------ removing the draft

test('fr_cap_01_ac15_emptying_the_text_and_removing_every_chip_removes_the_draft', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Smazat později');
  await addTag(page, 'doma');
  const d = await draftWhen(core, (x) => x?.text === 'Smazat později' && JSON.stringify(x?.tags) === '["doma"]');
  assert.deepEqual(d, { text: 'Smazat později', type: 'quick-note', tags: ['doma'], due: null, priority: null }, 'the draft is stored while typing');
  await (await must(capText(page), 'Capture text')).focus();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  assert.equal(await capValue(page), '', 'the text is empty');
  await click(removeChip(page, 'doma'), 'Remove #doma');
  assert.deepEqual(await chips(page), [], 'no chip is left');
  assert.equal(await eventually(() => core.draft(), (x) => x === null, 1500), null, 'the draft is removed');
  const s = await stores(core);
  assert.equal(s[s.length - 1], null, 'by capture_draft_set(null)');
  assert.equal((await core.captureLog()).hides, 0, 'the window stays open');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
});

test('fr_cap_01_ac15_a_successful_save_removes_the_draft', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Uložit hned');
  const d = await draftWhen(core, (x) => x?.text === 'Uložit hned');
  assert.equal(d?.text, 'Uložit hned', 'the draft is stored while typing');
  await page.keyboard.press('Meta+Enter');
  assert.equal((await eventually(() => creates(core), (c) => c.length === 1, 2000)).length, 1, 'saved');
  assert.equal(await eventually(() => core.draft(), (x) => x === null, 1500), null, '⌘↩ success removes the draft');
  // A change still waiting for its store when ⌘↩ succeeds doesn't bring the draft back.
  await core.openCapture({ trigger: 'hotkey' });
  await must(capText(page), 'Capture text');
  await typeInCapture(page, 'Rychle uložit');
  await page.keyboard.press('Meta+Enter');
  assert.equal((await eventually(() => creates(core), (c) => c.length === 2, 2000)).length, 2, 'saved again');
  await sleep(1200);
  assert.equal(await core.draft(), null, 'no draft after the save, also 1 s later');
});

test('fr_cap_01_ac15_discard_removes_the_draft', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Zahodit tuhle myšlenku');
  const d = await draftWhen(core, (x) => x?.text === 'Zahodit tuhle myšlenku');
  assert.equal(d?.text, 'Zahodit tuhle myšlenku', 'the draft is stored while typing');
  await click(discardBtn(page), 'Discard');
  assert.equal(await eventually(() => core.draft(), (x) => x === null, 1500), null, 'Discard removes the draft');
  // Discard right after typing (the store still pending) leaves no draft either.
  await core.openCapture({ trigger: 'hotkey' });
  await typeInCapture(page, 'Ještě jedna');
  await click(discardBtn(page), 'Discard');
  await sleep(1200);
  assert.equal(await core.draft(), null, 'no draft after Discard, also 1 s later');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
});
