// Slice 6A (docs/contracts/ms6-trash-media.md §3.6; D-622): every media URL of the UI. The shell serves vault files
// read-only through `tegg-media://localhost/<percent-encoded vault path>`; in tests the fake core sets
// `window.__TEGG_MEDIA_BASE__` (`http://localhost:5177/__media/`), which replaces the scheme and host.

const enc = (path: string) => path.normalize('NFC').split('/').map(encodeURIComponent).join('/');

export function mediaUrl(path: string): string {
  const base = (window as { __TEGG_MEDIA_BASE__?: string }).__TEGG_MEDIA_BASE__ ?? 'tegg-media://localhost/';
  return base + enc(path);
}

/** §5: a capture staging token's URL (the capture window only). */
export function stagedUrl(token: string): string {
  return mediaUrl(`stage/${token}`);
}
