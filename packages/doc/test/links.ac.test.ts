// AC tests for FR-FMT-03/-04 (links, embeds), FR-FMT-05/-06 (mindmap, query blocks),
// FR-FMT-08 (link rewrite on rename, doc level), FR-FMT-10 (tags) and FR-FMT-12 AC-2 (NFC on write).
// Written from docs/acceptance/*.md, docs/markdown-dialect.md and docs/contracts/ms1-core.md §4 only (D-61).
import { test, expect } from 'vitest'
import { parse, serialize, wikilinks, renameLinkTarget, setAttribute, tags, tagKey, extract } from '../src/index.js'

const range = (text: string, needle: string, from = 0): [number, number] => {
  const i = text.indexOf(needle, from)
  return [i, i + needle.length]
}

// ---------------------------------------------------------------- FR-FMT-03 / FR-FMT-04

const LINKS =
  'Odkazy: [[Řeka]], [[Řeka|alias řeky]], [[Řeka#Prameny]], [[Řeka#^blok-1]].\n' +
  '\n' +
  '![[Řeka]]\n' +
  '\n' +
  '![[Řeka#^blok-1]]\n' +
  '\n' +
  '![[mapa.png|400]]\n' +
  '\n' +
  '![[průvodce.pdf#page=3]]\n'

test('fr_fmt_03_ac1_parser_recognizes_every_link_and_embed_form', () => {
  const doc = parse(LINKS)
  const L = (embed: boolean, needle: string, target: string, subpath: string | null, alias: string | null, from = 0) =>
    ({ embed, range: range(LINKS, needle, from), target, subpath, alias, escapedPipe: false, inFrontmatter: false })
  const secondEmbed = LINKS.indexOf('![[Řeka#^blok-1]]')
  expect(wikilinks(doc)).toEqual([
    L(false, '[[Řeka]]', 'Řeka', null, null),
    L(false, '[[Řeka|alias řeky]]', 'Řeka', null, 'alias řeky'),
    L(false, '[[Řeka#Prameny]]', 'Řeka', 'Prameny', null),
    L(false, '[[Řeka#^blok-1]]', 'Řeka', '^blok-1', null),
    L(true, '![[Řeka]]', 'Řeka', null, null),
    L(true, '![[Řeka#^blok-1]]', 'Řeka', '^blok-1', null, secondEmbed),
    L(true, '![[mapa.png|400]]', 'mapa.png', null, '400'),
    L(true, '![[průvodce.pdf#page=3]]', 'průvodce.pdf', 'page=3', null),
  ])
})

test('fr_fmt_03_ac1_every_link_form_is_written_back_verbatim', () => {
  const doc = parse(LINKS)
  expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'embed', 'embed', 'embed', 'embed'])
  expect(serialize(doc)).toBe(LINKS)
  expect(extract(LINKS, 'Odkazy').links).toEqual([
    { target: 'Řeka', subpath: null, alias: null, embed: false, inFrontmatter: false },
    { target: 'Řeka', subpath: null, alias: 'alias řeky', embed: false, inFrontmatter: false },
    { target: 'Řeka', subpath: 'Prameny', alias: null, embed: false, inFrontmatter: false },
    { target: 'Řeka', subpath: '^blok-1', alias: null, embed: false, inFrontmatter: false },
    { target: 'Řeka', subpath: null, alias: null, embed: true, inFrontmatter: false },
    { target: 'Řeka', subpath: '^blok-1', alias: null, embed: true, inFrontmatter: false },
    { target: 'mapa.png', subpath: null, alias: '400', embed: true, inFrontmatter: false },
    { target: 'průvodce.pdf', subpath: 'page=3', alias: null, embed: true, inFrontmatter: false },
  ])
})

const REL_BASE = '---\nid: 01JA0000000000000000000004\ntype: task\n---\nÚkol.\n'

test('fr_fmt_03_ac2_single_relation_is_a_quoted_link_string', () => {
  expect(setAttribute(parse(REL_BASE), 'zdroj-schuzky', { link: 'Týdenní porada' }))
    .toBe(REL_BASE.replace('type: task\n', 'type: task\nzdroj-schuzky: "[[Týdenní porada]]"\n'))
})

test('fr_fmt_03_ac2_multiple_relations_are_a_yaml_list_of_quoted_links', () => {
  expect(setAttribute(parse(REL_BASE), 'lide', [{ link: 'Jana' }, { link: 'Tomáš' }]))
    .toBe(REL_BASE.replace('type: task\n', 'type: task\nlide:\n  - "[[Jana]]"\n  - "[[Tomáš]]"\n'))
})

test('fr_fmt_03_ac2_relation_links_in_frontmatter_are_recognized', () => {
  const text = '---\nzdroj: "[[Porada]]"\nlide:\n  - "[[Jana]]"\n  - "[[Tomáš|Tom]]"\n---\nText.\n'
  const links = wikilinks(parse(text))
  expect(links.map((l) => [l.target, l.alias, l.inFrontmatter, l.embed])).toEqual([
    ['Porada', null, true, false],
    ['Jana', null, true, false],
    ['Tomáš', 'Tom', true, false],
  ])
  expect(links[0]?.range).toEqual(range(text, '[[Porada]]'))
})

const TABLE =
  '| Kniha | Odkaz |\n' +
  '| --- | --- |\n' +
  '| Duna | [[Duna\\|kniha]] |\n' +
  '| Ema | [[Ema]] |\n'

test('fr_fmt_03_ac3_escaped_pipe_in_table_link_is_parsed', () => {
  const doc = parse(TABLE)
  expect(doc.blocks.map((b) => b.kind)).toEqual(['table'])
  const links = wikilinks(doc)
  expect(links).toEqual([
    { embed: false, range: range(TABLE, '[[Duna\\|kniha]]'), target: 'Duna', subpath: null, alias: 'kniha', escapedPipe: true, inFrontmatter: false },
    { embed: false, range: range(TABLE, '[[Ema]]'), target: 'Ema', subpath: null, alias: null, escapedPipe: false, inFrontmatter: false },
  ])
})

test('fr_fmt_03_ac3_escaped_pipe_is_written_back_when_the_target_changes', () => {
  expect(renameLinkTarget(parse(TABLE), 'Duna', 'Duna (2)')).toBe(TABLE.replace('[[Duna\\|kniha]]', '[[Duna (2)\\|kniha]]'))
})

const CODE =
  'Skutečný odkaz [[Cíl]] tady.\n' +
  '\n' +
  'Kód `[[Není odkaz]]` a `![[není vložení]]`.\n' +
  '\n' +
  '```\n' +
  '[[Také není odkaz]]\n' +
  '```\n' +
  '\n' +
  '    [[Odsazený kód]]\n'

test('fr_fmt_03_ac4_links_in_code_spans_and_code_blocks_are_not_links', () => {
  const doc = parse(CODE)
  expect(wikilinks(doc).map((l) => l.target)).toEqual(['Cíl'])
  expect(extract(CODE, 'Kód').links.map((l) => l.target)).toEqual(['Cíl'])
})

// ---------------------------------------------------------------- FR-FMT-05 / FR-FMT-06

test('fr_fmt_05_ac1_mermaid_block_starting_with_mindmap_is_a_mindmap_block', () => {
  const text = '```mermaid\nmindmap\n  root((Řeka))\n    Prameny\n    Přítoky\n```\n\n```mermaid\ngraph TD\n  A-->B\n```\n'
  const doc = parse(text)
  expect(doc.blocks.map((b) => b.kind)).toEqual(['mindmap', 'code'])
  expect(serialize(doc)).toBe(text)
})

test('fr_fmt_05_ac2_query_fence_is_a_query_block', () => {
  const text = '```query\ntypes: [task]\nfilter:\n  - attribute: status\n    op: is\n    value: hotovo\nview: list\n```\n'
  const doc = parse(text)
  expect(doc.blocks.map((b) => b.kind)).toEqual(['query'])
  expect(doc.blocks[0]?.raw).toBe(text.slice(0, -1))
})

// ---------------------------------------------------------------- FR-FMT-08 / FR-LNK-03 (doc level)

const LINKING =
  '---\n' +
  'id: 01JA0000000000000000000005\n' +
  'type: page\n' +
  'zdroj: "[[Řeka]]"\n' +
  'souvisejici:\n' +
  '  - "[[Řeka]]"\n' +
  '  - "[[Jiná]]"\n' +
  '---\n' +
  'Text [[Řeka]], [[Řeka|alias]], [[Řeka#Nadpis]], [[Řeka#^blok]], ale [[Řekař]] a [[Jiná]].\n' +
  '\n' +
  '![[Řeka]]\n' +
  '\n' +
  '| A | B |\n' +
  '| --- | --- |\n' +
  '| x | [[Řeka\\|v tabulce]] |\n' +
  '\n' +
  'Kód `[[Řeka]]` zůstává.\n' +
  '\n' +
  '```\n' +
  '[[Řeka]]\n' +
  '```\n'

test('fr_fmt_08_ac1_rename_rewrites_every_link_form_and_keeps_alias_heading_and_block', () => {
  const out = renameLinkTarget(parse(LINKING), 'Řeka', 'Vltava')
  expect(out).toBe(
    '---\n' +
    'id: 01JA0000000000000000000005\n' +
    'type: page\n' +
    'zdroj: "[[Vltava]]"\n' +
    'souvisejici:\n' +
    '  - "[[Vltava]]"\n' +
    '  - "[[Jiná]]"\n' +
    '---\n' +
    'Text [[Vltava]], [[Vltava|alias]], [[Vltava#Nadpis]], [[Vltava#^blok]], ale [[Řekař]] a [[Jiná]].\n' +
    '\n' +
    '![[Vltava]]\n' +
    '\n' +
    '| A | B |\n' +
    '| --- | --- |\n' +
    '| x | [[Vltava\\|v tabulce]] |\n' +
    '\n' +
    'Kód `[[Řeka]]` zůstává.\n' +
    '\n' +
    '```\n' +
    '[[Řeka]]\n' +
    '```\n',
  )
})

test('fr_fmt_08_ac2_note_without_a_link_to_the_renamed_target_is_unchanged', () => {
  const text = 'Odkaz na [[Jiná]] a [[Řekař]].\n'
  const doc = parse(text)
  expect(doc.blocks.length).toBe(1)
  expect(renameLinkTarget(doc, 'Řeka', 'Vltava')).toBe(text)
})

test('fr_fmt_08_ac3_links_in_code_are_not_changed_by_rename', () => {
  const text = 'Kód `[[Řeka]]` a skutečný [[Řeka]].\n\n```\n[[Řeka]]\n```\n'
  expect(renameLinkTarget(parse(text), 'Řeka', 'Vltava')).toBe('Kód `[[Řeka]]` a skutečný [[Vltava]].\n\n```\n[[Řeka]]\n```\n')
})

// ---------------------------------------------------------------- FR-FMT-10

const NFD_CTENI = 'Čtení' // "Čtení" decomposed
const NFC_CTENI = 'Čtení'

test('fr_fmt_10_ac1_applying_a_tag_adds_it_to_the_tags_list_without_hash', () => {
  const text = '---\nid: 01JA0000000000000000000006\ntype: page\ntags:\n  - projekt\n---\nText.\n'
  const out = setAttribute(parse(text), 'tags', ['projekt', 'reading'])
  expect(out).toBe(text.replace('  - projekt\n', '  - projekt\n  - reading\n'))
  expect(out.includes('#reading')).toBe(false)
})

test('fr_fmt_10_ac2_inline_and_frontmatter_tag_are_the_same_tag', () => {
  const text = '---\ntags: [reading]\n---\nČtu knihu #reading večer.\n'
  const found = tags(parse(text))
  expect(found.map((t) => t.name)).toEqual(['reading', 'reading'])
  expect([...new Set(found.map((t) => t.key))]).toEqual(['reading'])
  expect(found[1]?.range).toEqual(range(text, '#reading'))
})

test('fr_fmt_10_ac3_tag_key_is_case_insensitive_and_nfc', () => {
  expect(tagKey('Čtení')).toBe('čtení')
  expect(tagKey('čtení')).toBe('čtení')
  expect(tagKey(NFD_CTENI)).toBe('čtení')
  expect(tagKey('ČTENÍ')).toBe(tagKey(NFC_CTENI))
})

test('fr_fmt_10_ac3_stored_spelling_is_preserved', () => {
  const text = 'Inline #Čtení a #čtení.\n'
  const found = tags(parse(text))
  expect(found.map((t) => [t.name, t.key])).toEqual([['Čtení', 'čtení'], ['čtení', 'čtení']])
  expect(serialize(parse(text))).toBe(text)
})

test('fr_fmt_10_ac4_digits_headings_urls_code_and_math_are_not_tags', () => {
  const text =
    '# Nadpis není štítek\n' +
    '\n' +
    'Ne: #1 a #123 a https://example.com/#kotva a `#kód` a $#x$, ano: #skutečný.\n' +
    '\n' +
    '```\n' +
    '#uvnitř\n' +
    '```\n'
  expect(tags(parse(text)).map((t) => t.name)).toEqual(['skutečný'])
  expect(extract(text, 'Štítky').tags).toEqual(['skutečný'])
})

// ---------------------------------------------------------------- FR-FMT-12 AC-2

test('fr_fmt_12_ac2_link_targets_written_by_rename_are_nfc', () => {
  const out = renameLinkTarget(parse('Viz [[Řeka]].\n'), 'Řeka', NFD_CTENI)
  expect(out).toBe(`Viz [[${NFC_CTENI}]].\n`)
})

test('fr_fmt_12_ac2_relation_link_written_by_set_attribute_is_nfc', () => {
  const out = setAttribute(parse(REL_BASE), 'zdroj-cteni', { link: NFD_CTENI })
  expect(out).toBe(REL_BASE.replace('type: task\n', `type: task\nzdroj-cteni: "[[${NFC_CTENI}]]"\n`))
})
