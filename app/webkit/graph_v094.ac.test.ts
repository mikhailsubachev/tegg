// v0.94 feedback (D-1164, D-1165, D-1167, D-1169, D-1170, D-1177…D-1180), L5 (WebKit + fake core): the graph's part.
// docs/acceptance/graph.md part three, FR-GRP-01 AC-46 (one 1.5 px solid `--muted` edge style; D-1178's highlight), AC-47
// (a plain wheel pans the full view; D-1180's direction), AC-48 (⌘-wheel, ctrl-wheel and pinch zoom around the pointer;
// D-1179's step), AC-49 (the same in the panel; the note doesn't scroll), FR-GRP-02 AC-35 (Connections without line
// samples), FR-GRP-06 AC-11 (a click inside the graph's preview opens), AC-12 (links in it follow hover mode, D-1170),
// FR-LNK-12 AC-21 (hover with 1,000 ms by default in the graph). AC-50 is manual. D-1164's test rule: every test names the
// preview mode it stores; "nothing stored" leaves the `preview` key out. Full view: Plán at depth 1 (820 × 640 canvas at
// 100 %); panel: graph-panel.md's test clock. Interface docs/contracts/v1-graph.md §2…§8, §15, §16 (as part three changes
// them), v1-previews §7. Written from the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and
// node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, callsOf, canvas, click, clickNode, drawn, drawnEdges, eventually, filtersBtn, fitBtn, flat, hint, hoverRing, kindBox, kindsGroup, main, mainName,
  marks, must, nfc, nodeAt, nodeOf, opacity, openBtn, openGraph, pauseClock, pointAt, positions, previewCol, ringAnimations, seen, sleep,
  tokenColour, viewBtn, listTree, waitDrawn, zoomIn, centerHereBtn, type FakeCoreHandle, type Scope,
} from './graph-helpers';
import {
  GP, VIEWPORT, ctxPanel, graphPanel, openPanel, pCanvas, pFooterIs, pFooterText, pHoverRing, pKinds, pPointAt, pRingAnimations, pScale, popover,
  openPopover,
} from './graph-panel-helpers';
import { anyPreviewDialog, mustPreview } from './helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const ROZ = 'Rozpočet 2027';
const shown = (page: Page, path: string, at?: Locator) => (at ?? previewCol(page)).locator(`[data-preview-path="${nfc(path)}"]`);
const anyShown = (page: Page) => previewCol(page).locator('[data-preview-path]');
const selected = async (page: Page, at?: Scope) => (await drawn(page, at)).filter((n) => n.selected).map((n) => n.key);
async function tick(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await sleep(120);
}
/** Route-ready marks of `route` so far (`perf_mark`, ms3-shell §6). */
async function readyCount(core: FakeCoreHandle, route: string): Promise<number> {
  return (await marks(core)).map(nfc).filter((m) => m === `route-ready:${nfc(route)}`).length;
}
async function routeOnce(core: FakeCoreHandle, route: string, before: number, ms = 4000): Promise<boolean> {
  return (await eventually(() => readyCount(core, route), (n) => n > before, ms)) > before;
}
const navCount = async (core: FakeCoreHandle) => (await callsOf(core, 'nav_opened')).length;

/** Every drawn edge's computed paint: stroke, width, dash, markers, opacity product up to the svg. */
async function edgePaints(page: Page, at?: Scope) {
  return (at ?? main(page)).evaluate((m) => ([...m.querySelectorAll('[data-graph-edge]')] as SVGElement[]).map((e) => {
    const s = getComputedStyle(e);
    let o = 1;
    for (let p: Element | null = e; p && p.tagName.toLowerCase() !== 'svg'; p = p.parentElement) o *= Number(getComputedStyle(p).opacity || '1');
    return {
      pair: `${(e.getAttribute('data-a') ?? '').normalize('NFC')}|${(e.getAttribute('data-b') ?? '').normalize('NFC')}`,
      stroke: s.stroke, width: parseFloat(s.strokeWidth), dash: s.strokeDasharray,
      marker: [s.markerStart, s.markerEnd, e.getAttribute('marker-start'), e.getAttribute('marker-end')].filter((x) => x && x !== 'none').length,
      opacity: Math.round(o * 100) / 100,
    };
  }));
}
/** The paints that differ from one 1.5 px solid line in `stroke`, without a marker. */
function offStyle(paints: Awaited<ReturnType<typeof edgePaints>>, stroke: string): string[] {
  return paints.filter((p) => Math.abs(p.width - 1.5) > 0.01 || !(p.dash === 'none' || p.dash === '') || p.stroke !== stroke || p.marker > 0)
    .map((p) => `${p.pair}: ${p.width} px, dash ${p.dash}, ${p.stroke}, markers ${p.marker}`);
}
async function depth2(page: Page) {
  await click(main(page).getByRole('group', { name: 'Depth', exact: true }).getByRole('button', { name: '2', exact: true }), 'depth 2');
  const k = await waitDrawn(page, 19, 4000);
  assert.equal(k.length, 19, `depth 2: 19 nodes (got ${k.length})`);
}
/** Dispatches a synthetic wheel at (x, y) on the element under it; returns whether it was `defaultPrevented`. */
async function wheelAt(page: Page, x: number, y: number, dx: number, dy: number, mods: { meta?: boolean; ctrl?: boolean } = {}): Promise<boolean> {
  return page.evaluate(([px, py, ddx, ddy, meta, ctrl]) => {
    const t = document.elementFromPoint(px as number, py as number) ?? document.body;
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, deltaX: ddx as number, deltaY: ddy as number, deltaMode: 0, clientX: px as number, clientY: py as number, metaKey: !!meta, ctrlKey: !!ctrl });
    t.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [x, y, dx, dy, mods.meta ?? false, mods.ctrl ?? false] as const);
}
/** A synthesized WebKit pinch: `gesturestart` then `gesturechange` with `scale` (relative to the start), then `gestureend`. */
async function pinchAt(page: Page, x: number, y: number, scale: number): Promise<boolean[]> {
  return page.evaluate(([px, py, sc]) => {
    const t = document.elementFromPoint(px, py) ?? document.body;
    const mk = (type: string, s: number) => {
      const ev = new UIEvent(type, { bubbles: true, cancelable: true }) as any;
      for (const [k, v] of Object.entries({ scale: s, rotation: 0, clientX: px, clientY: py, pageX: px, pageY: py, screenX: px, screenY: py })) Object.defineProperty(ev, k, { value: v });
      t.dispatchEvent(ev);
      return ev.defaultPrevented as boolean;
    };
    return [mk('gesturestart', 1), mk('gesturechange', sc), mk('gestureend', sc)];
  }, [x, y, scale] as const);
}
/** The full view's zoom: the centre's 68 px circle as drawn (graph.ac.test.ts FR-GRP-05 AC-3). */
const scaleOf = (page: Page) => nodeAt(page, P.plan).locator('circle').first().evaluate((c) => c.getBoundingClientRect().width / 68).catch(() => NaN);
/** Positions moved by (dx, dy) ± tol for every key; the offenders. */
function movedBy(a: Record<string, { x: number; y: number }>, b: Record<string, { x: number; y: number }>, dx: number, dy: number, tol = 1): string[] {
  return Object.keys(a).filter((k) => !b[k] || Math.abs(b[k].x - a[k].x - dx) > tol || Math.abs(b[k].y - a[k].y - dy) > tol)
    .map((k) => `${k}: (${b[k] ? Math.round((b[k].x - a[k].x) * 10) / 10 : '?'}, ${b[k] ? Math.round((b[k].y - a[k].y) * 10) / 10 : '?'})`);
}
/** Window and centre-pane scroll offsets. */
async function scrolls(page: Page) {
  return page.evaluate(() => {
    const m = document.querySelector('main');
    const all = [document.scrollingElement, m, ...(m ? [...m.querySelectorAll('*')] : [])].filter(Boolean) as HTMLElement[];
    return all.filter((e) => e.scrollTop || e.scrollLeft || e === document.scrollingElement).map((e) => `${e.tagName}:${e.scrollTop}:${e.scrollLeft}`).join(' ');
  });
}
async function emptyPoint(page: Page, at?: Scope) {
  const r = (await (await must(canvas(page, at), 'the canvas')).boundingBox())!;
  return { x: r.x + 8, y: r.y + 8 };
}
/** D-1193: a wheel's `clientX` / `clientY` are whole pixels in WebKit, so a zoom "around the pointer" is checked at a
 *  whole-pixel point: the drawing is panned by the fraction (a wheel at an empty point of the canvas) until `k`'s
 *  on-screen centre is on a whole pixel, which is returned. */
async function wholePixelCentre(page: Page, k: string, at?: Scope) {
  const c = await centreOf(page, k, at);
  const fx = c.x - Math.round(c.x), fy = c.y - Math.round(c.y);
  if (Math.abs(fx) > 0.01 || Math.abs(fy) > 0.01) {
    const e = await emptyPoint(page, at);
    await wheelAt(page, e.x, e.y, fx, fy);
    await sleep(250);
  }
  const q = await centreOf(page, k, at);
  return { x: Math.round(q.x), y: Math.round(q.y) };
}
async function centreOf(page: Page, k: string, at?: Scope) {
  const p = await positions(page, at);
  assert.ok(p[nfc(k)], `${k} is drawn`);
  return p[nfc(k)];
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-46

for (const theme of ['light', 'dark'] as const) {
  test(`fr_grp_01_ac46_every_edge_one_solid_muted_line_${theme}`, async ({ page }) => {
    await openGraph(page, P.plan, { theme, previewMode: 'click' });
    await depth2(page);
    const muted = await tokenColour(page, 'muted');
    const all = await drawnEdges(page);
    assert.equal(all.length, 21, `21 edges at depth 2 (got ${all.length})`);
    assert.equal(new Set(all.map((e) => e.pair)).size, 21, 'exactly one [data-graph-edge] per pair');
    assert.deepEqual(offStyle(await edgePaints(page), muted), [], `${theme}: every edge is 1.5 px, solid, ${muted} (--muted), no marker (D-1167), tag, embed, relation, date and attachment edges included`);
  });
}

test('fr_grp_01_ac46_every_edge_one_solid_muted_line_with_filters', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'click' });
  await depth2(page);
  const muted = await tokenColour(page, 'muted');
  for (const [kind, n] of [['Relations', 17], ['Embeds', null], ['Links', null]] as const) {
    await click(kindBox(page, kind), `${kind} off`);
    if (n !== null) assert.equal((await eventually(() => drawnEdges(page), (e) => e.length === n, 3000)).length, n, `${kind} off: ${n} edges`);
    else await sleep(600);
    const e = await drawnEdges(page);
    assert.equal(new Set(e.map((x) => x.pair)).size, e.length, `${kind} off: one edge per pair`);
    assert.deepEqual(offStyle(await edgePaints(page), muted), [], `${kind} off: every edge still drawn is the same line`);
    await click(kindBox(page, kind), `${kind} on`);
    await sleep(400);
  }
});

test('fr_grp_01_ac46_every_edge_one_solid_muted_line_in_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openPanel(page, P.plan, { previewMode: 'click' });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán at depth 1 in the panel');
  const muted = await tokenColour(page, 'muted');
  const e = await eventually(() => drawnEdges(page, GP(page)), (x) => x.length === 11, 3000);
  assert.equal(e.length, 11, `11 edges in the panel (got ${e.length})`);
  assert.deepEqual(offStyle(await edgePaints(page, GP(page)), muted), [], 'every panel edge has the same stroke (1.5 in the SVG\'s units), no dash, --muted');
});

test('fr_grp_01_ac46_every_edge_one_solid_muted_line_highlight', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  await clickNode(page, P.rozpocet);
  await must(shown(page, P.rozpocet), 'Rozpočet selected (its preview)');
  await sleep(300);
  const hl = await tokenColour(page, 'hl');
  const muted = await tokenColour(page, 'muted');
  const paints = await edgePaints(page);
  const r = nfc(P.rozpocet);
  const touching = paints.filter((p) => p.pair.split('|').includes(r));
  const others = paints.filter((p) => !p.pair.split('|').includes(r));
  assert.ok(touching.length >= 1, 'edges touch Rozpočet');
  assert.deepEqual(touching.filter((p) => p.stroke !== hl || Math.abs(p.width - 1.5) > 0.01).map((p) => p.pair), [], 'the selected node\'s edges are --hl at 1.5 px (D-1178)');
  assert.deepEqual(others.filter((p) => p.opacity !== 0.35 || p.stroke !== muted).map((p) => `${p.pair} ${p.opacity} ${p.stroke}`), [], 'the other edges stay --muted at 0.35 opacity');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-47

test('fr_grp_01_ac47_wheel_pans_the_full_view', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  await clickNode(page, P.rozpocet);
  await must(shown(page, P.rozpocet), 'Rozpočet selected (the column shows it)');
  const e = await emptyPoint(page);
  await page.mouse.move(e.x, e.y);
  const s0 = await scaleOf(page);
  const sc0 = await scrolls(page);
  const g0 = (await core.graphCalls()).length, u0 = (await callsOf(core, 'ui_state_set')).length, n0 = await navCount(core);
  for (const [dx, dy] of [[0, 120], [80, 0], [60, -40]] as const) {
    const a = await positions(page);
    await page.mouse.wheel(dx, dy);
    await sleep(250);
    const b = await positions(page);
    assert.deepEqual(movedBy(a, b, -dx, -dy), [], `a wheel of (${dx}, ${dy}) over the empty canvas moves every node by (${-dx}, ${-dy}) ± 1 px (D-1180)`);
    assert.ok(Math.abs((await scaleOf(page)) - s0) < 0.005, `(${dx}, ${dy}): no zoom (the centre's circle stays 68 px)`);
    assert.equal(await wheelAt(page, e.x, e.y, dx, dy), true, `(${dx}, ${dy}): the wheel event is defaultPrevented`);
    await sleep(200);
  }
  // D-1193: wheel back to the first view (each step above panned twice, the real wheel and the checked one), so
  // Rozpočet is on the canvas for the next steps.
  await page.mouse.move(e.x, e.y);
  await page.mouse.wheel(-280, -160);
  await sleep(250);
  // Over a node: the same pan; Rozpočet isn't selected anew, previewed or opened by it.
  await page.mouse.move(1, 1);
  await clickNode(page, P.zapis);
  await must(shown(page, P.zapis), 'Zápis selected');
  const rc = await wholePixelCentre(page, P.rozpocet);
  await page.mouse.move(rc.x, rc.y);
  const a = await positions(page);
  await page.mouse.wheel(0, 120);
  await sleep(250);
  assert.deepEqual(movedBy(a, await positions(page), 0, -120), [], 'over a node (Rozpočet) the wheel pans the same way');
  assert.deepEqual(await selected(page), [nfc(P.zapis)], 'it doesn\'t select Rozpočet (the selection stays)');
  await must(shown(page, P.zapis), 'and keeps the column on Zápis');
  // At 250 % the move is the same in screen pixels.
  const z = Math.log(2.5) / Math.log(1.25) * 120;
  const ec = await emptyPoint(page);
  await wheelAt(page, ec.x, ec.y, 0, -z, { meta: true });
  await sleep(250);
  assert.ok(Math.abs((await scaleOf(page)) - 2.5) < 0.02, `⌘-wheel to 250 % (got ${await scaleOf(page)})`);
  await page.mouse.move(ec.x, ec.y);
  const a2 = await positions(page);
  await page.mouse.wheel(80, 0);
  await sleep(250);
  assert.deepEqual(movedBy(a2, await positions(page), -80, 0), [], 'at 250 % a (80, 0) wheel moves the drawing by (−80, 0) screen pixels');
  assert.equal(await scrolls(page), sc0, 'nothing behind the canvas scrolls (window and centre pane scrollTop / scrollLeft)');
  // A horizontal wheel never goes Back.
  const back0 = await page.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled');
  await page.mouse.wheel(-400, 0);
  await sleep(500);
  assert.ok(await seen(canvas(page), 300), 'a horizontal wheel of (−400, 0) pans and never goes Back (D-1168)');
  assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled'), back0, 'the history is unchanged');
  assert.equal(await navCount(core), n0, 'no nav_opened');
  assert.equal((await core.graphCalls()).length, g0, 'panning sends no graph_neighbourhood');
  assert.equal((await callsOf(core, 'ui_state_set')).length, u0, 'and no ui_state_set (the camera isn\'t stored, D-913)');
  // Over the preview column the wheel doesn't pan.
  const col = (await (await must(previewCol(page), 'the column')).boundingBox())!;
  await page.mouse.move(col.x + col.width / 2, col.y + col.height / 2);
  const a3 = await positions(page);
  await page.mouse.wheel(0, 120);
  await sleep(250);
  assert.deepEqual(movedBy(a3, await positions(page), 0, 0, 0.5), [], 'over the preview column the wheel doesn\'t pan');
  // In the List view the wheel scrolls the tree, nothing else.
  await click(viewBtn(page, 'List'), 'View: List');
  const tree = await must(listTree(page), 'the List view');
  const tb = (await tree.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + 10);
  await page.mouse.wheel(0, 120);
  await sleep(250);
  assert.ok(await seen(listTree(page), 300), 'the List view stays');
  assert.equal(await navCount(core), n0, 'no navigation from the wheel over the tree');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-48

test('fr_grp_01_ac48_cmd_wheel_and_pinch_zoom_around_the_pointer', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  let p = await wholePixelCentre(page, P.rozpocet);
  const s0 = await scaleOf(page);
  const fixed = async (what: string, want: number) => {
    await sleep(250);
    const s = await scaleOf(page);
    assert.ok(Math.abs(s - want) < 0.01, `${what}: zoom ${want} (got ${s})`);
    const q = await centreOf(page, P.rozpocet);
    assert.ok(Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1, `${what}: Rozpočet's on-screen centre stays under the pointer (${JSON.stringify(p)} → ${JSON.stringify(q)})`);
  };
  assert.equal(await wheelAt(page, p.x, p.y, 0, -120, { meta: true }), true, '⌘-wheel is defaultPrevented');
  await fixed('⌘-wheel deltaY −120 (one step in, × 1.25, D-1179)', s0 * 1.25);
  await wheelAt(page, p.x, p.y, 0, 120, { meta: true });
  await fixed('⌘-wheel deltaY +120 (one step out)', s0);
  for (let i = 0; i < 20; i++) await wheelAt(page, p.x, p.y, 0, -120, { meta: true });
  await fixed('20 steps in', 4);
  for (let i = 0; i < 30; i++) await wheelAt(page, p.x, p.y, 0, 120, { meta: true });
  await fixed('30 steps out', 0.25);
  // Fit, then a pinch and a ctrl-wheel.
  await click(fitBtn(page), 'Fit to screen');
  await sleep(300);
  p = await wholePixelCentre(page, P.rozpocet);
  const s1 = await scaleOf(page);
  const pv = await pinchAt(page, p.x, p.y, 1.25);
  assert.deepEqual(pv.slice(0, 2), [true, true], 'gesturestart and gesturechange are defaultPrevented');
  await fixed('a pinch with scale 1.25', s1 * 1.25);
  await pinchAt(page, p.x, p.y, 0.8);
  await fixed('a pinch with scale 0.8 back', s1);
  assert.equal(await wheelAt(page, p.x, p.y, 0, -120, { ctrl: true }), true, 'a ctrl-wheel is defaultPrevented');
  await fixed('a ctrl-wheel deltaY −120 does what the ⌘-wheel does', s1 * 1.25);
  assert.equal(await page.evaluate(() => window.visualViewport?.scale ?? 1), 1, 'WebKit doesn\'t zoom the page (visualViewport.scale 1)');
  // The buttons and keys keep zooming around the canvas's centre.
  const c = (await (await must(canvas(page), 'the canvas')).boundingBox())!;
  const C = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  const a = await positions(page);
  await click(zoomIn(page), 'Zoom in');
  await sleep(250);
  const b = await positions(page);
  const off = Object.keys(a).filter((k) => b[k] && (Math.abs(b[k].x - (C.x + 1.25 * (a[k].x - C.x))) > 1.5 || Math.abs(b[k].y - (C.y + 1.25 * (a[k].y - C.y))) > 1.5));
  assert.deepEqual(off, [], '`Zoom in` zooms × 1.25 around the canvas\'s centre (D-985, R120)');
});

test('fr_grp_01_ac48_cmd_wheel_and_pinch_zoom_around_the_pointer_hide_a_hover_preview', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  await waitDrawn(page, 10);
  for (const [what, act] of [
    ['a ⌘-wheel', async (x: number, y: number) => { await wheelAt(page, x, y, 0, -120, { meta: true }); }],
    ['a pinch', async (x: number, y: number) => { await pinchAt(page, x, y, 1.25); }],
  ] as const) {
    await page.mouse.move(2, 2);
    await sleep(400);
    await pointAt(page, P.rozpocet);
    await must(shown(page, P.rozpocet), `${what}: Rozpočet's hover preview (setup)`, 2500);
    const q = await centreOf(page, P.rozpocet);
    await act(q.x, q.y);
    await sleep(150);
    assert.ok(!(await seen(anyShown(page), 150)), `${what} hides a hover preview (AP-941)`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-49

test('fr_grp_01_ac49_wheel_pans_and_zooms_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const core = await openPanel(page, P.plan, { previewMode: 'click' });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  const s = await pScale(page, P.plan);
  const tp = graphPanel(page);
  const tabTop = () => tp.first().evaluate((e) => (e as HTMLElement).scrollTop);
  const note0 = await page.evaluate(() => { const m = document.querySelector('main'); const sc = [m, ...(m ? [...m.querySelectorAll('*')] : [])].find((e) => e && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e as HTMLElement).overflowY)) as HTMLElement | undefined; const sel = getSelection(); return { top: sc?.scrollTop ?? -1, anchor: sel?.anchorOffset ?? -1 }; });
  const c = (await (await must(pCanvas(page), 'the panel canvas')).boundingBox())!;
  const e = { x: c.x + 6, y: c.y + 6 };
  await page.mouse.move(e.x, e.y);
  const g0 = (await core.graphCalls()).length, n0 = await navCount(core);
  for (const [dx, dy] of [[0, 120], [80, 0], [60, -40]] as const) {
    const a = await positions(page, GP(page));
    await page.mouse.wheel(dx, dy);
    await sleep(250);
    assert.deepEqual(movedBy(a, await positions(page, GP(page)), -dx, -dy), [], `panel: a wheel of (${dx}, ${dy}) pans by (${-dx}, ${-dy}) (AC-47 at scale s)`);
    assert.ok(Math.abs((await pScale(page, P.plan)) - s) < 0.005, `panel (${dx}, ${dy}): no zoom`);
  }
  await page.mouse.wheel(-400, 0);
  await sleep(500);
  assert.equal(await mainName(page), 'Plán čtvrtletí', 'a horizontal wheel never navigates');
  // D-1193: wheel back to the first-paint view, so Rozpočet is on the panel's canvas for the zoom steps.
  await page.mouse.move(e.x, e.y);
  await page.mouse.wheel(260, -80);
  await sleep(250);
  assert.equal(await navCount(core), n0, 'no nav_opened');
  assert.equal(await tabTop(), 0, 'the tab panel\'s scrollTop stays 0');
  const note1 = await page.evaluate(() => { const m = document.querySelector('main'); const sc = [m, ...(m ? [...m.querySelectorAll('*')] : [])].find((e) => e && (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e as HTMLElement).overflowY)) as HTMLElement | undefined; const sel = getSelection(); return { top: sc?.scrollTop ?? -1, anchor: sel?.anchorOffset ?? -1 }; });
  assert.deepEqual(note1, note0, 'the note\'s centre pane keeps its scrollTop and caret');
  // ⌘-wheel, ctrl-wheel and a pinch zoom around the pointer.
  let r = await wholePixelCentre(page, P.rozpocet, GP(page));
  const zoomed = async (what: string, want: number) => {
    await sleep(250);
    const got = await pScale(page, P.plan);
    assert.ok(Math.abs(got - want) < 0.01, `panel ${what}: zoom ${want} (got ${got})`);
    const q = await centreOf(page, P.rozpocet, GP(page));
    assert.ok(Math.abs(q.x - r.x) <= 1 && Math.abs(q.y - r.y) <= 1, `panel ${what}: around the pointer (${JSON.stringify(r)} → ${JSON.stringify(q)})`);
  };
  assert.equal(await wheelAt(page, r.x, r.y, 0, -120, { meta: true }), true, 'panel ⌘-wheel is defaultPrevented');
  await zoomed('⌘-wheel', s * 1.25);
  await wheelAt(page, r.x, r.y, 0, 120, { ctrl: true });
  await zoomed('ctrl-wheel', s);
  await pinchAt(page, r.x, r.y, 1.25);
  await zoomed('pinch', s * 1.25);
  for (let i = 0; i < 30; i++) await wheelAt(page, r.x, r.y, 0, -120, { meta: true });
  await sleep(250);
  assert.ok(Math.abs((await pScale(page, P.plan)) - 4) < 0.01, 'panel: at most 400 %');
  r = await centreOf(page, P.rozpocet, GP(page));
  for (let i = 0; i < 40; i++) await wheelAt(page, r.x, r.y, 0, 120, { meta: true });
  await sleep(250);
  assert.ok(Math.abs((await pScale(page, P.plan)) - 0.25) < 0.01, 'panel: at least 25 %');
  assert.equal((await core.graphCalls()).length, g0, 'no graph_neighbourhood');
  assert.equal(await core.writes(), 0, 'no write');
});

test('fr_grp_01_ac49_wheel_pans_and_zooms_the_panel_any_wheel_hides_a_hover_popover', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  await pPointAt(page, P.rozpocet);
  await mustPreview(page, ROZ, 'the panel\'s hover popover (setup)', 2500);
  const c = (await (await must(pCanvas(page), 'the panel canvas')).boundingBox())!;
  await page.mouse.move(c.x + 6, c.y + 6);
  await page.mouse.wheel(0, 40);
  await sleep(100);
  assert.equal(await anyPreviewDialog(page).count(), 0, 'a plain wheel over the canvas hides the hover popover at once (R126 as changed)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-35

/** Line samples inside `group`: svg / line / path elements, and thin elements drawn with a border or a background. */
async function samples(group: Locator): Promise<string[]> {
  return group.first().evaluate((g) => {
    const out: string[] = [];
    for (const e of g.querySelectorAll('*') as NodeListOf<HTMLElement>) {
      const tag = e.tagName.toLowerCase();
      if (tag === 'svg' || tag === 'line' || tag === 'path') { out.push(tag); continue; }
      if (tag === 'input' || e.getAttribute('role') === 'checkbox') continue;
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const bg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' || s.backgroundImage !== 'none';
      const border = ['Top', 'Bottom'].some((side) => parseFloat((s as any)[`border${side}Width`]) > 0 && (s as any)[`border${side}Style`] !== 'none');
      const thin = r.height <= 6 && r.width >= 8;
      if (thin && (bg || border)) out.push(`${tag}.${e.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}
async function onlyFour(group: Locator, where: string) {
  const names = await group.first().evaluate((g) => ([...g.querySelectorAll('input[type="checkbox"], [role="checkbox"]')] as HTMLElement[]).map((e) => {
    const id = e.getAttribute('id');
    return (e.getAttribute('aria-label') ?? (id ? document.querySelector(`label[for="${id}"]`)?.textContent : null) ?? e.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }));
  assert.deepEqual(names, ['Links', 'Relations', 'Embeds', 'Tags'], `${where}: exactly four checkboxes, each with its label`);
  assert.deepEqual(await samples(group), [], `${where}: no line sample (no svg, line, path, nor a border or background drawn as a line)`);
}

test('fr_grp_02_ac35_connections_without_line_samples', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  await onlyFour(await must(kindsGroup(page), 'the filter column\'s Connections fieldset'), 'the filter column');
  await depth2(page);
  await click(kindBox(page, 'Relations'), 'Relations off');
  assert.equal((await waitDrawn(page, 16)).length, 16, 'the toggles still hide (AC-3)');
  await click(kindBox(page, 'Relations'), 'Relations on');
  assert.equal((await waitDrawn(page, 19)).length, 19, 'and show');
  await page.setViewportSize({ width: 800, height: 500 });
  await click(filtersBtn(page), 'the Filters button at 800 × 500');
  await onlyFour(await must(kindsGroup(page), 'the Filters popover\'s Connections'), 'the Filters popover at 800 × 500');
});

test('fr_grp_02_ac35_connections_without_line_samples_in_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openPanel(page, P.plan, { previewMode: 'click' });
  await openPopover(page);
  await must(popover(page), 'the panel\'s Depth and filters popover');
  await onlyFour(await must(pKinds(page), 'its Connections fieldset'), 'the panel\'s Depth and filters popover');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-11

test('fr_grp_06_ac11_a_click_inside_the_graphs_preview_opens', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  const route = `note/${nfc(P.rozpocet)}`;
  const targets: [string, (col: Locator) => Locator][] = [
    ['the title', (col) => col.locator('h2').filter({ hasText: ROZ })],
    ['the line Projekt · 6 connections', (col) => col.getByText(/Projekt · 6 connections/)],
    ['the connection line', (col) => col.getByText(/Links to Plán čtvrtletí/)],
    ['the strip\'s Termín Dec 31, 2026', (col) => col.getByText('Dec 31, 2026', { exact: true })],
    ['the body', (col) => col.getByText('Rozpočet na příští rok.', { exact: true })],
  ];
  for (const [what, loc] of targets) {
    await clickNode(page, P.rozpocet);
    const col = await must(shown(page, P.rozpocet), `${what}: Rozpočet selected (a fresh selection)`);
    const before = await readyCount(core, route), n0 = await navCount(core);
    await (await must(loc(col), `${what} in the Preview column`)).click();
    assert.ok(await routeOnce(core, route, before), `${what}: a primary click opens note/Projekty/Rozpočet 2027.md (D-1165)`);
    assert.equal((await navCount(core)) - n0, 1, `${what}: one nav_opened`);
    await page.keyboard.press('Meta+BracketLeft');
    await waitDrawn(page, 10, 4000);
  }
  // Center graph here and Open keep their jobs.
  await clickNode(page, P.rozpocet);
  await click(centerHereBtn(page), 'Center graph here');
  assert.ok(await eventually(async () => flat(await main(page).innerText()), (t) => t.includes('Local graph of Rozpočet 2027'), 3000), 'Center graph here centres the graph');
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000);
  // #nápad: a click on `2 objects` opens tag/nápad and writes nothing.
  await clickNode(page, 'tag:nápad');
  const tcol = await must(previewCol(page), '#nápad\'s preview');
  const tb0 = [await readyCount(core, `tag/${encodeURIComponent('nápad')}`), await readyCount(core, 'tag/nápad')];
  await (await must(tcol.getByText(/^\d+ objects?$/), 'the count of #nápad')).click();
  const opened = await eventually(async () => [await readyCount(core, `tag/${encodeURIComponent('nápad')}`), await readyCount(core, 'tag/nápad')], (x) => x[0] > tb0[0] || x[1] > tb0[1], 4000);
  assert.ok(opened[0] > tb0[0] || opened[1] > tb0[1], 'a click on the tag preview\'s count opens tag/nápad');
  assert.equal(await core.writes(), 0, 'and writes nothing (no Tags/nápad.md)');
});

test('fr_grp_06_ac11_a_click_inside_the_graphs_preview_opens_in_hover_mode', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  await waitDrawn(page, 10);
  await pointAt(page, P.rozpocet);
  const prev = await must(shown(page, P.rozpocet), 'Rozpočet\'s hover preview in the column', 2500);
  const body = await must(prev.getByText('Rozpočet na příští rok.', { exact: true }), 'its body');
  const bb = (await body.boundingBox())!;
  await page.mouse.move(bb.x + 4, bb.y + bb.height / 2, { steps: 8 });
  const route = `note/${nfc(P.rozpocet)}`;
  const before = await readyCount(core, route), n0 = await navCount(core);
  await page.mouse.click(bb.x + 4, bb.y + bb.height / 2);
  assert.ok(await routeOnce(core, route, before), 'hover mode: a click on the hover preview\'s body opens Rozpočet (no clicked-preview state)');
  assert.equal((await navCount(core)) - n0, 1, 'one nav_opened');
});

test('fr_grp_06_ac11_a_click_inside_the_graphs_preview_opens_in_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const core = await openPanel(page, P.plan, { previewMode: 'click' });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  await clickNode(page, P.rozpocet, {}, GP(page));
  const d = await mustPreview(page, ROZ, 'the panel\'s preview of Rozpočet');
  const n0 = await navCount(core);
  await (await must(d.getByText('Rozpočet na příští rok.', { exact: true }), 'its body')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === ROZ, 4000), ROZ, 'a click on the body opens Rozpočet in the centre pane');
  assert.equal((await navCount(core)) - n0, 1, 'one nav_opened');
  assert.equal((await eventually(() => drawn(page, GP(page)), (x) => x.length === 7, 4000)).length, 7, 'the panel then shows Rozpočet\'s 7 nodes (FR-GRP-03 AC-7)');
  // On the centre node: the click on Plán's preview body is the same as its Open.
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back to Plán');
  await eventually(() => drawn(page, GP(page)), (x) => x.length === 10, 4000);
  await clickNode(page, P.plan, {}, GP(page));
  let dp = await mustPreview(page, 'Plán čtvrtletí', 'the centre node\'s preview');
  const m0 = (await core.calls()).length;
  await (await must(dp.getByRole('button', { name: 'Open Plán čtvrtletí', exact: true }), 'its Open')).click();
  await sleep(800);
  const viaOpen = { name: await mainName(page), navs: (await core.calls()).slice(m0).filter((c) => c.cmd === 'nav_opened').length, back: await page.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled') };
  await clickNode(page, P.plan, {}, GP(page));
  dp = await mustPreview(page, 'Plán čtvrtletí', 'the centre node\'s preview again');
  const m1 = (await core.calls()).length;
  const pb = await must(dp.locator('article').first(), 'its body');
  const pbb = (await pb.boundingBox())!;
  await page.mouse.click(pbb.x + 6, pbb.y + 6);
  await sleep(800);
  const viaClick = { name: await mainName(page), navs: (await core.calls()).slice(m1).filter((c) => c.cmd === 'nav_opened').length, back: await page.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled') };
  assert.deepEqual(viaClick, viaOpen, 'a click on the centre\'s preview body leaves the same route, history and nav_opened calls as its Open');
  assert.equal(await anyPreviewDialog(page).count(), 0, 'and closes the popover');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-12

test('fr_grp_06_ac12_links_in_the_graphs_preview_follow_hover_mode', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400, install: true });
  await waitDrawn(page, 10);
  await pauseClock(page);
  await pointAt(page, P.rozpocet);
  await tick(page, 450);
  const prev = await must(shown(page, P.rozpocet), 'Rozpočet\'s hover preview in the column');
  const chip = await must(prev.getByRole('link', { name: 'Jana Nováková', exact: true }), 'the strip chip Jana Nováková');
  const cb = (await chip.boundingBox())!;
  await page.mouse.move(cb.x + 4, cb.y + cb.height / 2, { steps: 8 });
  const sel0 = await selected(page);
  const op0 = await opacity(page, P.den);
  await tick(page, 340);
  assert.ok(await seen(shown(page, P.rozpocet), 200), 'not replaced before the delay');
  await tick(page, 110);
  await must(shown(page, P.jana), 'resting on the strip chip for 400 ms (± 50 ms) replaces the column\'s content with Jana\'s preview (D-1170)');
  await must(previewCol(page).getByRole('button', { name: 'Back to Rozpočet 2027', exact: true }), 'with Back to Rozpočet 2027');
  assert.deepEqual(await selected(page), sel0, 'the canvas\'s selection is unchanged');
  assert.equal(await opacity(page, P.den), op0, 'and its highlight');
  // A click on the chip opens Jana.
  await page.mouse.move(2, 890);
  await tick(page, 600);
  await pointAt(page, P.rozpocet);
  await tick(page, 450);
  const prev2 = await must(shown(page, P.rozpocet), 'Rozpočet\'s hover preview again');
  const c2 = (await (await must(prev2.getByRole('link', { name: 'Jana Nováková', exact: true }), 'the chip again')).boundingBox())!;
  await page.mouse.move(c2.x + 4, c2.y + c2.height / 2, { steps: 8 });
  const before = await readyCount(core, `note/${nfc(P.jana)}`);
  await page.mouse.click(c2.x + 4, c2.y + c2.height / 2);
  await page.clock.resume(); // the open runs on the page's own timers and frames
  assert.ok(await routeOnce(core, `note/${nfc(P.jana)}`, before), 'a click on the chip opens note/Osoby/Jana Nováková.md');
});

test('fr_grp_06_ac12_links_in_the_graphs_preview_follow_hover_mode_in_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, install: true });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  await pauseClock(page);
  await pPointAt(page, P.rozpocet);
  await tick(page, 450);
  const d = await mustPreview(page, ROZ, 'Rozpočet\'s hover popover');
  const b0 = (await d.boundingBox())!;
  const chip = await must(d.getByRole('link', { name: 'Jana Nováková', exact: true }), 'the strip chip Jana Nováková');
  const cb = (await chip.boundingBox())!;
  await page.mouse.move(cb.x + 4, cb.y + cb.height / 2, { steps: 8 });
  await tick(page, 450);
  const dj = await mustPreview(page, 'Jana Nováková', 'resting on the chip replaces the popover\'s content (one popover)');
  const b1 = (await dj.boundingBox())!;
  assert.ok(Math.abs(b1.x - b0.x) <= 1 && Math.abs(b1.y - b0.y) <= 1, `in the same place (${JSON.stringify([b0, b1])})`);
  await must(dj.getByRole('button', { name: 'Back to Rozpočet 2027', exact: true }), 'with Back to Rozpočet 2027');
  void core;
});

test('fr_grp_06_ac12_links_in_the_graphs_preview_follow_hover_mode_click_mode_unchanged', async ({ page }) => {
  await openGraph(page, P.plan, { previewMode: 'click' });
  await waitDrawn(page, 10);
  await clickNode(page, P.rozpocet);
  const prev = await must(shown(page, P.rozpocet), 'Rozpočet\'s preview');
  await (await must(prev.getByRole('link', { name: 'Jana Nováková', exact: true }), 'the strip chip')).click();
  await must(shown(page, P.jana), 'click mode: a click on the chip replaces the content (D-932)');
  await must(previewCol(page).getByRole('button', { name: 'Back to Rozpočet 2027', exact: true }), 'with Back to Rozpočet 2027');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-21

test('fr_lnk_12_ac21_graph_default_hover_with_1000_ms', async ({ page }) => {
  const core = await openGraph(page, P.plan, { install: true });
  await waitDrawn(page, 10);
  await must(hint(page, 'Hover to preview · click to open'), 'nothing stored: the hint `Hover to preview · click to open`');
  await must(previewCol(page).getByText('Hover over a node to preview it', { exact: true }), 'the empty column `Hover over a node to preview it`');
  await must(previewCol(page).getByText('Its neighbours are highlighted; click opens the object.', { exact: true }), 'and its note');
  await pauseClock(page);
  await pointAt(page, P.rozpocet);
  await sleep(80);
  await must(hoverRing(page), 'the ring around Rozpočet', 500);
  assert.deepEqual(await ringAnimations(page), [1000], 'one running animation of 1,000 ms (D-1164)');
  await tick(page, 950);
  assert.ok(!(await seen(anyShown(page), 100)), 'not at 950 ms');
  await tick(page, 100);
  await must(shown(page, P.rozpocet), 'the column shows Rozpočet\'s preview at 1,000 ms (± 50 ms)', 1000);
  await page.mouse.move(2, 890);
  await tick(page, 400);
  const before = await readyCount(core, `note/${nfc(P.rozpocet)}`);
  await clickNode(page, P.rozpocet);
  await page.clock.resume();
  assert.ok(await routeOnce(core, `note/${nfc(P.rozpocet)}`, before), 'a click on Rozpočet opens it');
});

test('fr_lnk_12_ac21_graph_default_hover_with_1000_ms_in_the_panel', async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openPanel(page, P.plan, { install: true });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  assert.ok(await pFooterIs(page, '10 objects · hover to preview'), `the footer \`10 objects · hover to preview\` (R128): ${await pFooterText(page)}`);
  await pauseClock(page);
  await pPointAt(page, P.rozpocet);
  await sleep(80);
  await must(pHoverRing(page), 'the panel ring', 500);
  assert.deepEqual(await pRingAnimations(page), [1000], 'the ring animates over 1,000 ms');
  await tick(page, 950);
  assert.equal(await anyPreviewDialog(page).count(), 0, 'no popover at 950 ms');
  await tick(page, 100);
  await mustPreview(page, ROZ, 'the popover at 1,000 ms (± 50 ms)', 1000);
  void ctxPanel;
});

test('fr_lnk_12_ac21_graph_default_hover_with_1000_ms_reduce_motion', async ({ page }) => {
  await openGraph(page, P.plan, { reducedMotion: 'reduce', realTime: true });
  await waitDrawn(page, 10);
  await pointAt(page, P.rozpocet);
  await must(hoverRing(page), 'nothing stored, Reduce motion: the ring', 1000);
  assert.deepEqual(await ringAnimations(page), [], 'the ring is drawn full at once (FR-UX-08 AC-4)');
});

test('fr_lnk_12_ac21_graph_default_hover_with_1000_ms_click_stored_stays', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'click', realTime: true });
  await waitDrawn(page, 10);
  await must(hint(page, 'Click to preview · double-click to open'), '`{ mode: "click" }` stored: click mode (FR-LNK-12 AC-8)');
  await sleep(500);
  const rewrites = (await callsOf(core, 'ui_state_set')).filter((c) => JSON.stringify((c.args as any)?.state?.preview ?? null) !== JSON.stringify({ mode: 'click' }));
  assert.deepEqual(rewrites.map((c) => (c.args as any)?.state?.preview ?? null), [], 'nothing is rewritten');
});

void openBtn; void nodeOf; void ctxPanel;
