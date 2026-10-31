// Search without `Go to` (preview v0.109 feedback; D-1340…D-1343), L5 (WebKit + fake core):
// docs/acceptance/search-navigation.md § "Search without `Go to`" FR-NAV-01 AC-20 (no `Go to`), AC-21 (keys in the
// field), AC-22 (create buttons), AC-23 (writes; the L1 part is app/test/search_no_goto.ac.test.ts), FR-SRC-01 AC-23's
// rendered order (once) and FR-SRC-04 AC-10's `similar spelling` mark. Interface docs/contracts/v1-search.md §9.2; the
// fake core's `index_search` (app/ui/test/fake-search.ts) has D-1341's groups and D-1342's prefix (v1-search §9.3).
// Vault `search/` + `search-page/` + `new-empty/.tegg/` (D-1222) unless stated; region `cs-CZ`, Date format `ISO`,
// TZ Europe/Prague. Written from the ACs and the contract only (D-61); every lookup goes through `must`/node:assert
// (TS-I1). FR-SRC-01 AC-23 and FR-SRC-04 AC-10 check an order and a mark the fake core decides, so each also holds a red
// guard on the page itself (no `Go to` list, D-1340): the UI has to change for them to pass.
// Not here: the pickers on `index.switcher` and ⌘O (FR-NAV-01 AC-1…AC-10, AC-18 keep their tests).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import { mainName, mustBeOn, nonReadCalls } from './helpers';
import {
  T, addTag, chooseType, click, countLine, countWhen, emptyState, eventually, filtersGroup, flat, focusName, focusedRowTitle, goToList,
  main, must, pageVault, rows, searchQuery, sleep, startPage, titles, titlesWhen, typeMenu, typeQuery, vaultWrites,
} from './search-page-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const createBtn = (page: Page, q: string) => main(page).getByRole('button', { name: `Create “${q.normalize('NFC')}”`, exact: true });
const createAsBtn = (page: Page) => main(page).getByRole('button', { name: 'as…', exact: true });
const anyCreateBtn = (page: Page) => main(page).getByRole('button', { name: /^Create “/ });

const DAILY = 'Daily/2026-10-12.md';
const TAG = 'Tags/Knihy.md';
/** The combined vault plus a Daily Note and a Tag file (the `daily/<date>` and `tag/<key>` routes of AC-21). */
const routesVault = () => pageVault((f) => {
  f[DAILY] = '---\nid: 01JA0S0000000000000000S0D1\ntype: daily-note\ntitle: "2026-10-12"\ndate: 2026-10-12\n---\nPondělí.\n';
  f[TAG] = '---\nid: 01JA0S0000000000000000S0T1\ntype: tag\ntitle: Knihy\n---\n';
});

/** Asserts the page shows no `Go to` (D-1340): no element named `Go to`, no `option`, no list wiring on the field. */
async function noGoTo(page: Page, what: string) {
  assert.equal(await goToList(page).count(), 0, `${what}: no listbox "Go to"`);
  assert.equal(await page.getByLabel('Go to', { exact: true }).count(), 0, `${what}: no element named "Go to"`);
  assert.equal(await main(page).getByRole('heading', { name: 'Go to', exact: true }).count(), 0, `${what}: no heading "Go to"`);
  assert.equal(await page.getByRole('option').count(), 0, `${what}: no option on the page`);
}

/** Visible text and controls in main between the `Filters` group and `Search results`, outside the count line
 *  (`status`) and the two create buttons. */
async function strayBetween(page: Page): Promise<{ text: string[]; controls: string[]; found: boolean }> {
  return page.evaluate(() => {
    const m = [...document.querySelectorAll('main, [role="main"]')].find((e) => e.getClientRects().length > 0);
    const filters = m?.querySelector('[role="group"][aria-label="Filters"]');
    const list = m?.querySelector('[aria-label="Search results"]');
    if (!m || !filters || !list) return { text: [], controls: [], found: false };
    const between = (n: Node) =>
      !!(filters.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && !filters.contains(n)
      && !!(list.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) && !n.contains(list) && !n.contains(filters);
    const isCreate = (e: Element | null) => {
      const b = e?.closest('button');
      const name = (b?.getAttribute('aria-label') ?? b?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return !!b && (/^Create “.*”$/.test(name) || name === 'as…');
    };
    const allowed = (e: Element | null) => !!e && (!!e.closest('[role="status"]') || isCreate(e));
    const text: string[] = [];
    const controls: string[] = [];
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent ?? '').trim();
      const p = n.parentElement;
      if (!t || !p || !between(n) || p.getClientRects().length === 0 || p.closest('[aria-hidden="true"]')) continue;
      if (!allowed(p)) text.push(t);
    }
    for (const e of m.querySelectorAll('button, a, input, select, textarea, [role="option"], [role="listbox"], [tabindex]')) {
      if (!between(e) || e.getClientRects().length === 0) continue;
      if (!isCreate(e)) controls.push(`${e.tagName.toLowerCase()} ${e.getAttribute('role') ?? ''} ${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim()}`);
    }
    return { text, controls, found: true };
  });
}

/** The caret sits in `Search query` (document.activeElement). */
const caretInField = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search query');

/** The title field holds the caret at its end with nothing selected (editor.md AC-13, D-367). */
async function titleCaretAtEnd(page: Page): Promise<{ inTitle: boolean; atEnd: boolean; collapsed: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const title = document.querySelector('[aria-label="Title"]') as HTMLElement | null;
    const inTitle = !!a && !!title && (a === title || title.contains(a));
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) {
      return { inTitle, atEnd: a.selectionStart === a.value.length, collapsed: a.selectionStart === a.selectionEnd };
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !title) return { inTitle, atEnd: false, collapsed: false };
    const r = document.createRange();
    r.selectNodeContents(title);
    r.setStart(sel.focusNode!, sel.focusOffset);
    return { inTitle, atEnd: r.toString().length === 0, collapsed: sel.isCollapsed };
  });
}

/** Types `q` in the field key by key (the caret stays there) and waits until the rows answer it. */
async function typeAndWait(page: Page, q: string, ok: (t: string[]) => boolean, what: string) {
  const f = await must(searchQuery(page), 'searchbox "Search query"');
  await f.fill('');
  await f.focus();
  await page.keyboard.type(q);
  const t = await titlesWhen(page, ok, 3000);
  assert.ok(ok(t), `${what}: rows ${t.join(' | ')}`);
}

async function back(page: Page) {
  await page.keyboard.press('Meta+BracketLeft');
}

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-20

test('fr_nav_01_ac20_no_go_to_on_the_page', async ({ page }) => {
  await startPage(page);
  for (const q of ['cteni', 'rozpo', 'Nová myšlenka']) {
    await typeQuery(page, q);
    await sleep(400); // the debounce (120 ms) and the fake core's answer
    await noGoTo(page, q);
    const field = await must(searchQuery(page), 'searchbox "Search query"');
    assert.equal(await field.getAttribute('aria-activedescendant'), null, `${q}: Search query has no aria-activedescendant`);
    assert.equal(await field.getAttribute('aria-controls'), null, `${q}: Search query has no aria-controls`);
  }
  for (const q of ['cteni', 'rozpo']) {
    await typeQuery(page, q);
    await titlesWhen(page, (t) => t.length > 0);
    const s = await strayBetween(page);
    assert.ok(s.found, `${q}: the Filters group and Search results are shown`);
    assert.deepEqual({ text: s.text, controls: s.controls }, { text: [], controls: [] },
      `${q}: between Filters and Search results only the count line and the create buttons`);
  }
  await typeQuery(page, 'cteni');
  const t = await titlesWhen(page, (x) => x[0] === T.cteni);
  assert.equal(t[0], T.cteni, 'cteni: the first row of Search results is Čtení');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-21

test('fr_nav_01_ac21_keys_in_the_field', async ({ page }) => {
  await startPage(page);
  await typeAndWait(page, 'rozpo', (t) => t.length === 5, 'rozpo: five rows');
  assert.ok(await caretInField(page), 'the caret stays in Search query while typing');
  const t = await titles(page);
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedRowTitle(page), (x) => x === t[0], 1000), t[0], '↓ in the field focuses the first row\'s link');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedRowTitle(page), t[1], '↓ on a row moves to the next row link (FR-SRC-03 AC-17)');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedRowTitle(page), t[0], '↑ moves back to the first row');
  await page.keyboard.press('ArrowUp');
  assert.equal((await focusName(page)).name, 'Search query', '↑ on the first row returns the focus to Search query');
  // Esc keeps its meaning: with no page Search was opened from (search is the first entry), it clears the query.
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => searchQuery(page).inputValue().catch(() => '?'), (v) => v === '', 1000), '', 'Esc clears the query when there is no page to return to');
  assert.equal(await mainName(page), 'Search', 'still on search');
});

test('fr_nav_01_ac21_esc_returns_to_the_page_search_was_opened_from', async ({ page }) => {
  await startPage(page, { route: null });
  const before = await eventually(() => mainName(page), (n) => !!n && n !== 'Search', 3000);
  assert.ok(before && before !== 'Search', `the start page names its centre pane (${before})`);
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', '⇧⌘F opens search');
  await typeAndWait(page, 'rozpo', (t) => t.length === 5, 'rozpo');
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedRowTitle(page), (x) => x !== null, 1000) !== null, true, 'red guard: ↓ focuses the first row (D-1340)');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  await mustBeOn(page, before!, 'Esc in the field returns to the page Search was opened from');
});

test('fr_nav_01_ac21_enter_opens_the_first_result_and_back_restores_the_search', async ({ page }) => {
  const core = await startPage(page, { vault: routesVault() });
  await chooseType(page, 'Page');
  await typeAndWait(page, 'cteni', (t) => same(t, [T.cteni]), 'cteni + Type: Page');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, T.cteni, '⏎ in the field opens the first result (note/Pages/Čtení knih.md)');
  await back(page);
  await mustBeOn(page, 'Search', 'Back returns to search: the open was a new history entry');
  assert.equal(await eventually(() => searchQuery(page).inputValue().catch(() => ''), (v) => v === 'cteni', 2000), 'cteni', 'the same text');
  const typeLabel = flat(await filtersGroup(page).getByRole('button', { name: /^Type: / }).first().evaluate((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText));
  assert.equal(typeLabel, 'Type: Page', 'the same filters');
  assert.deepEqual(await titlesWhen(page, (t) => same(t, [T.cteni])), [T.cteni], 'the same rows');
  assert.equal((await eventually(() => focusName(page), (f) => f.name === 'Search query', 2000)).name, 'Search query', 'the focus in Search query (D-1217)');
  // daily/<date> and tag/<key> open the same way.
  await chooseType(page, 'All types');
  await typeAndWait(page, '2026-10-12', (t) => t[0] === '2026-10-12', '2026-10-12: the Daily Note first');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => page.evaluate(() => {
    const t = document.querySelector('[aria-label="Title"]') as HTMLInputElement | HTMLElement | null;
    return t ? ((t as HTMLInputElement).value ?? t.textContent ?? '').trim() : null;
  }), (v) => v === '2026-10-12', 3000), '2026-10-12', '⏎ on the Daily Note opens daily/2026-10-12');
  await back(page);
  await mustBeOn(page, 'Search', 'Back returns to search');
  await typeAndWait(page, 'knihy', (t) => t[0] === 'Knihy', 'knihy: the Tag file first');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Enter');
  await must(main(page).getByRole('heading', { level: 1, name: /^#?Knihy$/i }), '⏎ on the Tag file opens tag/knihy (D-692)', 3000);
  assert.deepEqual(await vaultWrites(core), [], 'opening results writes nothing');
});

test('fr_nav_01_ac21_enter_with_no_results_or_an_empty_query_does_nothing', async ({ page }) => {
  const core = await startPage(page);
  const files0 = JSON.stringify(await core.files());
  await typeQuery(page, 'borůvkový koláč');
  await must(emptyState(page, 'No results for “borůvkový koláč”'), 'the no-match state');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Enter');
  await sleep(500);
  assert.equal(await mainName(page), 'Search', '⏎ with no results: still on search');
  assert.deepEqual(await vaultWrites(core), [], '⏎ with no results writes nothing');
  await typeQuery(page, '');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Enter');
  await sleep(400);
  assert.equal(await mainName(page), 'Search', '⏎ with an empty query: still on search');
  assert.deepEqual(await nonReadCalls(core), [], 'only read commands');
  assert.equal(JSON.stringify(await core.files()), files0, 'the vault is byte-identical');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-22

test('fr_nav_01_ac22_create_buttons_end_the_count_line', async ({ page }) => {
  const core = await startPage(page);
  assert.equal(await anyCreateBtn(page).count() + await createAsBtn(page).count(), 0, 'with no text there are no create buttons');
  await typeAndWait(page, 'cteni', (t) => same(t, [T.cteni]), 'cteni');
  assert.equal(await countWhen(page, '1 result'), '1 result', 'the count line: 1 result');
  await must(createBtn(page, 'cteni'), 'button Create “cteni”');
  const as = await must(createAsBtn(page), 'button as…');
  assert.equal(await as.getAttribute('aria-haspopup'), 'menu', 'as… has aria-haspopup="menu"');
  const order = await page.evaluate(() => {
    const m = [...document.querySelectorAll('main, [role="main"]')].find((e) => e.getClientRects().length > 0)!;
    const status = [...m.querySelectorAll('[role="status"]')].find((s) => /^\s*\d+ results?\b/.test((s as HTMLElement).innerText));
    const btns = [...m.querySelectorAll('button')];
    const c = btns.find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === 'Create “cteni”');
    const a = btns.find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === 'as…');
    const list = m.querySelector('[aria-label="Search results"]');
    if (!status || !c || !a || !list) return null;
    const after = (x: Node, y: Node) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
    const sr = status.getBoundingClientRect(), cr = c.getBoundingClientRect(), ar = a.getBoundingClientRect(), lr = list.getBoundingClientRect();
    const sameLine = (r: DOMRect) => r.top < sr.bottom && r.bottom > sr.top;
    return { statusThenCreate: after(status, c) || status.contains(c), createThenAs: after(c, a), beforeResults: after(a, list), sameLine: sameLine(cr) && sameLine(ar), above: ar.bottom <= lr.top + 0.5 };
  });
  assert.deepEqual(order, { statusThenCreate: true, createThenAs: true, beforeResults: true, sameLine: true, above: true },
    'the count line reads 1 result, then Create “cteni”, then as…, above the results');
  await click(createBtn(page, 'cteni'), 'Create “cteni”');
  await mustBeOn(page, 'cteni', 'Create “cteni” opens the new object', 5000);
  const w = await eventually(() => core.writesTo(), (x) => x.length > 0, 3000);
  assert.deepEqual(w, ['Quick Notes/cteni.md'], 'one write: Quick Notes/cteni.md (the default type), although Čtení matches');
  assert.equal((await vaultWrites(core)).length, 1, 'one vault-write command (the one creation path, D-232)');
  const text = (await core.files())['Quick Notes/cteni.md'] ?? '';
  assert.ok(text.includes('\ntitle: cteni\n') && text.includes('\ntype: quick-note\n'), `title: cteni, type: quick-note: ${text}`);
  assert.deepEqual(await eventually(() => titleCaretAtEnd(page), (c) => c.inTitle && c.atEnd && c.collapsed, 2000), { inTitle: true, atEnd: true, collapsed: true },
    'the caret at the end of the title (editor.md AC-13, D-367)');
});

test('fr_nav_01_ac22_as_menu_creates_with_the_chosen_type', async ({ page }) => {
  const core = await startPage(page);
  await typeAndWait(page, 'cteni', (t) => same(t, [T.cteni]), 'cteni');
  await click(createAsBtn(page), 'as…');
  const menu = await must(typeMenu(page), 'menu "Type" (D-550, FR-VLT-05 AC-3)');
  await click(menu.getByRole('menuitemradio', { name: 'Page', exact: true }).or(menu.getByRole('menuitem', { name: 'Page', exact: true })), 'Page');
  const t = await eventually(async () => (await core.files())['Pages/cteni.md'], (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\ntype: page\n'), `Pages/cteni.md with type: page: ${t}`);
  assert.deepEqual(await core.writesTo(), ['Pages/cteni.md'], 'one write');
  await mustBeOn(page, 'cteni', 'it opens');
});

test('fr_nav_01_ac22_no_match_empty_state_offers_create', async ({ page }) => {
  const core = await startPage(page);
  await typeQuery(page, 'borůvkový koláč');
  const region = await must(emptyState(page, 'No results for “borůvkový koláč”'), 'region "No results for “borůvkový koláč”"');
  assert.equal(flat(await region.locator('p').first().innerText()), 'No matches. Create “borůvkový koláč”?', 'the body');
  await must(region.getByRole('button', { name: 'Create “borůvkový koláč”', exact: true }), 'button Create “borůvkový koláč”');
  const as = await must(region.getByRole('button', { name: 'as…', exact: true }), 'button as…');
  assert.equal(await as.getAttribute('aria-haspopup'), 'menu', 'as… opens a menu');
  assert.equal(await countLine(page), null, 'no count line in an empty state');
  const f = await must(searchQuery(page), 'Search query');
  await f.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+Enter');
  await sleep(500);
  assert.deepEqual(await core.writesTo(), [], '⏎ (no first result) and ⌘↩ do nothing here');
  assert.equal(await mainName(page), 'Search', 'still on search');
  await f.focus();
  await page.keyboard.press('Alt+Enter');
  await mustBeOn(page, 'borůvkový koláč', '⌥⏎ creates and opens it', 5000);
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0, 3000), ['Quick Notes/borůvkový koláč.md'], '⌥⏎: one write with the default type');
});

test('fr_nav_01_ac22_no_create_buttons_in_the_filtered_empty_state', async ({ page }) => {
  await startPage(page);
  await typeAndWait(page, 'rozpočet', (t) => t.length === 5, 'rozpočet');
  await must(createBtn(page, 'rozpočet'), 'red guard: Create “rozpočet” while results are shown');
  await chooseType(page, 'Task');
  await addTag(page, 'hory');
  const region = await must(emptyState(page, 'No results for “rozpočet”'), 'the empty state with filters (FR-SRC-03 AC-15)');
  assert.deepEqual((await region.getByRole('button').allInnerTexts()).map(flat), ['Clear filters'], 'only Clear filters in the empty state with filters');
  assert.equal(await anyCreateBtn(page).count() + await createAsBtn(page).count(), 0, 'no create buttons there');
  await typeQuery(page, '');
  await sleep(300);
  assert.equal(await anyCreateBtn(page).count() + await createAsBtn(page).count(), 0, 'no text: no create buttons');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-23 (L5)

test('fr_nav_01_ac23_only_the_create_buttons_and_option_enter_write', async ({ page }) => {
  const core = await startPage(page);
  const files0 = JSON.stringify(await core.files());
  await typeAndWait(page, 'cteni', (t) => same(t, [T.cteni]), 'cteni');
  await page.keyboard.press('ArrowDown');
  assert.equal(await eventually(() => focusedRowTitle(page), (x) => x === T.cteni, 1000), T.cteni, '↓ focuses the Čtení row');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await mustBeOn(page, T.cteni, '⏎ in the field opens Čtení');
  await back(page);
  await mustBeOn(page, 'Search', 'Back returns to search');
  await sleep(300);
  assert.deepEqual(await vaultWrites(core), [], 'typing, ↓/↑, ⏎ on a result and Back write nothing');
  assert.equal(JSON.stringify(await core.files()), files0, 'the vault is byte-identical');
  await titlesWhen(page, (t) => same(t, [T.cteni]));
  await click(createBtn(page, 'cteni'), 'Create “cteni”');
  await mustBeOn(page, 'cteni', 'the create button opens the new object', 5000);
  await back(page);
  await mustBeOn(page, 'Search', 'Back returns to search');
  await typeAndWait(page, 'Nová myšlenka', (t) => t.length === 0, 'Nová myšlenka: no match');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Alt+Enter');
  await mustBeOn(page, 'Nová myšlenka', '⌥⏎ creates', 5000);
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 2, 3000);
  assert.deepEqual(w, ['Quick Notes/cteni.md', 'Quick Notes/Nová myšlenka.md'], 'the create button and ⌥⏎ write one file each, nothing else');
});

// ------------------------------------------------------------------------------------------------ FR-SRC-01 AC-23 (L5, once)

const TITLE_NOTES: [string, string, string, string[], string][] = [
  ['Pages/Rovno.md', '01JB0T00000000000000000T01', 'Summer Ångström', [], 'Plain text.'],
  ['Pages/Fráze.md', '01JB0T00000000000000000T02', 'Summer Ångström old by', [], 'Nothing here.'],
  ['Pages/Slova.md', '01JB0T00000000000000000T03', 'Ångström notes for summer', [], 'Other words.'],
  ['Pages/Alias.md', '01JB0T00000000000000000T04', 'Výlet', ['Summer Ångström trip'], 'Plain text.'],
  ['Pages/Tělo.md', '01JB0T00000000000000000T05', 'Goal Ångström budget', [], 'Zürich summer Ångström. Summer Ångström again, summer Ångström.'],
  ['Pages/Řeka.md', '01JB0T00000000000000000T06', 'River summer quarter', [], 'Later ångström appears.'],
  ['Pages/Summer Ångström log.md', '01JB0T00000000000000000T07', 'Deník', [], 'Plain text.'],
];
/** `search-ranking/` + `new-empty/.tegg/` + the `search-title/` runtime notes (FR-SRC-01 AC-23's table). */
function titleVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/search-ranking', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Trezor' };
  for (const [path, id, title, aliases, body] of TITLE_NOTES) {
    const al = aliases.length ? `aliases:\n${aliases.map((a) => `  - ${a}\n`).join('')}` : '';
    v.files[path] = `---\nid: ${id}\ntype: page\ntitle: ${title}\n${al}created: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}\n`;
  }
  return v;
}

test('fr_src_01_ac23_rendered_title_first_order', async ({ page }) => {
  await startPage(page, { vault: titleVault() });
  await typeAndWait(page, 'summer angstrom', (t) => t.length === 7, 'summer angstrom: seven rows');
  await noGoTo(page, 'red guard (D-1340): quick switching is the results list');
  const t = await titles(page);
  assert.equal(t[0], 'Summer Ångström', `the title equal to the query first: ${t.join(' | ')}`);
  assert.deepEqual([...t.slice(1, 3)].sort(), ['Deník', 'Summer Ångström old by'], `then the phrase in the title or file name: ${t.join(' | ')}`);
  assert.deepEqual(t.slice(3), ['Ångström notes for summer', 'Výlet', 'Goal Ångström budget', 'River summer quarter'], `then all words in the title, the alias, the body phrase, the rest: ${t.join(' | ')}`);
});

// ------------------------------------------------------------------------------------------------ FR-SRC-04 AC-10 (L5 mark)

test('fr_src_04_ac10_a_prefix_match_shows_no_similar_spelling_mark', async ({ page }) => {
  await startPage(page, { vault: pageVault((f) => {
    f['Pages/Sůl.md'] = '---\nid: 01JA0S0000000000000000S0S1\ntype: page\ntitle: Sůl\n---\nKuchyně.\n';
    f['Pages/Sůlová lázeň.md'] = '---\nid: 01JA0S0000000000000000S0S2\ntype: page\ntitle: Sůlová lázeň\n---\nKoupel.\n';
  }) });
  await typeAndWait(page, 'sůl', (t) => same(t, ['Sůl', 'Sůlová lázeň']), 'sůl: Sůl before Sůlová lázeň');
  await noGoTo(page, 'red guard (D-1340)');
  const r = await rows(page);
  assert.deepEqual(r.map((x) => [x.title, x.typo]), [['Sůl', ''], ['Sůlová lázeň', '']], 'no similar spelling mark on the exact or the prefix-only row');
  assert.deepEqual(r[1]?.titleMarks, ['Sůl'], 'the prefix row highlights the matched prefix only');
  await typeAndWait(page, 'cten', (t) => same(t, [T.cteni]), 'cten: Čtení');
  const c = await rows(page);
  assert.deepEqual([c[0]?.titleMarks, c[0]?.typo], [['Čten'], ''], 'cten: `Čten` highlighted, no similar spelling mark');
});
