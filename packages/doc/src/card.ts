// The start of a body as simplified Markdown for object cards (D-590, inbox.md R60, FR-INB-01 AC-13): paragraphs with
// their line breaks, headings, list items with bullets, numbers and checkboxes, bold/italic/strike/code inline; links
// and wikilinks as their text, images and embeds as placeholders, tables and code blocks as their first line. Built from
// the one parse (D-82); raw HTML stays literal text, so nothing from the file is ever rendered as HTML.

import type { Nodes, RootContent } from 'mdast'
import { isAttachmentTarget } from './embed.js'
import { parse } from './parse.js'

export type CardMark = 'strong' | 'em' | 'strike' | 'code'
export type CardSpan =
  | { kind: 'text'; text: string; marks: CardMark[] }
  | { kind: 'break' }
  /** `![[photo.png]]`, `![alt](x.png)`. */
  | { kind: 'image' }
  /** `![[Note]]`, `![[file.pdf]]`: the target's name. */
  | { kind: 'embed'; name: string }
export interface CardItem { checked: boolean | null; spans: CardSpan[] }
export type CardBlock =
  | { kind: 'paragraph'; spans: CardSpan[] }
  | { kind: 'heading'; spans: CardSpan[] }
  | { kind: 'list'; ordered: boolean; start: number; items: CardItem[] }

/** Neighbouring texts with the same marks become one span (inline HTML arrives as several nodes). */
function merged(spans: CardSpan[]): CardSpan[] {
  const out: CardSpan[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (s.kind === 'text' && last?.kind === 'text' && last.marks.join() === s.marks.join()) out[out.length - 1] = { ...last, text: last.text + s.text }
    else out.push(s)
  }
  return out
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|heic|avif|bmp|tiff?)$/i

/** The first blocks of `text`'s body (frontmatter skipped), at most `maxBlocks` blocks and about `maxChars` characters. */
export function cardBlocks(text: string, maxBlocks = 12, maxChars = 600): CardBlock[] {
  const doc = parse(text)
  const out: CardBlock[] = []
  let chars = 0
  const full = () => out.length >= maxBlocks || chars >= maxChars
  const count = (spans: CardSpan[]) => { for (const s of spans) chars += s.kind === 'text' ? s.text.length : 1 }

  const inline = (nodes: readonly Nodes[], marks: CardMark[], spans: CardSpan[]): void => {
    for (const n of nodes) {
      switch (n.type) {
        case 'text': {
          const parts = n.value.split('\n')
          parts.forEach((p, i) => {
            if (i > 0) spans.push({ kind: 'break' })
            if (p) spans.push({ kind: 'text', text: p, marks })
          })
          break
        }
        case 'break': spans.push({ kind: 'break' }); break
        case 'strong': inline(n.children, [...marks, 'strong'], spans); break
        case 'emphasis': inline(n.children, [...marks, 'em'], spans); break
        case 'delete': inline(n.children, [...marks, 'strike'], spans); break
        case 'inlineCode': spans.push({ kind: 'text', text: n.value, marks: [...marks, 'code'] }); break
        case 'link': case 'linkReference': inline(n.children, marks, spans); break
        case 'image': case 'imageReference': spans.push({ kind: 'image' }); break
        case 'html': spans.push({ kind: 'text', text: n.value, marks }); break
        default: {
          const x = n as unknown as { type: string; value?: string; embed?: boolean; children?: Nodes[] }
          if (x.type === 'wikiLink') {
            const inner = (x.value ?? '').replace(/\\\|/g, '|')
            const bar = inner.indexOf('|')
            const target = (bar < 0 ? inner : inner.slice(0, bar)).replace(/#.*$/, '').trim()
            if (x.embed) spans.push(isAttachmentTarget(target) && IMAGE.test(target) ? { kind: 'image' } : { kind: 'embed', name: target.replace(/\.md$/i, '') })
            else spans.push({ kind: 'text', text: bar < 0 ? inner.trim() : inner.slice(bar + 1).trim(), marks })
          } else if (x.type === 'comment') {
            // %% comments %% are hidden, as in the read view
          } else if (typeof x.value === 'string') spans.push({ kind: 'text', text: x.value, marks })
          else if (x.children) inline(x.children, marks, spans)
        }
      }
    }
  }
  const spansOf = (nodes: readonly Nodes[]): CardSpan[] => { const s: CardSpan[] = []; inline(nodes, [], s); return merged(s) }
  const push = (b: CardBlock) => {
    if (full()) return
    if (b.kind === 'list') { if (b.items.length === 0) return; for (const i of b.items) count(i.spans) } else { if (b.spans.length === 0) return; count(b.spans) }
    out.push(b)
  }
  const block = (n: RootContent): void => {
    if (full()) return
    switch (n.type) {
      case 'paragraph': push({ kind: 'paragraph', spans: spansOf(n.children) }); break
      case 'heading': push({ kind: 'heading', spans: spansOf(n.children) }); break
      case 'list': {
        const items: CardItem[] = []
        for (const li of n.children) {
          const first = li.children.find((c) => c.type === 'paragraph')
          items.push({ checked: typeof li.checked === 'boolean' ? li.checked : null, spans: first && first.type === 'paragraph' ? spansOf(first.children) : [] })
        }
        push({ kind: 'list', ordered: !!n.ordered, start: n.start ?? 1, items })
        break
      }
      case 'blockquote': for (const c of n.children) block(c); break
      case 'code': { const line = n.value.split('\n')[0]; if (line) push({ kind: 'paragraph', spans: [{ kind: 'text', text: line, marks: ['code'] }] }); break }
      case 'math': { const line = n.value.split('\n')[0]; if (line) push({ kind: 'paragraph', spans: [{ kind: 'text', text: line, marks: ['code'] }] }); break }
      case 'html': push({ kind: 'paragraph', spans: [{ kind: 'text', text: n.value.split('\n')[0], marks: [] }] }); break
      case 'table': {
        const row = n.children[0]
        if (row) {
          const spans: CardSpan[] = []
          row.children.forEach((cell, i) => { if (i > 0) spans.push({ kind: 'text', text: ' · ', marks: [] }); inline(cell.children, [], spans) })
          push({ kind: 'paragraph', spans: merged(spans) })
        }
        break
      }
      default: break // thematic breaks, definitions, footnotes
    }
  }
  for (const b of doc.mdast.children) block(b)
  return out
}
