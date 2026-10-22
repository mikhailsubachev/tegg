// Found by the push gate's property run (seed 873028052, FR-FMT-07 AC-15): moving a block embed away from between two
// `-` lists made them adjacent; the list separation (D-67) re-marked the list holding an embed line to `*`, so that
// embed line lost its bytes. A list with an embed line keeps its marker; the other list is re-marked instead.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open } from './helpers'

const TEXT = '---\nid: 01JB5A0000000000000000B001\ntype: page\ntitle: Hostitel\nmodified: 2026-10-01T09:00:00+02:00\n---\n'
  + '- položka jedna\n- položka ![[Jana Nováková]]\n\n![[Cíl|LINK]]\n\n- Review\n- Timeline\n'

test('bug_5a_fr_fmt_07_a_list_with_an_embed_line_keeps_its_marker_when_lists_meet', async () => {
  const ed = await open(TEXT)
  assert.equal((ed as any).commands.moveBlocksTo(1, 1, 0), true, 'move the embed block to the top')
  const out = await ed.save()
  assert.ok(out !== null, 'saved')
  assert.ok(out!.includes('- položka jedna\n- položka ![[Jana Nováková]]\n'), `the list with the embed line keeps its bytes: ${JSON.stringify(await body(out!))}`)
  const reopened = await open(out!)
  const lists: string[] = []
  ;(reopened as any).editor.state.doc.forEach((n: any) => { if (/List$/.test(n.type.name)) lists.push(n.type.name) })
  assert.equal(lists.length, 2, 'the two lists stay two lists')
})
