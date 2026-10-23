// MS4 slice 4C, L2 property test: docs/acceptance/rename.md FR-LNK-03 AC-20 "Rewrite is local". For random Markdown
// documents and random (old, new) targets, `rewriteLinks` (docs/contracts/ms4-jobs.md §2.3) changes only bytes inside
// the link nodes it reports (outside the reported edits the output equals the input), and applying it twice equals
// once. Each generated document holds at least one link that resolves to the old target outside code, so the edits
// are also checked to cover exactly those links (one edit per rewritten link, AC-7).
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 documents. Every seed is printed (`seed = N`); a failing
// document becomes a fixture. Synthetic Czech text (D-50). Written from the AC and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { rewriteLinks, type TextOp } from '../src/index.js'

const FIXED_SEED = 20261017
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const runs = scale >= 100 ? 1000 : 100
// D-749: at scale ≥ 100 the 10 seeds outrun Vitest's 5 s default.
const timeout = scale >= 100 ? 600_000 : 5_000

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

const STEMS = ['Alfa', 'Čaj o páté', 'Řeka', 'Žluťoučký kůň', 'Beta', 'Q3 plan budget', 'Úvod']
const nfd = (s: string) => s.normalize('NFD')

/** A random document from `src` (folder `Pages/`) with links to `old` and others, code, frontmatter, CRLF/LF. */
function gen(r: R, old: string): { text: string; targets: number } {
  const other = STEMS.filter((s) => s !== old)
  const words = ['Text', 'odstavec', 'ěščřžýáíé', 'konec', 'a', 'viz']
  let targets = 0
  const link = (): string => {
    const toOld = r.chance(50)
    const s = toOld ? (r.chance(20) ? nfd(old) : r.chance(20) ? old.toLowerCase() : old) : r.pick(other)
    const forms = [
      `[[${s}]]`, `[[${s}|jiný text]]`, `[[${s}#Nadpis]]`, `[[${s}#^b1]]`, `![[${s}]]`, `[[Pages/${s}]]`, `[[${s}.md]]`,
      `[popis](${s.replace(/ /g, '%20')}.md)`,
    ]
    if (toOld) targets++
    return r.pick(forms)
  }
  const para = () => Array.from({ length: 1 + r.below(5) }, () => (r.chance(40) ? link() : r.pick(words))).join(' ')
  const blocks: string[] = []
  for (let i = 0, n = 1 + r.below(6); i < n; i++) {
    const k = r.below(6)
    if (k === 0) blocks.push(`## ${para()}`)
    else if (k === 1) blocks.push(`- ${para()}\n- ${para()}`)
    else if (k === 2) blocks.push('```\n[[' + old + ']]\n```')
    else if (k === 3) blocks.push('Kód: `[[' + old + ']]` a dál.')
    else blocks.push(para())
  }
  // Always at least one link to `old` outside code.
  blocks.push(`Jistý odkaz [[${old}]].`)
  targets++
  const fm = r.chance(60) ? `---\nid: 01JB4C0000000000000000P001\ntitle: Zdroj\nvztah: "[[${r.chance(50) ? old : r.pick(other)}]]"\n---\n` : ''
  if (fm.includes(`[[${old}]]`)) targets++
  let text = fm + blocks.join('\n\n') + (r.chance(80) ? '\n' : '')
  if (r.chance(20)) text = text.replace(/\n/g, '\r\n')
  return { text, targets }
}

function op(old: string, neu: string): Extract<TextOp, { op: 'retarget-links' }> {
  return {
    op: 'retarget-links', fromPath: `Pages/${old}.md`, fromStem: old, fromTitle: old, toPath: `Pages/${neu}.md`, toStem: neu, toTitle: neu,
    paths: STEMS.map((s) => `Pages/${s}.md`).concat(['Pages/Zdroj.md']),
  }
}

const norm = (s: string) => s.normalize('NFC').toLowerCase()
const decoded = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** Output = in[0..s1] + X1 + in[e1..s2] + X2 + … + in[en..], and every replaced input piece is part of a link to `old`. */
function outsideEqual(inB: Buffer, outB: Buffer, edits: { start: number; end: number }[], old: string): boolean {
  const es = [...edits].sort((a, b) => a.start - b.start)
  let pos = 0, at = 0
  for (let i = 0; i < es.length; i++) {
    const e = es[i]
    if (e.start < at || e.end < e.start || e.end > inB.length) return false
    const piece = inB.subarray(e.start, e.end).toString('utf8')
    if (!norm(piece).includes(norm(old)) && !norm(decoded(piece)).includes(norm(old))) return false
    const seg = inB.subarray(at, e.start)
    if (!outB.subarray(pos, pos + seg.length).equals(seg)) return false
    pos += seg.length
    const next = inB.subarray(e.end, es[i + 1]?.start ?? inB.length)
    if (i === es.length - 1) return outB.length - next.length >= pos && outB.subarray(outB.length - next.length).equals(next)
    if (next.length > 0) {
      const j = outB.indexOf(next, pos)
      if (j < 0) return false
      pos = j
    }
    at = e.end
  }
  return inB.equals(outB)
}

test('fr_lnk_03_ac20_rewrite_is_local_and_idempotent', { timeout }, () => {
  const problems: string[] = []
  for (const seed of seeds) {
    console.log(`FR-LNK-03 AC-20 seed = ${seed}`)
    const r = rng(seed)
    for (let i = 0; i < runs && problems.length < 10; i++) {
      const old = r.pick(STEMS)
      const neu = r.pick(['Gama', 'Nový název', 'Šťastná řeka', 'Delta (2)'])
      const { text, targets } = gen(r, old)
      const o = op(old, neu)
      const once = rewriteLinks('Pages/Zdroj.md', text, o)
      if (once.kind !== 'bytes') { problems.push(`seed = ${seed} #${i}: nothing rewritten in ${JSON.stringify(text)}`); continue }
      if (once.edits.length !== targets) problems.push(`seed = ${seed} #${i}: ${once.edits.length} edits for ${targets} links to ${old}`)
      // Outside the reported edits, the output equals the input (byte offsets, UTF-8), and each edit lies on a link.
      if (!outsideEqual(Buffer.from(text, 'utf8'), Buffer.from(once.text, 'utf8'), once.edits, old)) {
        problems.push(`seed = ${seed} #${i}: bytes outside the reported link edits changed: ${JSON.stringify(text)} → ${JSON.stringify(once.text)}`)
      }
      const twice = rewriteLinks('Pages/Zdroj.md', once.text, o)
      if (twice.kind !== 'unchanged' && twice.text !== once.text) problems.push(`seed = ${seed} #${i}: applying twice differs from once`)
    }
  }
  assert.deepEqual(problems, [], 'rewriteLinks changes only the link bytes it reports, rewrites every link to the old target, and is idempotent')
})
