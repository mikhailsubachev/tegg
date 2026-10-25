// Edits are patches on the original text (dialect §1.2). Each function returns
// the new file text; callers re-parse. Nothing outside the patched ranges changes.

import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { isMap, isScalar, parseDocument, Scalar, stringify } from 'yaml'
import type { RootContent } from 'mdast'
import { wikilinks, nameKey } from './links.js'
import { mathToMarkdown } from 'mdast-util-math'
import { inlineToMarkdown } from './inline.js'
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
// GFM escapes `@` between word characters (`a\@b`) to stop e-mail autolinks, but the escape doesn't stop them
// (`eva\@example.com` still reads back as a link), so it only adds bytes the user didn't type. Without it, text is
// written as typed (bug_3d_fr_edt_08_email_in_body_saves, FR-EDT-06 AC-8).
const GFM = ((g) => ({ ...g, extensions: g.extensions?.map((e) => ({ ...e, unsafe: e.unsafe?.filter((u) => u.character !== '@') })) }))(gfmToMarkdown())

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
      extensions: [GFM, mathToMarkdown(), wikiLinkToMarkdown, tagToMarkdown, inlineToMarkdown],
    },
  )
  let out = md.replace(/\n+$/, '') // a block's range never includes the separating newline
  // Callouts: to-markdown escapes the `[` of `> [!note]`, which would turn the callout into a quote.
  if (node.type === 'blockquote') out = out.replace(/^> \\\[!/, '> [!')
  // D-765 (mm-mindmap §3.1): a mindmap's list follows its title line directly; its body is read on its own. Only a
  // body that starts with a list: a hint callout's text keeps its blank line (D-680).
  if (node.type === 'blockquote' && /^> \[!mindmap\]/i.test(out)) out = out.replace(/^([^\n]*)\n>\n(?=> {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|\n|$))/, '$1\n')
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
  return formatKey(key) + formatValuePart(value)
}

/** ms3-shell §14.5 key rule (bug_3d_fr_edt_07): a key Tegg writes fresh is plain when it consists of Unicode letters,
 *  digits, `-`, `_` and spaces, doesn't start with `-` or a space, and YAML reads it back as the same string; else
 *  double-quoted. Keys of existing entries are never re-formatted (`entryKeyText`). */
export function formatKey(key: string): string {
  const k = key.normalize('NFC')
  if (/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(k) && readsBackAsKey(k)) return k
  return JSON.stringify(k)
}

function readsBackAsKey(k: string): boolean {
  try {
    const d = parseDocument(`${k}: x\n`)
    if (d.errors.length || !isMap(d.contents)) return false
    const items = d.contents.items
    return items.length === 1 && isScalar(items[0].key) && items[0].key.value === k
  } catch {
    return false
  }
}

/** The value part of an entry, everything after the key: `: v\n`, `:\n  - a\n`, `: |-\n  …\n`. */
function formatValuePart(value: Value): string {
  // Multi-line text needs a block scalar indented under its key (or list item); let `yaml` lay it out
  // (bug_ms1_fr_fmt_01). Every other value keeps the dialect formatter below.
  if (hasMultiline(value)) {
    const plain = (v: Value): unknown => (Array.isArray(v) ? v.map(plain) : typeof v === 'string' ? v.normalize('NFC') : formatScalar(v))
    return stringify({ k: plain(value) }, { lineWidth: 0 }).slice(1)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `: []\n`
    return `:\n` + value.map((v) => `  - ${formatScalar(v)}\n`).join('')
  }
  return `: ${formatScalar(value)}\n`
}

function hasMultiline(v: Value): boolean {
  return typeof v === 'string' ? v.includes('\n') : Array.isArray(v) && v.some(hasMultiline)
}

export function formatScalar(v: Value): string {
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
    const nfc = v.normalize('NFC')
    // A text that looks like a date or date-time stays text: YAML 1.1 readers (and the dialect, §3) would read it
    // as a date, so it is double-quoted (D-230, FR-EDT-07 AC-5).
    if (/^\d{4}-\d{1,2}-\d{1,2}(?:([Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(\.\d*)?([ \t]*(Z|[-+]\d{1,2}(:\d{2})?))?)?$/.test(nfc)) return JSON.stringify(nfc)
    // Text with a link is always double-quoted, so it reads as one string with the link in it (D-249, D-257).
    if (nfc.includes('[[')) return JSON.stringify(nfc)
    const s = new Scalar(nfc)
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
  if (existing) return applyPatches(doc.text, [{ range: existing.range, text: entryKeyText(doc, existing.range) + fit(doc, formatValuePart(value)) }])
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

// ---------------------------------------------------------------- slice 3D: panel values (ms3-shell §14.5, D-230)

/** The key text of an existing entry as written in the source, up to (not including) its `:`. */
export function entryKeyText(doc: Doc, range: Range): string {
  const raw = doc.text.slice(range[0], range[1])
  let i = 0
  if (raw[0] === '"') {
    i = 1
    while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1
    i++
  } else if (raw[0] === "'") {
    i = 1
    while (i < raw.length) {
      if (raw[i] === "'" && raw[i + 1] === "'") i += 2
      else if (raw[i] === "'") break
      else i++
    }
    i++
  }
  const m = /:(?=[ \t\r\n]|$)/.exec(raw.slice(i))
  if (!m) throw new Error('Entry without a key separator')
  return raw.slice(0, i + m.index)
}

function isClear(v: Value): boolean {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** The value part for an existing entry, keeping its style where the new value allows (D-230). */
function styledValuePart(oldRaw: string, keyLen: number, value: Value): string {
  const old = oldRaw.slice(keyLen + 1).replace(/^[ \t]+/, '')
  if (Array.isArray(value) && !hasMultiline(value) && old.startsWith('[')) {
    return `: [${value.map(flowItem).join(', ')}]\n`
  }
  if (typeof value === 'string' && !value.includes('\n')) {
    const v = value.normalize('NFC')
    if (old.startsWith("'")) return `: '${v.replace(/'/g, "''")}'\n`
    if (old.startsWith('"')) return `: ${JSON.stringify(v)}\n`
  }
  return formatValuePart(value)
}

function flowItem(v: Value): string {
  const s = formatScalar(v)
  if (s.startsWith('"') || s.startsWith("'")) return s
  return /[,[\]{}]/.test(s) || s === '' ? JSON.stringify(typeof v === 'string' ? v.normalize('NFC') : s) : s
}

function checkWritable(doc: Doc): void {
  if (doc.frontmatter?.error || doc.frontmatterError) throw new Error('Frontmatter is invalid; it is never rewritten automatically (NFR-REL-03)')
}

/** One entry's patch: replace (keeping key text and style), remove, or nothing when absent. */
function entryPatch(doc: Doc, key: string, value: Value): Patch | null {
  const e = doc.frontmatter?.entries.find((x) => x.key === key)
  if (!e) return null
  if (isClear(value)) return { range: e.range, text: '' }
  const keyText = entryKeyText(doc, e.range)
  const raw = doc.text.slice(e.range[0], e.range[1])
  return { range: e.range, text: keyText + fit(doc, styledValuePart(raw, keyText.length, value)) }
}

/** New entries appended after the last entry (a file without frontmatter gets one, D-174). */
function appendEntries(doc: Doc, text: string, extra: Patch[] = []): string {
  const fm = doc.frontmatter
  if (!fm) {
    const at = doc.bom ? 1 : 0
    return applyPatches(doc.text, [...extra, { range: [at, at], text: fit(doc, `---\n`) + text + fit(doc, `---\n`) }])
  }
  const end = fm.innerRange[1]
  const needsNl = end > fm.innerRange[0] && doc.text[end - 1] !== '\n'
  return applyPatches(doc.text, [...extra, { range: [end, end], text: (needsNl ? doc.eol : '') + text }])
}

/** D-230: set one frontmatter value (contract §14.5). */
export function setValue(doc: Doc, key: string, value: Value): string {
  checkWritable(doc)
  const p = entryPatch(doc, key, value)
  if (p) return applyPatches(doc.text, [p])
  if (isClear(value)) return doc.text
  return appendEntries(doc, fit(doc, formatEntry(key, value)))
}

/** 5A-1 (ms5-tasks §5, D-478): set a list value keeping its flow or block style; a new entry is written in flow style
 *  (`tags: [a, b]`, FR-TSK-05 AC-4) after the last entry. An empty list removes the entry. */
export function setFlowList(doc: Doc, key: string, items: Value[]): string {
  checkWritable(doc)
  if (doc.frontmatter?.entries.some((x) => x.key === key)) return setValue(doc, key, items)
  if (items.length === 0) return doc.text
  return appendEntries(doc, fit(doc, `${formatKey(key)}: [${items.map(flowItem).join(', ')}]\n`))
}

/** The flow form of a list value, as `setFlowList` writes it. */
export function flowList(items: Value[]): string {
  return `[${items.map(flowItem).join(', ')}]`
}

/** Date range: both halves in one edit, consecutive lines; null clears that half (FR-TYP-02, D-230). */
export function setRange(doc: Doc, key: string, start: string | null, end: string | null): string {
  checkWritable(doc)
  const ks = `${key}-start`
  const ke = `${key}-end`
  const vs: Value = start === null ? null : { date: start }
  const ve: Value = end === null ? null : { date: end }
  const entries = doc.frontmatter?.entries ?? []
  const es = entries.find((x) => x.key === ks)
  const ee = entries.find((x) => x.key === ke)
  const patches: Patch[] = []
  let append = ''
  const ps = entryPatch(doc, ks, vs)
  const pe = entryPatch(doc, ke, ve)
  if (ps) patches.push(ps)
  if (pe) patches.push(pe)
  if (!es && vs !== null) {
    const line = fit(doc, formatEntry(ks, vs))
    if (ee) patches.unshift({ range: [ee.range[0], ee.range[0]], text: line })
    else append += line
  }
  if (!ee && ve !== null) {
    const line = fit(doc, formatEntry(ke, ve))
    if (es) patches.unshift({ range: [es.range[1], es.range[1]], text: line })
    else append += line
  }
  if (append) return appendEntries(doc, append, patches)
  return patches.length ? applyPatches(doc.text, patches) : doc.text
}
