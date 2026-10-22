// MS5 slice 5A-2, L5 (WebKit + fake core): block → object conversion. docs/acceptance/conversion.md FR-CNV-01 AC-1…AC-8
// (entry points, selections, where it isn't offered, types, keyboard, strings and themes), FR-CNV-02 AC-1…AC-6 (title
// and body), FR-CNV-03 AC-1…AC-6, AC-9…AC-11 (own file, embed in place, two writes in order, unusual hosts, a virtual
// Daily Note, resolution), FR-CNV-04 AC-2, AC-3 (the way back, backlinks) and tasks.md FR-TSK-11 AC-4 (D-514).
// Interface docs/contracts/ms5-tasks.md §11.2 (bytes, source and embed targets), §11.4 (R50 flow, commands ⇧⌘T / ⇧⌘O,
// availability reasons, UiStateDto.convert), §11.5 (the Task card), §11.7 (fake core). Written from the ACs and the
// contracts only (D-61). Test clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs (tasks.md).
//
// Open points accepted either way (AP-452…AP-460): the summary count of a single block (AP-453) isn't asserted; no
// test converts a mixed block/list selection (AP-456); the Quick Notes Dvojník `source` may carry `|Dvojník` (AP-455).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { pseudoLocale } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { cmdD } from './daily-helpers';
import {
  C, NOW, ZAVOLAT, ZAVOLAT_PARA, ZAVOLAT_TASK, absent, addBelow, alertWith, blockMenu, bodyOf, callsOf, caretAfter, caretAt, changedPaths, checkedType,
  click, confirm, convertAt, convertButton, convertVault, description, editorBody, embedList, embedTargets, eventually, fileText, fileWhen, flat, fm,
  focusInside, frame, frontOf, hostText, idOf, isDisabled, linkEmbed, main, maskId, mergeDialog, must, mustBeOn, needCard, needFile, needPopover,
  newPaths, nfc, openConvert, original, popover, popoverAt, runCommand, saved, seen, selectBlocks, selectText, selectTop, selectedBlocks, sleep, slashMenu,
  summary, swap, taskBytes, titleBox, titleState, toolbar, touched, typeNames, typeRadio, writeLog, writesOf, type FakeCoreHandle,
  switchTo,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(C.bloky);
const EMBED_ZAVOLAT = `![[${ZAVOLAT}]]\n`;
/** Bloky after FR-CNV-03 AC-2 (lines 3–4 replaced, `modified` only in the frontmatter). */
const BLOKY_AC2 = touched(swap(B0, ZAVOLAT_PARA, EMBED_ZAVOLAT));

/** Exactly one new file since the fixture; returns its path. */
async function onlyNew(core: FakeCoreHandle, what: string): Promise<string> {
  const n = await eventually(() => newPaths(core), (p) => p.length >= 1, 3000);
  assert.equal(n.length, 1, `${what}: exactly one new file, got ${JSON.stringify(n)}`);
  return n[0];
}
const stemOf = (p: string) => p.split('/').pop()!.replace(/\.md$/, '');
/** Opens the palette and returns the option for `title` (first line), asserting it is listed. */
async function paletteEntry(page: Page, title: string): Promise<Locator> {
  await page.keyboard.press('Meta+k');
  await must(page.getByRole('dialog', { name: 'Command palette' }), `Command palette (for "${title}")`);
  await page.getByRole('combobox', { name: 'Command query' }).fill(title);
  await sleep(150);
  const opt = page.getByRole('listbox', { name: 'Commands' }).getByRole('option').filter({ hasText: new RegExp(`^\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  return must(opt, `palette option "${title}"`);
}
/** Asserts a control is aria-disabled with `reason` (description or shown text). */
async function disabledWith(loc: Locator, reason: string, what: string) {
  await must(loc, what);
  assert.equal(await isDisabled(loc), true, `${what} is aria-disabled`);
  const d = await description(loc);
  const shown = flat(await loc.first().innerText().catch(() => ''));
  assert.ok(d.includes(reason) || shown.includes(reason), `${what}: reason "${reason}" (description "${d}", text "${shown}")`);
}
/** ⇧⌘T and ⇧⌘O do nothing visible here: no R50, no alert. */
async function shortcutsDoNothing(page: Page, what: string) {
  const alerts = await page.getByRole('alert').count();
  for (const k of ['Meta+Shift+t', 'Meta+Shift+o']) {
    await page.keyboard.press(k);
    assert.equal(await seen(popover(page), 400), false, `${what}: ${k} opens no R50`);
    assert.equal(await page.getByRole('alert').count(), alerts, `${what}: ${k} shows no error`);
  }
}
/** FR-EDT-03 AC-1: `/` opens the slash menu at the start of a block or after a space, so the query is typed after a
 *  space at the end of a paragraph (AP-461). After Esc the paragraph is the original, or the original plus that space. */
const SLASH_AFTER = (q: string) => ` ${q}`;
const sameOrSpace = (t: string | null, base: string, para: string) => t === base || t === base.replace(para, `${para} `);

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-1

test('fr_cnv_01_ac1_block_menu_turn_into_object_is_enabled_and_opens_r50', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+/');
  const item = await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into object', exact: true }), 'Block actions › Turn into object');
  assert.equal(await isDisabled(item), false, 'enabled (no aria-disabled)');
  assert.ok(!(await description(item)).includes('Coming in'), 'no "Coming in" description');
  await item.click();
  await needPopover(page, 'the block menu');
  assert.equal((await titleState(page)).value, 'Úvodní odstavec.', 'R50 for that block: its first line is the title');
  assert.deepEqual(await writeLog(core), [], 'opening R50 writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-2

test('fr_cnv_01_ac2_slash_turn_opens_r50_and_esc_removes_the_typed_text', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(SLASH_AFTER('/turn'));
  const menu = await must(slashMenu(page), 'listbox "Insert block" for /turn');
  await must(menu.getByRole('option', { name: 'Turn into object…', exact: true }), 'option "Turn into object…"');
  await page.keyboard.press('Enter');
  await needPopover(page, '/turn ⏎');
  assert.equal((await titleState(page)).value, 'Úvodní odstavec.', 'R50 for that paragraph, without "/turn"');
  await page.keyboard.press('Escape');
  assert.ok(await absent(popover(page), 1000), 'Esc closes R50');
  const h = await hostText(page);
  assert.ok(sameOrSpace(h, B0, 'Úvodní odstavec.'), `the typed /turn is removed; nothing else changes: ${JSON.stringify(h?.slice(0, 200))}`);
  await sleep(1300);
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

test('fr_cnv_01_ac2_slash_task_preselects_task_for_a_paragraph_with_text', async ({ page }) => {
  await openConvert(page, C.bloky, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.type(SLASH_AFTER('/task'));
  const menu = await must(slashMenu(page), 'listbox "Insert block" for /task');
  await must(menu.getByRole('option', { name: 'Task', exact: true }), 'option "Task"');
  await page.keyboard.press('Enter');
  await needPopover(page, '/task ⏎');
  assert.equal(await checkedType(page), 'Task', '/task preselects Task (the last type was Page)');
  assert.equal((await titleState(page)).value, 'Úvodní odstavec.', 'the paragraph\'s text is the title');
  await page.keyboard.press('Escape');
  assert.ok(await absent(popover(page), 1000), 'Esc closes R50');
  assert.ok(sameOrSpace(await hostText(page), B0, 'Úvodní odstavec.'), '/task removed on close');
});

test('fr_cnv_01_ac2_slash_task_in_an_empty_paragraph_creates_an_empty_task', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  await (await must(addBelow(page), 'button "Add block below"')).click();
  await sleep(100);
  await page.keyboard.type('/task');
  await must(slashMenu(page).getByRole('option', { name: 'Task', exact: true }), 'option "Task"');
  await page.keyboard.press('Enter');
  await needPopover(page, '/task in an empty paragraph');
  assert.equal((await titleState(page)).value, '', 'an empty title');
  assert.equal(await checkedType(page), 'Task', 'Task preselected');
  await confirm(page, { title: 'Prázdný úkol' });
  const t = await needFile(core, 'Tasks/Prázdný úkol.md');
  assert.equal(maskId(t), taskBytes('Prázdný úkol', { source: '"[[Bloky]]"' }), 'a new empty Task with that title and source');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, 'Úvodní odstavec.\n\n', 'Úvodní odstavec.\n\n![[Prázdný úkol]]\n\n')), 'its embed where the empty paragraph was');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-3

test('fr_cnv_01_ac3_shift_cmd_t_preselects_task_with_the_title_selected', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+t');
  assert.equal(await checkedType(page), 'Task', '⇧⌘T preselects Task');
  assert.deepEqual(await titleState(page), { value: 'Úvodní odstavec.', allSelected: true, focused: true }, 'the title is focused and selected');
  await page.keyboard.press('Enter');
  assert.ok(await absent(popover(page), 2000), '⏎ converts');
  const p = await onlyNew(core, '⇧⌘T ⏎');
  assert.ok(p.startsWith('Tasks/'), `a Task in Tasks/: ${p}`);
  assert.equal(fm(await fileText(core, p), 'type'), 'task', 'type: task');
});

test('fr_cnv_01_ac3_shift_cmd_o_preselects_the_last_type_first_time_task', async ({ page }) => {
  await openConvert(page, C.bloky, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+o');
  assert.equal(await checkedType(page), 'Page', '⇧⌘O preselects the last type used (Page)');
  await page.keyboard.press('Escape');
  const p2 = await page.context().newPage();
  await openConvert(p2, C.bloky);
  await popoverAt(p2, 'Úvodní odstavec.', 'Meta+Shift+o');
  assert.equal(await checkedType(p2), 'Task', 'first time: Task (D-493)');
  await p2.close();
});

test('fr_cnv_01_ac3_the_last_type_is_remembered_per_machine', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Úvodní odstavec.', { key: 'Meta+Shift+o', type: 'Quick Note' });
  const p = await onlyNew(core, 'Convert into Quick Note');
  assert.ok(p.startsWith('Quick Notes/'), `a Quick Note: ${p}`);
  const st = await eventually(() => core.uiState(), (s) => !!s?.convert, 2000);
  assert.equal(st?.convert?.lastType, 'quick-note', 'UiStateDto.convert.lastType (ui_state_set, never the vault)');
  assert.ok(!Object.keys(await core.files()).some((f) => f.startsWith('.tegg/') && (convertVault().files[f] !== undefined ? false : true)), 'nothing new under .tegg/');
});

test('fr_cnv_01_ac3_palette_commands_do_the_same', async ({ page }) => {
  await openConvert(page, C.bloky, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  await caretAfter(page, 'Úvodní odstavec.');
  await runCommand(page, 'Turn into task');
  await needPopover(page, 'palette "Turn into task"');
  assert.equal(await checkedType(page), 'Task', 'Turn into task preselects Task');
  assert.equal((await titleState(page)).value, 'Úvodní odstavec.', 'for the caret\'s block');
  await page.keyboard.press('Escape');
  assert.ok(await absent(popover(page), 1000), 'closed');
  await caretAfter(page, 'Úvodní odstavec.');
  await runCommand(page, 'Turn into object…');
  await needPopover(page, 'palette "Turn into object…"');
  assert.equal(await checkedType(page), 'Page', 'Turn into object… preselects the last type');
});

test('fr_cnv_01_ac3_off_the_editor_the_commands_are_not_run', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  const opt = await paletteEntry(page, 'Turn into task');
  assert.equal(await isDisabled(opt), false, 'on a note route with the editor the palette lists Turn into task enabled');
  assert.ok(flat(await opt.innerText()).includes('⇧⌘T'), 'with its shortcut ⇧⌘T (R53)');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Tasks');
  await must(main(page).getByRole('heading', { level: 1, name: 'Tasks' }), 'the Tasks page', 5000);
  await shortcutsDoNothing(page, 'Tasks page');
  await runCommand(page, 'Turn into task');
  await sleep(300);
  assert.equal(await seen(popover(page), 300), false, 'the palette command isn\'t run off the editor');
  assert.equal(await page.getByRole('alert').count(), 0, 'and shows no error');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-4

test('fr_cnv_01_ac4_block_selection_of_heading_and_paragraph', async ({ page }) => {
  await openConvert(page, C.bloky);
  const sel = await selectBlocks(page, 'Připravit podklady', 1);
  assert.deepEqual(sel, [3, 4], 'Esc + ⇧↓ selects the heading and its paragraph (FR-EDT-13)');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O on a block selection');
  assert.equal(flat(await summary(page).innerText()), '2 blocks move into a new Task. An embed takes their place.', 'R50 for both blocks');
  assert.equal((await titleState(page)).value, 'Připravit podklady', 'the heading is the title');
  await page.keyboard.press('Escape');
  const again = await selectBlocks(page, 'Připravit podklady', 1);
  assert.deepEqual(again, [3, 4], 'selected again');
  await page.keyboard.press('Meta+/');
  await click(blockMenu(page).getByRole('menuitem', { name: 'Turn into object', exact: true }), 'Block actions › Turn into object');
  await needPopover(page, 'the block menu on a block selection');
  assert.equal(flat(await summary(page).innerText()), '2 blocks move into a new Task. An embed takes their place.', 'the block menu: both blocks');
});

test('fr_cnv_01_ac4_text_selection_converts_the_whole_blocks_it_touches', async ({ page }) => {
  await openConvert(page, C.bloky);
  await selectText(page, 'podklady', 'pod nadpisem');
  await click(toolbar(page).getByRole('button', { name: 'Turn into object', exact: true }), 'Formatting › Turn into object');
  await needPopover(page, 'the toolbar');
  assert.equal(flat(await summary(page).innerText()), '2 blocks move into a new Task. An embed takes their place.', 'the two whole blocks');
  assert.equal((await titleState(page)).value, 'Připravit podklady', 'the whole heading, not the selected text');
});

test('fr_cnv_01_ac4_a_selection_inside_a_quote_converts_the_whole_quote', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await selectText(page, 'Citace');
  await click(toolbar(page).getByRole('button', { name: 'Turn into object', exact: true }), 'Formatting › Turn into object');
  await needPopover(page, 'the toolbar in a quote');
  assert.equal((await titleState(page)).value, 'Citace k převedení.', 'the quote\'s first line');
  await confirm(page, { type: 'Page' });
  const p = await onlyNew(core, 'the quote');
  assert.equal(fm(await fileText(core, p), 'title'), 'Citace k převedení.', 'title');
  assert.equal(bodyOf(await fileText(core, p)), '', 'a one-line quote leaves no body');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '> Citace k převedení.\n', `![[${stemOf(p)}]]\n`)), 'the whole quote is replaced by the embed');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-5

test('fr_cnv_01_ac5_read_view_offers_it_disabled', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { readView: true });
  await main(page).getByText('Úvodní odstavec.').first().click().catch(() => {});
  await shortcutsDoNothing(page, 'read view');
  for (const t of ['Turn into task', 'Turn into object…']) {
    await disabledWith(await paletteEntry(page, t), 'This note can\'t be edited here.', `read view: palette "${t}"`);
    await page.keyboard.press('Enter');
    assert.equal(await seen(popover(page), 300), false, `read view: "${t}" does nothing`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

test('fr_cnv_01_ac5_a_read_only_file_offers_it_disabled', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const bytes = new TextEncoder().encode(swap(swap(B0, 'title: Bloky', 'title: Neplatné bloky'), 'E101', 'W101'));
  await core.setFile('Pages/Neplatné bloky.md', new Uint8Array([...bytes, 0x78, 0xff, 0x0a]));
  await switchTo(page, 'Neplatné bloky');
  await mustBeOn(page, 'Neplatné bloky', 'the invalid-UTF-8 copy', 5000);
  await main(page).getByText('Úvodní odstavec.').first().click().catch(() => {});
  await shortcutsDoNothing(page, 'read-only file');
  await disabledWith(await paletteEntry(page, 'Turn into task'), 'This note can\'t be edited here.', 'read-only file: palette "Turn into task"');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

test('fr_cnv_01_ac5_inside_a_nested_editor_of_a_full_embed', async ({ page }) => {
  const core = await openConvert(page, C.obal);
  const f = await must(frame(main(page), 'Porada'), 'the full embed of Porada', 5000);
  assert.ok(await caretAt(f, 'Zápis z porady.'), 'caret in the nested editor');
  await shortcutsDoNothing(page, 'nested editor');
  await page.keyboard.press('Meta+/');
  const item = blockMenu(page).getByRole('menuitem', { name: 'Turn into object', exact: true });
  if (await seen(item, 800)) {
    await disabledWith(item, 'Open the embedded note to convert its blocks.', 'nested editor: Block actions › Turn into object');
    await page.keyboard.press('Escape');
  }
  assert.ok(await caretAt(f, 'Zápis z porady.'), 'caret back in the nested editor');
  await disabledWith(await paletteEntry(page, 'Turn into object…'), 'Open the embedded note to convert its blocks.', 'nested editor: palette "Turn into object…"');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

test('fr_cnv_01_ac5_in_a_template_note', async ({ page }) => {
  const core = await openConvert(page, null, { route: `note/${C.sablona}`, noEditor: true });
  await must(editorBody(page).getByText('Úkol v šabloně'), 'the template opened in the editor (route note/_templates/Page/Page.md)', 5000);
  await caretAfter(page, 'Úkol v šabloně');
  await shortcutsDoNothing(page, 'template');
  await caretAfter(page, 'Úkol v šabloně');
  await page.keyboard.press('Meta+/');
  await disabledWith(blockMenu(page).getByRole('menuitem', { name: 'Turn into object', exact: true }), 'Blocks of a template can\'t be turned into objects.', 'template: Block actions › Turn into object');
  await page.keyboard.press('Escape');
  await caretAfter(page, 'Úkol v šabloně');
  await page.keyboard.type(SLASH_AFTER('/turn'));
  const opt = slashMenu(page).getByRole('option', { name: 'Turn into object…', exact: true });
  await disabledWith(opt, 'Blocks of a template can\'t be turned into objects.', 'template: slash "Turn into object…"');
  await page.keyboard.press('Escape');
  await caretAfter(page, 'Úkol v šabloně');
  await disabledWith(await paletteEntry(page, 'Turn into task'), 'Blocks of a template can\'t be turned into objects.', 'template: palette "Turn into task"');
  await page.keyboard.press('Escape');
  assert.equal((await newPaths(core)).length, 0, 'no object is created from a template');
});

test('fr_cnv_01_ac5_title_field_and_attribute_panel_dont_run_it', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  assert.equal(await isDisabled(await paletteEntry(page, 'Turn into task')), false, 'in the body the command is enabled');
  await page.keyboard.press('Escape');
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }).first(), 'the note\'s Title field');
  await title.focus();
  await shortcutsDoNothing(page, 'title field');
  await page.keyboard.press('Meta+Alt+p').catch(() => {});
  const props = page.getByRole('region', { name: 'Properties', exact: true });
  if (await seen(props, 800)) {
    await props.locator('input, [role="textbox"], button').first().focus();
    await shortcutsDoNothing(page, 'attribute panel');
  }
  assert.equal(nfc(await title.inputValue().catch(async () => (await title.innerText()))), 'Bloky', 'the title is unchanged');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-6

test('fr_cnv_01_ac6_types_offered_and_keyboard_in_the_radiogroup', async ({ page }) => {
  await openConvert(page, C.bloky);
  await popoverAt(page, 'Úvodní odstavec.', 'Meta+Shift+o');
  assert.deepEqual(await typeNames(page), ['Page', 'Task', 'Quick Note', 'Projekt'], 'exactly Page, Task, Quick Note, Projekt; no Daily Note, Tag, Image or PDF');
  for (const no of ['Daily Note', 'Tag', 'Image', 'PDF']) assert.equal(await typeRadio(page, no).count(), 0, `no ${no}`);
  for (const n of await typeNames(page)) {
    const icon = await typeRadio(page, n).evaluate((e) => !!e.querySelector('svg, [data-icon]'));
    assert.ok(icon, `${n}: with its type icon`);
  }
  await (await must(typeRadio(page, 'Task'), 'radio Task')).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await checkedType(page), 'Quick Note', '↓ moves to Quick Note');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await checkedType(page), 'Page', '↑↑ moves to Page');
  await page.keyboard.press('q');
  assert.equal(await checkedType(page), 'Quick Note', 'the first letter q moves to Quick Note');
  await page.keyboard.press('t');
  assert.equal(await checkedType(page), 'Task', 'the first letter t moves to Task');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-7

test('fr_cnv_01_ac7_keyboard_only_conversion', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O');
  const missing = await popover(page).evaluate((root) => [...root.querySelectorAll('button, [role="button"], [role="radio"], [role="checkbox"]')]
    .filter((e) => (e as HTMLElement).getClientRects().length > 0 && !(e.getAttribute('data-command') ?? '').trim())
    .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()));
  assert.deepEqual(missing, [], 'FR-UX-03 AC-8 with R50 open: every control carries data-command');
  await page.keyboard.type('Klávesnicí');
  const order: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return `${a?.getAttribute('role') ?? a?.tagName.toLowerCase()} ${(a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim()}`; }));
  }
  assert.deepEqual(order.map((o) => o.replace(/^input /, 'button ').split(' ')[0]), ['radio', 'button', 'button'], `Tab: Title → Type → Convert → Cancel (${order.join(' | ')})`);
  assert.ok(/Convert$/.test(order[1]) && /Cancel$/.test(order[2]), `Convert then Cancel: ${order.join(' | ')}`);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowDown');
  assert.equal(await checkedType(page), 'Quick Note', '↓ to a type');
  await (await must(titleBox(page), 'Title')).focus();
  await page.keyboard.press('Enter');
  assert.ok(await absent(popover(page), 2000), '⏎ converts');
  const t = await needFile(core, 'Quick Notes/Klávesnicí.md');
  assert.equal(fm(t, 'title'), 'Klávesnicí', 'the typed title');
  assert.deepEqual(await eventually(() => selectedBlocks(page), (s) => s.length > 0, 1000), [1], 'the new embed is selected as a block (FR-EDT-13)');
  await page.keyboard.press('Enter');
  const f = await must(frame(main(page), 'Klávesnicí'), 'the new full embed');
  assert.equal(await eventually(() => focusInside(f), (x) => x, 1000), true, '⏎ enters its body (FR-EMB-02 AC-14)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Klávesnicí', '⌘↩ opens the new object', 5000);
});

test('fr_cnv_01_ac7_esc_returns_the_caret_to_where_it_was', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'Odstavec pod');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O');
  await page.keyboard.press('Escape');
  assert.ok(await absent(popover(page), 1000), 'Esc closes R50');
  const where = await page.evaluate(() => {
    const s = window.getSelection();
    const n = s?.anchorNode;
    return { text: (n?.textContent ?? '').normalize('NFC'), offset: s?.anchorOffset ?? -1, inBody: !!(n && (n.nodeType === 3 ? n.parentElement : n as Element)?.closest('[contenteditable="true"]')), collapsed: s?.isCollapsed ?? false };
  });
  assert.deepEqual(where, { text: 'Odstavec pod nadpisem.', offset: 'Odstavec pod'.length, inBody: true, collapsed: true }, 'the caret is back where it was');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-8

const USER = new Set(['Úvodní odstavec.', 'Page', 'Task', 'Quick Note', 'Projekt', 'Zavolat Janě', 'To do', 'High', 'Domluvit schůzku na příští týden.'].map(nfc));
/** Texts of `root` outside ⟦ ⟧ that aren't user content (titles, type names, labels, body text, dates from Intl). */
async function leaks(scope: Locator): Promise<string[]> {
  return scope.first().evaluate((root, allowed) => {
    const ok = new Set(allowed as string[]);
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').trim().normalize('NFC');
        const el = n.parentElement;
        if (!t || !el || el.closest('[data-embed-body], [data-link-kind], [data-user-content], [data-due]')) return;
        if (ok.has(t) || /⟦|⟧/.test(el.textContent ?? '')) return;
        out.push(t);
      } else n.childNodes.forEach(walk);
    };
    walk(root);
    for (const e of (root as Element).querySelectorAll('[aria-label]')) {
      const l = (e.getAttribute('aria-label') ?? '').normalize('NFC');
      if (l && !/⟦/.test(l) && !ok.has(l)) out.push(`aria-label ${l}`);
    }
    return out;
  }, [...USER]);
}
test('fr_cnv_01_ac8_pseudo_locale_r50_and_task_cards', async ({ page }) => {
  await openConvert(page, C.bloky, { prelude: pseudoLocale, noEditor: true });
  await must(editorBody(page), 'the editor', 5000);
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press('Meta+Shift+o');
  const pop = await must(page.getByRole('dialog', { name: /^⟦Turn into object⟧$/ }), 'dialog ⟦Turn into object⟧ (R54 convert.title)');
  assert.deepEqual(await leaks(pop), [], 'R50: only titles and type names outside ⟦ ⟧');
  await page.keyboard.press('Escape');
  const p2 = await page.context().newPage();
  await openConvert(p2, C.porada, { prelude: pseudoLocale, noEditor: true });
  const card = await must(main(p2).locator('[data-task-card]'), 'the Task card of Porada', 5000);
  assert.deepEqual(await leaks(card), [], 'R52: only title, labels and body text outside ⟦ ⟧');
  await p2.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_cnv_01_ac8_contrast_and_tokens_r50_${theme}`, async ({ page }) => {
    await openConvert(page, C.bloky, { theme });
    await caretAfter(page, 'Úvodní odstavec.');
    await page.keyboard.press('Meta+Shift+o');
    await needPopover(page, `${theme}: ⇧⌘O`);
    const failures: string[] = [];
    for (const v of await axeContrast(page)) failures.push(`R50: contrast ${v}`);
    for (const v of await colourLeaks(page, theme)) failures.push(`R50: colour ${v}`);
    assert.deepEqual(failures, [], `R50: no color-contrast violation and no colour leak (${theme})`);
  });

  test(`fr_cnv_01_ac8_contrast_and_tokens_task_cards_${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openConvert(page, C.porada, { theme });
    await needCard(main(page), 'Zavolat Janě', `${theme}: Porada's Task card`);
    const failures: string[] = [];
    for (const v of await axeContrast(page)) failures.push(`Porada: contrast ${v}`);
    for (const v of await colourLeaks(page, theme)) failures.push(`Porada: colour ${v}`);
    await switchTo(page, 'Dvě karty');
    await mustBeOn(page, 'Dvě karty', 'Dvě karty', 5000);
    await needCard(main(page), 'Zavolat Janě', `${theme}: Dvě karty's second card`, 1);
    for (const v of await axeContrast(page)) failures.push(`Dvě karty: contrast ${v}`);
    for (const v of await colourLeaks(page, theme)) failures.push(`Dvě karty: colour ${v}`);
    assert.deepEqual(failures, [], `Task cards: no color-contrast violation and no colour leak (${theme})`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-CNV-02, FR-CNV-03 AC-1, AC-2

test('fr_cnv_02_ac1_paragraph_with_two_lines_title_and_body', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, ZAVOLAT);
  const t = await needFile(core, ZAVOLAT_TASK);
  assert.equal(fm(t, 'title'), ZAVOLAT, 'the first line is the title');
  assert.equal(bodyOf(t), 'a domluvit termín.\n', 'the second line is the body');
});

test('fr_cnv_03_ac1_the_new_file_bytes', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, ZAVOLAT);
  const t = await needFile(core, ZAVOLAT_TASK);
  assert.equal(maskId(t), taskBytes(ZAVOLAT, { source: '"[[Bloky]]"', body: 'a domluvit termín.\n' }), 'exactly the FR-CNV-03 AC-1 bytes (id a ULID)');
  const creates = await callsOf(core, 'note_create');
  assert.equal(creates.length, 1, 'one note_create (the one creation path, D-245)');
  assert.equal(nfc(String(creates[0].result ?? '')), ZAVOLAT_TASK, 'it wrote Tasks/Zavolat do servisu kvůli kolu.md');
  assert.equal((await newPaths(core)).join(), ZAVOLAT_TASK, 'exactly one new file');
});

test('fr_cnv_03_ac1_page_and_quick_note_rules', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Závěrečný odstavec.', { key: 'Meta+Shift+o', type: 'Quick Note' });
  const q = await onlyNew(core, 'Quick Note');
  const qt = await fileText(core, q);
  assert.equal(fm(qt, 'type'), 'quick-note', 'type: quick-note');
  assert.equal(fm(qt, 'review'), 'unreviewed', 'review: unreviewed (FR-TYP-03 AC-12)');
  assert.equal(fm(qt, 'source'), '"[[Bloky]]"', 'the same source');
  assert.equal(fm(qt, 'status'), null, 'no task keys');
  await convertAt(page, 'Úvodní odstavec.', { key: 'Meta+Shift+o', type: 'Page' });
  const all = await eventually(() => newPaths(core), (p) => p.length >= 2, 3000);
  const pg = all.find((p) => p.startsWith('Pages/'));
  assert.ok(pg, `a Page in Pages/: ${JSON.stringify(all)}`);
  const pt = await fileText(core, pg!);
  assert.equal(fm(pt, 'type'), 'page', 'type: page');
  assert.equal(fm(pt, 'source'), '"[[Bloky]]"', 'source');
  assert.equal(fm(pt, 'review'), null, 'no review for a Page');
});

test('fr_cnv_03_ac2_the_source_note_and_the_task_card', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, ZAVOLAT);
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, BLOKY_AC2, 'lines 3–4 replaced by the embed; every other byte identical; only modified changes');
  assert.equal(frontOf(b), touched(frontOf(B0)), 'the frontmatter differs only in modified');
  const card = await needCard(main(page), ZAVOLAT, 'the new embed', 0, 1000);
  assert.equal(await card.getAttribute('data-embed-mode'), 'card', 'R52 card mode');
});

test('fr_cnv_02_ac2_heading_and_paragraph_into_a_page', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await selectBlocks(page, 'Připravit podklady', 1);
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O on two blocks');
  await confirm(page, { type: 'Page' });
  const t = await needFile(core, 'Pages/Připravit podklady.md');
  assert.equal(fm(t, 'title'), 'Připravit podklady', 'title');
  assert.equal(bodyOf(t), 'Odstavec pod nadpisem.\n', 'body');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '## Připravit podklady\n\nOdstavec pod nadpisem.\n', '![[Připravit podklady]]\n')), 'one embed in place of both');
});

test('fr_cnv_02_ac3_checklist_item_with_children_and_markup', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { panel: true });
  await convertAt(page, 'projektor pro');
  const path = 'Tasks/Objednat nový projektor pro Zasedačka.md';
  const t = await needFile(core, path);
  assert.equal(fm(t, 'title'), 'Objednat nový projektor pro Zasedačka', 'plain-text title');
  assert.equal(fm(t, 'tags'), '[práce]', 'tags: [práce]');
  assert.equal(bodyOf(t), 'Objednat **nový** projektor pro [[Zasedačka]]\n\n- zjistit cenu\n- porovnat nabídky\n', 'the line kept with its link, children de-indented');
  await saved(page, core, C.bloky, (x) => x !== B0);
  await switchTo(page, 'Zasedačka');
  await mustBeOn(page, 'Zasedačka', 'Zasedačka', 5000);
  const panel = await must(page.getByRole('tabpanel', { name: 'Backlinks' }), 'Backlinks panel', 5000);
  const names = await eventually(async () => (await panel.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? (a as HTMLElement).innerText ?? ''))).map(flat),
    (n) => n.includes('Objednat nový projektor pro Zasedačka'), 3000);
  assert.ok(names.includes('Objednat nový projektor pro Zasedačka'), `the link moved with the text: ${JSON.stringify(names)}`);
  assert.ok(names.includes('Bloky'), 'Bloky still (its own ![[Zasedačka]])');
});

test('fr_cnv_02_ac4_unchecked_and_checked_items_into_tasks', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Koupit lepidlo');
  const a = await needFile(core, 'Tasks/Koupit lepidlo (2).md');
  assert.equal(maskId(a), taskBytes('Koupit lepidlo', { source: '"[[Bloky]]"' }), '[ ]: title, empty body, status: To do');
  await convertAt(page, 'Vrátit nářadí');
  const b = await needFile(core, 'Tasks/Vrátit nářadí.md');
  assert.equal(fm(b, 'status'), 'Done', '[x]: the first Done-state status');
  assert.equal(fm(b, 'completed'), NOW, '[x]: completed now (AP-425)');
  assert.equal(bodyOf(b), '', 'empty body');
});

test('fr_cnv_02_ac4_items_into_a_page_drop_the_check_state', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Vrátit nářadí', { key: 'Meta+Shift+o', type: 'Page' });
  const t = await needFile(core, 'Pages/Vrátit nářadí.md');
  assert.equal(fm(t, 'title'), 'Vrátit nářadí', 'only the title');
  assert.equal(fm(t, 'status'), null, 'no status');
  assert.equal(fm(t, 'completed'), null, 'no completed');
  assert.equal(bodyOf(t), '', 'the marker isn\'t kept');
});

test('fr_tsk_11_ac4_one_action_converts_a_checklist_item_of_porada', async ({ page }) => {
  const core = await openConvert(page, C.porada);
  const p0 = original(C.porada);
  await convertAt(page, 'Zavolat dodavateli');
  const t = await needFile(core, 'Tasks/Zavolat dodavateli.md');
  assert.equal(maskId(t), taskBytes('Zavolat dodavateli', { source: '"[[Porada]]"' }), '⇧⌘T ⏎: a Task with status To do and source Porada');
  const p = await saved(page, core, C.porada, (x) => x !== p0);
  assert.equal(p, touched(swap(p0, '- [ ] Zavolat dodavateli\n- [x] Poslat zápis', '![[Zavolat dodavateli]]\n\n- [x] Poslat zápis')), 'the item is cut out of the list');
});

test('fr_cnv_02_ac5_a_code_fence_first_needs_a_title', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await caretAfter(page, 'kód();');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O in the fence');
  assert.equal((await titleState(page)).value, '', 'an empty title');
  const conv = await must(convertButton(page), 'Convert');
  assert.equal(await isDisabled(conv), true, 'Convert aria-disabled');
  assert.equal(await description(conv), 'Add a title', 'with Add a title');
  await page.keyboard.press('Enter');
  assert.equal(await seen(popover(page), 300), true, '⏎ does nothing while the title is empty');
  await confirm(page, { title: 'Skript' });
  const t = await needFile(core, 'Tasks/Skript.md');
  assert.equal(bodyOf(t), '```js\nkód();\n```\n', 'the fence byte for byte');
});

test('fr_cnv_02_ac5_an_embed_first_goes_to_the_body', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { convert: { lastType: 'page', skipRemoveConfirm: false } });
  const n = await eventually(async () => (await embedList(editorBody(page)).catch(() => [])).length, (x) => x >= 1, 5000);
  assert.ok(n >= 1, 'the embed of Zasedačka is shown');
  const idx = await eventually(() => page.evaluate(() => {
    const b = document.querySelector('[aria-label="Note body"]');
    return b ? [...b.children].findIndex((e) => e.querySelector('[data-embed-mode]') || e.hasAttribute('data-embed-mode')) + 1 : 0;
  }), (x) => x > 0, 3000);
  const sel = await selectTop(page, idx);
  assert.deepEqual(sel, [idx], 'the embed is selected as a block');
  await page.keyboard.press('Meta+Shift+o');
  await needPopover(page, '⇧⌘O on the embed');
  assert.equal((await titleState(page)).value, '', 'an empty title');
  await confirm(page, { title: 'Vložená zasedačka' });
  const t = await needFile(core, 'Pages/Vložená zasedačka.md');
  assert.equal(bodyOf(t), '![[Zasedačka]]\n', 'the embed line is the body');
});

test('fr_cnv_02_ac6_the_title_is_editable', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await popoverAt(page, ZAVOLAT);
  const box = await must(titleBox(page), 'Title');
  await box.fill('   ');
  assert.equal(await isDisabled(convertButton(page)), true, 'a title of only spaces keeps Convert disabled');
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.deepEqual(await newPaths(core), [], 'nothing created');
  await confirm(page, { title: 'Servis kola' });
  const t = await needFile(core, 'Tasks/Servis kola.md');
  assert.equal(fm(t, 'title'), 'Servis kola', 'title: Servis kola');
  assert.equal(bodyOf(t), 'a domluvit termín.\n', 'the first line\'s text isn\'t in the body');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, ZAVOLAT_PARA, '![[Servis kola]]\n')), 'the embed names the stem Servis kola');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-3, AC-4

test('fr_cnv_03_ac3_cut_out_of_a_checklist', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'projektor pro');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0,
    '- [ ] Objednat **nový** projektor pro [[Zasedačka]] #práce\n  - zjistit cenu\n  - porovnat nabídky\n- [ ] Rezervovat sál',
    '\n![[Objednat nový projektor pro Zasedačka]]\n\n- [ ] Rezervovat sál')), 'the list splits around the embed; the three item lines byte-identical');
});

test('fr_cnv_03_ac3_cut_out_of_a_numbered_list_keeps_the_numbers', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Druhý bod', { key: 'Meta+Shift+o', type: 'Page' });
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '1. První bod\n2. Druhý bod\n3. Třetí bod\n', '1. První bod\n\n![[Druhý bod]]\n\n3. Třetí bod\n')), '3. stays 3.');
  const f = await must(frame(main(page), 'Druhý bod'), 'Druhý bod as an embed', 2000);
  assert.equal(await f.getAttribute('data-embed-mode'), 'full', 'a full embed (Page default)');
  assert.ok(flat(await f.innerText()).includes('Empty note'), 'showing Empty note');
});

test('fr_cnv_03_ac3_the_first_item_puts_the_embed_before_the_list', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Koupit lepidlo');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '- [ ] Koupit lepidlo\n- [x] Vrátit nářadí', '![[Koupit lepidlo (2)]]\n\n- [x] Vrátit nářadí')), 'the embed paragraph, then the list from Vrátit nářadí');
});

test('fr_cnv_03_ac4_a_nested_item_becomes_a_nested_embed_item', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'zjistit cenu');
  const t = await needFile(core, 'Tasks/zjistit cenu.md');
  assert.equal(fm(t, 'title'), 'zjistit cenu', 'title');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.equal(b, touched(swap(B0, '  - zjistit cenu\n', '  - ![[zjistit cenu]]\n')), 'replaced in place; parent and siblings keep their bytes');
  assert.ok(await seen(linkEmbed(editorBody(page), 'zjistit cenu'), 2000), 'shown as a link-mode embed (D-419)');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-5, AC-6

test('fr_cnv_03_ac5_names_and_collisions', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'Koupit lepidlo');
  assert.equal(fm(await needFile(core, 'Tasks/Koupit lepidlo (2).md'), 'title'), 'Koupit lepidlo', 'the next free stem, the same title');
  assert.equal(await fileText(core, C.lepidlo), original(C.lepidlo), 'Lepidlo untouched');
  await convertAt(page, 'Q3: rozpočet');
  const q = await needFile(core, 'Tasks/Q3 rozpočet plán.md');
  assert.equal(fm(q, 'title'), '"Q3: rozpočet/plán"', 'the title quoted as written');
  const b = await saved(page, core, C.bloky, (x) => !!x?.includes('![[Q3 rozpočet plán]]'));
  assert.ok(b?.includes('![[Koupit lepidlo (2)]]') && b.includes('![[Q3 rozpočet plán]]\n'), 'the embeds name the files written');
});

test('fr_cnv_03_ac5_a_stem_taken_after_the_popover', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await popoverAt(page, ZAVOLAT);
  const other = `---\nid: 01JB5A0000000000000000W201\ntype: task\ntitle: ${ZAVOLAT}\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n`;
  await core.setFile(ZAVOLAT_TASK, other, { silent: true });
  await confirm(page);
  const t = await needFile(core, `Tasks/${ZAVOLAT} (2).md`);
  assert.equal(fm(t, 'title'), ZAVOLAT, 'the next free stem');
  assert.equal(await fileText(core, ZAVOLAT_TASK), other, 'the other file is untouched');
  const b = await saved(page, core, C.bloky, (x) => x !== B0);
  assert.deepEqual(embedTargets(b).filter((e) => e.startsWith('Zavolat')), [`${ZAVOLAT} (2)`], 'the embed names the file actually created');
});

test('fr_cnv_03_ac6_two_writes_in_order_and_an_immediate_save', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { clock: false });
  const base = await core.version(C.bloky);
  await popoverAt(page, ZAVOLAT);
  await (await must(titleBox(page), 'Title')).focus();
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  const w = await eventually(() => writesOf(core, C.bloky), (x) => x.length >= 1, 3000);
  const took = Date.now() - t0;
  assert.equal(w.length, 1, 'one source save');
  assert.ok(took < 800, `the source save is flushed at once, not after the 1 s autosave: ${took} ms`);
  assert.deepEqual((w[0].args as any).base, base, 'with the source\'s current version as base');
  await sleep(1500);
  assert.deepEqual(await writeLog(core), [`note_create ${ZAVOLAT_TASK}`, `note_write ${C.bloky}`], 'exactly two write commands: create first, then the source');
});

test('fr_cnv_03_ac6_a_failed_create_changes_nothing', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await core.writeControl({ fail: 'Io', path: ZAVOLAT_TASK });
  await convertAt(page, ZAVOLAT);
  await must(alertWith(page, `Couldn’t create "${ZAVOLAT}". Nothing was changed.`), 'the convert.failed alert', 2000);
  assert.equal(await hostText(page), B0, 'the source document is unchanged');
  await sleep(1300);
  assert.deepEqual(await writesOf(core, C.bloky), [], 'the source isn\'t written');
  assert.deepEqual(await changedPaths(core), [], 'nothing is written');
});

test('fr_cnv_03_ac6_a_failed_source_save_keeps_the_new_file_and_the_converted_state', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await core.writeControl({ fail: 'Io', path: C.bloky });
  await convertAt(page, ZAVOLAT);
  await needFile(core, ZAVOLAT_TASK);
  await sleep(800);
  assert.equal(await fileText(core, C.bloky), B0, 'Bloky on disk is unchanged');
  assert.ok((await hostText(page))?.includes(EMBED_ZAVOLAT), 'the editor keeps the converted state, unsaved');
  assert.equal(await fileText(core, ZAVOLAT_TASK) !== undefined, true, 'the new file stays');
});

test('fr_cnv_03_ac6_a_conflict_on_the_source_save_follows_the_merge_rules', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const ext = `${B0}Změněno jinde.\n`;
  await core.setFile(C.bloky, ext, { silent: true });
  await convertAt(page, ZAVOLAT);
  await needFile(core, ZAVOLAT_TASK);
  await must(mergeDialog(page), 'the merge dialog (FR-SYN-03 AC-13)', 3000);
  assert.equal(await fileText(core, C.bloky), ext, 'the external change is never overwritten');
  assert.ok((await hostText(page))?.includes(EMBED_ZAVOLAT), 'the converted state is kept unsaved');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-9

test('fr_cnv_03_ac9_crlf_host_keeps_its_envelope', async ({ page }) => {
  const core = await openConvert(page, C.crlfHost);
  const h0 = original(C.crlfHost);
  await convertAt(page, 'Úkol s CRLF');
  const t = await needFile(core, 'Tasks/Úkol s CRLF.md');
  assert.equal(maskId(t), taskBytes('Úkol s CRLF', { source: '"[[CRLF host]]"' }), 'the new task uses \\n');
  const h = await saved(page, core, C.crlfHost, (x) => x !== h0);
  assert.equal(h, swap(h0, 'Úkol s CRLF', '![[Úkol s CRLF]]').replace(/^modified: .*\r$/m, `modified: ${NOW}\r`), 'CRLF everywhere, no final newline');
});

test('fr_cnv_03_ac9_a_host_without_frontmatter_gets_id_and_type', async ({ page }) => {
  const core = await openConvert(page, C.bezHost);
  await convertAt(page, 'Úkol bez hlavičky');
  const t = await needFile(core, 'Tasks/Úkol bez hlavičky.md');
  assert.equal(fm(t, 'source'), '"[[Bez hlavičky host]]"', 'source');
  const h = await saved(page, core, C.bezHost, (x) => x !== original(C.bezHost));
  assert.equal(bodyOf(h), '![[Úkol bez hlavičky]]\n\nKonec.\n', 'the embed in the body');
  assert.ok(idOf(h) && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(idOf(h)!), 'id added (D-54)');
  assert.equal(fm(h, 'type'), 'page', 'type: page added');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-10

test('fr_cnv_03_ac10_a_virtual_daily_note_as_source', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await cmdD(page, '2026-10-14');
  const body = await must(editorBody(page), 'the Daily Note editor');
  await body.click();
  await page.keyboard.type('Zavolat zubaři');
  await page.keyboard.press('Meta+Shift+t');
  await needPopover(page, '⇧⌘T before the first autosave');
  await page.keyboard.press('Enter');
  const t = await needFile(core, 'Tasks/Zavolat zubaři.md');
  assert.equal(fm(t, 'source'), '"[[2026-10-14]]"', 'source: "[[2026-10-14]]"');
  const d = await fileWhen(core, 'Daily/2026-10-14.md', (x) => x !== undefined, 3000);
  assert.equal(bodyOf(d), '![[Zavolat zubaři]]\n', 'the Daily Note\'s first write holds only the embed');
  await sleep(1300);
  assert.deepEqual(await changedPaths(core), ['Daily/2026-10-14.md', 'Tasks/Zavolat zubaři.md'], 'exactly two files');
  const order = (await core.writesTo()).map(nfc);
  assert.deepEqual(order, ['Tasks/Zavolat zubaři.md', 'Daily/2026-10-14.md'], 'the task first, then the Daily Note once (create-exclusive)');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-03 AC-11

test('fr_cnv_03_ac11_the_embed_resolves_to_the_new_file_dvojnik_pages', async ({ page }) => {
  const core = await openConvert(page, C.dvojnikP);
  await convertAt(page, 'Úkol z dvojníka');
  const t = await needFile(core, 'Tasks/Úkol z dvojníka.md');
  assert.equal(fm(t, 'source'), '"[[Dvojník]]"', 'source from Tasks/ (FR-CNV-04 AC-1)');
  const h = await saved(page, core, C.dvojnikP, (x) => x !== original(C.dvojnikP));
  assert.deepEqual(embedTargets(h), ['Úkol z dvojníka'], 'the embed target');
  const shown = await eventually(() => embedList(editorBody(page)).catch(() => []), (l) => l.length >= 1, 2000);
  assert.equal(shown[0]?.target, 'Tasks/Úkol z dvojníka.md', 'resolved by the app to the new file');
});

test('fr_cnv_03_ac11_the_embed_resolves_to_the_new_file_dvojnik_quick_notes', async ({ page }) => {
  const first = `---\nid: 01JB5A0000000000000000W202\ntype: task\ntitle: Úkol z dvojníka\nstatus: To do\nsource: "[[Dvojník]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`;
  const vault = convertVault((f) => { f['Tasks/Úkol z dvojníka.md'] = first; });
  const core = await openConvert(page, C.dvojnikQ, { vault });
  await convertAt(page, 'Úkol z dvojníka');
  const t = await needFile(core, 'Tasks/Úkol z dvojníka (2).md');
  assert.match(fm(t, 'source') ?? '', /^"\[\[Quick Notes\/Dvojník(\|Dvojník)?\]\]"$/, 'source names the Quick Notes file (AP-455 either form)');
  const h = await saved(page, core, C.dvojnikQ, (x) => x !== original(C.dvojnikQ));
  assert.deepEqual(embedTargets(h), ['Úkol z dvojníka (2)'], 'each embed names its own file');
  const shown = await eventually(() => embedList(editorBody(page)).catch(() => []), (l) => l.length >= 1, 2000);
  assert.equal(shown[0]?.target, 'Tasks/Úkol z dvojníka (2).md', 'resolved to the new file');
  assert.equal(await fileText(core, 'Tasks/Úkol z dvojníka.md'), first, 'the first task is untouched');
});

// ------------------------------------------------------------------------------------------------ FR-CNV-04 AC-2, AC-3

async function scrollTop(sel: Locator): Promise<number> {
  return sel.evaluate((e) => {
    let sc: HTMLElement | null = e.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    return e.getBoundingClientRect().top - (sc ?? document.documentElement).getBoundingClientRect().top;
  });
}
test('fr_cnv_04_ac2_the_source_chip_opens_bloky_at_the_embed', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, ZAVOLAT);
  await saved(page, core, C.bloky, (x) => x !== B0);
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, ZAVOLAT, '⌘↩ on the selected new embed', 5000);
  const props = page.getByRole('region', { name: 'Properties', exact: true });
  await click(props.locator('[data-link-kind]').filter({ hasText: 'Bloky' }), 'the Source chip in the attribute panel');
  await mustBeOn(page, 'Bloky', 'Bloky', 5000);
  const sel = await must(main(page).locator('[data-block-selected]'), 'a selected block');
  assert.ok(flat(await sel.innerText()).includes(ZAVOLAT), 'the embed of the new task is selected');
  const top = await scrollTop(sel);
  assert.ok(Math.abs(top) <= 8, `at the top of the centre pane (± 8 px): ${top}`);
  await runCommand(page, 'Go to Tasks');
  await must(main(page).getByRole('heading', { level: 1, name: 'Tasks' }), 'Tasks page', 5000);
  const card = main(page).getByRole('article', { name: `Task: ${ZAVOLAT}`, exact: true });
  await click(card.locator('[data-link-kind]').filter({ hasText: 'Bloky' }), 'the source chip on its Tasks-page card');
  await mustBeOn(page, 'Bloky', 'Bloky from the Tasks page', 5000);
  assert.ok(flat(await (await must(main(page).locator('[data-block-selected]'), 'selected embed')).innerText()).includes(ZAVOLAT), 'at the embed again');
});

test('fr_cnv_04_ac2_without_the_embed_bloky_opens_at_the_top', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { convert: { lastType: null, skipRemoveConfirm: true } });
  await convertAt(page, ZAVOLAT);
  await saved(page, core, C.bloky, (x) => x !== B0);
  assert.ok((await selectedBlocks(page)).length > 0, 'the new embed is selected');
  await page.keyboard.press('Backspace');
  await saved(page, core, C.bloky, (x) => !!x && !x.includes(EMBED_ZAVOLAT));
  await switchTo(page, ZAVOLAT);
  await mustBeOn(page, ZAVOLAT, 'the task', 5000);
  await click(page.getByRole('region', { name: 'Properties', exact: true }).locator('[data-link-kind]').filter({ hasText: 'Bloky' }), 'Source chip');
  await mustBeOn(page, 'Bloky', 'Bloky', 5000);
  assert.equal(await main(page).locator('[data-block-selected]').count(), 0, 'nothing selected: Bloky opens at the top');
});

test('fr_cnv_04_ac3_backlinks_both_ways', async ({ page }) => {
  const core = await openConvert(page, C.bloky, { panel: true });
  await convertAt(page, ZAVOLAT);
  await saved(page, core, C.bloky, (x) => x !== B0);
  const panel = await must(page.getByRole('tabpanel', { name: 'Backlinks' }), 'Backlinks of Bloky', 5000);
  const names = async () => (await panel.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? (a as HTMLElement).innerText ?? ''))).map(flat);
  assert.ok((await eventually(names, (n) => n.includes(ZAVOLAT), 3000)).includes(ZAVOLAT), 'Bloky\'s backlinks list the task (its source)');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, ZAVOLAT, 'the task', 5000);
  const p2 = await must(page.getByRole('tabpanel', { name: 'Backlinks' }), 'Backlinks of the task', 5000);
  const n2 = await eventually(async () => (await p2.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? (a as HTMLElement).innerText ?? ''))).map(flat), (n) => n.includes('Bloky'), 3000);
  assert.ok(n2.includes('Bloky'), 'the task\'s backlinks list Bloky (the embed, D-368 chip)');
});
