// Bug #112 c (FR-EMB-02 AC-9, D-456; the flaky `fr_lnk_09_ac12_still_previewed_on_request_*`): after Back the note
// restores its scroll position while its embeds load. When the embeds answered after the note was drawn (a loaded
// machine; here `embed_load` is delayed), their own correction ("what is on screen stays put while the embeds above it
// change size") measured the note without their height, at the scroll position the previous page had left, and moved
// the note about 1,500 px away until the next restore put it back; a right-click sent in between opened its menu
// outside the window. Every scroll position the page asks for after Back must be the restored one.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, editorBody, eventually, frame, main, mainScrollTop, mustBeOn, need, startPreviews } from './previews-helpers';

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

test('bug_112c_fr_emb_02_back_scroll_position_is_not_moved_by_the_embeds', async ({ page }) => {
  await recordScrollWrites(page);
  const core = await startPreviews(page, { at: PV.vlozeni, mode: 'off' });
  const card = await need(frame(editorBody(page), 'Jana Nováková'), 'the card embed "Embedded: Jana Nováková"');
  await page.waitForTimeout(800);
  const box = (await main(page).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 460);
  const left = await eventually(() => mainScrollTop(page), (t) => t === 460, 2000);
  assert.equal(left, 460, 'the wheel scrolls Vložení to 460');
  // Jana's note is tall enough to keep 460 as its own scroll position, so Back finds the centre pane already there.
  const cb = (await card.boundingBox())!;
  await card.click({ position: { x: cb.width - 12, y: 12 } });
  await mustBeOn(page, 'Jana Nováková', 'a click on the card opens Jana');
  await page.waitForTimeout(500);
  // The embeds answer after the note is shown, as on a loaded machine: the note is first drawn without their height.
  await core.delayCommand('embed_load', 300);
  await page.evaluate(() => { (window as unknown as { __asked: number[] }).__asked.length = 0; });
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Vložení', 'Back');
  await need(frame(editorBody(page), 'Jana Nováková'), 'the card embed after Back');
  await page.waitForTimeout(1200); // past the last restore (600 ms after the embeds)
  const asked = await page.evaluate(() => (window as unknown as { __asked: number[] }).__asked);
  assert.deepEqual(asked.filter((v) => Math.abs(v - 460) > 1), [], 'after Back the centre pane is only ever scrolled to the restored position (460)');
  assert.equal(await mainScrollTop(page), 460, 'Back restores the scroll position');
});
