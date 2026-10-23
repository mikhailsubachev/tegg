// Slice 4D-lite (docs/contracts/ms4-tags.md §4.2): the text side of the tag jobs and merge. Occurrences are exactly what
// the extractor counts (`links.ts` `tags`, dialect §5, D-64): `tags:` entries and body tags outside code, math, links.

import { flowList, formatScalar, setAttribute, setValue, type Patch, type Value } from './edit.js'
import { tags as bodyAndFmTags, tagKey } from './links.js'
import { parse, type Doc, type FrontmatterEntry } from './parse.js'

type Item = { start: number; end: number; value: string }
type TagsEntry = { entry: FrontmatterEntry; style: 'flow' | 'block' | 'scalar'; items: Item[]; open?: number; close?: number }

/** The `tags:` entry's items with their text ranges (unquoted values). */
function tagsEntry(doc: Doc): TagsEntry | null {
  const entry = doc.frontmatter?.entries.find((e) => e.key === 'tags')
  if (!entry) return null
  const text = doc.text
  const [s, e] = entry.range
  const colon = text.indexOf(':', s)
  if (colon < 0 || colon >= e) return null
  const lineEnd = lineEndAt(text, colon, e)
  const rest = text.slice(colon + 1, lineEnd)
  const lead = rest.length - rest.trimStart().length
  const first = colon + 1 + lead
  if (text[first] === '[') {
    const close = text.lastIndexOf(']', e)
    if (close < first) return null
    return { entry, style: 'flow', items: splitFlow(text, first + 1, close), open: first, close }
  }
  if (rest.trim() !== '' && !rest.trim().startsWith('#')) {
    let end = lineEnd
    while (end > first && /\s/.test(text[end - 1])) end--
    return { entry, style: 'scalar', items: [{ start: first, end, value: unquote(text.slice(first, end)) }] }
  }
  const items: Item[] = []
  let at = lineEnd < e ? next(text, lineEnd) : e
  while (at < e) {
    const le = lineEndAt(text, at, e)
    const line = text.slice(at, le)
    const m = /^(\s*-\s+)(.*?)\s*$/.exec(line)
    if (m) items.push({ start: at + m[1].length, end: at + m[1].length + m[2].length, value: unquote(m[2]) })
    at = le < e ? next(text, le) : e
  }
  return { entry, style: 'block', items }
}

function lineEndAt(text: string, from: number, limit: number): number {
  let i = from
  while (i < limit && text[i] !== '\n' && text[i] !== '\r') i++
  return i
}
function next(text: string, le: number): number {
  return text[le] === '\r' && text[le + 1] === '\n' ? le + 2 : le + 1
}
function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}
function splitFlow(text: string, from: number, to: number): Item[] {
  const out: Item[] = []
  let i = from
  let start = from
  let quote: string | null = null
  const push = (end: number) => {
    let a = start
    let b = end
    while (a < b && /\s/.test(text[a])) a++
    while (b > a && /\s/.test(text[b - 1])) b--
    if (b > a) out.push({ start: a, end: b, value: unquote(text.slice(a, b)) })
  }
  for (; i < to; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === ',') {
      push(i)
      start = i + 1
    }
  }
  push(to)
  return out
}

const keyOf = (v: string) => tagKey(v.replace(/^#/, ''))

/** `rename-tag` (D-645, D-659): the name bytes of every occurrence become `to` (NFC). */
export function renameTagPatches(doc: Doc, key: string, to: string): Patch[] {
  const out: Patch[] = []
  const name = to.normalize('NFC')
  const fm = tagsEntry(doc)
  for (const it of fm?.items ?? []) {
    if (keyOf(it.value) !== key) continue
    const raw = doc.text.slice(it.start, it.end)
    const hash = unquote(raw).startsWith('#') ? '#' : ''
    out.push({ range: [it.start, it.end], text: formatScalar(hash + name) })
  }
  for (const t of bodyAndFmTags(doc)) {
    if (!t.range || t.key !== key) continue
    out.push({ range: [t.range[0] + 1, t.range[1]], text: name })
  }
  return out
}

/** `remove-tag` (D-644, D-661, D-662). */
export function removeTagPatches(doc: Doc, key: string): Patch[] {
  const text = doc.text
  const out: Patch[] = []
  const fm = tagsEntry(doc)
  if (fm) {
    const keep = fm.items.filter((it) => keyOf(it.value) !== key)
    if (keep.length !== fm.items.length) {
      if (keep.length === 0) out.push({ range: fm.entry.range, text: '' })
      else if (fm.style === 'flow') {
        const removed = new Set(fm.items.filter((it) => !keep.includes(it)))
        // Each removed item takes the separator after it, or before it when it is last.
        for (let i = 0; i < fm.items.length; i++) {
          const it = fm.items[i]
          if (!removed.has(it)) continue
          const nextKept = fm.items.slice(i + 1).find((x) => !removed.has(x))
          if (nextKept) out.push({ range: [it.start, nextKept.start], text: '' })
          else {
            const prevKept = [...fm.items.slice(0, i)].reverse().find((x) => !removed.has(x))
            out.push({ range: [prevKept ? prevKept.end : it.start, it.end], text: '' })
          }
        }
        // Neighbouring removed items can share a separator.
        dedupe(out)
      } else if (fm.style === 'block') {
        for (const it of fm.items) {
          if (keep.includes(it)) continue
          let ls = it.start
          while (ls > 0 && text[ls - 1] !== '\n') ls--
          let le = lineEndAt(text, it.end, text.length)
          le = le < text.length ? next(text, le) : le
          out.push({ range: [ls, le], text: '' })
        }
      }
    }
  }
  const body = bodyAndFmTags(doc).filter((t) => t.range && t.key === key)
  if (body.length === 0) return out
  // Per line: remove each tag with the space after it (else before it); a line left blank goes with its break.
  const byLine = new Map<number, { s: number; e: number }[]>()
  for (const t of body) {
    let ls = t.range![0]
    while (ls > 0 && text[ls - 1] !== '\n') ls--
    const list = byLine.get(ls) ?? []
    list.push({ s: t.range![0], e: t.range![1] })
    byLine.set(ls, list)
  }
  for (const [ls, list] of byLine) {
    const le = lineEndAt(text, ls, text.length)
    const cuts = list.map(({ s, e }) => (text[e] === ' ' ? [s, e + 1] : text[s - 1] === ' ' ? [s - 1, e] : [s, e]) as [number, number])
    let rest = ''
    let at = ls
    for (const [a, b] of [...cuts].sort((x, y) => x[0] - y[0])) {
      rest += text.slice(at, Math.max(at, a))
      at = Math.max(at, b)
    }
    rest += text.slice(at, le)
    if (rest.trim() === '') {
      const end = le < text.length ? next(text, le) : le
      out.push({ range: [ls, end], text: '' })
    } else {
      const merged: Patch[] = cuts.map(([a, b]) => ({ range: [a, b], text: '' }))
      dedupe(merged)
      out.push(...merged)
    }
  }
  return out
}

function dedupe(ps: Patch[]): void {
  ps.sort((a, b) => a.range[0] - b.range[0])
  for (let i = 1; i < ps.length; i++) {
    const p = ps[i - 1]
    const q = ps[i]
    if (q.range[0] < p.range[1]) {
      ps[i - 1] = { range: [p.range[0], Math.max(p.range[1], q.range[1])], text: '' }
      ps.splice(i, 1)
      i--
    }
  }
}

const TAIL = ['tags', 'review', 'created', 'modified']
const SKIP = new Set(['id', 'type', 'title', 'tags', 'aliases', 'review', 'created', 'modified', 'captured', 'previous', 'import-id'])

function listOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : []
}
function union(a: string[], b: string[], key: (s: string) => string): string[] {
  const seen = new Set(a.map(key))
  const out = [...a]
  for (const x of b) if (!seen.has(key(x))) (seen.add(key(x)), out.push(x))
  return out
}

/** `merge-into` (D-290, D-673, D-680): the kept text with the others' bodies, missing attributes and list unions. */
export function mergeInto(text: string, others: { path: string; title: string; text: string }[], now: string): string {
  let doc = parse(text)
  const data = (doc.frontmatter?.data ?? {}) as Record<string, unknown>
  const keptTitle = typeof data.title === 'string' ? data.title : ''
  let tagsList = listOf(data.tags)
  let aliases = listOf(data.aliases)
  const hadTags = 'tags' in data
  const hadAliases = 'aliases' in data
  const added: string[] = []
  const addedKeys = new Set<string>()
  let bodyAdd = ''
  const eol = doc.eol
  for (const o of others) {
    const od = parse(o.text)
    const odata = (od.frontmatter?.data ?? {}) as Record<string, unknown>
    for (const e of od.frontmatter?.entries ?? []) {
      if (e.key === 'aliases' && !hadAliases && !addedKeys.has('aliases')) {
        addedKeys.add('aliases')
        added.push('\u0000aliases')
      }
      if (SKIP.has(e.key) || e.key in data || addedKeys.has(e.key)) continue
      addedKeys.add(e.key)
      added.push(o.text.slice(e.range[0], e.range[1]).replace(/\r?\n$/, '') + eol)
    }
    tagsList = union(tagsList, listOf(odata.tags), keyOf)
    aliases = union(aliases, listOf(odata.aliases), (s) => s.normalize('NFC').toLowerCase())
    const t = o.title.normalize('NFC')
    if (t && t.toLowerCase() !== keptTitle.normalize('NFC').toLowerCase()) aliases = union(aliases, [t], (s) => s.normalize('NFC').toLowerCase())
    const ob = o.text.slice(od.bodyStart).replace(/^(\r?\n)+/, '').replace(/(\r?\n|\s)+$/, '')
    if (ob) bodyAdd += `${eol}## ${t} (merged)${eol}${eol}${ob}${eol}`
  }
  // Existing lists get their unions in place; new keys go before the first tail key.
  if (hadTags) text = setValue(doc, 'tags', tagsList as Value)
  doc = parse(text)
  if (hadAliases) text = setValue(doc, 'aliases', aliases as Value)
  doc = parse(text)
  const ins = added.map((a) => (a === '\u0000aliases' ? (aliases.length ? `aliases: ${flowList(aliases)}${eol}` : '') : a))
  if (!hadTags && tagsList.length) ins.push(`tags: ${flowList(tagsList)}${eol}`)
  if (ins.length && doc.frontmatter) {
    const at = doc.frontmatter.entries.find((e) => TAIL.includes(e.key))?.range[0] ?? doc.frontmatter.innerRange[1]
    text = text.slice(0, at) + ins.join('') + text.slice(at)
  }
  if (bodyAdd) {
    doc = parse(text)
    const body = text.slice(doc.bodyStart)
    if (body.trim() === '') text = text.slice(0, doc.bodyStart) + bodyAdd.slice(eol.length)
    else text = text.replace(/(\r?\n|\s)*$/, '') + eol + bodyAdd
  }
  return setAttribute(parse(text), 'modified', { datetime: now })
}
