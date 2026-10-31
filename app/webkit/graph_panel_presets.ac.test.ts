// Slice "G3 in the panel", L5 (WebKit + fake core): presets in the right panel's Graph tab (docs/acceptance/
// graph-panel-g3.md R125, R127): FR-GRP-01 AC-45 (the hand-over carries depth and selection only), FR-GRP-02 AC-26 (the
// preset row in `Depth and filters`), AC-27 (applying sets the panel's filters only), AC-28 (`· modified` per view),
// AC-29 (save, rename, delete from the panel), AC-30 (the full view's rename and delete reach the panel), AC-31 (file
// states and outside changes), AC-32 (the panel's preset and view stored per view and vault), AC-33 (layers, Esc,
// closing), FR-SYN-03 AC-25 (every panel write checks the base) and FR-SYN-06 AC-41 (L5: the count of
// `graph_presets_apply` calls and fake vault writes). Interface docs/contracts/v1-graph.md §17.1…§17.3, §17.7 (on §15,
// §16.2…§16.4, §16.6: `graph_presets_get` / `graph_presets_apply`, `presetCalls`, `presetsFail`,
// `setFile(…, { silent })`, D-1110). Fixtures tests/fixtures/graph-presets/ and tests/fixtures/vaults/graph. Written from
// the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and node:assert, so a missing element is
// an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { description } from './capture-helpers';
import { mustPreview, previewDialog } from './helpers';
import {
  GRAPH_YML, NFD, VAULT_PATH, cancelBtn, checked, choosePreset, click, deleteConfirm, depthBtn, drawn, drawnEdges, eventually, expectedText, flat,
  focused, graphHeading, graphYml, isDisabled, listTree, mainName, marks, menuItem, menuItems, menuRadio, must, nameField, nfc, openPresetMenu,
  presetBtn, presetIs, presetMenu, presetState, presetsText, presetWrites, previewCol, renameField, revertBtn, rows, saveAs, saveBtn, saveDialog,
  seen, sleep, typeBox, uiWrites, updateBtn, viewBtn, waitDrawn,
} from './graph-helpers';
import {
  GP, P, VIEWPORT, backlinksTab, chooseDepth, closePopover, ctxPanel, depthRadio, depthRadios, fullStored, openFullBtn, openPanel, openPopover,
  panelStored, pCanvas, pKindBox, pKinds, pListTree, popover, pRows, pSizeBox, pTypeBox, pTypes, pViewBtn, requests, searchOpen, startPanel,
  noteRoute, trigger, triggerText, uiSetCount, FILTERS_NOTE,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

type Core = Awaited<ReturnType<typeof openPanel>>;
const VALID = presetsText('valid');
const BEZ = { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] as string[], preset: 'Bez štítků' };
const JEN = { hiddenTypes: [] as string[], hiddenKinds: ['link', 'embed', 'tag'], preset: 'Jen vztahy' };
const lines = (s: string) => s.split('\n');
const setLine = (s: string, n: number, v: string) => { const l = lines(s); l[n - 1] = v; return l.join('\n'); };
const cut = (s: string, from: number, to: number) => { const l = lines(s); l.splice(from - 1, to - from + 1); return l.join('\n'); };
const keysIn = (page: Page) => drawn(page, GP(page)).then((d) => d.map((n) => n.key).sort());
async function needIn(page: Page, n: number, what: string, ms = 4000) {
  const k = await waitDrawn(page, n, ms, GP(page));
  assert.equal(k.length, n, `${what}: ${n} nodes drawn in the panel (got ${k.length})`);
  return k;
}
const applyCalls = async (core: Core) => (await core.presetCalls()).length;
const gets = async (core: Core) => (await core.calls()).filter((c) => c.cmd === 'graph_presets_get').length;
const notModified = async (page: Page) => !(await presetState(page)).text.includes('· modified');
const isModified = async (page: Page, ms = 2000) => (await eventually(() => presetState(page), (s) => s.text.includes('· modified'), ms)).text.includes('· modified');
const onPresetBtn = async (page: Page) => (await focused(page)).name.startsWith('Preset: ');
/** The panel's preset row (R125): the popover open and its `Preset: …` button shown. */
async function presetRow(page: Page) {
  await openPopover(page);
  return must(popover(page).getByRole('button', { name: /^Preset: / }), 'the popover\'s preset row `Preset: …` (R125, board GraphPanel B)');
}
const TRIGGER_RE = /^Depth \d( · \d+ hidden)?$/;
type Box = { x: number; y: number; width: number; height: number };
const insideWindow = (b: Box, w: number, h: number, m = 8) => b.x >= m - 0.5 && b.y >= m - 0.5 && b.x + b.width <= w - m + 0.5 && b.y + b.height <= h - m + 0.5;
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const gap = (a: Box, b: Box) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width), Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-45

const graphMarks = async (core: Core) => (await marks(core)).map(nfc).filter((m) => m === `route-ready:graph/${nfc(P.plan)}`).length;
async function handOver(page: Page, core: Core, how: 'inFullGraph' | 'button' | 'key') {
  const n = await graphMarks(core);
  if (how === 'inFullGraph') await click(previewDialog(page, 'Rozpočet 2027').getByRole('button', { name: 'In full graph', exact: true }), '`In full graph`');
  if (how === 'button') await click(openFullBtn(page), '`Open full view`');
  if (how === 'key') await page.keyboard.press('Meta+Shift+g');
  assert.ok((await eventually(() => graphMarks(core), (x) => x > n, 5000)) > n, `${how}: opens graph/Pages/Plán čtvrtletí.md`);
  await must(graphHeading(page), `${how}: the full view`, 4000);
}
async function selectRow(page: Page, title: string) {
  const row = await must(pListTree(page).getByRole('treeitem', { name: new RegExp(`^${title}, `) }), `the panel row \`${title}\``);
  const b = (await row.boundingBox())!;
  await page.mouse.click(b.x + 24, b.y + 8);
  return mustPreview(page, title, `the row ${title} previews`);
}

test('fr_grp_01_ac45_panel_hands_over_depth_and_selection_only', async ({ page }) => {
  const panel0 = { depth: 2, view: 'list', preset: 'Bez štítků', hiddenTypes: ['tag', 'kniha'] };
  const core = await openPanel(page, P.plan, { presets: VALID, panel: panel0, full: { depth: 1 } });
  await must(pListTree(page), 'the panel shows the List (graph.panel.view "list")');
  assert.equal(await eventually(async () => (await pRows(page)).length, (n) => n === 14, 4000), 14, 'Plán at depth 2 with Bez štítků: 14 rows');
  for (const how of ['inFullGraph', 'button', 'key'] as const) {
    await selectRow(page, 'Rozpočet 2027');
    const u0 = await uiSetCount(core);
    await handOver(page, core, how);
    assert.equal(await (await must(depthBtn(page, 2), 'depth 2')).getAttribute('aria-pressed'), 'true', `${how}: \`2\` pressed`);
    assert.equal((await waitDrawn(page, 19, 4000)).length, 19, `${how}: the Graph view with its own filters: 19 objects (Tags visible)`);
    assert.equal(await (await must(viewBtn(page, 'Graph'), '`Graph`')).getAttribute('aria-pressed'), 'true', `${how}: the full view's own view (absent = Graph)`);
    assert.ok(await presetIs(page, 'Default'), `${how}: \`Preset: Default\``);
    assert.deepEqual((await drawn(page)).filter((n) => n.selected).map((n) => n.key), [nfc(P.rozpocet)], `${how}: Rozpočet selected in the full view`);
    const col = await eventually(async () => flat(await previewCol(page).innerText().catch(() => '')), (t) => t.includes('Projekt · 6 connections'), 3000);
    assert.ok(col.includes('Projekt · 6 connections'), `${how}: previewed in the column`);
    await sleep(300);
    assert.equal((await uiSetCount(core)) - u0, 0, `${how}: the hand-over writes no ui_state_set`);
    assert.deepEqual(await fullStored(core), { depth: 1 }, `${how}: graph.full stays { depth: 1 }`);
    assert.deepEqual(await panelStored(core), panel0, `${how}: graph.panel unchanged`);
    await page.keyboard.press('Meta+BracketLeft');
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', `${how}: Back on the note`);
    await must(pListTree(page), `${how}: the panel in List`);
    const r = await eventually(() => pRows(page), (x) => x.length === 14, 3000);
    assert.equal(r.length, 14, `${how}: 14 rows`);
    assert.deepEqual(r.filter((x) => x.selected === 'true').map((x) => x.name), [], `${how}: nothing selected`);
  }
  await presetRow(page);
  assert.ok(await presetIs(page, 'Bez štítků'), 'the panel keeps `Bez štítků`');
});

test('fr_grp_01_ac45_panel_hands_over_depth_and_selection_only_full_view_in_list', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { depth: 2, view: 'list', preset: 'Bez štítků', hiddenTypes: ['tag', 'kniha'] }, full: { depth: 1, view: 'list' } });
  await must(pListTree(page), 'the panel shows the List');
  await selectRow(page, 'Rozpočet 2027');
  await handOver(page, core, 'button');
  await must(listTree(page), 'with graph.full.view "list" the full view opens in List');
  const r = await eventually(() => rows(page), (x) => x.some((y) => y.selected === 'true'), 3000);
  assert.deepEqual(r.filter((x) => x.selected === 'true').map((x) => x.name), ['Rozpočet 2027, Projekt'], 'with Rozpočet\'s row selected');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-26

test('fr_grp_02_ac26_panel_preset_row_in_the_popover', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await needIn(page, 10, 'Plán');
  const g0 = await gets(core);
  await openPopover(page);
  assert.equal(await eventually(() => depthRadio(page, 1).evaluate((e) => e === document.activeElement), (x) => x, 1000), true, 'the focus lands on the checked `Depth` radio (graph-panel.md FR-GRP-02 AC-7)');
  const label = await must(popover(page).getByText('Preset', { exact: true }), 'the label `Preset` in the popover (R125)');
  const btn = await must(popover(page).getByRole('button', { name: /^Preset: / }), 'the button `Preset: Default` in the popover');
  assert.equal((await presetState(page)).name, 'Preset: Default', 'named `Preset: Default` with no graph.yml');
  const lb = (await label.boundingBox())!, bb = (await btn.boundingBox())!;
  assert.ok(Math.abs((lb.y + lb.height / 2) - (bb.y + bb.height / 2)) <= 4 && lb.x < bb.x, 'the label and the button on one row (board GraphPanel B)');
  const y = async (loc: ReturnType<typeof pTypes>) => (await (await must(loc, 'a popover part')).boundingBox())!.y;
  const parts = [await y(depthRadios(page)), lb.y, await y(pTypes(page)), await y(pKinds(page)), await y(pSizeBox(page)), await y(popover(page).getByText(FILTERS_NOTE, { exact: true }))];
  assert.deepEqual([...parts].sort((a, b) => a - b), parts, 'Depth, Preset, Types, Connections, Size nodes by links, the note — in this order');
  await openPresetMenu(page);
  assert.deepEqual((await menuItems(page)).map((i) => [i.role, i.role === 'separator' ? '' : i.name.replace(/\s*built-in$/, ''), i.checked]),
    [['menuitemradio', 'Default', 'true'], ['separator', '', null], ['menuitem', 'Save as new preset…', null]], 'Default (checked), a separator, `Save as new preset…`');
  assert.ok(await seen(popover(page), 200), 'the popover stays open while the menu is open');
  const mb = (await (await must(presetMenu(page), 'the menu')).boundingBox())!;
  assert.ok(insideWindow(mb, VIEWPORT.width, VIEWPORT.height), `the menu lies inside the window with 8 px: ${JSON.stringify(mb)}`);
  assert.ok(!overlap(mb, (await btn.boundingBox())!), 'the menu doesn\'t cover the preset button');
  await click(menuRadio(page, 'Default'), 'the menu item Default');
  assert.ok(!(await seen(presetMenu(page), 500)), 'choosing closes the menu');
  assert.ok(await seen(popover(page), 300), 'a click on a menu item is not a click outside the popover');
  assert.ok(await onPresetBtn(page), 'the focus on the preset button');
  assert.ok((await gets(core)) - g0 <= 1, `at most one graph_presets_get for this opening of the popover (got ${(await gets(core)) - g0})`);
  assert.equal(await core.writes(), 0, 'nothing written');
});

test('fr_grp_02_ac26_panel_preset_row_in_the_popover_with_valid', async ({ page }) => {
  await openPanel(page, P.plan, { presets: VALID, panel: BEZ });
  await presetRow(page);
  await openPresetMenu(page);
  const items = await menuItems(page);
  assert.deepEqual(items.map((i) => [i.role, i.role === 'separator' ? '' : i.name.replace(/\s*built-in$/, ''), i.checked]), [
    ['menuitemradio', 'Default', 'false'], ['menuitemradio', 'Bez štítků', 'true'], ['menuitemradio', 'Jen vztahy', 'false'], ['menuitemradio', 'Lidé a schůzky', 'false'],
    ['separator', '', null], ['menuitem', 'Save as new preset…', null], ['menuitem', 'Update “Bez štítků”', null], ['menuitem', 'Rename “Bez štítků”…', null],
    ['menuitem', 'Delete “Bez štítků”…', null],
  ], 'as FR-GRP-02 AC-11: the presets in file order, the stored one checked, then the editing items');
  const upd = items.find((i) => i.name === 'Update “Bez štítků”');
  assert.deepEqual([upd?.disabled, upd?.desc], [true, 'The filters match the preset.'], '`Update “Bez štítků”` aria-disabled while not modified');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-27

test('fr_grp_02_ac27_panel_applying_a_preset', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { sizeByLinks: true, view: 'graph' } });
  await needIn(page, 10, 'Plán');
  const yml0 = await graphYml(core), ver0 = await core.version(GRAPH_YML);
  const triggers: string[] = [await triggerText(page)];
  await presetRow(page);
  const w0 = (await uiWrites(core)).length;
  await choosePreset(page, 'Bez štítků');
  await needIn(page, 8, 'Bez štítků');
  assert.equal((await drawnEdges(page, GP(page))).length, 8, '8 edges');
  triggers.push(await triggerText(page));
  assert.equal(triggers.at(-1), 'Depth 1 · 2 hidden', 'the trigger reads `Depth 1 · 2 hidden`');
  assert.equal(await checked(pTypeBox(page, 'Tags')), false, 'the Tags checkbox is unticked');
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), '`Preset: Bez štítků` without `· modified`');
  assert.ok(!(await seen(presetMenu(page), 300)), 'the menu closes');
  assert.ok(await onPresetBtn(page), 'with the focus on the preset button');
  assert.ok(await seen(popover(page), 200), 'and the popover stays open');
  await sleep(300);
  const writes = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(writes.length, 1, 'exactly one ui_state_set');
  const g = writes[0]?.vaults?.[nfc(VAULT_PATH)]?.graph;
  assert.deepEqual([g?.panel?.hiddenTypes, g?.panel?.hiddenKinds, g?.panel?.preset], [['tag', 'kniha'], [], 'Bez štítků'], 'graph.panel holds the preset\'s filters and its name');
  assert.deepEqual([g?.panel?.sizeByLinks, g?.panel?.view, g?.panel?.depth ?? 1], [true, 'graph', 1], 'keeping depth, sizeByLinks and view');
  assert.equal(g?.full, undefined, 'graph.full is neither written nor created');
  const last = (await requests(core)).at(-1);
  assert.ok((last?.hiddenTypes as string[] | undefined)?.includes('tag') && last?.cap === 60, `the next graph_neighbourhood: hiddenTypes with tag, cap 60 (${JSON.stringify(last)})`);
  await choosePreset(page, 'Jen vztahy');
  assert.deepEqual(await eventually(() => keysIn(page), (k) => k.length === 3, 3000), [P.plan, P.rozpocet, P.ukol].map(nfc).sort(), 'Jen vztahy: Plán, Rozpočet, Úkol');
  const e = await drawnEdges(page, GP(page));
  assert.deepEqual([e.length, e.map((x) => x.style)], [2, ['relation', 'relation']], 'two `relation` edges');
  triggers.push(await triggerText(page));
  assert.equal(triggers.at(-1), 'Depth 1 · 7 hidden', '`Depth 1 · 7 hidden`');
  await choosePreset(page, 'Lidé a schůzky');
  await chooseDepth(page, 2, 4);
  assert.equal((await drawnEdges(page, GP(page))).length, 3, 'Lidé a schůzky at depth 2: 3 edges');
  triggers.push(await triggerText(page));
  assert.equal(triggers.at(-1), 'Depth 2 · 15 hidden', '`Depth 2 · 15 hidden`');
  await chooseDepth(page, 1);
  await choosePreset(page, 'Default');
  await needIn(page, 10, 'Default');
  await sleep(300);
  assert.ok(!('preset' in ((await panelStored(core)) ?? {})), 'Default removes `preset` from graph.panel');
  triggers.push(await triggerText(page));
  assert.deepEqual(triggers.filter((t) => !TRIGGER_RE.test(t)), [], `the trigger never names a preset (AP-971): ${JSON.stringify(triggers)}`);
  assert.deepEqual([await graphYml(core), await core.version(GRAPH_YML)], [yml0, ver0], '.tegg/graph.yml keeps its bytes and version throughout');
  assert.equal(await applyCalls(core), 0, 'no graph_presets_apply');
  assert.equal(await fullStored(core), null, 'graph.full never created');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-28

test('fr_grp_02_ac28_panel_and_full_view_modified_separately', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...BEZ }, full: { ...BEZ } });
  await needIn(page, 8, 'Bez štítků in the panel');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), 'the panel: `Preset: Bez štítků`');
  await chooseDepth(page, 2, 14);
  await click(pSizeBox(page), 'Size nodes by links');
  await click(pSizeBox(page), 'Size nodes by links again');
  await chooseDepth(page, 1, 8);
  await closePopover(page);
  await click(pViewBtn(page, 'List'), '`List`');
  await click(pViewBtn(page, 'Graph'), '`Graph`');
  await presetRow(page);
  assert.equal(await notModified(page), true, 'depth, `Size nodes by links` and the view never make it modified');
  await click(pTypeBox(page, 'Tags'), 'tick Tags');
  assert.ok(await isModified(page), '`Bez štítků · modified` after ticking Tags');
  await must(popover(page).getByRole('button', { name: 'Update', exact: true }), '`Update` in the popover');
  await must(popover(page).getByRole('button', { name: 'Revert', exact: true }), '`Revert` in the popover');
  let w0 = (await uiWrites(core)).length;
  await click(revertBtn(page), 'Revert');
  await needIn(page, 8, 'Revert');
  await sleep(300);
  const ws = (await uiWrites(core)).slice(w0) as any[];
  assert.equal(ws.length, 1, 'Revert: one ui_state_set');
  assert.deepEqual(ws[0]?.vaults?.[nfc(VAULT_PATH)]?.graph?.panel?.hiddenTypes, ['tag', 'kniha'], 'of graph.panel');
  assert.equal(await applyCalls(core), 0, 'and no vault write');
  await click(pTypeBox(page, 'Tags'), 'tick Tags again');
  await needIn(page, 10, 'Tags visible');
  w0 = (await uiWrites(core)).length;
  await click(updateBtn(page), 'Update');
  assert.equal(await eventually(() => graphYml(core), (t) => t === expectedText('valid-after-update'), 3000), expectedText('valid-after-update'), 'Update writes expected/valid-after-update.yml');
  assert.equal(await applyCalls(core), 1, 'once');
  assert.ok(await eventually(() => notModified(page), (x) => x, 2000), 'the panel\'s `· modified` disappears');
  assert.deepEqual(await fullStored(core), BEZ, 'graph.full is not written');
  await closePopover(page);
  await click(openFullBtn(page), '`Open full view`');
  await must(graphHeading(page), 'the full view', 5000);
  assert.ok(await presetIs(page, 'Bez štítků') && await isModified(page), 'the full view: `Preset: Bez štítků · modified`');
  assert.equal((await waitDrawn(page, 8, 3000)).length, 8, 'with its own filters (8 drawn: not refiltered)');
  assert.equal(await checked(typeBox(page, 'Tags')), false, 'Tags hidden there');
  await click(revertBtn(page), 'the full view\'s Revert');
  assert.equal((await waitDrawn(page, 10, 3000)).length, 10, 'its Revert draws 10');
  await click(typeBox(page, 'Tags'), 'hide Tags in the full view');
  await click(updateBtn(page), 'the full view\'s Update');
  assert.equal(await eventually(() => applyCalls(core), (n) => n === 2, 3000), 2, 'the full view writes the file');
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on the note');
  await needIn(page, 10, 'the panel\'s filters unchanged');
  await presetRow(page);
  assert.equal((await eventually(() => presetState(page), (s) => s.text.includes('· modified'), 2000)).text, 'Bez štítků · modified', 'the panel shows `Bez štítků · modified`');
  assert.deepEqual((await panelStored(core))?.hiddenTypes, ['kniha'], 'graph.panel\'s filters unchanged');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-29

test('fr_grp_02_ac29_panel_save_rename_and_delete', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await presetRow(page);
  await click(pTypeBox(page, 'Tags'), 'hide Tags');
  await needIn(page, 8, 'Tags hidden');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), '`Save as new preset…`');
  const dlg = await must(saveDialog(page), 'the dialog `Save preset`');
  const db = (await dlg.boundingBox())!, bb = (await presetBtn(page).boundingBox())!;
  assert.ok(gap(db, bb) <= 16, `anchored to the preset button (${JSON.stringify(db)} vs ${JSON.stringify(bb)})`);
  await (await must(nameField(page), 'Name')).fill('Bez štítků');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== undefined, 3000), expectedText('created'), 'expected/created.yml');
  const calls = await core.presetCalls();
  assert.deepEqual([calls.length, calls[0]?.op?.op, calls[0]?.base ?? null], [1, 'save', null], 'one atomic create (no base)');
  assert.deepEqual(await presetWrites(core), [GRAPH_YML], 'one write, .tegg/graph.yml');
  assert.ok(await presetIs(page, 'Bez štítků'), '`Preset: Bez štítků`');
  assert.equal(await eventually(async () => (await panelStored(core))?.preset, (p) => p === 'Bez štítků', 2000), 'Bez štítků', '`preset` stored in graph.panel');
  assert.equal(await fullStored(core), null, 'graph.full stays absent');
});

test('fr_grp_02_ac29_panel_save_rename_and_delete_rename_and_delete', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...JEN }, full: { ...JEN } });
  await needIn(page, 3, 'Jen vztahy');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Jen vztahy'), 'the panel shows Jen vztahy');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Jen vztahy”…'), '`Rename “Jen vztahy”…`');
  let w0 = (await uiWrites(core)).length;
  await (await must(renameField(page), 'the rename field `Preset name`')).fill('Vztahy');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => graphYml(core), (t) => t !== VALID, 3000), setLine(VALID, 7, '  - name: Vztahy'), 'only line 7 changes');
  assert.ok(await presetIs(page, 'Vztahy'), '`Preset: Vztahy`');
  await eventually(async () => (await uiWrites(core)).length, (n) => n > w0, 2000);
  await sleep(200);
  assert.equal((await uiWrites(core)).length - w0, 1, 'one ui_state_set');
  assert.deepEqual([(await fullStored(core))?.preset, (await panelStored(core))?.preset], ['Vztahy', 'Vztahy'], '`preset` updated in both views');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Vztahy”…'), '`Delete “Vztahy”…`');
  w0 = (await uiWrites(core)).length;
  await click((await must(deleteConfirm(page, 'Vztahy'), 'the confirm `Delete “Vztahy”?`')).getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  assert.equal(await eventually(() => graphYml(core), (t) => !t?.includes('Vztahy'), 3000), cut(VALID, 7, 9), 'exactly lines 7–9 removed');
  await needIn(page, 3, 'the panel keeps its filters');
  assert.equal((await eventually(() => presetState(page), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', '`Default · modified`');
  await eventually(async () => (await uiWrites(core)).length, (n) => n > w0, 2000);
  await sleep(200);
  assert.equal((await uiWrites(core)).length - w0, 1, 'one ui_state_set');
  assert.deepEqual([(await fullStored(core))?.preset, (await panelStored(core))?.preset], [undefined, undefined], '`preset` removed from both views');
});

test('fr_grp_02_ac29_panel_save_rename_and_delete_refusals', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...BEZ } });
  await presetRow(page);
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), '`Save as new preset…`');
  const cases: [string, string][] = [
    ['bez ŠTÍTKŮ', 'A preset named “Bez štítků” already exists.'], [' Bez štítků ', 'A preset named “Bez štítků” already exists.'],
    ['Default', 'A preset named “Default” already exists.'], ['ř'.repeat(101), 'Use at most 100 characters.'], ['Lidé\tporady', 'Names can\'t contain control characters.'],
  ];
  for (const [name, msg] of cases) {
    await (await must(nameField(page), 'Name')).fill(name);
    assert.equal(await eventually(() => description(nameField(page)), (d) => d === msg, 1500), msg, `${JSON.stringify(name)}: ${msg}`);
    assert.equal(await isDisabled(saveBtn(page)), true, `${JSON.stringify(name)}: Save disabled`);
    await page.keyboard.press('Enter');
  }
  assert.equal(await applyCalls(core), 0, 'nothing is sent for a refused name');
  await click(cancelBtn(page), 'Cancel');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), '`Save as new preset…`');
  await (await must(nameField(page), 'Name')).fill('Nový');
  await page.keyboard.press('Escape');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Bez štítků”…'), '`Rename “Bez štítků”…`');
  await (await must(renameField(page), 'Preset name')).fill('Bez štítků');
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.deepEqual([await graphYml(core), await presetWrites(core)], [VALID, []], 'nothing written for a refusal, Cancel, Esc or a rename to the same name');
});

test('fr_grp_02_ac29_panel_save_rename_and_delete_nfd_names', async ({ page }) => {
  const nfdValid = VALID.replace(/(- name: )(.*)/g, (_, a: string, b: string) => a + NFD(b));
  const core = await openPanel(page, P.plan, { presets: nfdValid });
  await presetRow(page);
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), '`Save as new preset…`');
  await (await must(nameField(page), 'Name')).fill('Bez štítků');
  assert.equal(await eventually(() => description(nameField(page)), (d) => d.length > 0, 1500), 'A preset named “Bez štítků” already exists.', 'the NFC name is taken by the NFD one');
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [nfdValid, 0], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-30

test('fr_grp_02_ac30_full_view_rename_and_delete_reach_the_panel', async ({ page }) => {
  const panel0 = { preset: 'Jen vztahy', hiddenKinds: ['link', 'embed', 'tag'] };
  const core = await openPanel(page, P.plan, { presets: VALID, panel: panel0, full: { ...JEN } });
  await needIn(page, 3, 'the panel on Jen vztahy');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Jen vztahy'), 'setup: the panel shows Jen vztahy');
  await closePopover(page);
  const toFull = async () => {
    await click(openFullBtn(page), '`Open full view`');
    await must(graphHeading(page), 'the full view', 5000);
    await must(presetBtn(page), 'the full view\'s preset button');
  };
  const back = async () => {
    await page.keyboard.press('Meta+BracketLeft');
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on the note');
    await needIn(page, 3, 'the panel\'s 3 nodes unchanged');
    await presetRow(page);
  };
  await toFull();
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Jen vztahy”…'), 'Rename in the full view');
  await (await must(renameField(page), 'Preset name')).fill('Vztahy');
  await page.keyboard.press('Enter');
  await eventually(() => graphYml(core), (t) => !!t?.includes('- name: Vztahy\n'), 3000);
  await back();
  assert.ok(await presetIs(page, 'Vztahy') && await notModified(page), 'the panel: `Preset: Vztahy` without `· modified`');
  await closePopover(page);
  await toFull();
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Vztahy”…'), 'Delete in the full view');
  await click((await must(deleteConfirm(page, 'Vztahy'), 'the confirm')).getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  await eventually(() => graphYml(core), (t) => !t?.includes('Vztahy'), 3000);
  await back();
  assert.equal((await eventually(() => presetState(page), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', 'the panel: `Default · modified`');
  const ps = (await panelStored(core)) ?? {};
  assert.ok(!('preset' in ps), 'no `preset` in graph.panel');
  assert.deepEqual([ps.hiddenKinds, ps.hiddenTypes], [panel0.hiddenKinds, undefined], 'graph.panel\'s filters are never written');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-31

test('fr_grp_02_ac31_panel_presets_file_states_and_outside_changes', async ({ page }) => {
  const text = presetsText('invalid-yaml');
  const core = await openPanel(page, P.plan, { presets: text, panel: { ...BEZ } });
  const ver0 = await core.version(GRAPH_YML);
  await presetRow(page);
  assert.equal((await eventually(() => presetState(page), (s) => s.name === 'Preset: Default', 2000)).text, 'Default · modified', 'a stored Bez štítků shows `Default · modified`');
  assert.equal((await uiWrites(core)).length, 0, 'and isn\'t rewritten');
  await openPresetMenu(page);
  const items = await menuItems(page);
  assert.deepEqual(items.filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default'], 'the menu holds Default');
  assert.ok(flat(await presetMenu(page).innerText()).includes('The presets file can\'t be read (line 5).'), 'and the line `The presets file can\'t be read (line 5).`');
  const save = items.find((i) => i.name === 'Save as new preset…');
  assert.deepEqual([save?.disabled, save?.desc], [true, 'Fix .tegg/graph.yml to save presets.'], 'the editing items aria-disabled with `Fix .tegg/graph.yml to save presets.`');
  await click(menuRadio(page, 'Default'), 'apply Default');
  await needIn(page, 10, 'Default applies');
  await click(pTypeBox(page, 'Tags'), 'a filter change');
  await needIn(page, 8, 'a filter change works');
  assert.deepEqual([await graphYml(core), await core.version(GRAPH_YML), await applyCalls(core)], [text, ver0, 0], '.tegg/graph.yml keeps its bytes and version');
});

test('fr_grp_02_ac31_panel_presets_file_states_and_outside_changes_newer', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: presetsText('newer-version') });
  await presetRow(page);
  await choosePreset(page, 'Bez štítků');
  await needIn(page, 8, 'the newer file\'s preset applies');
  await openPresetMenu(page);
  const items = await menuItems(page);
  for (const n of ['Save as new preset…', 'Update “Bez štítků”', 'Rename “Bez štítků”…', 'Delete “Bez štítků”…']) {
    const i = items.find((x) => x.name === n);
    assert.deepEqual([i?.disabled, i?.desc], [true, 'Made by a newer version of Tegg. Read-only.'], `${n}: aria-disabled, read-only`);
  }
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [presetsText('newer-version'), 0], 'the file keeps its bytes');
});

test('fr_grp_02_ac31_panel_presets_file_states_and_outside_changes_outside', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...BEZ } });
  await needIn(page, 8, 'Bez štítků');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Bez štítků'), 'the popover open on Bez štítků');
  const g0 = (await core.graphCalls()).length;
  await core.setFile(GRAPH_YML, `${VALID}  - name: Nová zvenku\n    hidden-types: []\n    hidden-kinds: [tag]\n`);
  await sleep(300);
  await openPresetMenu(page);
  await must(menuRadio(page, 'Nová zvenku'), 'another program\'s new preset is listed within 2 s', 2000);
  await page.keyboard.press('Escape');
  await core.setFile(GRAPH_YML, VALID.replace('hidden-types: [tag, kniha]', 'hidden-types: [page]'));
  assert.ok(await isModified(page), 'a changed Bez štítků shows `· modified` within 2 s');
  await needIn(page, 8, 'the panel\'s 8 nodes stay');
  assert.equal((await core.graphCalls()).length, g0, 'no graph_neighbourhood call follows a change to graph.yml alone');
  assert.ok(await seen(popover(page), 200), 'the popover stays open');
  await click(revertBtn(page), 'Revert');
  await needIn(page, 9, 'Revert applies [page]');
  const g1 = (await core.graphCalls()).length;
  await core.setFile(GRAPH_YML, null);
  await sleep(600);
  await openPresetMenu(page);
  assert.deepEqual((await menuItems(page)).filter((i) => i.role === 'menuitemradio').map((i) => i.name.replace(/\s*built-in$/, '')), ['Default'], 'the file deleted: Default only');
  await page.keyboard.press('Escape');
  assert.deepEqual([await graphYml(core), (await core.graphCalls()).length], [undefined, g1], 'nothing is created, no graph request');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-32

test('fr_grp_02_ac32_panel_preset_and_view_remembered', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { preset: 'Bez štítků', hiddenTypes: ['tag', 'kniha'], view: 'list' } });
  await must(pListTree(page), 'the panel opens Plán in List');
  assert.equal(await eventually(async () => (await pRows(page)).length, (n) => n === 8, 3000), 8, 'with the preset\'s 8 rows');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Bez štítků') && await notModified(page), '`Preset: Bez štítků` without `· modified`');
  await closePopover(page);
  assert.equal((await uiWrites(core)).length, 0, 'nothing rewritten on open');
  await searchOpen(page, 'Rozpočet 2027');
  await must(pListTree(page), 'opening another note keeps the List');
  await presetRow(page);
  assert.ok(await presetIs(page, 'Bez štítků'), 'and the preset');
});

for (const [what, stored, want, modified] of [
  ['missing_preset', { hiddenTypes: ['tag'] }, 'Default', true],
  ['name_not_listed', { hiddenTypes: ['page'], hiddenKinds: [], preset: 'Smazaný' }, 'Default', true],
  ['case_insensitive', { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [], preset: 'bez štítků' }, 'Bez štítků', false],
] as const) {
  test(`fr_grp_02_ac32_panel_preset_and_view_remembered_${what}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { presets: VALID, panel: stored as any });
    await presetRow(page);
    assert.ok(await presetIs(page, want), `\`Preset: ${want}\``);
    assert.equal((await presetState(page)).text.includes('· modified'), modified, `${modified ? 'with' : 'without'} \`· modified\``);
    assert.equal((await uiWrites(core)).length, 0, 'not rewritten on open');
    await click(pTypeBox(page, 'Pages'), 'a filter change');
    assert.ok((await eventually(async () => (await uiWrites(core)).length, (n) => n > 0, 2000)) > 0, 'written once the user changes a filter');
  });
}

test('fr_grp_02_ac32_panel_preset_and_view_remembered_unknown_view_and_other_vault', async ({ page, browser }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { view: 'tabulka' } });
  assert.equal(await (await must(pViewBtn(page, 'Graph'), 'the panel\'s `Graph` button')).getAttribute('aria-pressed'), 'true', 'an unknown view reads as Graph');
  await must(pCanvas(page), 'the canvas');
  await sleep(300);
  assert.equal((await uiWrites(core)).length, 0, 'and isn\'t rewritten');
  const p2 = await browser.newPage();
  const other = { vaultKey: '/fake/Jiný', panel: { preset: 'Bez štítků', hiddenTypes: ['tag', 'kniha'], view: 'list' } };
  await openPanel(p2, P.plan, { presets: VALID, ...other });
  assert.equal(await (await must(pViewBtn(p2, 'Graph'), '`Graph`')).getAttribute('aria-pressed'), 'true', 'another vault\'s panel view doesn\'t apply here');
  await presetRow(p2);
  assert.ok(await presetIs(p2, 'Default'), 'nor its preset');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-33

test('fr_grp_02_ac33_panel_preset_layers_and_escape', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...BEZ } });
  await presetRow(page);
  await openPresetMenu(page);
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(presetMenu(page), 400)) && await seen(popover(page), 300), 'Esc in the menu closes the menu only');
  assert.ok(await onPresetBtn(page), 'the focus on the preset button');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(popover(page), 400)), 'a second Esc closes the popover');
  assert.equal(await trigger(page).evaluate((e) => e === document.activeElement), true, 'the focus on the trigger');
  await presetRow(page);
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await must(saveDialog(page), 'the Save dialog');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(saveDialog(page), 400)) && await seen(popover(page), 300), 'Esc in the Save dialog cancels it, the popover stays');
  assert.ok(await onPresetBtn(page), 'the focus on the preset button');
  await openPresetMenu(page);
  await click(menuItem(page, 'Rename “Bez štítků”…'), 'Rename');
  await (await must(renameField(page), 'the rename field')).fill('Jiné');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(renameField(page), 400)) && await seen(popover(page), 300), 'Esc in the rename field cancels, the popover stays');
  for (const how of ['Cancel', 'Escape'] as const) {
    await openPresetMenu(page);
    await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete');
    const dlg = await must(deleteConfirm(page, 'Bez štítků'), 'the delete confirm');
    if (how === 'Cancel') await click(dlg.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
    else await page.keyboard.press('Escape');
    assert.ok(!(await seen(deleteConfirm(page, 'Bez štítků'), 400)) && await seen(popover(page), 300), `${how} closes the delete confirm, the popover stays`);
  }
  // A pointer press inside a preset layer is not a click outside the popover.
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  const sd = await must(saveDialog(page), 'the Save dialog');
  const note = await must(sd.getByText('Saves the types and connection kinds. Depth is not part of a preset.', { exact: true }), 'the dialog\'s note');
  await note.click();
  assert.ok(await seen(saveDialog(page), 300) && await seen(popover(page), 300), 'a press in the Save dialog keeps both open');
  await page.keyboard.press('Escape');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete');
  const dc = await must(deleteConfirm(page, 'Bez štítků'), 'the delete confirm');
  await (await must(dc.getByText(/^The graph keeps its current filters\./), 'its text')).click();
  assert.ok(await seen(deleteConfirm(page, 'Bez štítků'), 300) && await seen(popover(page), 300), 'a press in the delete confirm keeps both open');
  await page.mouse.click(400, 500);
  assert.ok(!(await seen(deleteConfirm(page, 'Bez štítků'), 500)) && !(await seen(popover(page), 300)), 'a press outside the popover and its layers closes all of them');
  assert.deepEqual([await graphYml(core), await applyCalls(core)], [VALID, 0], 'nothing written');
});

test('fr_grp_02_ac33_panel_preset_layers_and_escape_closing', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...BEZ } });
  const typed = async () => {
    if (!(await seen(ctxPanel(page), 300))) await page.keyboard.press('Meta+Backslash');
    await must(pCanvas(page), 'the panel graph', 4000);
    await presetRow(page);
    await openPresetMenu(page);
    await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
    await (await must(nameField(page), 'Name')).fill('Rozepsaný');
  };
  const allClosed = async (what: string) => {
    assert.ok(!(await seen(saveDialog(page), 600)), `${what}: the Save dialog closes`);
    assert.ok(!(await seen(popover(page), 300)), `${what}: the popover closes`);
    assert.deepEqual([await graphYml(core), await applyCalls(core)], [VALID, 0], `${what}: nothing written`);
  };
  await typed();
  await page.keyboard.press('Meta+Backslash');
  await allClosed('⌘\\');
  await typed();
  await searchOpen(page, 'Výdaje 2026');
  await allClosed('a route change (Search, ⏎)');
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000);
  await typed();
  await click(backlinksTab(page), 'tab "Backlinks"');
  await allClosed('a tab change');
});

test('fr_grp_02_ac33_panel_preset_layers_and_escape_narrow_window', async ({ page }) => {
  await startPanel(page, noteRoute(P.plan), { presets: VALID, panel: { ...BEZ }, sidebarOpen: false, frame: 'none', width: 240 });
  await page.setViewportSize({ width: 800, height: 500 });
  await must(pCanvas(page), 'the panel graph at 800 × 500', 5000);
  const inside = async (loc: ReturnType<typeof popover>, what: string) => {
    const b = (await (await must(loc, what)).boundingBox())!;
    assert.ok(insideWindow(b, 800, 500), `${what} lies inside the window with 8 px: ${JSON.stringify(b)}`);
  };
  await presetRow(page);
  await inside(popover(page), 'the popover');
  await openPresetMenu(page);
  await inside(presetMenu(page), 'the menu');
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await inside(saveDialog(page), 'the Save dialog');
  await page.keyboard.press('Escape');
  await openPresetMenu(page);
  await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete');
  await inside(deleteConfirm(page, 'Bez štítků'), 'the delete confirm');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-25

const THEIRS = `${VALID}  - name: Cizí\n    hidden-types: [page]\n    hidden-kinds: []\n`;
const CHANGED = 'Presets changed outside Tegg. Your change wasn\'t saved.';
for (const op of ['save', 'update', 'rename', 'delete'] as const) {
  test(`fr_syn_03_ac25_panel_preset_writes_check_the_base_${op}`, async ({ page }) => {
    const core = await openPanel(page, P.plan, { presets: VALID, panel: { ...JEN } });
    await needIn(page, 3, 'Jen vztahy');
    await presetRow(page);
    assert.ok(await presetIs(page, 'Jen vztahy'), 'the panel read the file (setup)');
    const ver0 = await core.version(GRAPH_YML);
    await core.setFile(GRAPH_YML, THEIRS, { silent: true }); // changed on disk without vault:changed (D-1110)
    if (op === 'save') {
      await saveAs(page, 'Moje');
    } else if (op === 'update') {
      await click(pKindBox(page, 'Links'), 'show Links');
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
    await must(popover(page).getByText(CHANGED, { exact: true }), `\`${CHANGED}\` in the popover`, 3000);
    assert.equal(await graphYml(core), THEIRS, 'nothing written: the disk bytes stay');
    const calls = await core.presetCalls();
    assert.equal(calls.length, 1, 'one graph_presets_apply');
    assert.deepEqual(calls[0].base, ver0, 'its base is the version of the panel\'s last graph_presets_get');
    const st = (await panelStored(core)) ?? {};
    if (op !== 'update') await needIn(page, 3, 'the panel\'s filters never change');
    assert.deepEqual(st.hiddenKinds, op === 'update' ? ['embed', 'tag'] : JEN.hiddenKinds, 'graph.panel\'s filters as the user left them');
    if (op === 'rename') assert.ok(!(await seen(renameField(page), 300)), 'the rename field closes (D-1125)');
    if (op === 'save') {
      const f = await must(nameField(page), 'the Save dialog stays open');
      assert.equal(await f.inputValue(), 'Moje', 'with the typed name');
      await page.keyboard.press('Enter');
      const t = await eventually(() => graphYml(core), (x) => !!x?.includes('- name: Moje'), 3000);
      assert.ok(t?.includes('- name: Cizí') && t.includes('- name: Moje'), 'a second Save writes on top of the new version: both presets');
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      await openPresetMenu(page);
      await must(menuRadio(page, 'Cizí'), 'the menu reloads from disk');
    }
  });
}

test('fr_syn_03_ac25_panel_preset_writes_check_the_base_mtime_only', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID });
  await presetRow(page);
  await click(pTypeBox(page, 'Pages'), 'hide Pages');
  await core.setFile(GRAPH_YML, VALID, { silent: true, sameBytesTouch: true });
  await saveAs(page, 'Moje');
  assert.ok((await eventually(() => graphYml(core), (t) => !!t?.includes('- name: Moje'), 3000))?.includes('- name: Moje'), 'a change of the mtime only is not a conflict');
  assert.ok(!(await seen(popover(page).getByText(CHANGED, { exact: true }), 300)), 'no alert');
});

test('fr_syn_03_ac25_panel_preset_writes_check_the_base_no_base', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await presetRow(page);
  await click(pTypeBox(page, 'Tags'), 'hide Tags');
  await openPresetMenu(page);
  await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
  await (await must(nameField(page), 'Name')).fill('Bez štítků');
  await core.setFile(GRAPH_YML, VALID, { silent: true }); // another program creates the file before the panel's first Save
  await page.keyboard.press('Enter');
  await must(popover(page).getByText(CHANGED, { exact: true }), 'refused with the alert in the popover', 3000);
  assert.equal((await core.presetCalls())[0]?.base ?? null, null, 'the save had no base (RENAME_EXCL)');
  assert.equal(await graphYml(core), VALID, 'that file stays byte for byte');
});

test('fr_syn_03_ac25_panel_preset_writes_check_the_base_after_a_full_view_save', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID });
  await presetRow(page);
  await closePopover(page);
  await click(openFullBtn(page), '`Open full view`');
  await must(graphHeading(page), 'the full view', 5000);
  await click(typeBox(page, 'Tags'), 'hide Tags in the full view');
  await saveAs(page, 'Z plného');
  await eventually(() => graphYml(core), (t) => !!t?.includes('- name: Z plného'), 3000);
  const v1 = await core.version(GRAPH_YML);
  await page.keyboard.press('Meta+BracketLeft');
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000), 'Plán čtvrtletí', 'Back on the note');
  await presetRow(page);
  await click(pTypeBox(page, 'Pages'), 'hide Pages in the panel');
  await saveAs(page, 'Moje');
  const t = await eventually(() => graphYml(core), (x) => !!x?.includes('- name: Moje'), 3000);
  assert.ok(t?.includes('- name: Z plného') && t.includes('- name: Moje'), 'the panel\'s save succeeds: the file holds both presets');
  assert.ok(!(await seen(popover(page).getByText(CHANGED, { exact: true }), 300)), 'without `Conflict`');
  assert.deepEqual((await core.presetCalls())[1]?.base, v1, 'the panel\'s base is re-read (the version after the full view\'s write)');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-41 (L5)

test('fr_syn_06_ac41_panel_only_preset_actions_write', async ({ page }) => {
  const core = await openPanel(page, P.plan, { presets: VALID, hoverDelay: 400 });
  const files0 = JSON.stringify(await core.files());
  await presetRow(page);
  for (const n of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Default', 'Bez štítků']) await choosePreset(page, n);
  await click(pTypeBox(page, 'Tags'), 'tick Tags');
  await click(revertBtn(page), 'Revert');
  for (const [layer, item] of [['Save', 'Save as new preset…'], ['Rename', 'Rename “Bez štítků”…'], ['Delete', 'Delete “Bez štítků”…']] as const) {
    await openPresetMenu(page);
    await click(menuItem(page, item), item);
    await sleep(150);
    await page.keyboard.press('Escape');
    assert.ok(await seen(popover(page), 300), `${layer}: cancelled`);
  }
  await closePopover(page);
  await click(pViewBtn(page, 'List'), 'List');
  await must(pListTree(page), 'the List');
  for (const k of ['ArrowDown', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) { await pListTree(page).getByRole('treeitem').first().focus().catch(() => {}); await page.keyboard.press(k); }
  await click(pViewBtn(page, 'Graph'), 'Graph');
  await must(pCanvas(page), 'the canvas');
  await click(openFullBtn(page), '`Open full view`');
  await must(graphHeading(page), 'the full view', 5000);
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 4000);
  assert.deepEqual([await applyCalls(core), await presetWrites(core), await core.writes()], [0, [], 0], 'the tour sends no graph_presets_apply and writes nothing');
  assert.equal(JSON.stringify(await core.files()), files0, 'every vault file as before (no Tags/nápad.md, no Daily/2026-10-30.md)');
  const step = async (what: string, f: () => Promise<void>) => {
    const c0 = await applyCalls(core), w0 = (await presetWrites(core)).length;
    await f();
    await eventually(() => presetWrites(core), (w) => w.length > w0, 3000);
    await sleep(200);
    assert.equal((await applyCalls(core)) - c0, 1, `${what}: one graph_presets_apply`);
    assert.deepEqual((await presetWrites(core)).slice(w0), [GRAPH_YML], `${what}: exactly one write, .tegg/graph.yml`);
  };
  await presetRow(page);
  await click(pTypeBox(page, 'Pages'), 'hide Pages');
  await step('Save as', () => saveAs(page, 'Moje'));
  await click(pTypeBox(page, 'Tasks'), 'hide Tasks');
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
  assert.ok(!Object.keys(await core.files()).some((p) => p === 'Tags/nápad.md' || p === 'Daily/2026-10-30.md'), 'nothing else created');
});
