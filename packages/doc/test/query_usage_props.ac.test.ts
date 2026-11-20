// Slice Q2.1, L2 property at @tegg/doc: docs/acceptance/views.md FR-FMT-07 AC-34, the note part. Random notes with
// random reference fences (``` and ~~~, top level, in list items, quotes and callouts, LF and CRLF, `sort:` in one-line
// and list form, `columns:`, comment and unknown-key lines in random order) and a random usage change on one fence:
// `applyFenceUsage` (docs/contracts/v1-views.md §13.1) changes only the changed keys' lines of that one fence, by R195's
// place and write rules (a present key replaced in its range, a missing `sort` after `saved:`, a missing `columns` after
// the `sort` range or else after `saved:`, a removal removes the range, new lines with the `saved:` line's prefix and
// the fence's EOL); every byte outside the fence is kept; the result's body reads back (`fenceUsage`) as the intended
// values; a no-op answers null. Seeds as the package's other property tests (TS-L2): a fixed seed plus one random seed
// (`QA_SEED` when set), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases. Written from the
// AC and the contract only (D-61). Functions are read from the index at run time (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const FIXED_SEED = 20261119
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`usage fence property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

const D = doc as unknown as Record<string, any>
type Sort = { by: string; order: 'asc' | 'desc' }
type Change = { sort?: Sort[] | null; columns?: string[] | null }
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-views §13.1)`)
  return D[name] as T
}
function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
type R = ReturnType<typeof rng>
const NAMES = ['Přečtené 2026', 'Rozečtené', 'Výborné knihy', 'Čtení na léto']
const KEYS = ['title', 'author', 'rating', 'finished', 'genres', 'poznámka', 'modified', 'stav']
const PARAS = ['Úvod k četbě.', 'Žluťoučký kůň úpěl ďábelské ódy.', 'Odkaz na [[Mapa bez severu]].', '#četba a #léto']

const sortLines = (s: Sort[]): string[] =>
  s.length === 0 ? ['sort: []'] : s.length === 1 ? [`sort: { by: ${s[0].by}, order: ${s[0].order} }`] : ['sort:', ...s.map((l) => `  - { by: ${l.by}, order: ${l.order} }`)]
const colLines = (c: string[]) => [`columns: [${c.join(', ')}]`]
/** `n` distinct keys (repeated levels or columns have read rules of their own, R185). */
function distinct(r: R, n: number): string[] {
  const pool = [...KEYS]
  return Array.from({ length: n }, () => pool.splice(r.int(pool.length), 1)[0])
}
const randSort = (r: R): Sort[] => distinct(r, r.int(4)).map((by) => ({ by, order: r.bool() ? 'asc' : 'desc' }))
const randCols = (r: R): string[] => distinct(r, 1 + r.int(3))

type Part = { kind: 'saved' | 'sort' | 'columns' | 'comment' | 'unknown'; lines: string[] }
type F = { marker: string; info: string; prefix: string; callout: boolean; parts: Part[]; own: { sort: Sort[] | null; columns: string[] | null } }

function genFence(r: R): F {
  const marker = r.bool() ? '```' : '~~~'
  const info = r.int(4) === 0 ? 'query meta' : 'query'
  const where = r.int(4)
  const prefix = where === 1 ? '  ' : where >= 2 ? '> ' : ''
  const own = { sort: r.bool() ? randSort(r) : null, columns: r.bool() ? randCols(r) : null }
  const rest: Part[] = []
  if (own.sort) rest.push({ kind: 'sort', lines: sortLines(own.sort) })
  if (own.columns) rest.push({ kind: 'columns', lines: colLines(own.columns) })
  if (r.bool()) rest.push({ kind: 'comment', lines: ['# poznámka k bloku'] })
  if (r.bool()) rest.push({ kind: 'unknown', lines: ['x-poznámka: úzký sloupec'] })
  for (let i = rest.length - 1; i > 0; i--) { const j = r.int(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]] }
  return { marker, info, prefix, callout: where === 3, parts: [{ kind: 'saved', lines: [`saved: ${r.pick(NAMES)}`] }, ...rest], own }
}
function renderFence(f: F, nl: string): string {
  const lines = [...(f.callout ? ['[!note] Na cestu'] : []), `${f.marker}${f.info}`, ...f.parts.flatMap((p) => p.lines), f.marker]
  const fence = lines.map((l) => f.prefix + l).join(nl)
  // A fence in a list item: the item's first line, a blank line, then the fence indented by two spaces.
  return f.prefix === '  ' ? `- Seznam na víkend:${nl}${nl}${fence}` : fence
}
/** R195's place rules on the model. */
function applyModel(f: F, c: Change): F {
  const parts = f.parts.map((p) => ({ ...p, lines: [...p.lines] }))
  const at = (k: Part['kind']) => parts.findIndex((p) => p.kind === k)
  if (c.sort !== undefined) {
    const i = at('sort')
    if (c.sort === null) { if (i >= 0) parts.splice(i, 1) }
    else if (i >= 0) parts[i].lines = sortLines(c.sort)
    else parts.splice(at('saved') + 1, 0, { kind: 'sort', lines: sortLines(c.sort) })
  }
  if (c.columns !== undefined) {
    const i = at('columns')
    if (c.columns === null) { if (i >= 0) parts.splice(i, 1) }
    else if (i >= 0) parts[i].lines = colLines(c.columns)
    else { const s = at('sort'); parts.splice((s >= 0 ? s : at('saved')) + 1, 0, { kind: 'columns', lines: colLines(c.columns) }) }
  }
  return { ...f, parts, own: { sort: c.sort === undefined ? f.own.sort : c.sort, columns: c.columns === undefined ? f.own.columns : c.columns } }
}

test('fr_fmt_07_ac34_usage_settings_round_trip', () => {
  const applyFenceUsage = fn<(t: string, r: [number, number], c: Change) => string | null>('applyFenceUsage')
  const queryFences = fn<(t: string) => { range: [number, number]; body: string }[]>('queryFences')
  const fenceUsage = fn<(b: string) => { sort: unknown; columns: unknown }>('fenceUsage')
  const fails: string[] = []
  for (const seed of SEEDS) {
    for (let run = 0; run < RUNS && fails.length < 5; run++) {
      const r = rng(seed * 7919 + run)
      const nl = r.bool() ? '\r\n' : '\n'
      const blocks: (F | string)[] = []
      const k = 1 + r.int(4)
      for (let i = 0; i < k; i++) { if (r.bool()) blocks.push(r.pick(PARAS)); blocks.push(genFence(r)) }
      blocks.push(r.pick(PARAS))
      const render = (bs: (F | string)[]) => `---${nl}title: Náhodná${nl}---${nl}` + bs.map((b) => (typeof b === 'string' ? b : renderFence(b, nl))).join(nl + nl) + nl
      const text = render(blocks)
      const fIdx = blocks.map((b, i) => (typeof b === 'string' ? -1 : i)).filter((i) => i >= 0)
      const pick = r.int(fIdx.length)
      const target = blocks[fIdx[pick]] as F
      const change: Change = {}
      const sk = r.int(3), ck = r.int(3)
      if (sk === 1) change.sort = randSort(r)
      if (sk === 2) change.sort = null
      if (ck === 1) change.columns = randCols(r)
      if (ck === 2) change.columns = null
      const after = blocks.map((b, i) => (i === fIdx[pick] ? applyModel(target, change) : b))
      const want = render(after)
      const fs = queryFences(text)
      if (fs.length !== fIdx.length) { fails.push(`seed ${seed} run ${run}: ${fs.length} fences found, ${fIdx.length} written`); continue }
      const got = applyFenceUsage(text, fs[pick].range, change)
      const expected = want === text ? null : want
      if (got !== expected) { fails.push(`seed ${seed} run ${run}: fence ${pick + 1} ${JSON.stringify(change)}\n--- input\n${text}\n--- want\n${expected}\n--- got\n${got}`); continue }
      if (got !== null) {
        const u = fenceUsage(queryFences(got)[pick].body)
        const own = applyModel(target, change).own
        if (JSON.stringify({ sort: u.sort, columns: u.columns }) !== JSON.stringify({ sort: own.sort, columns: own.columns })) fails.push(`seed ${seed} run ${run}: reads back ${JSON.stringify(u)}, want ${JSON.stringify(own)}`)
      }
    }
  }
  assert.deepEqual(fails, [], 'only the changed keys\' lines of the one fence change, by R195\'s rules; a no-op is null')
}, 600_000) // D-1876: the nightly scale runs 10,000 cases
