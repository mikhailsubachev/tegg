// Slice 4C (docs/contracts/ms4-jobs.md §2.3): the text side of the job engine. Rust plans and writes; every byte change
// comes from here (one text engine, D-82). Link form rules: D-383; frontmatter links: D-388; NFC: FR-FMT-12.
// All ops of one call are computed as patches on the original text, so `edits` are ranges of the input.

import type { Link, Nodes } from 'mdast'
import { applyPatches, entryKeyText, formatEntry, formatKey, type Patch, type Value } from './edit.js'
import { wikilinks } from './links.js'
import { parse, type Doc, type FrontmatterEntry, type Range } from './parse.js'
import { applyInboxChange, type InboxChange } from './inbox.js'
import { mergeInto, removeTagPatches, renameTagPatches } from './tagops.js'
import { isMap, isScalar, isSeq, parseDocument, type Node as YamlNode, type Pair } from 'yaml'

export type TextOp =
  | { op: 'retarget-links'; fromPath: string; fromStem: string; fromTitle: string; toPath: string; toStem: string; toTitle: string; paths: string[] }
  | { op: 'set-title'; title: string; now: string }
  // Slice 5B (ms5-capture §7.3): thin wrappers of `applyInboxChange` for the `inbox` job kind (not mixed with the others).
  | { op: 'set-review'; value: 'reviewed' | 'unreviewed'; now: string }
  | { op: 'set-type'; type: string; now: string }
  | { op: 'add-tags'; tags: string[]; now: string }
  | { op: 'append-link'; target: string; now: string }
  // D-573: a bulk `Link to…`; each file gets the D-184 text of `toPath` from its own folder (D-291 over `paths`).
  | { op: 'append-link-to'; toPath: string; toTitle: string; paths: string[]; now: string }
  // Slice 4D-lite (ms4-tags §4.2): tag jobs, merge and restore through an open editor.
  | { op: 'rename-tag'; key: string; to: string }
  | { op: 'remove-tag'; key: string }
  | { op: 'merge-into'; others: { path: string; title: string; text: string }[]; now: string }
  | { op: 'replace'; text: string }
  // Slice 4E-1 (ms4-jobs §14.4, D-804, D-810, D-813, D-826, D-829).
  | { op: 'map-properties'; map: { from: string; to: string | 'content' }[]; labels: Record<string, string> }
  | { op: 'keep-targets'; fromPath: string; toPath: string; paths: string[] }
  // A type move's own type change: `type` and, unless `now` is null (a template, D-829), `modified`; never `review` (D-826).
  | { op: 'change-type'; type: string; now: string | null; id?: string }
  // D-838: in a note that doesn't move, keep every link on its target when `fromPath` becomes `toPath`.
  | { op: 'hold-targets'; fromPath: string; toPath: string; paths: string[] }
  // 4E-1 (D-810, D-838): every link of the note at `source` keeps its target when all `moves` happen together (the
  // note itself may be one of them); `paths` are the vault's note paths before the moves.
  | { op: 'relink'; moves: { from: string; to: string }[]; paths: string[] }

export type Transformed = { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { kind: 'unchanged' }

type Retarget = Extract<TextOp, { op: 'retarget-links' }>
type MapProps = Extract<TextOp, { op: 'map-properties' }>
type KeepTargets = Extract<TextOp, { op: 'keep-targets' }>
const MOVE_OPS = new Set(['map-properties', 'keep-targets', 'change-type', 'hold-targets', 'relink'])
type Relink = Extract<TextOp, { op: 'relink' }>
type HoldTargets = Extract<TextOp, { op: 'hold-targets' }>

/** Applies `ops` in order (D-82). Byte offsets in `edits` are UTF-8 offsets into the input. */
export function transform(source: string, text: string, ops: TextOp[]): Transformed {
  // 4D-lite (ms4-tags §4.2): merge and replace are whole-text changes; the edit is the changed span.
  if (ops.some((o) => o.op === 'merge-into' || o.op === 'replace')) {
    let out = text
    for (const o of ops) {
      if (o.op === 'replace') out = o.text
      else if (o.op === 'merge-into') out = mergeInto(out, o.others, o.now)
    }
    return span(text, out)
  }
  // 5B Inbox ops (ms5-capture §7.3) are whole-text changes of `applyInboxChange`; the edit is the changed span.
  if (ops.length > 0 && ops.every((o) => o.op === 'set-review' || o.op === 'set-type' || o.op === 'add-tags' || o.op === 'append-link' || o.op === 'append-link-to')) {
    let out = text
    const changes = ops.map((o): InboxChange => (o.op === 'append-link-to' ? { op: 'append-link', target: d184Text(source, o.toPath, o.toTitle, o.paths), now: o.now } : (o as InboxChange)))
    for (const op of changes) {
      const r = applyInboxChange(out, op)
      if (r.kind === 'bytes') out = r.text
    }
    if (out === text) return { kind: 'unchanged' }
    let a = 0
    while (a < text.length && a < out.length && text[a] === out[a]) a++
    let b = 0
    while (b < text.length - a && b < out.length - a && text[text.length - 1 - b] === out[out.length - 1 - b]) b++
    const bytes = byteOffsets(text)
    return { kind: 'bytes', text: out, edits: [{ start: bytes(a), end: bytes(text.length - b) }] }
  }
  // 4E-1: a moved note gets map-properties, change-type and keep-targets in that order, each on the text the previous one
  // left (the Content lines may hold links keep-targets must see from the new folder); the edit is the changed span.
  if (ops.length > 1 && ops.some((o) => MOVE_OPS.has(o.op))) {
    let out = text
    for (const o of ops) {
      const r = transform(source, out, [o])
      if (r.kind === 'bytes') out = r.text
    }
    return span(text, out)
  }
  const doc = parse(text)
  const patches: Patch[] = []
  for (const op of ops) {
    if (op.op === 'map-properties') patches.push(...mapPatches(doc, op))
    else if (op.op === 'keep-targets') patches.push(...keepPatches(doc, op))
    else if (op.op === 'hold-targets') patches.push(...holdPatches(doc, source, op))
    else if (op.op === 'relink') patches.push(...relinkPatches(doc, source, op))
    else if (op.op === 'change-type') {
      // D-174: the edited key, then the identity keys a file without them gets (`id`, `modified`).
      const vals: [string, Value][] = [['type', op.type]]
      if (op.id && !doc.frontmatter?.entries.some((e) => e.key === 'id')) vals.push(['id', op.id])
      if (op.now !== null) vals.push(['modified', { datetime: op.now }])
      patches.push(...entryPatches(doc, vals))
    }
    if (op.op === 'set-title') patches.push(...titlePatches(doc, op.title, op.now))
    else if (op.op === 'retarget-links') patches.push(...linkPatches(doc, source, op))
    else if (op.op === 'rename-tag') patches.push(...renameTagPatches(doc, op.key, op.to))
    else if (op.op === 'remove-tag') patches.push(...removeTagPatches(doc, op.key))
  }
  const changed = patches.filter((p) => text.slice(p.range[0], p.range[1]) !== p.text)
  if (changed.length === 0) return { kind: 'unchanged' }
  const out = applyPatches(text, changed)
  if (out === text) return { kind: 'unchanged' }
  const bytes = byteOffsets(text)
  const edits = [...changed].sort((a, b) => a.range[0] - b.range[0]).map((p) => ({ start: bytes(p.range[0]), end: bytes(p.range[1]) }))
  return { kind: 'bytes', text: out, edits }
}

/** D-813 (ms4-jobs §14.4): the Content line of `map-properties` for one property, e.g. `**Autor:** Frank Herbert`:
 *  the stored value, not its display form (dates `YYYY-MM-DD`, lists joined with `, `, relations as their `[[links]]`,
 *  booleans `true`/`false`, no quotes). Exported for the Change type dialog's preview and the L1 tests. */
export function contentLine(label: string, value: unknown): string {
  return `**${nfc(label)}:** ${shownValue(value)}`
}

function shownValue(v: unknown): string {
  if (Array.isArray(v)) return v.filter((x) => !isEmpty(x)).map(shownValue).join(', ')
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.every(isEmpty))

/** D-184: the link text for the note at `toPath` written in `source`: its stem when the stem resolves to it from there
 *  (D-291), else its vault path without `.md`; `|title` when the title differs from that. */
export function d184Text(source: string, toPath: string, toTitle: string, paths: string[]): string {
  const path = nfc(toPath).replace(/\.md$/i, '')
  const stem = path.slice(path.lastIndexOf('/') + 1)
  const hit = resolveFrom(source, stem, false, paths.includes(toPath) ? paths : [...paths, toPath])
  const target = hit !== null && key(hit) === key(toPath) ? stem : path
  const shown = nfc(toTitle).trim()
  return shown && shown !== target ? `${target}|${shown}` : target
}

/** The link rewrite alone (FR-LNK-03 AC-7, AC-9, AC-20). Same edit rules as `transform`. */
export function rewriteLinks(source: string, text: string, op: Retarget): Transformed {
  return transform(source, text, [op])
}

// ---------------------------------------------------------------- set-title

function titlePatches(doc: Doc, title: string, now: string): Patch[] {
  return entryPatches(doc, [['title', title], ['modified', { datetime: now }]])
}

/** Sets each `[key, value]` in the frontmatter: an existing entry keeps its key text; missing ones are appended. */
function entryPatches(doc: Doc, values: [string, Value][]): Patch[] {
  const fm = doc.frontmatter
  // A note without frontmatter (common in Obsidian vaults, D-05) gets one with the title, as editor AC-10 does.
  if (!fm && !doc.frontmatterError) {
    const at = doc.bom ? 1 : 0
    const head = fit(doc, `---\n${values.map(([k, v]) => formatEntry(k, v)).join('')}---\n`)
    return [{ range: [at, at], text: head }]
  }
  if (!fm || fm.error) throw new Error('No valid frontmatter to write in (NFR-REL-03)')
  const out: Patch[] = []
  const missing: string[] = []
  for (const [key, value] of values) {
    const e = fm.entries.find((x) => x.key === key)
    const entry = fit(doc, formatEntry(key, value))
    if (e) out.push({ range: e.range, text: entryKeyText(doc, e.range) + entry.slice(entry.indexOf(':')) })
    else missing.push(entry)
  }
  if (missing.length) {
    const end = fm.innerRange[1]
    const needsNl = end > fm.innerRange[0] && doc.text[end - 1] !== '\n'
    out.push({ range: [end, end], text: (needsNl ? doc.eol : '') + missing.join('') })
  }
  return out
}

function fit(doc: Doc, s: string): string {
  const nfc = s.normalize('NFC')
  return doc.eol === '\r\n' ? nfc.replace(/\r?\n/g, '\r\n') : nfc
}

// ---------------------------------------------------------------- retarget-links

const nfc = (s: string) => s.normalize('NFC')
const key = (s: string) => nfc(s).trim().toLowerCase()

function linkPatches(doc: Doc, source: string, op: Retarget): Patch[] {
  const out: Patch[] = []
  const toStem = nfc(op.toStem)
  const toTitle = nfc(op.toTitle)
  const stemChanges = key(op.fromStem) !== key(toStem) || nfc(op.fromStem) !== toStem
  // The title needs an alias only when sanitizing changed it, not for a duplicate's ` (2)` suffix (D-383, FR-FMT-08 AC-10).
  // 4E (FR-STO-04 AC-9): a move's ` (2)` suffix keeps the link reading as the title, so it gets the alias.
  const moving = key(folder(op.fromPath)) !== key(folder(op.toPath))
  const needsAlias = toTitle !== toStem && (moving || toTitle !== toStem.replace(/ \(\d+\)$/, ''))
  // An alias can't hold `[`, `]`, `|` or a line break without ending the link; such a title is shown from the file name.
  const aliasOk = !/[[\]|\r\n]/.test(toTitle)
  // 4E (D-810): a move into another folder changes path forms and relative Markdown links even with the same stem.
  const moved = moving
  const toNoExt = nfc(op.toPath).replace(/\.md$/i, '')
  for (const l of wikilinks(doc)) {
    if (!resolvesTo(source, l.target, false, op)) continue
    const [s, e] = l.range
    const raw = doc.text.slice(s, e)
    const [ts, te] = [l.targetRange[0] - s, l.targetRange[1] - s]
    let name = doc.text.slice(l.targetRange[0], l.targetRange[1])
    if (moved && name.includes('/')) name = toNoExt + (/\.md$/i.exec(name)?.[0] ?? '')
    else if (stemChanges) name = renameLast(name, toStem)
    let tail = raw.slice(te, raw.length - 2) // `#sub`, `|alias` (or `\|alias`), as written
    if (!l.embed) {
      const sep = l.escapedPipe ? '\\|' : '|'
      if (l.alias !== null) {
        if (key(l.alias) === key(op.fromTitle)) {
          const at = tail.lastIndexOf(sep + l.alias)
          tail = tail.slice(0, at) + (needsAlias && aliasOk ? sep + toTitle : '')
        }
      } else if (needsAlias && aliasOk && stemChanges) {
        tail = tail + '|' + toTitle
      }
    }
    const text = raw.slice(0, ts) + name + tail + ']]'
    if (text !== raw) out.push({ range: [s, e], text: nfc(text) })
  }
  for (const m of markdownLinks(doc)) {
    if (!resolvesTo(source, m.target, true, op)) continue
    const url = doc.text.slice(m.url[0], m.url[1])
    const next = moved ? relativeUrl(url, folder(source), op.toPath) : rewriteUrl(url, toStem)
    if (next !== url) out.push({ range: m.url, text: next })
  }
  return out
}

/** The last path segment's stem replaced, folder and `.md` kept. */
function renameLast(name: string, stem: string): string {
  const slash = name.lastIndexOf('/')
  const dir = slash === -1 ? '' : name.slice(0, slash + 1)
  const base = name.slice(slash + 1)
  const ext = /\.md$/i.exec(base)?.[0] ?? ''
  return dir + stem + ext
}

/** A Markdown link URL with its file stem replaced; encoding style kept, spaces encoded when it had none (D-383, D-413). */
function rewriteUrl(url: string, stem: string): string {
  const angle = url.startsWith('<') && url.endsWith('>')
  const inner = angle ? url.slice(1, -1) : url
  const encoded = /%[0-9A-Fa-f]{2}/.test(inner)
  const slash = inner.lastIndexOf('/')
  const dir = slash === -1 ? '' : inner.slice(0, slash + 1)
  const ext = /\.md$/i.exec(inner.slice(slash + 1))?.[0] ?? ''
  let s = stem
  if (encoded) s = encodeURIComponent(stem)
  else if (!angle) s = stem.replace(/ /g, '%20')
  const next = dir + s + ext
  return angle ? `<${next}>` : next
}

/** A Markdown link URL pointing at `toPath` from a note in `fromFolder`: the relative path, `<…>` kept, encoding only
 *  the characters the original encoded (D-825; spaces and parentheses always when it isn't in `<…>`). */
function relativeUrl(url: string, fromFolder: string, toPath: string): string {
  const angle = url.startsWith('<') && url.endsWith('>')
  const inner = angle ? url.slice(1, -1) : url
  const encoded = new Set<string>()
  for (const run of inner.match(/(?:%[0-9A-Fa-f]{2})+/g) ?? []) {
    try {
      for (const ch of decodeURIComponent(run)) encoded.add(ch)
    } catch {
      /* not a valid escape: nothing learnt */
    }
  }
  const nonAscii = [...encoded].some((c) => c.codePointAt(0)! > 0x7f)
  const rel = relPath(fromFolder, nfc(toPath))
  let out = ''
  for (const ch of rel) {
    // Outside `<…>`, a space or a parenthesis (a ` (2)` name) would end or unbalance the destination: always encoded.
    const enc = ch !== '/' && (encoded.has(ch) || (nonAscii && ch.codePointAt(0)! > 0x7f) || (!angle && (ch === ' ' || ch === '(' || ch === ')')))
    out += !enc ? ch : ch === '(' ? '%28' : ch === ')' ? '%29' : encodeURIComponent(ch) // encodeURIComponent keeps ( )
  }
  return angle ? `<${out}>` : out
}

/** `to` (a vault path) relative to the folder `from`. */
function relPath(from: string, to: string): string {
  const a = from ? from.split('/') : []
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && key(a[i]) === key(b[i])) i++
  return '../'.repeat(a.length - i) + b.slice(i).join('/')
}

type MdLink = { target: string; url: Range }

/** Inline Markdown links in the body with a local destination; `url` is the destination's source range. */
function markdownLinks(doc: Doc): MdLink[] {
  const out: MdLink[] = []
  const walk = (n: Nodes): void => {
    if (n.type === 'link') {
      const found = destination(doc.text, n as Link)
      if (found) out.push(found)
    }
    if ('children' in n) for (const c of n.children) walk(c as Nodes)
  }
  walk(doc.mdast)
  return out
}

function destination(text: string, n: Link): MdLink | null {
  const p = n.position
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(n.url) || n.url.startsWith('#')) return null
  const s = p.start.offset!
  const e = p.end.offset!
  const raw = text.slice(s, e)
  if (!raw.endsWith(')')) return null // reference or autolink
  const open = raw.lastIndexOf('](')
  if (open === -1) return null
  let i = open + 2
  while (raw[i] === ' ' || raw[i] === '\t') i++
  let j: number
  if (raw[i] === '<') j = raw.indexOf('>', i) + 1
  else {
    j = i
    let depth = 0
    while (j < raw.length - 1 && !/\s/.test(raw[j])) {
      if (raw[j] === '(') depth++
      else if (raw[j] === ')') {
        if (depth === 0) break
        depth--
      }
      j++
    }
  }
  if (j <= i) return null
  let target = n.url
  try {
    target = decodeURIComponent(n.url)
  } catch {
    /* keep as written */
  }
  return { target, url: [s + i, s + j] }
}

// ---------------------------------------------------------------- map-properties (D-804, D-813, D-827)

function mapPatches(doc: Doc, op: MapProps): Patch[] {
  const fm = doc.frontmatter
  if (!fm || fm.error || !fm.data) return []
  const out: Patch[] = []
  const lines: string[] = []
  const entries = fm.entries
  const stored = storedValues(doc)
  for (const m of op.map) {
    const at = entries.findIndex((e) => nfc(e.key) === nfc(m.from))
    if (at === -1) continue
    const e = entries[at]
    const value = stored[e.key] ?? fm.data[e.key]
    // A target key the note already has can't take the value: it goes into the content instead (nothing is lost).
    const to = m.to !== 'content' && nfc(m.to) !== nfc(m.from) && entries.some((x) => nfc(x.key) === nfc(m.to)) ? 'content' : m.to
    if (to === 'content') {
      // R101: an empty value writes no Content line; its key leaves with the old type's other properties.
      if (!isEmpty(value)) lines.push(contentLine(op.labels[m.from] ?? m.from, value))
      out.push({ range: [commentStart(doc, entries, at), e.range[1]], text: '' })
    } else if (nfc(to) !== nfc(m.from)) {
      const keyText = entryKeyText(doc, e.range)
      out.push({ range: [e.range[0], e.range[0] + keyText.length], text: nfc(formatKey(to)) })
    }
  }
  if (lines.length) {
    const at = doc.bodyStart
    out.push({ range: [at, at], text: lines.map((l) => fit(doc, l)).join(doc.eol) + doc.eol + doc.eol })
  }
  return out
}

/** D-813: each frontmatter value as stored: strings as their value (quotes dropped), every other scalar as written
 *  (`0123`, `1.50`, `0x1F` stay as they are), lists item by item. */
function storedValues(doc: Doc): Record<string, unknown> {
  const fm = doc.frontmatter!
  const inner = doc.text.slice(fm.innerRange[0], fm.innerRange[1])
  const y = parseDocument(inner)
  const out: Record<string, unknown> = {}
  const one = (n: unknown): unknown => {
    if (isScalar(n)) return typeof n.value === 'string' || n.value === null || !n.range ? n.value : inner.slice(n.range[0], n.range[1])
    if (isSeq(n)) return n.items.map(one)
    return (n as YamlNode | null)?.toJSON?.() ?? n
  }
  if (isMap(y.contents)) for (const it of y.contents.items as Pair[]) if (isScalar(it.key)) out[String(it.key.value)] = one(it.value)
  return out
}

/** Where entry `at` starts once the full-line comments directly above it are counted with it. */
function commentStart(doc: Doc, entries: FrontmatterEntry[], at: number): number {
  const fm = doc.frontmatter!
  const floor = at > 0 ? entries[at - 1].range[1] : fm.innerRange[0]
  let start = entries[at].range[0]
  while (start > floor) {
    const prevEnd = start
    const lineStart = doc.text.lastIndexOf('\n', prevEnd - 2) + 1
    const line = doc.text.slice(Math.max(lineStart, floor), prevEnd)
    if (!/^\s*#/.test(line)) break
    start = Math.max(lineStart, floor)
  }
  return start
}

// ---------------------------------------------------------------- keep-targets (D-810)

function keepPatches(doc: Doc, op: KeepTargets): Patch[] {
  const out: Patch[] = []
  const before = op.paths
  const after = op.paths.some((p) => key(p) === key(op.fromPath)) ? op.paths.map((p) => (key(p) === key(op.fromPath) ? op.toPath : p)) : [...op.paths, op.toPath]
  const was = (target: string, md: boolean): string | null => {
    const b = resolveFrom(op.fromPath, target, md, before)
    return b === null ? null : key(b) === key(op.fromPath) ? op.toPath : b
  }
  for (const l of wikilinks(doc)) {
    const b = was(l.target, false)
    if (b === null) continue
    const a = resolveFrom(op.toPath, l.target, false, after)
    if (a !== null && key(a) === key(b)) continue
    const [s, e] = l.range
    const raw = doc.text.slice(s, e)
    const [ts, te] = [l.targetRange[0] - s, l.targetRange[1] - s]
    const written = doc.text.slice(l.targetRange[0], l.targetRange[1])
    const ext = /\.md$/i.exec(written)?.[0] ?? ''
    const noExt = nfc(b).replace(/\.md$/i, '')
    const stem = noExt.slice(noExt.lastIndexOf('/') + 1)
    const viaStem = resolveFrom(op.toPath, stem, false, after)
    const name = (viaStem !== null && key(viaStem) === key(b) ? stem : noExt) + ext
    let tail = raw.slice(te, raw.length - 2)
    if (!l.embed && l.alias === null) tail += pipeAt(doc, s) + written.trim()
    out.push({ range: [s, e], text: raw.slice(0, ts) + nfc(name) + tail + ']]' })
  }
  for (const m of markdownLinks(doc)) {
    const b = was(m.target, true)
    if (b === null) continue
    const a = resolveFrom(op.toPath, m.target, true, after)
    if (a !== null && key(a) === key(b)) continue
    const url = doc.text.slice(m.url[0], m.url[1])
    out.push({ range: m.url, text: relativeUrl(url, folder(op.toPath), b) })
  }
  return out
}

/** `\|` inside a table cell (a bare `|` would end the cell), else `|`. */
function pipeAt(doc: Doc, at: number): string {
  return doc.blocks.some((b) => b.kind === 'table' && b.range[0] <= at && at < b.range[1]) ? '\\|' : '|'
}

// ---------------------------------------------------------------- hold-targets (D-838)

function holdPatches(doc: Doc, source: string, op: HoldTargets): Patch[] {
  const out: Patch[] = []
  const before = op.paths
  const after = before.some((p) => key(p) === key(op.fromPath)) ? before.map((p) => (key(p) === key(op.fromPath) ? op.toPath : p)) : [...before, op.toPath]
  const was = (target: string, md: boolean): string | null => {
    const b = resolveFrom(source, target, md, before)
    return b === null ? null : key(b) === key(op.fromPath) ? op.toPath : b
  }
  for (const l of wikilinks(doc)) {
    const b = was(l.target, false)
    if (b === null) continue
    const a = resolveFrom(source, l.target, false, after)
    if (a !== null && key(a) === key(b)) continue
    const [s, e] = l.range
    const raw = doc.text.slice(s, e)
    const [ts, te] = [l.targetRange[0] - s, l.targetRange[1] - s]
    const written = doc.text.slice(l.targetRange[0], l.targetRange[1])
    const ext = /\.md$/i.exec(written)?.[0] ?? ''
    const noExt = nfc(b).replace(/\.md$/i, '')
    const stem = noExt.slice(noExt.lastIndexOf('/') + 1)
    // A path form stays a path form; a name gets the shortest form that resolves, the written text as its alias.
    let name: string
    if (written.includes('/')) name = noExt + ext
    else {
      const viaStem = resolveFrom(source, stem, false, after)
      name = (viaStem !== null && key(viaStem) === key(b) ? stem : noExt) + ext
    }
    let tail = raw.slice(te, raw.length - 2)
    if (!l.embed && l.alias === null && !written.includes('/') && key(name.replace(/\.md$/i, '')) !== key(written.trim().replace(/\.md$/i, ''))) tail += pipeAt(doc, s) + written.trim()
    out.push({ range: [s, e], text: raw.slice(0, ts) + nfc(name) + tail + ']]' })
  }
  for (const m of markdownLinks(doc)) {
    const b = was(m.target, true)
    if (b === null) continue
    const a = resolveFrom(source, m.target, true, after)
    if (a !== null && key(a) === key(b)) continue
    out.push({ range: m.url, text: relativeUrl(doc.text.slice(m.url[0], m.url[1]), folder(source), b) })
  }
  return out
}

// ---------------------------------------------------------------- relink (4E-1: the whole move set at once)

function relinkPatches(doc: Doc, source: string, op: Relink): Patch[] {
  const out: Patch[] = []
  const to = new Map(op.moves.map((m) => [key(m.from), nfc(m.to)]))
  const moved = (p: string) => to.get(key(p)) ?? p
  const before = op.paths
  const after = [...new Set([...before.map(moved), ...op.moves.map((m) => nfc(m.to))])]
  const from = nfc(source)
  const now = moved(from)
  const was = (target: string, md: boolean): string | null => {
    const b = resolveFrom(from, target, md, before)
    return b === null ? null : moved(b)
  }
  for (const l of wikilinks(doc)) {
    const b = was(l.target, false)
    if (b === null) continue
    const a = resolveFrom(now, l.target, false, after)
    if (a !== null && key(a) === key(b)) continue
    const [s, e] = l.range
    const raw = doc.text.slice(s, e)
    const [ts, te] = [l.targetRange[0] - s, l.targetRange[1] - s]
    const written = doc.text.slice(l.targetRange[0], l.targetRange[1])
    const ext = /\.md$/i.exec(written)?.[0] ?? ''
    const noExt = nfc(b).replace(/\.md$/i, '')
    const stem = noExt.slice(noExt.lastIndexOf('/') + 1)
    // A path form stays a path form (FR-STO-04 AC-7); a name gets the shortest form that resolves, with the written
    // text as its alias when that differs (D-838, FR-STO-04 AC-8, AC-9).
    let name: string
    if (written.includes('/')) name = noExt + ext
    else {
      const viaStem = resolveFrom(now, stem, false, after)
      name = (viaStem !== null && key(viaStem) === key(b) ? stem : noExt) + ext
    }
    let tail = raw.slice(te, raw.length - 2)
    if (!l.embed && l.alias === null && !written.includes('/') && key(name.replace(/\.md$/i, '')) !== key(written.trim().replace(/\.md$/i, ''))) tail += pipeAt(doc, s) + written.trim()
    out.push({ range: [s, e], text: raw.slice(0, ts) + nfc(name) + tail + ']]' })
  }
  for (const m of markdownLinks(doc)) {
    const b = was(m.target, true)
    if (b === null) continue
    const a = resolveFrom(now, m.target, true, after)
    if (a !== null && key(a) === key(b)) continue
    out.push({ range: m.url, text: relativeUrl(doc.text.slice(m.url[0], m.url[1]), folder(now), b) })
  }
  return out
}

// ---------------------------------------------------------------- resolution (D-291, ms3-shell §11.1)

const excluded = (p: string) => /^(_templates|\.trash)\//i.test(p)
const folder = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** Where `target`, written in `source`, resolves among `paths`; `null` when nowhere or to a Daily Note date. */
export function resolveFrom(source: string, target: string, markdown: boolean, paths: string[]): string | null {
  const t = nfc(target).trim()
  if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const pool = paths.filter((p) => !excluded(p))
  const byKey = (k: string) => pool.find((p) => key(p) === k) ?? null
  const withMd = (s: string) => (/\.md$/i.test(s) ? s : `${s}.md`)
  if (markdown) {
    const rel = normalizePath(`${folder(source)}/${t}`)
    const hit = rel && byKey(key(withMd(rel)))
    if (hit) return hit
  }
  const asPath = byKey(key(withMd(t)))
  if (asPath) return asPath
  if (t.includes('/')) return null
  const stem = key(t.replace(/\.md$/i, ''))
  const hits = pool.filter((p) => key(p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')) === stem)
  if (hits.length === 0) return null
  const here = hits.filter((p) => key(folder(p)) === key(folder(source)))
  const pick = (here.length ? here : hits).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return pick[0]
}

function normalizePath(p: string): string | null {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

function resolvesTo(source: string, target: string, markdown: boolean, op: Retarget): boolean {
  const hit = resolveFrom(source, target, markdown, op.paths)
  return hit !== null && key(hit) === key(op.fromPath)
}

// ---------------------------------------------------------------- offsets

/** UTF-16 index → UTF-8 byte offset in `text`. */
function byteOffsets(text: string): (i: number) => number {
  const enc = new TextEncoder()
  return (i) => enc.encode(text.slice(0, i)).length
}

/** A whole-text change as one edit over the changed span (byte offsets of the input). */
function span(text: string, out: string): Transformed {
  if (out === text) return { kind: 'unchanged' }
  let a = 0
  while (a < text.length && a < out.length && text[a] === out[a]) a++
  let b = 0
  while (b < text.length - a && b < out.length - a && text[text.length - 1 - b] === out[out.length - 1 - b]) b++
  const bytes = byteOffsets(text)
  return { kind: 'bytes', text: out, edits: [{ start: bytes(a), end: bytes(text.length - b) }] }
}
