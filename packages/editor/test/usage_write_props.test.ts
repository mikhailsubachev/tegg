// Slice Q2.1 QA (T1 follow-up), L2 property at the editor level: a block's sort or columns write goes through the
// editor (`QueryCtl.setSource` with `withUsage`'s fence, then the save's `reconcile`) and changes only the changed keys'
// lines of that one fence; every other byte of the note is kept (D-1885, R195 "Bytes kept", FR-FMT-07 AC-34,
// FR-FMT-12 AC-12, AC-13; CLAUDE.md rule 2). Random notes: fences with ``` and ~~~, at the top level, in list items,
// quotes, callouts and a list inside a quote, LF and CRLF, NFC and NFD text, with other paragraphs in the containers.
// The oracle is `applyFenceUsage` on the file's bytes (the byte-level twin, property-tested in packages/doc).
// Not an AC test. Seeds as the other property tests (TS-L2): a fixed seed plus one random seed (`QA_SEED` when set),
// printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyFenceUsage, queryFences, withUsage } from '@tegg/doc'
import { editorModule, NOW, newId } from './helpers'

const FIXED_SEED = 20261120
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 120
console.log(`usage write editor property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

type Sort = { by: string; order: 'asc' | 'desc' }
type Change = { sort?: Sort[] | null; columns?: string[] | null }
type Ctl = { nested: boolean; setSource(source: string): boolean }

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length]!, bool: () => (next() & 1) === 1 }
}
type R = ReturnType<typeof rng>

const NAMES = ['Přečtené', 'Rozečtené', 'Výborné knihy', 'Čtení na léto']
const KEYS = ['title', 'author', 'hodnocení', 'finished', 'žánry', 'poznámka', 'stav']
const PARAS = ['Úvod k četbě.', 'Žluťoučký kůň úpěl ďábelské ódy.', 'Šťastná cesta, Řeka a Ústí.', 'Konec: ďábelské účty.']
const TITLES = ['Výběr knížek', 'Na cestu', 'Čtení']

function distinct(r: R, n: number): string[] {
  const pool = [...KEYS]
  return Array.from({ length: n }, () => pool.splice(r.int(pool.length), 1)[0]!)
}
const randSort = (r: R): Sort[] => distinct(r, r.int(4)).map((by) => ({ by, order: r.bool() ? 'asc' : 'desc' }))
const randCols = (r: R): string[] => distinct(r, 1 + r.int(3))
const sortLines = (s: Sort[]): string[] =>
  s.length === 0 ? ['sort: []'] : s.length === 1 ? [`sort: { by: ${s[0]!.by}, order: ${s[0]!.order} }`] : ['sort:', ...s.map((l) => `  - { by: ${l.by}, order: ${l.order} }`)]

/** One fence's lines (without a container prefix), with a unique `saved:` name. */
function fenceLines(r: R, name: string): string[] {
  const marker = r.bool() ? '```' : '~~~'
  const body = [`saved: ${name}`]
  if (r.bool()) body.push(...sortLines(randSort(r)))
  if (r.bool()) body.push(`columns: [${randCols(r).join(', ')}]`)
  if (r.int(3) === 0) body.push('# poznámka k bloku')
  return [`${marker}${r.int(4) === 0 ? 'query meta' : 'query'}`, ...body, marker]
}

/** A block holding one fence: at the top level, in a list item, a quote, a callout, or a list item in a quote. */
function block(r: R, name: string, nfd: boolean): string[] {
  const t = (s: string) => (nfd ? s.normalize('NFD') : s)
  const f = fenceLines(r, t(name))
  const para = () => t(r.pick(PARAS))
  switch (r.int(5)) {
    case 0: return f
    case 1: return [`- ${para()}`, '', ...f.map((l) => `  ${l}`), ...(r.bool() ? ['', `  ${para()}`] : [])]
    case 2: return [...(r.bool() ? [`> ${para()}`, '>'] : []), ...f.map((l) => `> ${l}`), ...(r.bool() ? ['>', `> ${para()}`] : [])]
    case 3: return [`> [!note] ${t(r.pick(TITLES))}`, ...(r.bool() ? [`> ${para()}`, '>'] : []), ...f.map((l) => `> ${l}`), ...(r.bool() ? ['>', `> ${para()}`] : [])]
    default: return [`> - ${para()}`, '>', ...f.map((l) => `>   ${l}`)]
  }
}

async function openWith(text: string, ctls: { source: string; ctl: Ctl }[]) {
  const m = await editorModule()
  return (m.createEditor as any)({
    text, now: () => NOW, newId,
    ui: {
      resolve: () => null, unresolved: (s: string) => s, sourceBlock: 'Source block', hint: '',
      placeholder: (_k: string, v: string) => ({ name: v, text: v }), onLink: () => {}, onTag: () => {}, onExternal: () => {},
      query: (source: string, _dom: HTMLElement, ctl: Ctl) => { ctls.push({ source, ctl }); return { update: () => {}, selected: () => {}, destroy: () => {} } },
    },
  })
}

const withoutModified = (s: string) => s.replace(/^modified:.*$/m, 'modified: -')

test('usage_write_through_the_editor_keeps_every_other_byte', async () => {
  const fails: string[] = []
  let written = 0
  let nestedWritten = 0
  for (const seed of SEEDS) {
    for (let run = 0; run < RUNS && fails.length < 5; run++) {
      const r = rng(seed * 7919 + run)
      const nl = r.bool() ? '\r\n' : '\n'
      const nfd = r.bool()
      const n = 1 + r.int(3)
      const parts: string[] = []
      for (let i = 0; i < n; i++) {
        if (r.bool()) parts.push((nfd ? r.pick(PARAS).normalize('NFD') : r.pick(PARAS)))
        parts.push(block(r, `${r.pick(NAMES)} ${i + 1}`, nfd).join(nl))
      }
      const head = ['---', 'id: 01JB0Z00000000000000000555', 'type: page', 'title: Náhodná', 'created: 2026-11-20T09:00:00+01:00', 'modified: 2026-11-20T09:00:00+01:00', '---'].join(nl)
      const text = head + nl + parts.join(nl + nl) + (r.bool() ? nl : '')
      const ctls: { source: string; ctl: Ctl }[] = []
      const ed = await openWith(text, ctls)
      try {
        const fences = queryFences(text)
        if (fences.length !== n) { fails.push(`seed ${seed} run ${run}: ${fences.length} fences found, ${n} written`); continue }
        // The fence to write and its block (some containers open as source blocks and have no usage to write).
        const pick = r.int(n)
        const name = `${pick + 1}`
        const c = ctls.find((x) => new RegExp(`^saved: .* ${name}$`, 'm').test(x.source.replace(/\r\n/g, '\n')))
        if (!c) continue
        const change: Change = {}
        const sk = r.int(3), ck = r.int(3)
        if (sk === 1) change.sort = randSort(r)
        if (sk === 2) change.sort = null
        if (ck === 1 || (sk === 0 && ck === 0)) change.columns = randCols(r)
        if (ck === 2) change.columns = null
        const src = withUsage(c.source, change)
        const expected = applyFenceUsage(text, fences[pick]!.range, change)
        if ((src === null) !== (expected === null)) { fails.push(`seed ${seed} run ${run}: withUsage ${src === null ? 'null' : 'a change'}, applyFenceUsage ${expected === null ? 'null' : 'a change'}`); continue }
        if (src === null) { if ((await ed.save()) !== null) fails.push(`seed ${seed} run ${run}: a no-op wrote`); continue }
        if (!c.ctl.setSource(src)) { fails.push(`seed ${seed} run ${run}: setSource refused ${JSON.stringify(change)}\n--- input\n${text}`); continue }
        let out: string | null = null
        try { out = await ed.save() } catch (e) { fails.push(`seed ${seed} run ${run}: the save threw ${String(e)}\n--- input\n${text}`); continue }
        if (out === null || withoutModified(out) !== withoutModified(expected!)) {
          fails.push(`seed ${seed} run ${run}: fence ${pick + 1} ${JSON.stringify(change)}\n--- input\n${JSON.stringify(text)}\n--- want\n${JSON.stringify(expected)}\n--- got\n${JSON.stringify(out)}`)
          continue
        }
        written++
        if (c.ctl.nested) nestedWritten++
      } finally {
        ed.destroy()
      }
    }
  }
  assert.deepEqual(fails, [], 'a usage write through the editor changes only the changed keys\' lines of the one fence')
  console.log(`usage write editor property: ${written} writes, ${nestedWritten} nested`)
  // The generator reaches the editor path: most notes have a block to write, many of them nested.
  assert.ok(written >= SEEDS.length * RUNS * 0.4, `${written} writes checked`)
  assert.ok(nestedWritten >= SEEDS.length * RUNS * 0.2, `${nestedWritten} nested writes checked`)
}, 600_000)
