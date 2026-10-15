// Index extraction reference (spike S4, S4-QA AC-4): what the index stores about a note.
// The Rust extractor in spikes/s4-index must produce the same JSON for every round-trip
// fixture; `test/extract.test.ts` writes it to tests/fixtures/format/extract/expected.json.

import { parse } from './parse.js'
import { tags, wikilinks } from './links.js'

export interface Extracted {
  title: string
  id: string | null
  type: string | null
  /** Frontmatter as JSON; null when there is none or it is invalid. */
  attributes: Record<string, unknown> | null
  frontmatterError: boolean
  links: { target: string; subpath: string | null; alias: string | null; embed: boolean; inFrontmatter: boolean; attribute: string | null }[]
  /** Tag keys (NFC, lower case) in source order, frontmatter first; duplicates kept. */
  tags: string[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.normalize('NFC') : null)

/** `stem` is the file name without `.md`. Title: `title:` if set, else the file name (FR-FMT-08). */
export function extract(text: string, stem: string): Extracted {
  const doc = parse(text)
  const data = doc.frontmatter?.data ?? null
  return {
    title: str(data?.title) ?? stem.normalize('NFC'),
    id: str(data?.id),
    type: str(data?.type),
    attributes: data,
    // D-97: an unclosed opening `---` (no frontmatter, a warning) is an error too.
    frontmatterError: !!doc.frontmatter?.error || (!doc.frontmatter && !!doc.frontmatterWarning),
    links: wikilinks(doc).map((l) => ({
      target: l.target.normalize('NFC'),
      subpath: l.subpath,
      alias: l.alias,
      embed: l.embed,
      inFrontmatter: l.inFrontmatter,
      attribute: l.attribute,
    })),
    tags: tags(doc).map((t) => t.key),
  }
}
