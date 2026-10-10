// Writes a 1024×1024 placeholder PNG (rounded square with a "T") for `tauri icon`. Spike only.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 1024;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const r = 180, cx = Math.max(r - x, x - (N - 1 - r), 0), cy = Math.max(r - y, y - (N - 1 - r), 0);
    const inside = cx * cx + cy * cy <= r * r && x > 60 && y > 60 && x < N - 60 && y < N - 60;
    const t = (y > 280 && y < 380 && x > 280 && x < 744) || (x > 462 && x < 562 && y >= 380 && y < 780);
    const o = y * (N * 4 + 1) + 1 + x * 4;
    const [R, G, B] = t ? [255, 255, 255] : [72, 92, 220];
    raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = inside ? 255 : 0;
  }
}
const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL('../src-tauri/icons/source.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
