// TipTap schema for Tegg notes (spike S2, ADR 0001/0002).
// Every top-level node carries `srcIndex`: the index of the source block it was loaded from,
// so saving can emit untouched blocks byte-for-byte. Obsidian syntax is modelled as nodes and
// marks, never plain text (S1 FINDINGS F1–F3).

import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core'
import { ListItem } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { TagRules } from './tagRules'

export const TOP_LEVEL_TYPES = [
  'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock',
  'horizontalRule', 'table', 'rawBlock',
] as const

/** Source bookkeeping and Markdown details ProseMirror doesn't model by itself. */
const SourceAttributes = Extension.create({
  name: 'teggSourceAttributes',
  addGlobalAttributes() {
    const hidden = { rendered: false }
    return [
      // A split creates a new block: the second half must not claim the source block.
      { types: [...TOP_LEVEL_TYPES], attributes: { srcIndex: { default: null, keepOnSplit: false, ...hidden } } },
      { types: ['bulletList', 'orderedList', 'listItem'], attributes: { spread: { default: false, ...hidden } } },
      { types: ['codeBlock'], attributes: { meta: { default: null, ...hidden } } },
      { types: ['table'], attributes: { align: { default: null, ...hidden } } },
    ]
  },
})

/** List item with an optional GFM checkbox (`- [ ]`, `- [x]`); null = plain item (FR-TSK-11). */
const TeggListItem = ListItem.extend({
  addAttributes() {
    return {
      checked: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => (el.hasAttribute('data-checked') ? el.getAttribute('data-checked') === 'true' : null),
        renderHTML: (attrs) => (attrs.checked === null ? {} : { 'data-checked': String(attrs.checked) }),
      },
    }
  },
})

/** `[[Target|alias]]` or `![[embed]]`; `value` is the inner text verbatim. */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { value: { default: '' }, embed: { default: false } }
  },
  parseHTML() {
    return [{ tag: 'span[data-wikilink]', getAttrs: (el) => ({ value: el.getAttribute('data-wikilink'), embed: el.hasAttribute('data-embed') }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const v = String(node.attrs.value)
    const label = v.includes('|') && !node.attrs.embed ? v.slice(v.search(/\\?\|/) + (v.includes('\\|') ? 2 : 1)) : v
    return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': v, ...(node.attrs.embed ? { 'data-embed': '' } : {}), class: node.attrs.embed ? 'embed' : 'wikilink' }), label]
  },
  renderText: ({ node }) => `${node.attrs.embed ? '!' : ''}[[${node.attrs.value}]]`,
})

/** `#tag` (FR-FMT-10). */
export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { value: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-tag]', getAttrs: (el) => ({ value: el.getAttribute('data-tag') }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-tag': node.attrs.value, class: 'tag' }), `#${node.attrs.value}`]
  },
  renderText: ({ node }) => `#${node.attrs.value}`,
})

/** Inline syntax the editor shows but doesn't edit: $math$, %%comment%%, inline HTML, footnote refs, images. */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { source: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'span[data-raw-inline]', getAttrs: (el) => ({ source: el.getAttribute('data-raw-inline') }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-raw-inline': node.attrs.source, class: 'raw-inline' }), node.attrs.source]
  },
  renderText: ({ node }) => String(node.attrs.source),
})

/** A block preserved verbatim (HTML, footnote definitions, $$ math, plugin fences, unsupported syntax). */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { source: { default: '' } }
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', getAttrs: (el) => ({ source: el.textContent ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-raw-block': '', class: 'raw-block', contenteditable: 'false' }), String(node.attrs.source)]
  },
})

/** `==highlight==`. */
export const Highlight = Mark.create({
  name: 'highlight',
  parseHTML() {
    return [{ tag: 'mark' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0]
  },
})

export function teggExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // not Markdown
      trailingNode: false, // would add an empty paragraph to every note
      listItem: false, // replaced by TeggListItem
      link: { openOnClick: false, autolink: false, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    TeggListItem,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    SourceAttributes,
    WikiLink,
    Tag,
    RawInline,
    RawBlock,
    Highlight,
    TagRules,
    ...extra,
  ]
}
