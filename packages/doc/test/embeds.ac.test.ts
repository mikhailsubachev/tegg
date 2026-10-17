// MS4 slice 4F, L1: the embed helpers of @tegg/doc (docs/contracts/ms4-embeds.md §2): the mode keyword
// (FR-EMB-02 AC-1, D-416), the line text of a mode change (FR-EMB-02 AC-8), the shown section of a `#Heading` or
// `#^id` embed (FR-EMB-02 AC-3, D-422) and the block / inline embeds of a body (FR-EMB-01 AC-3, AC-4, D-419).
// Written from docs/acceptance/embeds.md and the contract only (D-61). Fixture: tests/fixtures/vaults/embeds (read only;
// `Pages/NFD vložení.md` holds NFD bytes on purpose).
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { embedParts, withEmbedMode, embedSection, embedsIn, parse } from '../src/index.js'

const FIXTURE = resolve(import.meta.dirname, '../../../tests/fixtures/vaults/embeds')
const note = (rel: string) => readFileSync(resolve(FIXTURE, rel), 'utf8')

const NFD_CIL = 'Cíl'
const NFD_UVOD = 'Úvod'

/** The 12 embed values of Režimy in file order (fixture README "Derived facts"). */
const REZIMY = [
  'Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07',
  'Cíl|card', 'Jana Nováková|full', 'Svíčková|link', 'Cíl|jiný text',
]

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-1

test('fr_emb_02_ac1_embed_parts_reads_the_mode_keyword', () => {
  expect(embedParts('Cíl|card')).toEqual({ target: 'Cíl', subpath: null, mode: 'card', rest: 'card' })
  expect(embedParts('Cíl|jiný text')).toEqual({ target: 'Cíl', subpath: null, mode: null, rest: 'jiný text' })
  expect(embedParts('Cíl#Úvod')).toEqual({ target: 'Cíl', subpath: 'Úvod', mode: null, rest: null })
  expect(embedParts('Cíl')).toEqual({ target: 'Cíl', subpath: null, mode: null, rest: null })
  expect(embedParts('Jana Nováková|full')).toEqual({ target: 'Jana Nováková', subpath: null, mode: 'full', rest: 'full' })
  expect(embedParts('Svíčková|link')).toEqual({ target: 'Svíčková', subpath: null, mode: 'link', rest: 'link' })
  // Case-insensitive and trimmed (D-416); `rest` is the text after `|` as written.
  expect(embedParts('Cíl|CARD').mode).toBe('card')
  expect(embedParts('Cíl| Full ').mode).toBe('full')
  expect(embedParts('Cíl|LiNk').mode).toBe('link')
  // Subpath and mode together; block subpaths keep their `^`.
  expect(embedParts('Cíl#Úvod|link')).toEqual({ target: 'Cíl', subpath: 'Úvod', mode: 'link', rest: 'link' })
  expect(embedParts('Cíl#^blok1')).toEqual({ target: 'Cíl', subpath: '^blok1', mode: null, rest: null })
  // The table-cell form `\|` is accepted like `|`.
  expect(embedParts('Cíl\\|card')).toEqual({ target: 'Cíl', subpath: null, mode: 'card', rest: 'card' })
  // Not a keyword: a word that merely starts with one, or another word.
  expect(embedParts('Cíl|cards').mode).toBe(null)
  expect(embedParts('Cíl|obrovský').mode).toBe(null)
  // The target is trimmed but not normalized (the caller compares NFC).
  expect(embedParts(' Cíl |card').target).toBe('Cíl')
  expect(embedParts(`${NFD_CIL}|card`).target).toBe(NFD_CIL)
})

test('fr_emb_02_ac1_rezimy_override_keywords_in_file_order', () => {
  const modes = REZIMY.map((v) => embedParts(v).mode)
  expect(modes).toEqual([null, null, null, null, null, null, null, null, 'card', 'full', 'link', null])
  expect(REZIMY.map((v) => embedParts(v).target)).toEqual([
    'Cíl', 'Jana Nováková', 'Šárka Malá', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07',
    'Cíl', 'Jana Nováková', 'Svíčková', 'Cíl',
  ])
  // AP-319: text after `|` that isn't a keyword is ignored for the mode and kept.
  expect(embedParts('Cíl|jiný text').rest).toBe('jiný text')
})

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-8

test('fr_emb_02_ac8_with_embed_mode_gives_the_line_text', () => {
  // Choosing Full on Jana's card.
  expect(withEmbedMode('Jana Nováková', 'full')).toBe('Jana Nováková|full')
  // Choosing the type default on `|full` removes the keyword.
  expect(withEmbedMode('Jana Nováková|full', null)).toBe('Jana Nováková')
  // A change replaces any other text after `|` (⌘Z restores it in the editor).
  expect(withEmbedMode('Cíl|jiný text', 'card')).toBe('Cíl|card')
  expect(withEmbedMode('Cíl|card', 'link')).toBe('Cíl|link')
  expect(withEmbedMode('Cíl|CARD', null)).toBe('Cíl')
  // Subpaths stay as written.
  expect(withEmbedMode('Cíl#Úvod', 'card')).toBe('Cíl#Úvod|card')
  expect(withEmbedMode('Cíl#^blok1|full', 'link')).toBe('Cíl#^blok1|link')
  // NFD target and subpath bytes are kept (FR-FMT-12 AC-5).
  const nfd = `${NFD_CIL}#${NFD_UVOD}`
  const out = withEmbedMode(nfd, 'card')
  expect(Buffer.from(out, 'utf8').toString('hex')).toBe(Buffer.from(`${nfd}|card`, 'utf8').toString('hex'))
  // The table-cell form keeps its `\|`.
  expect(withEmbedMode('Cíl\\|card', 'link')).toBe('Cíl\\|link')
  expect(withEmbedMode('Cíl\\|card', null)).toBe('Cíl')
  // Writing is lower case.
  expect(withEmbedMode('Cíl', 'full')).toBe('Cíl|full')
})

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-3

const CIL = () => note('Pages/Cíl.md')
const after = (text: string, line: string) => {
  const i = text.indexOf(line)
  expect(i, `fixture contains ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0)
  return i + line.length
}
const at = (text: string, s: string) => {
  const i = text.indexOf(s)
  expect(i, `fixture contains ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(0)
  return i
}

test('fr_emb_02_ac3_heading_section_runs_to_the_next_heading_of_the_same_or_higher_level', () => {
  const text = CIL()
  const want = { kind: 'heading', from: after(text, '## Úvod\n'), to: at(text, '## Druhá kapitola'), heading: { level: 2, text: 'Úvod', line: 11 } }
  expect(embedSection(text, 'Úvod')).toEqual(want)
  const shown = text.slice(want.from, want.to)
  expect(shown).toContain('Text v úvodu s odkazem na [[Jana Nováková]].')
  expect(shown).toContain('### Podkapitola')
  expect(shown).toContain('Vnořený text podkapitoly.')
  expect(shown).not.toContain('Druhá kapitola')
  expect(shown).not.toContain('## Úvod')
  // NFC, trimmed, case-insensitive (D-140's scroll rule).
  expect(embedSection(text, 'úvod')).toEqual(want)
  expect(embedSection(text, ' Úvod ')).toEqual(want)
  expect(embedSection(text, NFD_UVOD)).toEqual(want)
  expect(embedSection(text, 'ÚVOD')).toEqual(want)
})

test('fr_emb_02_ac3_subsection_and_last_section', () => {
  const text = CIL()
  expect(embedSection(text, 'Podkapitola')).toEqual({
    kind: 'heading', from: after(text, '### Podkapitola\n'), to: at(text, '## Druhá kapitola'), heading: { level: 3, text: 'Podkapitola', line: 15 },
  })
  const pod = embedSection(text, 'Podkapitola') as { from: number; to: number }
  expect(text.slice(pod.from, pod.to).trim()).toBe('Vnořený text podkapitoly.')
  const last = embedSection(text, 'Druhá kapitola')
  expect(last).toEqual({ kind: 'heading', from: after(text, '## Druhá kapitola\n'), to: text.length, heading: { level: 2, text: 'Druhá kapitola', line: 19 } })
  const l = last as { from: number; to: number }
  expect(text.slice(l.from, l.to).trim()).toBe('Odstavec s identifikátorem. ^blok1\n\nPoslední odstavec cíle.')
})

test('fr_emb_02_ac3_block_section_is_the_block_with_the_id', () => {
  const text = CIL()
  const s = embedSection(text, '^blok1')
  expect(s.kind).toBe('block')
  const b = s as { kind: 'block'; from: number; to: number; id: string }
  expect(b.id).toBe('blok1')
  expect(b.from).toBe(at(text, 'Odstavec s identifikátorem.'))
  expect(text.slice(b.from, b.to).replace(/\n+$/, '')).toBe('Odstavec s identifikátorem. ^blok1')
  // Ids are compared exactly.
  expect(embedSection(text, '^Blok1').kind).toBe('missing')
})

test('fr_emb_02_ac3_whole_note_and_missing_parts', () => {
  const text = CIL()
  expect(embedSection(text, null)).toEqual({ kind: 'whole', from: parse(text).bodyStart, to: text.length })
  expect(text.slice(parse(text).bodyStart).startsWith('Úvodní odstavec cíle.')).toBe(true)
  const h = embedSection(text, 'Neexistující nadpis')
  expect(h).toEqual({ kind: 'missing', subpath: 'Neexistující nadpis', block: false })
  const b = embedSection(text, '^chybí')
  expect(b.kind).toBe('missing')
  expect((b as { block: boolean }).block).toBe(true)
  expect(['^chybí', 'chybí']).toContain((b as { subpath: string }).subpath)
})

test('fr_emb_02_ac3_the_first_matching_heading_wins_and_own_section_of_obsah', () => {
  const text = '---\nid: 01JB4F0000000000000000X001\ntype: page\n---\n## Úvod\n\nPrvní.\n\n## Úvod\n\nDruhý.\n'
  const s = embedSection(text, 'úvod') as { kind: string; from: number; to: number; heading: { line: number } }
  expect(s.kind).toBe('heading')
  expect(text.slice(s.from, s.to).trim()).toBe('První.')
  expect(s.heading.line).toBe(5)
  const obsah = note('Pages/Obsah.md')
  const o = embedSection(obsah, 'Kapitola jedna')
  expect(o).toEqual({ kind: 'heading', from: after(obsah, '## Kapitola jedna\n'), to: at(obsah, '## Přehled'), heading: { level: 2, text: 'Kapitola jedna', line: 8 } })
})

test('fr_emb_02_ac3_nfd_section_embed_finds_the_nfc_heading', () => {
  const host = note('Pages/NFD vložení.md')
  expect(host.includes(`![[${NFD_CIL}#${NFD_UVOD}]]`)).toBe(true) // setup: the NFD bytes are there
  const values = embedsIn(host).block.map((b) => b.value)
  expect(values).toEqual([NFD_CIL, `${NFD_CIL}#${NFD_UVOD}`])
  const sub = embedParts(values[1]).subpath
  expect(sub).toBe(NFD_UVOD)
  expect(embedSection(CIL(), sub)).toEqual(embedSection(CIL(), 'Úvod'))
  expect(embedSection(CIL(), sub).kind).toBe('heading')
})

// ------------------------------------------------------------------------------------------------ FR-EMB-01 AC-3, AC-4

test('fr_emb_01_ac3_block_embeds_of_rezimy_in_file_order', () => {
  const r = embedsIn(note('Pages/Režimy.md'))
  expect(r.block).toEqual(REZIMY.map((value, i) => ({ value, line: 10 + 2 * i })))
  expect(r.inline).toEqual([])
})

test('fr_emb_01_ac3_embeds_inside_text_lists_quotes_and_tables_are_inline', () => {
  const r = embedsIn(note('Pages/Uvnitř textu.md'))
  expect(r.block).toEqual([])
  expect(r.inline).toEqual([
    { value: 'Cíl', line: 8 },
    { value: 'Jana Nováková', line: 10 },
    { value: 'Cíl', line: 11 },
    { value: 'Cíl', line: 13 },
    { value: 'Cíl', line: 17 },
  ])
  // A sole-embed paragraph inside a callout or under a heading line is inline too; a top-level one is a block.
  const t = '---\ntype: page\n---\n> [!note]\n> ![[Cíl]]\n\n## ![[Cíl]]\n\n![[Cíl]]\n'
  const c = embedsIn(t)
  expect(c.block).toEqual([{ value: 'Cíl', line: 9 }])
  expect(c.inline).toEqual([{ value: 'Cíl', line: 5 }, { value: 'Cíl', line: 7 }])
})

test('fr_emb_01_ac4_code_comments_frontmatter_and_attachments_are_not_embeds', () => {
  const broken = embedsIn(note('Pages/Rozbitá vložení.md'))
  expect(broken.block).toEqual([
    { value: 'Chybí', line: 8 },
    { value: 'Šablona', line: 10 },
    { value: 'Smazaná', line: 12 },
    { value: 'Reading list', line: 14 },
    { value: '2026-10-20', line: 16 },
    { value: 'Chyba hlavičky', line: 20 },
  ])
  expect(broken.inline).toEqual([]) // `![[Cíl]]` in inline code isn't an embed; `obrázek.png` is an attachment
  const t = [
    '---',
    'type: page',
    'vztah: "![[Cíl]]"',
    '---',
    '```',
    '![[Cíl]]',
    '```',
    '',
    '%%![[Cíl]]%%',
    '',
    'Text `![[Cíl]]` a ![[Jana Nováková]].',
    '',
    '![[Svíčková]]',
    '',
    '![[mapa.png]]',
    '',
    '![[průvodce.pdf#page=3]]',
    '',
  ].join('\n')
  const r = embedsIn(t)
  expect(r.block).toEqual([{ value: 'Svíčková', line: 13 }])
  expect(r.inline).toEqual([{ value: 'Jana Nováková', line: 11 }])
})

test('fr_emb_01_ac3_embeds_in_a_section_only', () => {
  const obsah = note('Pages/Obsah.md')
  const from = at(obsah, '## Přehled')
  expect(embedsIn(obsah, from, obsah.length)).toEqual({ block: [{ value: 'Obsah#Kapitola jedna', line: 14 }], inline: [] })
  expect(embedsIn(obsah, 0, from)).toEqual({ block: [], inline: [] })
  const kos = embedsIn(note('Pages/Kosočtverec.md'))
  expect(kos).toEqual({ block: [{ value: 'Větev 1', line: 8 }, { value: 'Větev 2', line: 10 }], inline: [] })
})
