// Slice 4C (docs/contracts/ms4-jobs.md §2.3): the text side of the job engine. Rust plans and writes; every byte change
// comes from here (one text engine, D-82). Link form rules: D-383; frontmatter links: D-388; NFC: FR-FMT-12.
// All ops of one call are computed as patches on the original text, so `edits` are ranges of the input.

import type { Link, Nodes } from 'mdast'
import { applyPatches, entryKeyText, formatEntry, type Patch, type Value } from './edit.js'
import { wikilinks } from './links.js'
import { parse, type Doc, type Range } from './parse.js'
import { applyInboxChange, type InboxChange } from './inbox.js'

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

export type Transformed = { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { kind: 'unchanged' }

type Retarget = Extract<TextOp, { op: 'retarget-links' }>

/** Applies `ops` in order (D-82). Byte offsets in `edits` are UTF-8 offsets into the input. */
export function transform(source: string, text: string, ops: TextOp[]): Transformed {
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
  const doc = parse(text)
  const patches: Patch[] = []
  for (const op of ops) {
    if (op.op === 'set-title') patches.push(...titlePatches(doc, op.title, op.now))
    else if (op.op === 'retarget-links') patches.push(...linkPatches(doc, source, op))
  }
  const changed = patches.filter((p) => text.slice(p.range[0], p.range[1]) !== p.text)
  if (changed.length === 0) return { kind: 'unchanged' }
  const out = applyPatches(text, changed)
  if (out === text) return { kind: 'unchanged' }
  const bytes = byteOffsets(text)
  const edits = [...changed].sort((a, b) => a.range[0] - b.range[0]).map((p) => ({ start: bytes(p.range[0]), end: bytes(p.range[1]) }))
  return { kind: 'bytes', text: out, edits }
}

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
  const fm = doc.frontmatter
  // A note without frontmatter (common in Obsidian vaults, D-05) gets one with the title, as editor AC-10 does.
  if (!fm && !doc.frontmatterError) {
    const at = doc.bom ? 1 : 0
    const head = fit(doc, `---\n${formatEntry('title', title)}${formatEntry('modified', { datetime: now })}---\n`)
    return [{ range: [at, at], text: head }]
  }
  if (!fm || fm.error) throw new Error('No valid frontmatter to set the title in (NFR-REL-03)')
  const out: Patch[] = []
  const missing: string[] = []
  for (const [key, value] of [['title', title], ['modified', { datetime: now }]] as [string, Value][]) {
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
  const needsAlias = toTitle !== toStem && toTitle !== toStem.replace(/ \(\d+\)$/, '')
  // An alias can't hold `[`, `]`, `|` or a line break without ending the link; such a title is shown from the file name.
  const aliasOk = !/[[\]|\r\n]/.test(toTitle)
  for (const l of wikilinks(doc)) {
    if (!resolvesTo(source, l.target, false, op)) continue
    const [s, e] = l.range
    const raw = doc.text.slice(s, e)
    const [ts, te] = [l.targetRange[0] - s, l.targetRange[1] - s]
    let name = doc.text.slice(l.targetRange[0], l.targetRange[1])
    if (stemChanges) name = renameLast(name, toStem)
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
    const next = rewriteUrl(url, toStem)
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
