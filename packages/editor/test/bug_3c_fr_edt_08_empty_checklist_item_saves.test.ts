// Owner report on the preview (2026-10-14): after ⏎ at the end of a checklist, the note showed "Tegg couldn't save
// this change safely" (VerifyError) while the new item was still empty. FR-EDT-08 (autosave), FR-EDT-02 AC-17.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, editorNote, open, press } from './helpers'

test('bug_3c_fr_edt_08_empty_checklist_item_at_the_end_saves', async () => {
  const ed = await open(editorNote('Úkoly'))
  ;(ed as any).editor.commands.focus('end')
  press(ed, 'Enter')
  let out: string | null = null
  let err: unknown = null
  try { out = await ed.save() } catch (e) { err = e }
  assert.equal(err, null, `the save is verified, not refused: ${String(err)}`)
  assert.ok(out !== null, 'saved')
  assert.match(await body(out!), /- \[[xX]\] Velké X\n- \[ \] *\n?$/, 'an empty checklist item is written')
})

// AR-06 round trip: a file with an empty checklist item opens as one, saves unchanged, and ticking it writes `- [x]`.
const EMPTY_ITEM = '---\nid: 01JB0Z00000000000000000099\ntype: page\ntitle: Prázdný úkol\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n- [x] Hotovo\n- [ ]\n'

test('bug_3c_fr_edt_08_empty_checklist_item_round_trips', async () => {
  const ed = await open(EMPTY_ITEM)
  const items: (boolean | null)[] = []
  ;(ed as any).editor.state.doc.descendants((n: any) => { if (n.type.name === 'listItem') items.push(n.attrs.checked); return true })
  assert.deepEqual(items, [true, false], 'two checklist items, the second empty and unticked')
  assert.equal(await ed.save(), null, 'open and save without edits writes nothing')
  let pos = -1
  ;(ed as any).editor.state.doc.descendants((n: any, p: number) => { if (n.type.name === 'listItem' && n.attrs.checked === false) pos = p; return true })
  const view = (ed as any).editor.view
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos).attrs, checked: true }))
  const out = await ed.save()
  assert.ok(out !== null, 'saved')
  assert.match(await body(out!), /^- \[x\] Hotovo\n- \[x\]\n?$/, 'the empty item is ticked in place')
})
