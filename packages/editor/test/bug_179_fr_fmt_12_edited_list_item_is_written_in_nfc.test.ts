// Issue #179 (QA review of slice AND-3, finding 4; owner D-2570 (3)): `listItemPatch` wrote a changed list item as
// rendered, without NFC, while `paragraphPatch` normalises its changed span; an edited NFD item kept its NFD text and
// link target. FR-FMT-12 (CLAUDE.md rule 9): a changed item is written in NFC, its link target too; the untouched items
// keep their bytes (FR-FMT-07, FR-SYN-06).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, type } from './helpers'

const nfd = (s: string) => s.normalize('NFD')
const FM = '---\ntitle: Seznam\n---\n'

function caretAfter(ed: any, word: string) {
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos < 0 && n.isText && n.text.normalize('NFC').includes(word)) pos = p + n.text.normalize('NFC').indexOf(word) + word.length
    return pos < 0
  })
  assert.ok(pos >= 0, `${word} found`)
  const Sel = ed.view.state.selection.constructor as any
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.near(ed.view.state.doc.resolve(pos))))
}

test('bug_179_fr_fmt_12_edited_nfd_list_item_is_written_in_nfc', async () => {
  const first = nfd('- Kočka první\n')
  const second = nfd('- Čaj [[Café]] tady\n')
  const third = nfd('- Žába třetí\n')
  const text = `${FM}${first}${second}${third}`
  const ed = await open(text)
  caretAfter(ed, 'tady')
  type(ed, 'x')
  const out = await ed.save()
  assert.ok(out, 'saved')
  const want = `${first}${'- Čaj [[Café]] tadyx\n'.normalize('NFC')}${third}`
  assert.equal(await body(out!), want, 'the edited item and its link target in NFC; the other items byte-exact (NFD)')
  assert.ok(out!.includes('[[Café]]'.normalize('NFC')), 'the link target is NFC')
  assert.ok(out!.includes(first) && out!.includes(third), 'the untouched items keep their NFD bytes')
  ed.destroy()
})
