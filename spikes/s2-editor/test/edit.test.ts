// FR-FMT-07 AC-3 and FR-EDT-01/-13 through the real editor: every editing operation on every
// block of every fixture. Untouched source blocks must stay byte-identical and in order.
import { describe, expect, test } from 'vitest'
import type { Editor } from '@tiptap/core'
import { tags, wikilinks } from '@core/links'
import { parse, type Doc } from '@core/parse'
import { reconcile } from '../src/sourceDoc'
import { endOfBlock, expectPreserved, fixtures, open } from './helpers'

type Op = (editor: Editor, k: number) => { touched: number[]; deleted?: number[]; added?: number } | null

const posOf = (editor: Editor, k: number) => {
  let p = 0
  for (let i = 0; i < k; i++) p += editor.state.doc.child(i).nodeSize
  return p
}
const isText = (editor: Editor, k: number) => editor.state.doc.child(k).type.name === 'paragraph' && editor.state.doc.child(k).content.size > 1
const src = (editor: Editor, k: number) => editor.state.doc.child(k).attrs.srcIndex as number

const ops: Record<string, Op> = {
  type: (e, k) => {
    const pos = endOfBlock(e, k)
    if (pos === null || e.state.doc.child(k).type.name === 'rawBlock') return null
    e.chain().setTextSelection(pos).insertContent(' edited').run()
    return { touched: [src(e, k)] }
  },
  insertAfter: (e, k) => {
    e.chain().insertContentAt(posOf(e, k + 1), { type: 'paragraph', content: [{ type: 'text', text: 'New block' }] }).run()
    return { touched: [], added: 1 }
  },
  delete: (e, k) => {
    const s = src(e, k)
    e.chain().command(({ tr }) => { tr.delete(posOf(e, k), posOf(e, k + 1)); return true }).run()
    return { touched: [], deleted: [s] }
  },
  split: (e, k) => {
    if (!isText(e, k)) return null
    const mid = posOf(e, k) + 1 + Math.floor(e.state.doc.child(k).content.size / 2)
    const s = src(e, k)
    if (!e.chain().setTextSelection(mid).splitBlock().run()) return null
    return { touched: [s], added: 1 }
  },
  joinWithNext: (e, k) => {
    if (k + 1 >= e.state.doc.childCount || !isText(e, k) || !isText(e, k + 1)) return null
    const a = src(e, k)
    const b = src(e, k + 1)
    if (!e.chain().setTextSelection(posOf(e, k + 1) + 1).joinBackward().run()) return null
    return { touched: [a], deleted: [b] }
  },
  toBulletList: (e, k) => {
    if (!isText(e, k)) return null
    const s = src(e, k)
    return e.chain().setTextSelection(posOf(e, k) + 1).toggleBulletList().run() ? { touched: [s] } : null
  },
  toHeading: (e, k) => {
    if (!isText(e, k)) return null
    const s = src(e, k)
    return e.chain().setTextSelection(posOf(e, k) + 1).setHeading({ level: 2 }).run() ? { touched: [s] } : null
  },
  toQuote: (e, k) => {
    if (!isText(e, k)) return null
    const s = src(e, k)
    return e.chain().setTextSelection(posOf(e, k) + 1).toggleBlockquote().run() ? { touched: [s] } : null
  },
  moveDown: (e, k) => {
    if (k + 1 >= e.state.doc.childCount) return null
    const node = e.state.doc.child(k)
    const from = posOf(e, k)
    const afterNext = posOf(e, k + 2)
    e.chain().command(({ tr }) => {
      tr.insert(afterNext, node)
      tr.delete(from, from + node.nodeSize)
      return true
    }).run()
    return { touched: [] } // moved, not edited: both blocks must keep their bytes
  },
}

let markerOnly = 0

const cases = fixtures.flatMap((f) => {
  const n = open(f.text).editor.state.doc.childCount
  return Object.keys(ops).flatMap((op) => Array.from({ length: n }, (_, k) => [`${op} ${f.rel} #${k}`, op, f, k] as const))
})

describe('editor operations keep untouched blocks byte-identical', () => {
  test.each(cases)('fr_fmt_07_ac3_fr_edt_01_%s', (ctx, opName, f, k) => {
    const s = open(f.text)
    if (s.loaded.doc.blocks.length === 0) return
    const r = ops[opName](s.editor, k)
    if (!r) return
    const out = reconcile(s.loaded, s.editor.state.doc).text
    markerOnly += expectPreserved(s, out, ctx)
    if (opName === 'type') {
      // Typing changes only that block's bytes, and keeps every link and tag (S1 F1/F2).
      const b = s.loaded.doc.blocks[r.touched[0]]
      expect(out.slice(0, b.range[0])).toBe(f.text.slice(0, b.range[0]))
      expect(out.slice(out.length - (f.text.length - b.range[1]))).toBe(f.text.slice(b.range[1]))
      const sig = (d: Doc) => wikilinks(d).map((l) => [l.embed, l.target, l.subpath, l.alias])
      expect(sig(parse(out))).toEqual(sig(s.loaded.doc))
      expect(tags(parse(out)).map((t) => t.name)).toEqual(tags(s.loaded.doc).map((t) => t.name))
    }
  })
})

describe('list separation and multi-block operations', () => {
  test('fr_fmt_07_deleting_the_block_between_two_lists_keeps_them_two_lists', () => {
    const text = '- a\n- b\n\nBetween.\n\n- c\n- d\n'
    const s = open(text)
    s.editor.chain().command(({ tr }) => { tr.delete(posOf(s.editor, 1), posOf(s.editor, 2)); return true }).run()
    const out = s.save()
    expect(out).toBe('- a\n- b\n\n* c\n* d\n') // only the second list's markers changed
    expect(parse(out).blocks.length).toBe(2)
  })

  test('fr_edt_13_multi_block_selection_delete', () => {
    const text = 'One.\n\nTwo.\n\nThree.\n\nFour.\n'
    const s = open(text)
    s.editor.chain().command(({ tr }) => { tr.delete(posOf(s.editor, 1), posOf(s.editor, 3)); return true }).run()
    expect(s.save()).toBe('One.\n\nFour.\n')
  })

  test('fr_edt_13_multi_block_move_keeps_bytes', () => {
    const text = '# A\n\n*keep* _this_   \nstyle.\n\n* star list\n\nLast.\n'
    const s = open(text)
    const e = s.editor
    const slice = e.state.doc.slice(posOf(e, 1), posOf(e, 3))
    e.chain().command(({ tr }) => {
      tr.insert(posOf(e, 4), slice.content)
      tr.delete(posOf(e, 1), posOf(e, 3))
      return true
    }).run()
    // Moved blocks keep their exact bytes, including `_this_`, trailing spaces and `*` marker.
    expect(s.save()).toBe('# A\n\nLast.\n\n*keep* _this_   \nstyle.\n\n* star list\n')
  })

  test('report: list-marker separations needed across all fixture operations', () => {
    console.log(`blocks re-marked to keep adjacent lists apart: ${markerOnly}`)
  })
})

describe('indented block after a list', () => {
  test('fr_fmt_07_moving_indented_code_below_a_list_inserts_end_list_comment', () => {
    const text = '- item\n\nPara.\n\n    indented code\n'
    const s = open(text)
    const e = s.editor
    e.chain().command(({ tr }) => { tr.delete(posOf(e, 1), posOf(e, 2)); return true }).run() // delete "Para."
    const out = s.save()
    expect(out).toBe('- item\n\n<!-- -->\n\n    indented code\n')
    expect(parse(out).blocks.map((b) => b.kind)).toEqual(['list', 'raw', 'raw'])
  })
})
