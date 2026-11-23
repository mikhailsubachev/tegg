// Slice Q2-T, L5 (WebKit + fake core): cards on boards follow the card's type's `preview` (D-1891) and a Task card on any
// board is the R43 card (AP-1541), docs/acceptance/views.md part three R205, R208: FR-QRY-05 AC-28 (the card shows its
// type's `preview`; `columns` on a board is never read or written) and AC-29 (the Task card on boards). Interface
// docs/contracts/v1-views.md §29.5, §30.1, §31.1. Written from the ACs and the contract only (D-61). Lookups go through
// `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, BOOK_YML, Q, addMenu, addView, board, boardIn, card, click, editor, eventually, fileText, fileWhen, lanes, main, menuItem, must, original, panelOf, paletteDialog,
  paletteOptions, qfile, queryRoute, rx, runCommand, seen, selectTab, sleep, startViews, swap, tab, textOf, toolbar, toolbarMenuButton, typeRoute, viewMenu, viewQuery,
  viewsVault, writes,
} from './views-helpers';
import { CESTY, overlayVault as usageOverlay } from './views-usage-helpers';
import {
  KANBAN, SCHEDULE, T, TASK_YML, TYPE_TASK, openTasks, overlayOriginal, overlayVault, startTasksViews, taskCard, taskCheckbox, taskMore, titleOf,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
const pill = (c: Locator, key: string) => c.locator(`span.card-pill[data-attribute="${key}"]`);
const chip = (c: Locator, key: string) => c.locator(`footer a.chip[data-attribute="${key}"]`);
async function openBoard(page: Page, name: string): Promise<Locator> {
  await must(tab(page, name), `tab ${name}`, 8000);
  await selectTab(page, name);
  return must(board(page, name), `the board ${name}`, 5000);
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-28

test('fr_qry_05_ac28_cards_follow_preview_properties', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  const b = await openBoard(page, Q.roz);
  const u = card(b, B('Účetní ze Žižkova'));
  await must(u, 'the card of Účetní ze Žižkova');
  assert.equal(flat(await textOf(chip(u, 'author'))), 'Jana Brázdová', 'the author chip `Jana Brázdová`');
  assert.equal(await b.locator('[data-attribute="rating"]').count(), 0, 'no Rating pill, no `No Rating` (columns: [author, rating] isn\'t read)');
  assert.equal(await pill(u, 'status').count(), 0, 'Status is the grouping key: hidden');
  assert.equal(await fileText(core, qfile(Q.roz)), original(qfile(Q.roz)), 'Rozečtené.yml keeps `columns: [author, rating]` byte for byte');
  assert.equal(await toolbar(page).locator('button[data-command="view.columns"]').count(), 0, 'the board toolbar has no `Columns`');
  await click(toolbarMenuButton(page), '`View actions`');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  const e = await must(editor(page), 'the editor');
  assert.equal(await e.getByRole('group', { name: rx('On cards') }).count(), 0, 'no `On cards` row');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'the palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Use the query');
  await sleep(300);
  assert.ok(!(await paletteOptions(page)).some((o) => o.includes('Use the query\'s columns')), 'the palette doesn\'t list `Use the query\'s columns` on a board');
  await page.keyboard.press('Escape');
  // Preview properties [rating, genres]: every Book card on every board follows within 2 s, no query file written.
  const w0 = (await writes(core)).filter((p) => p.startsWith('.tegg/queries/')).length;
  await core.setFile(BOOK_YML, swap(original(BOOK_YML), 'preview: [author, status]\n', 'preview: [rating, genres]\n'));
  assert.ok(await eventually(async () => (await pill(card(b, B('Noční vlak')), 'rating').count()) > 0, (x) => x, 2000), 'Rating pills within 2 s');
  assert.ok(await seen(pill(card(b, B('Noční vlak')), 'genres'), 1000), 'Genres pills');
  assert.equal(await chip(card(b, B('Noční vlak')), 'author').count(), 0, 'no author chip any more');
  assert.equal((await writes(core)).filter((p) => p.startsWith('.tegg/queries/')).length, w0, 'no query file written');
  // Switching Rozečtené to Table shows its columns again.
  await core.setFile(BOOK_YML, original(BOOK_YML));
  await click(toolbarMenuButton(page), '`View actions`');
  await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
  await click(editor(page).getByRole('radiogroup', { name: rx('View') }).getByRole('radio', { name: rx('Table') }), 'Table');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const hs = await eventually(() => panelOf(page).locator('[role="columnheader"]').allInnerTexts().then((x) => x.map((h) => flat(h).replace(/[↑↓¹²³]/g, '').trim())), (x) => x.length >= 3, 3000);
  assert.deepEqual(hs.slice(0, 3), ['Title', 'Author', 'Rating'], 'Table: Title, Author, Rating');
});

test('fr_qry_05_ac28_cards_follow_preview_properties_new_board_writes_no_columns', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.roz), 'tab', 8000);
  await click(addView(page), 'Add view');
  await click(menuItem(await must(addMenu(page), 'menu `Add view`'), 'Board'), 'Board');
  await must(editor(page), 'the editor');
  await click(editor(page).getByRole('button', { name: rx('Done') }), 'Done');
  const q = await fileWhen(core, qfile('New view'), (x) => x !== undefined);
  assert.ok(q !== undefined && q.includes('view: board\n'), '`New view` › Board created');
  assert.ok(!/^columns:/m.test(q!), `no \`columns\` line (D-1910): ${JSON.stringify(q)}`);
});

test('fr_qry_05_ac28_cards_follow_preview_properties_block_and_several_types', async ({ page }) => {
  // Cesty's block 3 (columns: [rating]) draws the same cards and is never rewritten.
  const vault = usageOverlay((f) => {
    f[qfile('Knihy a autoři podle štítků')] = viewQuery({ title: 'Knihy a autoři podle štítků', types: ['book', 'autor'], extra: ['group_by: tags', 'lanes: vertical'], columns: ['rating'] });
  });
  const cesty = vault.files[CESTY];
  const core = await startViews(page, { route: `note/${CESTY}`, vault });
  const blocks = main(page).locator('figure[data-query-block]');
  await must(blocks.nth(2), 'Cesty\'s block 3', 8000);
  const b3 = await must(boardIn(blocks.nth(2)), 'its board', 5000);
  const u = card(b3, B('Účetní ze Žižkova'));
  await must(u, 'Účetní ze Žižkova in block 3');
  assert.equal(flat(await textOf(chip(u, 'author'))), 'Jana Brázdová', 'block 3: the author chip only');
  assert.equal(await b3.locator('[data-attribute="rating"]').count(), 0, 'block 3: no Rating pill');
  await sleep(500);
  assert.equal(await fileText(core, CESTY), cesty, 'Cesty is never rewritten');
  // A runtime board over [book, autor] grouped by tags.
  await startViews(page, { route: queryRoute('Knihy a autoři podle štítků'), vault });
  const b = await must(board(page), 'the board over [book, autor]', 8000);
  const ls = await eventually(() => lanes(b), (l) => l.length > 0, 3000);
  const books = ls.flatMap((l) => l.cards).filter((p) => p.startsWith('Books/'));
  const authors = ls.flatMap((l) => l.cards).filter((p) => p.startsWith('Autoři/'));
  assert.ok(books.length > 0 && authors.length > 0, 'both types on the board');
  assert.ok(await seen(chip(card(b, books[0]), 'author'), 1000), 'Book cards per Book\'s preview (author chip)');
  assert.equal(await card(b, authors[0]).locator('[data-attribute="rating"]').count(), 0, 'no column from `columns`');
  assert.ok(await seen(card(b, authors[0]).locator('[data-attribute="poznámka"]'), 1000), 'Autor cards per `[poznámka]`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-29

async function mustTaskCardParts(b: Locator, page: Page, path: string, where: string, o: { status: boolean; priority: boolean; due: boolean }) {
  const c = taskCard(b, path);
  await must(c, `${where}: the card of ${titleOf(path)}`, 5000);
  assert.equal(await c.getAttribute('data-task-card') !== null, true, `${where}: a Task card (data-task-card)`);
  assert.equal(await c.getAttribute('aria-label'), `Task: ${titleOf(path)}`, `${where}: article \`Task: ${titleOf(path)}\``);
  await must(taskCheckbox(c, titleOf(path)), `${where}: checkbox \`Complete "${titleOf(path)}"\``, 1000);
  await must(c.getByRole('link', { name: titleOf(path), exact: true }).first(), `${where}: the title link`, 1000);
  await must(taskMore(c, titleOf(path)), `${where}: \`More actions\``, 1000);
  const text = await textOf(c);
  if (!o.status) assert.ok(!/In progress|Waiting/.test(text), `${where}: no status chip (${text})`);
  if (!o.priority) assert.equal(await c.locator('[data-priority]:not(article)').count(), 0, `${where}: no priority chip`);
  if (o.due) assert.ok(await seen(c.locator('[data-due]'), 1000), `${where}: the due chip`);
  void page;
}

test('fr_qry_05_ac29_task_card_on_boards', async ({ page }) => {
  const prio = `# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Podle priority.\nversion: 1\ntitle: Podle priority\ntypes: [task]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: board\ngroup_by: priority\nlanes: vertical\ncreated: 2026-10-13T08:00:00+02:00\nmodified: 2026-10-13T08:00:00+02:00\n`;
  const note = 'Pages/Tabule úkolů.md';
  const vault = overlayVault((f) => {
    f[qfile('Podle priority')] = prio;
    f[TASK_YML] = swap(overlayOriginal(TASK_YML), 'views: [Schedule, Kanban, Čeká na ostatní]\n', 'views: [Schedule, Kanban, Čeká na ostatní, Podle priority]\n');
    f[note] = '---\nid: 01JB5A0000000000000000W940\ntype: page\ntitle: Tabule úkolů\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nTabule.\n\n```query\nsaved: Kanban\n```\n';
  });
  await startTasksViews(page, { route: TYPE_TASK, vault });
  // Schedule: the due chip shown; the source chip on Zavolat Janě; tags; two body lines; More actions + Move to.
  const s = await openTasks(page, SCHEDULE);
  await mustTaskCardParts(s, page, T.t01, 'Schedule', { status: true, priority: true, due: true });
  const t01 = taskCard(s, T.t01);
  assert.ok(await seen(t01.getByRole('link', { name: /Porada/ }).or(t01.locator('[aria-description="Source: Porada"]')).first(), 1000), 'the source chip `Porada` (FR-TSK-08)');
  assert.ok((await textOf(t01)).includes('#práce'), 'tags');
  assert.ok((await textOf(t01)).includes('Domluvit schůzku na příští týden.'), 'the body lines');
  await click(taskMore(t01, 'Zavolat Janě'), 'More actions');
  const menu = await must(page.getByRole('menu').last(), 'the card menu');
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((x) => flat(x.split('\n')[0]));
  for (const it of ['Open', 'Status', 'Priority', 'Due date…', 'Move to']) assert.ok(items.includes(it), `the menu has \`${it}\` (${items.join(', ')})`);
  await page.keyboard.press('Escape');
  // Kanban: no status chip.
  const k = await openTasks(page, KANBAN);
  await mustTaskCardParts(k, page, T.t04, 'Kanban', { status: false, priority: true, due: true });
  await mustTaskCardParts(k, page, T.t02, 'Kanban', { status: false, priority: true, due: true });
  // The board grouped by priority: no priority chip.
  const p = await openTasks(page, 'Podle priority');
  await mustTaskCardParts(p, page, T.t01, 'Podle priority', { status: true, priority: false, due: true });
  // A board block in a note.
  await startTasksViews(page, { route: `note/${note}`, vault });
  const nb = await must(boardIn(main(page).locator('figure[data-query-block]').first()), 'the block\'s board', 8000);
  await mustTaskCardParts(nb, page, T.t03, 'the block in a note', { status: false, priority: true, due: true });
});

test('fr_qry_05_ac29_task_card_on_boards_preview_adds_a_footer_chip', async ({ page }) => {
  // Slice OC (cards.md change table, views.md FR-QRY-05 AC-31): Task's card list drives the card; projekt is added to `card:`.
  // D-2149: the overlay's task.yml already defines the relation `projekt`.
  const yml = swap(overlayOriginal(TASK_YML), 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\ncard: [tags, body, status, due, priority, recurrence, source, projekt]\n');
  const vault = overlayVault((f) => {
    f[TASK_YML] = yml;
    f[T.t03] = swap(f[T.t03], 'tags: [doma]\n', 'tags: [doma]\nprojekt: "[[Web]]"\n');
  });
  await startTasksViews(page, { route: TYPE_TASK, vault });
  const s = await openTasks(page, SCHEDULE);
  const c = taskCard(s, T.t03);
  await must(c, 'Zalít květiny', 5000);
  assert.equal(flat(await textOf(chip(c, 'projekt'))), 'Web', 'a footer chip for `projekt`');
  await must(taskCheckbox(c, 'Zalít květiny'), 'still the Task card (checkbox)');
});

void queryRoute;
void viewsVault;
