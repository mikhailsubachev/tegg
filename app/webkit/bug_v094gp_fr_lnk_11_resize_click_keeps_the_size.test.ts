// v0.94 red tests (AP-1019 = D-1190): a click on a preview's `Resize preview` handle without a drag changed the
// popover's size (it shrank), so the second click of a double-click on the handle landed on the chip behind it and
// opened Jana. A click on the handle must leave the size alone (FR-LNK-11 AC-4: only a drag resizes; a double-click
// resets), and a double-click on it opens nothing (FR-LNK-11 AC-19). Click mode stored (D-1164's test rule).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, backBtn, chipNamed, content, mainName, mark, navsSince, need, needOdkazyLink, needPreview, resizeHandle, sleep, startPreviews } from './previews-helpers';

test.use({ timezoneId: ZONE });

test('bug_v094gp_fr_lnk_11_a_click_on_the_resize_handle_keeps_the_size', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await needPreview(page, 'Rozpočet 2027', 'a click on the chip Rozpočet 2027 (click mode)');
  // As FR-LNK-11 AC-19: follow Jana inside, then Back to Rozpočet.
  await (await need(chipNamed(content(await needPreview(page, 'Rozpočet 2027', 'Rozpočet'), 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside')).click();
  await (await need(backBtn(await needPreview(page, 'Jana Nováková', 'Jana inside'), 'Rozpočet 2027'), 'Back to Rozpočet 2027')).click();
  const d = await needPreview(page, 'Rozpočet 2027', 'Back to Rozpočet 2027');
  await sleep(300);
  const b0 = (await d.boundingBox())!;
  const h = await need(resizeHandle(d), 'the handle "Resize preview"');
  const n0 = await mark(core);
  await h.click();
  await sleep(300);
  const b1 = (await d.boundingBox())!;
  assert.ok(Math.abs(b1.width - b0.width) <= 1 && Math.abs(b1.height - b0.height) <= 1 && Math.abs(b1.x - b0.x) <= 1 && Math.abs(b1.y - b0.y) <= 1,
    `a click on the handle changes neither the size nor the place (${JSON.stringify(b0)} → ${JSON.stringify(b1)})`);
  // As FR-LNK-11 AC-19: a drag resizes, then a double-click on the handle resets the size and opens nothing.
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await sleep(200);
  const b2 = (await d.boundingBox())!;
  const hb2 = (await h.boundingBox())!;
  await page.mouse.click(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await sleep(200);
  const b3 = (await d.boundingBox())!;
  assert.ok(Math.abs(b3.width - b2.width) <= 1 && Math.abs(b3.height - b2.height) <= 1, `after a drag, a click on the handle keeps the size (${JSON.stringify(b2)} → ${JSON.stringify(b3)})`);
  await page.mouse.dblclick(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await sleep(500);
  assert.equal(await mainName(page), 'Odkazy', 'a double-click on the handle opens nothing');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened from the handle');
});
