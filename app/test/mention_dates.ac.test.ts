// MS4 slice 4B, L1: `@` date rows through the real @tegg/doc `dateRows(query, today, locale)` (never mocked). FR-DLY-08
// AC-1 (`@today`, `@tomorrow`, `@yesterday`, prefixes, the cs keywords in NFC, NFD and without diacritics, D-331), AC-2
// (`@<date>`: ISO and the region's numeric short date, invalid dates give no row). The query is the text after `@`.
// docs/acceptance/daily-notes.md; interface docs/contracts/ms4-daily.md §6.4. Written from the ACs and the contract only
// (D-61). Imports inside the tests, every check node:assert (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

const TODAY = '2026-10-14';
type Row = { date: string; label: string; keyword: string | null };
async function rows(query: string, locale: string, today = TODAY): Promise<Row[]> {
  const m: any = await import('@tegg/doc');
  assert.equal(typeof m.dateRows, 'function', '@tegg/doc exports dateRows');
  const r = m.dateRows(query, today, locale);
  assert.ok(Array.isArray(r), `dateRows(${JSON.stringify(query)}) returns a list`);
  return r as Row[];
}
async function dateOf(query: string, locale: string, today = TODAY): Promise<string | null> {
  const r = await rows(query, locale, today);
  assert.ok(r.length <= 1, `zero or one row for ${JSON.stringify(query)}: ${JSON.stringify(r)}`);
  return r[0]?.date ?? null;
}

test('fr_dly_08_ac1_today_row_and_label', async () => {
  const r = await rows('today', 'en-US');
  assert.equal(r.length, 1, 'one row for @today');
  assert.equal(r[0].date, '2026-10-14');
  assert.equal(r[0].label, 'Today, 2026-10-14', 'the keyword row label (catalog)');
  assert.notEqual(r[0].keyword, null, 'a keyword row');
});

test('fr_dly_08_ac1_english_keywords_and_prefixes', async () => {
  const cases: [string, string | null][] = [
    ['today', '2026-10-14'], ['tod', '2026-10-14'], ['TODAY', '2026-10-14'], ['Tod', '2026-10-14'],
    ['tomorrow', '2026-10-15'], ['tom', '2026-10-15'], ['tomo', '2026-10-15'],
    ['yesterday', '2026-10-13'], ['yes', '2026-10-13'], ['y', '2026-10-13'],
    ['todayx', null], ['Cíl', null],
  ];
  const bad: string[] = [];
  for (const [q, want] of cases) {
    const got = await dateOf(q, 'en-US');
    if (got !== want) bad.push(`@${q}: want ${want}, got ${got}`);
  }
  assert.deepEqual(bad, [], 'English keyword rows');
});

test('fr_dly_08_ac1_czech_keywords_nfc_nfd_and_without_diacritics', async () => {
  const cases: [string, string][] = [
    ['dnes', '2026-10-14'], ['dn', '2026-10-14'], ['Dnes', '2026-10-14'],
    ['zítra', '2026-10-15'], ['zitra', '2026-10-15'], ['zít', '2026-10-15'], ['zítra'.normalize('NFD'), '2026-10-15'], ['ZÍTRA', '2026-10-15'],
    ['včera', '2026-10-13'], ['vcera', '2026-10-13'], ['vč', '2026-10-13'], ['včera'.normalize('NFD'), '2026-10-13'],
    ['today', '2026-10-14'], ['tomorrow', '2026-10-15'], ['yesterday', '2026-10-13'],
  ];
  const bad: string[] = [];
  for (const [q, want] of cases) {
    const got = await dateOf(q, 'cs');
    if (got !== want) bad.push(`@${q} (${q === q.normalize('NFC') ? 'NFC' : 'NFD'}): want ${want}, got ${got}`);
  }
  assert.deepEqual(bad, [], 'cs: English keywords always, plus dnes, zítra, včera (D-331)');
});

test('fr_dly_08_ac1_czech_keywords_only_for_cs', async () => {
  assert.equal(await dateOf('today', 'en-US'), '2026-10-14', 'red guard: the English keyword works in en-US');
  for (const q of ['dnes', 'zítra', 'včera']) assert.equal(await dateOf(q, 'en-US'), null, `@${q} gives no row in en-US`);
});

test('fr_dly_08_ac1_rows_follow_the_given_today_at_midnight', async () => {
  // FR-DLY-01 AC-2: the caller passes localDate(now); 23:59:59 → 14 Oct, 00:00:00 → 15 Oct.
  assert.equal(await dateOf('today', 'en-US', '2026-10-14'), '2026-10-14');
  assert.equal(await dateOf('today', 'en-US', '2026-10-15'), '2026-10-15');
  assert.equal(await dateOf('tomorrow', 'en-US', '2026-12-31'), '2027-01-01');
  assert.equal(await dateOf('yesterday', 'cs', '2026-03-01'), '2026-02-28');
});

test('fr_dly_08_ac2_iso_date_rows', async () => {
  const r = await rows('2026-10-20', 'en-US');
  assert.equal(r.length, 1, '@2026-10-20 gives one row');
  assert.equal(r[0].date, '2026-10-20');
  assert.equal(r[0].label, '2026-10-20', 'a typed date is labelled with the bare date');
  assert.equal(r[0].keyword, null, 'not a keyword row');
  assert.equal(await dateOf('2026-10-20', 'cs'), '2026-10-20', 'ISO in cs too');
  assert.equal(await dateOf('2028-02-29', 'cs'), '2028-02-29', 'leap day');
});

test('fr_dly_08_ac2_region_short_dates', async () => {
  const cases: [string, string, string | null][] = [
    ['20.10.2026', 'cs', '2026-10-20'], ['1.3.2026', 'cs', '2026-03-01'], ['01.03.2026', 'cs', '2026-03-01'],
    ['10/20/2026', 'en-US', '2026-10-20'], ['3/1/2026', 'en-US', '2026-03-01'], ['03/01/2026', 'en-US', '2026-03-01'],
  ];
  const bad: string[] = [];
  for (const [q, loc, want] of cases) {
    const got = await dateOf(q, loc);
    if (got !== want) bad.push(`@${q} (${loc}): want ${want}, got ${got}`);
  }
  assert.deepEqual(bad, [], "the region's numeric short date (D-331)");
});

test('fr_dly_08_ac2_invalid_dates_give_no_row', async () => {
  for (const [q, loc] of [['2026-02-30', 'en-US'], ['2026-13-01', 'en-US'], ['2026-02-30', 'cs'], ['30.2.2026', 'cs'], ['2/30/2026', 'en-US'], ['13/1/2026', 'en-US'], ['2026-1-5', 'cs'], ['２０２６-１０-２０', 'cs']] as const) {
    assert.deepEqual(await rows(q, loc), [], `@${q} (${loc}): no date row`);
  }
  // Red guard: a valid date in the same call shape does give a row.
  assert.equal(await dateOf('2026-10-20', 'en-US'), '2026-10-20');
});

test('fr_dly_08_ac1_labels_of_the_keyword_rows', async () => {
  // D-357: Today / Tomorrow / Yesterday, <date>; in cs Dnes / Zítra / Včera, <date>.
  const cases: [string, string, string][] = [
    ['today', 'en-US', 'Today, 2026-10-14'], ['tomorrow', 'en-US', 'Tomorrow, 2026-10-15'], ['yesterday', 'en-US', 'Yesterday, 2026-10-13'],
    ['dnes', 'cs', 'Dnes, 2026-10-14'], ['zítra', 'cs', 'Zítra, 2026-10-15'], ['včera', 'cs', 'Včera, 2026-10-13'],
  ];
  const bad: string[] = [];
  for (const [q, loc, want] of cases) {
    const r = await rows(q, loc);
    if (r[0]?.label !== want) bad.push(`@${q} (${loc}): want ${want}, got ${r[0]?.label}`);
  }
  assert.deepEqual(bad, [], 'the six keyword labels');
});

test('fr_dly_08_ac1_locale_tags_match_by_language', async () => {
  // D-357: `cs` and `cs-CZ` behave the same; `en-US` gets no Czech keywords.
  for (const [q, want] of [['zítra', '2026-10-15'], ['dnes', '2026-10-14']] as const) {
    assert.equal(await dateOf(q, 'cs-CZ'), want, `@${q} in cs-CZ`);
    assert.equal(await dateOf(q, 'cs'), want, `@${q} in cs`);
  }
  assert.equal(await dateOf('20.10.2026', 'cs-CZ'), '2026-10-20', 'the cs short date in cs-CZ');
  assert.equal(await dateOf('zítra', 'en-US'), null, 'no Czech keyword in en-US');
});
