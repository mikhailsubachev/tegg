// Slice Q, L5 (WebKit + fake core): live results and data safety of docs/acceptance/queries.md: FR-QRY-09 AC-1 (edits in
// Tegg update open blocks), AC-3 (the testable parts: an attribute delete and an outside edit of the type file leave the
// query file alone and show the broken notice; the option and key renames are `[later]`, D-1491), AC-4 (the clock moves),
// AC-5 (no re-run storms, counted by `query_run` calls), FR-QRY-06 AC-17 (query files changed outside), FR-QRY-02 AC-7
// (trash in and out), FR-LNK-03 AC-23 (the 4C rename patches query files), FR-SYN-03 AC-28 (the base check: Conflict and
// Gone), AC-29 (unreadable and newer files are never written), FR-SYN-06 AC-44 (write counts: only query actions write,
// once each). Interface docs/contracts/v1-queries.md §2.1, §2.3, §4.4, §5 (`setFile(…, { silent })`, `sameBytesTouch`,
// `queryRuns`, `queryCalls`, `queriesFail`). Written from the ACs and the contract only (D-61). Lookups go through `must`
// (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, Q, TITLES, block, blockByMessage, blockEdit, blockInfo, blockNotice, blockStateIs, click, done, editor, editorBody, editorButton, eventually, isDisabled,
  main, must, mustBeOn, noteRoute, noteWrites, openEditor, openNote, qfile, queriesVault, queryFileText, queryRoute, queryRow, queryRows, queryText,
  queryWrites, results, resultsAre, mustResults, rowMenu, runCommand, runsSince, seen, sleep, startQueries, textOf, viewChoice, writeCalls, menuItem, actionsMenu,
} from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const OPEN7 = [P.t1, P.t2, P.t3];

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-1

test('fr_qry_09_ac1_tegg_edits_update_results', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.open);
  await mustResults(b, OPEN7, 'precondition', 8000);
  // T4's due through its own page (the attribute panel), then back.
  await openNote(page, TITLES.t4);
  await click(main(page).getByRole('button', { name: /Due date/ }).first(), 'T4\'s Due date');
  await page.keyboard.type('2026-11-20');
  await page.keyboard.press('Enter');
  await sleep(1200);
  await page.goBack();
  assert.deepEqual(await resultsAre(block(page, Q.open), [P.t1, P.t2, P.t4, P.t3], 1000), [P.t1, P.t2, P.t4, P.t3], 'T4 due 2026-11-20: 4 results, by due');
  await openNote(page, TITLES.t2);
  await click(main(page).getByRole('button', { name: /Status/ }).first(), 'T2\'s Status');
  await click(page.getByRole('option', { name: /^Done$/ }).first(), 'Done');
  await sleep(1200);
  await page.goBack();
  assert.ok(!(await eventually(() => results(block(page, Q.open)), (r) => !r.includes(P.t2), 1000)).includes(P.t2), 'T2 Done: removed');
  await openNote(page, TITLES.t6);
  await (await must(editorBody(page), 'T6 body')).click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' [[2026-10-07 Týdenní porada]]');
  await sleep(1200);
  await page.goBack();
  assert.ok((await eventually(() => results(block(page, Q.open)), (r) => r.includes(P.t6), 1000)).includes(P.t6), 'a link to Porada 7 in T6\'s body adds T6');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-3

test('fr_qry_09_ac3_type_jobs_patch_queries', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.prehled) });
  const b = block(page, Q.running);
  await mustResults(b, [P.cesta, P.cajovna, P.maly, P.lisabon], 'precondition', 8000);
  const before = (await core.files())[qfile(Q.running)];
  // Without the patch (another program edits projekt.yml): `stav` is gone, the filter is broken, nothing is rewritten.
  const proj = (await core.files())['.tegg/types/projekt.yml'];
  const noStav = proj.replace(/  - key: stav\n[\s\S]*?(?=  - key: rozpočet)/, '');
  await core.setFile('.tegg/types/projekt.yml', noStav);
  const notice = await eventually(() => textOf(blockNotice(block(page, Q.running)), 200), (t) => t.length > 0, 2000);
  assert.ok(notice.includes('stav') && notice.includes('Projekt'), `the broken notice names stav and Projekt (${notice})`);
  assert.equal((await results(block(page, Q.running))).length, 5, 'the broken row counts as absent: every project');
  assert.equal(await queryFileText(core, Q.running), before, 'the query file isn\'t rewritten');
  assert.equal(await queryFileText(core, Q.comments), queriesVault().files[qfile(Q.comments)], 'nor any other query file');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-4

test('fr_qry_09_ac4_relative_dates_follow_the_clock', async ({ page }) => {
  const vault = queriesVault((f) => {
    f[qfile('Dnes')] = queryText({ title: 'Dnes', types: ['task'], filters: ['due: { today: true }'], columns: ['due'] });
    f[P.t4] = f[P.t4].replace('priority: Low\n', 'priority: Low\ndue: 2026-11-25\n');
    f[P.porada7] = f[P.porada7] + '\n```query\nsaved: Dnes\n```\n';
  });
  await startQueries(page, { route: noteRoute(P.porada7), vault, install: true, now: '2026-11-24T23:59:50+01:00' });
  const today = block(page, 'Dnes');
  assert.equal(await blockStateIs(today, 'noResults', 8000), 'noResults', 'before midnight: nothing due today');
  const open = block(page, Q.open);
  const before = await results(open);
  await page.clock.runFor(20_000);
  assert.deepEqual(await resultsAre(today, [P.t4], 1000 + 30_000), [P.t4], 'after local midnight: T4 (due 25 Nov) within 1 s, without a vault change');
  assert.notDeepEqual(await results(open), before, '`within next 14 days` moves with the day');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-5

test('fr_qry_09_ac5_reruns_are_bounded', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  const b = block(page, Q.all);
  await mustResults(b, [P.dotaz, P.t2, P.porada7, P.bez], 'precondition', 8000);
  await sleep(500);
  const from = (await core.queryRuns()).length;
  await (await must(editorBody(page).getByText('Cesta týmu do Lisabonu.'), 'paragraph')).click();
  await page.keyboard.press('End');
  const typing = Date.now();
  for (let i = 0; i < 100; i++) await page.keyboard.type(i % 10 === 9 ? ' ' : 'a', { delay: 15 });
  const typed = Date.now();
  await sleep(2500);
  const runs = await runsSince(core, from);
  const saves = (await noteWrites(core)).filter((p) => p === P.lisabon).length;
  assert.ok(saves >= 1, 'the note autosaved');
  assert.ok(runs.length <= saves, `at most one re-run per autosave (${runs.length} runs, ${saves} saves)`);
  assert.ok(runs.every((r) => (r.at ?? 0) < typing || (r.at ?? 0) > typed), 'never while typing');
  // A change in an unrelated folder re-runs only blocks whose result could change.
  const from2 = (await core.queryRuns()).length;
  await core.setFile('Knihy/Nová kniha.md', '---\ntype: kniha\ntitle: Nová kniha\n---\nBez odkazů.\n');
  await sleep(1000);
  assert.equal((await runsSince(core, from2)).length, 0, 'a new book that links nothing doesn\'t re-run Lisabon\'s block');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-17

test('fr_qry_06_ac17_query_files_changed_outside', async ({ page }) => {
  const vault = queriesVault((f) => { f[qfile('Projekty v běhu 2')] = f[qfile(Q.running)]; f['Pages/Osoby.md'] = '---\ntype: page\ntitle: Osoby\n---\n```query\nsaved: Osoby\n```\n'; });
  const core = await startQueries(page, { route: 'queries', vault });
  await must(queryRow(page, 'Projekty v běhu 2'), 'the sync conflict copy is listed as its own query', 8000);
  await core.setFile(qfile('Osoby'), queryText({ title: 'Osoby', types: ['osoba'] }));
  assert.ok((await eventually(() => queryRows(page), (r) => r.some((x) => x.name === 'Osoby'), 2000)).some((x) => x.name === 'Osoby'), 'a created file adds a row within 2 s');
  assert.ok((await textOf(main(page))).includes('13 queries'), 'and the count');
  await openNote(page, 'Osoby');
  const b = block(page, 'Osoby');
  assert.deepEqual(await resultsAre(b, [P.jana], 3000), [P.jana], 'its block: Jana');
  await core.setFile(qfile('Osoby'), queryText({ title: 'Osoby', types: ['kniha'] }));
  assert.deepEqual((await eventually(() => results(b), (r) => r.length === 2, 2000)).sort(), [P.krakatit, P.mloci].sort(), 'editing `types` to [kniha] updates the open block within 2 s');
  await core.setFile(qfile('Osoby'), null);
  await must(blockByMessage(page, 'The query “Osoby” doesn\'t exist.'), 'deleting it: not found', 2000);
  await runCommand(page, 'Go to Queries');
  assert.ok(!(await queryRows(page)).some((r) => r.name === 'Osoby'), 'its row disappears');
  assert.ok((await core.files())[qfile('Projekty v běhu 2')] !== undefined, 'nothing renames, merges or deletes the conflict copy');
  assert.deepEqual(await queryWrites(core), [], 'no query write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-02 AC-7

test('fr_qry_02_ac7_no_trash_templates_or_host', async ({ page }) => {
  const vault = queriesVault((f) => {
    f[P.sablona] = f[P.sablona] + '\n[[Výjezd Lisabon 2026]]\n';
    f[P.lisabon] = f[P.lisabon].replace('Cesta týmu do Lisabonu.', 'Cesta týmu do Lisabonu. Viz [[Výjezd Lisabon 2026]].');
  });
  const core = await startQueries(page, { route: noteRoute(P.lisabon), vault });
  const b = block(page, Q.all);
  assert.deepEqual(await resultsAre(b, [P.dotaz, P.t2, P.porada7, P.bez], 8000), [P.dotaz, P.t2, P.porada7, P.bez], 'no template, no host (its self-link), no trash');
  await openNote(page, TITLES.porada7);
  const o = block(page, Q.open);
  assert.deepEqual(await resultsAre(o, OPEN7), OPEN7, 'Smazaný (in the trash) isn\'t a result');
  await core.renameFile(P.t1, `.trash/${P.t1}`);
  assert.deepEqual(await resultsAre(o, [P.t2, P.t3], 1000), [P.t2, P.t3], 'moving T1 to the trash removes it within 1 s');
  await core.renameFile(`.trash/${P.t1}`, P.t1);
  assert.deepEqual(await resultsAre(o, OPEN7, 1000), OPEN7, 'restoring brings it back');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-23

test('fr_lnk_03_ac23_renames_patch_query_files', async ({ page }) => {
  const odkazy = [
    '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Odkazy.', 'version: 1', 'title: Odkazy', 'types: []', 'match: all', 'filters:',
    '  - links_to: "[[Výjezd Lisabon 2026]]"', '  - vlastník: { links_to: "[[Jana Nováková]]" }', '  - linked_from: this', 'sort: { by: title, order: asc }',
    'limit: 50', 'view: list', 'columns: [type, modified]', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '',
  ].join('\n');
  const lisabonske = queryText({ title: 'Lisabonské', types: [], filters: ['links_to: "[[Výjezd Lisabon 2026]]"'] });
  const vault = queriesVault((f) => {
    f[qfile('Odkazy')] = odkazy;
    f[qfile('Lisabonské')] = lisabonske;
    f['Pages/Lisabonské.md'] = '---\ntype: page\ntitle: Lisabonské\n---\n```query\nsaved: Lisabonské\n```\n';
  });
  const core = await startQueries(page, { route: noteRoute('Pages/Lisabonské.md'), vault });
  const LINKING = [P.porada7, P.t2, P.dotaz, P.bez].sort();
  assert.deepEqual(await eventually(async () => (await results(block(page, 'Lisabonské'))).sort(), (r) => r.length === 4, 8000), LINKING, 'before: what links to Lisabon');
  await openNote(page, TITLES.lisabon);
  const others = await core.files();
  await (await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title', 8000)).click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Výjezd Lisabon 2027');
  await page.keyboard.press('Enter');
  const jobs = await eventually(() => core.jobs(), (j) => j.some((x) => x.kind === 'note-rename' && x.phase === 'done'), 5000);
  const job = jobs.find((x) => x.kind === 'note-rename')!;
  assert.equal(await queryFileText(core, 'Odkazy'), odkazy.replace('"[[Výjezd Lisabon 2026]]"', '"[[Výjezd Lisabon 2027]]"'), 'only that value; `modified` and `this` untouched');
  assert.ok(job.written.includes(qfile('Odkazy')), 'a row of the job');
  assert.equal(await queryFileText(core, 'Lisabonské'), lisabonske.replace('"[[Výjezd Lisabon 2026]]"', '"[[Výjezd Lisabon 2027]]"'), 'Lisabonské: its value too');
  await openNote(page, 'Lisabonské');
  assert.deepEqual(await eventually(async () => (await results(block(page, 'Lisabonské'))).sort(), (r) => r.length === 4, 2000), LINKING, 'the block keeps its results after the rename');
  for (const name of [Q.open, Q.table, Q.all, Q.running, Q.books, Q.cancelled, Q.overdue, Q.today, Q.comments, Q.newer, Q.broken]) {
    assert.equal(await queryFileText(core, name), others[qfile(name)], `${name}: untouched`);
  }
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Výjezd Lisabon 2027', 'back on the renamed note');
  await runCommand(page, 'Undo rename');
  assert.equal(await eventually(() => queryFileText(core, 'Odkazy'), (t) => t === odkazy, 5000), odkazy, 'Undo restores the query file');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-28

test('fr_syn_03_ac28_query_writes_check_the_base', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.prehled) });
  const b = block(page, Q.running);
  await mustResults(b, [P.cesta, P.cajovna, P.maly, P.lisabon], 'precondition', 8000);
  await openEditor(b, page);
  await click(viewChoice(page, 'List'), 'List');
  const outside = (await queryFileText(core, Q.running))!.replace('limit: 50', 'limit: 40');
  await core.setFile(qfile(Q.running), outside, { silent: true });
  await click(editorButton(page, 'Done'), 'Done');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: 'This query changed outside Tegg. Your change wasn\'t saved.' }), 2000), 'the alert');
  assert.ok(!(await seen(editor(page), 300)), 'the editor closes');
  assert.equal(await queryFileText(core, Q.running), outside, 'nothing is written');
  assert.equal((await core.queryCalls()).filter((c) => c.cmd === 'query_apply' && c.ok === false).length, 1, 'the commit was refused (`Conflict`)');
  assert.ok(await seen(b.locator('table'), 1000), 'the block reloads from disk (still Table)');
  // Same bytes with only a new mtime isn't a conflict.
  await openEditor(b, page);
  await click(viewChoice(page, 'List'), 'List');
  await core.setFile(qfile(Q.running), outside, { sameBytesTouch: true });
  await click(editorButton(page, 'Done'), 'Done');
  assert.ok(await eventually(() => queryFileText(core, Q.running), (t) => !!t && t.includes('view: list')), 'an mtime-only change: the commit writes');
  // Deleted meanwhile: Gone, nothing created.
  await openEditor(block(page, Q.running), page);
  await click(viewChoice(page, 'Table'), 'Table');
  await core.setFile(qfile(Q.running), null, { silent: true });
  await click(editorButton(page, 'Done'), 'Done');
  await sleep(500);
  assert.equal(await queryFileText(core, Q.running), undefined, '`Gone`: nothing is created');
  // New query refuses when another program created the name first.
  await runCommand(page, 'New query…');
  await core.setFile(qfile('Souběh'), queryText({ title: 'Souběh' }), { silent: true });
  const field = page.getByRole('dialog', { name: /^⟦?New query⟧?$/ }).getByRole('textbox');
  await (await must(field, 'Query name')).fill('Souběh');
  await page.keyboard.press('Enter');
  assert.ok(await seen(page.getByText('A query with this name already exists.'), 2000), 'RENAME_EXCL: NameTaken');
  assert.equal(await queryFileText(core, 'Souběh'), queryText({ title: 'Souběh' }), 'the other program\'s file is kept');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-29

test('fr_syn_03_ac29_unreadable_query_files_are_kept', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  const orig = await core.files();
  const v1 = await core.version(qfile(Q.broken));
  const v2 = await core.version(qfile(Q.newer));
  await must(queryRow(page, Q.broken), 'row Nečitelný', 8000);
  // Rename is disabled / refused for both; the newer one is read-only.
  await queryRow(page, Q.broken).focus();
  await page.keyboard.press('Shift+F10');
  assert.ok(!(await textOf(actionsMenu(page))).includes('Rename'), 'Nečitelný: no Rename…');
  await page.keyboard.press('Escape');
  const m = await rowMenu(page, Q.newer);
  assert.ok(await isDisabled(menuItem(m, 'Rename…')), 'Novější verze: Rename… disabled');
  await page.keyboard.press('Escape');
  await click(queryRow(page, Q.newer), 'Novější verze');
  const nb = block(page, Q.newer);
  assert.equal(await blockEdit(nb).getAttribute('aria-disabled'), 'true', 'Edit query disabled');
  assert.equal(await blockEdit(nb).getAttribute('aria-description'), 'Made by a newer version of Tegg. Read-only.', 'with R141\'s message');
  // A tour leaves their bytes, versions and paths alone.
  await runCommand(page, 'Go to Queries');
  await click(queryRow(page, Q.broken), 'Nečitelný');
  await openNote(page, 'Přehled dotazů');
  await sleep(500);
  assert.equal((await core.files())[qfile(Q.broken)], orig[qfile(Q.broken)], 'Nečitelný: same bytes');
  assert.equal((await core.files())[qfile(Q.newer)], orig[qfile(Q.newer)], 'Novější verze: same bytes');
  assert.deepEqual([await core.version(qfile(Q.broken)), await core.version(qfile(Q.newer))], [v1, v2], 'and the same versions (mtime)');
  assert.ok(!(await core.queryCalls()).some((c) => [Q.broken, Q.newer].includes(c.args?.name) && c.ok), 'no write call on them succeeded');
  // Another program fixes Nečitelný: its blocks recover within 2 s.
  await core.setFile(qfile(Q.broken), orig[qfile(Q.broken)].replace('match: all: any', 'match: all'));
  const b = block(page, Q.broken);
  assert.notEqual(await eventually(() => blockInfo(b).then((x) => x.state), (s) => s !== 'unreadable', 2000), 'unreadable', 'the block recovers');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-44

test('fr_syn_06_ac44_only_query_actions_write', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  await mustResults(block(page, Q.open), OPEN7, 'precondition', 8000);
  // The tour: every fixture note with blocks and every query page; Esc on editors and menus; scrolling; Show more.
  for (const t of [TITLES.porada14, TITLES.lisabon, 'Přehled dotazů', '2026-11-10', TITLES.porada7]) {
    await openNote(page, t);
    await page.mouse.wheel(0, 800);
    const first = main(page).locator('figure[data-query-block]').first();
    if (await seen(blockEdit(first), 1000)) { await openEditor(first, page); await page.keyboard.press('Escape'); }
  }
  await runCommand(page, 'Go to Queries');
  for (const r of await queryRows(page)) {
    await runCommand(page, 'Go to Queries');
    await click(queryRow(page, r.name), r.name);
    await must(main(page).getByRole('heading', { level: 1 }), `${r.name}: its query page`);
  }
  await sleep(1000);
  assert.deepEqual(await writeCalls(core), [], 'the tour sends no write call');
  assert.deepEqual(await core.writesTo(), [], 'and writes no file');
  // Then each action writes exactly its files, once.
  await runCommand(page, 'Go to Queries');
  await click(menuItem(await rowMenu(page, Q.running), 'Duplicate'), 'Duplicate');
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length === 1), [qfile('Projekty v běhu (2)')], 'Duplicate: one file');
  await click(main(page).getByRole('button', { name: /^⟦?Edit query⟧?$/ }), 'Edit query');
  await click(viewChoice(page, 'List'), 'List');
  await done(page);
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length === 2), [qfile('Projekty v běhu (2)'), qfile('Projekty v běhu (2)')], 'a commit: that file, once');
  assert.deepEqual((await noteWrites(core)), [], 'no note `modified` change');
  assert.ok(!(await core.writesTo()).some((p) => p.startsWith('.tegg/') && !p.startsWith('.tegg/queries/')), 'no index or UI state in the vault');
});

void queryRoute;
