// Slice OL, L5 (WebKit + fake core): the Outline by keyboard and its commands (docs/acceptance/outline.md R174, R175):
// FR-UX-03 AC-45 (the palette lists R175's commands on their routes, the fold commands act like the buttons, FR-UX-03
// AC-8's `data-command` and `aria-hidden` rules, `help/shortcuts` lists ⌘J under Navigation), AC-46 (the tree's keys),
// AC-47 (a keyboard-only tour with the focus indicators), FR-NAV-05 AC-4 (`Show outline`), AC-5 (the tab is remembered)
// and FR-EDT-11 AC-20 (a 500-heading note: the count, End and ⏎, a relabel within 250 ms). Interface
// docs/contracts/v1-outline.md §3.8, §6, §6.1; helpers outline-helpers.ts. Written from the ACs and the contract only
// (D-61). Every lookup goes through `must` and node:assert (TS-I1).
//
// Red-test points (reported, not decided): FR-UX-03 AC-46 says Tab from the tablist enters the tree, but the header's
// buttons come first in DOM order; the tests Tab until a treeitem has the focus (`tabIntoTree`). FR-EDT-11 AC-20 says End
// reaches `Kapitola 100`; with every row expanded End is on `Oddíl 100.4`, so the test takes End then ↑ ×4.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, TITLE, ZONE, another, caret, collapseAllBtn, countText, editorBody, emptyState, eventually, expandAllBtn, flat, goToQuery,
  graphTab, headingEl, headingTop, mainScroll, must, mustBeOn, noteRoute, outlineTab, outlineTree, paletteDialog, paletteOptions, pauseClock, placeCaret, rail,
  card, row, runCommand, runFor, scrollHeadingTo, searchField, setScroll, sleep, startOutline, tabIntoTree, tabRows, tokenColor, uiSets,
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
  assert.ok(has(o, 'Show outline'), `the palette lists Show outline on a note: ${o.join(' | ')}`);
  assert.ok(o.some((x) => x.startsWith('Outline: jump to heading…') && x.endsWith('⌘J')), 'Outline: jump to heading… with ⌘J');
  assert.ok(has(o, 'Toggle outline rail'), 'Toggle outline rail');
  assert.ok(!has(o, 'Outline: Expand all') && !has(o, 'Outline: Collapse all'), 'no fold commands while the Outline isn\'t on screen');
  // With the Outline on screen.
  await runCommand(page, 'Show outline');
  await must(outlineTree(page), 'the tab');
  const o2 = await options(page, 'outline');
  assert.ok(has(o2, 'Outline: Collapse all') && !has(o2, 'Outline: Expand all'), 'nothing collapsed: only Outline: Collapse all');
  await runCommand(page, 'Outline: Collapse all');
  assert.deepEqual((await eventually(() => tabRows(page), (r) => r.length === 3)).map((x) => x.label), ['Cíle', 'Program', 'Logistika'], 'Outline: Collapse all acts like the button');
  const o3 = await options(page, 'outline');
  assert.ok(has(o3, 'Outline: Expand all') && !has(o3, 'Outline: Collapse all'), 'all collapsed: only Outline: Expand all');
  await runCommand(page, 'Outline: Expand all');
  assert.equal((await eventually(() => tabRows(page), (r) => r.length === 11)).length, 11, 'Outline: Expand all acts like the button');
  // FR-UX-03 AC-8: commands on the controls; rows exempt; chevrons and the rail aria-hidden.
  assert.equal(await (await must(outlineTab(page), 'tab Outline')).getAttribute('data-command'), 'panel.outline', 'the tab carries panel.outline');
  assert.equal(await (await must(collapseAllBtn(page), 'Collapse all')).getAttribute('data-command'), 'outline.collapseAll', 'Collapse all carries its command');
  await (await must(row(page, 'Program'), 'row Program')).hover();
  await row(page, 'Program').locator('[data-outline-chevron]').click();
  assert.equal(await (await must(expandAllBtn(page), 'Expand all')).getAttribute('data-command'), 'outline.expandAll', 'Expand all carries its command');
  const chev = await outlineTree(page).locator('[data-outline-chevron]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-hidden')));
  assert.ok(chev.length > 0 && chev.every((x) => x === 'true'), 'chevrons are aria-hidden');
  await page.keyboard.press('Meta+Backslash');
  assert.equal(await (await must(rail(page), 'the rail')).getAttribute('aria-hidden'), 'true', 'the rail is aria-hidden');
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
  assert.ok(!has(os, 'Show outline') && !os.some((x) => x.startsWith('Outline: jump')), `search: neither Show outline nor Outline: jump to heading… (${os.join(' | ')})`);
  assert.ok(has(os, 'Toggle outline rail'), 'search: Toggle outline rail (every route with a vault)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-46

test('fr_ux_03_ac46_tree_keyboard', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch));
  await must(outlineTree(page), 'Architektura: tree');
  await eventually(() => tabRows(page), (r) => r.length === 18);
  await setScroll(page, 0);
  await placeCaret(await must(editorBody(page).locator('p').first(), 'the intro'), 6);
  const before = { c: await caret(page), s: (await mainScroll(page)).top };
  assert.ok((await tabIntoTree(page)) > 0, 'Tab from the tablist enters the tree');
  assert.deepEqual(await focused(page).then((f) => f?.label), 'Úložiště', 'at scrollTop 0 on the first row');
  assert.equal((await tabRows(page)).filter((x) => x.tabindex === '0').length, 1, 'exactly one treeitem has tabindex="0"');
  const at = async () => (await focused(page))?.label;
  const press = async (k: string) => { await page.keyboard.press(k); await sleep(60); };
  await press('ArrowDown');
  assert.equal(await at(), 'Rozvržení trezoru', '↓');
  await press('ArrowUp');
  assert.equal(await at(), 'Úložiště', '↑');
  await press('ArrowUp');
  assert.equal(await at(), 'Úložiště', '↑ stops at the first row');
  await press('End');
  assert.equal(await at(), 'Složky iCloudu', 'End: the last visible row');
  await press('ArrowDown');
  assert.equal(await at(), 'Složky iCloudu', '↓ stops at the end');
  await press('Home');
  assert.equal(await at(), 'Úložiště', 'Home: the first row');
  for (let i = 0; i < 8; i++) await press('ArrowDown');
  assert.equal(await at(), 'Hlavička', 'setup: on Hlavička');
  await press('ArrowRight');
  assert.equal(await at(), 'Povinné klíče', '→ on an expanded row goes to its first child');
  await press('ArrowLeft');
  assert.equal(await at(), 'Hlavička', '← goes back to the parent');
  await press('ArrowLeft');
  assert.equal((await tabRows(page)).find((x) => x.label === 'Hlavička')?.expanded, 'false', '← collapses it');
  await press('ArrowRight');
  assert.equal((await tabRows(page)).find((x) => x.label === 'Hlavička')?.expanded, 'true', '→ expands it');
  await press('Home');
  await press('Alt+ArrowLeft');
  assert.deepEqual((await tabRows(page)).map((x) => x.label), ['Úložiště', 'Synchronizace', 'Konflikty', 'Stejný řádek upraven', 'Složky iCloudu'], '⌥← on Úložiště collapses the branch');
  await press('Alt+ArrowRight');
  const all = await tabRows(page);
  assert.ok(all.length === 18 && all.every((x) => x.expanded !== 'false'), '⌥→ expands it (and its branch)');
  assert.equal((await mainScroll(page)).top, before.s, 'no key in the tree moved the note');
  // Esc: back to the body with its earlier selection and scroll.
  await press('Escape');
  const after = { c: await caret(page), s: (await mainScroll(page)).top };
  assert.deepEqual(after.c, before.c, 'Esc returns the focus to the Note body with its earlier selection');
  assert.ok(after.c?.focused, 'the Note body has the focus');
  assert.equal(after.s, before.s, 'and its scroll');
  // ⏎ on Indexování jumps.
  await tabIntoTree(page);
  await press('Home');
  for (let i = 0; i < 11; i++) await press('ArrowDown');
  assert.equal(await at(), 'Indexování', 'setup: on Indexování');
  await press('Enter');
  const c = await caret(page);
  assert.ok(c && c.focused && c.block === 'Indexování' && c.offset === c.len, `⏎ jumps: focus in the Note body, caret at the end of Indexování: ${JSON.stringify(c)}`);
  const top = await headingTop(page, 'Indexování');
  const ms = await mainScroll(page);
  assert.ok(near(top, 24, 2) || ms.top >= ms.height - ms.client - 1, `⏎ moves the note to the heading (${top})`);
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
  // 2. Show outline, move to Den 1, ⏎.
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.keyboard.type('Show outline');
  await sleep(250);
  await page.keyboard.press('Enter');
  await must(outlineTree(page), 'the tab');
  await eventually(() => focused(page), (f) => f?.role === 'treeitem');
  await indicator(page, 'Show outline');
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
  await indicator(page, '⌘J (the tab\'s current row, the Outline is on screen)');
  await page.keyboard.press('ArrowDown');
  await indicator(page, '↓');
  await page.keyboard.press('Escape');
  assert.ok((await caret(page))?.focused, 'Esc: back in the body');
  // 5. ⌘\ closes the panel, ⌘J and ⏎.
  await page.keyboard.press('Meta+Backslash');
  await sleep(300);
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  await indicator(page, '⌘J in the card');
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.equal(await card(page).count(), 0, '⏎ jumps and closes the card');
  assert.ok((await caret(page))?.focused, 'the body has the focus at the end');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-4

test('fr_nav_05_ac4_show_outline_opens_the_tab', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan), { panel: null });
  await sleep(400);
  const s0 = await uiSets(core);
  await runCommand(page, 'Show outline');
  await must(outlineTree(page), 'the Context panel on the Outline tab');
  assert.equal(await (await must(outlineTab(page), 'tab Outline')).getAttribute('aria-selected'), 'true', 'the Outline tab is selected');
  assert.deepEqual(await eventually(() => focused(page), (f) => f?.role === 'treeitem').then((f) => [f?.label, f?.inTab]), ['Cíle', true], 'at scrollTop 0 the focus is on the first row');
  await sleep(300);
  assert.equal(await uiSets(core), s0 + 1, 'one ui_state_set');
  const st = (await core.uiState()) as any;
  assert.deepEqual([st?.rightPanel?.open, st?.rightPanel?.tab], [true, 'outline'], 'rightPanel.open: true, tab: outline');
  // With a current row.
  const { p } = await another(page, noteRoute(P.plan), { panel: null });
  await scrollHeadingTo(p, 'Den 1', 4);
  await runCommand(p, 'Show outline');
  assert.equal((await eventually(() => focused(p), (f) => f?.role === 'treeitem'))?.label, 'Den 1', 'the focus on the current row');
  // From Graph.
  const { p: g } = await another(page, noteRoute(P.plan), { panel: 'graph' });
  await must(graphTab(g), 'tab Graph');
  await runCommand(g, 'Show outline');
  assert.equal(await (await must(outlineTab(g), 'tab Outline')).getAttribute('aria-selected'), 'true', 'with the panel on Graph it switches to Outline');
  // Bez nadpisů: the empty state's text.
  const { p: b } = await another(page, noteRoute(P.bez), { panel: null });
  await runCommand(b, 'Show outline');
  await must(emptyState(b), 'the empty state');
  const f = await eventually(() => b.evaluate(() => (document.activeElement?.textContent ?? '').trim()), (t) => t === 'No headings yet');
  assert.equal(f, 'No headings yet', 'the focus goes to the empty state\'s text');
  // Listed on note, daily and new routes only (the L1 test covers every route).
  for (const [route, on] of [['daily/2026-11-12', true], ['new/page', true], ['tasks', false], [`graph/${P.plan}`, false]] as const) {
    const { p: r } = await another(page, route, { panel: null, wait: false });
    await sleep(500);
    assert.equal(has(await options(r, 'Show outline'), 'Show outline'), on, `${route}: Show outline ${on ? 'listed' : 'not listed'}`);
    await r.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-5

test('fr_nav_05_ac5_outline_tab_remembered', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan));
  await must(outlineTree(page), 'Plán: the Outline tab');
  const sel = async () => (await outlineTab(page).getAttribute('aria-selected').catch(() => null)) === 'true' && (await outlineTree(page).count()) > 0;
  await goToQuery(page, TITLE[P.arch]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.arch], 'another note');
  assert.ok(await eventually(sel, (x) => x), 'opening another note keeps the Outline tab');
  await page.keyboard.press('Meta+Backslash');
  await sleep(200);
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await eventually(sel, (x) => x), '⌘\\ twice keeps the Outline tab');
  await page.keyboard.press('Meta+Shift+Backslash');
  await sleep(200);
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await eventually(sel, (x) => x), 'focus mode on and off keeps the Outline tab');
  assert.equal(((await core.uiState()) as any)?.rightPanel?.tab, 'outline', 'the stored tab is outline');
  assert.deepEqual(await core.writesTo(), [], 'the vault\'s files are untouched');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-20

test('fr_edt_11_ac20_five_hundred_headings', async ({ page }) => {
  await startOutline(page, noteRoute(P.petSet));
  await must(outlineTree(page), 'Pět set nadpisů: tree');
  assert.equal(await eventually(() => countText(page), (t) => t === '500 headings', 5000), '500 headings', 'the tab shows `500 headings`');
  await tabIntoTree(page);
  await page.keyboard.press('End');
  await sleep(100);
  const end = (await focused(page))?.label;
  if (end !== 'Kapitola 100') {
    assert.equal(end, 'Oddíl 100.4', 'End reaches the last visible row');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
  }
  assert.equal((await focused(page))?.label, 'Kapitola 100', 'Kapitola 100\'s row');
  await page.keyboard.press('Enter');
  const top = await eventually(() => headingTop(page, 'Kapitola 100'), (t) => near(t, 24, 2));
  assert.ok(near(top, 24, 2), `⏎ jumps there (${top})`);
  const h = await must(headingEl(page, 'Oddíl 050.2'), 'heading Oddíl 050.2');
  await placeCaret(h, 'end');
  await pauseClock(page);
  await page.keyboard.type('x');
  await runFor(page, 250);
  assert.ok(await row(page, 'Oddíl 050.2x').count(), 'typing a character in Oddíl 050.2 relabels its row within 250 ms');
  await page.clock.resume();
});

