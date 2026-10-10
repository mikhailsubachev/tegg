// Suggestion menus: `/` block commands (FR-EDT-03), `[[` link autocomplete (FR-EDT-06),
// `#` tag autocomplete (FR-EDT-15). Vanilla DOM popup, keyboard-first.

import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'

export interface Item {
  label: string
  hint?: string
  run: (editor: Editor, range: Range) => void
}

function popup() {
  let el: HTMLDivElement | null = null
  let items: Item[] = []
  let index = 0
  let props: SuggestionProps<Item> | null = null

  const render = () => {
    if (!el || !props) return
    el.innerHTML = ''
    if (!items.length) {
      el.style.display = 'none'
      return
    }
    el.style.display = 'block'
    items.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'suggest-item' + (i === index ? ' active' : '')
      row.innerHTML = `<span>${escape(item.label)}</span>${item.hint ? `<small>${escape(item.hint)}</small>` : ''}`
      row.onmousedown = (e) => {
        e.preventDefault()
        props!.command(item)
      }
      el!.appendChild(row)
    })
    const rect = props.clientRect?.()
    if (rect) {
      el.style.left = `${rect.left + window.scrollX}px`
      el.style.top = `${rect.bottom + window.scrollY + 4}px`
    }
  }

  return {
    onStart: (p: SuggestionProps<Item>) => {
      props = p
      items = p.items
      index = 0
      el = document.createElement('div')
      el.className = 'suggest'
      document.body.appendChild(el)
      render()
    },
    onUpdate: (p: SuggestionProps<Item>) => {
      props = p
      items = p.items
      index = Math.min(index, Math.max(0, items.length - 1))
      render()
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') { index = (index + 1) % items.length; render(); return true }
      if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % items.length; render(); return true }
      if (event.key === 'Enter' || event.key === 'Tab') { props?.command(items[index]); return true }
      if (event.key === 'Escape') { el?.remove(); el = null; return true }
      return false
    },
    onExit: () => {
      el?.remove()
      el = null
    },
  }
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function suggestionMenu(name: string, char: string, items: (query: string) => Item[], allowSpaces = false) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<Item>({
          editor: this.editor,
          pluginKey: new PluginKey(name),
          char,
          allowSpaces,
          items: ({ query }) => items(query).slice(0, 10),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: popup,
        }),
      ]
    },
  })
}

const match = (q: string, s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''))

/** `/` block commands. Each replaces the typed `/query` and turns the current block into the type. */
export const slashCommands = suggestionMenu('slashCommands', '/', (q) => {
  const all: Item[] = [
    { label: 'Text', run: (e, r) => e.chain().deleteRange(r).setParagraph().run() },
    { label: 'Heading 1', hint: '#', run: (e, r) => e.chain().deleteRange(r).setHeading({ level: 1 }).run() },
    { label: 'Heading 2', hint: '##', run: (e, r) => e.chain().deleteRange(r).setHeading({ level: 2 }).run() },
    { label: 'Heading 3', hint: '###', run: (e, r) => e.chain().deleteRange(r).setHeading({ level: 3 }).run() },
    { label: 'Bulleted list', hint: '-', run: (e, r) => e.chain().deleteRange(r).toggleBulletList().run() },
    { label: 'Numbered list', hint: '1.', run: (e, r) => e.chain().deleteRange(r).toggleOrderedList().run() },
    {
      label: 'Checklist', hint: '[ ]',
      run: (e, r) => e.chain().deleteRange(r).toggleBulletList().updateAttributes('listItem', { checked: false }).run(),
    },
    { label: 'Quote', hint: '>', run: (e, r) => e.chain().deleteRange(r).toggleBlockquote().run() },
    {
      label: 'Callout', hint: '> [!note]',
      run: (e, r) => e.chain().deleteRange(r).toggleBlockquote().insertContent('[!note] ').run(),
    },
    { label: 'Code block', hint: '```', run: (e, r) => e.chain().deleteRange(r).setCodeBlock().run() },
    {
      label: 'Mindmap', hint: 'mermaid',
      run: (e, r) => e.chain().deleteRange(r).insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'mindmap\n  root((Topic))\n    Idea' }] }).run(),
    },
    {
      label: 'Query', hint: 'query',
      run: (e, r) => e.chain().deleteRange(r).insertContent({ type: 'codeBlock', attrs: { language: 'query' }, content: [{ type: 'text', text: 'types: [task]\nview: table' }] }).run(),
    },
    { label: 'Divider', hint: '---', run: (e, r) => e.chain().deleteRange(r).setHorizontalRule().run() },
    { label: 'Table', run: (e, r) => e.chain().deleteRange(r).insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
  ]
  return all.filter((i) => match(q, i.label))
})

/** `[[` link autocomplete over note names; a name that doesn't exist yet is offered as new. */
export function linkSuggest(names: () => string[]) {
  return suggestionMenu('linkSuggest', '[[', (q) => {
    const hits = names().filter((n) => match(q, n))
    const items: Item[] = hits.map((n) => ({ label: n, run: (e, r) => insertLink(e, r, n) }))
    if (q && !hits.some((n) => n.toLowerCase() === q.toLowerCase())) items.push({ label: q, hint: 'new note', run: (e, r) => insertLink(e, r, q) })
    return items
  }, true)
}

function insertLink(e: Editor, r: Range, name: string) {
  // Remove the typed `[[query` and any `]]` the user already typed after it. For a two-character
  // trigger the suggestion range may start at the second `[` (found in S2 manual testing).
  const doc = e.state.doc
  const typed = doc.textBetween(r.from, r.to)
  const leading = typed.match(/^\[*/)![0].length
  let from = r.from
  for (let n = leading; n < 2 && from > 0 && doc.textBetween(from - 1, from) === '['; n++) from--
  const after = doc.textBetween(r.to, Math.min(r.to + 2, doc.content.size))
  e.chain().deleteRange({ from, to: r.to + (after === ']]' ? 2 : 0) }).insertContent([{ type: 'wikiLink', attrs: { value: name } }, { type: 'text', text: ' ' }]).run()
}

/** `#` tag autocomplete; a new name creates a new tag (FR-TAG-03). */
export function tagSuggest(tags: () => string[]) {
  return suggestionMenu('tagSuggest', '#', (q) => {
    if (/^\d*$/.test(q) && q) return [] // `#1` is not a tag
    const hits = tags().filter((t) => match(q, t))
    const items: Item[] = hits.map((t) => ({ label: `#${t}`, run: (e, r) => insertTag(e, r, t) }))
    if (q && !hits.some((t) => t.toLowerCase() === q.toLowerCase())) items.push({ label: `#${q}`, hint: 'new tag', run: (e, r) => insertTag(e, r, q) })
    return items
  })
}

function insertTag(e: Editor, r: Range, value: string) {
  e.chain().deleteRange(r).insertContent([{ type: 'tag', attrs: { value } }, { type: 'text', text: ' ' }]).run()
}
