// Regression (slice OL's real-app run on 357fa81, L6 `fr_ux_08_ac21_outline_voiceover`; FR-UX-08 AC-21, contract
// v1-outline §9): macOS doesn't map `aria-current` to anything Appium or VoiceOver reads as current, so the current row
// was reported as neither selected nor current. The current row also carries `aria-selected="true"` (AXSelected, which
// the contract allows); no other row does.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, cardTree, eventually, jumpVia, noteRoute, openCardByHover, outlineRows, startOutline } from './outline-helpers';

test('bug_l6ol_fr_ux_08_ac21_the_current_card_row_is_selected', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length > 0);
  await jumpVia(page, 'Den 1');
  await page.waitForTimeout(200);
  await openCardByHover(page);
  const rows = await eventually(
    () => cardTree(page).getByRole('treeitem').evaluateAll((els) => els.map((e) => ({ name: e.getAttribute('aria-label'), current: e.getAttribute('aria-current'), selected: e.getAttribute('aria-selected') }))),
    (r) => r.some((x) => x.current === 'location'),
  );
  const current = rows.filter((r) => r.current === 'location');
  assert.deepEqual(current.map((r) => r.name), ['Den 1'], 'setup: Den 1 is the current row');
  assert.equal(current[0].selected, 'true', 'the current row has aria-selected="true"');
  assert.deepEqual(rows.filter((r) => r.selected === 'true').map((r) => r.name), ['Den 1'], 'no other row is selected');
});
