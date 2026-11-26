// Slice MM3, L5 (WebKit, fake core): keys on the map (docs/acceptance/mindmap.md part three, R229, R230, R233; contract
// docs/contracts/mm-mindmap.md §7). FR-MMP-02 AC-54 (↑ / ↓ among siblings, then cousins; nothing on a root; Home / End),
// AC-38 (Bratranci: cousins across a childless parent and across grandparents; hidden nodes never reached), AC-39 (← / →
// unchanged on the MM3 build, editor and read view), AC-40 (Space folds; F2 and a double-click edit), AC-41 (→ and Tab
// on a folded node, the spider sides), AC-44 (hidden nodes leave the tree, `aria-expanded`, the focus follows), and
// FR-UX-03 AC-62 (the two palette commands, `data-command` on the buttons, a keyboard-only run to W19). Test clock
// 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written from the ACs and the contract only (D-61); every
// missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { paletteDialog } from './helpers';
import {
  MM, MM2, MM3, addChildBtn, click, editorBody, expanded, fieldState, fileWhen, focusNode, focused, focusedWhen, foldControl, foldName,
  must, mustCaret, needFigure, needNode, needTree, nodeField, noModified, openMm, original, pendingNode, runCommand, seen, sleep, swap, treeItems,
  treeNames, viewOf, writes,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ALL = ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'];
const PROGRAM_FOLDED = ['Výjezd 2026', 'Program', 'Místo', 'Lisabon', 'Doprava'];
const W19 = (t: string | undefined) => swap(t, '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n',
  '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n');

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
/** From node `start`: the names after each key. */
async function walk(page: Page, fig: Locator, start: string, keys: string[]): Promise<string[]> {
  await focusNode(fig, start);
  return steps(page, keys);
}
async function noFieldNoViewChange(fig: Locator, what: string) {
  assert.equal(await nodeField(fig).count(), 0, `${what}: no field opened`);
  assert.equal(await viewOf(fig), 'map', `${what}: the view stays Map`);
}
/** An attribute of the first match, hidden elements included; null when there is none. */
async function attrOf(loc: Locator, a: string): Promise<string | null> {
  return (await loc.count()) === 0 ? null : loc.first().getAttribute(a);
}
/** The text shown in node `name`'s fold control (`+2`, `−`), or null. */
async function foldText(fig: Locator, name: string): Promise<string | null> {
  const c = foldControl(fig, name);
  if ((await c.count()) === 0) return null;
  return (await c.first().innerText().catch(() => '')).trim();
}

// ------------------------------------------------------------------------------------------------ AC-37

test('fr_mmp_02_ac54_up_and_down_among_siblings_then_cousins_on_vyjezd', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const got = {
    '↓ from Program': await walk(page, fig, 'Program', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Doprava': await steps(page, ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    '↓ from Přehled Q4': await walk(page, fig, 'Přehled Q4', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↑ from Lisabon': await steps(page, ['ArrowUp', 'ArrowUp', 'ArrowUp']),
    '↑ ↓ on the root': await walk(page, fig, 'Výjezd 2026', ['ArrowUp', 'ArrowDown']),
    'Home, End': await walk(page, fig, 'Lisabon', ['Home', 'End']),
  };
  assert.deepEqual(got, {
    '↓ from Program': ['Místo', 'Doprava', 'Doprava'],
    '↑ from Doprava': ['Místo', 'Program', 'Program'],
    '↓ from Přehled Q4': ['Plán 2027', 'Lisabon', 'Lisabon'],
    '↑ from Lisabon': ['Plán 2027', 'Přehled Q4', 'Přehled Q4'],
    '↑ ↓ on the root': ['Výjezd 2026', 'Výjezd 2026'],
    'Home, End': ['Výjezd 2026', 'Doprava'],
  }, 'R229: siblings, then the cousin under Místo; nothing on the root (AP-2112)');
  await noFieldNoViewChange(fig, 'Výjezd');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'none of these keys writes');
});

test('fr_mmp_02_ac54_pavouk_and_vice_korenu', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  const p = await needFigure(page, 'Pavouk');
  await needTree(p, 'Pavouk');
  assert.deepEqual({
    '↓ from A2': await walk(page, p, 'A2', ['ArrowDown']),
    '↑ from B1': await walk(page, p, 'B1', ['ArrowUp']),
    '↓ from Alfa': await walk(page, p, 'Alfa', ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']),
  }, {
    '↓ from A2': ['A2'],
    '↑ from B1': ['B1'],
    '↓ from Alfa': ['Gama', 'Gama', 'Gama', 'Gama'],
  }, 'Pavouk (spider): ↑ / ↓ stay on the focused node\'s side (AC-58, R235, D-2674)');
  await noFieldNoViewChange(p, 'Pavouk');
  const core = await openMm(page, MM.vice);
  const v = await needFigure(page, 'Témata');
  await needTree(v, 'Témata');
  assert.deepEqual({
    '↓ from Rodina': await walk(page, v, 'Rodina', ['ArrowDown', 'ArrowDown', 'ArrowDown']),
    '↓ from Porady': await walk(page, v, 'Porady', ['ArrowDown']),
    '↑ ↓ on Témata': await walk(page, v, 'Témata', ['ArrowUp', 'ArrowDown']),
  }, {
    '↓ from Rodina': ['Práce', 'Zdraví', 'Zdraví'],
    '↓ from Porady': ['Porady'],
    '↑ ↓ on Témata': ['Témata', 'Témata'],
  }, 'Více kořenů: the top-level items are siblings; Porady has no cousin');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-38

test('fr_mmp_02_ac38_bratranci_cousins_across_a_childless_parent_and_grandparents', async ({ page }) => {
  const core = await openMm(page, MM3.bratranci);
  const fig = await needFigure(page, 'Bratranci');
  await needTree(fig, 'Bratranci');
  assert.deepEqual(await treeNames(fig), ['Kořen', 'Alfa', 'A1', 'A2', 'A2a', 'Beta', 'Gama', 'G1', 'G1a', 'G2'], 'setup: Bratranci\'s tree (10 nodes)');
  assert.deepEqual({
    '↓ from A2': await walk(page, fig, 'A2', ['ArrowDown']),
    '↑ from G1': await walk(page, fig, 'G1', ['ArrowUp']),
    '↓ from A2a': await walk(page, fig, 'A2a', ['ArrowDown']),
    '↑ from G1a': await walk(page, fig, 'G1a', ['ArrowUp']),
    '↓ from G2': await walk(page, fig, 'G2', ['ArrowDown']),
    '↑ from A1': await walk(page, fig, 'A1', ['ArrowUp']),
    '↓ from Beta': await walk(page, fig, 'Beta', ['ArrowDown']),
  }, {
    '↓ from A2': ['G1'], '↑ from G1': ['A2'], '↓ from A2a': ['G1a'], '↑ from G1a': ['A2a'], '↓ from G2': ['G2'], '↑ from A1': ['A1'], '↓ from Beta': ['Gama'],
  }, 'AP-2111: the nearest visible node of the same depth in outline order');
  await focusNode(fig, 'Gama');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), ['Kořen', 'Alfa', 'A1', 'A2', 'A2a', 'Beta', 'Gama'], 'Space folds Gama');
  assert.deepEqual(await walk(page, fig, 'A2', ['ArrowDown']), ['A2'], 'with Gama folded, ↓ from A2 does nothing (G1 is hidden)');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-39

// RT-8: AC-39 checks that ← / → don't change. To fail before the MM3 build (TS-I1), the test first asserts that it runs
// on the MM3 map (the fold controls of R230 exist); the key steps then are AC-15's and AC-28's, unchanged.
async function mm3Map(fig: Locator, name: string) {
  assert.ok((await foldControl(fig, name).count()) === 1, `the map is the MM3 build: ${name} has its fold control (R230)`);
}
test('fr_mmp_02_ac39_left_and_right_are_unchanged_in_the_editor_and_the_read_view', async ({ page }) => {
  for (const readView of [false, true]) {
    const where = readView ? 'read view' : 'editor';
    await openMm(page, MM.vyjezd, { readView });
    const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
    if (readView && (await seen(toFormatted, 1500))) await toFormatted.click();
    const v = await needFigure(page, 'Výjezd 2026');
    await needTree(v, 'Výjezd 2026');
    await mm3Map(v, 'Program');
    assert.deepEqual(await walk(page, v, 'Lisabon', ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']), ['Místo', 'Lisabon', 'Místo', 'Výjezd 2026', 'Program'], `${where}: AC-15's ← parent, → first child on Výjezd`);
    await openMm(page, MM2.pavouk, { readView });
    if (readView && (await seen(toFormatted, 1500))) await toFormatted.click();
    const p = await needFigure(page, 'Pavouk');
    await needTree(p, 'Pavouk');
    await mm3Map(p, 'Alfa');
    assert.deepEqual(await walk(page, p, 'Střed', ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight']),
      ['Alfa', 'A1', 'Alfa', 'Střed', 'Beta', 'B1', 'Beta', 'Střed'], `${where}: AC-28's ← / → on Pavouk (D-790)`);
    assert.deepEqual({
      '→ on Gama': await walk(page, p, 'Gama', ['ArrowRight']),
      '← on Delta': await walk(page, p, 'Delta', ['ArrowLeft']),
      '← on B1': await walk(page, p, 'B1', ['ArrowLeft']),
      '→ on B1': await walk(page, p, 'B1', ['ArrowRight']),
    }, { '→ on Gama': ['Gama'], '← on Delta': ['Delta'], '← on B1': ['B1'], '→ on B1': ['Beta'] }, `${where}: the leaves on each side`);
  }
  // AC-28 on Výjezd after W12 (editor).
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(fig.getByRole('radio', { name: 'Spider: branches on both sides', exact: true }), 'radio spider');
  await fileWhen(core, MM.vyjezd, (x) => !!x?.includes('[!mindmap|spider]'), 4000);
  await mm3Map(fig, 'Místo');
  assert.deepEqual(await walk(page, fig, 'Místo', ['ArrowRight', 'ArrowLeft', 'ArrowLeft']), ['Výjezd 2026', 'Místo', 'Lisabon'], 'Výjezd after W12: → on Místo (left) the root, ← the first left branch, ← its first child');
});

// ------------------------------------------------------------------------------------------------ AC-40

test('fr_mmp_02_ac40_space_folds_and_unfolds', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'Space on Program hides Přehled Q4 and Plán 2027: 5 treeitems');
  assert.equal(await foldName(fig, 'Program'), 'Expand Program, 2 hidden', 'the control\'s name');
  assert.equal(await foldText(fig, 'Program'), '+2', 'the control shows +2');
  const f = await focused(page);
  assert.deepEqual([f.role, f.name], ['treeitem', 'Program'], 'the focus stays on Program');
  await noFieldNoViewChange(fig, 'Space on Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), ALL, 'Space again shows them');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), ALL, 'Space on Doprava (a leaf) changes nothing');
  await focusNode(fig, 'Výjezd 2026');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026'], 'Space on the root folds the whole map');
  assert.equal(await foldName(fig, 'Výjezd 2026'), 'Expand Výjezd 2026, 6 hidden', '+6');
  await page.keyboard.press(' ');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'folding writes nothing');
  await openMm(page, MM.vice);
  const v = await needFigure(page, 'Témata');
  await focusNode(v, 'Témata');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(v), ['Témata'], 'Space on the synthesized root folds it');
  assert.equal(await foldName(v, 'Témata'), 'Expand Témata, 4 hidden', '+4');
});

test('fr_mmp_02_ac40_f2_and_double_click_edit_and_a_folded_node_stays_folded', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Plán 2027');
  await page.keyboard.press('F2');
  assert.equal((await fieldState(fig))?.value, 'Plán 2027', 'F2 opens `Edit node` with Plán 2027 (R95a)');
  await page.keyboard.press('Escape');
  await (await needNode(fig, 'Plán 2027')).dblclick();
  assert.equal((await fieldState(fig))?.value, 'Plán 2027', 'a double-click too');
  await page.keyboard.press('Escape');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'setup: Program folded');
  await page.keyboard.press('F2');
  assert.equal((await fieldState(fig))?.value, 'Program', 'F2 on folded Program opens its field');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'opening the field on a folded node keeps it folded');
  await page.keyboard.press('Escape');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  await openMm(page, MM.vice);
  const v = await needFigure(page, 'Témata');
  const t = await focusNode(v, 'Témata');
  await page.keyboard.press('F2');
  await t.dblclick();
  await sleep(300);
  assert.equal(await nodeField(v).count(), 0, 'F2 and a double-click on Témata open nothing (D-2605)');
  assert.deepEqual(await treeNames(v), ['Témata', 'Rodina', 'Práce', 'Porady', 'Zdraví'], 'and fold nothing');
  assert.ok((await foldControl(v, 'Témata').count()) === 1, 'Témata has its fold control (R230)');
});

// ------------------------------------------------------------------------------------------------ AC-41

test('fr_mmp_02_ac41_right_and_tab_on_folded_program', async ({ page }) => {
  let core = await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'setup: Program folded');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await treeNames(fig), ALL, '→ on folded Program shows its children');
  assert.equal((await focused(page)).name, 'Program', 'the focus stays on Program');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).name, 'Přehled Q4', 'a second → reaches Přehled Q4');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await page.keyboard.press('Tab');
  assert.ok(await seen(pendingNode(fig), 1000), 'Tab on folded Program: a pending child');
  const names = await treeNames(fig);
  assert.deepEqual(names.slice(0, 4), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027'], 'Program is shown unfolded');
  const order = await fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('data-node')));
  assert.equal(order.indexOf('pending'), 4, 'the pending child after Plán 2027 (R95)');
  await page.keyboard.type('Plán 2028');
  await page.keyboard.press('Enter');
  const w32 = swap(original(MM.vyjezd), '>     - Plán 2027\n', '>     - Plán 2027\n>     - Plán 2028\n');
  assert.equal(noModified(await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(w32), 4000)), noModified(w32), 'W32');
  core = await openMm(page, MM.vyjezd);
  fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await page.keyboard.press('Tab');
  await must(pendingNode(fig), 'the pending child');
  await page.keyboard.press('Escape');
  assert.equal(await pendingNode(fig).count(), 0, 'Esc removes the pending node');
  assert.deepEqual(await treeNames(fig), ALL, 'Program stays unfolded');
  await focusNode(fig, 'Program');
  await page.keyboard.press(' ');
  await page.keyboard.press('Enter');
  await must(pendingNode(fig), '⏎ on folded Program: a pending sibling');
  assert.equal(await pendingNode(fig).getAttribute('aria-level'), '2', 'a sibling of Program');
  assert.ok(!(await treeNames(fig)).includes('Přehled Q4'), 'Program still folded');
  await page.keyboard.press('Escape');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written by Esc');
});

test('fr_mmp_02_ac41_spider_folded_nodes_on_each_side', async ({ page }) => {
  await openMm(page, MM2.pavouk);
  const p = await needFigure(page, 'Pavouk');
  await focusNode(p, 'Beta');
  await page.keyboard.press(' ');
  assert.ok(!(await treeNames(p)).includes('B1'), 'setup: Beta folded');
  await page.keyboard.press('ArrowRight');
  assert.equal((await focused(page)).name, 'Střed', 'folded Beta (left side): → reaches Střed');
  await focusNode(p, 'Beta');
  await page.keyboard.press('ArrowLeft');
  assert.ok((await treeNames(p)).includes('B1'), '← unfolds Beta (AP-2113)');
  assert.equal((await focused(page)).name, 'Beta', 'the focus stays on Beta');
  await focusNode(p, 'Alfa');
  await page.keyboard.press(' ');
  assert.ok(!(await treeNames(p)).includes('A1'), 'setup: Alfa folded');
  await page.keyboard.press('ArrowRight');
  assert.ok((await treeNames(p)).includes('A1'), 'folded Alfa (right side): → unfolds it');
  assert.equal((await focused(page)).name, 'Alfa', 'the focus stays on Alfa');
});

// ------------------------------------------------------------------------------------------------ AC-44

test('fr_mmp_02_ac44_hidden_nodes_leave_the_tree_and_the_focus_follows', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  assert.deepEqual(await Promise.all(['Výjezd 2026', 'Program', 'Místo', 'Doprava', 'Lisabon'].map((n) => expanded(fig, n))), ['true', 'true', 'true', null, null], 'aria-expanded "true" on nodes with children, none on leaves');
  await focusNode(fig, 'Plán 2027');
  await (await needNode(fig, 'Program')).hover();
  const ctl = foldControl(fig, 'Program');
  assert.equal(await foldName(fig, 'Program'), 'Collapse Program', 'the open control');
  await ctl.first().click();
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'clicking Collapse Program folds it');
  assert.equal(await expanded(fig, 'Program'), 'false', 'aria-expanded "false" on folded Program');
  assert.equal(await fig.locator('[role="treeitem"]').filter({ hasText: /^Přehled Q4$/ }).count(), 0, 'no treeitem for a hidden node');
  const f = await focusedWhen(page, (x) => x.name === 'Program');
  assert.deepEqual([f.role, f.name], ['treeitem', 'Program'], 'the focus moved from Plán 2027 to Program (AP-2115)');
  const items = await treeItems(fig);
  assert.deepEqual(items.map((i) => [i.name, i.level, i.posinset, i.setsize]), [['Výjezd 2026', 1, 1, 1], ['Program', 2, 1, 3], ['Místo', 2, 2, 3], ['Lisabon', 3, 1, 1], ['Doprava', 2, 3, 3]], 'aria-setsize / aria-posinset count the visible siblings');
  assert.deepEqual(await steps(page, ['End', 'Home']), ['Doprava', 'Výjezd 2026'], 'End reaches Doprava, Home the root');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-62

test('fr_ux_03_ac62_palette_commands_fold_and_add_a_child', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('mindmap node');
  const opts = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  assert.ok(opts.includes('Fold or unfold mindmap node') && opts.includes('Add child to mindmap node'), `the palette lists both commands: ${opts.join(', ')}`);
  await page.keyboard.press('Escape');
  await focusNode(fig, 'Program');
  await runCommand(page, 'Fold or unfold mindmap node');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'with Program focused: folded');
  await runCommand(page, 'Add child to mindmap node');
  assert.ok(await seen(pendingNode(fig), 1000), 'Add child: a pending child of Program');
  assert.ok((await treeNames(fig)).includes('Plán 2027'), 'Program unfolded first');
  await page.keyboard.press('Escape');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Plán výjezdu' }), 'Plán', 'the caret outside the mindmap');
  const before = await treeNames(fig);
  await runCommand(page, 'Fold or unfold mindmap node');
  await runCommand(page, 'Add child to mindmap node');
  await sleep(1200);
  assert.deepEqual(await treeNames(fig), before, 'with no mindmap focused they aren\'t run');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error');
  assert.deepEqual(await writes(core), [], 'nothing written');
});

test('fr_ux_03_ac62_buttons_carry_the_commands_on_every_hovered_node', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const registered = await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]);
  const bad: string[] = [];
  for (const name of ALL) {
    await (await needNode(fig, name)).hover();
    await sleep(80);
    const shown = await fig.getByRole('button').evaluateAll((bs) => bs.filter((b) => getComputedStyle(b).visibility !== 'hidden').map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent ?? '', cmd: b.getAttribute('data-command') })));
    if (!shown.some((b) => b.name === `Add child to ${name}`)) bad.push(`${name}: no visible "Add child to ${name}" on hover`);
    for (const b of shown) if (!b.cmd || !registered.includes(b.cmd)) bad.push(`${name} hovered: button "${b.name}" carries ${b.cmd} (not a registered command)`);
  }
  assert.deepEqual(bad, [], 'app-shell FR-UX-03 AC-8 with every node hovered (AP-2122)');
  assert.equal(await attrOf(addChildBtn(fig, 'Program'), 'data-command'), 'mindmap.addChild', 'the `+` carries mindmap.addChild');
  assert.equal(await attrOf(foldControl(fig, 'Program'), 'data-command'), 'mindmap.toggleFold', 'the fold control carries mindmap.toggleFold');
});

test('fr_ux_03_ac62_keyboard_only_run_to_w19', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  await page.evaluate(() => {
    (window as any).__pointer = 0;
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) window.addEventListener(t, (e) => { if ((e as MouseEvent).isTrusted) (window as any).__pointer++; }, true);
  });
  const fig = await needFigure(page, 'Výjezd 2026');
  await (await must(fig.getByRole('button', { name: 'List', exact: true }), 'button List')).focus();
  await page.keyboard.press('Tab');
  const f = await focused(page);
  assert.deepEqual([f.role, f.name], ['treeitem', 'Výjezd 2026'], 'Tab into the tree: the root');
  const got = await steps(page, ['ArrowRight', ' ']);
  assert.deepEqual(got, ['Program', 'Program'], '→ Program, Space');
  assert.deepEqual(await treeNames(fig), PROGRAM_FOLDED, 'Program folded');
  assert.deepEqual(await steps(page, ['ArrowDown', 'ArrowUp', 'ArrowRight']), ['Místo', 'Program', 'Program'], '↓ Místo, ↑ Program, → unfolds');
  assert.deepEqual(await treeNames(fig), ALL, 'unfolded');
  assert.deepEqual(await steps(page, ['ArrowRight', 'ArrowDown', 'ArrowDown', 'Home', 'ArrowRight']), ['Přehled Q4', 'Plán 2027', 'Lisabon', 'Výjezd 2026', 'Program'], '→ ↓ ↓ Home →');
  await page.keyboard.press('Alt+ArrowDown');
  const want = W19(original(MM.vyjezd));
  assert.equal(noModified(await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(want), 4000)), noModified(want), '⌥↓: W19 (the keyboard form of W23)');
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer events');
});
