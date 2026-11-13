// Slice I1, L1 at @tegg/doc: the three import ops (docs/contracts/v1-import.md §7.1, §7.4, §8; D-1534, D-1551):
// `importScan` (the one reader of links, numbers, invisible characters), `importNote` (source note → object file) and
// `importNew` (media objects, the report Page), also through `transform` with the ops `import-scan`, `import-note`,
// `import-new`. Criteria: docs/acceptance/import-capacities.md FR-IMP-10 AC-7, AC-9, AC-12; FR-IMP-15 AC-6;
// FR-IMP-17 AC-4; FR-IMP-16 AC-1; FR-IMP-19 AC-8 (layout). Inputs: tests/fixtures/import/capacities/; expected bytes:
// tests/fixtures/import/capacities-expected/. The report is rendered with catalog KEYS as its words (`⟦key⟧`), never
// with English text: the wording marked † in contract §5.3 is not decided. Written from the criteria, the contract and
// the fixtures only (D-61). The functions are read from the package's index at run time, so a missing export is an
// assertion failure (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as doc from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const src = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/import/capacities', rel), 'utf8')
const want = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/import/capacities-expected', rel), 'utf8')
const D = doc as unknown as Record<string, any>
function fn<T extends (...a: any[]) => any>(name: string): T {
  assert.equal(typeof D[name], 'function', `@tegg/doc exports ${name} (v1-import §7.1)`)
  return D[name] as T
}
type Link = { n: number; line: number; place: any; form: string; written: string; target: string; external: boolean; text: string; simplified: boolean; inside: number | null; aliasSafe: boolean; inTable: boolean }
type Scan = { frontmatter: any; links: Link[]; numbers: { key: string; item: number | null; raw: string }[]; nested: string[]; invisible: { u200b: number; ufeff: number; u200c: number; u200d: number }; crlf: boolean }
const scan = (t: string) => fn<(t: string) => Scan>('importScan')(t)
const note = (source: string, text: string, spec: unknown) => fn<(s: string, t: string, spec: unknown) => string>('importNote')(source, text, spec)
const fresh = (source: string, spec: unknown) => fn<(s: string, spec: unknown) => string>('importNew')(source, spec)
/** The link whose source text is `written` (asserted present, once). */
function link(s: Scan, written: string): Link {
  const hits = s.links.filter((l) => l.written === written)
  assert.equal(hits.length, 1, `one scanned link written ${JSON.stringify(written)}: ${JSON.stringify(s.links.map((l) => l.written))}`)
  return hits[0]
}
const NOW = '2026-11-12T10:00:00+01:00'
const fmOf = (id: string, type: string, title: string, mid: [string, unknown][], path: string, created = NOW, modified = NOW): [string, unknown][] =>
  [['id', id], ['type', type], ['title', title], ...mid, ['import-id', `capacities:PKM/${path}`], ['created', { datetime: created }], ['modified', { datetime: modified }]]

const TVARY = 'c22-link-shapes/PKM/Pages/Tvary odkazů.md'
const DEST = '(../Pages/C%C3%ADl.md)'
const W = {
  image: `[![logo](https://example.com/logo.png)]${DEST}`,
  inner: '![logo](https://example.com/logo.png)',
  lines: `[první řádek\ndruhý řádek]${DEST}`,
  brackets: `[viz [poznámka] zde]${DEST}`,
  bold: `[**tučný** cíl]${DEST}`,
  web: '[příklad](https://example.com/)',
}

// ------------------------------------------------------------------------------------------------ importScan

test('fr_imp_10_ac7_import_scan_finds_the_six_links_outside_code', () => {
  const s = scan(src(TVARY))
  assert.deepEqual(s.links.map((l) => l.written), [W.image, W.inner, W.lines, W.brackets, W.bold, W.web], 'exactly 6 links, in document order; none from the code span or the fenced block')
  assert.deepEqual(s.links.map((l) => l.form), ['markdown', 'image', 'markdown', 'markdown', 'markdown', 'markdown'], 'forms')
  assert.deepEqual(s.links.map((l) => l.external), [false, true, false, false, false, true], 'the remote image and the web link are external')
  for (const w of [W.image, W.lines, W.brackets, W.bold]) assert.equal(link(s, w).target, '../Pages/Cíl.md', `${w}: the destination percent-decoded, NFC`)
  assert.equal(link(s, W.inner).inside, link(s, W.image).n, 'the image is inside the first link')
  assert.equal(link(s, W.image).inside, null, 'the outer link is inside nothing')
  assert.deepEqual([W.image, W.lines, W.brackets, W.bold].map((w) => link(s, w).text), ['logo', 'první řádek druhý řádek', 'viz [poznámka] zde', 'tučný cíl'], 'plain text: alt, line break as one space, brackets kept, formatting removed')
  assert.deepEqual([W.image, W.lines, W.brackets, W.bold].map((w) => link(s, w).simplified), [true, false, false, true], 'simplified: the image link and the bold link only (D-1533)')
  assert.deepEqual([W.image, W.lines, W.brackets, W.bold].map((w) => link(s, w).aliasSafe), [true, true, false, true], 'aliasSafe is false only for text with brackets (D-1552)')
  assert.equal(link(s, W.image).line, 7, 'line is 1-based with the frontmatter lines counted')
  assert.ok(s.links.every((l) => l.place === 'body' && l.inTable === false), 'all in the body, none in a table')
  assert.deepEqual(s.links.map((l) => l.n), [...s.links.map((l) => l.n)].sort((a, b) => a - b), 'n rises in document order')
  assert.equal(new Set(s.links.map((l) => l.n)).size, 6, 'n is unique')
  assert.deepEqual(s.frontmatter, { ok: true }, 'the frontmatter is valid')
})

test('fr_imp_10_ac7_import_scan_reads_parentheses_wikilinks_and_frontmatter_values', () => {
  const s = scan(src('c10-duplicate-titles/PKM/People/Tomáš.md'))
  assert.deepEqual(s.links.map((l) => [l.form, l.target]), [['markdown', '../Meetings/Tomáš  Eva (1).md'], ['wikilink', 'Tomáš : Eva']], 'unencoded parentheses stay in the destination (F1)')
  const fm = scan(src('c11-file-names/PKM/Meetings/11 2026-03-19 Jana.md'))
  assert.deepEqual(fm.links.map((l) => [l.form, l.target, l.place, l.written]), [['wikilink', 'Jana', { frontmatter: { key: 'peopleInvolved' } }, '[[Jana]]']], 'a frontmatter string value holding a link is a link, place frontmatter')
  const idea = scan(src('c02-typed-frontmatter/PKM/Ideas/Idea.md'))
  assert.deepEqual(idea.links, [], 'links inside a code span and a fenced block are not links')
  // §6.5's "no" rows: autolink, bare URL, reference link, HTML, escaped brackets, a bare URL as a frontmatter value.
  const no = scan('---\ntype: Page\ntitle: Ne\nurl: https://example.com/x\n---\n\n<https://example.com> a https://example.com/y\n\n[text][ref] a \\[\\[Cíl]]\n\n[ref]: https://example.com/z\n\n<a href="x.md">x</a>\n\n$$[[Cíl]]$$ %%[[Cíl]]%%\n')
  assert.deepEqual(no.links.map((l) => l.written), [], 'none of §6.5\'s "no" constructs is counted')
  const broken = scan(src('c02-typed-frontmatter/PKM/Pages/Broken frontmatter.md'))
  assert.equal(broken.frontmatter.ok, false, 'broken YAML is reported')
  assert.equal(broken.frontmatter.line, 3, 'with the 1-based line of the error')
})

test('fr_imp_10_ac7_import_scan_keeps_number_characters_and_names_nested_values', () => {
  const s = scan('---\ntype: Book\ntitle: Čísla\npages: 0123\nprice: 1.50\nbig: 9007199254740993\nlist: [1, 2.0]\nmap:\n  a: 1\ntext: |\n  řádek\n---\n')
  const raw = Object.fromEntries(s.numbers.filter((x) => x.item === null).map((x) => [x.key, x.raw]))
  assert.deepEqual(raw, { pages: '0123', price: '1.50', big: '9007199254740993' }, 'numbers travel as their source characters (§7.1)')
  assert.deepEqual([...s.nested].sort(), ['list', 'map', 'text'], 'a map, a list of non-strings and a block scalar are nested values')
})

test('fr_imp_17_ac4_import_scan_counts_invisible_characters_outside_code', () => {
  const s = scan(src('c17-invisible-chars/PKM/Pages/Plan.md'))
  assert.deepEqual(s.invisible, { u200b: 3, ufeff: 1, u200c: 0, u200d: 0 }, 'three U+200B (title, two in the body), the BOM; the ZWJ of 👩‍💻 is not counted')
  assert.equal(s.crlf, false, 'LF file')
  const code = scan('---\ntype: Page\ntitle: Kód\n---\n\nVen​ `uvnitř​` ‌\n\n```\nblok​﻿\n```\n')
  assert.deepEqual(code.invisible, { u200b: 1, ufeff: 0, u200c: 1, u200d: 0 }, 'characters inside a code span and a fenced block are not counted')
  assert.equal(scan('---\r\ntype: Page\r\ntitle: A\r\n---\r\n\r\nText.\r\n').crlf, true, 'CRLF is reported')
})

// ------------------------------------------------------------------------------------------------ importNote

function tvarySpec(s: Scan) {
  return {
    frontmatter: fmOf('01JB5V00000000000000000002', 'page', 'Tvary odkazů', [['tags', []]], 'Pages/Tvary odkazů.md'),
    links: [W.image, W.lines, W.brackets, W.bold].map((w) => ({ n: link(s, w).n, do: 'link', toPath: 'Pages/Cíl.md', shown: link(s, w).text })),
    paths: ['Pages/Cíl.md', 'Pages/Tvary odkazů.md'],
  }
}

test('fr_imp_10_ac9_import_note_changes_only_link_spans_and_never_code', () => {
  const text = src(TVARY)
  const out = note('Pages/Tvary odkazů.md', text, tvarySpec(scan(text)))
  assert.equal(out, want('c22-link-shapes/Pages/Tvary odkazů.md'), 'the written note, byte for byte (capacities-expected/c22-link-shapes)')
  assert.ok(out.includes('[[Cíl|první řádek druhý řádek]]') && out.includes('[[Cíl|tučný cíl]]') && out.includes('[[Cíl|logo]]'), 'three wikilinks with the plain text as the alias')
  assert.ok(out.includes('[viz [poznámka] zde](Cíl.md)'), 'text with brackets stays a Markdown link, only its destination rewritten (D-1552)')
  assert.ok(out.includes('V kódu: `[[Cíl]]` a `[x](../Pages/C%C3%ADl.md)`\n\n```\n[[Cíl]]\n[x](../Pages/C%C3%ADl.md)\n```\n'), 'the code span and the fenced block are byte-identical')
})

test('fr_imp_10_ac12_import_note_leaves_unlisted_and_external_links_alone', () => {
  const text = src(TVARY)
  const s = scan(text)
  const out = note('Pages/Tvary odkazů.md', text, { ...tvarySpec(s), links: [] })
  assert.equal(out.slice(out.indexOf('\n---\n') + 5), text.slice(text.indexOf('\n---\n') + 5), 'with no LinkEdit the body is byte-identical')
  const one = note('Pages/Tvary odkazů.md', text, tvarySpec(s))
  assert.ok(one.includes('Web: [příklad](https://example.com/) zůstává.\n'), 'the external link is byte-identical')
  assert.ok(!one.includes('https://example.com/logo.png'), 'the external image inside a rewritten link is dropped with it (AC-9, D-1533)')
  const web = src('c06-weblinks/PKM/Weblinks/Rust book.md')
  const w = note('Pages/Rust book.md', web, {
    frontmatter: fmOf('01JB5V00000000000000000002', 'page', 'Rust book', [['description', 'The book'], ['url', 'https://example.com/a-very-long-article-url-that-capacities-folds-into-multiple-lines-of-yaml'], ['topic', 'Programming'], ['tags', []]], 'Weblinks/Rust book.md'),
    links: [], paths: [],
  })
  assert.ok(w.includes('\nurl: https://example.com/a-very-long-article-url-that-capacities-folds-into-multiple-lines-of-yaml\n'), 'the folded URL is one line (FR-IMP-24 AC-3)')
  assert.ok(w.endsWith('---\n\n[[Reading list]]\n'), 'an unlisted wikilink stays as written')
})

test('fr_imp_10_ac9_import_note_link_edit_forms', () => {
  // date, embed, drop, text, D-184 path form, a table cell's escaped separator (§8 rules 2, 4, 6, 8; FR-IMP-14 AC-2, AC-4).
  const text = '---\ntype: Page\ntitle: Formy\nstav: \'[[rozpracováno]]\'\n---\n\n[[Date/2026-02-03]] ![Map](../Images/Media/Mapa%20%C5%99eky.jpeg) ![Náhled](./Media/pryč.png) [[Plán]]\n\n| A |\n| --- |\n| [[Plán\\|úkol]] |\n'
  const s = scan(text)
  const by = (w: string) => link(s, w).n
  const out = note('Pages/Formy.md', text, {
    frontmatter: [['id', '01JB5V00000000000000000001'], ['type', 'page'], ['title', 'Formy'], ['stav', 'rozpracováno'], ['created', { datetime: NOW }], ['modified', { datetime: NOW }]],
    links: [
      { n: by('[[Date/2026-02-03]]'), do: 'date', date: '2026-02-03' },
      { n: by('![Map](../Images/Media/Mapa%20%C5%99eky.jpeg)'), do: 'embed', file: 'Mapa řeky (2).jpeg' },
      { n: by('![Náhled](./Media/pryč.png)'), do: 'drop' },
      { n: by('[[Plán]]'), do: 'link', toPath: 'Tasks/Plán.md', shown: 'Plán' },
      { n: by('[[Plán\\|úkol]]'), do: 'link', toPath: 'Tasks/Plán.md', shown: 'úkol' },
    ],
    paths: ['Pages/Plán.md', 'Tasks/Plán.md', 'Pages/Formy.md'],
  })
  assert.equal(out, `---\nid: 01JB5V00000000000000000001\ntype: page\ntitle: Formy\nstav: rozpracováno\ncreated: ${NOW}\nmodified: ${NOW}\n---\n\n[[2026-02-03]] ![[Mapa řeky (2).jpeg]]  [[Tasks/Plán|Plán]]\n\n| A |\n| --- |\n| [[Tasks/Plán\\|úkol]] |\n`, 'date link, embed with the planned file name, dropped reference, D-184 path form, \\| in a table cell')
})

test('fr_imp_15_ac6_import_note_frontmatter_shape', () => {
  const out = note('Pages/Garden plan.md', src('c15-common-attributes/PKM/Pages/Garden plan.md'), {
    frontmatter: fmOf('01JB5V00000000000000000001', 'page', 'Garden plan', [['description', 'Beds and paths'], ['aliases', ['Garden']], ['icon', '🌱'], ['tags', []]], 'Pages/Garden plan.md', '2026-01-05T09:00:00+01:00', '2026-03-05T18:30:00+01:00'),
    links: [], paths: [],
  })
  assert.equal(out, want('c15-common-attributes/Pages/Garden plan.md'), 'capacities-expected/c15-common-attributes, byte for byte')
  const task = note('Tasks/Prepare budget review.md', src('c12-task-dates/PKM/Tasks/Prepare budget review.md'), {
    frontmatter: fmOf('01JB5V00000000000000000003', 'task', 'Prepare budget review', [['status', 'Done'], ['due', { date: '2026-02-09' }], ['completed', { datetime: '2026-04-23T17:11:34+02:00' }], ['tags', []]], 'Tasks/Prepare budget review.md'),
    links: [], paths: [],
  })
  assert.equal(task, want('c12-task-dates/Tasks/Prepare budget review.md'), 'capacities-expected/c12-task-dates, byte for byte')
  // Values: a multi-line description and one with ": " or "#" round-trip to the same string; numbers bare; a link; no key twice.
  const tricky = ['První řádek\ndruhý řádek', 'Poznámka: s dvojtečkou # a mříží', '100']
  const shaped = note('Books/Kniha.md', '---\ntype: Book\ntitle: Kniha\n---\nText.\n', {
    frontmatter: [['id', '01JB5V00000000000000000001'], ['type', 'book'], ['title', 'Kniha'], ['description', tricky[0]], ['podtitul', tricky[1]], ['pages-text', tricky[2]], ['pages', { raw: '0123' }], ['cena', { raw: '1.50' }], ['finished', false],
      ['autor', { link: 'Jana' }], ['lidé', { links: ['Jana', 'Tomáš'] }], ['seznam', ['Jana', 'Eva']], ['tags', []], ['created', { datetime: NOW }], ['modified', { datetime: NOW }]],
    links: [], paths: [],
  })
  const parsed = D.parse(shaped)
  const value = (k: string) => parsed.frontmatter?.entries?.find((e: any) => e.key === k)?.value
  assert.deepEqual([value('description'), value('podtitul'), value('pages-text')], tricky, 'strings round-trip to the same string, quoted only as YAML needs')
  for (const line of ['pages: 0123', 'cena: 1.50', 'finished: false', 'autor: "[[Jana]]"', 'lidé: ["[[Jana]]", "[[Tomáš]]"]', 'seznam: [Jana, Eva]', 'tags: []']) assert.ok(shaped.includes(`\n${line}\n`), `the line ${line}`)
  const keys = shaped.slice(4, shaped.indexOf('\n---\n')).split('\n').filter((l) => /^[^\s:#-][^:]*:/.test(l)).map((l) => l.slice(0, l.indexOf(':')))
  assert.deepEqual(keys, ['id', 'type', 'title', 'description', 'podtitul', 'pages-text', 'pages', 'cena', 'finished', 'autor', 'lidé', 'seznam', 'tags', 'created', 'modified'], 'the keys in the spec\'s order, none twice')
  assert.ok(shaped.endsWith('---\nText.\n'), 'the body is kept')
  assert.equal(D.serialize(D.parse(shaped)), shaped, 'open and save changes 0 bytes (FR-FMT-07)')
})

test('fr_imp_15_ac6_import_note_copies_nested_values_as_stored', () => {
  const text = '---\ntype: Book\ntitle: Kniha\nrozměry:\n  šířka: 10 # cm\n  výška: 20\npopis: |\n  první\n  druhý\n---\nText.\n'
  const out = note('Books/Kniha.md', text, {
    frontmatter: [['id', '01JB5V00000000000000000001'], ['type', 'book'], ['title', 'Kniha'], ['rozměry', { asStored: 'rozměry' }], ['popis-text', { asStored: 'popis' }], ['created', { datetime: NOW }], ['modified', { datetime: NOW }]],
    links: [], paths: [],
  })
  assert.equal(out, `---\nid: 01JB5V00000000000000000001\ntype: book\ntitle: Kniha\nrozměry:\n  šířka: 10 # cm\n  výška: 20\npopis-text: |\n  první\n  druhý\ncreated: ${NOW}\nmodified: ${NOW}\n---\nText.\n`, 'the value text is copied byte for byte under the target key (§7.1)')
})

test('fr_imp_17_ac4_import_note_removes_invisible_characters_but_never_in_code', () => {
  const plan = note('Pages/Plan.md', src('c17-invisible-chars/PKM/Pages/Plan.md'), {
    frontmatter: fmOf('01JB5V00000000000000000001', 'page', 'Plan', [['tags', []]], 'Pages/Plan.md'), links: [], paths: [],
  })
  assert.equal(plan, `---\nid: 01JB5V00000000000000000001\ntype: page\ntitle: Plan\ntags: []\nimport-id: capacities:PKM/Pages/Plan.md\ncreated: ${NOW}\nmodified: ${NOW}\n---\n\nPlan: flights, hotel. Coder 👩‍💻 stays.\n`, 'BOM and U+200B removed, the 👩‍💻 sequence byte-identical')
  const text = '---\r\ntype: Page\r\ntitle: Kód\r\n---\r\n\r\nVen​ `uvnitř​` ‌\r\n\r\n```\r\nblok​﻿\r\n```\r\n'
  const out = note('Pages/Kód.md', text, { frontmatter: [['id', '01JB5V00000000000000000001'], ['type', 'page'], ['title', 'Kód']], links: [], paths: [] })
  assert.equal(out, '---\nid: 01JB5V00000000000000000001\ntype: page\ntitle: Kód\n---\n\nVen `uvnitř​` \n\n```\nblok​﻿\n```\n', 'code keeps its invisible characters; CRLF becomes LF everywhere, code included')
})

test('fr_imp_16_ac1_import_note_writes_a_query_stub', () => {
  const line = 'The query definition was not exported.'
  const out = note('Pages/Open tasks.md', src('c07-query-shells/PKM/Queries/Open tasks.md'), {
    frontmatter: fmOf('01JB5V00000000000000000002', 'page', 'Open tasks', [['description', 'Tasks not done'], ['tags', ['needs-rebuilding']]], 'Queries/Open tasks.md'),
    links: [], paths: [], stub: { note: line },
  })
  assert.equal(out, `---\nid: 01JB5V00000000000000000002\ntype: page\ntitle: Open tasks\ndescription: Tasks not done\ntags: [needs-rebuilding]\nimport-id: capacities:PKM/Queries/Open tasks.md\ncreated: ${NOW}\nmodified: ${NOW}\n---\n${line}\n\n\`\`\`query\n\`\`\`\n`, 'the note line, a blank line and an empty query fence')
  const fences = fn<(t: string) => { body: string; saved: string | null }[]>('queryFences')(out)
  assert.deepEqual(fences.map((f) => [f.body.trim(), f.saved]), [['', null]], 'one empty query fence (queries.md R140 "Empty")')
})

// ------------------------------------------------------------------------------------------------ importNew

test('fr_imp_14_ac6_import_new_writes_a_media_object', () => {
  const out = fresh('Images/Untitled (44).md', { kind: 'media', frontmatter: [['id', '01JB5V00000000000000000004'], ['type', 'image'], ['title', 'Untitled (44)'], ['file', { link: 'Untitled (44).png' }], ['import-id', 'capacities:PKM/Images/Media/Untitled (44).png'], ['created', { datetime: NOW }], ['modified', { datetime: NOW }]], file: 'Untitled (44).png' })
  assert.equal(out, `---\nid: 01JB5V00000000000000000004\ntype: image\ntitle: Untitled (44)\nfile: "[[Untitled (44).png]]"\nimport-id: capacities:PKM/Images/Media/Untitled (44).png\ncreated: ${NOW}\nmodified: ${NOW}\n---\n![[Untitled (44).png]]\n`, 'frontmatter as given, body the embed of the file (as 6A\'s mediaObject)')
})

/** Catalog keys as the report's words: `⟦key⟧`, under both spellings of the key (with and without `import.report.`). */
function keyStrings(): Record<string, string> {
  const keys = ['section.summary', 'section.types', 'section.unresolved', 'section.ambiguous', 'section.caseLinks', 'section.simplified', 'section.attributes', 'section.merged', 'section.dates', 'section.files', 'section.stubs', 'section.skipped', 'section.cleanup', 'section.notExported',
    'summary.source', 'summary.space', 'summary.date', 'summary.objects', 'summary.attachments', 'summary.links', 'summary.imported', 'summary.reported', 'summary.total', 'noUndo',
    'reason.notInExport', 'reason.otherSpace', 'reason.targetNotImported', 'reason.missingFile', 'reason.inSkippedNote', 'word.new', 'word.confirmed', 'word.leftUnresolved', 'word.notImported',
    'attr.renamed', 'attr.dropped', 'attr.new', 'attr.notCreated', 'attr.selectValues', 'attr.valueNotInOptions', 'attr.splitUnmatched', 'attr.asStored', 'key.reserved', 'key.invalidKey', 'key.keyTaken', 'key.rangeClash',
    'date.unreadable', 'date.importTime', 'file.droppedReference', 'file.unreferenced', 'file.genericName', 'name.reserved', 'name.empty', 'name.cut', 'name.suffix', 'name.characters',
    'skip.yaml', 'skip.noType', 'skip.notUtf8', 'skip.read', 'skip.encrypted', 'skip.engine', 'skip.badName', 'skip.traversal', 'skip.tagCollection', 'skip.csv', 'skip.dotfile', 'skip.outsideSpace', 'skip.unreadableEntry', 'skip.type',
    'cleanup.crlf', 'notExported.queries', 'notExported.tags', 'notExported.comments', 'type.noDay']
  const out: Record<string, string> = {}
  for (const k of keys) { const text = k === 'reason.otherSpace' ? '⟦reason.otherSpace {space}⟧' : `⟦${k}⟧`; out[k] = text; out[`import.report.${k}`] = text }
  return out
}
const tally = (imported: number, reported: number) => ({ total: imported + reported, imported, reported })
function reportData(over: Record<string, unknown> = {}) {
  return {
    summary: { source: 'c09-unresolved-links', space: 'PKM', date: '2026-11-12', objects: tally(3, 0), attachments: tally(0, 0), links: tally(2, 5), backup: null },
    types: [{ sourceType: 'DailyNote', objects: 1, target: 'Daily Note', new: false }, { sourceType: 'Trip', objects: 2, target: 'Trip', new: true }],
    unresolved: [
      { note: 'DailyNotes/2026-02-01.md', n: 1, written: '[[NOTE/3f2c9a1e-0000-4000-8000-000000000001]]', reason: { kind: 'notInExport' } },
      { note: 'Trips/Lisbon.md', n: 1, written: '[Missing](../Pages/Gone.md)', reason: { kind: 'otherSpace', space: 'Work' } },
    ],
    ambiguous: [], caseLinks: [], simplified: [], attributes: [], merged: [], dates: [], files: [], stubs: [], skipped: [],
    cleanup: { u200b: 0, ufeff: 0, u200c: 0, u200d: 0, crlfFiles: 0 },
    notExported: ['queryDefinitions', 'tagColoursAndCollections', 'comments'],
    ...over,
  }
}
const REPORT_FM: [string, unknown][] = [['id', '01JB5V00000000000000000004'], ['type', 'page'], ['title', 'Import report 2026-11-12 PKM'], ['created', { datetime: NOW }], ['modified', { datetime: NOW }]]
const report = (data: unknown, paths = ['Daily/2026-02-01.md', 'Trips/Lisbon.md', 'Trips/Oslo.md'], objects?: Record<string, string>) =>
  fresh('Pages/Import report 2026-11-12 PKM.md', { kind: 'report', frontmatter: REPORT_FM, data, strings: keyStrings(), paths, ...(objects ? { objects } : {}) })
const rows = (text: string) => text.split('\n').filter((l) => l.startsWith('- '))
const heads = (text: string) => text.split('\n').filter((l) => l.startsWith('## '))

test('fr_imp_19_ac8_import_new_report_layout', () => {
  const out = report(reportData())
  assert.ok(out.startsWith(`---\nid: 01JB5V00000000000000000004\ntype: page\ntitle: Import report 2026-11-12 PKM\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`), 'a Page with an id and no import-id')
  assert.ok(!out.includes('import-id'), 'no import-id')
  assert.deepEqual(heads(out), ['## ⟦section.summary⟧', '## ⟦section.types⟧', '## ⟦section.unresolved⟧', '## ⟦section.notExported⟧'], 'R150\'s sections in order, empty ones left out')
  assert.deepEqual(rows(out), [
    '- ⟦summary.source⟧ · `c09-unresolved-links`',
    '- ⟦summary.space⟧ · PKM',
    '- ⟦summary.date⟧ · 2026-11-12',
    '- ⟦summary.objects⟧ · 3 ⟦summary.imported⟧ · 0 ⟦summary.reported⟧ · 3 ⟦summary.total⟧',
    '- ⟦summary.attachments⟧ · 0 ⟦summary.imported⟧ · 0 ⟦summary.reported⟧ · 0 ⟦summary.total⟧',
    '- ⟦summary.links⟧ · 2 ⟦summary.imported⟧ · 5 ⟦summary.reported⟧ · 7 ⟦summary.total⟧',
    '- DailyNote · 1 · Daily Note',
    '- Trip · 2 · Trip · ⟦word.new⟧',
    '- [[2026-02-01]] · `[[NOTE/3f2c9a1e-0000-4000-8000-000000000001]]` · ⟦reason.notInExport⟧',
    '- [[Lisbon]] · `[Missing](../Pages/Gone.md)` · ⟦reason.otherSpace Work⟧',
    '- ⟦notExported.queries⟧',
    '- ⟦notExported.tags⟧',
    '- ⟦notExported.comments⟧',
  ], 'every row: "- " and its fields joined by " · " (§5.3); objects as wikilinks in D-184 form, quoted text in code spans, words from the catalog')
  assert.ok(out.includes('## ⟦section.summary⟧\n\n- ⟦summary.source⟧'), 'a section is its heading, a blank line, then the rows')
  assert.ok(out.endsWith('- ⟦notExported.comments⟧\n'), 'one final newline')
  assert.ok(!/\[\[NOTE\//.test(out.replace(/`[^`\n]*`/g, '')), 'a link text quoted from the source is only inside a code span: the report adds no link to a missing target')
  assert.equal(D.serialize(D.parse(out)), out, 'open and save changes 0 bytes (FR-FMT-07)')
})

test('fr_imp_19_ac8_import_new_report_every_section_and_row_kind', () => {
  const data = reportData({
    summary: { source: 'export', space: 'PKM', date: '2026-11-12', objects: tally(1240, 3), attachments: tally(2, 1), links: tally(10, 4), backup: '20261112-090000-import.zip' },
    types: [{ sourceType: 'Person', objects: 2, target: null, new: false }],
    unresolved: [{ note: 'Pages/Pryč.md', n: 1, written: 'kód `s` zpětnými ``apostrofy``', reason: { kind: 'inSkippedNote' } }, { note: 'Trips/Lisbon.md', n: 2, written: '`začíná`', reason: { kind: 'missingFile' } }, { note: 'Trips/Lisbon.md', n: 3, written: '[[Tomáš]]', reason: { kind: 'targetNotImported' } }],
    ambiguous: [{ note: 'Trips/Lisbon.md', n: 4, title: 'Oslo', chosen: 'Trips/Oslo.md' }],
    caseLinks: [{ note: 'Trips/Lisbon.md', n: 5, written: '[[oslo]]', candidate: 'Trips/Oslo.md', confirmed: true }, { note: 'Trips/Oslo.md', n: 1, written: '[[lisbon]]', candidate: 'Trips/Lisbon.md', confirmed: false }],
    simplified: [{ note: 'Trips/Lisbon.md', n: 6, written: '[**tučný** cíl](Oslo.md)', kept: 'tučný cíl' }],
    attributes: [
      { sourceType: 'Idea', sourceKey: 'source', change: { kind: 'renamed', key: 'source-text', reason: 'reserved' } },
      { sourceType: 'Image', sourceKey: 'mimeType', change: { kind: 'dropped', values: 3 } },
      { sourceType: 'Book', sourceKey: 'author', change: { kind: 'new', key: 'author', type: 'text' } },
      { sourceType: 'Book', sourceKey: 'prázdný', change: { kind: 'notCreated', nulls: 6 } },
      { sourceType: 'Trip', sourceKey: 'status', change: { kind: 'selectValues', values: 2 } },
      { sourceType: 'Task', sourceKey: 'priority', change: { kind: 'valueNotInOptions', value: 'HIgh', objects: 1 } },
      { sourceType: 'Task', sourceKey: 'people', change: { kind: 'splitUnmatched', value: 'Eva', objects: 1 } },
      { sourceType: 'Book', sourceKey: 'rozměry', change: { kind: 'asStored', values: 1 } },
    ],
    merged: [{ sourceType: 'Task', key: 'priority', variants: ['HIgh', 'High'], kept: 'High' }],
    dates: [{ kind: 'unreadable', note: 'Trips/Oslo.md', key: 'date', value: 'Jun 26' }, { kind: 'importTime', objects: 3 }],
    files: [
      { source: 'Trips/Lisbon.md', change: { kind: 'droppedReference', n: 7, written: '![Preview](./Media/Manual%20preview.png)' } },
      { source: 'Images/Media/Untitled (44).png', change: { kind: 'unreferenced' } },
      { source: 'Images/Media/image (3).png', change: { kind: 'genericName', name: 'Whiteboard sketch 1.png' } },
      { source: 'Trips/Oslo.md', change: { kind: 'nameChanged', name: 'CON_.md', reasons: ['reserved', 'suffix'] } },
    ],
    stubs: [{ note: 'Trips/Oslo.md' }],
    skipped: [
      { kind: 'note', source: 'Pages/Broken frontmatter.md', reason: 'yaml', line: 3 },
      { kind: 'attachment', source: 'Images/Media/x.png', reason: 'read' },
      { kind: 'entry', entry: '#', reason: 'traversal' },
      { kind: 'type', sourceType: 'Person', objects: 2 },
    ],
    cleanup: { u200b: 3, ufeff: 1, u200c: 0, u200d: 0, crlfFiles: 2 },
  })
  // The report spec's `objects` map (v1-import §7.4): each row's source path → the planned vault path of its object, so
  // rows link to renamed and suffixed objects. `Pages/` holds notes with the same stems as the two Image objects, so
  // from the report's folder their links take the path form (D-184 with the folder).
  const out = report(data, ['Trips/Lisbon.md', 'Trips/Oslo.md', 'Images/Untitled (44).md', 'Images/Whiteboard sketch.md', 'Pages/Untitled (44).md', 'Pages/Whiteboard sketch.md'], {
    'Trips/Lisbon.md': 'Trips/Lisbon.md', 'Trips/Oslo.md': 'Trips/Oslo.md',
    'Images/Media/Untitled (44).png': 'Images/Untitled (44).md', 'Images/Media/image (3).png': 'Images/Whiteboard sketch.md',
  })
  assert.deepEqual(heads(out), ['summary', 'types', 'unresolved', 'ambiguous', 'caseLinks', 'simplified', 'attributes', 'merged', 'dates', 'files', 'stubs', 'skipped', 'cleanup', 'notExported'].map((k) => `## ⟦section.${k}⟧`), 'the fourteen sections of R150, in its order')
  const want = [
    '- ⟦summary.objects⟧ · 1240 ⟦summary.imported⟧ · 3 ⟦summary.reported⟧ · 1243 ⟦summary.total⟧', // plain digits, no grouping (§7.4)
    '- Person · 2 · ⟦word.notImported⟧',
    '- `Pages/Pryč.md` · ```kód `s` zpětnými ``apostrofy`` ``` · ⟦reason.inSkippedNote⟧', // a note that isn't imported: its source path in a code span; a backtick run longer than any in the text
    '- [[Lisbon]] · `` `začíná` `` · ⟦reason.missingFile⟧', // padding spaces when the text starts or ends with a backtick
    '- [[Lisbon]] · `[[Tomáš]]` · ⟦reason.targetNotImported⟧',
    '- [[Lisbon]] · `Oslo` · [[Oslo]]',
    '- [[Lisbon]] · `[[oslo]]` · [[Oslo]] · ⟦word.confirmed⟧',
    '- [[Oslo]] · `[[lisbon]]` · [[Lisbon]] · ⟦word.leftUnresolved⟧',
    '- [[Lisbon]] · `[**tučný** cíl](Oslo.md)` · `tučný cíl`',
    '- Idea · `source` · ⟦attr.renamed⟧ · `source-text` · ⟦key.reserved⟧',
    '- Image · `mimeType` · ⟦attr.dropped⟧ · 3',
    '- Book · `author` · ⟦attr.new⟧ · `author` · text',
    '- Book · `prázdný` · ⟦attr.notCreated⟧ · 6',
    '- Trip · `status` · ⟦attr.selectValues⟧ · 2',
    '- Task · `priority` · ⟦attr.valueNotInOptions⟧ · `HIgh` · 1',
    '- Task · `people` · ⟦attr.splitUnmatched⟧ · `Eva` · 1',
    '- Book · `rozměry` · ⟦attr.asStored⟧ · 1',
    '- Task · `priority` · `HIgh`, `High` · `High`',
    '- [[Oslo]] · `date` · `Jun 26` · ⟦date.unreadable⟧',
    '- ⟦date.importTime⟧ · 3',
    '- [[Lisbon]] · `![Preview](./Media/Manual%20preview.png)` · ⟦file.droppedReference⟧',
    '- [[Images/Untitled (44)|Untitled (44)]] · ⟦file.unreferenced⟧',
    '- [[Images/Whiteboard sketch|Whiteboard sketch]] · `image (3).png` · ⟦file.genericName⟧',
    '- [[Oslo]] · `CON_.md` · ⟦name.reserved⟧, ⟦name.suffix⟧',
    '- [[Oslo]]',
    '- `Pages/Broken frontmatter.md` · ⟦skip.yaml⟧ · 3',
    '- `Images/Media/x.png` · ⟦skip.read⟧',
    '- `#` · ⟦skip.traversal⟧',
    '- Person · ⟦skip.type⟧ · 2',
    '- U+200B · 3',
    '- U+FEFF · 1',
    '- ⟦cleanup.crlf⟧ · 2',
  ]
  const got = rows(out)
  for (const w of want) assert.ok(got.includes(w), `the row ${w}\n got:\n${got.join('\n')}`)
  assert.ok(!got.some((r) => r.startsWith('- U+200C') || r.startsWith('- U+200D')), 'no clean-up row for a count of 0')
  // FR-IMP-19 AC-12: after a backup, the Summary ends with the no-undo sentence and the zip's file name.
  const summary = out.slice(out.indexOf('## ⟦section.summary⟧'), out.indexOf('## ⟦section.types⟧'))
  assert.ok(summary.includes('\n\n⟦noUndo⟧ `20261112-090000-import.zip`\n'), 'a paragraph: import.report.noUndo, a space, the zip name in a code span')
  assert.ok(!report(reportData()).includes('⟦noUndo⟧'), 'without a backup the sentence is absent')
})

// ------------------------------------------------------------------------------------------------ transform dispatch

test('fr_imp_10_ac7_transform_dispatches_the_three_import_ops', () => {
  const text = src(TVARY)
  const r = D.transform('Pages/Tvary odkazů.md', text, [{ op: 'import-scan' }])
  assert.equal(r?.kind, 'bytes', 'import-scan answers bytes: the scan as JSON, never written to disk')
  let dto: Scan | null = null
  try { dto = JSON.parse(r.text) } catch { dto = null }
  assert.deepEqual(dto, scan(text), 'the JSON is importScan\'s answer')
  const spec = tvarySpec(scan(text))
  const n = D.transform('Pages/Tvary odkazů.md', text, [{ op: 'import-note', spec }])
  assert.deepEqual([n?.kind, n?.text], ['bytes', want('c22-link-shapes/Pages/Tvary odkazů.md')], 'import-note answers importNote\'s text')
  const media = { kind: 'media', frontmatter: [['id', '01JB5V00000000000000000004'], ['type', 'image'], ['title', 'Obrázek']], file: 'Obrázek.png' }
  const m = D.transform('Images/Obrázek.md', '', [{ op: 'import-new', spec: media }])
  assert.deepEqual([m?.kind, m?.text], ['bytes', '---\nid: 01JB5V00000000000000000004\ntype: image\ntitle: Obrázek\n---\n![[Obrázek.png]]\n'], 'import-new answers importNew\'s text')
})
