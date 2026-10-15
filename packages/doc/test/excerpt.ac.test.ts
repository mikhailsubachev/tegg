// MS4 slice 4A, L1: excerpt building in @tegg/doc, the TypeScript side of the TS/Rust pair. FR-LNK-01 AC-4 (D-277).
// docs/acceptance/backlinks.md; interface docs/contracts/ms4-links.md §2.1 (`extract()` link records gain `at` and
// `block`, the result gains `blocks`), §2.2 (`excerptWindow`). The expectations are the shared corpus
// tests/fixtures/format/excerpt/cases.json, also read by crates/tegg-format/tests/ac_excerpt.rs (one expectation for
// both engines). Written from the ACs and the contract only (D-61). The module is imported inside each test and
// every check is node:assert, so a missing export fails an assertion (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const corpus = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/format/excerpt/cases.json'), 'utf8')) as {
  cases: { name: string; markdown: string; stem: string; links: { target: string | null; at: { line: number; byte: number }; block: number | null; embed?: boolean }[]; blocks: unknown[] }[]
  windows: { name: string; rendered: unknown[]; here: number[]; max: number; before: number; expected: unknown }[]
}
const nfc = (s: string) => s.normalize('NFC')

async function doc(): Promise<any> {
  const m: any = await import('../src/index.js')
  assert.equal(typeof m.extract, 'function', '@tegg/doc exports extract')
  return m
}

test('fr_lnk_01_ac4_ts_blocks_match_the_shared_corpus', async () => {
  const m = await doc()
  assert.ok(corpus.cases.length > 0, 'setup: the corpus has cases')
  const bad: string[] = []
  for (const c of corpus.cases) {
    const x = m.extract(c.markdown, c.stem)
    try {
      assert.deepEqual(x.blocks, c.blocks)
    } catch {
      bad.push(`${c.name}:\n  want ${JSON.stringify(c.blocks)}\n  got  ${JSON.stringify(x.blocks)}`)
    }
  }
  assert.deepEqual(bad, [], `extract().blocks differs from the corpus in ${bad.length} case(s)`)
})

test('fr_lnk_01_ac4_ts_link_positions_match_the_shared_corpus', async () => {
  const m = await doc()
  const bad: string[] = []
  for (const c of corpus.cases) {
    const links = m.extract(c.markdown, c.stem).links as any[]
    if (links.length !== c.links.length) {
      bad.push(`${c.name}: ${links.length} link records, want ${c.links.length}: ${JSON.stringify(links)}`)
      continue
    }
    c.links.forEach((w, i) => {
      const l = links[i]
      if (JSON.stringify(l.at) !== JSON.stringify(w.at) || l.block !== w.block) bad.push(`${c.name} link ${i}: want at ${JSON.stringify(w.at)} block ${w.block}; got at ${JSON.stringify(l.at)} block ${l.block}`)
      if (w.target !== null && nfc(String(l.target)) !== nfc(w.target)) bad.push(`${c.name} link ${i}: target ${l.target}, want ${w.target}`)
      if (w.embed !== undefined && l.embed !== w.embed) bad.push(`${c.name} link ${i}: embed ${l.embed}, want ${w.embed}`)
    })
  }
  assert.deepEqual(bad, [], 'link positions differ from the corpus')
})

test('fr_lnk_01_ac4_ts_excerpt_window_matches_the_shared_corpus', async () => {
  const m = await doc()
  assert.equal(typeof m.excerptWindow, 'function', '@tegg/doc exports excerptWindow (ms4-links §2.2)')
  for (const w of corpus.windows) {
    assert.deepEqual(m.excerptWindow(w.rendered, w.here, w.max, w.before), w.expected, w.name)
  }
})

test('fr_lnk_01_ac4_ts_fixture_odkazy_v_textu_has_five_link_blocks', async () => {
  // Odkazy v textu (backlinks README): blocks 1–5 hold the five occurrences of Cíl; code span, math, comment and
  // fence hold none (dialect §5).
  const m = await doc()
  const text = readFileSync(resolve(REPO, 'tests/fixtures/vaults/backlinks/Pages/Odkazy v textu.md'), 'utf8')
  const x = m.extract(text, 'Odkazy v textu')
  assert.ok(Array.isArray(x.blocks), 'extract() returns blocks')
  assert.deepEqual(x.blocks.map((b: any) => b.kind), ['paragraph', 'listItem', 'heading', 'tableRow', 'paragraph'])
  assert.deepEqual((x.links as any[]).map((l) => l.block), [0, 0, 1, 2, 3, 4], 'six links in five blocks, none in code, math, comments or the fence')
  assert.deepEqual((x.links as any[]).map((l) => l.at.line), [8, 8, 10, 13, 17, 19], 'lines of the links in the file')
})
