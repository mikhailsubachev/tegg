// Bug v0.68 F6 (docs/feedback/ms6-v068.md): the tag page and All tags were never styled to the `TagPage` / `TagsAll`
// boards (bare `#` glyph instead of the 48 px tile, centred header, title and task suffix running together).
// Regression for docs/acceptance/tags.md FR-TAG-06 AC-13 (named `bug_v068_fr_tag_06_tag_page_layout` there; the test
// titles also carry the AC key fr_tag_06_ac13 for coverage). 1440 × 900, light and dark. Written from the AC only
// (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { tokenColour } from './read-helpers';
import {
  P, allTagsHeading, breadcrumb, colourTile, filterBox, groupingBtn, main, must, newTagBtn, objectsTable, openAllTags, openTagPage, pageSortBtn, rowEl,
  tagActionsBtn, tagHeading, typeFilterBtn,
} from './tags-helpers';
import { rectOf, type Rect } from './v068-helpers';

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

/** Rects of the text runs of a cell: the icon, the title text and the text after it (the suffix), with its colour. */
async function titleCell(row: Locator, title: string) {
  return row.evaluate((r, t) => {
    const cell = (r.querySelector('[role="rowheader"], [role="cell"], [role="gridcell"], td') as HTMLElement | null) ?? (r as HTMLElement);
    const icon = cell.querySelector('svg')?.getBoundingClientRect() ?? null;
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').trim()) texts.push(n as Text);
    const at = texts.findIndex((n) => (n.textContent ?? '').trim().normalize('NFC') === t);
    const rect = (n: Text | undefined) => { if (!n) return null; const g = document.createRange(); g.selectNodeContents(n); const b = g.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const after = texts.slice(at + 1);
    return {
      icon: icon ? { left: icon.left, right: icon.right } : null,
      title: rect(texts[at]),
      suffix: rect(after[0]),
      suffixColours: after.map((n) => getComputedStyle(n.parentElement!).color),
      suffixText: after.map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim(),
    };
  }, title);
}

async function checkTagPage(page: Page, theme: string) {
  const how = (s: string) => `${theme}: ${s}`;
  const tile = await rectOf(colourTile(page), how('button "Tag colour"'));
  const head = await rectOf(tagHeading(page, 'Účty'), how('heading Účty'));
  const count = await rectOf(main(page).getByText('6 objects of 4 types', { exact: true }), how('the count line'));
  const actions = await rectOf(tagActionsBtn(page), how('Tag actions'));
  const bc = await rectOf(breadcrumb(page), how('breadcrumb'));
  const table = await rectOf(objectsTable(page, 'Účty'), how('the table'));
  assert.ok(near(tile.width, 48) && near(tile.height, 48), how(`the tile is 48 × 48 (${tile.width} × ${tile.height})`));
  assert.ok(tile.right <= head.left + 0.5 && head.left - tile.right <= 32, how(`the heading is next to the tile, on its right (${tile.right} → ${head.left})`));
  assert.ok(Math.abs(head.top - tile.top) <= 6, how(`the tile is top-aligned with the heading (${tile.top} / ${head.top})`));
  const hs = await tagHeading(page, 'Účty').evaluate((e) => { const s = getComputedStyle(e); return { size: s.fontSize, weight: Number(s.fontWeight), align: s.textAlign }; });
  assert.ok(hs.size === '30px' && hs.weight >= 700, how(`heading 30 px bold (${JSON.stringify(hs)})`));
  assert.ok(hs.align !== 'center', how('the heading is not centred'));
  assert.ok(count.top >= head.bottom - 1 && near(count.left, head.left, 2), how(`the count line is below the heading, left-aligned with it (${JSON.stringify({ head, count })})`));
  assert.ok(near(actions.width, 36) && near(actions.height, 36), how(`Tag actions is 36 × 36 (${actions.width} × ${actions.height})`));
  assert.ok(actions.right >= table.right - 8 && actions.top < tile.bottom && actions.bottom > tile.top, how(`Tag actions at the right end of the header row (${JSON.stringify({ actions, table })})`));
  assert.ok(bc.bottom <= tile.top + 0.5 && near(bc.left, tile.left, 2), how(`the breadcrumb is above the header, left-aligned with the tile (${JSON.stringify({ bc, tile })})`));
  // The toolbar: one right-aligned row under the header, with a bottom border.
  const parts: Rect[] = [];
  for (const [l, n] of [[filterBox(page), 'Filter…'], [typeFilterBtn(page), 'Type'], [pageSortBtn(page), 'sort'], [groupingBtn(page), 'grouping']] as const) parts.push(await rectOf(l, how(n)));
  const mid = (r: Rect) => r.top + r.height / 2;
  assert.ok(parts.every((r) => Math.abs(mid(r) - mid(parts[0])) <= 4), how('filter, Type, sort and grouping are one row'));
  assert.ok(parts.every((r) => r.top >= tile.bottom - 0.5), how('the toolbar is under the header'));
  const bar = await filterBox(page).first().evaluate((e) => {
    let p: HTMLElement | null = e.parentElement;
    const grp = document.querySelector('[aria-label^="No grouping"], [aria-label^="Grouped by type"]');
    while (p && grp && !p.contains(grp)) p = p.parentElement;
    if (!p) return null;
    const s = getComputedStyle(p); const r = p.getBoundingClientRect();
    return { border: `${s.borderBottomWidth} ${s.borderBottomStyle}`, left: r.left, right: r.right, width: r.width };
  });
  assert.ok(bar && bar.border !== '0px none' && !bar.border.endsWith('none'), how(`the toolbar row has a bottom border (${bar?.border})`));
  const leftMost = Math.min(...parts.map((r) => r.left));
  const rightMost = Math.max(...parts.map((r) => r.right));
  assert.ok(bar && leftMost > bar.left + bar.width * 0.25 && rightMost >= bar.right - 24, how(`the toolbar is right-aligned (${leftMost}…${rightMost} in ${bar?.left}…${bar?.right})`));
  // Title cells: icon, title and suffix apart; the suffix muted except an overdue date.
  for (const [path, title] of [[P.najem, 'Zaplatit nájem'], [P.banka, 'Zavolat bance']] as const) {
    const c = await titleCell(rowEl(page, 'Účty', path), title);
    assert.ok(c.title && c.icon && c.suffix, how(`${title}: icon, title and suffix found (${JSON.stringify(c)})`));
    assert.ok(c.title!.left - c.icon!.right >= 6, how(`${title}: ≥ 6 px between the icon and the title (${c.title!.left - c.icon!.right})`));
    const sameLine = Math.abs(c.suffix!.top - c.title!.top) < 4;
    assert.ok(!sameLine || c.suffix!.left - c.title!.right >= 6, how(`${title}: ≥ 6 px between the title and "${c.suffixText}" (${c.suffix!.left - c.title!.right})`));
  }
  const muted = await tokenColour(page, 'muted');
  const najem = await titleCell(rowEl(page, 'Účty', P.najem), 'Zaplatit nájem');
  assert.ok(najem.suffixColours.length > 0 && najem.suffixColours.every((c) => c === muted), how(`Zaplatit nájem's suffix is muted (${najem.suffixColours.join(', ')} vs ${muted})`));
  const chip = rowEl(page, 'Účty', P.rozpocet).getByRole('link', { name: '#finance', exact: true });
  const pill = await (await must(chip, how('Other-tags chip #finance'))).evaluate((e) => { const r = e.getBoundingClientRect(); return { h: r.height, radius: parseFloat(getComputedStyle(e).borderTopLeftRadius) }; });
  assert.ok(near(pill.h, 20) && pill.radius >= 9, how(`Other-tags chips are 20 px pills (${JSON.stringify(pill)})`));
}

async function checkAllTags(page: Page, theme: string) {
  const how = (s: string) => `${theme} All tags: ${s}`;
  const head = await rectOf(allTagsHeading(page), how('heading Tags'));
  const tile = await main(page).evaluate((m, h) => {
    const hit = ([...m.querySelectorAll('*')] as HTMLElement[]).map((e) => e.getBoundingClientRect())
      .find((r) => Math.abs(r.width - 48) <= 1 && Math.abs(r.height - 48) <= 1 && r.right <= h.left + 0.5 && r.bottom > h.top && r.top < h.bottom);
    return hit ? { left: hit.left, right: hit.right, top: hit.top, bottom: hit.bottom } : null;
  }, head);
  assert.ok(tile, how('a 48 × 48 tile left of the heading'));
  assert.ok(Math.abs(head.top - tile!.top) <= 6 && head.left - tile!.right <= 32, how('the heading next to the tile, top-aligned'));
  const count = await rectOf(main(page).getByText('10 tags · 11 tagged objects', { exact: true }), how('the count line'));
  assert.ok(count.top >= head.bottom - 1 && near(count.left, head.left, 2), how('the count line below the heading, left-aligned'));
  const nt = await rectOf(newTagBtn(page), how('New tag'));
  const mainBox = await rectOf(main(page), how('main'));
  assert.ok(nt.left > mainBox.left + mainBox.width / 2 && nt.top < tile!.bottom && nt.bottom > tile!.top, how(`New tag at the right of the header row (${JSON.stringify(nt)})`));
}

for (const theme of ['light', 'dark'] as const) {
  test(`bug_v068_fr_tag_06_tag_page_layout ${theme} (fr_tag_06_ac13_tag_page)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTagPage(page, 'účty', { theme });
    await must(objectsTable(page, 'Účty'), 'table');
    await checkTagPage(page, theme);
  });
  test(`bug_v068_fr_tag_06_tag_page_layout ${theme} (fr_tag_06_ac13_all_tags)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAllTags(page, { theme });
    await checkAllTags(page, theme);
  });
}
