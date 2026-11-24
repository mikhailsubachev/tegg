// Slice Q3 L6 run, L5 regression (WebKit + fake core): NFR-PERF-07 AC-8 measures `rows-request` → `rows-ready` on a
// grouped Table tab (contract docs/contracts/v1-views.md §42.5, D-2185), but a Table or List tab marked neither, so the
// real-app benchmark (app/e2e/nfr_perf_07_wall.ac.test.ts) never saw `rows-ready`. Selecting a Table or List tab, grouped
// or not, marks `rows-request` and then `rows-ready`; a wall tab still marks `board-request` → `board-ready` only.
// Fixture tests/fixtures/vaults/views/ + views-display/.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { BOOK_YML, displayVault, eventually, must, perfMarks, selectTab, startViews, tab, typeRoute } from './views-display-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const query = (title: string, lines: string[]) => ['version: 1', `title: ${title}`, 'types: [book]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50',
  ...lines, 'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');

/** The marks after `from` (an index into the mark list). */
const since = async (core: Parameters<typeof perfMarks>[0], from: number) => (await perfMarks(core)).slice(from);

test('bug_q3l6_nfr_perf_07_table_and_list_tabs_mark_rows_request_and_rows_ready', async ({ page }) => {
  const core = await startWith(page);
  for (const name of ['Podle stavu', 'Seznam']) {
    await must(tab(page, name), `tab ${name}`, 8000);
    const n = (await perfMarks(core)).length;
    await selectTab(page, name);
    const marks = await eventually(() => since(core, n), (m) => m.includes('rows-ready'));
    const req = marks.indexOf('rows-request');
    assert.ok(req >= 0 && req < marks.indexOf('rows-ready'), `${name}: rows-request before rows-ready (${marks.join(', ')})`);
    assert.ok(!marks.includes('board-request'), `${name}: no board-request`);
  }
  // A wall tab keeps the board marks and doesn't mark rows.
  const n = (await perfMarks(core)).length;
  await selectTab(page, 'Celá zeď');
  const marks = await eventually(() => since(core, n), (m) => m.includes('board-ready'));
  assert.ok(marks.includes('board-request'), `the wall: board-request (${marks.join(', ')})`);
  assert.ok(!marks.includes('rows-request') && !marks.includes('rows-ready'), `the wall: no rows marks (${marks.join(', ')})`);
});

function startWith(page: Page) {
  return startViews(page, { route: typeRoute('book'), vault: displayVault((f) => {
    f['.tegg/queries/Podle stavu.yml'] = query('Podle stavu', ['view: table', 'group_by: status']);
    f['.tegg/queries/Seznam.yml'] = query('Seznam', ['view: list']);
    f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Podle stavu\n  - Seznam\n');
  }) });
}
