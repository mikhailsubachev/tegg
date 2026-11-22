// Slice Q2-T, L1: the bytes of every period-board write, through the real @tegg/doc (docs/contracts/v1-views.md §26
// `applyPeriodMove`; D-82 one text engine, D-230 minimal edits, D-472 `completed`, FR-FMT-11 dates without time).
// FR-TSK-04 AC-25 (a)…(g) (period drags, the done lane, out of it; Los Angeles; en-US), FR-TSK-05 AC-20 (status moves
// on a `status` that carries states: `completed` set / removed, tasks.md FR-TSK-05 AC-2's bytes), FR-FMT-12 AC-14 (an NFD
// task keeps its NFD bytes). Inputs: tests/fixtures/vaults/tasks (+ views-tasks for Zahrada); expected bytes:
// tests/fixtures/queries-files/expected/views-tasks/. A write is `applyPeriodMove` (or `applyTaskChange`) followed by
// `touchModified(before, after, now)`, as the §26 write path composes them. Written from docs/acceptance/views.md part
// three and the contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const TASK = (title: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tasks/Tasks', `${title}.md`), 'utf8')
const FX = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults', rel), 'utf8')
const EXPECTED = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/queries-files/expected/views-tasks', rel), 'utf8')
const NOW = '2026-10-14T12:00:00+02:00'
const NOW_LA = '2026-10-14T03:00:00-07:00'

type Mod = Record<string, any>
type Move = { kind: 'set'; key: string; date: string | null } | { kind: 'done'; status: string; now: string } | { kind: 'reopen'; status: string; key: string; date: string | null }
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  assert.equal(typeof m.applyPeriodMove, 'function', '@tegg/doc exports applyPeriodMove (v1-views §26)')
  assert.equal(typeof m.touchModified, 'function', '@tegg/doc exports touchModified')
  return m
}
/** One period write as the write path does it; null = nothing to write. */
async function move(text: string, mv: Move, now = NOW): Promise<string | null> {
  const m = await doc()
  const r = m.applyPeriodMove(text, mv)
  return r === null ? null : m.touchModified(text, r, now)
}
function sw(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `fixture text contains ${JSON.stringify(from)}`)
  return text.replace(from, to)
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-25

test('fr_tsk_04_ac25_period_drags_write_due_once', async () => {
  const set = (date: string | null): Move => ({ kind: 'set', key: 'due', date })
  // (a) T08 from Not scheduled onto pátek 16.: `due` appended after the last entry (D-230).
  assert.equal(await move(TASK('Přečíst knihu'), set('2026-10-16')), EXPECTED('tasks/precist-knihu-due-16.md'), '(a) due: 2026-10-16 appended')
  // (b) T07 from Later onto Today & overdue, in Prague and in Los Angeles (the local date, never shifted).
  assert.equal(await move(TASK('Obnovit pas'), set('2026-10-14')), EXPECTED('tasks/obnovit-pas-due-14.md'), '(b) due: 2026-12-01 → 2026-10-14')
  assert.equal(await move(TASK('Obnovit pas'), set('2026-10-14'), NOW_LA), EXPECTED('tasks/obnovit-pas-due-14-la.md'), '(b) Los Angeles: the same date, modified …T03:00:00-07:00')
  // (c) T03 onto Later: the first day after the week (cs Monday 19; en-US Sunday 18).
  assert.equal(await move(TASK('Zalít květiny'), set('2026-10-19')), EXPECTED('tasks/zalit-kvetiny-due-19.md'), '(c) cs')
  assert.equal(await move(TASK('Zalít květiny'), set('2026-10-18')), EXPECTED('tasks/zalit-kvetiny-due-18-en-us.md'), '(c) en-US')
  // (d) T04 onto Not scheduled: the line removed.
  assert.equal(await move(TASK('Koupit dárek'), set(null)), EXPECTED('tasks/koupit-darek-no-due.md'), '(d) the due line removed')
  // (e) T02 onto Done: completeTask's bytes, due kept.
  assert.equal(await move(TASK('Poslat rozpočet'), { kind: 'done', status: 'Done', now: NOW }), EXPECTED('tasks/poslat-rozpocet-done.md'), '(e) status Done, completed appended')
  // (f) T12 from Done onto Today & overdue: status To do and due in one text.
  assert.equal(await move(TASK('Vrátit knihy'), { kind: 'reopen', status: 'To do', key: 'due', date: '2026-10-14' }), EXPECTED('tasks/vratit-knihy-reopened.md'), '(f) To do, due appended')
  // (g) T16 (2026-02-30) onto čtvrtek 15.: the invalid value replaced.
  assert.equal(await move(TASK('Špatné datum'), set('2026-10-15')), EXPECTED('tasks/spatne-datum-due-15.md'), '(g) due: 2026-10-15')
  // A same-lane drop: the same valid date already there, or no key to remove, writes nothing.
  const m = await doc()
  assert.equal(m.applyPeriodMove(TASK('Zalít květiny'), set('2026-10-14')), null, 'the same date: null')
  assert.equal(m.applyPeriodMove(TASK('Přečíst knihu'), set(null)), null, 'no due to remove: null')
  // Any form of the old value is replaced by `YYYY-MM-DD` unquoted, the line's other bytes kept.
  const t03 = TASK('Zalít květiny')
  const forms: [string, string][] = [
    ['due: "2026-10-14"\n', 'due: 2026-10-19\n'],
    ["due: '2026-10-14'   # termín\n", 'due: 2026-10-19   # termín\n'],
    ['due: 2026-10-14T09:00:00+02:00\n', 'due: 2026-10-19\n'],
  ]
  for (const [from, to] of forms) {
    const input = sw(t03, 'due: 2026-10-14\n', from)
    assert.equal(await move(input, set('2026-10-19')), sw(sw(input, from, to), 'modified: 2026-10-01T09:00:00+02:00', `modified: ${NOW}`), `the value ${JSON.stringify(from)} replaced`)
  }
  const block = sw(t03, 'due: 2026-10-14\n', 'due:\n  2026-10-14\n')
  const nb = await move(block, set(null))
  assert.ok(nb !== null && !/^due:/m.test(nb) && !nb.includes('  2026-10-14'), `a block value goes with its lines: ${JSON.stringify(nb)}`)
  // CRLF files keep CRLF.
  const crlf = t03.replace(/\n/g, '\r\n')
  const out = await move(crlf, set('2026-10-19'))
  assert.equal(out, EXPECTED('tasks/zalit-kvetiny-due-19.md').replace(/\n/g, '\r\n'), 'CRLF kept')
  // Projekt: Zahrada (no due) onto Later appends; Web onto No Due date removes (FR-QRY-01 AC-17's bytes).
  assert.equal(await move(FX('views-tasks/Projekty/Zahrada.md'), set('2026-10-19')), EXPECTED('projekty/zahrada-later.md'), 'Zahrada onto Later')
  assert.equal(await move(FX('tasks/Projekty/Web.md'), set(null)), EXPECTED('projekty/web-no-due.md'), 'Web onto No Due date')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-20

test('fr_tsk_05_ac20_kanban_drags_and_lane_order', async () => {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  assert.equal(typeof m.applyTaskChange, 'function', '@tegg/doc exports applyTaskChange')
  const write = (text: string, change: Record<string, unknown>) => {
    const r = m.applyTaskChange(text, change)
    return r === null ? null : (m.touchModified(text, r.text, NOW) as string)
  }
  const t03 = TASK('Zalít květiny')
  const st = (to: string, toState: string, fromState: string) => ({ kind: 'status', to, toState, fromState, firstOpen: 'To do', now: NOW })
  assert.equal(write(t03, st('In progress', 'in-progress', 'open')), sw(sw(t03, 'status: To do', 'status: In progress'), 'modified: 2026-10-01T09:00:00+02:00', `modified: ${NOW}`), 'To do → In progress: status and modified only')
  const done = write(t03, st('Done', 'done', 'open'))
  assert.equal(done, sw(sw(t03, 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', `modified: ${NOW}\ncompleted: ${NOW}\n`), 'onto Done: completed appended (D-472)')
  const back = write(done!, st('To do', 'open', 'done'))
  assert.ok(back !== null && !/^completed:/m.test(back) && /^status: To do$/m.test(back), 'from Done back to To do: completed removed')
  // A period move onto the done lane and back out of it is one text each (applyPeriodMove, §26).
  const pm = await doc()
  const d = pm.applyPeriodMove(t03, { kind: 'done', status: 'Done', now: NOW })
  assert.ok(typeof d === 'string' && /^status: Done$/m.test(d) && d.includes(`completed: ${NOW}\n`) && d.includes('due: 2026-10-14\n'), 'done: status, completed, due untouched')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-14

test('fr_fmt_12_ac14_q2t_names_and_tags_are_nfc', async () => {
  const nakup = TASK('Nákup')
  assert.ok(nakup.includes('Nákup'.normalize('NFD')), 'setup check: the fixture title is NFD')
  const out = await move(nakup, { kind: 'set', key: 'due', date: '2026-10-19' })
  assert.equal(out, EXPECTED('tasks/nakup-later.md'), 'T19 onto Later: due written, NFD title and tag bytes kept')
  assert.ok(out!.includes('title: ' + 'Nákup'.normalize('NFD')), 'the NFD title stays NFD')
})
