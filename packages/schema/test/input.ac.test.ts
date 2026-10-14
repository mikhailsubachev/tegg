// MS3 slice 3D, L1: committed panel input → the value to write (FR-EDT-07 AC-5 input parsing, incl. zones and DST;
// FR-TYP-02 AC-3 date range order). docs/acceptance/types.md R10, D-230; interface docs/contracts/ms3-shell.md §14.4.
// The time zone is injected through `zone` and through process.env.TZ (Intl), never the machine's (D-61).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { schema } from './helpers';

const TZ0 = process.env.TZ;
afterEach(() => { if (TZ0 === undefined) delete process.env.TZ; else process.env.TZ = TZ0; });
const ok = (value: unknown) => ({ ok: true, value });

test('fr_edt_07_ac5_number_input_accepts_the_region_separators', async () => {
  const s = await schema();
  assert.deepEqual(s.parseNumber('3,5', 'cs'), ok(3.5), 'decimal comma');
  assert.deepEqual(s.parseNumber('3.5', 'cs'), ok(3.5), 'decimal point');
  assert.deepEqual(s.parseNumber('250 000', 'cs'), ok(250000), 'group space');
  assert.deepEqual(s.parseNumber('250 000', 'cs'), ok(250000), 'no-break space');
  assert.deepEqual(s.parseNumber('-12', 'cs'), ok(-12));
  assert.deepEqual(s.parseNumber('abc', 'cs'), { ok: false, error: 'value.notNumber' });
  assert.deepEqual(s.parseNumber('', 'cs').ok, false, 'empty is a clear, not a number');
});

test('fr_edt_07_ac5_date_input_never_depends_on_the_zone', async () => {
  const s = await schema();
  for (const tz of ['Europe/Prague', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    process.env.TZ = tz;
    assert.deepEqual(s.parseDate('8. 10. 2026', 'cs'), ok({ date: '2026-10-08' }), `${tz}: typed Czech date`);
    assert.deepEqual(s.parseDate('2026-10-08', 'cs'), ok({ date: '2026-10-08' }), `${tz}: ISO date`);
  }
  assert.equal(s.parseDate('31. 2. 2026', 'cs').ok, false, 'impossible date refused');
  assert.equal(s.parseDate('zítra', 'cs').ok, false, 'not a date');
});

test('fr_edt_07_ac5_date_time_gets_the_offset_of_that_moment', async () => {
  const s = await schema();
  const P = 'Europe/Prague';
  assert.deepEqual(s.parseDateTime('2026-12-01', '14:30', P), ok({ datetime: '2026-12-01T14:30:00+01:00' }), 'winter');
  assert.deepEqual(s.parseDateTime('2026-07-01', '14:30', P), ok({ datetime: '2026-07-01T14:30:00+02:00' }), 'summer');
  assert.deepEqual(s.parseDateTime('2027-03-28', '02:30', P), { ok: false, error: 'value.timeNotExist' }, 'spring-forward gap');
  assert.deepEqual(s.parseDateTime('2026-10-25', '02:30', P), ok({ datetime: '2026-10-25T02:30:00+02:00' }), 'ambiguous: the first occurrence');
  assert.deepEqual(s.parseDateTime('2026-12-01', '14:30', 'Pacific/Kiritimati'), ok({ datetime: '2026-12-01T14:30:00+14:00' }));
  assert.deepEqual(s.parseDateTime('2026-12-01', '14:30', 'Pacific/Pago_Pago'), ok({ datetime: '2026-12-01T14:30:00-11:00' }));
  process.env.TZ = P;
  assert.deepEqual(s.parseDateTime('2026-12-01', '14:30'), ok({ datetime: '2026-12-01T14:30:00+01:00' }), 'zone from Intl');
});

test('fr_edt_07_ac5_url_and_email_input', async () => {
  const s = await schema();
  assert.deepEqual(s.parseUrl('https://example.com/a?b=c'), ok('https://example.com/a?b=c'), 'as typed');
  assert.deepEqual(s.parseUrl('http://example.com'), ok('http://example.com'));
  for (const bad of ['example.com', 'javascript:alert(1)', 'ftp://example.com']) assert.deepEqual(s.parseUrl(bad), { ok: false, error: 'value.notUrl' }, bad);
  assert.deepEqual(s.parseEmail('eva@example.com'), ok('eva@example.com'));
  for (const bad of ['eva@', 'eva@example', 'e va@example.com']) assert.deepEqual(s.parseEmail(bad), { ok: false, error: 'value.notEmail' }, bad);
});

test('fr_typ_02_ac3_date_range_end_before_start_is_refused', async () => {
  const s = await schema();
  assert.equal(s.parseDateRange('2027-01-01', '2027-12-31').ok, true, 'ordered range');
  assert.equal(s.parseDateRange('2027-01-01', null).ok, true, 'only the start');
  assert.deepEqual(s.parseDateRange('2027-12-31', '2027-01-01'), { ok: false, error: 'value.endBeforeStart' });
});
