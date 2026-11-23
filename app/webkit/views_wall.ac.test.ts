// Slice Q3, L5 (WebKit + fake core): the wall (R224; boards W1, D1, D2): the ungrouped wall's cards, sizes, order,
// windowing and keyboard, and a grouped wall as today's board; Kanban as a wall whose lane order is the tab's; the DOM
// bound of an ungrouped wall over many objects. docs/acceptance/views.md part five: FR-QRY-05 AC-37, AC-38, FR-TSK-05
// AC-23, NFR-PERF-07 AC-7 (the DOM count). Interface docs/contracts/v1-views.md §41.3, §41.4, §42.1, §43.1
// (`__TEGG_TEST__.board()` with `display`, `grouped`, `columns`, `cards`). Expected bytes
// tests/fixtures/queries-files/expected/views-display/ and expected/views-tasks/. Fixture: the base
// tests/fixtures/vaults/views/, the overlay views-display/, or tasks + views-tasks/. Written from the ACs and the contract
// only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  AUTOR_LANES, BOOK_YML, Q, ZED, ZOB, block, click, displayVault, drag, eventually, expectedDisplay, fileText, lanesOf, main, must, nfc, noteRoute, P26_ROWS, panelOf, paths,
  selectTab, sleep, startViews, tab, typeRoute, wallCards, wallHook, wallIn, writtenPaths, writes, pressed,
} from './views-display-helpers';
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
import { lanes as boardLanes } from './views-helpers';
import {
  startTasksViews, TYPE_TASK, TASK_YML, overlayOriginal, kanbanLanes, kanbanBoard, laneGrip, menuItem, fileText as taskFile,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const tabRoot = (page: Page) => panelOf(page);
const CS_WALL = ['Cizí přístavy', 'Čarovná mapa', 'Čtvrtá zima', 'Dům u řeky', 'Kniha o čaji', 'Kniha o horách', 'Mapa bez severu', 'Noční vlak', 'Písně z dálky', 'Sto zimních dní',
  'Světla přístavu', 'Šest cest k moři', 'Tiché město', 'Účetní ze Žižkova', 'Zahrada v dešti', 'Zápisník z Tater'];
/** Each card's left, top and width in DOM order. */
async function cardBoxes(scope: Locator): Promise<{ x: number; y: number; w: number }[]> {
  return wallIn(scope).first().evaluate((w) => ([...w.querySelectorAll('article[data-board-card]')] as HTMLElement[]).map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: r.width }; })).catch(() => []);
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-37

test('fr_qry_05_ac37_ungrouped_wall', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.p26), 'tab', 8000);
  await selectTab(page, Q.p26);
  const w = await must(wallIn(tabRoot(page)), 'the wall');
  assert.equal(await w.getAttribute('data-grouped'), 'false', 'an ungrouped wall');
  const names = await w.locator('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')));
  assert.deepEqual(names, P26_ROWS.map((t) => `Book: ${t}`), 'Cards: 8 articles `Book: <title>` in R228\'s order');
  for (const width of [800, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(300);
    const boxes = await cardBoxes(tabRoot(page));
    assert.ok(boxes.length === 8 && boxes.every((b) => b.w >= 220 - 1 && b.w <= 300 + 1), `${width}: every card 220…300 px (${boxes.map((b) => Math.round(b.w))})`);
    const cols = Number(await w.getAttribute('data-columns'));
    const perRow = boxes.filter((b) => b.y === boxes[0].y).length;
    assert.equal(perRow, Math.min(cols, 8), `${width}: ${cols} columns`);
    assert.equal(await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth), true, `${width}: no sideways scroll`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);
  assert.equal((await cardBoxes(tabRoot(page))).filter((b, _, a) => b.y === a[0].y).length, 4, '1,440: 4 per row (R228)');
  // Nothing hidden: Rozečtené shows every Status pill.
  await selectTab(page, Q.roz);
  const pills = await wallIn(tabRoot(page)).locator('article').evaluateAll((as) => as.map((a) => (a.querySelector('[data-card-key="status"], [data-property="status"]') as HTMLElement | null)?.innerText?.trim() ?? null));
  assert.deepEqual(pills, ['To read', 'To read', 'Reading', 'Reading', 'Reading'], 'every card shows its Status pill');
  // Not drawn: lanes, No <attribute>, the + tile; a pointer drag moves nothing; no Move to.
  assert.equal(await wallIn(tabRoot(page)).locator('section[data-lane], button[data-command="board.newIn"]').count(), 0, 'no lane, no + tile');
  const n = (await writtenPaths(core)).length;
  const cards = wallIn(tabRoot(page)).locator('article[data-board-card]');
  await drag(page, cards.nth(0), cards.nth(3));
  assert.equal((await writtenPaths(core)).length, n, 'a pointer drag writes nothing');
  await cards.nth(0).getByRole('button', { name: /^⟦?More actions/ }).click();
  assert.equal(await page.getByRole('menuitem', { name: /^⟦?Move to/ }).count(), 0, 'More actions has no Move to');
  await page.keyboard.press('Escape');
  // Limit: Celá zeď shows all 16 cards.
  await selectTab(page, ZED);
  assert.deepEqual(await eventually(() => wallCards(tabRoot(page)), (c) => c.length === 16), paths(CS_WALL), 'Celá zeď: all 16 cards by title (`limit: 10` not applied)');
  // Keyboard: Tab focuses the first card; → / ← reading order; ↓ / ↑ the same column; ⏎ opens; Back returns.
  await selectTab(page, Q.p26);
  await tabRoot(page).locator('article[data-board-card]').first().focus();
  const focused = () => page.evaluate(() => document.activeElement?.closest('article[data-board-card]')?.getAttribute('data-board-card')?.normalize('NFC') ?? null);
  assert.equal(await focused(), paths([P26_ROWS[0]])[0], 'the first card focused');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(), paths([P26_ROWS[1]])[0], '→ the next card');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), paths([P26_ROWS[5]])[0], '↓ the same column of the next row');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.press('Meta+[');
  assert.equal(await eventually(focused, (f) => f === paths([P26_ROWS[5]])[0]), paths([P26_ROWS[5]])[0], 'Back returns with the focus on it');
});

test('fr_qry_05_ac37_ungrouped_wall_few_cards_and_sort', async ({ page }) => {
  const two = ['version: 1', 'title: Dvě knihy', 'types: [book]', 'match: all', 'filters:', '  - rating: Excellent', '  - author: "[[Eva Lindová]]"', 'sort: { by: title, order: asc }', 'limit: 50',
    'view: wall', 'created: 2026-11-18T20:00:00+01:00', 'modified: 2026-11-18T20:00:00+01:00', ''].join('\n');
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => {
    f['.tegg/queries/Dvě knihy.yml'] = two;
    f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Dvě knihy\n');
  }) });
  await must(tab(page, 'Dvě knihy'), 'tab Dvě knihy', 8000);
  await selectTab(page, 'Dvě knihy');
  const boxes = await eventually(() => cardBoxes(tabRoot(page)), (b) => b.length === 2);
  assert.ok(boxes.length === 2 && boxes.every((b) => Math.abs(b.w - 300) <= 1), 'two 300 px cards');
  assert.ok(boxes[0].x < boxes[1].x, 'left-aligned in reading order');
  // A sort change reorders within 300 ms, in one item write.
  await selectTab(page, Q.p26);
  const n = (await writtenPaths(core)).length;
  await click(tabRoot(page).locator('button[data-command="sort.open"]'), 'the sort button');
  await page.getByRole('dialog', { name: /^⟦?Sort/ }).getByRole('button', { name: /^⟦?Clear/ }).click().catch(() => undefined);
  await page.keyboard.press('Escape');
  const after = await eventually(() => wallCards(tabRoot(page)), (c) => c.length === 8 && c[0] !== paths([P26_ROWS[0]])[0], 300);
  assert.notEqual(after[0], paths([P26_ROWS[0]])[0], 'the wall reorders within 300 ms');
  assert.equal((await writtenPaths(core)).length - n, 1, 'one item write');
  void fileText;
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-38

test('fr_qry_05_ac38_grouped_wall_is_the_board', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault() });
  await must(tab(page, Q.autor), 'tab', 8000);
  await selectTab(page, Q.autor);
  const b = tabRoot(page).locator('div[data-board][data-wall][data-grouped="true"]');
  await must(b, 'a grouped wall (part one\'s board with data-wall)', 3000);
  assert.equal(await b.getAttribute('data-lanes'), 'horizontal', 'as rows (`lanes: horizontal`; data-lanes keeps the old values)');
  assert.deepEqual((await boardLanes(b)).map((l) => ({ id: l.id, cards: l.cards })), lanesOf(AUTOR_LANES), 'R193\'s six lanes');
  // Zobrazení block 4: rows, 16 cards, no hatched lane; a card drag writes the book, never Zobrazení.
  await page.goto('about:blank');
  const core2 = await startViews(page, { route: noteRoute(ZOB), vault: displayVault() });
  const b4 = block(page, ZED);
  const w = b4.locator('div[data-board][data-wall][data-grouped="true"]');
  await must(w, 'block 4\'s grouped wall', 8000);
  const ls = await boardLanes(w);
  assert.deepEqual(ls.map((l) => [l.id, l.cards.length]), [['option:To read', 2], ['option:Reading', 3], ['option:Read', 9], ['unknown:Rozečteno', 1], ['none', 1]], 'R228\'s rows');
  assert.equal(ls.filter((l) => l.excluded).length, 0, 'no hatched lane');
  const z0 = await fileText(core2, ZOB);
  await drag(page, w.locator(`article[data-board-card="${paths(['Kniha o horách'])[0]}"]`), w.locator('section[data-lane="option:Reading"]'));
  await eventually(() => writes(core2), (x) => x.length === 1);
  assert.deepEqual(await writes(core2), [paths(['Kniha o horách'])[0]], 'one write of the object');
  assert.equal(await fileText(core2, ZOB), z0, 'Zobrazení never written');
  void core; void nfc; void main;
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-23

test('fr_tsk_05_ac23_kanban_is_a_wall_lane_order_on_the_tab', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  await must(tab(page, 'Kanban'), 'Kanban', 8000);
  await selectTab(page, 'Kanban');
  assert.equal(await pressed(tabRoot(page)), 'wall', '(1) Wall pressed');
  assert.equal(flat(await tabRoot(page).locator('button[data-command="group.open"] .group-text').first().innerText({ timeout: 2000 }).catch(() => '')), 'Status', '(1) Group reads Status');
  const b = kanbanBoard(page);
  const k0 = await taskFile(core, '.tegg/queries/Kanban.yml');
  await drag(page, laneGrip(b, 'option:Waiting'), b.locator('section[data-lane="option:To do"]'), { at: 'left' });
  const want = expectedDisplay('types/task-kanban-lane-order-waiting.yml');
  assert.equal(await eventually(() => taskFile(core, TASK_YML), (t) => t === want), want, '(2) the Kanban item of task.yml');
  assert.equal(await taskFile(core, '.tegg/queries/Kanban.yml'), k0, '(2) Kanban.yml untouched');
  // (5) List draws R228's groups.
  await click(tabRoot(page).locator('div[data-display-switch] button[data-display="list"]'), '(5) List');
  const ids = await eventually(() => tabRoot(page).locator('.group-header[data-group-id]').evaluateAll((hs) => hs.map((h) => h.getAttribute('data-group-id'))), (x) => x.length >= 5);
  assert.deepEqual(ids, ['option:Waiting', ...kanbanLanes().map((l) => l.id).filter((x) => x !== 'option:Waiting')], '(5) groups in the tab\'s lane order');
  // (6) A task.yml changed on disk refuses the drag.
  await page.goto('about:blank');
  const core2 = await startTasksViews(page, { route: TYPE_TASK });
  await selectTab(page, 'Kanban');
  await core2.setFile(TASK_YML, `${overlayOriginal(TASK_YML)}# jinde\n`, { silent: true });
  const b2 = kanbanBoard(page);
  await drag(page, laneGrip(b2, 'option:Waiting'), b2.locator('section[data-lane="option:To do"]'), { at: 'left' });
  assert.ok(await eventually(async () => page.getByRole('alert').filter({ hasText: '"Tasks" changed outside Tegg. The views weren\'t changed.' }).count(), (c) => c > 0) > 0, '(6) the alert');
  void menuItem;
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-07 AC-7 (DOM count)

test('nfr_perf_07_ac7_ungrouped_wall_largest_type', async ({ page }) => {
  const query = ['version: 1', 'title: Zeď', 'types: [book]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: wall',
    'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
  const vault = displayVault((f) => {
    f['.tegg/queries/Zeď.yml'] = query;
    f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Zeď\n');
    for (let i = 0; i < 2000; i++) f[`Books/Kniha ${String(i).padStart(4, '0')}.md`] = `---\nid: 01JB5V0000000000000000${String(2000 + i).padStart(4, '0')}\ntype: book\ntitle: Kniha ${String(i).padStart(4, '0')}\nstatus: Read\n---\n`;
  });
  await startViews(page, { route: typeRoute('book'), vault });
  await must(tab(page, 'Zeď'), 'tab Zeď', 15000);
  await selectTab(page, 'Zeď');
  await must(wallIn(tabRoot(page)), 'the wall', 8000);
  let max = 0;
  for (let i = 0; i < 80; i++) {
    const h = (await wallHook(page))?.find((x) => x.name === 'Zeď' || x.display === 'wall');
    max = Math.max(max, h?.domCards ?? 9999);
    await page.mouse.wheel(0, 1500);
    await sleep(40);
  }
  assert.ok(max <= 150, `at most 150 card elements while scrolling (${max})`);
  const last = await eventually(() => wallCards(tabRoot(page)), (c) => c.includes(nfc('Books/Zápisník z Tater.md')), 3000);
  assert.ok(last.includes(nfc('Books/Zápisník z Tater.md')), 'the last card shows');
});
