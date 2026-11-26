// Slice MM3 follow-up, L5 (WebKit, fake core): the fold control on the node's edge, the `+` past it, the hover that
// reaches both (bug #170), spider ↑ / ↓ on one side, and E (docs/acceptance/mindmap.md part four, R234, R235; contract
// docs/contracts/mm-mindmap.md §7.7; D-2672…D-2676). FR-MMP-02 AC-55 (the control on the edge and reachable along a
// straight path; regression test bug_170_…), AC-56 (rendered controls and `+` within ±1 px of the layout with the real
// measurer, on the outer edge, not clipped), AC-57 (the `+` on leaves and folded nodes), AC-58 (↑ / ↓ on one side of
// Pavouk), AC-59 (E edits a node). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written from the
// ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  MM, MM2, addChildBtn, fieldState, fileText, fileWhen, focusNode, focused, foldControl, foldName, mapArea, needFigure, needNode,
  needTree, nodeField, noModified, openMm, original, pendingNode, seen, sleep, swap, treeNames, viewOf, writes, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ALL = ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'];
const PROGRAM_FOLDED = ['Výjezd 2026', 'Program', 'Místo', 'Lisabon', 'Doprava'];
const STROM_RAW = '> [!mindmap] Strom\n> - Kořen\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama';
const PAVOUK_RAW = '> [!mindmap|spider] Pavouk\n> - Střed\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama\n>   - Delta';

type Box = { x: number; y: number; width: number; height: number };
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const px = (n: number) => Math.round(n * 10) / 10;

async function readView(page: Page, path: string): Promise<FakeCoreHandle> {
  const core = await openMm(page, path, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  return core;
}
/** The page box of `loc` (hidden elements included: their layout box), or null when it is missing or has no size. */
async function boxOf(loc: Locator): Promise<Box | null> {
  if ((await loc.count()) === 0) return null;
  const b = await loc.first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  return b.width > 0 && b.height > 0 ? b : null;
}
/** Whether `btn` is shown (visibility, display, opacity) and is what the pointer hits at its centre. */
async function shownAndHit(btn: Locator): Promise<{ shown: boolean; hit: boolean; style: string }> {
  if ((await btn.count()) === 0) return { shown: false, hit: false, style: 'missing' };
  return btn.first().evaluate((b) => {
    const s = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { shown: s.visibility === 'visible' && s.display !== 'none' && Number(s.opacity) > 0 && r.width > 0, hit: !!e && b.contains(e), style: `visibility ${s.visibility}, opacity ${s.opacity}` };
  });
}
/** Moves the pointer to the centre of node `name`, then in 2 px steps in a straight line to the centre of `btn`,
 *  waiting 100 ms at each step (a hide delay can't mask a lost hover); returns every step where `btn` wasn't shown or
 *  wasn't hit at its centre. Leaves the pointer on the button's centre. */
async function straightPath(page: Page, fig: Locator, name: string, btn: Locator, what: string): Promise<{ bad: string[]; end: { x: number; y: number } | null }> {
  const n = await needNode(fig, name);
  const nb = (await n.boundingBox())!;
  const start = centre(nb);
  await page.mouse.move(start.x, start.y);
  await sleep(150);
  const bb = await boxOf(btn);
  if (!bb) return { bad: [`${what}: no button while ${name} is hovered`], end: null };
  const end = centre(bb);
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 2));
  const bad: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = { x: start.x + ((end.x - start.x) * i) / steps, y: start.y + ((end.y - start.y) * i) / steps };
    if (i > 0) await page.mouse.move(p.x, p.y);
    await sleep(100);
    const st = await shownAndHit(btn);
    if (!st.shown || !st.hit) bad.push(`${what}: step ${i}/${steps} at (${px(p.x - start.x)}, ${px(p.y - start.y)}) from ${name}'s centre: ${st.shown ? 'shown' : `not shown (${st.style})`}, ${st.hit ? 'hit' : 'not hit at its centre'}`);
  }
  return { bad, end };
}
/** `|a − b| ≤ 1` for both coordinates, else a message. */
function within1(what: string, got: { x: number; y: number } | null, want: { x: number; y: number }): string[] {
  if (!got) return [`${what}: missing`];
  return Math.abs(got.x - want.x) <= 1 && Math.abs(got.y - want.y) <= 1 ? [] : [`${what}: centre (${px(got.x)}, ${px(got.y)}) ≠ (${px(want.x)}, ${px(want.y)}) ± 1`];
}
async function controlCentre(loc: Locator) { const b = await boxOf(loc); return b ? centre(b) : null; }
async function rightEdge(fig: Locator, name: string) { const b = (await (await needNode(fig, name)).boundingBox())!; return { x: b.x + b.width, y: b.y + b.height / 2 }; }
async function leftEdge(fig: Locator, name: string) { const b = (await (await needNode(fig, name)).boundingBox())!; return { x: b.x, y: b.y + b.height / 2 }; }
async function hover(page: Page, fig: Locator, name: string) {
  const b = (await (await needNode(fig, name)).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(150);
}
/** The tree's items in DOM order, `pending` for the pending node. */
async function order(fig: Locator): Promise<string[]> {
  return fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('data-node') === 'pending' ? 'pending' : (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC')));
}
async function nodeId(fig: Locator, name: string): Promise<string | null> {
  return (await needNode(fig, name)).getAttribute('data-node');
}

// ------------------------------------------------------------------------------------------------ AC-55

test('bug_170_fr_mmp_02_ac55_the_straight_path_to_collapse_program_keeps_it_shown_and_a_click_folds', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const bad: string[] = [];
  await hover(page, fig, 'Program');
  const edge = await rightEdge(fig, 'Program');
  bad.push(...within1('Collapse Program on Program\'s right edge at its vertical centre', await controlCentre(foldControl(fig, 'Program')), edge));
  bad.push(...within1('Add child to Program 24 px right of that edge', await controlCentre(addChildBtn(fig, 'Program')), { x: edge.x + 24, y: edge.y }));
  const { bad: path, end } = await straightPath(page, fig, 'Program', foldControl(fig, 'Program'), 'Collapse Program');
  bad.push(...path);
  if (end) {
    await page.mouse.click(end.x, end.y);
    await sleep(200);
    const names = await treeNames(fig);
    if (names.join('|') !== PROGRAM_FOLDED.join('|')) bad.push(`a click at the control's centre doesn't fold Program: ${JSON.stringify(names)}`);
    if ((await foldName(fig, 'Program')) !== 'Expand Program, 2 hidden') bad.push(`after the click the control is ${JSON.stringify(await foldName(fig, 'Program'))}`);
    await page.mouse.move(2, 2);
    await sleep(150);
    const st = await shownAndHit(foldControl(fig, 'Program'));
    if (!st.shown) bad.push(`Expand Program isn't visible without hover (${st.style})`);
    if ((await foldControl(fig, 'Program').first().innerText().catch(() => '')).trim() !== '+2') bad.push('the folded control doesn\'t show +2');
    bad.push(...within1('Expand Program on Program\'s right edge after the re-layout', await controlCentre(foldControl(fig, 'Program')), await rightEdge(fig, 'Program')));
    const id = await nodeId(fig, 'Program');
    const stubs = await fig.locator(`path[data-from="${id}"]`).count();
    if (stubs !== 0) bad.push(`${stubs} connector(s) start at folded Program (no stub, D-2672)`);
  }
  await sleep(800);
  assert.deepEqual(await writes(core), [], 'folding writes nothing');
  assert.deepEqual(bad, [], 'bug #170: the fold control sits on the node\'s edge and stays shown along the straight path from the node; a click there folds');
});

test('fr_mmp_02_ac55_the_straight_path_to_add_child_keeps_it_shown_and_a_click_adds_a_child', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await hover(page, fig, 'Program');
  const edge = await rightEdge(fig, 'Program');
  const bad = within1('Add child to Program 24 px right of Program\'s right edge', await controlCentre(addChildBtn(fig, 'Program')), { x: edge.x + 24, y: edge.y });
  const { bad: path, end } = await straightPath(page, fig, 'Program', addChildBtn(fig, 'Program'), 'Add child to Program');
  bad.push(...path);
  if (end) {
    await page.mouse.click(end.x, end.y);
    if (!(await seen(pendingNode(fig), 1000))) bad.push('a click at the `+`\'s centre adds no pending child');
    else {
      const o = await order(fig);
      if (o.indexOf('pending') !== o.indexOf('Plán 2027') + 1) bad.push(`the pending child isn't after Plán 2027: ${JSON.stringify(o)}`);
      await page.keyboard.press('Escape');
    }
  }
  await sleep(800);
  assert.deepEqual(await writes(core), [], 'nothing written (the pending child was cancelled)');
  assert.deepEqual(bad, [], 'the `+` of a node with children sits 24 px past its edge and stays shown along the straight path (D-2673, bug #170)');
});

test('fr_mmp_02_ac55_pavouk_controls_sit_on_the_outer_edges', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  const bad: string[] = [];
  await hover(page, fig, 'Beta');
  const be = await leftEdge(fig, 'Beta');
  bad.push(...within1('Beta\'s control on its left edge', await controlCentre(foldControl(fig, 'Beta')), be));
  bad.push(...within1('Beta\'s `+` 24 px left of it', await controlCentre(addChildBtn(fig, 'Beta')), { x: be.x - 24, y: be.y }));
  const betaPath = await straightPath(page, fig, 'Beta', foldControl(fig, 'Beta'), 'Collapse Beta');
  bad.push(...betaPath.bad);
  const betaPlus = await straightPath(page, fig, 'Beta', addChildBtn(fig, 'Beta'), 'Add child to Beta');
  bad.push(...betaPlus.bad);
  await hover(page, fig, 'Střed');
  const se = await rightEdge(fig, 'Střed');
  bad.push(...within1('Střed\'s control on its right edge', await controlCentre(foldControl(fig, 'Střed')), se));
  bad.push(...within1('Střed\'s `+` 24 px right of it', await controlCentre(addChildBtn(fig, 'Střed')), { x: se.x + 24, y: se.y }));
  assert.deepEqual(bad, [], 'Pavouk: a left-side node\'s control on its left edge, its `+` past it; the spider root\'s on its right edge (R234)');
});

test('fr_mmp_02_ac55_read_view_control_on_the_edge_and_reachable', async ({ page }) => {
  const core = await readView(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await hover(page, fig, 'Program');
  const edge = await rightEdge(fig, 'Program');
  const bad = within1('the read view: Collapse Program on Program\'s right edge', await controlCentre(foldControl(fig, 'Program')), edge);
  const { bad: path, end } = await straightPath(page, fig, 'Program', foldControl(fig, 'Program'), 'read view, Collapse Program');
  bad.push(...path);
  if (end) {
    await page.mouse.click(end.x, end.y);
    await sleep(200);
    if ((await treeNames(fig)).join('|') !== PROGRAM_FOLDED.join('|')) bad.push('the read view: a click on the control doesn\'t fold Program');
  }
  await sleep(800);
  assert.deepEqual(await writes(core), [], 'the read view writes nothing');
  assert.deepEqual(bad, [], 'the read view: the control on the same point, reachable along the straight path');
});

// ------------------------------------------------------------------------------------------------ AC-56 (L5)

type Pt = Record<string, number[]>;
/** Rendered fold-control centres, `+` centres (each node hovered first) and boxes by `data-node`, relative to the map
 *  origin (padding 16 / 12), and the ids whose fold control or `+` (on a node with a fold control) is clipped. */
async function rendered(page: Page, fig: Locator): Promise<{ boxes: Pt; folds: Pt; plus: Pt; clipped: string[] }> {
  const ids = await fig.locator('[role="treeitem"]').evaluateAll((es) => es.map((e) => e.getAttribute('data-node') ?? ''));
  const out = { boxes: {} as Pt, folds: {} as Pt, plus: {} as Pt, clipped: [] as string[] };
  for (const id of ids) {
    const item = fig.locator(`[role="treeitem"][data-node="${id}"]`).first();
    const b = (await item.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(60);
    const r = await mapArea(fig).first().evaluate((area, nid) => {
      const a = area.getBoundingClientRect();
      const ox = a.left - area.scrollLeft + 16;
      const oy = a.top - area.scrollTop + 12;
      const e = area.querySelector(`[role="treeitem"][data-node="${CSS.escape(nid)}"]`) as HTMLElement;
      const box = e.getBoundingClientRect();
      const f = e.querySelector('[data-fold-control]');
      const p = e.querySelector('[data-add-child]');
      const c = (x: Element | null) => { if (!x) return null; const q = x.getBoundingClientRect(); return { c: [q.left + q.width / 2 - ox, q.top + q.height / 2 - oy], q }; };
      const inside = (q: DOMRect) => q.left >= a.left - area.scrollLeft - 0.5 && q.right <= a.left - area.scrollLeft + area.scrollWidth + 0.5 && q.top >= a.top - area.scrollTop - 0.5 && q.bottom <= a.top - area.scrollTop + area.scrollHeight + 0.5;
      const fc = c(f);
      const pc = p && getComputedStyle(p).visibility !== 'hidden' ? c(p) : null;
      return { box: [box.left - ox, box.top - oy, box.width, box.height], fold: fc?.c ?? null, plus: pc?.c ?? null, clipped: (fc && !inside(fc.q)) || (fc && pc && !inside(pc.q)) };
    }, id);
    out.boxes[id] = r.box;
    if (r.fold) out.folds[id] = r.fold;
    if (r.plus) out.plus[id] = r.plus;
    if (r.clipped) out.clipped.push(id);
  }
  await page.mouse.move(2, 2);
  return out;
}
/** `layoutMindmap` with a canvas measurer at the nodes' font and the given folds (mm-mindmap §7.1): boxes, fold and
 *  `+` points by id, and each node's side. */
async function realLayout(page: Page, fig: Locator, raw: string, title: string, folded: string[]): Promise<{ boxes: Pt; folds: Pt; plus: Pt; sides: Record<string, string | null> }> {
  const font = await fig.locator('[role="treeitem"]').first().evaluate((e) => getComputedStyle(e).font);
  const docUrl = `/@fs${resolve(import.meta.dirname, '../../packages/doc/src/index.ts')}`;
  return page.evaluate(async ([r, f, d, t, fo]) => {
    const lay = await import('/src/mindmap/layout.ts' as string);
    const doc = await import(d as string);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = f as string;
    const l = lay.layoutMindmap(doc.mindmapTree(r, t), (s: string) => ctx.measureText(s).width, { folded: new Set(fo as string[]) });
    const out = { boxes: {} as Record<string, number[]>, folds: {} as Record<string, number[]>, plus: {} as Record<string, number[]>, sides: {} as Record<string, string | null> };
    for (const n of l.nodes) {
      out.boxes[n.id] = [n.x, n.y, n.w, n.h];
      if (n.fold) out.folds[n.id] = [n.fold.x, n.fold.y];
      if (n.plus) out.plus[n.id] = [n.plus.x, n.plus.y];
      out.sides[n.id] = n.side ?? null;
    }
    return out;
  }, [raw, font, docUrl, title, folded] as const);
}
const near = (label: string, got: Pt, want: Pt, keys: string[]) =>
  keys.filter((k) => !got[k] || !want[k] || got[k].some((v, i) => Math.abs(v - want[k][i]) > 1)).map((k) => `${label} ${k}: rendered ${JSON.stringify(got[k]?.map(px))} vs layout ${JSON.stringify(want[k]?.map(px))}`);
/** R234 with the real measurer: a fold control on the outer edge at the vertical centre, its node's `+` 24 px past it. */
function onEdge(label: string, l: Awaited<ReturnType<typeof realLayout>>): string[] {
  const bad: string[] = [];
  for (const [id, [x, y, w, h]] of Object.entries(l.boxes)) {
    const f = l.folds[id];
    if (!f) continue;
    const left = l.sides[id] === 'left';
    const ex = left ? x : x + w;
    const px2 = left ? ex - 24 : ex + 24;
    if (Math.abs(f[0] - ex) > 0.5 || Math.abs(f[1] - (y + h / 2)) > 0.5) bad.push(`${label} ${id}: layout fold (${f.map(px)}) not on the outer edge (${px(ex)}, ${px(y + h / 2)})`);
    const p = l.plus[id];
    if (!p || Math.abs(p[0] - px2) > 0.5 || Math.abs(p[1] - (y + h / 2)) > 0.5) bad.push(`${label} ${id}: layout \`+\` (${p?.map(px)}) not 24 px past the edge (${px(px2)}, ${px(y + h / 2)})`);
  }
  return bad;
}
/** Hovers node `name` and clicks its fold control at its centre. */
async function fold(page: Page, fig: Locator, name: string) {
  await hover(page, fig, name);
  const c = await controlCentre(foldControl(fig, name));
  assert.ok(c, `setup: ${name} has a fold control (R230)`);
  await page.mouse.click(c!.x, c!.y);
  await sleep(200);
}

test('fr_mmp_02_ac56_rendered_controls_and_plus_follow_the_layout_on_strom', async ({ page }) => {
  test.setTimeout(90_000);
  await openMm(page, MM.rozlozeni);
  const fig = await needFigure(page, 'Strom');
  await needTree(fig, 'Strom');
  const bad: string[] = [];
  for (const [label, folded, names] of [['nothing folded', [], []], ['Alfa folded', ['0.0'], ['Alfa']], ['Kořen folded', ['0'], ['Kořen']]] as [string, string[], string[]][]) {
    for (const n of names) await fold(page, fig, n);
    const got = await rendered(page, fig);
    const want = await realLayout(page, fig, STROM_RAW, 'Rozložení', folded);
    const ids = Object.keys(want.boxes);
    bad.push(...near(`${label}: box`, got.boxes, want.boxes, ids));
    bad.push(...near(`${label}: fold`, got.folds, want.folds, Object.keys(want.folds)));
    bad.push(...near(`${label}: +`, got.plus, want.plus, ids));
    bad.push(...onEdge(label, want));
    bad.push(...got.clipped.map((id) => `${label}: the control or \`+\` of ${id} lies outside the map area`));
    for (const n of names) await fold(page, fig, n);
  }
  assert.deepEqual(bad, [], 'Strom: every fold control and shown `+` within ±1 px of the layout (R234: on the edge, `+` 24 px past it); none clipped');
});

test('fr_mmp_02_ac56_rendered_controls_and_plus_follow_the_layout_on_pavouk', async ({ page }) => {
  test.setTimeout(90_000);
  await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  const bad: string[] = [];
  for (const [label, folded, names] of [['nothing folded', [], []], ['Alfa folded', ['0.0'], ['Alfa']], ['Beta folded', ['0.1'], ['Beta']]] as [string, string[], string[]][]) {
    for (const n of names) await fold(page, fig, n);
    const got = await rendered(page, fig);
    const want = await realLayout(page, fig, PAVOUK_RAW, 'Pavouk', folded);
    const ids = Object.keys(want.boxes);
    bad.push(...near(`${label}: box`, got.boxes, want.boxes, ids));
    bad.push(...near(`${label}: fold`, got.folds, want.folds, Object.keys(want.folds)));
    bad.push(...near(`${label}: +`, got.plus, want.plus, ids));
    bad.push(...onEdge(label, want));
    bad.push(...got.clipped.map((id) => `${label}: the control or \`+\` of ${id} lies outside the map area`));
    for (const n of names) await fold(page, fig, n);
  }
  assert.deepEqual(bad, [], 'Pavouk (spider): controls on the outer edges (left side mirrored), `+` 24 px past them, within ±1 px of the layout; none clipped (D-2676)');
});

// ------------------------------------------------------------------------------------------------ AC-57

test('fr_mmp_02_ac57_the_plus_on_a_leaf_and_on_folded_program', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const bad: string[] = [];
  await hover(page, fig, 'Doprava');
  bad.push(...within1('Add child to Doprava (a leaf) on its right edge', await controlCentre(addChildBtn(fig, 'Doprava')), await rightEdge(fig, 'Doprava')));
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'setup: Space folds Program');
  await hover(page, fig, 'Program');
  const edge = await rightEdge(fig, 'Program');
  const ctl = await boxOf(foldControl(fig, 'Program'));
  const plus = await boxOf(addChildBtn(fig, 'Program'));
  if ((await foldName(fig, 'Program')) !== 'Expand Program, 2 hidden') bad.push(`the control is ${JSON.stringify(await foldName(fig, 'Program'))}`);
  bad.push(...within1('Expand Program on Program\'s edge', ctl ? centre(ctl) : null, edge));
  bad.push(...within1('Add child to Program 24 px right of the edge', plus ? centre(plus) : null, { x: edge.x + 24, y: edge.y }));
  const st = await shownAndHit(addChildBtn(fig, 'Program'));
  if (!st.shown) bad.push(`hovering folded Program doesn't show its \`+\` (${st.style})`);
  if (ctl && plus && ctl.x < plus.x + plus.width && plus.x < ctl.x + ctl.width && ctl.y < plus.y + plus.height && plus.y < ctl.y + ctl.height) bad.push(`the control ${JSON.stringify(ctl)} and the \`+\` ${JSON.stringify(plus)} overlap`);
  if (plus) {
    const { bad: path, end } = await straightPath(page, fig, 'Program', addChildBtn(fig, 'Program'), 'Add child to folded Program');
    bad.push(...path);
    if (end) {
      await page.mouse.click(end.x, end.y);
      if (!(await seen(pendingNode(fig), 1000))) bad.push('clicking the `+` adds no pending child');
      else {
        const o = await order(fig);
        if (o.slice(0, 5).join('|') !== ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'pending'].join('|')) bad.push(`the click doesn't unfold Program and add the child after Plán 2027: ${JSON.stringify(o)}`);
        await page.keyboard.press('Escape');
      }
    }
  }
  await sleep(800);
  assert.deepEqual(await writes(core), [], 'nothing written');
  assert.deepEqual(bad, [], 'R234: the leaf\'s `+` on its edge; a folded node\'s `+2` on its edge and its `+` 24 px past it, not overlapping; the click unfolds and adds the child (D-2673)');
});

// ------------------------------------------------------------------------------------------------ AC-58

/** Presses each key and records the focused node's name after it. */
async function steps(page: Page, keys: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const k of keys) {
    await page.keyboard.press(k);
    await sleep(60);
    const f = await focused(page);
    out.push(f.role === 'treeitem' ? f.name : `${f.role} "${f.name}"`);
  }
  return out;
}
async function walk(page: Page, fig: Locator, start: string, keys: string[]): Promise<string[]> {
  await focusNode(fig, start);
  return steps(page, keys);
}

test('fr_mmp_02_ac58_up_and_down_stay_on_one_side_of_pavouk', async ({ page }) => {
  const core = await openMm(page, MM2.pavouk);
  const p = await needFigure(page, 'Pavouk');
  await needTree(p, 'Pavouk');
  const before = await fileText(core, MM2.pavouk);
  assert.deepEqual({
    '↓ from Alfa': await walk(page, p, 'Alfa', ['ArrowDown', 'ArrowDown']),
    '↑ from Gama': await walk(page, p, 'Gama', ['ArrowUp', 'ArrowUp']),
    '↓ from Beta': await walk(page, p, 'Beta', ['ArrowDown', 'ArrowDown']),
    '↑ from Delta': await walk(page, p, 'Delta', ['ArrowUp', 'ArrowUp']),
    '↓ from A1': await walk(page, p, 'A1', ['ArrowDown', 'ArrowDown']),
    '↑ ↓ on B1': await walk(page, p, 'B1', ['ArrowUp', 'ArrowDown']),
    '↑ ↓ on Střed': await walk(page, p, 'Střed', ['ArrowUp', 'ArrowDown']),
  }, {
    '↓ from Alfa': ['Gama', 'Gama'],
    '↑ from Gama': ['Alfa', 'Alfa'],
    '↓ from Beta': ['Delta', 'Delta'],
    '↑ from Delta': ['Beta', 'Beta'],
    '↓ from A1': ['A2', 'A2'],
    '↑ ↓ on B1': ['B1', 'B1'],
    '↑ ↓ on Střed': ['Střed', 'Střed'],
  }, 'R235 (D-2674): siblings on the same side, then the same depth on that side; stops at the ends; nothing on the root');
  assert.equal(await nodeField(p).count(), 0, 'no field opened');
  assert.equal(await viewOf(p), 'map', 'the view stays Map');
  const v = await needFigure(page, 'Pavouk');
  assert.equal(await treeNames(v).then((n) => n.length), 8, 'nothing folded or changed');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'none of these keys writes');
  assert.equal(await fileText(core, MM2.pavouk), before, 'Pavouk unchanged');
});

test('fr_mmp_02_ac58_vyjezd_right_walks_are_unchanged_and_pavouk_follows_its_side', async ({ page }) => {
  // In `right` AC-54's walks stand; the test also walks Pavouk so that it is red until the build (TS-I1, as RT-8).
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const vy = {
    '↓ from Program': await walk(page, fig, 'Program', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Doprava': await steps(page, ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    '↓ from Přehled Q4': await walk(page, fig, 'Přehled Q4', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Lisabon': await steps(page, ['ArrowUp', 'ArrowUp', 'ArrowUp']),
  };
  await sleep(800);
  const vyWrites = (await writes(core)).length;
  await openMm(page, MM2.pavouk);
  const p = await needFigure(page, 'Pavouk');
  await needTree(p, 'Pavouk');
  assert.deepEqual({ ...vy, 'Pavouk: ↓ from A2': await walk(page, p, 'A2', ['ArrowDown']), 'Pavouk: ↑ from B1': await walk(page, p, 'B1', ['ArrowUp']) }, {
    '↓ from Program': ['Místo', 'Doprava', 'Doprava'],
    '↑ from Doprava': ['Místo', 'Program', 'Program'],
    '↓ from Přehled Q4': ['Plán 2027', 'Lisabon', 'Lisabon'],
    '↑ from Lisabon': ['Plán 2027', 'Přehled Q4', 'Přehled Q4'],
    'Pavouk: ↓ from A2': ['A2'],
    'Pavouk: ↑ from B1': ['B1'],
  }, 'Výjezd (`right`): AC-54 unchanged; Pavouk: no crossing to the other side');
  assert.equal(vyWrites, 0, 'Výjezd: nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-59

test('fr_mmp_02_ac59_e_opens_the_field_like_f2_and_not_with_modifiers', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const got: Record<string, string | null> = {};
  for (const key of ['e', 'Shift+E']) {
    await focusNode(fig, 'Plán 2027');
    await page.keyboard.press(key);
    await sleep(150);
    got[key] = (await fieldState(fig))?.value ?? null;
    await page.keyboard.press('Escape');
    await sleep(100);
    got[`${key} then Esc`] = (await nodeField(fig).count()) === 0 ? 'closed' : 'open';
  }
  for (const key of ['Meta+e', 'Control+e', 'Alt+e']) {
    await focusNode(fig, 'Plán 2027');
    await page.keyboard.press(key);
    await sleep(150);
    got[key] = (await nodeField(fig).count()) === 0 ? 'no field' : `field ${JSON.stringify((await fieldState(fig))?.value)}`;
    if ((await nodeField(fig).count()) > 0) await page.keyboard.press('Escape');
  }
  assert.deepEqual(got, {
    e: 'Plán 2027', 'e then Esc': 'closed', 'Shift+E': 'Plán 2027', 'Shift+E then Esc': 'closed', 'Meta+e': 'no field', 'Control+e': 'no field', 'Alt+e': 'no field',
  }, 'R235 (D-2675): E and ⇧E open `Edit node` holding the node\'s text (the `e` isn\'t typed); Esc closes it; ⌘E, ⌃E, ⌥E open nothing');
  assert.deepEqual(await treeNames(fig), ALL, 'the tree is unchanged');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
});

test('fr_mmp_02_ac59_e_on_folded_program_keeps_the_fold_and_saves_the_rename', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'setup: Program folded');
  await page.keyboard.press('e');
  await sleep(150);
  const st = await fieldState(fig);
  assert.deepEqual(st && { value: st.value, caretAtEnd: st.caretAtEnd }, { value: 'Program', caretAtEnd: true }, '`e` on folded Program opens its field with the caret at the end (R95a)');
  assert.equal(await fig.getByRole('treeitem', { name: 'Přehled Q4', exact: true }).count(), 0, 'Program stays folded');
  await page.keyboard.type(' 2');
  await page.keyboard.press('Enter');
  const want = swap(original(MM.vyjezd), '>   - Program\n', '>   - Program 2\n');
  assert.equal(noModified(await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(want), 4000)), noModified(want), '`Program 2` ⏎ saves the renamed item, as F2\'s edit would (W17\'s rule)');
});

test('fr_mmp_02_ac59_e_opens_nothing_on_a_synthesized_root_in_the_read_view_or_a_read_only_note', async ({ page }) => {
  // The editor's `e` on Doprava first shows the build has E (so the test is red before it, TS-I1, as RT-8).
  let core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('e');
  await sleep(150);
  const opened = (await fieldState(fig))?.value ?? null;
  if (opened !== null) await page.keyboard.press('Escape');
  const bad: string[] = [];
  if (opened !== 'Doprava') bad.push(`editor: \`e\` on Doprava opens ${JSON.stringify(opened)}, not its field`);
  await sleep(600);
  if ((await writes(core)).length) bad.push('editor: Esc wrote');
  core = await openMm(page, MM.vice);
  fig = await needFigure(page, 'Témata');
  await focusNode(fig, 'Témata');
  await page.keyboard.press('e');
  await sleep(300);
  if (await seen(nodeField(fig), 200)) bad.push('Více kořenů: `e` on the synthesized root Témata opens a field');
  if ((await treeNames(fig)).join('|') !== ['Témata', 'Rodina', 'Práce', 'Porady', 'Zdraví'].join('|')) bad.push(`Více kořenů: the tree changed: ${JSON.stringify(await treeNames(fig))}`);
  await sleep(800);
  if ((await writes(core)).length) bad.push('Více kořenů: something was written');
  for (const [path, title, nodeName] of [[MM.vyjezd, 'Výjezd 2026', 'Plán 2027'], [MM.neplatna, 'Jen ke čtení', 'Druhá větev']] as const) {
    const rcore = await readView(page, path);
    const r = await needFigure(page, title);
    await needTree(r, title);
    await focusNode(r, nodeName);
    await page.keyboard.press('e');
    await sleep(300);
    if (await seen(nodeField(r), 200)) bad.push(`${title} (read view / read-only): \`e\` opens a field`);
    await sleep(800);
    if ((await writes(rcore)).length) bad.push(`${title}: something was written`);
    if ((await fileText(rcore, path)) !== original(path)) bad.push(`${title}: the file changed`);
  }
  assert.deepEqual(bad, [], 'E edits the focused node in the editor only; never on a synthesized root, in the read view or a read-only note (D-2675)');
});
