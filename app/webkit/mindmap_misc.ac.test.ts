// Slice MM, L5 (WebKit, fake core): format, no-write, command, theme, string, template and rename checks of mindmaps
// (docs/acceptance/mindmap.md; contract docs/contracts/mm-mindmap.md §4). FR-FMT-05 AC-5 (Mermaid fences stay what
// they are), AC-6 (no network request while drawing every fixture mindmap), FR-FMT-07 AC-24 (b) (opening every note
// writes nothing; the Mermaid fence is the only source block), FR-SYN-06 AC-33 (a browsing tour sends zero writes),
// FR-UX-03 AC-15 (palette commands and a keyboard-only run), FR-UX-05 AC-10 (axe and colour leaks in both themes),
// NFR-OTH-02 AC-7 (pseudo-locale), FR-MMP-04 AC-1 (a Projekt from the template shows its mindmap), FR-LNK-03 AC-21
// (the open map shows the renamed link). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900.
// Written from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { createFromDraft, paletteDialog, pseudoLocale } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import {
  MM, NOTE_PATHS, TITLES, anyTree, blockMenu, calloutTypeItems, caretWhen, click, editorBody, emptyBtn, figure, figures, fileText, fileWhen,
  focusedWhen, foldBtn, gotoNote, listBtn, main, mapArea, mapBtn, must, mustBeOn, mustCaret, needFigure, needNode, needTree, node, noModified,
  openMm, original, paste, runCommand, seen, sirokaText, sleep, slashMenu, sourceBlocks, startMm, swap, titleField, treeItems,
  turnIntoItems, vaultWrites, viewWhen, watchNetwork, writes, mindmapVault,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Every mindmap block of R90 per note (figure names; null = `Mindmap`). */
const MAPS: [string, (string | null)[]][] = [
  [MM.vyjezd, ['Výjezd 2026']], [MM.uzly, ['Uzly']], [MM.nakup, [null]], [MM.postup, ['Postup']], [MM.vice, ['Témata']], [MM.bez, [null]],
  [MM.hola, [null]], [MM.slozene, ['Složená mapa', 'Rozbalená mapa']], [MM.rozpoznani, ['Navazující text', 'Prázdná položka', 'Velké písmeno', 'Prázdná']],
  [MM.obsidian, ['Z Obsidianu']], [MM.rozlozeni, ['Strom', 'Zalomení', 'Paleta']], [MM.rozbaleni, ['Titulek mapy', null]],
];

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-5

test('fr_fmt_05_ac5_mermaid_fences_show_as_code_in_the_read_view', async ({ page }) => {
  await openMm(page, MM.mermaid, { readView: true });
  const toFormatted = page.getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(toFormatted, 1500)) await toFormatted.click();
  await must(main(page).getByText('Před bloky.'), 'the read view of Mermaid', 5000);
  const codes = await main(page).locator('pre > code').allTextContents();
  assert.deepEqual(codes.map((c) => c.replace(/\n$/, '')), ['mindmap\n  root((Řeka))\n    Prameny\n    Přítoky', 'flowchart LR\n  A --> B'], 'both fences as pre > code, text exact');
  const labels = await main(page).locator('pre').evaluateAll((ps) => ps.map((p) => (p.closest('figure, div, section') ?? p).textContent ?? ''));
  assert.ok(labels.every((l) => l.includes('mermaid')), 'each with the label mermaid');
  assert.equal(await anyTree(main(page)).count(), 0, 'no tree');
  assert.equal(await figures(page).count(), 0, 'no mindmap figure');
  assert.equal(await main(page).getByRole('figure', { name: /^Mindmap/ }).count(), 0, 'no figure named Mindmap…');
  assert.equal(await main(page).locator('[data-placeholder="mindmap"]').count(), 0, 'no R5 mindmap placeholder (D-679)');
});

test('fr_fmt_05_ac5_mermaid_mindmap_fence_is_a_read_only_source_block_in_the_editor', async ({ page }) => {
  const core = await openMm(page, MM.mermaid);
  const groups = sourceBlocks(page);
  assert.equal(await groups.count(), 1, 'the `mindmap` fence is one source block');
  assert.ok((await groups.first().innerText()).includes('root((Řeka))'), 'with its text');
  assert.equal(await main(page).locator('[data-placeholder="mindmap"]').count(), 0, 'no placeholder');
  await groups.first().click();
  await page.keyboard.type('xyz');
  await paste(page, { plain: 'vloženo' });
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'typing and paste in it change nothing');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Před bloky.' }), 'Před bloky.', 'first paragraph');
  await page.keyboard.type(' A');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Za bloky.' }), 'Za bloky.', 'last paragraph');
  await page.keyboard.type(' B');
  const want = swap(swap(original(MM.mermaid), 'Před bloky.', 'Před bloky. A'), 'Za bloky.', 'Za bloky. B');
  const t = await fileWhen(core, MM.mermaid, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'both fences byte-identical after editing the paragraphs');
});

test('fr_fmt_05_ac5_pasting_the_mermaid_fence_makes_a_source_block', async ({ page }) => {
  await openMm(page, MM.prazdna);
  await editorBody(page).click();
  await paste(page, { plain: '```mermaid\nmindmap\n  root((Řeka))\n    Prameny\n```' });
  await must(sourceBlocks(page), 'a read-only source block');
  assert.equal(await figures(page).count(), 0, 'not a mindmap');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-6 (L5)

test('fr_fmt_05_ac6_drawing_every_fixture_mindmap_makes_no_network_request', async ({ page }) => {
  const hits = watchNetwork(page);
  const missing: string[] = [];
  for (const [path, titles] of MAPS) {
    await openMm(page, path);
    for (const t of titles) {
      const f = figure(page, t);
      if (!(await seen(f, 3000))) { missing.push(`${path}: ${t ?? 'Mindmap'}`); continue; }
      const drawn = (await anyTree(f).count()) + (await emptyBtn(f).count()) + (await foldBtn(f, t ?? '').count());
      if (drawn === 0) missing.push(`${path}: ${t ?? 'Mindmap'} not drawn`);
    }
  }
  assert.deepEqual(missing, [], 'every fixture mindmap is drawn');
  assert.deepEqual(hits, [], 'no request to a non-local host (NFR-SEC-01)');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-24 (b)

test('fr_fmt_07_ac24_b_opening_every_note_writes_nothing_and_only_the_fence_is_a_source_block', async ({ page }) => {
  const core = await startMm(page, { at: MM.lisabon });
  await mustBeOn(page, 'Lisabon', 'start');
  const sources: Record<string, number> = {};
  for (const path of NOTE_PATHS) {
    if (path === MM.neplatna) continue; // opens read-only (NFR-REL-03)
    await gotoNote(page, TITLES[path]);
    await must(editorBody(page), `the editor on ${path}`, 5000);
    await sleep(300);
    sources[path] = await sourceBlocks(page).count();
  }
  await sleep(1500);
  assert.deepEqual(await vaultWrites(core), [], 'zero note_write');
  const nonzero = Object.fromEntries(Object.entries(sources).filter(([, n]) => n > 0));
  assert.deepEqual(nonzero, { [MM.mermaid]: 1 }, 'the Mermaid `mindmap` fence is the only source block (no mindmap of R90 is one)');
  await gotoNote(page, 'Výjezd 2026');
  assert.ok(await seen(figure(page, 'Výjezd 2026'), 3000), 'the mindmap blocks are drawn (figure "Mindmap: Výjezd 2026")');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-33 (L5)

test('fr_syn_06_ac33_browsing_tour_sends_zero_writes', async ({ page }) => {
  test.setTimeout(180_000);
  const vault = mindmapVault((f) => { f['Pages/Široká mapa.md'] = sirokaText(); });
  const core = await startMm(page, { vault, at: MM.vyjezd });
  await mustBeOn(page, 'Výjezd 2026', 'start');
  for (const [path, titles] of [...MAPS, ['Pages/Široká mapa.md', ['Široká']] as [string, string[]]]) {
    await gotoNote(page, path === 'Pages/Široká mapa.md' ? 'Široká mapa' : TITLES[path]);
    for (const t of titles) {
      const f = await needFigure(page, t);
      if (await seen(f.getByRole('button', { name: `Expand ${t}`, exact: true }), 300)) {
        await f.getByRole('button', { name: `Expand ${t}`, exact: true }).click();
        await click(f.getByRole('button', { name: `Collapse ${t}`, exact: true }), `collapse ${t}`);
        await click(f.getByRole('button', { name: `Expand ${t}`, exact: true }), `expand ${t}`);
      }
      await click(listBtn(f), `${t}: List`);
      await click(mapBtn(f), `${t}: Map`);
      const items = f.getByRole('treeitem');
      if ((await items.count()) > 0) {
        await items.first().focus();
        for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Home');
        await items.nth(Math.min(1, (await items.count()) - 1)).click();
        await click(mapBtn(f), `${t}: back to Map`);
      }
      if (t === 'Široká') await mapArea(f).first().evaluate((a) => { a.scrollLeft = 2000; });
    }
  }
  await gotoNote(page, 'Výjezd 2026');
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'caret');
  await page.keyboard.press('Meta+/');
  await must(blockMenu(page), 'block menu');
  await page.keyboard.press('Escape');
  await turnIntoItems(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await calloutTypeItems(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await click(mapBtn(fig), 'Map');
  await click(node(fig, 'Lisabon').getByRole('link').first(), 'follow Lisabon');
  await mustBeOn(page, 'Lisabon', 'Lisabon');
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Výjezd 2026', 'Back');
  await gotoNote(page, 'Vložení');
  await sleep(1500);
  assert.deepEqual(await vaultWrites(core), [], 'zero write calls');
  assert.ok(!/mindmap/i.test(JSON.stringify((await core.uiState()) ?? {})), 'no mindmap key in the UI state');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-15

test('fr_ux_03_ac15_palette_commands_switch_the_block_with_the_caret', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  assert.equal(await mapBtn(fig).getAttribute('data-command'), 'mindmap.showMap', 'Map carries mindmap.showMap (FR-UX-03 AC-8)');
  assert.equal(await listBtn(fig).getAttribute('data-command'), 'mindmap.showList', 'List carries mindmap.showList');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Show mindmap');
  const opts = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  assert.ok(opts.includes('Show mindmap as map') && opts.includes('Show mindmap as list'), `the palette lists both: ${opts.join(', ')}`);
  await page.keyboard.press('Escape');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'caret in the block');
  await runCommand(page, 'Show mindmap as map');
  assert.equal(await viewWhen(fig, 'map'), 'map', 'Show mindmap as map switches it');
  const f = await focusedWhen(page, (x) => x.role === 'treeitem');
  assert.equal(f.role, 'treeitem', 'the focus moves to the tree');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Plán výjezdu' }), 'Plán', 'caret outside the mindmap');
  await runCommand(page, 'Show mindmap as list');
  await sleep(500);
  assert.equal(await viewWhen(fig, 'map', 300), 'map', 'outside any mindmap: not run');
  assert.equal(await page.getByRole('alert').count(), 0, 'outside any mindmap: no error');
});

test('fr_ux_03_ac15_show_as_list_puts_the_caret_at_the_end_of_the_root_item', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await (await needNode(fig, 'Program')).focus();
  await runCommand(page, 'Show mindmap as list');
  assert.equal(await viewWhen(fig, 'list'), 'list', 'List');
  const c = await caretWhen(page, (x) => x.text === 'Výjezd 2026' && x.atEnd);
  assert.deepEqual([c.text, c.atEnd], ['Výjezd 2026', true], 'the caret at the end of the root item');
});

test('fr_ux_03_ac15_keyboard_only_run', async ({ page }) => {
  const core = await openMm(page, MM.prazdna);
  await page.evaluate(() => {
    (window as any).__pointer = 0;
    for (const t of ['pointerdown', 'mousedown', 'click']) window.addEventListener(t, (e) => { if ((e as MouseEvent).isTrusted) (window as any).__pointer++; }, true);
  });
  await (await must(titleField(page), 'Title')).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.type('/mindmap');
  await must(slashMenu(page), 'slash menu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Kořen');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Větev');
  await runCommand(page, 'Show mindmap as map');
  const fig = await needFigure(page, null);
  assert.equal(await viewWhen(fig, 'map'), 'map', 'Map from the palette');
  await focusedWhen(page, (x) => x.role === 'treeitem');
  await page.keyboard.press('ArrowDown');
  assert.equal((await focusedWhen(page, (x) => x.name === 'Větev')).name, 'Větev', '↓ to Větev');
  await page.keyboard.press('Enter');
  assert.equal(await viewWhen(fig, 'list'), 'list', '⏎ returns to List');
  const want = original(MM.prazdna) + '> [!mindmap]\n> - Kořen\n>   - Větev\n';
  const t = await fileWhen(core, MM.prazdna, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'the saved block');
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer events');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-10 (L5)

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac10_axe_and_no_colour_leaks_${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    const bad: string[] = [];
    const check = async (what: string) => {
      for (const v of await axeContrast(page)) bad.push(`${what}: contrast ${v}`);
      for (const v of await colourLeaks(page, theme)) bad.push(`${what}: leak ${v}`);
    };
    await openMm(page, MM.vyjezd, { theme });
    const fig = await needFigure(page, 'Výjezd 2026');
    await needTree(fig, 'Výjezd 2026');
    await check('Výjezd Map');
    await click(listBtn(fig), 'List');
    await check('Výjezd List');
    for (const [path, t] of [[MM.uzly, 'Uzly'], [MM.nakup, null], [MM.rozlozeni, 'Paleta'], [MM.rozpoznani, 'Prázdná']] as [string, string | null][]) {
      await openMm(page, path, { theme });
      await needFigure(page, t);
      await check(path);
    }
    assert.deepEqual(bad, [], `axe color-contrast and FR-UX-05 AC-5 in ${theme}`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-7 (L5)

test('nfr_oth_02_ac7_pseudo_locale_wraps_every_mindmap_text', async ({ page }) => {
  await openMm(page, MM.vyjezd, { prelude: pseudoLocale });
  const fig = main(page).getByRole('figure', { name: '⟦Mindmap: Výjezd 2026⟧', exact: true });
  await must(fig, 'figure "⟦Mindmap: Výjezd 2026⟧"', 5000);
  await must(fig.getByRole('group', { name: '⟦Mindmap view⟧', exact: true }), 'group ⟦Mindmap view⟧');
  await must(fig.getByRole('button', { name: '⟦Map⟧', exact: true }), 'button ⟦Map⟧');
  await must(fig.getByRole('button', { name: '⟦List⟧', exact: true }), 'button ⟦List⟧');
  await must(fig.getByRole('tree', { name: '⟦Map of Výjezd 2026⟧', exact: true }), 'tree ⟦Map of Výjezd 2026⟧');
  const user = new Set(['Výjezd 2026', 'Program', 'Přehled Q4', 'Plán 2027', 'Místo', 'Lisabon', 'Doprava']);
  const texts = await fig.evaluate((f) => {
    const out: string[] = [];
    const w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement!;
      if (el.closest('[aria-hidden="true"]') || el.getClientRects().length === 0) continue;
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t.normalize('NFC'));
    }
    return out;
  });
  const bare = texts.filter((t) => !user.has(t) && !/^⟦.*⟧$/s.test(t));
  assert.deepEqual(bare, [], 'every visible text of the block is user content or wrapped');
  await openMm(page, MM.rozpoznani, { prelude: pseudoLocale });
  await must(main(page).getByText('⟦A mindmap holds one list⟧').first(), 'the hint wrapped', 5000);
  await must(main(page).getByRole('button', { name: '⟦Type the central topic⟧', exact: true }), 'the empty-state button wrapped');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: /Command query/ }).fill('mindmap');
  const opts = await page.getByRole('listbox', { name: /Commands/ }).getByRole('option').allInnerTexts();
  assert.ok(opts.some((o) => o.includes('⟦Show mindmap as map⟧')) && opts.some((o) => o.includes('⟦Show mindmap as list⟧')), `commands wrapped: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
  await openMm(page, MM.prazdna, { prelude: pseudoLocale });
  await editorBody(page).click();
  await page.keyboard.type('/mind');
  const row = slashMenu(page).getByRole('option').first();
  await must(row, 'slash row');
  const rowText = await row.innerText();
  assert.ok(rowText.includes('⟦Mindmap⟧') && rowText.includes('⟦Edit as a list, shown as a map⟧'), `slash row and description wrapped: ${rowText}`);
});

// ------------------------------------------------------------------------------------------------ FR-MMP-04 AC-1 (L5)

test('fr_mmp_04_ac1_a_projekt_from_the_template_shows_its_mindmap', async ({ page }) => {
  const core = await startMm(page, { route: 'type/projekt' });
  await mustBeOn(page, 'Projekty', 'type/projekt', 5000);
  await click(main(page).getByRole('button', { name: 'New Projekt', exact: true }), 'New Projekt');
  await createFromDraft(page, 'Nový projekt', 'Projekt draft');
  const t = await fileWhen(core, 'Projekty/Nový projekt.md', (x) => !!x, 4000);
  const body = (t ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.equal(body, original(MM.sablona), 'the body equals the template\'s bytes');
  const fig = await needFigure(page, 'Cíle projektu');
  assert.equal(await viewWhen(fig, 'map'), 'map', 'in Map');
  assert.deepEqual((await treeItems(fig)).map((i) => i.name), ['Cíle projektu', 'Proč', 'Co', 'Kdy'], 'root and three children');
  assert.equal(await fileText(core, MM.sablona), original(MM.sablona), 'the template untouched');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-21 (L5)

test('fr_lnk_03_ac21_renamed_link_shows_in_the_map', async ({ page }) => {
  const core = await openMm(page, MM.lisabon);
  const t = await must(titleField(page), 'Title', 5000);
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Lisabon 2027');
  await page.keyboard.press('Enter');
  const v = await fileWhen(core, MM.vyjezd, (x) => !!x && x.includes('[[Lisabon 2027]]'), 5000);
  assert.ok(v?.includes('>     - [[Lisabon 2027]]\n'), 'Výjezd\'s line rewritten');
  const u = await fileWhen(core, MM.uzly, (x) => !!x && x.includes('[[Lisabon 2027]]'), 5000);
  assert.ok(u?.includes('>   - Odkaz na [[Lisabon 2027]] a #cestování\n'), 'Uzly\'s line rewritten');
  assert.equal(await fileText(core, MM.stara), original(MM.stara), 'Stará mapa untouched');
  await gotoNote(page, 'Výjezd 2026');
  const fig = await needFigure(page, 'Výjezd 2026');
  const start = Date.now();
  await must(node(fig, 'Lisabon 2027'), 'the node shows Lisabon 2027', 2000);
  assert.ok(Date.now() - start <= 2000, 'within 2 s (D-386)');
});

