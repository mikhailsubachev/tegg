// Found by the push gate's property run (seed 241404554, FR-FMT-07 AC-15): deleting a block embed from between two
// `-` lists that both hold an embed line writes a `<!-- -->` line between them (neither list is re-marked, so both
// embed lines keep their bytes; D-67, D-1020). On reopen that separator showed as a read-only source block; it is
// hidden like the one before indented code, and its bytes stay in the file.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open } from './helpers'

const LIST = '- položka jedna\n- položka ![[Jana Nováková]]'
const TEXT = '---\nid: 01JB5A0000000000000000B002\ntype: page\ntitle: Hostitel\nmodified: 2026-10-01T09:00:00+02:00\n---\n'
  + `${LIST}\n\n![[Cíl|card]]\n\n${LIST}\n`

const topLevel = (ed: any) => {
  const out: string[] = []
  ed.editor.state.doc.forEach((n: any) => out.push(n.type.name === 'rawBlock' ? `raw:${n.attrs.source}` : n.type.name))
  return out
}

test('bug_g1_fr_fmt_07_lists_with_embed_lines_meet_behind_a_hidden_separator', async () => {
  const ed: any = await open(TEXT)
  assert.equal(ed.commands.selectBlockAt(1), true, 'select the embed block')
  assert.equal(ed.commands.deleteBlocks(), true, 'delete it')
  const out = await ed.save()
  assert.ok(out !== null, 'saved')
  assert.deepEqual(await body(out!), `${LIST}\n\n<!-- -->\n\n${LIST}\n`, 'both lists keep their bytes, separated by <!-- -->')

  const reopened: any = await open(out!)
  assert.deepEqual(topLevel(reopened), ['bulletList', 'bulletList'], 'the separator is not shown')
  assert.equal(await reopened.save(), null, 'saving without edits writes nothing')

  // Deleting one of the lists drops the separator with it.
  assert.equal(reopened.commands.selectBlockAt(1), true, 'select the second list')
  assert.equal(reopened.commands.deleteBlocks(), true, 'delete it')
  const after = await reopened.save()
  assert.deepEqual(await body(after!), `${LIST}\n`, 'one list, no separator left')
})
