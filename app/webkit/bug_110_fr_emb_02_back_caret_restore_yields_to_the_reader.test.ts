// Issue #110 (follow-up of #102): after Back, placing the caret restores the scroll position again a frame later; on
// a loaded machine that frame comes after the reader's first wheel and moves the page back. Frame callbacks are held
// back here by 300 ms from Back on, as a busy machine does.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, eventually, main, mustBeOn, needEmbeds, needTop, openEmbeds, ui as embedsUi } from './embeds-helpers';
import { setPreviewMode } from '../ui/test/fake-core';

test.use({ timezoneId: 'Europe/Prague' });

const top = (page: Page) => page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);

test('bug_110_fr_emb_02_a_scroll_right_after_back_stays_when_frames_lag', async ({ page }) => {
  await openEmbeds(page, M.rezimy, setPreviewMode('off', { uiState: embedsUi() }));
  await needEmbeds(main(page), 12, 'the host note');
  const saturnin = await needTop(main(page), 4, 'Saturnin link-mode embed');
  await saturnin.scrollIntoViewIfNeeded();
  const before = await top(page); // the position Back restores
  await saturnin.click();
  await mustBeOn(page, 'Saturnin', 'a click on the link-mode embed opens Saturnin');
  // The reader scrolls up 100 ms after the restore, before the frames that follow it (held back by 300 ms, as on a busy
  // machine): a wheel event, then the scroll the wheel makes.
  await page.evaluate((target) => {
    const w = window as any;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => raf(() => { setTimeout(() => cb(performance.now()), 300); });
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get() { return d.get!.call(this); },
      set(v: number) {
        d.set!.call(this, v);
        if ((this as Element).tagName !== 'MAIN' || w.__readerScrolled || Math.abs(v - target) > 2) return;
        w.__readerScrolled = true;
        const m = this as HTMLElement;
        setTimeout(() => {
          m.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -300 }));
          d.set!.call(m, d.get!.call(m) - 300);
          w.__restored = v;
          w.__moved = d.get!.call(m);
        }, 100);
      },
    });
  }, before);
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  await needEmbeds(main(page), 12, 'the host note after Back');
  const r = await eventually(() => page.evaluate(() => ({ restored: (window as any).__restored as number | undefined, moved: (window as any).__moved as number | undefined })), (x) => x.moved !== undefined, 5000);
  assert.ok(before > 100 && r.moved !== undefined, `Back restores ${before} and the reader scrolls (${JSON.stringify(r)})`);
  await page.waitForTimeout(1500); // past every delayed frame and the last restore
  const now = await top(page);
  assert.ok(Math.abs(now - r.moved!) <= 2, `the reader's scroll stays (restored ${r.restored}, the reader scrolled to ${r.moved}, now ${now})`);
});
