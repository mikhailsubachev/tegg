// MS5 slice 5B, L1: the text changes of the Inbox actions (docs/acceptance/inbox.md FR-INB-02; docs/contracts/
// ms5-capture.md §7.3; D-557…D-559): `applyInboxChange` and `appendSection` on the fixture's bytes. FR-INB-02 AC-1 (mark
// reviewed / unreviewed), AC-2 (the file's envelope: CRLF, no final newline, NFD, quote style, comments, unknown keys,
// a missing key appended), AC-5 (convert: `type`, `review`, `modified` only), AC-6 (append: the section and the
// re-targeted links; CRLF target), AC-8 (link to: one paragraph), AC-9 (add tags). Written from the ACs and the
// contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const FX = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/inbox', rel), 'utf8')
const NOW = '2026-10-14T12:00:00+02:00'

type Mod = Record<string, any>
type Change =
  | { op: 'set-review'; value: 'reviewed' | 'unreviewed'; now: string }
  | { op: 'set-type'; type: string; now: string }
  | { op: 'add-tags'; tags: string[]; now: string }
  | { op: 'append-link'; target: string; now: string }
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['applyInboxChange', 'appendSection']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (ms5-capture §7.3)`)
  return m
}
async function apply(text: string, change: Change): Promise<string | 'unchanged'> {
  const m = await doc()
  const r = m.applyInboxChange(text, change) as { kind: 'bytes'; text: string } | { kind: 'unchanged' }
  return r.kind === 'unchanged' ? 'unchanged' : r.text
}
function sw(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `fixture text contains ${JSON.stringify(from)}`)
  return text.replace(from, () => to)
}

const Q1 = 'Quick Notes/Koupit mléko.md'
const Q2 = 'Quick Notes/Nápad na článek.md'
const Q4 = 'Quick Notes/Bez stavu.md'
const Q5 = 'Quick Notes/Divná hodnota.md'
const Q6 = 'Quick Notes/Žluťoučký kůň.md'
const Q8 = 'Quick Notes/Bez data.md'
const N1 = 'Nápady/Aplikace na čaj.md'
const S1 = 'Schůzky/Porada týmu.md'
const P2 = 'Pages/Plán webu.md'

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-1

test('fr_inb_02_ac1_mark_reviewed_changes_review_and_modified_only', async () => {
  const q1 = FX(Q1)
  const reviewed = sw(sw(q1, 'review: unreviewed', 'review: reviewed'), 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`)
  assert.equal(await apply(q1, { op: 'set-review', value: 'reviewed', now: NOW }), reviewed, 'Q1 reviewed')
  const later = '2026-10-14T12:05:00+02:00'
  const back = sw(sw(reviewed, 'review: reviewed', 'review: unreviewed'), `modified: ${NOW}`, `modified: ${later}`)
  assert.equal(await apply(reviewed, { op: 'set-review', value: 'unreviewed', now: later }), back, 'unchecking writes review: unreviewed back the same way')
  assert.equal(await apply(q1, { op: 'set-review', value: 'unreviewed', now: NOW }), 'unchanged', 'the same value is no change (no write)')
})

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-2

test('fr_inb_02_ac2_crlf_and_no_final_newline_are_kept', async () => {
  const q5 = FX(Q5)
  assert.ok(q5.includes('\r\n') && !q5.endsWith('\n'), 'fixture: CRLF, no final newline')
  const want = sw(sw(q5, 'review: maybe\r\n', 'review: reviewed\r\n'), 'modified: 2026-10-09T16:45:00+02:00\r\n', `modified: ${NOW}\r\n`)
  assert.equal(await apply(q5, { op: 'set-review', value: 'reviewed', now: NOW }), want, 'Q5: CRLF kept, still no final newline')
})

test('fr_inb_02_ac2_nfd_title_bytes_are_unchanged', async () => {
  const q6 = FX(Q6)
  const nfdTitle = 'title: ' + 'Žluťoučký kůň'.normalize('NFD') + '\n'
  assert.ok(q6.includes(nfdTitle), 'fixture: NFD title')
  const got = await apply(q6, { op: 'set-review', value: 'reviewed', now: NOW })
  assert.equal(got, sw(sw(q6, 'review: unreviewed', 'review: reviewed'), 'modified: 2026-10-14T10:00:00+02:00', `modified: ${NOW}`), 'Q6: only review and modified')
  assert.ok(typeof got === 'string' && got.includes(nfdTitle), 'the NFD title bytes stay')
})

test('fr_inb_02_ac2_quote_style_comment_and_unknown_key_are_kept', async () => {
  const n1 = FX(N1)
  assert.equal(await apply(n1, { op: 'set-review', value: 'reviewed', now: NOW }),
    sw(sw(n1, 'review: "unreviewed"', 'review: "reviewed"'), 'modified: 2026-10-14T09:00:00+02:00', `modified: ${NOW}`), 'N1: double quotes kept (D-230)')
  const s1 = FX(S1)
  const got = await apply(s1, { op: 'set-review', value: 'reviewed', now: NOW })
  assert.equal(got, sw(sw(s1, 'review: unreviewed', 'review: reviewed'), 'modified: 2026-10-12T14:00:00+02:00', `modified: ${NOW}`), 'S1: only review and modified')
  assert.ok(typeof got === 'string' && got.includes('# poznámka: ručně psaná hlavička\n') && got.includes('místnost: A2\n'), 'comment and unknown key byte-identical')
})

test('fr_inb_02_ac2_a_missing_key_is_appended_after_the_last_entry', async () => {
  const q4 = FX(Q4)
  assert.equal(await apply(q4, { op: 'set-review', value: 'reviewed', now: NOW }),
    sw(q4, 'modified: 2026-10-10T10:00:00+02:00\n---\n', `modified: ${NOW}\nreview: reviewed\n---\n`), 'Q4: review appended after the last entry, modified updated')
  const q8 = FX(Q8)
  assert.equal(await apply(q8, { op: 'set-review', value: 'reviewed', now: NOW }),
    sw(q8, 'review: unreviewed\n---\n', `review: reviewed\nmodified: ${NOW}\n---\n`), 'Q8: review in place, then modified appended (D-174)')
})

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-5

test('fr_inb_02_ac5_convert_changes_type_review_and_modified_only', async () => {
  const q1 = FX(Q1)
  const want = sw(sw(sw(q1, 'type: quick-note', 'type: task'), 'review: unreviewed', 'review: reviewed'), 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`)
  const got = await apply(q1, { op: 'set-type', type: 'task', now: NOW })
  assert.equal(got, want, 'Q1 → Task: no status or other default added (D-557, D-471)')
  const n1 = FX(N1)
  const n1p = await apply(n1, { op: 'set-type', type: 'page', now: NOW })
  assert.equal(n1p, sw(sw(sw(n1, 'type: nápad', 'type: page'), 'review: "unreviewed"', 'review: "reviewed"'), 'modified: 2026-10-14T09:00:00+02:00', `modified: ${NOW}`), 'N1 → Page keeps hodnocení: 2')
})

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-6

/** D-184 targets from `Pages/` for the links of Q4 whose resolution would change (the app computes them, §7.3). */
const RETARGET = (link: string) => (link.normalize('NFC') === 'Dvojník' ? 'Quick Notes/Dvojník|Dvojník' : null)

test('fr_inb_02_ac6_append_writes_the_section_and_retargets_links', async () => {
  const m = await doc()
  const p2 = FX(P2)
  const q4body = 'Viz [[Dvojník]] a [[Plán webu]].\n'
  const got = m.appendSection(p2, 'Bez stavu', q4body, RETARGET, NOW) as string
  const want = sw(p2, 'modified: 2026-10-01T09:00:00+02:00', `modified: ${NOW}`) + '\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n'
  assert.equal(got, want, 'the original body, then the section; [[Dvojník]] re-targeted to DQ, [[Plán webu]] unchanged')
  // Then the item: only review and modified (AC-1's rule).
  const q4 = FX(Q4)
  assert.equal(await apply(q4, { op: 'set-review', value: 'reviewed', now: NOW }), sw(q4, 'modified: 2026-10-10T10:00:00+02:00\n---\n', `modified: ${NOW}\nreview: reviewed\n---\n`), 'Q4 is kept, marked reviewed')
})

test('fr_inb_02_ac6_a_crlf_target_gets_crlf_lines', async () => {
  const m = await doc()
  const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')
  const p2 = crlf(FX(P2))
  const got = m.appendSection(p2, 'Bez stavu', 'Viz [[Dvojník]] a [[Plán webu]].\n', RETARGET, NOW) as string
  const want = crlf(sw(FX(P2), 'modified: 2026-10-01T09:00:00+02:00', `modified: ${NOW}`) + '\n## Bez stavu\n\nViz [[Quick Notes/Dvojník|Dvojník]] a [[Plán webu]].\n')
  assert.equal(got, want, 'appended lines with CRLF')
})

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-8

test('fr_inb_02_ac8_link_to_appends_one_paragraph', async () => {
  const q1 = FX(Q1)
  const base = sw(q1, 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`)
  assert.equal(await apply(q1, { op: 'append-link', target: 'Plán webu', now: NOW }), base + '\n[[Plán webu]]\n', 'a blank line and [[Plán webu]]; review unchanged')
  assert.equal(await apply(q1, { op: 'append-link', target: 'Pages/Dvojník|Dvojník', now: NOW }), base + '\n[[Pages/Dvojník|Dvojník]]\n', 'DP from Quick Notes/: the D-184 target')
})

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-9

test('fr_inb_02_ac9_add_tags_appends_to_the_flow_list_or_adds_the_key', async () => {
  const q1 = FX(Q1)
  assert.equal(await apply(q1, { op: 'add-tags', tags: ['doma'], now: NOW }),
    sw(sw(q1, 'tags: [nákup]', 'tags: [nákup, doma]'), 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`), 'Q1: [nákup, doma]')
  assert.equal(await apply(q1, { op: 'add-tags', tags: ['Nákup'], now: NOW }), 'unchanged', 'a tag already there (tagKey) is no change')
  const q2 = FX(Q2)
  assert.equal(await apply(q2, { op: 'add-tags', tags: ['doma'], now: NOW }),
    sw(q2, 'modified: 2026-10-13T21:40:00+02:00\n---\n', `modified: ${NOW}\ntags: [doma]\n---\n`), 'Q2: tags appended after the last entry')
})
