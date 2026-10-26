// Slice MM (docs/contracts/mm-mindmap.md §1): a mindmap is a `> [!mindmap]` callout holding one list (D-679, D-680).
// The body is read on its own (D-765): the lines after the title line, without their `>`, are a document of their
// own, so an empty first item or a list starting at 2 right after the title is still the mindmap's list.
import type { List, ListItem, Nodes, PhrasingContent, RootContent } from 'mdast'
import { markdownTree } from './parse.js'

export type MindInline =
  | { k: 'text'; text: string; marks: ('strong' | 'emphasis' | 'code' | 'mark' | 'delete')[] }
  | { k: 'link'; target: string; alias: string | null; embed: boolean }
  | { k: 'tag'; value: string }
  | { k: 'break' }
  | { k: 'url'; href: string; text: string }
export type MindItem = { inline: MindInline[]; checked: boolean | null; more: boolean; path: number[]; children: MindItem[] }
export type MindRoot = { kind: 'item'; item: MindItem } | { kind: 'synthesized'; text: string } | { kind: 'empty' }
export type MindmapLayout = 'right' | 'spider'
export type MindmapTree = {
  title: string | null; typeSpelling: string; fold: '' | '+' | '-'; ordered: boolean; items: MindItem[]; root: MindRoot
  /** Slice MM2 (mm-mindmap §6.1, D-791): the layout named by the callout metadata, and that metadata as written. */
  layout: MindmapLayout; meta: string | null
}

// Slice MM2 (D-791): `[!type|metadata]` is Obsidian's callout metadata; the type is the text before `|`.
const HEAD = /^ {0,3}>[ \t]?\[!([^\]|\s]+)(?:\|([^\]]*))?\]([+-]?)[ \t]*(.*)$/

/** The title line of a callout block: its type as written, fold marker and title; null for any other block.
 *  Slice MM2 (mm-mindmap §6.1): `meta` is the callout metadata after `|`, as written; null without one. */
export function calloutHead(raw: string): { type: string; fold: '' | '+' | '-'; title: string; meta: string | null } | null {
  const first = raw.split(/\r?\n/, 1)[0]
  const m = HEAD.exec(first)
  if (!m) return null
  return { type: m[1], fold: m[3] as '' | '+' | '-', title: m[4].replace(/[ \t]+$/, ''), meta: m[2] ?? null }
}

/** The lines after a callout's title line with one `>` (and one following space) removed (D-765). Lazy
 *  continuation lines, which have no `>`, are kept as they are. */
export function calloutBody(raw: string): string {
  const lines = raw.split(/\r?\n/)
  return lines.slice(1).map((l) => l.replace(/^ {0,3}>[ ]?/, '')).join('\n')
}

const isMindmapType = (type: string) => type.toLowerCase() === 'mindmap'

/** The body's single list, `'empty'` for a body without blocks, or null when the body is anything else (D-680). */
function bodyList(raw: string): List | 'empty' | null {
  const tree = markdownTree(calloutBody(raw))
  const kids = tree.children as RootContent[]
  if (kids.length === 0) return 'empty'
  if (kids.length === 1 && kids[0].type === 'list') return kids[0]
  return null
}

/** D-680, D-765: a top-level block whose source is a `mindmap` callout holding one list (or nothing). */
export function isMindmapBlock(raw: string): boolean {
  const h = calloutHead(raw)
  return !!h && isMindmapType(h.type) && bodyList(raw) !== null
}

/** A `mindmap` callout whose body is not one list (the hint callout of D-680). */
export function isMindmapHint(raw: string): boolean {
  const h = calloutHead(raw)
  return !!h && isMindmapType(h.type) && bodyList(raw) === null
}

const nfc = (s: string) => s.normalize('NFC')

type Mark = 'strong' | 'emphasis' | 'code' | 'mark' | 'delete'
function inlines(nodes: PhrasingContent[], marks: Mark[], out: MindInline[]): void {
  for (const n of nodes as (PhrasingContent | Nodes)[]) {
    switch (n.type) {
      case 'text': {
        const parts = n.value.split(/\r?\n/)
        parts.forEach((p, i) => {
          if (i > 0) out.push({ k: 'break' })
          if (p) out.push({ k: 'text', text: nfc(p), marks: [...marks] })
        })
        break
      }
      case 'strong': inlines(n.children, [...marks, 'strong'], out); break
      case 'emphasis': inlines(n.children, [...marks, 'emphasis'], out); break
      case 'delete': inlines(n.children, [...marks, 'delete'], out); break
      case 'inlineCode': out.push({ k: 'text', text: nfc(n.value), marks: [...marks, 'code'] }); break
      case 'break': out.push({ k: 'break' }); break
      case 'link': {
        const text = (n.children as PhrasingContent[]).map(plain).join('')
        out.push({ k: 'url', href: n.url, text: nfc(text) })
        break
      }
      default: {
        const x = n as { type: string; value?: string; embed?: boolean; children?: PhrasingContent[] }
        if (x.type === 'highlight') inlines(x.children ?? [], [...marks, 'mark'], out)
        else if (x.type === 'wikiLink') {
          const v = nfc(x.value ?? '')
          const bar = v.search(/(?<!\\)\|/)
          out.push({ k: 'link', target: (bar < 0 ? v : v.slice(0, bar)).replace(/\\$/, ''), alias: bar < 0 ? null : v.slice(bar + 1), embed: !!x.embed })
        } else if (x.type === 'tag') out.push({ k: 'tag', value: nfc(x.value ?? '') })
        else if (x.type === 'comment') { /* hidden, as in any note */ }
        else if (x.children) inlines(x.children, marks, out)
        else if (typeof x.value === 'string') out.push({ k: 'text', text: nfc(x.value), marks: [...marks] })
      }
    }
  }
}

function plain(n: PhrasingContent): string {
  const x = n as { value?: string; children?: PhrasingContent[] }
  if (typeof x.value === 'string') return x.value
  return (x.children ?? []).map(plain).join('')
}

function item(li: ListItem, path: number[]): MindItem {
  const kids = li.children as RootContent[]
  const first = kids[0]
  const inline: MindInline[] = []
  let rest = kids
  if (first && first.type === 'paragraph') {
    inlines(first.children, [], inline)
    rest = kids.slice(1)
  }
  const lists = rest.filter((c): c is List => c.type === 'list')
  const more = rest.some((c) => c.type !== 'list')
  const children: MindItem[] = []
  for (const l of lists) for (const c of l.children) children.push(item(c, [...path, children.length]))
  return { inline, checked: li.checked ?? null, more, path, children }
}

/** The tree of a `mindmap` block's source, or null when the block isn't one (§1.2, D-681, D-774). */
export function mindmapTree(raw: string, noteTitle: string): MindmapTree | null {
  const h = calloutHead(raw)
  if (!h || !isMindmapType(h.type)) return null
  const list = bodyList(raw)
  if (list === null) return null
  const items = list === 'empty' ? [] : list.children.map((li, i) => item(li, [i]))
  const title = h.title.trim() === '' ? null : nfc(h.title.trim())
  const root: MindRoot = items.length === 1 ? { kind: 'item', item: items[0] }
    : items.length === 0 ? { kind: 'empty' }
    : { kind: 'synthesized', text: title ?? nfc(noteTitle) }
  return { title, typeSpelling: h.type, fold: h.fold, ordered: list !== 'empty' && !!list.ordered, items, root, layout: layoutOf(h.meta), meta: h.meta }
}

// ------------------------------------------------------------------------------------------------ wrap / unwrap (D-767)

const quote = (line: string) => (line.trim() === '' ? '>' : `> ${line}`)

/** D-767: the given blocks wrapped in `> [!mindmap]` (§1.3). One list keeps its own bytes, each line prefixed with
 *  `> `; paragraphs and headings become one bulleted item each. */
export function wrapMindmap(blocksRaw: string[], _gaps: string[]): string {
  const head = '> [!mindmap]'
  const one = blocksRaw.length === 1 ? blocksRaw[0] : null
  if (one !== null && markdownTree(one).children[0]?.type === 'list') {
    return [head, ...one.split(/\r?\n/).map(quote)].join('\n')
  }
  const items = blocksRaw.map((b) => {
    const text = b.split(/\r?\n/).map((l) => l.trim()).join(' ').replace(/^#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '')
    return `> - ${text}`
  })
  return [head, ...items].join('\n')
}

/** D-767: the mindmap callout removed (§1.3): a non-empty title becomes a paragraph above the list; `keep` keeps the
 *  list's bytes, the other kinds re-mark every item (W6, W8, W8a). */
export function unwrapMindmap(raw: string, to: 'bulletList' | 'orderedList' | 'checklist' | 'keep'): string {
  const h = calloutHead(raw)
  if (!h) return raw
  let list = calloutBody(raw).replace(/\n+$/, '')
  const parsed = markdownTree(list).children[0]
  const kind = parsed?.type === 'list' ? (parsed.ordered ? 'orderedList' : parsed.children.some((i) => i.checked !== null && i.checked !== undefined) ? 'checklist' : 'bulletList') : null
  if (to !== 'keep' && to !== kind) {
    // Re-mark every item; nested items are re-indented to sit under the new marker's content column, so they stay
    // nested (`1. ` needs 3 spaces where `- ` needed 2). Other lines move with their item.
    const marker = to === 'bulletList' ? '-' : to === 'checklist' ? '- [ ]' : '1.'
    const stack: { from: number; to: number; content: number; n: number }[] = []
    let delta = 0
    list = list.split('\n').map((line) => {
      const m = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?(?=[ \t]|$)[ \t]?(.*)$/.exec(line)
      if (!m) return line.trim() === '' ? line : ' '.repeat(Math.max(0, line.replace(/\t/g, '    ').search(/\S|$/) + delta)) + line.trimStart()
      const from = m[1].replace(/\t/g, '    ').length
      while (stack.length && stack[stack.length - 1].from >= from && !(stack[stack.length - 1].from === from)) stack.pop()
      let n = 1
      if (stack.length && stack[stack.length - 1].from === from) { const top = stack.pop()!; n = top.n + 1 }
      const parent = stack[stack.length - 1]
      const indent = parent ? parent.content : 0
      const mark = to === 'orderedList' ? `${n}.` : marker
      stack.push({ from, to: indent, content: indent + (to === 'orderedList' ? `${n}.`.length : 1) + 1, n })
      delta = indent - from
      return `${' '.repeat(indent)}${mark}${m[2] ? ` ${m[2]}` : ''}`
    }).join('\n')
  }
  const title = h.title.trim()
  return title ? `${title}\n\n${list}` : list
}

/** D-791: the layout a callout's metadata names: `spider` in any case, else `right`. */
export function layoutOf(meta: string | null | undefined): MindmapLayout {
  return (meta ?? '').toLowerCase() === 'spider' ? 'spider' : 'right'
}

/** Slice MM2 (mm-mindmap §6.1, D-791; W12…W13): rewrites only the callout's title line so its metadata names `layout`
 *  (`|spider`), or removes it for `right`; every other byte unchanged; `raw` itself when nothing changes (also for
 *  `|SPIDER` and `spider`, or unknown metadata and `right`, §6.6). */
export function setMindmapLayout(raw: string, layout: MindmapLayout): string {
  const h = calloutHead(raw)
  if (!h || layoutOf(h.meta) === layout) return raw
  const nl = raw.indexOf('\n')
  const first = nl < 0 ? raw : raw.slice(0, nl)
  const line = first.replace(/\[!([^\]|\s]+)(?:\|[^\]]*)?\]/, (_m, type: string) => (layout === 'spider' ? `[!${type}|spider]` : `[!${type}]`))
  return nl < 0 ? line : line + raw.slice(nl)
}
