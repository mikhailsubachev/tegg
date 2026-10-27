// Preview v0.68 feedback, L5 (WebKit + fake core): the Search page's `Go to` list replaces ⌘O and the Quick switcher
// (D-760; docs/feedback/ms6-v068.md F9). docs/acceptance/search-navigation.md FR-NAV-01 AC-15 (rows), AC-16 (keyboard),
// AC-17 (create), AC-18 (no ⌘O; the L1 part for R4 is app/test/v068_registry.ac.test.ts). The fixture `search/` in the
// fake core, plus runtime objects: 12 `Poznámka NN` pages (for the 8-row limit), a Daily Note and a Tag file (for the
// `daily/<date>` and `tag/<key>` routes of AC-16). The fake's `index_switcher` answers the list (ms3-shell §5).
// Written from the ACs only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1 } from '../test/shell-tables';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import {
  eventually, mainName, must, titleState, mustBeOn, nonReadCalls, paletteDialog, paletteOptions, runCommand, seen, settled, sidebar, sleep, start,
  type FakeCoreHandle,
} from './helpers';
import { flat, goToList, goToOptions, openSearch, searchBtn, searchQuery, searchResults } from './v068-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const DAILY = 'Daily/2026-10-12.md';
const TAG = 'Tags/Knihy.md';
function searchVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/search', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Hledání' };
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, '0');
    v.files[`Pages/Poznámka ${n}.md`] = `---\nid: 01JA0S0000000000000000P0${n}\ntype: page\ntitle: Poznámka ${n}\ncreated: 2026-09-01T09:00:00+02:00\nmodified: 2026-09-01T09:00:00+02:00\n---\nText.\n`;
  }
  v.files[DAILY] = '---\nid: 01JA0S0000000000000000S0D1\ntype: daily-note\ntitle: "2026-10-12"\ndate: 2026-10-12\n---\nPondělí.\n';
  v.files[TAG] = '---\nid: 01JA0S0000000000000000S0T1\ntype: tag\ntitle: Knihy\n---\n';
  return v;
}
async function startSearch(page: Page): Promise<FakeCoreHandle> {
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00+02:00'));
  return start(page, { vault: searchVault() });
}
/** Types `q` into `Search query` and waits for the `Go to` list to answer it. */
async function query(page: Page, q: string) {
  const f = await must(searchQuery(page), 'textbox "Search query"');
  await f.fill(q);
  await must(goToList(page), `listbox "Go to" for ${JSON.stringify(q)}`, 3000);
  await settled(page, 'Go to', q);
}
/** The selected option's first line, and whether the field's aria-activedescendant points at it. */
async function selection(page: Page): Promise<{ title: string; active: boolean; caretInField: boolean }> {
  return page.evaluate(() => {
    const list = [...document.querySelectorAll('[role="listbox"]')].find((l) => l.getAttribute('aria-label') === 'Go to') as HTMLElement | undefined;
    const sel = list?.querySelector('[role="option"][aria-selected="true"]') as HTMLElement | null;
    const field = document.querySelector('[aria-label="Search query"]') as HTMLElement | null;
    const ad = field?.getAttribute('aria-activedescendant') ?? '';
    return {
      title: (sel?.innerText ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().normalize('NFC'),
      active: !!sel && !!ad && sel.id === ad,
      caretInField: document.activeElement === field,
    };
  });
}

// ------------------------------------------------------------------------------------------------ AC-15

test('fr_nav_01_ac15_go_to_rows_above_the_results', async ({ page }) => {
  await startSearch(page);
  const field = await openSearch(page);
  assert.equal(await goToList(page).count(), 0, 'an empty query shows no Go to list');
  await query(page, 'cteni');
  const opts = await goToOptions(page);
  assert.match(opts[0] ?? '', /^Čtení knih/, `first option Čtení knih: ${opts.join(' | ')}`);
  const sel = await selection(page);
  assert.ok(sel.title.startsWith('Čtení knih') && sel.active, `Čtení knih is selected and the field's aria-activedescendant (${JSON.stringify(sel)})`);
  const first = goToList(page).getByRole('option').first();
  assert.equal(await first.locator('svg[data-icon]').count() >= 1, true, 'the type icon (data-icon)');
  assert.ok(flat(await first.innerText()).includes('Pages'), 'the folder Pages');
  await field.fill('');
  assert.ok((await eventually(() => goToList(page).count(), (n) => n === 0, 1500)) === 0, 'clearing the query hides the Go to list');
  await query(page, 'reading');
  const reading = goToList(page).getByRole('option').first();
  assert.ok(flat(await reading.innerText()).startsWith('Čtení knih') && flat(await reading.innerText()).includes('alias: Reading list'), `reading: Čtení knih with alias: Reading list (${flat(await reading.innerText())})`);
  await query(page, 'rozpo');
  const r = await goToOptions(page);
  const [a, b] = [r.findIndex((t) => t.startsWith('Rozpočet 2026')), r.findIndex((t) => t.startsWith('Projekt a rozpočet'))];
  assert.ok(a >= 0 && b > a, `Rozpočet before Projekt (AC-3): ${r.join(' | ')}`);
  await query(page, 'Poznámka');
  const many = await goToList(page).getByRole('option').count();
  assert.ok(many > 0 && many <= 8, `at most 8 options (got ${many})`);
  await field.fill('rozpočet');
  await must(goToList(page), 'Go to for rozpočet');
  const lists = await page.evaluate(() => {
    const g = [...document.querySelectorAll('[role="listbox"]')].find((l) => l.getAttribute('aria-label') === 'Go to')?.getBoundingClientRect();
    const s = document.querySelector('[aria-label="Search results"]')?.getBoundingClientRect();
    return g && s ? { goBottom: g.bottom, resultsTop: s.top } : null;
  });
  assert.ok(lists && lists.goBottom <= lists.resultsTop + 0.5, `Go to is above Search results (${JSON.stringify(lists)})`);
  const rows = await eventually(async () => (await searchResults(page).getByRole('listitem').allInnerTexts()).map(flat), (x) => x.length >= 3, 2000);
  for (const t of ['Rozpočet 2026', 'Projekt a rozpočet', 'Obyčejná poznámka']) assert.ok(rows.some((x) => x.includes(t)), `the full-text results still list ${t}: ${rows.join(' | ')}`);
});

// ------------------------------------------------------------------------------------------------ AC-16

test('fr_nav_01_ac16_keyboard_wraps_opens_and_back_skips_search', async ({ page }) => {
  await startSearch(page);
  // The start page (Inbox) names its centre pane after the frame shows; read right after start the name was still
  // empty under the push gate's load, so Back could never match it (2026-10-27, D-688): wait for a name.
  const before = await eventually(() => mainName(page), (n) => !!n, 3000);
  assert.ok(before, 'the start page names its centre pane');
  await openSearch(page);
  await query(page, 'rozpo');
  const n = await goToList(page).getByRole('option').count();
  assert.ok(n >= 2, `at least two options for rozpo (${n})`);
  const titles = await goToOptions(page);
  assert.equal((await selection(page)).title, titles[0], 'the first row is selected');
  await page.keyboard.press('ArrowDown');
  let s = await selection(page);
  assert.ok(s.title === titles[1] && s.caretInField, `↓ selects the second row, the caret stays in the field (${JSON.stringify(s)})`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  s = await selection(page);
  assert.ok(s.title === titles[n - 1] && s.caretInField, `↑ from the first row wraps to the last (${JSON.stringify(s)})`);
  await page.keyboard.press('ArrowDown');
  assert.equal((await selection(page)).title, titles[0], '↓ from the last row wraps to the first');
  await page.keyboard.press('Enter');
  assert.match(titles[0], /^Rozpočet 2026/, 'rozpo: Rozpočet 2026 first (AC-15)');
  await mustBeOn(page, 'Rozpočet 2026', '⏎ opens the selected object (note/Pages/Rozpočet 2026.md)', 5000);
  await (await must(page.getByRole('button', { name: 'Back', exact: true }), 'title-bar Back')).click();
  // The jump replaced the Search entry (as the ⌘O switcher did, FR-NAV-03 AC-1): Back returns to the page before Search.
  await mustBeOn(page, before, 'Back returns to the page Search was opened from', 3000);
  // Esc in the field returns there too.
  await openSearch(page);
  await query(page, 'rozpo');
  await page.keyboard.press('Escape');
  await mustBeOn(page, before ?? '', 'Esc returns to the page Search was opened from', 3000);
  await openSearch(page);
  // daily/<date> and tag/<key> (D-692) open from the list too.
  await query(page, '2026-10-12');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => page.evaluate(() => {
    const t = document.querySelector('[aria-label="Title"]') as HTMLInputElement | HTMLElement | null;
    return t ? ((t as HTMLInputElement).value ?? t.textContent ?? '').trim() : null;
  }), (v) => v === '2026-10-12', 3000), '2026-10-12', '⏎ on the Daily Note opens daily/2026-10-12');
  await openSearch(page);
  await query(page, 'Knihy');
  const k = await goToOptions(page);
  const at = k.findIndex((t) => /^Knihy\b/.test(t));
  assert.ok(at >= 0, `the Tag file Knihy is listed: ${k.join(' | ')}`);
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await must(page.getByRole('main').getByRole('heading', { level: 1, name: /^Knihy$/i }), '⏎ on the Tag file opens tag/knihy (D-692)', 3000);
  assert.equal(await page.getByRole('main').getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).count(), 0, 'not as a note page');
  // Tab: the next control, then the full-text results; Esc leaves Search (the field-level part is checked above).
  await openSearch(page);
  await query(page, 'rozpočet');
  await eventually(() => searchResults(page).getByRole('listitem').count(), (c) => c > 0, 2000);
  let inResults = false;
  for (let i = 0; i < 12 && !inResults; i++) {
    await page.keyboard.press('Tab');
    inResults = await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Search results"]'));
  }
  assert.ok(inResults, 'Tab reaches the full-text results');
  const f = await must(searchQuery(page), 'Search query');
  await f.focus();
  await page.keyboard.press('Escape');
  assert.ok((await eventually(() => goToList(page).count(), (c) => c === 0, 1000)) === 0, 'Esc leaves Search: no Go to list');
});

// ------------------------------------------------------------------------------------------------ AC-17

test('fr_nav_01_ac17_create_from_go_to_and_its_type_menu', async ({ page }) => {
  const core = await startSearch(page);
  await openSearch(page);
  await query(page, 'Nová myšlenka');
  const named = goToList(page).getByRole('option', { name: 'Create "Nová myšlenka"', exact: true });
  assert.equal(await named.count(), 1, `one option Create "Nová myšlenka": ${(await goToOptions(page)).join(' | ')}`);
  const objects = (await goToOptions(page)).filter((t) => !t.startsWith('Create "'));
  assert.deepEqual(objects, [], 'no object matches');
  assert.equal((await selection(page)).title, 'Create "Nová myšlenka"', 'the create row is selected');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nová myšlenka', '⏎ creates and opens it', 5000);
  const written = await eventually(() => core.writesTo(), (w) => w.includes('Quick Notes/Nová myšlenka.md'), 3000);
  assert.deepEqual(written.filter((p) => p === 'Quick Notes/Nová myšlenka.md'), ['Quick Notes/Nová myšlenka.md'], 'one write of Quick Notes/Nová myšlenka.md (the default type)');
  assert.deepEqual(written.filter((p) => p !== 'Quick Notes/Nová myšlenka.md'), [], 'nothing else written');
  assert.ok((await eventually(() => titleState(page), (v) => v.focused, 2000)).focused, 'the caret is in the title (editor.md AC-13, D-367)');
  // The Type menu (D-550): another type before creating.
  await openSearch(page);
  await query(page, 'Výlet na Sněžku');
  await must(goToList(page).getByRole('option', { name: 'Create "Výlet na Sněžku"', exact: true }), 'Create "Výlet na Sněžku"');
  await (await must(searchQuery(page), 'Search query')).focus();
  await page.keyboard.press('Alt+Enter');
  if (!(await seen(page.getByRole('menu', { name: 'Type', exact: true }), 1000))) {
    await (await must(goToList(page).getByRole('option', { name: 'Create "Výlet na Sněžku" as…', exact: true }), 'Create "Výlet na Sněžku" as…')).click();
  }
  const menu = await must(page.getByRole('menu', { name: 'Type', exact: true }), 'menu "Type" (D-550)');
  await (await must(menu.getByRole('menuitemradio', { name: 'Page', exact: true }), 'Page')).click();
  const t = await eventually(async () => (await core.files())['Pages/Výlet na Sněžku.md'], (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\ntype: page\n'), `Pages/Výlet na Sněžku.md with type: page: ${t}`);
});

// ------------------------------------------------------------------------------------------------ AC-18

test('fr_nav_01_ac18_cmd_o_does_nothing_on_every_built_route', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await startSearch(page);
  const bad: string[] = [];
  for (const row of R1.filter((r) => r.goto && r.built)) {
    await runCommand(page, row.goto!);
    await sleep(250);
    const before = await mainName(page);
    const calls = (await nonReadCalls(core)).length;
    await page.keyboard.press('Meta+o');
    await sleep(300);
    if (await page.getByRole('dialog').count()) bad.push(`${row.id}: a dialog opened`);
    if ((await mainName(page)) !== before) bad.push(`${row.id}: the route changed`);
    if ((await nonReadCalls(core)).length !== calls) bad.push(`${row.id}: a write command was sent`);
    if (await page.getByRole('dialog', { name: 'Quick switcher' }).count() + await page.getByLabel('Switcher query').count()) bad.push(`${row.id}: Quick switcher / Switcher query exists`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(bad, [], '⌘O opens no dialog, changes no route and writes nothing');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});

test('fr_nav_01_ac18_no_switcher_command_and_cmd_shift_f_selects_the_query', async ({ page }) => {
  await startSearch(page);
  for (const q of ['switcher', 'jump', 'Quick']) {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'Command palette');
    await page.getByRole('combobox', { name: 'Command query' }).fill(q);
    await sleep(300);
    const opts = (await paletteOptions(page)).map(flat);
    assert.deepEqual(opts.filter((o) => /Search or jump to|Quick switcher|Open quick switcher/i.test(o)), [], `the palette lists no switcher command for "${q}": ${opts.join(' | ')}`);
    await page.keyboard.press('Escape');
  }
  const field = await openSearch(page);
  await field.fill('rozpočet');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', '⇧⌘F on search', 3000);
  const sel = await eventually(() => page.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return { label: a?.getAttribute('aria-label') ?? '', value: a?.value ?? '', start: a?.selectionStart ?? -1, end: a?.selectionEnd ?? -1 };
  }), (x) => x.label === 'Search query' && x.start === 0 && x.end === x.value.length && x.value.length > 0, 2000);
  assert.deepEqual(sel, { label: 'Search query', value: 'rozpočet', start: 0, end: 'rozpočet'.length }, '⇧⌘F: the caret in Search query with its text selected');
  await runCommand(page, 'Go to Inbox');
  await (await must(searchBtn(page), 'sidebar button "Search" (app-shell FR-NAV-01 AC-14)')).click();
  await mustBeOn(page, 'Search', 'the sidebar Search button opens search', 3000);
  const viaBtn = await eventually(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), (l) => l === 'Search query', 2000);
  assert.equal(viaBtn, 'Search query', 'the caret is in Search query');
  assert.equal(await sidebar(page).getByText('Search or jump to…').count(), 0, 'no Search or jump to… in the sidebar');
});
