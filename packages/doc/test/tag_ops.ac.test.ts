// MS4 slice 4D-lite, L1: the text ops of the tag jobs and merge (`transform`, docs/contracts/ms4-tags.md §4.2) as
// table tests on the tags fixture (docs/acceptance/tags.md): FR-TAG-04 AC-4 (`rename-tag`: every occurrence, exact
// bytes, list style, CRLF, NFD written NFC, near misses untouched, no `modified` change, D-699, D-713), FR-TAG-08 AC-2
// (`remove-tag`: entries with their separators, an emptied `tags:` key, the following / preceding space, a tag-only
// line, D-715, D-716), FR-LNK-14 AC-12 (`merge-into`, D-727), FR-TAG-10 AC-1 (`#účty/archiv` is another tag). The same
// ops run end to end in crates/tegg-jobs/tests/ac_tag_jobs.rs. Written from the ACs and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tags', rel), 'utf8')
const NFD = 'účty'.normalize('NFD')
const NOW = '2026-10-22T10:00:00+02:00'

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  assert.equal(typeof m.transform, 'function', '@tegg/doc exports transform (ms4-jobs §2.3)')
  return m
}
/** The text after `ops`, or the input when the result is `unchanged`. */
async function run(path: string, text: string, ops: unknown[]): Promise<string> {
  const { transform } = await doc()
  const r = transform(path, text, ops)
  return r.kind === 'bytes' ? r.text : text
}
function swap(text: string, pairs: [string, string][]): string {
  let t = text
  for (const [a, b] of pairs) {
    assert.ok(t.includes(a), `setup: ${JSON.stringify(a)} in the fixture`)
    t = t.replace(a, b)
  }
  return t
}

const RENAME = [{ op: 'rename-tag', key: 'účty', to: 'Výdaje' }]

// ------------------------------------------------------------------------------------------------ FR-TAG-04 AC-4

test('fr_tag_04_ac4_rename_tag_exact_bytes_per_file', async () => {
  const rows: [string, [string, string][]][] = [
    ['Pages/Rozpočet.md', [['tags: [účty, finance]', 'tags: [Výdaje, finance]']]],
    ['Tasks/Zaplatit nájem.md', [['  - Účty\n', '  - Výdaje\n']]],
    ['Tasks/Zavolat bance.md', [['tags: [účty]\r\n', 'tags: [Výdaje]\r\n']]],
    ['Quick Notes/Faktura.md', [[`Poslat #${NFD} dnes.`, 'Poslat #Výdaje dnes.']]],
    ['Daily/2026-10-20.md', [['\n#ÚČTY\n', '\n#Výdaje\n']]],
    ['Pages/Dvakrát.md', [['tags: [účty]', 'tags: [Výdaje]'], ['#Účty a znovu #účty.', '#Výdaje a znovu #Výdaje.']]],
    ['_templates/Page/Page.md', [['tags: [účty]', 'tags: [Výdaje]'], ['\n#účty\n', '\n#Výdaje\n']]],
  ]
  const bad: string[] = []
  for (const [path, pairs] of rows) {
    const text = fx(path)
    const want = swap(text, pairs)
    const got = await run(path, text, RENAME)
    if (got !== want) bad.push(`${path}: ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'only the tag bytes change; list style, CRLF, missing final newline, `modified` kept (D-713)')
})

test('fr_tag_04_ac4_near_misses_and_other_keys_are_untouched', async () => {
  const { transform } = await doc()
  for (const path of ['Pages/Kód.md', 'Projekty/Web.md', 'Pages/Lomítko.md', 'Pages/Kniha.md', 'Pages/Výplň 01.md']) {
    assert.deepEqual(transform(path, fx(path), RENAME), { kind: 'unchanged' }, `${path}: no occurrence of účty (code, math, links, URLs, #účty-2026)`)
  }
  const dvakrat = await run('Pages/Dvakrát.md', fx('Pages/Dvakrát.md'), RENAME)
  assert.ok(dvakrat.includes('#Výdaje a znovu #Výdaje.\n\nArchiv: #účty/archiv\n'), '#účty is renamed, #účty/archiv is another tag (FR-TAG-10 AC-1)')
})

test('fr_tag_04_ac4_new_value_is_quoted_when_yaml_needs_it', async () => {
  const t = await run('Pages/Rozpočet.md', fx('Pages/Rozpočet.md'), [{ op: 'rename-tag', key: 'účty', to: 'true' }])
  assert.equal(t, fx('Pages/Rozpočet.md').replace('tags: [účty, finance]', 'tags: ["true", finance]'), 'formatScalar quoting inside the flow list')
})

test('fr_tag_04_ac4_edits_cover_only_the_tag_names', async () => {
  const { transform } = await doc()
  const text = fx('Pages/Dvakrát.md')
  const r = transform('Pages/Dvakrát.md', text, RENAME)
  assert.equal(r.kind, 'bytes', 'rewritten')
  const bytes = Buffer.from(text)
  const replaced = (r.edits as { start: number; end: number }[]).map((e) => bytes.subarray(e.start, e.end).toString('utf8'))
  assert.deepEqual(replaced, ['účty', 'Účty', 'účty'], 'one edit per occurrence, the name bytes only (the # and the list are kept)')
})

// ------------------------------------------------------------------------------------------------ FR-TAG-08 AC-2

const REMOVE = [{ op: 'remove-tag', key: 'účty' }]

test('fr_tag_08_ac2_remove_tag_exact_bytes_per_file', async () => {
  const rows: [string, [string, string][]][] = [
    ['Pages/Rozpočet.md', [['tags: [účty, finance]', 'tags: [finance]']]],
    ['Tasks/Zaplatit nájem.md', [['tags:\n  - Účty\n', '']]],
    ['Tasks/Zavolat bance.md', [['tags: [účty]\r\n', '']]],
    ['Quick Notes/Faktura.md', [[`Poslat #${NFD} dnes.`, 'Poslat dnes.']]],
    ['Daily/2026-10-20.md', [['Ranní zápis.\n#ÚČTY\nOdpolední zápis.', 'Ranní zápis.\nOdpolední zápis.']]],
    ['Pages/Dvakrát.md', [['tags: [účty]\n', ''], ['#Účty a znovu #účty.\n', 'a znovu.\n']]],
    ['_templates/Page/Page.md', [['tags: [účty]\n', ''], ['---\n#účty\n', '---\n']]],
  ]
  const bad: string[] = []
  for (const [path, pairs] of rows) {
    const text = fx(path)
    const want = swap(text, pairs)
    const got = await run(path, text, REMOVE)
    if (got !== want) bad.push(`${path}: ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'entries with their separators, emptied tags: keys (D-715), spaces and tag-only lines (D-716)')
})

test('fr_tag_08_ac2_remove_keeps_near_misses_and_other_tags', async () => {
  const { transform } = await doc()
  assert.deepEqual(transform('Pages/Kód.md', fx('Pages/Kód.md'), REMOVE), { kind: 'unchanged' }, 'Kód untouched')
  assert.deepEqual(transform('Projekty/Web.md', fx('Projekty/Web.md'), REMOVE), { kind: 'unchanged' }, 'Web untouched')
  const d = await run('Pages/Dvakrát.md', fx('Pages/Dvakrát.md'), REMOVE)
  assert.ok(d.endsWith('---\na znovu.\n\nArchiv: #účty/archiv\n'), '#účty removed, Archiv: #účty/archiv stays (FR-TAG-10 AC-1)')
})

test('fr_tag_08_ac2_preceding_space_when_no_following_one', async () => {
  const text = '---\nid: x\ntype: page\ntitle: X\n---\nKonec věty #účty\nDalší #účty, čárka.\n'
  assert.equal(await run('Pages/X.md', text, REMOVE), '---\nid: x\ntype: page\ntitle: X\n---\nKonec věty\nDalší, čárka.\n', 'D-716: the preceding space when no space follows')
})

// ------------------------------------------------------------------------------------------------ FR-LNK-14 AC-12

test('fr_lnk_14_ac12_merge_into_schuzka', async () => {
  const kept = fx('Pages/Schůzka.md')
  const other = fx('Pages/schůzka (2).md')
  const got = await run('Pages/Schůzka.md', kept, [{ op: 'merge-into', others: [{ path: 'Pages/schůzka (2).md', title: 'SCHŮZKA', text: other }], now: NOW }])
  const want = [
    '---',
    'id: 01JB4D0000000000000000G012',
    'type: page',
    'title: Schůzka',
    'x-místo: Brno',
    'aliases: [porada]',
    'tags: [čtení]',
    'created: 2026-09-01T09:00:00+02:00',
    `modified: ${NOW}`,
    '---',
    'Zápis A.',
    '',
    '## SCHŮZKA (merged)',
    '',
    'Zápis B.',
    '',
  ].join('\n')
  assert.equal(got, want, 'missing values added (x-místo kept), aliases and tags unions, no case-only alias, the body section (D-727; AP-672 for the aliases position)')
})

test('fr_lnk_14_ac12_merge_into_empty_bodies_add_no_heading', async () => {
  const kept = fx('Tags/dvojí.md')
  const got = await run('Tags/dvojí.md', kept, [{ op: 'merge-into', others: [{ path: 'Tags/Dvojí (2).md', title: 'Dvojí', text: fx('Tags/Dvojí (2).md') }], now: NOW }])
  assert.equal(got, kept.replace('modified: 2026-05-01T09:00:00+02:00\n', `modified: ${NOW}\n`), 'color: red kept, no body, only modified touched (FR-LNK-14 AC-14)')
})
