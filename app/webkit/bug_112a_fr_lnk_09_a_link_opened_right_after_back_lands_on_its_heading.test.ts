// Bug #112 a (FR-LNK-09 AC-10, read-view FR-EDT-02 AC-7; the flaky `fr_lnk_09_ac10_a_full_or_section_embeds_header_opens_*`):
// Back keeps the scroll position to restore until the note it returns to has painted its first frame. A link opened
// before that frame (a click right after Back, while frames lag) took that position as its own: `Rozpočet 2027#Rozsah`
// opened at Odkazy's scroll position instead of at the heading. The frames are held with the test clock, so the order
// is the same on every run.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { NOW, PV, ZONE, eventually, main, mustBeOn, need, needOdkazyLink, startPreviews, topBelowToolbar } from './previews-helpers';

test.use({ timezoneId: ZONE });

test('bug_112a_fr_lnk_09_a_link_opened_right_after_back_lands_on_its_heading', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'off', install: true });
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'a click on [[Rozpočet 2027]] opens it (Off)');
  await need(main(page).locator('h2').filter({ hasText: /^\s*Rozsah\s*$/ }), 'the heading Rozsah');
  await page.waitForTimeout(700); // the note has settled
  // From here no animation frame and no timer runs until the clock resumes.
  await page.clock.pauseAt(new Date(new Date(NOW).getTime() + 60_000));
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Odkazy', 'Back');
  const link = await needOdkazyLink(page, 'Sekce');
  const b = (await link.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await mustBeOn(page, 'Rozpočet 2027', 'a click on [[Rozpočet 2027#Rozsah]] before Odkazy\'s first frame opens it');
  await page.clock.resume();
  const hd = await need(main(page).locator('h2').filter({ hasText: /^\s*Rozsah\s*$/ }), 'the heading Rozsah');
  const top = await eventually(() => topBelowToolbar(hd), (t) => t !== null && Math.abs(t - 24) <= 8, 3000);
  assert.ok(top !== null && Math.abs(top - 24) <= 8, `Rozpočet 2027#Rozsah opens with Rozsah 24 px below the toolbar (± 8 px, D-1625, D-1673), not at Back's scroll position: ${top}`);
});
