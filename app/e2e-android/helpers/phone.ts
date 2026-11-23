// Slice AND-2, the LA harness for the phone layout (docs/contracts/android-phone.md §14.2, §12.1), on top of AND-1's
// device.ts: rotation, night mode, the system font size, the system bars' frames from `dumpsys window`, the IME state,
// the bars' icon appearance, the WebView's rectangle from `uiautomator dump`, a pixel from `screencap -p`, taps and
// swipes, the edge back gesture, logcat since a mark, the test APK's IPC log (`TEGG_IPC_LOG`) and the action-mode check.
// Test infrastructure only: setup failures are AssertionErrors (TS-I1); no AC outcome is asserted here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { WRITE_COMMANDS } from '../../ui/test/phone-writes.ts';
import {
  appops, clearPrivate, eventually, forceStop, pushVault, runAs, sh, sleep, start, TEST_ID, webview, writeTestEnv, type WebView,
} from './device.ts';

export { WRITE_COMMANDS };
/** §12.1: the IPC log inside the test APK's private files dir. */
export const IPC_LOG = 'ipc.jsonl';
export const ipcLogPath = (id = TEST_ID) => `/data/user/0/${id}/files/${IPC_LOG}`;
/** The phone frame's bottom bar (RA8), shown once a vault is open. */
export const FRAME = 'nav[aria-label="Main"]';
export const DRAWER = '[role="dialog"][aria-label="Navigation"]';

export type Box = { left: number; top: number; right: number; bottom: number };
const box = (m: RegExpExecArray | null): Box | null => (m ? { left: Number(m[1]), top: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) } : null);

/** `settings put system user_rotation` (auto-rotate off first): 0 portrait, 1 landscape. */
export function rotate(quarterTurns: 0 | 1 | 2 | 3): void {
  sh('settings put system accelerometer_rotation 0');
  sh(`settings put system user_rotation ${quarterTurns}`);
}
/** `cmd uimode night yes|no`. */
export function nightMode(on: boolean): void {
  sh(`cmd uimode night ${on ? 'yes' : 'no'}`);
}
/** `settings put system font_scale x`. */
export function fontScale(x: number): void {
  sh(`settings put system font_scale ${x}`);
}
/** The status bar, navigation bar, display cutout and IME frames (device px) from `dumpsys window`'s insets sources. */
export function systemFrames(): { status: Box | null; nav: Box | null; cutout: Box | null; ime: Box | null; screen: { width: number; height: number } } {
  const out = sh('dumpsys window', false);
  const src = (type: string) => box(new RegExp(`InsetsSource[^\\n]*type=${type}[^\\n]*frame=\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]`).exec(out));
  const size = /(\d+)x(\d+)/.exec(sh('wm size', false));
  const rot = Number(/mRotation=(\d)/.exec(sh('dumpsys display', false))?.[1] ?? '0');
  const w = Number(size?.[1] ?? 1080);
  const h = Number(size?.[2] ?? 2400);
  return { status: src('statusBars'), nav: src('navigationBars'), cutout: src('displayCutout'), ime: src('ime'), screen: rot % 2 ? { width: h, height: w } : { width: w, height: h } };
}
/** `dumpsys input_method`'s `mInputShown`. */
export function imeShown(): boolean {
  return /mInputShown=true/.test(sh('dumpsys input_method', false));
}
/** Whether the app's window asks for light status / navigation bar icons (`APPEARANCE_LIGHT_*` in `dumpsys window`). */
export function barAppearance(id = TEST_ID): { lightStatus: boolean; lightNav: boolean } {
  const out = sh('dumpsys window windows', false);
  const at = out.indexOf(`${id}/`);
  // Only Tegg's own window block: the next window's (the launcher's) `apr=` isn't Tegg's (AC-Test-Change, approved by
  // the owner).
  const next = at >= 0 ? out.indexOf('Window #', at) : -1;
  const part = at >= 0 ? out.slice(at, next > at ? next : undefined) : out;
  // Android 15 prints `apr=LIGHT_STATUS_BARS LIGHT_NAVIGATION_BARS` (older releases `APPEARANCE_LIGHT_…`).
  return { lightStatus: /\bLIGHT_STATUS_BARS\b/.test(part), lightNav: /\bLIGHT_NAVIGATION_BARS\b/.test(part) };
}
/** The WebView's rectangle on the screen (device px) from `uiautomator dump`. */
export function webViewRect(): Box {
  sh('uiautomator dump /sdcard/tegg-ui.xml >/dev/null 2>&1', false);
  const xml = sh('cat /sdcard/tegg-ui.xml', false);
  const b = box(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml));
  assert.ok(b, 'uiautomator dump lists the WebView');
  return b!;
}
/** The RGB value of the screen pixel (x, y) (device px) from `screencap -p` (8-bit RGB/RGBA PNG). */
export function pixel(x: number, y: number): [number, number, number] {
  const raw = spawnBytes(['exec-out', 'screencap', '-p']);
  const png = decodePng(raw);
  const i = (y * png.width + x) * png.channels;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
function spawnBytes(args: string[]): Buffer {
  const r = spawnSync('adb', args, { maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, `adb ${args.join(' ')}`);
  return r.stdout as Buffer;
}
function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Uint8Array } {
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', 'screencap gives a PNG');
  let p = 8;
  let width = 0, height = 0, channels = 4;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString('latin1');
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); channels = body[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(body);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
export function tap(x: number, y: number): void {
  sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
}
export function swipe(x1: number, y1: number, x2: number, y2: number, ms = 300): void {
  sh(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${ms}`);
}
/** The edge back gesture (gesture navigation on, D-2082): `input swipe 1 <h/2> 400 <h/2>`. */
export function edgeBack(): void {
  const h = systemFrames().screen.height;
  swipe(1, h / 2, 400, h / 2, 250);
}
/** A logcat mark (the device's time) for `logcatSince`. */
export function logcatMark(): string {
  return sh("date '+%m-%d %H:%M:%S.000'").trim();
}
/** Logcat lines since `mark` matching `filter`. */
export function logcatSince(mark: string, filter: RegExp): string[] {
  return sh(`logcat -d -T '${mark}'`, false).split('\n').filter((l) => filter.test(l));
}
/** The commands the test APK received since start (§12.1), in order. */
export function ipcLog(id = TEST_ID): { cmd: string; ms: number }[] {
  return runAs(id, `cat files/${IPC_LOG} 2>/dev/null || true`, false).split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
/** `WRITE_COMMANDS` entries of the IPC log (§2.3: "zero writes" at LA). */
export const ipcWrites = (id = TEST_ID) => ipcLog(id).map((x) => x.cmd).filter((c) => WRITE_COMMANDS.includes(c));
/** A floating toolbar or `ActionMode` window (a WebView context menu) in `dumpsys window`. */
export function actionModeShown(): boolean {
  return /FloatingToolbar|ActionMode|floating_popup/i.test(sh('dumpsys window windows', false));
}

/** `views/` + `new-empty/.tegg/` + `phone/` as `Knihovna` in shared storage (the fixture READMEs and scripts removed). */
export function pushPhone(): string {
  const root = pushVault(['tests/fixtures/vaults/views', 'tests/fixtures/vaults/new-empty/.tegg', 'tests/fixtures/vaults/phone'], 'Knihovna');
  sh(`rm -f '${root}/README.md' '${root}/make-phone.mjs'`, false);
  return root;
}
/** A fresh start of the test APK on `vault` with the IPC log on; waits for the phone frame. */
export async function launchPhone(vault: string, env: Record<string, string> = {}, views?: WebView[]): Promise<{ pid: number; v: WebView }> {
  forceStop(TEST_ID);
  clearPrivate(TEST_ID);
  appops(TEST_ID, 'allow');
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault, TEGG_IPC_LOG: ipcLogPath(), ...env });
  const pid = start(TEST_ID);
  const v = await webview(TEST_ID);
  views?.push(v);
  assert.ok(await v.waitFor(FRAME, 30_000), 'the vault opens on the phone layout (nav "Main")');
  return { pid, v };
}
/** The page's visible `h1` (the app bar's title). */
// An eval during a cold start's page load can answer nothing: that is an empty title (AC-Test-Change, approved by the
// owner).
export const title = async (v: WebView) => (await v.eval<string | undefined>(`(document.querySelector('header[role="banner"] h1')?.innerText ?? '').trim()`)) ?? '';
export async function titleIs(v: WebView, want: string, ms = 5000): Promise<string> {
  return eventually(() => title(v), (t) => t.normalize('NFC') === want.normalize('NFC'), ms, 150);
}
/** CSS rect of `selector` in the page (or null). */
export const cssRect = (v: WebView, selector: string) => v.eval<{ left: number; top: number; right: number; bottom: number; width: number; height: number } | null>(
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`);
/** Device px of a CSS point: the WebView's offset plus the point × devicePixelRatio. */
export async function toDevice(v: WebView, x: number, y: number): Promise<{ x: number; y: number }> {
  const dpr = await v.eval<number>('devicePixelRatio');
  const wv = webViewRect();
  return { x: wv.left + x * dpr, y: wv.top + y * dpr };
}
/** Taps the centre of `selector` on the screen (a real touch, through `input tap`). */
export async function tapEl(v: WebView, selector: string): Promise<void> {
  const r = await cssRect(v, selector);
  assert.ok(r, `${selector} is on the page`);
  const p = await toDevice(v, r!.left + r!.width / 2, r!.top + r!.height / 2);
  tap(p.x, p.y);
}
export { sleep };
