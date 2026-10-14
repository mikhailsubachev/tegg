// Markdown shortcuts (FR-EDT-04, table R7 of docs/acceptance/editor.md): block conversions at the start of a
// paragraph, inline marks that follow CommonMark flanking (so `2 * 3 * 4` and `snake_case` stay text, AC-2/AC-4),
// `]]` closing a typed wikilink, and the Enter conversions for code fences and dividers. ⌘Z right after a conversion
// restores the typed characters (AP-135, D-191).

import { Extension } from '@tiptap/core'
import { InputRule, inputRules, undoInputRule } from '@tiptap/pm/inputrules'
import type { MarkType, NodeType, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { findWrapping } from '@tiptap/pm/transform'

/** Only at the start of a plain paragraph that isn't inside a list item, table or callout title. */
function atParagraphStart(state: EditorState, start: number): boolean {
  const $s = state.doc.resolve(start)
  if ($s.parent.type.name !== 'paragraph' || $s.parentOffset !== 0) return false
  for (let d = $s.depth - 1; d > 0; d--) if (['table', 'tableCell', 'tableHeader'].includes($s.node(d).type.name)) return false
  return true
}

/** A conversion joins the typing's undo step (FR-EDT-09 AC-2); ⌘Z right after it still undoes only the rule. */
function joined(tr: Transaction, state: EditorState): Transaction {
  return tr.setMeta('appendedTransaction', state.tr)
}

function blockRule(re: RegExp, apply: (tr: Transaction, state: EditorState, match: RegExpMatchArray, start: number) => boolean): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    if (!atParagraphStart(state, start)) return null
    const tr = state.tr.delete(start, end)
    return apply(tr, state, match, start) ? joined(tr, state) : null
  })
}

function wrapIn(tr: Transaction, type: NodeType, attrs: Record<string, unknown> | null, start: number): boolean {
  const $s = tr.doc.resolve(start)
  const range = $s.blockRange()
  const wrapping = range && findWrapping(range, type, attrs ?? undefined)
  if (!range || !wrapping) return false
  tr.wrap(range, wrapping)
  return true
}

function markRule(re: RegExp, type: () => MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const whole = match[1]
    const inner = match[2]
    if (!inner) return null
    const markStart = start + (match[0].length - whole.length)
    const $s = state.doc.resolve(markStart)
    if ($s.parent.type.spec.code) return null
    // Inside other atoms or marks that forbid it (inline code), keep the text.
    if (state.doc.rangeHasMark(markStart, end, state.schema.marks.code)) return null
    const tr = state.tr.delete(markStart, end)
    tr.insert(markStart, state.schema.text(inner, [type().create()]))
    tr.removeStoredMark(type())
    return joined(tr, state)
  })
}

/** CommonMark-ish flanking: content neither starts nor ends with whitespace, opener not glued to a word character. */
const flank = (open: string, word: string) => {
  const o = open.replace(/[*^$]/g, (c) => `\\${c}`)
  const ch = open[0].replace(/[*^$]/g, (c) => `\\${c}`)
  return new RegExp(`(?:^|[^${ch}${word}])(${o}([^${ch}\\s](?:[^${ch}]*[^${ch}\\s])?)${o})$`, 'u')
}
const W = '\\p{L}\\p{N}'

export function teggInputRules(schema: import('@tiptap/pm/model').Schema) {
  const m = schema.marks
  const n = schema.nodes
  return inputRules({
    rules: [
      // Blocks (R7).
      blockRule(/^(#{1,6})\s$/, (tr, _s, match, start) => {
        tr.setBlockType(start, start, n.heading, { level: match[1].length })
        return true
      }),
      blockRule(/^\[( |x|X)?\]\s$/, (tr, _s, match, start) => {
        if (!wrapIn(tr, n.bulletList, null, start)) return false
        const $p = tr.doc.resolve(start + 2)
        for (let d = $p.depth; d > 0; d--) {
          if ($p.node(d).type.name === 'listItem') {
            tr.setNodeMarkup($p.before(d), undefined, { ...$p.node(d).attrs, checked: !!match[1] && match[1] !== ' ' })
            break
          }
        }
        return true
      }),
      blockRule(/^\s*([-+*])\s$/, (tr, _s, _m, start) => wrapIn(tr, n.bulletList, null, start)),
      blockRule(/^(\d+)[.)]\s$/, (tr, _s, match, start) => wrapIn(tr, n.orderedList, { start: Number(match[1]) }, start)),
      blockRule(/^>\s$/, (tr, _s, _m, start) => wrapIn(tr, n.blockquote, null, start)),
      // Inline marks (R7).
      markRule(flank('**', W), () => m.bold),
      markRule(flank('__', W), () => m.bold),
      markRule(flank('*', W), () => m.italic),
      markRule(flank('_', W), () => m.italic),
      markRule(flank('~~', W), () => m.strike),
      markRule(flank('==', W), () => m.highlight),
      new InputRule(/(?:^|[^`])(`([^`\n]+)`)$/, (state, match, start, end) => {
        const markStart = start + (match[0].length - match[1].length)
        if (state.doc.resolve(markStart).parent.type.spec.code) return null
        // Tags typed inside the backticks become their text again: code is literal (FR-EDT-04 AC-2).
        const inner = state.doc.textBetween(markStart + 1, end, '', (leaf) => (leaf.type.name === 'tag' ? `#${leaf.attrs.value}` : ''))
        if (!inner) return null
        const tr = state.tr.delete(markStart, end)
        tr.insert(markStart, state.schema.text(inner, [m.code.create()]))
        tr.removeStoredMark(m.code)
        return joined(tr, state)
      }),
      // A typed `[[target]]` / `![[target]]` becomes a link or embed (FR-EDT-06 AC-5, FR-EDT-02 AC-21).
      new InputRule(/(!?)\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
        if (state.doc.resolve(start).parent.type.spec.code) return null
        return joined(state.tr.replaceWith(start, end, n.wikiLink.create({ value: match[2].normalize('NFC'), embed: match[1] === '!' })), state)
      }),
    ],
  })
}

/** Enter on a paragraph that is exactly a code fence or a divider converts it (R7). */
function enterConversion(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
  if ($from.depth !== 1) return false
  const text = $from.parent.textContent
  const n = state.schema.nodes
  const fence = /^```([^`\s]*)$/.exec(text)
  const start = $from.before()
  const end = $from.after()
  if (fence) {
    if (dispatch) {
      const tr = state.tr.replaceWith(start, end, n.codeBlock.create({ language: fence[1] || null }))
      tr.setSelection(TextSelection.create(tr.doc, start + 1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
  if (/^(?:---|\*\*\*|___)$/.test(text)) {
    if (dispatch) {
      const tr = state.tr.replaceWith(start, end, [n.horizontalRule.create(), n.paragraph.create()])
      tr.setSelection(TextSelection.create(tr.doc, start + 2))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
  return false
}

/** Enter on an empty list item at the top level ends the list (FR-EDT-02 AC-17). */
function isEmptyItem(node: PMNode): boolean {
  return node.childCount === 1 && node.firstChild!.type.name === 'paragraph' && node.firstChild!.content.size === 0
}

/** Markdown can't hold spaces at the start of a paragraph: a split or join that leaves them drops them, so the editor
 *  shows what the file will mean (ADR 0002 §5 read-back). Typing a space at the start of an empty paragraph is kept
 *  while the caret is right after it (the `- ` shortcuts need it). */
const leadingSpaces = new Plugin({
  key: new PluginKey('teggLeadingSpaces'),
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('teggLoad'))) return null
    const tr = state.tr
    const caret = state.selection.from
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true
      if (node.type.spec.code || !['paragraph', 'heading', 'calloutTitle'].includes(node.type.name)) return false
      const first = node.firstChild
      const m = first?.isText ? /^[ \t\n]+/.exec(first.text!) : null
      let atoms = false
      node.forEach((c) => { if (!c.isText) atoms = true })
      const onlySpaces = node.textContent.trim() === '' && !atoms
      const hasCaret = caret > pos && caret <= pos + 1 + node.content.size
      const last = node.lastChild
      const t = last?.isText && !hasCaret && !onlySpaces ? /[ \t\n]+$/.exec(last.text!) : null
      if (t) {
        const end = pos + 1 + node.content.size
        tr.delete(tr.mapping.map(end - t[0].length), tr.mapping.map(end))
      }
      if (m && !(onlySpaces && hasCaret)) tr.delete(tr.mapping.map(pos + 1), tr.mapping.map(pos + 1 + m[0].length))
      return false
    })
    return tr.docChanged ? tr : null
  },
})

export const TeggRules = Extension.create({
  name: 'teggRules',
  priority: 1000,
  addProseMirrorPlugins() {
    return [teggInputRules(this.editor.schema), leadingSpaces]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (enterConversion(editor.state, editor.view.dispatch)) return true
        const { $from } = editor.state.selection
        // A Markdown table cell holds one line: Enter stays in the cell (FR-EDT-02 AC-20).
        for (let d = $from.depth; d > 0; d--) if (['tableCell', 'tableHeader'].includes($from.node(d).type.name)) return true
        if ($from.depth >= 2 && $from.node(-1).type.name === 'listItem' && isEmptyItem($from.node(-1))) return editor.commands.liftListItem('listItem')
        // ⏎ in a checklist item makes another (unchecked) checklist item (bug_3c, FR-EDT-02 AC-17).
        if ($from.depth >= 2 && $from.node(-1).type.name === 'listItem' && $from.node(-1).attrs.checked !== null) {
          return editor.commands.splitListItem('listItem', { checked: false })
        }
        return false
      },
      'Mod-z': ({ editor }) => undoInputRule(editor.state, editor.view.dispatch) || editor.commands.undo(),
      // ⌘↩ opens the link at the caret or toggles the checklist item (R8); the app runs it, never a hard break.
      'Mod-Enter': () => false,
      Backspace: ({ editor }) => undoInputRule(editor.state, editor.view.dispatch),
    }
  },
})
