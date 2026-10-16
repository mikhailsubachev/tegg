// MS4 slice 4B preview feedback (D-368), L5 (WebKit + fake core): the Backlinks panel shows one chip per linking
// object. FR-LNK-01 AC-17…AC-21, FR-LNK-02 AC-7. docs/acceptance/backlinks.md (R15 D-368 row); interface
// docs/contracts/ms4-links.md §5 (chips carry `data-link-kind` and `data-icon`). Written from the ACs and the contract
// only (D-61). Every lookup goes through `must`/node:assert with short timeouts, so a missing chip fails an assertion
// (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, CIL_SOURCES, backlinksPanel, backlinksTab, callsOf, eventually, fileText, flat, focus, gotoNote, groupHeader, groups, linksVault,
  must, mustBeOn, mustPanel, openLinks, panelHeading, props, runCommand, seen, sleep, sourceRegion, swap, writeCalls,
} from './links-helpers';
import { absent } from './helpers';

const CIL_GROUPS = ['Pages, 4', 'Quick Notes, 1', 'Daily Notes, 1', 'Schůzky, 2', 'neznámý, 1'];
const CIL_ORDER: Record<string, string[]> = {
  Pages: ['Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička'],
  'Quick Notes': ['Rychlá poznámka'],
  'Daily Notes': ['2026-10-07'],
  Schůzky: ['2026-10-08 Porada', 'Starší porada'],
  neznámý: ['Bez typu s vlastností'],
};
/** Type icons of the sources (type definitions' `icon`; new-empty/.tegg and the fixture's schůzka.yml). */
const ICON: Record<string, string> = {
  'Odkazy v textu': 'file-text', 'Rozbité odkazy': 'file-text', 'Markdown odkaz': 'file-text', 'Neplatná hlavička': 'file-text',
  'Rychlá poznámka': 'zap', '2026-10-07': 'calendar', '2026-10-08 Porada': 'users', 'Starší porada': 'users',
};

/** The panel's chips: `link` elements with `data-link-kind="note"` (R15 D-368 row). */
const chipLinks = (scope: Locator) => scope.getByRole('link').and(scope.page().locator('[data-link-kind="note"]'));
async function names(loc: Locator): Promise<string[]> {
  return (await loc.evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? (a as HTMLElement).innerText ?? a.textContent ?? ''))).map(flat);
}
async function chipNames(page: Page): Promise<string[]> {
  await mustPanel(page);
  return names(chipLinks(backlinksPanel(page)));
}
async function chipsIn(page: Page, plural: string): Promise<string[]> {
  await mustPanel(page);
  const g = backlinksPanel(page).getByRole('group', { name: plural, exact: true });
  if (!(await seen(g, 1000))) return [];
  return names(chipLinks(g));
}
const chip = (page: Page, title: string) => chipLinks(backlinksPanel(page)).filter({ hasText: new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
async function badge(page: Page): Promise<string> {
  return flat(await (await must(backlinksTab(page), 'tab "Backlinks"')).innerText()).replace(/^Backlinks\s*/, '');
}
async function caretBlock(page: Page): Promise<{ text: string; offset: number } | null> {
  return page.evaluate(() => {
    const body = document.querySelector('[aria-label="Note body"]');
    const sel = window.getSelection();
    if (!body || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    let blk: Node | null = sel.anchorNode;
    while (blk && blk.parentNode !== body) blk = blk.parentNode;
    if (!blk) return null;
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    return { text: ((blk as HTMLElement).innerText ?? blk.textContent ?? '').replace(/\s+/g, ' ').trim(), offset: r.toString().length };
  });
}
const focusTarget = (page: Page) => page.evaluate(() => document.querySelector('[data-focus-target]')?.getAttribute('data-focus-target') ?? null);

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-17

test('fr_lnk_01_ac17_each_source_is_exactly_one_note_chip', async ({ page }) => {
  await openLinks(page, B.cil);
  const panel = await mustPanel(page);
  const got = await eventually(() => chipNames(page), (x) => x.length >= 9, 3000);
  assert.deepEqual([...got].sort(), [...CIL_SOURCES].sort(), "one note chip per source, Cíl's 9 sources each once");
  for (const title of CIL_SOURCES) {
    const c = chip(page, title);
    assert.equal(await c.count(), 1, `${title}: exactly one chip`);
    assert.equal(await c.first().getAttribute('data-link-kind'), 'note', `${title}: data-link-kind="note"`);
    const icon = await c.first().getAttribute('data-icon');
    if (ICON[title]) assert.equal(icon, ICON[title], `${title}: data-icon = the source type's icon`);
    else assert.ok(icon !== null && icon !== '' && icon !== 'file-text', `${title}: the no-definition icon (D-121), not the Page icon: ${icon}`);
  }
  assert.equal(await panel.locator('[data-occurrence]').count(), 0, 'no excerpt elements');
  assert.equal(await panel.locator('[data-link-here]').count(), 0, 'no data-link-here marks');
  const text = flat(await panel.innerText());
  for (const gone of ['Téma:', 'Účastníci:', 'Poznámka:', 'Embed', 'Viz Cíl a také', 'Bod s odkazem', 'Markdownový odkaz první']) {
    assert.ok(!text.includes(gone), `no ${JSON.stringify(gone)} in the panel`);
  }
  assert.equal(await chipLinks(panel).count(), 9, 'no other link chip in the panel (Odkazy v textu 5, Porada 6, Rychlá poznámka 3 occurrences: one chip each)');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-18

test('fr_lnk_01_ac18_groups_and_chip_order_without_show_more', async ({ page }) => {
  await openLinks(page, B.cil);
  assert.deepEqual(await groups(page), CIL_GROUPS, 'the AC-3 groups and counts');
  for (const [plural, want] of Object.entries(CIL_ORDER)) assert.deepEqual(await chipsIn(page, plural), want, `${plural}: chips in the AC-3 order`);
  assert.equal(await backlinksPanel(page).getByRole('button', { name: /^Show \d+ more$/ }).count(), 0, 'no Show <n> more anywhere');
  assert.equal(await badge(page), '9', 'badge 9');
  assert.equal(flat(await (await must(panelHeading(page), 'heading')).innerText()), '9 objects link here');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-19

test('fr_lnk_01_ac19_porada_and_read_only_chips_open_like_any_open', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  await mustPanel(page);
  await (await must(chip(page, '2026-10-08 Porada'), 'chip Porada')).click();
  await mustBeOn(page, '2026-10-08 Porada', 'the chip opens Porada', 5000);
  await sleep(300);
  const f = await focus(page);
  assert.notEqual(f.name, 'Poznámka', 'the focus is not moved to a property');
  assert.equal(await focusTarget(page), 'body', 'caret placed as any open (D-247)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back', 5000);
  await (await must(chip(page, 'Neplatná hlavička'), 'chip Neplatná hlavička')).click();
  await mustBeOn(page, 'Neplatná hlavička', 'opens Neplatná hlavička', 5000);
  await must(sourceRegion(page), 'source view (NFR-REL-03 AC-3)');
  assert.deepEqual(await writeCalls(core), [], 'activating writes nothing');
});

test('fr_lnk_01_ac19_chip_opens_the_source_without_at_and_back_restores', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  const panel = await mustPanel(page);
  await panel.evaluate((el) => { el.scrollTop = 80; });
  const scroll = await panel.evaluate((el) => el.scrollTop);
  const n0 = (await callsOf(core, 'nav_opened')).length;
  const c = await must(chip(page, 'Odkazy v textu'), 'chip Odkazy v textu');
  await c.focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Odkazy v textu', '⏎ on the chip opens the source', 5000);
  const opened = (await callsOf(core, 'nav_opened')).slice(n0).map((x) => x.args as any);
  assert.ok(opened.some((a) => a?.path === B.odkazy), `recorded with nav_opened (D-138): ${JSON.stringify(opened)}`);
  assert.ok(opened.every((a) => !String(a?.route ?? '').includes('at=')), `no at parameter: ${JSON.stringify(opened)}`);
  await sleep(300);
  assert.equal(await focusTarget(page), 'body', 'data-focus-target="body" (FR-EDT-01 AC-11)');
  assert.deepEqual(await caretBlock(page), { text: 'Viz Cíl a také jiný text ve stejném odstavci.', offset: 0 }, 'caret at the start of the first body block, not at a mention');
  assert.ok(await seen(backlinksPanel(page), 2000), 'the panel stays open on Backlinks');
  assert.equal(flat(await panelHeading(page).first().innerText()), 'No backlinks yet', "now Odkazy v textu's backlinks");
  assert.deepEqual(await writeCalls(core), [], 'activating writes nothing');
  await page.keyboard.type('X');
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved');
  const t = await eventually(() => fileText(core, B.odkazy), (x) => (x ?? '').includes('XViz'), 3000);
  assert.equal((t ?? '').replace(/^modified: .*$/m, ''), swap(linksVault().files[B.odkazy], '\nViz [[Cíl]]', '\nXViz [[Cíl]]').replace(/^modified: .*$/m, ''), 'X at the start of that block');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back', 5000);
  const p2 = await mustPanel(page);
  assert.equal(await eventually(() => p2.evaluate((el) => el.scrollTop), (s) => Math.abs(s - scroll) < 2), scroll, 'scroll position restored');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-20

test('fr_lnk_01_ac20_keyboard_moves_through_headers_and_chips_only', async ({ page }) => {
  await openLinks(page, B.cil, { panel: false });
  await runCommand(page, 'Show backlinks');
  await mustPanel(page);
  assert.deepEqual(await eventually(() => focus(page), (f) => f.role === 'link'), { role: 'link', name: 'Odkazy v textu', inPanel: true, inBody: false }, 'focus on the first chip');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focus(page)).name, 'Pages, 4', 'Shift+Tab: the group header');
  const seenNames: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const f = await focus(page);
    if (!f.inPanel) break;
    if (f.name !== 'Unlinked mentions') seenNames.push(f.name);
  }
  assert.deepEqual(seenNames.slice(0, 13), [
    'Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička', 'Quick Notes, 1', 'Rychlá poznámka', 'Daily Notes, 1', '2026-10-07',
    'Schůzky, 2', '2026-10-08 Porada', 'Starší porada', 'neznámý, 1', 'Bez typu s vlastností',
  ], 'headers and chips in visual order, no excerpt or Show more stop');
  const header = await must(groupHeader(page, 'Pages'), 'Pages header');
  await header.focus();
  await page.keyboard.press('Enter');
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'Enter collapses');
  assert.ok(await absent(chip(page, 'Odkazy v textu'), 1000), 'collapsed chips hidden');
  await page.keyboard.press('Tab');
  assert.equal((await focus(page)).name, 'Quick Notes, 1', "a collapsed group's chips leave the tab order");
  await header.focus();
  await page.keyboard.press('Space');
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'Space expands');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await absent(backlinksPanel(page), 1500), '⌘\\ closes the panel');
  assert.equal((await focus(page)).inBody, true, 'focus back in the note body');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-01 AC-21

test('fr_lnk_01_ac21_live_changes_add_and_move_chips_and_link_only_edits_change_nothing', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  await mustPanel(page);
  await eventually(() => chipNames(page), (x) => x.length === 9, 3000);
  const w0 = (await writeCalls(core)).length;
  await core.setFile(B.osamela, `${await fileText(core, B.osamela)}Viz [[Cíl]].\n`);
  assert.ok((await eventually(() => chipsIn(page, 'Pages'), (x) => x.includes('Osamělá'), 2000)).includes('Osamělá'), 'Osamělá appears as a chip in Pages within 2 s');
  assert.equal(await eventually(() => badge(page), (b) => b === '10', 2000), '10', 'badge 10');
  await core.setFile(B.bezTypu, swap(await fileText(core, B.bezTypu), 'type: neznámý', 'type: page'));
  assert.ok((await eventually(() => chipsIn(page, 'Pages'), (x) => x.includes('Bez typu s vlastností'), 2000)).includes('Bez typu s vlastností'), "Bez typu's chip moves to Pages");
  const before = { groups: await groups(page), chips: await chipNames(page) };
  await core.setFile(B.odkazy, `${await fileText(core, B.odkazy)}\nJeště jednou [[Cíl]].\n`);
  await core.setFile('.tegg/types/schůzka.yml', swap(await fileText(core, '.tegg/types/schůzka.yml'), 'name: Poznámka', 'name: Komentář'));
  await sleep(2000);
  assert.deepEqual({ groups: await groups(page), chips: await chipNames(page) }, before, 'another occurrence and a property rename leave the panel unchanged');
  assert.ok((await chipsIn(page, 'Schůzky')).includes('2026-10-08 Porada'), 'Porada stays listed');
  assert.deepEqual((await writeCalls(core)).slice(w0), [], 'nothing is written');
});

test('fr_lnk_01_ac21_osamela_keeps_the_empty_state', async ({ page }) => {
  await openLinks(page, B.osamela);
  await mustPanel(page);
  assert.equal(flat(await panelHeading(page).first().innerText()), 'No backlinks yet');
  assert.equal(await chipLinks(backlinksPanel(page)).count(), 0, 'no chips');
  // Red guard: the same vault's Cíl shows chips (so the empty state is not just a missing panel).
  await gotoNote(page, 'Cíl');
  assert.equal((await eventually(() => chipNames(page), (x) => x.length === 9, 3000)).length, 9, "Cíl's 9 chips");
});

// ------------------------------------------------------------------------------------------------ FR-LNK-02 AC-7

test('fr_lnk_02_ac7_property_and_embed_links_are_one_chip_each', async ({ page }) => {
  await openLinks(page, B.cil);
  for (const t of ['Starší porada', 'Bez typu s vlastností', 'Rychlá poznámka']) assert.equal(await eventually(() => chip(page, t).count(), (n) => n === 1), 1, `${t}: one chip`);
  assert.ok(!flat(await backlinksPanel(page).innerText()).includes('Embed'), 'no embed marker');
});

test('fr_lnk_02_ac7_janas_panel_is_chips_and_follows_a_cleared_relation', async ({ page }) => {
  await openLinks(page, B.jana);
  assert.equal(await eventually(() => badge(page), (b) => b === '3'), '3', 'badge 3');
  assert.deepEqual(await groups(page), ['Pages, 1', 'Schůzky, 2']);
  assert.deepEqual(await chipsIn(page, 'Pages'), ['Cíl']);
  assert.deepEqual(await chipsIn(page, 'Schůzky'), ['2026-10-08 Porada', 'Starší porada']);
  const text = flat(await backlinksPanel(page).innerText());
  assert.ok(!text.includes('Účastníci') && !text.includes('Odkaz ven'), 'no excerpt or Účastníci label');
  assert.equal(await backlinksPanel(page).locator('[data-occurrence]').count(), 0, 'no excerpt elements');
  await gotoNote(page, '2026-10-08 Porada');
  await (await must(props(page).getByRole('button', { name: 'Remove Jana Nováková', exact: true }), 'Remove Jana Nováková')).click();
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved');
  await gotoNote(page, 'Jana Nováková');
  assert.equal(await eventually(() => badge(page), (b) => b === '2', 1000), '2', 'badge 2 within 1 s');
  assert.deepEqual(await chipNames(page), ['Cíl', 'Starší porada'], 'only Cíl and Starší porada');
});
