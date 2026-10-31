// QA review of slice "G3 in the panel" (FR-GRP-01 AC-45, D-1143; docs/contracts/v1-graph.md §17.4): `In full graph` in
// a hover preview hands over the panel's current centre and depth. The panel stays mounted across navigation and depth
// changes, so a hover callback made at mount must not keep the first render's centre or depth.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustPreview } from './helpers';
import { P, click, clickNode, depthBtn, drawn, eventually, graphHeading, mainName, must, nfc, pressed, routeReady, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, chooseDepth, closePopover, openPanel, pHoverRing, pPointAt } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

async function inFullGraphFromHover(page: Page, k: string, title: string) {
  await page.mouse.move(5, 5);
  await pPointAt(page, k);
  await must(pHoverRing(page), `the ring on ${title}`, 1500);
  const d = await mustPreview(page, title, 'the hover popover', 2000);
  const btn = await must(d.getByRole('button', { name: 'In full graph', exact: true }), '`In full graph`');
  const bb = (await btn.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await click(btn, '`In full graph`');
}

test('bug_qag3p_fr_grp_01_hover_in_full_graph_after_navigation_opens_the_current_centre', async ({ page }) => {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 200, realTime: true });
  assert.equal((await waitDrawn(page, 10, 4000, GP(page))).length, 10, 'Plán in the panel (setup)');
  // Hover and Off: a click on a node opens it (FR-LNK-12 AC-17); the panel follows the page (FR-GRP-01 AC-30).
  await clickNode(page, P.rozpocet, {}, GP(page));
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', 'Rozpočet opened (setup)');
  await eventually(() => drawn(page, GP(page)), (d) => d.some((n) => n.key === nfc(P.rozpocet) && n.depth === 0), 4000);
  await inFullGraphFromHover(page, P.plan, 'Plán čtvrtletí');
  assert.ok(await routeReady(core, `graph/${nfc(P.rozpocet)}`, 5000), 'the full view of Rozpočet, the current centre (not Plán)');
  await must(graphHeading(page), 'the full view', 4000);
  assert.deepEqual(await eventually(async () => (await drawn(page)).filter((n) => n.selected).map((n) => n.key), (s) => s.length > 0, 3000), [nfc(P.plan)], 'with Plán selected');
});

test('bug_qag3p_fr_grp_01_hover_in_full_graph_after_depth_change_hands_over_the_current_depth', async ({ page }) => {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 200, realTime: true, panel: { depth: 1 }, full: { depth: 1 } });
  assert.equal((await waitDrawn(page, 10, 4000, GP(page))).length, 10, 'Plán at depth 1 (setup)');
  await chooseDepth(page, 2, 19);
  await closePopover(page);
  await inFullGraphFromHover(page, P.rozpocet, 'Rozpočet 2027');
  assert.ok(await routeReady(core, `graph/${nfc(P.plan)}`, 5000), 'the full view of Plán');
  await must(graphHeading(page), 'the full view', 4000);
  assert.equal(await eventually(() => pressed(depthBtn(page, 2)), (v) => v === 'true', 3000), 'true', '`2` pressed: the panel\'s current depth (not 1)');
});
