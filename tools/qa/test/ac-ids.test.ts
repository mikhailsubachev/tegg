// D-2081: the push gate's `ac-ids` check: a criterion ID defined twice across docs/acceptance fails, unless it is on the
// list of older duplicates; a listed ID that is no longer a duplicate is reported so the list shrinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAcIds } from '../src/coverage.ts';
import { tmpDir, writeFiles } from './helpers.ts';

const A = `# A

### FR-ABC-01 Titles

- **AC-1** One.
- **AC-2** Two.

| FR-ABC-01 | a table row, not a criterion |
`;
const B = `# B

### FR-ABC-01 Titles, more (adds to AC-1, AC-2)

- **AC-3** Three.
`;

test('ac_ids_unique_ids_pass', (t) => {
  const dir = tmpDir(t);
  writeFiles(dir, { 'docs/acceptance/a.md': A, 'docs/acceptance/b.md': B });
  assert.deepEqual(duplicateAcIds(dir, []), []);
});

test('ac_ids_an_id_defined_twice_fails_naming_both_files', (t) => {
  const dir = tmpDir(t);
  writeFiles(dir, { 'docs/acceptance/a.md': A, 'docs/acceptance/b.md': B.replace('AC-3', 'AC-2') });
  const out = duplicateAcIds(dir, []);
  assert.equal(out.length, 1);
  assert.match(out[0], /^FR-ABC-01\/AC-2 is defined 2 times: docs\/acceptance\/a\.md, docs\/acceptance\/b\.md/);
});

test('ac_ids_known_duplicates_are_skipped_and_stale_ones_reported', (t) => {
  const dir = tmpDir(t);
  writeFiles(dir, { 'docs/acceptance/a.md': A, 'docs/acceptance/b.md': B.replace('AC-3', 'AC-2') });
  assert.deepEqual(duplicateAcIds(dir, ['FR-ABC-01/AC-2']), []);
  const fixed = tmpDir(t);
  writeFiles(fixed, { 'docs/acceptance/a.md': A, 'docs/acceptance/b.md': B });
  assert.match(duplicateAcIds(fixed, ['FR-ABC-01/AC-2'])[0], /FR-ABC-01\/AC-2 is no longer defined twice/);
});

test('ac_ids_known_duplicates_of_a_requirement_without_criteria_are_not_judged', (t) => {
  // D-2126: a QA-tool test's fixture repository has no criteria of the listed requirements.
  const dir = tmpDir(t);
  writeFiles(dir, { 'docs/acceptance/a.md': A, 'docs/acceptance/b.md': B });
  assert.deepEqual(duplicateAcIds(dir, ['FR-XYZ-09/AC-1']), []);
  const empty = tmpDir(t);
  writeFiles(empty, { 'src/.keep': '' });
  assert.deepEqual(duplicateAcIds(empty, ['FR-ABC-01/AC-2']), []);
});
