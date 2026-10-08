// Edits are patches on the original text (dialect §1.2). Each function returns
// the new file text; callers re-parse. Nothing outside the patched ranges changes.

import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { Scalar, stringify } from 'yaml'
import type { RootContent } from 'mdast'
import { wikilinks, nameKey } from './links.js'
import { tagToMarkdown } from './tag.js'
import { wikiLinkToMarkdown } from './wikilink.js'
import { parse, type Doc, type Range } from './parse.js'

export interface Patch {
  range: Range
  text: string
}

export function applyPatches(text: string, patches: Patch[]): string {
  const sorted = [...patches].sort((a, b) => a.range[0] - b.range[0])
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].range[0] < sorted[i - 1].range[1]) throw new Error('Overlapping patches')
  }
  let out = ''
  let pos = 0
  for (const p of sorted) {
    out += text.slice(pos, p.range[0]) + p.text
    pos = p.range[1]
  }
  return out + text.slice(pos)
}

/** Convert new text to the file's line endings (FR-STO-02 AC-2) and NFC (FR-FMT-12). */
function fit(doc: Doc, s: string): string {
  const nfc = s.normalize('NFC')
  return doc.eol === '\r\n' ? nfc.replace(/\r?\n/g, '\r\n') : nfc
}

// ---------------------------------------------------------------- blocks

/**
 * Markdown for one block. New blocks use the canonical style (dialect §4).
 * An edited existing block keeps its list marker style (`originalRaw`): a list's
 * marker is what separates it from an adjacent list, so changing `1)` to `1.` or
 * `*` to `-` would merge two lists into one (finding from S1).
 */
export function renderBlock(node: RootContent, originalRaw?: string): string {
  const marker = originalRaw?.trimStart().match(/^(?:([-*+])|\d+([.)]))[ \t]/)
  const md = toMarkdown(
    { type: 'root', children: [node] },
    {
      bullet: (marker?.[1] as '-' | '*' | '+' | undefined) ?? '-',
      bulletOrdered: (marker?.[2] as '.' | ')' | undefined) ?? '.',
      emphasis: '*',
      strong: '*',
      rule: '-',
      fence: '`',
      fences: true,
      listItemIndent: 'one',
      extensions: [gfmToMarkdown(), wikiLinkToMarkdown, tagToMarkdown],
    },
  )
  let out = md.replace(/\n+$/, '') // a block's range never includes the separating newline
  // Callouts: to-markdown escapes the `[` of `> [!note]`, which would turn the callout into a quote.
  if (node.type === 'blockquote') out = out.replace(/^> \\\[!/, '> [!')
  // Keep trailing empty quote lines (`>`): they stop the next line from becoming a lazy
  // continuation of the quote when no blank line follows (finding from S1).
  const trailing = node.type === 'blockquote' ? originalRaw?.match(/(?:\r?\n>[ \t]*)+$/)?.[0] : undefined
  if (trailing) out += trailing.replace(/\r\n/g, '\n')
  return out
}

/**
 * Replace block `index` with new Markdown. Only that block's bytes change.
 * The result is verified by re-parsing: the block count and every other block must be
 * unchanged. If CommonMark adjacency rules would merge the edited block with a neighbour
 * (e.g. lazy continuation), a blank line is added to the gap next to the block — the
 * smallest change outside the block that keeps the structure. If that doesn't help, throw.
 */
export function editBlock(doc: Doc, index: number, markdown: string): string {
  const block = doc.blocks[index]
  if (!block) throw new Error(`No block ${index}`)
  if (block.kind === 'raw') throw new Error('Raw blocks are preserved and not edited through the editor')
  const text = fit(doc, markdown)
  const attempts = [text, text + doc.eol, doc.eol + text, doc.eol + text + doc.eol]
  for (const replacement of attempts) {
    const out = applyPatches(doc.text, [{ range: block.range, text: replacement }])
    if (structureKept(doc, parse(out), index)) return out
  }
  throw new Error(`Edit of block ${index} would change the structure of neighbouring blocks`)
}

function structureKept(before: Doc, after: Doc, index: number): boolean {
  return (
    after.blocks.length === before.blocks.length &&
    after.blocks.every((b, i) => i === index || b.raw === before.blocks[i].raw)
  )
}

// ---------------------------------------------------------------- attributes

export type Value =
  | string | number | boolean | null
  | { date: string } // YYYY-MM-DD
  | { datetime: string } // ISO 8601 with offset
  | { link: string } // relation → "[[Note]]"
  | Value[]

export function formatEntry(key: string, value: Value): string {
  const k = /^[\w-]+$/.test(key) ? key : JSON.stringify(key)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${k}: []\n`
    return `${k}:\n` + value.map((v) => `  - ${formatScalar(v)}\n`).join('')
  }
  return `${k}: ${formatScalar(value)}\n`
}

function formatScalar(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('date' in v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error(`Not a date: ${v.date}`)
      return v.date
    }
    if ('datetime' in v) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/.test(v.datetime)) {
        throw new Error(`Not an ISO date-time with offset: ${v.datetime}`)
      }
      return v.datetime
    }
    if ('link' in v) return JSON.stringify(`[[${v.link.normalize('NFC')}]]`)
  }
  if (typeof v === 'string') {
    const s = new Scalar(v.normalize('NFC'))
    // Plain when YAML allows it; double quotes otherwise (dialect §3).
    return stringify(s, { defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN', lineWidth: 0 }).replace(/\n$/, '')
  }
  return String(v)
}

/** Set one attribute. Existing entry: only its lines change. New entry: appended last. */
export function setAttribute(doc: Doc, key: string, value: Value): string {
  const fm = doc.frontmatter
  const entry = fit(doc, formatEntry(key, value))
  if (!fm) {
    const at = doc.bom ? 1 : 0
    return applyPatches(doc.text, [{ range: [at, at], text: fit(doc, `---\n`) + entry + fit(doc, `---\n`) }])
  }
  if (fm.error) throw new Error('Frontmatter is invalid; it is never rewritten automatically (NFR-REL-03)')
  const existing = fm.entries.find((e) => e.key === key)
  if (existing) return applyPatches(doc.text, [{ range: existing.range, text: entry }])
  // Append before the closing delimiter; make sure the previous line is terminated.
  const end = fm.innerRange[1]
  const needsNl = end > fm.innerRange[0] && doc.text[end - 1] !== '\n'
  return applyPatches(doc.text, [{ range: [end, end], text: (needsNl ? doc.eol : '') + entry }])
}

/** Date range attribute → `<key>-start` and `<key>-end` (FR-TYP-02, FR-FMT-11 AC-4). */
export function setDateRange(doc: Doc, key: string, start: string, end: string): string {
  const once = setAttribute(doc, `${key}-start`, { date: start })
  return setAttribute(parse(once), `${key}-end`, { date: end })
}

export function removeAttribute(doc: Doc, key: string): string {
  const entry = doc.frontmatter?.entries.find((e) => e.key === key)
  return entry ? applyPatches(doc.text, [{ range: entry.range, text: '' }]) : doc.text
}

// ---------------------------------------------------------------- links

/** Rename every link to `from` (any form, body and frontmatter) to `to`. Only target names change. */
export function renameLinkTarget(doc: Doc, from: string, to: string): string {
  const key = nameKey(from)
  const patches = wikilinks(doc)
    .filter((l) => nameKey(l.target) === key)
    .map((l): Patch => ({ range: l.targetRange, text: to.normalize('NFC') }))
  return patches.length ? applyPatches(doc.text, patches) : doc.text
}
