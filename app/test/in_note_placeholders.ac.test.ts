// MS3 slice 3B, L1: the in-note placeholder registry equals table R5 (FR-EDT-02 AC-13) and joins the milestone check of
// FR-UX-02 AC-13 (D-144). Written from docs/acceptance/read-view.md (R5) and docs/contracts/ms3-shell.md §11.3 only
// (D-61). Kept apart from registry.ac.test.ts so the 3A AC test file stays unchanged (TS-I3).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { R5, expandReqs, showDue } from './shell-tables';
import { catalog, need } from './read-helpers';

beforeEach(async () => { await catalog().catch(() => {}); });

test('fr_edt_02_ac13_in_note_placeholder_registry_matches_r5', async () => {
  const cat = await catalog();
  const reg = await need('../ui/src/shell/registry.ts', 'IN_NOTE_PLACEHOLDERS');
  const defs = reg.IN_NOTE_PLACEHOLDERS as { id: string; name: string; due: { milestone: string; slice?: string }; reqs: string[] }[];
  assert.deepEqual(defs.map((d) => d.id), R5.map((r) => r.id), 'R5 ids in order');
  for (const row of R5) {
    const d = defs.find((x) => x.id === row.id)!;
    assert.equal(showDue(d.due), showDue(row.due), `${row.id}: milestone`);
    assert.deepEqual(expandReqs(d.reqs), expandReqs(row.reqs), `${row.id}: requirement IDs`);
    assert.ok(d.name in cat.en, `${row.id}: name ${d.name} is not a catalog key`);
    assert.notEqual(String(cat.t(d.name)).trim(), '', `${row.id}: empty name`);
  }
  const names = defs.map((d) => cat.t(d.name));
  assert.equal(new Set(names).size, names.length, 'placeholder names are distinct');
});

test('fr_ux_02_ac13_overdue_includes_in_note_placeholders', async () => {
  const cat = await catalog();
  const reg = await need('../ui/src/shell/registry.ts', 'IN_NOTE_PLACEHOLDERS', 'overdue');
  const defs = reg.IN_NOTE_PLACEHOLDERS as { id: string; name: string }[];
  assert.equal(defs.length, R5.length, 'IN_NOTE_PLACEHOLDERS is filled');
  const listed = (m: string, id: string) => {
    const d = defs.find((x) => x.id === id)!;
    const text = (reg.overdue(m) as string[]).join('\n');
    return text.includes(id) || text.includes(String(cat.t(d.name)));
  };
  for (const row of R5) {
    assert.equal(listed('MS3', row.id), false, `${row.id} is not overdue at MS3`);
    assert.equal(listed(row.due.milestone, row.id), true, `${row.id} is overdue at ${row.due.milestone}`);
    assert.equal(listed('v1.x', row.id), true, `${row.id} is overdue at v1.x`);
  }
  // 6A (D-626): the media placeholders are retired; the remaining rows are v1.0.
  assert.ok(!defs.some((d) => d.id.startsWith('embed-')), 'no media placeholder in the registry (D-626)');
});
