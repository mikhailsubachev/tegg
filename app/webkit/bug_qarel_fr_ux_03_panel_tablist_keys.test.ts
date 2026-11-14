// D-1754 (slice REL build, QA review): the right panel's tablist (Backlinks, Related, Graph) is one Tab stop, the selected
// tab; ←/→/Home/End move to and select a tab (WAI-ARIA tabs). Not an AC test: it pins the build decision that FR-UX-03
// AC-49 relies on, for all three tabs.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R, ZONE, backlinksTab, eventually, graphTab, linkedSwitch, openRelated, relTab, tabsOf } from './related-helpers';

test.use({ timezoneId: ZONE, locale: 'en-US' });

const tabIndexes = (page: Page) => tabsOf(page).evaluateAll((els) => els.map((e) => [(e.textContent ?? '').trim(), e.getAttribute('tabindex'), e.getAttribute('aria-selected')]));
const focusedTab = (page: Page) => page.evaluate(() => (document.activeElement?.getAttribute('role') === 'tab' ? (document.activeElement.textContent ?? '').trim() : null));

test('bug_qarel_fr_ux_03_panel_tablist_one_tab_stop_and_arrow_keys', async ({ page }) => {
  await openRelated(page, R.rozpocet);
  // Only the selected tab (Related) is a Tab stop.
  const start = await tabIndexes(page);
  assert.deepEqual(start.map(([, ti, sel]) => [ti, sel]), [['-1', 'false'], ['0', 'true'], ['-1', 'false']], `one Tab stop, the selected tab: ${JSON.stringify(start)}`);
  // ⇧Tab from the switch reaches the selected tab.
  await linkedSwitch(page).focus();
  await page.keyboard.press('Shift+Tab');
  assert.match((await focusedTab(page)) ?? '', /Related/, '⇧Tab from the switch lands on the Related tab');
  // ← selects Backlinks, → Related, → Graph; Home and End jump to the ends.
  await page.keyboard.press('ArrowLeft');
  await eventually(() => backlinksTab(page).getAttribute('aria-selected'), (v) => v === 'true', 3000);
  assert.match((await focusedTab(page)) ?? '', /Backlinks/, '← focuses Backlinks');
  await page.keyboard.press('ArrowRight');
  await eventually(() => relTab(page).getAttribute('aria-selected'), (v) => v === 'true', 3000);
  await page.keyboard.press('ArrowRight');
  await eventually(() => graphTab(page).getAttribute('aria-selected'), (v) => v === 'true', 3000);
  assert.match((await focusedTab(page)) ?? '', /Graph/, '→ → focuses Graph');
  await page.keyboard.press('Home');
  await eventually(() => backlinksTab(page).getAttribute('aria-selected'), (v) => v === 'true', 3000);
  await page.keyboard.press('End');
  await eventually(() => graphTab(page).getAttribute('aria-selected'), (v) => v === 'true', 3000);
  const end = await tabIndexes(page);
  assert.deepEqual(end.map(([, ti]) => ti), ['-1', '-1', '0'], `the Tab stop follows the selection: ${JSON.stringify(end)}`);
});
