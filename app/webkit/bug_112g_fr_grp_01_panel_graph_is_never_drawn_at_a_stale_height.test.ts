// Bug #112 (FR-GRP-01 AC-41, AC-38; R114: the canvas is the rest of the tab): the panel's footer shows only beside a
// graph, so the canvas is 26 px taller in the Loading state (and every other state without a footer). When the graph
// came back (after a rename job, a slow answer), it was drawn once at the taller canvas's centre and jumped 13 px up
// when the new height was measured a frame later: every node moved although the layout is kept. That frame is what
// `fr_grp_01_ac41_panel_follows_renames` sometimes read.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { commit, typeTitle } from './rename-helpers';
import { eventually, must, nodeAt, waitDrawn } from './graph-helpers';
import { GP, P, VIEWPORT, chooseDepth, openPanel } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

/** From now on, records the centre node's vertical centre after every DOM change in which it is drawn. */
async function watchCentre(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __centreY: number[] };
    w.__centreY = [];
    const sample = () => {
      const c = document.querySelector('[role="tabpanel"] [data-graph-node][data-depth="0"] circle');
      if (!c) return;
      const r = c.getBoundingClientRect();
      const y = Math.round((r.top + r.height / 2) * 10) / 10;
      if (w.__centreY.at(-1) !== y) w.__centreY.push(y);
    };
    sample();
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}
const centreYs = (page: Page) => page.evaluate(() => (window as unknown as { __centreY: number[] }).__centreY);
const loading = (page: Page) => GP(page).getByRole('status').filter({ hasText: 'Loading…' });

test('bug_112g_fr_grp_01_the_graph_after_a_rename_is_drawn_where_it_was', async ({ page }) => {
  await openPanel(page, P.plan, { realTime: true });
  assert.equal((await waitDrawn(page, 10, 3000, GP(page))).length, 10, 'Plán\'s 10 nodes');
  await watchCentre(page);
  await typeTitle(page, 'Plán Q4');
  await commit(page, 'enter');
  const name = await eventually(async () => (await nodeAt(page, 'Pages/Plán Q4.md', GP(page)).getAttribute('aria-label', { timeout: 200 }).catch(() => null)) ?? '', (n) => n.startsWith('Plán Q4'), 3000);
  assert.equal(name, 'Plán Q4, Page', 'the centre is relabelled');
  await page.waitForTimeout(300);
  const ys = await centreYs(page);
  assert.equal(ys.length, 1, `the centre node is drawn at one place before, during and after the rename (its y over time: ${JSON.stringify(ys)})`);
});

test('bug_112g_fr_grp_01_the_graph_after_loading_is_drawn_at_the_canvas_centre', async ({ page }) => {
  const core = await openPanel(page, P.plan, { realTime: true });
  assert.equal((await waitDrawn(page, 10, 3000, GP(page))).length, 10, 'Plán\'s 10 nodes');
  await watchCentre(page);
  await core.graphDelay(800);
  await chooseDepth(page, 2);
  await page.keyboard.press('Escape');
  await must(loading(page), 'Loading (the answer takes 800 ms)', 1500);
  assert.equal((await waitDrawn(page, 19, 4000, GP(page))).length, 19, 'depth 2: 19 nodes');
  await page.waitForTimeout(300);
  const ys = await centreYs(page);
  assert.equal(ys.length, 1, `the centre node stays at the canvas's centre (its y over time: ${JSON.stringify(ys)})`);
});
