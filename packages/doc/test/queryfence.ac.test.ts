// Slice Q, L1 / L3 at @tegg/doc: the query fence (docs/acceptance/queries.md R140; docs/contracts/v1-queries.md §3.1).
// `queryFences` is the L3 twin of `tegg_format::query_fences` and must give tests/fixtures/queries-files/expected.json's
// `fences` (UTF-8 byte ranges, `saved`, `nested`); the info string's first word is exactly `query` (D-1464); fences in
// lists, quotes and callouts count, their body read without container prefixes. `savedName`, `withSavedName`
// (`Choose a query…`, FR-QRY-06 AC-12), `referenceFence` (`Save as query…`, AC-14), `newQueryFence` (`/query`, AC-9) and
// the `transform` op `rename-saved-query` (the rename job's usages, AC-6; FR-FMT-06 AC-5's kept lines; FR-FMT-12 AC-9's
// NFC and case rule) change only what they name. FR-FMT-07 AC-30: the fixture's notes with blocks round-trip.
// Written from the ACs, the contract and the fixtures only (D-61). The functions are read from the package's index at
// run time, so a missing export is an assertion failure (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as doc from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/queries', rel), 'utf8')
const EXPECTED = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/queries-files/expected.json'), 'utf8')) as { fences: Record<string, { range: [number, number]; saved: string | null; nested: boolean }[]> }
const D = doc as unknown as Record<string, any>
type Fence = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string }
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (contract §3.1)`)
  return D[name] as T
}
const queryFences = (t: string) => fn<(t: string) => Fence[]>('queryFences')(t)
const bytesOf = (t: string, i: number) => Buffer.byteLength(t.slice(0, i))
const NOTES = ['Schůzky/2026-10-07 Týdenní porada.md', 'Schůzky/2026-10-14 Týdenní porada.md', 'Projekty/Výjezd Lisabon 2026.md', 'Daily/2026-11-10.md', 'Pages/Přehled dotazů.md', '_templates/Schůzka/Schůzka.md']
const OPEN = 'Otevřené úkoly z této schůzky'
function rename(path: string, text: string, from: string, to: string): string | null {
  const r = D.transform(path, text, [{ op: 'rename-saved-query', from, to }])
  return r.kind === 'bytes' ? r.text : null
}

// ------------------------------------------------------------------------------------------------ R140, L3

test('fr_fmt_06_ac4_query_fences_match_the_core', () => {
  for (const [path, want] of Object.entries(EXPECTED.fences)) {
    const text = fx(path)
    const got = queryFences(text)
    assert.deepEqual(got.map((f) => ({ range: f.range, saved: f.saved, nested: f.nested })), want.map((w) => ({ range: w.range, saved: w.saved, nested: w.nested })), `${path}: expected.json's fences`)
    for (const f of got) {
      const src = Buffer.from(text).subarray(f.range[0], f.range[1]).toString('utf8')
      assert.ok(/^(```|~~~)query/.test(src), `${path}: the range starts at the fence's opening line`)
      assert.equal(f.info, 'query', `${path}: the info string as written`)
    }
  }
  const p = fx('Pages/Přehled dotazů.md')
  const inline = queryFences(p)[5]
  assert.equal(inline.body, 'title: Ruční dotaz\ntypes: [kniha]\nfilters:\n  - přečteno: true\n# napsáno ručně\nview: list', 'the inline fence\'s body as CommonMark reads it')
  // R140: the info string's first word is exactly `query`; `~~~` fences count; the rest of the info string is kept.
  const t = [
    'Úvod.', '', '```Query', 'saved: Projekty v běhu', '```', '', '~~~query', 'saved: Zrušené úkoly', '~~~', '', '```query široký', 'saved: Projekty v běhu', '```', '',
    '```queryx', 'saved: Projekty v běhu', '```', '', '- položka', '', '  ```query', '  saved: Úkoly po termínu', '  ```', '', '> ```query', '> saved: Starý dotaz', '> ```', '',
    '> [!note] Poznámka', '> ```query', '> saved: Nečitelný', '> ```', '',
  ].join('\n')
  const fs = queryFences(t)
  assert.deepEqual(fs.map((f) => [f.saved, f.nested, f.info]), [
    ['Zrušené úkoly', false, 'query'], ['Projekty v běhu', false, 'query široký'], ['Úkoly po termínu', true, 'query'], ['Starý dotaz', true, 'query'], ['Nečitelný', true, 'query'],
  ], '`Query` and `queryx` are ordinary code blocks; ~~~, meta, list, quote and callout fences count')
  assert.deepEqual(fs.slice(2).map((f) => f.body), ['saved: Úkoly po termínu', 'saved: Starý dotaz', 'saved: Nečitelný'], 'nested bodies without container prefixes')
  assert.equal(fs[0].range[0], bytesOf(t, t.indexOf('~~~query')), 'byte ranges (UTF-8)')
  const kinds = doc.parse(t).blocks.map((b) => b.kind)
  assert.equal(kinds.filter((k) => k === 'query').length, 2, 'parse: only the two top-level `query` fences are query blocks (`Query` is code)')
  // Frontmatter is skipped.
  assert.deepEqual(queryFences('---\ntitle: "```query"\n---\nText.\n'), [], 'nothing in the frontmatter')
})

// ------------------------------------------------------------------------------------------------ helpers of §3.1

test('fr_qry_06_ac9_new_query_fence', () => {
  const newQueryFence = fn<(n: string) => string>('newQueryFence')
  assert.equal(newQueryFence('Projekty v běhu'), '```query\nsaved: Projekty v běhu\n```', 'the inserted fence')
  assert.equal(newQueryFence('Untitled query (2)'), '```query\nsaved: Untitled query (2)\n```', 'a free name (D-1495)')
  const savedName = fn<(b: string) => string | null>('savedName')
  assert.equal(savedName(newQueryFence('Vše, co sem odkazuje').split('\n')[1]), 'Vše, co sem odkazuje', 'savedName reads it back')
})

test('fr_qry_06_ac12_choose_a_query_rewrites_only_the_saved_line', () => {
  const withSavedName = fn<(src: string, n: string) => string | null>('withSavedName')
  assert.equal(withSavedName('```query\nsaved: Neexistující dotaz\n```', 'Zrušené úkoly'), '```query\nsaved: Zrušené úkoly\n```', 'only the value')
  assert.equal(withSavedName('~~~query\nsaved: Neexistující dotaz\n# poznámka\n~~~', 'Zrušené úkoly'), '~~~query\nsaved: Zrušené úkoly\n# poznámka\n~~~', 'other lines and the markers kept')
  assert.equal(withSavedName('```query\ntitle: Ruční dotaz\n```', 'Zrušené úkoly'), null, 'no `saved:` line: null')
  assert.equal(withSavedName('```query\r\nsaved: Neexistující dotaz\r\n```', 'Zrušené úkoly'), '```query\r\nsaved: Zrušené úkoly\r\n```', 'CRLF kept')
})

test('fr_qry_06_ac14_save_as_replaces_the_body', () => {
  const referenceFence = fn<(src: string, n: string) => string>('referenceFence')
  const p = fx('Pages/Přehled dotazů.md')
  const f = queryFences(p)[5]
  const src = Buffer.from(p).subarray(f.range[0], f.range[1]).toString('utf8')
  assert.equal(referenceFence(src, 'Ruční dotaz'), '```query\nsaved: Ruční dotaz\n```\n', 'the body is `saved: Ruční dotaz`; the fence lines and the final line ending kept')
  assert.equal(referenceFence('~~~query meta\ntitle: X\n~~~', 'Ruční dotaz'), '~~~query meta\nsaved: Ruční dotaz\n~~~', 'markers and the info string kept')
  assert.equal(referenceFence('> ```query\n> title: X\n> types: [kniha]\n> ```', 'Ruční dotaz'), '> ```query\n> saved: Ruční dotaz\n> ```', 'container prefixes kept')
})

test('fr_fmt_06_ac5_reference_fence_keeps_other_lines', () => {
  const savedName = fn<(b: string) => string | null>('savedName')
  const body = 'saved: Projekty v běhu\n# moje poznámka\nx-pohled: úzký'
  assert.equal(savedName(body), 'Projekty v běhu', 'a reference with other lines')
  assert.equal(savedName('x-pohled: úzký\nsaved: "Projekty v běhu"  '), 'Projekty v běhu', 'quoted, trimmed, any line')
  assert.equal(savedName('title: X\nview: list'), null, 'an inline definition has no name')
  assert.equal(savedName('  saved: Projekty v běhu'), null, 'only at column 0')
  const note = `Úvod.\n\n\`\`\`query\n${body}\n\`\`\`\n\nKonec.\n`
  const out = rename('Pages/Poznámka.md', note, 'Projekty v běhu', 'Běžící projekty')
  assert.equal(out, note.replace('saved: Projekty v běhu', 'saved: Běžící projekty'), 'the rename op changes only the `saved:` value; `# moje poznámka` and `x-pohled: úzký` stay')
})

// ------------------------------------------------------------------------------------------------ the rename job's text side

test('fr_qry_06_ac6_rename_saved_query_patches_only_saved_lines', () => {
  for (const path of ['Schůzky/2026-10-07 Týdenní porada.md', 'Schůzky/2026-10-14 Týdenní porada.md', '_templates/Schůzka/Schůzka.md']) {
    const text = fx(path)
    const out = rename(path, text, OPEN, 'Otevřené úkoly porady')
    assert.equal(out, text.replace(`saved: ${OPEN}`, 'saved: Otevřené úkoly porady'), `${path}: only that \`saved:\` line (no \`modified\` change, the other fence kept)`)
  }
  assert.equal(rename('Projekty/Výjezd Lisabon 2026.md', fx('Projekty/Výjezd Lisabon 2026.md'), OPEN, 'Otevřené úkoly porady'), null, 'a note without a usage is unchanged')
  const nested = `- úkoly\n\n  \`\`\`query\n  saved: ${OPEN}\n  \`\`\`\n\n> \`\`\`query\n> saved: ${OPEN}\n> \`\`\`\n`
  assert.equal(rename('Pages/Vnořené.md', nested, OPEN, 'Otevřené úkoly porady'), nested.split(`saved: ${OPEN}`).join('saved: Otevřené úkoly porady'), 'nested fences: prefixes kept')
  const inCode = `\`\`\`yaml\nsaved: ${OPEN}\n\`\`\`\n`
  assert.equal(rename('Pages/Kód.md', inCode, OPEN, 'Otevřené úkoly porady'), null, 'a `saved:` line outside a query fence is no usage')
})

test('fr_fmt_12_ac9_query_names_are_nfc', () => {
  const savedName = fn<(b: string) => string | null>('savedName')
  const newQueryFence = fn<(n: string) => string>('newQueryFence')
  assert.equal(savedName(`saved: ${'Projekty v běhu'.normalize('NFD')}`), 'Projekty v běhu', 'savedName is NFC')
  assert.equal(newQueryFence('Projekty v běhu'.normalize('NFD')), '```query\nsaved: Projekty v běhu\n```', 'newQueryFence writes NFC')
  for (const written of ['otevřené ÚKOLY z této schůzky', OPEN.normalize('NFD')]) {
    const t = `\`\`\`query\nsaved: ${written}\n\`\`\`\n`
    assert.equal(rename('Pages/Jinak.md', t, OPEN, 'Otevřené úkoly porady'), '```query\nsaved: Otevřené úkoly porady\n```\n', `\`saved: ${written}\` is a usage (name key: NFC, case-insensitive) and is written NFC`)
  }
  assert.deepEqual(queryFences(`\`\`\`query\nsaved: ${'Starý dotaz'.normalize('NFD')}\n\`\`\`\n`).map((f) => f.saved), ['Starý dotaz'], 'queryFences gives NFC names')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-30

test('fr_fmt_07_ac30_notes_with_query_blocks_round_trip', () => {
  for (const path of NOTES) {
    for (const [what, text] of [['LF', fx(path)], ['CRLF', fx(path).replace(/\n/g, '\r\n')]] as const) {
      assert.equal(doc.serialize(doc.parse(text)), text, `${path} (${what}): parse → serialize is the identity`)
      assert.equal(rename(path, text, 'Neexistující', 'Jiný'), null, `${path} (${what}): a rename of another query changes nothing`)
    }
    assert.ok(queryFences(fx(path)).length >= 1, `${path}: holds a query fence`)
  }
})
