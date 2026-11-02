// TipTap schema for Tegg notes (ADR 0001/0002; ported from spike S2, D-83).
// Every top-level node carries `srcIndex`: the index of the source block it was loaded from, so saving can emit
// untouched blocks byte-for-byte. Obsidian syntax is modelled as nodes and marks, never plain text.

import { Extension, Mark, Node, mergeAttributes, type AnyExtension } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Code from '@tiptap/extension-code'
import HardBreak from '@tiptap/extension-hard-break'
import Italic from '@tiptap/extension-italic'
import { ListItem } from '@tiptap/extension-list'
import Strike from '@tiptap/extension-strike'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TagRules } from './tagRules'

/** A table's column alignments (the delimiter row, kept in `align`) shown on its cells, as the read view does
 *  (FR-EDT-02 AC-16, read-view AC-4; 5B feedback G6). Header cells without an alignment are left aligned (styles). */
const TableAlign = Extension.create({
  name: 'teggTableAlign',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = []
          state.doc.forEach((table, pos) => {
            if (table.type.name !== 'table' || !Array.isArray(table.attrs.align)) return
            const align = table.attrs.align as (string | null)[]
            table.forEach((row, rowOff) => {
              row.forEach((cell, cellOff, i) => {
                const a = align[i]
                if (a === 'left' || a === 'center' || a === 'right') {
                  const from = pos + 1 + rowOff + 1 + cellOff
                  decos.push(Decoration.node(from, from + cell.nodeSize, { style: `text-align: ${a}` }))
                }
              })
            })
          })
          return decos.length ? DecorationSet.create(state.doc, decos) : null
        },
      },
    })]
  },
})

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
    // D-709: `data-tag-key` (NFC, lower case) lets the app colour the tag with one style sheet, no transaction.
    const key = String(node.attrs.value).normalize('NFC').toLowerCase()
    return ['span', mergeAttributes(HTMLAttributes, { 'data-tag': node.attrs.value, 'data-tag-key': key, class: 'tag' }), `#${node.attrs.value}`]
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
      /** D-791: Obsidian callout metadata (`[!type|metadata]`), as written; null without one. */
      calloutMeta: { default: null, rendered: false },
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

/** ms3-shell §14.6 (D-240): the note's frontmatter text (everything before the body) as a doc attribute, so panel
 *  edits are steps of the same undo history as body edits (`TeggEditor.applyFrontmatter`). Never rendered. */
export const FrontmatterAttr = Extension.create({
  name: 'teggFrontmatter',
  addGlobalAttributes() {
    return [{ types: ['doc'], attributes: { frontmatter: { default: null, rendered: false } } }]
  },
})

// Marks without their default input rules: the editor's own Markdown shortcuts (rules.ts) follow CommonMark flanking
// so `2 * 3 * 4` stays text (FR-EDT-04 AC-2, AC-4).
const noRules = { addInputRules: () => [], addPasteRules: () => [], addKeyboardShortcuts: () => ({}) }

/** Leaves the code block holding the caret into a new empty paragraph after it; `trim` first removes the block's last
 *  `\n` (the empty last line). */
export function leaveCodeBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, trim: boolean): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'codeBlock') return false
  if (!dispatch) return true
  const tr = state.tr
  const end = $from.end()
  if (trim) tr.delete(end - 1, end)
  const after = tr.mapping.map($from.after())
  tr.insert(after, state.schema.nodes.paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
  dispatch(tr)
  return true
}

/** D-1356 (FR-EDT-02 AC-23): ⏎ on the empty last line of a code block removes that line and leaves the block; ⌘⏎
 *  leaves it from any line. Before TipTap's own code-block keys (its three-⏎ exit and ↓ at the end still work). */
const CodeBlockExit = Extension.create({
  name: 'teggCodeBlockExit',
  priority: 200,
  addKeyboardShortcuts() {
    const leaveAny = () => leaveCodeBlock(this.editor.state, this.editor.view.dispatch, false)
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        if (!empty || $from.parent.type.name !== 'codeBlock') return false
        const text = $from.parent.textContent
        if ($from.parentOffset !== text.length || !text.endsWith('\n')) return false
        return leaveCodeBlock(this.editor.state, this.editor.view.dispatch, true)
      },
      'Mod-Enter': leaveAny,
      'Meta-Enter': leaveAny,
    }
  },
})

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
      hardBreak: false,
    }),
    CodeBlockExit,
    HardBreak.extend({ addKeyboardShortcuts: () => ({ 'Shift-Enter': ({ editor }) => editor.commands.setHardBreak() }) }),
    Bold.extend(noRules),
    Italic.extend(noRules),
    Strike.extend(noRules),
    Code.extend(noRules),
    TeggListItem,
    Table.configure({ resizable: false, renderWrapper: true }),
    TableAlign,
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
    FrontmatterAttr,
    ...extra,
  ]
}
