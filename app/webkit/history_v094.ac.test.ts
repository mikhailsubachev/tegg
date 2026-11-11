// v0.94 feedback (D-1168), L5 (WebKit + fake core): a horizontal scroll never navigates. docs/acceptance/app-shell.md
// FR-NAV-03 AC-8 (a synthesized horizontal scroll over every surface leaves the route and the history unchanged), AC-9
// (it still scrolls what is under the pointer: the wide Kanban board), AC-10 (buttons, keys, the palette, DOM mouse
// buttons and the shell's native `nav:mouse` event still navigate; one step for a page `mouseup` and a native event of
// the same press). "A synthesized horizontal scroll" is 12 `wheel` events of deltaX −40 (then +40), deltaY 0, 10 ms
// apart, plus one of ±400, sent with Playwright's `mouse.wheel` at a point of the element. Interface
// docs/contracts/ms3-shell.md §3.7 (names), §12.2 (history; its "Trackpad" line goes with D-1168). Written from the ACs
// and the contracts only (D-61); every lookup goes through `must` and node:assert (TS-I1). The shell crate's mapping
// (AC-10's L4 part) has no public interface for a `tests/ac_*.rs` test: see the red-test report.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { gotoKanban, main as tMain, startTasks } from './tasks-helpers';
import { P, eventually, mainName, must, mustBeOn, openNote, paletteDialog, runCommand, sidebar, sleep, start, typesList, type FakeCoreHandle } from './helpers';

const PORADA = '2026-10-07 Porada';
const backBtn = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const fwdBtn = (page: Page) => page.getByRole('button', { name: 'Forward', exact: true });
async function buttons(page: Page) {
  const off = async (b: Locator) => (await b.getAttribute('aria-disabled')) === 'true';
  return { backDisabled: await off(await must(backBtn(page), 'Back')), forwardDisabled: await off(await must(fwdBtn(page), 'Forward')) };
}
const navs = async (core: FakeCoreHandle) => (await core.calls()).filter((c) => c.cmd === 'nav_opened').length;
/** `route-ready:<route>` marks so far (ms3-shell §6): every route shown, notes or not, sends one. */
const routeMarks = async (core: FakeCoreHandle) => (await core.calls()).filter((c) => c.cmd === 'perf_mark' && String((c.args as any)?.mark ?? (c.args as any)?.name ?? '').startsWith('route-ready:')).length;

/** The AC's synthesized horizontal scroll at a point of `loc`. */
async function hscroll(page: Page, loc: Locator) {
  const b = await loc.boundingBox();
  assert.ok(b, 'the element has a box');
  await page.mouse.move(b!.x + Math.min(120, b!.width / 2), b!.y + Math.min(40, b!.height / 2));
  for (const dx of [-40, 40]) {
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(dx, 0); await sleep(10); }
    await sleep(300);
  }
  await page.mouse.wheel(-400, 0); await sleep(300);
  await page.mouse.wheel(400, 0); await sleep(300);
}

type Surface = { name: string; readView?: boolean; viaSearch?: boolean; reach: (page: Page) => Promise<string>; at: (page: Page) => Locator; focus?: 'editor' | 'none'; again?: (page: Page) => Promise<void> };
const viaTypes = async (page: Page) => {
  await (await must(typesList(page).getByRole('link', { name: /^Schůzky\b/ }), 'sidebar Types entry "Schůzky"')).click();
  await mustBeOn(page, 'Schůzky', 'type/schůzka');
  return 'Schůzky';
};
/** Types `Porada` in the Search page's field (same route, no history entry) and waits for the results. */
async function searchPorada(p: Page) {
  await (await must(p.getByRole('searchbox', { name: 'Search query' }).or(p.getByRole('textbox', { name: 'Search query' })).first(), 'Search query')).fill('Porada');
  await must(p.getByRole('list', { name: 'Search results' }), 'Search results', 5000);
}
const SURFACES: Surface[] = [
  { name: 'porada_editor_text', viaSearch: true, reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('textbox', { name: 'Note body' }) },
  { name: 'porada_editor_text_focused', viaSearch: true, reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('textbox', { name: 'Note body' }), focus: 'editor' },
  { name: 'porada_editor_text_nothing_focused', viaSearch: true, reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('textbox', { name: 'Note body' }), focus: 'none' },
  { name: 'porada_read_view', readView: true, viaSearch: true, reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('main').getByRole('article').first() },
  { name: 'type_schuzka_table', reach: viaTypes, at: (p) => p.getByRole('main').getByRole('table').first() },
  { name: 'search_results', reach: async (p) => { await p.keyboard.press('Meta+Shift+f'); await mustBeOn(p, 'Search', 'search'); await searchPorada(p); return 'Search'; }, again: searchPorada, at: (p) => p.getByRole('list', { name: 'Search results' }) },
  { name: 'tasks', reach: async (p) => { await runCommand(p, 'Go to Tasks'); await mustBeOn(p, 'Tasks', 'tasks'); return 'Tasks'; }, at: (p) => p.getByRole('main') },
  { name: 'settings_previews', reach: async (p) => { await runCommand(p, 'Go to Settings: Previews'); await must(p.getByRole('main').getByRole('heading', { name: 'Previews', exact: true }), 'Settings: Previews', 5000); return (await mainName(p)) ?? ''; }, at: (p) => p.getByRole('main') },
  { name: 'sidebar', reach: viaTypes, at: (p) => sidebar(p) },
  { name: 'title_bar', reach: viaTypes, at: (p) => p.getByRole('banner').or(backBtn(p).locator('xpath=..')).first() },
];

for (const s of SURFACES) {
  test(`fr_nav_03_ac8_a_horizontal_scroll_never_navigates_${s.name}`, async ({ page }) => {
    if (s.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
    // D-1511: AC-8 holds while the macOS setting is off (`nav_swipe_scroll` answers `false` from the start).
    const core = await start(page, { swipeScroll: false });
    await core.swipeScroll(false);
    await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
    // The surface S, then another route, then one Back: S has a Back entry (Inbox) and a Forward entry.
    const name = await s.reach(page);
    const other = name === 'Search' ? 'Inbox' : 'Search';
    if (other === 'Search') { await page.keyboard.press('Meta+Shift+f'); await mustBeOn(page, 'Search', 'search'); }
    else { await runCommand(page, 'Go to Inbox'); await mustBeOn(page, 'Inbox', 'Inbox'); }
    const rBack = await routeMarks(core);
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, name, `Back to ${name}`);
    // D-1238: the Back's own route-ready mark can land after the heading shows; count from after it.
    await eventually(() => routeMarks(core), (n) => n > rBack, 2000);
    if (s.again) await s.again(page);
    const at = await must(s.at(page), `${s.name}: the element under the pointer`, 5000);
    if (s.focus === 'editor') await at.click();
    if (s.focus === 'none') await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const b0 = await buttons(page);
    assert.deepEqual(b0, { backDisabled: false, forwardDisabled: false }, `${s.name}: setup, both Back and Forward have an entry`);
    const n0 = await navs(core);
    const r0 = await routeMarks(core);
    await hscroll(page, at);
    assert.equal(await mainName(page), name, `${s.name}: the route stays (D-1168)`);
    assert.deepEqual(await buttons(page), b0, `${s.name}: the title-bar buttons' states are unchanged`);
    assert.equal(await navs(core), n0, `${s.name}: nav_opened zero times`);
    assert.equal(await routeMarks(core), r0, `${s.name}: no route was shown in between (no Back and Forward round trip)`);
    // The history still leads to the same entries.
    await page.keyboard.press('Meta+BracketRight');
    await mustBeOn(page, other, `${s.name}: Forward still leads to ${other}`);
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, name, `${s.name}: Back leads to ${name}`);
    if (s.viaSearch) {
      await page.keyboard.press('Meta+BracketLeft');
      await mustBeOn(page, 'Search', `${s.name}: Back over the Search entry the note was opened from (D-1348)`);
    }
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Inbox', `${s.name}: and Back again to Inbox`);
  });
}

// ------------------------------------------------------------------------------------------------ AC-9

test.describe(() => {
  test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1440, height: 900 } });
  test('fr_nav_03_ac9_it_still_scrolls_what_is_under_the_pointer', async ({ page }) => {
    const core = await startTasks(page);
    await gotoKanban(page, 'Status');
    const name = await mainName(page);
    assert.notEqual((await backBtn(page).getAttribute('aria-disabled')), 'true', 'setup: Back has an entry (one navigation)');
    const board = await must(tMain(page).locator('[data-column]').first().locator('xpath=..'), 'the board (parent of the Kanban columns)');
    const m = () => board.evaluate((e) => ({ left: (e as HTMLElement).scrollLeft, max: (e as HTMLElement).scrollWidth - (e as HTMLElement).clientWidth }));
    const m0 = await m();
    assert.ok(m0.max > 0, `the board is wider than the pane (${JSON.stringify(m0)})`);
    const b = (await board.boundingBox())!;
    await page.mouse.move(b.x + 200, b.y + 120);
    const n0 = await navs(core);
    const r0 = await routeMarks(core);
    await page.mouse.wheel(240, 0);
    await sleep(300);
    const m1 = await m();
    assert.ok(Math.abs(m1.left - Math.min(m0.left + 240, m0.max)) <= 1, `a (240, 0) wheel increases scrollLeft by 240 ± 1, or to its end (${m0.left} → ${m1.left})`);
    assert.equal(await mainName(page), name, 'the route stays');
    await board.evaluate((e) => { (e as HTMLElement).scrollLeft = 0; });
    await sleep(100);
    await page.mouse.wheel(-400, 0);
    await sleep(500);
    assert.equal((await m()).left, 0, 'at the left edge a (−400, 0) wheel leaves scrollLeft at 0');
    assert.equal(await mainName(page), name, 'and doesn\'t go Back');
    assert.equal(await navs(core), n0, 'no nav_opened');
    assert.equal(await routeMarks(core), r0, 'no route was shown in between');
  });
});

// ------------------------------------------------------------------------------------------------ AC-10

async function visitThree(page: Page) {
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  await openNote(page, PORADA);
  await viaTypes(page);
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'search');
}
const mouseUp = (page: Page, button: 3 | 4) => page.evaluate((b) => { document.body.dispatchEvent(new MouseEvent('mouseup', { button: b, bubbles: true, cancelable: true })); }, button);

test('fr_nav_03_ac10_buttons_keys_and_native_swipes_still_navigate', async ({ page }) => {
  const core = await start(page);
  await visitThree(page);
  await (await must(backBtn(page), 'Back')).click({ force: true });
  await mustBeOn(page, 'Schůzky', 'the title-bar Back button');
  await (await must(fwdBtn(page), 'Forward')).click({ force: true });
  await mustBeOn(page, 'Search', 'the title-bar Forward button');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Schůzky', '⌘[');
  await page.keyboard.press('Meta+BracketRight'); await mustBeOn(page, 'Search', '⌘]');
  await runCommand(page, 'Go back'); await mustBeOn(page, 'Schůzky', 'the palette `Go back`');
  await runCommand(page, 'Go forward'); await mustBeOn(page, 'Search', 'the palette `Go forward`');
  // Separate presses are more than 300 ms apart (a page mouseup and a native event within 300 ms are one press).
  await mouseUp(page, 3); await mustBeOn(page, 'Schůzky', 'DOM mouseup button 3'); await sleep(400);
  await mouseUp(page, 4); await mustBeOn(page, 'Search', 'DOM mouseup button 4'); await sleep(400);
  await core.emit('nav:mouse' as any, 'back'); await mustBeOn(page, 'Schůzky', 'the native nav:mouse `back`'); await sleep(400);
  await core.emit('nav:mouse' as any, 'forward'); await mustBeOn(page, 'Search', 'the native nav:mouse `forward`'); await sleep(400);
  // Ignored while the palette is open (AC-6).
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'the palette');
  await core.emit('nav:mouse' as any, 'back');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await mainName(page), 'Search', 'a native `back` is ignored while the palette is open');
  // A page mouseup and a native event for the same press within 300 ms go one step only.
  await mouseUp(page, 3);
  await core.emit('nav:mouse' as any, 'back');
  await sleep(600);
  assert.equal(await mainName(page), 'Schůzky', 'the page mouseup and the native event of one press go one step only');
  await sleep(400);
  await core.emit('nav:mouse' as any, 'back');
  await mustBeOn(page, PORADA, 'a later native `back` is a new step');
});

void P;
