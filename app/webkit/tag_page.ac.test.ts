// MS4 slice 4D-lite L5 (WebKit, fake core): the tag page `tag/<key>` (docs/acceptance/tags.md R82): FR-TAG-06 AC-1
// (every way in, D-692), AC-2 (header and table), AC-3 (sort **(C)**), AC-4 (text filter), AC-5 (Type filter and
// grouping **(C)**), AC-6 (remembered and shared, machine-local), AC-7 (rows open their object), AC-8 (`New with #tag`),
// AC-9 (live rows, unknown keys, D-720), AC-10 (keyboard, strings, themes); FR-TAG-01 AC-2 (no description or
// properties); FR-TAG-02 AC-4 (applying a tag in the attribute panel); FR-SYN-06 AC-31 (a browsing tour sends no write
// command). Interface docs/contracts/ms4-tags.md §1.3, §6.1, §6.2, §8.1. Written from the ACs and the contract only
// (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import { tagSuggestions } from './editor-helpers';
import {
  NAMES, P, breadcrumb, chooseRadio, click, colourTile, eventually, filterBox, flat, groupHeaders, groupingBtn, main, mainName, must, newWithBtn,
  objectsTable, openNote, openTagPage, original, pageSortBtn, rowEl, rowPaths, rowsWhen, runCommand, seen, sidebar, sleep, startTags, swap, tagActionsBtn,
  tagActionsMenu, tagHeading, tagRoute, tagRowEl, tagsVault, typeFilterBtn, vaultWrites, vypln,
} from './tags-helpers';
import { goToQuery } from './helpers'; // D-760: the Search page's Go to list replaces ⌘O

const UCTY_MODIFIED_DESC = [P.faktura, P.rozpocet, P.den, P.najem, P.dvakrat, P.banka];
const isEditor = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_tag_06_ac1_every_way_in_opens_the_tag_page', async ({ page }) => {
  const core = await openNote(page, P.faktura, 'Faktura', { readView: true });
  const ways: [string, () => Promise<void>][] = [
    ['the read view #účty chip', async () => { await click(main(page).getByRole('link', { name: /^#účty$/i }), '#účty in Faktura'); }],
    // D-761: the sidebar has no tag links any more (its `Tags` entry opens All tags, FR-TAG-07 AC-6).
    ['the Go to row Účty (the Tag file; D-760)', async () => {
      await goToQuery(page, 'Účty');
      await sleep(200);
      await page.keyboard.press('Enter');
    }],
    ['an All tags row', async () => { await runCommand(page, 'Go to Tags'); await click(tagRowEl(page, 'účty'), 'row účty'); }],
  ];
  for (const [how, go] of ways) {
    await go();
    await must(tagHeading(page, 'Účty'), `${how}: tag/účty`, 3000);
    assert.equal(await isEditor(page).count(), 0, `${how}: no editor on the Tag file (D-692)`);
    await runCommand(page, 'Go to Inbox');
    await sleep(200);
  }
  assert.deepEqual(await vaultWrites(core), [], 'opening writes nothing');
  // `type/tag`'s row Účty (no `Go to type` command for Tag, D-121: a page started on the route).
  const p2 = await page.context().newPage();
  const c2 = await startTags(p2, { route: 'type/tag' });
  await click(main(p2).getByRole('link', { name: 'Účty', exact: true }), 'type/tag row Účty');
  await must(tagHeading(p2, 'Účty'), 'type/tag row: tag/účty', 3000);
  assert.equal(await isEditor(p2).count(), 0, 'no editor');
  assert.deepEqual(await vaultWrites(c2), [], 'nothing written');
  await p2.close();
});

test('fr_tag_06_ac1_links_and_routes_to_tag_files_redirect', async ({ page }) => {
  await openNote(page, P.odkaz, 'Odkaz na štítek', { readView: true });
  await click(main(page).getByRole('link', { name: 'Účty', exact: true }), '[[Účty]] in Odkaz');
  await must(tagHeading(page, 'Účty'), '[[Účty]] opens tag/účty');
  await page.keyboard.press('Meta+BracketLeft');
  await mustOn(page, 'Odkaz na štítek');
  await click(main(page).getByRole('link', { name: /^a[ /]b$/ }), '[[a b]] in Odkaz');
  await must(tagHeading(page, 'a/b'), '[[a b]] opens tag/a%2Fb (one tag)');
  await goToQuery(page, 'Dvojí');
  await sleep(200);
  const opt = page.getByRole('option').filter({ hasText: 'Dvojí (2)' }).or(page.getByRole('option').filter({ hasText: 'Tags/Dvojí (2).md' }));
  if (await seen(opt, 800)) await opt.first().click(); else await page.keyboard.press('Enter');
  await must(tagHeading(page, 'dvojí'), 'F-Dvojí2 opens tag/dvojí');
});

async function mustOn(page: Page, name: string) {
  assert.equal(await eventually(() => mainName(page), (n) => n === name, 3000), name, `on ${name}`);
}

test('fr_tag_06_ac1_note_route_of_a_tag_file_redirects', async ({ page }) => {
  await startTags(page, { route: `note/${P.fUcty}` });
  await must(tagHeading(page, 'Účty'), 'note/Tags/Účty.md redirects to tag/účty', 5000);
  assert.equal(await isEditor(page).count(), 0, 'no editor');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_tag_06_ac2_header_and_table', async ({ page }) => {
  await openTagPage(page, 'účty');
  const bc = await must(breadcrumb(page), 'navigation "Breadcrumb"');
  assert.equal(flat(await bc.textContent()), '‹ All tags / #Účty', 'breadcrumb');
  await must(bc.getByRole('link', { name: '‹ All tags', exact: true }), 'link ‹ All tags');
  const tile = await must(colourTile(page), 'button "Tag colour"');
  assert.equal(await tile.getAttribute('data-color'), 'blue', 'the blue tile');
  assert.equal(await tile.getAttribute('aria-haspopup'), 'dialog', 'opens a dialog');
  await must(main(page).getByText('6 objects of 4 types', { exact: true }), '6 objects of 4 types');
  await must(tagActionsBtn(page), 'Tag actions');
  assert.equal(await newWithBtn(page, 'Účty').count(), 0, 'no New with button (D-762)');
  const table = await must(objectsTable(page, 'Účty'), 'table "Objects with #Účty"');
  const cols = (await table.getByRole('columnheader').allInnerTexts()).map((h) => flat(h).replace(/ [↑↓]$/, ''));
  assert.deepEqual(cols, ['Title', 'Type', 'Other tags', 'Modified'], 'exactly the four columns');
  for (const n of ['Add column', 'Columns']) assert.equal(await main(page).getByRole('button', { name: n, exact: true }).count(), 0, `no ${n}`);
  assert.equal(await main(page).getByRole('tablist').count(), 0, 'no view tabs (D-704)');
  assert.deepEqual(await rowPaths(page, 'Účty'), UCTY_MODIFIED_DESC, 'rows by Modified ↓');
  const den = await textOfRow(page, P.den);
  assert.ok(den.includes('2026-10-20') && den.includes('Daily Note'), `Den row: ${den}`);
  assert.ok((await textOfRow(page, P.rozpocet)).includes('#finance'), 'Rozpočet: Other tags #finance');
  assert.ok((await textOfRow(page, P.dvakrat)).includes('#účty/archiv'), 'Dvakrát: #účty/archiv');
  const najem = rowEl(page, 'Účty', P.najem);
  assert.equal(await najem.getAttribute('data-state'), 'done', 'Zaplatit nájem: Done (tasks.md R40)');
  assert.match(await textOfRow(page, P.najem), /Done/, 'the <completed> · Done suffix');
  assert.match(await textOfRow(page, P.banka), /Yesterday · To do/, 'Zavolat bance: <date> · Yesterday then · To do (R44)');
  assert.ok(await seen(rowEl(page, 'Účty', P.faktura).getByText('Unreviewed').or(rowEl(page, 'Účty', P.faktura).locator('[aria-description="Unreviewed"], [title="Unreviewed"]')), 500), 'Faktura: the Unreviewed dot');
});
async function textOfRow(page: Page, path: string) {
  return flat(await rowEl(page, 'Účty', path).textContent());
}

// ------------------------------------------------------------------------------------------------ AC-3, AC-4, AC-5

for (const region of ['cs', 'en']) {
  test(`fr_tag_06_ac3_column_sorts (${region})`, async ({ page }) => {
    await openTagPage(page, 'účty', { region });
    const table = await must(objectsTable(page, 'Účty'), 'the table');
    const head = (n: string) => table.getByRole('columnheader', { name: new RegExp(`^${n}`) });
    await click(head('Title'), 'Title header');
    assert.deepEqual(await rowsWhen(page, 'Účty', (r) => r[0] === P.den), [P.den, P.dvakrat, P.faktura, P.rozpocet, P.najem, P.banka], 'Title ↑: 2026-10-20, Dvakrát, Faktura, Rozpočet, Zaplatit nájem, Zavolat bance');
    assert.equal(await head('Title').getAttribute('aria-sort'), 'ascending', 'aria-sort ascending');
    await click(head('Title'), 'Title header again');
    assert.deepEqual(await rowsWhen(page, 'Účty', (r) => r[0] === P.banka), [P.banka, P.najem, P.rozpocet, P.faktura, P.dvakrat, P.den], 'Title ↓');
    assert.equal(await head('Title').getAttribute('aria-sort'), 'descending', 'aria-sort descending');
    await click(head('Modified'), 'Modified header');
    const m = await rowPaths(page, 'Účty');
    assert.ok(m.join() === UCTY_MODIFIED_DESC.join() || m.join() === [...UCTY_MODIFIED_DESC].reverse().join(), 'Modified by instant');
    await click(head('Other tags'), 'Other tags header');
    const o = await rowPaths(page, 'Účty');
    assert.deepEqual(o.slice(0, 2), [P.rozpocet, P.dvakrat], 'Other tags ↑: finance, účty/archiv, rows without other tags last (AP-661)');
    await click(head('Type'), 'Type header');
    const t = await rowPaths(page, 'Účty');
    assert.equal(t.length, 6, 'Type sort keeps the six');
  });

  test(`fr_tag_06_ac5_type_filter_and_grouping (${region})`, async ({ page }) => {
    await openTagPage(page, 'účty', { region });
    const btn = await must(typeFilterBtn(page), 'button "Type: all"');
    assert.equal(flat(await btn.textContent()), 'Type: all', 'Type: all');
    await btn.click();
    const items = (await page.getByRole('menuitemradio').allInnerTexts()).map((x) => flat(x));
    const want = await page.evaluate(async () => {
      const { collator } = await import('/src/i18n/collate.ts' as string);
      return [['Daily Note', 1], ['Page', 2], ['Quick Note', 1], ['Task', 2]].sort((a, b) => collator().compare(String(a[0]), String(b[0]))).map(([n, c]) => `${n} ${c}`);
    });
    assert.deepEqual(items, ['All types', ...want], 'All types, then each type with its count (D-122)');
    await page.getByRole('menuitemradio', { name: /^Task( 2)?$/ }).click();
    assert.equal(flat(await typeFilterBtn(page).textContent()), 'Type: Task', 'Type: Task');
    assert.deepEqual((await rowPaths(page, 'Účty')).sort(), [P.najem, P.banka].sort(), 'only the two tasks');
    await must(groupingBtn(page), 'grouping button');
    assert.equal(flat(await groupingBtn(page).textContent()), 'No grouping', 'default No grouping');
    await chooseRadio(page, groupingBtn(page), 'Type', 'grouping');
    assert.deepEqual(await groupHeaders(page, 'Účty'), ['Task 2'], 'Type: Task with grouping: one group Task 2');
    await chooseRadio(page, typeFilterBtn(page), 'All types', 'Type filter');
    assert.deepEqual(await eventually(() => groupHeaders(page, 'Účty'), (g) => g.length === 4), want, 'groups in D-122 order of type names');
  });
}

test('fr_tag_06_ac4_text_filter', async ({ page }) => {
  await openTagPage(page, 'účty');
  const f = await must(filterBox(page), 'textbox "Filter by text"');
  assert.equal(await f.getAttribute('placeholder'), 'Filter…', 'placeholder');
  for (const q of ['zavolat', 'ZAVOLAT', 'zavolat'.normalize('NFD')]) {
    await f.fill(q);
    assert.deepEqual(await rowsWhen(page, 'Účty', (r) => r.length === 1), [P.banka], `${JSON.stringify(q)} keeps Zavolat bance`);
  }
  await f.fill('najem');
  assert.deepEqual(await rowsWhen(page, 'Účty', (r) => r.length === 1), [P.najem], 'najem keeps Zaplatit nájem');
  await f.fill('xyz');
  await must(main(page).getByText('No objects match "xyz"', { exact: true }), 'No objects match "xyz"');
  await page.keyboard.press('Escape');
  assert.equal(await f.inputValue(), '', 'Esc clears');
  assert.equal((await rowsWhen(page, 'Účty', (r) => r.length === 6)).length, 6, 'all rows again');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_tag_06_ac6_sort_filter_and_grouping_are_remembered_and_shared', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  const table = await must(objectsTable(page, 'Účty'), 'table');
  await click(table.getByRole('columnheader', { name: /^Title/ }), 'Title ↑');
  await chooseRadio(page, typeFilterBtn(page), 'Task', 'Type filter');
  await chooseRadio(page, groupingBtn(page), 'Type', 'grouping');
  const st = await eventually(() => core.uiState(), (s) => !!(s as any)?.tagPage?.type, 2000);
  assert.deepEqual((st as any)?.tagPage, { sort: { column: 'title', dir: 'asc' }, type: 'task', grouping: 'type' }, 'UiStateDto.tagPage (D-703)');
  // D-761: tag/finance through the sidebar's Tags entry and All tags (the sidebar has no tag links).
  await click(sidebar(page).getByRole('link', { name: 'Tags', exact: true }), 'sidebar Tags');
  await click(page.getByRole('main').getByRole('link', { name: '#finance', exact: true }).first(), 'All tags #finance');
  await must(tagHeading(page, 'finance'), 'tag/finance');
  assert.equal(flat(await typeFilterBtn(page).textContent()), 'Type: Task', 'the same Type filter, kept on a tag without tasks (AP-661 (g))');
  assert.equal(flat(await groupingBtn(page).textContent()), 'Grouped by type', 'the same grouping');
  assert.equal(await objectsTable(page, 'finance').getByRole('columnheader', { name: /^Title/ }).getAttribute('aria-sort'), 'ascending', 'the same sort');
  assert.deepEqual(await rowPaths(page, 'finance'), [], 'an empty table');
  assert.deepEqual(await vaultWrites(core), [], 'the vault is untouched (FR-STO-07)');
});

// ------------------------------------------------------------------------------------------------ AC-7, AC-8

test('fr_tag_06_ac7_rows_open_their_object', async ({ page }) => {
  await openTagPage(page, 'účty');
  await click(rowEl(page, 'Účty', P.rozpocet).getByRole('link', { name: /Rozpočet/ }), 'row Rozpočet');
  await mustOn(page, 'Rozpočet');
  await page.keyboard.press('Meta+BracketLeft');
  await must(tagHeading(page, 'Účty'), 'back');
  const row = await must(rowEl(page, 'Účty', P.faktura), 'row Faktura');
  await row.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => mainName(page), (n) => n === '2026-10-20' || (n ?? '').includes('2026'), 3000) !== null, true, '↓ ↓ ⏎ opens the third row (Den: daily/2026-10-20)');
  await page.keyboard.press('Meta+BracketLeft');
  await must(tagHeading(page, 'Účty'), 'back again');
  await click(rowEl(page, 'Účty', P.rozpocet).getByRole('link', { name: '#finance', exact: true }), 'Other-tags chip #finance');
  await must(tagHeading(page, 'finance'), 'the chip opens its tag page');
});

// FR-TAG-06 AC-8 (`New with #tag`, D-697) is superseded by D-762: tag_page_v068.ac.test.ts tests AC-12.

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_tag_06_ac9_live_rows_and_a_tag_that_does_not_exist', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await must(objectsTable(page, 'Účty'), 'table');
  await core.setFile(vypln(5), `${original(vypln(5))}#účty\n`);
  assert.ok((await rowsWhen(page, 'Účty', (r) => r.includes(vypln(5)))).includes(vypln(5)), 'an object gaining #účty appears within 2 s');
  await core.setFile(P.faktura, original(P.faktura).replace(`#${'účty'.normalize('NFD')} `, ''));
  assert.ok(!(await rowsWhen(page, 'Účty', (r) => !r.includes(P.faktura))).includes(P.faktura), 'losing it leaves within 2 s');
  const p2 = await page.context().newPage();
  await openTagPage(p2, 'neexistuje');
  await must(p2.getByText('No objects have #neexistuje yet.', { exact: true }), 'D-720: the empty tag page');
  assert.equal(await newWithBtn(p2, 'neexistuje').count(), 0, 'no New with #neexistuje (D-762: only the text)');
  assert.equal(await tagActionsBtn(p2).count(), 0, 'no Tag actions');
  assert.equal(await colourTile(p2).count(), 0, 'no colour tile');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_tag_06_ac10_keyboard_reach_and_pseudo_locale', async ({ page }) => {
  await openTagPage(page, 'účty');
  const names = new Set<string>();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    names.add(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').replace(/\s+/g, ' ').trim(); }));
  }
  // D-762: no New with #Účty.
  for (const n of ['Tag colour', 'Tag actions', 'Filter by text']) assert.ok([...names].some((x) => x.startsWith(n)), `${n} is reachable by Tab: ${[...names].join(' | ')}`);
  const p2 = await page.context().newPage();
  await startTags(p2, { route: tagRoute('účty'), prelude: `import { setCatalog as __tsc, pseudo as __tps, en as __ten } from '/src/i18n/catalog.ts'; __tsc(__tps(__ten), 'en');` });
  await must(p2.getByRole('table', { name: /^⟦Objects with #Účty⟧$/ }), 'the pseudo-locale table name (R88 key tag.table)', 5000);
  await must(p2.getByText(/^⟦6 objects of 4 types⟧$/), 'the summary is an R88 key');
  await p2.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tag_06_ac10_contrast_with_menus_and_dialogs (${theme})`, async ({ page }) => {
    await openTagPage(page, 'účty', { theme });
    await must(objectsTable(page, 'Účty'), 'table');
    assert.deepEqual(await axeContrast(page), [], 'axe color-contrast on tag/účty');
    await click(tagActionsBtn(page), 'Tag actions');
    await must(tagActionsMenu(page), 'the menu');
    assert.deepEqual(await axeContrast(page), [], 'with the Tag actions menu open');
    await page.keyboard.press('Escape');
    await click(colourTile(page), 'Tag colour');
    await must(page.getByRole('dialog', { name: 'Tag colour', exact: true }), 'the popover');
    assert.deepEqual(await axeContrast(page), [], 'with the colour popover open');
  });
}

// ------------------------------------------------------------------------------------------------ FR-TAG-01 AC-2, FR-TAG-02 AC-4, FR-SYN-06 AC-31

test('fr_tag_01_ac2_no_description_or_properties_on_the_tag_page', async ({ page }) => {
  await openTagPage(page, 'neznámá');
  await must(tagHeading(page, 'neznámá'), 'tag/neznámá');
  assert.equal(await main(page).getByText('Stará poznámka.').count(), 0, 'no description text (D-691)');
  assert.equal(await main(page).getByText(/x-extra/).count(), 0, 'no x-extra');
  assert.equal(await page.getByRole('region', { name: 'Properties', exact: true }).count(), 0, 'no Properties region (D-693)');
  assert.equal(await page.getByPlaceholder(/description/i).count(), 0, 'no description field');
});

test('fr_tag_02_ac4_applying_a_tag_in_the_attribute_panel', async ({ page }) => {
  const core = await openNote(page, vypln(2), 'Výplň 02');
  const tags = await must(page.getByRole('region', { name: 'Properties', exact: true }).getByRole('group', { name: 'Tags' }), 'group Tags');
  await tags.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tag' }).fill('finance');
  await page.keyboard.press('Enter');
  const t = await eventually(async () => (await core.files())[vypln(2)], (x) => !!x?.includes('finance'), 3000);
  assert.ok(t?.includes('tags:'), 'tags: written');
  assert.ok(!Object.keys(await core.files()).includes('Tags/finance.md'), 'no Tag file');
  await runCommand(page, 'Go to Tags');
  await click(tagRowEl(page, 'finance'), 'finance');
  assert.ok((await rowsWhen(page, 'finance', (r) => r.includes(vypln(2)))).includes(vypln(2)), 'tag/finance lists Výplň 02 within 2 s');
});

test('fr_syn_06_ac31_browsing_tags_sends_no_write_command', async ({ page }) => {
  const core = await startTags(page, { route: 'tags' });
  await must(page.getByRole('table', { name: 'Tags', exact: true }), 'All tags');
  for (const key of Object.keys(NAMES)) {
    await runCommand(page, 'Go to Tags');
    await click(tagRowEl(page, key), `row ${key}`);
    await must(tagHeading(page, NAMES[key]), `tag/${key}`);
    if (await seen(tagActionsBtn(page), 300)) { await tagActionsBtn(page).click(); await page.keyboard.press('Escape'); }
    if (await seen(colourTile(page), 300)) { await colourTile(page).click(); await page.keyboard.press('Escape'); }
    await pageSortBtn(page).count();
  }
  const p2 = await page.context().newPage();
  const c2 = await startTags(p2, { route: 'type/tag' });
  await must(main(p2).getByRole('table', { name: 'Tags', exact: true }), 'type/tag', 5000);
  const writes2 = await vaultWrites(c2); // AP-680 (D-742): read c2's calls before closing p2
  await p2.close();
  assert.deepEqual([...(await vaultWrites(core)), ...writes2], [], 'zero write commands');
});

void tagsVault; void swap; void tagSuggestions;
