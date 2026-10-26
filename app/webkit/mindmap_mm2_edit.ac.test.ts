// Slice MM2, L5 (WebKit, fake core): editing on the map with the keyboard (docs/acceptance/mindmap.md R95, R95a, R98;
// contract docs/contracts/mm-mindmap.md §6.3, §6.4). FR-MMP-02 AC-23 (the keys on the real map: bytes per W15…W22,
// the focus after, `data-view` stays `map`, the layout counter grows; the impossible keys change nothing), AC-24 (the
// text field `Edit node`), AC-25 (new nodes pending until committed, D-795), AC-26 (⌘Z / ⇧⌘Z with the map focused).
// Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900. Written from the ACs and the contract only (D-61);
// every missing element fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  MM, fieldState, fileText, fileWhen, focusNode, focused, focusedWhen, layouts, needFigure, needNode, needTree, nodeField, noModified, openMm,
  original, pendingNode, seen, sleep, swap, treeItems, treeNames, viewOf, writes, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const VY = '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n';

/** Waits until the file holds `want` (modified aside); returns the text. */
async function savedAs(core: FakeCoreHandle, path: string, want: string, ms = 4000): Promise<string | undefined> {
  return fileWhen(core, path, (x) => noModified(x) === noModified(want), ms);
}
/** Index of the treeitem named `name` in DOM order (-1 when absent). */
async function indexOf(fig: Locator, name: string): Promise<number> {
  return (await treeNames(fig)).indexOf(name);
}
async function pendingIndex(fig: Locator): Promise<number> {
  return fig.getByRole('tree').first().evaluate((t) => [...t.querySelectorAll('[role="treeitem"]')].findIndex((e) => e.getAttribute('data-node') === 'pending'));
}

type Case = { w: string; path: string; title: string | null; node: string; keys: (page: Page) => Promise<void>; before: string; after: string; focus: string };
const type = (s: string) => async (page: Page) => { await page.keyboard.type(s); };
const seq = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page) => { for (const s of steps) await s(page); };
const key = (k: string) => async (page: Page) => { await page.keyboard.press(k); };

const CASES: Case[] = [
  { w: 'W15', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Doprava', keys: seq(key('Enter'), type('Ubytování'), key('Enter')), before: '>   - Doprava\n', after: '>   - Doprava\n>   - Ubytování\n', focus: 'Ubytování' },
  { w: 'W15a', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Výjezd 2026', keys: seq(key('Enter'), type('Nocleh'), key('Enter')), before: '> - Výjezd 2026\n', after: '> - Výjezd 2026\n>   - Nocleh\n', focus: 'Nocleh' },
  { w: 'W15b', path: MM.vice, title: 'Témata', node: 'Témata', keys: seq(key('Enter'), type('Spánek'), key('Enter')), before: '> - Zdraví\n', after: '> - Zdraví\n> - Spánek\n', focus: 'Spánek' },
  { w: 'W16', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Doprava', keys: seq(key('Tab'), type('Vlak'), key('Enter')), before: '>   - Doprava\n', after: '>   - Doprava\n>     - Vlak\n', focus: 'Vlak' },
  { w: 'W17', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Plán 2027', keys: seq(key(' '), type(' v2'), key('Enter')), before: '>     - Plán 2027\n', after: '>     - Plán 2027 v2\n', focus: 'Plán 2027 v2' },
  { w: 'W17a', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Lisabon', keys: seq(key(' '), type(' město'), key('Enter')), before: '>     - [[Lisabon]]\n', after: '>     - [[Lisabon]] město\n', focus: 'Lisabon město' },
  { w: 'W18', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Plán 2027', keys: key('Backspace'), before: '>     - Plán 2027\n', after: '', focus: 'Přehled Q4' },
  { w: 'W19', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Program', keys: key('Alt+ArrowDown'), before: VY, after: '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n', focus: 'Program' },
  { w: 'W20', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Místo', keys: key('Alt+ArrowRight'), before: '>   - Místo\n>     - [[Lisabon]]\n', after: '>     - Místo\n>       - [[Lisabon]]\n', focus: 'Místo' },
  { w: 'W21', path: MM.vyjezd, title: 'Výjezd 2026', node: 'Přehled Q4', keys: key('Alt+ArrowLeft'), before: '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n', after: '>     - Plán 2027\n>   - Přehled Q4\n>   - Místo\n', focus: 'Přehled Q4' },
  { w: 'W22', path: MM.uzly, title: 'Uzly', node: 'Odstavec navíc …', keys: seq(key(' '), type(' x'), key('Enter')), before: '>   - Odstavec navíc\n>\n>     Druhý odstavec', after: '>   - Odstavec navíc x\n>\n>     Druhý odstavec', focus: 'Odstavec navíc x …' },
];

async function runCases(page: Page, cases: Case[]) {
  const bad: string[] = [];
  for (const c of cases) {
    const core = await openMm(page, c.path);
    const fig = await needFigure(page, c.title);
    await needTree(fig, c.title);
    const n0 = await layouts(page);
    await focusNode(fig, c.node);
    await c.keys(page);
    const want = swap(original(c.path), c.before, c.after);
    const t = await savedAs(core, c.path, want);
    if (noModified(t) !== noModified(want)) { bad.push(`${c.w}: saved ${JSON.stringify(t)}`); continue; }
    if ((await viewOf(fig)) !== 'map') bad.push(`${c.w}: data-view ${await viewOf(fig)} after the edit`);
    if (!((await layouts(page)) > n0)) bad.push(`${c.w}: the layout counter did not grow (re-laid out at once, D-786)`);
    const f = await focusedWhen(page, (x) => x.role === 'treeitem' && x.name === c.focus, 2000);
    if (f.role !== 'treeitem' || f.name !== c.focus) bad.push(`${c.w}: focus on ${f.role} "${f.name}", want treeitem "${c.focus}" (R95)`);
    if (await seen(nodeField(fig), 300)) bad.push(`${c.w}: the field is still open`);
  }
  assert.deepEqual(bad, [], 'R98 bytes (only the named lines and modified), Map kept, focus per R95');
}

// ------------------------------------------------------------------------------------------------ AC-23

test('fr_mmp_02_ac23_enter_and_tab_write_new_nodes_w15_w15a_w15b_w16', async ({ page }) => {
  test.setTimeout(120_000);
  await runCases(page, CASES.filter((c) => ['W15', 'W15a', 'W15b', 'W16'].includes(c.w)));
});

test('fr_mmp_02_ac23_space_edits_the_text_w17_w17a_w22', async ({ page }) => {
  test.setTimeout(120_000);
  await runCases(page, CASES.filter((c) => ['W17', 'W17a', 'W22'].includes(c.w)));
});

test('fr_mmp_02_ac23_backspace_and_alt_arrows_w18_w19_w20_w21', async ({ page }) => {
  test.setTimeout(120_000);
  await runCases(page, CASES.filter((c) => ['W18', 'W19', 'W20', 'W21'].includes(c.w)));
});

test('fr_mmp_02_ac23_impossible_keys_change_nothing', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const names0 = await treeNames(fig);
  const tries: [string, string][] = [
    ['Program', 'Backspace'], ['Program', 'Delete'], ['Výjezd 2026', 'Backspace'], ['Výjezd 2026', 'Delete'],
    ['Program', 'Alt+ArrowUp'], ['Program', 'Alt+ArrowRight'], ['Program', 'Alt+ArrowLeft'], ['Doprava', 'Alt+ArrowDown'], ['Výjezd 2026', 'Alt+ArrowUp'], ['Výjezd 2026', 'Alt+ArrowLeft'],
  ];
  const bad: string[] = [];
  for (const [node, k] of tries) {
    await focusNode(fig, node);
    await page.keyboard.press(k);
    await sleep(150);
    const names = await treeNames(fig);
    if (names.join('|') !== names0.join('|')) bad.push(`${k} on ${node}: tree ${names.join(', ')}`);
    const f = await focused(page);
    if (f.role !== 'treeitem' || f.name !== node) bad.push(`${k} on ${node}: focus moved to ${f.role} "${f.name}"`);
    if (await seen(nodeField(fig), 200)) bad.push(`${k} on ${node}: a field opened`);
    if ((await viewOf(fig)) !== 'map') bad.push(`${k} on ${node}: view ${await viewOf(fig)}`);
  }
  assert.deepEqual(bad, [], 'a node with children, the root: ⌫ / Delete nothing; first / last / first child / first-level: ⌥ arrows nothing (R95)');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'nothing written');
  assert.equal(await fileText(core, MM.vyjezd), original(MM.vyjezd), 'the file is unchanged');
  const core2 = await openMm(page, MM.vice);
  const f2 = await needFigure(page, 'Témata');
  await focusNode(f2, 'Témata');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await page.keyboard.press(' ');
  await sleep(1500);
  assert.deepEqual(await treeNames(f2), ['Témata', 'Rodina', 'Práce', 'Porady', 'Zdraví'], 'the synthesized root: ⌫, Delete and Space do nothing');
  assert.equal(await nodeField(f2).count(), 0, 'no field on the synthesized root');
  assert.deepEqual(await writes(core2), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-24

test('fr_mmp_02_ac24_space_f2_and_double_click_open_the_field_and_esc_cancels', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  const plan = await focusNode(fig, 'Plán 2027');
  await page.keyboard.press(' ');
  let s = await fieldState(fig);
  assert.ok(s, 'Space opens the textbox "Edit node" (R95a)');
  assert.deepEqual([s!.value, s!.caretAtEnd, s!.focused], ['Plán 2027', true, true], 'the value Plán 2027 with the caret at its end');
  assert.equal(await plan.locator('[data-node-editor]').count(), 1, 'the field is inside that node (data-node-editor)');
  assert.equal(await viewOf(fig), 'map', 'still Map');
  await page.keyboard.press('Escape');
  assert.equal(await nodeField(fig).count(), 0, 'Esc closes the field');
  assert.equal((await focusedWhen(page, (x) => x.name === 'Plán 2027')).name, 'Plán 2027', 'the node keeps the focus');
  assert.ok((await treeNames(fig)).includes('Plán 2027'), 'the node text unchanged');
  await page.keyboard.press('F2');
  s = await fieldState(fig);
  assert.equal(s?.value, 'Plán 2027', 'F2 opens the same field');
  await page.keyboard.press('Escape');
  await plan.dblclick();
  s = await fieldState(fig);
  assert.equal(s?.value, 'Plán 2027', 'a double-click opens the same field');
  await page.keyboard.press('Escape');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'zero note_write after the autosave delay');
  assert.equal(await fileText(core, MM.vyjezd), original(MM.vyjezd), 'the file unchanged');
});

test('fr_mmp_02_ac24_the_field_holds_the_markdown_source', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Lisabon');
  await page.keyboard.press(' ');
  assert.equal((await fieldState(fig))?.value, '[[Lisabon]]', 'Lisabon: the link as written');
  await page.keyboard.press('Escape');
  await openMm(page, MM.uzly);
  const u = await needFigure(page, 'Uzly');
  await focusNode(u, 'Tučně, kód a zvýraznění');
  await page.keyboard.press(' ');
  assert.equal((await fieldState(u))?.value, '**Tučně**, `kód` a ==zvýraznění==', 'Uzly: the source line as written in the fixture');
  await page.keyboard.press('Escape');
  await openMm(page, MM.nakup);
  const n = await needFigure(page, null);
  await focusNode(n, 'Mléko');
  await page.keyboard.press(' ');
  assert.equal((await fieldState(n))?.value, 'Mléko', 'Nákup: the `[x] ` box is not part of the text');
  await page.keyboard.press('Escape');
});

test('fr_mmp_02_ac24_no_popup_in_the_field_and_an_unchanged_commit_writes_nothing', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press(' ');
  assert.equal((await fieldState(fig))?.value, 'Doprava', 'the field');
  const bad: string[] = [];
  for (const s of ['[[', '#', '/']) {
    await page.keyboard.type(s);
    await sleep(300);
    const popups = (await page.getByRole('listbox').count()) + (await page.getByRole('menu').count()) + (await page.getByRole('dialog').count());
    if (popups > 0) bad.push(`${s}: ${popups} popup(s)`);
    if (!(await fieldState(fig))?.value.endsWith(s)) bad.push(`${s}: not typed as text (${(await fieldState(fig))?.value})`);
  }
  assert.deepEqual(bad, [], 'no autocomplete, menu or dialog opens in the field; `[[`, `#`, `/` are text');
  assert.equal((await fieldState(fig))?.value, 'Doprava[[#/', 'the typed text');
  await page.keyboard.press('Escape');
  await focusNode(fig, 'Plán 2027');
  await page.keyboard.press(' ');
  await page.keyboard.press('Enter');
  assert.equal(await nodeField(fig).count(), 0, '⏎ commits');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'an unchanged value writes nothing');
  assert.equal(await fileText(core, MM.vyjezd), original(MM.vyjezd), 'the file unchanged');
});

// ------------------------------------------------------------------------------------------------ AC-25

test('fr_mmp_02_ac25_new_nodes_are_pending_until_a_non_empty_commit', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('Enter');
  assert.ok(await seen(pendingNode(fig), 1000), 'a new empty treeitem (data-node="pending") with the field, before any write');
  assert.equal(await pendingIndex(fig), (await indexOf(fig, 'Doprava')) + 1, 'after Doprava');
  assert.equal(await pendingNode(fig).getAttribute('aria-level'), '2', 'a sibling: the same level');
  assert.equal((await fieldState(fig))?.value, '', 'editing, empty');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written while the field is open (D-795)');
  await page.keyboard.press('Escape');
  assert.equal(await pendingNode(fig).count(), 0, 'Esc removes it again');
  assert.deepEqual(await treeNames(fig), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'], 'the tree as before');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('Enter');
  await seen(pendingNode(fig), 1000);
  await page.keyboard.press('Enter');
  assert.equal(await pendingNode(fig).count(), 0, '⏎ on an empty value removes it too');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ubytování');
  await page.keyboard.press('Enter');
  const want = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava\n>   - Ubytování\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, want)), noModified(want), 'typing Ubytování then ⏎ is W15');
  const items = await treeItems(fig);
  assert.equal(items.find((i) => i.name === 'Ubytování')?.tone, 'teal', 'a new first-level node after Doprava is teal (the 4th branch)');
  assert.equal(await pendingNode(fig).count(), 0, 'no pending node after the commit');
});

test('fr_mmp_02_ac25_tab_adds_the_child_last', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Program');
  await page.keyboard.press('Tab');
  assert.ok(await seen(pendingNode(fig), 1000), 'Tab on Program: a pending child');
  assert.equal(await pendingIndex(fig), (await indexOf(fig, 'Plán 2027')) + 1, 'after Plán 2027 (the last child)');
  assert.equal(await pendingNode(fig).getAttribute('aria-level'), '3', 'one level deeper');
  await page.keyboard.press('Escape');
  assert.equal(await pendingNode(fig).count(), 0, 'Esc removes it');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('Tab');
  assert.equal(await pendingIndex(fig), (await indexOf(fig, 'Doprava')) + 1, 'Tab on Doprava: the child right after it');
  await page.keyboard.type('Vlak');
  await page.keyboard.press('Enter');
  const want = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava\n>     - Vlak\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, want)), noModified(want), 'W16');
  assert.equal((await treeItems(fig)).find((i) => i.name === 'Vlak')?.tone, 'plain', 'a depth-3 node is neutral');
});

// ------------------------------------------------------------------------------------------------ AC-26

test('fr_mmp_02_ac26_undo_and_redo_with_the_map_focused_w15_and_w19', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ubytování');
  await page.keyboard.press('Enter');
  const w15 = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava\n>   - Ubytování\n');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w15)), noModified(w15), 'W15');
  assert.equal((await focusedWhen(page, (x) => x.role === 'treeitem')).role, 'treeitem', 'the map is focused');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), '⌘Z restores the block\'s previous bytes');
  assert.equal(await viewOf(fig), 'map', 'data-view stays map');
  let f = await focusedWhen(page, (x) => x.role === 'treeitem');
  assert.equal(f.role, 'treeitem', 'the focus stays on the tree');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noModified(await savedAs(core, MM.vyjezd, w15)), noModified(w15), '⇧⌘Z re-applies W15');
  f = await focusedWhen(page, (x) => x.name === 'Ubytování');
  assert.equal(f.name, 'Ubytování', 'the focus returns to the edited node');
  assert.equal(await viewOf(fig), 'map', 'still map');
  // W19 from a fresh copy
  const core2 = await openMm(page, MM.vyjezd);
  const f2 = await needFigure(page, 'Výjezd 2026');
  await focusNode(f2, 'Program');
  await page.keyboard.press('Alt+ArrowDown');
  const w19 = swap(original(MM.vyjezd), VY, '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n');
  assert.equal(noModified(await savedAs(core2, MM.vyjezd, w19)), noModified(w19), 'W19');
  await page.keyboard.press(' ');
  assert.ok(await fieldState(f2), 'the field opens');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(core2, MM.vyjezd, original(MM.vyjezd))), noModified(original(MM.vyjezd)), '⌘Z after an opened-then-cancelled field still undoes W19 (not an undo step)');
  f = await focusedWhen(page, (x) => x.name === 'Program');
  assert.equal(f.name, 'Program', 'the focus returns to Program');
  assert.deepEqual(await treeNames(f2), ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'], 'the tree as before W19');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noModified(await savedAs(core2, MM.vyjezd, w19)), noModified(w19), '⇧⌘Z re-applies W19');
  assert.equal(await viewOf(f2), 'map', 'data-view map throughout');
});
