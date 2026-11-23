// Slice Q3, L2 property at @tegg/doc: docs/acceptance/views.md FR-FMT-07 AC-37, the fence part. Random notes with random
// reference fences (``` and ~~~, top level, in list items, quotes and callouts, LF and CRLF) whose bodies hold `view`,
// `group_by`, `lanes`, `lane_order`, `widths`, `sort`, `columns` in old and new words (`board`, `vertical`, `horizontal`),
// flow and block styles, trailing comments, comment and unknown-key lines in random order, and NFD values; a random Q3
// change on one fence: `applyFenceUsage` (docs/contracts/v1-views.md §37) changes only the changed keys' lines of that one
// fence by R221's place rules (a present key replaced in its range keeping a one-line key's trailing comment, a missing
// key after the nearest earlier key present in the order saved, view, group_by, lanes, lane_order, sort, columns, widths, a
// removal removes the range, new lines with the `saved:` line's prefix and the fence's EOL, new words only for the changed
// key); every other old word and every byte outside the fence is kept; the result reads back as the intended values; a
// no-op (an equal valid value, old words included; widths as maps) answers null. Seeds as the package's other property
// tests (TS-L2): a fixed seed plus one random seed (`QA_SEED` when set), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100
// runs 10 seeds × 1,000 cases. Written from the AC and the contract only (D-61). Functions are read from the index at run
// time (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const FIXED_SEED = 20261123
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`display fence property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

const D = doc as unknown as Record<string, any>
type Group = { none: true } | { none: false; key: string; period: boolean }
type Widths = [string, number][]
type Vals = { view: string | null; group: Group | null; lanes: string | null; laneOrder: string[] | null; widths: Widths | null }
type Change = Partial<Vals>
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-views §37)`)
  return D[name] as T
}
function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
type R = ReturnType<typeof rng>
/** `n` distinct values (a repeated lane has read rules of its own). */
function distinct(r: R, from: readonly string[], n: number): string[] {
  const pool = [...from]
  return Array.from({ length: n }, () => pool.splice(r.int(pool.length), 1)[0])
}
const NFD = (s: string) => s.normalize('NFD')
const NAMES = ['Přečtené 2026', 'Rozečtené', 'Výborné knihy', 'Čtení na léto']
const GROUP_KEYS = ['status', 'genres', 'author', 'žánry']
const LANE_VALUES = ['Reading', 'To read', 'Read', 'Román', '[[Lucie Horká]]', 'Čtu']
const WIDTH_KEYS = ['title', 'author', 'rating', 'poznámka']
const PARAS = ['Úvod k četbě.', 'Žluťoučký kůň úpěl ďábelské ódy.', 'Odkaz na [[Mapa bez severu]].']
const ORDER = ['saved', 'view', 'group_by', 'lanes', 'lane_order', 'sort', 'columns', 'widths'] as const
type Kind = (typeof ORDER)[number] | 'comment' | 'unknown'
type Part = { kind: Kind; lines: string[] }
type F = { marker: string; info: string; prefix: string; callout: boolean; parts: Part[]; own: Vals }

const quote = (s: string) => (/^[\w À-ž]+$/.test(s.normalize('NFC')) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s))
const VIEW_IN = { list: 'list', table: 'table', wall: 'wall', board: 'wall' } as Record<string, string>
const LANES_IN = { columns: 'columns', rows: 'rows', vertical: 'columns', horizontal: 'rows' } as Record<string, string>
const groupLine = (g: Group) => (g.none ? 'group_by: none' : g.period ? `group_by: { ${g.key}: period }` : `group_by: ${g.key}`)
const laneLine = (l: string[]) => `lane_order: [${l.map(quote).join(', ')}]`
const widthLine = (w: Widths) => `widths: { ${w.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
const nfcG = (g: Group | null): Group | null => (g && !g.none ? { ...g, key: g.key.normalize('NFC') } : g)
const nfcW = (w: Widths | null) => (w ? w.map(([k, v]) => [k.normalize('NFC'), v] as [string, number]) : w)
const sameWidths = (a: Widths | null, b: Widths | null) => {
  if (a === null || b === null) return a === b
  const m = (w: Widths) => JSON.stringify(w.map(([k, v]) => `${k.normalize('NFC')}=${v}`).sort())
  return m(a) === m(b)
}

function genFence(r: R): F {
  const marker = r.bool() ? '```' : '~~~'
  const info = r.int(4) === 0 ? 'query meta' : 'query'
  const where = r.int(4)
  const prefix = where === 1 ? '  ' : where >= 2 ? '> ' : ''
  const own: Vals = { view: null, group: null, lanes: null, laneOrder: null, widths: null }
  const rest: Part[] = []
  if (r.bool()) { const w = r.pick(['list', 'table', 'wall', 'board']); own.view = VIEW_IN[w]; rest.push({ kind: 'view', lines: [`view: ${w}`] }) }
  if (r.bool()) {
    const g: Group = r.int(4) === 0 ? { none: true } : { none: false, key: r.pick(GROUP_KEYS), period: r.int(3) === 0 }
    own.group = nfcG(g)
    rest.push({ kind: 'group_by', lines: [groupLine(r.bool() || g.none ? g : { ...g, key: NFD((g as any).key) })] })
  }
  if (r.bool()) {
    const w = r.pick(['columns', 'rows', 'vertical', 'horizontal'])
    own.lanes = LANES_IN[w]
    rest.push({ kind: 'lanes', lines: [`lanes: ${w}${r.bool() ? '            # vertical nebo horizontal' : ''}`] })
  }
  if (r.bool()) {
    const l = distinct(r, LANE_VALUES, r.int(3))
    own.laneOrder = l.map((x) => x.normalize('NFC'))
    rest.push({ kind: 'lane_order', lines: l.length === 0 || r.bool() ? [laneLine(l)] : ['lane_order:', ...l.map((x) => `  - ${quote(x)}`)] })
  }
  if (r.bool()) {
    const keys = [...WIDTH_KEYS].sort(() => (r.bool() ? 1 : -1)).slice(0, 1 + r.int(2))
    const w: Widths = keys.map((k) => [r.bool() ? k : NFD(k), 160 + 20 * r.int(10)])
    own.widths = nfcW(w)
    rest.push({ kind: 'widths', lines: r.bool() ? [widthLine(w)] : ['widths:', ...w.map(([k, v]) => `  ${k}: ${v}`)] })
  }
  if (r.bool()) rest.push({ kind: 'sort', lines: ['sort: { by: title, order: asc }'] })
  if (r.bool()) rest.push({ kind: 'columns', lines: ['columns: [author, rating]'] })
  if (r.bool()) rest.push({ kind: 'comment', lines: ['# ruční pokus'] })
  if (r.bool()) rest.push({ kind: 'unknown', lines: ['x-poznámka: úzký sloupec'] })
  for (let i = rest.length - 1; i > 0; i--) { const j = r.int(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]] }
  return { marker, info, prefix, callout: where === 3, parts: [{ kind: 'saved', lines: [`saved: ${r.bool() ? r.pick(NAMES) : NFD(r.pick(NAMES))}`] }, ...rest], own }
}
function renderFence(f: F, nl: string): string {
  const lines = [...(f.callout ? ['[!note] Na cestu'] : []), `${f.marker}${f.info}`, ...f.parts.flatMap((p) => p.lines), f.marker]
  const fence = lines.map((l) => f.prefix + l).join(nl)
  return f.prefix === '  ' ? `- Seznam na víkend:${nl}${nl}${fence}` : fence
}
function randChange(r: R): Change {
  const c: Change = {}
  while (Object.keys(c).length === 0) {
    if (r.int(3) === 0) c.view = r.int(4) === 0 ? null : r.pick(['list', 'table', 'wall'])
    if (r.int(3) === 0) c.group = r.int(4) === 0 ? null : r.int(4) === 0 ? { none: true } : { none: false, key: r.pick(GROUP_KEYS), period: r.int(3) === 0 }
    if (r.int(3) === 0) c.lanes = r.int(4) === 0 ? null : r.pick(['columns', 'rows'])
    if (r.int(3) === 0) c.laneOrder = r.int(4) === 0 ? null : distinct(r, LANE_VALUES, r.int(3))
    if (r.int(3) === 0) c.widths = r.int(4) === 0 ? null : WIDTH_KEYS.slice(0, 1 + r.int(2)).map((k) => [k, 160 + 20 * r.int(10)] as [string, number])
  }
  return c
}
const KIND: Record<keyof Vals, Kind> = { view: 'view', group: 'group_by', lanes: 'lanes', laneOrder: 'lane_order', widths: 'widths' }
/** R221's place rules on the model; `same` tells whether the change equals the current valid value. */
function applyModel(f: F, c: Change): F {
  const parts = f.parts.map((p) => ({ ...p, lines: [...p.lines] }))
  const own = { ...f.own }
  for (const k of ['view', 'group', 'lanes', 'laneOrder', 'widths'] as (keyof Vals)[]) {
    if (!(k in c)) continue
    const v = (c as any)[k]
    const kind = KIND[k]
    const i = parts.findIndex((p) => p.kind === kind)
    if (v === null) { if (i >= 0) parts.splice(i, 1); (own as any)[k] = null; continue }
    const cur = (own as any)[k]
    const same = k === 'widths' ? sameWidths(cur, v) : JSON.stringify(k === 'group' ? nfcG(cur) : cur) === JSON.stringify(k === 'group' ? nfcG(v) : k === 'laneOrder' ? v.map((x: string) => x.normalize('NFC')) : v)
    if (i >= 0 && same) continue
    const line = k === 'view' ? `view: ${v}` : k === 'group' ? groupLine(v) : k === 'lanes' ? `lanes: ${v}` : k === 'laneOrder' ? laneLine(v) : widthLine(v)
    if (i >= 0) {
      const old = parts[i].lines
      const comment = old.length === 1 ? /(\s+#.*)$/.exec(old[0])?.[1] ?? '' : ''
      parts[i].lines = [line + comment]
    } else {
      const at = ORDER.indexOf(kind as any)
      let after = 0
      for (let o = at - 1; o >= 0; o--) { const j = parts.findIndex((p) => p.kind === ORDER[o]); if (j >= 0) { after = j; break } }
      parts.splice(after + 1, 0, { kind, lines: [line] })
    }
    ;(own as any)[k] = k === 'group' ? nfcG(v) : k === 'laneOrder' ? v.map((x: string) => x.normalize('NFC')) : v
  }
  return { ...f, parts, own }
}

test('fr_fmt_07_ac37_display_keys_round_trip', () => {
  const applyFenceUsage = fn<(t: string, r: [number, number], c: Change) => string | null>('applyFenceUsage')
  const queryFences = fn<(t: string) => { range: [number, number]; body: string }[]>('queryFences')
  const fenceUsage = fn<(b: string) => Record<string, unknown>>('fenceUsage')
  const fails: string[] = []
  for (const seed of SEEDS) {
    for (let run = 0; run < RUNS && fails.length < 5; run++) {
      const r = rng(seed * 7919 + run)
      const nl = r.bool() ? '\r\n' : '\n'
      const blocks: (F | string)[] = []
      const k = 1 + r.int(3)
      for (let i = 0; i < k; i++) { if (r.bool()) blocks.push(r.pick(PARAS)); blocks.push(genFence(r)) }
      blocks.push(r.pick(PARAS))
      const render = (bs: (F | string)[]) => `---${nl}title: Náhodná${nl}---${nl}` + bs.map((b) => (typeof b === 'string' ? b : renderFence(b, nl))).join(nl + nl) + nl
      const text = render(blocks)
      const fIdx = blocks.map((b, i) => (typeof b === 'string' ? -1 : i)).filter((i) => i >= 0)
      const pick = r.int(fIdx.length)
      const target = blocks[fIdx[pick]] as F
      const change = randChange(r)
      const model = applyModel(target, change)
      const want = render(blocks.map((b, i) => (i === fIdx[pick] ? model : b)))
      const fs = queryFences(text)
      if (fs.length !== fIdx.length) { fails.push(`seed ${seed} run ${run}: ${fs.length} fences found, ${fIdx.length} written`); continue }
      const got = applyFenceUsage(text, fs[pick].range, change)
      const expected = want === text ? null : want
      if (got !== expected) { fails.push(`seed ${seed} run ${run}: fence ${pick + 1} ${JSON.stringify(change)}\n--- input\n${text}\n--- want\n${expected}\n--- got\n${got}`); continue }
      if (got !== null) {
        const u = fenceUsage(queryFences(got)[pick].body)
        const read = { view: u.view, group: u.group, lanes: u.lanes, laneOrder: u.laneOrder, widths: u.widths }
        const wantRead = { ...model.own }
        if (JSON.stringify(read) !== JSON.stringify(wantRead)) fails.push(`seed ${seed} run ${run}: reads back ${JSON.stringify(read)}, want ${JSON.stringify(wantRead)}`)
      }
    }
  }
  assert.deepEqual(fails, [], 'only the changed keys\' lines of the one fence change, by R221\'s rules; old words elsewhere kept; a no-op is null')
}, 600_000)
