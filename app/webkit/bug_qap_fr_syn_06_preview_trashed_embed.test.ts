// Slice P QA review (B2): a preview writes nothing (FR-SYN-06 AC-37, FR-LNK-11 AC-9), so an embed of a trashed object
// inside one shows the D-27 placeholder without its `Restore` button. The note pages keep the button.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, needOdkazyLink, needPreview, nfc, previewsVault, sleep, snapshot, startPreviews, writesSince } from './previews-helpers';

test.use({ timezoneId: ZONE });

const vault = () => previewsVault((files) => {
  const k = nfc(PV.rozpocet);
  files[k] = `${files[k].replace(/\n*$/, '\n')}\n![[Smazaná]]\n`;
});

test('bug_qap_fr_syn_06_a_trashed_embed_in_a_preview_has_no_restore_and_writes_nothing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, vault: vault() });
  const files0 = await snapshot(core);
  await (await needOdkazyLink(page, 'Hlavní', 0)).click();
  const dlg = await needPreview(page, 'Rozpočet 2027', 'Rozpočet with the trashed embed');
  const placeholder = dlg.locator('[data-embed-state="trashed"]');
  await placeholder.waitFor({ timeout: 3000 });
  assert.match(nfc((await placeholder.innerText()).trim()), /^"Smazaná" was moved to the trash$/, 'the D-27 placeholder text');
  assert.equal(await dlg.getByRole('button', { name: 'Restore', exact: true }).count(), 0, 'no Restore inside a preview');
  await placeholder.click();
  await sleep(300);
  assert.deepEqual(await writesSince(core, 0), [], 'no write command');
  assert.deepEqual(await snapshot(core), files0, 'every vault file unchanged');
});
