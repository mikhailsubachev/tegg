// Owner feedback D-312…D-316, L5 (WebKit + fake core): FR-TYP-17 AC-1…AC-3 (hidden properties, D-316), FR-TYP-08
// AC-15 (Aliases as one text field, D-312), FR-EDT-07 AC-16 (no description on objects, D-313) and AC-17 (no Other
// properties button when n = 0, D-314). docs/acceptance/types.md; interface: type op `{ op: 'hidden', keys }`,
// `TypeDto.hidden`, type settings section `Hidden properties` (one checkbox per property, labelled with its Name),
// hidden rows listed with their normal controls in the expanded `Other properties (<n>)` list. Written from the ACs and
// the interface only (D-61). Every lookup goes through `must`/`seen` and node:assert, so a missing element is an
// AssertionError, not a Playwright timeout (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault } from '../ui/test/fake-core';
import { switcherDialog } from './helpers';
import {
  P, append, callsOf, dialog, eventually, fileWhen, fixture, gotoSettings, gotoTypePage, lastWrite, main, must, noModified, nonReadCalls,
  openTypes, original, otherProps, props, property, section, seen, sleep, swap, typeFile, typeTable, typesVault, writtenOutside,
} from './types-helpers';
import { goToQuery, searchResultsList } from './helpers'; // D-1345: the Search page's results (D-1340)

type Core = Awaited<ReturnType<typeof openTypes>>;
const UNIVERSAL = ['Tags', 'Aliases', 'Source', 'Review', 'Created', 'Modified'];
const SCHUZKA_ATTRS = ['Datum', 'Začátek', 'Účastníci', 'Projekt', 'Místo'];
const pageYml = () => fixture('vaults/new-empty/.tegg/types/page.yml');
const schuzka = () => original(typeFile('schůzka'));

const hiddenSection = (page: Page) => section(page, 'Hidden properties');
const hiddenBox = (page: Page, name: string) => hiddenSection(page).getByRole('checkbox', { name, exact: true });
const otherList = (page: Page) => page.getByRole('list', { name: 'Other properties' });
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);

/** A types vault whose type file `key` has `hidden: [..]` right after `preview` (D-316 placement). */
function withHidden(key: string, keys: string[], edit?: (f: Record<string, string>) => void) {
  return typesVault((f) => {
    const p = typeFile(key);
    f[p] = f[p].replace(/^(preview: .*\n)/m, `$1hidden: [${keys.join(', ')}]\n`);
    assert.ok(f[p].includes(`hidden: [${keys.join(', ')}]\n`), `setup: ${p} has a preview line`);
    edit?.(f);
  });
}
/** The checkbox labels of the `Hidden properties` section, in order, with their checked state. */
async function hiddenItems(page: Page): Promise<[string, boolean][]> {
  const sec = await must(hiddenSection(page), 'section "Hidden properties"');
  const boxes = sec.getByRole('checkbox');
  const out: [string, boolean][] = [];
  for (let i = 0; i < (await boxes.count()); i++) {
    const b = boxes.nth(i);
    const name = await b.evaluate((e) => {
      const lb = e.getAttribute('aria-label');
      if (lb) return lb;
      const ids = (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      if (ids.length) return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      const l = (e as HTMLInputElement).labels?.[0] ?? e.closest('label');
      return l?.textContent ?? e.textContent ?? '';
    });
    out.push([name.replace(/\s+/g, ' ').trim(), await b.isChecked()]);
  }
  return out;
}
async function toggle(page: Page, name: string) {
  await (await must(hiddenBox(page, name), `checkbox "${name}" in Hidden properties`)).click();
}
/** The `key: …` entry (with its block lines) of a note text. */
function entry(text: string | null | undefined, key: string): string {
  const lines = (text ?? '').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && /^\s+/.test(lines[j]) && lines[j].trim() !== '') j++;
  return lines.slice(i, j).join('\n');
}
async function commitField(page: Page, loc: Locator, value: string, what: string) {
  const f = await must(loc, what);
  await f.click();
  await f.fill(value);
  await f.press('Enter');
  await sleep(100);
}
async function valueOf(loc: Locator): Promise<string> {
  return loc.first().inputValue().catch(async () => (await loc.first().innerText()).trim());
}
/** The Properties region's text without the expanded Other properties list (the panel's own rows). */
async function rowsText(page: Page): Promise<string> {
  const region = await must(props(page), 'region Properties');
  // One line per rendered text node, skipping the expanded list (a detached clone would lose the layout's line breaks).
  return region.evaluate((r) => {
    const skip = [...r.querySelectorAll('[role="list"], ul')].filter((l) => /^Other properties/.test(l.getAttribute('aria-label') ?? ''));
    const out: string[] = [];
    const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || skip.some((l) => l.contains(el)) || el.getClientRects().length === 0) continue;
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t);
    }
    return out.join('\n');
  });
}
const hasLabel = (text: string, label: string) => new RegExp(`(^|\\n)\\s*${label}\\s*(\\n|$)`).test(text);

// ------------------------------------------------------------------------------------------------ FR-TYP-17 AC-1

test('fr_typ_17_ac1_hidden_properties_section_lists_every_property_unchecked', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Pages', 'Page');
  assert.deepEqual(await hiddenItems(page), UNIVERSAL.map((n) => [n, false]), 'Page: no attributes, then the universal ones, unchecked');
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  assert.deepEqual(await hiddenItems(page), [...SCHUZKA_ATTRS, ...UNIVERSAL].map((n) => [n, false]), 'Schůzka: attributes in schema order, then the universal ones');
  assert.deepEqual(await nonReadCalls(core), [], 'opening type settings writes nothing');
});

test('fr_typ_17_ac1_all_unchecked_on_the_starter_types', async ({ page }) => {
  const starter = loadFixtureVault('tests/fixtures/vaults/new-starter').files;
  const vault = typesVault((f) => Object.assign(f, starter));
  const core = await openTypes(page, undefined, { vault });
  const types: [string, string, string[]][] = [
    ['Books', 'Book', ['Author', 'Year', 'Status', 'Finished']],
    ['Reading Notes', 'Reading Note', ['Book', 'Pages']],
    ['Ideas', 'Idea', ['Status', 'Related ideas', 'Origin URL']],
    ['Meetings', 'Meeting', ['Date', 'Attendees', 'Project', 'Location']],
    ['People', 'Person', ['Email', 'Organization', 'Role']],
    ['Projects', 'Project', ['Status', 'Time frame']],
    ['Trips', 'Trip', ['Destination', 'Dates']],
  ];
  for (const [plural, name, attrs] of types) {
    await gotoSettings(page, plural, name);
    const items = await hiddenItems(page);
    assert.deepEqual(items, [...attrs, ...UNIVERSAL].map((n) => [n, false]), `${name}: one checkbox per property, labelled with its Name, all unchecked`);
  }
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
});

test('fr_typ_17_ac1_checking_created_then_modified_writes_the_hidden_line', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Pages', 'Page');
  await toggle(page, 'Created');
  const one = await fileWhen(core, typeFile('page'), (t) => !!t?.includes('hidden:'));
  assert.equal(one, swap(pageYml(), 'preview: []\n', 'preview: []\nhidden: [created]\n'), 'hidden after preview; only that line');
  await toggle(page, 'Modified');
  const two = await fileWhen(core, typeFile('page'), (t) => !!t?.includes('modified]'));
  assert.equal(two, swap(pageYml(), 'preview: []\n', 'preview: []\nhidden: [created, modified]\n'), 'only the hidden line changes');
  const ops = (await callsOf(core, 'type_patch')).map((c) => (c.args as any)?.ops);
  assert.deepEqual(ops, [[{ op: 'hidden', keys: ['created'] }], [{ op: 'hidden', keys: ['created', 'modified'] }]], 'one type_patch per change with the hidden op');
  assert.equal(await hiddenBox(page, 'Created').isChecked(), true, 'Created checked');
  assert.equal(await hiddenBox(page, 'Modified').isChecked(), true, 'Modified checked');
  assert.deepEqual(await writtenOutside(core, [typeFile('page')]), [], 'no note written (values stay in the notes)');
});

test('fr_typ_17_ac1_unchecking_both_writes_an_empty_list', async ({ page }) => {
  // types.md FR-TYP-17 AC-1: "unchecking both writes `hidden: []`. Only that line changes."
  const core = await openTypes(page, undefined, { vault: withHidden('page', ['created', 'modified']) });
  await gotoSettings(page, 'Pages', 'Page');
  assert.equal(await (await must(hiddenBox(page, 'Created'), 'Created')).isChecked(), true, 'the file state is shown checked');
  await toggle(page, 'Created');
  await fileWhen(core, typeFile('page'), (t) => !!t?.includes('hidden: [modified]\n'));
  await toggle(page, 'Modified');
  const t = await fileWhen(core, typeFile('page'), (x) => !x?.includes('modified]'));
  assert.equal(t, swap(pageYml(), 'preview: []\n', 'preview: []\nhidden: []\n'));
});

test('fr_typ_17_ac1_a_system_type_without_a_file_gets_one', async ({ page }) => {
  const vault = typesVault((f) => { delete f[typeFile('page')]; });
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, 'Pages', 'Page');
  assert.deepEqual(await hiddenItems(page), UNIVERSAL.map((n) => [n, false]), 'built-in defaults (D-90)');
  assert.deepEqual(await nonReadCalls(core), [], 'opening writes nothing');
  await toggle(page, 'Created');
  const t = await fileWhen(core, typeFile('page'), (x) => x !== undefined);
  assert.equal(t, swap(pageYml(), 'preview: []\n', 'preview: []\nhidden: [created]\n'), 'the whole default file with only that change');
  assert.equal(((await callsOf(core, 'type_patch'))[0]?.args as any)?.base, null, 'base null for a system type without a file');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-17 AC-2

test('fr_typ_17_ac2_hidden_created_and_modified_move_into_other_properties', async ({ page }) => {
  const core = await openTypes(page, P.obycejna, { vault: withHidden('page', ['created', 'modified']) });
  await must(props(page).getByRole('textbox', { name: 'Source', exact: true }), 'the panel (Source row)');
  const rows = await rowsText(page);
  assert.ok(hasLabel(rows, 'Tags') && hasLabel(rows, 'Source'), `the other rows stay: ${rows}`);
  assert.ok(!hasLabel(rows, 'Created'), 'no Created row');
  assert.ok(!hasLabel(rows, 'Modified'), 'no Modified row');
  // D-316: n = hidden rows + other keys. Obyčejná (Page, no attributes) has the other keys místo and nálada.
  const btn = await must(otherProps(page), 'Other properties (n)');
  assert.equal((await btn.innerText()).trim(), 'Other properties (4)', 'Created, Modified + místo, nálada');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'collapsed by default');
  await btn.click();
  const list = await must(otherList(page), 'list Other properties');
  const text = await list.innerText();
  const pos = ['Created', 'Modified', 'místo', 'nálada'].map((l) => text.indexOf(l));
  assert.ok(pos.every((p) => p >= 0), `all listed: ${text}`);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'Created, Modified, then the other keys in file order');
  for (const l of ['Created', 'Modified']) {
    assert.equal(await list.getByRole('textbox', { name: l }).count(), 0, `${l} stays read-only (D-160)`);
  }
  assert.ok(/2026/.test(text.slice(pos[0], pos[2])), 'their values are shown');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing is written by opening');
});

test('fr_typ_17_ac2_a_hidden_attribute_is_still_edited_in_other_properties', async ({ page }) => {
  const core = await openTypes(page, P.porada, { vault: withHidden('schůzka', ['místo']) });
  await must(control0(page, 'Datum'), 'the panel (Datum row)');
  assert.equal(await props(page).getByRole('textbox', { name: 'Místo', exact: true }).count(), 0, 'no Místo control while collapsed');
  assert.ok(!hasLabel(await rowsText(page), 'Místo'), 'no Místo row');
  const btn = await must(otherProps(page), 'Other properties (n)');
  assert.equal((await btn.innerText()).trim(), 'Other properties (2)', 'místo (hidden, empty) + nálada');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing is written by opening');
  await btn.click();
  const list = await must(otherList(page), 'list Other properties');
  assert.ok((await list.innerText()).includes('Empty'), 'the empty hidden row shows Empty');
  await commitField(page, list.getByRole('textbox', { name: 'Místo', exact: true }), 'Zasedačka 2', 'Místo text control in Other properties');
  const t = await written(core, P.porada, (x) => x.includes('místo: Zasedačka 2'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.porada), 'místo:\n', 'místo: Zasedačka 2\n')), 'FR-EDT-07 AC-3: only that line and modified');
});
const control0 = (page: Page, name: string) => props(page).getByRole('textbox', { name, exact: true }).or(props(page).getByRole('button', { name: new RegExp(name) })).first();

// ------------------------------------------------------------------------------------------------ FR-TYP-17 AC-3

test('fr_typ_17_ac3_deleting_a_hidden_property_removes_it_from_hidden', async ({ page }) => {
  const vault = withHidden('schůzka', ['místo', 'začátek']);
  const before = vault.files[typeFile('schůzka')];
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  const g = await must(property(page, 'Místo'), 'property group Místo');
  const edit = g.getByRole('button', { name: 'Edit Místo', exact: true });
  if (await seen(edit, 500)) await edit.click();
  await g.getByRole('button', { name: 'Delete property…', exact: true }).click();
  const d = await must(dialog(page, 'Delete property "Místo"?'), 'dialog Delete property');
  // D-807 (AC-Test-Change approved by the owner): no choice; Porada's místo is empty, so the no-value dialog's
  // `Delete property` changes only the type file.
  await (await must(d.getByRole('button', { name: 'Delete property', exact: true }), 'button "Delete property"')).click();
  const want = swap(swap(before, '  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n', ''), 'hidden: [místo, začátek]\n', 'hidden: [začátek]\n');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want), want, 'item and hidden key removed');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'in the same write');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'values stay in the notes');
  const items = await eventually(() => hiddenItems(page), (x) => !x.some(([n]) => n === 'Místo'), 2000);
  assert.deepEqual(items, [['Datum', false], ['Začátek', true], ['Účastníci', false], ['Projekt', false], ...UNIVERSAL.map((n) => [n, false])], 'Místo no longer listed');
});

test('fr_typ_17_ac3_an_unknown_hidden_key_is_ignored_and_kept', async ({ page }) => {
  const core = await openTypes(page, P.porada, { vault: withHidden('schůzka', ['neexistuje']) });
  const btn = await must(otherProps(page), 'Other properties (n)');
  assert.equal((await btn.innerText()).trim(), 'Other properties (1)', 'neexistuje counts nothing (only nálada)');
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  assert.deepEqual(await hiddenItems(page), [...SCHUZKA_ATTRS, ...UNIVERSAL].map((n) => [n, false]), 'no checkbox for neexistuje, nothing checked');
  await toggle(page, 'Místo');
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo]') || !!x?.includes('místo, '));
  const line = /^hidden: \[(.*)\]$/m.exec(t ?? '')?.[1]?.split(', ') ?? [];
  assert.deepEqual([...line].sort(), ['místo', 'neexistuje'], `the hand-written key is kept in the file: ${line.join(', ')}`);
  assert.equal(t?.replace(/^hidden: .*\n/m, ''), schuzka(), 'only the hidden line changed');
});

test('fr_typ_17_ac3_type_page_columns_and_preview_are_unaffected', async ({ page }) => {
  const core = await openTypes(page);
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  // Hide the two preview properties through type settings: only the hidden line is written.
  await toggle(page, 'Datum');
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('hidden: [datum]\n'));
  await toggle(page, 'Účastníci');
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('hidden: [datum, účastníci]\n'));
  assert.equal(t, swap(schuzka(), 'preview: [datum, účastníci]\n', 'preview: [datum, účastníci]\nhidden: [datum, účastníci]\n'), 'hidden written; the preview line unchanged');
  const chips = section(page, 'Preview properties').getByRole('list', { name: 'Preview properties' }).getByRole('listitem');
  assert.deepEqual((await chips.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim().replace(/ Remove.*$/, '')), ['Datum', 'Účastníci'], 'preview properties unchanged');
  await gotoTypePage(page, 'Schůzky');
  const headers = (await typeTable(page, 'Schůzky').getByRole('columnheader').allInnerTexts()).map((x) => x.trim());
  assert.deepEqual(headers, ['Title', 'Datum', 'Účastníci', 'Modified'], 'the Type page columns still show the hidden preview properties');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'values stay in the notes: no note written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-08 AC-15

const aliasesField = (page: Page) => props(page).getByRole('textbox', { name: 'Aliases', exact: true });

test('fr_typ_08_ac15_aliases_is_one_text_field_and_keeps_the_flow_list', async ({ page }) => {
  const core = await openTypes(page, P.styl);
  const f = await must(aliasesField(page), 'single-line textbox Aliases');
  assert.notEqual(await f.getAttribute('aria-multiline'), 'true', 'single-line');
  assert.equal(await f.evaluate((e) => e.tagName.toLowerCase()), 'input', 'a one-line input field');
  assert.equal(await valueOf(f), 'Styl, Hodnoty', 'joined by ", "');
  assert.equal(await props(page).getByRole('button', { name: /^(Add alias|Remove alias)/ }).count(), 0, 'no chips control');
  await commitField(page, aliasesField(page), 'Styl, Hodnoty, Třetí', 'Aliases');
  const t = await written(core, P.styl, (x) => x.includes('Třetí'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.styl), 'aliases: [Styl, Hodnoty]\n', 'aliases: [Styl, Hodnoty, Třetí]\n')), 'flow list kept; only that entry and modified');
  assert.notEqual(/^modified: (.*)$/m.exec(t ?? '')?.[1], '2026-09-12T08:00:00+02:00', 'modified updated');
  await goToQuery(page, 'třetí');
  assert.ok(await seen(searchResultsList(page).getByRole('listitem').filter({ hasText: 'Styl hodnot' }), 2000), 'found by the alias within 2 s (FR-NAV-01)');
});

test('fr_typ_08_ac15_parsing_trims_drops_empty_parts_and_duplicates', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  await commitField(page, aliasesField(page), ' Jedna ,, dvě , jedna', 'textbox Aliases');
  const t = await written(core, P.obycejna, (x) => x.includes('aliases:'));
  assert.equal(entry(t, 'aliases'), 'aliases:\n  - Jedna\n  - dvě', 'trimmed, empty parts and case-insensitive duplicates dropped, block list');
  assert.equal(noModified(t ?? ''), noModified(append(original(P.obycejna), 'aliases:\n  - Jedna\n  - dvě\n')), 'one entry appended, the rest byte-identical');
  assert.equal(await valueOf(aliasesField(page)), 'Jedna, dvě', 'shown joined');
  await commitField(page, aliasesField(page), '', 'Aliases');
  const c = await written(core, P.obycejna, (x) => !x.includes('aliases:'));
  assert.equal(noModified(c ?? ''), noModified(original(P.obycejna)), 'clearing the field removes the key');
});

test('fr_typ_08_ac15_aliases_are_written_nfc', async ({ page }) => {
  const core = await openTypes(page, P.obycejna);
  const nfd = 'Plzeň, Dvojka';
  await commitField(page, aliasesField(page), nfd, 'textbox Aliases');
  const t = await written(core, P.obycejna, (x) => x.includes('aliases:'));
  assert.equal(entry(t, 'aliases'), 'aliases:\n  - Plzeň\n  - Dvojka', 'NFC bytes (FR-FMT-12)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-16, AC-17

test('fr_edt_07_ac20_no_description_on_objects', async ({ page }) => {
  const vault = typesVault((f) => { f[P.obycejna] = swap(f[P.obycejna], 'title: Obyčejná stránka\n', 'title: Obyčejná stránka\ndescription: Krátké shrnutí.\n'); });
  const before = vault.files[P.obycejna];
  const core = await openTypes(page, P.obycejna, { vault });
  await must(props(page).getByRole('textbox', { name: 'Source', exact: true }), 'the panel (Source row)');
  assert.equal(await page.getByRole('textbox', { name: 'Description', exact: true }).count(), 0, 'no Description field');
  assert.equal(await main(page).getByText('Krátké shrnutí.').count(), 0, 'no description subtitle');
  // Tab from the title goes to the first value control of the panel.
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  const inPanel = await props(page).evaluate((r) => !!document.activeElement && r.contains(document.activeElement));
  assert.equal(inPanel, true, 'focus in the Properties panel after Tab from the title');
  // Other properties: místo, nálada; never description.
  const btn = await must(otherProps(page), 'Other properties (n)');
  assert.equal((await btn.innerText()).trim(), 'Other properties (2)', 'description not counted');
  await btn.click();
  const list = await must(otherList(page), 'list Other properties');
  assert.ok(!/description|Krátké/.test(await list.innerText()), 'description not listed');
  assert.deepEqual(await nonReadCalls(core), [], 'opening writes nothing');
  await commitField(page, props(page).getByRole('textbox', { name: 'Source', exact: true }), 'Kniha', 'Source');
  const t = await written(core, P.obycejna, (x) => x.includes('source: Kniha'));
  assert.ok((t ?? '').includes('\ndescription: Krátké shrnutí.\n'), 'the description line is byte-identical');
  assert.equal(noModified(t ?? ''), noModified(append(before, 'source: Kniha\n')), 'only source and modified change');
});

test('fr_edt_07_ac21_no_other_properties_button_when_there_are_none', async ({ page }) => {
  await openTypes(page, P.dvaTypy);
  const region = await must(props(page), 'region Properties');
  assert.ok(await seen(region.getByText('Created', { exact: true }), 2000), 'the panel rows are shown');
  await sleep(300);
  assert.equal(await page.getByRole('button', { name: /^Other properties/ }).count(), 0, 'Dva typy: no Other properties button');
  await openTypes(page, P.porada);
  const btn = await must(otherProps(page), 'Other properties (n) on Porada');
  assert.equal((await btn.innerText()).trim(), 'Other properties (1)');
});
