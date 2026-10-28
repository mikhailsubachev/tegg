// QA review of 4E-2 (qa/reviews/4e-2-type-deletes.md, m5): a Delete property dialog that goes away without Cancel
// (here another app removes the property, so its row and the dialog unmount) cancels the job it started, so the job
// never waits in confirm and holds the job queue.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, callsOf, eventually, must, openMoves, original, seen } from './type-moves-helpers';
import { gotoSettings, property } from './types-helpers';

test('bug_qa4e2_minor5_fr_typ_04_ac6_a_dialog_that_goes_away_cancels_its_job', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, tidy: false });
  await gotoSettings(page, 'Knihy', 'Kniha');
  const g = await must(property(page, 'Poznámka'), 'property group Poznámka');
  const edit = g.getByRole('button', { name: 'Edit Poznámka', exact: true });
  if (await seen(edit, 500)) await edit.click();
  await (await must(g.getByRole('button', { name: 'Delete property…', exact: true }), 'Delete property…')).click();
  await must(page.getByRole('dialog', { name: 'Delete property "Poznámka"?', exact: true }), 'the dialog with its plan');
  // Another app removes the property from kniha.yml: the property's row, and the dialog with it, go away.
  await core.setFile(M.knihaYml, original(M.knihaYml).replace('  - key: poznámka\n    name: Poznámka\n    type: text\n', ''));
  assert.equal(await eventually(() => page.getByRole('dialog').count(), (n) => n === 0, 3000), 0, 'the dialog is gone');
  const cancels = await eventually(() => callsOf(core, 'job_cancel'), (c) => c.length > 0, 3000);
  assert.ok(cancels.length > 0, 'the job it started is cancelled (never left in confirm)');
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'value-remove'), 3000);
  assert.equal(j.find((r) => r.kind === 'value-remove')?.phase, 'cancelled', 'the value-remove job ended cancelled');
});
