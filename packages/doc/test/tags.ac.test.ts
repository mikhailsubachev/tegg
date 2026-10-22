// MS4 slice 4D-lite, L1: tag names and Tag file bytes in `@tegg/doc` (docs/acceptance/tags.md R86, FR-TAG-03 AC-1,
// AC-3, FR-TAG-05 AC-1…AC-4 bytes, FR-TAG-10 AC-1; docs/contracts/ms4-tags.md §2). The name rules come from the shared
// table tests/fixtures/format/tags/names.json (also read by crates/tegg-format/tests/ac_tag_names.rs). Tag files are the
// committed tags fixture (synthetic, D-50). Written from the ACs and the contract only (D-61). The module loads inside
// each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tags', rel), 'utf8')
const NOW = '2026-10-22T10:00:00+02:00'
const NOW_LA = '2026-10-22T01:00:00-07:00'
const ID = '01JB4DNEW00000000000000001'

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['tagName', 'tagFile', 'setTagColor']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (ms4-tags §2)`)
  return m
}
type Row = { input: string; ok: boolean; name?: string; key?: string; error?: string; char?: string }
const table = (): Row[] => JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/format/tags/names.json'), 'utf8')).rows

// ------------------------------------------------------------------------------------------------ FR-TAG-03 AC-3

test('fr_tag_03_ac3_name_rules_from_the_shared_table', async () => {
  const { tagName } = await doc()
  const rows = table()
  assert.ok(rows.length >= 20, 'the shared table is read')
  const bad: string[] = []
  for (const r of rows) {
    const want = r.ok ? { ok: true, name: r.name, key: r.key } : r.char !== undefined ? { ok: false, error: r.error, char: r.char } : { ok: false, error: r.error }
    const got = tagName(r.input)
    const g = got.ok ? { ok: true, name: got.name, key: got.key } : got.char !== undefined ? { ok: false, error: got.error, char: got.char } : { ok: false, error: got.error }
    if (JSON.stringify(g) !== JSON.stringify(want)) bad.push(`${JSON.stringify(r.input)}: want ${JSON.stringify(want)}, got ${JSON.stringify(g)}`)
  }
  assert.deepEqual(bad, [], 'tagName per row (D-642, D-658)')
})

test('fr_tag_03_ac3_one_leading_hash_is_dropped_and_names_are_nfc', async () => {
  const { tagName } = await doc()
  assert.deepEqual(tagName('#Účty'), { ok: true, name: 'Účty', key: 'účty' }, '#Účty → Účty')
  assert.deepEqual(tagName('Účty'.normalize('NFD')), { ok: true, name: 'Účty', key: 'účty' }, 'NFD input → NFC name')
  assert.deepEqual(tagName('##x'), { ok: false, error: 'char', char: '#' }, '##x: only one # is dropped (AP-588)')
  assert.deepEqual(tagName('#'), { ok: false, error: 'empty' }, '# only is empty')
  assert.deepEqual(tagName('moje štítky'), { ok: false, error: 'space' }, 'a non-breaking space is a space')
})

// ------------------------------------------------------------------------------------------------ FR-TAG-03 AC-1 (R86)

test('fr_tag_03_ac1_new_tag_file_bytes_r86', async () => {
  const { tagFile } = await doc()
  const want = `---\nid: ${ID}\ntype: tag\ntitle: Účetnictví\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`
  assert.equal(tagFile({ id: ID, title: 'Účetnictví', now: NOW }), want, 'R86: no color, created = modified, ends with ---\\n')
  assert.equal(tagFile({ id: ID, title: 'Účetnictví'.normalize('NFD'), now: NOW }), want, 'the title is written NFC')
})

test('fr_tag_03_ac1_tz_los_angeles_offset_is_written', async () => {
  const { tagFile } = await doc()
  assert.equal(
    tagFile({ id: ID, title: 'Účetnictví', now: NOW_LA }),
    `---\nid: ${ID}\ntype: tag\ntitle: Účetnictví\ncreated: ${NOW_LA}\nmodified: ${NOW_LA}\n---\n`,
    '(TZ) the -07:00 offset of that instant',
  )
})

test('fr_tag_03_ac1_title_is_quoted_when_yaml_would_misread_it', async () => {
  const { tagFile, formatScalar } = await doc()
  const t = tagFile({ id: ID, title: 'true', now: NOW })
  assert.equal(t, `---\nid: ${ID}\ntype: tag\ntitle: "true"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'title: "true" (formatScalar)')
  assert.equal(`title: ${formatScalar('true')}`, 'title: "true"', 'the same quoting as formatScalar')
})

// ------------------------------------------------------------------------------------------------ FR-TAG-05 AC-3

test('fr_tag_05_ac3_virtual_tag_colour_file_bytes', async () => {
  const { tagFile } = await doc()
  assert.equal(
    tagFile({ id: ID, title: 'finance', color: 'orange', now: NOW }),
    `---\nid: ${ID}\ntype: tag\ntitle: finance\ncolor: orange\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`,
    'R86 with color: orange after title',
  )
})

// ------------------------------------------------------------------------------------------------ FR-TAG-05 AC-1, AC-2, AC-4

test('fr_tag_05_ac1_set_colour_changes_only_color_and_modified', async () => {
  const { setTagColor } = await doc()
  const ucty = fx('Tags/Účty.md')
  const want = ucty.replace('color: blue\n', 'color: green\n').replace('modified: 2026-09-01T09:00:00+02:00\n', `modified: ${NOW}\n`)
  assert.notEqual(want, ucty, 'setup')
  assert.equal(setTagColor(ucty, 'green', NOW), want, 'only color: and modified: change (FR-SYN-06)')
  assert.equal(setTagColor(ucty, 'blue', NOW), ucty, 'the checked colour again: same bytes (the UI writes nothing)')
})

test('fr_tag_05_ac2_none_removes_the_color_key', async () => {
  const { setTagColor } = await doc()
  const ucty = fx('Tags/Účty.md')
  const want = ucty.replace('color: blue\n', '').replace('modified: 2026-09-01T09:00:00+02:00\n', `modified: ${NOW}\n`)
  assert.equal(setTagColor(ucty, null, NOW), want, 'None: the color: line goes, modified changes, every other byte stays')
  const ab = fx('Tags/a b.md')
  assert.equal(setTagColor(ab, null, NOW), ab, 'F-ab has no color: None writes the same bytes')
})

test('fr_tag_05_ac4_purple_replaces_an_unknown_colour', async () => {
  const { setTagColor } = await doc()
  const nez = fx('Tags/neznámá.md')
  const want = nez.replace('color: magenta\n', 'color: purple\n').replace('modified: 2026-09-01T09:00:00+02:00\n', `modified: ${NOW}\n`)
  assert.equal(setTagColor(nez, 'purple', NOW), want, 'magenta → purple; description and x-extra kept in place (FR-TAG-01 AC-4)')
})

// ------------------------------------------------------------------------------------------------ FR-TAG-10 AC-1

test('fr_tag_10_ac1_slash_is_part_of_one_name', async () => {
  const { tagName, tagFile } = await doc()
  assert.deepEqual(tagName('x/y'), { ok: true, name: 'x/y', key: 'x/y' }, 'x/y is one name')
  assert.deepEqual(tagName('#a/b'), { ok: true, name: 'a/b', key: 'a/b' }, '#a/b is one name')
  assert.match(tagFile({ id: ID, title: 'x/y', now: NOW }), /\ntitle: x\/y\n/, 'title: x/y')
})
