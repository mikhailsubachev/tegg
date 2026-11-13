// Regression (slice OL CP-1, D-1628; docs/markdown-dialect.md §2 "Raw (preserved)": comment blocks `%%…%%`): a `%%`
// comment that spans a heading line or a blank line was parsed as separate blocks, so the heading inside it was a
// real heading (shown in the editor, found by `#Heading` links and section embeds). The whole region is one raw
// block, byte for byte (FR-FMT-07, AR-06). An unclosed `%%` hides nothing.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { embedSection, markdownTree, outlineHeadings, parse } from '../src/index.js'

const CASES: [string, string][] = [
  ['heading inside', '# Nahoře\n\n%%\n# Skrytý nadpis\n%%\n\nText.\n'],
  ['blank lines inside', '# Nahoře\n\n%%\nPoznámka\n\n## Uvnitř\n\ndalší řádek\n%%\n\nText.\n'],
  ['closing on a text line', '# Nahoře\n\n%% začátek\n### Uvnitř\nkonec %%\n'],
  ['with frontmatter', '---\ntitle: Okraje\n---\n# Nahoře\n\n%%\n# Skrytý nadpis\n%%\n\nText.\n'],
]

for (const [name, text] of CASES) {
  test(`bug_cp1_fr_edt_11_heading_in_comment_block_${name.replace(/ /g, '_')}`, () => {
    const doc = parse(text)
    assert.equal(doc.text, text, 'round trip: the text is unchanged')
    const kinds = doc.blocks.map((b) => b.kind)
    assert.deepEqual(kinds.filter((k) => k === 'heading').length, 1, `only Nahoře is a heading block: ${kinds.join(', ')}`)
    const comment = doc.blocks.find((b) => b.raw.startsWith('%%'))!
    assert.equal(comment.kind, 'raw', 'the comment region is one raw block')
    assert.ok(comment.raw.trimEnd().endsWith('%%'), 'it runs to the closing %%')
    assert.equal(text.slice(comment.range[0], comment.range[1]), comment.raw, 'its range is its source')
    // Blocks still tile the body in order without overlap.
    for (let i = 1; i < doc.blocks.length; i++) assert.ok(doc.blocks[i].range[0] >= doc.blocks[i - 1].range[1], 'blocks in order')
    assert.deepEqual(outlineHeadings(text).map((h) => h.text), ['Nahoře'])
    const inner = /\n(#+) (\S+)/.exec(text.slice(text.indexOf('%%')))![2]
    assert.equal(embedSection(text, inner).kind, 'missing', `#${inner} doesn't resolve to the comment's heading`)
    assert.ok(!markdownTree(text).children.some((n) => n.type === 'heading' && n.position!.start.offset! > text.indexOf('%%')), 'the read view tree has no heading inside it')
  })
}

test('bug_cp1_fr_edt_11_unclosed_comment_hides_nothing', () => {
  const text = '%% nikdy neuzavřeno\n\n# Viditelný\n\nText.\n'
  const doc = parse(text)
  assert.ok(doc.blocks.some((b) => b.kind === 'heading'), 'an unclosed %% keeps the heading')
  assert.deepEqual(outlineHeadings(text).map((h) => h.text), ['Viditelný'])
})

test('bug_cp1_fr_edt_11_closed_inline_comments_are_untouched', () => {
  const text = 'Věta %%poznámka%% dál.\n\n# Nadpis\n\n%%celý odstavec%%\n'
  const doc = parse(text)
  assert.deepEqual(doc.blocks.map((b) => b.kind), ['paragraph', 'heading', 'raw'])
})
