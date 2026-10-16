// Tegg document engine: source-preserving Markdown documents (ADR 0001, ADR 0003).
// Public interface: docs/contracts/ms1-core.md §4. Ported from spike S1 (D-83).

import { parse, type Doc } from './parse.js'
import { formatEntry, setAttribute, type Value } from './edit.js'

export type { Range, BlockKind, Block, FrontmatterEntry, Frontmatter, Doc } from './parse.js'
export { decode, encode, parse, markdownTree } from './parse.js'
export { editBlock, formatScalar, renderBlock, setAttribute, setDateRange, removeAttribute, renameLinkTarget, type Value } from './edit.js'
export { tags, tagKey, type Tag } from './links.js'
import { wikilinks as scanLinks } from './links.js'

/** A link as the contract defines it (§4); the engine's internal `targetRange` is used only for renames. */
export interface WikiLink {
  embed: boolean
  range: readonly [number, number]
  target: string
  subpath: string | null
  alias: string | null
  escapedPipe: boolean
  inFrontmatter: boolean
}
export function wikilinks(doc: Doc): WikiLink[] {
  return scanLinks(doc).map(({ embed, range, target, subpath, alias, escapedPipe, inFrontmatter }) => ({ embed, range, target, subpath, alias, escapedPipe, inFrontmatter }))
}
export { extract, type Extracted } from './extract.js'
export { excerptWindow, atOf, type At, type BlockText, type Excerpt, type ExcerptSeg, type Mark, type Segment, type LinkTarget } from './excerpt.js'

/** FR-FMT-07: a Doc is the original text plus ranges, so serializing never regenerates anything. */
export function serialize(doc: Doc): string {
  return doc.text
}

/** D-96: `type` is the type name in lower case with spaces as `-` ('Quick Note' → `quick-note`). */
export function typeKey(type: string): string {
  return type.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-')
}

/** FR-FMT-02 AC-1, D-96: keys `id, type, title, <attributes>, created, modified`, then the body. */
export function newNote(opts: { type: string; title: string; attributes?: [string, Value][]; body?: string; now: string; newId: () => string }): string {
  const entries: [string, Value][] = [
    ['id', opts.newId()],
    ['type', typeKey(opts.type)],
    ['title', opts.title.normalize('NFC')],
    ...(opts.attributes ?? []).filter(([, v]) => v !== null),
    ['created', { datetime: opts.now }],
    ['modified', { datetime: opts.now }],
  ]
  const body = (opts.body ?? '').normalize('NFC')
  const head = '---\n' + entries.map(([k, v]) => formatEntry(k, v)).join('') + '---\n'
  // Canonical style: the body starts on the line after the closing `---` (as the Tegg fixtures).
  return body === '' ? head : head + (body.endsWith('\n') ? body : body + '\n')
}

/** FR-FMT-02 AC-3, D-54: the first edit of a file without `id` adds `id` and `type: page`, nothing else. */
export function ensureIdentity(doc: Doc, opts: { now: string; newId: () => string }): string {
  const data = doc.frontmatter?.data ?? null
  if (doc.frontmatter?.error) return doc.text // invalid YAML is never rewritten automatically (NFR-REL-03)
  if (data && typeof data.id === 'string' && data.id.trim() !== '') return doc.text
  let text = setAttribute(doc, 'id', opts.newId())
  const after = parse(text)
  if (!(after.frontmatter?.data && typeof after.frontmatter.data.type === 'string')) text = setAttribute(after, 'type', 'page')
  return text
}

/** FR-FMT-02 AC-4, D-55: `modified` changes only when content or attributes changed. */
export function touchModified(before: string, after: string, now: string): string {
  const strip = (t: string) => {
    const d = parse(t)
    const e = d.frontmatter?.entries.find((x) => x.key === 'modified')
    return e ? t.slice(0, e.range[0]) + t.slice(e.range[1]) : t
  }
  if (strip(before) === strip(after)) return after
  return setAttribute(parse(after), 'modified', { datetime: now })
}

// ---------------------------------------------------------------- slice 3D (ms3-shell §14.5)

export { setValue, setRange } from './edit.js'

/** D-232, FR-TYP-03 AC-12: the bytes of a new object. Order: `id`, `type`, `title`; each schema attribute (the
 *  template's entry verbatim, else its default, else omitted); the template's other entries verbatim (minus identity,
 *  `review`, `created`, `modified`); `review: unreviewed` when review is on or locked; `created`, `modified`; the
 *  template's body verbatim. A template with invalid frontmatter contributes only its body (§14.10 item 9). */
export function newObject(opts: {
  type: { key: string; attributes: { key: string; type: string; default?: unknown }[]; review: 'off' | 'on' | 'locked' }
  title: string
  template: string | null
  now: string
  newId: () => string
}): string {
  const tpl = opts.template === null ? null : parse(opts.template)
  const tplEntries = new Map<string, string>()
  if (tpl?.frontmatter && !tpl.frontmatter.error) {
    for (const e of tpl.frontmatter.entries) {
      let raw = tpl.text.slice(e.range[0], e.range[1]).replace(/\r\n/g, '\n')
      if (!raw.endsWith('\n')) raw += '\n'
      tplEntries.set(e.key.normalize('NFC'), raw.normalize('NFC'))
    }
  }
  let out = '---\n' + formatEntry('id', opts.newId()) + formatEntry('type', opts.type.key.normalize('NFC')) + formatEntry('title', opts.title.normalize('NFC'))
  const used = new Set<string>(['id', 'type', 'title', 'review', 'created', 'modified'])
  for (const a of opts.type.attributes) {
    const key = a.key.normalize('NFC')
    if (a.type === 'date-range') {
      for (const half of [`${key}-start`, `${key}-end`]) {
        used.add(half)
        const t = tplEntries.get(half)
        if (t !== undefined) out += t
      }
      continue
    }
    used.add(key)
    const t = tplEntries.get(key)
    if (t !== undefined) out += t
    else {
      const v = defaultValue(a.type, a.default)
      if (v !== null) out += formatEntry(key, v)
    }
  }
  for (const [k, raw] of tplEntries) if (!used.has(k)) out += raw
  if (opts.type.review !== 'off') out += formatEntry('review', 'unreviewed')
  out += formatEntry('created', { datetime: opts.now }) + formatEntry('modified', { datetime: opts.now }) + '---\n'
  if (tpl) out += tpl.text.slice(tpl.bodyStart)
  return out
}

/** A schema default as the Value written for its attribute type (null = nothing written). */
function defaultValue(type: string, d: unknown): Value | null {
  if (d === null || d === undefined || d === '' || (Array.isArray(d) && d.length === 0)) return null
  if (typeof d === 'string') {
    const s = d.normalize('NFC')
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s }
    if (type === 'date-time') return { datetime: s }
    if (type === 'relation') {
      const m = /^\[\[(.*)\]\]$/.exec(s)
      return { link: m ? m[1] : s }
    }
    if (type === 'multi-select') return [s]
    return s
  }
  if (typeof d === 'number' || typeof d === 'boolean') return d
  if (Array.isArray(d)) return d.map((x) => defaultValue(type === 'multi-select' ? 'text' : type, x)).filter((x): x is Value => x !== null)
  return null
}

/** D-239, FR-TYP-13: the matched type key of a `type` value. Absent → Page (single); a value that isn't one
 *  non-empty string (list, number, null, blank) → Page, not single. */
export function typeMatch(value: unknown): { key: string; single: boolean } {
  if (value === undefined) return { key: 'page', single: true }
  if (typeof value === 'string' && value.trim() !== '') return { key: typeKey(value), single: true }
  return { key: 'page', single: false }
}

// ---------------------------------------------------------------- slice 4B (ms4-daily §1, §5, §6)

export { parseDate, localDate, addDays, formatDate, dailyFileStem, expandDailyTemplate, newDailyNote, fixDailyTitle, dateRows } from './daily.js'
