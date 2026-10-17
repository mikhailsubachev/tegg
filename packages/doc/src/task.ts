// Slice 5A-1: task value writes (docs/contracts/ms5-tasks.md §5; D-82 one text engine, D-230, D-472, D-478). Each
// change edits only its own lines; the caller applies `touchModified` (D-506).

import { removeAttribute, setFlowList, setValue, type Value } from './edit.js'
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
      const kept = from === null ? list : list.filter((t) => key(t) !== from)
      const next: Value[] = kept.some((t) => key(t) === key(to)) ? kept : [...kept, to]
      const unchanged = next.length === list.length && next.every((t, i) => t === list[i])
      const inlineKept = from !== null && tags(doc).some((t) => t.range !== null && t.key === from)
      if (unchanged) return null
      // Entries the move doesn't touch keep their bytes where the style allows (flow items are re-rendered).
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
