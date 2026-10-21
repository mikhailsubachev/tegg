// v0.52 feedback H6 (docs/feedback/ms5-v052.md; capture.md FR-CAP-01 AC-20, D-592): the capture text is a transparent
// textarea over a mirror that drew the title line at weight 650, while the caret and the selection come from the
// textarea's 400-weight glyphs, so on a long title they drifted away from the bold text shown. Written from the AC and
// the contract only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { capText, must, sleep, startCapture, typeInCapture } from './capture-helpers';
import { caretProbe } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_v052_fr_cap_01_caret_matches_the_bold_title', async ({ page }) => {
  const title = 'Příprava vícejazyčné podpory a překladové paměti pro web';
  await startCapture(page);
  await typeInCapture(page, `${title}\nPoznámky k rozsahu.`);
  await sleep(150);
  const p = await caretProbe(await must(capText(page), 'textbox "Capture text"'), title, 'překladové');
  assert.equal(p.mirror, true, 'the mirror draws the title');
  const worst = Math.max(...p.dx);
  assert.ok(worst <= 1, `the caret stays on the bold title at every offset (worst ${worst} px at offset ${p.dx.indexOf(worst)})`);
  assert.ok(p.word && p.word.left <= 1 && p.word.right <= 1, `a word's selection covers it in the mirror (${JSON.stringify(p.word)})`);
});
