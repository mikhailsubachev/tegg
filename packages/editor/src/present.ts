// How the editor shows non-text syntax (ms3-shell §13.5): link chips with their resolution (D-140, D-142), source
// blocks and placeholders (FR-EDT-01 AC-8, R5), checklist checkboxes (FR-EDT-02 AC-18) and the empty-note hint
// (FR-EDT-01 AC-9). Every text comes from the app (`EditorUi`), so the strings stay in its catalog (NFR-OTH-02).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view'

export type LinkInfo = { kind: 'note' | 'daily' | 'unresolved' | 'date-missing'; path?: string | null }

export interface EditorUi {
  /** Resolution of a wikilink target (the part before `#`/`|`); undefined while unknown. */
  resolve(target: string): LinkInfo | undefined
  /** Accessible description of a chip that doesn't resolve (D-142). */
  unresolved(target: string): string
  sourceBlock: string
  hint: string
  /** Accessible name of a checklist item's checkbox. */
  checkbox?: string
  /** Name and visible text of the placeholder for an embed (`![[…]]`), a query or a mindmap block (R5). */
  placeholder(kind: 'embed' | 'query' | 'mindmap', value: string): { name: string; text: string }
  onLink(target: string, fragment: string | null): void
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
      const broken = info && info.kind !== 'note' && info.kind !== 'daily'
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        role: 'link',
        class: broken ? 'wikilink broken' : 'wikilink',
        ...(broken ? { 'aria-description': ui.unresolved(target) } : {}),
      }))
      return false
    }
    if (node.type.name === 'tag') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { role: 'link', class: 'tag' }))
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
              listItem: (node, view, getPos) => new ListItemView(node, view, getPos as () => number | undefined, ui.checkbox ?? 'Done'),
            },
            handleClickOn(view, _pos, node, _nodePos, event) {
              if (event.button !== 0) return false
              if (node.type.name === 'wikiLink' && !node.attrs.embed) {
                const { target, fragment } = linkTarget(String(node.attrs.value))
                ui.onLink(target, fragment)
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
