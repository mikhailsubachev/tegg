// New objects from `/` and `+`, L5 (WebKit + fake core): the menu (docs/acceptance/new-object-menu.md R234…R236;
// contract docs/contracts/new-object-menu.md §4). FR-EDT-03 AC-6 (R234's groups and 23 options, shortcut, icons,
// descriptions, `Block embed` disabled), AC-7 (New rows from the vault's types, region order, live type changes, nothing
// written), AC-8 (filtering, headers while filtering, the `+` ranking), AC-9 (where `+` opens: empty paragraph, after a
// space, list item, quote, table cell, a mindmap item in List; never inside a word or after punctuation), AC-10 (`+`
// stays text: `+ ` list shortcut, ` a + b`, Esc, ⌫, `+1` ⏎, `+420 777`), AC-11 (where `+` doesn't open: code, inline
// code, a link's text, the Title, the map's `Edit node`, an attribute field), AC-12 (420 px, scrolling inside),
// AC-13 (the `New <type>` dialog: disabled Create, hint, Esc / Cancel / click outside). The tasks fixture with the
// conversion notes, clock 2026-10-14T12:00 Europe/Prague, region cs. Written from the ACs and the contract only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { addBelow, callsOf, caretAt, description, editorBody, isDisabled, openConvert, saved } from './convert-helpers';
import {
  BLOKY, C, caretAfter, convertVault, dialogCancel, dialogCreate, dialogTitle, eventually, fileText, flat, groupNames, must, needDialog, needMenu, newDialog,
  optionNames, original, runtimeTypes, seen, selectedName, sleep, slashMenu, swap, type FakeCoreHandle,
} from './new-object-helpers';
import { MM, fieldState, focusNode, listBtn, mustCaret, needFigure, openMm, vaultWrites } from './mindmap-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(BLOKY);
const WEB = 'Projekty/Web.md';
const R234 = [
  'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Checklist', 'Mindmap', 'Quote', 'Callout', 'Code block', 'Divider', 'Table',
  'Turn into object…', 'Embed object', 'Image', 'PDF', 'Query', 'Block embed', 'New Page', 'New Task', 'New Quick Note', 'New Projekt',
];
const NEW_ROWS = ['New Page', 'New Task', 'New Quick Note', 'New Projekt'];
/** Line 1 of Bloky after `typed` was appended (and saved). */
const line1 = (typed: string) => swap(B0, 'Úvodní odstavec.\n', `Úvodní odstavec.${typed}\n`);
const noMod = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');

async function emptyParagraph(page: Page) {
  await caretAfter(page, 'Úvodní odstavec.');
  await (await must(addBelow(page), 'button "Add block below"')).click();
  await sleep(100);
}
async function savedLine(page: Page, core: FakeCoreHandle, want: string): Promise<string | undefined> {
  return saved(page, core, BLOKY, (t) => noMod(t) === noMod(want), 3000);
}
/** The option element by its label (aria-hidden icons and kbd aside). */
async function option(menu: Locator, label: string): Promise<Locator> {
  const names = await optionNames(menu);
  const i = names.indexOf(label);
  assert.ok(i >= 0, `option "${label}" (${names.join(', ')})`);
  return menu.getByRole('option').nth(i);
}
/** Whether every option named in `labels` lies inside the listbox's visible box. */
async function inView(menu: Locator, labels: string[]): Promise<string[]> {
  const out: string[] = [];
  const lb = (await menu.first().boundingBox())!;
  for (const l of labels) {
    const b = await (await option(menu, l)).boundingBox();
    if (!b || b.y < lb.y - 1 || b.y + b.height > lb.y + lb.height + 1) out.push(l);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_edt_03_ac6_the_order_of_r234', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await emptyParagraph(page);
  await page.keyboard.type('/');
  const { menu, names } = await needMenu(page, '/ in an empty paragraph');
  assert.deepEqual(await groupNames(menu), ['Blocks', 'Objects', 'Media', 'Advanced', 'New object'], 'the group headers in order');
  assert.deepEqual(names, R234, 'the 23 options in R234\'s order');
  assert.equal(names.filter((n) => n === 'Task').length, 0, 'no option named Task');
  assert.match(flat(await (await option(menu, 'Turn into object…')).innerText()), /⇧⌘O/, 'Turn into object… shows ⇧⌘O');
  for (const [row, icon] of [['Heading 1', 'H1'], ['Heading 2', 'H2'], ['Heading 3', 'H3']]) {
    const o = await option(menu, row);
    assert.equal(await o.locator('[aria-hidden="true"]').filter({ hasText: icon }).count(), 1, `${row} shows the icon ${icon} (aria-hidden)`);
  }
  const icons: string[] = [];
  for (const r of NEW_ROWS) icons.push((await (await option(menu, r)).locator('[data-icon]').first().getAttribute('data-icon').catch(() => null)) ?? (await (await option(menu, r)).getAttribute('data-icon')) ?? '');
  assert.deepEqual(icons, ['file-text', 'check-square', 'zap', 'folder'], 'each New row shows its type\'s icon (data-icon)');
  assert.match(await description(await option(menu, 'Mindmap')), /Edit as a list, shown as a map/, 'Mindmap keeps its description (AP-2127)');
  assert.match(await description(await option(menu, 'Query')), /A live list of objects/, 'Query keeps its description');
  const be = await option(menu, 'Block embed');
  assert.equal(await isDisabled(be), true, 'Block embed is aria-disabled');
  assert.match(await description(be), /Coming in v1\.0/, 'Coming in v1.0');
  const disabled: string[] = [];
  for (const n of names) if (n !== 'Block embed' && (await isDisabled(await option(menu, n)))) disabled.push(n);
  assert.deepEqual(disabled, [], 'every other row is enabled');
  await page.keyboard.press('Escape');
  await sleep(1200);
  assert.deepEqual(await callsOf(core, 'note_create'), [], 'opening the menu creates nothing');
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_edt_03_ac7_new_rows_come_from_the_vaults_types', async ({ page }) => {
  for (const [region, want] of [['cs', ['New Page', 'New Task', 'New Quick Note', 'New Cvičení', 'New Čaj', 'New Projekt']], ['en-US', ['New Page', 'New Task', 'New Quick Note', 'New Čaj', 'New Cvičení', 'New Projekt']]] as const) {
    const core = await openConvert(page, BLOKY, { region, vault: convertVault(runtimeTypes) });
    await emptyParagraph(page);
    await page.keyboard.type('/');
    const { names } = await needMenu(page, `/ (${region})`);
    assert.deepEqual(names.slice(19), want, `region ${region}: the New object group (D-122); no Daily Note, Tag, Image, PDF or rozbity`);
    await page.keyboard.press('Escape');
    await sleep(1200);
    assert.deepEqual((await vaultWrites(core)).filter((c) => c !== 'note_write'), [], `${region}: opening the menu writes nothing`);
  }
  const daily = convertVault((f) => { f['.tegg/vault.yml'] = f['.tegg/vault.yml'].replace(/^default-type: .*$/m, 'default-type: Daily Note'); });
  await openConvert(page, BLOKY, { vault: daily });
  await emptyParagraph(page);
  await page.keyboard.type('/');
  assert.deepEqual((await needMenu(page, '/ with Daily Note as the default')).names.slice(19), NEW_ROWS, 'a Daily Note default type adds no row');
  await page.keyboard.press('Escape');
  const core = await openConvert(page, BLOKY);
  const projekt = (await fileText(core, '.tegg/types/projekt.yml'))!;
  await core.setFile('.tegg/types/projekt.yml', projekt.replace(/^name: Projekt$/m, 'name: Záměr'));
  await sleep(2000);
  await emptyParagraph(page);
  await page.keyboard.type('/');
  assert.deepEqual((await needMenu(page, '/ after the rename')).names.slice(19), ['New Page', 'New Task', 'New Quick Note', 'New Záměr'], 'a type renamed by another program shows in the next menu');
  await page.keyboard.press('Escape');
  await core.setFile('.tegg/types/projekt.yml', null);
  await sleep(2000);
  // D-2658: the first `/` stays as text after Esc; a space makes the second `/` a valid trigger position.
  await page.keyboard.type(' /');
  assert.deepEqual((await needMenu(page, '/ after the delete')).names.slice(19), ['New Page', 'New Task', 'New Quick Note'], 'a deleted one is gone');
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_edt_03_ac8_filtering_finds_new_rows', async ({ page }) => {
  await openConvert(page, BLOKY, { vault: convertVault(runtimeTypes) });
  await emptyParagraph(page);
  const list = async (q: string) => {
    await page.keyboard.type(q);
    const { menu, names } = await needMenu(page, q);
    const sel = await selectedName(menu);
    const headers = await groupNames(menu);
    for (let i = 0; i < [...q].length; i++) await page.keyboard.press('Backspace');
    await sleep(100);
    return { names, sel, headers };
  };
  const got = {
    '/task': (await list('/task')).names, '/TASK': (await list('/TASK')).names, '+task': (await list('+task')).names,
    '/new': (await list('/new')).names.filter((n) => n.startsWith('New ')), '+pro': (await list('+pro')).names,
  };
  assert.deepEqual(got, {
    '/task': ['New Task'], '/TASK': ['New Task'], '+task': ['New Task'],
    '/new': ['New Page', 'New Task', 'New Quick Note', 'New Cvičení', 'New Čaj', 'New Projekt'], '+pro': ['New Projekt'],
  }, 'the New rows are found by every group\'s filter (D-2602)');
  assert.equal((await list('/quick')).names[0], 'New Quick Note', '/quick: New Quick Note first');
  assert.equal((await list('+caj')).names[0], 'New Čaj', '+caj: New Čaj first');
  assert.equal((await list('+čaj')).names[0], 'New Čaj', '+čaj');
  assert.equal((await list('/tab')).names[0], 'Table', '/tab: Table first');
  assert.equal((await list('/hea2')).names[0], 'Heading 2', '/hea2');
  const plus = await list('+ta');
  assert.equal(plus.sel, 'New Task', '+ta selects New Task (D-2627)');
  assert.ok(plus.names.indexOf('Table') > plus.names.indexOf('New Task'), 'Table is below it');
  assert.ok(plus.headers.includes('New object') && plus.headers.includes('Blocks'), `headers above each group with a match while filtering: ${plus.headers.join(', ')}`);
  assert.equal((await list('/ta')).sel, 'Table', '/ta selects Table first');
  for (const q of ['/xyz', '+xyz']) {
    await page.keyboard.type(q);
    await must(page.getByText('No matching blocks'), `${q}: No matching blocks`);
    for (let i = 0; i < q.length; i++) await page.keyboard.press('Backspace');
  }
});

// ------------------------------------------------------------------------------------------------ AC-9

async function plusOpensWithNewPage(page: Page, what: string) {
  await page.keyboard.type('+');
  const { menu, names } = await needMenu(page, what);
  assert.deepEqual(names, R234, `${what}: all 23 options`);
  assert.equal(await selectedName(menu), 'New Page', `${what}: New Page selected`);
  assert.deepEqual(await inView(menu, NEW_ROWS), [], `${what}: every New row inside the listbox's visible area (AP-2126)`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
}

test('fr_edt_03_ac9_where_plus_opens', async ({ page }) => {
  const table = '\n| A | B |\n| --- | --- |\n| jedna | dva |\n';
  await openConvert(page, BLOKY, { vault: convertVault((f) => { f[BLOKY] = f[BLOKY] + table; }) });
  await emptyParagraph(page);
  await plusOpensWithNewPage(page, '+ in an empty paragraph');
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' ');
  await plusOpensWithNewPage(page, '␣+ at the end of line 1');
  await caretAfter(page, 'Koupit lepidlo');
  await page.keyboard.type(' ');
  await plusOpensWithNewPage(page, 'a list item');
  await caretAfter(page, 'Citace k převedení.');
  await page.keyboard.type(' ');
  await plusOpensWithNewPage(page, 'the quote');
  await caretAfter(page, 'jedna');
  await page.keyboard.type(' ');
  await plusOpensWithNewPage(page, 'a table cell');
  await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await (await must(listBtn(fig), 'List')).click();
  await mustCaret(fig.locator('li p, li').filter({ hasText: /^Doprava$/ }).last(), 'Doprava', 'end of Doprava in the list');
  await page.keyboard.type(' ');
  await plusOpensWithNewPage(page, 'a mindmap item in the List view');
});

test('fr_edt_03_ac9_plus_inside_a_word_or_after_punctuation_is_text', async ({ page }) => {
  const core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  // the control case of the same rule: after a space `+` opens (R235)
  await page.keyboard.type(' +');
  await needMenu(page, '␣+ at the end of line 1 (the control case)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  const opened: string[] = [];
  for (const ch of ' C++ 1+1 a+b') {
    await page.keyboard.type(ch);
    if (await seen(slashMenu(page), 150)) { opened.push(`after "${ch}"`); await page.keyboard.press('Escape'); }
  }
  assert.deepEqual(opened, [], '` C++ 1+1 a+b` never opens the menu');
  const t = await savedLine(page, core, line1(' C++ 1+1 a+b'));
  assert.equal(noMod(t), noMod(line1(' C++ 1+1 a+b')), 'saved as typed');
  for (const s of [' (+pa', ' .+pa']) {
    await page.keyboard.type(s);
    assert.equal(await seen(slashMenu(page), 300), false, `${s.trim()} doesn't open it (AP-2124)`);
  }
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_edt_03_ac10_plus_stays_text_when_wanted', async ({ page }) => {
  let core = await openConvert(page, BLOKY);
  await emptyParagraph(page);
  await page.keyboard.type('+ ');
  assert.equal(await seen(slashMenu(page), 300), false, 'the menu closes on the space');
  await page.keyboard.type('Řádek');
  let t = await savedLine(page, core, swap(B0, 'Úvodní odstavec.\n\n', 'Úvodní odstavec.\n\n- Řádek\n\n'));
  assert.ok(t?.includes('\n- Řádek\n'), `\`+ \` makes a bulleted list (editor.md R7): ${JSON.stringify(t?.slice(0, 260))}`);
  core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' a + b');
  t = await savedLine(page, core, line1(' a + b'));
  assert.equal(noMod(t), noMod(line1(' a + b')), '` a + b` saved as typed');
  core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pa');
  await needMenu(page, ' +pa');
  await page.keyboard.press('Escape');
  assert.equal(await seen(slashMenu(page), 300), false, 'Esc closes the menu');
  t = await savedLine(page, core, line1(' +pa'));
  assert.equal(noMod(t), noMod(line1(' +pa')), '`+pa` stays as typed text (FR-EDT-03 AC-3\'s rule): no link, no list');
  core = await openConvert(page, BLOKY);
  await emptyParagraph(page);
  await page.keyboard.type('+');
  await needMenu(page, '+');
  await page.keyboard.press('Backspace');
  assert.equal(await seen(slashMenu(page), 300), false, '⌫ closes the menu with the +');
  await sleep(1500);
  assert.equal(await fileText(core, BLOKY), B0, 'and saves nothing new');
  core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +1');
  await page.keyboard.press('Enter');
  assert.equal(await seen(slashMenu(page), 300), false, '+1 ⏎: the menu closes');
  await page.keyboard.type('Nový řádek');
  t = await savedLine(page, core, swap(B0, 'Úvodní odstavec.\n', 'Úvodní odstavec. +1\n\nNový řádek\n'));
  assert.equal(noMod(t), noMod(swap(B0, 'Úvodní odstavec.\n', 'Úvodní odstavec. +1\n\nNový řádek\n')), '`+1` stays and ⏎ starts a new paragraph (AP-2124)');
  core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +420 777');
  t = await savedLine(page, core, line1(' +420 777'));
  assert.equal(noMod(t), noMod(line1(' +420 777')), '`+420 777` as typed');
});

// ------------------------------------------------------------------------------------------------ AC-11

test('fr_edt_03_ac11_plus_doesnt_open_in_code_links_and_fields', async ({ page }) => {
  test.setTimeout(120_000);
  const extra = '\nText `kód` a dál\n\n[sál](https://example.com)\n';
  let core = await openConvert(page, BLOKY, { vault: convertVault((f) => { f[BLOKY] = f[BLOKY] + extra; }) });
  const base = original(BLOKY) + extra;
  const bad: string[] = [];
  const tryAt = async (loc: Locator, after: string, what: string) => {
    assert.ok(await caretAt(loc, after), `${what}: caret placed after "${after}"`);
    await page.keyboard.type('+pa');
    if (await seen(slashMenu(page), 300)) { bad.push(`${what}: the menu opened`); await page.keyboard.press('Escape'); }
  };
  const body = editorBody(page);
  await tryAt(body.locator('pre, code').filter({ hasText: 'kód();' }).first(), 'kód(', 'the js fence');
  await tryAt(body.locator('p').filter({ hasText: 'a dál' }).locator('code').first(), 'k', 'inline code');
  // D-2658: the runtime paragraph holding the `[sál](…)` link (its whole text is "sál"), not the list item "Rezervovat sál".
  await tryAt(body.locator('p').filter({ hasText: /^sál$/ }).filter({ has: page.locator('a') }).last(), 's', 'the link text');
  const t = await saved(page, core, BLOKY, (x) => !!x && x.includes('[s+paál]'), 3000);
  for (const want of ['kód(+pa);', '`k+paód`', '[s+paál](https://example.com)']) if (!t?.includes(want)) bad.push(`not saved as typed: ${want}`);
  if (t && t.replace('kód(+pa);', 'kód();').replace('`k+paód`', '`kód`').replace('[s+paál]', '[sál]').replace(/^modified: .*$/m, '') !== base.replace(/^modified: .*$/m, '')) bad.push('other bytes changed');
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'textbox Title');
  await title.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' C++');
  if (await seen(slashMenu(page), 300)) bad.push('the Title field: the menu opened');
  await page.keyboard.press('Enter');
  const withTitle = await eventually(async () => Object.values(await core.files()).find((x) => x.includes('id: 01JB5A0000000000000000E101') && x.includes('title: Bloky C++')), (x) => !!x, 4000);
  if (!withTitle) bad.push('the Title field: `title: Bloky C++` not saved');
  // the map's `Edit node` field (mindmap fixture; F2 opens it, slice MM3)
  core = await openMm(page, MM.vyjezd);
  const fig = await needFigure(page, 'Výjezd 2026');
  await focusNode(fig, 'Doprava');
  await page.keyboard.press('F2');
  if (!(await fieldState(fig))) bad.push('Edit node: the field did not open');
  await page.keyboard.type(' +pa');
  if (await seen(slashMenu(page), 300)) bad.push('Edit node: the menu opened');
  await page.keyboard.press('Enter');
  const map = await eventually(() => fileText(core, MM.vyjezd), (x) => !!x?.includes('>   - Doprava +pa\n'), 4000);
  if (!map?.includes('>   - Doprava +pa\n')) bad.push('Edit node: `Doprava +pa` not saved');
  // a Text attribute field (`poznámka` appended to projekt.yml) on Web
  core = await openConvert(page, WEB, { vault: convertVault((f) => { f['.tegg/types/projekt.yml'] += '  - key: poznámka\n    name: Poznámka\n    type: text\n'; }) });
  const field = await must(page.getByRole('textbox', { name: 'Poznámka', exact: true }), 'the attribute field Poznámka', 5000);
  await field.click();
  await page.keyboard.type('+pa');
  if (await seen(slashMenu(page), 300)) bad.push('the attribute field: the menu opened');
  await page.keyboard.press('Enter');
  const web = await eventually(() => fileText(core, WEB), (x) => !!x && /poznámka: "?\+pa"?\n/.test(x), 4000);
  if (!web || !/poznámka: "?\+pa"?\n/.test(web)) bad.push(`the attribute field: not saved as typed (${JSON.stringify(web)})`);
  assert.deepEqual(bad, [], 'no menu for `+` in code, inline code, a link\'s text, the Title, `Edit node`, an attribute field; the text is saved as typed (D-2610, AP-2125)');
});

// ------------------------------------------------------------------------------------------------ AC-12

test('fr_edt_03_ac12_a_fixed_height_that_scrolls', async ({ page }) => {
  await openConvert(page, BLOKY);
  await emptyParagraph(page);
  await page.keyboard.type('/');
  const { menu } = await needMenu(page, '/');
  const box = (await menu.first().boundingBox())!;
  assert.ok(Math.abs(box.height - 420) <= 1, `the listbox is 420 px high: ${box.height}`);
  const scroll = await menu.first().evaluate((m) => [m.scrollHeight, m.clientHeight, getComputedStyle(m).overflowY]);
  assert.ok(Number(scroll[0]) > Number(scroll[1]) && /auto|scroll/.test(String(scroll[2])), `it scrolls inside: ${JSON.stringify(scroll)}`);
  const pageScroll0 = await page.evaluate(() => [window.scrollY, document.scrollingElement?.scrollTop ?? 0]);
  for (let i = 0; i < 22; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await selectedName(menu), 'New Projekt', '↓ to New Projekt');
  assert.deepEqual(await inView(menu, ['New Projekt']), [], 'scrolled into view');
  assert.deepEqual(await page.evaluate(() => [window.scrollY, document.scrollingElement?.scrollTop ?? 0]), pageScroll0, 'the page doesn\'t scroll');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('+');
  await needMenu(page, '+');
  assert.equal(await selectedName(menu), 'New Page', '+ selects New Page');
  await page.keyboard.press('ArrowUp');
  const above = await selectedName(menu);
  assert.ok(above === 'Block embed' || above === 'Query', `↑ selects the row above New Page: ${above}`);
  assert.deepEqual(await inView(menu, [above!]), [], 'scrolled into view');
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_edt_03_ac13_the_new_object_dialog', async ({ page }) => {
  let core = await openConvert(page, BLOKY);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(' +pro');
  await needMenu(page, ' +pro');
  await page.keyboard.press('Enter');
  const d = await needDialog(page, 'Projekt', '⏎ on New Projekt');
  const title = await must(dialogTitle(d), 'textbox Title');
  assert.equal(await title.evaluate((e) => document.activeElement === e), true, 'Title is focused');
  assert.equal(await title.inputValue(), '', 'and empty');
  await must(dialogCancel(d), 'button Cancel');
  const create = await must(dialogCreate(d), 'button Create');
  assert.equal(await isDisabled(create), true, 'Create is aria-disabled');
  assert.match(await description(create), /Add a title/, 'with the description Add a title');
  assert.equal(await d.getByText(/^Creates /).count(), 0, 'no hint while the title is empty');
  await page.keyboard.type('   ');
  assert.equal(await isDisabled(create), true, 'spaces keep Create disabled');
  await page.keyboard.press('Enter');
  assert.ok(await seen(d, 300), '⏎ then does nothing');
  await page.keyboard.type('Spuštění webu');
  assert.equal(await isDisabled(create), false, 'a title enables Create');
  assert.equal(flat(await d.getByText(/^Creates /).first().innerText()), 'Creates Projekty/Spuštění webu.md and links it here.', 'the hint (AP-2129)');
  await page.keyboard.press('Escape');
  assert.equal(await seen(newDialog(page, 'Projekt'), 300), false, 'Esc closes the dialog');
  // D-2657: the trailing space typed before `+` is not saved (paragraph edges are normalized): nothing changes.
  let t = await savedLine(page, core, line1(''));
  assert.equal(noMod(t), noMod(line1('')), 'Esc removes `+pro`; the trailing space typed before it is not saved, so the paragraph is unchanged');
  assert.deepEqual(await callsOf(core, 'note_create'), [], 'never note_create');
  for (const how of ['Cancel', 'a click outside'] as const) {
    core = await openConvert(page, BLOKY);
    await caretAfter(page, 'Úvodní odstavec.');
    await page.keyboard.type(' +pro');
    const { menu } = await needMenu(page, ' +pro');
    await (await option(menu, 'New Projekt')).click();
    const dlg = await needDialog(page, 'Projekt', 'clicking New Projekt with the mouse');
    await page.keyboard.type('Spuštění webu');
    if (how === 'Cancel') await (await must(dialogCancel(dlg), 'Cancel')).click();
    else await page.mouse.click(1300, 860);
    assert.equal(await seen(newDialog(page, 'Projekt'), 300), false, `${how} closes the dialog`);
    t = await savedLine(page, core, line1(''));
    assert.equal(noMod(t), noMod(line1('')), `${how}: as Esc (D-2657)`);
    assert.deepEqual(await callsOf(core, 'note_create'), [], `${how}: never note_create`);
  }
});
