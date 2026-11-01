// QA review of the G2 build (the local graph in the right panel; docs/contracts/v1-graph.md §15): regression tests.
// 1 (major): the panel never draws the previous centre's graph beside another note (FR-GRP-01 AC-30, T2): after a
//    navigation, a `CentreNotFound` answer must not follow the previous centre's object id.
// 2 (minor): the centre trashed while a neighbour is previewed closes the preview and clears the selection
//    (FR-GRP-06 AC-8, D-1041).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { anyPreviewDialog, mustPreview } from './helpers';
import { P, clickNode, drawn, drawnKeys, eventually, mainName, must, nfc, sleep, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, openPanel, panelText, searchOpen, stepOverSearch } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

const keysIn = (page: Page) => drawnKeys(page, GP(page));

test('bug_qag2_fr_grp_01_panel_never_shows_the_previous_centre', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  assert.equal((await waitDrawn(page, 10, 3000, GP(page))).length, 10, 'Plán: 10 nodes');
  await searchOpen(page, 'Rozpočet 2027');
  assert.equal((await waitDrawn(page, 7, 3000, GP(page))).length, 7, 'Rozpočet: 7 nodes');
  await stepOverSearch(page, 'back'); // D-1348: over the Search entry Rozpočet was opened from
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on Plán');
  await waitDrawn(page, 10, 3000, GP(page));
  // Another program deletes Rozpočet outright (no trash); Plán's panel follows (9 nodes).
  await core.setFile(P.rozpocet, null);
  assert.equal((await waitDrawn(page, 9, 3000, GP(page))).length, 9, 'Plán without Rozpočet');
  await stepOverSearch(page, 'forward');
  // Rozpočet's page: its graph is gone, and Plán's graph must never be drawn there.
  const seenPlan: string[] = [];
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    const k = await keysIn(page);
    if (k.includes(nfc(P.plan))) seenPlan.push(k.join('|'));
    await sleep(25);
  }
  assert.deepEqual(seenPlan, [], 'the panel on Rozpočet never draws Plán\'s graph');
  await must(GP(page).getByText('This object was deleted', { exact: true }), 'the Deleted state', 2000);
  assert.ok((await panelText(page)).includes('“Rozpočet 2027” no longer exists'), `the gone line names Rozpočet: ${await panelText(page)}`);
});

test('bug_qag2_fr_grp_06_centre_trashed_while_a_neighbour_is_previewed', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitDrawn(page, 10, 3000, GP(page));
  await clickNode(page, P.rozpocet, {}, GP(page));
  await mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
  await core.renameFile(P.plan, `.trash/${P.plan}`);
  await must(GP(page).getByText('This object was deleted', { exact: true }), 'the Deleted state', 2000);
  // At once with the Deleted state: the preview of a node that is gone closes (D-1041).
  assert.equal(await anyPreviewDialog(page).count(), 0, 'the preview closed with the Deleted state');
  assert.deepEqual((await drawn(page, GP(page))).filter((n) => n.selected), [], 'nothing selected');
  // Restored: the graph comes back with nothing selected and no preview.
  await core.renameFile(`.trash/${P.plan}`, P.plan);
  assert.equal((await waitDrawn(page, 10, 3000, GP(page))).length, 10, 'restored: 10 nodes');
  assert.deepEqual((await drawn(page, GP(page))).filter((n) => n.selected), [], 'still nothing selected');
  assert.equal(await anyPreviewDialog(page).count(), 0, 'no preview');
});
