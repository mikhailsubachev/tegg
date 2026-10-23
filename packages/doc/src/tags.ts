// Slice 4D-lite (docs/contracts/ms4-tags.md §2): tag names and Tag file bytes. The name rule is the micromark tag
// construct's (tag.ts, dialect §5), so a name `New tag` accepts is exactly a tag the editor recognises (D-658).

import { formatScalar, setAttribute, removeAttribute } from './edit.js'
import { parse } from './parse.js'
import { touchModified } from './index.js'

export type TagNameResult =
  | { ok: true; name: string; key: string }
  | { ok: false; error: 'empty' | 'space' | 'digits' | 'char'; char?: string }

const TAG_CHAR = /[\p{L}\p{M}\p{N}_\-/]/u
const SPACE = /[\s  -​  　﻿]/u
const DIGITS = /^\p{N}+$/u

/** The tag key (D-185): NFC, lower case. Equal to `tegg_format::tag_key`. */
export function tagKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** D-642, D-658. Drops one leading `#`; NFC; then dialect §5 tag text. */
export function tagName(input: string): TagNameResult {
  let name = input.normalize('NFC')
  if (name.startsWith('#')) name = name.slice(1)
  if (name === '') return { ok: false, error: 'empty' }
  if (SPACE.test(name)) return { ok: false, error: 'space' }
  for (const ch of name) if (!TAG_CHAR.test(ch)) return { ok: false, error: 'char', char: ch }
  if (DIGITS.test(name)) return { ok: false, error: 'digits' }
  return { ok: true, name, key: tagKey(name) }
}

/** D-641, R86. `now` is ISO 8601 with offset (the UI's clock, ms5-tasks §1). Ends with `---\n`. */
export function tagFile(f: { id: string; title: string; color?: string; now: string }): string {
  const lines = [`id: ${f.id}`, 'type: tag', `title: ${formatScalar(f.title.normalize('NFC'))}`]
  if (f.color) lines.push(`color: ${f.color}`)
  lines.push(`created: ${f.now}`, `modified: ${f.now}`)
  return `---\n${lines.join('\n')}\n---\n`
}

/** D-653: sets or removes `color` and touches `modified` (only those lines change). The same colour again returns the
 *  input unchanged, so the UI writes nothing. A new `color` goes after `title` (R86 order). */
export function setTagColor(text: string, color: string | null, now: string): string {
  const doc = parse(text)
  const entries = doc.frontmatter?.entries ?? []
  const current = entries.find((e) => e.key === 'color')
  let out: string
  if (color === null) {
    if (!current) return text
    out = removeAttribute(doc, 'color')
  } else if (current) {
    if (typeof doc.frontmatter?.data?.color === 'string' && doc.frontmatter.data.color.trim() === color) return text
    out = setAttribute(doc, 'color', color)
  } else {
    const after = entries.find((e) => e.key === 'title') ?? entries.find((e) => e.key === 'type')
    if (after) {
      const at = after.range[1]
      const eol = doc.eol
      const needsNl = text[at - 1] !== '\n'
      out = text.slice(0, at) + (needsNl ? eol : '') + `color: ${color}${eol}` + text.slice(at)
    } else {
      out = setAttribute(doc, 'color', color)
    }
  }
  return touchModified(text, out, now)
}
