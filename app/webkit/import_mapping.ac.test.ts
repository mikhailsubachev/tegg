// Slice I2, L5 (WebKit + fake core): the mapping steps of docs/acceptance/import-capacities.md: FR-IMP-08 AC-13 (4a,
// the types table), AC-14 (the `becomes` menu), AC-15 (4b, attributes and values), AC-16 (the given mapping kept and
// reset), FR-IMP-10 AC-13 (4c, case-only and ambiguous links), FR-IMP-21 AC-5 (4c, the tag-like row). Interface
// docs/contracts/v1-import-window.md §3.5…§3.8, §7 (plan-board.json, plan-decisions.json, c09's generated plan).
// Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  C09, C12, DECISIONS, attrRow, backBtn, canned, click, cmd, continueBtn, description, dialog, enabledSoon, eventually, flat, footerNamed, goTo, heading,
  importCallsOf, isDisabled, lastMapping, menuEntries, menuNamed, must, mustStep, next, plansAtLeast, pressOn, radioStarting, seen, shownText, startImport,
  startOsobni, statusButton, stepperInfo, targetButton, textOf, typeRow, typeRows, typesTable, writeCalls, type FakeCoreHandle,
} from './import-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const HINT = '2 types still have attributes to map. Click a status, e.g. 3 of 5 mapped ›, to map that type’s attributes and values.';
const emptyMapping = (m: any) => !m || (Object.keys(m.types ?? {}).length === 0 && (m.caseLinks ?? []).length === 0);

/** Osobní with the board's export, `This vault`, on 4a (plan-board.json). */
async function boardTypes(page: Page): Promise<FakeCoreHandle> {
  const core = await startOsobni(page);
  await goTo(page, '3');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault · Osobní`');
  await next(page, '4a', 'step 3 with This vault');
  await must(typesTable(page), 'the types table', 5000);
  return core;
}
/** Waits until the focused element is the status button of the row of `folder`. */
async function focusOnStatus(page: Page, folder: string, ms = 2000): Promise<boolean> {
  return eventually(() => page.evaluate((f) => {
    const a = document.activeElement;
    return !!a && a.getAttribute('data-command') === 'import.mapAttributes' && !!a.closest('[role="row"], tr')?.textContent?.includes(f);
  }, folder), (v) => v, ms);
}
async function summary(page: Page): Promise<string> {
  return flat(await dialog(page).locator('p[aria-live="polite"]').first().innerText({ timeout: 1000 }).catch(() => ''));
}
/** Opens the `<key> becomes` menu by its button and chooses the radio item `name`. */
async function choose(page: Page, button: ReturnType<typeof targetButton>, menuName: string, name: string) {
  await click(button, `the button of \`${menuName}\``);
  const menu = await must(menuNamed(page, menuName), `menu \`${menuName}\``);
  await click(menu.getByRole('menuitemradio', { name, exact: true }), `\`${name}\` in \`${menuName}\``);
  assert.ok(!(await seen(menuNamed(page, menuName), 300)), `\`${menuName}\` closes after a choice`);
}
/** A value's status menu (`import.attrs.valueMenu`, `{value} becomes`; the name for the empty value isn't fixed by the
 *  contract, so the open menu is taken whatever its name): chooses the status `name`. */
async function chooseValue(page: Page, button: ReturnType<typeof targetButton>, name: string) {
  await click(button, 'a value\'s status button');
  const menu = await must(page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name, exact: true }) }), 'the value\'s status menu');
  assert.match((await menu.getAttribute('aria-label')) ?? '', /becomes$/, 'the value menu is named `<value> becomes`');
  await click(menu.getByRole('menuitemradio', { name, exact: true }), `\`${name}\``);
}
const valuesOf = (page: Page, key: string) => dialog(page).locator('section').filter({ has: page.getByRole('heading', { level: 3, name: `Values of ${key}` }) });

// ------------------------------------------------------------------------------------------------ FR-IMP-08 AC-13

test('fr_imp_08_ac13_types_table', async ({ page }) => {
  const core = await boardTypes(page);
  assert.equal(await textOf(heading(page)), 'Import from Capacities', 'the heading on 4a');
  assert.equal((await stepperInfo(page)).name, 'Step 4 of 6', '4a is step 4');
  const headers = await typesTable(page).getByRole('columnheader').allInnerTexts();
  assert.deepEqual(headers.map((h) => h.trim()), ['In Capacities', 'Becomes in Tegg', 'Attributes'], 'the three column headers');
  const rows = await typeRows(page);
  const want: [string, string, string][] = [
    ['Pages 310', 'Page', '1 of 1 mapped'], ['Tasks 142', 'Task', '3 of 5 mapped'], ['DailyNotes 205', 'Daily Note', 'None'], ['Meetings 58', 'Meeting', '1 of 1 mapped'],
    ['People 31', 'Person · New', '0 of 7 mapped'], ['Images · PDFs 101', 'Image · PDF', '6 of 6 mapped'], ['Weblinks 44', 'Page · url', 'None'],
    ['Queries 11', 'Page · stub', 'None'], ['Tag collections 2', 'Not in the export', 'None'],
  ];
  assert.equal(rows.length, want.length, `one row per source type, media and tag collections: ${JSON.stringify(rows)}`);
  for (const [i, [src, target, status]] of want.entries()) {
    const [a, b, c] = rows[i] ?? [];
    const [folder, count] = [src.replace(/ \d+$/, ''), src.replace(/^.* /, '')];
    assert.ok(a?.includes(folder) && a.includes(count), `row ${i + 1}: \`${folder}\` and \`${count}\`: ${a}`);
    assert.equal(b, target, `row ${i + 1} (${folder}): the target`);
    if (status === 'None') assert.equal(c, 'None', `row ${i + 1} (${folder}): \`None\``);
    else assert.ok(c?.includes(status) && c.trim().endsWith('›'), `row ${i + 1} (${folder}): \`${status} ›\`: ${c}`);
  }
  // The status button: name, description, the orange dot only where k < n.
  const tasks = typeRow(page, 'Tasks');
  const st = await must(statusButton(tasks), 'the Tasks status button');
  assert.equal(await tasks.getByRole('button', { name: 'Map attributes, 3 of 5 mapped', exact: true }).count(), 1, 'named `Map attributes, 3 of 5 mapped`');
  assert.ok((await description(st)).includes('needs a look'), 'an open status says `needs a look` in its description');
  assert.ok(!(await description(statusButton(typeRow(page, 'Pages')))).includes('needs a look'), 'a complete status doesn\'t');
  assert.equal(await targetButton(tasks).getAttribute('aria-haspopup'), 'menu', 'the target is a menu button');
  assert.equal(await targetButton(tasks).getAttribute('aria-expanded'), 'false', 'aria-expanded false while closed');
  assert.equal(await typeRow(page, 'Tag collections').locator('button').count(), 0, 'the tag-collections row has no button');
  assert.equal(await typeRow(page, 'Images').locator('button[aria-haspopup="menu"]').count(), 0, 'the media row\'s target is text, not a button');
  // The hint; Continue enabled whatever the statuses are.
  assert.ok(await seen(dialog(page).getByText(HINT, { exact: true })), `the hint: ${HINT}`);
  assert.equal(await isDisabled(continueBtn(page)), false, 'Continue is enabled with open statuses (D-1532)');
  // ⏎ and Space on a status button open 4b for that row.
  await pressOn(statusButton(tasks), 'Space', 'the Tasks status button');
  await mustStep(page, '4b', 'Space on the Tasks status button');
  assert.equal(await textOf(heading(page)), 'Tasks → Task', '4b of Tasks');
  await click(footerNamed(page, 'Back to types'), '`Back to types`');
  await mustStep(page, '4a', 'Back to types');
  await pressOn(statusButton(typeRow(page, 'Meetings')), 'Enter', 'the Meetings status button');
  await mustStep(page, '4b', '⏎ on the Meetings status button');
  assert.equal(await textOf(heading(page)), 'Meetings → Meeting', '4b of Meetings');
  await click(footerNamed(page, 'Done'), '`Done`');
  await mustStep(page, '4a', 'Done');
  // The hint disappears at 0: People not imported, Tasks completed (merge off, the empty status confirmed).
  await choose(page, targetButton(typeRow(page, 'People')), 'People becomes', 'Don’t import');
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status');
  await mustStep(page, '4b', 'Tasks');
  await click(attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }), '`Merge` of priority');
  await click(attrRow(page, 'status').getByRole('button', { name: /^4 values$/ }), '`4 values` of status');
  await chooseValue(page, valuesOf(page, 'status').locator('button[aria-haspopup="menu"]').nth(3), 'To do');
  await eventually(() => summary(page), (s) => s === '5 of 5 mapped', 3000);
  await click(footerNamed(page, 'Done'), '`Done`');
  await mustStep(page, '4a', 'Done');
  assert.equal(await eventually(() => dialog(page).getByText(/still have attributes to map/).count(), (n) => n === 0, 3000), 0, 'the hint is gone at 0');
  assert.equal(await writeCalls(core).then((w) => w.length), 0, 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-08 AC-14

test('fr_imp_08_ac14_becomes_menu', async ({ page }) => {
  const core = await boardTypes(page);
  const people = typeRow(page, 'People');
  const tb = await must(targetButton(people), 'the People target button');
  await tb.click();
  const menu = await must(menuNamed(page, 'People becomes'), 'menu `People becomes`');
  assert.equal(await tb.getAttribute('aria-expanded'), 'true', 'aria-expanded true while open');
  const text = await shownText(menu);
  assert.ok(text.startsWith('No “People” type in this vault'), `the line \`No “People” type in this vault\` comes first: ${text}`);
  assert.equal(await menu.getByRole('menuitem', { name: /No “People”/ }).count() + await menu.getByRole('menuitemradio', { name: /No “People”/ }).count(), 0, 'the line is not an item');
  const items = await menuEntries(menu);
  assert.deepEqual(items.map((i) => [i.role, i.name.replace(/\s*\d+ skipped$/, ''), i.checked, i.group]), [
    ['menuitemradio', 'New type “Person”', 'true', null], ['menuitem', 'rename…', null, null],
    ['menuitemradio', 'Idea', 'false', 'Use a type you have'], ['menuitemradio', 'Meeting', 'false', 'Use a type you have'],
    ['menuitemradio', 'Page', 'false', 'Use a type you have'], ['menuitemradio', 'Project', 'false', 'Use a type you have'],
    ['menuitemradio', 'Don’t import', 'false', null],
  ], 'New type “Person” (checked) with rename…, the vault\'s Page and user types by name, Don’t import');
  assert.equal(items.at(-1)?.description, '31 skipped', '`Don’t import` is described `31 skipped`');
  assert.ok(text.includes('31 skipped'), '`31 skipped` is visible');
  // Esc closes; the focus returns to the target button.
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(menu, 300)), 'Esc closes the menu');
  assert.equal(await eventually(() => page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') ?? ''), (v) => v === 'menu'), 'menu', 'the focus is back on the target button');
  // ↓ and ⏎: choose Meeting.
  await page.keyboard.press('Enter');
  await must(menu, 'the menu again (⏎)');
  for (let i = 0; i < 8; i++) {
    const n = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    if (n === 'Meeting') break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  assert.ok(!(await seen(menu, 300)), '⏎ chooses and closes');
  assert.equal(await eventually(async () => (await typeRows(page))[4]?.[1], (t) => t === 'Meeting', 2000), 'Meeting', 'the row\'s target is `Meeting` at once');
  assert.equal(await eventually(() => page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') ?? ''), (v) => v === 'menu'), 'menu', 'the focus returns to the target button');
  assert.deepEqual((await lastMapping(core))?.types?.Person?.to, { kind: 'existing', key: 'meeting' }, 'the given mapping: Person → existing meeting');
  // rename…: back to a new type with another name; ⏎ commits a valid name, Esc restores, the menu stays open.
  await tb.click();
  await must(menu, 'the menu');
  await click(menu.getByRole('menuitem', { name: 'rename…', exact: true }), '`rename…`');
  const field = await must(menu.getByRole('textbox', { name: 'Name of the new type' }), 'the rename field `Name of the new type`');
  assert.equal(await field.inputValue(), 'Person', 'it holds the name');
  await field.fill('');
  await field.press('Enter');
  assert.equal(await field.getAttribute('aria-invalid'), 'true', 'an empty name is refused (aria-invalid)');
  await field.fill('Meeting');
  await field.press('Enter');
  assert.equal(await eventually(() => field.getAttribute('aria-invalid'), (v) => v === 'true'), 'true', 'a used name (`Meeting`) is refused');
  assert.ok(!(await importCallsOf(core, 'import_plan')).some((a) => a.mapping?.types?.Person?.to?.name === 'Meeting'), 'a refused name is never sent');
  await field.press('Escape');
  assert.ok(await seen(menu, 500), 'Esc in the field leaves the menu open');
  assert.ok((await shownText(menu)).includes('New type “Person”'), 'Esc restores the old name');
  await click(menu.getByRole('menuitem', { name: 'rename…', exact: true }), '`rename…` again');
  await (await must(menu.getByRole('textbox', { name: 'Name of the new type' }), 'the field')).fill('Osoba');
  await menu.getByRole('textbox', { name: 'Name of the new type' }).press('Enter');
  assert.deepEqual(await eventually(async () => (await lastMapping(core))?.types?.Person?.to, (t) => t?.name === 'Osoba'), { kind: 'new', name: 'Osoba' }, 'the given mapping: Person → new `Osoba`');
  assert.ok(await seen(menu, 500), 'the menu stays open after the rename');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(async () => (await typeRows(page))[4]?.[1], (t) => t === 'Osoba · New', 2000), 'Osoba · New', 'the row reads `Osoba · New`');
  // Don’t import: the row reads `Don’t import` and its status `None`.
  await choose(page, targetButton(people), 'People becomes', 'Don’t import');
  const row = await eventually(async () => (await typeRows(page))[4], (r) => r?.[1] === 'Don’t import', 2000);
  assert.deepEqual([row?.[1], row?.[2]], ['Don’t import', 'None'], '`Don’t import` and `None`');
  assert.deepEqual((await lastMapping(core))?.types?.Person?.to, { kind: 'skip' }, 'the given mapping: Person → skip');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-08 AC-15

test('fr_imp_08_ac15_attributes_step', async ({ page }) => {
  const core = await boardTypes(page);
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status button');
  await mustStep(page, '4b', 'Tasks');
  assert.equal(await textOf(heading(page)), 'Tasks → Task', 'the heading `Tasks → Task`');
  assert.equal(await page.getByRole('dialog', { name: 'Tasks → Task', exact: true }).count(), 1, 'the dialog is named `Tasks → Task`');
  assert.equal((await stepperInfo(page)).name, 'Step 4 of 6', '4b is step 4');
  assert.equal(await summary(page), '3 of 5 mapped · status and priority still need a look', 'the summary');
  const keys = await dialog(page).locator('li[data-attr]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-attr')));
  assert.deepEqual(keys, ['status', 'priority', 'dueDate', 'people', 'fileSize'], 'one row per attribute except type and title (D-1573), in source order');
  // Targets: on-purpose keys as text, others as menu buttons.
  for (const k of ['status', 'priority']) {
    assert.equal(await attrRow(page, k).locator('button[aria-haspopup="menu"]').count(), 0, `${k}: an on-purpose key has no menu`);
    assert.ok((await shownText(attrRow(page, k))).startsWith(k), `${k}: its key`);
  }
  for (const [k, t] of [['dueDate', 'Due date'], ['people', 'Assignees'], ['fileSize', 'Don’t import']]) {
    assert.equal(await textOf(targetButton(attrRow(page, k))), t, `${k}: the target button shows \`${t}\``);
  }
  // Chips.
  assert.equal(await attrRow(page, 'status').getByRole('button', { name: '4 values', exact: true }).getAttribute('aria-expanded'), 'false', 'status: `4 values`, collapsed');
  assert.equal(await attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }).getAttribute('aria-pressed'), 'true', 'priority: `Merge`, pressed');
  assert.equal(await attrRow(page, 'people').getByRole('button', { name: 'Split', exact: true }).getAttribute('aria-pressed'), 'true', 'people: `Split`, pressed');
  // The merge note under priority.
  assert.ok((await shownText(attrRow(page, 'priority'))).includes('HIgh and High look like the same value and will be merged into High.'), 'the merge note under priority');
  // Values of status: the four rows and their meanings.
  await click(attrRow(page, 'status').getByRole('button', { name: '4 values', exact: true }), '`4 values`');
  assert.equal(await attrRow(page, 'status').getByRole('button', { name: '4 values', exact: true }).getAttribute('aria-expanded'), 'true', 'expanded');
  const values = await must(valuesOf(page, 'status'), 'section `Values of status`');
  const meanings = (await values.locator('button[aria-haspopup="menu"]').allInnerTexts()).map(flat);
  assert.deepEqual(meanings, ['To do · open', 'In progress · in progress', 'Done · done', 'To do · open'], 'each value\'s meaning: the status and its state word, lower case (D-1583)');
  const text = await shownText(values);
  let at = -1;
  for (const [v, m] of [['Not Started · 61', 'To do · open'], ['In Progress · 40', 'In progress · in progress'], ['Done · 35', 'Done · done'], ['empty · 6', 'To do · open']]) {
    const i = text.indexOf(`${v} ${m}`, at + 1) >= 0 ? text.indexOf(`${v} ${m}`, at + 1) : text.indexOf(v, at + 1);
    assert.ok(i > at, `\`${v}\` → \`${m}\`, in the board's order: ${text}`);
    at = i;
  }
  // Changing a value's status updates the summary.
  await chooseValue(page, values.locator('button[aria-haspopup="menu"]').nth(3), 'To do');
  assert.deepEqual((await lastMapping(core))?.types?.Task?.attributes?.status?.values, { '': 'To do' }, 'the given mapping: values[""] = To do');
  assert.equal(await eventually(() => summary(page), (s) => s.startsWith('4 of 5')), '4 of 5 mapped · priority still need a look', 'a value\'s status updates the summary');
  // A merge.
  await click(attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }), '`Merge`');
  assert.equal(await eventually(() => attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }).getAttribute('aria-pressed'), (v) => v === 'false'), 'false', '`Merge` unpressed');
  assert.deepEqual((await lastMapping(core))?.types?.Task?.attributes?.priority?.merge, { kind: 'off' }, 'the given mapping: merge off');
  assert.equal(await eventually(() => summary(page), (s) => s === '5 of 5 mapped'), '5 of 5 mapped', 'a merge updates the summary');
  // A target.
  await choose(page, targetButton(attrRow(page, 'dueDate')), 'dueDate becomes', 'Don’t import');
  assert.deepEqual((await lastMapping(core))?.types?.Task?.attributes?.dueDate?.to, { kind: 'drop' }, 'the given mapping: dueDate dropped');
  assert.equal(await eventually(() => textOf(targetButton(attrRow(page, 'dueDate'))), (t) => t === 'Don’t import'), 'Don’t import', 'the row shows `Don’t import`');
  // Done and Back to types: 4a with the focus on the Tasks status button, which shows the new numbers.
  await click(footerNamed(page, 'Done'), '`Done`');
  await mustStep(page, '4a', 'Done');
  assert.ok(await focusOnStatus(page, 'Tasks'), 'Done: the focus is on the Tasks status button');
  assert.equal(await typeRow(page, 'Tasks').getByRole('button', { name: 'Map attributes, 5 of 5 mapped', exact: true }).count(), 1, 'the row\'s status shows 5 of 5');
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status');
  await mustStep(page, '4b', 'Tasks again');
  assert.equal(await summary(page), '5 of 5 mapped', 'the choices are kept');
  await click(footerNamed(page, 'Back to types'), '`Back to types`');
  await mustStep(page, '4a', 'Back to types');
  assert.ok(await focusOnStatus(page, 'Tasks'), 'Back to types: the focus is on the Tasks status button');
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status');
  await mustStep(page, '4b', 'Tasks again');
  await page.keyboard.press('Escape');
  await mustStep(page, '4a', 'Esc on 4b is `Back to types`');
  assert.ok(await focusOnStatus(page, 'Tasks'), 'Esc: the focus is on the Tasks status button');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-08 AC-16

test('fr_imp_08_ac16_mapping_kept_between_steps', async ({ page }) => {
  const core = await boardTypes(page);
  await choose(page, targetButton(typeRow(page, 'People')), 'People becomes', 'Don’t import');
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status');
  await mustStep(page, '4b', 'Tasks');
  await click(attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }), '`Merge`');
  await eventually(() => summary(page), (s) => s.startsWith('4 of 5'), 3000);
  await click(footerNamed(page, 'Done'), '`Done`');
  await mustStep(page, '4a', 'Done');
  const given = await lastMapping(core);
  assert.deepEqual([given?.types?.Person?.to, given?.types?.Task?.attributes?.priority?.merge], [{ kind: 'skip' }, { kind: 'off' }], 'setup: the two choices are in the given mapping');
  const kept = async (what: string) => {
    assert.equal(await eventually(async () => (await typeRows(page))[4]?.[1], (t) => t === 'Don’t import', 3000), 'Don’t import', `${what}: People is still \`Don’t import\``);
    assert.equal(await typeRow(page, 'Tasks').getByRole('button', { name: 'Map attributes, 4 of 5 mapped', exact: true }).count(), 1, `${what}: Tasks still 4 of 5`);
    const m = await lastMapping(core);
    assert.deepEqual([m?.types?.Person?.to, m?.types?.Task?.attributes?.priority?.merge], [{ kind: 'skip' }, { kind: 'off' }], `${what}: the plan is asked with the choices`);
  };
  // Back to step 3 and forward.
  await click(backBtn(page), 'Back');
  await mustStep(page, '3', 'Back to step 3');
  await next(page, '4a', 'forward again');
  await kept('after Back to step 3 and forward');
  // On to step 5 and back.
  await next(page, '5', 'on to the preview');
  await click(backBtn(page), 'Back');
  await mustStep(page, '4a', 'back from the preview');
  await kept('after step 5 and back');
  // Another destination resets it.
  await click(backBtn(page), 'Back');
  await mustStep(page, '3', 'step 3');
  await click(radioStarting(page, 'Destination', 'A new vault'), '`A new vault`');
  const n = (await importCallsOf(core, 'import_plan')).length;
  await plansAtLeast(core, n, 3000);
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault` again');
  await next(page, '4a', 'step 3');
  assert.ok(emptyMapping(await lastMapping(core)), 'another destination: the plan is asked with the defaults');
  assert.equal(await eventually(async () => (await typeRows(page))[4]?.[1], (t) => t === 'Person · New', 3000), 'Person · New', 'People is back to its default');
  // Another source resets it.
  await choose(page, targetButton(typeRow(page, 'People')), 'People becomes', 'Don’t import');
  await click(backBtn(page), 'Back');
  await mustStep(page, '3', 'step 3');
  await click(backBtn(page), 'Back');
  await mustStep(page, '1', 'step 1 (one space)');
  await click(cmd(page, 'import.chooseZip'), 'Choose zip… (a new choice of source)');
  await next(page, '3', 'step 1');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  assert.ok(emptyMapping(await lastMapping(core)), 'another source: the plan is asked with the defaults');
  // Cancel discards; nothing is written anywhere.
  await click(cmd(page, 'import.cancel'), 'Cancel');
  assert.ok(!(await seen(dialog(page), 500)), 'the window closes');
  assert.ok((await importCallsOf(core, 'import_discard')).length >= 1, 'Cancel calls import_discard');
  assert.deepEqual(await writeCalls(core), [], 'no write call (nothing in the vault, nothing in Application Support)');
  assert.equal(await core.writes(), 0, 'the fake counted no write');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-10 AC-13

test('fr_imp_10_ac13_things_to_decide', async ({ page }) => {
  const core = await startImport(page, { imports: DECISIONS() });
  await goTo(page, '4c', { how: 'folder' });
  const body = await shownText(dialog(page).locator('ul').first());
  for (const t of ['3 links differ only in case', '[[eva]] may mean Eva.', '2 links match several objects', 'They will point at the first match and be marked as ambiguous in the report.']) {
    assert.ok(body.includes(t), `4c shows \`${t}\`: ${body}`);
  }
  assert.ok(body.indexOf('3 links differ only in case') < body.indexOf('2 links match several objects'), 'case links first, then ambiguous');
  assert.equal(await dialog(page).getByText(/attribute links? to tag-like objects/).count(), 0, 'no tag-like row (none in the plan)');
  // Review…: the case list.
  await click(dialog(page).getByRole('button', { name: 'Review…', exact: true }), '`Review…`');
  const list = await must(dialog(page).getByRole('list').filter({ has: page.getByRole('checkbox') }), 'the case list');
  const items = list.getByRole('listitem');
  assert.equal(await items.count(), 3, 'one item per case-only link');
  const texts = (await items.allInnerTexts()).map(flat);
  for (const [i, [note, ex]] of [['Deník', '[[eva]] may mean Eva.'], ['Odkazy', '[[tomáš]] may mean Tomáš.'], ['Odkazy', '[[jana]] may mean Jana.']].entries()) {
    assert.ok(texts[i]?.includes(note) && texts[i].includes(ex), `item ${i + 1}: the note \`${note}\` and \`${ex}\`: ${texts[i]}`);
  }
  const boxes = list.getByRole('checkbox', { name: 'Use this object' });
  assert.deepEqual(await boxes.evaluateAll((bs) => bs.map((b) => (b as HTMLInputElement).checked ?? b.getAttribute('aria-checked') === 'true')), [false, false, false], 'every `Use this object` unchecked (D-81)');
  await boxes.nth(1).check();
  const m = await eventually(() => lastMapping(core), (x) => (x?.caseLinks ?? []).length > 0, 3000);
  assert.deepEqual(m?.caseLinks, [{ note: 'Pages/Odkazy.md', target: 'tomáš', use: true }], 'the choice reaches the mapping');
  assert.equal(await eventually(() => boxes.nth(1).isChecked(), (v) => v), true, 'the box stays checked with the new plan');
  await click(footerNamed(page, 'Done'), '`Done` of the case list');
  assert.ok(await seen(dialog(page).getByRole('button', { name: 'Info', exact: true })), 'back on 4c');
  // Info: the ambiguous list, read-only.
  const plans = (await importCallsOf(core, 'import_plan')).length;
  await click(dialog(page).getByRole('button', { name: 'Info', exact: true }), '`Info`');
  const amb = (await dialog(page).getByRole('listitem').allInnerTexts()).map(flat);
  assert.equal(amb.length, 2, `two ambiguous links: ${JSON.stringify(amb)}`);
  assert.ok(amb[0].includes('Deník') && amb[0].includes('[[Porada]] points to Porada'), `Deník: [[Porada]] points to Porada: ${amb[0]}`);
  assert.ok(amb[1].includes('Odkazy') && amb[1].includes('[[Plán]] points to Plán'), `Odkazy: [[Plán]] points to Plán: ${amb[1]}`);
  assert.equal(await dialog(page).getByRole('checkbox').count(), 0, 'Info changes nothing: no control');
  await click(footerNamed(page, 'Done'), '`Done` of the ambiguous list');
  assert.equal((await importCallsOf(core, 'import_plan')).length, plans, 'Info made no plan');
  // 4c ↔ 5 and 4a.
  await next(page, '5', '4c');
  await click(backBtn(page), 'Back');
  await mustStep(page, '4c', 'Back from 5 goes to 4c');
  await click(backBtn(page), 'Back');
  await mustStep(page, '4a', 'Back from 4c goes to 4a');
});

test('fr_imp_10_ac13_things_to_decide: with no row, 4c is skipped both ways', async ({ page }) => {
  const plan = canned('plan-c12-task-dates-PKM-new.json');
  assert.deepEqual([plan.decisions.caseLinks.length, plan.decisions.ambiguous.length, plan.decisions.tagLike.length], [0, 0, 0], 'setup: c12 has no decision');
  await startImport(page, { imports: C12() });
  await goTo(page, '4a', { how: 'folder' });
  await next(page, '5', 'Continue on 4a skips 4c');
  await click(backBtn(page), 'Back');
  await mustStep(page, '4a', 'Back on 5 skips 4c');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-21 AC-5

test('fr_imp_21_ac5_tag_like_row', async ({ page }) => {
  const core = await startImport(page, { imports: C09() });
  await goTo(page, '4c', { how: 'folder' });
  await must(dialog(page).getByText('1 attribute links to tag-like objects', { exact: true }), '`1 attribute links to tag-like objects`');
  await must(dialog(page).getByText('status: [[in progress]] can become a select value, not a link.', { exact: true }), 'the example');
  const select = await must(dialog(page).getByRole('button', { name: 'Select', exact: true }), '`Select`');
  assert.equal(await select.getAttribute('aria-pressed'), 'false', 'not pressed');
  await select.click();
  assert.equal(await eventually(() => select.getAttribute('aria-pressed'), (v) => v === 'true'), 'true', 'pressed (aria-pressed="true")');
  assert.deepEqual((await lastMapping(core))?.types?.Trip?.attributes?.status?.to, { kind: 'new', name: 'status', type: 'select' }, 'the mapping: Trip.status a new select');
  // 4b shows it as `status · select`.
  await click(backBtn(page), 'Back');
  await mustStep(page, '4a', '4a');
  await click(statusButton(typeRow(page, 'Trips')), 'the Trips status');
  await mustStep(page, '4b', 'Trips');
  assert.equal(await textOf(targetButton(attrRow(page, 'status'))), 'status · select', '4b: `status · select` (D-1582)');
  await click(footerNamed(page, 'Back to types'), 'Back to types');
  await next(page, '4c', '4a');
  // Pressing again undoes it.
  await click(dialog(page).getByRole('button', { name: 'Select', exact: true }), '`Select` again');
  assert.equal(await eventually(() => dialog(page).getByRole('button', { name: 'Select', exact: true }).getAttribute('aria-pressed'), (v) => v === 'false'), 'false', 'unpressed');
  assert.equal((await lastMapping(core))?.types?.Trip?.attributes?.status?.to, undefined, 'the entry is removed from the mapping');
  await enabledSoon(continueBtn(page), 'Continue');
});
