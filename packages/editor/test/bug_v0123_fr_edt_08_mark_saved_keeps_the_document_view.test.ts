// Owner report on preview v0.123 (2026-11-11): a long note blinked and its content moved back and forth while typing.
// After every save the editor syncs its `frontmatter` document attribute with the written text (`modified:` is stamped
// by the save). ProseMirror redraws the whole document when the document node's attributes change, so every block's
// DOM (and every node view: embeds, mindmaps, query blocks) was destroyed and built again on each autosave.
// A change of the frontmatter alone never redraws the body. FR-EDT-08, FR-EDT-07 (a panel edit is such a change too).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { open, type } from './helpers'

const NOTE = `---\nid: 01JB0Z00000000000000000123\ntype: page\ntitle: Dlouhá\ncreated: 2026-11-09T09:00:00+01:00\nmodified: 2026-11-09T09:00:00+01:00\n---\nPrvní odstavec\n\n![[Cíl]]\n\n- položka\n\n\`\`\`query\nsaved: Dotaz\n\`\`\`\n\nPoslední odstavec\n`

const blocksOf = (ed: any): Element[] => [...ed.view.dom.children]

test('bug_v0123_fr_edt_08_mark_saved_keeps_the_document_view', async () => {
  const ed: any = await open(NOTE)
  ed.editor.commands.focus('end')
  const before = blocksOf(ed)
  assert.equal(before.length, 5, 'five body blocks are drawn')
  type(ed, ' a další text')
  const out: string = await ed.save()
  assert.ok(/^modified: 2026-10-13T14:00:00\+02:00$/m.test(out), 'the save stamps modified')
  ed.markSaved(out)
  const after = blocksOf(ed)
  assert.equal(after.length, 5)
  after.forEach((el, i) => assert.ok(el === before[i], `block ${i + 1} keeps its element after the save (no redraw)`))
  assert.equal(ed.dirty(), false, 'the note is saved')
})

test('bug_v0123_fr_edt_07_a_frontmatter_edit_keeps_the_document_view', async () => {
  const ed: any = await open(NOTE)
  const before = blocksOf(ed)
  ed.applyFrontmatter(NOTE.replace('title: Dlouhá', 'title: Delší'))
  blocksOf(ed).forEach((el, i) => assert.ok(el === before[i], `block ${i + 1} keeps its element after a frontmatter edit`))
  ed.commands.undo()
  blocksOf(ed).forEach((el, i) => assert.ok(el === before[i], `block ${i + 1} keeps its element after its undo`))
  const out: string = await ed.save() ?? NOTE
  assert.ok(/^title: Dlouhá$/m.test(out), 'the undo restored the title')
})
