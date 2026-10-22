// Preview v0.55 L6 run (docs/plans/open-items.md item 14): Discard kept the images staged in the capture window, so the
// next capture saved them too. trash-media.md FR-ATT-01 AC-11 ("Cancelling writes nothing"), capture.md FR-CAP-01 AC-12,
// ms6-trash-media §5 (tokens are dropped when the capture is saved or cancelled). Every lookup goes through
// `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { capText, click, discardBtn, eventually, must, sleep, startCapture, typeInCapture } from './capture-helpers';
import { NOW, fixtureBytes, tmVault } from './trash-media-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const removeBtns = (page: Page) => page.getByRole('button', { name: /^Remove(?! #)/ });

test('bug_v055_fr_cap_01_discard_drops_staged_media', async ({ page }) => {
  const core = await startCapture(page, { vault: tmVault(), now: NOW });
  await (await must(capText(page), 'Capture text')).focus();
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: fixtureBytes('_attachments/záhon.png') }] });
  await must(removeBtns(page), 'the pasted image is staged', 3000);
  await click(discardBtn(page), 'Discard');
  await core.openCapture({ trigger: 'hotkey', kind: 'default' });
  await sleep(300);
  assert.equal(await removeBtns(page).count(), 0, 'after Discard the next capture has no staged image');
  await typeInCapture(page, 'Jen text');
  await page.keyboard.press('Meta+Enter');
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 1, 3000);
  await sleep(300);
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Jen text.md'], `only the note is written (${w.join(', ')})`);
});
