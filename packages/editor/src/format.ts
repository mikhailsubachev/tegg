// Slice AND-3 (docs/contracts/android-edit.md §4.1; RA15, FR-EDT-02 AC-27, FR-EDT-05 AC-8, FR-EDT-09 AC-7): the
// phone's formatting bar renders from `formatState` on every transaction. A pure function of the editor state.

import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'
import { redoDepth, undoDepth } from '@tiptap/pm/history'
import { chipAtCaret } from './present'
import { isMindmapNode, protectKey } from './protect'

export type FormatState = {
  block: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'checklist' | 'other'
  level: 1 | 2 | 3 | 4 | 5 | 6 | null
  bold: boolean
  italic: boolean
  link: boolean
  canIndent: boolean
  canOutdent: boolean
  canUndo: boolean
  canRedo: boolean
  editable: boolean
}

const OTHER = new Set(['blockquote', 'callout', 'codeBlock', 'table'])

export function formatState(state: EditorState): FormatState {
  const sel = state.selection
  const { $from, from, to, empty } = sel
  const schema = state.schema

  // `block`: the innermost list item's list, else the caret's text block; `other` inside quotes, callouts, code
  // blocks and tables, and on a selected block (a source block, an embed, a query).
  let block: FormatState['block'] = 'other'
  let level: FormatState['level'] = null
  let inItem = false
  if (!(sel instanceof NodeSelection)) {
    let decided = false
    for (let d = $from.depth; d > 0 && !decided; d--) {
      const n = $from.node(d)
      if (n.type.name === 'listItem') {
        const list = $from.node(d - 1).type.name
        block = list === 'orderedList' ? 'orderedList' : n.attrs.checked !== null ? 'checklist' : 'bulletList'
        inItem = true
        decided = true
      } else if (OTHER.has(n.type.name)) {
        decided = true
      }
    }
    if (!decided) {
      const p = $from.parent
      if (p.type.name === 'paragraph') block = 'paragraph'
      else if (p.type.name === 'heading') {
        block = 'heading'
        level = Math.min(6, Math.max(1, Number(p.attrs.level) || 1)) as FormatState['level']
      }
    }
  }

  // `editable`: the caret's top-level block is text (not a source block, an embed, a query, or a protected map).
  const top = state.doc.childCount > 0 ? state.doc.child(Math.min($from.index(0), state.doc.childCount - 1)) : null
  const selected = sel instanceof NodeSelection ? sel.node : null
  const raw = (n: typeof top) => !!n && (n.type.name === 'rawBlock' || (n.isAtom && n.isBlock))
  const editable = !raw(selected) && !raw($from.depth === 0 ? state.doc.nodeAt(from) : top) && !(protectKey.get(state) && isMindmapNode(top))

  const has = (name: string): boolean => {
    const type = schema.marks[name]
    if (!type) return false
    if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks())
    return state.doc.rangeHasMark(from, to, type)
  }
  let chipInRange = false
  if (!empty) state.doc.nodesBetween(from, to, (n) => { if (n.type.name === 'wikiLink' && !n.attrs.embed) chipInRange = true; return !chipInRange })
  const link = has('link') || chipInRange || chipAtCaret(state) !== null

  const itemType = schema.nodes.listItem
  const canIndent = editable && inItem && !!itemType && sinkListItem(itemType)(state)
  const canOutdent = editable && inItem && !!itemType && liftListItem(itemType)(state)

  return {
    block,
    level,
    bold: has('bold'),
    italic: has('italic'),
    link,
    canIndent,
    canOutdent,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    editable,
  }
}
