// MS5 slice 5B, L1: what a capture writes (docs/acceptance/capture.md R57; docs/contracts/ms5-capture.md §3.1, §3.2;
// D-539, D-540, D-544): `captureParts` (title, body, trailing tags of the capture text) and `newObject` with `capture` (D-595: no `captured` key)
// (the bytes). FR-CAP-04 AC-1 (Quick Note bytes), AC-2 (any type, template frontmatter but not its body), AC-3 (time
// stamps, TZ and the autumn DST change), AC-4 (the title/body table), AC-5 (names: the full title is kept and quoted);
// FR-CAP-01 AC-5 (Markdown kept); FR-TSK-10 AC-9 (Task bytes), AC-10 (quick-add tokens only for Task), AC-11 (dates
// never shift). Written from the ACs and the contract only (D-61). The module loads inside each test (TS-I1).
//
// The capture window's composition (contract §3.2, §4): `captureParts(text, () => null)` (no index access, so an
// alias-less link's title is its target text), title `''` → `Untitled` (D-523), then `newObject({ type, title,
// template: <the default template's frontmatter>, now, capture: true, newId, values, body })` with `values` = `tags`
// (chips, then the title's trailing tags, unique by tagKey) and for a Task `priority`, `due`.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const FX = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/inbox', rel), 'utf8')
const NOW = '2026-10-14T12:00:00+02:00'
const ID = '01JB5B0000000000000000N001'

type Mod = Record<string, any>
type Parts = { title: string; body: string; tags: string[]; keptTitleLine: boolean }
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['captureParts', 'newObject', 'localIso', 'localDate', 'addDays', 'tagKey']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (ms5-capture §3)`)
  return m
}
async function parts(text: string): Promise<Parts> {
  const m = await doc()
  return m.captureParts(text, () => null) as Parts
}
const nfd = (s: string) => s.normalize('NFD')

// Type definitions as `capture_context` sends them (contract §2.2), from the fixture's type files.
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
const QUICK = { key: 'quick-note', review: 'locked' as const, attributes: [] }
const PAGE = { key: 'page', review: 'off' as const, attributes: [] }
const SCHUZKA = { key: 'schůzka', review: 'off' as const, attributes: [{ key: 'datum', type: 'date' }] }
const NAPAD = { key: 'nápad', review: 'on' as const, attributes: [{ key: 'hodnocení', type: 'number', default: 1 }] }
/** D-567: the default template's frontmatter block only (`templateHead`). */
const NAPAD_HEAD = () => {
  const t = FX('_templates/Nápad/Nápad.md')
  const end = t.indexOf('\n---\n', 4) + 5
  assert.ok(end > 5, 'fixture template has a frontmatter block')
  return t.slice(0, end)
}

/** The capture window's save (contract §4): parts → newObject with `capture` (D-595). */
async function captureBytes(o: { type: Record<string, unknown>; text: string; chips?: string[]; template?: string | null; now?: string; priority?: string | null; due?: string | null }): Promise<string> {
  const m = await doc()
  const p = m.captureParts(o.text, () => null) as Parts
  const now = o.now ?? NOW
  const seen = new Set<string>()
  const tags: string[] = []
  for (const t of [...(o.chips ?? []), ...p.tags]) {
    const k = m.tagKey(t.normalize('NFC'))
    if (!seen.has(k)) { seen.add(k); tags.push(t.normalize('NFC')) }
  }
  const values: [string, unknown][] = []
  if (o.priority) values.push(['priority', o.priority])
  if (o.due) values.push(['due', { date: o.due }])
  if (tags.length) values.push(['tags', tags])
  return m.newObject({ type: o.type, title: p.title === '' ? 'Untitled' : p.title, template: o.template ?? null, now, capture: true, newId: () => ID, values, body: p.body }) as string
}
const stamps = (now: string) => `review: unreviewed\ncreated: ${now}\nmodified: ${now}\n` // D-595: no `captured`
/** D-604: types without the review workflow (Page, Schůzka, Task) get no `review` line. */
const plain = (now: string) => `created: ${now}\nmodified: ${now}\n`

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-1

test('fr_cap_04_ac1_a_captured_quick_note_has_exactly_these_bytes', async () => {
  const got = await captureBytes({ type: QUICK, text: 'Koupit dárek pro Janu\nNěco do 500 Kč, viz [[Plán webu]].', chips: ['nákup'] })
  assert.equal(got, `---\nid: ${ID}\ntype: quick-note\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${stamps(NOW)}---\nNěco do 500 Kč, viz [[Plán webu]].\n`)
})

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-2

test('fr_cap_04_ac2_page_and_schuzka_get_the_same_review_and_stamps', async () => {
  const text = 'Koupit dárek pro Janu\nNěco do 500 Kč, viz [[Plán webu]].'
  const body = 'Něco do 500 Kč, viz [[Plán webu]].\n'
  assert.equal(await captureBytes({ type: PAGE, text, chips: ['nákup'] }), `---\nid: ${ID}\ntype: page\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${plain(NOW)}---\n${body}`, 'Page: review off, no review line (D-604)')
  assert.equal(await captureBytes({ type: SCHUZKA, text, chips: ['nákup'] }), `---\nid: ${ID}\ntype: schůzka\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${plain(NOW)}---\n${body}`, 'Schůzka likewise (no `datum` default)')
})

test('fr_cap_04_ac2_napad_takes_the_template_frontmatter_not_its_body', async () => {
  const got = await captureBytes({ type: NAPAD, text: 'Koupit dárek pro Janu\nNěco do 500 Kč, viz [[Plán webu]].', chips: ['nákup'], template: NAPAD_HEAD() })
  assert.equal(got, `---\nid: ${ID}\ntype: nápad\ntitle: Koupit dárek pro Janu\nhodnocení: 3\noblast: osobní\ntags: [nákup]\n${stamps(NOW)}---\nNěco do 500 Kč, viz [[Plán webu]].\n`,
    'hodnocení 3 (template wins over default 1, D-232), oblast (template key), captured body only (AP-468)')
  assert.ok(!got.includes('Proč na tom záleží'), 'the template body is never used')
  // The full template (body included) gives the same bytes: `body` wins, D-524.
  const m = await doc()
  const full = m.newObject({ type: NAPAD, title: 'Koupit dárek pro Janu', template: FX('_templates/Nápad/Nápad.md'), now: NOW, capture: true, newId: () => ID, values: [['tags', ['nákup']]], body: 'Něco do 500 Kč, viz [[Plán webu]].\n' })
  assert.equal(full, got, 'a whole template contributes its frontmatter only')
})

test('fr_cap_04_ac2_a_template_review_or_stamp_is_ignored', async () => {
  const tpl = '---\nreview: reviewed\ncaptured: 2020-01-01T00:00:00+01:00\ncreated: 2020-01-01T00:00:00+01:00\nhodnocení: 3\noblast: osobní\n---\n'
  const got = await captureBytes({ type: NAPAD, text: 'Nápad', template: tpl })
  assert.equal(got, `---\nid: ${ID}\ntype: nápad\ntitle: Nápad\nhodnocení: 3\noblast: osobní\n${stamps(NOW)}---\n`, 'review: unreviewed and the save instant, whatever the template says')
  assert.equal(got.match(/^review:/gm)?.length, 1, 'one review line')
})

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-3

test('fr_cap_04_ac3_stamps_in_los_angeles_and_across_the_autumn_change', async () => {
  const m = await doc()
  const cases: [string, string, string][] = [
    ['2026-10-14T10:00:00Z', 'America/Los_Angeles', '2026-10-14T03:00:00-07:00'],
    ['2026-10-14T10:00:00Z', 'Europe/Prague', '2026-10-14T12:00:00+02:00'],
    ['2026-10-25T01:30:00Z', 'Europe/Prague', '2026-10-25T02:30:00+01:00'], // the repeated hour, second pass
    ['2026-10-25T00:30:00Z', 'Europe/Prague', '2026-10-25T02:30:00+02:00'], // first pass
  ]
  for (const [instant, zone, want] of cases) {
    const now = m.localIso(Date.parse(instant), zone) as string
    assert.equal(now, want, `${instant} in ${zone}`)
    const got = await captureBytes({ type: QUICK, text: 'Čas', now })
    assert.equal(got, `---\nid: ${ID}\ntype: quick-note\ntitle: Čas\n${stamps(want)}---\n`, `created = modified = ${want}`)
  }
})

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-4

const TABLE: [string, string, string, string[], boolean][] = [
  // text, title, body, tags, keptTitleLine
  ['Koupit mléko', 'Koupit mléko', '', [], false],
  ['  \n\nKoupit chléb\n\n', 'Koupit chléb', '', [], false],
  ['# Nápad na výlet\nDo Tater.', 'Nápad na výlet', 'Do Tater.\n', [], false],
  ['- [ ] Zavolat Evě', 'Zavolat Evě', '', [], false],
  ['1. První věc', 'První věc', '', [], false],
  ['> Citát dne', 'Citát dne', '', [], false],
  ['**Důležité:** porada v 9', 'Důležité: porada v 9', '', [], false],
  ['Schůzka s [[Plán webu|týmem webu]] #práce\nProgram.', 'Schůzka s týmem webu', 'Schůzka s [[Plán webu|týmem webu]]\n\nProgram.\n', ['práce'], true],
  ['[[Plán webu]]', 'Plán webu', '[[Plán webu]]\n', [], true],
  ['#nápad', '', '', ['nápad'], false],
  ['Koupit mléko #nákup #domácnost', 'Koupit mléko', '', ['nákup', 'domácnost'], false],
  ['Řádek 1\n\n\nŘádek 2  \nŘádek 3\n\n', 'Řádek 1', 'Řádek 2  \nŘádek 3\n', [], false],
  ['Řádek 1\r\nŘádek 2', 'Řádek 1', 'Řádek 2\n', [], false],
]

test('fr_cap_04_ac4_title_body_and_tags_table', async () => {
  const bad: string[] = []
  for (const [text, title, body, tags, kept] of TABLE) {
    const got = await parts(text)
    const want = { title, body, tags, keptTitleLine: kept }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(text)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'R57 rows')
})

test('fr_cap_04_ac4_only_tags_saves_untitled', async () => {
  const got = await captureBytes({ type: QUICK, text: '#nápad' })
  assert.equal(got, `---\nid: ${ID}\ntype: quick-note\ntitle: Untitled\ntags: [nápad]\n${stamps(NOW)}---\n`, 'title Untitled (D-523), the tag in tags:, empty body')
})

test('fr_cap_04_ac4_nfd_text_becomes_nfc', async () => {
  const p1 = await parts(nfd('Čaj'))
  assert.equal(p1.title, 'Čaj'.normalize('NFC'), 'Čaj in NFC')
  const p2 = await parts(nfd('Výlet do Tater\nČaj a šálek'))
  assert.equal(p2.title, 'Výlet do Tater'.normalize('NFC'), 'title NFC')
  assert.equal(p2.body, 'Čaj a šálek\n'.normalize('NFC'), 'body NFC')
  const p3 = await parts(nfd('Výlet #výlet'))
  assert.deepEqual(p3.tags, ['výlet'.normalize('NFC')], 'tags NFC')
})

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-5 (names)

test('fr_cap_04_ac5_titles_are_kept_whole_and_quoted', async () => {
  const q3 = await captureBytes({ type: QUICK, text: 'Q3: plán/rozpočet' })
  assert.equal(q3, `---\nid: ${ID}\ntype: quick-note\ntitle: "Q3: plán/rozpočet"\n${stamps(NOW)}---\n`, 'a colon is quoted (D-230); the slash stays in the title')
  const c = await captureBytes({ type: QUICK, text: 'C# tipy' })
  assert.match(c, /^title: (C# tipy|"C# tipy")$/m, 'C# tipy keeps its # in the title (D-68: only the file name drops it)')
  assert.equal((await parts('CON')).title, 'CON', 'CON is a title like any other (D-80 renames only the file)')
  const long = 'Řeřicha a ' + 'žluťoučký kůň '.repeat(17) + 'konec'
  assert.ok(Buffer.byteLength(long) > 250, `fixture: a ${Buffer.byteLength(long)}-byte first line`)
  assert.equal((await parts(long)).title, long, 'the full title, not cut (the stem is cut by the core)')
})

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-5

test('fr_cap_01_ac5_markdown_in_the_body_is_kept_byte_for_byte', async () => {
  const text = 'Schůzka k webu\n**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce'
  const p = await parts(text)
  assert.deepEqual(p, { title: 'Schůzka k webu', body: '**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce\n', tags: [], keptTitleLine: false }, 'body as typed; #práce stays in the body')
  const got = await captureBytes({ type: QUICK, text })
  assert.equal(got, `---\nid: ${ID}\ntype: quick-note\ntitle: Schůzka k webu\n${stamps(NOW)}---\n**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce\n`, 'no tags: line for an inline tag (D-185)')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-9

test('fr_tsk_10_ac9_a_captured_task_has_exactly_these_bytes', async () => {
  const got = await captureBytes({ type: TASK, text: 'Zavolat kominíkovi', chips: ['doma'], priority: 'High', due: '2026-10-15' })
  assert.equal(got, `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n${plain(NOW)}---\n`, 'AC-9 bytes, empty body')
})

test('fr_tsk_10_ac9_no_priority_none_and_cleared_due', async () => {
  const none = await captureBytes({ type: TASK, text: 'Zavolat kominíkovi', priority: null, due: null })
  assert.equal(none, `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\n${plain(NOW)}---\n`, '`No priority` and a cleared Due write neither key')
  const opt = await captureBytes({ type: TASK, text: 'Zavolat kominíkovi', priority: 'None' })
  assert.equal(opt, `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: None\n${plain(NOW)}---\n`, 'the option None is a value')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-10

test('fr_tsk_10_ac10_tokens_only_for_task_trailing_tags_for_other_types', async () => {
  // With type Task the capture page moves the D-483 tokens of the first line into Due, Priority and chips (quickAdd.ts,
  // tested in app/test/capture_ui.ac.test.ts); what is left is saved as for AC-9.
  const task = await captureBytes({ type: TASK, text: 'Zavolat kominíkovi', chips: ['doma'], priority: 'High', due: '2026-10-15' })
  assert.equal(task, `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n${plain(NOW)}---\n`, 'AC-9 bytes')
  const line = 'Zavolat kominíkovi tomorrow !high #doma'
  const qn = await parts(line)
  assert.deepEqual([qn.title, qn.tags], ['Zavolat kominíkovi tomorrow !high', ['doma']], 'as a Quick Note: only the trailing tag moves (R57)')
  assert.equal(await captureBytes({ type: QUICK, text: line }), `---\nid: ${ID}\ntype: quick-note\ntitle: Zavolat kominíkovi tomorrow !high\ntags: [doma]\n${stamps(NOW)}---\n`, 'Quick Note bytes')
})

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-11

test('fr_tsk_10_ac11_tomorrow_and_stamps_follow_the_zone', async () => {
  const m = await doc()
  const at = Date.parse('2026-10-14T22:30:00Z')
  for (const [zone, due, now] of [['Europe/Prague', '2026-10-16', '2026-10-15T00:30:00+02:00'], ['America/Los_Angeles', '2026-10-15', '2026-10-14T15:30:00-07:00']] as const) {
    const tomorrow = m.addDays(m.localDate(at, zone), 1) as string
    assert.equal(tomorrow, due, `${zone}: tomorrow is ${due} (the page parses the token against the local date)`)
    const stamp = m.localIso(at, zone) as string
    const got = await captureBytes({ type: TASK, text: 'Zavolat kominíkovi', due: tomorrow, now: stamp })
    assert.equal(got, `---\nid: ${ID}\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\ndue: ${due}\n${plain(now)}---\n`, `${zone}: due ${due}, created ${now}`)
  }
})
