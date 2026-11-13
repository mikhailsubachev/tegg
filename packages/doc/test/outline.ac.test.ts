// Slice OL, L1 at @tegg/doc: the heading list, the tree, the fold key and the rail rows (docs/acceptance/outline.md R171,
// R173; docs/contracts/v1-outline.md §1). FR-EDT-11 AC-2 (what counts as a heading, on Okraje and on each case alone),
// AC-3 (the heading text), AC-4 (the tree by depth), FR-EDT-16 AC-5 (`railDepth`, `railRows` on Čtenářské, Architektura
// and Plán), FR-FMT-12 AC-10 (`outlineHeadings` keeps NFD text, `foldKey` is NFC), FR-EDT-11 AC-19 (`headingForFragment`,
// D-1625) and the report-only L1 benchmark of §1.4 / §8 (FR-EDT-11 AC-20). Fixture: tests/fixtures/vaults/outline (read
// only; the expected rows are its README's). Written from the ACs, the contract and the fixture only (D-61). The functions
// are read from the package's index at run time, so a missing export is an assertion failure (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as doc from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/outline', rel), 'utf8')
const D = doc as unknown as Record<string, any>

type Level = 1 | 2 | 3 | 4 | 5 | 6
type Heading = { level: Level; text: string; from: number; to: number }
type Node = Heading & { index: number; depth: number; parent: number | null; children: number[]; descendants: number; key: string }
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-outline §1.2)`)
  return D[name] as T
}
function run<T>(what: string, f: () => T): T {
  try { return f() } catch (e) { assert.fail(`${what} threw: ${(e as Error)?.message ?? e}`) }
}
/** Calls export `name` (asserting it exists first), turning a throw into an assertion failure. */
function call<T>(name: string, ...args: unknown[]): T {
  const f = fn<(...a: unknown[]) => T>(name)
  return run(name, () => f(...args))
}
const outlineHeadings = (t: string) => call<Heading[]>('outlineHeadings', t)
const outlineTree = (h: readonly Heading[]) => call<Node[]>('outlineTree', h)
const foldKey = (l: Level, t: string, n: number) => call<string>('foldKey', l, t, n)
const railDepth = (tree: readonly Node[], max?: number) => call<number>('railDepth', tree, ...(max === undefined ? [] : [max]))
const railRows = (tree: readonly Node[], current: number | null, tempOpen?: ReadonlySet<number>) =>
  call<number[]>('railRows', tree, current, ...(tempOpen === undefined ? [] : [tempOpen]))
const headingForFragment = (h: readonly Heading[], f: string) => call<number | null>('headingForFragment', h, f)

const PLAN = 'Pages/Plán offsitu 2026.md'
const ARCH = 'Pages/Architektura.md'
const CTEN = 'Pages/Čtenářské poznámky.md'
const OKRAJE = 'Pages/Okraje.md'
const PRESK = 'Pages/Přeskočené úrovně.md'

/** README "Expected outlines": text · level · depth. */
const PLAN_ROWS: [string, number, number][] = [
  ['Cíle', 1, 1], ['Co od toho chceme', 2, 2], ['Kdo jede', 2, 2], ['Program', 1, 1], ['Den 1', 2, 2], ['Ráno: strategie', 3, 3],
  ['Odpoledne: plán', 3, 3], ['Den 2', 2, 2], ['Logistika', 1, 1], ['Cesta', 2, 2], ['Rozpočet', 2, 2],
]
const ARCH_ROWS: [string, number][] = [
  ['Úložiště', 1], ['Rozvržení trezoru', 2], ['Složky podle typu', 3], ['Denní poznámky', 4], ['Názvy souborů', 5], ['Časová pásma', 6], ['Přejmenování', 6],
  ['Přílohy', 4], ['Hlavička', 3], ['Povinné klíče', 4], ['Neznámé klíče', 4], ['Indexování', 2], ['Fulltextový index', 3], ['Index odkazů', 3],
  ['Synchronizace', 1], ['Konflikty', 2], ['Stejný řádek upraven', 3], ['Složky iCloudu', 2],
]
const ARCH_DESC: Record<string, number> = {
  'Úložiště': 13, 'Rozvržení trezoru': 9, 'Složky podle typu': 5, 'Denní poznámky': 3, 'Názvy souborů': 2, 'Hlavička': 2, 'Indexování': 2, 'Synchronizace': 3, 'Konflikty': 1,
}
const OKRAJE_ROWS: [string, number, number][] = [
  ['Nadpis podtržený', 1, 1], ['Podnadpis podtržený', 2, 2], ['Tučný začátek, odkaz a kód', 2, 2], ['Oddíl s blokem', 2, 2], ['Nadpis v calloutu', 2, 2],
  ['Skrytý nadpis', 3, 3], ['Nadpis v citaci', 2, 2], ['Nadpis v seznamu', 2, 2], ['Poznámky', 2, 2], ['Poznámky', 3, 3], ['Poznámky', 2, 2],
]
const CTEN_H1 = ['Úvod', 'Spolehlivé systémy', 'Datové modely', 'Ukládání a vyhledávání', 'Kódování', 'Replikace', 'Dělení dat', 'Transakce', 'Konzistence', 'Dávkové zpracování', 'Proudy', 'Závěr']
const H2_OF: Record<string, string[]> = {
  'Replikace': ['Vedoucí a následovníci', 'Zpoždění replikace', 'Bez vedoucího'],
  'Transakce': ['ACID', 'Slabá izolace', 'Serializovatelnost'],
  'Závěr': ['Shrnutí', 'Otevřené otázky', 'Další čtení'],
}
const texts = (h: readonly Heading[]) => h.map((x) => x.text)

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-2

test('fr_edt_11_ac2_what_counts_as_a_heading', () => {
  const text = fx(OKRAJE)
  const h = outlineHeadings(text)
  assert.deepEqual(h.map((x) => [x.text, x.level]), OKRAJE_ROWS.map(([t, l]) => [t, l]), 'Okraje: the README\'s 11 headings, in order, with their levels')
  assert.deepEqual(h[0], { level: 1, text: 'Nadpis podtržený', from: 187, to: 220 }, 'the setext H1: the text line through the end of the underline (§1.1)')
  assert.deepEqual(h[2], { level: 2, text: 'Tučný začátek, odkaz a kód', from: 306, to: 366 }, 'the ATX line without its EOL, closing `##` included')
  assert.deepEqual(h[5], { level: 3, text: 'Skrytý nadpis', from: 560, to: 577 }, 'inside the folded callout: after `> `')
  assert.deepEqual(h[10], { level: 2, text: 'Poznámky', from: 902, to: 913 }, 'the last `## Poznámky`')
  for (const off of [416, 419, 671, 757]) assert.ok(!h.some((x) => x.from === off), `nothing listed at ${off} (\`#\`, \`##\`, \`## Kořen mapy\`, \`# Nadpis v komentáři\`)`)
  const forbidden = ['Komentář v hlavičce není nadpis', '#štítek není nadpis', 'štítek není nadpis', 'Komentář v kódu', 'odsazený kód', 'Kořen mapy', 'komentář v dotazu', 'Nadpis v komentáři', 'HTML nadpis', '<h2>HTML nadpis</h2>', 'x', '']
  for (const f of forbidden) assert.ok(!texts(h).includes(f), `"${f}" is not listed (R171 rule 3)`)
  for (const [t] of PLAN_ROWS) assert.ok(!texts(h).includes(t), `the embedded Plán's heading "${t}" is not listed (its target is never read)`)
  const ofDoc = call<Heading[]>('outlineHeadingsOf', D.parse(text))
  assert.deepEqual(ofDoc, h, 'outlineHeadingsOf(parse(text)) gives the same list')
  const plan = outlineHeadings(fx(PLAN))
  assert.deepEqual(plan.map((x) => [x.text, x.level]), PLAN_ROWS.map(([t, l]) => [t, l]), 'Plán: 11 headings; the title and the intro are not rows')
  assert.deepEqual([plan[0], plan[4], plan[10]], [{ level: 1, text: 'Cíle', from: 216, to: 222 }, { level: 2, text: 'Den 1', from: 1766, to: 1774 }, { level: 2, text: 'Rozpočet', from: 4095, to: 4106 }], 'Plán\'s offsets (§1.2)')
  assert.deepEqual(outlineHeadings(fx('Pages/Bez nadpisů.md')), [], 'Bez nadpisů: none (`#štítek` is a tag line)')
  assert.deepEqual(texts(outlineHeadings(fx('Pages/Rozbitá hlavička.md'))), ['První v rozbité', 'Druhý v rozbité'], 'Rozbitá: nothing from its broken frontmatter')
  assert.deepEqual(texts(outlineHeadings(fx('Pages/Bez hlavičky.md'))), ['Jedna', 'Dvě', 'Tři'], 'Bez hlavičky: no frontmatter')
})

test('fr_edt_11_ac2_what_counts_as_a_heading_each_case_alone', () => {
  const FM = '---\nid: 01JC5N0000000000000000L001\ntype: page\ntitle: Cíle\n---\n'
  const cases: [string, string, [string, number][]][] = [
    ['setext H1', 'Nadpis podtržený\n================\n', [['Nadpis podtržený', 1]]],
    ['setext H2', 'Podnadpis\n---------\n', [['Podnadpis', 2]]],
    ['ATX in a callout', '> [!note] Poznámka\n> ## Nadpis v calloutu\n> Text.\n', [['Nadpis v calloutu', 2]]],
    ['ATX in a folded callout', '> [!tip]- Sbalený callout\n> ### Skrytý nadpis\n> Text.\n', [['Skrytý nadpis', 3]]],
    ['ATX in a plain quote', '> ## Nadpis v citaci\n', [['Nadpis v citaci', 2]]],
    ['ATX in a list item', '- položka\n- ## Nadpis v seznamu\n', [['Nadpis v seznamu', 2]]],
    ['ATX in a nested quote', '> > #### Hluboko v citaci\n', [['Hluboko v citaci', 4]]],
    ['a body heading equal to the title', `${FM}# Cíle\n`, [['Cíle', 1]]],
    ['frontmatter comment', `---\nid: 01JC5N0000000000000000L002\n# Komentář v hlavičce\ntitle: Okraje\n---\nText.\n`, []],
    ['a #tag line', '#štítek není nadpis\n', []],
    ['an empty `#`', '#\n', []],
    ['an empty `##`', '##\n', []],
    ['a heading of only a comment', '## %%skryté%%\n', []],
    ['fenced code', '```\n# Komentář v kódu\n```\n', []],
    ['tilde fenced code', '~~~\n## Kód\n~~~\n', []],
    ['indented code', 'Odstavec.\n\n    # odsazený kód\n', []],
    ['a mindmap callout', '> [!mindmap] Mapa\n> - ## Kořen mapy\n>   - Větev\n', []],
    ['a mindmap callout in another case', '> [!Mindmap]+ Mapa\n> - ## Kořen mapy\n', []],
    ['a query block', '```query\nsaved: Otevřené úkoly\n# komentář v dotazu\n```\n', []],
    ['a %% comment block', '%%\n# Nadpis v komentáři\n%%\n', []],
    ['an HTML block', '<h2>HTML nadpis</h2>\n', []],
    ['a math block', '$$\n# x\n$$\n', []],
    ['a note embed', '![[Plán offsitu 2026]]\n', []],
    ['a heading embed', '![[Plán offsitu 2026#Cíle]]\n', []],
    ['a table', '| # Sloupec |\n| --- |\n| ## buňka |\n', []],
    // CP-1: an unclosed `%%` hides nothing.
    ['an unclosed %%', '%%\n\n# Po nezavřeném komentáři\n', [['Po nezavřeném komentáři', 1]]],
  ]
  const bad: string[] = []
  for (const [what, text, want] of cases) {
    const got = outlineHeadings(text).map((x) => [x.text, x.level] as [string, number])
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'R171 rules 2–3, each case alone')
  // Offsets are UTF-16 positions into the whole text, the node's own position (after container markers).
  const q = '> [!note] Poznámka\n> ## Nadpis v calloutu\n'
  const [hq] = outlineHeadings(q)
  assert.equal(q.slice(hq?.from, hq?.to), '## Nadpis v calloutu', 'a callout heading\'s from/to: after `> `, without the EOL')
  const li = '- ## Nadpis v seznamu\n'
  const [hl] = outlineHeadings(li)
  assert.equal(li.slice(hl?.from, hl?.to), '## Nadpis v seznamu', 'a list heading\'s from/to: after `- `')
  const bom = '﻿# Začátek\n'
  const [hb] = outlineHeadings(bom)
  assert.deepEqual([hb?.from, hb?.to], [1, 10], 'offsets count the BOM (UTF-16 positions into the given text)')
})

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-3

test('fr_edt_11_ac3_heading_text_is_plain', () => {
  const h = outlineHeadings(fx(OKRAJE))
  assert.equal(h[2]?.text, 'Tučný začátek, odkaz a kód', 'no `**`, `[[`, `|`, backticks or closing `##`')
  assert.equal(h[3]?.text, 'Oddíl s blokem', 'no `^oddil1`')
  const cases: [string, string][] = [
    ['## a  **b**   c ', 'a b c'], ['## [text](https://example.com)', 'text'], ['## #projekt plán', '#projekt plán'], ['## x %%skryté%% y', 'x y'],
    ['## <b>tučně</b>', '<b>tučně</b>'], ['## $x^2$', '$x^2$'], ['## [[A|b]] ^id1', 'b'], ['## [[A#B]]', 'A#B'],
    ['## *kurzíva* a ~~škrt~~', 'kurzíva a škrt'], ['## `kód` v nadpisu', 'kód v nadpisu'], ['## Uzavřený ##', 'Uzavřený'], ['### Tři ###   ', 'Tři'],
    ['## ![obrázek](a.png) popis', 'obrázek popis'], ['## Čeština ^blok-1', 'Čeština'], ['## [[Plán offsitu 2026|odkaz]]', 'odkaz'],
  ]
  const bad: string[] = []
  for (const [src, want] of cases) {
    const got = outlineHeadings(`${src}\n`)
    if (got.length !== 1 || got[0].text !== want) bad.push(`${JSON.stringify(src)}: want ${JSON.stringify(want)}, got ${JSON.stringify(texts(got))}`)
  }
  assert.deepEqual(bad, [], 'R171 rule 4 (contract §1.2 L1 strings)')
  const atx = '## Uzavřený ##\n'
  const [a] = outlineHeadings(atx)
  assert.deepEqual([a?.from, a?.to], [0, 14], 'an ATX heading\'s range is its line, closing sequence included')
})

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-4

test('fr_edt_11_ac4_tree_by_depth', () => {
  const pre = outlineTree(outlineHeadings(fx(PRESK)))
  assert.deepEqual(pre.map((n) => [n.text, n.level, n.depth]), [
    ['Začátek ve třetí', 3, 1], ['Hlavní', 1, 1], ['Přeskok', 3, 2], ['Zpět na dvojku', 2, 2], ['Hluboko', 6, 3],
  ], 'Přeskočené: depth = 1 + ancestors; a note may start at any level')
  assert.deepEqual(pre.map((n) => n.parent), [null, null, 1, 1, 3], 'parent = nearest earlier heading with a lower level')
  assert.deepEqual(pre.map((n) => n.children), [[], [2, 3], [], [4], []], 'children in note order')
  assert.deepEqual(pre.map((n) => n.index), [0, 1, 2, 3, 4], 'indexes are positions in the list')
  assert.deepEqual(pre.map((n) => n.descendants), [0, 3, 0, 1, 0], 'descendants: all headings below')

  const arch = outlineTree(outlineHeadings(fx(ARCH)))
  assert.deepEqual(arch.map((n) => [n.text, n.level, n.depth]), ARCH_ROWS.map(([t, l]) => [t, l, l]), 'Architektura: depth = level')
  const withKids = arch.filter((n) => n.children.length > 0)
  assert.deepEqual(withKids.map((n) => [n.text, n.descendants]), Object.entries(ARCH_DESC), 'Architektura\'s 9 headings with children and their descendant counts')

  const plan = outlineTree(outlineHeadings(fx(PLAN)))
  assert.deepEqual(plan.map((n) => [n.text, n.level, n.depth]), PLAN_ROWS, 'Plán: text, level, depth')
  assert.deepEqual(plan.filter((n) => n.children.length).map((n) => n.text), ['Cíle', 'Program', 'Den 1', 'Logistika'], 'Plán: with children')
  assert.equal(plan[3]?.key, '1:Program#1', 'Program\'s fold key')

  const ok = outlineTree(outlineHeadings(fx(OKRAJE)))
  assert.deepEqual(ok.map((n) => [n.text, n.level, n.depth]), OKRAJE_ROWS, 'Okraje: text, level, depth')
  assert.deepEqual(ok.slice(8).map((n) => n.key), ['2:Poznámky#1', '3:Poznámky#1', '2:Poznámky#2'], 'R171 rule 6: n counts the same level and NFC text')
  assert.deepEqual(ok.slice(8).map((n) => n.children.length), [1, 0, 0], 'the first Poznámky has the level-3 one as its child; the last has none')

  const cten = outlineTree(outlineHeadings(fx(CTEN)))
  assert.equal(cten.length, 51, 'Čtenářské: 51 headings')
  assert.deepEqual(cten.filter((n) => n.depth === 1).map((n) => n.text), CTEN_H1, 'Čtenářské: the 12 H1')
  const parents = [...CTEN_H1.slice(0, 6), 'Vedoucí a následovníci', 'Zpoždění replikace', ...CTEN_H1.slice(6)]
  assert.deepEqual(cten.filter((n) => n.children.length).map((n) => n.text), parents, 'Čtenářské: 14 headings with children, in note order')
  assert.equal(cten[cten.length - 1]?.text, 'Další čtení', 'the last heading')
  assert.deepEqual(outlineTree([]), [], 'an empty list gives an empty tree')
})

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-5

/** Names of rows, for comparing index lists by text (Čtenářské has two `Příklady`, kept apart by order). */
const namesOf = (tree: readonly Node[], idx: readonly number[]) => idx.map((i) => tree[i]?.text ?? `#${i}`)
function expectedCten(tree: readonly Node[], extra: string[][]): string[] {
  const want: string[] = []
  for (const n of tree) {
    if (n.depth === 1) { want.push(n.text); continue }
    for (const e of extra) if (e.includes(`${n.index}`)) want.push(n.text)
  }
  return want
}

test('fr_edt_16_ac5_rail_rows_in_a_long_note', () => {
  const cten = outlineTree(outlineHeadings(fx(CTEN)))
  const ix = (t: string, nth = 0) => cten.filter((n) => n.text === t)[nth]?.index ?? -1
  assert.equal(D.RAIL_MAX_ROWS, 20, 'RAIL_MAX_ROWS = 20')
  assert.equal(railDepth(cten), 1, 'Čtenářské: X = 1 (12 at depth 1, 48 at depth ≤ 2)')
  const under = (parent: string) => cten.filter((n) => n.parent === ix(parent)).map((n) => `${n.index}`)
  const sets: [string, number | null, ReadonlySet<number> | undefined, number, string[][]][] = [
    ['nothing current', null, undefined, 12, []],
    ['Replikace', ix('Replikace'), undefined, 15, [under('Replikace')]],
    ['Zpoždění replikace', ix('Zpoždění replikace'), undefined, 16, [under('Replikace'), under('Zpoždění replikace')]],
    ['Kompromisy', ix('Kompromisy'), undefined, 17, [under('Replikace'), under('Vedoucí a následovníci')]],
    ['Další čtení (the end)', ix('Další čtení'), undefined, 15, [under('Závěr')]],
    ['Zpoždění replikace + Transakce opened', ix('Zpoždění replikace'), new Set([ix('Transakce')]), 19, [under('Replikace'), under('Zpoždění replikace'), under('Transakce')]],
  ]
  for (const [what, cur, open, n, extra] of sets) {
    const got = railRows(cten, cur, open)
    assert.equal(got.length, n, `${what}: ${n} rows (README "Expected rail rows"), got ${got.length}`)
    assert.deepEqual(namesOf(cten, got), expectedCten(cten, extra), `${what}: the rows in note order`)
  }
  assert.deepEqual(namesOf(cten, railRows(cten, ix('Replikace'))).filter((t) => H2_OF['Replikace'].includes(t)), H2_OF['Replikace'], 'Replikace current: its 3 H2')
  const inTrans = railRows(cten, ix('ACID'))
  assert.ok(!namesOf(cten, inTrans).some((t) => H2_OF['Replikace'].includes(t)), 'scrolling into Transakce removes Replikace\'s H2 lines')
  assert.deepEqual(namesOf(cten, inTrans).filter((t) => H2_OF['Transakce'].includes(t)), H2_OF['Transakce'], 'and adds Transakce\'s')
  const temp = railRows(cten, ix('Zpoždění replikace'), new Set([ix('ACID')]))
  assert.equal(temp.length, 16, 'tempOpen of a row that is not drawn adds nothing (only children of t ∈ S)')
  for (const p of [ARCH, PLAN]) {
    const tree = outlineTree(outlineHeadings(fx(p)))
    assert.equal(railDepth(tree), 6, `${p}: X = 6`)
    const all = tree.map((n) => n.index)
    for (const cur of [null, ...all]) assert.deepEqual(railRows(tree, cur), all, `${p}: every heading with current ${cur}`)
  }
  assert.equal(railDepth(outlineTree([]), 20), 1, 'an empty tree: X = 1')
  assert.deepEqual(railRows(outlineTree([]), null), [], 'an empty tree draws nothing')
})

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-10

test('fr_fmt_12_ac10_nfd_heading_same_fold_key', () => {
  const nfc = 'Složky podle typu'
  const nfd = nfc.normalize('NFD')
  assert.notEqual(nfd, nfc, 'the NFD form differs in code units')
  const text = fx(ARCH).replace(`### ${nfc}`, `### ${nfd}`)
  assert.notEqual(text, fx(ARCH), 'Architektura\'s line rewritten in NFD')
  const h = outlineHeadings(text)
  assert.equal(h[2]?.text, nfd, 'outlineHeadings reports the NFD text as written')
  assert.equal(foldKey(3, nfd, 1), '3:Složky podle typu#1'.normalize('NFC'), 'foldKey of the NFD text is NFC')
  assert.equal(foldKey(3, nfd, 1), foldKey(3, nfc, 1), 'the same key for both forms')
  assert.equal(foldKey(2, 'Poznámky', 2), '2:Poznámky#2', 'the key format `<level>:<NFC text>#<n>`')
  assert.equal(outlineTree(h)[2]?.key, '3:Složky podle typu#1', 'the tree\'s key is NFC')
  const mixed = outlineTree(outlineHeadings(`## ${nfd}\n\n## ${nfc}\n`))
  assert.deepEqual(mixed.map((n) => n.key), ['2:Složky podle typu#1', '2:Složky podle typu#2'], 'n counts NFC-equal texts together')
})

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-19 (D-1625)

test('fr_edt_11_ac19_heading_link_lands_where_the_outline_jumps_fragment_lookup', () => {
  const text = fx(CTEN)
  const h = outlineHeadings(text)
  const want = h.findIndex((x) => x.text === 'Zpoždění replikace')
  assert.ok(want >= 0, 'Zpoždění replikace is listed')
  assert.equal(headingForFragment(h, 'Zpoždění replikace'), want, 'the fragment resolves to the outline\'s heading')
  assert.equal(h[want]?.from, text.indexOf('## Zpoždění replikace'), 'the same `from` offset as the outline row')
  assert.equal(headingForFragment(h, 'zpoždění REPLIKACE'), want, 'case-insensitive')
  assert.equal(headingForFragment(h, 'Zpoždění replikace'.normalize('NFD')), want, 'NFC compared')
  assert.equal(headingForFragment(h, 'Příklady'), h.findIndex((x) => x.text === 'Příklady'), 'duplicates: the first in note order (CP-14)')
  assert.equal(headingForFragment(h, 'Neexistuje'), null, 'no such heading: null')
  const ok = outlineHeadings(fx(OKRAJE))
  assert.equal(headingForFragment(ok, '^oddil1'), null, 'a block fragment is not a heading')
  assert.equal(headingForFragment(ok, 'Poznámky'), 8, 'Okraje: the first Poznámky')
})

// ------------------------------------------------------------------------------------------------ §1.4 / §8, report-only

/** `Pages/Pět set nadpisů.md` (README "Made at runtime"): 100 H1, each with 4 H2, a 30-word paragraph after each. */
function petSet(): string {
  const words = Array.from({ length: 30 }, (_, i) => ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'přes', 'louku'][i % 7]).join(' ') + '.'
  const out = ['---', 'id: 01JC5N0000000000000000R005', 'type: page', 'title: Pět set nadpisů', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '---']
  for (let k = 1; k <= 100; k++) {
    const kk = String(k).padStart(3, '0')
    out.push(`# Kapitola ${kk}`, '', words, '')
    for (let o = 1; o <= 4; o++) out.push(`## Oddíl ${kk}.${o}`, '', words, '')
  }
  return out.join('\n')
}

test('fr_edt_11_ac20_five_hundred_headings_l1_benchmark', () => {
  const text = petSet()
  const t0 = performance.now()
  const h = outlineHeadings(text)
  const ms = performance.now() - t0
  assert.equal(h.length, 500, '500 headings')
  assert.equal(h[h.length - 1]?.text, 'Oddíl 100.4', 'the last one')
  const tree = outlineTree(Array.from({ length: 600 }, (_, i) => ({ level: ((i % 6) + 1) as Level, text: `Nadpis ${i}`, from: i * 10, to: i * 10 + 9 })))
  const t1 = performance.now()
  for (let c = 0; c < 600; c += 60) railRows(tree, c)
  const rail = (performance.now() - t1) / 10
  console.log(`outline L1 benchmark (report-only, D-1623): outlineHeadings on ${(text.length / 1024).toFixed(0)} KB, 500 headings: ${ms.toFixed(1)} ms (target < 40 ms on the reference machine); railRows on 600 headings: ${rail.toFixed(2)} ms`)
})
