// Regression (slice MM, FR-MMP-02 AC-15, D-770): Space or ⏎ on a map node while the mindmap block was selected
// reached the editor pane's block keys, which replaced the selected block: the whole mindmap was deleted (T1).
// A key on a node is the node's own action only; the file stays unchanged. Slice MM2 (D-787, D-795): ⏎ opens a
// pending sibling and Space the node's text field; Esc cancels both, nothing is written.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { MM, click, fieldState, fileText, listBtn, mapBtn, needFigure, needNode, noModified, openMm, original, sleep, viewOf, viewWhen, writes } from './mindmap-helpers';

for (const key of [' ', 'Enter']) {
  test(`bug_mm_fr_mmp_02_${key === ' ' ? 'space' : 'enter'}_on_a_node_of_a_selected_mindmap_writes_nothing`, async ({ page }) => {
    const core = await openMm(page, MM.vyjezd);
    let fig = await needFigure(page, 'Výjezd 2026');
    await (await needNode(fig, 'Program')).focus();
    await click(listBtn(fig), 'List');
    assert.equal(await viewWhen(fig, 'list'), 'list', 'List');
    await page.keyboard.press('Escape'); // Esc in the list (FR-EDT-13: the block may become selected)
    await click(mapBtn(fig), 'Map');
    fig = await needFigure(page, 'Výjezd 2026');
    await (await needNode(fig, 'Program')).focus();
    await page.keyboard.press(key);
    assert.equal(await viewOf(fig), 'map', 'the key on Program is the node\'s own action, the view stays Map (D-787)');
    assert.ok((await fieldState(fig))?.focused, 'the field is open (⏎: a pending sibling; Space: the node\'s text)');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('figure', { name: /Výjezd 2026/ }).count(), 1, 'the mindmap block is still there');
    await sleep(1500);
    assert.deepEqual((await writes(core, MM.vyjezd)).length, 0, 'nothing written');
    assert.equal(noModified((await fileText(core, MM.vyjezd)) ?? original(MM.vyjezd)), noModified(original(MM.vyjezd)), 'the file is unchanged');
  });
}
