// Real exports through the editor (local only; skipped when `test exports/` is absent).
// PRIVACY: prints counts and file indexes only, never names, titles or content (D-50, R-10).
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import yauzl from 'yauzl'
import { decode } from '@core/parse'
import { reconcile } from '../src/sourceDoc'
import { endOfBlock, expectPreserved, open } from './helpers'

const DIR = join(import.meta.dirname, '../../../test exports')
// Runs only when the owner asks for it (`npm run test:real` sets TEGG_REAL_EXPORTS=1, D-62):
// normal test runs and gates never read the real exports, even when the folder exists.
const zips = process.env.TEGG_REAL_EXPORTS === '1' && existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.zip')) : []

function markdownEntries(path: string): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, strictFileNames: false }, (err, zip) => {
      if (err || !zip) return reject(err)
      const out: Buffer[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('.md')) return zip.readEntry()
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => { out.push(Buffer.concat(chunks)); zip.readEntry() })
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

describe.skipIf(zips.length === 0)('real exports through the editor (counts only)', () => {
  test.each(zips.map((z, i) => [`export #${i + 1}`, z] as const))('real_export_editor_roundtrip_and_typing: %s', async (label, zip) => {
    const files = await markdownEntries(join(DIR, zip))
    const c = { notes: files.length, uneditedNotIdentical: 0, crashed: 0, editableBlocks: 0, readOnlyFallbacks: 0, typingEdits: 0, typingFailed: 0, refused: 0 }
    const failing: number[] = []
    const t0 = performance.now()
    files.forEach((bytes, i) => {
      try {
        const text = decode(bytes)
        const s = open(text)
        c.editableBlocks += s.loaded.doc.blocks.filter((b) => b.kind !== 'raw').length
        c.readOnlyFallbacks += s.loaded.rawFallbacks
        if (reconcile(s.loaded, s.editor.state.doc).text !== text) { c.uneditedNotIdentical++; failing.push(i) }
        // Type in up to 20 blocks, each in a fresh editor, and check the invariant.
        const n = Math.min(20, s.editor.state.doc.childCount)
        for (let k = 0; k < n; k++) {
          const t = open(text)
          const node = t.editor.state.doc.child(k)
          const pos = endOfBlock(t.editor, k)
          if (pos === null || node.type.name === 'rawBlock') continue
          t.editor.chain().command(({ tr, state }) => { tr.insert(pos, state.schema.text(' edited')); return true }).run()
          c.typingEdits++
          try {
            expectPreserved(t, reconcile(t.loaded, t.editor.state.doc).text, `file ${i} block ${k}`)
          } catch (e) {
            if ((e as Error).message.includes('refused')) c.refused++
            else c.typingFailed++
            if (!failing.includes(i)) failing.push(i)
          }
        }
      } catch {
        c.crashed++
        failing.push(i)
      }
    })
    const ms = Math.round(performance.now() - t0)
    console.log(`${label}:`, JSON.stringify(c), `(${ms} ms)`, failing.length ? `failing file indexes: ${failing.slice(0, 30).join(',')}` : '')
    expect(c.uneditedNotIdentical + c.crashed + c.typingFailed + c.refused).toBe(0)
  }, 600_000)
})
