// Obsidian inline syntax survives editing of its block (S1 FINDINGS item 3, done in S2 step 1):
// ==highlight==, %%comment%%, $math$, block IDs ^id, footnote references.
import { describe, expect, test } from 'vitest'
import { editBlock } from '../src/edit.js'
import { parse } from '../src/parse.js'
import { simulateEdit } from './fixtures.js'

const constructs = [
  ['highlight', 'Some ==highlighted *text*== here'],
  ['inline comment', 'Visible %%hidden [[not a link]] #nottag%% text'],
  ['inline math', 'Euler $e^{i\\pi}+1=0$ and $x_1 * y_2$ here'],
  ['block id', 'A linkable paragraph ^para-1'],
  ['footnote reference', 'Claim with a footnote[^1] here'],
  ['wikilink and tag', 'See [[Note|alias]] and ![[img.png|400]] with #tag'],
  ['inline html', 'Line with a<br>break and <kbd>Ctrl</kbd>'],
] as const

describe('Obsidian inline syntax survives editing', () => {
  test.each(constructs)('fr_fmt_07_ac3_inline_%s_survives_block_edit', (_, line) => {
    const text = `${line}\n\n[^1]: Footnote.\n`
    const doc = parse(text)
    const md = simulateEdit(doc.blocks[0].node, doc.blocks[0].raw)!
    const out = editBlock(doc, 0, md)
    // The original line is kept verbatim; only the typed text is added at the end.
    expect(out).toBe(text.replace(line, `${line} edited`))
  })

  test('highlight, comment and math are syntax nodes, not text', () => {
    const types = (s: string) => {
      const p = parse(s).blocks[0].node
      return 'children' in p ? p.children.map((c) => c.type) : []
    }
    expect(types('a ==b== c')).toEqual(['text', 'highlight', 'text'])
    expect(types('a %%b%% c')).toEqual(['text', 'comment', 'text'])
    expect(types('a $b$ c')).toEqual(['text', 'inlineMath', 'text'])
  })

  test('multi-line %% comment and $$ display math stay raw blocks', () => {
    const doc = parse('%% one\ntwo %%\n\n$$\nx\n$$\n')
    expect(doc.blocks.map((b) => b.kind)).toEqual(['raw', 'raw'])
  })

  test('a single = or % is plain text', () => {
    const p = parse('a = b and 50% of =x= stays text\n').blocks[0].node
    expect('children' in p && p.children.map((c) => c.type)).toEqual(['text'])
  })
})
