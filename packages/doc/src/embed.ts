// Embeds (FR-EMB-01…04, D-416, D-419, D-420, D-422): the mode keyword, the shown section and the embeds of a body.
// Interface: docs/contracts/ms4-embeds.md §2.

import { parse, type Doc } from './parse.js'
import { wikilinks } from './links.js'

export type EmbedMode = 'full' | 'card' | 'link'

const PIPE = /\\?\|/

function mode(s: string): EmbedMode | null {
  const m = s.trim().toLowerCase()
  return m === 'full' || m === 'card' || m === 'link' ? m : null
}

/** D-416: the mode keyword of an embed's inner text, and its parts. The table-cell form `\|` counts as `|`. */
export function embedParts(value: string): { target: string; subpath: string | null; mode: EmbedMode | null; rest: string | null } {
  const pipe = PIPE.exec(value)
  const head = pipe ? value.slice(0, pipe.index) : value
  const rest = pipe ? value.slice(pipe.index + pipe[0].length) : null
  const hash = head.indexOf('#')
  return {
    target: (hash < 0 ? head : head.slice(0, hash)).trim(),
    subpath: hash < 0 ? null : head.slice(hash + 1),
    mode: rest === null ? null : mode(rest),
    rest,
  }
}

/** D-416: the inner text with the mode set; `null` removes the `|…` part. Target and subpath bytes are kept. */
export function withEmbedMode(value: string, m: EmbedMode | null): string {
  const pipe = PIPE.exec(value)
  const head = pipe ? value.slice(0, pipe.index) : value
  if (m === null) return head
  return `${head}${pipe ? pipe[0] : '|'}${m}`
}

/** D-422: the part of a note's body an embed shows; offsets are UTF-16 indexes into the whole file text. */
export type Section =
  | { kind: 'whole'; from: number; to: number }
  | { kind: 'heading'; from: number; to: number; heading: { level: number; text: string; line: number } }
  | { kind: 'block'; from: number; to: number; id: string }
  | { kind: 'missing'; subpath: string; block: boolean }

const lineOf = (text: string, at: number): number => {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++
  return n
}

const key = (s: string) => s.normalize('NFC').trim().toLowerCase()

/** A top-level heading's level and text (ATX `#` or setext). */
function headingOf(raw: string, node: { depth?: number }): { level: number; text: string } {
  const first = raw.split(/\r?\n/)[0]
  const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(first)
  if (atx) return { level: atx[1].length, text: (atx[2] ?? '').trim() }
  return { level: node.depth ?? 1, text: first.trim() }
}

const BLOCK_ID = /[ \t]\^([A-Za-z0-9-]+)[ \t]*$/

export function embedSection(text: string, subpath: string | null): Section {
  const doc = parse(text)
  if (subpath === null || subpath.trim() === '') return { kind: 'whole', from: doc.bodyStart, to: text.length }
  if (subpath.startsWith('^')) {
    const id = subpath.slice(1)
    for (const b of doc.blocks) {
      const m = BLOCK_ID.exec(b.raw.replace(/\s+$/, ''))
      if (m && m[1] === id) return { kind: 'block', from: b.range[0], to: b.range[0] + b.raw.replace(/\s+$/, '').length, id }
    }
    return { kind: 'missing', subpath, block: true }
  }
  const want = key(subpath)
  const heads = doc.blocks.filter((b) => b.kind === 'heading').map((b) => ({ b, h: headingOf(b.raw, b.node as { depth?: number }) }))
  const i = heads.findIndex((x) => key(x.h.text) === want)
  if (i < 0) return { kind: 'missing', subpath, block: false }
  const { b, h } = heads[i]
  const nl = text.indexOf('\n', b.range[0])
  const from = nl < 0 ? text.length : nl + 1
  const next = heads.slice(i + 1).find((x) => x.h.level <= h.level)
  return { kind: 'heading', from, to: next ? next.b.range[0] : text.length, heading: { level: h.level, text: h.text, line: lineOf(text, b.range[0]) } }
}

const ATTACHMENT = /\.([A-Za-z0-9]{1,6})$/
/** A target with a non-`.md` extension that isn't a date: an attachment (R5 placeholder, D-144). */
export function isAttachmentTarget(target: string): boolean {
  const m = ATTACHMENT.exec(target)
  return !!m && m[1].toLowerCase() !== 'md' && !/^\d{4}-\d{2}-\d{2}$/.test(target)
}

/** D-419: the block embeds (sole-embed paragraphs at the top level) and the inline embeds of a body, in file order. */
export function embedsIn(text: string, from?: number, to?: number): { block: { value: string; line: number }[]; inline: { value: string; line: number }[] } {
  return embedsInDoc(parse(text), from, to)
}

export function embedsInDoc(doc: Doc, from = 0, to = doc.text.length): { block: { value: string; line: number }[]; inline: { value: string; line: number }[] } {
  const text = doc.text
  const block: { value: string; line: number }[] = []
  const blockRanges: [number, number][] = []
  for (const b of doc.blocks) {
    if (b.kind !== 'embed' || b.range[0] < from || b.range[0] >= to) continue
    const t = b.raw.trim()
    blockRanges.push([b.range[0], b.range[1]])
    const value = t.slice(3, -2)
    if (isAttachmentTarget(embedParts(value).target)) continue
    block.push({ value, line: lineOf(text, b.range[0] + b.raw.indexOf('![[')) })
  }
  const inline: { value: string; line: number }[] = []
  for (const l of wikilinks(doc)) {
    if (!l.embed || l.inFrontmatter || l.range[0] < from || l.range[0] >= to) continue
    if (blockRanges.some(([s, e]) => l.range[0] >= s && l.range[0] < e)) continue
    if (l.target === '' || isAttachmentTarget(l.target)) continue
    inline.push({ value: text.slice(l.range[0] + 3, l.range[1] - 2), line: lineOf(text, l.range[0]) })
  }
  return { block, inline }
}
