// How the editor shows non-text syntax (ms3-shell §13.5): link chips with their resolution (D-140, D-142), source
// blocks and placeholders (FR-EDT-01 AC-8, R5), checklist checkboxes (FR-EDT-02 AC-18) and the empty-note hint
// (FR-EDT-01 AC-9). Every text comes from the app (`EditorUi`), so the strings stay in its catalog (NFR-OTH-02).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'
import { displayTable, isAttachmentTarget } from '@tegg/doc'
import { wikiLabel } from './schema'

export type LinkInfo = {
  kind: 'note' | 'daily' | 'unresolved' | 'date-missing'; path?: string | null; type?: string | null; title?: string | null
  /** D-601: the target's `review`, `status`, `due`, `completed` for its chip (D-600). */
  review?: string | null; status?: string | null; due?: string | null; completed?: string | null
}
/** D-600: what the app adds to a resolved chip: data attributes, a description, an icon in place of the type's, and
 *  the suffix after the title. */
export type ChipExtra = { attrs: Record<string, string>; description: string | null; icon: Element | null; suffix: Element | null }

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
  /** 6A (ms6-trash-media §6.1): renders a block embed whose target resolved to kind `media` into `block` (the app draws
   *  the figure or the PDF card; the editor owns no `img`). 6A stub: never called yet. */
  media?(target: LinkInfo, block: HTMLElement): void
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
  const ok = info && (info.kind === 'note' || info.kind === 'daily')
  const base = ok && info!.title ? info!.title : target
  return sub && !sub.startsWith('^') ? `${base} › ${sub}` : base
}

/** A link chip as in the read view: the target type's icon, then the shown text (FR-EDT-02 AC-16). */
class WikiLinkView implements NodeView {
  dom: HTMLElement
  private extraAttrs: string[] = []
  constructor(private node: PMNode, private ui: EditorUi) {
    this.dom = document.createElement('span')
    this.render()
  }
  private render() {
    const v = String(this.node.attrs.value)
    this.dom.setAttribute('data-wikilink', v)
    this.dom.replaceChildren()
    // Only what this view set before: a decoration owns `aria-description` of a broken chip.
    for (const a of this.extraAttrs) this.dom.removeAttribute(a)
    this.extraAttrs = []
    let suffix: Element | null = null
    if (!this.node.attrs.embed) {
      const info = this.ui.resolve(linkTarget(v).target)
      this.dom.setAttribute('data-link-kind', info?.kind ?? 'unresolved') // from the first paint (FR-LNK-07)
      const ok = info && (info.kind === 'note' || info.kind === 'daily')
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
