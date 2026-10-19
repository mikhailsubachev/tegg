// D-590 (inbox.md R60, FR-INB-01 AC-13): the card's simplified Markdown model. Not an AC test (the AC is L5); this
// pins the block model the card renders.
import { describe, expect, it } from 'vitest'
import { cardBlocks } from '../src/index.js'

const FM = '---\ntitle: Q\nreview: unreviewed\n---\n'

describe('cardBlocks', () => {
  it('keeps blocks, breaks, marks, lists and placeholders', () => {
    const body = '## Nákup\nPolotučné **2 litry**\na *rohlíky*\n\n- vejce\n- [x] sýr\n1. chleba\n\nViz [[Plán webu|plán]] a ~~nic~~ a `kód`.\n\n![[foto.png]]\n\n![[Plán webu]]\n\n<b>html</b>\n'
    expect(cardBlocks(FM + body)).toEqual([
      { kind: 'heading', spans: [{ kind: 'text', text: 'Nákup', marks: [] }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Polotučné ', marks: [] }, { kind: 'text', text: '2 litry', marks: ['strong'] }, { kind: 'break' }, { kind: 'text', text: 'a ', marks: [] }, { kind: 'text', text: 'rohlíky', marks: ['em'] }] },
      { kind: 'list', ordered: false, start: 1, items: [{ checked: null, spans: [{ kind: 'text', text: 'vejce', marks: [] }] }, { checked: true, spans: [{ kind: 'text', text: 'sýr', marks: [] }] }] },
      { kind: 'list', ordered: true, start: 1, items: [{ checked: null, spans: [{ kind: 'text', text: 'chleba', marks: [] }] }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'Viz plán a ', marks: [] }, { kind: 'text', text: 'nic', marks: ['strike'] }, { kind: 'text', text: ' a ', marks: [] }, { kind: 'text', text: 'kód', marks: ['code'] }, { kind: 'text', text: '.', marks: [] }] },
      { kind: 'paragraph', spans: [{ kind: 'image' }] },
      { kind: 'paragraph', spans: [{ kind: 'embed', name: 'Plán webu' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: '<b>html</b>', marks: [] }] },
    ])
  })
  it('never shows frontmatter and stops after the limits', () => {
    expect(cardBlocks(FM)).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `Odstavec ${i}.`).join('\n\n')
    expect(cardBlocks(FM + many).length).toBe(12)
  })
  it('code and tables give their first line', () => {
    expect(cardBlocks('```js\nlet a = 1\nlet b = 2\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n')).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'let a = 1', marks: ['code'] }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'A · B', marks: [] }] },
    ])
  })
})
