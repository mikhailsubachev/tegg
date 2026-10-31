// Slice "G3 in the panel", L5 (WebKit + fake core): the panel graph by keyboard (docs/acceptance/graph-panel-g3.md
// R126, R127): FR-UX-03 AC-31 (Tab lands on the centre; one tab stop), AC-32 (arrows by R120's direction rule from the
// DOM's node centres, pan into view), AC-33 (⏎, ⌘⏎, ⌘⇧⏎, ⌥Space; AP-961: the focus moves into the popover), AC-34 (`C`
// does nothing, the zoom keys; AP-962, AP-963), AC-35 (Esc: the preview, then the `Graph` tab; AP-960), AC-36 (single
// keys only with the focus in the panel graph), AC-37 (R123's commands act on the panel; AP-968, AP-972) and AC-38 (the
// panel without the pointer). Interface docs/contracts/v1-graph.md §17.4, §17.5 (on §16.3, §16.5). Fixtures
// tests/fixtures/vaults/graph and tests/fixtures/graph-presets/. Written from the ACs and the contracts only (D-61);
// every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustPreview, previewDialog } from './helpers';
import {
  P, callsOf, click, clickNode, drawn, eventually, expectedText, flat, focused, graphYml, mainName, marks, menuItem, must, nameField, nfc, nodeOf,
  openPresetMenu, paletteEntry, positions, presetMenu, presetsText, renameField, runCommand, saveDialog, seen, sleep, swap, uiWrites, VAULT_PATH,
  deleteConfirm,
} from './graph-helpers';
import {
  GP, VIEWPORT, ctxPanel, depthRadio, fullStored, graphTab, noteRoute, openFullBtn, openPanel, openPopover, panelStored, pCanvas,
  pFocusNode, pFocused, pListTree, pPointAt, pRows, pScale, pTabStops, pTypeBox, pViewBtn, popover, requests, searchOpen, startPanel, tagRoute,
  trigger, uiSetCount,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

type Core = Awaited<ReturnType<typeof openPanel>>;
type Dir = 'left' | 'right' | 'up' | 'down';
const KEY: Record<Dir, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const DIRS: Dir[] = ['right', 'left', 'up', 'down'];
/** R120's arrow rule (AP-934) on page coordinates, as graph_keyboard.ac.test.ts computes it. */
function rule(pos: Record<string, { x: number; y: number }>, from: string, dir: Dir): string | null {
  const o = pos[from];
  let best: { k: string; s: number; d: number } | null = null;
  for (const [k, p] of Object.entries(pos)) {
    if (k === from) continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const [pr, cr] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (!(pr > 0) || Math.abs(cr) > pr) continue;
    const s = pr + 2 * Math.abs(cr), d = Math.hypot(dx, dy);
    if (!best || s < best.s - 1e-6 || (Math.abs(s - best.s) <= 1e-6 && (d < best.d - 1e-6 || (Math.abs(d - best.d) <= 1e-6 && k < best.k)))) best = { k, s, d };
  }
  return best?.k ?? null;
}
async function focusOn(page: Page, k: string) {
  await pFocusNode(page, k);
  assert.equal((await pFocused(page)).key, nfc(k), `the focus is on the panel node ${k}`);
}
const selectedIn = async (page: Page) => (await drawn(page, GP(page))).filter((n) => n.selected).map((n) => n.key);
const navs = async (core: Core) => (await callsOf(core, 'nav_opened')).length;
const routeMarks = async (core: Core) => (await marks(core)).filter((m) => m.startsWith('route-ready:'));
const keysIn = (page: Page) => drawn(page, GP(page)).then((d) => d.map((n) => n.key).sort());
async function needIn(page: Page, n: number, what: string, ms = 4000) {
  const k = await eventually(() => keysIn(page), (x) => x.length === n, ms);
  assert.equal(k.length, n, `${what}: ${n} nodes drawn in the panel (got ${k.length})`);
}
/** The panel's tab stop exists (G3 in the panel); every test that needs the keyboard map starts here (TS-I1). */
async function needTabStop(page: Page, k = P.plan) {
  assert.deepEqual(await eventually(() => pTabStops(page), (s) => s.length === 1, 3000), [nfc(k)], `exactly one panel node has tabindex="0": ${k} (AP-935)`);
}
const back = async (page: Page, title = 'Plán čtvrtletí') => {
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === title, 4000), title, `Back on ${title}`);
};

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-31

test('fr_ux_03_ac31_panel_tab_lands_on_the_centre', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  await (await must(openFullBtn(page), '`Open full view (⌘⇧G)`')).focus();
  await page.keyboard.press('Tab');
  assert.equal((await pFocused(page)).key, nfc(P.plan), 'Tab from `Open full view` focuses Plán\'s node');
  const pos = await positions(page, GP(page));
  const dir = DIRS.find((d) => rule(pos, nfc(P.plan), d) !== null)!;
  await page.keyboard.press(KEY[dir]);
  const moved = (await pFocused(page)).key;
  assert.equal(moved, rule(pos, nfc(P.plan), dir), `${dir} moves to the rule's node`);
  assert.deepEqual(await pTabStops(page), [moved], 'one tab stop, on the focused node');
  await page.keyboard.press('Tab');
  const out = await pFocused(page);
  assert.ok(out.key === null && out.tag !== 'body', `Tab leaves the canvas to the next tab stop after the tab panel (${JSON.stringify(out)})`);
  await page.keyboard.press('Shift+Tab');
  assert.equal((await pFocused(page)).key, nfc(P.plan), '⇧Tab back into the canvas lands on Plán');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await pViewBtn(page, 'List').evaluate((e) => e === document.activeElement), true, `⇧Tab from Plán focuses \`List\`, the last \`View\` button, as Tab skips \`Open full view\` (D-1156, D-1162) (${(await focused(page)).name})`);
  // The focused node disappears in a live update: the tab stop and the focus move to the centre.
  await focusOn(page, P.zapis);
  const plan = (await core.files())[nfc(P.plan)];
  await core.setFile(P.plan, swap(plan, 'Podrobnosti v [[Zápis z porady#Závěry]] a klíčová věta v [[Zápis z porady#^klic]].', 'Podrobnosti jinde.'));
  await needIn(page, 9, 'Zápis gone after the live update');
  assert.deepEqual(await pTabStops(page), [nfc(P.plan)], 'the tab stop moves to the centre');
  assert.equal((await pFocused(page)).key, nfc(P.plan), 'and the focus too');
  await core.setFile(P.plan, plan);
  await needIn(page, 10, 'Zápis back');
  // In List the tree's one tab stop is the centre row.
  await click(pViewBtn(page, 'List'), '`List`');
  await must(pListTree(page), 'the tree');
  await (await must(openFullBtn(page), '`Open full view`')).focus();
  await page.keyboard.press('Tab');
  assert.equal((await pFocused(page)).row, 'Plán čtvrtletí, Page', 'in List, Tab lands on the `Plán čtvrtletí` row');
  await click(pViewBtn(page, 'Graph'), '`Graph`');
  await searchOpen(page, 'Rozpočet 2027');
  await needIn(page, 7, 'Rozpočet\'s panel');
  assert.deepEqual(await pTabStops(page), [nfc(P.rozpocet)], 'a navigation moves the tab stop to the new centre');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-32

async function arrowsFollowTheRule(page: Page, core: Core, what: string) {
  const r0 = (await routeMarks(core)).length;
  for (const dir of DIRS) {
    await focusOn(page, P.plan);
    const pos = await positions(page, GP(page));
    const want = rule(pos, nfc(P.plan), dir);
    await page.keyboard.press(KEY[dir]);
    const f = await pFocused(page);
    assert.equal(f.key, want ?? nfc(P.plan), `${what}: ${dir} from Plán → ${want ?? 'no candidate (the focus stays)'}`);
    assert.equal(f.visible, true, `${what}: ${dir}: the focus ring on it (:focus-visible)`);
  }
  const all = await positions(page, GP(page));
  const edge = Object.keys(all).find((k) => DIRS.some((d) => rule(all, k, d) === null));
  if (edge) {
    const d0 = DIRS.find((d) => rule(all, edge, d) === null)!;
    await focusOn(page, edge);
    await page.keyboard.press(KEY[d0]);
    assert.equal((await pFocused(page)).key, edge, `${what}: an arrow with no candidate leaves the focus`);
  }
  assert.equal((await routeMarks(core)).length, r0, `${what}: the route unchanged`);
  assert.deepEqual(await selectedIn(page), [], `${what}: moving the focus never selects`);
  assert.equal(await page.getByRole('dialog', { name: /^Preview: / }).count(), 0, `${what}: never previews`);
  assert.equal(await core.writes(), 0, `${what}: never writes`);
}

test('fr_ux_03_ac32_panel_arrow_keys', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note body');
  await body.click({ position: { x: 40, y: 8 } });
  const sel0 = await page.evaluate(() => { const s = getSelection(); return s && s.anchorNode ? [(s.anchorNode.textContent ?? '').normalize('NFC'), s.anchorOffset] : null; });
  const text0 = flat(await body.innerText());
  await arrowsFollowTheRule(page, core, 'depth 1 at 260 px');
  assert.equal(flat(await body.innerText()), text0, 'the editor\'s text is unchanged');
  await body.focus();
  const sel1 = await page.evaluate(() => { const s = getSelection(); return s && s.anchorNode ? [(s.anchorNode.textContent ?? '').normalize('NFC'), s.anchorOffset] : null; });
  assert.deepEqual(sel1, sel0, 'and its caret and selection');
  // Zoomed to 400 % (⌘-scroll): moving to an off-screen node pans it inside with a 24 px margin, zoom unchanged.
  const box = (await (await must(pCanvas(page), 'the canvas')).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Meta');
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -120); await sleep(30); }
  await page.keyboard.up('Meta');
  assert.ok(Math.abs((await pScale(page, P.plan)) - 4) < 0.02, `⌘-scroll zooms to 400 % (got ${await pScale(page, P.plan)})`);
  for (const dir of DIRS) {
    await focusOn(page, P.plan);
    const pos = await positions(page, GP(page));
    const want = rule(pos, nfc(P.plan), dir);
    if (!want) continue;
    await page.keyboard.press(KEY[dir]);
    await sleep(250);
    const r = await nodeOf(page, want, GP(page)).first().locator('circle, rect, ellipse').first().boundingBox();
    assert.ok(r && r.x >= box.x + 24 - 0.5 && r.y >= box.y + 24 - 0.5 && r.x + r.width <= box.x + box.width - 24 + 0.5 && r.y + r.height <= box.y + box.height - 24 + 0.5,
      `${dir} at 400 %: ${want} inside the canvas with a 24 px margin (${JSON.stringify(r)} in ${JSON.stringify(box)})`);
    assert.ok(Math.abs((await pScale(page, P.plan)) - 4) < 0.02, `${dir}: the zoom is unchanged`);
  }
});

test('fr_ux_03_ac32_panel_arrow_keys_depth_three_narrow', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 3 }, width: 240 });
  await needIn(page, 22, 'Plán at depth 3');
  await needTabStop(page);
  await arrowsFollowTheRule(page, core, 'depth 3 at 240 px');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-33

test('fr_ux_03_ac33_panel_return_keys_on_a_focused_node', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  await focusOn(page, P.rozpocet);
  await page.keyboard.press('Enter');
  assert.deepEqual(await eventually(() => selectedIn(page), (s) => s.length > 0, 1500), [nfc(P.rozpocet)], 'click mode: ⏎ selects Rozpočet');
  await mustPreview(page, 'Rozpočet 2027', '⏎ opens `Preview: Rozpočet 2027`');
  assert.equal((await eventually(() => pFocused(page), (f) => f.inPopover, 1500)).inPopover, true, 'the focus moves into the popover, as a click (AP-961, D-924)');
  await page.keyboard.press('Escape');
  assert.equal((await eventually(() => pFocused(page), (f) => f.key !== null, 1500)).key, nfc(P.rozpocet), 'Esc returns the focus to Rozpočet\'s node');
  assert.deepEqual(await selectedIn(page), [], 'with the selection cleared');
  const nav0 = await navs(core);
  await page.keyboard.press('Meta+Enter');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', '⌘⏎ opens note/Projekty/Rozpočet 2027.md');
  assert.equal((await navs(core)) - nav0, 1, 'one nav_opened');
  await needIn(page, 7, 'the panel shows Rozpočet\'s 7 nodes');
  assert.equal((await eventually(() => focused(page), (f) => f.tag === 'h1', 1500)).tag, 'h1', 'the focus is on the page heading (D-130)');
  await back(page);
  await needIn(page, 10, 'Plán again');
  await focusOn(page, P.rozpocet);
  const pages = page.context().pages().length;
  await page.keyboard.press('Meta+Shift+Enter');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', '⌘⇧⏎ does the same');
  assert.equal(page.context().pages().length, pages, 'and opens no window');
  assert.equal(await page.locator('[role="tab"][data-command="tab.current"]').count(), 1, 'and no new tab: one title-bar tab (D-1154)');
  await back(page);
  await needIn(page, 10, 'Plán again');
  // The centre: ⏎ previews it in click mode; ⌘⏎ and ⌘⇧⏎ do nothing (D-1042).
  await focusOn(page, P.plan);
  await page.keyboard.press('Enter');
  const d = await mustPreview(page, 'Plán čtvrtletí', '⏎ on the centre previews it');
  assert.ok((await eventually(async () => flat(await d.innerText()), (t) => t.includes('Page · 9 connections'), 2000)).includes('Page · 9 connections'), 'Plán\'s preview');
  await page.keyboard.press('Escape');
  const n1 = await navs(core), r1 = (await routeMarks(core)).length;
  for (const k of ['Meta+Enter', 'Meta+Shift+Enter']) { await focusOn(page, P.plan); await page.keyboard.press(k); }
  await sleep(600);
  assert.deepEqual([(await navs(core)) - n1, (await routeMarks(core)).length - r1], [0, 0], '⌘⏎ and ⌘⇧⏎ on the centre do nothing');
  await focusOn(page, 'tag:nápad');
  await page.keyboard.press('Meta+Enter');
  assert.equal(await eventually(async () => (await routeMarks(core)).map(nfc).some((m) => m === `route-ready:${tagRoute('nápad')}` || m === nfc('route-ready:tag/nápad')), (x) => x, 4000), true, '⌘⏎ on #nápad opens tag/nápad');
  assert.equal(await core.writes(), 0, 'and writes nothing');
});

for (const mode of ['hover', 'off'] as const) {
  test(`fr_ux_03_ac33_panel_return_keys_on_a_focused_node_${mode}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { previewMode: mode });
    await needIn(page, 10, 'Plán');
    await needTabStop(page);
    await focusOn(page, P.rozpocet);
    await page.keyboard.press('Alt+Space');
    await mustPreview(page, 'Rozpočet 2027', `${mode}: ⌥Space previews`);
    await page.keyboard.press('Escape');
    const n0 = await navs(core), r0 = (await routeMarks(core)).length;
    await focusOn(page, P.plan);
    await page.keyboard.press('Enter');
    await sleep(600);
    assert.deepEqual([(await navs(core)) - n0, (await routeMarks(core)).length - r0], [0, 0], `${mode}: ⏎ on the centre does nothing (D-1042)`);
    assert.equal(await page.getByRole('dialog', { name: /^Preview: / }).count(), 0, `${mode}: and previews nothing`);
    await focusOn(page, P.rozpocet);
    await page.keyboard.press('Enter');
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', `${mode}: ⏎ opens`);
  });
}

test('fr_ux_03_ac33_panel_return_keys_on_a_focused_node_alt_space_click_mode', async ({ page }) => {
  await openPanel(page, P.plan);
  await needTabStop(page);
  await focusOn(page, P.zapis);
  await page.keyboard.press('Alt+Space');
  await mustPreview(page, 'Zápis z porady', 'click mode: ⌥Space previews');
  assert.equal((await eventually(() => pFocused(page), (f) => f.inPopover, 1500)).inPopover, true, 'with the focus in the popover (AP-961)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-34

test('fr_ux_03_ac34_panel_c_and_zoom_keys', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  const s = await pScale(page, P.plan);
  assert.ok(Math.abs(s - 1) < 0.01, `the first-paint scale is 100 % for Plán at 260 px (${s})`);
  await focusOn(page, P.rozpocet);
  const c0 = (await core.calls()).length, r0 = (await routeMarks(core)).length, n0 = await navs(core);
  for (const k of ['c', 'Shift+C']) await page.keyboard.press(k);
  await sleep(500);
  assert.deepEqual([(await routeMarks(core)).length - r0, (await navs(core)) - n0], [0, 0], '`C` and ⇧C: no route change, no history entry, no nav_opened (AP-962)');
  assert.deepEqual((await core.calls()).slice(c0).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:')), [], 'no request');
  assert.equal((await pFocused(page)).key, nfc(P.rozpocet), 'the focus stays');
  const g0 = (await requests(core)).length;
  const ratio = async (key: string) => { const a = await pScale(page, P.plan); await page.keyboard.press(key); await sleep(150); return (await pScale(page, P.plan)) / a; };
  for (const key of ['+', '=', 'NumpadAdd']) assert.ok(Math.abs((await ratio(key)) - 1.25) < 0.02, `${key}: × 1.25 (AP-963)`);
  for (const key of ['-', 'NumpadSubtract']) assert.ok(Math.abs((await ratio(key)) - 0.8) < 0.02, `${key}: ÷ 1.25`);
  for (const key of ['0', 'Numpad0']) {
    await page.keyboard.press('+');
    await page.keyboard.press(key);
    await sleep(200);
    assert.ok(Math.abs((await pScale(page, P.plan)) - s) < 0.01, `${key}: back to the first-paint fit`);
    const cb = (await pCanvas(page).boundingBox())!;
    const pos = await positions(page, GP(page));
    const c = pos[nfc(P.plan)];
    assert.ok(Math.abs(c.x - (cb.x + cb.width / 2)) <= 0.5 && Math.abs(c.y - (cb.y + cb.height / 2)) <= 0.5, `${key}: the centre at the canvas's centre ± 0.5 px`);
    const boxes = await GP(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => { const r = g.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    assert.deepEqual(boxes.filter((b) => b.l < cb.x + 12 - 0.5 || b.t < cb.y + 12 - 0.5 || b.r > cb.x + cb.width - 12 + 0.5 || b.b > cb.y + cb.height - 12 + 0.5), [], `${key}: every node inside with the 12 px margin`);
  }
  for (let i = 0; i < 14; i++) await page.keyboard.press('+');
  assert.ok(Math.abs((await pScale(page, P.plan)) - 4) < 0.02, '400 % holds');
  for (let i = 0; i < 24; i++) await page.keyboard.press('-');
  assert.ok(Math.abs((await pScale(page, P.plan)) - 0.25) < 0.01, '25 % holds');
  assert.equal((await requests(core)).length, g0, 'none of them sends graph_neighbourhood');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-35

test('fr_ux_03_ac35_panel_escape_closes_then_leaves', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  const u0 = await uiSetCount(core), r0 = (await routeMarks(core)).length;
  await focusOn(page, P.rozpocet);
  await page.keyboard.press('Enter');
  await mustPreview(page, 'Rozpočet 2027', 'Rozpočet selected and previewed (setup)');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => page.getByRole('dialog', { name: /^Preview: / }).count(), (c) => c === 0, 1500), 0, 'Esc closes the popover');
  assert.deepEqual(await selectedIn(page), [], 'clears the selection');
  assert.equal((await pFocused(page)).key, nfc(P.rozpocet), 'and puts the focus on Rozpočet\'s node');
  await page.keyboard.press('Escape');
  const tab = await must(graphTab(page), 'the `Graph` tab');
  assert.equal(await eventually(() => tab.evaluate((e) => e === document.activeElement), (x) => x, 1000), true, 'a second Esc moves the focus to the panel\'s `Graph` tab (AP-960)');
  assert.equal(await tab.getAttribute('aria-selected'), 'true', 'aria-selected stays true');
  await sleep(300);
  assert.deepEqual([(await routeMarks(core)).length - r0, (await uiSetCount(core)) - u0, await core.writes()], [0, 0, 0], 'the route, the tab and rightPanel stay; nothing is written');
  assert.ok(await seen(pCanvas(page), 300), 'the panel stays open on Graph');
  // The same with the focus on a List row.
  await click(pViewBtn(page, 'List'), '`List`');
  const row = await must(pListTree(page).getByRole('treeitem', { name: /^Rozpočet 2027, / }), 'the Rozpočet row');
  await row.focus();
  await page.keyboard.press('Enter');
  await mustPreview(page, 'Rozpočet 2027', 'the row previews');
  await page.keyboard.press('Escape');
  assert.equal((await eventually(() => pFocused(page), (f) => f.row !== null, 1500)).row, 'Rozpočet 2027, Projekt', 'Esc returns the focus to the row');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => graphTab(page).evaluate((e) => e === document.activeElement), (x) => x, 1000), true, 'the second Esc: the `Graph` tab');
  // `Depth and filters` keeps G2's Esc.
  await openPopover(page);
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(popover(page), 500)), 'Esc closes `Depth and filters`');
  assert.equal(await trigger(page).evaluate((e) => e === document.activeElement), true, 'with the focus on the trigger');
  assert.ok(await seen(ctxPanel(page), 300), 'Esc never closes the panel');
});

test('fr_ux_03_ac35_panel_escape_closes_then_leaves_hover', async ({ page }) => {
  await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, install: true });
  await needTabStop(page);
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(t + 1000));
  await focusOn(page, P.plan);
  await pPointAt(page, P.rozpocet);
  await page.clock.runFor(450);
  await sleep(120);
  await mustPreview(page, 'Rozpočet 2027', 'a hover preview');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => page.getByRole('dialog', { name: /^Preview: / }).count(), (c) => c === 0, 1000), 0, 'in hover mode Esc only hides it');
  assert.equal(await graphTab(page).evaluate((e) => e === document.activeElement), false, 'and the focus doesn\'t leave the graph on that Esc');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-36

test('fr_ux_03_ac36_panel_single_keys_only_in_the_graph', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: presetsText('valid') });
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  const s0 = await pScale(page, P.plan), r0 = (await routeMarks(core)).length;
  const quiet = async (what: string) => {
    await sleep(150);
    assert.ok(Math.abs((await pScale(page, P.plan)) - s0) < 0.01, `${what}: no zoom`);
    assert.equal((await routeMarks(core)).length, r0, `${what}: no route change`);
    assert.equal((await pFocused(page)).key, null, `${what}: no move between nodes`);
    assert.deepEqual(await selectedIn(page), [], `${what}: no selection`);
  };
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note body');
  await body.click({ position: { x: 40, y: 8 } });
  await page.keyboard.press('End');
  await page.keyboard.type('C+0');
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(k);
  assert.ok(flat(await body.innerText()).includes('C+0'), 'in the editor, `C+0` is typed as text');
  await quiet('the editor');
  const controls: [string, () => Promise<void>, string[]][] = [
    ['the trigger', async () => { await (await must(trigger(page), 'trigger')).focus(); }, ['c', '+', '0', 'ArrowRight']],
    ['the `View` switch', async () => { await (await must(pViewBtn(page, 'Graph'), '`Graph`')).focus(); }, ['c', '+', '0']],
    ['`Open full view`', async () => { await (await must(openFullBtn(page), '`Open full view`')).focus(); }, ['c', '+', '0', 'ArrowLeft']],
    ['a `Depth` radio', async () => { await openPopover(page); await (await must(depthRadio(page, 1), 'radio 1')).focus(); }, ['c', '+', '0']],
    ['a type checkbox', async () => { await openPopover(page); await (await must(pTypeBox(page, 'Pages'), 'Pages')).focus(); }, ['c', '+', '0']],
    ['the preset button', async () => { await openPopover(page); await (await must(popover(page).getByRole('button', { name: /^Preset: / }), 'the preset button')).focus(); }, ['c', '+', '0']],
  ];
  for (const [what, focusIt, keys] of controls) {
    await focusIt();
    for (const k of keys) await page.keyboard.press(k);
    await quiet(what);
    if (await seen(popover(page), 100)) await page.keyboard.press('Escape');
  }
  await openPopover(page);
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  const name = await must(nameField(page), 'the Save dialog\'s `Name`');
  await name.focus();
  await page.keyboard.type('C+0');
  assert.equal(await name.inputValue(), 'C+0', 'in the Save dialog\'s `Name`, typing `C+0` gives `C+0`');
  await quiet('the Name field');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await clickNode(page, P.zapis, {}, GP(page));
  const d = await mustPreview(page, 'Zápis z porady', 'Zápis previewed');
  await (await must(d.getByRole('button', { name: /^Open\b/ }), '`Open`')).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('0');
  await sleep(150);
  assert.equal((await routeMarks(core)).length, r0, 'a button of the node popover: the keys do nothing graph-related');
  await page.keyboard.press('Escape');
  await focusOn(page, P.rozpocet);
  const s1 = await pScale(page, P.plan);
  for (const k of ['Meta+c', 'Meta+0', 'Alt+ArrowLeft']) await page.keyboard.press(k);
  await sleep(200);
  assert.ok(Math.abs((await pScale(page, P.plan)) - s1) < 0.01, '⌘C, ⌘0, ⌥← are not taken by the graph (scale)');
  assert.equal((await pFocused(page)).key, nfc(P.rozpocet), 'nor the focus');
  await searchOpen(page, 'Rozpočet 2027');
  await needIn(page, 7, 'Rozpočet');
  await focusOn(page, P.plan);
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', '⌘[ still goes Back');
  await needIn(page, 10, 'Plán');
  await focusOn(page, P.rozpocet);
  await page.keyboard.press('Meta+Backslash');
  assert.ok(!(await seen(ctxPanel(page), 800)), '⌘\\ still closes the panel');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-37

const R123_TITLES = ['Graph: Apply preset…', 'Graph: Save as new preset…', 'Graph: Update preset', 'Graph: Revert preset', 'Graph: Rename preset…', 'Graph: Delete preset…'];

test('fr_ux_03_ac37_graph_commands_act_on_the_panel', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: presetsText('valid') });
  await needIn(page, 10, 'Plán');
  for (const t of [...R123_TITLES, 'Graph: Depth 1', 'Graph: Depth 2', 'Graph: Depth 3', 'Graph: Show as list']) assert.equal((await paletteEntry(page, t)).listed, true, `\`${t}\` is listed on Plán with the panel on Graph`);
  for (const t of ['Graph: Show as graph', 'Graph: Recenter']) assert.equal((await paletteEntry(page, t)).listed, false, `\`${t}\` is not listed`);
  const w0 = (await uiWrites(core)).length;
  await runCommand(page, 'Graph: Show as list');
  await must(pListTree(page), '`Graph: Show as list` shows the panel\'s List');
  await sleep(300);
  const ws = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(ws.length, 1, 'one ui_state_set');
  assert.equal(ws[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.panel?.view, 'list', 'graph.panel.view "list"');
  assert.equal(await fullStored(core), null, 'graph.full not written');
  assert.deepEqual([(await paletteEntry(page, 'Graph: Show as graph')).listed, (await paletteEntry(page, 'Graph: Show as list')).listed], [true, false], 'then `Show as graph` is listed instead');
  await runCommand(page, 'Graph: Show as graph');
  await must(pCanvas(page), 'back to Graph');
  // Apply from the palette: the popover and the menu open with the focus on the checked item.
  await (await must(graphTab(page), 'the Graph tab')).focus();
  await runCommand(page, 'Graph: Apply preset…');
  await must(popover(page), '`Depth and filters` opens');
  await must(presetMenu(page), 'and the menu');
  assert.equal((await eventually(() => focused(page), (f) => f.name.replace(/\s*built-in$/, '') === 'Default', 1500)).name.replace(/\s*built-in$/, ''), 'Default', 'the focus on the checked item');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, 'Jen vztahy', '↓↓ to Jen vztahy');
  await page.keyboard.press('Enter');
  await needIn(page, 3, 'Jen vztahy applied to the panel as AC-27');
  assert.equal(await eventually(async () => (await panelStored(core))?.preset, (p) => p === 'Jen vztahy', 2000), 'Jen vztahy', 'graph.panel.preset');
  assert.ok(!(await seen(popover(page), 500)), 'the popover opened by the command closes with the choice (AP-968 c)');
  assert.equal(await graphTab(page).evaluate((e) => e === document.activeElement), true, 'the focus returns where it was before the palette');
  await runCommand(page, 'Graph: Save as new preset…');
  await must(saveDialog(page), '`Graph: Save as new preset…` opens the Save dialog');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(saveDialog(page), 400)) && !(await seen(popover(page), 300)), 'Esc closes the dialog and the popover it opened');
  const upd = await paletteEntry(page, 'Graph: Update preset');
  assert.deepEqual([upd.disabled, upd.text.includes('The filters match the preset.')], [true, true], '`Graph: Update preset` with the panel\'s reason `The filters match the preset.`');
  await runCommand(page, 'Graph: Rename preset…');
  await must(renameField(page), '`Graph: Rename preset…` opens the rename field of the panel\'s Jen vztahy');
  assert.equal(await renameField(page).inputValue(), 'Jen vztahy', 'with its name');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Graph: Delete preset…');
  await must(deleteConfirm(page, 'Jen vztahy'), '`Graph: Delete preset…` opens the panel\'s delete confirm');
  await page.keyboard.press('Escape');
  assert.equal(await graphYml(core), presetsText('valid'), 'nothing written');
});

for (const [what, presets, title, reason] of [
  ['default', 'valid', 'Graph: Rename preset…', 'Default can\'t be changed.'],
  ['unreadable', 'invalid-yaml', 'Graph: Save as new preset…', 'Fix .tegg/graph.yml to save presets.'],
  ['newer', 'newer-version', 'Graph: Save as new preset…', 'Made by a newer version of Tegg. Read-only.'],
] as const) {
  test(`fr_ux_03_ac37_graph_commands_act_on_the_panel_reason_${what}`, async ({ page }) => {
    await openPanel(page, P.plan, { presets: presetsText(presets) });
    await needIn(page, 10, 'Plán');
    await must(pViewBtn(page, 'Graph'), 'the panel\'s `View` switch (setup: G3 in the panel)');
    const e = await paletteEntry(page, title);
    assert.deepEqual([e.listed, e.disabled], [true, true], `${title} is listed aria-disabled from the panel's state`);
    assert.ok(e.text.includes(reason), `${title}: \`${reason}\` (${e.text})`);
  });
}

for (const [what, route, reason, viewEnabled] of [
  ['no_file', 'new/page', 'Open an object first', false],
  ['deleted', noteRoute(P.plan), 'Open an object first', false],
  ['no_links', noteRoute(P.osamela), 'No links yet', true],
] as const) {
  test(`fr_ux_03_ac37_graph_commands_act_on_the_panel_state_${what}`, async ({ page }) => {
    const core = await startPanel(page, route);
    await must(GP(page), 'the Graph tab panel', 5000);
    if (what === 'deleted') {
      await core.renameFile(P.plan, `.trash/${P.plan}`);
      await must(GP(page).getByText('This object was deleted', { exact: true }), 'the Deleted state', 3000);
    }
    await must(pViewBtn(page, 'Graph'), 'the panel\'s `View` switch (setup: G3 in the panel)');
    for (const t of R123_TITLES) {
      const e = await paletteEntry(page, t);
      assert.deepEqual([e.listed, e.disabled, e.text.includes(reason)], [true, true, true], `${what}: ${t} aria-disabled with \`${reason}\` (AP-972): ${e.text}`);
    }
    const v = await paletteEntry(page, 'Graph: Show as list');
    assert.deepEqual([v.listed, v.disabled], [true, !viewEnabled], `${what}: \`Graph: Show as list\` ${viewEnabled ? 'enabled' : 'aria-disabled'}`);
    if (!viewEnabled) assert.ok(v.text.includes('Open an object first'), `${what}: with \`Open an object first\``);
  });
}

test('fr_ux_03_ac37_graph_commands_act_on_the_panel_not_listed_elsewhere', async ({ page }) => {
  await openPanel(page, P.plan, { presets: presetsText('valid') });
  await needIn(page, 10, 'Plán');
  await runCommand(page, 'Graph: Show as list');
  await must(pListTree(page), 'setup: `Graph: Show as list` acts on the panel (G3 in the panel)');
  assert.equal((await paletteEntry(page, 'Graph: Apply preset…')).listed, true, 'listed with the panel on Graph (setup)');
  await click(ctxPanel(page).getByRole('tab', { name: /^⟦?Backlinks/ }), 'tab "Backlinks"');
  for (const t of [...R123_TITLES, 'Graph: Show as list', 'Graph: Depth 1']) assert.equal((await paletteEntry(page, t)).listed, false, `panel on Backlinks: \`${t}\` not listed`);
  await page.keyboard.press('Meta+Backslash');
  for (const t of [...R123_TITLES, 'Graph: Show as list']) assert.equal((await paletteEntry(page, t)).listed, false, `panel closed: \`${t}\` not listed`);
});

test('fr_ux_03_ac37_graph_commands_act_on_the_panel_reachability', async ({ page }) => {
  await openPanel(page, P.plan, { presets: presetsText('valid') });
  await needIn(page, 10, 'Plán');
  await needTabStop(page);
  const reach = async (loc: ReturnType<typeof trigger>, what: string) => {
    const el = await must(loc, what);
    const ok = (await el.getAttribute('data-command')) !== null || await el.evaluate((e) => { (e as HTMLElement).focus(); return e === document.activeElement; });
    assert.ok(ok, `${what}: a registered command or reachable by Tab (FR-UX-03 AC-8)`);
  };
  for (const v of ['Graph', 'List'] as const) await reach(pViewBtn(page, v), `the \`${v}\` button`);
  const nodes = await GP(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as Element[]).map((e) => ((e.getAttribute('tabindex') ?? e.querySelector('[tabindex]')?.getAttribute('tabindex')) ?? null)));
  assert.ok(nodes.length === 10 && nodes.every((t) => t === '0' || t === '-1'), `every node is in the keyboard map (tabindex 0 / -1): ${JSON.stringify(nodes)}`);
  await openPopover(page);
  await reach(popover(page).getByRole('button', { name: /^Preset: / }), 'the preset button');
  await openPresetMenu(page);
  for (const n of ['Default', 'Bez štítků']) await reach(presetMenu(page).getByRole('menuitemradio', { name: new RegExp(`^${n}`) }), `the menu item ${n}`);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await reach(nameField(page), 'the Save dialog\'s `Name`');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await clickNode(page, P.zapis, {}, GP(page));
  const d = await mustPreview(page, 'Zápis z porady', 'a node popover');
  await reach(d.getByRole('button', { name: 'In full graph', exact: true }), '`In full graph`');
  await page.keyboard.press('Escape');
  await click(pViewBtn(page, 'List'), 'List');
  const rows = await GP(page).evaluate((m) => ([...m.querySelectorAll('[role="treeitem"]')] as Element[]).map((e) => e.getAttribute('tabindex')));
  assert.ok(rows.length === 10 && rows.every((t) => t === '0' || t === '-1'), `every row is in the keyboard map: ${JSON.stringify(rows)}`);
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-38

/** Presses ↓ until the focused item is named `name` (at most `max` times). */
async function downTo(page: Page, name: string, max = 10) {
  for (let i = 0; i < max && (await focused(page)).name !== name; i++) await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, name, `↓ to \`${name}\``);
}
const onPresetButton = async (page: Page, what: string) => assert.ok((await eventually(() => focused(page), (f) => f.name.startsWith('Preset: '), 1500)).name.startsWith('Preset: '), `${what}: the focus on the preset button`);

test('fr_ux_03_ac38_panel_presets_and_list_without_the_pointer', async ({ page }) => {
  const core = await startPanel(page, noteRoute(P.plan), { tab: 'backlinks', panel: { depth: 2, hiddenTypes: ['tag'] } }); // Tags hidden as AC-29's setup, without the pointer
  await must(ctxPanel(page), 'the Context panel on Backlinks', 5000);
  await runCommand(page, 'Show local graph');
  await must(pCanvas(page), 'the panel graph', 4000);
  assert.equal(await eventually(() => trigger(page).evaluate((e) => e === document.activeElement), (x) => x, 1500), true, '`Show local graph`: the focus on `Depth and filters`');
  await page.keyboard.press('Enter');
  await must(popover(page), 'the popover');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'Preset: Default', 'Tab to `Preset: Default`');
  await page.keyboard.press('Enter');
  await must(presetMenu(page), 'the menu');
  await downTo(page, 'Save as new preset…');
  await page.keyboard.press('Enter');
  await must(saveDialog(page), 'the Save dialog');
  await page.keyboard.type('Bez štítků');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== undefined, 3000), expectedText('created'), 'the file is created as AC-29: expected/created.yml');
  await onPresetButton(page, 'after Save');
  await page.keyboard.press('Enter');
  await downTo(page, 'Rename “Bez štítků”…');
  await page.keyboard.press('Enter');
  await must(renameField(page), 'the rename field');
  await page.keyboard.type('Bez tagů');
  await page.keyboard.press('Enter');
  assert.ok((await eventually(() => graphYml(core), (t) => !!t?.includes('- name: Bez tagů'), 3000))?.includes('- name: Bez tagů'), 'renamed');
  await onPresetButton(page, 'after the rename');
  await page.keyboard.press('Enter');
  await downTo(page, 'Delete “Bez tagů”…');
  await page.keyboard.press('Enter');
  await must(deleteConfirm(page, 'Bez tagů'), 'the delete confirm');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'Delete', 'Tab to `Delete`');
  await page.keyboard.press('Enter');
  assert.ok(!(await eventually(() => graphYml(core), (t) => !t?.includes('Bez tagů'), 3000))?.includes('Bez tagů'), 'deleted');
  await onPresetButton(page, 'after the delete');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(popover(page), 500)), 'Esc closes the popover');
  assert.equal(await trigger(page).evaluate((e) => e === document.activeElement), true, 'the focus on the trigger');
  for (let i = 0; i < 4 && (await focused(page)).name !== 'List'; i++) await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'List', 'Tab to `List`');
  await page.keyboard.press('Space');
  await must(pListTree(page), 'Space shows the List');
  await page.keyboard.press('Tab');
  assert.equal((await pFocused(page)).row, 'Plán čtvrtletí, Page', 'Tab lands on the `Plán čtvrtletí` row');
  const row = async () => (await pFocused(page)).row;
  await page.keyboard.press('ArrowDown');
  assert.equal(await row(), 'Rozpočet 2027, Projekt', '↓ Rozpočet');
  await page.keyboard.press('ArrowRight');
  assert.equal(await row(), 'Jana Nováková, Osoba', '→ Jana');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await row(), 'Rozpočet 2027, Projekt', '← back to Rozpočet');
  await page.keyboard.press('ArrowLeft');
  const collapsed = (await pRows(page)).find((r) => r.name === 'Rozpočet 2027, Projekt');
  assert.equal(collapsed?.expanded, 'false', '← collapses Rozpočet');
  assert.equal((await pRows(page)).filter((r) => r.visible && ['Jana Nováková, Osoba', 'Výdaje 2026, Page'].includes(r.name)).length, 0, 'its children hidden (Tags hidden: Jana, Výdaje)');
  await page.keyboard.press('ArrowRight');
  assert.equal((await pRows(page)).find((r) => r.name === 'Rozpočet 2027, Projekt')?.expanded, 'true', '→ expands it');
  await page.keyboard.press('End');
  assert.equal(await row(), 'Zaplatit fakturu, Task', 'End: the last row');
  await page.keyboard.press('Home');
  assert.equal(await row(), 'Plán čtvrtletí, Page', 'Home: the first row');
  await page.keyboard.press('Alt+Space');
  await must(previewDialog(page, 'Plán čtvrtletí'), '⌥Space previews the focused row');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => graphTab(page).evaluate((e) => e === document.activeElement), (x) => x, 1000), true, 'Esc, Esc ends on the `Graph` tab');
});
