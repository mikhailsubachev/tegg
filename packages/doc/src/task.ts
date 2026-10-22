// Slice 5A-1: task value writes (docs/contracts/ms5-tasks.md §5; D-82 one text engine, D-230, D-472, D-478). Each
// change edits only its own lines; the caller applies `touchModified` (D-506).

import { parse as parseYaml } from 'yaml'
import { flowList, removeAttribute, setFlowList, setValue, type Value } from './edit.js'
import { tagKey, tags } from './links.js'
import { parse } from './parse.js'

export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled'

export type TaskChange =
  | { kind: 'status'; to: string; toState: TaskState; fromState: TaskState; firstOpen: string; now: string }
  | { kind: 'priority'; to: string | null }
  | { kind: 'due'; to: string | null }
  | { kind: 'moveTag'; from: string | null; to: string }

/** The defs `completeTask` needs (the `TaskDefsDto` shape of ms5-tasks §3). */
export type TaskDefsLike = {
  statuses: { label: string; color: string | null; state: TaskState; stateRaw: string | null }[]
  priorities: { label: string; color: string | null }[]
  unknownStates: { label: string; state: string | null }[]
}

const scalar = (v: unknown): string | null => (typeof v === 'string' ? v.normalize('NFC') : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)
const key = (t: string) => tagKey(t.replace(/^#/, ''))

/** One change of a task file; `null` when there is nothing to write (or the frontmatter can't be written). */
export function applyTaskChange(text: string, change: TaskChange): { text: string; inlineKept: boolean } | null {
  const doc = parse(text)
  if (doc.frontmatter?.error || doc.frontmatterError) return null
  const data = doc.frontmatter?.data ?? {}
  const done = (out: string) => (out === text ? null : { text: out, inlineKept: false })
  switch (change.kind) {
    case 'status': {
      const to = change.to.normalize('NFC')
      if (scalar(data.status) === to) return null
      let out = setValue(doc, 'status', to)
      const into = change.toState === 'done' && change.fromState !== 'done'
      const outOf = change.fromState === 'done' && (change.toState === 'open' || change.toState === 'in-progress')
      if (into) out = setValue(parse(out), 'completed', { datetime: change.now })
      else if (outOf) out = removeAttribute(parse(out), 'completed')
      return done(out)
    }
    case 'priority': {
      if (change.to === null) return 'priority' in data ? done(removeAttribute(doc, 'priority')) : null
      if (scalar(data.priority) === change.to.normalize('NFC')) return null
      return done(setValue(doc, 'priority', change.to))
    }
    case 'due': {
      if (change.to === null) return 'due' in data ? done(removeAttribute(doc, 'due')) : null
      if (scalar(data.due) === change.to) return null
      return done(setValue(doc, 'due', { date: change.to }))
    }
    case 'moveTag': {
      const raw = data.tags
      const list: string[] = Array.isArray(raw) ? raw.map(scalar).filter((x): x is string => x !== null) : scalar(raw) !== null ? [scalar(raw)!] : []
      const from = change.from === null ? null : key(change.from)
      const to = change.to.normalize('NFC').replace(/^#/, '')
      const inlineKept = from !== null && tags(doc).some((t) => t.range !== null && t.key === from)
      const has = list.some((t) => key(t) === key(to))
      const drops = from !== null && list.some((t) => key(t) === from && from !== key(to))
      if (has && !drops) return null
      // Edit the entry's own text: untouched items keep their bytes (PR #47 review, D-230, D-478).
      const kept = from === null ? list : list.filter((t) => key(t) !== from)
      const next: Value[] = has ? kept : [...kept, to]
      // Used only when it reads back as exactly the intended tags; anything the splitter can't read (an apostrophe in
      // a word, `\\` before a quote, booleans) falls back to a re-render (PR #47 second review).
      const surgical = editTagsRaw(doc, from, has ? null : to)
      const rawItems: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
      const want = [...rawItems.filter((v) => from === null || scalar(v) === null || key(scalar(v)!) !== from), ...(has ? [] : [to])]
      if (surgical !== null && sameTags(surgical, want)) return surgical === text ? null : { text: surgical, inlineKept }
      const out = Array.isArray(raw) || raw === undefined || raw === null ? setFlowList(doc, 'tags', next) : setValue(doc, 'tags', next)
      return out === text ? null : { text: out, inlineKept }
    }
  }
}

/** The checkbox (D-472): check = the first Done-state status, uncheck = the first Open-state status. `null` when the
 *  task is already in that state. */
export function completeTask(text: string, defs: TaskDefsLike, done: boolean, now: string): string | null {
  const doc = parse(text)
  const cur = scalar(doc.frontmatter?.data?.status)
  const fromState: TaskState = defs.statuses.find((s) => s.label === cur)?.state ?? 'open'
  if ((fromState === 'done') === done) return null
  const target = defs.statuses.find((s) => s.state === (done ? 'done' : 'open'))
  const firstOpen = defs.statuses.find((s) => s.state === 'open')?.label ?? 'To do'
  if (!target) return null
  return applyTaskChange(text, { kind: 'status', to: target.label, toState: target.state, fromState, firstOpen, now })?.text ?? null
}

function sameTags(text: string, want: unknown[]): boolean {
  const d = parse(text)
  if (d.frontmatter?.error) return false
  const got = d.frontmatter?.data?.tags
  const list = Array.isArray(got) ? got : got === undefined || got === null ? [] : [got]
  const k = (v: unknown) => (v === null || typeof v === 'object' ? '\u0000' : key(String(v)))
  return list.length === want.length && list.every((v, i) => k(v) === k(want[i]) && (typeof v === 'string' || typeof v === 'number' || v === want[i]))
}

/** A `tags:` entry in flow (`[a, b]` on its line) or block (`- a` lines) style, edited in place: items whose key is
 *  `from` go, `to` is appended. Null when the entry has another shape (the caller re-renders it then). */
function editTagsRaw(doc: ReturnType<typeof parse>, from: string | null, to: string | null): string | null {
  const e = doc.frontmatter?.entries.find((x) => x.key === 'tags')
  if (!e) return null
  const raw = doc.text.slice(e.range[0], e.range[1])
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/(?<=\n)/)
  const itemKey = (src: string): string | null => {
    try { const v = parseYaml(src); return typeof v === 'string' || typeof v === 'number' ? key(String(v)) : null } catch { return null }
  }
  const newItem = to === null ? null : flowList([to]).slice(1, -1)
  const flow = /^([^:]*:[ \t]*\[)(.*)(\][ \t]*)(\r?\n)?$/s.exec(lines[0])
  if (lines.length === 1 && flow) {
    const items = splitFlow(flow[2])
    if (items === null) return null
    const kept = items.filter((it) => it.trim() === '' || itemKey(it.trim()) !== from || from === null).map((it) => it.trim()).filter((it) => it !== '')
    if (newItem !== null) kept.push(newItem)
    const line = `${flow[1]}${kept.join(', ')}${flow[3]}${flow[4] ?? ''}`
    return doc.text.slice(0, e.range[0]) + line + doc.text.slice(e.range[1])
  }
  if (/^[^:]*:[ \t]*(\r?\n)$/.test(lines[0]) && lines.length > 1) {
    const items = lines.slice(1)
    const m = items.map((l) => /^([ \t]*)-[ \t]+(.*?)(\r?\n)?$/.exec(l))
    if (m.some((x) => x === null)) return null
    const kept = items.filter((_, i) => from === null || itemKey(m[i]![2]) !== from)
    if (newItem !== null) kept.push(`${m[0]![1]}- ${newItem}${eol}`)
    const out = kept.length ? lines[0] + kept.join('') : lines[0].replace(/[ \t]*(\r?\n)$/, ` []$1`)
    return doc.text.slice(0, e.range[0]) + out + doc.text.slice(e.range[1])
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
