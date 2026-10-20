// 5B preview feedback round 2, L5 (WebKit + fake core): FR-TSK-05 AC-15 (D-593, AP-521 (c)): the Kanban board keeps
// scrolling sideways on its own, but its horizontal scrollbar takes no height and isn't drawn until the pointer is over
// the board (also while a card is dragged); the main pane stays the page's only vertical scroller. docs/acceptance/
// tasks.md R42; interface: the board is the parent of the `[data-column]` columns (as FR-TSK-05 AC-12's test reads it),
// ms5-tasks §6.2 (pointer drag). Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs; 1440 × 900 (the suite's
// viewport). Written from the AC and the contracts only (D-61); every lookup goes through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { column, gotoKanban, main, must, sidebar, sleep, startTasks } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1440, height: 900 } });

const board = (page: Page) => main(page).locator('[data-column]').first().locator('xpath=..');

type Metrics = { bar: number; scrollLeft: number; scrollTop: number; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; overflowY: string };
async function metrics(b: Locator): Promise<Metrics> {
  return b.evaluate((e) => {
    const el = e as HTMLElement;
    return {
      bar: el.offsetHeight - el.clientHeight, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY,
    };
  });
}
/** Elements in the centre pane (the `main` element, its descendants and its ancestors up to the document) that scroll
 *  vertically: overflow-y auto/scroll with more content than height, or the document's scrolling element. */
async function verticalScrollers(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => {
    const out: string[] = [];
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('data-column') ? `[data-column="${el.getAttribute('data-column')}"]` : ''}${el === m ? '(main)' : ''}${el.querySelector(':scope > [data-column]') ? '(board)' : ''}`;
    const check = (el: Element) => {
      const s = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) out.push(name(el));
    };
    for (let a: Element | null = m; a && a !== document.documentElement; a = a.parentElement) check(a);
    for (const d of m.querySelectorAll('*')) check(d);
    // The document itself scrolls for the user unless the root or body clips it (overflow hidden/clip propagates to
    // the viewport); a programmatic scrollBy would move even a clipped viewport, so the styles are read instead.
    const clipped = (e: Element) => /(hidden|clip)/.test(getComputedStyle(e).overflowY);
    const se = document.scrollingElement;
    if (se && !clipped(document.documentElement) && !clipped(document.body) && se.scrollHeight > se.clientHeight + 1) out.push('document');
    return out;
  });
}
/** Moves the pointer onto the middle of `loc` and waits for hover styles to apply. */
async function hover(page: Page, loc: Locator) {
  const b = (await loc.boundingBox())!;
  assert.ok(b, 'the element has a box');
  await page.mouse.move(b.x + Math.min(b.width / 2, 200), b.y + Math.min(b.height / 2, 200), { steps: 3 });
  await sleep(250);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tsk_05_ac15_the_sideways_scrollbar_only_on_hover_${theme}`, async ({ page }) => {
    await startTasks(page, { theme });
    await gotoKanban(page, 'Status');
    const b = await must(board(page), 'the board (parent of the Kanban columns)');
    const m0 = await metrics(b);
    assert.ok(m0.scrollWidth > m0.clientWidth, `the board is wider than the page (${m0.scrollWidth} > ${m0.clientWidth})`);

    // Pointer outside the board (on the sidebar): the scrollbar takes no height.
    await hover(page, await must(sidebar(page), 'navigation "Sidebar"'));
    assert.equal((await metrics(b)).bar, 0, 'pointer outside the board: offsetHeight − clientHeight = 0 (no scrollbar space)');

    // Pointer over the board: the scrollbar is shown.
    await hover(page, await must(column(page, 'In progress'), 'column In progress'));
    assert.ok((await metrics(b)).bar > 0, `pointer over the board: offsetHeight − clientHeight > 0 (the scrollbar is shown), got ${(await metrics(b)).bar}`);

    // Sideways scrolling still works: a horizontal trackpad scroll (wheel deltaX). ⇧ + mouse wheel is turned into a
    // horizontal scroll by macOS before WebKit sees it; a synthetic Playwright wheel event with Shift held isn't, so the
    // ⇧ part of the AC is left to the L6/manual check (reported as a test-design point).
    const before = (await metrics(b)).scrollLeft;
    await page.mouse.wheel(240, 0);
    await sleep(250);
    const afterTrackpad = (await metrics(b)).scrollLeft;
    assert.ok(afterTrackpad > before, `a horizontal trackpad scroll moves the board sideways (scrollLeft ${before} → ${afterTrackpad})`);
    assert.ok((await metrics(b)).bar > 0, 'the scrollbar stays shown while scrolling with the pointer over the board');

    // The board never scrolls vertically; the main pane is the only vertical scroller.
    await page.mouse.wheel(0, 300);
    await sleep(250);
    const m1 = await metrics(b);
    assert.equal(m1.scrollTop, 0, 'the board itself never scrolls vertically (scrollTop stays 0)');
    assert.ok(!(m1.scrollHeight > m1.clientHeight + 1 && /(auto|scroll)/.test(m1.overflowY)), `the board has no vertical scroll range (overflow-y ${m1.overflowY}, ${m1.scrollHeight} / ${m1.clientHeight})`);
    const scrollers = await verticalScrollers(page);
    assert.ok(scrollers.length <= 1 && !scrollers.some((s) => s.includes('(board)') || s.includes('data-column') || s === 'document'), `the main pane is the only vertical scroller: ${JSON.stringify(scrollers)}`);

    // While a card is dragged the scrollbar is shown.
    const src = await must(column(page, 'In progress').getByRole('article').first(), 'a card in In progress');
    await src.scrollIntoViewIfNeeded();
    const a = (await src.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2));
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + 40, { steps: 4 });
    await page.mouse.move(a.x + a.width / 2 + 30, a.y + 60, { steps: 6 });
    await sleep(250);
    const dragging = (await metrics(b)).bar;
    await page.keyboard.press('Escape');
    await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2), { steps: 4 });
    await page.mouse.up();
    assert.ok(dragging > 0, `while a card is dragged the scrollbar is shown (offsetHeight − clientHeight = ${dragging})`);
  });
}
