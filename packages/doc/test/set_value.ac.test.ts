// MS3 slice 3D, L1: how the attribute panel's committed values are written, through the real @tegg/doc
// (`setValue`, `setRange`, docs/contracts/ms3-shell.md §14.5, D-230, dialect §3). FR-EDT-07 AC-3, AC-5 (formatting),
// AC-8, AC-9, AC-12; FR-TYP-08 AC-7…AC-11 (writes); FR-TYP-07 AC-5, AC-7, AC-10 (the type line); FR-TYP-02 AC-3.
// Written from docs/acceptance/types.md and the contract only (D-61). `modified` and identity keys are the editor's
// (applyFrontmatter + touchModified/ensureIdentity, §14.6), so these values are checked without them.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

const REPO = resolve(import.meta.dirname, '../../..')
const T = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/types', rel), 'utf8')
const PORADA = 'Schůzky/2026-10-07 Porada.md'
const PRAZDNA = 'Schůzky/Prázdná schůzka.md'
const ROZPOCET = 'Projekty/Rozpočet 2027.md'
const STYL = 'Pages/Styl hodnot.md'
const OBYC = 'Pages/Obyčejná stránka.md'
const BEZ = 'Pages/Bez hlavičky.md'

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['setValue', 'setRange', 'parse']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (§14.5)`)
  return m
}
async function set(text: string, key: string, value: unknown): Promise<string> {
  const d = await doc()
  return d.setValue(d.parse(text), key, value)
}
function swap(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `fixture no longer contains ${JSON.stringify(from)}`)
  return text.replace(from, to)
}
/** Inserts `lines` right before the closing `---` of the frontmatter (appended after the last entry). */
function append(text: string, lines: string): string {
  const close = text.indexOf('\n---\n', 4)
  assert.ok(close > 0, 'fixture has frontmatter')
  return text.slice(0, close + 1) + lines + text.slice(close + 1)
}

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-3

test('fr_edt_07_ac3_only_the_edited_line_changes', async () => {
  const p = T(PORADA)
  assert.equal(await set(p, 'místo', 'Zasedačka 2'), swap(p, 'místo:\n', 'místo: Zasedačka 2\n'), 'comment, nálada, flow tags, order and body unchanged')
  const e = T(PRAZDNA)
  assert.equal(await set(e, 'místo', 'Zasedačka 2'), append(e, 'místo: Zasedačka 2\n'), 'absent key appended after the existing keys')
})

test('fr_edt_07_ac3_one_edit_per_r10_type_on_rozpocet', async () => {
  const r = T(ROZPOCET)
  const cases: [string, unknown, string, string][] = [
    ['stav', 'Hotovo', 'stav: Běží\n', 'stav: Hotovo\n'],
    ['rozpočet', 3.5, 'rozpočet: 250000\n', 'rozpočet: 3.5\n'],
    ['aktivní', false, 'aktivní: true\n', 'aktivní: false\n'],
    ['oblasti', ['Práce', 'Rodina'], 'oblasti:\n  - Práce\n', 'oblasti:\n  - Práce\n  - Rodina\n'],
    ['web', 'https://example.com/a?b=c', 'web: https://example.com/rozpocet\n', 'web: https://example.com/a?b=c\n'],
    ['poznámka', 'Řádek 1\nŘádek 2', 'poznámka: |-\n  První řádek poznámky.\n  Druhý řádek s háčky: ěščřžýáíé.\n', 'poznámka: |-\n  Řádek 1\n  Řádek 2\n'],
  ]
  for (const [k, v, from, to] of cases) assert.equal(await set(r, k, v), swap(r, from, to), k)
  const d = await doc()
  assert.equal(d.setRange(d.parse(r), 'období', '2027-02-01', '2027-11-30'), swap(r, 'období-start: 2027-01-01\nobdobí-end: 2027-12-31\n', 'období-start: 2027-02-01\nobdobí-end: 2027-11-30\n'), 'date range')
})

test('fr_edt_07_ac3_one_edit_per_r10_type_on_prazdna_schuzka', async () => {
  const e = T(PRAZDNA)
  const cases: [string, unknown, string][] = [
    ['datum', { date: '2026-10-08' }, 'datum: 2026-10-08\n'],
    ['začátek', { datetime: '2026-12-01T14:30:00+01:00' }, 'začátek: 2026-12-01T14:30:00+01:00\n'],
    ['účastníci', [{ link: 'Jana Nováková' }], 'účastníci:\n  - "[[Jana Nováková]]"\n'],
    ['projekt', { link: 'Rozpočet 2027' }, 'projekt: "[[Rozpočet 2027]]"\n'],
    ['místo', 'Praha 1', 'místo: Praha 1\n'],
    ['rozpočet', 250000, 'rozpočet: 250000\n'],
    ['aktivní', true, 'aktivní: true\n'],
    ['stav', 'Hotovo', 'stav: Hotovo\n'],
    ['oblasti', ['Práce'], 'oblasti:\n  - Práce\n'],
    ['e-mail', 'eva@example.com', 'e-mail: eva@example.com\n'],
    ['poznámka', 'Řádek 1\nŘádek 2', 'poznámka: |-\n  Řádek 1\n  Řádek 2\n'],
  ]
  for (const [k, v, lines] of cases) assert.equal(await set(e, k, v), append(e, lines), k)
})

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-5

test('fr_edt_07_ac5_text_is_quoted_when_yaml_would_read_it_as_something_else', async () => {
  const o = T(OBYC)
  const cases: [string, string][] = [
    ['Praha 1', 'místo: Praha 1\n'],
    ['ano: ne', 'místo: "ano: ne"\n'],
    ['123', 'místo: "123"\n'],
    ['true', 'místo: "true"\n'],
    ['2026-10-07', 'místo: "2026-10-07"\n'],
    ['[[Cíl]]', 'místo: "[[Cíl]]"\n'],
    ['#doma', 'místo: "#doma"\n'],
    ['Plzen\u030C', 'místo: Plzeň\n'],
  ]
  for (const [input, line] of cases) {
    const got = await set(o, 'místo', input)
    assert.equal(got, swap(o, 'místo: Praha\n', line), JSON.stringify(input))
    const back = parseYaml(line) as Record<string, unknown>
    assert.equal(back['místo'], input.normalize('NFC'), `${JSON.stringify(input)} reads back as the same string`)
  }
})

test('fr_edt_07_ac5_typed_values_are_written_in_dialect_form', async () => {
  const o = T(OBYC)
  const cases: [string, unknown, string][] = [
    ['místo', 'Řádek 1\nŘádek 2', 'místo: |-\n  Řádek 1\n  Řádek 2\n'],
    ['místo', 3.5, 'místo: 3.5\n'],
    ['místo', 250000, 'místo: 250000\n'],
    ['místo', false, 'místo: false\n'],
    ['místo', { date: '2026-10-08' }, 'místo: 2026-10-08\n'],
    ['místo', { datetime: '2026-10-25T02:30:00+02:00' }, 'místo: 2026-10-25T02:30:00+02:00\n'],
    ['místo', 'https://example.com/a?b=c', 'místo: https://example.com/a?b=c\n'],
    ['místo', 'eva@example.com', 'místo: eva@example.com\n'],
    ['místo', { link: 'C tips|C# tips' }, 'místo: "[[C tips|C# tips]]"\n'],
    ['místo', ['Práce', 'Rodina'], 'místo:\n  - Práce\n  - Rodina\n'],
  ]
  for (const [k, v, line] of cases) assert.equal(await set(o, k, v), swap(o, 'místo: Praha\n', line), JSON.stringify(v))
})

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-8, AC-9

test('fr_edt_07_ac8_key_spelling_quoting_and_value_style_are_kept', async () => {
  const s = T(STYL)
  assert.equal(await set(s, 'klíč s mezerou', 'nová'), swap(s, '"klíč s mezerou": hodnota\n', '"klíč s mezerou": nová\n'), 'quoted key kept')
  assert.equal(
    await set(s, 'účastníci', [{ link: 'Jana Nováková' }, { link: 'Petr Dvořák' }]),
    swap(s, 'účastníci:\n  - "[[Jana Nováková]]"\n', 'účastníci:\n  - "[[Jana Nováková]]"\n  - "[[Petr Dvořák]]"\n'),
    'unquoted non-ASCII key and block list kept',
  )
  assert.equal(await set(s, 'stav', 'hotovo'), swap(s, "stav: 'rozpracováno'\n", "stav: 'hotovo'\n"), 'single-quoted stays single-quoted')
  assert.equal(await set(s, 'aliases', ['Styl', 'Hodnoty', 'Třetí']), swap(s, 'aliases: [Styl, Hodnoty]\n', 'aliases: [Styl, Hodnoty, Třetí]\n'), 'flow list stays flow')
  assert.equal(await set(s, 'stav', "it's"), swap(s, "stav: 'rozpracováno'\n", `stav: 'it''s'\n`), 'single quotes escaped in single-quoted style')
})

test('fr_edt_07_ac9_clearing_removes_the_entry_and_false_is_a_value', async () => {
  const o = T(OBYC)
  for (const empty of [null, '', []]) assert.equal(await set(o, 'místo', empty), swap(o, 'místo: Praha\n', ''), `clear with ${JSON.stringify(empty)}`)
  const r = T(ROZPOCET)
  assert.equal(await set(r, 'poznámka', null), swap(r, 'poznámka: |-\n  První řádek poznámky.\n  Druhý řádek s háčky: ěščřžýáíé.\n', ''), 'a multi-line entry is removed whole')
  assert.equal(await set(r, 'oblasti', []), swap(r, 'oblasti:\n  - Práce\n', ''), 'removing the last item removes the key')
  assert.equal(await set(r, 'aktivní', false), swap(r, 'aktivní: true\n', 'aktivní: false\n'), 'false is a value, not a clear')
  const d = await doc()
  assert.equal(d.setRange(d.parse(r), 'období', null, null), swap(r, 'období-start: 2027-01-01\nobdobí-end: 2027-12-31\n', ''), 'clearing both halves removes both keys')
  assert.equal(d.setRange(d.parse(r), 'období', '2027-01-01', null), swap(r, 'období-end: 2027-12-31\n', ''), 'null clears that half')
})

test('fr_edt_07_ac12_first_edit_of_a_file_without_frontmatter_gets_one', async () => {
  const b = T(BEZ)
  assert.equal(await set(b, 'tags', ['nový']), `---\ntags:\n  - nový\n---\n${b}`, 'a new frontmatter with the block list; body byte-identical')
})

test('fr_edt_07_ac3_invalid_frontmatter_is_never_rewritten', async () => {
  const d = await doc()
  const n = T('Pages/Neplatná hlavička.md')
  assert.throws(() => d.setValue(d.parse(n), 'místo', 'Praha'), 'setValue throws on invalid frontmatter (NFR-REL-03)')
  assert.throws(() => d.setRange(d.parse(n), 'období', '2027-01-01', null), 'setRange throws too')
})

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-3

test('fr_typ_02_ac3_a_new_range_is_two_consecutive_lines', async () => {
  const d = await doc()
  const v = T('Projekty/Velká písmena.md')
  assert.equal(d.setRange(d.parse(v), 'období', '2027-01-01', '2027-12-31'), append(v, 'období-start: 2027-01-01\nobdobí-end: 2027-12-31\n'))
})

// ------------------------------------------------------------------------------------------------ FR-TYP-08 AC-7…AC-11

test('fr_typ_08_ac7_description_is_one_entry_and_empty_removes_it', async () => {
  const p = T(PORADA)
  const withD = await set(p, 'description', 'Rozpočet na rok 2027')
  assert.equal(withD, append(p, 'description: Rozpočet na rok 2027\n'))
  assert.equal(await set(withD, 'description', ''), p, 'an empty description removes the key')
})

test('fr_typ_08_ac8_tags_keep_the_flow_list_and_new_ones_are_block_lists', async () => {
  const p = T(PORADA)
  assert.equal(await set(p, 'tags', ['finance', 'q4', 'rozpočet']), swap(p, 'tags: [finance, q4]\n', 'tags: [finance, q4, rozpočet]\n'))
  assert.equal(await set(p, 'tags', []), swap(p, 'tags: [finance, q4]\n', ''), 'removing the last tag removes the key')
  const o = T(OBYC)
  assert.equal(await set(o, 'tags', ['rozpočet']), append(o, 'tags:\n  - rozpočet\n'), 'a note without tags gets a block list')
})

test('fr_typ_08_ac9_aliases_keep_the_flow_list', async () => {
  const s = T(STYL)
  assert.equal(await set(s, 'aliases', ['Styl', 'Hodnoty', 'Třetí']), swap(s, 'aliases: [Styl, Hodnoty]\n', 'aliases: [Styl, Hodnoty, Třetí]\n'))
})

test('fr_typ_08_ac10_source_is_a_quoted_wikilink', async () => {
  const o = T(OBYC)
  assert.equal(await set(o, 'source', { link: 'Rozpočet 2027' }), append(o, 'source: "[[Rozpočet 2027]]"\n'))
})

test('fr_typ_08_ac11_review_changes_only_its_line', async () => {
  const n = T('Nápady/Nápad k ověření.md')
  assert.equal(await set(n, 'review', 'reviewed'), swap(n, 'review: unreviewed\n', 'review: reviewed\n'))
})

// ------------------------------------------------------------------------------------------------ FR-TYP-07 (bytes)

test('fr_typ_07_ac5_type_change_replaces_only_the_type_line', async () => {
  const o = T(OBYC)
  const changed = await set(o, 'type', 'schůzka')
  assert.equal(changed, swap(o, 'type: page\n', 'type: schůzka\n'))
  assert.equal(await set(changed, 'type', 'page'), o, 'Page → Schůzka → Page restores the bytes (FR-TYP-07 AC-6)')
})

test('fr_typ_07_ac7_untyped_file_gets_a_frontmatter_with_the_type', async () => {
  const b = T(BEZ)
  assert.equal(await set(b, 'type', 'schůzka'), `---\ntype: schůzka\n---\n${b}`, 'the edited key first; identity keys come from the editor (D-174)')
})

test('fr_typ_07_ac10_a_type_list_becomes_one_string', async () => {
  const t = T('Pages/Dva typy.md')
  assert.equal(await set(t, 'type', 'projekt'), swap(t, 'type: [projekt, osoba]\n', 'type: projekt\n'))
})
