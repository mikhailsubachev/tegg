// Slice Q2, L5 (WebKit + fake core): the write rules of docs/acceptance/views.md: FR-SYN-03 AC-30 (every view write checks
// its base: type file, query file, card), FR-SYN-06 AC-48 (only view actions write, once each; the fake core counts),
// FR-FMT-07 AC-33 (type files and notes round-trip), FR-FMT-12 AC-12 (NFC names and lane values), FR-STO-07 AC-10 (last
// tab, widths and folds are machine-local) and FR-LNK-03 AC-24 (rename jobs patch `views:` and relation lane values).
// Interface docs/contracts/v1-views.md §1.9, §1.10, §2.1, §4.7, §5. Written from the ACs and the contract only (D-61).
// Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  A, AUTOR_LANES, B, BOOK_YML, CTENI, NFD, Q, ROZ_LANES, board, bookWithViews, callsOf, card, click, drag, eventually, expectedView, fileText, fileWhen, lane,
  laneGrip, laneRadio, lanes, lanesOf, main, menuItem, must, mustLanes, openNote, original, panelOf, qfile, rx, runCommand, seen, selectTab, sleep, sortButton,
  sortDialog, sortLevels, startViews, swap, tab, tabMenu, tabsAre, toolbar, typeRoute, uiState, viewsOps, viewsVault, writeCalls, writes, podleStavu, podleStitku,
} from './views-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const ROZ = lanesOf(ROZ_LANES);
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
const VIEWS_OUT = '"Books" changed outside Tegg. The views weren\'t changed.';
const QUERY_OUT = 'This query changed outside Tegg. Your change wasn\'t saved.';
/** Changes a file on disk without `vault:changed` (other bytes: a comment line at the end). */
async function silently(core: Awaited<ReturnType<typeof startViews>>, rel: string) {
  await core.setFile(rel, `${await fileText(core, rel)}# změněno jinde\n`, { silent: true });
  return fileText(core, rel);
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-30

test('fr_syn_03_ac30_view_writes_check_the_base', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  // The type file: a tab drag, Show a saved query, Move view, Remove.
  const disk = await silently(core, BOOK_YML);
  await drag(page, tab(page, Q.vyb), tab(page, Q.roz), { at: 'left' });
  assert.ok(await seen(alertWith(page, VIEWS_OUT), 3000), 'a tab drag on a changed book.yml: the alert');
  assert.equal(await fileText(core, BOOK_YML), disk, 'nothing written');
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26, Q.vyb]), ['', Q.roz, Q.p26, Q.vyb], 'the tabs go back');
  // Show a saved query, Move view right and a remove, each on a book.yml changed again without `vault:changed`.
  const actions: [string, () => Promise<void>][] = [
    ['Show a saved query', async () => { await click(main(page).locator('button[data-command="views.new"]'), 'Add view'); await click(page.getByRole('menu', { name: rx('Add view') }).locator(`[data-query="${Q.zanr}"]`), 'Podle žánru'); }],
    ['Move view right', async () => { await selectTab(page, Q.roz); await runCommand(page, 'Move view right'); }],
    ['Remove', async () => { await click(menuItem(await tabMenu(page, Q.p26), 'Remove from Books page'), 'Remove'); }],
  ];
  for (const [what, act] of actions) {
    const d = await silently(core, BOOK_YML);
    const n = await page.getByRole('alert').filter({ hasText: VIEWS_OUT }).count();
    await act();
    assert.ok(await eventually(() => page.getByRole('alert').filter({ hasText: VIEWS_OUT }).count(), (c) => c > n || c >= 1, 3000), `${what}: the alert`);
    assert.equal(await fileText(core, BOOK_YML), d, `${what}: refused, nothing written`);
  }
  // A query file: Switch lanes, a lane drag, a sort change, a header click.
  await selectTab(page, Q.roz);
  const q = await silently(core, qfile(Q.roz));
  await click(laneRadio(toolbar(page), 'Horizontal'), 'Horizontal');
  assert.ok(await seen(alertWith(page, QUERY_OUT), 3000), 'Switch lanes on a changed Rozečtené.yml: refused');
  assert.equal(await fileText(core, qfile(Q.roz)), q, 'nothing written');
  // Q2.1 (FR-SYN-03 AC-31): on a tab a header click now writes book.yml's item; the query-file refusal stands on the
  // query page.
  const p = await silently(core, qfile(Q.p26));
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.p26}"] a`).first(), 'query/Přečtené 2026');
  await click(main(page).getByRole('columnheader', { name: /^⟦?Rating/ }), 'header Rating');
  assert.equal(await eventually(() => fileText(core, qfile(Q.p26)), (x) => x === p, 1000), p, 'a header click is refused');
  await runCommand(page, 'Go to type: Books');
  // A card drag: refused, the card returns to its disk state's lane, the alert names the book.
  await selectTab(page, Q.roz);
  const b = await must(board(page, Q.roz), 'Rozečtené');
  await core.setFile(B('Kniha o horách'), swap(original(B('Kniha o horách')), 'status: To read\n', 'status: Reading\n'), { silent: true });
  await drag(page, card(b, B('Kniha o horách')), lane(b, 'option:Read'));
  assert.ok(await seen(alertWith(page, '"Kniha o horách" changed outside Tegg. Your change wasn\'t saved.'), 3000), 'the card alert names the book');
  assert.ok((await fileText(core, B('Kniha o horách')))?.includes('status: Reading\n'), 'nothing written over the change');
  assert.ok(await eventually(async () => (await lanes(b)).find((l) => l.id === 'option:Reading')?.cards.includes(B('Kniha o horách')) ?? false, (x) => x, 2000), 'the card shows in its disk state\'s lane within 2 s');
  // Deleted while dragged: nothing written, it disappears. Same bytes with a new mtime: no conflict.
  await core.setFile(B('Dům u řeky'), null, { silent: true });
  await drag(page, card(b, B('Dům u řeky')), lane(b, 'option:Reading'));
  assert.equal(await fileText(core, B('Dům u řeky')), undefined, 'a deleted card writes nothing');
  await core.setFile(B('Noční vlak'), original(B('Noční vlak')), { silent: true, sameBytesTouch: true });
  await drag(page, card(b, B('Noční vlak')), lane(b, 'option:To read'));
  assert.ok(await fileWhen(core, B('Noční vlak'), (x) => !!x && x.includes('status: To read\n')), 'the same bytes with only a new mtime: no conflict (D-175)');
});

test('fr_syn_03_ac30_view_writes_check_the_base_after_a_create', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.vyb), 'tab Výborné knihy', 8000);
  await silently(core, BOOK_YML);
  await click(menuItem(await tabMenu(page, Q.vyb), 'Duplicate'), 'Duplicate');
  assert.ok(await seen(alertWith(page, 'The view was saved as a query but couldn\'t be added to the Books page.'), 3000), 'after a query create: views.addFailed');
  assert.ok(await fileText(core, qfile('Výborné knihy (2)')), 'the query stays');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-48

test('fr_syn_06_ac48_only_view_actions_write', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru, Podle autora]\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, Q.roz), 'the tabs', 8000);
  // The tour: every tab, menus and the sort popover opened and closed, folds, Čtení, the query pages and Queries.
  for (const n of [Q.roz, Q.p26, Q.vyb, Q.zanr, Q.autor]) {
    await selectTab(page, n);
    await tabMenu(page, n);
    await page.keyboard.press('Escape');
    await click(sortButton(toolbar(page)), 'sort');
    await must(sortDialog(page), 'Sort');
    await page.keyboard.press('Escape');
  }
  await selectTab(page, Q.zanr);
  await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'fold');
  await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Expand Román') }), 'unfold');
  await openNote(page, 'Čtení 2026');
  await runCommand(page, 'Go to Queries');
  await click(main(page).locator(`tr[data-query-row="${Q.roz}"] a`).first(), 'query/Rozečtené');
  await must(board(page, Q.roz), 'query/Rozečtené draws its board', 5000);
  assert.deepEqual(await writes(core), [], 'the tour writes no vault file');
  assert.deepEqual((await writeCalls(core)).filter((c) => c !== 'ui_state_set'), [], 'and calls no write command');
  // Then each action writes exactly its file, once.
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.roz);
  await click(laneRadio(toolbar(page), 'Horizontal'), 'Switch lanes');
  assert.ok(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-lanes-horizontal.yml')), 'Switch lanes writes Rozečtené.yml');
  await drag(page, card(board(page, Q.roz), B('Kniha o horách')), lane(board(page, Q.roz), 'option:Reading'));
  assert.ok(await fileWhen(core, B('Kniha o horách'), (x) => x === expectedView('books/kniha-o-horach-reading.md')), 'a card drag writes the book');
  assert.deepEqual(await writes(core), [qfile(Q.roz), B('Kniha o horách')], 'exactly those files, once each');
  assert.equal(Object.keys(await core.files()).filter((k) => k.startsWith('.tegg/') && /ui-state|index/.test(k)).length, 0, 'no index or UI state in the vault');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-33, FR-FMT-12 AC-12

test('fr_fmt_07_ac33_type_files_and_notes_round_trip', async ({ page }) => {
  for (const [variant, text, exp] of [['crlf', original(BOOK_YML).replace(/\n/g, '\r\n'), 'types/book-views-crlf-dragged.yml'], ['no-newline', original(BOOK_YML).slice(0, -1), 'types/book-views-no-newline-dragged.yml']] as const) {
    const ctx = await page.context().newPage();
    const core = await startViews(ctx, { route: typeRoute('book'), vault: viewsVault((f) => { f[BOOK_YML] = text; }) });
    await must(tab(ctx, Q.vyb), `${variant}: the tabs`, 8000);
    await drag(ctx, tab(ctx, Q.vyb), tab(ctx, Q.roz), { at: 'left' });
    assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView(exp)), expectedView(exp), `${variant}: only the views line, line endings kept`);
    await ctx.close();
  }
  // Čtení: opening, moving through its three blocks and a card drag in its board never write the note.
  const core = await startViews(page, { route: `note/${CTENI}` });
  const b = await must(board(page, Q.roz), 'Čtení\'s board', 8000);
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  await drag(page, card(b, B('Kniha o horách')), lane(b, 'option:Reading'));
  await fileWhen(core, B('Kniha o horách'), (x) => x === expectedView('books/kniha-o-horach-reading.md'));
  await sleep(1200);
  assert.equal(await fileText(core, CTENI), original(CTENI), 'Čtení byte-identical');
  assert.ok(!(await writes(core)).includes(CTENI), 'never written');
});

test('fr_fmt_12_ac12_view_names_and_lanes_are_nfc', async ({ page }) => {
  // D-1823: a runtime option `Čtu` in book.yml; NFD values of it, of `Román` and of `#doporučené` in runtime books.
  const card = (n: string, fm: string, body = 'Text.') =>
    `---\ntype: book\ntitle: ${n}\n${fm}created: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\n${body}\n`;
  const vault = viewsVault((f) => {
    f[BOOK_YML] = swap(bookWithViews(`views: [${NFD('Rozečtené')}, Přečtené 2026, Výborné knihy, Podle stavu, Podle žánru, Podle štítku]\n`),
      '      - { label: Read, color: green }\n', '      - { label: Read, color: green }\n      - { label: Čtu, color: teal }\n');
    f[qfile('Podle stavu')] = podleStavu();
    f[qfile('Podle štítku')] = podleStitku();
    f['Books/Nová NFD.md'] = card('Nová NFD', `status: ${NFD('Čtu')}\ngenres: [${NFD('Román')}]\n`, `Čtu večer. #${NFD('doporučené')}`);
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  assert.deepEqual(await tabsAre(page, [Q.roz, Q.p26, Q.vyb, 'Podle stavu', Q.zanr, 'Podle štítku'], 8000), ['', Q.roz, Q.p26, Q.vyb, 'Podle stavu', Q.zanr, 'Podle štítku'],
    'an NFD views: entry is one tab `Rozečtené`');
  await selectTab(page, 'Podle stavu');
  const s = await must(board(page, 'Podle stavu'), 'Podle stavu');
  const ls = await eventually(() => lanes(s), (l) => l.some((x) => x.id === 'option:Čtu' && x.cards.includes('Books/Nová NFD.md')));
  assert.ok(ls.some((x) => x.id === 'option:Čtu' && x.cards.includes('Books/Nová NFD.md')), 'an NFD `status: Čtu` is a card in the `Čtu` lane');
  assert.ok(!ls.some((x) => x.id !== 'option:Čtu' && x.cards.includes('Books/Nová NFD.md')), 'never in an extra lane');
  await selectTab(page, Q.zanr);
  const z = await must(board(page, Q.zanr), 'Podle žánru');
  assert.ok(await eventually(async () => (await lanes(z)).find((l) => l.id === 'option:Román')?.cards.includes('Books/Nová NFD.md') ?? false, (x) => x), 'an NFD `Román` joins the Román lane');
  await selectTab(page, 'Podle štítku');
  const t = await must(board(page, 'Podle štítku'), 'Podle štítku');
  assert.ok(await eventually(async () => (await lanes(t)).find((l) => l.id === 'tag:doporučené')?.cards.includes('Books/Nová NFD.md') ?? false, (x) => x), 'an NFD #doporučené joins the doporučené lane');
  await drag(page, tab(page, Q.vyb), tab(page, Q.roz), { at: 'left' });
  assert.ok(await fileWhen(core, BOOK_YML, (x) => !!x && x.includes('views: [Výborné knihy, Rozečtené, Přečtené 2026, Podle stavu, Podle žánru, Podle štítku]\n')), 'the views write is NFC');
  void [A, AUTOR_LANES, callsOf, laneGrip, sortLevels, mustLanes, uiState, ROZ, viewsOps];
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-10

test('fr_sto_07_ac10_view_state_is_machine_local', async ({ page }) => {
  const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]\n'); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const before = Object.keys(await core.files()).filter((k) => k.startsWith('.tegg/')).sort();
  await must(tab(page, Q.zanr), 'tabs', 8000);
  await selectTab(page, Q.zanr);
  await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'fold Román');
  await selectTab(page, Q.p26);
  // Q2.1 (R198, FR-STO-07 AC-11): folds under the tab's usage key; `typeViews.lastTab` stands.
  const ui = await eventually(() => uiState(core), (u) => u?.typeViews?.lastTab?.book === Q.p26 && Array.isArray(u?.usageFolded?.['tab:book/podle žánru']));
  assert.equal(ui?.typeViews?.lastTab?.book, Q.p26, 'typeViews.lastTab.book');
  assert.deepEqual(ui?.usageFolded?.['tab:book/podle žánru'], ['option:Román'], 'usageFolded["tab:book/podle žánru"]');
  assert.deepEqual(Object.keys(await core.files()).filter((k) => k.startsWith('.tegg/')).sort(), before, 'nothing under .tegg/ created');
  assert.deepEqual(await writes(core), [], 'nothing written');
  // A Tegg rename moves the keys; an external rename leaves them.
  await click(menuItem(await tabMenu(page, Q.p26), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'Rename query');
  await dlg.getByRole('textbox').first().fill('Přečtené letos');
  await page.keyboard.press('Enter');
  const moved = await eventually(() => uiState(core), (u) => u?.typeViews?.lastTab?.book === 'Přečtené letos', 3000);
  assert.equal(moved?.typeViews?.lastTab?.book, 'Přečtené letos', 'the rename moves the last-tab key');
  await core.renameFile(qfile(Q.zanr), qfile('Žánry'));
  await sleep(500);
  assert.deepEqual((await uiState(core))?.usageFolded?.['tab:book/podle žánru'], ['option:Román'], 'an external rename leaves the folds unused (not moved)');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-24

test('fr_lnk_03_ac24_renames_patch_views_and_lane_values', async ({ page }) => {
  const LO = 'lane_order: ["[[Marek Sova]]", "[[Eva Lindová]]"]\n';
  const vault = viewsVault((f) => {
    f[qfile(Q.autor)] = swap(f[qfile(Q.autor)], 'group_by: author\n', `group_by: author\n${LO}`);
    f['.tegg/types/autor.yml'] = swap(f['.tegg/types/autor.yml'], 'preview: [poznámka]\n', 'preview: [poznámka]\nviews: [Přečtené 2026]\n');
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  // (a) The query rename job patches every type file whose views: names it.
  await must(tab(page, Q.p26), 'tab', 8000);
  await click(menuItem(await tabMenu(page, Q.p26), 'Rename…'), 'Rename…');
  const dlg = await must(page.getByRole('dialog', { name: rx('Rename query') }), 'Rename query');
  await dlg.getByRole('textbox').first().fill('Přečtené letos');
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, BOOK_YML, (x) => x === expectedView('types/book-views-renamed.yml')), expectedView('types/book-views-renamed.yml'), '(a) book.yml');
  assert.ok((await fileText(core, '.tegg/types/autor.yml'))?.includes('views: [Přečtené letos]\n'), '(a) autor.yml');
  // (b) Renaming Marek Sova (the 4C job) patches the books' author and the lane_order entry, not the query's modified.
  await runCommand(page, 'Go to type: Autoři');
  await openNote(page, 'Marek Sova');
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'the title of Marek Sova', 5000);
  await title.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Marek Sovák');
  await page.keyboard.press('Enter');
  const q = await fileWhen(core, qfile(Q.autor), (x) => !!x && x.includes('Marek Sovák'), 5000);
  assert.equal(q, expectedView('podle-autora-lane-order-marek-sovak.yml'), '(b) only the lane_order value, modified untouched');
  assert.ok((await fileText(core, B('Kniha o horách')))?.includes('author: "[[Marek Sovák]]"\n'), '(b) the books\' author');
  void [NFD, lanesOf(AUTOR_LANES)];
});
