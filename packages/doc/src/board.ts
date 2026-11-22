// Slice Q2: a card move on a board (docs/contracts/v1-views.md §1.9; D-82 one text engine, D-230 minimal edits, D-478
// tag moves, D-1769). Only the grouping key's line(s) change; the caller applies `touchModified` (as tasks, D-506).

import { parse as parseYaml } from 'yaml'
import { entryKeyText, flowList, removeAttribute, setFlowList, setValue, type Value } from './edit.js'
import { tagKey, tags } from './links.js'
import { parse, type Doc } from './parse.js'

export type BoardMove = {
  /** The grouping key (frontmatter key, NFC). */
  key: string
  /** Select, single relation: scalar; multi-select, multiple relation, tags: list. */
  shape: 'scalar' | 'list'
  /** The source lane card's `raw` values (empty from `No <attribute>`, and for Alt). */
  remove: string[]
  /** The target lane's `value` (relation: the `[[…]]` link text); null: nothing added. */
  add: string | null
}

const nfc = (s: string) => s.normalize('NFC')
const scalarText = (v: unknown): string | null =>
  typeof v === 'string' ? nfc(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null

/** null: nothing to write (or the frontmatter can't be written). `inlineKept`: key `tags` and a removed tag also occurs
 *  inline in the body (the D-478 note; the body is never touched). */
export function applyBoardMove(text: string, move: BoardMove): { text: string; inlineKept: boolean } | null {
  const doc = parse(text)
  if (doc.frontmatter?.error || doc.frontmatterError) return null
  // The key as the note writes it: matched after NFC (FR-FMT-12, rule 9), so an NFD key is edited, never duplicated.
  const wanted = nfc(move.key)
  const key = doc.frontmatter?.entries.find((e) => nfc(e.key) === wanted)?.key ?? wanted
  const data = (doc.frontmatter?.data ?? {}) as Record<string, unknown>
  const add = move.add === null ? null : nfc(move.add)
  if (move.shape === 'scalar') {
    if (add === null) return null
    if (scalarText(data[key]) === add) return null
    const out = setValue(doc, key, add)
    return out === text ? null : { text: out, inlineKept: false }
  }
  const isTags = key === 'tags'
  const same = (a: string, b: string) => (isTags ? tagKey(a.replace(/^#/, '')) === tagKey(b.replace(/^#/, '')) : nfc(a) === nfc(b))
  const remove = move.remove.map(nfc)
  const removed = (v: string) => remove.some((r) => same(v, r))
  const raw = data[key]
  const present = raw !== undefined && doc.frontmatter?.entries.some((e) => e.key === key)
  const items: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const kept = items.filter((v) => { const s = scalarText(v); return s === null || !removed(s) })
  const appended = add !== null && !kept.some((v) => { const s = scalarText(v); return s !== null && same(s, add) })
  const want: unknown[] = appended ? [...kept, add] : kept
  if (kept.length === items.length && !appended) return null
  // The same values in the same order (compared NFC): nothing to write, even when an entry is spelled NFD.
  const k = (v: unknown) => (v === null || typeof v === 'object' ? '\u0000' : nfc(String(v)))
  if (want.length === items.length && want.every((v, i) => k(v) === k(items[i]))) return null
  const inlineKept = isTags && remove.length > 0 && tags(doc).some((t) => t.range !== null && remove.some((r) => same(t.key, r)))
  let out: string | null = null
  if (present) {
    const surgical = editListRaw(doc, key, removed, appended ? add : null)
    if (surgical !== null && sameList(surgical, key, want)) out = surgical
    else out = setValue(doc, key, want.length ? (want as Value[]) : [])
    if (want.length === 0 && out !== surgical) out = setListEmpty(doc, key) ?? out
  } else {
    if (add === null) return null
    out = setFlowList(doc, key, [add])
  }
  return out === text ? null : { text: out, inlineKept }
}

/** `key: []` in place of the entry (an emptied list keeps its key). */
function setListEmpty(doc: Doc, key: string): string | null {
  const e = doc.frontmatter?.entries.find((x) => x.key === key)
  if (!e) return null
  const raw = doc.text.slice(e.range[0], e.range[1])
  const m = /^([^:]*:)/.exec(raw)
  if (!m) return null
  const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : ''
  return doc.text.slice(0, e.range[0]) + `${m[1]} []${eol}` + doc.text.slice(e.range[1])
}

function sameList(text: string, key: string, want: unknown[]): boolean {
  const d = parse(text)
  if (d.frontmatter?.error) return false
  const got = (d.frontmatter?.data as Record<string, unknown> | undefined)?.[key]
  const list = Array.isArray(got) ? got : got === undefined || got === null ? [] : [got]
  const k = (v: unknown) => (v === null || typeof v === 'object' ? '\u0000' : nfc(String(v)))
  return list.length === want.length && list.every((v, i) => k(v) === k(want[i]))
}

/** The entry in flow (`[a, b]` on its line) or block (`- a` lines) style, edited in place: removed items go, `to` is
 *  appended; every other item keeps its bytes. Null when the entry has another shape (the caller re-renders it). */
function editListRaw(doc: Doc, key: string, removed: (v: string) => boolean, to: string | null): string | null {
  const e = doc.frontmatter?.entries.find((x) => x.key === key)
  if (!e) return null
  const raw = doc.text.slice(e.range[0], e.range[1])
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/(?<=\n)/)
  const itemText = (src: string): string | null => {
    try { return scalarText(parseYaml(src)) } catch { return null }
  }
  const drop = (src: string) => { const t = itemText(src); return t !== null && removed(t) }
  const newItem = to === null ? null : flowList([to]).slice(1, -1)
  const flow = /^([^:]*:[ \t]*\[)(.*)(\][ \t]*)(\r?\n)?$/s.exec(lines[0])
  if (lines.length === 1 && flow) {
    const items = splitFlow(flow[2])
    if (items === null) return null
    const kept = items.map((it) => it.trim()).filter((it) => it !== '' && !drop(it))
    if (newItem !== null) kept.push(newItem)
    return doc.text.slice(0, e.range[0]) + `${flow[1]}${kept.join(', ')}${flow[3]}${flow[4] ?? ''}` + doc.text.slice(e.range[1])
  }
  if (/^[^:]*:[ \t]*(\r?\n)$/.test(lines[0]) && lines.length > 1) {
    const items = lines.slice(1)
    const m = items.map((l) => /^([ \t]*)-[ \t]+(.*?)(\r?\n)?$/.exec(l))
    if (m.some((x) => x === null)) return null
    const kept = items.filter((_, i) => !drop(m[i]![2]))
    if (newItem !== null) {
      const last = kept.length ? kept[kept.length - 1] : null
      const fixed = last !== null && !last.endsWith('\n') ? [...kept.slice(0, -1), last + eol] : kept
      const tail = items[items.length - 1].endsWith('\n') ? eol : ''
      return doc.text.slice(0, e.range[0]) + lines[0] + [...fixed, `${m[0]![1]}- ${newItem}${tail}`].join('') + doc.text.slice(e.range[1])
    }
    if (kept.length === 0) return null
    let body = kept.join('')
    if (items[items.length - 1].endsWith('\n') && !body.endsWith('\n')) body += eol
    else if (!items[items.length - 1].endsWith('\n')) body = body.replace(/\r?\n$/, '')
    return doc.text.slice(0, e.range[0]) + lines[0] + body + doc.text.slice(e.range[1])
  }
  return null
}

/** The items of a flow list's inside, split at top-level commas (quotes respected); null when nested. */
function splitFlow(inner: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (q) { cur += c; if (c === q && !(q === '"' && inner[i - 1] === '\\')) q = null; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '[' || c === '{' || c === ']' || c === '}') return null
    if (c === ',') { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

// ---------------------------------------------------------------- slice Q2-T (v1-views §26; FR-TSK-04 AC-25)

/** A period board's write (R203): a period lane, day group or the no-value lane (`set`), onto the done lane (`done`),
 *  or out of the done lane onto a period / no-value lane (`reopen`). */
export type PeriodMove =
  | { kind: 'set'; key: string; date: string | null }
  | { kind: 'done'; status: string; now: string }
  | { kind: 'reopen'; status: string; key: string; date: string | null }

const validDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** null: nothing to write. Never touches `modified:` (the caller's `touchModified`, as part one §1.9). */
export function applyPeriodMove(text: string, move: PeriodMove): string | null {
  const doc = parse(text)
  if (doc.frontmatter?.error || doc.frontmatterError) return null
  if (move.kind === 'set') return setDateKey(doc, move.key, move.date)
  const data = (doc.frontmatter?.data ?? {}) as Record<string, unknown>
  const status = nfc(move.status)
  if (move.kind === 'done') {
    let out = scalarText(data.status) === status ? text : setValue(doc, 'status', status)
    if (!doc.frontmatter?.entries.some((e) => e.key === 'completed')) out = setValue(parse(out), 'completed', { datetime: move.now })
    return out === text ? null : out
  }
  let out = text
  if (scalarText(data.status) !== status) out = setValue(doc, 'status', status)
  out = removeAttribute(parse(out), 'completed')
  const set = setDateKey(parse(out), move.key, move.date)
  if (set !== null) out = set
  return out === text ? null : out
}

/** `<key>: YYYY-MM-DD` (the value token replaced, the line's other bytes kept; a missing key appended, D-230), or the
 *  key's lines removed for `null`. */
function setDateKey(doc: Doc, rawKey: string, date: string | null): string | null {
  const text = doc.text
  const wanted = nfc(rawKey)
  const e = doc.frontmatter?.entries.find((x) => nfc(x.key) === wanted)
  if (date === null) {
    if (!e) return null
    const out = removeAttribute(doc, e.key)
    return out === text ? null : out
  }
  if (!e) return setValue(doc, wanted, { date })
  const data = (doc.frontmatter?.data ?? {}) as Record<string, unknown>
  const cur = data[e.key]
  if (typeof cur === 'string' && cur === date && validDate(cur)) return null
  const raw = text.slice(e.range[0], e.range[1])
  const keyText = entryKeyText(doc, e.range)
  const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : ''
  const body = raw.slice(keyText.length + 1, raw.length - eol.length)
  let next: string
  if (body.includes('\n') || body.trim() === '') {
    next = `${keyText}: ${date}${eol || doc.eol}`
  } else {
    const lead = /^[ \t]*/.exec(body)![0]
    const rest = body.slice(lead.length)
    let end: number
    if (rest[0] === '"' || rest[0] === "'") {
      const q = rest[0]
      let i = 1
      while (i < rest.length) {
        if (q === '"' && rest[i] === '\\') { i += 2; continue }
        if (rest[i] === q) { if (q === "'" && rest[i + 1] === "'") { i += 2; continue } break }
        i++
      }
      end = Math.min(i + 1, rest.length)
    } else {
      const c = /[ \t]+#/.exec(rest)
      end = c ? c.index : rest.replace(/[ \t]+$/, '').length
    }
    next = `${keyText}:${lead || ' '}${date}${rest.slice(end)}${eol}`
  }
  const out = text.slice(0, e.range[0]) + next + text.slice(e.range[1])
  return out === text ? null : out
}
