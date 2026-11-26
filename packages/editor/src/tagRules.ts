// Ported from spike S2 (D-83). Keeps tag nodes in the editor equal to what the saved Markdown will mean (dialect §5 "Tags",
// FR-FMT-10). Found by S2's read-back check: a typed `#word` (text) is a tag on reload, and
// text typed right after a tag node extends the tag. So after every change, changed textblocks
// are re-tokenized with the same rules as the parser (S1 `tag.ts`), and only the differing part
// of the block is rebuilt, which keeps the cursor where it is.

import { Extension, combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import { Fragment, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

const TAG = /(?<=^|[\s(])#([\p{L}\p{M}\p{N}_\-/]*[\p{L}\p{M}_\-/][\p{L}\p{M}\p{N}_\-/]*)/gu
const ATOM = '￼' // stands for anything that isn't plain text (links, code, other atoms)

interface Char { ch: string; marks: readonly Mark[]; atom?: PMNode }

function chars(block: PMNode): Char[] {
  const out: Char[] = []
  block.forEach((n) => {
    if (n.type.name === 'tag') {
      for (const ch of `#${n.attrs.value}`) out.push({ ch, marks: n.marks })
    } else if (n.isText && !n.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) {
      for (const ch of n.text!) out.push({ ch, marks: n.marks })
    } else {
      out.push({ ch: ATOM, marks: n.marks, atom: n })
    }
  })
  return out
}

/** The block's inline content with tags where the Markdown parser would see them. */
function retokenize(block: PMNode, schema: Schema): Fragment {
  const cs = chars(block)
  const str = cs.map((c) => (c.atom ? ATOM : c.ch)).join('')
  const spans = new Map<number, number>()
  for (const m of str.matchAll(TAG)) spans.set(m.index!, m.index! + m[0].length)
  const nodes: PMNode[] = []
  let text = ''
  let marks: readonly Mark[] = []
  const flush = () => {
    if (text) nodes.push(schema.text(text, marks))
    text = ''
  }
  // Iterate by UTF-16 index over `str`, which matches `cs` one-to-one only for BMP chars;
  // build a map from string index to char index to stay correct with astral characters.
  const indexOf: number[] = []
  cs.forEach((c, i) => { for (let k = 0; k < (c.atom ? 1 : c.ch.length); k++) indexOf.push(i) })
  let i = 0
  while (i < str.length) {
    const c = cs[indexOf[i]]
    const end = spans.get(i)
    if (end !== undefined) {
      flush()
      nodes.push(schema.nodes.tag.create({ value: str.slice(i + 1, end) }, null, c.marks))
      i = end
      continue
    }
    if (c.atom) {
      flush()
      nodes.push(c.atom)
      i++
      continue
    }
    if (text && !sameMarks(marks, c.marks)) flush()
    if (!text) marks = c.marks
    text += c.ch
    i += c.ch.length
  }
  flush()
  return Fragment.from(nodes)
}

const sameMarks = (a: readonly Mark[], b: readonly Mark[]) => a.length === b.length && a.every((m, i) => m.eq(b[i]))

export const TagRules = Extension.create({
  name: 'tagRules',
  addProseMirrorPlugins() {
    // While an input method composes, the composing text stays text (replacing its DOM breaks the composition and the
    // keyboard commits the word again); the caret's block is re-tokenized once the composition ends (slice AND-3,
    // FR-EDT-01 AC-19 (g): `#p` inside a composition).
    let composing = false
    const AFTER = 'tagRulesAfterComposition'
    return [
      new Plugin({
        key: new PluginKey('tagRules'),
        props: {
          handleDOMEvents: {
            compositionstart: () => { composing = true; return false },
            compositionend: (view) => {
              composing = false
              setTimeout(() => {
                if (view.isDestroyed || view.composing) return
                const { $head } = view.state.selection
                if (!$head.parent.isTextblock) return
                view.dispatch(view.state.tr.setMeta(AFTER, { from: $head.start(), to: $head.end() }))
              }, 0)
              return false
            },
          },
        },
        appendTransaction: (trs, oldState, newState) => {
          if (composing || trs.some((t) => t.getMeta('tagRules'))) return null
          const forced = trs.map((t) => t.getMeta(AFTER) as { from: number; to: number } | undefined).find((x) => !!x)
          if (!trs.some((t) => t.docChanged) && !forced) return null
          const ranges = trs.some((t) => t.docChanged) ? getChangedRanges(combineTransactionSteps(oldState.doc, [...trs])) : []
          if (forced) ranges.push({ newRange: forced } as (typeof ranges)[number])
          const tr = newState.tr
          const seen = new Set<number>()
          // The caret inside a rebuilt block keeps its place in the block's text (slice AND-3: a tag typed before other
          // text in the block left the caret at the block's end, so the tag list never opened).
          const sel = newState.selection
          let caret: { block: number; chars: number } | null = null
          for (const { newRange } of ranges) {
            newState.doc.nodesBetween(newRange.from, Math.min(newRange.to, newState.doc.content.size), (node, pos) => {
              if (!node.isTextblock || node.type.name === 'codeBlock') return true
              if (seen.has(pos)) return false
              seen.add(pos)
              const next = retokenize(node, newState.schema)
              if (next.eq(node.content)) return false
              // Replace only the differing middle part, so the cursor keeps its place.
              let a = 0
              while (a < next.childCount && a < node.childCount && next.child(a).eq(node.child(a))) a++
              let b = 0
              while (b < next.childCount - a && b < node.childCount - a && next.child(next.childCount - 1 - b).eq(node.child(node.childCount - 1 - b))) b++
              let from = pos + 1
              for (let k = 0; k < a; k++) from += node.child(k).nodeSize
              let to = pos + 1 + node.content.size
              for (let k = 0; k < b; k++) to -= node.child(node.childCount - 1 - k).nodeSize
              const middle: PMNode[] = []
              for (let k = a; k < next.childCount - b; k++) middle.push(next.child(k))
              const blockStart = tr.mapping.map(pos + 1)
              if (sel.empty && sel.head > from && sel.head < to && caret === null) {
                let n = 0
                node.forEach((c, off) => {
                  const at = pos + 1 + off
                  if (at >= sel.head) return
                  const len = c.type.name === 'tag' ? 1 + String(c.attrs.value).length : c.isText ? c.text!.length : 1
                  n += Math.min(len, c.isText ? sel.head - at : len)
                })
                caret = { block: blockStart, chars: n }
              }
              tr.replaceWith(tr.mapping.map(from), tr.mapping.map(to), middle)
              if (caret && caret.block === blockStart) {
                const block = tr.doc.resolve(blockStart).parent
                let left = caret.chars
                let at = blockStart
                block.forEach((c) => {
                  if (left <= 0) return
                  const len = c.type.name === 'tag' ? 1 + String(c.attrs.value).length : c.isText ? c.text!.length : 1
                  if (c.isText && left < len) { at += left; left = 0; return }
                  left -= len
                  at += c.nodeSize
                })
                try { tr.setSelection(TextSelection.create(tr.doc, at)) } catch { /* not a text position: the mapped one */ }
              }
              return false
            })
          }
          return tr.docChanged ? tr.setMeta('tagRules', true).setMeta('addToHistory', true) : null
        },
      }),
    ]
  },
})
