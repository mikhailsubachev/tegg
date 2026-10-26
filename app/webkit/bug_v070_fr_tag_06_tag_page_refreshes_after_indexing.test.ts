// Owner report on preview v0.70 (2026-10-26): on the 20,000-note reference vault, All tags › the first tag
// (`#process-ångström141`, 92 objects) showed an empty tag page, and pages opened afterwards stayed empty too. Cause:
// a page opened while the initial index still runs reads a partial index, and when indexing finishes the core sends
// only `index:progress` (done), no `vault:changed`, so nothing reloads (the real app showed "11 objects of 3 types" for
// good). Pages read again when indexing finishes. FR-TAG-06 (tag page), FR-UX-07 (indexing in the background).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { eventually } from './helpers';
import { main, openTagPage } from './tags-helpers';

const rows = (page: import('@playwright/test').Page) => main(page).locator('tr[data-path]').count();

test('bug_v070_fr_tag_06_tag_page_reloads_when_indexing_finishes', async ({ page }) => {
  const core = await openTagPage(page, 'finance');
  const before = await eventually(() => rows(page), (n) => n > 0, 3000);
  assert.ok(before > 0, 'setup: the tag page lists its objects');
  // The index catches up with a note it hadn't read yet: no `vault:changed` for it, only the end of indexing.
  await core.setFile('Pages/Pozdě indexovaná.md', '---\ntype: page\ntitle: Pozdě indexovaná\ntags: [finance]\n---\nText.\n', { silent: true });
  await core.emit('index:progress', { done: 500, total: 500, state: 'done' });
  const after = await eventually(() => rows(page), (n) => n === before + 1, 3000);
  assert.equal(after, before + 1, 'the tag page reads its objects again when indexing finishes');
  assert.ok(await main(page).getByText('Pozdě indexovaná', { exact: true }).count() > 0, 'the late note is listed');
});
