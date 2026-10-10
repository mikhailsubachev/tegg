// TS-HOOKS: git and Claude Code hooks (D-60). Black box against tools/qa/CONTRACT.md §1.1, §4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, ZERO_SHA, assertExit, assertNonZero, commitAll, countLines, describe, git, gitTry, headSha,
  installRealHooks, lastSummary, makeRepo, markStep, readJsonFile, readText, sq, tmpDir, treeOf, verify, writeFiles,
} from './helpers.ts';

const HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];

function settings(): any {
  return readJsonFile(path.join(REPO_ROOT, '.claude', 'settings.json'), 'project Claude Code settings');
}

// ---------------------------------------------------------------------------
// AC-1: pre-commit runs verify commit; pre-push runs verify push unless last-pass matches
// ---------------------------------------------------------------------------

test('ts_hooks_ac1_githooks_are_committed_executable_posix_sh', () => {
  for (const name of HOOKS) {
    const p = path.join(REPO_ROOT, '.githooks', name);
    assert.ok(fs.existsSync(p), `${p} must exist`);
    assert.ok((fs.statSync(p).mode & 0o111) !== 0, `${p} must be executable`);
    assert.match(fs.readFileSync(p, 'utf8').split('\n')[0], /^#!\s*\/bin\/sh\b/, `${p} must be a POSIX sh script`);
    const tracked = gitTry(REPO_ROOT, ['ls-files', '--error-unmatch', `.githooks/${name}`]);
    assert.equal(tracked.status, 0, `.githooks/${name} must be committed (tracked by git)`);
  }
});

test('ts_hooks_ac1_pre_commit_hook_blocks_commit_when_commit_gate_fails', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'broken', run: 'exit 1', level: 'commit' }] } });
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  const before = headSha(repo);
  writeFiles(repo, { 'note.md': 'Výlet do Lisabonu\n' });
  git(repo, ['add', 'note.md']);
  const r = gitTry(repo, ['commit', '-q', '-m', 'add note']);
  assertNonZero(r, 'git commit with a failing commit gate');
  assert.equal(headSha(repo), before, 'no commit may be created');
});

test('ts_hooks_ac1_pre_commit_hook_runs_verify_commit_without_git_hook_env', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const envDump = path.join(out, 'git-env');
  const repo = makeRepo(t, {
    config: {
      steps: [{
        id: 'env', level: 'commit',
        run: `env | grep -E '^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|OBJECT_DIRECTORY|COMMON_DIR)=' > ${sq(envDump)}; true`,
      }],
    },
  });
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  const before = headSha(repo);
  writeFiles(repo, { 'note.md': 'Výlet do Lisabonu\n' });
  git(repo, ['add', 'note.md']);
  const r = gitTry(repo, ['commit', '-q', '-m', 'add note']);
  assertExit(r, 0, 'git commit with a passing commit gate');
  assert.notEqual(headSha(repo), before, 'the commit must be created');
  assert.equal(lastSummary(repo, 'commit').gate, 'commit', 'the pre-commit hook ran verify commit');
  assert.equal(readText(envDump, 'git env seen by the step'), '', 'git hook variables must be removed from the step environment');
});

test('ts_hooks_ac1_pre_push_hook_runs_push_gate_then_skips_matching_tree', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const counter = path.join(out, 'runs');
  const remote = path.join(out, 'remote.git');
  const repo = makeRepo(t, { config: { steps: [{ id: 'count', run: markStep(counter), level: 'push' }] } });
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  git(out, ['init', '-q', '--bare', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);

  const r1 = gitTry(repo, ['push', '-q', 'origin', 'main']);
  assertExit(r1, 0, 'first git push');
  assert.equal(countLines(counter), 1, 'the pre-push hook must run the push gate once');
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass').trim(), treeOf(repo));

  commitAll(repo, 'same tree, new commit', { allowEmpty: true });
  const r2 = gitTry(repo, ['push', '-q', 'origin', 'main']);
  assertExit(r2, 0, 'second git push of an identical tree');
  assert.equal(countLines(counter), 1, 'the push gate must be skipped when last-pass matches the pushed tree');
  assert.equal(git(remote, ['rev-parse', 'main']).trim(), headSha(repo), 'the push must go through');
});

test('ts_hooks_ac1_pre_push_hook_blocks_push_when_push_gate_fails', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const remote = path.join(out, 'remote.git');
  const repo = makeRepo(t, { config: { steps: [{ id: 'broken', run: 'exit 1', level: 'push' }] } });
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  git(out, ['init', '-q', '--bare', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);
  const r = gitTry(repo, ['push', '-q', 'origin', 'main']);
  assertNonZero(r, 'git push with a failing push gate');
  assert.notEqual(gitTry(remote, ['rev-parse', '--verify', '-q', 'refs/heads/main']).status, 0, 'the remote must not receive main');
});

function prePushRepo(t: any) {
  const out = tmpDir(t, 'tegg-qa-out-');
  const marker = path.join(out, 'ran');
  const repo = makeRepo(t, { config: { steps: [{ id: 'fails', run: markStep(marker, 'exit 1'), level: 'push' }] } });
  return { repo, marker, line: (remoteSha = ZERO_SHA) => `refs/heads/main ${headSha(repo)} refs/heads/main ${remoteSha}\n` };
}

test('ts_hooks_ac1_hook_pre_push_skips_when_last_pass_matches_tree', (t) => {
  const { repo, marker, line } = prePushRepo(t);
  writeFiles(repo, { '.verify/last-pass': `${treeOf(repo)}\n` });
  const r = verify(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { input: line() });
  assertExit(r, 0, 'hook pre-push with matching last-pass');
  assert.equal(fs.existsSync(marker), false, 'nothing may run when the tree matches last-pass');
});

test('ts_hooks_ac1_hook_pre_push_runs_push_gate_when_last_pass_differs', (t) => {
  const { repo, marker, line } = prePushRepo(t);
  writeFiles(repo, { '.verify/last-pass': `${'1'.repeat(40)}\n` });
  const r = verify(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { input: line() });
  assertExit(r, 1, 'hook pre-push with stale last-pass and a failing step');
  assert.equal(fs.existsSync(marker), true, 'the push gate must run');
});

test('ts_hooks_ac1_hook_pre_push_ignores_branch_deletions', (t) => {
  const { repo, marker } = prePushRepo(t);
  const r = verify(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], {
    input: `(delete) ${ZERO_SHA} refs/heads/old ${headSha(repo)}\n`,
  });
  assertExit(r, 0, 'hook pre-push for a deletion only');
  assert.equal(fs.existsSync(marker), false, 'nothing may run for a deletion');
});

// ---------------------------------------------------------------------------
// AC-2: Claude Code blocks git push / gh pr merge until verify push passed for the current tree
// ---------------------------------------------------------------------------

test('ts_hooks_ac2_settings_configure_pre_tool_use_hook_for_bash', () => {
  const s = settings();
  const entries: any[] = s?.hooks?.PreToolUse ?? [];
  assert.ok(Array.isArray(entries) && entries.length > 0, '.claude/settings.json must have hooks.PreToolUse');
  const commands = entries
    .filter((e) => e?.matcher === 'Bash')
    .flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : []))
    .filter((h) => h?.type === 'command')
    .map((h) => String(h.command));
  assert.ok(
    commands.includes('"$CLAUDE_PROJECT_DIR"/verify hook claude-pre-tool'),
    `a PreToolUse hook with matcher Bash must run "$CLAUDE_PROJECT_DIR"/verify hook claude-pre-tool; found ${JSON.stringify(commands)}`,
  );
});

function hookInput(tool: string, command?: string): string {
  return JSON.stringify({ session_id: 'test', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: command === undefined ? { file_path: 'x' } : { command } });
}

test('ts_hooks_ac2_git_push_and_gh_pr_merge_blocked_without_last_pass', (t) => {
  const repo = makeRepo(t);
  for (const cmd of ['git push origin main', 'cd sub && git push', 'gh pr merge 3 --squash']) {
    const r = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('Bash', cmd) });
    assertExit(r, 2, `claude-pre-tool for "${cmd}" without last-pass`);
    assert.match(r.stderr, /\.\/verify push/, 'stderr must tell to run ./verify push');
  }
});

test('ts_hooks_ac2_git_push_blocked_when_last_pass_is_another_tree', (t) => {
  const repo = makeRepo(t);
  const oldTree = treeOf(repo);
  writeFiles(repo, { 'more.md': 'Příliš žluťoučký kůň\n' });
  commitAll(repo, 'change tree');
  writeFiles(repo, { '.verify/last-pass': `${oldTree}\n` });
  const r = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('Bash', 'git push') });
  assertExit(r, 2, 'claude-pre-tool with stale last-pass');
  assert.match(r.stderr, /\.\/verify push/);
});

test('ts_hooks_ac2_git_push_allowed_silently_when_last_pass_matches_head_tree', (t) => {
  const repo = makeRepo(t, { hooksPath: false });
  writeFiles(repo, { '.verify/last-pass': `${treeOf(repo)}\n` });
  const r = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('Bash', 'git push origin main') });
  assertExit(r, 0, 'claude-pre-tool with matching last-pass');
  assert.equal(r.stdout, '', 'no stdout');
  assert.equal(r.stderr, '', 'no stderr (not even the hooks warning)');
});

test('ts_hooks_ac2_other_tools_commands_and_bad_input_pass_silently', (t) => {
  const repo = makeRepo(t, { hooksPath: false });
  const inputs = [hookInput('Bash', 'git status'), hookInput('Bash', 'npm test'), hookInput('Read'), 'not json {'];
  for (const input of inputs) {
    const r = verify(repo, ['hook', 'claude-pre-tool'], { input });
    assertExit(r, 0, `claude-pre-tool for ${input}`);
    assert.equal(r.stdout + r.stderr, '', `claude-pre-tool must print nothing for ${input}`);
  }
});

// ---------------------------------------------------------------------------
// AC-4: verify install sets up hooks; verify warns if they are missing
// ---------------------------------------------------------------------------

test('ts_hooks_ac4_install_sets_hooks_path_idempotently', (t) => {
  const repo = makeRepo(t, { hooksPath: false });
  for (const attempt of [1, 2]) {
    assertExit(verify(repo, ['install']), 0, `verify install (attempt ${attempt})`);
    assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.githooks');
  }
});

test('ts_hooks_ac4_install_works_without_config', (t) => {
  const repo = makeRepo(t, { hooksPath: false, config: null });
  assertExit(verify(repo, ['install']), 0, 'verify install without qa.config.json');
  assert.equal(git(repo, ['config', '--get', 'core.hooksPath']).trim(), '.githooks');
});

test('ts_hooks_ac4_verify_warns_when_hooks_not_installed', (t) => {
  const repo = makeRepo(t, { hooksPath: false });
  const r = verify(repo, ['commit']);
  assertExit(r, 0, 'the warning must not change the exit code');
  const line = r.stderr.split('\n').find((l) => l.includes('hooks not installed'));
  assert.ok(line, `stderr must contain "hooks not installed"\n${describe(r)}`);
  assert.ok(line.includes('./verify install'), `the warning line must mention ./verify install: ${line}`);
  assert.doesNotMatch(r.stdout, /hooks not installed/, 'the warning goes to stderr');
});

test('ts_hooks_ac4_no_warning_when_hooks_installed', (t) => {
  const repo = makeRepo(t, { hooksPath: true });
  const r = verify(repo, ['commit']);
  assertExit(r, 0, 'verify commit');
  assert.doesNotMatch(r.stderr, /hooks not installed/);
});
