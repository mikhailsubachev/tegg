// Wikilinks, embeds and tags (FR-FMT-03, -04, -10, -12; dialect §5–6).
// Scanned on the raw text, skipping ranges where links aren't links
// (code, HTML, %% comments), so positions are exact source ranges for patching.

import type { Nodes } from 'mdast'
import type { Doc, Range } from './parse.js'

export interface WikiLink {
  embed: boolean
  range: Range // whole `[[…]]` / `![[…]]`
  targetRange: Range // just the note/file name part, for renames
  target: string // name without #heading/#^block and alias
  subpath: string | null // `Heading`, `^blockid`, `page=3`
  alias: string | null // alias or embed size
  escapedPipe: boolean // `\|` form (inside tables)
  inFrontmatter: boolean
  /** Top-level frontmatter key the link is in; null for body links (D-257, FR-LNK-02 AC-1). */
  attribute: string | null
}

const WIKILINK = /(!?)\[\[([^\[\]\n]+?)\]\]/g

export function wikilinks(doc: Doc): WikiLink[] {
  const out: WikiLink[] = []
  const fm = doc.frontmatter
  if (fm) scanLinks(doc.text, fm.innerRange, frontmatterCode(doc.text, fm.innerRange), true, out)
  scanLinks(doc.text, [doc.bodyStart, doc.text.length], excludedRanges(doc), false, out)
  return out
}

function scanLinks(text: string, [from, to]: Range, excluded: Range[], inFrontmatter: boolean, out: WikiLink[]): void {
  WIKILINK.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = WIKILINK.exec(text)) && m.index < to) {
    const start = m.index
    const end = start + m[0].length
    if (end > to || inside(excluded, start)) continue
    const innerStart = start + m[1].length + 2
    const inner = m[2]
    const pipe = /\\?\|/.exec(inner)
    const ref = pipe ? inner.slice(0, pipe.index) : inner
    const hash = ref.indexOf('#')
    const name = hash === -1 ? ref : ref.slice(0, hash)
    out.push({
      embed: m[1] === '!',
      range: [start, end],
      targetRange: [innerStart, innerStart + name.length],
      target: name.trim(),
      subpath: hash === -1 ? null : ref.slice(hash + 1),
      alias: pipe ? inner.slice(pipe.index + pipe[0].length) : null,
      escapedPipe: pipe?.[0] === '\\|',
      inFrontmatter,
      attribute: inFrontmatter ? attributeAt(text, from, start) : null,
    })
  }
}

/** The top-level key whose entry holds offset `at`: the last unindented `key:` line at or before it. */
function attributeAt(text: string, from: number, at: number): string | null {
  const KEY = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"\-][^:\n]*?|-[^\s:][^:\n]*?))[ \t]*:(?=[ \t]|\r?\n|$)/gm
  KEY.lastIndex = from
  let key: string | null = null
  let m: RegExpExecArray | null
  while ((m = KEY.exec(text)) && m.index <= at) key = (m[1] ?? m[2]?.replace(/''/g, "'") ?? m[3]).normalize('NFC')
  return key
}

/** Backtick code spans inside frontmatter values: links there aren't links (dialect §6, FR-LNK-02 AC-1). */
function frontmatterCode(text: string, [from, to]: Range): Range[] {
  const out: Range[] = []
  const CODE = /`[^`\n]*`/g
  CODE.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = CODE.exec(text)) && m.index < to) out.push([m.index, m.index + m[0].length])
  return out
}

// ---------------------------------------------------------------- tags

export interface Tag {
  name: string // as written, without '#'
  key: string // matching key: NFC + lower case
  range: Range | null // null for frontmatter tags
}

// '#' at line start or after whitespace/'(' ; name of letters, combining marks, digits, _ - /
// with a non-digit. \p{M} is required for NFD text, where `č` is `c` + U+030C (finding from S1).
const TAG = /(?<=^|[\s(])#([\p{L}\p{M}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{M}\p{N}_\-/]*)/gmu

export function tags(doc: Doc): Tag[] {
  const out: Tag[] = []
  const fmTags = doc.frontmatter?.data?.tags
  const list = Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? [fmTags] : []
  for (const t of list) if (typeof t === 'string' && t) out.push({ name: t, key: tagKey(t), range: null })

  const excluded = [...excludedRanges(doc, true), ...wikilinks(doc).map((l) => l.range)]
  TAG.lastIndex = doc.bodyStart
  let m: RegExpExecArray | null
  while ((m = TAG.exec(doc.text))) {
    if (inside(excluded, m.index)) continue
    out.push({ name: m[1], key: tagKey(m[1]), range: [m.index, m.index + m[0].length] })
  }
  return out
}

export const tagKey = (name: string): string => name.normalize('NFC').toLowerCase()

// ---------------------------------------------------------------- resolution

/** Link-matching key for a note or file name (dialect §6, FR-FMT-12). */
export const nameKey = (name: string): string => name.normalize('NFC').toLowerCase().trim()

/** Resolve a link target against vault paths (relative, with folders). */
export function resolve(target: string, paths: string[]): string | null {
  const key = nameKey(target)
  const matches = paths.filter((p) => {
    const base = p.split('/').pop()!
    return nameKey(base.replace(/\.md$/i, '')) === key || nameKey(base) === key
  })
  if (matches.length === 0) return null
  return matches.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]
}

// ---------------------------------------------------------------- helpers

function excludedRanges(doc: Doc, forTags = false): Range[] {
  const out: Range[] = []
  const walk = (n: Nodes): void => {
    const p = n.position
    // math / inlineMath: proposed in spike S4 (AP-15), as Obsidian doesn't read links or tags in math.
    const MATH = n.type === 'math' || n.type === 'inlineMath'
    if (p && (n.type === 'code' || n.type === 'inlineCode' || n.type === 'html' || MATH || (forTags && n.type === 'link'))) {
      out.push([p.start.offset!, p.end.offset!])
      return
    }
    if ('children' in n) for (const c of n.children) walk(c as Nodes)
  }
  walk(doc.mdast)
  const comment = /%%[\s\S]*?%%/g
  comment.lastIndex = doc.bodyStart
  let m: RegExpExecArray | null
  while ((m = comment.exec(doc.text))) out.push([m.index, m.index + m[0].length])
  return out
}

function inside(ranges: Range[], i: number): boolean {
  return ranges.some(([s, e]) => i >= s && i < e)
}
