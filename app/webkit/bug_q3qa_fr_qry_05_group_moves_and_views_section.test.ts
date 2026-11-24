// Slice Q3 QA review, L5 regressions (WebKit + fake core):
// 1. D-2218: on a grouped Table the unknown-value group (and `No <attribute>`) has no grip and no `Move lane up` /
//    `down`; a known group dropped on it lands after the last movable group, before it (D-2217).
// 2. D-2219: `Move lane up` / `down` steps over groups that aren't drawn (an empty group, D-2184): every move changes
//    what is shown, and a move with no drawn group to pass writes nothing (FR-SYN-06).
// 3. Type settings › Views shows (with `Add view` and, on Task, a disabled `Restore default views`) when `queries_list`
//    fails, and doesn't blank while a new view's query is read.
// Interface: docs/contracts/v1-views.md §41.5, §41.11; fixture tests/fixtures/vaults/views/ + views-display/.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, Q, ZOB, block, click, displayVault, drag, eventually, expectedDisplay, fileText, fileWhen, groupChevron, groupGrip, groupHeader, groupsIn, main, must, noteRoute,
  panelOf, runCommand, selectTab, sleep, startViews, tab, typeRoute, writes, writtenPaths,
} from './views-display-helpers';
import { startTasksViews } from './views-tasks-helpers';
import { paletteDialog } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });
const tabRoot = (page: Page) => panelOf(page);

/** The palette's options for `query` (opened and closed again). */
async function paletteFor(page: Page, query: string): Promise<string[]> {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await sleep(300);
  const out = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  return out;
}

test('bug_q3qa_fr_qry_05_unknown_groups_have_no_grip_and_dont_move', async ({ page }) => {
  const q = ['version: 1', 'title: Podle stavu', 'types: [book]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: table', 'group_by: status',
    'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => {
    f['.tegg/queries/Podle stavu.yml'] = q;
    f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Podle stavu\n');
  }) });
  await must(tab(page, 'Podle stavu'), 'tab Podle stavu', 8000);
  await selectTab(page, 'Podle stavu');
  const ids = (await eventually(() => groupsIn(tabRoot(page)), (g) => g.length === 5)).map((g) => g.id);
  assert.deepEqual(ids, ['option:To read', 'option:Reading', 'option:Read', 'unknown:Rozečteno', 'none'], 'R187\'s groups');
  for (const id of ['option:To read', 'option:Reading', 'option:Read']) assert.equal(await groupGrip(tabRoot(page), id).count(), 1, `${id}: a grip`);
  for (const id of ['unknown:Rozečteno', 'none']) assert.equal(await groupGrip(tabRoot(page), id).count(), 0, `${id}: no grip (D-2218)`);
  // No Move lane on the unknown group's header; on a known one it is offered.
  await groupChevron(tabRoot(page), 'unknown:Rozečteno').focus();
  assert.ok(!(await paletteFor(page, 'Move lane')).some((x) => /Move lane (up|down)/.test(x)), 'the unknown group: no Move lane up / down');
  await groupChevron(tabRoot(page), 'option:Reading').focus();
  assert.ok((await paletteFor(page, 'Move lane')).some((x) => /Move lane up/.test(x)), 'a known group: Move lane up');
  // To read dropped on Rozečteno's header: after Read (the last movable group), still before Rozečteno.
  const n = (await writtenPaths(core)).length;
  await drag(page, groupGrip(tabRoot(page), 'option:To read'), groupHeader(tabRoot(page), 'unknown:Rozečteno'));
  const after = await eventually(() => groupsIn(tabRoot(page)), (g) => g[0]?.id === 'option:Reading');
  assert.deepEqual(after.map((g) => g.id), ['option:Reading', 'option:Read', 'option:To read', 'unknown:Rozečteno', 'none'], 'after the last movable group (D-2217)');
  assert.equal((await writtenPaths(core)).length - n, 1, 'one item write');
  assert.ok((await fileText(core, BOOK_YML))?.includes('lane_order: [Reading, Read, To read, Rozečteno]'), 'the item\'s lane_order keeps Rozečteno after the known values');
});

test('bug_q3qa_fr_qry_05_move_lane_steps_over_hidden_groups', async ({ page }) => {
  // A tab grouped by Status with `is_any_of: [To read, Reading]`: `Read` is excluded, so the Table doesn't draw it
  // (D-2184), though it is a lane of the grouping (after Reading).
  const q = ['version: 1', 'title: Rozepsané', 'types: [book]', 'match: all', 'filters:', '  - status: { is_any_of: [To read, Reading] }', 'sort: { by: title, order: asc }',
    'limit: 50', 'view: table', 'group_by: status', 'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
  const core = await startViews(page, { route: typeRoute('book'), vault: displayVault((f) => {
    f['.tegg/queries/Rozepsané.yml'] = q;
    f[BOOK_YML] = f[BOOK_YML].replace('  - Celá zeď\n', '  - Celá zeď\n  - Rozepsané\n');
  }) });
  await must(tab(page, 'Rozepsané'), 'tab Rozepsané', 8000);
  await selectTab(page, 'Rozepsané');
  assert.deepEqual((await eventually(() => groupsIn(tabRoot(page)), (g) => g.length === 2)).map((g) => g.id), ['option:To read', 'option:Reading'], 'two drawn groups');
  // Reading is the last drawn group: Move lane down isn't run past the hidden Read; nothing is written.
  const n = (await writtenPaths(core)).length;
  await groupChevron(tabRoot(page), 'option:Reading').focus();
  await runCommand(page, 'Move lane down');
  await sleep(500);
  assert.equal((await writtenPaths(core)).length, n, 'no write: no drawn group after Reading');
  // To read down: past Reading, a visible move in one write.
  await groupChevron(tabRoot(page), 'option:To read').focus();
  await runCommand(page, 'Move lane down');
  assert.deepEqual((await eventually(() => groupsIn(tabRoot(page)), (g) => g[0]?.id === 'option:Reading')).map((g) => g.id), ['option:Reading', 'option:To read'], 'the drawn order changed');
  // After Reading as drawn: the hidden Read is stepped over, so To read goes after it.
  const lo = 'lane_order: [Reading, Read, To read]\n';
  const book = (await fileWhen(core, BOOK_YML, (t) => !!t?.includes(lo))) ?? '';
  assert.ok(book.includes(lo), `the item's ${lo.trim()} (${book})`);
  assert.equal((await writtenPaths(core)).length - n, 1, 'one item write');
  void ZOB; void block; void expectedDisplay; void noteRoute; void writes;
});

const FAIL_LIST = "window.__teggFake.handlers.queries_list = () => Promise.reject({ kind: 'Io', message: 'test: queries_list fails' });";

test('bug_q3qa_fr_typ_01_views_section_shows_when_queries_list_fails', async ({ page }) => {
  await startTasksViews(page, { route: 'type-settings/task', prelude: FAIL_LIST } as never);
  const section = main(page).locator('section#ts-views');
  await must(section, 'Views section', 8000);
  await sleep(500);
  assert.equal(await section.evaluate((e) => getComputedStyle(e).visibility), 'visible', 'the section shows');
  const add = await must(section.locator('button[data-command="views.new"]'), 'Add view');
  assert.ok(await add.isVisible(), 'Add view shows');
  const restore = await must(section.locator('button[data-command="types.restoreDefaultViews"]'), 'Restore default views');
  assert.ok(await restore.isVisible(), 'Restore default views shows');
  assert.equal(await restore.getAttribute('aria-disabled'), 'true', 'Restore default views disabled (no query list)');
});

test('bug_q3qa_fr_typ_01_views_section_never_blanks_while_reading', async ({ page }) => {
  const core = await startViews(page, { route: 'type-settings/book', vault: displayVault() });
  const section = main(page).locator('section#ts-views');
  await must(section, 'Views section', 8000);
  await eventually(() => section.innerText(), (t) => t.includes('Table · by Author'));
  // A new view: its query file, then the type file's `views` (as `Add view` writes them), with the query read held back.
  await core.delayCommand('query_get', 800);
  const q = ['version: 1', 'title: Nový pohled', 'types: [book]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: wall', 'group_by: status',
    'created: 2026-11-19T10:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00', ''].join('\n');
  await core.setFile('.tegg/queries/Nový pohled.yml', q);
  await core.setFile(BOOK_YML, (await fileText(core, BOOK_YML))!.replace('  - Celá zeď\n', '  - Celá zeď\n  - Nový pohled\n'));
  const seen: string[] = [];
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    seen.push(await section.evaluate((e) => getComputedStyle(e).visibility));
    await sleep(20);
  }
  assert.ok(seen.every((v) => v === 'visible'), `the section never hides (${[...new Set(seen)].join(', ')})`);
  assert.ok(await eventually(() => section.innerText(), (t) => /Nový pohled\s*Wall · by Status/.test(t)), 'the new view with its kind once read');
  void click;
});
