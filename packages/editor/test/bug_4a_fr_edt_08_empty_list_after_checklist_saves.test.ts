// Owner report on the preview (2026-10-15): after a checklist, ⏎ twice and `- ` started a new bulleted list, and the
// note showed "Tegg couldn't save this change safely" (VerifyError). The new list's empty item is written as a bare
// `-`, which the list-separation escalation (D-67) didn't recognise as a list marker, so the two lists merged.
// FR-EDT-08 (autosave), FR-EDT-02 AC-17.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, press, type } from './helpers'

const CHECKLIST = '---\nid: 01JB0Z00000000000000000098\ntype: page\ntitle: Seznam\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nÚvod\n\n- [ ] Úkol\n'

for (const [name, marker] of [['bulleted', '- '], ['numbered', '1. ']] as const) {
  test(`bug_4a_fr_edt_08_empty_${name}_list_after_checklist_saves`, async () => {
    const ed = await open(CHECKLIST)
    ;(ed as any).editor.commands.focus('end')
    press(ed, 'Enter') // a new checklist item
    press(ed, 'Enter') // the empty item leaves the list
    press(ed, 'Enter')
    type(ed, marker)
    let out: string | null = null
    let err: unknown = null
    try { out = await ed.save() } catch (e) { err = e }
    assert.equal(err, null, `the save is verified, not refused: ${String(err)}`)
    assert.ok(out !== null, 'saved')
    const lists: string[] = []
    ;(ed as any).editor.state.doc.forEach((n: any) => { if (/List$/.test(n.type.name)) lists.push(n.type.name) })
    const reopened = await open(out!)
    const again: string[] = []
    ;(reopened as any).editor.state.doc.forEach((n: any) => { if (/List$/.test(n.type.name)) again.push(n.type.name) })
    assert.deepEqual(again, lists, `the checklist and the new list stay two lists: ${JSON.stringify(await body(out!))}`)
  })
}
