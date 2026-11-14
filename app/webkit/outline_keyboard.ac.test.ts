// Slice OL, L5 (WebKit + fake core): the Outline by keyboard and its commands (docs/acceptance/outline.md R174, R175;
// D-1675: no Outline tab, no `Show outline`, no fold commands): FR-UX-03 AC-45 (the palette lists R175's commands on their
// routes, FR-UX-03 AC-8's `aria-hidden` rules, `help/shortcuts` lists ⌘J under Navigation), AC-47 (a keyboard-only tour
// with the focus indicators) and FR-EDT-11 AC-20 (a 500-heading note: the count, End and ⏎ in the card, a relabel within
// 250 ms). Interface docs/contracts/v1-outline.md §3.8, §6, §6.1; helpers outline-helpers.ts. Written from the ACs and
// the contract only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, TITLE, ZONE, another, caret, card, cardTree, eventually, flat, headingEl, headingTop, must, mustBeOn, noteRoute, openCardByHover, outlineRows, paletteDialog,
  paletteOptions, pauseClock, placeCaret, rail, runFor, searchField, sleep, startOutline, tokenColor,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

const near = (a: number | null | undefined, b: number, tol: number) => typeof a === 'number' && Math.abs(a - b) <= tol;
const focused = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return null;
  return { role: a.getAttribute('role'), label: (a.getAttribute('aria-label') ?? '').normalize('NFC'), inCard: !!a.closest('[data-outline-card]'), inTab: !!a.closest('[role="tabpanel"]'), tag: a.tagName.toLowerCase() };
});
/** Option texts of the palette for `query` (then Esc). */
async function options(page: Page, query: string): Promise<string[]> {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await sleep(250);
  const o = (await paletteOptions(page)).map((t) => flat(t));
  await page.keyboard.press('Escape');
  return o;
}
const has = (opts: string[], title: string) => opts.some((o) => o === title || o.startsWith(`${title} `));

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-45

test('fr_ux_03_ac45_outline_commands_and_shortcut', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  const o = await options(page, 'outline');
  assert.ok(o.some((x) => x.startsWith('Outline: jump to heading…') && x.endsWith('⌘J')), `Outline: jump to heading… with ⌘J: ${o.join(' | ')}`);
  assert.ok(has(o, 'Toggle outline rail'), 'Toggle outline rail');
  // D-1675: no `Show outline` and no fold commands.
  assert.ok(!has(o, 'Show outline'), 'no Show outline');
  assert.ok(!has(o, 'Outline: Expand all') && !has(o, 'Outline: Collapse all'), 'no fold commands');
  const o2 = await options(page, 'show outline');
  assert.ok(!has(o2, 'Show outline'), `searching "show outline" lists no Show outline: ${o2.join(' | ')}`);
  // FR-UX-03 AC-8: the rail and the card's chevrons are aria-hidden (rows are exempt).
  assert.equal(await (await must(rail(page), 'the rail')).getAttribute('aria-hidden'), 'true', 'the rail is aria-hidden');
  const { p: c } = await another(page, noteRoute(P.cten), { panel: null });
  await openCardByHover(c);
  const chev = await cardTree(c).locator('[data-outline-chevron]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-hidden')));
  assert.ok(chev.length > 0 && chev.every((x) => x === 'true'), 'the card\'s chevrons are aria-hidden');
  // help/shortcuts: ⌘J under Navigation.
  const { p } = await another(page, 'help/shortcuts', { wait: false });
  await mustBeOn(p, 'Keyboard shortcuts', 'help/shortcuts');
  const where = await p.getByRole('main').evaluate((m) => {
    const all = [...m.querySelectorAll('h2, h3, [role="heading"], tr, li, [role="row"], dt, div')] as HTMLElement[];
    let group = '';
    for (const e of all) {
      if (/^H[23]$/.test(e.tagName) || e.getAttribute('role') === 'heading') { group = (e.innerText ?? '').trim(); continue; }
      const t = (e.innerText ?? '').replace(/\s+/g, ' ').trim();
      if (t.includes('⌘J') && t.includes('Outline: jump to heading…') && t.length < 80) return group;
    }
    return null;
  });
  assert.equal(where, 'Navigation', 'help/shortcuts lists ⌘J `Outline: jump to heading…` under Navigation');
  // Not on other routes.
  const { p: s } = await another(page, 'search', { wait: false });
  await sleep(400);
  const os = await options(s, 'outline');
  assert.ok(!os.some((x) => x.startsWith('Outline: jump')), `search: no Outline: jump to heading… (${os.join(' | ')})`);
  assert.ok(has(os, 'Toggle outline rail'), 'search: Toggle outline rail (every route with a vault)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-47

/** The focus indicator of app-shell FR-UX-03 AC-13 (b): rows `--hover`, buttons a 2 px focus outline. */
async function indicator(page: Page, what: string) {
  const f = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return null;
    const s = getComputedStyle(a);
    return { role: a.getAttribute('role') ?? a.tagName.toLowerCase(), bg: s.backgroundColor, outline: `${s.outlineStyle} ${s.outlineWidth}` };
  });
  assert.ok(f, `${what}: something has the focus`);
  if (f!.role === 'treeitem') assert.equal(f!.bg, await tokenColor(page, '--hover'), `${what}: the focused row is --hover`);
  if (f!.role === 'button') assert.ok(/solid 2px/.test(f!.outline), `${what}: the focused button has a 2 px outline (${f!.outline})`);
}

test('fr_ux_03_ac47_outline_keyboard_only', async ({ page }) => {
  await startOutline(page, 'search', { panel: null, wait: false });
  // 1. Open Plán from Search.
  const q = await must(searchField(page), 'the Search page\'s field');
  await q.focus();
  await page.keyboard.type('Plán offsitu');
  await sleep(400);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.plan], 'Plán opened from Search with ⏎');
  // 2. ⌘J, move to Den 1, ⏎ (D-1675: the card instead of `Show outline` and the tab).
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  await eventually(() => focused(page), (f) => f?.role === 'treeitem' && f.inCard);
  await indicator(page, '⌘J');
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await indicator(page, `↓ ${i + 1}`); }
  assert.equal((await focused(page))?.label, 'Den 1', 'on Den 1');
  await page.keyboard.press('Enter');
  await eventually(() => headingTop(page, 'Den 1'), (t) => near(t, 24, 2));
  const c = await caret(page);
  assert.ok(c?.focused && c.block === 'Den 1', '⏎ jumped to Den 1 with the focus in the body');
  // 3. Type A and undo it.
  await page.keyboard.type('A');
  await page.keyboard.press('Meta+z');
  await sleep(200);
  assert.ok(await headingEl(page, 'Den 1').count(), 'A undone');
  // 4. ⌘[ back, ⌘J, ↓, Esc.
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(200);
  await page.keyboard.press('Meta+j');
  await sleep(200);
  await must(card(page), '⌘J opens the card again');
  await indicator(page, '⌘J (the card\'s row)');
  await page.keyboard.press('ArrowDown');
  await indicator(page, '↓');
  await page.keyboard.press('Escape');
  assert.ok((await caret(page))?.focused, 'Esc: back in the body');
  // 5. ⌘J and ⏎.
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  await indicator(page, '⌘J in the card');
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.equal(await card(page).count(), 0, '⏎ jumps and closes the card');
  assert.ok((await caret(page))?.focused, 'the body has the focus at the end');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-20

test('fr_edt_11_ac20_five_hundred_headings', async ({ page }) => {
  await startOutline(page, noteRoute(P.petSet));
  assert.equal((await eventually(() => outlineRows(page), (r) => r.length === 500, 5000)).length, 500, 'the outline lists 500 headings');
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  await eventually(() => focused(page), (f) => f?.role === 'treeitem' && f.inCard);
  await page.keyboard.press('End');
  await sleep(100);
  assert.equal((await focused(page))?.label, 'Kapitola 100', 'End reaches the card\'s last row, Kapitola 100');
  await page.keyboard.press('Enter');
  const top = await eventually(() => headingTop(page, 'Kapitola 100'), (t) => near(t, 24, 2));
  assert.ok(near(top, 24, 2), `⏎ jumps there (${top})`);
  const h = await must(headingEl(page, 'Oddíl 050.2'), 'heading Oddíl 050.2');
  await placeCaret(h, 'end');
  await pauseClock(page);
  await page.keyboard.type('x');
  await runFor(page, 250);
  assert.ok((await outlineRows(page)).some((x) => x.label === 'Oddíl 050.2x'), 'typing a character in Oddíl 050.2 relabels its heading within 250 ms');
  await page.clock.resume();
});
