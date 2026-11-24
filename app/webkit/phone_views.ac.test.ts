// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md RA11 (type and query
// pages, views read-only, D-2006):
// - FR-TYP-09 AC-37 (`All Books`), FR-QRY-07 AC-32 (tabs as chips), FR-QRY-05 AC-30…AC-33 (Table, List, vertical and
//   horizontal boards), FR-QRY-06 AC-26…AC-28 (the Queries page, a query page, query blocks), FR-QRY-09 AC-9 (live
//   views), FR-TSK-04 AC-30 (`type/task` with its views).
// Contract docs/contracts/android-phone.md §4.3 (the view-only line), §9.5, §9.6, §14.1. Fixtures: views/ + phone/,
// views-tasks/ (on tasks/ + new-empty/.tegg). Expected results: views.md R193, R208 (./views-helpers.ts,
// ./views-tasks-helpers.ts).
// Red-test readings (reported): the phone keeps the desktop's view marks (`data-views-tablist`, `data-view-tab`,
// `data-query-result`, `data-board`, `data-lane`, `data-board-card`), so R193's probes apply; FR-QRY-09 AC-9's second
// change sets `status: Read` with the 2026 `finished` date, as `Přečtené 2026` lists only Read books; FR-QRY-05
// AC-32's drag of Noční vlak 320 px to the right starts from lanes scrolled 320 px in (at 0 a rightward drag has
// nothing to scroll); scroll amounts are asserted on Chromium (CDP touch).
// Written from the ACs and the contract only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ALL_BOOKS, B as VB, P26_ROWS, ROZ_LANES, ZANR_LANES, addView, allTab, board, columnsButton, filterField, lane, lanes, lanesOf, original, panelHeaders, panelRows,
  panelRowsAre, queriesRow, tab, tablist, tabs, tagFilterButton, toolbarMenuButton, viewQuery,
} from './views-helpers';
import { CEKA, KANBAN, SCHEDULE, SUMMARY, kanbanLanes, laneShape, overlayVault, paths, scheduleCs } from './views-tasks-helpers';
import {
  B, FRAME, LANDSCAPE, PH, SMALL, appBar, assertZeroWrites, desktopPage, drawerEntry, eventually, fileStateOf, flat, isChromium, longPress, main, mainName, must, nfc,
  phonePage, phoneVault, rect, seen, sleep, startDesktop, startPhone, systemBack, touchDrag, ui, type PhoneHandle,
} from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const h1 = (page: Page) => appBar(page).getByRole('heading', { level: 1 });
const h1Is = async (page: Page, text: string, ms = 3000) => eventually(async () => flat(await h1(page).first().innerText().catch(() => '')), (t) => t === nfc(text), ms);
const sortLine = (page: Page) => main(page).locator('p.phone-sort-line');
const titleOf = (p: string) => nfc(p).split('/').pop()!.replace(/\.md$/, '');
/** RA11's type-page controls, hidden on the phone. */
async function typeControlsHidden(page: Page, plural: string, how: string) {
  const gone: [string, Locator][] = [
    ['Type settings', main(page).getByRole('button', { name: 'Type settings' })], [`New ${plural.replace(/s$/, '')}`, main(page).getByRole('button', { name: /^New \S+$/ })],
    ['Add view', addView(page)], ['View actions', toolbarMenuButton(page).or(page.getByRole('button', { name: 'View actions' }))],
    [`Filter ${plural}…`, filterField(page, plural)], ['Filter by tag', tagFilterButton(page)], ['the sort button', main(page).locator('button[data-command="sort.open"]')],
    ['Columns', columnsButton(page)], ['column resize separators', main(page).locator('[role="separator"]')], ['Lanes', main(page).locator('[data-command="board.switchLanes"]')],
    ['lane grips', main(page).locator('[data-command="board.laneDrag"]')], ['+ in lanes', main(page).locator('[data-command="board.newIn"]')],
    ['card More actions', main(page).getByRole('button', { name: /^More actions for / })], ['Restore', main(page).getByRole('button', { name: 'Restore' })],
    [`Remove from ${plural} page`, main(page).getByRole('button', { name: `Remove from ${plural} page` })],
  ];
  for (const [what, loc] of gone) assert.equal(await loc.count(), 0, `${how}: no ${what}`);
  assert.equal(await main(page).locator('[draggable="true"]').count(), 0, `${how}: no drag sources`);
}
/** The scroller of a table or board inside `scope` (the nearest element with overflow-x auto that overflows). */
async function sideScroller(scope: Locator): Promise<{ left: number; max: number; overflowX: string } | null> {
  return scope.first().evaluate((root) => {
    const all = [root, ...root.querySelectorAll('*')] as HTMLElement[];
    const e = all.find((x) => x.scrollWidth > x.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(x).overflowX));
    return e ? { left: e.scrollLeft, max: e.scrollWidth - e.clientWidth, overflowX: getComputedStyle(e).overflowX } : null;
  }).catch(() => null);
}
async function setScroll(scope: Locator, left: number) {
  await scope.first().evaluate((root, l) => {
    const all = [root, ...root.querySelectorAll('*')] as HTMLElement[];
    const e = all.find((x) => x.scrollWidth > x.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(x).overflowX));
    if (e) e.scrollLeft = l;
  }, left);
}
/** Title stays at the table container's left edge after a 300 px sideways scroll (FR-TYP-09 AC-37). */
async function titleSticky(page: Page, scope: Locator, how: string) {
  await setScroll(scope, 300);
  await sleep(150);
  const got = await scope.first().evaluate((root) => {
    const all = [root, ...root.querySelectorAll('*')] as HTMLElement[];
    const c = all.find((x) => x.scrollWidth > x.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(x).overflowX));
    const th = root.querySelector('[role="columnheader"], th') as HTMLElement | null;
    return c && th ? { scrolled: c.scrollLeft, cont: c.getBoundingClientRect().left, title: th.getBoundingClientRect().left, text: th.innerText.trim() } : null;
  });
  assert.ok(got && got.scrolled > 0, `${how}: the table container scrolls sideways (${JSON.stringify(got)})`);
  assert.match(got!.text, /^Title/, `${how}: the first column is Title`);
  assert.ok(Math.abs(got!.title - got!.cont) <= 1, `${how}: Title stays at the container's left edge (${got!.title} vs ${got!.cont})`);
  await setScroll(scope, 0);
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-37

test('fr_typ_09_ac37_all_tab_read_only_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { route: 'type/book' });
  const before = await fileStateOf(core);
  assert.equal(await h1Is(page, 'Books'), 'Books', 'the heading Books');
  await must(main(page).getByText('17 Books', { exact: true }), '17 Books');
  assert.deepEqual(await panelRowsAre(page, ALL_BOOKS), ALL_BOOKS.map(nfc), 'R193\'s 17 rows (Modified ↓)');
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { route: 'type/book' });
  const deskHeaders = await eventually(() => panelHeaders(desk), (h) => h.length > 0, 3000);
  await context.close();
  assert.deepEqual(await panelHeaders(page), deskHeaders, 'R193\'s headers (as the desktop)');
  await titleSticky(page, main(page).getByRole('table').first(), 'All Books');
  assert.equal(flat(await (await must(sortLine(page), 'the view-only line')).innerText()), 'Modified: Newest first · View only on the phone', 'the line of RA13');
  await typeControlsHidden(page, 'Books', 'type/book');
  const uiBefore = JSON.stringify(await core.uiState());
  await main(page).getByRole('columnheader').nth(1).click({ force: true });
  await sleep(400);
  assert.deepEqual(await panelRows(page), ALL_BOOKS.map(nfc), 'a tap on a header sorts nothing');
  assert.equal(JSON.stringify(await core.uiState()), uiBefore, 'and changes no ui-state');
  await main(page).locator(`[data-query-result="${nfc(VB('Kniha o čaji'))}"]`).first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Kniha o čaji', 3000), 'Kniha o čaji', 'a tap on a row opens the book');
  await assertZeroWrites(core, before, 'All Books');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-32

test('fr_qry_07_ac32_view_tabs_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  const core = await startPhone(page, { route: 'type/book' });
  const before = await fileStateOf(core);
  const tl = await must(tablist(page), 'tablist "Views"');
  assert.equal(await tl.getAttribute('aria-label'), 'Views', 'named Views');
  const t = await eventually(() => tabs(page), (x) => x.length === 4, 3000);
  assert.deepEqual(t.map((x) => x.text), ['All Books', 'Rozečtené', 'Přečtené 2026', 'Výborné knihy'], 'the four chips');
  const tops = await tl.locator('[role="tab"]').evaluateAll((ts) => ts.map((x) => Math.round(x.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, `in one row (${tops})`);
  assert.equal(await tl.evaluate((e) => getComputedStyle(e).overflowX), 'auto', 'the row scrolls sideways');
  assert.equal(await addView(page).count(), 0, 'no Add view');
  assert.equal(await page.locator('[data-command="views.menu"]').count(), 0, 'no tab chevron or menu');
  assert.equal(nfc(await tab(page, 'Rozečtené').getAttribute('data-command') ?? ''), nfc('views.tab:Rozečtené'), 'a chip carries its own views.tab:<name> (D-2235)');
  await tab(page, 'Rozečtené').click();
  const b = board(page, 'Rozečtené');
  await must(b, 'Rozečtené shows its board');
  const l = await eventually(() => lanes(b), (x) => x.length === 3, 3000);
  assert.deepEqual(l.map((x) => ({ id: x.id, cards: x.cards })), lanesOf(ROZ_LANES), 'the view as R193');
  assert.equal(await eventually(async () => (await core.uiState())?.typeViews?.lastTab?.book, (v) => v === 'Rozečtené', 2000), 'Rozečtené', 'remembered in typeViews.lastTab');
  assert.equal(await systemBack(page), 'background', 'selecting a chip adds no history entry');
  await assertZeroWrites(core, before, 'chips');
  await page.close();

  // tab states: trashed, not found, read-only
  const vault = phoneVault((f) => {
    f[PH.book] = f[PH.book].replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Odložené, Ztracený pohled, Novější]');
    f['.tegg/queries/Novější.yml'] = viewQuery({ title: 'Novější', view: 'table' }).replace('version: 1', 'version: 2');
  });
  page = await phonePage(browser);
  await startPhone(page, { route: 'type/book', vault });
  for (const [name, text] of [['Odložené', 'The query “Odložené” is in the trash.'], ['Ztracený pohled', 'Ztracený pohled']] as const) {
    await tab(page, name).click();
    await must(main(page).getByText(text), `${name}: its R186 state text`);
    assert.equal(await main(page).getByRole('button', { name: 'Restore' }).count(), 0, `${name}: no Restore`);
    assert.equal(await main(page).getByRole('button', { name: 'Remove from Books page' }).count(), 0, `${name}: no Remove from Books page`);
  }
  await tab(page, 'Novější').click();
  await must(main(page).getByText('Made by a newer version of Tegg. Read-only.').or(main(page).locator('[data-query-result]')), 'Novější (version 2): its read-only state');
  assert.equal(await main(page).getByRole('button', { name: /^(Restore|Remove from)/ }).count(), 0, 'Novější: no state buttons');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-30

test('fr_qry_05_ac30_table_read_only_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  const core = await startPhone(page, { route: 'type/book' });
  const before = await fileStateOf(core);
  await tab(page, 'Přečtené 2026').click();
  assert.deepEqual(await panelRowsAre(page, P26_ROWS), P26_ROWS.map(nfc), 'R193\'s 8 rows in order');
  assert.deepEqual(await panelHeaders(page), ['Title ↑³', 'Author', 'Rating ↑²', 'Finished ↓¹'], 'the headers with their sort marks');
  assert.equal(flat(await (await must(sortLine(page), 'the view-only line')).innerText()), 'Finished: Newest first +2 · View only on the phone', 'the line');
  await titleSticky(page, main(page).getByRole('table').first(), 'Přečtené 2026');
  assert.equal(await main(page).locator('[role="separator"]').count(), 0, 'no resize separators');
  const uiBefore = JSON.stringify(await core.uiState());
  const hdr = main(page).getByRole('columnheader').nth(3);
  await hdr.click({ force: true });
  const r = await rect(hdr);
  await longPress(page, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 }, 800);
  await sleep(300);
  assert.deepEqual(await panelRows(page), P26_ROWS.map(nfc), 'a tap or long press on a header changes nothing');
  assert.equal(JSON.stringify(await core.uiState()), uiBefore, 'no ui-state change');
  assert.equal(await page.getByRole('menu').count(), 0, 'no menu');
  await main(page).locator(`[data-query-result="${nfc(VB('Tiché město'))}"]`).first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Tiché město', 3000), 'Tiché město', 'a tap on a row opens it');
  await assertZeroWrites(core, before, 'Přečtené 2026');
  await page.close();
  // (C) en-US
  page = await phonePage(browser);
  await startPhone(page, { route: 'type/book', region: 'en-US', prelude: `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl('en-US');` });
  await tab(page, 'Přečtené 2026').click();
  const rows = await eventually(() => panelRows(page), (x) => x.length === 8, 3000);
  assert.ok(rows.indexOf('Čarovná mapa') < rows.indexOf('Cizí přístavy'), `en-US: Čarovná mapa before Cizí přístavy (${rows.join(', ')})`);
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-31

test('fr_qry_05_ac31_list_on_the_phone', async ({ page, browser }) => {
  const route = 'query/Seskupeno podle data';
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { route });
  const want = await eventually(() => desk.getByRole('main').locator('[data-query-result]').evaluateAll((es) => es.map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC'))), (x) => x.length === 17, 3000);
  await context.close();
  const core = await startPhone(page, { route });
  const before = await fileStateOf(core);
  await must(main(page).getByText('The setting group_by can\'t be read, so its default is used.', { exact: true }), 'the notice');
  const rows = main(page).locator('[data-query-result]');
  const got = await eventually(() => rows.evaluateAll((es) => es.map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC'))), (x) => x.length === 17, 3000);
  assert.deepEqual(got, want, 'its 17 books by title (R193, as the desktop)');
  const notice = await rect(main(page).getByText('The setting group_by can\'t be read, so its default is used.'));
  const first = await rect(rows.first());
  assert.ok(notice && first && notice.bottom <= first.top + 1, 'the rows are below the notice');
  const hs = await rows.evaluateAll((es) => es.map((e) => (e.closest('li') ?? e).getBoundingClientRect().height));
  assert.ok(hs.every((h) => h >= 56 - 0.5), `each row at least 56 px (${hs.map(Math.round)})`);
  await rows.first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === titleOf(got[0]), 3000), titleOf(got[0]), 'a tap opens the book');
  await assertZeroWrites(core, before, 'the List');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32

test('fr_qry_05_ac32_vertical_board_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { route: 'type/book' });
  const before = await fileStateOf(core);
  await tab(page, 'Rozečtené').click();
  const b = await must(board(page, 'Rozečtené'), 'the Rozečtené board');
  const l = await eventually(() => lanes(b), (x) => x.length === 3, 3000);
  assert.deepEqual(l.map((x) => ({ id: x.id, cards: x.cards })), lanesOf(ROZ_LANES), 'R193\'s lanes and cards');
  assert.deepEqual(l.map((x) => x.cards.length), [3, 2, 0], 'Reading 3, To read 2, Read 0');
  assert.equal(l[2].excluded, true, 'Read is hatched');
  await must(lane(b, 'option:Read').getByText('Not in this view'), 'Read: Not in this view');
  assert.equal(await lane(b, 'none').count(), 0, 'no No Status lane');
  const widths = await b.locator('section[role="region"][data-lane]').evaluateAll((ss) => ss.map((s) => s.getBoundingClientRect().width));
  assert.ok(widths.every((w) => Math.abs(w - 300) <= 1), `lanes 300 px wide (${widths})`);
  const second = await rect(lane(b, 'option:To read'));
  assert.ok(second && FRAME.width - second.left >= 24, `at 412 px the next lane shows at least 24 px (${second && FRAME.width - second.left})`);
  const snap = await b.evaluate((e) => {
    const all = [e, ...e.querySelectorAll('*')] as HTMLElement[];
    const row = all.find((x) => /(auto|scroll)/.test(getComputedStyle(x).overflowX) && x.scrollWidth > x.clientWidth + 1);
    const ln = e.querySelector('section[role="region"][data-lane]') as HTMLElement | null;
    return { row: !!row, type: row ? getComputedStyle(row).scrollSnapType : '', align: ln ? getComputedStyle(ln).scrollSnapAlign : '' };
  });
  // D-2221: the lane row scrolls sideways freely, without snapping.
  assert.ok(snap.row, 'the lane row scrolls sideways');
  assert.doesNotMatch(snap.type, /mandatory|proximity/, `the lane row doesn't snap (scroll-snap-type: ${snap.type})`);
  assert.equal(await b.locator('[data-command="board.laneDrag"], [data-command="board.newIn"]').count(), 0, 'no grips or +');
  assert.equal(await b.getByRole('button', { name: /^More actions for / }).count(), 0, 'no card More actions');
  // a touch drag of Noční vlak 320 px to the right scrolls the lanes and moves no card
  await setScroll(b, 320);
  const s0 = await sideScroller(b);
  const card = b.locator(`article[data-board-card="${nfc(B('Noční vlak'))}"]`).first();
  const cr = await rect(await must(card, 'the card Noční vlak'));
  await touchDrag(page, { x: Math.max(cr!.x + 20, 20), y: cr!.y + cr!.height / 2 }, 320, 0);
  await sleep(500);
  const after = await lanes(b);
  assert.ok(after.find((x) => x.id === nfc('option:Reading'))?.cards.includes(nfc(B('Noční vlak'))), 'Noční vlak is still in Reading');
  if (isChromium(page)) {
    const s1 = await sideScroller(b);
    assert.ok(s0 && s1 && s1.left < s0.left, `the drag scrolls the lanes (${s0?.left} → ${s1?.left})`);
  }
  await assertZeroWrites(core, before, 'the drag');
  await card.click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Noční vlak', 3000), 'Noční vlak', 'a tap on a card opens it');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-33

test('fr_qry_05_ac33_horizontal_board_and_folds_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { route: 'query/Podle žánru', viewport: SMALL });
  const before = await fileStateOf(core);
  const b = await must(board(page, 'Podle žánru'), 'the Podle žánru board');
  const l = await eventually(() => lanes(b), (x) => x.length === ZANR_LANES.length, 3000);
  assert.deepEqual(l.map((x) => ({ id: x.id, cards: x.cards })), lanesOf(ZANR_LANES), 'R193\'s rows stacked');
  const all = l.flatMap((x) => x.cards);
  assert.equal(all.length, 20, 'the 20 cards');
  assert.equal(new Set(all).size, 17, 'of 17 books');
  const cols = async () => b.locator('section[role="region"][data-lane]').first().evaluate((s) => {
    const xs = new Set([...s.querySelectorAll('article[data-board-card]')].map((c) => Math.round(c.getBoundingClientRect().left)));
    return xs.size;
  });
  assert.equal(await cols(), 1, 'one column of cards at 360 px');
  await page.setViewportSize(LANDSCAPE);
  await sleep(300);
  assert.equal(await cols(), 2, 'two at 915 px');
  await page.setViewportSize(SMALL);
  assert.equal(await b.getByRole('button', { name: /^New Book/ }).count(), 0, 'no dashed New Book tile');
  // all reachable by scrolling
  for (const p of [...new Set(all)]) {
    const c = b.locator(`article[data-board-card="${p.replace(/"/g, '\\"')}"]`).first();
    await c.scrollIntoViewIfNeeded();
    assert.ok(await c.isVisible(), `${p} is reachable by scrolling`);
  }
  const toggle = lane(b, 'option:Poezie').getByRole('button', { name: /^(Collapse|Expand) Poezie$/ });
  await (await must(toggle, 'Collapse Poezie')).click();
  assert.equal(await eventually(async () => (await lanes(b)).find((x) => x.id === 'option:Poezie')?.folded, (f) => f === true, 2000), true, 'Collapse works');
  const stored = JSON.stringify(await core.uiState());
  assert.match(stored, /Poezie/, 'the fold is remembered per usage on this phone (usageFolded, private storage)');
  await lane(b, 'option:Poezie').getByRole('button', { name: /^(Collapse|Expand) Poezie$/ }).click();
  assert.equal(await eventually(async () => (await lanes(b)).find((x) => x.id === 'option:Poezie')?.folded, (f) => f === false, 2000), false, 'Expand works');
  await assertZeroWrites(core, before, 'folds');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-26

test('fr_qry_06_ac26_queries_page_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { route: 'inbox' });
  const before = await fileStateOf(core);
  await drawerEntry(page, 'Queries');
  assert.equal(await h1Is(page, 'Queries'), 'Queries', 'drawer Queries opens queries');
  await must(main(page).getByText('9 queries', { exact: true }), '9 queries');
  const names = async (p: Page) => p.getByRole('main').locator('[data-query-row]').evaluateAll((rs) => rs.map((r) => (r.getAttribute('data-query-row') ?? '').normalize('NFC')));
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { route: 'queries' });
  const want = await eventually(() => names(desk), (x) => x.length === 9, 3000);
  const deskTexts = await desk.getByRole('main').locator('[data-query-row]').evaluateAll((rs) => rs.map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim().normalize('NFC')));
  await context.close();
  assert.deepEqual(await eventually(() => names(page), (x) => x.length === 9, 3000), want, 'one row per query in the desktop\'s order');
  for (const [i, n] of want.entries()) {
    const text = flat(await queriesRow(page, n).first().innerText());
    for (const part of deskTexts[i].split(' ').filter((w) => /\d/.test(w)).slice(0, 3)) assert.ok(text.includes(part), `${n}: R143's row content (${part})`);
    const mark = /Books page/.test(text);
    assert.equal(mark, ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'].includes(n), `${n}: the Books page mark ${mark ? 'shown' : 'absent'}`);
  }
  for (const [what, loc] of [['New query', page.getByRole('button', { name: 'New query' })], ['Find a query…', page.getByRole('searchbox', { name: 'Find a query…' })], ['the sort', main(page).getByRole('button').filter({ hasText: /^(Created|Updated|Title)/ })], ['row menus', main(page).getByRole('button', { name: 'Query actions' })]] as const) {
    assert.equal(await (loc as Locator).count(), 0, `no ${what}`);
  }
  await queriesRow(page, 'Výborné knihy').first().click();
  assert.equal(await h1Is(page, 'Výborné knihy'), 'Výborné knihy', 'a tap opens query/Výborné knihy');
  await assertZeroWrites(core, before, 'the Queries page');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-27

test('fr_qry_06_ac27_query_page_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { route: 'query/Přečtené 2026' });
  const before = await fileStateOf(core);
  assert.equal(await h1Is(page, 'Přečtené 2026'), 'Přečtené 2026', 'the query\'s title');
  assert.deepEqual(await eventually(() => main(page).locator('[data-query-result]').evaluateAll((es) => es.map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC').split('/').pop()!.replace(/\.md$/, ''))), (x) => x.length === 8, 3000), P26_ROWS.map(nfc), 'its results as its view (AC-30\'s table)');
  assert.equal(flat(await (await must(sortLine(page), 'the view-only line')).innerText()), 'Finished: Newest first +2 · View only on the phone', 'the view-only line');
  for (const name of ['Edit query', 'View actions', 'Query actions']) assert.equal(await page.getByRole('button', { name }).count(), 0, `no ${name}`);
  assert.equal(await main(page).locator('button[data-command="sort.open"]').count(), 0, 'no sort button');
  await assertZeroWrites(core, before, 'a query page');
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { route: 'query/Knihy odkazované odsud' });
  const want = flat(await (await must(desk.getByRole('main').locator('section[data-query-state="needsHost"]'), 'desktop: the state of a this query')).innerText());
  await context.close();
  const p2 = await phonePage(browser);
  await startPhone(p2, { route: 'query/Knihy odkazované odsud' });
  const got = flat(await (await must(main(p2).locator('section[data-query-state="needsHost"]'), 'phone: the state of a this query')).innerText());
  assert.equal(got, want, 'the desktop\'s state text for a page without a note');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-28

test('fr_qry_06_ac28_query_blocks_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { route: `note/${PH.cteni}` });
  const before = await fileStateOf(core);
  const blocks = main(page).locator('figure[data-query-block]');
  assert.equal(await eventually(() => blocks.count(), (n) => n === 3, 5000), 3, 'three query blocks');
  const b1 = blocks.nth(0);
  const t1 = await must(b1.getByRole('table'), 'block 1: the Přečtené 2026 table');
  const s1 = await sideScroller(b1);
  assert.ok(s1 && s1.max > 0, 'block 1 scrolls sideways inside the block');
  const r1 = await rect(b1);
  assert.ok(r1 && r1.right <= FRAME.width + 0.5, 'the block stays within the page');
  const b2 = blocks.nth(1);
  await must(b2.locator('[data-board]'), 'block 2: the Rozečtené board');
  const s2 = await sideScroller(b2);
  assert.ok(s2 && s2.max > 0, 'block 2\'s lanes scroll sideways inside the block');
  const b3 = blocks.nth(2);
  const r3 = await eventually(() => b3.locator('[data-query-result]').evaluateAll((es) => es.map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC'))), (x) => x.length === 2, 3000);
  assert.deepEqual(r3, [nfc(B('Mapa bez severu')), nfc(B('Noční vlak'))], 'block 3 lists Mapa bez severu, Noční vlak');
  for (const [i, b] of [b1, b2, b3].entries()) {
    const head = flat(await b.locator('.query-header').first().innerText());
    assert.match(head, /\d/, `block ${i + 1}: its header shows the count`);
    for (const name of ['Edit query', 'Columns', 'Save as query…']) assert.equal(await b.getByRole('button', { name }).count(), 0, `block ${i + 1}: no ${name}`);
    assert.equal(await b.locator('button[data-command="sort.open"]').count(), 0, `block ${i + 1}: no sort button`);
  }
  await b3.locator('[data-query-result]').first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa bez severu', 3000), 'Mapa bez severu', 'a tap on a result opens it');
  await assertZeroWrites(core, before, 'query blocks');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-9

test('fr_qry_09_ac9_live_views_on_the_phone', async ({ page }) => {
  const core: PhoneHandle = await startPhone(page, { route: 'type/book' });
  await tab(page, 'Rozečtené').click();
  const b = await must(board(page, 'Rozečtené'), 'the Rozečtené board');
  await eventually(() => lanes(b), (x) => x.length === 3, 3000);
  const dum = nfc(B('Dům u řeky'));
  const reading = original(dum).replace('status: To read', 'status: Reading');
  await core.setFile(dum, reading);
  const l = await eventually(() => lanes(b), (x) => x.find((y) => y.id === 'option:Reading')?.cards.includes(dum) === true, 2000);
  assert.ok(l.find((y) => y.id === 'option:Reading')?.cards.includes(dum), 'Dům u řeky moves to Reading within 2 s');
  assert.deepEqual(l.map((y) => y.cards.length).slice(0, 2), [4, 1], 'Reading 4, To read 1');
  const counts = await b.locator('section[role="region"][data-lane]').evaluateAll((ss) => ss.slice(0, 2).map((s) => (s.querySelector('h2, h3, header')?.textContent ?? '').replace(/\s+/g, ' ').trim()));
  assert.ok(/4/.test(counts[0]) && /1/.test(counts[1]), `the lane counts read 4 and 1 (${counts})`);
  await tab(page, 'Přečtené 2026').click();
  await panelRowsAre(page, P26_ROWS);
  await core.setFile(dum, reading.replace('status: Reading', 'status: Read').replace('genres: [Román]\n', 'genres: [Román]\nfinished: 2026-11-18\n'));
  const rows = await panelRowsAre(page, ['Dům u řeky', ...P26_ROWS], 2000);
  assert.deepEqual(rows, ['Dům u řeky', ...P26_ROWS].map(nfc), 'its row is added in sort order within 2 s');
  assert.deepEqual((await core.calls()).filter((c) => ['note_write', 'note_create', 'query_apply', 'type_patch'].includes(c.cmd)).map((c) => c.cmd), [], 'no write by Tegg');
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-30

test('fr_tsk_04_ac30_tasks_read_only_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: overlayVault(), route: 'inbox', now: '2026-10-14T12:00:00+02:00', uiState: ui() });
  const before = await fileStateOf(core);
  await drawerEntry(page, 'Tasks');
  assert.equal(await h1Is(page, 'Tasks'), 'Tasks', 'drawer Tasks opens type/task');
  await must(main(page).getByText(SUMMARY, { exact: true }), `the summary "${SUMMARY}"`);
  const t = await eventually(() => tabs(page), (x) => x.length === 4, 3000);
  assert.deepEqual(t.map((x) => x.text), ['All Tasks', SCHEDULE, KANBAN, CEKA], 'the chips');
  assert.equal(t.find((x) => x.text === SCHEDULE)?.selected, true, 'Schedule selected on the first open');
  const sch = await must(board(page, SCHEDULE), 'the Schedule board');
  const shape = await eventually(() => laneShape(sch), (s) => s.length === 5, 3000);
  assert.deepEqual(shape, scheduleCs(), 'R208\'s lanes, day groups and cards (Done folded)');
  const done = lane(sch, 'done');
  assert.match(flat(await done.innerText()), /Done\s*2/, 'Done 2, folded');
  await (await must(done.getByRole('button', { name: /^(Expand|Collapse) Done$/ }), 'Expand Done')).click();
  const opened = await eventually(async () => (await laneShape(sch)).find((l) => l.id === 'done')?.cards ?? [], (c) => c.length === 2, 2000);
  assert.deepEqual(opened, paths('t10', 't12'), 'unfolding shows T10 and T12');
  assert.match(JSON.stringify(await core.uiState()), /done/i, 'remembered on this phone (R206, private storage)');
  // every task checkbox: aria-disabled, View only on the phone; a tap writes nothing
  const boxes = main(page).getByRole('checkbox');
  const n = await boxes.count();
  assert.ok(n > 0, 'task checkboxes are drawn');
  const states = await boxes.evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-disabled'), b.getAttribute('aria-description')]));
  assert.ok(states.every(([d, desc]) => d === 'true' && desc === 'View only on the phone'), `each aria-disabled with "View only on the phone": ${JSON.stringify(states.slice(0, 3))}`);
  const first = boxes.first();
  const where = await first.evaluate((b) => b.closest('section[data-lane]')?.getAttribute('data-lane'));
  await first.click({ force: true });
  await sleep(500);
  assert.equal(await first.evaluate((b) => b.closest('section[data-lane]')?.getAttribute('data-lane')), where, 'the card stays where it was');
  await typeControlsHidden(page, 'Tasks', 'type/task');
  // Kanban
  await tab(page, KANBAN).click();
  const kb = await must(board(page, KANBAN), 'the Kanban board');
  const kl = await eventually(() => lanes(kb), (x) => x.length === kanbanLanes().length, 3000);
  assert.deepEqual(kl.map((x) => ({ id: x.id, cards: x.cards })), kanbanLanes().map((x) => ({ id: nfc(x.id), cards: x.cards })), 'R208\'s Kanban lanes');
  const ks = await sideScroller(kb);
  assert.ok(ks && ks.max > 0, 'Kanban scrolls sideways');
  await assertZeroWrites(core, before, 'Tasks');
});

