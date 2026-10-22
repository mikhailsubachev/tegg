// v0.52 feedback H13 (docs/feedback/ms5-v052.md; search-navigation.md FR-SRC-03 AC-7, D-236, D-519): search results and
// the quick switcher still used the 3B emoji map (`📄`, `◆` for every user type) instead of the type's icon. Written
// from the AC only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { iconsIn, searchFor, sidebarTypeIcon, switcherFor } from './search-icons-helpers';
import { must, startMain } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_v052_fr_src_03_type_icons_in_search', async ({ page }) => {
  await startMain(page);
  const sidebarIcon = await sidebarTypeIcon(page, 'Nápady');
  const result = await iconsIn(await must(await searchFor(page, 'Aplikace', 'Aplikace na čaj'), 'search result "Aplikace na čaj"', 3000));
  assert.deepEqual([result.icons[0] ?? null, result.emoji], [sidebarIcon ?? 'lightbulb', []], 'the search result shows the Nápad icon of the sidebar, no ◆');
  const row = await iconsIn(await must(await switcherFor(page, 'Aplikace', 'Aplikace na čaj'), 'switcher row "Aplikace na čaj"', 3000));
  assert.deepEqual([row.icons[0] ?? null, row.emoji], [sidebarIcon ?? 'lightbulb', []], 'the switcher row shows the same icon, no ◆');
});
