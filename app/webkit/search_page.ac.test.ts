// Search page redesign, L5 (WebKit + fake core): docs/acceptance/search-navigation.md § "Search page redesign" (board
// `Search`; D-1200…D-1222): FR-SRC-02 AC-13…AC-18 (Type filter, filter-only order, Clear filters, state per history
// entry, row tag chips), FR-SRC-03 AC-8…AC-21 (layout, count line, rows, dates, paging, Clear search, empty states,
// keyboard, strings, themes, zero writes, live updates), FR-NAV-01 AC-19 (`Go to` on the redesigned page). Interface
// docs/contracts/v1-search.md §2, §3; the fake core's `index_search` is app/ui/test/fake-search.ts. Region `cs-CZ`,
// Date format `ISO`, TZ Europe/Prague unless stated. Written from the ACs and the contract only (D-61); every lookup
// goes through `must`/node:assert (TS-I1). Not automated here: the typo mark `similar spelling` (the fake core has no
// typo matching, ms3-shell §15.8; the core's `typo` flag is L4), FR-SRC-03 AC-19's look [manual], FR-SRC-02 AC-17's
// relaunch (L6, app/e2e/search_page.ac.test.ts) and FR-SRC-03 AC-18's L1 part (app/test/search_page.ac.test.ts).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { collation, mainName, mustBeOn, mustPreview, nonReadCalls, paletteDialog, paletteOptions, pseudoLocale, runCommand, settled } from './helpers';
import {
  P, T, addHromada, addTag, chooseType, clearFiltersBtn, clearSearchBtn, click, countLine, countWhen, description, emptyState,
  eventually, filtersGroup, flat, focusName, focusedRowTitle, goToList, heading, hromada, main, must, pageVault, removeChip, results,
  rowItems, rowLink, rowOf, rows, scrollTopOf, searchQueries, searchQuery, searchRegion, showNextBtn, sleep, startPage,
  titles, titlesWhen, topOf, typeBtn, typeMenu, typeQuery, vaultWrites,
} from './search-page-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
async function rowsWhen(page: Page, want: string[], ms = 3000) {
  return titlesWhen(page, (t) => same(t, want), ms);
}
async function typeLabel(page: Page): Promise<string> {
  await must(typeBtn(page), 'the Type filter button');
  return flat(await typeBtn(page).first().evaluate((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText));
}

// ------------------------------------------------------------------------------------------------ FR-SRC-02 AC-13

test('fr_src_02_ac13_the_type_filter_control', async ({ page }) => {
  await startPage(page);
  const group = await must(filtersGroup(page), 'group "Filters"');
  const order = await group.evaluate((g) => [...g.querySelectorAll('button, [role="combobox"], input')]
    .map((e) => (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  const ti = order.findIndex((x) => /^Type: /.test(x));
  const fi = order.findIndex((x) => x === 'Filter by tag');
  assert.ok(ti >= 0 && fi >= 0 && ti < fi, `Type: all first, then Filter by tag: ${order.join(' | ')}`);
  assert.equal(await typeLabel(page), 'Type: all', 'the button reads Type: all');
  assert.equal(await typeBtn(page).first().getAttribute('aria-haspopup'), 'menu', 'a menu button');
  await click(typeBtn(page), 'Type: all');
  const menu = await must(typeMenu(page), 'menu "Type"');
  const items = menu.getByRole('menuitemradio');
  assert.deepEqual((await items.allInnerTexts()).map(flat), ['All types', 'Page 6', 'Quick Note 2', 'Task 1'], 'every type with objects, D-122 order, vault-wide counts');
  assert.equal(await menu.getByRole('menuitemradio', { name: 'All types', exact: true }).getAttribute('aria-checked'), 'true', 'All types is checked');
  await click(menu.getByRole('menuitemradio', { name: /^Task \d+$/ }), 'Task 1');
  assert.equal(await eventually(() => typeMenu(page).count(), (c) => c === 0, 1000), 0, 'choosing closes the menu');
  assert.equal(await eventually(() => typeLabel(page), (l) => l === 'Type: Task', 1000), 'Type: Task', 'the button reads Type: Task');
  const btn = typeBtn(page).first();
  assert.ok(await btn.evaluate((e) => e.hasAttribute('data-active')), 'shown filled when on (data-active)');
  const bold = await btn.evaluate((e) => [...e.querySelectorAll('*')].filter((c) => (c.textContent ?? '').trim() === 'Task').some((c) => Number(getComputedStyle(c).fontWeight) >= 600));
  assert.ok(bold, 'the value is bold');
  assert.deepEqual(await focusName(page), { role: 'button', name: 'Type: Task' }, 'focus returns to the button');
});

test('fr_src_02_ac13_an_undefined_type_is_listed_after_the_defined_ones', async ({ page }) => {
  const recept = '---\nid: 01JA0S0000000000000000S0R1\ntype: recept\ntitle: Svíčková\n---\nOmáčka.\n';
  await startPage(page, { vault: pageVault((f) => { f['Recepty/Svíčková.md'] = recept; }), prelude: collation('cs') });
  await click(typeBtn(page), 'Type: all');
  const menu = await must(typeMenu(page), 'menu "Type"');
  assert.deepEqual((await menu.getByRole('menuitemradio').allInnerTexts()).map(flat), ['All types', 'Page 6', 'Quick Note 2', 'Task 1', 'recept 1'],
    'an undefined type by its raw value after the defined types (D-121), cs collation');
  assert.equal(await menu.getByRole('menuitemradio', { checked: true }).count(), 1, 'single select: one checked item');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-02 AC-14, AC-15

test('fr_src_02_ac14_type_results_and_the_query_types', async ({ page }) => {
  const core = await startPage(page);
  await chooseType(page, 'Page');
  const want = [T.chata, T.bouda, T.cteni, T.rozpocet, T.projekt, T.obycejna];
  assert.deepEqual([...(await titlesWhen(page, (t) => t.length === 6))].sort(), [...want].sort(), 'Type: Page, no text: the six Pages');
  const last = (await searchQueries(core)).at(-1);
  assert.deepEqual(last?.types, ['page'], 'the chosen type is the only entry of the query types');
  await chooseType(page, 'Task');
  assert.deepEqual(await rowsWhen(page, [T.tomas]), [T.tomas], 'Type: Task → Tomáš');
  await typeQuery(page, 'rozpočet');
  const pages = await titlesWhen(page, (t) => t.length === 1 && t[0] === T.tomas);
  assert.deepEqual(pages, [T.tomas], 'rozpočet + Type: Task → Tomáš');
  await chooseType(page, 'Page');
  const alone = [T.rozpocet, T.projekt, T.obycejna];
  assert.deepEqual([...(await titlesWhen(page, (t) => t.length === 3))].sort(), [...alone].sort(), 'rozpočet + Type: Page → Rozpočet, Projekt, Obyčejná');
  await chooseType(page, 'All types');
  await titlesWhen(page, (t) => t.length === 5);
  assert.deepEqual((await searchQueries(core)).at(-1)?.types ?? [], [], 'Type: all sends no type');
});

test('fr_src_02_ac15_rendered_order_newest_modified_first', async ({ page }) => {
  await startPage(page);
  await addTag(page, 'hory');
  assert.deepEqual(await rowsWhen(page, [T.chata, T.pozdni, T.bouda]), [T.chata, T.pozdni, T.bouda], '#hory: Chata, Pozdní, Bouda (instants, not text)');
  // The order key is on the rows: each row's `time.modified[datetime]` is its `modified` as written (v1-search §3).
  assert.deepEqual((await rows(page)).map((r) => r.datetime), ['2026-10-12T08:15:00+02:00', '2026-10-05T23:00:00Z', '2026-10-06T00:30:00+02:00'],
    'the rows carry the modified instants they are ordered by');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-02 AC-16

test('fr_src_02_ac16_clear_filters', async ({ page }) => {
  await startPage(page);
  await must(filtersGroup(page), 'group "Filters"');
  assert.equal(await clearFiltersBtn(page).count(), 0, 'no Clear filters with Type: all and no tag');
  await typeQuery(page, 'rozpočet');
  await chooseType(page, 'Task');
  await must(clearFiltersBtn(page), 'Clear filters appears with a type');
  await addTag(page, 'finance');
  await click(clearFiltersBtn(page), 'Clear filters');
  assert.equal(await eventually(() => typeLabel(page), (l) => l === 'Type: all', 2000), 'Type: all', 'the type is cleared');
  assert.equal(await removeChip(page, 'finance').count(), 0, 'every tag chip is removed');
  assert.equal(await searchQuery(page).inputValue(), 'rozpočet', 'the query text stays');
  assert.equal(await countWhen(page, '5 results'), '5 results', 'the search re-runs: the 5 results of FR-SRC-01 AC-1');
  assert.equal(await clearFiltersBtn(page).count(), 0, 'Clear filters removes itself');
  assert.equal((await focusName(page)).name, 'Search query', 'focus moves to Search query');
  await addTag(page, 'hory');
  await must(clearFiltersBtn(page), 'Clear filters appears with a tag');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-02 AC-17

test('fr_src_02_ac17_filter_state_belongs_to_the_history_entry', async ({ page }) => {
  const core = await startPage(page);
  const ui0 = JSON.stringify(await core.uiState());
  await typeQuery(page, 'noci');
  await chooseType(page, 'Quick Note');
  await addTag(page, 'hory');
  assert.deepEqual(await rowsWhen(page, [T.pozdni]), [T.pozdni], 'noci + Type: Quick Note + #hory → Pozdní');
  const link = await must(rowLink(page, T.pozdni), 'the Pozdní row link');
  await link.focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, T.pozdni, '⏎ on the row opens the object');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Search', 'Back returns to search');
  assert.equal(await eventually(() => searchQuery(page).inputValue().catch(() => ''), (v) => v === 'noci', 2000), 'noci', 'the same text');
  assert.equal(await typeLabel(page), 'Type: Quick Note', 'the same type');
  await must(removeChip(page, 'hory'), 'the same tag #hory');
  assert.deepEqual(await rowsWhen(page, [T.pozdni]), [T.pozdni], 'the same rows');
  assert.equal(await eventually(() => focusedRowTitle(page), (t) => t === T.pozdni, 2000), T.pozdni, 'the row that was opened is focused');
  assert.equal(JSON.stringify(await core.uiState()), ui0, 'nothing in ui-state changes with the filters');
  assert.deepEqual(await vaultWrites(core), [], 'no file in the vault');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-02 AC-18

test('fr_src_02_ac18_row_tag_chips_add_the_filter', async ({ page }) => {
  const core = await startPage(page);
  await typeQuery(page, 'mlyn');
  await rowsWhen(page, [T.chata]);
  const row = await must(rowOf(page, T.chata), 'the Chata row');
  for (const n of ['hory', 'účty', 'zima']) await must(row.getByRole('button', { name: `Filter by #${n}`, exact: true }), `chip button Filter by #${n}`);
  assert.ok((await rows(page))[0]?.chipsOutsideLink, 'the chips are outside the row link');
  const before = (await searchQueries(core)).length;
  await click(row.getByRole('button', { name: 'Filter by #zima', exact: true }), 'Filter by #zima');
  await must(removeChip(page, 'zima'), '#zima added to Filter by tag');
  assert.equal(await searchQuery(page).inputValue(), 'mlyn', 'the text stays');
  const qs = await eventually(() => searchQueries(core), (q) => q.slice(before).some((x) => x.text === 'mlyn' && JSON.stringify(x.tags) === '["zima"]'), 2000);
  assert.ok(qs.slice(before).some((x) => x.text === 'mlyn' && JSON.stringify(x.tags) === '["zima"]'), 'the search re-runs with #zima');
  assert.equal(await mainName(page), 'Search', 'the chip never opens tag/zima');
  const n = (await searchQueries(core)).length;
  await click(rowOf(page, T.chata).getByRole('button', { name: 'Filter by #zima', exact: true }), 'Filter by #zima again');
  await sleep(400);
  assert.equal(await main(page).getByRole('button', { name: /^Remove #/ }).count(), 1, 'a selected tag: nothing changes');
  assert.equal((await searchQueries(core)).length, n, 'no new search');
  assert.equal(await mainName(page), 'Search', 'still on search');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-8

test('fr_src_03_ac8_layout_in_the_page_elements_order', async ({ page }) => {
  await startPage(page);
  await must(heading(page), 'heading level 1 "Search"');
  assert.equal(await main(page).getByRole('link', { name: 'Back', exact: true }).count() + await main(page).getByRole('button', { name: 'Back', exact: true }).count(), 0, 'no Back link inside the page');
  const region = await must(searchRegion(page), 'the search landmark');
  const field = await must(region.getByRole('searchbox', { name: 'Search query', exact: true }), 'searchbox "Search query" inside the search region');
  assert.equal(await field.getAttribute('placeholder'), 'Search for a phrase', 'placeholder');
  assert.equal(await clearSearchBtn(page).count(), 0, 'no Clear search while the field is empty');
  const hint = await region.evaluate((r) => [...r.querySelectorAll('[aria-hidden="true"]')].map((e) => (e.textContent ?? '').trim()));
  assert.ok(hint.includes('⇧⌘F'), `the decorative hint ⇧⌘F: ${hint.join(' | ')}`);
  await typeQuery(page, 'rozpočet');
  await must(region.getByRole('button', { name: 'Clear search', exact: true }), 'Clear search while there is text');
  await must(goToList(page), 'listbox "Go to"');
  assert.equal(await countWhen(page, '5 results'), '5 results', 'the count line');
  const ys = [
    await topOf(heading(page)), await topOf(searchRegion(page)), await topOf(filtersGroup(page)), await topOf(goToList(page)),
    await topOf(main(page).getByRole('status').filter({ hasText: /^\d+ results?$/ })), await topOf(results(page)),
  ];
  assert.ok(ys.every((y, i) => !Number.isNaN(y) && (i === 0 || y > ys[i - 1])), `heading, search, Filters, Go to, count, results top to bottom: ${ys.join(', ')}`);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Meta+Shift+f');
  const sel = await eventually(() => page.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return { label: a?.getAttribute('aria-label') ?? '', start: a?.selectionStart ?? -1, end: a?.selectionEnd ?? -1, len: a?.value?.length ?? 0 };
  }), (x) => x.label === 'Search query' && x.start === 0 && x.end === x.len, 2000);
  assert.deepEqual(sel, { label: 'Search query', start: 0, end: 'rozpočet'.length, len: 'rozpočet'.length }, '⇧⌘F focuses Search query with its text selected');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-9

test('fr_src_03_ac9_count_line', async ({ page }) => {
  await startPage(page);
  await must(filtersGroup(page), 'group "Filters"');
  await typeQuery(page, 'rozpočet');
  assert.equal(await countWhen(page, '5 results'), '5 results', 'rozpočet');
  await typeQuery(page, 'High');
  assert.equal(await countWhen(page, '1 result'), '1 result', 'High');
  await typeQuery(page, 'rozpočet');
  await chooseType(page, 'Task');
  assert.equal(await countWhen(page, '1 result'), '1 result', 'with text the filters are not repeated');
  await chooseType(page, 'All types');
  await typeQuery(page, '');
  await addTag(page, 'hory');
  assert.equal(await countWhen(page, '3 objects with #hory'), '3 objects with #hory', 'tags only');
  await addTag(page, 'zima');
  assert.equal(await countWhen(page, '1 object with #hory #zima'), '1 object with #hory #zima', 'several tags in the filter order');
  await must(main(page).getByText('Objects with all selected tags', { exact: true }), 'the tag filter hint is unchanged (tags.md AC-11)');
  await click(clearFiltersBtn(page), 'Clear filters');
  await chooseType(page, 'Page');
  assert.equal(await countWhen(page, '6 objects of type Page'), '6 objects of type Page', 'type only');
  await chooseType(page, 'Quick Note');
  await addTag(page, 'hory');
  assert.equal(await countWhen(page, '1 object of type Quick Note with #hory'), '1 object of type Quick Note with #hory', 'type and tag');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-10

test('fr_src_03_ac10_row_contents', async ({ page }) => {
  const core = await startPage(page, {
    vault: pageVault((f) => { f['Pages/Značky.md'] = '---\nid: 01JA0S0000000000000000S0H1\ntype: page\ntitle: <b>tučně</b> ostružina\n---\nText.\n'; }),
  });
  await typeQuery(page, 'rozpočet');
  await titlesWhen(page, (t) => t.length === 5);
  const r = await rows(page);
  const first = r[0];
  assert.equal(first?.title, T.rozpocet, 'the first row is Rozpočet 2026');
  assert.deepEqual(first.titleMarks, ['Rozpočet'], 'Rozpočet highlighted in the title');
  assert.deepEqual([first.type, first.date, first.datetime], ['Page', '2026-09-20', '2026-09-20T12:00:00+02:00'], 'type name and the modified date');
  assert.ok(first.snippetMarks.length > 0 && first.snippetMarks.every((m) => /^rozpo[čc]/i.test(m)), `a highlighted snippet: ${first.snippet}`);
  assert.deepEqual(first.chipTexts, ['#finance'], 'chip #finance');
  assert.equal(first.icon, 'file-text', 'the type icon (FR-SRC-03 AC-7)');
  assert.ok(first.titleUser, 'the title is user content (data-user-content)');
  const oby = r.find((x) => x.title === T.obycejna);
  assert.deepEqual(oby && [oby.type, oby.date, oby.chips.length], ['Page', '', 0], 'Obyčejná: Page, no date, no chips');
  await typeQuery(page, 'reading');
  await titlesWhen(page, (t) => t.length === 1);
  const c = (await rows(page))[0];
  assert.deepEqual(c && [c.title, c.lineKind, c.line, c.lineMarks], [T.cteni, 'alias', 'Alias: Reading list', ['Reading']], 'the alias line with the highlight');
  await typeQuery(page, 'mlyn');
  await titlesWhen(page, (t) => t.length === 1 && t[0] === T.chata);
  const ch = (await rows(page))[0];
  assert.deepEqual(ch && [ch.lineKind, ch.line, ch.lineMarks], ['attribute', 'místo: Špindlerův Mlýn', ['Mlýn']], 'the attribute line: the key as label (Page doesn\'t define místo)');
  assert.deepEqual(ch.chipTexts, ['#hory', '#účty', '#zima'], 'chips in D-122 order (en)');
  assert.ok(ch.snippet.startsWith('Seznam věcí na chatu: lyže, čaj, deky.') && ch.snippetMarks.length === 0, `the body's lead, not highlighted: ${ch.snippet}`);
  await typeQuery(page, 'High');
  await titlesWhen(page, (t) => t.length === 1 && t[0] === T.tomas);
  const tm = (await rows(page))[0];
  assert.deepEqual(tm && [tm.type, tm.lineKind, tm.line, tm.lineMarks], ['Task', 'attribute', 'Priority: High', ['High']], 'the attribute panel label Priority');
  await typeQuery(page, 'ostružina');
  await titlesWhen(page, (t) => t.length === 1);
  const h = (await rows(page))[0];
  assert.ok(h && h.title === '<b>tučně</b> ostružina' && !h.titleHtml, `the title is never parsed as HTML: ${h?.title}`);
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_src_03_ac10_chip_order_in_cs', async ({ page }) => {
  await startPage(page, { prelude: collation('cs') });
  await typeQuery(page, 'mlyn');
  await titlesWhen(page, (t) => t.length === 1 && t[0] === T.chata);
  assert.deepEqual((await rows(page))[0]?.chipTexts, ['#hory', '#účty', '#zima'], 'chips in D-122 order (cs)');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-11

async function horyDates(page: Page): Promise<string[]> {
  await addTag(page, 'hory');
  await titlesWhen(page, (t) => t.length === 3);
  return eventually(async () => (await rows(page)).map((r) => r.date), (d) => d.every(Boolean), 2000);
}

test('fr_src_03_ac11_modified_date_iso_in_prague', async ({ page }) => {
  await startPage(page);
  assert.deepEqual(await horyDates(page), ['2026-10-12', '2026-10-06', '2026-10-06'], 'ISO, local dates in Prague');
  const r = await rows(page);
  assert.ok(r.every((x) => !/Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(x.date)), 'no relative labels');
});

test('fr_src_03_ac11_modified_date_in_new_york', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await startPage(page);
    assert.deepEqual(await horyDates(page), ['2026-10-12', '2026-10-05', '2026-10-05'], 'local dates in New York (D-104)');
  } finally {
    await ctx.close();
  }
});

test('fr_src_03_ac11_modified_date_region_and_long', async ({ page }) => {
  const core = await startPage(page, { date: 'region' });
  assert.equal((await horyDates(page))[0], '12. 10. 2026', 'Region (cs-CZ)');
  // Changing the setting while `search` is open updates the rows (D-566); Settings is a route, so Back returns.
  await runCommand(page, 'Go to Settings: Date & time');
  const combo = await must(main(page).getByRole('combobox', { name: 'Date format', exact: true }), 'combobox Date format');
  if (await combo.evaluate((e) => e.tagName === 'SELECT')) await combo.selectOption({ label: 'Long (14 October 2026)' });
  else { await combo.click(); await click(page.getByRole('option', { name: 'Long (14 October 2026)', exact: true }), 'option Long'); }
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Search', 'Back to search');
  const t0 = Date.now();
  const d = await eventually(async () => (await rows(page))[0]?.date ?? '', (x) => x === '12 October 2026', 1000);
  assert.equal(d, '12 October 2026', `Long, within 1 s (${Date.now() - t0} ms)`);
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-12

test('fr_src_03_ac12_show_next_appends_the_next_page', async ({ page }) => {
  const core = await startPage(page, { vault: pageVault(addHromada) });
  await typeQuery(page, 'ostružiník');
  assert.equal(await countWhen(page, '60 results'), '60 results', 'the total, not the loaded rows');
  assert.equal((await titlesWhen(page, (t) => t.length === 50)).length, 50, '50 rows');
  const first50 = await titles(page);
  const btn = await must(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next 10');
  await btn.scrollIntoViewIfNeeded();
  const scroll = await scrollTopOf(btn);
  await btn.click();
  const all = await titlesWhen(page, (t) => t.length === 60);
  assert.deepEqual(all.slice(0, 50), first50, 'the first 50 rows stay');
  assert.equal(new Set(all).size, 60, 'no row repeated or missing');
  const want = Array.from({ length: 60 }, (_, i) => `Hromada ${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual([...all].sort(), want, 'all 60 notes');
  const last = (await searchQueries(core)).at(-1);
  assert.deepEqual([last?.offset, last?.limit], [50, 50], 'Show next asks offset 50, limit 50');
  assert.equal(await eventually(() => focusedRowTitle(page), (t) => t === all[50], 2000), all[50], 'focus moves to row 51');
  assert.ok(Math.abs((await scrollTopOf(rowItems(page).first())) - scroll) <= 2, 'the scroll position is kept');
  assert.equal(await showNextBtn(page).count(), 0, 'the button is removed');

  await typeQuery(page, '');
  await addTag(page, 'hromada');
  assert.equal(await countWhen(page, '60 objects with #hromada'), '60 objects with #hromada', 'filter only');
  const f = await titlesWhen(page, (t) => t.length === 50);
  assert.equal(f[0], 'Hromada 60', 'FR-SRC-02 AC-15 order: Hromada 60 first');
  await click(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next 10 (filter only)');
  const g = await titlesWhen(page, (t) => t.length === 60);
  assert.deepEqual(g, Array.from({ length: 60 }, (_, i) => `Hromada ${String(60 - i).padStart(2, '0')}`), 'newest first through both pages');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-13

test('fr_src_03_ac13_clear_search_keeps_the_filters', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, 'rozpočet');
  await addTag(page, 'finance');
  await chooseType(page, 'Page');
  await click(clearSearchBtn(page), 'Clear search');
  assert.equal(await searchQuery(page).inputValue(), '', 'the field is empty');
  await must(removeChip(page, 'finance'), '#finance stays');
  assert.equal(await typeLabel(page), 'Type: Page', 'the type stays');
  assert.equal(await countWhen(page, '1 object of type Page with #finance'), '1 object of type Page with #finance', 'the search re-runs as filter-only');
  assert.equal(await eventually(() => goToList(page).count(), (c) => c === 0, 1000), 0, 'no Go to list');
  assert.equal(await clearSearchBtn(page).count(), 0, 'Clear search hides itself');
  assert.equal((await focusName(page)).name, 'Search query', 'focus in Search query');
});

test('fr_src_03_ac13_clear_search_with_a_tag_only', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, 'rozpočet');
  await addTag(page, 'finance');
  await click(clearSearchBtn(page), 'Clear search');
  assert.equal(await countWhen(page, '1 object with #finance'), '1 object with #finance', 'filter-only: 1 object with #finance');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-14…AC-16

const EMPTY_BODY = 'Type a phrase to search titles, text, file names and attribute values, or pick a type or tag. A filter alone is a search too.';

test('fr_src_03_ac14_empty_state_nothing_to_search', async ({ page }) => {
  await startPage(page);
  const region = await must(emptyState(page, 'Search all your objects'), 'region "Search all your objects" when search opens');
  assert.equal(flat(await region.locator('p').first().innerText()), EMPTY_BODY, 'the body');
  assert.ok(await region.evaluate((r) => !!r.querySelector('svg, [data-icon]')), 'an icon');
  assert.ok(await region.evaluate((r) => [...r.querySelectorAll('svg, [data-icon]')].every((i) => i.getAttribute('aria-hidden') === 'true' || !!i.closest('[aria-hidden="true"]'))), 'the icon is decorative');
  assert.ok((await filtersGroup(page).count()) > 0 && (await topOf(region)) > (await topOf(filtersGroup(page))), 'below the filters');
  assert.equal(await countLine(page), null, 'no count line');
  assert.equal(await rowItems(page).count(), 0, 'no listitem');
  assert.equal(await showNextBtn(page).count(), 0, 'no Show next');
});

test('fr_src_03_ac15_empty_state_no_results_with_filters', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, '  rozpočet  ');
  await chooseType(page, 'Task');
  await addTag(page, 'hory');
  const region = await must(emptyState(page, 'No results for “rozpočet”'), 'region "No results for “rozpočet”" (trimmed, typographic quotes)');
  assert.equal(flat(await region.locator('p').first().innerText()), 'Nothing matches “rozpočet” with Type Task and #hory. Clear the filters to search everything.', 'the body');
  assert.ok(await region.evaluate((r) => [...r.querySelectorAll('[data-user-content]')].some((e) => (e.textContent ?? '').trim() === 'rozpočet')), 'the query is user content');
  assert.equal(await countLine(page), null, 'no count line in an empty state');
  await click(region.getByRole('button', { name: 'Clear filters', exact: true }), 'the empty state\'s Clear filters');
  assert.equal(await countWhen(page, '5 results'), '5 results', 'afterwards 5 results');
  await addTag(page, 'hory');
  await addTag(page, 'finance');
  const two = await must(emptyState(page, 'No results for “rozpočet”'), 'no results with #hory and #finance');
  assert.equal(flat(await two.locator('p').first().innerText()), 'Nothing matches “rozpočet” with #hory and #finance. Clear the filters to search everything.', 'Intl.ListFormat conjunction, filter order');
  await click(two.getByRole('button', { name: 'Clear filters', exact: true }), 'Clear filters');
  await typeQuery(page, '');
  await chooseType(page, 'Task');
  await addTag(page, 'hory');
  const none = await must(emptyState(page, 'No objects with Type Task and #hory'), 'region "No objects with Type Task and #hory"');
  assert.equal(flat(await none.locator('p').first().innerText()), 'Clear the filters to search everything.', 'filter-only body');
  await must(none.getByRole('button', { name: 'Clear filters', exact: true }), 'Clear filters in the empty state');
});

test('fr_src_03_ac16_empty_state_no_match_points_to_go_to_create', async ({ page }) => {
  const core = await startPage(page);
  await typeQuery(page, 'borůvkový koláč');
  const region = await must(emptyState(page, 'No results for “borůvkový koláč”'), 'region "No results for “borůvkový koláč”"');
  const body = flat(await region.locator('p').first().innerText());
  assert.equal(body, 'Nothing in this vault matches “borůvkový koláč”. Use Create “borůvkový koláč” above to make it.', 'the body');
  assert.ok(!/exact phrase/i.test(flat(await main(page).innerText())), 'the copy never says "exact phrase"');
  assert.equal(await region.getByRole('button').count(), 0, 'no separate create button');
  await settled(page, 'Go to', 'borůvkový koláč');
  const opt = await must(goToList(page).getByRole('option', { name: 'Create "borůvkový koláč"', exact: true }), 'Go to: Create "borůvkový koláč"');
  assert.equal(await opt.getAttribute('aria-selected'), 'true', 'selected (D-106)');
  await must(goToList(page).getByRole('option', { name: 'Create "borůvkový koláč" as…', exact: true }), 'its as… row (D-550)');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Meta+Enter');
  await sleep(500);
  assert.deepEqual(await core.writesTo(), [], '⌘↩ does nothing here');
  assert.equal(await mainName(page), 'Search', 'still on search');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'borůvkový koláč', '⏎ creates and opens it', 5000);
  const w = await eventually(() => core.writesTo(), (x) => x.length > 0, 3000);
  assert.deepEqual(w, ['Quick Notes/borůvkový koláč.md'], 'one write through the one creation path');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-17

test('fr_src_03_ac17_tab_order', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, 'mlyn');
  await chooseType(page, 'Page');
  await titlesWhen(page, (t) => t.length === 1 && t[0] === T.chata);
  await (await must(searchQuery(page), 'Search query')).focus();
  const seenNames: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seenNames.push((await focusName(page)).name);
  }
  assert.deepEqual(seenNames, ['Clear search', 'Type: Page', 'Filter by tag', 'Clear filters', T.chata, 'Filter by #hory', 'Filter by #účty', 'Filter by #zima'],
    'field → Clear search → Type → Filter by tag → Clear filters → the row link → its chips');
});

test('fr_src_03_ac17_type_menu_keys', async ({ page }) => {
  await startPage(page);
  await chooseType(page, 'Page');
  const btn = await must(typeBtn(page), 'Type: Page');
  for (const key of ['Enter', ' ', 'ArrowDown']) {
    await btn.focus();
    await page.keyboard.press(key);
    await must(typeMenu(page), `${JSON.stringify(key)} opens the menu`);
    assert.deepEqual(await focusName(page), { role: 'menuitemradio', name: 'Page 6' }, `${JSON.stringify(key)}: focus on the checked item`);
    await page.keyboard.press('ArrowDown');
    assert.equal((await focusName(page)).name, 'Quick Note 2', '↓ moves');
    await page.keyboard.press('ArrowUp');
    assert.equal((await focusName(page)).name, 'Page 6', '↑ moves');
    await page.keyboard.press('Escape');
    assert.equal(await eventually(() => typeMenu(page).count(), (c) => c === 0, 1000), 0, 'Esc closes');
    assert.deepEqual(await focusName(page), { role: 'button', name: 'Type: Page' }, 'Esc: no change, focus back on the button');
  }
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  assert.equal(await eventually(() => typeLabel(page), (l) => l === 'Type: Quick Note', 1000), 'Type: Quick Note', 'Space chooses');
  assert.deepEqual(await focusName(page), { role: 'button', name: 'Type: Quick Note' }, 'focus back on the button');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => typeLabel(page), (l) => l === 'Type: Task', 1000), 'Type: Task', '⏎ chooses');
});

test('fr_src_03_ac17_row_keys_names_and_the_palette', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, 'rozpočet');
  const t = await titlesWhen(page, (x) => x.length === 5);
  const first = await must(rowLink(page, t[0]), 'the first row link');
  assert.ok((await description(first)).includes('Page') && (await description(first)).includes('2026-09-20'), `the link's description has the type name and the date: ${await description(first)}`);
  await first.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedRowTitle(page), t[1], '↓ moves to the next row link (chips skipped)');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedRowTitle(page), t[0], '↑ moves back');
  // The ↓/↑/⏎ of the field keep driving Go to (FR-NAV-01 AC-16).
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal((await focusName(page)).name, 'Search query', '↓ in the field keeps the caret in the field');
  // A click on a row previews (D-930, default mode).
  await click(rowLink(page, t[0]), 'the first row');
  await mustPreview(page, t[0], 'a click on a row previews');
  await page.keyboard.press('Escape');
  await (await must(rowLink(page, t[0]), 'the first row link')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, t[0], '⏎ on a row link opens the object');
  // No new palette commands.
  for (const q of ['filter', 'Clear filters', 'type']) {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'Command palette');
    await page.getByRole('combobox', { name: 'Command query' }).fill(q);
    await sleep(300);
    const opts = (await paletteOptions(page)).map(flat);
    assert.deepEqual(opts.filter((o) => /^Search: |Clear filters|Filter by type/.test(o)), [], `no Search page commands for "${q}"`);
    await page.keyboard.press('Escape');
  }
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-18 (L5)

test('fr_src_03_ac18_page_strings_come_from_the_catalog', async ({ page }) => {
  await startPage(page, { prelude: pseudoLocale });
  const field = await must(page.getByRole('searchbox', { name: /^⟦Search query⟧$/ }), 'the pseudo-localized field');
  assert.match(String(await field.getAttribute('placeholder')), /^⟦Search for a phrase⟧$/, 'placeholder from the catalog');
  await must(main(page).getByRole('group', { name: /^⟦Filters⟧$/ }), 'group ⟦Filters⟧');
  await must(main(page).getByRole('button', { name: /^⟦Type: all⟧$/ }), 'button ⟦Type: all⟧');
  await must(main(page).getByRole('region', { name: /^⟦Search all your objects⟧$/ }), 'empty-state title from the catalog');
  await field.fill('rozpočet');
  await must(main(page).getByRole('button', { name: /^⟦Clear search⟧$/ }), 'button ⟦Clear search⟧');
  const count = await eventually(async () => (await main(page).getByRole('status').allInnerTexts()).map(flat), (s) => s.some((x) => /^⟦5 results⟧$/.test(x)), 3000);
  assert.ok(count.some((x) => /^⟦5 results⟧$/.test(x)), `the count line from the catalog: ${count.join(' | ')}`);
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-19 (L5)

test('fr_src_03_ac19_highlight_token_and_theme_switch_keep_the_state', async ({ page }) => {
  await startPage(page);
  await typeQuery(page, 'mlyn');
  await chooseType(page, 'Page');
  await titlesWhen(page, (t) => t.length === 1 && t[0] === T.chata);
  const mark = await must(rowOf(page, T.chata).locator('mark'), 'a highlight');
  assert.equal(await mark.evaluate((m) => getComputedStyle(m).backgroundColor), 'rgb(255, 231, 163)', 'sel-hl light #FFE7A3');
  const before = { rows: await rows(page), type: await typeLabel(page), text: await searchQuery(page).inputValue() };
  await (await must(rowLink(page, T.chata), 'the Chata link')).focus();
  await runCommand(page, 'Theme: Dark');
  await (await must(rowLink(page, T.chata), 'the Chata link')).focus();
  const dark = await eventually(() => mark.evaluate((m) => getComputedStyle(m).backgroundColor), (c) => c === 'rgb(90, 71, 24)', 2000);
  assert.equal(dark, 'rgb(90, 71, 24)', 'sel-hl dark #5A4718');
  assert.deepEqual({ rows: await rows(page), type: await typeLabel(page), text: await searchQuery(page).inputValue() }, before, 'no row, filter or text changes');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-20

test('fr_src_03_ac20_the_page_writes_nothing', async ({ page }) => {
  const core = await startPage(page, { vault: pageVault(addHromada) });
  const files0 = JSON.stringify(await core.files());
  const ui0 = JSON.stringify(await core.uiState());
  await typeQuery(page, 'ostružiník');
  await chooseType(page, 'Page');
  await click(typeBtn(page), 'Type: Page');
  await page.keyboard.press('Escape');
  await addTag(page, 'hromada');
  await must(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next 10');
  await click(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next');
  const r = await must(rowOf(page, 'Hromada 01'), 'row Hromada 01');
  await click(r.getByRole('button', { name: 'Filter by #hromada', exact: true }), 'a row chip');
  await click(removeChip(page, 'hromada'), 'remove #hromada');
  await click(clearSearchBtn(page), 'Clear search');
  await addTag(page, 'zima');
  await chooseType(page, 'Task');
  await must(emptyState(page, 'No objects with Type Task and #zima'), 'an empty state');
  await click(clearFiltersBtn(page), 'Clear filters');
  await must(emptyState(page, 'Search all your objects'), 'the start state');
  await typeQuery(page, 'borůvkový koláč');
  await must(emptyState(page, 'No results for “borůvkový koláč”'), 'the no-match state');
  await sleep(300);
  assert.deepEqual(await vaultWrites(core), [], 'no vault write command');
  assert.deepEqual(await nonReadCalls(core), [], 'only read commands');
  assert.equal(JSON.stringify(await core.files()), files0, 'the vault is byte-identical');
  assert.equal(JSON.stringify(await core.uiState()), ui0, 'nothing stored in ui-state');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-03 AC-21

test('fr_src_03_ac21_live_updates_keep_the_loaded_rows', async ({ page }) => {
  const core = await startPage(page, { vault: pageVault(addHromada) });
  await typeQuery(page, 'ostružiník');
  await titlesWhen(page, (t) => t.length === 50);
  await click(main(page).getByRole('button', { name: 'Show next 10', exact: true }), 'Show next 10');
  const loaded = await titlesWhen(page, (t) => t.length === 60);
  const focusTitle = loaded[54];
  const l55 = await must(rowLink(page, focusTitle), 'the 55th row link');
  await l55.focus();
  const scroll = await scrollTopOf(l55);
  const cteni = (await core.files())[P.cteni];
  await core.setFile(P.cteni, `${cteni}\nKeř ostružiník u cesty.\n`);
  const t0 = Date.now();
  assert.equal(await countWhen(page, '61 results', 2000), '61 results', `the count within 2 s (${Date.now() - t0} ms)`);
  const now = await titlesWhen(page, (t) => t.length === 61, 2000);
  assert.equal(now.length, 61, 'the list shows 61 rows');
  assert.ok(loaded.every((x) => now.includes(x)) && now.includes(T.cteni), 'no loaded row is dropped; Čtení is added');
  assert.equal(await focusedRowTitle(page), focusTitle, 'the same row stays focused');
  assert.ok(Math.abs((await scrollTopOf(rowLink(page, focusTitle))) - scroll) <= 2, 'the scroll position is kept');
  await core.setFile(hromada(1), null);
  const gone = await titlesWhen(page, (t) => !t.includes('Hromada 01'), 2000);
  assert.ok(!gone.includes('Hromada 01') && gone.length === 60, `the deleted note's row is removed within 2 s (${gone.length} rows)`);
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-19

test('fr_nav_01_ac19_go_to_on_the_redesigned_page', async ({ page }) => {
  await startPage(page);
  await chooseType(page, 'Task');
  await typeQuery(page, 'cteni');
  await must(goToList(page), 'listbox "Go to"');
  await settled(page, 'Go to', 'cteni');
  const first = flat((await goToList(page).getByRole('option').first().innerText()).split('\n')[0]);
  assert.equal(first, T.cteni, 'the Type filter doesn\'t narrow Go to: Čtení first (D-1220)');
  await titlesWhen(page, () => true, 500);
  const ys = [await topOf(filtersGroup(page)), await topOf(goToList(page)), await topOf(main(page).getByRole('status').filter({ hasText: /^\d+ (results?|objects?)/ })), await topOf(results(page))];
  assert.ok(!Number.isNaN(ys[0]) && ys[0] < ys[1], `Go to below the Filters group: ${ys.join(', ')}`);
  await typeQuery(page, '');
  assert.equal(await eventually(() => goToList(page).count(), (c) => c === 0, 1000), 0, 'no Go to list with an empty query');
  assert.deepEqual(await rowsWhen(page, [T.tomas]), [T.tomas], 'the filter-only results show instead');
  await chooseType(page, 'All types');
  await must(emptyState(page, 'Search all your objects'), 'or the empty state of FR-SRC-03 AC-14');
});
