// Bug #102 (FR-EMB-02 AC-9; regression of #59): after Back the note restores its scroll position again once the
// embeds have their height, for up to 600 ms. A reader who scrolls in that time must keep their position: the late
// restores moved the page back under the pointer, so a double-click's second click landed on another embed and an
// open preview closed.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, eventually, main, mustBeOn, needEmbeds, needTop, openEmbeds, ui as embedsUi } from './embeds-helpers';
import { setPreviewMode } from '../ui/test/fake-core';

test.use({ timezoneId: 'Europe/Prague' });

const top = (page: Page) => page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);

// Quarantined (@flaky, test-strategy §8.4, #112): failed once in the v0.122 fix gate under load; not caused by that change.
test('bug_102_fr_emb_02_a_scroll_right_after_back_stays', { tag: ['@flaky'] }, async ({ page }) => {
  await openEmbeds(page, M.rezimy, setPreviewMode('off', { uiState: embedsUi() }));
  await needEmbeds(main(page), 12, 'the host note');
  await (await needTop(main(page), 4, 'Saturnin link-mode embed')).click();
  await mustBeOn(page, 'Saturnin', 'a click on the link-mode embed opens Saturnin');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Režimy', 'Back');
  await needEmbeds(main(page), 12, 'the host note after Back');
  const restored = await top(page);
  assert.ok(restored > 100, `Back restores a scroll position below the top (${restored})`);
  // The reader scrolls up at once, while the restore after the embeds can still run.
  const box = await main(page).first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -300);
  const moved = await eventually(() => top(page), (y) => Math.abs(y - restored) > 50, 2000);
  assert.ok(Math.abs(moved - restored) > 50, `the wheel scrolls the note (${restored} → ${moved})`);
  await page.waitForTimeout(900); // past the last restore (600 ms after the embeds)
  const now = await top(page);
  assert.ok(Math.abs(now - restored) > 50, `the reader's scroll stays (restored ${restored}, the wheel took it to ${moved}, now ${now})`);
});
