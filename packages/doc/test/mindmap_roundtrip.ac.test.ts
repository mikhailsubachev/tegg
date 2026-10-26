// Slice MM, L1: FR-FMT-07 AC-24 (a) at @tegg/doc (docs/acceptance/mindmap.md): every file of the mindmap fixture,
// parsed and serialized without edits, is byte-identical, including Z Obsidianu's tabs, Rozpoznání's ten callouts and
// the runtime CRLF (without a final newline) and NFD copies. The source-preserving engine (ADR 0001) already keeps
// these bytes; the test guards the slice's parser change (D-765). Written from the AC only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse, serialize } from '../src/index.js'

const REPO = resolve(import.meta.dirname, '../../..')
const ROOT = resolve(REPO, 'tests/fixtures/vaults/mindmap')

function files(dir: string): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...files(p))
    else if (n.endsWith('.md') && relative(ROOT, p) !== 'README.md') out.push(p)
  }
  return out.sort()
}

test('fr_fmt_07_ac24_a_every_fixture_file_round_trips_byte_identical', () => {
  const all = files(ROOT)
  assert.equal(all.length, 24, 'the 24 notes of the fixture (README excluded; slice MM2 added Pavouk, Neznámé metadata and Metadata)')
  const bad: string[] = []
  for (const p of all) {
    const text = readFileSync(p, 'utf8')
    const variants: [string, string][] = [
      ['as is', text],
      ['CRLF, no final newline', text.replace(/\n/g, '\r\n').replace(/\r\n$/, '')],
      ['NFD', text.normalize('NFD')],
    ]
    for (const [what, t] of variants) if (serialize(parse(t)) !== t) bad.push(`${relative(ROOT, p)} (${what})`)
  }
  assert.deepEqual(bad, [], 'parse + serialize without edits is the identity')
  const z = readFileSync(join(ROOT, 'Pages/Z Obsidianu.md'), 'utf8')
  assert.ok(z.includes('> \t- Větev s tabulátorem\n> \t\t- List'), 'fixture: Z Obsidianu keeps its tabs')
})
