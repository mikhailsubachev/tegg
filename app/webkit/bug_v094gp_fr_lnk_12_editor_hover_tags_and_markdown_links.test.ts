// QA review of v0.94 (AP-1028 = D-1233): with Object preview on hover, resting the pointer on a `#tag` chip or on a
// Markdown link to a note in the editor showed nothing (the editor reported its link chips only). R104 applies in the
// editor too: both preview after the delay, as in the read view (FR-LNK-12 AC-6). Hover stored with 400 ms (D-1164's
// test rule: the test names the mode it stores).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, editorBody, focusInfo, need, needClosed, needPreview, sleep, startPreviews } from './previews-helpers';

test.use({ timezoneId: ZONE });

async function rest(page: Page, x: number, y: number) {
  await page.mouse.move(x - 2, y);
  await page.mouse.move(x, y);
}

test('bug_v094gp_fr_lnk_12_editor_hover_tags_and_markdown_links', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400 });
  const body = editorBody(page);
  const f0 = await focusInfo(page);
  // The `#účty` tag chip in "Štítky #účty a #nápad, …".
  const tag = await need(body.locator('.tag-chip').filter({ hasText: /^#?účty$/ }), 'the #účty tag chip in the editor');
  await tag.scrollIntoViewIfNeeded();
  const tb = (await tag.boundingBox())!;
  await rest(page, tb.x + tb.width / 2, tb.y + tb.height / 2);
  await needPreview(page, '#Účty', 'resting on the #účty chip in the editor previews the tag', 2500);
  assert.deepEqual(await focusInfo(page), f0, 'the focus doesn\'t move (FR-LNK-12 AC-2)');
  await page.mouse.move(1430, 890);
  await needClosed(page, 'leaving hides it');
  await sleep(200);
  // The Markdown link `[odkaz na rozpočet](…Rozpočet 2027.md)`.
  const md = await need(body.locator('a[href]').filter({ hasText: 'odkaz na rozpočet' }), 'the Markdown link to Rozpočet in the editor');
  await md.scrollIntoViewIfNeeded();
  const mb = (await md.boundingBox())!;
  await rest(page, mb.x + Math.min(20, mb.width / 2), mb.y + mb.height / 2);
  await needPreview(page, 'Rozpočet 2027', 'resting on the Markdown link in the editor previews its note', 2500);
});
