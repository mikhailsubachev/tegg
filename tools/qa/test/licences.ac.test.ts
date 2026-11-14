// Slice REL, L0: docs/acceptance/related.md FR-LNK-15 AC-32 (the English stemmer's licence, AP-1470 → D-1717), through
// the CLI of docs/contracts/v1-related.md §5: `node tools/qa/src/licences.ts --crate <crate> --allow "<ids>"` lists the
// crate's closure with `cargo tree --offline --locked -p <crate> -e normal,build --prefix none --format '{p}|{l}'`
// (CP-5 → D-1729), skips workspace path packages, reads SPDX `OR`, `AND`, parentheses, `X WITH exception` and the legacy
// `/`, fails a missing licence, prints `licence: <name> <version>: <expression>` per failing package and exits 1, or
// prints `licences: <n> crates OK` and exits 0. Crafted `cargo tree` lines come from a fake `cargo` first on PATH (it
// records its arguments); the real repository's `rust-licences` step (qa.config.json, `commit` level, CC0-1.0 allowed
// by CP-1 → D-1725) passes. The network half of AC-32 is the existing crates/tegg-core/tests/ac_core_static.rs. Written
// from the ACs and the contract only (D-61); every check is a node:assert assertion (TS-I1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const QA = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(QA, '../..');
const SCRIPT = path.join(QA, 'src/licences.ts');
const ALLOW = 'MIT Apache-2.0 BSD-2-Clause BSD-3-Clause ISC Zlib Unicode-3.0';

/** Runs the checker with a fake `cargo` that prints `lines` and records its arguments. */
function run(lines: string[], allow = ALLOW, crate = 'tegg-index') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tegg-licences-'));
  const out = path.join(dir, 'tree.txt');
  const args = path.join(dir, 'args.txt');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  const fake = path.join(dir, 'cargo');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\ncat '${out}'\n`);
  fs.chmodSync(fake, 0o755);
  const r = spawnSync(process.execPath, [SCRIPT, '--crate', crate, '--allow', allow], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
  });
  const recorded = fs.existsSync(args) ? fs.readFileSync(args, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args: recorded };
}

test('fr_lnk_15_ac32_offline_and_stemmer_licence', () => {
  assert.ok(fs.existsSync(SCRIPT), 'tools/qa/src/licences.ts exists');
  // Allowed expressions, a duplicate and a workspace path package.
  const ok = run([
    'serde v1.0.219|MIT OR Apache-2.0',
    'serde v1.0.219|MIT OR Apache-2.0',
    'rust-stemmers v1.2.0|MIT/BSD-3-Clause',
    'llvm-ish v0.1.0|Apache-2.0 WITH LLVM-exception',
    'encoding_rs v0.8.35|(Apache-2.0 OR MIT) AND BSD-3-Clause',
    'unicode-ident v1.0.18|(MIT OR Apache-2.0) AND Unicode-3.0',
    'tegg-format v0.0.0 (/work/crates/tegg-format)|',
  ]);
  assert.deepEqual([ok.status, ok.stdout.trim()], [0, 'licences: 5 crates OK'], `allowed licences pass: ${ok.stdout}${ok.stderr}`);
  assert.deepEqual(ok.args, ['tree', '--offline', '--locked', '-p', 'tegg-index', '-e', 'normal,build', '--prefix', 'none', '--format', '{p}|{l}'],
    'the closure comes from cargo tree --offline --locked (CP-5)');
  // Failing packages, each named on its own line.
  const bad = run([
    'serde v1.0.219|MIT OR Apache-2.0',
    'notify v8.2.0|CC0-1.0',
    'gpl-thing v2.0.0|GPL-3.0-only',
    'mixed v0.3.1|MIT AND GPL-2.0',
    'nolicence v0.0.1|',
  ]);
  assert.equal(bad.status, 1, `a licence outside the allow-list exits 1: ${bad.stdout}${bad.stderr}`);
  const lines = bad.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('licence: '));
  assert.deepEqual(lines.sort(), [
    'licence: gpl-thing 2.0.0: GPL-3.0-only', 'licence: mixed 0.3.1: MIT AND GPL-2.0', 'licence: nolicence 0.0.1: ', 'licence: notify 8.2.0: CC0-1.0',
  ].map((l) => l.trim()).sort(), 'one line per failing package, naming it');
  assert.ok(!bad.stdout.includes('serde'), 'an allowed package is not listed');
  // CP-1 → D-1725: CC0-1.0 allowed.
  assert.equal(run(['notify v8.2.0|CC0-1.0'], `${ALLOW} CC0-1.0`).status, 0, 'CC0-1.0 passes once allowed');
  // The repository's step: in qa.config.json at commit level, and it passes on today's closure.
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'qa.config.json'), 'utf8')) as { steps: { id: string; level: string; run: string; dir: string }[] };
  const step = cfg.steps.find((s) => s.id === 'rust-licences');
  assert.ok(step, 'qa.config.json has the rust-licences step');
  assert.equal(step!.level, 'commit', 'it runs in every gate (commit level)');
  assert.match(step!.run, /node tools\/qa\/src\/licences\.ts --crate tegg-index --allow "[^"]*CC0-1\.0[^"]*"/, 'it checks tegg-index with CC0-1.0 allowed (D-1725)');
  const real = spawnSync('sh', ['-c', step!.run], { cwd: path.join(REPO, step!.dir), encoding: 'utf8' });
  assert.equal(real.status, 0, `the real closure passes: ${real.stdout}${real.stderr}`);
  assert.match(real.stdout.trim(), /^licences: \d+ crates OK$/, 'one OK line');
});
