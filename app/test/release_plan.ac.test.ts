// Slice AND-1, L1 (Vitest, Node): the release command's pure parts for docs/acceptance/android-shell.md AR-08 AC-1,
// AC-2, AC-3, AC-6 (D-2011, D-2021, D-2022; RA1, RA7), through docs/contracts/android-shell.md §10.1:
// `app/scripts/release-plan.mjs` exports `versionCode(v)`, `releasePlan({ version, apk, signing, repo })` →
// `{ steps: [{ id, cmd, args, env }], outputs }` and `signingConfig(path, repo)`.
// - AC-1: the plan's steps, their order and the APK build call (`--target aarch64`, `--features preview`, the preview
//   config, `TEGG_VERSION`, `TEGG_ANDROID_SIGNING`); `--no-apk` (`apk: false`) plans the Mac app only.
// - AC-2: `versionCode` gives RA7's examples and refuses MINOR or PATCH above 999; the CLI exits 2 before any build for
//   such a version (run with every build tool stubbed on PATH and a temporary HOME, so nothing can be built or
//   installed); `tauri.conf.json` keeps `0.0.0`.
// - AC-3: `signingConfig` reads the properties file and refuses a missing file or a `storeFile` inside the repository;
//   the L0 part: no keystore or properties file is tracked, and `gen/android/.gitignore` ignores them (contract §8).
// - AC-6: the plan runs `apk-check --expect release --version <v>` on `Tegg-<v>.apk` after copying it and before
//   anything is installed. The runner's clean-up when a step fails (APK removed, nothing installed) has no seam in the
//   contract; the APK layer covers the built file (red-test decision, reported).
// Written from the ACs and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type Mod = Record<string, any>;
const APP = resolve(import.meta.dirname, '..');
const REPO = resolve(APP, '..');

async function plan(): Promise<Mod> {
  const path = '../scripts/release-plan.mjs';
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, 'app/scripts/release-plan.mjs loads (contract §10.1)');
  for (const f of ['versionCode', 'releasePlan', 'signingConfig']) assert.equal(typeof m![f], 'function', `release-plan.mjs exports ${f}()`);
  return m!;
}

type Step = { id: string; cmd: string; args: string[]; env?: Record<string, string> };

/** A signing config outside the repository with a stand-in key file (the pure function only reads the file). */
function signingFile(storeInRepo = false): { file: string; store: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tegg-signing-'));
  const store = storeInRepo ? join(REPO, 'app/src-tauri/gen/android/tegg-release.jks') : join(dir, 'tegg-release.jks');
  if (!storeInRepo) writeFileSync(store, 'throwaway key store stand-in');
  const file = join(dir, 'android-signing.properties');
  writeFileSync(file, `storeFile=${store}\nstorePassword=heslo-úložiště\nkeyAlias=tegg\nkeyPassword=heslo-klíče\n`, { mode: 0o600 });
  return { file, store };
}

const ids = (p: { steps: Step[] }) => p.steps.map((s) => s.id);

test('ar_08_ac1_release_builds_the_apk', async () => {
  const m = await plan();
  const { file } = signingFile();
  const p = m.releasePlan({ version: '0.5.0', apk: true, signing: file, repo: REPO }) as { steps: Step[]; outputs: unknown };
  const order = ids(p);
  for (const id of ['check-signing', 'build-app', 'build-apk', 'copy-apk', 'apk-check']) assert.ok(order.includes(id), `the plan has the step ${id}: ${order.join(', ')}`);
  const at = (id: string) => order.indexOf(id);
  assert.equal(at('check-signing'), 0, 'check-signing comes first (before any build)');
  assert.ok(at('build-app') < at('build-apk') && at('build-apk') < at('copy-apk') && at('copy-apk') < at('apk-check'), `order check-signing, build-app, build-apk, copy-apk, apk-check: ${order.join(', ')}`);
  const install = order.findIndex((id) => /install/.test(id));
  assert.ok(install > at('apk-check'), `Tegg.app is installed only after both builds and the APK check: ${order.join(', ')}`);

  const apk = p.steps[at('build-apk')];
  assert.equal(apk.cmd, 'npx', 'build-apk runs npx');
  const a = apk.args.join(' ');
  // D-2045: Tauri's identifier stays app.tegg.desktop (the Kotlin package); the application id comes from Gradle.
  assert.ok(!a.includes('tauri.preview.conf.json'), `build-apk does not pass the preview config: ${a}`);
  assert.equal(apk.env?.TEGG_ANDROID_APP_ID, 'app.tegg.preview', 'build-apk sets the application id app.tegg.preview');
  for (const part of ['tauri android build', '--apk', '--target aarch64', '--features preview']) {
    assert.ok(a.includes(part), `build-apk args contain "${part}": ${a}`);
  }
  const cfg = apk.args.filter((x, i) => apk.args[i - 1] === '--config').map((x) => { try { return JSON.parse(x); } catch { return null; } }).find((x) => x && typeof x === 'object');
  assert.deepEqual(cfg, { version: '0.5.0' }, 'build-apk passes --config {"version":"0.5.0"}');
  assert.equal(apk.env?.TEGG_VERSION, '0.5.0', 'build-apk sets TEGG_VERSION');
  assert.equal(apk.env?.TEGG_ANDROID_SIGNING, file, 'build-apk sets TEGG_ANDROID_SIGNING to the signing config');
  const copy = JSON.stringify(p.steps[at('copy-apk')]);
  assert.ok(copy.includes('bundle/release/Tegg-0.5.0.apk'), `copy-apk writes bundle/release/Tegg-0.5.0.apk: ${copy}`);
  const app = JSON.stringify(p.steps[at('build-app')]);
  assert.ok(app.includes('preview') && app.includes('0.5.0'), `build-app builds the preview Mac app for 0.5.0: ${app}`);
  const outs = JSON.stringify(p.outputs);
  for (const f of ['Tegg-0.5.0.dmg', 'Tegg-0.5.0.zip', 'Tegg-0.5.0.apk']) assert.ok(outs.includes(f), `outputs name ${f}: ${outs}`);

  const mac = m.releasePlan({ version: '0.5.0', apk: false, signing: file, repo: REPO }) as { steps: Step[]; outputs: unknown };
  for (const id of ['build-apk', 'copy-apk', 'apk-check']) assert.ok(!ids(mac).includes(id), `--no-apk: no ${id} step`);
  assert.ok(ids(mac).includes('build-app'), '--no-apk still builds the Mac app');
  assert.ok(!JSON.stringify(mac.outputs).includes('.apk'), '--no-apk: no APK in the outputs');
});

test('ar_08_ac2_apk_version', async () => {
  const m = await plan();
  assert.equal(m.versionCode('0.5.0'), 5000, '0.5.0 → 5000');
  assert.equal(m.versionCode('0.12.3'), 12003, '0.12.3 → 12003');
  assert.equal(m.versionCode('1.0.0'), 1000000, '1.0.0 → 1000000');
  assert.equal(m.versionCode('0.0.1'), 1, 'the test APK: 0.0.1 → 1');
  assert.equal(m.versionCode('2.999.999'), 2999999, 'MINOR and PATCH up to 999');
  for (const bad of ['0.1000.0', '0.1.1000']) assert.throws(() => m.versionCode(bad), RangeError, `${bad}: MINOR or PATCH above 999 → RangeError`);
  for (const bad of ['1.0', 'v1.0.0', '01.2.3', '']) assert.throws(() => m.versionCode(bad), RangeError, `${JSON.stringify(bad)}: not MAJOR.MINOR.PATCH → RangeError`);
  const { file } = signingFile();
  assert.throws(() => m.releasePlan({ version: '0.1000.0', apk: true, signing: file, repo: REPO }), 'releasePlan refuses 0.1000.0');

  // The CLI: exit 2 with the usage before any build. Every build tool is a stub that fails and logs (so even a wrong
  // implementation builds and installs nothing), HOME is temporary.
  const sandbox = mkdtempSync(join(tmpdir(), 'tegg-release-cli-'));
  const bin = join(sandbox, 'bin');
  mkdirSync(bin);
  const log = join(sandbox, 'calls.log');
  for (const tool of ['npx', 'npm', 'cargo', 'gh', 'ditto', 'hdiutil', 'codesign', 'xcrun', 'security', 'apksigner', 'aapt2', 'adb']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> '${log}'\nexit 1\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const conf = readFileSync(join(APP, 'src-tauri/tauri.conf.json'), 'utf8');
  for (const v of ['0.1000.0', '0.1.1000']) {
    const r = spawnSync(process.execPath, [join(APP, 'scripts/release.mjs'), v], {
      cwd: APP, encoding: 'utf8', timeout: 30_000,
      env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(sandbox, 'home'), TEGG_ANDROID_SIGNING: file },
    });
    assert.equal(r.status, 2, `release ${v} exits 2 (stderr: ${r.stderr})`);
    assert.match(`${r.stdout}${r.stderr}`, /usage/i, `release ${v} prints the usage`);
    assert.ok(!existsSync(log), `release ${v} runs no build step: ${existsSync(log) ? readFileSync(log, 'utf8') : ''}`);
  }
  assert.equal(readFileSync(join(APP, 'src-tauri/tauri.conf.json'), 'utf8'), conf, 'tauri.conf.json is not touched');
  assert.equal(JSON.parse(conf).version, '0.0.0', 'tauri.conf.json keeps version 0.0.0 (F9)');
});

test('ar_08_ac3_apk_signed_with_owner_key', async () => {
  const m = await plan();
  const { file, store } = signingFile();
  const c = m.signingConfig(file, REPO) as Record<string, unknown>;
  assert.equal(c.storeFile, store, 'signingConfig reads storeFile');
  assert.equal(c.keyAlias, 'tegg', 'and keyAlias');
  assert.equal(c.storePassword, 'heslo-úložiště', 'and storePassword');
  assert.equal(c.keyPassword, 'heslo-klíče', 'and keyPassword');

  const missing = join(tmpdir(), `tegg-no-such-${process.pid}`, 'android-signing.properties');
  assert.throws(() => m.signingConfig(missing, REPO), (e: unknown) => e instanceof Error && e.message.includes(missing) && !e.message.includes('\n'), 'a missing config: one line naming the expected file');
  const inRepo = signingFile(true);
  assert.throws(() => m.signingConfig(inRepo.file, REPO), (e: unknown) => e instanceof Error && /inside the repository/.test(e.message), 'a storeFile inside the repository is refused');

  const p = m.releasePlan({ version: '0.5.0', apk: true, signing: file, repo: REPO }) as { steps: Step[] };
  const check = p.steps.find((s) => s.id === 'check-signing');
  assert.ok(check && JSON.stringify(check).includes(file), 'check-signing names the signing config');

  // L0: nothing to sign with is tracked, and the Gradle project ignores it (contract §8).
  const ignore = join(REPO, 'app/src-tauri/gen/android/.gitignore');
  assert.ok(existsSync(ignore), 'app/src-tauri/gen/android/.gitignore exists');
  const ig = readFileSync(ignore, 'utf8').split('\n').map((l) => l.trim());
  for (const pat of ['*.jks', '*.keystore', 'keystore.properties', 'local.properties']) {
    assert.ok(ig.some((l) => l === pat || l === `/${pat}` || l === `**/${pat}`), `gen/android/.gitignore ignores ${pat}`);
  }
  const tracked = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n');
  const keys = tracked.filter((f) => /\.jks$|\.keystore$|(^|\/)keystore\.properties$|(^|\/)local\.properties$/.test(f));
  assert.deepEqual(keys, [], 'no *.jks, *.keystore, keystore.properties or local.properties is tracked');
});

test('ar_08_ac6_release_runs_apk_check', async () => {
  const m = await plan();
  const { file } = signingFile();
  const p = m.releasePlan({ version: '0.5.0', apk: true, signing: file, repo: REPO }) as { steps: Step[] };
  const order = ids(p);
  const check = p.steps.find((s) => s.id === 'apk-check');
  assert.ok(check, 'the plan has the step apk-check');
  const a = [check!.cmd, ...check!.args].join(' ');
  assert.ok(a.includes('apk-check'), `apk-check runs tools/qa's apk-check: ${a}`);
  assert.ok(a.includes('Tegg-0.5.0.apk'), `on Tegg-0.5.0.apk: ${a}`);
  assert.ok(/--expect release\b/.test(a), `with --expect release: ${a}`);
  assert.ok(/--version 0\.5\.0\b/.test(a), `with --version 0.5.0: ${a}`);
  assert.ok(order.indexOf('copy-apk') < order.indexOf('apk-check'), 'the check runs on the copied APK');
  const after = order.slice(order.indexOf('apk-check') + 1);
  const before = order.slice(0, order.indexOf('apk-check'));
  assert.ok(!before.some((id) => /install|github|release-assets|upload/.test(id)), `nothing is installed or published before the check: ${order.join(', ')}`);
  assert.ok(after.some((id) => /install/.test(id)), `the install comes after the check: ${order.join(', ')}`);
});
