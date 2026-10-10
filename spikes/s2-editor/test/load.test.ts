// FR-FMT-07 AC-1/AC-2 through the real editor: load every fixture into TipTap and save unedited.
import { describe, expect, test } from 'vitest'
import { reconcile } from '../src/sourceDoc'
import { fixtures, open } from './helpers'

describe('FR-FMT-07 through the editor', () => {
  test.each(fixtures.map((f) => [f.rel, f] as const))('s2_qa_ac1_unedited_open_save_is_byte_identical: %s', (_, f) => {
    const s = open(f.text)
    const r = reconcile(s.loaded, s.editor.state.doc)
    expect(r.changed).toBe(false)
    expect(r.text).toBe(f.text)
  })

  test('editor_fidelity_most_blocks_are_editable', () => {
    let blocks = 0
    let fallbacks = 0
    const perFile: string[] = []
    for (const f of fixtures) {
      const s = open(f.text)
      blocks += s.loaded.doc.blocks.filter((b) => b.kind !== 'raw').length
      fallbacks += s.loaded.rawFallbacks
      if (s.loaded.rawFallbacks) perFile.push(`${f.rel}: ${s.loaded.rawFallbacks}`)
    }
    console.log(`editable blocks shown read-only (lossy editor form): ${fallbacks} of ${blocks}`, perFile)
    expect(fallbacks / blocks).toBeLessThan(0.05)
  })
})
