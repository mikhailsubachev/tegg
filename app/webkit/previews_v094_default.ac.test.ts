// v0.94 feedback (D-1164, D-1172), L5 (WebKit + fake core): hover is the default preview mode. docs/acceptance/previews.md
// part three, FR-LNK-12 AC-19 (hover with 1,000 ms in a new Application Support, the R104 hover column with nothing
// stored, no `preview` key written on launch), AC-20 (a stored value stays; no migration; T2), FR-SET-07 AC-6 (the radio
// order and the default), AC-7 (a bad stored mode reads as hover and isn't rewritten on launch), AC-8 (choosing what is
// already in effect writes nothing), FR-SYN-06 AC-42 (the v0.94 tour writes nothing; T1 check). "Nothing stored" is a UI
// state without a `preview` key (previews.md part three's test rule). Interface docs/contracts/v1-previews.md §1
// (`UiStateDto.preview`, `ui_state_set`), §4 (Settings › Previews), §6 (palette), v1-graph §15 (the panel). Written from the
// ACs and the contracts only (D-61); every lookup goes through `need`/`must` and node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { canvas as fullCanvas } from './graph-helpers';
import { pCanvas } from './graph-panel-helpers';
import { goToQuery, paletteOptions } from './helpers';
import { previewOfSet, uiSets, wordPoint } from './previews-editor-helpers';
import {
  PV, ZONE, back, backlinksPanel, chipNamed, content, description, editorBody, eventually, focusInfo, frame, linkEmbed, main, mainName, mapNode,
  mark, mindmapFigure, mustBeOn, need, needAnyPreview, needClosed, needOdkazyLink, needPreview, nfc, previewCount, previewPath, props,
  readArticle, runCommand, searchFor, sleep, snapshot, startPreviews, taskCard, topEmbed, typeTable, ui, type FakeCoreHandle, type PreviewUi,
  type PreviewsStart,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

const HOVER = 'Hover to preview, click to open';
const CLICK = 'Click to preview, double-click to open';
const OFF = 'Off: click opens';
const group = (page: Page) => main(page).getByRole('radiogroup', { name: 'Object preview', exact: true });
const radio = (page: Page, name: string) => group(page).getByRole('radio', { name, exact: true });
const slider = (page: Page) => main(page).getByRole('slider', { name: 'Hover delay', exact: true });

async function gotoSettings(page: Page, what: string): Promise<Locator> {
  await runCommand(page, 'Go to Settings: Previews');
  await need(main(page).getByRole('heading', { name: 'Previews', exact: true }), `${what}: heading "Previews"`, 5000);
  return need(group(page), `${what}: radiogroup "Object preview"`, 2000);
}
async function checkedRadios(page: Page): Promise<string[]> {
  return group(page).first().evaluate((g) => ([...g.querySelectorAll('[role="radio"], input[type="radio"]')] as HTMLElement[])
    .filter((r) => (r as HTMLInputElement).checked === true || r.getAttribute('aria-checked') === 'true')
    .map((r) => {
      const id = r.getAttribute('aria-labelledby');
      return (r.getAttribute('aria-label') ?? (id ? document.getElementById(id)?.textContent : null) ?? (r as HTMLInputElement).labels?.[0]?.textContent ?? r.textContent ?? '').replace(/\s+/g, ' ').trim();
    }));
}
async function radioNames(page: Page): Promise<string[]> {
  return group(page).first().evaluate((g) => ([...g.querySelectorAll('[role="radio"], input[type="radio"]')] as HTMLElement[]).map((r) => {
    const id = r.getAttribute('aria-labelledby');
    return (r.getAttribute('aria-label') ?? (id ? document.getElementById(id)?.textContent : null) ?? (r as HTMLInputElement).labels?.[0]?.textContent ?? r.textContent ?? '').replace(/\s+/g, ' ').trim();
  }));
}
async function sliderState(page: Page) {
  const s = await need(slider(page), 'slider "Hover delay"', 2000);
  return s.evaluate((e) => ({
    now: e.getAttribute('aria-valuenow') ?? (e as HTMLInputElement).value ?? null,
    text: e.getAttribute('aria-valuetext'),
    disabled: e.getAttribute('aria-disabled') === 'true' || (e as HTMLInputElement).disabled === true,
  }));
}
/** Every `ui_state_set` since `from` whose state carries a `preview` key. */
async function previewSets(core: FakeCoreHandle, from = 0) {
  return (await uiSets(core, from)).filter((c) => previewOfSet(c) !== undefined || 'preview' in (((c.args as any)?.state ?? {}) as object));
}
const PAUSE = async (page: Page) => { const t = await page.evaluate(() => Date.now()); await page.clock.pauseAt(new Date(t + 1000)); };
const tick = async (page: Page, ms: number) => { await page.clock.runFor(ms); await sleep(120); };

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-19

test('fr_lnk_12_ac19_settings_show_hover_and_1000_ms_with_nothing_stored', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy });
  await gotoSettings(page, 'nothing stored');
  assert.deepEqual(await checkedRadios(page), [HOVER], '`Hover to preview, click to open` is checked (D-1164)');
  const s = await sliderState(page);
  assert.deepEqual(s, { now: '1000', text: '1000 ms', disabled: false }, 'the slider Hover delay is enabled at 1000, "1000 ms"');
});

test('fr_lnk_12_ac19_hover_with_1000_ms_in_odkazy_with_nothing_stored', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, install: true });
  await PAUSE(page);
  const chip = await needOdkazyLink(page, 'Hlavní');
  assert.equal(await description(chip), HOVER, 'the chip\'s description is `Hover to preview, click to open` (FR-LNK-11 AC-13)');
  const b = (await chip.boundingBox())!;
  await page.mouse.move(b.x + 3, b.y + b.height / 2);
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await tick(page, 940);
  assert.equal(await previewCount(page), 0, 'not at 950 ms after the pointer stopped');
  await tick(page, 120);
  const d = await needPreview(page, 'Rozpočet 2027', 'shown 1,000 ms (± 50 ms) after the pointer stopped');
  assert.ok((await d.innerText()).includes('Click or ⌘↩ to open'), 'the footer hint `Click or ⌘↩ to open`');
  await page.mouse.move(1430, 890);
  await tick(page, 400);
  await needClosed(page, 'leaving hides it');
  await page.clock.resume();
  const n0 = await mark(core);
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'a single click on the chip opens note/Pages/Rozpočet 2027.md', 5000);
  assert.deepEqual((await core.calls()).slice(n0).filter((c) => c.cmd === 'nav_opened').map((c) => nfc(String((c.args as any)?.path ?? ''))), [nfc(PV.rozpocet)], 'one nav_opened');
});

test('fr_lnk_12_ac19_launching_writes_no_preview_key', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  await sleep(1500);
  assert.deepEqual(await previewSets(core), [], 'launching sends no ui_state_set with a `preview` key');
  assert.equal((await core.uiState())?.preview, undefined, 'the UI state still has no `preview` key afterwards');
});

/** The R104 rows of slice P's parameterized suite (previews_modes.ac.test.ts), without row 3 (embeds, D-1166). */
type Row = { n: number; name: string; start: PreviewsStart; go?: (p: Page) => Promise<void>; ref: (p: Page) => Promise<Locator>; title: string; path: string; opened: (p: Page, how: string) => Promise<void> };
const onNote = (title: string) => async (page: Page, how: string) => mustBeOn(page, nfc(title), `${how}: opens ${title}`, 5000);
const onTag = async (page: Page, how: string) => { await need(main(page).getByRole('heading', { level: 1, name: /^#?Účty$/ }), `${how}: opens tag/účty`, 5000); };
const ROWS: Row[] = [
  { n: 1, name: 'editor_body', start: { at: PV.odkazy }, ref: (p) => needOdkazyLink(p, 'Hlavní'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027') },
  { n: 2, name: 'read_view', start: { at: PV.odkazy, readView: true }, ref: (p) => needOdkazyLink(p, 'Hlavní'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027') },
  { n: 4, name: 'attribute_relation_chip', start: { at: PV.alfa }, ref: (p) => need(chipNamed(props(p), 'Jana Nováková'), 'relation chip Jana'), title: 'Jana Nováková', path: PV.jana, opened: onNote('Jana Nováková') },
  { n: 5, name: 'backlinks_chip', start: { at: PV.rozpocet, panel: true }, ref: (p) => need(chipNamed(backlinksPanel(p), 'Odkazy'), 'backlinks chip Odkazy'), title: 'Odkazy', path: PV.odkazy, opened: onNote('Odkazy') },
  { n: 6, name: 'task_source_chip', start: { route: 'tasks' }, ref: (p) => need(taskCard(p, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'source chip'), title: 'Porada 2026-10-27', path: PV.porada, opened: onNote('Porada 2026-10-27') },
  { n: 7, name: 'task_card_title', start: { route: 'tasks' }, ref: (p) => need(taskCard(p, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'card title'), title: 'Zavolat Janě', path: PV.ukol, opened: onNote('Zavolat Janě') },
  { n: 8, name: 'search_result_row', start: { at: PV.odkazy }, go: async (p) => { await searchFor(p, 'rozpočet', 'Rozpočet 2027'); }, ref: (p) => need(p.getByRole('list', { name: 'Search results', exact: true }).getByRole('listitem').filter({ hasText: 'Rozpočet 2027' }), 'result row'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027') },
  { n: 9, name: 'type_page_row', start: { route: 'type/osoba' }, ref: (p) => need(typeTable(p, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'row Petr'), title: 'Petr Dvořák', path: PV.petr, opened: onNote('Petr Dvořák') },
  { n: 10, name: 'inbox_card_title', start: { route: 'inbox' }, ref: (p) => need(main(p).getByRole('link', { name: 'Nápad na podcast', exact: true }), 'Inbox card title'), title: 'Nápad na podcast', path: PV.napad, opened: onNote('Nápad na podcast') },
  { n: 11, name: 'mindmap_node_chip', start: { at: PV.mapa }, ref: async (p) => need(mapNode(await need(mindmapFigure(p, 'Plán 2027'), 'figure'), 'Rozpočet 2027').getByRole('link').first(), 'node chip'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027') },
  { n: 12, name: 'tag_chip', start: { at: PV.odkazy, readView: true }, ref: (p) => need(readArticle(p, 'Odkazy').getByRole('link', { name: '#účty', exact: true }), 'tag chip #účty'), title: '#Účty', path: PV.ucty, opened: onTag },
];

for (const row of ROWS) {
  test(`fr_lnk_12_ac19_hover_row${String(row.n).padStart(2, '0')}_${row.name}_with_nothing_stored`, async ({ page }) => {
    await startPreviews(page, row.start);
    if (row.go) await row.go(page);
    const tag = `nothing stored, row ${row.n} ${row.name}`;
    let ref = await row.ref(page);
    await ref.scrollIntoViewIfNeeded();
    const before = await focusInfo(page);
    const b = (await ref.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    await sleep(800);
    assert.equal(await previewCount(page), 0, `${tag}: not before the 1,000 ms delay`);
    const d = await needPreview(page, row.title, `${tag}: the pointer resting for the delay previews (hover is the default)`, 2500);
    assert.equal(await previewPath(d), nfc(row.path), `${tag}: the right object`);
    assert.deepEqual(await focusInfo(page), before, `${tag}: the focus never moves in hover mode`);
    await page.mouse.move(2, 880);
    await needClosed(page, `${tag}: leaving both hides it`, 2000);
    ref = await row.ref(page);
    await ref.click();
    await row.opened(page, `${tag}: a single click opens`);
    assert.equal(await previewCount(page), 0, `${tag}: no preview after the click`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-20

type Stored = { name: string; preview: PreviewUi; checked: string; delay: string; disabled: boolean; size?: { width: number; height: number } };
const STORED: Stored[] = [
  { name: 'click', preview: { mode: 'click' }, checked: CLICK, delay: '1000', disabled: true },
  { name: 'off', preview: { mode: 'off' }, checked: OFF, delay: '1000', disabled: true },
  { name: 'hover_400', preview: { mode: 'hover', hoverDelay: 400 }, checked: HOVER, delay: '400', disabled: false },
  { name: 'delay_600_only', preview: { hoverDelay: 600 }, checked: HOVER, delay: '600', disabled: false },
  { name: 'hover_only', preview: { mode: 'hover' }, checked: HOVER, delay: '1000', disabled: false },
  { name: 'size_only', preview: { width: 500, height: 300 }, checked: HOVER, delay: '1000', disabled: false, size: { width: 500, height: 300 } },
];

for (const s of STORED) {
  test(`fr_lnk_12_ac20_a_stored_value_stays_${s.name}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, readView: true, uiState: ui({ preview: s.preview }) });
    if (s.size) {
      await (await needOdkazyLink(page, 'Hlavní')).focus();
      await page.keyboard.press('Alt+Space');
      const d = await needPreview(page, 'Rozpočet 2027', `${s.name}: ⌥Space`);
      const bx = (await d.boundingBox())!;
      assert.ok(Math.abs(bx.width - 500) <= 1 && Math.abs(bx.height - 300) <= 1, `${s.name}: the popover at the stored 500 × 300 (got ${bx.width} × ${bx.height})`);
      await page.keyboard.press('Escape');
      await needClosed(page, `${s.name}: Esc`);
    }
    await gotoSettings(page, s.name);
    assert.deepEqual(await checkedRadios(page), [s.checked], `${s.name}: ${JSON.stringify(s.preview)} reads as ${s.checked}`);
    const st = await sliderState(page);
    assert.deepEqual({ now: st.now, disabled: st.disabled }, { now: s.delay, disabled: s.disabled }, `${s.name}: the slider at ${s.delay}${s.disabled ? ', aria-disabled' : ''}`);
    const rewrites = (await uiSets(core)).filter((c) => JSON.stringify(previewOfSet(c) ?? null) !== JSON.stringify(s.preview));
    assert.deepEqual(rewrites.map((c) => previewOfSet(c) ?? null), [], `${s.name}: \`preview\` is not rewritten before the user changes the setting (no migration)`);
    // The first change writes only the changed field, keeping the others as stored (FR-SET-07 AC-3's rule).
    const next = s.checked === OFF ? CLICK : OFF;
    const nextMode = next === OFF ? 'off' : 'click';
    const from = (await uiSets(core)).length;
    await (await need(radio(page, next), `${s.name}: radio ${next}`)).click();
    const sets = await eventually(() => uiSets(core, from), (x) => x.length > 0, 2000);
    assert.equal(sets.length, 1, `${s.name}: the change writes once`);
    assert.deepEqual(previewOfSet(sets[0]), { ...s.preview, mode: nextMode }, `${s.name}: only the mode changes, the other stored fields stay`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-6

test('fr_set_07_ac6_the_order_and_the_default', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  await gotoSettings(page, 'nothing stored');
  assert.deepEqual(await radioNames(page), [HOVER, CLICK, OFF], 'the radios in DOM and accessibility order: Hover, Click, Off (D-1164)');
  assert.deepEqual(await checkedRadios(page), [HOVER], 'the first is checked');
  const stop = await group(page).first().evaluate((g) => ([...g.querySelectorAll('[role="radio"], input[type="radio"]')] as HTMLElement[]).filter((r) => r.tabIndex === 0).map((r) => r.getAttribute('aria-label') ?? (r as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? r.textContent?.trim() ?? ''));
  assert.deepEqual(stop.map((x) => x.replace(/\s+/g, ' ').trim()), [HOVER], 'and it is the radiogroup\'s tab stop');
  assert.deepEqual(await sliderState(page), { now: '1000', text: '1000 ms', disabled: false }, 'the slider is enabled at 1000');
  await (await need(radio(page, HOVER), 'radio Hover')).focus();
  for (const want of [CLICK, OFF, HOVER]) {
    // D-1194: `uiSets` takes a call index, so the press's writes are counted from the calls made so far.
    const from = (await core.calls()).length;
    await page.keyboard.press('ArrowDown');
    const sets = await eventually(() => uiSets(core, from), (x) => x.length > 0, 2000);
    assert.deepEqual(await checkedRadios(page), [want], `↓ checks ${want}`);
    assert.equal(sets.length, 1, `↓ to ${want} writes once`);
  }
  await page.keyboard.press('Meta+k');
  await need(page.getByRole('dialog', { name: 'Command palette' }), 'the palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Object preview:');
  await sleep(300);
  const opts = (await paletteOptions(page)).map((t) => t.replace(/\s+/g, ' ').trim());
  for (const c of ['Object preview: Click to preview', 'Object preview: Hover to preview', 'Object preview: Off']) {
    assert.ok(opts.some((o) => o.startsWith(c)), `the palette lists ${c} (R106): ${JSON.stringify(opts)}`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-7 (L5)

for (const [name, bad] of [['sometimes', 'sometimes'], ['number_1', 1], ['null', null]] as const) {
  test(`fr_set_07_ac7_a_bad_stored_mode_reads_as_hover_and_is_not_rewritten_${name}`, async ({ page }) => {
    const stored = { mode: bad } as unknown as PreviewUi;
    const core = await startPreviews(page, { at: PV.odkazy, uiState: ui({ preview: stored }) });
    await gotoSettings(page, `stored mode ${JSON.stringify(bad)}`);
    assert.deepEqual(await checkedRadios(page), [HOVER], `a stored mode ${JSON.stringify(bad)} reads as hover, the default (D-1172)`);
    await sleep(500);
    const rewrites = (await uiSets(core)).filter((c) => JSON.stringify(previewOfSet(c) ?? null) !== JSON.stringify(stored));
    assert.deepEqual(rewrites.map((c) => previewOfSet(c) ?? null), [], 'it is not rewritten on launch');
  });
}

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-8

test('fr_set_07_ac8_choosing_what_is_already_in_effect_writes_nothing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  await gotoSettings(page, 'nothing stored');
  let from = (await uiSets(core)).length;
  await (await need(radio(page, HOVER), 'radio Hover')).click();
  await sleep(500);
  assert.deepEqual(await uiSets(core, from), [], 'choosing `Hover to preview, click to open` with nothing stored sends no ui_state_set');
  assert.equal((await core.uiState())?.preview, undefined, 'and stores nothing');
  await runCommand(page, 'Object preview: Hover to preview');
  await sleep(500);
  assert.deepEqual(await uiSets(core, from), [], '`Object preview: Hover to preview` sends none either');
  await gotoSettings(page, 'back on Settings');
  from = (await uiSets(core)).length;
  await (await need(radio(page, CLICK), 'radio Click')).click();
  const sets = await eventually(() => uiSets(core, from), (x) => x.length > 0, 2000);
  assert.equal(sets.length, 1, 'choosing Click to preview writes once');
  assert.deepEqual(previewOfSet(sets[0]), { mode: 'click' }, 'preview.mode = click');
});

test('fr_set_07_ac8_moving_the_slider_with_nothing_stored_writes_only_the_delay', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  await gotoSettings(page, 'nothing stored');
  const from = (await uiSets(core)).length;
  await (await need(slider(page), 'slider Hover delay')).focus();
  await page.keyboard.press('ArrowRight');
  const sets = await eventually(() => uiSets(core, from), (x) => x.length > 0, 2000);
  assert.equal(sets.length, 1, 'one ui_state_set');
  assert.deepEqual(previewOfSet(sets[0]), { hoverDelay: 1100 }, 'only hoverDelay is written (1000 + 100), no mode');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-42

const WRITES = ['note_write', 'note_create', 'note_create_exact', 'daily_create', 'link_create', 'graph_presets_apply', 'ui_state_set'];
/** Odkazy's resolved links (paragraph start, index), as FR-LNK-11 AC-12's list plus the tags. */
const ODKAZY_LINKS: [string, number][] = [
  ['Hlavní', 0], ['S popisem', 0], ['Sekce', 0], ['Blok', 0], ['Chybějící sekce', 0], ['Osoby', 0], ['Osoby', 1], ['Projekt', 0], ['Úkol', 0],
  ['Dny', 0], ['Dny', 1], ['Štítky', 0], ['Štítky', 1], ['Štítky', 2], ['Média', 0], ['Média', 1], ['Média', 2], ['Dvojníci', 0], ['Dvojníci', 1],
  ['Prázdná', 0], ['Prázdná', 1], ['Kruh', 0], ['Markdown', 0], ['Nápad', 0], ['Mapa', 0],
];
async function hoverOn(page: Page, loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  await page.mouse.move(b.x + Math.min(6, b.width / 2), b.y + b.height / 2);
  await page.mouse.move(b.x + Math.min(8, b.width / 2), b.y + b.height / 2);
  await sleep(1150);
}
async function leave(page: Page) {
  await page.mouse.move(1100, 892);
  await sleep(450);
}
async function hscroll(page: Page, at: Locator) {
  const b = (await at.boundingBox())!;
  await page.mouse.move(b.x + Math.min(200, b.width / 2), b.y + Math.min(120, b.height / 2));
  for (const dx of [-40, 40]) { for (let i = 0; i < 12; i++) { await page.mouse.wheel(dx, 0); await sleep(10); } await sleep(300); }
  await page.mouse.wheel(-400, 0); await sleep(300);
  await page.mouse.wheel(400, 0); await sleep(300);
}
function cmdWheel(page: Page, at: Locator, deltaY: number) {
  return at.first().evaluate((el, dy) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 3, y = r.top + r.height / 3;
    (document.elementFromPoint(x, y) ?? el).dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: dy, deltaMode: 0, clientX: x, clientY: y, metaKey: true }));
  }, deltaY);
}

test('fr_syn_06_ac42_hovering_clicking_inside_previews_embeds_and_scrolling_write_nothing', async ({ page }) => {
  test.setTimeout(240_000);
  // D-1187: the tour starts on tasks/kanban with the panel open on Graph and the Kanban view stored before the start, so
  // reaching them writes no `ui_state` (the app stores `tasks` when the view is shown without it).
  const uiState = { ...ui(), rightPanel: { open: true, tab: 'graph' as const }, tasks: { view: 'kanban', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false } } as ReturnType<typeof ui>;
  const core = await startPreviews(page, { route: 'tasks/kanban', uiState });
  const files0 = await snapshot(core);
  // Horizontal wheels on tasks/kanban (FR-NAV-03 AC-8, AC-9).
  await hscroll(page, await need(main(page).locator('[data-column]').first().locator('xpath=..'), 'the Kanban board'));
  // Odkazy: rest on every resolved link (hover is the default).
  await goToQuery(page, 'Odkazy');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Odkazy', 'Odkazy from the Search page');
  for (const [start, n] of ODKAZY_LINKS) {
    await hoverOn(page, await needOdkazyLink(page, start, n));
    await needAnyPreview(page, `resting on link ${n + 1} of "${start}…" previews it (nothing stored: hover, 1,000 ms)`);
    await leave(page);
    await needClosed(page, `"${start}…" ${n + 1}: leaving hides it`);
  }
  // Follow a link inside a preview by hovering, and go Back.
  let d = await (async () => { await hoverOn(page, await needOdkazyLink(page, 'Hlavní')); return needPreview(page, 'Rozpočet 2027', 'Rozpočet'); })();
  const j = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'Jana inside');
  const jb = (await j.boundingBox())!;
  await page.mouse.move(jb.x + 4, jb.y + jb.height / 2, { steps: 6 });
  await sleep(1150);
  const dj = await needPreview(page, 'Jana Nováková', 'hovering the link inside replaces the content (D-1170)');
  await (await need(dj.getByRole('button', { name: 'Back to Rozpočet 2027', exact: true }), 'Back to Rozpočet 2027')).click();
  d = await needPreview(page, 'Rozpočet 2027', 'Back');
  await leave(page);
  // Clicks inside six previews: Rozpočet's body, both days, both tags, Prázdná.
  const inside: [string, number, string][] = [['Hlavní', 0, 'Návrh'], ['Dny', 0, 'Zápis'], ['Dny', 1, 'No'], ['Štítky', 0, 'objects'], ['Štítky', 1, 'object'], ['Prázdná', 0, 'Empty']];
  for (const [start, n, word] of inside) {
    await hoverOn(page, await needOdkazyLink(page, start, n));
    const p = await needAnyPreview(page, `"${start}…" ${n + 1}: the preview`);
    const pt = await wordPoint(p, word);
    assert.ok(pt, `"${start}…" ${n + 1}: the word ${word} in the preview`);
    await page.mouse.move(pt!.x, pt!.y, { steps: 6 });
    await page.mouse.click(pt!.x, pt!.y);
    await sleep(300);
    await eventually(async () => mainName(page), (x) => x !== 'Odkazy', 3000);
    assert.notEqual(await mainName(page), 'Odkazy', `"${start}…" ${n + 1}: the click inside opened the previewed object (D-1165)`);
    await back(page, 'Odkazy');
  }
  // Horizontal wheels on Odkazy and search.
  await hscroll(page, editorBody(page));
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'search');
  await hscroll(page, main(page));
  // Every embed of Vložení: a click and a double-click.
  await goToQuery(page, 'Vložení');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Vložení', 'Vložení');
  const embeds: [string, () => Promise<Locator>][] = [
    ['Jana\'s card', () => need(frame(editorBody(page), 'Jana Nováková'), 'card Jana')],
    ['Petr\'s link-mode chip', () => need(linkEmbed(editorBody(page), 'Petr Dvořák'), 'link-mode Petr')],
    ['the full embed\'s header title', async () => need(topEmbed(editorBody(page), 0).locator(':scope > *').first().getByText('Rozpočet 2027', { exact: true }), 'full header')],
    ['the section embed\'s header title', async () => need(topEmbed(editorBody(page), 3).locator(':scope > *').first().getByText(/Rozpočet 2027/), 'section header')],
  ];
  for (const [what, get] of embeds) {
    for (const dbl of [false, true]) {
      const loc = await get();
      await loc.scrollIntoViewIfNeeded();
      const b = (await loc.boundingBox())!;
      // Issue 112: the same point, relative to the element, clicked through the locator: Playwright takes the element's
      // place at the moment of the click. A point measured before was stale once Back's scroll restore moved the note.
      const position = what.includes('card') ? { x: b.width - 12, y: 12 } : { x: b.width / 2, y: b.height / 2 };
      if (dbl) await loc.dblclick({ position }); else await loc.click({ position });
      await sleep(300);
      await eventually(async () => mainName(page), (n) => n !== 'Vložení', 3000);
      assert.notEqual(await mainName(page), 'Vložení', `${what}: a ${dbl ? 'double-click' : 'click'} opens it (D-1166)`);
      await back(page, 'Vložení');
    }
  }
  // Plán (Pages/Plán.md): wheel pan and ⌘-wheel zoom in the panel, then in the full view.
  await goToQuery(page, 'Plán');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Plán', 'Plán');
  const pc = await need(pCanvas(page), 'the panel\'s canvas on Plán', 8000);
  const pb = (await pc.boundingBox())!;
  await page.mouse.move(pb.x + 8, pb.y + 8);
  for (const [dx, dy] of [[0, 120], [80, 0], [60, -40]] as const) { await page.mouse.wheel(dx, dy); await sleep(100); }
  await cmdWheel(page, pc, -120); await cmdWheel(page, pc, 120);
  await page.keyboard.press('Meta+Shift+g');
  const fc = await need(fullCanvas(page), 'the full view of Plán', 8000);
  const fb = (await fc.boundingBox())!;
  await page.mouse.move(fb.x + 8, fb.y + 8);
  for (const [dx, dy] of [[0, 120], [80, 0], [60, -40], [-400, 0]] as const) { await page.mouse.wheel(dx, dy); await sleep(100); }
  await cmdWheel(page, fc, -120); await cmdWheel(page, fc, 120);
  await sleep(500);
  const writes = (await core.calls()).map((c) => c.cmd).filter((c) => WRITES.includes(c));
  assert.deepEqual(writes, [], 'the tour sends no write command and no ui_state_set');
  const files1 = await snapshot(core);
  assert.deepEqual(Object.keys(files1).sort(), Object.keys(files0).sort(), 'no file created (no Daily/2026-10-30.md, no Tags/nápad.md)');
  assert.deepEqual(files1, files0, 'every vault file unchanged');
});
