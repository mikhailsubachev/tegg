// Slice P (v1.0, object previews) L5: the three Object preview modes on every surface. docs/acceptance/previews.md
// FR-LNK-12 AC-1…AC-7, FR-NAV-08 AC-1 (one parameterized suite over the R104 rows, run in each mode); contract
// docs/contracts/v1-previews.md §1, §3.1–§3.3. Written from the ACs and the contract only (D-61). The mode is stored
// before the page loads (ui-state `preview.mode`, v1-previews §9); "click" leaves it out (the default, D-923).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  PV, ZONE, back, backlinksPanel, chipNamed, description, editorBody, eventually, focusInfo, linkEmbed, main, mainName, mapNode, mark, mindmapFigure,
  mustBeOn, navsSince, need, needClosed, needNoPreview, needOdkazyLink, needPreview, nfc, previewCount, previewPath, previews, previewsVault, props,
  readArticle, runCommand, searchFor, sleep, startPreviews, taskCard, typeTable, type PreviewMode, type PreviewsStart, content, anyContent,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

/** One R104 row: where it is, its reference, the previewed object and the row's open. */
type Row = {
  n: number;
  name: string;
  kind: 'chip' | 'row' | 'card';
  start: PreviewsStart;
  /** Navigation after the start, if the surface needs it (e.g. a search query). */
  go?: (page: Page) => Promise<void>;
  ref: (page: Page) => Promise<Locator>;
  title: string;
  path: string;
  /** Asserts that the row's open happened. */
  opened: (page: Page, how: string) => Promise<void>;
  /** Where Back returns (the centre pane's name). */
  home: string;
  /** Puts the keyboard focus on the reference (in the editor: the caret after the chip). */
  focus?: (page: Page, ref: Locator) => Promise<void>;
};

const onNote = (title: string) => async (page: Page, how: string) => mustBeOn(page, nfc(title), `${how}: opens ${title}`, 5000);
const onTag = async (page: Page, how: string) => { await need(main(page).getByRole('heading', { level: 1, name: /^#?Účty$/ }), `${how}: opens tag/účty`, 5000); };
async function caretAfter(page: Page, ref: Locator) {
  const b = (await ref.boundingBox())!;
  await page.mouse.click(b.x + b.width + 1, b.y + b.height / 2, ).catch(() => {});
  // The click right of the chip lands in the text after it; ← until the caret touches the chip is not needed: the
  // paragraphs used here end with `]].`, so End then ← puts the caret directly after the chip.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
}

const ROWS: Row[] = [
  { n: 1, name: 'editor_body', kind: 'chip', start: { at: PV.odkazy }, ref: (p) => needOdkazyLink(p, 'Hlavní'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027'), home: 'Odkazy', focus: caretAfter },
  { n: 2, name: 'read_view', kind: 'chip', start: { at: PV.odkazy, readView: true }, ref: (p) => needOdkazyLink(p, 'Hlavní'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027'), home: 'Odkazy' },
  { n: 3, name: 'link_mode_embed', kind: 'chip', start: { at: PV.vlozeni }, ref: (p) => need(linkEmbed(editorBody(p), 'Petr Dvořák'), 'link-mode embed Petr'), title: 'Petr Dvořák', path: PV.petr, opened: onNote('Petr Dvořák'), home: 'Vložení' },
  { n: 4, name: 'attribute_relation_chip', kind: 'chip', start: { at: PV.alfa }, ref: (p) => need(chipNamed(props(p), 'Jana Nováková'), 'relation chip Jana'), title: 'Jana Nováková', path: PV.jana, opened: onNote('Jana Nováková'), home: 'Projekt Alfa' },
  { n: 5, name: 'backlinks_chip', kind: 'chip', start: { at: PV.rozpocet, panel: true }, ref: (p) => need(chipNamed(backlinksPanel(p), 'Odkazy'), 'backlinks chip Odkazy'), title: 'Odkazy', path: PV.odkazy, opened: onNote('Odkazy'), home: 'Rozpočet 2027' },
  { n: 6, name: 'task_source_chip', kind: 'chip', start: { route: 'tasks' }, ref: (p) => need(taskCard(p, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'source chip'), title: 'Porada 2026-10-27', path: PV.porada, opened: onNote('Porada 2026-10-27'), home: 'Tasks' },
  { n: 7, name: 'task_card_title', kind: 'card', start: { route: 'tasks' }, ref: (p) => need(taskCard(p, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'card title'), title: 'Zavolat Janě', path: PV.ukol, opened: onNote('Zavolat Janě'), home: 'Tasks' },
  { n: 8, name: 'search_result_row', kind: 'row', start: { at: PV.odkazy }, go: async (p) => { await searchFor(p, 'rozpočet', 'Rozpočet 2027'); }, ref: (p) => need(p.getByRole('list', { name: 'Search results', exact: true }).getByRole('listitem').filter({ hasText: 'Rozpočet 2027' }), 'result row'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027'), home: 'Search' },
  { n: 9, name: 'type_page_row', kind: 'row', start: { route: 'type/osoba' }, ref: (p) => need(typeTable(p, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'row Petr'), title: 'Petr Dvořák', path: PV.petr, opened: onNote('Petr Dvořák'), home: 'Osoby' },
  { n: 10, name: 'inbox_card_title', kind: 'card', start: { route: 'inbox' }, ref: (p) => need(main(p).getByRole('link', { name: 'Nápad na podcast', exact: true }), 'Inbox card title'), title: 'Nápad na podcast', path: PV.napad, opened: onNote('Nápad na podcast'), home: 'Inbox' },
  { n: 11, name: 'mindmap_node_chip', kind: 'chip', start: { at: PV.mapa }, ref: async (p) => need(mapNode(await need(mindmapFigure(p, 'Plán 2027'), 'figure'), 'Rozpočet 2027').getByRole('link').first(), 'node chip'), title: 'Rozpočet 2027', path: PV.rozpocet, opened: onNote('Rozpočet 2027'), home: 'Mapa', focus: async (p) => { await (await need(mapNode(mindmapFigure(p, 'Plán 2027'), 'Rozpočet 2027'), 'node')).focus(); } },
  { n: 12, name: 'tag_chip', kind: 'chip', start: { at: PV.odkazy, readView: true }, ref: (p) => need(readArticle(p, 'Odkazy').getByRole('link', { name: '#účty', exact: true }), 'tag chip #účty'), title: '#Účty', path: PV.ucty, opened: onTag, home: 'Odkazy' },
];

async function arrive(page: Page, row: Row, mode: PreviewMode | null) {
  const core = await startPreviews(page, { ...row.start, ...(mode ? { mode } : {}) });
  if (row.go) await row.go(page);
  return core;
}
async function focusRef(page: Page, row: Row, ref: Locator) {
  if (row.focus) await row.focus(page, ref);
  else await ref.focus();
}

/** Back to the row's surface; a surface reached by a query (search) is entered again, whatever Back's target. */
async function returnTo(page: Page, row: Row) {
  if (row.go) { await page.keyboard.press('Meta+BracketLeft'); await sleep(300); await row.go(page); return; }
  await back(page, row.home);
}

/** R103, column "Click to preview": single click → preview; double-click → open; ⌘↩ → open. */
async function clickColumn(page: Page, row: Row, mode: PreviewMode | null) {
  const core = await arrive(page, row, mode);
  const tag = `row ${row.n} ${row.name}`;
  let ref = await row.ref(page);
  await ref.click();
  const d = await needPreview(page, row.title, `${tag}: a single click previews`);
  assert.equal(await previewPath(d), nfc(row.path), `${tag}: the right object (FR-LNK-08 AC-10's path check)`);
  await page.keyboard.press('Escape');
  await needClosed(page, `${tag}: Esc`);
  const n0 = await mark(core);
  await ref.dblclick();
  await row.opened(page, `${tag}: a double-click`);
  assert.equal(await previewCount(page), 0, `${tag}: no popover after the double-click`);
  if (row.path !== PV.ucty) assert.deepEqual(await navsSince(core, n0), [nfc(row.path)], `${tag}: nav_opened once`);
  await returnTo(page, row);
  ref = await row.ref(page);
  await focusRef(page, row, ref);
  await page.keyboard.press('Meta+Enter');
  await row.opened(page, `${tag}: ⌘↩`);
}

for (const row of ROWS) {
  test(`fr_nav_08_ac1_row${String(row.n).padStart(2, '0')}_${row.name}_click_previews_double_click_and_cmd_enter_open`, async ({ page }) => {
    await clickColumn(page, row, null);
  });
}

for (const row of ROWS) {
  test(`fr_lnk_12_ac6_hover_row${String(row.n).padStart(2, '0')}_${row.name}_rest_previews_click_opens`, async ({ page }) => {
    await arrive(page, row, 'hover');
    const tag = `hover row ${row.n} ${row.name}`;
    let ref = await row.ref(page);
    const before = await focusInfo(page);
    const b = (await ref.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    const d = await needPreview(page, row.title, `${tag}: the pointer resting for the delay previews`, 2500);
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

for (const row of ROWS) {
  test(`fr_lnk_12_ac6_off_row${String(row.n).padStart(2, '0')}_${row.name}_click_opens_and_no_pointer_preview`, async ({ page }) => {
    await arrive(page, row, 'off');
    const tag = `off row ${row.n} ${row.name}`;
    let ref = await row.ref(page);
    const b = (await ref.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    await needNoPreview(page, `${tag}: resting the pointer`, 1200);
    await focusRef(page, row, ref);
    await page.keyboard.press('Alt+Space');
    const d = await needPreview(page, row.title, `${tag}: ⌥Space still previews (AP-810)`);
    assert.ok((await d.innerText()).includes('⌘↩ to open'), `${tag}: the footer hint ⌘↩ to open`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${tag}: Esc`);
    ref = await row.ref(page);
    await ref.click();
    await row.opened(page, `${tag}: a single click opens (today's behaviour)`);
    assert.equal(await previewCount(page), 0, `${tag}: no popover`);
  });
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_lnk_12_ac1_click_is_the_default_in_a_new_application_support', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  assert.equal((await core.uiState())?.preview, undefined, 'no stored preview state');
  await (await needOdkazyLink(page, 'Hlavní')).click();
  const d = await needPreview(page, 'Rozpočet 2027', 'a single click previews by default');
  assert.ok((await d.innerText()).includes('Double-click or ⌘↩ to open'), 'the footer hint of click mode (preview.hint.click)');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Settings: Previews');
  const g = await need(main(page).getByRole('radiogroup', { name: 'Object preview', exact: true }), 'radiogroup "Object preview"', 5000);
  assert.equal(await g.getByRole('radio', { name: 'Click to preview, double-click to open', exact: true }).getAttribute('aria-checked').catch(() => null)
    ?? String(await g.getByRole('radio', { name: 'Click to preview, double-click to open', exact: true }).isChecked()), 'true', 'Click to preview is checked');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_lnk_12_ac2_hover_shows_after_the_delay_from_the_last_movement', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  const caret0 = await page.evaluate(() => { const s = getSelection(); return s ? [s.anchorOffset, s.focusOffset, s.anchorNode?.textContent ?? null] : null; });
  await page.mouse.move(b.x + 3, b.y + b.height / 2);
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.clock.runFor(340); await sleep(50);
  assert.equal(await previewCount(page), 0, 'not before the delay (350 ms after the pointer stopped)');
  await page.clock.runFor(110); await sleep(150);
  await needPreview(page, 'Rozpočet 2027', 'shown 400 ms (± 50 ms) after the pointer stopped');
  const caret1 = await page.evaluate(() => { const s = getSelection(); return s ? [s.anchorOffset, s.focusOffset, s.anchorNode?.textContent ?? null] : null; });
  assert.deepEqual(caret1, caret0, 'the editor caret does not move');
  assert.equal((await focusInfo(page)).inPreview, false, 'the focus stays where it was');
});

test('fr_lnk_12_ac2_leaving_before_the_delay_shows_nothing_and_the_grace_keeps_it', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(200);
  await page.mouse.move(1300, 880);
  await page.clock.runFor(600); await sleep(100);
  assert.equal(await previewCount(page), 0, 'leaving the chip before the delay shows nothing');
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(450); await sleep(150);
  const d = await needPreview(page, 'Rozpočet 2027', 'hover again');
  const db = (await d.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + 30, { steps: 4 });
  await page.clock.runFor(600); await sleep(100);
  assert.equal(await previewCount(page), 1, 'moving from the chip onto the popover keeps it');
  await page.mouse.move(1300, 880);
  await page.clock.runFor(250); await sleep(100);
  assert.equal(await previewCount(page), 1, 'still shown 250 ms after leaving both');
  await page.mouse.move(db.x + db.width / 2, db.y + 30);
  await page.clock.runFor(200); await sleep(100);
  assert.equal(await previewCount(page), 1, 'coming back within 300 ms keeps it');
  await page.mouse.move(1300, 880);
  await page.clock.runFor(320); await sleep(150);
  assert.equal(await previewCount(page), 0, 'leaving both hides it 300 ms later');
});

test('fr_lnk_12_ac2_hovering_another_reference_replaces_it_after_its_delay', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  const a = (await (await needOdkazyLink(page, 'Hlavní')).boundingBox())!;
  await page.mouse.move(a.x + 4, a.y + a.height / 2);
  await page.clock.runFor(450); await sleep(150);
  await needPreview(page, 'Rozpočet 2027', 'first');
  const j = (await (await needOdkazyLink(page, 'Osoby', 0)).boundingBox())!;
  await page.mouse.move(j.x + 4, j.y + j.height / 2, { steps: 3 });
  await page.clock.runFor(200); await sleep(100);
  assert.deepEqual((await previews(page).count()) <= 1, true, 'never two');
  await page.clock.runFor(300); await sleep(150);
  await needPreview(page, 'Jana Nováková', 'replaced after the second reference\'s delay');
});

test('fr_lnk_12_ac2_typing_scrolling_held_keys_and_buttons_hide_or_block_it', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  const hover = async () => { await page.mouse.move(1300, 880); await page.clock.runFor(400); await page.mouse.move(b.x + 4, b.y + b.height / 2); await page.mouse.move(b.x + 5, b.y + b.height / 2); await page.clock.runFor(450); await sleep(150); };
  await hover();
  await needPreview(page, 'Rozpočet 2027', 'hover');
  await page.keyboard.type('x');
  await sleep(50);
  assert.equal(await previewCount(page), 0, 'typing a character hides it at once');
  await hover();
  await needPreview(page, 'Rozpočet 2027', 'hover again');
  await page.mouse.wheel(0, 40);
  await sleep(80);
  assert.equal(await previewCount(page), 0, 'scrolling the page hides it at once');
  await page.mouse.move(1300, 880);
  await page.keyboard.down('Shift');
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(700); await sleep(100);
  assert.equal(await previewCount(page), 0, 'never while a key is held');
  await page.keyboard.up('Shift');
  await page.mouse.move(1300, 880);
  await page.mouse.down();
  await page.mouse.move(b.x + 4, b.y + b.height / 2, { steps: 3 });
  await page.clock.runFor(700); await sleep(100);
  assert.equal(await previewCount(page), 0, 'never while a mouse button is down');
  await page.mouse.up();
});

test('fr_lnk_12_ac2_a_click_inside_a_hover_preview_makes_it_a_clicked_preview', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(450); await sleep(150);
  const d = await needPreview(page, 'Rozpočet 2027', 'hover');
  const t = await need(content(d, 'Rozpočet 2027').getByText('Návrh rozpočtu na rok 2027 pro celý tým.'), 'body text');
  await t.click();
  await page.mouse.move(1300, 880);
  await page.clock.runFor(800); await sleep(100);
  assert.equal(await previewCount(page), 1, 'it stays after the pointer leaves (a clicked preview, FR-LNK-11 AC-2)');
  assert.equal((await focusInfo(page)).inPreview, true, 'and the focus moved into it');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await chip.click();
  await mustBeOn(page, 'Rozpočet 2027', 'a single click on a reference opens it in hover mode (R103)', 5000);
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_lnk_12_ac3_off_opens_on_click_and_show_preview_still_previews', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, readView: true, mode: 'off' });
  const chip = await needOdkazyLink(page, 'Hlavní');
  await chip.hover();
  await needNoPreview(page, 'no pointer input shows a popover', 1200);
  assert.equal(await description(chip), '', 'no mode description when Off');
  await chip.focus();
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Rozpočet 2027', '⌥Space shows one in Off');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await chip.focus();
  await runCommand(page, 'Show preview');
  await needPreview(page, 'Rozpočet 2027', 'the Show preview command shows one in Off');
  await page.keyboard.press('Escape');
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'a single click opens (D-140)', 5000);
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_lnk_12_ac4_palette_mode_changes_apply_at_once_and_close_an_open_preview', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, readView: true });
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await needPreview(page, 'Rozpočet 2027', 'click mode');
  await runCommand(page, 'Object preview: Off');
  await needClosed(page, 'choosing another mode closes the open preview');
  const st = await eventually(async () => (await core.uiState())?.preview?.mode, (m) => m === 'off', 2000);
  assert.equal(st, 'off', 'stored machine-local (ui_state_set)');
  assert.equal(await description(await needOdkazyLink(page, 'Hlavní')), '', 'the chip description follows (none when Off)');
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'Off: the next click opens without a reload', 5000);
  await back(page, 'Odkazy');
  await runCommand(page, 'Object preview: Hover to preview');
  assert.equal(await description(await needOdkazyLink(page, 'Hlavní')), 'Hover to preview, click to open', 'hover description');
  await runCommand(page, 'Object preview: Click to preview');
  assert.equal(await description(await needOdkazyLink(page, 'Hlavní')), 'Click to preview, double-click to open', 'click description');
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await needPreview(page, 'Rozpočet 2027', 'click mode again');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_lnk_12_ac5_the_stored_hover_delay_is_used', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 1000, install: true });
  const b = (await (await needOdkazyLink(page, 'Hlavní')).boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(940); await sleep(80);
  assert.equal(await previewCount(page), 0, 'not before 1,000 ms (± 50 ms)');
  await page.clock.runFor(120); await sleep(150);
  await needPreview(page, 'Rozpočet 2027', 'shown after the 1,000 ms delay');
});

test('fr_lnk_12_ac5_the_delay_applies_only_in_hover_mode', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'click', hoverDelay: 200, install: true });
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.clock.runFor(1500); await sleep(100);
  assert.equal(await previewCount(page), 0, 'click mode ignores the delay: resting shows nothing');
  await chip.click();
  await needPreview(page, 'Rozpočet 2027', 'click previews');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_lnk_12_ac6_the_mode_is_one_value_for_the_whole_app_not_per_vault', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, readView: true, mode: 'hover' });
  assert.equal(await description(await needOdkazyLink(page, 'Hlavní')), 'Hover to preview, click to open', 'hover in this vault');
  await core.setVault({ ...previewsVault(), name: 'Jiný trezor' });
  await sleep(500);
  await runCommand(page, 'Go to type: Osoby');
  const row = await need(typeTable(page, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'type row in the other vault');
  const b = (await row.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 2 });
  await needPreview(page, 'Petr Dvořák', 'the other vault uses the same mode (hover)', 2500);
});

// ------------------------------------------------------------------------------------------------ AC-7

for (const mode of ['click', 'hover', 'off'] as const) {
  test(`fr_lnk_12_ac7_enter_per_mode_${mode}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, readView: true, mode });
    const chip = await needOdkazyLink(page, 'Hlavní');
    await chip.focus();
    await page.keyboard.press('Enter');
    if (mode === 'click') {
      await needPreview(page, 'Rozpočet 2027', 'click: ⏎ on a focused inline chip previews');
      await page.keyboard.press('Escape');
      await needClosed(page, 'Esc');
    } else {
      await mustBeOn(page, 'Rozpočet 2027', `${mode}: ⏎ on a focused inline chip opens`, 5000);
      await back(page, 'Odkazy');
    }
    const c2 = await needOdkazyLink(page, 'Hlavní');
    await c2.focus();
    await page.keyboard.press('Alt+Space');
    await needPreview(page, 'Rozpočet 2027', `${mode}: ⌥Space previews`);
    await page.keyboard.press('Escape');
    await needClosed(page, 'Esc');
    await (await needOdkazyLink(page, 'Hlavní')).focus();
    await page.keyboard.press('Meta+Enter');
    await mustBeOn(page, 'Rozpočet 2027', `${mode}: ⌘↩ opens`, 5000);
    await runCommand(page, 'Go to type: Osoby');
    const row = await need(typeTable(page, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'row Petr');
    await row.focus();
    const n0 = await mark(core);
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Petr Dvořák', `${mode}: ⏎ on a focused list row opens`, 5000);
    assert.deepEqual(await navsSince(core, n0), [nfc(PV.petr)], 'nav_opened once');
    assert.equal(await previewCount(page), 0, 'no preview');
  });
}

test('fr_lnk_12_ac7_in_the_editor_enter_splits_the_paragraph', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy });
  // Control: the click previews in this build.
  await (await needOdkazyLink(page, 'Hlavní')).click();
  await needPreview(page, 'Rozpočet 2027', 'control: a click previews');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const blocks0 = await editorBody(page).locator(':scope > *').count();
  await page.keyboard.press('Enter');
  await sleep(200);
  assert.equal(await editorBody(page).locator(':scope > *').count(), blocks0 + 1, '⏎ after the chip splits the paragraph as today');
  assert.equal(await previewCount(page), 0, 'no preview');
  assert.equal(await mainName(page), 'Odkazy', 'no open');
});

