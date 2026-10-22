// v0.52 feedback, L1: the cell split of tables the editor can't edit losslessly (docs/acceptance/editor.md FR-EDT-02
// AC-22, D-606, AP-528; docs/contracts/ms3-shell.md §16.4: `@tegg/doc` exports `tableCells(raw: string): { align:
// ('left'|'center'|'right'|null)[]; rows: string[][] }`, which splits rows on unescaped `|` outside `[[…]]`, backticks and
// HTML). Reading used here (see the red-test report): `rows` holds the header row then the body rows (the alignment row
// is `align`), each row's cells trimmed and not padded (the renderer pads short rows and extends the header).
// Written from the AC and the contract only (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'

type Cells = { align: ('left' | 'center' | 'right' | null)[]; rows: string[][] }
async function tableCells(raw: string): Promise<Cells> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Record<string, any>
  assert.equal(typeof m.tableCells, 'function', '@tegg/doc exports tableCells (ms3-shell §16.4)')
  return m.tableCells(raw) as Cells
}

test('fr_edt_02_ac22_a_wikilink_with_an_alias_is_one_cell_and_rows_keep_their_length', async () => {
  const raw = [
    '| # | Projekt | Skóre |',
    '| --- | --- | --- |',
    '| 1 | [[Projekty/Alfa|Alfa]] · [ALF-7](https://example.com/ALF-7) | 74 |',
    '| 2 | Beta | 58 | navíc |',
    '| 3 | Gama |',
  ].join('\n')
  const t = await tableCells(raw)
  assert.deepEqual(t.align, [null, null, null], 'no alignment')
  assert.deepEqual(t.rows, [
    ['#', 'Projekt', 'Skóre'],
    ['1', '[[Projekty/Alfa|Alfa]] · [ALF-7](https://example.com/ALF-7)', '74'],
    ['2', 'Beta', '58', 'navíc'],
    ['3', 'Gama'],
  ], 'the bare | inside [[…]] doesn\'t split the cell; the long and short rows keep their cells')
})

test('fr_edt_02_ac22_escaped_pipes_code_html_and_alignment', async () => {
  const raw = [
    '| Levý | Střed | Pravý |',
    '| :--- | :---: | ---: |',
    '| a \\| b | `x|y` | <span title="p|q">ž</span> |',
    '| [[Cíl|c]] a [[Druhý]] | ![[obrázek.png|200]] | 3 |',
  ].join('\n')
  const t = await tableCells(raw)
  assert.deepEqual(t.align, ['left', 'center', 'right'], 'alignment from the delimiter row')
  assert.deepEqual(t.rows, [
    ['Levý', 'Střed', 'Pravý'],
    ['a \\| b', '`x|y`', '<span title="p|q">ž</span>'],
    ['[[Cíl|c]] a [[Druhý]]', '![[obrázek.png|200]]', '3'],
  ], 'an escaped \\|, a | in backticks, in HTML and in an embed don\'t split')
})
