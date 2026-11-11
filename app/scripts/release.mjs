// D-1511, D-1512: build a Tegg release. `npm run app:release -- <MAJOR.MINOR.PATCH>` (run from `app/`, in a clean
// checkout of main) builds Tegg.app and its DMG with the release identity (feature `preview`, tauri.preview.conf.json:
// bundle id `app.tegg.preview`, Application Support `Tegg Preview`), sets the bundle version and the sidebar label
// (`TEGG_VERSION`), installs `~/Applications/Tegg.app` (removing the old `Tegg Preview.app`) and leaves
// `Tegg-<version>.dmg` and `Tegg-<version>.zip` in `src-tauri/target/release/bundle/release/`.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const version = process.argv[2] ?? '';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  console.error('usage: npm run app:release -- <MAJOR.MINOR.PATCH>   (e.g. 0.1.0)');
  process.exit(2);
}

const app = resolve(import.meta.dirname, '..');
const bundle = join(app, 'src-tauri/target/release/bundle');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: app, stdio: 'inherit', ...opts });

run('npx', ['tauri', 'build', '--bundles', 'app,dmg', '--features', 'preview',
  '--config', 'src-tauri/tauri.preview.conf.json', '--config', JSON.stringify({ version })],
  { env: { ...process.env, TEGG_VERSION: version } });

const built = join(bundle, 'macos/Tegg.app');
const out = join(bundle, 'release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const dmg = readdirSync(join(bundle, 'dmg')).find((f) => f.endsWith('.dmg') && f.includes(version));
if (!dmg) throw new Error(`no DMG for ${version} in ${join(bundle, 'dmg')}`);
copyFileSync(join(bundle, 'dmg', dmg), join(out, `Tegg-${version}.dmg`));
run('ditto', ['-c', '-k', '--keepParent', built, join(out, `Tegg-${version}.zip`)]);

const apps = join(homedir(), 'Applications');
mkdirSync(apps, { recursive: true });
rmSync(join(apps, 'Tegg Preview.app'), { recursive: true, force: true });
rmSync(join(apps, 'Tegg.app'), { recursive: true, force: true });
run('ditto', [built, join(apps, 'Tegg.app')]);
console.log(`Tegg ${version}: installed ~/Applications/Tegg.app; assets in ${out}`);
