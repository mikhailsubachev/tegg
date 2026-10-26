// Slice MM2, L2 property at @tegg/doc: docs/acceptance/mindmap.md FR-FMT-07 AC-25, the property part. The random
// mindmap callouts of AC-24 (c) (depth 1–5, 1–40 items, Czech words in NFC and NFD, markers `-`, `*`, `+`, `1.`, `1)`,
// checklist items, 2- and 4-space and tab indents, titles with and without fold markers, CRLF and LF, with and without
// a final newline) gain a random metadata token on the callout line (`spider`, `right`, `foo`, an empty `|`, `SPIDER`,
// or none): parse → serialize is the identity; the token is read as written (`meta`) and `spider` in any case is the
// `spider` layout; a layout switch (`setMindmapLayout`) changes only the callout line, keeps type, fold, title and
// every list line, parses to the chosen layout, and switching back to the stored layout is the identity for the two
// canonical tokens. Interfaces: docs/contracts/mm-mindmap.md §1.2, §6.1. Written from the AC and the contract only
// (D-61). Seeds as the package's other property tests (TS-L2): a fixed seed plus one random seed per run (`QA_SEED`
// when set, else the clock), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100 (nightly) runs 10 seeds × 1,000 cases.
// The package has no fast-check dependency; its property tests use this xorshift generator.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { calloutHead, mindmapTree, parse, serialize, setMindmapLayout } from '../src/index.js'

const FIXED_SEED = 20261026
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`mindmap metadata property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

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

const WORDS = ['Kořen', 'Větev', 'Žluťoučký kůň', 'Příprava', 'Účet', 'Řeka', 'Čtení', 'Dovolená velkého týmu', 'Šňůra', 'Plán', 'ďábel', 'Ústí']
const TOKENS: (string | null)[] = ['spider', 'right', 'foo', '', 'SPIDER', null]
type Case = { text: string; token: string | null; spelling: string; fold: string; title: string | null; crlf: boolean }

function gen(r: R): Case {
  const token = r.pick(TOKENS)
  const spelling = r.pick(['mindmap', 'MindMap', 'MINDMAP', 'Mindmap'])
  const fold = r.pick(['', '+', '-'])
  const title = r.chance(70) ? r.pick(WORDS) : null
  const tab = r.chance(20)
  const marker = tab ? '-' : r.pick(['-', '*', '+', '1.', '1)'])
  const ordered = marker.length === 2
  const wide = r.chance(30)
  const check = !ordered && r.chance(30)
  const nfd = r.chance(30)
  const n = 1 + r.below(40)
  const maxDepth = tab ? 2 : 4
  const depths = [0]
  for (let i = 1; i < n; i++) depths.push(Math.max(0, Math.min(maxDepth, depths[i - 1] + (r.below(6) - 4))))
  const counters: number[] = []
  const lines: string[] = []
  for (const d of depths) {
    counters.length = d + 1
    counters[d] = (counters[d] ?? 0) + 1
    const m = ordered ? `${counters[d]}${marker[1]}` : marker
    const indent = tab ? '\t'.repeat(d) : (wide ? '    ' : '  ').repeat(d)
    const word = r.pick(WORDS)
    lines.push(`${indent}${m} ${check && r.chance(50) ? `[${r.pick(['x', 'X', ' '])}] ` : ''}${nfd ? word.normalize('NFD') : word}`)
  }
  const head = `> [!${spelling}${token === null ? '' : `|${token}`}]${fold}${title ? ` ${title}` : ''}`
  let text = `---\nid: 01JBMM0000000000000000P003\ntype: page\ntitle: Mapa\n---\n${[head, ...lines.map((l) => `> ${l}`)].join('\n')}`
  if (r.chance(50)) text += '\n'
  const crlf = r.chance(30)
  if (crlf) text = text.replace(/\n/g, '\r\n')
  return { text, token, spelling, fold, title, crlf }
}

test('fr_fmt_07_ac25_property_metadata_round_trips_and_a_switch_changes_only_the_callout_line', { timeout: 600_000 }, () => {
  const failures: string[] = []
  for (const seed of SEEDS) {
    const r = rng(seed)
    for (let i = 0; i < RUNS && failures.length < 8; i++) {
      const c = gen(r)
      const tag = `seed ${seed} case ${i} ${JSON.stringify(c.text.slice(0, 120))}`
      // (1) identity
      if (serialize(parse(c.text)) !== c.text) { failures.push(`${tag}: parse → serialize is not the identity`); continue }
      const doc = parse(c.text)
      if (doc.blocks.map((b) => b.kind).join() !== 'mindmap') { failures.push(`${tag}: kinds ${doc.blocks.map((b) => b.kind).join()}`); continue }
      const raw = doc.blocks[0].raw
      // (2) the token as written, the layout from it
      const head = calloutHead(raw)
      const want = { type: c.spelling, fold: c.fold, title: c.title ?? '', meta: c.token }
      if (JSON.stringify(head) !== JSON.stringify(want)) { failures.push(`${tag}: head ${JSON.stringify(head)} ≠ ${JSON.stringify(want)}`); continue }
      const tree = mindmapTree(raw, 'Mapa')
      if (!tree) { failures.push(`${tag}: no tree`); continue }
      const stored = c.token !== null && c.token.toLowerCase() === 'spider' ? 'spider' : 'right'
      if (tree.layout !== stored || tree.meta !== c.token) { failures.push(`${tag}: layout ${tree.layout} / meta ${JSON.stringify(tree.meta)}`); continue }
      // (3) a switch to the other layout changes only the callout line
      const other = stored === 'spider' ? 'right' : 'spider'
      const out = setMindmapLayout(raw, other)
      const nl = c.crlf ? '\r\n' : '\n'
      const a = raw.split(nl)
      const b = out.split(nl)
      if (a.length !== b.length || a.slice(1).join(nl) !== b.slice(1).join(nl)) { failures.push(`${tag}: the switch changed a list line`); continue }
      const h2 = calloutHead(out)
      const want2 = { type: c.spelling, fold: c.fold, title: c.title ?? '', meta: other === 'spider' ? 'spider' : null }
      if (JSON.stringify(h2) !== JSON.stringify(want2)) { failures.push(`${tag}: head after ${other}: ${JSON.stringify(h2)}`); continue }
      const t2 = mindmapTree(out, 'Mapa')
      if (!t2 || t2.layout !== other) { failures.push(`${tag}: layout after the switch ${t2?.layout}`); continue }
      if (JSON.stringify(t2.items) !== JSON.stringify(tree.items)) { failures.push(`${tag}: the items changed with the switch`); continue }
      // (4) the whole file: only the callout line differs
      const full = c.text.replace(raw, () => out)
      if (serialize(parse(full)) !== full) { failures.push(`${tag}: the switched file does not round-trip`); continue }
      // (5) switching to the stored layout is the identity for the canonical tokens
      if ((c.token === null || c.token === 'spider') && setMindmapLayout(raw, stored) !== raw) { failures.push(`${tag}: ${stored} on a ${stored} map is not the identity`); continue }
      // (6) spider then right on a right map returns the original bytes when it had no token (W13)
      if (c.token === null && setMindmapLayout(setMindmapLayout(raw, 'spider'), 'right') !== raw) { failures.push(`${tag}: spider then right ≠ original`); continue }
    }
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`)
})
