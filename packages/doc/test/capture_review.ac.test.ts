// v0.52 feedback, L1: what a capture writes about review (docs/acceptance/capture.md FR-CAP-04 AC-9, R57; D-604;
// docs/contracts/ms5-capture.md §16.2: `newObject({ …, capture: true })` writes `review: unreviewed` only when the type's
// `review` is `on` or `locked`). The types are passed as `capture_context` sends them (§2.2); the composition is the
// capture window's (§4): `newObject({ type, title, template, now, capture: true, newId, values, body })`.
// Written from the AC and the contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'

const NOW = '2026-10-14T12:00:00+02:00'
const ID = '01JB5B0000000000000000N052'
const STATUSES = [
  { label: 'To do', color: 'gray', state: 'open' }, { label: 'In progress', color: 'blue', state: 'in-progress' }, { label: 'Waiting', color: 'yellow', state: 'open' },
  { label: 'Done', color: 'green', state: 'done' }, { label: 'Cancelled', color: 'red', state: 'cancelled' },
]
const TASK = {
  key: 'task', review: 'off' as const,
  attributes: [
    { key: 'status', type: 'select', options: STATUSES },
    { key: 'priority', type: 'select', options: ['High', 'Medium', 'Low', 'None'].map((label) => ({ label, color: null })) },
    { key: 'due', type: 'date' }, { key: 'completed', type: 'date-time' }, { key: 'recurrence', type: 'recurrence' },
  ],
}
const PAGE = { key: 'page', review: 'off' as const, attributes: [] }
const SCHUZKA = { key: 'schůzka', review: 'off' as const, attributes: [{ key: 'datum', type: 'date' }] }
const QUICK = { key: 'quick-note', review: 'locked' as const, attributes: [] }
const NAPAD = { key: 'nápad', review: 'on' as const, attributes: [{ key: 'hodnocení', type: 'number', default: 1 }] }

async function capture(type: Record<string, unknown>, title: string, o: { values?: [string, unknown][]; template?: string | null; body?: string } = {}): Promise<string> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Record<string, any>
  assert.equal(typeof m.newObject, 'function', '@tegg/doc exports newObject')
  return m.newObject({ type, title, template: o.template ?? null, now: NOW, capture: true, newId: () => ID, values: o.values ?? [], body: o.body ?? '' }) as string
}
const stamps = `created: ${NOW}\nmodified: ${NOW}\n`

test('fr_cap_04_ac9_types_without_the_review_workflow_get_no_review_line', async () => {
  assert.equal(
    await capture(TASK, 'Zavolat kominíkovi', { values: [['priority', 'High'], ['due', { date: '2026-10-15' }], ['tags', ['doma']]] }),
    `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n${stamps}---\n`,
    'Task (review off): … tags, created, modified, no review (D-604)')
  assert.equal(
    await capture(PAGE, 'Koupit dárek pro Janu', { values: [['tags', ['nákup']]], body: 'Něco do 500 Kč, viz [[Plán webu]].\n' }),
    `---\nid: ${ID}\ntype: page\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${stamps}---\nNěco do 500 Kč, viz [[Plán webu]].\n`,
    'Page (review off): no review line')
  assert.equal(
    await capture(SCHUZKA, 'Porada o rozpočtu', { template: '---\nreview: unreviewed\n---\n' }),
    `---\nid: ${ID}\ntype: schůzka\ntitle: Porada o rozpočtu\n${stamps}---\n`,
    'Schůzka (review off): a template review key is ignored too (D-346), no review line')
})

test('fr_cap_04_ac9_review_types_keep_review_unreviewed', async () => {
  // Red guard first: a Task capture has no review line (D-604).
  assert.ok(!/^review:/m.test(await capture(TASK, 'Zavolat kominíkovi')), 'guard: a Task capture has no review line')
  assert.equal(await capture(QUICK, 'Koupit chleba'), `---\nid: ${ID}\ntype: quick-note\ntitle: Koupit chleba\nreview: unreviewed\n${stamps}---\n`, 'Quick Note (locked): review: unreviewed')
  assert.equal(
    await capture(NAPAD, 'Čajovna', { template: '---\nreview: reviewed\nhodnocení: 3\n---\n' }),
    `---\nid: ${ID}\ntype: nápad\ntitle: Čajovna\nhodnocení: 3\nreview: unreviewed\n${stamps}---\n`,
    'Nápad (review: true): review: unreviewed, whatever the template says')
})
