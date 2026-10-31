// Process and git helpers for the QA tooling (tools/qa/CONTRACT.md).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export type Result = { status: number; stdout: string; stderr: string };

export type RunOpts = { cwd: string; env?: NodeJS.ProcessEnv; input?: string };

/** Thrown for usage and configuration errors (exit code 2). */
export class UsageError extends Error {}

export function exec(cmd: string, args: string[], opts: RunOpts): Result {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input ?? '',
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) return { status: 127, stdout: '', stderr: String(r.error.message) };
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Like `exec`, but the process runs in the background with its output buffered, so several can run at once
 *  (the tree gates' lanes, CONTRACT §3.2.2). */
export function execAsync(cmd: string, args: string[], opts: RunOpts): Promise<Result> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      // No input: stdin is /dev/null (EOF at once). Writing to a pipe of a child that already exited raises EPIPE.
      // Its own process group, so a signal to the gate can be passed on to the step and everything it started
      // (stopSteps, CONTRACT §3.5).
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      resolve({ status: 127, stdout: '', stderr: String((e as Error).message) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (e) => resolve({ status: 127, stdout, stderr: stderr + String(e.message) }));
    running.add(child);
    child.on('exit', () => running.delete(child));
    child.on('close', (code) => resolve({ status: code ?? 1, stdout, stderr }));
    if (child.stdin) {
      child.stdin.on('error', () => {}); // the child may exit before reading its input
      child.stdin.end(opts.input);
    }
  });
}

/** The background processes `execAsync` started that haven't exited yet. */
const running = new Set<ChildProcess>();

function killGroup(child: ChildProcess, sig: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    // the group is gone already
  }
}

/** Passes `sig` on to the process groups of the running background processes and resolves once they've exited;
 *  a group still there after `graceMs` gets SIGKILL. */
export function stopSteps(sig: NodeJS.Signals, graceMs = 10_000): Promise<void> {
  const children = [...running];
  if (children.length === 0) return Promise.resolve();
  for (const c of children) killGroup(c, sig);
  const exited = children.map((c) => new Promise<void>((r) => (c.exitCode !== null || c.signalCode !== null ? r() : c.once('exit', () => r()))));
  const timer = setTimeout(() => {
    for (const c of children) killGroup(c, 'SIGKILL');
  }, graceMs);
  return Promise.all(exited).then(() => clearTimeout(timer));
}

// Git sets these for hooks; children working in another checkout must not inherit them (CONTRACT §2.1).
const GIT_HOOK_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR'];

export function strippedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of GIT_HOOK_VARS) delete env[k];
  return { ...env, ...extra };
}

export type GitOpts = { stripped?: boolean; input?: string };

/** Runs git in `cwd`; returns the result without throwing. */
export function gitTry(cwd: string, args: string[], opts: GitOpts = {}): Result {
  return exec('git', args, { cwd, env: opts.stripped ? strippedEnv() : process.env, input: opts.input });
}

/** Runs git in `cwd` and returns stdout; throws on failure. */
export function git(cwd: string, args: string[], opts: GitOpts = {}): string {
  const r = gitTry(cwd, args, opts);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export function repoRoot(cwd: string): string {
  const r = gitTry(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0) throw new UsageError('verify: not inside a git repository');
  return r.stdout.trim();
}

export function treeOf(root: string, rev: string): string {
  return git(root, ['rev-parse', `${rev}^{tree}`]).trim();
}

export function shortSha(sha: string): string {
  return sha.slice(0, 10);
}

export function commitMessage(root: string, sha: string): string {
  return git(root, ['log', '-1', '--format=%B', sha]);
}

export type Change = { status: string; path: string; oldPath?: string };

export function parentsOf(root: string, sha: string): string[] {
  return git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1);
}

/**
 * Files changed by one commit: against its first parent (root commits against the empty tree);
 * for merges only the merge's own changes, i.e. files differing from every parent (CONTRACT §5.0).
 */
export function commitChanges(root: string, sha: string, renames: boolean): Change[] {
  const parents = parentsOf(root, sha);
  if (parents.length > 1) return mergeOwnChanges(root, sha);
  const args = ['diff-tree', '-r', '--no-commit-id', '--name-status', '-z', renames ? '-M' : '--no-renames'];
  const out = parents.length === 0 ? git(root, [...args, '--root', sha]) : git(root, [...args, parents[0], sha]);
  return parseNameStatusZ(out);
}

/** Combined diff (`git diff-tree -c`): one status letter per parent, e.g. `MM`. */
function mergeOwnChanges(root: string, sha: string): Change[] {
  const parts = git(root, ['diff-tree', '-r', '-c', '--no-commit-id', '--name-status', '-z', sha]).split('\0').filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const letters = parts[i];
    const status = letters.includes('D') ? 'D' : /^A+$/.test(letters) ? 'A' : 'M';
    changes.push({ status, path: parts[i + 1] });
  }
  return changes;
}

export function parseNameStatusZ(out: string): Change[] {
  const parts = out.split('\0').filter((p) => p.length > 0);
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++];
      const path = parts[i++];
      changes.push({ status: status[0], path, oldPath });
    } else {
      changes.push({ status: status[0], path: parts[i++] });
    }
  }
  return changes;
}

export function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function hasTrailer(message: string, re: RegExp): boolean {
  return message.split('\n').some((line) => re.test(line.trimEnd()));
}

export const AC_TEST_CHANGE_TRAILER = /^AC-Test-Change: .+; approved-by: owner$/;
export const RED_FIRST_EXEMPT_TRAILER = /^Red-First-Exempt: .+; approved-by: owner$/;
export const FIXTURE_CHANGE_TRAILER = /^Fixture-Change: .+$/;
