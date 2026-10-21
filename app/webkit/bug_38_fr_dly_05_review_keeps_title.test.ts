// Regression for the PR #38 QA review (FR-DLY-05 AC-2, D-334): on a Daily Note whose title differs from its date,
// `Mark reviewed` changes only `review` and `modified`; the title fix waits for an edit of the note itself.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { D, btn, fileWhen, gotoDaily, main, must, original, startDaily } from './daily-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_38_fr_dly_05_review_on_a_mismatched_title_changes_two_lines', async ({ page }) => {
  const core = await startDaily(page);
  await gotoDaily(page, '2026-10-09');
  await (await must(main(page).getByRole('checkbox', { name: 'Mark reviewed', exact: true }), 'checkbox "Mark reviewed" (D-607)')).click();
  const t = await fileWhen(core, D.patek, (x) => !!x?.includes('review: reviewed'));
  const was = original(D.patek)!.split('\n'), now = (t ?? '').split('\n');
  assert.deepEqual(was.map((l, i) => (l === now[i] ? null : l.split(':')[0])).filter(Boolean), ['review', 'modified'], 'only review and modified change');
});
