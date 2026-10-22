// MS4 slice 4D-lite L5 (WebKit, fake core): All tags and the sidebar's Tags section (docs/acceptance/tags.md R81, R83):
// FR-TAG-07 AC-1 (rows, summary, sorts, remembered, **(C)**), AC-2 (find), AC-3 (rows open the tag), AC-4 (sidebar),
// AC-5 (counts follow the trash); FR-TAG-01 AC-2 (no description column), AC-3 (type settings of Tag and `type/tag`);
// FR-TAG-02 AC-3 (the UI follows external changes); FR-TAG-03 AC-5 (a count-0 tag). Interface docs/contracts/
// ms4-tags.md §6 (routes `tags`, `tag/<key>`, `UiStateDto.tagsSort`), §8.1 (fake core). Written from the ACs and the
// contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NAMES, P, allTagsHeading, click, columnHeader, eventually, findBox, main, must, newTagBtn, newTagDialog, openAllTags, openTagPage, original, runCommand,
  seen, sidebar, sidebarTagLinks, sidebarTagsHeader, sleep, snapshot, startTags, swap, tagHeading, tagKeys, tagNameBox, tagRowEl, tagRowsText, tagsSortBtn,
  tagsTable, tagsVault, vaultWrites, vypln,
} from './tags-helpers';

/** R80's keys in `Most used ↓` order, ties by the app's D-122 collation (computed in the page). */
async function mostUsed(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async (names) => {
    const { collator } = await import('/src/i18n/collate.ts' as string);
    const c = collator();
    const counts: Record<string, number> = { 'účty': 6, 'čtení': 2, finance: 2, 'a/b': 1, 'dvojí': 1, 'neznámá': 1, 'účty/archiv': 1, 'účty-2026': 1, 'cizí': 0, 'prázdný': 0 };
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || c.compare(names[a], names[b]));
  }, NAMES);
}

for (const region of ['cs', 'en']) {
  test(`fr_tag_07_ac1_all_tags_rows_summary_and_sorts (${region})`, async ({ page }) => {
    const core = await openAllTags(page, { region });
    await must(main(page).getByText('10 tags · 11 tagged objects', { exact: true }), 'the summary (distinct objects, AP-597)');
    await must(tagsTable(page), 'table "Tags"');
    const want = await mostUsed(page);
    assert.deepEqual(want.slice(0, 3), ['účty', 'čtení', 'finance'], 'setup: Účty 6, čtení 2, finance 2 first');
    assert.deepEqual(await eventually(() => tagKeys(page), (k) => k.length === 10), want, 'Most used ↓: then the count-1 tags by D-122 name, then cizí 0 and prázdný 0');
    assert.equal(((await (await must(tagsSortBtn(page), 'the sort button')).textContent()) ?? '').trim(), 'Most used ↓', 'the sort reads Most used ↓');
    const rows = await tagRowsText(page);
    assert.deepEqual(rows[0].slice(0, 2), ['#Účty', '6'], 'Tag chip and Objects');
    assert.equal(rows[rows.length - 1][2] ?? '', '', 'prázdný: empty Last used');
    await click(columnHeader(tagsTable(page), 'Tag'), 'column header Tag');
    const byName = await page.evaluate(async (names) => { const { collator } = await import('/src/i18n/collate.ts' as string); const c = collator(); return Object.keys(names).sort((a, b) => c.compare(names[a], names[b])); }, NAMES);
    assert.deepEqual(await eventually(() => tagKeys(page), (k) => k[0] === byName[0]), byName, 'Name ↑ (D-122)');
    assert.equal(await columnHeader(tagsTable(page), 'Tag').getAttribute('aria-sort'), 'ascending', 'aria-sort');
    await click(columnHeader(tagsTable(page), 'Tag'), 'column header Tag again');
    assert.deepEqual(await eventually(() => tagKeys(page), (k) => k[0] === byName[9]), [...byName].reverse(), 'Name ↓');
    await click(columnHeader(tagsTable(page), 'Last used'), 'column header Last used');
    const lu = await tagKeys(page);
    assert.deepEqual(lu.slice(8).sort(), ['cizí', 'prázdný'], 'empty Last used last');
    await click(columnHeader(tagsTable(page), 'Last used'), 'column header Last used again');
    const lu2 = await tagKeys(page);
    assert.deepEqual(lu2.slice(0, 2), ['účty', 'finance'], 'Last used ↓: newest first');
    assert.deepEqual(lu2.slice(8).sort(), ['cizí', 'prázdný'], 'empty last in both directions');
    assert.deepEqual(await vaultWrites(core), [], 'sorting writes nothing');
  });
}

test('fr_tag_07_ac1_sort_menu_and_remembered_sort', async ({ page }) => {
  const core = await openAllTags(page);
  await click(tagsSortBtn(page), 'the sort button (aria-haspopup menu)');
  for (const item of ['Most used', 'Name', 'Last used']) await must(page.getByRole('menuitemradio', { name: item, exact: true }), `menuitemradio ${item}`);
  await click(page.getByRole('menuitemradio', { name: 'Name', exact: true }), 'Name');
  const st = await eventually(() => core.uiState(), (s) => !!(s as any)?.tagsSort, 2000);
  assert.deepEqual((st as any)?.tagsSort, { column: 'name', dir: 'asc' }, 'UiStateDto.tagsSort, machine-local (D-649)');
  assert.deepEqual(await vaultWrites(core), [], 'nothing in the vault');
});

test('fr_tag_07_ac2_find_a_tag', async ({ page }) => {
  await openAllTags(page);
  const find = await must(findBox(page), 'textbox "Find a tag"');
  assert.equal(await find.getAttribute('placeholder'), 'Find a tag…', 'placeholder');
  await find.fill('ucty');
  assert.deepEqual((await eventually(() => tagKeys(page), (k) => k.length === 3)).sort(), ['účty', 'účty-2026', 'účty/archiv'].sort(), 'ucty keeps Účty, účty/archiv, účty-2026 (folded)');
  await find.fill('#fin');
  assert.deepEqual(await eventually(() => tagKeys(page), (k) => k.length === 1), ['finance'], 'a leading # is ignored');
  await find.fill('xyz');
  await must(main(page).getByText('No tags match "xyz"', { exact: true }), 'No tags match "xyz"');
  await page.keyboard.press('Escape');
  assert.equal(await find.inputValue(), '', 'Esc clears');
  assert.equal((await eventually(() => tagKeys(page), (k) => k.length === 10)).length, 10, 'all rows again');
});

test('fr_tag_07_ac3_rows_open_the_tag', async ({ page }) => {
  await openAllTags(page);
  await click(tagRowEl(page, 'účty'), 'row účty');
  await must(tagHeading(page, 'Účty'), 'click opens tag/účty', 3000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(allTagsHeading(page), 'back on All tags');
  const row = await must(tagRowEl(page, 'finance'), 'row finance');
  await row.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await must(tagHeading(page, 'finance'), '↑/↓ and ⏎ open tag/finance');
  await page.keyboard.press('Meta+BracketLeft');
  await click(tagRowEl(page, 'a/b').getByText('1', { exact: true }), 'the count cell of a/b');
  await must(tagHeading(page, 'a/b'), 'a click on the count cell opens tag/a%2Fb (one tag, R87)');
});

test('fr_tag_07_ac4_sidebar_tags_section', async ({ page }) => {
  const core = await openAllTags(page);
  const head = await must(sidebarTagsHeader(page), 'sidebar button "Tags, all 10" (R83)');
  assert.match((await head.textContent()) ?? '', /Tags[\s\S]*All 10 ›/, 'visible text All 10 ›');
  assert.equal(await head.getAttribute('aria-current'), 'page', 'current on tags');
  assert.deepEqual(await sidebarTagLinks(page), ['#Účty 6', '#finance 2', '#dvojí 1', '#a/b 1', '#účty/archiv 1'], 'the five by Last used; never prázdný or cizí');
  await click(sidebar(page).getByRole('link', { name: /^#finance/ }), 'sidebar #finance');
  await must(tagHeading(page, 'finance'), 'tag/finance');
  assert.equal(await sidebar(page).getByRole('link', { name: /^#finance/ }).getAttribute('aria-current'), 'page', 'its link is current');
  await core.setFile(vypln(3), swap(swap(original(vypln(3)), 'title: Výplň 03\n', 'title: Výplň 03\ntags: [čtení]\n'), 'modified: 2026-09-01T09:00:00+02:00', 'modified: 2026-10-22T09:00:00+02:00'));
  assert.equal((await eventually(() => sidebarTagLinks(page), (l) => l[0] === '#čtení 3', 2500))[0], '#čtení 3', '#čtení 3 first within 2 s');
});

test('fr_tag_07_ac4_sidebar_link_of_a_tag_outside_the_five_is_not_current', async ({ page }) => {
  await openTagPage(page, 'čtení');
  await must(sidebarTagsHeader(page), 'the Tags section');
  const current = await sidebar(page).locator('[aria-current="page"]').count();
  assert.equal(current, 0, 'tag/čtení is not among the five: no link is current');
});

test('fr_tag_07_ac5_trash_and_restore_move_the_counts', async ({ page }) => {
  const core = await openAllTags(page);
  await must(tagRowEl(page, 'účty'), 'row účty');
  await core.renameFile(P.rozpocet, `.trash/${P.rozpocet}`);
  const r = await eventually(() => tagRowsText(page), (rows) => rows.some((x) => x[0] === '#Účty' && x[1] === '5'), 2500);
  assert.ok(r.some((x) => x[0] === '#Účty' && x[1] === '5'), 'účty 5 within 2 s');
  assert.ok(r.some((x) => x[0] === '#finance' && x[1] === '1'), 'finance 1');
  await core.renameFile(`.trash/${P.rozpocet}`, P.rozpocet);
  const back = await eventually(() => tagRowsText(page), (rows) => rows.some((x) => x[0] === '#Účty' && x[1] === '6'), 2500);
  assert.ok(back.some((x) => x[0] === '#finance' && x[1] === '2'), 'both back');
});

test('fr_tag_01_ac2_no_description_column', async ({ page }) => {
  await openAllTags(page);
  await must(tagsTable(page), 'table "Tags"');
  const headers = (await tagsTable(page).getByRole('columnheader').allInnerTexts()).map((h) => h.replace(/\s+/g, ' ').trim());
  assert.deepEqual(headers.map((h) => h.replace(/ [↑↓]$/, '')), ['Tag', 'Objects', 'Last used'], 'columns Tag, Objects, Last used; no description (D-637)');
  assert.equal(await main(page).getByText('Stará poznámka.').count(), 0, 'F-neznámá\'s description is shown nowhere');
});

test('fr_tag_01_ac3_type_settings_of_tag_have_no_properties', async ({ page }) => {
  const vault = tagsVault((f) => {
    f['.tegg/types/tag.yml'] = `${f['.tegg/types/tag.yml']}  - key: x-poznámka\n    name: Poznámka\n    type: text\n`;
    f[P.fAb] = swap(f[P.fAb], 'title: a/b\n', 'title: a/b\nx-poznámka: a\n');
  });
  const core = await startTags(page, { vault, route: 'type-settings/tag' });
  await must(main(page).getByText('Tags have no properties', { exact: true }), 'the hint "Tags have no properties" (D-639, AP-604)');
  assert.equal(await main(page).getByRole('button', { name: /^(Add property|New property…)$/ }).count(), 0, 'no Add property / New property…');
  assert.equal(await main(page).getByText('Poznámka', { exact: true }).count(), 0, 'the runtime attribute shows no row');
  assert.equal(await main(page).getByRole('region', { name: 'Preview properties', exact: true }).count(), 0, 'no Preview properties section (AP-604)');
  // `type/tag` (no `Go to type` command for Tag, D-121): its own page.
  const p2 = await page.context().newPage();
  const c2 = await startTags(p2, { vault, route: 'type/tag' });
  await must(main(p2).getByRole('table', { name: 'Tags', exact: true }), 'type/tag', 5000);
  const cols = main(p2).getByRole('button', { name: 'Columns', exact: true });
  if (await seen(cols, 1000)) {
    await cols.click();
    assert.equal(await p2.getByRole('menuitem', { name: 'New property…', exact: true }).count(), 0, 'type/tag Columns has no New property…');
    await p2.keyboard.press('Escape');
  }
  assert.equal(await main(p2).getByRole('columnheader', { name: /Poznámka/ }).count(), 0, 'no x-poznámka column');
  assert.deepEqual([...(await vaultWrites(core)), ...(await vaultWrites(c2))], [], 'opening these pages writes nothing');
  await p2.close();
  assert.equal((await core.files())['.tegg/types/tag.yml'], vault.files['.tegg/types/tag.yml'], 'tag.yml byte-identical');
});

test('fr_tag_03_ac5_a_count_zero_tag_is_listed', async ({ page }) => {
  await openAllTags(page);
  await click(newTagBtn(page), 'New tag');
  await must(newTagDialog(page), 'dialog New tag');
  await tagNameBox(page).fill('Účetnictví');
  await page.keyboard.press('Enter');
  await must(tagHeading(page, 'Účetnictví'), 'tag/účetnictví opens');
  await runCommand(page, 'Go to Tags');
  await must(main(page).getByText('11 tags · 11 tagged objects', { exact: true }), '11 tags');
  const row = (await tagRowsText(page)).find((r) => r[0] === '#Účetnictví');
  assert.deepEqual(row?.slice(1, 3), ['0', ''], 'count 0, empty Last used');
  assert.deepEqual(await sidebarTagLinks(page), ['#Účty 6', '#finance 2', '#dvojí 1', '#a/b 1', '#účty/archiv 1'], 'the sidebar\'s five are unchanged (D-646)');
});

test('fr_tag_02_ac3_all_tags_follows_the_files', async ({ page }) => {
  const core = await openAllTags(page);
  const before = await snapshot(core);
  await must(tagRowEl(page, 'finance'), 'row finance');
  await core.setFile(vypln(1), swap(original(vypln(1)), 'title: Výplň 01\n', 'title: Výplň 01\ntags: [finance]\n'));
  assert.ok((await eventually(() => tagRowsText(page), (r) => r.some((x) => x[0] === '#finance' && x[1] === '3'), 2500)).some((x) => x[0] === '#finance' && x[1] === '3'), 'finance → 3 within 2 s');
  await core.setFile('Tags/finance.md', '---\ntype: tag\ntitle: Finance\ncolor: orange\n---\n');
  assert.ok((await eventually(() => tagRowsText(page), (r) => r.some((x) => x[0] === '#Finance'), 2500)).some((x) => x[0] === '#Finance'), 'display name Finance');
  await sleep(300);
  const after = await snapshot(core);
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort();
  assert.deepEqual(changed, ['Tags/finance.md', vypln(1)].sort(), 'no vault write by Tegg');
});
