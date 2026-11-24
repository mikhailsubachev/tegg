// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md RA10 (the drawer), RA12
// (Back and gestures):
// - FR-NAV-04 AC-13 (what the drawer holds), AC-14 (open and close), AC-15 (counts follow the files);
// - FR-NAV-03 AC-17 (L5p: RA12's order through `__TEGG_TEST__.systemBack()`), AC-18 (no swipe navigates), AC-19
//   (history keeps its desktop rules);
// - FR-VLT-01 AC-29 (the switcher in the drawer's header), FR-UX-01 AC-8 (the version button), FR-HOM-04 AC-1 (L5p: the
//   landing for each core answer), FR-HOM-02 AC-32 (Pinned, read-only).
// Contract docs/contracts/android-phone.md §8.3 (drawer), §8.5 (Back), §9.8 (Pinned), §12.2, §14.1.
// Red-test readings (reported): the drawer's entries are found by their contract commands (`goto.inbox`, `daily.today`,
// `tasks.go`, `goto.conflicts`, `tags.go`, `queries.go`, `goto.settings`, `app.logoMenu`); "the desktop sidebar" for
// FR-NAV-04 AC-13 is a second page on `macos` in the same test; "history" in FR-NAV-03 AC-18 is checked by the Back
// sequence afterwards (the phone has no Forward); horizontal scroll amounts are asserted on Chromium only, where CDP touch
// scrolls natively (§14.1: WebKit gets synthetic pointer events).
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { I, inboxVault, reviewedText } from './capture-helpers';
import { conflictsVault } from './editor-helpers';
import {
  byTheDrag, ui,
  B, FRAME, PH, SMALL, appBar, assertZeroWrites, backButton, barButton, bottomBar, desktopPage, drawer, drawerEntry, eventually, fileStateOf,
  firstVisibleBlock, flat, isChromium, longPress, loadVault, mainName, mainScroll, must, nfc, openDrawer, phonePage, phoneVault, rect, scrollBlockToTop,
  seen, sheet, sleep, startDesktop, startPhone, systemBack, touchDrag, moreButton, moreMenu, type PhoneHandle,
} from './phone-helpers';

const CMD = (page: Page, cmd: string) => drawer(page).locator(`[data-command="${cmd}"]`);
const activeCommand = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-command]')?.getAttribute('data-command') ?? null);
const activeInDrawer = (page: Page) => page.evaluate(() => !!(document.activeElement as HTMLElement | null)?.closest('[role="dialog"][aria-label="Navigation"]'));
const countIn = (s: string) => { const m = /(\d+)\s*$/.exec(flat(s)); return m ? Number(m[1]) : null; };
/** The visible names of the drawer's Types list as [name, count] (the desktop's reading of typeEntries). */
async function typeEntriesIn(scope: ReturnType<Page['locator']>): Promise<[string, number][]> {
  const items = await scope.getByRole('list', { name: 'Types' }).getByRole('listitem').allInnerTexts();
  return items.map((t) => { const s = flat(t); const m = /^(.*?)\s*(\d+)\s*$/.exec(s); return m ? [m[1].trim(), Number(m[2])] : [s, 0]; });
}
/** Elements of the drawer in DOM order, as labels. */
async function drawerOrder(page: Page): Promise<string[]> {
  return drawer(page).evaluate((d) => {
    const out: string[] = [];
    for (const e of d.querySelectorAll('[data-command], [role="list"][aria-label="Types"], .sidebar-pinned') as NodeListOf<HTMLElement>) {
      if (e.matches('[role="list"][aria-label="Types"]')) out.push('Types');
      else if (e.matches('.sidebar-pinned')) out.push('Pinned');
      else if (!e.closest('[role="list"][aria-label="Types"], .sidebar-pinned')) out.push(e.getAttribute('data-command')!);
    }
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-13

test('fr_nav_04_ac13_drawer_entries', async ({ page, browser }) => {
  const core = await startPhone(page, { route: 'inbox' });
  const before = await fileStateOf(core);
  const d = await openDrawer(page);
  await must(d.getByRole('button', { name: 'Vault: Knihovna. Switch vault' }), 'the header "Vault: Knihovna. Switch vault"');
  const order = await drawerOrder(page);
  const want = ['vault.switch', 'goto.inbox', 'daily.today', 'tasks.go', 'Pinned', 'Types', 'tags.go', 'queries.go', 'goto.settings', 'app.logoMenu'];
  assert.deepEqual(order.filter((x) => want.includes(x)), want, `RA10's parts in order: ${order.join(', ')}`);
  assert.ok(countIn(await CMD(page, 'goto.inbox').innerText()) !== null, 'Inbox shows its count');
  assert.equal(countIn(await CMD(page, 'queries.go').innerText()), 9, 'Queries shows 9');
  const pinned = (await d.locator('.sidebar-pinned [data-pinned-row]').allInnerTexts()).map(flat);
  assert.deepEqual(pinned, ['Mapa výletu', 'Rozečtené'], 'Pinned: Mapa výletu, Rozečtené');
  for (const cmd of ['goto.conflicts', 'object.new', 'goto.search', 'goto.trash', 'type.new']) assert.equal(await CMD(page, cmd).count(), 0, `no ${cmd} in the drawer`);
  for (const name of ['New object', 'Search', 'Trash', 'New type']) assert.equal(await d.getByRole('button', { name, exact: true }).or(d.getByRole('link', { name, exact: true })).count(), 0, `no "${name}"`);
  assert.equal(await CMD(page, 'goto.inbox').getAttribute('aria-current'), 'page', 'the current route\'s entry (Inbox) has aria-current="page"');
  const version = await rect(CMD(page, 'app.logoMenu'));
  const dr = await rect(d);
  assert.ok(version && dr && dr.bottom - version.bottom <= 60, 'the version button is at the bottom, in view');

  // Types: exactly the desktop sidebar's list, cs and en.
  for (const region of ['cs', 'en']) {
    const prelude = `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(region)});`;
    const ph = await phonePage(browser);
    await startPhone(ph, { route: 'inbox', region, prelude });
    await openDrawer(ph);
    const phoneTypes = await typeEntriesIn(drawer(ph));
    const { page: desk, context } = await desktopPage(browser);
    await startDesktop(desk, { route: 'inbox', region, prelude });
    const deskTypes = await typeEntriesIn(desk.getByRole('navigation', { name: 'Sidebar' }));
    assert.ok(deskTypes.length > 0, `setup (${region}): the desktop's Types list`);
    assert.deepEqual(phoneTypes, deskTypes, `${region}: the drawer's Types list equals the desktop sidebar's`);
    await ph.close();
    await context.close();
  }
  await assertZeroWrites(core, before, 'the drawer');

  // With conflicts: Conflicts after Tasks, with its count.
  const cp = await phonePage(browser);
  await startPhone(cp, { vault: conflictsVault(), route: 'inbox', now: '2026-10-14T12:00:00+02:00' });
  await openDrawer(cp);
  const o2 = await drawerOrder(cp);
  assert.ok(o2.indexOf('goto.conflicts') === o2.indexOf('tasks.go') + 1, `Conflicts right after Tasks: ${o2.join(', ')}`);
  assert.equal(countIn(await CMD(cp, 'goto.conflicts').innerText()), 3, 'Conflicts with its count (3)');
  await cp.close();
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-14

test('fr_nav_04_ac14_drawer_open_and_close', async ({ browser }) => {
  for (const size of [FRAME, SMALL]) {
    const page = await phonePage(browser);
    const core = await startPhone(page, { route: 'inbox', viewport: size });
    const before = await fileStateOf(core);
    await barButton(page, 'Menu').click();
    const d = await must(drawer(page), 'Menu opens the drawer');
    await sleep(300);
    const r = await rect(d);
    assert.ok(r && Math.abs(r.left) <= 1, `${size.width}: from the left edge`);
    assert.ok(Math.abs(r!.width - Math.min(320, size.width - 56)) <= 1, `${size.width}: width min(320, viewport − 56) = ${Math.min(320, size.width - 56)} (${r!.width})`);
    const scrim = await rect(page.locator('div.phone-scrim'));
    assert.ok(scrim && scrim.right >= size.width - 1 && scrim.bottom >= size.height - 1, 'a scrim covers the rest of the viewport, the bottom bar included');
    assert.equal(await activeCommand(page), 'goto.inbox', 'focus on the first entry, Inbox (CP-8)');
    assert.equal(await page.evaluate(() => !!document.querySelector('main')?.closest('[inert]')), true, 'the rest of the page is inert');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
      assert.ok(await activeInDrawer(page), `Tab ${i + 1}: the focus stays in the drawer`);
    }
    // closes: the scrim, Esc, system Back, Menu again (a tap where Menu is lands on the scrim), then an entry
    const closeWith: [string, () => Promise<unknown>][] = [
      ['a tap on the scrim', () => page.mouse.click(size.width - 10, size.height / 2)],
      ['Esc', () => page.keyboard.press('Escape')],
      ['system Back', () => systemBack(page)],
      // The open drawer covers Menu (and the scrim the bottom bar), so "Menu again" is Menu's command, run as its control
      // does; a tap where Menu is lands on the drawer once it has slid in (AC-Test-Change, approved by the owner, D-2249).
      ['Menu again', () => page.evaluate(() => (window as unknown as { __TEGG_TEST__: { run: (id: string) => Promise<void> } }).__TEGG_TEST__.run('phone.menu'))],
    ];
    for (const [how, close] of closeWith) {
      if (!(await seen(drawer(page), 200))) await barButton(page, 'Menu').click();
      await must(drawer(page), `${how}: the drawer is open`);
      await close();
      const n = await eventually(() => drawer(page).count(), (c) => c === 0, 1500);
      assert.equal(n, 0, `${how} closes the drawer`);
      assert.equal(await mainName(page), 'Inbox', `${how}: the route stays`);
      assert.equal(await eventually(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-command]')?.getAttribute('data-command') ?? ''), (c) => c === 'phone.menu', 1000), 'phone.menu', `${how}: the focus returns to Menu`);
    }
    assert.equal(await systemBack(page), 'background', 'opening and closing added no history entry');
    await drawerEntry(page, 'Queries');
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Queries', 3000), 'Queries', 'an entry navigates');
    assert.equal(await drawer(page).count(), 0, 'and closes the drawer');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? ''), 'H1', 'after a navigation the focus is on the new page\'s heading (D-130)');
    // no edge swipe opens it
    await touchDrag(page, { x: 4, y: size.height / 2 }, 200, 0);
    await sleep(400);
    assert.equal(await drawer(page).count(), 0, 'an edge swipe doesn\'t open the drawer');
    await assertZeroWrites(core, before, `${size.width}: opening and closing`);
    await page.close();
  }
  const page = await phonePage(browser);
  await startPhone(page, { route: 'inbox', reducedMotion: 'reduce' });
  const d = await openDrawer(page);
  assert.equal(await d.evaluate((e) => getComputedStyle(e).transitionDuration), '0s', 'prefers-reduced-motion: transition-duration 0s');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-15

test('fr_nav_04_ac15_drawer_counts_follow_files', async ({ browser }) => {
  const page = await phonePage(browser);
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: '2026-10-14T12:00:00+02:00' });
  await openDrawer(page);
  assert.equal(countIn(await CMD(page, 'goto.inbox').innerText()), 13, 'Inbox 13');
  await core.setFile(I.Q1, reviewedText(I.Q1));
  const open = await eventually(async () => countIn(await CMD(page, 'goto.inbox').innerText()), (n) => n === 12, 2000);
  assert.equal(open, 12, 'Q1 reviewed from outside: 12 within 2 s, drawer open');
  const qn = async () => (await typeEntriesIn(drawer(page))).find(([n]) => n === 'Quick Notes')?.[1] ?? -1;
  const q0 = await qn();
  await page.keyboard.press('Escape');
  await core.setFile(I.Q2, reviewedText(I.Q2));
  await core.setFile('Quick Notes/Třetí nápad.md', '---\nid: 01JBAN2000000000000000N101\ntype: quick-note\ntitle: Třetí nápad\nreview: unreviewed\ncaptured: 2026-10-14T11:00:00+02:00\ncreated: 2026-10-14T11:00:00+02:00\n---\nČerstvý nápad.\n');
  await sleep(2000);
  await openDrawer(page);
  assert.equal(countIn(await CMD(page, 'goto.inbox').innerText()), 12, 'drawer closed: Q2 reviewed and Třetí nápad created read 12 on the next open');
  assert.equal(await eventually(qn, (n) => n === q0 + 1, 500), q0 + 1, `the Quick Notes count rises by one (FR-UX-02 AC-5): ${q0} → ${q0 + 1}`);
  await page.close();

  const views = await phonePage(browser);
  const vc = await startPhone(views, { route: 'inbox' });
  await openDrawer(views);
  assert.equal(countIn(await CMD(views, 'queries.go').innerText()), 9, 'Queries 9');
  await vc.setFile('.tegg/queries/Nová.yml', '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Nová.\nversion: 1\ntitle: Nová\ntypes: [book]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: list\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n');
  assert.equal(await eventually(async () => countIn(await CMD(views, 'queries.go').innerText()), (n) => n === 10, 2000), 10, 'a query file created from outside: 10');
  await vc.renameFile('.tegg/queries/Nová.yml', '.trash/.tegg/queries/Nová.yml');
  assert.equal(await eventually(async () => countIn(await CMD(views, 'queries.go').innerText()), (n) => n === 9, 2000), 9, 'moved into .trash/ from outside: 9');
  await views.close();
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-17 (L5p)

test('fr_nav_03_ac17_system_back_is_tegg_back', async ({ page }) => {
  const core = await startPhone(page, { last: null });
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Inbox', 5000), 'Inbox', 'the landing: inbox');
  const before = await fileStateOf(core);
  await drawerEntry(page, 'Books');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Books', 3000), 'Books', 'drawer Books');
  await (await must(page.getByRole('main').locator('[role="tab"][data-view-tab="Přečtené 2026"]'), 'the chip Přečtené 2026')).click();
  const row = page.getByRole('main').locator(`[data-query-result="${nfc(B('Mapa bez severu'))}"]`).first();
  await must(row, 'the row Mapa bez severu');
  const scroll = await mainScroll(page);
  await row.click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa bez severu', 3000), 'Mapa bez severu', 'the row opens the book');
  const chip = page.getByRole('main').getByRole('link', { name: /Eva Lindová/ }).first();
  await (await must(chip, 'the author chip Eva Lindová')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Eva Lindová', 3000), 'Eva Lindová', 'the chip opens its target');

  // RA12 row 2: an open drawer, sheet, menu is closed first; the route stays
  await openDrawer(page);
  assert.equal(await systemBack(page), 'handled', 'Back with the drawer open: handled');
  assert.equal(await drawer(page).count(), 0, 'closes the drawer');
  assert.equal(await mainName(page), 'Eva Lindová', 'the route stays');
  await (await must(moreButton(page), 'More actions')).click();
  await must(moreMenu(page), 'the menu');
  assert.equal(await systemBack(page), 'handled', 'Back with a menu open: handled');
  assert.equal(await moreMenu(page).count(), 0, 'closes the menu');
  await (await must(moreButton(page), 'More actions')).click();
  await (await must(moreMenu(page).getByRole('menuitem', { name: 'Properties' }), 'Properties')).click();
  await must(sheet(page, 'Properties'), 'the Properties sheet');
  assert.equal(await systemBack(page), 'handled', 'Back with the sheet open: handled');
  assert.equal(await sheet(page, 'Properties').count(), 0, 'closes the sheet');
  assert.equal(await mainName(page), 'Eva Lindová', 'the route stays');

  // RA12 row 3: one step back each
  assert.equal(await systemBack(page), 'handled', 'Back 1');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa bez severu', 3000), 'Mapa bez severu', 'Back 1: Mapa bez severu');
  // the app bar's Back does what one system Back does
  await (await must(backButton(page), 'the app bar\'s Back')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Books', 3000), 'Books', 'app bar Back: type/book');
  const sel = await page.getByRole('main').locator('[role="tab"][aria-selected="true"]').getAttribute('data-view-tab');
  assert.equal(nfc(sel ?? ''), 'Přečtené 2026', 'on Přečtené 2026');
  assert.ok(Math.abs((await mainScroll(page)) - scroll) <= 2, 'at the same scroll position');
  const focusedRow = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-query-result]')?.getAttribute('data-query-result') ?? null);
  assert.equal(nfc(focusedRow ?? ''), nfc(B('Mapa bez severu')), 'with the row focused');
  assert.equal(await systemBack(page), 'handled', 'Back 3');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Inbox', 3000), 'Inbox', 'Back 3: inbox');
  assert.equal(await systemBack(page), 'background', 'one more Back: the app moves to the background');
  assert.equal(await mainName(page), 'Inbox', 'returning shows inbox');
  await assertZeroWrites(core, before, 'Back');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-18

type Surface = { what: string; route: string; at: (page: Page) => Promise<{ x: number; y: number; scroller?: string } | null> };
const centreOf = async (page: Page, loc: ReturnType<Page['locator']>, what: string) => {
  const r = await rect(await must(loc, what, 5000));
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
};
const SURFACES: Surface[] = [
  { what: 'a note\'s text', route: `note/${PH.dlouha}`, at: (p) => centreOf(p, p.getByRole('main').locator('p').first(), 'a paragraph') },
  { what: 'the Přečtené 2026 table', route: 'query/Přečtené 2026', at: async (p) => ({ ...(await centreOf(p, p.getByRole('main').getByRole('table').first(), 'the table'))!, scroller: 'table' }) },
  { what: 'the Rozečtené lanes', route: 'query/Rozečtené', at: async (p) => ({ ...(await centreOf(p, p.getByRole('main').locator('[data-board]').first(), 'the board'))!, scroller: 'board' }) },
  { what: 'Mapa výletu\'s map', route: `note/${PH.mapa}`, at: async (p) => ({ ...(await centreOf(p, p.getByRole('main').locator('[data-map-area]').first(), 'the map area'))!, scroller: 'map' }) },
  { what: 'an Inbox row', route: 'inbox', at: (p) => centreOf(p, p.getByRole('main').getByText('Nápad z vlaku', { exact: true }), 'the row Nápad z vlaku') },
  { what: 'the app bar', route: 'inbox', at: (p) => centreOf(p, appBar(p), 'the app bar') },
  { what: 'the bottom bar', route: 'inbox', at: (p) => centreOf(p, bottomBar(p), 'the bottom bar') },
];
async function scrollLeftOf(page: Page, kind: string): Promise<{ left: number; max: number }> {
  return page.evaluate((k) => {
    const sel = k === 'table' ? 'main table' : k === 'board' ? 'main [data-board]' : 'main [data-map-area]';
    let e = document.querySelector(sel) as HTMLElement | null;
    while (e && !(e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowX))) e = e.parentElement;
    if (!e) { const inner = [...document.querySelectorAll(`${sel} *`)].find((x) => (x as HTMLElement).scrollWidth > (x as HTMLElement).clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(x).overflowX)) as HTMLElement | undefined; e = inner ?? null; }
    return e ? { left: e.scrollLeft, max: e.scrollWidth - e.clientWidth } : { left: -1, max: -1 };
  }, kind);
}

test('fr_nav_03_ac18_no_swipe_navigates', async ({ browser }) => {
  for (const s of SURFACES) {
    for (const start of ['edge', 'centre'] as const) {
      for (const dx of [200, -200]) {
        const page = await phonePage(browser);
        const core: PhoneHandle = await startPhone(page, { route: s.route });
        const name = await eventually(() => mainName(page), (n) => !!n, 5000);
        const before = await fileStateOf(core);
        const at = await s.at(page);
        assert.ok(at, `${s.what}: located`);
        const from = start === 'edge' ? { x: dx > 0 ? 4 : FRAME.width - 4, y: at!.y } : { x: at!.x, y: at!.y };
        const sc0 = at!.scroller ? await scrollLeftOf(page, at!.scroller) : null;
        await touchDrag(page, from, dx, 0);
        await sleep(400);
        const how = `${s.what}, from ${start}, ${dx > 0 ? 'right' : 'left'}`;
        assert.equal(await mainName(page), name, `${how}: the route stays`);
        assert.equal(await drawer(page).count(), 0, `${how}: the drawer stays closed`);
        assert.equal(await systemBack(page), 'background', `${how}: the history is as before (no entry added or taken)`);
        await assertZeroWrites(core, before, how);
        if (sc0 && start === 'centre' && isChromium(page)) {
          // A finger moving left scrolls the content forward (scrollLeft up by 200 or to its end); one moving right from
          // the start scrolls it back, which is already its end (scrollLeft stays 0).
          const sc1 = await scrollLeftOf(page, at!.scroller!);
          const want = dx < 0 ? Math.min(200, sc0.max - sc0.left) : -Math.min(200, sc0.left);
          assert.ok(byTheDrag(sc1.left - sc0.left, want), `${how}: the ${at!.scroller} scrolls by the drag (184…204 px or to its end, D-2224): ${sc0.left} → ${sc1.left} (max ${sc0.max})`);
        }
        await page.close();
      }
    }
  }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-19

test('fr_nav_03_ac19_history_rules_on_the_phone', async ({ page }) => {
  // D-2226: a stored ui-state, so the tab write changes only `typeViews`.
  const core = await startPhone(page, { route: `note/${PH.dlouha}`, uiState: ui() });
  await must(page.getByRole('main', { name: 'Dlouhá poznámka' }), 'Dlouhá poznámka');
  const before = await fileStateOf(core);
  const uiBefore = JSON.stringify(await core.uiState());
  // AC-4: the scroll position is restored by Back
  await scrollBlockToTop(page, 'Druhá kapitola');
  await sleep(200);
  await barButton(page, 'Search').click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Search', 3000), 'Search', 'Search');
  const field = page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' }));
  await (await must(field, 'Search query')).fill('mapa');
  const results = page.getByRole('list', { name: 'Search results' });
  await must(results.getByRole('listitem'), 'results for mapa', 3000);
  const rowsBefore = (await results.getByRole('listitem').allInnerTexts()).map(flat);
  await results.getByRole('link').first().click();
  await eventually(() => mainName(page), (n) => n !== 'Search', 3000);
  const opened = await mainName(page);
  // drawer, sheet, menu and a view tab add no entry
  await openDrawer(page);
  await page.keyboard.press('Escape');
  if (await seen(moreButton(page), 500)) {
    await moreButton(page).click();
    await page.keyboard.press('Escape');
  }
  assert.equal(await systemBack(page), 'handled', 'Back from the result');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Search', 3000), 'Search', `Back from ${opened} goes to search (the drawer and the menu added no entry)`);
  assert.equal(await field.inputValue(), 'mapa', 'search keeps its query (FR-SRC-02 AC-17)');
  assert.deepEqual((await results.getByRole('listitem').allInnerTexts()).map(flat), rowsBefore, 'and its rows');
  await (await must(backButton(page), 'the app bar\'s Back')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Dlouhá poznámka', 3000), 'Dlouhá poznámka', 'Back again: Dlouhá poznámka (AC-1)');
  await sleep(300);
  assert.match(await firstVisibleBlock(page), /^(Druhá kapitola|Další odstavec 1:|Odstavec 40:)/, 'Druhá kapitola is the first visible block again (AC-4)');
  assert.equal(await systemBack(page), 'background', 'the first entry: background');
  // a view tab change adds no entry
  await drawerEntry(page, 'Books');
  await eventually(() => mainName(page), (n) => n === 'Books', 3000);
  await page.getByRole('main').locator('[role="tab"][data-view-tab="Rozečtené"]').click();
  await page.getByRole('main').locator('[role="tab"][data-view-tab="Přečtené 2026"]').click();
  assert.equal(await systemBack(page), 'handled', 'Back from type/book');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Dlouhá poznámka', 3000), 'Dlouhá poznámka', 'the tab changes added no entry');
  // AC-5: a note gone in the meantime
  await drawerEntry(page, 'Inbox');
  await eventually(() => mainName(page), (n) => n === 'Inbox', 3000);
  await core.setFile(PH.dlouha, null);
  await systemBack(page);
  await must(page.getByText('This note was moved or deleted'), 'Back to a deleted note: "This note was moved or deleted" (AC-5)', 3000);
  // AC-7: no writes to the vault or ui-state.json by Back
  const vaultAfter = await core.files();
  const changed = Object.keys(before.files).filter((k) => k !== nfc(PH.dlouha) && before.files[k] !== vaultAfter[k]);
  assert.deepEqual(changed, [], 'Back writes nothing to the vault (AC-7)');
  assert.deepEqual((await core.calls()).filter((c) => ['note_write', 'note_create', 'daily_create'].includes(c.cmd)).map((c) => c.cmd), [], 'no write command');
  const uiAfter = await core.uiState();
  // D-2226: every key but `typeViews`, compared as objects; the app's own defaults for keys the stored state lacks count as unchanged.
  const DEFAULTS = { typeSort: {}, otherPropertiesOpen: false };
  const strip = (u: Record<string, unknown> | null) => { const o: Record<string, unknown> = { ...DEFAULTS, ...(u ?? {}) }; delete o.typeViews; return o; };
  assert.deepEqual(strip(uiAfter as Record<string, unknown> | null), strip(JSON.parse(uiBefore)), 'Back writes nothing to ui-state.json apart from the remembered tab (AC-7)');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-29

test('fr_vlt_01_ac29_vault_switcher_in_the_drawer', async ({ browser }) => {
  const SHARED = '/storage/emulated/0';
  const other = `${SHARED}/Documents/Čtení`;
  const recent = [
    { name: 'Knihovna', path: `${SHARED}/Documents/Knihovna`, exists: true },
    { name: 'Čtení', path: other, exists: true },
    { name: 'Smazaný', path: `${SHARED}/Documents/Smazaný`, exists: false },
  ];
  const opts = { route: 'inbox', recent, dirs: { [other]: loadVault('Čtení', ['read-view', 'new-empty/.tegg']) } };
  const item = async (page: Page, name: RegExp | string) => {
    const d = (await seen(drawer(page), 200)) ? drawer(page) : await openDrawer(page);
    await (await must(d.getByRole('button', { name: 'Vault: Knihovna. Switch vault' }), 'the switcher')).click();
    const menu = await must(page.getByRole('menu', { name: 'Vaults' }), 'menu "Vaults"');
    return { menu, it: menu.getByRole('menuitem', { name: typeof name === 'string' ? name : undefined }).or(menu.getByRole('menuitemradio', { name })).first() };
  };
  let page = await phonePage(browser);
  await startPhone(page, opts);
  const { menu } = await item(page, 'Knihovna');
  const radios = await menu.getByRole('menuitemradio').evaluateAll((rs) => rs.map((r) => ({ text: (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), dis: r.getAttribute('aria-disabled'), h: r.getBoundingClientRect().height })));
  assert.equal(radios.length, 3, `the recent vaults as menuitemradios: ${JSON.stringify(radios)}`);
  const missing = radios.find((r) => r.text.includes('Smazaný'));
  assert.ok(missing && missing.dis === 'true' && /Not found/.test(missing.text), 'a missing vault is aria-disabled with "Not found"');
  const all = await menu.locator('[role="menuitem"], [role="menuitemradio"]').evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height));
  assert.ok(all.every((h) => h >= 48 - 0.5), `the menu's items are at least 48 px high (${all.map(Math.round)})`);
  for (const name of ['Open folder as vault…', 'Create new vault…', 'Vault settings…']) await must(menu.getByRole('menuitem', { name }), `menuitem "${name}"`);
  await menu.getByRole('menuitem', { name: 'Open folder as vault…' }).click();
  await must(page.getByRole('main', { name: 'Choose a vault' }).getByText('Vaults on this phone', { exact: true }), 'Open folder as vault… shows the Android chooser (RA4)', 3000);
  await page.close();

  page = await phonePage(browser);
  await startPhone(page, opts);
  await (await item(page, 'Create new vault…')).menu.getByRole('menuitem', { name: 'Create new vault…' }).click();
  await must(page.getByRole('form', { name: 'New vault' }), 'Create new vault… shows its form', 3000);
  await page.close();

  page = await phonePage(browser);
  await startPhone(page, opts);
  await (await item(page, 'Vault settings…')).menu.getByRole('menuitem', { name: 'Vault settings…' }).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Vault', 3000), 'Vault', 'Vault settings… opens settings/vault');
  await page.close();

  page = await phonePage(browser);
  const core = await startPhone(page, opts);
  const m = (await item(page, /Čtení/)).menu;
  await m.getByRole('menuitemradio', { name: /Čtení/ }).click();
  await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'vault_open').length, (n) => n > 0, 3000);
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'vault_open').map((c) => nfc((c.args as { path: string }).path)), [nfc(other)], 'choosing another vault opens it');
  assert.equal(await eventually(() => drawer(page).count(), (n) => n === 0, 2000), 0, 'and closes the drawer');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-01 AC-8

test('fr_ux_01_ac8_version_label_in_the_drawer', async ({ page }) => {
  await startPhone(page, { route: 'inbox' });
  const d = await openDrawer(page);
  const btn = await must(d.getByRole('button', { name: 'Tegg: About and Settings', exact: true }), 'the version button');
  assert.equal(flat(await btn.innerText()), 'dev', 'its only visible text is the build\'s label (dev)');
  const last = await d.evaluate((e) => [...e.querySelectorAll('button, a, [role="button"], [role="link"]')].filter((x) => (x as HTMLElement).getClientRects().length > 0).pop()?.getAttribute('aria-label'));
  assert.equal(last, 'Tegg: About and Settings', 'it is the drawer\'s bottom row');
  await btn.click();
  const menu = await must(page.getByRole('menu', { name: 'About and Settings' }), 'menu "About and Settings"');
  assert.deepEqual((await menu.getByRole('menuitem').allInnerTexts()).map(flat), ['Settings…'], 'Settings… only (no About Tegg)');
  await menu.getByRole('menuitem', { name: 'Settings…' }).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Settings', 3000), 'Settings', 'Settings… opens settings');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-04 AC-1 (L5p)

test('fr_hom_04_ac1_phone_launch_landing', async ({ browser }) => {
  const id = '01JBAN2000000000000000N001';
  const cases: [string, Parameters<typeof startPhone>[1], string][] = [
    ['the last note exists', { last: { path: PH.mapa, id } }, 'Mapa výletu'],
    ['the last note was deleted', { last: { path: PH.mapa, id }, vault: phoneVault((f) => { delete f[nfc(PH.mapa)]; }) }, 'Inbox'],
    ['no note ever opened', { last: null }, 'Inbox'],
  ];
  for (const [how, o, want] of cases) {
    const page = await phonePage(browser);
    const core = await startPhone(page, o);
    assert.equal(await eventually(() => mainName(page), (n) => n === want, 5000), want, `${how}: the landing is ${want}`);
    assert.equal(await page.getByRole('alert').count(), 0, `${how}: no error`);
    assert.deepEqual((await core.calls()).filter((c) => ['note_write', 'note_create', 'daily_create', 'pins_apply'].includes(c.cmd)).map((c) => c.cmd), [], `${how}: the start writes nothing`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-32

const pinRows = (page: Page) => drawer(page).locator('.sidebar-pinned [data-pinned-row]');
const pinLabels = async (page: Page) => (await pinRows(page).evaluateAll((rs) => rs.map((r) => (r.getAttribute('title') ?? (r as HTMLElement).innerText).split('\n')[0].trim()))).map(nfc);

test('fr_hom_02_ac32_pinned_in_the_drawer_read_only', async ({ browser }) => {
  let page = await phonePage(browser);
  const core = await startPhone(page, { route: 'inbox' });
  const before = await fileStateOf(core);
  await openDrawer(page);
  assert.deepEqual(await pinLabels(page), ['Mapa výletu', 'Rozečtené'], 'Pinned: Mapa výletu, then Rozečtené');
  const icon = await pinRows(page).nth(1).locator('[data-icon]').getAttribute('data-icon');
  assert.match(icon ?? '', /query/, 'Rozečtené has the query icon');
  const sec = drawer(page).locator('.sidebar-pinned');
  for (const name of [/^Unpin/, /Pinned item/]) assert.equal(await sec.getByRole('button', { name }).count(), 0, `no ${name}`);
  assert.equal(await sec.locator('[draggable="true"], [data-pin-drop-line], [data-pin-placeholder], [data-command="sidebar.unpin"], [data-command="sidebar.pinned.moveUp"], [data-command="sidebar.pinned.moveDown"]').count(), 0, 'no grip, drag source, drop target or reorder');
  const r = await rect(pinRows(page).first());
  const prevented = await longPress(page, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 }, 800);
  await sleep(300);
  assert.equal(await page.getByRole('menu').count(), 0, 'a long press shows no menu');
  assert.equal(prevented, true, 'and no WebView context menu (contextmenu prevented)');
  await pinRows(page).first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa výletu', 3000), 'Mapa výletu', 'Mapa výletu opens its note');
  await openDrawer(page);
  await pinRows(page).nth(1).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozečtené', 3000), 'Rozečtené', 'Rozečtené opens query/Rozečtené');
  // swapped from outside
  await openDrawer(page);
  const swapped = before.files[PH.pins].replace(/  - id: 01JBAN2000000000000000N001\n    path: Pages\/Mapa výletu\.md\n  - query: Rozečtené\n/, '  - query: Rozečtené\n  - id: 01JBAN2000000000000000N001\n    path: Pages/Mapa výletu.md\n');
  assert.notEqual(swapped, before.files[PH.pins], 'setup: the swapped pins file');
  await core.setFile(PH.pins, swapped);
  const now = await eventually(() => pinLabels(page), (l) => JSON.stringify(l) === JSON.stringify(['Rozečtené', 'Mapa výletu']), 2000);
  assert.deepEqual(now, ['Rozečtené', 'Mapa výletu'], 'an external swap shows the new order within 2 s');
  await assertZeroWrites(core, { ...before, files: { ...before.files, [PH.pins]: swapped } }, 'the Pinned section');
  await page.close();

  // a pin whose target is missing
  page = await phonePage(browser);
  await startPhone(page, { route: 'inbox', vault: phoneVault((f) => { f[PH.pins] += '  - id: 01JBAN2000000000000000N099\n    path: Pages/Chybí.md\n'; }) });
  await openDrawer(page);
  const states = await pinRows(page).evaluateAll((rs) => rs.map((r) => r.getAttribute('data-pin-state')));
  assert.equal(states.length, 3, 'three pins');
  assert.equal(states[2], 'missing', 'the missing pin shows the missing state');
  assert.equal(await drawer(page).locator('.sidebar-pinned').getByRole('button', { name: /^Unpin/ }).count(), 0, 'without its Unpin action');
  await page.close();

  // an empty pins file: collapsed (D-1429)
  page = await phonePage(browser);
  await startPhone(page, { route: 'inbox', vault: phoneVault((f) => { f[PH.pins] = '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins: []\n'; }) });
  await openDrawer(page);
  const header = drawer(page).getByRole('button', { name: 'Pinned' });
  await must(header, 'the Pinned header');
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'an empty pins file shows the section collapsed');
  await page.close();
});
