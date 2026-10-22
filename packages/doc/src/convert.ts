// Slice 5A-2 (ms5-tasks §11.1; D-490, D-491, D-495, D-524…D-528, D-532): the conversion text helpers — the unit a
// selection converts, the new object's title, tags and body, and the host text with the unit replaced by an embed.
// These three functions are the only place that decides R51 (conversion.md); the editor applies their results.

import type { List, ListItem, Nodes, PhrasingContent } from 'mdast'
import { markdownTree, parse, type Block } from './parse.js'
import { tagKey } from './links.js'

/** The unit a selection converts (R51, D-490, D-493). Offsets are UTF-16 indexes into the whole file text. */
export type ConvertUnit = {
  kind: 'blocks' | 'items' | 'nested-item'
  /** Start of the unit's first line. */
  from: number
  /** End of its last line, without the line break. */
  to: number
  /** R50 summary: top-level blocks, or items of the run (nested children not counted, D-525). */
  count: number
  first: 'paragraph' | 'heading' | 'item' | 'quote' | 'callout' | 'other'
  /** The first item's `[x]` / `[ ]`; null when it isn't a checklist item. */
  checked: boolean | null
}

const start = (n: Nodes) => n.position!.start.offset!
const end = (n: Nodes) => n.position!.end.offset!
/** The start of the line holding `i`; on the first line, after a BOM (the BOM is never part of a unit, FR-FMT-07). */
const lineStartOf = (text: string, i: number) => {
  const s = text.lastIndexOf('\n', i - 1) + 1
  return s === 0 && text.startsWith('\ufeff') ? 1 : s
}
/** Caret semantics: a position touches a range when it lies in it or at either end. */
const touches = (s: number, e: number, from: number, to: number) => s <= to && e >= from
const MARKER = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/

function firstKind(b: Block): ConvertUnit['first'] {
  switch (b.kind) {
    case 'paragraph': return 'paragraph'
    case 'heading': return 'heading'
    case 'quote': return 'quote'
    case 'callout': return 'callout'
    case 'list': case 'checklist': return 'item'
    default: return 'other'
  }
}
const checkedOf = (i: ListItem): boolean | null => (i.checked === true || i.checked === false ? i.checked : null)

/** The deepest list item containing `from…to`, with its depth (1 = top level), or null. */
function deepestItem(text: string, list: List, from: number, to: number, depth = 1): { item: ListItem; depth: number } | null {
  for (const item of list.children) {
    // From the item's line start, so a unit (which starts there) gives itself back.
    if (lineStartOf(text, start(item)) <= from && to <= end(item)) {
      for (const child of item.children) {
        if (child.type === 'list') {
          const inner = deepestItem(text, child, from, to, depth + 1)
          if (inner) return inner
        }
      }
      return { item, depth }
    }
  }
  return null
}

/** §11.1: the unit a selection converts. Null in the frontmatter or where no block is touched. */
export function conversionUnit(text: string, selFrom: number, selTo: number): ConvertUnit | null {
  const from = Math.min(selFrom, selTo)
  const to = Math.max(selFrom, selTo)
  const doc = parse(text)
  if (from < doc.bodyStart) return null
  const hit = doc.blocks.filter((b) => touches(b.range[0], b.range[1], from, to))
  if (hit.length === 0) return null
  const first = hit[0]
  if (hit.length === 1 && (first.kind === 'list' || first.kind === 'checklist')) {
    const list = first.node as List
    const deep = deepestItem(text, list, from, to)
    if (deep && deep.depth > 1) {
      return { kind: 'nested-item', from: lineStartOf(text, start(deep.item)), to: end(deep.item), count: 1, first: 'item', checked: checkedOf(deep.item) }
    }
    const items = list.children.filter((i) => touches(start(i), end(i), from, to))
    if (items.length > 0) {
      return {
        kind: 'items', from: lineStartOf(text, start(items[0])), to: end(items[items.length - 1]), count: items.length, first: 'item', checked: checkedOf(items[0]),
      }
    }
  }
  const last = hit[hit.length - 1]
  const kind = firstKind(first)
  const checked = kind === 'item' ? checkedOf((first.node as List).children[0]) : null
  return { kind: 'blocks', from: lineStartOf(text, first.range[0]), to: last.range[1], count: hit.length, first: kind, checked }
}

// ------------------------------------------------------------------------------------------------ title and body

const lines = (s: string) => s.replace(/\r\n/g, '\n').split('\n')
const TRAILING_TAG = /(^|[ \t])#([^\s#]+)[ \t]*$/u

/** D-491: the plain text of one line of inline Markdown; links as their alias, else their target's title. */
export function plain(line: string, linkTitle: (t: string) => string | null): { text: string; link: boolean } {
  let link = false
  const walk = (n: Nodes): string => {
    switch (n.type) {
      case 'text': case 'inlineCode': return n.value
      case 'break': return ' '
      case 'tag' as never: return '#' + (n as unknown as { value: string }).value
      case 'wikiLink' as never: {
        link = true
        const value = (n as unknown as { value: string }).value.replace(/\\\|/g, '|')
        const bar = value.indexOf('|')
        if (bar >= 0) return value.slice(bar + 1)
        const target = value.split('#')[0].trim()
        return linkTitle(target) ?? target
      }
      default:
        return 'children' in n ? (n.children as Nodes[]).map(walk).join('') : 'value' in n && typeof n.value === 'string' ? n.value : ''
    }
  }
  const tree = markdownTree(line)
  const para = tree.children[0]
  const text = para && 'children' in para ? (para.children as PhrasingContent[]).map((c) => walk(c as Nodes)).join('') : line
  return { text, link }
}

/** D-491: trailing `#tags` of a line, in order and unique by key (first spelling), and the line without them. */
export function trailingTags(line: string): { rest: string; tags: string[] } {
  const found: string[] = []
  let rest = line.trimEnd()
  for (let m = TRAILING_TAG.exec(rest); m; m = TRAILING_TAG.exec(rest)) {
    found.unshift(m[2])
    rest = rest.slice(0, m.index + m[1].length).trimEnd()
  }
  const seen = new Set<string>()
  const tags = found.map((t) => t.normalize('NFC')).filter((t) => (seen.has(tagKey(t)) ? false : (seen.add(tagKey(t)), true)))
  return { rest, tags }
}

/** Lines of an item without its marker line's indent and marker; the rest de-indented by the content offset. */
function itemParts(raw: string): { first: string; continuation: string[]; children: string[] } {
  const ls = lines(raw)
  const m = MARKER.exec(ls[0])!
  const offset = m[1].length + m[2].length + m[3].length
  const strip = (l: string) => l.slice(Math.min(offset, l.length - l.trimStart().length))
  const continuation: string[] = []
  let i = 1
  // Lazy or indented continuation lines of the first paragraph, up to a blank line or a nested list item.
  for (; i < ls.length && ls[i].trim() !== '' && !MARKER.test(strip(ls[i])); i++) continuation.push(strip(ls[i]).trimStart())
  const children = ls.slice(i).map(strip)
  while (children.length > 0 && children[0].trim() === '') children.shift()
  return { first: ls[0].slice(m[0].length), continuation, children }
}

/** §11.1 (R51, D-491, D-495): the new object's title, tags and body from the unit. */
export function objectFromUnit(
  text: string,
  unit: ConvertUnit,
  linkTitle: (target: string) => string | null,
): { title: string; tags: string[]; body: string; checked: boolean | null } {
  const doc = parse(text)
  // The pieces of the unit, each as written: blocks, or (for items) one piece per top-level item.
  let pieces: string[]
  if (unit.kind === 'blocks') {
    pieces = doc.blocks.filter((b) => b.range[0] >= unit.from && b.range[1] <= unit.to).map((b) => text.slice(lineStartOf(text, b.range[0]), b.range[1]))
  } else if (unit.kind === 'nested-item') {
    const raw = text.slice(unit.from, unit.to)
    const indent = /^[ \t]*/.exec(raw)![0].length
    pieces = [lines(raw).map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length))).join('\n')]
  } else {
    const list = doc.blocks.find((b) => b.range[0] <= unit.from && unit.to <= b.range[1])!.node as List
    pieces = list.children.filter((i) => start(i) >= unit.from && end(i) <= unit.to).map((i) => text.slice(lineStartOf(text, start(i)), end(i)))
  }
  const [head, ...others] = pieces.map((p) => p.replace(/\r\n/g, '\n'))
  let firstLine: string | null = null
  let rest: string[] = []
  switch (unit.first) {
    case 'paragraph': {
      const ls = lines(head)
      firstLine = ls[0]
      if (ls.length > 1) rest = [ls.slice(1).join('\n')]
      break
    }
    case 'heading':
      firstLine = lines(head)[0].replace(/^#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '')
      break
    case 'item': {
      // A whole list as a block (D-528): its first item is the head, the other items follow as written.
      const items = unit.kind === 'blocks' ? splitItems(head) : [head]
      const p = itemParts(items[0])
      firstLine = p.first
      if (p.continuation.length > 0) rest.push(p.continuation.join('\n'))
      if (p.children.length > 0) rest.push(p.children.join('\n'))
      if (items.length > 1) rest.push(items.slice(1).join('\n'))
      break
    }
    case 'quote': case 'callout': {
      const ls = lines(head)
      const callout = unit.first === 'callout'
      const textAt = callout ? 1 : 0
      firstLine = (ls[textAt] ?? '').replace(/^>[ \t]?/, '')
      const kept = callout ? [ls[0], ...ls.slice(2)] : ls.slice(1)
      // D-532: a callout's custom title stays on its kept `[!type]` line.
      if (kept.length > 1 || (callout ? /\][+-]?[ \t]*\S/.test(ls[0]) : kept.length > 0)) rest = [kept.join('\n')]
      break
    }
    default:
      rest = [head]
  }
  let title = ''
  let tags: string[] = []
  const body: string[] = []
  if (firstLine !== null) {
    const t = trailingTags(firstLine)
    tags = t.tags
    const p = plain(t.rest, linkTitle)
    title = p.text
    if (p.link) body.push(t.rest.trim()) // D-491: no link is lost
  }
  body.push(...rest)
  const sep = unit.kind === 'items' ? '\n' : '\n\n'
  let out = body.filter((b) => b.trim() !== '').join('\n\n')
  if (others.length > 0) out = out === '' ? others.join(sep) : out + '\n\n' + others.join(sep)
  out = out.normalize('NFC').replace(/\s+$/, '')
  return { title: title.normalize('NFC').trim(), tags, body: out === '' ? '' : out + '\n', checked: unit.checked }
}

/** The top-level items of a list's source, each as written. */
function splitItems(raw: string): string[] {
  const list = markdownTree(raw).children[0] as List
  return list.children.map((i) => raw.slice(lineStartOf(raw, start(i)), end(i)))
}

// ------------------------------------------------------------------------------------------------ embed in the source

/** §11.1 (R51 "Embed in the source", D-490, D-532): the host text with the unit replaced by its embed. */
export function replaceUnitWithEmbed(text: string, unit: ConvertUnit, target: string): { text: string; embedFrom: number; embedTo: number } {
  const doc = parse(text)
  const eol = doc.eol
  const embed = `![[${target.normalize('NFC')}]]`
  if (unit.kind === 'nested-item') {
    const m = MARKER.exec(text.slice(unit.from, unit.to))!
    const line = `${m[1]}${m[2]} ${embed}`
    return { text: text.slice(0, unit.from) + line + text.slice(unit.to), embedFrom: unit.from, embedTo: unit.from + line.length }
  }
  let before = text.slice(0, unit.from)
  let after = text.slice(unit.to)
  if (before.length > doc.bodyStart && !before.endsWith(eol + eol)) before += before.endsWith(eol) ? eol : eol + eol
  if (after !== '' && after !== eol && !after.startsWith(eol + eol)) after = (after.startsWith(eol) ? eol : eol + eol) + after
  return { text: before + embed + after, embedFrom: before.length, embedTo: before.length + embed.length }
}
