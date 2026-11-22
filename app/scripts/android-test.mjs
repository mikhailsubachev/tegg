// Slice AND-1 (D-2032, D-2041; docs/contracts/android-shell.md §10.2): `npm run app:android-test` builds the test APK:
// the release variant for arm64, without the `preview` feature (so it reads `test-env.json`), version 0.0.1, application
// id `app.tegg.desktop`, debuggable, signed with the throwaway key of tools/android/sign.sh. Output:
// `src-tauri/target/android/Tegg-test.apk`.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '..');
const env = JSON.parse(execSync(`. "${repo}/tools/android/env.sh" >&2 && node -e 'console.log(JSON.stringify(process.env))'`, { shell: '/bin/sh', encoding: 'utf8' }));
const signing = execFileSync(join(repo, 'tools/android/sign.sh'), { env, encoding: 'utf8' }).trim();
execFileSync('npx', ['tauri', 'android', 'build', '--apk', '--target', 'aarch64', '--config', JSON.stringify({ version: '0.0.1' })], {
  cwd: app,
  stdio: 'inherit',
  env: { ...env, TEGG_ANDROID_SIGNING: signing, TEGG_ANDROID_APP_ID: 'app.tegg.desktop', ORG_GRADLE_PROJECT_teggDebuggable: 'true' },
});
const out = join(app, 'src-tauri/target/android');
mkdirSync(out, { recursive: true });
copyFileSync(join(app, 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'), join(out, 'Tegg-test.apk'));
console.log(`test APK: ${join(out, 'Tegg-test.apk')}`);
