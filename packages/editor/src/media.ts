// Slice 6A (docs/contracts/ms6-trash-media.md §6.1; FR-ATT-01 AC-1…AC-3, AC-8): media paragraphs in the editor.
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Inserts one paragraph `![[<embed>]]` per item at `pos` (default: after the caret's block) as one transaction (one
 *  undo step); the caret goes after the last one. An empty paragraph at the insertion point is replaced. Returns
 *  whether anything was inserted. */
export function insertEmbeds(view: EditorView, embeds: string[], pos?: number): boolean {
  const values = embeds.map((e) => e.replace(/^!?\[\[|\]\]$/g, '').normalize('NFC')).filter((v) => v !== '')
  if (values.length === 0) return false
  const { state } = view
  const raw = state.schema.nodes.rawBlock
  if (!raw) return false
  const nodes = values.map((v) => raw.create({ source: `![[${v}]]`, kind: 'embed' }))
  const doc = state.doc
  const $p = doc.resolve(Math.max(0, Math.min(pos ?? state.selection.from, doc.content.size)))
  const k = $p.depth === 0 ? Math.min($p.index(0), doc.childCount - 1) : $p.index(0)
  let at = 0
  for (let i = 0; i < k; i++) at += doc.child(i).nodeSize
  const node = doc.child(k)
  const tr = state.tr
  let start: number
  if (node && node.type.name === 'paragraph' && node.content.size === 0) {
    tr.replaceWith(at, at + node.nodeSize, nodes)
    start = at
  } else {
    // A drop or paste in the top half of a block goes before it, else after it.
    const before = pos !== undefined && $p.depth === 0 && $p.index(0) === k && pos === at
    start = before ? at : at + (node?.nodeSize ?? 0)
    tr.insert(start, nodes)
  }
  const end = start + nodes.reduce((n, x) => n + x.nodeSize, 0)
  tr.setSelection(end < tr.doc.content.size ? TextSelection.near(tr.doc.resolve(end)) : NodeSelection.create(tr.doc, end - nodes[nodes.length - 1].nodeSize))
  view.dispatch(tr.scrollIntoView())
  return true
}
