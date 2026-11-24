// Slice Q2.1, L1 / L3 at @tegg/doc: a reference fence's own `sort:` and `columns:` (docs/acceptance/views.md R195; docs/
// contracts/v1-views.md §13.1 `fenceUsage`, `withUsage`, `applyFenceUsage`; D-82 one text engine, D-1838 the fence's
// shape). FR-FMT-06 AC-7 (every case of tests/fixtures/queries-files/expected/views-usage/fences/ byte for byte; the
// results parse with the `yaml` package and micromark reads one `query` code block; L3: `fenceUsage` gives
// expected-views-usage.json's `fences`), the fence bytes of FR-QRY-01 AC-14 and AC-16, FR-QRY-05 AC-24 and AC-26, the
// fence part of FR-FMT-12 AC-13 and the note part of FR-FMT-07 AC-34. A note write is `applyFenceUsage` followed by
// `touchModified(before, after, now)`, as the editor's autosave sets `modified:` (D-55). Inputs: the fixtures
// tests/fixtures/vaults/views/ (base) and views-usage/ (overlay). Written from the ACs and the contract only (D-61).
// The functions are read from the package's index at run time, so a missing export is an assertion failure (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { micromark } from 'micromark'
import * as doc from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8')
const CTENI = read('tests/fixtures/vaults/views/Pages/Čtení 2026.md')
const CESTY = read('tests/fixtures/vaults/views-usage/Pages/Knihy na cesty.md')
const EXP = (rel: string) => read(`tests/fixtures/queries-files/expected/views-usage/${rel}`)
const CORPUS = JSON.parse(read('tests/fixtures/queries-files/expected-views-usage.json')) as {
  fences: { file: string; fence: number; saved: string; sort: Sort[] | 'broken' | null; columns: string[] | 'broken' | null }[]
}
const NOW = '2026-11-19T10:00:00+01:00'
const D = doc as unknown as Record<string, any>

type Sort = { by: string; order: 'asc' | 'desc' }
type Change = { sort?: Sort[] | null; columns?: string[] | null }
type Fence = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string }
const S = (...xs: [string, 'asc' | 'desc'][]): Sort[] => xs.map(([by, order]) => ({ by, order }))

/** D-2211: the Q2.1 fields only (Q3 adds view, group, lanes, laneOrder, widths to `fenceUsage`). */
const sc = (u: { sort: unknown; columns: unknown }) => ({ sort: u.sort, columns: u.columns })
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-views §13.1)`)
  return D[name] as T
}
const fences = (t: string) => fn<(t: string) => Fence[]>('queryFences')(t)
const fenceUsage = (body: string) => fn<(b: string) => { sort: Sort[] | 'broken' | null; columns: string[] | 'broken' | null }>('fenceUsage')(body)
const withUsage = (src: string, c: Change) => fn<(s: string, c: Change) => string | null>('withUsage')(src, c)
/** `applyFenceUsage` on the n-th (1-based) fence of `text`. */
function apply(text: string, n: number, c: Change): string | null {
  const f = fences(text)[n - 1]
  assert.ok(f, `setup: fence ${n} exists`)
  return fn<(t: string, r: [number, number], c: Change) => string | null>('applyFenceUsage')(text, f.range, c)
}
/** A block write through the editor: `applyFenceUsage`, then the autosave's `modified:` (D-55). */
function write(text: string, n: number, c: Change): string {
  const after = apply(text, n, c)
  assert.ok(typeof after === 'string', `fence ${n}: ${JSON.stringify(c)} answers a change`)
  return fn<(b: string, a: string, now: string) => string>('touchModified')(text, after!, NOW)
}
/** The 1-based line numbers whose text differs (same line count) or `null` when the counts differ. */
function changedLines(a: string, b: string): number[] {
  const x = a.split('\n'), y = b.split('\n')
  const out: number[] = []
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i + 1)
  return out
}
const srcOf = (text: string, f: Fence) => Buffer.from(text).subarray(f.range[0], f.range[1]).toString('utf8')
/** The fence's body as YAML: container prefixes and the markers removed. */
const bodyYaml = (text: string, n: number) => parseYaml(fences(text)[n - 1].body) as Record<string, unknown>

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-7

const CASES: { name: string; n: number; change: Change; want: { saved: string; sort?: Sort[]; columns?: string[] } }[] = [
  { name: 'insert-plain', n: 1, change: { sort: S(['rating', 'asc']), columns: ['author', 'rating'] }, want: { saved: 'Přečtené 2026', sort: S(['rating', 'asc']), columns: ['author', 'rating'] } },
  { name: 'one-to-list', n: 1, change: { sort: S(['title', 'asc'], ['finished', 'desc']) }, want: { saved: 'Přečtené 2026', sort: S(['title', 'asc'], ['finished', 'desc']), columns: ['author'] } },
  { name: 'list-to-one', n: 1, change: { sort: S(['rating', 'desc']) }, want: { saved: 'Přečtené 2026', sort: S(['rating', 'desc']), columns: ['author'] } },
  { name: 'remove', n: 1, change: { sort: null }, want: { saved: 'Přečtené 2026', columns: ['author'] } },
  { name: 'tilde', n: 1, change: { columns: ['author', 'genres'] }, want: { saved: 'Výborné knihy', columns: ['author', 'genres'] } },
  { name: 'info-meta', n: 1, change: { sort: S(['title', 'desc']) }, want: { saved: 'Výborné knihy', sort: S(['title', 'desc']), columns: ['author'] } },
  { name: 'list-item', n: 1, change: { sort: S(['author', 'asc']), columns: ['author'] }, want: { saved: 'Přečtené 2026', sort: S(['author', 'asc']), columns: ['author'] } },
  { name: 'callout', n: 5, change: { sort: S(['finished', 'asc']) }, want: { saved: 'Výborné knihy', sort: S(['finished', 'asc']) } },
  { name: 'comment-kept', n: 3, change: { sort: S(['title', 'asc']), columns: ['rating', 'author'] }, want: { saved: 'Rozečtené', sort: S(['title', 'asc']), columns: ['rating', 'author'] } },
  { name: 'crlf', n: 2, change: { sort: S(['title', 'asc']) }, want: { saved: 'Přečtené 2026', sort: S(['title', 'asc']) } },
  { name: 'nfd-saved', n: 1, change: { columns: ['author'] }, want: { saved: 'Přečtené 2026'.normalize('NFD'), columns: ['author'] } },
]
/** The YAML value of a usage `sort` (one mapping or a list) as a list of levels. */
const levelsOf = (v: unknown): Sort[] | undefined => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]) as Sort[])

test('fr_fmt_06_ac7_fence_usage_keys', () => {
  for (const c of CASES) {
    const input = EXP(`fences/${c.name}-input.md`)
    const want = EXP(`fences/${c.name}.md`)
    const got = apply(input, c.n, c.change)
    assert.equal(got, want, `${c.name}: applyFenceUsage byte for byte (expected/views-usage/fences/${c.name}.md)`)
    // The same change through withUsage on the fence's source gives the same fence.
    const fi = fences(input)[c.n - 1], fo = fences(want)[c.n - 1]
    assert.equal(withUsage(srcOf(input, fi), c.change), srcOf(want, fo), `${c.name}: withUsage on the fence source`)
    // The saved line and the markers stay; the result is one `query` code block that parses to the intended values.
    const saved = srcOf(input, fi).split(/\r?\n/).find((l) => /^[> ]*saved:/.test(l))
    assert.ok(saved && srcOf(want, fo).split(/\r?\n/).includes(saved), `${c.name}: the saved: line keeps its bytes`)
    assert.equal(srcOf(want, fo).split(/\r?\n/)[0], srcOf(input, fi).split(/\r?\n/)[0], `${c.name}: the opening marker and info string`)
    const y = bodyYaml(want, c.n)
    assert.deepEqual({ saved: y.saved, sort: levelsOf(y.sort), columns: y.columns }, { saved: c.want.saved, sort: c.want.sort, columns: c.want.columns }, `${c.name}: YAML 1.2 parse`)
    const html = micromark(c.name === 'callout' || c.name === 'list-item' ? fo.body : srcOf(want, fo).replace(/\r\n/g, '\n'))
    if (c.name !== 'callout' && c.name !== 'list-item') assert.equal((html.match(/<pre><code class="language-query">/g) ?? []).length, 1, `${c.name}: micromark reads one code block with info query`)
  }
  // A change equal to what the fence has writes nothing; a body without `saved:` is no reference.
  assert.equal(apply(CESTY, 1, { sort: S(['title', 'asc']), columns: ['author'] }), null, 'the same values: null (no write)')
  assert.equal(apply(CESTY, 2, { sort: null, columns: null }), null, 'removing absent keys: null')
  assert.equal(withUsage('```query\ntitle: Ruční dotaz\ntypes: [book]\n```', { sort: S(['title', 'asc']) }), null, 'an inline fence: null (no usage, D-1810)')
  // L3: the reader gives expected-views-usage.json's fences.
  const bad: string[] = []
  for (const e of CORPUS.fences) {
    const f = fences(read(e.file))[e.fence - 1]
    if (!f) { bad.push(`${e.file} #${e.fence}: no fence`); continue }
    const u = fenceUsage(f.body)
    const got = { saved: (f.saved ?? '').normalize('NFC'), sort: u.sort, columns: u.columns }
    const want = { saved: e.saved.normalize('NFC'), sort: e.sort, columns: e.columns }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${e.file} #${e.fence}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'fenceUsage gives expected-views-usage.json `fences`')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-14 (fence bytes)

test('fr_qry_01_ac14_block_sort_is_its_own', () => {
  // (a) Čtení's block: a click on Rating (the effective sort is the query's three levels) → its own `rating ↑`.
  const a = write(CTENI, 1, { sort: S(['rating', 'asc']) })
  assert.equal(a, EXP('notes/cteni-2026-click-rating.md'), '(a) one line after line 11, and modified:')
  assert.deepEqual(changedLines(CTENI, a).slice(0, 1), [6], '(a) line 6 is modified:')
  // (c) ⇧-click on Finished: the inserted line becomes a two-level list.
  const c = write(a, 1, { sort: S(['rating', 'asc'], ['finished', 'asc']) })
  assert.equal(c, EXP('notes/cteni-2026-shift-finished.md'), '(c) sort: + two levels in place of the line')
  // (d) Use the query's sort: the body equals the fixture's again.
  const d = apply(c, 1, { sort: null })
  assert.equal(d?.replace(/^modified: .*$/m, ''), CTENI.replace(/^modified: .*$/m, ''), '(d) the sort lines removed: Čtení\'s body equals the fixture\'s')
  // The overlay: block 1 replaces line 12 and keeps 13; block 5 (in the callout) gets the `> ` prefix.
  assert.equal(write(CESTY, 1, { sort: S(['author', 'asc']) }), EXP('notes/knihy-na-cesty-b1-click-author.md'), 'Cesty block 1: line 12 only')
  assert.equal(write(CESTY, 5, { sort: S(['finished', 'asc']) }), EXP('notes/knihy-na-cesty-b5-click-finished.md'), 'Cesty block 5: `> sort: …` after line 42')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-16 (fence part)

test('fr_qry_01_ac16_effective_and_broken_usage_values', () => {
  // Block 4's sort has a valid shape; `neznámý` is a run-time check of the core (§13.1), so the reader returns it.
  const f4 = fences(CESTY)[3]
  assert.deepEqual(sc(fenceUsage(f4.body)), { sort: S(['finished', 'desc'], ['neznámý', 'asc']), columns: null }, 'block 4: the two levels as written, no columns')
  // A click on Title (the only level of the effective sort) flips it: lines 35…37 → one line.
  assert.equal(write(CESTY, 4, { sort: S(['title', 'desc']) }), EXP('notes/knihy-na-cesty-b4-click-title.md'), 'block 4: lines 35…37 replaced by `sort: { by: title, order: desc }`')
  // Runtime shapes (R185 read rules).
  const shapes: [string, unknown][] = [
    ['saved: Přečtené 2026\ncolumns: [neznámý, author]', { sort: null, columns: ['neznámý', 'author'] }],
    ['saved: Přečtené 2026\nsort: []', { sort: [], columns: null }],
    ['saved: Přečtené 2026\nsort: { by: title, order: desc }', { sort: S(['title', 'desc']), columns: null }],
    ['saved: Přečtené 2026\nsort: sideways', { sort: 'broken', columns: null }],
    ['saved: Přečtené 2026\nsort: { by: title, order: sideways }', { sort: 'broken', columns: null }],
    ['saved: Přečtené 2026\nsort:\n  - title\ncolumns: author', { sort: 'broken', columns: 'broken' }],
    ['title: Ruční dotaz\nsort: { by: title, order: asc }', { sort: null, columns: null }],
    ['', { sort: null, columns: null }],
  ]
  for (const [body, want] of shapes) assert.deepEqual(sc(fenceUsage(body)), want, `fenceUsage(${JSON.stringify(body)})`)
})

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-24, AC-26 (fence bytes)

test('fr_qry_05_ac24_block_columns_are_its_own', () => {
  assert.equal(write(CTENI, 1, { columns: ['author', 'rating', 'finished', 'genres'] }), EXP('notes/cteni-2026-columns-genres.md'), 'Columns › Genres: a line after line 11')
  assert.equal(write(CTENI, 1, { columns: ['finished', 'author', 'rating'] }), EXP('notes/cteni-2026-columns-reordered.md'), 'Finished dragged before Author')
  // With an own sort present, `columns:` goes after it.
  const withSort = EXP('notes/cteni-2026-click-rating.md')
  const both = apply(withSort, 1, { columns: ['author'] })
  assert.ok(both?.includes('```query\nsaved: Přečtené 2026\nsort: { by: rating, order: asc }\ncolumns: [author]\n```'), 'columns: after sort:')
  const r = write(CESTY, 1, { columns: ['author', 'rating'] })
  assert.equal(r, EXP('notes/knihy-na-cesty-b1-columns-rating.md'), 'Cesty block 1: line 13 → columns: [author, rating]')
  assert.equal(write(r, 1, { columns: null }), EXP('notes/knihy-na-cesty-b1-columns-reset.md'), 'Use the query\'s columns: line 13 removed')
})

test('fr_qry_05_ac26_on_cards_per_usage', () => {
  const t = write(CESTY, 3, { columns: ['rating', 'author'] })
  assert.equal(t, EXP('notes/knihy-na-cesty-b3-on-cards-author.md'), 'block 3: line 27 → columns: [rating, author]; lines 26 and 28 kept')
  assert.deepEqual(changedLines(CESTY, t), [6, 27], 'only modified: and line 27')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-13 (fence part)

test('fr_fmt_12_ac13_usage_settings_are_nfc', () => {
  const nfd = (s: string) => s.normalize('NFD')
  // An NFD `by` and an NFD column key read as NFC.
  assert.deepEqual(sc(fenceUsage(`saved: ${nfd('Přečtené 2026')}\nsort: { by: ${nfd('hodnocení')}, order: asc }\ncolumns: [${nfd('poznámka')}, author]`)),
    { sort: S(['hodnocení', 'asc']), columns: ['poznámka', 'author'] }, 'by and columns keys NFC')
  // A write is NFC; the NFD saved: line the user didn't change keeps its bytes.
  const input = EXP('fences/nfd-saved-input.md')
  const out = apply(input, 1, { columns: [nfd('poznámka')] })
  assert.ok(out?.includes(`saved: ${nfd('Přečtené 2026')}\ncolumns: [poznámka]\n`), 'the new line is NFC; the saved: line stays NFD')
  assert.ok(out !== null && !out.includes(nfd('poznámka')), 'nothing written in NFD')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-34 (notes, L1)

test('fr_fmt_07_ac34_usage_settings_round_trip', () => {
  // Every reference fence of Cesty: setting its current own values back is no write; a change touches only that fence.
  const fs = fences(CESTY)
  assert.equal(fs.length, 5, 'setup: Cesty has five fences')
  for (let n = 1; n <= 5; n++) {
    const u = fenceUsage(fs[n - 1].body)
    assert.notEqual(u.sort, 'broken', `block ${n}: a readable sort shape`)
    const same: Change = { sort: (u.sort === null ? null : u.sort) as Sort[] | null, columns: (u.columns === null ? null : u.columns) as string[] | null }
    assert.equal(apply(CESTY, n, same), null, `block ${n}: its own values again: no write`)
    const out = apply(CESTY, n, { columns: ['title'] })
    assert.ok(out !== null, `block ${n}: a change writes`)
    const before = Buffer.from(CESTY), after = Buffer.from(out!)
    const [s, e] = fs[n - 1].range
    assert.ok(after.subarray(0, s).equals(before.subarray(0, s)), `block ${n}: every byte before the fence kept`)
    assert.ok(after.subarray(after.length - (before.length - e)).equals(before.subarray(e)), `block ${n}: every byte after the fence kept`)
  }
})
