// PR #47 QA review (minors), FR-TSK-05 AC-4, D-230, D-478: task edits change only what they mean to.
// 1. A tag move keeps the `tags:` entries it doesn't touch byte for byte (numbers, nulls, quoting, flow and block).
// 2. CRLF files keep CRLF; a file with invalid frontmatter is never written (NFR-REL-03).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyTaskChange, completeTask, parse } from '../src/index.js'

const fm = (tags: string, eol = '\n') => `---${eol}id: 01JB5A0000000000000000Q100${eol}type: task${eol}title: Úkol${eol}status: To do${eol}${tags}modified: 2026-10-01T09:00:00+02:00${eol}---${eol}Tělo #rodina${eol}`
const move = (text: string, from: string | null, to: string) => applyTaskChange(text, { kind: 'moveTag', from, to })?.text ?? null
const DEFS = { statuses: [{ label: 'To do', color: null, state: 'open', stateRaw: 'open' }, { label: 'Done', color: null, state: 'done', stateRaw: 'done' }], priorities: [], unknownStates: [] } as any

test('bug_47_fr_tsk_05_flow_tags_keep_untouched_entries', () => {
  assert.equal(move(fm('tags: [2024, doma]\n'), 'doma', 'práce'), fm('tags: [2024, práce]\n'), 'a number stays unquoted')
  assert.equal(move(fm('tags: [~, doma, "a, b"]\n'), 'doma', 'práce'), fm('tags: [~, "a, b", práce]\n'), 'a null and a quoted entry stay as written')
  assert.equal(move(fm("tags: ['Doma', x]\n"), 'doma', 'práce'), fm('tags: [x, práce]\n'), 'the moved entry goes, the rest keeps its bytes')
})

test('bug_47_fr_tsk_05_block_tags_keep_untouched_entries', () => {
  assert.equal(move(fm('tags:\n  - 2024\n  - doma\n  - "a: b"\n'), 'doma', 'práce'), fm('tags:\n  - 2024\n  - "a: b"\n  - práce\n'), 'block items keep their lines')
})

test('bug_47_fr_tsk_05_crlf_files_keep_crlf', () => {
  const crlf = fm('tags: [doma]\r\n', '\r\n')
  const out = move(crlf, 'doma', 'práce')
  assert.ok(out && !/[^\r]\n/.test(out), `only CRLF line ends: ${JSON.stringify(out)}`)
  assert.ok(out!.includes('tags: [práce]\r\n'))
  const done = completeTask(crlf, DEFS, true, '2026-10-14T12:00:00+02:00')
  assert.ok(done && !/[^\r]\n/.test(done) && done.includes('status: Done\r\n') && done.includes('completed: 2026-10-14T12:00:00+02:00\r\n'), `checkbox on CRLF: ${JSON.stringify(done)}`)
})

test('bug_47_fr_tsk_02_invalid_frontmatter_is_never_written', () => {
  const bad = '---\nid: x\ntype: task\ntitle: [nezavřeno\nstatus: To do\n---\nTělo\n'
  assert.equal(applyTaskChange(bad, { kind: 'priority', to: 'High' }), null, 'no edit of invalid YAML (NFR-REL-03)')
  assert.equal(completeTask(bad, DEFS, true, '2026-10-14T12:00:00+02:00'), null, 'no checkbox write either')
})

// Second review: items the in-place splitter can't read must never leave the moved tag behind (it falls back to a
// re-render instead): an apostrophe inside an unquoted word, `\\` before a closing quote, boolean tags.
const tagsOf = (text: string | null) => (parse(text ?? '').frontmatter?.data?.tags as unknown[] | undefined)?.map((x) => String(x))

test('bug_47_fr_tsk_05_odd_flow_items_never_keep_the_moved_tag', () => {
  assert.deepEqual(tagsOf(move(fm("tags: [don't, doma]\n"), 'doma', 'práce')), ["don't", 'práce'], 'an apostrophe in a word')
  assert.deepEqual(tagsOf(move(fm('tags: ["C:\\\\", doma]\n'), 'doma', 'práce')), ['C:\\', 'práce'], 'an escaped backslash before a closing quote')
  assert.deepEqual(tagsOf(move(fm('tags: [true, x]\n'), 'true', 'y')), ['x', 'y'], 'a boolean tag')
})
