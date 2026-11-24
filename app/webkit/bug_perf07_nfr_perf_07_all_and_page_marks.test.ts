// L5 regression (WebKit + fake core) for D-2226: contract docs/contracts/v1-views.md §42.5 asks for `board-*` / `rows-*`
// marks on every tab, page or `All` selection, but `All <plural>` and the `query/<name>` page marked no request and no
// `rows-ready`. `All Books` (a Table, then a Wall on this Mac) and the query pages of a Table and a wall query each mark
// their request before their ready mark. Fixture tests/fixtures/vaults/views/ + views-display/.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { BOOK_YML, ZED, allTab, click, displayButton, displayVault, eventually, must, panelOf, perfMarks, queryRoute, selectTab, startViews, tab, typeRoute, wallCards } from './views-display-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const query = (title: string, lines: string[]) => ['version: 1', `title: ${title}`, 'types: [book]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50',
  ...lines, 'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
const vault = () => displayVault((f) => {
  f['.tegg/queries/Podle stavu.yml'] = query('Podle stavu', ['view: table', 'group_by: status']);
  f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Podle stavu\n');
});
const since = async (core: Parameters<typeof perfMarks>[0], from: number) => (await perfMarks(core)).slice(from);
/** `ready` follows the last `req` (a late ready of the selection before may come first). */
const after = (req: string, ready: string) => (m: string[]) => m.lastIndexOf(req) >= 0 && m.indexOf(ready, m.lastIndexOf(req)) > 0;
function before(marks: string[], req: string, ready: string, what: string) {
  assert.ok(after(req, ready)(marks), `${what}: ${req} before ${ready} (${marks.join(', ')})`);
}
async function selectAll(page: Page) {
  await click(allTab(page), 'All Books');
  await eventually(() => allTab(page).getAttribute('aria-selected'), (s) => s === 'true');
}

test('bug_perf07_nfr_perf_07_all_tab_marks_rows_then_board', async ({ page }) => {
  const core = await startViews(page, { route: typeRoute('book'), vault: vault() });
  await must(tab(page, ZED), `tab ${ZED}`, 8000);
  // The page opens on `All Books`: no request is marked for it (D-2226), so it marks no `rows-ready` either.
  assert.ok(!(await perfMarks(core)).includes('rows-ready'), 'no rows-ready on opening');
  await selectTab(page, ZED);
  let n = (await perfMarks(core)).length;
  await selectAll(page);
  let marks = await eventually(() => since(core, n), after('rows-request', 'rows-ready'));
  before(marks, 'rows-request', 'rows-ready', 'All Books as a Table');
  assert.ok(!marks.slice(marks.lastIndexOf('rows-request')).includes('board-request'), `All Books as a Table: no board-request (${marks.join(', ')})`);
  // A Wall on this Mac: the board marks.
  await click(displayButton(panelOf(page), 'wall'), 'Wall');
  await eventually(() => wallCards(panelOf(page)), (c) => c.length > 0);
  await selectTab(page, ZED);
  n = (await perfMarks(core)).length;
  await selectAll(page);
  marks = await eventually(() => since(core, n), after('board-request', 'board-ready'));
  before(marks, 'board-request', 'board-ready', 'All Books as a Wall');
  assert.ok(!marks.includes('rows-request'), `All Books as a Wall: no rows-request (${marks.join(', ')})`);
});

test('bug_perf07_nfr_perf_07_query_page_marks_rows', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute('Podle stavu'), vault: vault() });
  const marks = await eventually(() => perfMarks(core), after('rows-request', 'rows-ready'), 8000);
  before(marks, 'rows-request', 'rows-ready', 'query/Podle stavu');
  assert.ok(!marks.includes('board-request'), `a Table page: no board-request (${marks.join(', ')})`);
});

test('bug_perf07_nfr_perf_07_query_page_marks_board', async ({ page }) => {
  const core = await startViews(page, { route: queryRoute(ZED), vault: vault() });
  const marks = await eventually(() => perfMarks(core), after('board-request', 'board-ready'), 8000);
  before(marks, 'board-request', 'board-ready', `query/${ZED}`);
  assert.ok(!marks.includes('rows-request') && !marks.includes('rows-ready'), `a wall page: no rows marks (${marks.join(', ')})`);
});
