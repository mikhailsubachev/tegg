// MS4 slice 4B, L1: dates, daily file names, the daily template and the first-write bytes in @tegg/doc, the TypeScript
// side of the TS/Rust pair. FR-DLY-08 AC-5 (only valid dates are dates, D-332), FR-FMT-09 AC-3…AC-5 (D-336),
// FR-DLY-06 AC-1…AC-3, AC-5 (D-270, D-325), FR-DLY-02 AC-2 (first-write bytes, D-324), FR-DLY-01 AC-11 (the D-334
// title fix). docs/acceptance/daily-notes.md; interface docs/contracts/ms4-daily.md §1, §5, §6.1–§6.3. The
// expectations are the shared corpora tests/fixtures/format/dates/*.json, also read by
// crates/tegg-format/tests/ac_dates.rs. Written from the ACs and the contract only (D-61). The module is imported
// inside each test and every check is node:assert, so a missing export fails an assertion (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const load = (name: string) => JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/format/dates', name), 'utf8'))
const dates = load('cases.json') as { cases: { name: string; input: string; date: string | null }[] }
const formats = load('daily-format.json') as { cases: { format: string; date: string; stem: string | null }[] }
const templates = load('template-cases.json') as {
  cases: { name: string; template: string; date: string; keys: [string, string][]; body: string; invalid: boolean | null }[]
  firstWrite: { name: string; date: string; keys: [string, string][]; body: string; id: string; now: string; text: string }[]
}
const fixture = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/daily', rel), 'utf8')

async function doc(...names: string[]): Promise<any> {
  const m: any = await import('../src/index.js')
  for (const n of names) assert.equal(typeof m[n], 'function', `@tegg/doc exports ${n}`)
  return m
}

test('fr_dly_08_ac5_ts_parse_date_matches_the_shared_corpus', async () => {
  const m = await doc('parseDate')
  assert.ok(dates.cases.length > 20, 'setup: the corpus has cases')
  const bad = dates.cases.filter((c) => m.parseDate(c.input) !== c.date).map((c) => `${c.name}: ${JSON.stringify(c.input)} → want ${c.date}, got ${m.parseDate(c.input)}`)
  assert.deepEqual(bad, [], `parseDate differs from the corpus in ${bad.length} case(s)`)
})

test('fr_fmt_09_ac4_ts_daily_file_stem_of_valid_formats', async () => {
  const m = await doc('dailyFileStem')
  const valid = formats.cases.filter((c) => c.stem !== null)
  assert.ok(valid.length >= 10, 'setup: valid formats')
  const bad = valid.filter((c) => m.dailyFileStem(c.format, c.date) !== c.stem).map((c) => `${JSON.stringify(c.format)} on ${c.date}: want ${c.stem}, got ${m.dailyFileStem(c.format, c.date)}`)
  assert.deepEqual(bad, [], `dailyFileStem differs from the corpus in ${bad.length} case(s)`)
})

test('fr_fmt_09_ac3_ts_default_format_gives_the_iso_stem', async () => {
  const m = await doc('dailyFileStem')
  for (const d of ['2026-10-14', '2026-03-05', '2028-02-29']) assert.equal(m.dailyFileStem('YYYY-MM-DD', d), d, `YYYY-MM-DD on ${d}`)
})

test('fr_fmt_09_ac5_ts_bad_formats_are_refused_and_the_fallback_works', async () => {
  const m = await doc('dailyFileStem')
  const badFormats = formats.cases.filter((c) => c.stem === null)
  assert.ok(badFormats.length >= 10, 'setup: bad formats')
  const accepted = badFormats.filter((c) => m.dailyFileStem(c.format, c.date) !== null).map((c) => `${JSON.stringify(c.format)} → ${m.dailyFileStem(c.format, c.date)}`)
  assert.deepEqual(accepted, [], 'every bad format gives null (D-336)')
  assert.equal(m.dailyFileStem('YYYY-MM-DD', '2026-10-14'), '2026-10-14', 'the fallback YYYY-MM-DD')
})

test('fr_dly_06_ac1_ts_expand_template_body_matches_the_shared_corpus', async () => {
  const m = await doc('expandDailyTemplate')
  const bad: string[] = []
  for (const c of templates.cases) {
    const x = m.expandDailyTemplate(c.template, c.date)
    if (x?.body !== c.body) bad.push(`${c.name}:\n  want ${JSON.stringify(c.body)}\n  got  ${JSON.stringify(x?.body)}`)
  }
  assert.deepEqual(bad, [], `expandDailyTemplate().body differs in ${bad.length} case(s)`)
})

test('fr_dly_06_ac1_ts_fixture_template_for_14_october', async () => {
  const m = await doc('expandDailyTemplate')
  const x = m.expandDailyTemplate(fixture('_templates/Daily Note/Daily Note.md'), '2026-10-14')
  assert.equal(x.body, '# Deník 14. 10. 2026\n\nVčera: [[2026-10-13]] · Zítra: [[2026-10-15]] · Dnes: 2026-10-14 · {{time}}\n\n## Poznámky\n')
  assert.equal(x.invalid, false)
})

test('fr_dly_06_ac2_format_tokens_and_literal_text', async () => {
  const m = await doc('formatDate')
  const cases: [string, string, string][] = [
    ['2026-10-14', 'D. M. YYYY', '14. 10. 2026'],
    ['2026-10-14', 'DD.MM.YYYY', '14.10.2026'],
    ['2026-10-14', 'den D', 'den 14'],
    ['2026-03-05', 'D. M. YYYY', '5. 3. 2026'],
    ['2026-03-05', 'DD.MM.YYYY', '05.03.2026'],
    ['2026-03-05', 'YYYY-MM-DD', '2026-03-05'],
    ['2026-03-05', 'zápis č. D/M', 'zápis č. 5/3'],
    ['2026-10-14', 'žluťoučký YYYY', 'žluťoučký 2026'],
  ]
  const bad = cases.filter(([d, f, want]) => m.formatDate(d, f) !== want).map(([d, f, want]) => `${f} on ${d}: want ${want}, got ${m.formatDate(d, f)}`)
  assert.deepEqual(bad, [], 'formatDate tokens YYYY MM M DD D, other characters copied (D-325)')
})

test('fr_dly_06_ac3_ts_template_keys_in_order_without_reserved_keys', async () => {
  const m = await doc('expandDailyTemplate')
  const bad: string[] = []
  for (const c of templates.cases) {
    const x = m.expandDailyTemplate(c.template, c.date)
    try { assert.deepEqual(x?.keys, c.keys) } catch { bad.push(`${c.name}: want ${JSON.stringify(c.keys)}, got ${JSON.stringify(x?.keys)}`) }
  }
  assert.deepEqual(bad, [], `expandDailyTemplate().keys differs in ${bad.length} case(s)`)
})

test('fr_dly_06_ac5_ts_invalid_template_frontmatter_is_body_only', async () => {
  const m = await doc('expandDailyTemplate')
  const withFlag = templates.cases.filter((c) => c.invalid !== null)
  assert.ok(withFlag.length >= 5, 'setup')
  for (const c of withFlag) {
    const x = m.expandDailyTemplate(c.template, c.date)
    assert.equal(x.invalid, c.invalid, `${c.name}: invalid`)
    if (c.invalid) {
      assert.deepEqual(x.keys, [], `${c.name}: no keys`)
      assert.equal(x.body, c.body, `${c.name}: the text after the fence, expanded`)
    }
  }
})

test('fr_dly_02_ac2_ts_new_daily_note_bytes_match_the_shared_corpus', async () => {
  const m = await doc('newDailyNote')
  assert.ok(templates.firstWrite.length >= 2, 'setup')
  for (const c of templates.firstWrite) {
    assert.equal(m.newDailyNote({ date: c.date, keys: c.keys, body: c.body, id: c.id, now: c.now }), c.text, `${c.name}: D-324 frontmatter order, then the body`)
  }
})

test('fr_dly_02_ac2_ts_first_write_title_is_a_quoted_string_and_date_bare', async () => {
  const m = await doc('newDailyNote', 'extract')
  const t = m.newDailyNote({ date: '2026-10-14', keys: [], body: 'Dnes\n', id: '01JB4B0000000000000000N003', now: '2026-10-14T12:00:00+02:00' })
  assert.match(t, /^title: "2026-10-14"$/m, 'title double-quoted (D-324)')
  assert.match(t, /^date: 2026-10-14$/m, 'date bare YYYY-MM-DD (FR-FMT-11)')
  const x = m.extract(t, '2026-10-14')
  assert.equal(typeof x.attributes?.title, 'string', 'YAML reads the title as a string')
  assert.equal(x.attributes?.type, 'daily-note')
  assert.ok(t.endsWith('---\nDnes\n'), 'the body follows the frontmatter')
})

test('fr_dly_01_ac11_fix_daily_title_changes_only_the_title_line', async () => {
  const m = await doc('fixDailyTitle')
  const patek = fixture('Daily/2026-10-09.md')
  const fixed = m.fixDailyTitle(patek)
  assert.equal(fixed, patek.replace('title: Pátek\n', 'title: "2026-10-09"\n'), 'Pátek: only the title line changes (D-334)')
  const ok = fixture('Daily/2026-10-07.md')
  assert.equal(m.fixDailyTitle(ok), ok, 'a matching title is left alone')
  const missing = '---\nid: 01JB4B0000000000000000N004\ntype: daily-note\ndate: 2026-10-14\n---\nŽluťoučký kůň.\n'
  assert.equal(m.fixDailyTitle(missing), '---\nid: 01JB4B0000000000000000N004\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\n---\nŽluťoučký kůň.\n', 'a missing title is inserted after type')
})
