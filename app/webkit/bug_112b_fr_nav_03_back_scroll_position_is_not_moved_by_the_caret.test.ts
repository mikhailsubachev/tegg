// Bug #112 b (FR-NAV-03 AC-4, D-255: the caret never scrolls; the flaky `fr_lnk_09_ac8_…_click`,
// `fr_syn_06_ac42_…` and `bug_102_fr_emb_02_a_scroll_right_after_back_stays`): after Back the note restores its scroll
// position and its caret. ProseMirror then put its selection back after the focus ("the browser reset the selection")
// and scrolled the caret into view, which moved the note off the restored position until a later restore put it back:
// a click measured in between missed its target, and a wheel right after that later restore was lost. Every scroll
// position the page asks for after Back must be the restored one.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, editorBody, eventually, frame, linkEmbed, main, mainScrollTop, mustBeOn, need, startPreviews } from './previews-helpers';

test.use({ timezoneId: ZONE });

/** Records every value the page assigns to the centre pane's `scrollTop` (`window.__asked`). */
async function recordScrollWrites(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __asked: number[] };
    w.__asked = [];
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return d.get!.call(this); },
      set(v: number) { if ((this as Element).tagName === 'MAIN') w.__asked.push(Number(v)); d.set!.call(this, v); },
    });
  });
}

test('bug_112b_fr_nav_03_back_scroll_position_is_not_moved_by_the_caret', async ({ page }) => {
  await recordScrollWrites(page);
  await startPreviews(page, { at: PV.vlozeni, mode: 'off' });
  await need(frame(editorBody(page), 'Jana Nováková'), 'the card embed (the note\'s embeds loaded)');
  await page.waitForTimeout(800);
  const box = (await main(page).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 700);
  const left = await eventually(() => mainScrollTop(page), (t) => t === 700, 2000);
  assert.equal(left, 700, 'the wheel scrolls Vložení to 700');
  // The click puts the caret at the link-mode embed and opens Petr (Off); Back returns with both.
  await (await need(linkEmbed(editorBody(page), 'Petr Dvořák'), 'the link-mode embed ![[Petr Dvořák|link]]')).click();
  await mustBeOn(page, 'Petr Dvořák', 'a click on the link-mode embed opens Petr');
  await page.waitForTimeout(500);
  await page.evaluate(() => { (window as unknown as { __asked: number[] }).__asked.length = 0; });
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Vložení', 'Back');
  const top = await eventually(() => mainScrollTop(page), (t) => t === 700, 3000);
  assert.equal(top, 700, 'Back restores the scroll position');
  await page.waitForTimeout(1000); // past the last restore (600 ms after the embeds)
  const asked = await page.evaluate(() => (window as unknown as { __asked: number[] }).__asked);
  assert.ok(asked.length > 0, 'the restore was recorded');
  assert.deepEqual(asked.filter((v) => Math.abs(v - 700) > 1), [], 'after Back the centre pane is only ever scrolled to the restored position (700)');
  assert.equal(await mainScrollTop(page), 700, 'and it stays there');
});
