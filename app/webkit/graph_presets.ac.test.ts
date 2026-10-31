// Slice G3, L5 (WebKit + fake core): filter presets in the full view `graph/<path>` (docs/acceptance/graph.md part
// two, R118, R119, R123, R124): FR-GRP-02 AC-11…AC-24 (the control and the menu, applying, `· modified`, Update,
// Revert, Save as, rename, delete, Default, unknown keys, unreadable and newer files, skipped entries, the stored preset
// per view and vault, outside changes, the narrow window), FR-SYN-03 AC-22 and AC-24 (a stale base and a file that
// appears are refused with the alert, never applied), FR-SYN-06 AC-40 (the L5 count of `graph_presets_apply` calls and
// fake vault writes), FR-FMT-12 AC-7 (NFC names in `cs` and `en-US`), FR-UX-03 AC-28 (R123 in the palette) and AC-29
// (presets without the pointer). Interface docs/contracts/v1-graph.md §16.2…§16.4, §16.6 (fake core
// `graph_presets_get` / `graph_presets_apply`, `presetCalls`, `presetsFail`, `setFile(…, { silent })`). Fixtures
// tests/fixtures/graph-presets/ and tests/fixtures/vaults/graph. Written from the ACs and the contracts only (D-61);
// every lookup goes through `must`/`seen` and node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  GRAPH_YML, NFD, P, VAULT_PATH, callsOf, cancelBtn, checked, choosePreset, click, deleteConfirm, depthBtn, drawnEdges, drawnKeys, eventually,
  expectedText, filtersBtn, flat, focused, fullState, graphYml, hiddenStatus, isDisabled, kindBox, listTree, menuItem, menuItems, menuRadio, must, nameField,
  nfc, openGraph, openPresetMenu, paletteEntry, panelState, presetAlert, presetBtn, presetIs, presetLabel, presetMenu, presetState, presetsText,
  presetsVault, presetWrites, pressed, renameField, revertBtn, runCommand, saveAs, saveBtn, saveDialog, seen, sizeBox, sleep, textOf, typeBox,
  uiG3, uiWrites, updateBtn, viewBtn, waitDrawn,
} from './graph-helpers';
import { description } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const VALID = () => presetsVault(presetsText('valid'));
const BEZ: { hiddenTypes: string[]; hiddenKinds: string[]; preset: string } = { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [], preset: 'Bez štítků' };
const JEN = { hiddenTypes: [] as string[], hiddenKinds: ['link', 'embed', 'tag'], preset: 'Jen vztahy' };
const lines = (s: string) => s.split('\n');
const setLine = (s: string, n: number, v: string) => { const l = lines(s); l[n - 1] = v; return l.join('\n'); };
const cut = (s: string, from: number, to: number) => { const l = lines(s); l.splice(from - 1, to - from + 1); return l.join('\n'); };
const applyCalls = async (core: Awaited<ReturnType<typeof openGraph>>) => (await core.presetCalls()).length;
async function needDrawn(page: Page, n: number, what: string) {
  const k = await waitDrawn(page, n, 4000);
  assert.equal(k.length, n, `${what}: ${n} nodes drawn (got ${k.length})`);
}
async function hidden(page: Page): Promise<string> {
  return flat(await textOf(hiddenStatus(page), 1500));
}
const notModified = async (page: Page) => !(await presetState(page)).text.includes('· modified');
const isModified = async (page: Page) => (await eventually(() => presetState(page), (s) => s.text.includes('· modified'), 2000)).text.includes('· modified');

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-11

test('fr_grp_02_ac11_preset_control_and_menu', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await must(presetLabel(page), 'the label `Preset` (R119)');
  const btn = await must(presetBtn(page), 'the button `Preset: Default`');
  assert.equal((await presetState(page)).name, 'Preset: Default', 'named `Preset: Default` with no graph.yml');
  assert.deepEqual([await btn.getAttribute('aria-haspopup'), await btn.getAttribute('aria-expanded')], ['menu', 'false'], 'a menu button');
  const above = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => /^⟦?Preset: /.test(e.getAttribute('aria-label') ?? e.textContent ?? ''));
    const t = [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === 'Types' || document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent === 'Types');
    return !!b && !!t && !!(b.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(above, 'the control sits above `Types` in `Graph filters`');
  const gets = (await callsOf(core, 'graph_presets_get')).length;
  await openPresetMenu(page);
  assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded while open');
  const items = await menuItems(page);
  assert.deepEqual(items.map((i) => [i.role, i.role === 'separator' ? '' : i.name.replace(/\s*built-in$/, ''), i.checked]),
    [['menuitemradio', 'Default', 'true'], ['separator', '', null], ['menuitem', 'Save as new preset…', null]], 'Default (checked), a separator and `Save as new preset…` only');
  assert.ok(flat(await textOf(menuRadio(page, 'Default'))).includes('built-in'), 'Default shows the muted `built-in`');
  assert.equal((await callsOf(core, 'graph_presets_get')).length, gets, 'opening the menu reads nothing new');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(presetMenu(page), 500)), 'Esc closes the menu');
  assert.equal((await focused(page)).name.startsWith('Preset: '), true, 'and returns the focus to the button');
  assert.equal(await core.writes(), 0, 'nothing written');
});

test('fr_grp_02_ac11_preset_control_and_menu_with_valid', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: BEZ }) });
  await openPresetMenu(page);
  const items = await menuItems(page);
  assert.deepEqual(items.map((i) => [i.role, i.role === 'separator' ? '' : i.name.replace(/\s*built-in$/, ''), i.checked]), [
    ['menuitemradio', 'Default', 'false'], ['menuitemradio', 'Bez štítků', 'true'], ['menuitemradio', 'Jen vztahy', 'false'], ['menuitemradio', 'Lidé a schůzky', 'false'],
    ['separator', '', null], ['menuitem', 'Save as new preset…', null], ['menuitem', 'Update “Bez štítků”', null], ['menuitem', 'Rename “Bez štítků”…', null],
    ['menuitem', 'Delete “Bez štítků”…', null],
  ], 'R119\'s items in file order (AP-945), the stored preset checked');
  const upd = items.find((i) => i.name === 'Update “Bez štítků”')!;
  assert.deepEqual([upd.disabled, upd.desc], [true, 'The filters match the preset.'], '`Update` is aria-disabled while not modified');
  const focusName = async () => (await focused(page)).name.replace(/\s*built-in$/, '');
  await eventually(focusName, (n) => n === 'Bez štítků', 1000);
  assert.equal(await focusName(), 'Bez štítků', 'the menu opens with the focus on the checked item');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusName(), 'Jen vztahy', '↓ moves');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusName(), 'Default', '↑ moves');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.ok(await presetIs(page, 'Jen vztahy'), '⏎ chooses');
  await openPresetMenu(page);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(' ');
  assert.ok(await presetIs(page, 'Bez štítků'), 'Space chooses');
  assert.deepEqual(await presetWrites(core), [], 'the menu writes nothing to the vault');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-12

test('fr_grp_02_ac12_applying_a_preset_sets_this_views_filters', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  const yml0 = await graphYml(core);
  const ver0 = await core.version(GRAPH_YML);
  const size0 = await checked(sizeBox(page));
  const w0 = (await uiWrites(core)).length;
  await choosePreset(page, 'Bez štítků');
  await needDrawn(page, 8, 'Bez štítků');
  assert.equal((await drawnEdges(page)).length, 8, '8 edges');
  assert.equal(await hidden(page), '2 hidden', '`2 hidden`');
  assert.equal(await checked(typeBox(page, 'Tags')), false, 'the Tags checkbox is unticked');
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), '`Preset: Bez štítků` without `· modified`');
  assert.equal(await pressed(depthBtn(page, 1)), 'true', 'depth 1 stays');
  assert.equal(await checked(sizeBox(page)), size0, '`Size nodes by links` stays');
  const writes = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(writes.length, 1, 'exactly one ui_state_set');
  const st = writes[0]?.vaults?.[nfc(VAULT_PATH)]?.graph;
  assert.deepEqual([st?.full?.hiddenTypes, st?.full?.hiddenKinds, st?.full?.preset], [['tag', 'kniha'], [], 'Bez štítků'], 'graph.full holds the preset\'s filters and its name');
  assert.equal(st?.panel, undefined, 'graph.panel is not written (AP-931)');
  await choosePreset(page, 'Jen vztahy');
  await needDrawn(page, 3, 'Jen vztahy');
  const e = await drawnEdges(page);
  assert.deepEqual([e.length, e.map((x) => x.style)], [2, ['relation', 'relation']], 'Jen vztahy: 2 edges, both `relation`');
  assert.equal(await hidden(page), '7 hidden', '`7 hidden`');
  await choosePreset(page, 'Lidé a schůzky');
  await needDrawn(page, 2, 'Lidé a schůzky');
  assert.deepEqual([(await drawnEdges(page)).length, await hidden(page)], [1, '8 hidden'], 'Lidé a schůzky: 1 edge, `8 hidden`');
  await click(depthBtn(page, 2), 'depth 2');
  await needDrawn(page, 4, 'Lidé a schůzky at depth 2');
  assert.deepEqual([(await drawnEdges(page)).length, await hidden(page)], [3, '15 hidden'], 'at depth 2: 3 edges, `15 hidden`');
  await click(depthBtn(page, 1), 'depth 1');
  await choosePreset(page, 'Default');
  await needDrawn(page, 10, 'Default');
  assert.deepEqual([await graphYml(core), await core.version(GRAPH_YML)], [yml0, ver0], '.tegg/graph.yml keeps its bytes and version throughout');
  assert.equal(await applyCalls(core), 0, 'no graph_presets_apply');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-13

test('fr_grp_02_ac13_modified_update_and_revert', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  await choosePreset(page, 'Bez štítků');
  await needDrawn(page, 8, 'Bez štítků');
  await click(typeBox(page, 'Tags'), 'tick Tags');
  assert.ok(await isModified(page), '` · modified` after ticking Tags');
  assert.equal((await presetState(page)).desc, 'Modified', 'description `Modified`');
  await must(updateBtn(page), '`Update`');
  await must(revertBtn(page), '`Revert`');
  await openPresetMenu(page);
  assert.equal((await menuItems(page)).find((i) => i.name === 'Update “Bez štítků”')?.disabled, false, 'the menu\'s `Update “Bez štítků”` is enabled');
  await page.keyboard.press('Escape');
  await click(typeBox(page, 'Tags'), 'untick Tags');
  assert.ok(await eventually(() => notModified(page), (x) => x, 2000), 'back to the preset\'s set: not modified');
  await click(depthBtn(page, 2), 'depth 2');
  await waitDrawn(page, 14);
  await click(sizeBox(page), 'Size nodes by links');
  await click(viewBtn(page, 'List'), 'List');
  await must(listTree(page), 'the List');
  await click(viewBtn(page, 'Graph'), 'Graph');
  await click(depthBtn(page, 1), 'depth 1');
  assert.equal(await notModified(page), true, 'depth, size and the view never make it modified');
  await click(typeBox(page, 'Tags'), 'tick Tags');
  await needDrawn(page, 10, 'Tags visible');
  const w0 = (await uiWrites(core)).length;
  await click(revertBtn(page), 'Revert');
  await needDrawn(page, 8, 'Revert');
  assert.deepEqual((await fullState(core))?.hiddenTypes, ['tag', 'kniha'], 'Revert restores the preset\'s hidden types');
  assert.equal((await uiWrites(core)).length - w0, 1, 'with one ui_state_set');
  assert.equal(await applyCalls(core), 0, 'and no vault write');
  await click(typeBox(page, 'Tags'), 'tick Tags');
  await click(updateBtn(page), 'Update');
  assert.equal(await eventually(() => graphYml(core), (t) => t === expectedText('valid-after-update'), 3000), expectedText('valid-after-update'), 'Update writes expected/valid-after-update.yml');
  assert.equal(await applyCalls(core), 1, 'once');
  assert.ok(await eventually(() => notModified(page), (x) => x, 2000), '`· modified` disappears');
  await choosePreset(page, 'Default');
  await click(typeBox(page, 'Tags'), 'hide Tags under Default');
  assert.ok(await isModified(page), '`Default · modified`');
  assert.equal((await presetState(page)).text, 'Default · modified', 'the button reads `Default · modified`');
  await must(revertBtn(page), '`Revert` for Default');
  assert.ok(!(await seen(updateBtn(page), 300)), 'no `Update` for Default (AP-929)');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-14

test('fr_grp_02_ac14_save_as_new_creates_the_file_once', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const noFile = async (what: string) => assert.equal(await graphYml(core), undefined, `${what}: no .tegg/graph.yml`);
  await choosePreset(page, 'Default');
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await click(typeBox(page, 'Tags'), 'show Tags');
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await click(revertBtn(page), 'Revert');
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await noFile('after toggling and Revert');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await must(saveDialog(page), 'the dialog `Save preset`');
  assert.ok(flat(await textOf(saveDialog(page))).includes('Saves the types and connection kinds. Depth is not part of a preset.'), 'the note');
  assert.equal((await focused(page)).name, 'Name', 'the `Name` field is focused');
  assert.equal(await isDisabled(saveBtn(page)), true, '`Save` is aria-disabled while empty');
  await click(cancelBtn(page), 'Cancel');
  await noFile('after cancelling the dialog');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await (await must(nameField(page), 'Name')).fill('   ');
  assert.equal(await isDisabled(saveBtn(page)), true, '`Save` stays disabled for a blank name');
  await page.keyboard.press('Enter');
  assert.equal(await description(nameField(page)), 'Enter a name.', '`Enter a name.` after an attempt');
  await (await must(nameField(page), 'Name')).fill('Bez štítků');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== undefined, 3000), expectedText('created'), 'the first save creates expected/created.yml');
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), '`Preset: Bez štítků` without `· modified`');
  assert.equal((await fullState(core))?.preset, 'Bez štítků', 'stores `preset: "Bez štítků"`');
  assert.equal(await applyCalls(core), 1, 'one graph_presets_apply');
  assert.equal((await core.presetCalls())[0]?.base, null, 'with no base (the file didn\'t exist)');
});

test('fr_grp_02_ac14_save_as_new_creates_the_file_once_name_messages', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  const cases: [string, string][] = [
    ['bez ŠTÍTKŮ', 'A preset named “Bez štítků” already exists.'], [' Bez štítků ', 'A preset named “Bez štítků” already exists.'],
    ['Default', 'A preset named “Default” already exists.'], ['default', 'A preset named “Default” already exists.'],
    ['ř'.repeat(101), 'Use at most 100 characters.'], ['Lidé\tporady', 'Names can\'t contain control characters.'],
  ];
  for (const [name, msg] of cases) {
    await (await must(nameField(page), 'Name')).fill(name);
    assert.equal(await eventually(() => description(nameField(page)), (d) => d === msg, 1500), msg, `${JSON.stringify(name)}: ${msg}`);
    assert.equal(await isDisabled(saveBtn(page)), true, `${JSON.stringify(name)}: Save disabled`);
    await page.keyboard.press('Enter');
  }
  assert.equal(await applyCalls(core), 0, 'nothing is sent for any of them');
  assert.equal(await graphYml(core), presetsText('valid'), 'nothing written');
  await (await must(nameField(page), 'Name')).fill('Lidé: #1');
  await page.keyboard.press('Enter');
  assert.ok((await eventually(() => graphYml(core), (t) => !!t?.includes('"Lidé: #1"'), 3000))?.includes('\n  - name: "Lidé: #1"\n'), 'saved quoted');
  await openPresetMenu(page);
  await must(menuRadio(page, 'Lidé: #1'), 'listed as `Lidé: #1`');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-15

test('fr_grp_02_ac15_rename_in_place', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: JEN, panel: { ...JEN } }) });
  const valid = presetsText('valid');
  assert.ok(await presetIs(page, 'Jen vztahy'), 'Jen vztahy is current');
  const startRename = async () => {
    await openPresetMenu(page);
    await click(menuItem(page, 'Rename “Jen vztahy”…'), 'Rename “Jen vztahy”…');
    return must(renameField(page), 'the button turns into the textbox `Preset name`');
  };
  let f = await startRename();
  const sel = await f.evaluate((e) => { const i = e as HTMLInputElement; return [i.value, i.selectionStart, i.selectionEnd]; });
  assert.deepEqual(sel, ['Jen vztahy', 0, 'Jen vztahy'.length], 'the current name, selected');
  assert.ok(flat(await page.locator('body').innerText()).includes('↩ save'), 'the hint `↩ save`');
  await f.fill('Zrušeno');
  await page.keyboard.press('Escape');
  assert.ok(await presetIs(page, 'Jen vztahy'), 'Esc shows the old name');
  f = await startRename();
  await f.fill('Rozmazané');
  await page.keyboard.press('Tab');
  assert.ok(await presetIs(page, 'Jen vztahy'), 'moving the focus away cancels');
  f = await startRename();
  await f.fill('Bez štítků');
  await page.keyboard.press('Enter');
  assert.ok(flat(await page.locator('body').innerText()).includes('A preset named “Bez štítků” already exists.'), 'a taken name shows the message');
  await page.keyboard.press('Escape');
  f = await startRename();
  await f.fill('Jen vztahy');
  await page.keyboard.press('Enter');
  assert.deepEqual([await graphYml(core), await presetWrites(core)], [valid, []], 'Esc, blur, a taken name and the same name write nothing');
  f = await startRename();
  await f.fill('jen VZTAHY');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== valid, 3000), setLine(valid, 7, '  - name: jen VZTAHY'), 'a case-only rename is written');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “jen VZTAHY”…'), 'Rename “jen VZTAHY”…');
  const w0 = (await uiWrites(core)).length;
  await (await must(renameField(page), 'Preset name')).fill('Vztahy');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => !!t?.includes('- name: Vztahy\n'), 3000), setLine(valid, 7, '  - name: Vztahy'), 'only line 7 changes');
  assert.ok(await presetIs(page, 'Vztahy'), '`Preset: Vztahy`');
  await eventually(async () => (await uiWrites(core)).length, (n) => n > w0, 2000);
  assert.equal((await uiWrites(core)).length - w0, 1, 'one ui_state_set');
  assert.deepEqual([(await fullState(core))?.preset, (await panelState(core))?.preset], ['Vztahy', 'Vztahy'], '`preset` updated in graph.full and graph.panel');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-16

test('fr_grp_02_ac16_delete_keeps_the_file_and_the_filters', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: JEN, panel: { ...JEN } }) });
  const valid = presetsText('valid');
  await needDrawn(page, 3, 'Jen vztahy');
  const openDelete = async (name: string) => {
    await openPresetMenu(page);
    await click(menuItem(page, `Delete “${name}”…`), `Delete “${name}”…`);
    return must(deleteConfirm(page, name), `the alertdialog \`Delete “${name}”?\``);
  };
  let dlg = await openDelete('Jen vztahy');
  assert.ok(flat(await dlg.innerText()).includes('The graph keeps its current filters. Other graphs using it fall back to Default.'), 'R119\'s text');
  assert.equal((await focused(page)).name, 'Cancel', '`Cancel` is focused');
  await click(dlg.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  dlg = await openDelete('Jen vztahy');
  await page.keyboard.press('Escape');
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [valid, 0], 'Cancel and Esc write nothing');
  dlg = await openDelete('Jen vztahy');
  const w0 = (await uiWrites(core)).length;
  await click(dlg.getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== valid, 3000), cut(valid, 7, 9), 'exactly lines 7–9 removed');
  await needDrawn(page, 3, 'the view keeps its filters');
  assert.equal((await eventually(() => presetState(page), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', '`Default · modified`');
  await eventually(async () => (await uiWrites(core)).length, (n) => n > w0, 2000);
  assert.equal((await uiWrites(core)).length - w0, 1, 'one ui_state_set');
  assert.deepEqual([(await fullState(core))?.preset, (await panelState(core))?.preset], [undefined, undefined], '`preset` removed from every view that named it');
  for (const name of ['Bez štítků', 'Lidé a schůzky']) {
    await choosePreset(page, name);
    await (await openDelete(name)).getByRole('button', { name: 'Delete', exact: true }).click();
    await eventually(() => graphYml(core), (t) => !t?.includes(`- name: ${name}`), 3000);
  }
  assert.equal(await graphYml(core), expectedText('valid-after-deleting-all'), 'expected/valid-after-deleting-all.yml; the file is never deleted');
  await openPresetMenu(page);
  assert.deepEqual((await menuItems(page)).map((i) => i.role === 'separator' ? '—' : i.name.replace(/\s*built-in$/, '')), ['Default', '—', 'Save as new preset…'], 'Default and `Save as new preset…`');
});

test('fr_grp_02_ac16_delete_keeps_the_file_and_the_filters_unknown_keys', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: presetsVault(presetsText('unknown-keys')) });
  await choosePreset(page, 'Lidé: schůzky');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Lidé: schůzky”…'), 'Delete “Lidé: schůzky”…');
  await click((await must(deleteConfirm(page, 'Lidé: schůzky'), 'the confirm')).getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  assert.equal(await eventually(() => graphYml(core), (t) => t === expectedText('unknown-keys-after-delete'), 3000), expectedText('unknown-keys-after-delete'), 'expected/unknown-keys-after-delete.yml');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-17

test('fr_grp_02_ac17_default_is_never_stored', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  await openPresetMenu(page);
  const names = (await menuItems(page)).map((i) => i.name);
  for (const n of ['Update “Default”', 'Rename “Default”…', 'Delete “Default”…']) assert.ok(!names.includes(n), `no ${n}`);
  assert.ok(!names.some((n) => /^(Update|Rename|Delete) /.test(n)), 'Default has no Update, Rename or Delete item');
  await page.keyboard.press('Escape');
  for (const t of ['Graph: Update preset', 'Graph: Rename preset…', 'Graph: Delete preset…']) {
    const e = await paletteEntry(page, t);
    assert.deepEqual([e.listed, e.disabled], [true, true], `${t} is listed aria-disabled while Default is current`);
    assert.ok(e.text.includes('Default can\'t be changed.'), `${t}: the reason \`Default can't be changed.\` (${e.text})`);
  }
  await choosePreset(page, 'Bez štítků');
  await needDrawn(page, 8, 'Bez štítků');
  await choosePreset(page, 'Default');
  await needDrawn(page, 10, 'Default');
  const full = (await fullState(core)) as any;
  assert.deepEqual([full?.hiddenTypes, full?.hiddenKinds, 'preset' in (full ?? {})], [[], [], false], 'Default: hiddenTypes [], hiddenKinds [], no `preset`');
  assert.ok(!(await graphYml(core))?.match(/name: ["']?default/i), 'no Default entry in the file');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-18

const KNIHA = '# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.\nversion: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: red\nreview: false\npreview: []\nattributes: []\n';
const CESTA2 = KNIHA.replace(/Kniha/g, 'Cesta 2').replace('Knihy', 'Cesty 2').replace('folder: Knihy', 'folder: Cesty 2').replace('icon: book', 'icon: plane');

test('fr_grp_02_ac18_presets_store_hidden_keys_and_keep_unknown_ones', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  assert.ok(!(await seen(typeBox(page, 'Knihy'), 500)), 'without kniha.yml, `kniha` has no checkbox');
  await choosePreset(page, 'Bez štítků');
  await needDrawn(page, 8, 'Bez štítků (kniha changes nothing drawn)');
  await core.setFile('.tegg/types/kniha.yml', KNIHA);
  await must(typeBox(page, 'Knihy'), 'the new type `Knihy` in the filter', 3000);
  await choosePreset(page, 'Default');
  await choosePreset(page, 'Bez štítků');
  assert.deepEqual([await checked(typeBox(page, 'Knihy')), await checked(typeBox(page, 'Tags'))], [false, false], 'applying Bez štítků hides Knihy too (it is in the preset)');
  await core.setFile('.tegg/types/cesta2.yml', CESTA2);
  await must(typeBox(page, 'Cesty 2'), 'a type created later', 3000);
  for (const name of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky']) {
    await choosePreset(page, name);
    assert.equal(await checked(typeBox(page, 'Cesty 2')), true, `${name}: the later type is visible`);
  }
  await choosePreset(page, 'Jen vztahy');
  await click(kindBox(page, 'Links'), 'show Links');
  await click(updateBtn(page), 'Update Jen vztahy');
  const text = await eventually(() => graphYml(core), (t) => t !== presetsText('valid'), 3000);
  assert.equal(lines(text ?? '')[4], '    hidden-types: [tag, kniha]', 'Bez štítků keeps `kniha`');
  assert.equal(lines(text ?? '')[10], lines(presetsText('valid'))[10], 'Lidé a schůzky keeps `recept`');
  assert.equal(lines(text ?? '')[8], '    hidden-kinds: [embed, tag]', 'kinds in R118\'s order');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-19

async function unreadableChecks(page: Page, core: Awaited<ReturnType<typeof openGraph>>, original: string | null, line: number | null) {
  await openPresetMenu(page);
  const items = await menuItems(page);
  assert.deepEqual(items.filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default'], 'only Default is listed');
  const menuText = flat(await presetMenu(page).innerText());
  if (line !== null) assert.ok(menuText.includes(`The presets file can't be read (line ${line}).`), `the line \`The presets file can't be read (line ${line}).\`: ${menuText}`);
  else assert.ok(/The presets file can't be read( \(line \d+\))?\./.test(menuText), `the unreadable line: ${menuText}`);
  const save = items.find((i) => i.name === 'Save as new preset…');
  assert.deepEqual([save?.disabled, save?.desc], [true, 'Fix .tegg/graph.yml to save presets.'], '`Save as new preset…` aria-disabled with the reason');
  await page.keyboard.press('Escape');
  const e = await paletteEntry(page, 'Graph: Save as new preset…');
  assert.deepEqual([e.listed, e.disabled], [true, true], 'the palette\'s `Graph: Save as new preset…` is aria-disabled');
  const n0 = (await drawnKeys(page)).length;
  await click(typeBox(page, 'Tags'), 'a filter change works');
  const n1 = await eventually(async () => (await drawnKeys(page)).length, (n) => n !== n0, 2000);
  assert.notEqual(n1, n0, 'the Tags filter changes what is drawn');
  await choosePreset(page, 'Default');
  await needDrawn(page, 10, 'applying Default works');
  if (original !== null) assert.equal(await graphYml(core), original, 'the file keeps its bytes');
  assert.equal(await applyCalls(core), 0, 'no graph_presets_apply');
}

test('fr_grp_02_ac19_unreadable_file_is_never_rewritten', async ({ page }) => {
  const stored = uiG3({ full: { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [], preset: 'Bez štítků' } });
  const core = await openGraph(page, P.plan, { vault: presetsVault(presetsText('invalid-yaml')), uiState: stored });
  assert.equal((await eventually(() => presetState(page), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', 'a stored Bez štítků shows `Default · modified`');
  assert.equal((await uiWrites(core)).length, 0, 'and isn\'t rewritten in ui-state.json');
  await unreadableChecks(page, core, presetsText('invalid-yaml'), 5);
  await core.setFile(GRAPH_YML, presetsText('valid'));
  await openPresetMenu(page);
  await must(menuRadio(page, 'Jen vztahy'), 'fixed by another program: the presets appear within 2 s', 2000);
});

const valid = presetsText('valid');
for (const [what, text] of [
  ['version_0', valid.replace('version: 1\n', 'version: 0\n')], ['version_string', valid.replace('version: 1\n', 'version: "1"\n')],
  ['version_fraction', valid.replace('version: 1\n', 'version: 1.5\n')], ['top_level_list', '- a\n'], ['presets_not_a_list', 'version: 1\npresets: Bez štítků\n'],
] as const) {
  test(`fr_grp_02_ac19_unreadable_file_is_never_rewritten_${what}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { vault: presetsVault(text) });
    await unreadableChecks(page, core, text, null);
  });
}

test('fr_grp_02_ac19_unreadable_file_is_never_rewritten_invalid_utf8', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  const bytes = new TextEncoder().encode(valid);
  const at = new TextEncoder().encode(valid.slice(0, valid.indexOf('Bez štítků') + 3)).length;
  await core.setFile(GRAPH_YML, new Uint8Array([...bytes.slice(0, at), 0xff, ...bytes.slice(at)]));
  await sleep(500);
  await unreadableChecks(page, core, null, null);
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-20

test('fr_grp_02_ac20_invalid_entries_are_skipped_and_kept', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: presetsVault(presetsText('entries')) });
  await openPresetMenu(page);
  assert.deepEqual((await menuItems(page)).filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default', 'Lidé', 'Bez druhů', 'Neznámé spoje'],
    'only the listed entries');
  await page.keyboard.press('Escape');
  await choosePreset(page, 'Bez druhů');
  assert.deepEqual([(await fullState(core))?.hiddenTypes, (await fullState(core))?.hiddenKinds], [['task'], []], 'Bez druhů: hiddenTypes [task], hiddenKinds []');
  await choosePreset(page, 'Neznámé spoje');
  assert.equal(await checked(kindBox(page, 'Links')), false, 'Neznámé spoje unticks Links');
  assert.deepEqual((await fullState(core))?.hiddenKinds, ['link', 'backlink'], '`backlink` is kept (ignored)');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await (await must(nameField(page), 'Name')).fill('lidé');
  assert.equal(await eventually(() => description(nameField(page)), (d) => d.length > 0, 1500), 'A preset named “Lidé” already exists.', '`lidé` is taken');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-21

test('fr_grp_02_ac21_newer_and_missing_versions', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: presetsVault(presetsText('newer-version')) });
  await choosePreset(page, 'Bez štítků');
  await needDrawn(page, 8, 'the newer file\'s preset can be applied');
  await openPresetMenu(page);
  const items = await menuItems(page);
  for (const n of ['Save as new preset…', 'Update “Bez štítků”', 'Rename “Bez štítků”…', 'Delete “Bez štítků”…']) {
    const i = items.find((x) => x.name === n);
    assert.deepEqual([i?.disabled, i?.desc], [true, 'Made by a newer version of Tegg. Read-only.'], `${n}: aria-disabled, read-only`);
  }
  await page.keyboard.press('Escape');
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [presetsText('newer-version'), 0], 'the file keeps its bytes');
});

test('fr_grp_02_ac21_newer_and_missing_versions_missing', async ({ page }) => {
  const noVersion = presetsText('valid').replace('version: 1\n', '');
  const core = await openGraph(page, P.plan, { vault: presetsVault(noVersion) });
  await openPresetMenu(page);
  await must(menuRadio(page, 'Lidé a schůzky'), 'presets of a file without `version` are listed');
  await page.keyboard.press('Escape');
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [noVersion, 0], 'nothing is written on open');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-22

test('fr_grp_02_ac22_preset_remembered_per_view_and_vault', async ({ page, browser }) => {
  const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: BEZ }) });
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), 'the stored preset with its filters: `Preset: Bez štítků`');
  await needDrawn(page, 8, 'its filters');
  const p2 = await browser.newPage();
  const c2 = await openGraph(p2, P.plan, { vault: VALID(), uiState: uiG3({ full: { ...BEZ, preset: 'bez štítků' } }) });
  assert.ok(await presetIs(p2, 'Bez štítků'), 'matched case-insensitively');
  await p2.close();
  const p3 = await browser.newPage();
  const c3 = await openGraph(p3, P.plan, { vault: VALID(), uiState: uiG3({ full: { hiddenTypes: ['page'], hiddenKinds: [], preset: 'Smazaný' } }) });
  assert.equal((await eventually(() => presetState(p3), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', 'a name not listed: `Default · modified`');
  assert.equal((await uiWrites(c3)).length, 0, 'not rewritten on open');
  await click(typeBox(p3, 'Tags'), 'a filter change');
  assert.ok((await eventually(async () => (await uiWrites(c3)).length, (n) => n > 0, 2000)) > 0, 'written once the user changes a filter');
  await p3.close();
  const p4 = await browser.newPage();
  const other = uiG3({ full: { preset: 'Bez štítků', hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] }, vault: '/fake/Jiný' });
  await openGraph(p4, P.plan, { vault: VALID(), uiState: other });
  assert.ok(await presetIs(p4, 'Default'), 'another vault\'s `preset` doesn\'t apply here');
  await p4.close();
  void core; void c2;
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-23

test('fr_grp_02_ac23_external_changes_reload_the_list_only', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: BEZ }) });
  await needDrawn(page, 8, 'Bez štítků');
  const g0 = (await core.graphCalls()).length;
  await core.setFile(GRAPH_YML, presetsText('valid').replace('hidden-types: [tag, kniha]', 'hidden-types: [page]'));
  assert.ok(await isModified(page), 'the view becomes `· modified` within 2 s');
  await needDrawn(page, 8, 'the view\'s filters stay');
  assert.equal((await core.graphCalls()).length, g0, 'no graph_neighbourhood call follows a change to graph.yml alone');
  await click(revertBtn(page), 'Revert');
  await needDrawn(page, 9, 'Revert applies [page]');
  await core.setFile(GRAPH_YML, `${(await graphYml(core)) ?? ''}  - name: Nová zvenku\n    hidden-types: []\n    hidden-kinds: [tag]\n`);
  await sleep(300);
  await openPresetMenu(page);
  await must(menuRadio(page, 'Nová zvenku'), 'another program\'s new preset is listed within 2 s', 2000);
  await page.keyboard.press('Escape');
  const g1 = (await core.graphCalls()).length;
  await core.setFile(GRAPH_YML, null);
  await sleep(600);
  await openPresetMenu(page);
  assert.deepEqual((await menuItems(page)).filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default'], 'the file deleted: Default only');
  await page.keyboard.press('Escape');
  await needDrawn(page, 9, 'the filters unchanged');
  assert.deepEqual([await graphYml(core), (await core.graphCalls()).length], [undefined, g1], 'nothing created, no new graph request');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-24

test('fr_grp_02_ac24_presets_in_the_filters_popover', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: BEZ }) });
  await click(filtersBtn(page), 'Filters');
  const pop = await must(page.getByRole('dialog').filter({ has: presetBtn(page) }).or(page.locator('[role="dialog"], [data-popover]').filter({ has: presetBtn(page) })), 'the `Filters` popover holds the preset control');
  const first = await pop.evaluate((d) => {
    const f = d.querySelector('button, input, [tabindex="0"]');
    return (f?.getAttribute('aria-label') ?? f?.textContent ?? '').trim();
  });
  assert.ok(/^Preset: /.test(first), `the preset control is the popover's first item (${first})`);
  const onTop = async (loc: ReturnType<typeof presetMenu>) => (await must(loc, 'a layer')).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2));
    return !!top && e.contains(top);
  });
  await click(presetBtn(page), 'the preset button');
  assert.ok(await onTop(presetMenu(page)), 'the menu opens above the popover');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(presetMenu(page), 400)) && await seen(presetBtn(page), 400), 'Esc closes the menu, the popover stays');
  assert.ok((await focused(page)).name.startsWith('Preset: '), 'the focus returns to the preset button');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  assert.ok(await onTop(saveDialog(page)), 'the Save dialog opens above the popover');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(saveDialog(page), 400)) && await seen(presetBtn(page), 400), 'Esc closes the dialog first');
  assert.ok((await focused(page)).name.startsWith('Preset: '), 'the focus returns to the preset button');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete “Bez štítků”…');
  assert.ok(await onTop(deleteConfirm(page, 'Bez štítků')), 'the delete confirm opens above the popover');
  await page.keyboard.press('Escape');
  assert.ok((await focused(page)).name.startsWith('Preset: '), 'Esc returns the focus to the preset button');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(presetBtn(page), 400)), 'the next Esc closes the popover');
  assert.equal((await focused(page)).name, 'Filters', 'the focus returns to `Filters`');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-22

const THEIRS = `${presetsText('valid')}  - name: Cizí\n    hidden-types: [page]\n    hidden-kinds: []\n`;
for (const op of ['save', 'update', 'rename', 'delete'] as const) {
  test(`fr_syn_03_ac22_graph_yml_writes_check_the_base_${op}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { vault: VALID(), uiState: uiG3({ full: JEN }) });
    assert.ok(await presetIs(page, 'Jen vztahy'), 'Jen vztahy current (setup)');
    await core.setFile(GRAPH_YML, THEIRS, { silent: true }); // changed on disk, no vault:changed
    if (op === 'save') {
      await saveAs(page, 'Moje');
    } else if (op === 'update') {
      await click(kindBox(page, 'Links'), 'show Links');
      await click(updateBtn(page), 'Update');
    } else if (op === 'rename') {
      await openPresetMenu(page);
      await click(menuItem(page, 'Rename “Jen vztahy”…'), 'Rename');
      await (await must(renameField(page), 'Preset name')).fill('Vztahy');
      await page.keyboard.press('Enter');
    } else {
      await openPresetMenu(page);
      await click(menuItem(page, 'Delete “Jen vztahy”…'), 'Delete');
      await click((await must(deleteConfirm(page, 'Jen vztahy'), 'the confirm')).getByRole('button', { name: 'Delete', exact: true }), 'Delete');
    }
    await must(presetAlert(page).filter({ hasText: 'Presets changed outside Tegg. Your change wasn\'t saved.' }), 'the alert `Presets changed outside Tegg. Your change wasn\'t saved.`', 3000);
    assert.equal(await graphYml(core), THEIRS, 'nothing written: the disk bytes stay');
    const calls = await core.presetCalls();
    assert.equal(calls.length, 1, 'one graph_presets_apply');
    assert.ok(calls[0].base !== null, 'with the version of the last read as base');
    await openPresetMenu(page);
    await must(menuRadio(page, 'Cizí'), 'the menu reloads from disk');
    await page.keyboard.press('Escape');
    assert.ok(op !== 'update' || await isModified(page), 'the view\'s filters never change');
    if (op === 'save') {
      const f = await must(nameField(page), 'the Save dialog stays open');
      assert.equal(await f.inputValue(), 'Moje', 'with the typed name');
      await page.keyboard.press('Enter');
      const t = await eventually(() => graphYml(core), (x) => !!x?.includes('- name: Moje'), 3000);
      assert.ok(t?.includes('- name: Cizí') && t.includes('- name: Moje'), 'a second Save writes on top of the new version: both presets');
    }
  });
}

test('fr_syn_03_ac22_graph_yml_writes_check_the_base_gone_and_io', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await core.setFile(GRAPH_YML, null, { silent: true });
  await saveAs(page, 'Moje');
  await must(presetAlert(page).filter({ hasText: 'Presets changed outside Tegg.' }), 'Gone is shown as an outside change', 3000);
  assert.equal(await graphYml(core), undefined, 'nothing is created');
  await core.setFile(GRAPH_YML, presetsText('valid'));
  await sleep(300);
  await core.presetsFail('Io');
  await page.keyboard.press('Escape');
  await saveAs(page, 'Jiná');
  await must(presetAlert(page).filter({ hasText: 'Couldn\'t save the presets. Try again.' }), '`Io`: `Couldn\'t save the presets. Try again.`', 3000);
  assert.equal(await graphYml(core), presetsText('valid'), 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-24

test('fr_syn_03_ac24_first_save_never_replaces_a_new_file', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await click(typeBox(page, 'Tags'), 'hide Tags');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await (await must(nameField(page), 'Name')).fill('Bez štítků');
  await core.setFile(GRAPH_YML, presetsText('valid'), { silent: true }); // another program creates it before Save
  await page.keyboard.press('Enter');
  await must(presetAlert(page).filter({ hasText: 'Presets changed outside Tegg.' }), 'refused with the alert', 3000);
  assert.equal((await core.presetCalls())[0]?.base ?? null, null, 'the save had no base');
  assert.equal(await graphYml(core), presetsText('valid'), 'the other program\'s file stays byte for byte');
  await page.keyboard.press('Escape');
  await openPresetMenu(page);
  await must(menuRadio(page, 'Lidé a schůzky'), 'the menu shows its presets');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-40 (L5)

test('fr_syn_06_ac40_only_preset_actions_write_graph_yml', async ({ page }) => {
  const core = await openGraph(page, P.plan, { vault: VALID() });
  const yml0 = await graphYml(core);
  for (const n of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Default']) await choosePreset(page, n);
  await choosePreset(page, 'Bez štítků');
  await click(typeBox(page, 'Tags'), 'tick Tags');
  await click(revertBtn(page), 'Revert');
  await click(viewBtn(page, 'List'), 'List');
  await click(viewBtn(page, 'Graph'), 'Graph');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await click(cancelBtn(page), 'Cancel');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Bez štítků”…'), 'Rename');
  await page.keyboard.press('Escape');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete');
  await page.keyboard.press('Escape');
  assert.deepEqual([await graphYml(core), await applyCalls(core), await presetWrites(core)], [yml0, 0, []], 'the tour writes nothing');
  const step = async (what: string, f: () => Promise<void>) => {
    const c0 = await applyCalls(core), w0 = (await presetWrites(core)).length;
    await f();
    await eventually(() => presetWrites(core), (w) => w.length > w0, 3000);
    assert.equal((await applyCalls(core)) - c0, 1, `${what}: one graph_presets_apply`);
    assert.deepEqual((await presetWrites(core)).slice(w0), [GRAPH_YML], `${what}: exactly one write, .tegg/graph.yml`);
  };
  await click(typeBox(page, 'Pages'), 'hide Pages');
  await step('Save as', () => saveAs(page, 'Moje'));
  await click(typeBox(page, 'Tasks'), 'hide Tasks');
  await step('Update', () => click(updateBtn(page), 'Update'));
  await step('Rename', async () => {
    await openPresetMenu(page);
    await click(menuItem(page, 'Rename “Moje”…'), 'Rename');
    await (await must(renameField(page), 'Preset name')).fill('Moje 2');
    await page.keyboard.press('Enter');
  });
  const w1 = (await presetWrites(core)).length;
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Moje 2”…'), 'Rename');
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.equal((await presetWrites(core)).length, w1, 'a rename to the same name writes nothing');
  await step('Delete', async () => {
    await openPresetMenu(page);
    await click(menuItem(page, 'Delete “Moje 2”…'), 'Delete');
    await click((await must(deleteConfirm(page, 'Moje 2'), 'the confirm')).getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  });
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-7 (L5)

const nfdValid = () => presetsText('valid').replace(/(- name: )(.*)/g, (_, a: string, b: string) => a + NFD(b));
for (const region of ['cs', 'en-US']) {
  test(`fr_fmt_12_ac7_preset_names_are_nfc_${region.replace('-', '_')}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { vault: presetsVault(nfdValid()), region });
    await openPresetMenu(page);
    assert.deepEqual((await menuItems(page)).filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default', 'Bez štítků', 'Jen vztahy', 'Lidé a schůzky'],
      'the menu shows NFC names');
    await click(menuRadio(page, 'Bez štítků'), 'apply Bez štítků');
    assert.equal((await fullState(core))?.preset, 'Bez štítků', '`preset` stored in NFC');
    await openPresetMenu(page);
    await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
    for (const typed of ['Bez štítků', NFD('Bez štítků')]) {
      await (await must(nameField(page), 'Name')).fill(typed);
      assert.equal(await eventually(() => description(nameField(page)), (d) => d.length > 0, 1500), 'A preset named “Bez štítků” already exists.', `${typed === NFD(typed) ? 'NFD' : 'NFC'} typed: taken`);
    }
    await page.keyboard.press('Escape');
    await choosePreset(page, 'Lidé a schůzky');
    await openPresetMenu(page);
    await click(menuItem(page, 'Rename “Lidé a schůzky”…'), 'Rename');
    await (await must(renameField(page), 'Preset name')).fill('Lidé a porady');
    await page.keyboard.press('Enter');
    const want = setLine(nfdValid(), 10, '  - name: Lidé a porady');
    assert.equal(await eventually(() => graphYml(core), (t) => t === want, 3000), want, 'that line in NFC, the other NFD names as they were');
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-28 (L5)

test('fr_ux_03_ac28_graph_preset_and_view_commands', async ({ page }) => {
  await openGraph(page, P.plan, { vault: VALID() });
  const listed = async (t: string) => (await paletteEntry(page, t)).listed;
  for (const t of ['Graph: Apply preset…', 'Graph: Save as new preset…', 'Graph: Update preset', 'Graph: Revert preset', 'Graph: Rename preset…', 'Graph: Delete preset…', 'Graph: Show as list']) {
    assert.ok(await listed(t), `${t} is listed on graph/<path>`);
  }
  assert.equal(await listed('Graph: Show as graph'), false, '`Graph: Show as graph` only in List');
  const rev = await paletteEntry(page, 'Graph: Revert preset');
  assert.equal(rev.disabled, true, '`Graph: Revert preset` is aria-disabled while not modified');
  assert.ok(rev.text.includes('The filters match the preset.'), `with its reason: ${rev.text}`);
  const d1 = await must(depthBtn(page, 1), 'depth 1');
  await d1.focus();
  await runCommand(page, 'Graph: Apply preset…');
  await must(presetMenu(page), 'the preset menu opens');
  assert.equal((await focused(page)).name.replace(/\s*built-in$/, ''), 'Default', 'with the focus on the checked item');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await needDrawn(page, 3, '⏎ on Jen vztahy applies it');
  assert.equal((await focused(page)).name, '1', 'the focus returns where it was before the palette (D-139)');
  await runCommand(page, 'Graph: Show as list');
  await must(listTree(page), '`Graph: Show as list`');
  assert.equal(await listed('Graph: Show as list'), false, '`Show as list` only in Graph');
  await runCommand(page, 'Graph: Show as graph');
  assert.ok(!(await seen(listTree(page), 500)), '`Graph: Show as graph`');
  for (const loc of [presetBtn(page), viewBtn(page, 'Graph'), viewBtn(page, 'List')]) {
    const el = await must(loc, 'an R119 / R122 control');
    await el.focus();
    assert.ok(await el.evaluate((e) => e === document.activeElement), 'reachable by keyboard (FR-UX-03 AC-8)');
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-29

test('fr_ux_03_ac29_presets_without_the_pointer', async ({ page }) => {
  const core = await openGraph(page, P.plan);
  await click(typeBox(page, 'Tags'), 'hide Tags (setup)');
  const btn = await must(presetBtn(page), 'Preset: Default');
  await btn.focus();
  const onButton = async (what: string) => assert.ok((await focused(page)).name.startsWith('Preset: '), `${what}: the focus returns to the preset button`);
  await page.keyboard.press('Enter');
  await must(presetMenu(page), '⏎ opens the menu');
  await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, 'Save as new preset…', '↓ to `Save as new preset…`');
  await page.keyboard.press('Enter');
  await must(nameField(page), 'the Save dialog');
  await page.keyboard.type('Bez štítků');
  await page.keyboard.press('Enter');
  assert.ok(await presetIs(page, 'Bez štítků'), 'saved');
  await onButton('after Save');
  await page.keyboard.press('Enter');
  await must(presetMenu(page), 'the menu');
  for (let i = 0; i < 6 && (await focused(page)).name !== 'Rename “Bez štítků”…'; i++) await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, 'Rename “Bez štítků”…', '↓ to `Rename “Bez štítků”…`');
  await page.keyboard.press('Enter');
  await must(renameField(page), 'the rename field');
  await page.keyboard.type('Bez tagů');
  await page.keyboard.press('Enter');
  assert.ok(await presetIs(page, 'Bez tagů'), 'renamed');
  await onButton('after the rename');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6 && (await focused(page)).name !== 'Delete “Bez tagů”…'; i++) await page.keyboard.press('ArrowDown');
  assert.equal((await focused(page)).name, 'Delete “Bez tagů”…', '↓ to `Delete “Bez tagů”…`');
  await page.keyboard.press('Enter');
  await must(deleteConfirm(page, 'Bez tagů'), 'the confirm');
  await page.keyboard.press('Tab');
  assert.equal((await focused(page)).name, 'Delete', 'Tab to `Delete`');
  await page.keyboard.press('Enter');
  assert.ok(await presetIs(page, 'Default'), 'deleted');
  await onButton('after the delete');
  assert.equal(await eventually(() => graphYml(core), (t) => t === expectedText('valid-after-deleting-all'), 2000), expectedText('valid-after-deleting-all'), 'the file stays with `presets: []`');
});
