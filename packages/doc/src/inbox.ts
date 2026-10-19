// Slice 5B (docs/contracts/ms5-capture.md §7.3; D-557…D-559): the text changes of the Inbox actions. Each edits only its
// lines (D-230 append rule; quote style kept; CRLF, BOM and final-newline state kept) and sets `modified`.

import { setValue } from './edit.js'
import { wikilinks } from './links.js'
import { parse, type Doc } from './parse.js'
import { applyTaskChange } from './task.js'

export type InboxChange =
  | { op: 'set-review'; value: 'reviewed' | 'unreviewed'; now: string }
  /** Writes `type`, `review: reviewed`, `modified` (D-557). */
  | { op: 'set-type'; type: string; now: string }
  /** Flow list append, unique by tagKey. */
  | { op: 'add-tags'; tags: string[]; now: string }
  /** Blank line + `[[target]]` paragraph (D-559). */
  | { op: 'append-link'; target: string; now: string }

const scalar = (v: unknown): string | null => (typeof v === 'string' ? v.normalize('NFC').trim() : null)
const writable = (d: Doc) => !(d.frontmatter?.error || d.frontmatterError)

/** The text with `s` appended as a new last paragraph (a blank line before it), keeping the final-newline state. */
function appendParagraph(text: string, eol: string, s: string): string {
  const para = s.replace(/\r?\n/g, eol)
  if (text.endsWith('\n')) return text + eol + para + eol
  return text + eol + eol + para
}

export function applyInboxChange(text: string, change: InboxChange): { kind: 'bytes'; text: string } | { kind: 'unchanged' } {
  const doc = parse(text)
  if (!writable(doc)) return { kind: 'unchanged' }
  const data = doc.frontmatter?.data ?? {}
  if (change.op === 'append-link') {
    // `modified` first, then the paragraph at the very end of the body.
    return { kind: 'bytes', text: appendParagraph(setValue(doc, 'modified', { datetime: change.now }), doc.eol, `[[${change.target.normalize('NFC')}]]`) }
  }
  let out = text
  switch (change.op) {
    case 'set-review':
      if (scalar(data.review) === change.value) return { kind: 'unchanged' }
      out = setValue(doc, 'review', change.value)
      break
    case 'set-type':
      if (scalar(data.type) !== change.type.normalize('NFC')) out = setValue(parse(out), 'type', change.type.normalize('NFC'))
      if (scalar(data.review) !== 'reviewed') out = setValue(parse(out), 'review', 'reviewed')
      break
    case 'add-tags':
      for (const tag of change.tags) out = applyTaskChange(out, { kind: 'moveTag', from: null, to: tag })?.text ?? out
      break
  }
  if (out === text) return { kind: 'unchanged' }
  return { kind: 'bytes', text: setValue(parse(out), 'modified', { datetime: change.now }) }
}

/** D-558: `## <title>` + the item's body appended to `target`, links rewritten by `retarget` (the link's target as
 *  written → the whole new inner text, or null to keep it; D-572), `modified` set to `now`. */
export function appendSection(target: string, title: string, itemBody: string, retarget: (link: string) => string | null, now: string): string {
  const tdoc = parse(target)
  let body = itemBody.normalize('NFC').replace(/\r\n/g, '\n')
  const links = wikilinks(parse(body)).filter((l) => !l.inFrontmatter)
  for (const l of [...links].sort((a, b) => b.range[0] - a.range[0])) {
    const inner = retarget(l.target)
    if (inner === null) continue
    body = body.slice(0, l.range[0]) + (l.embed ? '![[' : '[[') + inner + ']]' + body.slice(l.range[1])
  }
  body = body.replace(/\s+$/, '')
  const section = `## ${title.normalize('NFC').trim()}` + (body === '' ? '' : `\n\n${body}`)
  const base = writable(tdoc) && tdoc.frontmatter ? setValue(tdoc, 'modified', { datetime: now }) : target
  const eol = tdoc.eol
  const head = base.endsWith('\n') ? base : base + eol
  return head + eol + section.replace(/\n/g, eol) + eol
}
