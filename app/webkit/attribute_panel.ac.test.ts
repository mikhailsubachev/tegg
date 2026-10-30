// MS3 slice 3D, L5 (WebKit + fake core): the editable attribute panel on the note route. FR-EDT-07 AC-1…AC-4, AC-6,
// AC-7, AC-9…AC-14, AC-16, AC-17; FR-TYP-08 AC-7…AC-12; FR-TYP-02 AC-3, AC-4; FR-TYP-03 AC-3 (panel side).
// Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.6, §14.7 only (D-61). Values are checked
// by the bytes the fake core receives (`note_write`); `modified` is masked where its value doesn't matter.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { editorVault } from './editor-helpers';
import { focused, mainName, mustBeOn, switcherDialog, escPreview, mustNoPreview, mustPreview, switchPreviewMode } from './helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import {
  P, append, callsOf, control, description, dialog, eventually, fileText, isDisabled, lastWrite, main, must, noModified, nonReadCalls,
  dateOpener, openDatePicker, openNoteByTitle, openTypes, pickNoDate, pickTyped, original, otherProps, props, runCommand, seen, sleep, swap, typeFile, typesVault,
} from './types-helpers';
import { goToListbox, goToQuery } from './helpers'; // D-760: the Search page's Go to list replaces ⌘O

const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
const subtitle = (page: Page) => page.getByRole('textbox', { name: 'Description', exact: true });
/** Waits for a note_write of `path` whose text satisfies `ok`. */
async function written(core: Awaited<ReturnType<typeof openTypes>>, path: string, ok: (t: string) => boolean, ms = 2000): Promise<string | null> {
  return eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
}
async function textControl(page: Page, name: string) {
  return must(control(page, 'textbox', name), `panel textbox "${name}"`);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-07

test('fr_edt_07_ac1_rows_in_order_between_title_and_body', async ({ page }) => {
  await openTypes(page, P.porada);
  const region = await must(props(page), 'region Properties');
  await must(control(page, 'textbox', 'Místo'), 'Místo is an editable control (3D panel)');
  const [t, r, b] = [await titleField(page).boundingBox(), await region.boundingBox(), await editorBody(page).boundingBox()];
  assert.ok(t && r && b && t.y < r.y && r.y + r.height <= b.y + 1, 'between the title and the body');
  const text = await region.innerText();
  const order = ['Datum', 'Začátek', 'Účastníci', 'Projekt', 'Místo', 'Tags', 'Aliases', 'Source', 'Created', 'Modified', 'Other properties (1)'];
  const pos = order.map((l) => text.indexOf(l));
  assert.ok(pos.every((p) => p >= 0), `every row shown: ${order.filter((_, i) => pos[i] < 0).join(', ')}`);
  assert.deepEqual([...pos].sort((x, y) => x - y), pos, 'schema order, then Tags, Aliases, Source, Created, Modified, then Other properties');
  assert.ok(!/\bReview\b/.test(text), 'no Review row (workflow off, no review key)');
  for (const hidden of ['01JB0T0000000000000000T001', 'type', 'title']) assert.ok(!new RegExp(`(^|\\n)${hidden}(\\n|$)`).test(text), `${hidden} hidden`);
});

test('fr_edt_07_ac1_empty_rows_are_focusable', async ({ page }) => {
  await openTypes(page, P.prazdna);
  const empties = (await must(props(page), 'Properties')).getByText('Empty', { exact: true });
  await must(control(page, 'textbox', 'Místo'), 'the 3D panel');
  assert.ok((await empties.count()) >= 5, 'each schema row shows Empty');
  for (let i = 0; i < 5; i++) {
    const host = empties.nth(i).locator('xpath=ancestor-or-self::*[@tabindex or self::button or self::input][1]');
    assert.ok((await host.count()) > 0, `Empty #${i + 1} is focusable`);
  }
});

test('fr_edt_07_ac2_other_properties_collapsed_and_read_only', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const btn = await must(otherProps(page), 'Other properties (n)');
  assert.equal((await btn.innerText()).trim(), 'Other properties (1)');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'collapsed by default');
  await btn.click();
  const list = await must(page.getByRole('list', { name: 'Other properties' }), 'list Other properties');
  assert.ok((await list.innerText()).includes('nálada') && (await list.innerText()).includes('dobrá'));
  assert.equal(await list.locator('input, textarea, [contenteditable="true"], button').count(), 0, 'no control to edit, remove or add');
  const ui = await eventually(() => core.uiState(), (u: any) => u?.otherPropertiesOpen === true, 2000) as any;
  assert.equal(ui?.otherPropertiesOpen, true, 'state per machine (UI state)');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

test('fr_edt_07_ac3_only_the_edited_line_changes', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await (await textControl(page, 'Místo')).fill('Zasedačka 2');
  await page.keyboard.press('Enter');
  const t = await written(core, P.porada, (x) => x.includes('místo: Zasedačka 2'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.porada), 'místo:\n', 'místo: Zasedačka 2\n')), 'comment, nálada, flow tags, order and body byte-identical');
  assert.notEqual(/^modified: (.*)$/m.exec(t ?? '')?.[1], '2026-10-07T10:15:00+02:00', 'modified updated');
});

test('fr_edt_07_ac3_an_absent_key_is_appended', async ({ page }) => {
  const core = await openTypes(page, P.prazdna);
  await (await textControl(page, 'Místo')).fill('Zasedačka 2');
  await page.keyboard.press('Enter');
  const t = await written(core, P.prazdna, (x) => x.includes('místo:'));
  assert.equal(noModified(t ?? ''), noModified(append(original(P.prazdna), 'místo: Zasedačka 2\n')));
});

test('fr_edt_07_ac4_panel_edits_use_the_autosave_and_typing_alone_saves_nothing', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const misto = await textControl(page, 'Místo');
  await misto.fill('Rozepsáno');
  await sleep(1500);
  assert.equal((await callsOf(core, 'note_write')).length, 0, 'a field being typed in isn\'t saved');
  await misto.press('Tab');
  const t = await written(core, P.porada, (x) => x.includes('místo: Rozepsáno'), 1500);
  assert.ok(t, 'committed by Tab, saved within 1 s');
  const w = (await callsOf(core, 'note_write'))[0];
  assert.ok((w.args as any).base, 'written with the base version');
  // A body edit and a panel edit within 1 s are one write.
  const n = (await callsOf(core, 'note_write')).length;
  await editorBody(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Ž');
  await (await textControl(page, 'Místo')).fill('Brno');
  await page.keyboard.press('Enter');
  const both = await written(core, P.porada, (x) => x.includes('místo: Brno') && x.includes(' Ž'));
  assert.ok(both, 'both saved');
  assert.equal((await callsOf(core, 'note_write')).length, n + 1, 'in one note_write');
});

test('fr_edt_07_ac6_relation_chips_picker_and_written_values', async ({ page }) => {
  // D-943: the steps run with Object preview Off; click mode follows (a click previews, a double-click opens).
  const core = await openTypes(page, P.prazdna, setPreviewMode('off'));
  await (await must(props(page).getByRole('button', { name: 'Add Účastníci', exact: true }), 'Add Účastníci')).click();
  const picker = await must(dialog(page, 'Choose Účastníci'), 'picker');
  await picker.getByRole('combobox', { name: 'Search' }).fill('a');
  await sleep(150);
  const opts = (await picker.getByRole('listbox', { name: 'Results' }).getByRole('option').allInnerTexts()).map((t) => t.trim());
  assert.ok(opts.some((o) => o.startsWith('Jana Nováková')) && opts.some((o) => o.startsWith('Petr Dvořák')), 'osoba objects');
  assert.ok(!opts.some((o) => o.includes('Rozpočet') || o.includes('Porada')), 'limited to allowed types');
  assert.ok(opts[opts.length - 1].startsWith('Create "a"'), 'last row Create');
  await picker.getByRole('option', { name: /^Jana Nováková/ }).click();
  const t = await written(core, P.prazdna, (x) => x.includes('účastníci:'));
  assert.ok(t?.includes('účastníci:\n  - "[[Jana Nováková]]"\n'), `block list of quoted links: ${t}`);
  await (await must(props(page).getByRole('button', { name: 'Add Projekt', exact: true }), 'Add Projekt')).click();
  await dialog(page, 'Choose Projekt').getByRole('combobox', { name: 'Search' }).fill('Rozpočet');
  await sleep(150);
  await dialog(page, 'Choose Projekt').getByRole('option', { name: /^Rozpočet 2027/ }).click();
  assert.ok((await written(core, P.prazdna, (x) => x.includes('projekt:')))?.includes('projekt: "[[Rozpočet 2027]]"\n'), 'single relation');
  await props(page).getByRole('button', { name: 'Remove Jana Nováková', exact: true }).click();
  assert.ok(!(await written(core, P.prazdna, (x) => !x.includes('účastníci')))?.includes('účastníci'), 'removing the last removes the key');
  await props(page).getByRole('link', { name: 'Rozpočet 2027' }).click();
  await mustBeOn(page, 'Rozpočet 2027', 'a chip opens the target (D-140)');

  // Click to preview (D-943; previews.md FR-LNK-08 AC-3).
  await page.keyboard.press('Meta+BracketLeft');
  const chip = props(page).getByRole('link', { name: 'Rozpočet 2027' });
  await must(chip, 'Back: the Projekt chip Rozpočet 2027', 5000);
  const home = await mainName(page);
  await switchPreviewMode(page, core, 'click');
  const before = await lastWrite(core, P.prazdna);
  await chip.first().click();
  await mustPreview(page, 'Rozpočet 2027', 'click mode: a click on the relation chip previews it');
  assert.equal(await mainName(page), home, 'click mode: the click keeps the route');
  assert.equal(await dialog(page, 'Choose Projekt').count(), 0, 'click mode: the click opens no relation picker');
  await escPreview(page, 'click mode: the relation preview');
  assert.equal(await lastWrite(core, P.prazdna), before, 'click mode: the preview neither removes nor writes the value');
  await (await must(chip, 'the chip (double-click)')).dblclick();
  await mustBeOn(page, 'Rozpočet 2027', 'click mode: a double-click on the chip opens the target');
  await mustNoPreview(page, 'click mode: after the double-click', 300);
});

test('fr_edt_07_ac6_picker_excludes_chosen_and_creates_without_leaving', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await (await must(props(page).getByRole('button', { name: 'Add Účastníci', exact: true }), 'Add Účastníci')).click();
  const picker = await must(dialog(page, 'Choose Účastníci'), 'picker');
  await picker.getByRole('combobox', { name: 'Search' }).fill('Eva Malá');
  await sleep(150);
  const opts = (await picker.getByRole('option').allInnerTexts()).map((t) => t.trim());
  assert.ok(!opts.some((o) => o.startsWith('Jana') || o.startsWith('Petr')), 'chosen objects excluded');
  await picker.getByRole('option', { name: 'Create "Eva Malá"' }).click();
  const created = await callsOf(core, 'note_create');
  assert.equal((created[0]?.args as any)?.type, 'osoba', 'first allowed type (D-243)');
  assert.ok((await fileText(core, 'Osoby/Eva Malá.md'))?.includes('type: osoba'), 'created in Osoby/');
  assert.equal(await mainName(page), '2026-10-07 Porada', 'without leaving the note');
  assert.ok((await written(core, P.porada, (x) => x.includes('Eva Malá')))?.includes('  - "[[Eva Malá]]"\n'), 'linked');
});

test('fr_edt_07_ac6_link_text_follows_the_editor_rule_and_non_allowed_targets_warn', async ({ page }) => {
  // A single relation to any type on Page (Source is free text since D-248, so it can't carry this check any more).
  const vault = { ...editorVault(), files: { ...editorVault().files } };
  vault.files['.tegg/types/page.yml'] = vault.files['.tegg/types/page.yml'].replace('attributes: []\n', 'attributes:\n  - key: zdroj\n    name: Zdroj\n    type: relation\n');
  const core = await openTypes(page, 'Pages/Prázdná.md', { vault });
  await (await must(props(page).getByRole('button', { name: 'Add Zdroj', exact: true }), 'Add Zdroj')).click();
  const pick = await must(dialog(page, 'Choose Zdroj'), 'Choose Zdroj');
  await pick.getByRole('combobox', { name: 'Search' }).fill('C# tips');
  await sleep(150);
  await pick.getByRole('option', { name: /^C# tips/ }).click();
  assert.ok((await written(core, 'Pages/Prázdná.md', (x) => x.includes('zdroj:')))?.includes('zdroj: "[[C tips|C# tips]]"'), 'C tips → "[[C tips|C# tips]]"');
  await props(page).getByRole('button', { name: /^Remove C# tips$/ }).click();
  await (await must(props(page).getByRole('button', { name: 'Add Zdroj', exact: true }), 'Add Zdroj')).click();
  await dialog(page, 'Choose Zdroj').getByRole('combobox', { name: 'Search' }).fill('Senior');
  await sleep(150);
  await dialog(page, 'Choose Zdroj').getByRole('option').filter({ hasText: /2026-10-02|Oct 2, 2026/ }).first().click();
  assert.ok((await written(core, 'Pages/Prázdná.md', (x) => x.includes('Senior')))?.includes('zdroj: "[[Senior Product Manager (2)|Senior Product Manager]]"'));
});

test('fr_edt_07_ac6_non_allowed_and_unresolved_targets_are_kept_with_warnings', async ({ page }) => {
  const core = await openTypes(page, P.veStrankach);
  const chip = await must(props(page).getByRole('link', { name: 'Jana Nováková' }), 'projekt chip');
  assert.ok((await description(chip)).includes('Not a Projekt'), 'Not a Projekt');
  assert.deepEqual(await nonReadCalls(core), [], 'kept');
});

test('fr_edt_07_ac7_invalid_values_raw_with_warning_and_never_written_on_view', async ({ page }) => {
  const core = await openTypes(page, P.chybne);
  await must(control(page, 'textbox', 'Web'), 'the 3D panel');
  const rozpocet = await textControl(page, 'Rozpočet');
  assert.equal(await rozpocet.inputValue().catch(async () => (await rozpocet.innerText()).trim()), 'hodně', 'raw text');
  assert.ok((await description(rozpocet)).includes('Not a valid Number. The value is kept as it is.'));
  const web = await textControl(page, 'Web');
  assert.ok((await description(web)).includes('Not a valid URL. The value is kept as it is.'));
  const oblasti = await must(props(page).getByRole('group', { name: 'Oblasti' }), 'Oblasti');
  const konicky = oblasti.getByText('Koníčky', { exact: true }).locator('xpath=ancestor-or-self::*[@aria-describedby or @aria-description][1]');
  assert.ok((await description(konicky)).includes('Not an option'), 'Koníčky: Not an option');
  const prace = oblasti.getByText('Práce', { exact: true }).locator('xpath=ancestor-or-self::*[@aria-describedby or @aria-description][1]');
  assert.ok(!(await prace.count()) || !(await description(prace)).includes('Not an option'), 'Práce shown normally');
  await rozpocet.focus();
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  assert.equal(await rozpocet.inputValue().catch(async () => (await rozpocet.innerText()).trim()), 'hodně', 'Esc keeps the raw value');
  await sleep(1200);
  assert.deepEqual(await nonReadCalls(core), [], 'opening and viewing write nothing');
});

test('fr_edt_07_ac9_clearing_removes_the_entry', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet);
  await (await textControl(page, 'Web')).fill('');
  await page.keyboard.press('Enter');
  const t = await written(core, P.rozpocet, (x) => !x.includes('web:'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.rozpocet), 'web: https://example.com/rozpocet\n', '')));
  await (await must(control(page, 'checkbox', 'Aktivní'), 'Aktivní')).click();
  assert.ok((await written(core, P.rozpocet, (x) => x.includes('aktivní: false')))?.includes('aktivní: false'), 'false is a value');
});

test('fr_edt_07_ac9_existing_empty_entry_left_until_a_value_is_set', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await (await textControl(page, 'Místo')).focus();
  await page.keyboard.press('Enter');
  await (await must(control(page, 'checkbox', 'Datum').or(dateOpener(page, 'Datum')), 'Datum')).focus(); // D-763: a date opener
  await sleep(1300);
  assert.equal((await callsOf(core, 'note_write')).length, 0, '`místo:` is left as it is');
});

test('fr_edt_07_ac10_keyboard_order_and_edit_properties_command', async ({ page }) => {
  await openTypes(page, P.porada);
  await must(control(page, 'textbox', 'Místo'), 'the 3D panel');
  await titleField(page).focus();
  await page.keyboard.press('Tab');
  assert.ok((await focused(page)).label.startsWith('Datum'), 'title → the first value control (no description, D-313)');
  const seenLabels: string[] = [(await focused(page)).label];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    seenLabels.push((await focused(page)).label);
  }
  const iDatum = seenLabels.findIndex((l) => l.startsWith('Datum'));
  const iMisto = seenLabels.indexOf('Místo');
  assert.ok(iDatum >= 0 && iMisto > iDatum, `panel controls in row order: ${seenLabels.join(' | ')}`);
  await runCommand(page, 'Edit properties');
  assert.ok((await focused(page)).label.startsWith('Datum'), 'Edit properties focuses the first value control');
  const misto = await textControl(page, 'Místo');
  await misto.fill('Neuložené');
  await misto.press('Escape');
  assert.equal(await misto.inputValue(), '', 'Esc reverts to the saved value');
  assert.equal((await focused(page)).label, 'Místo', 'and keeps the focus');
});

test('fr_edt_07_ac11_read_only_files_have_no_editable_panel', async ({ page }) => {
  const core = await openTypes(page, P.neplatna);
  assert.ok(await seen(page.getByText('Tělo s chybnou hlavičkou.'), 3000), 'the read-only note is shown');
  const region = props(page);
  if (await seen(region, 500)) {
    assert.equal(await region.locator('input, textarea, [contenteditable="true"], [role="combobox"]').count(), 0, 'not editable');
    assert.equal(await region.getByText('Empty', { exact: true }).count(), 0, 'no Empty placeholders');
  }
  // D-369: the chip is a link to the type page; `Change type…` in the `More` menu is the disabled control (FR-TYP-07 AC-12).
  assert.ok(await seen(page.getByRole('main').getByRole('link', { name: /^Type: / })), 'red guard: the type chip is shown');
  await (await must(page.getByRole('main').getByRole('button', { name: 'More', exact: true }), 'button "More"')).click();
  const item = page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: 'Change type…', exact: true });
  assert.equal(await (await must(item, 'menuitem "Change type…"')).getAttribute('aria-disabled'), 'true', 'Change type… is disabled on files the panel can\'t edit');
  await page.keyboard.press('Escape');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

test('fr_edt_07_ac12_first_edit_of_a_file_without_frontmatter', async ({ page }) => {
  const core = await openTypes(page, P.bez);
  await (await must(props(page).getByRole('button', { name: 'Add tag', exact: true }), 'Add tag')).click();
  await page.getByRole('combobox', { name: 'Tag' }).fill('nový');
  await page.keyboard.press('Enter');
  const t = await written(core, P.bez, (x) => x.includes('nový'));
  assert.match(t ?? '', /^---\ntags:\n {2}- nový\nid: \S+\ntype: page\nmodified: \S+\n---\n/, 'tags, then id, type: page, modified');
  assert.ok((t ?? '').endsWith(`---\n${original(P.bez)}`), 'body byte-identical');
});

test('fr_edt_07_ac13_values_only', async ({ page }) => {
  await openTypes(page, P.porada);
  await must(control(page, 'textbox', 'Místo'), 'the 3D panel');
  for (const l of [/^Add property/, /^Add to type/, /^Remove property/, /^Delete property/]) assert.equal(await props(page).getByRole('button', { name: l }).count(), 0, `${l}`);
});

test('fr_edt_07_ac14_external_value_and_schema_changes', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const misto = await textControl(page, 'Místo');
  await core.setFile(P.porada, swap(original(P.porada), 'místo:\n', 'místo: Brno\n'));
  assert.equal(await eventually(() => misto.inputValue(), (v) => v === 'Brno', 2000), 'Brno', 'shown within 2 s');
  await core.setFile(typeFile('schůzka'), `${original(typeFile('schůzka'))}  - key: nálada\n    name: Nálada\n    type: text\n`);
  assert.ok(await seen(control(page, 'textbox', 'Nálada'), 2000), 'a new schema row within 2 s');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
  await core.writeControl({ hold: true });
  await misto.fill('Ostrava');
  await misto.press('Enter');
  await core.setFile(P.porada, swap(original(P.porada), 'místo:\n', 'místo: Plzeň\n'), { silent: false });
  await core.release();
  await must(page.getByRole('dialog', { name: 'Note changed outside Tegg', exact: true }), 'merge dialog (D-176)', 3000);
  assert.ok((await fileText(core, P.porada))?.includes('místo: Plzeň'), 'nothing overwritten');
});

test('fr_edt_07_ac16_panel_edit_is_one_undo_step', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await (await textControl(page, 'Místo')).fill('Zasedačka');
  await page.keyboard.press('Enter');
  await written(core, P.porada, (x) => x.includes('místo: Zasedačka'));
  await editorBody(page).click();
  await page.keyboard.press('Meta+z');
  const back = await written(core, P.porada, (x) => !x.includes('Zasedačka'));
  assert.ok(back?.includes('místo:\n'), 'undo restores the previous value and the next save writes it');
  await page.keyboard.press('Meta+Shift+z');
  assert.ok(await written(core, P.porada, (x) => x.includes('místo: Zasedačka')), '⇧⌘Z re-applies it');
  const misto = await textControl(page, 'Místo');
  await misto.focus();
  await page.keyboard.type('X');
  await page.keyboard.press('Meta+z');
  assert.equal(await misto.inputValue(), 'Zasedačka', 'inside an open text field ⌘Z is the field\'s own undo');
});

test('fr_edt_07_ac17_contrast_light_and_dark_with_pickers_open', async ({ page }) => {
  await openTypes(page, P.porada);
  await (await must(otherProps(page), 'Other properties')).click();
  for (const theme of ['Theme: Light', 'Theme: Dark']) {
    await runCommand(page, theme);
    await openNoteByTitle(page, '2026-10-07 Porada');
    assert.deepEqual(await axeContrast(page), [], `Porada ${theme}`);
    await openNoteByTitle(page, 'Chybné hodnoty');
    assert.deepEqual(await axeContrast(page), [], `Chybné ${theme}`);
    await openNoteByTitle(page, 'Prázdná schůzka');
    await (await must(props(page).getByRole('button', { name: 'Add Účastníci', exact: true }), 'Add Účastníci')).click();
    assert.deepEqual(await axeContrast(page), [], `relation picker ${theme}`);
    await page.keyboard.press('Escape');
    await openDatePicker(page, 'Datum'); // D-763: the one date picker `Pick date`
    assert.deepEqual(await axeContrast(page), [], `date picker ${theme}`);
    await page.keyboard.press('Escape');
  }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-08

test('fr_typ_08_ac7_superseded_by_d313_no_description_field', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await must(control(page, 'textbox', 'Místo'), 'the panel');
  assert.equal(await subtitle(page).count(), 0, 'no Description field on the object (D-313)');
  assert.equal(await page.getByPlaceholder('Add a description').count(), 0, 'no description placeholder');
  assert.equal(await lastWrite(core, P.porada), null, 'nothing written');
});

test('fr_typ_08_ac8_tags_row', async ({ page, browser }) => {
  const core = await openTypes(page, P.porada);
  const tags = await must(props(page).getByRole('group', { name: 'Tags' }), 'group Tags');
  assert.ok(await seen(tags.getByRole('link', { name: '#finance' })), 'chip #finance');
  await tags.getByRole('button', { name: 'Add tag', exact: true }).click();
  await must(page.getByRole('listbox', { name: 'Tag suggestions' }), 'Tag suggestions');
  await page.getByRole('combobox', { name: 'Tag' }).fill('rozpočet');
  await page.keyboard.press('Enter');
  assert.ok((await written(core, P.porada, (x) => x.includes('rozpočet]')))?.includes('tags: [finance, q4, rozpočet]\n'), 'flow list kept');
  await tags.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tag' }).fill('#FINANCE');
  await page.keyboard.press('Enter');
  await sleep(1300);
  assert.ok((await lastWrite(core, P.porada))?.includes('tags: [finance, q4, rozpočet]\n'), 'a present tag isn\'t added twice; # dropped');
  for (const n of ['finance', 'q4', 'rozpočet']) await tags.getByRole('button', { name: `Remove tag ${n}`, exact: true }).click();
  assert.ok(!(await written(core, P.porada, (x) => !x.includes('tags:')))?.includes('tags:'), 'removing the last tag removes the key');
  const p2 = await browser.newPage();
  const o = await openTypes(p2, P.obycejna);
  await props(p2).getByRole('group', { name: 'Tags' }).getByRole('button', { name: 'Add tag', exact: true }).click();
  await p2.getByRole('combobox', { name: 'Tag' }).fill('rozpočet');
  await p2.keyboard.press('Enter');
  assert.ok((await written(o, P.obycejna, (x) => x.includes('tags:')))?.includes('tags:\n  - rozpočet\n'), 'block list on a note without tags');
  await p2.close();
});

test('fr_typ_08_ac8_tag_chip_opens_the_tag_page', async ({ page }) => {
  // D-943: the D-218 step runs with Object preview Off; click mode (AP-819) follows.
  const core = await openTypes(page, P.porada, setPreviewMode('off'));
  const chip = await must(props(page).getByRole('group', { name: 'Tags' }).getByRole('link', { name: '#finance' }), '#finance chip');
  await chip.click();
  assert.notEqual(await eventually(() => mainName(page), (n) => n !== '2026-10-07 Porada', 2000), '2026-10-07 Porada', 'opens the tag page (D-218)');
  const tagPage = await mainName(page);

  // Click to preview (AP-819): a click previews the Tag, a double-click opens its tag page.
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, '2026-10-07 Porada', 'Back to Porada');
  await switchPreviewMode(page, core, 'click');
  const chip2 = props(page).getByRole('group', { name: 'Tags' }).getByRole('link', { name: '#finance' });
  await (await must(chip2, '#finance chip (click mode)')).click();
  await mustPreview(page, /^Preview: #finance$/i, 'click mode: a click on the tag chip previews the Tag');
  assert.equal(await mainName(page), '2026-10-07 Porada', 'click mode: the click keeps the route');
  await escPreview(page, 'click mode: the Tag preview');
  await (await must(chip2, '#finance chip (double-click)')).dblclick();
  assert.equal(await eventually(() => mainName(page), (n) => n === tagPage, 2000), tagPage, 'click mode: a double-click opens the tag page');
});

test('fr_typ_08_ac9_aliases_row_and_switcher', async ({ page }) => {
  const core = await openTypes(page, P.styl);
  // D-312: one text field, comma-separated (FR-TYP-08 AC-15).
  const al = await must(props(page).getByRole('textbox', { name: 'Aliases', exact: true }), 'textbox Aliases');
  assert.equal(await al.inputValue(), 'Styl, Hodnoty');
  await al.click();
  await al.fill('Styl, Hodnoty, Třetí');
  await al.press('Enter');
  const t = await written(core, P.styl, (x) => x.includes('Třetí'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.styl), 'aliases: [Styl, Hodnoty]\n', 'aliases: [Styl, Hodnoty, Třetí]\n')), 'flow list kept; key spelling and value style kept (FR-EDT-07 AC-8)');
  await goToQuery(page, 'třetí');
  assert.ok(await seen(goToListbox(page).getByRole('option').filter({ hasText: 'Styl hodnot' }), 2000), 'found by the alias within 2 s');
});

test('fr_typ_08_ac11_review_select', async ({ page }) => {
  const core = await openTypes(page, P.napadKOvereni);
  const r = await must(control(page, 'combobox', 'Review'), 'combobox Review');
  await r.click();
  const opts = (await page.getByRole('listbox', { name: 'Review options' }).getByRole('option').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(opts.filter((o) => o !== 'Clear'), ['Unreviewed', 'Reviewed']);
  await page.getByRole('option', { name: 'Reviewed', exact: true }).click();
  const t = await written(core, P.napadKOvereni, (x) => x.includes('review: reviewed'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.napadKOvereni), 'review: unreviewed\n', 'review: reviewed\n')), 'only that line and modified');
});

test('fr_typ_08_ac12_created_and_modified_read_only_and_modified_updates', async ({ page }) => {
  const core = await openTypes(page, P.porada, { region: 'cs' });
  await must(control(page, 'textbox', 'Místo'), 'the 3D panel');
  for (const l of ['Created', 'Modified']) {
    assert.equal(await props(page).getByRole('textbox', { name: l }).count(), 0, `${l} is no control`);
  }
  const before = await props(page).innerText();
  await (await textControl(page, 'Místo')).fill('Jinde');
  await page.keyboard.press('Enter');
  const t = await written(core, P.porada, (x) => x.includes('Jinde'));
  const mod = /^modified: (\S+)$/m.exec(t ?? '')?.[1] ?? '';
  const shown = await eventually(() => props(page).innerText(), (x) => x !== before, 1000);
  assert.notEqual(shown, before, `modified (${mod}) shown within 1 s of the save`);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-02

test('fr_typ_02_ac3_date_range_is_one_row_with_two_fields', async ({ page }) => {
  const core = await openTypes(page, P.velka, { region: 'cs' });
  const g = await must(props(page).getByRole('group', { name: 'Období' }), 'group Období');
  // D-763: each half is a `Pick date` opener; dates are typed in the picker's `Date` field.
  await pickTyped(page, 'Období start', '31. 12. 2027');
  await pickTyped(page, 'Období end', '1. 1. 2027');
  await must(g.getByRole('alert').filter({ hasText: 'The end is before the start' }), 'refused');
  await sleep(1200);
  assert.equal((await callsOf(core, 'note_write')).length, 0, 'nothing written');
  await pickTyped(page, 'Období start', '1. 1. 2027');
  await pickTyped(page, 'Období end', '31. 12. 2027');
  const t = await written(core, P.velka, (x) => x.includes('období-end'));
  assert.equal(noModified(t ?? ''), noModified(append(original(P.velka), 'období-start: 2027-01-01\nobdobí-end: 2027-12-31\n')), 'two consecutive lines');
  await pickNoDate(page, 'Období start');
  await pickNoDate(page, 'Období end');
  assert.ok(!(await written(core, P.velka, (x) => !x.includes('období')))?.includes('období'), 'clearing both removes both keys');
});

test('fr_typ_02_ac3_only_start_shows_an_empty_end_and_is_valid', async ({ page }) => {
  const vault = typesVault((f) => { f[P.velka] = append(f[P.velka], 'období-start: 2027-01-01\n'); });
  await openTypes(page, P.velka, { vault, region: 'cs' });
  const g = await must(props(page).getByRole('group', { name: 'Období' }), 'group Období');
  await must(g.getByRole('button', { name: 'Období end: No date', exact: true }), 'the end is empty (D-763 opener)');
  assert.ok(!(await description(g.getByRole('button', { name: /^Období start: / }))).includes('Not a valid'), 'valid');
});

test('fr_typ_02_ac4_system_only_types_are_read_only', async ({ page }) => {
  const vault = typesVault((f) => {
    f['Tasks/Opakovaný.md'] = '---\nid: 01JB0T0000000000000000T094\ntype: task\ntitle: Opakovaný\nrecurrence: every week\n---\n';
    f['Tags/rozpočet.md'] = '---\nid: 01JB0T0000000000000000T095\ntype: tag\ntitle: rozpočet\ncolor: red\n---\n';
    f['Images/Fotka.md'] = '---\nid: 01JB0T0000000000000000T096\ntype: image\ntitle: Fotka\nfile: "[[photo.png]]"\n---\n';
  });
  const core = await openTypes(page, 'Tasks/Opakovaný.md', { vault });
  for (const [label, raw] of [['Recurrence', 'every week']] as const) {
    const row = await must(props(page).locator('[tabindex="0"]').filter({ hasText: raw }), `${label}: raw text, focusable`);
    // D-381, D-489: Task recurrence is v1.0 (`Coming in v1.0`).
    assert.equal(await description(row), 'Coming in v1.0', `${label}: description`);
  }
  // Changed by 4D-lite (tags.md R87, D-692): a Tag has no note page, so its `color` row is gone; the Tag file opens its
  // tag page, without an attribute panel.
  await goToQuery(page, 'rozpočet');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await must(page.getByRole('main').filter({ has: page.getByRole('link', { name: '‹ All tags', exact: true }) }).getByRole('heading', { level: 1, name: 'rozpočet', exact: true }), 'the Tag file opens tag/rozpočet', 3000);
  assert.equal(await props(page).count(), 0, 'no attribute panel on a Tag (no Color row)');
  // Changed by 6A (trash-media.md R75): the File row (`ctl.rowFile`) is built: no longer `Editing comes in MS6`.
  await openNoteByTitle(page, 'Fotka');
  const file = await must(props(page).locator('[tabindex="0"]').filter({ hasText: 'photo.png' }), 'File: the file, focusable');
  assert.ok(!(await description(file)).includes('Editing comes in'), 'File: built in 6A');
  assert.deepEqual(await nonReadCalls(core), [], 'the panel never writes them');
  void main;
});
