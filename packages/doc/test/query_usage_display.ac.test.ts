// Slice Q3, L1 / L3 at @tegg/doc: a reference fence's own `view`, `group_by`, `lanes`, `lane_order` and `widths`
// (docs/acceptance/views.md part five, R220, R221; docs/contracts/v1-views.md §37 `fenceUsage`, `withUsage`,
// `applyFenceUsage`; §38 the `retarget-links` op on fence lane orders; D-82 one text engine). FR-FMT-06 AC-8 (every case of
// tests/fixtures/queries-files/expected/views-display/fences/ byte for byte; the results parse with the `yaml` package and
// micromark reads one `query` code block; L3: `fenceUsage` gives expected-views-display.json's `fences`), the fence bytes
// of FR-QRY-05 AC-33, AC-36, AC-42, AC-43, FR-LNK-03 AC-26 and FR-FMT-12 AC-16. A note write is `applyFenceUsage`
// followed by `touchModified(before, after, now)`, as the editor's autosave sets `modified:` (D-55). Inputs: the fixtures
// tests/fixtures/vaults/views/ (base) and views-display/ (overlay). Written from the ACs and the contract only (D-61). The
// functions are read from the package's index at run time, so a missing export or key is an assertion failure (TS-I1).
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
const ZOB = read('tests/fixtures/vaults/views-display/Pages/Zobrazení knih.md')
const EXP = (rel: string) => read(`tests/fixtures/queries-files/expected/views-display/${rel}`)
const NOW = '2026-11-19T10:00:00+01:00'
const D = doc as unknown as Record<string, any>
const NFD = (s: string) => s.normalize('NFD')

type Group = { none: true } | { none: false; key: string; period: boolean }
type Widths = [string, number][]
type Change = { view?: string | null; group?: Group | null; lanes?: string | null; laneOrder?: string[] | null; widths?: Widths | null; sort?: unknown; columns?: string[] | null }
type Fence = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string }
type Usage = Record<string, unknown>
const CORPUS = JSON.parse(read('tests/fixtures/queries-files/expected-views-display.json')) as { fences: (Usage & { file: string; fence: number; saved: string })[] }
const KEY = (key: string, period = false): Group => ({ none: false, key, period })

function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-views §37)`)
  return D[name] as T
}
const fences = (t: string) => fn<(t: string) => Fence[]>('queryFences')(t)
const fenceUsage = (body: string) => fn<(b: string) => Usage>('fenceUsage')(body)
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
/** The 1-based line numbers whose text differs (same line count). */
function changedLines(a: string, b: string): number[] {
  const x = a.split('\n'), y = b.split('\n')
  const out: number[] = []
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i + 1)
  return out
}
const srcOf = (text: string, f: Fence) => Buffer.from(text).subarray(f.range[0], f.range[1]).toString('utf8')
/** The five Q3 keys of a usage read (`fenceUsage`), for comparisons. */
const q3 = (u: Usage) => ({ view: u.view, group: u.group, lanes: u.lanes, laneOrder: u.laneOrder, widths: u.widths })
const ABSENT = { view: null, group: null, lanes: null, laneOrder: null, widths: null }

// ------------------------------------------------------------------------------------------------ FR-FMT-06 AC-8

const CASES: { name: string; n: number; change: Change; want: Record<string, unknown> }[] = [
  { name: 'insert-view', n: 1, change: { view: 'wall' }, want: { saved: 'Přečtené 2026', view: 'wall' } },
  { name: 'insert-group', n: 1, change: { group: KEY('status') }, want: { saved: 'Výborné knihy', group_by: 'status', sort: { by: 'title', order: 'asc' } } },
  { name: 'insert-group-period', n: 1, change: { group: KEY('finished', true) }, want: { saved: 'Přečtené 2026', view: 'list', group_by: { finished: 'period' } } },
  { name: 'insert-group-none', n: 1, change: { group: { none: true } }, want: { saved: 'Rozečtené', group_by: 'none', columns: ['author'] } },
  { name: 'insert-lanes', n: 1, change: { lanes: 'rows' }, want: { saved: 'Rozečtené', view: 'wall', group_by: 'status', lanes: 'rows', sort: { by: 'title', order: 'asc' } } },
  { name: 'insert-lane-order', n: 1, change: { laneOrder: ['To read', 'Reading', 'Read'] }, want: { saved: 'Rozečtené', group_by: 'status', lane_order: ['To read', 'Reading', 'Read'], widths: { title: 240 } } },
  { name: 'insert-widths', n: 1, change: { widths: [['title', 240], ['author', 180]] }, want: { saved: 'Výborné knihy', view: 'table', columns: ['author', 'status'], widths: { title: 240, author: 180 } } },
  {
    name: 'insert-all', n: 1, change: { view: 'table', group: KEY('author'), lanes: 'rows', laneOrder: ['[[Lucie Horká]]'], widths: [['title', 260]] },
    want: { saved: 'Výborné knihy', view: 'table', group_by: 'author', lanes: 'rows', lane_order: ['[[Lucie Horká]]'], sort: { by: 'title', order: 'asc' }, columns: ['author'], widths: { title: 260 } },
  },
  { name: 'replace-view', n: 1, change: { view: 'wall' }, want: { saved: 'Přečtené 2026', view: 'wall', group_by: 'none' } },
  { name: 'remove-display', n: 1, change: { view: null }, want: { saved: 'Přečtené 2026', group_by: 'none' } },
  { name: 'remove-grouping', n: 1, change: { group: null, lanes: null, laneOrder: null }, want: { saved: 'Rozečtené', view: 'table', widths: { title: 240 } } },
  { name: 'tilde', n: 1, change: { view: 'list' }, want: { saved: 'Výborné knihy', view: 'list' } },
  { name: 'info-meta', n: 1, change: { group: KEY('status') }, want: { saved: 'Výborné knihy', group_by: 'status', columns: ['author'] } },
  { name: 'list-item', n: 1, change: { view: 'wall', widths: [['title', 300]] }, want: { saved: 'Přečtené 2026', view: 'wall', widths: { title: 300 } } },
  { name: 'callout', n: 6, change: { view: 'wall' }, want: { saved: 'Výborné knihy', view: 'wall' } },
  { name: 'comment-broken', n: 5, change: { group: KEY('author') }, want: { saved: 'Výborné knihy', view: 'kanban', group_by: 'author', lanes: 'diagonal', widths: 'široké' } },
  { name: 'crlf', n: 2, change: { view: 'list' }, want: { saved: 'Rozečtené', view: 'list', lane_order: ['To read'], widths: { title: 240 } } },
  { name: 'nfd-saved', n: 1, change: { view: 'wall' }, want: { saved: NFD('Přečtené 2026'), view: 'wall' } },
  { name: 'old-word-kept', n: 1, change: { group: KEY('author') }, want: { saved: 'Podle žánru', view: 'board', group_by: 'author', lanes: 'horizontal' } },
]

test('fr_fmt_06_ac8_fence_display_and_grouping_keys', () => {
  const bad: string[] = []
  for (const c of CASES) {
    const input = EXP(`fences/${c.name}-input.md`)
    const want = EXP(`fences/${c.name}.md`)
    const got = apply(input, c.n, c.change)
    if (got !== want) { bad.push(`${c.name}: applyFenceUsage byte for byte (expected/views-display/fences/${c.name}.md)`); continue }
    const fi = fences(input)[c.n - 1], fo = fences(want)[c.n - 1]
    if (withUsage(srcOf(input, fi), c.change) !== srcOf(want, fo)) bad.push(`${c.name}: withUsage on the fence source`)
    const y = parseYaml(fo.body) as Record<string, unknown>
    if (JSON.stringify(y) !== JSON.stringify(c.want)) bad.push(`${c.name}: YAML parse ${JSON.stringify(y)} ≠ ${JSON.stringify(c.want)}`)
    const nested = c.name === 'callout' || c.name === 'list-item'
    const html = micromark(nested ? '```query\n' + fo.body + '\n```' : srcOf(want, fo).replace(/\r\n/g, '\n'))
    if ((html.match(/<pre><code class="language-query">/g) ?? []).length !== 1) bad.push(`${c.name}: micromark reads one code block with info query`)
  }
  assert.deepEqual(bad, [], 'every fence case of expected/views-display/fences/')
  // No-ops (§37): a valid equal value (old words included), null on an absent key, widths compared as maps.
  const old = EXP('fences/old-word-kept-input.md')
  assert.equal(apply(old, 1, { lanes: 'rows' }), null, '`lanes: horizontal` with the change rows: no write')
  assert.equal(apply(old, 1, { view: 'wall' }), null, '`view: board` with the change wall: no write')
  assert.equal(apply(old, 1, { group: null, laneOrder: null, widths: null }), null, 'null on absent keys: no write')
  assert.equal(apply(EXP('fences/insert-widths.md'), 1, { widths: [['author', 180], ['title', 240]] }), null, 'the same widths in another order: no write')
  assert.equal(withUsage('```query\ntitle: Ruční dotaz\ntypes: [book]\n```', { view: 'wall' }), null, 'an inline fence: null (no usage, D-1810, D-2194 (e))')
  // A change of one key never rewrites an old word in another key.
  const zanr = apply(old, 1, { laneOrder: ['Poezie'] })
  assert.ok(zanr?.includes('view: board\n') && zanr.includes('lanes: horizontal            # vertical nebo horizontal\n'), 'old words in other keys keep their bytes')
  // L3: the reader gives expected-views-display.json's fences.
  const l3: string[] = []
  for (const e of CORPUS.fences) {
    const f = fences(read(e.file))[e.fence - 1]
    if (!f) { l3.push(`${e.file} #${e.fence}: no fence`); continue }
    const u = fenceUsage(f.body)
    const got = { saved: (f.saved ?? '').normalize('NFC'), ...q3(u), sort: u.sort, columns: u.columns }
    const want = { saved: e.saved.normalize('NFC'), view: e.view, group: e.group, lanes: e.lanes, laneOrder: e.laneOrder, widths: e.widths, sort: e.sort, columns: e.columns }
    if (JSON.stringify(got) !== JSON.stringify(want)) l3.push(`${e.file} #${e.fence}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`)
  }
  assert.deepEqual(l3, [], 'fenceUsage gives expected-views-display.json `fences`')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-33 (fence bytes)

test('fr_qry_05_ac33_display_and_grouping_in_a_block_and_on_the_query_page', () => {
  // (a) Čtení's `Přečtené 2026` block: `Wall` inserts `view: wall` after line 11 and sets modified:.
  const a = write(CTENI, 1, { view: 'wall' })
  assert.equal(a, EXP('notes/cteni-2026-prectene-view-wall.md'), '(a) view: wall after line 11, and modified:')
  // ⌘Z restores the fence's lines (the editor's undo step is the reverse change).
  assert.equal(apply(a, 1, { view: null })?.replace(/^modified: .*$/m, ''), CTENI.replace(/^modified: .*$/m, ''), '(a) the fence\'s lines restored')
  // (b) Zobrazení block 6 inside the callout: `> view: wall` after line 53.
  assert.equal(write(ZOB, 6, { view: 'wall' }), EXP('notes/zobrazeni-b6-view-wall.md'), '(b) `> view: wall` after line 53')
  // (d) Čtení's `Rozečtené` block: Group › Lanes › Rows, then `To read` dragged before `Reading` (D-2203).
  const d1 = write(CTENI, 2, { lanes: 'rows' })
  assert.equal(d1, EXP('notes/cteni-2026-rozectene-lanes-rows.md'), '(d) lanes: rows after line 15')
  assert.equal(write(d1, 2, { laneOrder: ['To read', 'Reading', 'Read'] }), EXP('notes/cteni-2026-rozectene-lane-order.md'), '(d) lane_order after the new lanes: line')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-36 (shapes, fence bytes)

test('fr_qry_05_ac36_broken_values', () => {
  // (a) Zobrazení block 5: three broken shapes; `group_by: finished` is a valid shape (its run-time check is the core's).
  const f5 = fences(ZOB)[4]
  assert.deepEqual(q3(fenceUsage(f5.body)), { view: 'broken', group: KEY('finished'), lanes: 'broken', laneOrder: null, widths: 'broken' }, '(a) block 5 as read')
  const t = write(ZOB, 5, { group: KEY('author') })
  assert.equal(t, EXP('notes/zobrazeni-b5-group-author.md'), '(a) Author replaces line 46')
  assert.deepEqual(changedLines(ZOB, t), [6, 46], '(a) lines 44, 45, 47 and 48 keep their bytes')
  // (b), (c) Runtime values.
  const shapes: [string, Record<string, unknown>][] = [
    ['saved: Výborné knihy\nview: Wall', { ...ABSENT, view: 'broken' }],
    ['saved: Výborné knihy\nview: kanban', { ...ABSENT, view: 'broken' }],
    ['saved: Výborné knihy\nview: board', { ...ABSENT, view: 'wall' }],
    ['saved: Výborné knihy\nlane_order: Reading', { ...ABSENT, laneOrder: 'broken' }],
    ['saved: Výborné knihy\nlane_order: []', { ...ABSENT, laneOrder: [] }],
    ['saved: Výborné knihy\ngroup_by: { due: month }', { ...ABSENT, group: 'broken' }],
    ['saved: Výborné knihy\ngroup_by: { finished: period, created: period }', { ...ABSENT, group: 'broken' }],
    ['saved: Výborné knihy\ngroup_by: ""', { ...ABSENT, group: 'broken' }],
    ['saved: Výborné knihy\ngroup_by: none', { ...ABSENT, group: { none: true } }],
    ['saved: Výborné knihy\nlanes: vertical', { ...ABSENT, lanes: 'columns' }],
    ['saved: Výborné knihy\nlanes: horizontal', { ...ABSENT, lanes: 'rows' }],
    ['saved: Výborné knihy\nlanes: diagonal', { ...ABSENT, lanes: 'broken' }],
    ['saved: Výborné knihy\nwidths: { title: 90 }', { ...ABSENT, widths: [['title', 90]] }],
    ['saved: Výborné knihy\nwidths: { neznámý: 200 }', { ...ABSENT, widths: [['neznámý', 200]] }],
    ['saved: Výborné knihy\nwidths: { title: 12.5 }', { ...ABSENT, widths: 'broken' }],
    ['saved: Výborné knihy\nwidths: { title: -3 }', { ...ABSENT, widths: 'broken' }],
    ['saved: Výborné knihy\nwidths: široké', { ...ABSENT, widths: 'broken' }],
    ['title: Ruční dotaz\nview: wall\ngroup_by: status', ABSENT],
  ]
  const bad = shapes.map(([body, want]) => [body, JSON.stringify(q3(fenceUsage(body))), JSON.stringify(want)]).filter(([, g, w]) => g !== w)
  assert.deepEqual(bad, [], '(b), (c) §35 shapes (Absent / Set / Broken), never a rewrite')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42 (fence bytes)

test('fr_qry_05_ac42_group_order_and_folds', () => {
  const t = write(ZOB, 2, { laneOrder: ['Reading', 'To read', 'Read'] })
  assert.equal(t, EXP('notes/zobrazeni-b2-lane-order-reading.md'), 'block 2: line 21 → lane_order: [Reading, To read, Read]')
  assert.deepEqual(changedLines(ZOB, t), [6, 21], 'only modified: and line 21')
  // The same order again (a drop at its own place) is no write.
  assert.equal(apply(ZOB, 2, { laneOrder: ['To read'] }), null, 'the order the fence has: no write')
})

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-43 (fence bytes)

test('fr_qry_05_ac43_widths_are_stored_with_the_usage', () => {
  assert.equal(write(CTENI, 1, { widths: [['title', 200]] }), EXP('notes/cteni-2026-prectene-widths-title-200.md'), '(b) widths: { title: 200 } after line 11')
  // Zobrazení block 2: a replace in place, keys in the order given (Title first, then the column order).
  const t = apply(ZOB, 2, { widths: [['title', 240], ['author', 200]] })
  assert.ok(t?.includes('lane_order: [To read]\nwidths: { title: 240, author: 200 }\n```'), 'block 2: line 22 replaced in place')
  assert.equal(apply(ZOB, 2, { widths: [['title', 240]] }), null, 'a resize that ends at its starting width: no write')
  assert.ok(apply(ZOB, 2, { widths: null })?.includes('lane_order: [To read]\n```'), '`Reset column widths`: the widths line removed')
})

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-26 (fence patch)

const PATHS = ['Autoři/Eva Lindová.md', 'Autoři/Tomáš Rybář.md', 'Autoři/Marek Sova.md', 'Autoři/Lucie Horká.md', 'Autoři/Jana Brázdová.md', 'Pages/Autorky.md', 'Pages/Zobrazení knih.md']
const LUCIE = {
  op: 'retarget-links', fromPath: 'Autoři/Lucie Horká.md', fromStem: 'Lucie Horká', fromTitle: 'Lucie Horká',
  toPath: 'Autoři/Lucie Horká-Nová.md', toStem: 'Lucie Horká-Nová', toTitle: 'Lucie Horká-Nová', paths: PATHS,
}

test('fr_lnk_03_ac26_renames_reach_usage_lane_order', () => {
  const transform = fn<(source: string, text: string, ops: unknown[]) => { kind: string; text?: string }>('transform')
  const input = EXP('notes/lane-order-fence-input.md')
  const r = transform('Pages/Autorky.md', input, [LUCIE])
  assert.equal(r.kind, 'bytes', 'the fence\'s lane_order names the renamed note: a change')
  assert.equal(r.text, EXP('notes/lane-order-fence-renamed.md'), 'only the value token of line 12; no modified: change (D-1467)')
  // An alias and a heading part are kept; a lane_order of another note and a comment line are untouched.
  const alias = input.replace('lane_order: ["[[Lucie Horká]]"]', 'lane_order: ["[[Lucie Horká|Lucie]]", "[[Eva Lindová]]"]\n# "[[Lucie Horká]]" v komentáři')
  const ra = transform('Pages/Autorky.md', alias, [LUCIE])
  assert.equal(ra.kind === 'bytes' ? ra.text : null, alias.replace('"[[Lucie Horká|Lucie]]"', '"[[Lucie Horká-Nová|Lucie]]"'), 'the alias kept; Eva and the comment untouched')
  assert.equal(transform('Pages/Zobrazení knih.md', ZOB, [LUCIE]).kind, 'unchanged', 'Zobrazení names no Lucie: unchanged')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-16 (fence part)

test('fr_fmt_12_ac16_display_keys_are_nfc', () => {
  const body = `saved: Výborné knihy\ngroup_by: ${NFD('žánry')}\nlane_order: ["${NFD('[[Lucie Horká]]')}", ${NFD('Román')}]\nwidths: { ${NFD('poznámka')}: 200 }`
  assert.deepEqual(q3(fenceUsage(body)), { view: null, group: KEY('žánry'), lanes: null, laneOrder: ['[[Lucie Horká]]', 'Román'], widths: [['poznámka', 200]] }, 'NFD values and keys read as NFC')
  // Every write is NFC; the NFD saved: line keeps its bytes.
  const out = apply(EXP('fences/nfd-saved-input.md'), 1, { laneOrder: [NFD('Román')], widths: [[NFD('poznámka'), 180]] })
  assert.ok(out !== null && out.includes(`saved: ${NFD('Přečtené 2026')}\n`), 'the NFD saved: line kept')
  assert.ok(out!.includes('lane_order: [Román]\n') && out!.includes('widths: { poznámka: 180 }\n'), 'the new lines in NFC')
  assert.ok(!out!.includes(NFD('Román')) && !out!.includes(NFD('poznámka')), 'nothing new written in NFD')
  // An NFD value equal to the change (as NFC) is no write.
  const nfdFence = `---\ntitle: N\n---\n\`\`\`query\nsaved: Rozečtené\nlane_order: [${NFD('Román')}]\n\`\`\`\n`
  assert.equal(apply(nfdFence, 1, { laneOrder: ['Román'] }), null, 'an NFD value the user didn\'t change: no write')
})
