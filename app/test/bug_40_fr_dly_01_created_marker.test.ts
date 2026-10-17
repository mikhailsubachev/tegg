// Regression for the PR #40 QA review (D-367, D-247): the "just created" marker of a create path that lands on
// today's Daily Note comes from the route that is opened, not from a second reading of the clock, and it is dropped
// when the navigation lands somewhere else, so a later visit to that date isn't treated as created.
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function load(): Promise<Record<string, any> | null> {
  try { return await import(/* @vite-ignore */ '../ui/src/shell/created.ts'); } catch { return null; }
}

test('bug_40_fr_dly_01_marker_matches_the_resolved_today_route', async () => {
  const m = await load();
  assert.ok(m, 'module ui/src/shell/created');
  const route = { id: 'daily/YYYY-MM-DD', param: '2026-10-15' };
  const marker = m.createdMarker(route);
  assert.equal(m.isCreated(marker, route), true, 'the marker matches the route it was made from');
  assert.equal(m.isCreated(marker, { id: 'daily/YYYY-MM-DD', param: '2026-10-14' }), false, 'not another date');
});

test('bug_40_fr_dly_01_marker_is_dropped_when_the_navigation_lands_elsewhere', async () => {
  const m = await load();
  assert.ok(m, 'module ui/src/shell/created');
  const marker = m.createdMarker({ id: 'daily/YYYY-MM-DD', param: '2026-10-15' });
  assert.equal(m.settleCreated(marker, { id: 'note/<path>', param: 'Pages/Jiná.md' }), null, 'dropped after landing elsewhere');
  assert.equal(m.settleCreated(marker, { id: 'daily/YYYY-MM-DD', param: '2026-10-15' }), marker, 'kept on the landed route');
  const note = m.createdMarker({ id: 'note/<path>', param: 'Pages/Nová.md' });
  assert.equal(m.settleCreated(note, { id: 'note/<path>', param: 'Pages/Nová.md' }), note, 'a note path marker is kept too');
});
