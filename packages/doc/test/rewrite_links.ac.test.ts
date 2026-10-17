// MS4 slice 4C, L1: `@tegg/doc` link rewriting for a rename (docs/contracts/ms4-jobs.md §2.3, link form rules D-383,
// frontmatter links D-388, NFC FR-FMT-12). docs/acceptance/rename.md FR-LNK-03 AC-7 (table test of `rewriteLinks`),
// AC-8, AC-9, AC-11 (bytes); FR-FMT-08 AC-6 (the full title kept by `set-title`; the `sanitize` cases are L1 in
// crates/tegg-jobs/tests/ac_rename.rs because `sanitize_file_stem` is the Rust function the planner uses);
// links.md FR-FMT-08 / FR-LNK-03 AC-3 (links in code, by its FR-LNK-03 alias key).
// Input is the synthetic fixture tests/fixtures/vaults/rename/ read byte-exact (NFD and CRLF files included).
// Written from the ACs and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { rewriteLinks, transform, type TextOp, type Transformed } from '../src/index.js'

const FX = resolve(import.meta.dirname, '../../../tests/fixtures/vaults/rename')
const read = (rel: string) => readFileSync(resolve(FX, rel), 'utf8')
const NOW = '2026-10-17T10:00:00+02:00'

/** The vault's note paths before the rename (what the planner puts in the op). */
const PATHS = [
  'Pages/Alfa.md', 'Pages/Odkazy.md', 'Pages/Kód.md', 'Books/Vlastnosti.md', 'Pages/NFD odkaz.md', 'Pages/Čaj o páté.md',
  ...Array.from({ length: 40 }, (_, i) => `Pages/Výplň ${String(i + 1).padStart(2, '0')}.md`),
  'Pages/Alfa (2).md', 'Projekty/Alfa.md', 'Projekty/Místní.md', 'Daily/2026-10-14.md', 'Pages/Windows.md', 'Pages/Beta.md',
]

type Retarget = Extract<TextOp, { op: 'retarget-links' }>
function op(to: { stem: string; title: string; path?: string }, from = { path: 'Pages/Alfa.md', stem: 'Alfa', title: 'Alfa' }): Retarget {
  return {
    op: 'retarget-links', fromPath: from.path, fromStem: from.stem, fromTitle: from.title,
    toPath: to.path ?? `Pages/${to.stem}.md`, toStem: to.stem, toTitle: to.title, paths: PATHS,
  }
}
const GAMA = op({ stem: 'Gama', title: 'Gama' })
const Q3 = op({ stem: 'Q3 plan budget', title: 'Q3: plan/budget' })

/** The output text; `null` when the engine reports `unchanged`. */
const out = (t: Transformed) => (t.kind === 'bytes' ? t.text : null)
const utf8 = (s: string) => Buffer.byteLength(s, 'utf8')

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-7

test('fr_lnk_03_ac7_every_link_form_rewritten_exactly_in_odkazy', () => {
  const src = read('Pages/Odkazy.md')
  const want = src
    .replace('\n[[Alfa]]\n', '\n[[Gama]]\n')
    .replace('[[Alfa|vlastní text]]', '[[Gama|vlastní text]]')
    .replace('\n[[Alfa#Úvod]]', '\n[[Gama#Úvod]]')
    .replace('[[Alfa#^b1]]', '[[Gama#^b1]]')
    .replace('![[Alfa]]', '![[Gama]]')
    .replace('![[Alfa#Úvod]]', '![[Gama#Úvod]]')
    .replace('[[Pages/Alfa]]', '[[Pages/Gama]]')
    .replace('[[Alfa.md]]', '[[Gama.md]]')
    .replace('[Alfa](Alfa.md)', '[Alfa](Gama.md)')
    .replace('[jinak](../Pages/Alfa.md)', '[jinak](../Pages/Gama.md)')
  assert.ok(want.includes('[[Alfabet]]') && want.includes('[[Alfa (2)]]') && want.includes('\n#Alfa\n') && want.endsWith('\nAlfa\n'), 'setup: near misses')
  const r = rewriteLinks('Pages/Odkazy.md', src, GAMA)
  assert.equal(out(r), want, 'line by line as AC-7; [[Alfabet]], [[Alfa (2)]], #Alfa and plain Alfa unchanged; every other byte identical')
})

test('fr_lnk_03_ac7_table_of_link_forms', () => {
  // [written, rewritten] for Alfa → Gama, from a note in Pages/ (D-383 table).
  const rows: [string, string][] = [
    ['[[Alfa]]', '[[Gama]]'],
    ['![[Alfa]]', '![[Gama]]'],
    ['[[Alfa#Úvod]]', '[[Gama#Úvod]]'],
    ['[[Alfa#^b1]]', '[[Gama#^b1]]'],
    ['[[Alfa|vlastní text]]', '[[Gama|vlastní text]]'],
    ['[[Alfa|Alfa]]', '[[Gama]]'], // an alias equal to the old title becomes the new title, dropped when it equals the stem
    ['[[Pages/Alfa]]', '[[Pages/Gama]]'],
    ['[[Alfa.md]]', '[[Gama.md]]'],
    ['[[alfa]]', '[[Gama]]'],
    ['[Alfa](Alfa.md)', '[Alfa](Gama.md)'],
    ['[jinak](../Pages/Alfa.md)', '[jinak](../Pages/Gama.md)'],
    ['[[Alfabet]]', '[[Alfabet]]'],
    ['[[Alfa (2)]]', '[[Alfa (2)]]'],
    ['`[[Alfa]]`', '`[[Alfa]]`'],
  ]
  const wrong: string[] = []
  for (const [a, b] of rows) {
    const text = `---\ntitle: Test\n---\nPřed ${a} za.\n`
    const r = rewriteLinks('Pages/Test.md', text, GAMA)
    const got = out(r) ?? text
    if (got !== `---\ntitle: Test\n---\nPřed ${b} za.\n`) wrong.push(`${a} → ${got.split('\n')[3]} (want ${b})`)
  }
  assert.deepEqual(wrong, [], 'each form rewritten per D-383; near misses and code unchanged')
})

test('fr_lnk_03_ac7_edits_are_utf8_ranges_of_the_rewritten_links', () => {
  const src = read('Pages/Odkazy.md')
  const r = rewriteLinks('Pages/Odkazy.md', src, GAMA)
  assert.equal(r.kind, 'bytes', 'Odkazy changes')
  if (r.kind !== 'bytes') return
  assert.equal(r.edits.length, 10, 'one edit per rewritten link (10 forms)')
  const bytes = Buffer.from(src, 'utf8')
  for (const e of r.edits) {
    const piece = bytes.subarray(e.start, e.end).toString('utf8')
    assert.match(piece, /Alfa/, `edit [${e.start}, ${e.end}) is inside a link to Alfa: ${JSON.stringify(piece)}`)
    assert.ok(e.end - e.start <= utf8('[jinak](../Pages/Alfa.md)'), `edit [${e.start}, ${e.end}) stays within one link`)
  }
})

test('fr_lnk_03_ac7_self_link_changes_with_the_title_in_one_transform', () => {
  const src = read('Pages/Alfa.md')
  const r = transform('Pages/Alfa.md', src, [{ op: 'set-title', title: 'Gama', now: NOW }, GAMA])
  const want = src.replace('title: Alfa', 'title: Gama').replace(/^modified: .*$/m, `modified: ${NOW}`).replace('[[Alfa#Úvod]]', '[[Gama#Úvod]]')
  assert.equal(out(r), want, 'title, modified and the self-link [[Gama#Úvod]] in one result')
})

test('fr_lnk_03_ac3_links_in_code_are_not_rewritten', () => {
  // links.md AC-3: Kód's code span, fence and indented block keep [[Alfa]]; a text link next to them follows.
  const src = `${read('Pages/Kód.md')}\nMimo kód: [[Alfa]]\n`
  const r = rewriteLinks('Pages/Kód.md', src, GAMA)
  assert.equal(out(r), src.replace('Mimo kód: [[Alfa]]', 'Mimo kód: [[Gama]]'), 'only the text link changes')
})

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-8

test('fr_lnk_03_ac8_frontmatter_links_keep_quoting_order_and_list_style', () => {
  const src = read('Books/Vlastnosti.md')
  const want = src
    .replace('autor: "[[Alfa]]"', 'autor: "[[Gama]]"')
    .replace('zdroje: ["[[Alfa]]", "[[Beta]]"]', 'zdroje: ["[[Gama]]", "[[Beta]]"]')
    .replace('poznámka: viz [[Alfa]]', 'poznámka: viz [[Gama]]')
    .replace('x-extra: [[Alfa]]', 'x-extra: [[Gama]]')
  assert.equal(out(rewriteLinks('Books/Vlastnosti.md', src, GAMA)), want, 'relation, flow list, text value and unknown key (D-388); every other byte unchanged')
})

test('fr_lnk_03_ac8_block_list_relation', () => {
  const src = '---\nid: 01JB4C0000000000000000R401\ntype: book\ntitle: Seznam\nzdroje:\n  - "[[Alfa]]"\n  - "[[Beta]]"\n---\nTělo.\n'
  assert.equal(out(rewriteLinks('Books/Seznam.md', src, GAMA)), src.replace('- "[[Alfa]]"', '- "[[Gama]]"'), 'block list style kept')
})

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-9

test('fr_lnk_03_ac9_links_needing_an_alias', () => {
  const src = read('Pages/Odkazy.md')
  const got = out(rewriteLinks('Pages/Odkazy.md', src, Q3)) ?? src
  const lines = got.split('\n')
  for (const want of [
    '[[Q3 plan budget|Q3: plan/budget]]',
    '[[Q3 plan budget|vlastní text]]',
    '[[Q3 plan budget#Úvod|Q3: plan/budget]]',
    '[[Q3 plan budget#^b1|Q3: plan/budget]]',
    '![[Q3 plan budget]]',
    '![[Q3 plan budget#Úvod]]',
    '[[Pages/Q3 plan budget|Q3: plan/budget]]',
    '[[Q3 plan budget.md|Q3: plan/budget]]',
  ]) {
    assert.ok(lines.includes(want), `line ${want} (D-383: the alias for a title that needs one; embeds never get one)`)
  }
  assert.ok(!lines.some((l) => /^!\[\[.*\|/.test(l)), 'no embed has an alias')
})

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-11

test('fr_lnk_03_ac11_nfd_link_rewritten_in_nfc_only_its_bytes', () => {
  const src = read('Pages/NFD odkaz.md')
  const nfdLink = `[[${'Čaj o páté'.normalize('NFD')}]]`
  assert.ok(src.includes(nfdLink), 'setup: the fixture holds the NFD link')
  const caj = op({ stem: 'Čaj o šesté', title: 'Čaj o šesté' }, { path: 'Pages/Čaj o páté.md', stem: 'Čaj o páté', title: 'Čaj o páté' })
  const r = rewriteLinks('Pages/NFD odkaz.md', src, caj)
  assert.equal(out(r), src.replace(nfdLink, '[[Čaj o šesté]]'), 'only the link bytes change, written in NFC')
  if (r.kind === 'bytes') {
    const start = utf8(src.slice(0, src.indexOf(nfdLink)))
    const end = start + utf8(nfdLink)
    assert.deepEqual(r.edits.map((e) => start <= e.start && e.start < e.end && e.end <= end), [true], 'one edit, inside the link, in UTF-8 offsets of the input')
  }
})

test('fr_lnk_03_ac11_crlf_and_missing_final_newline_kept', () => {
  const src = read('Pages/Windows.md')
  assert.ok(src.includes('\r\n') && !src.endsWith('\n'), 'setup: CRLF, no final newline')
  assert.equal(out(rewriteLinks('Pages/Windows.md', src, GAMA)), src.replace('[[Alfa]]', '[[Gama]]'), 'CRLF and the missing final newline kept')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-6

test('fr_fmt_08_ac6_set_title_keeps_the_full_title', () => {
  const src = read('Pages/Alfa.md')
  const q3 = out(transform('Pages/Alfa.md', src, [{ op: 'set-title', title: 'Q3: plan/budget', now: NOW }]))
  assert.ok(q3?.includes('\ntitle: "Q3: plan/budget"\n'), `title: "Q3: plan/budget" (formatScalar quoting): ${q3}`)
  const long = 'Žluťoučký kůň úpěl ďábelské ódy '.repeat(8).trim()
  assert.ok(utf8(long) >= 250, 'setup: ≥ 250 bytes')
  const l = out(transform('Pages/Alfa.md', src, [{ op: 'set-title', title: long, now: NOW }])) ?? ''
  assert.ok(l.includes(`\ntitle: ${long}\n`) || l.includes(`\ntitle: "${long}"\n`), 'the whole 250-byte title is kept in title:')
  assert.ok(l.includes(`\nmodified: ${NOW}\n`), 'modified is touched (FR-FMT-11)')
})
