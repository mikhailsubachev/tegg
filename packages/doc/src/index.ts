// Tegg document engine. Interface: docs/contracts/ms1-core.md §4.
// MS1 skeleton: every function is a stub returning a deliberately wrong value until it is implemented.

export type Range = readonly [start: number, end: number]
export type BlockKind = 'paragraph' | 'heading' | 'list' | 'checklist' | 'quote' | 'callout'
  | 'code' | 'mindmap' | 'query' | 'divider' | 'table' | 'embed' | 'raw'
export interface Block { kind: BlockKind; range: Range; raw: string }
export interface FrontmatterEntry { key: string; range: Range }
export interface Frontmatter {
  range: Range
  innerRange: Range
  data: Record<string, unknown> | null
  entries: FrontmatterEntry[]
  error: { message: string; line: number } | null
}
export interface Doc {
  text: string
  bom: boolean
  eol: '\n' | '\r\n'
  finalNewline: boolean
  frontmatter: Frontmatter | null
  bodyStart: number
  blocks: Block[]
}

const empty: Doc = { text: '', bom: false, eol: '\n', finalNewline: false, frontmatter: null, bodyStart: 0, blocks: [] }

export function decode(_bytes: Uint8Array): string { return '' }
export function encode(_text: string): Uint8Array { return new Uint8Array() }
export function parse(_text: string): Doc { return empty }
export function serialize(_doc: Doc): string { return '' }

export function editBlock(_doc: Doc, _index: number, _markdown: string): string { return '' }
export type Value = string | number | boolean | null
  | { date: string } | { datetime: string } | { link: string } | Value[]
export function setAttribute(_doc: Doc, _key: string, _value: Value): string { return '' }
export function setDateRange(_doc: Doc, _key: string, _start: string, _end: string): string { return '' }
export function removeAttribute(_doc: Doc, _key: string): string { return '' }
export function renameLinkTarget(_doc: Doc, _from: string, _to: string): string { return '' }

export interface WikiLink {
  embed: boolean
  range: Range
  target: string
  subpath: string | null
  alias: string | null
  escapedPipe: boolean
  inFrontmatter: boolean
}
export function wikilinks(_doc: Doc): WikiLink[] { return [] }
export interface Tag { name: string; key: string; range: Range | null }
export function tags(_doc: Doc): Tag[] { return [] }
export const tagKey = (_name: string): string => ''

export function newNote(_opts: { type: string; title: string; attributes?: [string, Value][]; body?: string; now: string; newId: () => string }): string { return '' }
export function ensureIdentity(_doc: Doc, _opts: { now: string; newId: () => string }): string { return '' }
export function touchModified(_before: string, _after: string, _now: string): string { return '' }

export interface Extracted {
  title: string
  id: string | null
  type: string | null
  attributes: Record<string, unknown> | null
  frontmatterError: boolean
  links: { target: string; subpath: string | null; alias: string | null; embed: boolean; inFrontmatter: boolean }[]
  tags: string[]
}
export function extract(_text: string, _stem: string): Extracted {
  return { title: '', id: null, type: null, attributes: null, frontmatterError: false, links: [], tags: [] }
}
