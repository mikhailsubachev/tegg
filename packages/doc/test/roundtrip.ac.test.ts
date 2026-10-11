// AC tests for FR-FMT-07 (round-trip safety) and FR-STO-02 (file envelope).
// Written from docs/acceptance/file-format.md and docs/contracts/ms1-core.md §4 only (D-61).
import { test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encode, parse, serialize, editBlock, setAttribute, newNote } from '../src/index.js'

const ROUNDTRIP = fileURLToPath(new URL('../../../tests/fixtures/format/roundtrip/', import.meta.url))

function fixtureFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...fixtureFiles(p))
    else if (name.endsWith('.md') && p !== join(ROUNDTRIP, 'README.md')) out.push(p)
  }
  return out
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------- FR-FMT-07 AC-1

test('fr_fmt_07_ac1_every_roundtrip_fixture_is_byte_identical_after_parse_and_serialize', () => {
  const files = fixtureFiles(ROUNDTRIP)
  expect(files.length).toBeGreaterThanOrEqual(40)
  const failures: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file))
    const text = decode(bytes)
    const doc = parse(text)
    const out = encode(serialize(doc))
    if (!bytesEqual(out, bytes) || doc.text !== text) failures.push(relative(ROUNDTRIP, file))
  }
  expect(failures).toEqual([])
})

test('fr_fmt_07_ac1_decode_keeps_bom_and_crlf_as_content', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Řádek\r\nDruhý\r\n')])
  const text = decode(bytes)
  expect(text).toBe('﻿Řádek\r\nDruhý\r\n')
  expect(bytesEqual(encode(text), bytes)).toBe(true)
  const doc = parse(text)
  expect(doc.bom).toBe(true)
  expect(doc.eol).toBe('\r\n')
  expect(doc.finalNewline).toBe(true)
  expect(serialize(doc)).toBe(text)
})

// ---------------------------------------------------------------- FR-FMT-07 AC-3

const FM = '---\nid: 01JA0000000000000000000001\ntype: page\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n'
const TEN_BLOCKS_BODY =
  '# Poznámka o řece\n' +
  '\n' +
  'První odstavec s *hvězdičkou* a __tučně__.  \n' +
  '\n' +
  '* položka jedna\n' +
  '* položka dva\n' +
  '\n' +
  '> Citace o vodě.\n' +
  '\n' +
  'Pátý odstavec s _důrazem_.\n' +
  '\n' +
  '\n' +
  '\n' +
  '```text\n' +
  'kód  \n' +
  '```\n' +
  '\n' +
  '---\n' +
  '\n' +
  '1) první\n' +
  '2) druhý\n' +
  '\n' +
  '- [ ] úkol\n' +
  '- [x] hotovo\n' +
  '\n' +
  'Poslední řádek bez konce'
const TEN_BLOCKS = FM + TEN_BLOCKS_BODY

test('fr_fmt_07_ac3_note_with_ten_blocks_is_split_into_ten_blocks', () => {
  const doc = parse(TEN_BLOCKS)
  expect(doc.blocks.map((b) => b.kind)).toEqual([
    'heading', 'paragraph', 'list', 'quote', 'paragraph', 'code', 'divider', 'list', 'checklist', 'paragraph',
  ])
  expect(doc.blocks[4]?.raw).toBe('Pátý odstavec s _důrazem_.')
  expect(doc.bodyStart).toBe(FM.length)
})

test('fr_fmt_07_ac3_editing_block_5_changes_only_block_5_bytes', () => {
  const doc = parse(TEN_BLOCKS)
  const out = editBlock(doc, 4, 'Pátý odstavec, nově upravený.')
  const expected = TEN_BLOCKS.replace('Pátý odstavec s _důrazem_.', 'Pátý odstavec, nově upravený.')
  expect(out).toBe(expected)
})

test('fr_fmt_07_ac3_edit_is_confined_to_the_block_range', () => {
  const doc = parse(TEN_BLOCKS)
  const range = doc.blocks[4]?.range
  expect(range).toEqual([TEN_BLOCKS.indexOf('Pátý'), TEN_BLOCKS.indexOf('Pátý') + 'Pátý odstavec s _důrazem_.'.length])
  const out = editBlock(doc, 4, 'Jiný text.')
  const start = TEN_BLOCKS.indexOf('Pátý')
  const end = start + 'Pátý odstavec s _důrazem_.'.length
  expect(out.slice(0, start)).toBe(TEN_BLOCKS.slice(0, start))
  expect(out.slice(start + 'Jiný text.'.length)).toBe(TEN_BLOCKS.slice(end))
})

// ---------------------------------------------------------------- FR-FMT-07 AC-4

const RAW_NOTE =
  'Úvodní odstavec s poznámkou[^1] a zalomením<br>uvnitř a vzorcem $e=mc^2$.\n' +
  '\n' +
  '<details>\n' +
  '<summary>Více o řece</summary>\n' +
  'Skrytý text.\n' +
  '</details>\n' +
  '\n' +
  '```dataview\n' +
  'TABLE autor FROM "Knihy"\n' +
  '```\n' +
  '\n' +
  '%%\n' +
  'Soukromý komentář, žluťoučký kůň.\n' +
  '%%\n' +
  '\n' +
  '$$\n' +
  'x^2 + y^2 = z^2\n' +
  '$$\n' +
  '\n' +
  '[^1]: Poznámka pod čarou.\n' +
  '\n' +
  'Závěrečný odstavec.\n'

test('fr_fmt_07_ac4_unknown_constructs_are_raw_blocks', () => {
  const doc = parse(RAW_NOTE)
  expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'raw', 'raw', 'raw', 'raw', 'raw', 'paragraph'])
})

test('fr_fmt_07_ac4_raw_content_is_preserved_when_editing_another_block', () => {
  const doc = parse(RAW_NOTE)
  const last = doc.blocks.length - 1
  expect(last).toBe(6)
  const out = editBlock(doc, last, 'Upravený závěr.')
  expect(out).toBe(RAW_NOTE.replace('Závěrečný odstavec.', 'Upravený závěr.'))
})

test('fr_fmt_07_ac4_inline_html_footnote_refs_and_math_survive_editing_their_paragraph_neighbour', () => {
  const doc = parse(RAW_NOTE)
  const out = editBlock(doc, 6, 'Jiný konec.')
  expect(out.startsWith('Úvodní odstavec s poznámkou[^1] a zalomením<br>uvnitř a vzorcem $e=mc^2$.\n')).toBe(true)
  expect(out).toBe(RAW_NOTE.replace('Závěrečný odstavec.', 'Jiný konec.'))
})

// ---------------------------------------------------------------- FR-FMT-07 AC-5

const STYLED_FM =
  '---\n' +
  '# Komentář na začátku\n' +
  'type: book\n' +
  'tags: [čtení, "systémy"]\n' +
  "status: 'rozpracováno'\n" +
  'popis: >-\n' +
  '  Dlouhý popis knihy\n' +
  '  na dva řádky.\n' +
  'neznamy-klic: "hodnota"   # komentář za hodnotou\n' +
  'hodnoceni: 4\n' +
  '---\n' +
  'Text poznámky.\n'

test('fr_fmt_07_ac5_editing_one_attribute_changes_only_its_line', () => {
  const doc = parse(STYLED_FM)
  const out = setAttribute(doc, 'status', 'hotovo')
  expect(out).toBe(STYLED_FM.replace("status: 'rozpracováno'\n", 'status: hotovo\n'))
})

test('fr_fmt_07_ac5_editing_a_folded_attribute_replaces_all_its_lines_only', () => {
  const doc = parse(STYLED_FM)
  const out = setAttribute(doc, 'popis', 'Krátký popis')
  expect(out).toBe(STYLED_FM.replace('popis: >-\n  Dlouhý popis knihy\n  na dva řádky.\n', 'popis: Krátký popis\n'))
})

test('fr_fmt_07_ac5_editing_a_number_keeps_comments_flow_lists_and_unknown_keys', () => {
  const doc = parse(STYLED_FM)
  const out = setAttribute(doc, 'hodnoceni', 5)
  expect(out).toBe(STYLED_FM.replace('hodnoceni: 4\n', 'hodnoceni: 5\n'))
})

test('fr_fmt_07_ac5_frontmatter_entries_expose_key_ranges', () => {
  const doc = parse(STYLED_FM)
  expect(doc.frontmatter?.entries.map((e) => e.key)).toEqual(['type', 'tags', 'status', 'popis', 'neznamy-klic', 'hodnoceni'])
  expect(doc.frontmatter?.data).toEqual({
    type: 'book', tags: ['čtení', 'systémy'], status: 'rozpracováno',
    popis: 'Dlouhý popis knihy na dva řádky.', 'neznamy-klic': 'hodnota', hodnoceni: 4,
  })
})

// ---------------------------------------------------------------- FR-FMT-07 AC-6

test('fr_fmt_07_ac6_missing_final_newline_is_kept_after_block_edit', () => {
  const text = 'První odstavec.\n\nPoslední bez konce řádku'
  const doc = parse(text)
  expect(doc.finalNewline).toBe(false)
  expect(editBlock(doc, 1, 'Upravený poslední')).toBe('První odstavec.\n\nUpravený poslední')
})

test('fr_fmt_07_ac6_missing_final_newline_is_kept_after_attribute_edit', () => {
  const text = '---\nstav: nový\n---\nTělo bez konce řádku'
  const doc = parse(text)
  expect(setAttribute(doc, 'stav', 'hotový')).toBe('---\nstav: hotový\n---\nTělo bez konce řádku')
})

test('fr_fmt_07_ac6_existing_final_newline_is_kept_after_edit', () => {
  const text = 'První odstavec.\n\nPoslední s koncem řádku.\n'
  const doc = parse(text)
  expect(doc.finalNewline).toBe(true)
  expect(editBlock(doc, 1, 'Změněný poslední.')).toBe('První odstavec.\n\nZměněný poslední.\n')
})

test('fr_fmt_07_ac6_many_trailing_newlines_are_kept_after_edit', () => {
  const text = 'Jediný odstavec.\n\n\n\n'
  const doc = parse(text)
  expect(editBlock(doc, 0, 'Jiný odstavec.')).toBe('Jiný odstavec.\n\n\n\n')
})

// ---------------------------------------------------------------- FR-STO-02

test('fr_sto_02_ac1_new_note_text_is_utf8_without_bom_with_lf_and_one_final_newline', () => {
  const text = newNote({
    type: 'page', title: 'Žluťoučký kůň', body: 'První řádek.\nDruhý řádek.\n',
    now: '2026-10-09T14:30:00+02:00', newId: () => '01JA2B3C4D5E6F7G8H9J0KMNPQ',
  })
  expect(text.startsWith('---\n')).toBe(true)
  expect(text.includes('\r')).toBe(false)
  expect(text.charCodeAt(0)).not.toBe(0xfeff)
  expect(text.endsWith('\n')).toBe(true)
  expect(text.endsWith('\n\n')).toBe(false)
  const bytes = encode(text)
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0x2d, 0x2d, 0x2d])
  expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(text)
})

test('fr_sto_02_ac2_crlf_file_keeps_crlf_when_an_attribute_is_added', () => {
  const text = '---\r\nid: 01JA0000000000000000000002\r\ntype: page\r\n---\r\nŘádek jedna.\r\n\r\nŘádek dva.\r\n'
  const doc = parse(text)
  expect(doc.eol).toBe('\r\n')
  expect(setAttribute(doc, 'stav', 'nový')).toBe(
    '---\r\nid: 01JA0000000000000000000002\r\ntype: page\r\nstav: nový\r\n---\r\nŘádek jedna.\r\n\r\nŘádek dva.\r\n',
  )
})

test('fr_sto_02_ac2_crlf_file_keeps_crlf_when_a_block_is_edited', () => {
  const text = 'Řádek jedna.\r\n\r\nŘádek dva.\r\n'
  const doc = parse(text)
  expect(editBlock(doc, 1, 'Nový řádek dva.')).toBe('Řádek jedna.\r\n\r\nNový řádek dva.\r\n')
})

test('fr_sto_02_ac2_bom_is_kept_when_editing', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('První.\n\nDruhý.\n')])
  const doc = parse(decode(bytes))
  expect(doc.bom).toBe(true)
  const out = editBlock(doc, 1, 'Změněný.')
  expect(out).toBe('﻿První.\n\nZměněný.\n')
  const outBytes = encode(out)
  expect([outBytes[0], outBytes[1], outBytes[2]]).toEqual([0xef, 0xbb, 0xbf])
})
