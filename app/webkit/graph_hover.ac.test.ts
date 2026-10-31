// Slice G3, L5 (WebKit + fake core): the Object preview setting in the full graph view (docs/acceptance/graph.md part
// two, R120, AP-941…AP-943; replaces G1's interim rule D-983): FR-LNK-12 AC-8 (click mode as in G1), AC-9 (hover: the
// ring over the delay, then the same preview in the column), AC-10 (staying, replacing, hiding; D-942), AC-11 (hover:
// click opens), AC-12 (Off), AC-13 (a mode change applies at once), FR-UX-08 AC-4 (the hover ring under Reduce
// motion) and FR-UX-03 AC-26's hover case (Esc hides a hover preview first). Timing with an installed clock
// (`page.clock.install`, paused; as slice P's hover tests). Interface docs/contracts/v1-graph.md §16.3, §16.5 and
// v1-previews.md §7 (the preview in the column). Written from the ACs and the contracts only (D-61); every lookup goes
// through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, callsOf, canvas, clickEmpty, clickNode, drawn, eventually, filters, focused, hint, hoverRing, main, must, nfc, nodeOf, opacity,
  openGraph, pauseClock, pointAt, previewCol, ringAnimations, routeReady, runCommand, seen, sleep, tokenColour, waitDrawn,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const shown = (page: Page, path: string) => previewCol(page).locator(`[data-preview-path="${nfc(path)}"]`);
const anyShown = (page: Page) => previewCol(page).locator('[data-preview-path]');
const selected = async (page: Page) => (await drawn(page)).filter((n) => n.selected).map((n) => n.key);
const embedLoads = async (core: Awaited<ReturnType<typeof openGraph>>) => (await callsOf(core, 'embed_load')).length;
/** Advances the paused clock and lets the page render. */
async function tick(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await sleep(120);
}
async function hoverOpen(page: Page, delay = 400) {
  return openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: delay, install: true });
}
/** A point outside the canvas and the preview column (the filter column's empty bottom, else the window corner). */
async function outside(page: Page): Promise<{ x: number; y: number }> {
  const f = await filters(page).boundingBox().catch(() => null);
  return f ? { x: f.x + 8, y: f.y + f.height - 8 } : { x: 2, y: 890 };
}

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-8

test('fr_lnk_12_ac8_graph_click_mode', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  await pointAt(page, P.rozpocet);
  await must(hoverRing(page), 'reference: hover mode draws the ring (G3)', 1000);
  await runCommand(page, 'Object preview: Click to preview');
  await must(hint(page, 'Click to preview · double-click to open'), 'click mode\'s hint');
  await page.mouse.move(5, 5);
  await pointAt(page, P.rozpocet);
  await sleep(2000);
  assert.ok(!(await seen(hoverRing(page), 200)), 'resting for 2 s shows no ring');
  assert.ok(!(await seen(anyShown(page), 200)), 'and no preview');
  assert.equal(await eventually(() => opacity(page, P.den), (x) => x === 0.3, 1000), 0.3, 'the hover highlight only (Den dimmed)');
  await clickNode(page, P.rozpocet);
  await must(shown(page, P.rozpocet), 'a click previews (FR-GRP-03 AC-1)');
  await clickNode(page, P.rozpocet, { double: true });
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a double-click opens (FR-GRP-03 AC-2)');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-9

for (const delay of [400, 800]) {
  test(`fr_lnk_12_ac9_graph_hover_ring_then_preview_${delay}`, async ({ page }) => {
    const core = await hoverOpen(page, delay);
    await must(hint(page, 'Hover to preview · click to open'), 'the hint in hover mode');
    const f0 = await focused(page);
    await pauseClock(page);
    const e0 = await embedLoads(core);
    await pointAt(page, P.rozpocet);
    await sleep(80);
    await must(hoverRing(page), 'the ring around Rozpočet at once', 500);
    assert.deepEqual(await ringAnimations(page), [delay], `one running animation of ${delay} ms`);
    await tick(page, delay - 50);
    assert.ok(!(await seen(anyShown(page), 100)), `not before ${delay} ms`);
    assert.equal(await embedLoads(core), e0, 'no embed_load before then');
    await tick(page, 100);
    await must(shown(page, P.rozpocet), `the column shows Rozpočet's preview at ${delay} ms (± 50 ms)`, 1000);
    assert.deepEqual(await selected(page), [], 'no node gets data-selected');
    assert.deepEqual(await focused(page), f0, 'the focus doesn\'t move');
  });
}

test('fr_lnk_12_ac9_graph_hover_ring_then_preview_leaving_early', async ({ page }) => {
  await hoverOpen(page);
  await pauseClock(page);
  await pointAt(page, P.rozpocet);
  await sleep(80);
  await must(hoverRing(page), 'the ring', 500);
  await tick(page, 200);
  const o = await outside(page);
  await page.mouse.move(o.x, o.y);
  await sleep(80);
  assert.ok(!(await seen(hoverRing(page), 200)), 'leaving before the delay removes the ring');
  await tick(page, 600);
  assert.ok(!(await seen(anyShown(page), 200)), 'and shows nothing');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-10

test('fr_lnk_12_ac10_graph_hover_stays_replaces_and_hides', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400, install: true, graph: { depth: 2 } });
  await waitDrawn(page, 19);
  await pauseClock(page);
  await pointAt(page, P.rozpocet);
  await tick(page, 450);
  const prev = await must(shown(page, P.rozpocet), 'Rozpočet\'s hover preview');
  const pb = (await prev.boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + 40, { steps: 8 });
  await tick(page, 600);
  await must(shown(page, P.rozpocet), 'moving across the canvas into the preview keeps it');
  await pointAt(page, P.jana);
  await tick(page, 450);
  await must(shown(page, P.jana), 'resting on Jana for the delay replaces it');
  const o = await outside(page);
  await page.mouse.move(o.x, o.y);
  await tick(page, 200);
  await must(shown(page, P.jana), 'still shown 200 ms after leaving the canvas and the column');
  await pointAt(page, P.jana);
  await tick(page, 50);
  await page.mouse.move(o.x, o.y);
  await tick(page, 250);
  await must(shown(page, P.jana), 'returning within 300 ms keeps it');
  await tick(page, 100);
  assert.ok(!(await seen(anyShown(page), 200)), 'hidden 300 ms (± 50 ms) after leaving both');
  await must(previewCol(page).getByText('Hover over a node to preview it', { exact: true }), 'the column\'s empty state in hover mode');
  await must(previewCol(page).getByText('Its neighbours are highlighted; click opens the object.', { exact: true }), 'and its note');
  const hiders: [string, () => Promise<void>][] = [
    ['Esc', async () => { await page.keyboard.press('Escape'); }],
    ['a click on empty canvas', async () => { await clickEmpty(page); }],
    ['a wheel', async () => { await page.mouse.wheel(0, 120); }],
    ['a pan', async () => {
      const c = (await (await must(canvas(page), 'the canvas')).boundingBox())!;
      await page.mouse.move(c.x + 10, c.y + 10); await page.mouse.down(); await page.mouse.move(c.x + 60, c.y + 40, { steps: 4 }); await page.mouse.up();
    }],
    ['a key with the focus in the graph', async () => { await nodeOf(page, P.plan).first().evaluate((e) => ((e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as SVGElement | null)?.focus()); await page.keyboard.press('ArrowRight'); }],
  ];
  for (const [what, act] of hiders) {
    await pointAt(page, P.rozpocet);
    await tick(page, 450);
    await must(shown(page, P.rozpocet), `${what}: the hover preview (setup)`);
    await act();
    await sleep(100);
    assert.ok(!(await seen(anyShown(page), 150)), `${what} hides it at once`);
  }
  await pointAt(page, P.rozpocet);
  await tick(page, 450);
  const p2 = await must(shown(page, P.rozpocet), 'the hover preview again');
  const b2 = (await p2.boundingBox())!;
  const n0 = (await callsOf(core, 'nav_opened')).length;
  await page.mouse.click(b2.x + b2.width / 2, b2.y + Math.min(80, b2.height / 2));
  await page.clock.resume(); // the open runs on the page's own timers and frames
  // D-1165: a click inside the hover preview opens the node's object (no clicked-preview state any more).
  assert.ok(await routeReady(core, `note/${nfc(P.rozpocet)}`), 'a click inside the hover preview opens note/Projekty/Rozpočet 2027.md');
  assert.deepEqual((await callsOf(core, 'nav_opened')).slice(n0).map((c) => nfc(String((c.args as any)?.path ?? ''))), [nfc(P.rozpocet)], 'one nav_opened');
});

test('fr_ux_03_ac26_escape_closes_then_leaves_hover', async ({ page }) => {
  await hoverOpen(page);
  await pauseClock(page);
  await nodeOf(page, P.plan).first().evaluate((e) => ((e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as SVGElement | null)?.focus());
  await pointAt(page, P.rozpocet);
  await tick(page, 450);
  await must(shown(page, P.rozpocet), 'a hover preview');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(anyShown(page), 300)), 'in hover mode Esc hides the hover preview first');
  assert.notEqual((await focused(page)).tag, 'h1', 'the focus doesn\'t leave the graph on that Esc');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-11

test('fr_lnk_12_ac11_graph_hover_click_opens', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400 });
  await must(hint(page, 'Hover to preview · click to open'), 'hover mode');
  await clickNode(page, P.rozpocet);
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a click on Rozpočet opens it');
  assert.equal((await callsOf(core, 'nav_opened')).length, 1, 'one nav_opened');
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000);
  assert.ok(!(await seen(anyShown(page), 200)), 'no preview');
  await clickNode(page, 'tag:nápad');
  assert.ok(await routeReady(core, `tag/${encodeURIComponent('nápad')}`, 4000) || await routeReady(core, 'tag/nápad', 200), 'a click on #nápad opens tag/nápad');
  assert.equal(await core.writes(), 0, 'and writes nothing');
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000);
  const pages = page.context().pages().length;
  await clickNode(page, P.zapis, { meta: true });
  assert.ok(await routeReady(core, `note/${P.zapis}`, 4000), '⌘-click opens in place (D-925)');
  assert.equal(page.context().pages().length, pages, 'no new window');
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000);
  await nodeOf(page, P.shrnuti).first().evaluate((e) => ((e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as SVGElement | null)?.focus());
  await page.keyboard.press('Alt+Space');
  await must(shown(page, P.shrnuti), '⌥Space previews in the column');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  assert.ok(await routeReady(core, `note/${P.shrnuti}`, 4000), '⏎ on the focused node opens');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-12

test('fr_lnk_12_ac12_graph_off_click_opens', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'off', realTime: true });
  await must(hint(page, 'Click to open'), 'the hint `Click to open`');
  await must(previewCol(page).getByText('Previews are off', { exact: true }), 'the column: `Previews are off`');
  await must(previewCol(page).getByText('Press ⌥Space on a focused node to preview it.', { exact: true }), 'and its note');
  const e0 = (await callsOf(core, 'embed_load')).length;
  await pointAt(page, P.rozpocet);
  await sleep(1600);
  assert.ok(!(await seen(hoverRing(page), 200)), 'resting: no ring');
  assert.ok(!(await seen(anyShown(page), 200)), 'no preview');
  assert.equal((await callsOf(core, 'embed_load')).length, e0, 'no embed_load');
  assert.equal(await eventually(() => opacity(page, P.den), (x) => x === 0.3, 1000), 0.3, 'the hover highlight only');
  await nodeOf(page, P.rozpocet).first().evaluate((e) => ((e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as SVGElement | null)?.focus());
  await page.keyboard.press('Alt+Space');
  await must(shown(page, P.rozpocet), '⌥Space on the focused node previews it in the column (D-928)');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(anyShown(page), 500)), 'Esc closes it');
  await clickNode(page, P.rozpocet);
  assert.ok(await routeReady(core, `note/${P.rozpocet}`, 4000), 'a click opens');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-13

test('fr_lnk_12_ac13_graph_follows_mode_changes', async ({ page }) => {
  // D-1192: the delay is stored at 400 ms first (the default is 1,000 ms, D-1164); click mode as D-1164's test rule.
  await openGraph(page, P.plan, { realTime: true, hoverDelay: 400 });
  await clickNode(page, P.rozpocet);
  await must(shown(page, P.rozpocet), 'a clicked preview (setup)');
  await runCommand(page, 'Object preview: Hover to preview');
  await must(hint(page, 'Hover to preview · click to open'), 'the hint changes without a reload');
  assert.ok(!(await seen(anyShown(page), 500)), 'a shown preview closes');
  await pointAt(page, P.zapis);
  await must(hoverRing(page), 'the next pointer input follows the new mode (the ring)', 1000);
  await must(shown(page, P.zapis), 'and its preview after the delay', 1500);
  await runCommand(page, 'Object preview: Off');
  await must(hint(page, 'Click to open'), 'Off');
  await runCommand(page, 'Object preview: Hover to preview');
  await page.mouse.move(5, 5);
  await pointAt(page, P.shrnuti);
  await sleep(80);
  assert.equal((await ringAnimations(page))[0] ?? 0, 400, 'the stored delay (400 ms) until the setting changes');
});

test('fr_lnk_12_ac13_graph_follows_mode_changes_delay_setting', async ({ page }) => {
  const core = await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400, realTime: true });
  await pointAt(page, P.rozpocet);
  await must(hoverRing(page), 'hover mode (setup)', 1000);
  await page.mouse.move(5, 5);
  await runCommand(page, 'Go to Settings: Previews');
  const slider = main(page).getByRole('slider', { name: /^⟦?Hover delay⟧?$/ });
  const sl = await must(slider, 'Settings › Previews: the `Hover delay` slider', 3000);
  await sl.focus();
  await page.keyboard.press('Home');
  await eventually(async () => ((await core.uiState()) as any)?.preview?.hoverDelay, (d) => d === 200, 2000);
  await page.keyboard.press('Meta+BracketLeft');
  await waitDrawn(page, 10, 4000);
  await pointAt(page, P.zapis);
  await sleep(80);
  assert.deepEqual(await ringAnimations(page), [200], 'the 200 ms delay applies to the next hover');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-4 (ring)

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`fr_ux_08_ac4_reduce_motion_for_ring_and_pan_ring_${motion.replace('-', '_')}`, async ({ page }) => {
    await openGraph(page, P.plan, { previewMode: 'hover', hoverDelay: 400, reducedMotion: motion, realTime: true });
    await pointAt(page, P.rozpocet);
    const ring = await must(hoverRing(page), 'the hover ring', 1000);
    const hl = await tokenColour(page, 'hl');
    const paint = await ring.evaluate((e) => {
      const s = getComputedStyle(e.matches('circle, rect, path') ? e : (e.querySelector('circle, rect, path') ?? e));
      return { stroke: s.stroke, width: s.strokeWidth, dash: s.strokeDasharray, offset: s.strokeDashoffset };
    });
    assert.deepEqual([paint.stroke, paint.width], [hl, '2.5px'], '2.5 px in --hl (R120)');
    if (motion === 'reduce') {
      assert.deepEqual(await ringAnimations(page), [], 'Reduce motion: no running animation');
      assert.ok(paint.dash === 'none' || parseFloat(paint.offset || '0') === 0, `drawn full at once (${paint.dash} / ${paint.offset})`);
    } else {
      assert.deepEqual(await ringAnimations(page), [400], 'without it: one animation over the delay');
    }
  });
}
