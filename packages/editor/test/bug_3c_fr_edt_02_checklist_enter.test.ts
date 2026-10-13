// Owner feedback on the 3C preview (2026-10-13): ⏎ in a checklist item made a plain bullet, not another checkbox.
// FR-EDT-02 AC-17/AC-18 (checklists).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, caret, editorNote, open, press, type } from './helpers'

test('bug_3c_fr_edt_02_enter_in_checklist_item_makes_a_checklist_item', async () => {
  const ed = await open(editorNote('Úkoly'))
  caret(ed, 0) // end of the list block: after "Velké X"
  press(ed, 'Enter')
  type(ed, 'Nový úkol')
  const out = await ed.save()
  assert.ok(out !== null, 'saved')
  assert.match(await body(out!), /- \[X\] Velké X\n- \[ \] Nový úkol\n$/, 'the new item has an empty checkbox')
})
