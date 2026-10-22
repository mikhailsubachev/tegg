// MS4 slice 4D-lite, L2 property tests of the tag text ops (docs/contracts/ms4-tags.md §4.2) on random documents:
// docs/acceptance/tags.md FR-TAG-04 AC-11 (b) outside the occurrences of K every byte is unchanged (model-based: the
// generator knows every occurrence), (d) renaming back K′ → K returns the original bytes when K had one spelling;
// FR-TAG-08 AC-6 on text (no occurrence of K left, every byte outside the removed ranges unchanged, the other tags
// unchanged); FR-FMT-07 AC-23 (rename and reverse are byte-identical). Documents mix K's spellings (NFC, NFD, case),
// other tags (`#x-y`, `#x/y`, `#účty-2026`, `#účty/archiv`), K inside code spans, fences, math, links, URLs and
// wikilinks, frontmatter flow and block lists, CRLF/LF, with and without a final newline. The vault-level parts
// (a), (c) run in crates/tegg-jobs/tests/ac_property_tags.rs.
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 documents. Every seed is printed (`seed = N`). Synthetic Czech
// text (D-50). Written from the ACs and the contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'

const FIXED_SEED = 20261022
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const runs = scale >= 100 ? 1000 : 100

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['transform', 'parse', 'tags']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k}`)
  return m
}

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x
  }
  return {
    below: (n: number) => next() % n,
    pick<T>(a: readonly T[]): T { return a[next() % a.length] },
    chance: (pct: number) => next() % 100 < pct,
  }
}
type R = ReturnType<typeof rng>
const nfd = (s: string) => s.normalize('NFD')

/** K's spellings: NFC, NFD and case variants of one key. */
const K_SPELLINGS = ['účty', 'Účty', 'ÚČTY', nfd('účty'), nfd('Účty')]
const OTHERS = ['finance', 'x-y', 'x/y', 'účty-2026', 'účty/archiv', 'čtení', 'Žluť']
const WORDS = ['Text', 'odstavec', 'ěščřžýáíé', 'konec', 'a', 'viz']

/** A document as parts; `occ` marks the name bytes of one occurrence of K (without `#`). */
type Part = { text: string; occ?: true }
function gen(r: R, single: boolean): { parts: Part[]; spelling: string } {
  const spelling = r.pick(K_SPELLINGS)
  const k = () => (single ? spelling : r.pick(K_SPELLINGS))
  const parts: Part[] = []
  const push = (text: string, occ = false) => parts.push(occ ? { text, occ: true } : { text })
  let occurrences = 0
  // Frontmatter: none, a flow list or a block list of K and other tags.
  const fm = r.below(3)
  if (fm > 0) {
    push('---\nid: 01JB4D0000000000000000P001\ntitle: Náhodná\n')
    const entries: (string | 'K')[] = []
    for (let i = 0, n = 1 + r.below(3); i < n; i++) entries.push(r.chance(50) ? 'K' : r.pick(OTHERS.filter((o) => !o.includes('/'))))
    if (fm === 1) {
      push('tags: [')
      entries.forEach((e, i) => { if (i) push(', '); if (e === 'K') { push(k(), true); occurrences++ } else push(e) })
      push(']\n')
    } else {
      push('tags:\n')
      for (const e of entries) { push('  - '); if (e === 'K') { push(k(), true); occurrences++ } else push(e); push('\n') }
    }
    push('modified: 2026-10-01T09:00:00+02:00\n---\n')
  }
  const blocks = 1 + r.below(6)
  for (let b = 0; b < blocks; b++) {
    if (b) push('\n\n')
    const kind = r.below(9)
    if (kind === 0) push('```\n#' + k() + '\n```')
    else if (kind === 1) push('Kód `#' + k() + '` tady.')
    else if (kind === 2) push('Vzorec $#' + k() + '$ tady.')
    else if (kind === 3) push('Odkaz [#' + k() + '](Cíl.md) a <https://site.cz/#' + k() + '> a [[Cíl#' + k() + ']].')
    else if (kind === 4) push('Jiný #' + r.pick(OTHERS) + ' štítek.')
    else {
      // A paragraph with K at the start, in the middle or at the end, followed by a space, `.`, `,` or the line end.
      const n = 1 + r.below(4)
      for (let i = 0; i < n; i++) {
        if (i) push(r.chance(30) ? '\n' : ' ')
        if (r.chance(55)) { push('#'); push(k(), true); occurrences++; push(r.pick(['', '.', ','])) }
        else push(r.pick(WORDS))
      }
    }
  }
  if (occurrences === 0) { push('\n\nJistý #'); push(k(), true); push(' štítek.') }
  if (r.chance(80)) push('\n')
  if (r.chance(25)) for (const p of parts) p.text = p.text.replace(/\n/g, '\r\n')
  return { parts, spelling }
}
const join = (parts: Part[], occ?: string) => parts.map((p) => (p.occ && occ !== undefined ? occ : p.text)).join('')
const keysOf = (d: Mod, text: string) => (d.tags(d.parse(text)) as { key: string }[]).map((t) => t.key)

for (const seed of seeds) {
  test(`fr_tag_04_ac11_rename_is_local_and_reversible (seed = ${seed})`, async () => {
    const d = await doc()
    const r = rng(seed)
    console.log(`seed = ${seed}`)
    for (let i = 0; i < runs; i++) {
      const single = r.chance(60)
      const { parts } = gen(r, single)
      const text = join(parts)
      const out = d.transform('Pages/Náhodná.md', text, [{ op: 'rename-tag', key: 'účty', to: 'Výdaje' }])
      const got = out.kind === 'bytes' ? out.text : text
      // (b): exactly the occurrences of K change, to the NFC name K′.
      assert.equal(got, join(parts, 'Výdaje'), `seed ${seed} run ${i}: only K's occurrences change\n${JSON.stringify(text)}`)
      // (d): and back, when K had a single spelling.
      if (single) {
        const spelling = parts.find((p) => p.occ)!.text.normalize('NFC')
        const back = d.transform('Pages/Náhodná.md', got, [{ op: 'rename-tag', key: 'výdaje', to: spelling }])
        const b = back.kind === 'bytes' ? back.text : got
        const original = join(parts, spelling)
        assert.equal(b, original, `seed ${seed} run ${i}: the reverse rename returns the original (NFC) bytes`)
      }
    }
  })

  test(`fr_fmt_07_ac23_rename_then_reverse_is_byte_identical (seed = ${seed})`, async () => {
    const d = await doc()
    const r = rng(seed ^ 0x5a5a)
    for (let i = 0; i < runs; i++) {
      const { parts } = gen(r, true)
      // One NFC spelling, so the round trip must give the very same bytes.
      const spelling = parts.find((p) => p.occ)!.text.normalize('NFC')
      const text = join(parts, spelling)
      const a = d.transform('Pages/N.md', text, [{ op: 'rename-tag', key: 'účty', to: 'Výdaje' }])
      assert.equal(a.kind, 'bytes', `seed ${seed} run ${i}: the rename rewrites`)
      const b = d.transform('Pages/N.md', a.text, [{ op: 'rename-tag', key: 'výdaje', to: spelling }])
      assert.equal(b.kind === 'bytes' ? b.text : a.text, text, `seed ${seed} run ${i}: byte-identical after the reverse`)
    }
  })

  test(`fr_tag_08_ac6_removal_is_local (seed = ${seed})`, async () => {
    const d = await doc()
    const r = rng(seed ^ 0x3c3c)
    for (let i = 0; i < runs; i++) {
      const { parts } = gen(r, false)
      const text = join(parts)
      const before = keysOf(d, text).filter((k) => k !== 'účty')
      const out = d.transform('Pages/Náhodná.md', text, [{ op: 'remove-tag', key: 'účty' }])
      assert.equal(out.kind, 'bytes', `seed ${seed} run ${i}: K occurs, so the file changes`)
      const got = out.text as string
      assert.ok(!keysOf(d, got).includes('účty'), `seed ${seed} run ${i}: no occurrence of K left\n${JSON.stringify(got)}`)
      assert.deepEqual(keysOf(d, got).filter((k) => k !== 'účty'), before, `seed ${seed} run ${i}: the other tags are unchanged`)
      // Outside the edited ranges every byte is unchanged and in order; the edits shrink the text (a removal).
      const bytes = Buffer.from(text), outB = Buffer.from(got)
      const edits = out.edits as { start: number; end: number }[]
      const gaps: Buffer[] = []
      let at = 0
      for (const e of edits) {
        assert.ok(e.start >= at && e.end >= e.start, `seed ${seed} run ${i}: edits in order`)
        gaps.push(bytes.subarray(at, e.start))
        at = e.end
      }
      gaps.push(bytes.subarray(at))
      let pos = 0, inserted = 0
      gaps.forEach((g, gi) => {
        const found = gi === 0 ? (outB.subarray(0, g.length).equals(g) ? 0 : -1) : outB.indexOf(g, pos)
        assert.ok(found >= 0, `seed ${seed} run ${i}: the bytes outside the edits are kept (gap ${gi})\n${JSON.stringify(text)}\n${JSON.stringify(got)}`)
        inserted += found - pos
        pos = found + g.length
      })
      assert.equal(pos, outB.length, `seed ${seed} run ${i}: nothing after the last kept bytes`)
      const removed = edits.reduce((n, e) => n + e.end - e.start, 0)
      assert.ok(inserted < removed, `seed ${seed} run ${i}: the edits remove bytes`)
    }
  })
}
