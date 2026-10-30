// Slice G3, L5 (WebKit + fake core): the graph by keyboard and what VoiceOver reads (docs/acceptance/graph.md part two,
// R120, R121): FR-UX-03 AC-22 (Tab lands on the centre; one tab stop), AC-23 (arrows follow the direction rule computed
// from the DOM's node centres; pan into view with a 24 px margin), AC-24 (⏎, ⌘⏎, ⌘⇧⏎, ⌥Space), AC-25 (`C` and the zoom
// keys), AC-26 (Esc: the preview, then the heading), AC-27 (single keys only with the focus in the graph), FR-UX-08
// AC-1 (computed accessible descriptions), AC-2 (the canvas description), AC-3 (the focus ring), AC-4 (Reduce motion
// for the pan). Interface docs/contracts/v1-graph.md §16.3, §16.5. Fixture tests/fixtures/vaults/graph. Written from
// the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, callsOf, canvas, click, clickNode, depthBtn, drawn, eventually, fitBtn, focused, graphHeading, graphRoute, headingIs, kindBox, marks, must,
  nameField, nfc, nodeDescription, nodeOf, openGraph, openBtn, openPresetMenu, menuItem, positions, presetBtn, previewCol, routeReady, seen, sizeBox,
  sleep, startGraph, tabStops, tokenColour, typeBox, waitDrawn, zoomIn,
} from './graph-helpers';
import { description } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

type Dir = 'left' | 'right' | 'up' | 'down';
const KEY: Record<Dir, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
/** R120's arrow rule (AP-934) on page coordinates (zoom and pan are uniform, so the choice is the same). */
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
async function focusNode(page: Page, k: string) {
  const el = await must(nodeOf(page, k), `node ${k}`);
  await el.evaluate((e) => {
    const t = (e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as HTMLElement | SVGElement | null;
    (t ?? (e as SVGElement)).focus();
  });
  assert.equal((await focused(page)).key, nfc(k), `the focus is on ${k}`);
}
const scale = (page: Page) => nodeOf(page, P.plan).locator('circle').first().evaluate((c) => c.getBoundingClientRect().width / 68).catch(() => NaN);
const selected = async (page: Page) => (await drawn(page)).filter((n) => n.selected).map((n) => n.key);
const navs = async (core: Awaited<ReturnType<typeof openGraph>>) => (await callsOf(core, 'nav_opened')).length;
const routeMarks = async (core: Awaited<ReturnType<typeof openGraph>>) => (await marks(core)).filter((m) => m.startsWith('route-ready:'));

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-22

test('fr_ux_03_ac22_tab_lands_on_the_centre', async ({ page }) => {
  await openGraph(page, P.plan);
  assert.deepEqual(await tabStops(page), [nfc(P.plan)], 'exactly one node has tabindex="0": the centre');
  const last = await must(sizeBox(page), 'the last control of the filter column');
  await last.focus();
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).key, nfc(P.plan), 'Tab from the filter column lands on Plán\'s node (D-916)');
  const pos = await positions(page);
  const dir = (['right', 'down', 'left', 'up'] as Dir[]).find((d) => rule(pos, nfc(P.plan), d) !== null)!;
  await page.keyboard.press(KEY[dir]);
  const moved = (await focused(page)).key;
  assert.equal(moved, rule(pos, nfc(P.plan), dir), `${dir} moves to the rule's node`);
  assert.deepEqual(await tabStops(page), [moved], 'still one tab stop, on the focused node');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'Zoom in', 'Tab leaves the canvas to `Zoom in`');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focused(page)).key, nfc(P.plan), '⇧Tab back into the canvas lands on Plán again (AP-935)');
  await focusNode(page, P.rozpocet);
  await click(typeBox(page, 'Projekty'), 'untick Projekty');
  await waitDrawn(page, 9);
  await focusNode(page, P.zapis);
  await (await must(kindBox(page, 'Links'), 'Links')).evaluate((e) => (e as HTMLInputElement).click());
  await eventually(() => drawn(page), (d) => !d.some((n) => n.key === nfc(P.zapis)), 2000);
  assert.deepEqual(await tabStops(page), [nfc(P.plan)], 'the focused node disappeared: the tab stop moves to the centre');
  assert.equal((await focused(page)).key, nfc(P.plan), 'and the focus too');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-23

test('fr_ux_03_ac23_arrow_keys_follow_the_direction_rule', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await routeReady(core, graphRoute(P.plan), 4000);
  const route0 = await routeMarks(core);
  for (const dir of ['right', 'left', 'up', 'down'] as Dir[]) {
    await focusNode(page, P.plan);
    const pos = await positions(page);
    const want = rule(pos, nfc(P.plan), dir);
    await page.keyboard.press(KEY[dir]);
    const got = (await focused(page)).key;
    assert.equal(got, want ?? nfc(P.plan), `${dir} from Plán: ${want ?? 'no candidate (the focus stays)'}`);
    const ring = await page.evaluate(() => (document.activeElement as Element | null)?.matches(':focus-visible') ?? false);
    assert.equal(ring, true, `${dir}: the focus ring is on it (:focus-visible)`);
  }
  const all = await positions(page);
  const edge = Object.keys(all).find((k) => (['right', 'left', 'up', 'down'] as Dir[]).some((d) => rule(all, k, d) === null))!;
  const d0 = (['right', 'left', 'up', 'down'] as Dir[]).find((d) => rule(all, edge, d) === null)!;
  await focusNode(page, edge);
  await page.keyboard.press(KEY[d0]);
  assert.equal((await focused(page)).key, edge, 'an arrow with no candidate leaves the focus');
  assert.deepEqual(await routeMarks(core), route0, 'and the route unchanged');
  assert.deepEqual(await selected(page), [], 'moving the focus never selects');
  assert.ok(!(await seen(previewCol(page).locator('[data-preview-path]'), 300)), 'never previews');
  assert.equal(await core.writes(), 0, 'never writes');
  for (let i = 0; i < 8; i++) await click(zoomIn(page), 'Zoom in').catch(() => {});
  const box = (await (await must(canvas(page), 'the canvas')).boundingBox())!;
  for (const dir of ['right', 'left', 'up', 'down'] as Dir[]) {
    await focusNode(page, P.plan);
    const pos = await positions(page);
    const want = rule(pos, nfc(P.plan), dir);
    if (!want) continue;
    await page.keyboard.press(KEY[dir]);
    await sleep(250);
    const r = await nodeOf(page, want).first().locator('circle, rect, ellipse').first().boundingBox();
    assert.ok(r && r.x >= box.x + 24 - 0.5 && r.y >= box.y + 24 - 0.5 && r.x + r.width <= box.x + box.width - 24 + 0.5 && r.y + r.height <= box.y + box.height - 24 + 0.5,
      `${dir} at 400 %: ${want} lies inside the canvas with a 24 px margin (${JSON.stringify(r)} in ${JSON.stringify(box)})`);
    assert.ok(Math.abs((await scale(page)) - 4) < 0.01, 'the zoom is unchanged');
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-24

test('fr_ux_03_ac24_return_keys_on_a_focused_node', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await focusNode(page, P.rozpocet);
  await page.keyboard.press('Enter');
  assert.deepEqual(await eventually(() => selected(page), (s) => s.length > 0, 1500), [nfc(P.rozpocet)], 'click mode: ⏎ selects Rozpočet (data-selected)');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'and the column previews it');
  assert.equal((await focused(page)).key, nfc(P.rozpocet), 'the focus stays on the node (AP-935)');
  const pages = page.context().pages().length;
  await page.keyboard.press('Meta+Enter');
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), '⌘⏎ opens note/Projekty/Rozpočet 2027.md');
  assert.equal(await navs(core), 1, 'one nav_opened');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 4000), 'Back');
  await focusNode(page, P.rozpocet);
  await page.keyboard.press('Meta+Shift+Enter');
  assert.ok(await eventually(async () => (await callsOf(core, 'nav_opened')).length, (n) => n === 2, 4000) === 2, '⌘⇧⏎ opens the same, in the current view (AP-933)');
  assert.equal(page.context().pages().length, pages, 'no window is created');
  assert.equal(await page.getByRole('tab').count(), 1, 'no tab');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 4000), 'Back');
  await focusNode(page, 'tag:nápad');
  await page.keyboard.press('Enter');
  assert.deepEqual(await eventually(() => selected(page), (s) => s.length > 0, 1500), ['tag:nápad'], '⏎ on #nápad previews it in click mode');
  await page.keyboard.press('Meta+Enter');
  assert.ok(await routeReady(core, `tag/${encodeURIComponent('nápad')}`, 4000) || await routeReady(core, 'tag/nápad', 200), '⌘⏎ opens tag/nápad');
  assert.equal(await core.writes(), 0, 'writing nothing');
});

for (const mode of ['hover', 'off'] as const) {
  test(`fr_ux_03_ac24_return_keys_on_a_focused_node_${mode}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { previewMode: mode });
    await focusNode(page, P.rozpocet);
    await page.keyboard.press('Alt+Space');
    await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), `${mode}: ⌥Space previews in the column`);
    await page.keyboard.press('Escape');
    await focusNode(page, P.rozpocet);
    await page.keyboard.press('Enter');
    assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), `${mode}: ⏎ opens`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-25

test('fr_ux_03_ac25_c_centres_and_zoom_keys', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await focusNode(page, P.rozpocet);
  await page.keyboard.press('c');
  assert.ok(await routeReady(core, graphRoute(P.rozpocet), 4000), '`C` changes the route to graph/Projekty/Rozpočet 2027.md');
  assert.ok(await headingIs(page, 'Local graph of Rozpočet 2027 · 7 objects', 3000), 'Rozpočet\'s graph');
  assert.deepEqual(await selected(page), [], 'nothing is selected');
  assert.equal((await eventually(() => focused(page), (f) => f.key === nfc(P.rozpocet), 2000)).key, nfc(P.rozpocet), 'the focus is on Rozpočet, now the centre');
  assert.deepEqual(await tabStops(page), [nfc(P.rozpocet)], 'with tabindex="0"');
  await page.keyboard.press('Meta+BracketLeft');
  assert.ok(await headingIs(page, 'Local graph of Plán čtvrtletí · 10 objects', 4000), 'a history entry: Back returns to Plán\'s graph');
  await waitDrawn(page, 10);
  await sleep(300);
  const before = (await routeMarks(core)).length;
  await focusNode(page, P.plan);
  await page.keyboard.press('c');
  await focusNode(page, 'tag:nápad');
  await page.keyboard.press('c');
  await sleep(400);
  assert.equal((await routeMarks(core)).length, before, '`C` on the centre and on #nápad does nothing');
  await click(fitBtn(page), 'Fit to screen');
  const fit = await scale(page);
  await focusNode(page, P.plan);
  const ratio = async (key: string) => { const a = await scale(page); await page.keyboard.press(key); await sleep(150); return (await scale(page)) / a; };
  for (const key of ['+', '=', 'NumpadAdd']) assert.ok(Math.abs((await ratio(key)) - 1.25) < 0.02, `${key}: Zoom in (× 1.25)`);
  for (const key of ['-', 'NumpadSubtract']) assert.ok(Math.abs((await ratio(key)) - 0.8) < 0.02, `${key}: Zoom out (× 0.8)`);
  await page.keyboard.press('0');
  await sleep(200);
  assert.ok(Math.abs((await scale(page)) - fit) < 0.01, '`0` fits as `Fit to screen`');
  await page.keyboard.press('+');
  await page.keyboard.press('Numpad0');
  await sleep(200);
  assert.ok(Math.abs((await scale(page)) - fit) < 0.01, 'keypad `0` too');
  for (let i = 0; i < 14; i++) await page.keyboard.press('+');
  assert.ok(Math.abs((await scale(page)) - 4) < 0.01, 'at most 400 %');
  for (let i = 0; i < 24; i++) await page.keyboard.press('-');
  assert.ok(Math.abs((await scale(page)) - 0.25) < 0.01, 'at least 25 %');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-26

test('fr_ux_03_ac26_escape_closes_then_leaves', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await focusNode(page, P.rozpocet);
  await page.keyboard.press('Enter');
  assert.deepEqual(await eventually(() => selected(page), (s) => s.length > 0, 1500), [nfc(P.rozpocet)], 'Rozpočet selected (setup)');
  const r0 = (await routeMarks(core)).length;
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => selected(page), (s) => s.length === 0, 1500), [], 'Esc clears the selection');
  await must(previewCol(page).getByText('Click a node to preview it', { exact: true }), 'the column\'s empty state');
  assert.equal((await focused(page)).key, nfc(P.rozpocet), 'the focus stays on Rozpočet');
  await page.keyboard.press('Escape');
  const f = await focused(page);
  assert.equal(f.tag, 'h1', 'a second Esc moves the focus to the page heading (AP-936)');
  assert.ok(f.name.replace(/\s*·\s*/g, ' · ').startsWith('Local graph of Plán čtvrtletí · 10 objects'), `the h1 \`Local graph of Plán čtvrtletí · 10 objects\` (${f.name})`);
  assert.equal((await routeMarks(core)).length, r0, 'the route stays');
  await focusNode(page, P.rozpocet);
  await page.keyboard.press('Enter');
  const open = await must(openBtn(page, 'Rozpočet 2027'), 'the column\'s `Open`');
  await open.focus();
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => selected(page), (s) => s.length === 0, 1500), [], 'Esc from the column clears the selection');
  assert.equal((await focused(page)).key, nfc(P.rozpocet), 'and returns the focus to Rozpočet\'s node');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-27

test('fr_ux_03_ac27_single_keys_only_with_focus_in_the_graph', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const s0 = await scale(page);
  const r0 = (await routeMarks(core)).length;
  const quiet = async (what: string) => {
    for (const key of ['c', '+', '-', '0', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(key).catch(() => {});
    await sleep(200);
    await page.keyboard.press('Escape').catch(() => {});
    assert.ok(Math.abs((await scale(page)) - s0) < 0.01, `${what}: no zoom`);
    assert.equal((await routeMarks(core)).length, r0, `${what}: no centring`);
    assert.equal((await focused(page)).key, null, `${what}: no move between nodes`);
  };
  const preset = await must(presetBtn(page), 'the preset button');
  await preset.focus();
  await quiet('the preset button');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  const name = await must(nameField(page), 'the Save dialog\'s `Name`');
  await name.focus();
  await page.keyboard.type('C+0');
  assert.equal(await name.inputValue(), 'C+0', 'typing `C+0` in `Name` gives `C+0`');
  await page.keyboard.press('Escape');
  for (const [what, loc] of [['a depth button', depthBtn(page, 2)], ['a type checkbox', typeBox(page, 'Pages')], ['Zoom in', zoomIn(page)]] as const) {
    const el = await must(loc, what);
    await el.focus();
    for (const key of ['c', '0', 'ArrowLeft']) await page.keyboard.press(key);
    await sleep(150);
    assert.equal((await routeMarks(core)).length, r0, `${what}: \`C\` never centres`);
    assert.equal((await focused(page)).key, null, `${what}: the arrows never move between nodes`);
  }
  await clickNode(page, P.zapis);
  const col = await must(openBtn(page, 'Zápis z porady'), 'a button of the preview column');
  await col.focus();
  await page.keyboard.press('c');
  await sleep(150);
  assert.equal((await routeMarks(core)).length, r0, 'a column button: `C` never centres');
  await focusNode(page, P.rozpocet);
  const s1 = await scale(page);
  for (const key of ['Meta+c', 'Meta+0', 'Alt+ArrowLeft']) await page.keyboard.press(key);
  await sleep(200);
  assert.ok(Math.abs((await scale(page)) - s1) < 0.01, '⌘C, ⌘0, ⌥← are not taken by the graph (no zoom)');
  assert.equal((await focused(page)).key, nfc(P.rozpocet), 'nor do they move the focus');
  const page2 = await page.context().newPage();
  const c2 = await startGraph(page2, { at: P.plan });
  await sleep(800);
  const n0 = (await routeMarks(c2)).length;
  for (const key of ['c', '+', '0']) await page2.keyboard.press(key);
  await sleep(300);
  assert.ok(!(await routeMarks(c2)).slice(n0).some((m) => m.startsWith('route-ready:graph/')), 'on a note route the keys do nothing graph-related');
  assert.ok(!(await seen(graphHeading(page2), 300)), 'no graph is shown');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-1, AC-2

test('fr_ux_08_ac1_node_descriptions_and_positions', async ({ page }) => {
  await openGraph(page, P.plan);
  const want: [string, string, string][] = [
    [P.plan, 'Plán čtvrtletí, Page', '9 connections. Centre of the graph. 1 of 10.'],
    [P.rozpocet, 'Rozpočet 2027, Projekt', '6 connections. Links to Plán čtvrtletí by relation Podklady · Linked from Plán čtvrtletí. 2 of 10.'],
    ['tag:účty', '#Účty, Tag', '3 connections. Tag of Plán čtvrtletí. 5 of 10.'],
    [P.ukol, 'Zaplatit fakturu, Task', '1 connection. Embedded in Plán čtvrtletí · Links to Plán čtvrtletí by relation Source. 10 of 10.'],
  ];
  for (const [k, name, desc] of want) {
    assert.equal((await drawn(page)).find((n) => n.key === nfc(k))?.name, name, `${k}: the name stays \`${name}\` (G1)`);
    assert.equal(await nodeDescription(page, k), desc, `${k}: ${desc}`);
  }
  await click(depthBtn(page, 2), 'depth 2');
  await waitDrawn(page, 19);
  assert.equal(await nodeDescription(page, P.jana), '3 connections. Linked from Rozpočet 2027 by relation Vlastník. 11 of 19.', 'Jana at depth 2');
  await click(depthBtn(page, 1), 'depth 1');
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await waitDrawn(page, 8);
  assert.ok((await nodeDescription(page, P.den)).endsWith('. 5 of 8.'), `with Tags hidden at depth 1, Den is \`5 of 8\`: ${await nodeDescription(page, P.den)}`);
});

test('fr_ux_08_ac2_canvas_description', async ({ page }) => {
  await openGraph(page, P.plan);
  assert.equal(await description(canvas(page)), 'Use the arrow keys to move between nodes. Switch the view to List to read the same objects as a list.', 'the canvas group\'s description');
  assert.equal(await (await must(canvas(page), 'the canvas')).getAttribute('aria-label'), 'Local graph: Plán čtvrtletí and the objects linked to it, 1 level deep', 'G1\'s name stays');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-3

/** The focus ring of a node: a shape stroked in `--focus` (2.5 px) outside the node's shape with a 3 px gap. */
async function focusRing(page: Page, k: string, focus: string): Promise<{ width: number; gap: number } | null> {
  return nodeOf(page, k).first().evaluate((e, f) => {
    const shape = e.querySelector('circle, rect, ellipse') as SVGGraphicsElement | null;
    if (!shape) return null;
    const sb = shape.getBoundingClientRect();
    for (const r of [...e.querySelectorAll('*')] as SVGGraphicsElement[]) {
      const s = getComputedStyle(r);
      if (s.stroke !== f || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || s.strokeOpacity === '0') continue;
      const rb = r.getBoundingClientRect();
      const w = parseFloat(s.strokeWidth);
      return { width: w, gap: Math.round(((rb.width - sb.width) / 2 - w) * 10) / 10 };
    }
    return null;
  }, focus).catch(() => null);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_08_ac3_node_focus_ring_${theme}`, async ({ page }) => {
    await openGraph(page, P.plan, { theme });
    const focus = await tokenColour(page, 'focus');
    await focusNode(page, P.plan);
    await page.keyboard.press('ArrowRight');
    const k = (await focused(page)).key ?? nfc(P.rozpocet);
    const ring = await focusRing(page, k, focus);
    assert.ok(ring, `${theme}: the focused node has a ring in --focus`);
    assert.equal(ring!.width, 2.5, '2.5 px');
    assert.ok(Math.abs(ring!.gap - 3) <= 0.6, `a 3 px gap (${ring!.gap})`);
    await page.keyboard.press('Enter');
    const hl = await tokenColour(page, 'hl');
    assert.ok(await focusRing(page, k, focus) && await focusRing(page, k, hl), 'selected and focused: both rings');
    const ratios = await page.evaluate(async ([th, f]) => {
      const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
      const { ratio } = await import('/src/theme/contrast.ts' as string);
      const out: Record<string, number> = { canvas: ratio(tokens[f], tokens.canvas) };
      for (const key of Object.keys(tokens).filter((x) => /^type-[a-z]+-bg$/.test(x))) out[key] = ratio(tokens[f], tokens[key]);
      return out;
    }, [theme, 'focus'] as const);
    const low = Object.entries(ratios).filter(([, r]) => r < 3);
    assert.deepEqual(low, [], `${theme}: --focus against --canvas and each type fill ≥ 3:1 (WCAG 1.4.11)`);
    await clickNode(page, P.zapis);
    assert.equal(await focusRing(page, P.zapis, focus), null, 'a pointer click shows no focus ring (:focus-visible)');
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-4 (pan)

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`fr_ux_08_ac4_reduce_motion_for_ring_and_pan_${motion.replace('-', '_')}`, async ({ page }) => {
    await openGraph(page, P.plan, { reducedMotion: motion });
    for (let i = 0; i < 8; i++) await click(zoomIn(page), 'Zoom in').catch(() => {});
    const box = (await (await must(canvas(page), 'the canvas')).boundingBox())!;
    await focusNode(page, P.plan);
    const pos = await positions(page);
    const off = (['right', 'left', 'up', 'down'] as Dir[]).map((d) => [d, rule(pos, nfc(P.plan), d)] as const)
      .find(([, k]) => k && (pos[k].x < box.x || pos[k].x > box.x + box.width || pos[k].y < box.y || pos[k].y > box.y + box.height));
    assert.ok(off, 'setup: at 400 % one arrow leads off-screen');
    const t0 = Date.now();
    await page.keyboard.press(KEY[off![0]]);
    const inside = async () => {
      const r = await nodeOf(page, off![1]!).first().locator('circle, rect, ellipse').first().boundingBox();
      return !!r && r.x >= box.x + 23 && r.x + r.width <= box.x + box.width - 23 && r.y >= box.y + 23 && r.y + r.height <= box.y + box.height - 23;
    };
    if (motion === 'reduce') {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.ok(await inside(), 'Reduce motion: the pan is instant');
    } else {
      assert.ok(await eventually(inside, (x) => x, 600), 'the pan brings the node into view');
      assert.ok(Date.now() - t0 <= 150 + 250, `within ≤ 150 ms (+ probe overhead): ${Date.now() - t0} ms`);
    }
  });
}
