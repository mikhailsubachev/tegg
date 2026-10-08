// AR-06 AC-3 / FR-IMP-23: local-only run against the real exports in `test exports/`.
// Skipped when the folder is absent (CI). PRIVACY: prints counts and file indexes only,
// never names, titles or content.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import yauzl from 'yauzl'
import { editBlock } from '../src/edit.js'
import { simulateEdit } from './fixtures.js'
import { wikilinks, tags } from '../src/links.js'
import { decode, encode, parse, type Doc } from '../src/parse.js'

const DIR = join(import.meta.dirname, '../../../test exports')
const zips = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.zip')) : []

interface Entry { name: string; bytes: Buffer }

function readMarkdownEntries(path: string): Promise<{ entries: Entry[]; total: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, strictFileNames: false }, (err, zip) => {
      if (err || !zip) return reject(err)
      const entries: Entry[] = []
      let total = 0
      zip.on('entry', (e: yauzl.Entry) => {
        total++
        if (!e.fileName.endsWith('.md')) return zip.readEntry()
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            entries.push({ name: e.fileName, bytes: Buffer.concat(chunks) })
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve({ entries, total }))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

describe.skipIf(zips.length === 0)('AR-06 AC-3 real exports (local only, counts only)', () => {
  test.each(zips.map((z, i) => [`export #${i + 1}`, z] as const))('ar_06_ac3_real_export_roundtrip: %s', async (label, zip) => {
    const { entries, total } = await readMarkdownEntries(join(DIR, zip))
    const c = {
      zipEntries: total, markdown: entries.length, nonUtf8: 0, crashed: 0, roundtripFailed: 0,
      frontmatterInvalid: 0, frontmatterUnclosed: 0, nonNfcNames: 0, longNameComponents: 0,
      blockEdits: 0, blockEditFailed: 0,
    }
    const failing: number[] = []
    entries.forEach((e, i) => {
      if (e.name !== e.name.normalize('NFC')) c.nonNfcNames++
      if (e.name.split('/').some((part) => Buffer.byteLength(part) > 200)) c.longNameComponents++
      let text: string
      try { text = decode(e.bytes) } catch { c.nonUtf8++; failing.push(i); return }
      try {
        const doc = parse(text)
        if (!Buffer.from(encode(doc.text)).equals(e.bytes)) { c.roundtripFailed++; failing.push(i) }
        if (doc.frontmatter?.error) c.frontmatterInvalid++
        if (doc.frontmatterWarning) c.frontmatterUnclosed++
        // FR-FMT-07 AC-3 on real content: edit up to 20 blocks per file, one at a time.
        doc.blocks.slice(0, 20).forEach((b, k) => {
          if (b.kind === 'raw') return
          const md = simulateEdit(b.node, b.raw)
          if (md === null) return
          c.blockEdits++
          const after = parse(editBlock(doc, k, md))
          const sig = (d: Doc) => JSON.stringify([
            wikilinks(d).map((l) => [l.embed, l.target, l.subpath, l.alias]),
            tags(d).map((t) => t.name),
          ])
          const ok =
            after.blocks.length === doc.blocks.length &&
            after.blocks.every((x, j) => j === k || x.raw === doc.blocks[j].raw) &&
            after.blocks[k].kind === doc.blocks[k].kind &&
            sig(after) === sig(doc)
          if (!ok) { c.blockEditFailed++; if (!failing.includes(i)) failing.push(i) }
        })
      } catch { c.crashed++; failing.push(i) }
    })
    console.log(`${label}:`, JSON.stringify(c), failing.length ? `failing file indexes: ${failing.slice(0, 30).join(',')}` : '')
    expect(c.nonUtf8 + c.crashed + c.roundtripFailed).toBe(0)
    expect(c.blockEditFailed).toBe(0)
  }, 120_000)
})
