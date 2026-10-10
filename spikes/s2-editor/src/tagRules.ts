// Keeps tag nodes in the editor equal to what the saved Markdown will mean (dialect §5 "Tags",
// FR-FMT-10). Found by S2's read-back check: a typed `#word` (text) is a tag on reload, and
// text typed right after a tag node extends the tag. So after every change, changed textblocks
// are re-tokenized with the same rules as the parser (S1 `tag.ts`), and only the differing part
// of the block is rebuilt, which keeps the cursor where it is.

import { Extension, combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import { Fragment, type Mark, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

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
    return [
      new Plugin({
        key: new PluginKey('tagRules'),
        appendTransaction: (trs, oldState, newState) => {
          if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('tagRules'))) return null
          const ranges = getChangedRanges(combineTransactionSteps(oldState.doc, [...trs]))
          const tr = newState.tr
          const seen = new Set<number>()
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
              tr.replaceWith(tr.mapping.map(from), tr.mapping.map(to), middle)
              return false
            })
          }
          return tr.docChanged ? tr.setMeta('tagRules', true).setMeta('addToHistory', true) : null
        },
      }),
    ]
  },
})
