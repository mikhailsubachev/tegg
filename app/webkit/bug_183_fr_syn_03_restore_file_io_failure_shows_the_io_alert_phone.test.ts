// Bug #183 (QA review of slice AND-3, finding 11): on the phone `Restore file` (android-edit §2.4 row 12, FR-SYN-03
// AC-43) is an exclusive create; a refusal other than a taken name (an Io error) showed nothing, and the user couldn't
// tell the file wasn't restored. It shows the desktop's `io` alert, keeps the deleted alert, and a later try restores
// the file. L5p (phone-webkit, phone-chromium).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { EDIT_NOW, PE, editVault, eventually, must, needBody, nfc, setCaret, sleep, startPhone, tapToEdit, writeCalls, type PhoneHandle } from './phone-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

const PSANI = nfc(PE.psani);

async function open(page: Page): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(page, PE.psani);
  return core;
}

test('bug_183_fr_syn_03_restore_file_io_failure_shows_the_io_alert', async ({ page }) => {
  const core = await open(page);
  await core.writeControl({ hold: true });
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: 'X' }]);
  await core.setFile(PE.psani, null);
  await core.release();
  const deleted = await must(page.getByRole('alert').filter({ hasText: 'This note was deleted outside Tegg' }), 'the deleted alert', 2500);
  // The exclusive create fails with Io once.
  await page.evaluate(() => {
    const h = (window as any).__teggFake.handlers;
    const orig = h.note_create_exact;
    h.note_create_exact = () => { h.note_create_exact = orig; throw { kind: 'Io', message: 'fake: write failed (Io)' }; };
  });
  await deleted.getByRole('button', { name: 'Restore file' }).click();
  await must(page.getByRole('alert').filter({ hasText: 'couldn’t save this note' }), 'the io alert', 2000);
  assert.ok(await deleted.isVisible(), 'the deleted alert stays (Restore file and Discard)');
  assert.equal((await core.files())[PSANI], undefined, 'nothing was restored yet');
  // Try again restores the file.
  const n = (await core.calls()).length;
  await page.getByRole('alert').filter({ hasText: 'couldn’t save this note' }).getByRole('button', { name: 'Try again' }).click();
  const w = await eventually(() => writeCalls(core, n), (x) => x.length >= 1, 2000);
  assert.deepEqual(w, [{ cmd: 'note_create_exact', path: PSANI }], 'Try again creates the file exclusively');
  assert.ok((await core.files())[PSANI]?.includes('Konec.X'), 'with the editor\'s content');
  await sleep(300);
  assert.equal(await page.getByRole('alert').filter({ hasText: /couldn’t save this note|deleted outside Tegg/ }).count(), 0, 'both alerts are gone');
});
