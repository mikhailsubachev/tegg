#!/usr/bin/env node
// Generates the binary files of the 6A fixture (docs/acceptance/trash-media.md, docs/contracts/ms6-trash-media.md
// §3.1, §9.3) byte-exact and without dependencies (Node's zlib only). Synthetic content only (D-50): no real photo or
// document. Run from anywhere: `node tests/fixtures/vaults/trash-media/make-media.mjs`; the output is committed.
//
// Vault files (this folder):
//   _attachments/záhon.png                 64 × 48 PNG, one colour per quadrant, padded to 1,234 bytes (R76 `1.2 KB`)
//   _attachments/Rozpočet.pdf              2 pages, text `Strana 1` / `Strana 2`
//   .trash/_attachments/Smazaný obrázek.png 16 × 16 PNG, one colour
//   .trash/_attachments/osiřelý.jpg        8 × 8 baseline JPEG, grey
// Per-format samples for media_info (tests/fixtures/media/, not a vault):
//   exif6.jpg      16 × 8 baseline JPEG with EXIF orientation 6 (shown 8 × 16)
//   plain.jpg      16 × 8 baseline JPEG, no EXIF
//   anim.gif       3 × 2 GIF89a
//   pixel.webp     1 × 1 lossless WebP (VP8L)
//   header.heic    HEIF header sample: `ftyp` brand `heic` and an `ispe` of 40 × 30 (no image data)
//   vektor.svg     SVG with `viewBox="0 0 120 80"` only (120 × 80)
//   vektor-px.svg  SVG with `width="30px" height="20"` and a viewBox (30 × 20)
//   tri-strany.pdf 3-page PDF
//   text.png       a text file named `.png`
//   empty.png      0 bytes
//   zprava.docx    a ZIP header named `.docx` (not an image or PDF)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = import.meta.dirname;
const SAMPLES = resolve(HERE, '../../media');

function out(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  process.stdout.write(`${String(bytes.length).padStart(6)}  ${path.slice(resolve(HERE, '../../..').length + 1).normalize('NFC')}\n`);
}

// ------------------------------------------------------------------------------------------------ PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGB PNG, 8 bits per channel, filter 0 on every row; `px(x, y)` gives [r, g, b]. With `size`, a `tEXt` chunk
 *  (keyword `Comment`, ASCII filler) pads the file to exactly that many bytes. */
function png(w, h, px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (1 + w * 3) + 1 + x * 3);
  }
  const head = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 }))];
  const iend = chunk('IEND', Buffer.alloc(0));
  if (size) {
    const free = size - Buffer.concat(head).length - iend.length - 12 - 'Comment\0'.length;
    const filler = 'Tegg 6A synthetic fixture. '.repeat(Math.ceil(free / 27)).slice(0, free);
    head.push(chunk('tEXt', Buffer.from(`Comment\0${filler}`, 'latin1')));
  }
  return Buffer.concat([...head, iend]);
}
const QUADRANTS = [[0xd0, 0x30, 0x30], [0x30, 0xa0, 0x40], [0x30, 0x50, 0xd0], [0xe0, 0xc0, 0x20]]; // red, green, blue, yellow
const zahon = png(64, 48, (x, y) => QUADRANTS[(y < 24 ? 0 : 2) + (x < 32 ? 0 : 1)], 1234); // R76: `Size` shows `1.2 KB`
const smazany = png(16, 16, () => [0x80, 0x80, 0x80]);

// ------------------------------------------------------------------------------------------------ JPEG
// Baseline, one grey component, every 8 × 8 block flat at level 128 (DC difference 0, all AC zero). Huffman tables
// with one code each (DC category 0, AC end-of-block), so every block is two 0 bits.

function seg(marker, body) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
}
function jpeg(w, h, orientation) {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(seg(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])));
  if (orientation) {
    // APP1 Exif, big-endian TIFF, IFD0 with one entry: Orientation (0x0112), SHORT, 1, value.
    const tiff = Buffer.from([
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // MM, 42, IFD0 at 8
      0x00, 0x01, // one entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // no next IFD
    ]);
    parts.push(seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])));
  }
  parts.push(seg(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]))); // DQT 0, all ones
  parts.push(seg(0xc0, Buffer.from([0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00]))); // SOF0
  const oneCode = (cls) => Buffer.concat([Buffer.from([cls << 4]), Buffer.from([1, ...new Array(15).fill(0)]), Buffer.from([0x00])]);
  parts.push(seg(0xc4, oneCode(0))); // DHT DC 0: symbol 0 (category 0) = "0"
  parts.push(seg(0xc4, oneCode(1))); // DHT AC 0: symbol 0x00 (EOB) = "0"
  parts.push(seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]))); // SOS
  const blocks = Math.ceil(w / 8) * Math.ceil(h / 8);
  const bits = blocks * 2;
  const data = Buffer.alloc(Math.ceil(bits / 8), 0);
  const pad = data.length * 8 - bits; // pad with 1 bits
  if (pad) data[data.length - 1] |= (1 << pad) - 1;
  parts.push(data, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

// ------------------------------------------------------------------------------------------------ GIF
// 3 × 2, two-colour table, LZW minimum code size 2: a clear code before every pixel keeps the codes 3 bits wide.

function gif() {
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push(4, 0);
  codes.push(5);
  const bytes = [];
  let acc = 0;
  let n = 0;
  for (const c of codes) {
    acc |= c << n;
    n += 3;
    while (n >= 8) { bytes.push(acc & 0xff); acc >>= 8; n -= 8; }
  }
  if (n) bytes.push(acc & 0xff);
  return Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([0x03, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00]), // 3 × 2, global table of 2 colours
    Buffer.from([0x20, 0x80, 0x40, 0xff, 0xff, 0xff]),
    Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00]),
    Buffer.from([0x02, bytes.length, ...bytes, 0x00]),
    Buffer.from([0x3b]),
  ]);
}

// ------------------------------------------------------------------------------------------------ WebP (1 × 1 lossless)

const webp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

// ------------------------------------------------------------------------------------------------ HEIC header sample

function box(type, ...payload) {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
}
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
function heic(w, h) {
  const ftyp = box('ftyp', Buffer.from('heic', 'ascii'), u32(0), Buffer.from('mif1heic', 'ascii'));
  const hdlr = box('hdlr', u32(0), u32(0), Buffer.from('pict', 'ascii'), Buffer.alloc(12), Buffer.from([0]));
  const ispe = box('ispe', u32(0), u32(w), u32(h));
  const meta = box('meta', u32(0), hdlr, box('iprp', box('ipco', ispe)));
  return Buffer.concat([ftyp, meta]);
}

// ------------------------------------------------------------------------------------------------ PDF

function pdf(pages) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const stream = `BT /F1 24 Tf 72 760 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// ------------------------------------------------------------------------------------------------ write

out(join(HERE, '_attachments', 'záhon.png'.normalize('NFC')), zahon);
out(join(HERE, '_attachments', 'Rozpočet.pdf'.normalize('NFC')), pdf(['Strana 1', 'Strana 2']));
out(join(HERE, '.trash', '_attachments', 'Smazaný obrázek.png'.normalize('NFC')), smazany);
out(join(HERE, '.trash', '_attachments', 'osiřelý.jpg'.normalize('NFC')), jpeg(8, 8, 0));

out(join(SAMPLES, 'exif6.jpg'), jpeg(16, 8, 6));
out(join(SAMPLES, 'plain.jpg'), jpeg(16, 8, 0));
out(join(SAMPLES, 'anim.gif'), gif());
out(join(SAMPLES, 'pixel.webp'), webp);
out(join(SAMPLES, 'header.heic'), heic(40, 30));
out(join(SAMPLES, 'vektor.svg'), Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<!-- Tegg 6A fixture -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" fill="#33aa77"/></svg>\n', 'utf8'));
out(join(SAMPLES, 'vektor-px.svg'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="20" viewBox="0 0 120 80"><circle cx="60" cy="40" r="30" fill="#d03030"/></svg>\n', 'utf8'));
out(join(SAMPLES, 'tri-strany.pdf'), pdf(['Strana 1', 'Strana 2', 'Strana 3']));
out(join(SAMPLES, 'text.png'), Buffer.from('Tohle není obrázek.\n', 'utf8'));
out(join(SAMPLES, 'empty.png'), Buffer.alloc(0));
out(join(SAMPLES, 'zprava.docx'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from('word/document.xml', 'latin1')]));
