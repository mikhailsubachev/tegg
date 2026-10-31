// v0.94 red tests (AP-1018 a = D-1189 a): in click mode a click on a strip chip in the graph's `Preview` column
// (Rozpočet's `Jana Nováková`) did nothing: the strip's relation chips weren't references, so they neither replaced the
// content (D-932) nor opened. The same click must replace the column's content with Jana's preview and `Back to Rozpočet
// 2027` (FR-GRP-06 AC-12, FR-LNK-11 AC-10), and a double-click opens Jana. Click mode stored (D-1164's test rule).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, callsOf, clickNode, must, nfc, openGraph, previewCol, waitDrawn } from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const shown = (page: import('@playwright/test').Page, path: string) => previewCol(page).locator(`[data-preview-path="${nfc(path)}"]`);

test('bug_v094gp_fr_grp_06_a_strip_chip_in_the_column_replaces_the_content', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  await clickNode(page, P.rozpocet);
  const prev = await must(shown(page, P.rozpocet), 'Rozpočet\'s preview in the column');
  await (await must(prev.getByRole('link', { name: 'Jana Nováková', exact: true }), 'the strip chip Jana Nováková')).click();
  await must(shown(page, P.jana), 'a click on the strip chip replaces the column\'s content with Jana\'s preview (D-932)');
  await must(previewCol(page).getByRole('button', { name: 'Back to Rozpočet 2027', exact: true }), 'with Back to Rozpočet 2027');
  assert.equal((await callsOf(core, 'nav_opened')).length, 0, 'and opens nothing');
});
