// MS4 slice 4B preview feedback (D-369), L5 (WebKit + fake core): the note header's type chip opens the type page;
// changing the type moves to `Change type…` in the palette and in the note's `More` menu. FR-TYP-07 AC-11, AC-12.
// docs/acceptance/types.md; interface: docs/contracts/ms3-shell.md §14.7 plus the `More` menu agreed for this slice
// (button `More` in the note header after the type chip, menu `More`, menuitem `Change type…`, catalog `note.more`,
// `note.more.changeType`). Written from the ACs and those interfaces only (D-61). Missing elements fail through
// `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, callsOf, changeTypeMenu, description, eventually, lastWrite, main, must, nonReadCalls, openTypes, runCommand, seen, sleep, typesVault,
} from './types-helpers';
import { mustBeOn } from './helpers';

const mustBeOnName = (page: Page, name: string, how: string) => mustBeOn(page, name, how, 5000);

const typeLink = (page: Page) => main(page).getByRole('link', { name: /^Type: / });
const typeButton = (page: Page) => page.getByRole('button', { name: /^Type: / });
const moreButton = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More', exact: true });
const changeTypeItem = (page: Page) => moreMenu(page).getByRole('menuitem', { name: 'Change type…', exact: true });

const EXTRA = {
  tag: 'Tags/čajovna.md',
  image: 'Images/Fotka z výletu.md',
  pdf: 'PDFs/Zpráva o činnosti.md',
  recept: 'Recepty/Svíčková.md',
} as const;
function chipVault() {
  return typesVault((f) => {
    f[EXTRA.tag] = '---\nid: 01JB0T0000000000000000T201\ntype: tag\ntitle: čajovna\n---\n';
    f[EXTRA.image] = '---\nid: 01JB0T0000000000000000T202\ntype: image\ntitle: Fotka z výletu\nfile: "[[fotka.png]]"\n---\n';
    f[EXTRA.pdf] = '---\nid: 01JB0T0000000000000000T203\ntype: pdf\ntitle: Zpráva o činnosti\nfile: "[[zpráva.pdf]]"\n---\n';
    f[EXTRA.recept] = '---\nid: 01JB0T0000000000000000T204\ntype: recept\ntitle: Svíčková\n---\nObjekt typu bez definice.\n';
  });
}
const TITLE: Record<string, string> = {
  [P.obycejna]: 'Obyčejná stránka', [P.porada]: '2026-10-07 Porada', [P.bez]: 'Bez hlavičky', [P.denni]: '2026-10-07',
  [EXTRA.tag]: 'čajovna', [EXTRA.image]: 'Fotka z výletu', [EXTRA.pdf]: 'Zpráva o činnosti', [EXTRA.recept]: 'Svíčková',
};

/** Opens `at` on the chip vault; for the read-only Neplatná hlavička it waits for its body text instead of a title. */
async function openAt(page: Page, at: string) {
  const core = await openTypes(page, at, { vault: chipVault() });
  if (TITLE[at]) await mustBeOnName(page, TITLE[at], `landing on ${at}`);
  else assert.ok(await seen(page.getByText('Tělo s chybnou hlavičkou.'), 3000), `landing on ${at}`);
  return core;
}

// ------------------------------------------------------------------------------------------------ AC-11

const CASES: [string, string, string, string][] = [
  ['obycejna_to_type_page', P.obycejna, 'Type: Page', 'type/page'],
  ['porada_to_type_schuzka', P.porada, 'Type: Schůzka', 'type/schůzka'],
  ['untyped_bez_hlavicky_to_type_page', P.bez, 'Type: Page', 'type/page'],
  ['daily_note_to_type_daily_note', P.denni, 'Type: Daily Note', 'type/daily-note'],
  ['tag_to_type_tag', EXTRA.tag, 'Type: Tag', 'type/tag'],
  ['image_to_type_image', EXTRA.image, 'Type: Image', 'type/image'],
  ['pdf_to_type_pdf', EXTRA.pdf, 'Type: PDF', 'type/pdf'],
  ['undefined_recept_to_type_recept', EXTRA.recept, 'Type: recept', 'type/recept'],
  ['read_only_file_to_its_type_page', P.neplatna, 'Type: Page', 'type/page'],
];

for (const [slug, at, name, route] of CASES) {
  test(`fr_typ_07_ac11_chip_links_${slug}`, async ({ page }) => {
    const core = await openAt(page, at);
    const before = JSON.stringify(await core.files());
    const chip = await must(typeLink(page), `link "${name}"`);
    assert.equal(await chip.evaluate((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()), name, 'accessible name');
    assert.equal(await chip.getAttribute('aria-haspopup'), null, 'no aria-haspopup');
    assert.notEqual(await chip.getAttribute('aria-disabled'), 'true', 'never aria-disabled');
    assert.equal(await typeButton(page).count(), 0, 'no type button in the header');
    const n0 = (await callsOf(core, 'nav_opened')).length;
    if (at === P.porada) {
      await chip.focus();
      await page.keyboard.press('Enter');
    } else await chip.click();
    const opened = await eventually(async () => (await callsOf(core, 'nav_opened')).slice(n0).map((c) => (c.args as any)?.route as string | undefined), (r) => r.length > 0, 3000);
    assert.deepEqual(opened.map((r) => (r ?? '').normalize('NFC')), [route], `opens ${route}, recorded with nav_opened (D-138)`);
    assert.ok(await eventually(() => changeTypeMenu(page).count(), (n) => n === 0, 500) === 0, 'the Change type menu does not open');
    await page.keyboard.press('Meta+BracketLeft');
    if (TITLE[at]) await mustBeOnName(page, TITLE[at], 'Back returns to the note');
    else assert.ok(await seen(page.getByText('Tělo s chybnou hlavičkou.'), 3000), 'Back returns to the note');
    assert.deepEqual(await nonReadCalls(core), [], 'no write command');
    assert.equal(JSON.stringify(await core.files()), before, 'every vault file keeps its bytes');
  });
}

// ------------------------------------------------------------------------------------------------ AC-12

// D-122 order: system types first, then the user types by collation.
const TARGETS = ['Task', 'Quick Note', 'Nápad', 'Osoba', 'Projekt', 'Schůzka'];
async function menuItems(page: Page): Promise<string[]> {
  return (await (await must(changeTypeMenu(page), 'menu "Change type"')).getByRole('menuitem').allInnerTexts()).map((x) => x.trim());
}

test('fr_typ_07_ac12_more_menu_opens_the_change_type_menu', async ({ page }) => {
  await openAt(page, P.obycejna);
  const more = await must(moreButton(page), 'button "More" in the note header');
  const chip = await must(typeLink(page), 'type chip link');
  assert.ok(await chip.evaluate((c, m) => !!(c.compareDocumentPosition(m as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await more.elementHandle()), 'More comes after the type chip');
  await more.click();
  const item = await must(changeTypeItem(page), 'menuitem "Change type…"');
  assert.notEqual(await item.getAttribute('aria-disabled'), 'true', 'enabled on a Page');
  await item.click();
  const items = await menuItems(page);
  for (const t of TARGETS) assert.ok(items.includes(t), `${t} is a target`);
  for (const t of ['Page', 'Daily Note', 'Tag', 'Image', 'PDF']) assert.ok(!items.includes(t), `${t} is not a target`);
  const order = TARGETS.map((t) => items.indexOf(t));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'D-122 order');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.ok(await eventually(() => changeTypeMenu(page).count(), (n) => n === 0, 1000) === 0, 'Esc closes the menu');
  const f = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim());
  assert.equal(f, 'More', 'the focus returns to the control that opened it');
});

test('fr_typ_07_ac12_choosing_a_target_from_more_changes_the_type_and_undo_restores', async ({ page }) => {
  const core = await openAt(page, P.obycejna);
  await (await must(moreButton(page), 'More')).click();
  await (await must(changeTypeItem(page), 'Change type…')).click();
  await (await must(changeTypeMenu(page), 'menu')).getByRole('menuitem', { name: 'Schůzka', exact: true }).click();
  const t = await eventually(() => lastWrite(core, P.obycejna), (x) => (x ?? '').includes('type: schůzka'), 2000);
  assert.ok((t ?? '').includes('type: schůzka\n'), 'the type line is written (AC-5)');
  assert.ok(await seen(typeLink(page).filter({ hasText: 'Schůzka' }), 2000), 'the chip shows the new type');
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Note body')).click();
  await page.keyboard.press('Meta+z');
  assert.ok((await eventually(() => lastWrite(core, P.obycejna), (x) => (x ?? '').includes('type: page'), 2000) ?? '').includes('type: page'), '⌘Z in the body restores the previous type (AC-9)');
});

test('fr_typ_07_ac12_palette_change_type_opens_the_same_menu', async ({ page }) => {
  await openAt(page, P.obycejna);
  await runCommand(page, 'Change type…');
  const items = await menuItems(page);
  for (const t of TARGETS) assert.ok(items.includes(t), `${t} is a target`);
  assert.ok(!items.includes('Page') && !items.includes('Daily Note'), 'the current type and Daily Note are absent');
  await page.keyboard.press('Escape');
  assert.ok(await eventually(() => changeTypeMenu(page).count(), (n) => n === 0, 1000) === 0, 'Esc closes');
  // Red guard for D-369: the chip is a link, not the menu button.
  await must(typeLink(page), 'type chip link');
});

const FIXED: [string, string, RegExp | null][] = [
  ['daily_note', P.denni, /^The type of a Daily Note can't be changed$/],
  ['tag', EXTRA.tag, /^The type of a Tag can't be changed$/],
  ['image', EXTRA.image, /^The type of an? Image can't be changed$/],
  ['pdf', EXTRA.pdf, /^The type of a PDF can't be changed$/],
  ['read_only_file', P.neplatna, null],
];
for (const [slug, at, reason] of FIXED) {
  test(`fr_typ_07_ac12_change_type_is_disabled_on_${slug}`, async ({ page }) => {
    const core = await openAt(page, at);
    await (await must(moreButton(page), 'More')).click();
    const item = await must(changeTypeItem(page), 'Change type…');
    assert.equal(await item.getAttribute('aria-disabled'), 'true', 'aria-disabled');
    if (reason) assert.match(await description(item), reason, "AC-4's reason");
    await item.click({ force: true });
    await sleep(300);
    assert.equal(await changeTypeMenu(page).count(), 0, 'the disabled item opens no menu');
    await page.keyboard.press('Escape');
    await runCommand(page, 'Change type…');
    await sleep(300);
    assert.equal(await changeTypeMenu(page).count(), 0, 'the palette command is not run (D-127)');
    assert.deepEqual(await nonReadCalls(core), [], 'no write');
  });
}
