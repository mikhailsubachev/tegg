// 44×44 black-on-transparent template image for the menu bar (22 pt @2x). Spike only.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const N = 44, raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const on = (y >= 8 && y < 14 && x >= 8 && x < 36) || (x >= 19 && x < 25 && y >= 14 && y < 37);
  raw[y * (N * 4 + 1) + 1 + x * 4 + 3] = on ? 255 : 0;
}
const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const h = Buffer.alloc(13); h.writeUInt32BE(N, 0); h.writeUInt32BE(N, 4); h[8] = 8; h[9] = 6;
writeFileSync(new URL('../src-tauri/icons/tray.png', import.meta.url), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
