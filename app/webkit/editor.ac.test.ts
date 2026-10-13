// MS3 slice 3C, L5 (WebKit + fake core): the block editor in the running UI. FR-EDT-01 AC-1 (note route), AC-2 (write
// count), AC-3…AC-10; FR-EDT-02 AC-16…AC-21; FR-EDT-03 AC-1…AC-5; FR-EDT-04 AC-1…AC-4; FR-EDT-05 AC-1…AC-6.
// Written from docs/acceptance/editor.md (R6–R9) and docs/contracts/ms3-shell.md §13 only (D-61). Every lookup goes
// through `must`/`seen` and node:assert, so a missing element is an AssertionError, not a Playwright timeout (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { absent, mustBeOn, nonReadCalls, openNote, paletteDialog } from './helpers';
import {
  E, addBelow, argText, block, blockMenu, blocksOf, bodyOf, caretIn, diffSpan, editorBody, eventually, fileText, handle,
  kindsOf, linkSuggestions, must, mustBeSaved, noModified, openEditor, original, paste, seen, selectIn, sleep, slashMenu,
  sourceBlocks, stateIs, titleField, toolbar, writes, type FakeCoreHandle,
} from './editor-helpers';

/** Expected body after re-ordering blocks (1-based `order`): neighbours of the original keep their gap byte for byte,
 *  new neighbours get one blank line (ADR 0002 §4). */
async function reordered(text: string, order: number[]): Promise<string> {
  const { parse } = await import('@tegg/doc');
  const d = parse(text);
  const b = d.blocks;
  const raw = (i: number) => text.slice(b[i - 1].range[0], b[i - 1].range[1]);
  const gap = (i: number) => text.slice(b[i - 1].range[1], b[i].range[0]); // between block i and i+1
  let out = text.slice(d.bodyStart, b[0].range[0]);
  order.forEach((n, k) => {
    out += raw(n);
    if (k < order.length - 1) out += order[k + 1] === n + 1 ? gap(n) : '\n\n';
  });
  return out + text.slice(b[b.length - 1].range[1]);
}
/** Accessible description (aria-description or aria-describedby) plus visible text of an element. */
async function described(loc: import('@playwright/test').Locator): Promise<string> {
  return loc.evaluate((el) => {
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return [el.getAttribute('aria-description') ?? '', ...ids.map((id) => document.getElementById(id)?.textContent ?? ''), (el as HTMLElement).innerText].join(' ');
  });
}
const frontOf = (t: string) => t.slice(0, t.length - t.replace(/^---\n[\s\S]*?\n---\n/, '').length);

async function savedText(page: Page, core: FakeCoreHandle, path: string, ms = 3000): Promise<string> {
  await sleep(150);
  await mustBeSaved(page, ms);
  const t = await fileText(core, path);
  assert.ok(t !== undefined, `${path} exists`);
  return t!;
}

// ------------------------------------------------------------------------------------------------ FR-EDT-01

test('fr_edt_01_ac1_note_route_body_is_the_editor', async ({ page }) => {
  await openEditor(page, E.deset);
  const box = editorBody(page).first();
  assert.equal(await box.getAttribute('aria-multiline'), 'true', 'Note body is a multiline textbox');
  assert.equal(await box.getAttribute('contenteditable'), 'true', 'the body is editable');
  for (const t of ['Cíl', 'Úkoly', 'Prázdná']) {
    await openNote(page, t);
    assert.ok(await seen(editorBody(page)), `${t}: body is the editor`);
  }
});

test('fr_edt_01_ac2_loading_every_fixture_note_sends_no_write', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  for (const t of ['Cíl', 'Seznamy', 'Odsazený kód', 'Odstavce', 'Úkoly', 'Surové bloky', 'Prázdná', 'Bez hlavičky', 'Cizí hlavička', 'Štítky', 'C# tips']) {
    await openNote(page, t);
    await must(editorBody(page), `${t}: editor`);
  }
  await sleep(1500);
  assert.deepEqual(await nonReadCalls(core), [], 'loading and unloading notes sends no write command');
});

test('fr_edt_01_ac3_block_handles_and_add_block_below', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await block(page, 5).hover();
  await must(addBelow(page), 'button "Add block below" on hover');
  await must(handle(page), 'button "Drag to move, click for block menu" on hover');
  await caretIn(page, 2);
  assert.ok(await seen(addBelow(page)), 'handles shown for the caret block');
  await addBelow(page).first().click();
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'an empty paragraph is never written (AP-135)');
  await page.keyboard.type('Nový blok.');
  const t = await savedText(page, core, E.deset);
  assert.equal(await bodyOf(t), (await bodyOf(original(E.deset))).replace('Druhý řádek po tvrdém zalomení.\n', 'Druhý řádek po tvrdém zalomení.\n\nNový blok.\n'), 'new paragraph after block 2, caret in it');
});

test('fr_edt_01_ac4_drag_block_3_below_block_8', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await block(page, 3).hover();
  const h = await must(handle(page), 'drag handle of block 3');
  const hb = (await h.boundingBox())!;
  const tb = (await must(block(page, 8), 'block 8')).boundingBox();
  const target = (await tb)!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + target.height - 2, { steps: 12 });
  await page.mouse.move(target.x + 20, target.y + target.height + 2, { steps: 4 });
  await page.mouse.up();
  const t = await savedText(page, core, E.deset);
  const orig = original(E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 2, 4, 5, 6, 7, 8, 3, 9, 10]), 'body blocks 1,2,4,5,6,7,8,3,9,10 with kept gaps');
  assert.equal(noModified(frontOf(t)), noModified(frontOf(orig)), 'frontmatter differs only in modified');
  assert.notEqual(frontOf(t), frontOf(orig), 'modified changed');
});

test('fr_edt_01_ac5_move_by_keyboard_and_edges', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 3, null, true);
  await page.keyboard.press('Meta+Shift+ArrowDown');
  let t = await savedText(page, core, E.deset);
  assert.equal(await bodyOf(t), await reordered(orig, [1, 2, 4, 3, 5, 6, 7, 8, 9, 10]), '⇧⌘↓ moves block 3 one down');
  await page.keyboard.press('Meta+Shift+ArrowUp');
  t = await savedText(page, core, E.deset);
  assert.equal(await bodyOf(t), await bodyOf(orig), '⇧⌘↑ moves it back');
  const n = (await writes(core)).length;
  await caretIn(page, 1, null, true);
  await page.keyboard.press('Meta+Shift+ArrowUp');
  await caretIn(page, 10);
  await page.keyboard.press('Meta+Shift+ArrowDown');
  await sleep(1500);
  assert.equal((await writes(core)).length, n, 'no write at the first/last position');
});

test('fr_edt_01_ac6_block_menu_items_duplicate_delete_turn_into', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await block(page, 5).hover();
  await (await must(handle(page), 'handle')).click();
  const menu = await must(blockMenu(page), 'menu "Block actions"');
  for (const name of ['Turn into', 'Duplicate', 'Delete', 'Copy link to block', 'Turn into object']) {
    await must(menu.getByRole('menuitem', { name, exact: true }), `menu item ${name}`);
  }
  const copy = menu.getByRole('menuitem', { name: 'Copy link to block', exact: true });
  assert.equal(await copy.getAttribute('aria-disabled'), 'true', 'Copy link to block disabled (AP-131)');
  assert.match(await described(copy), /Coming in v1\.0/, 'Coming in v1.0');
  const obj = menu.getByRole('menuitem', { name: 'Turn into object', exact: true });
  assert.equal(await obj.getAttribute('aria-disabled'), 'true', 'Turn into object disabled');
  await page.keyboard.press('Escape');
  assert.ok(await absent(blockMenu(page)), 'Esc closes the menu');

  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await must(blockMenu(page), '⌘/ opens the block menu');
  await blockMenu(page).getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  let t = await savedText(page, core, E.deset);
  const b5 = 'Pátý blok, který test upraví.';
  assert.equal((await blocksOf(t)).filter((x) => x === b5).length, 2, 'duplicate inserts a byte-identical copy after the block');
  await caretIn(page, 6);
  await page.keyboard.press('Meta+/');
  await blockMenu(page).getByRole('menuitem', { name: 'Delete', exact: true }).click();
  t = await savedText(page, core, E.deset);
  assert.equal((await blocksOf(t)).filter((x) => x === b5).length, 1, 'delete removes it');

  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await (await must(page.getByRole('menuitem', { name: 'Heading 2', exact: true }), 'Turn into › Heading 2')).click();
  t = await savedText(page, core, E.deset);
  const d = diffSpan(noModified(orig), noModified(t))!;
  assert.equal(t.includes('## Pátý blok, který test upraví.'), true, 'block 5 becomes a heading 2');
  const start5 = orig.indexOf(b5);
  assert.ok(d.start >= start5 && d.endA <= start5 + b5.length, 'only block 5\'s range changes');
});

test('fr_edt_01_ac6_block_menu_keyboard_reachable', async ({ page }) => {
  await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  const menu = await must(blockMenu(page), 'block menu');
  const items = menu.getByRole('menuitem');
  const n = await items.count();
  assert.ok(n >= 5, 'menu items');
  const seenNames = new Set<string>();
  for (let i = 0; i < n + 1; i++) {
    seenNames.add(await page.evaluate(() => (document.activeElement as HTMLElement)?.innerText?.trim() ?? ''));
    await page.keyboard.press('ArrowDown');
  }
  assert.ok([...seenNames].some((s) => s.startsWith('Duplicate')), `↓ reaches Duplicate: ${[...seenNames].join(' | ')}`);
  await page.keyboard.press('Escape');
  assert.ok(await absent(blockMenu(page)), 'Esc closes');
  const inEditor = await page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]'));
  assert.ok(inEditor, 'Esc returns the cursor to the editor');
});

test('fr_edt_01_ac7_seznamy_delete_separator_star_marker', async ({ page }) => {
  const core = await openEditor(page, E.seznamy);
  await caretIn(page, 2);
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Delete', exact: true }), 'Delete')).click();
  const t = await savedText(page, core, E.seznamy);
  const body = await bodyOf(t);
  assert.ok(body === '- a\n- b\n\n* c\n* d\n' || body === '* a\n* b\n\n- c\n- d\n', `two lists, one with *: ${JSON.stringify(body)}`);
  assert.deepEqual(await kindsOf(t), ['list', 'list'], 'parses to two lists');
});

test('fr_edt_01_ac8_source_blocks_and_placeholders', async ({ page }) => {
  const core = await openEditor(page, E.surove);
  const orig = original(E.surove);
  const groups = sourceBlocks(page);
  assert.equal(await groups.count(), 5, 'HTML, footnote, $$ math, comment block, dataview fence are source blocks');
  const texts = await groups.allInnerTexts();
  assert.ok(texts.some((x) => x.includes('<summary>Více</summary>')), 'HTML text exact');
  assert.ok(texts.some((x) => x.includes('LIST FROM #projekt')), 'dataview text exact');
  const regions = editorBody(page).getByRole('region');
  assert.ok((await regions.count()) >= 4, 'note embed, image embed, query and mindmap are R5 placeholders');
  // Typing and pasting inside a source block changes nothing.
  await groups.first().click();
  await page.keyboard.type('xyz');
  await paste(page, { plain: 'vloženo' });
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'typing/pasting into a source block writes nothing');
  // Edit first and last paragraph: source blocks byte-identical.
  await caretIn(page, 1);
  await page.keyboard.type(' A');
  const last = await editorBody(page).locator(':scope > *').count();
  await caretIn(page, last);
  await page.keyboard.type(' B');
  const t = await savedText(page, core, E.surove);
  assert.equal(noModified(t), noModified(orig).replace('Úvodní odstavec.', 'Úvodní odstavec. A').replace('Závěrečný odstavec.', 'Závěrečný odstavec. B'), 'only the two paragraphs change');
});

test('fr_edt_01_ac8_source_block_can_be_moved_duplicated_deleted', async ({ page }) => {
  const core = await openEditor(page, E.surove);
  const groups = sourceBlocks(page);
  await must(groups, 'source blocks');
  await groups.first().hover();
  await (await must(handle(page), 'handle on a source block')).click();
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Duplicate', exact: true }), 'Duplicate')).click();
  const t = await savedText(page, core, E.surove);
  const html = '<details>\n<summary>Více</summary>\nSkrytý text.\n</details>';
  assert.equal(t.split(html).length - 1, 2, 'the HTML block is duplicated verbatim');
  await groups.first().hover();
  await handle(page).first().click();
  await blockMenu(page).getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const t2 = await savedText(page, core, E.surove);
  assert.equal(t2.split(html).length - 1, 1, 'and deleted again');
});

test('fr_edt_01_ac9_empty_body_hint_and_first_text', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  const hint = 'Type / for blocks, [[ to link, # to tag';
  assert.ok(await seen(editorBody(page).getByText(hint)), 'hint in the empty body');
  await editorBody(page).first().click();
  await page.keyboard.press('Meta+a');
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.activeElement?.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  assert.ok(!copied.includes(hint), 'the hint is not copied');
  await page.keyboard.type('Ahoj');
  const t = await savedText(page, core, E.prazdna);
  assert.equal(noModified(t), noModified(original(E.prazdna)) + 'Ahoj\n', 'original bytes + Ahoj + \\n');
});

test('fr_edt_01_ac10_title_field', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const title = await must(titleField(page), 'textbox "Title"');
  const f = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }));
  assert.ok(f.label === 'Title' || (await title.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))), 'focus on the title after navigation');
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"]')), '↓ puts the caret in the body');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' nové');
  const t = await savedText(page, core, E.deset);
  assert.equal(noModified(t), noModified(original(E.deset)).replace('title: Deset bloků', 'title: Deset bloků nové'), 'only title: changes');
  assert.ok((await core.files())[E.deset] !== undefined, 'file name unchanged');
  await title.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('   ');
  await caretIn(page, 2);
  await sleep(1500);
  assert.equal((await fileText(core, E.deset))!.includes('title: Deset bloků nové'), true, 'a title of spaces is not saved');
  assert.equal((await title.innerText()).trim() || (await title.inputValue().catch(() => '')), 'Deset bloků nové', 'leaving restores the last saved title');
  await title.click();
  await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"]')), '⏎ in the title moves to the body');
});

test('fr_edt_01_ac10_new_object_opens_with_caret_in_body', async ({ page }) => {
  await openEditor(page, E.deset);
  await page.keyboard.press('Meta+n');
  const dlg = await must(page.getByRole('dialog', { name: 'New object' }), 'New object');
  await dlg.getByRole('textbox').first().fill('Nový zápis');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nový zápis', 'new note opens');
  await must(editorBody(page), 'editor');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"]')), 'caret in the empty body (AP-135)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02

test('fr_edt_02_ac16_editor_looks_like_read_view_and_links_open', async ({ page }) => {
  await openEditor(page, E.deset);
  const body = editorBody(page);
  await must(body.getByRole('heading', { name: 'Přehled' }), 'heading inside the editor');
  await must(body.getByRole('table'), 'table');
  await must(body.getByRole('note'), 'callout as note role');
  const link = await must(body.getByRole('link', { name: 'Cíl' }), 'link chip Cíl');
  await link.click();
  await mustBeOn(page, 'Cíl', 'click on a resolved chip opens it (D-140)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Deset bloků', 'back');
  await caretIn(page, 10, 'Odkaz na ');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Cíl', '⌘↩ at the link opens it (AP-127)');
});

const SLASH_BUILT: [string, string][] = [
  ['Text', 'Žluťoučký kůň'], ['Heading 1', '# Žluťoučký kůň'], ['Heading 2', '## Žluťoučký kůň'], ['Heading 3', '### Žluťoučký kůň'],
  ['Bulleted list', '- Žluťoučký kůň'], ['Numbered list', '1. Žluťoučký kůň'], ['Checklist', '- [ ] Žluťoučký kůň'],
  ['Quote', '> Žluťoučký kůň'], ['Callout', '> [!note] Žluťoučký kůň'], ['Code block', '```\nŽluťoučký kůň\n```'],
];
const KIND: Record<string, string> = {
  Text: 'paragraph', 'Heading 1': 'heading', 'Heading 2': 'heading', 'Heading 3': 'heading', 'Bulleted list': 'list',
  'Numbered list': 'list', Checklist: 'checklist', Quote: 'quote', Callout: 'callout', 'Code block': 'code',
};

test('fr_edt_02_ac17_each_built_slash_item_creates_its_block', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  for (const [item, written] of SLASH_BUILT) {
    await page.reload(); // the fake core starts again from the fixture
    await must(editorBody(page), 'editor');
    await editorBody(page).first().click();
    await page.keyboard.type('/');
    await must(slashMenu(page), `slash menu for ${item}`);
    await slashMenu(page).getByRole('option', { name: item, exact: true }).click();
    await page.keyboard.type('Žluťoučký kůň');
    const t = await savedText(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${written}\n`, `${item} writes ${written}`);
    assert.deepEqual(await kindsOf(t), [KIND[item]], `${item} parses as ${KIND[item]}`);
  }
});

test('fr_edt_02_ac17_divider_and_table_from_slash_menu', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('/Divider');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Žluťoučký kůň');
  let t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '---\n\nŽluťoučký kůň\n', 'divider then paragraph');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/Table');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Žluťoučký kůň');
  t = await savedText(page, core, E.prazdna);
  assert.deepEqual(await kindsOf(t), ['divider', 'paragraph', 'table'], 'a table');
  const { markdownTree } = await import('@tegg/doc');
  const table = markdownTree(await bodyOf(t)).children.find((n: any) => n.type === 'table') as any;
  assert.equal(table.children.length, 3, 'header + 2 body rows');
  assert.equal(table.children[0].children.length, 3, '3 columns');
});

test('fr_edt_02_ac17_list_tab_shift_tab_and_enter_on_empty_item', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('- a');
  await page.keyboard.press('Enter');
  await page.keyboard.type('b');
  await page.keyboard.press('Tab');
  let t = await savedText(page, core, E.prazdna);
  assert.match(await bodyOf(t), /^- a\n {2,4}- b\n$/, 'Tab nests');
  await page.keyboard.press('Shift+Tab');
  t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '- a\n- b\n', '⇧Tab un-nests');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('konec');
  t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '- a\n- b\n\nkonec\n', '⏎ on an empty item ends the list');
});

test('fr_edt_02_ac18_checklist_toggle_by_click_and_cmd_enter', async ({ page }) => {
  const core = await openEditor(page, E.ukoly);
  const orig = original(E.ukoly);
  const box = await must(editorBody(page).getByRole('checkbox').first(), 'checkbox of Koupit mléko');
  assert.equal(await box.getAttribute('aria-readonly'), null, 'no aria-readonly');
  await box.click();
  let t = await savedText(page, core, E.ukoly);
  assert.equal(noModified(t), noModified(orig).replace('- [ ] Koupit mléko', '- [x] Koupit mléko'), 'one byte changes');
  await caretIn(page, 1, 'Velké');
  await page.keyboard.press('Meta+Enter');
  t = await savedText(page, core, E.ukoly);
  assert.equal(noModified(t), noModified(orig).replace('- [ ] Koupit mléko', '- [x] Koupit mléko').replace('- [X] Velké X', '- [ ] Velké X'), 'X → space, others keep x/X');
  assert.deepEqual(Object.keys(await core.files()).filter((p) => p.startsWith('Tasks/')), [], 'no Task file created (FR-TSK-11)');
});

test('fr_edt_02_ac19_callout_type_submenu', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 9, 'Obsah');
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }), 'Turn into')).click();
  await (await must(page.getByRole('menuitem', { name: 'Callout type', exact: true }), 'Callout type')).click();
  const types = await page.getByRole('menuitem').allInnerTexts();
  for (const ty of ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote']) {
    assert.ok(types.some((x) => x.toLowerCase().includes(ty)), `callout type ${ty} offered`);
  }
  await page.getByRole('menuitem', { name: /warning/i }).first().click();
  const t = await savedText(page, core, E.deset);
  assert.equal(noModified(t), noModified(orig).replace('> [!tip] Tip', '> [!warning] Tip'), 'only [!tip] → [!warning]');
});

test('fr_edt_02_ac20_table_cell_pipe_and_actions', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  const cell = await must(block(page, 8).getByRole('cell', { name: '1' }), 'cell 1');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type('x|y');
  let t = await savedText(page, core, E.deset);
  assert.equal(noModified(t), noModified(orig).replace('| a \\| b | 1 |', '| a \\| b | 1x\\|y |'), 'pipe escaped; alignment and other cells unchanged');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(() => !!document.activeElement && !!window.getSelection()?.anchorNode?.parentElement?.closest('table')), '⏎ in a cell stays in the table');
  const { markdownTree } = await import('@tegg/doc');
  const dims = async () => {
    const tt = await savedText(page, core, E.deset);
    const tb = markdownTree(await bodyOf(tt)).children.find((n: any) => n.type === 'table') as any;
    return { rows: tb.children.length, cols: tb.children[0].children.length, align: tb.align };
  };
  for (const [action, want] of [['Add row below', { rows: 3, cols: 2 }], ['Add column right', { rows: 3, cols: 3 }], ['Delete column', { rows: 3, cols: 2 }], ['Delete row', { rows: 2, cols: 2 }]] as const) {
    await page.keyboard.press('Meta+/');
    await (await must(blockMenu(page).getByRole('menuitem', { name: action, exact: true }), action)).click();
    const d = await dims();
    assert.equal(d.rows, want.rows, `${action}: rows`);
    assert.equal(d.cols, want.cols, `${action}: columns`);
    assert.equal(d.align[0], 'left', `${action}: alignment kept`);
  }
});

test('fr_edt_02_ac21_embeds_typed_by_hand', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('![[Cíl]]');
  await must(editorBody(page).getByRole('region'), 'embed-note placeholder after ]]');
  let t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '![[Cíl]]\n', 'saves ![[Cíl]]');
  await page.keyboard.press('Enter');
  await page.keyboard.type('![[obrázek.png]]');
  t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '![[Cíl]]\n\n![[obrázek.png]]\n', 'image embed saved');
  assert.equal((await editorBody(page).getByRole('region').count()) >= 2, true, 'embed-image placeholder');
  assert.equal((await core.calls()).filter((c) => /attachment|image|read_file/.test(c.cmd)).length, 0, 'no image file read');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03

test('fr_edt_03_ac1_slash_opens_only_where_it_should', async ({ page }) => {
  await openEditor(page, E.deset);
  await caretIn(page, 5, null, true);
  await page.keyboard.type('/');
  const menu = await must(slashMenu(page), 'listbox "Insert block" at block start');
  const opts = (await menu.getByRole('option').allInnerTexts()).map((s) => s.split('\n')[0].trim());
  assert.deepEqual(opts.slice(0, 4), ['Task', 'Turn into object…', 'Embed object', 'Text'], 'R6 order');
  await page.keyboard.press('Escape');
  for (const [n, after] of [[5, 'Pátý'], [7, 'const'], [10, 'Odkaz na [[C']] as const) {
    await caretIn(page, n, after);
    await page.keyboard.type('/');
    assert.ok(await absent(slashMenu(page), 500), `no slash menu after "${after}" in block ${n}`);
  }
});

test('fr_edt_03_ac2_filter', async ({ page }) => {
  await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  const first = async (q: string) => {
    await page.keyboard.type(q);
    const menu = await must(slashMenu(page), `menu for ${q}`);
    const o = await menu.getByRole('option').allInnerTexts();
    for (let i = 0; i < q.length; i++) await page.keyboard.press('Backspace');
    return o.map((s) => s.split('\n')[0].trim());
  };
  assert.equal((await first('/hea2'))[0], 'Heading 2');
  assert.equal((await first('/tab'))[0], 'Table');
  assert.equal((await first('/CHECK'))[0], 'Checklist');
  await page.keyboard.type('/xyz');
  await must(page.getByText('No matching blocks'), 'empty state');
  await page.keyboard.press('Enter');
  assert.equal((await editorBody(page).first().innerText()).includes('/xyz'), true, '⏎ inserts nothing');
});

test('fr_edt_03_ac3_keyboard_and_escape_keeps_text', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('/he');
  await must(slashMenu(page), 'menu');
  await page.keyboard.press('ArrowDown');
  const sel = await slashMenu(page).getByRole('option', { selected: true }).innerText();
  assert.ok(/Heading/.test(sel), 'selection moves among items (headers skipped)');
  await page.keyboard.press('Escape');
  assert.ok(await absent(slashMenu(page)), 'Esc closes');
  const t = await savedText(page, core, E.prazdna);
  const { markdownTree } = await import('@tegg/doc');
  const tree = markdownTree(await bodyOf(t)) as any;
  assert.equal(tree.children[0].type, 'paragraph', '/he saved as text');
  assert.equal(tree.children[0].children.map((c: any) => c.value ?? '').join(''), '/he', 'reads back as /he');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/quo');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Citát');
  const t2 = await savedText(page, core, E.prazdna);
  assert.ok((await bodyOf(t2)).endsWith('> Citát\n'), 'Tab chooses');
});

test('fr_edt_03_ac4_where_the_block_goes', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  await caretIn(page, 5);
  await page.keyboard.type(' /quo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Nová citace');
  const t = await savedText(page, core, E.deset);
  const bl = await blocksOf(t);
  const i = bl.findIndex((x) => x.startsWith('Pátý blok'));
  assert.equal(bl[i]?.trimEnd(), 'Pátý blok, který test upraví.', '/quo removed from the paragraph');
  assert.equal(bl[i + 1], '> Nová citace', 'the quote is inserted after the paragraph, caret in it');
  assert.equal(bl.length, (await blocksOf(orig)).length + 1, 'one block added');
});

test('fr_edt_03_ac5_disabled_items_send_nothing', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('/');
  const menu = await must(slashMenu(page), 'menu');
  const n0 = (await core.calls()).length;
  for (const [name, ms] of [['Task', 'MS5'], ['Image', 'MS6'], ['Query', 'v1.0'], ['Block embed', 'MS4']]) {
    const o = await must(menu.getByRole('option', { name, exact: true }), name);
    assert.equal(await o.getAttribute('aria-disabled'), 'true', `${name} aria-disabled`);
    assert.match(await described(o), new RegExp(`Coming in ${ms.replace('.', '\\.')}`), `${name}: Coming in ${ms}`);
    await o.click();
    assert.ok(await seen(slashMenu(page), 300), `${name}: menu stays open`);
  }
  await sleep(300);
  assert.deepEqual((await core.calls()).slice(n0).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:') && c !== 'perf_mark'), [], 'no IPC command');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-04

test('fr_edt_04_ac1_block_shortcuts_in_the_ui', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  for (const [typed, written] of [['## ', '## '], ['* ', '- '], ['1) ', '1. '], ['[] ', '- [ ] '], ['> ', '> ']]) {
    await page.reload(); // the fake core starts again from the fixture
    await must(editorBody(page), 'editor');
    await editorBody(page).first().click();
    await page.keyboard.type(typed + 'Řádek');
    const t = await savedText(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${written}Řádek\n`, `${typed} → ${written}`);
  }
});

test('fr_edt_04_ac2_inline_shortcuts_and_literals', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('**tučné** __tučné__ *kurzíva* _kurzíva_ ~~škrt~~ ==zvýraznění== `kód` 2 * 3 * 4 snake_case_název cena $5 a $3');
  const t = await savedText(page, core, E.prazdna);
  const b = await bodyOf(t);
  assert.ok(b.startsWith('**tučné** **tučné** *kurzíva* *kurzíva* ~~škrt~~ ==zvýraznění== `kód` '), `marks saved in R7's written form: ${JSON.stringify(b)}`);
  const { markdownTree } = await import('@tegg/doc');
  const types: string[] = [];
  const flat = (n: any): string => { types.push(n.type); return n.type === 'text' ? n.value : (n.children ?? []).map(flat).join(''); };
  const text = flat(markdownTree(b));
  assert.ok(text.endsWith('2 * 3 * 4 snake_case_název cena $5 a $3'), `literals read back as the same text: ${JSON.stringify(text)}`);
  assert.deepEqual(['strong', 'emphasis', 'delete', 'inlineCode'].map((x) => types.filter((y) => y === x).length), [2, 2, 1, 1], 'two bold, two italic, one strike, one code; no extra marks from the literals');
  assert.ok(!types.includes('inlineMath') && !types.includes('math'), 'no math from $5 a $3');
});

test('fr_edt_04_ac3_undo_a_conversion', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('- ');
  await page.keyboard.press('Meta+z');
  await page.keyboard.type('x');
  let t = await savedText(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '\\- x\n', '⌘Z restores "- " as text (escaped so it reads back as text)');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**tučné**');
  await page.keyboard.press('Meta+z');
  t = await savedText(page, core, E.prazdna);
  const { markdownTree } = await import('@tegg/doc');
  const flat = (n: any): string => (n.type === 'text' ? n.value : (n.children ?? []).map(flat).join(''));
  assert.ok(flat(markdownTree(await bodyOf(t))).includes('**tučné**'), '⌘Z restores **tučné** literally');
});

test('fr_edt_04_ac4_bracket_escape_stays_text', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('Viz [[Cí');
  await must(linkSuggestions(page), 'link suggestions');
  await page.keyboard.press('Escape');
  const t = await savedText(page, core, E.prazdna);
  const { wikilinks, parse } = await import('@tegg/doc');
  assert.equal(wikilinks(parse(t)).length, 0, '[[ closed with Esc is not a link');
  const { markdownTree } = await import('@tegg/doc');
  const flat = (n: any): string => (n.type === 'text' ? n.value : (n.children ?? []).map(flat).join(''));
  assert.equal(flat(markdownTree(await bodyOf(t))).trim(), 'Viz [[Cí', 'reads back as the same text');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-05

test('fr_edt_05_ac1_toolbar_on_text_selection_only', async ({ page }) => {
  await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  const tb = await must(toolbar(page), 'toolbar "Formatting"');
  for (const b of ['Bold', 'Italic', 'Strikethrough', 'Inline code', 'Highlight', 'Link', 'Turn into object']) {
    await must(tb.getByRole('button', { name: b, exact: true }), `button ${b}`);
  }
  assert.equal(await tb.getByRole('button', { name: 'Turn into object' }).getAttribute('aria-disabled'), 'true', 'Turn into object disabled');
  assert.equal(await tb.getByRole('button', { name: 'Bold', exact: true }).getAttribute('aria-pressed'), 'false', 'aria-pressed');
  await page.keyboard.press('Escape');
  assert.ok(await absent(toolbar(page)), 'Esc hides it');
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'blok', 'and keeps the selection');
  await caretIn(page, 5);
  assert.ok(await absent(toolbar(page), 500), 'no toolbar for a collapsed caret');
  await selectIn(page, 7, 'const');
  assert.ok(await absent(toolbar(page), 500), 'no toolbar in a code block');
  await selectIn(page, 2, 'Odstavec');
  await must(toolbar(page), 'toolbar again');
  await titleField(page).first().click();
  await page.keyboard.press('Meta+a');
  assert.ok(await absent(toolbar(page), 500), 'no toolbar in the title');
});

test('fr_edt_05_ac2_marks_by_button_and_shortcut', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const orig = original(E.deset);
  const cases: [string, string, string][] = [
    ['Bold', 'Meta+b', '**blok**'], ['Italic', 'Meta+i', '*blok*'], ['Strikethrough', 'Meta+Shift+s', '~~blok~~'],
    ['Inline code', 'Meta+e', '`blok`'], ['Highlight', 'Meta+Shift+h', '==blok=='],
  ];
  for (const [btn, keys, md] of cases) {
    for (const how of ['button', 'keys'] as const) {
      await selectIn(page, 5, 'blok');
      if (how === 'button') await (await must(toolbar(page).getByRole('button', { name: btn, exact: true }), btn)).click();
      else await page.keyboard.press(keys);
      let t = await savedText(page, core, E.deset);
      assert.equal(noModified(t), noModified(orig).replace('Pátý blok,', `Pátý ${md},`), `${btn} by ${how}`);
      await selectIn(page, 5, 'blok');
      if (how === 'button') await toolbar(page).getByRole('button', { name: btn, exact: true }).click();
      else await page.keyboard.press(keys);
      t = await savedText(page, core, E.deset);
      assert.equal(await bodyOf(t), await bodyOf(orig), `${btn} again removes it`);
    }
  }
});

test('fr_edt_05_ac3_link_to_a_note', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  await page.keyboard.press('Meta+Shift+k');
  const field = await must(page.getByRole('combobox', { name: 'Link', exact: true }), 'field Link');
  await field.fill('Cíl');
  await (await must(linkSuggestions(page).getByRole('option').filter({ hasText: 'Cíl' }), 'Cíl suggested')).first().click();
  const t = await savedText(page, core, E.deset);
  assert.ok(t.includes('Pátý [[Cíl|blok]], který'), 'saves [[Cíl|blok]]');
  await page.reload(); // the fake core starts again from the fixture
  await must(editorBody(page), 'editor after reload');
  await caretIn(page, 5);
  await page.keyboard.type(' Cíl');
  await selectIn(page, 5, 'Cíl');
  await toolbar(page).getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByRole('combobox', { name: 'Link', exact: true }).fill('Cíl');
  await linkSuggestions(page).getByRole('option').filter({ hasText: 'Cíl' }).first().click();
  const t2 = await savedText(page, core, E.deset);
  assert.ok(/upraví\.? \[\[Cíl\]\]/.test(t2), 'with Cíl selected: [[Cíl]]');
});

test('fr_edt_05_ac4_link_to_url_and_refused_schemes', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  for (const [url, ok] of [['https://example.com/a?b=c', true], ['mailto:eva@example.com', true], ['javascript:alert(1)', false], ['file:///etc/hosts', false], ['data:text/html,x', false]] as const) {
    await page.reload(); // the fake core starts again from the fixture
    await must(editorBody(page), 'editor');
    const n = (await writes(core)).length;
    await selectIn(page, 5, 'blok');
    await page.keyboard.press('Meta+Shift+k');
    const f = await must(page.getByRole('combobox', { name: 'Link', exact: true }), 'Link field');
    await f.fill(url);
    await page.keyboard.press('Enter');
    if (ok) {
      const t = await savedText(page, core, E.deset);
      assert.ok(t.includes(`Pátý [blok](${url}), který`), `${url} saved as Markdown link`);
    } else {
      await must(page.getByRole('alert').or(page.getByRole('status')).filter({ hasNotText: 'Saved' }), `${url}: refused with a message`);
      await sleep(1500);
      assert.equal((await writes(core)).length, n, `${url}: nothing changes`);
    }
  }
});

test('fr_edt_05_ac5_remove_link_and_backspace_chip', async ({ page }) => {
  const orig = original(E.deset).replace('Pátý blok,', 'Pátý [blok](https://example.com/a?b=c),').replace('Odkaz na [[Cíl]]', 'Odkaz na [[Cíl|blok]]');
  const v = (await import('./editor-helpers')).editorVault();
  v.files[E.deset] = orig;
  const core = await openEditor(page, E.deset, { vault: v });
  await caretIn(page, 5, 'bl');
  await page.keyboard.press('Meta+Shift+k');
  await (await must(page.getByRole('button', { name: 'Remove link', exact: true }), 'Remove link')).click();
  let t = await savedText(page, core, E.deset);
  assert.ok(t.includes('Pátý blok, který'), 'URL link → plain text');
  await caretIn(page, 10, 'Odkaz na ');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Meta+Shift+k');
  await (await must(page.getByRole('button', { name: 'Remove link', exact: true }), 'Remove link (wikilink)')).click();
  t = await savedText(page, core, E.deset);
  assert.ok(t.includes('Odkaz na blok a'), '[[Cíl|blok]] → blok');
  await caretIn(page, 10, 'blok');
  await page.keyboard.type(' [[Cíl]]');
  await mustBeSaved(page);
  await page.keyboard.press('Backspace');
  t = await savedText(page, core, E.deset);
  assert.ok(!t.includes('[[Cíl]]') && !t.includes('[[Cíl'), '⌫ after a chip removes the whole link');
});

test('fr_edt_05_ac6_cmd_k_is_the_palette', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await selectIn(page, 5, 'blok');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await page.keyboard.press('Escape');
  assert.ok(await absent(paletteDialog(page)), 'palette closed');
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), 'blok', 'same selection back');
  await sleep(1500);
  assert.equal((await writes(core)).length, 0, 'no text changed');
});

// keep helpers referenced for the type checker
void argText; void stateIs; void eventually;
