// Slice MM3, L5 (WebKit, fake core): the fold control, the mouse `+`, folds as view state, read views, embeds, themes,
// accessibility and strings (docs/acceptance/mindmap.md part three, R230, R233; contract docs/contracts/mm-mindmap.md §7).
// FR-MMP-02 AC-42 (the fold control), AC-43 (rendered boxes and controls within ±1 px of the layout with folds), AC-45
// (folds are view state of the open note), AC-46 (read view and read-only notes), AC-47 (the mouse `+`, W33, W34), AC-52
// (in an embedded note), FR-UX-08 AC-30 (VoiceOver: `aria-expanded`, names, not Tab stops, axe), FR-UX-05 AC-29 (both
// themes), NFR-OTH-02 AC-27 (pseudo-locale). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written
// from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  MM, MM2, addChildBtn, click, dragState, dragTo, eventually, expanded, fileText, fileWhen, focusNode, focused, foldControl, foldName,
  gotoNote, listBtn, main, mapArea, mapBtn, must, mustBeOn, needFigure, needNode, needTree, nodeField, noModified, openMm,
  original, pendingNode, seen, sleep, swap, treeNames, viewOf, visible, writes, zonePoint, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ALL = ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'];
const PROGRAM_FOLDED = ['Výjezd 2026', 'Program', 'Místo', 'Lisabon', 'Doprava'];
const W16 = (t: string | undefined) => swap(t, '>   - Doprava\n', '>   - Doprava\n>     - Vlak\n');
const W19 = (t: string | undefined) => swap(t, '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n',
  '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n');

async function savedAs(core: FakeCoreHandle, path: string, want: string, ms = 4000): Promise<string | undefined> {
  return fileWhen(core, path, (x) => noModified(x) === noModified(want), ms);
}
/** Hovers node `name`, then clicks its fold control. */
async function clickFold(page: Page, fig: Locator, name: string) {
  await (await needNode(fig, name)).hover();
  const c = foldControl(fig, name);
  assert.equal(await c.count(), 1, `${name}: one fold control (R230)`);
  await c.first().click();
  await sleep(100);
}
/** Hovers node `name`, then clicks `Add child to <name>`. */
async function clickPlus(fig: Locator, name: string) {
  await (await needNode(fig, name)).hover();
  const b = addChildBtn(fig, name);
  assert.equal(await b.count(), 1, `${name}: one button "Add child to ${name}" (R230)`);
  assert.ok(await visible(b), `"Add child to ${name}" is shown on hover`);
  await b.first().click();
}
async function readView(page: Page, path: string): Promise<FakeCoreHandle> {
  const core = await openMm(page, path, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  return core;
}
function lum(rgb: string): number {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(rgb);
  assert.ok(m, `a colour: ${rgb}`);
  const c = [m![1], m![2], m![3]].map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const p = document.createElement('span');
    document.body.appendChild(p);
    p.style.color = `var(--${n})`;
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);
}

// ------------------------------------------------------------------------------------------------ AC-42

test('fr_mmp_02_ac42_the_fold_control', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const names: Record<string, string | null> = {};
  for (const n of ALL) names[n] = await foldName(fig, n);
  assert.deepEqual(names, { 'Výjezd 2026': 'Collapse Výjezd 2026', Program: 'Collapse Program', 'Přehled Q4': null, 'Plán 2027': null, Místo: 'Collapse Místo', Lisabon: null, Doprava: null },
    'one `Collapse <node>` button on each node with children, none on leaves');
  await page.mouse.move(2, 2);
  assert.equal(await visible(foldControl(fig, 'Program')), false, 'not visible until its node is hovered or focused');
  await (await needNode(fig, 'Program')).hover();
  assert.equal(await visible(foldControl(fig, 'Program')), true, 'visible on hover');
  await foldControl(fig, 'Program').first().click();
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'a click folds Program');
  assert.equal(await foldName(fig, 'Program'), 'Expand Program, 2 hidden', 'the button becomes Expand Program, 2 hidden');
  assert.equal((await foldControl(fig, 'Program').first().innerText()).trim(), '+2', 'with the text +2');
  await page.mouse.move(2, 2);
  assert.equal(await visible(foldControl(fig, 'Program')), true, 'visible without hover while folded');
  assert.deepEqual([(await focused(page)).role, (await focused(page)).name], ['treeitem', 'Program'], 'the focus is on Program (AP-2115)');
  const ds = await dragState(fig);
  assert.deepEqual([ds.dragging, ds.zone, ds.origin, ds.ghost], [null, null, 0, 0], 'the click started no drag');
  assert.equal(await nodeField(fig).count(), 0, 'no field');
  assert.equal(await viewOf(fig), 'map', 'no view switch');
  await foldControl(fig, 'Program').first().click();
  assert.deepEqual(await treeNames(fig), ALL, 'clicking it again unfolds');
  await clickFold(page, fig, 'Program');
  await clickFold(page, fig, 'Výjezd 2026');
  assert.equal(await foldName(fig, 'Výjezd 2026'), 'Expand Výjezd 2026, 6 hidden', 'folding the root: 6 hidden');
  await foldControl(fig, 'Výjezd 2026').first().click();
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'unfolding the root shows Program still folded');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  const rcore = await readView(page, MM.vyjezd);
  const r = await needFigure(page, 'Výjezd 2026');
  await needTree(r, 'Výjezd 2026');
  await clickFold(page, r, 'Program');
  assert.deepEqual(await treeNames(r), PROGRAM_FOLDED, 'the read view: the control folds');
  await foldControl(r, 'Program').first().click();
  assert.deepEqual(await treeNames(r), ALL, 'and unfolds');
  await sleep(1200);
  assert.deepEqual(await writes(rcore), [], 'the read view writes nothing');
});

// ------------------------------------------------------------------------------------------------ AC-43 (L5)

/** Rendered boxes by `data-node` and fold-control centres by node id, relative to the map origin. */
async function rendered(fig: Locator): Promise<{ boxes: Record<string, number[]>; folds: Record<string, number[]>; clipped: string[] }> {
  return mapArea(fig).first().evaluate((area) => {
    const a = area.getBoundingClientRect();
    const ox = a.left - area.scrollLeft + 16;
    const oy = a.top - area.scrollTop + 12;
    const boxes: Record<string, number[]> = {};
    const folds: Record<string, number[]> = {};
    const clipped: string[] = [];
    for (const e of area.querySelectorAll('[role="treeitem"]') as NodeListOf<HTMLElement>) {
      const r = e.getBoundingClientRect();
      const id = e.getAttribute('data-node') ?? '';
      boxes[id] = [r.left - ox, r.top - oy, r.width, r.height];
      const f = e.querySelector('[data-fold-control]');
      if (f) {
        const b = f.getBoundingClientRect();
        folds[id] = [b.left + b.width / 2 - ox, b.top + b.height / 2 - oy];
        if (b.left < a.left - area.scrollLeft - 0.5 || b.right > a.left - area.scrollLeft + area.scrollWidth + 0.5 || b.top < a.top - area.scrollTop - 0.5 || b.bottom > a.top - area.scrollTop + area.scrollHeight + 0.5) clipped.push(id);
      }
    }
    return { boxes, folds, clipped };
  });
}
/** The layout with a canvas measurer at the nodes' font and the given folds (mm-mindmap §7.1). */
async function realLayout(page: Page, fig: Locator, raw: string, title: string, folded: string[]): Promise<{ boxes: Record<string, number[]>; folds: Record<string, number[]> }> {
  const font = await fig.locator('[role="treeitem"]').first().evaluate((e) => getComputedStyle(e).font);
  const { resolve } = await import('node:path');
  const docUrl = `/@fs${resolve(import.meta.dirname, '../../packages/doc/src/index.ts')}`;
  return page.evaluate(async ([r, f, d, t, fo]) => {
    const lay = await import('/src/mindmap/layout.ts' as string);
    const doc = await import(d as string);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = f as string;
    const l = lay.layoutMindmap(doc.mindmapTree(r, t), (s: string) => ctx.measureText(s).width, { folded: new Set(fo as string[]) });
    const boxes: Record<string, number[]> = {};
    const folds: Record<string, number[]> = {};
    for (const n of l.nodes) {
      boxes[n.id] = [n.x, n.y, n.w, n.h];
      if (n.fold) folds[n.id] = [n.fold.x, n.fold.y];
    }
    return { boxes, folds };
  }, [raw, font, docUrl, title, folded] as const);
}
const near = (a: Record<string, number[]>, b: Record<string, number[]>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !a[k] || !b[k] || a[k].some((v, i) => Math.abs(v - b[k][i]) > 1)).map((k) => `${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`);
const STROM_RAW = '> [!mindmap] Strom\n> - Kořen\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama';

test('fr_mmp_02_ac43_rendered_boxes_and_controls_follow_the_folded_layout', async ({ page }) => {
  await openMm(page, MM.rozlozeni);
  const fig = await needFigure(page, 'Strom');
  await needTree(fig, 'Strom');
  const bad: string[] = [];
  for (const folded of [['0.0'], ['0']]) {
    for (const id of folded) {
      const name = id === '0' ? 'Kořen' : 'Alfa';
      await clickFold(page, fig, name);
    }
    await sleep(200);
    const got = await rendered(fig);
    const want = await realLayout(page, fig, STROM_RAW, 'Rozložení', folded);
    bad.push(...near(got.boxes, want.boxes).map((s) => `folded ${folded}: box ${s}`));
    bad.push(...near(got.folds, want.folds).map((s) => `folded ${folded}: control ${s}`));
    bad.push(...got.clipped.map((id) => `folded ${folded}: the control of ${id} lies outside the map area`));
    for (const id of folded) await foldControl(fig, id === '0' ? 'Kořen' : 'Alfa').first().click();
    await sleep(200);
  }
  const after = await rendered(fig);
  const unfolded = await realLayout(page, fig, STROM_RAW, 'Rozložení', []);
  bad.push(...near(after.boxes, unfolded.boxes).map((s) => `after unfolding: ${s}`));
  assert.ok(Object.keys(after.folds).length === 3, `three fold controls on Strom (Kořen, Alfa, Beta): ${JSON.stringify(Object.keys(after.folds))}`);
  assert.deepEqual(bad, [], 'every rendered box and control centre within ±1 px of layoutMindmap with the real measurer; none clipped');
});

// ------------------------------------------------------------------------------------------------ AC-45

test('fr_mmp_02_ac45_folds_write_nothing_and_end_with_the_view', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  const ver0 = await core.version(MM.vyjezd);
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await focusNode(fig, 'Místo');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Program', 'Místo', 'Doprava'], 'Program and Místo folded');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'no note_write');
  assert.deepEqual(await core.version(MM.vyjezd), ver0, 'the file\'s version (bytes, mtime) unchanged');
  assert.ok(!/mindmap|fold|collapsed/i.test(JSON.stringify(await core.uiState())), 'ui-state.json gains no fold key');
  await click(listBtn(fig), 'List');
  await click(mapBtn(fig), 'Map');
  assert.deepEqual(await treeNames(fig), ALL, 'List and back to Map: unfolded');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await gotoNote(page, 'Lisabon');
  await click(page.getByRole('button', { name: 'Back', exact: true }), 'Back');
  await mustBeOn(page, 'Výjezd 2026', 'Back');
  fig = await needFigure(page, 'Výjezd 2026');
  assert.deepEqual(await eventually(() => treeNames(fig), (n) => n.length > 0), ALL, 'Lisabon and Back: unfolded');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await gotoNote(page, 'Výjezd 2026');
  fig = await needFigure(page, 'Výjezd 2026');
  assert.deepEqual(await eventually(() => treeNames(fig), (n) => n.length > 0), ALL, 'reopening the note: unfolded');
});

test('fr_mmp_02_ac45_folds_survive_edits_drops_and_undo_while_the_note_stays_open', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await page.keyboard.press('Alt+ArrowDown');
  const w19 = W19(original(MM.vyjezd));
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w19)), noModified(w19), '⌥↓ on folded Program: W19\'s bytes');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Místo', 'Lisabon', 'Program', 'Doprava'], 'Program stays folded');
  await focusNode(fig, 'Místo');
  await page.keyboard.press(' ');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), '⌘Z after a fold undoes the last list edit (W19), not the fold');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Program', 'Místo', 'Doprava'], 'Program and Místo still folded after the undo');
  await dragTo(page, fig, 'Doprava', await zonePoint(fig, 'Místo', 'before'));
  const dropped = swap(original(MM.vyjezd), '>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n', '>   - Doprava\n>   - Místo\n>     - [[Lisabon]]\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, dropped)), noModified(dropped), 'a drop of Doprava before Místo');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Program', 'Doprava', 'Místo'], 'the folds survive the drop');
  await core.setFile(MM.vyjezd, swap((await fileText(core, MM.vyjezd))!, '>   - Doprava\n', '>   - Doprava\n>   - Hotel\n'));
  assert.deepEqual(await eventually(() => treeNames(fig), (n) => n.includes('Hotel'), 3000), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Doprava', 'Hotel', 'Místo', 'Lisabon'],
    'an external change that reloads the block shows it unfolded (AP-2115)');
});

// ------------------------------------------------------------------------------------------------ AC-46

test('fr_mmp_02_ac46_read_view_and_read_only_notes_fold_but_never_edit', async ({ page }) => {
  test.setTimeout(120_000);
  const cases: [string, string, string, string, string][] = [
    // [path, figure title, a node with children, a node to drag, the node to drag over]
    [MM.vyjezd, 'Výjezd 2026', 'Program', 'Doprava', 'Místo'],
    [MM2.pavouk, 'Pavouk', 'Alfa', 'Gama', 'Alfa'],
    [MM.neplatna, 'Jen ke čtení', 'Jen ke čtení', 'Druhá větev', 'Výjezd 2026'],
  ];
  const bad: string[] = [];
  for (const [path, title, parent, dragged, over] of cases) {
    const core = await readView(page, path);
    const fig = await needFigure(page, title);
    await needTree(fig, title);
    const all = await treeNames(fig);
    await focusNode(fig, parent);
    await page.keyboard.press(' ');
    if ((await treeNames(fig)).length >= all.length) bad.push(`${title}: Space didn't fold ${parent}`);
    await page.keyboard.press(' ');
    await clickFold(page, fig, parent);
    if ((await treeNames(fig)).length >= all.length) bad.push(`${title}: the control didn't fold ${parent}`);
    await foldControl(fig, parent).first().click();
    for (const n of all) {
      await (await needNode(fig, n)).hover();
      if ((await addChildBtn(fig, n).count()) > 0) bad.push(`${title}: an "Add child to ${n}" button`);
    }
    const b = (await (await needNode(fig, over)).boundingBox())!;
    await dragTo(page, fig, dragged, { x: b.x + b.width / 2, y: b.y + b.height * 0.75 }, { release: false });
    const ds = await dragState(fig);
    if (ds.zone || ds.dragging || ds.origin || ds.ghost) bad.push(`${title}: a drag shows ${JSON.stringify(ds)}`);
    await page.mouse.up();
    if ((await treeNames(fig)).join('|') !== all.join('|')) bad.push(`${title}: the drag moved something`);
    await focusNode(fig, dragged);
    await page.keyboard.press('F2');
    await (await needNode(fig, dragged)).dblclick();
    if (await seen(nodeField(fig), 300)) bad.push(`${title}: a field opened`);
    await sleep(1200);
    if ((await writes(core)).length) bad.push(`${title}: ${(await writes(core)).length} note_write`);
    if ((await fileText(core, path)) !== original(path)) bad.push(`${title}: the file changed`);
  }
  assert.deepEqual(bad, [], 'Space and the controls fold; no `+`; a drag moves nothing; no field; nothing written (D-2487…D-2489)');
});

// ------------------------------------------------------------------------------------------------ AC-47

test('fr_mmp_02_ac47_the_plus_shows_on_hover_and_focus_and_adds_a_child_w33', async ({ page }) => {
  let core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await (await needNode(fig, 'Doprava')).hover();
  const plus = addChildBtn(fig, 'Doprava');
  assert.equal(await plus.count(), 1, 'one button "Add child to Doprava"');
  assert.ok(await visible(plus), 'shown on hover');
  const box = (await (await needNode(fig, 'Doprava')).boundingBox())!;
  const pb = (await plus.first().boundingBox())!;
  assert.ok(Math.abs(pb.x + pb.width / 2 - (box.x + box.width)) <= 1 && Math.abs(pb.y + pb.height / 2 - (box.y + box.height / 2)) <= 1,
    `centred on the node's right edge at its vertical centre: ${JSON.stringify([pb.x + pb.width / 2, pb.y + pb.height / 2])} vs ${JSON.stringify([box.x + box.width, box.y + box.height / 2])}`);
  await page.mouse.move(2, 2);
  assert.equal(await visible(plus), false, 'moving away hides it');
  await focusNode(fig, 'Doprava');
  assert.equal(await visible(plus), true, 'focusing Doprava by keyboard shows it');
  await clickPlus(fig, 'Doprava');
  assert.ok(await seen(pendingNode(fig), 1000), 'a pending child (R95)');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written while editing');
  assert.equal(await visible(addChildBtn(fig, 'Doprava')), false, 'no `+` on a node being edited');
  await page.keyboard.press('Escape');
  assert.equal(await pendingNode(fig).count(), 0, 'Esc removes it');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'and writes nothing');
  await clickPlus(fig, 'Doprava');
  await page.keyboard.type('Vlak');
  await page.keyboard.press('Enter');
  const w33 = W16(original(MM.vyjezd));
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w33)), noModified(w33), 'Vlak ⏎: W33 (= W16)');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), 'the click and the commit are one undo step (AC-26)');
  core = await openMm(page, MM.vyjezd);
  fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await clickPlus(fig, 'Program');
  const order = await fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('data-node') === 'pending' ? 'pending' : (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
  assert.deepEqual(order.slice(0, 5), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'pending'], 'on folded Program: unfolds, then the child after Plán 2027');
  await page.keyboard.press('Escape');
});

test('fr_mmp_02_ac47_the_plus_in_pavouk_w34', async ({ page }) => {
  const core = await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  await (await needNode(fig, 'Beta')).hover();
  const beta = (await (await needNode(fig, 'Beta')).boundingBox())!;
  assert.equal(await addChildBtn(fig, 'Beta').count(), 1, 'Beta has one `+`');
  const bp = await addChildBtn(fig, 'Beta').first().boundingBox();
  assert.ok(bp && Math.abs(bp.x + bp.width / 2 - beta.x) <= 1, `Beta (left side): the \`+\` on its left edge: ${JSON.stringify(bp)} vs x ${beta.x}`);
  await (await needNode(fig, 'Střed')).hover();
  assert.equal(await addChildBtn(fig, 'Střed').count(), 1, 'Střed has exactly one `+`');
  const s = (await (await needNode(fig, 'Střed')).boundingBox())!;
  const sp = await addChildBtn(fig, 'Střed').first().boundingBox();
  assert.ok(sp && Math.abs(sp.x + sp.width / 2 - (s.x + s.width)) <= 1, `on its right edge: ${JSON.stringify(sp)} vs ${s.x + s.width}`);
  await addChildBtn(fig, 'Střed').first().click();
  await page.keyboard.type('Epsilon');
  await page.keyboard.press('Enter');
  const w34 = swap(original(MM2.pavouk), '>   - Delta\n', '>   - Delta\n>   - Epsilon\n');
  assert.equal(noModified(await savedAs(core, MM2.pavouk, w34)), noModified(w34), 'W34');
  const side = await eventually(() => fig.getByRole('treeitem', { name: 'Epsilon', exact: true }).getAttribute('data-side', { timeout: 500 }).catch(() => null), (x) => x !== null, 2000);
  assert.equal(side, 'right', 'Epsilon drawn right (the 5th branch, D-789)');
});

// ------------------------------------------------------------------------------------------------ AC-52

test('fr_mmp_02_ac52_in_an_embedded_note', async ({ page }) => {
  let core = await openMm(page, MM.vlozeni);
  const embedded = async () => {
    const frame = await must(main(page).getByRole('group', { name: 'Embedded: Výjezd 2026', exact: true }), 'the full embed of Výjezd', 5000);
    return must(frame.getByRole('figure', { name: 'Mindmap: Výjezd 2026', exact: true }), 'the embedded mindmap', 5000);
  };
  let fig = await embedded();
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'Space folds Program in the embed');
  await page.keyboard.press(' ');
  await clickPlus(fig, 'Doprava');
  await page.keyboard.type('Vlak');
  await page.keyboard.press('Enter');
  const w16 = W16(original(MM.vyjezd));
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w16)), noModified(w16), 'W16 written to Pages/Výjezd 2026.md');
  assert.equal(await fileText(core, MM.vlozeni), original(MM.vlozeni), 'Vložení untouched');
  core = await openMm(page, MM.vlozeni);
  fig = await embedded();
  await dragTo(page, fig, 'Program', await zonePoint(fig, 'Místo', 'after'));
  const w19 = W19(original(MM.vyjezd));
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w19)), noModified(w19), 'W23 by a drag writes Výjezd');
  await sleep(1200);
  assert.deepEqual((await writes(core)).map((c) => String((c.args as { path?: string }).path).normalize('NFC')), [MM.vyjezd], 'only Pages/Výjezd 2026.md is written');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-30

async function axeAll(page: Page, scope: Locator): Promise<string[]> {
  await axeContrast(page); // loads axe into the page
  const el = await scope.elementHandle();
  return page.evaluate(async (node) => {
    const r = await (window as any).axe.run(node ?? document);
    return r.violations.flatMap((v: any) => v.nodes.map((n: any) => `${v.id} ${n.target.join(' ')}`));
  }, el);
}

test('fr_ux_08_ac30_folds_are_exposed_to_voiceover', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await Promise.all(['Výjezd 2026', 'Program', 'Místo', 'Doprava'].map((n) => expanded(fig, n))), ['true', 'false', 'true', null], 'aria-expanded matches the fold state');
  assert.equal(await foldName(fig, 'Program'), 'Expand Program, 2 hidden', 'the control\'s name includes the hidden count');
  assert.equal(await fig.getByRole('treeitem', { name: 'Přehled Q4', exact: true, includeHidden: true }).count(), 0, 'hidden nodes are absent from the accessibility tree');
  const buttons = await fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent ?? '', tab: b.getAttribute('tabindex'), hidden: b.closest('[aria-hidden="true"]') !== null, inItem: !!b.closest('[role="treeitem"]') })));
  assert.ok(buttons.length >= 4, `the R230 buttons are in the tree: ${JSON.stringify(buttons)}`);
  assert.deepEqual(buttons.filter((b) => b.tab !== '-1' || b.hidden || !b.inItem || !/^(Collapse |Expand |Add child to )/.test(b.name)), [], 'inside their treeitem, named by R233, not Tab stops, not aria-hidden (AP-2116)');
  for (const theme of ['light', 'dark'] as const) {
    await openMm(page, MM.vyjezd, { theme });
    const f = await needFigure(page, 'Výjezd 2026');
    await focusNode(f, 'Program');
    await page.keyboard.press(' ');
    await (await needNode(f, 'Doprava')).hover();
    assert.ok(await visible(addChildBtn(f, 'Doprava')), `${theme}: setup: Doprava hovered`);
    assert.deepEqual(await axeAll(page, f), [], `${theme}: axe reports no violation with Program folded and Doprava hovered`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-29

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac29_controls_indicators_and_drags_${theme}`, async ({ page }) => {
    await openMm(page, MM.vyjezd, { theme });
    const fig = await needFigure(page, 'Výjezd 2026');
    await needTree(fig, 'Výjezd 2026');
    const bg = await token(page, 'bg');
    const accent = await token(page, 'accent');
    const muted = await token(page, 'muted');
    const bad: string[] = [];
    await focusNode(fig, 'Program');
    await page.keyboard.press(' ');
    const folded = await foldControl(fig, 'Program').first().evaluate((b) => { const s = getComputedStyle(b); return { color: s.color, fill: s.backgroundColor, border: s.borderTopColor }; }).catch(() => null);
    if (!folded) bad.push('no fold control on Program');
    else {
      if (contrast(folded.color, folded.fill) < 4.5) bad.push(`+2 text ${folded.color} on ${folded.fill}: ${contrast(folded.color, folded.fill).toFixed(2)} < 4.5`);
      if (contrast(folded.border, bg) < 3) bad.push(`folded control outline ${folded.border}: ${contrast(folded.border, bg).toFixed(2)} < 3 against bg`);
    }
    await (await needNode(fig, 'Místo')).hover();
    const open = await foldControl(fig, 'Místo').first().evaluate((b) => { const s = getComputedStyle(b); return { color: s.color, border: s.borderTopColor }; }).catch(() => null);
    if (!open) bad.push('no fold control on Místo');
    else {
      if (contrast(open.color, bg) < 3) bad.push(`− glyph ${open.color}: ${contrast(open.color, bg).toFixed(2)} < 3 against bg`);
      if (contrast(open.border, bg) < 3) bad.push(`open control outline ${open.border}: ${contrast(open.border, bg).toFixed(2)} < 3 against bg`);
    }
    const plus = await addChildBtn(fig, 'Místo').first().evaluate((b) => { const s = getComputedStyle(b); return { color: s.color, fill: s.backgroundColor }; }).catch(() => null);
    if (!plus) bad.push('no `+` on Místo');
    else {
      if (plus.color !== accent && plus.fill !== accent) bad.push(`the \`+\` uses neither accent: ${JSON.stringify(plus)}`);
      if (contrast(plus.color, plus.fill === 'rgba(0, 0, 0, 0)' ? bg : plus.fill) < 3) bad.push(`\`+\` glyph ${plus.color} on ${plus.fill} < 3`);
    }
    for (const v of await axeContrast(page)) bad.push(`controls shown: contrast ${v}`);
    for (const v of await colourLeaks(page, theme)) bad.push(`controls shown: leak ${v}`);
    await dragTo(page, fig, 'Doprava', await zonePoint(fig, 'Místo', 'after'), { release: false });
    const drag = await fig.first().evaluate((f) => {
      const ind = f.querySelector('[data-drop-indicator]');
      const org = f.querySelector('[data-drag-origin]');
      const si = ind ? getComputedStyle(ind) : null;
      const so = org ? getComputedStyle(org) : null;
      return { line: si ? [si.backgroundColor, si.borderTopColor, si.outlineColor] : null, origin: so ? [so.borderTopColor, so.borderTopStyle, so.outlineColor, so.outlineStyle] : null };
    });
    if (!drag.line || !drag.line.includes(accent)) bad.push(`the drop line uses ${JSON.stringify(drag.line)}, not accent ${accent}`);
    if (!drag.origin || !drag.origin.includes(muted) || !drag.origin.includes('dashed')) bad.push(`the old place's outline ${JSON.stringify(drag.origin)} is not a dashed muted ${muted}`);
    if (contrast(accent, bg) < 3) bad.push(`accent ${accent} < 3:1 against bg`);
    if (contrast(muted, bg) < 3) bad.push(`muted ${muted} < 3:1 against bg`);
    for (const v of await colourLeaks(page, theme)) bad.push(`dragging: leak ${v}`);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(bad, [], `${theme}: the MM3 controls and drag indicators use tokens with WCAG contrast (board MindmapLayouts E, F)`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-27 (L5)

test('nfr_oth_02_ac27_pseudo_locale_wraps_the_controls_and_the_commands', async ({ page }) => {
  await openMm(page, MM.vyjezd, { prelude: pseudoLocale });
  const fig = main(page).getByRole('figure', { name: '⟦Mindmap: Výjezd 2026⟧', exact: true });
  await must(fig, 'figure ⟦Mindmap: Výjezd 2026⟧', 5000);
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await (await needNode(fig, 'Doprava')).hover();
  const names = await fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent ?? ''));
  assert.ok(names.length >= 4, `the controls exist: ${JSON.stringify(names)}`);
  assert.deepEqual(names.filter((n) => !/^⟦.*⟧$/s.test(n)), [], 'every name of a fold control and a `+` is inside ⟦ ⟧');
  assert.ok(names.some((n) => n.includes('Program') && n.includes('2')), 'the node text and the count stay inside the frame');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: /Command query/ }).fill('mindmap node');
  const opts = await page.getByRole('listbox', { name: /Commands/ }).getByRole('option').allInnerTexts();
  assert.ok(opts.some((o) => o.includes('⟦Fold or unfold mindmap node⟧')) && opts.some((o) => o.includes('⟦Add child to mindmap node⟧')), `commands wrapped: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
});
