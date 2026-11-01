// Issue #107: ⌘↑ was left to WebKit, and ProseMirror undoes a move to the document's start within 200 ms of a focus
// (it takes it for the browser resetting the selection), so ⌘↑ right after the editor got the focus did nothing.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, editorBody, eventually, fileText, must, openLinks, sleep } from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_107_fr_edt_01_cmd_up_right_after_the_focus_goes_to_the_start', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const body = editorBody(page);
  await (await must(body.locator('p').filter({ hasText: /^Znovu/ }), 'paragraph "Znovu …"', 5000)).click({ position: { x: 4, y: 4 } });
  await sleep(400); // the click is more than 300 ms old, as after a slow dialog
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await body.focus();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.type('X');
  const t = await eventually(() => fileText(core, B.rozbite), (x) => (x ?? '').includes('X'), 4000);
  assert.ok((t ?? '').includes('---\nX[[Neexistuje]]'), `X is typed at the start of the note: ${JSON.stringify((t ?? '').split('---\n')[2]?.slice(0, 40))}`);
});
