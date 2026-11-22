// D-1514, D-1512, D-2011, D-2022: build a Tegg release. `npm run app:release -- <MAJOR.MINOR.PATCH> [--apk]` (run
// from `app/`, in a clean checkout of main) builds Tegg.app and its DMG with the release identity (feature `preview`,
// tauri.preview.conf.json: bundle id `app.tegg.preview`, Application Support `Tegg Preview`) and, unless `--no-apk`, the
// signed release APK with `--apk` (`app.tegg.preview`, the owner's key, D-2021; Mac only by default until AND-3, D-2043). It sets the version and the sidebar label
// (`TEGG_VERSION`), checks the APK (tools/qa apk-check), then installs `~/Applications/Tegg.app` (removing the old
// `Tegg Preview.app`) and leaves `Tegg-<v>.dmg`, `Tegg-<v>.zip` and `Tegg-<v>.apk` in
// `src-tauri/target/release/bundle/release/`. The steps are planned in release-plan.mjs.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultSigningPath, releasePlan, signingConfig, versionCode } from './release-plan.mjs';

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--')) ?? '';
// D-2043: Mac only until AND-3 releases the first APK (D-2042); `--apk` opts in.
const apk = args.includes('--apk');
const usage = () => { console.error('usage: npm run app:release -- <MAJOR.MINOR.PATCH> [--apk]   (e.g. 0.1.0; MINOR and PATCH at most 999)'); process.exit(2); };
try { versionCode(version); } catch { usage(); }

const app = resolve(import.meta.dirname, '..');
const repo = resolve(app, '..');
const signing = defaultSigningPath();
const plan = releasePlan({ version, apk, signing, repo });
const bundle = join(app, 'src-tauri/target/release/bundle');
const out = join(bundle, 'release');
const apkOut = join(out, `Tegg-${version}.apk`);
const androidEnv = () => JSON.parse(execSync(`. "${repo}/tools/android/env.sh" >&2 && node -e 'console.log(JSON.stringify(process.env))'`, { shell: '/bin/sh', encoding: 'utf8' }));
let env = process.env;

for (const step of plan.steps) {
  try {
    if (step.id === 'check-signing') {
      signingConfig(signing, repo); // a missing config or an in-repo key stops the release before any build
      env = androidEnv();
    } else if (step.id === 'copy-mac') {
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      const dmg = readdirSync(join(bundle, 'dmg')).find((f) => f.endsWith('.dmg') && f.includes(version));
      if (!dmg) throw new Error(`no DMG for ${version} in ${join(bundle, 'dmg')}`);
      copyFileSync(join(bundle, 'dmg', dmg), join(out, `Tegg-${version}.dmg`));
      execFileSync('ditto', ['-c', '-k', '--keepParent', join(bundle, 'macos/Tegg.app'), join(out, `Tegg-${version}.zip`)], { stdio: 'inherit' });
    } else if (step.id === 'copy-apk') {
      copyFileSync(step.args[0], step.args[1]);
    } else if (step.id === 'install-app') {
      const apps = join(homedir(), 'Applications');
      mkdirSync(apps, { recursive: true });
      rmSync(join(apps, 'Tegg Preview.app'), { recursive: true, force: true });
      rmSync(join(apps, 'Tegg.app'), { recursive: true, force: true });
      execFileSync('ditto', step.args, { stdio: 'inherit' });
    } else {
      execFileSync(step.cmd, step.args, { cwd: app, stdio: 'inherit', env: { ...env, ...step.env } });
    }
  } catch (e) {
    // AR-08 AC-1, AC-6: a failed APK build or check leaves no APK and installs nothing.
    rmSync(apkOut, { force: true });
    console.error(`release ${version}: step ${step.id} failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    process.exit(1);
  }
}
console.log(`Tegg ${version}: installed ~/Applications/Tegg.app; assets in ${out}`);
