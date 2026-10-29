// Slice MM, L5 (WebKit, fake core): the mindmap block, Map and List (docs/acceptance/mindmap.md R91; contract
// docs/contracts/mm-mindmap.md §3, §4). FR-MMP-02 AC-1 (the block), AC-2 (the root, a title change redraws it),
// AC-3 (empty state), AC-4 (hint callouts), AC-5 (opens in Map; a node click goes to List with the caret), AC-6 (the
// List view and the live map, layout counter), AC-7 (the view is session state, never written), AC-8 (read view:
// always Map, links clickable), AC-17 (folding). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900.
// Written from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  MM, anyTree, callsOf, caretWhen, click, emptyBtn, eventually, figure, figures, fileText, fileWhen, foldBtn, gotoNote, layouts, listBtn, main,
  mapBtn, mindmapVault, must, mustBeOn, mustCaret, namesWhen, needFigure, needNode, needTree, node, noModified, openMm, original, pressed, seen,
  sleep, swap, titleField, tree, treeItems, treeNames, vaultWrites, viewGroup, viewOf, viewWhen, writes, editorBody, focusedWhen,
} from './mindmap-helpers';
import { ui as mmUi } from './mindmap-helpers';
import { escPreview, mustNoPreview, mustPreview, switchPreviewMode } from './helpers';
import { setPreviewMode } from '../ui/test/fake-core';

test.use({ timezoneId: 'Europe/Prague' });

const VYJEZD_NODES = ['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava'];

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_mmp_02_ac1_vyjezd_shows_one_figure_with_header_and_tree', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  assert.equal(await figures(page).count(), 1, 'one mindmap block');
  const order = await main(page).evaluate((m) => {
    const all = [...m.querySelectorAll('p, [role="figure"], figure')] as HTMLElement[];
    return all.map((e) => (e.matches('[role="figure"], figure') ? `FIG:${e.getAttribute('aria-label') ?? ''}` : (e.textContent ?? '').trim())).filter((x) => x === 'Plán výjezdu týmu.' || x === 'Poznámka pod mapou.' || x.startsWith('FIG:'));
  });
  assert.deepEqual(order, ['Plán výjezdu týmu.', 'FIG:Mindmap: Výjezd 2026', 'Poznámka pod mapou.'], 'between the two paragraphs');
  assert.ok(await seen(fig.locator('[data-icon="mindmap"][aria-hidden="true"]'), 1000), 'the header shows the mindmap icon (aria-hidden)');
  assert.ok(await seen(fig.getByText('Výjezd 2026', { exact: true }).first(), 1000), 'the header title');
  await must(viewGroup(fig), 'group "Mindmap view"');
  assert.deepEqual([await pressed(mapBtn(fig)), await pressed(listBtn(fig))], ['true', 'false'], 'Map pressed');
  await needTree(fig, 'Výjezd 2026');
  const items = await treeItems(fig);
  assert.deepEqual(items.map((i) => [i.name, i.level]), VYJEZD_NODES.map((n, i) => [n, [1, 2, 3, 3, 2, 3, 2][i]]), 'seven treeitems in outline order with aria-level');
  assert.deepEqual(items.map((i) => [i.posinset, i.setsize]), [[1, 1], [1, 3], [1, 2], [2, 2], [2, 3], [1, 1], [3, 3]], 'aria-posinset / aria-setsize');
  for (const gone of ['Zoom in', 'Zoom out', 'Open full screen', 'Visual', 'Source']) {
    assert.equal(await fig.getByRole('button', { name: gone, exact: true }).count(), 0, `no button "${gone}" (D-684)`);
  }
  assert.ok(!(await fig.innerText()).includes('Mermaid'), 'no text "Mermaid"');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_mmp_02_ac2_synthesized_roots', async ({ page }) => {
  const want: [string, string | null, string, string[]][] = [
    [MM.vice, 'Témata', 'Témata', ['Témata', 'Rodina', 'Práce', 'Porady', 'Zdraví']],
    [MM.bez, null, 'Bez titulku', ['Bez titulku', 'Jaro', 'Léto']],
    [MM.hola, null, 'Holá mapa', ['Holá mapa', 'Sever', 'Jih']],
  ];
  for (const [path, title, root, names] of want) {
    await openMm(page, path);
    const fig = await needFigure(page, title);
    await needTree(fig, title);
    assert.deepEqual(await treeNames(fig), names, `${path}: root ${root} (D-681)`);
    const items = await treeItems(fig);
    assert.equal(items[0]?.node, 'root', `${path}: the synthesized root is node "root"`);
    assert.equal(items[0]?.tone, 'root', `${path}: drawn as a root (R92)`);
  }
});

test('fr_mmp_02_ac2_note_title_change_redraws_the_root_and_writes_only_title', async ({ page }) => {
  const core = await openMm(page, MM.bez);
  const fig = await needFigure(page, null);
  await needNode(fig, 'Bez titulku');
  const t = await must(titleField(page), 'textbox "Title"');
  await t.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 2');
  const t0 = Date.now();
  const names = await namesWhen(fig, (n) => n[0] === 'Bez titulku 2', 500);
  assert.equal(names[0], 'Bez titulku 2', `the root redraws within 500 ms (${Date.now() - t0} ms)`);
  await page.keyboard.press('Enter');
  // ⏎ commits the title, which renames the file (D-268); its bytes are read under the new name.
  const after = await fileWhen(core, 'Pages/Bez titulku 2.md', (x) => !!x && x.includes('title: Bez titulku 2'));
  assert.equal(noModified(after), noModified(swap(original(MM.bez), 'title: Bez titulku\n', 'title: Bez titulku 2\n')), 'only `title:` (and modified) written; the callout bytes untouched');
});

test('fr_mmp_02_ac2_a_click_on_the_synthesized_root_changes_no_list_item', async ({ page }) => {
  const core = await openMm(page, MM.vice);
  const fig = await needFigure(page, 'Témata');
  await click(node(fig, 'Témata'), 'treeitem "Témata"');
  assert.equal(await viewOf(fig), 'map', 'the click focuses the node, the view stays Map (slice MM2, D-788)');
  await click(listBtn(fig), 'List'); // D-794: List follows the focused node
  assert.equal(await viewWhen(fig, 'list'), 'list', 'List');
  const c = await caretWhen(page, (x) => x.text === 'Témata');
  assert.deepEqual([c.text, c.atEnd, c.inBody], ['Témata', true, true], 'a title root: the caret at the end of the title (AP-732)');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'no list item changes, nothing written');
  await openMm(page, MM.bez);
  const f2 = await needFigure(page, null);
  await click(node(f2, 'Bez titulku'), 'treeitem "Bez titulku"');
  await click(listBtn(f2), 'List');
  const c2 = await caretWhen(page, (x) => x.text === 'Jaro' && x.atStart);
  assert.deepEqual([c2.text, c2.atStart], ['Jaro', true], 'a note-title root: the caret at the start of the first item (AP-732)');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_mmp_02_ac3_empty_state_button_then_first_item', async ({ page }) => {
  const core = await openMm(page, MM.rozpoznani);
  const fig = await needFigure(page, 'Prázdná');
  const btn = await must(emptyBtn(fig), 'button "Type the central topic" in Map');
  assert.equal(await tree(fig, 'Prázdná').count(), 0, 'no tree in the empty state');
  await btn.click();
  assert.equal(await viewWhen(fig, 'list'), 'list', 'activating it switches to List');
  const c = await caretWhen(page, (x) => x.inBody && x.text === '');
  assert.deepEqual([c.inBody, c.text], [true, ''], 'the caret is in one empty item');
  assert.ok(await seen(fig.getByText('Type the central topic').first(), 1000), 'the empty item shows the placeholder');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing is written until a character is typed');
  await page.keyboard.type('Téma');
  const t = await fileWhen(core, MM.rozpoznani, (x) => !!x && x.includes('> - Téma'));
  assert.equal(noModified(t), noModified(swap(original(MM.rozpoznani), '> [!mindmap] Prázdná\n', '> [!mindmap] Prázdná\n> - Téma\n')), 'typing Téma saves the item');
});

test('fr_mmp_02_ac3_leaving_the_empty_item_writes_nothing', async ({ page }) => {
  const core = await openMm(page, MM.rozpoznani);
  const fig = await needFigure(page, 'Prázdná');
  await click(emptyBtn(fig), 'button "Type the central topic"');
  await caretWhen(page, (x) => x.inBody && x.text === '');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Jen text' }), null, 'caret elsewhere');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'moving the caret elsewhere writes nothing');
  await page.goBack().catch(() => {});
  await sleep(500);
  assert.deepEqual(await writes(core), [], 'leaving the note writes nothing');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_mmp_02_ac4_hint_callouts_and_unknown_types', async ({ page }) => {
  const core = await openMm(page, MM.rozpoznani);
  await needFigure(page, 'Navazující text');
  const notes = main(page).getByRole('note');
  for (const title of ['Odstavec', 'Dva seznamy', 'Seznam a odstavec', 'Komentář']) {
    const n = notes.filter({ hasText: title }).first();
    await must(n, `note "${title}"`);
    assert.ok(await seen(n.locator('[data-icon="mindmap"]'), 1000), `${title}: the mindmap icon`);
    assert.ok(await seen(n.getByText('A mindmap holds one list', { exact: true }), 1000), `${title}: the hint text`);
    assert.equal(await n.getByRole('group', { name: 'Mindmap view' }).count(), 0, `${title}: no view switch`);
    assert.equal(await anyTree(n).count(), 0, `${title}: no tree`);
  }
  const two = notes.filter({ hasText: 'Dva seznamy' }).first();
  assert.equal(await two.locator('ul').count(), 2, '(2) shows its two lists');
  const third = notes.filter({ hasText: 'Seznam a odstavec' }).first();
  assert.ok((await third.innerText()).includes('Odstavec za seznamem.'), '(3) its paragraph');
  // (4): in the editor a `%%comment%%` paragraph is a source block, as in any note (editor.md FR-EDT-01 AC-8); it is
  // hidden in the read view only.
  const fourth = notes.filter({ hasText: 'Komentář' }).first();
  assert.ok(await seen(fourth.locator('[data-raw-inline^="%%"]'), 1000), '(4) the comment as preserved source text, as in any note');
  for (const title of ['Pomlčka', 'Množné']) {
    const n = notes.filter({ hasText: title }).first();
    await must(n, `note "${title}"`);
    assert.equal(await n.locator('[data-icon="mindmap"]').count(), 0, `${title}: no mindmap icon`);
    assert.ok(!(await n.innerText()).includes('A mindmap holds one list'), `${title}: no hint`);
  }
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'opening Rozpoznání writes nothing');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_mmp_02_ac5_every_block_opens_in_map', async ({ page }) => {
  const want: [string, (string | null)[]][] = [
    [MM.vyjezd, ['Výjezd 2026']], [MM.uzly, ['Uzly']], [MM.nakup, [null]], [MM.postup, ['Postup']], [MM.vice, ['Témata']], [MM.bez, [null]],
    [MM.hola, [null]], [MM.obsidian, ['Z Obsidianu']], [MM.rozlozeni, ['Strom', 'Zalomení', 'Paleta']], [MM.rozbaleni, ['Titulek mapy', null]],
    [MM.rozpoznani, ['Navazující text', 'Prázdná položka', 'Velké písmeno', 'Prázdná']], [MM.slozene, ['Rozbalená mapa']],
  ];
  const bad: string[] = [];
  for (const [path, titles] of want) {
    await openMm(page, path);
    for (const t of titles) {
      const f = figure(page, t);
      if (!(await seen(f, 3000))) { bad.push(`${path}: no figure ${t ?? 'Mindmap'}`); continue; }
      if ((await viewOf(f)) !== 'map') bad.push(`${path} ${t}: data-view ${await viewOf(f)}`);
      if ((await pressed(mapBtn(f))) !== 'true') bad.push(`${path} ${t}: Map not pressed`);
    }
  }
  assert.deepEqual(bad, [], 'every mindmap block opens in Map (D-684)');
});

// Slice MM2 (D-788, AP-750 → D-794): a click focuses the node and stays in Map; `List` pressed afterwards puts the caret at
// the end of the focused node's item.
test('fr_mmp_02_ac5_node_click_goes_to_list_with_the_caret', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(node(fig, 'Program'), 'treeitem "Program"');
  const f = await focusedWhen(page, (x) => x.role === 'treeitem' && x.name === 'Program');
  assert.deepEqual([f.role, f.name], ['treeitem', 'Program'], 'a click focuses the node (D-788)');
  assert.equal(await viewOf(fig), 'map', 'data-view stays map');
  assert.equal(await pressed(mapBtn(fig)), 'true', 'Map still pressed');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'nothing written');
  await click(listBtn(fig), 'List');
  assert.equal(await pressed(listBtn(fig)), 'true', 'List pressed');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'the list is shown');
  const c = await caretWhen(page, (x) => x.text === 'Program' && x.atEnd && x.inBody);
  assert.deepEqual([c.text, c.atEnd, c.inBody], ['Program', true, true], 'List puts the caret at the end of Program inside Note body (AP-750)');
  await page.keyboard.type(' a cíle');
  const t = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('Program a cíle'));
  assert.equal(noModified(t), noModified(swap(original(MM.vyjezd), '>   - Program\n', '>   - Program a cíle\n')), 'only that line changes');
  await click(mapBtn(fig), 'Map');
  await click(node(fig, 'Výjezd 2026'), 'treeitem "Výjezd 2026"');
  assert.equal(await viewOf(fig), 'map', 'the root click stays in Map');
  await click(listBtn(fig), 'List');
  const c2 = await caretWhen(page, (x) => x.text === 'Výjezd 2026' && x.atEnd);
  assert.deepEqual([c2.text, c2.atEnd], ['Výjezd 2026', true], 'the root item: the caret at its end');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_mmp_02_ac6_list_view_edits_and_the_live_map', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'List view');
  assert.ok(await seen(tree(fig, 'Výjezd 2026'), 1000), 'the map stays below the list (AP-737)');
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ubytování');
  let t = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('Ubytování'));
  assert.ok(t?.includes('>   - Doprava\n>   - Ubytování\n'), `⏎ adds a sibling: ${JSON.stringify(t)}`);
  await page.keyboard.press('Tab');
  t = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('>     - Ubytování'));
  assert.ok(t?.includes('>   - Doprava\n>     - Ubytování\n'), 'Tab nests it under Doprava');
  const items = await eventually(() => treeItems(fig), (i) => i.some((x) => x.name === 'Ubytování' && x.level === 3), 500);
  const u = items.find((x) => x.name === 'Ubytování');
  assert.equal(u?.level, 3, 'within 500 ms the map shows Ubytování as a child of Doprava');
  await page.keyboard.press('Shift+Tab');
  t = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('>   - Ubytování'));
  assert.ok(t?.includes('>   - Doprava\n>   - Ubytování\n'), '⇧Tab un-nests the nested item');
  await click(node(fig, 'Přehled Q4'), 'a node of the map below the list');
  // Slice MM2 (D-788): the click focuses the node; the caret stays where it was and the view stays List.
  assert.equal(await (await needNode(fig, 'Přehled Q4')).evaluate((el) => el === document.activeElement), true, 'the click focuses that node');
  assert.equal(await viewOf(fig), 'list', 'without leaving List');
});

test('fr_mmp_02_ac6_layout_at_most_once_per_150_ms_while_typing', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava');
  const n0 = await layouts(page);
  assert.ok(n0 >= 0, 'the test hook window.__TEGG_MINDMAP_LAYOUTS__ exists (mm-mindmap §4)');
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.type(i % 2 ? 'a' : 'b');
    await sleep(50);
  }
  const ms = Date.now() - start;
  await sleep(400);
  const n1 = await layouts(page);
  const max = Math.ceil(ms / 150) + 1;
  assert.ok(n1 - n0 >= 1, 'the map is laid out again after typing');
  assert.ok(n1 - n0 <= max, `at most once per 150 ms: ${n1 - n0} layouts in ${ms} ms (max ${max})`);
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_mmp_02_ac7_switching_ten_times_writes_nothing', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  const files0 = { ...(await core.files()) };
  const ui0 = JSON.stringify(await core.uiState());
  for (let i = 0; i < 10; i++) {
    await click(listBtn(fig), 'List');
    assert.equal(await viewWhen(fig, 'list'), 'list', `switch ${i + 1}: List`);
    await click(mapBtn(fig), 'Map');
    assert.equal(await viewWhen(fig, 'map'), 'map', `switch ${i + 1}: Map`);
  }
  await sleep(1500);
  assert.deepEqual(await vaultWrites(core), [], 'no write call');
  assert.deepEqual(await core.files(), files0, 'no vault file changes');
  const ui1 = await core.uiState();
  assert.equal(JSON.stringify(ui1), ui0, 'ui-state.json unchanged');
  assert.ok(!/mindmap/i.test(JSON.stringify(ui1 ?? {})), 'no mindmap key in the UI state');
});

test('fr_mmp_02_ac7_per_block_view_survives_navigation_and_external_reload', async ({ page }) => {
  const core = await openMm(page, MM.slozene);
  const f2 = await needFigure(page, 'Rozbalená mapa');
  await click(listBtn(f2), 'Složené (2) List');
  assert.equal(await viewWhen(f2, 'list'), 'list', '(2) in List');
  const f1 = figure(page, 'Složená mapa');
  await must(f1, 'figure Složená mapa');
  assert.equal(await pressed(mapBtn(f1)), 'true', '(1) stays in Map');
  await openMm(page, MM.vyjezd);
  let fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'Výjezd in List');
  await click(fig.getByRole('link', { name: 'Lisabon' }).first(), 'chip Lisabon in the list');
  await mustBeOn(page, 'Lisabon', 'Lisabon opened');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Výjezd 2026', 'Back');
  fig = await needFigure(page, 'Výjezd 2026');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'still List after Back (AP-737)');
  const text = await fileText(core, MM.vyjezd);
  await core.setFile(MM.vyjezd, swap(text, 'Poznámka pod mapou.', 'Poznámka pod mapou, změněná jinde.'));
  await must(main(page).getByText('Poznámka pod mapou, změněná jinde.'), 'the external change is reloaded', 5000);
  assert.equal(await viewWhen(fig, 'list'), 'list', 'an external reload of another block keeps List');
});

test('fr_mmp_02_ac7_another_vault_and_back_opens_in_map', async ({ page }) => {
  const other = { ...mindmapVault(), name: 'Jiný' };
  const core = await openMm(page, MM.vyjezd, {
    vaultPath: '/fake/Mapy',
    recent: [{ path: '/fake/Mapy', name: 'Mapy', exists: true }, { path: '/fake/Jiný', name: 'Jiný', exists: true }],
    dirs: { '/fake/Jiný': other, '/fake/Mapy': mindmapVault() },
  });
  let fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'Výjezd in List');
  await page.keyboard.press('Control+Meta+2');
  await eventually(async () => (await callsOf(core, 'vault_open')).length, (n) => n >= 1, 3000);
  await sleep(500);
  await page.keyboard.press('Control+Meta+2');
  await eventually(async () => (await callsOf(core, 'vault_open')).length, (n) => n >= 2, 3000);
  assert.equal((await callsOf(core, 'vault_open')).length, 2, 'another vault opened, then this one again');
  await gotoNote(page, 'Výjezd 2026');
  fig = await needFigure(page, 'Výjezd 2026');
  assert.equal(await viewWhen(fig, 'map'), 'map', 'after a vault switch it opens in Map (D-776)');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_mmp_02_ac8_read_view_always_map_links_clickable', async ({ page }) => {
  // D-943: the steps run with Object preview Off; click mode follows (a click on a node chip previews).
  const core = await openMm(page, MM.neplatna, { ...setPreviewMode('off', { uiState: mmUi() }), readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  const fig = await needFigure(page, 'Jen ke čtení');
  await needTree(fig, 'Jen ke čtení');
  assert.equal(await viewGroup(fig).count(), 0, 'no Mindmap view group in the read view');
  assert.deepEqual(await treeNames(fig), ['Jen ke čtení', 'Výjezd 2026', 'Druhá větev'], 'the tree');
  const before = (await core.calls()).length;
  await click(node(fig, 'Druhá větev'), 'treeitem "Druhá větev"');
  await sleep(800);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[contenteditable="true"]') ? 'editable' : 'not'), 'not', 'nodes are not editable');
  assert.deepEqual((await core.calls()).slice(before).map((c) => c.cmd).filter((c) => c === 'note_write' || c === 'nav_opened'), [], 'a node click changes nothing');
  await mustBeOn(page, 'Neplatná mapa', 'no route change');
  await click(fig.getByRole('link', { name: 'Výjezd 2026' }).first(), 'chip "Výjezd 2026"');
  await mustBeOn(page, 'Výjezd 2026', 'the chip opens note/Pages/Výjezd 2026.md');

  // Click to preview (D-943): a click on the node chip previews; a double-click opens.
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Neplatná mapa', 'Back (before click mode)');
  await switchPreviewMode(page, core, 'click');
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  const fig2 = await needFigure(page, 'Jen ke čtení');
  await click(fig2.getByRole('link', { name: 'Výjezd 2026' }).first(), 'chip "Výjezd 2026" (click mode)');
  await mustPreview(page, 'Výjezd 2026', 'click mode: a click on the node chip previews the note');
  await mustBeOn(page, 'Neplatná mapa', 'click mode: no route change');
  await escPreview(page, 'click mode: the node chip preview');
  await (await must(fig2.getByRole('link', { name: 'Výjezd 2026' }), 'chip "Výjezd 2026" (double-click)')).dblclick();
  await mustBeOn(page, 'Výjezd 2026', 'click mode: a double-click on the chip opens note/Pages/Výjezd 2026.md');
  await mustNoPreview(page, 'click mode: after the double-click', 300);
});

test('fr_mmp_02_ac8_cmd_enter_on_a_focused_node_opens_its_link', async ({ page }) => {
  await openMm(page, MM.neplatna, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  const fig = await needFigure(page, 'Jen ke čtení');
  const n = await needNode(fig, 'Výjezd 2026');
  await n.focus();
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Výjezd 2026', '⌘↩ opens the node\'s link (AP-731)');
});

// ------------------------------------------------------------------------------------------------ AC-17

test('fr_mmp_02_ac17_folding_writes_nothing_and_keeps_the_markers', async ({ page }) => {
  const core = await openMm(page, MM.slozene);
  const f1 = await needFigure(page, 'Složená mapa');
  const exp = await must(foldBtn(f1, 'Složená mapa'), 'fold button of (1)');
  assert.equal(await exp.getAttribute('aria-label') ?? await exp.innerText(), 'Expand Složená mapa', '(1) starts collapsed');
  assert.ok(await seen(viewGroup(f1), 500), 'the header keeps the view switch');
  assert.equal(await tree(f1, 'Složená mapa').count(), 0, 'no tree while collapsed');
  assert.equal(await f1.locator('li:visible').count(), 0, 'no list while collapsed (the editable list is hidden, not removed)');
  await exp.click();
  await needTree(f1, 'Složená mapa');
  const f2 = await needFigure(page, 'Rozbalená mapa');
  assert.ok(await seen(f2.getByRole('button', { name: 'Collapse Rozbalená mapa', exact: true }), 1000), '(2) starts expanded');
  await click(f2.getByRole('button', { name: 'Collapse Rozbalená mapa', exact: true }), 'Collapse (2)');
  await click(f2.getByRole('button', { name: 'Expand Rozbalená mapa', exact: true }), 'Expand (2)');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'folding and unfolding write nothing');
  assert.equal(await fileText(core, MM.slozene), original(MM.slozene), '+ and - unchanged');
});
