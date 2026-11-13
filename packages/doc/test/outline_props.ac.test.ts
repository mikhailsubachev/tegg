// Slice OL, L2 properties at @tegg/doc (docs/acceptance/outline.md FR-EDT-16 AC-5, the property part; R171 rule 5;
// docs/contracts/v1-outline.md §1.3). Random heading lists (levels 1–6, length 0–600) with a random current section or
// none go through `outlineTree` (synthetic `OutlineHeading`s, no Markdown) and `railRows`, which must keep AC-5's five
// properties: every drawn row's ancestors are drawn; the current section and its ancestors are always drawn; the rows are
// in note order; the rows other than the current branch number at most 20 when depth 1 alone fits in 20; an all-H2 note
// behaves as an all-H1 note (depth, not level). The tree itself is checked against R171 rule 5. A second property builds
// Markdown from a random list (`#`×level + text + a blank line) and checks that `outlineHeadings` returns exactly that
// list (levels, texts, increasing `from`). Seeds as the package's other property tests (TS-L2): a fixed seed plus one
// random seed per run (`QA_SEED` when set), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases.
// The package has no fast-check dependency; this file uses an xorshift generator. Written from the AC and the contract
// only (D-61); a missing export is an assertion failure (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const D = doc as unknown as Record<string, any>
type Level = 1 | 2 | 3 | 4 | 5 | 6
type Heading = { level: Level; text: string; from: number; to: number }
type Node = Heading & { index: number; depth: number; parent: number | null; children: number[]; descendants: number; key: string }

const FIXED_SEED = 20261113
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 120
console.log(`outline property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-outline §1.2)`)
  return D[name] as T
}
const WORDS = ['Úvod', 'Plán', 'Řešení', 'Žádosti', 'Ďáblova', 'kůň', 'Čtení', 'souhrn', 'otázky', 'Ťuk', 'nápad 2', 'Příklady']

/** A random heading list: mostly small level steps, sometimes jumps and long runs of one level. */
function headings(r: ReturnType<typeof rng>, len: number, levels: readonly Level[] = [1, 2, 3, 4, 5, 6]): Heading[] {
  const out: Heading[] = []
  let at = 0
  let lv = r.pick(levels)
  for (let i = 0; i < len; i++) {
    const k = r.int(10)
    if (k < 4) lv = Math.min(levels[levels.length - 1], lv + 1) as Level
    else if (k < 7) lv = Math.max(levels[0], lv - 1) as Level
    else if (k < 8) lv = r.pick(levels)
    const text = `${r.pick(WORDS)} ${i}`
    out.push({ level: lv, text, from: at, to: at + lv + 1 + text.length })
    at += lv + 1 + text.length + 2
  }
  return out
}
const ancestors = (tree: readonly Node[], i: number) => {
  const a: number[] = []
  for (let p = tree[i]?.parent ?? null; p !== null; p = tree[p]?.parent ?? null) a.push(p)
  return a
}

test('fr_edt_16_ac5_rail_rows_in_a_long_note_properties', () => {
  const outlineTree = fn<(h: readonly Heading[]) => Node[]>('outlineTree')
  const railRows = fn<(t: readonly Node[], c: number | null, o?: ReadonlySet<number>, m?: number) => number[]>('railRows')
  for (const seed of SEEDS) {
    const r = rng(seed)
    for (let run = 0; run < RUNS; run++) {
      const len = r.int(8) === 0 ? r.int(601) : r.int(80)
      const h = headings(r, len)
      const tree = outlineTree(h)
      const where = `seed = ${seed}, run ${run}, ${len} headings`
      assert.equal(tree.length, len, `${where}: one node per heading`)
      for (let i = 0; i < len; i++) {
        let p: number | null = null
        for (let j = i - 1; j >= 0; j--) if (h[j].level < h[i].level) { p = j; break }
        assert.equal(tree[i].parent, p, `${where}: parent of ${i} is the nearest earlier heading with a lower level`)
        assert.equal(tree[i].depth, 1 + ancestors(tree, i).length, `${where}: depth of ${i}`)
      }
      const current = len === 0 || r.int(4) === 0 ? null : r.int(len)
      const rows = railRows(tree, current)
      const drawn = new Set(rows)
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i] > rows[i - 1], `${where}: rows in note order`)
      for (const i of rows) for (const a of ancestors(tree, i)) assert.ok(drawn.has(a), `${where}: row ${i}'s ancestor ${a} is drawn`)
      if (current !== null) {
        assert.ok(drawn.has(current), `${where}: the current section ${current} is drawn`)
        for (const a of ancestors(tree, current)) assert.ok(drawn.has(a), `${where}: the current section's ancestor ${a} is drawn`)
      }
      const depth1 = tree.filter((n) => n.depth === 1).length
      if (depth1 <= 20) {
        const branch = new Set<number>()
        if (current !== null) {
          branch.add(current)
          for (const c of tree[current].children) branch.add(c)
          for (const a of ancestors(tree, current)) { branch.add(a); for (const c of tree[a].children) branch.add(c) }
        }
        const rest = rows.filter((i) => !branch.has(i)).length
        assert.ok(rest <= 20, `${where}: ${rest} rows besides the current branch (≤ 20 when depth 1 fits)`)
      }
      // Depth, not level: the same shape one level deeper draws the same rows.
      if (h.every((x) => x.level <= 5)) {
        const deeper = outlineTree(h.map((x) => ({ ...x, level: (x.level + 1) as Level })))
        assert.deepEqual(railRows(deeper, current), rows, `${where}: every level + 1 draws the same rows`)
      }
      const flat = r.int(41)
      const allH1 = outlineTree(Array.from({ length: flat }, (_, i) => ({ level: 1 as Level, text: `A ${i}`, from: i * 9, to: i * 9 + 5 })))
      const allH2 = outlineTree(Array.from({ length: flat }, (_, i) => ({ level: 2 as Level, text: `A ${i}`, from: i * 9, to: i * 9 + 6 })))
      const cur = flat === 0 ? null : r.int(flat)
      assert.deepEqual(railRows(allH2, cur), railRows(allH1, cur), `${where}: an all-H2 note of ${flat} behaves as an all-H1 note`)
    }
  }
})

test('fr_edt_11_ac2_what_counts_as_a_heading_generated_markdown', () => {
  const outlineHeadings = fn<(t: string) => Heading[]>('outlineHeadings')
  for (const seed of SEEDS) {
    const r = rng(seed)
    for (let run = 0; run < RUNS; run++) {
      const h = headings(r, r.int(40))
      const paras = ['Odstavec.', 'Žluťoučký kůň úpěl ďábelské ódy.', '- položka', '> citace', '']
      const parts: string[] = []
      if (r.bool()) parts.push('---\nid: 01JC5N0000000000000000P001\ntype: page\ntitle: Vygenerovaná\n---')
      for (const x of h) {
        parts.push(`${'#'.repeat(x.level)} ${x.text}`)
        const p = r.pick(paras)
        if (p) parts.push(p)
      }
      const text = parts.join('\n\n') + '\n'
      const got = outlineHeadings(text)
      const where = `seed = ${seed}, run ${run}`
      assert.deepEqual(got.map((x) => [x.level, x.text]), h.map((x) => [x.level, x.text]), `${where}: exactly the generated headings`)
      for (let i = 0; i < got.length; i++) {
        if (i > 0) assert.ok(got[i].from > got[i - 1].from, `${where}: increasing from`)
        assert.equal(text.slice(got[i].from, got[i].to), `${'#'.repeat(h[i].level)} ${h[i].text}`, `${where}: from/to cover the heading's line`)
      }
    }
  }
})
