// Slice Q, L5 (WebKit + fake core): the query editor of docs/acceptance/queries.md R142: FR-QRY-01 AC-1…AC-7 (types, the
// attribute list, and / or on two levels, sort and limit, opening and committing once, the keyboard, no group by),
// FR-QRY-02 AC-4 (tags; `#q4` stored `q4`), AC-6 (the object picker writes `"[[…]]"`, the path form when ambiguous).
// Interface docs/contracts/v1-queries.md §4.3, §4.4 (one `query_apply` per commit, `query_run` `def` per change, Undo by
// `query_revert`), §5 (`queryCalls`, `queryRuns`). Written from the ACs and the contract only (D-61). Lookups go through
// `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, Q, attributeBox, block, blockEdit, click, connector, done, editQueryButton, editor, editorButton, eventually, expectedFile, filterRow, filterRows,
  focusName, group, limitField, main, must, mustBeOn, noteRoute, openEditor, operatorBox, pickOption, qfile, queriesVault, queryFileText, queryRoute,
  queryText, queryWrites, removeType, results, resultsAre, mustResults, resultsLine, runsSince, seen, sleep, startQueries, textOf, titleField, typeButton, valueControl,
  viewChoice, writeCalls, editorBody,
} from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const TABLE7 = [P.t5, P.t1, P.t2, P.t3, P.t4];

/** `Add filter`, then attribute / condition / value by the pointer. */
async function addFilter(page: Parameters<typeof editor>[0], attr: string, op: string, value?: string) {
  const n = await filterRows(page).count();
  await click(editorButton(page, 'Add filter'), 'Add filter');
  const row = filterRows(page).nth(n);
  await click(attributeBox(row), 'Attribute');
  await pickOption(page, attr);
  await click(operatorBox(row), 'Condition');
  await pickOption(page, op);
  if (value !== undefined) {
    const v = valueControl(row);
    const tag = await v.first().evaluate((e) => e.tagName.toLowerCase()).catch(() => '');
    if (tag === 'input' || tag === 'textarea') await v.first().fill(value);
    else { await v.first().click(); await pickOption(page, value); }
  }
  return row;
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-1

test('fr_qry_01_ac1_show_types', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await click(main(page).getByRole('button', { name: /^⟦?New query⟧?$/ }), 'New query');
  await page.keyboard.type('Ukázka typů');
  await page.keyboard.press('Enter');
  await must(editor(page), 'the editor of the new query', 5000);
  await click(typeButton(page), '`Type`');
  await pickOption(page, /^Task/);
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '7 results'), '`7 results` (the Tasks outside the trash)');
  await click(typeButton(page), '`Type`');
  await pickOption(page, /^Projekt/);
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '12 results'), 'Task + Projekt: 12');
  await done(page);
  assert.ok(await eventually(() => queryFileText(core, 'Ukázka typů'), (t) => !!t && t.includes('types: [task, projekt]')), 'the commit writes `types: [task, projekt]`');
  await click(editQueryButton(page), 'Edit query');
  await click(removeType(page, 'Task'), 'Remove Task');
  await click(removeType(page, 'Projekt'), 'Remove Projekt');
  assert.ok((await textOf(editor(page))).includes('none = all types'), 'the hint `none = all types`');
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '21 results'), 'no type: 21 (every object outside .trash/ and _templates/; no host on the query page)');
  await done(page);
  assert.ok(await eventually(() => queryFileText(core, 'Ukázka typů'), (t) => !!t && t.includes('types: []')), 'then `types: []`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-2

test('fr_qry_01_ac2_attribute_list_by_types', async ({ page }) => {
  await startQueries(page, { route: queryRoute(Q.overdue) });
  await click(editQueryButton(page), 'Edit query');
  await must(editor(page), 'the editor');
  await click(editorButton(page, 'Add filter'), 'Add filter');
  const row = filterRows(page).last();
  await click(attributeBox(row), 'Attribute');
  const lb = page.getByRole('listbox').last();
  const groups = await lb.getByRole('group').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label') ?? ''));
  assert.deepEqual(groups, ['Links', 'Every object', 'Task'], 'groups Links, Every object, Task');
  const opts = (await lb.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  assert.deepEqual(opts, ['Links to', 'Linked from', 'Title', 'Tags', 'Created', 'Modified', 'Review', 'Source', 'Aliases', 'Status', 'Priority', 'Due date', 'Completed'], 'R139\'s list for Task');
  await page.keyboard.type('pri');
  const left = (await lb.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  assert.deepEqual(left, ['Priority'], 'typing `pri` leaves Priority');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-3

test('fr_qry_01_ac3_and_or_two_levels', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  await openEditor(b, page);
  await addFilter(page, 'Status', 'is not', 'Done');
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '4 results'), '`Status is not Done`: 4');
  await click(editorButton(page, 'Add group'), 'Add group');
  const g = await must(group(page, 'all').or(group(page, 'any')), 'a filter group');
  assert.equal(await g.getByRole('button', { name: /^⟦?Add group⟧?$/ }).count(), 0, 'a group has no `Add group`');
  await click(g.getByRole('button', { name: /^⟦?Add filter to group⟧?$/ }), 'Add filter to group');
  await click(g.getByRole('button', { name: /^⟦?Add filter to group⟧?$/ }), 'Add filter to group');
  const r0 = g.locator('[role="group"][data-filter]').nth(0);
  await click(attributeBox(r0), 'Attribute'); await pickOption(page, 'Due date');
  await click(operatorBox(r0), 'Condition'); await pickOption(page, 'within next N days');
  await valueControl(r0).first().fill('14');
  const r1 = g.locator('[role="group"][data-filter]').nth(1);
  await click(attributeBox(r1), 'Attribute'); await pickOption(page, 'Priority');
  await click(operatorBox(r1), 'Condition'); await pickOption(page, 'is');
  await valueControl(r1).first().click(); await pickOption(page, 'High');
  await click(g.getByRole('button', { name: /^⟦?Combine filters with (and|or)⟧?$/ }), 'the group\'s connector');
  await pickOption(page, 'or');
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '3 results'), 'the group (any): 3');
  const c = await must(connector(page), 'the top connector on row 2');
  assert.equal(await c.getAttribute('aria-haspopup'), 'listbox', 'a menu');
  await click(c, 'connector');
  const words = await page.getByRole('listbox').last().getByRole('option').allInnerTexts();
  assert.deepEqual(words.map((w) => w.trim()), ['and', 'or'], '`and`, `or`');
  await pickOption(page, 'or');
  assert.ok(await eventually(() => textOf(resultsLine(page)), (t) => t === '7 results'), 'top `or`: all 7 tasks');
  const row3 = filterRow(page, '2');
  const word = row3.locator('span').filter({ hasText: /^or$/ }).first();
  assert.equal(await word.evaluate((e) => getComputedStyle(e).color), await page.evaluate(() => { const e = document.createElement('span'); e.style.color = 'var(--faint)'; document.body.appendChild(e); const x = getComputedStyle(e).color; e.remove(); return x; }), 'rows 3+: the word in --faint');
  assert.deepEqual(await queryWrites(core), [], 'no write while editing');
  await done(page);
  const t = await eventually(() => queryFileText(core, Q.table), (x) => !!x && x.includes('match: any'));
  assert.ok(t?.includes('match: any\nfilters:\n  - links_to: this\n  - status: { is_not: Done }\n  - group:\n      match: any\n      filters:\n        - due: { within_next_days: 14 }\n        - priority: High\n'), '`match: any` and the group in R138\'s shape');
  assert.deepEqual(await queryWrites(core), [qfile(Q.table)], 'one write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-4

test('fr_qry_01_ac4_sort_and_limit', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  await openEditor(b, page);
  const sortBox = editor(page).getByRole('combobox', { name: /^⟦?Sort⟧?$/ });
  const order = editor(page).getByRole('combobox', { name: /^⟦?(Order|Sort order)⟧?$/ }).or(editor(page).getByRole('radio', { name: /^⟦?Descending⟧?$/ })).first();
  await click(order, 'order');
  if (await seen(page.getByRole('option', { name: /^Descending$/ }), 300)) await pickOption(page, 'Descending');
  assert.deepEqual(await resultsAre(b, [P.t3, P.t2, P.t1, P.t5, P.t4]), [P.t3, P.t2, P.t1, P.t5, P.t4], 'Due descending: empty still last');
  await click(sortBox, 'Sort'); await pickOption(page, 'Priority');
  await click(order, 'order');
  if (await seen(page.getByRole('option', { name: /^Ascending$/ }), 300)) await pickOption(page, 'Ascending');
  else await click(editor(page).getByRole('radio', { name: /^⟦?Ascending⟧?$/ }), 'Ascending');
  assert.deepEqual(await resultsAre(b, [P.t1, P.t3, P.t5, P.t2, P.t4]), [P.t1, P.t3, P.t5, P.t2, P.t4], 'Priority ascending: option order, ties by title');
  await click(sortBox, 'Sort'); await pickOption(page, 'Title');
  assert.deepEqual(await resultsAre(b, [P.t1, P.t3, P.t5, P.t2, P.t4]), [P.t1, P.t3, P.t5, P.t2, P.t4], 'Title (cs): Poslat…, Připravit…, Uzavřít…, Zarezervovat…, Zeptat…');
  const lim = await must(limitField(page), 'Limit');
  for (const bad of ['0', '1001', 'abc']) {
    await lim.fill(bad);
    assert.ok(await seen(editor(page).getByText('Enter a number from 1 to 1000.'), 1000), `Limit ${bad}: refused with the field's error`);
  }
  await page.keyboard.press('Escape');
  await sleep(300);
  const t = await queryFileText(core, Q.table);
  assert.ok(t && !/limit: (0|1001|abc)/.test(t), 'nothing invalid is written');
});

test.describe('(C) en-US', () => {
  test('fr_qry_01_ac4_sort_and_limit_en_us', async ({ page }) => {
    await startQueries(page, { route: noteRoute(P.porada7), region: 'en-US' });
    const b = block(page, Q.table);
    await mustResults(b, TABLE7, 'precondition', 8000);
    await openEditor(b, page);
    await click(editor(page).getByRole('combobox', { name: /^⟦?Sort⟧?$/ }), 'Sort');
    await pickOption(page, 'Title');
    assert.deepEqual(await resultsAre(b, [P.t1, P.t3, P.t5, P.t2, P.t4]), [P.t1, P.t3, P.t5, P.t2, P.t4], 'Title with en-US');
  });
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-5

test('fr_qry_01_ac5_editor_commits_once', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  const orig = await queryFileText(core, Q.table);
  // The pencil; Esc with no change writes nothing; the focus returns to the block.
  await openEditor(b, page);
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(editor(page), 300)), 'Esc closes it');
  assert.deepEqual(await queryWrites(core), [], 'zero writes without a change');
  assert.ok(await b.evaluate((f) => f.contains(document.activeElement)), 'the focus returns to the block');
  // ⌘↩ on the selected block; each change re-runs within 300 ms without a write; Done writes once.
  await page.keyboard.press('Meta+Enter');
  await must(editor(page), '⌘↩ opens the editor');
  const from = (await core.queryRuns()).length;
  await click(viewChoice(page, 'List'), 'List');
  const runs = await eventually(() => runsSince(core, from), (r) => r.some((x) => x.source?.kind === 'def'), 300);
  assert.ok(runs.some((x) => x.source?.kind === 'def'), 'the change runs `query_run` `def` within 300 ms');
  assert.deepEqual(await queryWrites(core), [], 'no write per change');
  await done(page);
  assert.deepEqual(await eventually(() => queryWrites(core), (w) => w.length === 1), [qfile(Q.table)], 'Done: one write');
  assert.equal((await core.queryCalls()).filter((c) => c.cmd === 'query_apply').length, 1, 'one `query_apply`');
  // ⌘Z right after the commit restores the previous bytes in one write.
  await page.keyboard.press('Meta+z');
  assert.equal(await eventually(() => queryFileText(core, Q.table), (t) => t === orig), orig, 'Undo restores the previous bytes');
  assert.equal((await core.queryCalls()).filter((c) => c.cmd === 'query_revert').length, 1, 'one `query_revert`');
  // A click outside commits too; `Edit query` on the query page opens it.
  await openEditor(block(page, Q.table), page);
  await click(viewChoice(page, 'List'), 'List');
  await page.mouse.click(5, 300);
  assert.equal((await eventually(() => queryWrites(core), (w) => w.length === 3)).length, 3, 'a click outside commits (one write)');
});

test('fr_qry_01_ac5_editor_from_the_query_page', async ({ page }) => {
  const core = await startQueries(page, { route: queryRoute(Q.running) });
  await click(editQueryButton(page), '`Edit query` on the query page');
  await must(editor(page), 'the editor');
  await click(viewChoice(page, 'List'), 'List');
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => queryWrites(core), (w) => w.length === 1), [qfile(Q.running)], 'Esc after a change commits once');
  assert.equal((await focusName(page)).name, 'Edit query', 'the focus returns to `Edit query`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-6

test('fr_qry_01_ac6_editor_by_keyboard', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  await mustResults(block(page, Q.open), [P.t1, P.t2, P.t3], 'precondition', 8000);
  await (await must(editorBody(page).getByText('Další porada:'), 'the paragraph below')).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Meta+Enter');
  await must(editor(page), '↑ selects the block above, ⌘↩ opens its editor');
  assert.ok((await textOf(editor(page))).length > 0, 'opened on `Úkoly z této schůzky`');
  for (let i = 0; i < 30 && (await focusName(page)).name !== 'Add filter'; i++) await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, 'Add filter', 'Tab reaches `Add filter`');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // opens the attribute list
  await page.keyboard.type('Priority');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // `is`
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('High');
  await page.keyboard.press('Enter');
  const c = await must(connector(page), 'the connector');
  await c.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.ok(/or$/.test((await c.getAttribute('aria-label')) ?? ''), 'the connector is `or`');
  await (await must(editorButton(page, 'Add group'), 'Add group')).focus();
  await page.keyboard.press('Enter');
  await (await must(editor(page).getByRole('button', { name: /^⟦?Remove group⟧?$/ }), 'Remove group')).focus();
  await page.keyboard.press('Enter');
  assert.equal(await group(page, 'all').or(group(page, 'any')).count(), 0, 'the group is removed');
  await (await must(viewChoice(page, 'Table'), 'Table')).focus();
  await page.keyboard.press('Space');
  await (await must(editorButton(page, 'Done'), 'Done')).focus();
  await page.keyboard.press('Enter');
  const t = await eventually(() => queryFileText(core, Q.table), (x) => !!x && x.includes('priority: High'));
  assert.ok(t?.includes('match: any') && t.includes('  - priority: High') && t.includes('view: table'), 'the file: `match: any`, the Priority row, Table');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-7

test('fr_qry_01_ac7_no_group_by_yet', async ({ page }) => {
  const vault = queriesVault((f) => { f[qfile(Q.running)] = f[qfile(Q.running)].replace('view: table', 'view: table\ngroup_by: status'); });
  const core = await startQueries(page, { route: queryRoute(Q.running), vault });
  await click(editQueryButton(page), 'Edit query');
  await must(editor(page), 'the editor');
  assert.equal(await editor(page).getByText(/group by/i).count(), 0, 'no group-by control in the editor');
  assert.equal(await block(page, Q.running).getByText(/group by/i).count(), 0, 'nor in the block');
  await click(viewChoice(page, 'List'), 'List');
  await done(page);
  const t = await eventually(() => queryFileText(core, Q.running), (x) => !!x && x.includes('view: list'));
  assert.ok(t?.includes('view: list\ngroup_by: status\n'), '`group_by: status` kept byte for byte');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-02 AC-4, AC-6

test('fr_qry_02_ac4_tags_any_all_none', async ({ page }) => {
  const vault = queriesVault((f) => { f[qfile('Štítky')] = queryText({ title: 'Štítky', types: [], filters: ['tags: { has_any_of: [finance] }'] }); });
  const core = await startQueries(page, { route: queryRoute('Štítky'), vault });
  const b = block(page, 'Štítky');
  const want = [P.t1, P.t7, P.rozpocet, P.dotaz];
  assert.deepEqual((await eventually(async () => (await results(b)).sort(), (r) => r.length === 4, 8000)), [...want].sort(), '`has any of [finance]`: T1, T7, Rozpočet, Dotaz');
  await core.setFile(P.t4, (await core.files())[P.t4].replace('Bez termínu.', 'Bez termínu. #Finance'));
  assert.ok(await eventually(async () => (await results(b)).includes(P.t4), (x) => x, 2000), 'an inline `#Finance` in T4 matches');
  await click(editQueryButton(page), 'Edit query');
  const row = await addFilter(page, 'Tags', 'has all of');
  await valueControl(row).first().fill('#q4');
  await page.keyboard.press('Enter');
  await done(page);
  const t = await eventually(() => queryFileText(core, 'Štítky'), (x) => !!x && x.includes('has_all_of'));
  assert.ok(t?.includes('tags: { has_all_of: [q4] }'), 'a value typed `#q4` is stored `q4`');
});

test('fr_qry_02_ac6_links_to_and_linked_from', async ({ page }) => {
  const vault = queriesVault((f) => {
    f[qfile('Odkazy')] = queryText({ title: 'Odkazy', types: [] });
    // A duplicate in `Pages/` would take the sources' stem links `[[Výjezd Lisabon 2026]]` itself (dialect §6: same
    // folder, then the shortest path), so the duplicate title lives at a longer path that resolves none of them.
    f['Pages/Archiv/Výjezd Lisabon 2026.md'] = '---\ntype: page\ntitle: Výjezd Lisabon 2026\n---\nStejný název.\n';
  });
  const core = await startQueries(page, { route: queryRoute('Odkazy'), vault });
  await click(editQueryButton(page), 'Edit query');
  const row = await addFilter(page, 'Links to', 'links to');
  await valueControl(row).first().click();
  await page.keyboard.type('Výjezd Lisabon');
  const opts = await page.getByRole('option').allInnerTexts();
  assert.ok(opts.length >= 2, 'the object picker lists both `Výjezd Lisabon 2026`');
  await click(page.getByRole('option').filter({ hasText: 'Projekty' }).first(), 'the one in Projekty');
  await done(page);
  const t = await eventually(() => queryFileText(core, 'Odkazy'), (x) => !!x && x.includes('links_to'));
  assert.ok(t?.includes('- links_to: "[[Projekty/Výjezd Lisabon 2026]]"'), 'the picker writes the path form when the title is ambiguous');
  const b = block(page, 'Odkazy');
  const want = [P.dotaz, P.t2, P.porada7, P.bez].sort();
  assert.deepEqual(await eventually(async () => (await results(b)).sort(), (r) => JSON.stringify(r) === JSON.stringify(want)), want, 'links to Lisabon: Porada 7, T2, Dotaz, Bez hlavičky');
  assert.deepEqual(await writeCalls(core).then((w) => w.filter((c) => c !== 'query_apply')), [], 'only the commit writes');
});

void expectedFile; void mustBeOn; void typeButton;
