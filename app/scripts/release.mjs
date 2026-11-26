// D-1514, D-1512, D-2011, D-2022: build a Tegg release. `npm run app:release -- <MAJOR.MINOR.PATCH> [--no-apk]` (run
// from `app/`, in a clean checkout of main) builds Tegg.app and its DMG with the release identity (feature `preview`,
// tauri.preview.conf.json: bundle id `app.tegg.preview`, Application Support `Tegg Preview`) and, unless `--no-apk`, the
// signed release APK (`app.tegg.preview`, the owner's key, D-2021; every release since AND-3, D-2522; `--apk` is accepted
// and changes nothing). It sets the version and the sidebar label (`TEGG_VERSION`), checks the APK (tools/qa apk-check),
// then installs `/Applications/Tegg.app` (D-2227; removing the old `Tegg Preview.app` and an earlier copy in
// `~/Applications`) and leaves `Tegg-<v>.dmg`, `Tegg-<v>.zip` and `Tegg-<v>.apk` in
// `src-tauri/target/release/bundle/release/`. At the end it prints the `gh release create` command for the owner's
// release step (CP-11 → D-2537); it doesn't run it. The steps are planned in release-plan.mjs.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultSigningPath, githubRelease, parseReleaseArgs, releasePlan, signingConfig } from './release-plan.mjs';

// android-edit §16.1 (D-2522): the APK by default, `--no-apk` skips it, `--apk` is a no-op.
const parsed = parseReleaseArgs(process.argv.slice(2));
if (parsed.usage) {
  console.error('usage: npm run app:release -- <MAJOR.MINOR.PATCH> [--no-apk]   (e.g. 0.1.0; MINOR and PATCH at most 999)');
  process.exit(2);
}
const { version, apk } = parsed;

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
      // D-2227: one copy, in /Applications. Earlier releases installed into ~/Applications; that copy is removed.
      for (const apps of ['/Applications', join(homedir(), 'Applications')]) {
        rmSync(join(apps, 'Tegg Preview.app'), { recursive: true, force: true });
        rmSync(join(apps, 'Tegg.app'), { recursive: true, force: true });
      }
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
console.log(`Tegg ${version}: installed /Applications/Tegg.app; assets in ${out}`);
// CP-11 → D-2537: the GitHub release is the owner's separate step; print its command with the assets.
try {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const gh = githubRelease({ version, sha, outputs: plan.outputs });
  const q = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  console.log(`To publish: ${[gh.cmd, ...gh.args].map(q).join(' ')}`);
} catch (e) {
  console.error(`release ${version}: no GitHub command (${e instanceof Error ? e.message.split('\n')[0] : e})`);
}
