// Slice Q2, L2 property at @tegg/doc: docs/acceptance/views.md FR-QRY-05 AC-14 (the change model of a card move, D-1769)
// and FR-FMT-12 AC-12 (NFC). Random book notes (Czech values in NFC and NFD, the moved key as a flow list, a block list, a
// scalar or missing, other keys and a body with inline `#tags`) and a random card move (docs/contracts/v1-views.md §1.9
// `BoardMove`): every line outside the moved key's line(s) is byte-identical; the body never changes; a list key holds
// its old entries minus `remove` (compared NFC) plus `add` unless already present, in that order; a scalar key holds
// `add`; a move that changes nothing answers null. Seeds as the package's other property tests (TS-L2): a fixed seed plus
// one random seed per run (`QA_SEED` when set), printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases. The
// package has no fast-check dependency; this file uses an xorshift generator. Written from the AC and the contract only
// (D-61). The module loads inside the test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'

const FIXED_SEED = 20261119
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`board move property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
const VALUES = ['Román', 'Detektivka', 'Poezie', 'Eseje', 'Cestopis', 'Čtení', 'Úvaha']
/** Tag keys are lower case (D-185 spelling = key here, so "the same tag key" is the same NFC text). */
const TAGS = ['doporučené', 'odloženo', 'večerní', 'čtení', 'úvaha']
const OTHER = ['author: "[[Eva Lindová]]"', 'status: Reading', 'rating: Good', 'finished: 2026-08-02', 'x-poznámka: žluťoučký kůň']
const BODIES = ['Krátké kapitoly.', 'Čtu večer. #večerní', 'Bez textu #doporučené a #odloženo.', '']
type Case = { text: string; key: string; shape: 'list' | 'scalar'; entries: string[] | null; move: { key: string; shape: 'list' | 'scalar'; remove: string[]; add: string | null }; body: string }

function gen(seed: number): Case {
  const r = rng(seed)
  const key = r.pick(['genres', 'tags', 'status'])
  const shape: 'list' | 'scalar' = key === 'status' ? 'scalar' : 'list'
  const spell = (v: string) => (r.bool() ? v.normalize('NFD') : v)
  const pool = key === 'tags' ? TAGS : VALUES
  const lines: string[] = ['---', 'id: 01JB5V00000000000000000099', 'type: book', 'title: Kniha z generátoru']
  let entries: string[] | null = null
  // A second line with the moved key would make the frontmatter invalid (a duplicate key), which is never rewritten.
  const others = OTHER.filter((l) => !l.startsWith(`${key}:`)).filter(() => r.bool())
  const at = r.int(others.length + 1)
  for (let i = 0; i <= others.length; i++) {
    if (i === at) {
      const style = r.int(shape === 'list' ? 3 : 2)
      if (shape === 'scalar' && style === 0) { const v = spell(r.pick(pool)); entries = [v]; lines.push(`${key}: ${v}`) }
      if (shape === 'list' && style === 0) { const vs = [...new Set(pool.filter(() => r.int(3) === 0))].map(spell); entries = vs; lines.push(`${key}: [${vs.join(', ')}]`) }
      if (shape === 'list' && style === 1 && r.bool()) { const vs = [...new Set(pool.filter(() => r.int(3) === 0))].map(spell); if (vs.length) { entries = vs; lines.push(`${key}:`, ...vs.map((v) => `  - ${v}`)) } }
    }
    if (i < others.length) lines.push(others[i])
  }
  lines.push('created: 2026-07-01T18:00:00+02:00', 'modified: 2026-08-03T09:00:00+02:00', '---')
  const body = r.pick(BODIES)
  const text = `${lines.join('\n')}\n${body}${body ? '\n' : ''}`
  const present = (entries ?? []).map((v) => v.normalize('NFC'))
  const remove = present.length && r.bool() ? [r.pick(present)] : []
  const add = shape === 'list' && r.int(5) === 0 ? null : r.pick(pool)
  return { text, key, shape, entries, move: { key, shape, remove, add }, body }
}
/** The frontmatter lines outside `key` (its line and its `  - ` items). */
function outside(text: string, key: string): string[] {
  const head = text.split('\n---\n')[0].split('\n')
  const out: string[] = []
  let inKey = false
  for (const l of head) {
    if (l.startsWith(`${key}:`)) { inKey = true; continue }
    if (inKey && l.startsWith('  - ')) continue
    inKey = false
    out.push(l)
  }
  return out
}
/** The values of `key` in a text (flow list, block list or scalar), NFC. */
function valuesOf(text: string, key: string): string[] | null {
  const head = text.split('\n---\n')[0].split('\n')
  const i = head.findIndex((l) => l.startsWith(`${key}:`))
  if (i < 0) return null
  const rest = head[i].slice(key.length + 1).trim()
  if (rest.startsWith('[')) return rest.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.normalize('NFC'))
  if (rest === '') { const out: string[] = []; for (let j = i + 1; j < head.length && head[j].startsWith('  - '); j++) out.push(head[j].slice(4).normalize('NFC')); return out }
  return [rest.normalize('NFC')]
}

test('fr_qry_05_ac14_multi_value_and_relation_drags', async () => {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Record<string, any>
  assert.equal(typeof m.applyBoardMove, 'function', '@tegg/doc exports applyBoardMove (v1-views §1.9)')
  for (const seed of SEEDS) {
    for (let i = 0; i < RUNS; i++) {
      const c = gen(seed * 7919 + i)
      const r = m.applyBoardMove(c.text, c.move) as { text: string; inlineKept: boolean } | null
      const old = (c.entries ?? []).map((v) => v.normalize('NFC'))
      const want = c.shape === 'scalar'
        ? [c.move.add as string]
        : [...old.filter((v) => !c.move.remove.includes(v)), ...(c.move.add !== null && !old.filter((v) => !c.move.remove.includes(v)).includes(c.move.add) ? [c.move.add] : [])]
      const same = c.shape === 'scalar' ? old.length === 1 && old[0] === c.move.add : JSON.stringify(want) === JSON.stringify(old)
      const where = `seed ${seed}, case ${i}: ${JSON.stringify(c.move)} on\n${c.text}`
      if (same) { assert.equal(r, null, `${where}\nnothing changes: null`); continue }
      assert.ok(r && typeof r.text === 'string', `${where}\na change answers { text }`)
      assert.deepEqual(outside(r!.text, c.key), outside(c.text, c.key), `${where}\nevery frontmatter line outside ${c.key} is byte-identical`)
      assert.equal(r!.text.split('\n---\n').slice(1).join('\n---\n'), c.text.split('\n---\n').slice(1).join('\n---\n'), `${where}\nthe body is byte-identical`)
      assert.deepEqual(valuesOf(r!.text, c.key), want, `${where}\n${c.key} holds the intended values`)
    }
  }
})
