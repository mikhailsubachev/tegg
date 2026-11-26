// Slice AND-3 report (2026-11-26): in a list with mixed spacing (`- mléko\n- chléb\n\n- [ ] Zavolat\n- [x] Hotovo`,
// tests/fixtures/vaults/phone-edit/Pages/Psaní.md), typing one character in `chléb` re-rendered the whole list, and
// since Markdown reads the list as loose, every item got a blank line after it, the untouched ones too. Only the edited
// item may change (FR-FMT-07, FR-SYN-06; FR-EDT-01 AC-16 of docs/acceptance/android-edit.md).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, readFixture, type } from './helpers'

function caretIn(ed: any, word: string, offset: number) {
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => { if (pos < 0 && n.isText && n.text.includes(word)) pos = p + n.text.indexOf(word) + offset; return pos < 0 })
  assert.ok(pos >= 0, `${word} found`)
  const Sel = ed.view.state.selection.constructor as any
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.near(ed.view.state.doc.resolve(pos))))
}

test('bug_and3_fr_fmt_07_tight_mixed_list_split_on_edit', async () => {
  const text = readFixture('tests/fixtures/vaults/phone-edit/Pages/Psaní.md')
  const ed = await open(text)
  caretIn(ed, 'chléb', 2)
  type(ed, 'X')
  const out = await ed.save()
  assert.ok(out, 'saved')
  assert.equal(await body(out!), (await body(text)).replace('- chléb\n', '- chXléb\n'), 'only the X changes; the list keeps its spacing')
  ed.destroy()
})

test('bug_and3_fr_fmt_07_tight_mixed_list_split_on_edit_ordered_and_nested', async () => {
  const head = '---\nid: 01JB0Z00000000000000000098\ntype: page\ntitle: Seznam\ncreated: 2026-11-26T09:00:00+01:00\nmodified: 2026-11-26T09:00:00+01:00\n---\n'
  for (const [list, word, want] of [
    ['3. tři\n4. čtyři\n\n5. pět\n', 'čtyři', '3. tři\n4. čtXyři\n\n5. pět\n'],
    ['- a\n  - vnořená\n\n- b\n', 'vnořená', '- a\n  - vnXořená\n\n- b\n'],
    ['* hvězda\n* druhá\n\n* třetí\n', 'druhá', '* hvězda\n* drXuhá\n\n* třetí\n'],
  ] as const) {
    const ed = await open(head + list)
    caretIn(ed, word, 2)
    type(ed, 'X')
    const out = await ed.save()
    assert.equal(await body(out ?? ''), want, `only the X changes in ${JSON.stringify(list)}`)
    ed.destroy()
  }
})
