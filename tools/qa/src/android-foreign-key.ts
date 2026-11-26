// Slice AND-3 (D-2557 (3); docs/contracts/android-shell.md §10.2 unchanged): every worktree signs its test APKs with its
// own throwaway key (tools/android/sign.sh, `.verify/android/`), so `adb install -r` fails with
// INSTALL_FAILED_UPDATE_INCOMPATIBLE when the emulator still holds the same app from another worktree. Before the LA
// step installs anything, this uninstalls each app whose installed signing certificates differ from the APK about to be
// installed:
//   node tools/qa/src/android-foreign-key.ts <apk>…
// Emulator only: the target (`ANDROID_SERIAL` or `adb get-serialno`) must be an `emulator-<port>` serial that reports
// `ro.kernel.qemu` or `ro.boot.qemu` = 1; otherwise nothing is touched and it exits 1. Needs tools/android/env.sh.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The signer SHA-256 digests in `apksigner verify --print-certs` output, sorted and deduplicated. */
export function signerDigests(apksignerOutput: string): string[] {
  const all = [...apksignerOutput.matchAll(/Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)/g)].map((m) => m[1].toLowerCase());
  return [...new Set(all)].sort();
}

/** An emulator serial as adb prints it (`emulator-5554`); a physical device's serial never has this form. */
export const isEmulatorSerial = (serial: string) => /^emulator-\d+$/.test(serial.trim());

export type Action = 'absent' | 'keep' | 'uninstall' | 'unknown';

/** What to do with an installed app: `installed` is null when the package isn't installed, `[]` when its certificates
 *  couldn't be read (left alone: the harness's install then reports what it finds). */
export function decide(installed: string[] | null, wanted: string[]): Action {
  if (installed === null) return 'absent';
  if (installed.length === 0 || wanted.length === 0) return 'unknown';
  return installed.length === wanted.length && installed.every((d, i) => d === wanted[i]) ? 'keep' : 'uninstall';
}

function sdkTool(name: string): string {
  const home = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools';
  return join(home, 'build-tools/36.0.0', name);
}

const out = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  return { ok: !r.error && r.status === 0, stdout: r.stdout ?? '', stderr: r.error ? String(r.error) : (r.stderr ?? '') };
};

const digestsOf = (apk: string) => signerDigests(out(sdkTool('apksigner'), ['verify', '--print-certs', apk]).stdout);
const packageOf = (apk: string) => /package: name='([^']+)'/.exec(execFileSync(sdkTool('aapt2'), ['dump', 'badging', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))?.[1] ?? '';

function main(apks: string[]): number {
  if (apks.length === 0) {
    console.error('usage: android-foreign-key <apk>…');
    return 2;
  }
  const serial = (process.env.ANDROID_SERIAL ?? out('adb', ['get-serialno']).stdout).trim();
  const qemu = isEmulatorSerial(serial)
    ? ['ro.kernel.qemu', 'ro.boot.qemu'].some((p) => out('adb', ['-s', serial, 'shell', 'getprop', p]).stdout.trim() === '1')
    : false;
  if (!isEmulatorSerial(serial) || !qemu) {
    console.error(`android-foreign-key: the adb target ${JSON.stringify(serial)} is not an emulator; nothing uninstalled`);
    return 1;
  }
  const adb = (args: string[]) => out('adb', ['-s', serial, ...args]);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-foreign-key-'));
  try {
    for (const apk of apks) {
      const id = packageOf(apk);
      if (!id) { console.error(`android-foreign-key: no package name in ${apk}`); return 1; }
      const path = /^package:(.+\.apk)\s*$/m.exec(adb(['shell', 'pm', 'path', id]).stdout)?.[1];
      let installed: string[] | null = null;
      if (path) {
        const local = join(tmp, `${id}.apk`);
        installed = adb(['pull', path, local]).ok ? digestsOf(local) : [];
      }
      // "Uninstalled, data kept" (`pm uninstall -k`): no `pm path`, but the package and its signature stay registered, so
      // an install signed with another key still fails. Removing it loses only test data on the emulator.
      if (!path && new RegExp(`^package:${id.replace(/\./g, '\\.')}\\s*$`, 'm').test(adb(['shell', 'pm', 'list', 'packages', '-u']).stdout)) {
        const r = adb(['uninstall', id]);
        console.log(`android-foreign-key: ${id} was kept with its data after an uninstall; ${r.ok ? 'uninstalled' : `uninstall failed: ${r.stderr || r.stdout}`}`);
        if (!r.ok) return 1;
        continue;
      }
      const action = decide(installed, digestsOf(apk));
      if (action === 'uninstall') {
        const r = adb(['uninstall', id]);
        console.log(`android-foreign-key: ${id} was signed with another key; ${r.ok ? 'uninstalled' : `uninstall failed: ${r.stderr || r.stdout}`}`);
        if (!r.ok) return 1;
      } else if (action === 'unknown') console.log(`android-foreign-key: ${id}: signing certificates unreadable; left installed`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2));
