// Spike S3 real-app suite (docs/acceptance/qa-infrastructure.md, S3-QA AC-1…AC-4; test-strategy L6).
// Prerequisites (once): full Xcode, `npm run setup` (installs the mac2 driver and opens
// WebDriverAgentMac), Accessibility + Automation permission for the terminal running this, and a
// built app: `npm run app:build` in the spike folder. Uses a fresh synthetic vault (D-62).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { remote } from 'webdriverio';
import { NetMonitor } from './netmon.ts';

const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg S3.app');
const BUNDLE_ID = 'app.tegg.spike-s3';
const TIMINGS = join(homedir(), 'Library/Application Support/Tegg/spike-s3/capture-timings.jsonl');
const RESULTS = resolve(import.meta.dirname, '../results');
const RUNS = Number(process.env.S3_TIMING_RUNS ?? 20);
const PORT = 4723;

// System Events key codes; ⌃⌥ = FR-CAP-05 defaults.
const KEY = { space: 49, t: 17, v: 9, enter: 36, escape: 53 } as const;
type Hotkey = 'quick' | 'task';

let appium: ChildProcess;
let driver: WebdriverIO.Browser;
let vault: string;
const net = new NetMonitor();

const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
const press = (code: number, mods: string[] = []) =>
  osa(`tell application "System Events" to key code ${code}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
// Real global hotkeys: posted system-wide while another app (Finder) is frontmost.
const hotkey = (k: Hotkey) => press(k === 'quick' ? KEY.space : KEY.t, ['control', 'option']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const timingLines = () =>
  existsSync(TIMINGS) ? readFileSync(TIMINGS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

function vaultFiles(folder: string) {
  const dir = join(vault, folder);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
}

async function waitFor<T>(fn: () => T | Promise<T>, ms = 5000, what = 'condition'): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

// Elements inside the WKWebView, found through the accessibility tree by their aria-label.
const byLabel = (label: string) => driver.$(`-ios predicate string:label == "${label}" OR title == "${label}"`);
const captureWindow = () => driver.$('-ios predicate string:elementType == 4 AND title == "Quick Capture"');

async function captureIsOpen() {
  const w = await captureWindow();
  return (await w.isExisting()) && (await w.isDisplayed());
}

async function focusOtherApp() {
  osa('tell application "Finder" to activate');
  await sleep(300);
}

/** Types into the capture field. Diacritics go through the pasteboard: synthesized keystrokes
 *  can't produce them reliably (found in S3 manual run), and paste is how users enter them too. */
async function typeCapture(text: string) {
  const field = await byLabel('Capture text');
  await field.waitForExist({ timeout: 3000 });
  if (/^[\x20-\x7e]*$/.test(text)) {
    await field.addValue(text);
  } else {
    execFileSync('pbcopy', { input: text });
    press(KEY.v, ['command']);
  }
}

async function saveWith(how: 'button' | 'cmd-enter') {
  if (how === 'button') await (await byLabel('Save capture')).click();
  else press(KEY.enter, ['command']);
}

before(async () => {
  assert.ok(existsSync(APP), `build the app first: ${APP}`);
  vault = mkdtempSync(join(tmpdir(), 'tegg-s3-appium-'));
  mkdirSync(RESULTS, { recursive: true });
  net.start();
  appium = spawn('npx', ['appium', '--port', String(PORT), '--log-level', 'error'], {
    cwd: import.meta.dirname,
    env: { ...process.env, APPIUM_HOME: resolve(import.meta.dirname, '.appium') },
    stdio: 'inherit',
  });
  await waitFor(() => fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.ok, () => false), 30000, 'appium');
  driver = await remote({
    hostname: '127.0.0.1',
    port: PORT,
    logLevel: 'warn',
    capabilities: {
      platformName: 'mac',
      'appium:automationName': 'Mac2',
      'appium:bundleId': BUNDLE_ID,
      'appium:appPath': APP,
      'appium:environment': { TEGG_S3_VAULT: vault },
      'appium:newCommandTimeout': 300,
    } as WebdriverIO.Capabilities,
  });
});

after(async () => {
  await driver?.execute('macos: terminateApp', { bundleId: BUNDLE_ID }).catch(() => {});
  await driver?.deleteSession().catch(() => {});
  appium?.kill();
});

test('s3_qa_ac1_main_window_can_be_closed_and_app_keeps_running', async () => {
  const close = await driver.$(
    '-ios class chain:**/XCUIElementTypeWindow[`title == "Tegg S3"`]/XCUIElementTypeButton[`identifier == "_XCUI:CloseWindow"`]',
  );
  await close.click();
  await waitFor(async () => !(await (await driver.$('-ios predicate string:elementType == 4 AND title == "Tegg S3"')).isDisplayed().catch(() => false)), 3000, 'main window hidden');
  const state = await driver.execute('macos: queryAppState', { bundleId: BUNDLE_ID });
  assert.ok(Number(state) >= 3, `app still running (state ${state})`);
});

for (const [name, kind, folder, text] of [
  ['quick_capture_hotkey', 'quick', 'Quick Notes', 'S3 hotkey capture'],
  ['new_task_hotkey', 'task', 'Tasks', 'S3 hotkey task'],
] as const) {
  test(`s3_qa_ac1_${name}_with_main_window_closed_creates_file`, async () => {
    await focusOtherApp();
    hotkey(kind);
    await waitFor(captureIsOpen, 3000, 'capture window');
    await typeCapture(text);
    await saveWith('cmd-enter');
    const file = await waitFor(() => vaultFiles(folder).find((f) => f === `${text}.md`), 3000, `${folder}/${text}.md`);
    const md = readFileSync(join(vault, folder, file), 'utf8');
    assert.match(md, new RegExp(`^type: ${kind === 'task' ? 'Task' : 'Quick Note'}$`, 'm'));
    assert.match(md, /^review: unreviewed$/m); // FR-CAP-04
    assert.ok(md.endsWith(`\n${text}\n`));
    await waitFor(async () => !(await captureIsOpen()), 2000, 'capture window to close after save');
  });
}

test('s3_qa_ac1_menu_bar_icon_click_with_main_window_closed_creates_file', async () => {
  await focusOtherApp();
  const item = await driver.$('-ios class chain:**/XCUIElementTypeStatusItem');
  await item.click();
  await waitFor(captureIsOpen, 3000, 'capture window');
  await typeCapture('S3 menu bar capture');
  await saveWith('button');
  await waitFor(() => vaultFiles('Quick Notes').includes('S3 menu bar capture.md'), 3000, 'menu bar file');
});

test('s3_qa_ac2_webview_interaction_reads_back_result', async () => {
  // Click a control inside the WKWebView and read the page's response back through accessibility.
  hotkey('quick');
  await waitFor(captureIsOpen, 3000, 'capture window');
  await (await byLabel('Save capture')).click(); // empty → page refuses and says so
  const status = await byLabel('Capture status');
  const said = await waitFor(async () => (await status.getText()) || (await status.getAttribute('value')), 2000, 'status text');
  assert.equal(said, 'Nothing to save');

  // Type Czech text with diacritics, read the field's value back, then save it (FR-FMT-12).
  const czech = 'Příliš žluťoučký kůň';
  await typeCapture(czech);
  const field = await byLabel('Capture text');
  assert.equal(String(await field.getAttribute('value')).normalize('NFC'), czech);
  await saveWith('button');
  await waitFor(() => vaultFiles('Quick Notes').includes(`${czech}.md`), 3000, 'Czech capture file');
});

test('s3_qa_ac3_capture_open_time_p95', async () => {
  const report: Record<string, unknown> = { runs: RUNS, target_ms: 300 };
  for (const kind of ['quick', 'task'] as Hotkey[]) {
    const internal: number[] = [];
    const external: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await focusOtherApp();
      const seen = timingLines().length;
      const t0 = performance.now();
      hotkey(kind);
      // External: hotkey posted → capture window reported on screen by accessibility (upper bound;
      // includes osascript and WebDriver round trips).
      await waitFor(captureIsOpen, 3000, 'capture window');
      external.push(performance.now() - t0);
      // Internal: hotkey handler → field focused and two frames painted (app's own log).
      const line = await waitFor(() => timingLines()[seen], 3000, 'timing line');
      internal.push(line.ms);
      press(KEY.escape);
      await waitFor(async () => !(await captureIsOpen()), 2000, 'capture closed');
    }
    report[kind] = { internal_p95_ms: p95(internal), external_p95_ms: Math.round(p95(external)), internal, external: external.map(Math.round) };
  }
  writeFileSync(join(RESULTS, 's3-capture-timing.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  for (const kind of ['quick', 'task'] as Hotkey[]) {
    assert.ok((report[kind] as { internal_p95_ms: number }).internal_p95_ms < 300, `${kind} p95 < 300 ms (FR-CAP-03)`);
  }
});

test('s3_qa_ac4_no_internet_sockets_during_suite', () => {
  const r = net.stop();
  writeFileSync(join(RESULTS, 's3-network.json'), JSON.stringify(r, null, 2));
  assert.ok(r.watched.length > 0, 'monitor saw the app processes');
  assert.deepEqual(r.sockets, [], 'NFR-SEC-01: no internet sockets');
});
