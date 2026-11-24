// Slice Q (docs/contracts/v1-queries.md §3.1; docs/acceptance/queries.md R140): the query fence in a note. A fenced code
// block whose info string's first word is exactly `query` (case-sensitive, D-1464), ``` or ~~~, at any depth (lists,
// quotes, callouts); the frontmatter is skipped. `queryFences` is the L3 twin of `tegg_format::query_fences`: ranges are
// UTF-8 byte offsets `[start, end)` from the opening marker through the closing line's EOL. Names are NFC (FR-FMT-12
// AC-9) and match case-insensitively (name key). Only the `saved:` value is ever rewritten; every other byte is kept.

import type { Nodes } from 'mdast'
import { isMap, isScalar, parseDocument, type Document } from 'yaml'
import { flowList, formatScalar, type Patch } from './edit.js'
import { parse } from './parse.js'

export type QueryFence = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string }

/** A fence with its offsets in the text (UTF-16, for patches) besides the contract's byte range. */
type Found = QueryFence & { at: [number, number] }

function findFences(text: string): Found[] {
  const doc = parse(text)
  const out: Found[] = []
  const enc = new TextEncoder()
  const bytes = (i: number) => enc.encode(text.slice(0, i)).length
  const walk = (node: Nodes, depth: number) => {
    if (node.type === 'code' && node.position) {
      const start = node.position.start.offset!
      const lineEnd = eolAt(text, start)
      const opening = text.slice(start, lineEnd).replace(/\r?\n$/, '')
      const m = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(opening)
      if (m) {
        const info = m[2].trim()
        if (info.split(/[ \t]+/)[0] === 'query') {
          let end = node.position.end.offset!
          if (text.startsWith('\r\n', end)) end += 2
          else if (text[end] === '\n' || text[end] === '\r') end += 1
          const body = node.value
          out.push({ range: [bytes(start), bytes(end)], at: [start, end], body, saved: savedName(body), nested: depth > 1, info })
        }
      }
      return
    }
    if ('children' in node) for (const c of node.children) walk(c as Nodes, depth + 1)
  }
  walk(doc.mdast, 0)
  return out
}

/** Every query fence of the note, in file order (R140; L3 twin of `tegg_format::query_fences`). */
export function queryFences(text: string): QueryFence[] {
  return findFences(text).map(({ range, body, saved, nested, info }) => ({ range, body, saved, nested, info }))
}

/** End of the line holding `i`, after its EOL. */
function eolAt(text: string, i: number): number {
  const nl = text.indexOf('\n', i)
  return nl < 0 ? text.length : nl + 1
}

// ------------------------------------------------------------------------------------------------ the `saved:` line

const SAVED = /^saved:(?=[ \t]|$)/

/** The value token of a body line `saved: <value>`: its offsets in the line and the name it gives (NFC), or null. */
function savedValue(line: string): { from: number; to: number; name: string | null } | null {
  if (!SAVED.test(line)) return null
  let from = 6
  while (line[from] === ' ' || line[from] === '\t') from++
  const rest = line.slice(from)
  if (rest.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(rest)
    if (!m) return { from, to: line.length, name: null }
    let v: string
    try { v = JSON.parse(m[0]) as string } catch { v = m[1] }
    return { from, to: from + m[0].length, name: named(v) }
  }
  if (rest.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'/.exec(rest)
    if (!m) return { from, to: line.length, name: null }
    return { from, to: from + m[0].length, name: named(m[1].replace(/''/g, "'")) }
  }
  const plain = rest.replace(/(^|[ \t]+)#.*$/, '').replace(/[ \t]+$/, '')
  const to = from + plain.length
  // Not a string in YAML (R140: `saved:` not a string is unreadable): collections, block scalars, null, booleans, numbers.
  if (plain === '' || /^[[{|>&*!%@`]/.test(plain) || /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|0x[0-9a-fA-F]+|0o[0-7]+)$/.test(plain)) {
    return { from, to, name: null }
  }
  return { from, to, name: named(plain) }
}

const named = (v: string): string | null => {
  const t = v.trim().normalize('NFC')
  return t === '' ? null : t
}

/** The name key of a query name: NFC, case-insensitive (R140, D-1434). */
export function queryNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase()
}

/** The `saved:` value of a reference body (trimmed, NFC), else null (no YAML parse: the line `saved: <scalar>` at column 0). */
export function savedName(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const v = savedValue(line)
    if (v) return v.name
  }
  return null
}

/** A new reference fence: "```query\nsaved: <name>\n```". */
export function newQueryFence(name: string): string {
  return '```query\nsaved: ' + formatScalar(name.normalize('NFC')) + '\n```'
}

// ------------------------------------------------------------------------------------------------ fence sources

type Lines = { lines: string[]; open: number; close: number | null; prefix: string; eol: string }

/** A fence's source as lines (each with its EOL): the opening line, the closing line (null when unclosed) and the
 *  container prefix of its content lines (`> `, list indentation), read from the closing line, else the opening's. */
function fenceLines(src: string): Lines | null {
  const lines = src.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const first = lines[0]
  if (first === undefined) return null
  const m = /^(.*?)(`{3,}|~{3,})/.exec(first)
  if (!m) return null
  const marker = m[2]!
  const closing = new RegExp(`^(.*?)${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*\\r?\\n?$`)
  let close: number | null = null
  let prefix = m[1]!.replace(/(?:[-*+]|\d+[.)])(?=[ \t])/g, (x) => ' '.repeat(x.length))
  for (let i = lines.length - 1; i > 0; i--) {
    const c = closing.exec(lines[i]!)
    if (c && /^[ \t>]*$/.test(c[1]!)) { close = i; prefix = c[1]!; break }
  }
  const eol = /\r\n$/.test(first) ? '\r\n' : '\n'
  return { lines, open: 0, close, prefix, eol }
}

/** A content line without its container prefix (`> `, indentation). */
function bodyOf(line: string, prefix: string): { at: number; text: string } {
  const bare = line.replace(/\r?\n$/, '')
  if (bare.startsWith(prefix)) return { at: prefix.length, text: bare.slice(prefix.length) }
  const q = /^(?:[ \t]*>[ \t]?)*/.exec(bare)![0]
  return { at: q.length, text: bare.slice(q.length) }
}

/** A fence's source with only its `saved:` value replaced (`Choose a query…`); null when it has no `saved:` line. */
export function withSavedName(fenceSource: string, name: string): string | null {
  const f = fenceLines(fenceSource)
  if (!f) return null
  const end = f.close ?? f.lines.length
  for (let i = 1; i < end; i++) {
    const b = bodyOf(f.lines[i], f.prefix)
    const v = savedValue(b.text)
    if (!v) continue
    const line = f.lines[i]
    const from = b.at + v.from
    const to = b.at + v.to
    const value = (v.from === 6 ? ' ' : '') + formatScalar(name.normalize('NFC'))
    f.lines[i] = line.slice(0, from) + value + line.slice(to)
    return f.lines.join('')
  }
  return null
}

/** `Save as query…`: the fence's source with its body replaced by `saved: <name>` (fence markers, info and container prefixes kept). */
export function referenceFence(fenceSource: string, name: string): string {
  const f = fenceLines(fenceSource)
  if (!f) return newQueryFence(name)
  const opening = f.lines[0].endsWith('\n') ? f.lines[0] : f.lines[0] + f.eol
  const saved = `${f.prefix}saved: ${formatScalar(name.normalize('NFC'))}`
  if (f.close === null) return opening + saved + (/\n$/.test(fenceSource) ? f.eol : '')
  return opening + saved + f.eol + f.lines.slice(f.close).join('')
}

// ------------------------------------------------------------------------------------------------ the rename job's op

/** `{ op: 'rename-saved-query', from, to }` (§3.1): in every query fence of the file (any depth), each `saved:` line
 *  whose value has `from`'s name key gets `to` (`formatScalar`); container prefixes and every other byte are kept. */
export function renameSavedQueryPatches(text: string, from: string, to: string): Patch[] {
  const key = queryNameKey(from)
  const value = formatScalar(to.normalize('NFC'))
  const patches: Patch[] = []
  for (const f of findFences(text)) {
    if (f.body === '') continue
    const body = f.body.split(/\r?\n/)
    // Content lines: after the opening line, one per body line (CommonMark keeps fenced lines one for one).
    let at = eolAt(text, f.at[0])
    for (const line of body) {
      if (at >= f.at[1]) break
      const lineEnd = eolAt(text, at)
      const bare = text.slice(at, lineEnd).replace(/\r?\n$/, '')
      const v = savedValue(line)
      const start = at + bare.length - line.length
      if (v && v.name !== null && queryNameKey(v.name) === key && start >= at && text.startsWith('saved:', start)) {
        patches.push({ range: [start + v.from, start + v.to], text: (v.from === 6 ? ' ' : '') + value })
      }
      at = lineEnd
    }
  }
  return patches
}

// ------------------------------------------------------------------------------------------------ usage settings (Q2.1, Q3)

/** v1-views §13.1 (R195, D-1838): one sort level of a usage's own value. */
export type UsageSort = { by: string; order: 'asc' | 'desc' }
/** v1-views §37 (slice Q3, D-2172): a usage's own display; `board` reads as `wall` (D-2179). */
export type UsageView = 'list' | 'table' | 'wall'
/** v1-views §37: a usage's own lanes; `vertical` / `horizontal` read as `columns` / `rows`. */
export type UsageLanes = 'columns' | 'rows'
/** v1-views §37: a usage's own grouping (`group_by`): the word `none`, an attribute key, or `{ <key>: period }`. */
export type UsageGroup = { none: true } | { none: false; key: string; period: boolean }
/** v1-views §37: ordered pairs, keys NFC. */
export type UsageWidths = [string, number][]
/** A reference body's own values (R195, R220 with the read rules of §35, NFC). `'broken'`: the key is present but its
 *  value has a broken shape. `null`: the key is absent. All null for a non-reference body (inline, empty, unreadable). */
export type FenceUsage = {
  sort: UsageSort[] | 'broken' | null
  columns: string[] | 'broken' | null
  view: UsageView | 'broken' | null
  group: UsageGroup | 'broken' | null
  lanes: UsageLanes | 'broken' | null
  laneOrder: string[] | 'broken' | null
  widths: UsageWidths | 'broken' | null
}
/** `undefined`: leave the key; `null`: remove it (`Use the query's …`); a value: set it. `Use the query's grouping` is
 *  `{ group: null, lanes: null, laneOrder: null }` (one result, one write). */
export type UsageChange = {
  sort?: UsageSort[] | null
  columns?: string[] | null
  view?: UsageView | null
  group?: UsageGroup | null
  lanes?: UsageLanes | null
  laneOrder?: string[] | null
  widths?: UsageWidths | null
}

const trimWs = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

/** R185's shape rules for a usage `sort` value (one mapping or a list of mappings; a missing `order` is `asc`). */
function usageSortOf(v: unknown): UsageSort[] | 'broken' {
  const level = (x: unknown): UsageSort | null => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null
    const m = x as Record<string, unknown>
    if (typeof m.by !== 'string' || trimWs(m.by) === '') return null
    if (!(m.order === undefined || m.order === null || m.order === 'asc' || m.order === 'desc')) return null
    return { by: trimWs(m.by).normalize('NFC'), order: m.order === 'desc' ? 'desc' : 'asc' }
  }
  const ls = Array.isArray(v) ? v.map(level) : [level(v)]
  return ls.every((l) => l !== null) ? (ls as UsageSort[]) : 'broken'
}
function usageColumnsOf(v: unknown): string[] | 'broken' {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).map((x) => x.normalize('NFC')) : 'broken'
}
function usageViewOf(v: unknown): UsageView | 'broken' {
  if (v === 'list' || v === 'table' || v === 'wall') return v
  return v === 'board' ? 'wall' : 'broken'
}
function usageLanesOf(v: unknown): UsageLanes | 'broken' {
  if (v === 'columns' || v === 'vertical') return 'columns'
  if (v === 'rows' || v === 'horizontal') return 'rows'
  return 'broken'
}
function usageGroupOf(v: unknown): UsageGroup | 'broken' {
  if (v === 'none') return { none: true }
  if (typeof v === 'string') return trimWs(v) === '' ? 'broken' : { none: false, key: trimWs(v).normalize('NFC'), period: false }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const e = Object.entries(v as Record<string, unknown>)
    if (e.length === 1 && trimWs(e[0]![0]) !== '' && e[0]![1] === 'period') return { none: false, key: trimWs(e[0]![0]).normalize('NFC'), period: true }
  }
  return 'broken'
}
/** `widths` from its YAML node, in file order: string keys, YAML integers 0…100,000 (a float, a string or a negative
 *  value is broken). */
function usageWidthsOf(node: unknown, body: string): UsageWidths | 'broken' {
  if (!isMap(node)) return 'broken'
  const out: UsageWidths = []
  for (const pair of node.items) {
    const k = isScalar(pair.key) ? pair.key.value : undefined
    const v = pair.value
    if (typeof k !== 'string' || !isScalar(v) || typeof v.value !== 'number') return 'broken'
    const src = v.range ? body.slice(v.range[0], v.range[1]) : String(v.value)
    if (!Number.isInteger(v.value) || !/^\+?[0-9]+$/.test(src.trim()) || v.value < 0 || v.value > 100_000) return 'broken'
    out.push([k.normalize('NFC'), v.value])
  }
  return out
}

const NONE_USAGE: FenceUsage = { sort: null, columns: null, view: null, group: null, lanes: null, laneOrder: null, widths: null }

/** v1-views §13.1, §37: a reference body's own `sort`, `columns`, `view`, `group_by`, `lanes`, `lane_order`, `widths`
 *  (R195, R220). Whether a `by`, a column or a grouping key exists is the core's run-time check, not this reader's. */
export function fenceUsage(body: string): FenceUsage {
  if (savedName(body) === null) return { ...NONE_USAGE }
  let d: Document.Parsed
  let y: unknown
  try {
    d = parseDocument(body)
    if (d.errors.length > 0) return { ...NONE_USAGE }
    y = d.toJS()
  } catch { return { ...NONE_USAGE } }
  if (!y || typeof y !== 'object' || Array.isArray(y)) return { ...NONE_USAGE }
  const m = y as Record<string, unknown>
  if (typeof m.saved !== 'string' || trimWs(m.saved) === '') return { ...NONE_USAGE }
  const has = (k: string) => Object.prototype.hasOwnProperty.call(m, k)
  return {
    sort: has('sort') ? usageSortOf(m.sort) : null,
    columns: has('columns') ? usageColumnsOf(m.columns) : null,
    view: has('view') ? usageViewOf(m.view) : null,
    group: has('group_by') ? usageGroupOf(m.group_by) : null,
    lanes: has('lanes') ? usageLanesOf(m.lanes) : null,
    laneOrder: has('lane_order') ? usageColumnsOf(m.lane_order) : null,
    widths: has('widths') ? usageWidthsOf(d.get('widths', true), body) : null,
  }
}

/** A flow-context scalar (D-230 quoting), NFC. */
const flowScalar = (s: string) => flowList([s.normalize('NFC')]).slice(1, -1)

/** R185's write style for a usage `sort` (one level: one flow mapping; more: a block list; none: `[]`). */
function sortLines(sort: UsageSort[]): string[] {
  const lv = (l: UsageSort) => `{ by: ${flowScalar(l.by)}, order: ${l.order} }`
  if (sort.length === 0) return ['sort: []']
  if (sort.length === 1) return [`sort: ${lv(sort[0]!)}`]
  return ['sort:', ...sort.map((l) => `  - ${lv(l)}`)]
}
const columnsLines = (columns: string[]): string[] => [`columns: ${flowList(columns.map((c) => c.normalize('NFC')))}`]
const groupLines = (g: UsageGroup): string[] =>
  g.none ? ['group_by: none'] : g.period ? [`group_by: { ${flowScalar(g.key)}: period }`] : [`group_by: ${formatScalar(g.key.normalize('NFC'))}`]
const widthsLines = (w: UsageWidths): string[] => [`widths: { ${w.map(([k, v]) => `${flowScalar(k)}: ${v}`).join(', ')} }`]

/** The trailing comment of a key line (from the blanks before `#`, outside quotes), or ''. */
function trailingComment(line: string): string {
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (q) {
      if (c === '\\' && q === '"') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") q = c
    else if (c === '#' && i > 0 && (line[i - 1] === ' ' || line[i - 1] === '\t')) {
      let s = i
      while (s > 0 && (line[s - 1] === ' ' || line[s - 1] === '\t')) s--
      return line.slice(s)
    }
  }
  return ''
}

type Ln = { text: string; eol: string }
type FileKey = 'view' | 'group_by' | 'lanes' | 'lane_order' | 'sort' | 'columns' | 'widths'
/** R221's order of a reference body's keys (after `saved`). */
const KEY_ORDER: FileKey[] = ['view', 'group_by', 'lanes', 'lane_order', 'sort', 'columns', 'widths']

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameWidths = (a: UsageWidths, b: UsageWidths) => {
  const s = (w: UsageWidths) => JSON.stringify([...w].map(([k, v]) => [k.normalize('NFC'), v]).sort((x, y) => (x[0]! < y[0]! ? -1 : x[0]! > y[0]! ? 1 : 0)))
  return s(a) === s(b)
}
const nfcGroup = (g: UsageGroup): UsageGroup => (g.none ? { none: true } : { none: false, key: trimWs(g.key).normalize('NFC'), period: g.period })

/** v1-views §13.1, §37: the fence's source with R195 / R221's rules applied; null when the source has no `saved:` line
 *  or the result equals the source. A key whose current value is valid and equals the change keeps its bytes (old
 *  words included). */
export function withUsage(fenceSource: string, change: UsageChange): string | null {
  const f = fenceLines(fenceSource)
  if (!f) return null
  const lines: Ln[] = f.lines.map((l) => {
    const m = /\r?\n$/.exec(l)
    return m ? { text: l.slice(0, l.length - m[0].length), eol: m[0] } : { text: l, eol: '' }
  })
  let end = f.close ?? lines.length
  const body = (i: number) => bodyOf(lines[i]!.text, f.prefix)
  let savedAt = -1
  for (let i = 1; i < end; i++) if (savedValue(body(i).text)) { savedAt = i; break }
  if (savedAt < 0) return null
  const prefix = lines[savedAt]!.text.slice(0, body(savedAt).at)
  const eol = f.eol
  const isCont = (t: string) => /^[ \t]/.test(t) || t === '-' || t.startsWith('- ')
  const rangeOf = (key: string): [number, number] | null => {
    const re = new RegExp(`^${key}:(?=[ \\t]|$)`)
    for (let i = 1; i < end; i++) {
      if (!re.test(body(i).text)) continue
      let j = i + 1
      while (j < end && isCont(body(j).text)) j++
      return [i, j]
    }
    return null
  }
  const current = () => {
    const b: string[] = []
    for (let i = 1; i < end; i++) b.push(body(i).text)
    return fenceUsage(b.join('\n'))
  }
  /** Replace [from, to) by `texts` (new lines get the saved line's prefix and the fence's EOL). */
  const splice = (from: number, to: number, texts: string[]) => {
    // A line inserted after a last line without EOL: that line gets one.
    if (to === lines.length && texts.length > 0 && from > 0 && lines[from - 1]!.eol === '') lines[from - 1]!.eol = eol
    const tail = to > from ? lines[to - 1]!.eol : eol
    const add = texts.map((t, i) => ({ text: prefix + t, eol: i === texts.length - 1 ? (to > from ? tail : eol) : eol }))
    lines.splice(from, to - from, ...add)
    end += add.length - (to - from)
  }
  /** After the range of the nearest earlier key of R221's order that is present, else after the `saved:` line. */
  const insertAt = (key: FileKey): number => {
    for (const k of KEY_ORDER.slice(0, KEY_ORDER.indexOf(key)).reverse()) {
      const r = rangeOf(k)
      if (r) return r[1]
    }
    for (let i = 1; i < end; i++) if (savedValue(body(i).text)) return i + 1
    return 1
  }
  const setKey = (key: FileKey, value: string[] | null) => {
    const r = rangeOf(key)
    if (value === null) { if (r) splice(r[0], r[1], []); return }
    if (r) {
      const comment = trailingComment(body(r[0]).text)
      const next = [...value]
      next[0] = next[0] + comment
      splice(r[0], r[1], next)
    } else {
      const at = insertAt(key)
      splice(at, at, value)
    }
  }
  const now = current()
  for (const key of KEY_ORDER) {
    switch (key) {
      case 'view': {
        const c = change.view
        if (c === undefined || (c === null ? rangeOf('view') === null : now.view === c)) break
        setKey('view', c === null ? null : [`view: ${c}`])
        break
      }
      case 'group_by': {
        const c = change.group
        if (c === undefined) break
        if (c === null ? rangeOf('group_by') === null : now.group !== 'broken' && now.group !== null && same(now.group, nfcGroup(c))) break
        setKey('group_by', c === null ? null : groupLines(nfcGroup(c)))
        break
      }
      case 'lanes': {
        const c = change.lanes
        if (c === undefined || (c === null ? rangeOf('lanes') === null : now.lanes === c)) break
        setKey('lanes', c === null ? null : [`lanes: ${c}`])
        break
      }
      case 'lane_order': {
        const c = change.laneOrder
        if (c === undefined) break
        const v = c === null ? null : c.map((x) => x.normalize('NFC'))
        if (v === null ? rangeOf('lane_order') === null : now.laneOrder !== 'broken' && now.laneOrder !== null && same(now.laneOrder, v)) break
        setKey('lane_order', v === null ? null : [`lane_order: ${flowList(v)}`])
        break
      }
      case 'sort': {
        const c = change.sort
        if (c === undefined) break
        if (c === null ? now.sort === null : now.sort !== 'broken' && now.sort !== null && same(now.sort, c.map((l) => ({ by: l.by.normalize('NFC'), order: l.order })))) break
        setKey('sort', c === null ? null : sortLines(c))
        break
      }
      case 'columns': {
        const c = change.columns
        if (c === undefined) break
        if (c === null ? now.columns === null : now.columns !== 'broken' && now.columns !== null && same(now.columns, c.map((x) => x.normalize('NFC')))) break
        setKey('columns', c === null ? null : columnsLines(c))
        break
      }
      case 'widths': {
        const c = change.widths === undefined ? undefined : change.widths === null || change.widths.length === 0 ? null : change.widths
        if (c === undefined) break
        if (c === null ? rangeOf('widths') === null : now.widths !== 'broken' && now.widths !== null && sameWidths(now.widths, c)) break
        setKey('widths', c === null ? null : widthsLines(c.map(([k, v]) => [k.normalize('NFC'), v])))
        break
      }
    }
  }
  const out = lines.map((l) => l.text + l.eol).join('')
  return out === fenceSource ? null : out
}

/** v1-views §13.1: `withUsage` on the fence of `text` at the byte range `range` (as `queryFences` returns it); null as
 *  `withUsage`. Never touches `modified:` (the editor's autosave does, D-55). */
export function applyFenceUsage(text: string, range: [number, number], change: UsageChange): string | null {
  const bytes = new TextEncoder().encode(text)
  const dec = new TextDecoder()
  const src = dec.decode(bytes.subarray(range[0], range[1]))
  const out = withUsage(src, change)
  if (out === null) return null
  return dec.decode(bytes.subarray(0, range[0])) + out + dec.decode(bytes.subarray(range[1]))
}

// ------------------------------------------------------------------------------------------------ renames (§38)

/** D-184: a note's link text over `paths`, its stem unless another note shares the stem, then its path without `.md`. */
function linkText(path: string, paths: string[]): string {
  const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '')
  const stem = stemOf(path)
  const n = paths.filter((x) => stemOf(x).toLowerCase() === stem.toLowerCase()).length
  return n <= 1 ? stem : path.replace(/\.md$/, '')
}

/** D-291 from the vault root over `paths`: a path form, else the stem (root first, then the shortest path). */
function resolveRoot(target: string, paths: string[]): string | null {
  let t = trimWs(target).normalize('NFC').toLowerCase()
  t = t.replace(/\.md$/, '')
  if (t === '') return null
  const noMd = (p: string) => p.replace(/\.md$/, '').toLowerCase()
  const hit = paths.find((p) => noMd(p) === t)
  if (hit !== undefined) return hit
  if (t.includes('/')) return null
  const c = paths.filter((p) => noMd(p.split('/').pop() ?? p) === t)
  c.sort((a, b) => Number(a.includes('/')) - Number(b.includes('/')) || [...a].length - [...b].length || (a < b ? -1 : a > b ? 1 : 0))
  return c[0] ?? null
}

/** v1-views §38 (D-2193; FR-LNK-03 AC-26): the `retarget-links` op's patches of reference fences' `lane_order` values:
 *  each quoted `"[[…]]"` entry whose target resolves from the vault root (D-291, over `op.paths`) to `op.fromPath` gets
 *  the D-184 link text of `op.toPath`, its `|alias` / `#heading` part kept; only that value token changes. */
export function relinkFenceLaneOrderPatches(text: string, op: { fromPath: string; toPath: string; paths: string[] }): Patch[] {
  const from = op.fromPath.normalize('NFC')
  const to = op.toPath.normalize('NFC')
  const before = op.paths.map((p) => p.normalize('NFC'))
  const after = before.map((p) => (p === from ? to : p))
  const toText = linkText(to, after)
  const patches: Patch[] = []
  for (const f of findFences(text)) {
    if (f.saved === null || f.body === '') continue
    const lo = fenceUsage(f.body).laneOrder
    if (!Array.isArray(lo) || lo.length === 0) continue
    let at = eolAt(text, f.at[0])
    let inKey = false
    for (const line of f.body.split(/\r?\n/)) {
      if (at >= f.at[1]) break
      const lineEnd = eolAt(text, at)
      const bare = text.slice(at, lineEnd).replace(/\r?\n$/, '')
      const start = at + bare.length - line.length
      at = lineEnd
      if (/^lane_order:(?=[ \t]|$)/.test(line)) inKey = true
      else if (!(inKey && (/^[ \t]/.test(line) || line === '-' || line.startsWith('- ')))) { inKey = false; continue }
      if (/^[ \t]*#/.test(line) || start < 0 || !text.startsWith(line, start)) continue
      const code = line.slice(0, line.length - trailingComment(line).length)
      const re = /"\[\[((?:[^\]"\\]|\\.)*)\]\]"|'\[\[([^\]']*)\]\]'/g
      for (let m = re.exec(code); m; m = re.exec(code)) {
        const inner = m[1] ?? m[2] ?? ''
        const cut = inner.search(/[|#]/)
        const target = cut < 0 ? inner : inner.slice(0, cut)
        const rest = cut < 0 ? '' : inner.slice(cut)
        if (resolveRoot(target, before) !== from) continue
        const link = `[[${toText}${rest}]]`
        const value = m[1] !== undefined ? JSON.stringify(link) : `'${link.replace(/'/g, "''")}'`
        patches.push({ range: [start + m.index, start + m.index + m[0].length], text: value })
      }
    }
  }
  return patches
}
