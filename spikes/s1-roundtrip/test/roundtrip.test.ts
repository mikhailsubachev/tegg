// FR-FMT-07 round-trip safety, FR-STO-02 envelope, NFR-REL-03 invalid frontmatter, AR-06 corpus.
import { describe, expect, test } from 'vitest'
import { editBlock, setAttribute, removeAttribute } from '../src/edit.js'
import { wikilinks, tags } from '../src/links.js'
import { encode, parse, serialize, type Doc } from '../src/parse.js'
import { byName, fixtures, simulateEdit } from './fixtures.js'

/** Assert `after` equals `before` except inside `range` of `before`. Returns the replaced text. */
function expectOnlyRangeChanged(before: string, after: string, [s, e]: readonly [number, number]): void {
  expect(after.slice(0, s)).toBe(before.slice(0, s))
  expect(after.slice(after.length - (before.length - e))).toBe(before.slice(e))
}

describe('AR-06 corpus', () => {
  test('ar_06_ac1_corpus_has_required_files_per_source', () => {
    const count = (dir: string) => fixtures.filter((f) => f.rel.startsWith(dir + '/')).length
    expect(count('obsidian')).toBeGreaterThanOrEqual(10)
    expect(count('capacities')).toBeGreaterThanOrEqual(10)
    expect(count('notion')).toBeGreaterThanOrEqual(5)
    expect(count('tegg')).toBeGreaterThanOrEqual(5)
  })
})

describe('FR-FMT-07 round-trip safety', () => {
  test.each(fixtures.map((f) => [f.rel, f] as const))('fr_fmt_07_ac1_unedited_roundtrip_is_byte_identical: %s', (_, f) => {
    const out = encode(serialize(parse(f.text)))
    expect(Buffer.from(out).equals(Buffer.from(f.bytes))).toBe(true)
  })

  test('fr_fmt_07_ac1_blocks_and_gaps_tile_the_body', () => {
    // Blocks are ordered, non-overlapping, and everything between them is whitespace,
    // so "only block k changed" is meaningful.
    for (const f of fixtures) {
      const doc = parse(f.text)
      let pos = doc.bodyStart
      for (const b of doc.blocks) {
        expect(b.range[0], f.rel).toBeGreaterThanOrEqual(pos)
        expect(doc.text.slice(pos, b.range[0]).trim(), f.rel).toBe('')
        pos = b.range[1]
      }
      expect(doc.text.slice(pos).trim(), f.rel).toBe('')
    }
  })

  // AC-3 + AC-4: editing block k changes only block k; every other block (raw ones included) keeps its bytes.
  const editCases = fixtures.flatMap((f) =>
    parse(f.text).blocks.flatMap((b, k) => (b.kind === 'raw' ? [] : [[`${f.rel} #${k} ${b.kind}`, f, k] as const])),
  )
  test.each(editCases)('fr_fmt_07_ac3_ac4_edit_one_block_changes_only_that_block: %s', (_, f, k) => {
    const doc = parse(f.text)
    const md = simulateEdit(doc.blocks[k].node, doc.blocks[k].raw)
    if (md === null) return // nothing textual to edit (e.g. a divider)
    const out = editBlock(doc, k, md)
    expectOnlyRangeChanged(doc.text, out, doc.blocks[k].range)

    const after = parse(out)
    expect(after.blocks.length).toBe(doc.blocks.length) // the edit didn't merge into or split neighbours
    after.blocks.forEach((b, i) => {
      if (i !== k) expect(b.raw).toBe(doc.blocks[i].raw)
    })
    expect(after.frontmatter?.data ?? null).toEqual(doc.frontmatter?.data ?? null)
    // The edited block keeps its type and every Obsidian construct in it (links, embeds, tags).
    expect(after.blocks[k].kind).toBe(doc.blocks[k].kind)
    const sig = (d: Doc) => wikilinks(d).map((l) => [l.embed, l.target, l.subpath, l.alias, l.escapedPipe])
    expect(sig(after)).toEqual(sig(doc))
    expect(tags(after).map((t) => t.name)).toEqual(tags(doc).map((t) => t.name))
  })

  test('fr_fmt_07_ac4_raw_blocks_are_not_editable_and_survive', () => {
    const f = byName('obsidian/07 HTML footnotes math.md')
    const doc = parse(f.text)
    const raw = doc.blocks.filter((b) => b.kind === 'raw')
    expect(raw.length).toBeGreaterThanOrEqual(3) // <details>, </details>, $$, footnote …
    expect(() => editBlock(doc, doc.blocks.indexOf(raw[0]), 'x')).toThrow()
    expect(byName('obsidian/08 Comments and unknown fences.md').text).toContain('```dataview')
    const kinds = parse(byName('obsidian/08 Comments and unknown fences.md').text).blocks.map((b) => b.kind)
    expect(kinds).toEqual(['raw', 'paragraph', 'raw', 'code', 'raw'])
  })

  // AC-5: changing one attribute changes only that entry's lines.
  const attrCases = fixtures.flatMap((f) => {
    const fm = parse(f.text).frontmatter
    return fm && !fm.error ? fm.entries.map((e) => [`${f.rel} :: ${e.key}`, f, e.key] as const) : []
  })
  test.each(attrCases)('fr_fmt_07_ac5_set_one_attribute_changes_only_its_lines: %s', (_, f, key) => {
    const doc = parse(f.text)
    const entry = doc.frontmatter!.entries.find((e) => e.key === key)!
    const out = setAttribute(doc, key, 'changed value')
    expectOnlyRangeChanged(doc.text, out, entry.range)
    const after = parse(out)
    expect(after.frontmatter!.error).toBeNull()
    expect(after.frontmatter!.data![key]).toBe('changed value')
    for (const [k, v] of Object.entries(doc.frontmatter!.data!)) if (k !== key) expect(after.frontmatter!.data![k]).toEqual(v)
    expect(after.blocks.map((b) => b.raw)).toEqual(doc.blocks.map((b) => b.raw))
  })

  test('fr_fmt_07_ac5_add_and_remove_attribute_keep_other_lines', () => {
    const doc = parse(byName('edge/Frontmatter styles.md').text)
    const added = parse(setAttribute(doc, 'rating', 4))
    expect(added.frontmatter!.data!.rating).toBe(4)
    expect(added.text.replace('rating: 4\n', '')).toBe(doc.text)
    const removed = removeAttribute(doc, 'flow')
    expect(removed).toBe(doc.text.replace('flow: [a, "b c", d]\n', ''))
    expect(doc.text).toContain('# a comment in frontmatter')
    expect(removed).toContain('# a comment in frontmatter')
  })

  test.each(fixtures.filter((f) => parse(f.text).blocks.length > 0).map((f) => [f.rel, f] as const))(
    'fr_fmt_07_ac6_final_newline_state_kept_after_edit: %s',
    (_, f) => {
      const doc = parse(f.text)
      const last = doc.blocks.length - 1
      const md = simulateEdit(doc.blocks[last].node, doc.blocks[last].raw)
      if (md === null || doc.blocks[last].kind === 'raw') return
      expect(parse(editBlock(doc, last, md)).finalNewline).toBe(doc.finalNewline)
    },
  )
})

describe('FR-FMT-07 adjacency (lazy continuation)', () => {
  test('fr_fmt_07_ac3_edited_quote_keeps_trailing_empty_marker_line', () => {
    const doc = parse(byName('edge/Quote lazy continuation.md').text)
    expect(doc.blocks.map((b) => b.kind)).toEqual(['quote', 'paragraph', 'callout', 'paragraph'])
    for (const k of [0, 2]) {
      const md = simulateEdit(doc.blocks[k].node, doc.blocks[k].raw)!
      const out = editBlock(doc, k, md)
      expectOnlyRangeChanged(doc.text, out, doc.blocks[k].range) // fixed inside the block, no fallback needed
      expect(parse(out).blocks.map((b) => b.kind)).toEqual(['quote', 'paragraph', 'callout', 'paragraph'])
    }
  })

  test('fr_fmt_07_ac3_fallback_adds_blank_line_when_neighbours_would_merge', () => {
    const doc = parse('> a\n>\nNext\n')
    const out = editBlock(doc, 0, '> b') // without the trailing `>` line, "Next" would join the quote
    expect(out).toBe('> b\n\nNext\n')
    expect(parse(out).blocks.map((b) => b.kind)).toEqual(['quote', 'paragraph'])
  })
})

describe('FR-STO-02 file envelope', () => {
  test('fr_sto_02_ac2_crlf_kept_after_edit', () => {
    const doc = parse(byName('edge/CRLF line endings.md').text)
    expect(doc.eol).toBe('\r\n')
    const list = doc.blocks.findIndex((b) => b.kind === 'list')
    const out = editBlock(doc, list, '- one\n- two\n- three')
    expect(out).toContain('- two\r\n- three\r\n')
    expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/)
    const out2 = setAttribute(parse(out), 'status', 'done')
    expect(out2).toContain('status: done\r\n---\r\n')
  })

  test('fr_sto_02_ac2_bom_kept_after_edit', () => {
    const doc = parse(byName('edge/BOM.md').text)
    expect(doc.bom).toBe(true)
    expect(doc.frontmatter!.data!.title).toBe('With BOM')
    const out = setAttribute(doc, 'title', 'Changed')
    expect(out.startsWith('﻿---\ntitle: Changed\n')).toBe(true)
  })

  test('fr_sto_02_ac1_new_text_is_nfc', () => {
    const doc = parse('Text.\n')
    const nfd = 'Čtení'.normalize('NFD')
    expect(editBlock(doc, 0, nfd)).toBe('Čtení'.normalize('NFC') + '\n')
  })
})

describe('NFR-REL-03 invalid frontmatter', () => {
  test('nfr_rel_03_ac1_invalid_yaml_does_not_crash_and_reports_line', () => {
    const doc = parse(byName('edge/Invalid YAML.md').text)
    expect(doc.frontmatter!.error).not.toBeNull()
    expect(doc.frontmatter!.error!.line).toBeGreaterThanOrEqual(2)
    expect(doc.frontmatter!.data).toBeNull()
    expect(doc.blocks.map((b) => b.raw)).toEqual(['Body stays readable.'])
    expect(() => setAttribute(doc, 'x', 1)).toThrow(/never rewritten/)
  })

  test('nfr_rel_03_ac1_unclosed_frontmatter_is_body_with_warning', () => {
    const doc = parse(byName('edge/Unclosed frontmatter.md').text)
    expect(doc.frontmatter).toBeNull()
    expect(doc.frontmatterWarning).toMatch(/not closed/)
  })
})

export type { Doc }
