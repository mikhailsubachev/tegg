// Slice AND-1 (docs/contracts/android-shell.md §10.4; NFR-SEC-01 AC-1, FR-STO-07 AC-14, AR-08 AC-2…AC-5; RA1, RA7):
// checks a built APK. `checkApk(facts, expect)` holds the rules over parsed facts; the CLI reads the facts from the APK
// with the SDK's `aapt2`, `apksigner` and the zip listing:
//   node tools/qa/src/apk-check.ts <apk> --expect release|test [--version <v>] [--signer-sha256 <hex>] [--json]
// Exit 1 with one failure per line; 0 when the APK passes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ApkFacts = {
  package: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  label: string;
  debuggable: boolean;
  permissions: string[];
  allowBackup: boolean | null;
  /** The domains each section of the data-extraction rules excludes; null without rules. */
  dataExtractionRules: { cloudBackup: string[]; deviceTransfer: string[] } | null;
  signers: { subject: string; sha256: string }[];
  /** The APK signature schemes that verified. */
  schemes: number[];
  entries: string[];
  /** The bytes `test-env.json` are in lib/arm64-v8a/libtegg_app_lib.so (D-2032). */
  libHasTestEnv: boolean;
};

export type ApkExpect = { kind: 'release' | 'test'; version?: string; signerSha256?: string };

const NETWORK = ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_NETWORK_STATE'].map((p) => `android.permission.${p}`);
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const ID = { release: 'app.tegg.preview', test: 'app.tegg.desktop' } as const;

/** RA7: MAJOR·10⁶ + MINOR·10³ + PATCH. */
export function versionCode(v: string): number {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!m) throw new RangeError(`not MAJOR.MINOR.PATCH: ${v}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (min > 999 || pat > 999) throw new RangeError(`MINOR and PATCH must be at most 999: ${v}`);
  return maj * 1_000_000 + min * 1_000 + pat;
}

/** The failures of `f` against RA1 for its kind; empty when the APK is as it should be. */
export function checkApk(f: ApkFacts, e: ApkExpect): string[] {
  const out: string[] = [];
  const id = ID[e.kind];
  if (f.package !== id) out.push(`package is ${f.package}, expected ${id} (RA1)`);
  // NFR-SEC-01 AC-1: exactly MANAGE_EXTERNAL_STORAGE and the app's own namespace.
  for (const p of f.permissions) {
    if (NETWORK.includes(p)) out.push(`network permission ${p} (NFR-SEC-01, D-2002)`);
    else if (p !== 'android.permission.MANAGE_EXTERNAL_STORAGE' && !p.startsWith(`${id}.`)) out.push(`unexpected permission ${p}`);
  }
  if (!f.permissions.includes('android.permission.MANAGE_EXTERNAL_STORAGE')) out.push('missing permission android.permission.MANAGE_EXTERNAL_STORAGE (D-2003)');
  // FR-STO-07 AC-14.
  if (f.allowBackup !== false) out.push(`android:allowBackup is ${f.allowBackup === null ? 'not set (on by default)' : 'true'}, expected false (D-2030)`);
  if (!f.dataExtractionRules) out.push('no dataExtractionRules (D-2030)');
  else {
    for (const d of DOMAINS) {
      if (!f.dataExtractionRules.cloudBackup.includes(d)) out.push(`data extraction rules: cloud backup keeps the ${d} domain`);
      if (!f.dataExtractionRules.deviceTransfer.includes(d)) out.push(`data extraction rules: device transfer keeps the ${d} domain`);
    }
  }
  // AR-08 AC-2 (RA7).
  const version = e.kind === 'test' ? '0.0.1' : e.version;
  if (version) {
    if (f.versionName !== version) out.push(`versionName is ${f.versionName}, expected ${version}`);
    let code: number | null = null;
    try { code = versionCode(version); } catch { out.push(`bad expected version ${version}`); }
    if (code !== null && f.versionCode !== code) out.push(`versionCode is ${f.versionCode}, expected ${code} (RA7)`);
  }
  // AR-08 AC-3.
  if (f.signers.length === 0) out.push('the APK is not signed');
  if (!f.schemes.some((s) => s >= 2)) out.push(`signature scheme v2 or later did not verify (schemes: ${f.schemes.join(', ') || 'none'})`);
  if (e.kind === 'release') {
    for (const s of f.signers) if (/CN=Android Debug/.test(s.subject)) out.push(`signed with the Android Debug key (${s.subject})`);
    if (e.signerSha256 && !f.signers.some((s) => s.sha256.toLowerCase() === e.signerSha256!.toLowerCase())) {
      out.push(`signer certificate SHA-256 is ${f.signers.map((s) => s.sha256).join(', ') || 'none'}, expected ${e.signerSha256}`);
    }
  }
  // AR-08 AC-4.
  if (f.minSdk !== 30) out.push(`minSdkVersion is ${f.minSdk}, expected 30 (D-2020)`);
  if (f.targetSdk !== 35) out.push(`targetSdkVersion is ${f.targetSdk}, expected 35 (D-2020)`);
  for (const abi of ['armeabi-v7a', 'x86', 'x86_64']) if (f.entries.some((x) => x.startsWith(`lib/${abi}/`))) out.push(`native code for lib/${abi}/ (arm64-v8a only)`);
  if (!f.entries.some((x) => x.startsWith('lib/arm64-v8a/'))) out.push('no native library under lib/arm64-v8a/');
  if (e.kind === 'release' && f.debuggable) out.push('the release APK is debuggable');
  if (e.kind === 'test' && !f.debuggable) out.push('the test APK is not debuggable (CP-6, D-2041)');
  if (f.label !== 'Tegg') out.push(`application label is ${f.label}, expected Tegg`);
  // AR-08 AC-5.
  if (e.kind === 'release' && f.libHasTestEnv) out.push('the release library contains test-env.json (test hooks, D-2032)');
  if (e.kind === 'test' && !f.libHasTestEnv) out.push('the test library lacks test-env.json (test hooks, D-2032)');
  return out;
}

// ---------------------------------------------------------------- reading an APK

function sdkTool(name: string): string {
  const home = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools';
  return join(home, 'build-tools/36.0.0', name);
}

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The domains excluded under `<tag>` in the data-extraction rules XML tree dump. */
function excluded(tree: string, tag: string): string[] {
  const at = tree.indexOf(`E: ${tag}`);
  if (at < 0) return [];
  const rest = tree.slice(at + 3 + tag.length);
  const end = rest.search(/\n\s{0,4}E: (cloud-backup|device-transfer)/);
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(/A: domain="([^"]+)"/g)].map((m) => m[1]);
}

export function readApk(apk: string): ApkFacts {
  const aapt2 = sdkTool('aapt2');
  const badging = run(aapt2, ['dump', 'badging', apk]);
  const manifest = run(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk]);
  const pick = (re: RegExp, s = badging) => re.exec(s)?.[1] ?? '';
  const boolAttr = (name: string): boolean | null => {
    const m = new RegExp(`android:${name}\\([^)]*\\)=(true|false|0x[0-9a-f]+)`).exec(manifest);
    if (!m) return null;
    return m[1] === 'true' || (m[1].startsWith('0x') && m[1] !== '0x0');
  };
  const entries = run('unzip', ['-Z1', apk]).split('\n').filter(Boolean);
  // The rules file: resolve the resource through the resources table dump.
  let rules: ApkFacts['dataExtractionRules'] = null;
  if (/android:dataExtractionRules/.test(manifest)) {
    const file = entries.find((x) => /^res\/.*data_extraction_rules\.xml$/.test(x)) ?? entries.find((x) => /^res\/[^/]+\.xml$/.test(x) && run(aapt2, ['dump', 'xmltree', '--file', x, apk]).includes('cloud-backup'));
    if (file) {
      const tree = run(aapt2, ['dump', 'xmltree', '--file', file, apk]);
      rules = { cloudBackup: excluded(tree, 'cloud-backup'), deviceTransfer: excluded(tree, 'device-transfer') };
    }
  }
  const verify = (() => { try { return run(sdkTool('apksigner'), ['verify', '--print-certs', '-v', apk]); } catch (err) { return String((err as { stdout?: string }).stdout ?? ''); } })();
  const schemes = [...verify.matchAll(/Verified using v(\d+(?:\.\d+)?) scheme \(APK Signature Scheme v\d+(?:\.\d+)?\): true/g)].map((m) => Math.floor(Number(m[1])));
  const signers = [...verify.matchAll(/Signer #\d+ certificate DN: (.+)\nSigner #\d+ certificate SHA-256 digest: ([0-9a-f]+)/g)].map((m) => ({ subject: m[1].trim(), sha256: m[2] }));
  const lib = 'lib/arm64-v8a/libtegg_app_lib.so';
  const libHasTestEnv = entries.includes(lib) && execFileSync('unzip', ['-p', apk, lib], { maxBuffer: 512 * 1024 * 1024 }).includes(Buffer.from('test-env.json'));
  return {
    package: pick(/package: name='([^']+)'/),
    versionName: pick(/versionName='([^']*)'/),
    versionCode: Number(pick(/versionCode='(\d+)'/)),
    minSdk: Number(pick(/minSdkVersion:'(\d+)'/) || pick(/sdkVersion:'(\d+)'/)),
    targetSdk: Number(pick(/targetSdkVersion:'(\d+)'/)),
    label: pick(/application-label:'([^']*)'/),
    debuggable: /application-debuggable/.test(badging),
    permissions: [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]),
    allowBackup: boolAttr('allowBackup'),
    dataExtractionRules: rules,
    signers,
    schemes,
    entries,
    libHasTestEnv,
  };
}

function main(argv: string[]): number {
  const apk = argv[0];
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const kind = opt('--expect');
  if (!apk || (kind !== 'release' && kind !== 'test')) {
    console.error('usage: apk-check <apk> --expect release|test [--version <v>] [--signer-sha256 <hex>] [--json]');
    return 2;
  }
  readFileSync(apk); // fails clearly when the file is missing
  const facts = readApk(apk);
  if (argv.includes('--json')) console.log(JSON.stringify(facts, null, 2));
  const failures = checkApk(facts, { kind, version: opt('--version'), signerSha256: opt('--signer-sha256') });
  for (const f of failures) console.error(f);
  if (failures.length === 0) console.log(`apk-check: ${apk} passes (${kind})`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2));
