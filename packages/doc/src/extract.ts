// Index extraction reference (spike S4, S4-QA AC-4): what the index stores about a note.
// The Rust extractor in spikes/s4-index must produce the same JSON for every round-trip
// fixture; `test/extract.test.ts` writes it to tests/fixtures/format/extract/expected.json.

import { parse } from './parse.js'
import { tags, wikilinks } from './links.js'
import { atOf, blockTexts, markdownLinks, type At, type BlockText } from './excerpt.js'

export interface Extracted {
  title: string
  id: string | null
  type: string | null
  /** Frontmatter as JSON; null when there is none or it is invalid. */
  attributes: Record<string, unknown> | null
  frontmatterError: boolean
  links: {
    target: string; subpath: string | null; alias: string | null; embed: boolean; inFrontmatter: boolean; attribute: string | null
    /** ms4-links §2.1 (D-302): where the link starts, and its block in `blocks` (null in frontmatter). */
    at: At; block: number | null
    /** A Markdown link `[text](Cíl.md)` (D-298): `target` is the decoded path, `alias` the link text. */
    markdown: boolean
  }[]
  /** Body blocks that contain at least one link, in file order (ms4-links §2.1). */
  blocks: BlockText[]
  /** Tag keys (NFC, lower case) in source order, frontmatter first; duplicates kept. */
  tags: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.normalize('NFC') : null)

/** `stem` is the file name without `.md`. Title: `title:` if set, else the file name (FR-FMT-08). */
export function extract(text: string, stem: string): Extracted {
  const doc = parse(text)
  const data = doc.frontmatter?.data ?? null
  const wiki = wikilinks(doc).map((l) => ({
    range: l.range,
    rec: { target: l.target.normalize('NFC'), subpath: l.subpath, alias: l.alias, embed: l.embed, inFrontmatter: l.inFrontmatter, attribute: l.attribute, markdown: false },
  }))
  const md = markdownLinks(doc).map((m) => ({
    range: m.range,
    rec: { target: m.target, subpath: m.subpath, alias: m.alias, embed: false, inFrontmatter: false, attribute: null, markdown: true },
  }))
  const fm = wiki.filter((w) => w.rec.inFrontmatter)
  const body = [...wiki.filter((w) => !w.rec.inFrontmatter), ...md].sort((a, b) => a.range[0] - b.range[0])
  const all = [...fm, ...body]
  const { blocks, blockOf } = blockTexts(doc, all.map((x, index) => ({ range: x.range, index, markdown: x.rec.markdown })).filter((x) => !all[x.index].rec.inFrontmatter))
  const links = all.map((x, i) => ({ ...x.rec, at: atOf(text, x.range[0]), block: blockOf.get(i) ?? null }))
  return {
    title: str(data?.title) ?? stem.normalize('NFC'),
    id: str(data?.id),
    type: str(data?.type),
    attributes: data,
    // D-97: an unclosed opening `---` (no frontmatter, a warning) is an error too.
    frontmatterError: !!doc.frontmatter?.error || (!doc.frontmatter && !!doc.frontmatterWarning),
    links,
    blocks,
    tags: tags(doc).map((t) => t.key),
  }
}
