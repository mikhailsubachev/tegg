// Slice Q (docs/contracts/v1-queries.md §3.1; docs/acceptance/queries.md R140): the query fence in a note. A fenced code
// block whose info string's first word is exactly `query` (case-sensitive, D-1464), ``` or ~~~, at any depth (lists,
// quotes, callouts); the frontmatter is skipped. `queryFences` is the L3 twin of `tegg_format::query_fences`: ranges are
// UTF-8 byte offsets `[start, end)` from the opening marker through the closing line's EOL. Names are NFC (FR-FMT-12
// AC-9) and match case-insensitively (name key). Only the `saved:` value is ever rewritten; every other byte is kept.

import type { Nodes } from 'mdast'
import { formatScalar, type Patch } from './edit.js'
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
