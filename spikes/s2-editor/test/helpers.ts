import { Editor } from '@tiptap/core'
import { expect } from 'vitest'
import { parse } from '@core/parse'
import { teggExtensions } from '../src/schema'
import { attach, loadDoc, reconcile, withoutSeparators, END_LIST, type Loaded } from '../src/sourceDoc'

export { fixtures, byName } from '../../s1-roundtrip/test/fixtures'

export interface Session {
  editor: Editor
  loaded: Loaded
  save: () => string
}

/** Open a file in a real (headless) TipTap editor. */
export function open(text: string): Session {
  const editor = new Editor({ extensions: teggExtensions(), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  const loaded = loadDoc(text, editor.schema)
  attach(editor, loaded)
  return { editor, loaded, save: () => reconcile(loaded, editor.state.doc).text }
}

/** Position just inside the end of the last textblock of top-level node `k`. */
export function endOfBlock(editor: Editor, k: number): number | null {
  let start = 0
  for (let i = 0; i < k; i++) start += editor.state.doc.child(i).nodeSize
  const node = editor.state.doc.child(k)
  let pos: number | null = null
  node.descendants((n, p) => {
    if (n.isTextblock && n.type.name !== 'codeBlock') pos = start + 1 + p + n.nodeSize - 1
    if (n.type.name === 'codeBlock') pos = start + 1 + p + n.nodeSize - 1
    return true
  })
  if (node.isTextblock) pos = start + node.nodeSize - 1
  return pos
}

/** Indexes of source blocks emitted unchanged must keep their raw text; returns blocks of `out`. */
export function blocksOf(text: string): string[] {
  return parse(text).blocks.map((b) => b.raw)
}

/**
 * The invariant, derived from the editor's own document (not from assumptions about the op):
 * the saved file has one block per non-empty top-level node, in the editor's order, and every
 * node the user didn't change is emitted byte-identical — except list-marker changes needed to
 * keep adjacent lists apart (reported by `markerOnly`).
 */
export function expectPreserved(s: Session, out: string, ctx: string): number {
  let markerOnly = 0
  const after = parse(out)
  const nodes: { unchanged: boolean; raw: string | null; list: boolean }[] = []
  s.editor.state.doc.forEach((n) => {
    // Mirrors reconcile: empty or whitespace-only paragraphs aren't written.
    const blank = n.type.name === 'paragraph' && n.content.content.every((c) => c.isText && c.text!.trim() === '')
    if (blank) return
    const i = n.attrs.srcIndex as number | null
    const o = i !== null ? s.loaded.originals[i] : null
    const unchanged = !!o && n.eq(o)
    nodes.push({ unchanged, raw: unchanged ? s.loaded.doc.blocks[i!].raw : null, list: /List$/.test(n.type.name) })
  })
  const raws = withoutSeparators(after.blocks.map((b) => b.raw), nodes.map((n) => n.raw ?? ''))
  separators += after.blocks.length - raws.length
  expect(raws.length, `${ctx}: block count`).toBe(nodes.length)
  nodes.forEach((n, k) => {
    if (!n.unchanged) return
    const got = raws[k]
    if (n.list && got !== n.raw) {
      // Only the list markers may differ (adjacent same-marker lists were separated).
      const strip = (t: string) => t.replace(/^([ \t]*)(?:[-*+]|\d+[.)])(?=[ \t])/gm, '$1•')
      expect(strip(got), `${ctx}: list ${k} differs beyond markers`).toBe(strip(n.raw!))
      markerOnly++
    } else expect(got, `${ctx}: unchanged block ${k}`).toBe(n.raw)
  })
  expect(after.frontmatter?.data ?? null).toEqual(s.loaded.doc.frontmatter?.data ?? null)
  return markerOnly
}


/** Count of `<!-- -->` end-list separators inserted across all checks (reported by tests). */
export let separators = 0
export { END_LIST }
