// Slice I1 (docs/contracts/v1-import.md §6.5, §7.1, §7.4, §8; D-1534, D-1551): the text side of the Capacities import.
// Rust decides values, names, link outcomes and key order and passes them as JSON; every byte of a note comes from
// here (D-82). `importScan` is the one reader of links (the mdast parse, never a regex over the body, ADR 0003), and
// `importNote` patches the spans of that same parse, so link `n` is the same link in the plan and in the write.

import type { Nodes } from 'mdast'
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Pair, type Scalar } from 'yaml'
import { entryKeyText, flowList, formatKey, formatScalar, type Patch, type Value } from './edit.js'
import { markdownTree, parse, type Doc, type Range } from './parse.js'
import { d184Text, relPath } from './transform.js'

// ---------------------------------------------------------------- types (v1-import §7.1)

export type ImportScanDto = {
  frontmatter: { ok: true } | { ok: false; reason: string; line: number }
  links: ScannedLink[]
  numbers: { key: string; item: number | null; raw: string }[]
  nested: string[]
  invisible: { u200b: number; ufeff: number; u200c: number; u200d: number }
  crlf: boolean
}

export type ScannedLink = {
  n: number
  line: number
  place: 'body' | { frontmatter: { key: string } }
  form: 'wikilink' | 'embed' | 'markdown' | 'image'
  written: string
  target: string
  external: boolean
  text: string
  simplified: boolean
  inside: number | null
  aliasSafe: boolean
  inTable: boolean
}

export type FmValue =
  | string | boolean | string[]
  | { raw: string }
  | { date: string } | { datetime: string } | { link: string } | { links: string[] }
  | { asStored: string }

export type LinkEdit =
  | { n: number; do: 'link'; toPath: string; shown: string }
  | { n: number; do: 'embed'; file: string }
  | { n: number; do: 'date'; date: string }
  | { n: number; do: 'drop' }
  | { n: number; do: 'text'; value: string }

export type ImportNoteSpec = {
  frontmatter: [string, FmValue][]
  links: LinkEdit[]
  paths: string[]
  stub?: { note: string }
}

type Tally = { total: number; imported: number; reported: number }

/** `ReportData` as JSON (v1-import §5.3): camelCase fields, enums as camelCase strings or `kind`-tagged objects. */
export type ReportData = {
  summary: { source: string; space: string; date: string; objects: Tally; attachments: Tally; links: Tally; backup?: string | null }
  types: { sourceType: string; objects: number; target: string | null; new: boolean }[]
  noDay?: { note: string }[]
  unresolved: { note: string; n: number; written: string; reason: { kind: string; space?: string } }[]
  ambiguous: { note: string; n: number; title: string; chosen: string }[]
  caseLinks: { note: string; n: number; written: string; candidate: string; confirmed: boolean }[]
  simplified: { note: string; n: number; written: string; kept: string }[]
  attributes: { sourceType: string; sourceKey: string; change: { kind: string; key?: string; reason?: string; type?: string; value?: string; values?: number; nulls?: number; objects?: number } }[]
  merged: { sourceType: string; key: string; variants: string[]; kept: string }[]
  dates: { kind: string; note?: string; key?: string; value?: string; objects?: number }[]
  files: { source: string; change: { kind: string; n?: number; written?: string; name?: string; reasons?: string[] } }[]
  stubs: { note: string }[]
  skipped: { kind: string; source?: string; entry?: string; reason?: string; line?: number | null; file?: string; sourceType?: string; objects?: number }[]
  cleanup: { u200b: number; ufeff: number; u200c: number; u200d: number; crlfFiles: number }
  notExported: string[]
}

export type ImportNewSpec =
  | { kind: 'media'; frontmatter: [string, FmValue][]; file: string }
  /** `objects` is not in the contract (see `objectLink`): an optional map from a row's source path to the planned
   *  vault path of its object. When given it alone decides which objects are imported and where they are. */
  | { kind: 'report'; frontmatter: [string, FmValue][]; data: ReportData; strings: Record<string, string>; paths: string[]; objects?: Record<string, string> }

// ---------------------------------------------------------------- the one parse (scan and write share it)

type ScalarStyle = 'plain' | 'single' | 'double' | 'block'

/** A scanned link with what the write needs: its source range (null: a frontmatter link whose text isn't found
 *  verbatim in its scalar), the destination's range (inline links in the body) and a wikilink's inner text. */
type Hit = { link: ScannedLink; range: Range | null; url: Range | null; inner: string | null; style: ScalarStyle | null }

type Analysis = {
  doc: Doc
  hits: Hit[]
  numbers: ImportScanDto['numbers']
  nested: string[]
  /** Offsets of the invisible characters the import removes (outside code; ZWJ / ZWNJ of emoji sequences left out). */
  invisible: number[]
}

const nfc = (s: string) => s.normalize('NFC')
const within = (ranges: Range[], i: number) => ranges.some(([s, e]) => i >= s && i < e)
const lineAt = (text: string, offset: number) => {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) n++
  return n
}

function analyse(text: string): Analysis {
  const doc = parse(text)
  const hits: Hit[] = []
  const numbers: ImportScanDto['numbers'] = []
  const nested: string[] = []
  scanFrontmatter(doc, hits, numbers, nested)
  collect(doc.mdast, text, 'body', commentRanges(text, doc.bodyStart), hits)
  for (const h of hits) if (h.link.place === 'body') h.link.line = lineAt(text, h.range![0])
  const code = codeRanges(doc)
  const invisible = invisibleAt(text).filter((i) => !within(code, i))
  return { doc, hits, numbers, nested, invisible }
}

// ---------------------------------------------------------------- links (§6.5)

const OPAQUE = new Set(['code', 'inlineCode', 'html', 'math', 'inlineMath', 'comment', 'definition'])
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i

/** Every link of `root` by §6.5's table, in document order, appended to `out` (whose length numbers them). Offsets
 *  are offsets into `text`. */
function collect(root: Nodes, text: string, place: ScannedLink['place'], skip: Range[], out: Hit[]): void {
  const walk = (n: Nodes, inside: number | null, inTable: boolean): void => {
    const t = n.type as string
    if (OPAQUE.has(t)) return
    let me = inside
    const p = n.position
    if (p && (t === 'wikiLink' || t === 'link' || t === 'image') && !within(skip, p.start.offset!)) {
      const range: Range = [p.start.offset!, p.end.offset!]
      const hit = t === 'wikiLink' ? wikiHit(n as Nodes & { type: 'wikiLink' }) : inlineHit(n as Nodes & { type: 'link' | 'image' }, text, range)
      if (hit) {
        hit.range = range
        hit.link = { ...hit.link, n: out.length, place, written: text.slice(range[0], range[1]), inside, inTable, aliasSafe: !/[[\]|]/.test(hit.link.text) }
        out.push(hit)
        me = hit.link.n
      }
    }
    if ('children' in n) for (const c of n.children) walk(c as Nodes, me, inTable || t === 'tableCell')
  }
  walk(root, null, false)
}

const blank = (form: ScannedLink['form'], target: string, text: string, simplified: boolean, external: boolean): ScannedLink =>
  ({ n: 0, line: 0, place: 'body', form, written: '', target, external, text, simplified, inside: null, aliasSafe: true, inTable: false })

/** The parts of a wikilink's inner text: the name, `#subpath` as written, and the alias (`\|` read as `|`). */
function wikiParts(inner: string): { name: string; sub: string; alias: string | null } {
  const pipe = /\\?\|/.exec(inner)
  const ref = pipe ? inner.slice(0, pipe.index) : inner
  const hash = ref.indexOf('#')
  return { name: hash === -1 ? ref : ref.slice(0, hash), sub: hash === -1 ? '' : ref.slice(hash), alias: pipe ? inner.slice(pipe.index + pipe[0].length).replace(/\\\|/g, '|') : null }
}

function wikiHit(n: { embed: boolean; value: string }): Hit | null {
  const { name, alias } = wikiParts(n.value)
  const target = nfc(name.trim())
  if (target === '') return null // §6.5: a non-empty target
  return { link: blank(n.embed ? 'embed' : 'wikilink', target, alias ?? name.trim(), false, false), range: null, url: null, inner: n.value, style: null }
}

function inlineHit(n: Nodes & { type: 'link' | 'image' }, text: string, range: Range): Hit | null {
  const raw = text.slice(range[0], range[1])
  // §6.5: an autolink (`<…>`), a bare URL or address and a reference never start with the bracket and end with `)`.
  if (!raw.startsWith(n.type === 'image' ? '![' : '[') || !raw.endsWith(')') || n.url === '') return null
  let target = n.url
  try {
    target = decodeURIComponent(n.url)
  } catch {
    /* not a valid escape: the destination as written */
  }
  const shown = n.type === 'image' ? { text: n.alt ?? '', simplified: false } : plainText(n.children as Nodes[], text)
  const external = EXTERNAL.test(n.url) || n.url.startsWith('#')
  return { link: blank(n.type === 'image' ? 'image' : 'markdown', nfc(target), shown.text.replace(/[ \t]*\r?\n[ \t]*/g, ' '), shown.simplified, external), range: null, url: destination(n, raw, range[0]), inner: null, style: null }
}

/** A link's plain text (D-1533): formatting removed, an image as its alt; `simplified` when anything was dropped. */
function plainText(nodes: Nodes[], text: string): { text: string; simplified: boolean } {
  let out = ''
  let simplified = false
  for (const c of nodes) {
    const t = c.type as string
    if (t === 'text') out += (c as { value: string }).value
    else if (t === 'break') out += ' '
    else if (t === 'image') { out += (c as { alt?: string | null }).alt ?? ''; simplified = true }
    else if (t === 'inlineCode' || t === 'inlineMath') { out += (c as { value: string }).value; simplified = true }
    else if (t === 'wikiLink') { const w = wikiParts((c as { value: string }).value); out += w.alias ?? w.name.trim(); simplified = true }
    else if (t === 'html' || t === 'comment' || t === 'footnoteReference') simplified = true
    else if ('children' in c && t !== 'linkReference') { const r = plainText(c.children as Nodes[], text); out += r.text; simplified = true }
    else if (c.position) out += text.slice(c.position.start.offset!, c.position.end.offset!) // a tag, a reference: as written
  }
  return { text: out, simplified }
}

/** The source range of an inline link's or image's destination (`<…>` included), or null when it can't be found. */
function destination(n: Nodes & { type: 'link' | 'image' }, raw: string, at: number): Range | null {
  const last = n.type === 'link' && n.children.length ? n.children[n.children.length - 1].position : undefined
  let open = last ? raw.indexOf('](', last.end.offset! - at) : -1
  if (open === -1) open = raw.lastIndexOf('](')
  if (open === -1) return null
  let i = open + 2
  while (/\s/.test(raw[i] ?? '')) i++
  let j: number
  if (raw[i] === '<') j = raw.indexOf('>', i) + 1
  else {
    j = i
    let depth = 0
    while (j < raw.length - 1 && !/\s/.test(raw[j])) {
      if (raw[j] === '\\') j++
      else if (raw[j] === '(') depth++
      else if (raw[j] === ')') {
        if (depth === 0) break
        depth--
      }
      j++
    }
  }
  return j > i ? [at + i, at + j] : null
}

/** `%%…%%` over several lines isn't a node; links inside aren't links (dialect §5, as `links.ts`). */
function commentRanges(text: string, from: number): Range[] {
  const out: Range[] = []
  const comment = /%%[\s\S]*?%%/g
  comment.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = comment.exec(text))) out.push([m.index, m.index + m[0].length])
  return out
}

// ---------------------------------------------------------------- frontmatter values (§7.1)

/** Numbers by their source characters, keys of nested values, and the links in string values. */
function scanFrontmatter(doc: Doc, hits: Hit[], numbers: ImportScanDto['numbers'], nested: string[]): void {
  const fm = doc.frontmatter
  if (!fm || fm.error) return
  const at = fm.innerRange[0]
  const inner = doc.text.slice(at, fm.innerRange[1])
  const yaml = parseDocument(inner, { uniqueKeys: true })
  if (yaml.errors.length || !isMap(yaml.contents)) return
  const source = (s: Scalar) => (typeof s.source === 'string' ? s.source : s.range ? inner.slice(s.range[0], s.range[1]) : String(s.value))
  const isNumber = (v: unknown) => typeof v === 'number' || typeof v === 'bigint'
  const blockScalar = (s: Scalar) => s.type === 'BLOCK_LITERAL' || s.type === 'BLOCK_FOLDED'
  for (const pair of yaml.contents.items as Pair[]) {
    if (!isScalar(pair.key)) continue
    const key = String(pair.key.value)
    const v = pair.value as unknown
    let plain = true // the value has an `FmValue` form
    if (v === null || v === undefined) continue
    if (isScalar(v)) {
      if (v.anchor || v.tag || blockScalar(v)) plain = false
      else if (isNumber(v.value)) numbers.push({ key, item: null, raw: source(v) })
    } else if (isSeq(v) && !v.anchor && !v.tag) {
      v.items.forEach((item, i) => {
        if (isScalar(item) && !item.anchor && !item.tag && !blockScalar(item) && typeof item.value === 'string') return
        plain = false
        if (isScalar(item) && isNumber(item.value)) numbers.push({ key, item: i, raw: source(item) })
      })
    } else plain = false
    if (!plain) nested.push(key)
    if (isAlias(v)) continue
    visit(v as never, {
      Scalar(k, node) {
        if (k === 'key' || typeof node.value !== 'string' || !node.range) return
        if (!node.value.includes('[[') && !node.value.includes('](')) return // no link can be written without one of them
        const from = hits.length
        collect(markdownTree(node.value), node.value, { frontmatter: { key } }, commentRanges(node.value, 0), hits)
        // Where each link is in the file: its text found verbatim in the scalar's source, in order.
        const [s, e] = [at + node.range[0], at + node.range[1]]
        let cursor = s
        for (const h of hits.slice(from)) {
          const found = doc.text.indexOf(h.link.written, cursor)
          h.url = null
          h.range = found !== -1 && found + h.link.written.length <= e ? [found, found + h.link.written.length] : null
          if (h.range) cursor = h.range[1]
          h.link.line = lineAt(doc.text, h.range ? h.range[0] : s)
          h.style = node.type === 'QUOTE_DOUBLE' ? 'double' : node.type === 'QUOTE_SINGLE' ? 'single' : blockScalar(node) ? 'block' : 'plain'
        }
      },
    })
  }
}

// ---------------------------------------------------------------- invisible characters (FR-IMP-17)

const PICTO = /\p{Extended_Pictographic}/u
const BEFORE_JOINER = /(?:\p{Extended_Pictographic}|️|[\u{1F3FB}-\u{1F3FF}])$/u

/** Offsets of U+200B and U+FEFF, and of U+200C / U+200D that aren't inside an emoji sequence. */
function invisibleAt(text: string): number[] {
  const out: number[] = []
  const re = /[​﻿‌‍]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const i = m.index
    if (m[0] === '‌' || m[0] === '‍') {
      const next = text.codePointAt(i + 1)
      if (next !== undefined && PICTO.test(String.fromCodePoint(next)) && BEFORE_JOINER.test(text.slice(Math.max(0, i - 4), i))) continue
    }
    out.push(i)
  }
  return out
}

/** `s` without those characters (link text that becomes an alias). */
function strip(s: string): string {
  const at = new Set(invisibleAt(s))
  if (at.size === 0) return s
  let out = ''
  for (let i = 0; i < s.length; i++) if (!at.has(i)) out += s[i]
  return out
}

/** Code spans and fenced code of the body: their invisible characters stay (§7.1 step 3). */
function codeRanges(doc: Doc): Range[] {
  const out: Range[] = []
  const walk = (n: Nodes): void => {
    const p = n.position
    if (p && (n.type === 'inlineCode' || (n.type === 'code' && /^(?:`{3,}|~{3,})/.test(doc.text.slice(p.start.offset!, p.start.offset! + 3))))) {
      out.push([p.start.offset!, p.end.offset!])
      return
    }
    if ('children' in n) for (const c of n.children) walk(c as Nodes)
  }
  walk(doc.mdast)
  return out
}

// ---------------------------------------------------------------- importScan

/** The 1-based file line of a YAML error. An unclosed `[` or `{` is detected where the next line starts (or at the
 *  end of the frontmatter): the line is the one that opens it, as `parse` does for an unclosed quote (NFR-REL-03). */
function yamlErrorLine(doc: Doc): number {
  const fm = doc.frontmatter!
  const e = fm.error!
  if (!/^Flow (?:sequence|map) in block collection/.test(e.message)) return e.line
  const lines = doc.text.slice(fm.innerRange[0], fm.innerRange[1]).split('\n')
  for (let i = Math.min(e.line - 3, lines.length - 1); i >= 0; i--) {
    const open = (lines[i].match(/[[{]/g) ?? []).length - (lines[i].match(/[\]}]/g) ?? []).length
    if (open > 0) return i + 2 // the inner text starts on line 2
  }
  return e.line
}

export function importScan(text: string): ImportScanDto {
  const a = analyse(text)
  const fm = a.doc.frontmatter
  const frontmatter: ImportScanDto['frontmatter'] = fm?.error
    ? { ok: false, reason: 'yaml', line: yamlErrorLine(a.doc) }
    : a.doc.frontmatterError
      ? { ok: false, reason: 'unclosed', line: a.doc.frontmatterError.line }
      : { ok: true }
  const invisible = { u200b: 0, ufeff: 0, u200c: 0, u200d: 0 }
  for (const i of a.invisible) invisible[text[i] === '​' ? 'u200b' : text[i] === '﻿' ? 'ufeff' : text[i] === '‌' ? 'u200c' : 'u200d']++
  return { frontmatter, links: a.hits.map((h) => h.link), numbers: a.numbers, nested: a.nested, invisible, crlf: text.includes('\r\n') }
}

// ---------------------------------------------------------------- importNote

const folder = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** D-825: a destination as Tegg writes it: spaces and parentheses encoded, a `%` that would read as an escape too. */
const encodeDestination = (rel: string) =>
  rel.replace(/%(?=[0-9A-Fa-f]{2})/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E')

/** The patch of one `LinkEdit` (§8), or null when the link stays as written. */
function linkPatch(hit: Hit, edit: LinkEdit, source: string, paths: string[]): Patch | null {
  const l = hit.link
  if (!hit.range) return null
  const whole = (text: string): Patch => ({ range: hit.range!, text })
  if (edit.do === 'drop') return whole('')
  if (edit.do === 'text') return whole(edit.value)
  if (edit.do === 'embed') return whole(`![[${nfc(edit.file)}]]`)
  if (edit.do === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(edit.date)) throw new Error(`import-note: link ${l.n}: not a date`)
    return whole(`[[${edit.date}]]`)
  }
  if (edit.do !== 'link') throw new Error(`import-note: link ${l.n}: unknown edit`)
  const shown = strip(edit.shown ?? '').replace(/\s*\r?\n\s*/g, ' ')
  const pipe = (inner: string) => (l.inTable ? inner.replace(/\|/g, '\\|') : inner) // §8 (8), dialect §5
  if (hit.inner === null) {
    // D-1552: text that can't be an alias keeps the Markdown link; only its destination changes.
    if (!l.aliasSafe || /[[\]|]/.test(shown)) return hit.url ? { range: hit.url, text: encodeDestination(relPath(folder(source), nfc(edit.toPath))) } : null
    return whole(`[[${pipe(d184Text(source, edit.toPath, shown, paths))}]]`)
  }
  const was = wikiParts(hit.inner)
  // An embed keeps its `|size` or mode: that isn't a title. A subpath is kept as written.
  if (l.form === 'embed') return whole(`![[${pipe(d184Text(source, edit.toPath, '', paths) + was.sub + (was.alias === null ? '' : `|${was.alias}`))}]]`)
  const text = d184Text(source, edit.toPath, shown, paths)
  const cut = text.indexOf('|')
  return whole(`[[${pipe(cut === -1 ? text + was.sub : text.slice(0, cut) + was.sub + text.slice(cut))}]]`)
}

/** `text[from, to)` with the link patches inside it applied, the invisible characters removed and CRLF as LF. */
function rewrite(a: Analysis, from: number, to: number, patches: Patch[]): string {
  const text = a.doc.text
  const links = patches.filter((p) => p.range[0] >= from && p.range[1] <= to).sort((x, y) => x.range[0] - y.range[0] || y.range[1] - x.range[1])
  const kept: Patch[] = []
  for (const p of links) if (!kept.length || p.range[0] >= kept[kept.length - 1].range[1]) kept.push(p) // a link inside a rewritten link goes with it
  const spans = kept.map((p) => p.range)
  const all = [...kept, ...a.invisible.filter((i) => i >= from && i < to && !within(spans, i)).map((i): Patch => ({ range: [i, i + 1], text: '' }))]
  all.sort((x, y) => x.range[0] - y.range[0])
  let out = ''
  let pos = from
  for (const p of all) {
    out += text.slice(pos, p.range[0]) + p.text
    pos = p.range[1]
  }
  return (out + text.slice(pos, to)).replace(/\r\n/g, '\n')
}

function scalarText(s: string): string {
  // One `key: value` line per entry: text over several lines is a double-quoted scalar, not a block.
  return /[\r\n]/.test(s) ? JSON.stringify(nfc(s)) : formatScalar(s)
}

function flow(items: Value[]): string {
  const multi = (v: Value) => typeof v === 'string' && /[\r\n]/.test(v)
  return items.some(multi) ? `[${items.map((v) => (multi(v) ? JSON.stringify(nfc(v as string)) : flowList([v]).slice(1, -1))).join(', ')}]` : flowList(items)
}

/** `---`, one entry per `[key, value]` in the given order, `---` (§7.1 step 1). `stored` gives an `asStored` value. */
function frontmatterBlock(entries: [string, FmValue][], stored: (key: string) => string): string {
  const seen = new Set<string>()
  let out = '---\n'
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue // R149: a null or absent value is omitted
    const key = nfc(k)
    if (seen.has(key)) throw new Error(`import: the key ${JSON.stringify(key)} is given twice`)
    seen.add(key)
    out += formatKey(key)
    if (typeof v === 'string') out += `: ${scalarText(v)}\n`
    else if (typeof v === 'boolean') out += `: ${v}\n`
    else if (Array.isArray(v)) out += `: ${flow(v.map(String))}\n`
    else if (typeof v !== 'object') throw new Error(`import: the value of ${JSON.stringify(key)} has no form (a number travels as { raw })`)
    else if ('raw' in v) {
      if (typeof v.raw !== 'string' || /[\r\n]/.test(v.raw) || v.raw.trim() === '') throw new Error(`import: the raw value of ${JSON.stringify(key)} isn't one line`)
      out += `: ${v.raw}\n`
    } else if ('date' in v) out += `: ${formatScalar({ date: v.date })}\n`
    else if ('datetime' in v) out += `: ${formatScalar({ datetime: v.datetime })}\n`
    else if ('link' in v) out += `: ${formatScalar({ link: v.link })}\n`
    else if ('links' in v) out += `: ${flowList(v.links.map((link) => ({ link })))}\n`
    else if ('asStored' in v) out += stored(v.asStored)
    else throw new Error(`import: the value of ${JSON.stringify(key)} has no form`)
  }
  return out + '---\n'
}

/** The text must read back with the frontmatter it was given (FR-IMP-03 AC-10); else the run fails before a write. */
function checked(out: string, entries: [string, FmValue][]): string {
  const doc = parse(out)
  const want = entries.filter(([, v]) => v !== null && v !== undefined).map(([k]) => nfc(k))
  const got = doc.frontmatter && !doc.frontmatter.error ? doc.frontmatter.entries.map((e) => e.key) : null
  if (got === null || got.length !== want.length || got.some((k, i) => k !== want[i])) throw new Error('import: the written frontmatter does not read back')
  return out
}

export function importNote(source: string, text: string, spec: ImportNoteSpec): string {
  const a = analyse(text)
  const { doc } = a
  const patches: Patch[] = []
  const stored: Patch[] = [] // links inside frontmatter values, used only where a value is copied as stored
  const seen = new Set<number>()
  for (const edit of spec.links ?? []) {
    const hit = a.hits[edit.n]
    if (!hit || seen.has(edit.n)) throw new Error(`import-note: no link ${edit.n}, or it is edited twice`)
    seen.add(edit.n)
    if (hit.link.place === 'body') {
      const p = linkPatch(hit, edit, source, spec.paths ?? [])
      if (p) patches.push(p)
    } else if (edit.do !== 'drop') {
      // §8 (10): a missing file in a frontmatter value stays as written. The replacement is escaped for its scalar.
      const p = linkPatch({ ...hit, url: null }, edit, source, spec.paths ?? [])
      if (p) stored.push({ range: p.range, text: hit.style === 'double' ? JSON.stringify(p.text).slice(1, -1) : hit.style === 'single' ? p.text.replace(/'/g, "''") : p.text })
    }
  }
  const asStored = (key: string): string => {
    const fm = doc.frontmatter
    const e = fm && !fm.error ? fm.entries.find((x) => x.key === key) ?? fm.entries.find((x) => nfc(x.key) === nfc(key)) : undefined
    if (!e) throw new Error(`import-note: no source entry ${JSON.stringify(key)} to copy as stored`)
    const part = rewrite(a, e.range[0] + entryKeyText(doc, e.range).length, e.range[1], stored)
    return part.endsWith('\n') ? part : part + '\n'
  }
  const head = frontmatterBlock(spec.frontmatter, asStored)
  // §7.1 step 4: the body is every byte after the frontmatter's closing line, changed only by steps 2 and 3.
  const body = spec.stub ? `${spec.stub.note}\n\n\`\`\`query\n\`\`\`\n` : rewrite(a, doc.frontmatter ? doc.bodyStart : 0, text.length, patches)
  const out = head + body
  return checked(out.endsWith('\n') ? out : out + '\n', spec.frontmatter)
}

// ---------------------------------------------------------------- importNew

const noStored = (): string => {
  throw new Error('import-new: a made file has no source value to copy')
}

export function importNew(source: string, spec: ImportNewSpec): string {
  const head = frontmatterBlock(spec.frontmatter, noStored)
  if (spec.kind === 'media') return checked(`${head}![[${nfc(spec.file)}]]\n`, spec.frontmatter)
  if (spec.kind === 'report') return checked(head + report(source, spec), spec.frontmatter)
  throw new Error('import-new: unknown kind')
}

// ---------------------------------------------------------------- the report Page (§5.3, §7.4)

/** Quoted source text: a code span with a backtick run longer than any in the text, a padding space where it starts or ends
 *  with a backtick, so the report adds no link of its own (FR-IMP-19 AC-8). Line breaks read as one space. */
function codeSpan(s: string): string {
  const text = s.replace(/\s*\r?\n\s*/g, ' ')
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  if (text === '') return '` `'
  return `${fence}${text.startsWith('`') ? ' ' : ''}${text}${text.endsWith('`') ? ' ' : ''}${fence}`
}

const NOT_EXPORTED: Record<string, string> = { queryDefinitions: 'notExported.queries', tagColoursAndCollections: 'notExported.tags', comments: 'notExported.comments' }
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stemOf = (p: string) => baseName(p).replace(/\.[^.]*$/, '')
const pathKey = (p: string) => nfc(p).toLowerCase()

function report(source: string, spec: Extract<ImportNewSpec, { kind: 'report' }>): string {
  const d = spec.data
  const paths = spec.paths ?? []
  // §7.4: full catalog keys; a missing key is written as the full key itself (§2).
  const word = (key: string) => spec.strings?.[`import.report.${key}`] ?? `import.report.${key}`
  const row = (...fields: (string | number)[]) => `- ${fields.join(' · ')}`

  /** The planned vault path of the object a row names by its source path, or null when it isn't imported. The
   *  contract gives the renderer `paths` only; without `objects` the path is the one equal to the source path, else
   *  the only one with the source's file stem. */
  const vaultPath = (src: string): string | null => {
    if (spec.objects) return spec.objects[src] ?? spec.objects[nfc(src)] ?? null
    const exact = paths.find((p) => pathKey(p) === pathKey(src))
    if (exact) return exact
    const same = paths.filter((p) => pathKey(stemOf(p)) === pathKey(stemOf(src)))
    return same.length === 1 ? same[0] : null
  }
  /** An object: a wikilink in D-184 form from the report's folder when it is imported, else its source path quoted. */
  const object = (src: string): string => {
    const path = vaultPath(src)
    if (path === null) return codeSpan(src)
    const stem = nfc(baseName(path).replace(/\.md$/i, ''))
    if (/^Daily\/\d{4}-\d{2}-\d{2}\.md$/i.test(nfc(path))) return `[[${stem}]]` // §8 (6): a day's note is its date link
    return `[[${d184Text(source, path, stem, paths)}]]`
  }

  const sections: [string, string[], string?][] = []
  const s = d.summary
  const tally = (key: string, t: Tally) => row(word(key), `${t.imported} ${word('summary.imported')}`, `${t.reported} ${word('summary.reported')}`, `${t.total} ${word('summary.total')}`)
  sections.push(['summary', [
    row(word('summary.source'), codeSpan(s.source)), row(word('summary.space'), s.space), row(word('summary.date'), s.date),
    tally('summary.objects', s.objects), tally('summary.attachments', s.attachments), tally('summary.links', s.links),
  ], s.backup ? `${word('noUndo')} ${codeSpan(s.backup)}` : undefined])

  sections.push(['types', [
    ...d.types.map((t) => row(t.sourceType, t.objects, t.target ?? word('word.notImported'), ...(t.new ? [word('word.new')] : []))),
    ...(d.noDay ?? []).map((r) => row(object(r.note), word('type.noDay'))),
  ]])
  sections.push(['unresolved', d.unresolved.map((r) => row(object(r.note), codeSpan(r.written), word(`reason.${r.reason.kind}`).replace('{space}', r.reason.space ?? '')))])
  sections.push(['ambiguous', d.ambiguous.map((r) => row(object(r.note), codeSpan(r.title), object(r.chosen)))])
  sections.push(['caseLinks', d.caseLinks.map((r) => row(object(r.note), codeSpan(r.written), object(r.candidate), word(r.confirmed ? 'word.confirmed' : 'word.leftUnresolved')))])
  sections.push(['simplified', d.simplified.map((r) => row(object(r.note), codeSpan(r.written), codeSpan(r.kept)))])
  sections.push(['attributes', d.attributes.map((r) => {
    const c = r.change
    const rest: (string | number)[] =
      c.kind === 'renamed' ? [codeSpan(c.key ?? ''), word(`key.${c.reason}`)]
      : c.kind === 'new' ? [codeSpan(c.key ?? ''), c.type ?? '']
      : c.kind === 'notCreated' ? [c.nulls ?? 0]
      : c.kind === 'valueNotInOptions' || c.kind === 'splitUnmatched' ? [codeSpan(c.value ?? ''), c.objects ?? 0]
      : [c.values ?? 0] // dropped, selectValues, asStored
    return row(r.sourceType, codeSpan(r.sourceKey), word(`attr.${c.kind}`), ...rest)
  })])
  sections.push(['merged', d.merged.map((r) => row(r.sourceType, codeSpan(r.key), r.variants.map(codeSpan).join(', '), codeSpan(r.kept)))])
  sections.push(['dates', d.dates.map((r) => (r.kind === 'importTime' ? row(word('date.importTime'), r.objects ?? 0) : row(object(r.note ?? ''), codeSpan(r.key ?? ''), codeSpan(r.value ?? ''), word('date.unreadable'))))])
  sections.push(['files', d.files.map((r) => {
    const c = r.change
    if (c.kind === 'droppedReference') return row(object(r.source), codeSpan(c.written ?? ''), word('file.droppedReference'))
    if (c.kind === 'unreferenced') return row(object(r.source), word('file.unreferenced'))
    if (c.kind === 'genericName') return row(object(r.source), codeSpan(baseName(r.source)), word('file.genericName'))
    return row(object(r.source), codeSpan(c.name ?? ''), (c.reasons ?? []).map((x) => word(`name.${x}`)).join(', '))
  })])
  sections.push(['stubs', d.stubs.map((r) => row(object(r.note)))])
  sections.push(['skipped', d.skipped.map((r) => {
    if (r.kind === 'type') return row(r.sourceType ?? '', word('skip.type'), r.objects ?? 0)
    if (r.kind === 'ignored') return row(codeSpan(r.source ?? ''), word(`skip.${r.file}`))
    if (r.kind === 'entry') return row(codeSpan(r.entry ?? ''), word(`skip.${r.reason}`))
    return row(codeSpan(r.source ?? ''), word(`skip.${r.reason}`), ...(r.kind === 'note' && typeof r.line === 'number' ? [r.line] : []))
  })])
  const c = d.cleanup
  sections.push(['cleanup', [
    ...([['U+200B', c.u200b], ['U+FEFF', c.ufeff], ['U+200C', c.u200c], ['U+200D', c.u200d]] as [string, number][]).filter(([, n]) => n > 0).map(([name, n]) => row(name, n)),
    ...(c.crlfFiles > 0 ? [row(word('cleanup.crlf'), c.crlfFiles)] : []),
  ]])
  sections.push(['notExported', d.notExported.map((k) => row(word(NOT_EXPORTED[k] ?? `notExported.${k}`)))])

  // §7.4: a heading, a blank line, the rows; one blank line between sections; one final newline.
  return sections
    .filter(([, rows]) => rows.length > 0)
    .map(([key, rows, after]) => `## ${word(`section.${key}`)}\n\n${rows.join('\n')}${after ? `\n\n${after}` : ''}`)
    .join('\n\n') + '\n'
}
