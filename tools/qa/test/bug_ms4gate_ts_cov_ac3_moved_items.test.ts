// Regression test from the MS4 milestone gate (D-750): the §11.2 cell's sentences "Moved to v1.0 (D-372): FR-TYP-04,
// -07 (file move), FR-STO-04" were read as milestone requirements (FR-STO-04, and `-07` as FR-EMB-07), and the item
// before a sentence ("NFR-REL-04. Moved to …", "FR-IMP-23. Starts after …") was dropped (CONTRACT §9.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandRequirements } from '../src/coverage.ts';

const MS4 = 'FR-LNK-01…04, -07, FR-TAG-01…02 (colour, D-707), FR-EMB-01 (drag: v1.0, D-432), -04, NFR-REL-04. Moved to v1.0 (D-372): FR-TYP-04, -07 (file move), FR-STO-04';
const MS7 = 'FR-IMP-03, -05, FR-IMP-23. Starts after the daily-use point (D-375). Moved to v1.0 (D-373): FR-IMP-01, FR-STO-10';

test('bug_ms4gate_ts_cov_ac3_moved_to_items_are_not_milestone_requirements', () => {
  const r = [...expandRequirements(MS4).reqs].sort();
  assert.deepEqual(r, ['FR-EMB-01', 'FR-EMB-04', 'FR-LNK-01', 'FR-LNK-02', 'FR-LNK-03', 'FR-LNK-04', 'FR-LNK-07', 'FR-TAG-01', 'FR-TAG-02', 'NFR-REL-04']);
  assert.deepEqual([...expandRequirements(MS7).reqs].sort(), ['FR-IMP-03', 'FR-IMP-05', 'FR-IMP-23']);
});
