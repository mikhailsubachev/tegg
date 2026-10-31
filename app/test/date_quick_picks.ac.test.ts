// Preview v0.94 feedback, L1: the date picker's three quick picks (docs/acceptance/date-picker.md R89, FR-TYP-02 AC-9;
// AP-1185…AP-1187 → D-1285…D-1287). Interface docs/contracts/ms5-tasks.md §13: `export function thisWeek(today:
// string): string` in `app/ui/src/dates/PickDate.tsx`, the first Friday on or after `today` (`YYYY-MM-DD`); catalog
// `due.thisWeek` `This week`, `due.nextWeek` and `due.fri` removed (ms5-capture §16.3). "Today" is the local date of
// the clock in the zone (`@tegg/doc` `localDate`, ms4-daily §1). Written from the ACs and the contracts only (D-61).
// Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function thisWeek(): Promise<(today: string) => string> {
  const m = await load('../ui/src/dates/PickDate.tsx');
  assert.ok(m, 'ui/src/dates/PickDate.tsx loads');
  assert.equal(typeof m!.thisWeek, 'function', 'PickDate.tsx exports thisWeek(today) (ms5-tasks §13, D-1286)');
  return m!.thisWeek as (today: string) => string;
}

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-9 (the rule)

test('fr_typ_02_ac9_this_week_is_the_first_friday_on_or_after_today', async () => {
  const f = await thisWeek();
  const table: [string, string, string][] = [
    ['2026-10-12', '2026-10-16', 'Mon 12 Oct'],
    ['2026-10-13', '2026-10-16', 'Tue 13 Oct'],
    ['2026-10-14', '2026-10-16', 'Wed 14 Oct (the test clock)'],
    ['2026-10-15', '2026-10-16', 'Thu 15 Oct'],
    ['2026-10-16', '2026-10-16', 'Fri 16 Oct: today itself (D-1286)'],
    ['2026-10-17', '2026-10-23', 'Sat 17 Oct: the next Friday'],
    ['2026-10-18', '2026-10-23', 'Sun 18 Oct: the next Friday'],
    ['2026-12-31', '2027-01-01', 'Thu 31 Dec 2026: across the year'],
    ['2026-02-27', '2026-02-27', 'a Friday at the end of February'],
    ['2028-02-26', '2028-03-03', 'Sat 26 Feb 2028: across a leap day'],
  ];
  const got = table.map(([today]) => f(today));
  assert.deepEqual(got, table.map(([, want]) => want), table.map(([t, w, why]) => `${t} → ${w} (${why})`).join('; '));
});

test('fr_typ_02_ac9_this_week_ignores_the_region_and_the_zone_of_the_machine', async () => {
  const f = await thisWeek();
  // The rule takes only today (YYYY-MM-DD): the same answers whatever the process zone (FR-FMT-11, no shift).
  const before = process.env.TZ;
  try {
    const out: string[] = [];
    for (const tz of ['Europe/Prague', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      out.push(`${tz}:${f('2026-10-14')}:${f('2026-10-17')}`);
    }
    assert.deepEqual(out, ['Europe/Prague', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'].map((tz) => `${tz}:2026-10-16:2026-10-23`), 'no shift by the zone');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('fr_typ_02_ac9_today_is_the_local_date_of_the_clock', async () => {
  const f = await thisWeek();
  const doc = await load('@tegg/doc');
  assert.ok(doc && typeof doc.localDate === 'function', '@tegg/doc localDate');
  const at = Date.parse('2026-10-16T22:30:00Z');
  const prague = doc!.localDate(at, 'Europe/Prague');
  const la = doc!.localDate(at, 'America/Los_Angeles');
  assert.deepEqual([prague, la], ['2026-10-17', '2026-10-16'], 'Sat 17 00:30 in Prague, Fri 16 15:30 in Los Angeles');
  assert.equal(f(prague), '2026-10-23', 'Prague: This week gives 2026-10-23');
  assert.equal(f(la), '2026-10-16', 'Los Angeles: This week gives 2026-10-16');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-9 (strings, D-1285)

test('fr_typ_02_ac9_catalog_has_this_week_and_no_next_week_or_fri', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat && cat.en, 'ui/src/i18n/catalog.ts exports en');
  assert.ok('due.thisWeek' in cat!.en, 'catalog key due.thisWeek');
  assert.equal(cat!.t('due.thisWeek'), 'This week', 'due.thisWeek `This week`');
  assert.equal(cat!.t('due.today'), 'Today', 'due.today stays');
  assert.equal(cat!.t('due.tomorrow'), 'Tomorrow', 'due.tomorrow stays');
  assert.deepEqual(['due.nextWeek', 'due.fri'].filter((k) => k in cat!.en), [], 'due.nextWeek and due.fri are removed');
});
