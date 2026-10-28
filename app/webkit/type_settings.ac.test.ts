// MS3 slice 3D, L5 (WebKit + fake core): the type settings page and the New type dialog. AR-07 AC-2…AC-4; FR-TYP-01
// AC-1…AC-9; FR-TYP-02 AC-1, AC-5; FR-TYP-03 AC-1…AC-11; FR-TYP-04 AC-4, AC-5; FR-TYP-05 AC-1, AC-3, AC-5; FR-TYP-06
// AC-1…AC-4; FR-TYP-11 AC-1, AC-2; FR-TYP-12 AC-1, AC-2. Written from docs/acceptance/types.md (R12, R14) and
// docs/contracts/ms3-shell.md §14.3, §14.7 only (D-61). Every lookup goes through `must`/`seen` and node:assert, so a
// missing element is an AssertionError, not a Playwright timeout (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { focused, mainName, paletteOptions } from './helpers';
import {
  P, callsOf, commit, description, dialog, eventually, fileText, fileWhen, fixture, gotoSettings, gotoTypePage, isDisabled,
  main, must, newTypeDialog, nonReadCalls, openNoteByTitle, openTypes, original, otherProps, props, property, runCommand,
  section, seen, settingsHeading, sidebar, sleep, stateIs, swap, typeFile, typesList, typesVault, writtenOutside,
} from './types-helpers';

const osoba = () => original(typeFile('osoba'));
const schuzka = () => original(typeFile('schůzka'));
const projekt = () => original(typeFile('projekt'));
const general = (page: Page) => section(page, 'General');
const textbox = (page: Page, sec: string, name: string) => section(page, sec).getByRole('textbox', { name, exact: true });

/** Clicks the sidebar's `New type` (enabled in 3D, R3); a disabled button is an assertion failure, not a timeout. */
async function openNewType(page: Page) {
  const b = await must(sidebar(page).getByRole('button', { name: 'New type', exact: true }), 'sidebar New type');
  assert.equal(await isDisabled(b), false, 'New type is enabled (R3)');
  await b.click();
}
async function openSchuzka(page: Page, vault = typesVault()) {
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  return core;
}
async function expand(page: Page, name: string) {
  const g = await must(property(page, name), `property group "${name}"`);
  const edit = g.getByRole('button', { name: `Edit ${name}`, exact: true });
  if (await seen(edit, 500)) await edit.click();
  return g;
}

// ------------------------------------------------------------------------------------------------ AR-07

test('ar_07_ac2_missing_version_writes_nothing_until_the_first_change', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('osoba')] = swap(f[typeFile('osoba')], 'version: 1\n', ''); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Osoby');
  await gotoSettings(page, 'Osoby', 'Osoba');
  assert.ok(!(await seen(main(page).getByRole('status').filter({ hasText: /version/i }), 500)), 'no warning for a missing version');
  assert.deepEqual(await nonReadCalls(core), [], 'opening the vault, the type page and type settings write nothing');
  await (await must(general(page).getByRole('radiogroup', { name: 'Color' }).getByRole('radio', { name: 'Teal', exact: true }), 'radio Teal')).click();
  const got = await fileWhen(core, typeFile('osoba'), (t) => !!t?.includes('color: teal'));
  assert.equal(got, swap(osoba(), 'color: purple\n', 'color: teal\n'), 'version: 1 first after the header; only the color line otherwise');
});

test('ar_07_ac3_newer_version_is_used_but_read_only_in_settings', async ({ page }) => {
  const core = await openTypes(page);
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Budoucí' })), 'sidebar lists Budoucí');
  await gotoSettings(page, 'Budoucí', 'Budoucí');
  await must(main(page).getByRole('status').filter({ hasText: 'Made by a newer version of Tegg. Read-only.' }), 'newer-version notice');
  const controls = main(page).locator('input, textarea, select, button, [role="radio"], [role="switch"], [role="combobox"]').filter({ hasNot: page.locator('[aria-hidden="true"]') });
  const n = await controls.count();
  const enabled: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i);
    const label = (await c.getAttribute('aria-label')) ?? (await c.innerText().catch(() => '')) ?? '';
    if (/^(Settings sections|General|Properties|Built in|Preview|Review|Templates|Views|Delete type)/.test(label) && (await c.getAttribute('href')) !== null) continue;
    if (!(await isDisabled(c))) enabled.push(label.trim());
  }
  assert.deepEqual(enabled.filter((l) => !/^(General|Properties|Built in on every type|Preview properties|Review workflow|Templates|Views|Delete type)$/.test(l)), [], 'every control disabled');
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Escape');
  assert.deepEqual((await core.calls()).filter((c) => ['type_patch', 'type_delete'].includes(c.cmd)), [], 'no command that writes the type file');
  assert.equal(await fileText(core, typeFile('budoucí')), original(typeFile('budoucí')), 'bytes unchanged');
});

test('ar_07_ac4_invalid_type_keeps_a_sidebar_entry_and_shows_the_error_read_only', async ({ page }) => {
  const core = await openTypes(page);
  const entry = await must(typesList(page).getByRole('listitem').filter({ hasText: 'rozbitý' }), 'sidebar entry named by the key');
  const link = entry.locator('a, button, [role="link"], [role="button"]').first();
  assert.equal(await description(link.or(entry)), 'Invalid type definition', 'marker');
  await link.click();
  await must(main(page).getByRole('table', { name: 'rozbitý' }), 'its type page lists its objects');
  await (await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings')).click();
  await must(main(page).getByRole('status').filter({ hasText: /^Line 4: / }), 'error text and line');
  assert.equal(await main(page).getByRole('button', { name: /^Delete .* type…$/ }).filter({ hasNot: page.locator('[aria-disabled="true"]') }).count() > 0 && !(await isDisabled(main(page).getByRole('button', { name: /^Delete .* type…$/ }))), false, 'nothing that writes');
  assert.deepEqual(await nonReadCalls(core), [], 'opening, indexing and showing never rewrite it');
  assert.equal(await fileText(core, typeFile('rozbitý')), original(typeFile('rozbitý')));
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01

test('fr_typ_01_ac1_new_type_dialog_from_sidebar_and_palette_and_cancel_writes_nothing', async ({ page }) => {
  const core = await openTypes(page);
  const btn = await must(sidebar(page).getByRole('button', { name: 'New type', exact: true }), 'sidebar New type');
  assert.equal(await isDisabled(btn), false, 'New type is enabled (R3)');
  for (const how of ['button', 'palette', 'esc'] as const) {
    if (how === 'palette') await runCommand(page, 'New type…');
    else await btn.click();
    const d = await must(newTypeDialog(page), `dialog "New type" (${how})`);
    assert.equal((await focused(page)).label, 'Name', `${how}: Name focused`);
    await must(d.getByRole('textbox', { name: 'Plural name', exact: true }), 'Plural name');
    await must(d.getByRole('button', { name: 'Create', exact: true }), 'Create');
    await d.getByRole('textbox', { name: 'Name', exact: true }).fill('Zrušený');
    if (how === 'esc') await page.keyboard.press('Escape');
    else await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(!(await seen(newTypeDialog(page), 300)), `${how}: closed`);
  }
  assert.deepEqual(await nonReadCalls(core), [], 'Cancel, Esc and closing write nothing');
});

test('fr_typ_01_ac2_create_writes_exactly_the_type_file_and_opens_its_settings', async ({ page }) => {
  const core = await openTypes(page);
  await openNewType(page);
  const d = await must(newTypeDialog(page), 'New type');
  await d.getByRole('textbox', { name: 'Name', exact: true }).fill('Čajovna');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Čajovny');
  const t0 = Date.now();
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await must(settingsHeading(page, 'Čajovna'), 'type-settings/čajovna', 1000);
  assert.equal((await focused(page)).heading, true, 'focus on its heading (D-130)');
  assert.equal(await fileText(core, typeFile('čajovna')), fixture('types/expected/čajovna.yml'), 'byte-identical to the expected file');
  assert.deepEqual(await core.writesTo(), [typeFile('čajovna')], 'exactly one file: no folder, no template');
  const entry = await eventually(async () => (await typesList(page).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).find((t) => t.startsWith('Čajovny')), (t) => !!t, 1000);
  assert.equal(entry, 'Čajovny 0', `listed with count 0 within 1 s (after ${Date.now() - t0} ms)`);
});

test('fr_typ_01_ac2_a_file_that_appeared_is_never_overwritten', async ({ page }) => {
  const core = await openTypes(page);
  await openNewType(page);
  const d = await must(newTypeDialog(page), 'New type');
  await d.getByRole('textbox', { name: 'Name', exact: true }).fill('Čajovna');
  await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill('Čajovny');
  const theirs = '# z jiného Macu\nversion: 1\nname: Čajovna\nplural: Čajovny\nattributes: []\n';
  await core.setFile(typeFile('čajovna'), theirs, { silent: true });
  await d.getByRole('button', { name: 'Create', exact: true }).click();
  await must(d.getByText('A type with this name already exists'), 'message in the dialog');
  assert.equal(await fileText(core, typeFile('čajovna')), theirs, 'nothing overwritten');
});

test('fr_typ_01_ac3_name_rules_refuse_with_a_message_and_write_nothing', async ({ page }) => {
  const vault = typesVault((f) => { f['Recepty/Svíčková.md'] = '---\nid: 01JB0T0000000000000000T090\ntype: recept\ntitle: Svíčková\n---\n'; });
  const core = await openTypes(page, undefined, { vault });
  const cases: [string, string][] = [['', 'Prázdné jméno'], ['   ', 'Mezery'], ['Kniha', '  '], ['Page', 'Stránky'], ['quick note', 'Rychlé'], ['QUICK NOTE', 'Rychlé 2'], ['Osoba', 'Lidé'], ['a/b', 'Ab'], ['Kniha', 'Kni:hy'], ['č'.repeat(101), 'Dlouhé'], ['Kniha', 'osoby']];
  for (const [name, plural] of cases) {
    await openNewType(page);
    const d = await must(newTypeDialog(page), 'New type');
    await d.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await d.getByRole('textbox', { name: 'Plural name', exact: true }).fill(plural);
    await d.getByRole('button', { name: 'Create', exact: true }).click();
    const alert = d.getByRole('alert');
    assert.ok(await seen(alert, 1000), `${JSON.stringify(name)} / ${JSON.stringify(plural)}: a message naming the reason`);
    assert.notEqual((await alert.first().innerText()).trim(), '', 'message text');
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
  // A key used only by objects (D-121) is allowed; those objects become its objects.
  await openNewType(page);
  await newTypeDialog(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Recept');
  await newTypeDialog(page).getByRole('textbox', { name: 'Plural name', exact: true }).fill('Recepty');
  await newTypeDialog(page).getByRole('button', { name: 'Create', exact: true }).click();
  await must(settingsHeading(page, 'Recept'), 'created');
  await must(main(page).getByText(/Applies to 1 object/), 'Applies to 1 object');
});

test('fr_typ_01_ac4_general_edits_write_only_the_type_file_and_update_the_ui', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await commit(textbox(page, 'General', 'Name'), 'Porada');
  assert.ok(await stateIs(page, 'Saved', 1500), 'Saved within 1 s');
  assert.equal(await fileText(core, typeFile('schůzka')), swap(schuzka(), 'name: Schůzka\n', 'name: Porada\n'));
  await commit(textbox(page, 'General', 'Plural name'), 'Porady');
  await commit(textbox(page, 'General', 'Description'), 'Všechny porady.');
  await (await must(general(page).getByRole('radio', { name: 'Orange', exact: true }), 'Orange')).click();
  await (await must(general(page).getByRole('button', { name: 'Change icon', exact: true }), 'Change icon')).click();
  await (await must(page.getByRole('listbox', { name: 'Icon' }).getByRole('option').nth(17), 'icon briefcase (R14 #18)')).click();
  const want = swap(swap(swap(swap(swap(schuzka(), 'name: Schůzka\n', 'name: Porada\n'), 'plural: Schůzky\n', 'plural: Porady\n'), 'description: Porady a schůzky.\n', 'description: Všechny porady.\n'), 'color: teal\n', 'color: orange\n'), 'icon: users\n', 'icon: briefcase\n');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want), want, 'only the changed lines');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note file written; the file keeps its name');
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Porady' }), 1000), 'sidebar updated');
  await openNoteByTitle(page, '2026-10-07 Porada');
  await must(page.getByRole('link', { name: 'Type: Porada', exact: true }), 'the type chip shows the new Name (a link since D-369)');
  await gotoSettings(page, 'Porady', 'Porada');
  await commit(textbox(page, 'General', 'Name'), 'Po:rada');
  await must(general(page).getByRole('alert'), 'message under the field');
  assert.equal(await fileText(core, typeFile('schůzka')), want, 'an invalid entry is not written');
});

test('fr_typ_01_ac5_folder_applies_to_new_objects_and_is_checked', async ({ page }) => {
  const core = await openSchuzka(page);
  const folder = await must(textbox(page, 'General', 'Folder in the vault'), 'Folder in the vault');
  // 4E (D-805, D-817): no `Move existing objects`; saving the folder moves them (type-moves.md FR-STO-01 AC-8).
  assert.equal(await description(folder), 'New objects go here.');
  assert.equal(await general(page).getByRole('button', { name: 'Move existing objects' }).count(), 0, 'no Move existing objects control');
  for (const bad of ['', '/abs', '../ven', '.skryté', '_templates', '_attachments/x', '.trash', '.tegg/x', 'Pr:ce', 'Osoby', 'osoby']) {
    await commit(folder, bad);
    assert.ok(await seen(general(page).getByRole('alert'), 1000), `${JSON.stringify(bad)}: refused with a message`);
  }
  assert.equal(await fileText(core, typeFile('schůzka')), schuzka(), 'nothing written for refused folders');
  await commit(folder, 'Práce/Porady');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('Práce')), swap(schuzka(), 'folder: Schůzky\n', 'folder: Práce/Porady\n'));
  assert.ok(await eventually(async () => Object.keys(await core.files()).some((p) => p.startsWith('Práce/Porady/')), (x) => x, 3000), 'the existing Schůzka files move with it (D-805)');
});

test('fr_typ_01_ac6_external_type_file_changes_show_within_2s', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const teal = general(page).getByRole('radio', { name: 'Teal', exact: true });
  await must(teal, 'radio Teal');
  await core.setFile(typeFile('osoba'), swap(osoba(), 'color: purple\n', 'color: teal\n'));
  assert.equal(await eventually(() => teal.isChecked(), (v) => v, 2000), true, 'the open settings page shows the new colour within 2 s');
  await core.setFile(typeFile('kniha'), fixture('types/expected/čajovna.yml').replace('Čajovna', 'Kniha').replaceAll('Čajovny', 'Knihy'));
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Knihy' }), 2000), 'an added type file appears');
  await core.setFile(typeFile('projekt'), null);
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: /^projekt\s*3$/ }), 2000), 'its objects show under the undefined key (D-121)');
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

test('fr_typ_01_ac7_a_write_on_a_changed_file_is_refused_with_an_alert', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const theirs = swap(osoba(), 'color: purple\n', 'color: red\n');
  await core.setFile(typeFile('osoba'), theirs, { silent: true });
  await (await must(general(page).getByRole('radio', { name: 'Teal', exact: true }), 'Teal')).click();
  await must(page.getByRole('alert').filter({ hasText: "Changed outside Tegg. Your change to Color wasn't saved." }), 'non-modal alert');
  assert.equal(await page.getByRole('dialog').count(), 0, 'non-modal');
  assert.equal(await fileText(core, typeFile('osoba')), theirs, 'the file keeps the external bytes');
  assert.equal(await general(page).getByRole('radio', { name: 'Red', exact: true }).isChecked(), true, 'the page reloaded the disk version');
  const patches = await callsOf(core, 'type_patch');
  assert.ok(patches.length >= 1 && (patches[0].args as any).base !== null, 'the write carried the version as last read');
});

test('fr_typ_01_ac8_templates_and_views_sections', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Nápady', 'Nápad');
  const tpl = await must(section(page, 'Templates'), 'section Templates');
  assert.ok(await seen(tpl.getByText('_templates/Nápad/Nápad.md')), 'the default template path');
  assert.ok(await seen(tpl.getByText('Default', { exact: true })), 'marked Default');
  for (const l of ['New template', 'Edit']) {
    const b = await must(tpl.getByRole('button', { name: l, exact: true }), l);
    assert.equal(await b.getAttribute('aria-disabled'), 'true');
    assert.equal(await description(b), 'Coming in v1.0');
  }
  const views = await must(section(page, 'Views'), 'section Views');
  assert.ok(await seen(views.getByText('All Nápady')), 'All Nápady');
  assert.ok(await seen(views.getByText('Default', { exact: true })), 'marked Default');
  for (const l of ['Add view', 'Edit']) {
    const b = await must(views.getByRole('button', { name: l, exact: true }), l);
    assert.equal(await b.getAttribute('aria-disabled'), 'true');
    assert.equal(await description(b), 'Coming in v1.0');
  }
});

test('fr_typ_01_ac9_sections_contrast_and_palette_commands', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Projekty', 'Projekt');
  const nav = await must(main(page).getByRole('navigation', { name: 'Settings sections' }), 'Settings sections');
  assert.deepEqual((await nav.getByRole('link').allInnerTexts()).map((t) => t.trim()), ['General', 'Properties', 'Built in on every type', 'Preview properties', 'Hidden properties', 'Embeds', 'Review workflow', 'Templates', 'Views', 'Delete type']);
  await must(main(page).getByText(/^Applies to 3 objects · stored in \.tegg\/types\/projekt\.yml$/), 'Applies line');
  for (const n of ['Stav', 'Období', 'Rozpočet', 'Aktivní', 'Oblasti', 'Web', 'Poznámka']) await expand(page, n);
  for (const theme of ['Theme: Light', 'Theme: Dark']) {
    await runCommand(page, theme);
    await sleep(200);
    assert.deepEqual(await axeContrast(page), [], `type-settings/projekt contrast (${theme})`);
  }
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('New type');
  await sleep(60);
  assert.ok((await paletteOptions(page)).some((o) => o.split('\n')[0].trim() === 'New type…'), 'R13 New type… in the palette');
  await page.keyboard.press('Escape');
  for (const theme of ['Theme: Light', 'Theme: Dark']) {
    await runCommand(page, theme);
    await runCommand(page, 'New type…');
    await must(newTypeDialog(page), 'New type');
    assert.deepEqual(await axeContrast(page), [], `New type dialog contrast (${theme})`);
    await page.keyboard.press('Escape');
    await gotoTypePage(page, 'Projekty');
    assert.deepEqual(await axeContrast(page), [], `type/projekt contrast (${theme})`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-02, FR-TYP-03

test('fr_typ_02_ac1_type_control_offers_the_r10_types', async ({ page }) => {
  await openSchuzka(page);
  await (await must(section(page, 'Properties').getByRole('button', { name: 'Add property', exact: true }), 'Add property')).click();
  await (await must(section(page, 'Properties').getByRole('combobox', { name: 'Type', exact: true }).last(), 'Type')).click();
  const opts = (await page.getByRole('option').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(opts, ['Text', 'Long text', 'Number', 'Checkbox', 'Date', 'Date-time', 'Date range', 'Select', 'Multi-select', 'URL', 'Email', 'Relation']);
});

test('fr_typ_02_ac5_unsupported_type_is_kept_with_a_warning', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Osoby', 'Osoba');
  const g = await expand(page, 'Hodnocení');
  await must(g.getByText("Rating isn't supported yet; the property is kept"), 'warning');
  for (const n of ['Name', 'Description']) {
    const f = g.getByRole('textbox', { name: n, exact: true });
    if (await seen(f, 300)) assert.equal(await isDisabled(f), true, `${n} not editable`);
  }
  assert.equal(await isDisabled(await must(g.getByRole('button', { name: 'Delete property…', exact: true }), 'Delete property…')), false, 'deletion allowed');
  await (await must(general(page).getByRole('radio', { name: 'Teal', exact: true }), 'Teal')).click();
  const t = await fileWhen(core, typeFile('osoba'), (x) => !!x?.includes('color: teal'));
  assert.ok(t?.includes('  - key: hodnocení\n    name: Hodnocení\n    type: rating\n'), 'kept byte for byte');
});

async function addProperty(page: Page, name: string) {
  await (await must(section(page, 'Properties').getByRole('button', { name: 'Add property', exact: true }), 'Add property')).click();
  const f = await focused(page);
  assert.equal(f.label, 'Name', 'Name focused in the new row');
  await page.keyboard.type(name);
}

test('fr_typ_03_ac1_add_property_derives_the_key_and_appends_three_lines', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Osoby', 'Osoba');
  await addProperty(page, 'Telefon do práce');
  const key = section(page, 'Properties').getByRole('textbox', { name: 'Key in frontmatter', exact: true }).last();
  assert.equal(await key.inputValue(), 'telefon-do-práce', 'key derived (D-223)');
  assert.equal((await section(page, 'Properties').getByRole('combobox', { name: 'Type', exact: true }).last().innerText()).trim(), 'Text', 'Type starts at Text');
  await section(page, 'Properties').getByRole('button', { name: 'Add', exact: true }).click();
  const want = `${osoba()}  - key: telefon-do-práce\n    name: Telefon do práce\n    type: text\n`;
  assert.equal(await fileWhen(core, typeFile('osoba'), (t) => t === want), want);
  assert.deepEqual(await writtenOutside(core, [typeFile('osoba')]), [], 'no note written');
});

test('fr_typ_03_ac1_a_key_edited_by_hand_stops_following_the_name', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Osoby', 'Osoba');
  await addProperty(page, 'Telefon');
  const key = section(page, 'Properties').getByRole('textbox', { name: 'Key in frontmatter', exact: true }).last();
  await key.fill('mobil');
  const name = section(page, 'Properties').getByRole('textbox', { name: 'Name', exact: true }).last();
  await name.fill('Telefon domů');
  assert.equal(await key.inputValue(), 'mobil');
});

test('fr_typ_03_ac2_reserved_and_invalid_keys_are_refused', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Projekty', 'Projekt');
  for (const [k, msg] of [['source', '"source" is a built-in property'], ['ID', null], ['file', null], ['captured', null], ['stav', null], ['1rok', null], ['a.b', null], ['období-start', null], ['období-end', null]] as const) {
    await addProperty(page, 'Nová');
    const key = section(page, 'Properties').getByRole('textbox', { name: 'Key in frontmatter', exact: true }).last();
    await key.fill(k);
    await section(page, 'Properties').getByRole('button', { name: 'Add', exact: true }).click();
    const alert = section(page, 'Properties').getByRole('alert');
    assert.ok(await seen(alert, 1000), `${k}: refused with a message`);
    if (msg) assert.equal((await alert.first().innerText()).trim(), msg);
    await section(page, 'Properties').getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  assert.equal(await fileText(core, typeFile('projekt')), projekt(), 'nothing written');
});

test('fr_typ_03_ac3_adding_a_property_adopts_existing_values', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  await must(otherProps(page), 'Other properties button');
  assert.equal((await otherProps(page).innerText()).trim(), 'Other properties (1)');
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await addProperty(page, 'Nálada');
  await section(page, 'Properties').getByRole('button', { name: 'Add', exact: true }).click();
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('key: nálada'));
  await openNoteByTitle(page, '2026-10-07 Porada');
  const box = await must(props(page).getByRole('textbox', { name: 'Nálada', exact: true }), 'nálada in the schema rows');
  assert.equal(await box.inputValue().catch(async () => (await box.innerText()).trim()), 'dobrá');
  assert.equal(await otherProps(page).count(), 0, 'no Other properties button when none are left (D-314)');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note written');
});

test('fr_typ_03_ac4_existing_key_is_read_only_and_name_writes_only_the_type_file', async ({ page }) => {
  const core = await openSchuzka(page);
  const g = await expand(page, 'Místo');
  const key = await must(g.getByRole('textbox', { name: 'Key in frontmatter', exact: true }), 'Key in frontmatter');
  assert.equal(await isDisabled(key), true, 'key read-only');
  assert.equal(await description(key), 'Renaming keys comes in v1.0');
  await commit(g.getByRole('textbox', { name: 'Name', exact: true }), 'Místnost');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('Místnost')), swap(schuzka(), '    name: Místo\n', '    name: Místnost\n'));
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), []);
});

test('fr_typ_03_ac5_options_add_reorder_remove_and_used_labels', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Projekty', 'Projekt');
  const g = await expand(page, 'Stav');
  const list = await must(g.getByRole('list', { name: 'Options' }), 'list Options');
  assert.ok(await seen(list.getByRole('listitem').filter({ hasText: 'Běží' }).getByText('Used by 1')), 'Běží: Used by 1');
  const used = list.getByRole('listitem').filter({ hasText: 'Běží' }).getByRole('textbox', { name: 'Option label' });
  assert.equal(await isDisabled(used), true, 'a used label is read-only');
  assert.equal(await description(used), 'Renaming used options comes in v1.0');
  await (await must(g.getByRole('button', { name: 'Add option', exact: true }), 'Add option')).click();
  await commit(list.getByRole('textbox', { name: 'Option label' }).last(), 'Pozastaveno');
  const added = await fileWhen(core, typeFile('projekt'), (t) => !!t?.includes('Pozastaveno'));
  assert.ok(added?.startsWith(swap(projekt(), '      - { label: Hotovo, color: green }\n', '      - { label: Hotovo, color: green }\n      - { label: Pozastaveno').split('      - { label: Pozastaveno')[0]), 'only the options lines change');
  await list.getByRole('button', { name: 'Drag to reorder Plánovaný', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await fileWhen(core, typeFile('projekt'), (t) => !!t && t.indexOf('label: Běží') < t.indexOf('label: Plánovaný'));
  await commit(list.getByRole('textbox', { name: 'Option label' }).last(), 'běží');
  await must(g.getByRole('alert'), 'duplicate label refused (case-insensitive)');
  await list.getByRole('button', { name: 'Remove option Běží', exact: true }).click();
  const d = await must(dialog(page, 'Remove option "Běží"?'), 'dialog');
  assert.match(await d.innerText(), /1 objects? uses? "Běží"\. Their values stay in the files and show as not an option\./);
  await d.getByRole('button', { name: 'Remove', exact: true }).click();
  await fileWhen(core, typeFile('projekt'), (t) => !t?.includes('label: Běží'));
  assert.deepEqual(await writtenOutside(core, [typeFile('projekt')]), [], 'no note written');
});

test('fr_typ_03_ac6_default_value_uses_the_property_control', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Projekty', 'Projekt');
  const g = await expand(page, 'Stav');
  await (await must(g.getByRole('combobox', { name: 'Default value', exact: true }), 'Default value (Select control)')).click();
  await page.getByRole('option', { name: 'Hotovo', exact: true }).click();
  assert.equal(await fileWhen(core, typeFile('projekt'), (t) => !!t?.includes('default: Hotovo')), swap(projekt(), '    default: Plánovaný\n', '    default: Hotovo\n'));
  const s = await openSchuzka(page);
  const rel = await expand(page, 'Účastníci');
  assert.equal(await rel.getByRole('combobox', { name: 'Default value' }).or(rel.getByRole('textbox', { name: 'Default value' })).count(), 0, 'no default for Relation in 3D');
  assert.deepEqual(await writtenOutside(core, [typeFile('projekt')]), []);
  void s;
});

test('fr_typ_03_ac7_required_writes_true_and_unchecking_removes_it', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Projekty', 'Projekt');
  const g = await expand(page, 'Web');
  const req = await must(g.getByRole('checkbox', { name: 'Required', exact: true }), 'Required');
  await req.click();
  assert.equal(await fileWhen(core, typeFile('projekt'), (t) => !!t?.includes('type: url\n    required: true')), swap(projekt(), '    type: url\n', '    type: url\n    required: true\n'));
  await req.click();
  assert.equal(await fileWhen(core, typeFile('projekt'), (t) => t === projekt()), projekt(), 'unchecked: key removed');
});

test('fr_typ_03_ac8_description_written_and_shown_in_the_panel', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const misto = await must(props(page).getByRole('textbox', { name: 'Místo', exact: true }), 'Místo');
  assert.ok((await description(misto)).startsWith('Kde se schůzka konala'), 'the value control\'s description');
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  const g = await expand(page, 'Místo');
  await commit(g.getByRole('textbox', { name: 'Description', exact: true }), 'Místnost nebo město');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('Místnost nebo')), swap(schuzka(), '    description: Kde se schůzka konala\n', '    description: Místnost nebo město\n'));
});

test('fr_typ_03_ac9_reorder_with_the_keyboard_moves_items_unchanged', async ({ page }) => {
  const core = await openSchuzka(page);
  const handle = await must(section(page, 'Properties').getByRole('button', { name: 'Drag to reorder Místo', exact: true }), 'handle');
  await handle.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+ArrowUp');
  const items = (t: string) => t.slice(t.indexOf('attributes:\n') + 12).split(/(?=^ {2}- )/m);
  const orig = items(schuzka());
  const want = schuzka().slice(0, schuzka().indexOf('attributes:\n') + 12) + [orig[4], ...orig.slice(0, 4)].join('');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want, 3000), want, 'Místo above Datum, each item byte-identical');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), []);
});

test('fr_typ_03_ac10_relation_allowed_types_and_multiple', async ({ page }) => {
  const core = await openSchuzka(page);
  const g = await expand(page, 'Účastníci');
  const allowed = await must(g.getByRole('group', { name: 'Allowed types' }), 'Allowed types');
  await allowed.getByRole('checkbox', { name: 'Projekt', exact: true }).click();
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('to: [osoba, projekt]'));
  await g.getByRole('checkbox', { name: 'Multiple', exact: true }).click();
  const want = swap(schuzka(), '    to: [osoba]\n    multiple: true\n', '    to: [osoba, projekt]\n');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want), want);
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), []);
});

test('fr_typ_03_ac11_changing_a_property_type_counts_misfits_first', async ({ page }) => {
  const core = await openSchuzka(page);
  let g = await expand(page, 'Místo');
  await g.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'Number', exact: true }).click();
  let d = await must(dialog(page, 'Change type of "Místo"?'), 'confirmation');
  assert.ok((await d.innerText()).includes("0 objects have values that aren't valid for Number. They stay unchanged in the files."));
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await fileText(core, typeFile('schůzka')), schuzka(), 'Cancel writes nothing');
  await core.setFile(P.porada, swap(original(P.porada), 'místo:\n', 'místo: Zasedačka\n'));
  g = await expand(page, 'Místo');
  await g.getByRole('combobox', { name: 'Type', exact: true }).click();
  await page.getByRole('option', { name: 'Number', exact: true }).click();
  d = await must(dialog(page, 'Change type of "Místo"?'), 'confirmation');
  assert.ok((await d.innerText()).includes("1 objects have values that aren't valid for Number") || (await d.innerText()).includes("1 object has a value that isn't valid for Number"), 'n counted by the core');
  assert.ok((await callsOf(core, 'type_misfits')).length >= 1, 'type_misfits asked');
  await d.getByRole('button', { name: 'Change type', exact: true }).click();
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('type: number')), swap(schuzka(), '    name: Místo\n    type: text\n', '    name: Místo\n    type: number\n'));
  assert.deepEqual((await core.writesTo()).filter((p) => p.endsWith('.md')), [], 'no note written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-04, FR-TYP-05

test('fr_typ_04_ac4_delete_property_keeps_the_values', async ({ page }) => {
  const vault = typesVault((f) => { f[P.porada] = swap(f[P.porada], 'místo:\n', 'místo: Zasedačka\n'); });
  const core = await openSchuzka(page, vault);
  const g = await expand(page, 'Místo');
  await g.getByRole('button', { name: 'Delete property…', exact: true }).click();
  const d = await must(dialog(page, 'Delete property "Místo"?'), 'dialog');
  const keep = await must(d.getByRole('button', { name: 'Keep values in notes', exact: true }), 'Keep values in notes');
  assert.equal(await description(keep), 'They stay in the files and show under Other properties.');
  const remove = await must(d.getByRole('button', { name: /^Remove values from \d+ notes?$/ }), 'Remove values from <n> notes');
  assert.equal(await remove.getAttribute('aria-disabled'), 'true');
  assert.equal(await description(remove), 'Coming in v1.0'); // D-748
  assert.equal((await focused(page)).label, 'Keep values in notes', 'default choice');
  await keep.click();
  const want = swap(schuzka(), '  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n', '');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want), want, 'item removed in one write');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'one type_patch');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note written');
  await openNoteByTitle(page, '2026-10-07 Porada');
  await (await must(otherProps(page), 'Other properties')).click();
  assert.ok(await seen(page.getByRole('list', { name: 'Other properties' }).getByText('místo')), 'místo under Other properties');
});

test('fr_typ_04_ac5_schema_changes_never_write_notes', async ({ page }) => {
  const core = await openSchuzka(page);
  const before = await core.files();
  const g = await expand(page, 'Místo');
  await commit(g.getByRole('textbox', { name: 'Name', exact: true }), 'Místnost');
  // The group is named after the property's current Name (as the drag handle below).
  const g2 = await must(property(page, 'Místnost'), 'property group "Místnost"');
  await commit(g2.getByRole('textbox', { name: 'Description', exact: true }), 'Kde to bylo');
  await g2.getByRole('checkbox', { name: 'Required', exact: true }).click();
  await section(page, 'Properties').getByRole('button', { name: 'Drag to reorder Místnost', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await sleep(500);
  assert.ok((await callsOf(core, 'type_patch')).length >= 4, 'the changes were sent');
  const after = await core.files();
  for (const p of Object.keys(before).filter((x) => x.endsWith('.md'))) assert.equal(after[p], before[p], `${p} byte-identical`);
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), []);
});

test('fr_typ_05_ac1_delete_a_type_without_objects', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Prázdné', 'Prázdný');
  await (await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Prázdný type…', exact: true }), 'Delete Prázdný type…')).click();
  const d = await must(dialog(page, 'Delete type "Prázdný"?'), 'dialog');
  assert.ok((await d.innerText()).includes('No objects use this type.'));
  assert.equal((await focused(page)).label, 'Cancel', 'Cancel is the default');
  await d.getByRole('button', { name: 'Delete type', exact: true }).click();
  await must(page.getByRole('heading', { level: 1, name: 'Pages' }), 'route type/page');
  assert.equal((await focused(page)).heading, true, 'focus on its heading');
  const files = await core.files();
  assert.equal(files['.trash/.tegg/types/prázdný.yml'], original(typeFile('prázdný')));
  assert.equal(files['.trash/_templates/Prázdný/Prázdný.md'], original('_templates/Prázdný/Prázdný.md'));
  assert.ok(!(typeFile('prázdný') in files) && !('_templates/Prázdný/Prázdný.md' in files));
  assert.ok(!(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Prázdné' }), 500)), 'sidebar entry gone');
  await page.keyboard.press('Meta+BracketLeft');
  await must(main(page).getByRole('status').filter({ hasText: 'This type no longer exists.' }), 'Back shows the notice');
});

test('fr_typ_05_ac3_a_type_with_objects_cannot_be_deleted_in_ms3', async ({ page }) => {
  const core = await openSchuzka(page);
  await (await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Schůzka type…', exact: true }), 'Delete Schůzka type…')).click();
  const d = await must(dialog(page, 'Delete type "Schůzka"?'), 'dialog');
  assert.ok((await d.innerText()).includes('3 objects use this type.'));
  for (const l of ['Change their type to…', 'Move them to the trash']) {
    const b = await must(d.getByRole('button', { name: l, exact: true }), l);
    assert.equal(await b.getAttribute('aria-disabled'), 'true');
    assert.equal(await description(b), 'Coming in v1.0'); // D-748
  }
  assert.equal(await isDisabled(d.getByRole('button', { name: 'Delete type', exact: true })), true, 'Delete type disabled');
  await page.keyboard.press('Escape');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
});

test('fr_typ_05_ac5_delete_rechecks_in_the_core', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Prázdné', 'Prázdný');
  await (await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Prázdný type…', exact: true }), 'Delete')).click();
  const d = await must(dialog(page, 'Delete type "Prázdný"?'), 'dialog');
  await core.setFile('Prázdné/Nový.md', '---\nid: 01JB0T0000000000000000T091\ntype: prázdný\ntitle: Nový\n---\n');
  await d.getByRole('button', { name: 'Delete type', exact: true }).click();
  await must(page.getByText('Prázdný now has 1 object.'), 'message');
  assert.equal(await fileText(core, typeFile('prázdný')), original(typeFile('prázdný')), 'nothing written');
  assert.deepEqual(await core.writesTo(), []);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-06

test('fr_typ_06_ac1_system_types_have_no_delete', async ({ page }) => {
  await openTypes(page);
  for (const [plural, name] of [['Pages', 'Page'], ['Tasks', 'Task'], ['Quick Notes', 'Quick Note'], ['Daily Notes', 'Daily Note'], ['Images', 'Image'], ['PDFs', 'PDF']]) {
    await gotoSettings(page, plural, name);
    const sec = await must(section(page, 'Delete type'), `${name}: section Delete type`);
    assert.equal(await sec.getByRole('button', { name: /^Delete .* type…$/ }).count(), 0, `${name}: no Delete type button`);
    assert.ok(await seen(sec.getByText("System types can't be deleted.")), `${name}: explanation`);
  }
});

test('fr_typ_06_ac2_built_in_attributes_are_locked', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Tasks', 'Task');
  for (const n of ['Status', 'Priority', 'Due date', 'Completed', 'Recurrence']) {
    const g = await must(property(page, n), `property ${n}`);
    assert.ok(await seen(g.getByText('Built in', { exact: true })), `${n}: badge Built in`);
    const edit = g.getByRole('button', { name: `Edit ${n}`, exact: true });
    if (await seen(edit, 300)) await edit.click();
    for (const f of ['Name', 'Key in frontmatter', 'Description']) {
      const x = g.getByRole('textbox', { name: f, exact: true });
      if (await seen(x, 200)) {
        assert.equal(await isDisabled(x), true, `${n}: ${f} disabled`);
        assert.ok((await description(x)).includes("Built-in properties can't be changed"), `${n}: ${f} explained`);
      }
    }
    const del = g.getByRole('button', { name: 'Delete property…', exact: true });
    if (await seen(del, 200)) assert.equal(await isDisabled(del), true, `${n}: Delete property… disabled`);
  }
  const status = await must(property(page, 'Status'), 'Status');
  const label = status.getByRole('textbox', { name: 'Option label' }).first();
  // D-489: Task status options are editable since 5A-1 (tasks.md FR-TSK-02 AC-2); a used label says why it is read-only.
  assert.notEqual(await description(label), 'Coming in MS5', 'Task status labels are no longer Coming in MS5 (FR-TSK-02)');
});

test('fr_typ_06_ac3_what_system_types_allow', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Tasks', 'Task');
  for (const f of ['Name', 'Plural name']) {
    const x = await must(textbox(page, 'General', f), f);
    assert.equal(await isDisabled(x), true, `${f} disabled`);
    assert.equal(await description(x), "System type names can't be changed");
  }
  await addProperty(page, 'Kontext');
  await section(page, 'Properties').getByRole('button', { name: 'Add', exact: true }).click();
  const task = fixture('vaults/new-empty/.tegg/types/task.yml');
  assert.equal(await fileWhen(core, typeFile('task'), (t) => !!t?.includes('kontext')), `${task}  - key: kontext\n    name: Kontext\n    type: text\n`, 'one item after recurrence');
});

test('fr_typ_06_ac4_missing_system_file_uses_defaults_and_the_first_change_creates_it', async ({ page }) => {
  const vault = typesVault((f) => { delete f[typeFile('task')]; });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Tasks');
  await gotoSettings(page, 'Tasks', 'Task');
  assert.deepEqual(await nonReadCalls(core), [], 'opening its page and settings writes nothing');
  await (await must(general(page).getByRole('radio', { name: 'Red', exact: true }), 'Red')).click();
  const task = fixture('vaults/new-empty/.tegg/types/task.yml');
  assert.equal(await fileWhen(core, typeFile('task'), (t) => t !== undefined), swap(task, 'color: blue\n', 'color: red\n'), 'the whole default file with only that change');
  const p = await callsOf(core, 'type_patch');
  assert.equal((p[0]?.args as any)?.base, null, 'base null for a system type without a file');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11, FR-TYP-12

test('fr_typ_11_ac1_up_to_four_preview_properties', async ({ page }) => {
  const core = await openSchuzka(page);
  const sec = await must(section(page, 'Preview properties'), 'Preview properties');
  const chips = sec.getByRole('list', { name: 'Preview properties' }).getByRole('listitem');
  assert.deepEqual((await chips.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/ Remove.*$/, '')), ['Datum', 'Účastníci']);
  await (await must(sec.getByRole('button', { name: 'Add (2 left)', exact: true }), 'Add (2 left)')).click();
  const menu = await must(page.getByRole('menu', { name: 'Add preview property' }), 'menu');
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  for (const x of ['Začátek', 'Projekt', 'Místo', 'Tags', 'Source', 'Aliases', 'Created', 'Modified']) assert.ok(items.includes(x), `${x} offered`);
  assert.ok(!items.includes('Datum'), 'chosen ones not offered');
  await menu.getByRole('menuitem', { name: 'Tags', exact: true }).click();
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('tags]')), swap(schuzka(), 'preview: [datum, účastníci]\n', 'preview: [datum, účastníci, tags]\n'));
  await sec.getByRole('button', { name: 'Add (1 left)', exact: true }).click();
  await page.getByRole('menu', { name: 'Add preview property' }).getByRole('menuitem', { name: 'Místo', exact: true }).click();
  const full = await must(sec.getByRole('button', { name: /^Add/ }), 'Add button');
  assert.equal(await full.getAttribute('aria-disabled'), 'true');
  assert.equal(await description(full), 'Up to 4 preview properties');
  await sec.getByRole('button', { name: 'Remove Datum from preview', exact: true }).click();
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('preview: [účastníci, tags, místo]'));
  await sec.getByRole('listitem').filter({ hasText: 'Místo' }).first().focus();
  await page.keyboard.press('Alt+ArrowLeft');
  assert.ok((await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('preview: [účastníci, místo, tags]')))?.includes('preview: [účastníci, místo, tags]'), 'reorder with ⌥←');
});

test('fr_typ_11_ac2_unknown_preview_keys_warn_and_stay', async ({ page }) => {
  const vault = typesVault((f) => { f[typeFile('osoba')] = swap(f[typeFile('osoba')], 'preview: [firma]\n', 'preview: [firma, neexistuje]\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, 'Osoby', 'Osoba');
  const sec = await must(section(page, 'Preview properties'), 'Preview properties');
  assert.ok(await seen(sec.getByText(/neexistuje/)), 'warning names the ignored key');
  assert.deepEqual(await nonReadCalls(core), [], 'kept in the file');
});

test('fr_typ_12_ac1_review_switch_writes_only_review', async ({ page }) => {
  const core = await openSchuzka(page);
  const sw = await must(section(page, 'Review workflow').getByRole('switch', { name: 'Review workflow' }), 'switch');
  assert.equal(await sw.isChecked(), false, 'off');
  await sw.click();
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('review: true')), swap(schuzka(), 'review: false\n', 'review: true\n'));
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note written');
});

test('fr_typ_12_ac2_locked_on_quick_and_daily_notes', async ({ page }) => {
  const core = await openTypes(page);
  for (const [plural, name] of [['Quick Notes', 'Quick Note'], ['Daily Notes', 'Daily Note']]) {
    await gotoSettings(page, plural, name);
    const sw = await must(section(page, 'Review workflow').getByRole('switch', { name: 'Review workflow' }), `${name} switch`);
    assert.equal(await sw.isChecked(), true, `${name}: checked`);
    assert.equal(await sw.getAttribute('aria-disabled'), 'true');
    assert.equal(await description(sw), 'Always on for Quick Notes and Daily Notes');
    await sw.click({ force: true });
  }
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'type_patch'), [], 'nothing sent');
  void mainName;
});
