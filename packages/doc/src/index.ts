// Tegg document engine: source-preserving Markdown documents (ADR 0001, ADR 0003).
// Public interface: docs/contracts/ms1-core.md §4. Ported from spike S1 (D-83).

import { parse, type Doc } from './parse.js'
import { formatEntry, setAttribute, type Value } from './edit.js'

export type { Range, BlockKind, Block, FrontmatterEntry, Frontmatter, Doc } from './parse.js'
export { decode, encode, parse } from './parse.js'
export { editBlock, setAttribute, setDateRange, removeAttribute, renameLinkTarget, type Value } from './edit.js'
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
