// MS6 slice 6A, L5 (WebKit + fake core): Move to trash in the Inbox, docs/acceptance/inbox.md FR-INB-02 AC-10 ([MS6],
// the 6A part: the item moves to `.trash/` with its relative path kept, the card leaves within 1 s) and
// docs/acceptance/trash-media.md FR-HIS-01 AC-3 (the Inbox triage menu, ⌫ on a focused card and the selection toolbar:
// one rename per item, `Moved 3 items to the trash`, Undo restores all three). Interface
// docs/contracts/ms6-trash-media.md §4 (`object_trash`, `trash_restore`), §6.2 (`moveToTrash`), §9.2. Written from the
// ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CARD, I, callsOf, cardAt, cardNamed, click, eventually, isDisabled, liveSays, main, must, nfc, openTriage, original, sleep, startInbox,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const bar = (page: Page, n: number) => main(page).getByRole('toolbar', { name: `${n} selected`, exact: true });
const trashed = (p: string) => `.trash/${nfc(p)}`;

test('fr_inb_02_ac10_triage_menu_moves_to_trash', async ({ page }) => {
  const core = await startInbox(page);
  const menu = await openTriage(page, 'Koupit mléko');
  const item = menu.getByRole('menuitem', { name: 'Move to trash', exact: true });
  assert.equal(await isDisabled(item), false, 'enabled from 6A (no longer Coming in MS6)');
  await click(item, 'Move to trash');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 1000), [{ kind: 'trash', from: nfc(I.Q1), to: trashed(I.Q1) }], 'one rename, the relative path kept (FR-STO-08)');
  assert.equal((await core.files())[trashed(I.Q1)], original(I.Q1), 'bytes untouched');
  assert.equal(await eventually(() => cardAt(page, I.Q1).count(), (n) => n === 0, 1000), 0, 'the card leaves within 1 s');
  assert.ok(await liveSays(page, 'Moved "Koupit mléko" to the trash'), 'the live region');
});

test('fr_inb_02_ac10_backspace_on_a_focused_card', async ({ page }) => {
  const core = await startInbox(page);
  await (await must(cardNamed(page, CARD.Q2), 'Q2')).focus();
  await page.keyboard.press('Backspace');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 1000), [{ kind: 'trash', from: nfc(I.Q2), to: trashed(I.Q2) }], '⌫ moves the focused item');
  assert.equal(await eventually(() => cardAt(page, I.Q2).count(), (n) => n === 0, 1000), 0, 'the card leaves');
});

test('fr_his_01_ac3_inbox_selection_toolbar_moves_three_and_undo_restores', async ({ page }) => {
  const core = await startInbox(page);
  for (const k of ['Q1', 'Q2', 'Q4'] as const) {
    await (await must(cardNamed(page, CARD[k]), k)).focus();
    await page.keyboard.press('Space');
  }
  const tb = await must(bar(page, 3), 'toolbar "3 selected"');
  const btn = tb.getByRole('button', { name: 'Move to trash', exact: true });
  assert.equal(await isDisabled(btn), false, 'enabled');
  await click(btn, 'Move to trash');
  const calls = await eventually(() => callsOf(core, 'object_trash'), (c) => c.length >= 3, 2000);
  assert.deepEqual(calls.map((c) => nfc(String((c.args as any)?.path))).sort(), [I.Q1, I.Q2, I.Q4].map(nfc).sort(), 'one object_trash per item');
  assert.ok(await liveSays(page, 'Moved 3 items to the trash'), 'Moved 3 items to the trash');
  const toast = page.getByRole('status').filter({ hasText: 'Moved 3 items to the trash' });
  await click(toast.getByRole('button', { name: 'Undo', exact: true }), 'Undo');
  const restores = await eventually(() => callsOf(core, 'trash_restore'), (c) => c.length >= 3, 2000);
  assert.equal(restores.length, 3, 'Undo restores all three');
  const files = await core.files();
  for (const k of ['Q1', 'Q2', 'Q4'] as const) assert.equal(files[nfc(I[k])], original(I[k]), `${k} is back, same bytes`);
  await sleep(100);
});
