// Slice 6A (docs/contracts/ms6-trash-media.md §3.1, §3.3, §3.5; D-617): the TS twins of `tegg-core` `media6a.rs` for
// the fake core and the L1 tests: media metadata from the bytes (`mediaInfo`), names and titles of a new Image or PDF
// object (`mediaNames`, R72, R73) and the object's bytes (`mediaObject`). Rust and TS give identical results for the
// same inputs (L1 + L4 twin table).
import { formatScalar } from './edit.js'

/** §3.1: what the bytes are (R72's types only). */
export type MediaInfo = {
  mediaType: string
  /** The usual extension without the dot (`png`, `jpg`, `gif`, `webp`, `heic`, `svg`, `pdf`). */
  ext: string
  width: number | null
  height: number | null
  pages: number | null
}

const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
const starts = (b: Uint8Array, bytes: number[]) => bytes.every((x, i) => b[i] === x)

function find(b: Uint8Array, needle: string, from = 0): number {
  const n = [...needle].map((c) => c.charCodeAt(0))
  outer: for (let i = from; i + n.length <= b.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer
    return i
  }
  return -1
}

function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2
  let orientation = 1
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    const seg = b.subarray(Math.min(i + 4, b.length), Math.min(i + 2 + len, b.length))
    if (m === 0xe1 && ascii(seg, 0, 6) === 'Exif\0\0') orientation = exifOrientation(seg.subarray(6)) ?? 1
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && seg.length >= 5) {
      const h = (seg[1] << 8) | seg[2]
      const w = (seg[3] << 8) | seg[4]
      return orientation >= 5 && orientation <= 8 ? [h, w] : [w, h]
    }
    if (m === 0xda) return null
    i += 2 + len
  }
  return null
}

function exifOrientation(t: Uint8Array): number | null {
  const tag = ascii(t, 0, 2)
  if (tag !== 'II' && tag !== 'MM') return null
  const le = tag === 'II'
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : null)
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : be32(t, o)) : null)
  const ifd = u32(4)
  if (ifd === null) return null
  const n = u16(ifd)
  if (n === null) return null
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (u16(e) === 0x0112) return u16(e + 8)
  }
  return null
}

function webpSize(b: Uint8Array): [number, number] | null {
  const c = ascii(b, 12, 16)
  const d = b.subarray(20)
  if (c === 'VP8L' && d.length >= 5 && d[0] === 0x2f) {
    const bits = (d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] << 24)) >>> 0
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
  }
  if (c === 'VP8 ' && d.length >= 10) return [le16(d, 6) & 0x3fff, le16(d, 8) & 0x3fff]
  if (c === 'VP8X' && d.length >= 10) return [(d[4] | (d[5] << 8) | (d[6] << 16)) + 1, (d[7] | (d[8] << 8) | (d[9] << 16)) + 1]
  return null
}

function isHeic(b: Uint8Array): boolean {
  const size = Math.min(be32(b, 0), b.length)
  const brand = (i: number) => ['heic', 'heix', 'mif1', 'msf1'].includes(ascii(b, i, i + 4))
  if (brand(8)) return true
  for (let i = 16; i + 4 <= size; i += 4) if (brand(i)) return true
  return false
}

function pdfPages(b: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(b).split(/\s+/).join(' ')
  const i = text.indexOf('/Type /Pages')
  if (i >= 0) {
    const start = Math.max(0, text.lastIndexOf('<<', i))
    const endRel = text.indexOf('>>', start)
    const o = text.slice(start, endRel < 0 ? text.length : endRel)
    const m = /\/Count (\d+)/.exec(o)
    if (m) return Number(m[1])
  }
  const n = [...text.matchAll(/\/Type \/Page(?!s)/g)].length
  return n > 0 ? n : null
}

function svgRoot(b: Uint8Array): [number, number] | null | undefined {
  let s: string
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return undefined
  }
  s = s.replace(/^﻿/, '').trimStart()
  for (;;) {
    if (s.startsWith('<?')) { const k = s.indexOf('?>'); if (k < 0) return undefined; s = s.slice(k + 2).trimStart() }
    else if (s.startsWith('<!--')) { const k = s.indexOf('-->'); if (k < 0) return undefined; s = s.slice(k + 3).trimStart() }
    else if (s.startsWith('<!')) { const k = s.indexOf('>'); if (k < 0) return undefined; s = s.slice(k + 1).trimStart() }
    else break
  }
  if (!/^<svg[\s>/]/.test(s)) return undefined
  const tag = s.slice(4, s.indexOf('>') < 0 ? s.length : s.indexOf('>'))
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(tag)?.[2] ?? null
  const num = (v: string | null) => {
    if (v === null) return null
    const x = v.trim().replace(/px$/, '').trim()
    const n = Number(x)
    return x !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  const w = num(attr('width'))
  const h = num(attr('height'))
  if (w !== null && h !== null) return [w, h]
  const vb = attr('viewBox')?.split(/[\s,]+/).filter((x) => x !== '').map(Number)
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return [Math.round(vb[2]), Math.round(vb[3])]
  return null
}

/** §3.1: by magic bytes only; `null` = refused (`media.refused`). */
export function mediaInfo(b: Uint8Array): MediaInfo | null {
  const info = (mediaType: string, ext: string, wh: [number, number] | null): MediaInfo => ({ mediaType, ext, width: wh?.[0] ?? null, height: wh?.[1] ?? null, pages: null })
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return info('image/png', 'png', b.length >= 24 && ascii(b, 12, 16) === 'IHDR' ? [be32(b, 16), be32(b, 20)] : null)
  if (starts(b, [0xff, 0xd8, 0xff])) return info('image/jpeg', 'jpg', jpegSize(b))
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return info('image/gif', 'gif', b.length >= 10 ? [le16(b, 6), le16(b, 8)] : null)
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return info('image/webp', 'webp', webpSize(b))
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && isHeic(b)) {
    const i = find(b, 'ispe')
    return info('image/heic', 'heic', i >= 0 && b.length >= i + 16 ? [be32(b, i + 8), be32(b, i + 12)] : null)
  }
  if (ascii(b, 0, 5) === '%PDF-') return { mediaType: 'application/pdf', ext: 'pdf', width: null, height: null, pages: pdfPages(b) }
  const svg = svgRoot(b)
  if (svg !== undefined) return info('image/svg+xml', 'svg', svg)
  return null
}

const WORDS = ['image', 'img', 'photo', 'picture', 'screenshot', 'untitled', 'scan', 'document', 'file', 'download']
const PREFIXES = ['img', 'dsc', 'dscn', 'pxl', 'photo', 'screenshot', 'screen shot', 'snímek obrazovky', 'bildschirmfoto']

/** R73: whether a file stem is generic (FR-ATT-08). */
export function isGenericName(stem: string): boolean {
  const s = stem.normalize('NFC').trim().toLowerCase()
  if (WORDS.includes(s) || s.startsWith('pasted image')) return true
  if (PREFIXES.some((p) => s.startsWith(p))) return true
  return s !== '' && /^[\d\p{P}\p{S}\s]+$/u.test(s)
}

/** §3.3: the input of `mediaNames`. */
export type NameRequest = {
  /** The file name from the drop or picker path, or `Pasted image <yyyyMMddHHmmss>` for a paste. */
  name: string
  info: MediaInfo
  /** The owning note's title (title, else stem); null from the capture window without a title. */
  ownerTitle: string | null
  /** The UI's local date `yyyy-MM-dd` (capture titles `Capture <date> <n>`). */
  date: string
  /** The attachments folder (vault setting `attachments`, D-551). */
  attachments: string
  /** The new object's type folder (`Images`, `PDFs`). */
  folder: string
}

/** §3.3: vault paths of the new file and object, and the object's title. */
export type MediaNames = { file: string; object: string; title: string }

/** D-51, D-52 (`tegg_format::sanitize_file_stem`). */
function sanitizeStem(title: string): string {
  let s = Array.from(title.normalize('NFC'), (ch) => ('/:\\*?"<>|#^[]'.includes(ch) || /\p{Cc}/u.test(ch) ? ' ' : ch)).join('')
  const trim = (x: string) => x.replace(/^[ .]+|[ .]+$/g, '')
  s = trim(s.split(' ').filter((w) => w !== '').join(' '))
  if (new TextEncoder().encode(s).length > 200) s = trim(cutBytes(s, 200))
  if (s === '') return 'Untitled'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s.split('.')[0].trim())) s += '_'
  return s
}

function cutBytes(s: string, max: number): string {
  let out = ''
  let n = 0
  for (const ch of s) {
    const k = new TextEncoder().encode(ch).length
    if (n + k > max) break
    out += ch
    n += k
  }
  return out
}

const join = (dir: string, name: string) => (dir.replace(/^\/+|\/+$/g, '') === '' ? name : `${dir.replace(/^\/+|\/+$/g, '')}/${name}`)

function unique(stem: string, ext: string, taken: (name: string) => boolean): string {
  const e = ext ? `.${ext.replace(/^\./, '')}` : ''
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}${e}` : `${stem} (${n})${e}`
    if (!taken(name)) return name
  }
}

function splitExt(name: string): [string, string | null] {
  const i = name.lastIndexOf('.')
  if (i > 0) {
    const ext = name.slice(i + 1)
    if (ext !== '' && ext.length <= 5 && /^[A-Za-z0-9]+$/.test(ext)) return [name.slice(0, i), ext]
  }
  return [name, null]
}

/** §3.3 (R72, R73, D-617): pure; `exists(vaultPath)` answers whether a path is taken (case-insensitive). */
export function mediaNames(exists: (vaultPath: string) => boolean, req: NameRequest): MediaNames {
  const name = req.name.normalize('NFC').trim()
  const [stem0, ext0] = splitExt(name)
  const ext = ext0 ?? req.info.ext
  const stem = stem0.trim()
  let fstem = sanitizeStem(stem)
  const max = 200 - (new TextEncoder().encode(ext).length + 1)
  if (new TextEncoder().encode(fstem).length > max) fstem = cutBytes(fstem, max).replace(/[ .]+$/, '')
  const file = join(req.attachments, unique(fstem, ext, (n) => exists(join(req.attachments, n))))
  if (isGenericName(stem)) {
    const base = req.ownerTitle?.normalize('NFC').trim() || `Capture ${req.date}`
    let n = 1
    while (exists(join(req.folder, `${sanitizeStem(`${base} ${n}`)}.md`))) n++
    const title = `${base} ${n}`
    return { file, object: join(req.folder, `${sanitizeStem(title)}.md`), title }
  }
  const object = join(req.folder, unique(sanitizeStem(stem), 'md', (n) => exists(join(req.folder, n))))
  return { file, object, title: stem }
}

/** §3.5: the fields of a new Image or PDF object. */
export type MediaObjectFields = {
  id: string
  title: string
  /** ISO 8601 with offset (`created` and `modified`). */
  now: string
  /** The text inside `![[…]]`. */
  embed: string
  info: MediaInfo
  size: number
  /** D-184 link text of the owning note, or null. */
  source: string | null
}

/** §3.5: the object's bytes (twin of `tegg-core` `media_object`). */
export function mediaObject(f: MediaObjectFields): string {
  const type = f.info.mediaType === 'application/pdf' ? 'pdf' : 'image'
  const lines = ['---', `id: ${f.id}`, `type: ${type}`, `title: ${formatScalar(f.title.normalize('NFC'))}`, `created: ${f.now}`, `modified: ${f.now}`,
    `file: "[[${f.embed.normalize('NFC')}]]"`, `media-type: ${f.info.mediaType}`, `size: ${f.size}`]
  if (f.info.width !== null) lines.push(`width: ${f.info.width}`)
  if (f.info.height !== null) lines.push(`height: ${f.info.height}`)
  if (f.info.pages !== null) lines.push(`pages: ${f.info.pages}`)
  if (f.source !== null) lines.push(`source: "[[${f.source.normalize('NFC')}]]"`)
  lines.push('---')
  return `${lines.join('\n')}\n`
}

/** R72: the name of a pasted image, `Pasted image <yyyyMMddHHmmss>.<ext>` from a local date-time
 *  `YYYY-MM-DDTHH:mm:ss` (the UI's `appZone()`, ms5-tasks §1). */
export function pastedImageName(localDateTime: string, ext: string): string {
  const d = localDateTime.replace(/[^0-9]/g, '').slice(0, 14)
  return `Pasted image ${d}.${ext}`
}
