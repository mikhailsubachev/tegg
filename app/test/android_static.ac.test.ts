// Slice AND-1, L0 (static rules over the source tree, Vitest): docs/acceptance/android-shell.md
// - AR-03 AC-7 "Desktop-only code is compiled out" (F3): AC-7's symbols appear in `app/src-tauri/src/**` only inside an
//   item or module marked `#[cfg(desktop)]` or `#[cfg(target_os = "macos")]`; in `Cargo.toml`, `tauri-plugin-dialog`
//   and tauri's `tray-icon` and `macos-private-api` features are desktop-target dependencies only. The rule's own test
//   (a sample with an unguarded `TrayIconBuilder::new`) runs first. Rule: android-rules.ts.
// - NFR-SEC-01 AC-2 "The sources ask for none" (D-2002, AP-2034): the committed manifests outside a `debug` source set
//   hold no `INTERNET` permission (a `tools:node="remove"` entry is allowed); `cargo tree --target aarch64-linux-android`
//   has none of `tauri-plugin-http`, `tauri-plugin-updater`, `reqwest`, `ureq`; the Android capability grants no `http:`
//   or `shell:` permission.
// - AR-03 AC-12 "The macOS app is unchanged", parts (a) and (b) (the L0 check; (c) is the gates, (d) the Rust
//   fr_sto_07_ac12 test). Red-test readings (reported): (a) "the AND-1 branch" is the commits after `7ff0fc0b` that
//   name the Android track (`AND-` or a decision D-2000…D-2999), so later slices' approved AC-test changes don't count;
//   (b) `capabilities/capture.json` may differ from main at the merge-base (D-2053) only by `platforms: ["macOS"]`, as `default.json` (AR-03
//   AC-9 (c), (d) need it: a capability without `platforms` applies to Android too).
// Written from the ACs and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { moduleGated, rustFiles, unguarded } from './android-rules';

const REPO = resolve(import.meta.dirname, '../..');
const SHELL = join(REPO, 'app/src-tauri');
const BASE = '7ff0fc0b';
/** D-2053: (b) compares the desktop config with main where this branch last met it (the merge-base with `origin/main`,
 *  else `main`; HEAD itself when neither exists, so on main it holds by construction). */
function desktopBase(): string {
  for (const main of ['origin/main', 'main']) {
    const r = git(['merge-base', 'HEAD', main]);
    if (r.ok && r.out.trim()) return r.out.trim();
  }
  return 'HEAD';
}

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

// ------------------------------------------------------------------------------------------------ AR-03 AC-7

/** `[section] → lines` of a TOML file (no TOML parser needed for these checks). */
function tomlSections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur = '';
  out.set(cur, []);
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const h = /^\[([^\]]+)\]$/.exec(line);
    if (h) { cur = h[1].trim(); if (!out.has(cur)) out.set(cur, []); continue; }
    if (line) out.get(cur)!.push(line);
  }
  return out;
}

/** A `[target.'cfg(…)'.dependencies]` header whose cfg excludes Android. */
const desktopTarget = (h: string) => /^target\.'cfg\((.*)\)'\.dependencies$/.test(h) &&
  (/target_os\s*=\s*"macos"/.test(h) || /not\(\s*(any\()?[^)]*target_os\s*=\s*"android"/.test(h) || /desktop/.test(h)) && !/^target\.'cfg\(\s*target_os\s*=\s*"android"/.test(h);

test('ar_03_ac7_desktop_only_code_is_gated', () => {
  // The rule's own test.
  const sample = 'use tauri::Manager;\n\npub fn setup(app: &tauri::App) {\n    let _tray = TrayIconBuilder::new().build(app);\n}\n';
  assert.deepEqual(unguarded(sample), ['4: TrayIconBuilder'], 'the rule fires on an unguarded TrayIconBuilder::new');
  const guarded = '#[cfg(desktop)]\npub fn setup(app: &tauri::App) {\n    let _tray = TrayIconBuilder::new().on_menu_event(|a, e| { a.set_menu(e); }).build(app);\n}\n'
    + '#[cfg(target_os = "macos")]\nuse objc2::rc::Retained;\n'
    + 'pub fn run() {\n    #[cfg(desktop)]\n    let b = b.on_menu_event(|_, _| {});\n    let s = "{";\n}\n';
  assert.deepEqual(unguarded(guarded), [], 'items, statements and closures under #[cfg(desktop)] / #[cfg(target_os = "macos")] pass');
  assert.deepEqual(unguarded('// TrayIconBuilder::new() in a comment\nfn f() {}\n'), [], 'a comment does not count');
  assert.deepEqual(unguarded('#[cfg(not(desktop))]\nfn f() { let _ = UnixListener::bind("x"); }\n'), ['2: UnixListener'], 'cfg(not(desktop)) is no gate');

  // The shell's sources.
  const src = join(SHELL, 'src');
  const offenders: string[] = [];
  for (const f of rustFiles(src)) {
    const text = readFileSync(f, 'utf8');
    for (const hit of unguarded(text, undefined, moduleGated(src, f))) offenders.push(`${relative(REPO, f)}:${hit}`);
  }
  assert.deepEqual(offenders, [], 'desktop-only symbols outside #[cfg(desktop)] / #[cfg(target_os = "macos")] items');

  // Cargo.toml: the dialog plugin and the desktop-only tauri features are desktop-target dependencies.
  const toml = tomlSections(readFileSync(join(SHELL, 'Cargo.toml'), 'utf8'));
  const all = (toml.get('dependencies') ?? []).join('\n');
  assert.ok(!/^tauri-plugin-dialog\s*=/m.test(all), '[dependencies] has no tauri-plugin-dialog (desktop targets only)');
  const tauriLine = (toml.get('dependencies') ?? []).find((l) => /^tauri\s*=/.test(l)) ?? '';
  assert.ok(tauriLine, '[dependencies] keeps tauri');
  // D-2044: tauri-build checks this entry against tauri.conf.json's macOSPrivateApi, so that feature stays here.
  assert.ok(!tauriLine.includes('tray-icon'), `[dependencies] tauri has no "tray-icon" feature: ${tauriLine}`);
  const desk = [...toml.entries()].filter(([h]) => desktopTarget(h)).map(([, lines]) => lines.join('\n')).join('\n');
  assert.ok(/^tauri-plugin-dialog\s*=/m.test(desk), 'tauri-plugin-dialog is a desktop-target dependency');
  assert.ok(/^tauri\s*=.*"tray-icon"/m.test(desk), 'tauri\'s "tray-icon" feature is enabled for desktop targets only');
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-01 AC-2

function manifests(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['build', '.gradle', 'node_modules', 'target'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...manifests(p));
    else if (name === 'AndroidManifest.xml') out.push(p);
  }
  return out.sort();
}

const INTERNET = /<uses-permission\b[^>]*android:name\s*=\s*"android\.permission\.INTERNET"[^>]*>/g;

test('nfr_sec_01_ac2_android_sources_ask_for_no_network', () => {
  const main = join(SHELL, 'gen/android/app/src/main/AndroidManifest.xml');
  assert.ok(existsSync(main), 'app/src-tauri/gen/android/app/src/main/AndroidManifest.xml is committed (D-2018)');
  const files = manifests(SHELL).filter((f) => !relative(SHELL, f).split('/').includes('debug'));
  assert.ok(files.includes(main), 'the main manifest is checked');
  for (const f of files) {
    const xml = readFileSync(f, 'utf8');
    const asks = (xml.match(INTERNET) ?? []).filter((e) => !/tools:node\s*=\s*"remove"/.test(e));
    assert.deepEqual(asks, [], `${relative(REPO, f)} asks for no INTERNET permission`);
  }
  const mainXml = readFileSync(main, 'utf8');
  assert.match(mainXml, /android\.permission\.MANAGE_EXTERNAL_STORAGE/, 'the main manifest asks for MANAGE_EXTERNAL_STORAGE');

  const caps = readdirSync(join(SHELL, 'capabilities')).filter((f) => f.endsWith('.json'));
  const android = caps.map((f) => ({ f, j: JSON.parse(readFileSync(join(SHELL, 'capabilities', f), 'utf8')) }))
    .filter(({ j }) => !Array.isArray(j.platforms) || j.platforms.some((p: string) => p.toLowerCase() === 'android'));
  assert.ok(android.some(({ f }) => f === 'android.json'), 'capabilities/android.json applies to Android');
  for (const { f, j } of android) {
    const perms = (j.permissions ?? []).map((p: unknown) => (typeof p === 'string' ? p : (p as { identifier?: string }).identifier ?? ''));
    const net = perms.filter((p: string) => p.startsWith('http:') || p.startsWith('shell:'));
    assert.deepEqual(net, [], `${f} grants no http: or shell: permission on Android`);
  }

  const tree = spawnSync('cargo', ['tree', '--offline', '--target', 'aarch64-linux-android', '-e', 'normal', '--prefix', 'none', '--format', '{p}'], { cwd: SHELL, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(tree.status, 0, `cargo tree --target aarch64-linux-android runs: ${tree.stderr?.slice(-400)}`);
  const crates = new Set(tree.stdout.split('\n').map((l) => l.trim().split(' ')[0]).filter(Boolean));
  for (const c of ['tauri-plugin-http', 'tauri-plugin-updater', 'ureq']) assert.ok(!crates.has(c), `the Android build has no ${c}`);
  // D-2046: reqwest only as Tauri's own dependency (its dev-server proxy).
  if (crates.has('reqwest')) {
    const inv = spawnSync('cargo', ['tree', '--offline', '--target', 'aarch64-linux-android', '-e', 'normal', '-i', 'reqwest', '--depth', '1', '--prefix', 'none', '--format', '{p}'], { cwd: SHELL, encoding: 'utf8' });
    assert.equal(inv.status, 0, `cargo tree -i reqwest runs: ${inv.stderr?.slice(-400)}`);
    const users = [...new Set(inv.stdout.split('\n').map((l) => l.trim().split(' ')[0]).filter((n) => n && n !== 'reqwest'))];
    assert.deepEqual(users, ['tauri'], `reqwest is only Tauri's dependency: ${users.join(', ')}`);
  }
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-12

const AC_TEST = [/\.ac\.test\.tsx?$/, /(^|\/)tests\/ac_[^/]+\.rs$/];

test('ar_03_ac12_desktop_build_unchanged', () => {
  // (b) the desktop config and capabilities.
  // D-2053: the base is main at the merge-base; AND-1's own additions (`platforms`, `bundle.android`) are left out on
  // both sides, so the check also holds once AND-1 is on main.
  const MAIN = desktopBase();
  const atBase = (p: string) => { const r = git(['show', `${MAIN}:${p}`]); assert.ok(r.ok, `git show ${MAIN}:${p}`); return JSON.parse(r.out); };
  const noPlatforms = (o: Record<string, unknown>) => { const { platforms: _x, ...rest } = o; return rest; };
  const now = (p: string) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
  const def = now('app/src-tauri/capabilities/default.json');
  assert.deepEqual(def.platforms, ['macOS'], '(b) default.json gains platforms ["macOS"] (contract §1)');
  const { platforms: _p, ...defRest } = def;
  assert.deepEqual(defRest, noPlatforms(atBase('app/src-tauri/capabilities/default.json')), '(b) default.json: the permission list and every other field equal main at the merge-base');
  const cap = now('app/src-tauri/capabilities/capture.json');
  const { platforms: capPlatforms, ...capRest } = cap;
  assert.ok(capPlatforms === undefined || JSON.stringify(capPlatforms) === '["macOS"]', `(b) capture.json: at most platforms ["macOS"] added, got ${JSON.stringify(capPlatforms)}`);
  assert.deepEqual(capRest, noPlatforms(atBase('app/src-tauri/capabilities/capture.json')), '(b) capture.json equals main at the merge-base');
  const conf = now('app/src-tauri/tauri.conf.json');
  if (conf.bundle) delete conf.bundle.android;
  const baseConf = atBase('app/src-tauri/tauri.conf.json');
  if (baseConf.bundle) delete baseConf.bundle.android;
  assert.deepEqual(conf, baseConf, '(b) tauri.conf.json equals main at the merge-base apart from bundle.android');
  assert.deepEqual(now('app/src-tauri/tauri.preview.conf.json'), atBase('app/src-tauri/tauri.preview.conf.json'), '(b) tauri.preview.conf.json equals main at the merge-base');

  // (a) no existing AC test changed or deleted by the AND-1 commits, except by a commit carrying an owner-approved
  // AC-Test-Change trailer (CLAUDE.md; D-2052).
  const log = git(['log', '--format=%H%x00%B%x01', `${BASE}..HEAD`]);
  assert.ok(log.ok, `git log ${BASE}..HEAD`);
  const commits = log.out.split('\x01').map((c) => c.trim()).filter(Boolean).map((c) => { const [sha, body] = c.split('\x00'); return { sha, body }; });
  const android = commits.filter(({ body }) => /\bAND-\d/.test(body) || /\bD-2\d{3}\b/.test(body));
  const bad: string[] = [];
  for (const { sha, body } of android) {
    if (/^AC-Test-Change:.*;\s*approved-by:\s*owner\s*$/m.test(body)) continue;
    if (/^AC-Test-Change:/m.test(body)) bad.push(`${sha.slice(0, 8)}: AC-Test-Change trailer without approved-by: owner`);
    const diff = git(['diff-tree', '--no-commit-id', '-r', '--name-status', '-M', sha]);
    for (const line of diff.out.split('\n').filter(Boolean)) {
      const [status, path] = line.split('\t');
      if (!/^[MDR]/.test(status)) continue;
      if (AC_TEST.some((re) => re.test(path))) bad.push(`${sha.slice(0, 8)}: ${status} ${path}`);
    }
  }
  assert.deepEqual(bad, [], '(a) the AND-1 commits change or delete no existing AC test without an owner-approved trailer');
});
