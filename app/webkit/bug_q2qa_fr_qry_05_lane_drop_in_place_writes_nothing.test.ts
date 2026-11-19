// Regression (QA review of slice Q2, M1): dropping a board lane on the near half of a neighbour leaves the lane order as
// it is, so it writes nothing (docs/acceptance/views.md R187, FR-QRY-05 AC-19; FR-SYN-06). Before the fix, a drop on the
// right half of the left neighbour moved the lane to the end and wrote `lane_order`.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { Q, board, lane, laneGrip, lanes, must, selectTab, sleep, startViews, tab, typeRoute, viewsVault, writes } from './views-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Drags `from` to a point `fx` of the way across `to` (0 = left edge, 1 = right edge), at its middle height. */
async function dropAcross(page: Page, from: ReturnType<typeof laneGrip>, to: ReturnType<typeof lane>, fx: number) {
  const a = (await (await must(from, 'drag source')).boundingBox())!;
  const b = (await (await must(to, 'drop target')).boundingBox())!;
  const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2;
  const x1 = b.x + b.width * fx, y1 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * i) / 12);
  await page.mouse.up();
  await sleep(400);
}

test('bug_q2qa_fr_qry_05_lane_drop_in_place_writes_nothing', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: viewsVault() });
  await must(tab(page, Q.roz), `tab ${Q.roz}`, 8000);
  await selectTab(page, Q.roz);
  const b = await must(board(page, Q.roz), `the board ${Q.roz}`, 5000);
  const before = (await lanes(b)).map((l) => l.id);
  assert.deepEqual(before.slice(0, 3), ['option:Reading', 'option:To read', 'option:Read'], 'lane_order: [Reading, To read, Read]');
  const n = (await writes(core)).length;
  // `To read` onto the right half of its left neighbour `Reading`: its own place.
  await dropAcross(page, laneGrip(b, 'option:To read'), lane(b, 'option:Reading'), 0.85);
  // `Reading` onto the left half of its right neighbour `To read`: its own place too.
  await dropAcross(page, laneGrip(b, 'option:Reading'), lane(b, 'option:To read'), 0.15);
  assert.equal((await writes(core)).length, n, 'a drop at the lane\'s own place writes nothing');
  assert.deepEqual((await lanes(b)).map((l) => l.id), before, 'the lanes keep their order');
});
