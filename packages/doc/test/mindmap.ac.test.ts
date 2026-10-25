// Slice MM, L1: the mindmap format in @tegg/doc (docs/acceptance/mindmap.md; contract docs/contracts/mm-mindmap.md §1).
// FR-FMT-05 AC-4 (R90 recognition: kinds of every fixture block, the type in any case, fold markers, the one-list rule,
// CRLF and NFD copies, D-765's reading of the body on its own), FR-FMT-05 AC-5 (the kinds of the two Mermaid fences),
// FR-MMP-02 AC-2 (the root, `mindmapTree`), FR-MMP-02 AC-9 (the node content model: inline runs, checklist state,
// `more`, numbered lists, D-774), FR-MMP-01 AC-2…AC-4 (wrap and unwrap bytes W2…W8a, D-767).
// Fixture: tests/fixtures/vaults/mindmap (read only). Written from the ACs and the contract only (D-61); the stubs of
// `mindmapTree`, `wrapMindmap` and `unwrapMindmap` exist, so every test fails on an assertion (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mindmapTree, parse, unwrapMindmap, wrapMindmap, type MindInline, type MindItem, type MindmapTree } from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const FX = 'tests/fixtures/vaults/mindmap'
const fx = (rel: string) => readFileSync(resolve(REPO, FX, rel), 'utf8')
const kinds = (text: string) => parse(text).blocks.map((b) => b.kind)
const blocks = (text: string) => parse(text).blocks.map((b) => b.raw)
const nfd = (s: string) => s.normalize('NFD')
const crlf = (s: string) => s.replace(/\n/g, '\r\n')

/** R90: the kinds of every top-level block of every fixture note. */
const R90: [string, string[]][] = [
  ['Pages/Výjezd 2026.md', ['paragraph', 'mindmap', 'paragraph']],
  ['Pages/Uzly.md', ['mindmap']],
  ['Pages/Nákup.md', ['mindmap']],
  ['Pages/Postup.md', ['mindmap']],
  ['Pages/Více kořenů.md', ['mindmap']],
  ['Pages/Bez titulku.md', ['mindmap']],
  ['Pages/Holá mapa.md', ['mindmap']],
  ['Pages/Složené.md', ['mindmap', 'mindmap']],
  ['Pages/Rozpoznání.md', ['callout', 'callout', 'callout', 'callout', 'mindmap', 'mindmap', 'callout', 'callout', 'mindmap', 'mindmap']],
  ['Pages/Mermaid.md', ['paragraph', 'raw', 'code', 'paragraph']],
  ['Pages/Z Obsidianu.md', ['mindmap']],
  ['Pages/Rozložení.md', ['mindmap', 'mindmap', 'mindmap']],
  ['Pages/Rozbalení.md', ['mindmap', 'mindmap']],
  ['Pages/Neplatná mapa.md', ['mindmap']],
  ['_templates/Projekt/Projekt.md', ['mindmap']],
  ['Pages/Převody.md', ['paragraph', 'list', 'list', 'heading', 'paragraph', 'paragraph', 'quote', 'code']],
  ['Pages/Lisabon.md', ['paragraph']],
  ['Pages/Vložení.md', ['paragraph', 'embed']],
  ['Pages/Prázdná.md', []],
  ['.trash/Pages/Stará mapa.md', ['mindmap']],
]

// ------------------------------------------------------------------------------------------------ helpers

/** Inline runs with adjacent plain-text runs of the same marks merged and empty text runs dropped (the contract
 *  doesn't fix how text is split into runs). */
function norm(inl: MindInline[]): MindInline[] {
  const out: MindInline[] = []
  for (const r of inl) {
    if (r.k === 'text' && r.text === '') continue
    const last = out[out.length - 1]
    if (r.k === 'text' && last && last.k === 'text' && [...last.marks].sort().join() === [...r.marks].sort().join()) {
      out[out.length - 1] = { ...last, text: last.text + r.text }
      continue
    }
    out.push(r.k === 'text' ? { ...r, marks: [...r.marks].sort() } : r)
  }
  return out
}
const T = (text: string, ...marks: ('strong' | 'emphasis' | 'code' | 'mark' | 'delete')[]): MindInline => ({ k: 'text', text, marks: [...marks].sort() })
const L = (target: string, embed = false, alias: string | null = null): MindInline => ({ k: 'link', target, alias, embed })
/** The plain text of an item's first paragraph (links as their target, tags with `#`, breaks as `\n`). */
function plain(inl: MindInline[]): string {
  return inl.map((r) => (r.k === 'text' ? r.text : r.k === 'link' ? r.target : r.k === 'tag' ? `#${r.value}` : r.k === 'break' ? '\n' : r.text)).join('')
}
/** Outline as `level:text` lines, depth first (the drawn nodes without a synthesized root). */
function outline(items: MindItem[], level = 1): string[] {
  return items.flatMap((i) => [`${level}:${plain(i.inline)}`, ...outline(i.children, level + 1)])
}
function rootText(t: MindmapTree | null): string {
  if (!t) return '<null tree>'
  return t.root.kind === 'item' ? `item:${plain(t.root.item.inline)}` : t.root.kind === 'synthesized' ? `synthesized:${t.root.text}` : 'empty'
}
function tree(raw: string, title: string): MindmapTree {
  const t = mindmapTree(raw, title)
  assert.ok(t, `mindmapTree returns a tree for ${JSON.stringify(raw.split('\n')[0])} (§1.2)`)
  return t!
}

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-4

test('fr_fmt_05_ac4_r90_kind_of_every_fixture_block', () => {
  const bad: string[] = []
  for (const [path, want] of R90) {
    const got = kinds(fx(path))
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${path}: ${JSON.stringify(got)} ≠ R90 ${JSON.stringify(want)}`)
  }
  assert.deepEqual(bad, [], 'parse(text).blocks[i].kind follows R90')
})

test('fr_fmt_05_ac4_type_in_any_case_and_fold_markers_dont_matter', () => {
  const list = '> - Kořen\n>   - Větev\n'
  for (const head of ['[!mindmap]', '[!MindMap]', '[!MINDMAP]', '[!Mindmap]', '[!mindmap]+', '[!mindmap]-', '[!MINDMAP]+ Titulek', '[!mindmap]- Složená']) {
    assert.deepEqual(kinds(`> ${head}\n${list}`), ['mindmap'], `> ${head} holding one list is a mindmap`)
  }
  for (const head of ['[!mind-map]', '[!mindmaps]', '[!note]']) {
    assert.deepEqual(kinds(`> ${head} T\n${list}`), ['callout'], `> ${head} is an ordinary callout`)
  }
})

test('fr_fmt_05_ac4_a_body_is_one_list_and_nothing_else_but_blank_lines', () => {
  const ok: [string, string][] = [
    ['bulleted', '> [!mindmap] T\n> - a\n> - b'],
    ['numbered from 1', '> [!mindmap] T\n> 1. a\n> 2. b'],
    ['checklist', '> [!mindmap] T\n> - [ ] a\n> - [x] b'],
    ['checklist and plain items mixed in one list', '> [!mindmap] T\n> - [ ] a\n> - b\n> - [X] c'],
    ['a loose list (blank `>` lines between items)', '> [!mindmap] T\n> - a\n>\n> - b'],
    ['blank `>` lines before the list', '> [!mindmap] T\n>\n> - a'],
    ['blank `>` lines after the list', '> [!mindmap] T\n> - a\n>'],
    ['nested items holding other blocks', '> [!mindmap] T\n> - a\n>\n>   Druhý odstavec.\n> - b'],
    ['title only (empty state, D-765)', '> [!mindmap] T'],
    ['no title, title line only', '> [!mindmap]'],
  ]
  for (const [what, src] of ok) assert.deepEqual(kinds(src + '\n'), ['mindmap'], `${what}: mindmap`)
  const hint: [string, string][] = [
    ['a paragraph', '> [!mindmap] T\n> Text.'],
    ['two lists (marker change)', '> [!mindmap] T\n> - a\n>\n> * b'],
    ['a list and a paragraph', '> [!mindmap] T\n> - a\n>\n> Odstavec.'],
    ['a paragraph and a list', '> [!mindmap] T\n> Odstavec.\n>\n> - a'],
    ['a list and a comment', '> [!mindmap] T\n> - a\n>\n> %%poznámka%%'],
    ['a list and a code block', '> [!mindmap] T\n> - a\n>\n> ```\n> x\n> ```'],
  ]
  for (const [what, src] of hint) assert.deepEqual(kinds(src + '\n'), ['callout'], `${what}: a hint callout (D-680)`)
})

test('fr_fmt_05_ac4_the_body_is_read_on_its_own_after_the_title_line', () => {
  // D-765: an empty first item and a numbered list not starting at 1, right after the title line.
  assert.deepEqual(kinds('> [!mindmap] Navazující text\n> 2. druhý bod\n'), ['mindmap'], 'Rozpoznání (5)')
  assert.deepEqual(kinds('> [!mindmap] Prázdná položka\n> -\n>   - dítě\n'), ['mindmap'], 'Rozpoznání (6)')
  assert.deepEqual(kinds('> [!mindmap]\n> -\n'), ['mindmap'], 'an empty single item after a bare title line')
  const doc = parse('Před.\n\n> [!mindmap]\n> -\n>   - dítě\n\nPo.\n')
  assert.deepEqual(doc.blocks.map((b) => [b.kind, b.raw]), [['paragraph', 'Před.'], ['mindmap', '> [!mindmap]\n> -\n>   - dítě'], ['paragraph', 'Po.']], 'the block range is unchanged by the rule')
})

test('fr_fmt_05_ac4_crlf_and_nfd_copies_are_recognised_alike', () => {
  for (const [path, want] of R90) {
    if (want.length === 0) continue
    const text = fx(path)
    assert.deepEqual(kinds(crlf(text)), want, `${path}: CRLF copy`)
    assert.deepEqual(kinds(nfd(text)), want, `${path}: NFD copy`)
  }
})

test('fr_fmt_05_ac4_trees_of_r90_roots_and_node_counts', () => {
  // R90's root (nodes) column: the drawn nodes including a synthesized root.
  const want: [string, number, string, string, number][] = [
    ['Pages/Výjezd 2026.md', 1, 'Výjezd 2026', 'item:Výjezd 2026', 7],
    ['Pages/Uzly.md', 0, 'Uzly', 'item:Obsah uzlů', 12],
    ['Pages/Nákup.md', 0, 'Nákup', 'item:Nákup', 4],
    ['Pages/Postup.md', 0, 'Postup', 'item:Postup', 3],
    ['Pages/Více kořenů.md', 0, 'Více kořenů', 'synthesized:Témata', 5],
    ['Pages/Bez titulku.md', 0, 'Bez titulku', 'synthesized:Bez titulku', 3],
    ['Pages/Holá mapa.md', 0, 'Holá mapa', 'synthesized:Holá mapa', 3],
    ['Pages/Složené.md', 0, 'Složené', 'item:Kořen', 2],
    ['Pages/Složené.md', 1, 'Složené', 'item:Kořen', 2],
    ['Pages/Rozpoznání.md', 4, 'Rozpoznání', 'item:druhý bod', 1],
    ['Pages/Rozpoznání.md', 5, 'Rozpoznání', 'item:', 2],
    ['Pages/Rozpoznání.md', 8, 'Rozpoznání', 'item:a', 1],
    ['Pages/Rozpoznání.md', 9, 'Rozpoznání', 'empty', 0],
    ['Pages/Z Obsidianu.md', 0, 'Z Obsidianu', 'item:Kořen', 3],
    ['Pages/Rozložení.md', 0, 'Rozložení', 'item:Kořen', 7],
    ['Pages/Rozložení.md', 1, 'Rozložení', 'item:Krátký', 2],
    ['Pages/Rozložení.md', 2, 'Rozložení', 'item:Barvy', 9],
    ['Pages/Rozbalení.md', 0, 'Rozbalení', 'item:Kořen', 2],
    ['Pages/Rozbalení.md', 1, 'Rozbalení', 'synthesized:Rozbalení', 3],
    ['Pages/Neplatná mapa.md', 0, 'Neplatná mapa', 'item:Jen ke čtení', 3],
    ['_templates/Projekt/Projekt.md', 0, 'Projekt', 'item:Cíle projektu', 4],
  ]
  const bad: string[] = []
  for (const [path, k, title, root, n] of want) {
    const raw = blocks(fx(path))[k]
    const t = mindmapTree(raw ?? '', title)
    const nodes = t ? outline(t.items).length + (t.root.kind === 'synthesized' ? 1 : 0) : -1
    if (rootText(t) !== root || nodes !== n) bad.push(`${path} block ${k + 1}: ${rootText(t)} (${nodes}) ≠ ${root} (${n})`)
  }
  assert.deepEqual(bad, [], 'R90 roots and node counts')
  for (const [path, k] of [['Pages/Rozpoznání.md', 0], ['Pages/Rozpoznání.md', 1], ['Pages/Rozpoznání.md', 6], ['Pages/Mermaid.md', 1], ['Pages/Převody.md', 1]] as const) {
    assert.equal(mindmapTree(blocks(fx(path))[k], 'X'), null, `${path} block ${k + 1} isn't a mindmap: null`)
  }
})

// ------------------------------------------------------------------------------------------------ FR-FMT-05 AC-5 (L1)

test('fr_fmt_05_ac5_mermaid_fences_are_raw_and_code', () => {
  const doc = parse(fx('Pages/Mermaid.md'))
  assert.deepEqual(doc.blocks.map((b) => b.kind), ['paragraph', 'raw', 'code', 'paragraph'], 'the `mindmap` fence is raw, the flowchart fence code (D-679)')
  assert.equal(doc.blocks[1].raw, '```mermaid\nmindmap\n  root((Řeka))\n    Prameny\n    Přítoky\n```', 'the raw block is the fence, exact')
  assert.deepEqual(kinds('```mermaid\n\n  mindmap\n  root((A))\n```\n'), ['raw'], 'the first non-blank line starts with `mindmap`')
  assert.deepEqual(kinds('```mermaid\ngraph TD\n  A-->B\n```\n'), ['code'], 'other Mermaid fences stay code')
  assert.equal(mindmapTree(doc.blocks[1].raw, 'Mermaid'), null, 'a Mermaid fence is never a mindmap')
})

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-2 (L1)

test('fr_mmp_02_ac2_root_is_the_single_item_or_synthesized', () => {
  const v = tree(blocks(fx('Pages/Výjezd 2026.md'))[1], 'Výjezd 2026')
  assert.equal(v.root.kind, 'item', 'Výjezd: one top-level item')
  assert.equal(v.title, 'Výjezd 2026')
  assert.deepEqual(outline(v.items), ['1:Výjezd 2026', '2:Program', '3:Přehled Q4', '3:Plán 2027', '2:Místo', '3:Lisabon', '2:Doprava'], 'Výjezd outline (AC-1 order)')
  const vk = tree(blocks(fx('Pages/Více kořenů.md'))[0], 'Více kořenů')
  assert.deepEqual(vk.root, { kind: 'synthesized', text: 'Témata' }, 'several top-level items: the callout title')
  assert.deepEqual(outline(vk.items), ['1:Rodina', '1:Práce', '2:Porady', '1:Zdraví'], 'the top-level items are the root\'s children')
  const bt = tree(blocks(fx('Pages/Bez titulku.md'))[0], 'Bez titulku')
  assert.equal(bt.title, null, 'no title')
  assert.deepEqual(bt.root, { kind: 'synthesized', text: 'Bez titulku' }, 'no title: the note title')
  const hm = tree(blocks(fx('Pages/Holá mapa.md'))[0], 'Holá mapa')
  assert.deepEqual(hm.root, { kind: 'synthesized', text: 'Holá mapa' }, 'no frontmatter: the caller passes the file stem (D-103)')
  assert.deepEqual(tree('> [!mindmap] Prázdná', 'Rozpoznání').root, { kind: 'empty' }, 'no item: empty (D-681)')
  assert.deepEqual(tree('> [!mindmap] Prázdná', 'Rozpoznání').items, [], 'the empty state has no items')
  // NFC (FR-FMT-12): every text in NFC.
  const n = tree(nfd(blocks(fx('Pages/Více kořenů.md'))[0]), nfd('Více kořenů'))
  assert.deepEqual(n.root, { kind: 'synthesized', text: 'Témata' }, 'NFD input: NFC title')
  assert.deepEqual(outline(n.items), ['1:Rodina', '1:Práce', '2:Porady', '1:Zdraví'], 'NFD input: NFC texts')
  const bn = tree(nfd('> [!mindmap]\n> - Jaro\n> - Léto'), nfd('Bez titulku'))
  assert.deepEqual(bn.root, { kind: 'synthesized', text: 'Bez titulku' }, 'NFD note title: NFC root')
})

test('fr_mmp_02_ac2_tree_fields_title_spelling_fold_and_paths', () => {
  const s = blocks(fx('Pages/Složené.md'))
  const a = tree(s[0], 'Složené')
  assert.deepEqual([a.title, a.typeSpelling, a.fold], ['Složená mapa', 'mindmap', '-'], 'Složené (1)')
  const b = tree(s[1], 'Složené')
  assert.deepEqual([b.title, b.typeSpelling, b.fold], ['Rozbalená mapa', 'MINDMAP', '+'], 'Složené (2)')
  const p = tree(blocks(fx('Pages/Postup.md'))[0], 'Postup')
  assert.deepEqual([p.typeSpelling, p.fold, p.ordered], ['MindMap', '', true], 'Postup: spelling as written, numbered')
  const v = tree(blocks(fx('Pages/Výjezd 2026.md'))[1], 'Výjezd 2026')
  const paths: string[] = []
  const walk = (items: MindItem[]) => items.forEach((i) => { paths.push(i.path.join('.')); walk(i.children) })
  walk(v.items)
  assert.deepEqual(paths, ['0', '0.0', '0.0.0', '0.0.1', '0.1', '0.1.0', '0.2'], 'index paths in outline order')
  assert.equal(v.ordered, false)
  const crl = tree(crlf(blocks(fx('Pages/Výjezd 2026.md'))[1]), 'Výjezd 2026')
  assert.deepEqual(outline(crl.items), outline(v.items), 'CRLF is accepted')
  const z = tree(blocks(fx('Pages/Z Obsidianu.md'))[0], 'Z Obsidianu')
  assert.deepEqual(outline(z.items), ['1:Kořen', '2:Větev s tabulátorem', '3:List'], 'tab indents: depth 3')
})

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-9 (L1)

test('fr_mmp_02_ac9_uzly_node_content_model', () => {
  const u = tree(blocks(fx('Pages/Uzly.md'))[0], 'Uzly')
  assert.equal(u.root.kind, 'item', 'one top-level item')
  const root = (u.root as { kind: 'item'; item: MindItem }).item
  assert.deepEqual(norm(root.inline), [T('Obsah uzlů')], 'the root')
  const kids = root.children
  assert.equal(kids.length, 11, 'eleven child nodes (the loose list counts each item once)')
  const want: [string, MindInline[], boolean][] = [
    ['(a) marks', [T('Tučně', 'strong'), T(', '), T('kód', 'code'), T(' a '), T('zvýraznění', 'mark')], false],
    ['(b) link and tag', [T('Odkaz na '), L('Lisabon'), T(' a '), { k: 'tag', value: 'cestování' }], false],
    ['(c) date link', [T('Termín '), L('2026-10-20')], false],
    ['(d) task embed: a chip (D-774)', [T('Úkol '), L('Zalít květiny', true)], false],
    ['(e) image embed: a file chip', [T('Fotka '), L('fotka.png', true)], false],
    ['(f) long text', [T('Velmi dlouhý text uzlu, který se musí zalomit do více řádků')], false],
    ['(g) second paragraph', [T('Odstavec navíc')], true],
    ['(h) code block', [T('Položka s kódem')], true],
    ['(i) quote', [T('Položka s citací')], true],
    ['(j) broken link', [L('Neexistuje')], false],
    ['(k) hard break', [T('Řádek jedna'), { k: 'break' }, T('řádek dva')], false],
  ]
  const bad: string[] = []
  for (const [k, [what, inline, more]] of want.entries()) {
    const got = kids[k]
    if (!got) { bad.push(`${what}: missing`); continue }
    if (JSON.stringify(norm(got.inline)) !== JSON.stringify(norm(inline))) bad.push(`${what}: ${JSON.stringify(norm(got.inline))}`)
    if (got.more !== more) bad.push(`${what}: more ${got.more}, want ${more}`)
    if (got.checked !== null) bad.push(`${what}: checked ${got.checked}, want null`)
    if (got.children.length !== 0) bad.push(`${what}: ${got.children.length} children`)
    if (got.path.join('.') !== `0.${k}`) bad.push(`${what}: path ${got.path.join('.')}`)
  }
  assert.deepEqual(bad, [], 'R92/D-774 node content of Uzly')
  for (const k of [6, 7, 8]) {
    const s = JSON.stringify(kids[k]?.inline ?? [])
    for (const hidden of ['Druhý odstavec', 'let x', 'Citace v položce']) assert.ok(!s.includes(hidden), `node ${k + 1} holds no "${hidden}"`)
  }
})

test('fr_mmp_02_ac9_checklist_state_and_numbered_lists_without_numbers', () => {
  const n = tree(blocks(fx('Pages/Nákup.md'))[0], 'Nákup')
  const flat: [string, boolean | null][] = []
  const walk = (items: MindItem[]) => items.forEach((i) => { flat.push([plain(i.inline), i.checked]); walk(i.children) })
  walk(n.items)
  assert.deepEqual(flat, [['Nákup', false], ['Mléko', true], ['Chléb', false], ['Sýr', true]], 'checked for [x] and [X], unchecked for [ ]')
  const p = tree(blocks(fx('Pages/Postup.md'))[0], 'Postup')
  assert.equal(p.ordered, true, 'the list is numbered')
  assert.deepEqual(outline(p.items), ['1:Postup', '2:Krok jedna', '2:Krok dva'], 'no numbers in the text (D-774)')
  const empty = tree(blocks(fx('Pages/Rozpoznání.md'))[5], 'Rozpoznání')
  assert.equal(empty.root.kind, 'item', 'Rozpoznání (6): the empty first item is the root')
  assert.deepEqual((empty.root as { kind: 'item'; item: MindItem }).item.inline, [], 'an item without text has no runs')
  assert.deepEqual(outline(empty.items), ['1:', '2:dítě'], 'its child')
  const two = tree('> [!mindmap]\n> - Kořen\n>   - a\n>\n>   Odstavec.\n>\n>   * b', 'X')
  const r = (two.root as { kind: 'item'; item: MindItem }).item
  assert.deepEqual(r.children.map((c) => plain(c.inline)), ['a', 'b'], 'children of every list directly inside the item, in file order (D-774)')
  assert.equal(r.more, true, 'a paragraph besides the child lists: more')
})

test('fr_mmp_02_ac9_aliases_and_external_links', () => {
  const t = tree('> [!mindmap]\n> - [[Lisabon|hlavní město]] a [web](https://example.org) a *kurzíva* ~~pryč~~', 'X')
  const r = (t.root as { kind: 'item'; item: MindItem }).item
  assert.deepEqual(norm(r.inline), norm([L('Lisabon', false, 'hlavní město'), T(' a '), { k: 'url', href: 'https://example.org', text: 'web' }, T(' a '), T('kurzíva', 'emphasis'), T(' '), T('pryč', 'delete')]), 'alias, url, emphasis and delete runs')
})

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-2…AC-4 (L1)

const PREVODY = () => blocks(fx('Pages/Převody.md'))
const ROZBALENI = () => blocks(fx('Pages/Rozbalení.md'))

test('fr_mmp_01_ac2_wrap_keeps_the_list_bytes_w2_w3', () => {
  const b = PREVODY()
  assert.equal(b[1], '* Kořen\n    * Větev s odsazením čtyř mezer\n* Druhý', 'fixture: block 2')
  assert.equal(wrapMindmap([b[1]], []), '> [!mindmap]\n> * Kořen\n>     * Větev s odsazením čtyř mezer\n> * Druhý', 'W2')
  assert.equal(wrapMindmap([b[2]], []), '> [!mindmap]\n> 1) První krok\n> 2) Druhý krok', 'W3')
  const w2 = wrapMindmap([b[1]], [])
  assert.deepEqual(kinds(w2), ['mindmap'], 'W2 is a mindmap block')
  assert.deepEqual(tree(w2, 'Převody').root, { kind: 'synthesized', text: 'Převody' }, 'W2: root Převody')
  assert.deepEqual(outline(tree(w2, 'Převody').items), ['1:Kořen', '2:Větev s odsazením čtyř mezer', '1:Druhý'])
  assert.deepEqual(outline(tree(wrapMindmap([b[2]], []), 'Převody').items), ['1:První krok', '1:Druhý krok'], 'W3 items')
  assert.equal(wrapMindmap(['- a\n\n- b'], []), '> [!mindmap]\n> - a\n>\n> - b', 'blank lines become `>` alone')
})

test('fr_mmp_01_ac3_text_blocks_become_one_list_w4_w5', () => {
  const b = PREVODY()
  assert.equal(wrapMindmap([b[0]], []), '> [!mindmap]\n> - Úvodní odstavec.', 'W4')
  assert.equal(wrapMindmap([b[3], b[4], b[5]], ['\n\n', '\n\n']), '> [!mindmap]\n> - Nadpis jedna\n> - Odstavec dva.\n> - Odstavec tři.', 'W5: the heading loses its #s, gaps dropped')
  const w4 = tree(wrapMindmap([b[0]], []), 'Převody')
  assert.deepEqual(w4.root.kind === 'item' ? plain(w4.root.item.inline) : rootText(w4), 'Úvodní odstavec.', 'W4 root')
  const w5 = tree(wrapMindmap([b[3], b[4], b[5]], ['\n\n', '\n\n']), 'Převody')
  assert.deepEqual([rootText(w5), outline(w5.items)], ['synthesized:Převody', ['1:Nadpis jedna', '1:Odstavec dva.', '1:Odstavec tři.']], 'W5 root and children')
})

test('fr_mmp_01_ac4_unwrap_bytes_w6_w8_w8a', () => {
  const r = ROZBALENI()
  assert.equal(r[0], '> [!mindmap] Titulek mapy\n> * Kořen\n>     * Větev', 'fixture: block 1')
  assert.equal(unwrapMindmap(r[0], 'keep'), 'Titulek mapy\n\n* Kořen\n    * Větev', 'W6: the title becomes a paragraph, the list keeps its bytes')
  assert.equal(unwrapMindmap(r[1], 'orderedList'), '1. Jedna\n2. Dvě', 'W8')
  assert.equal(unwrapMindmap(r[1], 'bulletList'), '- Jedna\n- Dvě', 'W8a')
  assert.equal(unwrapMindmap(r[1], 'checklist'), '- [ ] Jedna\n- [ ] Dvě', 'checklist')
  const nested = unwrapMindmap('> [!mindmap]\n> - a\n>   - b', 'orderedList')
  assert.match(nested, /^1\. a\n +1\. b$/, 'nested items are re-marked too')
  assert.deepEqual(outline(tree(wrapMindmap([nested], []), 'X').items), ['1:a', '2:b'], 'and stay nested')
  for (const [k, to] of [[0, 'keep'], [1, 'orderedList'], [1, 'bulletList'], [1, 'checklist']] as const) {
    const out = unwrapMindmap(r[k], to)
    const texts = k === 0 ? ['Titulek mapy', 'Kořen', 'Větev'] : ['Jedna', 'Dvě']
    for (const s of texts) assert.ok(out.includes(s), `no text lost (${to}): ${s}`)
  }
})

test('fr_mmp_01_ac4_untitled_wrap_then_unwrap_is_the_identity', () => {
  for (const list of ['* Kořen\n    * Větev s odsazením čtyř mezer\n* Druhý', '1) První krok\n2) Druhý krok', '- [ ] a\n  - [x] b\n\n- c', '- a\n\t- b']) {
    const w = wrapMindmap([list], [])
    assert.notEqual(w, list, 'wrapping changes the bytes')
    assert.equal(unwrapMindmap(w, 'keep'), list, `unwrap(wrap(${JSON.stringify(list)}))`)
  }
})
