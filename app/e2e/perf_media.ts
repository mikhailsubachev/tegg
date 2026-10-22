// FR-ATT-01 AC-16 benchmark (report only until MS8, docs/acceptance/trash-media.md; docs/contracts/ms6-trash-media.md
// §7 marks `note-ready`, `media-ready:<path>`): (a) a note with 20 embedded 2-MB images reaches `note-ready` within
// NFR-PERF-05's budget, images loading after the text (`loading="lazy"`); (b) a pasted 10-MB image shows
// (`media-ready`) within 1 s of ⌘V. Synthetic images only (incompressible noise in a stored-deflate PNG, D-50); never
// touches the owner's Application Support or vault (D-62). Used by nfr_perf_media.ac.test.ts; no assertions here.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { EXE, p95, readMarks } from './perf_open_note.ts';

export { EXE, p95, readMarks };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
const FX = resolve(import.meta.dirname, '../../tests/fixtures/vaults');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** An RGB PNG of about `bytes` bytes (pseudo-random pixels, seeded). */
export function noisePng(bytes: number, seed: number): Buffer {
  const w = 1024;
  const h = Math.max(1, Math.round(bytes / (w * 3)));
  const raw = Buffer.alloc(h * (1 + w * 3));
  let x = seed | 1;
  for (let i = 0; i < raw.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; raw[i] = i % (1 + w * 3) === 0 ? 0 : x & 0xff; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
/** A vault (new-empty/.tegg) with `Pages/Galerie.md` embedding 20 × 2-MB images, each with its Image object. */
export function galleryVault(dir: string): { vault: string; images: string[] } {
  const v = join(dir, 'Galerie');
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  mkdirSync(join(v, '_attachments'), { recursive: true });
  mkdirSync(join(v, 'Images'), { recursive: true });
  mkdirSync(join(v, 'Pages'), { recursive: true });
  const images: string[] = [];
  const body: string[] = ['Úvodní odstavec galerie.'];
  for (let i = 1; i <= 20; i++) {
    const name = `Fotka zahrady ${String(i).padStart(2, '0')}.png`;
    const png = noisePng(2 * 1024 * 1024, i);
    writeFileSync(join(v, '_attachments', name), png);
    writeFileSync(join(v, 'Images', name.replace(/\.png$/, '.md')), `---\nid: 01JB6A00000000000000000G${String(i).padStart(2, '0')}\ntype: image\ntitle: ${name.replace(/\.png$/, '')}\nfile: "[[${name}]]"\nmedia-type: image/png\nsize: ${png.length}\n---\n`);
    images.push(`_attachments/${name}`);
    body.push(`![[${name}]]`);
  }
  writeFileSync(join(v, 'Pages/Galerie.md'), `---\nid: 01JB6A0000000000000000G000\ntype: page\ntitle: Galerie\n---\n${body.join('\n\n')}\n`);
  return { vault: v, images };
}

/** One launch on the gallery note; returns `note-ready` − `ui-ready` and the first `media-ready` − `note-ready`. */
export async function galleryRun(env: Record<string, string>, log: string, timeoutMs = 60_000): Promise<{ ready: number | null; firstImage: number | null }> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, ...env, TEGG_ROUTE: 'note/Pages/Galerie.md', TEGG_PERF_LOG: log }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !readMarks(log).some((m) => m.mark.startsWith('media-ready:'))) await sleep(50);
  await sleep(200);
  child.kill('SIGKILL');
  const m = readMarks(log);
  const ui = m.find((x) => x.mark === 'ui-ready')?.ms;
  const note = m.find((x) => x.mark === 'note-ready')?.ms;
  const img = m.find((x) => x.mark.startsWith('media-ready:'))?.ms;
  return { ready: ui !== undefined && note !== undefined ? note - ui : null, firstImage: note !== undefined && img !== undefined ? img - note : null };
}

/** One launch on the gallery note, a 10-MB PNG pasted at the end; returns `media-ready` of the pasted file − the ⌘V. */
export async function pasteRun(env: Record<string, string>, log: string, png: string, timeoutMs = 60_000): Promise<number | null> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, ...env, TEGG_ROUTE: 'note/Pages/Galerie.md', TEGG_PERF_LOG: log }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !readMarks(log).some((m) => m.mark === 'note-ready')) await sleep(50);
  let at: number | null = null;
  try {
    osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`);
    osa(`set the clipboard to (read (POSIX file "${png}") as «class PNGf»)`);
    await sleep(300);
    at = Date.now();
    osa('tell application "System Events" to keystroke "v" using {command down}');
  } catch { /* the marks tell */ }
  let shown: number | null = null;
  while (Date.now() < end && shown === null) {
    if (readMarks(log).some((m) => m.mark.startsWith('media-ready:_attachments/Pasted image'))) shown = Date.now();
    await sleep(10);
  }
  child.kill('SIGKILL');
  return at !== null && shown !== null ? shown - at : null;
}
