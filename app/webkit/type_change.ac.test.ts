// MS3 slice 3D, L5 (WebKit + fake core): changing an object's type (D-224; since 4E a type move, D-804, D-817) and
// type matching (D-239).
// FR-TYP-07 AC-4…AC-10; FR-TYP-13 AC-1, AC-2; links.md FR-STO-04 / FR-TYP-07 AC-3 (attributes kept, [MS3] by D-228).
// Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.7 only (D-61). D-369: the chip is a link to
// the type page (FR-TYP-07 AC-11), so the menu is opened through the note's `More` menu (AC-12).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, changeTypeItem, changeTypeMenu, control, description, eventually, moreButton, fileText, gotoTypePage, lastWrite, must, noModified, nonReadCalls,
  openTypes, original, otherProps, props, rowTitles, runCommand, seen, sleep, swap, typesList, typesVault,
} from './types-helpers';

type Core = Awaited<ReturnType<typeof openTypes>>;
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
async function openChangeType(page: Page) {
  await (await must(moreButton(page), 'button "More"')).click();
  await (await must(changeTypeItem(page), 'menuitem "Change type…"')).click();
}
async function changeTo(page: Page, name: string) {
  await openChangeType(page);
  const menu = await must(changeTypeMenu(page), 'menu "Change type"');
  await menu.getByRole('menuitem', { name, exact: true }).click();
}
const count = async (page: Page, label: string) => {
  const t = (await typesList(page).getByRole('listitem').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => x.startsWith(`${label} `));
  return t ? Number(/(\d+)$/.exec(t)?.[1] ?? 0) : 0;
};

test('fr_typ_07_ac4_the_change_type_menu', async ({ page }) => {
  // D-369: the chip part is superseded (FR-TYP-07 AC-11); the menu is reached through `More` (AC-12).
  await openTypes(page, P.obycejna);
  await openChangeType(page);
  const items = (await (await must(changeTypeMenu(page), 'menu')).getByRole('menuitem').allInnerTexts()).map((x) => x.trim());
  for (const t of ['Task', 'Quick Note', 'Schůzka', 'Osoba', 'Projekt', 'Nápad']) assert.ok(items.includes(t), `${t} is a target`);
  for (const t of ['Page', 'Daily Note', 'Tag', 'Image', 'PDF']) assert.ok(!items.includes(t), `${t} is not a target`);
  await page.keyboard.press('Escape');
  assert.equal(await changeTypeMenu(page).count(), 0, 'Esc closes');
  await runCommand(page, 'Change type…');
  await must(changeTypeMenu(page), 'the palette command opens the same menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
});

test('fr_typ_07_ac4_daily_note_has_a_disabled_change_type', async ({ page }) => {
  // D-369: the disabled case moves from the chip to `Change type…` in the `More` menu (FR-TYP-07 AC-12).
  await openTypes(page, P.denni);
  await (await must(moreButton(page), 'button "More"')).click();
  const item = await must(changeTypeItem(page), 'menuitem "Change type…"');
  assert.equal(await item.getAttribute('aria-disabled'), 'true');
  assert.equal(await description(item), "The type of Daily Note objects can't be changed");
});

// 4E (D-803, D-804, D-817): a type change is a type move: the file goes to its new type's folder; properties of the old
// type's schema the new type lacks go into the content; other keys stay. `moved` reads the file at its new path.
const moved = (core: Core, path: string, ok: (t: string) => boolean, ms = 3000) => eventually(() => fileText(core, path), (t) => t !== undefined && ok(t), ms);
const mapping = (page: Page) => page.getByRole('dialog', { name: /^⟦?Change type\?⟧?$/ });

test('fr_typ_07_ac5_only_the_type_line_changes_and_counts_follow', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  const [pages, schuzky] = [await count(page, 'Pages'), await count(page, 'Schůzky')];
  await changeTo(page, 'Schůzka');
  const to = 'Schůzky/Obyčejná stránka.md';
  const t = await moved(core, to, (x) => x.includes('type: schůzka'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.obycejna), 'type: page\n', 'type: schůzka\n')), 'type line and modified only (Page has no schema properties to map)');
  assert.equal(await fileText(core, P.obycejna), undefined, 'the file moved from Pages/ to Schůzky/ (FR-STO-04)');
  assert.equal(await eventually(() => count(page, 'Pages'), (n) => n === pages - 1, 2000), pages - 1, 'Pages −1');
  assert.equal(await eventually(() => count(page, 'Schůzky'), (n) => n === schuzky + 1, 2000), schuzky + 1, 'Schůzky +1');
  assert.equal(await props(page).getByRole('textbox', { name: 'Místo', exact: true }).inputValue(), 'Praha', 'místo in the schema rows');
  assert.equal((await otherProps(page).innerText()).trim(), 'Other properties (1)', 'nálada under Other properties');
  await gotoTypePage(page, 'Schůzky');
  assert.ok((await rowTitles(page, 'Schůzky')).includes('Obyčejná stránka'), 'type/schůzka lists it');
});

test('fr_sto_04_ac3_attributes_kept_on_type_change', async ({ page }) => {
  // D-804, D-813: only the old type's schema properties are mapped; Page has none, so both keys stay in the file.
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  const t = await moved(core, 'Schůzky/Obyčejná stránka.md', (x) => x.includes('type: schůzka'));
  assert.ok(t?.includes('místo: Praha\n') && t.includes('nálada: klidná\n'), 'both stay in the file');
  await (await must(otherProps(page), 'Other properties')).click();
  assert.ok(await seen(page.getByRole('list', { name: 'Other properties' }).getByText('nálada')), 'nálada under Other properties');
});

test('fr_typ_07_ac6_back_to_page_puts_mista_into_the_content', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  await moved(core, 'Schůzky/Obyčejná stránka.md', (x) => x.includes('type: schůzka'));
  await changeTo(page, 'Page');
  // místo is a Schůzka property Page lacks: the dialog maps it to Content (D-804).
  await (await must(mapping(page).getByRole('button', { name: 'Change type', exact: true }), 'button "Change type"')).click();
  const t = await moved(core, P.obycejna, (x) => x.includes('type: page'));
  const want = original(P.obycejna).replace('místo: Praha\n', '').replace('---\nStránka, které', '---\n**Místo:** Praha\n\nStránka, které');
  assert.equal(noModified(t ?? ''), noModified(want), 'back in Pages/ with místo as a Content line; nálada stays (D-804, D-813)');
  assert.equal((await otherProps(page).innerText()).trim(), 'Other properties (1)', 'nálada under Other properties');
});

test('fr_typ_07_ac7_untyped_file_gets_type_then_identity', async ({ page }) => {
  const core = await openTypes(page, P.bez);
  await changeTo(page, 'Schůzka');
  const t = await moved(core, 'Schůzky/Bez hlavičky.md', (x) => x.includes('type: schůzka'));
  assert.match(t ?? '', /^---\ntype: schůzka\nid: \S+\nmodified: \S+\n---\n/, 'type, then id and modified (D-174); no title or created');
  assert.ok((t ?? '').endsWith(`---\n${original(P.bez)}`), 'body byte-identical');
  assert.equal(await fileText(core, P.bez), undefined, 'moved to Schůzky/');
});

test('fr_typ_07_ac8_no_values_added', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Nápad');
  const t = await moved(core, 'Nápady/Obyčejná stránka.md', (x) => x.includes('type: nápad'));
  assert.ok(t && !t.includes('review:') && !t.includes('hodnocení'), 'neither review nor the default');
});

test('fr_typ_07_ac9_undo_and_redo_a_type_change', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await changeTo(page, 'Schůzka');
  await moved(core, 'Schůzky/Obyčejná stránka.md', (x) => x.includes('type: schůzka'));
  // D-812, D-817: ⌘Z with the focus in the body undoes the job (the file goes back with its bytes); ⇧⌘Z redoes it.
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Note body')).click();
  await page.keyboard.press('Meta+z');
  assert.equal(await moved(core, P.obycejna, (x) => x === original(P.obycejna)), original(P.obycejna), 'one ⌘Z restores the previous type and place');
  await page.keyboard.press('Meta+Shift+z');
  assert.ok(await moved(core, 'Schůzky/Obyčejná stránka.md', (x) => x.includes('type: schůzka')), '⇧⌘Z re-applies it');
});

test('fr_typ_07_ac10_a_type_list_becomes_one_string', async ({ page }) => {
  const core = await openTypes(page, P.dvaTypy);
  await changeTo(page, 'Projekt');
  const t = await moved(core, 'Projekty/Dva typy.md', (x) => x.includes('type: projekt'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.dvaTypy), 'type: [projekt, osoba]\n', 'type: projekt\n')));
});

test('fr_typ_13_ac1_type_values_match_by_key', async ({ page }) => {
  const vault = typesVault((f) => {
    f['Pages/NFD schůzka.md'] = '---\nid: 01JB0T0000000000000000T097\ntype: schůzka\ntitle: NFD schůzka\n---\n';
    f['Pages/Rychlá.md'] = '---\nid: 01JB0T0000000000000000T098\ntype: Quick Note\ntitle: Rychlá\n---\n';
  });
  const core = await openTypes(page, P.velka, { vault });
  await must(page.getByRole('link', { name: 'Type: Projekt', exact: true }), 'Velká písmena is a Projekt');
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
  await must(page.getByRole('link', { name: 'Type: Page', exact: true }), 'shown as Page');
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
