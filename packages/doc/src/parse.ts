// Source-preserving document model (ADR 0001, docs/markdown-dialect.md). Ported from spike S1 (D-83).
// A Doc never owns a regenerated copy of the file: it is the original text
// plus ranges. serialize(doc) === doc.text, always. Edits are patches (edit.ts).

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { isMap, isScalar, parseDocument, type Pair } from 'yaml'
import type { Nodes, Root, RootContent } from 'mdast'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown } from 'mdast-util-math'
import { inlineFromMarkdown, inlineSyntax, mathFromMarkdownObsidian, mathSyntax } from './inline.js'
import { tagFromMarkdown, tagSyntax } from './tag.js'
import { wikiLinkFromMarkdown, wikiLinkSyntax } from './wikilink.js'
import { isMindmapBlock } from './mindmap.js'

export type Range = readonly [start: number, end: number]

export type BlockKind =
  | 'paragraph' | 'heading' | 'list' | 'checklist' | 'quote' | 'callout'
  | 'code' | 'mindmap' | 'query' | 'divider' | 'table' | 'embed' | 'raw'

export interface Block {
  kind: BlockKind
  range: Range // absolute offsets into doc.text
  raw: string
  node: RootContent
}

export interface FrontmatterEntry {
  key: string
  range: Range // whole lines of this entry, absolute, including the line terminator
}

export interface Frontmatter {
  range: Range // from the opening `---` through the closing line's terminator
  innerRange: Range // the YAML text between the delimiters
  data: Record<string, unknown> | null // null when the YAML is invalid
  entries: FrontmatterEntry[]
  error: { message: string; line: number } | null
}

export interface Doc {
  text: string // full file text as decoded, including a BOM if present
  bom: boolean
  eol: '\n' | '\r\n'
  finalNewline: boolean
  frontmatter: Frontmatter | null
  frontmatterWarning: string | null
  /** D-97: an opening `---` that never closes (then `frontmatter` is null and the file is body). */
  frontmatterError: { message: string; line: number } | null
  bodyStart: number
  blocks: Block[]
  mdast: Root
}

// ---------------------------------------------------------------- bytes <-> text

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const encoder = new TextEncoder()

export function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes) // throws on invalid UTF-8; ignoreBOM keeps U+FEFF in the string
}

export function encode(text: string): Uint8Array {
  return encoder.encode(text)
}

// ---------------------------------------------------------------- parse

export function parse(text: string): Doc {
  const bom = text.startsWith('﻿')
  const start = bom ? 1 : 0
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  const eol = crlf > lf ? '\r\n' : '\n'
  const finalNewline = text.endsWith('\n')

  const { frontmatter, warning } = parseFrontmatter(text, start)
  const bodyStart = frontmatter ? frontmatter.range[1] : start
  const body = text.slice(bodyStart)
  const mdast = parseMarkdown(body)
  shiftPositions(mdast, bodyStart)

  const blocks = mdast.children.map((node): Block => {
    const range: Range = [node.position!.start.offset!, node.position!.end.offset!]
    const raw = text.slice(range[0], range[1])
    return { kind: classify(node, raw), range, raw, node }
  })

  const frontmatterError = !frontmatter && warning ? { message: 'frontmatter not closed', line: 1 } : null
  return { text, bom, eol, finalNewline, frontmatter, frontmatterWarning: warning, frontmatterError, bodyStart, blocks, mdast }
}

export function serialize(doc: Doc): string {
  return doc.text
}

/** The mdast tree with the dialect's extensions (wikilinks, tags, highlights, comments, math), for display only
 *  (read view, ms3-shell §11.3). Positions are offsets into `text`. */
export function markdownTree(text: string): Root {
  return parseMarkdown(text)
}

function parseMarkdown(text: string): Root {
  const tree = fromMarkdown(text, {
    // $$ math from the extension; single-$ inline math with Obsidian's rules (inline.ts).
    extensions: [gfm(), math({ singleDollarTextMath: false }), mathSyntax, wikiLinkSyntax, tagSyntax, inlineSyntax],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown(), mathFromMarkdownObsidian, wikiLinkFromMarkdown, tagFromMarkdown, inlineFromMarkdown],
  })
  expandHighlights(tree)
  return tree
}

// The highlight construct captures its inner text as one text node; parse that text as
// inline Markdown so `==a *b*==` keeps its emphasis (else re-rendering escapes the `*`).
function expandHighlights(tree: Nodes): void {
  if (tree.type === 'highlight' && tree.children.length === 1 && tree.children[0].type === 'text') {
    const inner = tree.children[0]
    const start = inner.position!.start.offset!
    const para = parseMarkdown(inner.value).children[0]
    if (para?.type === 'paragraph') {
      shiftPositions(para, start)
      tree.children = para.children
    }
    return
  }
  if ('children' in tree) for (const c of tree.children) expandHighlights(c as Nodes)
}

// ---------------------------------------------------------------- frontmatter

const OPEN = /^---\r?\n/
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm

function parseFrontmatter(text: string, start: number): { frontmatter: Frontmatter | null; warning: string | null } {
  if (!OPEN.test(text.slice(start, start + 5))) return { frontmatter: null, warning: null }
  const innerStart = start + (text[start + 3] === '\r' ? 5 : 4)
  CLOSE.lastIndex = innerStart
  const close = CLOSE.exec(text)
  if (!close) {
    return { frontmatter: null, warning: 'Frontmatter is not closed; the file is read as body only.' }
  }
  const innerEnd = close.index
  const end = close.index + close[0].length
  const inner = text.slice(innerStart, innerEnd)

  const yamlDoc = parseDocument(inner, { uniqueKeys: true, prettyErrors: true })
  let data: Record<string, unknown> | null = null
  let error: Frontmatter['error'] = null
  const entries: FrontmatterEntry[] = []

  if (yamlDoc.errors.length > 0) {
    const e = yamlDoc.errors[0]
    let line = e.linePos?.[0].line ?? 1
    // A missing closing quote is detected at the end of the input; point at the line that opens it (NFR-REL-03).
    if (e.code === 'MISSING_CHAR' && /quote/i.test(e.message)) line = unclosedQuoteLine(inner, e.pos[0]) ?? line
    error = { message: e.message.split('\n')[0], line: line + 1 }
  } else {
    const json = yamlDoc.toJS() ?? {}
    data = typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
    if (isMap(yamlDoc.contents)) {
      for (const item of yamlDoc.contents.items as Pair[]) {
        if (!isScalar(item.key) || !item.key.range) continue
        const keyStart = item.key.range[0]
        const valueEnd = (item.value as { range?: [number, number, number] } | null)?.range?.[1] ?? item.key.range[1]
        entries.push({
          key: String(item.key.value),
          range: [innerStart + lineStart(inner, keyStart), innerStart + lineEnd(inner, valueEnd)],
        })
      }
    }
  }

  return {
    frontmatter: { range: [start, end], innerRange: [innerStart, innerEnd], data, entries, error },
    warning: null,
  }
}

/** 1-based line (within `inner`) of the last line before `pos` with an unbalanced `"` or `'`. */
function unclosedQuoteLine(inner: string, pos: number): number | null {
  const lines = inner.slice(0, pos).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(/\\"/g, '')
    if ((l.match(/"/g) ?? []).length % 2 === 1 || (l.replace(/''/g, '').match(/'/g) ?? []).length % 2 === 1) return i + 1
  }
  return null
}

function lineStart(s: string, i: number): number {
  return s.lastIndexOf('\n', i - 1) + 1
}

// End of the line containing position i-1, including its terminator.
function lineEnd(s: string, i: number): number {
  if (i > 0 && s[i - 1] === '\n') return i
  const nl = s.indexOf('\n', i)
  return nl === -1 ? s.length : nl + 1
}

// ---------------------------------------------------------------- blocks

function classify(node: RootContent, raw: string): BlockKind {
  switch (node.type) {
    case 'heading': return 'heading'
    case 'thematicBreak': return 'divider'
    case 'table': return 'table'
    case 'html': return 'raw'
    case 'footnoteDefinition': return 'raw'
    case 'definition': return 'raw'
    case 'math': return 'raw' // $$ … $$ display math, preserved
    // D-680, D-765: a `mindmap` callout holding one list (or nothing) is a mindmap; any other callout is a callout.
    case 'blockquote': return /^>\s*\[!\w[\w-]*(?:\|[^\]]*)?\][+-]?/.test(raw) ? (isMindmapBlock(raw) ? 'mindmap' : 'callout') : 'quote' // D-791: `[!type|metadata]`
    case 'list': return node.children.some((i) => i.checked !== null && i.checked !== undefined) ? 'checklist' : 'list'
    case 'code': {
      // D-679: a Mermaid `mindmap` fence is preserved as written, never drawn.
      if (node.lang === 'mermaid' && /^\s*mindmap\b/.test(node.value)) return 'raw'
      if (node.lang === 'query') return 'query'
      // Only ordinary fenced code is editable as code; indented code and unknown
      // plugin fences (dataview, …) are preserved raw.
      const fenced = /^(```|~~~)/.test(raw)
      if (!fenced || (node.lang && PLUGIN_FENCES.has(node.lang))) return 'raw'
      return 'code'
    }
    case 'paragraph': {
      const t = raw.trim()
      if (/^\$\$[\s\S]*\$\$$/.test(t) || /^%%[\s\S]*%%$/.test(t)) return 'raw'
      if (/^!\[\[[^\]\n]+\]\]$/.test(t)) return 'embed'
      return 'paragraph'
    }
    default: return 'raw'
  }
}

const PLUGIN_FENCES = new Set(['dataview', 'dataviewjs', 'tasks', 'excalidraw'])

function shiftPositions(tree: Nodes, by: number): void {
  if (tree.position) {
    tree.position.start.offset! += by
    tree.position.end.offset! += by
  }
  if ('children' in tree) for (const child of tree.children) shiftPositions(child as Nodes, by)
}
