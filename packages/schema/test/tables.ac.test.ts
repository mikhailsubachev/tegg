// MS3 slice 3D, L1: the tables @tegg/schema exports (R10 attribute types, R14 colours and icons, AR-07's version).
// docs/acceptance/types.md R10, R14; docs/contracts/ms3-shell.md §14.4. FR-TYP-02 AC-1, FR-TYP-01 AC-4, AR-07 AC-1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { schema } from './helpers';

test('ar_07_ac1_current_version_is_1', async () => {
  const s = await schema();
  assert.equal(s.CURRENT_VERSION, 1);
});

test('fr_typ_02_ac1_offered_types_are_r10_in_order', async () => {
  const s = await schema();
  assert.deepEqual(s.ATTR_TYPES.map((t: any) => t.type), ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation']);
  assert.deepEqual(s.ATTR_TYPES.map((t: any) => t.label), s.ATTR_TYPES.map((t: any) => `attrType.${t.type}`), 'labels are catalog keys');
});

test('fr_typ_01_ac4_colours_and_icons_are_r14', async () => {
  const s = await schema();
  assert.deepEqual(s.COLORS, ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']);
  assert.deepEqual(s.ICONS, ['file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user', 'folder', 'map', 'star', 'flag', 'bookmark', 'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane']);
});
