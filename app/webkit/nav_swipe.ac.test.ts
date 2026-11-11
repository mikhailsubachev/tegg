// v0.123 feedback (D-1511), L5 (WebKit + fake core): the two-finger swipe between pages is back, following the macOS
// setting. docs/acceptance/app-shell.md FR-NAV-03 AC-11 (a swipe goes Back and Forward, one step per gesture, nothing
// without an entry), AC-12 (things that scroll or pan sideways win, at their edges too; a table that fits navigates),
// AC-13 (only deliberate horizontal swipes: mostly vertical starts, less than 120 px, net travel, dialogs), AC-14 (the
// setting decides: `nav_swipe_scroll`, asked at start and when the window gets the focus). "A swipe right" is 12 `wheel`
// events of deltaX −40, deltaY 0, 10 ms apart, plus one of −400 without a pause (fingers move right: Back); "a swipe
// left" the same with +40 / +400 (Forward); a gesture ends 200 ms after its last `wheel` event. Sent with Playwright's
// `mouse.wheel` at a point of the named element. The setting is on by the fake core's default; `swipeScroll(on)`
// changes the answer of `nav_swipe_scroll`. Interface: docs/contracts/ms3-shell.md §12.2 (as D-1511 changes it), §3.7
// (names). Written from the ACs and the contracts only (D-61); every lookup goes through `must` and node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { gotoKanban, main as tMain, startTasks } from './tasks-helpers';
import { gotoTypePage, openTypes, swap, typeFile, typeTable, typesVault } from './types-helpers';
import { P as G, canvas, graphHeading, positions, startGraph, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, openPanel, pCanvas } from './graph-panel-helpers';
import {
  eventually, mainName, must, mustBeOn, newObjectDialog, nonReadCalls, openNote, paletteDialog, runCommand, shellVault, sidebar, sleep, start, typesList,
  type FakeCoreHandle,
} from './helpers';

const PORADA = '2026-10-07 Porada';
const backBtn = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const fwdBtn = (page: Page) => page.getByRole('button', { name: 'Forward', exact: true });
const titleBar = (page: Page) => page.getByRole('banner').or(backBtn(page).locator('xpath=..')).first();
async function buttons(page: Page) {
  const off = async (b: Locator) => (await b.getAttribute('aria-disabled')) === 'true';
  return { backDisabled: await off(await must(backBtn(page), 'Back')), forwardDisabled: await off(await must(fwdBtn(page), 'Forward')) };
}
const count = async (core: FakeCoreHandle, cmd: string) => (await core.calls()).filter((c) => c.cmd === cmd).length;
const navs = (core: FakeCoreHandle) => count(core, 'nav_opened');
/** `route-ready:<route>` marks so far (ms3-shell §6): every route shown, notes or not, sends one. */
const routeMarks = async (core: FakeCoreHandle) => (await core.calls()).filter((c) => c.cmd === 'perf_mark' && String((c.args as any)?.mark ?? (c.args as any)?.name ?? '').startsWith('route-ready:')).length;

/** One gesture: `wheel` events 10 ms apart, nothing after the last one. */
async function gesture(page: Page, events: (readonly [number, number])[]) {
  for (let i = 0; i < events.length; i++) {
    if (i) await sleep(10);
    await page.mouse.wheel(events[i][0], events[i][1]);
  }
}
const times = (n: number, dx: number, dy = 0) => Array.from({ length: n }, () => [dx, dy] as const);
/** The AC's swipe: 12 events of ∓40 and one of ∓400, without a pause (one gesture). `right` = fingers move right. */
const swipe = (page: Page, dir: 'right' | 'left') => gesture(page, [...times(12, dir === 'right' ? -40 : 40), [dir === 'right' ? -400 : 400, 0]]);
/** Puts the pointer on a point of `loc` (as AC-8's scroll: 120 px, 40 px into it, or its middle). */
async function pointAt(page: Page, loc: Locator, what: string) {
  const b = await (await must(loc, what, 5000)).boundingBox();
  assert.ok(b, `${what} has a box`);
  await page.mouse.move(b!.x + Math.min(120, b!.width / 2), b!.y + Math.min(40, b!.height / 2));
}

type Seen = { name: string | null; navs: number; marks: number };
const see = async (page: Page, core: FakeCoreHandle): Promise<Seen> => ({ name: await mainName(page), navs: await navs(core), marks: await routeMarks(core) });
/** Waits until the route, `nav_opened` and the route marks stay the same for 400 ms (at most `ms`). */
async function quiet(page: Page, core: FakeCoreHandle, ms = 4000): Promise<Seen> {
  let last = await see(page, core);
  let since = Date.now();
  const end = Date.now() + ms;
  while (Date.now() < end && Date.now() - since < 400) {
    await sleep(100);
    const now = await see(page, core);
    if (JSON.stringify(now) !== JSON.stringify(last)) { last = now; since = Date.now(); }
  }
  return last;
}
type Step = { from: string | null; to: string | null; navs: number; marks: number; buttons: { backDisabled: boolean; forwardDisabled: boolean } };
/** Runs `act` and reports where it led: waits up to 2 s for another route, then until everything is quiet. */
async function step(page: Page, core: FakeCoreHandle, act: () => Promise<void>): Promise<Step> {
  const a = await quiet(page, core);
  await act();
  await eventually(() => mainName(page), (n) => n !== a.name, 2000);
  const b = await quiet(page, core);
  return { from: a.name, to: b.name, navs: b.navs - a.navs, marks: b.marks - a.marks, buttons: await buttons(page) };
}
/** A swipe that must not navigate: the route, `nav_opened` and the route marks as before, 600 ms after it. */
async function staysPut(page: Page, core: FakeCoreHandle, act: () => Promise<void>, what: string) {
  const a = await quiet(page, core);
  const b0 = await buttons(page);
  await act();
  await sleep(600);
  const b = await quiet(page, core);
  assert.deepEqual(b, a, `${what}: the route stays, nav_opened zero times, no route shown in between`);
  assert.deepEqual(await buttons(page), b0, `${what}: the title-bar buttons' states are unchanged`);
}
/** A swipe right over the title bar that must go Back to `to` (the positive control of the "never navigates" tests). */
async function titleBarSwipeGoesBack(page: Page, core: FakeCoreHandle, to: string | null, what: string) {
  await pointAt(page, titleBar(page), 'the title bar');
  await sleep(300);
  const s = await step(page, core, () => swipe(page, 'right'));
  assert.equal(s.to, to, `${what}: a swipe right over the title bar goes Back to "${to}" (D-1511)`);
  assert.equal(s.marks, 1, `${what}: one step`);
}
/** Where ⌘[ leads from here; comes back with ⌘]. */
async function backTarget(page: Page, core: FakeCoreHandle): Promise<string | null> {
  const here = await mainName(page);
  const s = await step(page, core, () => page.keyboard.press('Meta+BracketLeft'));
  assert.notEqual(s.to, here, 'setup: Back has an entry');
  const f = await step(page, core, () => page.keyboard.press('Meta+BracketRight'));
  assert.equal(f.to, here, 'setup: Forward comes back');
  return s.to;
}

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
const toTasks = async (p: Page) => { await runCommand(p, 'Go to Tasks'); await mustBeOn(p, 'Tasks', 'tasks'); return 'Tasks'; };

// ------------------------------------------------------------------------------------------------ AC-11

type Surface = { name: string; readView?: boolean; reach: (page: Page) => Promise<string>; at: (page: Page) => Locator; again?: (page: Page) => Promise<void> };
const SURFACES: Surface[] = [
  { name: 'porada_editor_text', reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('textbox', { name: 'Note body' }) },
  { name: 'porada_read_view', readView: true, reach: async (p) => { await openNote(p, PORADA); return PORADA; }, at: (p) => p.getByRole('main').getByRole('article').first() },
  { name: 'search_results', reach: async (p) => { await p.keyboard.press('Meta+Shift+f'); await mustBeOn(p, 'Search', 'search'); await searchPorada(p); return 'Search'; }, again: searchPorada, at: (p) => p.getByRole('list', { name: 'Search results' }) },
  { name: 'tasks_schedule', reach: toTasks, at: (p) => p.getByRole('main') },
  { name: 'settings_previews', reach: async (p) => { await runCommand(p, 'Go to Settings: Previews'); await must(p.getByRole('main').getByRole('heading', { name: 'Previews', exact: true }), 'Settings: Previews', 5000); return (await mainName(p)) ?? ''; }, at: (p) => p.getByRole('main') },
  { name: 'sidebar', reach: toTasks, at: (p) => sidebar(p) },
  { name: 'title_bar', reach: toTasks, at: (p) => titleBar(p) },
];

for (const s of SURFACES) {
  test(`fr_nav_03_ac11_a_two_finger_swipe_goes_back_and_forward_${s.name}`, async ({ page }) => {
    if (s.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
    const core = await start(page);
    await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
    // Inbox → Schůzky → (Search →) the surface S → another route, then one Back: S has two or more Back entries (a
    // second step would show) and one Forward entry.
    await viaTypes(page);
    const name = await s.reach(page);
    if (name === 'Search') { await runCommand(page, 'Go to Inbox'); await mustBeOn(page, 'Inbox', 'Inbox'); }
    else { await page.keyboard.press('Meta+Shift+f'); await mustBeOn(page, 'Search', 'search'); }
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, name, `Back to ${name}`);
    // What Back and Forward by the title-bar buttons do from S (AC-1): the swipe must do the same.
    const byBack = await step(page, core, async () => { await (await must(backBtn(page), 'Back')).click({ force: true }); });
    assert.notEqual(byBack.to, name, `${s.name}: setup, the Back button leaves ${name}`);
    assert.deepEqual(byBack.buttons, { backDisabled: false, forwardDisabled: false }, `${s.name}: setup, a Back entry is left after one step`);
    const byFwd = await step(page, core, async () => { await (await must(fwdBtn(page), 'Forward')).click({ force: true }); });
    assert.equal(byFwd.to, name, `${s.name}: setup, the Forward button comes back to ${name}`);
    if (s.again && !(await s.at(page).count())) await s.again(page);
    await pointAt(page, s.at(page), `${s.name}: the element under the pointer`);

    const right = await step(page, core, () => swipe(page, 'right'));
    assert.deepEqual(right, byBack, `${s.name}: a swipe right goes Back exactly one step, as the Back button does (route, nav_opened, one route shown, the buttons)`);
    await sleep(300);
    const left = await step(page, core, () => swipe(page, 'left'));
    assert.deepEqual(left, byFwd, `${s.name}: 300 ms later a swipe left goes Forward one step, as the Forward button does`);
  });
}

test('fr_nav_03_ac11_no_entry_that_way_the_swipe_does_nothing', async ({ page }) => {
  const core = await start(page);
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  assert.deepEqual(await buttons(page), { backDisabled: true, forwardDisabled: true }, 'setup: no history yet');
  await pointAt(page, page.getByRole('main'), 'the Inbox');
  await staysPut(page, core, () => swipe(page, 'right'), 'no Back entry, a swipe right');
  await staysPut(page, core, () => swipe(page, 'left'), 'no Forward entry, a swipe left');
  await viaTypes(page);
  await pointAt(page, titleBar(page), 'the title bar');
  assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: true }, 'setup: one Back entry, no Forward entry');
  await staysPut(page, core, () => swipe(page, 'left'), 'no Forward entry, a swipe left');
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks, back.buttons], ['Inbox', 1, { backDisabled: true, forwardDisabled: false }], 'a swipe right goes Back to the Inbox, one step');
  await sleep(300);
  await staysPut(page, core, () => swipe(page, 'right'), 'on the first entry, a swipe right');
  const fwd = await step(page, core, () => swipe(page, 'left'));
  assert.deepEqual([fwd.to, fwd.marks, fwd.buttons], ['Schůzky', 1, { backDisabled: false, forwardDisabled: true }], 'a swipe left goes Forward to Schůzky, one step');
});

test('fr_nav_03_ac11_two_gestures_300_ms_apart_are_two_steps', async ({ page }) => {
  const core = await start(page);
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  await viaTypes(page);
  await toTasks(page);
  await pointAt(page, titleBar(page), 'the title bar');
  const one = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([one.to, one.marks], ['Schůzky', 1], 'the 12 events and the −400 one without a pause are one gesture: one step, to Schůzky');
  await sleep(300);
  const two = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([two.to, two.marks], ['Inbox', 1], 'a new gesture 300 ms later is the next step, to the Inbox');
});

// ------------------------------------------------------------------------------------------------ AC-12

/** The nearest box at or above `loc` that scrolls sideways (overflow-x auto / scroll, content wider than the box);
 *  `set` moves it first (`end` = its right edge). `self`: `loc` is the box itself, whatever its overflow style (the
 *  Kanban board of AC-9, which draws its own scrollbar). */
async function scrollerOf(loc: Locator, set?: number | 'end', self = false) {
  return loc.evaluate((el, [to, own]) => {
    let s: HTMLElement | null = el as HTMLElement;
    if (own) { if (s.scrollWidth <= s.clientWidth + 1) s = null; }
    else while (s && !(['auto', 'scroll'].includes(getComputedStyle(s).overflowX) && s.scrollWidth > s.clientWidth + 1)) s = s.parentElement;
    if (!s) return { found: false, left: 0, max: 0, x: 0, y: 0, w: 0, h: 0 };
    if (to !== null) s.scrollLeft = to === 'end' ? s.scrollWidth : (to as number);
    const r = s.getBoundingClientRect();
    return { found: true, left: s.scrollLeft, max: s.scrollWidth - s.clientWidth, x: r.left, y: r.top, w: s.clientWidth, h: s.clientHeight };
  }, [set ?? null, self] as const);
}
/** AC-12 for one box that scrolls sideways, with the pointer at (x, y) over it: a swipe scrolls it and never navigates,
 *  at both edges too. */
async function scrollsAndNeverNavigates(page: Page, core: FakeCoreHandle, loc: Locator, what: string, x: number, y: number, self = false) {
  const scroller = (l: Locator, set?: number | 'end') => scrollerOf(l, set, self);
  const s0 = await scroller(loc, 0);
  assert.ok(s0.found && s0.max > 0, `${what}: setup, it is wider than its box (${JSON.stringify(s0)})`);
  await page.mouse.move(x, y);
  await staysPut(page, core, () => swipe(page, 'right'), `${what} at its left edge, a swipe right`);
  assert.equal((await scroller(loc)).left, 0, `${what}: at its left edge a swipe right leaves scrollLeft at 0`);
  await staysPut(page, core, () => swipe(page, 'left'), `${what}, a swipe left`);
  const s1 = await scroller(loc);
  assert.ok(Math.abs(s1.left - Math.min(880, s0.max)) <= 2, `${what}: a swipe left scrolls it by 880 px, or to its end (${s1.left} of ${s0.max})`);
  const end = await scroller(loc, 'end');
  assert.ok(Math.abs(end.left - end.max) <= 1, `${what}: setup, scrolled to its right edge`);
  await staysPut(page, core, () => swipe(page, 'left'), `${what} at its right edge, a swipe left`);
  assert.ok(Math.abs((await scroller(loc)).left - end.max) <= 1, `${what}: at its right edge a swipe left leaves it there`);
  await staysPut(page, core, () => swipe(page, 'right'), `${what} from its right edge, a swipe right`);
  const s2 = await scroller(loc);
  assert.ok(Math.abs(s2.left - Math.max(0, end.max - 880)) <= 2, `${what}: a swipe right scrolls it back by 880 px, or to its start (${s2.left})`);
}

test.describe(() => {
  test.use({ timezoneId: 'Europe/Prague', viewport: { width: 1440, height: 900 } });
  test('fr_nav_03_ac12_the_kanban_scrolls_and_never_navigates', async ({ page }) => {
    // `install`: the page's clock runs (a fixed Date would hide the gesture's timing from the app).
    const core = await startTasks(page, { install: true });
    await gotoKanban(page, 'Status');
    const name = await mainName(page);
    const board = () => tMain(page).locator('[data-column]').first().locator('xpath=..');
    await must(board(), 'the board (parent of the Kanban columns)');
    // Another route and one Back: the Kanban (kept by Back, 5B feedback) has a Back and a Forward entry.
    await runCommand(page, 'Go to Inbox');
    await eventually(() => mainName(page), (n) => n !== name, 5000);
    assert.notEqual(await mainName(page), name, 'setup: another route');
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, name!, 'Back to Tasks');
    await must(board(), 'the Kanban again after Back');
    assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
    const b = (await board().boundingBox())!;
    await scrollsAndNeverNavigates(page, core, board(), 'the Kanban', b.x + 200, b.y + 120, true);
    // Control, off the Kanban. Forward, because the Back entries of the Kanban are the Tasks route's other views (the
    // same page name).
    await pointAt(page, titleBar(page), 'the title bar');
    await sleep(300);
    const fwd = await step(page, core, () => swipe(page, 'left'));
    assert.deepEqual([fwd.to, fwd.marks], ['Inbox', 1], 'control, off the Kanban: a swipe left over the title bar goes Forward one step, to the Inbox (D-1511)');
  });
});

const PROJEKT_ALL = 'columns: [stav, období, modified, rozpočet, aktivní, oblasti, web, poznámka, tags, source, aliases, created]\n';

test('fr_nav_03_ac12_a_wide_type_table_scrolls_and_one_that_fits_navigates', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // type-columns.md FR-TYP-09 AC-29's table: 13 columns on `type/projekt`, wider than its pane.
  const vault = typesVault((f) => { f[typeFile('projekt')] = swap(f[typeFile('projekt')], 'preview: [stav, období]\n', `preview: [stav, období]\n${PROJEKT_ALL}`); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Schůzky');
  await gotoTypePage(page, 'Projekty');
  await gotoTypePage(page, 'Schůzky');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Projekty', 'Back to Projekty');
  assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
  const table = typeTable(page, 'Projekty');
  await must(table, 'table Projekty', 5000);
  const s = await scrollerOf(table);
  assert.ok(s.found, 'setup: the Projekty table has a box that scrolls sideways (FR-TYP-09 AC-29)');
  const tb = (await table.boundingBox())!;
  await scrollsAndNeverNavigates(page, core, table, 'the wide type table', s.x + s.w / 2, tb.y + 40);
  // A type table that fits its pane navigates as AC-11: Schůzky's four columns (Back entry: Projekty).
  await page.keyboard.press('Meta+BracketRight');
  await mustBeOn(page, 'Schůzky', 'Forward to Schůzky');
  const fit = typeTable(page, 'Schůzky');
  await must(fit, 'table Schůzky', 5000);
  assert.equal((await scrollerOf(fit)).found, false, 'setup: Schůzky\'s table fits its pane (nothing at or above it scrolls sideways)');
  const fb = (await fit.boundingBox())!;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + Math.min(40, fb.height / 2));
  await sleep(300);
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks], ['Projekty', 1], 'over a type table that fits its pane a swipe right goes Back one step');
});

const KOD = 'Dlouhý kód';
const KOD_PATH = `Pages/${KOD}.md`;
const KOD_TEXT = [
  '---', 'id: 01JA0H0000000000000000S511', 'type: page', `title: ${KOD}`, 'created: 2026-11-11T09:00:00+01:00', 'modified: 2026-11-11T09:00:00+01:00', '---',
  'Úvodní odstavec nad kódem: příliš žluťoučký kůň úpěl ďábelské ódy.', '',
  '```js', `const řádek = '${'žluťoučký kůň úpěl ďábelské ódy, '.repeat(20)}konec';`, 'let krátký = 1;', '```', '',
  'Závěrečný odstavec pod kódem.', '',
].join('\n').normalize('NFC');

test('fr_nav_03_ac12_a_wide_code_block_scrolls_and_never_navigates', async ({ page }) => {
  const vault = shellVault();
  vault.files[KOD_PATH.normalize('NFC')] = KOD_TEXT;
  const core = await start(page, { vault });
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  await openNote(page, KOD);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Inbox');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, KOD, `Back to ${KOD}`);
  const prev = await backTarget(page, core);
  assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
  const body = await must(page.getByRole('textbox', { name: 'Note body' }), 'Note body', 5000);
  const pre = body.locator('pre').first();
  await must(pre, 'the code block (pre) in the editor');
  const s = await scrollerOf(pre);
  assert.ok(s.found, 'setup: the code block is wider than the note and scrolls sideways');
  assert.ok(await body.evaluate((b, x) => { let e = b.querySelector('pre') as HTMLElement | null; while (e && !(['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)) e = e.parentElement; return !!e && b.contains(e) && e !== b && Math.abs(e.getBoundingClientRect().left - x) < 1; }, s.x),
    'setup: the box that scrolls is the code block\'s own, inside the note body');
  await scrollsAndNeverNavigates(page, core, pre, 'the wide code block', s.x + s.w / 2, s.y + Math.min(20, s.h / 2));
  // The note's text beside the code block navigates as AC-11.
  await pointAt(page, body.getByText('Úvodní odstavec nad kódem', { exact: false }).first(), 'the paragraph above the code block');
  await sleep(300);
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks], [prev, 1], 'over the paragraph above the code block a swipe right goes Back one step');
});

/** Positions moved by (dx, dy) ± tol for every key; the offenders. */
function movedBy(a: Record<string, { x: number; y: number }>, b: Record<string, { x: number; y: number }>, dx: number, dy: number, tol = 3): string[] {
  return Object.keys(a).filter((k) => !b[k] || Math.abs(b[k].x - a[k].x - dx) > tol || Math.abs(b[k].y - a[k].y - dy) > tol)
    .map((k) => `${k}: (${b[k] ? Math.round((b[k].x - a[k].x) * 10) / 10 : '?'}, ${b[k] ? Math.round((b[k].y - a[k].y) * 10) / 10 : '?'})`);
}

test.describe(() => {
  test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

  test('fr_nav_03_ac12_the_graph_full_view_pans_and_never_navigates', async ({ page }) => {
    const core = await startGraph(page, { route: `note/${G.plan.normalize('NFC')}`, previewMode: 'click', realTime: true });
    await mustBeOn(page, 'Plán čtvrtletí', 'the note Plán čtvrtletí');
    await runCommand(page, 'Open graph');
    await must(graphHeading(page), 'the full view of Plán (R109)', 8000);
    const name = await mainName(page);
    await runCommand(page, 'Go to Inbox');
    await mustBeOn(page, 'Inbox', 'Inbox');
    await page.keyboard.press('Meta+BracketLeft');
    await must(graphHeading(page), 'Back to the full view', 8000);
    assert.equal((await waitDrawn(page, 10, 5000)).length, 10, 'setup: Plán at depth 1, 10 nodes');
    assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
    const c = (await (await must(canvas(page), 'the canvas')).boundingBox())!;
    await page.mouse.move(c.x + 8, c.y + 8);
    await sleep(600); // the layout rests
    for (const [dir, dx] of [['left', -880], ['right', 880]] as const) {
      const a = await positions(page);
      await staysPut(page, core, () => swipe(page, dir), `the graph canvas, a swipe ${dir}`);
      assert.deepEqual(movedBy(a, await positions(page), dx, 0), [], `a swipe ${dir} over the canvas pans every node by (${dx}, 0) (FR-GRP-01 AC-47)`);
    }
    assert.equal(await mainName(page), name, 'still the full view');
    await titleBarSwipeGoesBack(page, core, 'Plán čtvrtletí', 'control, off the canvas');
  });

  test('fr_nav_03_ac12_the_graph_panel_pans_and_never_navigates', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    const core = await openPanel(page, G.plan, { previewMode: 'click', realTime: true });
    await runCommand(page, 'Go to Inbox');
    await mustBeOn(page, 'Inbox', 'Inbox');
    await openNote(page, 'Plán čtvrtletí');
    await runCommand(page, 'Go to Inbox');
    await mustBeOn(page, 'Inbox', 'Inbox');
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Plán čtvrtletí', 'Back to Plán čtvrtletí');
    const prev = await backTarget(page, core);
    assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
    assert.equal((await waitDrawn(page, 10, 5000, GP(page))).length, 10, 'setup: Plán in the panel, 10 nodes');
    const c = (await (await must(pCanvas(page), 'the panel canvas')).boundingBox())!;
    await page.mouse.move(c.x + 6, c.y + 6);
    await sleep(600);
    for (const [dir, dx] of [['left', -880], ['right', 880]] as const) {
      const a = await positions(page, GP(page));
      await staysPut(page, core, () => swipe(page, dir), `the panel's canvas, a swipe ${dir}`);
      assert.deepEqual(movedBy(a, await positions(page, GP(page)), dx, 0), [], `a swipe ${dir} over the panel's canvas pans every node by (${dx}, 0) (FR-GRP-01 AC-49)`);
    }
    await titleBarSwipeGoesBack(page, core, prev, 'control, off the panel\'s canvas');
  });
});

// ------------------------------------------------------------------------------------------------ AC-13

/** Inbox → Schůzky → Tasks → Search, one Back: on Tasks with Back entries Schůzky, Inbox and a Forward entry; the
 *  pointer over the title bar (nothing there scrolls). */
async function onTasksWithHistory(page: Page, o: { swipeScroll?: boolean } = {}): Promise<FakeCoreHandle> {
  const core = await start(page, o);
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  await viaTypes(page);
  await toTasks(page);
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'search');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Tasks', 'Back to Tasks');
  assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: both Back and Forward have an entry');
  await pointAt(page, titleBar(page), 'the title bar');
  return core;
}

test('fr_nav_03_ac13_a_gesture_that_starts_mostly_vertical_never_navigates', async ({ page }) => {
  const core = await onTasksWithHistory(page);
  await staysPut(page, core, () => gesture(page, [...times(3, -10, 40), ...times(12, -40), [-400, 0]]), 'three events of (−10, 40), then the whole swipe right in the same gesture');
  await staysPut(page, core, () => gesture(page, [...times(2, 0, -40), ...times(12, 40), [400, 0]]), 'two events of (0, −40), then the whole swipe left in the same gesture');
  await staysPut(page, core, () => gesture(page, [[-30, 31], ...times(12, -40), [-400, 0]]), 'a first event of (−30, 31), then the whole swipe right');
  // Control: a new gesture that starts horizontal navigates; a little vertical drift in it doesn't matter.
  const back = await step(page, core, () => gesture(page, [...times(12, -40, 8), [-400, 0]]));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'a gesture of (−40, 8) events, mostly horizontal from its start, goes Back one step');
});

test('fr_nav_03_ac13_less_than_120_px_does_not_navigate', async ({ page }) => {
  const core = await onTasksWithHistory(page);
  await staysPut(page, core, () => gesture(page, times(2, -40)), 'a gesture of 80 px to the right');
  await staysPut(page, core, () => gesture(page, times(2, 40)), 'a gesture of 80 px to the left');
  await staysPut(page, core, () => gesture(page, [[-119, 0]]), 'one event of 119 px');
  // Each of those was its own gesture (600 ms apart): they don't add up. 120 px is enough.
  const back = await step(page, core, () => gesture(page, times(3, -40)));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'a gesture of exactly 120 px (3 × −40) goes Back one step');
  await sleep(300);
  const fwd = await step(page, core, () => gesture(page, times(3, 40)));
  assert.deepEqual([fwd.to, fwd.marks], ['Tasks', 1], 'a gesture of exactly 120 px to the left goes Forward one step');
});

test('fr_nav_03_ac13_a_gesture_that_reverses_counts_from_its_net_travel', async ({ page }) => {
  const core = await onTasksWithHistory(page);
  // 80 px right, 80 px back, 80 px right: 240 px of movement, 80 px net.
  await staysPut(page, core, () => gesture(page, [...times(2, -40), ...times(2, 40), ...times(2, -40)]), 'a gesture of −80, +80, −80 (net 80 px)');
  // 80 px right, 160 px back: net 80 px to the left.
  await staysPut(page, core, () => gesture(page, [...times(2, -40), ...times(4, 40)]), 'a gesture of −80, +160 (net 80 px the other way)');
  // The same start, then on to 120 px net: Back.
  const back = await step(page, core, () => gesture(page, [...times(2, -40), ...times(2, 40), ...times(3, -40)]));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'a gesture of −80, +80, −120 (net 120 px) goes Back one step');
  await sleep(300);
  // It reverses before 120 px and ends 120 px net on the other side: Forward.
  const fwd = await step(page, core, () => gesture(page, [...times(2, -40), ...times(5, 40)]));
  assert.deepEqual([fwd.to, fwd.marks], ['Tasks', 1], 'a gesture of −80, +200 (net 120 px to the left) goes Forward one step');
});

test('fr_nav_03_ac13_no_swipe_navigation_while_a_dialog_is_open', async ({ page }) => {
  const core = await onTasksWithHistory(page);
  const dialogs: [string, () => Promise<Locator>][] = [
    ['the palette', async () => { await page.keyboard.press('Meta+k'); return must(paletteDialog(page), 'the palette'); }],
    ['the New object picker', async () => { await page.keyboard.press('Meta+n'); return must(newObjectDialog(page), 'the New object picker'); }],
    ['the New type dialog', async () => { await (await must(sidebar(page).getByRole('button', { name: 'New type', exact: true }), 'sidebar New type')).click(); return must(page.getByRole('dialog', { name: 'New type' }), 'the New type dialog'); }],
  ];
  for (const [what, open] of dialogs) {
    const a = await quiet(page, core);
    const d = await open();
    await pointAt(page, titleBar(page), 'the title bar');
    await swipe(page, 'right');
    await sleep(500);
    await swipe(page, 'left');
    await sleep(500);
    assert.equal(await d.count(), 1, `${what} stays open through the swipes`);
    await page.keyboard.press('Escape');
    await eventually(() => d.count(), (n) => n === 0, 2000);
    assert.equal(await d.count(), 0, `${what} closes with Esc`);
    assert.deepEqual(await quiet(page, core), a, `${what} open: a swipe in either direction doesn't navigate (AC-6)`);
  }
  await pointAt(page, titleBar(page), 'the title bar');
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'control: with every dialog closed the swipe right goes Back one step');
});

// ------------------------------------------------------------------------------------------------ AC-14

/** The window gets the focus again: the DOM `blur` / `focus` pair on the window and the shell's `tauri://blur` /
 *  `tauri://focus` window events (the AC names the moment, not the channel). */
async function refocus(page: Page, core: FakeCoreHandle) {
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  await core.emit('tauri://blur' as any, null).catch(() => {});
  await sleep(50);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await core.emit('tauri://focus' as any, null).catch(() => {});
}
const asks = (core: FakeCoreHandle) => count(core, 'nav_swipe_scroll');

test('fr_nav_03_ac14_the_ui_asks_at_start_and_when_the_window_gets_the_focus', async ({ page }) => {
  const core = await start(page);
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  const n0 = await eventually(() => asks(core), (n) => n >= 1, 2000);
  assert.ok(n0 >= 1, `the UI calls nav_swipe_scroll at start (${n0} calls)`);
  const first = (await core.calls()).find((c) => c.cmd === 'nav_swipe_scroll')!;
  assert.deepEqual([first.ok, first.result], [true, true], 'the fake core answers `true` by default (the setting on)');
  const w0 = await core.writes();
  for (const round of [1, 2]) {
    const before = await asks(core);
    await refocus(page, core);
    const after = await eventually(() => asks(core), (n) => n > before, 2000);
    assert.ok(after > before, `focus ${round}: the UI asks nav_swipe_scroll again (${before} → ${after})`);
  }
  assert.equal(await core.writes(), w0, 'asking the setting is no write');
  assert.deepEqual((await nonReadCalls(core)).filter((c) => c === 'nav_swipe_scroll'), [], 'nav_swipe_scroll is a read-only command');
});

test('fr_nav_03_ac14_off_never_navigates_until_it_is_on_and_the_window_is_focused_again', async ({ page }) => {
  const core = await onTasksWithHistory(page, { swipeScroll: false });
  assert.ok((await eventually(() => asks(core), (n) => n >= 1, 2000)) >= 1, 'the UI asked nav_swipe_scroll at start');
  await staysPut(page, core, () => swipe(page, 'right'), 'the setting off, a swipe right (AC-8)');
  await staysPut(page, core, () => swipe(page, 'left'), 'the setting off, a swipe left (AC-8)');
  // Focus with the setting still off: still AC-8.
  await refocus(page, core);
  await sleep(300);
  await staysPut(page, core, () => swipe(page, 'right'), 'the setting off after a focus, a swipe right');
  // The setting changes to on; the window is focused again.
  await core.swipeScroll(true);
  const before = await asks(core);
  await refocus(page, core);
  assert.ok((await eventually(() => asks(core), (n) => n > before, 2000)) > before, 'the UI asks again at the focus');
  await sleep(300);
  await pointAt(page, titleBar(page), 'the title bar');
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'the setting on and the window focused again: a swipe right goes Back one step (AC-11)');
  await sleep(300);
  const fwd = await step(page, core, () => swipe(page, 'left'));
  assert.deepEqual([fwd.to, fwd.marks], ['Tasks', 1], 'and a swipe left goes Forward one step');
});

test('fr_nav_03_ac14_on_navigates_until_it_is_off_and_the_window_is_focused_again', async ({ page }) => {
  const core = await onTasksWithHistory(page);
  const back = await step(page, core, () => swipe(page, 'right'));
  assert.deepEqual([back.to, back.marks], ['Schůzky', 1], 'the setting on (the default): a swipe right goes Back one step');
  await core.swipeScroll(false);
  const before = await asks(core);
  await refocus(page, core);
  assert.ok((await eventually(() => asks(core), (n) => n > before, 2000)) > before, 'the UI asks again at the focus');
  await sleep(300);
  await pointAt(page, titleBar(page), 'the title bar');
  assert.deepEqual(await buttons(page), { backDisabled: false, forwardDisabled: false }, 'setup: on Schůzky, both directions have an entry');
  await staysPut(page, core, () => swipe(page, 'left'), 'the setting off after the focus, a swipe left (AC-8)');
  await staysPut(page, core, () => swipe(page, 'right'), 'the setting off after the focus, a swipe right (AC-8)');
});
