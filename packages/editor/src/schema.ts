// TipTap schema for Tegg notes (ADR 0001/0002; ported from spike S2, D-83).
// Every top-level node carries `srcIndex`: the index of the source block it was loaded from, so saving can emit
// untouched blocks byte-for-byte. Obsidian syntax is modelled as nodes and marks, never plain text.

import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import Italic from '@tiptap/extension-italic'
import { ListItem } from '@tiptap/extension-list'
import Strike from '@tiptap/extension-strike'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { TagRules } from './tagRules'

export const TOP_LEVEL_TYPES = [
  'paragraph', 'heading', 'blockquote', 'callout', 'bulletList', 'orderedList', 'codeBlock',
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
    return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': v, ...(node.attrs.embed ? { 'data-embed': '' } : {}) }), wikiLabel(v, !!node.attrs.embed)]
  },
  renderText: ({ node }) => `${node.attrs.embed ? '!' : ''}[[${node.attrs.value}]]`,
})

/** The text a link chip shows: the alias, else the target without its subpath. */
export function wikiLabel(value: string, embed: boolean): string {
  const pipe = /\\?\|/.exec(value)
  if (pipe && !embed) return value.slice(pipe.index + pipe[0].length)
  const target = pipe ? value.slice(0, pipe.index) : value
  return target
}

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

/** A block preserved verbatim (HTML, footnote definitions, $$ math, plugin fences, embeds, queries, mindmaps). `kind`
 *  is the @tegg/doc block kind it came from; `embed`, `query` and `mindmap` are shown as placeholders (FR-EDT-01 AC-8). */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { source: { default: '' }, kind: { default: 'raw', rendered: false } }
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', getAttrs: (el) => ({ source: el.textContent ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-raw-block': '', contenteditable: 'false' }), String(node.attrs.source)]
  },
})

/** Obsidian callout `> [!type]± Title` (FR-EDT-02 AC-19). The title is the first child; `joined`: the body's first
 *  paragraph continues the title paragraph (`> [!tip] Tip\n> Body`) rather than being its own paragraph. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'calloutTitle block*',
  defining: true,
  addAttributes() {
    return {
      calloutType: { default: 'note', rendered: false },
      fold: { default: '', rendered: false },
      joined: { default: false, rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': String(node.attrs.calloutType).toLowerCase(), role: 'note' }), 0]
  },
})

export const CalloutTitle = Node.create({
  name: 'calloutTitle',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-callout-title]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout-title': '' }), 0]
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

// Marks without their default input rules: the editor's own Markdown shortcuts (rules.ts) follow CommonMark flanking
// so `2 * 3 * 4` stays text (FR-EDT-04 AC-2, AC-4).
const noRules = { addInputRules: () => [], addPasteRules: () => [], addKeyboardShortcuts: () => ({}) }

export function teggExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // not Markdown
      trailingNode: false, // would add an empty paragraph to every note
      listItem: false, // replaced by TeggListItem
      link: { openOnClick: false, autolink: false, linkOnPaste: false },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      bold: false,
      italic: false,
      strike: false,
      code: false,
      undoRedo: { newGroupDelay: 500 },
      dropcursor: false,
    }),
    Bold.extend(noRules),
    Italic.extend(noRules),
    Strike.extend(noRules),
    Code.extend(noRules),
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
    Callout,
    CalloutTitle,
    Highlight,
    TagRules,
    ...extra,
  ]
}
