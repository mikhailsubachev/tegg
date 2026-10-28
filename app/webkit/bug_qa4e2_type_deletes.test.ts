// QA review of 4E-2 (qa/reviews/4e-2-type-deletes.md, m5): a Delete property dialog that goes away without Cancel
// (here another app removes the property, so its row and the dialog unmount) cancels the job it started, so the job
// never waits in confirm and holds the job queue.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, callsOf, eventually, fileText, fileWhen, jobStatus, movesVault, must, notUpdatedList, openMoves, original, seen } from './type-moves-helpers';
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

/** Type settings of Kniha › Poznámka › `Delete property…` › `Delete from 1 note`. */
async function deletePoznamka(page: import('@playwright/test').Page) {
  await gotoSettings(page, 'Knihy', 'Kniha');
  const g = await must(property(page, 'Poznámka'), 'property group Poznámka');
  const edit = g.getByRole('button', { name: 'Edit Poznámka', exact: true });
  if (await seen(edit, 500)) await edit.click();
  await (await must(g.getByRole('button', { name: 'Delete property…', exact: true }), 'Delete property…')).click();
  await (await must(page.getByRole('button', { name: 'Delete from 1 note', exact: true }), 'Delete from 1 note')).click();
}

// Second review N4 (D-858, D-859): a note left for an anchored entry is named so in the status, without Retry.
test('bug_qa4e2_n4_fr_typ_04_ac9_an_anchored_entry_is_left_as_written_without_retry', async ({ page }) => {
  const anchored = (f: Record<string, string>) => { f[M.duna] = f[M.duna].replace('poznámka: Půjčená od Petra\n', 'poznámka: &kdo Půjčená od Petra\npůjčil: *kdo\n'); };
  const vault = movesVault(anchored);
  const core = await openMoves(page, { vault, at: M.odkazy, tidy: false });
  await deletePoznamka(page);
  const st = await must(jobStatus(page, /left as written \(a value other properties use\)/), 'status `· 1 left as written (a value other properties use)`', 5000);
  assert.ok(!(await st.innerText()).includes('changed meanwhile'), 'not D-844\'s `(changed meanwhile)`');
  assert.equal(await fileText(core, M.duna), vault.files[M.duna], 'Duna keeps its anchored entry');
  await (await must(st.getByRole('button', { name: 'Show', exact: true }), 'Show')).click();
  const list = await must(notUpdatedList(page), 'the not-updated list');
  assert.ok((await list.innerText()).includes('Duna'), 'Duna is listed');
  assert.equal(await list.getByRole('button', { name: 'Retry Duna', exact: true }).count(), 0, 'no Retry: it can never succeed');
});

// Second review N3 (D-857, D-859): a job that fails after writing put everything back and says so.
test('bug_qa4e2_n3_fr_typ_04_ac8_a_job_that_fails_after_writing_says_nothing_was_changed', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, tidy: false });
  const release = await core.holdJob('writing');
  await deletePoznamka(page);
  await must(jobStatus(page, /^Deleting Poznámka/), 'the running status', 5000);
  const theirs = `${original(M.knihaYml)}# upraveno jinde\n`;
  await core.setFile(M.knihaYml, theirs); // another app edits the type file during the job
  await release();
  await must(page.getByRole('alert').filter({ hasText: "Couldn't delete Poznámka. Nothing was changed." }), 'alert `Couldn\'t delete Poznámka. Nothing was changed.`', 5000);
  assert.equal(await fileWhen(core, M.duna, (t) => t === original(M.duna)), original(M.duna), 'Duna is as before');
  assert.equal(await fileText(core, M.knihaYml), theirs, 'the other app\'s type file stays');
});
