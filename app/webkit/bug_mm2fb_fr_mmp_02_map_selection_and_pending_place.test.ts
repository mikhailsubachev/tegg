// Regressions (L5, WebKit, fake core), owner feedback on MM2 (FR-MMP-02 AC-23…AC-25, R95, D-788, D-795):
// (1) a node focused by a click showed no ring (only `:focus-visible` had one), so the selected node wasn't clear;
// (2) the pending node of ⏎ / Tab was drawn below the anchor's subtree at a fixed place, on top of the next node;
// it must take its own place in the layout, the nodes after it moving down;
// (3) after committing a text edit with ⏎ the node keeps the focus, so the next ⏎ opens a new node;
// (4) a click on the map's empty area put the caret in the note body; it focuses the map's current node (D-798).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { MM, focused, needFigure, needNode, needTree, nodeField, openMm, pendingNode, seen, sleep } from './mindmap-helpers';
import { tokenColour } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

type Rect = { node: string; x: number; y: number; w: number; h: number };
async function rects(fig: Locator): Promise<Rect[]> {
  return fig.locator('[role="treeitem"]').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { node: e.getAttribute('data-node') ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
async function ringOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as HTMLElement);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 ? `${cs.outlineWidth} ${cs.outlineColor}` : 'none';
  });
}

test('bug_mm2fb_fr_mmp_02_a_clicked_node_shows_the_selection_ring', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const accent = await tokenColour(page, 'accent');
  for (const name of ['Plán 2027', 'Program', 'Výjezd 2026']) {
    await (await needNode(fig, name)).click();
    const f = await focused(page);
    assert.equal(f.name, name, `a click focuses ${name} (D-788)`);
    assert.equal(await ringOf(page), `2px ${accent}`, `${name} clicked shows a 2 px accent ring`);
  }
});

test('bug_mm2fb_fr_mmp_02_the_pending_node_covers_no_node', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const bad: string[] = [];
  // ⏎ on a node with a next sibling, on a branch with children, on the root item (first child, D-787); Tab on a branch
  for (const [name, key] of [['Přehled Q4', 'Enter'], ['Program', 'Enter'], ['Místo', 'Enter'], ['Výjezd 2026', 'Enter'], ['Program', 'Tab']] as const) {
    await (await needNode(fig, name)).click();
    await page.keyboard.press(key);
    if (!(await seen(pendingNode(fig), 2000))) { bad.push(`${key} on ${name}: no pending node`); continue; }
    const all = await rects(fig);
    const p = all.find((r) => r.node === 'pending')!;
    for (const r of all) if (r.node !== 'pending' && overlaps(p, r)) bad.push(`${key} on ${name}: the pending node covers ${r.node}`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (overlaps(all[i], all[j])) bad.push(`${key} on ${name}: ${all[i].node} and ${all[j].node} overlap`);
    }
    await page.keyboard.press('Escape');
    if (await seen(pendingNode(fig), 300)) bad.push(`${key} on ${name}: Esc left the pending node`);
  }
  assert.deepEqual(bad, [], 'the pending node has its own place; no two nodes overlap');
});

test('bug_mm2fb_fr_mmp_02_enter_after_a_text_commit_opens_a_new_node', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await (await needNode(fig, 'Plán 2027')).dblclick();
  assert.ok(await seen(nodeField(fig), 2000), 'a double-click opens the field');
  await page.keyboard.type(' v2');
  await page.keyboard.press('Enter');
  await sleep(1500); // past the autosave
  const f = await focused(page);
  assert.deepEqual([f.role, f.name], ['treeitem', 'Plán 2027 v2'], 'the committed node keeps the focus (R95)');
  await page.keyboard.press('Enter');
  assert.ok(await seen(pendingNode(fig), 2000), '⏎ opens a pending sibling');
});

test('bug_mm2fb_fr_mmp_02_a_click_on_the_empty_map_area_focuses_the_current_node', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const empty = async () => {
    // the tree's top-left corner (the map padding) and a point right of every node: no treeitem there
    const box = (await fig.locator('[data-map-area]').first().boundingBox())!;
    for (const [x, y] of [[4, 4], [box.width - 8, 8]] as const) {
      const hit = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[role="treeitem"]'), [box.x + x, box.y + y]);
      assert.equal(hit, false, `setup: (${x}, ${y}) is empty map area`);
      await page.mouse.click(box.x + x, box.y + y);
      const f = await focused(page);
      if (f.role !== 'treeitem') return `${f.role} "${f.name}" after a click at (${x}, ${y})`;
    }
    return (await focused(page)).name;
  };
  assert.equal(await empty(), 'Výjezd 2026', 'with no node chosen the root takes the focus, not the note body');
  await (await needNode(fig, 'Místo')).click();
  assert.equal(await empty(), 'Místo', 'the focused node stays the current one');
  await page.keyboard.press(' ');
  assert.ok(await seen(nodeField(fig), 2000), 'Space opens the field: the map has the keyboard');
  await page.keyboard.type(' x');
  const box = (await fig.locator('[data-map-area]').first().boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  assert.equal(await nodeField(fig).count(), 0, 'a click on the empty area commits the field');
  assert.equal((await focused(page)).name, 'Místo x', 'and the committed node keeps the focus');
});
