import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { extract } from '../src/extract.js'
import { fixtures } from './fixtures.js'

// S4-QA AC-4: the committed expected.json is the contract for the Rust extractor.
// Regenerate with UPDATE_EXTRACT=1 after an intended change to extraction.
const OUT = join(import.meta.dirname, '../../../tests/fixtures/format/extract/expected.json')

describe('extraction reference', () => {
  const actual = Object.fromEntries(
    fixtures.map((f) => [f.rel.normalize('NFC'), extract(f.text, basename(f.rel).replace(/\.md$/, ''))]),
  )
  const json = JSON.stringify(actual, null, 2) + '\n'

  test('s4_qa_ac4_expected_json_matches_typescript_reference', () => {
    if (process.env.UPDATE_EXTRACT || !existsSync(OUT)) {
      mkdirSync(join(OUT, '..'), { recursive: true })
      writeFileSync(OUT, json)
    }
    expect(readFileSync(OUT, 'utf8')).toBe(json)
  })
})
