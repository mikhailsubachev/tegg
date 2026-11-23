// Slice AND-1 (D-2032, D-2041; docs/contracts/android-shell.md §10.2): the APKs of the LA layer, signed with the
// throwaway key of tools/android/sign.sh (never the owner's key).
//   npm run app:android-test                    the test APK: release variant, no `preview` feature (reads
//                                               test-env.json), 0.0.1, `app.tegg.desktop`, debuggable →
//                                               src-tauri/target/android/Tegg-test.apk
//   npm run app:android-test -- --release 0.5.0 a release-variant APK as the release builds it (`preview`,
//                                               `app.tegg.preview`, debuggable for DevTools, D-2051), for FR-UX-01 AC-7 and AR-08
//                                               AC-5 → src-tauri/target/android/Tegg-<v>-testkey.apk
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '..');
const i = process.argv.indexOf('--release');
const release = i >= 0 ? process.argv[i + 1] : null;
if (i >= 0 && !/^\d+\.\d+\.\d+$/.test(release ?? '')) { console.error('usage: npm run app:android-test [-- --release <version>]'); process.exit(2); }
const env = JSON.parse(execSync(`. "${repo}/tools/android/env.sh" >&2 && node -e 'console.log(JSON.stringify(process.env))'`, { shell: '/bin/sh', encoding: 'utf8' }));
const signing = execFileSync(join(repo, 'tools/android/sign.sh'), { env, encoding: 'utf8' }).trim();
const version = release ?? '0.0.1';
const args = ['tauri', 'android', 'build', '--apk', '--target', 'aarch64', ...(release ? ['--features', 'preview'] : []), '--config', JSON.stringify({ version })];
execFileSync('npx', args, {
  cwd: app,
  stdio: 'inherit',
  env: {
    ...env,
    TEGG_ANDROID_SIGNING: signing,
    TEGG_ANDROID_APP_ID: release ? 'app.tegg.preview' : 'app.tegg.desktop',
    // The LA layer reads both APKs' pages over DevTools (D-2051); only the real release is non-debuggable (AR-08 AC-4).
    ORG_GRADLE_PROJECT_teggDebuggable: 'true',
    ...(release ? { TEGG_VERSION: release } : {}),
  },
});
const out = join(app, 'src-tauri/target/android');
mkdirSync(out, { recursive: true });
const dest = join(out, release ? `Tegg-${release}-testkey.apk` : 'Tegg-test.apk');
copyFileSync(join(app, 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'), dest);
console.log(`APK: ${dest}`);
