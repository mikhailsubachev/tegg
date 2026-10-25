// QA review of slice MM: in a titled mindmap whose only item is empty (Rozpoznání's `> [!mindmap] Prázdná`), ⌫ at the
// item's start and ⏎ in it turned the whole callout into an empty paragraph, so the next autosave dropped the title.
// D-780 (owner, 2026-10-25): only an untitled mindmap becomes an empty paragraph (D-772); in a titled one ⌫ moves the
// caret to the end of the title, ⏎ to a new paragraph after the block, and nothing is written. FR-MMP-02 AC-22.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { TextSelection } from '@tiptap/pm/state'
import { open, press, readFixture, type TeggEditor } from './helpers'

const ROZPOZNANI = () => readFixture('tests/fixtures/vaults/mindmap/Pages/Rozpoznání.md')

/** The caret at the end of the title `Prázdná`, then ⏎ into the block's empty item (D-771). */
function intoEmptyItem(ed: TeggEditor) {
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos < 0 && n.type.name === 'calloutTitle' && n.textContent.normalize('NFC') === 'Prázdná') pos = p + 1 + n.content.size
    return pos < 0
  })
  assert.ok(pos >= 0, 'Rozpoznání has the titled empty mindmap Prázdná')
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)))
  press(ed, 'Enter')
  const $f = ed.view.state.selection.$from
  assert.equal($f.parent.type.name, 'paragraph', 'the caret is in the empty item')
  assert.equal($f.node($f.depth - 1).type.name, 'listItem', 'the caret is in the empty item')
}
function mindmapPrazdna(ed: TeggEditor): boolean {
  let found = false
  ed.view.state.doc.forEach((n: any) => {
    if (n.type.name === 'callout' && String(n.attrs.calloutType).toLowerCase() === 'mindmap' && n.firstChild?.textContent.normalize('NFC') === 'Prázdná') found = true
  })
  return found
}

test('bug_mm_fr_mmp_02_backspace_in_a_titled_empty_mindmap_keeps_the_block', async () => {
  const ed = await open(ROZPOZNANI())
  intoEmptyItem(ed)
  press(ed, 'Backspace')
  assert.equal(mindmapPrazdna(ed), true, 'the mindmap Prázdná is still there')
  const $f = ed.view.state.selection.$from
  assert.deepEqual([$f.parent.type.name, $f.parentOffset === $f.parent.content.size], ['calloutTitle', true], '⌫: the caret at the end of the title')
  assert.equal(await ed.save(), null, 'nothing is written')
})

test('bug_mm_fr_mmp_02_enter_in_a_titled_empty_mindmap_keeps_the_block', async () => {
  const ed = await open(ROZPOZNANI())
  intoEmptyItem(ed)
  press(ed, 'Enter')
  assert.equal(mindmapPrazdna(ed), true, 'the mindmap Prázdná is still there')
  const $f = ed.view.state.selection.$from
  assert.deepEqual([$f.depth, $f.parent.type.name, $f.parent.content.size], [1, 'paragraph', 0], '⏎: the caret in a new empty paragraph after the block')
  assert.equal(await ed.save(), null, 'nothing is written')
})
