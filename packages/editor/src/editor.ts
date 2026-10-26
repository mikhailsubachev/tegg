// `createEditor` (docs/contracts/ms3-shell.md §13.3): a TipTap editor on a note's source blocks (ADR 0002). Saving
// reconciles the body against the loaded file and takes the frontmatter from the last saved text, so unchanged
// blocks keep their bytes across any number of autosaves; `ensureIdentity` and `touchModified` run on each real
// change (FR-FMT-02 AC-5…AC-7, D-174). Pure TypeScript: no Tauri, no app imports (AR-03 AC-2).

import { Editor, Extension, type JSONContent } from '@tiptap/core'
import { Fragment, Mark, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { closeHistory, undoDepth } from '@tiptap/pm/history'
import { ensureIdentity, parse, setAttribute, touchModified } from '@tegg/doc'
import { embedSection, isAttachmentTarget, renderBlock, withEmbedMode, type EmbedMode } from '@tegg/doc'
import { conversionUnit as unitOf, replaceUnitWithEmbed, type ConvertUnit, type Doc } from '@tegg/doc'
import { calloutHead, unwrapMindmap, wrapMindmap } from '@tegg/doc'
import type { List, ListItem } from 'mdast'
import { pmToBlock } from './convert'
import { htmlToMarkdown } from './html'
import { linkText, type LinkChoice } from './links'
import { focusedMindmap, hintElement, mindmapViews, PENDING_EMBED, presentation, uiRefresh, type EditorUi } from './present'
import { TeggRules } from './rules'
import { teggExtensions, wikiLabel } from './schema'
import { attach, END_LIST, loadDoc, reconcile, VerifyError, type Loaded } from './sourceDoc'

export type Now = () => string

export interface EditorOptions {
  text: string
  element?: HTMLElement
  now: Now
  newId: () => string
  /** Accessible name of the body (catalog text from the app; default `Note body`). */
  label?: string
  onChange?: (dirty: boolean) => void
  /** Called on every transaction (selection or content), for the app's menus and toolbar. */
  onUpdate?: () => void
  /** The selection moved (not by a content change). */
  onSelection?: () => void
  /** A clipboard image was pasted (FR-EDT-14 AC-5): the app shows its notice; nothing is inserted. */
  onImagePaste?: () => void
  extensions?: import('@tiptap/core').AnyExtension[]
  /** Presentation and interaction of chips, source blocks, checkboxes and the hint (the app's strings). */
  ui?: EditorUi
  /** 4F (D-421, D-422; ms4-embeds §7): show and edit only this part of the body. `null` = whole body; a heading
   *  text = that section without its heading line, recomputed after each `markSaved`. */
  section?: string | null
  /** 4F (D-428): ↑ on the first line / ↓ on the last line of a nested editor, and Esc. Return true when handled. */
  onLeave?(how: 'up' | 'down' | 'escape'): boolean
  /** 4F (D-428): ⏎ / ⌘↩ / `Display embed as…` on a selected block embed at `pos`. Return true when handled. */
  onEmbedKey?(pos: number, key: 'enter' | 'open' | 'displayAs'): boolean
  /** 5A-2 (ms5-tasks §11.3, D-494): false in `_templates/` notes and nested embed editors; `conversionUnit()` is then
   *  null. Default true. */
  convertible?: boolean
  /** Slice MM2 (mm-mindmap §6.6): false makes the editor read-only (ProseMirror `editable`); the mindmap map is then navigation only. Default true. */
  editable?: boolean
  /** 5A-2 (D-492): undo / redo of a conversion step. `afterUndo` runs after the undo applied; `beforeRedo` runs before
   *  the redo applies and returns the embed target to write, or false to cancel the redo. */
  conversion?: { afterUndo(r: ConversionRecord): void; beforeRedo(r: ConversionRecord): Promise<string | false> }
  /** 5A-2 (D-496): called before a user action removes block embeds (never for moves, undo, redo or conversions).
   *  Null removes at once; a promise defers the removal, which happens as one undo step only if it resolves true. */
  guardEmbedRemoval?(embeds: { pos: number; source: string }[]): Promise<boolean> | null
  /** 5A-2 (ms5-tasks §11.5): hint shown in an empty body, never saved (the Task card's `Add details…`). */
  emptyHint?: string
}

/** 5A-2 (ms5-tasks §11.3): what a conversion step remembers for undo / redo. */
export type ConversionRecord = { path: string; created: string; type: string; title: string }

export interface TeggEditor {
  view: EditorView
  editor: Editor
  save(): Promise<string | null>
  markSaved(text: string): void
  reload(text: string): void
  readonlyBlocks(): number[]
  /** The text a save would write now, without saving (test hook `editor.text()`, §13.6). */
  text(): string
  dirty(): boolean
  historyDepth(): number
  /** ms3-shell §14.6 (3D): a committed frontmatter edit as one undo step, saved with the next save(). */
  applyFrontmatter(next: string): void
  /** Pending title (FR-EDT-01 AC-10): written as `title:` by the next save; null = unchanged. */
  setTitle(title: string | null): void
  /** Top-level blocks in the block selection (0-based, inclusive), or null (FR-EDT-13). */
  blockSelection(): { from: number; to: number } | null
  clearBlockSelection(): void
  /** A document position followed through every later edit (appended transactions too); `null` once the node
   *  starting there is deleted (FR-LNK-04 AC-7: the Create offer's chip, D-287). */
  trackPos(pos: number): () => number | null
  /** Top-level block index of the caret. */
  caretBlock(): number
  /** The next paste is literal text (⇧⌘V, FR-EDT-14 AC-2). */
  pastePlainNext(): void
  /** Re-renders chips after the app learnt new link resolutions. */
  refreshUi(): void
  /** Markdown source of the selected blocks, or null without a block selection (FR-EDT-13 AC-5). */
  selectedSource(): string | null
  /** 4F (ms4-embeds §7): the block embed at the selection (one selected embed block, or a node selection), or null. */
  selectedEmbed(): { pos: number; index: number; source: string } | null
  /** 5A-2 (ms5-tasks §11.3): the conversion unit of the current selection, or null. */
  conversionUnit(): ConvertUnit | null
  commands: {
    turnInto(kind: string, opts?: { level?: number; calloutType?: string }): boolean
    /** Slice MM (mm-mindmap §3.2): switch the mindmap block holding the caret; false elsewhere. */
    mindmapView(view: 'map' | 'list'): boolean
    /** Slice MM2 (mm-mindmap §6.3, D-791): the layout of the mindmap block holding the caret or the focused map; false elsewhere or when already so. */
    mindmapLayout(layout: 'right' | 'spider'): boolean
    /** Slice MM (D-768): whether `Turn into › Mindmap` is offered for the current block or selection. */
    canTurnIntoMindmap(): 'yes' | 'disabled' | 'no'
    toggleMark(mark: 'bold' | 'italic' | 'strike' | 'code' | 'highlight'): boolean
    moveBlock(dir: 'up' | 'down'): boolean
    duplicateBlock(): boolean
    deleteBlocks(): boolean
    selectBlock(): boolean
    extendBlockSelection(dir: 'up' | 'down'): boolean
    selectBlockRange(from: number, to: number): boolean
    toggleChecklist(): boolean
    insertLink(target: LinkChoice): boolean
    insertTag(spelling: string): boolean
    /** ms4-links §5.3 (D-299): replaces the wikilink node at `pos` with `[[linkText]]` (no brackets given) as one step. */
    replaceLink(pos: number, linkText: string): boolean
    /** 4F (D-416): rewrites the block embed at `pos` with `withEmbedMode`, as one undo step. */
    setEmbedMode(pos: number, mode: EmbedMode | null): boolean
    /** 4F (D-426): replaces `from…to` with a block embed `![[linkText]]` (after the caret's block when it has other
     *  text, FR-EDT-03 AC-4), as one undo step. */
    insertEmbed(from: number, to: number, linkText: string): boolean
    /** 4F (D-428): selects the top-level block at `index` as a block. */
    selectBlockAt(index: number): boolean
    /** 5A-2 (ms5-tasks §11.3, D-490, D-492): replaces `unit` by its embed as one undo step; the embed's pos or false.
     *  `keepSelection` (D-689): the user moved on while the object was created, so their selection stays (mapped past
     *  the replaced blocks) and nothing scrolls; otherwise the embed is selected and scrolled into view. */
    convertUnit(unit: ConvertUnit, target: string, record: ConversionRecord, opts?: { keepSelection?: boolean }): number | false
    setUrlLink(href: string): boolean
    removeLink(): boolean
    pasteText(text: string, plain?: boolean): boolean
    pasteHtml(html: string): boolean
    tableAction(a: 'addRowBelow' | 'addColumnRight' | 'deleteRow' | 'deleteColumn'): boolean
    insertBlock(kind: string, opts?: { level?: number }): boolean
    /** Replaces `from…to` (the typed `[[query` or `#tag`) with a link or tag, as its own undo step (FR-EDT-06 AC-6). */
    replaceWithLink(from: number, to: number, target: LinkChoice): boolean
    replaceWithTag(from: number, to: number, spelling: string): boolean
    /** Moves top-level blocks `from…to` before block `before` (drag, FR-EDT-01 AC-4, FR-EDT-13 AC-3). */
    moveBlocksTo(from: number, to: number, before: number): boolean
    /** Deletes `from…to` and turns the caret's block into / inserts `kind` after it (slash menu, FR-EDT-03 AC-4). */
    slashInsert(from: number, to: number, kind: string, opts?: { level?: number }): boolean
    setCalloutType(type: string): boolean
    undo(): boolean
    redo(): boolean
  }
  destroy(): void
}

type Faults = { editorLoad?: boolean; verify?: boolean }
const faults = (): Faults => ((globalThis as { __TEGG_TEST__?: { faults?: Faults } }).__TEGG_TEST__?.faults ?? {})

/** prosemirror-history's meta key (`{ redo }` on undo and redo transactions). */
const HISTORY = 'history$'

/** 5A-2 (D-492): a conversion step: the documents and source models on both sides, for undo and redo. */
type Conversion = {
  /** null: a slice MM source step (wrap, unwrap, type change), which has no file of its own to follow. */
  record: ConversionRecord | null
  target: string
  before: PMNode
  after: PMNode
  loadedBefore: Loaded
  loadedAfter: Loaded
  state: 'done' | 'undone'
  pending: boolean
}

// ------------------------------------------------------------------------------------------------ block selection

type BlockSel = { anchor: number; head: number } | null
export const blockSelKey = new PluginKey<BlockSel>('teggBlockSelection')

const BlockSelection = Extension.create({
  name: 'teggBlockSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin<BlockSel>({
        key: blockSelKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(blockSelKey) as BlockSel | undefined
            if (meta !== undefined) return meta
            if (!value) return null
            // Load bookkeeping (the saved frontmatter attribute) keeps it: a conversion's flushed save leaves the new embed
            // selected (FR-CNV-01 AC-7).
            if ((tr.docChanged && !tr.getMeta('teggLoad')) || tr.selectionSet) return null
            return value
          },
        },
        props: {
          decorations(state) {
            const sel = blockSelKey.getState(state)
            if (!sel) return null
            const from = Math.min(sel.anchor, sel.head)
            const to = Math.max(sel.anchor, sel.head)
            const decos: Decoration[] = []
            let pos = 0
            state.doc.forEach((n, _o, i) => {
              if (i >= from && i <= to) decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-block-selected': '' }))
              pos += n.nodeSize
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

// ------------------------------------------------------------------------------------------------ helpers

function blockPos(doc: PMNode, k: number): number {
  let pos = 0
  for (let i = 0; i < k; i++) pos += doc.child(i).nodeSize
  return pos
}

function topIndex(state: EditorState, pos?: number): number {
  const $p = state.doc.resolve(pos ?? state.selection.from)
  return $p.depth === 0 ? Math.min($p.index(0), state.doc.childCount - 1) : $p.index(0)
}

/** First text position inside top-level block `k` (or near it). */
function startOf(doc: PMNode, k: number): number {
  const pos = blockPos(doc, k)
  return TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size))).from
}

/** Same node, ignoring `srcIndex` (load bookkeeping: a reloaded document numbers its blocks afresh, a live one doesn't). */
function sameIgnoringSrc(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type || a.text !== b.text || !Mark.sameSet(a.marks, b.marks) || a.childCount !== b.childCount) return false
  const keys = new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])
  for (const k of keys) if (k !== 'srcIndex' && JSON.stringify(a.attrs[k]) !== JSON.stringify(b.attrs[k])) return false
  for (let i = 0; i < a.childCount; i++) if (!sameIgnoringSrc(a.child(i), b.child(i))) return false
  return true
}

const isEmptyParagraph = (n: PMNode) => n.type.name === 'paragraph' && n.content.size === 0

/**
 * D-689: `sel` (in `before`) carried over to `after`, which a conversion made from `before` by replacing some top-level
 * blocks and reloading the rest. The blocks are aligned from both ends, ignoring `srcIndex`; an empty paragraph of
 * `before` with no counterpart was dropped by the reload (it is never written, #64) and maps to where it was. A position
 * in an aligned block keeps its offset in it; a text selection with an end in a dropped paragraph becomes a caret in the
 * nearest text block (after that place first), never a selected block: the next keystroke would replace it. A node
 * selection is kept inside its aligned block. Null when the selection touches the replaced blocks or is not a text or
 * node selection (the caller then selects the embed).
 */
function keptSelection(before: PMNode, after: PMNode, sel: Selection): Selection | null {
  const nb = before.childCount
  const na = after.childCount
  // For each block of `before`: its block in `after`, or { at } (dropped: the index in `after` it stood before).
  const to: (number | { at: number } | undefined)[] = new Array(nb)
  let i = 0
  let j = 0
  for (; i < nb && j < na; i++) {
    if (sameIgnoringSrc(before.child(i), after.child(j))) to[i] = j++
    else if (isEmptyParagraph(before.child(i))) to[i] = { at: j }
    else break
  }
  for (let a = nb - 1, b = na - 1; a >= i; a--) {
    if (b >= j && sameIgnoringSrc(before.child(a), after.child(b))) to[a] = b--
    else if (isEmptyParagraph(before.child(a))) to[a] = { at: b + 1 }
    else break
  }
  const starts = (doc: PMNode) => { const s = [0]; doc.forEach((c) => s.push(s[s.length - 1] + c.nodeSize)); return s }
  const sa = starts(before)
  const sb = starts(after)
  // The block of `before` holding `p` (a position between blocks belongs to the one after it).
  const blockOf = (p: number) => { let k = 0; while (k < nb - 1 && sa[k + 1] <= p) k++; return k }
  const map = (p: number): { pos: number; exact: boolean } | null => {
    const k = blockOf(p)
    const t = to[k]
    if (t === undefined) return null
    return typeof t === 'number' ? { pos: sb[t] + (p - sa[k]), exact: true } : { pos: sb[t.at], exact: false }
  }
  if (sel instanceof NodeSelection) {
    const k = blockOf(sel.from)
    const t = to[k]
    return typeof t === 'number' && sel.to <= sa[k + 1] ? NodeSelection.create(after, sb[t] + (sel.from - sa[k])) : null
  }
  if (!(sel instanceof TextSelection)) return null
  const x = map(sel.anchor)
  const y = map(sel.head)
  if (!x || !y) return null
  if (x.exact && y.exact) return TextSelection.create(after, x.pos, y.pos)
  const $p = after.resolve(Math.min(y.pos, after.content.size))
  return Selection.findFrom($p, 1, true) ?? Selection.findFrom($p, -1, true)
}

function endOf(doc: PMNode, k: number): number {
  const pos = blockPos(doc, k) + doc.child(k).nodeSize
  return TextSelection.near(doc.resolve(Math.max(pos - 1, 0)), -1).from
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i

/** Markdown text → editor blocks, through the real @tegg/doc parser and the load path's lossless check, so a pasted
 *  block the editor can't write back is kept as a source block (FR-EDT-14 AC-1, ADR 0002). */
function markdownToNodes(md: string, schema: import('@tiptap/pm/model').Schema): PMNode[] {
  const loaded = loadDoc(md.replace(/\r\n?/g, '\n').normalize('NFC'), schema)
  if (!loaded.doc.blocks.length) return []
  return (loaded.json.content ?? []).map((json, i) => {
    const raw = () => schema.nodes.rawBlock.create({ source: loaded.doc.blocks[i].raw, kind: 'raw' })
    try {
      const { srcIndex: _s, ...attrs } = json.attrs ?? {}
      const n = schema.nodeFromJSON({ ...json, attrs })
      n.check()
      // The table plugin would add cells to a ragged table after insertion (normalization guard, FR-EDT-01 AC-2).
      if (n.type.name === 'table') {
        const widths = new Set<number>()
        n.forEach((row) => widths.add(row.childCount))
        if (widths.size > 1) return raw()
      }
      return n
    } catch {
      return raw()
    }
  })
}

/** Two adjacent top-level lists of one kind are one list in Markdown; after a paste, join them so the editor shows
 *  what the file will mean (otherwise ordered lists may have no marker left to keep them apart, D-67). */
function joinAdjacentLists(tr: Transaction): void {
  for (let again = true; again; ) {
    again = false
    let pos = 0
    for (let i = 0; i + 1 < tr.doc.childCount; i++) {
      const a = tr.doc.child(i)
      const b = tr.doc.child(i + 1)
      pos += a.nodeSize
      if (/List$/.test(a.type.name) && a.type === b.type && (a.attrs.srcIndex === null || b.attrs.srcIndex === null)) {
        tr.join(pos)
        again = true
        break
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ createEditor

/** Everything before the body (BOM and frontmatter). */
const headOf = (text: string): string => text.slice(0, parse(text).bodyStart)

export function createEditor(opts: EditorOptions): TeggEditor {
  if (typeof opts.section === 'string') return createSectionEditor(opts, opts.section)
  return createNoteEditor(opts)
}

/** 4F (D-421, D-422; ms4-embeds §7): an editor on one `#Heading` section of a file. It edits the file's frontmatter
 *  plus the section text with the note editor's own save path (source-preserving, D-54, D-55), and splices the result
 *  back between the untouched text before and after the section. */
function createSectionEditor(opts: EditorOptions, heading: string): TeggEditor {
  let full = opts.text
  const view = (text: string): { inner: string; before: string; after: string } => {
    const head = headOf(text)
    const s = embedSection(text, heading)
    const [from, to] = s.kind === 'heading' ? [s.from, s.to] : [head.length, text.length]
    return { inner: head + text.slice(from, to), before: text.slice(head.length, from), after: text.slice(to) }
  }
  let parts = view(full)
  const ed = createNoteEditor({ ...opts, section: null, text: parts.inner })
  const outer = (inner: string): string => {
    const head = headOf(inner)
    return head + parts.before + inner.slice(head.length) + parts.after
  }
  let lastInner: string | null = null
  return {
    ...ed,
    async save() {
      const out = await ed.save()
      lastInner = out
      return out === null ? null : outer(out)
    },
    text: () => outer(ed.text()),
    markSaved(text) {
      full = text
      const next = view(full)
      const computed = lastInner
      parts = next
      lastInner = null
      // A heading typed into the section ends it (D-422): the editor then shows the shorter section.
      if (computed !== null && computed !== next.inner) ed.reload(next.inner)
      else ed.markSaved(next.inner)
    },
    reload(text) {
      full = text
      parts = view(full)
      ed.reload(parts.inner)
    },
  }
}

function createNoteEditor(opts: EditorOptions): TeggEditor {
  if (faults().editorLoad) throw new Error('editor load failed (test fault, NFR-REL-03 AC-8)')
  let dirty = false
  let loading = false
  let pendingTitle: string | null = null
  let loaded: Loaded
  let lastSaved = opts.text
  // 4F: while a text is loaded the views are built twice (attach, then the fresh state); embeds mount only on the
  // second build, so the app's embed (and its nested editor) is created once per block.
  const ui: EditorUi | undefined = opts.ui && {
    ...opts.ui,
    ...(opts.emptyHint !== undefined ? { hint: opts.emptyHint } : {}),
    embed: opts.ui.embed && ((source, dom, getPos) => (loading ? PENDING_EMBED : opts.ui!.embed!(source, dom, getPos))),
    // Slice MM: the map is drawn once the document is loaded (the load's own node views are replaced right after).
    mindmap: opts.ui.mindmap && ((dom, ctl) => (loading ? null : opts.ui!.mindmap!(dom, ctl))),
    media: opts.ui.media && ((source, dom, getPos) => (loading ? PENDING_EMBED : opts.ui!.media!(source, dom, getPos))),
  }

  const editor = new Editor({
    element: opts.element ?? document.createElement('div'),
    extensions: teggExtensions([embedKeys(() => api), MindmapKeys, TeggRules, BlockSelection, ...(ui ? [presentation(ui)] : []), ...(opts.emptyHint !== undefined && !ui ? [emptyHint(opts.emptyHint)] : []), ...(opts.extensions ?? [])]),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: opts.editable ?? true,
    enableInputRules: false,
    enablePasteRules: false,
    injectCSS: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label ?? 'Note body', spellcheck: 'true' },
      handlePaste: (view, event) => {
        if (inEmbedDom(view)) return true // 4F: a read-only embed's content takes no input (FR-EMB-03 AC-11)
        const dt = event.clipboardData
        if (!dt) return false
        const files = [...(dt.files ?? [])]
        const hasImage = files.some((f) => f.type.startsWith('image/')) || [...(dt.items ?? [])].some((i) => i.kind === 'file' && i.type.startsWith('image/'))
        const html = dt.getData('text/html')
        const plain = dt.getData('text/plain')
        if (inSourceBlock(view.state)) return true
        // 6A (FR-ATT-01 AC-1): files on the clipboard are added as media; an image wins over text (D-186 changed).
        if (files.length > 0 && opts.ui?.onFiles?.(files, view.state.selection.from)) return true
        if (hasImage && !plain && !html) {
          opts.onImagePaste?.()
          return true
        }
        if (plainNext) {
          plainNext = false
          return commands.pasteText(plain, true) || true
        }
        // Our own copies carry the Markdown source as text/plain; HTML from elsewhere is converted (FR-EDT-14 AC-3).
        if (html && !html.includes('data-tegg-copy')) return commands.pasteHtml(html) || true
        if (plain) return commands.pasteText(plain) || true
        return false
      },
      handleTextInput: (view) => inSourceBlock(view.state) || inEmbedDom(view),
      // 4F (AP-349): a click on a block embed's frame (outside its controls and content) selects it as a block.
      handleClickOn: (view, _pos, node, nodePos, event, direct) => {
        const el = event.target as HTMLElement | null
        // D-606: a click on a read-only table (outside its links) selects it as a block, as a source block is.
        if (direct && node.type.name === 'rawBlock' && el?.closest?.('[data-table-readonly]') && !el.closest('a, [role="link"]')) {
          view.dispatch(view.state.tr.setMeta(blockSelKey, { anchor: view.state.doc.resolve(nodePos).index(0), head: view.state.doc.resolve(nodePos).index(0) }))
          return true
        }
        if (!direct || node.type.name !== 'rawBlock' || node.attrs.kind !== 'embed' || !opts.onEmbedKey) return false
        if (el?.closest?.('[data-embed-body], button, a, [role="menu"], [role="link"]')) return false
        const k = view.state.doc.resolve(nodePos).index(0)
        view.dispatch(view.state.tr.setMeta(blockSelKey, { anchor: k, head: k }))
        return true
      },
      // 4F (FR-EMB-03 AC-11): with the DOM selection inside an embed's own content (a read-only embed, or another
      // editor's), keys that would edit this document do nothing here.
      handleKeyDown: (view, event) => !formField(event) && inEmbedDom(view) && (event.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key)) && !event.metaKey && !event.ctrlKey,
      handleDOMEvents: {
        copy: (_v, event) => copyBlocks(event, false),
        cut: (v, event) => (inEmbedDom(v) ? (event.preventDefault(), true) : copyBlocks(event, true)),
        // A form field inside an embed (the Task card's date field, 5A-2) types normally.
        beforeinput: (v, event) => (formField(event) ? true : inEmbedDom(v) ? (event.preventDefault(), true) : false),
      },
    },
    onTransaction: ({ transaction }) => {
      followConversions(transaction)
      if (transaction.docChanged && !loading && !transaction.getMeta('teggLoad')) {
        dirty = true
        opts.onChange?.(true)
      }
      if (transaction.selectionSet && !transaction.docChanged) opts.onSelection?.()
      opts.onUpdate?.()
    },
  })
  // Slice MM2 (D-794): a link chip counts as its label in `textContent` (ProseMirror's `leafText`), so the caret
  // helpers that read an item's text see `Lisabon` for `[[Lisabon]]`. TipTap's node config has no `leafText`.
  editor.schema.nodes.wikiLink.spec.leafText = (n) => wikiLabel(String(n.attrs.value), !!n.attrs.embed)
  let plainNext = false
  const view = editor.view
  // 4F (FR-EMB-01 AC-9, D-419): a top-level paragraph that becomes a sole note embed is a block embed.
  editor.registerPlugin(new Plugin({
    appendTransaction: (trs, _old, state) => {
      if (loading || !trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('teggLoad'))) return null
      let tr: Transaction | null = null
      let pos = 0
      state.doc.forEach((n) => {
        const only = n.type.name === 'paragraph' && n.childCount === 1 ? n.firstChild! : null
        if (only && only.type.name === 'wikiLink' && only.attrs.embed && !only.marks.length) {
          tr ??= state.tr
          const at = tr.mapping.map(pos)
          const embed = state.schema.nodes.rawBlock.create({ source: `![[${String(only.attrs.value)}]]`, kind: 'embed' })
          tr.replaceWith(at, at + n.nodeSize, embed)
          const after = at + embed.nodeSize
          // Typing goes on below the embed: at the end of the note in a new empty paragraph (never written).
          if (after >= tr.doc.content.size) tr.insert(after, state.schema.nodes.paragraph.create())
          tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
        }
        pos += n.nodeSize
      })
      return tr
    },
  }))
  const tracked = new Set<{ pos: number | null }>()
  editor.registerPlugin(new Plugin({
    state: {
      init: () => null,
      apply: (tr: Transaction) => {
        if (tr.docChanged) for (const t of tracked) {
          if (t.pos === null) continue
          const r = tr.mapping.mapResult(t.pos, 1)
          t.pos = r.deletedAfter ? null : r.pos
        }
        return null
      },
    },
  }))

  // 5A-2 (D-492, D-496): a conversion's redo waits for the app (it recreates the file first); user actions that remove
  // block embeds wait for the app's removal guard.
  let conversions: Conversion[] = []
  let allowRedo: Conversion | null = null
  editor.registerPlugin(new Plugin({
    filterTransaction: (tr, state) => {
      if (loading || tr.getMeta('teggLoad')) return true
      const h = tr.getMeta(HISTORY) as { redo: boolean } | undefined
      if (h?.redo && opts.conversion) {
        const c = conversions.find((x) => x.state === 'undone' && x.before.content.eq(state.doc.content) && x.after.content.eq(tr.doc.content))
        if (c && c.record) {
          if (allowRedo === c) { allowRedo = null; return true }
          if (!c.pending) {
            c.pending = true
            void opts.conversion.beforeRedo(c.record!).then((target) => {
              c.pending = false
              if (target === false || !editor.state.doc.content.eq(c.before.content)) return
              allowRedo = c
              editor.commands.redo()
              if (target !== c.target) retarget(c, target)
            }, () => { c.pending = false })
          }
          return false
        }
      }
      if (h || !tr.docChanged || !opts.guardEmbedRemoval || tr.getMeta('teggConvert') || tr.getMeta('teggGuardOk') || tr.getMeta('teggEmbedMode')) return true
      const removed = removedEmbeds(state.doc, tr)
      if (!removed.length) return true
      const ask = opts.guardEmbedRemoval(removed)
      if (!ask) return true
      void ask.then((ok) => {
        if (ok && editor.state.doc.eq(tr.before)) view.dispatch(tr.setMeta('teggGuardOk', true))
      }, () => {})
      return false
    },
  }))

  /** Undo / redo of a conversion step switches the source model, so unchanged blocks keep their bytes (D-492). */
  function followConversions(tr: Transaction) {
    const h = tr.getMeta(HISTORY) as { redo: boolean } | undefined
    if (!h || !conversions.length) return
    const doc = editor.state.doc
    if (!h.redo) {
      const c = conversions.find((x) => x.state === 'done' && x.before.content.eq(doc.content))
      if (!c) return
      c.state = 'undone'
      loaded = c.loadedBefore
      if (c.record) opts.conversion?.afterUndo(c.record)
    } else {
      const c = conversions.find((x) => x.state === 'undone' && x.after.content.eq(doc.content))
      if (!c) return
      c.state = 'done'
      loaded = c.loadedAfter
    }
  }

  /** FR-CNV-06 AC-2: after a redo, the embed names the file the app actually recreated (outside the history). */
  function retarget(c: Conversion, target: string) {
    const from = `![[${c.target}]]`
    const value = target.normalize('NFC')
    const tr = editor.state.tr
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'rawBlock' && n.attrs.kind === 'embed' && n.attrs.source === from) tr.setNodeMarkup(pos, undefined, { ...n.attrs, source: `![[${value}]]` })
      else if (n.type.name === 'wikiLink' && n.attrs.embed && n.attrs.value === c.target) tr.setNodeMarkup(pos, undefined, { ...n.attrs, value })
      return true
    })
    if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false).setMeta('teggConvert', true))
  }

  /** D-496: the top-level block embeds `tr` deletes that don't reappear elsewhere (a move keeps them). */
  function removedEmbeds(doc: PMNode, tr: Transaction): { pos: number; source: string }[] {
    const left = new Map<string, number>()
    tr.doc.forEach((n) => {
      if (n.type.name === 'rawBlock' && n.attrs.kind === 'embed') left.set(String(n.attrs.source), (left.get(String(n.attrs.source)) ?? 0) + 1)
    })
    const out: { pos: number; source: string }[] = []
    let pos = 0
    doc.forEach((n) => {
      if (n.type.name === 'rawBlock' && n.attrs.kind === 'embed') {
        const source = String(n.attrs.source)
        const r = tr.mapping.mapResult(pos, 1)
        const kept = left.get(source) ?? 0
        if (r.deletedAfter && kept === 0) out.push({ pos, source })
        else if (kept > 0) left.set(source, kept - 1)
      }
      pos += n.nodeSize
    })
    return out
  }

  /** The parsed block behind each top-level node of the current text (null for nodes a save skips: empty lines). */
  function sourceBlocks(text: string): { doc: Doc; at: (Doc['blocks'][number] | null)[] } {
    const d = parse(text)
    const at: (Doc['blocks'][number] | null)[] = []
    let j = 0
    editor.state.doc.forEach((n) => {
      if (n.type.name === 'paragraph' && n.textContent.trim() === '' && !hasInline(n)) { at.push(null); return }
      while (j < d.blocks.length && d.blocks[j].raw === END_LIST && !(n.type.name === 'rawBlock' && n.attrs.source === END_LIST)) j++
      at.push(d.blocks[j++] ?? null)
    })
    return { doc: d, at }
  }

  /** The text offset of a document position: a list item's start inside lists, else its block's start. */
  function offsetAt(map: ReturnType<typeof sourceBlocks>, pos: number): number | null {
    const $p = editor.state.doc.resolve(pos)
    const k = $p.depth === 0 ? Math.min($p.index(0), editor.state.doc.childCount - 1) : $p.index(0)
    const b = map.at[k]
    if (!b) return null
    if (b.node.type !== 'list' || $p.depth < 2) return b.range[0]
    let md: List | ListItem = b.node as List
    let item: ListItem | null = null
    for (let d = 2; d <= $p.depth; d++) {
      const child = (md.children as unknown[])[$p.index(d - 1)] as List | ListItem | undefined
      const n = $p.node(d)
      if (!child) break
      if (n.type.name === 'listItem' && child.type === 'listItem') { item = child; md = child }
      else if (/List$/.test(n.type.name) && child.type === 'list') md = child
      else break
    }
    return item ? item.position!.start.offset! : b.range[0]
  }

  /** §11.3: the unit the caret, text selection or block selection converts (R51, D-490, D-493, D-494). */
  function conversionUnit(): ConvertUnit | null {
    if (opts.convertible === false || !editor.isEditable || inEmbedDom(view)) return null
    let text: string
    try { text = candidate() } catch { return null }
    const map = sourceBlocks(text)
    const s = blockSel()
    let from: number | null
    let to: number | null
    if (s) {
      const a = Math.min(s.anchor, s.head)
      const b = Math.max(s.anchor, s.head)
      const hit = map.at.slice(a, b + 1).filter((x) => x !== null)
      if (!hit.length) return null
      from = hit[0]!.range[0]
      to = hit[hit.length - 1]!.range[1]
    } else {
      from = offsetAt(map, editor.state.selection.from)
      to = offsetAt(map, editor.state.selection.to)
    }
    if (from === null || to === null) return null
    return unitOf(text, from, to)
  }

  function copyBlocks(event: ClipboardEvent, cut: boolean): boolean {
    const src = selectedSource()
    if (src === null || !event.clipboardData) return false
    const s = blockSel()!
    const from = Math.min(s.anchor, s.head)
    const to = Math.max(s.anchor, s.head)
    const start = blockPos(editor.state.doc, from)
    const end = blockPos(editor.state.doc, to) + editor.state.doc.child(to).nodeSize
    const html = editor.view.serializeForClipboard(editor.state.doc.slice(start, end)).dom.innerHTML
    event.clipboardData.setData('text/plain', src)
    event.clipboardData.setData('text/html', `<div data-tegg-copy="">${html}</div>`)
    event.preventDefault()
    if (cut) commands.deleteBlocks()
    return true
  }

  function inSourceBlock(state: EditorState): boolean {
    const sel = state.selection
    if (sel instanceof NodeSelection && sel.node.type.name === 'rawBlock') return true
    return false
  }

  /** Loads `text` into the editor with an empty history. */
  function load(text: string) {
    loading = true
    loaded = loadDoc(text, editor.schema)
    try { attach(editor, loaded) } finally { loading = false }
    conversions = [] // D-178: the history starts empty, and with it every conversion step
    // A fresh state: the load is never an undo step and the history starts empty (AP-122, D-178).
    const d = editor.state.doc
    const withHead = d.type.create({ ...d.attrs, frontmatter: headOf(text) }, d.content, d.marks)
    const fresh = EditorState.create({ doc: withHead, plugins: editor.state.plugins, selection: TextSelection.atStart(withHead) })
    view.updateState(fresh)
    dirty = false
  }
  load(opts.text)
  // Slice MM: the caret going into the text forgets the map that last had the focus (FR-UX-03 AC-15: the palette's
  // mindmap commands act on a focused map, or on the mindmap holding the caret, and nowhere else).
  view.dom.addEventListener('focusin', (e) => { if (!(e.target as Element | null)?.closest?.('[data-map-area]')) focusedMindmap.delete(view) })

  /** The frontmatter text in effect: the doc attribute (panel edits, §14.6), else the last saved text's. */
  function head(): string {
    const h = editor.state.doc.attrs.frontmatter as string | null
    return h ?? headOf(lastSaved)
  }

  function candidate(): string {
    const r = reconcile(loaded, editor.state.doc)
    const bodyStart = loaded.doc.bodyStart
    const body = r.text.slice(bodyStart)
    const h = head()
    const base = parse(h)
    let out = h + body
    if (!base.frontmatter && loaded.doc.frontmatter) out = r.text // never drop a frontmatter the file had
    if (pendingTitle !== null) {
      const cur = parse(out).frontmatter?.data?.title
      if (cur !== pendingTitle) out = setAttribute(parse(out), 'title', pendingTitle)
    }
    return out
  }

  /** The last compute's result and the frontmatter attribute it used (markSaved syncs the attribute, §14.6). */
  let computed: { out: string; head: unknown } | null = null

  function compute(): string | null {
    const next = candidate()
    if (next === lastSaved) return null
    computed = null
    // Invalid frontmatter is never rewritten automatically (NFR-REL-03); such notes open read-only in the app.
    if (parse(next).frontmatter?.error || parse(lastSaved).frontmatter?.error) return next
    const withId = ensureIdentity(parse(next), { now: opts.now(), newId: opts.newId })
    const out = touchModified(lastSaved, withId, opts.now())
    computed = { out, head: editor.state.doc.attrs.frontmatter }
    return out
  }

  /** Sets the frontmatter attribute outside the history (load bookkeeping, never an undo step or a change). */
  function syncHead(text: string) {
    const h = headOf(text)
    if (editor.state.doc.attrs.frontmatter === h) return
    view.dispatch(editor.state.tr.setDocAttribute('frontmatter', h).setMeta('addToHistory', false).setMeta('teggLoad', true))
  }

  const dispatch = (tr: Transaction) => view.dispatch(tr)

  /** Source of the block selection: unchanged blocks as written in the file, others rendered (FR-EDT-13 AC-5). */
  function selectedSource(): string | null {
    const s = blockSel()
    if (!s) return null
    const from = Math.min(s.anchor, s.head)
    const to = Math.max(s.anchor, s.head)
    const out: string[] = []
    for (let k = from; k <= to; k++) {
      const n = editor.state.doc.child(k)
      const i = n.attrs.srcIndex as number | null
      if (i !== null && loaded.originals[i] && n.eq(loaded.originals[i]!)) out.push(loaded.doc.blocks[i].raw.replace(/\r\n/g, '\n'))
      else if (n.type.name === 'rawBlock') out.push(String(n.attrs.source))
      else out.push(renderBlock(pmToBlock(n.toJSON())))
    }
    return out.join('\n\n')
  }
  const blockSel = (): BlockSel => blockSelKey.getState(editor.state) ?? null
  /** The top-level blocks a block command acts on: the block selection, else the caret's block. */
  const targetRange = (): [number, number] => {
    const s = blockSel()
    if (s) return [Math.min(s.anchor, s.head), Math.max(s.anchor, s.head)]
    const k = topIndex(editor.state)
    return [k, k]
  }

  // ---------------------------------------------------------------------------------------------- slice MM

  const isMindmap = (n: PMNode | null | undefined) => !!n && n.type.name === 'callout' && String(n.attrs.calloutType).toLowerCase() === 'mindmap'
  /** mm-mindmap §1.3, §3.2: replace top-level blocks `from…to` with Markdown made by @tegg/doc, as one undo step whose
   *  source model is the result, so every byte the step didn't make is written back unchanged (as a conversion, D-492). */
  function sourceStep(from: number, to: number, make: (raws: string[], gaps: string[]) => string, caret?: (doc: PMNode) => number | null): boolean {
    let text: string
    try { text = candidate() } catch { return false }
    const map = sourceBlocks(text)
    const hit = map.at.slice(from, to + 1)
    if (hit.some((b) => b === null)) return false
    const bs = hit as Doc['blocks']
    const gaps = bs.slice(1).map((b, i) => text.slice(bs[i].range[1], b.range[0]))
    const next = text.slice(0, bs[0].range[0]) + make(bs.map((b) => b.raw), gaps) + text.slice(bs[bs.length - 1].range[1])
    const loadedNext = loadDoc(next, editor.schema)
    const content = editor.schema.nodeFromJSON(loadedNext.json).content
    const before = editor.state.doc
    const tr = closeHistory(editor.state.tr).replaceWith(0, before.content.size, content)
    const at = caret?.(tr.doc) ?? null
    tr.setSelection(at === null ? TextSelection.near(tr.doc.resolve(Math.min(blockPos(tr.doc, Math.min(from, tr.doc.childCount - 1)) + 1, tr.doc.content.size))) : TextSelection.near(tr.doc.resolve(at)))
    const loadedBefore = loaded
    loaded = loadedNext
    conversions = conversions.filter((c) => c.state === 'done')
    conversions.push({ record: null, target: '', before, after: tr.doc, loadedBefore, loadedAfter: loadedNext, state: 'done', pending: false })
    dispatch(tr.setMeta('teggConvert', true).scrollIntoView())
    dispatch(closeHistory(editor.state.tr))
    return true
  }
  /** D-768: `Mindmap` in `Turn into` for one list, one paragraph or heading, or a selection of only those text blocks. */
  function mindmapOffer(): 'yes' | 'disabled' | 'no' {
    const s = blockSel()
    const doc = editor.state.doc
    const [a, b] = s ? [Math.min(s.anchor, s.head), Math.max(s.anchor, s.head)] : [topIndex(editor.state), topIndex(editor.state)]
    const kinds = []
    for (let k = a; k <= b; k++) kinds.push(doc.child(k).type.name)
    const text = (t: string) => t === 'paragraph' || t === 'heading'
    const list = (t: string) => t === 'bulletList' || t === 'orderedList'
    if (kinds.length === 1) return text(kinds[0]) || list(kinds[0]) ? 'yes' : 'no'
    if (kinds.every(text)) return 'yes'
    if (kinds.every((t) => text(t) || list(t))) return 'disabled'
    return 'no'
  }

  const commands: TeggEditor['commands'] = {
    turnInto(kind, o = {}) {
      const [from, to] = targetRange()
      const doc = editor.state.doc
      for (let k = from; k <= to; k++) if (doc.child(k).type.name === 'rawBlock') return false
      const node = doc.child(from)
      // Slice MM (D-767): wrap in a mindmap, or unwrap one, at the source level so the list keeps its bytes.
      if (kind === 'mindmap') {
        if (mindmapOffer() !== 'yes') return false
        return sourceStep(from, to, (raws, gaps) => wrapMindmap(raws, gaps), (d) => startOf(d, from))
      }
      if (from === to && isMindmap(node) && (kind === 'bulletList' || kind === 'orderedList' || kind === 'checklist')) {
        return sourceStep(from, from, ([raw]) => unwrapMindmap(raw, kind))
      }
      const start = blockPos(doc, from)
      const end = blockPos(doc, to) + doc.child(to).nodeSize
      const textSel = () => editor.chain().setTextSelection({ from: startOf(doc, from), to: endOf(doc, to) })
      if (kind === 'callout') {
        if (from === to && node.type.name === 'callout') {
          if (!o.calloutType) return false
          if (String(node.attrs.calloutType).toLowerCase() === o.calloutType) return false
          // D-767 (W7, W10): to or from `mindmap` only the type in the title line changes.
          if (isMindmap(node) || o.calloutType === 'mindmap') {
            const type = o.calloutType
            return sourceStep(from, from, ([raw]) => { const h = calloutHead(raw); return h ? raw.replace(/\[!([^\]|\s]+)((?:\|[^\]]*)?)\]/, (_m, _t: string, meta: string) => `[!${type}${meta}]`) : raw })
          }
          dispatch(editor.state.tr.setNodeMarkup(start, undefined, { ...node.attrs, calloutType: o.calloutType }))
          return true
        }
        if (from !== to || !node.isTextblock) return false
        const s = editor.schema
        const callout = s.nodes.callout.create({ calloutType: o.calloutType ?? 'note', fold: '', joined: false, srcIndex: node.attrs.srcIndex }, [s.nodes.calloutTitle.create(null, node.content)])
        const tr = editor.state.tr.replaceWith(start, end, callout)
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)))
        dispatch(tr)
        return true
      }
      // Lists and quotes of several blocks become one list / quote (FR-EDT-13 AC-4).
      const c = textSel()
      // The converted block keeps its source position, so the gaps around it keep their bytes (FR-EDT-01 AC-6).
      const src = node.attrs.srcIndex as number | null
      const keepSrc = (ok: boolean) => {
        if (!ok || src === null) return ok
        const st = editor.state
        if (from >= st.doc.childCount) return ok
        const n = st.doc.child(from)
        if (n.attrs.srcIndex === null && 'srcIndex' in n.attrs) {
          dispatch(st.tr.setNodeMarkup(blockPos(st.doc, from), undefined, { ...n.attrs, srcIndex: src }).setMeta('appendedTransaction', st.tr).setMeta('addToHistory', true))
        }
        return ok
      }
      switch (kind) {
        case 'paragraph': return keepSrc(c.setParagraph().run())
        case 'heading': return keepSrc(c.setHeading({ level: (o.level ?? 1) as 1 }).run())
        case 'bulletList': return node.type.name === 'bulletList' && from === to ? false : keepSrc(c.toggleBulletList().run())
        case 'orderedList': return keepSrc(c.toggleOrderedList().run())
        case 'checklist': {
          if (!c.toggleBulletList().run()) return false
          const tr = editor.state.tr
          const a = blockPos(editor.state.doc, from)
          const b = Math.min(editor.state.doc.content.size, a + editor.state.doc.child(Math.min(from, editor.state.doc.childCount - 1)).nodeSize)
          editor.state.doc.nodesBetween(a, b, (n, p) => {
            if (n.type.name === 'listItem' && n.attrs.checked === null) tr.setNodeMarkup(p, undefined, { ...n.attrs, checked: false })
            return true
          })
          if (tr.docChanged) dispatch(tr.setMeta('addToHistory', true))
          return true
        }
        case 'blockquote': return keepSrc(c.toggleBlockquote().run())
        case 'codeBlock': return keepSrc(c.setCodeBlock().run())
        default: return false
      }
    },
    toggleMark(mark) {
      if (editor.state.selection.$from.parent.type.spec.code) return false
      return editor.commands.toggleMark(mark)
    },
    moveBlock(dir) {
      const [from, to] = targetRange()
      const doc = editor.state.doc
      if (dir === 'up' ? from === 0 : to === doc.childCount - 1) return false
      const sel = blockSel()
      const start = blockPos(doc, from)
      const end = blockPos(doc, to) + doc.child(to).nodeSize
      const slice = doc.slice(start, end)
      const tr = editor.state.tr
      const relSel = editor.state.selection.from - start
      if (dir === 'down') {
        const after = end + doc.child(to + 1).nodeSize
        tr.insert(after, slice.content)
        tr.delete(start, end)
      } else {
        const before = start - doc.child(from - 1).nodeSize
        tr.delete(start, end)
        tr.insert(before, slice.content)
      }
      const nf = dir === 'down' ? from + 1 : from - 1
      const newStart = blockPos(tr.doc, nf)
      if (sel) tr.setMeta(blockSelKey, { anchor: sel.anchor + (nf - from), head: sel.head + (nf - from) })
      else tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(newStart + Math.max(relSel, 0), tr.doc.content.size))))
      dispatch(tr.scrollIntoView())
      return true
    },
    duplicateBlock() {
      const [from, to] = targetRange()
      const doc = editor.state.doc
      const start = blockPos(doc, from)
      const end = blockPos(doc, to) + doc.child(to).nodeSize
      const tr = editor.state.tr.insert(end, doc.slice(start, end).content)
      dispatch(tr.scrollIntoView())
      return true
    },
    deleteBlocks() {
      const [from, to] = targetRange()
      const doc = editor.state.doc
      const start = blockPos(doc, from)
      const end = blockPos(doc, to) + doc.child(to).nodeSize
      const tr = editor.state.tr
      if (from === 0 && to === doc.childCount - 1) tr.replaceWith(start, end, editor.schema.nodes.paragraph.create())
      else tr.delete(start, end)
      const k = Math.min(from, tr.doc.childCount - 1)
      const target = from > 0 ? endOf(tr.doc, from - 1) : startOf(tr.doc, k)
      tr.setSelection(TextSelection.near(tr.doc.resolve(target)))
      tr.setMeta(blockSelKey, null)
      dispatch(tr.scrollIntoView())
      return true
    },
    selectBlock() {
      const k = topIndex(editor.state)
      dispatch(editor.state.tr.setMeta(blockSelKey, { anchor: k, head: k }))
      return true
    },
    extendBlockSelection(dir) {
      const s = blockSel() ?? { anchor: topIndex(editor.state), head: topIndex(editor.state) }
      const head = Math.max(0, Math.min(editor.state.doc.childCount - 1, s.head + (dir === 'down' ? 1 : -1)))
      dispatch(editor.state.tr.setMeta(blockSelKey, { anchor: s.anchor, head }))
      return true
    },
    selectBlockRange(from, to) {
      dispatch(editor.state.tr.setMeta(blockSelKey, { anchor: from, head: to }))
      return true
    },
    toggleChecklist() {
      const { $from } = editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d)
        if (n.type.name === 'listItem' && n.attrs.checked !== null) {
          dispatch(editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, checked: !n.attrs.checked }))
          return true
        }
      }
      return false
    },
    insertLink(target) {
      const { from, to, empty } = editor.state.selection
      if (editor.state.selection.$from.parent.type.spec.code) return false
      let value = linkText(target)
      if (!empty) {
        const sel = editor.state.doc.textBetween(from, to, ' ').normalize('NFC')
        const t = value.split('|')[0]
        const shown = value.includes('|') ? value.slice(value.indexOf('|') + 1) : t
        if (sel && sel !== shown) value = `${t}|${sel}`
        else if (sel === shown) value = t === shown ? t : `${t}|${shown}`
      }
      const node = editor.schema.nodes.wikiLink.create({ value, embed: false })
      const tr = editor.state.tr.replaceWith(from, to, node)
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + node.nodeSize)))
      dispatch(tr.scrollIntoView())
      return true
    },
    replaceLink(pos, text) {
      const node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'wikiLink') return false
      const value = text.replace(/^\[\[|\]\]$/g, '').normalize('NFC')
      const next = editor.schema.nodes.wikiLink.create({ value, embed: !!node.attrs.embed })
      dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, next))
      return true
    },
    insertTag(spelling) {
      const { from, to, $from } = editor.state.selection
      if ($from.parent.type.spec.code) return false
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, '￼')
      const pad = before && !/[\s(]/.test(before) ? ' ' : ''
      const value = spelling.replace(/^#/, '').normalize('NFC')
      const nodes = [...(pad ? [editor.schema.text(pad)] : []), editor.schema.nodes.tag.create({ value })]
      const tr = editor.state.tr.replaceWith(from, to, nodes)
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + pad.length + 1)))
      dispatch(tr.scrollIntoView())
      return true
    },
    setUrlLink(href) {
      if (!SAFE_URL.test(href.trim())) return false
      const { empty } = editor.state.selection
      if (empty) return false
      return editor.chain().setMark('link', { href: href.trim() }).run()
    },
    removeLink() {
      const state = editor.state
      const { $from, empty } = state.selection
      // A wikilink chip before or at the caret becomes its shown text.
      const sel = state.selection
      let chipPos: number | null = null
      let chip: PMNode | null = null
      if (sel instanceof NodeSelection && sel.node.type.name === 'wikiLink') { chipPos = sel.from; chip = sel.node }
      else if (empty) {
        const before = $from.nodeBefore
        const after = $from.nodeAfter
        if (before?.type.name === 'wikiLink') { chip = before; chipPos = $from.pos - before.nodeSize }
        else if (after?.type.name === 'wikiLink') { chip = after; chipPos = $from.pos }
      }
      if (chip && chipPos !== null) {
        const v = String(chip.attrs.value)
        const pipe = /\\?\|/.exec(v)
        const shown = pipe ? v.slice(pipe.index + pipe[0].length) : v
        dispatch(state.tr.replaceWith(chipPos, chipPos + chip.nodeSize, state.schema.text(shown, chip.marks)))
        return true
      }
      if (editor.isActive('link')) return editor.chain().extendMarkRange('link').unsetMark('link').run()
      return false
    },
    pasteText(text, plain = false) {
      const state = editor.state
      if (inSourceBlock(state)) return false
      const norm = text.replace(/\r\n?/g, '\n').normalize('NFC')
      // Pasting over a block selection replaces those blocks (D-496: the removal guard sees the embeds it removes).
      const bs = blockSel()
      if (bs) {
        const a = Math.min(bs.anchor, bs.head)
        const b = Math.max(bs.anchor, bs.head)
        const nodes = plain
          ? norm.split('\n').map((l) => state.schema.nodes.paragraph.create(null, l ? state.schema.text(l) : null))
          : markdownToNodes(norm, state.schema)
        if (!nodes.length) return false
        const start = blockPos(state.doc, a)
        const tr = state.tr.replaceWith(start, blockPos(state.doc, b) + state.doc.child(b).nodeSize, nodes)
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + nodes.reduce((n, x) => n + x.nodeSize, 0)), -1)).setMeta(blockSelKey, null)
        if (plain) tr.setMeta('tagRules', true)
        joinAdjacentLists(tr)
        dispatch(tr.scrollIntoView())
        return true
      }
      const { $from, empty } = state.selection
      if ($from.parent.type.spec.code) {
        dispatch(state.tr.insertText(norm).scrollIntoView())
        return true
      }
      if (plain) {
        // Literal text: no tags or links are made from it (FR-EDT-14 AC-2); the save escapes what would be syntax.
        const lines = norm.split('\n')
        if (lines.length === 1) { dispatch(state.tr.insertText(norm).setMeta('tagRules', true).scrollIntoView()); return true }
        const nodes = lines.map((l) => state.schema.nodes.paragraph.create(null, l ? state.schema.text(l) : null))
        dispatch(state.tr.replaceSelection(new Slice(Fragment.from(nodes), 1, 1)).setMeta('tagRules', true).scrollIntoView())
        return true
      }
      // A URL pasted on a selection links it (FR-EDT-14 AC-4); other schemes stay literal text.
      const one = norm.trim()
      if (!empty && /^\S+$/.test(one) && /^[a-z][a-z0-9+.-]*:/i.test(one)) {
        if (SAFE_URL.test(one)) return editor.chain().setMark('link', { href: one }).run()
        dispatch(state.tr.insertText(one).scrollIntoView())
        return true
      }
      const nodes = markdownToNodes(norm, state.schema)
      if (!nodes.length) return false
      if (nodes.length === 1 && nodes[0].type.name === 'paragraph' && $from.parent.isTextblock) {
        // One paragraph: its inline content goes in at the caret (marks, links and tags kept).
        const lead = norm.match(/^[ \t]+/)?.[0] ?? ''
        const content = lead ? Fragment.from(state.schema.text(lead)).append(nodes[0].content) : nodes[0].content
        dispatch(state.tr.replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
        return true
      }
      // Slice MM (D-773): in a mindmap's List, lists, paragraphs and headings become items after the caret's item; in
      // Map nothing is pasted.
      const mm = mindmapItem(state)
      if (mm) {
        const dom = view.nodeDOM($from.before(mm.callout)) as HTMLElement | null
        if (dom && mindmapViews.get(dom)?.current() === 'map') return true
        if (nodes.every((n) => /List$/.test(n.type.name) || n.type.name === 'paragraph' || n.type.name === 'heading')) {
          const s = state.schema
          const items: PMNode[] = []
          for (const n of nodes) {
            if (/List$/.test(n.type.name)) n.forEach((li) => items.push(li))
            else items.push(s.nodes.listItem.create(null, s.nodes.paragraph.create(null, n.content)))
          }
          const at = $from.after(mm.item)
          const tr2 = state.tr.insert(at, items)
          const end = at + items.reduce((n, x) => n + x.nodeSize, 0)
          tr2.setSelection(TextSelection.near(tr2.doc.resolve(end - 1), -1))
          dispatch(tr2.scrollIntoView())
          return true
        }
      }
      const tr = state.tr
      const atEmpty = $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
      if (atEmpty) {
        const start = $from.before(1)
        tr.replaceWith(start, $from.after(1), nodes)
        const end = start + nodes.reduce((s, n) => s + n.nodeSize, 0)
        tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1))
      } else if ($from.depth > 1) {
        // Inside a list, quote, callout or table, pasted blocks go after that block: nesting other blocks into it
        // could give structures Markdown can't write back (ADR 0002 verification).
        const after = $from.after(1)
        tr.insert(after, nodes)
        const end = after + nodes.reduce((s, n) => s + n.nodeSize, 0)
        tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1))
      } else {
        tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0))
      }
      joinAdjacentLists(tr)
      dispatch(tr.scrollIntoView())
      return true
    },
    pasteHtml(html) {
      const md = htmlToMarkdown(html)
      if (!md.trim()) return false
      return commands.pasteText(md)
    },
    tableAction(a) {
      if (a === 'addRowBelow') return editor.commands.addRowAfter()
      if (a === 'deleteRow') return editor.commands.deleteRow()
      // Columns: keep the table's alignment list in step (a Markdown table has one alignment per column).
      const $f = editor.state.selection.$from
      let col = -1
      for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'tableRow') { col = $f.index(d); break }
      const ok = a === 'addColumnRight' ? editor.commands.addColumnAfter() : editor.commands.deleteColumn()
      if (!ok || col < 0) return ok
      const st = editor.state
      const k = topIndex(st)
      const table = st.doc.child(k)
      if (table.type.name !== 'table') return ok
      const align = Array.isArray(table.attrs.align) ? [...(table.attrs.align as (string | null)[])] : null
      if (!align) return ok
      if (a === 'addColumnRight') align.splice(col + 1, 0, null)
      else align.splice(col, 1)
      const tr = st.tr.setNodeMarkup(blockPos(st.doc, k), undefined, { ...table.attrs, align }).setMeta('appendedTransaction', st.tr)
      if (a === 'addColumnRight') {
        // The caret moves into the new column, like other table editors.
        const $c = tr.doc.resolve(tr.mapping.map(st.selection.from))
        for (let d = $c.depth; d > 0; d--) {
          if ($c.node(d).type.name !== 'tableRow') continue
          const row = $c.node(d)
          if (col + 1 < row.childCount) {
            let pos = $c.start(d)
            for (let i = 0; i <= col; i++) pos += row.child(i).nodeSize
            tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)))
          }
          break
        }
      }
      dispatch(tr)
      return ok
    },
    insertBlock(kind, o = {}) {
      const s = editor.schema
      const state = editor.state
      const k = topIndex(state)
      const cur = state.doc.child(k)
      const empty = cur.type.name === 'paragraph' && cur.content.size === 0
      const make = (): PMNode | PMNode[] | null => {
        switch (kind) {
          case 'paragraph': return s.nodes.paragraph.create()
          case 'heading': return s.nodes.heading.create({ level: o.level ?? 1 })
          case 'bulletList': return s.nodes.bulletList.create(null, s.nodes.listItem.create(null, s.nodes.paragraph.create()))
          case 'orderedList': return s.nodes.orderedList.create({ start: 1 }, s.nodes.listItem.create(null, s.nodes.paragraph.create()))
          case 'checklist': return s.nodes.bulletList.create(null, s.nodes.listItem.create({ checked: false }, s.nodes.paragraph.create()))
          case 'blockquote': return s.nodes.blockquote.create(null, s.nodes.paragraph.create())
          case 'callout': return s.nodes.callout.create({ calloutType: 'note', fold: '', joined: false }, s.nodes.calloutTitle.create())
          // Slice MM (W1, D-765): an empty mindmap with one empty item for the caret; it opens in List (D-776).
          case 'mindmap': return s.nodes.callout.create({ calloutType: 'mindmap', fold: '', joined: false }, [
            s.nodes.calloutTitle.create(), s.nodes.bulletList.create(null, s.nodes.listItem.create(null, s.nodes.paragraph.create()))])
          case 'codeBlock': return s.nodes.codeBlock.create()
          case 'divider': return [s.nodes.horizontalRule.create(), s.nodes.paragraph.create()]
          case 'table': {
            const cell = (h: boolean) => (h ? s.nodes.tableHeader : s.nodes.tableCell).create(null, s.nodes.paragraph.create())
            const row = (h: boolean) => s.nodes.tableRow.create(null, [cell(h), cell(h), cell(h)])
            return s.nodes.table.create({ align: [null, null, null] }, [row(true), row(false), row(false)])
          }
          default: return null
        }
      }
      const made = make()
      if (!made) return false
      const nodes = Array.isArray(made) ? made : [made]
      // Slice MM (FR-MMP-02 AC-22): a block typed in a mindmap's item nests in that item, after its text, so the
      // mindmap keeps one list; another mindmap goes after the mindmap (D-769).
      const mm = kind !== 'mindmap' && kind !== 'divider' ? mindmapItem(state) : null
      if (mm) {
        const $f = state.selection.$from
        const item = $f.node(mm.item)
        const idx = $f.index(mm.item - 1)
        const tr = state.tr
        let at: number
        if (item.childCount === 1 && item.child(0).content.size === 0 && idx > 0) {
          // An empty item (⏎ after `Porady`, then `/code`): the block goes into the item above, which it belongs to.
          tr.delete($f.before(mm.item), $f.after(mm.item))
          at = $f.before(mm.item) - 1
        } else at = $f.after(mm.item + 1)
        tr.insert(at, nodes)
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size))))
        dispatch(tr.scrollIntoView())
        return true
      }
      const start = blockPos(state.doc, k)
      const tr = state.tr
      let at: number
      if (empty) { tr.replaceWith(start, start + cur.nodeSize, nodes); at = start }
      else { at = start + cur.nodeSize; tr.insert(at, nodes) }
      // Caret: inside the first node's first text position (divider: the paragraph after it; mindmap: its item).
      const focusAt = kind === 'divider' ? at + nodes[0].nodeSize : kind === 'mindmap' ? at + nodes[0].firstChild!.nodeSize + 1 : at
      if (kind === 'mindmap') ui?.mindmapState?.set(String(empty ? k : k + 1), 'list')
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(focusAt + 1, tr.doc.content.size))))
      dispatch(tr.scrollIntoView())
      return true
    },
    replaceWithLink(from, to, target) {
      const node = editor.schema.nodes.wikiLink.create({ value: linkText(target), embed: false })
      const tr = closeHistory(editor.state.tr).replaceWith(from, to, node)
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + node.nodeSize)))
      dispatch(tr.scrollIntoView())
      return true
    },
    replaceWithTag(from, to, spelling) {
      const node = editor.schema.nodes.tag.create({ value: spelling.replace(/^#/, '').normalize('NFC') })
      const tr = closeHistory(editor.state.tr).replaceWith(from, to, node)
      tr.setSelection(TextSelection.near(tr.doc.resolve(from + node.nodeSize)))
      dispatch(tr.setMeta('tagRules', true).scrollIntoView())
      return true
    },
    moveBlocksTo(from, to, before) {
      const doc = editor.state.doc
      if (before >= from && before <= to + 1) return false
      const start = blockPos(doc, from)
      const end = blockPos(doc, to) + doc.child(to).nodeSize
      const slice = doc.slice(start, end)
      const at = blockPos(doc, before)
      const tr = editor.state.tr
      if (before > to) { tr.insert(at, slice.content); tr.delete(start, end) }
      else { tr.delete(start, end); tr.insert(at, slice.content) }
      const nf = before > to ? before - (to - from + 1) : before
      if (blockSel()) tr.setMeta(blockSelKey, { anchor: nf, head: nf + (to - from) })
      else tr.setSelection(TextSelection.near(tr.doc.resolve(blockPos(tr.doc, nf) + (tr.doc.child(nf).isLeaf ? 0 : 1))))
      dispatch(tr.scrollIntoView())
      return true
    },
    setEmbedMode(pos, mode) {
      const node = editor.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'rawBlock' || node.attrs.kind !== 'embed') return false
      const source = String(node.attrs.source)
      const m = /^(\s*!\[\[)([\s\S]*)(\]\]\s*)$/.exec(source)
      if (!m) return false
      const next = m[1] + withEmbedMode(m[2], mode) + m[3]
      if (next === source) return true
      dispatch(closeHistory(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, source: next })).setMeta('teggEmbedMode', true))
      return true
    },
    insertEmbed(from, to, linkText) {
      const value = linkText.replace(/^\[\[|\]\]$/g, '').normalize('NFC')
      if (!value) return false
      const tr = editor.state.tr.delete(from, to)
      const k = topIndex(editor.state.apply(tr), tr.mapping.map(from))
      const node = tr.doc.child(k)
      const at = blockPos(tr.doc, k)
      const embed = editor.schema.nodes.rawBlock.create({ source: `![[${value}]]`, kind: 'embed' })
      let embedAt: number
      if (node.type.name === 'paragraph' && node.textContent.trim() === '' && !hasInline(node)) {
        tr.replaceWith(at, at + node.nodeSize, embed)
        embedAt = at
      } else {
        embedAt = at + node.nodeSize
        tr.insert(embedAt, embed)
      }
      const after = embedAt + embed.nodeSize
      tr.setSelection(after < tr.doc.content.size ? TextSelection.near(tr.doc.resolve(after)) : NodeSelection.create(tr.doc, embedAt))
      tr.setMeta(blockSelKey, null)
      dispatch(closeHistory(tr).scrollIntoView())
      return true
    },
    convertUnit(unit, target, record, opts) {
      // D-82: the bytes come from @tegg/doc; the editor then shows the result's blocks as one undo step, with the
      // result as its source model, so every unchanged block is written back byte for byte (D-490, D-492).
      let text: string
      try { text = candidate() } catch { return false }
      const now = unitOf(text, unit.from, unit.to)
      if (!now || JSON.stringify(now) !== JSON.stringify(unit)) return false
      const value = target.normalize('NFC')
      const r = replaceUnitWithEmbed(text, unit, value)
      const next = loadDoc(r.text, editor.schema)
      const content = editor.schema.nodeFromJSON(next.json).content
      const before = editor.state.doc
      const tr = closeHistory(editor.state.tr).replaceWith(0, before.content.size, content)
      // The embed: a block embed paragraph, or (a nested item) the list holding it.
      const at = next.doc.blocks.findIndex((b) => b.range[0] <= r.embedFrom && r.embedFrom < Math.max(b.range[1], b.range[0] + 1))
      let k = 0
      let pos = 0
      tr.doc.forEach((n, p, i) => { if (n.attrs.srcIndex === at) { k = i; pos = p } })
      const block = unit.kind !== 'nested-item'
      const kept = opts?.keepSelection ? keptSelection(before, tr.doc, editor.state.selection) : null
      if (kept) tr.setSelection(kept)
      else {
        if (block) tr.setMeta(blockSelKey, { anchor: k, head: k })
        tr.setSelection(block ? NodeSelection.create(tr.doc, pos) : TextSelection.near(tr.doc.resolve(pos + 1)))
      }
      const loadedBefore = loaded
      loaded = next
      conversions = conversions.filter((c) => c.state === 'done')
      conversions.push({ record, target: value, before, after: tr.doc, loadedBefore, loadedAfter: next, state: 'done', pending: false })
      dispatch(kept ? tr.setMeta('teggConvert', true) : tr.setMeta('teggConvert', true).scrollIntoView())
      dispatch(closeHistory(editor.state.tr))
      return pos
    },
    selectBlockAt(index) {
      if (index < 0 || index >= editor.state.doc.childCount) return false
      dispatch(editor.state.tr.setMeta(blockSelKey, { anchor: index, head: index }))
      return true
    },
    slashInsert(from, to, kind, o = {}) {
      dispatch(editor.state.tr.delete(from, to))
      return commands.insertBlock(kind, o)
    },
    setCalloutType(type) {
      return commands.turnInto('callout', { calloutType: type })
    },
    mindmapView(v) {
      const nv = mindmapAtCaret()
      if (!nv) return false
      nv.setView(v, true)
      return true
    },
    canTurnIntoMindmap() {
      return mindmapOffer()
    },
    mindmapLayout(layout) {
      // Slice MM2 (mm-mindmap §6.3, D-791): the mindmap holding the caret, else the focused map; one undo step.
      const nv = mindmapAtCaret()
      return nv ? nv.setLayout(layout) : false
    },
    undo() {
      return editor.commands.undo()
    },
    redo() {
      return editor.commands.redo()
    },
  }

  /** 4F: the selected block embed (one selected block, or a node selection), or null. */
  /** The mindmap holding the caret, else the one whose map has (or last had) the focus (mm-mindmap §3.2). */
  function mindmapAtCaret() {
    const k = topIndex(editor.state)
    const node = editor.state.doc.child(k)
    let dom = isMindmap(node) ? (view.nodeDOM(blockPos(editor.state.doc, k)) as HTMLElement | null) : null
    if (!dom) {
      const f = focusedMindmap.get(view)
      const active = document.activeElement
      if (f && f.isConnected && (f.contains(active) || !view.hasFocus())) dom = f
    }
    return dom ? mindmapViews.get(dom) : undefined
  }

  function selectedEmbed(): { pos: number; index: number; source: string } | null {
    const doc = editor.state.doc
    let index: number | null = null
    const s = blockSel()
    if (s && s.anchor === s.head) index = s.anchor
    else if (!s && editor.state.selection instanceof NodeSelection && editor.state.selection.$from.depth === 0) index = editor.state.selection.$from.index(0)
    if (index === null || index >= doc.childCount) return null
    const n = doc.child(index)
    if (n.type.name !== 'rawBlock' || n.attrs.kind !== 'embed') return null
    const source = String(n.attrs.source)
    if (isAttachmentTarget(linkTargetOf(source.trim().replace(/^!\[\[|\]\]$/g, '')))) return null
    return { pos: blockPos(doc, index), index, source }
  }

  /** ↑ on the first line of the first block / ↓ on the last line of the last block (D-428). */
  function atEdge(dir: 'up' | 'down'): boolean {
    if (blockSel()) return false
    const k = topIndex(editor.state)
    if (dir === 'up' ? k !== 0 : k !== editor.state.doc.childCount - 1) return false
    try {
      return view.endOfTextblock(dir)
    } catch {
      return false
    }
  }

  /** D-428: ↓ at the end of a block before a block embed (↑ at the start of one after it) selects that embed. */
  function intoEmbed(dir: 'up' | 'down'): boolean {
    const s = blockSel()
    const doc = editor.state.doc
    let k: number
    if (s) {
      if (s.anchor !== s.head) return false
      k = s.head + (dir === 'down' ? 1 : -1)
    } else {
      const sel = editor.state.selection
      if (!sel.empty || sel.$from.depth === 0) return false
      let edge = false
      try { edge = view.endOfTextblock(dir) } catch { edge = false }
      if (!edge) return false
      k = topIndex(editor.state) + (dir === 'down' ? 1 : -1)
    }
    if (k < 0 || k >= doc.childCount) return false
    const n = doc.child(k)
    if (n.type.name === 'rawBlock' && n.attrs.kind === 'embed') {
      dispatch(editor.state.tr.setMeta(blockSelKey, { anchor: k, head: k }))
      return true
    }
    if (!s) return false
    // From a selected embed to the neighbouring block's text.
    const at = blockPos(doc, k)
    dispatch(editor.state.tr.setSelection(dir === 'down' ? TextSelection.near(doc.resolve(at + 1)) : TextSelection.near(doc.resolve(at + n.nodeSize - 1), -1)).setMeta(blockSelKey, null))
    return true
  }

  const api: TeggEditor & { atEdge(dir: 'up' | 'down'): boolean; hasBlockSel(): boolean; intoEmbed(dir: 'up' | 'down'): boolean; opts: EditorOptions } = {
    opts,
    atEdge,
    intoEmbed: (d) => (opts.onEmbedKey ? intoEmbed(d) : false),
    hasBlockSel: () => !!blockSel(),
    selectedEmbed,
    conversionUnit,
    view,
    editor,
    async save() {
      if (faults().verify) throw new VerifyError('verification refused (test fault, NFR-REL-03 AC-9)')
      return compute()
    },
    markSaved(text) {
      // The saved head (identity keys, `modified`) becomes the frontmatter in effect unless a panel edit was committed
      // after the save was computed; that edit stays pending (§14.6).
      const attr = editor.state.doc.attrs.frontmatter
      if ((computed && computed.out === text && computed.head === attr) || attr === headOf(lastSaved) || attr === null) syncHead(text)
      computed = null
      lastSaved = text
      const t = parse(text).frontmatter?.data?.title
      if (pendingTitle !== null && t === pendingTitle) pendingTitle = null
      dirty = false
      opts.onChange?.(false)
    },
    reload(text) {
      const state = editor.state
      const k = topIndex(state)
      const node = state.doc.child(k)
      const src = node.attrs.srcIndex as number | null
      const oldRaw = (i: number): string | null => {
        const n = state.doc.child(i)
        const s = n.attrs.srcIndex as number | null
        return s !== null && loaded.originals[s] && n.eq(loaded.originals[s]!) ? loaded.doc.blocks[s].raw : null
      }
      const $from = state.selection.$from
      const offset = $from.depth > 0 ? $from.pos - startOf(state.doc, k) : 0
      void src
      lastSaved = text
      pendingTitle = null
      load(text)
      const blocks = loaded.doc.blocks.map((b) => b.raw)
      const doc = editor.state.doc
      let target: number | null = null
      const mine = oldRaw(k)
      const idx = mine !== null ? blocks.indexOf(mine) : -1
      if (idx >= 0 && idx < doc.childCount) target = Math.min(startOf(doc, idx) + offset, endOf(doc, idx))
      else {
        for (let i = k - 1; i >= 0 && target === null; i--) {
          const r = oldRaw(i)
          const j = r !== null ? blocks.indexOf(r) : -1
          if (j >= 0 && j < doc.childCount) target = endOf(doc, j)
        }
        if (target === null && mine === null && k < doc.childCount) target = Math.min(startOf(doc, k) + offset, endOf(doc, k))
      }
      if (target !== null) view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target))).setMeta('addToHistory', false).setMeta('teggLoad', true))
      // The selection change above isn't an undo step; start the history empty again (D-178).
      view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins, selection: editor.state.selection }))
      dirty = false
    },
    readonlyBlocks() {
      // Top-level blocks shown read-only now (source blocks and placeholders); at load these are the source-block
      // indices the normalization guard and the raw kinds produced (FR-EDT-01 AC-2, AC-8).
      const out: number[] = []
      editor.state.doc.forEach((n, _o, i) => { if (n.type.name === 'rawBlock') out.push(i) })
      return out
    },
    text() {
      try {
        return compute() ?? lastSaved
      } catch {
        return lastSaved
      }
    },
    dirty: () => dirty,
    historyDepth: () => undoDepth(editor.state),
    applyFrontmatter(next) {
      // ms3-shell §14.6 (D-240, FR-EDT-07 AC-4, AC-16): only the frontmatter of `next` is taken, as one undo step.
      const nd = parse(next)
      const cur = candidate()
      if (next.slice(nd.bodyStart) !== cur.slice(parse(cur).bodyStart)) throw new Error('applyFrontmatter: the body differs from the editor body')
      const h = next.slice(0, nd.bodyStart)
      if (h === head()) return
      dispatch(closeHistory(editor.state.tr.setDocAttribute('frontmatter', h)))
    },
    setTitle(title) {
      pendingTitle = title === null ? null : title.normalize('NFC')
      dirty = true
      opts.onChange?.(true)
    },
    blockSelection() {
      const s = blockSel()
      return s ? { from: Math.min(s.anchor, s.head), to: Math.max(s.anchor, s.head) } : null
    },
    trackPos(pos) {
      const t = { pos: pos as number | null }
      tracked.add(t)
      return () => t.pos
    },
    clearBlockSelection() {
      if (blockSel()) dispatch(editor.state.tr.setMeta(blockSelKey, null))
    },
    caretBlock: () => topIndex(editor.state),
    pastePlainNext() {
      plainNext = true
    },
    refreshUi() {
      view.dispatch(editor.state.tr.setMeta(uiRefresh, true).setMeta('addToHistory', false))
    },
    selectedSource,
    commands,
    destroy() {
      editor.destroy()
    },
  }
  return api
}

/** The event comes from a form field (input, textarea, select) the app rendered inside the document (an embed). */
function formField(event: Event): boolean {
  const el = event.target as HTMLElement | null
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/** The DOM selection is inside the app-rendered content of a block embed (not this editor's own text). */
function inEmbedDom(view: EditorView): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  const node = sel?.anchorNode ?? null
  const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null
  // D-606: a read-only table is guarded like an embed's content (its text isn't this document's).
  const block = el?.closest?.('.embed-block, [data-table-readonly]')
  return !!block && view.dom.contains(block) && block !== view.dom
}

/** The target part of an embed's inner text. */
function linkTargetOf(value: string): string {
  const left = value.split(/\\?\|/)[0]
  const hash = left.indexOf('#')
  return (hash >= 0 ? left.slice(0, hash) : left).trim()
}

function hasInline(node: PMNode): boolean {
  let found = false
  node.descendants((n) => { if (n.isInline && !n.isText) found = true; return !found })
  return found
}

/** Slice MM (D-772): list keys inside a mindmap keep its body one list. The caret's mindmap callout, the depth of its
 *  list item and whether that item is top-level, or null outside a mindmap item. */
function mindmapItem(state: EditorState): { callout: number; item: number; top: boolean } | null {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return null
  for (let d = $from.depth - 1; d > 0; d--) {
    const n = $from.node(d)
    if (n.type.name === 'callout') {
      if (String(n.attrs.calloutType).toLowerCase() !== 'mindmap' || d !== 1) return null
      const item = $from.depth - 1
      if ($from.node(item).type.name !== 'listItem') return null
      return { callout: d, item, top: item === d + 2 }
    }
  }
  return null
}
const MindmapKeys = Extension.create({
  name: 'teggMindmapKeys',
  priority: 1001,
  addKeyboardShortcuts() {
    /** The mindmap becomes one empty paragraph (its only item was empty). */
    const toParagraph = (state: EditorState, dispatch: (tr: Transaction) => void, callout: number) => {
      const $f = state.selection.$from
      // D-780: a titled mindmap keeps its block and title; ⌫ goes to the end of the title (⏎ is handled by the caller).
      const title = $f.node(callout).firstChild
      if (title?.type.name === 'calloutTitle' && title.content.size > 0) {
        const end = $f.before(callout) + 1 + title.nodeSize - 1
        dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(end), -1)).scrollIntoView())
        return true
      }
      const start = $f.before(callout)
      const end = $f.after(callout)
      const tr = closeHistory(state.tr).replaceWith(start, end, state.schema.nodes.paragraph.create())
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)))
      dispatch(tr.scrollIntoView())
      return true
    }
    return {
      Enter: ({ editor }) => {
        const st = editor.state
        // ⏎ in a mindmap's title moves the caret to the end of its first item (D-771).
        const $t = st.selection.$from
        if ($t.parent.type.name === 'calloutTitle' && $t.depth === 2 && String($t.node(1).attrs.calloutType).toLowerCase() === 'mindmap' && $t.node(1).childCount > 1) {
          const list = $t.node(1).child(1)
          if (/List$/.test(list.type.name) && list.firstChild?.firstChild) {
            const at = $t.after(2) + 2 + list.firstChild.firstChild.nodeSize - 1
            editor.view.dispatch(st.tr.setSelection(TextSelection.near(st.doc.resolve(at), -1)).scrollIntoView())
            return true
          }
        }
        const m = mindmapItem(st)
        if (!m || !m.top) return false
        const $f = st.selection.$from
        const item = $f.node(m.item)
        if (item.childCount !== 1 || item.child(0).content.size !== 0) return false
        const list = $f.node(m.item - 1)
        const titled = ($f.node(m.callout).firstChild?.type.name === 'calloutTitle') && $f.node(m.callout).firstChild!.content.size > 0
        if (list.childCount === 1 && !titled) return toParagraph(st, editor.view.dispatch, m.callout)
        // ⏎ on an empty top-level item: the caret moves to a new paragraph after the mindmap; the item goes, unless it
        // is a titled mindmap's only item (D-780: it stays, the block keeps its title and nothing is written).
        const tr = list.childCount === 1 ? st.tr : st.tr.delete($f.before(m.item), $f.after(m.item))
        const after = tr.mapping.map($f.after(m.callout))
        tr.insert(after, st.schema.nodes.paragraph.create())
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
        editor.view.dispatch(tr.scrollIntoView())
        return true
      },
      'Shift-Tab': ({ editor }) => {
        const m = mindmapItem(editor.state)
        return !!m && m.top
      },
      Backspace: ({ editor }) => {
        const st = editor.state
        const m = mindmapItem(st)
        if (!m || !m.top || st.selection.$from.parentOffset !== 0) return false
        const $f = st.selection.$from
        const list = $f.node(m.item - 1)
        const item = $f.node(m.item)
        if (list.childCount !== 1 || item.childCount !== 1 || item.child(0).content.size !== 0) return false
        return toParagraph(st, editor.view.dispatch, m.callout)
      },
    }
  },
})

/** 4F (D-428): keys on a selected block embed, and leaving a nested editor. Runs before every other keymap. */
function embedKeys(get: () => { opts: EditorOptions; selectedEmbed(): { pos: number } | null; atEdge(d: 'up' | 'down'): boolean; hasBlockSel(): boolean; intoEmbed(d: 'up' | 'down'): boolean }) {
  return Extension.create({
    name: 'teggEmbedKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      const key = (k: 'enter' | 'open') => () => {
        const a = get()
        const e = a.selectedEmbed()
        return !!e && !!a.opts.onEmbedKey?.(e.pos, k)
      }
      const leave = (how: 'up' | 'down') => () => {
        const a = get()
        if (a.intoEmbed(how)) return true
        return !!a.opts.onLeave && a.atEdge(how) && a.opts.onLeave(how)
      }
      return {
        Enter: key('enter'),
        'Mod-Enter': key('open'),
        'Meta-Enter': key('open'),
        Escape: () => {
          const a = get()
          return !!a.opts.onLeave && !a.hasBlockSel() && a.opts.onLeave('escape')
        },
        ArrowUp: leave('up'),
        ArrowDown: leave('down'),
      }
    },
  })
}

/** 5A-2 (ms5-tasks §11.5): the hint of an empty body without the app's presentation (`emptyHint`): a widget, never
 *  part of the text. */
function emptyHint(text: string) {
  return Extension.create({
    name: 'teggEmptyHint',
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          decorations(state) {
            const doc = state.doc
            if (!(doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0)) return null
            return DecorationSet.create(doc, [Decoration.widget(1, (view) => hintElement(view, text), { side: 1, ignoreSelection: true, key: 'hint' })])
          },
        },
      })]
    },
  })
}
