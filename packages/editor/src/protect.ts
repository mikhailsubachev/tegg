// Slice AND-3 (docs/contracts/android-edit.md §5.2; FR-MMP-02 AC-37, D-2516, CP-12 → D-2538): with
// `EditorOptions.protectMindmaps` (the phone only) every top-level mindmap callout is a protected range. Its DOM is
// `contenteditable="false"`, no selection rests inside it, and every user edit is narrowed to the text outside it: a
// deletion or replacement that covers part or all of the block changes only the selected text of the blocks around
// it, and the callout's lines stay byte for byte. Loads, undo, redo and `reload()` are never narrowed or filtered.
// The desktop never installs this extension, so its editor is unchanged.

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** The protect plugin's key; `formatState` reads it to tell whether mindmaps are protected in a state (§4.1). */
export const protectKey = new PluginKey<true>('teggProtectMindmaps')

const HISTORY = 'history$'

export const isMindmapNode = (n: PMNode | null | undefined): boolean =>
  !!n && n.type.name === 'callout' && String(n.attrs.calloutType).toLowerCase() === 'mindmap'

/** The protected ranges of `doc`: each top-level mindmap callout's [start, end). */
export function protectedRanges(doc: PMNode): [number, number][] {
  const out: [number, number][] = []
  doc.forEach((n, pos) => {
    if (isMindmapNode(n)) out.push([pos, pos + n.nodeSize])
  })
  return out
}

/** The range a step changes in the document it applies to, or null (a document attribute). */
function stepRange(step: Step): [number, number] | null {
  const s = step as unknown as { from?: number; to?: number; pos?: number }
  if (typeof s.from === 'number' && typeof s.to === 'number') return [s.from, s.to]
  if (typeof s.pos === 'number') return [s.pos, s.pos + 1]
  return null
}

const touches = (r: [number, number], p: [number, number]) => r[0] < p[1] && r[1] > p[0]

function touchesAny(doc: PMNode, step: Step): boolean {
  const r = stepRange(step)
  return !!r && protectedRanges(doc).some((p) => touches(r, p))
}

/** Whether a transaction is exempt: a load, a reload, undo or redo (§5.2). */
const exempt = (tr: Transaction) => !!tr.getMeta('teggLoad') || !!tr.getMeta(HISTORY)

/** A selection outside every protected range: `sel` itself, else the nearest text position after the block (or
 *  before it when the selection came from below), else null when the document has no text outside. */
function outside(doc: PMNode, sel: Selection, prevHead: number | null): Selection | null {
  const ranges = protectedRanges(doc)
  // A selection across a whole block stays (its edits are narrowed); an end inside one moves out.
  const hit = ranges.find(([a, b]) => (sel.from > a && sel.from < b) || (sel.to > a && sel.to < b))
  if (!hit) return null
  const [a, b] = hit
  const after = () => (b <= doc.content.size ? Selection.findFrom(doc.resolve(b), 1, true) : null)
  const before = () => Selection.findFrom(doc.resolve(a), -1, true)
  const fromBelow = prevHead !== null && prevHead >= b
  const next = fromBelow ? before() ?? after() : after() ?? before()
  return next ? TextSelection.create(doc, next.head) : null
}

/** Narrows `tr` (on `state`) to the text outside the protected ranges; null when nothing had to change. */
function narrow(state: EditorState, tr: Transaction): Transaction | null {
  if (!tr.docChanged) return null
  let needs = false
  for (let i = 0; i < tr.steps.length; i++) if (touchesAny(tr.docs[i], tr.steps[i])) { needs = true; break }
  if (!needs) return null
  const out = state.tr
  let caret: number | null = null
  let same = true // the narrowed transaction has the original's steps so far
  // Original positions → the narrowed document: invert the original steps done so far, then apply the new ones.
  for (let i = 0; i < tr.steps.length; i++) {
    const back = new Mapping()
    for (let j = i - 1; j >= 0; j--) back.appendMap(tr.steps[j].getMap().invert())
    back.appendMapping(out.mapping)
    const step = same ? tr.steps[i] : tr.steps[i].map(back)
    if (!step) continue
    const doc = out.doc
    if (!touchesAny(doc, step)) {
      // Keep what applied; never apply a step that doesn't fit. Issue #184: the rest is dropped, but the transaction is
      // still completed below (the original's meta, time, stored marks and the caret).
      if (out.maybeStep(step).failed) break
      if (caret !== null) caret = step.getMap().map(caret, 1)
      continue
    }
    same = false
    const r = stepRange(step)!
    const ranges = protectedRanges(doc).filter((p) => touches(r, p))
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const pieces = gaps(r, ranges)
      for (const [a, b] of pieces) if (b > a) out.step(step instanceof AddMarkStep ? new AddMarkStep(a, b, step.mark) : new RemoveMarkStep(a, b, step.mark))
      continue
    }
    if (!(step instanceof ReplaceStep)) continue // a structural change across the block: dropped
    // The text pieces of the range outside the blocks; the replaced content goes into the last one, where the
    // selection ended (the caret stays after the map, and the text before the map is only deleted).
    const pieces = gaps(r, ranges)
      .map(([a, b]): [number, number] | null => {
        // A piece that starts at a block's end starts at the next text; one that ends at a block's start ends at the
        // text before it (the gap between them, the block's own lines, stays).
        const lo = ranges.some((p) => p[1] === a) ? Selection.findFrom(doc.resolve(a), 1, true)?.from ?? null : a
        const hi = ranges.some((p) => p[0] === b) ? Selection.findFrom(doc.resolve(b), -1, true)?.to ?? null : b
        return lo !== null && hi !== null && hi >= lo ? [lo, hi] : null
      })
      .filter((x): x is [number, number] => x !== null)
    if (pieces.length === 0) continue
    for (let k = pieces.length - 1; k >= 0; k--) {
      const [a, b] = pieces[k]
      const last = k === pieces.length - 1
      const at = out.steps.length
      out.replace(a, b, last ? step.slice : undefined)
      caret = out.mapping.slice(at).map(last ? b : caret!, 1)
    }
  }
  if (caret !== null) out.setSelection(TextSelection.near(out.doc.resolve(Math.min(caret, out.doc.content.size))))
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta ?? {}
  for (const [k, v] of Object.entries(meta)) out.setMeta(k, v)
  out.setTime(tr.time)
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks)
  if (tr.scrolledIntoView) out.scrollIntoView()
  return out
}

/** [from, to] minus the protected ranges (sorted, all touching it). */
function gaps(r: [number, number], ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let at = r[0]
  for (const [a, b] of ranges) {
    if (a > at) out.push([at, Math.min(a, r[1])])
    at = Math.max(at, b)
  }
  if (at < r[1]) out.push([at, r[1]])
  return out
}

export function protectMindmaps(isLoading: () => boolean) {
  return Extension.create({
    name: 'teggProtectMindmaps',
    // Runs before every other keymap: Backspace at the start of the block after a map moves the caret before the map
    // (never joins); Delete at the end of the block before a map moves it after the map.
    priority: 1100,
    addKeyboardShortcuts() {
      const jump = (dir: -1 | 1) => () => {
        const st = this.editor.state
        const sel = st.selection
        if (!sel.empty) return false
        const k = sel.$from.index(0)
        const nb = k + dir
        if (nb < 0 || nb >= st.doc.childCount || !isMindmapNode(st.doc.child(nb))) return false
        let start = 0
        for (let i = 0; i < k; i++) start += st.doc.child(i).nodeSize
        const end = start + st.doc.child(k).nodeSize
        const edge = dir < 0 ? Selection.findFrom(st.doc.resolve(start), 1, true) : Selection.findFrom(st.doc.resolve(end), -1, true)
        if (!edge || edge.head !== sel.head) return false
        let mapStart = 0
        for (let i = 0; i < nb; i++) mapStart += st.doc.child(i).nodeSize
        const mapEnd = mapStart + st.doc.child(nb).nodeSize
        const target = dir < 0 ? Selection.findFrom(st.doc.resolve(mapStart), -1, true) : Selection.findFrom(st.doc.resolve(mapEnd), 1, true)
        if (target) this.editor.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, target.head)).scrollIntoView())
        return true
      }
      return { Backspace: jump(-1), Delete: jump(1) }
    },
    dispatchTransaction({ transaction, next }) {
      const state = this.editor.state
      if (isLoading() || exempt(transaction) || transaction.before !== state.doc) {
        next(transaction)
        return
      }
      next(narrow(state, transaction) ?? transaction)
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: protectKey,
          state: { init: () => true as const, apply: () => true as const },
          // The backstop: no other transaction (a plugin's, a node view's) changes a protected block.
          filterTransaction: (tr) => {
            if (isLoading() || exempt(tr) || !tr.docChanged) return true
            for (let i = 0; i < tr.steps.length; i++) if (touchesAny(tr.docs[i], tr.steps[i])) return false
            return true
          },
          // No selection rests inside a protected block (§5.2: no caret inside the map).
          appendTransaction: (trs, old, state) => {
            if (isLoading() || trs.some((t) => t.getMeta('teggLoad'))) return null
            const next = outside(state.doc, state.selection, old.selection.head)
            return next ? state.tr.setSelection(next).setMeta('addToHistory', false) : null
          },
          props: {
            decorations: (state) =>
              DecorationSet.create(state.doc, protectedRanges(state.doc).map(([a, b]) => Decoration.node(a, b, { contenteditable: 'false', 'data-protected': 'true' }))),
          },
        }),
      ]
    },
  })
}
