// How the editor shows non-text syntax (ms3-shell §13.5): link chips with their resolution (D-140, D-142), source
// blocks and placeholders (FR-EDT-01 AC-8, R5), checklist checkboxes (FR-EDT-02 AC-18) and the empty-note hint
// (FR-EDT-01 AC-9). Every text comes from the app (`EditorUi`), so the strings stay in its catalog (NFR-OTH-02).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'
import { wikiLabel } from './schema'

export type LinkInfo = { kind: 'note' | 'daily' | 'unresolved' | 'date-missing'; path?: string | null; type?: string | null; title?: string | null }

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
  /** Name and visible text of the placeholder for an embed (`![[…]]`), a query or a mindmap block (R5). */
  placeholder(kind: 'embed' | 'query' | 'mindmap', value: string): { name: string; text: string }
  /** `chip`: where the clicked chip is (its node position and DOM), for the Create offer of a broken link (4A). */
  onLink(target: string, fragment: string | null, chip?: { pos: number; dom: HTMLElement | null }): void
  onTag(value: string): void
  onExternal(href: string): void
}

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
        const ph = ui.placeholder(EMBED_KIND(value), value)
        decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'region', 'aria-label': ph.name, class: 'embed-chip', 'data-embed': '' }))
        return false
      }
      const info = ui.resolve(target)
      const broken = info && info.kind === 'unresolved' // a date without a note is never broken (D-142, FR-DLY-08 AC-5)
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        role: 'link',
        class: `chip link-chip kind-${info?.kind ?? 'unresolved'}`,
        'data-link-kind': info?.kind ?? 'unresolved', // FR-LNK-07 (D-306): the same attribute in every context
        ...(broken ? { 'aria-description': ui.unresolved(target) } : {}),
      }))
      return false
    }
    if (node.type.name === 'tag') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'link', class: 'chip tag-chip' }))
      return false
    }
    return true
  })
  // The hint of an empty note: a widget, never part of the text or a copy (FR-EDT-01 AC-9).
  if (doc.childCount === 1 && doc.firstChild!.type.name === 'paragraph' && doc.firstChild!.content.size === 0) {
    decos.push(Decoration.widget(1, () => {
      const s = document.createElement('span')
      s.className = 'editor-hint'
      s.contentEditable = 'false'
      s.setAttribute('aria-hidden', 'true')
      s.textContent = ui.hint
      return s
    }, { side: 1, ignoreSelection: true, key: 'hint' }))
  }
  return DecorationSet.create(doc, decos)
}

class RawBlockView implements NodeView {
  dom: HTMLElement
  constructor(node: PMNode, ui: EditorUi) {
    const kind = String(node.attrs.kind)
    const source = String(node.attrs.source)
    this.dom = document.createElement('div')
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('draggable', 'false')
    if (kind === 'embed' || kind === 'query' || kind === 'mindmap') {
      const ph = ui.placeholder(kind as 'embed', source)
      this.dom.setAttribute('role', 'region')
      this.dom.setAttribute('aria-label', ph.name)
      this.dom.className = 'in-note-placeholder'
      this.dom.textContent = ph.text
    } else {
      this.dom.setAttribute('role', 'group')
      this.dom.setAttribute('aria-label', ui.sourceBlock)
      this.dom.className = 'source-block'
      const pre = document.createElement('pre')
      pre.textContent = source
      this.dom.appendChild(pre)
    }
  }
  stopEvent(e: Event) {
    return e.type === 'keydown' || e.type === 'beforeinput' || e.type === 'paste'
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
  constructor(private node: PMNode, private ui: EditorUi) {
    this.dom = document.createElement('span')
    this.render()
  }
  private render() {
    const v = String(this.node.attrs.value)
    this.dom.setAttribute('data-wikilink', v)
    this.dom.replaceChildren()
    if (!this.node.attrs.embed) {
      const info = this.ui.resolve(linkTarget(v).target)
      this.dom.setAttribute('data-link-kind', info?.kind ?? 'unresolved') // from the first paint (FR-LNK-07)
      const icon = info && (info.kind === 'note' || info.kind === 'daily') ? this.ui.chipIcon?.(info.type ?? 'page') : null
      if (icon) this.dom.appendChild(icon)
    }
    const label = document.createElement('span')
    label.setAttribute('data-user-content', '')
    label.textContent = this.node.attrs.embed ? wikiLabel(v, true) : chipLabel(v, this.ui.resolve(linkTarget(v).target))
    this.dom.appendChild(label)
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
              rawBlock: (node) => new RawBlockView(node, ui),
              wikiLink: (node) => new WikiLinkView(node, ui),
              listItem: (node, view, getPos) => new ListItemView(node, view, getPos as () => number | undefined, ui.checkbox ?? 'Done'),
            },
            handleClickOn(view, _pos, node, nodePos, event) {
              if (event.button !== 0) return false
              if (node.type.name === 'wikiLink' && !node.attrs.embed) {
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
