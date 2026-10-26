// Slice MM, L5 (WebKit, fake core): what the map draws and how it is used (docs/acceptance/mindmap.md R91, R92;
// contract docs/contracts/mm-mindmap.md §2, §4). FR-MMP-02 AC-9 (node content), AC-10 (links in nodes are links),
// AC-11 (rendered boxes within ±1 px of the layout), AC-12 (colours by position, light and dark; connectors `muted`),
// AC-13 (wide maps scroll inside the block), AC-14 (500 nodes: report-only benchmark, D-152), AC-15 (keyboard),
// AC-16 (in an embedded note). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900, panel closed.
// Written from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  MM, callsOf, caretWhen, click, description, eventually, figure, fileText, fileWhen, focused, focusedWhen, listBtn, main, mapArea, mapBtn,
  mindmapVault, must, mustBeOn, mustCaret, navs, needFigure, needNode, needTree, node, noModified, openMm, original, seen, sirokaText, sleep, swap,
  treeItems, treeNames, velkaText, viewOf, viewWhen, writes, fieldState, nodeField, pendingNode, radioRight,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_mmp_02_ac9_uzly_nodes_show_marks_chips_and_more', async ({ page }) => {
  await openMm(page, MM.uzly);
  const fig = await needFigure(page, 'Uzly');
  await needTree(fig, 'Uzly');
  const items = await treeItems(fig);
  assert.equal(items.length, 12, 'twelve nodes');
  const kid = (k: number) => fig.locator(`[role="treeitem"][data-node="0.${k}"]`);
  // (a) marks
  const a = kid(0);
  assert.ok(await seen(a.locator('strong, b').filter({ hasText: 'Tučně' }), 1000), '(a) strong Tučně');
  assert.ok(await seen(a.locator('code').filter({ hasText: 'kód' }), 1000), '(a) code kód');
  assert.ok(await seen(a.locator('mark').filter({ hasText: 'zvýraznění' }), 1000), '(a) mark zvýraznění');
  // (b) link and tag chips
  const b = kid(1);
  assert.equal(await b.locator('[data-link-kind="note"]').filter({ hasText: 'Lisabon' }).count(), 1, '(b) resolved link chip Lisabon');
  assert.equal(await b.locator('[data-tag="cestování"]').count(), 1, '(b) tag chip #cestování');
  // (c) date link (not broken)
  const c = kid(2);
  const date = c.getByRole('link').filter({ hasText: /2026|20/ }).first();
  await must(date, '(c) the date-link chip');
  assert.notEqual(await date.getAttribute('data-link-kind'), 'unresolved', '(c) the date link is not broken (FR-DLY-08)');
  // (d) task chip with its suffix
  const d = kid(3);
  const task = d.getByRole('link').filter({ hasText: 'Zalít květiny' }).first();
  await must(task, '(d) chip Zalít květiny');
  assert.ok((await d.innerText()).replace(/\s+/g, ' ').includes('Today · To do'), `(d) suffix Today · To do: ${await d.innerText()}`);
  assert.equal(await d.locator('[data-embed-mode]').count(), 0, '(d) no embedded content');
  // (e) file chip
  const e = kid(4);
  assert.ok((await e.innerText()).includes('fotka.png'), '(e) a file chip fotka.png');
  assert.equal(await e.locator('img').count(), 0, '(e) never the picture');
  // (f) long text: 3 lines in a 200 px node
  const f = kid(5);
  const fb = await f.boundingBox();
  assert.ok(fb && Math.abs(fb.width - 200) <= 1, `(f) 200 px wide: ${fb?.width}`);
  assert.ok((await f.innerText()).replace(/\s+/g, ' ').includes('Velmi dlouhý text uzlu, který se musí zalomit do více řádků'), '(f) nothing cut');
  // (g)…(i) more
  for (const [k, text, hidden] of [[6, 'Odstavec navíc …', 'Druhý odstavec'], [7, 'Položka s kódem …', 'let x'], [8, 'Položka s citací …', 'Citace v položce']] as const) {
    const it = items[k + 1];
    assert.equal(it?.name, text, `node ${k + 1}: ${text}`);
    assert.equal(it?.description, 'More in the list', `${text}: description`);
    assert.ok(!(await kid(k).innerText()).includes(hidden), `${text}: none of "${hidden}"`);
  }
  // (j) broken link
  const j = kid(9).getByRole('link').filter({ hasText: 'Neexistuje' }).first();
  await must(j, '(j) chip Neexistuje');
  assert.equal(await j.getAttribute('data-link-kind'), 'unresolved', '(j) broken style');
  assert.equal(await description(j), 'No note named Neexistuje', '(j) description');
  // (k) hard break
  const k = kid(10);
  assert.ok(!(await k.innerText()).includes('…'), '(k) no …');
  const lines = (await k.innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
  assert.deepEqual(lines, ['Řádek jedna', 'řádek dva'], '(k) two lines');
});

test('fr_mmp_02_ac9_checklist_boxes_are_read_only_and_numbers_not_drawn', async ({ page }) => {
  const core = await openMm(page, MM.nakup);
  const fig = await needFigure(page, null);
  await needTree(fig, null);
  const items = await treeItems(fig);
  assert.deepEqual(items.map((i) => [i.name, i.description]), [['Nákup', 'Not checked'], ['Mléko', 'Checked'], ['Chléb', 'Not checked'], ['Sýr', 'Checked']], 'descriptions Checked / Not checked');
  const box = fig.locator('[role="treeitem"][data-node="0.0"] input[type="checkbox"], [role="treeitem"][data-node="0.0"] [data-checkbox]').first(); // Mléko is the first child (0.0)
  await must(box, 'the drawn box of Mléko');
  assert.equal(await box.getAttribute('aria-hidden') ?? await box.evaluate((x) => x.closest('[aria-hidden="true"]') ? 'true' : null), 'true', 'the box is aria-hidden (AP-731)');
  await box.click();
  assert.equal(await viewOf(fig), 'map', 'a click on the box is a node click: it focuses the node (slice MM2, D-788)');
  assert.equal(await (await needNode(fig, 'Mléko')).evaluate((el) => el === document.activeElement), true, 'Mléko focused');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'never toggles, writes nothing');
  await openMm(page, MM.postup);
  const p = await needFigure(page, 'Postup');
  assert.deepEqual(await treeNames(p), ['Postup', 'Krok jedna', 'Krok dva'], 'no 1. or 2. (AP-735)');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_mmp_02_ac10_link_chip_opens_the_note_without_switching', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  const lis = await needNode(fig, 'Lisabon');
  await click(lis.getByRole('link', { name: 'Lisabon' }), 'chip Lisabon');
  await mustBeOn(page, 'Lisabon', 'the chip opens note/Pages/Lisabon.md');
  assert.ok((await navs(core)).includes(MM.lisabon), 'nav_opened recorded (D-138)');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Výjezd 2026', 'Back');
  const f2 = await needFigure(page, 'Výjezd 2026');
  assert.equal(await viewOf(f2), 'map', 'the chip click didn\'t switch to List');
  const n = await needNode(f2, 'Lisabon');
  const bb = (await n.boundingBox())!;
  const chip = (await n.getByRole('link').first().boundingBox())!;
  await page.mouse.click(Math.min(bb.x + bb.width - 2, chip.x + chip.width + 3), bb.y + bb.height - 2);
  assert.equal(await viewOf(f2), 'map', 'elsewhere on the node: the node click focuses it (slice MM2, D-788)');
  assert.equal(await n.evaluate((el) => el === document.activeElement), true, 'Lisabon focused');
});

test('fr_mmp_02_ac10_tag_date_broken_and_task_chips_in_uzly', async ({ page }) => {
  const core = await openMm(page, MM.uzly);
  let fig = await needFigure(page, 'Uzly');
  await click(fig.locator('[data-map-area] [data-tag="cestování"]').first(), 'tag chip #cestování'); // the map's chip, not the hidden list's
  await mustBeOn(page, '#cestování', 'tag/cestování');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Uzly', 'Back');
  fig = await needFigure(page, 'Uzly');
  await click(fig.locator('[role="treeitem"][data-node="0.2"]').getByRole('link').first(), 'the date chip');
  await mustBeOn(page, '2026-10-20', 'daily/2026-10-20');
  await sleep(800);
  assert.deepEqual((await core.calls()).map((c) => c.cmd).filter((c) => ['note_write', 'daily_create', 'note_create'].includes(c)), [], 'opening the day writes nothing (FR-DLY-08)');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Uzly', 'Back');
  fig = await needFigure(page, 'Uzly');
  await click(fig.locator('[role="treeitem"][data-node="0.9"]').getByRole('link').first(), 'chip Neexistuje');
  await must(page.getByRole('dialog', { name: 'Create note' }), 'the Create offer (FR-LNK-04 AC-4)');
  await page.keyboard.press('Escape');
  await click(fig.locator('[role="treeitem"][data-node="0.3"]').getByRole('link').first(), 'chip Zalít květiny');
  await mustBeOn(page, 'Zalít květiny', 'the task opens');
});

// ------------------------------------------------------------------------------------------------ AC-11

/** Rendered node boxes relative to the map's origin (the area's padding 16 / 12 px), by `data-node`. */
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
/** The layout of Strom computed in the page with a canvas measurer at the nodes' computed font (no chips). */
async function realLayout(page: Page, fig: Locator, raw: string): Promise<Record<string, number[]>> {
  const font = await fig.locator('[role="treeitem"]').first().evaluate((e) => getComputedStyle(e).font);
  const docUrl = `/@fs${resolve(import.meta.dirname, '../../packages/doc/src/index.ts')}`;
  return page.evaluate(async ([r, f, d]) => {
    const lay = await import('/src/mindmap/layout.ts' as string);
    const doc = await import(d);
    const tree = doc.mindmapTree(r, 'Rozložení');
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = f;
    const l = lay.layoutMindmap(tree, (t: string) => ctx.measureText(t).width);
    const out: Record<string, number[]> = {};
    for (const n of l.nodes) out[n.id] = [n.x, n.y, n.w, n.h];
    return out;
  }, [raw, font, docUrl] as const);
}

test('fr_mmp_02_ac11_rendered_boxes_match_the_layout', async ({ page }) => {
  await openMm(page, MM.rozlozeni);
  const fig = await needFigure(page, 'Strom');
  await needTree(fig, 'Strom');
  const got = await renderedBoxes(fig);
  const raw = '> [!mindmap] Strom\n> - Kořen\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama';
  const want = await realLayout(page, fig, raw);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), 'one rendered node per layout node');
  const bad = Object.entries(want).filter(([id, b]) => !got[id] || got[id].some((v, i) => Math.abs(v - b[i]) > 1)).map(([id, b]) => `${id}: ${JSON.stringify(got[id])} vs ${JSON.stringify(b)}`);
  assert.deepEqual(bad, [], 'each rendered box within ±1 px of the layout');
});

test('fr_mmp_02_ac11_layout_is_not_written', async ({ page }) => {
  const core = await openMm(page, MM.rozlozeni);
  const fig = await needFigure(page, 'Strom');
  await needTree(fig, 'Strom');
  await page.setViewportSize({ width: 1200, height: 900 });
  await sleep(500);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'no note_write');
  assert.ok(!/layout|mindmap/i.test(JSON.stringify((await core.uiState()) ?? {})), 'nothing of the layout in the UI state (R-08)');
});

// ------------------------------------------------------------------------------------------------ AC-12

/** Computed background, colour and border of a node and the values of the tokens R92 names. */
async function nodeStyle(n: Locator, bg: string, fg: string, border: string | null) {
  return n.first().evaluate((e, [b, f, br]) => {
    const cs = getComputedStyle(e as HTMLElement);
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.background = `var(--${b})`;
    probe.style.color = `var(--${f})`;
    if (br) probe.style.borderColor = `var(--${br})`;
    const ps = getComputedStyle(probe);
    const out = {
      got: [cs.backgroundColor, cs.color, br ? `${cs.borderTopWidth} ${cs.borderTopColor}` : cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0 ? 'none' : `${cs.borderTopWidth}`],
      want: [ps.backgroundColor, ps.color, br ? `1px ${ps.borderTopColor}` : 'none'],
    };
    probe.remove();
    return out;
  }, [bg, fg, border] as const);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_mmp_02_ac12_colours_by_position_${theme}`, async ({ page }) => {
    await openMm(page, MM.vyjezd, { theme });
    let fig = await needFigure(page, 'Výjezd 2026');
    await needTree(fig, 'Výjezd 2026');
    const want: [string, string, string, string | null][] = [
      ['Výjezd 2026', 'text', 'bg', null], ['Program', 'type-blue-bg', 'type-blue', null], ['Místo', 'type-orange-bg', 'type-orange', null],
      ['Doprava', 'type-purple-bg', 'type-purple', null], ['Přehled Q4', 'bg', 'text', 'border'], ['Lisabon', 'bg', 'text', 'border'],
    ];
    const bad: string[] = [];
    for (const [name, bg, fg, br] of want) {
      const s = await nodeStyle(node(fig, name), bg, fg, br);
      if (JSON.stringify(s.got) !== JSON.stringify(s.want)) bad.push(`${name}: ${JSON.stringify(s.got)} ≠ ${JSON.stringify(s.want)}`);
    }
    const stroke = await fig.locator('path[data-from]').first().evaluate((p) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      document.body.appendChild(probe);
      const w = getComputedStyle(probe).color;
      probe.remove();
      return { got: getComputedStyle(p).stroke, want: w, width: getComputedStyle(p).strokeWidth };
    }).catch(() => ({ got: 'no connector', want: '', width: '' }));
    if (stroke.got !== stroke.want) bad.push(`connector stroke ${stroke.got} ≠ muted ${stroke.want}`);
    if (stroke.width !== '1.5px' && stroke.width !== '1.5') bad.push(`connector width ${stroke.width}`);
    await openMm(page, MM.vice, { theme });
    fig = await needFigure(page, 'Témata');
    for (const [name, bg, fg, br] of [['Témata', 'text', 'bg', null], ['Rodina', 'type-blue-bg', 'type-blue', null], ['Práce', 'type-orange-bg', 'type-orange', null], ['Zdraví', 'type-purple-bg', 'type-purple', null], ['Porady', 'bg', 'text', 'border']] as [string, string, string, string | null][]) {
      const s = await nodeStyle(node(fig, name), bg, fg, br);
      if (JSON.stringify(s.got) !== JSON.stringify(s.want)) bad.push(`${name}: ${JSON.stringify(s.got)} ≠ ${JSON.stringify(s.want)}`);
    }
    await openMm(page, MM.rozlozeni, { theme });
    fig = await needFigure(page, 'Paleta');
    const pal = ['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red', 'blue'];
    for (const [i, name] of ['Jedna', 'Dvě', 'Tři', 'Čtyři', 'Pět', 'Šest', 'Sedm', 'Osm'].entries()) {
      const s = await nodeStyle(node(fig, name), `type-${pal[i]}-bg`, `type-${pal[i]}`, null);
      if (JSON.stringify(s.got) !== JSON.stringify(s.want)) bad.push(`${name}: ${JSON.stringify(s.got)} ≠ ${pal[i]}`);
    }
    assert.deepEqual(bad, [], `R92 tokens in ${theme}`);
  });
}

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_mmp_02_ac13_wide_map_scrolls_inside_the_block', async ({ page }) => {
  const vault = mindmapVault((f) => { f['Pages/Široká mapa.md'] = sirokaText(); });
  await openMm(page, 'Pages/Široká mapa.md', { vault });
  const fig = await needFigure(page, 'Široká');
  await needTree(fig, 'Široká');
  const area = await must(mapArea(fig), 'the map area (data-map-area)');
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
  const col = await page.getByRole('textbox', { name: /Note body/ }).first().boundingBox();
  await openMm(page, MM.lisabon, { vault });
  const col2 = await page.getByRole('textbox', { name: /Note body/ }).first().boundingBox();
  assert.equal(col?.width, col2?.width, 'the note column\'s width is unchanged');
});

test('fr_mmp_02_ac13_focusing_the_last_node_scrolls_it_into_view', async ({ page }) => {
  const vault = mindmapVault((f) => { f['Pages/Široká mapa.md'] = sirokaText(); });
  await openMm(page, 'Pages/Široká mapa.md', { vault });
  const fig = await needFigure(page, 'Široká');
  const first = await must(fig.locator('[role="treeitem"]').first(), 'the root node');
  await first.focus();
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

// ------------------------------------------------------------------------------------------------ AC-14 (report-only)

test('fr_mmp_02_ac14_500_nodes_layout_benchmark_report_only', async ({ page }) => {
  test.setTimeout(240_000);
  const vault = mindmapVault((f) => { f['Pages/Velká mapa.md'] = velkaText(); });
  const ms: number[] = [];
  let ready: number[] = [];
  for (let run = 0; run < 20; run++) {
    const core = await openMm(page, 'Pages/Velká mapa.md', { vault });
    const fig = await needFigure(page, 'Velká mapa', 10_000);
    await must(fig.locator('[role="treeitem"]').nth(499), '500 treeitems', 10_000);
    if (run === 0) assert.equal(await fig.locator('[role="treeitem"]').count(), 500, '500 nodes');
    const marks = await eventually(async () => (await callsOf(core, 'perf_mark')).map((c) => c.args as any), (m) => m.some((x) => x?.mark === 'mindmap-layout'), 3000);
    const l = marks.find((x) => x?.mark === 'mindmap-layout');
    assert.ok(l, 'perf mark mindmap-layout (mm-mindmap §4)');
    ms.push(Number(l.ms));
    ready = ready.concat(marks.filter((x) => x?.mark === 'note-ready').map((x) => Number(x.ms)));
  }
  const s = [...ms].sort((a, b) => a - b);
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  console.log(`FR-MMP-02 AC-14 (report-only, D-152): mindmap-layout p95 ${p95.toFixed(2)} ms over ${s.length} runs (target ≤ 16.7 ms); note-ready ${ready.join(', ')}`);
});

test('fr_mmp_02_ac14_typing_in_the_500_node_list_report_only', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), latencyProbe: true }; });
  const vault = mindmapVault((f) => { f['Pages/Velká mapa.md'] = velkaText(); });
  const core = await openMm(page, 'Pages/Velká mapa.md', { vault });
  const fig = await needFigure(page, 'Velká mapa', 10_000);
  await click(listBtn(fig), 'List');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'List view');
  await click(node(fig, 'List 5.3.2 žluťoučký'), 'a node of the map below the list');
  const n0 = (await core.calls()).length;
  for (let k = 0; k < 100; k++) { await page.keyboard.press('a'); await sleep(40); }
  await sleep(500);
  const keys = (await core.calls()).slice(n0).filter((c) => c.cmd === 'perf_mark' && (c.args as any)?.mark === 'key').map((c) => Number((c.args as any).frame));
  assert.ok(keys.length > 0, 'the latency probe reports keystrokes');
  console.log(`FR-MMP-02 AC-14 typing (report-only): ${(100 * keys.filter((f) => f <= 1).length / keys.length).toFixed(1)} % painted in the next frame`);
});

// ------------------------------------------------------------------------------------------------ AC-15

test('fr_mmp_02_ac15_tab_order_and_tree_keys', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  // Slice MM2 (D-792, FR-UX-03 AC-16): Tab reaches the layout switch (one stop) before Map.
  await (await must(radioRight(fig), 'radio "Branches to the right"')).focus();
  assert.deepEqual([(await focused(page)).role, (await focused(page)).name], ['radio', 'Branches to the right'], 'focus on the layout switch');
  await page.keyboard.press('Tab');
  assert.deepEqual([(await focused(page)).name], ['Map'], 'Tab: Map');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'List', 'Tab: List');
  await page.keyboard.press('Tab');
  let f = await focused(page);
  assert.deepEqual([f.role, f.node], ['treeitem', '0'], 'Tab: the tree, one stop, focus on the root');
  const seq: string[] = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowDown'); seq.push((await focused(page)).name); }
  assert.deepEqual(seq, ['Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'], '↓ in outline order');
  await page.keyboard.press('ArrowUp');
  assert.equal((await focused(page)).name, 'Lisabon', '↑ back');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await focused(page)).name, 'Místo', '← to the parent');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).name, 'Lisabon', '→ to the first child');
  await page.keyboard.press('Home');
  assert.equal((await focused(page)).name, 'Výjezd 2026', 'Home: first node');
  await page.keyboard.press('End');
  assert.equal((await focused(page)).name, 'Doprava', 'End: last node');
  const ring = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const s = getComputedStyle(a); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'; });
  assert.equal(ring, true, 'the focused node has a visible indicator');
  await page.keyboard.press('Tab');
  f = await focused(page);
  assert.notEqual(f.role, 'link', 'link chips inside nodes are not Tab stops');
});

// Slice MM2 (D-787): ⏎ or Space on a node opens the `Edit node` field (FR-MMP-02 AC-24) instead of switching to List.
test('fr_mmp_02_ac15_enter_space_and_cmd_enter_on_nodes', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  const prog = await needNode(fig, 'Program');
  await prog.focus();
  await page.keyboard.press('Enter');
  assert.ok(await seen(pendingNode(fig).or(nodeField(fig)), 1000), '⏎ on Program: a new sibling is edited in the field (R95), no view change');
  assert.equal(await viewOf(fig), 'map', 'still Map');
  await page.keyboard.press('Escape');
  assert.equal(await nodeField(fig).count(), 0, 'Esc closes the field');
  const p2 = await needNode(fig, 'Program');
  await p2.focus();
  await page.keyboard.press(' ');
  assert.equal((await fieldState(fig))?.value, 'Program', 'Space on Program: the field with its text (AC-24)');
  assert.equal(await viewOf(fig), 'map', 'still Map');
  await page.keyboard.press('Escape');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  await click(listBtn(fig), 'List');
  const c = await caretWhen(page, (x) => x.text === 'Program' && x.atEnd);
  assert.deepEqual([c.text, c.atEnd], ['Program', true], 'List: the caret at the end of the focused node (AP-750)');
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.equal(await viewOf(fig), 'list', 'Esc in the list: no view change');
  await click(mapBtn(fig), 'Map');
  fig = await needFigure(page, 'Výjezd 2026');
  const lis = await needNode(fig, 'Lisabon');
  await lis.focus();
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Lisabon', '⌘↩ on Lisabon opens it');
});

// ------------------------------------------------------------------------------------------------ AC-16

test('fr_mmp_02_ac16_mindmap_inside_an_embedded_note', async ({ page }) => {
  const core = await openMm(page, MM.vlozeni);
  const frame = await must(main(page).getByRole('group', { name: 'Embedded: Výjezd 2026', exact: true }), 'the full embed of Výjezd', 5000);
  const fig = await must(frame.getByRole('figure', { name: 'Mindmap: Výjezd 2026', exact: true }), 'the embedded mindmap block', 5000);
  assert.equal(await viewOf(fig), 'map', 'in Map');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'], 'the same tree as AC-1');
  await click(listBtn(fig), 'List in the embed');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'the embedded block switches to List');
  // Slice MM2 (D-788): a node click focuses the node and no longer moves the caret; the caret is placed in the list.
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava in the embedded list');
  await page.keyboard.type(' vlakem');
  const t = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('Doprava vlakem'));
  assert.equal(noModified(t), noModified(swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava vlakem\n')), 'only the callout bytes of Výjezd change');
  assert.equal(await fileText(core, MM.vlozeni), original(MM.vlozeni), 'Vložení is untouched');
  assert.deepEqual((await writes(core)).map((c) => (c.args as any).path.normalize('NFC')).filter((p: string) => p !== MM.vyjezd), [], 'no other write');
});
