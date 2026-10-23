// Property test (FR-FMT-07 AC-3/AC-5): random edit sequences on random fixtures.
// After every edit: the file re-parses, untouched blocks/attributes are byte-identical,
// block structure is unchanged, and the edited value reads back exactly.
import fc from 'fast-check'
import { expect, test } from 'vitest'
import type { Nodes, RootContent } from 'mdast'
import { editBlock, renderBlock, setAttribute, type Value } from '../src/edit.js'
import { parse } from '../src/parse.js'
import { fixtures } from './fixtures.js'

// Text with Markdown/YAML-significant characters, diacritics, emoji and a zero-width space.
const tricky = fc
  .array(
    fc.constantFrom(
      'a', 'Z', ' ', 'č', 'ř', 'Ž', '🙂', '​', '*', '_', '#', '-', '+', '1.', '>', '[[', ']]', '|',
      '`', '~', '=', '$', '%', ':', '"', "'", '\\', '<b>', '&amp;', '!', '[', ']', '(', ')', '@', '^',
    ),
    { minLength: 1, maxLength: 12 },
  )
  .map((a) => a.join('').trim() || 'x')

const value: fc.Arbitrary<{ v: Value; js: unknown }> = fc.oneof(
  tricky.map((s) => ({ v: s, js: s.normalize('NFC') })),
  fc.integer({ min: -1e6, max: 1e6 }).map((n) => ({ v: n, js: n })),
  fc.boolean().map((b) => ({ v: b, js: b })),
  fc.date({ min: new Date('1990-01-01'), max: new Date('2090-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10))
    .map((d) => ({ v: { date: d }, js: d })),
  fc.constantFrom('Jana', 'Tomáš', 'Q3 plan budget').map((n) => ({ v: { link: n }, js: `[[${n}]]` })),
  fc.array(tricky, { minLength: 1, maxLength: 3 }).map((a) => ({ v: a, js: a.map((s) => s.normalize('NFC')) })),
)

type Op = { kind: 'block'; pick: number; text: string } | { kind: 'attr'; key: string; value: { v: Value; js: unknown } }

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('block' as const), pick: fc.nat(), text: tricky }),
  fc.record({ kind: fc.constant('attr' as const), key: fc.constantFrom('status', 'rating', 'title', 'tags', 'x-new'), value }),
)

function withText(node: RootContent, text: string): RootContent | null {
  const clone = structuredClone(node) as Nodes
  let done = false
  const visit = (n: Nodes): void => {
    if (done) return
    if (n.type === 'text' || n.type === 'code' || n.type === 'inlineCode') {
      n.value = text
      done = true
      return
    }
    if ('children' in n) for (const c of n.children) visit(c as Nodes)
  }
  visit(clone)
  return done ? (clone as RootContent) : null
}

test('fr_fmt_07_property_random_edits_touch_only_their_range', () => {
  const editable = fixtures.filter((f) => !parse(f.text).frontmatter?.error)
  const counts = { block: 0, attr: 0 }
  fc.assert(
    fc.property(fc.nat({ max: editable.length - 1 }), fc.array(op, { minLength: 1, maxLength: 5 }), (fi, ops) => {
      let text = editable[fi].text
      for (const o of ops) {
        const doc = parse(text)
        if (o.kind === 'block') {
          const candidates = doc.blocks.map((b, i) => i).filter((i) => doc.blocks[i].kind !== 'raw')
          if (candidates.length === 0) continue
          const k = candidates[o.pick % candidates.length]
          const node = withText(doc.blocks[k].node, o.text)
          if (!node) continue
          const out = editBlock(doc, k, renderBlock(node, doc.blocks[k].raw))
          const after = parse(out)
          const [s, e] = doc.blocks[k].range
          expect(out.slice(0, s)).toBe(text.slice(0, s))
          expect(out.slice(out.length - (text.length - e))).toBe(text.slice(e))
          expect(after.blocks.length).toBe(doc.blocks.length)
          after.blocks.forEach((b, i) => i !== k && expect(b.raw).toBe(doc.blocks[i].raw))
          expect(after.frontmatter?.data ?? null).toEqual(doc.frontmatter?.data ?? null)
          counts.block++
          text = out
        } else {
          const out = setAttribute(doc, o.key, o.value.v)
          const after = parse(out)
          expect(after.frontmatter?.error ?? null).toBeNull()
          expect(after.frontmatter!.data![o.key]).toEqual(o.value.js)
          for (const [k, v] of Object.entries(doc.frontmatter?.data ?? {})) if (k !== o.key) expect(after.frontmatter!.data![k]).toEqual(v)
          expect(after.blocks.map((b) => b.raw)).toEqual(doc.blocks.map((b) => b.raw))
          counts.attr++
          text = out
        }
      }
    }),
    { numRuns: 1000, seed: Number(process.env.TEGG_SEED ?? 20261008) },
  )
  // Guard against a vacuous pass: the runs must really have edited blocks and attributes.
  expect(counts.block).toBeGreaterThan(500)
  expect(counts.attr).toBeGreaterThan(500)
}, 30_000) // 1,000 runs: near vitest's 5 s default when the push gate's Rust lanes run beside it
