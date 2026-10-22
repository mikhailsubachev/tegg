// MS5 slice 5A-2, L1: the conversion text helpers of @tegg/doc (docs/contracts/ms5-tasks.md §11.1, §11.2; D-490,
// D-491, D-495) and the new object's bytes through `newObject` with `body` (D-232, AP-452). R51 (what becomes title,
// tags and body; the embed in the source), FR-CNV-01 AC-4 (the unit of a selection, block range), FR-CNV-02 AC-1…AC-5,
// AC-7, FR-CNV-03 AC-1 (bytes), AC-2…AC-4, AC-9 (text), AC-5 (names). Fixture bytes from tests/fixtures/vaults/tasks
// (conversion.md fixture table). Written from docs/acceptance/conversion.md and the contract only (D-61). The module
// loads inside each test (TS-I1); the stubs exist, so the tests fail on their assertions.
//
// Offsets are UTF-16 indexes into the whole file (frontmatter included), as the contract says; the expected ranges
// are computed here from the fixture text with `indexOf`, never from the module under test.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const F = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/tasks', rel), 'utf8')
const NOW = '2026-10-14T12:00:00+02:00'
const ID = '01JB5A0000000000000000N201'

type Mod = Record<string, any>
type Unit = { kind: 'blocks' | 'items' | 'nested-item'; from: number; to: number; count: number; first: string; checked: boolean | null }
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['conversionUnit', 'objectFromUnit', 'replaceUnitWithEmbed', 'newObject']) {
    assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (ms5-tasks §11.1)`)
  }
  return m
}

const BLOKY = () => F('Pages/Bloky.md')
const nfc = (s: string) => s.normalize('NFC')
const nfd = (s: string) => s.normalize('NFD')
/** Offset of `needle` in `text`; the needle must occur exactly once (fixture guard, not an AC assertion). */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle)
  assert.ok(i >= 0 && text.indexOf(needle, i + 1) < 0, `fixture text holds ${JSON.stringify(needle)} exactly once`)
  return i
}
const end = (text: string, needle: string) => at(text, needle) + needle.length
function sw(text: string, from: string, to: string): string {
  at(text, from)
  return text.replace(from, () => to)
}
/** The fixture's links as resolved from the host (the app passes the titles `link_resolve` gives, §11.1). */
const TITLES: Record<string, string> = { 'Zasedačka': 'Zasedačka', 'C tips': 'C# tips' }
const linkTitle = (t: string) => TITLES[nfc(t)] ?? null

async function unitAt(text: string, from: number, to = from): Promise<Unit | null> {
  const m = await doc()
  return m.conversionUnit(text, from, to)
}
async function need(text: string, from: number, to = from): Promise<Unit> {
  const u = await unitAt(text, from, to)
  assert.ok(u, `conversionUnit(${from}, ${to}) gives a unit`)
  return u!
}
async function obj(text: string, u: Unit) {
  const m = await doc()
  return m.objectFromUnit(text, u, linkTitle) as { title: string; tags: string[]; body: string; checked: boolean | null }
}
async function embed(text: string, u: Unit, target: string) {
  const m = await doc()
  return m.replaceUnitWithEmbed(text, u, target) as { text: string; embedFrom: number; embedTo: number }
}
/** A page note with the given body (synthetic runtime host). */
const host = (body: string) => `---\nid: 01JB5A0000000000000000R201\ntype: page\ntitle: Hostitel\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}`

const STATUSES = [
  { label: 'To do', color: 'gray', state: 'open' }, { label: 'In progress', color: 'blue', state: 'in-progress' }, { label: 'Waiting', color: 'yellow', state: 'open' },
  { label: 'Done', color: 'green', state: 'done' }, { label: 'Cancelled', color: 'red', state: 'cancelled' },
]
const TASK = {
  key: 'task', review: 'off',
  attributes: [
    { key: 'status', type: 'select', options: STATUSES },
    { key: 'priority', type: 'select', options: ['High', 'Medium', 'Low', 'None'].map((label) => ({ label, color: null })) },
    { key: 'due', type: 'date' }, { key: 'completed', type: 'date-time' }, { key: 'recurrence', type: 'recurrence' },
  ],
}
const PAGE = { key: 'page', review: 'off', attributes: [] }
const QUICK = { key: 'quick-note', review: 'locked', attributes: [] }

/** §11.2: the app's composition of the new object's bytes from the unit (values `tags`, `source`; a checked item
 *  into a Task gets the first Done-state status and `completed`). */
async function newBytes(type: Record<string, unknown>, o: { title: string; tags: string[]; body: string; checked: boolean | null }, source: string, template: string | null = null) {
  const m = await doc()
  const values: [string, unknown][] = []
  if (type.key === 'task' && o.checked === true) values.push(['status', 'Done'], ['completed', { datetime: NOW }])
  if (o.tags.length > 0) values.push(['tags', o.tags])
  values.push(['source', { link: source }])
  return m.newObject({ type, title: o.title, template, now: NOW, newId: () => ID, values, body: o.body }) as string
}

// ------------------------------------------------------------------------------------------------ FR-CNV-01 AC-4 (units)

test('fr_cnv_01_ac4_a_caret_converts_its_whole_block', async () => {
  const b = BLOKY()
  const u = await need(b, at(b, 'servisu'))
  assert.deepEqual(u, { kind: 'blocks', from: at(b, 'Zavolat do servisu'), to: end(b, 'a domluvit termín.'), count: 1, first: 'paragraph', checked: null }, 'the two-line paragraph')
  const q = await need(b, at(b, 'převedení'))
  assert.deepEqual(q, { kind: 'blocks', from: at(b, '> Citace'), to: end(b, '> Citace k převedení.'), count: 1, first: 'quote', checked: null }, 'a caret inside a quote converts the whole quote (AP-420)')
  const code = await need(b, at(b, 'kód();'))
  assert.deepEqual(code, { kind: 'blocks', from: at(b, '```js'), to: at(b, '```\n\n![[Zasedačka]]') + 3, count: 1, first: 'other', checked: null }, 'the whole fence')
  const e = await need(b, at(b, '![[Zasedačka]]') + 4)
  assert.deepEqual(e, { kind: 'blocks', from: at(b, '![[Zasedačka]]'), to: end(b, '![[Zasedačka]]'), count: 1, first: 'other', checked: null }, 'an embed block')
  const h = await need(b, at(b, 'podklady'))
  assert.deepEqual(h, { kind: 'blocks', from: at(b, '## Připravit'), to: end(b, '## Připravit podklady'), count: 1, first: 'heading', checked: null }, 'a heading')
})

test('fr_cnv_01_ac4_a_selection_over_two_blocks_converts_both', async () => {
  const b = BLOKY()
  const u = await need(b, at(b, 'Připravit') + 2, at(b, 'Odstavec pod') + 4)
  assert.deepEqual(u, { kind: 'blocks', from: at(b, '## Připravit'), to: end(b, 'Odstavec pod nadpisem.'), count: 2, first: 'heading', checked: null }, 'heading and paragraph: 2 blocks')
  // A text selection inside two paragraphs converts the whole blocks it touches (AP-423).
  const t = await need(b, at(b, 'Úvodní odstavec.') + 7, at(b, 'servisu'))
  assert.deepEqual(t, { kind: 'blocks', from: at(b, 'Úvodní'), to: end(b, 'a domluvit termín.'), count: 2, first: 'paragraph', checked: null }, 'partial text selection → whole blocks')
})

test('fr_cnv_01_ac4_list_items_and_nested_items', async () => {
  const b = BLOKY()
  const o = await need(b, at(b, 'projektor'))
  assert.deepEqual(o, { kind: 'items', from: at(b, '- [ ] Objednat'), to: end(b, '  - porovnat nabídky'), count: 1, first: 'item', checked: false }, 'a top-level item with its nested items')
  const v = await need(b, at(b, 'nářadí'))
  assert.deepEqual(v, { kind: 'items', from: at(b, '- [x] Vrátit'), to: end(b, '- [x] Vrátit nářadí'), count: 1, first: 'item', checked: true }, 'a checked item')
  const run = await need(b, at(b, 'lepidlo'), at(b, 'Vrátit') + 2)
  assert.equal(run.kind, 'items')
  assert.deepEqual([run.from, run.to, run.first, run.checked], [at(b, '- [ ] Koupit'), end(b, '- [x] Vrátit nářadí'), 'item', false], 'a run of two items')
  assert.ok([2, 1].includes(run.count), `summary count of a run of two items: 2 (AP-453 recommendation) or 1 (AP-453 b), got ${run.count}`)
  const n = await need(b, at(b, 'zjistit'))
  assert.deepEqual(n, { kind: 'nested-item', from: at(b, '  - zjistit cenu'), to: end(b, '  - zjistit cenu'), count: 1, first: 'item', checked: null }, 'a nested item alone')
  const d = await need(b, at(b, 'Druhý'))
  assert.deepEqual(d, { kind: 'items', from: at(b, '2. Druhý bod'), to: end(b, '2. Druhý bod'), count: 1, first: 'item', checked: null }, 'a numbered item')
})

test('fr_cnv_01_ac4_no_unit_in_the_frontmatter_or_on_blank_lines', async () => {
  const b = BLOKY()
  assert.notEqual(await unitAt(b, at(b, 'servisu')), null, 'a paragraph gives a unit (guard: the helper is built)')
  assert.equal(await unitAt(b, at(b, 'title: Bloky') + 3), null, 'in the frontmatter')
  assert.equal(await unitAt(b, end(b, 'Úvodní odstavec.\n')), null, 'on a blank line between blocks')
})

// ------------------------------------------------------------------------------------------------ FR-CNV-02 (title, body)

test('fr_cnv_02_ac1_paragraph_with_two_lines_splits_into_title_and_body', async () => {
  const b = BLOKY()
  const o = await obj(b, await need(b, at(b, 'servisu')))
  assert.deepEqual(o, { title: 'Zavolat do servisu kvůli kolu', tags: [], body: 'a domluvit termín.\n', checked: null })
})

test('fr_cnv_02_ac2_heading_and_paragraph', async () => {
  const b = BLOKY()
  const o = await obj(b, await need(b, at(b, 'Připravit'), at(b, 'Odstavec pod')))
  assert.deepEqual(o, { title: 'Připravit podklady', tags: [], body: 'Odstavec pod nadpisem.\n', checked: null })
  // A run of paragraphs: the rest follows byte for byte; lines with `\n`.
  const two = await obj(b, await need(b, at(b, 'Úvodní'), at(b, 'servisu')))
  assert.deepEqual(two, { title: 'Úvodní odstavec.', tags: [], body: 'Zavolat do servisu kvůli kolu\na domluvit termín.\n', checked: null })
})

test('fr_cnv_02_ac3_checklist_item_with_children_and_markup', async () => {
  const b = BLOKY()
  const o = await obj(b, await need(b, at(b, 'projektor')))
  assert.equal(o.title, 'Objednat nový projektor pro Zasedačka', 'plain text: formatting dropped, the link as its title (AP-421)')
  assert.deepEqual(o.tags, ['práce'], 'the trailing tag goes to tags')
  assert.equal(o.body, 'Objednat **nový** projektor pro [[Zasedačka]]\n\n- zjistit cenu\n- porovnat nabídky\n', 'the line with the link is kept; children de-indented')
  assert.equal(o.checked, false)
  assert.equal(
    await newBytes(TASK, o, 'Bloky'),
    `---\nid: ${ID}\ntype: task\ntitle: Objednat nový projektor pro Zasedačka\nstatus: To do\ntags: [práce]\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\nObjednat **nový** projektor pro [[Zasedačka]]\n\n- zjistit cenu\n- porovnat nabídky\n`,
    'the new task file',
  )
})

test('fr_cnv_02_ac3_link_alias_unresolved_link_and_several_trailing_tags', async () => {
  const t1 = host('- [ ] Rezervovat [[Zasedačka|velký sál]] na pátek #práce #Doma #PRÁCE\n')
  const o1 = await obj(t1, await need(t1, at(t1, 'Rezervovat')))
  assert.deepEqual(o1, { title: 'Rezervovat velký sál na pátek', tags: ['práce', 'Doma'], body: 'Rezervovat [[Zasedačka|velký sál]] na pátek\n', checked: false }, 'alias as text; trailing tags unique by key, first spelling')
  const t2 = host('Přečíst [[C tips]] a zavolat [[Nikdo]]\n')
  const o2 = await obj(t2, await need(t2, at(t2, 'Přečíst')))
  assert.deepEqual(o2, { title: 'Přečíst C# tips a zavolat Nikdo', tags: [], body: 'Přečíst [[C tips]] a zavolat [[Nikdo]]\n', checked: null }, "the target's title, else the target as written")
})

test('fr_cnv_02_ac4_checklist_items_one_action', async () => {
  const b = BLOKY()
  const k = await obj(b, await need(b, at(b, 'lepidlo')))
  assert.deepEqual(k, { title: 'Koupit lepidlo', tags: [], body: '', checked: false })
  assert.equal(await newBytes(TASK, k, 'Bloky'), `---\nid: ${ID}\ntype: task\ntitle: Koupit lepidlo\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, '[ ] → To do (AP-400), empty body')
  const v = await obj(b, await need(b, at(b, 'nářadí')))
  assert.deepEqual(v, { title: 'Vrátit nářadí', tags: [], body: '', checked: true })
  assert.equal(
    await newBytes(TASK, v, 'Bloky'),
    `---\nid: ${ID}\ntype: task\ntitle: Vrátit nářadí\nstatus: Done\ncompleted: ${NOW}\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`,
    '[x] → the first Done-state status and completed now (AP-425)',
  )
  assert.equal(await newBytes(PAGE, v, 'Bloky'), `---\nid: ${ID}\ntype: page\ntitle: Vrátit nářadí\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'into a Page only the title: no check state')
  // A run of items: the items after the first stay list items with their markers.
  const run = await obj(b, await need(b, at(b, 'lepidlo'), at(b, 'nářadí')))
  assert.deepEqual([run.title, run.body], ['Koupit lepidlo', '- [x] Vrátit nářadí\n'], 'the second item keeps its marker')
})

test('fr_cnv_02_ac5_blocks_without_text_first', async () => {
  const b = BLOKY()
  const code = await obj(b, await need(b, at(b, 'kód();')))
  assert.deepEqual(code, { title: '', tags: [], body: '```js\nkód();\n```\n', checked: null }, 'empty title; the fence byte for byte')
  const e = await obj(b, await need(b, at(b, '![[Zasedačka]]') + 3))
  assert.deepEqual(e, { title: '', tags: [], body: '![[Zasedačka]]\n', checked: null }, 'the embed byte for byte')
  // The title the user types in R50 is passed to newObject; the body is the same (FR-CNV-02 AC-6).
  assert.equal(await newBytes(PAGE, { ...code, title: 'Skript' }, 'Bloky'), `---\nid: ${ID}\ntype: page\ntitle: Skript\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n\`\`\`js\nkód();\n\`\`\`\n`)
})

test('fr_cnv_02_ac7_nfd_text_gives_an_nfc_title', async () => {
  const n = F('Pages/NFD host.md')
  assert.ok(n.includes(nfd('Úkol v NFD')) && !n.includes(nfc('Úkol v NFD')), 'fixture guard: the paragraph is in NFD bytes')
  const o = await obj(n, await need(n, at(n, nfd('Úkol v NFD')) + 2))
  assert.equal(o.title, nfc('Úkol v NFD'), 'title in NFC')
  assert.equal(o.title.length, 'Úkol v NFD'.normalize('NFC').length, 'NFC length')
  assert.equal(o.body, '')
  const r = await embed(n, await need(n, at(n, nfd('Úkol v NFD'))), 'Úkol v NFD')
  assert.equal(r.text, sw(n, nfd('Úkol v NFD'), nfc('![[Úkol v NFD]]')), 'the embed in NFC; Před. and Po. keep their bytes')
})

test('fr_cnv_02_ac1_r51_quote_and_callout_titles', async () => {
  const b = BLOKY()
  const q = await obj(b, await need(b, at(b, 'Citace')))
  assert.deepEqual(q, { title: 'Citace k převedení.', tags: [], body: '', checked: null })
  const t = host('> [!note]\n> První řádek výzvy\n> druhý řádek\n')
  const c = await need(t, at(t, 'druhý'))
  assert.deepEqual([c.from, c.to, c.first], [at(t, '> [!note]'), end(t, '> druhý řádek'), 'callout'], 'a caret inside a callout converts the whole callout')
  const co = await obj(t, c)
  assert.equal(co.title, 'První řádek výzvy', 'the first line of the text, without the [!type] line')
  assert.equal(co.body, '> [!note]\n> druhý řádek\n', 'the rest as a callout')
})

// ------------------------------------------------------------------------------------------------ FR-CNV-03 (bytes, text)

test('fr_cnv_03_ac1_the_new_task_bytes', async () => {
  const b = BLOKY()
  const o = await obj(b, await need(b, at(b, 'servisu')))
  assert.equal(
    await newBytes(TASK, o, 'Bloky'),
    `---\nid: ${ID}\ntype: task\ntitle: Zavolat do servisu kvůli kolu\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\na domluvit termín.\n`,
    'FR-CNV-03 AC-1 exactly',
  )
  assert.equal(
    await newBytes(QUICK, o, 'Bloky'),
    `---\nid: ${ID}\ntype: quick-note\ntitle: Zavolat do servisu kvůli kolu\nsource: "[[Bloky]]"\nreview: unreviewed\ncreated: ${NOW}\nmodified: ${NOW}\n---\na domluvit termín.\n`,
    'a Quick Note: its review rule, the same source',
  )
  assert.equal(
    await newBytes(PAGE, o, 'Bloky'),
    `---\nid: ${ID}\ntype: page\ntitle: Zavolat do servisu kvůli kolu\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\na domluvit termín.\n`,
    'a Page',
  )
})

test('fr_cnv_03_ac1_a_template_contributes_its_frontmatter_the_converted_blocks_are_the_body', async () => {
  // AP-452 is open: the recommendation (the template's body is not used) and (b) (template body first) both keep the
  // converted blocks as the end of the body and the template's frontmatter entries; (c) ignores the template.
  const b = BLOKY()
  const o = await obj(b, await need(b, at(b, 'servisu')))
  const tpl = '---\nstatus: Waiting\n---\nKroky:\n'
  const out = await newBytes(TASK, o, 'Bloky', tpl)
  const head = `---\nid: ${ID}\ntype: task\ntitle: Zavolat do servisu kvůli kolu\n`
  const withTpl = `${head}status: Waiting\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`
  const ignored = `${head}status: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`
  const allowed = [`${withTpl}a domluvit termín.\n`, `${withTpl}Kroky:\na domluvit termín.\n`, `${withTpl}Kroky:\n\na domluvit termín.\n`, `${ignored}a domluvit termín.\n`]
  assert.ok(allowed.includes(out), `a template with a body (AP-452): got\n${out}`)
})

test('fr_cnv_03_ac2_the_source_text_with_the_embed', async () => {
  const b = BLOKY()
  const r = await embed(b, await need(b, at(b, 'servisu')), 'Zavolat do servisu kvůli kolu')
  const want = sw(b, 'Zavolat do servisu kvůli kolu\na domluvit termín.', '![[Zavolat do servisu kvůli kolu]]')
  assert.equal(r.text, want, 'lines 3–4 of the body replaced, every other byte identical')
  assert.equal(r.text.slice(r.embedFrom, r.embedTo), '![[Zavolat do servisu kvůli kolu]]', 'embedFrom / embedTo name the embed line')
  const two = await embed(b, await need(b, at(b, 'Připravit'), at(b, 'Odstavec pod')), 'Připravit podklady')
  assert.equal(two.text, sw(b, '## Připravit podklady\n\nOdstavec pod nadpisem.', '![[Připravit podklady]]'), 'two blocks, one embed paragraph')
  const q = await embed(b, await need(b, at(b, 'Citace')), 'Citace k převedení')
  assert.equal(q.text, sw(b, '> Citace k převedení.', '![[Citace k převedení]]'), 'the whole quote')
})

test('fr_cnv_03_ac2_the_embed_paragraph_is_separated_by_one_blank_line', async () => {
  const t = host('## Nadpis\nOdstavec bez mezery.\n## Další\n')
  const r = await embed(t, await need(t, at(t, 'bez mezery')), 'Odstavec bez mezery')
  assert.equal(r.text, sw(t, '## Nadpis\nOdstavec bez mezery.\n## Další\n', '## Nadpis\n\n![[Odstavec bez mezery]]\n\n## Další\n'))
})

test('fr_cnv_03_ac3_cut_out_of_a_list', async () => {
  const b = BLOKY()
  const o = await embed(b, await need(b, at(b, 'projektor')), 'Objednat nový projektor pro Zasedačka')
  assert.equal(
    o.text,
    sw(b, '- [ ] Objednat **nový** projektor pro [[Zasedačka]] #práce\n  - zjistit cenu\n  - porovnat nabídky\n- [ ] Rezervovat sál', '\n![[Objednat nový projektor pro Zasedačka]]\n\n- [ ] Rezervovat sál'),
    'the list splits around a top-level embed paragraph; the item lines keep their bytes',
  )
  assert.equal(o.text.slice(o.embedFrom, o.embedTo), '![[Objednat nový projektor pro Zasedačka]]')
  const d = await embed(b, await need(b, at(b, 'Druhý')), 'Druhý bod')
  assert.equal(d.text, sw(b, '1. První bod\n2. Druhý bod\n3. Třetí bod', '1. První bod\n\n![[Druhý bod]]\n\n3. Třetí bod'), 'a numbered list keeps its numbers')
  const k = await embed(b, await need(b, at(b, 'lepidlo')), 'Koupit lepidlo (2)')
  assert.equal(k.text, sw(b, '- [ ] Koupit lepidlo\n- [x] Vrátit', '![[Koupit lepidlo (2)]]\n\n- [x] Vrátit'), 'the first item: the embed before the list')
  const z = await embed(b, await need(b, at(b, 'Rezervovat')), 'Rezervovat sál')
  assert.equal(z.text, sw(b, '  - porovnat nabídky\n- [ ] Rezervovat sál\n', '  - porovnat nabídky\n\n![[Rezervovat sál]]\n'), 'the last item: the embed after the list')
  const run = await embed(b, await need(b, at(b, 'lepidlo'), at(b, 'nářadí')), 'Koupit lepidlo (2)')
  assert.equal(run.text, sw(b, '- [ ] Koupit lepidlo\n- [x] Vrátit nářadí\n- [ ] Objednat', '![[Koupit lepidlo (2)]]\n\n- [ ] Objednat'), 'a run of items, one embed')
})

test('fr_cnv_03_ac4_nested_item_is_replaced_in_place', async () => {
  const b = BLOKY()
  const r = await embed(b, await need(b, at(b, 'zjistit')), 'zjistit cenu')
  assert.equal(r.text, sw(b, '  - zjistit cenu\n', '  - ![[zjistit cenu]]\n'), 'the parent item and the sibling keep their bytes')
  const line = r.text.slice(r.embedFrom, r.embedTo)
  assert.ok(['  - ![[zjistit cenu]]', '![[zjistit cenu]]'].includes(line), `embedFrom / embedTo name the embed line, got ${JSON.stringify(line)}`)
})

test('fr_cnv_03_ac9_crlf_host_keeps_crlf_and_the_missing_final_newline', async () => {
  const c = F('Pages/CRLF host.md')
  assert.ok(c.includes('\r\n') && !c.endsWith('\n'), 'fixture guard: CRLF, no final newline')
  const r = await embed(c, await need(c, at(c, 'Úkol s CRLF')), 'Úkol s CRLF')
  assert.equal(r.text, sw(c, 'Úkol s CRLF', '![[Úkol s CRLF]]'))
  const last = await embed(c, await need(c, at(c, 'Poslední.')), 'Poslední')
  assert.equal(last.text, sw(c, 'Poslední.', '![[Poslední]]'), 'no final newline stays none')
  assert.deepEqual(await obj(c, await need(c, at(c, 'Úkol s CRLF'))), { title: 'Úkol s CRLF', tags: [], body: '', checked: null })
  const t = host('- [ ] A\n- [ ] Bé s čárkou\nřádek dva\n- [ ] C').replace(/\n/g, '\r\n')
  const s = await embed(t, await need(t, at(t, 'Bé')), 'Bé s čárkou')
  assert.equal(s.text, sw(t, '- [ ] A\r\n- [ ] Bé s čárkou\r\nřádek dva\r\n- [ ] C', '- [ ] A\r\n\r\n![[Bé s čárkou]]\r\n\r\n- [ ] C'), 'new lines get CRLF too')
  const so = await obj(t, await need(t, at(t, 'Bé')))
  assert.equal(so.body, 'řádek dva\n', 'the new file uses \\n')
})

test('fr_cnv_03_ac9_host_without_frontmatter_and_with_bom', async () => {
  const h = F('Pages/Bez hlavičky host.md')
  const r = await embed(h, await need(h, at(h, 'Úkol bez')), 'Úkol bez hlavičky')
  assert.equal(r.text, '![[Úkol bez hlavičky]]\n\nKonec.\n', 'the text helper adds no frontmatter (the save does, D-54)')
  const bom = '﻿' + BLOKY()
  const u = await need(bom, at(bom, 'servisu'))
  const rb = await embed(bom, u, 'Zavolat do servisu kvůli kolu')
  assert.equal(rb.text, sw(bom, 'Zavolat do servisu kvůli kolu\na domluvit termín.', '![[Zavolat do servisu kvůli kolu]]'), 'the BOM is kept')
})
