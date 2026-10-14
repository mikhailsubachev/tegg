// The editing operations of the S2 property test, ported for FR-FMT-07 AC-10/AC-11 (ms3-shell §13.3, D-83).
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { TeggEditor } from './editor'

const posOf = (doc: PMNode, k: number) => {
  let p = 0
  for (let i = 0; i < k; i++) p += doc.child(i).nodeSize
  return p
}
const isText = (doc: PMNode, k: number) => doc.child(k).type.name === 'paragraph' && doc.child(k).content.size > 1

function endOfBlock(doc: PMNode, k: number): number | null {
  const start = posOf(doc, k)
  const node = doc.child(k)
  let pos: number | null = null
  node.descendants((n, p) => {
    if (n.isTextblock) pos = start + 1 + p + n.nodeSize - 1
    return true
  })
  if (node.isTextblock) pos = start + node.nodeSize - 1
  return pos
}

type Op = (ed: TeggEditor, k: number) => boolean

const OPS: Record<string, Op> = {
  type: (ed, k) => {
    const doc = ed.view.state.doc
    const pos = endOfBlock(doc, k)
    if (pos === null || doc.child(k).type.name === 'rawBlock') return false
    ed.editor.chain().setTextSelection(pos).insertContent(' edited').run()
    return true
  },
  insertAfter: (ed, k) => {
    ed.editor.chain().insertContentAt(posOf(ed.view.state.doc, k + 1), { type: 'paragraph', content: [{ type: 'text', text: 'New block' }] }).run()
    return true
  },
  insertBefore: (ed, k) => {
    ed.editor.chain().insertContentAt(posOf(ed.view.state.doc, k), { type: 'paragraph', content: [{ type: 'text', text: 'New block' }] }).run()
    return true
  },
  delete: (ed, k) => {
    const doc = ed.view.state.doc
    if (doc.childCount < 2) return false
    ed.view.dispatch(ed.view.state.tr.delete(posOf(doc, k), posOf(doc, k + 1)))
    return true
  },
  split: (ed, k) => {
    const doc = ed.view.state.doc
    if (!isText(doc, k)) return false
    const mid = posOf(doc, k) + 1 + Math.floor(doc.child(k).content.size / 2)
    return ed.editor.chain().setTextSelection(mid).splitBlock().run()
  },
  joinWithNext: (ed, k) => {
    const doc = ed.view.state.doc
    if (k + 1 >= doc.childCount || !isText(doc, k) || !isText(doc, k + 1)) return false
    return ed.editor.chain().setTextSelection(posOf(doc, k + 1) + 1).joinBackward().run()
  },
  toBulletList: (ed, k) => {
    const doc = ed.view.state.doc
    if (!isText(doc, k)) return false
    return ed.editor.chain().setTextSelection(posOf(doc, k) + 1).toggleBulletList().run()
  },
  toHeading: (ed, k) => {
    const doc = ed.view.state.doc
    if (!isText(doc, k)) return false
    return ed.editor.chain().setTextSelection(posOf(doc, k) + 1).setHeading({ level: 2 }).run()
  },
  toQuote: (ed, k) => {
    const doc = ed.view.state.doc
    if (!isText(doc, k)) return false
    return ed.editor.chain().setTextSelection(posOf(doc, k) + 1).toggleBlockquote().run()
  },
  moveUp: (ed, k) => {
    if (k === 0) return false
    caretTo(ed, k)
    return ed.commands.moveBlock('up')
  },
  moveDown: (ed, k) => {
    if (k + 1 >= ed.view.state.doc.childCount) return false
    caretTo(ed, k)
    return ed.commands.moveBlock('down')
  },
}

function caretTo(ed: TeggEditor, k: number) {
  const doc = ed.view.state.doc
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(doc.resolve(posOf(doc, k) + (doc.child(k).isLeaf ? 0 : 1)))))
}

export const OPERATIONS: readonly string[] = Object.keys(OPS)

export function applyOperation(ed: TeggEditor, op: string, block: number): boolean {
  const f = OPS[op]
  if (!f || block >= ed.view.state.doc.childCount) return false
  try {
    return f(ed, block)
  } catch {
    return false
  }
}
