// Bug #112 d (FR-LNK-11 AC-7, AC-22, D-932; the flaky `fr_lnk_11_ac22_enter_and_alt_space_on_a_focused_link_inside_click`):
// ⌥Space or ⏎ on a focused link inside a preview replaces the preview's content. The focused link goes away with the
// old content, and the popover took the focus only in the next animation frame. When the new content was drawn before
// that frame (frames lag under load), the focus was on the page body and Esc didn't reach the popover: it stayed open.
// The frames are held with the test clock, so the order is the same on every run.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { NOW, PV, ZONE, backBtn, chipNamed, content, eventually, need, needOdkazyLink, needPreview, previewCount, startPreviews } from './previews-helpers';

test.use({ timezoneId: ZONE });

test('bug_112d_fr_lnk_11_esc_right_after_a_link_inside_replaced_the_preview_closes_it', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'click', readView: true, install: true });
  await (await needOdkazyLink(page, 'Hlavní')).click();
  const d = await needPreview(page, 'Rozpočet 2027', 'a click previews Rozpočet');
  const jana = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside');
  await page.waitForTimeout(300);
  await jana.focus();
  // From here no animation frame and no timer runs until the clock resumes.
  await page.clock.pauseAt(new Date(new Date(NOW).getTime() + 60_000));
  await page.keyboard.press('Alt+Space');
  const dj = await needPreview(page, 'Jana Nováková', '⌥Space on the focused link inside replaces the content');
  await need(backBtn(dj, 'Rozpočet 2027'), 'with Back to Rozpočet 2027');
  const focusInside = await dj.evaluate((x) => x.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await page.clock.resume();
  const n = await eventually(() => previewCount(page), (c) => c === 0, 2000);
  assert.equal(n, 0, `Esc right after the replacement closes the preview (the focus was ${focusInside ? 'in the preview' : 'outside the preview'})`);
});
