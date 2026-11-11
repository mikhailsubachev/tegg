// Preview v0.123 feedback (FR-QRY-06 AC-1, board QueriesAll): on the Queries page the name chips and the dates sat at
// the top of their rows (the shared table style aligns cells to the top), and the sorted header showed two arrows
// (the text's own and the shared table's `::after`).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { gotoQueries, startQueries } from './queries-helpers';

test('bug_v0123_fr_qry_06_queries_rows_are_centred_and_the_header_has_one_arrow', async ({ page }) => {
  await startQueries(page, { route: 'inbox' });
  await gotoQueries(page);
  const row = page.locator('main table tbody tr').first();
  await row.waitFor();
  const off = await row.evaluate((tr) => {
    const mid = (e: Element) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
    const cells = [...tr.querySelectorAll('td')].slice(0, 3);
    return cells.map((td) => Math.abs(mid(td.firstElementChild ?? td) - mid(td)));
  });
  for (const [i, d] of off.entries()) assert.ok(d <= 1.5, `cell ${i + 1}: its content is centred in the row (off by ${d.toFixed(1)} px)`);
  const arrows = await page.locator('main table thead th[aria-sort="descending"], main table thead th[aria-sort="ascending"]').first().evaluate((th) =>
    ((th.textContent ?? '') + getComputedStyle(th, '::after').content.replace(/^"|"$|none|normal/g, '')).replace(/[^↑↓]/g, '').length);
  assert.equal(arrows, 1, 'the sorted header shows one arrow');
});
