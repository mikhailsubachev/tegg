// Slice AND-1 (docs/contracts/android-shell.md §10.1; AR-08 AC-1…AC-3, AC-6; D-2011, D-2021, D-2022; RA7): the pure
// parts of `npm run app:release`: the version code, the signing config and the ordered steps. release.mjs runs them.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** RA7: MAJOR·10⁶ + MINOR·10³ + PATCH; MINOR and PATCH at most 999. */
export function versionCode(v) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v ?? ''));
  if (!m) throw new RangeError(`not a MAJOR.MINOR.PATCH version: ${v}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (min > 999 || pat > 999) throw new RangeError(`MINOR and PATCH must be at most 999 (versionCode): ${v}`);
  return maj * 1_000_000 + min * 1_000 + pat;
}

/** The signing config (D-2021): `~/.config/tegg/android-signing.properties` unless `TEGG_ANDROID_SIGNING` names another. */
export function defaultSigningPath(env = process.env) {
  return env.TEGG_ANDROID_SIGNING || join(homedir(), '.config/tegg/android-signing.properties');
}

/** Reads the signing properties; throws a one-line Error for a missing file or a key store inside the repository. */
export function signingConfig(path, repo) {
  if (!path || !existsSync(path)) throw new Error(`release: no Android signing config at ${path} (D-2021)`);
  const props = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) props[m[1]] = m[2];
  }
  for (const k of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
    if (!props[k]) throw new Error(`release: ${k} is missing in ${path} (D-2021)`);
  }
  const store = isAbsolute(props.storeFile) ? props.storeFile : resolve(path, '..', props.storeFile);
  const rel = relative(resolve(repo), store);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`release: the key store ${store} is inside the repository (D-2021)`);
  return { ...props, storeFile: store };
}

/** The ordered steps of a release. `apk: false` is `--no-apk` (the Mac app only, as before AND-1). */
export function releasePlan({ version, apk = true, signing, repo }) {
  versionCode(version);
  const app = join(repo, 'app');
  const bundle = join(app, 'src-tauri/target/release/bundle');
  const out = join(bundle, 'release');
  const apkOut = join(out, `Tegg-${version}.apk`);
  const steps = [];
  if (apk) steps.push({ id: 'check-signing', cmd: 'node', args: ['-e', 'check-signing', signing], env: {} });
  steps.push({
    id: 'build-app', cmd: 'npx',
    args: ['tauri', 'build', '--bundles', 'app,dmg', '--features', 'preview', '--config', 'src-tauri/tauri.preview.conf.json', '--config', JSON.stringify({ version })],
    env: { TEGG_VERSION: version },
  });
  if (apk) {
    // The Tauri identifier stays app.tegg.desktop (the Kotlin package the generated project was made for); the APK's
    // application id is app.tegg.preview, set in the Gradle project (D-2019).
    steps.push({
      id: 'build-apk', cmd: 'npx',
      args: ['tauri', 'android', 'build', '--apk', '--target', 'aarch64', '--features', 'preview', '--config', JSON.stringify({ version })],
      env: { TEGG_VERSION: version, TEGG_ANDROID_SIGNING: signing, TEGG_ANDROID_APP_ID: 'app.tegg.preview' },
    });
  }
  steps.push({ id: 'copy-mac', cmd: 'copy', args: [join(bundle, 'dmg'), join(out, `Tegg-${version}.dmg`), join(out, `Tegg-${version}.zip`)], env: {} });
  if (apk) {
    steps.push({ id: 'copy-apk', cmd: 'copy', args: [join(app, 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'), apkOut], env: {} });
    steps.push({ id: 'apk-check', cmd: 'node', args: [join(repo, 'tools/qa/src/apk-check.ts'), apkOut, '--expect', 'release', '--version', version], env: {} });
  }
  // D-2227: the app is installed into /Applications, the one place the owner opens it from.
  steps.push({ id: 'install-app', cmd: 'ditto', args: [join(bundle, 'macos/Tegg.app'), '/Applications/Tegg.app'], env: {} });
  const outputs = [join(out, `Tegg-${version}.dmg`), join(out, `Tegg-${version}.zip`), ...(apk ? [apkOut] : [])];
  return { steps, outputs };
}
