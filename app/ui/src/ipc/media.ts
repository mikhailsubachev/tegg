// Slice 6A (docs/contracts/ms6-trash-media.md §3.6; D-622): every media URL of the UI. The shell serves vault files
// read-only through `tegg-media://localhost/<percent-encoded vault path>`; in tests the fake core sets
// `window.__TEGG_MEDIA_BASE__` (`http://localhost:5177/__media/`), which replaces the scheme and host.
// 6A stub (ms6-trash-media §3.6): no URL yet.

export function mediaUrl(_path: string): string {
  return ''
}
