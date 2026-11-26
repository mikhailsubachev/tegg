// Issue #175: two `note.toggleSource` runs in quick succession left the note in the Markdown source. The toggle
// saves first (FR-EDT-10 AC-9) and only then shows the source; a second toggle that came while that save was on its
// way still read "formatted" and showed the source too, so the pair ended in the source instead of the formatted note.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, editorBody, eventually, must, openLinks, sleep, sourceRegion } from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_175_fr_edt_10_two_quick_source_toggles_end_in_the_formatted_note', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const body = editorBody(page);
  await (await must(body.locator('p').filter({ hasText: /^Znovu/ }), 'paragraph "Znovu …"', 5000)).click();
  await page.keyboard.type('X');
  // the save the first toggle waits for takes a while, as on a slow disk
  await core.writeControl({ delayMs: 800 });
  await page.keyboard.press('Alt+Meta+KeyU');
  await sleep(50);
  await page.keyboard.press('Alt+Meta+KeyU');
  await sleep(1500);
  assert.equal(await sourceRegion(page).count(), 0, 'no Markdown source after two toggles');
  assert.ok(await eventually(() => body.count(), (n) => n === 1, 2000), 'the formatted note is shown');
  await core.writeControl({ delayMs: 0 });
});
