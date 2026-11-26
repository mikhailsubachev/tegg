// D-2557 (3): before the LA step installs a test APK, an installed app signed with another worktree's key is uninstalled
// (emulator only). The decision and the parsing of `apksigner` output; the adb part runs in the `app-android-e2e` step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isEmulatorSerial, signerDigests } from '../src/android-foreign-key.ts';

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);

test('signer_digests_are_read_from_apksigner_print_certs', () => {
  const text = `Signer #1 certificate DN: CN=Tegg Test, O=Tegg\nSigner #1 certificate SHA-256 digest: ${A.toUpperCase()}\nSigner #1 certificate SHA-1 digest: 00\n`;
  assert.deepEqual(signerDigests(text), [A]);
  assert.deepEqual(signerDigests('DOES NOT VERIFY'), []);
});

test('an_app_signed_with_another_key_is_uninstalled_only_then', () => {
  assert.equal(decide(null, [A]), 'absent', 'not installed: nothing to do');
  assert.equal(decide([A], [A]), 'keep', 'the same key: install -r updates it');
  assert.equal(decide([B], [A]), 'uninstall', 'another worktree\'s key');
  assert.equal(decide([], [A]), 'unknown', 'unreadable certificates are left alone');
});

test('only_an_emulator_serial_is_a_target', () => {
  assert.ok(isEmulatorSerial('emulator-5554'));
  assert.ok(isEmulatorSerial('emulator-5556\n'));
  for (const s of ['', 'unknown', 'R58M123ABC', '192.168.1.5:5555', 'emulator-']) assert.ok(!isEmulatorSerial(s), s);
});
