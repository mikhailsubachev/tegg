// Slice Q2, L1: the bytes of every card move on a board, through the real @tegg/doc (docs/contracts/v1-views.md §1.9
// `applyBoardMove`; D-82 one text engine, D-230 minimal edits, D-478 tag moves, D-1769, D-1812 "the card-move bytes are
// L1"). FR-QRY-05 AC-13 (a Select drag), AC-14 (multi-select flow and block lists, Alt, from `No Genres`, a relation, a
// tag with an inline copy), AC-16 (a drop on the excluded lane), FR-FMT-12 AC-12 (the card-move part: NFD values).
// Inputs: tests/fixtures/vaults/views/Books; expected bytes: tests/fixtures/queries-files/expected/views/books/.
// A write is `applyBoardMove` followed by `touchModified(before, after, now)`, as the §1.9 write path composes them.
// Written from docs/acceptance/views.md and the contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const BOOK = (title: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/views/Books', `${title}.md`), 'utf8')
const EXPECTED = (name: string) => readFileSync(resolve(REPO, 'tests/fixtures/queries-files/expected/views/books', name), 'utf8')
const NOW = '2026-11-19T10:00:00+01:00'

type Mod = Record<string, any>
type Move = { key: string; shape: 'scalar' | 'list'; remove: string[]; add: string | null }
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  assert.equal(typeof m.applyBoardMove, 'function', '@tegg/doc exports applyBoardMove (v1-views §1.9)')
  assert.equal(typeof m.touchModified, 'function', '@tegg/doc exports touchModified')
  return m
}
/** One card move as the write path does it; asserts a result. */
async function move(text: string, mv: Move): Promise<{ text: string; inlineKept: boolean }> {
  const m = await doc()
  const r = m.applyBoardMove(text, mv)
  assert.ok(r && typeof r.text === 'string', `applyBoardMove answers a change for ${JSON.stringify(mv)}`)
  return { text: m.touchModified(text, r.text, NOW), inlineKept: r.inlineKept }
}
/** The lines that differ between two texts of the same line count (index: [before, after]). */
function changedLines(a: string, b: string): Record<number, [string, string]> {
  const x = a.split('\n'), y = b.split('\n')
  const out: Record<number, [string, string]> = {}
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out[i + 1] = [x[i], y[i]]
  return out
}

test('fr_qry_05_ac13_card_drag_writes_once', async () => {
  const before = BOOK('Kniha o horách')
  const { text } = await move(before, { key: 'status', shape: 'scalar', remove: ['To read'], add: 'Reading' })
  assert.equal(text, EXPECTED('kniha-o-horach-reading.md'), 'Kniha o horách: To read → Reading, bytes as expected/views/books/kniha-o-horach-reading.md')
  assert.deepEqual(changedLines(before, text), {
    6: ['status: To read', 'status: Reading'],
    9: ['modified: 2026-11-03T18:00:00+01:00', 'modified: 2026-11-19T10:00:00+01:00'],
  }, 'exactly line 6 and line 9 change')
  const m = await doc()
  assert.equal(m.applyBoardMove(before, { key: 'status', shape: 'scalar', remove: ['To read'], add: 'To read' }), null, 'a move onto the value it has writes nothing (null)')
})

test('fr_qry_05_ac14_multi_value_and_relation_drags', async () => {
  const m = await doc()
  // (a) Sto zimních dní from Eseje to Poezie: the flow list is kept.
  const sto = BOOK('Sto zimních dní')
  assert.equal((await move(sto, { key: 'genres', shape: 'list', remove: ['Eseje'], add: 'Poezie' })).text, EXPECTED('sto-zimnich-dni-poezie.md'), '(a) genres: [Román, Eseje] → [Román, Poezie]')
  // (b) Sto zimních dní from Román to Eseje (already there): only the removal.
  assert.equal((await move(sto, { key: 'genres', shape: 'list', remove: ['Román'], add: 'Eseje' })).text, EXPECTED('sto-zimnich-dni-eseje-only.md'), '(b) genres: [Eseje]')
  // (c) Čarovná mapa (block list) from Cestopis to Eseje: the block style is kept.
  assert.equal((await move(BOOK('Čarovná mapa'), { key: 'genres', shape: 'list', remove: ['Cestopis'], add: 'Eseje' })).text, EXPECTED('carovna-mapa-eseje.md'), '(c) the lines `  - Román`, `  - Eseje`')
  // (d) Alt-drag of Mapa bez severu from Román to Poezie adds only; onto a lane it already has: nothing.
  const mapa = BOOK('Mapa bez severu')
  assert.equal((await move(mapa, { key: 'genres', shape: 'list', remove: [], add: 'Poezie' })).text, EXPECTED('mapa-bez-severu-alt-poezie.md'), '(d) Alt: genres: [Román, Poezie]')
  assert.equal(m.applyBoardMove(mapa, { key: 'genres', shape: 'list', remove: [], add: 'Román' }), null, '(d) Alt onto a value it has: nothing to write')
  // (e) Ostrov bez jména from `No Genres` to Poezie: a new flow line after the last frontmatter entry (D-230).
  assert.equal((await move(BOOK('Ostrov bez jména'), { key: 'genres', shape: 'list', remove: [], add: 'Poezie' })).text, EXPECTED('ostrov-bez-jmena-poezie.md'), '(e) genres: [Poezie] appended')
  // Relation: Dům u řeky from Lucie Horká to Marek Sova (the D-184 link text, quoted by formatScalar).
  assert.equal((await move(BOOK('Dům u řeky'), { key: 'author', shape: 'scalar', remove: ['[[Lucie Horká]]'], add: '[[Marek Sova]]' })).text, EXPECTED('dum-u-reky-marek-sova.md'), 'author: "[[Marek Sova]]"')
  // Tags: Světla přístavu from `večerní` (inline only: raw is empty) to `doporučené`.
  const svetla = BOOK('Světla přístavu')
  const t = await move(svetla, { key: 'tags', shape: 'list', remove: [], add: 'doporučené' })
  assert.equal(t.text, EXPECTED('svetla-pristavu-doporucene.md'), 'tags: [doporučené] appended')
  assert.ok(t.text.endsWith('Čtu po jednom textu večer. #večerní\n'), 'the body (#večerní) is byte-identical')
  // The inline tag stays when a drag would remove it (FR-TSK-05 AC-6): `inlineKept`.
  const both = svetla.replace('genres: [Eseje]\n', 'genres: [Eseje]\ntags: [večerní]\n')
  const r = await move(both, { key: 'tags', shape: 'list', remove: ['večerní'], add: 'doporučené' })
  assert.equal(r.inlineKept, true, 'removing `večerní` while `#večerní` is in the body: inlineKept')
  assert.ok(r.text.includes('tags: [doporučené]\n') && r.text.endsWith('#večerní\n'), 'the frontmatter value moves, the body keeps #večerní')
})

test('fr_qry_05_ac14_multi_value_and_relation_drags_keep_other_bytes', async () => {
  // Every line outside the moved key and `modified:` is byte-identical, for each fixture book and each genre move.
  const titles = ['Mapa bez severu', 'Sto zimních dní', 'Cizí přístavy', 'Čarovná mapa', 'Kniha o čaji', 'Noční vlak', 'Účetní ze Žižkova', 'Dům u řeky']
  for (const title of titles) {
    const before = BOOK(title)
    const r = await move(before, { key: 'genres', shape: 'list', remove: [], add: 'Poezie' })
    const keep = (s: string) => s.split('\n').filter((l) => !l.startsWith('genres:') && !l.startsWith('  - ') && !l.startsWith('modified:')).join('\n')
    assert.equal(keep(r.text), keep(before), `${title}: nothing but genres and modified changes`)
  }
})

test('fr_qry_05_ac16_drop_on_an_excluded_lane', async () => {
  const before = BOOK('Noční vlak')
  const { text } = await move(before, { key: 'status', shape: 'scalar', remove: ['Reading'], add: 'Read' })
  assert.equal(text, EXPECTED('nocni-vlak-read.md'), 'Noční vlak: status: Read and modified:, bytes as expected/views/books/nocni-vlak-read.md')
  assert.deepEqual(Object.keys(changedLines(before, text)).map(Number), [6, 10], 'only the status and modified lines')
})

test('fr_fmt_12_ac12_view_names_and_lanes_are_nfc', async () => {
  // An NFD value in the moved card's file is replaced by the NFC target; other NFD bytes are kept.
  const nfd = (s: string) => s.normalize('NFD')
  const before = BOOK('Sto zimních dní').replace('genres: [Román, Eseje]', `genres: [${nfd('Román')}, Eseje]`).replace('Krátké kapitoly', nfd('Krátké kapitoly'))
  const r = await move(before, { key: 'genres', shape: 'list', remove: ['Eseje'], add: 'Poezie' })
  assert.ok(r.text.includes(`genres: [${nfd('Román')}, Poezie]\n`), 'the kept NFD entry keeps its bytes, the added value is NFC')
  assert.ok(r.text.includes(nfd('Krátké kapitoly')), 'the NFD body is untouched')
  const removed = await move(before, { key: 'genres', shape: 'list', remove: ['Román'], add: 'Eseje' })
  assert.ok(removed.text.includes('genres: [Eseje]\n'), 'an NFD entry matches its NFC `raw` value and is removed')
  // An NFD scalar value is replaced by the NFC target (as FR-TSK-05 AC-4).
  const s = BOOK('Kniha o horách').replace('status: To read', `status: ${nfd('Čtu')}`)
  const sr = await move(s, { key: 'status', shape: 'scalar', remove: ['Čtu'], add: 'Reading' })
  assert.ok(sr.text.includes('status: Reading\n') && !sr.text.includes(nfd('Čtu')), 'the NFD Select value is replaced by the NFC label')
  const added = await move(BOOK('Ostrov bez jména'), { key: 'genres', shape: 'list', remove: [], add: nfd('Román') })
  assert.ok(added.text.includes('genres: [Román]\n'), 'an added value is written NFC even when given NFD')
})
