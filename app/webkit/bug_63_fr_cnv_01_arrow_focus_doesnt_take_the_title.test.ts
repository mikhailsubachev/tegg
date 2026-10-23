// Bug #63 (FR-CNV-01 AC-7): ↓ on a type focuses that radio in an animation frame; going back to the Title before the
// frame must keep the focus there, so ⏎ converts.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { C, absent, caretAfter, needPopover, openConvert, popover, titleBox, typeGroup } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_63_fr_cnv_01_a_late_arrow_focus_doesnt_take_the_focus_from_the_title', async ({ page }) => {
  await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O');
  await page.keyboard.type('Klávesnicí');
  await (await typeGroup(page).getByRole('radio', { checked: true })).focus();
  // Slow frames: the radio's deferred focus comes after the user is back in the Title.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => raf(cb), 300) as unknown as number;
  });
  await page.keyboard.press('ArrowDown');
  await titleBox(page).focus();
  await page.waitForTimeout(700); // the frame has run; then nothing must have moved the focus
  const at = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'));
  assert.equal(at, 'Title', 'the focus stays in the Title');
  await page.keyboard.press('Enter');
  assert.ok(await absent(popover(page), 3000), '⏎ converts');
});
