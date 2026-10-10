// Property test: random sequences of editor commands on random fixtures. After every step the
// note saves, re-parses with one block per editor block, and every unchanged block keeps its bytes.
import fc from 'fast-check'
import { expect, test } from 'vitest'
import type { Editor } from '@tiptap/core'
import { reconcile } from '../src/sourceDoc'
import { endOfBlock, expectPreserved, fixtures, open } from './helpers'

const posOf = (e: Editor, k: number) => {
  let p = 0
  for (let i = 0; i < k; i++) p += e.state.doc.child(i).nodeSize
  return p
}

const words = fc.constantFrom('word', 'Čtení', ' ', '*', '#', '[[', '-', '1.', '>', '`', '==', '%%', '$', '🙂', '\\')

type Cmd =
  | { t: 'type'; k: number; text: string }
  | { t: 'split' | 'join' | 'delete' | 'bullet' | 'heading' | 'quote' | 'link' | 'newPara'; k: number }
  | { t: 'move'; k: number; to: number }

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant('type' as const), k: fc.nat(), text: fc.array(words, { minLength: 1, maxLength: 4 }).map((a) => a.join('')) }),
  fc.record({ t: fc.constantFrom('split', 'join', 'delete', 'bullet', 'heading', 'quote', 'link', 'newPara'), k: fc.nat() }) as fc.Arbitrary<Cmd>,
  fc.record({ t: fc.constant('move' as const), k: fc.nat(), to: fc.nat() }),
)

function run(e: Editor, c: Cmd): void {
  const n = e.state.doc.childCount
  const k = c.k % n
  const node = e.state.doc.child(k)
  const textual = node.type.name === 'paragraph' && node.content.size > 0
  const at = posOf(e, k)
  switch (c.t) {
    case 'type': {
      const pos = endOfBlock(e, k)
      if (pos !== null && node.type.name !== 'rawBlock') e.chain().command(({ tr, state }) => { tr.insert(pos, state.schema.text(c.text)); return true }).run()
      break
    }
    case 'split': if (textual) e.chain().setTextSelection(at + 1 + Math.floor(node.content.size / 2)).splitBlock().run(); break
    case 'join': if (k > 0 && textual) e.chain().setTextSelection(at + 1).joinBackward().run(); break
    case 'delete': if (n > 1) e.chain().command(({ tr }) => { tr.delete(at, at + node.nodeSize); return true }).run(); break
    case 'bullet': if (textual) e.chain().setTextSelection(at + 1).toggleBulletList().run(); break
    case 'heading': if (textual) e.chain().setTextSelection(at + 1).setHeading({ level: 2 }).run(); break
    case 'quote': if (textual) e.chain().setTextSelection(at + 1).toggleBlockquote().run(); break
    case 'link': {
      const pos = endOfBlock(e, k)
      if (pos !== null && textual) e.chain().command(({ tr, state }) => { tr.insert(pos, state.schema.nodes.wikiLink.create({ value: 'Some note' })); return true }).run()
      break
    }
    case 'newPara': e.chain().command(({ tr, state }) => { tr.insert(at + node.nodeSize, state.schema.nodes.paragraph.create(null, state.schema.text('New'))); return true }).run(); break
    case 'move': {
      const to = c.to % n
      if (to === k) break
      e.chain().command(({ tr }) => {
        const target = to > k ? posOf(e, to + 1) : posOf(e, to)
        tr.insert(target, node)
        const from = to > k ? at : at + node.nodeSize
        tr.delete(from, from + node.nodeSize)
        return true
      }).run()
      break
    }
  }
}

export { run }
test('fr_fmt_07_editor_property_random_command_sequences', () => {
  const usable = fixtures.filter((f) => f.text.trim().length > 0)
  let steps = 0
  fc.assert(
    fc.property(fc.nat({ max: usable.length - 1 }), fc.array(cmd, { minLength: 1, maxLength: 6 }), (fi, cmds) => {
      const s = open(usable[fi].text)
      for (const c of cmds) {
        run(s.editor, c)
        const out = reconcile(s.loaded, s.editor.state.doc).text
        expectPreserved(s, out, `${usable[fi].rel} after ${JSON.stringify(c)}`)
        steps++
      }
    }),
    { numRuns: Number(process.env.TEGG_RUNS ?? 500), seed: Number(process.env.TEGG_SEED ?? 20261008) },
  )
  expect(steps).toBeGreaterThan(1000)
})
