// Issue #105: `Show next` focused row 51 in a frame callback that can run before React has rendered the new rows; the
// row isn't there yet and the focus stays put (FR-SRC-03 AC-12). The frame callbacks of the click are run at once
// here, which is the order the browser may pick on a busy machine.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { addHromada, countWhen, eventually, focusedRowTitle, must, main, pageVault, startPage, titlesWhen, typeQuery } from './search-page-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_105_fr_src_03_show_next_focuses_row_51_when_the_frame_comes_before_the_render', async ({ page }) => {
  await startPage(page, { vault: pageVault(addHromada) });
  await typeQuery(page, 'ostružiník');
  assert.equal(await countWhen(page, '60 results'), '60 results', '60 results');
  await titlesWhen(page, (t) => t.length === 50);
  const btn = await must(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next 10');
  await btn.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    // The next few frame callbacks run as microtasks, ahead of React's rendering task.
    const raf = window.requestAnimationFrame.bind(window);
    let left = 4;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      if (left-- <= 0) { window.requestAnimationFrame = raf; return raf(cb); }
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
  });
  await btn.click();
  const all = await titlesWhen(page, (t) => t.length === 60);
  assert.equal(await eventually(() => focusedRowTitle(page), (t) => t === all[50], 2000), all[50], 'focus moves to row 51');
});
