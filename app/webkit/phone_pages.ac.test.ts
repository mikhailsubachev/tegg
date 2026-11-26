// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md RA9, RA11:
// - FR-INB-01 AC-14 (the read-only Inbox), AC-15 (no row swipes), AC-16 (Inbox zero);
// - FR-DLY-01 AC-13 (Today writes nothing), FR-DLY-03 AC-8 (day navigation by touch);
// - FR-TAG-07 AC-7 (All tags), FR-TAG-06 AC-14 (the tag page);
// - FR-SRC-03 AC-22 (the Search page without create buttons), FR-NAV-01 AC-24 (L5p: `enterkeyhint` and the key);
// - FR-SYN-04 AC-13 (Conflicts, read-only), FR-SET-01 AC-14 (Settings), FR-SET-02 AC-11 (L5p: the Theme control),
//   FR-UX-06 AC-1 (empty states).
// Contract docs/contracts/android-phone.md §9.7…§9.10, §14.1. Fixtures: inbox/, daily/, tags/, search/ + search-page/,
// conflicts/, shell/, views/ + phone/.
// Red-test readings (reported): "the desktop's …" texts and orders are read from a `macos` page in the same test; the
// Inbox date lines are checked with the Date & time setting `ISO` (`Captured 2026-10-14 …`); the tag rows keep the
// desktop's `data-tag` / `data-path` marks; Inbox rows are `li` elements of `main` under their `h2` group heading.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { I, inboxVault, reviewedText } from './capture-helpers';
import { conflictsVault } from './editor-helpers';
import { addHromada, pageVault } from './search-page-helpers';
import { shellVault } from './helpers';
import {
  appBar, assertZeroWrites, barButton, bottomBar, desktopPage, drawer, drawerEntry, eventually, fileStateOf, flat, isChromium, loadVault, longPress, main,
  mainName, must, nfc, openDrawer, pageHeading, phonePage, rect, seen, sleep, startDesktop, startPhone, systemBack, touchDrag, ui, SMALL,
} from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const INBOX_NOW = '2026-10-14T12:00:00+02:00';
const ISO = { dateTime: { date: 'iso', time: '24', week: 'region' } };
const h1 = (page: Page) => appBar(page).getByRole('heading', { level: 1 });
const h1Is = async (page: Page, text: string, ms = 3000) => (await eventually(async () => flat(await h1(page).first().innerText().catch(() => '')), (t) => t === text, ms));

/** The Inbox on the phone: groups by their `h2` heading, each with its rows' lines (title first). */
async function phoneInbox(page: Page): Promise<{ group: string; rows: string[][] }[]> {
  return main(page).first().evaluate((m) => {
    const out: { group: string; rows: string[][] }[] = [];
    const walker = document.createTreeWalker(m, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode() as HTMLElement | null; n; n = walker.nextNode() as HTMLElement | null) {
      if (n.tagName === 'H2') out.push({ group: (n.innerText ?? '').trim(), rows: [] });
      else if (n.tagName === 'LI' && out.length) out[out.length - 1].rows.push((n.innerText ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim().normalize('NFC')).filter(Boolean));
    }
    return out;
  });
}
const PRAGUE = [
  ['Today', ['Žluťoučký kůň', 'Aplikace na čaj', 'Koupit mléko', 'Zavolat instalatérovi', 'Bez offsetu']],
  ['Yesterday', ['Nápad na článek', '2026-10-13']],
  ['Earlier this week', ['Porada týmu']],
  ['Older', ['Zachycená stránka', 'Bez stavu', 'Divná hodnota', '2026-10-07', 'Bez data']],
] as const;
const LOS_ANGELES = [
  ['Today', ['Bez offsetu', 'Žluťoučký kůň', 'Aplikace na čaj']],
  ['Yesterday', ['Koupit mléko', 'Zavolat instalatérovi', 'Nápad na článek']],
  ['Earlier this week', ['2026-10-13', 'Porada týmu']],
  ['Older', ['Zachycená stránka', 'Bez stavu', 'Divná hodnota', '2026-10-07', 'Bez data']],
] as const;
const RELATIVE = /\b(\d+\s?(h|min|m|d)|Yesterday|Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun|ago)\b/;

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-14

test('fr_inb_01_ac14_inbox_read_only_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: INBOX_NOW, uiState: ui({ extra: ISO }) });
  const before = await fileStateOf(core);
  assert.equal(await h1Is(page, 'Inbox'), 'Inbox', 'the heading Inbox');
  await must(main(page).getByText('13 to review', { exact: true }), 'the summary "13 to review"');
  const got = await eventually(() => phoneInbox(page), (g) => g.length === 4, 3000);
  assert.deepEqual(got.map((g) => [g.group, g.rows.map((r) => r[0])]), PRAGUE, 'R61\'s groups and order (Prague, cs)');
  for (const g of got) {
    for (const r of g.rows) {
      if (r[0] === 'Bez data') assert.equal(r.length, 1, 'Q8: no date line');
      else {
        assert.equal(r.length, 2, `${r[0]}: the title and one date line: ${JSON.stringify(r)}`);
        assert.match(r[1], /^(Captured|Created) \d{4}-\d{2}-\d{2}\b/, `${r[0]}: "Captured <date-time>" or "Created <date-time>" in the Date & time setting`);
      }
      assert.doesNotMatch(r.slice(1).join(' '), RELATIVE, `${r[0]}: no relative time in place of the date`);
    }
  }
  const q1 = got[0].rows.find((r) => r[0] === 'Koupit mléko');
  assert.match(q1?.[1] ?? '', /^Captured 2026-10-14\b/, 'Q1: Captured 2026-10-14 …');
  const heights = await main(page).locator('li').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().height));
  assert.ok(heights.length === 13 && heights.every((h) => h >= 56 - 0.5), `13 rows of at least 56 px (${heights.map(Math.round)})`);
  const icons = await main(page).locator('li').evaluateAll((ls) => ls.map((l) => !!l.querySelector('[data-icon], svg')));
  assert.ok(icons.every(Boolean), 'each row has its type icon');
  // RA11: hidden
  assert.equal(await main(page).getByRole('group', { name: 'Filter by type' }).count(), 0, 'no type filter');
  for (const name of ['Mark all reviewed', 'Quick Capture']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `no "${name}"`);
  assert.equal(await main(page).getByRole('button', { name: /^Triage actions/ }).count(), 0, 'no Triage actions');
  // Slice AND-3 (android-edit.md FR-INB-02 AC-18, contract §12.2, §20; D-2403): one `Reviewed` checkbox per row, no
  // selection (AC-Test-Change, approved by the owner with the contract, D-2541)
  assert.equal(await main(page).getByRole('checkbox', { name: 'Reviewed', exact: true }).count(), 13, 'a Reviewed checkbox per row');
  assert.equal(await main(page).getByRole('checkbox').count(), 13, 'no other checkbox (no selection)');
  assert.equal(await main(page).getByRole('toolbar').count(), 0, 'no toolbar');
  assert.equal(await main(page).locator('kbd').count(), 0, 'no key hint');
  // A tap on D1 opens daily/2026-10-13; Back returns with the scroll and the focus on that row.
  await main(page).evaluate((m) => { const s = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement; s.scrollTop = 200; void m; });
  const scroll = await main(page).first().evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
  await (await must(main(page).locator('li').filter({ has: page.getByText('2026-10-13', { exact: true }) }).first(), 'the row D1')).click();
  assert.equal(await h1Is(page, '2026-10-13'), '2026-10-13', 'D1 opens daily/2026-10-13');
  await systemBack(page);
  assert.equal(await h1Is(page, 'Inbox'), 'Inbox', 'Back returns to inbox');
  const scroll2 = await main(page).first().evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
  assert.ok(Math.abs(scroll2 - scroll) <= 2, `with the same scroll position (${scroll} → ${scroll2})`);
  assert.match(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('li')?.innerText ?? ''), /2026-10-13/, 'and the focus on that row');
  await assertZeroWrites(core, before, 'the Inbox');
  await page.close();

  // (TZ) Los Angeles
  const ctx = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  page = await ctx.newPage();
  await startPhone(page, { vault: inboxVault(), route: 'inbox', now: '2026-10-14T03:00:00-07:00', uiState: ui({ extra: ISO }) });
  const la = await eventually(() => phoneInbox(page), (g) => g.length === 4, 3000);
  assert.deepEqual(la.map((g) => [g.group, g.rows.map((r) => r[0])]), LOS_ANGELES, 'R61\'s (TZ) row in Los Angeles');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-15

test('fr_inb_01_ac15_no_row_swipes', async ({ page }) => {
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: INBOX_NOW });
  const before = await fileStateOf(core);
  const row = await must(main(page).locator('li').filter({ hasText: 'Koupit mléko' }).first(), 'Q1\'s row');
  const r = await rect(row);
  const c = { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 };
  for (const dx of [200, -200]) {
    await touchDrag(page, { x: dx > 0 ? c.x - 100 : c.x + 100, y: c.y }, dx, 0);
    await sleep(400);
    assert.equal(await h1Is(page, 'Inbox'), 'Inbox', `a ${dx > 0 ? 'right' : 'left'} swipe changes no route`);
    assert.equal(await page.getByRole('menu').count(), 0, 'no menu');
  }
  const prevented = await longPress(page, c, 800);
  await sleep(300);
  assert.equal(await page.getByRole('menu').count(), 0, 'a long press of 800 ms shows no menu');
  assert.equal(prevented, true, 'and no WebView context menu');
  assert.equal(await h1Is(page, 'Inbox'), 'Inbox', 'no route change');
  assert.equal((await core.files())[nfc(I.Q1)], before.files[nfc(I.Q1)], 'Q1 is not reviewed');
  await assertZeroWrites(core, before, 'swipes and a long press');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-16

test('fr_inb_01_ac16_inbox_zero_on_the_phone', async ({ page }) => {
  const vault = inboxVault((f) => {
    for (const k of ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'D1', 'D3', 'N1', 'P1', 'T1', 'S1'] as const) {
      const p = nfc(I[k]);
      const t = f[p];
      f[p] = /^review: .*$/m.test(t) ? t.replace(/^review: .*$/m, 'review: reviewed') : t.replace(/^---\n/, '---\nreview: reviewed\n');
    }
  });
  const core = await startPhone(page, { vault, route: 'inbox', now: INBOX_NOW });
  const before = await fileStateOf(core);
  const zero = await must(page.getByRole('region', { name: 'Inbox zero' }), 'region "Inbox zero"');
  await must(zero.getByRole('heading', { name: 'Inbox zero' }), 'its heading');
  await must(zero.getByText(/Everything you captured has been reviewed\./), 'its text (R60)');
  assert.equal(await page.getByRole('button', { name: 'Quick Capture' }).count(), 0, 'no Quick Capture button');
  await (await must(zero.getByRole('button', { name: 'Open today\'s note' }), 'button "Open today\'s note"')).click();
  assert.equal(await h1Is(page, '2026-10-14'), '2026-10-14', 'it opens daily/<today>');
  await assertZeroWrites(core, before, 'Inbox zero');
});

// ------------------------------------------------------------------------------------------------ FR-DLY-01 AC-13

const dailyVault = () => loadVault('Deník', ['daily', 'new-empty/.tegg']);
const DAILY_NOW = '2026-10-14T12:00:00+02:00';

test('fr_dly_01_ac13_today_on_the_phone_writes_nothing', async ({ page }) => {
  const core = await startPhone(page, { vault: dailyVault(), route: 'inbox', now: DAILY_NOW });
  const before = await fileStateOf(core);
  for (const how of ['bottom bar', 'drawer'] as const) {
    if (how === 'bottom bar') await barButton(page, 'Today').click();
    else { await drawerEntry(page, 'Inbox'); await h1Is(page, 'Inbox'); await drawerEntry(page, 'Today'); }
    assert.equal(await h1Is(page, '2026-10-14'), '2026-10-14', `${how}'s Today opens daily/2026-10-14`);
    assert.equal(await barButton(page, 'Today').getAttribute('aria-current'), 'page', `${how}: Today is aria-current on today's route`);
    // the virtual day is the editor on AND-3's phone (android-edit.md §7.1; D-2554); opening it writes nothing (below)
    assert.ok(await seen(page.getByRole('textbox', { name: 'Note body' }), 3000), `${how}: the virtual day shows the editor (textbox "Note body")`);
    assert.equal(await main(page).getByRole('button', { name: /^(Reviewed|Mark reviewed)$/ }).count(), 0, `${how}: no review toggle`);
  }
  await drawerEntry(page, 'Inbox');
  await sleep(1000);
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Daily/2026-10-14')), 'no file appears in Daily/ (also after leaving the page)');
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'daily_create').length, 0, 'no daily_create');
  await assertZeroWrites(core, before, 'Today');
  const p2 = await page.context().newPage();
  await startPhone(p2, { vault: dailyVault(), route: 'daily/2026-10-07', now: DAILY_NOW });
  assert.equal(await h1Is(p2, '2026-10-07'), '2026-10-07', 'a day with a file');
  await must(main(p2).getByText(/Ráno porada/), 'shows its read view');
  assert.equal(await p2.locator('[contenteditable="true"], .ProseMirror').count(), 0, 'no editor');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-DLY-03 AC-8

test('fr_dly_03_ac8_day_navigation_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: dailyVault(), route: 'daily/2026-10-14', now: DAILY_NOW, viewport: SMALL });
  const before = await fileStateOf(core);
  assert.equal(await h1Is(page, '2026-10-14'), '2026-10-14', 'daily/2026-10-14');
  for (const name of ['Previous day', 'Next day', 'Pick date']) {
    const r = await rect(main(page).getByRole('button', { name, exact: true }));
    assert.ok(r && r.width >= 48 - 0.5 && r.height >= 48 - 0.5, `${name} is at least 48 × 48 (${r?.width} × ${r?.height})`);
  }
  await main(page).getByRole('button', { name: 'Previous day', exact: true }).click();
  assert.equal(await h1Is(page, '2026-10-13'), '2026-10-13', 'Previous day');
  await main(page).getByRole('button', { name: 'Next day', exact: true }).click();
  await main(page).getByRole('button', { name: 'Next day', exact: true }).click();
  assert.equal(await h1Is(page, '2026-10-15'), '2026-10-15', 'Next day twice');
  await main(page).getByRole('button', { name: 'Pick date', exact: true }).click();
  const cal = await must(page.getByRole('dialog', { name: 'Calendar' }), 'dialog "Calendar" (D-763)');
  assert.equal(await cal.getAttribute('aria-modal'), 'true', 'a modal dialog');
  const r = await rect(cal);
  assert.ok(r && r.left >= 16 - 0.5 && r.right <= SMALL.width - 16 + 0.5, `it fits the 360 px viewport within 16 px each side (${r?.left}…${r?.right})`);
  const marked = await cal.locator('[data-has-note="true"]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? ''));
  assert.ok(marked.length >= 4, `the days that have notes are marked (${marked.length})`);
  await cal.getByRole('gridcell').getByRole('button', { name: /7/ }).first().click();
  assert.equal(await h1Is(page, '2026-10-07'), '2026-10-07', 'choosing a day opens daily/<date>');
  await assertZeroWrites(core, before, 'day navigation');
});

// ------------------------------------------------------------------------------------------------ FR-TAG-07 AC-7, FR-TAG-06 AC-14

const tagsVault = () => loadVault('Štítky', ['tags', 'new-empty/.tegg']);
const TAGS_NOW = '2026-10-22T10:00:00+02:00';
const tagRows = (page: Page) => main(page).locator('[data-tag]').evaluateAll((rs) => rs.map((r) => ({ key: (r.getAttribute('data-tag') ?? '').normalize('NFC'), text: (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim().normalize('NFC'), colour: getComputedStyle((r.querySelector('[data-tag-colour], .tag-colour, [data-colour]') ?? r) as Element).backgroundColor })));

test('fr_tag_07_ac7_all_tags_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: tagsVault(), route: 'inbox', now: TAGS_NOW });
  const before = await fileStateOf(core);
  await drawerEntry(page, 'Tags');
  assert.equal(await h1Is(page, 'Tags'), 'Tags', 'drawer Tags opens tags');
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { vault: tagsVault(), route: 'tags', now: TAGS_NOW });
  await must(desk.getByRole('main').getByRole('heading', { level: 1, name: 'Tags' }), 'desktop: All tags');
  const want = await eventually(() => tagRows(desk), (r) => r.length > 0, 3000);
  const got = await eventually(() => tagRows(page), (r) => r.length === want.length, 3000);
  assert.deepEqual(got.map((r) => r.key), want.map((r) => r.key), 'one row per tag in R80\'s order (as the desktop)');
  assert.deepEqual(got.map((r) => r.text), want.map((r) => r.text), 'with the desktop\'s counts');
  const sumDesk = flat(await desk.getByRole('main').getByText(/^\d+ tags?\b/).first().innerText());
  await must(main(page).getByText(sumDesk, { exact: true }), `R81's summary "${sumDesk}"`);
  for (const name of ['New tag', 'Tag colour', 'Rename…', 'Delete…', 'Merge…']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `no "${name}"`);
  assert.equal(await main(page).getByRole('textbox', { name: 'Find a tag' }).count(), 0, 'no find field');
  await main(page).locator('[data-tag="účty"]').first().click();
  assert.equal(await h1Is(page, '#účty'), '#účty', 'a tap opens tag/účty');
  await context.close();
  await assertZeroWrites(core, before, 'All tags');
});

test('fr_tag_06_ac14_tag_page_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: tagsVault(), route: `tag/${encodeURIComponent('účty')}`, now: TAGS_NOW });
  const before = await fileStateOf(core);
  assert.equal(await h1Is(page, '#účty'), '#účty', 'the heading #účty');
  const tile = main(page).locator('[data-tag-colour], .tag-colour-tile, .colour-tile').first();
  assert.equal(await main(page).getByRole('button', { name: 'Tag colour' }).count(), 0, 'the colour tile is not a button (no Tag colour popover)');
  assert.ok(await seen(tile, 1000) ? (await tile.evaluate((e) => e.tagName)) === 'SPAN' : true, 'the colour tile is a span');
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { vault: tagsVault(), route: `tag/${encodeURIComponent('účty')}`, now: TAGS_NOW });
  const paths = (p: Page) => p.getByRole('main').locator('[data-path]').evaluateAll((rs) => rs.map((r) => (r.getAttribute('data-path') ?? '').normalize('NFC')));
  // D-2451: 6 objects (the tags fixture, R82).
  const want = await eventually(() => paths(desk), (x) => x.length === 6, 3000);
  assert.equal(want.length, 6, 'setup: the desktop lists 6 objects');
  assert.deepEqual(await eventually(() => paths(page), (x) => x.length === 6, 3000), want, 'its 6 objects in the desktop\'s default order');
  const countDesk = flat(await desk.getByRole('main').getByText(/\b6 objects\b/).first().innerText());
  await must(main(page).getByText(countDesk, { exact: true }), `R82's count line "${countDesk}"`);
  await context.close();
  assert.equal(await main(page).getByRole('button', { name: /^Type/ }).count(), 0, 'no Type filter');
  for (const name of ['Tag actions', 'Rename…', 'Delete…', 'Merge…', 'Tag colour']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `no "${name}"`);
  const chip = main(page).locator('[data-path]').first().getByRole('link', { name: /^#/ }).first();
  if (await seen(chip, 500)) {
    const name = flat(await chip.innerText());
    await chip.click();
    assert.equal(await h1Is(page, name), name, 'a tag chip in a row opens its tag page');
    await systemBack(page);
    await h1Is(page, '#účty');
  }
  await main(page).locator('[data-path]').first().click();
  assert.notEqual(await h1Is(page, '#účty', 1000), '#účty', 'a tap on a row opens it');
  await assertZeroWrites(core, before, 'the tag page');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-22

const SEARCH_NOW = '2026-10-14T12:00:00+02:00';
const query = (page: Page) => page.getByRole('search').getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('search').getByRole('textbox', { name: 'Search query' }));
const results = (page: Page) => main(page).getByRole('list', { name: 'Search results' });

test('fr_src_03_ac22_search_page_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: pageVault(addHromada), route: 'inbox', now: SEARCH_NOW, uiState: ui({ extra: ISO }) });
  const before = await fileStateOf(core);
  await barButton(page, 'Search').click();
  const region = await must(page.getByRole('search'), 'the search region');
  const field = await must(query(page), 'Search query');
  const fr = await rect(field);
  assert.ok(fr && fr.width >= SMALL.width / 2, `Search query runs across the viewport (${fr?.width})`);
  assert.equal(await page.getByText('⇧⌘F').count(), 0, 'no ⇧⌘F hint');
  await must(main(page).getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Type: all' }), 'Filters: Type: all');
  await must(main(page).getByRole('group', { name: 'Filters' }).getByRole('combobox', { name: 'Filter by tag' }), 'Filters: Filter by tag');
  await field.fill('rozpočet');
  await must(region.getByRole('button', { name: 'Clear search' }), 'Clear search');
  await must(main(page).getByRole('status').filter({ hasText: /^5 results$/ }), 'rozpočet: 5 results', 3000);
  // Slice AND-3 (android-edit.md FR-NAV-01 AC-25, contract §10.7, §20; D-2412): D-1343's create buttons and the empty
  // state's question (AC-Test-Change, approved by the owner with the contract, D-2541)
  await must(page.getByRole('button', { name: 'Create “rozpočet”' }), 'Create “rozpočet”');
  await must(page.getByRole('button', { name: 'as…' }), 'as…');
  await field.fill('borůvkový koláč');
  await must(main(page).getByText('No matches. Create “borůvkový koláč”?', { exact: true }), 'No matches. Create “borůvkový koláč”?', 3000);
  assert.equal(await main(page).getByText('Nothing matches “borůvkový koláč”.', { exact: true }).count(), 0, 'phone.search.noMatch is gone');
  await field.fill('ostružiník');
  await must(main(page).getByRole('button', { name: 'Show next 10' }), 'ostružiník: Show next 10', 3000);
  await field.fill('rozpočet');
  await must(results(page).getByRole('listitem'), 'rozpočet rows', 3000);
  const tagChip = results(page).getByRole('button', { name: /^#/ }).first();
  if (await seen(tagChip, 1000)) {
    const t = flat(await tagChip.innerText()).replace(/^#/, '');
    await tagChip.click();
    await must(main(page).getByRole('button', { name: `Remove #${t}` }), 'a tap on a row\'s tag chip adds the tag filter (FR-SRC-02 AC-18)');
  }
  const rowsBefore = (await results(page).getByRole('listitem').allInnerTexts()).map(flat);
  await results(page).getByRole('link').first().click();
  await eventually(() => mainName(page), (n) => n !== 'Search', 3000);
  await systemBack(page);
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Search', 3000), 'Search', 'Back returns to search');
  assert.equal(await query(page).inputValue(), 'rozpočet', 'Back restores the query');
  assert.deepEqual((await results(page).getByRole('listitem').allInnerTexts()).map(flat), rowsBefore, 'and the rows (FR-SRC-02 AC-17)');
  await assertZeroWrites(core, before, 'search');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-24 (L5p)

test('fr_nav_01_ac24_search_from_the_bottom_bar', async ({ page }) => {
  const core = await startPhone(page, { vault: pageVault(), route: 'inbox', now: SEARCH_NOW });
  const before = await fileStateOf(core);
  await barButton(page, 'Search').click();
  const field = await must(query(page), 'Search query');
  assert.equal(await field.evaluate((e) => e === document.activeElement), true, 'the bottom bar\'s Search puts the caret in Search query');
  assert.equal(await field.getAttribute('enterkeyhint'), 'search', 'enterkeyhint="search"');
  assert.equal(await barButton(page, 'Search').getAttribute('aria-current'), 'page', 'Search is aria-current on search');
  await field.fill('zzzzneexistuje');
  await sleep(400);
  await field.press('Enter');
  await sleep(400);
  assert.equal(await mainName(page), 'Search', 'with no results the key does nothing');
  await field.fill('cteni');
  await must(results(page).getByRole('listitem'), 'results for cteni', 3000);
  await field.press('Enter');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Čtení knih', 3000), 'Čtení knih', 'the search key opens the first row, Čtení knih (as ⏎)');
  await systemBack(page);
  await (await must(query(page), 'Search query')).fill('čtení'.normalize('NFD'));
  await must(results(page).getByRole('listitem'), 'results for NFD čtení', 3000);
  assert.equal(flat(await results(page).getByRole('link').first().innerText()).startsWith('Čtení knih'), true, 'NFD čtení gives the same first row');
  await assertZeroWrites(core, before, 'search from the bottom bar');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-04 AC-13

test('fr_syn_04_ac13_conflicts_read_only_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: conflictsVault(), route: 'inbox', now: SEARCH_NOW });
  const before = await fileStateOf(core);
  const d = await openDrawer(page);
  const entry = d.locator('[data-command="goto.conflicts"]');
  assert.match(flat(await (await must(entry, 'drawer entry Conflicts')).innerText()), /Conflicts\s*3$/, 'Conflicts with the count of AC-5\'s list (3)');
  await entry.click();
  const list = await must(main(page).getByRole('list', { name: 'Conflicts' }), 'list "Conflicts"');
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { vault: conflictsVault(), route: 'conflicts', now: SEARCH_NOW });
  const deskRows = (await desk.getByRole('list', { name: 'Conflicts' }).getByRole('link').allInnerTexts()).map(flat);
  await context.close();
  assert.deepEqual((await list.getByRole('link').allInnerTexts()).map(flat), deskRows, 'the same pairs with the same texts as the desktop');
  await list.getByRole('link').filter({ hasText: 'Plán (conflicted copy 2026-10-07).md' }).first().click();
  const cmp = await must(page.getByRole('region', { name: 'Compare versions' }), 'Compare versions');
  const cols = await cmp.locator(':scope > *').evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).filter((r) => r.height > 20).map((r) => ({ left: Math.round(r.left), top: Math.round(r.top) })));
  assert.ok(cols.length >= 2 && cols[1].top > cols[0].top && Math.abs(cols[1].left - cols[0].left) <= 2, `both versions one above the other: ${JSON.stringify(cols)}`);
  assert.ok((await cmp.locator('mark, ins, del, [data-changed]').count()) > 0, 'the differing lines are marked');
  // Slice AND-3 (android-edit.md FR-SYN-04 AC-14, AC-15, contract §10.8, §20; D-2410): `Keep this version` under each
  // version and `Merge…`; still no draft until Merge… (AC-Test-Change, approved by the owner with the contract, D-2541)
  assert.equal(await page.getByRole('button', { name: 'Keep this version' }).count(), 2, 'Keep this version under each version');
  await must(page.getByRole('button', { name: 'Merge…' }), 'Merge…');
  assert.equal(await page.locator('[contenteditable="true"], textarea').count(), 0, 'no merge draft before Merge…');
  await systemBack(page);
  await core.setFile('Pages/Plán (conflicted copy 2026-10-07).md', null);
  const n = await eventually(() => list.getByRole('link').filter({ hasText: 'Plán (conflicted copy' }).count(), (c) => c === 0, 2000);
  assert.equal(n, 0, 'an external removal of the copy removes its pair within 2 s');
  const { [nfc('Pages/Plán (conflicted copy 2026-10-07).md')]: _gone, ...rest } = before.files;
  await assertZeroWrites(core, { files: rest, bin: before.bin }, 'conflicts');
  // with the last pair gone, the drawer entry disappears
  await core.setConflicts([]);
  await core.emit('vault:changed', { paths: ['Pages/Plán.md'] });
  await openDrawer(page);
  assert.equal(await eventually(() => drawer(page).locator('[data-command="goto.conflicts"]').count(), (c) => c === 0, 2000), 0, 'the drawer entry disappears with the last pair');
});

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-14

test('fr_set_01_ac14_settings_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { route: 'inbox', uiState: ui({ extra: ISO }) });
  const before = await fileStateOf(core);
  await drawerEntry(page, 'Settings');
  assert.equal(await h1Is(page, 'Settings'), 'Settings', 'drawer Settings opens settings');
  const links = (await main(page).getByRole('link').allInnerTexts()).map(flat);
  assert.deepEqual(links.filter((l) => ['Appearance', 'Date & time', 'Vault', 'Storage access'].includes(l)), ['Appearance', 'Date & time', 'Vault', 'Storage access'], 'the rows in order');
  await must(main(page).getByText('Tegg dev · Android', { exact: true }), 'the footer "Tegg dev · Android"');
  for (const name of ['Shortcuts', 'Menu bar and startup', 'Trash and history', 'Previews', 'Backups', 'Page width', 'Outline', 'Sync']) {
    assert.equal(await main(page).getByRole('link', { name, exact: true }).count(), 0, `not listed: ${name}`);
  }
  assert.equal(await page.getByRole('navigation', { name: 'Settings sections' }).count(), 0, 'no desktop "Settings sections"');
  // Vault
  await main(page).getByRole('link', { name: 'Vault', exact: true }).click();
  assert.equal(await h1Is(page, 'Vault'), 'Vault', 'settings/vault');
  await must(main(page).getByText('Knihovna'), 'the vault\'s name');
  const path = await must(main(page).getByText('/storage/emulated/0/Documents/Knihovna'), 'the vault\'s path');
  assert.equal(await path.evaluate((e) => !!e.closest('[data-user-content]')), true, 'the path is user content');
  assert.equal(await main(page).getByRole('combobox', { name: 'Default type for new notes' }).count(), 0, 'the default type is text, no control');
  await must(main(page).getByText('Default type for new notes'), 'Default type for new notes as text');
  await (await must(main(page).getByRole('button', { name: 'Switch vault…' }), 'Switch vault…')).click();
  await must(page.getByRole('menu', { name: 'Vaults' }), 'Switch vault… opens the menu Vaults');
  await page.keyboard.press('Escape');
  // Storage access
  await systemBack(page);
  await main(page).getByRole('link', { name: 'Storage access', exact: true }).click();
  assert.equal(await h1Is(page, 'Storage access'), 'Storage access', 'settings/storage');
  await must(main(page).getByText('On', { exact: true }), 'Storage access: On');
  const n = (await core.calls()).filter((c) => c.cmd === 'storage_access_settings').length;
  await (await must(main(page).getByRole('button', { name: 'Open settings' }), 'Open settings')).click();
  assert.equal(await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'storage_access_settings').length, (x) => x === n + 1, 1000), n + 1, 'Open settings calls storage_access_settings');
  // Date & time: Long changes the Inbox's dates within 1 s, per machine
  await systemBack(page);
  await main(page).getByRole('link', { name: 'Date & time', exact: true }).click();
  const combo = await must(main(page).getByRole('combobox', { name: 'Date format' }), 'Date format');
  await combo.selectOption('long'); // D-2450: the Mac's native select, as contract §9.10 keeps it
  await drawerEntry(page, 'Inbox');
  const line = await eventually(async () => flat(await main(page).locator('li').first().innerText().catch(() => '')), (t) => /November 2026|listopadu 2026/.test(t), 1000);
  assert.match(line, /November 2026|listopadu 2026/, `the Inbox's dates follow Long within 1 s: "${line}"`);
  assert.equal((await core.uiState() as any)?.dateTime?.date, 'long', 'stored per machine (ui-state, D-566)');
  await assertZeroWrites(core, before, 'Settings (vault.yml and every vault file untouched)');
});

// ------------------------------------------------------------------------------------------------ FR-SET-02 AC-11 (L5p)

test('fr_set_02_ac11_theme_follows_android', async ({ page }) => {
  const core = await startPhone(page, { route: 'settings/appearance', uiState: undefined });
  const group = await must(main(page).getByRole('radiogroup', { name: 'Theme' }), 'radiogroup "Theme"');
  assert.deepEqual((await group.getByRole('radio').allInnerTexts()).map(flat), ['System', 'Light', 'Dark'], 'System, Light, Dark');
  assert.equal(await group.getByRole('radio', { name: 'System' }).isChecked(), true, 'System is selected on a fresh install');
  assert.equal(await main(page).getByRole('radiogroup').count(), 1, 'Theme only on the phone\'s Appearance');
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  const light = await bg();
  await page.evaluate(() => (window as any).__TEGG_TEST__?.systemDark?.(true));
  const dark = await eventually(bg, (v) => v !== light, 1000);
  assert.notEqual(dark, light, 'system dark (the native state) turns System dark within 1 s');
  await group.getByRole('radio', { name: 'Light' }).click();
  assert.equal(await eventually(bg, (v) => v === light, 1000), light, 'Light chosen: light while the system is dark');
  assert.equal((await core.uiState())?.theme, 'light', 'the choice is stored in private storage (ui-state)');
  assert.ok((await core.windowCalls()).includes(false), 'the frame tells android_window the light theme (bars, FR-SET-02 AC-12)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-06 AC-1

test('fr_ux_06_ac1_empty_states_on_the_phone', async ({ browser }) => {
  // type/cesta (shell fixture): the desktop's empty-type message without New Cesta
  const shell = { ...shellVault(), name: 'shell' };
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { vault: shell, route: 'type/cesta', now: SEARCH_NOW });
  const deskEmpty = flat(await desk.getByRole('main').locator('p').filter({ hasText: /\S/ }).first().innerText());
  await context.close();
  let page = await phonePage(browser);
  let core = await startPhone(page, { vault: shell, route: 'type/cesta', now: SEARCH_NOW });
  let before = await fileStateOf(core);
  await must(main(page).getByText(deskEmpty, { exact: true }), `type/cesta: the desktop's empty-type message "${deskEmpty}"`);
  assert.equal(await page.getByRole('button', { name: /^New Cesta/ }).count(), 0, 'no New Cesta');
  await emptyHasNoWriteButton(page, 'type/cesta');
  await assertZeroWrites(core, before, 'type/cesta');
  await page.close();
  // search with nothing typed: FR-SRC-03 AC-14's empty state
  page = await phonePage(browser);
  core = await startPhone(page, { vault: pageVault(), route: 'search', now: SEARCH_NOW });
  const region = await must(main(page).getByRole('region'), 'search\'s empty state (a region)');
  assert.ok(flat(await region.innerText()).length > 0, 'with its text');
  await emptyHasNoWriteButton(page, 'search');
  await page.close();
  // a tag page whose objects were removed from outside: the desktop's empty text
  page = await phonePage(browser);
  core = await startPhone(page, { vault: tagsVault(), route: `tag/${encodeURIComponent('čtení')}`, now: TAGS_NOW });
  before = await fileStateOf(core);
  for (const [p, t] of Object.entries(before.files)) if (/(^|[^\p{L}\p{N}_])#?čtení(?![\p{L}\p{N}_])/u.test(t) && !p.startsWith('Tags/') && !p.startsWith('.tegg/')) await core.setFile(p, null);
  await sleep(2000);
  assert.equal(await main(page).locator('[data-path]').count(), 0, 'no rows left');
  assert.ok(flat(await main(page).innerText()).length > 0, 'the empty text is shown');
  await emptyHasNoWriteButton(page, 'the empty tag page');
  await page.close();
});
async function emptyHasNoWriteButton(page: Page, how: string) {
  const names = (await main(page).getByRole('button').allInnerTexts()).map(flat);
  const writes = names.filter((n) => /^(New|Create|Quick Capture|Add|Import|Restore)\b/.test(n));
  assert.deepEqual(writes, [], `${how}: no empty-state button that creates or writes`);
}
