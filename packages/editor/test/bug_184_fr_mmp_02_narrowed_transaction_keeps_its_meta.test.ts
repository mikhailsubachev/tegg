// Issue #184 (QA review of slice AND-3, finding 12): with `protectMindmaps` (android-edit §5.2, FR-MMP-02 AC-37) a
// transaction across a mindmap callout is narrowed to the text outside it. When a later step no longer applied to the
// narrowed document, `narrow()` returned the partial transaction at once, without the original's meta, time and
// selection, so plugins reading the meta (history grouping, `addToHistory`, the app's own marks) saw another
// transaction. The narrowed transaction keeps them whatever its steps.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { TextSelection } from '@tiptap/pm/state'
import { Step, StepMap, StepResult } from '@tiptap/pm/transform'
import { blockStart, editorModule, newId, NOW, readFixture, type TeggEditor } from './helpers'

const MAPA = readFixture('tests/fixtures/vaults/phone-edit/Pages/Mapa v textu.md')

/** A step that applies once (in the original transaction) and fails after that (in the narrowed one). */
class OnceStep extends Step {
  private used = false
  apply(doc: any) {
    if (this.used) return StepResult.fail('applied once')
    this.used = true
    return StepResult.ok(doc)
  }
  getMap() { return StepMap.empty }
  invert() { return this }
  map() { return this }
  toJSON() { return { stepType: 'bug184Once' } }
}

test('bug_184_fr_mmp_02_narrowed_transaction_keeps_meta_time_and_selection_when_a_step_fails', async () => {
  const m = await editorModule()
  const ed = (m.createEditor as unknown as (o: Record<string, unknown>) => TeggEditor & { editor: any })({ text: MAPA, now: () => NOW, newId, protectMindmaps: true })
  const seen: { meta: unknown; time: number }[] = []
  ed.editor.on('transaction', ({ transaction }: { transaction: any }) => { if (transaction.docChanged) seen.push({ meta: transaction.getMeta('bug184'), time: transaction.time }) })
  const st = ed.view.state
  // Delete from the start of `Před mapou.` across the callout to `Po| mapě.`, then a step that fails when narrowed.
  const tr = st.tr.delete(blockStart(ed, 0) + 1, blockStart(ed, 2) + 3)
  tr.step(new OnceStep())
  tr.setMeta('bug184', 'kept')
  tr.setTime(424242)
  ed.view.dispatch(tr)
  assert.equal(seen.length, 1, 'one transaction changed the document')
  assert.equal(seen[0].meta, 'kept', 'the narrowed transaction keeps the original\'s meta')
  assert.equal(seen[0].time, 424242, 'and its time')
  const sel = ed.view.state.selection
  assert.ok(sel instanceof TextSelection, 'the caret is a text selection outside the map')
  ed.destroy()
})
