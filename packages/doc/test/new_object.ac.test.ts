// MS3 slice 3D, L1: the bytes of a new object (`newObject`, docs/contracts/ms3-shell.md §14.5; D-232, D-245, D-92, D-96).
// FR-TYP-03 AC-12 (bytes; the write is L4, each entry point L5), FR-TYP-03 AC-9 (schema order), FR-TYP-12 AC-3,
// FR-VLT-02 AC-8 (starter template and default). Written from docs/acceptance/types.md and the contract only (D-61).
// Clock 2026-10-14T10:00:00+02:00 (types.md FR-TYP-03 AC-12).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const F = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults', rel), 'utf8')
const NOW = '2026-10-14T10:00:00+02:00'
const ID = '01JB0T0000000000000000N001'

type Attr = { key: string; type: string; default?: unknown }
type Review = 'off' | 'on' | 'locked'
async function make(key: string, attributes: Attr[], review: Review, title: string, template: string | null): Promise<string> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Record<string, any>
  assert.equal(typeof m.newObject, 'function', '@tegg/doc exports newObject (§14.5)')
  return m.newObject({ type: { key, attributes, review }, title, template, now: NOW, newId: () => ID })
}
const head = (key: string, title: string) => `---\nid: ${ID}\ntype: ${key}\ntitle: ${title}\n`
const tail = `created: ${NOW}\nmodified: ${NOW}\n---\n`

const NAPAD: Attr[] = [{ key: 'hodnocení', type: 'number', default: 1 }]
const PROJEKT: Attr[] = [
  { key: 'stav', type: 'select', default: 'Plánovaný' }, { key: 'období', type: 'date-range' }, { key: 'rozpočet', type: 'number' },
  { key: 'aktivní', type: 'checkbox' }, { key: 'oblasti', type: 'multi-select' }, { key: 'web', type: 'url' }, { key: 'poznámka', type: 'long-text' },
]
const SCHUZKA: Attr[] = [{ key: 'datum', type: 'date' }, { key: 'začátek', type: 'date-time' }, { key: 'účastníci', type: 'relation' }, { key: 'projekt', type: 'relation' }, { key: 'místo', type: 'text' }]

test('fr_typ_03_ac12_napad_takes_template_values_then_extra_keys_then_review_then_body', async () => {
  const got = await make('nápad', NAPAD, 'on', 'Nový nápad', F('types/_templates/Nápad/Nápad.md'))
  assert.equal(got, `${head('nápad', 'Nový nápad')}hodnocení: 3\nzdroj-nápadu: kniha\nreview: unreviewed\n${tail}## Proč na tom záleží\n`)
})

test('fr_typ_03_ac12_projekt_takes_the_default_and_omits_empty_attributes', async () => {
  assert.equal(await make('projekt', PROJEKT, 'off', 'Nový projekt', null), `${head('projekt', 'Nový projekt')}stav: Plánovaný\n${tail}`)
})

test('fr_typ_03_ac12_schuzka_writes_only_identity_keys_and_an_empty_body', async () => {
  assert.equal(await make('schůzka', SCHUZKA, 'off', 'Plánování', null), `${head('schůzka', 'Plánování')}${tail}`)
})

test('fr_typ_03_ac12_quick_note_is_locked_unreviewed', async () => {
  assert.equal(await make('quick-note', [], 'locked', 'Rychlý nápad', null), `${head('quick-note', 'Rychlý nápad')}review: unreviewed\n${tail}`)
})

test('fr_typ_03_ac12_template_entries_are_copied_verbatim_and_identity_keys_ignored', async () => {
  const template = "---\nid: 01XXXXXXXXXXXXXXXXXXXXXXXX\ntype: jiný\ntitle: Šablona\nzdroj-nápadu: 'kniha'   # z knihovny\nhodnocení: 3\nreview: reviewed\ncreated: 2020-01-01\nmodified: 2020-01-01\nobdobí-end: 2027-12-31\nobdobí-start: 2027-01-01\n---\n## Tělo\n\nText šablony.\n"
  const attrs: Attr[] = [{ key: 'období', type: 'date-range' }, { key: 'hodnocení', type: 'number', default: 1 }]
  const got = await make('nápad', attrs, 'on', 'Kopie', template)
  assert.equal(got, `${head('nápad', 'Kopie')}období-start: 2027-01-01\nobdobí-end: 2027-12-31\nhodnocení: 3\nzdroj-nápadu: 'kniha'   # z knihovny\nreview: unreviewed\n${tail}## Tělo\n\nText šablony.\n`)
})

test('fr_typ_03_ac12_defaults_are_formatted_per_type', async () => {
  const attrs: Attr[] = [
    { key: 'datum', type: 'date', default: '2026-10-20' }, { key: 'aktivní', type: 'checkbox', default: false },
    { key: 'počet', type: 'number', default: 1 }, { key: 'oblasti', type: 'multi-select', default: ['Práce'] },
    { key: 'kód', type: 'text', default: '123' },
  ]
  assert.equal(await make('test', attrs, 'off', 'Výchozí', null), `${head('test', 'Výchozí')}datum: 2026-10-20\naktivní: false\npočet: 1\noblasti:\n  - Práce\nkód: "123"\n${tail}`)
})

test('fr_typ_03_ac12_invalid_template_frontmatter_contributes_only_its_body', async () => {
  const template = '---\nhodnocení: "neuzavřené\n---\n## Jen tělo\n'
  assert.equal(await make('nápad', NAPAD, 'off', 'Bez hlavičky šablony', template), `${head('nápad', 'Bez hlavičky šablony')}hodnocení: 1\n${tail}## Jen tělo\n`)
})

test('fr_typ_03_ac12_title_is_nfc_and_quoted_when_needed', async () => {
  assert.equal(await make('page', [], 'off', 'Plzeň', null), `${head('page', 'Plzeň')}${tail}`, 'NFC')
  assert.equal(await make('page', [], 'off', 'ano: ne', null), `---\nid: ${ID}\ntype: page\ntitle: "ano: ne"\n${tail}`)
})

test('fr_typ_03_ac9_new_objects_follow_the_schema_order', async () => {
  const attrs: Attr[] = [{ key: 'b', type: 'text', default: 'B' }, { key: 'a', type: 'text', default: 'A' }]
  assert.equal(await make('test', attrs, 'off', 'Pořadí', '---\na: z šablony\n---\n'), `${head('test', 'Pořadí')}b: B\na: z šablony\n${tail}`)
})

test('fr_typ_12_ac3_review_key_follows_the_workflow', async () => {
  const on = await make('schůzka', SCHUZKA, 'on', 'Se schválením', null)
  const off = await make('schůzka', SCHUZKA, 'off', 'Bez schválení', null)
  assert.ok(on.includes('\nreview: unreviewed\n'), 'on → review: unreviewed')
  assert.ok(!off.includes('review:'), 'off → no review key')
  assert.equal(on, `${head('schůzka', 'Se schválením')}review: unreviewed\n${tail}`)
})

test('fr_vlt_02_ac8_starter_meeting_body_and_book_default', async () => {
  const meeting = await make('meeting', [{ key: 'date', type: 'date' }, { key: 'attendees', type: 'relation' }, { key: 'project', type: 'relation' }, { key: 'location', type: 'text' }], 'off', 'Kick-off', F('new-starter/_templates/Meeting/Meeting.md'))
  assert.equal(meeting, `${head('meeting', 'Kick-off')}${tail}## Agenda\n\n## Notes\n\n## Decisions\n`)
  const book = await make('book', [{ key: 'author', type: 'text' }, { key: 'year', type: 'number' }, { key: 'status', type: 'select', default: 'To read' }, { key: 'finished', type: 'date' }], 'off', 'Řeka', F('new-starter/_templates/Book/Book.md'))
  assert.equal(book, `${head('book', 'Řeka')}status: To read\n${tail}## Summary\n\n## Notes\n\n## Quotes\n`)
})
