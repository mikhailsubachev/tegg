// MS5 slice 5A-1, L1: the bytes of every task write, through the real @tegg/doc (docs/contracts/ms5-tasks.md §5; D-82
// one text engine, D-230 minimal edits, D-470, D-472, D-478). FR-TSK-01 AC-2 (due line), AC-3 (`recurrence` kept),
// AC-4 (`completed` rule, both zones), AC-5 (no write shifts `due`); FR-TSK-02 AC-10 (checkbox and status); FR-TSK-03
// AC-3 (`No priority`); FR-TSK-05 AC-2 (status drag), AC-4 (tag move), AC-5 (Alt adds), AC-6 (inline tags stay);
// FR-TSK-10 AC-1 (`newObject` with values). Fixture bytes from tests/fixtures/vaults/tasks. Written from
// docs/acceptance/tasks.md and the contract only (D-61). The module loads inside each test (TS-I1).
//
// A write is `applyTaskChange` (or `completeTask`) followed by `touchModified(before, after, now)`, as the §5 write path
// composes them; `touchModified` is idempotent, so the result is the same whether or not the change set `modified`.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const F = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tasks', rel), 'utf8')
const NOW = '2026-10-14T12:00:00+02:00'
const NOW_LA = '2026-10-14T03:00:00-07:00'
const LATER = '2026-10-14T12:05:00+02:00'
const OLD_MOD = 'modified: 2026-10-01T09:00:00+02:00\n'

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  assert.equal(typeof m.applyTaskChange, 'function', '@tegg/doc exports applyTaskChange (ms5-tasks §5)')
  assert.equal(typeof m.completeTask, 'function', '@tegg/doc exports completeTask')
  return m
}
type State = 'open' | 'in-progress' | 'done' | 'cancelled'
const STATUSES: { label: string; color: string; state: State }[] = [
  { label: 'To do', color: 'gray', state: 'open' }, { label: 'In progress', color: 'blue', state: 'in-progress' }, { label: 'Waiting', color: 'yellow', state: 'open' },
  { label: 'Done', color: 'green', state: 'done' }, { label: 'Cancelled', color: 'red', state: 'cancelled' },
]
const DEFS = {
  statuses: STATUSES.map((s) => ({ ...s, stateRaw: s.state })),
  priorities: ['High', 'Medium', 'Low', 'None'].map((label) => ({ label, color: null })),
  unknownStates: [],
}
const stateOf = (label: string | null): State => STATUSES.find((s) => s.label === label)?.state ?? 'open'
const statusOf = (text: string) => /^status: (.*)$/m.exec(text)?.[1] ?? null

/** One §5 write: the change, then `touchModified`. `null` = nothing to write. */
async function write(text: string, change: Record<string, unknown>, now = NOW): Promise<{ text: string; inlineKept: boolean } | null> {
  const m = await doc()
  const r = m.applyTaskChange(text, change)
  if (r === null) return null
  return { text: m.touchModified(text, r.text, now), inlineKept: r.inlineKept }
}
async function setStatus(text: string, to: string, now = NOW): Promise<string | null> {
  const r = await write(text, { kind: 'status', to, toState: stateOf(to), fromState: stateOf(statusOf(text)), firstOpen: 'To do', now }, now)
  return r?.text ?? null
}
async function check(text: string, done: boolean, now = NOW, defs: unknown = DEFS): Promise<string | null> {
  const m = await doc()
  const r = m.completeTask(text, defs, done, now)
  return r === null ? null : m.touchModified(text, r, now)
}
function sw(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `fixture text contains ${JSON.stringify(from)}`)
  return text.replace(from, to)
}
const stamp = (now: string) => `modified: ${now}\n`

// ------------------------------------------------------------------------------------------------ FR-TSK-02 AC-10

test('fr_tsk_02_ac10_checking_t03_sets_done_and_completed', async () => {
  const t03 = F('Tasks/Zalít květiny.md')
  const want = sw(sw(t03, 'status: To do', 'status: Done'), OLD_MOD, `${stamp(NOW)}completed: ${NOW}\n`)
  assert.equal(await check(t03, true), want, 'status Done, completed appended after the last entry, modified updated; every other byte unchanged')
})

test('fr_tsk_02_ac10_unchecking_goes_to_the_first_open_status', async () => {
  const done = sw(sw(F('Tasks/Zalít květiny.md'), 'status: To do', 'status: Done'), OLD_MOD, `${stamp(NOW)}completed: ${NOW}\n`)
  assert.equal(await check(done, false, LATER), sw(sw(done, 'status: Done', 'status: To do'), `${stamp(NOW)}completed: ${NOW}\n`, stamp(LATER)), 'To do, completed removed')
  const waitingDone = sw(F('Tasks/Koupit dárek.md'), 'status: Waiting', 'status: Done')
  assert.equal(statusOf((await check(waitingDone, false, LATER)) ?? ''), 'To do', 'the first Open-state option, not the status it had before (D-472)')
})

test('fr_tsk_02_ac10_checking_in_progress_and_menu_status', async () => {
  const t02 = F('Tasks/Poslat rozpočet.md')
  assert.equal(await check(t02, true), sw(sw(t02, 'status: In progress', 'status: Done'), OLD_MOD, `${stamp(NOW)}completed: ${NOW}\n`), 'T02 gives status: Done')
  const t03 = F('Tasks/Zalít květiny.md')
  assert.equal(await setStatus(t03, 'Waiting'), sw(sw(t03, 'status: To do', 'status: Waiting'), OLD_MOD, stamp(NOW)), 'Status › Waiting writes only status and modified')
  assert.equal(await setStatus(t03, 'To do'), null, 'a status equal to the current one writes nothing')
  assert.equal(await check(F('Tasks/Zaplatit fakturu.md'), true), null, 'checking a Done task writes nothing')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-01

test('fr_tsk_01_ac2_setting_due_changes_only_its_line', async () => {
  const t01 = F('Tasks/Zavolat Janě.md')
  const r = await write(t01, { kind: 'due', to: '2026-10-20' })
  assert.equal(r?.text, sw(sw(t01, 'due: 2026-10-09', 'due: 2026-10-20'), OLD_MOD, stamp(NOW)), 'due: 2026-10-20 (no time, no offset, FR-FMT-11) and modified')
  const cleared = await write(t01, { kind: 'due', to: null })
  assert.equal(cleared?.text, sw(sw(t01, 'due: 2026-10-09\n', ''), OLD_MOD, stamp(NOW)), 'clearing removes the line')
})

test('fr_tsk_01_ac3_recurrence_written_elsewhere_is_kept_by_every_write', async () => {
  const rec = 'recurrence: "FREQ=WEEKLY;BYDAY=MO"\n'
  const t03 = sw(F('Tasks/Zalít květiny.md'), 'due: 2026-10-14\n', `due: 2026-10-14\n${rec}`)
  const outs = [
    await check(t03, true),
    await setStatus(t03, 'In progress'),
    (await write(t03, { kind: 'priority', to: 'High' }))?.text ?? null,
    (await write(t03, { kind: 'due', to: '2026-10-21' }))?.text ?? null,
    (await write(t03, { kind: 'moveTag', from: 'doma', to: 'práce' }))?.text ?? null,
  ]
  for (const [i, o] of outs.entries()) {
    assert.ok(o !== null, `write ${i} produced bytes`)
    assert.ok(o!.includes(`due: ${i === 3 ? '2026-10-21' : '2026-10-14'}\n${rec}`), `write ${i}: the recurrence line is kept byte for byte`)
    assert.equal(o!.split('recurrence:').length, 2, `write ${i}: no second recurrence key`)
  }
  const m = await doc()
  const fresh: string = m.newObject({ type: { key: 'task', attributes: TASK_ATTRS, review: 'off' }, title: 'Nový', template: null, now: NOW, newId: () => ID, values: [] })
  assert.ok(!/^recurrence:/m.test(fresh) && /^status: To do$/m.test(fresh), 'a new task writes no recurrence and gets To do')
})

test('fr_tsk_01_ac4_completed_rule_in_both_zones', async () => {
  const t03 = F('Tasks/Zalít květiny.md')
  const la = await check(t03, true, NOW_LA)
  assert.equal(la, sw(sw(t03, 'status: To do', 'status: Done'), OLD_MOD, `${stamp(NOW_LA)}completed: ${NOW_LA}\n`), 'Los Angeles: the clock with -07:00')
  const m = await doc()
  assert.equal(m.localIso(Date.parse(NOW), 'America/Los_Angeles'), NOW_LA, 'the stamp comes from localIso in the zone')
  // Between two Done-state statuses `completed` is kept; Cancelled neither sets nor removes it.
  const t10 = F('Tasks/Zaplatit fakturu.md')
  const m2 = await doc()
  const toDeleg = m2.applyTaskChange(t10, { kind: 'status', to: 'Delegováno', toState: 'done', fromState: 'done', firstOpen: 'To do', now: LATER })
  assert.ok(toDeleg, 'Done → Delegováno writes')
  assert.ok(toDeleg.text.includes('completed: 2026-10-14T09:30:00+02:00\n'), 'Done → Done keeps completed byte for byte')
  const cancelled = await setStatus(t10, 'Cancelled', LATER)
  assert.ok(cancelled?.includes('completed: 2026-10-14T09:30:00+02:00\n'), 'Done → Cancelled keeps it')
  const t03c = await setStatus(t03, 'Cancelled')
  assert.ok(t03c !== null && !/^completed:/m.test(t03c), 'To do → Cancelled doesn\'t set it')
  const prio = await write(t10, { kind: 'priority', to: 'Low' }, LATER)
  assert.equal(prio?.text, sw(sw(t10, 'priority: High', 'priority: Low'), 'modified: 2026-10-14T09:30:00+02:00\n', stamp(LATER)), 'another attribute keeps completed')
  const t12 = F('Tasks/Vrátit knihy.md')
  const p12 = await write(t12, { kind: 'priority', to: 'Low' }, LATER)
  assert.ok(p12 !== null && !/^completed:/m.test(p12.text), 'a write never adds or fixes completed (T12)')
})

test('fr_tsk_01_ac5_no_task_write_changes_due', async () => {
  for (const p of ['Tasks/Zalít květiny.md', 'Tasks/Špatné datum.md', 'Tasks/S časem.md']) {
    const t = F(p)
    const due = /^due: .*$/m.exec(t)![0]
    for (const out of [await check(t, true), await setStatus(t, 'In progress'), (await write(t, { kind: 'priority', to: 'High' }))?.text ?? null]) {
      assert.ok(out !== null, `${p}: a write`)
      assert.ok(out!.includes(`${due}\n`), `${p}: the due line stays byte for byte (${due})`)
    }
  }
})

// ------------------------------------------------------------------------------------------------ FR-TSK-03 AC-3

test('fr_tsk_03_ac3_priority_menu_writes', async () => {
  const t01 = F('Tasks/Zavolat Janě.md')
  assert.equal((await write(t01, { kind: 'priority', to: null }))?.text, sw(sw(t01, 'priority: High\n', ''), OLD_MOD, stamp(NOW)), 'No priority removes the line (D-230)')
  assert.equal((await write(t01, { kind: 'priority', to: 'Medium' }))?.text, sw(sw(t01, 'priority: High', 'priority: Medium'), OLD_MOD, stamp(NOW)), 'Medium replaces the value')
  assert.equal(await write(t01, { kind: 'priority', to: 'High' }), null, 'the same priority writes nothing')
  const t04 = F('Tasks/Koupit dárek.md')
  assert.equal((await write(t04, { kind: 'priority', to: 'Low' }))?.text, t04.replace(OLD_MOD, `${stamp(NOW)}priority: Low\n`), 'a missing priority is appended after the last entry')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-05

test('fr_tsk_05_ac2_status_drag_bytes', async () => {
  const t03 = F('Tasks/Zalít květiny.md')
  assert.equal(await setStatus(t03, 'In progress'), sw(sw(t03, 'status: To do', 'status: In progress'), OLD_MOD, stamp(NOW)), 'only status and modified')
  const done = await setStatus(t03, 'Done')
  assert.equal(done, sw(sw(t03, 'status: To do', 'status: Done'), OLD_MOD, `${stamp(NOW)}completed: ${NOW}\n`), 'Done sets completed')
  assert.equal(await setStatus(done!, 'To do', LATER), sw(sw(done!, 'status: Done', 'status: To do'), `${stamp(NOW)}completed: ${NOW}\n`, stamp(LATER)), 'Done → To do removes it')
  const t14 = F('Tasks/Bez stavu.md')
  assert.equal(await setStatus(t14, 'Waiting'), t14.replace(OLD_MOD, `${stamp(NOW)}status: Waiting\n`), 'T14: status appended after the last entry (D-230)')
})

test('fr_tsk_05_ac4_tag_drag_moves_the_tag', async () => {
  const mv = async (p: string, from: string | null, to: string) => (await write(F(p), { kind: 'moveTag', from, to }))
  const t04 = F('Tasks/Koupit dárek.md')
  assert.equal((await mv('Tasks/Koupit dárek.md', 'doma', 'práce'))?.text, sw(sw(t04, 'tags: [doma]', 'tags: [práce]'), OLD_MOD, stamp(NOW)), 'T04: flow style kept')
  const t05 = F('Tasks/Úklid garáže.md')
  assert.equal((await mv('Tasks/Úklid garáže.md', 'doma', 'čtení'))?.text, sw(sw(t05, 'tags: [Doma]', 'tags: [čtení]'), OLD_MOD, stamp(NOW)), 'T05: `Doma` matches case-insensitively')
  const t19 = F('Tasks/Nákup.md')
  const o19 = (await mv('Tasks/Nákup.md', 'doma', 'práce'))?.text
  assert.equal(o19, sw(sw(t19, `tags: [${'doma'.normalize('NFD')}]`, 'tags: [práce]'), OLD_MOD, stamp(NOW)), 'T19: the NFD entry is replaced by NFC `práce`, the NFD title bytes stay')
  const t02 = F('Tasks/Poslat rozpočet.md')
  assert.equal((await mv('Tasks/Poslat rozpočet.md', 'finance', 'práce'))?.text, sw(sw(t02, 'tags: [práce, finance]', 'tags: [práce]'), OLD_MOD, stamp(NOW)), 'T02 already has práce: only finance goes')
  const t07 = F('Tasks/Obnovit pas.md')
  assert.equal((await mv('Tasks/Obnovit pas.md', null, 'doma'))?.text, t07.replace(OLD_MOD, `${stamp(NOW)}tags: [doma]\n`), 'from No tag: tags appended after the last entry')
  const block = sw(F('Tasks/Koupit dárek.md'), 'tags: [doma]\n', 'tags:\n  - doma\n  - zahrada\n')
  assert.equal((await write(block, { kind: 'moveTag', from: 'doma', to: 'práce' }))?.text, sw(sw(block, '  - doma\n  - zahrada\n', '  - zahrada\n  - práce\n'), OLD_MOD, stamp(NOW)), 'block style kept')
})

test('fr_tsk_05_ac5_alt_drag_adds_only', async () => {
  const t03 = F('Tasks/Zalít květiny.md')
  assert.equal((await write(t03, { kind: 'moveTag', from: null, to: 'finance' }))?.text, sw(sw(t03, 'tags: [doma]', 'tags: [doma, finance]'), OLD_MOD, stamp(NOW)), 'tags: [doma, finance]')
  assert.equal(await write(t03, { kind: 'moveTag', from: null, to: 'Doma' }), null, 'adding a tag the task has writes nothing')
})

test('fr_tsk_05_ac6_inline_tags_stay_in_the_body', async () => {
  const t18 = F('Tasks/Štítek v textu.md')
  const r = await write(t18, { kind: 'moveTag', from: 'rodina', to: 'doma' })
  assert.equal(r?.text, sw(sw(t18, 'tags: [práce]', 'tags: [práce, doma]'), OLD_MOD, stamp(NOW)), 'tags: [práce, doma], body byte-identical')
  assert.equal(r?.inlineKept, true, 'the inline #rodina stays (D-478 note)')
  const t04 = await write(F('Tasks/Koupit dárek.md'), { kind: 'moveTag', from: 'doma', to: 'práce' })
  assert.equal(t04?.inlineKept, false, 'no inline tag: no note')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-1

const ID = '01JB5A0000000000000000N001'
const TASK_ATTRS = [
  { key: 'status', type: 'select', options: STATUSES.map((s) => ({ label: s.label, color: s.color, state: s.state })) },
  { key: 'priority', type: 'select', options: ['High', 'Medium', 'Low', 'None'].map((label) => ({ label, color: null })) },
  { key: 'due', type: 'date' },
  { key: 'completed', type: 'date-time' },
  { key: 'recurrence', type: 'recurrence' },
]

test('fr_tsk_10_ac1_new_task_bytes_with_values', async () => {
  const m = await doc()
  const out: string = m.newObject({
    type: { key: 'task', attributes: TASK_ATTRS, review: 'off' }, title: 'Zavolat do servisu', template: null, now: NOW, newId: () => ID,
    values: [['priority', 'High'], ['due', { date: '2026-10-15' }], ['tags', ['auto']]],
  })
  assert.equal(out, `---\nid: ${ID}\ntype: task\ntitle: Zavolat do servisu\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [auto]\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'FR-TSK-10 AC-1 bytes (D-470)')
  const withSource: string = m.newObject({
    type: { key: 'task', attributes: TASK_ATTRS, review: 'off' }, title: 'Z porady', template: null, now: NOW, newId: () => ID,
    values: [['source', { link: 'Porada' }], ['tags', ['práce']]],
  })
  assert.equal(withSource, `---\nid: ${ID}\ntype: task\ntitle: Z porady\nstatus: To do\ntags: [práce]\nsource: "[[Porada]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'tags before source, after the schema attributes')
  const tpl = '---\nstatus: Waiting\npriority: Low\n---\nKroky:\n'
  const fromTpl: string = m.newObject({
    type: { key: 'task', attributes: TASK_ATTRS, review: 'off' }, title: 'Podle šablony', template: tpl, now: NOW, newId: () => ID,
    values: [['priority', 'High']],
  })
  assert.equal(fromTpl, `---\nid: ${ID}\ntype: task\ntitle: Podle šablony\nstatus: Waiting\npriority: High\ncreated: ${NOW}\nmodified: ${NOW}\n---\nKroky:\n`, 'a value wins over the template; the template status wins over the default')
})
