// QA review of slice G3 (R122, FR-UX-03 AC-30; docs/contracts/v1-graph.md §16.3): when a pointer click on a twisty
// collapses the row above the List view's roving tab stop, the tab stop moves to its nearest visible ancestor instead
// of staying on a hidden row (the tree would have no reachable tab stop).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, click, listTree, must, openGraph, viewBtn } from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

test('bug_qag3_fr_ux_03_collapsing_the_parent_moves_the_tab_stop_to_it', async ({ page }) => {
  await openGraph(page, P.plan);
  await click(viewBtn(page, 'List'), '`List`');
  const tree = await must(listTree(page), 'the List view');
  const items = tree.locator('[role="treeitem"]');
  await items.first().focus();
  await page.keyboard.press('ArrowDown');
  const child = await page.evaluate(() => document.activeElement?.getAttribute('data-graph-row') ?? null);
  const centre = await items.first().getAttribute('data-graph-row');
  assert.ok(child && child !== centre, `ArrowDown moved the focus to a child row (${child})`);
  // A click on the centre's twisty collapses it. Dispatched without a press, so the focus doesn't move to the centre
  // first (as when the press doesn't focus the row, or the focus already left the tree with no related target): the
  // focused child is hidden while it still holds the tab stop.
  await items.first().locator(':scope > .graph-row > .graph-row-twisty').first().dispatchEvent('click');
  assert.equal(await items.first().getAttribute('aria-expanded'), 'false', 'the centre is collapsed');
  const stops = await tree.evaluate((t) => [...t.querySelectorAll('[role="treeitem"][tabindex="0"]')].map((e) => ({ key: e.getAttribute('data-graph-row'), shown: (e as HTMLElement).checkVisibility() })));
  assert.deepEqual(stops, [{ key: centre, shown: true }], 'one tab stop, on the visible centre row');
});
