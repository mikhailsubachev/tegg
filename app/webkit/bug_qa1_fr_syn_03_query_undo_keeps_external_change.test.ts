// Slice Q QA review, finding 2 (T1; qa/reviews/slice-q-build.md; FR-SYN-03, NFR-REL-02, D-1476, contract
// docs/contracts/v1-queries.md §2, §2.1, §4.4): ⌘Z after an editor commit is `query_revert` with the `undo` bytes and, as
// every query-file write, the version Tegg last read as its base: the one the commit returned. When another program
// changes the query file after the commit, that base is stale, so the core refuses with `Conflict`: the file keeps the
// external bytes and the UI shows `query.editor.changedOutside`. Undo must never take a freshly read version as its base
// (that would overwrite the external change).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, Q, block, done, eventually, mustResults, noteRoute, openEditor, qfile, queryFileText, queryWrites, seen, sleep, startQueries, viewChoice, click,
} from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const TABLE7 = [P.t5, P.t1, P.t2, P.t3, P.t4];
const CHANGED_OUTSIDE = 'This query changed outside Tegg. Your change wasn\'t saved.';

test('bug_qa1_fr_syn_03_query_undo_keeps_external_change', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7) });
  const b = block(page, Q.table);
  await mustResults(b, TABLE7, 'precondition', 8000);
  // One commit: Table → List, Done (one `query_apply`).
  await openEditor(b, page);
  await click(viewChoice(page, 'List'), 'List');
  await done(page);
  assert.deepEqual(await eventually(() => queryWrites(core), (w) => w.length === 1), [qfile(Q.table)], 'the commit writes once');
  const committed = (await queryFileText(core, Q.table))!;
  assert.ok(committed.includes('view: list'), 'the commit wrote `view: list`');
  // Another program changes the query file afterwards (with `vault:changed`).
  const outside = committed.replace('limit: 50', 'limit: 40');
  assert.notEqual(outside, committed, 'the external edit changes the bytes');
  await core.setFile(qfile(Q.table), outside);
  await sleep(500);
  assert.ok(await b.evaluate((f) => f.contains(document.activeElement)), 'precondition: the committed block still has the focus, so ⌘Z is the Undo of the commit (§4.4)');
  await page.keyboard.press('Meta+z');
  const reverts = await eventually(async () => (await core.queryCalls()).filter((c) => c.cmd === 'query_revert' && c.ok !== undefined), (r) => r.length > 0, 2000);
  assert.equal(reverts.length, 1, 'one `query_revert`');
  assert.equal(await queryFileText(core, Q.table), outside, 'the file keeps the external bytes');
  assert.equal(reverts[0].ok, false, 'refused (`Conflict`): its base is the version the commit returned');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: CHANGED_OUTSIDE }), 2000), `the alert \`${CHANGED_OUTSIDE}\``);
});
