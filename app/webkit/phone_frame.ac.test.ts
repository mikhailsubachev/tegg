// Slice AND-2, L5p (Playwright, projects `phone-webkit` and `phone-chromium`; the fake core; `__TEGG_PLATFORM__ =
// 'android'`): docs/acceptance/android-phone.md RA8 (the frame), RA9 (routes):
// - FR-UX-04 AC-1 (L5p part: every RA9 route at 360 × 800, 412 × 915 and 915 × 412 has `data-layout="phone"` and RA8's
//   frame, no desktop chrome), AC-2 (the frame), AC-3 (L5p: injected insets), AC-4 (L5p: the keyboard's emulation),
//   AC-5 (touch targets), AC-6 (no sideways page scroll), AC-7 (L5p: the viewport turned to landscape and back);
// - FR-UX-07 AC-18 (the indexing line under the app bar), FR-UX-08 AC-26 (L5p: modal drawer and sheet, names).
// Contract docs/contracts/android-phone.md §8 (DOM), §12.2 (hooks), §14.1 (harness ./phone-helpers.ts).
// Red-test readings (reported): every route of RA9 is opened by a fresh start with `__TEGG_ROUTE__` (the phone has no
// palette to `go` with); `today` is today's virtual daily route; the note route is Mapa výletu; "a sheet and a menu"
// (AC-5) are the note's `More actions` menu and its `Properties` sheet, and the drawer's `Vaults` menu.
// Written from the ACs and the contract only (D-61).
import { test, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { addHromada, pageVault } from './search-page-helpers';
import {
  FRAME, INSETS, KEYBOARD, LANDSCAPE, NOW, PH, RA9_ROUTES, SMALL, TODAY, appBar, assertZeroWrites, barButton, bottomBar, controls, drawer, eventually,
  fileStateOf, firstVisibleBlock, flat, hitArea, keyboard, loadVault, mainName, moreButton, moreMenu, must, nfc, openDrawer, pageHeading, phonePage,
  rect, scrollBlockToTop, seen, sheet, sidewaysOverflow, sleep, startPhone, systemBack, verticalScrollers, type PhoneOptions, type Size,
} from './phone-helpers';

const layoutAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-layout'));
const title = (route: string) => route.startsWith('note/') ? route.slice('note/'.length).split('/').pop()!.replace(/\.md$/, '') : null;

/** Opens each route of `routes` in a fresh phone page and runs `fn` on it. */
async function tour(browser: Browser, routes: string[], fn: (page: Page, route: string) => Promise<void>, o: PhoneOptions = {}) {
  for (const route of routes) {
    const page = await phonePage(browser);
    try {
      await startPhone(page, { ...o, route });
      await eventually(() => mainName(page), (n) => !!n, 5000);
      await fn(page, route);
    } finally {
      await page.close();
    }
  }
}

/** RA8's absent parts while the drawer is closed (FR-UX-04 AC-1). */
async function noDesktopChrome(page: Page, how: string) {
  assert.equal(await page.getByRole('navigation', { name: 'Sidebar' }).count(), 0, `${how}: no nav "Sidebar" while the drawer is closed`);
  assert.equal(await page.getByRole('complementary', { name: 'Context panel' }).count(), 0, `${how}: no "Context panel"`);
  assert.equal(await page.getByRole('tablist', { name: 'Tabs' }).count(), 0, `${how}: no tab strip`);
  assert.equal(await page.getByRole('button', { name: 'New tab' }).count(), 0, `${how}: no "New tab"`);
  assert.equal(await page.locator('.titlebar').count(), 0, `${how}: no title bar`);
  assert.equal(await page.getByRole('button', { name: 'Forward' }).count(), 0, `${how}: no Forward`);
  assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, `${how}: no command palette`);
}

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-1

test('fr_ux_04_ac1_phone_layout_on_android', async ({ browser }) => {
  await tour(browser, RA9_ROUTES, async (page, route) => {
    for (const size of [SMALL, FRAME, LANDSCAPE]) {
      await page.setViewportSize(size);
      await sleep(100);
      const how = `${route} at ${size.width} × ${size.height}`;
      assert.equal(await layoutAttr(page), 'phone', `${how}: <html data-layout="phone">`);
      await must(appBar(page), `${how}: the app bar (banner)`);
      await must(bottomBar(page), `${how}: the bottom bar (navigation "Main")`);
      await noDesktopChrome(page, how);
    }
  });
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-2

test('fr_ux_04_ac2_phone_frame', async ({ browser }) => {
  await tour(browser, RA9_ROUTES, async (page, route) => {
    for (const size of [FRAME, SMALL]) {
      await page.setViewportSize(size);
      await sleep(100);
      const how = `${route} at ${size.width} × ${size.height}`;
      const bar = await rect(appBar(page));
      const nav = await rect(bottomBar(page));
      assert.ok(bar && nav, `${how}: app bar and bottom bar`);
      assert.ok(Math.abs(bar!.top) <= 1, `${how}: the app bar is at the top (${bar!.top})`);
      assert.ok(Math.abs(nav!.bottom - size.height) <= 1, `${how}: the bottom bar is at the bottom (${nav!.bottom})`);
      assert.ok(bar!.height - INSETS.top >= 48 - 1, `${how}: the app bar's content row is at least 48 px (${bar!.height} with the 36 px inset)`);
      const names = (await bottomBar(page).getByRole('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? (b as HTMLElement).innerText).replace(/\s+/g, ' ').trim())));
      assert.deepEqual(names, ['Menu', 'Search', 'New', 'Today'], `${how}: the bottom bar's buttons in order`);
      const labels = await bottomBar(page).locator('span.phone-tab-label').allInnerTexts();
      assert.deepEqual(labels.map(flat), ['Menu', 'Search', 'New', 'Today'], `${how}: each with a visible label`);
      const nw = barButton(page, 'New');
      assert.equal(await nw.getAttribute('aria-disabled'), 'true', `${how}: New is aria-disabled`);
      assert.equal(await nw.getAttribute('aria-description'), 'Creating objects comes with editing on the phone.', `${how}: New's description (phone.newLater)`);

      // scrolling main by 2,000 px leaves both bars in place, and nothing else scrolls vertically
      await page.evaluate(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement; m.scrollTop += 2000; window.scrollBy(0, 2000); });
      await sleep(150);
      const bar2 = await rect(appBar(page));
      const nav2 = await rect(bottomBar(page));
      assert.ok(Math.abs(bar2!.top - bar!.top) <= 1 && Math.abs(bar2!.height - bar!.height) <= 1, `${how}: the app bar doesn't move with main's scroll`);
      assert.ok(Math.abs(nav2!.top - nav!.top) <= 1 && Math.abs(nav2!.height - nav!.height) <= 1, `${how}: the bottom bar doesn't move with main's scroll`);
      assert.equal(await page.evaluate(() => (document.scrollingElement as HTMLElement).scrollTop), 0, `${how}: the document doesn't scroll`);
      const others = (await verticalScrollers(page)).filter((s) => !s.startsWith('main'));
      assert.deepEqual(others, [], `${how}: main is the only vertical scroller`);
      await page.evaluate(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement; m.scrollTop = 0; });
    }
    if (route.startsWith('note/')) {
      for (const size of [FRAME, SMALL]) {
        await page.setViewportSize(size);
        await sleep(100);
        const p = page.getByRole('article', { name: title(route)! }).locator('p').first();
        const r = await rect(p);
        assert.ok(r, `${route}: a paragraph of the read view`);
        assert.ok(Math.abs(r!.width - (size.width - 32)) <= 1, `${route} at ${size.width}: the text column is the viewport minus 32 px (${r!.width})`);
        assert.ok(Math.abs(r!.left - 16) <= 1, `${route} at ${size.width}: 16 px from the left edge (${r!.left})`);
      }
    }
  });

  // A tap on New changes nothing and sends no command; Back exactly when the history has an earlier entry.
  const page = await phonePage(browser);
  const core = await startPhone(page, { route: 'inbox' });
  await must(page.getByRole('main', { name: 'Inbox' }), 'the cold start on inbox');
  const before = await fileStateOf(core);
  assert.equal(await page.getByRole('banner').getByRole('button', { name: 'Back' }).count(), 0, 'after a cold start on inbox: no Back');
  const n = (await core.calls()).length;
  await barButton(page, 'New').click({ force: true });
  await sleep(500);
  assert.equal(await mainName(page), 'Inbox', 'a tap on New changes nothing');
  assert.deepEqual((await core.calls()).slice(n).map((c) => c.cmd), [], 'a tap on New sends no command');
  await (await must(page.getByRole('main').getByText('Nápad z vlaku', { exact: true }), 'the Inbox row Nápad z vlaku')).click();
  assert.equal(await eventually(() => mainName(page), (x) => x === 'Nápad z vlaku', 3000), 'Nápad z vlaku', 'the row opens the note');
  await must(appBar(page).getByRole('button', { name: 'Back' }), 'after opening a note from the Inbox: Back');
  assert.equal(await appBar(page).getByRole('button', { name: 'Back' }).count(), 1, 'one Back');
  await assertZeroWrites(core, before, 'the frame');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-3 (L5p)

/** Elements with text or a role (button, link, heading, textbox) whose box intersects the status bar (top inset) or
 *  the navigation bar (bottom inset). */
async function underBars(page: Page, insets = INSETS): Promise<string[]> {
  return page.evaluate((i) => {
    const out: string[] = [];
    const h = innerHeight;
    const ROLE = /^(button|link|heading|textbox|searchbox|combobox|tab|menuitem|checkbox|radio|switch|option)$/;
    for (const e of document.querySelectorAll('body *') as NodeListOf<HTMLElement>) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      const role = e.getAttribute('role') ?? ({ BUTTON: 'button', A: 'link', H1: 'heading', H2: 'heading', H3: 'heading', INPUT: 'textbox', TEXTAREA: 'textbox' } as Record<string, string>)[e.tagName] ?? '';
      const ownText = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim());
      if (!ownText && !ROLE.test(role)) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= h) continue;
      if (r.top < i.top - 0.5 || r.bottom > h - i.bottom + 0.5) out.push(`${e.tagName.toLowerCase()}${role ? `[${role}]` : ''} "${(e.getAttribute('aria-label') ?? e.innerText ?? '').trim().slice(0, 30)}" ${Math.round(r.top)}…${Math.round(r.bottom)}`);
    }
    return out.slice(0, 10);
  }, insets);
}

test('fr_ux_04_ac3_safe_areas', async ({ browser }) => {
  await tour(browser, ['inbox', `note/${PH.mapa}`, 'type/book', 'search'], async (page, route) => {
    assert.deepEqual(await underBars(page), [], `${route}: nothing with text or a role under the status or navigation bar`);
    const bar = await rect(appBar(page).getByRole('heading', { level: 1 }).or(appBar(page).getByRole('search')));
    assert.ok(bar && bar.top >= INSETS.top - 0.5, `${route}: the app bar's content starts below the 36 px status bar (${bar?.top})`);
    const buttons = await bottomBar(page).getByRole('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().bottom));
    assert.ok(buttons.length === 4 && buttons.every((b) => b <= FRAME.height - INSETS.bottom + 0.5), `${route}: the bottom bar's buttons end above the 24 px navigation bar (${buttons})`);
    const bg = await page.evaluate(() => {
      const top = document.elementFromPoint(200, 10) as HTMLElement | null;
      let e: HTMLElement | null = top;
      while (e && getComputedStyle(e).backgroundColor.replace(/\s/g, '') === 'rgba(0,0,0,0)') e = e.parentElement;
      return { under: e ? getComputedStyle(e).backgroundColor : getComputedStyle(document.body).backgroundColor, bg: getComputedStyle(document.body).backgroundColor };
    });
    assert.equal(bg.under, bg.bg, `${route}: under the status bar the theme's bg is drawn`);
    await openDrawer(page);
    const d = await rect(drawer(page));
    assert.ok(d && d.top >= INSETS.top - 0.5 && d.bottom <= FRAME.height - INSETS.bottom + 0.5, `${route}: the drawer runs from the top inset to the bottom inset (${d?.top}…${d?.bottom})`);
    assert.deepEqual(await underBars(page), [], `${route}, drawer open: nothing under the system bars`);
    await page.keyboard.press('Escape');
  });
  // a sheet
  const page = await phonePage(browser);
  await startPhone(page, { route: `note/${PH.mapa}` });
  await (await must(moreButton(page), 'the note\'s More actions')).click();
  await (await must(moreMenu(page).getByRole('menuitem', { name: 'Properties' }), 'More actions › Properties')).click();
  const s = await rect(sheet(page, 'Properties'));
  assert.ok(s && s.bottom <= FRAME.height - INSETS.bottom + 0.5, `the Properties sheet ends above the navigation bar (${s?.bottom})`);
  assert.deepEqual(await underBars(page), [], 'sheet open: nothing under the system bars');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-4 (L5p)

test('fr_ux_04_ac4_keyboard_never_hides_the_field', async ({ page }) => {
  const vault = pageVault(addHromada);
  await startPhone(page, { vault, route: 'search', now: '2026-10-14T12:00:00+02:00' });
  const field = await must(page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })), 'field "Search query"');
  await field.focus();
  await field.fill('ostružiník');
  await keyboard(page, true);
  await sleep(300);
  const within = async (loc: ReturnType<Page['locator']>, what: string) => {
    const r = await rect(loc);
    assert.ok(r && r.top >= -0.5 && r.bottom <= KEYBOARD.height + 0.5, `${what} lies fully above the keyboard (${r?.top}…${r?.bottom} in 412 × 520)`);
  };
  await within(field, 'Search query');
  await within(page.getByRole('button', { name: 'Clear search' }), 'Clear search');
  assert.equal(await seen(bottomBar(page), 300), false, 'the bottom bar is hidden while the keyboard is shown');
  const more = page.getByRole('button', { name: 'Show next 10' });
  await must(more, 'Show next 10 with ostružiník and the 60 runtime notes', 5000);
  await more.scrollIntoViewIfNeeded();
  await within(more, 'Show next 10, scrolled to the end');
  await keyboard(page, false);
  await must(bottomBar(page), 'hiding the keyboard brings the bottom bar back', 500);
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-5

const ROLES_48 = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'checkbox', 'radio', 'switch', 'option']);
async function targetsOk(page: Page, how: string, scope?: ReturnType<Page['locator']>) {
  const all = (await controls(page, scope)).filter((c) => !c.inert);
  const small = all.filter((c) => ROLES_48.has(c.role) && !c.exempt && (c.hitW < 48 || c.hitH < 48))
    .map((c) => `${c.role} "${c.name.slice(0, 30)}" ${Math.round(c.hitW)}×${Math.round(c.hitH)}`);
  assert.deepEqual(small, [], `${how}: every control has a 48 × 48 hit area`);
  const exempt = all.filter((c) => c.exempt);
  const near: string[] = [];
  for (const e of exempt) {
    for (const o of all) {
      if (o === e) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < 24) near.push(`"${e.name.slice(0, 20)}" – "${o.name.slice(0, 20)}" ${d.toFixed(1)} px`);
    }
  }
  assert.deepEqual([...new Set(near)], [], `${how}: exempt targets are at least 24 px from every other target (WCAG 2.5.8)`);
}

test('fr_ux_04_ac5_touch_targets', async ({ browser }) => {
  await tour(browser, RA9_ROUTES, async (page, route) => {
    await page.setViewportSize(SMALL);
    await sleep(150);
    await targetsOk(page, route);
    await openDrawer(page);
    await targetsOk(page, `${route}, drawer open`, drawer(page));
    if (route === 'inbox') {
      await (await must(drawer(page).getByRole('button', { name: /^Vault: .*\. Switch vault$/ }), 'the vault switcher')).click();
      const menu = await must(page.getByRole('menu', { name: 'Vaults' }), 'menu "Vaults"');
      await targetsOk(page, 'the Vaults menu', menu);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    if (route.startsWith('note/')) {
      await (await must(moreButton(page), 'More actions')).click();
      await targetsOk(page, `${route}, More actions open`, await must(moreMenu(page), 'menu "More actions"'));
      await (await must(moreMenu(page).getByRole('menuitem', { name: 'Properties' }), 'Properties')).click();
      await targetsOk(page, `${route}, Properties sheet open`, await must(sheet(page, 'Properties'), 'sheet "Properties"'));
    }
  });
  // List rows are at least 56 px high (board N1).
  const rowsOf: [string, string][] = [
    ['inbox', 'main li'], ['queries', 'main [data-query-row]'], ['tags', 'main [role="row"]:has([role="cell"]), main li'],
    ['query/Seskupeno podle data', 'main [data-query-result]'],
  ];
  for (const [route, sel] of rowsOf) {
    const page = await phonePage(browser);
    await startPhone(page, { route, viewport: SMALL });
    await must(page.locator(sel), `${route}: list rows (${sel})`, 5000);
    const hs = await page.locator(sel).evaluateAll((els) => els.map((e) => (e.closest('li, tr, [role="row"]') ?? e).getBoundingClientRect().height));
    assert.ok(hs.length > 0 && hs.every((h) => h >= 56 - 0.5), `${route}: every row is at least 56 px high (${hs.map(Math.round).join(', ')})`);
    await page.close();
  }
  const page = await phonePage(browser);
  await startPhone(page, { vault: pageVault(), route: 'search', viewport: SMALL, now: '2026-10-14T12:00:00+02:00' });
  await page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })).fill('rozpočet');
  const res = page.getByRole('list', { name: 'Search results' }).getByRole('listitem');
  await must(res, 'search results for rozpočet', 5000);
  const hs = await res.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(hs.every((h) => h >= 56 - 0.5), `search results: every row is at least 56 px high (${hs.map(Math.round).join(', ')})`);
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-6

const readVault = () => loadVault('Čtení', ['read-view', 'new-empty/.tegg']);
const SIROKA = (() => {
  const items = Array.from({ length: 7 }, (_, i) => `Dlouhá větev číslo ${i + 1} se čtyřiceti znaky`.padEnd(40, '.').slice(0, 40));
  return '---\nid: 01JB4M0000000000000000M020\ntype: page\ntitle: Široká mapa\n---\n> [!mindmap] Široká\n' + items.map((t, i) => `> ${'  '.repeat(i)}- ${t}`).join('\n') + '\n';
})();
const mapVault = () => loadVault('Mapy', ['mindmap', 'new-empty/.tegg'], (f) => { f['Pages/Široká mapa.md'] = SIROKA; });

async function noSideways(page: Page, how: string) {
  for (const size of [SMALL, FRAME] as Size[]) {
    await page.setViewportSize(size);
    await sleep(200);
    const o = await sidewaysOverflow(page);
    assert.equal(o.scrollWidth, o.innerWidth, `${how} at ${size.width}: the page has no sideways scroll (scrollWidth ${o.scrollWidth})`);
    assert.deepEqual(o.offenders, [], `${how} at ${size.width}: every element wider than the column scrolls in its own box (overflow-x: auto)`);
  }
}

test('fr_ux_04_ac6_no_sideways_page_scroll', async ({ browser }) => {
  const notes = [PH.mapa, PH.siroky, PH.ven, PH.dlouha, PH.cteni].map((p) => `note/${p}`);
  await tour(browser, [...RA9_ROUTES, ...notes], (page, route) => noSideways(page, route));
  await tour(browser, ['note/Pages/Bloky.md', 'note/Pages/Odkazy.md'], (page, route) => noSideways(page, route), { vault: readVault(), now: '2026-10-14T12:00:00+02:00' });
  await tour(browser, ['note/Pages/Uzly.md', 'note/Pages/Široká mapa.md'], (page, route) => noSideways(page, route), { vault: mapVault(), now: '2026-10-22T10:00:00+02:00' });
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-7 (L5p)

test('fr_ux_04_ac7_rotation_keeps_the_place', async ({ page }) => {
  const core = await startPhone(page, { route: `note/${PH.dlouha}` });
  await must(page.getByRole('main', { name: 'Dlouhá poznámka' }), 'Dlouhá poznámka');
  const before = await fileStateOf(core);
  await scrollBlockToTop(page, 'Druhá kapitola');
  await sleep(200);
  assert.match(await firstVisibleBlock(page), /^Druhá kapitola/, 'setup: Druhá kapitola is the first visible block');
  const ok = (b: string) => /^(Druhá kapitola|Další odstavec 1:|Odstavec 40:)/.test(b);
  for (const size of [LANDSCAPE, FRAME]) {
    await page.setViewportSize(size);
    await sleep(400);
    const how = `${size.width} × ${size.height}`;
    assert.equal(await mainName(page), 'Dlouhá poznámka', `${how}: the route stays`);
    assert.equal(await layoutAttr(page), 'phone', `${how}: the phone layout`);
    const b = await firstVisibleBlock(page);
    assert.ok(ok(b), `${how}: Druhá kapitola is still the first visible block (± one line): "${b}"`);
  }
  const marks = (await core.perfMarks()).filter((m) => m.name === 'ui-ready');
  assert.ok(marks.length <= 1, `no second ui-ready mark (${marks.length})`);
  await assertZeroWrites(core, before, 'rotation');
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-18

test('fr_ux_07_ac18_indexing_status_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { route: 'inbox' });
  await core.emit('index:progress', { done: 120, total: 500, state: 'running' });
  const line = await must(page.getByRole('status', { name: 'Indexing progress' }), 'status "Indexing progress"');
  assert.match(flat(await line.innerText()), /Indexing 120 of 500/, 'Indexing <done> of <total>');
  const bar = await rect(appBar(page));
  const r = await rect(line);
  assert.ok(bar && r && Math.abs(r.top - bar.bottom) <= 1, `directly below the app bar (${r?.top} vs ${bar?.bottom})`);
  assert.equal(await line.getAttribute('aria-modal'), null, 'not modal');
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0, 'no modal while indexing');
  await openDrawer(page);
  await page.keyboard.press('Escape');
  await barButton(page, 'Search').click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Search', 3000), 'Search', 'the bottom bar works while indexing');
  await core.emit('index:progress', { done: 500, total: 500, state: 'done' });
  const gone = await eventually(() => page.getByRole('status', { name: 'Indexing progress' }).count(), (n) => n === 0, 1000);
  assert.equal(gone, 0, 'the line disappears within 1 s of done');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-26 (L5p)

test('fr_ux_08_ac26_talkback_reads_the_frame', async ({ page }) => {
  await startPhone(page, { route: 'inbox' });
  const names = await bottomBar(page).getByRole('button').evaluateAll((bs) => bs.map((b) => ({ name: (b.getAttribute('aria-label') ?? (b as HTMLElement).innerText).trim(), disabled: b.getAttribute('aria-disabled') })));
  assert.deepEqual(names.map((n) => n.name), ['Menu', 'Search', 'New', 'Today'], 'the bottom bar reads Menu, Search, New, Today');
  assert.equal(names[2].disabled, 'true', 'New is not enabled');
  await (await must(page.getByRole('main').getByText('Koupit čaj', { exact: true }), 'the Inbox row Koupit čaj')).click();
  await must(appBar(page).getByRole('button', { name: 'Back' }), 'Back in the app bar after one navigation');

  const d = await openDrawer(page);
  assert.equal(await d.getAttribute('aria-modal'), 'true', 'the drawer is aria-modal');
  const outside = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Navigation"]');
    const m = document.querySelector('main');
    const nav = document.querySelector('nav[aria-label="Main"]');
    const inert = (e: Element | null) => !e || !!e.closest('[inert]') || !document.body.contains(e);
    return { main: inert(m), nav: inert(nav), dialogInert: !!dlg?.closest('[inert]') };
  });
  assert.deepEqual(outside, { main: true, nav: true, dialogInert: false }, 'behind the drawer the page is inert (main and the bottom bar), the drawer is not');
  await page.keyboard.press('Escape');
  await (await must(moreButton(page), 'More actions')).click();
  await (await must(moreMenu(page).getByRole('menuitem', { name: 'Properties' }), 'Properties')).click();
  const s = await must(sheet(page, 'Properties'), 'sheet "Properties" (RA13 phone.properties)');
  assert.equal(await s.getAttribute('aria-modal'), 'true', 'the sheet is aria-modal');
  assert.equal(await page.evaluate(() => !!document.querySelector('main')?.closest('[inert]')), true, 'behind the sheet the page is inert');
  assert.equal(await pageHeading(page).count() >= 1, true, 'the page heading stays in the tree');
});
