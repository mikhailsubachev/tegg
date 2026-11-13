// How the editor shows non-text syntax (ms3-shell §13.5): link chips with their resolution (D-140, D-142), source
// blocks and placeholders (FR-EDT-01 AC-8, R5), checklist checkboxes (FR-EDT-02 AC-18) and the empty-note hint
// (FR-EDT-01 AC-9). Every text comes from the app (`EditorUi`), so the strings stay in its catalog (NFR-OTH-02).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { redo, undo } from '@tiptap/pm/history'
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from '@tiptap/pm/view'
import { displayTable, isAttachmentTarget, layoutOf, markdownTree, queryFences, renderBlock, type MindmapLayout } from '@tegg/doc'
import { closeHistory } from '@tiptap/pm/history'
import type { RootContent } from 'mdast'
import type { JSONContent } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { blockToPM, pmToBlock } from './convert'
import { wikiLabel } from './schema'

export type LinkInfo = {
  /** 6A (ms6-trash-media §2, §3.2): `trashed` resolves only in `.trash/`; `media` is a file (an image, a PDF). */
  kind: 'note' | 'daily' | 'unresolved' | 'date-missing' | 'trashed' | 'media'; path?: string | null; type?: string | null; title?: string | null
  /** D-601: the target's `review`, `status`, `due`, `completed` for its chip (D-600). */
  review?: string | null; status?: string | null; due?: string | null; completed?: string | null
  /** 6A (ms6-trash-media §3.2): with kind `media`, the file's live Image or PDF object. */
  object?: string | null
}
/** D-600: what the app adds to a resolved chip: data attributes, a description, an icon in place of the type's, and
 *  the suffix after the title. */
export type ChipExtra = { attrs: Record<string, string>; description: string | null; icon: Element | null; suffix: Element | null }

/** Slice MM (mm-mindmap §3.3): what the app's map gets from the editor's mindmap block. */
export type MindmapCtl = {
  /** The block's current Markdown (the app reads its tree with `mindmapTree`, mm-mindmap §1.2). */
  markdown: () => string
  view: () => 'map' | 'list'
  /** Folded (D-680 `-`): no map is drawn. */
  folded?: () => boolean
  onNode: (path: number[] | null) => void
  onLink: (target: string) => void
  readOnly: boolean
  /** Slice MM2 (D-791): the block's stored layout. */
  layout: () => MindmapLayout
  /** Slice MM2 (D-786): edits on the block; null when read-only. */
  edit: MindmapEdit | null
}
/** Slice MM2 (mm-mindmap §6.3): the map's edits on its block; null when read-only. STUBS until built. */
export type MindmapEdit = {
  source(path: number[]): string | null
  setText(path: number[], markdown: string): boolean
  insert(at: number[] | null, where: 'sibling' | 'child', markdown: string): number[] | null
  remove(path: number[]): number[] | null
  move(path: number[], dir: 'up' | 'down' | 'in' | 'out'): number[] | null
  undo(): boolean
  redo(): boolean
}
export type MindmapHandle = {
  update(opts?: { now?: boolean }): void
  /** Focuses the map: its open field, else its roving node. */
  focusTree(): void
  destroy(): void
  focusedNode?(): number[] | null | undefined
  /** Slice MM2 (§6.7): after `destroy()` (a document redraw), moves the live map into a re-created block's container and keeps it alive; false when the map is still live or already unmounted. */
  adopt?(dom: HTMLElement): boolean
}

export interface EditorUi {
  /** Resolution of a wikilink target (the part before `#`/`|`); undefined while unknown. */
  resolve(target: string): LinkInfo | undefined
  /** Accessible description of a chip that doesn't resolve (D-142). */
  unresolved(target: string): string
  sourceBlock: string
  hint: string
  /** Accessible name of a checklist item's checkbox. */
  checkbox?: string
  /** The type icon shown in a link chip (the read view's chip, D-217: the type's icon), or null for none. */
  chipIcon?: (type: string | null) => Element | null
  /** D-606: renders `markdown` (a table normalized by `displayTable`) read-only into `dom`. */
  readOnlyTable?: (markdown: string, dom: HTMLElement) => { destroy(): void }
  /** D-606: the description of such a table (`Edit in the source view`). */
  readOnlyTableHint?: string
  /** D-600: the Unreviewed mark and a task's suffix of a resolved chip, or null for a plain chip. */
  chipExtra?: (info: LinkInfo) => ChipExtra | null
  /** Slice MM (mm-mindmap §3.3): draws a mindmap block's map into `dom`; null shows the list only. */
  mindmap?(dom: HTMLElement, ctl: MindmapCtl): MindmapHandle | null
  /** Slice MM (D-776): the in-memory view of each mindmap block, keyed by its block index (the app adds the note). */
  mindmapState?: { get(key: string): 'map' | 'list' | undefined; set(key: string, v: 'map' | 'list'): void }
  /** Slice MM (R91, R94): the catalog texts of the mindmap block. */
  mindmapText?: (key: 'figure' | 'untitled' | 'view' | 'map' | 'list' | 'empty' | 'notOneList' | 'expand' | 'collapse' | 'layout' | 'layoutRight' | 'layoutSpider' | 'editNode', title?: string) => string
  /** Slice MM: the mindmap icon (`data-icon="mindmap"`). */
  mindmapIcon?: () => Element
  /** Slice OL (D-159): a callout type's label, the fold button's name of an untitled folding callout. */
  calloutLabel?: (type: string) => string
  /** Name and visible text of the placeholder for an embed (`![[…]]`), a query or a mindmap block (R5). */
  placeholder(kind: 'embed' | 'query' | 'mindmap', value: string): { name: string; text: string; id?: string; note?: boolean }
  /** `chip`: where the clicked chip is (its node position and DOM), for the Create offer of a broken link (4A).
   *  Slice P (v1-previews §5.1): `gesture` says how; the app maps it with `resolveRefInput` (R103). */
  onLink(target: string, fragment: string | null, chip?: { pos: number; dom: HTMLElement | null }, gesture?: LinkGesture): void
  /** Slice P (FR-LNK-11 AC-13): the description a resolved chip adds for the preview mode, or null (Off). */
  linkHint?(): string | null
  /** Slice P (D-942): the pointer rests on, moves over or leaves a chip (hover mode). */
  onLinkHover?(target: string, fragment: string | null, chip: { pos: number; dom: HTMLElement }, phase: 'enter' | 'move' | 'leave'): void
  /** Slice P (D-927): a right-click on a chip; true when the app showed its menu. */
  onLinkMenu?(target: string | null, chip: { pos: number; dom: HTMLElement }, event: MouseEvent): boolean
  /** Slice P (R104 row 12): with the chip and the gesture, so a tag click previews the Tag. */
  onTag(value: string, chip?: { pos: number; dom: HTMLElement | null }, gesture?: LinkGesture): void
  onExternal(href: string): void
  /** 4F (ms4-embeds §7): renders a block embed (`rawBlock` kind `embed`); null keeps the 3C placeholder. */
  embed?(source: string, dom: HTMLElement, getPos: () => number | undefined): EmbedHandle | null
  /** 4F (FR-EMB-02 AC-2): hide trailing ` ^id` block ids (an embedded note shows its content as the read view does). */
  hideBlockIds?: boolean
  /** 4F (D-419): an inline embed as a link-mode embed; undefined while unknown. */
  embedChip?(value: string): { title: string; type: string | null; state: 'ok' | 'broken' | 'too-deep'; description: string; target?: string } | undefined
  /** 6A (ms6-trash-media §6.1): renders a block embed of a file (`![[photo.png]]`, an image or PDF; R77) into `dom`;
   *  the editor owns no `img`. Null leaves the placeholder. */
  media?(source: string, dom: HTMLElement, getPos: () => number | undefined): EmbedHandle | null | void
  /** 6A (ms6-trash-media §6.1, FR-ATT-01 AC-1): called first by `handlePaste` when the clipboard has files (image
   *  items win over text); `true` consumes the paste. 6A stub: never called yet. */
  onFiles?(files: File[], pos: number): boolean
  /** Slice Q (v1-queries §3.2, D-1470): draws a query block into `dom`: a top-level fence (`rawBlock` kind `query`,
   *  `source` is the fence as written) or a nested one (`codeBlock` language `query`, `source` is the fence rebuilt
   *  without container prefixes). Null (or no hook) shows the fence's text as a source block (D-1499: no placeholder). */
  query?(source: string, dom: HTMLElement, ctl: QueryCtl): EmbedHandle | null
  /** Slice Q (R144): ⌘↩ on a selected query block at `pos`; true when handled. `EditorOptions.onQueryKey` wins. */
  onQueryKey?(pos: number, key: 'open'): boolean
}

/** Slice Q (v1-queries §3.2): what the app's query block gets from the editor. */
export type QueryCtl = {
  /** The block's position (the rawBlock or the nested codeBlock); undefined once it is gone. */
  getPos(): number | undefined
  /** Inside a list, quote or callout (a `codeBlock` language `query`). */
  readonly nested: boolean
  /** An unsaved block from `insertQuery(…, null)`: never written (D-1471). Read live. */
  readonly draft: boolean
  /** Replaces the fence's text (a whole fence; for a nested block its body is used) as one transaction and one undo
   *  step, and clears `draft`. False when the block is gone or the editor is read-only. */
  setSource(source: string): boolean
  /** Selects the block as a node (the caret leaves the text). */
  select(): void
}

/** 4F (ms4-embeds §7): the app's handle on a rendered block embed. */
export interface EmbedHandle {
  update(source: string): void
  selected(on: boolean): void
  destroy(): void
}

/** A block embed whose view was built while a text was loading; the app's embed is mounted on its next render. */
export const PENDING_EMBED: EmbedHandle = { update() {}, selected() {}, destroy() {} }

export const uiRefresh = new PluginKey('teggUi')

/** Slice P (v1-previews §5.1): how a link chip was used. */
export type LinkGesture = 'click' | 'dblclick' | 'modClick' | 'enter' | 'modEnter' | 'altSpace'

/** A link chip a click or key acts on: a wikiLink (a link, or an inline embed that isn't a file). */
export function isLinkChip(node: PMNode | null | undefined, ui?: Pick<EditorUi, 'embedChip'>): boolean {
  if (!node || node.type.name !== 'wikiLink') return false
  return !node.attrs.embed || (!!ui?.embedChip && !isAttachmentTarget(linkTarget(String(node.attrs.value)).target))
}

/** Slice P (D-209, D-928): the chip at the caret: the selected chip, else the one directly before the caret, else the
 *  one directly after it. */
export function chipAtCaret(state: EditorState, ui?: Pick<EditorUi, 'embedChip'>): { pos: number; node: PMNode } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && isLinkChip(sel.node, ui)) return { pos: sel.from, node: sel.node }
  if (!sel.empty) return null
  const { $from } = sel
  if (isLinkChip($from.nodeBefore, ui)) return { pos: $from.pos - $from.nodeBefore!.nodeSize, node: $from.nodeBefore! }
  if (isLinkChip($from.nodeAfter, ui)) return { pos: $from.pos, node: $from.nodeAfter! }
  return null
}

/** The target part of a wikilink value: before `#`, `^` subpaths and the alias. */
export function linkTarget(value: string): { target: string; fragment: string | null } {
  const pipe = /\\?\|/.exec(value)
  const left = pipe ? value.slice(0, pipe.index) : value
  const hash = left.indexOf('#')
  return hash >= 0 ? { target: left.slice(0, hash).trim(), fragment: left.slice(hash + 1) } : { target: left.trim(), fragment: null }
}

const EMBED_KIND = (value: string): 'embed' => (void value, 'embed')

function decorations(doc: PMNode, ui: EditorUi): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'wikiLink') {
      const value = String(node.attrs.value)
      const { target } = linkTarget(value)
      if (node.attrs.embed) {
        // 4F (D-419): an inline note embed is a link-mode embed; attachments keep their placeholder (R5).
        const chip = !isAttachmentTarget(target) ? ui.embedChip?.(value) : undefined
        if (chip) {
          const icon = chip.state !== 'broken' ? ui.chipIcon?.(chip.type ?? 'page')?.getAttribute('data-icon') ?? null : null
          decos.push(Decoration.node(pos, pos + node.nodeSize, {
            role: 'link', class: `embed-chip embed-link${chip.state === 'broken' ? ' kind-unresolved' : ''}`, 'data-embed': '', 'data-embed-mode': 'link',
            'data-embed-state': chip.state, 'aria-label': chip.title,
            // D-1175: an embed carries no preview-mode description (it opens on a click, D-1166).
            'aria-description': chip.description,
            ...(icon ? { 'data-icon': icon } : {}), ...(chip.state === 'broken' ? { 'data-link-kind': 'unresolved' } : {}), ...(chip.target ? { 'data-embed-target': chip.target } : {}),
          }))
          return false
        }
        const ph = ui.placeholder(EMBED_KIND(value), value)
        decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'region', 'aria-label': ph.name, class: 'embed-chip', 'data-embed': '' }))
        return false
      }
      const info = ui.resolve(target)
      const broken = info && info.kind === 'unresolved' // a date without a note is never broken (D-142, FR-DLY-08 AC-5)
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        role: 'link',
        'data-command': 'edit.openOrToggle',
        class: `chip link-chip kind-${info?.kind ?? 'unresolved'}`,
        'data-link-kind': info?.kind ?? 'unresolved', // FR-LNK-07 (D-306): the same attribute in every context
        // D-600: a changed review or task state changes the decoration, so the chip's view draws it again.
        'data-chip-sig': info ? `${info.review ?? ''}|${info.status ?? ''}|${info.due ?? ''}|${info.completed ?? ''}|${info.title ?? ''}` : '',
        ...(broken ? { 'aria-description': ui.unresolved(target) } : {}),
        // Slice P: the mode's description is drawn by the chip's view; a mode change redraws it.
        'data-hint': broken ? '' : ui.linkHint?.() ?? '',
      }))
      return false
    }
    if (node.type.name === 'tag') {
      const hint = ui.linkHint?.()
      decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'link', class: 'chip tag-chip', ...(hint ? { 'aria-description': hint } : {}) }))
      return false
    }
    if (node.type.name === 'rawBlock' && node.attrs.kind === 'embed') {
      // D-310: the note embed's chip shows its target's resolution; a change re-renders the placeholder.
      const { target } = linkTarget(String(node.attrs.source).replace(/^!\[\[|\]\]$/g, ''))
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-embed-kind': ui.resolve(target)?.kind ?? 'unresolved' }))
      return false
    }
    return true
  })
  if (ui.hideBlockIds) {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true
      const text = node.textContent
      const m = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/.exec(text)
      if (m && node.lastChild?.isText) decos.push(Decoration.inline(pos + 1 + m.index, pos + 1 + text.length, { class: 'block-id-hidden', style: 'display: none' }))
      return false
    })
  }
  // The hint of an empty note: a widget, never part of the text or a copy (FR-EDT-01 AC-9).
  if (doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0) {
    decos.push(Decoration.widget(1, (view) => hintElement(view, ui.hint), { side: 1, ignoreSelection: true, key: 'hint' }))
  }
  return DecorationSet.create(doc, decos)
}

/** A block embed's inner text, or null for an attachment (which keeps its R5 placeholder). */
function noteEmbed(source: string): string | null {
  const inner = source.trim().replace(/^!\[\[|\]\]$/g, '')
  return isAttachmentTarget(linkTarget(inner).target) ? null : inner
}

class RawBlockView implements NodeView {
  dom: HTMLElement
  private handle: EmbedHandle | null = null
  private table: { destroy(): void } | null = null
  constructor(private node: PMNode, private ui: EditorUi, private getPos: () => number | undefined, private view?: EditorView) {
    this.dom = document.createElement('div')
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('draggable', 'false')
    this.render()
  }
  private render() {
    const { node, ui } = this
    const kind = String(node.attrs.kind)
    const source = String(node.attrs.source)
    // Slice Q (v1-queries §3.2): a query block is drawn by the app.
    if (kind === 'query' && ui.query && this.view) {
      if (this.handle && this.handle !== PENDING_EMBED) {
        this.handle.update(source)
        return
      }
      this.dom.className = 'query-block'
      this.dom.removeAttribute('role')
      this.dom.removeAttribute('aria-label')
      this.dom.removeAttribute('data-placeholder')
      this.dom.replaceChildren()
      const view = this.view
      this.handle = ui.query(source, this.dom, queryCtl(view, this.getPos, () => this.node, false))
      if (this.handle) return
    }
    // 4F (ms4-embeds §7): a note embed is rendered by the app.
    if (kind === 'embed' && ui.embed && noteEmbed(source) !== null) {
      if (this.handle && this.handle !== PENDING_EMBED) {
        this.handle.update(source)
        return
      }
      this.dom.className = 'embed-block'
      this.dom.removeAttribute('role')
      this.dom.removeAttribute('aria-label')
      this.dom.removeAttribute('data-placeholder')
      this.dom.replaceChildren()
      this.handle = ui.embed(source, this.dom, this.getPos)
      if (this.handle) return
    }
    // 6A (R77): a file embed is drawn by the app (figure, PDF card, missing file).
    if (kind === 'embed' && ui.media && noteEmbed(source) === null) {
      if (this.handle && this.handle !== PENDING_EMBED && this.dom.classList.contains('media-block')) {
        this.handle.update(source)
        return
      }
      if (this.handle) this.handle.destroy()
      this.dom.className = 'embed-block media-block'
      this.dom.removeAttribute('role')
      this.dom.removeAttribute('aria-label')
      this.dom.removeAttribute('data-placeholder')
      this.dom.replaceChildren()
      this.handle = ui.media(source, this.dom, this.getPos) ?? null
      if (this.handle) return
    }
    if (this.handle) {
      this.handle.destroy()
      this.handle = null
    }
    this.table?.destroy()
    this.table = null
    this.dom.replaceChildren()
    // D-1499: a query block without the app's hook is shown as its source text, never as an R5 placeholder.
    if (kind === 'embed' || kind === 'mindmap') {
      const ph = ui.placeholder(kind as 'embed', source)
      this.dom.setAttribute('role', 'region')
      this.dom.setAttribute('aria-label', ph.name)
      if (ph.id) this.dom.setAttribute('data-placeholder', ph.id)
      this.dom.className = 'in-note-placeholder'
      if (kind === 'embed' && ph.note) this.noteChip(ph.name, source)
      else this.dom.textContent = ph.text
    } else {
      this.dom.setAttribute('role', 'group')
      this.dom.setAttribute('aria-label', ui.sourceBlock)
      // D-606: a table the editor can't edit losslessly is drawn as a read-only table (the app renders it).
      const table = kind === 'raw' && ui.readOnlyTable ? displayTable(source) : null
      if (table) {
        this.dom.className = 'source-block source-table'
        this.dom.setAttribute('data-table-readonly', '')
        if (ui.readOnlyTableHint) this.dom.setAttribute('aria-description', ui.readOnlyTableHint)
        this.table = ui.readOnlyTable!(table, this.dom)
        return
      }
      this.dom.removeAttribute('data-table-readonly')
      this.dom.removeAttribute('aria-description')
      this.dom.className = 'source-block'
      const pre = document.createElement('pre')
      pre.textContent = source
      this.dom.appendChild(pre)
    }
  }
  /** D-310: `Embedded note: <chip>`; the chip opens its note, or the Create offer when it doesn't resolve. */
  private noteChip(name: string, source: string) {
    const value = source.replace(/^!\[\[|\]\]$/g, '')
    const { target, fragment } = linkTarget(value)
    const info = this.ui.resolve(target)
    const kind = info?.kind ?? 'unresolved'
    this.dom.appendChild(document.createTextNode(`${name}: `))
    const chip = document.createElement('span')
    chip.setAttribute('role', 'link')
    chip.className = `chip link-chip kind-${kind}`
    chip.setAttribute('data-link-kind', kind)
    if (kind === 'unresolved') chip.setAttribute('aria-description', this.ui.unresolved(target))
    const icon = info && (info.kind === 'note' || info.kind === 'daily') ? this.ui.chipIcon?.(info.type ?? 'page') : null
    if (icon) chip.appendChild(icon)
    const label = document.createElement('span')
    label.setAttribute('data-user-content', '')
    label.textContent = chipLabel(value, info)
    chip.appendChild(label)
    chip.addEventListener('click', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      this.ui.onLink(target, fragment, { pos: this.getPos() ?? 0, dom: chip }, e.metaKey || e.ctrlKey ? 'modClick' : 'click')
    })
    this.dom.appendChild(chip)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    if (this.handle && String(node.attrs.kind) !== String(this.node.attrs.kind)) return false
    if (this.handle && this.handle !== PENDING_EMBED && String(node.attrs.kind) === 'query' && node.attrs.source === this.node.attrs.source) { this.node = node; return true }
    // D-606: a read-only table keeps its rendered root while its source is the same.
    if (this.table && node.attrs.source === this.node.attrs.source && node.attrs.kind === this.node.attrs.kind) { this.node = node; return true }
    this.node = node
    this.render()
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
    this.handle?.selected(true)
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
    this.handle?.selected(false)
  }
  destroy() {
    this.handle?.destroy()
    this.handle = null
    this.table?.destroy()
    this.table = null
  }
  stopEvent(e: Event) {
    if (this.handle) {
      // The embed's own controls and its nested editor handle their events (AP-349: a click elsewhere selects it).
      const el = e.target as HTMLElement | null
      if (el === this.dom) return false
      return e.type.startsWith('key') || !!el?.closest?.('[data-embed-body], button, a, [role="menu"], [role="link"]')
    }
    return e.type === 'keydown' || e.type === 'beforeinput' || e.type === 'paste' || (e.type === 'click' && !!(e.target as HTMLElement | null)?.closest?.('.link-chip'))
  }
  ignoreMutation() {
    return true
  }
}

// ------------------------------------------------------------------------------------------------ slice Q

/** A nested query fence: a `codeBlock` whose language is exactly `query` (R140, D-1470). */
export function isQueryCode(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === 'codeBlock' && node.attrs.language === 'query'
}

/** A query block: a top-level `rawBlock` kind `query` or a nested query `codeBlock`. */
export function isQueryNode(node: PMNode | null | undefined): boolean {
  return !!node && ((node.type.name === 'rawBlock' && node.attrs.kind === 'query') || isQueryCode(node))
}

/** The fence text of a query block: a rawBlock's source as written; a nested codeBlock's fence rebuilt without
 *  container prefixes (```` ```query[ meta]\n<body>\n``` ````). */
export function querySource(node: PMNode): string {
  if (node.type.name === 'rawBlock') return String(node.attrs.source)
  const meta = node.attrs.meta ? ` ${String(node.attrs.meta)}` : ''
  const body = node.textContent
  return '```query' + meta + '\n' + (body ? body + '\n' : '') + '```'
}

/** The body a `setSource` gives a nested block: the fence's body when `source` is a fence, else `source` itself. */
function bodyFrom(source: string): string {
  if (/^[ \t]*(`{3,}|~{3,})/.test(source)) {
    const f = queryFences(source)[0]
    if (f) return f.body.replace(/\r\n?/g, '\n')
    return source.replace(/^[^\n]*\n?/, '').replace(/\n?[ \t]*(`{3,}|~{3,})[ \t]*\n?$/, '')
  }
  return source.replace(/\r\n?/g, '\n')
}

/** Replaces the query block at `pos` with `source` as one transaction and one undo step; clears `draft`. */
export function setQuerySource(view: EditorView, pos: number, source: string): boolean {
  if (!view.editable) return false
  const node = view.state.doc.nodeAt(pos)
  if (!node || !isQueryNode(node)) return false
  const tr = closeHistory(view.state.tr)
  if (node.type.name === 'rawBlock') {
    if (node.attrs.source === source && !node.attrs.draft) return true
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, source, draft: false })
  } else {
    const body = bodyFrom(source)
    if (body === node.textContent) return true
    tr.replaceWith(pos + 1, pos + node.nodeSize - 1, body ? view.state.schema.text(body) : [])
  }
  view.dispatch(tr)
  return true
}

function queryCtl(view: EditorView, getPos: () => number | undefined, node: () => PMNode, nested: boolean): QueryCtl {
  const live = (): number | undefined => {
    const pos = getPos()
    return pos !== undefined && isQueryNode(view.state.doc.nodeAt(pos)) ? pos : undefined
  }
  return {
    getPos: live,
    nested,
    get draft() { return !nested && !!node().attrs.draft },
    setSource(source) {
      const pos = live()
      return pos !== undefined && setQuerySource(view, pos, source)
    },
    select() {
      const pos = live()
      if (pos === undefined) return
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    },
  }
}

/** Slice Q (D-1470): a nested query fence drawn by the app; no content DOM, so the caret never enters it. */
class QueryCodeView implements NodeView {
  dom: HTMLElement
  private handle: EmbedHandle | null = null
  constructor(private node: PMNode, private ui: EditorUi, private getPos: () => number | undefined, private view: EditorView) {
    this.dom = document.createElement('div')
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('draggable', 'false')
    this.render()
  }
  private render() {
    const source = querySource(this.node)
    if (this.handle && this.handle !== PENDING_EMBED) {
      this.handle.update(source)
      return
    }
    this.dom.className = 'query-block'
    this.dom.removeAttribute('role')
    this.dom.removeAttribute('aria-label')
    this.dom.replaceChildren()
    this.handle = this.ui.query!(source, this.dom, queryCtl(this.view, this.getPos, () => this.node, true))
    if (this.handle) return
    this.dom.className = 'source-block'
    this.dom.setAttribute('role', 'group')
    this.dom.setAttribute('aria-label', this.ui.sourceBlock)
    const pre = document.createElement('pre')
    pre.textContent = source
    this.dom.appendChild(pre)
  }
  update(node: PMNode) {
    if (!isQueryCode(node)) return false
    const same = node.textContent === this.node.textContent && node.attrs.meta === this.node.attrs.meta
    this.node = node
    if (!same) this.render()
    return true
  }
  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode')
    this.handle?.selected(true)
  }
  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode')
    this.handle?.selected(false)
  }
  destroy() {
    this.handle?.destroy()
    this.handle = null
  }
  stopEvent(e: Event) {
    const el = e.target as HTMLElement | null
    if (el === this.dom) return false
    return e.type.startsWith('key') || e.type === 'beforeinput' || e.type === 'paste' || !!el?.closest?.('button, a, input, select, textarea, [role="menu"], [role="link"]')
  }
  ignoreMutation() {
    return true
  }
}

/** D-156, D-306: the alias, else the resolved title (or the target), with ` › subpath` as the read view shows it. */
function chipLabel(value: string, info: LinkInfo | undefined): string {
  const pipe = /\\?\|/.exec(value)
  if (pipe) return value.slice(pipe.index + pipe[0].length)
  const hash = value.indexOf('#')
  const target = hash >= 0 ? value.slice(0, hash) : value
  const sub = hash >= 0 ? value.slice(hash + 1) : ''
  if (!target && sub) return sub
  const ok = info && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed' || info.kind === 'media')
  const base = ok && info!.title ? info!.title : target
  return sub && !sub.startsWith('^') ? `${base} › ${sub}` : base
}

/** A link chip as in the read view: the target type's icon, then the shown text (FR-EDT-02 AC-16). */
class WikiLinkView implements NodeView {
  dom: HTMLElement
  private extraAttrs: string[] = []
  private media: EmbedHandle | null = null
  constructor(private node: PMNode, private ui: EditorUi) {
    this.dom = document.createElement('span')
    this.render()
  }
  destroy() {
    this.media?.destroy()
    this.media = null
  }
  private render() {
    const v = String(this.node.attrs.value)
    // 6A (R77): an inline file embed (`… a ![[Rozpočet.pdf]].`) is drawn by the app like a block one.
    if (this.node.attrs.embed && isAttachmentTarget(linkTarget(v).target) && this.ui.media) {
      this.dom.setAttribute('data-wikilink', v)
      this.dom.className = 'media-inline'
      if (this.media) { this.media.update(`![[${v}]]`); return }
      this.dom.replaceChildren()
      this.media = this.ui.media(`![[${v}]]`, this.dom, () => undefined) ?? null
      if (this.media) return
    }
    this.dom.setAttribute('data-wikilink', v)
    this.dom.replaceChildren()
    // Only what this view set before: a decoration owns `aria-description` of a broken chip.
    for (const a of this.extraAttrs) this.dom.removeAttribute(a)
    this.extraAttrs = []
    let suffix: Element | null = null
    if (!this.node.attrs.embed) {
      const info = this.ui.resolve(linkTarget(v).target)
      this.dom.setAttribute('data-link-kind', info?.kind ?? 'unresolved') // from the first paint (FR-LNK-07)
      const ok = info && (info.kind === 'note' || info.kind === 'daily' || info.kind === 'trashed' || info.kind === 'media')
      // 6A (R74): every chip says whether its target is live, broken or in the trash.
      this.dom.setAttribute('data-link-state', info?.kind === 'trashed' ? 'trashed' : ok ? 'ok' : 'broken')
      const extra = ok ? this.ui.chipExtra?.(info!) ?? null : null
      if (extra) {
        for (const [k, val] of Object.entries(extra.attrs)) { this.dom.setAttribute(k, val); this.extraAttrs.push(k) }
        suffix = extra.suffix
      }
      // Slice P (FR-LNK-11 AC-13): the mode's description after the chip's own (Unreviewed, In trash).
      const desc = [extra?.description, ok && info!.kind !== 'trashed' ? this.ui.linkHint?.() : null].filter(Boolean).join(', ')
      if (desc) { this.dom.setAttribute('aria-description', desc); this.extraAttrs.push('aria-description') }
      const icon = extra?.icon ?? (ok ? this.ui.chipIcon?.(info!.type ?? 'page') : null)
      if (icon) this.dom.appendChild(icon)
    }
    const chip = this.node.attrs.embed && !isAttachmentTarget(linkTarget(v).target) ? this.ui.embedChip?.(v) : undefined
    if (chip) {
      // 4F (D-418): an inline embed as a link-mode embed with the target type's icon.
      const icon = chip.state !== 'broken' ? this.ui.chipIcon?.(chip.type ?? 'page') : null
      if (icon) this.dom.appendChild(icon)
    }
    const label = document.createElement('span')
    label.setAttribute('data-user-content', '')
    label.textContent = chip ? chip.title : this.node.attrs.embed ? wikiLabel(v, true) : chipLabel(v, this.ui.resolve(linkTarget(v).target))
    this.dom.appendChild(label)
    if (suffix) this.dom.appendChild(suffix)
  }
  update(node: PMNode, decos: readonly Decoration[]) {
    if (node.type !== this.node.type) return false
    this.node = node
    void decos
    this.render()
    return true
  }
  ignoreMutation() {
    return true
  }
}

class ListItemView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private box: HTMLElement | null = null
  constructor(private node: PMNode, view: EditorView, getPos: () => number | undefined, label: string) {
    this.dom = document.createElement('li')
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'li-content'
    if (node.attrs.checked !== null) {
      this.dom.className = 'checklist-item'
      // Not a native input: WebKit restores a native checkbox's look after a prevented click, so the box showed the
      // old state while the file had the new one (bug_3c, FR-EDT-02 AC-18).
      const box = document.createElement('span')
      box.contentEditable = 'false'
      box.setAttribute('role', 'checkbox')
      box.setAttribute('aria-label', label)
      box.className = 'check'
      const toggle = (e: Event) => {
        e.preventDefault()
        const pos = getPos()
        if (pos === undefined) return
        const cur = view.state.doc.nodeAt(pos)
        if (!cur) return
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, checked: !cur.attrs.checked }))
      }
      box.addEventListener('mousedown', toggle)
      box.addEventListener('click', (e) => e.preventDefault())
      this.box = box
      this.render()
      this.dom.appendChild(box)
    }
    this.dom.appendChild(this.contentDOM)
  }
  private render() {
    if (!this.box) return
    const on = !!this.node.attrs.checked
    this.box.setAttribute('aria-checked', String(on))
    this.box.classList.toggle('on', on)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type || (node.attrs.checked === null) !== (this.node.attrs.checked === null)) return false
    this.node = node
    this.render()
    return true
  }
  stopEvent(e: Event) {
    return !!this.box && e.target === this.box
  }
  ignoreMutation(m: { target: Node; type: string }) {
    return !!this.box && m.target === this.box
  }
}


// ------------------------------------------------------------------------------------------------ slice MM

/** The node views of the open mindmap blocks, by their DOM, for `mindmapView` (mm-mindmap §3.2). */
export const mindmapViews = new WeakMap<HTMLElement, { setView(v: 'map' | 'list', focus?: boolean): void; current(): 'map' | 'list'; setLayout(l: MindmapLayout): boolean; redraw(): void }>()
/** The figure of the map that last had the focus, per editor (the palette's commands act on it, FR-UX-03 AC-15). */
export const focusedMindmap = new WeakMap<EditorView, HTMLElement>()

/** The live mindmap node view of each block, per editor: a redraw (a save sets the frontmatter attribute, which
 *  redraws the document) replaces node views, and a map's controls always act through the block's current one. */
const liveMindmaps = new WeakMap<EditorView, Map<number, CalloutView>>()
/** Slice OL (R172 rule 3, D-159): the folding callouts' views by their DOM, for `revealPos`; their fold, a view state
 *  never written, kept by position for a view that is created again in place. */
export const calloutFolds = new WeakMap<HTMLElement, { folded: boolean; setFolded(f: boolean): void }>()
const foldKept = new WeakMap<EditorView, Map<number, boolean>>()

type CalloutKind = 'callout' | 'mindmap' | 'hint'
/** Slice MM2: a located list item (`locate`). */
type Loc = { item: PMNode; pos: number; list: PMNode; listPos: number; index: number; parent: Loc | null; path: number[] }
function calloutKind(node: PMNode): CalloutKind {
  if (String(node.attrs.calloutType).toLowerCase() !== 'mindmap') return 'callout'
  const body: PMNode[] = []
  node.forEach((c, _o, i) => { if (i > 0) body.push(c) })
  return body.length === 1 && /List$/.test(body[0].type.name) ? 'mindmap' : 'hint'
}

/** The empty state (D-681): the list's only item has no text and no children. */
function emptyMindmap(node: PMNode): boolean {
  const list = node.childCount === 2 ? node.child(1) : null
  if (!list || list.childCount !== 1) return false
  const item = list.child(0)
  return item.childCount === 1 && item.child(0).type.name === 'paragraph' && item.child(0).content.size === 0
}

/** Callouts (FR-EDT-02 AC-19) as before; a `mindmap` callout holding one list is the R91 block, with its header, the
 *  `Map` / `List` switch and the app's map (D-684); one holding anything else shows the mindmap icon and the hint
 *  (D-680). The view and the fold are session state, never written (D-776). */
class CalloutView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private kind: CalloutKind
  private view: 'map' | 'list' = 'map'
  folded = false
  private handle: MindmapHandle | null = null
  /** Bug v0.123: the document's attributes changed in place (the note's title is the map's root); draw again. */
  redraw(): void { this.handle?.update() }
  private titleEl: HTMLElement | null = null
  private mapBtn: HTMLButtonElement | null = null
  private listBtn: HTMLButtonElement | null = null
  private foldBtn: HTMLButtonElement | null = null
  private mapBox: HTMLElement | null = null
  radios: Partial<Record<MindmapLayout, HTMLButtonElement>> = {}
  /** The map has (or had, before the DOM was replaced) the focus. */
  mapFocused = false
  /** The layout radio that has (or had) the focus. */
  headerFocus: MindmapLayout | null = null
  constructor(public node: PMNode, private pm: EditorView, private getPos: () => number | undefined, private ui: EditorUi) {
    this.kind = calloutKind(node)
    const type = String(node.attrs.calloutType).toLowerCase()
    const text = (k: Parameters<NonNullable<EditorUi['mindmapText']>>[0], title?: string) => ui.mindmapText?.(k, title) ?? k
    if (this.kind !== 'mindmap') {
      this.dom = document.createElement('div')
      this.dom.setAttribute('data-callout', type)
      this.dom.setAttribute('role', 'note')
      if (this.kind === 'hint') {
        this.dom.classList.add('mindmap-hint')
        const icon = ui.mindmapIcon?.()
        if (icon) { icon.classList.add('mindmap-hint-icon'); (icon as HTMLElement).contentEditable = 'false'; this.dom.appendChild(icon) }
        this.contentDOM = document.createElement('div')
        this.contentDOM.className = 'mindmap-hint-body'
        this.dom.appendChild(this.contentDOM)
        const hint = document.createElement('div')
        hint.className = 'mindmap-hint-text'
        hint.contentEditable = 'false'
        hint.textContent = text('notOneList')
        this.dom.appendChild(hint)
      } else if (node.attrs.fold === '+' || node.attrs.fold === '-') {
        // Slice OL (R172 rule 3, D-159): a folding callout (`[!type]-` / `+`) folds in the editor too, as view state
        // only: the `-` marker is never written by a fold, and nothing is a transaction.
        const kept = foldKept.get(pm)?.get(getPos() ?? -1)
        this.folded = kept ?? node.attrs.fold === '-'
        this.foldBtn = document.createElement('button')
        this.foldBtn.type = 'button'
        this.foldBtn.tabIndex = 0
        this.foldBtn.className = 'callout-fold'
        this.foldBtn.contentEditable = 'false'
        this.foldBtn.addEventListener('mousedown', (e) => e.preventDefault())
        this.foldBtn.addEventListener('click', (e) => { e.preventDefault(); this.setFolded(!this.folded) })
        this.dom.appendChild(this.foldBtn)
        this.contentDOM = document.createElement('div')
        this.contentDOM.className = 'callout-content'
        this.dom.appendChild(this.contentDOM)
        calloutFolds.set(this.dom, this)
        this.renderFold()
      } else this.contentDOM = this.dom
      return
    }
    const key = String(this.index())
    const live = () => liveMindmaps.get(pm)?.get(this.at) ?? this
    this.view = ui.mindmapState?.get(key) ?? 'map'
    this.folded = node.attrs.fold === '-'
    const fig = document.createElement('figure')
    fig.className = 'mindmap-block'
    fig.setAttribute('data-mindmap', '')
    fig.setAttribute('data-callout', 'mindmap')
    fig.style.setProperty('--mm-untitled', JSON.stringify(text('untitled')))
    fig.style.setProperty('--mm-empty', JSON.stringify(text('empty')))
    const head = document.createElement('div')
    head.className = 'mindmap-header'
    head.contentEditable = 'false'
    const icon = ui.mindmapIcon?.()
    if (icon) head.appendChild(icon)
    this.titleEl = document.createElement('span')
    this.titleEl.className = 'mindmap-title'
    // The `Mindmap` placeholder of an empty title: a click puts the caret in the title (List) (D-771).
    this.titleEl.addEventListener('mousedown', (e) => {
      if (this.view !== 'list') return
      e.preventDefault()
      const base = this.getPos()
      if (base === undefined) return
      this.pm.dispatch(this.pm.state.tr.setSelection(TextSelection.near(this.pm.state.doc.resolve(base + 2), 1)))
      this.pm.focus()
    })
    head.appendChild(this.titleEl)
    if (node.attrs.fold === '+' || node.attrs.fold === '-') {
      this.foldBtn = document.createElement('button')
      this.foldBtn.type = 'button'
      this.foldBtn.tabIndex = 0 // WebKit tabs only to buttons with a tabindex (as the app's own buttons)
      this.foldBtn.className = 'icon-button small mindmap-fold'
      this.foldBtn.addEventListener('mousedown', (e) => e.preventDefault())
      this.foldBtn.addEventListener('click', (e) => { e.preventDefault(); this.folded = !this.folded; this.render() })
      head.appendChild(this.foldBtn)
    }
    // Slice MM2 (R97, D-792): the layout switch, a radiogroup that is one Tab stop; absent in a read-only editor.
    if (pm.editable) {
      const lay = document.createElement('div')
      lay.setAttribute('role', 'radiogroup')
      lay.className = 'mindmap-layout'
      lay.setAttribute('aria-label', text('layout'))
      const radio = (l: MindmapLayout) => {
        const r = document.createElement('button')
        r.type = 'button'
        r.setAttribute('role', 'radio')
        r.className = 'mindmap-layout-radio'
        r.setAttribute('data-layout', l)
        r.setAttribute('data-command', l === 'right' ? 'mindmap.layoutRight' : 'mindmap.layoutSpider')
        r.setAttribute('aria-label', text(l === 'right' ? 'layoutRight' : 'layoutSpider'))
        r.title = text(l === 'right' ? 'layoutRight' : 'layoutSpider')
        r.innerHTML = l === 'right'
          ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="2.5" cy="7" r="2" fill="currentColor"/><path d="M4.5 7h3M7.5 7v-4h3M7.5 7h3M7.5 7v4h3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2" fill="currentColor"/><path d="M9 7h2.5M9 7v-3.5h2.5M9 7v3.5h2.5M5 7H2.5M5 7v-3.5H2.5M5 7v3.5H2.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
        r.addEventListener('mousedown', (e) => e.preventDefault())
        r.addEventListener('focus', () => { this.headerFocus = l })
        r.addEventListener('blur', () => { if (this.headerFocus === l) this.headerFocus = null })
        r.addEventListener('click', (e) => { e.preventDefault(); live().setLayout(l); live().radios[l]?.focus() })
        r.addEventListener('keydown', (e) => {
          // ← / ↑ check `right`, → / ↓ check `spider` (the radios' order); the checked radio keeps the focus.
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const to: MindmapLayout = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 'right' : 'spider'
            live().setLayout(to)
            live().radios[to]?.focus()
          }
        })
        lay.appendChild(r)
        return r
      }
      this.radios = { right: radio('right'), spider: radio('spider') }
      head.appendChild(lay)
    }
    const group = document.createElement('div')
    group.setAttribute('role', 'group')
    group.className = 'mindmap-switch'
    group.setAttribute('aria-label', text('view'))
    const btn = (v: 'map' | 'list') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.tabIndex = 0
      b.textContent = text(v)
      b.setAttribute('data-command', v === 'map' ? 'mindmap.showMap' : 'mindmap.showList')
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => { e.preventDefault(); this.setView(v, false) })
      group.appendChild(b)
      return b
    }
    this.mapBtn = btn('map')
    this.listBtn = btn('list')
    head.appendChild(group)
    fig.appendChild(head)
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'mindmap-list'
    fig.appendChild(this.contentDOM)
    this.mapBox = document.createElement('div')
    this.mapBox.className = 'mindmap-map'
    this.mapBox.contentEditable = 'false'
    this.mapBox.setAttribute('data-map-area', '')
    this.mapBox.addEventListener('focusin', () => { focusedMindmap.set(pm, fig); this.mapFocused = true })
    this.mapBox.addEventListener('focusout', (e) => { if (!this.mapBox!.contains(e.relatedTarget as Node | null)) this.mapFocused = false })
    fig.appendChild(this.mapBox)
    this.dom = fig
    mindmapViews.set(fig, this)
    // Slice MM2 (mm-mindmap §6.6): a save redraws the document, which re-creates every node view. This view adopts the
    // previous view's live map (its DOM and handle move over; the handle's control already resolves to the live view),
    // so the map keeps its focused node and an open field; a focused layout radio is focused again in the new header.
    const prev = liveMindmaps.get(pm)?.get(this.index())
    const adopted = prev && prev !== this && prev.kind === 'mindmap' && prev.handle?.adopt ? prev : null
    if (prev?.headerFocus) { const hf = prev.headerFocus; queueMicrotask(() => { if (this.dom.isConnected) this.radios[hf]?.focus() }) }
    this.register()
    const ctl: MindmapCtl = {
      markdown: () => live().markdown(),
      view: () => live().view,
      folded: () => live().folded,
      onNode: (path) => live().toItem(path),
      onLink: (target) => ui.onLink(target, null),
      readOnly: !pm.editable,
      // Slice MM2 (mm-mindmap §6.3): the stored layout (D-791) and the map's edits on this block (D-786).
      layout: () => layoutOf(live().node.attrs.calloutMeta as string | null),
      edit: pm.editable ? {
        source: (path) => live().source(path),
        setText: (path, md) => live().setText(path, md),
        insert: (at, where, md) => live().insert(at, where, md),
        remove: (path) => live().remove(path),
        move: (path, dir) => live().move(path, dir),
        undo: () => undo(pm.state, pm.dispatch),
        redo: () => redo(pm.state, pm.dispatch),
      } : null,
    }
    if (adopted && adopted.handle!.adopt!(this.mapBox)) {
      const handle = adopted.handle!
      adopted.handle = null
      this.handle = handle
      this.mapFocused = adopted.mapFocused
      // The old DOM was detached (the focus went with it); the new one is attached by PM in this same task, so the
      // map takes the focus back in a microtask, before any key event.
      if (this.mapFocused) queueMicrotask(() => { if (this.mapBox!.isConnected) handle.focusTree() })
      handle.update({ now: true })
    } else this.handle = ui.mindmap?.(this.mapBox, ctl) ?? null
    this.render()
  }
  /** Slice OL: a folding callout's fold (view state). */
  setFolded(f: boolean) {
    if (!this.foldBtn || this.kind !== 'callout' || f === this.folded) return
    this.folded = f
    const p = this.getPos()
    if (p !== undefined) {
      let m = foldKept.get(this.pm)
      if (!m) foldKept.set(this.pm, (m = new Map()))
      m.set(p, f)
    }
    this.renderFold()
  }
  private renderFold() {
    if (!this.foldBtn || this.kind !== 'callout') return
    const text = (k: 'expand' | 'collapse', title: string) => this.ui.mindmapText?.(k, title) ?? `${k} ${title}`
    const type = String(this.node.attrs.calloutType)
    const title = this.node.firstChild?.textContent.trim() || (this.ui.calloutLabel?.(type) ?? type)
    this.dom.toggleAttribute('data-folded', this.folded)
    this.foldBtn.setAttribute('aria-label', text(this.folded ? 'expand' : 'collapse', title))
    this.foldBtn.setAttribute('aria-expanded', String(!this.folded))
    this.foldBtn.textContent = this.folded ? '›' : '⌄'
  }
  private at = -1
  private register() {
    this.at = this.index()
    let m = liveMindmaps.get(this.pm)
    if (!m) liveMindmaps.set(this.pm, (m = new Map()))
    m.set(this.at, this)
  }
  private index(): number {
    const p = this.getPos()
    return p === undefined ? -1 : this.pm.state.doc.resolve(p).index(0)
  }
  private markdown(): string {
    try { return renderBlock(pmToBlock(this.node.toJSON()) as RootContent) } catch { return '' }
  }
  private render() {
    if (this.kind !== 'mindmap') return
    const text = (k: Parameters<NonNullable<EditorUi['mindmapText']>>[0], title?: string) => this.ui.mindmapText?.(k, title) ?? k
    const title = this.node.firstChild?.textContent.trim() ?? ''
    this.dom.setAttribute('aria-label', title ? text('figure', title) : text('untitled'))
    this.dom.setAttribute('data-view', this.view)
    this.dom.classList.toggle('mm-view-list', this.view === 'list')
    this.dom.classList.toggle('mm-view-map', this.view === 'map')
    this.dom.classList.toggle('mm-folded', this.folded)
    this.dom.classList.toggle('mm-empty', emptyMindmap(this.node))
    // In List the title is edited in place, so the header shows only the `Mindmap` placeholder of an empty title.
    this.titleEl!.textContent = this.view === 'list' && title ? '' : title || text('untitled')
    this.dom.classList.toggle('mm-untitled', !title)
    this.titleEl!.classList.toggle('untitled', !title)
    if (title) this.titleEl!.setAttribute('data-user-content', '')
    else this.titleEl!.removeAttribute('data-user-content')
    this.mapBtn!.setAttribute('aria-pressed', String(this.view === 'map'))
    this.listBtn!.setAttribute('aria-pressed', String(this.view === 'list'))
    const layout = layoutOf(this.node.attrs.calloutMeta as string | null)
    this.dom.setAttribute('data-layout', layout)
    for (const l of ['right', 'spider'] as const) {
      const r = this.radios[l]
      if (!r) continue
      r.setAttribute('aria-checked', String(layout === l))
      r.tabIndex = layout === l ? 0 : -1
    }
    if (this.foldBtn) {
      this.foldBtn.setAttribute('aria-label', text(this.folded ? 'expand' : 'collapse', title || text('untitled')))
      this.foldBtn.setAttribute('aria-expanded', String(!this.folded))
      this.foldBtn.textContent = this.folded ? '›' : '⌄'
    }
    this.handle?.update()
  }
  current(): 'map' | 'list' {
    return this.view
  }
  /** Switches the view (session state, D-776); `focus`: Map focuses the tree, List puts the caret in the root item. */
  setView(v: 'map' | 'list', focus = false) {
    this.view = v
    this.folded = false
    this.ui.mindmapState?.set(String(this.index()), v)
    this.render()
    // The palette (`focus`) puts the caret in the root item (FR-UX-03 AC-15); the `List` button at the end of the
    // header title, where it is edited (D-771), or in the root item when there is no title.
    if (v === 'list') {
      // D-794: with a focused node, the caret goes to the end of that node's item (null: the synthesized root).
      const fp = this.handle?.focusedNode?.()
      if (fp !== undefined) { this.toItem(fp, focus); return }
      const title = this.node.firstChild
      const base = this.getPos()
      if (!focus && title && title.content.size > 0 && base !== undefined) {
        this.pm.dispatch(this.pm.state.tr.setSelection(TextSelection.near(this.pm.state.doc.resolve(base + 1 + title.nodeSize - 1), -1)))
        this.pm.focus()
      } else this.toItem([0], focus)
    } else if (focus) {
      // A palette command: the tree takes the focus, and the closing palette leaves it there (FR-UX-03 AC-15, D-139).
      this.handle?.focusTree()
    }
  }
  /** D-776: a node click switches to List with the caret at the end of that item (`null`: the synthesized root, D-771). */
  private toItem(path: number[] | null, _focus = true) {
    if (path !== null && path.length === 0) path = null // §6.7: `[]` is the synthesized root
    if (this.view !== 'list') {
      this.view = 'list'
      this.ui.mindmapState?.set(String(this.index()), 'list')
      this.render()
    }
    const base = this.getPos()
    if (base === undefined) return
    const node = this.node
    let target: number | null = null
    let atStart = false
    if (path === null) {
      // The synthesized root: the end of the title, or the start of the first item when the root is the note title.
      if (node.firstChild && node.firstChild.content.size > 0) target = base + 1 + node.firstChild.nodeSize - 1
      else { path = [0]; atStart = true }
    }
    if (path !== null) {
      let pos = base + 1 + node.firstChild!.nodeSize
      let list: PMNode = node.child(1)
      let item: PMNode | null = null
      let itemPos = pos
      for (let depth = 0; depth < path.length; depth++) {
        // Children of an item come from every list directly inside it (D-774).
        const lists: { n: PMNode; pos: number }[] = []
        if (depth === 0) lists.push({ n: list, pos })
        else {
          let p = itemPos + 1
          item!.forEach((c) => { if (/List$/.test(c.type.name)) lists.push({ n: c, pos: p }); p += c.nodeSize })
        }
        let want = path[depth]
        let found = false
        for (const l of lists) {
          if (want < l.n.childCount) {
            let p = l.pos + 1
            for (let k = 0; k < want; k++) p += l.n.child(k).nodeSize
            item = l.n.child(want)
            itemPos = p
            found = true
            break
          }
          want -= l.n.childCount
        }
        if (!found) break
        list = item!
      }
      if (item) target = atStart ? itemPos + 2 : itemPos + 1 + (item.firstChild?.nodeSize ?? 2) - 1
    }
    if (target === null) return
    const tr = this.pm.state.tr.setSelection(TextSelection.near(this.pm.state.doc.resolve(target), atStart ? 1 : -1))
    this.pm.dispatch(tr.scrollIntoView())
    this.pm.focus()
  }
  // ---------------------------------------------------------------------------------------- slice MM2: edits (§6.3)

  /** The item at a tree path (D-774: an item's children come from every list directly inside it), with the list that
   *  holds it and its index there; null for a missing path. Positions are those of `this.pm.state.doc`. */
  private locate(path: number[]): Loc | null {
    const base = this.getPos()
    const node = this.node
    if (base === undefined || node.childCount < 2 || path.length === 0) return null
    let lists: { n: PMNode; pos: number }[] = [{ n: node.child(1), pos: base + 1 + node.firstChild!.nodeSize }]
    let parent: Loc | null = null
    let loc: Loc | null = null
    for (let depth = 0; depth < path.length; depth++) {
      let want = path[depth]
      let found: Loc | null = null
      for (const l of lists) {
        if (want < l.n.childCount) {
          let p = l.pos + 1
          for (let k = 0; k < want; k++) p += l.n.child(k).nodeSize
          found = { item: l.n.child(want), pos: p, list: l.n, listPos: l.pos, index: want, parent, path: path.slice(0, depth + 1) }
          break
        }
        want -= l.n.childCount
      }
      if (!found) return null
      loc = found
      parent = found
      lists = []
      let p = found.pos + 1
      found.item.forEach((c) => { if (/List$/.test(c.type.name)) lists.push({ n: c, pos: p }); p += c.nodeSize })
    }
    return loc
  }
  /** The lists directly inside an item, with their positions. */
  private innerLists(item: PMNode, itemPos: number): { n: PMNode; pos: number }[] {
    const out: { n: PMNode; pos: number }[] = []
    let p = itemPos + 1
    item.forEach((c) => { if (/List$/.test(c.type.name)) out.push({ n: c, pos: p }); p += c.nodeSize })
    return out
  }
  private childCount(item: PMNode): number {
    let n = 0
    item.forEach((c) => { if (/List$/.test(c.type.name)) n += c.childCount })
    return n
  }
  /** The root is the single top-level item (D-681); its path is [0]. */
  private rootIsItem(): boolean {
    return this.node.childCount >= 2 && this.node.child(1).childCount === 1
  }
  private paragraphJson(md: string): JSONContent {
    const tree = markdownTree(md)
    const first = tree.children[0]
    if (first && first.type === 'paragraph') return blockToPM(first, md)
    return { type: 'paragraph', content: md ? [{ type: 'text', text: md }] : [] }
  }
  private listItemJson(md: string): JSONContent {
    return { type: 'listItem', attrs: { checked: null, spread: false }, content: [this.paragraphJson(md)] }
  }
  private applied(tr: Transaction): void {
    this.pm.dispatch(tr)
    // D-786: the map is updated at once, not after the 150 ms live delay.
    const l = liveMindmaps.get(this.pm)?.get(this.at) ?? this
    l.handle?.update({ now: true })
  }
  /** R95a: the first paragraph's Markdown source (NFC), null for a missing path. */
  source(path: number[]): string | null {
    const loc = this.locate(path)
    const para = loc?.item.firstChild
    if (!loc || !para || para.type.name !== 'paragraph') return null
    return renderBlock(pmToBlock(para.toJSON()) as RootContent).replace(/\n$/, '').normalize('NFC')
  }
  /** W17, W17a, W22: replaces the first paragraph's inline content; false when unchanged or missing. */
  setText(path: number[], md: string): boolean {
    const loc = this.locate(path)
    const para = loc?.item.firstChild
    if (!loc || !para || para.type.name !== 'paragraph') return false
    const next = this.pm.state.schema.nodeFromJSON(this.paragraphJson(md.normalize('NFC')))
    if (next.content.eq(para.content)) return false
    const at = loc.pos + 1
    this.applied(this.pm.state.tr.replaceWith(at, at + para.nodeSize, next))
    return true
  }
  /** D-787, D-795: a new item with its text, in one step; returns its path. */
  insert(at: number[] | null, where: 'sibling' | 'child', md: string): number[] | null {
    if (md.trim() === '') return null
    const base = this.getPos()
    if (base === undefined || this.node.childCount < 2) return null
    const item = this.pm.state.schema.nodeFromJSON(this.listItemJson(md.normalize('NFC')))
    const top = { n: this.node.child(1), pos: base + 1 + this.node.firstChild!.nodeSize }
    if (at === null) {
      // The synthesized root: a new top-level item at the end.
      this.applied(this.pm.state.tr.insert(top.pos + 1 + top.n.content.size, item))
      // `top.n` is the list before the insert: its old count is the new item's index.
      return [top.n.childCount]
    }
    const loc = this.locate(at)
    if (!loc) return null
    const asChild = where === 'child' || (at.length === 1 && this.rootIsItem())
    if (!asChild) {
      this.applied(this.pm.state.tr.insert(loc.pos + loc.item.nodeSize, item))
      return [...at.slice(0, -1), at[at.length - 1] + 1]
    }
    const lists = this.innerLists(loc.item, loc.pos)
    const n = this.childCount(loc.item)
    if (where === 'child') {
      if (lists.length) {
        const last = lists[lists.length - 1]
        this.applied(this.pm.state.tr.insert(last.pos + 1 + last.n.content.size, item))
      } else {
        const list = loc.list.type.create(loc.list.attrs, item)
        this.applied(this.pm.state.tr.insert(loc.pos + 1 + loc.item.content.size, list))
      }
      return [...at, n]
    }
    // ⏎ on the root item: its first child (D-787).
    if (lists.length) this.applied(this.pm.state.tr.insert(lists[0].pos + 1, item))
    else this.applied(this.pm.state.tr.insert(loc.pos + 1 + loc.item.content.size, loc.list.type.create(loc.list.attrs, item)))
    return [...at, 0]
  }
  /** D-787: removes a node without children; returns the path to focus (the previous sibling, else the parent). */
  remove(path: number[]): number[] | null {
    const loc = this.locate(path)
    if (!loc || this.childCount(loc.item) > 0) return null
    if (path.length === 1 && this.rootIsItem()) return null
    const tr = this.pm.state.tr
    if (loc.list.childCount === 1) tr.delete(loc.listPos, loc.listPos + loc.list.nodeSize)
    else tr.delete(loc.pos, loc.pos + loc.item.nodeSize)
    this.applied(tr)
    const i = path[path.length - 1]
    // §6.7: `[]` is the synthesized root (the first top-level item had no previous sibling).
    return i > 0 ? [...path.slice(0, -1), i - 1] : path.slice(0, -1)
  }
  /** W19…W21: among the siblings, under the previous sibling, after the parent; null when impossible. */
  move(path: number[], dir: 'up' | 'down' | 'in' | 'out'): number[] | null {
    const loc = this.locate(path)
    if (!loc) return null
    if (path.length === 1 && this.rootIsItem()) return null
    const i = path[path.length - 1]
    const tr = this.pm.state.tr
    if (dir === 'up' || dir === 'down') {
      const j = loc.index + (dir === 'up' ? -1 : 1)
      if (j < 0 || j >= loc.list.childCount) return null
      const other = loc.list.child(j)
      tr.delete(loc.pos, loc.pos + loc.item.nodeSize)
      tr.insert(dir === 'down' ? loc.pos + other.nodeSize : loc.pos - other.nodeSize, loc.item)
      this.applied(tr)
      return [...path.slice(0, -1), i + (dir === 'up' ? -1 : 1)]
    }
    if (dir === 'in') {
      if (loc.index === 0) return null
      const prev = loc.list.child(loc.index - 1)
      const prevPos = loc.pos - prev.nodeSize
      const lists = this.innerLists(prev, prevPos)
      const n = this.childCount(prev)
      tr.delete(loc.pos, loc.pos + loc.item.nodeSize)
      if (lists.length) {
        const last = lists[lists.length - 1]
        tr.insert(last.pos + 1 + last.n.content.size, loc.item)
      } else tr.insert(prevPos + 1 + prev.content.size, loc.list.type.create(loc.list.attrs, loc.item))
      this.applied(tr)
      return [...path.slice(0, -1), i - 1, n]
    }
    // out
    const parent = loc.parent
    if (!parent || (parent.path.length === 1 && this.rootIsItem())) return null
    const parentEnd = parent.pos + parent.item.nodeSize
    if (loc.list.childCount === 1) tr.delete(loc.listPos, loc.listPos + loc.list.nodeSize)
    else tr.delete(loc.pos, loc.pos + loc.item.nodeSize)
    tr.insert(tr.mapping.map(parentEnd), loc.item)
    this.applied(tr)
    const pi = parent.path[parent.path.length - 1]
    return [...parent.path.slice(0, -1), pi + 1]
  }
  /** D-791, D-792 (W12…W13): the layout as callout metadata; false when already so. */
  setLayout(l: MindmapLayout): boolean {
    if (this.kind !== 'mindmap') return false
    const meta = this.node.attrs.calloutMeta as string | null
    if (layoutOf(meta) === l) return false
    const pos = this.getPos()
    if (pos === undefined) return false
    this.applied(this.pm.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, calloutMeta: l === 'spider' ? 'spider' : null }))
    return true
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || calloutKind(node) !== this.kind) return false
    if (this.kind !== 'mindmap' && String(node.attrs.calloutType).toLowerCase() !== String(this.node.attrs.calloutType).toLowerCase()) return false
    // A fold marker added or removed changes the view's structure: built again.
    if (this.kind === 'callout' && !!this.foldBtn !== (node.attrs.fold === '+' || node.attrs.fold === '-')) return false
    this.node = node
    if (this.kind === 'mindmap') this.register()
    this.render()
    this.renderFold()
    return true
  }
  stopEvent(e: Event) {
    if (this.foldBtn && !!(e.target as Node | null) && this.foldBtn.contains(e.target as Node)) return true
    return this.kind === 'mindmap' && !!(e.target as Node | null) && (this.mapBox!.contains(e.target as Node) || this.dom.querySelector('.mindmap-header')!.contains(e.target as Node))
  }
  ignoreMutation(m: { target: Node; type: string }) {
    if (this.kind === 'mindmap') return !this.contentDOM.contains(m.target) || m.target === this.contentDOM && m.type === 'attributes'
    if (this.kind === 'hint') return !this.contentDOM.contains(m.target)
    if (this.foldBtn) return !this.contentDOM.contains(m.target) || (m.target === this.dom && m.type === 'attributes')
    return false
  }
  destroy() {
    this.handle?.destroy()
    // A stale registry entry would be adopted by a later block at this index (mm-mindmap §6.7): once the same-task
    // re-creation (if any) has registered itself, an entry that still names this view is dropped.
    queueMicrotask(() => { const m = liveMindmaps.get(this.pm); if (m?.get(this.at) === this) m.delete(this.at) })
  }
}

/** A Markdown link URL that names a note in the vault (relative, no scheme, not an attachment): its decoded path and
 *  fragment, as the read view resolves it (ms3-shell §11.1). */
export function noteHref(url: string): { target: string; fragment: string | null } | null {
  if (!url || url.startsWith('#') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) || url.startsWith('//')) return null
  const hash = url.indexOf('#')
  const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const target = dec(hash < 0 ? url : url.slice(0, hash)).normalize('NFC')
  if (!target || isAttachmentTarget(target)) return null
  return { target, fragment: hash < 0 ? null : dec(url.slice(hash + 1)) || null }
}

/** The last click reported on a chip per editor (its position and time). */
const lastClick = new WeakMap<EditorView, { pos: number; at: number }>()
/** The second click of a double-click on the chip just clicked: the double-click opens, so it reports nothing. */
function secondClick(view: EditorView, pos: number, event: MouseEvent): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  const last = lastClick.get(view)
  lastClick.set(view, { pos, at: now })
  return event.detail > 1 && !(event.metaKey || event.ctrlKey) && !!last && last.pos === pos && now - last.at < 600
}

/** Editors whose last double-click on a chip was already reported from the mousedown. */
const dblReported = new WeakSet<EditorView>()

/** The chip each editor's pointer is over (hover mode, D-942). */
const hovered = new WeakMap<EditorView, { target: string; fragment: string | null; pos: number; dom: HTMLElement }>()

export function presentation(ui: EditorUi) {
  return Extension.create({
    name: 'teggPresentation',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: uiRefresh,
          state: {
            init: (_c, state) => decorations(state.doc, ui),
            apply: (tr, old) => (tr.docChanged || tr.getMeta(uiRefresh) ? decorations(tr.doc, ui) : old.map(tr.mapping, tr.doc)),
          },
          props: {
            decorations(state) {
              const set = uiRefresh.getState(state) as DecorationSet
              // FR-EDT-01 AC-9 (and AC-14, D-1356): the hint also shows in an empty top-level paragraph holding the caret.
              const { $from, empty } = state.selection
              const doc = state.doc
              if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return set
              if (doc.childCount === 1) return set // the empty note's hint is already there
              return set.add(doc, [Decoration.widget($from.pos, (view) => hintElement(view, ui.hint), { side: 1, ignoreSelection: true, key: 'hint-caret' })])
            },
            nodeViews: {
              callout: (node, view, getPos) => new CalloutView(node, view, getPos as () => number | undefined, ui),
              rawBlock: (node, view, getPos) => new RawBlockView(node, ui, getPos as () => number | undefined, view),
              // Slice Q (D-1470): a nested `query` fence is drawn through the same hook, with no content DOM.
              codeBlock: ((node: PMNode, view: EditorView, getPos: () => number | undefined) =>
                (isQueryCode(node) && ui.query ? new QueryCodeView(node, ui, getPos, view) : null)) as unknown as NodeViewConstructor,
              wikiLink: (node) => new WikiLinkView(node, ui),
              listItem: (node, view, getPos) => new ListItemView(node, view, getPos as () => number | undefined, ui.checkbox ?? 'Done'),
            },
            handleClickOn(view, _pos, node, nodePos, event) {
              if (event.button !== 0) return false
              if (isLinkChip(node, ui)) {
                // Links and inline embeds (link mode, D-423) report the gesture (v1-previews §5.1). A click leaves a
                // collapsed caret right after the chip, never a node selection (D-926); the second click of a
                // double-click is the double-click's.
                const { target, fragment } = linkTarget(String(node.attrs.value))
                if (secondClick(view, nodePos, event)) return true
                const mod = event.metaKey || event.ctrlKey
                if (!mod) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, nodePos + node.nodeSize)))
                ui.onLink(target, fragment, { pos: nodePos, dom: view.nodeDOM(nodePos) as HTMLElement | null }, mod ? 'modClick' : 'click')
                return true
              }
              if (node.type.name === 'tag') {
                if (secondClick(view, nodePos, event)) return true
                const mod = event.metaKey || event.ctrlKey
                // The caret isn't moved after a tag: there it would open the `#` suggestions (FR-EDT-15).
                ui.onTag(String(node.attrs.value), { pos: nodePos, dom: view.nodeDOM(nodePos) as HTMLElement | null }, mod ? 'modClick' : 'click')
                return true
              }
              void view
              return false
            },
            handleDoubleClickOn(view, _pos, node, nodePos, event) {
              // ProseMirror tells a double-click by time and place; the browser's count is the user's (a frozen clock
              // in tests made two clicks seconds apart a double-click).
              if (event.button !== 0 || (node.type.name !== 'tag' && !isLinkChip(node, ui))) return false
              // ProseMirror counts by its clock; when the browser counts one click it is a click (a frozen test clock).
              if (event.detail < 2) return !!view.someProp('handleClickOn', (f) => f(view, _pos, node, nodePos, event, true))
              dblReported.add(view)
              const chip = { pos: nodePos, dom: view.nodeDOM(nodePos) as HTMLElement | null }
              if (node.type.name === 'tag') ui.onTag(String(node.attrs.value), chip, 'dblclick')
              else { const { target, fragment } = linkTarget(String(node.attrs.value)); ui.onLink(target, fragment, chip, 'dblclick') }
              return true
            },
            handleTripleClickOn(view, _pos, node, nodePos, event) {
              // As the double-click: ProseMirror's clock can count three clicks the browser counts as one or two.
              if (event.button !== 0 || (node.type.name !== 'tag' && !isLinkChip(node, ui))) return false
              if (event.detail < 2) return !!view.someProp('handleClickOn', (f) => f(view, _pos, node, nodePos, event, true))
              if (event.detail < 3) return !!view.someProp('handleDoubleClickOn', (f) => f(view, _pos, node, nodePos, event, true))
              return true
            },
            handleKeyDown(view, event) {
              // FR-LNK-13 AC-1, AC-4 (D-926): ← and → move over a chip as one position (never a node selection).
              if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                const sel = view.state.selection
                const left = event.key === 'ArrowLeft'
                if (sel instanceof NodeSelection && isLinkChip(sel.node, ui)) {
                  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, left ? sel.from : sel.to)))
                  return true
                }
                if (sel.empty) {
                  const n = left ? sel.$from.nodeBefore : sel.$from.nodeAfter
                  if (isLinkChip(n, ui)) {
                    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, left ? sel.from - n!.nodeSize : sel.from + n!.nodeSize)))
                    return true
                  }
                }
              }
              // ⌥Space at a chip previews (D-928); elsewhere it types what macOS gives. ⌘↩ at a chip opens (D-209).
              const alt = event.altKey && !event.metaKey && !event.ctrlKey && (event.code === 'Space' || event.key === ' ' || event.key === '\u00a0')
              const modEnter = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'Enter'
              if (!alt && !modEnter) return false
              const c = chipAtCaret(view.state, ui)
              if (!c) return false
              const { target, fragment } = linkTarget(String(c.node.attrs.value))
              ui.onLink(target, fragment, { pos: c.pos, dom: view.nodeDOM(c.pos) as HTMLElement | null }, alt ? 'altSpace' : 'modEnter')
              return true
            },
            handleDOMEvents: {
              contextmenu(view, event) {
                if (!ui.onLinkMenu) return false
                const el = (event.target as HTMLElement | null)?.closest?.('.link-chip, [data-embed-mode="link"]') as HTMLElement | null
                if (!el || !view.dom.contains(el)) return false
                let pos: number
                try { pos = view.posAtDOM(el, 0) } catch { return false }
                const node = view.state.doc.nodeAt(pos)
                const at = node && isLinkChip(node, ui) ? pos : isLinkChip(view.state.doc.nodeAt(pos - 1), ui) ? pos - 1 : -1
                if (at < 0) return false
                const n = view.state.doc.nodeAt(at)!
                const { target } = linkTarget(String(n.attrs.value))
                if (!ui.onLinkMenu(target, { pos: at, dom: el }, event)) return false
                event.preventDefault()
                return true
              },
              mousemove(view, event) {
                if (!ui.onLinkHover) return false
                const el = (event.target as HTMLElement | null)?.closest?.('.link-chip, [data-embed-mode="link"]') as HTMLElement | null
                const prev = hovered.get(view)
                if (prev && prev.dom !== el) { hovered.delete(view); ui.onLinkHover(prev.target, prev.fragment, { pos: prev.pos, dom: prev.dom }, 'leave') }
                if (!el || !view.dom.contains(el)) return false
                let pos: number
                try { pos = view.posAtDOM(el, 0) } catch { return false }
                const at = isLinkChip(view.state.doc.nodeAt(pos), ui) ? pos : isLinkChip(view.state.doc.nodeAt(pos - 1), ui) ? pos - 1 : -1
                if (at < 0) return false
                const { target, fragment } = linkTarget(String(view.state.doc.nodeAt(at)!.attrs.value))
                const first = !prev || prev.dom !== el
                hovered.set(view, { target, fragment, pos: at, dom: el })
                ui.onLinkHover(target, fragment, { pos: at, dom: el }, first ? 'enter' : 'move')
                return false
              },
              mouseleave(view) {
                const prev = hovered.get(view)
                if (prev && ui.onLinkHover) { hovered.delete(view); ui.onLinkHover(prev.target, prev.fragment, { pos: prev.pos, dom: prev.dom }, 'leave') }
                return false
              },
              click(view, event) {
                const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
                if (!a) return false
                event.preventDefault()
                const href = a.getAttribute('href') ?? ''
                // Slice P (R104 row 1): a Markdown link to a note is a link chip; any other URL opens outside.
                const note = noteHref(href)
                if (note && event.button === 0) {
                  if (event.detail > 1 && !(event.metaKey || event.ctrlKey)) return true
                  let pos = 0
                  try { pos = view.posAtDOM(a, 0) } catch { /* keep 0 */ }
                  ui.onLink(note.target, note.fragment, { pos, dom: a }, event.metaKey || event.ctrlKey ? 'modClick' : 'click')
                  return true
                }
                ui.onExternal(href)
                return true
              },
              dblclick(view, event) {
                if (dblReported.delete(view)) return false
                const chipEl = (event.target as HTMLElement | null)?.closest?.('.link-chip, .tag-chip, [data-embed-mode="link"]') as HTMLElement | null
                if (chipEl && view.dom.contains(chipEl)) {
                  let pos = -1
                  try { pos = view.posAtDOM(chipEl, 0) } catch { /* not ours */ }
                  const at = [pos, pos - 1].find((p) => p >= 0 && (isLinkChip(view.state.doc.nodeAt(p), ui) || view.state.doc.nodeAt(p)?.type.name === 'tag'))
                  if (at !== undefined) {
                    const n = view.state.doc.nodeAt(at)!
                    const chip = { pos: at, dom: chipEl }
                    event.preventDefault()
                    if (n.type.name === 'tag') ui.onTag(String(n.attrs.value), chip, 'dblclick')
                    else { const { target, fragment } = linkTarget(String(n.attrs.value)); ui.onLink(target, fragment, chip, 'dblclick') }
                    return true
                  }
                }
                const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
                const note = a ? noteHref(a.getAttribute('href') ?? '') : null
                if (!a || !note) return false
                event.preventDefault()
                let pos = 0
                try { pos = view.posAtDOM(a, 0) } catch { /* keep 0 */ }
                ui.onLink(note.target, note.fragment, { pos, dom: a }, 'dblclick')
                return true
              },
            },
          },
        }),
      ]
    },
  })
}

/** The hint of an empty body (FR-EDT-01 AC-9; 5A-2 `emptyHint`): never part of the text; a click on it puts the caret
 *  in the empty paragraph (the Task card's `Add details…`, FR-CNV-05 AC-6). */
export function hintElement(view: EditorView, text: string): HTMLElement {
  const s = document.createElement('span')
  s.className = 'editor-hint'
  s.contentEditable = 'false'
  s.setAttribute('aria-hidden', 'true')
  s.textContent = text
  s.addEventListener('mousedown', (e) => {
    e.preventDefault()
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(1))))
  })
  return s
}
