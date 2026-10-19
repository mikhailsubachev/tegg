// Slice 5B (docs/contracts/ms5-capture.md §3.1; D-539): the title, body and trailing tags of a capture's text (R57).
// The title line's plain text follows the conversion's first-line rules (D-491, `objectFromUnit`).

import { plain, trailingTags } from './convert.js'

export type CaptureParts = {
  /** '' when no line has non-space characters (the UI saves `Untitled`, D-523). */
  title: string
  /** '' or ending with exactly one '\n'. */
  body: string
  /** Trailing `#tag` tokens of the title line, in order, as written (without '#'). */
  tags: string[]
  /** The title line is kept as the body's first paragraph (it held a link, D-491). */
  keptTitleLine: boolean
}

/** R57: a leading heading, quote, list or checklist marker of the title line. */
const MARKER = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/

/** R57 (D-539): NFC, CRLF → LF. `linkTitle` gives a link's target title when it has no alias; without one, the
 *  target's file name (no folder, no `.md`) is used (ms5-capture §12 item 2). */
export function captureParts(text: string, linkTitle: (target: string) => string | null): CaptureParts {
  const lines = text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
  const at = lines.findIndex((l) => l.trim() !== '')
  if (at < 0) return { title: '', body: '', tags: [], keptTitleLine: false }
  let line = lines[at].replace(MARKER, '')
  if (/^#{1,6}[ \t]/.test(lines[at].trimStart())) line = line.replace(/[ \t]+#+[ \t]*$/, '')
  const t = trailingTags(line)
  const p = plain(t.rest, (target) => linkTitle(target) ?? (target.split('/').pop() ?? target).replace(/\.md$/i, ''))
  const rest = lines.slice(at + 1)
  while (rest.length > 0 && rest[0].trim() === '') rest.shift()
  while (rest.length > 0 && rest[rest.length - 1].trim() === '') rest.pop()
  const kept = p.link ? t.rest.trim() : ''
  const body = [kept, rest.join('\n')].filter((s) => s !== '').join('\n\n')
  return { title: p.text.normalize('NFC').trim(), body: body === '' ? '' : body + '\n', tags: t.tags, keptTitleLine: p.link }
}
