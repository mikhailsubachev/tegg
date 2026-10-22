// MS6 slice 6A, L1: the `@tegg/doc` media twins (docs/acceptance/trash-media.md R72, R73; docs/contracts/
// ms6-trash-media.md §3.1, §3.3, §3.5; D-617). FR-ATT-01 AC-4 (names and titles: NFC, D-51 sanitizing, ` (2)` for a taken
// file name, the next free number for a generic name, capture titles, (TZ) via the pasted name's local time),
// AC-5 / AC-6 (`mediaInfo` by magic bytes on one fixture file per format; refused content), AC-1 (the object's bytes,
// §3.5, the twin table shared with crates/tegg-core/tests/ac_media.rs). Written from the ACs and the contract only
// (D-61). The module loads inside each test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const sample = (name: string) => new Uint8Array(readFileSync(resolve(REPO, 'tests/fixtures/media', name)))
const vaultFile = (rel: string) => new Uint8Array(readFileSync(resolve(REPO, 'tests/fixtures/vaults/trash-media', rel)))

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['mediaInfo', 'mediaNames', 'mediaObject', 'isGenericName', 'pastedImageName']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k} (ms6-trash-media §3)`)
  return m
}
const PNG = { mediaType: 'image/png', ext: 'png', width: 64, height: 48, pages: null }
const PDF = { mediaType: 'application/pdf', ext: 'pdf', width: null, height: null, pages: 2 }
const HEIC = { mediaType: 'image/heic', ext: 'heic', width: 40, height: 30, pages: null }
const req = (name: string, info: object, ownerTitle: string | null = 'Plán zahrady', o: Partial<{ date: string; attachments: string; folder: string }> = {}) =>
  ({ name, info, ownerTitle, date: o.date ?? '2026-10-22', attachments: o.attachments ?? '_attachments', folder: o.folder ?? ((info as any).mediaType === 'application/pdf' ? 'PDFs' : 'Images') })
/** The fixture's taken paths (case-insensitive), plus extras. */
function taken(...extra: string[]) {
  const set = new Set(['_attachments/záhon.png', '_attachments/Rozpočet.pdf', 'Images/Záhon.md', 'PDFs/Rozpočet.md', 'Pages/Plán zahrady.md', ...extra].map((p) => p.normalize('NFC').toLowerCase()))
  return (p: string) => set.has(p.normalize('NFC').toLowerCase())
}

// ------------------------------------------------------------------------------------------------ AC-4: R72, R73

test('fr_att_01_ac4_r72_names_and_titles', async () => {
  const { mediaNames } = await doc()
  const rows: [string, object, string | null, string, string, string][] = [
    ['Záhon 2.PNG', PNG, 'Plán zahrady', '_attachments/Záhon 2.PNG', 'Images/Záhon 2.md', 'Záhon 2'],
    ['Pasted image 20261022100000.png', PNG, 'Plán zahrady', '_attachments/Pasted image 20261022100000.png', 'Images/Plán zahrady 1.md', 'Plán zahrady 1'],
    ['image.png', PNG, 'Plán zahrady', '_attachments/image.png', 'Images/Plán zahrady 1.md', 'Plán zahrady 1'],
    ['IMG_1234.HEIC', HEIC, 'Plán zahrady', '_attachments/IMG_1234.HEIC', 'Images/Plán zahrady 1.md', 'Plán zahrady 1'],
    ['Screenshot 2026-10-22 at 10.00.00.png', PNG, 'Plán zahrady', '_attachments/Screenshot 2026-10-22 at 10.00.00.png', 'Images/Plán zahrady 1.md', 'Plán zahrady 1'],
    ['Rozpočet 2026.pdf', PDF, 'Plán zahrady', '_attachments/Rozpočet 2026.pdf', 'PDFs/Rozpočet 2026.md', 'Rozpočet 2026'],
    ['Pasted image 20261022100000.png', PNG, null, '_attachments/Pasted image 20261022100000.png', 'Images/Capture 2026-10-22 1.md', 'Capture 2026-10-22 1'],
  ]
  const bad: string[] = []
  for (const [name, info, owner, file, object, title] of rows) {
    const got = mediaNames(taken(), req(name, info, owner))
    const want = { file, object, title }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name} (${owner}): want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
  assert.deepEqual(bad, [], 'R72 rows')
})

test('fr_att_01_ac4_taken_names_numbers_nfc_and_sanitizing', async () => {
  const { mediaNames } = await doc()
  const p = 'Pasted image 20261022100000.png'
  assert.equal(mediaNames(taken(`_attachments/${p}`), req(p, PNG)).file, '_attachments/Pasted image 20261022100000 (2).png', 'the same second gets ` (2)`')
  assert.equal(mediaNames(taken('_attachments/záhon 2.png'), req('Záhon 2.PNG', PNG)).file, '_attachments/Záhon 2 (2).PNG', 'taken case-insensitively; the extension as given')
  assert.equal(mediaNames(taken('Images/Plán zahrady 1.md'), req(p, PNG)).object, 'Images/Plán zahrady 2.md', 'the next free number')
  assert.equal(mediaNames(taken('Images/Plán zahrady 1.md'), req(p, PNG)).title, 'Plán zahrady 2', 'the title follows')
  const nfd = 'Záhon 2.png'
  assert.equal(mediaNames(taken(), req(nfd, PNG)).file, '_attachments/Záhon 2.png'.normalize('NFC'), 'NFC')
  assert.deepEqual(mediaNames(taken(), req('Plán: jaro?.png', PNG)), { file: '_attachments/Plán jaro.png', object: 'Images/Plán jaro.md', title: 'Plán: jaro?' }, 'D-51 sanitizing changes paths only (§11, AP-556)')
  assert.equal(mediaNames(taken(), req('Obrázek', PNG)).file, '_attachments/Obrázek.png', 'no extension: MediaInfo.ext is added')
  const long = mediaNames(taken(), req(`${'Ř'.repeat(150)}.png`, PNG)).file.split('/').pop()!
  assert.ok(Buffer.byteLength(long, 'utf8') <= 200 && long.endsWith('.png'), `≤ 200 UTF-8 bytes keeping the extension: ${Buffer.byteLength(long)}`)
  assert.equal(mediaNames(taken(), req(p, PNG, 'Plán zahrady', { attachments: 'Přílohy' })).file, `Přílohy/${p}`, 'the attachments folder setting (AC-9)')
  assert.equal(mediaNames(taken('Images/Záhon 2.md'), req('Záhon 2.PNG', PNG)).object, 'Images/Záhon 2 (2).md', 'a non-generic object path taken gets ` (2)` (free-stem rule)')
})

test('fr_att_01_ac4_r73_generic_names', async () => {
  const { isGenericName } = await doc()
  const generic = ['image', 'IMG', 'Photo', 'picture', ' Screenshot ', 'untitled', 'scan', 'Document', 'file', 'download', 'IMG_1234', 'img-2026', 'DSC0001', 'DSCN 7', 'PXL_20261022_080000', 'photo 12', 'Screenshot 2026-10-22 at 10.00.00', 'Screen Shot 2026-10-22', 'Snímek obrazovky 2026-10-22', 'Bildschirmfoto 2026', 'Pasted image 20261022100000', '12345', '2026-10-22 10.00', '---']
  const named = ['Záhon 2', 'Rozpočet 2026', 'Images of spring', 'Dokument', 'Fotka zahrady', 'Scanner manual']
  assert.deepEqual(generic.filter((s) => !isGenericName(s)), [], 'R73 generic stems')
  assert.deepEqual(named.filter((s) => isGenericName(s)), [], 'not generic')
})

test('fr_att_01_ac4_pasted_image_name_uses_the_local_time', async () => {
  const { pastedImageName } = await doc()
  assert.equal(pastedImageName('2026-10-22T10:00:00', 'png'), 'Pasted image 20261022100000.png', 'Prague 10:00')
  assert.equal(pastedImageName('2026-10-22T01:00:00', 'png'), 'Pasted image 20261022010000.png', 'Los Angeles 01:00 (TZ)')
})

// ------------------------------------------------------------------------------------------------ AC-5, AC-6: §3.1

test('fr_att_01_ac5_media_info_per_format', async () => {
  const { mediaInfo } = await doc()
  const rows: [string, Uint8Array, object][] = [
    ['záhon.png', vaultFile('_attachments/záhon.png'), PNG],
    ['Rozpočet.pdf', vaultFile('_attachments/Rozpočet.pdf'), PDF],
    ['exif6.jpg (orientation 6 swaps)', sample('exif6.jpg'), { mediaType: 'image/jpeg', ext: 'jpg', width: 8, height: 16, pages: null }],
    ['plain.jpg', sample('plain.jpg'), { mediaType: 'image/jpeg', ext: 'jpg', width: 16, height: 8, pages: null }],
    ['anim.gif', sample('anim.gif'), { mediaType: 'image/gif', ext: 'gif', width: 3, height: 2, pages: null }],
    ['pixel.webp', sample('pixel.webp'), { mediaType: 'image/webp', ext: 'webp', width: 1, height: 1, pages: null }],
    ['header.heic', sample('header.heic'), HEIC],
    ['vektor.svg (viewBox)', sample('vektor.svg'), { mediaType: 'image/svg+xml', ext: 'svg', width: 120, height: 80, pages: null }],
    ['vektor-px.svg (width/height)', sample('vektor-px.svg'), { mediaType: 'image/svg+xml', ext: 'svg', width: 30, height: 20, pages: null }],
    ['tri-strany.pdf', sample('tri-strany.pdf'), { ...PDF, pages: 3 }],
  ]
  const bad = rows.filter(([, b, want]) => JSON.stringify(mediaInfo(b)) !== JSON.stringify(want)).map(([n, b, want]) => `${n}: want ${JSON.stringify(want)}, got ${JSON.stringify(mediaInfo(b))}`)
  assert.deepEqual(bad, [], 'by magic bytes (§3.1)')
  const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.deepEqual(mediaInfo(head), { mediaType: 'image/png', ext: 'png', width: null, height: null, pages: null }, 'unreadable metadata: media-type only')
})

test('fr_att_01_ac6_refused_content', async () => {
  const { mediaInfo } = await doc()
  assert.ok(mediaInfo(vaultFile('_attachments/záhon.png')), 'a real PNG is accepted')
  for (const n of ['text.png', 'empty.png', 'zprava.docx']) assert.equal(mediaInfo(sample(n)), null, `${n} is refused`)
  assert.equal(mediaInfo(new TextEncoder().encode('<html><svg></svg></html>')), null, 'HTML containing svg is not an SVG')
})

// ------------------------------------------------------------------------------------------------ AC-1: §3.5 bytes

test('fr_att_01_ac1_object_bytes_twin_table', async () => {
  const { mediaObject } = await doc()
  const table = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/media/objects.json'), 'utf8')) as { cases: { name: string; fields: any; bytes: string }[] }
  assert.equal(table.cases.length, 4, 'four cases')
  const bad = table.cases.filter((c) => mediaObject(c.fields) !== c.bytes).map((c) => `${c.name}: ${JSON.stringify(mediaObject(c.fields))}`)
  assert.deepEqual(bad, [], 'the bytes of §3.5 (key order, quoting, absent values omitted)')
})
