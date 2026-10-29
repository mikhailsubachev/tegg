// Slice P (v1.0, object previews) L5: the surfaces of R104. docs/acceptance/previews.md FR-LNK-08 AC-1…AC-12,
// FR-LNK-09 AC-1…AC-7, FR-TSK-08 AC-4…AC-6; contract docs/contracts/v1-previews.md §3. Written from the ACs and the
// contract only (D-61). Red until slice P is built: today every click opens, so the preview assertions fail.
import { test } from '@playwright/test';
import { mustCaret } from './embeds-helpers';
import assert from 'node:assert/strict';
import {
  PV, ZONE, back, callsSince, chipNamed, clickToPreview, contentSequence, createOffer, editorBody, embedLoadsSince, fileText, fileWhen, flat, focusInfo,
  focusInside, frame, linkEmbed, main, mainName, mark, mindmapFigure, mapNode, mustBeOn, navsSince, need, needClosed, needNoPreview, needOdkazyLink,
  needPreview, nfc, nfd, noteBody, openBtn, paletteDialog, para, placementOf, previewCount, previewPath, previewsVault, props, readArticle, runCommand,
  savedWithin, searchFor, selectedBlocks, sidebar, sleep, sourceRegion, startPreviews, swap, tagObjectsTable, tagRoute, tagsTable, taskCard,
  taskCheckbox, topEmbed, topInScroller, typeTable, writesSince, dailySection, goToList, searchQuery, anyContent, TOGGLE_SOURCE, eventually, backlinksPanel,
  contextPanel, linkIn, noModified,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

// ------------------------------------------------------------------------------------------------ FR-LNK-08

test('fr_lnk_08_ac1_editor_click_previews_without_opening_or_writing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const n0 = await mark(core);
  const chip = await needOdkazyLink(page, 'Hlavní');
  const dlg = await clickToPreview(page, chip, 'Rozpočet 2027', 'a single click on the chip Rozpočet 2027 in the editor');
  assert.equal(await dlg.getAttribute('aria-modal'), 'false', 'aria-modal="false" (R102)');
  assert.equal(await previewPath(dlg), nfc(PV.rozpocet), 'data-preview-path');
  const pl = await placementOf(page, dlg, chip);
  assert.ok(pl.ok, `anchored to the chip (8 px gap, not covering it, inside the window): ${pl.why}`);
  assert.equal(await mainName(page), 'Odkazy', 'the route stays note/Pages/Odkazy.md');
  assert.deepEqual(await navsSince(core, n0), [], 'nav_opened is not called (D-138)');
  assert.equal((await callsSince(core, n0, 'note_read')).length, 0, 'no note_read is sent');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.equal((await focusInfo(page)).inBody, true, 'the focus is back in the Note body textbox');
  assert.equal((await callsSince(core, n0, 'note_write')).length, 0, 'opening and closing the popover sends no note_write');
  await page.keyboard.type('X');
  assert.ok(await savedWithin(page, 4000), 'Saved after typing X');
  const got = await fileWhen(core, PV.odkazy, (t) => !!t && t.includes('X.'), 3000);
  assert.equal(noModified(got), noModified(swap(previewsVault().files[nfc(PV.odkazy)], 'Hlavní [[Rozpočet 2027]].', 'Hlavní [[Rozpočet 2027]]X.')),
    'typing X saves "Hlavní Rozpočet 2027X." with the chip bytes unchanged, and nothing else but modified');
});

test('fr_lnk_08_ac2_read_view_click_and_enter_preview_and_esc_returns_to_the_chip', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, readView: true });
  await need(readArticle(page, 'Odkazy'), 'read view article "Odkazy"');
  const n0 = await mark(core);
  const chip = await needOdkazyLink(page, 'Hlavní');
  await clickToPreview(page, chip, 'Rozpočet 2027', 'read view: a click on Rozpočet 2027');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.equal(await focusInside(chip), true, 'Esc returns the focus to the chip');
  await chip.focus();
  await page.keyboard.press('Enter');
  await needPreview(page, 'Rozpočet 2027', 'read view: ⏎ on the focused chip (AP-811)');
  await page.keyboard.press('Escape');
  assert.equal(await mainName(page), 'Odkazy', 'no route change');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
  assert.deepEqual(await writesSince(core, n0), [], 'no write');
});

test('fr_lnk_08_ac3_relation_chip_previews_and_its_remove_button_still_removes', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.alfa });
  const p = await need(props(page), 'region "Properties" of Projekt Alfa');
  const chip = await need(chipNamed(p, 'Jana Nováková'), 'the Vlastník relation chip "Jana Nováková"');
  await clickToPreview(page, chip, 'Jana Nováková', 'a click on the relation chip');
  assert.equal(await page.getByRole('listbox', { name: 'Results' }).count(), 0, 'the relation picker does not open');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.ok((await fileText(core, PV.alfa))?.includes('vlastník: "[[Jana Nováková]]"'), 'the value is not removed by the click');
  const rm = await need(p.getByRole('button', { name: 'Remove Jana Nováková', exact: true }), 'button "Remove Jana Nováková"');
  await rm.click();
  await needNoPreview(page, 'a click on Remove Jana Nováková', 300);
  const t = await fileWhen(core, PV.alfa, (x) => !!x && !x.includes('[[Jana Nováková]]'), 4000);
  assert.ok(t && !t.includes('[[Jana Nováková]]'), 'Remove Jana Nováková still removes the value (types.md FR-EDT-07 AC-6)');
});

test('fr_lnk_08_ac3_source_row_chip_on_the_task_previews_porada', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.ukol });
  const n0 = await mark(core);
  const chip = await need(chipNamed(props(page), 'Porada 2026-10-27'), 'the Source row chip "Porada 2026-10-27"');
  await clickToPreview(page, chip, 'Porada 2026-10-27', 'a click on the Source chip');
  assert.equal(await mainName(page), 'Zavolat Janě', 'the task stays open');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
});

test('fr_lnk_08_ac3_link_in_a_text_value_previews_and_the_text_still_enters_edit_mode', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.alfa)] = swap(f[nfc(PV.alfa)], 'poznámka: Interní', 'poznámka: "Viz [[Rozpočet 2027]]"'); });
  await startPreviews(page, { at: PV.alfa, vault });
  const p = await need(props(page), 'region "Properties"');
  const chip = await need(chipNamed(p, 'Rozpočet 2027'), 'the chip "Rozpočet 2027" in the Poznámka value');
  await clickToPreview(page, chip, 'Rozpočet 2027', 'a click on the chip in a text value');
  const editing = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement); });
  assert.equal(editing, false, 'the click does not enter edit mode');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const cb = await chip.boundingBox();
  assert.ok(cb, 'chip box');
  // "Viz " is the value's text left of the chip.
  await page.mouse.click(cb!.x - 12, cb!.y + cb!.height / 2);
  const entered = await eventually(() => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a.isContentEditable) && !a.closest('[aria-label="Note body"]'); }), (x) => x, 2000);
  assert.equal(entered, true, 'a click on the value text outside the chip enters edit mode (types.md FR-EDT-07 AC-18)');
  assert.equal(await previewCount(page), 0, 'and shows no preview');
});

test('fr_lnk_08_ac4_backlinks_panel_chip_previews_beside_the_chip', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.rozpocet, panel: true });
  const bp = await need(backlinksPanel(page), 'tabpanel "Backlinks"');
  const chip = await need(chipNamed(bp, 'Odkazy'), 'backlinks chip "Odkazy"');
  const n0 = await mark(core);
  const dlg = await clickToPreview(page, chip, 'Odkazy', 'a click on the backlinks chip Odkazy');
  const pl = await placementOf(page, dlg, chip);
  assert.equal(pl.overlap, false, `the popover never covers the chip (${pl.why})`);
  assert.equal(pl.inside, true, `inside the window (${pl.why})`);
  assert.equal(await mainName(page), 'Rozpočet 2027', 'the route stays');
  assert.ok(await contextPanel(page).isVisible(), 'the panel stays');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
});

test('fr_lnk_08_ac5_search_result_row_previews_double_click_and_enter_open', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  let row = await searchFor(page, 'rozpočet', 'Rozpočet 2027');
  await clickToPreview(page, row.getByText('Rozpočet 2027').first(), 'Rozpočet 2027', 'a click on the result title');
  assert.equal(await searchQuery(page).inputValue(), 'rozpočet', 'the query field keeps its text');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const b = await row.boundingBox();
  assert.ok(b, 'row box');
  await page.mouse.click(b!.x + 12, b!.y + b!.height - 6);
  await needPreview(page, 'Rozpočet 2027', 'a click on the result snippet');
  await page.keyboard.press('Escape');
  const n0 = await mark(core);
  await row.dblclick();
  await mustBeOn(page, 'Rozpočet 2027', 'a double-click opens the result', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'nav_opened once for Rozpočet');
  assert.equal(await previewCount(page), 0, 'no popover left');
  await page.keyboard.press('Meta+BracketLeft');
  row = await searchFor(page, 'rozpočet', 'Rozpočet 2027');
  const focusable = row.getByRole('link').first();
  await (((await focusable.count()) > 0) ? focusable : row).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Rozpočet 2027', '⏎ on the focused result opens it (AP-811)', 5000);
  await searchFor(page, 'rozpočet', 'Rozpočet 2027');
  const opt = await need(goToList(page).getByRole('option').filter({ hasText: 'Rozpočet 2027' }), 'Go to option "Rozpočet 2027"');
  await opt.click();
  await mustBeOn(page, 'Rozpočet 2027', 'the Go to option opens (never previews)', 5000);
  assert.equal(await previewCount(page), 0, 'Go to shows no preview');
});

test('fr_lnk_08_ac6_type_page_row_previews_enter_opens_header_sorts', async ({ page }) => {
  await startPreviews(page, { route: 'type/osoba' });
  const t = await need(typeTable(page, 'Osoby'), 'table "Osoby"');
  const row = await need(t.getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'row "Petr Dvořák"');
  const cells = row.getByRole('cell');
  await clickToPreview(page, (await cells.count()) > 1 ? cells.nth(1) : row, 'Petr Dvořák', 'a click on a cell of the row');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const hdr = await need(t.getByRole('columnheader').first(), 'the first column header');
  const before = await hdr.getAttribute('aria-sort');
  await (hdr.getByRole('button').first().or(hdr)).first().click();
  assert.notEqual(await eventually(() => hdr.getAttribute('aria-sort'), (s) => s !== before, 1500), before, 'a click on a column header still sorts');
  assert.equal(await previewCount(page), 0, 'and shows no preview');
  await row.focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Petr Dvořák', '⏎ on the focused row opens it', 5000);
});

test('fr_lnk_08_ac6_tag_page_row_previews_and_its_other_tags_chip_previews_the_tag', async ({ page }) => {
  await startPreviews(page, { route: tagRoute('účty') });
  const t = await need(tagObjectsTable(page, 'Účty'), 'table "Objects with #Účty"');
  const row = await need(t.locator(`[data-path="${nfc(PV.rozpocet)}"]`), 'row Rozpočet 2027');
  await clickToPreview(page, row, 'Rozpočet 2027', 'a click on the tag-page row');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const other = await need(t.locator(`[data-path="${nfc(PV.odkazy)}"]`).getByText('#nápad', { exact: true }), 'the Other tags chip #nápad in row Odkazy');
  await clickToPreview(page, other, '#nápad', 'a click on an Other tags chip (R104 row 12, AP-819)');
});

async function taskTitlePreviews(page: import('@playwright/test').Page, how: string) {
  const c = await need(taskCard(page, 'Zavolat Janě'), `${how}: card "Task: Zavolat Janě"`);
  await clickToPreview(page, await need(c.getByRole('link', { name: 'Zavolat Janě', exact: true }), `${how}: the card title`), 'Zavolat Janě', `${how}: a click on the card title`);
  await page.keyboard.press('Escape');
  await needClosed(page, `${how}: Esc`);
  return c;
}

test('fr_lnk_08_ac7_task_card_title_previews_on_schedule_checkbox_and_more_keep_their_job', async ({ page }) => {
  const core = await startPreviews(page, { route: 'tasks' });
  const c = await taskTitlePreviews(page, 'Schedule');
  await (await need(c.getByRole('button', { name: 'More actions for "Zavolat Janě"', exact: true }), 'button More')).click();
  await (await need(page.getByRole('menuitem', { name: 'Open', exact: true }), 'menu item Open')).click();
  await mustBeOn(page, 'Zavolat Janě', 'More › Open opens the task', 5000);
  await back(page, 'Tasks');
  const cb = await need(taskCheckbox(taskCard(page, 'Zavolat Janě'), 'Zavolat Janě'), 'the card checkbox');
  await cb.click();
  await needNoPreview(page, 'a click on the checkbox', 300);
  const t = await fileWhen(core, PV.ukol, (x) => !!x && !x.includes('status: To do'), 3000);
  assert.ok(t && !t.includes('status: To do'), 'the checkbox still toggles the task (tasks.md FR-TSK-02 AC-10)');
});

test('fr_lnk_08_ac7_task_card_title_previews_on_kanban_and_a_drag_never_previews', async ({ page }) => {
  await startPreviews(page, { route: 'tasks/kanban' });
  const c = await taskTitlePreviews(page, 'Kanban');
  const b = await c.boundingBox();
  assert.ok(b, 'card box');
  await page.mouse.move(b!.x + b!.width / 2, b!.y + 8);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2 + 6, b!.y + 14, { steps: 3 });
  await page.mouse.up();
  await needNoPreview(page, 'a drag of ≥ 4 px', 500);
});

test('fr_lnk_08_ac7_task_card_title_previews_in_tasks_due_of_a_daily_note', async ({ page }) => {
  await startPreviews(page, { route: 'daily/2026-10-30' });
  const s = await need(dailySection(page, 'Tasks due'), 'region "Tasks due" of daily/2026-10-30');
  await clickToPreview(page, await need(s.getByRole('link', { name: 'Zavolat Janě', exact: true }), 'the card title in Tasks due'), 'Zavolat Janě', 'Tasks due');
});

test('fr_lnk_08_ac8_inbox_card_title_previews_and_enter_on_the_card_opens', async ({ page }) => {
  const core = await startPreviews(page, { route: 'inbox' });
  const title = await need(main(page).getByRole('link', { name: 'Nápad na podcast', exact: true }), 'Inbox card title "Nápad na podcast"');
  await clickToPreview(page, title, 'Nápad na podcast', 'a click on the Inbox card title');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.deepEqual(await writesSince(core, 0), [], 'nothing marked reviewed');
  const card = await need(main(page).locator(`[data-path="${nfc(PV.napad)}"]`).and(page.getByRole('article')), 'the Inbox card');
  await card.focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nápad na podcast', '⏎ on the focused card opens (AP-811)', 5000);
});

test('fr_lnk_08_ac8_daily_modified_row_previews', async ({ page }) => {
  await startPreviews(page, { route: 'daily/2026-10-28' });
  const s = await need(dailySection(page, 'Modified'), 'region "Modified" of daily/2026-10-28');
  await clickToPreview(page, await need(chipNamed(s, 'Petr Dvořák'), 'row Petr Dvořák'), 'Petr Dvořák', 'a click on the Modified row');
});

test('fr_lnk_08_ac8_duplicate_titles_rows_preview_each_plan', async ({ page }) => {
  await startPreviews(page, { route: 'duplicate-titles' });
  const links = main(page).getByRole('group', { name: /^Plán, 2$/ }).getByRole('link', { name: /^Plán\b/ });
  await need(links, 'the Duplicate titles rows "Plán"');
  assert.equal(await links.count(), 2, 'two rows Plán');
  const paths: string[] = [];
  for (let i = 0; i < 2; i++) {
    const d = await clickToPreview(page, links.nth(i), 'Plán', `row ${i + 1} "Plán"`);
    paths.push((await previewPath(d)) ?? '');
    await page.keyboard.press('Escape');
    await needClosed(page, 'Esc');
  }
  assert.deepEqual(paths.sort(), [nfc(PV.planP), nfc(PV.planQ)].sort(), 'each row previews its own file');
});

test('fr_lnk_08_ac8_all_tags_row_previews_the_tag_and_enter_opens', async ({ page }) => {
  await startPreviews(page, { route: 'tags' });
  const row = await need(tagsTable(page).locator('[data-tag="účty"]'), 'All tags row účty');
  await clickToPreview(page, row, '#Účty', 'a click on the All tags row (a Tag preview, AP-819)');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await row.focus();
  await page.keyboard.press('Enter');
  await need(main(page).getByRole('heading', { level: 1, name: /^#?Účty$/ }), '⏎ on the focused row opens tag/účty', 5000);
});

test('fr_lnk_08_ac8_mindmap_node_chip_previews', async ({ page }) => {
  await startPreviews(page, { at: PV.mapa });
  const fig = await need(mindmapFigure(page, 'Plán 2027'), 'figure "Mindmap: Plán 2027"');
  const n = await need(mapNode(fig, 'Rozpočet 2027'), 'node "Rozpočet 2027"');
  await clickToPreview(page, await need(n.getByRole('link').first(), 'the node chip'), 'Rozpočet 2027', 'a click on the node chip in the map');
  assert.equal(await mainName(page), 'Mapa', 'Mapa stays open');
});

test('fr_lnk_08_ac9_broken_and_external_links_never_preview', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  // Positive control: a resolved chip of the same note previews, so "no preview" below means something.
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'control: a click on Rozpočet 2027');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  for (let i = 0; i < 2; i++) {
    const l = await needOdkazyLink(page, 'Rozbité', i);
    const name = flat(await l.innerText());
    await l.click();
    assert.ok(await need(createOffer(page), `a click on the broken link "${name}" opens the Create offer`), 'offer');
    assert.equal(await previewCount(page), 0, `"${name}": no dialog named Preview: …`);
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  // [[Smazaná]] resolves only in .trash/: the AC names the Create offer, D-615 a trashed chip whose click opens the
  // Trash (test author's question Q1). Either way it never previews.
  await (await needOdkazyLink(page, 'Rozbité', 2)).click();
  const trashOrOffer = await eventually(async () => (await createOffer(page).count()) > 0 || (await mainName(page)) === 'Trash', (x) => x, 3000);
  assert.ok(trashOrOffer, 'a click on Smazaná opens the Create offer (AC) or the Trash (D-615)');
  assert.equal(await previewCount(page), 0, '"Smazaná": no dialog named Preview: …');
  if ((await mainName(page)) === 'Trash') await back(page, 'Odkazy'); else await page.keyboard.press('Escape');
  const ext = await needOdkazyLink(page, 'Web');
  await ext.click();
  const opened = await eventually(() => core.externalOpened(), (x) => x.length > 0, 2000);
  assert.deepEqual(opened, ['https://example.com/rozpocet'], 'stránka asks the shell to open the URL (open_external)');
  assert.equal(await previewCount(page), 0, 'the external link shows no preview');
});

test('fr_lnk_08_ac9_go_to_sidebar_palette_broken_links_page_and_source_view_never_preview', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy });
  // Positive control: the same chip previews in the formatted note, so "no preview" below means something.
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'control: a click on Rozpočet 2027 in the editor');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await page.keyboard.press(TOGGLE_SOURCE);
  const src = await need(sourceRegion(page), 'region "Markdown source"');
  const b = await src.boundingBox();
  await page.mouse.click(b!.x + 40, b!.y + 20);
  await needNoPreview(page, 'a click in the source view', 400);
  await page.keyboard.press(TOGGLE_SOURCE);
  await runCommand(page, 'Go to Broken links');
  await need(main(page).getByRole('heading', { name: 'Broken links', exact: true }), 'Broken links page', 5000);
  const ex = await need(main(page).locator('[data-occurrence]').first(), 'an excerpt on the Broken links page');
  await ex.click();
  await mustBeOn(page, 'Odkazy', 'the excerpt goes to the mention (D-280)', 5000);
  assert.equal(await previewCount(page), 0, 'the excerpt shows no preview');
  await (await need(sidebar(page).getByRole('link', { name: /^Inbox\b/ }), 'sidebar Inbox')).click();
  await needNoPreview(page, 'the sidebar entry', 300);
  await page.keyboard.press('Meta+k');
  await need(paletteDialog(page), 'the palette');
  assert.equal(await previewCount(page), 0, 'the palette shows no preview');
});

test('fr_lnk_08_ac10_the_preview_path_is_what_the_link_resolves_to', async ({ page }) => {
  const cases: [string, number, string, string][] = [
    ['Hlavní', 0, PV.rozpocet, 'Rozpočet 2027'],
    ['S popisem', 0, PV.rozpocet, 'Rozpočet 2027'],
    ['Markdown', 0, PV.rozpocet, 'Rozpočet 2027'],
    ['Osoby', 0, PV.jana, 'Jana Nováková'],
    ['Osoby', 1, PV.petr, 'Petr Dvořák'],
    ['Projekt', 0, PV.alfa, 'Projekt Alfa'],
    ['Úkol', 0, PV.ukol, 'Zavolat Janě'],
    ['Dny', 0, PV.denni, '2026-10-07'],
    ['Štítky', 2, PV.ucty, '#Účty'],
    ['Média', 0, PV.graf, 'Graf'],
    ['Média', 1, PV.graf, 'Graf'],
    ['Média', 2, PV.smlouva, 'Smlouva'],
    ['Dvojníci', 0, PV.planP, 'Plán'],
    ['Dvojníci', 1, PV.planQ, 'Plán'],
    ['Prázdná', 0, PV.prazdna, 'Prázdná'],
    ['Prázdná', 1, PV.neplatna, 'Neplatná hlavička'],
    ['Kruh', 0, PV.kruhA, 'Kruh A'],
    ['Nápad', 0, PV.napad, 'Nápad na podcast'],
    ['Mapa', 0, PV.mapa, 'Mapa'],
  ];
  const core = await startPreviews(page, { at: PV.odkazy });
  for (const [start, n, path, title] of cases) {
    const l = await needOdkazyLink(page, start, n);
    const n0 = await mark(core);
    const d = await clickToPreview(page, l, title, `"${start}…" link ${n + 1}`);
    assert.equal(await previewPath(d), nfc(path), `"${start}…" link ${n + 1}: data-preview-path is ${path} (never by title alone, FR-LNK-14)`);
    if (path === PV.planP || path === PV.planQ) {
      const body = flat(await anyContent(d).first().innerText());
      assert.equal(body, path === PV.planP ? 'Plán ze stránek.' : 'Plán z rychlých poznámek.', `${path}: its own body`);
    }
    assert.equal((await callsSince(core, n0, 'link_resolve')).length, 0, `"${start}…" link ${n + 1}: the preview sends no link_resolve of its own`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${path}: Esc`);
  }
});

test('fr_lnk_08_ac10_nfd_link_and_nfd_file_name_resolve_to_the_nfc_title', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.odkazy)] = f[nfc(PV.odkazy)] + `\nNFD [[${nfd('Rozpočet 2027')}]].\n`; });
  const core = await startPreviews(page, { at: PV.odkazy, vault });
  const d = await clickToPreview(page, await needOdkazyLink(page, 'NFD'), 'Rozpočet 2027', 'a runtime NFD [[Rozpočet 2027]]');
  assert.equal(await previewPath(d), nfc(PV.rozpocet), 'NFD link → Pages/Rozpočet 2027.md');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await core.renameFile(PV.rozpocet, nfd(PV.rozpocet));
  await sleep(400);
  const d2 = await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'after the file is renamed to its NFD form');
  const h2 = flat(await d2.locator('h2').first().innerText().catch(() => ''));
  assert.equal(h2, 'Rozpočet 2027', 'the title is shown in NFC (FR-FMT-12)');
  assert.equal(h2, h2.normalize('NFC'), 'NFC');
});

test('fr_lnk_08_ac11_one_popover_at_a_time_and_every_other_popup_closes_it', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, panel: true });
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'Rozpočet');
  await clickToPreview(page, await needOdkazyLink(page, 'Osoby', 0), 'Jana Nováková', 'a click on Jana replaces it');
  await (await needOdkazyLink(page, 'Rozbité', 0)).click();
  await need(createOffer(page), 'the Create offer');
  assert.equal(await previewCount(page), 0, 'opening the Create offer closes the preview');
  await page.keyboard.press('Escape');
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'again');
  await page.keyboard.press('Meta+k');
  await need(paletteDialog(page), 'the palette (⌘K)');
  assert.equal(await previewCount(page), 0, 'the palette closes the preview');
  await page.keyboard.press('Escape');
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'again');
  await (await need(sidebar(page).getByRole('link', { name: /^Inbox\b/ }), 'sidebar Inbox')).click();
  await mustBeOn(page, 'Inbox', 'the click outside still acts: Inbox opens', 5000);
  assert.equal(await previewCount(page), 0, 'the click outside closes the preview');
  await back(page, 'Odkazy');
  await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'again');
  await page.keyboard.press('Meta+BracketRight');
  await page.keyboard.press('Meta+BracketLeft');
  await needClosed(page, 'a route change (Back) closes the preview');
});

test('fr_lnk_08_ac12_click_mode_loads_nothing_before_the_click', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, readView: true });
  await need(readArticle(page, 'Odkazy'), 'read view');
  const chip = await needOdkazyLink(page, 'Hlavní');
  const n0 = await mark(core);
  await chip.hover();
  await chip.focus();
  await sleep(900);
  assert.equal(await previewCount(page), 0, 'hovering or focusing shows no popover in click mode');
  assert.deepEqual((await embedLoadsSince(core, n0)).filter((p) => p.includes(nfc(PV.rozpocet))), [], 'and sends no embed_load for Rozpočet');
  await chip.click();
  await needPreview(page, 'Rozpočet 2027', 'the click');
  assert.ok((await embedLoadsSince(core, n0)).some((p) => p.includes(nfc(PV.rozpocet))), 'the first embed_load for Rozpočet is sent on the click');
});

test('fr_lnk_08_ac12_hover_mode_loads_when_the_delay_ends', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, readView: true, mode: 'hover', hoverDelay: 400, install: true });
  await need(readArticle(page, 'Odkazy'), 'read view');
  const chip = await needOdkazyLink(page, 'Hlavní');
  const b = (await chip.boundingBox())!;
  const n0 = await mark(core);
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.clock.runFor(200);
  assert.deepEqual((await embedLoadsSince(core, n0)).filter((p) => p.includes(nfc(PV.rozpocet))), [], 'no embed_load when the pointer enters');
  await page.clock.runFor(300);
  const got = await eventually(async () => (await embedLoadsSince(core, n0)).filter((p) => p.includes(nfc(PV.rozpocet))).length, (x) => x > 0, 1500);
  assert.ok(got > 0, 'embed_load for Rozpočet is sent when the 400 ms delay ends (FR-LNK-12 AC-2)');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-09

test('fr_lnk_09_ac1_card_embed_click_previews_double_click_opens_enter_previews', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.vlozeni });
  const card = await need(frame(editorBody(page), 'Jana Nováková'), 'card "Embedded: Jana Nováková"');
  const b = (await card.boundingBox())!;
  await page.mouse.click(b.x + b.width - 12, b.y + 12);
  const d = await needPreview(page, 'Jana Nováková', 'a click on the card outside its strip values');
  const pl = await placementOf(page, d, card);
  assert.ok(pl.ok, `anchored to the card: ${pl.why}`);
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const n0 = await mark(core);
  await page.mouse.dblclick(b.x + b.width - 12, b.y + 12);
  await mustBeOn(page, 'Jana Nováková', 'a double-click opens note/Osoby/Jana Nováková.md', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'nav_opened once');
  await back(page, 'Vložení');
  const card2 = await need(frame(editorBody(page), 'Jana Nováková'), 'the card after Back');
  await card2.focus();
  await page.keyboard.press('Enter');
  await needPreview(page, 'Jana Nováková', '⏎ on the focused card previews (AP-811)');
});

test('fr_lnk_09_ac2_link_mode_embed_click_previews_double_click_opens', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  const l = await need(linkEmbed(editorBody(page), 'Petr Dvořák'), 'link-mode embed "Petr Dvořák"');
  await clickToPreview(page, l, 'Petr Dvořák', 'a click on the link-mode chip');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await l.dblclick();
  await mustBeOn(page, 'Petr Dvořák', 'a double-click opens Petr', 5000);
});

test('fr_lnk_09_ac3_full_embed_header_title_previews_and_its_buttons_keep_their_jobs', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  const f = await need(topEmbed(editorBody(page), 0), 'the full embed of Rozpočet');
  const hdr = f.locator(':scope > *').first();
  await clickToPreview(page, await need(hdr.getByText('Rozpočet 2027', { exact: true }), 'the header title text'), 'Rozpočet 2027', 'a click on the full embed header title');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await (await need(f.getByRole('button', { name: 'Display as', exact: true }), 'button "Display as"')).click();
  await need(page.getByRole('menu', { name: 'Display as', exact: true }), 'the Display as menu opens on a single click');
  assert.equal(await previewCount(page), 0, 'Display as shows no preview');
  await page.keyboard.press('Escape');
  const body = await need(f.getByText('Návrh rozpočtu na rok 2027 pro celý tým.'), 'the embed body text');
  await body.click();
  await needNoPreview(page, 'a click inside the embed body', 400);
  await (await need(f.getByRole('button', { name: 'Open Rozpočet 2027', exact: true }), 'button "Open Rozpočet 2027"')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'Open Rozpočet 2027 opens the note (embeds.md FR-EMB-02 AC-9)', 5000);
  assert.equal(await previewCount(page), 0, 'no preview');
});

test('fr_lnk_09_ac3_section_embed_header_previews_the_section', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  const f = await need(topEmbed(editorBody(page), 3), 'the section embed ![[Rozpočet 2027#Rozsah]]');
  const hdr = f.locator(':scope > *').first();
  await (await need(hdr.getByText(/Rozpočet 2027/).first(), 'its header title')).click();
  const d = await need(page.getByRole('dialog', { name: /^Preview: Rozpočet 2027( › Rozsah)?$/ }), 'the section preview');
  assert.equal(flat(await d.locator('header h2').first().innerText().catch(() => '')), 'Rozpočet 2027 › Rozsah', 'the header title of R105 (D-156)');
});

test('fr_lnk_09_ac4_card_and_link_mode_previews_show_the_full_content', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  const card = await need(frame(editorBody(page), 'Jana Nováková'), 'card Jana');
  const b = (await card.boundingBox())!;
  await page.mouse.click(b.x + b.width - 12, b.y + 12);
  const d = await needPreview(page, 'Jana Nováková', 'card preview');
  assert.equal(await d.locator('[data-embed-mode]').count(), 0, 'not a second card');
  await need(d.getByRole('region', { name: 'Properties', exact: true }), 'the R105 content: all attributes (empty body)');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const d2 = await clickToPreview(page, await need(linkEmbed(editorBody(page), 'Petr Dvořák'), 'link-mode Petr'), 'Petr Dvořák', 'link-mode preview');
  assert.equal(flat(await anyContent(d2).first().innerText().catch(() => '')), 'Vede tým nákupu.', 'the body of Petr');
  assert.equal(await d2.locator('[data-embed-mode]').count(), 0, 'no card inside');
});

test('fr_lnk_09_ac5_task_embed_card_title_previews_checkbox_keeps_its_job', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.porada });
  const f = await need(main(page).locator('[data-embed-mode]').filter({ hasText: 'Zavolat Janě' }), 'the task embed card');
  await clickToPreview(page, await need(f.getByRole('link', { name: 'Zavolat Janě', exact: true }).or(f.getByText('Zavolat Janě', { exact: true })), 'the card title'), 'Zavolat Janě', 'a click on the task card title');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await (await need(f.getByRole('checkbox').first(), 'the card checkbox')).click();
  await needNoPreview(page, 'the checkbox', 300);
  const t = await fileWhen(core, PV.ukol, (x) => !!x && !x.includes('status: To do'), 3000);
  assert.ok(t && !t.includes('status: To do'), 'the checkbox still changes the task (conversion.md FR-CNV-05)');
});

test('fr_lnk_09_ac6_image_figure_click_selects_double_click_opens_alt_space_previews', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  const fig = await need(editorBody(page).locator('figure').filter({ has: page.getByRole('img', { name: 'Graf', exact: true }) }), 'the figure of ![[graf.png]]');
  await fig.click();
  await needNoPreview(page, 'a single click on the figure', 400);
  assert.ok((await selectedBlocks(page)).length === 1, 'the figure is selected as a block (trash-media R77)');
  await page.keyboard.press('Alt+Space');
  await needPreview(page, 'Graf', '⌥Space on the selected figure');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await fig.dblclick();
  await mustBeOn(page, 'Graf', 'a double-click opens note/Images/Graf.md', 5000);
});

test('fr_lnk_09_ac7_keyboard_on_a_selected_card_embed', async ({ page }) => {
  await startPreviews(page, { at: PV.vlozeni });
  await need(frame(editorBody(page), 'Jana Nováková'), 'card "Embedded: Jana Nováková"');
  // Keyboard selection (embeds.md FR-EMB-02 AC-14): ↓ from the host paragraph above selects the next embed as a block.
  await mustCaret(editorBody(page).locator(':scope > *').first(), 'Před vloženími.', 'the end of "Před vloženími."');
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  for (let i = 0; i < 3 && !(await selectedBlocks(page)).includes(3); i++) {
    if ((await selectedBlocks(page)).length === 0) await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await sleep(100);
  }
  assert.deepEqual(await selectedBlocks(page), [3], 'the card embed of Jana is selected as a block');
  await page.keyboard.press('Alt+Space');
  const d = await needPreview(page, 'Jana Nováková', '⌥Space on the selected embed');
  assert.equal(await focusInside(d), true, 'the focus moves into the preview');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.deepEqual(await selectedBlocks(page), [3], 'the embed is selected again');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Jana Nováková', '⌘↩ opens Jana', 5000);
});

// ------------------------------------------------------------------------------------------------ FR-TSK-08

test('fr_tsk_08_ac4_source_chip_previews_porada_scrolled_to_the_task_embed', async ({ page }) => {
  const core = await startPreviews(page, { route: 'tasks' });
  const c = await need(taskCard(page, 'Zavolat Janě'), 'card Zavolat Janě');
  const n0 = await mark(core);
  const d = await clickToPreview(page, await need(c.locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'source chip'), 'Porada 2026-10-27', 'a click on the source chip');
  const target = await need(d.locator('[data-preview-target]'), 'the marked card (data-preview-target)');
  assert.ok(flat(await target.innerText()).includes('Zavolat Janě'), 'the marked element is the card Zavolat Janě');
  const art = await need(anyContent(d), 'the body article');
  const top = await eventually(async () => {
    const a = await art.boundingBox(); const t = await target.boundingBox();
    return a && t ? t.y - a.y : null;
  }, (x) => x !== null && Math.abs(x) <= 8, 2000);
  assert.ok(top !== null && Math.abs(top) <= 8, `the card is at the top of the body (± 8 px): ${top}`);
  assert.equal(await mainName(page), 'Tasks', 'no route change');
  assert.deepEqual(await writesSince(core, n0), [], 'no write');
});

test('fr_tsk_08_ac4_without_the_embed_the_source_preview_is_at_the_top', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.porada)] = swap(f[nfc(PV.porada)], '![[Zavolat Janě]]\n\n', ''); });
  await startPreviews(page, { route: 'tasks', vault });
  const c = await need(taskCard(page, 'Zavolat Janě'), 'card');
  const d = await clickToPreview(page, await need(c.locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'source chip'), 'Porada 2026-10-27', 'source chip');
  assert.equal(await d.locator('[data-preview-target]').count(), 0, 'nothing marked');
  const st = await anyContent(d).first().evaluate((a) => { let s: HTMLElement | null = a as HTMLElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; return s ? s.scrollTop : -1; });
  assert.equal(st, 0, 'the body is at its top');
});

async function sourceChip(page: import('@playwright/test').Page) {
  return need(taskCard(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'the source chip of Zavolat Janě');
}
async function mustBeAtTheEmbed(page: import('@playwright/test').Page, how: string) {
  await mustBeOn(page, 'Porada 2026-10-27', `${how}: note/Pages/Porada 2026-10-27.md`, 5000);
  const sel = await need(main(page).locator('[data-block-selected]'), `${how}: a selected block`);
  assert.ok(flat(await sel.innerText()).includes('Zavolat Janě'), `${how}: the block ![[Zavolat Janě]] is selected`);
  const top = await topInScroller(sel);
  assert.ok(top !== null && Math.abs(top) <= 8, `${how}: at the top of the centre pane (± 8 px): ${top}`);
}

test('fr_tsk_08_ac5_double_click_open_and_cmd_enter_open_porada_at_the_embed', async ({ page }) => {
  await startPreviews(page, { route: 'tasks' });
  await (await sourceChip(page)).dblclick();
  await mustBeAtTheEmbed(page, 'a double-click on the source chip');
  assert.equal(await previewCount(page), 0, 'no popover left');
  await back(page, 'Tasks');
  await (await sourceChip(page)).click();
  const d = await needPreview(page, 'Porada 2026-10-27', 'the preview');
  await (await need(openBtn(d, 'Porada 2026-10-27'), 'button "Open Porada 2026-10-27"')).click();
  await mustBeAtTheEmbed(page, 'Open in the preview');
  await back(page, 'Tasks');
  const chip = await sourceChip(page);
  await chip.focus();
  await page.keyboard.press('Enter');
  await needPreview(page, 'Porada 2026-10-27', '⏎ on the focused chip previews in click mode (R103)');
  await page.keyboard.press('Escape');
  await chip.focus();
  await page.keyboard.press('Meta+Enter');
  await mustBeAtTheEmbed(page, '⌘↩ on the focused chip');
});

for (const mode of ['click', 'hover', 'off'] as const) test(`fr_tsk_08_ac5_unresolved_source_offers_create_and_date_source_previews_the_day_${mode}`, async ({ page }) => {
  const base = previewsVault().files[nfc(PV.ukol)];
  const vault = previewsVault((f) => {
    f['Tasks/Chybějící zdroj.md'] = swap(swap(swap(base, 'P009', 'P091'), '"[[Porada 2026-10-27]]"', '"[[Chybí]]"'), 'title: Zavolat Janě', 'title: Chybějící zdroj');
    f['Tasks/Ze dne.md'] = swap(swap(swap(base, 'P009', 'P092'), '"[[Porada 2026-10-27]]"', '"[[2026-10-07]]"'), 'title: Zavolat Janě', 'title: Ze dne');
  });
  {
    await startPreviews(page, { route: 'tasks', vault, mode });
    await (await need(taskCard(page, 'Chybějící zdroj').locator('[data-link-kind]'), `${mode}: unresolved chip`)).click();
    await need(createOffer(page), `${mode}: the unresolved source chip opens the Create offer`);
    assert.equal(await previewCount(page), 0, `${mode}: no preview for a broken chip`);
    await page.keyboard.press('Escape');
    const dc = await need(taskCard(page, 'Ze dne').locator('[data-link-kind]'), `${mode}: date chip`);
    await dc.focus();
    await page.keyboard.press('Alt+Space');
    await needPreview(page, '2026-10-07', `${mode}: the date source chip previews the Daily Note`);
  }
});

test('fr_tsk_08_ac6_the_task_page_source_row_previews_and_double_click_opens_at_the_embed', async ({ page }) => {
  await startPreviews(page, { at: PV.ukol });
  const chip = await need(chipNamed(props(page), 'Porada 2026-10-27'), 'the Source row chip');
  const d = await clickToPreview(page, chip, 'Porada 2026-10-27', 'a click on the Source row chip');
  await need(d.locator('[data-preview-target]'), 'the task card is marked in the preview (AC-4)');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await chip.dblclick();
  await mustBeAtTheEmbed(page, 'a double-click on the Source row chip');
});
