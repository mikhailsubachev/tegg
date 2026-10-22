// Slice 6A (docs/contracts/ms6-trash-media.md §3.1, §3.3, §3.5; D-617): the TS twins of `tegg-core` `media6a.rs` for
// the fake core and the L1 tests: media metadata from the bytes (`mediaInfo`), names and titles of a new Image or PDF
// object (`mediaNames`, R72, R73) and the object's bytes (`mediaObject`). Rust and TS give identical results for the
// same inputs (L1 + L4 twin table).
// 6A stub (ms6-trash-media §3): every function returns a deliberately wrong result (TS-I1).

/** §3.1: what the bytes are (R72's types only). */
export type MediaInfo = {
  mediaType: string
  /** The usual extension without the dot (`png`, `jpg`, `gif`, `webp`, `heic`, `svg`, `pdf`). */
  ext: string
  width: number | null
  height: number | null
  pages: number | null
}

/** §3.1: by magic bytes only; `null` = refused (`media.refused`). 6A stub (ms6-trash-media §3.1): `null`. */
export function mediaInfo(_bytes: Uint8Array): MediaInfo | null {
  return null
}

/** R73: whether a file stem is generic (FR-ATT-08). 6A stub (ms6-trash-media §3.3): never. */
export function isGenericName(_stem: string): boolean {
  return false
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

/** §3.3 (R72, R73, D-617): pure; `exists(vaultPath)` answers whether a path is taken (case-insensitive).
 *  6A stub (ms6-trash-media §3.3): the name unchanged, no object, no title. */
export function mediaNames(_exists: (vaultPath: string) => boolean, req: NameRequest): MediaNames {
  return { file: req.name, object: '', title: '' }
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

/** §3.5: the object's bytes (twin of `tegg-core` `media_object`). 6A stub (ms6-trash-media §3.5): ''. */
export function mediaObject(_f: MediaObjectFields): string {
  return ''
}

/** R72: the name of a pasted image, `Pasted image <yyyyMMddHHmmss>.<ext>` from a local date-time
 *  `YYYY-MM-DDTHH:mm:ss` (the UI's `appZone()`, ms5-tasks §1). 6A stub (ms6-trash-media §3.3): ''. */
export function pastedImageName(_localDateTime: string, _ext: string): string {
  return ''
}
