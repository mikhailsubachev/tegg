// Owner report on preview v0.120 (2026-11-09): after a bulleted item, ⏎ and Tab made an empty nested item, and the
// note showed "Tegg couldn't save this change safely" (VerifyError). The empty item was written as a bare `-` right
// under its parent's text, which Markdown reads as a setext heading underline (`1.` reads as more text). An empty item
// that can't be written lives only in the editor until it has text, as D-765 (b) does for mindmaps (D-1428).
// FR-EDT-08 (autosave), FR-FMT-07, FR-EDT-02.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, press, type } from './helpers'

const NOTE = (list: string) => `---\nid: 01JB0Z00000000000000000099\ntype: page\ntitle: Vnořené\ncreated: 2026-11-09T09:00:00+01:00\nmodified: 2026-11-09T09:00:00+01:00\n---\nÚvod\n\n${list}`

async function saveOf(ed: any): Promise<string> {
  let out: string | null = null
  let err: unknown = null
  try { out = await ed.save() } catch (e) { err = e }
  assert.equal(err, null, `the save is verified, not refused: ${String(err)}`)
  return out ?? ''
}

for (const [name, list, child] of [
  ['bulleted', '- první\n- druhá\n', '  - '],
  ['numbered', '1. první\n2. druhá\n', '   1. '],
] as const) {
  test(`bug_v0120_fr_edt_08_empty_nested_${name}_item_saves`, async () => {
    const text = NOTE(list)
    const ed: any = await open(text)
    ed.editor.commands.focus('end')
    press(ed, 'Enter')
    press(ed, 'Tab') // an empty item nested under `druhá`
    const nested = ed.editor.state.doc.lastChild.lastChild.lastChild
    assert.ok(/List$/.test(nested.type.name), 'the editor holds the empty nested item')
    const out = await saveOf(ed)
    // Nothing to write: the empty item lives only in the editor (no change on disk, no `modified:` churn).
    assert.equal(await body(out || text), await body(text), 'the file keeps its list without the empty item')
    type(ed, 'třetí')
    const after = await saveOf(ed)
    assert.equal(await body(after), `Úvod\n\n${list}${child}třetí\n`, 'once it has text, the nested item is written')
  })
}

test('bug_v0120_fr_edt_08_empty_nested_item_between_text_saves', async () => {
  const text = NOTE('- a\n  - c\n- d\n')
  const ed: any = await open(text)
  // Caret at the end of `a`, ⏎ and Tab: an empty item before `c` in the nested list.
  const doc = ed.editor.state.doc
  let pos = -1
  doc.descendants((n: any, p: number) => { if (n.isText && n.text === 'a') pos = p + 1 })
  ed.editor.commands.setTextSelection(pos)
  press(ed, 'Enter')
  press(ed, 'Tab')
  const out = await saveOf(ed)
  assert.equal(await body(out || text), await body(text), 'the empty nested item is not written')
})
