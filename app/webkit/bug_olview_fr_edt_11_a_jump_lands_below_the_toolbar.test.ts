// Regression (slice OL, owner preview report: "click in outline jumps just below the H and highlight is not in the
// view-port (it is above it)"; D-1609, D-1673): the note toolbar is sticky at the top of the centre pane's scroller, so
// a heading put 24 px below the scroller's top was behind the toolbar. The viewport's top is the toolbar's bottom: the
// jumped-to heading and its highlight are seen, 24 px below the toolbar.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, eventually, headingEl, must, noteRoute, outlineTree, row, setScroll, startOutline, tabRows } from './outline-helpers';

test('bug_olview_fr_edt_11_a_jump_lands_below_the_toolbar', async ({ page }) => {
  await startOutline(page, noteRoute(P.cten));
  await must(outlineTree(page), 'Čtenářské: tree "Outline"');
  await eventually(() => tabRows(page), (r) => r.length > 0);
  await setScroll(page, 0);
  await (await must(row(page, 'Zpoždění replikace'), 'row Zpoždění replikace')).click();
  await page.waitForTimeout(150);
  const heading = await must(headingEl(page, 'Zpoždění replikace'), 'the heading');
  const g = await heading.first().evaluate((h) => {
    const bar = document.querySelector('main .note-toolbar') as HTMLElement | null;
    const r = h.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
    return { top: r.top, barBottom: bar ? bar.getBoundingClientRect().bottom : null, seen: !!hit && h.contains(hit) };
  });
  assert.ok(g.barBottom !== null, 'setup: the note toolbar is shown');
  assert.ok(g.seen, `the heading is not covered by the toolbar (heading top ${g.top}, toolbar bottom ${g.barBottom})`);
  assert.ok(Math.abs(g.top - g.barBottom! - 24) <= 2, `the heading's top is 24 ± 2 px below the toolbar's bottom (${g.top - g.barBottom!})`);
});
