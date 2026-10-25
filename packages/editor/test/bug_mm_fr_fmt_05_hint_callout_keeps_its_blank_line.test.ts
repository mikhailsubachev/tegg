// QA review of slice MM: the rule that a mindmap's list follows its title line directly (D-765) removed the blank `>`
// line after the title of every `[!mindmap]` callout, also a hint callout whose body is text (D-680). Such a callout
// then failed save verification and opened as a source block. The rule applies only when the body starts with a list.
// FR-FMT-05 AC-4, FR-FMT-07.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { TextSelection } from '@tiptap/pm/state'
import { body, open, type } from './helpers'

const HEAD = '---\nid: 01JB0Z00000000000000000077\ntype: page\ntitle: Nápověda\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-20T09:00:00+02:00\n---\n'

test('bug_mm_fr_fmt_05_hint_callout_with_a_blank_line_is_edited_in_place', async () => {
  const ed = await open(`${HEAD}> [!mindmap] Nápověda\n>\n> Jen text.\n`)
  assert.equal(ed.view.state.doc.child(0).type.name, 'callout', 'the hint callout is an editable callout, not a source block')
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => { if (pos < 0 && n.isText && n.text.includes('Jen text')) pos = p + 'Jen text'.length; return pos < 0 })
  assert.ok(pos >= 0, 'the body text is editable')
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)))
  type(ed, ' a víc')
  const out = await ed.save()
  assert.ok(out !== null, 'saved')
  assert.equal(await body(out!), '> [!mindmap] Nápověda\n>\n> Jen text a víc.\n', 'the blank `>` line after the title stays')
})
