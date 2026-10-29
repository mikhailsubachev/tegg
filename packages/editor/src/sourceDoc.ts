// Editor ⇄ file bridge (ADR 0002; ported from spike S2, D-83). Load: source blocks → PM nodes tagged with srcIndex.
// Save (reconcile): untouched blocks are emitted byte-for-byte; only changed or new blocks are rendered; the result
// is verified by re-parsing. The editor model is never serialized whole.

import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { parse, renderBlock, type Doc } from '@tegg/doc'
import { blockToPM, edgeSpacesOutside, pmToBlock } from './convert'

export interface Loaded {
  doc: Doc
  json: JSONContent // editor content
  originals: (PMNode | null)[] // PM node per source block, for "unchanged?" checks
  /** Source-block indices shown read-only: raw kinds, placeholders and blocks the guard kept (FR-EDT-01 AC-2/AC-8). */
  readonly: Set<number>
  /**
   * `<!-- -->` separators between a list and an indented block (D-67) or two same-marker lists (D-1020): not shown,
   * their bytes kept with the gap.
   */
  hidden: Set<number>
}

/** Kinds shown as non-editable blocks: source blocks (`raw`) and placeholders (FR-EDT-01 AC-8, R5). */
const PLACEHOLDER_KINDS = new Set(['raw', 'embed', 'query'])

/** Parse a file and build the editor document. */
export function loadDoc(text: string, schema: Schema): Loaded {
  const doc = parse(text)
  const readonly = new Set<number>()
  const hidden = new Set<number>()
  doc.blocks.forEach((b, i) => {
    const prev = doc.blocks[i - 1]
    const next = doc.blocks[i + 1]
    if (b.raw !== END_LIST || !prev || !next) return
    const prevList = prev.kind === 'list' || prev.kind === 'checklist'
    if ((prevList || /^( {4}|\t)/.test(prev.raw)) && /^[ \t]/.test(next.raw)) hidden.add(i)
    // Two same-marker lists that both hold an embed line are separated this way, not re-marked (D-1020).
    else if (prevList && next.kind === prev.kind && listMarker(prev.raw) !== null && listMarker(prev.raw) === listMarker(next.raw)) hidden.add(i)
  })
  const content = doc.blocks.flatMap((b, i): JSONContent[] => (hidden.has(i) ? [] : [block(b, i)]))
  function block(b: (typeof doc.blocks)[number], i: number): JSONContent {
    let json: JSONContent = { type: 'rawBlock', attrs: { source: b.raw, kind: b.kind } }
    if (!PLACEHOLDER_KINDS.has(b.kind)) {
      const candidate = blockToPM(b.node, doc.text)
      if (isLossless(doc, b.raw, candidate, schema)) json = candidate
      else json = { type: 'rawBlock', attrs: { source: b.raw, kind: 'raw' } }
    }
    if (json.type === 'rawBlock') readonly.add(i)
    return { ...json, attrs: { ...json.attrs, srcIndex: i } }
  }
  const json: JSONContent = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
  const pm = schema.nodeFromJSON(json)
  const originals: (PMNode | null)[] = doc.blocks.map(() => null)
  pm.forEach((n) => {
    const i = n.attrs.srcIndex as number | null
    if (i !== null) originals[i] = n
  })
  return { doc, json, originals, readonly, hidden }
}

/**
 * A block is editable only if editing it can't lose anything: what the editor would write for it, read back, must
 * give exactly the same editor content. Otherwise it is kept as a read-only raw block.
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
  changedBlocks: number
}

export class VerifyError extends Error {
  constructor(message = 'Saving would change the structure of unedited blocks; edit refused') {
    super(message)
    this.name = 'VerifyError'
  }
}

/** Build the file text for the editor document `pmDoc`. Throws VerifyError when every escalation fails. */
export function reconcile(loaded: Loaded, pmDoc: PMNode, opts: { forceVerifyFailure?: boolean } = {}): ReconcileResult {
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
    const original = src !== null && src < originals.length && !used.has(src) ? originals[src] : null
    if (src !== null && original) used.add(src)
    if (original && node.eq(original)) {
      const raw = doc.blocks[src!].raw
      items.push({ base: raw, text: raw, src, unchanged: true, node, srcRaw: raw, hint: raw })
      return
    }
    if (node.type.name === 'paragraph' && node.textContent.trim() === '' && !hasAtoms(node)) return // empty line: nothing to write
    const srcRaw = original ? doc.blocks[src!].raw : undefined
    const isRaw = node.type.name === 'rawBlock'
    const md = isRaw ? String(node.attrs.source) : (srcRaw !== undefined && (checkboxPatch(original!, node, srcRaw) || tablePatch(original!, node, srcRaw))) || renderBlock(pmToBlock(node.toJSON()), srcRaw)
    if (!isRaw && md.trim() === '') return // e.g. a paragraph of spaces: nothing to write
    // A raw block holds bytes the file already had (a copy, a moved or mode-changed embed): never re-normalized, so
    // an NFD embed line stays NFD when duplicated (AP-336, FR-FMT-07 AC-15). Rendered blocks are written in NFC.
    const written = isRaw ? fitEol(md, eol) : fit(md, eol)
    items.push({ base: written, text: written, src: original ? src : null, unchanged: false, node, srcRaw, hint: srcRaw })
  })

  const changedBlocks = items.filter((i) => !i.unchanged).length
  const shown = doc.blocks.map((_b, i) => i).filter((i) => !loaded.hidden.has(i))
  const nothingChanged = changedBlocks === 0 && items.length === shown.length && items.every((it, k) => it.src === shown[k])
  if (nothingChanged && !opts.forceVerifyFailure) return { text: doc.text, changed: false, changedBlocks: 0 }

  // Separators: keep the original gap between consecutive original blocks; otherwise a blank line. If verification
  // fails, escalate: 1. blank lines around every changed block; 2. give one of two adjacent same-marker lists another
  // marker (D-67); 3. an `<!-- -->` line after a list that is newly followed by an indented block (D-67).
  for (const attempt of ['gaps', 'blank lines', 'list markers', 'end-list comment', 'divider style'] as const) {
    if (attempt === 'list markers' && !separateLists(items, eol)) continue
    // A new `---` can pair with an opening `---` the file had into frontmatter; write new dividers as `***`.
    if (attempt === 'divider style') {
      const hrs = items.filter((it) => !it.unchanged && it.node.type.name === 'horizontalRule')
      if (!hrs.length) continue
      for (const it of hrs) it.base = it.text = '***'
    }
    const blankAroundChanged = attempt !== 'gaps'
    let out = prefix
    if (items.length && prefix && !prefix.endsWith('\n')) out += eol // e.g. frontmatter-only files
    items.forEach((it, k) => {
      if (k > 0) {
        const prev = items[k - 1]
        const consecutive = prev.src !== null && it.src !== null && (it.src === prev.src + 1 || (it.src === prev.src + 2 && loaded.hidden.has(prev.src + 1)))
        let gap = consecutive ? doc.text.slice(doc.blocks[prev.src!].range[1], doc.blocks[it.src!].range[0]) : eol + eol
        if (blankAroundChanged && (!it.unchanged || !prev.unchanged) && !/\n[ \t]*\r?\n/.test(gap)) gap = eol + eol
        const sameLists = prev.node.type.name === it.node.type.name && /List$/.test(it.node.type.name) && listMarker(prev.text) === listMarker(it.text)
        // Two indented code blocks in a row would also merge into one.
        const indentedPair = /^( {4}|\t)/.test(prev.text) && /^[ \t]/.test(it.text)
        if (attempt === 'end-list comment' && !consecutive && ((/List$/.test(prev.node.type.name) && (/^[ \t]/.test(it.text) || sameLists)) || indentedPair)) {
          gap = eol + eol + END_LIST + eol + eol
        }
        out += gap
      }
      if (!it.unchanged && it.node.type.name !== 'rawBlock') it.text = indentContinuation(it.base, indentAt(out, out.length))
      out += it.text
    })
    out += items.length ? (suffix || (doc.blocks.length ? '' : eol)) : suffix
    if (!opts.forceVerifyFailure && verify(out, items)) return { text: out, changed: out !== doc.text, changedBlocks }
  }
  throw new VerifyError()
}

function hasAtoms(node: PMNode): boolean {
  let found = false
  node.descendants((n) => { if (!n.isText && n.isInline && n.type.name !== 'hardBreak') found = true; return !found })
  return found
}

interface Item {
  base: string
  text: string
  src: number | null
  unchanged: boolean
  node: PMNode
  srcRaw: string | undefined
  hint: string | undefined
}

function indentAt(text: string, start: number): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const indent = text.slice(lineStart, start)
  return /^[ \t]*$/.test(indent) ? indent : ''
}

function indentContinuation(md: string, indent: string): string {
  return indent ? md.split('\n').map((l, k) => (k === 0 || l === '' ? l : indent + l)).join('\n') : md
}

const CHECKBOX = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/gm

/**
 * D-192: a list whose only change is checkbox state is written by patching the marker characters of its original
 * source, so toggling one item never re-renders (and normalizes) the rest of the list.
 */
function checkboxPatch(original: PMNode, node: PMNode, raw: string): string | null {
  if (!/List$/.test(node.type.name)) return null
  const strip = (j: JSONContent): JSONContent => ({
    ...j,
    ...(j.attrs ? { attrs: { ...j.attrs, checked: j.attrs.checked === null || j.attrs.checked === undefined ? null : 'box' } } : {}),
    ...(j.content ? { content: j.content.map(strip) } : {}),
  })
  if (JSON.stringify(strip(original.toJSON())) !== JSON.stringify(strip(node.toJSON()))) return null
  const before: boolean[] = []
  const after: boolean[] = []
  original.descendants((n) => { if (n.type.name === 'listItem' && n.attrs.checked !== null) before.push(!!n.attrs.checked); return true })
  node.descendants((n) => { if (n.type.name === 'listItem' && n.attrs.checked !== null) after.push(!!n.attrs.checked); return true })
  const marks = [...raw.matchAll(CHECKBOX)]
  if (marks.length !== after.length) return null
  let out = ''
  let at = 0
  marks.forEach((m, i) => {
    if (before[i] === after[i]) return
    const pos = m.index! + m[1].length
    out += raw.slice(at, pos) + (after[i] ? 'x' : ' ')
    at = pos + 1
  })
  return (out + raw.slice(at)).replace(/\r\n/g, '\n')
}

/**
 * A table whose shape and alignment are unchanged is written by replacing only the rows that changed, each as
 * `| cell | cell |`, so editing one cell never re-pads the whole table (FR-EDT-02 AC-20). Pipes in cells are escaped.
 */
function tablePatch(original: PMNode, node: PMNode, raw: string): string | null {
  if (node.type.name !== 'table' || original.type.name !== 'table') return null
  if (JSON.stringify(node.attrs.align) !== JSON.stringify(original.attrs.align) || node.childCount !== original.childCount) return null
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  if (lines.length !== node.childCount + 1) return null // header, delimiter, one line per body row
  const out = [...lines]
  for (let r = 0; r < node.childCount; r++) {
    const row = node.child(r)
    const was = original.child(r)
    if (row.childCount !== was.childCount) return null
    if (row.eq(was)) continue
    const cells: string[] = []
    row.forEach((cell) => {
      const md = renderBlock(pmToBlock({ type: 'paragraph', content: cell.firstChild?.toJSON().content ?? [] }))
      cells.push(md.replace(/\n/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|').replace(/(^|[^\\])\|/g, '$1\\|'))
    })
    out[r === 0 ? 0 : r + 1] = `| ${cells.join(' | ')} |`
  }
  return out.join('\n')
}

// An empty item is a bare marker at the end of its line (bug_4a_fr_edt_08_empty_list_after_checklist_saves).
const LIST_MARKER = /^[ \t]*(?:([-*+])|\d+([.)]))(?=[ \t]|\r?\n|$)/

function listMarker(text: string): string | null {
  const m = text.match(LIST_MARKER)
  return m ? (m[1] ?? m[2]) : null
}

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
    // Prefer re-marking a block the user changed; otherwise the one that lost its original neighbours (the moved
    // one), so blocks away from the edit keep their bytes.
    const kept = (i: number) => {
      const x = items[i].src
      if (x === null) return 0
      return (items[i - 1]?.src === x - 1 ? 1 : 0) + (items[i + 1]?.src === x + 1 ? 1 : 0)
    }
    let victimIndex = !b.unchanged ? k : !a.unchanged ? k - 1 : kept(k - 1) <= kept(k) ? k - 1 : k
    // FR-FMT-07 AC-15: a list holding an embed line keeps its marker (its embed line keeps its bytes); the other list
    // is re-marked, and when both hold one, the end-list comment separates them instead.
    const hasEmbed = (it: Item) => it.unchanged && /!\[\[/.test(it.text)
    if (hasEmbed(items[victimIndex])) {
      const other = victimIndex === k ? k - 1 : k
      if (hasEmbed(items[other])) continue
      victimIndex = other
    }
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
 * Re-parse `out`: one block per item (ignoring separator comments we inserted); unchanged blocks byte-identical; and
 * every changed block reads back to the same editor content, so what the user saw is what the file means.
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
 * Editor content in a form that ignores what saving legitimately normalizes: source bookkeeping (`srcIndex`),
 * verbatim inline pieces vs plain text, adjacent text runs, spaces / hard breaks at the edges of a textblock.
 */
export function comparable(json: JSONContent): JSONContent {
  const attrs = { ...(json.attrs ?? {}) }
  delete attrs.srcIndex
  // In a table cell a link's pipe is written `\|`; it is the same link (dialect §6).
  if (json.type === 'wikiLink' && typeof attrs.value === 'string') attrs.value = attrs.value.replace(/\\\|/g, '|')
  // A table without alignment reads back as one `null` per column.
  if (json.type === 'table' && Array.isArray(attrs.align) && attrs.align.every((a: unknown) => a === null)) attrs.align = null
  const out: JSONContent = { type: json.type }
  if (Object.keys(attrs).length) out.attrs = attrs
  // An e-mail address in text always reads back as a GFM autolink literal (`mailto:` link with the address as its
  // text), even when written `\@`; it is the same content as the typed text (bug_3d_fr_edt_08_email_in_body_saves).
  const marks = json.marks?.filter((m) => !(m.type === 'link' && json.text !== undefined && m.attrs?.href === `mailto:${json.text}`))
  if (marks?.length) out.marks = marks
  if (json.text !== undefined) out.text = json.text.replace(/\r\n/g, '\n').normalize('NFC')
  if (json.content) {
    let content: JSONContent[] = []
    for (const c of edgeSpacesOutside(json.content).map(comparable)) {
      const t = c.type === 'rawInline' ? { type: 'text', text: String(c.attrs?.source ?? ''), ...(c.marks ? { marks: c.marks } : {}) } : c
      const prev = content[content.length - 1]
      if (t.type === 'text' && prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(t.marks ?? [])) prev.text += t.text!
      else content.push({ ...t })
    }
    if (['paragraph', 'heading', 'calloutTitle'].includes(json.type!)) content = trimTextblock(content)
    if (content.length) out.content = content
  }
  return out
}

function trimTextblock(content: JSONContent[]): JSONContent[] {
  const c = [...content]
  while (c.length && (c[0].type === 'hardBreak' || (c[0].type === 'text' && !c[0].text!.trim()))) c.shift()
  while (c.length && (c[c.length - 1].type === 'hardBreak' || (c[c.length - 1].type === 'text' && !c[c.length - 1].text!.trim()))) c.pop()
  if (c[0]?.type === 'text') c[0] = { ...c[0], text: c[0].text!.replace(/^[ \t\n]+/, '') }
  const l = c.length - 1
  if (c[l]?.type === 'text') c[l] = { ...c[l], text: c[l].text!.replace(/[ \t\n]+$/, '') }
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
  return fitEol(s.normalize('NFC'), eol)
}

function fitEol(s: string, eol: string): string {
  return eol === '\r\n' ? s.replace(/\r?\n/g, '\r\n') : s
}

/**
 * Put a loaded document into an editor. Editor plugins may normalize content on load (e.g. the table plugin adds
 * cells to ragged rows): any top-level block the editor changed by itself is replaced by a read-only raw block, so
 * opening a note can never rewrite it (normalization guard, FR-EDT-01 AC-2).
 */
export function attach(editor: Editor, loaded: Loaded): void {
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
      return i !== null && normalized.has(i) ? { type: 'rawBlock', attrs: { source: loaded.doc.blocks[i].raw, kind: 'raw', srcIndex: i } } : c
    }),
  }
  for (const i of normalized) loaded.readonly.add(i)
  const pm = editor.schema.nodeFromJSON(loaded.json)
  pm.forEach((n) => {
    const i = n.attrs.srcIndex as number | null
    if (i !== null) loaded.originals[i] = n
  })
  setContent(editor, loaded.json)
}

// The parser already found tags with the same rules as the tag plugin, so skip the plugin's full re-scan for the
// load transaction (open-time cost, S2 perf probe). Loading is never an undo step.
function setContent(editor: Editor, json: JSONContent): void {
  editor.chain().setMeta('tagRules', true).setMeta('addToHistory', false).setContent(json, { emitUpdate: false }).run()
}
