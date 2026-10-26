// Builds the synthetic vault for the owner's manual Obsidian checks of MS1 (FR-FMT-01 AC-3, FR-FMT-05 AC-3).
// Every note is written by the real engine (newNote / setDateRange), so Obsidian sees genuine Tegg output.
// Usage: node --import ./scripts/ts-resolve.mjs scripts/make-obsidian-check.ts <out dir>
import { mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { newNote, parse, setDateRange } from '../src/index.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: make-obsidian-check.ts <out dir>')
const now = '2026-10-11T09:30:00+02:00'
let n = 0
const newId = () => `01JAOBSIDIANCHECK${String(++n).padStart(9, '0')}`
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(out, rel)), { recursive: true })
  writeFileSync(join(out, rel), text)
}

cpSync(join(import.meta.dirname, '../../../tests/fixtures/vaults/new-empty/.tegg'), join(out, '.tegg'), { recursive: true })

write('Pages/Řeka.md', newNote({ type: 'Page', title: 'Řeka', body: 'Cíl relací.', now, newId }))
write('Pages/Jana.md', newNote({ type: 'Page', title: 'Jana', body: 'Cíl relací.', now, newId }))

// FR-FMT-01 AC-3: one attribute of each type.
const allTypes = newNote({
  type: 'Page',
  title: 'Všechny typy vlastností',
  attributes: [
    ['text', 'Žluťoučký kůň'],
    ['cislo', 42],
    ['desetinne', 3.5],
    ['zaskrtnuto', true],
    ['datum', { date: '2026-10-09' }],
    ['datum-a-cas', { datetime: '2026-10-09T14:30:00+02:00' }],
    ['seznam', ['jedna', 'dvě', 'tři']],
    ['vztah', { link: 'Řeka' }],
    ['vztahy', [{ link: 'Řeka' }, { link: 'Jana' }]],
  ],
  body: 'Každá vlastnost má v Obsidianu odpovídající typ (Text, Number, Checkbox, Date, Date & time, List).',
  now,
  newId,
})
write('Pages/Všechny typy vlastností.md', setDateRange(parse(allTypes), 'cesta', '2026-07-01', '2026-07-14'))

// FR-FMT-05 AC-3 (D-686): the mindmap is a `[!mindmap]` callout holding one list (title, one top-level item, two
// levels below it, a [[link]]); the query block stays a plain code block.
write(
  'Pages/Myšlenková mapa a dotaz.md',
  newNote({
    type: 'Page',
    title: 'Myšlenková mapa a dotaz',
    body: [
      '## Myšlenková mapa',
      '',
      '> [!mindmap] Řeka',
      '> - [[Řeka]]',
      '>   - Pramen',
      '>   - Přítoky',
      '>     - Vltava',
      '>     - Berounka',
      '>   - Ústí',
      '',
      '## Dotaz',
      '',
      '```query',
      'source: [task]',
      'filter:',
      '  - status: open',
      'sort: due',
      '```',
    ].join('\n'),
    now,
    newId,
  }),
)
// NFR-POR-01 AC-2 (slice MM2, D-791): the layout is Obsidian callout metadata, `[!mindmap|spider]`; Obsidian shows the
// callout as before and ignores the metadata.
write(
  'Pages/Pavouk.md',
  newNote({
    type: 'Page',
    title: 'Pavouk',
    body: ['> [!mindmap|spider] Pavouk', '> - Střed', '>   - Alfa', '>     - A1', '>     - A2', '>   - Beta', '>     - B1', '>   - Gama', '>   - Delta'].join('\n'),
    now,
    newId,
  }),
)
console.log(`wrote ${out}`)
