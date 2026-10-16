// D-343: tree gates keep a Cargo build cache in .verify/cargo-target and check out the commit at a stable path
// outside the repository (CONTRACT §3.2.1), so the push gate stops rebuilding every dependency from scratch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VERIFY, assertExit, makeRepo, readText, sq, tmpDir, verify } from './helpers.ts';
import { stableWorktreeBase } from '../src/checks.ts';

const NO_INHERITED = { env: { CARGO_TARGET_DIR: undefined } };

test('tree_gate_steps_get_the_shared_cargo_cache_unless_opted_out', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const dump = (f: string) => `printf '%s\\n' "\${CARGO_TARGET_DIR-unset}" > ${sq(path.join(out, f))}`;
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'cached', level: 'push', run: dump('cached') },
        { id: 'own-target', level: 'push', run: dump('own'), cargoCache: false },
      ],
    },
  });
  assertExit(verify(repo, ['push'], NO_INHERITED), 0, 'verify push');
  assert.equal(readText(path.join(out, 'cached'), 'cached step env').trim(), path.join(repo, '.verify', 'cargo-target'));
  assert.equal(readText(path.join(out, 'own'), 'opted-out step env').trim(), 'unset');
});

test('commit_gate_steps_get_no_cargo_cache', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'env', level: 'commit', run: `printf '%s\\n' "\${CARGO_TARGET_DIR-unset}" > ${sq(path.join(out, 'env'))}` }] },
  });
  assertExit(verify(repo, ['commit'], NO_INHERITED), 0, 'verify commit');
  assert.equal(readText(path.join(out, 'env'), 'commit step env').trim(), 'unset');
});

test('tree_gate_worktree_path_is_stable_outside_the_repo_and_removed_after', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const where = path.join(out, 'where');
  const repo = makeRepo(t, { config: { steps: [{ id: 'where', level: 'push', run: `pwd -P >> ${sq(where)}` }] } });
  const base = stableWorktreeBase(repo);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assertExit(verify(repo, ['push']), 0, 'first push');
  assertExit(verify(repo, ['push']), 0, 'second push');
  const [a, b] = readText(where, 'step dirs').trim().split('\n');
  assert.equal(a, b, 'both runs use the same worktree path');
  assert.ok(!a.startsWith(repo + path.sep), 'the worktree is outside the repository');
  assert.equal(fs.existsSync(a), false, 'the worktree is removed after the run');
});

test('a_held_stable_path_falls_back_to_a_fresh_worktree', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const where = path.join(out, 'where');
  // The step of the outer gate runs a nested gate while the outer one holds the stable path.
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'where', level: 'push', run: `pwd -P >> ${sq(where)}; if [ ! -e ${sq(path.join(out, 'nested'))} ]; then touch ${sq(path.join(out, 'nested'))}; cd "$TEGG_TEST_REPO" && ${sq(VERIFY)} push --commit HEAD >/dev/null 2>&1; fi` }] },
  });
  const base = stableWorktreeBase(repo);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const r = verify(repo, ['push'], { env: { TEGG_TEST_REPO: repo } });
  assertExit(r, 0, 'outer push');
  const dirs = readText(where, 'step dirs').trim().split('\n');
  assert.equal(dirs.length, 2, `outer and nested step ran: ${dirs.join(', ')}`);
  assert.notEqual(dirs[0], dirs[1], 'the nested gate used its own worktree');
});

test('verify_clean_removes_the_cargo_cache', (t) => {
  const repo = makeRepo(t, { config: { steps: [] } });
  const cache = path.join(repo, '.verify', 'cargo-target');
  fs.mkdirSync(path.join(cache, 'debug'), { recursive: true });
  assertExit(verify(repo, ['clean']), 0, 'verify clean');
  assert.equal(fs.existsSync(cache), false, 'cache removed');
});
