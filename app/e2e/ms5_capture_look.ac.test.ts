// MS5 slice 5B preview feedback F9, real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/
// capture.md FR-CAP-01 AC-17 (D-592): in the built app the capture window has rounded corners and shows the desktop
// through its material: a pixel inside the 14 pt corner radius (outside the rounded shape) differs from the content's
// background colour next to it. Interface: docs/contracts/ms5-capture.md §1.2 (the `capture` window, title
// `Quick Capture`), §11.1 (test hooks), ms3-shell §1 (TEGG_ROUTE, marks). Always TEGG_TEST=1 with TEGG_NOW (D-504), a
// temporary Application Support and a temporary copy of the synthetic inbox fixture (D-62). The screen is read with
// macOS `screencapture` (needs the Screen Recording permission for the terminal, as Accessibility is needed for
// Appium); the PNG is decoded here with node:zlib. Launch pattern as ms5_capture.ac.test.ts; its own file so the
// existing AC test files stay unchanged (TS-I3). Written from the ACs and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  activateFinder, appiumDown, captureOpen, end, hotkey, inboxCopy, ready, session, sleep, support, testEnv, tmp, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, theme: 'light' | 'dark'): Ctx {
  const base = tmp(name);
  return { base, vault: inboxCopy(base), sup: support(base, { ui: { theme } }), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route = 'inbox') {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}

/** A decoded 8-bit, non-interlaced PNG (colour types 2 and 6, as `screencapture` writes). */
type Image = { width: number; height: number; px: (x: number, y: number) => [number, number, number] };
function decodePng(buf: Buffer): Image {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'a PNG screenshot');
  let off = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.subarray(off + 4, off + 8).toString('latin1');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    if (kind === 'IDAT') idat.push(data);
    if (kind === 'IEND') break;
    off += 12 + len;
  }
  assert.ok(depth === 8 && (type === 2 || type === 6) && interlace === 0, `an 8-bit RGB(A) non-interlaced PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, px: (x, y) => { const i = Math.round(y) * stride + Math.round(x) * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

/** The capture window's frame in screen points (top-left origin, as `screencapture -R`). */
async function captureFrame(d: Driver): Promise<{ x: number; y: number; width: number; height: number }> {
  const w = await d.$('-ios predicate string:elementType == 4 AND title == "Quick Capture"');
  assert.ok(await w.isExisting().catch(() => false), 'the window "Quick Capture"');
  return d.getElementRect(w.elementId);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_cap_01_ac17_the_built_window_has_rounded_corners_and_material_${theme}`, { timeout: 300_000 }, async () => {
    await ready();
    const c = fresh(`cap01ac17${theme}`, theme);
    try {
      const d = await launch(c);
      await activateFinder();
      hotkey('quick');
      assert.ok(await waitFor(() => captureOpen(d), 3000), 'the capture window opens');
      await sleep(600); // the material and the shadow settle
      const f = await captureFrame(d);
      const shot = join(c.base, 'capture.png');
      execFileSync('screencapture', ['-x', '-R', `${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.width)},${Math.round(f.height)}`, shot]);
      assert.ok(existsSync(shot), 'a screenshot of the window frame');
      const img = decodePng(readFileSync(shot));
      const s = img.width / Math.round(f.width); // pixels per point (2 on Retina)
      // 3 pt in from the corner is outside a 14 pt rounded corner; the content's background is sampled at the top
      // centre, 4 pt down (the header's 12 px top padding: no control there).
      const corner = img.px(3 * s, 3 * s);
      const content = img.px((f.width / 2) * s, 4 * s);
      const diff = corner.reduce((n, v, i) => n + Math.abs(v - content[i]), 0);
      assert.ok(diff > 12, `${theme}: the corner pixel ${JSON.stringify(corner)} differs from the content background ${JSON.stringify(content)} (rounded, transparent window, D-592)`);
    } finally { await cleanup(c); }
  });
}
