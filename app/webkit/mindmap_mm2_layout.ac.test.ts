// Slice MM2, L5 (WebKit, fake core): the two layouts, the switch and the themes (docs/acceptance/mindmap.md R96,
// R97, R98; contract docs/contracts/mm-mindmap.md §6.2…§6.4). FR-MMP-02 AC-27 (rendered boxes of Pavouk within ±1 px
// of the spider layout; left connectors leave the parent's left edge), AC-28 (spider navigation on Pavouk and on
// Výjezd after W12), AC-29 (the switch: click, ← / →, palette; in Map and List; absent in the read view and in a
// read-only note; the embedded Výjezd in Vložení; an unchanged choice writes nothing; one undo step), AC-30 (Široká
// mapa and Velká mapa in spider: scroll and the `mindmap-layout` mark, report-only), FR-FMT-05 AC-7 (the editor and
// the read view draw the stored layout), FR-UX-05 AC-11 (the field and the radios in both themes). Test clock
// 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written from the ACs and the contract only (D-61); every
// missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { axeContrast } from './read-helpers';
import {
  MM, MM2, callsOf, caretWhen, checkedLayout, click, connectorStart, editorBody, eventually, fieldState, fileText, fileWhen, focusNode, focused,
  focusedWhen, layoutGroup, layoutOf, layoutWhen, listBtn, main, mapArea, mapBtn, mindmapVault, must, mustBeOn, mustCaret, needFigure, needNode,
  needTree, node, nodeField, noModified, openMm, original, radioOf, radioRight, radioSpider, runCommand, seen, sides, sirokaText, sleep, swap,
  treeNames, velkaText, viewGroup, viewWhen, writes, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const W12 = (t: string | undefined) => swap(t, '> [!mindmap] Výjezd 2026\n', '> [!mindmap|spider] Výjezd 2026\n');
async function savedAs(core: FakeCoreHandle, path: string, want: string, ms = 4000): Promise<string | undefined> {
  return fileWhen(core, path, (x) => noModified(x) === noModified(want), ms);
}
/** Rendered node boxes relative to the map's origin (padding 16 / 12), by `data-node`. */
async function renderedBoxes(fig: Locator): Promise<Record<string, number[]>> {
  return mapArea(fig).first().evaluate((area) => {
    const a = area.getBoundingClientRect();
    const out: Record<string, number[]> = {};
    for (const e of area.querySelectorAll('[role="treeitem"]') as NodeListOf<HTMLElement>) {
      const r = e.getBoundingClientRect();
      out[e.getAttribute('data-node') ?? ''] = [r.left - a.left + area.scrollLeft - 16, r.top - a.top + area.scrollTop - 12, r.width, r.height];
    }
    return out;
  });
}
/** The layout computed in the page with a canvas measurer at the nodes' computed font, in `layout`. */
async function realLayout(page: Page, fig: Locator, raw: string, title: string, layout: 'right' | 'spider'): Promise<Record<string, number[]>> {
  const font = await fig.locator('[role="treeitem"]').first().evaluate((e) => getComputedStyle(e).font);
  const docUrl = `/@fs${resolve(import.meta.dirname, '../../packages/doc/src/index.ts')}`;
  return page.evaluate(async ([r, f, d, t, lo]) => {
    const lay = await import('/src/mindmap/layout.ts' as string);
    const doc = await import(d);
    const tree = doc.mindmapTree(r, t);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = f;
    const l = lay.layoutMindmap(tree, (s: string) => ctx.measureText(s).width, { layout: lo });
    const out: Record<string, number[]> = {};
    for (const n of l.nodes) out[n.id] = [n.x, n.y, n.w, n.h];
    return out;
  }, [raw, font, docUrl, title, layout] as const);
}
/** Computed colour of a CSS token (`var(--name)`), as a probe element reports it. */
async function token(page: Page, name: string, prop: 'color' | 'background' = 'color'): Promise<string> {
  return page.evaluate(([n, p]) => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    if (p === 'color') probe.style.color = `var(--${n})`; else probe.style.background = `var(--${n})`;
    const v = p === 'color' ? getComputedStyle(probe).color : getComputedStyle(probe).backgroundColor;
    probe.remove();
    return v;
  }, [name, prop] as const);
}
const PAVOUK_RAW = '> [!mindmap|spider] Pavouk\n> - Střed\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama\n>   - Delta';
const PAVOUK_SIDES = { Střed: null, Alfa: 'right', A1: 'right', A2: 'right', Beta: 'left', B1: 'left', Gama: 'right', Delta: 'left' };

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-7 (rendered)

test('fr_fmt_05_ac7_editor_and_read_view_draw_the_stored_layout', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  let fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  assert.equal(await layoutOf(fig), 'spider', 'Pavouk: data-layout spider (D-791)');
  assert.deepEqual(await sides(fig), PAVOUK_SIDES, 'sides by position; none on the root');
  await openMm(page, MM2.metadata);
  fig = await needFigure(page, 'Velká písmena');
  await needTree(fig, 'Velká písmena');
  assert.equal(await layoutOf(fig), 'spider', 'Metadata (2): spider (metadata case-insensitive)');
  assert.deepEqual(await sides(fig), { 'Velká písmena': null, Jedna: 'right', Dvě: 'left', Tři: 'right' }, 'a synthesized root: the top-level items alternate');
  const note = main(page).getByRole('note').filter({ hasText: 'Poznámka' }).first();
  await must(note, 'Metadata (1): an ordinary note callout titled Poznámka');
  assert.ok(!/\bwide\b/.test(await note.innerText()), 'no visible metadata');
  assert.equal(await note.locator('[data-icon="mindmap"]').count(), 0, 'not a mindmap');
  await openMm(page, MM2.neznama);
  fig = await needFigure(page, 'Cizí');
  await needTree(fig, 'Cizí');
  assert.equal(await layoutOf(fig), 'right', 'Neznámé metadata: right');
  assert.deepEqual(await sides(fig), { Kořen: null, Větev: null }, 'no sides in right');
  await openMm(page, MM2.pavouk, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  assert.equal(await layoutOf(fig), 'spider', 'the read view draws Pavouk in spider');
  assert.deepEqual(await sides(fig), PAVOUK_SIDES, 'with its sides');
  const vault = mindmapVault((f) => { f['Pages/Nápověda.md'] = '---\nid: 01JB4M0000000000000000M022\ntype: page\ntitle: Nápověda\n---\n> [!mindmap|spider] Nápověda\n> Jen odstavec.\n'; });
  await openMm(page, 'Pages/Nápověda.md', { vault });
  const hint = main(page).getByRole('note').filter({ hasText: 'A mindmap holds one list' });
  await must(hint, '`[!mindmap|spider]` with a paragraph body: a hint callout (R90)');
  assert.equal(await main(page).locator('[data-mindmap]').count(), 0, 'no mindmap block');
});

// ------------------------------------------------------------------------------------------------ AC-27 (L5)

test('fr_mmp_02_ac27_rendered_pavouk_boxes_match_the_spider_layout', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  const got = await renderedBoxes(fig);
  const want = await realLayout(page, fig, PAVOUK_RAW, 'Pavouk', 'spider');
  assert.deepEqual(Object.keys(got).sort(), ['0', '0.0', '0.0.0', '0.0.1', '0.1', '0.1.0', '0.2', '0.3'], 'one rendered node per layout node');
  const bad = Object.entries(want).filter(([id, b]) => !got[id] || got[id].some((v, i) => Math.abs(v - b[i]) > 1)).map(([id, b]) => `${id}: ${JSON.stringify(got[id])} vs ${JSON.stringify(b)}`);
  assert.deepEqual(bad, [], 'each rendered box within ±1 px of the spider layout');
  assert.ok(got['0.1'][0] + got['0.1'][2] <= got['0'][0] + 1, `Beta (left) ends before the root starts: ${got['0.1'][0] + got['0.1'][2]} ≤ ${got['0'][0]}`);
  assert.ok(got['0.0'][0] >= got['0'][0] + got['0'][2] - 1, 'Alfa (right) starts after the root ends');
  const beta = await connectorStart(fig, '0', '0.1');
  assert.ok(beta, 'the connector Střed → Beta (path data-from / data-to)');
  assert.ok(Math.abs(beta![0] - got['0'][0]) <= 1, `a left connector leaves the parent's left edge: x ${beta![0]} vs ${got['0'][0]}`);
  assert.ok(Math.abs(beta![1] - (got['0'][1] + got['0'][3] / 2)) <= 1, `at its centre: y ${beta![1]}`);
  const b1 = await connectorStart(fig, '0.1', '0.1.0');
  assert.ok(b1 && Math.abs(b1[0] - got['0.1'][0]) <= 1, `Beta → B1 leaves Beta's left edge: ${JSON.stringify(b1)}`);
  const alfa = await connectorStart(fig, '0', '0.0');
  assert.ok(alfa && Math.abs(alfa[0] - (got['0'][0] + got['0'][2])) <= 1, `a right connector leaves the parent's right edge: ${JSON.stringify(alfa)}`);
  assert.equal(await fig.locator('path[data-from]').count(), 7, 'seven connectors');
});

// ------------------------------------------------------------------------------------------------ AC-28

test('fr_mmp_02_ac28_spider_navigation_on_pavouk', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  await focusNode(fig, 'Střed');
  const steps: [string, string][] = [
    ['ArrowRight', 'Alfa'], ['ArrowRight', 'A1'], ['ArrowLeft', 'Alfa'], ['ArrowLeft', 'Střed'], ['ArrowLeft', 'Beta'], ['ArrowLeft', 'B1'], ['ArrowRight', 'Beta'], ['ArrowRight', 'Střed'],
  ];
  const got: string[] = [];
  for (const [k] of steps) { await page.keyboard.press(k); got.push((await focused(page)).name); }
  assert.deepEqual(got, steps.map((s) => s[1]), '← / → follow the screen (D-790)');
  const down: string[] = [];
  for (let i = 0; i < 7; i++) { await page.keyboard.press('ArrowDown'); down.push((await focused(page)).name); }
  assert.deepEqual(down, ['Alfa', 'A1', 'A2', 'Beta', 'B1', 'Gama', 'Delta'], '↓ in outline order, crossing sides');
  await page.keyboard.press('End');
  assert.equal((await focused(page)).name, 'Delta', 'End: Delta');
  await page.keyboard.press('Home');
  assert.equal((await focused(page)).name, 'Střed', 'Home: Střed');
  await focusNode(fig, 'Gama');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).name, 'Gama', '→ on Gama (a right-side leaf): nothing');
  await focusNode(fig, 'Delta');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await focused(page)).name, 'Delta', '← on Delta (a left-side leaf): nothing');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Epsilon');
  await page.keyboard.press('Enter');
  const eps = await eventually(() => sides(fig), (s) => 'Epsilon' in s, 3000);
  assert.equal(eps.Epsilon, 'right', '⏎ on Delta adds a sibling that lands right (the 5th branch)');
});

test('fr_mmp_02_ac28_sides_and_navigation_on_vyjezd_after_w12', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(radioSpider(fig), 'radio "Spider: branches on both sides"');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, W12(original(MM.vyjezd)))), noModified(W12(original(MM.vyjezd))), 'W12');
  assert.equal(await layoutWhen(fig, 'spider'), 'spider', 'drawn in spider');
  const s = await sides(fig);
  assert.deepEqual([s.Program, s.Místo, s.Doprava, s.Lisabon, s['Výjezd 2026']], ['right', 'left', 'right', 'left', null], 'Program and Doprava right, Místo (and Lisabon) left');
  await focusNode(fig, 'Místo');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).name, 'Výjezd 2026', '→ on Místo (left) reaches the root');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await focused(page)).name, 'Místo', '← on the root: the first left-side branch');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await focused(page)).name, 'Lisabon', '← on Místo: its first child');
});

// ------------------------------------------------------------------------------------------------ AC-29

test('fr_mmp_02_ac29_switch_click_writes_w12_to_w12d_and_w13', async ({ page }) => {
  test.setTimeout(120_000);
  const cases: [string, string | null, 'right' | 'spider', string, string][] = [
    [MM.vyjezd, 'Výjezd 2026', 'spider', '> [!mindmap] Výjezd 2026\n', '> [!mindmap|spider] Výjezd 2026\n'],
    [MM2.pavouk, 'Pavouk', 'right', '> [!mindmap|spider] Pavouk\n', '> [!mindmap] Pavouk\n'],
    [MM2.neznama, 'Cizí', 'spider', '> [!mindmap|foo] Cizí\n', '> [!mindmap|spider] Cizí\n'],
    [MM.slozene, 'Složená mapa', 'spider', '> [!mindmap]- Složená mapa\n', '> [!mindmap|spider]- Složená mapa\n'],
    [MM2.metadata, 'Velká písmena', 'right', '> [!Mindmap|SPIDER]+ Velká písmena\n', '> [!Mindmap]+ Velká písmena\n'],
  ];
  const bad: string[] = [];
  for (const [path, title, to, before, after] of cases) {
    const core = await openMm(page, path);
    const fig = await needFigure(page, title);
    const from = to === 'right' ? 'spider' : 'right';
    if ((await checkedLayout(fig)) !== from) { bad.push(`${title}: checked ${await checkedLayout(fig)}, want ${from}`); continue; }
    if (path === MM2.neznama) {
      await sleep(1200);
      if ((await fileText(core, path)) !== original(path)) bad.push(`${title}: changed before the choice`);
    }
    await click(radioOf(fig, to), `radio ${to} on ${title}`);
    const want = swap(original(path), before, after);
    const t = await savedAs(core, path, want);
    if (noModified(t) !== noModified(want)) { bad.push(`${title} → ${to}: ${JSON.stringify(t)}`); continue; }
    if ((await layoutWhen(fig, to)) !== to) bad.push(`${title}: data-layout ${await layoutOf(fig)} after the choice`);
    if ((await checkedLayout(fig)) !== to) bad.push(`${title}: the radio ${to} is not checked`);
    if ((await writes(core)).length !== 1) bad.push(`${title}: ${(await writes(core)).length} writes for one switch`);
  }
  assert.deepEqual(bad, [], 'W12, W12a, W12b, W12c, W12d: one line (and modified), redrawn at once');
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(radioSpider(fig), 'Spider');
  await savedAs(core, MM.vyjezd, W12(original(MM.vyjezd)));
  await click(radioRight(fig), 'Branches to the right');
  const t = await savedAs(core, MM.vyjezd, original(MM.vyjezd));
  assert.equal(noModified(t), noModified(original(MM.vyjezd)), 'W13: the original but modified');
  assert.ok(t?.includes('> [!mindmap] Výjezd 2026\n> - Výjezd 2026\n'), 'the first line restored byte for byte');
  assert.equal(await layoutWhen(fig, 'right'), 'right', 'drawn in right again');
});

test('fr_mmp_02_ac29_switch_by_arrow_keys_palette_and_one_undo_step', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  const w12 = W12(original(MM.vyjezd));
  await (await must(radioRight(fig), 'radio right')).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w12)), noModified(w12), '→ with the group focused: W12');
  assert.equal(await checkedLayout(fig), 'spider', 'the check moved');
  await page.keyboard.press('ArrowLeft');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), '← : W13');
  await focusNode(fig, 'Program');
  await runCommand(page, 'Mindmap layout: spider');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w12)), noModified(w12), 'the palette command with the tree focused: W12');
  assert.equal(await layoutWhen(fig, 'spider'), 'spider', 'drawn in spider');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'caret in the block');
  await runCommand(page, 'Mindmap layout: right');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), 'the palette command with the caret in the block: W13');
  await click(mapBtn(fig), 'Map');
  await click(radioSpider(fig), 'Spider');
  await savedAs(core, MM.vyjezd, w12);
  await focusNode(fig, 'Program');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), '⌘Z with the map focused undoes W12 as one step');
  assert.equal(await layoutWhen(fig, 'right'), 'right', 'redrawn in right');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w12)), noModified(w12), '⇧⌘Z re-applies W12');
  assert.equal(await layoutWhen(fig, 'spider'), 'spider', 'redrawn in spider');
});

test('fr_mmp_02_ac29_switch_in_list_absent_in_read_views_and_in_the_embed', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'List view');
  await must(layoutGroup(fig), 'the switch is present in List');
  await click(radioSpider(fig), 'Spider in List');
  const w12 = W12(original(MM.vyjezd));
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w12)), noModified(w12), 'W12 from List');
  assert.equal(await layoutWhen(fig, 'spider'), 'spider', 'the live map redraws in spider');
  assert.equal((await sides(fig)).Místo, 'left', 'with its sides');
  await openMm(page, MM2.pavouk, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  assert.equal(await layoutGroup(fig).count(), 0, 'no switch in the read view');
  assert.equal(await layoutOf(fig), 'spider', 'which draws Pavouk in spider');
  await openMm(page, MM.neplatna, { readView: true });
  const tf = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(tf, 1500)) await tf.click();
  fig = await needFigure(page, 'Jen ke čtení');
  await needTree(fig, 'Jen ke čtení');
  assert.equal(await layoutGroup(fig).count(), 0, 'no switch in a read-only note');
  assert.equal(await viewGroup(fig).count(), 0, 'and no view switch');
  const core2 = await openMm(page, MM.vlozeni);
  const frame = await must(main(page).getByRole('group', { name: 'Embedded: Výjezd 2026', exact: true }), 'the full embed of Výjezd', 5000);
  const ef = await must(frame.getByRole('figure', { name: 'Mindmap: Výjezd 2026', exact: true }), 'the embedded mindmap block', 5000);
  await must(layoutGroup(ef), 'the embedded block shows the switch');
  await click(radioSpider(ef), 'Spider in the embed');
  assert.equal(noModified(await savedAs(core2, MM.vyjezd, w12)), noModified(w12), 'W12 there changes Pages/Výjezd 2026.md');
  assert.equal(await fileText(core2, MM.vlozeni), original(MM.vlozeni), 'Vložení is untouched');
  assert.deepEqual((await writes(core2)).map((c) => String((c.args as any).path).normalize('NFC')), [MM.vyjezd], 'the only write');
});

test('fr_mmp_02_ac29_choosing_the_checked_radio_writes_nothing', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  assert.equal(await checkedLayout(fig), 'right', 'Výjezd: Branches to the right checked');
  await click(radioRight(fig), 'the checked radio');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'nothing written');
  assert.equal(await fileText(core, MM.vyjezd), original(MM.vyjezd), 'the file unchanged');
  const core2 = await openMm(page, MM2.pavouk);
  fig = await needFigure(page, 'Pavouk');
  assert.equal(await checkedLayout(fig), 'spider', 'Pavouk: Spider checked');
  await click(radioSpider(fig), 'the checked radio');
  await sleep(1500);
  assert.deepEqual(await writes(core2), [], 'nothing written');
  const core3 = await openMm(page, MM2.neznama);
  fig = await needFigure(page, 'Cizí');
  assert.equal(await checkedLayout(fig), 'right', 'Neznámé metadata: Branches to the right checked');
  await click(radioRight(fig), 'the checked radio');
  await sleep(1500);
  assert.deepEqual(await writes(core3), [], 'nothing written');
  assert.equal(await fileText(core3, MM2.neznama), original(MM2.neznama), '`|foo` kept until a choice');
});

// ------------------------------------------------------------------------------------------------ AC-30

test('fr_mmp_02_ac30_wide_spider_map_scrolls_inside_the_block', async ({ page }) => {
  const vault = mindmapVault((f) => { f['Pages/Široká mapa.md'] = sirokaText().replace('> [!mindmap] Široká', '> [!mindmap|spider] Široká'); });
  await openMm(page, 'Pages/Široká mapa.md', { vault });
  const fig = await needFigure(page, 'Široká');
  await needTree(fig, 'Široká');
  assert.equal(await layoutOf(fig), 'spider', 'drawn in spider');
  assert.equal((await sides(fig))[Object.keys(await sides(fig))[1]], 'right', 'the first (only) branch is right');
  const area = await must(mapArea(fig), 'the map area');
  const m = await area.evaluate((a) => {
    const s = getComputedStyle(a);
    return { sw: a.scrollWidth, cw: a.clientWidth, sh: a.scrollHeight, ch: a.clientHeight, ox: s.overflowX, oy: s.overflowY, h: a.getBoundingClientRect().height };
  });
  assert.ok(m.sw > m.cw, `scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  assert.ok(m.sw >= 1700, `scrollWidth ${m.sw} ≥ 1,700 px`);
  assert.equal(m.ox, 'auto', 'overflow-x auto');
  assert.ok(m.sh <= m.ch && m.oy !== 'scroll' && m.oy !== 'auto', `no vertical scrollbar (overflow-y ${m.oy}, ${m.sh} / ${m.ch})`);
  const pageW = await page.evaluate(() => ({ s: document.scrollingElement!.scrollWidth, v: window.innerWidth }));
  assert.equal(pageW.s, pageW.v, 'the page has no horizontal scroll');
  const items = await fig.locator('[role="treeitem"]').evaluateAll((es) => es.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
  const span = Math.max(...items.map((x) => x[1])) - Math.min(...items.map((x) => x[0]));
  assert.ok(Math.abs(m.h - (span + 24)) <= 1, `map area height = layout height + 24 (${m.h} vs ${span + 24})`);
  await focusNode(fig, (await treeNames(fig))[0]);
  await page.keyboard.press('End');
  const f = await focusedWhen(page, (x) => x.node === '0.0.0.0.0.0.0');
  assert.equal(f.node, '0.0.0.0.0.0.0', 'End focuses the last node');
  const vis = await mapArea(fig).first().evaluate((a) => {
    const n = a.querySelector('[data-node="0.0.0.0.0.0.0"]')!.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    return n.left >= r.left - 1 && n.right <= r.right + 1;
  });
  assert.equal(vis, true, 'scrolled into view inside the map area');
});

test('fr_mmp_02_ac30_500_nodes_spider_layout_benchmark_report_only', async ({ page }) => {
  test.setTimeout(240_000);
  const vault = mindmapVault((f) => { f['Pages/Velká mapa.md'] = velkaText().replace('> [!mindmap] Velká mapa', '> [!mindmap|spider] Velká mapa'); });
  const ms: number[] = [];
  let ready: number[] = [];
  for (let run = 0; run < 20; run++) {
    const core = await openMm(page, 'Pages/Velká mapa.md', { vault });
    const fig = await needFigure(page, 'Velká mapa', 10_000);
    await must(fig.locator('[role="treeitem"]').nth(499), '500 treeitems', 10_000);
    if (run === 0) {
      assert.equal(await fig.locator('[role="treeitem"]').count(), 500, '500 nodes');
      assert.equal(await layoutOf(fig), 'spider', 'in spider');
      assert.equal(await fig.locator('[role="treeitem"][data-side="left"]').count(), 5 * (1 + 7 + 6 * 7) - 1, 'the 2nd, 4th, …, 10th branches (and their subtrees) are left');
    }
    const marks = await eventually(async () => (await callsOf(core, 'perf_mark')).map((c) => c.args as any), (m) => m.some((x) => x?.mark === 'mindmap-layout'), 3000);
    const l = marks.find((x) => x?.mark === 'mindmap-layout');
    assert.ok(l, 'perf mark mindmap-layout (mm-mindmap §4)');
    ms.push(Number(l.ms));
    ready = ready.concat(marks.filter((x) => x?.mark === 'note-ready').map((x) => Number(x.ms)));
  }
  const s = [...ms].sort((a, b) => a - b);
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  console.log(`FR-MMP-02 AC-30 (report-only, D-152): spider mindmap-layout p95 ${p95.toFixed(2)} ms over ${s.length} runs (target ≤ 16.7 ms); note-ready ${ready.join(', ')}`);
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-11

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac11_field_and_switch_tokens_${theme}`, async ({ page }) => {
    await openMm(page, MM.vyjezd, { theme });
    const fig = await needFigure(page, 'Výjezd 2026');
    await needTree(fig, 'Výjezd 2026');
    const bad: string[] = [];
    const accent = await token(page, 'accent');
    const muted = await token(page, 'muted');
    const check = async (name: string, bg: string, fg: string) => {
      await focusNode(fig, name);
      await page.keyboard.press(' ');
      const s = await fieldState(fig);
      if (!s) { bad.push(`${name}: no field`); return; }
      const got = await nodeField(fig).first().evaluate((el) => {
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 ? `outline ${cs.outlineWidth} ${cs.outlineColor}` : cs.boxShadow !== 'none' ? `shadow ${cs.boxShadow}` : 'none';
        return { bg: cs.backgroundColor, color: cs.color, ring };
      });
      const wantBg = await token(page, bg, 'background');
      const wantFg = await token(page, fg);
      if (got.bg !== wantBg) bad.push(`${name}: field background ${got.bg} ≠ ${bg} ${wantBg}`);
      if (got.color !== wantFg) bad.push(`${name}: field colour ${got.color} ≠ ${fg} ${wantFg}`);
      if (!got.ring.includes(accent) || (got.ring.startsWith('outline') && !/^outline 2px/.test(got.ring) && !/ 2px /.test(got.ring))) bad.push(`${name}: focus ring ${got.ring} is not 2 px accent ${accent}`);
      for (const v of await axeContrast(page)) bad.push(`${name} (field open): contrast ${v}`);
      await page.keyboard.press('Escape');
    };
    await check('Program', 'type-blue-bg', 'type-blue');
    await check('Plán 2027', 'bg', 'text');
    await check('Výjezd 2026', 'text', 'bg');
    const radios = (await seen(layoutGroup(fig), 1000))
      ? await layoutGroup(fig).first().evaluate((g) => [...g.querySelectorAll('[role="radio"]')].map((r) => ({ layout: r.getAttribute('data-layout'), checked: r.getAttribute('aria-checked'), color: getComputedStyle(r).color })))
      : [];
    if (radios.length !== 2) bad.push(`radiogroup "Mindmap layout": ${radios.length} radios`);
    const checked = radios.find((r) => r.checked === 'true');
    const unchecked = radios.find((r) => r.checked !== 'true');
    if (!checked || !unchecked) bad.push(`radios: ${JSON.stringify(radios)}`);
    if (checked && checked.color !== accent) bad.push(`the checked radio uses ${checked.color}, not accent ${accent}`);
    if (unchecked && unchecked.color !== muted) bad.push(`the unchecked radio uses ${unchecked.color}, not muted ${muted}`);
    for (const v of await axeContrast(page)) bad.push(`switch: contrast ${v}`);
    await openMm(page, MM2.pavouk, { theme });
    const p = await needFigure(page, 'Pavouk');
    await needTree(p, 'Pavouk');
    const muted2 = await token(page, 'muted');
    const strokes = await p.locator('path[data-from="0"][data-to="0.1"], path[data-from="0.1"][data-to="0.1.0"]').evaluateAll((ps) => ps.map((x) => `${getComputedStyle(x).stroke} ${getComputedStyle(x).strokeWidth}`));
    if (strokes.length !== 2) bad.push(`left connectors found: ${strokes.length}`);
    for (const s of strokes) if (!s.startsWith(muted2) || !/1\.5(px)?$/.test(s)) bad.push(`left connector ${s} ≠ muted ${muted2} 1.5px`);
    assert.deepEqual(bad, [], `FR-UX-05 AC-11 tokens in ${theme}`);
  });
}
