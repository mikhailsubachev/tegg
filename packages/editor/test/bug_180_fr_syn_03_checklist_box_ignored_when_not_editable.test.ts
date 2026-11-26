// Issue #180 (QA review of slice AND-3, finding 5; owner D-2570 (3)): the merge banner and the deleted alert make the
// editor non-editable (android-edit §10.6, FR-SYN-03 AC-41), but a checklist item's box (the node view's `toggle`,
// present.ts) still toggled it, so `Keep mine` wrote toggles the user never compared. Shared by the desktop and the
// phone: a box does nothing while the editor isn't editable.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { NOW, editorModule, newId } from './helpers'

const TEXT = '---\ntitle: Seznam\n---\n- [ ] Zavolat\n- [x] Hotovo\n'

const ui = {
  resolve: () => undefined,
  unresolved: (t: string) => `No note named ${t}`,
  sourceBlock: 'Source block',
  hint: 'Type / for commands',
  checkbox: 'Done',
  placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
  onLink: () => {},
  onTag: () => {},
  onExternal: () => {},
}

async function openWith(editable: boolean) {
  const m = await editorModule()
  return (m.createEditor as any)({ text: TEXT, now: () => NOW, newId, ui, editable }) as { view: any; save(): Promise<string | null>; destroy(): void }
}
const mousedown = (el: Element) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
const checked = (ed: { view: any }) => {
  const out: boolean[] = []
  ed.view.state.doc.descendants((n: any) => { if (n.type.name === 'listItem' && n.attrs.checked !== null) out.push(!!n.attrs.checked) })
  return out
}

test('bug_180_fr_syn_03_checklist_box_does_nothing_while_the_editor_is_not_editable', async () => {
  const ed = await openWith(false)
  const box = ed.view.dom.querySelector('.checklist-item .check')
  assert.ok(box, 'the first item draws its box')
  mousedown(box!)
  assert.deepEqual(checked(ed), [false, true], 'the box toggles nothing')
  assert.equal(await ed.save(), null, 'nothing to save')
  ed.destroy()
})

test('bug_180_fr_syn_03_checklist_box_toggles_in_an_editable_editor', async () => {
  const ed = await openWith(true)
  mousedown(ed.view.dom.querySelector('.checklist-item .check')!)
  assert.deepEqual(checked(ed), [true, true], 'the box toggles its item')
  ed.destroy()
})
