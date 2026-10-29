// v1.0 slice P, L5 (WebKit + fake core): object previews in the editor. docs/acceptance/previews.md FR-LNK-08 AC-1
// (a click on a chip previews, the caret goes after the chip), FR-LNK-13 AC-1…AC-9 (caret, double-click, ⌘↩ / ⌥Space,
// keyboard reach, the `Link` menu, `Edit link`, `Remove link`, inside embeds, mindmap node chips), FR-LNK-12 AC-7's
// editor part (⏎ splits the paragraph), FR-SYN-06 AC-37 L5 part (0 writes, then 1 `note_write`), FR-UX-03 AC-19 L5
// part, FR-UX-05 AC-14 (the `Link` menu and the `Edit link` dialog in both themes) and NFR-OTH-02 AC-11 L5 part (the
// menu and the dialog). Interface docs/contracts/v1-previews.md §3 (popover), §5 (editor gestures, `focusAfterChip`,
// `editLink`, `removeLink`, the `Link` menu, `EditLinkDialog`), §6 (commands), §9 (fake core). Default mode Click to
// preview. Written from the ACs and the contract only (D-61). Every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale, paletteOptions, paletteDialog } from './helpers';
import {
  ISO_MODIFIED, ODK, PV, anyPreview, axeContrastIn, block, callCount, callsFrom, caretAt, caretRel, chipIn, cmdsFrom, colourLeaksIn,
  controlsWithoutCommand, createOffer, editLinkDialog, editorBody, eventually, field, fieldValue, fileText, fileWhen, flat, focusInside,
  focusOutline, focusedName, keydowns, linkMenu, linkSuggestions, main, mainName, menuItems, must, mustBeOn, mustBeSaved, mustCaret,
  needPreview, nfc, noModified, nodeSelected, noteWrites, openPv, original, pathOf, previewCount, previewOf, recordKeydowns, rightClick,
  runCommand, seen, selectionMenu, sleep, tabTo, tokenColour, unmarkedIn, wordPoint, writeCmds,
} from './previews-editor-helpers';
import { embedTextbox, needFrame } from './embeds-helpers';
import { figure, mapBtn, node, viewOf } from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ODKAZY = PV.odkazy;
const LINK_ITEMS = ['Open', 'Show preview', 'Edit link', 'Remove link'];

/** Waits for Odkazy's saved text to differ from the fixture and returns it. */
async function savedOdkazy(page: Page, core: Awaited<ReturnType<typeof openPv>>, what: string): Promise<string> {
  await mustBeSaved(page, 4000);
  const t = await fileWhen(core, ODKAZY, (x) => !!x && x !== original(ODKAZY), 3000);
  assert.ok(t && t !== original(ODKAZY), `${what}: Odkazy is saved with the change`);
  return t!;
}
/** Asserts `text` is the fixture with `from` replaced by `to`, `modified` aside, and a fresh `modified` line. */
function sameBut(text: string | undefined, path: string, from: string, to: string, what: string) {
  const o = original(path);
  assert.ok(o.includes(from), `fixture ${path} contains ${JSON.stringify(from)}`);
  assert.equal(noModified(text), noModified(o.replace(from, to)), `${what}: the file differs only in ${JSON.stringify(from)} → ${JSON.stringify(to)} and modified`);
  assert.match(text ?? '', ISO_MODIFIED, `${what}: modified is an ISO date-time with offset`);
  assert.notEqual(/^modified: .*$/m.exec(text ?? '')?.[0], /^modified: .*$/m.exec(o)?.[0], `${what}: modified is updated`);
}
async function openLinkMenu(page: Page, chip: ReturnType<typeof chipIn>, what: string) {
  await must(chip, `${what}: the chip`);
  const prevented = await rightClick(page, chip);
  const menu = await must(linkMenu(page), `${what}: menu "Link" (FR-LNK-13 AC-5)`, 1500);
  return { prevented, menu };
}
async function menuItem(page: Page, name: string) {
  return must(linkMenu(page).getByRole('menuitem', { name: new RegExp(`^⟦?${name.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')}⟧?(\\s|$)`) }), `menuitem "${name}" of the Link menu`, 1500);
}

// ------------------------------------------------------------------------------------------------ FR-LNK-08 AC-1

test('fr_lnk_08_ac1_click_on_a_chip_in_the_editor_previews_and_leaves_the_caret_after_it', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip "Rozpočet 2027" in "Hlavní Rozpočet 2027."');
  const from = await callCount(core);
  await chip.click();
  const dlg = await needPreview(page, 'Rozpočet 2027', 'a single click on the chip');
  assert.equal(await previewCount(page), 1, 'exactly one dialog "Preview: …"');
  assert.equal(await dlg.getAttribute('aria-modal'), 'false', 'aria-modal="false"');
  assert.equal(nfc((await dlg.getAttribute('data-preview-path')) ?? ''), PV.rozpocet, 'data-preview-path is Pages/Rozpočet 2027.md');
  // Anchored to the chip: 8 px below (or above) its box, never covering it (R102, FR-LNK-11 AC-5).
  const c = (await chip.boundingBox())!, d = (await dlg.boundingBox())!;
  const below = Math.abs(d.y - (c.y + c.height) - 8) <= 2, above = Math.abs(c.y - (d.y + d.height) - 8) <= 2;
  assert.ok(below || above, `the popover is 8 px below or above the chip (chip ${JSON.stringify(c)}, popover ${JSON.stringify(d)})`);
  assert.equal(await mainName(page), 'Odkazy', 'the route stays note/Pages/Odkazy.md');
  const cmds = await cmdsFrom(core, from);
  assert.deepEqual(cmds.filter((x) => x === 'nav_opened' || x === 'note_read'), [], 'no nav_opened and no note_read for a preview (D-138)');
  assert.equal(await caretRel(chip), 'after', 'the editor selection is a collapsed caret directly after the chip (D-926)');
  assert.equal(await nodeSelected(page), false, 'no node selection on the chip');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => previewCount(page), (n) => n === 0, 1500), 0, 'Esc closes the popover');
  assert.equal(await focusInside(editorBody(page)), true, 'the focus is back in the textbox "Note body"');
  assert.equal(await caretRel(chip), 'after', 'with the same caret, directly after the chip');
  assert.deepEqual(await noteWrites(core), [], 'opening and closing the popover sends no note_write');
  await page.keyboard.type('X');
  const t = await savedOdkazy(page, core, 'typing X after Esc');
  sameBut(t, ODKAZY, ODK.p1, 'Hlavní [[Rozpočet 2027]]X.', 'typing X');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-1

test('fr_lnk_13_ac1_after_click_and_esc_the_caret_moves_over_the_chip_and_backspace_removes_it_whole', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa" in paragraph 7');
  await chip.click();
  await needPreview(page, 'Projekt Alfa', 'a single click on Projekt Alfa');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => previewCount(page), (n) => n === 0, 1500), 0, 'Esc closes the preview');
  assert.equal(await caretRel(chip), 'after', 'after click and Esc the caret is directly after the chip');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await caretRel(chip), 'before', '← once puts it directly before the chip (one position)');
  await page.keyboard.press('ArrowRight');
  assert.equal(await caretRel(chip), 'after', '→ moves over the chip as one position');
  assert.deepEqual(await noteWrites(core), [], 'caret moves write nothing');
  await page.keyboard.press('Backspace');
  const t = await savedOdkazy(page, core, '⌫ after the chip');
  sameBut(t, ODKAZY, ODK.p7, 'Projekt .', '⌫ removes the whole link in one step (editor.md FR-EDT-05 AC-5)');
  await page.keyboard.press('Meta+z');
  await mustBeSaved(page, 4000);
  const back = await fileWhen(core, ODKAZY, (x) => noModified(x) === noModified(original(ODKAZY)), 3000);
  assert.equal(noModified(back), noModified(original(ODKAZY)), '⌘Z restores the link');
});

test('fr_lnk_13_ac1_a_click_beside_a_chip_places_the_caret_and_shows_no_preview', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa"');
  // First the chip previews (D-926) …
  await chip.click();
  await needPreview(page, 'Projekt Alfa', 'a click on the chip');
  await page.keyboard.press('Escape');
  // … then a click on the text beside it places the caret there, as in any text.
  const pt = await wordPoint(block(page, 7), 'Projekt ');
  assert.ok(pt, 'the text "Projekt " beside the chip');
  await page.mouse.click(pt!.x - 4, pt!.y);
  await sleep(300);
  assert.equal(await previewCount(page), 0, 'a click on text beside a chip shows no preview');
  const where = await caretRel(chip);
  assert.equal(where, 'elsewhere', 'the caret is in the text "Projekt", not at the chip');
  assert.deepEqual(await noteWrites(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-2

test('fr_lnk_13_ac2_double_click_on_a_chip_opens_and_edits_nothing_while_plain_text_selects_a_word', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa"');
  await chip.click();
  await needPreview(page, 'Projekt Alfa', 'the first click previews (R103)');
  await page.keyboard.press('Escape');
  // A double-click on plain text still selects the word.
  const pt = await wordPoint(block(page, 1), 'Hlavní');
  assert.ok(pt, 'the word "Hlavní"');
  await page.mouse.dblclick(pt!.x, pt!.y);
  await sleep(200);
  assert.equal(await page.evaluate(() => (window.getSelection()?.toString() ?? '').normalize('NFC').trim()), 'Hlavní', 'a double-click on plain text selects the word');
  assert.equal(await previewCount(page), 0, 'no preview from a double-click on text');
  const from = await callCount(core);
  await chip.dblclick();
  await mustBeOn(page, 'Projekt Alfa', 'a double-click on the chip opens Projekt Alfa (FR-LNK-11 AC-6)', 5000);
  assert.equal(await previewCount(page), 0, 'no popover is left');
  const navs = (await callsFrom(core, from)).filter((c) => c.cmd === 'nav_opened').map(pathOf);
  assert.deepEqual(navs, [PV.alfa], 'nav_opened exactly once, for Projekt Alfa');
  assert.deepEqual(await noteWrites(core, ODKAZY), [], 'Odkazy is not written');
  assert.equal(await fileText(core, ODKAZY), original(ODKAZY), 'Odkazy unchanged');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-3

test('fr_lnk_13_ac3_cmd_enter_opens_and_alt_space_previews_with_the_caret_at_the_chip', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa"');
  // ⌥Space with the caret directly before the chip (the chip after the caret).
  await mustCaret(block(page, 7), 'Projekt ', 'before the chip');
  assert.equal(await caretRel(chip), 'before', 'caret directly before the chip');
  await page.keyboard.press('Alt+Space');
  const dlg = await needPreview(page, 'Projekt Alfa', '⌥Space with the caret before the chip');
  assert.equal(await focusInside(dlg), true, 'the focus moves into the preview');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => previewCount(page), (n) => n === 0, 1500), 0, 'Esc closes it');
  assert.equal(await focusInside(editorBody(page)), true, 'the focus is back in the editor');
  assert.equal(await caretRel(chip), 'before', 'Esc puts the caret back where it was');
  // ⌥Space with the caret directly after the chip.
  await mustCaret(block(page, 7), null, 'end of paragraph 7');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await caretRel(chip), 'after', 'caret directly after the chip');
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Projekt Alfa', '⌥Space with the caret after the chip');
  await page.keyboard.press('Escape');
  assert.equal(await caretRel(chip), 'after', 'Esc puts the caret back after the chip');
  assert.deepEqual(await noteWrites(core), [], 'previews write nothing');
  // ⌘↩ at the chip opens it (D-209, unchanged).
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Projekt Alfa', '⌘↩ with the caret after the chip opens Projekt Alfa', 5000);
  assert.equal(await previewCount(page), 0, '⌘↩ opens, no preview');
});

test('fr_lnk_13_ac3_away_from_a_chip_alt_space_passes_through_and_cmd_enter_does_nothing', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  // At a chip ⌥Space is consumed and previews …
  await mustCaret(block(page, 1), 'Hlavní ', 'before the chip in paragraph 1');
  await recordKeydowns(page);
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Rozpočet 2027', '⌥Space at the chip');
  const atChip = (await keydowns(page)).filter((k) => k.code === 'Space' && k.alt);
  assert.ok(atChip.length === 1 && (!atChip[0].reached || atChip[0].prevented), `⌥Space at a chip is consumed (D-928): ${JSON.stringify(atChip)}`);
  await page.keyboard.press('Escape');
  // … elsewhere it is not handled, so macOS types what the layout gives (U+00A0 on the U.S. and Czech layouts).
  await mustCaret(block(page, 1), 'Hlav', 'inside the word "Hlavní"');
  await recordKeydowns(page);
  await page.keyboard.press('Alt+Space');
  await sleep(300);
  assert.equal(await previewCount(page), 0, '⌥Space away from a chip shows no preview');
  const away = (await keydowns(page)).filter((k) => k.code === 'Space' && k.alt);
  assert.deepEqual(away.map((k) => ({ reached: k.reached, prevented: k.prevented })), [{ reached: true, prevented: false }], '⌥Space away from a chip passes through (not prevented)');
  // ⌘↩ with the caret not at a chip: Odkazy has no checklist, so nothing happens.
  const from = await callCount(core);
  await page.keyboard.press('Meta+Enter');
  await sleep(300);
  assert.equal(await mainName(page), 'Odkazy', '⌘↩ away from a chip opens nothing');
  assert.deepEqual((await cmdsFrom(core, from)).filter((c) => c === 'nav_opened'), [], 'no nav_opened');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-4

test('fr_lnk_13_ac4_the_link_is_reached_and_handled_by_keyboard_only', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa"');
  // From the start of paragraph 7, End then ← …
  await mustCaret(block(page, 7), null, 'start of paragraph 7', true);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await caretRel(chip), 'after', 'End then ← reaches the position after the chip');
  // … or → repeatedly ("Projekt " is 8 positions, the chip one).
  await mustCaret(block(page, 7), null, 'start of paragraph 7', true);
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await caretRel(chip), 'after', '→ nine times reaches the position after the chip');
  // Preview, edit and remove without the pointer.
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Projekt Alfa', '⌥Space');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+k');
  await must(editLinkDialog(page), '⇧⌘K opens "Edit link"');
  await page.keyboard.press('Escape');
  assert.equal(await seen(editLinkDialog(page), 300), false, 'Esc closes the dialog');
  assert.deepEqual(await noteWrites(core), [], 'nothing written so far');
  await runCommand(page, 'Remove link');
  const t = await savedOdkazy(page, core, 'Remove link from the palette');
  sameBut(t, ODKAZY, ODK.p7, 'Projekt Projekt Alfa.', 'Remove link by keyboard');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-5

test('fr_lnk_13_ac5_right_click_on_a_chip_opens_the_link_menu_in_order', async ({ page }) => {
  await openPv(page, ODKAZY);
  const { prevented, menu } = await openLinkMenu(page, chipIn(page, 1, 'Rozpočet 2027'), 'right-click on Rozpočet 2027');
  assert.equal(prevented, true, 'the system menu is not shown (contextmenu prevented)');
  const { items, separatorsAfter } = await menuItems(menu);
  assert.deepEqual(items, LINK_ITEMS, 'Open, Show preview, separator, Edit link, Remove link');
  assert.deepEqual(separatorsAfter, ['Show preview'], 'one separator, after Show preview');
  const open = await menuItem(page, 'Open');
  assert.match(flat(await open.innerText()), /⌘↩$/, 'Open shows ⌘↩');
  const show = await menuItem(page, 'Show preview');
  assert.match(flat(await show.innerText()), /⌥\s*(Space|␣)$/, 'Show preview shows ⌥Space');
  // A right-click on a text selection keeps the Selection menu (editor.md FR-EDT-05 AC-7).
  await page.keyboard.press('Escape');
  const pt = await wordPoint(block(page, 1), 'Hlavní');
  assert.ok(pt, 'the word "Hlavní"');
  await page.mouse.dblclick(pt!.x, pt!.y);
  await sleep(150);
  await rightClick(page, null);
  await must(selectionMenu(page), 'menu "Selection" on a text selection', 1500);
  assert.equal(await seen(linkMenu(page), 300), false, 'no Link menu on a selection');
});

test('fr_lnk_13_ac5_link_menu_arrows_enter_and_esc', async ({ page }) => {
  await openPv(page, ODKAZY);
  const chip = chipIn(page, 1, 'Rozpočet 2027');
  await openLinkMenu(page, chip, 'right-click');
  // ↑/↓ move between the items.
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    order.push(await focusedName(page));
    await page.keyboard.press('ArrowDown');
    await sleep(40);
  }
  const strip = (s: string) => LINK_ITEMS.find((x) => s === x || s.startsWith(`${x} `)) ?? s;
  const seenItems = order.map(strip);
  assert.ok(LINK_ITEMS.every((x) => seenItems.includes(x)), `↓ moves through the four items: ${JSON.stringify(order)}`);
  // Esc closes and puts the caret after the chip.
  await page.keyboard.press('Escape');
  assert.equal(await seen(linkMenu(page), 300), false, 'Esc closes the menu');
  assert.equal(await caretRel(chip), 'after', 'Esc puts the caret after the chip');
  // ⏎ runs the focused item.
  await openLinkMenu(page, chip, 'right-click again');
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) {
    if (strip(await focusedName(page)) === 'Show preview') ok = true;
    else await page.keyboard.press('ArrowDown');
  }
  assert.ok(ok, 'Show preview reached with ↓');
  await page.keyboard.press('Enter');
  await needPreview(page, 'Rozpočet 2027', '⏎ on Show preview');
  assert.equal(await seen(linkMenu(page), 200), false, 'the menu is closed (one popup at a time)');
});

test('fr_lnk_13_ac5_the_read_view_menu_has_only_open_and_show_preview', async ({ page }) => {
  await openPv(page, ODKAZY, { readView: true });
  const chip = await must(main(page).getByRole('link', { name: 'Rozpočet 2027', exact: true }), 'read-view chip Rozpočet 2027');
  const prevented = await rightClick(page, chip);
  const menu = await must(linkMenu(page), 'menu "Link" in the read view', 1500);
  assert.equal(prevented, true, 'system menu not shown');
  assert.deepEqual((await menuItems(menu)).items, ['Open', 'Show preview'], 'read view: Open and Show preview only');
});

test('fr_lnk_13_ac5_a_read_only_note_menu_has_only_open_and_show_preview', async ({ page }) => {
  // A read-only note (NFR-REL-03 AC-6: invalid frontmatter), in its read view.
  await openPv(page, PV.neplatna, { readView: true });
  const fmt = main(page).getByRole('button', { name: 'Show formatted note', exact: true });
  if (await seen(fmt, 1500)) await fmt.click();
  const c2 = await must(main(page).getByRole('link', { name: 'Rozpočet 2027', exact: true }), 'chip Rozpočet 2027 in Neplatná hlavička');
  await rightClick(page, c2);
  const m2 = await must(linkMenu(page), 'menu "Link" in a read-only note', 1500);
  assert.deepEqual((await menuItems(m2)).items, ['Open', 'Show preview'], 'read-only note: Open and Show preview only');
});

test('fr_lnk_13_ac5_a_broken_chip_menu_offers_create_instead_of_open_and_preview', async ({ page }) => {
  await openPv(page, ODKAZY);
  const { menu } = await openLinkMenu(page, chipIn(page, 13, 'Neexistuje'), 'right-click on the broken chip Neexistuje');
  const { items } = await menuItems(menu);
  assert.deepEqual(items, ['Create "Neexistuje"', 'Edit link', 'Remove link'], 'broken chip: Create "<target>", Edit link, Remove link (D-927)');
  await (await menuItem(page, 'Create "Neexistuje"')).click();
  await must(createOffer(page), 'Create "Neexistuje" opens the Create offer (ms4-links)', 1500);
  assert.equal(await previewCount(page), 0, 'never a preview for a broken link');
});

test('fr_lnk_13_ac5_the_palette_has_edit_link_and_remove_link', async ({ page }) => {
  await openPv(page, ODKAZY);
  await mustCaret(block(page, 2), 'S popisem ', 'before the alias chip');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  const rows: Record<string, string> = {};
  for (const title of ['Edit link', 'Remove link']) {
    await page.getByRole('combobox', { name: 'Command query' }).fill(title);
    await sleep(80);
    rows[title] = ((await paletteOptions(page)).find((r) => r.split('\n')[0].trim() === title) ?? '').replace(/\s+/g, '');
  }
  assert.ok(rows['Edit link'].startsWith('Editlink'), `the palette lists "Edit link": ${rows['Edit link']}`);
  assert.ok(rows['Edit link'].endsWith('⇧⌘K'), `"Edit link" shows ⇧⌘K: ${rows['Edit link']}`);
  assert.ok(rows['Remove link'].startsWith('Removelink'), `the palette lists "Remove link": ${rows['Remove link']}`);
  // Run with the caret at a chip: Edit link opens the dialog for that chip.
  await page.getByRole('combobox', { name: 'Command query' }).fill('Edit link');
  await sleep(80);
  await page.keyboard.press('Enter');
  const dlg = await must(editLinkDialog(page), 'palette "Edit link" opens the dialog');
  assert.equal(await fieldValue(await must(field(dlg, 'Link to'), 'field Link to')), 'Rozpočet 2027', 'for the chip at the caret');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-6

async function openEditLink(page: Page) {
  const { menu } = await openLinkMenu(page, chipIn(page, 2, 'rozpočet'), 'right-click on the alias chip');
  void menu;
  await (await menuItem(page, 'Edit link')).click();
  return must(editLinkDialog(page), 'dialog "Edit link"');
}

test('fr_lnk_13_ac6_edit_link_dialog_fields_and_a_new_target_in_one_undo_step', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const dlg = await openEditLink(page);
  assert.notEqual(await dlg.getAttribute('aria-modal'), 'true', 'non-modal');
  const chip = chipIn(page, 2, 'rozpočet');
  const c = (await chip.boundingBox())!, d = (await dlg.boundingBox())!;
  assert.ok(d.y >= c.y + c.height - 1 || d.y + d.height <= c.y + 1, 'anchored to the chip (below or above it, not covering it)');
  const to = await must(field(dlg, 'Link to'), 'field "Link to"');
  const text = await must(field(dlg, 'Link text'), 'field "Link text"');
  assert.equal(await fieldValue(to), 'Rozpočet 2027', 'Link to: Rozpočet 2027');
  assert.equal(await fieldValue(text), 'rozpočet', 'Link text: rozpočet');
  await to.fill('Projekt Alfa');
  const opt = await must(linkSuggestions(page).getByRole('option', { name: /^Projekt Alfa/ }), 'the link suggestions list Projekt Alfa (editor.md FR-EDT-06)');
  await opt.click();
  assert.equal(await fieldValue(to), 'Projekt Alfa', 'Projekt Alfa chosen');
  await to.focus();
  await page.keyboard.press('Enter');
  assert.equal(await seen(editLinkDialog(page), 500).then((s) => !s), true, '⏎ applies and closes the dialog');
  const t = await savedOdkazy(page, core, 'Edit link');
  sameBut(t, ODKAZY, ODK.p2, 'S popisem [[Projekt Alfa|rozpočet]].', 'Edit link to Projekt Alfa');
  assert.equal((await noteWrites(core)).length >= 1 && (await noteWrites(core)).every((w) => pathOf(w) === ODKAZY), true, 'only Odkazy is written');
  await mustCaret(block(page, 1), null, 'somewhere in the editor');
  await page.keyboard.press('Meta+z');
  await mustBeSaved(page, 4000);
  const back = await fileWhen(core, ODKAZY, (x) => noModified(x) === noModified(original(ODKAZY)), 3000);
  assert.equal(noModified(back), noModified(original(ODKAZY)), 'one ⌘Z undoes the whole edit (one undo step)');
});

test('fr_lnk_13_ac6_clearing_link_text_writes_the_bare_link', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const dlg = await openEditLink(page);
  const text = await must(field(dlg, 'Link text'), 'field "Link text"');
  await text.fill('');
  await text.focus();
  await page.keyboard.press('Enter');
  const t = await savedOdkazy(page, core, 'cleared Link text');
  sameBut(t, ODKAZY, ODK.p2, 'S popisem [[Rozpočet 2027]].', 'clearing Link text');
});

test('fr_lnk_13_ac6_esc_in_edit_link_changes_nothing', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const dlg = await openEditLink(page);
  await (await must(field(dlg, 'Link text'), 'field "Link text"')).fill('jiný text');
  await page.keyboard.press('Escape');
  if (await seen(editLinkDialog(page), 300)) await page.keyboard.press('Escape'); // the first Esc may close the suggestions
  assert.equal(await seen(editLinkDialog(page), 500), false, 'Esc closes the dialog');
  await sleep(1200); // past the autosave delay
  assert.deepEqual(await noteWrites(core), [], 'Esc changes nothing: no note_write');
  assert.equal(await fileText(core, ODKAZY), original(ODKAZY), 'Odkazy unchanged');
});

test('fr_lnk_13_ac6_shift_cmd_k_at_a_chip_opens_the_same_dialog', async ({ page }) => {
  await openPv(page, ODKAZY);
  await mustCaret(block(page, 2), 'S popisem ', 'caret directly before the alias chip');
  await page.keyboard.press('Meta+Shift+k');
  const dlg = await must(editLinkDialog(page), '⇧⌘K with the caret at a chip opens "Edit link"');
  assert.equal(await fieldValue(await must(field(dlg, 'Link to'), 'Link to')), 'Rozpočet 2027', 'Link to of the chip at the caret');
  assert.equal(await fieldValue(await must(field(dlg, 'Link text'), 'Link text')), 'rozpočet', 'Link text of the chip at the caret');
});

test('fr_lnk_13_ac6_a_shared_title_target_is_written_by_its_path_d184', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const dlg = await openEditLink(page);
  const to = await must(field(dlg, 'Link to'), 'field "Link to"');
  await to.fill('Plán');
  // Two objects share the title (FR-LNK-14): the Quick Note one is written by its vault path (D-184: stem, else path).
  const opt = await must(linkSuggestions(page).getByRole('option').filter({ hasText: 'Quick Note' }).filter({ hasText: 'Plán' }), 'suggestion "Plán" (Quick Note)');
  await opt.click();
  await to.focus();
  await page.keyboard.press('Enter');
  const t = await savedOdkazy(page, core, 'Edit link to the Quick Note Plán');
  sameBut(t, ODKAZY, ODK.p2, 'S popisem [[Quick Notes/Plán|rozpočet]].', 'a shared title is written as the vault path');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-7

test('fr_lnk_13_ac7_remove_link_on_the_alias_chip_keeps_its_text', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  await openLinkMenu(page, chipIn(page, 2, 'rozpočet'), 'right-click on the alias chip');
  await (await menuItem(page, 'Remove link')).click();
  const t = await savedOdkazy(page, core, 'Remove link');
  sameBut(t, ODKAZY, ODK.p2, 'S popisem rozpočet.', 'Remove link on [[Rozpočet 2027|rozpočet]]');
  await page.keyboard.press('Meta+z');
  await mustBeSaved(page, 4000);
  const back = await fileWhen(core, ODKAZY, (x) => noModified(x) === noModified(original(ODKAZY)), 3000);
  assert.equal(noModified(back), noModified(original(ODKAZY)), 'one undo step');
});

test('fr_lnk_13_ac7_remove_link_on_projekt_alfa', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  await openLinkMenu(page, chipIn(page, 7, 'Projekt Alfa'), 'right-click on Projekt Alfa');
  await (await menuItem(page, 'Remove link')).click();
  const t = await savedOdkazy(page, core, 'Remove link');
  sameBut(t, ODKAZY, ODK.p7, 'Projekt Projekt Alfa.', 'Remove link on [[Projekt Alfa]]');
  assert.deepEqual([...new Set((await noteWrites(core)).map(pathOf))], [ODKAZY], 'only Odkazy is written');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-8

test('fr_lnk_13_ac8_inside_a_full_embed_previews_menu_alt_space_edit_link_and_cmd_enter_act_on_the_embedded_note', async ({ page }) => {
  const core = await openPv(page, PV.vlozeni);
  const f = await needFrame(main(page), 'Rozpočet 2027', 'the full embed of Rozpočet 2027');
  const inner = await must(embedTextbox(f, 'Rozpočet 2027'), 'the embedded editor of Rozpočet 2027', 5000);
  const chip = await must(inner.getByRole('link', { name: 'Jana Nováková', exact: true }), 'chip Jana Nováková inside the embed');
  await chip.click();
  await needPreview(page, 'Jana Nováková', 'a click on the chip inside the embed');
  await page.keyboard.press('Escape');
  await rightClick(page, chip);
  const menu = await must(linkMenu(page), 'menu "Link" inside the embed', 1500);
  assert.deepEqual((await menuItems(menu)).items, LINK_ITEMS, 'the same menu in the embedded editor');
  await page.keyboard.press('Escape');
  await mustCaret(inner, 'Odpovídá ', 'before the chip inside the embed');
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Jana Nováková', '⌥Space at the chip inside the embed');
  await page.keyboard.press('Escape');
  await mustCaret(inner, 'Odpovídá ', 'before the chip inside the embed');
  await page.keyboard.press('Meta+Shift+k');
  const dlg = await must(editLinkDialog(page), '⇧⌘K inside the embed');
  const text = await must(field(dlg, 'Link text'), 'Link text');
  await text.fill('Jana');
  await text.focus();
  await page.keyboard.press('Enter');
  const t = await fileWhen(core, PV.rozpocet, (x) => !!x?.includes('[[Jana Nováková|Jana]]'), 4000);
  const from = 'Odpovídá [[Jana Nováková]].';
  assert.equal(noModified(t), noModified(original(PV.rozpocet).replace(from, 'Odpovídá [[Jana Nováková|Jana]].')), 'Pages/Rozpočet 2027.md gets the edit');
  assert.deepEqual([...new Set((await noteWrites(core)).map(pathOf))], [PV.rozpocet], 'only Rozpočet is written; Vložení is not (FR-EMB-03)');
  assert.equal(await fileText(core, PV.vlozeni), original(PV.vlozeni), 'Vložení unchanged');
  await mustCaret(inner, 'Odpovídá ', 'before the chip again');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Jana Nováková', '⌘↩ at the chip inside the embed opens Jana', 5000);
});

test('fr_lnk_13_ac8_remove_link_inside_a_full_embed_saves_only_the_embedded_note', async ({ page }) => {
  const core = await openPv(page, PV.vlozeni);
  const f = await needFrame(main(page), 'Rozpočet 2027', 'the full embed of Rozpočet 2027');
  const inner = await must(embedTextbox(f, 'Rozpočet 2027'), 'the embedded editor', 5000);
  const chip = await must(inner.getByRole('link', { name: 'Jana Nováková', exact: true }), 'chip Jana Nováková inside the embed');
  await rightClick(page, chip);
  await must(linkMenu(page), 'menu "Link" inside the embed', 1500);
  await (await menuItem(page, 'Remove link')).click();
  const t = await fileWhen(core, PV.rozpocet, (x) => !!x && !x.includes('[[Jana Nováková]]'), 4000);
  assert.equal(noModified(t), noModified(original(PV.rozpocet).replace('Odpovídá [[Jana Nováková]].', 'Odpovídá Jana Nováková.')), 'Remove link saves Pages/Rozpočet 2027.md');
  assert.deepEqual([...new Set((await noteWrites(core)).map(pathOf))], [PV.rozpocet], 'Vložení isn\'t written');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-13 AC-9

const MAPA = 'Plán 2027';

test('fr_lnk_13_ac9_mindmap_node_chip_click_previews_double_click_opens_and_lide_opens_edit_node', async ({ page }) => {
  const core = await openPv(page, PV.mapa);
  const fig = await must(figure(page, MAPA), `figure "Mindmap: ${MAPA}"`, 5000);
  if ((await viewOf(fig)) !== 'map') await (await must(mapBtn(fig), 'button Map')).click();
  const rozNode = await must(node(fig, 'Rozpočet 2027'), 'node Rozpočet 2027');
  const chip = await must(rozNode.getByRole('link', { name: 'Rozpočet 2027' }).or(rozNode.locator('[data-preview-ref]')).first(), 'the node chip Rozpočet 2027');
  const from = await callCount(core);
  await chip.click();
  await needPreview(page, 'Rozpočet 2027', 'a click on the node chip');
  assert.equal(await viewOf(fig), 'map', 'the figure doesn\'t switch to List');
  assert.equal(await mainName(page), 'Mapa', 'no route change');
  assert.deepEqual((await cmdsFrom(core, from)).filter((c) => c === 'nav_opened'), [], 'no nav_opened');
  await page.keyboard.press('Escape');
  // A double-click on the node outside the chip opens `Edit node` as today (FR-MMP-02 AC-24, AP-823).
  await (await must(node(fig, 'Lidé'), 'node Lidé')).dblclick();
  await must(fig.getByRole('textbox', { name: 'Edit node', exact: true }).or(page.getByRole('textbox', { name: 'Edit node', exact: true })), 'a double-click on Lidé opens "Edit node"', 1500);
  await page.keyboard.press('Escape');
  await sleep(150);
  // A double-click on the chip opens Rozpočet.
  await chip.dblclick();
  await mustBeOn(page, 'Rozpočet 2027', 'a double-click on the node chip opens Rozpočet', 5000);
  assert.equal(await previewCount(page), 0, 'no popover left');
  assert.equal(await fileText(core, PV.mapa), original(PV.mapa), 'Mapa unchanged');
});

test('fr_lnk_13_ac9_alt_space_and_cmd_enter_on_a_focused_node', async ({ page }) => {
  await openPv(page, PV.mapa);
  const fig = await must(figure(page, MAPA), `figure "Mindmap: ${MAPA}"`, 5000);
  if ((await viewOf(fig)) !== 'map') await (await must(mapBtn(fig), 'button Map')).click();
  const jana = await must(node(fig, 'Jana Nováková'), 'node Jana Nováková');
  await jana.focus();
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Jana Nováková', '⌥Space on a focused node with a link previews its first link');
  await page.keyboard.press('Escape');
  const roz = await must(node(fig, 'Rozpočet 2027'), 'node Rozpočet 2027');
  await roz.focus();
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Rozpočet 2027', '⌘↩ on the focused node opens its first link (FR-MMP-02 AC-8)', 5000);
});

test('fr_lnk_13_ac9_a_click_on_a_chip_in_the_read_view_map_previews', async ({ page }) => {
  await openPv(page, PV.mapa, { readView: true });
  const rfig = await must(figure(page, MAPA), 'the read view\'s map', 5000);
  const rnode = await must(node(rfig, 'Rozpočet 2027'), 'read-view node Rozpočet 2027');
  const rchip = await must(rnode.getByRole('link', { name: 'Rozpočet 2027' }).or(rnode.locator('[data-preview-ref]')).first(), 'read-view node chip');
  await rchip.click();
  await needPreview(page, 'Rozpočet 2027', 'a click on the read-view map chip');
  assert.equal(await mainName(page), 'Mapa', 'no route change');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-7

test('fr_lnk_12_ac7_enter_in_the_editor_splits_the_paragraph_at_a_chip', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const chip = await must(chipIn(page, 7, 'Projekt Alfa'), 'chip "Projekt Alfa"');
  // The chip is a reference in click mode: a click previews …
  await chip.click();
  await needPreview(page, 'Projekt Alfa', 'click mode');
  await page.keyboard.press('Escape');
  // … but ⏎ in the editor is never a link key (D-929): with the caret after the chip it splits the paragraph.
  await mustCaret(block(page, 7), null, 'end of paragraph 7');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await caretRel(chip), 'after', 'caret after the chip');
  const from = await callCount(core);
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.equal(await previewCount(page), 0, '⏎ shows no preview');
  assert.equal(await mainName(page), 'Odkazy', '⏎ opens nothing');
  assert.deepEqual((await cmdsFrom(core, from)).filter((c) => c === 'nav_opened' || c === 'embed_load'), [], 'no nav_opened or embed_load from ⏎');
  const t = await savedOdkazy(page, core, '⏎ after the chip');
  sameBut(t, ODKAZY, ODK.p7, 'Projekt [[Projekt Alfa]]\n\n.', '⏎ splits the paragraph after the chip');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-37 (L5)

test('fr_syn_06_ac37_previews_in_the_editor_write_nothing_then_remove_link_writes_once', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  const from = await callCount(core);
  const tour: [number, string, string][] = [
    [1, 'Rozpočet 2027', 'Rozpočet 2027'], [2, 'rozpočet', 'Rozpočet 2027'], [6, 'Jana Nováková', 'Jana Nováková'], [6, 'Petr Dvořák', 'Petr Dvořák'],
    [7, 'Projekt Alfa', 'Projekt Alfa'], [8, 'Zavolat Janě', 'Zavolat Janě'], [9, '2026-10-07', '2026-10-07'], [9, '2026-10-30', '2026-10-30'],
    [12, 'Plán', 'Plán'], [14, 'Prázdná', 'Prázdná'], [15, 'Kruh A', 'Kruh A'], [18, 'Nápad na podcast', 'Nápad na podcast'],
  ];
  for (const [n, name, title] of tour) {
    const chip = await must(chipIn(page, n, name).first(), `chip "${name}" in paragraph ${n}`);
    await chip.click();
    await needPreview(page, title, `click on ${name}`);
    await page.keyboard.press('Escape');
    await sleep(80);
  }
  // ⌥Space at a chip too.
  await mustCaret(block(page, 7), 'Projekt ', 'before Projekt Alfa');
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Projekt Alfa', '⌥Space');
  await page.keyboard.press('Escape');
  await sleep(1200); // past the autosave delay
  assert.deepEqual(await noteWrites(core, undefined, from), [], 'previews send 0 note_write');
  assert.deepEqual(await writeCmds(core, from), [], 'and no other write command');
  // Then one Remove link on [[Projekt Alfa]]: exactly one note_write.
  await openLinkMenu(page, chipIn(page, 7, 'Projekt Alfa'), 'right-click on Projekt Alfa');
  await (await menuItem(page, 'Remove link')).click();
  await savedOdkazy(page, core, 'Remove link');
  await sleep(1200);
  const w = await noteWrites(core, undefined, from);
  assert.equal(w.length, 1, `exactly 1 note_write after Remove link (got ${w.length})`);
  assert.equal(pathOf(w[0]), ODKAZY, 'of Pages/Odkazy.md');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-19 (L5)

test('fr_ux_03_ac19_show_preview_edit_link_and_remove_link_need_a_chip_and_show_no_error', async ({ page }) => {
  const core = await openPv(page, ODKAZY);
  // The palette lists Show preview with ⌥Space, the only new shortcut.
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Show preview');
  await sleep(80);
  const row = ((await paletteOptions(page)).find((r) => r.split('\n')[0].trim() === 'Show preview') ?? '').replace(/\s+/g, ' ').trim();
  assert.match(row, /^Show preview.*⌥\s*(Space|␣)$/, `the palette lists "Show preview" with ⌥Space: ${JSON.stringify(row)}`);
  await page.keyboard.press('Escape');
  // With the caret in plain text, none of the three acts and none shows an error.
  for (const cmd of ['Show preview', 'Edit link', 'Remove link']) {
    await mustCaret(block(page, 3), 'Sek', `inside the word "Sekce" (before ${cmd})`);
    await runCommand(page, cmd);
    await sleep(300);
    assert.equal(await previewCount(page), 0, `${cmd}: no preview`);
    assert.equal(await seen(editLinkDialog(page), 200), false, `${cmd}: no Edit link dialog`);
    assert.equal(await page.getByRole('alert').count(), 0, `${cmd}: no error`);
    if (await seen(paletteDialog(page), 200)) await page.keyboard.press('Escape');
  }
  await sleep(1200);
  assert.deepEqual(await noteWrites(core), [], 'nothing written');
  assert.equal(await fileText(core, ODKAZY), original(ODKAZY), 'Odkazy unchanged');
});

test('fr_ux_03_ac19_every_control_in_an_open_preview_carries_a_command', async ({ page }) => {
  await openPv(page, ODKAZY);
  await (await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip')).click();
  const dlg = await needPreview(page, 'Rozpočet 2027', 'click');
  await must(dlg.getByRole('button', { name: 'Open Rozpočet 2027', exact: true }), 'button "Open Rozpočet 2027"');
  await must(dlg.getByRole('button', { name: 'Close preview', exact: true }), 'button "Close preview"');
  await must(dlg.locator('[data-preview-resize][role="button"]'), 'the resize handle');
  assert.deepEqual(await controlsWithoutCommand(dlg), [], 'FR-UX-03 AC-8: every control of the popover carries a command id');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-14

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac14_link_menu_edit_link_dialog_and_open_focus_in_${theme}`, async ({ page }) => {
    await openPv(page, ODKAZY, { theme });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `theme ${theme}`);
    const { menu } = await openLinkMenu(page, chipIn(page, 1, 'Rozpočet 2027'), 'right-click');
    assert.deepEqual(await axeContrastIn(page, menu), [], `${theme}: axe color-contrast in the Link menu`);
    assert.deepEqual(await colourLeaksIn(menu, theme), [], `${theme}: the Link menu uses only theme tokens (FR-UX-05 AC-5)`);
    await page.keyboard.press('Escape');
    await mustCaret(block(page, 2), 'S popisem ', 'before the alias chip');
    await page.keyboard.press('Meta+Shift+k');
    const dlg = await must(editLinkDialog(page), 'dialog "Edit link"');
    assert.deepEqual(await axeContrastIn(page, dlg), [], `${theme}: axe color-contrast in the Edit link dialog`);
    assert.deepEqual(await colourLeaksIn(dlg, theme), [], `${theme}: the Edit link dialog uses only theme tokens`);
    await page.keyboard.press('Escape');
    if (await seen(editLinkDialog(page), 200)) await page.keyboard.press('Escape');
    // The focused Open button shows the focus outline (D-594).
    await mustCaret(block(page, 1), 'Hlavní ', 'before the chip');
    await page.keyboard.press('Alt+Space');
    const pv = await needPreview(page, 'Rozpočet 2027', '⌥Space');
    assert.ok(await tabTo(page, 'Open Rozpočet 2027'), 'Tab reaches "Open Rozpočet 2027"');
    const o = await focusOutline(page);
    const focus = await tokenColour(page, 'focus');
    assert.ok(o.style !== 'none' && o.width >= 2 && o.color === focus, `${theme}: the focused Open shows a ≥ 2 px outline in the focus token ${focus}: ${JSON.stringify(o)}`);
    assert.deepEqual(await axeContrastIn(page, pv), [], `${theme}: axe color-contrast in the popover`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-11 (L5)

test('nfr_oth_02_ac11_link_menu_and_edit_link_dialog_are_catalog_strings', async ({ page }) => {
  await openPv(page, ODKAZY, { prelude: pseudoLocale });
  const chip = await must(chipIn(page, 1, 'Rozpočet 2027'), 'chip');
  await rightClick(page, chip);
  const menu = await must(linkMenu(page), 'menu "⟦Link⟧" (pseudo-locale)', 1500);
  assert.match((await menu.getAttribute('aria-label')) ?? '', /^⟦Link⟧$/, 'the menu name is a catalog string');
  assert.deepEqual(await unmarkedIn(menu), [], 'every text and accessible name of the Link menu is inside ⟦ ⟧');
  await page.keyboard.press('Escape');
  await mustCaret(block(page, 2), 'S popisem ', 'before the alias chip');
  await page.keyboard.press('Meta+Shift+k');
  const dlg = await must(editLinkDialog(page), 'dialog "⟦Edit link⟧"');
  assert.deepEqual(await unmarkedIn(dlg), [], 'every text and accessible name of the Edit link dialog is inside ⟦ ⟧ (field values are user content)');
  assert.ok(await seen(field(dlg, 'Link to'), 500), 'the field "⟦Link to⟧"');
  assert.ok(await seen(field(dlg, 'Link text'), 500), 'the field "⟦Link text⟧"');
});

// Silence unused-import lint for helpers used only in some branches.
void anyPreview; void previewOf; void caretAt;
