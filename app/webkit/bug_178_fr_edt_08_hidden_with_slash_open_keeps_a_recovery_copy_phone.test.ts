// Bug #178 (QA review of slice AND-3, finding 3; owner D-2570 (3)): the Saver doesn't write while a typed command is
// open (the `/` panel pauses it, FR-EDT-03 AC-5), and the hidden flush (android-edit §11.1, §11.2) kept a recovery copy
// only when the Saver was blocked or had failed. A note sent to the background with the `/` panel open lost its unsaved
// edits if Android then stopped the app (FR-EDT-08 AC-16, AC-17). Now the flush keeps a recovery copy whenever edits
// are still unsaved after it. L5p (phone-webkit, phone-chromium).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { EDIT_NOW, PE, VAULT_PATH, editVault, eventually, needBody, nfc, panel, setCaret, sleep, startPhone, tapToEdit, visibility, type PhoneHandle } from './phone-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

async function open(page: Page): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(page, PE.psani);
  return core;
}

test('bug_178_fr_edt_08_hidden_with_the_slash_panel_open_keeps_a_recovery_copy', async ({ page }) => {
  const core = await open(page);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' Ahoj' }, { enter: true }, { text: '/' }]);
  assert.ok(await panel(page, 'Insert block').isVisible(), 'the `/` panel is open');
  await visibility(page, 'hidden');
  const copies = await eventually(() => core.recoveries(), (r) => r.length >= 1, 1000);
  assert.equal(copies.length, 1, 'one recovery copy is kept');
  assert.equal(copies[0].path, nfc(PE.psani), 'the copy\'s path');
  assert.equal(copies[0].vault, VAULT_PATH, 'the open vault\'s root');
  assert.ok(copies[0].text.includes('Konec. Ahoj'), `the copy holds the edit: ${JSON.stringify(copies[0].text.slice(-40))}`);
});

test('bug_178_fr_edt_08_hidden_after_a_saved_edit_keeps_no_copy', async ({ page }) => {
  const core = await open(page);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' Ahoj' }]);
  await visibility(page, 'hidden');
  await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'note_write' && c.ok !== undefined).length, (n) => n >= 1, 2000);
  await sleep(300);
  assert.deepEqual(await core.recoveries(), [], 'an edit the flush wrote leaves no recovery copy');
});
