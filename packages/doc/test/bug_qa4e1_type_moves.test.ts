// Regression tests for the QA review of slice 4E-1 (qa/reviews/4e-1-type-moves.md): Content lines keep the stored text
// of non-string scalars (finding 7, D-813), a mapped property whose target key is taken goes into the content (18),
// keep-targets uses `\|` in a table and changes only the target's bytes (17), and hold-targets keeps a link to a
// duplicate on its target when a same-stem note moves next to it (11, D-838).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { transform, type Transformed } from '../src/index.js'

const out = (t: Transformed) => (t.kind === 'bytes' ? t.text : null)

test('bug_qa4e1_fr_sto_04_ac6_content_lines_keep_the_stored_scalar_text', () => {
  const t = '---\nid: x\ntype: kniha\nkód: 0123\ncena: 1.50\nbarva: 0x1F\nvelké: 12345678901234567890\nseznam: [01, "a"]\n---\nText.\n'
  const got = out(transform('Knihy/A.md', t, [{ op: 'map-properties', map: ['kód', 'cena', 'barva', 'velké', 'seznam'].map((from) => ({ from, to: 'content' })), labels: {} }]))
  assert.equal(got, '---\nid: x\ntype: kniha\n---\n**kód:** 0123\n**cena:** 1.50\n**barva:** 0x1F\n**velké:** 12345678901234567890\n**seznam:** 01, a\n\nText.\n')
})

test('bug_qa4e1_fr_sto_04_ac6_a_taken_target_key_goes_into_the_content', () => {
  const t = '---\nid: x\nautor: Herbert\nmísto: Brno\n---\nText.\n'
  const got = out(transform('Knihy/A.md', t, [{ op: 'map-properties', map: [{ from: 'autor', to: 'místo' }], labels: { autor: 'Autor' } }]))
  assert.equal(got, '---\nid: x\nmísto: Brno\n---\n**Autor:** Herbert\n\nText.\n', 'nothing is lost or left under the old key')
})

test('bug_qa4e1_fr_sto_04_ac8_keep_targets_escapes_the_pipe_in_a_table_and_keeps_nfd_bytes', () => {
  const nfdAlias = 'Plán'.normalize('NFD')
  const t = `---\nid: x\n---\n| a | b |\n| - | - |\n| [[Plán cesty]] | [[Plán cesty#${nfdAlias}]] |\n`
  const paths = ['Quick Notes/A.md', 'Quick Notes/Plán cesty.md', 'Pages/Plán cesty.md']
  const got = out(transform('Quick Notes/A.md', t, [{ op: 'keep-targets', fromPath: 'Quick Notes/A.md', toPath: 'Knihy/A.md', paths }])) ?? ''
  assert.ok(got.includes('[[Quick Notes/Plán cesty\\|Plán cesty]]'), `escaped pipe in the cell: ${got}`)
  assert.ok(got.includes(`#${nfdAlias}`), 'the heading part keeps its NFD bytes')
})

test('bug_qa4e1_fr_sto_04_ac7_hold_targets_keeps_a_link_to_a_duplicate', () => {
  // [[Plán cesty]] in Knihy/ resolves to Pages/ (shorter path); after Quick Notes/Plán cesty moves into Knihy/ the same
  // name would resolve to the moved note (same folder first, D-291): the link gets the path form of its old target.
  const t = '---\nid: y\n---\nViz [[Plán cesty]].\n'
  const paths = ['Knihy/Odkaz.md', 'Quick Notes/Plán cesty.md', 'Pages/Plán cesty.md']
  const got = out(transform('Knihy/Odkaz.md', t, [{ op: 'hold-targets', fromPath: 'Quick Notes/Plán cesty.md', toPath: 'Knihy/Plán cesty.md', paths }]))
  assert.equal(got, '---\nid: y\n---\nViz [[Pages/Plán cesty|Plán cesty]].\n')
})
