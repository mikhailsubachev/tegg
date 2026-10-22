// 5B preview feedback round 2, L5 (WebKit + fake core): FR-CAP-01 AC-18 (D-596, AP-524): a window `blur` (focus loss:
// a click into another app or another Tegg window) hides the capture window as Esc does: with text it stores the draft
// (`capture_draft_set` with the text, type and fields) and then calls `capture_hide`; empty, it only hides. A blur while
// the type menu or the date picker is open hides too and closes the menu; opening and closing them and Tab never hide.
// A blur while a save is in flight neither hides nor stores a draft (the save hides it). docs/acceptance/capture.md;
// interface docs/contracts/ms5-capture.md §4 ("Esc, and the window's `blur`"), §11.2 (fake core: `captureLog().hides`,
// `draft()`, `writeControl({ hold })` + `release()` for `capture_create`). The blur is sent both as the DOM `blur`
// event on `window` and as Tauri's `tauri://blur` window event, so either listener the page uses receives it; counts
// are therefore checked as "at least one" hide. Written from the AC and the contract only (D-61); every lookup goes
// through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  callsOf, capText, capValue, chooseType, click, creates, dueBtn, eventually, must, nfc, seen, sleep, startCapture, typeBtn, typeInCapture,
  typeMenu, vaultWrites, type FakeCoreHandle,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** The capture window loses focus (D-596). */
async function blurWindow(page: Page) {
  await page.evaluate(async () => {
    window.dispatchEvent(new FocusEvent('blur'));
    try { await (window as any).__teggFake.emit('tauri://blur', null); } catch { /* no Tauri listener */ }
  });
  await sleep(150);
}
type Rec = { cmd: string; seq?: number; args: any };
async function since(core: FakeCoreHandle, from: number): Promise<Rec[]> {
  return ((await core.calls()) as Rec[]).filter((c) => (c.seq ?? 0) > from);
}
async function lastSeq(core: FakeCoreHandle): Promise<number> {
  const all = await core.calls();
  return Math.max(0, ...all.map((c) => c.seq ?? 0));
}
async function hides(core: FakeCoreHandle) {
  return (await core.captureLog()).hides;
}
const datePicker = (page: Page) => page.getByRole('textbox', { name: 'Due date', exact: true });

test('fr_cap_01_ac18_blur_with_text_stores_the_draft_then_hides', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Pick up milk');
  const from = await lastSeq(core);
  await blurWindow(page);
  const h = await eventually(() => hides(core), (n) => n >= 1, 2000);
  assert.ok(h >= 1, 'a window blur hides the capture window (capture_hide)');
  const after = await since(core, from);
  const firstHide = after.find((c) => c.cmd === 'capture_hide');
  const stored = after.filter((c) => c.cmd === 'capture_draft_set' && c.args?.draft && nfc(String(c.args.draft.text)) === 'Pick up milk');
  assert.ok(stored.length >= 1, `the blur stores the draft (capture_draft_set with the text): ${JSON.stringify(after.map((c) => c.cmd))}`);
  assert.ok(firstHide && (stored[0].seq ?? 0) < (firstHide.seq ?? 0), 'the draft is stored before capture_hide');
  const d = stored[0].args.draft;
  assert.deepEqual({ text: nfc(d.text), type: d.type, tags: d.tags, due: d.due ?? null, priority: d.priority ?? null },
    { text: 'Pick up milk', type: 'quick-note', tags: [], due: null, priority: null }, 'the draft holds the text, type and fields');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
  // The next open shows the text with the caret at the end.
  await core.openCapture({ trigger: 'hotkey' });
  await must(capText(page), 'textbox "Capture text"');
  assert.equal(nfc(await eventually(() => capValue(page), (v) => v !== '', 1000)), 'Pick up milk', 'the next capture:open shows the text');
  const caret = await capText(page).evaluate((e) => [(e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).selectionEnd, (e as HTMLTextAreaElement).value.length]);
  assert.deepEqual(caret, [caret[2], caret[2], caret[2]], 'the caret is at the end');
});

test('fr_cap_01_ac18_blur_when_empty_only_hides', async ({ page }) => {
  const core = await startCapture(page);
  const from = await lastSeq(core);
  await blurWindow(page);
  const h = await eventually(() => hides(core), (n) => n >= 1, 2000);
  assert.ok(h >= 1, 'an empty window hides on blur (capture_hide)');
  await sleep(700); // past the draft debounce (§15 item 9)
  assert.deepEqual((await since(core, from)).filter((c) => c.cmd === 'capture_draft_set').map((c) => c.args), [], 'no capture_draft_set');
  assert.equal(await core.draft(), null, 'no draft is stored');
});

test('fr_cap_01_ac18_menus_pickers_and_tab_never_hide_but_a_blur_while_open_does', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Pick up milk');
  // Opening and closing the type menu (choosing Task), the date picker and Tab between controls never hide the window.
  await chooseType(page, 'Task');
  await click(dueBtn(page), 'button "Due: …"');
  const field = await must(datePicker(page), 'the date picker (textbox "Due date")');
  await field.fill('2026-10-15');
  await page.keyboard.press('Enter');
  await (await must(capText(page), 'Capture text')).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
  await sleep(300);
  assert.equal(await hides(core), 0, 'opening and closing the type menu and the date picker, and Tab, never call capture_hide');

  // A blur while the type menu is open hides the window and closes the menu.
  await click(typeBtn(page), 'button "Type: …"');
  await must(typeMenu(page), 'menu "Type"');
  await blurWindow(page);
  assert.ok((await eventually(() => hides(core), (n) => n >= 1, 2000)) >= 1, 'a blur with the type menu open hides the window');
  assert.ok(!(await seen(typeMenu(page), 500)), 'and closes the type menu');
  const d1 = await core.draft();
  assert.equal(d1 && nfc(d1.text), 'Pick up milk', 'the draft is kept');

  // A blur while the date picker is open does the same.
  await core.openCapture({ trigger: 'hotkey' });
  await must(capText(page), 'textbox "Capture text"');
  const before = await hides(core);
  await click(dueBtn(page), 'button "Due: …"');
  await must(datePicker(page), 'the date picker (textbox "Due date")');
  await blurWindow(page);
  assert.ok((await eventually(() => hides(core), (n) => n > before, 2000)) > before, 'a blur with the date picker open hides the window');
  assert.ok(!(await seen(datePicker(page), 500)), 'and closes the date picker');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written into the vault');
});

test('fr_cap_01_ac18_blur_while_a_save_is_in_flight_is_ignored', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Pick up milk');
  await core.writeControl({ hold: true });
  await page.keyboard.press('Meta+Enter');
  await eventually(async () => (await callsOf(core, 'capture_create')).length, (n) => n >= 1, 2000);
  assert.equal((await callsOf(core, 'capture_create')).length, 1, 'setup: the save is in flight (capture_create held)');
  const from = await lastSeq(core);
  await blurWindow(page);
  await sleep(300);
  const during = await since(core, from);
  assert.deepEqual(during.filter((c) => c.cmd === 'capture_hide' || (c.cmd === 'capture_draft_set' && c.args?.draft)).map((c) => c.cmd), [],
    'a blur while the save is in flight neither hides nor stores a draft');
  await core.release();
  assert.ok((await eventually(() => hides(core), (n) => n >= 1, 2000)) >= 1, 'the save hides the window');
  assert.equal((await creates(core)).length, 1, 'one capture');
  assert.equal(await eventually(() => core.draft(), (x) => x === null, 1000), null, 'no draft is left');
});
