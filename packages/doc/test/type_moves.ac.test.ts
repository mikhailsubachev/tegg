// Slice 4E-1, L1: the `@tegg/doc` ops of a type move (docs/contracts/ms4-jobs.md §14.4): `map-properties` (D-804,
// D-813), `contentLine`, `keep-targets` (D-810) and `retarget-links` with an unchanged stem (path forms only).
// docs/acceptance/type-moves.md FR-STO-04 AC-6 (board A2 bytes, AP-768 value rules), AC-7 (incoming links: only path
// forms change), AC-8 (the moved note's own links keep their targets). Input is the synthetic fixture
// tests/fixtures/vaults/type-moves/ read byte-exact (CRLF, NFD title bytes). Written from the ACs and the contract only
// (D-61). The ops are the real engine (never mocked); until 4E-1 is built `transform` leaves the text unchanged and
// `contentLine` returns '' (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as doc from '../src/index.js'
import { resolveFrom, transform, type TextOp, type Transformed } from '../src/index.js'

const FX = resolve(import.meta.dirname, '../../../tests/fixtures/vaults/type-moves')
const read = (rel: string) => readFileSync(resolve(FX, rel), 'utf8')
const out = (t: Transformed) => (t.kind === 'bytes' ? t.text : null)

/** The fixture's note paths (what a planner puts in `paths`). */
const PATHS = [
  'Knihy/Duna.md', 'Knihy/Babička.md', 'Knihy/2025/Starý zápis.md', 'Knihy/Bez autora.md', 'Pages/Kniha jinde.md', 'Knihy/Sešit.md',
  'Pages/Článek.md', 'Quick Notes/Plán.md', 'Quick Notes/Plán cesty.md', 'Pages/Plán cesty.md', 'Quick Notes/Sešit.md',
  'Quick Notes/Odkaz na sešit.md', 'Pages/Odkazy.md', 'Schůzky/Porada.md', 'Schůzky/Retro.md', 'Pages/Schůzka jinde.md', 'Osoby/Jana.md',
  'Volné/Volná poznámka.md', 'Volné/Recept.md', 'Quick Notes/Nápad.md',
  ...Array.from({ length: 10 }, (_, i) => `Pages/Výplň ${String(i + 1).padStart(2, '0')}.md`),
]
const LABELS = { autor: 'Autor', vydáno: 'Vydáno', stav: 'Stav', hodnocení: 'Hodnocení', související: 'Související', poznámka: 'Poznámka', isbn: 'ISBN' }
type MapOp = Extract<TextOp, { op: 'map-properties' }>
const mapOp = (map: [string, string][]): MapOp => ({ op: 'map-properties', map: map.map(([from, to]) => ({ from, to })), labels: LABELS })
/** FR-STO-04 AC-6: Vydáno → Datum, the rest at R101's defaults (Kniha → Schůzka). */
const DUNA_MAP = mapOp([['autor', 'content'], ['vydáno', 'datum'], ['stav', 'stav'], ['hodnocení', 'content'], ['související', 'content'], ['poznámka', 'content'], ['isbn', 'content']])

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-6

test('fr_sto_04_ac6_map_properties_writes_the_board_a2_layout', () => {
  const duna = read('Knihy/Duna.md')
  const got = out(transform('Knihy/Duna.md', duna, [DUNA_MAP]))
  const body = duna.slice(duna.indexOf('\n---\n', 4) + 5)
  const want =
    '---\nid: 01JB4E0000000000000000E001\ntype: kniha\ntitle: Duna\ndatum: 1965-08-01\nstav: Dočtená\nnálada: dobrá\ntags: [čtení]\n' +
    'created: 2026-09-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n' +
    '**Autor:** Frank Herbert\n**Hodnocení:** 5\n**Související:** [[Babička]]\n**Poznámka:** Půjčená od Petra\n\n' + body
  assert.equal(got, want, 'vydáno renamed in place (value bytes kept); Content entries removed with # od koho; lines in old schema order, one blank line, the body unchanged; type and modified are not this op\'s')
})

test('fr_sto_04_ac6_map_properties_keeps_crlf_drops_quotes_and_adds_no_final_newline', () => {
  const b = read('Knihy/Babička.md')
  const got = out(transform('Knihy/Babička.md', b, [mapOp([['autor', 'content'], ['stav', 'content']])]))
  const want = b
    .replace("autor: 'Božena Němcová'\r\nstav: Rozečtená\r\n", '')
    .replace('---\r\nBabička a vnoučata.', '---\r\n**Autor:** Božena Němcová\r\n**Stav:** Rozečtená\r\n\r\nBabička a vnoučata.')
  assert.equal(got, want, 'the stored value without quotes (AP-768), CRLF on the new lines, no final newline added')
})

test('fr_sto_04_ac6_map_properties_leaves_keys_outside_the_map_and_writes_nothing_for_empty_values', () => {
  const t = read('Knihy/Bez autora.md')
  const got = out(transform('Knihy/Bez autora.md', t, [mapOp([['autor', 'content'], ['poznámka', 'místo']])])) ?? ''
  assert.ok(!got.includes('**Autor:**'), 'an empty value writes no Content line (R101 "Empty value")')
  assert.ok(got.includes('\nmísto:\n') && !got.includes('\npoznámka:'), 'a Property(k) target renames the key in place, empty value kept')
  const c = read('Pages/Článek.md')
  assert.equal(out(transform('Pages/Článek.md', c, [mapOp([['vydáno', 'datum']])])), null, 'a key the note lacks: unchanged')
})

test('fr_sto_04_ac6_content_line_uses_the_stored_value', () => {
  assert.equal(typeof doc.contentLine, 'function', '@tegg/doc exports contentLine (ms4-jobs §14.4)')
  const cases: [string, unknown, string][] = [
    ['Autor', 'Frank Herbert', '**Autor:** Frank Herbert'],
    ['Hodnocení', 5, '**Hodnocení:** 5'],
    ['Vydáno', '1965-08-01', '**Vydáno:** 1965-08-01'],
    ['Související', ['[[Babička]]'], '**Související:** [[Babička]]'],
    ['Žánry', ['sci-fi', 'klasika', 'Česká próza'], '**Žánry:** sci-fi, klasika, Česká próza'],
    ['Přečteno', true, '**Přečteno:** true'],
    ['Půjčeno', false, '**Půjčeno:** false'],
  ]
  const bad = cases.filter(([l, v, w]) => doc.contentLine(l, v) !== w).map(([l, v, w]) => `${l} ${JSON.stringify(v)}: ${JSON.stringify(doc.contentLine(l, v))} ≠ ${JSON.stringify(w)}`)
  assert.deepEqual(bad, [], 'dates as YYYY-MM-DD, lists joined with ", ", relations as their [[links]], booleans true/false (AP-768)')
})

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-7

test('fr_sto_04_ac7_retarget_links_with_the_same_stem_changes_only_path_forms', () => {
  const t = read('Pages/Odkazy.md')
  const op: TextOp = {
    op: 'retarget-links', fromPath: 'Quick Notes/Plán.md', fromStem: 'Plán', fromTitle: 'Plán', toPath: 'Knihy/Plán.md', toStem: 'Plán', toTitle: 'Plán', paths: PATHS,
  }
  const want = t
    .replace('viz: "[[Quick Notes/Plán]]"', 'viz: "[[Knihy/Plán]]"')
    .replace('\n[[Quick Notes/Plán]]\n', '\n[[Knihy/Plán]]\n')
    .replace('[text](../Quick%20Notes/Plán.md)', '[text](../Knihy/Plán.md)')
  const after = PATHS.map((p) => (p === 'Quick Notes/Plán.md' ? 'Knihy/Plán.md' : p))
  const got = out(transform('Pages/Odkazy.md', t, [op]))
  assert.equal(got, want, '[[Plán]], [[Plán#Cíl]], [[Plán|můj plán]], ![[Plán]] and the code span unchanged; the path forms and the relative link follow (D-810)')
  for (const target of ['Plán', 'Knihy/Plán']) assert.equal(resolveFrom('Pages/Odkazy.md', target, false, after), 'Knihy/Plán.md', `${target} resolves to the moved note`)
  assert.equal(resolveFrom('Pages/Odkazy.md', '../Knihy/Plán.md', true, after), 'Knihy/Plán.md', 'the relative Markdown link resolves to the moved note')
})

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-8

const KEEP: TextOp = { op: 'keep-targets', fromPath: 'Quick Notes/Plán.md', toPath: 'Knihy/Plán.md', paths: PATHS }

test('fr_sto_04_ac8_keep_targets_rewrites_only_links_that_would_retarget', () => {
  const t = read('Quick Notes/Plán.md')
  const want = t
    .replace('Viz [[Plán cesty]].', 'Viz [[Quick Notes/Plán cesty|Plán cesty]].')
    .replace('[Rozpis](<Plán cesty.md>)', '[Rozpis](<../Quick Notes/Plán cesty.md>)')
  const r = transform('Quick Notes/Plán.md', t, [KEEP])
  assert.equal(out(r), want, 'the shortest resolving path form with the written text as alias; the relative path from the new folder in the same <…> style; [[Duna]] unchanged')
  const edits = r.kind === 'bytes' ? r.edits.length : 0
  assert.equal(edits, 2, 'two edits: only the two links that would retarget')
})

test('fr_sto_04_ac8_every_link_resolves_to_the_same_file_before_and_after', () => {
  const t = read('Quick Notes/Plán.md')
  const after = PATHS.map((p) => (p === 'Quick Notes/Plán.md' ? 'Knihy/Plán.md' : p))
  const moved = out(transform('Quick Notes/Plán.md', t, [KEEP])) ?? t
  const before = [resolveFrom('Quick Notes/Plán.md', 'Plán cesty', false, PATHS), resolveFrom('Quick Notes/Plán.md', 'Plán cesty.md', true, PATHS), resolveFrom('Quick Notes/Plán.md', 'Duna', false, PATHS)]
  assert.deepEqual(before, ['Quick Notes/Plán cesty.md', 'Quick Notes/Plán cesty.md', 'Knihy/Duna.md'], 'setup: same folder first (D-291)')
  const wiki = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
  const md = /\]\(<([^>]+)>\)/g
  const nowWiki = [...moved.matchAll(wiki)].map((m) => resolveFrom('Knihy/Plán.md', m[1], false, after))
  const nowMd = [...moved.matchAll(md)].map((m) => resolveFrom('Knihy/Plán.md', m[1], true, after))
  assert.deepEqual([nowWiki[0], nowMd[0], nowWiki[1]], before, 'from Knihy/ every link of Plán still resolves to its old target')
})

test('fr_sto_04_ac8_keep_targets_never_gives_an_embed_an_alias', () => {
  const t = '---\nid: 01JB4E0000000000000000E090\ntype: quick-note\ntitle: Vložení\n---\n![[Plán cesty]]\n'
  const got = out(transform('Quick Notes/Vložení.md', t, [{ op: 'keep-targets', fromPath: 'Quick Notes/Vložení.md', toPath: 'Knihy/Vložení.md', paths: [...PATHS, 'Quick Notes/Vložení.md'] }]))
  assert.equal(got, t.replace('![[Plán cesty]]', '![[Quick Notes/Plán cesty]]'), 'an embed gets the path form, no alias (ms4-jobs §14.4)')
})
