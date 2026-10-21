// v0.52 feedback, L5 (WebKit + fake core): type icons in search results and quick switcher rows.
// docs/acceptance/search-navigation.md FR-SRC-03 AC-7 (D-236, D-519; regression
// `bug_v052_fr_src_03_type_icons_in_search`): the result's type icon as an SVG (`data-icon` = the type's icon), the same
// as the sidebar row of that type; no emoji glyphs. Fixture: the inbox vault (Nápad: `icon: lightbulb`; Page:
// `file-text`). Written from the AC only (D-61). Every lookup goes through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { iconsIn, searchFor, sidebarTypeIcon, switcherFor } from './search-icons-helpers';
import { must, startMain } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('fr_src_03_ac7_search_results_show_the_type_icon', async ({ page }) => {
  await startMain(page);
  const napadSidebar = await sidebarTypeIcon(page, 'Nápady');
  assert.equal(napadSidebar, 'lightbulb', 'setup: the sidebar row of Nápady shows the lightbulb');
  for (const [query, title, icon] of [['Aplikace', 'Aplikace na čaj', 'lightbulb'], ['webu', 'Plán webu', 'file-text']] as const) {
    const row = await must(await searchFor(page, query, title), `search result "${title}"`, 3000);
    const r = await iconsIn(row);
    assert.equal(r.icons[0] ?? null, icon, `${title}: the type icon as an SVG with data-icon="${icon}" (icons: ${r.icons.join(', ')})`);
    assert.deepEqual(r.emoji, [], `${title}: no emoji glyphs`);
  }
});

test('fr_src_03_ac7_switcher_rows_show_the_type_icon', async ({ page }) => {
  await startMain(page);
  for (const [query, title, icon] of [['Aplikace', 'Aplikace na čaj', 'lightbulb'], ['Plán webu', 'Plán webu', 'file-text']] as const) {
    const row = await must(await switcherFor(page, query, title), `switcher row "${title}"`, 3000);
    const r = await iconsIn(row);
    assert.equal(r.icons[0] ?? null, icon, `${title}: the switcher row shows data-icon="${icon}" (icons: ${r.icons.join(', ')})`);
    assert.deepEqual(r.emoji, [], `${title}: no emoji glyphs`);
    await page.keyboard.press('Escape');
  }
});
