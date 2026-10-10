// mdast block ⇄ TipTap/ProseMirror JSON, one top-level block at a time.
// Anything without a lossless editor representation becomes rawInline / rawBlock holding the
// exact source text, so it is shown and moved but never re-rendered.

import type { JSONContent } from '@tiptap/core'
import type {
  BlockContent, Blockquote, Code, Heading, List, ListItem, Nodes, Paragraph, PhrasingContent,
  RootContent, Table, TableCell, TableRow,
} from 'mdast'

type Mark = { type: string; attrs?: Record<string, unknown> }

// ---------------------------------------------------------------- mdast → PM

export function blockToPM(node: RootContent, source: string): JSONContent {
  const raw = (n: Nodes): JSONContent => ({ type: 'rawBlock', attrs: { source: slice(n, source) } })
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inlines((node as Paragraph).children, [], source) }
    case 'heading':
      return { type: 'heading', attrs: { level: (node as Heading).depth }, content: inlines((node as Heading).children, [], source) }
    case 'blockquote':
      return { type: 'blockquote', content: blocks((node as Blockquote).children, source) }
    case 'list': {
      const list = node as List
      return {
        type: list.ordered ? 'orderedList' : 'bulletList',
        attrs: { spread: !!list.spread, ...(list.ordered ? { start: list.start ?? 1 } : {}) },
        content: list.children.map((item: ListItem) => ({
          type: 'listItem',
          attrs: { checked: item.checked ?? null, spread: !!item.spread },
          content: item.children.length ? blocks(item.children, source) : [{ type: 'paragraph' }],
        })),
      }
    }
    case 'code': {
      const code = node as Code
      return {
        type: 'codeBlock',
        attrs: { language: code.lang ?? null, meta: code.meta ?? null },
        content: code.value ? [{ type: 'text', text: code.value }] : undefined,
      }
    }
    case 'thematicBreak':
      return { type: 'horizontalRule' }
    case 'table': {
      const table = node as Table
      return {
        type: 'table',
        attrs: { align: table.align ?? null },
        content: table.children.map((row: TableRow, r) => ({
          type: 'tableRow',
          content: row.children.map((cell: TableCell) => ({
            type: r === 0 ? 'tableHeader' : 'tableCell',
            content: [{ type: 'paragraph', content: inlines(cell.children, [], source) }],
          })),
        })),
      }
    }
    default:
      return raw(node)
  }
}

function blocks(children: RootContent[], source: string): JSONContent[] {
  return children.map((c) => blockToPM(c, source))
}

function inlines(children: PhrasingContent[], marks: Mark[], source: string): JSONContent[] {
  const out: JSONContent[] = []
  for (const c of children) {
    switch (c.type) {
      case 'text':
        if (c.value) out.push(text(c.value, marks))
        break
      case 'emphasis': out.push(...inlines(c.children, [...marks, { type: 'italic' }], source)); break
      case 'strong': out.push(...inlines(c.children, [...marks, { type: 'bold' }], source)); break
      case 'delete': out.push(...inlines(c.children, [...marks, { type: 'strike' }], source)); break
      case 'highlight': out.push(...inlines(c.children, [...marks, { type: 'highlight' }], source)); break
      case 'link':
        out.push(...inlines(c.children, [...marks, { type: 'link', attrs: { href: c.url, title: c.title ?? null } }], source))
        break
      case 'inlineCode': if (c.value) out.push(text(c.value, [...marks, { type: 'code' }])); break
      case 'break': out.push({ type: 'hardBreak', ...(marks.length ? { marks } : {}) }); break
      case 'wikiLink': out.push({ type: 'wikiLink', attrs: { value: c.value, embed: c.embed }, ...(marks.length ? { marks } : {}) }); break
      case 'tag': out.push({ type: 'tag', attrs: { value: c.value }, ...(marks.length ? { marks } : {}) }); break
      default:
        // inlineMath, comment, html, footnoteReference, image, references, …
        out.push({ type: 'rawInline', attrs: { source: slice(c, source) }, ...(marks.length ? { marks } : {}) })
    }
  }
  return out
}

const text = (value: string, marks: Mark[]): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })

function slice(n: Nodes, source: string): string {
  return source.slice(n.position!.start.offset!, n.position!.end.offset!)
}

// ---------------------------------------------------------------- PM → mdast

export function pmToBlock(json: JSONContent): RootContent {
  const content = json.content ?? []
  const attrs = json.attrs ?? {}
  switch (json.type) {
    case 'paragraph':
      return { type: 'paragraph', children: trimEdges(phrasing(content)) }
    case 'heading':
      return { type: 'heading', depth: attrs.level as Heading['depth'], children: trimEdges(phrasing(content)) }
    case 'blockquote':
      return { type: 'blockquote', children: content.map(pmToBlock) as BlockContent[] }
    case 'bulletList':
    case 'orderedList':
      return {
        type: 'list',
        ordered: json.type === 'orderedList',
        ...(json.type === 'orderedList' ? { start: (attrs.start as number) ?? 1 } : {}),
        spread: !!attrs.spread,
        children: content.map((item) => ({
          type: 'listItem',
          checked: (item.attrs?.checked as boolean | null) ?? null,
          spread: !!item.attrs?.spread,
          children: (item.content ?? []).map(pmToBlock) as BlockContent[],
        })),
      }
    case 'codeBlock':
      return {
        type: 'code',
        lang: (attrs.language as string | null) ?? null,
        meta: (attrs.meta as string | null) ?? null,
        value: content.map((t) => t.text ?? '').join(''),
      }
    case 'horizontalRule':
      return { type: 'thematicBreak' }
    case 'table':
      return {
        type: 'table',
        align: (attrs.align as Table['align']) ?? null,
        children: content.map((row) => ({
          type: 'tableRow',
          children: (row.content ?? []).map((cell) => ({
            type: 'tableCell',
            // A cell holds one paragraph in the editor; extra paragraphs are joined with a space.
            children: (cell.content ?? []).flatMap((p, i) => [
              ...(i ? [{ type: 'text', value: ' ' } as PhrasingContent] : []),
              ...trimEdges(phrasing(p.content ?? [])),
            ]),
          })),
        })),
      }
    case 'rawBlock':
      return { type: 'html', value: String(attrs.source) } // html is written verbatim by to-markdown
    default:
      throw new Error(`No Markdown mapping for node type ${json.type}`)
  }
}

/**
 * Inline content → mdast phrasing, grouping marks into nested nodes. Marks already open are kept
 * outermost, so `*a **b** c*` stays one emphasis with a strong inside (not `*a* ***b*** *c*`).
 */
function phrasing(nodes: JSONContent[]): PhrasingContent[] {
  const root: PhrasingContent[] = []
  const stack: { mark: Mark; children: PhrasingContent[] }[] = []
  const top = () => (stack.length ? stack[stack.length - 1].children : root)
  const same = (a: Mark, b: Mark) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {})

  for (const n of nodes) {
    const marks = (n.marks ?? []).filter((m) => m.type !== 'code') as Mark[]
    // Keep the longest prefix of open marks that this node still has, in stack order.
    let keep = 0
    while (keep < stack.length && marks.some((m) => same(m, stack[keep].mark))) keep++
    stack.length = keep
    for (const m of marks) {
      if (stack.some((s) => same(s.mark, m))) continue
      const node = wrap(m)
      top().push(node as PhrasingContent)
      stack.push({ mark: m, children: (node as { children: PhrasingContent[] }).children })
    }
    top().push(leaf(n))
  }
  return root
}

/**
 * Markdown drops leading/trailing spaces of a paragraph, so to-markdown would encode them as
 * `&#x20;` to keep them. Users type spaces at the end of a line all the time and autosave runs
 * meanwhile, so trim them instead (S2 manual-testing finding).
 */
function trimEdges(children: PhrasingContent[]): PhrasingContent[] {
  const edge = (list: PhrasingContent[], end: boolean): void => {
    const i = end ? list.length - 1 : 0
    const n = list[i] as PhrasingContent | undefined
    if (!n) return
    if (n.type === 'text') {
      n.value = end ? n.value.replace(/[ \t]+$/, '') : n.value.replace(/^[ \t]+/, '')
      if (!n.value) { list.splice(i, 1); edge(list, end) }
    } else if ('children' in n && n.type !== 'link') edge(n.children as PhrasingContent[], end)
  }
  edge(children, true)
  edge(children, false)
  return children
}

function wrap(m: Mark): PhrasingContent {
  switch (m.type) {
    case 'bold': return { type: 'strong', children: [] }
    case 'italic': return { type: 'emphasis', children: [] }
    case 'strike': return { type: 'delete', children: [] }
    case 'highlight': return { type: 'highlight', children: [] } as unknown as PhrasingContent
    case 'link': return { type: 'link', url: String(m.attrs?.href ?? ''), title: (m.attrs?.title as string | null) ?? null, children: [] }
    default: throw new Error(`No Markdown mapping for mark ${m.type}`)
  }
}

function leaf(n: JSONContent): PhrasingContent {
  switch (n.type) {
    case 'text':
      return n.marks?.some((m) => m.type === 'code') ? { type: 'inlineCode', value: n.text ?? '' } : { type: 'text', value: n.text ?? '' }
    case 'hardBreak': return { type: 'break' }
    case 'wikiLink': return { type: 'wikiLink', value: String(n.attrs?.value), embed: !!n.attrs?.embed } as unknown as PhrasingContent
    case 'tag': return { type: 'tag', value: String(n.attrs?.value) } as unknown as PhrasingContent
    case 'rawInline': return { type: 'html', value: String(n.attrs?.source) } // written verbatim
    default: throw new Error(`No Markdown mapping for inline node ${n.type}`)
  }
}
