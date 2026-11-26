// Bug #182 (QA review of slice AND-3, finding 10): the hidden flush blurred a focused Properties-sheet field and then
// waited a task (`setTimeout(0)`) before writing, though android-edit §11.1 starts the write within the same task
// (FR-EDT-08 AC-16 (c)); Android may stop a backgrounded app at any time. The field is committed synchronously and the
// write starts before any other task runs. L5p (phone-webkit, phone-chromium).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { EDIT_NOW, eventually, loadVault, must, needBody, propsSheet, runById, startPhone } from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PORADA = 'Schůzky/2026-10-07 Porada.md';
const typesVault = () => loadVault('Typy', ['types', 'new-empty/.tegg']);

test('bug_182_fr_edt_08_hidden_flush_writes_a_sheet_field_before_the_next_task', async ({ page }) => {
  const core = await startPhone(page, { vault: typesVault(), route: `note/${PORADA}`, now: EDIT_NOW });
  await needBody(page, 'Porada');
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'phone.properties');
  const field = await must(propsSheet(page).getByRole('textbox', { name: 'Místo' }), 'the sheet\'s Místo field');
  await field.tap();
  await field.pressSequentially('Sál B');
  // `hidden`, then count the writes in a task queued before the flush ran: the write must already be on its way.
  const before = await page.evaluate(() => new Promise<number>((done) => {
    const w = window as any;
    setTimeout(() => done(w.__teggFake.calls.filter((c: any) => c.cmd === 'note_write').length), 0);
    w.__TEGG_TEST__.visibility('hidden');
  }));
  assert.equal(before, 1, 'the note_write started within the task that handled `hidden`');
  const writes = await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'note_write' && c.ok !== undefined), (x) => x.length >= 1, 1000);
  assert.match(String((writes[0].args as any)?.text ?? ''), /^místo: Sál B$/m, 'the write holds místo: Sál B');
});
