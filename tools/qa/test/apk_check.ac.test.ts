// Slice AND-1, APK layer rules: docs/acceptance/android-shell.md NFR-SEC-01 AC-1, FR-STO-07 AC-14, AR-08 AC-2…AC-5
// (RA1, RA7; D-2002, D-2019…D-2022, D-2030, D-2032), through docs/contracts/android-shell.md §10.4:
// `tools/qa/src/apk-check.ts` exports `checkApk(facts, expect)` → `string[]` (one failure each) over a parsed `ApkFacts`
// object, so the rules are tested on given facts. The CLI reads a built APK with `aapt2`, `apksigner` and the zip
// listing; it runs on the test APK in the `app-android-e2e` step and on the release APK inside the release command.
//
// Red-test decision (reported to the owner; the contract names `ApkFacts` without its fields): the shapes are
//   ApkFacts = { package, versionName, versionCode, minSdk, targetSdk, label, debuggable, permissions: string[],
//                allowBackup: boolean | null, dataExtractionRules: { cloudBackup: string[]; deviceTransfer: string[] }
//                | null (the domains each section excludes), signers: { subject, sha256 }[], schemes: number[]
//                (verified APK signature schemes), entries: string[] (zip listing), libHasTestEnv: boolean (the bytes
//                `test-env.json` in lib/arm64-v8a/libtegg_app_lib.so) }
//   expect = { kind: 'release' | 'test', version?: string, signerSha256?: string }
// Written from the ACs and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Facts = {
  package: string; versionName: string; versionCode: number; minSdk: number; targetSdk: number; label: string; debuggable: boolean;
  permissions: string[]; allowBackup: boolean | null; dataExtractionRules: { cloudBackup: string[]; deviceTransfer: string[] } | null;
  signers: { subject: string; sha256: string }[]; schemes: number[]; entries: string[]; libHasTestEnv: boolean;
};
type Expect = { kind: 'release' | 'test'; version?: string; signerSha256?: string };
type Check = (facts: Facts, expect: Expect) => string[];

async function checker(): Promise<Check> {
  const path = '../src/apk-check.ts';
  let m: Record<string, unknown> | null = null;
  try { m = (await import(path)) as Record<string, unknown>; } catch { m = null; }
  assert.ok(m, 'tools/qa/src/apk-check.ts loads (contract §10.4)');
  assert.equal(typeof m!.checkApk, 'function', 'apk-check.ts exports checkApk(facts, expect)');
  return m!.checkApk as Check;
}

const OWNER = 'a1'.repeat(32);
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const LIBS = ['lib/arm64-v8a/libtegg_app_lib.so', 'lib/arm64-v8a/libc++_shared.so'];

function release(): Facts {
  return {
    package: 'app.tegg.preview', versionName: '0.5.0', versionCode: 5000, minSdk: 30, targetSdk: 35, label: 'Tegg', debuggable: false,
    permissions: ['android.permission.MANAGE_EXTERNAL_STORAGE', 'app.tegg.preview.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'],
    allowBackup: false, dataExtractionRules: { cloudBackup: [...DOMAINS], deviceTransfer: [...DOMAINS] },
    signers: [{ subject: 'CN=Tegg, O=Tegg', sha256: OWNER }], schemes: [2, 3],
    entries: ['AndroidManifest.xml', 'classes.dex', 'assets/index.html', ...LIBS], libHasTestEnv: false,
  };
}
function testApk(): Facts {
  return {
    ...release(), package: 'app.tegg.desktop', versionName: '0.0.1', versionCode: 1, debuggable: true, libHasTestEnv: true,
    permissions: ['android.permission.MANAGE_EXTERNAL_STORAGE', 'app.tegg.desktop.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'],
    signers: [{ subject: 'CN=Tegg test key', sha256: 'b2'.repeat(32) }],
  };
}
const REL: Expect = { kind: 'release', version: '0.5.0', signerSha256: OWNER };
const TEST: Expect = { kind: 'test' };

/** The failures for `facts`, asserting that there is at least one and that one of them matches `re`. */
function fails(check: Check, facts: Facts, expect: Expect, re: RegExp, what: string): string[] {
  const out = check(facts, expect);
  assert.ok(Array.isArray(out), `${what}: checkApk returns an array`);
  assert.ok(out.some((f) => re.test(f)), `${what}: a failure matching ${re}; got ${JSON.stringify(out)}`);
  return out;
}

test('nfr_sec_01_ac1_apk_has_no_network_permission', async () => {
  const check = await checker();
  assert.deepEqual(check(release(), REL), [], 'the release APK as RA1 describes it passes');
  assert.deepEqual(check(testApk(), TEST), [], 'the test APK as RA1 describes it passes');
  for (const p of ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_NETWORK_STATE']) {
    const f = release();
    f.permissions.push(`android.permission.${p}`);
    fails(check, f, REL, new RegExp(`android\\.permission\\.${p}\\b`), `release with ${p}`);
    const t = testApk();
    t.permissions.push(`android.permission.${p}`);
    fails(check, t, TEST, new RegExp(`android\\.permission\\.${p}\\b`), `test APK with ${p}`);
  }
  const all = release();
  all.permissions.push('android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE');
  const out = check(all, REL).join('\n');
  assert.match(out, /INTERNET/, 'two network permissions: both named');
  assert.match(out, /ACCESS_NETWORK_STATE/, 'two network permissions: both named');
  const other = release();
  other.permissions.push('android.permission.CAMERA');
  fails(check, other, REL, /android\.permission\.CAMERA/, 'any other permission is refused (exactly these entries)');
  const foreign = testApk();
  foreign.permissions.push('app.tegg.preview.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION');
  fails(check, foreign, TEST, /app\.tegg\.preview\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION/, 'another app\'s namespace in the test APK');
  const none = release();
  none.permissions = none.permissions.filter((p) => !p.endsWith('MANAGE_EXTERNAL_STORAGE'));
  fails(check, none, REL, /MANAGE_EXTERNAL_STORAGE/, 'MANAGE_EXTERNAL_STORAGE missing');
});

test('fr_sto_07_ac14_android_backup_off', async () => {
  const check = await checker();
  for (const [name, base, exp] of [['release', release, REL], ['test', testApk, TEST]] as const) {
    const on = base(); on.allowBackup = true;
    fails(check, on, exp, /allowBackup/, `${name}: android:allowBackup="true"`);
    const unset = base(); unset.allowBackup = null;
    fails(check, unset, exp, /allowBackup/, `${name}: android:allowBackup missing (Android's default is on)`);
    const noRules = base(); noRules.dataExtractionRules = null;
    fails(check, noRules, exp, /dataExtractionRules|data extraction/i, `${name}: no data-extraction rules`);
    for (const d of DOMAINS) {
      const cloud = base(); cloud.dataExtractionRules = { cloudBackup: DOMAINS.filter((x) => x !== d), deviceTransfer: [...DOMAINS] };
      fails(check, cloud, exp, new RegExp(`cloud.*${d}|${d}.*cloud`, 'i'), `${name}: cloud backup keeps the ${d} domain`);
      const move = base(); move.dataExtractionRules = { cloudBackup: [...DOMAINS], deviceTransfer: DOMAINS.filter((x) => x !== d) };
      fails(check, move, exp, new RegExp(`transfer.*${d}|${d}.*transfer`, 'i'), `${name}: device transfer keeps the ${d} domain`);
    }
  }
});

test('ar_08_ac2_apk_version', async () => {
  const check = await checker();
  assert.deepEqual(check(release(), REL), [], '0.5.0 / 5000 passes');
  const code = release(); code.versionCode = 5001;
  fails(check, code, REL, /versionCode/, 'versionCode 5001 for 0.5.0');
  const name = release(); name.versionName = '0.5.1';
  fails(check, name, REL, /versionName/, 'versionName 0.5.1 for 0.5.0');
  const big = { ...release(), versionName: '0.12.3', versionCode: 12003 };
  assert.deepEqual(check(big, { ...REL, version: '0.12.3' }), [], '0.12.3 / 12003 passes');
  const t = testApk(); t.versionName = '0.0.0'; t.versionCode = 0;
  fails(check, t, TEST, /version/i, 'the test APK is 0.0.1 / 1');
});

test('ar_08_ac3_apk_signed_with_owner_key', async () => {
  const check = await checker();
  assert.deepEqual(check(release(), REL), [], 'signed with the owner\'s key, schemes v2 and v3');
  const debug = release(); debug.signers = [{ subject: 'C=US, O=Android, CN=Android Debug', sha256: OWNER }];
  fails(check, debug, REL, /Android Debug/, 'a debug-signed release');
  const other = release(); other.signers = [{ subject: 'CN=Someone', sha256: 'c3'.repeat(32) }];
  fails(check, other, REL, /SHA-?256|signer|certificate/i, 'signed with another key than the config\'s');
  const v1 = release(); v1.schemes = [1];
  fails(check, v1, REL, /scheme|v2/i, 'only the v1 scheme');
  const unsigned = release(); unsigned.signers = []; unsigned.schemes = [];
  fails(check, unsigned, REL, /sign/i, 'an unsigned APK');
});

test('ar_08_ac4_apk_identity_and_target', async () => {
  const check = await checker();
  const pkg = release(); pkg.package = 'app.tegg.desktop';
  fails(check, pkg, REL, /app\.tegg\.preview/, 'the release APK is app.tegg.preview');
  const tpkg = testApk(); tpkg.package = 'app.tegg.preview';
  fails(check, tpkg, TEST, /app\.tegg\.desktop/, 'the test APK is app.tegg.desktop');
  const min = release(); min.minSdk = 24;
  fails(check, min, REL, /minSdk/i, 'minSdkVersion 24');
  const target = release(); target.targetSdk = 34;
  fails(check, target, REL, /targetSdk/i, 'targetSdkVersion 34');
  for (const abi of ['armeabi-v7a', 'x86', 'x86_64']) {
    const f = release(); f.entries.push(`lib/${abi}/libtegg_app_lib.so`);
    fails(check, f, REL, new RegExp(`lib/${abi}/`), `release with lib/${abi}/`);
    const t = testApk(); t.entries.push(`lib/${abi}/libtegg_app_lib.so`);
    fails(check, t, TEST, new RegExp(`lib/${abi}/`), `test APK with lib/${abi}/`);
  }
  const noLib = release(); noLib.entries = noLib.entries.filter((e) => !e.startsWith('lib/'));
  fails(check, noLib, REL, /arm64-v8a/, 'no native library under lib/arm64-v8a/');
  const dbg = release(); dbg.debuggable = true;
  fails(check, dbg, REL, /debuggable/, 'a debuggable release');
  const notDbg = testApk(); notDbg.debuggable = false;
  fails(check, notDbg, TEST, /debuggable/, 'the test APK must be debuggable (the LA layer, CP-6)');
  const label = release(); label.label = 'Tegg Preview';
  fails(check, label, REL, /label/i, 'application label other than Tegg');
});

test('ar_08_ac5_test_hooks_only_in_test_apk', async () => {
  const check = await checker();
  const rel = release(); rel.libHasTestEnv = true;
  fails(check, rel, REL, /test-env\.json/, 'the release library contains test-env.json');
  const t = testApk(); t.libHasTestEnv = false;
  fails(check, t, TEST, /test-env\.json/, 'the test library lacks test-env.json');
  assert.deepEqual(check(testApk(), TEST), [], 'the test APK with its hooks passes');
});

// ------------------------------------------------------------------------------------------------ slice AND-3
// docs/acceptance/android-edit.md NFR-SEC-01 AC-5 (APK part; D-2002) and the test input method's rule of
// docs/contracts/android-edit.md §16.3 (D-2519, CP-13 → D-2539): for both `--expect release` and `--expect test`, the
// APK's dex files hold no class under `app/tegg/testime/` and its manifest declares no `android.view.InputMethod`
// service; the release APK still has no INTERNET permission (AC-1).
// Red-test decision D-2547 (the contract names the rule, not the facts' fields): `ApkFacts` gains
//   dexClasses: string[] (class descriptors from the dex files, e.g. `app/tegg/testime/TestIme`) and
//   services: { name: string; actions: string[] }[] (the manifest's services with their intent-filter actions).
// Written from the ACs and the contract only (D-61).

test('nfr_sec_01_ac5_no_network_and_no_test_ime_in_product_apks', async () => {
  const check = await checker();
  const plain = { dexClasses: ['app/tegg/desktop/MainActivity', 'app/tegg/android/TeggStoragePlugin'], services: [] as { name: string; actions: string[] }[] };
  const rel = { ...release(), ...plain } as Facts;
  const tst = { ...testApk(), ...plain } as Facts;
  assert.deepEqual(check(rel, REL), [], 'a release APK without the test IME passes');
  assert.deepEqual(check(tst, TEST), [], 'a test APK without the test IME passes');
  const net = { ...rel, permissions: [...rel.permissions, 'android.permission.INTERNET'] } as Facts;
  fails(check, net, REL, /INTERNET/, 'the release APK still has no INTERNET permission (AC-1)');
  for (const [facts, expect, what] of [[rel, REL, 'release'], [tst, TEST, 'test']] as const) {
    const dex = { ...facts, dexClasses: [...(facts as any).dexClasses, 'app/tegg/testime/TestIme'] } as Facts;
    fails(check, dex, expect, /testime/i, `${what} APK with a class under app/tegg/testime/`);
    const svc = { ...facts, services: [{ name: 'app.tegg.testime.TestIme', actions: ['android.view.InputMethod'] }] } as Facts;
    fails(check, svc, expect, /InputMethod/, `${what} APK declaring an android.view.InputMethod service`);
  }
});
