// Editor ⇄ file bridge (ADR 0002). Load: source blocks → PM nodes tagged with srcIndex.
// Save (reconcile): untouched blocks are emitted byte-for-byte; only changed or new blocks are
// rendered; the result is verified by re-parsing. The editor model is never serialized whole.

import type { Editor, JSONContent } from '@tiptap/core'
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
      const raw = doc.blocks[src!].raw
      items.push({ base: raw, text: raw, src, unchanged: true, node, srcRaw: raw, hint: raw })
      return
    }
    if (node.type.name === 'paragraph' && node.content.size === 0) return // empty line: nothing to write
    const srcRaw = original ? doc.blocks[src!].raw : undefined
    const isRaw = node.type.name === 'rawBlock'
    const md = isRaw ? String(node.attrs.source) : renderBlock(pmToBlock(node.toJSON()), srcRaw)
    if (!isRaw && md.trim() === '') return // e.g. a paragraph of spaces: nothing to write
    items.push({ base: fit(md, eol), text: fit(md, eol), src: original ? src : null, unchanged: false, node, srcRaw, hint: srcRaw })
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
      // A block that lands indented (` * item`, indent kept in the original gap) is rendered from
      // column 0; shift its continuation lines by the indent it actually gets in the output, or
      // nested items lose their nesting (found by the read-back check, QA review finding 3).
      if (!it.unchanged && it.node.type.name !== 'rawBlock') it.text = indentContinuation(it.base, indentAt(out, out.length))
      out += it.text
    })
    out += items.length ? (suffix || (doc.blocks.length ? '' : eol)) : suffix
    if (verify(out, items)) return { text: out, changed: out !== doc.text, changedBlocks }
  }
  throw new Error('Saving would change the structure of unedited blocks; edit refused')
}

interface Item {
  base: string // rendered text before indentation
  text: string // text as written in this attempt
  src: number | null
  unchanged: boolean
  node: PMNode
  srcRaw: string | undefined
  hint: string | undefined // original raw (or marker hint) the block was rendered with
}

function indentAt(text: string, start: number): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const indent = text.slice(lineStart, start)
  return /^[ \t]*$/.test(indent) ? indent : ''
}

function indentContinuation(md: string, indent: string): string {
  return indent ? md.split('\n').map((l, k) => (k === 0 || l === '' ? l : indent + l)).join('\n') : md
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
    victim.base = victim.text = fit(renderBlock(pmToBlock(victim.node.toJSON()), hint), eol)
    victim.hint = hint
    victim.unchanged = false
    changed = true
  }
  return changed
}

export const END_LIST = '<!-- -->'

/**
 * Re-parse `out`: one block per item (ignoring separator comments we inserted); unchanged blocks
 * byte-identical; and every changed block **reads back to the same editor content** (same text,
 * marks and structure), so what the user saw is what the file means. Catches e.g. `abc\` read
 * back as a literal backslash (QA review finding 3) or a typed `==` turning into a highlight.
 * Raw blocks are written verbatim and skip the last check.
 */
function verify(out: string, items: Item[]): boolean {
  const after = parse(out)
  const blocks = withoutSeparators(after.blocks, items.map((i) => i.text))
  if (blocks.length !== items.length) return false
  return items.every((it, k) => {
    if (it.unchanged) return blocks[k].raw === it.text
    if (it.node.type.name === 'rawBlock') return true
    try {
      const reread = it.node.type.schema.nodeFromJSON(blockToPM(blocks[k].node, after.text))
      return JSON.stringify(comparable(reread.toJSON())) === JSON.stringify(comparable(it.node.toJSON()))
    } catch {
      return false
    }
  })
}

/**
 * Editor content in a form that ignores what saving legitimately normalizes: source bookkeeping
 * (`srcIndex`), verbatim inline pieces vs plain text (`[^1]` whose definition was deleted is
 * text now, as in Obsidian), adjacent text runs, and spaces / hard breaks at the edges of a
 * textblock (trimmed on save).
 */
export function comparable(json: JSONContent): JSONContent {
  const attrs = { ...(json.attrs ?? {}) }
  delete attrs.srcIndex
  const out: JSONContent = { type: json.type }
  if (Object.keys(attrs).length) out.attrs = attrs
  if (json.marks?.length) out.marks = json.marks
  if (json.text !== undefined) out.text = json.text.replace(/\r\n/g, '\n') // line endings are unified on save
  if (json.content) {
    let content: JSONContent[] = []
    for (const c of json.content.map(comparable)) {
      const t = c.type === 'rawInline' ? { type: 'text', text: String(c.attrs?.source ?? ''), ...(c.marks ? { marks: c.marks } : {}) } : c
      const prev = content[content.length - 1]
      if (t.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(t.marks ?? [])) prev.text += t.text!
      else content.push({ ...t })
    }
    if (['paragraph', 'heading'].includes(json.type!)) content = trimTextblock(content)
    if (content.length) out.content = content
  }
  return out
}

function trimTextblock(content: JSONContent[]): JSONContent[] {
  const c = [...content]
  while (c.length && (c[0].type === 'hardBreak' || (c[0].type === 'text' && !c[0].text!.trim()))) c.shift()
  while (c.length && (c[c.length - 1].type === 'hardBreak' || (c[c.length - 1].type === 'text' && !c[c.length - 1].text!.trim()))) c.pop()
  if (c[0]?.type === 'text') c[0] = { ...c[0], text: c[0].text!.replace(/^[ \t]+/, '') }
  const l = c.length - 1
  if (c[l]?.type === 'text') c[l] = { ...c[l], text: c[l].text!.replace(/[ \t]+$/, '') }
  return c
}

/** Drop `<!-- -->` blocks that don't correspond to an item (i.e. that reconcile inserted). */
export function withoutSeparators<T extends string | { raw: string }>(blocks: T[], expected: string[]): T[] {
  const out: T[] = []
  let j = 0
  for (const b of blocks) {
    const raw = typeof b === 'string' ? b : b.raw
    if (raw === END_LIST && expected[j] !== END_LIST) continue
    out.push(b)
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
  editor: Editor,
  loaded: Loaded,
): void {
  setContent(editor, loaded.json)
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
  setContent(editor, loaded.json)
}

// The parser already found tags with the same rules as the tag plugin (load tests check this),
// so skip the plugin's full re-scan for the load transaction (open-time cost, S2 perf probe).
function setContent(editor: Editor, json: JSONContent): void {
  editor.chain().setMeta('tagRules', true).setContent(json, { emitUpdate: false }).run()
}
