// How the editor shows non-text syntax (ms3-shell §13.5): link chips with their resolution (D-140, D-142), source
// blocks and placeholders (FR-EDT-01 AC-8, R5), checklist checkboxes (FR-EDT-02 AC-18) and the empty-note hint
// (FR-EDT-01 AC-9). Every text comes from the app (`EditorUi`), so the strings stay in its catalog (NFR-OTH-02).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'
import { displayTable, isAttachmentTarget, renderBlock } from '@tegg/doc'
import type { RootContent } from 'mdast'
import { pmToBlock } from './convert'
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
}
export type MindmapHandle = { update(): void; focusTree(): void; destroy(): void }

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
  mindmapText?: (key: 'figure' | 'untitled' | 'view' | 'map' | 'list' | 'empty' | 'notOneList' | 'expand' | 'collapse', title?: string) => string
  /** Slice MM: the mindmap icon (`data-icon="mindmap"`). */
  mindmapIcon?: () => Element
  /** Name and visible text of the placeholder for an embed (`![[…]]`), a query or a mindmap block (R5). */
  placeholder(kind: 'embed' | 'query' | 'mindmap', value: string): { name: string; text: string; id?: string; note?: boolean }
  /** `chip`: where the clicked chip is (its node position and DOM), for the Create offer of a broken link (4A). */
  onLink(target: string, fragment: string | null, chip?: { pos: number; dom: HTMLElement | null }): void
  onTag(value: string): void
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
            'data-embed-state': chip.state, 'aria-label': chip.title, 'aria-description': chip.description,
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
      }))
      return false
    }
    if (node.type.name === 'tag') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'link', class: 'chip tag-chip' }))
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
  constructor(private node: PMNode, private ui: EditorUi, private getPos: () => number | undefined) {
    this.dom = document.createElement('div')
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('draggable', 'false')
    this.render()
  }
  private render() {
    const { node, ui } = this
    const kind = String(node.attrs.kind)
    const source = String(node.attrs.source)
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
    if (kind === 'embed' || kind === 'query' || kind === 'mindmap') {
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
      this.ui.onLink(target, fragment, { pos: this.getPos() ?? 0, dom: chip })
    })
    this.dom.appendChild(chip)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    if (this.handle && String(node.attrs.kind) !== 'embed') return false
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
        if (extra.description) { this.dom.setAttribute('aria-description', extra.description); this.extraAttrs.push('aria-description') }
        suffix = extra.suffix
      }
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
export const mindmapViews = new WeakMap<HTMLElement, { setView(v: 'map' | 'list', focus?: boolean): void; current(): 'map' | 'list' }>()
/** The figure of the map that last had the focus, per editor (the palette's commands act on it, FR-UX-03 AC-15). */
export const focusedMindmap = new WeakMap<EditorView, HTMLElement>()

/** The live mindmap node view of each block, per editor: a redraw (a save sets the frontmatter attribute, which
 *  redraws the document) replaces node views, and a map's controls always act through the block's current one. */
const liveMindmaps = new WeakMap<EditorView, Map<number, CalloutView>>()

type CalloutKind = 'callout' | 'mindmap' | 'hint'
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
  private titleEl: HTMLElement | null = null
  private mapBtn: HTMLButtonElement | null = null
  private listBtn: HTMLButtonElement | null = null
  private foldBtn: HTMLButtonElement | null = null
  private mapBox: HTMLElement | null = null
  constructor(private node: PMNode, private pm: EditorView, private getPos: () => number | undefined, private ui: EditorUi) {
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
      } else this.contentDOM = this.dom
      return
    }
    const key = String(this.index())
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
    this.mapBox.addEventListener('focusin', () => focusedMindmap.set(pm, fig))
    fig.appendChild(this.mapBox)
    this.dom = fig
    mindmapViews.set(fig, this)
    this.register()
    const live = () => liveMindmaps.get(pm)?.get(this.at) ?? this
    this.handle = ui.mindmap?.(this.mapBox, {
      markdown: () => live().markdown(),
      view: () => live().view,
      folded: () => live().folded,
      onNode: (path) => live().toItem(path),
      onLink: (target) => ui.onLink(target, null),
      readOnly: !pm.editable,
    }) ?? null
    this.render()
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
      const title = this.node.firstChild
      const base = this.getPos()
      if (!focus && title && title.content.size > 0 && base !== undefined) {
        this.pm.dispatch(this.pm.state.tr.setSelection(TextSelection.near(this.pm.state.doc.resolve(base + 1 + title.nodeSize - 1), -1)))
        this.pm.focus()
      } else this.toItem([0], focus)
    } else if (focus) {
      // After a palette command the palette gives the focus back; the tree takes it after that (FR-UX-03 AC-15).
      this.handle?.focusTree()
    }
  }
  /** D-776: a node click switches to List with the caret at the end of that item (`null`: the synthesized root, D-771). */
  private toItem(path: number[] | null, _focus = true) {
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
  update(node: PMNode) {
    if (node.type !== this.node.type || calloutKind(node) !== this.kind) return false
    if (this.kind !== 'mindmap' && String(node.attrs.calloutType).toLowerCase() !== String(this.node.attrs.calloutType).toLowerCase()) return false
    this.node = node
    if (this.kind === 'mindmap') this.register()
    this.render()
    return true
  }
  stopEvent(e: Event) {
    return this.kind === 'mindmap' && !!(e.target as Node | null) && (this.mapBox!.contains(e.target as Node) || this.dom.querySelector('.mindmap-header')!.contains(e.target as Node))
  }
  ignoreMutation(m: { target: Node; type: string }) {
    if (this.kind === 'mindmap') return !this.contentDOM.contains(m.target) || m.target === this.contentDOM && m.type === 'attributes'
    if (this.kind === 'hint') return !this.contentDOM.contains(m.target)
    return false
  }
  destroy() {
    this.handle?.destroy()
  }
}

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
              return uiRefresh.getState(state) as DecorationSet
            },
            nodeViews: {
              callout: (node, view, getPos) => new CalloutView(node, view, getPos as () => number | undefined, ui),
              rawBlock: (node, _view, getPos) => new RawBlockView(node, ui, getPos as () => number | undefined),
              wikiLink: (node) => new WikiLinkView(node, ui),
              listItem: (node, view, getPos) => new ListItemView(node, view, getPos as () => number | undefined, ui.checkbox ?? 'Done'),
            },
            handleClickOn(view, _pos, node, nodePos, event) {
              if (event.button !== 0) return false
              if (node.type.name === 'wikiLink' && (!node.attrs.embed || (ui.embedChip && !isAttachmentTarget(linkTarget(String(node.attrs.value)).target)))) {
                // Links, and inline embeds (link mode, D-423), open their target.
                const { target, fragment } = linkTarget(String(node.attrs.value))
                ui.onLink(target, fragment, { pos: nodePos, dom: view.nodeDOM(nodePos) as HTMLElement | null })
                return true
              }
              if (node.type.name === 'tag') {
                ui.onTag(String(node.attrs.value))
                return true
              }
              void view
              return false
            },
            handleDOMEvents: {
              click(_view, event) {
                const a = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
                if (!a) return false
                event.preventDefault()
                ui.onExternal(a.getAttribute('href') ?? '')
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
