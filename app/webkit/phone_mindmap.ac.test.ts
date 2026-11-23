// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`; the pinch steps on Chromium only, contract §13.2):
// docs/acceptance/android-phone.md FR-MMP-02 AC-32 (drawn as on the desktop, never edited), AC-33 (zoom), AC-34 (pan,
// page scroll, full screen), AC-35 (Map and List), AC-36 (zoom and views write nothing).
// Contract docs/contracts/android-phone.md §4.2 (the scale rules), §9.4 (DOM: `div[data-map-area][data-scale]`, the
// header buttons, the full-screen dialog), §12.3 (`perf_mark('mindmap-zoom', frame, ms)`), §14.1.
// Fixtures: views/ + phone/ (Mapa výletu with `Výlet` and `Pavouk`), mindmap/ with the runtime Široká mapa and Velká mapa.
// Red-test readings (reported): R96's golden boxes are Measurer values (L1); here Pavouk's drawn boxes on the phone at
// scale 1 are compared with the desktop's drawing of the same block in the same test (± 1 px, relative to the root);
// "layout width / height" is the drawing's unscaled box (`offsetWidth` / `offsetHeight` of the map area's first child);
// pan and pinch amounts are asserted on Chromium (CDP touch).
// Written from the ACs and the contract only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  byTheDrag,
  B, INSETS, FRAME, PH, appBar, assertZeroWrites, bottomBar, desktopPage, eventually, fileStateOf, flat, isChromium, loadVault, main, mainName, must, nfc, phonePage,
  pinch, rect, sleep, startDesktop, startPhone, systemBack, touchDrag,
} from './phone-helpers';

const MM_NOW = '2026-10-22T10:00:00+02:00';
const SIROKA = (() => {
  const items = Array.from({ length: 7 }, (_, i) => `Dlouhá větev číslo ${i + 1} se čtyřiceti znaky`.padEnd(40, '.').slice(0, 40));
  return '---\nid: 01JB4M0000000000000000M020\ntype: page\ntitle: Široká mapa\n---\nÚvodní odstavec nad mapou.\n\n> [!mindmap] Široká\n' + items.map((t, i) => `> ${'  '.repeat(i)}- ${t}`).join('\n') + '\n\n' + Array.from({ length: 30 }, (_, i) => `Odstavec pod mapou ${i + 1}.\n`).join('\n');
})();
const VELKA = (() => {
  const lines = ['> [!mindmap] Velká mapa', '> - Velká mapa'];
  for (let b = 1; b <= 10; b++) {
    lines.push(`>   - Větev ${b}`);
    for (let c = 1; c <= 7; c++) {
      lines.push(`>     - Uzel ${b}.${c}`);
      for (let l = 1; l <= (b === 10 && c === 7 ? 5 : 6); l++) lines.push(`>       - List ${b}.${c}.${l} žluťoučký`);
    }
  }
  return '---\nid: 01JB4M0000000000000000M021\ntype: page\ntitle: Velká mapa\n---\n' + lines.join('\n') + '\n';
})();
const mapVault = () => loadVault('Mapy', ['mindmap', 'new-empty/.tegg'], (f) => { f['Pages/Široká mapa.md'] = SIROKA; f['Pages/Velká mapa.md'] = VELKA; });

const figure = (page: Page, title: string) => main(page).getByRole('figure', { name: `Mindmap: ${nfc(title)}`, exact: true });
const area = (fig: Locator) => fig.locator('[data-map-area]');
const btn = (fig: Locator, name: string) => fig.getByRole('button', { name, exact: true });
const scaleOf = async (fig: Locator) => Number(await area(fig).first().getAttribute('data-scale'));
/** Area width, the drawing's unscaled size, the block's height. */
async function geometry(fig: Locator) {
  return area(fig).first().evaluate((a) => {
    const d = a.firstElementChild as HTMLElement;
    const fg = a.closest('figure') as HTMLElement;
    return { areaW: (a as HTMLElement).clientWidth, layoutW: d.offsetWidth, layoutH: d.offsetHeight, areaH: (a as HTMLElement).getBoundingClientRect().height, figH: fg.getBoundingClientRect().height };
  });
}
const opening = (areaW: number, layoutW: number) => (layoutW <= areaW ? 1 : Math.max(0.5, areaW / layoutW));
/** Drawn boxes of the treeitems relative to the root's box, divided by the scale. */
async function relBoxes(fig: Locator, s: number): Promise<Record<string, number[]>> {
  return fig.getByRole('tree').first().evaluate((t, sc) => {
    const items = [...t.querySelectorAll('[role="treeitem"]')] as HTMLElement[];
    const root = items.find((e) => !e.getAttribute('data-side')) ?? items[0];
    const r0 = root.getBoundingClientRect();
    const out: Record<string, number[]> = {};
    for (const e of items) {
      const r = e.getBoundingClientRect();
      out[(e.getAttribute('aria-label') ?? e.innerText).trim()] = [(r.left - r0.left) / sc, (r.top - r0.top) / sc, r.width / sc, r.height / sc];
    }
    return out;
  }, s);
}
const uiNoTabs = (u: unknown) => JSON.stringify(u);

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-32

test('fr_mmp_02_ac32_mindmap_read_only_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { route: `note/${PH.mapa}` });
  const before = await fileStateOf(core);
  const fig = await must(figure(page, 'Výlet'), 'figure "Mindmap: Výlet"', 5000);
  const names = await fig.getByRole('treeitem').evaluateAll((ts) => ts.map((t) => (t.getAttribute('aria-label') ?? (t as HTMLElement).innerText).replace(/\s+/g, ' ').trim().normalize('NFC')));
  assert.equal(names.length, 7, `the tree of 7 treeitems: ${names.join(' | ')}`);
  const order = ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'];
  names.forEach((n, i) => assert.ok(n.startsWith(order[i]), `treeitem ${i + 1} is ${order[i]} (mindmap AC-1's order): ${n}`));
  const pav = await must(figure(page, 'Pavouk'), 'figure "Mindmap: Pavouk"');
  assert.equal(await pav.getAttribute('data-layout'), 'spider', 'Pavouk is drawn spider');
  // the boxes at scale 1: the drawn boxes divided by the block's scale, compared with the desktop's drawing
  const s = await scaleOf(pav);
  assert.ok(s > 0, `Pavouk's map area has data-scale (${s})`);
  const got = await relBoxes(pav, s);
  const { page: desk, context } = await desktopPage(browser);
  await startDesktop(desk, { route: `note/${PH.mapa}` });
  const dfig = await must(figure(desk, 'Pavouk'), 'desktop: Pavouk', 5000);
  const want = await relBoxes(dfig, 1);
  await context.close();
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), 'the same 8 nodes');
  const bad = Object.entries(want).filter(([k, b]) => !got[k] || got[k].some((v, i) => Math.abs(v - b[i]) > 1)).map(([k]) => `${k}: ${JSON.stringify(got[k])} vs ${JSON.stringify(want[k])}`);
  assert.deepEqual(bad, [], 'Pavouk\'s boxes at scale 1 equal the desktop drawing (R96) ± 1 px');
  for (const f of [fig, pav]) {
    assert.equal(await f.getByRole('radiogroup', { name: 'Mindmap layout' }).count(), 0, 'no Mindmap layout radiogroup');
    assert.equal(await f.getByRole('button', { name: 'Edit node' }).count(), 0, 'no Edit node');
  }
  await fig.getByRole('treeitem').nth(1).click();
  await sleep(400);
  assert.equal(await mainName(page), 'Mapa výletu', 'a tap on a node changes no route');
  assert.equal(await fig.getByRole('button', { name: 'Map', exact: true }).getAttribute('aria-pressed'), 'true', 'no switch to List');
  assert.equal(await page.evaluate(() => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') || (document.activeElement as HTMLElement | null)?.isContentEditable === true), false, 'no keyboard (no field focused)');
  const pasy = await must(main(page).getByRole('checkbox', { name: /Pasy/ }).or(main(page).locator('li').filter({ hasText: 'Pasy' }).getByRole('checkbox')), 'the Pasy checkbox');
  assert.equal(await pasy.isChecked(), true, 'Pasy is drawn checked');
  await pasy.click({ force: true });
  await sleep(300);
  assert.equal(await pasy.isChecked(), true, 'a tap never toggles it');
  await assertZeroWrites(core, before, 'the map');
  await (await must(fig.getByRole('link', { name: /Mapa bez severu/ }), 'the chip Mapa bez severu')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa bez severu', 3000), 'Mapa bez severu', 'the chip opens it');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-33

test('fr_mmp_02_ac33_mindmap_zoom_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: mapVault(), route: 'note/Pages/Široká mapa.md', now: MM_NOW });
  const ui0 = uiNoTabs(await core.uiState());
  const fig = await must(figure(page, 'Široká'), 'figure "Mindmap: Široká"', 5000);
  for (const name of ['Zoom out', 'Zoom in', 'Fit to width']) await must(btn(fig, name), `the header's ${name}`);
  const g = await geometry(fig);
  const s0 = opening(g.areaW, g.layoutW);
  assert.ok(g.layoutW > g.areaW, `setup: Široká mapa is wider than the area (${g.layoutW} > ${g.areaW})`);
  assert.ok(Math.abs((await scaleOf(fig)) - s0) <= 0.01, `the opening scale is max(0.5, area ÷ layout) = ${s0.toFixed(3)} (${await scaleOf(fig)})`);
  const heightOk = async (how: string) => {
    const s = await scaleOf(fig);
    const gg = await geometry(fig);
    assert.ok(Math.abs(gg.areaH - (gg.layoutH * s + 24)) <= 1, `${how}: the block's height is layout height × scale + 24 (${gg.areaH} vs ${gg.layoutH * s + 24})`);
  };
  await heightOk('opening');
  let s = await scaleOf(fig);
  for (let i = 0; i < 12; i++) {
    const zi = btn(fig, 'Zoom in');
    if ((await zi.getAttribute('aria-disabled')) === 'true') break;
    await zi.click();
    const want = Math.min(2.5, s * 1.25);
    s = await eventually(() => scaleOf(fig), (v) => Math.abs(v - want) <= 0.01, 1000);
    assert.ok(Math.abs(s - want) <= 0.01, `Zoom in multiplies by 1.25 up to 2.5 (${s} vs ${want})`);
  }
  assert.ok(Math.abs(s - 2.5) <= 0.01, 'reaches 2.5');
  assert.equal(await btn(fig, 'Zoom in').getAttribute('aria-disabled'), 'true', 'Zoom in is aria-disabled at 2.5');
  await heightOk('at 2.5');
  for (let i = 0; i < 12; i++) {
    const zo = btn(fig, 'Zoom out');
    if ((await zo.getAttribute('aria-disabled')) === 'true') break;
    await zo.click();
    const want = Math.max(0.5, s / 1.25);
    s = await eventually(() => scaleOf(fig), (v) => Math.abs(v - want) <= 0.01, 1000);
    assert.ok(Math.abs(s - want) <= 0.01, `Zoom out divides by 1.25 down to 0.5 (${s} vs ${want})`);
  }
  assert.ok(Math.abs(s - 0.5) <= 0.01, 'reaches 0.5');
  assert.equal(await btn(fig, 'Zoom out').getAttribute('aria-disabled'), 'true', 'Zoom out is aria-disabled at 0.5');
  await btn(fig, 'Fit to width').click();
  assert.ok(Math.abs((await eventually(() => scaleOf(fig), (v) => Math.abs(v - s0) <= 0.01, 1000)) - s0) <= 0.01, 'Fit to width returns to the opening scale');
  assert.equal(uiNoTabs(await core.uiState()), ui0, 'the scale is never written to ui-state.json');
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'ui_state_set' && /scale|zoom/i.test(JSON.stringify(c.args))).length, 0, 'no ui_state_set with the scale');
  await systemBack(page).catch(() => 'n/a');
  const p2 = await page.context().newPage();
  await startPhone(p2, { vault: mapVault(), route: 'note/Pages/Široká mapa.md', now: MM_NOW });
  const f2 = await must(figure(p2, 'Široká'), 'Široká after a new start');
  assert.ok(Math.abs((await scaleOf(f2)) - s0) <= 0.01, 'not kept: a new session opens at the opening scale (D-776)');
  await p2.close();
});

test('fr_mmp_02_ac33_mindmap_zoom_on_the_phone_pinch', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'the pinch uses CDP Input.dispatchTouchEvent (contract §13.2); the zoom buttons run on both engines');
  await startPhone(page, { vault: mapVault(), route: 'note/Pages/Široká mapa.md', now: MM_NOW });
  const fig = await must(figure(page, 'Široká'), 'figure "Mindmap: Široká"', 5000);
  // D-2107: `Široká mapa` opens at the 0.5 minimum, where Zoom out is disabled; tap it only when enabled.
  if ((await btn(fig, 'Zoom out').getAttribute('aria-disabled')) !== 'true') await btn(fig, 'Zoom out').click();
  const s0 = await scaleOf(fig);
  const ar = await rect(area(fig));
  const centre = { x: ar!.x + ar!.width / 2, y: ar!.y + Math.min(ar!.height / 2, 40) };
  const under = await page.evaluate((c) => { const e = document.elementFromPoint(c.x, c.y)?.closest('[role="treeitem"]') as HTMLElement | null; if (!e) return null; const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label') ?? e.innerText, x: r.left, y: r.top, w: r.width, h: r.height }; }, centre);
  await pinch(page, centre, 100, 200);
  await sleep(400);
  const s1 = await scaleOf(fig);
  assert.ok(Math.abs(s1 - Math.min(2.5, Math.max(0.5, s0 * 2))) <= 0.02, `a pinch from 100 to 200 px doubles the scale, clamped (${s0} → ${s1})`);
  if (under) {
    const after = await page.evaluate((n) => { const e = [...document.querySelectorAll('[role="treeitem"]')].find((x) => (x.getAttribute('aria-label') ?? (x as HTMLElement).innerText) === n) as HTMLElement | undefined; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, under.name);
    assert.ok(after, 'the node under the pinch centre is still drawn');
    const fx = (centre.x - under.x) / under.w;
    const fy = (centre.y - under.y) / under.h;
    const moved = Math.hypot(after!.x + fx * after!.w - centre.x, after!.y + fy * after!.h - centre.y);
    assert.ok(moved <= 8, `around its centre: the node under the pinch centre moves at most 8 px (${moved.toFixed(1)})`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-34

test('fr_mmp_02_ac34_mindmap_pan_and_full_screen', async ({ page }) => {
  const core = await startPhone(page, { vault: mapVault(), route: 'note/Pages/Široká mapa.md', now: MM_NOW });
  const before = await fileStateOf(core);
  const fig = await must(figure(page, 'Široká'), 'figure "Mindmap: Široká"', 5000);
  const a = area(fig);
  assert.equal(await a.evaluate((e) => getComputedStyle(e).overflowX), 'auto', 'the map area scrolls sideways');
  if (isChromium(page)) {
    await btn(fig, 'Zoom in').click();
    await btn(fig, 'Zoom in').click();
    const ar = await rect(a);
    const l0 = await a.evaluate((e) => e.scrollLeft);
    const m0 = await page.evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
    await touchDrag(page, { x: ar!.x + ar!.width - 40, y: ar!.y + ar!.height / 2 }, -150, 0);
    await sleep(300);
    const l1 = await a.evaluate((e) => e.scrollLeft);
    assert.ok(byTheDrag(l1 - l0, 150), `a one-finger horizontal drag scrolls the map area by the drag (134…154 px, D-2106: ${l0} → ${l1})`);
    await touchDrag(page, { x: ar!.x + ar!.width / 2, y: ar!.y + ar!.height / 2 }, 0, -200);
    await sleep(300);
    const m1 = await page.evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
    assert.ok(m1 > m0 + 50, `a vertical drag scrolls the page (${m0} → ${m1})`);
    assert.equal(await a.evaluate((e) => e.scrollTop), 0, 'not the map');
  }
  const scroll = await page.evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
  await btn(fig, 'Open full screen').click();
  const dlg = await must(page.getByRole('dialog', { name: 'Mindmap: Široká' }), 'dialog "Mindmap: Široká"');
  assert.equal(await dlg.getAttribute('aria-modal'), 'true', 'modal');
  const dr = await rect(dlg);
  assert.ok(dr && dr.top >= INSETS.top - 0.5 && dr.bottom <= FRAME.height - INSETS.bottom + 0.5 && dr.top <= INSETS.top + 1 && dr.bottom >= FRAME.height - INSETS.bottom - 1 && dr.width >= FRAME.width - 1, `it covers the viewport within the safe areas (${JSON.stringify(dr)})`);
  assert.equal(await bottomBar(page).count(), 0, 'without the bottom bar');
  const bar = await rect(appBar(page));
  assert.ok(!bar || bar.bottom <= dr!.top + 0.5 || await appBar(page).evaluate((e) => !!e.closest('[inert]')), 'without the app bar');
  await must(dlg.getByRole('button', { name: 'Close full screen' }), 'Close full screen');
  for (const n of ['Zoom in', 'Zoom out']) await must(dlg.getByRole('button', { name: n, exact: true }), `the full-screen ${n}`);
  if (isChromium(page)) {
    const fa = dlg.locator('[data-map-area]').first();
    await fa.evaluate((e) => { e.scrollLeft = 100; e.scrollTop = 100; });
    const r = await rect(fa);
    const p0 = await fa.evaluate((e) => [e.scrollLeft, e.scrollTop]);
    await touchDrag(page, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 }, -60, -60);
    await sleep(300);
    const p1 = await fa.evaluate((e) => [e.scrollLeft, e.scrollTop]);
    assert.ok(p1[0] > p0[0] && p1[1] > p0[1], `one-finger drags pan both ways in full screen (${p0} → ${p1})`);
    const s0 = Number(await fa.getAttribute('data-scale'));
    await pinch(page, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 }, 100, 150);
    await sleep(300);
    assert.notEqual(Number(await fa.getAttribute('data-scale')), s0, 'a pinch zooms in full screen');
  }
  await dlg.getByRole('button', { name: 'Close full screen' }).click();
  assert.equal(await eventually(() => page.getByRole('dialog', { name: 'Mindmap: Široká' }).count(), (c) => c === 0, 1000), 0, 'Close full screen closes it');
  const s1 = await page.evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement).scrollTop);
  assert.ok(Math.abs(s1 - scroll) <= 2, `back at the note's scroll position (${scroll} → ${s1})`);
  await btn(fig, 'Open full screen').click();
  await must(page.getByRole('dialog', { name: 'Mindmap: Široká' }), 'full screen again');
  assert.equal(await page.evaluate(() => String((window as any).__TEGG_TEST__.systemBack())), 'handled', 'system Back is handled');
  assert.equal(await page.getByRole('dialog', { name: 'Mindmap: Široká' }).count(), 0, 'system Back closes it');
  assert.equal(await mainName(page), 'Široká mapa', 'the route stays');
  await assertZeroWrites(core, before, 'pan and full screen');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-35

test('fr_mmp_02_ac35_map_and_list_read_only', async ({ page }) => {
  const core = await startPhone(page, { route: `note/${PH.mapa}` });
  const before = await fileStateOf(core);
  const fig = await must(figure(page, 'Výlet'), 'figure "Mindmap: Výlet"', 5000);
  const group = await must(fig.getByRole('group', { name: 'Mindmap view' }), 'group "Mindmap view"');
  await must(group.getByRole('button', { name: 'Map', exact: true }), 'Map');
  await group.getByRole('button', { name: 'List', exact: true }).click();
  assert.equal(await group.getByRole('button', { name: 'List', exact: true }).getAttribute('aria-pressed'), 'true', 'List pressed');
  const items = await fig.locator('li').evaluateAll((ls) => ls.map((l) => {
    let depth = 0;
    for (let p = l.parentElement; p && p.tagName !== 'FIGURE'; p = p.parentElement) if (p.tagName === 'LI') depth++;
    return `${depth}:${((l.firstChild?.textContent ?? '') || (l as HTMLElement).innerText.split('\n')[0]).replace(/\s+/g, ' ').trim().normalize('NFC')}`;
  }));
  assert.deepEqual(items.map((x) => x.replace(/^(\d+:\S+(?: \S+)?).*$/, '$1')).map((x) => x.split(':')[0]), ['0', '1', '2', '2', '1', '2', '1'], `the same nesting as the callout's list: ${items.join(' | ')}`);
  assert.ok(items[0].includes('Výjezd 2026') && items[5].includes('Lisabon'), 'the same items');
  assert.equal(await fig.getByRole('tree').count(), 0, 'List replaces the map');
  assert.equal(await page.locator('[contenteditable], .ProseMirror').count(), 0, 'no editor');
  const boxes = fig.getByRole('checkbox');
  for (let i = 0; i < await boxes.count(); i++) assert.equal(await boxes.nth(i).isDisabled(), true, 'checkboxes are disabled');
  await group.getByRole('button', { name: 'Map', exact: true }).click();
  await must(fig.getByRole('tree'), 'Map again');
  await group.getByRole('button', { name: 'List', exact: true }).click();
  const p2 = await page.context().newPage();
  await startPhone(p2, { route: `note/${PH.mapa}` });
  const f2 = await must(figure(p2, 'Výlet'), 'Výlet after a new start');
  assert.equal(await f2.getByRole('button', { name: 'Map', exact: true }).getAttribute('aria-pressed'), 'true', 'the choice is session state (D-776): a new session shows Map');
  await p2.close();
  await assertZeroWrites(core, before, 'Map and List');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-36

test('fr_mmp_02_ac36_mindmap_on_the_phone_writes_nothing', async ({ page, browser }) => {
  const core = await startPhone(page, { route: `note/${PH.mapa}` });
  const before = await fileStateOf(core);
  const ui0 = JSON.stringify(await core.uiState());
  const fig = await must(figure(page, 'Výlet'), 'figure "Mindmap: Výlet"', 5000);
  for (let i = 0; i < 10; i++) await btn(fig, i % 2 ? 'Zoom out' : 'Zoom in').click();
  const ar = await rect(area(fig));
  for (let i = 0; i < 5; i++) await touchDrag(page, { x: ar!.x + ar!.width / 2, y: ar!.y + ar!.height / 2 }, i % 2 ? 80 : -80, 0);
  await btn(fig, 'Open full screen').click();
  await must(page.getByRole('dialog', { name: 'Mindmap: Výlet' }), 'full screen');
  await page.getByRole('dialog', { name: 'Mindmap: Výlet' }).getByRole('button', { name: 'Close full screen' }).click();
  const group = fig.getByRole('group', { name: 'Mindmap view' });
  for (let i = 0; i < 10; i++) await group.getByRole('button', { name: i % 2 ? 'Map' : 'List', exact: true }).click();
  await sleep(500);
  await assertZeroWrites(core, before, 'ten zooms, five pans, full screen, ten view switches');
  assert.equal(JSON.stringify(await core.uiState()), ui0, 'ui-state.json unchanged');
  // Velká mapa: each zoom step is a perf mark
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: mapVault(), route: 'note/Pages/Velká mapa.md', now: MM_NOW });
  const f2 = await must(figure(p2, 'Velká mapa'), 'Velká mapa (500 nodes)', 10_000);
  for (let i = 0; i < 3; i++) await btn(f2, 'Zoom in').click();
  await sleep(500);
  const marks = (await c2.perfMarks()).filter((m) => m.name === 'mindmap-zoom');
  assert.equal(marks.length, 3, `each zoom step is reported as the perf mark mindmap-zoom (${marks.length})`);
  await p2.close();
});
