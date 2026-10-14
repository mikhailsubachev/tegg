// mdast block ⇄ TipTap/ProseMirror JSON, one top-level block at a time (ported from spike S2, D-83).
// Anything without a lossless editor representation becomes rawInline / rawBlock holding the exact source text, so
// it is shown and moved but never re-rendered. Callouts (`> [!type]± Title`) are their own node (FR-EDT-02 AC-19).

import type { JSONContent } from '@tiptap/core'
import type {
  BlockContent, Blockquote, Code, Heading, List, ListItem, Nodes, Paragraph, PhrasingContent,
  RootContent, Table, TableCell, TableRow,
} from 'mdast'

type Mark = { type: string; attrs?: Record<string, unknown> }

// ---------------------------------------------------------------- mdast → PM

const CALLOUT_HEAD = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/

export function blockToPM(node: RootContent, source: string): JSONContent {
  const raw = (n: Nodes): JSONContent => ({ type: 'rawBlock', attrs: { source: slice(n, source) } })
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inlines((node as Paragraph).children, [], source) }
    case 'heading':
      return { type: 'heading', attrs: { level: (node as Heading).depth }, content: inlines((node as Heading).children, [], source) }
    case 'blockquote': {
      const callout = calloutToPM(node as Blockquote, source)
      if (callout) return callout
      return { type: 'blockquote', content: blocks((node as Blockquote).children, source) }
    }
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
        content: code.value ? [{ type: 'text', text: code.value.replace(/\r\n?/g, '\n') }] : undefined,
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

/** A blockquote whose first paragraph starts with `[!type]`: title = the rest of its first line. */
function calloutToPM(q: Blockquote, source: string): JSONContent | null {
  const first = q.children[0]
  if (!first || first.type !== 'paragraph') return null
  const lead = first.children[0]
  if (!lead || lead.type !== 'text') return null
  const m = CALLOUT_HEAD.exec(lead.value)
  if (!m) return null
  // Split the first paragraph at its first line break: the title line, then (joined) body text.
  const rest: PhrasingContent[] = [{ ...lead, value: lead.value.slice(m[0].length) } as PhrasingContent, ...first.children.slice(1)]
  const title: PhrasingContent[] = []
  const body: PhrasingContent[] = []
  let inBody = false
  for (const c of rest) {
    if (inBody) { body.push(c); continue }
    if (c.type === 'text' && c.value.includes('\n')) {
      const i = c.value.indexOf('\n')
      if (i > 0) title.push({ ...c, value: c.value.slice(0, i) } as PhrasingContent)
      const after = c.value.slice(i + 1)
      if (after) body.push({ ...c, value: after } as PhrasingContent)
      inBody = true
    } else if (c.type === 'break') {
      return null // a hard break in the title line has no editor form
    } else title.push(c)
  }
  const content: JSONContent[] = [{ type: 'calloutTitle', content: inlines(title, [], source) }]
  if (inBody) content.push({ type: 'paragraph', content: inlines(body, [], source) })
  content.push(...blocks(q.children.slice(1), source))
  return { type: 'callout', attrs: { calloutType: m[1], fold: m[2], joined: inBody }, content }
}

function blocks(children: RootContent[], source: string): JSONContent[] {
  return children.map((c) => blockToPM(c, source))
}

function inlines(children: PhrasingContent[], marks: Mark[], source: string): JSONContent[] {
  const out: JSONContent[] = []
  for (const c of children) {
    switch (c.type) {
      case 'text':
        if (c.value) out.push(text(c.value.replace(/\r\n?/g, '\n'), marks))
        break
      case 'emphasis': out.push(...inlines(c.children, [...marks, { type: 'italic' }], source)); break
      case 'strong': out.push(...inlines(c.children, [...marks, { type: 'bold' }], source)); break
      case 'delete': out.push(...inlines(c.children, [...marks, { type: 'strike' }], source)); break
      case 'link':
        out.push(...inlines(c.children, [...marks, { type: 'link', attrs: { href: c.url, title: c.title ?? null } }], source))
        break
      case 'inlineCode': if (c.value) out.push(text(c.value, [...marks, { type: 'code' }])); break
      case 'break': out.push({ type: 'hardBreak', ...(marks.length ? { marks } : {}) }); break
      default: {
        const t = (c as { type: string }).type
        const any = c as unknown as { value: string; embed: boolean; children: PhrasingContent[] }
        if (t === 'highlight') out.push(...inlines(any.children, [...marks, { type: 'highlight' }], source))
        else if (t === 'wikiLink') out.push({ type: 'wikiLink', attrs: { value: any.value, embed: any.embed }, ...(marks.length ? { marks } : {}) })
        else if (t === 'tag') out.push({ type: 'tag', attrs: { value: any.value }, ...(marks.length ? { marks } : {}) })
        // inlineMath, comment, html, footnoteReference, image, references, …
        else out.push({ type: 'rawInline', attrs: { source: slice(c, source) }, ...(marks.length ? { marks } : {}) })
      }
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
    case 'callout': {
      const [title, ...body] = content
      const head: PhrasingContent = { type: 'text', value: `[!${attrs.calloutType ?? 'note'}]${attrs.fold ?? ''}` }
      const titleKids = trimEdges(phrasing(title?.content ?? []))
      const first: PhrasingContent[] = [head]
      if (titleKids.length) first.push({ type: 'text', value: ' ' } as PhrasingContent, ...titleKids)
      let rest = body
      if (attrs.joined && body[0]?.type === 'paragraph') {
        const kids = trimEdges(phrasing(body[0].content ?? []))
        if (kids.length) first.push({ type: 'text', value: '\n' } as PhrasingContent, ...kids)
        rest = body.slice(1)
      }
      return { type: 'blockquote', children: [{ type: 'paragraph', children: first }, ...(rest.map(pmToBlock) as BlockContent[])] }
    }
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
const TAG_LIKE = /(^|[\s(])#(?=[\p{L}\p{M}\p{N}_\-/]*[\p{L}\p{M}_\-/])/u
/** Splits before each `#` that would start a tag; the `#` itself is dropped and written as `\#`. */
const TAG_SPLIT = /(?<=^|[\s(])#(?=[\p{L}\p{M}\p{N}_\-/]*[\p{L}\p{M}_\-/])/u

/** Emphasis can't start or end with whitespace in Markdown (it would need `&#x20;`): edge spaces of a bold, italic,
 *  strike or highlight run are written outside it. */
export function edgeSpacesOutside(nodes: JSONContent[]): JSONContent[] {
  const ATTN = new Set(['bold', 'italic', 'strike', 'highlight'])
  const out: JSONContent[] = []
  for (const n of nodes) {
    const marks = n.marks ?? []
    if (n.type !== 'text' || !marks.some((m) => ATTN.has(m.type)) || marks.some((m) => m.type === 'code')) { out.push(n); continue }
    const t = n.text ?? ''
    const lead = /^[ \t]+/.exec(t)?.[0] ?? ''
    const trail = t.length > lead.length ? (/[ \t]+$/.exec(t)?.[0] ?? '') : ''
    const mid = t.slice(lead.length, t.length - trail.length)
    const plain = marks.filter((m) => !ATTN.has(m.type))
    const piece = (text: string, ms: typeof marks): JSONContent => ({ type: 'text', text, ...(ms.length ? { marks: ms } : {}) })
    if (lead) out.push(piece(lead, plain))
    if (mid) out.push(piece(mid, marks))
    if (trail) out.push(piece(trail, plain))
  }
  return out
}

function phrasing(input: JSONContent[]): PhrasingContent[] {
  const nodes = edgeSpacesOutside(input)
  const root: PhrasingContent[] = []
  const stack: { mark: Mark; children: PhrasingContent[] }[] = []
  const top = () => (stack.length ? stack[stack.length - 1].children : root)
  const same = (a: Mark, b: Mark) => a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {})

  for (let idx = 0; idx < nodes.length; idx++) {
    const raw = nodes[idx]
    // A link whose text is its URL is written bare, as a GFM autolink literal (FR-EDT-14 AC-4).
    const link = raw.type === 'text' && raw.marks?.find((m) => m.type === 'link')
    const bare = !!link && raw.text === link.attrs?.href && /^(https?:\/\/|mailto:)/i.test(raw.text ?? '')
    const n: JSONContent = bare ? { type: 'rawInline', attrs: { source: raw.text }, marks: raw.marks!.filter((m) => m.type !== 'link') } : raw
    // Text that would read back as a tag (`#word` after a space) is literal text here: write `\#` (FR-EDT-14 AC-2).
    // A `#` at the start of this text counts only where the text before it allows a tag (block start, space, `(`).
    const prev = idx > 0 ? nodes[idx - 1] : null
    const lead = prev === null ? '' : prev.type === 'text' ? (prev.text ?? '').slice(-1) : 'x'
    const probe = lead + (n.text ?? '')
    if (n.type === 'text' && !n.marks?.some((m) => m.type === 'code' || m.type === 'link') && TAG_LIKE.test(probe)) {
      const parts = probe.split(TAG_SPLIT)
      parts[0] = parts[0].slice(lead.length)
      const pieces: JSONContent[] = []
      parts.forEach((p, i) => {
        if (i > 0) pieces.push({ type: 'rawInline', attrs: { source: '\\#' }, ...(n.marks ? { marks: n.marks } : {}) })
        if (p) pieces.push({ ...n, text: p })
      })
      for (const piece of pieces) emit(piece)
      continue
    }
    emit(n)
  }
  return root

  function emit(n: JSONContent) {
    const marks = (n.marks ?? []).filter((m) => m.type !== 'code') as Mark[]
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
}

/**
 * Markdown drops leading/trailing spaces of a paragraph, so to-markdown would encode them as `&#x20;` to keep them.
 * Users type spaces at the end of a line all the time and autosave runs meanwhile, so trim them instead.
 */
function trimEdges(children: PhrasingContent[]): PhrasingContent[] {
  const edge = (list: PhrasingContent[], end: boolean): void => {
    const i = end ? list.length - 1 : 0
    const n = list[i] as PhrasingContent | undefined
    if (!n) return
    if (n.type === 'break') {
      list.splice(i, 1)
      edge(list, end)
    } else if (n.type === 'text') {
      n.value = end ? n.value.replace(/[ \t\n]+$/, '') : n.value.replace(/^[ \t\n]+/, '')
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
