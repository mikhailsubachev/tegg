// Pasted HTML → Markdown (FR-EDT-14 AC-3, D-186): structure and marks are kept; images become their alt text; scripts,
// styles and frames are dropped; links other than http(s) and mailto become their text. The HTML is parsed with
// DOMParser into an inert document, so nothing in it runs or loads (NFR-SEC-01).

import { renderBlock } from '@tegg/doc'
import type { BlockContent, ListItem, PhrasingContent, RootContent, TableRow } from 'mdast'

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'])
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'BODY', 'FIGURE'])
const SAFE = /^(https?:\/\/|mailto:)/i

type Marks = { strong?: boolean; emphasis?: boolean; del?: boolean; code?: boolean; href?: string }

function styleMarks(el: Element, m: Marks): Marks {
  const style = (el.getAttribute('style') ?? '').toLowerCase()
  const out = { ...m }
  const w = /font-weight\s*:\s*(\d+|bold)/.exec(style)
  if (w && (w[1] === 'bold' || Number(w[1]) >= 600)) out.strong = true
  if (/font-style\s*:\s*italic/.test(style)) out.emphasis = true
  if (/text-decoration[^;]*line-through/.test(style)) out.del = true
  return out
}

function wrapMarks(text: string, m: Marks): PhrasingContent {
  if (m.code) return { type: 'inlineCode', value: text }
  let node: PhrasingContent = { type: 'text', value: text }
  if (m.del) node = { type: 'delete', children: [node] }
  if (m.emphasis) node = { type: 'emphasis', children: [node] }
  if (m.strong) node = { type: 'strong', children: [node] }
  if (m.href) node = { type: 'link', url: m.href, title: null, children: [node] }
  return node
}

function inline(nodes: NodeListOf<ChildNode> | ChildNode[], m: Marks): PhrasingContent[] {
  const out: PhrasingContent[] = []
  for (const n of [...nodes]) {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ')
      if (t) out.push(wrapMarks(t, m))
      continue
    }
    if (n.nodeType !== 1) continue
    const el = n as Element
    const tag = el.tagName.toUpperCase()
    if (DROP.has(tag)) continue
    let mm = styleMarks(el, m)
    switch (tag) {
      case 'B': case 'STRONG': mm = { ...mm, strong: true }; break
      case 'I': case 'EM': mm = { ...mm, emphasis: true }; break
      case 'S': case 'DEL': case 'STRIKE': mm = { ...mm, del: true }; break
      case 'CODE': case 'KBD': case 'SAMP': mm = { ...mm, code: true }; break
      case 'BR': out.push({ type: 'break' }); continue
      case 'IMG': {
        const alt = el.getAttribute('alt') ?? ''
        if (alt) out.push(wrapMarks(alt, m))
        continue
      }
      case 'A': {
        const href = (el.getAttribute('href') ?? '').trim()
        if (SAFE.test(href)) mm = { ...mm, href }
        break
      }
    }
    out.push(...inline(el.childNodes, mm))
  }
  return merge(out)
}

/** Joins adjacent plain text runs, so `a` + ` b` is one text node. */
function merge(list: PhrasingContent[]): PhrasingContent[] {
  const out: PhrasingContent[] = []
  for (const n of list) {
    const prev = out[out.length - 1]
    if (n.type === 'text' && prev?.type === 'text') prev.value += n.value
    else out.push(n)
  }
  return out
}

function trim(children: PhrasingContent[]): PhrasingContent[] {
  const c = [...children]
  const first = c[0]
  if (first?.type === 'text') { first.value = first.value.replace(/^\s+/, ''); if (!first.value) c.shift() }
  const last = c[c.length - 1]
  if (last?.type === 'text') { last.value = last.value.replace(/\s+$/, ''); if (!last.value) c.pop() }
  return c
}

function blocks(parent: Element): RootContent[] {
  const out: RootContent[] = []
  let run: ChildNode[] = []
  const flush = () => {
    const kids = trim(inline(run, {}))
    run = []
    if (kids.length) out.push({ type: 'paragraph', children: kids })
  }
  for (const n of [...parent.childNodes]) {
    if (n.nodeType === 1) {
      const el = n as Element
      const tag = el.tagName.toUpperCase()
      if (DROP.has(tag)) continue
      if (BLOCK.has(tag)) {
        flush()
        out.push(...block(el))
        continue
      }
    }
    run.push(n)
  }
  flush()
  return out
}

function block(el: Element): RootContent[] {
  const tag = el.tagName.toUpperCase()
  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const kids = trim(inline(el.childNodes, styleMarks(el, {})))
      return kids.length ? [{ type: 'heading', depth: Number(tag[1]) as 1, children: kids }] : []
    }
    case 'UL': case 'OL': {
      const items: ListItem[] = [...el.children].filter((c) => c.tagName.toUpperCase() === 'LI').map((li) => {
        const kids = blocks(li) as BlockContent[]
        return { type: 'listItem', spread: false, checked: null, children: kids.length ? kids : [{ type: 'paragraph', children: [] }] }
      })
      return items.length ? [{ type: 'list', ordered: tag === 'OL', start: tag === 'OL' ? 1 : null, spread: false, children: items }] : []
    }
    case 'BLOCKQUOTE': {
      const kids = blocks(el) as BlockContent[]
      return kids.length ? [{ type: 'blockquote', children: kids }] : []
    }
    case 'PRE': return [{ type: 'code', lang: null, meta: null, value: (el.textContent ?? '').replace(/\n$/, '') }]
    case 'HR': return [{ type: 'thematicBreak' }]
    case 'TABLE': {
      const rows: TableRow[] = [...el.querySelectorAll('tr')].map((tr) => ({
        type: 'tableRow',
        children: [...tr.children].filter((c) => /^(TD|TH)$/i.test(c.tagName)).map((c) => ({ type: 'tableCell', children: trim(inline(c.childNodes, {})) })),
      }))
      if (!rows.length) return []
      const cols = Math.max(...rows.map((r) => r.children.length))
      for (const r of rows) while (r.children.length < cols) r.children.push({ type: 'tableCell', children: [] })
      return [{ type: 'table', align: rows[0].children.map(() => null), children: rows }]
    }
    default: return blocks(el)
  }
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return blocks(doc.body).map((b) => renderBlock(b)).join('\n\n')
}
