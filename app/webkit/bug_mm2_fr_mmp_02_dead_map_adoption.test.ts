// Regression (slice MM2, QA review of PR #76; FR-MMP-02, D-786, mm-mindmap §6.7): a re-created mindmap block adopted the
// previous view registered at its block index even when that view had been destroyed in an earlier task and its React
// root unmounted, so the block drew an empty map and every later update threw ("Cannot update an unmounted root").
// Flow: `Turn into › Bulleted list` on a mindmap (W6) and ⌘Z: the callout node comes back at the same index.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { MM, click, fileWhen, focused, listBtn, mapBtn, mustCaret, needFigure, needNode, noModified, openMm, original, seen, swap, treeNames, turnInto } from './mindmap-helpers';

test('bug_mm2_fr_mmp_02_unwrap_then_undo_draws_the_map_again_without_errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const core = await openMm(page, MM.rozbaleni);
  const fig = await needFigure(page, 'Titulek mapy');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: 'Kořen' }).first(), 'Kořen', 'caret in the list');
  await turnInto(page, 'Bulleted list');
  const w6 = swap(original(MM.rozbaleni), '> [!mindmap] Titulek mapy\n> * Kořen\n>     * Větev', 'Titulek mapy\n\n* Kořen\n    * Větev');
  assert.equal(noModified(await fileWhen(core, MM.rozbaleni, (x) => noModified(x) === noModified(w6), 4000)), noModified(w6), 'W6 saved (the mindmap view is gone)');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await fileWhen(core, MM.rozbaleni, (x) => noModified(x) === noModified(original(MM.rozbaleni)), 4000)), noModified(original(MM.rozbaleni)), '⌘Z restores the mindmap');
  const back = await needFigure(page, 'Titulek mapy');
  assert.ok(await seen(back.getByRole('tree'), 3000), 'the re-created block draws its map');
  await click(mapBtn(back), 'Map');
  assert.deepEqual(await treeNames(back), ['Kořen', 'Větev'], 'the tree has its nodes');
  await (await needNode(back, 'Kořen')).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, 'Větev', '↓ moves: the map responds');
  await page.keyboard.press(' ');
  await page.keyboard.type(' x');
  await page.keyboard.press('Enter');
  // D-766: the edited block is rewritten in canonical form (`-`, two-space indents).
  const edited = original(MM.rozbaleni).replace('> * Kořen\n>     * Větev', '> - Kořen\n>   - Větev x');
  assert.equal(noModified(await fileWhen(core, MM.rozbaleni, (x) => noModified(x) === noModified(edited), 4000)), noModified(edited), 'an edit on the re-created map writes');
  assert.deepEqual(errors, [], 'no page errors');
});
