// Issue #176 (slice AND-3, found from LA `fr_edt_01_ac19` (d)/(e)): in tests/fixtures/vaults/phone-edit/Pages/Psaní.md
// the list `- mléko\n- chléb\n\n- [ ] Zavolat\n- [x] Hotovo` is loose (one blank line). Adding an item changed the
// list's item count, so the save rendered the whole list and wrote a blank line after every item: untouched items'
// spacing changed (FR-FMT-07, FR-SYN-06). A changed bullet list keeps every untouched item's bytes, its marker and the
// gaps between untouched items; a new item takes its neighbour's marker and gap.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, press, readFixture, type } from './helpers'

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

async function saved(ed: any): Promise<string> {
  const out = await ed.save()
  assert.ok(out, 'saved')
  const again = await open(out)
  assert.equal(again.view.state.doc.textContent, ed.view.state.doc.textContent, 'the saved file reads back as the editor')
  again.destroy()
  return body(out)
}

test('bug_176_fr_fmt_07_new_checklist_item_keeps_the_other_items_bytes', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'Zavolat', 'end')
  press(ed, 'Enter')
  type(ed, 'Nové')
  assert.equal(await saved(ed), (await body(text)).replace('- [ ] Zavolat\n', '- [ ] Zavolat\n- [ ] Nové\n'), 'only the new line is added')
  ed.destroy()
})

test('bug_176_fr_fmt_07_new_item_after_the_first_and_the_last_item', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'mléko', 'end')
  press(ed, 'Enter')
  type(ed, 'máslo')
  caretIn(ed, 'Hotovo', 'end')
  press(ed, 'Enter')
  type(ed, 'Další')
  assert.equal(
    await saved(ed),
    (await body(text)).replace('- mléko\n', '- mléko\n- máslo\n').replace('- [x] Hotovo\n', '- [x] Hotovo\n- [ ] Další\n'),
    'the new items take their neighbours\' gaps; the blank line stays where it was',
  )
  ed.destroy()
})

test('bug_176_fr_fmt_07_new_item_after_an_edited_item', async () => {
  const text = readFixture(PSANI)
  const ed = await open(text)
  caretIn(ed, 'chléb', 'end')
  type(ed, 'chléb') // what a composition that duplicated the word left (LA fr_edt_01_ac19 (d))
  caretIn(ed, 'Zavolat', 'end')
  press(ed, 'Enter')
  type(ed, 'Nové')
  assert.equal(
    await saved(ed),
    (await body(text)).replace('- chléb\n', '- chlébchléb\n').replace('- [ ] Zavolat\n', '- [ ] Zavolat\n- [ ] Nové\n'),
    'the edited and the new item change; the others keep their bytes',
  )
  ed.destroy()
})

test('bug_176_fr_fmt_07_star_list_keeps_its_marker_and_spacing', async () => {
  const fm = '---\nid: 01JB0Z00000000000000000176\ntype: page\ntitle: Hvězdy\ncreated: 2026-10-13T09:00:00+02:00\nmodified: 2026-10-13T09:00:00+02:00\n---\n'
  const src = '* jedna\n* dvě\n\n* tři\n'
  const ed = await open(fm + src)
  caretIn(ed, 'dvě', 'end')
  press(ed, 'Enter')
  type(ed, 'nová')
  assert.equal(await saved(ed), '* jedna\n* dvě\n* nová\n\n* tři\n')
  ed.destroy()
})

test('bug_176_fr_fmt_07_removed_item_keeps_the_other_items_bytes', async () => {
  const text = readFixture(PSANI)
  const was = '- mléko\n- chléb\n\n- [ ] Zavolat\n- [x] Hotovo\n'
  for (const [word, want] of [['chléb', '- mléko\n\n- [ ] Zavolat\n- [x] Hotovo\n'], ['Zavolat', '- mléko\n- chléb\n\n- [x] Hotovo\n']] as const) {
    const ed: any = await open(text)
    let range: [number, number] | null = null
    ed.view.state.doc.descendants((n: any, p: number) => {
      if (!range && n.type.name === 'listItem' && n.textContent === word) range = [p, p + n.nodeSize]
      return !range
    })
    assert.ok(range, `${word} item found`)
    ed.view.dispatch(ed.view.state.tr.delete(range![0], range![1]))
    assert.equal(await saved(ed), (await body(text)).replace(was, want), `${word} removed; the others keep their bytes`)
    ed.destroy()
  }
})
