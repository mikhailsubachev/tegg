// AC tests for FR-FMT-01, FR-FMT-02, FR-FMT-08 (AC-4), FR-FMT-11, FR-TYP-10 and NFR-REL-03.
// Written from docs/acceptance/*.md, docs/markdown-dialect.md and docs/contracts/ms1-core.md §4 only (D-61).
import { test, expect } from 'vitest'
import {
  parse, serialize, setAttribute, setDateRange, removeAttribute, newNote, ensureIdentity, touchModified, extract,
} from '../src/index.js'

const ID = '01JA2B3C4D5E6F7G8H9J0KMNPQ'
const NOW = '2026-10-09T14:30:00+02:00'
const LATER = '2026-10-10T08:05:00+02:00'

function idSource(...ids: string[]): () => string {
  let i = 0
  return () => ids[i++] ?? 'EXHAUSTED'
}

// ---------------------------------------------------------------- FR-FMT-01

test('fr_fmt_01_ac1_new_note_starts_with_frontmatter_delimited_by_dash_lines', () => {
  const text = newNote({ type: 'page', title: 'Říční poznámka', now: NOW, newId: idSource(ID), body: 'Tělo.\n' })
  expect(text).toBe(
    '---\n' +
    `id: ${ID}\n` +
    'type: page\n' +
    `created: ${NOW}\n` +
    `modified: ${NOW}\n` +
    '---\n' +
    'Tělo.\n',
  )
})

test('fr_fmt_01_ac2_new_note_writes_every_value_type_as_obsidian_properties', () => {
  const text = newNote({
    type: 'book',
    title: 'Čtení o systémech',
    attributes: [
      ['autor', { link: 'Jana Nováková' }],
      ['podtitul', 'Úvod do zpětných vazeb'],
      ['stran', 320],
      ['hodnoceni', 4.5],
      ['precteno', true],
      ['pujceno', false],
      ['dokonceno', { date: '2026-10-09' }],
      ['zacato', { datetime: '2026-10-01T08:15:00+02:00' }],
      ['temata', ['systémy', 'čtení']],
      ['lide', [{ link: 'Jana' }, { link: 'Tomáš' }]],
    ],
    body: 'Úvodní odstavec.\n',
    now: NOW,
    newId: idSource(ID),
  })
  expect(text).toBe(
    '---\n' +
    `id: ${ID}\n` +
    'type: book\n' +
    `created: ${NOW}\n` +
    `modified: ${NOW}\n` +
    'autor: "[[Jana Nováková]]"\n' +
    'podtitul: Úvod do zpětných vazeb\n' +
    'stran: 320\n' +
    'hodnoceni: 4.5\n' +
    'precteno: true\n' +
    'pujceno: false\n' +
    'dokonceno: 2026-10-09\n' +
    'zacato: 2026-10-01T08:15:00+02:00\n' +
    'temata:\n' +
    '  - systémy\n' +
    '  - čtení\n' +
    'lide:\n' +
    '  - "[[Jana]]"\n' +
    '  - "[[Tomáš]]"\n' +
    '---\n' +
    'Úvodní odstavec.\n',
  )
})

const BASE = '---\nid: 01JA0000000000000000000003\ntype: page\n---\nObsah poznámky.\n'
const withAttr = (line: string) => BASE.replace('type: page\n', `type: page\n${line}`)

test('fr_fmt_01_ac2_set_attribute_text_is_a_plain_string', () => {
  expect(setAttribute(parse(BASE), 'misto', 'Brno-střed')).toBe(withAttr('misto: Brno-střed\n'))
})

test('fr_fmt_01_ac2_set_attribute_text_needing_quotes_is_double_quoted', () => {
  expect(setAttribute(parse(BASE), 'pozn', 'Q3: plán')).toBe(withAttr('pozn: "Q3: plán"\n'))
})

test('fr_fmt_01_ac2_set_attribute_number_is_a_yaml_number', () => {
  expect(setAttribute(parse(BASE), 'cena', 1200)).toBe(withAttr('cena: 1200\n'))
})

test('fr_fmt_01_ac2_set_attribute_checkbox_is_true_or_false', () => {
  expect(setAttribute(parse(BASE), 'hotovo', true)).toBe(withAttr('hotovo: true\n'))
  expect(setAttribute(parse(BASE), 'hotovo', false)).toBe(withAttr('hotovo: false\n'))
})

test('fr_fmt_01_ac2_set_attribute_list_is_a_yaml_block_list', () => {
  expect(setAttribute(parse(BASE), 'stitky', ['řeka', 'voda'])).toBe(withAttr('stitky:\n  - řeka\n  - voda\n'))
})

// ---------------------------------------------------------------- FR-FMT-02

test('fr_fmt_02_ac1_new_object_has_ulid_id_type_created_and_modified', () => {
  const text = newNote({ type: 'task', title: 'Zavolat Tomášovi', now: NOW, newId: idSource(ID) })
  expect(text).toBe(`---\nid: ${ID}\ntype: task\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`)
  const ex = extract(text, 'Zavolat Tomášovi')
  expect(ex.id).toBe(ID)
  expect(ex.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(ex.type).toBe('task')
  expect(ex.attributes).toEqual({ id: ID, type: 'task', created: NOW, modified: NOW })
})

test('fr_fmt_02_ac2_id_is_read_from_frontmatter_whatever_the_file_name', () => {
  const text = `---\nid: ${ID}\ntype: page\ntitle: Původní název\n---\nText.\n`
  expect(extract(text, 'Původní název').id).toBe(ID)
  expect(extract(text, 'Přejmenovaný soubor').id).toBe(ID)
  const editedElsewhere = text.replace('Text.\n', 'Text upravený v Obsidianu.\n')
  expect(extract(editedElsewhere, 'Přejmenovaný soubor').id).toBe(ID)
})

const UNTYPED = '# Nadpis\n\nText s #štítkem a odkazem na [[Řeka]].\n'

test('fr_fmt_02_ac3_untyped_file_is_unchanged_by_open', () => {
  const doc = parse(UNTYPED)
  expect(doc.frontmatter).toBe(null)
  expect(doc.blocks.length).toBe(2)
  expect(serialize(doc)).toBe(UNTYPED)
})

test('fr_fmt_02_ac3_first_edit_adds_only_id_and_type_page', () => {
  const out = ensureIdentity(parse(UNTYPED), { now: NOW, newId: idSource(ID) })
  expect(out).toBe(`---\nid: ${ID}\ntype: page\n---\n` + UNTYPED)
})

test('fr_fmt_02_ac3_first_edit_of_file_with_frontmatter_but_no_id_adds_only_id_and_type', () => {
  const text = '---\ntags: [řeka]\nzdroj-poznamky: kniha\n---\nTělo.\n'
  const out = ensureIdentity(parse(text), { now: NOW, newId: idSource(ID) })
  const lines = out.split('\n')
  expect(lines.filter((l) => l === `id: ${ID}`).length).toBe(1)
  expect(lines.filter((l) => l === 'type: page').length).toBe(1)
  expect(lines.filter((l) => l !== `id: ${ID}` && l !== 'type: page').join('\n')).toBe(text)
})

test('fr_fmt_02_ac3_file_that_already_has_an_id_is_not_changed', () => {
  const text = `---\nid: ${ID}\ntype: book\n---\nTělo.\n`
  expect(ensureIdentity(parse(text), { now: NOW, newId: idSource('01JA9999999999999999999999') })).toBe(text)
})

const NOTE_V1 =
  '---\n' +
  `id: ${ID}\n` +
  'type: page\n' +
  `created: ${NOW}\n` +
  `modified: ${NOW}\n` +
  'stav: nový\n' +
  '---\n' +
  'První verze textu.\n'

test('fr_fmt_02_ac4_modified_unchanged_when_nothing_changed', () => {
  expect(touchModified(NOTE_V1, NOTE_V1, LATER)).toBe(NOTE_V1)
})

test('fr_fmt_02_ac4_modified_updated_when_body_changed_and_created_kept', () => {
  const after = NOTE_V1.replace('První verze textu.', 'Druhá verze textu.')
  expect(touchModified(NOTE_V1, after, LATER)).toBe(after.replace(`modified: ${NOW}`, `modified: ${LATER}`))
})

test('fr_fmt_02_ac4_modified_updated_when_attribute_changed', () => {
  const after = NOTE_V1.replace('stav: nový', 'stav: hotový')
  const out = touchModified(NOTE_V1, after, LATER)
  expect(out).toBe(after.replace(`modified: ${NOW}`, `modified: ${LATER}`))
  expect(out).toContain(`created: ${NOW}\n`)
})

// ---------------------------------------------------------------- FR-FMT-08 AC-4

test('fr_fmt_08_ac4_title_with_forbidden_characters_is_kept_in_title_key', () => {
  const text = newNote({ type: 'page', title: 'Q3: plan/budget', now: NOW, newId: idSource(ID) })
  expect(text).toBe(`---\nid: ${ID}\ntype: page\ntitle: "Q3: plan/budget"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`)
  expect(extract(text, 'Q3 plan budget').title).toBe('Q3: plan/budget')
})

test('fr_fmt_08_ac4_title_falls_back_to_file_stem', () => {
  expect(extract('Jen text.\n', 'Poznámka o řece').title).toBe('Poznámka o řece')
})

// ---------------------------------------------------------------- FR-FMT-11

test('fr_fmt_11_ac1_date_is_written_unquoted_without_time', () => {
  expect(setAttribute(parse(BASE), 'due', { date: '2026-10-09' })).toBe(withAttr('due: 2026-10-09\n'))
})

test('fr_fmt_11_ac2_date_only_value_does_not_shift_in_any_time_zone', () => {
  const text = '---\ntype: task\ndue: 2026-10-09\n---\nÚkol.\n'
  const saved = process.env.TZ
  const seen: unknown[] = []
  try {
    for (const tz of ['America/Los_Angeles', 'Europe/Prague', 'Asia/Tokyo']) {
      process.env.TZ = tz
      seen.push(extract(text, 'Úkol').attributes?.due)
      seen.push(parse(text).frontmatter?.data?.due)
    }
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
  expect(seen).toEqual(['2026-10-09', '2026-10-09', '2026-10-09', '2026-10-09', '2026-10-09', '2026-10-09'])
})

test('fr_fmt_11_ac3_date_time_is_iso_8601_with_offset', () => {
  expect(setAttribute(parse(BASE), 'zacatek', { datetime: '2026-10-09T14:30:00+02:00' }))
    .toBe(withAttr('zacatek: 2026-10-09T14:30:00+02:00\n'))
})

test('fr_fmt_11_ac4_date_range_is_written_as_start_and_end_keys', () => {
  expect(setDateRange(parse(BASE), 'dates', '2026-07-01', '2026-07-14'))
    .toBe(withAttr('dates-start: 2026-07-01\ndates-end: 2026-07-14\n'))
})

test('fr_fmt_11_ac4_changing_a_date_range_rewrites_both_keys_in_place', () => {
  const text = withAttr('dates-start: 2026-07-01\ndates-end: 2026-07-14\nmisto: Lisabon\n')
  expect(setDateRange(parse(text), 'dates', '2026-08-03', '2026-08-10'))
    .toBe(withAttr('dates-start: 2026-08-03\ndates-end: 2026-08-10\nmisto: Lisabon\n'))
})

test('fr_fmt_11_ac4_removing_an_attribute_removes_only_its_lines', () => {
  const text = withAttr('stitky:\n  - řeka\n  - voda\nmisto: Lisabon\n')
  expect(removeAttribute(parse(text), 'stitky')).toBe(withAttr('misto: Lisabon\n'))
})

// ---------------------------------------------------------------- FR-TYP-10

test('fr_typ_10_ac1_file_without_type_key_has_no_type_and_uses_stem_as_title', () => {
  const ex = extract('---\nstitky: [řeka]\n---\nText.\n', 'Netypovaná poznámka')
  expect(ex.title).toBe('Netypovaná poznámka')
  expect(ex.attributes).toEqual({ stitky: ['řeka'] })
  expect(ex.type).toBe(null)
  expect(ex.id).toBe(null)
})

test('fr_typ_10_ac2_parsing_and_extracting_an_untyped_file_does_not_change_its_text', () => {
  const doc = parse(UNTYPED)
  extract(UNTYPED, 'Netypovaná')
  expect(serialize(doc)).toBe(UNTYPED)
  expect(doc.text).toBe(UNTYPED)
})

// ---------------------------------------------------------------- NFR-REL-03

const INVALID: [string, string, number[]][] = [
  ['unclosed quote', '---\ntitle: "neuzavřené\ntags: [a, b\n---\nTělo zůstává čitelné.\n', [2, 3]],
  ['bad indentation', '---\nautor:\n  jmeno: Jana\n prijmeni: Nováková\n---\nTělo.\n', [4]],
  ['duplicate keys', '---\nstav: nový\nstav: hotový\n---\nTělo.\n', [3]],
  ['tab character', '---\nseznam:\n\t- položka\n---\nTělo.\n', [3]],
]

for (const [name, text, lines] of INVALID) {
  const slug = name.replace(/ /g, '_')
  test(`nfr_rel_03_ac1_invalid_yaml_${slug}_reports_error_with_line`, () => {
    const doc = parse(text)
    expect(doc.frontmatter?.data).toBe(null)
    expect(lines).toContain(doc.frontmatter?.error?.line)
    expect((doc.frontmatter?.error?.message ?? '').length).toBeGreaterThan(0)
    expect(serialize(doc)).toBe(text)
  })

  test(`nfr_rel_03_ac2_invalid_yaml_${slug}_is_indexed_by_file_name`, () => {
    const ex = extract(text, 'Rozbitá poznámka')
    expect(ex.title).toBe('Rozbitá poznámka')
    expect(ex.frontmatterError).toBe(true)
    expect(ex.attributes).toBe(null)
    expect(ex.type).toBe(null)
  })
}

test('nfr_rel_03_ac1_frontmatter_that_never_closes_is_reported', () => {
  const text = '---\ntitle: nikdy neuzavřeno\n\nText těla.\n'
  const doc = parse(text)
  expect(doc.frontmatter).toBe(null)
  expect(serialize(doc)).toBe(text)
  const ex = extract(text, 'Neuzavřená')
  expect(ex.frontmatterError).toBe(true)
  expect(ex.title).toBe('Neuzavřená')
})
