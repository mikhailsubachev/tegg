// Link positions, block texts and the excerpt window (docs/contracts/ms4-links.md §2, D-277, D-302, D-303;
// FR-LNK-01 AC-4). The Rust twin is `tegg_format::excerpt` and `Extracted::blocks`; both follow the shared corpus
// tests/fixtures/format/excerpt/cases.json.

import type { Nodes, Parents } from 'mdast'
import type { Doc, Range } from './parse.js'

export type Mark = 'strong' | 'em' | 'code' | 'strike' | 'highlight'
export type BlockTextKind = 'paragraph' | 'heading' | 'listItem' | 'tableRow' | 'quote' | 'callout'
export type Segment = { text: string; marks: Mark[] } | { link: number; marks: Mark[] }
export interface BlockText { kind: BlockTextKind; segments: Segment[] }
export interface At { line: number; byte: number }

export interface LinkTarget { target: string; kind: 'note' | 'daily' | 'date-missing' | 'unresolved'; path: string | null; title: string | null; type: string | null }
export type ExcerptSeg = { kind: 'text'; text: string; marks: Mark[] } | { kind: 'link'; text: string; target: LinkTarget; here: boolean; marks: Mark[] }
export interface Excerpt { segments: ExcerptSeg[]; cutStart: boolean; cutEnd: boolean }

const utf8 = new TextEncoder()

/** 1-based line and 0-based UTF-8 byte offset in that line of string offset `pos`. */
export function atOf(text: string, pos: number): At {
  const before = text.slice(0, pos)
  const lineStart = before.lastIndexOf('\n') + 1
  return { line: (before.match(/\n/g) ?? []).length + 1, byte: utf8.encode(before.slice(lineStart)).length }
}

/** A link record's source range and its index in `extract().links`. */
export interface LinkSpan { range: Range; index: number; markdown: boolean }

const BLOCK_ID_END = /\s+\^[A-Za-z0-9-]+\s*$/
const CALLOUT_MARK = /^\[![^\]\n]*\][+-]?\s*/

/** §2.1: one entry per body block with at least one link; returns the blocks and each link index's block. */
export function blockTexts(doc: Doc, spans: LinkSpan[]): { blocks: BlockText[]; blockOf: Map<number, number> } {
  const blocks: BlockText[] = []
  const blockOf = new Map<number, number>()
  const wiki = spans.filter((s) => !s.markdown)
  const mdAt = new Map(spans.filter((s) => s.markdown).map((s) => [s.range[0], s.index]))

  const leaf = (kind: BlockTextKind, nodes: Nodes[]): void => {
    const segs: Segment[] = []
    const used: number[] = []
    const text = (t: string, marks: Mark[]) => { if (t) segs.push({ text: t, marks }) }
    const link = (i: number, marks: Mark[]) => { if (!used.includes(i)) { used.push(i); segs.push({ link: i, marks }) } }
    const inline = (n: Nodes, marks: Mark[]): void => {
      const p = n.position
      switch (n.type as string) {
        case 'text': text((n as any).value, marks); return
        case 'inlineCode': text((n as any).value, [...marks, 'code']); return
        case 'strong': (n as Parents).children.forEach((c) => inline(c as Nodes, [...marks, 'strong'])); return
        case 'emphasis': (n as Parents).children.forEach((c) => inline(c as Nodes, [...marks, 'em'])); return
        case 'delete': (n as Parents).children.forEach((c) => inline(c as Nodes, [...marks, 'strike'])); return
        case 'highlight': (n as Parents).children.forEach((c) => inline(c as Nodes, [...marks, 'highlight'])); return
        case 'break': text(' ', marks); return
        case 'comment': case 'html': case 'image': case 'imageReference': case 'footnoteReference': return
        case 'tag': case 'inlineMath': if (p) text(doc.text.slice(p.start.offset!, p.end.offset!), marks); return
        case 'wikiLink': {
          const s = p && wiki.find((w) => w.range[0] < p.end.offset! && w.range[1] > p.start.offset!)
          if (s) link(s.index, marks)
          return
        }
        case 'link': {
          const i = p ? mdAt.get(p.start.offset!) : undefined
          if (i !== undefined) link(i, marks)
          else (n as Parents).children.forEach((c) => inline(c as Nodes, marks))
          return
        }
        default:
          if ('children' in n) (n as Parents).children.forEach((c) => inline(c as Nodes, marks))
      }
    }
    nodes.forEach((n, i) => {
      if (kind === 'tableRow' && i > 0) text(' · ', [])
      inline(n, [])
    })
    if (used.length === 0) return
    // Merge neighbours with equal marks.
    const merged: Segment[] = []
    for (const s of segs) {
      const last = merged[merged.length - 1]
      if (last && 'text' in last && 'text' in s && last.marks.join() === s.marks.join()) last.text += s.text
      else merged.push('text' in s ? { ...s, marks: [...s.marks] } : s)
    }
    const first = merged[0]
    if (kind === 'callout' && first && 'text' in first) first.text = first.text.replace(CALLOUT_MARK, '')
    const lastSeg = merged[merged.length - 1]
    if (lastSeg && 'text' in lastSeg) lastSeg.text = lastSeg.text.replace(BLOCK_ID_END, '').trimEnd()
    if (first && 'text' in first) first.text = first.text.trimStart()
    const out = merged.filter((s) => !('text' in s) || s.text !== '')
    for (const i of used) blockOf.set(i, blocks.length)
    blocks.push({ kind, segments: out })
  }

  const walk = (n: Nodes, container: 'item' | 'quote' | 'callout' | null): void => {
    switch (n.type as string) {
      case 'paragraph':
        leaf(container === 'item' ? 'listItem' : container ?? 'paragraph', (n as Parents).children as Nodes[])
        return
      case 'heading': leaf('heading', (n as Parents).children as Nodes[]); return
      case 'table':
        for (const row of (n as Parents).children as Parents[]) leaf('tableRow', row.children as Nodes[])
        return
      case 'listItem': (n as Parents).children.forEach((c) => walk(c as Nodes, 'item')); return
      case 'blockquote': {
        const p = n.position
        const raw = p ? doc.text.slice(p.start.offset!, p.end.offset!) : ''
        const kind = /^>\s*\[!/.test(raw) ? 'callout' : 'quote'
        ;(n as Parents).children.forEach((c) => walk(c as Nodes, kind))
        return
      }
      case 'code': case 'html': case 'math': return
      default:
        if ('children' in n) (n as Parents).children.forEach((c) => walk(c as Nodes, container))
    }
  }
  walk(doc.mdast, null)
  return { blocks, blockOf }
}

/** D-155, D-298: an inline Markdown link to a `.md` path (no scheme), as a link record. */
export function markdownLinks(doc: Doc): { range: Range; target: string; subpath: string | null; alias: string }[] {
  const out: { range: Range; target: string; subpath: string | null; alias: string }[] = []
  const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const plain = (n: Nodes): string => (n.type === 'text' || n.type === 'inlineCode' ? (n as any).value : 'children' in n ? (n as Parents).children.map((c) => plain(c as Nodes)).join('') : '')
  const walk = (n: Nodes): void => {
    if (n.type === 'code' || n.type === 'html') return
    if (n.type === 'link' && n.position) {
      const url = n.url.trim()
      const [path, sub] = url.includes('#') ? [url.slice(0, url.indexOf('#')), url.slice(url.indexOf('#') + 1)] : [url, null]
      const first = path.split('/')[0]
      if (url && !url.startsWith('#') && !first.includes(':') && /\.md$/i.test(path)) {
        out.push({ range: [n.position.start.offset!, n.position.end.offset!], target: decode(path).trim().normalize('NFC'), subpath: sub === null ? null : decode(sub), alias: plain(n) })
      }
    }
    if ('children' in n) (n as Parents).children.forEach((c) => walk(c as Nodes))
  }
  walk(doc.mdast)
  return out
}

/** §2.2 (D-303): a block of at most `max` characters is shown whole. A longer one is cut: the window starts at most
 *  `before` characters before the first `here` chip, just after whitespace, and holds at most `max` characters,
 *  ending before whitespace; chips are never cut and whitespace at a cut is dropped. Characters are code points. */
export function excerptWindow(rendered: ExcerptSeg[], here: number[], max: number, before: number): Excerpt {
  const chars: { c: string; seg: number; chip: boolean }[] = []
  const segStart: number[] = []
  rendered.forEach((s, i) => {
    segStart.push(chars.length)
    for (const c of Array.from(s.text)) chars.push({ c, seg: i, chip: s.kind === 'link' })
  })
  const len = chars.length
  if (len <= max) return { segments: rendered, cutStart: false, cutEnd: false }
  const ws = (i: number) => /\s/u.test(chars[i].c) && !chars[i].chip
  const valid = here.filter((h) => h < rendered.length)
  const firstHere = valid.length ? segStart[Math.min(...valid)] : 0
  const lo = Math.max(0, firstHere - before)
  let start = firstHere
  for (let i = lo; i <= firstHere; i++) if (i === 0 || ws(i - 1)) { start = i; break }
  let end = len
  if (len - start > max) {
    const limit = start + max
    let cut: number | null = null
    for (let j = Math.min(limit, len - 1); j >= start + 1; j--) if (ws(j)) { cut = j; break }
    end = cut ?? Math.min(limit, len)
  }
  let s = start
  while (s < end && start > 0 && ws(s)) s++
  let e = end
  while (e > s && end < len && ws(e - 1)) e--
  const segments: ExcerptSeg[] = []
  rendered.forEach((seg, i) => {
    const a = segStart[i]
    const b = i + 1 < segStart.length ? segStart[i + 1] : len
    const from = Math.max(a, s)
    const to = Math.min(b, e)
    if (from >= to) return
    if (seg.kind === 'text') segments.push({ kind: 'text', text: chars.slice(from, to).map((x) => x.c).join(''), marks: [...seg.marks] })
    else segments.push(seg)
  })
  return { segments, cutStart: s > 0, cutEnd: e < len }
}
