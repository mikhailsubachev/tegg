// QA review of PR #50 (FR-CAP-01 AC-14, ms5-capture §4): the pre-warmed capture window follows a theme change made in
// the main window without a reload (`ui:state` from `ui_state_set`).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { eventually, inboxVault, runCommand, startCapture, startMain } from './capture-helpers';

const resolved = (p: import('@playwright/test').Page) => p.evaluate(() => document.documentElement.dataset.theme ?? '');

test('bug_qa50_fr_cap_01_the_capture_window_follows_a_theme_change', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague', colorScheme: 'light' });
  const mainPage = await ctx.newPage();
  const capPage = await ctx.newPage();
  const v = inboxVault();
  await startMain(mainPage, { vault: v });
  await startCapture(capPage, { vault: v });
  const before = await resolved(capPage);
  await runCommand(mainPage, 'Theme: Dark');
  const after = await eventually(() => resolved(capPage), (x) => x !== before && /dark/.test(String(x)), 2000);
  assert.match(String(after), /dark/, `the capture window is dark (was ${before})`);
  await runCommand(mainPage, 'Theme: Light');
  assert.match(String(await eventually(() => resolved(capPage), (x) => /light/.test(String(x)), 2000)), /light/, 'and light again');
  await ctx.close();
});
