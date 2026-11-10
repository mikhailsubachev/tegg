// Slice Q, L2 property at @tegg/doc: docs/acceptance/queries.md FR-FMT-07 AC-30, the property part. Random documents
// with random query fences (``` and ~~~, top level, in lists, quotes and callouts, an info string with or without meta,
// reference and inline bodies, Czech names in NFC and NFD, LF and CRLF, with and without a final newline) and other
// blocks: parse → serialize is the identity; `queryFences` (docs/contracts/v1-queries.md §3.1) finds exactly the
// generated fences with their bodies, names and nesting; the `transform` op `rename-saved-query` changes only the
// `saved:` lines of fences naming the renamed query (name key: NFC, case-insensitive), byte for byte as the generator
// writes them with the new name. Seeds as the package's other property tests (TS-L2): a fixed seed plus one random
// seed per run (`QA_SEED` when set), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases.
// The package has no fast-check dependency; this file uses an xorshift generator. Written from the AC and the
// contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const FIXED_SEED = 20261110
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`query fence property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
const NAMES = ['Projekty v běhu', 'Otevřené úkoly z této schůzky', 'Zrušené úkoly', 'Úkoly po termínu', 'Čtení']
const PARAS = ['Úvod k poradě.', 'Žluťoučký kůň úpěl ďábelské ódy.', 'Odkaz na [[Výjezd Lisabon 2026]].', '#finance a #q4', '']
type Gen = { text: (name: (n: string) => string) => string; fences: { saved: string | null; nested: boolean; body: string }[] }

function gen(seed: number): { make: (to: string | null, from: string) => string; fences: { saved: string | null; nested: boolean; body: string }[]; nl: string } {
  const r = rng(seed)
  const nl = r.bool() ? '\r\n' : '\n'
  const parts: ((rename: (n: string) => string) => string[])[] = []
  const fences: { saved: string | null; nested: boolean; body: string }[] = []
  const n = 1 + r.int(6)
  for (let i = 0; i < n; i++) {
    const kind = r.int(6)
    if (kind === 0) { const p = r.pick(PARAS.filter(Boolean)); parts.push(() => [p]); continue }
    const marker = r.bool() ? '```' : '~~~'
    const info = r.bool() ? 'query' : 'query úzký'
    const nameRaw = r.pick(NAMES)
    const spelled = r.int(3) === 0 ? nameRaw.normalize('NFD') : r.int(3) === 0 ? nameRaw.toUpperCase() : nameRaw
    const inline = r.int(4) === 0
    const extra = r.bool() ? ['# moje poznámka', 'x-pohled: úzký'] : []
    const where = r.int(4) // 0 top, 1 list, 2 quote, 3 callout
    const body = (rename: (n: string) => string) => (inline ? ['title: Ruční', 'types: [kniha]', ...extra] : [`saved: ${rename(spelled)}`, ...extra])
    fences.push({ saved: inline ? null : spelled.normalize('NFC'), nested: where !== 0, body: body((s) => s).map((l) => l.normalize('NFC')).join('\n') })
    parts.push((rename) => {
      const lines = [`${marker}${info}`, ...body(rename), marker]
      if (where === 0) return lines
      if (where === 1) return ['- položka', '', ...lines.map((l) => `  ${l}`)]
      if (where === 2) return lines.map((l) => `> ${l}`)
      return ['> [!note] Poznámka', ...lines.map((l) => `> ${l}`)]
    })
  }
  const final = r.bool()
  const fm = r.bool() ? ['---', 'title: Náhodná', '---'] : []
  const make = (to: string | null, from: string) => {
    const rename = (s: string) => (to !== null && s.normalize('NFC').toLowerCase() === from.toLowerCase() ? to : s)
    const blocks = parts.map((p) => p(rename).join(nl))
    return (fm.length ? fm.join(nl) + nl : '') + blocks.join(nl + nl) + (final ? nl : '')
  }
  return { make, fences, nl }
}

test('fr_fmt_07_ac30_notes_with_query_blocks_round_trip', () => {
  const D = doc as unknown as Record<string, any>
  assert.equal(typeof D.queryFences, 'function', '@tegg/doc exports queryFences (contract §3.1)')
  for (const seed of SEEDS) {
    const r = rng(seed)
    for (let i = 0; i < RUNS; i++) {
      const s = r.int(2 ** 31)
      const g = gen(s)
      const text = g.make(null, '')
      const what = `seed ${seed}, case ${i} (${s})`
      assert.equal(doc.serialize(doc.parse(text)), text, `${what}: parse → serialize is the identity`)
      const got = (D.queryFences(text) as { body: string; saved: string | null; nested: boolean }[]).map((f) => ({ saved: f.saved, nested: f.nested, body: f.body.replace(/\r\n/g, '\n').normalize('NFC') }))
      assert.deepEqual(got, g.fences, `${what}: queryFences finds exactly the generated fences`)
      const from = NAMES[s % NAMES.length]
      const out = D.transform('Pages/Náhodná.md', text, [{ op: 'rename-saved-query', from, to: 'Nový název' }])
      const want = g.make('Nový název', from)
      if (want === text) assert.equal(out.kind, 'unchanged', `${what}: no usage of ${from}, nothing changes`)
      else assert.equal(out.kind === 'bytes' ? out.text : null, want, `${what}: only the \`saved:\` lines naming ${from} change`)
    }
  }
}, 600_000)
