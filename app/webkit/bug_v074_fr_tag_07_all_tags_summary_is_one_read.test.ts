// Owner report on preview v0.74 (2026-10-26; earlier on v0.70): on the 20,000-note reference vault, All tags › the first
// tag (`#process-ångström141`, 92 objects) showed `0 objects of 0 types` and an empty table, and the pages opened
// afterwards (the Inbox) stayed empty too; everything filled in about 50 s later. Cause: All tags computed its
// `<m> tagged objects` summary (D-721, distinct objects) with one `tag_objects` read per tag: 802 reads on that vault,
// each copying every indexed object under the index lock, so the core answered nothing else until the queue drained.
// The summary is one read, `index_tagged_objects` (D-784; ms4-tags §1.6, §3). FR-TAG-07 AC-1 (All tags), FR-TAG-06
// (the tag page), NFR-PERF-07.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { callsOf, eventually, main, must, openAllTags, tagsTable } from './tags-helpers';

test('bug_v074_fr_tag_07_all_tags_summary_is_one_read_not_one_per_tag', async ({ page }) => {
  const core = await openAllTags(page);
  await must(tagsTable(page), 'table "Tags"');
  await must(main(page).getByText('10 tags · 11 tagged objects', { exact: true }), 'the summary (distinct objects, D-721)');
  const once = await eventually(() => callsOf(core, 'index_tagged_objects'), (c) => c.length >= 1, 2000);
  assert.ok(once.length >= 1, 'the summary comes from index_tagged_objects (D-784)');
  assert.deepEqual(await callsOf(core, 'tag_objects'), [], 'All tags reads no tag page rows (one read per tag stalled the core on 802 tags)');
});
