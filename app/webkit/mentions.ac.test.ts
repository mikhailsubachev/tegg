// MS3 3D follow-up, L5 (WebKit + fake core): `@` mentions open the link picker (D-250, D-258) and `[[`/`@` work in
// text properties (D-249). FR-EDT-06 AC-8…AC-11. docs/acceptance/editor.md; interface docs/contracts/ms3-shell.md
// §15.5 (second trigger, closing rule, `useLinkSuggest` in property fields, listbox `Link suggestions`). Written from
// the ACs and the contract only (D-61). Missing elements fail through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { absent, mainName } from './helpers';
import {
  E, block, bodyOf, caretIn, editorBody, fileText, linkSuggestions, must, mustBeSaved, noModified, openEditor, original, seen, sleep,
  titleField, writes, type FakeCoreHandle,
} from './editor-helpers';
import { P, control, eventually, lastWrite, openTypes, props } from './types-helpers';

const flat = (n: any): string => (n.type === 'text' || n.type === 'inlineCode' ? n.value : (n.children ?? []).map(flat).join(''));
async function tree(text: string) {
  const { markdownTree } = await import('@tegg/doc');
  return markdownTree(text) as any;
}
async function saved(page: Page, core: FakeCoreHandle, path: string): Promise<string> {
  await sleep(150);
  await mustBeSaved(page);
  return (await fileText(core, path)) ?? '';
}
async function options(page: Page): Promise<string[]> {
  const lb = await must(linkSuggestions(page), 'listbox "Link suggestions"');
  return (await lb.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}
async function startEmpty(page: Page): Promise<FakeCoreHandle> {
  const core = await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  return core;
}
async function linkCount(text: string): Promise<number> {
  const { wikilinks, parse } = await import('@tegg/doc');
  return wikilinks(parse(text)).length;
}

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_edt_06_ac8_at_opens_the_picker_with_the_same_matching', async ({ page }) => {
  await startEmpty(page);
  for (const q of ['cil', 'CÍL']) {
    await page.keyboard.type(`@${q}`);
    const o = await options(page);
    assert.ok(o[0]?.includes('Cíl'), `@${q} lists Cíl first: ${o.join(' | ')}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('@');
  await page.keyboard.insertText('cíl'.normalize('NFD'));
  assert.ok((await options(page))[0]?.includes('Cíl'), '@cíl in NFD lists Cíl first');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@reading');
  const r = await options(page);
  assert.ok(r[0]?.includes('Cíl') && r[0]?.includes('Reading list'), `@reading lists Cíl with the alias: ${r.join(' | ')}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@Senior');
  const s = (await options(page)).filter((x) => x.includes('Senior Product Manager') && !x.startsWith('Create'));
  assert.equal(s.length, 2, 'both SPM objects');
  assert.ok(s.every((x) => x.includes('Page')), 'each with its type');
  await page.keyboard.press('Escape');
  for (const q of ['Šablona', 'Smazan']) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`@${q}`);
    const o = await options(page);
    assert.ok(!o.some((x) => x.startsWith('Šablona') || x.startsWith('Smazaná')), `${q}: templates and .trash never listed`);
    await page.keyboard.press('Escape');
  }
});

test('fr_edt_06_ac8_at_after_an_opening_parenthesis_opens_the_picker', async ({ page }) => {
  await startEmpty(page);
  await page.keyboard.type('Viz (@cil');
  assert.ok((await options(page))[0]?.includes('Cíl'), 'after ( (AP-190)');
});

test('fr_edt_06_ac8_at_inside_a_word_does_not_open_and_is_saved_as_typed', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('Napiš na eva@example.com a a@b');
  assert.ok(await absent(linkSuggestions(page), 800), 'no list inside a word');
  await sleep(150);
  await mustBeSaved(page, 6000);
  const t = (await fileText(core, E.prazdna)) ?? '';
  assert.equal(await bodyOf(t), 'Napiš na eva@example.com a a@b\n', 'saved as typed');
  // Red guard: at a mention start it opens (AC-8).
  await page.keyboard.type(' @cil');
  assert.ok(await seen(linkSuggestions(page), 1500), '@ after a space opens Link suggestions');
});

test('fr_edt_06_ac8_at_in_code_and_in_the_title_does_not_open', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 7); // the code fence
  await page.keyboard.type(' @cil');
  assert.ok(await absent(linkSuggestions(page), 800), 'no list in a code block');
  await (await must(titleField(page), 'Title')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' @cil');
  assert.ok(await absent(linkSuggestions(page), 800), 'no list in the title');
  const t = await saved(page, core, E.deset);
  assert.match(t, /^title: Deset bloků @cil$/m, 'title saved as typed');
  assert.ok((await bodyOf(t)).includes(' @cil\n```') || (await bodyOf(t)).includes(' @cil'), 'code saved as typed');
  // Red guard: in a paragraph it opens.
  await caretIn(page, 2);
  await page.keyboard.type(' @cil');
  assert.ok(await seen(linkSuggestions(page), 1500), '@ in a paragraph opens Link suggestions');
});

// ------------------------------------------------------------------------------------------------ AC-9

const CHOICES: [string, (o: string) => boolean, string, string][] = [
  ['Cíl', (o) => o.startsWith('Cíl') && !o.includes('Reading'), '[[Cíl]]', E.cil],
  ['reading', (o) => o.includes('Reading list'), '[[Cíl|Reading list]]', E.cil],
  ['C# tips', (o) => o.includes('C# tips'), '[[C tips|C# tips]]', E.ctips],
  ['Senior', (o) => o.includes('Senior') && (o.includes('2026-10-02') || o.includes('Oct 2, 2026')), '[[Senior Product Manager (2)|Senior Product Manager]]', E.spm2],
  ['Dvojník', (o) => o.includes('Dvojník') && o.includes('Quick Note'), '[[Quick Notes/Dvojník|Dvojník]]', E.dvojnikQ],
];

for (const [k, [q, pick, want, target]] of CHOICES.entries()) {
  test(`fr_edt_06_ac9_at_writes_the_same_link_${'abcde'[k]}`, async ({ page }) => {
    const core = await startEmpty(page);
    await page.keyboard.type(`@${q}`);
    const lb = await must(linkSuggestions(page), 'Link suggestions');
    const texts = (await lb.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
    const i = texts.findIndex(pick);
    assert.ok(i >= 0, `${q}: option found in ${texts.join(' | ')}`);
    await lb.getByRole('option').nth(i).click();
    const t = await saved(page, core, E.prazdna);
    assert.equal(await bodyOf(t), `${want}\n`, `@${q} → ${want} (no @ written)`);
    assert.equal(noModified(t).replace(`${want}\n`, ''), noModified(original(E.prazdna)), 'only the edited block and modified change');
    const inner = want.slice(2, -2).split('|')[0];
    const res = await page.evaluate(async ([from, tg]) => (window as any).__TAURI_INTERNALS__.invoke('link_resolve', { from, targets: [tg] }), [E.prazdna, inner] as const);
    assert.equal(res[0]?.path, target, `${want} resolves to ${target}`);
  });
}

test('fr_edt_06_ac9_at_in_a_table_cell_escapes_the_pipe', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  const cell = await must(block(page, 8).getByRole('cell', { name: '1' }), 'cell');
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' @C# tips');
  await (await must(linkSuggestions(page).getByRole('option').filter({ hasText: 'C# tips' }).first(), 'option C# tips')).click();
  const t = await saved(page, core, E.deset);
  assert.ok(t.includes('| a \\| b | 1 [[C tips\\|C# tips]] |'), 'escaped pipe in the cell, no @');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_edt_06_ac10_at_create_writes_two_files', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('@Novinka');
  const o = await options(page);
  assert.equal(o[o.length - 2], 'Create "Novinka"', `Create, then Create … as… last: ${o.join(' | ')}`); // 5B: `Create "…" as…` follows the create row (FR-VLT-05 AC-3)
  await (await must(linkSuggestions(page).getByRole('option', { name: 'Create "Novinka"', exact: true }), 'Create row')).click();
  const t = await saved(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '[[Novinka]]\n');
  assert.equal(await mainName(page), 'Prázdná', 'no navigation');
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Novinka.md', E.prazdna], 'exactly two files written');
});

test('fr_edt_06_ac10_spaces_esc_and_the_create_only_space_rule', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('@Senior Product');
  assert.ok((await options(page)).some((x) => x.includes('Senior Product Manager')), 'a query with a space keeps the list open');
  await page.keyboard.press('Escape');
  assert.ok(await absent(linkSuggestions(page)), 'Esc closes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@Žádnátakovávěc');
  const o = await options(page);
  assert.deepEqual(o.filter((x) => x !== 'Pick a date…'), ['Create "Žádnátakovávěc"', 'Create "Žádnátakovávěc" as…'], 'only the create rows (and 4B\'s Pick a date…, D-331)'); // 5B: `Create "…" as…` follows the create row (FR-VLT-05 AC-3)
  await page.keyboard.type(' ');
  assert.ok(await absent(linkSuggestions(page)), 'a space with only the create row closes the list (AP-190)');
  await page.keyboard.type('dál');
  const t = await saved(page, core, E.prazdna);
  assert.equal(await linkCount(t), 0, 'no link');
  assert.equal(flat(await tree(await bodyOf(t))), '@Senior Product@Žádnátakovávěc dál', '@<query> stays literal text');
  assert.ok(!/#\S/.test(await bodyOf(t)), 'no tag');
});

test('fr_edt_06_ac10_undo_restores_the_at_query_in_one_step', async ({ page }) => {
  const core = await startEmpty(page);
  await page.keyboard.type('@Cíl');
  await must(linkSuggestions(page), 'Link suggestions');
  await (await must(linkSuggestions(page).getByRole('option').first(), 'first option')).click();
  await mustBeSaved(page);
  assert.equal(await bodyOf((await fileText(core, E.prazdna)) ?? ''), '[[Cíl]]\n', 'chosen');
  await page.keyboard.press('Meta+z');
  const t = await saved(page, core, E.prazdna);
  assert.equal(await bodyOf(t), '@Cíl\n', '⌘Z restores @Cíl as text in one step');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@Úplněnová');
  await (await must(linkSuggestions(page).getByRole('option', { name: 'Create "Úplněnová"', exact: true }), 'Create row')).click();
  await mustBeSaved(page);
  await page.keyboard.press('Meta+z');
  await saved(page, core, E.prazdna);
  assert.ok((await core.files())['Quick Notes/Úplněnová.md'] !== undefined, 'the new note stays');
  void writes;
});

// ------------------------------------------------------------------------------------------------ AC-11

type Core = Awaited<ReturnType<typeof openTypes>>;
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);

for (const trigger of ['@', '[['] as const) {
  test(`fr_edt_06_ac11_${trigger === '@' ? 'at' : 'brackets'}_in_a_text_property_inserts_the_link`, async ({ page }) => {
    const core = await openTypes(page, P.porada);
    const f = await must(control(page, 'textbox', 'Místo'), 'panel textbox Místo');
    await f.click();
    await page.keyboard.type(`u ${trigger}jana`);
    const lb = await must(linkSuggestions(page), 'Link suggestions in the Místo field');
    await (await must(lb.getByRole('option').filter({ hasText: 'Jana Nováková' }).first(), 'option Jana Nováková')).click();
    assert.equal(await f.inputValue().catch(async () => (await f.innerText()).trim()), 'u [[Jana Nováková]]', `${trigger}jana replaced at the caret`);
    await f.press('Enter');
    const t = await written(core, P.porada, (x) => x.includes('místo: "u [[Jana Nováková]]"'));
    assert.ok(t?.includes('místo: "u [[Jana Nováková]]"\n'), 'committed per FR-EDT-07 AC-18');
  });
}

test('fr_edt_06_ac11_long_text_and_source_offer_the_picker', async ({ page }) => {
  await openTypes(page, P.rozpocet);
  for (const [name, loc] of [
    ['Poznámka', () => props(page).getByRole('textbox', { name: 'Poznámka', exact: true })],
    ['Source', () => props(page).getByRole('textbox', { name: 'Source', exact: true })],
  ] as const) {
    const f = await must(loc(), `textbox ${name}`);
    await f.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @jana');
    assert.ok(await seen(linkSuggestions(page), 1500), `${name}: @ opens Link suggestions`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
});

test('fr_edt_06_ac11_not_in_title_aliases_url_or_number_fields', async ({ page }) => {
  await openTypes(page, P.rozpocet);
  for (const [name, loc] of [
    ['Title', () => page.getByRole('textbox', { name: 'Title', exact: true })],
    ['Web', () => props(page).getByRole('textbox', { name: 'Web', exact: true })],
    ['Rozpočet', () => props(page).getByRole('textbox', { name: 'Rozpočet', exact: true }).or(props(page).getByRole('spinbutton', { name: 'Rozpočet', exact: true }))],
  ] as const) {
    const f = await must(loc().first(), `field ${name}`);
    await f.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @jana [[jana');
    assert.ok(await absent(linkSuggestions(page), 800), `${name}: no picker`);
    await page.keyboard.press('Escape');
  }
  // Red guard: the Text attribute field offers it.
  const p = await must(props(page).getByRole('textbox', { name: 'Poznámka', exact: true }), 'Poznámka');
  await p.click();
  await page.keyboard.type(' @jana');
  assert.ok(await seen(linkSuggestions(page), 1500), 'Poznámka offers the picker');
});

test('fr_edt_06_ac11_create_from_a_property_stays_on_the_note', async ({ page }) => {
  const core = await openTypes(page, P.porada);
  const f = await must(control(page, 'textbox', 'Místo'), 'panel textbox Místo');
  await f.click();
  await page.keyboard.type('@Hřiště');
  await (await must(linkSuggestions(page).getByRole('option', { name: 'Create "Hřiště"', exact: true }), 'Create row in the Místo field')).click();
  await sleep(300);
  assert.equal(await mainName(page), '2026-10-07 Porada', 'no navigation');
  assert.equal((await core.calls()).filter((c) => c.cmd === 'note_create').length, 1, 'created through note_create (AC-4)');
  assert.equal(await f.inputValue().catch(async () => (await f.innerText()).trim()), '[[Hřiště]]', 'the link is in the field');
});
