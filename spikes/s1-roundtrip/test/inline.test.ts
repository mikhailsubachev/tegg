// Obsidian inline syntax survives editing of its block (S1 FINDINGS item 3, done in S2 step 1):
// ==highlight==, %%comment%%, $math$, block IDs ^id, footnote references.
import { describe, expect, test } from 'vitest'
import { editBlock, renderBlock } from '../src/edit.js'
import { tags, wikilinks } from '../src/links.js'
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
  test.each(constructs)('s2_qa_ac2_core_inline_%s_survives_block_edit', (_, line) => {
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

describe('single-dollar math follows Obsidian rules (QA review finding 2)', () => {
  const types = (s: string) => {
    const p = parse(s).blocks[0].node
    return 'children' in p ? p.children.map((c) => c.type) : []
  }

  test('currency amounts are text, so links and tags between them are found', () => {
    const text = 'Paid $5 for [[Lunch]] and $3 #food\n'
    expect(types(text)).not.toContain('inlineMath')
    const doc = parse(text)
    expect(wikilinks(doc).map((l) => l.target)).toEqual(['Lunch'])
    expect(tags(doc).map((t) => t.name)).toEqual(['food'])
  })

  test('math needs non-space after the opening and before the closing $', () => {
    expect(types('a $x$ b')).toContain('inlineMath')
    expect(types('a $ x$ b')).not.toContain('inlineMath')
    expect(types('a $x $ b')).not.toContain('inlineMath')
    expect(types('costs $5-$10')).not.toContain('inlineMath') // closing $ followed by a digit
    expect(types('Euler $e^{i\\pi}+1=0$.')).toContain('inlineMath')
  })

  test('$$ display math in a line still works', () => {
    expect(types('inline $$x^2$$ here')).toContain('inlineMath')
  })
})

describe('literal markers typed as text are escaped (S2 read-back finding)', () => {
  test.each(['a ==b== c', 'x %%y%% z', 'cost $5 and $x$'])('text %s reads back as the same text', (value) => {
    const md = renderBlock({ type: 'paragraph', children: [{ type: 'text', value }] })
    const back = parse(md + '\n').blocks[0].node
    expect('children' in back && back.children.map((c) => c.type)).toEqual(['text'])
    expect('children' in back && (back.children[0] as { value: string }).value).toBe(value)
  })
})

describe('literal $ is escaped and \\$ never closes math (S2 read-back finding)', () => {
  test.each(['$*word$word', 'e book.$[[word$word', 'price $5 and $6'])('text %s reads back as text', (value) => {
    const md = renderBlock({ type: 'paragraph', children: [{ type: 'text', value }] })
    const back = parse(md + '\n').blocks[0].node
    expect('children' in back && back.children.map((c) => c.type)).toEqual(['text'])
    expect('children' in back && (back.children[0] as { value: string }).value).toBe(value)
  })
})
