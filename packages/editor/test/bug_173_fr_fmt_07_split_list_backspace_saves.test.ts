// Issue #173 (slice AND-3): in tests/fixtures/vaults/phone-edit/Pages/Psaní.md, a Backspace at the start of `chléb`
// (the second item of the loose list `- mléko\n- chléb\n\n- [ ] Zavolat\n- [x] Hotovo`) lifts it out of the list, which
// splits the list in two. Both halves carry the list's `srcIndex` and its `spread: true`; the first half `- mléko` can
// never read back as a loose list, so verification failed and the app showed "Tegg couldn't save this change
// safely…" and wrote nothing. The edit must save, and only the lines it changed may change (FR-FMT-07, FR-SYN-06;
// FR-EDT-01 AC-19 of docs/acceptance/android-edit.md).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, press, readFixture } from './helpers'

const PSANI = 'tests/fixtures/vaults/phone-edit/Pages/Psaní.md'

function caretIn(ed: any, word: string, offset: number | 'end') {
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos < 0 && n.isText && n.text.includes(word)) pos = p + n.text.indexOf(word) + (offset === 'end' ? word.length : offset)
    return pos < 0
  })
  assert.ok(pos >= 0, `${word} found`)
  const Sel = ed.view.state.selection.constructor as any
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.near(ed.view.state.doc.resolve(pos))))
}

test('bug_173_fr_fmt_07_backspace_lifting_a_list_item_saves', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'první', 0)
  press(ed, 'Backspace') // lifts první out of the numbered list
  caretIn(ed, 'chléb', 0)
  press(ed, 'Backspace') // lifts chléb: the list splits into `- mléko` and the two checklist items
  const out = await ed.save()
  assert.ok(out, 'saved')
  const want = (await body(text))
    .replace('- mléko\n- chléb\n', '- mléko\n\nchléb\n')
    .replace('1. první\n2. druhý\n', 'první\n\n1. druhý\n')
  assert.equal(await body(out!), want, 'only the lifted items and the lines around them change; `- [ ] Zavolat\\n- [x] Hotovo` keeps its bytes')
  ed.destroy()
})

test('bug_173_fr_fmt_07_backspace_lifting_the_second_item_alone_saves', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'chléb', 0)
  press(ed, 'Backspace')
  const out = await ed.save()
  assert.ok(out, 'saved')
  assert.equal(await body(out!), (await body(text)).replace('- mléko\n- chléb\n', '- mléko\n\nchléb\n'), 'only chléb leaves the list')
  ed.destroy()
})

test('bug_173_fr_fmt_07_enter_on_an_empty_item_then_backspace_saves', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'mléko', 'end')
  press(ed, 'Enter')
  press(ed, 'Enter') // the empty item is lifted: the list splits around an empty paragraph
  caretIn(ed, 'chléb', 0)
  press(ed, 'Backspace')
  const out = await ed.save()
  assert.ok(out, 'saved')
  const saved = await body(out!)
  assert.ok(saved.includes('- [ ] Zavolat\n- [x] Hotovo\n'), `the checklist items keep their bytes: ${JSON.stringify(saved)}`)
  assert.ok(saved.startsWith('# Nákup\n\n- mléko\n'), `mléko stays an item: ${JSON.stringify(saved)}`)
  // whatever ProseMirror made of the edit, the file reads back as the editor shows it (verify passed)
  const again = await open(out!)
  assert.equal(again.view.state.doc.textContent, ed.view.state.doc.textContent, 'the saved file reads back as the editor')
  again.destroy()
  ed.destroy()
})
