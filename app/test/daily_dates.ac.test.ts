// MS4 slice 4B, L1: the UI's clock and calendar arithmetic through the real @tegg/doc (never mocked). FR-DLY-01 AC-2
// (`localDate`: midnight is local, both test zones, D-340), FR-DLY-03 AC-1 (`addDays` on calendar days across DST,
// month, year and leap boundaries). docs/acceptance/daily-notes.md; interface docs/contracts/ms4-daily.md §1. FR-DLY-03
// AC-6 (calendar locale) has no L1 interface in the contract and is tested in app/webkit/daily_calendar.ac.test.ts
// (see the red-commit report). Written from the ACs and the contract only (D-61). Imports inside the tests, every check
// node:assert (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

async function doc(...names: string[]): Promise<any> {
  const m: any = await import('@tegg/doc');
  for (const n of names) assert.equal(typeof m[n], 'function', `@tegg/doc exports ${n}`);
  return m;
}
const ms = (iso: string) => Date.parse(iso);

for (const tz of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  const tag = tz.replace(/\W/g, '_');
  test(`fr_dly_01_ac1_local_date_of_the_test_clock_${tag}`, async () => {
    const m = await doc('localDate');
    assert.equal(m.localDate(ms('2026-10-14T12:00:00+02:00'), tz), '2026-10-14', `12:00 Prague / 03:00 Los Angeles is 14 Oct in ${tz}`);
  });

  test(`fr_dly_01_ac2_midnight_is_local_${tag}`, async () => {
    const m = await doc('localDate');
    // The local wall clock of each zone on 14/15 Oct 2026 (Prague UTC+2, Los Angeles UTC−7).
    const off = tz === 'Europe/Prague' ? '+02:00' : '-07:00';
    assert.equal(m.localDate(ms(`2026-10-14T23:59:59${off}`), tz), '2026-10-14', 'local 23:59:59 is still 14 Oct');
    assert.equal(m.localDate(ms(`2026-10-15T00:00:00${off}`), tz), '2026-10-15', 'local 00:00:00 is 15 Oct (start inclusive)');
    assert.equal(m.localDate(ms(`2026-10-14T23:59:59.999${off}`), tz), '2026-10-14', 'the last millisecond of 14 Oct');
  });
}

test('fr_dly_01_ac2_one_instant_is_two_dates_in_the_two_zones', async () => {
  const m = await doc('localDate');
  const t = ms('2026-10-14T22:30:00Z');
  assert.equal(m.localDate(t, 'Europe/Prague'), '2026-10-15', '00:30 in Prague');
  assert.equal(m.localDate(t, 'America/Los_Angeles'), '2026-10-14', '15:30 in Los Angeles');
});

test('fr_dly_01_ac2_dst_days_keep_their_dates', async () => {
  const m = await doc('localDate');
  // Prague leaves summer time on 25 Oct 2026 (03:00 CEST → 02:00 CET); Los Angeles on 1 Nov 2026.
  assert.equal(m.localDate(ms('2026-10-25T00:30:00+02:00'), 'Europe/Prague'), '2026-10-25');
  assert.equal(m.localDate(ms('2026-10-25T23:59:59+01:00'), 'Europe/Prague'), '2026-10-25', 'the 25 h day ends at 24:00 CET');
  assert.equal(m.localDate(ms('2026-10-26T00:00:00+01:00'), 'Europe/Prague'), '2026-10-26');
  assert.equal(m.localDate(ms('2026-11-01T23:59:59-08:00'), 'America/Los_Angeles'), '2026-11-01');
  assert.equal(m.localDate(ms('2026-11-02T00:00:00-08:00'), 'America/Los_Angeles'), '2026-11-02');
});

test('fr_dly_01_ac2_default_zone_is_the_intl_zone', async () => {
  const m = await doc('localDate');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const t of [ms('2026-10-14T22:30:00Z'), ms('2026-10-14T10:00:00Z'), ms('2026-10-15T06:59:59Z')]) {
    const want = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
    assert.equal(m.localDate(t), want, `localDate(now) uses the Intl zone ${zone}`);
  }
});

test('fr_dly_03_ac1_next_and_previous_are_calendar_days', async () => {
  const m = await doc('addDays');
  const steps: [string, number, string][] = [
    ['2026-10-14', 1, '2026-10-15'], ['2026-10-14', -1, '2026-10-13'],
    ['2026-10-24', 1, '2026-10-25'], ['2026-10-25', 1, '2026-10-26'], // Prague DST end
    ['2026-10-26', -1, '2026-10-25'], ['2026-10-25', -1, '2026-10-24'],
    ['2026-10-31', 1, '2026-11-01'], ['2026-11-01', 1, '2026-11-02'], // Los Angeles DST end
    ['2026-03-01', -1, '2026-02-28'], ['2026-12-31', 1, '2027-01-01'], ['2027-01-01', -1, '2026-12-31'],
    ['2028-02-28', 1, '2028-02-29'], ['2028-02-29', 1, '2028-03-01'], ['2028-03-01', -1, '2028-02-29'],
    ['2026-03-29', 1, '2026-03-30'], // Prague DST start (23 h day)
    ['2026-10-14', 0, '2026-10-14'], ['2026-10-14', 31, '2026-11-14'], ['2026-10-14', -365, '2025-10-14'],
  ];
  const bad = steps.filter(([d, n, want]) => m.addDays(d, n) !== want).map(([d, n, want]) => `addDays(${d}, ${n}): want ${want}, got ${m.addDays(d, n)}`);
  assert.deepEqual(bad, [], 'calendar-day arithmetic, no day skipped or repeated');
});

for (const tz of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  test(`fr_dly_03_ac1_walking_through_dst_never_skips_or_repeats_${tz.replace(/\W/g, '_')}`, async () => {
    const m = await doc('addDays', 'localDate');
    // Walk 10 days across each zone's DST end by `addDays` and compare with the zone's own calendar at local noon.
    const start = tz === 'Europe/Prague' ? '2026-10-20' : '2026-10-28';
    let d = start;
    const seen: string[] = [d];
    for (let i = 0; i < 10; i++) { d = m.addDays(d, 1); seen.push(d); }
    assert.equal(new Set(seen).size, 11, `11 distinct days: ${seen.join(', ')}`);
    for (let i = 1; i < seen.length; i++) {
      const noon = (x: string) => Date.parse(`${x}T12:00:00Z`);
      assert.equal(Math.round((noon(seen[i]) - noon(seen[i - 1])) / 86_400_000), 1, `${seen[i - 1]} → ${seen[i]} is one calendar day`);
    }
    assert.equal(m.localDate(Date.parse(`${seen[10]}T12:00:00Z`), tz), seen[10], 'agrees with the zone calendar');
  });
}
