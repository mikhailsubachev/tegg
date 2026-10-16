// Regression for the PR #38 QA review: the instants of the D-319/D-335 winner rule are read alike in @tegg/doc (used
// by the fake core) and Rust (shared corpus tests/fixtures/format/dates/winner-instants.json).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { instantOf } from '../src/index.js'

const corpus = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../tests/fixtures/format/dates/winner-instants.json'), 'utf8')) as { cases: { value: string; kind: string; utcNanos?: string }[] }

test('bug_38_fr_dly_01_winner_instants_match_the_shared_corpus', () => {
  const bad = corpus.cases.filter((c) => {
    const got = instantOf(c.value)
    if (c.kind === 'instant') return !(got?.kind === 'instant' && got.nanos === BigInt(c.utcNanos!))
    if (c.kind === 'local') return got?.kind !== 'local'
    return got !== null
  }).map((c) => `${JSON.stringify(c.value)}: ${JSON.stringify(instantOf(c.value), (_, v) => (typeof v === 'bigint' ? String(v) : v))}`)
  assert.deepEqual(bad, [], 'instantOf differs from the corpus')
})
