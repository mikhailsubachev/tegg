// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, panels on the phone:
// - FR-EDT-03 AC-6 (the slash panel's items), FR-EDT-06 AC-12 (the link panel), AC-13 (choosing and creating), AC-14
//   (closing), FR-EDT-15 AC-7 (the tag panel), FR-EDT-14 AC-8 (text pastes, images don't).
// Contract docs/contracts/android-edit.md §10.1 (`div.phone-panel`, docked at the bottom in the bar's place, rows ≥ 56 px,
// at most 224 px), §10.3 (the type sheet as `as…`), §9.1 (paste and `phone.imagesLater`), §4.4, §17.1.
// Red-test readings (reported): "editor FR-EDT-06 AC-3 (a)…(e)'s bytes" is checked by case (a) (`[[Cíl]]` from Psaní)
// against the desktop's saved file for the same choice; "AC-1, AC-3 and AC-6's results" of FR-EDT-14 are the desktop
// editor's saved file for the same clipboard (compared in the same test).
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EDIT_NOW, PE, REPO, assertZeroWrites, bodyFocused, formatButton, phonePage, desktopEditorResult, editVault, editorText, eventually, fileStateOf, flat, h1Text, keyboard, must, needBody, nfc,
  noteBody, notice, panel, rect, savedText, seen, setCaret, sleep, startPhone, tap, tapText, tapToEdit, typeSheet, writeCalls, type PhoneHandle,
} from './phone-helpers';
import { ime } from './phone-ime';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function open(page: Page, path: string): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${path}`, now: EDIT_NOW });
  await needBody(page, path);
  return core;
}
const rows = (page: Page, name: 'Link suggestions' | 'Tag suggestions' | 'Insert block') => panel(page, name).getByRole('option');
const rowTexts = async (page: Page, name: 'Link suggestions' | 'Tag suggestions' | 'Insert block') => (await rows(page, name).allInnerTexts()).map(flat);
/** RA18's docking: the panel's bottom at the keyboard's top (the emulated viewport's bottom), rows ≥ 56 px, ≤ 4 in view. */
async function docked(page: Page, name: 'Link suggestions' | 'Tag suggestions' | 'Insert block') {
  const p = await must(panel(page, name), `listbox "${name}"`);
  const host = p.locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " phone-panel ")][1]');
  const r = await rect((await host.count()) ? host : p);
  assert.ok(r && Math.abs(r.bottom - 520) <= 1, `${name}: docked above the keyboard (bottom ${r?.bottom})`);
  assert.ok(r && r.height <= 224 + 1, `${name}: at most 4 rows of 56 px in view (${r?.height})`);
  const hs = await rows(page, name).evaluateAll((os) => os.map((o) => o.getBoundingClientRect().height));
  assert.ok(hs.every((h) => h >= 56 - 0.5), `${name}: each row ≥ 56 px (${hs.map(Math.round)})`);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-6

test('fr_edt_03_ac6_slash_panel_on_the_phone', async ({ page }) => {
  const core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ enter: true }, { text: '/' }]);
  await docked(page, 'Insert block');
  const names = (await rows(page, 'Insert block').evaluateAll((os) => os.map((o) => (o.getAttribute('aria-label') ?? (o as HTMLElement).innerText).split('\n')[0].trim())));
  assert.deepEqual(names, ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Checklist', 'Quote', 'Callout', 'Code block', 'Divider'], 'exactly the eleven items');
  for (const no of ['Table', 'Mindmap', 'Query', 'Embed object', 'Block embed', 'Image', 'PDF', 'Task', 'Turn into object']) assert.ok(!names.includes(no), `not listed: ${no}`);
  // filtering and a tap that chooses
  await ime(page, [{ text: 'head' }]);
  assert.deepEqual((await rowTexts(page, 'Insert block')).map((t) => t.split(' ').slice(0, 2).join(' ')), ['Heading 1', 'Heading 2', 'Heading 3'], 'filtering as editor FR-EDT-03 AC-2');
  await tap(page, rows(page, 'Insert block').filter({ hasText: 'Heading 2' }).first(), 'Heading 2');
  await ime(page, [{ text: 'Sekce' }]);
  const out = await savedText(core, PE.psani, 3000);
  assert.ok(out && out.endsWith('Konec.\n\n## Sekce\n'), `the tap chooses Heading 2 (AC-4): ${JSON.stringify(out?.slice(-30))}`);
  // closing without a choice keeps `/<query>` as text (AC-3)
  await ime(page, [{ enter: true }, { text: '/cit' }]);
  await must(panel(page, 'Insert block'), 'Insert block again');
  await setCaret(page, 'Konec.', 0);
  assert.ok(await absent(panel(page, 'Insert block'), 1500), 'moving the caret out closes it');
  assert.ok(((await editorText(page)) ?? '').includes('/cit'), '`/cit` stays as text');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-06 AC-12

test('fr_edt_06_ac12_link_panel_on_the_phone', async ({ page }) => {
  await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  for (const [what, q] of [['[[cil', 'cil'], ['[[CÍL', 'CÍL'], ['an NFD [[cíl', 'cíl']] as const) {
    await setCaret(page, 'Konec.', 'end');
    await ime(page, [{ text: ' [[' }, { text: q }]);
    await docked(page, 'Link suggestions');
    const first = flat(await rows(page, 'Link suggestions').first().innerText());
    assert.match(first, /^Cíl\b/, `${what}: Cíl is first (${first})`);
    const icon = await rows(page, 'Link suggestions').first().locator('svg, [data-icon]').count();
    assert.ok(icon > 0, `${what}: the row shows the type icon`);
    await page.keyboard.press('Escape');
    await ime(page, [{ backspace: true }]);
    await setCaret(page, 'Konec.', 'end');
  }
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[Dvojník' }]);
  const dv = await eventually(() => rowTexts(page, 'Link suggestions'), (t) => t.filter((x) => x.startsWith('Dvojník')).length >= 2, 2000);
  const both = dv.filter((x) => x.startsWith('Dvojník'));
  assert.equal(both.length, 2, `[[Dvojník lists both Dvojník objects: ${JSON.stringify(dv)}`);
  assert.notEqual(both[0], both[1], 'each with FR-LNK-14 AC-6\'s details (they differ)');
  await page.keyboard.press('Escape');
  for (const never of ['Šablona', 'Smazaná']) {
    await setCaret(page, 'Konec.', 'end');
    await ime(page, [{ text: ` [[${never}` }]);
    await sleep(500);
    assert.ok(!(await rowTexts(page, 'Link suggestions')).some((t) => t.startsWith(never)), `${never} is never listed`);
    await page.keyboard.press('Escape');
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-06 AC-13

test('fr_edt_06_ac13_choose_and_create_on_the_phone', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  // a tap on a row: editor FR-EDT-06 AC-3 (a)'s bytes, the panel closes, the caret after the chip, the keyboard kept
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[Cí' }]);
  await tap(page, rows(page, 'Link suggestions').filter({ hasText: /^Cíl/ }).first(), 'the Cíl row');
  const phone = await savedText(core, PE.psani, 3000);
  const desk = await desktopEditorResult(browser, editVault(), PE.psani, { text: 'Konec.' }, async (p) => {
    await p.keyboard.type(' [[Cí');
    await must(p.getByRole('listbox', { name: 'Link suggestions' }), 'desktop: Link suggestions');
    await p.getByRole('listbox', { name: 'Link suggestions' }).getByRole('option').filter({ hasText: /^Cíl/ }).first().click();
  });
  assert.equal(phone, desk, 'the tap saves the desktop\'s bytes for the same choice (editor FR-EDT-06 AC-3)');
  assert.ok(phone?.includes('Konec. [[Cíl]]\n'), 'Konec. [[Cíl]]');
  assert.ok(await absent(panel(page, 'Link suggestions'), 500), 'the panel closes');
  assert.ok(await bodyFocused(page), 'the keyboard stays (the body keeps the focus)');
  assert.deepEqual((await core.imeCalls()).filter((s) => !s), [], 'nothing hides the keyboard');
  // the create rows
  const n0 = (await core.calls()).length;
  await ime(page, [{ text: ' [[Nová stránka' }]);
  const texts = await eventually(() => rowTexts(page, 'Link suggestions'), (t) => t.length >= 2, 2000);
  assert.deepEqual(texts.slice(-2), ['Create “Nová stránka”', 'Create “Nová stránka” as…'], 'the last two rows are Create “<q>” and as… (not the board\'s New Page)');
  await tap(page, rows(page, 'Link suggestions').filter({ hasText: 'Create “Nová stránka”' }).first(), 'Create “Nová stránka”');
  const w = await eventually(() => writeCalls(core, n0), (x) => x.length >= 2, 3000);
  assert.deepEqual(w.map((x) => ({ cmd: x.cmd, path: x.path })), [{ cmd: 'note_create', path: 'Quick Notes/Nová stránka.md' }, { cmd: 'note_write', path: PE.psani }], 'note_create of Quick Notes/Nová stránka.md, then the edited note');
  assert.ok((await core.files())[nfc(PE.psani)]?.includes('[[Nová stránka]]'), 'Psaní holds [[Nová stránka]]');
  assert.equal(await h1Text(page), 'Psaní', 'no navigation');
  // as… › Page
  const n1 = (await core.calls()).length;
  await ime(page, [{ text: ' [[Další stránka' }]);
  await tap(page, rows(page, 'Link suggestions').filter({ hasText: /as…$/ }).first(), 'as…');
  const sheet = await must(typeSheet(page), 'the type sheet');
  await tap(page, sheet.getByRole('option', { name: /^Page\b/ }).first(), 'Page');
  const w2 = await eventually(() => writeCalls(core, n1), (x) => x.some((y) => y.cmd === 'note_create'), 3000);
  assert.equal(w2.find((x) => x.cmd === 'note_create')?.path, 'Pages/Další stránka.md', 'as… › Page creates Pages/Další stránka.md');
  // @ opens the same panel
  await ime(page, [{ text: ' @Cí' }]);
  await docked(page, 'Link suggestions');
  assert.match(flat(await rows(page, 'Link suggestions').first().innerText()), /^Cíl/, '@ opens the same panel');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-06 AC-14

test('fr_edt_06_ac14_closing_the_link_panel', async ({ page }) => {
  const core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[Lis' }]);
  await must(panel(page, 'Link suggestions'), 'Link suggestions');
  // system Back hides the keyboard (RA12's first row): the panel closes, `[[Lis` stays as text
  await keyboard(page, false);
  assert.ok(await absent(panel(page, 'Link suggestions'), 1000), 'the keyboard hiding closes the panel');
  assert.ok(((await editorText(page)) ?? '').includes('Konec. [[Lis\n'), '`[[Lis` stays as literal text');
  // a tap moving the caret out of the trigger
  await tapToEdit(page, 'Konec');
  await setCaret(page, '[[Lis', 'end');
  await ime(page, [{ text: 'a' }]);
  await must(panel(page, 'Link suggestions'), 'the panel again');
  await tapText(page, 'Nákup');
  assert.ok(await absent(panel(page, 'Link suggestions'), 1000), 'a tap out of the trigger closes it');
  // typing ]] closes it and makes a chip
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[Cíl' }]);
  await must(panel(page, 'Link suggestions'), 'the panel');
  await ime(page, [{ text: ']]' }]);
  assert.ok(await absent(panel(page, 'Link suggestions'), 1000), '`]]` closes it');
  assert.ok((await noteBody(page).locator('[data-wikilink], .chip').filter({ hasText: 'Cíl' }).count()) >= 2, '`]]` makes a chip');
  await sleep(1200);
  const w = await writeCalls(core);
  assert.deepEqual([...new Set(w.map((x) => `${x.cmd} ${x.path}`))], [`note_write ${nfc(PE.psani)}`], 'opening and closing write nothing but the typed text of the note');
  const saved = (await core.files())[nfc(PE.psani)] ?? '';
  assert.ok(saved.includes('[[Lisa'), 'the literal `[[Lisa` reads back as text');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-15 AC-7

test('fr_edt_15_ac7_tag_panel_on_the_phone', async ({ page }) => {
  const core = await open(page, PE.psani);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' #p' }]);
  await docked(page, 'Tag suggestions');
  await ime(page, [{ backspace: true }]);
  const all = await eventually(() => rowTexts(page, 'Tag suggestions'), (t) => t.length >= 3, 1500);
  assert.deepEqual(all.filter((t) => ['#projekt', '#rozpočet', '#čeština'].includes(t)), ['#projekt', '#rozpočet', '#čeština'], `the rows #projekt, #rozpočet, #čeština: ${JSON.stringify(all)}`);
  await ime(page, [{ text: 'p' }]);
  await tap(page, rows(page, 'Tag suggestions').filter({ hasText: /^#projekt$/ }).first(), '#projekt');
  let out = await savedText(core, PE.psani, 3000);
  assert.ok(out?.includes('Konec. #projekt'), 'a tap saves #projekt');
  // the bar's Tag; Create tag “nový-štítek”
  await formatButton(page, 'Tag').tap();
  await must(panel(page, 'Tag suggestions'), 'the bar\'s Tag opens Tag suggestions');
  await ime(page, [{ text: 'nový-štítek' }]);
  await tap(page, rows(page, 'Tag suggestions').filter({ hasText: 'Create tag “nový-štítek”' }).first(), 'Create tag “nový-štítek”');
  out = await savedText(core, PE.psani, 3000, 2);
  assert.ok(out?.includes('#nový-štítek'), 'saves #nový-štítek in NFC');
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Tags/')), 'no file in Tags/');
  // `# ` at a block start still makes a heading and opens no panel
  await ime(page, [{ enter: true }, { text: '# ' }]);
  assert.ok(!(await seen(panel(page, 'Tag suggestions'), 500)), '`# ` at a block start opens no panel');
  await ime(page, [{ text: 'Nadpis' }]);
  assert.equal(await noteBody(page).locator('h1').filter({ hasText: 'Nadpis' }).count(), 1, '`# ` makes a heading');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-14 AC-8

const AC1 = '# Nadpis\n\n- a\n- b\n\nText s [[Cíl]] a #projekt.';
const WEB = readFileSync(resolve(REPO, 'tests/fixtures/editor/paste/web.html'), 'utf8');

test('fr_edt_14_ac8_paste_on_the_phone', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const cases: [string, import('./phone-ime').ImeStep, (p: Page) => Promise<void>][] = [
    ['text/plain from the system menu (AC-1)', { paste: { 'text/plain': AC1 }, via: 'menu' }, (p) => pasteOn(p, { 'text/plain': AC1 })],
    ['web.html as text/html (AC-3)', { paste: { 'text/html': WEB }, via: 'menu' }, (p) => pasteOn(p, { 'text/html': WEB })],
    ['NFD Čeština from the keyboard\'s clipboard (AC-6)', { paste: { 'text/plain': 'Čeština' }, via: 'keyboard' }, (p) => p.keyboard.insertText('Čeština')],
  ];
  for (const [what, step, deskKeys] of cases) {
    const p = await phonePage(browser);
    const core = await open(p, PE.prazdna);
    await (await needBody(p, 'Prázdná')).tap();
    await keyboard(p, true);
    await ime(p, [step]);
    const phone = await savedText(core, PE.prazdna, 3000);
    await p.close();
    const desk = await desktopEditorResult(browser, editVault(), PE.prazdna, { text: '' }, deskKeys).catch(() => null);
    assert.ok(phone !== null, `${what}: saved`);
    assert.equal(phone, desk, `${what}: the desktop's result`);
  }
  // an image-only clipboard: nothing inserted, the notice, zero writes, no media_add
  const core = await open(page, PE.prazdna);
  const before = await fileStateOf(core);
  await (await needBody(page, 'Prázdná')).tap();
  await keyboard(page, true);
  await ime(page, [{ paste: { 'image/png': true }, via: 'menu' }]);
  await must(notice(page).filter({ hasText: 'Adding images comes later on the phone.' }).or(page.getByText('Adding images comes later on the phone.', { exact: true })), 'the notice "Adding images comes later on the phone."', 1500);
  await sleep(1500);
  assert.equal(((await editorText(page)) ?? '').trimEnd(), (before.files[nfc(PE.prazdna)] ?? '').trimEnd(), 'nothing is inserted');
  const calls = (await core.calls()).map((c) => c.cmd);
  assert.ok(!calls.includes('media_add') && !calls.includes('media_add_paths'), 'no media_add or media_add_paths call');
  await assertZeroWrites(core, before, 'an image-only paste');
});
/** A paste event with a DataTransfer on the focused element (the system menu's Paste). */
async function pasteOn(page: Page, clip: Record<string, string>) {
  await page.evaluate((c) => {
    const t = (document.activeElement ?? document.body) as HTMLElement;
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(c)) dt.setData(k, v);
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: dt });
    t.dispatchEvent(e);
  }, clip);
}
