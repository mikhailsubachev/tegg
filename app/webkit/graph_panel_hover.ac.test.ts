// Slice "G3 in the panel", L5 (WebKit + fake core): the Object preview setting in the right panel's graph
// (docs/acceptance/graph-panel-g3.md R125, R126; replaces D-983 in the panel): FR-LNK-12 AC-14 (click mode as G2),
// AC-15 (hover: the ring at the panel scale, then the popover), AC-16 (the standard 300 ms grace, not the column rule;
// AP-941, AP-970), AC-17 (hover and Off: a click opens; AP-943), AC-18 (a mode change applies at once; AP-973) and
// FR-UX-08 AC-14 (the focus ring, Reduce motion). Timing on the page clock (`page.clock.install`, paused; D-1118).
// Interface docs/contracts/v1-graph.md §17.4 (`graphHover(host, { grace: 'popover' })`) and v1-previews.md §3.3 (the
// popover beside the panel). Written from the ACs and the contracts only (D-61); every lookup goes through `must`/`seen`
// and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { anyPreviewDialog, mustPreview } from './helpers';
import {
  P, callsOf, clickNode, drawn, eventually, flat, graphHeading, main, mainName, marks, must, nfc, nodeOf, opacity, previewCol, runCommand, seen,
  sleep, tokenColour, waitDrawn,
} from './graph-helpers';
import {
  GP, VIEWPORT, ctxPanel, navCount, openPanel, openPopover, pCanvas, pFocusNode, pFocused, pFooterIs, pFooterText, pHoverRing, pListTree, pPointAt,
  pRingAnimations, popover, tagRoute,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

type Core = Awaited<ReturnType<typeof openPanel>>;
const D1 = [P.plan, P.rozpocet, P.zapis, P.shrnuti, P.graf, P.ukol, P.den, 'tag:účty', 'tag:nápad', P.recept].map(nfc);
const selectedIn = async (page: Page) => (await drawn(page, GP(page))).filter((n) => n.selected).map((n) => n.key);
const embedLoads = async (core: Core) => (await callsOf(core, 'embed_load')).length;
const routeMarks = async (core: Core) => (await marks(core)).filter((m) => m.startsWith('route-ready:'));
const noPreview = async (page: Page, ms = 200) => { await sleep(ms); return (await anyPreviewDialog(page).count()) === 0; };
async function tick(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await sleep(120);
}
async function pauseClock(page: Page) {
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(t + 1000));
}
async function hoverPanel(page: Page, delay = 400, o: Record<string, unknown> = {}) {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: delay, install: true, ...o });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán in the panel');
  return core;
}
/** The empty top-left corner of the panel canvas. */
async function emptySpot(page: Page) {
  const c = (await (await must(pCanvas(page), 'the panel canvas')).boundingBox())!;
  return { x: c.x + 6, y: c.y + 6 };
}
/** The main shape's diameter of a panel node and of its hover ring (their boxes, no stroke). */
async function ringGeometry(page: Page, k: string) {
  return GP(page).evaluate((m, key) => {
    const ring = m.querySelector('[data-hover-ring]') as SVGGraphicsElement | null;
    const g = ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).find((e) => (e.getAttribute('data-path') ?? `tag:${e.getAttribute('data-tag-key') ?? ''}`).normalize('NFC') === key);
    if (!ring || !g) return null;
    const shape = (ring.matches('circle, rect, path') ? ring : ring.querySelector('circle, rect, path')) as SVGGraphicsElement | null;
    const s = getComputedStyle(shape ?? ring);
    const rb = (shape ?? ring).getBoundingClientRect();
    const nb = (g.querySelector('circle, rect, ellipse') as SVGGraphicsElement).getBoundingClientRect();
    return { ring: rb.width, node: nb.width, stroke: s.stroke, width: s.strokeWidth, cx: rb.left + rb.width / 2, ncx: nb.left + nb.width / 2 };
  }, nfc(k));
}

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-14

test('fr_lnk_12_ac14_panel_click_mode', async ({ page }) => {
  // D-1111's pattern: first require G3's ring in the panel's hover mode, then switch to click mode by the palette.
  await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  await pPointAt(page, P.rozpocet);
  await must(pHoverRing(page), 'reference: hover mode draws the ring in the panel (G3 in the panel)', 1000);
  await runCommand(page, 'Object preview: Click to preview');
  assert.ok(await pFooterIs(page, '10 objects · click a node to preview'), `the footer \`10 objects · click a node to preview\` (${await pFooterText(page)})`);
  await page.mouse.move(5, 5);
  await pPointAt(page, P.rozpocet);
  await sleep(2000);
  assert.ok(!(await seen(pHoverRing(page), 200)), 'resting on Rozpočet for 2 s shows no ring');
  assert.ok(await noPreview(page), 'and no preview');
  const near = [P.rozpocet, P.plan, P.zapis, 'tag:účty'].map(nfc);
  for (const k of D1) {
    const want = near.includes(k) ? 1 : 0.3;
    assert.equal(await eventually(() => opacity(page, k, GP(page)), (x) => x === want, 1000), want, `${k}: opacity ${want} (Rozpočet and its 3 neighbours highlighted)`);
  }
  assert.deepEqual(await selectedIn(page), [], 'and selects nothing');
  await clickNode(page, P.rozpocet, {}, GP(page));
  await mustPreview(page, 'Rozpočet 2027', 'a click previews (graph-panel.md FR-GRP-03 AC-6)');
  assert.deepEqual(await selectedIn(page), [nfc(P.rozpocet)], 'and selects');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-15

for (const delay of [400, 800]) {
  test(`fr_lnk_12_ac15_panel_hover_ring_then_popover_${delay}`, async ({ page }) => {
    const core = await hoverPanel(page, delay);
    assert.ok(await pFooterIs(page, '10 objects · hover to preview'), `the footer \`10 objects · hover to preview\` (AP-964): ${await pFooterText(page)}`);
    const f0 = await pFocused(page);
    await pauseClock(page);
    const e0 = await embedLoads(core);
    await pPointAt(page, P.rozpocet);
    await sleep(80);
    await must(pHoverRing(page), '`[data-hover-ring]` around Rozpočet at once', 500);
    const g = await ringGeometry(page, P.rozpocet);
    assert.ok(g && Math.abs(g.ring - 44) <= 0.5, `the ring 5 px outside the 34 px node: 44 px ± 0.5 (got ${g?.ring}, node ${g?.node})`);
    assert.deepEqual([g?.stroke, g?.width], [await tokenColour(page, 'hl'), '2.5px'], '`--hl`, 2.5 px');
    assert.deepEqual(await pRingAnimations(page), [delay], `one running animation of ${delay} ms`);
    await tick(page, delay - 50);
    assert.ok(await noPreview(page, 50), `no popover before ${delay} ms`);
    assert.equal(await embedLoads(core), e0, 'no embed_load before then');
    await tick(page, 100);
    const d = await mustPreview(page, 'Rozpočet 2027', `\`Preview: Rozpočet 2027\` at ${delay} ms (± 50 ms)`, 1000);
    assert.equal(nfc((await d.getAttribute('data-preview-path')) ?? ''), nfc(P.rozpocet), 'data-preview-path="Projekty/Rozpočet 2027.md"');
    assert.ok((await eventually(async () => flat(await d.innerText()), (t) => t.includes('Projekt · 6 connections'), 2000)).includes('Projekt · 6 connections'), 'FR-GRP-06 AC-6\'s content');
    const db = (await d.boundingBox())!, pb = (await ctxPanel(page).boundingBox())!;
    assert.ok(Math.abs(db.x + db.width - (pb.x - 8)) <= 1, 'left of the panel');
    assert.deepEqual(await selectedIn(page), [], 'no node gets data-selected');
    assert.deepEqual(await pFocused(page), f0, 'the focus doesn\'t move');
    assert.equal(await eventually(() => opacity(page, P.den, GP(page)), (x) => x === 0.3, 1000), 0.3, 'the hover highlight shows (Den dimmed)');
  });
}

test('fr_lnk_12_ac15_panel_hover_ring_then_popover_leaving_early', async ({ page }) => {
  await hoverPanel(page);
  await pauseClock(page);
  await pPointAt(page, P.rozpocet);
  await sleep(80);
  await must(pHoverRing(page), 'the ring', 500);
  await tick(page, 200);
  await page.mouse.move(5, 5);
  await sleep(80);
  assert.ok(!(await seen(pHoverRing(page), 200)), 'leaving before 400 ms removes the ring');
  await tick(page, 600);
  assert.ok(await noPreview(page), 'and opens nothing');
});

test('fr_lnk_12_ac15_panel_hover_ring_then_popover_centre_and_tag', async ({ page }) => {
  const core = await hoverPanel(page);
  await pauseClock(page);
  await pPointAt(page, P.plan);
  await sleep(80);
  const g = await ringGeometry(page, P.plan);
  assert.ok(g && Math.abs(g.ring - 62) <= 0.5, `on the centre the ring is 62 px (${g?.ring})`);
  await tick(page, 450);
  const d = await mustPreview(page, 'Plán čtvrtletí', 'on the centre the popover is Plán\'s');
  assert.ok((await eventually(async () => flat(await d.innerText()), (t) => t.includes('Page · 9 connections'), 2000)).includes('Page · 9 connections'), '`Page · 9 connections`');
  await page.mouse.move(5, 5);
  await tick(page, 400);
  await pPointAt(page, 'tag:nápad');
  await sleep(80);
  const pill = await ringGeometry(page, 'tag:nápad');
  assert.ok(pill && Math.abs(pill.ring - (pill.node + 8)) <= 0.5, `on a pill a rounded rectangle 4 px outside it (${pill?.ring} vs ${pill?.node})`);
  await tick(page, 450);
  const t = await mustPreview(page, '#nápad', 'the neutral tag preview');
  assert.ok((await eventually(async () => flat(await t.innerText()), (x) => x.includes('2 objects'), 2000)).includes('2 objects'), 'with its objects');
  assert.equal(await core.writes(), 0, 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-16

test('fr_lnk_12_ac16_panel_hover_grace_and_hiding', async ({ page }) => {
  const core = await hoverPanel(page);
  await pauseClock(page);
  await pPointAt(page, P.rozpocet);
  await tick(page, 450);
  const d = await mustPreview(page, 'Rozpočet 2027', 'Rozpočet\'s hover popover');
  const db = (await d.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + 40, { steps: 6 });
  await tick(page, 600);
  await mustPreview(page, 'Rozpočet 2027', 'from the node straight onto the popover: it stays');
  const n0 = await navCount(core);
  await page.mouse.click(db.x + db.width / 2, db.y + Math.min(80, db.height / 2));
  await page.clock.resume(); // the open runs on the page's own timers and frames
  // D-1165: a click inside the hover popover opens Rozpočet in the centre pane (no clicked-preview state any more).
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', 'a click inside its body opens Rozpočet');
  assert.equal((await navCount(core)) - n0, 1, 'one nav_opened');
  assert.equal((await eventually(() => drawn(page, GP(page)), (x) => x.length === 7, 4000)).length, 7, 'the panel then shows Rozpočet\'s 7 nodes');
  assert.ok(await noPreview(page, 100), 'and the popover is closed');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back to Plán');
  assert.equal((await eventually(() => drawn(page, GP(page)), (x) => x.length === 10, 4000)).length, 10, 'Plán in the panel again');
  await pauseClock(page);
  // From the node onto the empty canvas: hidden 300 ms (± 50 ms) after leaving the node (not the column rule).
  const e = await emptySpot(page);
  await pPointAt(page, P.rozpocet);
  await tick(page, 450);
  await mustPreview(page, 'Rozpočet 2027', 'the hover popover again');
  await page.mouse.move(e.x, e.y);
  await tick(page, 200);
  await mustPreview(page, 'Rozpočet 2027', 'still shown 200 ms after leaving the node');
  await pPointAt(page, P.rozpocet);
  await tick(page, 50);
  await page.mouse.move(e.x, e.y);
  await tick(page, 250);
  await mustPreview(page, 'Rozpočet 2027', 'returning to the node within 300 ms keeps it');
  await tick(page, 100);
  assert.ok(await noPreview(page), 'resting on the empty canvas hides it 300 ms (± 50 ms) after the pointer left the node (AP-941)');
  await pPointAt(page, P.rozpocet);
  await tick(page, 450);
  await mustPreview(page, 'Rozpočet 2027', 'again');
  await pPointAt(page, P.zapis);
  await sleep(80);
  const z = await ringGeometry(page, P.zapis);
  assert.ok(z && Math.abs(z.cx - z.ncx) <= 1, 'Zápis\'s ring');
  await tick(page, 450);
  await mustPreview(page, 'Zápis z porady', 'resting on Zápis for the delay replaces it (one popover)');
  const hiders: [string, () => Promise<void>][] = [
    ['Esc', async () => { await page.keyboard.press('Escape'); }],
    ['a click on the empty canvas', async () => { await page.mouse.click(e.x, e.y); }],
    ['a key with the focus in the panel graph', async () => { await pFocusNode(page, P.plan); await page.keyboard.press('ArrowRight'); }],
    ['a ⌘-scroll', async () => { await page.keyboard.down('Meta'); await page.mouse.wheel(0, -120); await page.keyboard.up('Meta'); }],
    ['a pan', async () => { await page.mouse.move(e.x, e.y); await page.mouse.down(); await page.mouse.move(e.x + 40, e.y + 30, { steps: 4 }); await page.mouse.up(); }],
  ];
  for (const [what, act] of hiders) {
    await pPointAt(page, P.rozpocet);
    await tick(page, 450);
    await mustPreview(page, 'Rozpočet 2027', `${what}: the hover popover (setup)`);
    await act();
    await sleep(100);
    assert.ok(await noPreview(page, 50), `${what} hides it at once`);
  }
});

test('fr_lnk_12_ac16_panel_hover_grace_and_hiding_filters_open', async ({ page }) => {
  const core = await hoverPanel(page);
  await pauseClock(page);
  await pPointAt(page, P.zapis);
  await must(pHoverRing(page), 'reference: with the popover closed, resting on a node draws the ring (G3 in the panel)', 500);
  await page.mouse.move(5, 5);
  await tick(page, 400);
  await openPopover(page);
  const e0 = await embedLoads(core);
  await pPointAt(page, P.rozpocet);
  await sleep(80);
  assert.ok(!(await seen(pHoverRing(page), 200)), 'with `Depth and filters` open: no ring (AP-970)');
  await tick(page, 600);
  assert.ok(await noPreview(page), 'no popover');
  assert.equal(await embedLoads(core), e0, 'no embed_load');
  assert.equal(await eventually(() => opacity(page, P.den, GP(page)), (x) => x === 0.3, 1000), 0.3, 'the hover highlight only');
  assert.ok(await seen(popover(page), 200), 'the filters popover stays open');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-17

for (const mode of ['hover', 'off'] as const) {
  test(`fr_lnk_12_ac17_panel_hover_and_off_click_opens_${mode}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { previewMode: mode, hoverDelay: 400, realTime: true });
    assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán');
    if (mode === 'off') assert.ok(await pFooterIs(page, '10 objects · click to open'), `Off: the footer \`10 objects · click to open\` (${await pFooterText(page)})`);
    else assert.ok(await pFooterIs(page, '10 objects · hover to preview'), `hover: the footer \`10 objects · hover to preview\` (${await pFooterText(page)})`);
    const back = async () => {
      await page.keyboard.press('Meta+BracketLeft');
      assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on Plán');
      await waitDrawn(page, 10, 4000, GP(page));
    };
    for (const how of [{}, { meta: true }, { double: true }] as const) {
      const n0 = await navCount(core);
      await clickNode(page, P.rozpocet, how, GP(page));
      assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', `${mode} ${JSON.stringify(how)}: opens note/Projekty/Rozpočet 2027.md`);
      assert.equal((await navCount(core)) - n0, 1, 'with one nav_opened');
      assert.ok(await noPreview(page, 100), 'and no preview');
      assert.equal((await waitDrawn(page, 7, 3000, GP(page))).length, 7, 'the panel then shows Rozpočet\'s 7 nodes');
      await back();
    }
    await clickNode(page, 'tag:nápad', {}, GP(page));
    assert.ok(await eventually(async () => (await routeMarks(core)).map(nfc).some((m) => m === `route-ready:${tagRoute('nápad')}` || m === nfc('route-ready:tag/nápad')), (x) => x, 4000), 'a click on #nápad opens tag/nápad');
    assert.ok(!(await seen(ctxPanel(page), 500)), 'no panel there');
    assert.equal(await core.writes(), 0, 'and writes nothing');
    await back();
    const n1 = await navCount(core), r1 = (await routeMarks(core)).length;
    for (const how of [{}, { double: true }, { meta: true }] as const) await clickNode(page, P.plan, how, GP(page));
    await sleep(700);
    assert.deepEqual([(await navCount(core)) - n1, (await routeMarks(core)).length - r1], [0, 0], 'a click, double-click or ⌘-click on the centre does nothing (D-1042)');
    assert.ok(await noPreview(page, 50), 'not even a preview');
    if (mode === 'off') {
      const e0 = await embedLoads(core);
      await pPointAt(page, P.rozpocet);
      await sleep(1200);
      assert.ok(!(await seen(pHoverRing(page), 200)), 'Off: resting shows no ring');
      assert.ok(await noPreview(page), 'no popover');
      assert.equal(await embedLoads(core), e0, 'no embed_load');
      assert.equal(await eventually(() => opacity(page, P.den, GP(page)), (x) => x === 0.3, 1000), 0.3, 'the hover highlight only');
      await pFocusNode(page, P.rozpocet);
      await page.keyboard.press('Alt+Space');
      const d = await mustPreview(page, 'Rozpočet 2027', 'Off: ⌥Space on the focused Rozpočet opens its popover');
      assert.ok((await eventually(async () => flat(await d.innerText()), (t) => t.includes('⌘↩ to open'), 2000)).includes('⌘↩ to open'), 'with the footer `⌘↩ to open` (D-928)');
      await page.keyboard.press('Escape');
      assert.ok(await noPreview(page, 300), 'Esc closes it');
      assert.equal((await pFocused(page)).key, nfc(P.rozpocet), 'with the focus back on the node');
    }
  });
}

test('fr_lnk_12_ac17_panel_hover_and_off_click_opens_list_rows', async ({ page }) => {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, install: true, panel: { view: 'list' } });
  await must(pListTree(page), 'the panel\'s List');
  await pauseClock(page);
  const row = await must(pListTree(page).getByRole('treeitem', { name: /^Rozpočet 2027, / }), 'the Rozpočet row');
  const b = (await row.boundingBox())!;
  await page.mouse.move(b.x + 30, b.y + 8);
  await page.mouse.move(b.x + 32, b.y + 8);
  await sleep(80);
  assert.ok(!(await seen(GP(page).locator('[data-hover-ring]'), 200)), 'no ring on a row (R122)');
  await tick(page, 450);
  await mustPreview(page, 'Rozpočet 2027', 'resting on the row for the delay previews it');
  const n0 = await navCount(core);
  await page.mouse.click(b.x + 30, b.y + 8);
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', 'a click on the row opens it in hover mode');
  assert.equal((await navCount(core)) - n0, 1, 'one nav_opened');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-18

test('fr_lnk_12_ac18_panel_follows_mode_changes', async ({ page }) => {
  await openPanel(page, P.plan, { realTime: true, hoverDelay: 400 });
  assert.equal((await eventually(() => drawn(page, GP(page)), (d) => d.length === 10, 4000)).length, 10, 'Plán');
  await clickNode(page, P.rozpocet, {}, GP(page));
  await mustPreview(page, 'Rozpočet 2027', 'a clicked preview (setup)');
  await runCommand(page, 'Object preview: Hover to preview');
  assert.ok(await pFooterIs(page, '10 objects · hover to preview'), `the footer follows without a reload (${await pFooterText(page)})`);
  assert.ok(await noPreview(page, 300), 'a shown popover closes');
  assert.deepEqual(await selectedIn(page), [], 'and the selection clears');
  await page.mouse.move(5, 5);
  await pPointAt(page, P.zapis);
  await must(pHoverRing(page), 'the next pointer input follows the new mode (the ring)', 1000);
  await mustPreview(page, 'Zápis z porady', 'and its popover after the delay', 1500);
  await runCommand(page, 'Object preview: Off');
  assert.ok(await pFooterIs(page, '10 objects · click to open'), `Off: ${await pFooterText(page)}`);
  await runCommand(page, 'Object preview: Click to preview');
  assert.ok(await pFooterIs(page, '10 objects · click a node to preview'), `click mode: ${await pFooterText(page)}`);
});

test('fr_lnk_12_ac18_panel_follows_mode_changes_delay_setting', async ({ page }) => {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, realTime: true });
  await pPointAt(page, P.rozpocet);
  await must(pHoverRing(page), 'hover mode in the panel (setup)', 1000);
  await page.mouse.move(5, 5);
  await runCommand(page, 'Go to Settings: Previews');
  const sl = await must(main(page).getByRole('slider', { name: /^⟦?Hover delay⟧?$/ }), 'Settings › Previews: the `Hover delay` slider');
  await sl.focus();
  await page.keyboard.press('Home');
  await eventually(async () => ((await core.uiState()) as any)?.preview?.hoverDelay, (d) => d === 200, 2000);
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000, GP(page));
  await pPointAt(page, P.zapis);
  await sleep(80);
  assert.deepEqual(await pRingAnimations(page), [200], 'the 200 ms delay applies to the next hover in the panel');
});

test('fr_lnk_12_ac18_panel_follows_mode_changes_in_full_graph_from_hover', async ({ page }) => {
  const core = await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, realTime: true });
  await pPointAt(page, P.rozpocet);
  await must(pHoverRing(page), 'the ring', 1000);
  const d = await mustPreview(page, 'Rozpočet 2027', 'the hover popover', 1500);
  const r0 = (await routeMarks(core)).length;
  const btn = await must(d.getByRole('button', { name: 'In full graph', exact: true }), '`In full graph`');
  const bb = (await btn.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  assert.ok(await eventually(async () => (await routeMarks(core)).length > r0, (x) => x, 4000), 'the full view opens');
  await must(graphHeading(page), 'the full view', 4000);
  assert.deepEqual(await eventually(async () => (await drawn(page)).filter((n) => n.selected).map((n) => n.key), (s) => s.length > 0, 3000), [nfc(P.rozpocet)], 'with Rozpočet selected (AP-973)');
  await must(previewCol(page).locator(`[data-preview-path="${nfc(P.rozpocet)}"]`), 'and previewed in the column');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-14

/** The focus ring of a panel node: a shape stroked in `--focus` outside the node's shape (width, gap). */
async function focusRing(page: Page, k: string, focus: string): Promise<{ width: number; gap: number } | null> {
  return nodeOf(page, k, GP(page)).first().evaluate((e, f) => {
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
  test(`fr_ux_08_ac14_panel_focus_ring_and_reduce_motion_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPanel(page, P.plan, { theme });
    const focus = await tokenColour(page, 'focus');
    await pFocusNode(page, P.plan);
    await page.keyboard.press('ArrowRight');
    const k = (await pFocused(page)).key;
    assert.ok(k && k !== nfc(P.plan), `an arrow moves the keyboard focus to another panel node (${k})`);
    const ring = await focusRing(page, k!, focus);
    assert.ok(ring, `${theme}: the focused panel node has a ring in --focus`);
    assert.equal(ring!.width, 2.5, '2.5 px');
    assert.ok(Math.abs(ring!.gap - 3) <= 0.6, `a 3 px gap (${ring!.gap})`);
    await page.keyboard.press('Enter');
    assert.ok(await focusRing(page, k!, focus), 'also when it is selected');
    await page.keyboard.press('Escape');
    const ratios = await page.evaluate(async ([th, f]) => {
      const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
      const { ratio } = await import('/src/theme/contrast.ts' as string);
      const out: Record<string, number> = { canvas: ratio(tokens[f], tokens.canvas) };
      for (const key of Object.keys(tokens).filter((x) => /^type-[a-z]+-bg$/.test(x))) out[key] = ratio(tokens[f], tokens[key]);
      return out;
    }, [theme, 'focus'] as const);
    assert.deepEqual(Object.entries(ratios).filter(([, r]) => r < 3), [], `${theme}: --focus against --canvas and each type fill ≥ 3:1`);
    await clickNode(page, P.zapis, {}, GP(page));
    await page.keyboard.press('Escape');
    assert.equal(await focusRing(page, P.zapis, focus), null, 'hidden after a pointer press until the next key');
  });
}

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`fr_ux_08_ac14_panel_focus_ring_and_reduce_motion_${motion.replace('-', '_')}`, async ({ page }) => {
    await openPanel(page, P.plan, { previewMode: 'hover', hoverDelay: 400, reducedMotion: motion, realTime: true });
    await pPointAt(page, P.rozpocet);
    const ring = await must(pHoverRing(page), 'the panel\'s hover ring', 1000);
    const paint = await ring.evaluate((e) => {
      const s = getComputedStyle(e.matches('circle, rect, path') ? e : (e.querySelector('circle, rect, path') ?? e));
      return { dash: s.strokeDasharray, offset: s.strokeDashoffset };
    });
    if (motion === 'reduce') {
      assert.deepEqual(await pRingAnimations(page), [], 'Reduce motion: no running animation');
      assert.ok(paint.dash === 'none' || parseFloat(paint.offset || '0') === 0, `drawn full at once (${paint.dash} / ${paint.offset})`);
    } else {
      assert.deepEqual(await pRingAnimations(page), [400], 'without it: one animation over the delay');
    }
    await page.mouse.move(5, 5);
    // Panning a focused node into view is instant: zoom in, then move to an off-screen node.
    const box = (await (await must(pCanvas(page), 'the canvas')).boundingBox())!;
    await pFocusNode(page, P.plan);
    for (let i = 0; i < 8; i++) await page.keyboard.press('+');
    const before = (await pFocused(page)).key;
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const k = (await pFocused(page)).key;
    assert.ok(k && k !== before, 'the arrow moved the focus');
    const r = await nodeOf(page, k!, GP(page)).first().locator('circle, rect, ellipse').first().boundingBox();
    assert.ok(r && r.x >= box.x + 23 && r.x + r.width <= box.x + box.width - 23 && r.y >= box.y + 23 && r.y + r.height <= box.y + box.height - 23, `${motion}: the pan is instant (inside after two frames)`);
  });
}
