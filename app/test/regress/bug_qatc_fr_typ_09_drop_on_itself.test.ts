// QA review of the type-columns build (FR-TYP-09 AC-23, D-1244; FR-SYN-06): dropping a header on itself (its own left
// half) is no move: nothing to write, the column keeps its place.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dropColumn } from '../../ui/src/types/columns';
import { typeDto } from '../types-helpers';

test('bug_qatc_fr_typ_09_dropping_a_header_on_itself_writes_nothing', () => {
  const t = { ...typeDto('schůzka'), columns: ['datum', 'účastníci', 'modified', 'místo'], columnsIgnored: [], columnsUnreadable: false } as any;
  for (const k of ['datum', 'účastníci', 'modified', 'místo']) assert.equal(dropColumn(t, k, k), null, `${k} dropped before itself`);
  assert.equal(dropColumn({ ...t, columns: null }, 'datum', 'datum'), null, 'also on a type without columns (no seeding write)');
});
