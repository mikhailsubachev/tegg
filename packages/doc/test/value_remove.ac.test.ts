// Slice 4E-2, L1: the `@tegg/doc` op `remove-key` of a property delete (docs/contracts/ms4-jobs.md §14.4, §14.9.2,
// D-814). docs/acceptance/type-moves.md FR-TYP-04 AC-7 ("removes Duna's `poznámka` line (its value lines too; the
// `# od koho` comment above it stays, AP-769)"; L1 for the bytes). The op removes the frontmatter entry `key` with its
// value lines (block list items, block scalars, continuation lines); full-line comments above it stay; NFD keys match
// by NFC; `modified` is not touched; everything else is byte-identical (CRLF, no final newline, quoting); `unchanged`
// when the key isn't there. Input is the synthetic fixture tests/fixtures/vaults/type-moves/ read byte-exact, plus
// small Czech texts built here (D-50). Written from the ACs and the contract only (D-61). The op is the real engine
// (never mocked); until 4E-2 is built `transform` leaves the text unchanged (TS-I1), so every case fails its assertion.
//
// An empty entry (`poznámka:` on Bez autora) is the planner's case: it never plans such a file (D-814, checked at L4 in
// crates/tegg-jobs/tests/ac_value_remove.rs); what the op itself does with an empty entry is red-test point AP-791.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transform, type TextOp, type Transformed } from '../src/index.js'

const FX = resolve(import.meta.dirname, '../../../tests/fixtures/vaults/type-moves')
const read = (rel: string) => readFileSync(resolve(FX, rel), 'utf8')
const out = (t: Transformed) => (t.kind === 'bytes' ? t.text : null)
const removeKey = (key: string): TextOp => ({ op: 'remove-key', key })
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
/** `text` with `part` (which must be in it once) removed. */
function without(text: string, part: string): string {
  const i = text.indexOf(part)
  if (i < 0 || text.indexOf(part, i + 1) >= 0) throw new Error(`setup: ${JSON.stringify(part)} must occur once`)
  return text.slice(0, i) + text.slice(i + part.length)
}
const note = (fm: string, body = 'Tělo poznámky.\n') =>
  `---\nid: 01JB4E0000000000000000E0R1\ntype: kniha\ntitle: Zkušební\n${fm}created: 2026-09-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}`

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-7

test('fr_typ_04_ac7_remove_key_removes_dunas_line_and_keeps_the_comment_above', () => {
  const duna = read('Knihy/Duna.md')
  const r = transform('Knihy/Duna.md', duna, [removeKey('poznámka')])
  const want = without(duna, 'poznámka: Půjčená od Petra\n')
  assert.equal(out(r), want, 'only the poznámka line goes; `# od koho` stays, `nálada` and `modified` unchanged')
  assert.ok(out(r)?.includes('# od koho\nnálada: dobrá\n'), 'the comment now stands above nálada')
})

test('fr_typ_04_ac7_remove_key_reports_the_removed_range_as_its_edit', () => {
  const duna = read('Knihy/Duna.md')
  const r = transform('Knihy/Duna.md', duna, [removeKey('poznámka')])
  assert.equal(r.kind, 'bytes', 'the text changes')
  const start = bytes(duna.slice(0, duna.indexOf('poznámka: Půjčená')))
  const end = start + bytes('poznámka: Půjčená od Petra\n')
  assert.deepEqual(r.kind === 'bytes' ? r.edits : null, [{ start, end }], 'one edit: the UTF-8 byte range of the removed line')
})

test('fr_typ_04_ac7_remove_key_removes_block_list_items', () => {
  const t = note('autor: Jan Neruda\npoznámka:\n  - první řádek\n  - druhý řádek\nnálada: dobrá\n')
  assert.equal(out(transform('Knihy/Zkušební.md', t, [removeKey('poznámka')])), without(t, 'poznámka:\n  - první řádek\n  - druhý řádek\n'), 'the key line and its two items; nothing else')
})

test('fr_typ_04_ac7_remove_key_removes_block_scalars_and_continuation_lines', () => {
  const literal = note('poznámka: |\n  řádek jedna\n  řádek dva\nstav: Dočtená\n')
  assert.equal(out(transform('Knihy/Zkušební.md', literal, [removeKey('poznámka')])), without(literal, 'poznámka: |\n  řádek jedna\n  řádek dva\n'), 'a literal block scalar')
  const folded = note('stav: Dočtená\npoznámka: >-\n  složený\n  text\n')
  assert.equal(out(transform('Knihy/Zkušební.md', folded, [removeKey('poznámka')])), without(folded, 'poznámka: >-\n  složený\n  text\n'), 'a folded block scalar, the last attribute')
  const plain = note('poznámka: dlouhá věta\n  pokračuje na dalším řádku\nstav: Dočtená\n')
  assert.equal(out(transform('Knihy/Zkušební.md', plain, [removeKey('poznámka')])), without(plain, 'poznámka: dlouhá věta\n  pokračuje na dalším řádku\n'), 'a plain scalar with a continuation line')
  const flow = note('poznámka: [jedna, "dvě"]\nstav: Dočtená\n')
  assert.equal(out(transform('Knihy/Zkušební.md', flow, [removeKey('poznámka')])), without(flow, 'poznámka: [jedna, "dvě"]\n'), 'a flow list')
})

test('fr_typ_04_ac7_remove_key_keeps_every_full_line_comment_above', () => {
  const t = note('autor: Božena Němcová\n# první komentář\n# druhý komentář\npoznámka: \'v uvozovkách\'\n# komentář pod\nstav: Rozečtená\n')
  assert.equal(out(transform('Knihy/Zkušební.md', t, [removeKey('poznámka')])), without(t, 'poznámka: \'v uvozovkách\'\n'), 'both comments above and the one below stay')
})

test('fr_typ_04_ac7_remove_key_keeps_crlf_and_the_missing_final_newline', () => {
  const babicka = read('Knihy/Babička.md')
  assert.ok(babicka.includes('stav: Rozečtená\r\n') && !babicka.endsWith('\n'), 'setup: Babička is CRLF without a final newline')
  const t = babicka.replace('stav: Rozečtená\r\n', 'stav: Rozečtená\r\npoznámka: Z knihovny\r\n')
  assert.equal(out(transform('Knihy/Babička.md', t, [removeKey('poznámka')])), babicka, 'the CRLF line and its CRLF go; every other byte is Babička\'s')
})

test('fr_typ_04_ac7_remove_key_matches_an_nfd_key_by_nfc', () => {
  const nfdKey = 'poznámka'.normalize('NFD')
  assert.notEqual(nfdKey, 'poznámka', 'setup: the key is decomposed')
  const t = note(`autor: Karel Čapek\n${nfdKey}: Napsáno rozloženě\nstav: Dočtená\n`)
  assert.equal(out(transform('Knihy/Zkušební.md', t, [removeKey('poznámka')])), without(t, `${nfdKey}: Napsáno rozloženě\n`), 'the NFD-written key is the same key (FR-FMT-12)')
})

test('fr_typ_04_ac7_remove_key_leaves_similar_keys_and_the_body_alone', () => {
  const t = note('poznámka: pryč\npoznámka2: zůstane\npoznámky: zůstane taky\n', 'poznámka: tohle je text v těle\n')
  assert.equal(out(transform('Knihy/Zkušební.md', t, [removeKey('poznámka')])), without(t, 'poznámka: pryč\n'), 'only the exact key, only in the frontmatter')
})

test('fr_typ_04_ac7_remove_key_is_unchanged_when_the_key_is_absent', () => {
  const babicka = read('Knihy/Babička.md')
  assert.deepEqual(transform('Knihy/Babička.md', babicka, [removeKey('poznámka')]), { kind: 'unchanged' }, 'Babička has no poznámka: unchanged')
  // The control: the same op on Duna does change it (an op that never changes anything fails this file).
  assert.equal(transform('Knihy/Duna.md', read('Knihy/Duna.md'), [removeKey('poznámka')]).kind, 'bytes', 'Duna has one: bytes')
})
