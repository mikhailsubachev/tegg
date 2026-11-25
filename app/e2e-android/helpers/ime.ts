// Slice AND-3, the LA harness for the test input method (docs/contracts/android-edit.md §16.2, §17.2; AP-2084 → D-2519,
// CP-13 → D-2539): `tools/android/test-ime/` (application id `app.tegg.testime`, emulator only) runs one
// InputConnection call per ordered broadcast `app.tegg.testime.CMD` and answers with result data `ok` (or `started`,
// `no-connection`, `bad-op`). Each helper throws (AssertionError) unless the answer is the expected one, so a missing
// IME or a field without focus fails the test at the step. Test infrastructure only; no AC outcome is asserted here.
// Written from the ACs and the contract only (D-61).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { adb, REPO, sh } from './device.ts';

export const IME_ID = 'app.tegg.testime';
export const IME_SERVICE = `${IME_ID}/.TestIme`;
const SCRIPT = resolve(REPO, 'tools/android/test-ime.sh');
let installed = false;

/** The text's UTF-8 bytes as sent (an NFD string stays NFD). */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Builds (once per run) and installs the test IME, enables it and makes it the current keyboard (§16.2). */
export function imeUse(): void {
  if (!installed) {
    assert.ok(existsSync(SCRIPT), `the test IME's script exists: ${SCRIPT} (contract §16.2)`);
    for (const step of ['build', 'install']) {
      const r = spawnSync('sh', [SCRIPT, step], { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
      assert.equal(r.status, 0, `test-ime.sh ${step}: ${r.stderr || r.stdout}`);
    }
    installed = true;
  }
  sh(`ime enable ${IME_SERVICE}`, false);
  const set = sh(`ime set ${IME_SERVICE}`, false);
  assert.match(set, /selected|Input method/i, `ime set ${IME_SERVICE}: ${set}`);
}
/** Sets the emulator's default keyboard back (§16.2 `restore`). */
export function imeRestore(): void {
  if (existsSync(SCRIPT)) spawnSync('sh', [SCRIPT, 'restore'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
}

/** One ordered broadcast; returns the result data. */
function cmd(op: string, extras: string[], want: string[] = ['ok']): string {
  const r = adb(['shell', `am broadcast -a ${IME_ID}.CMD -p ${IME_ID} --es op ${op} ${extras.join(' ')}`]);
  assert.equal(r.status, 0, `am broadcast ${op}: ${r.stderr || r.stdout}`);
  const data = /data="([^"]*)"/.exec(r.stdout)?.[1] ?? '';
  assert.ok(want.some((w) => data === w || (w === '*' && data !== '' && !['no-connection', 'bad-op'].includes(data))), `test IME ${op}: answered ${JSON.stringify(data)} (${r.stdout.trim()})`);
  return data;
}

export const imeCompose = (text: string, cursor = 1) => { cmd('compose', [`--es b64 ${b64(text)}`, `--ei cursor ${cursor}`]); };
export const imeCommit = (text: string, cursor = 1) => { cmd('commit', [`--es b64 ${b64(text)}`, `--ei cursor ${cursor}`]); };
export const imeFinish = () => { cmd('finish', []); };
export const imeRegion = (start: number, end: number) => { cmd('region', [`--ei start ${start}`, `--ei end ${end}`]); };
export const imeDelete = (before: number, after: number) => { cmd('delete', [`--ei before ${before}`, `--ei after ${after}`]); };
/** `sendKeyEvent` DOWN and UP of a `KEYCODE_*` value (66 Enter, 67 Backspace). */
export const imeKey = (code: number) => { cmd('key', [`--ei code ${code}`]); };
export const imeSelect = (start: number, end: number) => { cmd('select', [`--ei start ${start}`, `--ei end ${end}`]); };
/** Commits one code point every `intervalMs` on the IME's own thread (§16.2 `type`); answers `started`. */
export const imeType = (text: string, intervalMs: number) => { cmd('type', [`--es b64 ${b64(text)}`, `--ei interval ${intervalMs}`], ['started']); };
/** Stops a running `type`; returns the count committed. */
export const imeStop = (): number => Number(cmd('stop', [], ['*']));
export const KEYCODE_ENTER = 66;
export const KEYCODE_DEL = 67;
