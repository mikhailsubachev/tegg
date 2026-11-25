// Slice MM3, L5 (WebKit, fake core): drag and drop of branches (docs/acceptance/mindmap.md part three, R231, R232;
// contract docs/contracts/mm-mindmap.md §7.4, §7.5). FR-MMP-02 AC-48 (W23…W31 by real pointer drags: bytes, Map kept,
// the focus, one undo step, the indicator and the dashed outline while dragging, nothing written before the release),
// AC-49 (what a drag can't do), AC-50 (drags and folds: the 600 ms unfold, a drop into a folded node), AC-51 (spider
// drags mirrored), AC-53 (Velká mapa: fold re-layouts and the drag indicator, report-only), FR-SYN-03 AC-40 (an external
// change during a drag), FR-SYN-06 AC-56 (L5: a browsing, folding and cancelled-drag tour sends zero writes). Test
// clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written from the ACs and the contract only (D-61); every
// missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  MM, MM2, MM3, callsOf, dragState, dragTo, eventually, fileText, fileWhen, focusNode, focused, focusedWhen, foldControl, mapArea,
  mindmapVault, needFigure, needNode, needTree, noModified, openMm, original, seen, sides, sleep, swap, treeItems, treeNames, vaultWrites, velkaText, viewOf,
  writes, zonePoint, type FakeCoreHandle, type Zone,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const VY = '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n';
const L4_8 = '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n';
const PAV = '>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama\n>   - Delta\n';

async function savedAs(core: FakeCoreHandle, path: string, want: string, ms = 4000): Promise<string | undefined> {
  return fileWhen(core, path, (x) => noModified(x) === noModified(want), ms);
}
async function moveTo(page: Page, p: { x: number; y: number }, steps = 4) {
  await page.mouse.move(p.x, p.y, { steps });
}
async function historyDepth(page: Page): Promise<number> {
  return page.evaluate(() => Number((window as any).__TEGG_TEST__?.editor?.historyDepth?.() ?? -1));
}

type Case = { w: string; path: string; title: string; from: string; to: string; zone: Zone; left?: boolean; before: string; after: string };
const CASES: Case[] = [
  { w: 'W23', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Program', to: 'Místo', zone: 'after', before: VY, after: '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n' },
  { w: 'W24', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Místo', to: 'Program', zone: 'child', before: '>   - Místo\n>     - [[Lisabon]]\n', after: '>     - Místo\n>       - [[Lisabon]]\n' },
  { w: 'W25', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Přehled Q4', to: 'Program', zone: 'after', before: '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n', after: '>     - Plán 2027\n>   - Přehled Q4\n>   - Místo\n' },
  { w: 'W26', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Doprava', to: 'Přehled Q4', zone: 'before', before: VY, after: '>   - Program\n>     - Doprava\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n' },
  { w: 'W27', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Místo', to: 'Přehled Q4', zone: 'child', before: L4_8, after: '>     - Přehled Q4\n>       - Místo\n>         - [[Lisabon]]\n>     - Plán 2027\n>   - Doprava\n' },
  { w: 'W28', path: MM.vyjezd, title: 'Výjezd 2026', from: 'Přehled Q4', to: 'Výjezd 2026', zone: 'after', before: VY, after: '>   - Program\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n>   - Přehled Q4\n' },
  { w: 'W29', path: MM.vice, title: 'Témata', from: 'Porady', to: 'Témata', zone: 'after', before: '> - Rodina\n> - Práce\n>   - Porady\n> - Zdraví\n', after: '> - Rodina\n> - Práce\n> - Zdraví\n> - Porady\n' },
  { w: 'W30', path: MM2.pavouk, title: 'Pavouk', from: 'Gama', to: 'Beta', zone: 'before', before: PAV, after: '>   - Alfa\n>     - A1\n>     - A2\n>   - Gama\n>   - Beta\n>     - B1\n>   - Delta\n' },
  { w: 'W31', path: MM2.pavouk, title: 'Pavouk', from: 'Delta', to: 'Beta', zone: 'child', left: true, before: PAV, after: '>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>     - Delta\n>   - Gama\n' },
];
/** The indicator expected on a root target: the child ring (R231, AP-2119). */
const shownZone = (c: Case) => (c.to === 'Výjezd 2026' || c.to === 'Témata' ? 'child' : c.zone);

async function runDrops(page: Page, cases: Case[]) {
  const bad: string[] = [];
  for (const c of cases) {
    const core = await openMm(page, c.path);
    const fig = await needFigure(page, c.title);
    await needTree(fig, c.title);
    await dragTo(page, fig, c.from, await zonePoint(fig, c.to, c.zone, c.left), { release: false });
    const ds = await dragState(fig);
    if (ds.zone !== shownZone(c) || ds.target !== c.to) bad.push(`${c.w}: while dragging the indicator is ${JSON.stringify(ds)}, want ${shownZone(c)} on ${c.to}`);
    if (ds.origin !== 1 || ds.ghost !== 1) bad.push(`${c.w}: the dashed outline (${ds.origin}) and the copy (${ds.ghost}) while dragging`);
    if ((await writes(core)).length) bad.push(`${c.w}: written before the release`);
    await page.mouse.up();
    const want = swap(original(c.path), c.before, c.after);
    const t = await savedAs(core, c.path, want);
    if (noModified(t) !== noModified(want)) { bad.push(`${c.w}: saved ${JSON.stringify(t)}`); continue; }
    if ((await viewOf(fig)) !== 'map') bad.push(`${c.w}: data-view ${await viewOf(fig)}`);
    const f = await focusedWhen(page, (x) => x.role === 'treeitem' && x.name === c.from, 2000);
    if (f.name !== c.from) bad.push(`${c.w}: the focus on "${f.name}", not the moved node`);
    const after = await dragState(fig);
    if (after.zone || after.origin || after.ghost || after.dragging) bad.push(`${c.w}: drag DOM left after the drop: ${JSON.stringify(after)}`);
    await page.keyboard.press('Meta+z');
    const u = await savedAs(core, c.path, original(c.path));
    if (noModified(u) !== noModified(original(c.path))) bad.push(`${c.w}: ⌘Z gives ${JSON.stringify(u)}`);
    if ((await focusedWhen(page, (x) => x.name === c.from, 2000)).name !== c.from) bad.push(`${c.w}: the focus after ⌘Z is not on ${c.from}`);
    await page.keyboard.press('Meta+Shift+z');
    const r = await savedAs(core, c.path, want);
    if (noModified(r) !== noModified(want)) bad.push(`${c.w}: ⇧⌘Z gives ${JSON.stringify(r)}`);
  }
  assert.deepEqual(bad, [], 'R232 by drags: the "After" bytes, Map kept, the focus on the moved node, one undo step, the indicator and outline while dragging');
}

// ------------------------------------------------------------------------------------------------ AC-48

test('fr_mmp_02_ac48_drops_w23_to_w25_equal_the_alt_moves', async ({ page }) => {
  test.setTimeout(120_000);
  await runDrops(page, CASES.filter((c) => ['W23', 'W24', 'W25'].includes(c.w)));
});

test('fr_mmp_02_ac48_drops_w26_to_w29', async ({ page }) => {
  test.setTimeout(150_000);
  await runDrops(page, CASES.filter((c) => ['W26', 'W27', 'W28', 'W29'].includes(c.w)));
});

// ------------------------------------------------------------------------------------------------ AC-51

test('fr_mmp_02_ac51_spider_drags_are_mirrored_w30_w31', async ({ page }) => {
  test.setTimeout(120_000);
  await runDrops(page, CASES.filter((c) => ['W30', 'W31'].includes(c.w)));
  const core = await openMm(page, MM2.pavouk);
  const fig = await needFigure(page, 'Pavouk');
  const beta = (await (await needNode(fig, 'Beta')).boundingBox())!;
  await dragTo(page, fig, 'Gama', await zonePoint(fig, 'Beta', 'before'), { release: false });
  const line = await fig.locator('[data-drop-indicator]').first().boundingBox().catch(() => null);
  assert.ok(line && Math.abs(line.y + line.height / 2 - beta.y) <= 3 && line.x < beta.x + beta.width && line.x + line.width > beta.x, `the line along Beta's top edge: ${JSON.stringify(line)} vs ${JSON.stringify(beta)}`);
  await page.mouse.move(beta.x + beta.width / 6, beta.y + beta.height / 2, { steps: 4 });
  const ring = await fig.locator('[data-drop-indicator="child"]').first().boundingBox().catch(() => null);
  assert.ok(ring && Math.abs(ring.x - beta.x) <= 4 && Math.abs(ring.width - beta.width) <= 8, `the ring on Beta's box (its left third is the child zone): ${JSON.stringify(ring)}`);
  await page.mouse.move(beta.x + beta.width / 2, beta.y + beta.height / 4, { steps: 4 });
  await page.mouse.up();
  await savedAs(core, MM2.pavouk, swap(original(MM2.pavouk), PAV, CASES.find((c) => c.w === 'W30')!.after));
  const s = await eventually(() => sides(fig), (x) => x.Gama === 'left', 3000);
  assert.deepEqual([s.Alfa, s.Gama, s.Beta, s.Delta, s.B1], ['right', 'left', 'right', 'left', 'right'], 'after W30: Alfa right, Gama left, Beta right, Delta left; B1 follows Beta (D-789)');
});

// ------------------------------------------------------------------------------------------------ AC-49

test('fr_mmp_02_ac49_a_small_move_is_a_click_and_impossible_drops_write_nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const d = (await (await needNode(fig, 'Doprava')).boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2 + 3, d.y + d.height / 2, { steps: 3 });
  const small = await dragState(fig);
  await page.mouse.up();
  assert.deepEqual([small.dragging, small.origin, small.ghost], [null, 0, 0], 'a 3 px move starts no drag');
  assert.equal((await focused(page)).name, 'Doprava', 'it is a click: Doprava focused');
  // Program over its own subtree
  await dragTo(page, fig, 'Program', await zonePoint(fig, 'Přehled Q4', 'after'), { release: false });
  const own1 = await dragState(fig);
  assert.equal(own1.dragging !== null && own1.origin === 1, true, `Program is being dragged: ${JSON.stringify(own1)}`);
  assert.equal(own1.zone, null, 'no indicator over Přehled Q4 (its own child)');
  await moveTo(page, await zonePoint(fig, 'Plán 2027', 'child'));
  assert.equal((await dragState(fig)).zone, null, 'nor over Plán 2027');
  await page.mouse.up();
  // the roots don't start a drag
  for (const [path, title, root] of [[MM.vyjezd, 'Výjezd 2026', 'Výjezd 2026'], [MM.vice, 'Témata', 'Témata']] as const) {
    await openMm(page, path);
    const f = await needFigure(page, title);
    await dragTo(page, f, root, await zonePoint(f, title === 'Témata' ? 'Zdraví' : 'Doprava', 'after'), { release: false });
    const r = await dragState(f);
    await page.mouse.up();
    assert.deepEqual([r.dragging, r.origin, r.ghost], [null, 0, 0], `${root} doesn't start a drag`);
  }
  const core2 = await openMm(page, MM.vyjezd);
  const g = await needFigure(page, 'Výjezd 2026');
  await dragTo(page, g, 'Doprava', await zonePoint(g, 'Program', 'before'), { release: false });
  assert.equal((await dragState(g)).origin, 1, 'Doprava is being dragged');
  await page.keyboard.press('Escape');
  const esc = await dragState(g);
  await page.mouse.up();
  assert.deepEqual([esc.dragging, esc.zone, esc.origin, esc.ghost], [null, null, 0, 0], 'Esc cancels: everything back');
  assert.equal((await focused(page)).name, 'Doprava', 'the focus stays on Doprava');
  // empty map area, outside the map
  const area = (await mapArea(g).first().boundingBox())!;
  await dragTo(page, g, 'Doprava', { x: area.x + area.width - 6, y: area.y + 6 });
  const box = (await page.getByText('Poznámka pod mapou.').first().boundingBox())!;
  await dragTo(page, g, 'Doprava', { x: box.x + 10, y: box.y + box.height / 2 });
  // its own place
  const h0 = await historyDepth(page);
  await dragTo(page, g, 'Program', await zonePoint(g, 'Místo', 'before'));
  await sleep(1500);
  assert.deepEqual([...(await writes(core)), ...(await writes(core2))], [], 'nothing written by any of these');
  assert.equal(await historyDepth(page), h0, 'the drop on its own place adds no undo step');
  assert.equal(await fileText(core2, MM.vyjezd), original(MM.vyjezd), 'the file unchanged');
  // a node being edited isn't draggable
  await focusNode(g, 'Doprava');
  await page.keyboard.press('F2');
  await dragTo(page, g, 'Doprava', await zonePoint(g, 'Program', 'before'), { release: false });
  const editing = await dragState(g);
  await page.mouse.up();
  assert.deepEqual([editing.dragging, editing.origin], [null, 0], 'a node being edited isn\'t draggable');
  await page.keyboard.press('Escape');
});

test('fr_mmp_02_ac49_no_drop_onto_another_mindmap_block', async ({ page }) => {
  const core = await openMm(page, MM.rozlozeni);
  const strom = await needFigure(page, 'Strom');
  const zal = await needFigure(page, 'Zalomení');
  await needTree(strom, 'Strom');
  await dragTo(page, strom, 'Gama', await zonePoint(strom, 'Beta', 'after'), { release: false });
  assert.equal((await dragState(strom)).origin, 1, 'Gama is being dragged in Strom');
  const k = (await (await needNode(zal, 'Krátký')).boundingBox())!;
  await page.mouse.move(k.x + k.width / 2, k.y + k.height * 0.75, { steps: 8 });
  assert.equal((await dragState(strom)).zone, null, 'no indicator over a node of another block (AP-2120)');
  assert.equal((await dragState(zal)).zone, null, 'none in Zalomení either');
  await page.mouse.up();
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-50

test('fr_mmp_02_ac50_resting_600_ms_over_a_folded_node_unfolds_it', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.ok(!(await treeNames(fig)).includes('Přehled Q4'), 'setup: Program folded');
  const p = (await (await needNode(fig, 'Program')).boundingBox())!;
  await dragTo(page, fig, 'Doprava', { x: p.x + p.width / 2, y: p.y + p.height / 2 }, { release: false, restMs: 400 });
  assert.equal((await dragState(fig)).origin, 1, 'Doprava is being dragged');
  await moveTo(page, await zonePoint(fig, 'Místo', 'before'), 3);
  await sleep(400);
  assert.ok(!(await treeNames(fig)).includes('Přehled Q4'), 'resting 400 ms and leaving doesn\'t unfold Program');
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 3 });
  await sleep(650);
  assert.ok((await treeNames(fig)).includes('Přehled Q4'), 'resting 650 ms unfolds Program');
  await moveTo(page, await zonePoint(fig, 'Plán 2027', 'after'));
  await page.mouse.up();
  const want = swap(original(MM.vyjezd), VY, '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>     - Doprava\n>   - Místo\n>     - [[Lisabon]]\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, want)), noModified(want), 'released on Plán 2027\'s lower half (lines 3–8)');
});

test('fr_mmp_02_ac50_folded_dragged_nodes_and_drops_into_folded_nodes', async ({ page }) => {
  let core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Místo');
  await page.keyboard.press(' ');
  await dragTo(page, fig, 'Místo', await zonePoint(fig, 'Doprava', 'child'));
  const w = swap(original(MM.vyjezd), '>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n', '>   - Doprava\n>     - Místo\n>       - [[Lisabon]]\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w)), noModified(w), 'folded Místo onto Doprava\'s outer third');
  assert.ok(!(await treeNames(fig)).includes('Lisabon'), 'Místo stays folded');
  core = await openMm(page, MM.vyjezd);
  fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await dragTo(page, fig, 'Doprava', await zonePoint(fig, 'Program', 'child'), { steps: 4 });
  const want = swap(original(MM.vyjezd), VY, '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>     - Doprava\n>   - Místo\n>     - [[Lisabon]]\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, want)), noModified(want), 'Doprava dropped on folded Program\'s outer third: its last child');
  assert.ok((await treeNames(fig)).includes('Přehled Q4'), 'Program shown unfolded');
  assert.equal((await focusedWhen(page, (x) => x.name === 'Doprava')).name, 'Doprava', 'the focus on Doprava');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-40

const HOTEL = (t: string) => swap(t, '>   - Doprava\n', '>   - Doprava\n>   - Hotel\n');

test('fr_syn_03_ac40_an_external_change_cancels_the_drag', async ({ page }) => {
  for (const folded of [false, true]) {
    const core = await openMm(page, MM.vyjezd);
    const fig = await needFigure(page, 'Výjezd 2026');
    if (folded) { await focusNode(fig, 'Program'); await page.keyboard.press(' '); }
    await dragTo(page, fig, 'Doprava', await zonePoint(fig, 'Místo', 'before'), { release: false });
    assert.equal((await dragState(fig)).origin, 1, `${folded ? 'Program folded: ' : ''}Doprava is being dragged`);
    const ext = HOTEL(original(MM.vyjezd));
    await core.setFile(MM.vyjezd, ext);
    const names = await eventually(() => treeNames(fig), (n) => n.includes('Hotel'), 3000);
    assert.ok(names.includes('Hotel'), 'the block reloads with Hotel');
    if (folded) assert.ok(names.includes('Přehled Q4'), 'the reloaded map shows Program unfolded (AP-2115)');
    const ds = await dragState(fig);
    assert.deepEqual([ds.dragging, ds.zone, ds.origin, ds.ghost], [null, null, 0, 0], 'the drag is cancelled');
    await page.mouse.up();
    await sleep(1500);
    assert.deepEqual(await writes(core), [], 'nothing written by Tegg; a release afterwards does nothing');
    assert.equal(await fileText(core, MM.vyjezd), ext, 'the external bytes stay on disk');
  }
});

test('fr_syn_03_ac40_without_the_event_a_drop_is_refused_by_the_base_version', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await dragTo(page, fig, 'Program', await zonePoint(fig, 'Místo', 'after'), { release: false });
  assert.equal((await dragState(fig)).origin, 1, 'Program is being dragged');
  const ext = HOTEL(original(MM.vyjezd));
  await core.setFile(MM.vyjezd, ext, { silent: true });
  await page.mouse.up();
  await sleep(2500);
  const t = await fileText(core, MM.vyjezd);
  assert.ok(t?.includes('>   - Doprava\n>   - Hotel\n'), `the external Hotel line is never overwritten: ${JSON.stringify(t)}`);
  const ok = (await writes(core)).filter((c) => c.ok !== false && !String((c.args as { text?: string }).text ?? '').includes('Hotel'));
  assert.deepEqual(ok.map((c) => c.cmd), [], 'no successful write without the external bytes (Conflict, FR-SYN-03 AC-13)');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-56 (L5)

async function tour(page: Page, fig: Locator, title: string) {
  await needTree(fig, title);
  const names = await treeNames(fig);
  await focusNode(fig, names[0]);
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'End', 'Home']) await page.keyboard.press(k);
  for (const n of names) {
    await (await needNode(fig, n)).hover();
    if ((await foldControl(fig, n).count()) === 1) {
      await focusNode(fig, n);
      await page.keyboard.press(' ');
      await page.keyboard.press(' ');
      await (await needNode(fig, n)).hover();
      await foldControl(fig, n).first().click();
      await foldControl(fig, n).first().click();
    }
  }
}

test('fr_syn_06_ac56_browsing_folding_and_cancelled_drags_send_zero_writes', async ({ page }) => {
  test.setTimeout(180_000);
  const core = await openMm(page, MM.vyjezd);
  let dragged = 0;
  for (const [path, title] of [[MM.vyjezd, 'Výjezd 2026'], [MM2.pavouk, 'Pavouk'], [MM3.bratranci, 'Bratranci'], [MM.vice, 'Témata']] as const) {
    if (path !== MM.vyjezd) {
      const { gotoNote } = await import('./mindmap-helpers');
      await gotoNote(page, path === MM.vice ? 'Více kořenů' : title);
    }
    const fig = await needFigure(page, title);
    await tour(page, fig, title);
    const items = await treeItems(fig);
    const names = items.map((i) => i.name);
    const first = names[1];
    await dragTo(page, fig, first, await zonePoint(fig, names[names.length - 1], 'after'), { release: false });
    if ((await dragState(fig)).origin === 1) dragged++;
    await page.keyboard.press('Escape');
    await page.mouse.up();
    // a node with children dragged onto its own first child
    const k = items.findIndex((it, i) => i > 0 && items[i + 1] && items[i + 1].level > it.level);
    if (k > 0) await dragTo(page, fig, names[k], await zonePoint(fig, names[k + 1], 'child'));
    const area = (await mapArea(fig).first().boundingBox())!;
    await dragTo(page, fig, first, { x: area.x + area.width - 6, y: area.y + 6 });
  }
  await openMm(page, MM.vyjezd, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  const r = await needFigure(page, 'Výjezd 2026');
  await tour(page, r, 'Výjezd 2026');
  await sleep(1500);
  assert.equal(dragged, 4, 'a drag started in each of the four maps (the tour ran on the MM3 build)');
  assert.deepEqual(await vaultWrites(core), [], 'zero write calls');
  assert.equal((await callsOf(core, 'note_write')).length, 0, 'zero note_write');
});

// ------------------------------------------------------------------------------------------------ AC-53 (report-only)

test('fr_mmp_02_ac53_big_map_folds_and_drag_report_only', async ({ page }) => {
  test.setTimeout(300_000);
  const vault = mindmapVault((f) => { f['Pages/Velká mapa.md'] = velkaText(); });
  const core = await openMm(page, 'Pages/Velká mapa.md', { vault });
  const fig = await needFigure(page, 'Velká mapa', 10_000);
  await needTree(fig, 'Velká mapa', 10_000);
  const layoutMs = async (from: number) => (await core.calls()).slice(from).filter((c) => c.cmd === 'perf_mark' && (c.args as any)?.mark === 'mindmap-layout').map((c) => Number((c.args as any).ms));
  const ms: number[] = [];
  for (let run = 0; run < 5; run++) {
    for (const n of ['Velká mapa', 'Větev 1']) {
      for (let k = 0; k < 2; k++) {
        await focusNode(fig, n);
        const n0 = (await core.calls()).length;
        await page.keyboard.press(' ');
        const got = await eventually(() => layoutMs(n0), (x) => x.length > 0, 2000);
        assert.ok(got.length > 0, `Space on ${n}: a re-layout with the perf mark mindmap-layout`);
        ms.push(got[got.length - 1]);
      }
    }
  }
  const s = [...ms].sort((a, b) => a - b);
  console.log(`FR-MMP-02 AC-53 (report-only, D-152): fold/unfold mindmap-layout p95 ${s[Math.ceil(0.95 * s.length) - 1].toFixed(2)} ms over ${s.length} runs (target ≤ 16.7 ms)`);
  const n0 = (await core.calls()).length;
  const from = (await (await needNode(fig, 'Uzel 1.1')).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const to = (await (await needNode(fig, 'Uzel 2.7')).boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 120 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const drags = (await core.calls()).slice(n0).filter((c) => c.cmd === 'perf_mark' && (c.args as any)?.mark === 'mindmap-drag').map((c) => Number((c.args as any).ms));
  assert.ok(drags.length > 0, 'the perf mark mindmap-drag while dragging across the map (mm-mindmap §7.5)');
  console.log(`FR-MMP-02 AC-53 (report-only): ${(100 * drags.filter((x) => x <= 16.7).length / drags.length).toFixed(1)} % of ${drags.length} indicator moves painted in the next frame (target ≥ 95 %)`);
  await sleep(1000);
  assert.deepEqual(await writes(core), [], 'folding and a cancelled drag write nothing');
});
