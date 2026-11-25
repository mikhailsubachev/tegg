// Slice MM3 (docs/contracts/mm-mindmap.md §7.3; D-2482, D-2497, D-2517): the folds of the open note's mindmaps, view
// state in a plugin: never part of the document, the saved bytes or the history. A fold belongs to its list item and
// follows it through every transaction (⌥ moves, drops, undo and redo): the item is found again by identity (a moved
// item is the same node), else by mapping its position; a fold whose item is gone is dropped. The synthesized root's
// fold belongs to the callout. A new editor state (an external reload, a new editor) starts with none.
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** `items`: positions of folded list items; `roots`: positions of mindmap callouts whose synthesized root is folded. */
export type FoldState = { items: number[]; roots: number[]; version: number }
type Meta = { set: { pos: number; root: boolean; folded: boolean } } | { clear: { from: number; to: number } }

export const foldKey = new PluginKey<FoldState>('teggMindmapFolds')
const EMPTY: FoldState = { items: [], roots: [], version: 0 }

const isList = (n: PMNode) => /List$/.test(n.type.name)
const isMindmapCallout = (n: PMNode | null | undefined) => !!n && n.type.name === 'callout' && String(n.attrs.calloutType).toLowerCase() === 'mindmap'

/** Each list item of a mindmap callout at `base` with its tree path (D-774: an item's children come from every list
 *  directly inside it; the top level is the callout's list). */
export function itemPaths(callout: PMNode, base: number): Map<number, number[]> {
  const out = new Map<number, number[]>()
  if (callout.childCount < 2 || !isList(callout.child(1))) return out
  const walk = (list: PMNode, pos: number, prefix: number[], offset: number) => {
    let p = pos + 1
    list.forEach((item, _o, i) => {
      const path = [...prefix, offset + i]
      out.set(p, path)
      let cp = p + 1
      let k = 0
      item.forEach((c) => { if (isList(c)) { walk(c, cp, path, k); k += c.childCount } cp += c.nodeSize })
      p += item.nodeSize
    })
  }
  walk(callout.child(1), base + 1 + callout.child(0).nodeSize, [], 0)
  return out
}
/** Whether a list item has children (items in lists directly inside it). */
export function hasChildren(item: PMNode): boolean {
  let n = false
  item.forEach((c) => { if (isList(c) && c.childCount > 0) n = true })
  return n
}

function mapState(v: FoldState, tr: Transaction): FoldState {
  const before = tr.before
  const doc = tr.doc
  const items: number[] = []
  let dropped = false
  for (const pos of v.items) {
    const old = before.nodeAt(pos)
    let found: number | null = null
    if (old && pos > 0) {
      const $p = before.resolve(pos)
      const calloutPos = $p.depth >= 1 ? $p.before(1) : -1
      const np = calloutPos >= 0 ? tr.mapping.map(calloutPos, 1) : -1
      const callout = np >= 0 ? doc.nodeAt(np) : null
      // The item itself (unchanged, maybe moved) inside its mindmap.
      if (isMindmapCallout(callout)) {
        callout!.descendants((n, p) => {
          if (found !== null) return false
          if (n === old) { found = np + 1 + p; return false }
          return true
        })
      }
      if (found === null) {
        const r = tr.mapping.mapResult(pos, 1)
        if (!r.deleted && doc.nodeAt(r.pos)?.type === old.type) found = r.pos
      }
    }
    if (found === null) dropped = true
    else if (!items.includes(found)) items.push(found)
  }
  const roots: number[] = []
  for (const pos of v.roots) {
    const r = tr.mapping.mapResult(pos, 1)
    if (!r.deleted && isMindmapCallout(doc.nodeAt(r.pos))) roots.push(r.pos)
    else dropped = true
  }
  items.sort((a, b) => a - b)
  return { items, roots, version: dropped ? v.version + 1 : v.version }
}

/** The plugin; `changed` is called after a fold was set or cleared (or dropped), so the maps draw again. */
export function foldPlugin(changed: (view: EditorView) => void): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: foldKey,
    state: {
      init: () => EMPTY,
      apply(tr, v) {
        let s = v
        if (tr.docChanged && (s.items.length || s.roots.length)) s = mapState(s, tr)
        const meta = tr.getMeta(foldKey) as Meta | undefined
        if (meta && 'set' in meta) {
          const { pos, root, folded } = meta.set
          const list = root ? s.roots : s.items
          const has = list.includes(pos)
          if (has !== folded) {
            const next = folded ? [...list, pos].sort((a, b) => a - b) : list.filter((p) => p !== pos)
            s = { ...s, ...(root ? { roots: next } : { items: next }), version: s.version + 1 }
          }
        } else if (meta && 'clear' in meta) {
          const { from, to } = meta.clear
          const items = s.items.filter((p) => p < from || p >= to)
          const roots = s.roots.filter((p) => p < from || p >= to)
          if (items.length !== s.items.length || roots.length !== s.roots.length) s = { items, roots, version: s.version + 1 }
        }
        return s
      },
    },
    view: () => ({
      update(view, prev) {
        const a = foldKey.getState(prev)
        const b = foldKey.getState(view.state)
        if (a === b) return
        const sig = (x: FoldState | undefined) => (x ? `${x.version}:${x.items.length}:${x.roots.length}` : '')
        if (sig(a) !== sig(b)) changed(view)
      },
    }),
  })
}

/** The folded paths of the mindmap callout at `base`, in outline order (null: the synthesized root). */
export function foldedPaths(state: EditorState, base: number): (number[] | null)[] {
  const s = foldKey.getState(state)
  const callout = state.doc.nodeAt(base)
  if (!s || !callout || !isMindmapCallout(callout)) return []
  const end = base + callout.nodeSize
  const out: (number[] | null)[] = []
  const synthesized = callout.childCount >= 2 && callout.child(1).childCount > 1
  if (synthesized && s.roots.includes(base)) out.push(null)
  if (!s.items.some((p) => p > base && p < end)) return out
  const paths = itemPaths(callout, base)
  for (const p of s.items) {
    if (p <= base || p >= end) continue
    const path = paths.get(p)
    const item = state.doc.nodeAt(p)
    // The root item is no fold of a synthesized root; a fold of an item that lost its children is not shown.
    if (path && item && hasChildren(item)) out.push(path)
  }
  return out
}
export function setFoldMeta(tr: Transaction, pos: number, root: boolean, folded: boolean): Transaction {
  return tr.setMeta(foldKey, { set: { pos, root, folded } } satisfies Meta).setMeta('addToHistory', false)
}
export function clearFoldsMeta(tr: Transaction, from: number, to: number): Transaction {
  return tr.setMeta(foldKey, { clear: { from, to } } satisfies Meta).setMeta('addToHistory', false)
}
export function isFolded(state: EditorState, pos: number, root: boolean): boolean {
  const s = foldKey.getState(state)
  return !!s && (root ? s.roots : s.items).includes(pos)
}
