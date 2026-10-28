// D-847: `widerTypes` is board E2's table as tests/fixtures/types/widen.json holds it (the Rust side is checked against
// the same file by crates/tegg-core/tests/widen_table.rs), in R10 order (the menu's order, FR-TYP-03 AC-14).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { read } from './helpers';
import { ATTR_TYPES, widerTypes, type AttrType } from '../src/index';

test('widen_table_ts_matches_the_shared_fixture', () => {
  const table = JSON.parse(read('tests/fixtures/types/widen.json')) as Record<string, string[]>;
  for (const { type } of ATTR_TYPES) assert.deepEqual(widerTypes(type as AttrType), table[type], type);
});
