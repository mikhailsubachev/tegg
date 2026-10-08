// FR-FMT-03/-04 links and embeds, FR-FMT-10 tags, FR-FMT-11 dates, FR-FMT-12 Unicode, rename groundwork (FR-LNK-03).
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { renameLinkTarget, setAttribute, setDateRange } from '../src/edit.js'
import { nameKey, resolve, tags, wikilinks } from '../src/links.js'
import { parse } from '../src/parse.js'
import { byName, fixtures } from './fixtures.js'

const linksOf = (text: string) => wikilinks(parse(text))

describe('FR-FMT-03 / FR-FMT-04 link and embed syntax', () => {
  test('fr_fmt_03_ac1_all_link_and_embed_forms_are_parsed', () => {
    const text = [
      '[[Note]] [[Note|alias]] [[Note#Heading]] [[Note#^blockid]]',
      '![[Note]] ![[Note#^blockid]] ![[image.png|400]] ![[file.pdf#page=3]]',
    ].join('\n')
    const l = linksOf(text)
    expect(l.map((x) => [x.embed, x.target, x.subpath, x.alias])).toEqual([
      [false, 'Note', null, null],
      [false, 'Note', null, 'alias'],
      [false, 'Note', 'Heading', null],
      [false, 'Note', '^blockid', null],
      [true, 'Note', null, null],
      [true, 'Note', '^blockid', null],
      [true, 'image.png', null, '400'],
      [true, 'file.pdf', 'page=3', null],
    ])
  })

  test('fr_fmt_03_ac2_relation_attributes_are_quoted_links', () => {
    const doc = parse('---\ntitle: x\n---\n')
    const one = setAttribute(doc, 'source', { link: 'Weekly Sync' })
    expect(one).toContain('source: "[[Weekly Sync]]"\n')
    const many = setAttribute(parse(one), 'attendees', [{ link: 'Jana' }, { link: 'Tomáš' }])
    expect(many).toContain('attendees:\n  - "[[Jana]]"\n  - "[[Tomáš]]"\n')
    const fmLinks = linksOf(many).filter((l) => l.inFrontmatter).map((l) => l.target)
    expect(fmLinks).toEqual(['Weekly Sync', 'Jana', 'Tomáš'])
  })

  test('fr_fmt_03_ac3_escaped_pipe_in_table_links', () => {
    const l = wikilinks(parse(byName('obsidian/04 Tables.md').text))
    const dune = l.find((x) => x.target === 'Dune')!
    expect(dune.escapedPipe).toBe(true)
    expect(dune.alias).toBe('the book')
    expect(l.map((x) => x.target)).toEqual(['Dune', 'Emma'])
  })

  test('fr_fmt_03_ac4_links_in_code_and_comments_are_not_links', () => {
    const l = wikilinks(parse(byName('obsidian/10 Links in code are ignored.md').text))
    expect(l.map((x) => x.target)).toEqual(['Target note'])
    expect(linksOf('%% [[hidden]] %%\n\n`[[code]]`\n')).toEqual([])
  })
})

describe('FR-FMT-10 tags', () => {
  const doc = parse(byName('obsidian/06 Tags inline and frontmatter.md').text)
  const names = tags(doc).map((t) => t.name)

  test('fr_fmt_10_ac2_inline_and_frontmatter_tags_are_the_same_tag', () => {
    const keys = new Set(tags(doc).map((t) => t.key))
    expect(names).toContain('čtení') // frontmatter
    expect(names).toContain('Čtení') // inline
    expect([...keys].filter((k) => k === 'čtení')).toHaveLength(1)
  })

  test('fr_fmt_10_ac3_matching_is_case_insensitive_and_nfc', () => {
    const nfd = parse(`#${'Čtení'.normalize('NFD')}\n`)
    expect(tags(nfd)[0].key).toBe('čtení')
    expect(tags(nfd)[0].name).toBe('Čtení'.normalize('NFD')) // stored spelling kept
  })

  test('fr_fmt_10_ac4_things_that_are_not_tags', () => {
    expect(names).toEqual(['project', 'čtení', 'idea', 'Čtení', 'multi-word_tag', 'area/work', 'start-of-line'])
    for (const not of ['1', '123', 'anchor', 'code', 'Heading']) expect(names).not.toContain(not)
    expect(tags(parse(byName('obsidian/10 Links in code are ignored.md').text)).map((t) => t.name)).toEqual([])
  })
})

describe('FR-FMT-11 dates', () => {
  const doc = parse('---\ntitle: x\n---\n')

  test('fr_fmt_11_ac1_date_is_written_without_time_or_offset', () => {
    const out = setAttribute(doc, 'due', { date: '2026-10-09' })
    expect(out).toContain('due: 2026-10-09\n')
    expect(parse(out).frontmatter!.data!.due).toBe('2026-10-09') // YAML 1.2 core: a string, no Date shift
    expect(() => setAttribute(doc, 'due', { date: '2026-10-09T00:00:00.000Z' })).toThrow()
  })

  test('fr_fmt_11_ac3_datetime_is_iso_with_offset', () => {
    const out = setAttribute(doc, 'departure', { datetime: '2026-10-09T14:30:00+02:00' })
    expect(out).toContain('departure: 2026-10-09T14:30:00+02:00\n')
    expect(() => setAttribute(doc, 'departure', { datetime: '2026-10-09T14:30:00' })).toThrow()
  })

  test('fr_fmt_11_ac4_date_range_is_two_properties', () => {
    const out = setDateRange(doc, 'dates', '2026-07-01', '2026-07-14')
    expect(out).toBe('---\ntitle: x\ndates-start: 2026-07-01\ndates-end: 2026-07-14\n---\n')
  })
})

describe('FR-FMT-12 Unicode normalization', () => {
  test('fr_fmt_12_ac1_nfc_link_resolves_to_nfd_file_name', () => {
    // Created at test time: git on macOS would store an NFD fixture name as NFC.
    const dir = mkdtempSync(join(tmpdir(), 'tegg-nfd-'))
    const nfdName = 'Čtení poznámky.md'.normalize('NFD')
    writeFileSync(join(dir, nfdName), 'Name stored in NFD.\n')
    const onDisk = readdirSync(dir)
    expect(onDisk[0]).toBe(nfdName) // APFS keeps the name exactly as written
    expect(onDisk[0]).not.toBe(onDisk[0].normalize('NFC'))
    const link = wikilinks(parse('Link [[Čtení poznámky]] written in NFC.\n'))[0]
    expect(link.target).toBe(link.target.normalize('NFC'))
    expect(resolve(link.target, onDisk)).toBe(nfdName)
    rmSync(dir, { recursive: true })
  })

  test('fr_fmt_12_ac2_written_link_targets_are_nfc', () => {
    const doc = parse('See [[Old]].\n')
    const out = renameLinkTarget(doc, 'Old', 'Čtení'.normalize('NFD'))
    expect(out).toBe('See [[Čtení]].\n'.normalize('NFC'))
  })

  test('fr_fmt_12_name_key_ignores_case_and_normalization', () => {
    expect(nameKey('ČTENÍ'.normalize('NFD'))).toBe(nameKey('čtení'))
  })
})

describe('FR-LNK-03 rename groundwork', () => {
  test('fr_lnk_03_ac1_rename_changes_only_link_targets_in_every_form', () => {
    const text = [
      '---',
      'source: "[[Old note]]"',
      'related:',
      '  - "[[old NOTE]]"',
      '---',
      'Text [[Old note]], [[Old note|alias]], [[Old note#Heading]], [[Old note#^b1]].',
      '',
      '![[Old note]]',
      '',
      '| a | b |',
      '| - | - |',
      '| [[Old note\\|x]] | `[[Old note]]` |',
      '',
      '[[Older note]] stays.',
      '',
    ].join('\n')
    const out = renameLinkTarget(parse(text), 'Old note', 'New note')
    expect(out).toBe(
      text
        .replace(/\[\[Old note(?=[\]|#\\])/g, '[[New note')
        .replace('"[[old NOTE]]"', '"[[New note]]"')
        .replace('`[[New note]]`', '`[[Old note]]`'), // code span untouched
    )
  })

  test('fr_lnk_03_rename_across_all_fixtures_touches_only_targets', () => {
    for (const f of fixtures) {
      const doc = parse(f.text)
      for (const target of new Set(wikilinks(doc).map((l) => l.target))) {
        const out = renameLinkTarget(doc, target, 'Renamed')
        const after = parse(out)
        // Same number of links, same subpaths/aliases, every renamed link now points to "Renamed".
        const a = wikilinks(doc)
        const b = wikilinks(after)
        expect(b.length, f.rel).toBe(a.length)
        b.forEach((l, i) => {
          expect(l.alias).toBe(a[i].alias)
          expect(l.subpath).toBe(a[i].subpath)
          expect(l.target).toBe(nameKey(a[i].target) === nameKey(target) ? 'Renamed' : a[i].target)
        })
        expect(after.blocks.length, f.rel).toBe(doc.blocks.length)
      }
    }
  })
})
