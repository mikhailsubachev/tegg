// Guard for every real-app (L6) test file, loaded with `node --import ./e2e/helpers/l6-guard.ts --test …` (qa.config.json
// `app-e2e`, `app-e2e-nightly`, `app-perf`; `npm run test:e2e`). `node --test` runs each file in its own process, so this
// runs once per file. It keeps one failure from failing the rest of the run:
// - **Locked screen:** XCTest's click asserts in SkyLight (`SLSGetDisplaysWithRect`) and kills WebDriverAgent while the
//   screen is locked or the display sleeps (L6 run of 2026-11-01). A locked screen fails the file at once with a clear
//   message; while the file runs, `caffeinate` keeps the display awake (D-62's nightly runs under `caffeinate` too).
// - **A dead WebDriverAgent:** when its runner crashes, `xcodebuild` keeps running, so the Mac2 driver still thinks
//   WebDriverAgent is up and every later session fails with ECONNREFUSED. The watchdog stops that `xcodebuild` once its
//   runner is gone; the next session then starts a new WebDriverAgent.
// - **A leftover app:** after such a crash `end()` cannot quit the test build, and Tegg is single-instance, so the next
//   launch (`preflight()`, `spawnApp`) hands off to the leftover copy and never shows its route. Leftover copies of the
//   test build are quit when a file starts and when WebDriverAgent dies.
// Only the test build of this checkout (`APP`) and Appium's own WebDriverAgent are touched; never Tegg Preview.
import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const EXE = resolve(import.meta.dirname, '../../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const RUNNER = 'WebDriverAgentRunner-Runner.app/Contents/MacOS/WebDriverAgentRunner-Runner';
const XCODEBUILD = 'xcodebuild .*test-without-building .*WebDriverAgentMac';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pids(pattern: string): number[] {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number).filter((p) => p !== process.pid);
  } catch {
    return [];
  }
}
function kill(list: number[], signal: NodeJS.Signals = 'SIGTERM') {
  for (const p of list) {
    try { process.kill(p, signal); } catch { /* already gone */ }
  }
}
const appPids = () => pids(`^${escape(EXE)}`);

function screenLocked(): boolean {
  try {
    return /"CGSSessionScreenIsLocked"=Yes/.test(execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

if (screenLocked()) {
  throw new Error('L6 needs an unlocked screen: XCTest cannot click while the screen is locked. Unlock the Mac and run again.');
}

// The display stays on while this file runs (-d), the Mac stays awake (-i), and the display wakes now (-u).
spawn('caffeinate', ['-di', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
spawn('caffeinate', ['-u', '-t', '2'], { stdio: 'ignore', detached: true }).unref();

// A leftover test build from an earlier file.
kill(appPids());

// The watchdog: an xcodebuild whose runner was seen and is gone for two polls in a row is stopped.
let seenRunner = false;
let missing = 0;
setInterval(() => {
  const xcode = pids(XCODEBUILD);
  if (!xcode.length) { seenRunner = false; missing = 0; return; }
  if (pids(RUNNER).length) { seenRunner = true; missing = 0; return; }
  if (!seenRunner || ++missing < 2) return;
  console.error('[l6-guard] WebDriverAgent died; stopping its xcodebuild and the test build so the next session starts clean');
  kill(xcode);
  kill(appPids());
  setTimeout(() => kill(pids(XCODEBUILD), 'SIGKILL'), 3000).unref();
  seenRunner = false;
  missing = 0;
}, 1000).unref();
