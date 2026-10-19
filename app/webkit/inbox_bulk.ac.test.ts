// MS5 slice 5B, L5 (WebKit + fake core): selection and bulk actions on the Inbox, docs/acceptance/inbox.md FR-INB-02
// AC-12 (Space, ⇧, ⌘A, Esc; bulk mark reviewed writes exactly the selection; a file changed without an event is skipped
// with `{count} items changed outside Tegg and weren't changed.`; a non-modal job), AC-13 (Mark all reviewed with its
// confirmation; with a filter), AC-14 (bulk convert makes a backup first; cancel in planning; other bulk actions make
// no zip). Interface docs/contracts/ms5-capture.md §7.3 (`inbox_bulk(paths, change)` → `{ jobId }`, kind `inbox`,
// skips `changed` / `readOnly`), ms4-jobs §4 (`job:progress`, `job_cancel`), §11.2 (the fake's job and backups).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CARD, I, NOW, callsOf, cardNamed, cardPaths, click, eventually, fileText, filterBtn, ip, liveSays, main, markAllBtn, must, nfc, original,
  reviewedText, seen, sleep, startInbox, swap, zero, type FakeCoreHandle,
} from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const bar = (page: Page, n: number) => main(page).getByRole('toolbar', { name: `${n} selected`, exact: true });
async function select(page: Page, keys: (keyof typeof CARD)[]) {
  for (const k of keys) {
    await (await must(cardNamed(page, CARD[k]), CARD[k])).focus();
    await page.keyboard.press('Space');
  }
}
async function bulkPaths(core: FakeCoreHandle) {
  return (await callsOf(core, 'inbox_bulk')).map((c) => ((c.args as any).paths as string[]).map(nfc).sort());
}

test('fr_inb_02_ac12_selection_gestures', async ({ page }) => {
  await startInbox(page);
  await (await must(cardNamed(page, CARD.Q1), 'Q1')).focus();
  await page.keyboard.press('Space');
  await must(bar(page, 1), 'toolbar "1 selected"');
  await must(cardNamed(page, CARD.Q1).getByRole('checkbox', { name: 'Select "Koupit mléko"', exact: true }), 'the selection checkbox');
  await page.keyboard.press('Shift+ArrowDown');
  await must(bar(page, 2), '⇧↓ extends');
  await page.keyboard.press('Meta+a');
  await must(bar(page, 13), '⌘A selects every shown item');
  await page.keyboard.press('Escape');
  assert.equal(await main(page).getByRole('toolbar').count(), 0, 'Esc clears');
  await select(page, ['Q1']);
  await click(bar(page, 1).getByRole('button', { name: 'Clear selection', exact: true }), 'Clear selection');
  assert.equal(await main(page).getByRole('toolbar').count(), 0, 'Clear selection clears');
});

test('fr_inb_02_ac12_bulk_mark_reviewed_writes_exactly_the_selection', async ({ page }) => {
  const core = await startInbox(page);
  await select(page, ['Q1', 'Q2', 'Q4']);
  await must(bar(page, 3), '3 selected');
  await page.keyboard.press('r');
  assert.deepEqual(await bulkPaths(core), [[nfc(I.Q1), nfc(I.Q2), nfc(I.Q4)].sort()], 'one inbox job over the three files');
  assert.equal((await callsOf(core, 'inbox_bulk'))[0]?.args && ((await callsOf(core, 'inbox_bulk'))[0].args as any).change.op, 'set-review', 'set-review');
  const done = await eventually(() => core.jobs(), (j) => j.length === 1, 3000);
  assert.deepEqual(done[0]?.written.map(nfc).sort(), [nfc(I.Q1), nfc(I.Q2), nfc(I.Q4)].sort(), 'exactly those three files');
  assert.equal(await fileText(core, I.Q1), reviewedText(I.Q1), 'Q1 by AC-1');
  assert.equal(await fileText(core, I.Q4), swap(original(I.Q4), 'modified: 2026-10-10T10:00:00+02:00\n---\n', `modified: ${NOW}\nreview: reviewed\n---\n`), 'Q4 by AC-2');
  assert.ok(await liveSays(page, 'Changed 3 items'), 'Changed 3 items');
  assert.equal(await page.getByRole('dialog').count(), 0, 'a non-modal job');
});

test('fr_inb_02_ac12_a_changed_file_is_skipped_and_reported', async ({ page }) => {
  const core = await startInbox(page);
  await core.setFile(I.Q2, original(I.Q2) + 'Dopsáno jinde.\n', { silent: true });
  await select(page, ['Q1', 'Q2', 'Q4']);
  await click(bar(page, 3).getByRole('button', { name: 'Mark reviewed', exact: true }), 'Mark reviewed');
  const j = await eventually(() => core.jobs(), (x) => x.length === 1, 3000);
  assert.deepEqual(j[0]?.skipped, [{ path: nfc(I.Q2), reason: 'changed' }], 'Q2 skipped as changed');
  assert.ok(await seen(page.getByText("1 item changed outside Tegg and wasn't changed.", { exact: true }), 2000), 'the alert with plural forms (1 item … wasn\'t)');
  assert.equal(await fileText(core, I.Q2), original(I.Q2) + 'Dopsáno jinde.\n', 'Q2 keeps the external bytes');
});

test('fr_inb_02_ac13_mark_all_reviewed', async ({ page }) => {
  const core = await startInbox(page);
  await click(markAllBtn(page), 'Mark all reviewed');
  const dlg = await must(page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Mark 13 items reviewed?' }), 'Mark 13 items reviewed?');
  await click(dlg.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  assert.deepEqual(await callsOf(core, 'inbox_bulk'), [], 'Cancel writes nothing');
  await click(markAllBtn(page), 'Mark all reviewed');
  await must(page.getByText('Mark 13 items reviewed?'), 'again');
  await page.keyboard.press('Escape');
  assert.deepEqual(await callsOf(core, 'inbox_bulk'), [], 'Esc writes nothing');
  await click(filterBtn(page, 'quick-note'), 'Quick Notes');
  await click(markAllBtn(page), 'Mark all reviewed');
  const d2 = await must(page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Mark 7 items reviewed?' }), 'Mark 7 items reviewed? with the filter');
  await click(d2.getByRole('button', { name: 'Mark reviewed', exact: true }), 'Mark reviewed');
  assert.deepEqual(await bulkPaths(core), [ip('Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8').sort()], 'only the 7 shown');
  await eventually(() => core.jobs(), (x) => x.length === 1, 3000);
  await click(filterBtn(page, 'all'), 'All');
  await click(markAllBtn(page), 'Mark all reviewed');
  await click(page.getByRole('button', { name: 'Mark reviewed', exact: true }).last(), 'confirm');
  await eventually(() => core.jobs(), (x) => x.length === 2, 3000);
  await page.keyboard.press('Meta+d');
  await page.keyboard.press('Meta+Shift+i');
  await must(zero(page), 'the empty state after all are reviewed');
  assert.deepEqual(await cardPaths(page), [], 'no card');
});

test('fr_inb_02_ac14_bulk_convert_makes_a_backup_first', async ({ page }) => {
  const core = await startInbox(page);
  await select(page, ['Q1', 'Q2']);
  await click(bar(page, 2).getByRole('button', { name: 'Convert to…', exact: true }), 'Convert to…');
  await click(page.getByRole('menuitem', { name: /^Nápad/ }).or(page.getByRole('menuitemradio', { name: /^Nápad/ })), 'Nápad');
  const j = await eventually(() => core.jobs(), (x) => x.length === 1, 3000);
  assert.equal(j[0]?.kind, 'inbox', 'an inbox job');
  assert.deepEqual((await core.backups()).map((b) => b.kind), ['inbox'], 'one backup zip, listed for the inbox job (`Convert 2 items to Nápad`)');
  assert.ok((await fileText(core, I.Q1))?.includes('\ntype: nápad\n'), 'Q1 converted');
});

test('fr_inb_02_ac14_cancel_in_planning_and_no_zip_for_other_actions', async ({ page }) => {
  const core = await startInbox(page);
  const release = await core.holdJob('planning');
  await select(page, ['Q1', 'Q2']);
  await click(bar(page, 2).getByRole('button', { name: 'Convert to…', exact: true }), 'Convert to…');
  await click(page.getByRole('menuitem', { name: /^Nápad/ }).or(page.getByRole('menuitemradio', { name: /^Nápad/ })), 'Nápad');
  await click(page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true }), 'Cancel in the job status');
  await release();
  const j = await eventually(() => core.jobs(), (x) => x.length === 1, 3000);
  assert.equal(j[0]?.phase, 'cancelled', 'cancelled in planning');
  assert.deepEqual(await core.backups(), [], 'no zip');
  assert.deepEqual(await core.writesTo(), [], 'the vault is untouched');
  // Bulk mark reviewed, Link to and Add tags make no zip.
  await select(page, ['Q1', 'Q2']);
  await click(bar(page, 2).getByRole('button', { name: 'Mark reviewed', exact: true }), 'Mark reviewed');
  await eventually(() => core.jobs(), (x) => x.length === 2, 3000);
  assert.deepEqual(await core.backups(), [], 'no zip for mark reviewed');
  await sleep(100);
});
