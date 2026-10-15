// MS3 slice 3D, L5 (WebKit + fake core): the type page (D-233). FR-TYP-09 AC-1…AC-11; FR-TYP-06 AC-5; FR-TYP-11
// AC-3. Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.3, §14.7 only (D-61). Region `cs`
// is injected (`__TEGG_REGION__`) for the date cells; the sort state goes to the machine-local UI state.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { focused, mainName, newObjectDialog } from './helpers';
import {
  P, callsOf, description, eventually, fileText, gotoTypePage, isDisabled, main, must, nonReadCalls, openTypes, rowTitles,
  runCommand, seen, settingsHeading, sleep, typeTable, typesVault,
} from './types-helpers';

const S = 'Schůzky';
const mainBName = (page: import('@playwright/test').Page) => eventually(() => mainName(page), (n) => !!n && !['Schůzky', 'Pages'].includes(n), 2000);

test('fr_typ_09_ac1_header_icon_plural_description_count_and_buttons', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, S);
  await must(main(page).getByRole('heading', { level: 1, name: S, exact: true }), 'h1 Schůzky');
  assert.ok(await seen(main(page).getByText('Porady a schůzky.', { exact: true })), 'description');
  assert.ok(await seen(main(page).getByText('3 objects', { exact: true })), 'count');
  const icon = main(page).locator('[data-icon="users"]');
  assert.ok(await seen(icon), 'type icon users (R14)');
  await must(main(page).getByRole('button', { name: 'New Schůzka', exact: true }), 'New Schůzka');
  await (await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'Type settings')).click();
  await must(settingsHeading(page, 'Schůzka'), '→ type-settings/schůzka');
});

test('fr_typ_09_ac2_rows_and_columns_from_one_index_query', async ({ page }) => {
  const core = await openTypes(page, undefined, { region: 'cs' });
  await gotoTypePage(page, S);
  const table = typeTable(page, S);
  assert.deepEqual((await table.getByRole('columnheader').allInnerTexts()).map((t) => t.trim()), ['Title', 'Datum', 'Účastníci', 'Modified'], 'Title, preview attributes in order, Modified');
  assert.deepEqual([...(await rowTitles(page, S))].sort(), ['2026-10-07 Porada', 'Prázdná schůzka', 'Schůzka ve stránkách'], 'objects whose type resolves to schůzka, wherever stored');
  const porada = table.getByRole('row').filter({ hasText: '2026-10-07 Porada' });
  assert.ok(await seen(porada.getByRole('link', { name: 'Jana Nováková' })), 'relations as link chips');
  assert.ok(await seen(porada.getByRole('cell').filter({ hasText: '7. 10. 2026' })), 'date in the region format');
  const ve = table.getByRole('row').filter({ hasText: 'Schůzka ve stránkách' });
  assert.ok(await seen(ve.locator('[role="img"][aria-hidden="true"], svg[aria-hidden="true"]').first()), 'invalid value with the warning icon');
  assert.equal((await callsOf(core, 'index_type_rows')).length, 1, 'one index query');
  const reads = (await callsOf(core, 'note_read')).length;
  assert.equal(reads, 0, 'never reads notes for rows');
});

test('fr_typ_09_ac3_sort_by_columns_and_remember_per_type', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  assert.deepEqual(await rowTitles(page, S), ['2026-10-07 Porada', 'Schůzka ve stránkách', 'Prázdná schůzka'], 'Modified descending by default');
  const hdr = (n: string) => typeTable(page, S).getByRole('columnheader', { name: n });
  assert.equal(await hdr('Modified').getAttribute('aria-sort'), 'descending');
  await hdr('Title').click();
  assert.equal(await hdr('Title').getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(await rowTitles(page, S), ['2026-10-07 Porada', 'Prázdná schůzka', 'Schůzka ve stránkách'], 'titles by collation');
  await hdr('Title').focus();
  await page.keyboard.press('Enter');
  assert.equal(await hdr('Title').getAttribute('aria-sort'), 'descending');
  await hdr('Datum').focus();
  await page.keyboard.press('Space');
  const rows = await rowTitles(page, S);
  assert.equal(rows[0], '2026-10-07 Porada', 'dates: the only valid date first');
  const ui = await eventually(() => core.uiState(), (u: any) => !!u?.typeSort?.['schůzka'], 2000) as any;
  assert.deepEqual(ui?.typeSort?.['schůzka'], { column: 'datum', dir: 'asc' }, 'kept per type in the machine-local UI state');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written to the vault');
});

test('fr_typ_09_ac3_sort_survives_a_reload_from_the_ui_state', async ({ page }) => {
  await openTypes(page, undefined, { uiState: { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, typeSort: { 'schůzka': { column: 'title', dir: 'desc' } } } as any });
  await gotoTypePage(page, S);
  assert.deepEqual(await rowTitles(page, S), ['Schůzka ve stránkách', 'Prázdná schůzka', '2026-10-07 Porada']);
  assert.equal(await typeTable(page, S).getByRole('columnheader', { name: 'Title' }).getAttribute('aria-sort'), 'descending');
});

test('fr_typ_09_ac4_title_filter_matches_like_the_switcher', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, S);
  const f = await must(main(page).getByRole('searchbox', { name: 'Filter Schůzky…' }), 'searchbox');
  for (const [q, want] of [['porada', ['2026-10-07 Porada']], ['PORADA', ['2026-10-07 Porada']], ['prazdna', ['Prázdná schůzka']], ['prázdná', ['Prázdná schůzka']]] as const) {
    await f.fill(q);
    await sleep(150);
    assert.deepEqual(await rowTitles(page, S), want, q);
  }
  await f.fill('nic takového');
  await must(main(page).getByRole('status').filter({ hasText: 'No Schůzky match "nic takového"' }), 'no-match status');
  await f.press('Escape');
  assert.equal(await f.inputValue(), '', 'Esc clears');
  assert.equal((await rowTitles(page, S)).length, 3);
});

test('fr_typ_09_ac5_rows_open_with_keyboard_and_click', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await typeTable(page, S).getByRole('row').nth(1).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await mainBName(page), 'Schůzka ve stránkách', '↓ then ⏎ opens the second row');
  assert.equal((await focused(page)).label, 'Title', 'focus on the title (D-130)');
  assert.ok((await callsOf(core, 'nav_opened')).length >= 1, 'nav_opened');
  await gotoTypePage(page, S);
  await typeTable(page, S).getByRole('row').filter({ hasText: 'Prázdná schůzka' }).click();
  assert.equal(await mainBName(page), 'Prázdná schůzka');
});

test('fr_typ_09_ac6_new_object_from_the_type_page', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  for (const how of ['palette', 'button'] as const) { // palette first: the button step opens the new note, where `New Schůzka` isn't offered (R13)
    if (how === 'button') await main(page).getByRole('button', { name: 'New Schůzka', exact: true }).click();
    else await runCommand(page, 'New Schůzka');
    const d = await must(newObjectDialog(page), `New object (${how})`);
    assert.ok((await d.innerText()).includes('Schůzka'), 'type shown');
    const create = d.getByRole('button', { name: 'Create', exact: true });
    await d.getByRole('textbox', { name: 'Title' }).fill('  ');
    assert.equal(await isDisabled(create), true, 'an empty title can\'t be created');
    if (how === 'palette') { await page.keyboard.press('Escape'); continue; }
    await d.getByRole('textbox', { name: 'Title' }).fill('Plánování');
    await page.keyboard.press('Enter');
  }
  assert.equal(await mainBName(page), 'Plánování', 'opens it');
  const created = await callsOf(core, 'note_create');
  assert.equal(created.length, 1);
  assert.equal((created[0].args as any).type, 'schůzka', 'note_create(type, title, text)');
  assert.ok((await fileText(core, 'Schůzky/Plánování.md'))?.startsWith('---\nid: '), 'Schůzky/Plánování.md');
});

test('fr_typ_09_ac8_later_controls_are_disabled_and_cells_not_editable', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, S);
  for (const l of ['Filter', 'Group', 'Add view']) {
    const b = await must(main(page).getByRole('button', { name: l, exact: true }), l);
    assert.equal(await b.getAttribute('aria-disabled'), 'true', `${l} aria-disabled`);
    assert.equal(await description(b), 'Coming in v1.0');
  }
  const tabs = await must(main(page).getByRole('tablist', { name: 'Views' }), 'tablist Views');
  assert.deepEqual((await tabs.getByRole('tab').allInnerTexts()).map((t) => t.trim()), ['All Schůzky']);
  assert.equal(await tabs.getByRole('tab').getAttribute('aria-selected'), 'true');
  assert.ok(!(await typeTable(page, S).getByRole('columnheader').allInnerTexts()).some((t) => /Links/.test(t)), 'no Links column');
  assert.equal(await typeTable(page, S).locator('input, textarea, [contenteditable="true"], select').count(), 0, 'cells aren\'t editable');
});

test('fr_typ_09_ac9_live_changes_keep_sort_and_filter', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await typeTable(page, S).getByRole('columnheader', { name: 'Title' }).click();
  await main(page).getByRole('searchbox', { name: 'Filter Schůzky…' }).fill('a');
  await core.setFile('Schůzky/Nová porada.md', '---\nid: 01JB0T0000000000000000T092\ntype: schůzka\ntitle: Nová porada\ndatum: 2026-10-20\nmodified: 2026-10-14T08:00:00+02:00\n---\n');
  const added = await eventually(() => rowTitles(page, S), (r) => r.includes('Nová porada'), 2000);
  assert.deepEqual(added, ['2026-10-07 Porada', 'Nová porada', 'Prázdná schůzka', 'Schůzka ve stránkách'], 'added within 2 s, sorted by title, filtered');
  await core.setFile(P.prazdna, null);
  assert.ok(!(await eventually(() => rowTitles(page, S), (r) => !r.includes('Prázdná schůzka'), 2000)).includes('Prázdná schůzka'), 'removed within 2 s');
  assert.equal(await main(page).getByRole('searchbox', { name: 'Filter Schůzky…' }).inputValue(), 'a', 'filter kept');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
});

test('fr_typ_09_ac10_page_and_undefined_types', async ({ page }) => {
  const vault = typesVault((f) => { f['Recepty/Svíčková.md'] = '---\nid: 01JB0T0000000000000000T093\ntype: recept\ntitle: Svíčková\n---\n'; });
  await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Pages');
  assert.deepEqual([...(await rowTitles(page, 'Pages'))].sort(), ['Bez hlavičky', 'Dva typy', 'Neplatná hlavička', 'Obyčejná stránka', 'Styl hodnot'].sort());
  await gotoTypePage(page, 'recept');
  await must(main(page).getByRole('note').filter({ hasText: 'No type definition for "recept"' }), 'note');
  for (const l of ['Type settings', 'New recept', 'Add column']) assert.equal(await main(page).getByRole('button', { name: l, exact: true }).count(), 0, `no ${l}`);
  assert.deepEqual(await rowTitles(page, 'recept'), ['Svíčková']);
});

test('fr_typ_09_ac11_type_pages_write_nothing', async ({ page }) => {
  const core = await openTypes(page);
  for (const pl of ['Schůzky', 'Projekty', 'Osoby', 'Pages', 'Tasks']) {
    await gotoTypePage(page, pl);
    await typeTable(page, pl).getByRole('columnheader', { name: 'Title' }).click();
    await main(page).getByRole('searchbox', { name: `Filter ${pl}…` }).fill('a');
    await page.mouse.wheel(0, 800);
  }
  assert.deepEqual(await nonReadCalls(core), [], 'no write commands');
  assert.deepEqual(await core.writesTo(), []);
});

test('fr_typ_06_ac5_untyped_file_is_listed_on_the_page_type_page', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, 'Pages');
  assert.ok((await rowTitles(page, 'Pages')).includes('Bez hlavičky'));
});

test('fr_typ_11_ac3_preview_properties_are_the_columns', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, 'Projekty');
  assert.deepEqual((await typeTable(page, 'Projekty').getByRole('columnheader').allInnerTexts()).map((t) => t.trim()), ['Title', 'Stav', 'Období', 'Modified']);
});
