// Slice MM2, L1: callout metadata and the layout in @tegg/doc (docs/acceptance/mindmap.md part two, R98; contract
// docs/contracts/mm-mindmap.md §6.1). FR-FMT-05 AC-7 (`calloutHead(...).meta` and `type` for Pavouk, Neznámé metadata,
// Metadata (1) and (2) and Výjezd; `mindmapTree(...).layout` / `.meta`; `[!mindmap|spider]` with a body that is not one
// list is a hint callout), FR-MMP-02 AC-29's byte transform `setMindmapLayout` (W12, W12a, W12b, W12c, W12d, W13: the
// title line only, type spelling and fold marker kept, identity when nothing changes, a non-callout block unchanged),
// FR-FMT-07 AC-25 (the three MM2 notes parse → serialize byte-identical, as is, CRLF without a final newline, NFD).
// Fixture: tests/fixtures/vaults/mindmap (read only). Written from the ACs and the contract only (D-61); the stubs
// return `meta: null`, `layout: 'right'` and unchanged bytes, so every test fails on an assertion (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calloutHead, mindmapTree, parse, serialize, setMindmapLayout } from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const FX = 'tests/fixtures/vaults/mindmap'
const fx = (rel: string) => readFileSync(resolve(REPO, FX, rel), 'utf8')
const kinds = (text: string) => parse(text).blocks.map((b) => b.kind)
const blocks = (text: string) => parse(text).blocks.map((b) => b.raw)
const crlf = (s: string) => s.replace(/\n/g, '\r\n')

const PAVOUK = () => blocks(fx('Pages/Pavouk.md'))[0]
const NEZNAMA = () => blocks(fx('Pages/Neznámé metadata.md'))[0]
const METADATA = () => blocks(fx('Pages/Metadata.md'))
const VYJEZD = () => blocks(fx('Pages/Výjezd 2026.md'))[1]
const SLOZENE = () => blocks(fx('Pages/Složené.md'))
const PAVOUK_LIST = '> - Střed\n>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama\n>   - Delta'
const VYJEZD_LIST = '> - Výjezd 2026\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava'

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-7

test('fr_fmt_05_ac7_fixture_bytes_and_kinds_of_the_mm2_notes', () => {
  assert.equal(PAVOUK(), `> [!mindmap|spider] Pavouk\n${PAVOUK_LIST}`, 'fixture: Pavouk')
  assert.equal(NEZNAMA(), '> [!mindmap|foo] Cizí\n> - Kořen\n>   - Větev', 'fixture: Neznámé metadata')
  assert.deepEqual(METADATA(), ['> [!note|wide] Poznámka\n> Odstavec v calloutu.', '> [!Mindmap|SPIDER]+ Velká písmena\n> - Jedna\n> - Dvě\n> - Tři'], 'fixture: Metadata')
  assert.deepEqual(kinds(fx('Pages/Pavouk.md')), ['mindmap'], 'Pavouk is a mindmap (the type is matched before `|`, D-791)')
  assert.deepEqual(kinds(fx('Pages/Neznámé metadata.md')), ['mindmap'], 'unknown metadata changes no kind')
  assert.deepEqual(kinds(fx('Pages/Metadata.md')), ['callout', 'mindmap'], 'Metadata: an ordinary callout and a mindmap')
})

test('fr_fmt_05_ac7_callout_head_reads_the_metadata_and_the_type_before_the_bar', () => {
  assert.deepEqual(calloutHead(PAVOUK()), { type: 'mindmap', fold: '', title: 'Pavouk', meta: 'spider' }, 'Pavouk')
  assert.deepEqual(calloutHead(NEZNAMA()), { type: 'mindmap', fold: '', title: 'Cizí', meta: 'foo' }, 'Neznámé metadata')
  assert.deepEqual(calloutHead(METADATA()[0]), { type: 'note', fold: '', title: 'Poznámka', meta: 'wide' }, 'Metadata (1): every callout keeps its metadata')
  assert.deepEqual(calloutHead(METADATA()[1]), { type: 'Mindmap', fold: '+', title: 'Velká písmena', meta: 'SPIDER' }, 'Metadata (2): spelling, fold and metadata as written')
  assert.deepEqual(calloutHead(VYJEZD()), { type: 'mindmap', fold: '', title: 'Výjezd 2026', meta: null }, 'Výjezd: no `|` → null')
  assert.deepEqual(calloutHead('> [!mindmap|] Prázdné\n> - a'), { type: 'mindmap', fold: '', title: 'Prázdné', meta: '' }, 'an empty `|` → the empty string')
  assert.deepEqual(calloutHead('> [!mindmap|spider]-\n> - a'), { type: 'mindmap', fold: '-', title: '', meta: 'spider' }, 'metadata, fold, no title')
  assert.deepEqual(calloutHead(crlf(PAVOUK())), { type: 'mindmap', fold: '', title: 'Pavouk', meta: 'spider' }, 'CRLF')
  assert.equal(calloutHead('Odstavec.'), null, 'not a callout')
})

test('fr_fmt_05_ac7_tree_layout_and_meta', () => {
  const t = (raw: string, title: string) => {
    const x = mindmapTree(raw, title)
    assert.ok(x, `mindmapTree of ${JSON.stringify(raw.split('\n')[0])}`)
    return x!
  }
  assert.deepEqual([t(PAVOUK(), 'Pavouk').layout, t(PAVOUK(), 'Pavouk').meta], ['spider', 'spider'], 'Pavouk')
  assert.deepEqual([t(NEZNAMA(), 'Neznámé metadata').layout, t(NEZNAMA(), 'Neznámé metadata').meta], ['right', 'foo'], 'unknown metadata means right, kept as written')
  const m2 = t(METADATA()[1], 'Metadata')
  assert.deepEqual([m2.layout, m2.meta, m2.typeSpelling, m2.fold, m2.title], ['spider', 'SPIDER', 'Mindmap', '+', 'Velká písmena'], 'Metadata (2): metadata case-insensitive, the rest as R90')
  assert.deepEqual(m2.root, { kind: 'synthesized', text: 'Velká písmena' }, 'Metadata (2): synthesized root')
  assert.deepEqual([t(VYJEZD(), 'Výjezd 2026').layout, t(VYJEZD(), 'Výjezd 2026').meta], ['right', null], 'Výjezd')
  assert.deepEqual([t('> [!mindmap|Spider] T\n> - a', 'X').layout, t('> [!mindmap|] T\n> - a', 'X').layout, t('> [!mindmap|right] T\n> - a', 'X').layout], ['spider', 'right', 'right'], 'only `spider` (any case) is spider')
  assert.equal(t('> [!mindmap|] T\n> - a', 'X').meta, '', 'an empty token is kept as the empty string')
  assert.equal(mindmapTree(METADATA()[0], 'Metadata'), null, 'Metadata (1) is not a mindmap')
})

test('fr_fmt_05_ac7_spider_metadata_with_a_body_that_is_not_one_list_is_a_hint', () => {
  assert.deepEqual(kinds('> [!mindmap|spider] T\n> Odstavec.\n'), ['callout'], 'a paragraph body: a hint callout (R90)')
  assert.deepEqual(kinds('> [!mindmap|spider] T\n> - a\n>\n> * b\n'), ['callout'], 'two lists: a hint callout')
  assert.equal(mindmapTree('> [!mindmap|spider] T\n> Odstavec.', 'X'), null, 'no tree for a hint')
  assert.deepEqual(calloutHead('> [!mindmap|spider] T\n> Odstavec.'), { type: 'mindmap', fold: '', title: 'T', meta: 'spider' }, 'the head still reads the metadata')
  assert.deepEqual(kinds('> [!mindmap|spider] T\n'), ['mindmap'], 'title line only: the empty state (D-765)')
})

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-29 (the bytes of W12…W13)

test('fr_mmp_02_ac29_set_mindmap_layout_rewrites_the_title_line_only_w12_to_w12d', () => {
  assert.equal(setMindmapLayout(VYJEZD(), 'spider'), `> [!mindmap|spider] Výjezd 2026\n${VYJEZD_LIST}`, 'W12')
  assert.equal(setMindmapLayout(PAVOUK(), 'right'), `> [!mindmap] Pavouk\n${PAVOUK_LIST}`, 'W12a (no trailing space)')
  assert.equal(setMindmapLayout(NEZNAMA(), 'spider'), '> [!mindmap|spider] Cizí\n> - Kořen\n>   - Větev', 'W12b: unknown metadata replaced')
  assert.equal(SLOZENE()[0], '> [!mindmap]- Složená mapa\n> - Kořen\n>   - Větev', 'fixture: Složené (1)')
  assert.equal(setMindmapLayout(SLOZENE()[0], 'spider'), '> [!mindmap|spider]- Složená mapa\n> - Kořen\n>   - Větev', 'W12c: the fold marker kept')
  assert.equal(setMindmapLayout(METADATA()[1], 'right'), '> [!Mindmap]+ Velká písmena\n> - Jedna\n> - Dvě\n> - Tři', 'W12d: type spelling and fold marker kept')
  assert.equal(setMindmapLayout(SLOZENE()[1], 'spider'), '> [!MINDMAP|spider]+ Rozbalená mapa\n> - Kořen\n>   - Větev', 'upper-case type kept')
  assert.equal(setMindmapLayout('> [!mindmap]', 'spider'), '> [!mindmap|spider]', 'the empty state: the title line alone')
  assert.equal(setMindmapLayout('> [!mindmap]-', 'spider'), '> [!mindmap|spider]-', 'no title, a fold marker')
  assert.equal(setMindmapLayout('> [!mindmap|spider]', 'right'), '> [!mindmap]', 'back to right: no trailing bytes')
})

test('fr_mmp_02_ac29_set_mindmap_layout_is_the_identity_when_nothing_changes_w13', () => {
  const v = VYJEZD()
  assert.equal(setMindmapLayout(setMindmapLayout(v, 'spider'), 'right'), v, 'W13: spider then right is byte-identical to the original')
  assert.equal(setMindmapLayout(v, 'right'), v, 'right on a right map: unchanged')
  assert.equal(setMindmapLayout(PAVOUK(), 'spider'), PAVOUK(), 'spider on a spider map: unchanged')
  assert.equal(setMindmapLayout(setMindmapLayout(PAVOUK(), 'right'), 'spider'), PAVOUK(), 'right then spider on Pavouk returns its bytes')
  for (const raw of ['Odstavec.', '- a\n- b', '```\nx\n```', '> Citace bez typu']) assert.equal(setMindmapLayout(raw, 'spider'), raw, `not a callout: unchanged (${JSON.stringify(raw)})`)
})

test('fr_mmp_02_ac29_set_mindmap_layout_touches_no_other_byte', () => {
  const cases: [string, string, 'right' | 'spider'][] = [
    ['Výjezd', VYJEZD(), 'spider'], ['Pavouk', PAVOUK(), 'right'], ['Neznámé metadata', NEZNAMA(), 'spider'], ['Metadata (2)', METADATA()[1], 'right'],
    ['Uzly', blocks(fx('Pages/Uzly.md'))[0], 'spider'], ['Z Obsidianu (tabs)', blocks(fx('Pages/Z Obsidianu.md'))[0], 'spider'],
    ['a hint callout (Rozpoznání 1)', blocks(fx('Pages/Rozpoznání.md'))[0], 'spider'],
  ]
  const bad: string[] = []
  for (const [what, raw, to] of cases) {
    const out = setMindmapLayout(raw, to)
    const a = raw.split('\n')
    const b = out.split('\n')
    if (a.length !== b.length || a.slice(1).join('\n') !== b.slice(1).join('\n')) bad.push(`${what}: a line other than the first changed`)
    const head = calloutHead(out)
    if (!head) { bad.push(`${what}: the result is no callout`); continue }
    const before = calloutHead(raw)!
    if (head.type !== before.type || head.fold !== before.fold || head.title !== before.title) bad.push(`${what}: type, fold or title changed: ${JSON.stringify(head)}`)
    if (head.meta !== (to === 'spider' ? 'spider' : null)) bad.push(`${what}: meta ${JSON.stringify(head.meta)} after ${to}`)
  }
  assert.deepEqual(bad, [], 'only the title line changes; type, fold and title stay')
  const c = setMindmapLayout(crlf(VYJEZD()), 'spider')
  assert.equal(c, crlf(`> [!mindmap|spider] Výjezd 2026\n${VYJEZD_LIST}`), 'CRLF is kept')
  const hint = setMindmapLayout(blocks(fx('Pages/Rozpoznání.md'))[0], 'spider')
  assert.ok(hint.startsWith('> [!mindmap|spider] Odstavec\n'), `a hint callout takes the metadata too: ${JSON.stringify(hint.split('\n')[0])}`)
})

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-25

test('fr_fmt_07_ac25_the_mm2_notes_round_trip_byte_identical', () => {
  const bad: string[] = []
  for (const rel of ['Pages/Pavouk.md', 'Pages/Neznámé metadata.md', 'Pages/Metadata.md']) {
    const text = fx(rel)
    const variants: [string, string][] = [
      ['as is', text],
      ['CRLF, no final newline', crlf(text).replace(/\r\n$/, '')],
      ['NFD', text.normalize('NFD')],
    ]
    for (const [what, t] of variants) if (serialize(parse(t)) !== t) bad.push(`${rel} (${what})`)
  }
  assert.deepEqual(bad, [], 'parse + serialize without edits is the identity (metadata never rewrites)')
  const m = parse(fx('Pages/Metadata.md'))
  assert.equal(m.blocks[0].raw, '> [!note|wide] Poznámka\n> Odstavec v calloutu.', 'Metadata (1): `[!note|wide]` kept in raw')
  const w14 = serialize(parse(fx('Pages/Metadata.md').replace('> Odstavec v calloutu.\n', '> Odstavec v calloutu. navíc\n')))
  assert.ok(w14.includes('> [!note|wide] Poznámka\n> Odstavec v calloutu. navíc\n'), 'W14 keeps `[!note|wide]` as written')
})
