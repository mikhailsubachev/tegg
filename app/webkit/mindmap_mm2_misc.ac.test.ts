// Slice MM2, L5 (WebKit, fake core): read views, no-write, keyboard, palette and string checks of map editing and the
// layouts (docs/acceptance/mindmap.md part two; contract docs/contracts/mm-mindmap.md §6). FR-MMP-02 AC-31 (the read
// view and a read-only note: navigation only, no field, no switch), FR-FMT-07 AC-25 (opened, navigated, field
// cancelled: zero `note_write`; W14 keeps `[!note|wide]`), FR-UX-03 AC-16 (Tab order, the palette commands, the
// radios' `data-command`, the keyboard-only run), NFR-OTH-02 AC-8 (pseudo-locale). Test clock 2026-10-22T10:00
// Europe/Prague, region cs, 1440 × 900. Written from the ACs and the contract only (D-61); every missing element
// fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { paletteDialog, pseudoLocale } from './helpers';
import {
  MM, MM2, TITLES2, checkedLayout, click, editorBody, fieldState, fileText, fileWhen, focusNode, focused, focusedWhen, gotoNote, layoutGroup, layoutOf,
  listBtn, main, mapBtn, must, mustBeOn, mustCaret, needFigure, needNode, needTree, nodeField, noModified, openMm, original, radioRight, radioSpider,
  runCommand, seen, slashMenu, sleep, startMm, swap, titleField, treeNames, vaultWrites, viewOf, viewWhen, writes, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const EDIT_KEYS = ['Enter', ' ', 'F2', 'Tab', 'Backspace', 'Delete', 'Alt+ArrowUp', 'Alt+ArrowDown', 'Alt+ArrowRight', 'Alt+ArrowLeft'];

/** The read view of `path` (the `Show formatted note` button when the note opened in the source view). */
async function openRead(page: Page, path: string): Promise<FakeCoreHandle> {
  const core = await openMm(page, path, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  return core;
}
/** Every edit key, a double-click and ⌘V on `node`: the tree, the file and the view must not change. */
async function navigationOnly(page: Page, core: FakeCoreHandle, fig: Locator, nodeName: string, path: string, what: string): Promise<string[]> {
  const bad: string[] = [];
  const names0 = await treeNames(fig);
  const n = await focusNode(fig, nodeName);
  for (const k of EDIT_KEYS) {
    await page.keyboard.press(k);
    await sleep(100);
    if (await seen(nodeField(fig), 200)) bad.push(`${what}: ${k} opened a field`);
    if ((await treeNames(fig)).join('|') !== names0.join('|')) bad.push(`${what}: ${k} changed the tree`);
    if (k === 'Tab') await focusNode(fig, nodeName);
  }
  await n.dblclick();
  await sleep(200);
  if (await seen(nodeField(fig), 200)) bad.push(`${what}: a double-click opened a field`);
  if ((await treeNames(fig)).join('|') !== names0.join('|')) bad.push(`${what}: the tree changed`);
  await sleep(1200);
  if ((await writes(core)).length > 0) bad.push(`${what}: ${(await writes(core)).length} note_write`);
  if ((await fileText(core, path)) !== original(path)) bad.push(`${what}: the file changed`);
  if ((await layoutGroup(fig).count()) !== 0) bad.push(`${what}: a layout switch is shown`);
  return bad;
}

// ------------------------------------------------------------------------------------------------ AC-31

test('fr_mmp_02_ac31_read_view_tree_is_navigation_only', async ({ page }) => {
  let core = await openRead(page, MM2.pavouk);
  let fig = await needFigure(page, 'Pavouk');
  await needTree(fig, 'Pavouk');
  const bad = await navigationOnly(page, core, fig, 'Beta', MM2.pavouk, 'Pavouk read view');
  await focusNode(fig, 'Střed');
  await page.keyboard.press('ArrowLeft');
  if ((await focused(page)).name !== 'Beta') bad.push(`Pavouk read view: ← on the root reaches ${(await focused(page)).name}, not Beta (navigation still works)`);
  assert.deepEqual(bad, [], 'Pavouk in the read view: keys and a double-click change nothing, write nothing, open no field');
  core = await openRead(page, MM.vyjezd);
  fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  assert.deepEqual(await navigationOnly(page, core, fig, 'Program', MM.vyjezd, 'Výjezd read view'), [], 'Výjezd in the read view');
  await focusNode(fig, 'Lisabon');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Lisabon', '⌘↩ still opens the first link');
});

test('fr_mmp_02_ac31_a_read_only_note_is_navigation_only', async ({ page }) => {
  const core = await openRead(page, MM.neplatna);
  const fig = await needFigure(page, 'Jen ke čtení');
  await needTree(fig, 'Jen ke čtení');
  assert.deepEqual(await navigationOnly(page, core, fig, 'Druhá větev', MM.neplatna, 'Neplatná mapa (read-only)'), [], 'a note shown read-only: navigation only (D-786)');
  assert.equal(await nodeField(fig).count(), 0, 'no Edit node field');
  assert.equal(await layoutGroup(fig).count(), 0, 'no layout switch');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-25 (L5)

test('fr_fmt_07_ac25_opening_navigating_and_cancelling_the_field_writes_nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await startMm(page, { at: MM.lisabon });
  await mustBeOn(page, 'Lisabon', 'start');
  const files0 = { ...(await core.files()) };
  const maps: [string, string][] = [[MM2.pavouk, 'Pavouk'], [MM2.neznama, 'Cizí'], [MM2.metadata, 'Velká písmena']];
  for (const [path, title] of maps) {
    await gotoNote(page, TITLES2[path]);
    const fig = await needFigure(page, title);
    await needTree(fig, title);
    assert.ok(await seen(layoutGroup(fig), 1000), `${title}: the layout switch is shown (untouched)`);
    await focusNode(fig, (await treeNames(fig))[0]);
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowDown', 'ArrowLeft']) await page.keyboard.press(k);
    const target = (await focused(page)).name;
    if (title !== 'Velká písmena' || target !== title) {
      await page.keyboard.press(' ');
      assert.ok(await fieldState(fig), `${title}: Space opens the field on ${target}`);
      await page.keyboard.press('Escape');
    }
    await click(listBtn(fig), `${title}: List`);
    assert.equal(await viewWhen(fig, 'list'), 'list', `${title}: List`);
    await click(mapBtn(fig), `${title}: Map`);
    assert.equal(await viewWhen(fig, 'map'), 'map', `${title}: Map`);
  }
  for (const [path, title] of maps) {
    await openRead(page, path);
    await needFigure(page, title);
  }
  await sleep(1500);
  assert.deepEqual(await vaultWrites(core), [], 'zero note_write');
  assert.deepEqual(await core.files(), files0, 'every file byte-identical');
});

test('fr_fmt_07_ac25_w14_keeps_note_wide_as_written', async ({ page }) => {
  const core = await openMm(page, MM2.metadata);
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Odstavec v calloutu.' }), 'Odstavec v calloutu.', 'end of the paragraph');
  await page.keyboard.type(' navíc');
  const want = swap(original(MM2.metadata), '> Odstavec v calloutu.\n', '> Odstavec v calloutu. navíc\n');
  const t = await fileWhen(core, MM2.metadata, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'W14: only that line (and modified); `[!note|wide]` kept');
  assert.ok(t?.includes('> [!note|wide] Poznámka\n> Odstavec v calloutu. navíc\n'), 'the callout line as written');
  assert.ok(t?.includes('> [!Mindmap|SPIDER]+ Velká písmena\n'), 'the mindmap\'s metadata untouched');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-16

test('fr_ux_03_ac16_tab_order_and_data_commands', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await needTree(fig, 'Výjezd 2026');
  const right = await must(radioRight(fig), 'radio "Branches to the right"');
  const spider = await must(radioSpider(fig), 'radio "Spider: branches on both sides"');
  assert.equal(await right.getAttribute('data-command'), 'mindmap.layoutRight', 'the right radio carries mindmap.layoutRight (FR-UX-03 AC-8)');
  assert.equal(await spider.getAttribute('data-command'), 'mindmap.layoutSpider', 'the spider radio carries mindmap.layoutSpider');
  await (await must(mapBtn(fig), 'button Map')).focus();
  await page.keyboard.press('Shift+Tab');
  let f = await focused(page);
  assert.deepEqual([f.role, f.name], ['radio', 'Branches to the right'], '⇧Tab from Map: the layout switch (its checked radio)');
  await page.keyboard.press('Shift+Tab');
  f = await focused(page);
  assert.notEqual(f.role, 'radio', 'the group is one Tab stop');
  await page.keyboard.press('Tab');
  f = await focused(page);
  assert.deepEqual([f.role, f.name], ['radio', 'Branches to the right'], 'Tab reaches the layout switch first');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'Map', 'then Map');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'List', 'then List');
  await page.keyboard.press('Tab');
  f = await focused(page);
  assert.deepEqual([f.role, f.node], ['treeitem', '0'], 'then the tree (one stop, the root)');
  await openMm(page, MM2.pavouk);
  const p = await needFigure(page, 'Pavouk');
  const cmds = await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]);
  assert.ok(cmds.includes('mindmap.layoutRight') && cmds.includes('mindmap.layoutSpider'), `both commands are registered (${cmds.filter((c) => c.startsWith('mindmap')).join(', ')})`);
  const carried = await p.locator('[data-command]').evaluateAll((es) => es.map((e) => e.getAttribute('data-command')));
  for (const id of ['mindmap.layoutRight', 'mindmap.layoutSpider', 'mindmap.showMap', 'mindmap.showList']) assert.ok(carried.includes(id), `Pavouk's header carries ${id} (app-shell FR-UX-03 AC-8)`);
});

test('fr_ux_03_ac16_palette_commands_do_w12_and_w13_and_nothing_outside', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Mindmap layout');
  const opts = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  assert.ok(opts.includes('Mindmap layout: right') && opts.includes('Mindmap layout: spider'), `the palette lists both: ${opts.join(', ')}`);
  await page.keyboard.press('Escape');
  await focusNode(fig, 'Program');
  await runCommand(page, 'Mindmap layout: spider');
  const w12 = swap(original(MM.vyjezd), '> [!mindmap] Výjezd 2026\n', '> [!mindmap|spider] Výjezd 2026\n');
  const t = await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(w12), 4000);
  assert.equal(noModified(t), noModified(w12), 'with the tree focused: W12');
  assert.equal(await checkedLayout(fig), 'spider', 'the radio follows');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'caret in the block');
  await runCommand(page, 'Mindmap layout: right');
  const t2 = await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(original(MM.vyjezd)), 4000);
  assert.equal(noModified(t2), noModified(original(MM.vyjezd)), 'with the caret in the block: W13');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Plán výjezdu' }), 'Plán', 'caret outside the mindmap');
  const n = (await writes(core)).length;
  await runCommand(page, 'Mindmap layout: spider');
  await sleep(1500);
  assert.equal((await writes(core)).length, n, 'outside any mindmap: not run, nothing written');
  assert.equal(await checkedLayout(fig), 'right', 'the block unchanged');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error');
});

test('fr_ux_03_ac16_keyboard_only_run', async ({ page }) => {
  const core = await openMm(page, MM.prazdna);
  await page.evaluate(() => {
    (window as any).__pointer = 0;
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick']) window.addEventListener(t, (e) => { if ((e as MouseEvent).isTrusted) (window as any).__pointer++; }, true);
  });
  await (await must(titleField(page), 'Title')).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('/mindmap');
  await must(slashMenu(page), 'slash menu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Kořen');
  await runCommand(page, 'Show mindmap as map');
  const fig = await needFigure(page, null);
  assert.equal(await viewWhen(fig, 'map'), 'map', 'Map from the palette');
  assert.equal((await focusedWhen(page, (x) => x.role === 'treeitem')).name, 'Kořen', 'the focus on the root');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Větev');
  await page.keyboard.press('Enter');
  assert.equal((await focusedWhen(page, (x) => x.name === 'Větev')).name, 'Větev', 'Tab, Větev, ⏎: the new child focused');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Druhá');
  await page.keyboard.press('Enter');
  assert.equal((await focusedWhen(page, (x) => x.name === 'Druhá')).name, 'Druhá', '⏎, Druhá, ⏎: the new sibling focused');
  // To the layout switch by keyboard: ⇧Tab back through the tree, List and Map to the group (one stop), then →.
  let reached = false;
  for (let i = 0; i < 6 && !reached; i++) {
    await page.keyboard.press('Shift+Tab');
    reached = (await focused(page)).role === 'radio';
  }
  assert.equal(reached, true, '⇧Tab reaches the layout switch');
  await page.keyboard.press('ArrowRight');
  const want = original(MM.prazdna) + '> [!mindmap|spider]\n> - Kořen\n>   - Větev\n>   - Druhá\n';
  const t = await fileWhen(core, MM.prazdna, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'the saved block');
  assert.equal(await layoutOf(fig), 'spider', 'drawn in spider');
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer events');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-8 (L5)

test('nfr_oth_02_ac8_pseudo_locale_wraps_the_switch_the_field_and_the_commands', async ({ page }) => {
  await openMm(page, MM2.pavouk, { prelude: pseudoLocale });
  const fig = main(page).getByRole('figure', { name: '⟦Mindmap: Pavouk⟧', exact: true });
  await must(fig, 'figure "⟦Mindmap: Pavouk⟧"', 5000);
  const group = await must(fig.getByRole('radiogroup', { name: '⟦Mindmap layout⟧', exact: true }), 'radiogroup ⟦Mindmap layout⟧');
  await must(group.getByRole('radio', { name: '⟦Branches to the right⟧', exact: true }), 'radio ⟦Branches to the right⟧');
  await must(group.getByRole('radio', { name: '⟦Spider: branches on both sides⟧', exact: true }), 'radio ⟦Spider: branches on both sides⟧');
  const alfa = await must(fig.getByRole('treeitem', { name: 'Alfa', exact: true }), 'treeitem Alfa (user content, not wrapped)');
  await alfa.focus();
  await page.keyboard.press(' ');
  const field = await must(fig.getByRole('textbox', { name: '⟦Edit node⟧', exact: true }), 'textbox ⟦Edit node⟧');
  assert.equal(await field.evaluate((el) => (el instanceof HTMLInputElement ? el.value : el.textContent) ?? ''), 'Alfa', 'the node text stays user content');
  await page.keyboard.press('Escape');
  const bare = await fig.evaluate((f) => {
    const out: string[] = [];
    for (const e of f.querySelectorAll('[aria-label]') as NodeListOf<HTMLElement>) {
      const l = e.getAttribute('aria-label') ?? '';
      if (e.closest('[role="treeitem"]') || e.getAttribute('role') === 'treeitem' || e.getAttribute('role') === 'tree') continue;
      if (!/^⟦.*⟧$/s.test(l)) out.push(l);
    }
    return out;
  });
  assert.deepEqual(bare, [], 'every accessible name of the header is wrapped');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: /Command query/ }).fill('Mindmap layout');
  const opts = await page.getByRole('listbox', { name: /Commands/ }).getByRole('option').allInnerTexts();
  assert.ok(opts.some((o) => o.includes('⟦Mindmap layout: right⟧')) && opts.some((o) => o.includes('⟦Mindmap layout: spider⟧')), `commands wrapped: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
});
