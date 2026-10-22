// Fake core, slice 6A (docs/contracts/ms6-trash-media.md §3.3…§3.5, §9.2): `media_add` over the fake's in-memory
// vault in Node, with the real `@tegg/doc` twins `mediaInfo`, `mediaNames` and `mediaObject` (packages/doc/src/media.ts).
// Test code, not product code. The in-page fake applies the returned writes (fake-core.ts `__teggMedia`).

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
/** D-625: larger files are refused before they are read. */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;

let docMod: any;
const doc = async () => (docMod ??= await import('@tegg/doc'));

export type MediaAddArgs = {
  /** The bytes, base64. */
  b64: string;
  /** Bytes length when `b64` is omitted for a size check only. */
  size?: number;
  name: string;
  owner: string | null;
  ownerTitle: string | null;
  date: string;
  /** ISO with offset: `created` and `modified`. */
  now: string;
  id: string;
};
export type MediaAnswer = {
  result?: unknown;
  error?: { kind: string; message: string; name?: string };
  /** New binary files (path → base64) and text files (path → text), in write order: file first, then the object. */
  writes?: { bin: Record<string, string>; text: Record<string, string> };
};

function attachmentsFolder(files: Record<string, string>): string {
  const m = /^attachments:\s*(.+)$/m.exec(files['.tegg/vault.yml'] ?? '');
  return m ? nfc(m[1].trim().replace(/^["']|["']$/g, '')) : '_attachments';
}
function typeFolder(files: Record<string, string>, key: 'image' | 'pdf'): string {
  const m = /^folder:\s*(.+)$/m.exec(files[`.tegg/types/${key}.yml`] ?? '');
  return m ? nfc(m[1].trim()) : key === 'image' ? 'Images' : 'PDFs';
}
/** D-184 link text of a note: its stem when unique among the notes, else its path without `.md`. */
function linkText(paths: string[], path: string): string {
  const stem = (p: string) => low((p.split('/').pop() ?? p).replace(/\.md$/i, ''));
  const s = stem(path);
  const live = paths.filter((p) => /\.md$/i.test(p) && !p.startsWith('.trash/') && !p.startsWith('_templates/'));
  return live.filter((p) => stem(p) === s).length > 1 ? path.replace(/\.md$/i, '') : (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

export async function handle(cmd: string, a: MediaAddArgs, files: Record<string, string>, bin: string[]): Promise<MediaAnswer> {
  if (cmd !== 'add' && cmd !== 'info') return { error: { kind: 'Io', message: `fake-media: unknown ${cmd}` } };
  const d = await doc();
  const bytes = Uint8Array.from(Buffer.from(a.b64 ?? '', 'base64'));
  const size = a.size ?? bytes.length;
  const name = nfc(String(a.name));
  if (size > MAX_MEDIA_BYTES) return { error: { kind: 'TooLarge', message: 'fake: larger than 200 MB', name } };
  const info = d.mediaInfo(bytes);
  if (!info) return { error: { kind: 'Refused', message: 'fake: not an image or PDF', name } };
  // §5: the capture window's staging checks the bytes and the size only.
  if (cmd === 'info') return { result: { mediaType: info.mediaType, size, width: info.width, height: info.height, pages: info.pages } };
  const paths = [...new Set([...Object.keys(files), ...bin].map(nfc))];
  const taken = new Set(paths.map(low));
  const kind = info.mediaType === 'application/pdf' ? 'pdf' : 'image';
  const names = d.mediaNames((p: string) => taken.has(low(p)), {
    name, info, ownerTitle: a.ownerTitle, date: a.date, attachments: attachmentsFolder(files), folder: typeFolder(files, kind),
  });
  if (!names.file || !names.object || taken.has(low(names.file)) || taken.has(low(names.object))) {
    return { error: { kind: 'Io', message: `fake: no free name for ${name}`, name } };
  }
  const fileName = names.file.split('/').pop()!;
  const sameName = paths.filter((p) => low(p.split('/').pop()!) === low(fileName)).length;
  const embed = sameName > 0 ? names.file : fileName;
  // The owner counts once: it is already in `paths` unless it is a capture's future note (D-632).
  const source = a.owner ? linkText(paths.includes(nfc(a.owner)) ? paths : [...paths, nfc(a.owner)], nfc(a.owner)) : null;
  const text = d.mediaObject({ id: a.id, title: names.title, now: a.now, embed, info, size, source });
  return {
    result: { file: names.file, object: names.object, title: names.title, embed, mediaType: info.mediaType, size, width: info.width, height: info.height, pages: info.pages },
    writes: { bin: { [names.file]: a.b64 }, text: { [names.object]: text } },
  };
}

/** The content type the fake's `/__media/` route serves (§3.6: sniffed, not from the extension). */
export function sniff(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.slice(0, 64));
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (/^GIF8[79]a/.test(head.toString('latin1'))) return 'image/gif';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (head.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1)/.test(head.toString('latin1', 8, 12))) return 'image/heic';
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  const text = Buffer.from(bytes.slice(0, 512)).toString('utf8').replace(/^﻿/, '').replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?>/i, '').trimStart();
  if (text.startsWith('<svg')) return 'image/svg+xml';
  return null;
}
