// Regression (found by NFR-POR-01 AC-2, MS1): multi-line text values were written as an unindented
// block scalar, which is invalid YAML; the note's frontmatter was then refused for every later edit.
import { expect, test } from 'vitest'
import { parseDocument } from 'yaml'
import { newNote, parse, setAttribute } from '../src/index.js'

const now = '2026-10-11T09:30:00+02:00'
const newId = () => '01JAREGRESSION0000000000001'
const yamlOf = (text: string) => text.split('---\n')[1]

for (const value of ['řádek 1\nřádek 2', 'konec s novým řádkem\n', '  odsazený první řádek\ndruhý', 'a\n\nprázdný řádek uprostřed']) {
  test(`bug_ms1_fr_fmt_01_multiline_text_is_valid_yaml_and_reads_back: ${JSON.stringify(value)}`, () => {
    const text = newNote({ type: 'Page', title: 'Víceřádkový text', attributes: [['popis', value]], now, newId })
    const doc = parse(text)
    expect(doc.frontmatter?.error).toBe(null)
    expect(doc.frontmatter?.data?.popis).toBe(value)
    expect(parseDocument(yamlOf(text)).errors).toEqual([])

    const edited = setAttribute(parse('---\nid: x\n---\nTělo.\n'), 'popis', value)
    expect(parse(edited).frontmatter?.data?.popis).toBe(value)

    const inList = setAttribute(parse('---\nid: x\n---\n'), 'seznam', [value, 'druhá'])
    expect(parse(inList).frontmatter?.data?.seznam).toEqual([value, 'druhá'])
  })
}
