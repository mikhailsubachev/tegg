// Editor ⇄ file bridge (ADR 0002). Load: source blocks → PM nodes tagged with srcIndex.
// Save (reconcile): untouched blocks are emitted byte-for-byte; only changed or new blocks are
// rendered; the result is verified by re-parsing. The editor model is never serialized whole.

import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { renderBlock } from '@core/edit'
import { parse, type Doc } from '@core/parse'
import { blockToPM, pmToBlock } from './convert'

export interface Loaded {
  doc: Doc
  json: JSONContent // editor content
  originals: (PMNode | null)[] // PM node per source block, for "unchanged?" checks
  rawFallbacks: number // blocks shown read-only because their editor form wasn't lossless
}

/** Parse a file and build the editor document. */
export function loadDoc(text: string, schema: Schema): Loaded {
  const doc = parse(text)
  let rawFallbacks = 0
  const content = doc.blocks.map((b, i): JSONContent => {
    let json: JSONContent = { type: 'rawBlock', attrs: { source: b.raw } }
    if (b.kind !== 'raw') {
      const candidate = blockToPM(b.node, doc.text)
      if (isLossless(doc, b.raw, candidate, schema)) json = candidate
      else rawFallbacks++
    }
    return { ...json, attrs: { ...json.attrs, srcIndex: i } }
  })
  const json: JSONContent = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
  const pm = schema.nodeFromJSON(json)
  const originals: (PMNode | null)[] = doc.blocks.map(() => null)
  pm.forEach((n) => {
    const i = n.attrs.srcIndex as number | null
    if (i !== null) originals[i] = n
  })
  return { doc, json, originals, rawFallbacks }
}

/**
 * A block is editable only if editing it can't lose anything: what the editor would write for
 * it, read back, must give exactly the same editor content (one block, equal nodes). Otherwise
 * it is kept as a read-only raw block. (A textual comparison with the standard rendering was too
 * strict: verbatim inline content like `(1)` in a link path is more faithful than `\(1\)`.)
 */
function isLossless(doc: Doc, raw: string, json: JSONContent, schema: Schema): boolean {
  try {
    const pm = schema.nodeFromJSON(json)
    pm.check()
    const written = renderBlock(pmToBlock(json), raw)
    // Read back in context: footnote references and reference links need the note's definitions.
    const defs = doc.blocks.filter((b) => b.node.type === 'footnoteDefinition' || b.node.type === 'definition').map((b) => b.raw)
    const reread = parse([written, ...defs].join('\n\n') + '\n')
    if (reread.blocks.length !== 1 + defs.length || reread.blocks[0].kind === 'raw') return false
    return schema.nodeFromJSON(blockToPM(reread.blocks[0].node, reread.text)).eq(pm)
  } catch {
    return false
  }
}

export interface ReconcileResult {
  text: string
  changed: boolean
  changedBlocks: number // top-level blocks rendered (new or edited)
}

/** Build the file text for the editor document `pmDoc`. */
export function reconcile(loaded: Loaded, pmDoc: PMNode): ReconcileResult {
  const { doc, originals } = loaded
  const eol = doc.eol
  const first = doc.blocks[0]
  const last = doc.blocks[doc.blocks.length - 1]
  const prefix = first ? doc.text.slice(0, first.range[0]) : doc.text
  const suffix = last ? doc.text.slice(last.range[1]) : ''

  const items: Item[] = []
  const used = new Set<number>()
  pmDoc.forEach((node) => {
    const src = node.attrs.srcIndex as number | null
    const original = src !== null && !used.has(src) ? originals[src] : null
    if (src !== null && original && !used.has(src)) used.add(src)
    if (original && node.eq(original)) {
      items.push({ text: doc.blocks[src!].raw, src, unchanged: true, node, srcRaw: doc.blocks[src!].raw })
      return
    }
    if (node.type.name === 'paragraph' && node.content.size === 0) return // empty line: nothing to write
    const srcRaw = original ? doc.blocks[src!].raw : undefined
    const md = node.type.name === 'rawBlock' ? String(node.attrs.source) : renderBlock(pmToBlock(node.toJSON()), srcRaw)
    items.push({ text: fit(md, eol), src: original ? src : null, unchanged: false, node, srcRaw })
  })

  const changedBlocks = items.filter((i) => !i.unchanged).length
  const nothingChanged = changedBlocks === 0 && items.length === doc.blocks.length && items.every((it, k) => it.src === k)
  if (nothingChanged) return { text: doc.text, changed: false, changedBlocks: 0 }

  // Separators: keep the original gap between consecutive original blocks; otherwise a blank
  // line. If verification fails, escalate (S2 findings):
  // 1. blank lines around every changed block;
  // 2. give one of two adjacent same-marker lists another marker: in Markdown a blank line
  //    doesn't separate them (they'd become one list). Only that list's marker bytes change;
  // 3. an `<!-- -->` line after a list that is newly followed by an indented block: CommonMark
  //    makes indented content after a list part of its last item, whatever the blank lines.
  for (const attempt of ['gaps', 'blank lines', 'list markers', 'end-list comment'] as const) {
    if (attempt === 'list markers' && !separateLists(items, eol)) continue
    const blankAroundChanged = attempt !== 'gaps'
    let out = prefix
    if (items.length && prefix && !prefix.endsWith('\n')) out += eol // e.g. frontmatter-only files
    items.forEach((it, k) => {
      if (k > 0) {
        const prev = items[k - 1]
        const consecutive = prev.src !== null && it.src !== null && it.src === prev.src + 1
        let gap = consecutive ? doc.text.slice(doc.blocks[prev.src!].range[1], doc.blocks[it.src!].range[0]) : eol + eol
        if (blankAroundChanged && (!it.unchanged || !prev.unchanged) && !/\n[ \t]*\r?\n/.test(gap)) gap = eol + eol
        if (attempt === 'end-list comment' && !consecutive && /List$/.test(prev.node.type.name) && /^[ \t]/.test(it.text)) {
          gap = eol + eol + END_LIST + eol + eol
        }
        out += gap
      }
      out += it.text
    })
    out += items.length ? (suffix || (doc.blocks.length ? '' : eol)) : suffix
    if (verify(out, items)) return { text: out, changed: out !== doc.text, changedBlocks }
  }
  throw new Error('Saving would change the structure of unedited blocks; edit refused')
}

interface Item {
  text: string
  src: number | null
  unchanged: boolean
  node: PMNode
  srcRaw: string | undefined
}

const LIST_MARKER = /^[ \t]*(?:([-*+])|\d+([.)]))[ \t]/

/** Re-render lists that would merge with an adjacent same-marker list. Returns true if any changed. */
function separateLists(items: Item[], eol: string): boolean {
  let changed = false
  const markerOf = (it: Item | undefined) => {
    if (!it || !['bulletList', 'orderedList'].includes(it.node.type.name)) return null
    const m = it.text.match(LIST_MARKER)
    return m ? (m[1] ?? m[2]) : null
  }
  for (let k = 1; k < items.length; k++) {
    const a = items[k - 1]
    const b = items[k]
    if (a.node.type.name !== b.node.type.name || markerOf(a) === null || markerOf(a) !== markerOf(b)) continue
    // Prefer re-marking a block the user changed; otherwise the later one.
    const victimIndex = !b.unchanged ? k : !a.unchanged ? k - 1 : k
    const victim = items[victimIndex]
    const ordered = victim.node.type.name === 'orderedList'
    const taken = new Set([markerOf(items[victimIndex - 1]), markerOf(items[victimIndex + 1])])
    const marker = (ordered ? ['.', ')'] : ['-', '*', '+']).find((m) => !taken.has(m))
    if (!marker) continue
    const hint = ordered ? `1${marker} x` : `${marker} x`
    victim.text = fit(renderBlock(pmToBlock(victim.node.toJSON()), hint), eol)
    victim.unchanged = false
    changed = true
  }
  return changed
}

export const END_LIST = '<!-- -->'

/** Re-parse `out`: one block per item (ignoring separator comments we inserted), unchanged ones byte-identical. */
function verify(out: string, items: { text: string; unchanged: boolean }[]): boolean {
  const blocks = withoutSeparators(parse(out).blocks.map((b) => b.raw), items.map((i) => i.text))
  if (blocks.length !== items.length) return false
  return items.every((it, k) => !it.unchanged || blocks[k] === it.text)
}

/** Drop `<!-- -->` blocks that don't correspond to an item (i.e. that reconcile inserted). */
export function withoutSeparators(raws: string[], expected: string[]): string[] {
  const out: string[] = []
  let j = 0
  for (const raw of raws) {
    if (raw === END_LIST && expected[j] !== END_LIST) continue
    out.push(raw)
    j++
  }
  return out
}

function fit(s: string, eol: string): string {
  const nfc = s.normalize('NFC')
  return eol === '\r\n' ? nfc.replace(/\r?\n/g, '\r\n') : nfc
}

/**
 * Put a loaded document into an editor. Editor plugins may normalize content on load (e.g. the
 * table plugin adds cells to ragged rows): any top-level block the editor changed by itself is
 * replaced by a read-only raw block, so opening a note can never rewrite it (S2 finding).
 */
export function attach(
  editor: { schema: Schema; state: { doc: PMNode }; commands: { setContent: (c: JSONContent, o: { emitUpdate: boolean }) => boolean } },
  loaded: Loaded,
): void {
  editor.commands.setContent(loaded.json, { emitUpdate: false })
  const normalized = new Set<number>()
  editor.state.doc.forEach((n) => {
    const i = n.attrs.srcIndex as number | null
    if (i !== null && loaded.originals[i] && !n.eq(loaded.originals[i]!)) normalized.add(i)
  })
  if (!normalized.size) return
  loaded.json = {
    type: 'doc',
    content: (loaded.json.content ?? []).map((c) => {
      const i = c.attrs?.srcIndex as number | null
      return i !== null && normalized.has(i) ? { type: 'rawBlock', attrs: { source: loaded.doc.blocks[i].raw, srcIndex: i } } : c
    }),
  }
  loaded.rawFallbacks += normalized.size
  const pm = editor.schema.nodeFromJSON(loaded.json)
  pm.forEach((n) => {
    const i = n.attrs.srcIndex as number | null
    if (i !== null) loaded.originals[i] = n
  })
  editor.commands.setContent(loaded.json, { emitUpdate: false })
}
