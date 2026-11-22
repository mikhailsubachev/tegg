// Slice AND-1, L0: docs/acceptance/android-shell.md AR-03 AC-6 "The cross-compile step" (plan §5; AP-2033 → D-2033),
// the step's definition and its failure without the toolchain, through docs/contracts/android-shell.md §10.3 and CP-5
// (→ D-2040):
// - `qa.config.json` has a step `android-check` at the `push` level (lane `cargo`) with the inputs `crates`,
//   `Cargo.toml`, `Cargo.lock`, `app/src-tauri` and `tools/android`; it sources `tools/android/env.sh`, then runs
//   `cargo check --workspace --target aarch64-linux-android` in `crates/` and `cargo check --lib --target
//   aarch64-linux-android` in `app/src-tauri` with an empty `app/dist` when missing;
// - `tools/android/env.sh`, sourced with a missing SDK, NDK or JDK, returns 3 and its last line is
//   `android env: missing <what> (see tools/android/env.sh)`; the step then fails (it never skips).
// The XC result itself ("passes on the commit that builds AND-1") is the step in the push gate.
// Written from the ACs and the contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
type Step = { id: string; dir?: string; run: string; level: string; lane?: string; inputs?: string[] };

const lastLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
const MISSING = /^android env: missing .+ \(see tools\/android\/env\.sh\)$/;

test('ar_03_ac6_android_cross_compile_step', () => {
  const qa = JSON.parse(fs.readFileSync(path.join(REPO, 'qa.config.json'), 'utf8')) as { steps: Step[] };
  const step = qa.steps.find((s) => s.id === 'android-check');
  assert.ok(step, 'qa.config.json has a step android-check');
  assert.equal(step!.level, 'push', 'android-check runs at the push level (AP-2033)');
  assert.equal(step!.lane, 'cargo', 'in the cargo lane');
  for (const i of ['crates', 'Cargo.toml', 'Cargo.lock', 'app/src-tauri', 'tools/android']) {
    assert.ok(step!.inputs?.includes(i), `android-check's inputs include ${i}`);
  }
  const run = step!.run;
  assert.match(run, /(^|[\s;&(])\.\s+(\.\/)?tools\/android\/env\.sh\b|source\s+(\.\/)?tools\/android\/env\.sh\b/, 'the step sources tools/android/env.sh');
  assert.match(run, /cargo check --workspace --target aarch64-linux-android/, 'cargo check --workspace for aarch64-linux-android in crates/');
  assert.match(run, /cargo check --lib --target aarch64-linux-android/, 'cargo check --lib for aarch64-linux-android in app/src-tauri');
  assert.match(run, /mkdir -p (app\/)?dist/, 'an empty app/dist for generate_context! (CP-5)');
  assert.ok(!/\|\|\s*(true|exit 0)/.test(run), 'the step never turns a failure into a pass');

  const env = path.join(REPO, 'tools/android/env.sh');
  assert.ok(fs.existsSync(env), 'tools/android/env.sh is committed (D-2033)');
  const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tegg-no-android-'));
  const broken = [
    { what: 'SDK', vars: { ANDROID_HOME: path.join(nowhere, 'sdk') } },
    { what: 'NDK', vars: { NDK_HOME: path.join(nowhere, 'ndk') } },
    { what: 'JDK', vars: { JAVA_HOME: path.join(nowhere, 'jdk') } },
  ];
  for (const { what, vars } of broken) {
    const r = spawnSync('sh', ['-c', '. tools/android/env.sh'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...vars } });
    assert.equal(r.status, 3, `env.sh with a missing ${what} returns 3 (stdout ${r.stdout}, stderr ${r.stderr})`);
    const line = lastLine(`${r.stdout}\n${r.stderr}`);
    assert.match(line, MISSING, `env.sh with a missing ${what}: the last line names it and tools/android/env.sh`);

    const s = spawnSync('sh', ['-c', run], { cwd: path.join(REPO, step!.dir ?? '.'), encoding: 'utf8', env: { ...process.env, ...vars }, timeout: 120_000 });
    assert.notEqual(s.status, 0, `the step fails (not skips) with a missing ${what}`);
    assert.match(lastLine(`${s.stdout}\n${s.stderr}`), MISSING, `the step's last line names the missing ${what}`);
  }
});
