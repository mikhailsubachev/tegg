// Slice Q2-T, L5 (WebKit + fake core): wide pages up to 1,600 px, centred, docs/acceptance/views.md part three FR-TYP-09
// AC-36 (D-1890, AP-1546; amends part one's FR-TYP-09 AC-35 and FR-QRY-06 AC-25). Interface docs/contracts/v1-views.md
// §29.8 (`.page-column.page-wide`: border-box, max-width 1,680 px, 40 px side padding, auto margins). Written from the ACs
// and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  AUTOR_LANES, BOOK_YML, Q, block, bookWithViews, board, main, must, near, openNote, queryRoute, selectTab, sleep, startViews, tab, tablist, typeRoute, viewsVault,
} from './views-helpers';
import { TYPE_TASK, startTasksViews } from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const VIEWS3 = [Q.roz, Q.p26, Q.vyb];
/** The `.page-column.page-wide` box against the centre pane: content = width − 80 (40 px padding each side). */
async function measure(page: Page) {
  return main(page).evaluate((m) => {
    const c = m.querySelector('div.page-column.page-wide') as HTMLElement | null;
    const r = c?.getBoundingClientRect();
    const p = m.getBoundingClientRect();
    const se = document.scrollingElement ?? document.documentElement;
    return {
      found: !!c, pane: p.width, content: r ? r.width - 80 : 0, left: r ? r.left - p.left : 0, right: r ? p.right - r.right : 0,
      pageScrollX: se.scrollWidth > se.clientWidth || m.scrollWidth > m.clientWidth + 1,
    };
  });
}
async function check(page: Page, what: string) {
  for (const [w, h, content] of [[1440, 900, 1128], [1920, 1080, 1600], [2560, 1440, 1600]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    const m = await measure(page);
    assert.ok(m.found, `${what} at ${w}: div.page-column.page-wide`);
    assert.ok(near(m.content, content), `${what} at ${w} × ${h}: content ${content} ± 1 px (${JSON.stringify(m)})`);
    assert.ok(near(m.left, m.right), `${what} at ${w}: equal space on both sides (${m.left} vs ${m.right})`);
    if (w === 2560) assert.ok(near(m.pane, 2328), `${what}: the 2,328 px pane (${m.pane})`);
    assert.equal(m.pageScrollX, false, `${what} at ${w}: no horizontal page scroll`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_typ_09_ac36_wide_pages_max_1600_${theme}`, async ({ page }) => {
    await startViews(page, { route: typeRoute('book'), ui: { theme } });
    await must(tablist(page), 'type/book', 8000);
    await check(page, 'type/book All Books');
    for (const name of VIEWS3) {
      await selectTab(page, name);
      await check(page, `type/book ${name}`);
    }
    await startViews(page, { route: 'queries', ui: { theme } });
    await must(main(page).locator('tr[data-query-row]').first(), 'queries', 8000);
    await check(page, 'queries');
    await startViews(page, { route: queryRoute(Q.p26), ui: { theme } });
    await must(main(page).locator('[data-query-result]').first(), `query/${Q.p26}`, 8000);
    await check(page, `query/${Q.p26}`);
    // A note keeps its centred column (FR-UX-01 AC-1).
    await page.setViewportSize({ width: 2560, height: 1440 });
    await openNote(page, 'Čtení 2026');
    const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Čtení\'s body');
    const bb = (await body.boundingBox())!;
    const pane = (await main(page).boundingBox())!;
    assert.ok(bb.width <= 761 && near(bb.x - pane.x, pane.x + pane.width - (bb.x + bb.width), 2), `Čtení keeps its centred column (${JSON.stringify(bb)})`);
    void block;
  });
}

test('fr_typ_09_ac36_wide_pages_max_1600_type_task', async ({ page }) => {
  await startTasksViews(page, { route: TYPE_TASK });
  await must(tablist(page), 'type/task', 8000);
  await check(page, 'type/task');
});

test('fr_typ_09_ac36_wide_pages_max_1600_board_scrolls_inside', async ({ page }) => {
  // `Podle autora` with 12 runtime authors (one book each, plus the fixture's): wider than 1,600 px.
  const vault = viewsVault((f) => {
    f[BOOK_YML] = bookWithViews(`views: [Rozečtené, Přečtené 2026, Výborné knihy, ${Q.autor}]\n`);
    for (let i = 1; i <= 12; i++) {
      const n = `Autor číslo ${String(i).padStart(2, '0')}`;
      f[`Autoři/${n}.md`] = `---\nid: 01JB5V000000000000000A${String(i).padStart(4, '0')}\ntype: autor\ntitle: ${n}\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n`;
      f[`Books/Kniha číslo ${i}.md`] = `---\nid: 01JB5V000000000000000B${String(i).padStart(4, '0')}\ntype: book\ntitle: Kniha číslo ${i}\nauthor: "[[${n}]]"\nstatus: To read\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n`;
    }
  });
  await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.autor), 'tab Podle autora', 8000);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await selectTab(page, Q.autor);
  const b = await must(board(page, Q.autor), 'the board', 5000);
  await sleep(300);
  const m = await measure(page);
  assert.ok(near(m.content, 1600), `the page content stays 1,600 px (${m.content})`);
  const scroll = await b.evaluate((el) => {
    const s = (el.closest('div.board-scroll') ?? el.querySelector('div.board-scroll') ?? el) as HTMLElement;
    return { sw: s.scrollWidth, cw: s.clientWidth, w: s.getBoundingClientRect().width };
  });
  assert.ok(scroll.sw > scroll.cw, `the board scrolls sideways inside its box (${JSON.stringify(scroll)})`);
  assert.ok(scroll.w <= 1601, `inside the 1,600 px box (${scroll.w})`);
  assert.equal(m.pageScrollX, false, 'the page has no horizontal scroll bar');
  void AUTOR_LANES;
});
