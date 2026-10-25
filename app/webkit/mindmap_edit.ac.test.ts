// Slice MM, L5 (WebKit, fake core): inserting, converting and editing mindmaps (docs/acceptance/mindmap.md R93, R94;
// contract docs/contracts/mm-mindmap.md §3, §4). FR-MMP-01 AC-1 (`/mindmap`, W1…W1b), AC-2 (W2, W3), AC-3 (W4, W5),
// AC-4 (W6…W8a), AC-5 (`Callout type` has 14 entries, W10), AC-6 (W2 and W6 undo), AC-7 (where `Mindmap` is offered),
// AC-9 (the title, W9…W9d); FR-MMP-02 AC-18 (what an edit rewrites), AC-19 (block → object inside a mindmap),
// AC-20 (paste), AC-22 (editing keeps one list). Test clock 2026-10-22T10:00 Europe/Prague, region cs, 1440 × 900.
// Written from the ACs and the contract only (D-61); every missing element fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { E, editorVault, openEditor, caretIn as caretInBlock } from './editor-helpers';
import {
  MM, blockMenu, calloutTypeItem, calloutTypeItems, caretAt, caretWhen, click, copy, description, editorBody, eventually, figure, figures,
  fileText, fileWhen, isDisabled, listBtn, main, mapBtn, mindmapVault, must, mustBeSaved, mustCaret, namesWhen, needFigure, needTree, node,
  noModified, openMm, original, paste, pressed, seen, sleep, slashMenu, swap, toolbar, treeNames, turnInto, turnIntoItem, turnIntoItems,
  viewOf, viewWhen, writes, type FakeCoreHandle,
} from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const W2 = ['* Kořen\n    * Větev s odsazením čtyř mezer\n* Druhý', '> [!mindmap]\n> * Kořen\n>     * Větev s odsazením čtyř mezer\n> * Druhý'];
const W6 = ['> [!mindmap] Titulek mapy\n> * Kořen\n>     * Větev', 'Titulek mapy\n\n* Kořen\n    * Větev'];

/** Waits until the file holds `want` (modified aside) and the save state reads Saved; returns the text. */
async function savedAs(page: Page, core: FakeCoreHandle, path: string, want: string, ms = 4000): Promise<string | undefined> {
  const t = await fileWhen(core, path, (x) => noModified(x) === noModified(want), ms);
  await mustBeSaved(page, 2000).catch(() => {});
  return t;
}
const p = (page: Page, text: string) => editorBody(page).locator('p, li, h2').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).last();

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-1

test('fr_mmp_01_ac1_slash_mindmap_inserts_a_list_view_block', async ({ page }) => {
  const core = await openMm(page, MM.prazdna);
  await editorBody(page).click();
  await page.keyboard.type('/mind');
  const menu = await must(slashMenu(page), 'listbox "Insert block"');
  const first = menu.getByRole('option').first();
  assert.equal((await first.innerText()).split('\n')[0].trim(), 'Mindmap', '`/mind` lists Mindmap first');
  assert.ok((await first.innerText()).includes('Edit as a list, shown as a map'), 'with the description as its second line');
  assert.equal(await description(first), 'Edit as a list, shown as a map', 'and as aria-description');
  await page.keyboard.press('Enter');
  const fig = await needFigure(page, null);
  assert.equal(await pressed(listBtn(fig)), 'true', 'List pressed');
  const c = await caretWhen(page, (x) => x.inBody && x.text === '');
  assert.deepEqual([c.inBody, c.text], [true, ''], 'the caret in its single empty item');
  assert.ok(await seen(fig.getByText('Type the central topic').first(), 1000), 'the empty item shows "Type the central topic"');
  const orig = original(MM.prazdna);
  await savedAs(page, core, MM.prazdna, orig + '> [!mindmap]\n');
  assert.equal(noModified(await fileText(core, MM.prazdna)), noModified(orig + '> [!mindmap]\n'), 'W1');
  await page.keyboard.type('Výlet do Brna');
  assert.equal(noModified(await savedAs(page, core, MM.prazdna, orig + '> [!mindmap]\n> - Výlet do Brna\n')), noModified(orig + '> [!mindmap]\n> - Výlet do Brna\n'), 'W1a');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Doprava');
  const w1b = orig + '> [!mindmap]\n> - Výlet do Brna\n>   - Doprava\n';
  assert.equal(noModified(await savedAs(page, core, MM.prazdna, w1b)), noModified(w1b), 'W1b');
  const names = await namesWhen(fig, (n) => n.join() === 'Výlet do Brna,Doprava', 1000);
  assert.deepEqual(names, ['Výlet do Brna', 'Doprava'], 'the map below the list shows Výlet do Brna › Doprava');
});

test('fr_mmp_01_ac1_slash_mindmap_after_text_goes_after_the_paragraph', async ({ page }) => {
  const core = await openMm(page, MM.prazdna);
  await editorBody(page).click();
  await page.keyboard.type('Text /mindmap');
  await must(slashMenu(page), 'listbox "Insert block"');
  await page.keyboard.press('Enter');
  await needFigure(page, null);
  const want = original(MM.prazdna) + 'Text\n\n> [!mindmap]\n';
  assert.equal(noModified(await savedAs(page, core, MM.prazdna, want)), noModified(want), '`/mindmap` removed, the block after the paragraph');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-2, AC-3

test('fr_mmp_01_ac2_turn_into_mindmap_wraps_lists_w2_w3', async ({ page }) => {
  for (const [after, before, wrapped, kids] of [
    ['Druhý', W2[0], W2[1], ['Převody', 'Kořen', 'Větev s odsazením čtyř mezer', 'Druhý']],
    ['Druhý krok', '1) První krok\n2) Druhý krok', '> [!mindmap]\n> 1) První krok\n> 2) Druhý krok', ['Převody', 'První krok', 'Druhý krok']],
  ] as const) {
    const core = await openMm(page, MM.prevody);
    await mustCaret(p(page, after), after, `end of ${after}`);
    await turnInto(page, 'Mindmap');
    const want = swap(original(MM.prevody), before, wrapped);
    assert.equal(noModified(await savedAs(page, core, MM.prevody, want)), noModified(want), `${after}: wrapped, every other byte unchanged`);
    const fig = await needFigure(page, null);
    assert.deepEqual(await namesWhen(fig, (n) => n.length === kids.length), [...kids], 'the map: synthesized root Převody and the items');
  }
});

test('fr_mmp_01_ac3_turn_into_mindmap_on_text_blocks_w4_w5', async ({ page }) => {
  let core = await openMm(page, MM.prevody);
  await mustCaret(p(page, 'Úvodní odstavec.'), 'Úvodní', 'in block 1');
  await turnInto(page, 'Mindmap');
  let want = swap(original(MM.prevody), 'Úvodní odstavec.', '> [!mindmap]\n> - Úvodní odstavec.');
  assert.equal(noModified(await savedAs(page, core, MM.prevody, want)), noModified(want), 'W4');
  assert.deepEqual(await treeNames(await needFigure(page, null)), ['Úvodní odstavec.'], 'root Úvodní odstavec.');
  core = await openMm(page, MM.prevody);
  await mustCaret(p(page, 'Nadpis jedna'), 'Nadpis', 'in block 4');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await turnInto(page, 'Mindmap');
  want = swap(original(MM.prevody), '## Nadpis jedna\n\nOdstavec dva.\n\nOdstavec tři.', '> [!mindmap]\n> - Nadpis jedna\n> - Odstavec dva.\n> - Odstavec tři.');
  assert.equal(noModified(await savedAs(page, core, MM.prevody, want)), noModified(want), 'W5: one block between the original gaps');
  assert.deepEqual(await treeNames(await needFigure(page, null)), ['Převody', 'Nadpis jedna', 'Odstavec dva.', 'Odstavec tři.'], 'root Převody, three children');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-4

test('fr_mmp_01_ac4_unwrapping_w6_w7_w8_w8a', async ({ page }) => {
  const b2 = '> [!mindmap]\n> 1. Jedna\n> 2. Dvě';
  const cases: [string, string | null, 'turn' | 'type', string, string, string][] = [
    ['W6', 'Titulek mapy', 'turn', 'Bulleted list', W6[0], W6[1]],
    ['W7', 'Titulek mapy', 'type', 'note', W6[0], '> [!note] Titulek mapy\n> * Kořen\n>     * Větev'],
    ['W8', null, 'turn', 'Numbered list', b2, '1. Jedna\n2. Dvě'],
    ['W8a', null, 'turn', 'Bulleted list', b2, '- Jedna\n- Dvě'],
  ];
  for (const [w, title, how, item, before, after] of cases) {
    const core = await openMm(page, MM.rozbaleni);
    const fig = await needFigure(page, title);
    await click(listBtn(fig), `${w}: List`);
    await mustCaret(fig.locator('li').filter({ hasText: title ? 'Kořen' : 'Jedna' }).first(), title ? 'Kořen' : 'Jedna', `${w}: caret in the list`);
    if (how === 'turn') await turnInto(page, item);
    else {
      await calloutTypeItems(page);
      await click(calloutTypeItem(page, item), `Callout type › ${item}`);
    }
    const want = swap(original(MM.rozbaleni), before, after);
    const t = await savedAs(page, core, MM.rozbaleni, want);
    assert.equal(noModified(t), noModified(want), `${w}`);
    for (const s of title ? ['Titulek mapy', 'Kořen', 'Větev'] : ['Jedna', 'Dvě']) assert.ok(t?.includes(s), `${w}: no text lost (${s})`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-5

test('fr_mmp_01_ac5_callout_type_has_14_entries_and_mindmap_is_checked', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: 'Doprava' }).last(), 'Doprava', 'caret in the mindmap');
  const items = await calloutTypeItems(page);
  assert.equal(items.length, 14, `14 entries: ${items.join(', ')}`);
  assert.match(items[13] ?? '', /^Mindmap( \(mindmap\))?$/, 'Mindmap (mindmap) last');
  const mm = calloutTypeItem(page, 'Mindmap');
  assert.equal(await mm.first().getAttribute('aria-checked'), 'true', 'Mindmap is the checked entry');
  await mm.first().click();
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'choosing Mindmap on Výjezd writes nothing');
});

test('fr_mmp_01_ac5_callout_type_mindmap_on_a_tip_callout_w10', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = editorVault().files[E.deset];
  await caretInBlock(page, 9, 'Obsah');
  const items = await calloutTypeItems(page);
  assert.equal(items.length, 14, `14 entries: ${items.join(', ')}`);
  await click(calloutTypeItem(page, 'Mindmap'), 'Callout type › Mindmap');
  const want = swap(orig, '> [!tip]+ Tip', '> [!mindmap]+ Tip');
  const t = await fileWhen(core, E.deset, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'W10: only the type changes');
  const hint = main(page).getByRole('note').filter({ hasText: 'A mindmap holds one list' });
  assert.ok(await seen(hint, 2000), 'a hint callout (its body is a paragraph)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-6 (L5)

test('fr_mmp_01_ac6_w2_and_w6_undo_and_redo', async ({ page }) => {
  let core = await openMm(page, MM.prevody);
  await mustCaret(p(page, 'Druhý'), 'Druhý', 'end of Druhý');
  await turnInto(page, 'Mindmap');
  const w2 = swap(original(MM.prevody), W2[0], W2[1]);
  await savedAs(page, core, MM.prevody, w2);
  const fig = await needFigure(page, null);
  await click(listBtn(fig), 'List');
  await click(mapBtn(fig), 'Map');
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Úvodní odstavec.' }), 'Úvodní', 'caret in the body');
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(page, core, MM.prevody, original(MM.prevody))), noModified(original(MM.prevody)), '⌘Z after W2 (and List, Map) gives the original body');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noModified(await savedAs(page, core, MM.prevody, w2)), noModified(w2), '⇧⌘Z re-applies W2');
  core = await openMm(page, MM.rozbaleni);
  const f6 = await needFigure(page, 'Titulek mapy');
  await click(listBtn(f6), 'List');
  await mustCaret(f6.locator('li').filter({ hasText: 'Kořen' }).first(), 'Kořen', 'caret in Kořen');
  await turnInto(page, 'Bulleted list');
  const w6 = swap(original(MM.rozbaleni), W6[0], W6[1]);
  await savedAs(page, core, MM.rozbaleni, w6);
  await page.keyboard.press('Meta+z');
  assert.equal(noModified(await savedAs(page, core, MM.rozbaleni, original(MM.rozbaleni))), noModified(original(MM.rozbaleni)), '⌘Z after W6');
  await page.keyboard.press('Meta+Shift+z');
  assert.equal(noModified(await savedAs(page, core, MM.rozbaleni, w6)), noModified(w6), '⇧⌘Z re-applies W6');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-7

test('fr_mmp_01_ac7_turn_into_lists_mindmap_where_offered', async ({ page }) => {
  const bad: string[] = [];
  const at: [string, boolean][] = [
    ['Úvodní odstavec.', true], ['Druhý', true], ['Druhý krok', true], ['Nadpis jedna', true], ['Odstavec dva.', true], ['Odstavec tři.', true],
    ['Obyčejná citace.', false], ['kód', false],
  ];
  for (const [text, listed] of at) {
    await openMm(page, MM.prevody);
    await mustCaret(text === 'kód' ? editorBody(page).locator('pre, code').filter({ hasText: 'kód' }).last() : p(page, text), text, `caret in "${text}"`);
    const items = await turnIntoItems(page);
    const i = items.indexOf('Mindmap');
    if (listed && (i < 0 || items[i - 1] !== 'Checklist')) bad.push(`${text}: Mindmap after Checklist expected: ${items.join(', ')}`);
    if (!listed && i >= 0) bad.push(`${text}: Mindmap listed`);
  }
  assert.deepEqual(bad, [], 'Turn into › Mindmap after Checklist for blocks 1–6 only');
  await openMm(page, MM.prevody);
  await mustCaret(p(page, 'Nadpis jedna'), 'Nadpis', 'block 4');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  assert.ok((await turnIntoItems(page)).includes('Mindmap'), 'selection 4–6: listed');
  assert.equal(await isDisabled(turnIntoItem(page, 'Mindmap')), false, 'selection 4–6: enabled');
  for (const [first, what] of [['Druhý', 'selection 2–3 (two lists)'], ['Úvodní odstavec.', 'selection 1–2 (paragraph and list)']] as const) {
    await openMm(page, MM.prevody);
    await mustCaret(p(page, first), first, what);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+ArrowDown');
    await turnIntoItems(page);
    await must(turnIntoItem(page, 'Mindmap'), `${what}: Mindmap shown`);
    assert.equal(await isDisabled(turnIntoItem(page, 'Mindmap')), true, `${what}: aria-disabled`);
  }
  await openMm(page, MM.rozpoznani);
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Jen text' }), 'Jen text', 'caret in a callout');
  assert.ok(!(await turnIntoItems(page)).includes('Mindmap'), 'a callout uses Callout type');
  await openMm(page, MM.vlozeni);
  await mustCaret(editorBody(page).locator('p').filter({ hasText: 'Vložená' }), null, 'end of the paragraph');
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  const embedItems = await turnIntoItems(page).catch(() => [] as string[]);
  assert.ok(!embedItems.includes('Mindmap'), 'not listed for an embed');
});

test('fr_mmp_01_ac7_slash_mindmap_inside_containers_goes_after_the_top_level_block', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/mindmap');
  await must(slashMenu(page), 'slash menu in an item');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => figures(page).count(), (n) => n === 2, 2000), 2, 'a new mindmap block');
  const order = await main(page).evaluate((m) => [...m.querySelectorAll('[data-mindmap]')].map((f) => f.getAttribute('aria-label')));
  assert.deepEqual(order, ['Mindmap: Výjezd 2026', 'Mindmap'], 'after Výjezd\'s mindmap block');
  const c = await caretWhen(page, (x) => x.inBody && x.text === '');
  assert.ok(c.inBody && c.text === '', 'the caret in its item');
  void core;
  const c2 = await openMm(page, MM.prevody);
  await mustCaret(p(page, 'Obyčejná citace.'), 'Obyčejná citace.', 'end of the quote');
  await page.keyboard.type(' /mindmap');
  await must(slashMenu(page), 'slash menu in a quote');
  await page.keyboard.press('Enter');
  const want = swap(original(MM.prevody), '> Obyčejná citace.', '> Obyčejná citace.\n\n> [!mindmap]');
  const t = await fileWhen(c2, MM.prevody, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'in a quote: after the quote');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-9

test('fr_mmp_01_ac9_title_editable_in_list_read_only_in_map', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await caretAt(fig, 'Výjezd 2026');
  await page.keyboard.type('X');
  await sleep(1200);
  assert.deepEqual(await writes(core), [], 'in Map the title is read-only');
  await click(listBtn(fig), 'List');
  await mustCaret(fig, 'Výjezd 2026', 'end of the header title');
  await page.keyboard.type(' – plán');
  const want = swap(original(MM.vyjezd), '> [!mindmap] Výjezd 2026\n', '> [!mindmap] Výjezd 2026 – plán\n');
  assert.equal(noModified(await savedAs(page, core, MM.vyjezd, want)), noModified(want), 'W9');
  await page.keyboard.press('Enter');
  const c = await caretWhen(page, (x) => x.text === 'Výjezd 2026' && x.inBody);
  assert.equal(c.text, 'Výjezd 2026', '⏎ moves the caret to the first item');
});

test('fr_mmp_01_ac9_title_bytes_and_the_synthesized_root_w9a_to_w9d', async ({ page }) => {
  let core = await openMm(page, MM.bez);
  let fig = await needFigure(page, null);
  await click(listBtn(fig), 'List');
  const title = fig.getByText('Mindmap', { exact: true }).first();
  await must(title, 'the empty title shows Mindmap');
  await title.click();
  await page.keyboard.type('Roční období');
  const t0 = Date.now();
  const names = await namesWhen(figure(page, 'Roční období'), (n) => n[0] === 'Roční období', 500);
  assert.equal(names[0], 'Roční období', `the root redraws within 500 ms (${Date.now() - t0} ms)`);
  let want = swap(original(MM.bez), '> [!mindmap]\n', '> [!mindmap] Roční období\n');
  assert.equal(noModified(await savedAs(page, core, MM.bez, want)), noModified(want), 'W9a');
  for (let i = 0; i < 'Roční období'.length; i++) await page.keyboard.press('Backspace');
  assert.equal(noModified(await savedAs(page, core, MM.bez, original(MM.bez))), noModified(original(MM.bez)), 'W9b: `> [!mindmap]`, no trailing space');
  fig = await needFigure(page, null);
  assert.equal((await namesWhen(fig, (n) => n[0] === 'Bez titulku', 500))[0], 'Bez titulku', 'the root is the note title again');
  core = await openMm(page, MM.slozene);
  fig = await needFigure(page, 'Složená mapa');
  await click(fig.getByRole('button', { name: 'Expand Složená mapa', exact: true }), 'expand (1)');
  await click(listBtn(fig), 'List');
  await mustCaret(fig, 'Složená mapa', 'end of the title');
  for (let i = 0; i < 'Složená mapa'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('Nová');
  want = swap(original(MM.slozene), '> [!mindmap]- Složená mapa\n', '> [!mindmap]- Nová\n');
  assert.equal(noModified(await savedAs(page, core, MM.slozene, want)), noModified(want), 'W9c: the fold marker kept');
  core = await openMm(page, MM.rozpoznani);
  fig = await needFigure(page, 'Velké písmeno');
  await click(listBtn(fig), 'List');
  await mustCaret(fig, 'Velké písmeno', 'end of the title');
  await page.keyboard.type(' B');
  want = swap(original(MM.rozpoznani), '> [!Mindmap] Velké písmeno\n', '> [!Mindmap] Velké písmeno B\n');
  assert.equal(noModified(await savedAs(page, core, MM.rozpoznani, want)), noModified(want), 'W9d: the type spelling kept');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-18

test('fr_mmp_02_ac18_a_w11_changes_only_line_6', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Přehled Q4$/ }).last(), 'Přehled Q4', 'end of Přehled Q4');
  await page.keyboard.type(' 2026');
  const want = swap(original(MM.vyjezd), '>     - Přehled Q4\n', '>     - Přehled Q4 2026\n');
  const t = await savedAs(page, core, MM.vyjezd, want);
  assert.equal(noModified(t), noModified(want), 'W11');
  const body = (x: string) => x.slice(x.indexOf('\n---\n') + 5).split('\n');
  const changed = body(t ?? '').map((l, i) => (l === body(original(MM.vyjezd))[i] ? 0 : i + 1)).filter(Boolean);
  assert.deepEqual(changed, [6], 'only body line 6');
});

test('fr_mmp_02_ac18_b_obsidian_tabs_rewrite_only_the_callout', async ({ page }) => {
  const core = await openMm(page, MM.obsidian);
  const fig = await needFigure(page, 'Z Obsidianu');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^List$/ }).last(), 'List', 'end of List');
  await page.keyboard.type(' nový');
  const t = await fileWhen(core, MM.obsidian, (x) => !!x && x.includes('List nový'), 4000);
  const orig = original(MM.obsidian);
  const head = orig.slice(0, orig.indexOf('> [!mindmap]'));
  assert.equal(noModified((t ?? '').slice(0, head.length)), noModified(head), 'bytes before the callout unchanged (but modified)');
  const { mindmapTree, parse } = await import('@tegg/doc');
  const raw = parse(t ?? '').blocks[0]?.raw ?? '';
  const tree = mindmapTree(raw, 'Z Obsidianu');
  const flat = (it: any[], l = 1): string[] => it.flatMap((i) => [`${l}:${i.inline.map((r: any) => r.text ?? '').join('')}`, ...flat(i.children, l + 1)]);
  assert.deepEqual(tree ? flat(tree.items) : null, ['1:Kořen', '2:Větev s tabulátorem', '3:List nový'], 'the same tree with List nový');
  assert.equal((t ?? '').slice(head.length + raw.length), orig.slice(head.length + parse(orig).blocks[0].raw.length), 'bytes after the callout unchanged');
});

test('fr_mmp_02_ac18_c_first_edit_of_hola_mapa_adds_identity', async ({ page }) => {
  const core = await openMm(page, MM.hola);
  const fig = await needFigure(page, null);
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Jih$/ }).last(), 'Jih', 'end of Jih');
  await page.keyboard.type(' a západ');
  const t = await fileWhen(core, MM.hola, (x) => !!x && x.includes('Jih a západ'), 4000);
  assert.match(t ?? '', /^---\nid: [0-9A-HJKMNP-TV-Z]{26}\ntype: page\nmodified: \S+\n---\n/, 'the first-edit frontmatter (FR-FMT-02 AC-5)');
  assert.equal((t ?? '').replace(/^---\n[\s\S]*?\n---\n/, ''), original(MM.hola).replace('> - Jih\n', '> - Jih a západ\n'), 'the original body with only that line changed');
});

test('fr_mmp_02_ac18_d_crlf_without_final_newline_kept', async ({ page }) => {
  const crlf = original(MM.vyjezd).replace(/\n/g, '\r\n').replace(/\r\n$/, '');
  const vault = mindmapVault((f) => { f[MM.vyjezd] = crlf; });
  const core = await openMm(page, MM.vyjezd, { vault });
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Přehled Q4$/ }).last(), 'Přehled Q4', 'end of Přehled Q4');
  await page.keyboard.type(' 2026');
  const want = crlf.replace('>     - Přehled Q4\r\n', '>     - Přehled Q4 2026\r\n');
  const t = await fileWhen(core, MM.vyjezd, (x) => noModified(x) === noModified(want), 4000);
  assert.equal(noModified(t), noModified(want), 'CRLF on every line, no final newline');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-19

test('fr_mmp_02_ac19_turn_into_object_inside_a_mindmap_is_disabled', async ({ page }) => {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Přehled Q4$/ }).last(), 'Přehled Q4', 'caret in Přehled Q4');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.up('Shift');
  const tb = toolbar(page).getByRole('button', { name: 'Turn into object', exact: true });
  await must(tb, 'Formatting › Turn into object');
  assert.equal(await isDisabled(tb), true, 'toolbar: aria-disabled');
  assert.match(await description(tb), /Coming in v1\.0/, 'toolbar: Coming in v1.0');
  await page.keyboard.press('End');
  await page.keyboard.type(' /turn');
  const opt = slashMenu(page).getByRole('option', { name: 'Turn into object…', exact: true });
  await must(opt, 'slash › Turn into object…');
  assert.equal(await isDisabled(opt), true, 'slash: aria-disabled');
  assert.match(await description(opt), /Coming in v1\.0/, 'slash: Coming in v1.0');
  await page.keyboard.press('Escape');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+Shift+t');
  await sleep(500);
  assert.equal(await page.getByRole('dialog', { name: 'Turn into object', exact: true }).count(), 0, '⇧⌘T changes nothing');
  await sleep(1200);
  assert.equal(noModified(await fileText(core, MM.vyjezd)), noModified(original(MM.vyjezd)), 'nothing changed');
  await page.keyboard.press('Meta+/');
  await click(blockMenu(page).getByRole('menuitem', { name: 'Turn into object', exact: true }), 'Block actions › Turn into object');
  await must(page.getByRole('dialog', { name: 'Turn into object', exact: true }), 'the block menu converts the whole block (conversion.md)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-20

async function listAtDoprava(page: Page) {
  const core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava');
  return { core, fig };
}

test('fr_mmp_02_ac20_pasting_lists_and_paragraphs_adds_items', async ({ page }) => {
  let { core } = await listAtDoprava(page);
  await paste(page, { plain: '- Vlak\n- Letadlo\n  - Přestup' });
  let want = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava\n>   - Vlak\n>   - Letadlo\n>     - Přestup\n');
  assert.equal(noModified(await savedAs(page, core, MM.vyjezd, want)), noModified(want), 'a list: items after Doprava at its level');
  ({ core } = await listAtDoprava(page));
  await paste(page, { plain: 'Auto\n\nKolo' });
  want = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - Doprava\n>   - Auto\n>   - Kolo\n');
  assert.equal(noModified(await savedAs(page, core, MM.vyjezd, want)), noModified(want), 'paragraphs become items');
  ({ core } = await listAtDoprava(page));
  await paste(page, { plain: 'Bus' });
  want = swap(original(MM.vyjezd), '>   - Doprava\n', '>   - DopravaBus\n');
  assert.equal(noModified(await savedAs(page, core, MM.vyjezd, want)), noModified(want), 'one line at the caret');
});

test('fr_mmp_02_ac20_other_blocks_go_after_and_map_paste_does_nothing', async ({ page }) => {
  const { core, fig } = await listAtDoprava(page);
  await paste(page, { plain: '# Nadpis\n\n```\nx\n```' });
  const want = swap(original(MM.vyjezd), '>   - Doprava\n\nPoznámka', '>   - Doprava\n\n# Nadpis\n\n```\nx\n```\n\nPoznámka');
  assert.equal(noModified(await savedAs(page, core, MM.vyjezd, want)), noModified(want), 'heading and code after the mindmap block; the callout unchanged');
  const n0 = (await writes(core)).length;
  await click(mapBtn(fig), 'Map');
  await (await must(node(fig, 'Program'), 'node Program')).focus();
  await paste(page, { plain: '- Něco' });
  await sleep(1500);
  assert.equal((await writes(core)).length, n0, 'in Map, paste changes nothing and sends no write');
});

test('fr_mmp_02_ac20_copying_the_block_into_another_note_keeps_its_bytes', async ({ page }) => {
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'caret in the block');
  await page.keyboard.press('Escape');
  const clip = await copy(page);
  const block = original(MM.vyjezd).match(/> \[!mindmap\][\s\S]*?Doprava/)![0];
  assert.equal(clip.plain, block, 'the copied source is the block\'s bytes');
  const { gotoNote } = await import('./mindmap-helpers');
  await gotoNote(page, 'Prázdná');
  await editorBody(page).click();
  await paste(page, { plain: clip.plain, html: clip.html });
  await needFigure(page, 'Výjezd 2026');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-22

test('fr_mmp_02_ac22_enter_on_an_empty_top_level_item_leaves_the_block_unchanged', async ({ page }) => {
  const core = await openMm(page, MM.vice);
  const fig = await needFigure(page, 'Témata');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Zdraví$/ }).last(), 'Zdraví', 'end of Zdraví');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const c = await caretWhen(page, (x) => x.inBody && x.text === '');
  assert.equal(c.text, '', 'the caret in a new empty paragraph');
  const inFig = await fig.evaluate((f) => !!window.getSelection()?.anchorNode && f.contains(window.getSelection()!.anchorNode));
  assert.equal(inFig, false, 'after the mindmap block');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], 'the file is unchanged (zero note_write)');
  await mustCaret(fig.locator('li').filter({ hasText: /^Rodina$/ }).last(), 'Rodina', 'Rodina');
  await page.keyboard.press('Shift+Tab');
  await sleep(1500);
  assert.deepEqual(await writes(core), [], '⇧Tab in a top-level item changes nothing');
  assert.equal(await main(page).getByRole('note').filter({ hasText: 'A mindmap holds one list' }).count(), 0, 'never a hint callout');
});

test('fr_mmp_02_ac22_backspace_in_the_new_empty_item_and_code_in_an_item', async ({ page }) => {
  let core = await openMm(page, MM.prazdna);
  await editorBody(page).click();
  await page.keyboard.type('/mindmap');
  await must(slashMenu(page), 'slash menu');
  await page.keyboard.press('Enter');
  await needFigure(page, null);
  await page.keyboard.press('Backspace');
  assert.equal(await eventually(() => figures(page).count(), (n) => n === 0, 1500), 0, '⌫ in the empty item: no mindmap block');
  const t = await fileWhen(core, MM.prazdna, (x) => x === undefined || noModified(x) === noModified(original(MM.prazdna)), 3000);
  assert.equal(noModified(t), noModified(original(MM.prazdna)), 'the body is empty again');
  core = await openMm(page, MM.vice);
  const fig = await needFigure(page, 'Témata');
  await click(listBtn(fig), 'List');
  await mustCaret(fig.locator('li').filter({ hasText: /^Porady$/ }).last(), 'Porady', 'end of Porady');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/code');
  await must(slashMenu(page), 'slash menu');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  const names = await namesWhen(fig, (n) => n.includes('Porady …'), 2000);
  assert.ok(names.includes('Porady …'), `the map shows Porady …: ${names.join(', ')}`);
  assert.ok(await seen(figure(page, 'Témata'), 500), 'still a mindmap block');
  void core;
});
