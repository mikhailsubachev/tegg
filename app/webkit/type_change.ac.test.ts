// MS3 slice 3D, L5 (WebKit + fake core): changing an object's type (MS3 part, D-224) and type matching (D-239).
// FR-TYP-07 AC-4…AC-10; FR-TYP-13 AC-1, AC-2; links.md FR-STO-04 / FR-TYP-07 AC-3 (attributes kept, [MS3] by D-228).
// Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.7 only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, changeTypeMenu, control, description, eventually, fileText, gotoTypePage, lastWrite, must, noModified, nonReadCalls,
  openTypes, original, otherProps, props, rowTitles, runCommand, seen, sleep, swap, typeChip, typesList, typesVault,
} from './types-helpers';

type Core = Awaited<ReturnType<typeof openTypes>>;
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
async function changeTo(page: Page, name: string) {
  await (await must(typeChip(page), 'type chip')).click();
  const menu = await must(changeTypeMenu(page), 'menu "Change type"');
  await menu.getByRole('menuitem', { name, exact: true }).click();
}
const count = async (page: Page, label: string) => {
  const t = (await typesList(page).getByRole('listitem').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => x.startsWith(`${label} `));
  return t ? Number(/(\d+)$/.exec(t)?.[1] ?? 0) : 0;
};

test('fr_typ_07_ac4_the_type_chip_and_its_menu', async ({ page }) => {
  await openTypes(page, P.obycejna);
  const chip = await must(page.getByRole('button', { name: 'Type: Page. Change type', exact: true }), 'chip');
  assert.equal(await chip.getAttribute('aria-haspopup'), 'menu');
  assert.equal(await chip.getAttribute('aria-expanded'), 'false');
  await chip.click();
  const items = (await (await must(changeTypeMenu(page), 'menu')).getByRole('menuitem').allInnerTexts()).map((x) => x.trim());
  for (const t of ['Task', 'Quick Note', 'Schůzka', 'Osoba', 'Projekt', 'Nápad']) assert.ok(items.includes(t), `${t} is a target`);
  for (const t of ['Page', 'Daily Note', 'Tag', 'Image', 'PDF']) assert.ok(!items.includes(t), `${t} is not a target`);
  await page.keyboard.press('Escape');
  assert.equal(await chip.getAttribute('aria-expanded'), 'false', 'Esc closes');
  await runCommand(page, 'Change type…');
  await must(changeTypeMenu(page), 'the palette command opens the same menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
});

test('fr_typ_07_ac4_daily_note_and_read_only_files_have_a_disabled_chip', async ({ page }) => {
  await openTypes(page, P.denni);
  const chip = await must(page.getByRole('button', { name: 'Type: Daily Note. Change type', exact: true }), 'chip');
  assert.equal(await chip.getAttribute('aria-disabled'), 'true');
  assert.equal(await description(chip), "The type of a Daily Note can't be changed");
});

test('fr_typ_07_ac5_only_the_type_line_changes_and_counts_follow', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  const [pages, schuzky] = [await count(page, 'Pages'), await count(page, 'Schůzky')];
  await changeTo(page, 'Schůzka');
  const t = await written(core, P.obycejna, (x) => x.includes('type: schůzka'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.obycejna), 'type: page\n', 'type: schůzka\n')), 'type line and modified only');
  assert.deepEqual(await core.writesTo(), [P.obycejna], 'no other file; the file stays in Pages/ (FR-STO-04 MS4)');
  assert.equal(await eventually(() => count(page, 'Pages'), (n) => n === pages - 1, 2000), pages - 1, 'Pages −1');
  assert.equal(await eventually(() => count(page, 'Schůzky'), (n) => n === schuzky + 1, 2000), schuzky + 1, 'Schůzky +1');
  assert.equal(await props(page).getByRole('textbox', { name: 'Místo', exact: true }).inputValue(), 'Praha', 'místo in the schema rows');
  assert.equal((await otherProps(page).innerText()).trim(), 'Other properties (1)', 'nálada under Other properties');
  await gotoTypePage(page, 'Schůzky');
  assert.ok((await rowTitles(page, 'Schůzky')).includes('Obyčejná stránka'), 'type/schůzka lists it');
});

test('fr_sto_04_ac3_attributes_kept_on_type_change', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  const t = await written(core, P.obycejna, (x) => x.includes('type: schůzka'));
  assert.ok(t?.includes('místo: Praha\n') && t.includes('nálada: klidná\n'), 'both stay in the file');
  await (await must(otherProps(page), 'Other properties')).click();
  assert.ok(await seen(page.getByRole('list', { name: 'Other properties' }).getByText('nálada')), 'nálada under Other properties');
});

test('fr_typ_07_ac6_nothing_is_removed_and_back_restores_the_bytes', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  await written(core, P.obycejna, (x) => x.includes('type: schůzka'));
  await changeTo(page, 'Page');
  const t = await written(core, P.obycejna, (x) => x.includes('type: page'));
  assert.equal(noModified(t ?? ''), noModified(original(P.obycejna)), 'equals the original except modified');
  assert.equal((await otherProps(page).innerText()).trim(), 'Other properties (2)', 'místo and nálada under Other properties');
});

test('fr_typ_07_ac7_untyped_file_gets_type_then_identity', async ({ page }) => {
  const core = await openTypes(page, P.bez);
  await changeTo(page, 'Schůzka');
  const t = await written(core, P.bez, (x) => x.includes('type: schůzka'));
  assert.match(t ?? '', /^---\ntype: schůzka\nid: \S+\nmodified: \S+\n---\n/, 'type, then id and modified (D-174); no title or created');
  assert.ok((t ?? '').endsWith(`---\n${original(P.bez)}`), 'body byte-identical');
});

test('fr_typ_07_ac8_no_values_added', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Nápad');
  const t = await written(core, P.obycejna, (x) => x.includes('type: nápad'));
  assert.ok(t && !t.includes('review:') && !t.includes('hodnocení'), 'neither review nor the default');
});

test('fr_typ_07_ac9_undo_and_redo_a_type_change', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  await written(core, P.obycejna, (x) => x.includes('type: schůzka'));
  await (await must(typeChip(page), 'chip')).focus();
  await page.keyboard.press('Meta+z');
  assert.ok(await written(core, P.obycejna, (x) => x.includes('type: page')), 'one ⌘Z restores the previous type; the next save writes it');
  await page.keyboard.press('Meta+Shift+z');
  assert.ok(await written(core, P.obycejna, (x) => x.includes('type: schůzka')), '⇧⌘Z re-applies it');
});

test('fr_typ_07_ac10_a_type_list_becomes_one_string', async ({ page }) => {
  const core = await openTypes(page, P.dvaTypy);
  await changeTo(page, 'Projekt');
  const t = await written(core, P.dvaTypy, (x) => x.includes('type: projekt'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.dvaTypy), 'type: [projekt, osoba]\n', 'type: projekt\n')));
});

test('fr_typ_13_ac1_type_values_match_by_key', async ({ page }) => {
  const vault = typesVault((f) => {
    f['Pages/NFD schůzka.md'] = '---\nid: 01JB0T0000000000000000T097\ntype: schůzka\ntitle: NFD schůzka\n---\n';
    f['Pages/Rychlá.md'] = '---\nid: 01JB0T0000000000000000T098\ntype: Quick Note\ntitle: Rychlá\n---\n';
  });
  const core = await openTypes(page, P.velka, { vault });
  await must(page.getByRole('button', { name: 'Type: Projekt. Change type', exact: true }), 'Velká písmena is a Projekt');
  await must(control(page, 'combobox', 'Stav'), 'with the Projekt schema');
  await gotoTypePage(page, 'Projekty');
  assert.ok((await rowTitles(page, 'Projekty')).includes('Velká písmena'));
  await gotoTypePage(page, 'Schůzky');
  assert.ok((await rowTitles(page, 'Schůzky')).includes('NFD schůzka'), 'NFD value');
  await gotoTypePage(page, 'Quick Notes');
  assert.ok((await rowTitles(page, 'Quick Notes')).includes('Rychlá'), '`Quick Note`');
  assert.deepEqual(await nonReadCalls(core), [], 'never rewritten');
  assert.equal(await fileText(core, P.velka), original(P.velka));
});

test('fr_typ_13_ac2_values_that_are_not_one_type_are_pages_with_a_warning', async ({ page }) => {
  const vault = typesVault((f) => {
    f['Pages/Číslo.md'] = '---\nid: 01JB0T0000000000000000T099\ntype: 5\ntitle: Číslo\n---\n';
    f['Pages/Prázdný typ.md'] = '---\nid: 01JB0T0000000000000000T100\ntype:\ntitle: Prázdný typ\n---\n';
    f['Pages/Prázdný řetězec.md'] = '---\nid: 01JB0T0000000000000000T101\ntype: ""\ntitle: Prázdný řetězec\n---\n';
  });
  const core = await openTypes(page, P.dvaTypy, { vault });
  await must(page.getByRole('status').filter({ hasText: "The type value isn't a single type name. Shown as Page." }), 'warning');
  await must(page.getByRole('button', { name: 'Type: Page. Change type', exact: true }), 'shown as Page');
  await gotoTypePage(page, 'Pages');
  const rows = await rowTitles(page, 'Pages');
  for (const t of ['Dva typy', 'Číslo', 'Prázdný typ', 'Prázdný řetězec']) assert.equal(rows.filter((r) => r === t).length, 1, `${t} listed once on type/page`);
  for (const pl of ['Projekty', 'Osoby']) {
    await gotoTypePage(page, pl);
    assert.ok(!(await rowTitles(page, pl)).includes('Dva typy'), `not on ${pl}`);
  }
  assert.deepEqual(await nonReadCalls(core), [], 'no rewrite until the user changes the type');
  await sleep(10);
});
