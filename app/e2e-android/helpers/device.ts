// Slice AND-1, the LA harness (docs/contracts/android-shell.md §12; CP-4 → D-2039): the arm64 emulator driven with
// `adb` (install, `am`, `input keyevent`, `appops`, `run-as`, `dumpsys`, `stat`, `sha256sum`) and the test APK's WebView
// through the Chrome DevTools Protocol over `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>` (Node's
// built-in WebSocket and fetch to 127.0.0.1 only; the test APK is debuggable, contract §6). No new dependency.
//
// Test infrastructure only: setup failures are reported by `assert` (AssertionError, TS-I1), so a run without a device
// fails every test at `requireDevice()` and never skips it. Fixtures are synthetic or generated (D-62).
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');
/** RA1: the test APK (`npm run app:android-test`, contract §10.2) and its identity. */
export const TEST_APK = resolve(REPO, 'app/src-tauri/target/android/Tegg-test.apk');
export const TEST_ID = 'app.tegg.desktop';
export const RELEASE_ID = 'app.tegg.preview';
export const SHARED = '/storage/emulated/0';
/** The perf log of the test APK, inside its private files dir (contract §7.1). */
export const PERF_LOG = 'perf.jsonl';

export type Run = { status: number | null; stdout: string; stderr: string };

function run(cmd: string, args: string[], input?: string | Buffer): Run {
  const r: SpawnSyncReturns<string> = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, timeout: 300_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error) : (r.stderr ?? '') };
}

/** `adb <args>`; the serial comes from `ANDROID_SERIAL` when set (adb reads it itself). */
export function adb(args: string[], input?: string | Buffer): Run {
  return run('adb', args, input);
}

/** `adb shell <cmd>` (one string, run by the device's shell); asserts success unless `ok` is false. */
export function sh(cmd: string, ok = true): string {
  const r = adb(['shell', cmd]);
  if (ok) assert.equal(r.status, 0, `adb shell ${cmd}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const quote = q;

/** Whether an emulator answers `adb devices` (no assertion; for hooks). */
export function deviceAttached(): boolean {
  const r = adb(['devices']);
  return r.status === 0 && r.stdout.split('\n').slice(1).some((l) => /\sdevice$/.test(l.trim()) || /\tdevice$/.test(l));
}

/** Every LA test file starts with this: an emulator is attached and booted, and the test APK is built. */
export function requireDevice(): void {
  const r = adb(['devices']);
  assert.equal(r.status, 0, `adb runs (Android SDK platform-tools on PATH; tools/android/env.sh): ${r.stderr}`);
  const devices = r.stdout.split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()) || /\sdevice$/.test(l));
  assert.ok(devices.length > 0, 'an Android emulator is attached (the app-android-e2e step boots tegg-and-35 with tools/android/avd.sh up)');
  assert.equal(sh('getprop sys.boot_completed').trim(), '1', 'the emulator has booted');
  assert.equal(sh('getprop ro.product.cpu.abi').trim(), 'arm64-v8a', 'the emulator is arm64-v8a (RA1)');
  assert.ok(existsSync(TEST_APK), `the test APK is built: ${TEST_APK} (npm run app:android-test)`);
}

export function install(apk: string): void {
  const r = adb(['install', '-r', '-g', apk]);
  assert.equal(r.status, 0, `adb install ${apk}: ${r.stderr || r.stdout}`);
}

export function uninstall(id: string): void {
  adb(['uninstall', id]);
}

export function pidOf(id: string): number | null {
  const out = sh(`pidof ${id}`, false).trim();
  return out ? Number(out.split(/\s+/)[0]) : null;
}

/** `am force-stop` when `cold`, then `am start -W -n <id>/.MainActivity`; returns the app's pid. */
export function start(id: string, o: { cold?: boolean; wait?: boolean } = {}): number {
  if (o.cold ?? true) sh(`am force-stop ${id}`);
  sh(`am start ${o.wait === false ? '' : '-W '}-n ${id}/.MainActivity`);
  let pid: number | null = null;
  const end = Date.now() + 30_000;
  while (!pid && Date.now() < end) pid = pidOf(id);
  assert.ok(pid, `${id} is running after am start`);
  return pid!;
}

export function forceStop(id: string): void {
  sh(`am force-stop ${id}`);
}
export function home(): void {
  sh('input keyevent KEYCODE_HOME');
}
export function back(): void {
  sh('input keyevent KEYCODE_BACK');
}
/** Brings the app back to the foreground (as the launcher does). */
export function resume(id: string): void {
  sh(`am start -n ${id}/.MainActivity`);
}

export function foregroundPackage(): string {
  const out = sh('dumpsys activity activities', false);
  const m = /mResumedActivity:.*?\s([\w.]+)\/[\w.]+/.exec(out) ?? /topResumedActivity=.*?\s([\w.]+)\/[\w.]+/.exec(out);
  return m?.[1] ?? '';
}

/** "All files access" for the app (`MANAGE_EXTERNAL_STORAGE`); returns the device's wall time of the change (ms). */
export function appops(id: string, mode: 'allow' | 'deny'): number {
  sh(`appops set ${id} MANAGE_EXTERNAL_STORAGE ${mode}`);
  return Number(sh('date +%s%3N').trim());
}

export function runAs(id: string, cmd: string, ok = true): string {
  const r = adb(['shell', `run-as ${id} sh -c ${q(cmd)}`]);
  if (ok) assert.equal(r.status, 0, `run-as ${id} ${cmd}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Removes the app's private files (index, UI state, recent vaults, test-env.json): a fresh start. */
export function clearPrivate(id: string): void {
  runAs(id, 'rm -rf files/* files/.[!.]* 2>/dev/null; mkdir -p files', false);
}

/** Pushes a fresh copy of `fixture` (repository-relative folders, the first one names the vault) to
 *  `/sdcard/Documents/tegg-la-<random>/<name>`; later folders whose name starts with `.` go inside it under that name.
 *  Returns the vault's path under `/storage/emulated/0`. */
export function pushVault(fixture: string | string[], name?: string): string {
  const dirs = Array.isArray(fixture) ? fixture : [fixture];
  const base = `${SHARED}/Documents/tegg-la-${Math.random().toString(36).slice(2, 10)}`;
  const vaultName = name ?? dirs[0].split('/').filter(Boolean).pop()!;
  const root = `${base}/${vaultName}`;
  sh(`mkdir -p ${q(root)}`);
  for (const d of dirs) {
    const local = resolve(REPO, d);
    const leaf = d.split('/').filter(Boolean).pop()!;
    const target = leaf.startsWith('.') ? `${root}/${leaf}` : root;
    sh(`mkdir -p ${q(target)}`);
    const r = adb(['push', `${local}/.`, target]);
    assert.equal(r.status, 0, `adb push ${d}: ${r.stderr || r.stdout}`);
  }
  return root;
}

/** The shell fixture with `new-empty/.tegg/` (docs/acceptance/android-shell.md "Fixtures"). */
export function pushShell(name = 'shell'): string {
  return pushVault(['tests/fixtures/vaults/shell', 'tests/fixtures/vaults/new-empty/.tegg'], name);
}

/** Writes a file in shared storage with exact bytes (via a local temp file and `adb push`). */
export function writeShared(path: string, bytes: string | Buffer): void {
  const r = adb(['shell', `cat > ${q(path)}`], typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
  assert.equal(r.status, 0, `write ${path}: ${r.stderr}`);
}

/** `test-env.json` in the app's private files dir (contract §7.1); `TEGG_PERF_LOG` defaults to `files/perf.jsonl`. */
export function writeTestEnv(id: string, env: Record<string, string>): void {
  const all = { TEGG_TEST: '1', TEGG_PERF_LOG: `/data/user/0/${id}/files/${PERF_LOG}`, TEGG_TEST_TIDY: '0', ...env };
  const json = JSON.stringify(all);
  runAs(id, `mkdir -p files && printf '%s' ${q(json)} > files/test-env.json`);
}

export type Mark = { mark: string; ms: number; [k: string]: unknown };
export function perfMarks(id: string): Mark[] {
  const out = runAs(id, `cat files/${PERF_LOG} 2>/dev/null || true`, false);
  return out.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as Mark]; } catch { return []; } });
}

export type FileState = { sha256: string; size: number; inode: number; mtime: number };
/** SHA-256, size, inode and mtime (s) of every file under `root` (relative path → state), or of one file. */
export function fileState(path: string): Record<string, FileState> {
  const out = sh(`cd ${q(path)} 2>/dev/null && find . -type f -print0 | xargs -0 -r sh -c 'for f; do printf "%s\\t%s\\t" "$f" "$(sha256sum "$f" | cut -d" " -f1)"; stat -c "%s %i %Y" "$f"; done' sh`, false);
  const res: Record<string, FileState> = {};
  for (const line of out.split('\n').filter(Boolean)) {
    const [f, sha, st] = line.split('\t');
    const [size, inode, mtime] = (st ?? '').trim().split(' ').map(Number);
    res[f.replace(/^\.\//, '')] = { sha256: sha, size, inode, mtime };
  }
  return res;
}

/** Names (raw bytes as hex) of the entries of a folder in shared storage. */
export function listHex(dir: string): string[] {
  return sh(`ls -1a ${q(dir)} | while IFS= read -r n; do printf '%s' "$n" | od -An -tx1 | tr -d ' \\n'; echo; done`, false).split('\n').filter(Boolean);
}
export const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');

/** utime + stime of `pid` in clock ticks (`/proc/<pid>/stat` fields 14, 15) and the tick rate. */
export function cpuTicks(pid: number): { ticks: number; hz: number } {
  const stat = sh(`cat /proc/${pid}/stat`);
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const hz = Number(sh('getconf CLK_TCK', false).trim()) || 100;
  return { ticks: Number(fields[11]) + Number(fields[12]), hz };
}

export function uidOf(id: string): number {
  const m = /(?:userId|appId)=(\d+)/.exec(sh(`dumpsys package ${id}`));
  assert.ok(m, `dumpsys package ${id} names its userId`);
  return Number(m![1]);
}

/** Lines of `/proc/net/{tcp,tcp6,udp,udp6}` whose uid column is `uid`. */
export function socketsOf(uid: number): string[] {
  const out: string[] = [];
  for (const t of ['tcp', 'tcp6', 'udp', 'udp6']) {
    for (const line of sh(`cat /proc/net/${t}`, false).split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 7 && Number(cols[7]) === uid) out.push(`${t}: ${line.trim()}`);
    }
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function eventually<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, ms: number, step = 100): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v) && Date.now() < end) {
    await sleep(step);
    v = await get();
  }
  return v;
}

// ------------------------------------------------------------------------------------------------ the WebView (CDP)

export type WebView = {
  eval<T = unknown>(expr: string): Promise<T>;
  waitFor(selector: string, ms?: number): Promise<boolean>;
  click(selector: string): Promise<void>;
  type(text: string): Promise<void>;
  key(key: 'Enter' | 'End' | 'Escape'): Promise<void>;
  /** Installs a MutationObserver; the returned function tells whether `selector` was ever in the DOM since. */
  observeNever(selector: string): Promise<() => Promise<boolean>>;
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  close(): void;
};

async function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}

/** Connects to the app's WebView (the `main` page) through CDP. */
export async function webview(id: string, ms = 30_000): Promise<WebView> {
  const pid = await eventually(() => pidOf(id), (p) => p !== null, ms);
  assert.ok(pid, `${id} is running`);
  const port = await freePort();
  const fwd = adb(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
  assert.equal(fwd.status, 0, `adb forward to the WebView of ${id}: ${fwd.stderr}`);
  const targets = await eventually(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl?: string; url: string }[]; } catch { return []; }
  }, (t) => t.some((x) => x.type === 'page' && x.webSocketDebuggerUrl), ms, 250);
  const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
  assert.ok(page, `a debuggable WebView page in ${id} (WebContentsDebugging on in the test APK, contract §6)`);
  const ws = new WebSocket(page!.webSocketDebuggerUrl!);
  await new Promise<void>((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('CDP socket'))); });
  let seq = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String((e as MessageEvent).data));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
  });
  // A DevTools call fails after 30 s instead of waiting forever on a dead connection (AC-Test-Change, approved by the
  // owner).
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((res, rej) => {
    const i = ++seq;
    const timer = setTimeout(() => { pending.delete(i); rej(new Error(`CDP ${method}: no answer in 30 s (a dead WebView connection?)`)); }, 30_000);
    pending.set(i, (m) => { clearTimeout(timer); res(m); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async <T>(expr: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    assert.ok(!r.result?.exceptionDetails, `WebView eval failed: ${JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails)}`);
    return r.result?.result?.value as T;
  };
  const view: WebView = {
    eval: evaluate,
    waitFor: async (selector, wait = 5000) => (await eventually(() => evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`), (v) => v, wait, 100)) === true,
    click: async (selector) => {
      const ok = await evaluate<boolean>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`);
      assert.ok(ok, `click: ${selector} is on the page`);
    },
    type: async (text) => { await send('Input.insertText', { text }); },
    key: async (key) => {
      const code = { Enter: 13, End: 35, Escape: 27 }[key];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
    },
    observeNever: async (selector) => {
      const name = `__teggSeen${++seq}`;
      await evaluate(`(() => { const s = ${JSON.stringify(selector)}; window.${name} = !!document.querySelector(s); new MutationObserver(() => { if (document.querySelector(s)) window.${name} = true; }).observe(document, { childList: true, subtree: true, attributes: true }); return true; })()`);
      return () => evaluate<boolean>(`!!window.${name}`);
    },
    invoke: <T>(cmd: string, args: Record<string, unknown> = {}) => evaluate<T>(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }))`),
    close: () => { try { ws.close(); } catch { /* closed */ } adb(['forward', '--remove', `tcp:${port}`]); },
  };
  return view;
}

/** The text of the page's visible `main` (its `aria-label`), or null. */
export const mainLabel = (v: WebView) => v.eval<string | null>(`(() => { const m = [...document.querySelectorAll('main,[role=main]')].find((e) => e.getClientRects().length > 0); return m ? m.getAttribute('aria-label') : null; })()`);

/** `index_type_counts` through the app's own IPC (the counts the sidebar shows). */
export async function typeCounts(v: WebView): Promise<Record<string, number>> {
  const r = await v.invoke<{ ok: boolean; v: Record<string, number> }>('index_type_counts');
  assert.ok(r.ok, `index_type_counts: ${JSON.stringify(r)}`);
  return r.v;
}

/** `index_search` paths for `text` through the app's IPC. */
export async function searchPaths(v: WebView, text: string): Promise<string[]> {
  const r = await v.invoke<{ ok: boolean; v: { results: { path: string }[] } }>('index_search', { query: { text, types: [], tags: [], offset: 0, limit: 50 } });
  assert.ok(r.ok, `index_search ${text}: ${JSON.stringify(r)}`);
  return r.v.results.map((x) => x.path.normalize('NFC'));
}

/** The shell fixture's type counts (docs/acceptance/android-shell.md "Fixtures"). */
export const SHELL_COUNTS: Record<string, number> = { page: 2, 'quick-note': 2, task: 1, 'schůzka': 1, recept: 1 };

// ------------------------------------------------------------------------------------------------ native screens

/** The accessibility tree (`uiautomator dump`) as XML: native screens, and the release APK (not debuggable, no CDP). */
export function uiDump(): string {
  sh('uiautomator dump /sdcard/tegg-ui.xml >/dev/null 2>&1', false);
  return sh('cat /sdcard/tegg-ui.xml', false);
}
/** Taps the centre of the first node whose text or content-desc equals `text`. */
export function tapText(text: string): void {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const re = new RegExp(`<node[^>]*(?:text|content-desc)="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const size = /(\d+)x(\d+)/.exec(sh('wm size', false));
  const height = size ? Number(size[2]) : Infinity;
  // A node below the visible area (a long list above it, or under the keyboard) is brought into view first, at most 6
  // tries. With the keyboard shown, only the top half of the screen counts as visible.
  for (let i = 0; ; i++) {
    const m = re.exec(uiDump());
    const box = m ? m.slice(1).map(Number) : null;
    const h = Number.isFinite(height) ? height : 2400;
    const w = size ? Number(size[1]) : 1080;
    const ime = /mInputShown=true/.test(sh('dumpsys input_method', false));
    const visibleBottom = ime ? h * 0.5 : h - 150;
    const onScreen = box !== null && box[3] > box[1] && (box[1] + box[3]) / 2 < visibleBottom;
    if (onScreen || i >= 6) {
      assert.ok(box && onScreen, `a node "${text}" is on the screen`);
      const [x1, y1, x2, y2] = box!;
      sh(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
      return;
    }
    // The WebView doesn't resize for the keyboard (AND-2's phone layout), so a node under it is reached by closing the
    // keyboard: Back while the keyboard is shown only closes it.
    if (ime) sh('input keyevent 4');
    else sh(`input swipe ${Math.round(w / 2)} ${Math.round(visibleBottom - 100)} ${Math.round(w / 2)} ${Math.round(h * 0.15)} 400`);
  }
}

/** Types ASCII `text` into the focused field (`input text`; spaces as %s). */
export function inputText(text: string): void {
  sh(`input text ${quote(text.replace(/ /g, '%s'))}`);
}
/** `adb root` (the google_apis emulator image allows it), for writing the release build's private files (AR-08 AC-5). */
export function adbRoot(): void {
  const r = adb(['root']);
  assert.equal(r.status, 0, `adb root: ${r.stderr || r.stdout}`);
  adb(['wait-for-device']);
}
/** The release-variant APK for the LA checks of the release build (FR-UX-01 AC-7, AR-08 AC-5): built for 0.5.0 by the
 *  `app-android-e2e` step and signed with the throwaway test key (red-test decision; the owner's key never is). */
export function releaseApk(): string {
  const p = process.env.TEGG_LA_RELEASE_APK ?? '';
  assert.ok(p && existsSync(p), 'TEGG_LA_RELEASE_APK names a release-variant APK built for 0.5.0 (app-android-e2e step)');
  return p;
}
