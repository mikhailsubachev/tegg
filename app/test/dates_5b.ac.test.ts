// MS5 slice 5B, L1: the one date formatter of the UI (docs/acceptance/capture.md R58 `settings/date-time`, FR-SET-03;
// docs/contracts/ms5-capture.md §5.2; D-566): `app/ui/src/i18n/dates.ts` `formatDate`, `formatDateTime`, `firstDay`.
// FR-SET-03 AC-2 (dates follow the setting; date-times in the machine's zone with the chosen time format), AC-3 (the
// first day of the week). The region comes from i18n/collate.ts (`setCollationLocale`). Written from the ACs and the
// contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const d = await load('../ui/src/i18n/dates.ts');
  const c = await load('../ui/src/i18n/collate.ts');
  assert.ok(d && ['formatDate', 'formatDateTime', 'firstDay'].every((k) => typeof d[k] === 'function'), 'ui/src/i18n/dates.ts exports formatDate, formatDateTime, firstDay (§5.2)');
  assert.ok(c && typeof c.setCollationLocale === 'function', 'i18n/collate.ts');
  return { d: d!, c: c! };
}
afterEach(async () => {
  const c = await load('../ui/src/i18n/collate.ts');
  c?.setCollationLocale?.('cs');
});

const S = (date: string, time = 'region', week = 'region') => ({ date, time, week });
const REGION = S('region');

test('fr_set_03_ac2_dates_follow_the_date_format', async () => {
  const { d, c } = await mods();
  c.setCollationLocale('cs-CZ');
  assert.equal(d.formatDate('2026-10-14', REGION), new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 14)), 'Region: the medium date of cs-CZ');
  assert.equal(d.formatDate('2026-10-14', REGION).replace(/\s/g, ' '), '14. 10. 2026', 'R58: 14. 10. 2026 in cs-CZ');
  assert.equal(d.formatDate('2026-10-20', S('iso')), '2026-10-20', 'ISO');
  assert.equal(d.formatDate('2026-10-20', S('long')), '20 October 2026', 'Long (R58, FR-SET-03 AC-2)');
  assert.equal(d.formatDate('2026-10-20', undefined).replace(/\s/g, ' '), '20. 10. 2026', 'a missing setting reads as Region');
  c.setCollationLocale('en-US');
  assert.equal(d.formatDate('2026-10-14', REGION), new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 14)), 'Region follows the region (en-US)');
  assert.equal(d.formatDate('2026-10-20', S('iso')), '2026-10-20', 'ISO whatever the region');
});

test('fr_set_03_ac2_dates_never_shift_with_the_zone', async () => {
  const { d, c } = await mods();
  c.setCollationLocale('cs-CZ');
  // A date has no time and no zone (FR-FMT-11): the same text in every zone the machine might be in.
  const before = process.env.TZ;
  try {
    for (const tz of ['Europe/Prague', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(d.formatDate('2026-10-20', S('iso')), '2026-10-20', `${tz}: ISO`);
      assert.equal(d.formatDate('2026-10-20', REGION).replace(/\s/g, ' '), '20. 10. 2026', `${tz}: Region`);
    }
  } finally {
    process.env.TZ = before;
  }
});

test('fr_set_03_ac2_date_times_in_the_zone_with_the_time_format', async () => {
  const { d, c } = await mods();
  c.setCollationLocale('cs-CZ');
  const at = '2026-10-14T08:15:00+02:00';
  assert.equal(d.formatDateTime(at, REGION, 'Europe/Prague'), new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(at)), 'Region: D-160 medium date and short time');
  assert.equal(d.formatDateTime(at, REGION, 'America/Los_Angeles'), new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }).format(new Date(at)), 'in the machine zone (D-104): 13 Oct 23:15');
  const iso24 = d.formatDateTime(at, S('iso', '24'), 'Europe/Prague') as string;
  assert.ok(iso24.includes('2026-10-14') && iso24.includes('08:15'), `ISO + 24-hour: ${iso24}`);
  const iso12 = d.formatDateTime(at, S('iso', '12'), 'Europe/Prague') as string;
  assert.ok(iso12.includes('2026-10-14') && /\b8:15\b/.test(iso12) && !iso12.includes('08:15') && /AM|am|dop/.test(iso12), `ISO + 12-hour: ${iso12}`);
  const long = d.formatDateTime('2026-10-20T17:05:00+02:00', S('long', '24'), 'Europe/Prague') as string;
  assert.ok(long.includes('20 October 2026') && long.includes('17:05'), `Long + 24-hour: ${long}`);
});

test('fr_set_03_ac3_first_day_of_week', async () => {
  const { d } = await mods();
  assert.equal(d.firstDay(REGION, 'cs-CZ'), 1, 'Region cs-CZ: Monday');
  assert.equal(d.firstDay(REGION, 'en-US'), 7, 'Region en-US: Sunday');
  assert.equal(d.firstDay(undefined, 'en-US'), 7, 'missing setting = Region');
  assert.equal(d.firstDay(S('region', 'region', 'monday'), 'en-US'), 1, 'Monday wins over the region');
  assert.equal(d.firstDay(S('region', 'region', 'sunday'), 'cs-CZ'), 7, 'Sunday wins over the region');
});
