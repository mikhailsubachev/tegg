// Slice Q2, L5 (WebKit + fake core): boards of docs/acceptance/views.md R187, R193: FR-QRY-05 AC-10…AC-22 (a board by a
// select, other groupings, cards, card drags and their bytes, `No <attribute>` / unknown / excluded lanes, the lanes
// switch, folding, lane order, no paging, a board in a note and on the query page, the board by keyboard), FR-QRY-08 AC-2
// (New <Type> in <lane>) and FR-QRY-09 AC-6, AC-7 (live boards). Interface docs/contracts/v1-views.md §1.9, §2, §4.3…§4.5,
// §4.7. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  AUTOR_LANES, B, BOOK_YML, CTENI, NFD, Q, ROZ_LANES, ZANR_LANES, block, board, bookWithViews, callsOf, card, click, description, drag, dropLabel, editor,
  eventually, expectedView, fileText, fileWhen, lane, laneGrip, laneRadio, lanes, lanesAre, lanesGroup, lanesOf, liveRegion, main, mainName, menuItem, menuTexts,
  must, mustBeOn, mustLanes, newInLane, openNote, original, panelOf, panelRows, podleStavu, podleStitku, qfile, queryRoute, rx, runCommand, seen, selectTab,
  sleep, startViews, swap, tab, textOf, toolbar, toolbarMenuButton, typeRoute, uiState, viewMenu, viewQuery, viewsVault, writeCalls, writes,
} from './views-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const ROZ = lanesOf(ROZ_LANES);
/** A vault whose book.yml lists `extra` as tabs after the fixture's three. */
const withTabs = (extra: string[], edit?: (f: Record<string, string>) => void) => viewsVault((f) => {
  f[BOOK_YML] = bookWithViews(`views: [Rozečtené, Přečtené 2026, Výborné knihy${extra.map((e) => `, ${e}`).join('')}]\n`);
  edit?.(f);
});
async function openBoard(page: Page, name: string): Promise<Locator> {
  await must(tab(page, name), `tab ${name}`, 8000);
  await selectTab(page, name);
  return must(board(page, name), `the board ${name}`, 5000);
}
/** Successful vault writes (notes and query files, `writesTo`). */
const vaultWrites = (core: Awaited<ReturnType<typeof startViews>>) => writes(core);

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-10, AC-11

test('fr_qry_05_ac10_board_by_select', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, 'Rozečtené (R193)');
  assert.equal(await b.getAttribute('data-lanes'), 'vertical', 'vertical');
  assert.equal(await b.getAttribute('data-group-by'), 'status', 'grouped by status');
  const ls = await lanes(b);
  assert.deepEqual(ls.map((l) => l.label), ['Reading, 3 Books', 'To read, 2 Books', 'Read, 0 Books'], 'lane names with counts in the type plural (CP-28, D-1930)');
  assert.deepEqual(ls.map((l) => l.excluded), [false, false, true], '`Read` excluded');
  const read = lane(b, 'option:Read');
  assert.equal(flat(await textOf(read.locator('p.lane-excluded'))), 'Not in this view', 'hatched with `Not in this view`');
  assert.equal(await newInLane(b, 'option:Read').count(), 0, 'no `+` on Read');
  assert.equal(await lane(b, 'option:Reading').locator('h2').getAttribute('data-color'), 'blue', 'the heading in the option colour (Reading: blue)');
  assert.equal(await b.locator('[data-attribute="status"]').count(), 0, 'no Status pill on any card');
  await click(toolbarMenuButton(page), '⋯');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  const view = editor(page).getByRole('radiogroup', { name: rx('View') });
  // D-1886: wait until the dialog shows its options before reading them (allInnerTexts doesn't wait).
  assert.deepEqual(await eventually(() => view.getByRole('radio').allInnerTexts(), (t) => t.length === 3, 5000), ['Table', 'List', 'Board'], 'the View control offers Table, List, Board');
  await page.keyboard.press('Escape');
  // A runtime lane_order: [To read] lists the others after it in option order.
  await core.setFile(qfile(Q.roz), swap(original(qfile(Q.roz)), 'lane_order: [Reading, To read, Read]\n', 'lane_order: [To read]\n'));
  assert.deepEqual((await lanesAre(b, [ROZ[1], ROZ[0], ROZ[2]], 2000)).map((l) => l.id), ['option:To read', 'option:Reading', 'option:Read'], '`To read`, then `Reading`, `Read`');
});

test('fr_qry_05_ac11_group_by_kinds', async ({ page }) => {
  const vault = withTabs([Q.zanr, Q.autor, 'Podle štítku', Q.datum], (f) => {
    f[qfile('Podle štítku')] = podleStitku();
    f[qfile('Autoři podle poznámky')] = viewQuery({ title: 'Autoři podle poznámky', types: ['autor'], extra: ['group_by: poznámka'], columns: ['poznámka'] });
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const z = await openBoard(page, Q.zanr);
  await mustLanes(z, lanesOf(ZANR_LANES), 'Podle žánru (R193)');
  assert.equal(await z.getAttribute('data-lanes'), 'horizontal', 'horizontal');
  for (const [title, ids] of [['Sto zimních dní', ['option:Román', 'option:Eseje']], ['Čarovná mapa', ['option:Román', 'option:Cestopis']], ['Účetní ze Žižkova', ['option:Román', 'option:Detektivka']]] as const) {
    for (const id of ids) {
      const pills = await card(z, B(title), id).locator('span.card-pill[data-attribute="genres"]').allInnerTexts();
      assert.ok(pills.length >= 2, `${title} in ${id}: all its genres on the card (${pills.join(', ')})`);
    }
  }
  assert.equal(await card(z, B('Mapa bez severu')).locator('span.card-pill[data-attribute="genres"]').count(), 0, 'Mapa bez severu (one genre): no genre pill');
  const a = await openBoard(page, Q.autor);
  await mustLanes(a, lanesOf(AUTOR_LANES), 'Podle autora (R193, no `lanes`: vertical)');
  assert.equal(await a.getAttribute('data-lanes'), 'vertical', 'no `lanes` key: vertical');
  assert.equal(await a.locator('a.chip[data-attribute="author"]').count(), 0, 'no author chip');
  const t = await openBoard(page, 'Podle štítku');
  const tl = await lanes(t);
  assert.deepEqual(tl.map((l) => [l.id, l.cards.length]), [['tag:doporučené', 2], ['tag:odloženo', 1], ['tag:večerní', 1], ['none', 13]], 'Podle štítku: four lanes, the inline #večerní included');
  await selectTab(page, Q.datum);
  assert.ok(await seen(panelOf(page).getByText('The setting group_by can\'t be read, so its default is used.'), 3000), 'Seskupeno podle data: the notice');
  assert.equal(await board(page).count(), 0, 'drawn as a List, no board');
  assert.equal((await panelRows(page)).length, 17, 'the 17 books');
  assert.deepEqual(await writeCalls(core), [], 'no file is written');
  // group_by on a view: table is kept and ignored, no notice.
  await core.setFile(qfile(Q.vyb), swap(original(qfile(Q.vyb)), 'view: table\n', 'view: table\ngroup_by: status\n'));
  await selectTab(page, Q.vyb);
  await sleep(500);
  assert.equal(await panelOf(page).getByText('The setting group_by can\'t be read, so its default is used.').count(), 0, '`group_by` with `view: table`: ignored, no notice');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-12

test('fr_qry_05_ac12_cards', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  const u = card(b, B('Účetní ze Žižkova'));
  await must(u, 'the card of Účetní ze Žižkova');
  assert.equal(await u.getAttribute('aria-label'), 'Book: Účetní ze Žižkova', 'an article `Book: Účetní ze Žižkova`');
  assert.ok(await seen(u.locator('a[data-card-title]'), 500), 'the title link');
  assert.ok(await seen(u.getByRole('button', { name: 'More actions for "Účetní ze Žižkova"' }), 500), '`More actions for "Účetní ze Žižkova"`');
  assert.equal(await u.locator('span.card-tag').count(), 0, 'no tags');
  assert.ok(flat(await textOf(u.locator('p.card-excerpt'))).startsWith('Kriminálka z kanceláře nad hospodou.'), 'the body\'s first lines');
  // Slice Q2-T (AC-Test-Change, D-1912; D-1891, R205): cards show Book's `preview: [author, status]`, not `columns`; Status is
  // the grouping key, so only the author chip: no Rating pill, no `No Rating`.
  assert.equal(await u.locator('span.card-pill[data-attribute="rating"]').count(), 0, 'no Rating pill (columns aren\'t read on a board)');
  assert.ok(await seen(u.locator('footer a.chip[data-attribute="author"]').filter({ hasText: 'Jana Brázdová' }), 500), 'the footer chip `Jana Brázdová`');
  const dum = card(b, B('Dům u řeky'));
  assert.deepEqual(await dum.locator('span.card-tag').allInnerTexts(), ['#doporučené'], 'Dům u řeky shows #doporučené');
  await click(dum.getByRole('button', { name: 'More actions for "Dům u řeky"' }), 'More actions');
  const menu = await must(page.getByRole('menu').last(), 'the card menu');
  assert.deepEqual((await menuTexts(menu)).slice(0, 2), ['Open', 'Move to'], '`Open`, `Move to`');
  await click(menuItem(menu, 'Move to'), 'Move to');
  assert.deepEqual(await menuTexts(page.getByRole('menu').last()), ['Reading', 'Read'], '`Move to` › Reading, Read');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await click(dum.locator('a[data-card-title]'), 'the title');
  await mustBeOn(page, 'Dům u řeky', 'a click on the title opens note/Books/Dům u řeky.md');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-13, AC-14

test('fr_qry_05_ac13_card_drag_writes_once', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, 'precondition');
  const kniha = card(b, B('Kniha o horách'));
  // Its own lane, outside any lane, Esc: nothing.
  await drag(page, kniha, lane(b, 'option:To read'));
  await drag(page, kniha, { dx: 0, dy: -600 });
  await drag(page, kniha, lane(b, 'option:Reading'), { esc: true });
  assert.deepEqual(await vaultWrites(core), [], 'own lane, outside, Esc: no write');
  await mustLanes(b, ROZ, 'the card returns');
  let label = '';
  await drag(page, kniha, lane(b, 'option:Reading'), { beforeUp: async () => { label = flat(await textOf(dropLabel(page)).catch(() => '')); } });
  assert.equal(label, 'Drop to set Status: Reading', 'the drop label over the target');
  assert.equal(await fileWhen(core, B('Kniha o horách'), (x) => x === expectedView('books/kniha-o-horach-reading.md')), expectedView('books/kniha-o-horach-reading.md'), 'line 6 and line 9 only');
  assert.deepEqual(await vaultWrites(core), [B('Kniha o horách')], 'one write of that book, nothing else');
  const after = await lanes(b);
  assert.deepEqual(after.map((l) => [l.id, l.cards[0] ?? null, l.cards.length]), [['option:Reading', B('Kniha o horách'), 4], ['option:To read', B('Dům u řeky'), 1], ['option:Read', null, 0]], 'first in Reading (4), To read 1');
  assert.ok((await textOf(liveRegion(page))).includes('Moved "Kniha o horách" to Reading'), 'the live region');
});

test('fr_qry_05_ac13_card_drag_writes_once_into_a_folded_row', async ({ page }) => {
  const vault = withTabs([Q.zanr]);
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, Q.zanr);
  await click(lane(b, 'option:Poezie').getByRole('button', { name: rx('Collapse Poezie') }), 'Collapse Poezie');
  assert.ok((await lanes(b)).find((l) => l.id === 'option:Poezie')?.folded, 'Poezie folded');
  await drag(page, card(b, B('Sto zimních dní'), 'option:Eseje'), lane(b, 'option:Poezie'));
  assert.equal(await fileWhen(core, B('Sto zimních dní'), (x) => x === expectedView('books/sto-zimnich-dni-poezie.md')), expectedView('books/sto-zimnich-dni-poezie.md'), 'a drop on a folded row lands in that lane');
});

test('fr_qry_05_ac14_multi_value_and_relation_drags', async ({ page }) => {
  const vault = withTabs([Q.zanr, Q.autor, 'Podle štítku'], (f) => { f[qfile('Podle štítku')] = podleStitku(); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const z = await openBoard(page, Q.zanr);
  await mustLanes(z, lanesOf(ZANR_LANES), 'precondition');
  const steps: [string, string, string, string, boolean][] = [
    ['Sto zimních dní', 'option:Eseje', 'option:Poezie', 'books/sto-zimnich-dni-poezie.md', false],
    ['Čarovná mapa', 'option:Cestopis', 'option:Eseje', 'books/carovna-mapa-eseje.md', false],
    ['Ostrov bez jména', 'none', 'option:Poezie', 'books/ostrov-bez-jmena-poezie.md', false],
  ];
  for (const [title, from, to, exp, alt] of steps) {
    await drag(page, card(z, B(title), from), lane(z, to), { alt });
    assert.equal(await fileWhen(core, B(title), (x) => x === expectedView(exp)), expectedView(exp), `${title}: ${from} → ${to}`);
  }
  let label = '';
  await drag(page, card(z, B('Mapa bez severu'), 'option:Román'), lane(z, 'option:Poezie'), { alt: true, beforeUp: async () => { label = flat(await textOf(dropLabel(page)).catch(() => '')); } });
  assert.equal(label, 'Drop to add Poezie', '(d) Alt: `Drop to add Poezie`');
  assert.equal(await fileWhen(core, B('Mapa bez severu'), (x) => x === expectedView('books/mapa-bez-severu-alt-poezie.md')), expectedView('books/mapa-bez-severu-alt-poezie.md'), '(d) genres: [Román, Poezie]');
  const n = (await writes(core)).length;
  await drag(page, card(z, B('Mapa bez severu'), 'option:Román'), lane(z, 'option:Poezie'), { alt: true });
  assert.equal((await writes(core)).length, n, '(d) Alt onto a lane it already has writes nothing');
  assert.deepEqual((await writes(core)).filter((p) => p.endsWith('.md')), [B('Sto zimních dní'), B('Čarovná mapa'), B('Ostrov bez jména'), B('Mapa bez severu')], 'each is one write of that book');
  // (b) separately on a fresh fixture state: Román → Eseje when Eseje is already there.
  await core.setFile(B('Sto zimních dní'), original(B('Sto zimních dní')));
  await sleep(300);
  await drag(page, card(z, B('Sto zimních dní'), 'option:Román'), lane(z, 'option:Eseje'));
  assert.equal(await fileWhen(core, B('Sto zimních dní'), (x) => x === expectedView('books/sto-zimnich-dni-eseje-only.md')), expectedView('books/sto-zimnich-dni-eseje-only.md'), '(b) genres: [Eseje]');
  // A relation drag and a tag drag.
  const a = await openBoard(page, Q.autor);
  await drag(page, card(a, B('Dům u řeky')), lane(a, `relation:Autoři/Marek Sova.md`));
  assert.equal(await fileWhen(core, B('Dům u řeky'), (x) => x === expectedView('books/dum-u-reky-marek-sova.md')), expectedView('books/dum-u-reky-marek-sova.md'), 'author: "[[Marek Sova]]"');
  const t = await openBoard(page, 'Podle štítku');
  await drag(page, card(t, B('Světla přístavu'), 'tag:večerní'), lane(t, 'tag:doporučené'));
  assert.equal(await fileWhen(core, B('Světla přístavu'), (x) => x === expectedView('books/svetla-pristavu-doporucene.md')), expectedView('books/svetla-pristavu-doporucene.md'), 'tags: [doporučené] appended, the body byte-identical');
  assert.ok((await textOf(liveRegion(page))).includes('#večerní is in the text of "Světla přístavu" and stays.'), 'the inline-kept note');
  assert.ok(await eventually(async () => (await lanes(t)).filter((l) => l.cards.includes(B('Světla přístavu'))).map((l) => l.id).sort().join(), (x) => x === 'tag:doporučené,tag:večerní'), 'then in both lanes');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-15, AC-16

test('fr_qry_05_ac15_no_value_unknown_and_excluded_lanes', async ({ page }) => {
  const vault = withTabs(['Podle stavu'], (f) => { f[qfile('Podle stavu')] = podleStavu(); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, 'Podle stavu');
  const ls = await eventually(() => lanes(b), (l) => l.length === 5);
  assert.deepEqual(ls.map((l) => [l.id, l.cards.length]), [['option:To read', 3], ['option:Reading', 3], ['option:Read', 9], ['unknown:Rozečteno', 1], ['none', 1]], 'To read 3, Reading 3, Read 9, Rozečteno 1, No Status 1');
  assert.deepEqual(ls[0].cards, [B('Dům u řeky'), B('Kniha o horách'), B('Ostrov bez jména')], 'To read: Dům u řeky, Kniha o horách, Ostrov bez jména');
  for (const id of ['unknown:Rozečteno', 'none']) {
    assert.equal(await laneGrip(b, id).count(), 0, `${id}: no grip`);
    assert.equal(await newInLane(b, id).count(), 0, `${id}: no +`);
    assert.equal(await lane(b, id).getAttribute('data-drop-target'), 'false', `${id}: not a drop target`);
    let label = 'x';
    await drag(page, card(b, B('Tiché město')), lane(b, id), { beforeUp: async () => { label = await dropLabel(page).count().then((c) => (c ? 'shown' : '')); } });
    assert.equal(label, '', `${id}: no drop label`);
  }
  assert.deepEqual(await writes(core), [], 'nothing written; the card returns');
  await core.setFile(qfile('Podle stavu'), podleStavu(['status: { is_not: Read }']));
  const l2 = await eventually(() => lanes(b), (l) => l.some((x) => x.excluded));
  assert.deepEqual(l2.map((l) => [l.id, l.excluded]), [['option:To read', false], ['option:Reading', false], ['option:Read', true], ['unknown:Rozečteno', false]], '`is_not: Read` hatches Read and hides No Status');
  await core.setFile(qfile('Podle stavu'), podleStavu(['status: { is_any_of: [Reading] }']));
  const l3 = await eventually(() => lanes(b), (l) => l.length === 3);
  assert.deepEqual(l3.map((l) => [l.id, l.excluded]), [['option:To read', true], ['option:Reading', false], ['option:Read', true]], '`is_any_of: [Reading]` hatches To read and Read, hides Rozečteno and No Status');
  await core.setFile(qfile('Podle stavu'), podleStavu(['rating: Good']));
  assert.ok(await eventually(async () => (await lanes(b)).every((l) => !l.excluded), (x) => x), 'a filter on another attribute hatches nothing');
  await core.setFile(qfile('Podle stavu'), podleStavu(['status: { is_not: Read }'], 'any'));
  assert.ok(await eventually(async () => (await lanes(b)).every((l) => !l.excluded), (x) => x), '`match: any` hatches nothing');
});

test('fr_qry_05_ac16_drop_on_an_excluded_lane', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, 'precondition');
  await drag(page, card(b, B('Noční vlak')), lane(b, 'option:Read'));
  assert.equal(await fileWhen(core, B('Noční vlak'), (x) => x === expectedView('books/nocni-vlak-read.md')), expectedView('books/nocni-vlak-read.md'), 'status: Read and modified:, once');
  const ls = await eventually(() => lanes(b), (l) => l[0]?.cards.length === 2);
  assert.deepEqual(ls.map((l) => [l.id, l.cards.length]), [['option:Reading', 2], ['option:To read', 2], ['option:Read', 0]], 'the card leaves the board; Reading 2, Read 0');
  assert.ok((await textOf(liveRegion(page))).includes('Moved "Noční vlak" to Read. It no longer shows in this view.'), 'the live region');
  assert.deepEqual(await writes(core), [B('Noční vlak')], 'one write');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-17, AC-18, AC-19

test('fr_qry_05_ac17_lanes_switch_writes_once', async ({ page }) => {
  const vault = withTabs([Q.zanr, Q.autor]);
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, Q.roz);
  await click(laneRadio(toolbar(page), 'Vertical'), 'the checked radio');
  await sleep(300);
  assert.deepEqual(await writes(core), [], 'the checked radio writes nothing');
  await click(laneRadio(toolbar(page), 'Horizontal'), 'Horizontal');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-lanes-horizontal.yml')), expectedView('rozectene-lanes-horizontal.yml'), 'line 15 and modified');
  assert.equal(await eventually(() => b.getAttribute('data-lanes'), (v) => v === 'horizontal'), 'horizontal', 'the same lanes as rows');
  assert.deepEqual((await lanes(b)).map((l) => l.id), ROZ.map((l) => l.id), 'the same lanes');
  await openBoard(page, Q.autor);
  await runCommand(page, 'Switch lanes');
  assert.equal(await fileWhen(core, qfile(Q.autor), (x) => x === expectedView('podle-autora-lanes-horizontal.yml')), expectedView('podle-autora-lanes-horizontal.yml'), 'Podle autora: `lanes: horizontal` inserted after group_by');
  await openBoard(page, Q.zanr);
  await click(laneRadio(toolbar(page), 'Vertical'), 'Vertical');
  assert.equal(await fileWhen(core, qfile(Q.zanr), (x) => x === expectedView('podle-zanru-lanes-vertical.yml')), expectedView('podle-zanru-lanes-vertical.yml'), 'Podle žánru: the comment and its spaces kept');
  assert.deepEqual(await writes(core), [qfile(Q.roz), qfile(Q.autor), qfile(Q.zanr)], 'one write each');
});

test('fr_qry_05_ac17_lanes_switch_writes_once_in_a_note_and_on_the_query_page', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(Q.roz) });
  const qb = await must(board(page, Q.roz), 'query/Rozečtené draws the board', 8000);
  await click(laneRadio(main(page), 'Horizontal'), 'Horizontal on query/Rozečtené');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-lanes-horizontal.yml')), expectedView('rozectene-lanes-horizontal.yml'), 'the same write');
  assert.equal(await qb.getAttribute('data-lanes'), 'horizontal', 'rows');
  await openNote(page, 'Čtení 2026');
  assert.equal(await eventually(() => board(page, Q.roz).getAttribute('data-lanes'), (v) => v === 'horizontal'), 'horizontal', 'Čtení\'s block opens the same way');
});

test('fr_qry_05_ac18_folding_rows_is_machine_local', async ({ page }) => {
  const vault = withTabs([Q.zanr]);
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, Q.zanr);
  const chevron = (label: string, how: 'Collapse' | 'Expand') => lane(b, `option:${label}`).getByRole('button', { name: rx(`${how} ${label}`) });
  await click(chevron('Román', 'Collapse'), 'Collapse Román');
  const roman = (await lanes(b)).find((l) => l.id === 'option:Román');
  assert.ok(roman?.folded, 'Román folded');
  assert.equal(flat(await textOf(lane(b, 'option:Román').locator('span.count'))), '6', 'its header keeps the count 6');
  assert.equal(await card(b, B('Dům u řeky'), 'option:Román').count(), 0, 'its cards are hidden');
  // Q2.1 (AP-1526, R198): folds are per usage, the tab's key.
  const ui = await eventually(() => uiState(core), (u) => Array.isArray(u?.usageFolded?.['tab:book/podle žánru']));
  assert.deepEqual(ui?.usageFolded?.['tab:book/podle žánru'], ['option:Román'], 'usageFolded["tab:book/podle žánru"] in ui-state.json');
  await chevron('Detektivka', 'Collapse').click({ modifiers: ['Alt'] });
  assert.ok(await eventually(async () => (await lanes(b)).filter((l) => l.id !== 'none').every((l) => l.folded), (x) => x), '⌥-click folds every row');
  await chevron('Detektivka', 'Expand').click({ modifiers: ['Alt'] });
  assert.ok(await eventually(async () => (await lanes(b)).every((l) => !l.folded), (x) => x), 'again: unfolds every row');
  assert.deepEqual(await writes(core), [], 'folding writes nothing to the vault');
  await selectTab(page, Q.roz);
  assert.equal(await board(page, Q.roz).getByRole('button', { name: /^⟦?(Collapse|Expand) / }).count(), 0, 'vertical lanes have no chevron');
});

test('fr_qry_05_ac19_lane_order_by_drag_and_reset', async ({ page }) => {
  const vault = withTabs([Q.zanr, Q.autor]);
  const core = await startViews(page, { route: typeRoute('book') , vault });
  let b = await openBoard(page, Q.roz);
  await drag(page, laneGrip(b, 'option:To read'), lane(b, 'option:Reading'), { at: 'left' });
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-lane-order-to-read-first.yml')), expectedView('rozectene-lane-order-to-read-first.yml'), 'Rozečtené: line 16 only');
  await runCommand(page, 'Reset lane order');
  assert.equal(await fileWhen(core, qfile(Q.roz), (x) => x === expectedView('rozectene-lane-order-reset.yml')), expectedView('rozectene-lane-order-reset.yml'), 'Reset lane order removes the line');
  assert.deepEqual((await eventually(() => lanes(b), (l) => l[0]?.id === 'option:To read')).map((l) => l.id), ['option:To read', 'option:Reading', 'option:Read'], 'option order');
  b = await openBoard(page, Q.zanr);
  await drag(page, laneGrip(b, 'option:Cestopis'), lane(b, 'option:Román'), { at: 'left' });
  assert.equal(await fileWhen(core, qfile(Q.zanr), (x) => x === expectedView('podle-zanru-lane-order-cestopis.yml')), expectedView('podle-zanru-lane-order-cestopis.yml'), 'Podle žánru: lane_order inserted after line 14, comments kept');
  assert.equal(await laneGrip(b, 'none').count(), 0, '`No Genres` has no grip');
  b = await openBoard(page, Q.autor);
  await drag(page, laneGrip(b, `relation:Autoři/Tomáš Rybář.md`), lane(b, `relation:Autoři/Eva Lindová.md`), { at: 'left' });
  assert.equal(await fileWhen(core, qfile(Q.autor), (x) => x === expectedView('podle-autora-lane-order-tomas.yml')), expectedView('podle-autora-lane-order-tomas.yml'), 'Podle autora: relation link texts');
  const n = (await writes(core)).length;
  await drag(page, laneGrip(b, `relation:Autoři/Eva Lindová.md`), lane(b, 'none'), { at: 'left' });
  await sleep(300);
  assert.equal((await writes(core)).length, n, 'nothing drops after `No Author`');
  // The palette: Move lane left / right announce.
  b = await openBoard(page, Q.roz);
  await laneGrip(b, 'option:Reading').focus();
  await runCommand(page, 'Move lane right');
  assert.ok(await eventually(() => textOf(liveRegion(page)), (t) => t.includes('Moved lane ')), '`Moved lane <lane>`');
  // A new option `Abandoned` shows after Read.
  await core.setFile(qfile(Q.roz), original(qfile(Q.roz)).replace('lane_order: [Reading, To read, Read]\n', ''));
  await core.setFile(BOOK_YML, swap(original(BOOK_YML), '      - { label: Read, color: green }\n', '      - { label: Read, color: green }\n      - { label: Abandoned, color: red }\n'));
  assert.deepEqual((await eventually(() => lanes(b), (l) => l.length === 4)).map((l) => l.id), ['option:To read', 'option:Reading', 'option:Read', 'option:Abandoned'], '`Abandoned` after Read');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-20, AC-21, AC-22

test('fr_qry_05_ac20_no_paging_and_sideways_scroll', async ({ page }) => {
  const vault = withTabs([Q.autor], (f) => { f[qfile(Q.roz)] = swap(f[qfile(Q.roz)], 'limit: 50\n', 'limit: 2\n'); });
  await startViews(page, { route: typeRoute('book'), vault });
  let b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, '`limit: 2` still shows all 5 cards');
  assert.equal(await b.getByRole('button', { name: /Show \d+ more/ }).count(), 0, 'no `Show more`');
  await page.setViewportSize({ width: 1024, height: 768 });
  b = await openBoard(page, Q.autor);
  const scroller = b.locator('div.board-scroll');
  await must(scroller, 'div.board-scroll');
  const s0 = await scroller.evaluate((e) => e.scrollLeft);
  await scroller.hover();
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 400);
  await page.keyboard.up('Shift');
  await page.mouse.wheel(300, 0);
  assert.ok(await eventually(() => scroller.evaluate((e) => e.scrollLeft), (x) => x > s0), 'the board scrolls sideways inside itself');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page has no horizontal scroll bar');
  assert.equal(await scroller.evaluate((e) => e.scrollHeight <= e.clientHeight + 1), true, 'the board never scrolls vertically');
  const widths = await b.locator('section[role="region"]').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().width)));
  assert.deepEqual(widths, [236, 236, 236, 236, 236, 236], 'six 236 px columns');
});

test('fr_qry_05_ac21_board_in_a_note', async ({ page }) => {
  const core = await startViews(page, { route: noteRouteOf(CTENI) });
  const blk = block(page, Q.roz);
  const b = await must(boardInBlock(blk), 'Čtení\'s second block draws the Rozečtené board', 8000);
  await mustLanes(b, ROZ, 'the R193 board');
  const col = await page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).boundingBox();
  const bb = await b.boundingBox();
  assert.ok(col && bb && bb.width <= col.width + 1, `the board is as wide as the note column at most (${bb?.width} ≤ ${col?.width})`);
  await drag(page, card(b, B('Kniha o horách')), lane(b, 'option:Reading'));
  assert.equal(await fileWhen(core, B('Kniha o horách'), (x) => x === expectedView('books/kniha-o-horach-reading.md')), expectedView('books/kniha-o-horach-reading.md'), 'a drag in the block writes AC-13\'s bytes');
  assert.equal(await fileText(core, CTENI), original(CTENI), 'the note holding the block is untouched (FR-FMT-07 AC-33)');
  assert.ok(await seen(newInLane(b, 'option:Reading'), 1000), '`New Book in Reading` in the block');
  await openBoardFromTab(page);
  assert.equal(await card(board(page, Q.roz), B('Kniha o horách'), 'option:Reading').count(), 1, 'the Rozečtené tab shows the change within 1 s');
});
const noteRouteOf = (p: string) => `note/${p.normalize('NFC')}`;
const boardInBlock = (blk: Locator) => blk.locator('div[role="group"][data-board]');
async function openBoardFromTab(page: Page) {
  await runCommand(page, 'Go to type: Books');
  await selectTab(page, Q.roz);
  await must(board(page, Q.roz), 'the tab\'s board', 1000);
}

test('fr_qry_05_ac22_board_by_keyboard', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, 'precondition');
  await tab(page, Q.roz).focus();
  const focusedCard = () => page.evaluate(() => (document.activeElement?.getAttribute('data-board-card') ?? '').normalize('NFC'));
  for (let i = 0; i < 12 && (await focusedCard()) === ''; i++) await page.keyboard.press('Tab');
  assert.equal(await focusedCard(), B('Noční vlak'), 'Tab into the board focuses Noční vlak');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedCard(), B('Účetní ze Žižkova'), '↓: Účetní ze Žižkova');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusedCard(), B('Kniha o horách'), '→: the same place in To read, or its last: Kniha o horách');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Kniha o horách', '⏎ opens it');
  await page.goBack();
  assert.equal(await eventually(focusedCard, (p) => p === B('Kniha o horách')), B('Kniha o horách'), 'Back returns with the focus on it');
  await card(b, B('Dům u řeky')).focus();
  await runCommand(page, 'Move card to previous lane');
  assert.ok(await fileWhen(core, B('Dům u řeky'), (x) => !!x && x.includes('status: Reading\n') && x.includes('modified: 2026-11-19T10:00:00+01:00\n')), 'Dům u řeky to Reading (one write)');
  assert.equal(await focusedCard(), B('Dům u řeky'), 'the focus stays on the moved card');
  await card(b, B('Noční vlak')).focus();
  await runCommand(page, 'Move card to next lane');
  assert.ok(await fileWhen(core, B('Noční vlak'), (x) => !!x && x.includes('status: To read\n')), 'Noční vlak to To read');
  await card(b, B('Kniha o horách')).focus();
  await runCommand(page, 'Move card to next lane');
  assert.ok(await fileWhen(core, B('Kniha o horách'), (x) => !!x && x.includes('status: Read\n')), 'from To read to the excluded Read');
  assert.ok((await textOf(liveRegion(page))).includes('It no longer shows in this view.'), 'announced');
  assert.equal(await writes(core).then((w) => w.length), 3, 'three writes');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-2

test('fr_qry_08_ac2_new_object_from_a_lane', async ({ page }) => {
  const vault = withTabs([Q.zanr, Q.autor, 'Výborné na tabuli'], (f) => {
    f[qfile('Výborné na tabuli')] = viewQuery({ title: 'Výborné na tabuli', filters: ['rating: Excellent'], extra: ['group_by: status', 'lanes: vertical'] });
  });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  let b = await openBoard(page, Q.roz);
  assert.equal(await newInLane(b, 'option:Read').count(), 0, 'no New control on the excluded lane');
  assert.equal(await (await must(newInLane(b, 'option:Reading'), '`+` of Reading')).getAttribute('aria-label'), 'New Book in Reading', 'the `+` is `New Book in Reading`');
  await click(newInLane(b, 'option:Reading'), 'New Book in Reading');
  assert.ok(await eventually(() => mainName(page), (n) => n !== null, 3000), 'new/book opens');
  assert.ok(await seen(page.getByRole('region', { name: 'Properties', exact: true }).getByText('Reading'), 3000), 'new/book with Status Reading in the attribute panel');
  assert.deepEqual(await writes(core), [], 'nothing written yet');
  // D-522, D-1826: the title takes the focus once its page is drawn; ⏎ is the draft's first write.
  await must(page.getByRole('textbox', { name: 'Title', exact: true }).and(page.locator(':focus')), 'the focused Title field');
  await page.keyboard.type('Nová kniha');
  await page.keyboard.press('Enter');
  const p = await eventually(async () => Object.keys(await core.files()).find((k) => k.startsWith('Books/Nová kniha')), (x) => !!x, 3000);
  assert.ok(p && (await fileText(core, p))?.includes('status: Reading\n'), 'the first keystroke writes the book with status: Reading');
  await page.goBack();
  b = await openBoard(page, Q.roz);
  assert.ok(await eventually(async () => (await lanes(b))[0]?.cards.includes(p!), (x) => x, 1000), 'its card shows in Reading within 1 s');
  for (const [view, laneId, want] of [[Q.zanr, 'option:Poezie', 'genres: [Poezie]'], [Q.autor, 'relation:Autoři/Marek Sova.md', 'author: "[[Marek Sova]]"'], ['Výborné na tabuli', 'option:To read', 'rating: Excellent']] as const) {
    const bb = await openBoard(page, view);
    await click(newInLane(bb, laneId), `New in ${laneId}`);
    await must(page.getByRole('textbox', { name: 'Title', exact: true }).and(page.locator(':focus')), 'the focused Title field');
    await page.keyboard.type(`Kniha ${view}`);
    await page.keyboard.press('Enter');
    const f = await eventually(async () => Object.keys(await core.files()).find((k) => k.startsWith(`Books/Kniha ${view}`)), (x) => !!x, 3000);
    assert.ok(f && (await fileText(core, f))?.includes(`${want}\n`), `${view}: pre-filled ${want}`);
    await page.goBack();
  }
  b = await openBoard(page, Q.zanr);
  assert.equal(await newInLane(b, 'none').count(), 0, '`No Genres`: no New control');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-6, AC-7

test('fr_qry_09_ac6_cards_follow_edits', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  await mustLanes(b, ROZ, 'precondition');
  const w0 = (await writes(core)).length;
  await core.setFile(B('Noční vlak'), swap(original(B('Noční vlak')), 'status: Reading\n', 'status: Read\n'));
  await core.setFile('Books/Nová kniha.md', '---\nid: 01JB5V00000000000000000099\ntype: book\ntitle: Nová kniha\nstatus: To read\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\nNová.\n');
  await core.setFile(B('Kniha o horách'), null);
  const ls = await eventually(() => lanes(b), (l) => l[0]?.cards.length === 2 && l[1]?.cards.length === 2, 2000);
  assert.deepEqual(ls.map((l) => [l.id, l.cards]), [
    ['option:Reading', [B('Účetní ze Žižkova'), B('Světla přístavu')]], ['option:To read', ['Books/Nová kniha.md', B('Dům u řeky')]], ['option:Read', []],
  ], 'external edits show within 2 s, counts included');
  assert.equal((await writes(core)).length, w0, 'the board writes nothing');
});

test('fr_qry_09_ac7_lanes_follow_the_type_file', async ({ page }) => {
  const vault = withTabs(['Podle stavu'], (f) => { f[qfile('Podle stavu')] = podleStavu(); });
  const core = await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, 'Podle stavu');
  await eventually(() => lanes(b), (l) => l.length === 5);
  await core.setFile(BOOK_YML, swap(original(BOOK_YML).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle stavu]'), '      - { label: Read, color: green }\n', '      - { label: Read, color: green }\n      - { label: Abandoned, color: red }\n'));
  assert.deepEqual((await eventually(() => lanes(b), (l) => l.length === 6, 2000)).map((l) => l.id).slice(0, 4), ['option:To read', 'option:Reading', 'option:Read', 'option:Abandoned'], '`Abandoned` after Read within 2 s');
  await core.setFile(BOOK_YML, swap(original(BOOK_YML).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle stavu]'), '      - { label: Read, color: green }\n', '      - { label: Done reading, color: green }\n'));
  const l2 = await eventually(() => lanes(b), (l) => l.some((x) => x.id === 'option:Done reading'), 2000);
  assert.deepEqual(l2.map((l) => [l.id, l.cards.length]), [['option:To read', 3], ['option:Reading', 3], ['option:Done reading', 0], ['unknown:Read', 9], ['unknown:Rozečteno', 1], ['none', 1]], 'renaming Read: an empty `Done reading` and a `Read` unknown lane with 9');
  assert.deepEqual((await writes(core)).filter((p) => p.endsWith('.md') || p.startsWith('.tegg/queries/')), [], 'nothing is rewritten');
  // D-1826 (as D-1825): book.yml back to the fixture (the `Read` option) before the external lane_order step.
  await core.setFile(BOOK_YML, original(BOOK_YML).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle stavu]'));
  await selectTab(page, Q.roz);
  const r = await must(board(page, Q.roz), 'Rozečtené');
  await eventually(() => lanes(r), (l) => l.some((x) => x.id === 'option:Read'), 2000);
  await core.setFile(qfile(Q.roz), swap(original(qfile(Q.roz)), 'lane_order: [Reading, To read, Read]\n', 'lane_order: [Read, Reading, To read]\n'));
  assert.deepEqual((await eventually(() => lanes(r), (l) => l[0]?.id === 'option:Read', 2000)).map((l) => l.id).slice(0, 1), ['option:Read'], 'an external lane_order reorders within 2 s');
  // A drag on a card whose file changed on disk is refused.
  await core.setFile(B('Dům u řeky'), swap(original(B('Dům u řeky')), 'Doporučila Jana.', 'Doporučila Eva.'), { silent: true });
  await drag(page, card(r, B('Dům u řeky')), lane(r, 'option:Reading'));
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: '"Dům u řeky" changed outside Tegg. Your change wasn\'t saved.' }), 3000), 'refused with the alert naming the book');
  assert.ok((await fileText(core, B('Dům u řeky')))?.includes('status: To read\n'), 'nothing written');
});

const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
void [NFD, callsOf, description, lanesGroup, mainName];

// ------------------------------------------------------------------------------------------------ slice Q2-T, F3

// Slice Q2-T QA finding F3 (docs/contracts/v1-views.md §28.2 BoardCard, §31.2): on a board grouped by a multi-value
// relation a card shows in every lane of its values; its relation chips resolve from `row.links` for every value, whatever
// the lane, so no chip of the card is drawn unresolved (`kind-unresolved`). Red first (D-61).
test('bug_q2t_fr_qry_07_multi_lane_card_links_resolve', async ({ page }) => {
  const nocni = B('Noční vlak');
  const vault = withTabs([Q.autor], (f) => { f[nocni] = swap(f[nocni], 'author: "[[Tomáš Rybář]]"\n', 'author: ["[[Tomáš Rybář]]", "[[Eva Lindová]]"]\n'); });
  await startViews(page, { route: typeRoute('book'), vault });
  const b = await openBoard(page, Q.autor);
  const author = (n: string) => `Autoři/${n.normalize('NFC')}.md`;
  const ids = [`relation:${author('Tomáš Rybář')}`, `relation:${author('Eva Lindová')}`];
  const ls = await eventually(() => lanes(b), (l) => ids.every((id) => l.find((x) => x.id === id)?.cards.includes(nocni)), 3000);
  for (const id of ids) assert.ok(ls.find((x) => x.id === id)?.cards.includes(nocni), `Noční vlak is in ${id}`);
  for (const id of ids) {
    const c = card(b, nocni, id);
    const chips = c.locator('footer a.chip[data-attribute="author"]');
    assert.equal(await eventually(() => chips.count(), (n) => n === 2, 2000), 2, `${id}: both author chips on the card (D-1769)`);
    const classes = await chips.evaluateAll((xs) => xs.map((x) => x.className));
    assert.deepEqual(classes.filter((k) => /\bkind-unresolved\b/.test(k)), [], `${id}: no author chip is unresolved (${classes.join(' | ')})`);
    assert.deepEqual((await chips.allInnerTexts()).map(flat).sort(), ['Eva Lindová', 'Tomáš Rybář'], `${id}: the chips name both authors`);
  }
});
