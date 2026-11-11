// Issue #112 (found in the flake hunt): at start the app asked `index_tags` 7 times, once per surface that shows tags
// plus the shell, each before the first answer. On a large vault every answer is a full tag scan (NFR-PERF; D-784 made
// All tags one read for the same reason). The first load is one read, shared by every surface.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { start } from './helpers';

test('bug_112h_the_tag_list_is_read_once_at_start', async ({ page }) => {
  const core = await start(page);
  await page.waitForTimeout(1500);
  const n = (await core.calls()).filter((c) => c.cmd === 'index_tags').length;
  assert.equal(n, 1, `index_tags is asked once at start (got ${n})`);
});
