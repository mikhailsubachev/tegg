// Slice OL (docs/contracts/v1-outline.md §1; docs/acceptance/outline.md R171, R173): the heading list of a note, its
// tree, fold keys and the edge rail's rows. Pure TypeScript over `parse()` (AR-03): no DOM, no app, no editor.
// FR-LNK-06 resolves `#Heading` with the same list (D-1625).
import type { Nodes, RootContent } from 'mdast'
import { parse, type Doc } from './parse.js'
import { calloutHead } from './mindmap.js'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** One heading the outline lists (R171). Offsets are UTF-16 code units into the whole file text (frontmatter and BOM
 *  included): the mdast heading node's own position (after container markers; ATX: the line without its EOL, closing
 *  sequence included; setext: the text line through the end of the underline). */
export type OutlineHeading = { level: HeadingLevel; text: string; from: number; to: number }

/** A heading in the tree (R171 rule 5, R176). Indexes are positions in the `outlineHeadings` array. */
export type OutlineNode = OutlineHeading & {
  index: number
  depth: number
  parent: number | null
  children: number[]
  descendants: number
  key: string
}

export const RAIL_MAX_ROWS = 20

/** R171 rules 1–4 (D-1604, D-1605, D-1628…D-1631). Parses once. */
export function outlineHeadings(text: string): OutlineHeading[] {
  return outlineHeadingsOf(parse(text))
}

const SKIPPED_KINDS = new Set(['raw', 'embed', 'query', 'mindmap', 'code', 'table', 'divider', 'paragraph'])
const countComments = (s: string) => (s.match(/%%/g) ?? []).length

/** The same list from a parsed Doc (no second parse). */
export function outlineHeadingsOf(doc: Doc): OutlineHeading[] {
  const out: OutlineHeading[] = []
  const blocks = doc.blocks
  // CP-1 (D-1628): `%%` comment regions across top-level blocks. An unclosed region hides nothing.
  const hidden = new Set<number>()
  for (let i = 0; i < blocks.length; i++) {
    const raw = blocks[i].raw
    if (!raw.startsWith('%%') || countComments(raw) % 2 === 0) continue
    let close = -1
    for (let j = i + 1; j < blocks.length; j++) if (countComments(blocks[j].raw) % 2 === 1) { close = j; break }
    if (close < 0) continue
    for (let j = i + 1; j <= close; j++) hidden.add(j)
    i = close
  }
  for (let i = 0; i < blocks.length; i++) {
    if (hidden.has(i)) continue
    const b = blocks[i]
    if (b.kind === 'heading') {
      visit(b.node, doc.text, out)
      continue
    }
    if (SKIPPED_KINDS.has(b.kind)) continue
    if (calloutHead(b.raw) && calloutHead(b.raw)!.type.toLowerCase() === 'mindmap') continue
    visit(b.node, doc.text, out)
  }
  return out
}

function visit(node: RootContent | Nodes, text: string, out: OutlineHeading[]): void {
  switch (node.type) {
    case 'heading': {
      const from = node.position!.start.offset!
      const to = node.position!.end.offset!
      const t = cleanText(inlineText(node.children as Nodes[], text))
      if (t !== '') out.push({ level: node.depth as HeadingLevel, text: t, from, to })
      return
    }
    case 'blockquote': {
      const s = node.position?.start.offset
      const e = node.position?.end.offset
      if (s !== undefined && e !== undefined) {
        const h = calloutHead(text.slice(s, e))
        if (h && h.type.toLowerCase() === 'mindmap') return
      }
      for (const c of node.children) visit(c, text, out)
      return
    }
    case 'list':
    case 'listItem':
      for (const c of node.children) visit(c as Nodes, text, out)
      return
    default:
      return // code, html, math, footnoteDefinition, definition, table, paragraphs: no headings
  }
}

function inlineText(nodes: readonly Nodes[], text: string): string {
  let s = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'inlineCode':
        s += n.value
        break
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'link':
      case 'highlight':
        s += inlineText(n.children as Nodes[], text)
        break
      case 'wikiLink': {
        const v = (n as { value: string }).value
        const pipe = unescapedPipe(v)
        s += pipe < 0 ? v : v.slice(pipe + 1)
        break
      }
      case 'image':
        s += n.alt ?? ''
        break
      case 'comment':
        break
      case 'break':
        s += ' '
        break
      default: {
        const p = n.position
        if (p && p.start.offset !== undefined && p.end.offset !== undefined) s += text.slice(p.start.offset, p.end.offset)
        else if ('value' in n && typeof n.value === 'string') s += n.value
      }
    }
  }
  return s
}

function unescapedPipe(v: string): number {
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\') { i++; continue }
    if (v[i] === '|') return i
  }
  return -1
}

function cleanText(s: string): string {
  return s.replace(/\s\^[A-Za-z0-9-]+\s*$/, '').replace(/\s+/g, ' ').trim()
}

/** R171 rule 6: `<level>:<NFC text>#<n>`. */
export function foldKey(level: HeadingLevel, text: string, n: number): string {
  return `${level}:${text.normalize('NFC')}#${n}`
}

/** R171 rule 5: parent = nearest earlier heading with a lower level; depth = 1 + ancestors. */
export function outlineTree(headings: readonly OutlineHeading[]): OutlineNode[] {
  const nodes: OutlineNode[] = []
  const stack: number[] = []
  const seen = new Map<string, number>()
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    while (stack.length && headings[stack[stack.length - 1]].level >= h.level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1] : null
    const base = `${h.level}:${h.text.normalize('NFC')}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    nodes.push({
      level: h.level, text: h.text, from: h.from, to: h.to,
      index: i, depth: parent === null ? 1 : nodes[parent].depth + 1, parent, children: [], descendants: 0,
      key: foldKey(h.level, h.text, n),
    })
    if (parent !== null) nodes[parent].children.push(i)
    stack.push(i)
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const p = nodes[i].parent
    if (p !== null) nodes[p].descendants += nodes[i].descendants + 1
  }
  return nodes
}

/** R173: the greatest depth d in 1…6 for which the headings of depth ≤ d number at most `max`; 1 when even depth 1
 *  has more. */
export function railDepth(tree: readonly OutlineNode[], max = RAIL_MAX_ROWS): number {
  if (tree.length === 0) return 1
  const per = [0, 0, 0, 0, 0, 0, 0]
  for (const n of tree) per[Math.min(6, n.depth)]++
  let x = 1
  let sum = 0
  for (let d = 1; d <= 6; d++) {
    sum += per[d]
    if (sum <= max) x = d
    else break
  }
  return x
}

/** R173, D-1615: the rail's rows (the prototype's `visibleRows()` over depth), in note order. */
export function railRows(tree: readonly OutlineNode[], current: number | null, tempOpen?: ReadonlySet<number>, max = RAIL_MAX_ROWS): number[] {
  if (tree.length === 0) return []
  const x = railDepth(tree, max)
  const s = new Set<number>()
  for (const n of tree) if (n.depth <= x) s.add(n.index)
  if (current !== null && tree[current]) {
    s.add(current)
    for (const c of tree[current].children) s.add(c)
    for (let p = tree[current].parent; p !== null; p = tree[p].parent) {
      s.add(p)
      for (const c of tree[p].children) s.add(c)
    }
  }
  if (tempOpen) {
    for (const t of [...tempOpen].sort((a, b) => a - b)) if (s.has(t) && tree[t]) for (const c of tree[t].children) s.add(c)
  }
  const out: number[] = []
  for (const n of tree) {
    if (!s.has(n.index)) continue
    let ok = true
    for (let p = n.parent; p !== null; p = tree[p].parent) if (!s.has(p)) { ok = false; break }
    if (ok) out.push(n.index)
  }
  return out
}

/** D-1625, D-1641: the first heading whose NFC text equals the fragment, case-insensitively; null when none. Block
 *  fragments (`^id`) are not headings. */
export function headingForFragment(headings: readonly OutlineHeading[], fragment: string): number | null {
  const f = fragment.replace(/^#/, '')
  if (f.startsWith('^')) return null
  const want = f.normalize('NFC').toLowerCase()
  const i = headings.findIndex((h) => h.text.normalize('NFC').toLowerCase() === want)
  return i < 0 ? null : i
}
