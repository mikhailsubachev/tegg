// Regression (slice OL, FR-EDT-16 AC-11 flaky under the gate's load): closing the card (Esc, ⌘J) puts the focus back in
// the note and restores its scroll, once at once and once more on the next frame. A scroll made before that frame (the
// user's, or a test's `setScroll`) was undone by the late restore, so ⌘J then focused the old section's row.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, card, editorBody, must, noteRoute, placeCaret, rail, scrollHeadingTo, startOutline } from './outline-helpers';

test('bug_olgate_fr_edt_16_a_scroll_right_after_escape_is_kept', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  await placeCaret(await must(editorBody(page).locator('p').nth(1), 'the Cíle paragraph'), 4);
  await scrollHeadingTo(page, 'Den 1', 4);
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  // Esc and a scroll to the top in the same task, before the next frame; then two frames.
  const top = await page.evaluate(async () => {
    const m = document.querySelector('main') as HTMLElement;
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    m.scrollTop = 0;
    m.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return m.scrollTop;
  });
  assert.equal(await card(page).count(), 0, 'setup: Esc closed the card');
  assert.equal(top, 0, 'the scroll made after Esc is kept');
});
