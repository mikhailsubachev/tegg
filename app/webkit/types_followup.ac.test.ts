// MS3 3D follow-up, L5 (WebKit + fake core): FR-TYP-01 AC-10, AC-11 (`Create type "<value>"`, D-251, D-259),
// FR-TYP-08 AC-13, AC-14 (`source` as text, links in Description and Source, D-248, D-249), FR-TYP-09 AC-13…AC-16
// (Columns menu, D-252, D-260), FR-EDT-07 AC-18 (links in text values, D-249). docs/acceptance/types.md; interface
// docs/contracts/ms3-shell.md §15.3, §15.4, §15.6, §15.7. Written from the ACs and the contract only (D-61). Every
// lookup goes through `must`/`seen` and node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { focused, gotoType, mainName, mustBeOn, shellVault, start, typeEntries } from './helpers';
import {
  P, callsOf, control, description, eventually, fileText, fileWhen, fixture, gotoTypePage, isDisabled, lastWrite, main, must, newTypeDialog,
  noModified, openNoteByTitle, openTypes, original, props, runCommand, seen, settingsHeading, sleep, swap, typeFile, typeTable, typesVault,
  writtenOutside,
} from './types-helpers';

type Core = Awaited<ReturnType<typeof openTypes>>;
const S = 'Schůzky';
const schuzka = () => original(typeFile('schůzka'));
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
/** The `key: …` line (with block lines) of a note text. */
function entry(text: string | null | undefined, key: string): string {
  const lines = (text ?? '').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && /^\s+/.test(lines[j]) && lines[j].trim() !== '') j++;
  return lines.slice(i, j).join('\n');
}
const withoutEntry = (t: string | null | undefined, key: string) => {
  const e = entry(t, key);
  return noModified(e ? (t ?? '').replace(`${e}\n`, '') : (t ?? ''));
};
async function commitField(page: Page, loc: ReturnType<Page['getByRole']>, value: string, what: string) {
  const f = await must(loc, what);
  await f.click();
  await f.fill(value);
  await f.press('Enter');
  await sleep(100);
}
async function yamlValue(text: string | null, key: string): Promise<unknown> {
  const { parse } = await import('@tegg/doc');
  return (parse(text ?? '').frontmatter?.data as any)?.[key];
}


// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-10

const createTypeButton = (page: Page, value: string) => main(page).getByRole('button', { name: `Create type "${value}"`, exact: true });
/** The undefined type's page through the palette; the sidebar label may be the value as written or its key. */
async function gotoUndefined(page: Page, value: string, key: string) {
  for (const label of [value, key]) {
    await runCommand(page, `Go to type: ${label}`);
    if (await seen(createTypeButton(page, value), 1500)) return;
  }
}

test('fr_typ_01_ac10_create_type_from_an_undefined_value', async ({ page }) => {
  const core = await start(page, { vault: shellVault() });
  await gotoType(page, 'recept');
  await (await must(createTypeButton(page, 'recept'), 'button Create type "recept"')).click();
  const d = await must(newTypeDialog(page), 'dialog New type');
  const name = d.getByRole('textbox', { name: 'Name', exact: true });
  const plural = d.getByRole('textbox', { name: 'Plural name', exact: true });
  const folder = d.getByRole('textbox', { name: 'Folder in the vault', exact: true });
  assert.equal(await name.inputValue(), 'Recept', 'Name = the value with its first letter upper-cased');
  assert.equal(await isDisabled(name), true, 'Name is read-only');
  assert.equal(await plural.inputValue(), 'Recept', 'Plural prefilled');
  assert.equal((await focused(page)).label, 'Plural name', 'Plural focused');
  assert.equal(await folder.inputValue(), 'Recept', 'Folder from the plural');
  await plural.fill('Recepty');
  assert.equal(await folder.inputValue(), 'Recepty', 'Folder follows the plural until edited');
  const t0 = Date.now();
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await must(settingsHeading(page, 'Recept'), 'route type-settings/recept', 1000);
  assert.equal((await focused(page)).heading, true, 'focus on its heading (AC-2)');
  assert.equal(await fileText(core, typeFile('recept')), fixture('types/expected/recept.yml'), 'byte-identical to the expected file');
  assert.deepEqual(await core.writesTo(), [typeFile('recept')], 'exactly one file; Svíčková is not written or moved');
  const entries = await eventually(() => typeEntries(page), (e) => e.some(([l, n]) => l === 'Recepty' && n === 1), 1000);
  assert.ok(entries.some(([l, n]) => l === 'Recepty' && n === 1), `sidebar entry Recepty 1 within 1 s (after ${Date.now() - t0} ms): ${JSON.stringify(entries)}`);
  assert.ok(!entries.some(([l]) => l === 'recept'), 'the "no definition" entry is gone');
  await openNoteByTitle(page, 'Svíčková');
  const region = await must(props(page), 'Properties');
  const editable = region.locator('input:not([disabled]):not([readonly]), [contenteditable="true"], [role="combobox"]:not([aria-disabled="true"])');
  assert.ok(await seen(editable.first(), 2000), 'Svíčková shows the editable panel (FR-EDT-07)');
});

test('fr_typ_01_ac10_cancel_esc_and_close_write_nothing', async ({ page }) => {
  const core = await start(page, { vault: shellVault() });
  await gotoType(page, 'recept');
  for (const how of ['Cancel', 'Escape'] as const) {
    await (await must(createTypeButton(page, 'recept'), 'button Create type "recept"')).click();
    const d = await must(newTypeDialog(page), 'dialog New type');
    if (how === 'Cancel') await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await page.keyboard.press('Escape');
    assert.equal(await newTypeDialog(page).count(), 0, `${how} closes`);
  }
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-11

const obj = (id: string, type: string, title: string) => `---\nid: ${id}\ntype: ${type}\ntitle: ${title}\n---\n`;

test('fr_typ_01_ac11_a_value_with_spaces_gets_its_key', async ({ page }) => {
  const vault = typesVault((f) => { f['Recepty/Polévka dne.md'] = obj('01JB0T0000000000000000T120', 'Recept s mezerou', 'Polévka dne'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoUndefined(page, 'Recept s mezerou', 'recept-s-mezerou');
  await (await must(createTypeButton(page, 'Recept s mezerou'), 'Create type "Recept s mezerou"')).click();
  const d = await must(newTypeDialog(page), 'New type');
  assert.equal(await d.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Recept s mezerou');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Recepty s mezerou');
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  assert.ok((await fileWhen(core, typeFile('recept-s-mezerou'), (t) => t !== undefined)) !== undefined, 'key recept-s-mezerou');
  assert.deepEqual(await writtenOutside(core, [typeFile('recept-s-mezerou')]), [], 'no object rewritten');
});

test('fr_typ_01_ac11_an_nfd_value_gives_the_nfc_file_and_keeps_the_object', async ({ page }) => {
  const nfd = 'polévka';
  const vault = typesVault((f) => { f['Recepty/Česnečka.md'] = obj('01JB0T0000000000000000T121', nfd, 'Česnečka'); });
  const before = vault.files['Recepty/Česnečka.md'];
  const core = await openTypes(page, undefined, { vault });
  await gotoUndefined(page, 'polévka', 'polévka');
  await (await must(createTypeButton(page, 'polévka').or(createTypeButton(page, nfd)).first(), 'Create type "polévka"')).click();
  const d = await must(newTypeDialog(page), 'New type');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Polévky');
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  assert.ok((await fileWhen(core, '.tegg/types/polévka.yml', (t) => t !== undefined)) !== undefined, 'NFC file name');
  assert.equal(await fileText(core, 'Recepty/Česnečka.md'), before, 'the NFD object is not rewritten');
  await gotoTypePage(page, 'Polévky');
  assert.ok(await seen(typeTable(page, 'Polévky').getByRole('row').filter({ hasText: 'Česnečka' })), 'the NFD object matches the type (FR-TYP-13 AC-1)');
});

test('fr_typ_01_ac11_values_that_cannot_be_file_names_are_disabled', async ({ page }) => {
  const long = 'č'.repeat(101);
  const vault = typesVault((f) => {
    f['Recepty/Lomítko.md'] = obj('01JB0T0000000000000000T122', '"a/b"', 'Lomítko');
    f['Recepty/Dlouhý.md'] = obj('01JB0T0000000000000000T123', long, 'Dlouhý');
  });
  const core = await openTypes(page, undefined, { vault });
  for (const v of ['a/b', long]) {
    await gotoUndefined(page, v, v);
    const b = await must(createTypeButton(page, v), `Create type "${v.slice(0, 10)}…"`);
    assert.equal(await b.getAttribute('aria-disabled'), 'true', 'aria-disabled');
    assert.equal(await description(b), "This type name can't be used as a file name", 'with the reason');
    await b.click({ force: true });
    assert.equal(await newTypeDialog(page).count(), 0, 'no dialog');
  }
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

test('fr_typ_01_ac11_plural_rules_and_a_file_that_appears_while_open', async ({ page }) => {
  const core = await start(page, { vault: shellVault() });
  await gotoType(page, 'recept');
  await (await must(createTypeButton(page, 'recept'), 'Create type "recept"')).click();
  let d = await must(newTypeDialog(page), 'New type');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Kni:hy');
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  assert.ok(await seen(d.getByRole('alert'), 1000), 'a Plural that breaks AC-3 is refused with a message');
  await page.keyboard.press('Escape');
  await (await must(createTypeButton(page, 'recept'), 'Create type "recept"')).click();
  d = await must(newTypeDialog(page), 'New type');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Recepty');
  const theirs = '# z jiného Macu\nversion: 1\nname: Recept\nplural: Recepty\nattributes: []\n';
  await core.setFile(typeFile('recept'), theirs, { silent: true });
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await must(d.getByText('A type with this name already exists'), 'message in the dialog');
  assert.equal(await fileText(core, typeFile('recept')), theirs, 'nothing overwritten');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-08 AC-13

const sourceField = (page: Page) => props(page).getByRole('textbox', { name: 'Source', exact: true });

test('fr_typ_08_ac13_source_is_a_text_field_with_text_rules', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  const cases: [string, string][] = [
    ['Kniha Rychlé šípy', 'source: Kniha Rychlé šípy'],
    ['https://example.com/a?b=c', 'source: https://example.com/a?b=c'],
    ['2026-10-07', 'source: "2026-10-07"'],
    ['Plzeň', 'source: Plzeň'],
  ];
  for (const [input, line] of cases) {
    // Each case starts without a source: an edited entry keeps its quote style (D-230), so the cases are independent.
    if (entry(await fileText(core, P.obycejna), 'source')) {
      await commitField(page, sourceField(page), '', 'Source');
      await written(core, P.obycejna, (x) => entry(x, 'source') === '');
    }
    await commitField(page, sourceField(page), input, 'panel textbox Source');
    const t = await written(core, P.obycejna, (x) => entry(x, 'source') === line);
    assert.equal(entry(t, 'source'), line, JSON.stringify(input));
    assert.equal(withoutEntry(t, 'source'), noModified(original(P.obycejna)), 'only the source entry and modified differ');
  }
  const f = await must(sourceField(page), 'Source');
  await f.click();
  await f.fill('');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'První řádek\nDruhý řádek');
    (document.activeElement as HTMLElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await f.press('Enter');
  const p = await written(core, P.obycejna, (x) => entry(x, 'source') === 'source: První řádek Druhý řádek');
  assert.equal(entry(p, 'source'), 'source: První řádek Druhý řádek', 'pasted line breaks become spaces (AP-188)');
  await commitField(page, sourceField(page), '', 'Source');
  const c = await written(core, P.obycejna, (x) => entry(x, 'source') === '');
  assert.equal(noModified(c ?? undefined), noModified(original(P.obycejna)), 'clearing removes the key');
});

test('fr_typ_08_ac13_source_row_is_text_on_every_type', async ({ page }) => {
  const vault = typesVault((f) => { f['Quick Notes/Rychlá.md'] = '---\nid: 01JB0T0000000000000000T124\ntype: quick-note\ntitle: Rychlá\nreview: unreviewed\n---\n'; });
  await openTypes(page, undefined, { vault });
  for (const title of ['Obyčejná stránka', '2026-10-07 Porada', 'Zavolat Janě', 'Nápad k ověření', 'Rychlá']) {
    await openNoteByTitle(page, title);
    assert.ok(await seen(sourceField(page), 2000), `${title}: Source is a single-line text field`);
  }
});

test('fr_typ_08_ac13_no_source_value_is_invalid', async ({ page }) => {
  for (const [value, shown] of [['kniha', 'kniha'], ['"[[Rozpočet 2027]]"', null], ['12', '12']] as const) {
    const vault = typesVault((f) => { f[P.obycejna] = swap(f[P.obycejna], 'místo: Praha\n', `místo: Praha\nsource: ${value}\n`); });
    await openTypes(page, P.obycejna, { vault });
    const region = await must(props(page), 'Properties');
    await must(sourceField(page), 'Source text field');
    assert.equal(await region.getByText('The value is kept as it is.').count(), 0, `source: ${value} is valid text`);
    if (shown) assert.equal(await sourceField(page).inputValue().catch(async () => (await sourceField(page).innerText()).trim()), shown, 'shown as written');
  }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-08 AC-14

// The Description part is superseded by D-313 (no description on objects); its chip checks run on Source.
test('fr_typ_08_ac14_source_chip_opens_the_note_and_shows_broken_targets', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await commitField(page, sourceField(page), 'Viz [[Rozpočet 2027]]', 'textbox Source');
  await written(core, P.obycejna, (x) => entry(x, 'source') !== '');
  await editorClickAway(page);
  const chip = await must(props(page).getByRole('link', { name: 'Rozpočet 2027', exact: true }), 'link chip Rozpočet 2027 in Source');
  await chip.click();
  await mustBeOn(page, 'Rozpočet 2027', 'the chip opens the note (D-140)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Obyčejná stránka', 'back');
  await (await must(sourceField(page), 'Source')).click();
  assert.equal(await sourceField(page).inputValue(), 'Viz [[Rozpočet 2027]]', 'edit mode shows the raw text');
  await commitField(page, sourceField(page), 'Viz [[Neexistuje]]', 'Source');
  await editorClickAway(page);
  const broken = await must(props(page).getByRole('link', { name: 'Neexistuje', exact: true }), 'chip Neexistuje');
  assert.match(await description(broken), /No note named Neexistuje/, 'broken style (D-142)');
});

test('fr_typ_08_ac14_links_in_source', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await commitField(page, sourceField(page), 'Viz [[Rozpočet 2027]]', 'textbox Source');
  const t = await written(core, P.obycejna, (x) => entry(x, 'source') !== '');
  assert.equal(entry(t, 'source'), 'source: "Viz [[Rozpočet 2027]]"');
  await editorClickAway(page);
  await must(props(page).getByRole('link', { name: 'Rozpočet 2027', exact: true }), 'link chip in the Source row');
});

async function editorClickAway(page: Page) {
  await page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).first().click().catch(() => {});
  await sleep(200);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-18

test('fr_edt_07_ac18_links_in_a_text_value_are_written_quoted', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const misto = () => control(page, 'textbox', 'Místo');
  const cases: [string, string, string][] = [
    ['[[Jana Nováková]]', 'místo: "[[Jana Nováková]]"', '[[Jana Nováková]]'],
    ['u [[Jana Nováková]] doma', 'místo: "u [[Jana Nováková]] doma"', 'u [[Jana Nováková]] doma'],
    ['[[Jana Nováková|Jana]]', 'místo: "[[Jana Nováková|Jana]]"', '[[Jana Nováková|Jana]]'],
    ['u [[Jana Nováková]]', 'místo: "u [[Jana Nováková]]"', 'u [[Jana Nováková]]'],
  ];
  for (const [input, line, value] of cases) {
    await commitField(page, misto(), '', 'Místo');
    await written(core, P.porada, (x) => entry(x, 'místo') === 'místo:' || entry(x, 'místo') === '');
    await commitField(page, misto(), input, 'panel textbox Místo');
    const t = await written(core, P.porada, (x) => entry(x, 'místo') === line);
    assert.equal(entry(t, 'místo'), line, JSON.stringify(input));
    assert.equal(withoutEntry(t, 'místo'), withoutEntry(original(P.porada), 'místo'), 'only místo and modified differ');
    assert.equal(await yamlValue(t, 'místo'), value, 'reads back as the typed string');
  }
});

test('fr_edt_07_ac18_long_text_keeps_its_block_with_the_link', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet);
  const f = await must(props(page).getByRole('textbox', { name: 'Poznámka', exact: true }), 'Poznámka');
  await f.fill('');
  await f.type('První řádek.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Zavolat [[Jana Nováková]].');
  await page.keyboard.press('Meta+Enter');
  const t = await written(core, P.rozpocet, (x) => x.includes('Zavolat [[Jana'));
  assert.equal(entry(t, 'poznámka'), 'poznámka: |-\n  První řádek.\n  Zavolat [[Jana Nováková]].', 'the |- block with the link text unchanged');
  assert.equal(await yamlValue(t, 'poznámka'), 'První řádek.\nZavolat [[Jana Nováková]].');
  await sleep(200);
  assert.ok(await seen(props(page).getByRole('link', { name: 'Jana Nováková', exact: true }), 1500), 'shown with a link chip out of edit mode');
});

test('fr_edt_07_ac18_chips_out_of_edit_mode_open_and_show_broken_targets', async ({ page }) => {
  const vault = typesVault((f) => { f[P.prazdna] = swap(f[P.prazdna], 'title: Prázdná schůzka\n', 'title: Prázdná schůzka\nmísto: "u [[Jana Nováková]] doma, pak [[Neexistuje]]"\n'); });
  await openTypes(page, P.prazdna, { vault });
  const region = await must(props(page), 'Properties');
  const chip = await must(region.getByRole('link', { name: 'Jana Nováková', exact: true }), 'chip Jana Nováková in místo');
  const broken = await must(region.getByRole('link', { name: 'Neexistuje', exact: true }), 'chip Neexistuje');
  assert.match(await description(broken), /No note named Neexistuje/, 'broken style (D-142)');
  await chip.click();
  await mustBeOn(page, 'Jana Nováková', 'the chip opens the target (D-140)');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-13…AC-16

const columnsButton = (page: Page) => main(page).getByRole('button', { name: 'Columns', exact: true });
const columnsMenu = (page: Page) => page.getByRole('menu', { name: 'Columns', exact: true });
const item = (page: Page, name: string) => columnsMenu(page).getByRole('menuitemcheckbox', { name, exact: true });
async function openColumns(page: Page) {
  await (await must(columnsButton(page), 'button Columns')).click();
  return must(columnsMenu(page), 'menu Columns');
}
const headers = async (page: Page, plural = S) => (await typeTable(page, plural).getByRole('columnheader').allInnerTexts()).map((t) => t.trim());

test('fr_typ_09_ac13_columns_menu_lists_the_choices_and_writes_preview', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  const b = await must(columnsButton(page), 'button Columns');
  assert.equal(await b.getAttribute('aria-haspopup'), 'menu');
  assert.equal(await main(page).getByRole('button', { name: 'Add column', exact: true }).count(), 0, 'no Add column');
  const m = await openColumns(page);
  const names = (await m.getByRole('menuitemcheckbox').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(names, ['Datum', 'Začátek', 'Účastníci', 'Projekt', 'Místo', 'Tags', 'Source', 'Aliases', 'Created'], 'schema order, then universal choices');
  assert.equal(await m.getByRole('separator').count(), 1, 'a separator');
  await must(m.getByRole('menuitem', { name: 'New property…', exact: true }), 'New property…');
  const checked = [];
  for (const n of names) if ((await item(page, n).getAttribute('aria-checked')) === 'true') checked.push(n);
  assert.deepEqual(checked, ['Datum', 'Účastníci'], 'items in preview are checked');
  await item(page, 'Místo').click();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo]'));
  assert.equal(t, swap(schuzka(), 'preview: [datum, účastníci]\n', 'preview: [datum, účastníci, místo]\n'), 'only the preview line');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'one write');
  const h = await eventually(() => headers(page), (x) => x.includes('Místo'), 1000);
  assert.deepEqual(h, ['Title', 'Datum', 'Účastníci', 'Místo', 'Modified'], 'Místo between Účastníci and Modified within 1 s');
  assert.ok(await seen(columnsMenu(page), 300), 'the menu stays open');
  await item(page, 'Datum').click();
  const u = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('preview: [účastníci, místo]'));
  assert.equal(u, swap(schuzka(), 'preview: [datum, účastníci]\n', 'preview: [účastníci, místo]\n'));
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note file written');
});

test('fr_typ_09_ac13_columns_menu_works_from_the_keyboard', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  const b = await must(columnsButton(page), 'button Columns');
  await b.focus();
  await page.keyboard.press('Enter');
  await must(columnsMenu(page), 'menu Columns');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');
  assert.equal(label, 'Místo', '↓ moves through the items');
  await page.keyboard.press('Space');
  assert.ok((await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo]')))?.includes('preview: [datum, účastníci, místo]'), 'Space toggles');
  await page.keyboard.press('Escape');
  assert.equal(await columnsMenu(page).count(), 0, 'Esc closes');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Columns', 'focus back on Columns');
});

test('fr_typ_09_ac14_new_property_from_the_menu_adds_a_column_in_one_write', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  const m = await openColumns(page);
  await m.getByRole('menuitem', { name: 'New property…', exact: true }).click();
  assert.equal((await focused(page)).label, 'Name', 'the Add property flow with Name focused');
  await page.keyboard.type('Místnost');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místnost'));
  const want = swap(schuzka(), 'preview: [datum, účastníci]\n', 'preview: [datum, účastníci, místnost]\n') + '  - key: místnost\n    name: Místnost\n    type: text\n';
  assert.equal(t, want, 'item appended and key added to preview');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'one write');
});

test('fr_typ_09_ac14_at_the_limit_the_property_is_added_without_the_column', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'preview: [datum, účastníci]\n', 'preview: [datum, začátek, účastníci, projekt]\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  const m = await openColumns(page);
  await m.getByRole('menuitem', { name: 'New property…', exact: true }).click();
  await page.keyboard.type('Místnost');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await must(page.getByText('Up to 4 columns. Choose it in Columns after unchecking another.'), 'limit message');
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místnost'));
  assert.ok(t?.includes('preview: [datum, začátek, účastníci, projekt]\n'), 'preview unchanged');
  // Cancel writes nothing.
  const n = (await callsOf(core, 'type_patch')).length;
  await (await openColumns(page)).getByRole('menuitem', { name: 'New property…', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await callsOf(core, 'type_patch')).length, n, 'Cancel writes nothing');
});

test('fr_typ_09_ac15_four_checked_disables_the_rest', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'preview: [datum, účastníci]\n', 'preview: [datum, začátek, účastníci, projekt]\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  await openColumns(page);
  const misto = await must(item(page, 'Místo'), 'Místo');
  assert.equal(await misto.getAttribute('aria-disabled'), 'true', 'unchecked items disabled');
  assert.equal(await description(misto), 'Up to 4 columns');
  await misto.click({ force: true });
  await sleep(300);
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'writes nothing');
  await item(page, 'Projekt').click();
  await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('preview: [datum, začátek, účastníci]\n'));
  assert.notEqual(await item(page, 'Místo').getAttribute('aria-disabled'), 'true', 'unchecking one enables them again');
});

test('fr_typ_09_ac15_hand_written_entries_and_a_missing_preview_key', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'preview: [datum, účastníci]\n', 'preview: [datum, neznámý]\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  const m = await openColumns(page);
  assert.equal(await item(page, 'Datum').getAttribute('aria-checked'), 'true', 'Datum checked');
  assert.ok(await seen(m.getByText(/neznámý/), 1000), 'the FR-TYP-11 AC-2 warning in the menu');
  await item(page, 'Místo').click();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo]'));
  assert.ok(t?.includes('preview: [datum, neznámý, místo]\n'), 'hand-written entry kept, counted');
});

test('fr_typ_09_ac15_a_type_file_without_preview_gets_one', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'preview: [datum, účastníci]\n', ''); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  await openColumns(page);
  await item(page, 'Místo').click();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('preview:'));
  assert.ok(t?.includes('preview: [místo]\n'), `preview written: ${t}`);
  assert.equal(t?.replace('preview: [místo]\n', ''), vault.files[typeFile('schůzka')], 'only the preview line added');
});

test('fr_typ_09_ac15_a_changed_file_refuses_and_toggles_round_trip', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await openColumns(page);
  await item(page, 'Místo').click();
  await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo]'));
  await item(page, 'Místo').click();
  const back = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('preview: [datum, účastníci]\n'));
  assert.equal((await callsOf(core, 'type_patch')).length, 2, 'two writes');
  assert.equal(back, schuzka(), 'byte-identical to the start');
  // Let the app finish re-reading the type files after its own writes, so the silent change stays unseen.
  await sleep(500);
  const theirs = swap(schuzka(), 'color: teal\n', 'color: red\n');
  await core.setFile(typeFile('schůzka'), theirs, { silent: true });
  await item(page, 'Místo').click();
  await must(page.getByRole('alert').filter({ hasText: 'Changed outside Tegg' }), 'alert of FR-TYP-01 AC-7');
  assert.equal(await fileText(core, typeFile('schůzka')), theirs, 'refused');
});

test('fr_typ_09_ac15_system_type_menu_lists_built_in_attributes', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, 'Tasks');
  const m = await openColumns(page);
  const names = (await m.getByRole('menuitemcheckbox').allInnerTexts()).map((t) => t.trim());
  assert.ok(names.length > 4 && names.includes('Tags'), `built-in attributes and universal choices: ${names.join(', ')}`);
  const pick = names.find((n) => !['Tags', 'Source', 'Aliases', 'Created'].includes(n));
  assert.ok(pick, 'a built-in attribute is a choice');
  await item(page, 'Tags').click();
  assert.ok((await fileWhen(core, typeFile('task'), (x) => !!x?.includes('tags')))?.match(/^preview: \[.*tags.*\]$/m), 'task.yml preview written');
});

test('fr_typ_09_ac16_where_columns_is_not_offered', async ({ page }) => {
  const vault = typesVault((f) => { f['Recepty/Svíčková.md'] = obj('01JB0T0000000000000000T125', 'recept', 'Svíčková'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoType(page, 'recept');
  assert.ok(await seen(createTypeButton(page, 'recept'), 2000), 'red guard: the undefined type page is the D-251 one');
  assert.equal(await columnsButton(page).count(), 0, 'no Columns on an undefined type');
  for (const key of ['rozbitý', 'budoucí']) {
    await runCommand(page, `Go to type: ${key === 'budoucí' ? 'Budoucí' : key}`);
    await sleep(500);
    const b = await must(columnsButton(page), `Columns on ${key}`);
    assert.equal(await b.getAttribute('aria-disabled'), 'true', `${key}: aria-disabled`);
    assert.notEqual(await description(b), '', `${key}: with the reason`);
    await b.click({ force: true });
  }
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'no type write');
  void mainName;
});
