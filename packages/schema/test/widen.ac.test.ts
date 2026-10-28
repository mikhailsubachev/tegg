// Slice 4E-2, L1: the widen-only `Type` menu's table (D-808, board TypeJobs E2). docs/acceptance/type-moves.md
// FR-TYP-03 AC-14 ("the targets of each type are board E2's; Date range offers none"); types.md FR-TYP-03 AC-11 in its
// D-808 form. Interface docs/contracts/ms4-jobs.md §14.9.7: `@tegg/schema` exports `widerTypes(t): AttrType[]` (the
// types every value of `t` stays valid in as written, without `t`; the menu lists `t` and these).
//
// Board E2: Number, Checkbox, Date, Date-time, URL, Email → Text, Long text; Date also → Date-time; Select →
// Multi-select, Text, Long text; Multi-select, Relation → Text, Long text; Text ↔ Long text; Date range → nothing.
// The order of the menu is R10's (board E1: `Text`, `Long text`, `Number`), checked at L5; here each list is compared
// as a set. The check against Rust's `widens` (§14.9.7 "checked against the TS one by an L1 test") needs a table both
// sides read; none exists yet (red-test point AP-795), so this file pins the TS side to the board.
// Written from the ACs, the board and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { schema } from './helpers';

/** Board E2, as R10 type keys. */
const E2: Record<string, string[]> = {
  text: ['long-text'],
  'long-text': ['text'],
  number: ['text', 'long-text'],
  checkbox: ['text', 'long-text'],
  date: ['date-time', 'text', 'long-text'],
  'date-time': ['text', 'long-text'],
  'date-range': [],
  select: ['multi-select', 'text', 'long-text'],
  'multi-select': ['text', 'long-text'],
  url: ['text', 'long-text'],
  email: ['text', 'long-text'],
  relation: ['text', 'long-text'],
};
const sorted = (a: unknown) => (Array.isArray(a) ? [...a].map(String).sort() : a);

test('fr_typ_03_ac14_wider_types_are_board_e2s_table', async () => {
  const s = await schema();
  assert.equal(typeof s.widerTypes, 'function', '@tegg/schema exports widerTypes (ms4-jobs §14.9.7)');
  const r10: string[] = s.ATTR_TYPES.map((t: any) => t.type);
  assert.deepEqual([...r10].sort(), Object.keys(E2).sort(), 'setup: E2 covers every R10 type');
  const bad: string[] = [];
  for (const t of r10) {
    const got = sorted(s.widerTypes(t));
    if (JSON.stringify(got) !== JSON.stringify([...E2[t]].sort())) bad.push(`${t}: got ${JSON.stringify(got)}, board E2 ${JSON.stringify(E2[t])}`);
  }
  assert.deepEqual(bad, [], 'every R10 type widens to board E2\'s targets, never to itself');
});

test('fr_typ_03_ac14_number_offers_text_and_long_text_only', async () => {
  const s = await schema();
  assert.deepEqual(sorted(s.widerTypes('number')), ['long-text', 'text'], 'Hodnocení (Number): the menu lists Text, Long text and the current Number');
});

test('fr_typ_03_ac14_date_range_offers_none', async () => {
  const s = await schema();
  assert.deepEqual(s.widerTypes('date-range'), [], 'Date range: two keys (FR-TYP-02); no wider type');
  assert.deepEqual(sorted(s.widerTypes('date')), ['date-time', 'long-text', 'text'], 'Date also widens to Date-time');
});

test('fr_typ_03_ac14_widening_never_narrows', async () => {
  const s = await schema();
  const narrower: [string, string][] = [['text', 'number'], ['multi-select', 'select'], ['date-time', 'date'], ['long-text', 'url'], ['text', 'relation'], ['text', 'date-range']];
  const offered = narrower.filter(([from, to]) => (s.widerTypes(from) as string[]).includes(to));
  assert.deepEqual(offered, [], 'no narrower type is offered (D-808: hidden, not disabled)');
  // The control: the stub's empty answer must not pass this file.
  assert.ok((s.widerTypes('select') as string[]).includes('multi-select'), 'Select → Multi-select is offered');
});
