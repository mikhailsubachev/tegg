// Commit-level checks: privacy (TS-P), fixture trailers (TS-D4), AC test protection (TS-I AC-1),
// red-first (TS-I AC-2). Contract: tools/qa/CONTRACT.md §5–§7.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAcTestFile, type Config } from './config.ts';
import { parseJunitDir, type TestCase } from './junit.ts';
import {
  AC_TEST_CHANGE_TRAILER,
  FIXTURE_CHANGE_TRAILER,
  RED_FIRST_EXEMPT_TRAILER,
  commitChanges,
  commitMessage,
  parentsOf,
  exec,
  git,
  gitTry,
  hasTrailer,
  shortSha,
  sq,
  strippedEnv,
} from './proc.ts';

export type CheckResult = { id: string; result: 'pass' | 'fail'; messages: string[] };

function check(id: string, messages: string[]): CheckResult {
  return { id, result: messages.length === 0 ? 'pass' : 'fail', messages };
}

// ---------------------------------------------------------------------------
// Privacy (TS-P AC-1, CONTRACT §6)
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 1_048_576;

function privacyViolations(file: string, size: number): string[] {
  const inFixtures = file.startsWith('tests/fixtures/');
  const out: string[] = [];
  if (file.startsWith('test exports/')) out.push(`${file}: path under test exports/ (real exports are never committed, D-50)`);
  if (/\.zip$/i.test(file) && !inFixtures) out.push(`${file}: .zip file outside tests/fixtures/`);
  if (size > MAX_FILE_BYTES && !inFixtures) out.push(`${file}: larger than 1 MiB (${size} bytes) outside tests/fixtures/`);
  return out;
}

/** Staged files: added, copied, modified (renames show up as additions). */
export function privacyStaged(root: string): CheckResult {
  const names = git(root, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACM']).split('\0').filter(Boolean);
  const messages: string[] = [];
  for (const f of names) {
    const size = Number(git(root, ['cat-file', '-s', `:${f}`]).trim());
    messages.push(...privacyViolations(f, size));
  }
  return check('privacy', messages);
}

/** Every file in the tree of `sha`. */
export function privacyTree(root: string, sha: string): CheckResult {
  const out = git(root, ['ls-tree', '-r', '-l', '-z', sha]);
  const messages: string[] = [];
  for (const entry of out.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [, type, , size] = entry.slice(0, tab).split(/\s+/);
    if (type !== 'blob') continue;
    messages.push(...privacyViolations(entry.slice(tab + 1), Number(size)));
  }
  return check('privacy', messages);
}

// ---------------------------------------------------------------------------
// Fixture trailer (TS-D4 AC-1, CONTRACT §7)
// ---------------------------------------------------------------------------

export function fixtureTrailers(root: string, range: string[]): CheckResult {
  const messages: string[] = [];
  for (const sha of range) {
    const touched = commitChanges(root, sha, true)
      .filter((c) => c.status !== 'A' && c.status !== 'C')
      .filter((c) => (c.oldPath ?? c.path).startsWith('tests/fixtures/'));
    if (touched.length === 0 || hasTrailer(commitMessage(root, sha), FIXTURE_CHANGE_TRAILER)) continue;
    for (const c of touched) messages.push(`${shortSha(sha)} changes ${c.oldPath ?? c.path} without a "Fixture-Change:" trailer`);
  }
  return check('fixtures', messages);
}

// ---------------------------------------------------------------------------
// AC test protection (TS-I AC-1, CONTRACT §4.3, §5.1)
// ---------------------------------------------------------------------------

/** Existing AC test files that a change list modifies, deletes or renames. */
export function protectedChanges(cfg: Config, changes: Array<{ status: string; path: string; oldPath?: string }>): string[] {
  return changes
    .filter((c) => c.status === 'M' || c.status === 'D' || c.status === 'R' || c.status === 'T')
    .map((c) => c.oldPath ?? c.path)
    .filter((p) => isAcTestFile(cfg, p));
}

export function acTestProtection(root: string, cfg: Config, range: string[]): CheckResult {
  const messages: string[] = [];
  for (const sha of range) {
    const files = protectedChanges(cfg, commitChanges(root, sha, true));
    if (files.length === 0 || hasTrailer(commitMessage(root, sha), AC_TEST_CHANGE_TRAILER)) continue;
    for (const f of files) messages.push(`${shortSha(sha)} modifies AC test ${f} without "AC-Test-Change: <reason>; approved-by: owner"`);
  }
  return check('ac-test-protection', messages);
}

// ---------------------------------------------------------------------------
// Worktrees (CONTRACT §3.2)
// ---------------------------------------------------------------------------

export type Worktree = { dir: string; remove: () => void };

/**
 * `stable` (tree gates, CONTRACT §3.2.1): the worktree lives at the same path outside the repository every run,
 * so Cargo reuses its incremental artifacts for the checkout's own crates (their metadata hash includes the
 * path). Sources still come from `sha` only: the directory is wiped before `git worktree add` and removed after.
 * If another gate of the same repository holds the stable path, a fresh temporary directory is used instead.
 */
export function createWorktree(root: string, sha: string, opts: { stable?: boolean } = {}): Worktree {
  const lock = opts.stable ? takeStableLock(root) : undefined;
  let dir: string;
  if (lock) {
    dir = path.join(lock.base, 'wt');
    if (fs.existsSync(dir)) gitTry(root, ['worktree', 'remove', '--force', dir], { stripped: true });
    fs.rmSync(dir, { recursive: true, force: true });
    gitTry(root, ['worktree', 'prune'], { stripped: true });
  } else {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tegg-verify-')));
  }
  const release = () => lock?.release();
  try {
    git(root, ['worktree', 'add', '--detach', '--force', dir, sha], { stripped: true });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    release();
    throw e;
  }
  return {
    dir,
    remove: () => {
      gitTry(root, ['worktree', 'remove', '--force', dir], { stripped: true });
      fs.rmSync(dir, { recursive: true, force: true });
      gitTry(root, ['worktree', 'prune'], { stripped: true });
      release();
    },
  };
}

/** The stable worktree's base directory for this repository: outside it, keyed by the checkout root. */
export function stableWorktreeBase(root: string): string {
  const key = createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 12);
  return path.join(fs.realpathSync(os.tmpdir()), `tegg-verify-${key}`);
}

/** An exclusive lock on the stable worktree path (a pid file; a dead holder's lock is taken over). */
function takeStableLock(root: string): { base: string; release: () => void } | undefined {
  const base = stableWorktreeBase(root);
  fs.mkdirSync(base, { recursive: true });
  const file = path.join(base, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      const release = () => {
        fs.rmSync(file, { force: true });
        try {
          fs.rmdirSync(base); // empty once the worktree is gone; the path itself is what stays stable
        } catch {
          // not empty or already gone
        }
      };
      return { base, release };
    } catch {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && pidAlive(pid)) return undefined;
      fs.rmSync(file, { force: true });
    }
  }
  return undefined;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Provides node_modules in the worktree for each dir with a package-lock.json: a symlink to the main
 * checkout's node_modules when the lockfiles are identical, otherwise `npm ci`. Returns problems found.
 */
export function provideNodeModules(root: string, worktree: string, dirs: string[]): string[] {
  const problems: string[] = [];
  for (const dir of new Set(dirs)) {
    const lock = path.join(worktree, dir, 'package-lock.json');
    if (!fs.existsSync(lock)) continue;
    const target = path.join(worktree, dir, 'node_modules');
    if (fs.existsSync(target)) continue;
    const mainLock = path.join(root, dir, 'package-lock.json');
    const mainModules = path.join(root, dir, 'node_modules');
    if (fs.existsSync(mainModules) && fs.existsSync(mainLock) && fs.readFileSync(mainLock).equals(fs.readFileSync(lock))) {
      fs.symlinkSync(mainModules, target, 'dir');
      continue;
    }
    const r = exec('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(worktree, dir), env: strippedEnv() });
    if (r.status !== 0) problems.push(`npm ci failed in ${dir}: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Red-first (TS-I AC-2, CONTRACT §5.2)
// ---------------------------------------------------------------------------

export type RedResult = { ok: boolean; messages: string[] };

function isAssertionFailure(tc: TestCase): boolean {
  return tc.failure !== undefined && tc.failure.includes('AssertionError');
}

export function addedAcTests(root: string, cfg: Config, sha: string): string[] {
  return commitChanges(root, sha, false)
    .filter((c) => c.status === 'A')
    .map((c) => c.path)
    .filter((p) => isAcTestFile(cfg, p));
}

export function checkRed(root: string, cfg: Config, sha: string): RedResult {
  const files = addedAcTests(root, cfg, sha);
  if (files.length === 0) return { ok: false, messages: [`${shortSha(sha)}: no AC tests added`] };
  const wt = createWorktree(root, sha);
  const messages: string[] = [];
  try {
    messages.push(...provideNodeModules(root, wt.dir, cfg.acRunners.map((r) => r.dir)));
    for (const file of files) {
      const runner = cfg.acRunners.find((r) => r.match.test(file));
      if (!runner) {
        messages.push(`${file}: no acRunners entry matches this file`);
        continue;
      }
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tegg-red-'));
      try {
        const junit = path.join(outDir, 'report.xml');
        const rel = path.relative(runner.dir, file);
        const cmd = runner.run.replaceAll('{files}', sq(rel)).replaceAll('{junit}', sq(junit));
        exec('sh', ['-c', cmd], { cwd: path.join(wt.dir, runner.dir), env: strippedEnv({ VERIFY_GATE: 'check-red' }) });
        const cases = parseJunitDir(outDir);
        if (cases.length === 0) messages.push(`${file}: no testcases in the report (load or compile error?)`);
        else {
          const passing = cases.filter((c) => c.failure === undefined && !c.skipped);
          const other = cases.filter((c) => c.failure !== undefined && !isAssertionFailure(c));
          const skipped = cases.filter((c) => c.failure === undefined && c.skipped);
          if (passing.length > 0) messages.push(`${file}: ${passing.length} testcase(s) pass before the implementation, e.g. "${passing[0].name}"`);
          if (skipped.length > 0) messages.push(`${file}: ${skipped.length} testcase(s) skipped`);
          if (other.length > 0) messages.push(`${file}: ${other.length} testcase(s) fail without an AssertionError (setup error?), e.g. "${other[0].name}"`);
        }
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }
  } finally {
    wt.remove();
  }
  return { ok: messages.length === 0, messages };
}

/** Commits already found red, keyed by full SHA, valued by the acRunners fingerprint (CONTRACT §5.2.1). */
function readRedCache(file: string): Record<string, string> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function redFirst(root: string, cfg: Config, range: string[]): CheckResult {
  const messages: string[] = [];
  const cacheFile = path.join(root, '.verify', 'red-first-cache.json');
  const fingerprint = createHash('sha256').update(JSON.stringify(cfg.acRunners.map((r) => ({ dir: r.dir, match: r.match.source, run: r.run })))).digest('hex');
  const cache = readRedCache(cacheFile);
  let added = false;
  for (const sha of range) {
    if (parentsOf(root, sha).length > 1) continue; // merges are skipped (CONTRACT §5.0)
    if (addedAcTests(root, cfg, sha).length === 0) continue;
    if (hasTrailer(commitMessage(root, sha), RED_FIRST_EXEMPT_TRAILER)) continue;
    const full = git(root, ['rev-parse', sha]).trim();
    if (cache[full] === fingerprint) continue;
    const r = checkRed(root, cfg, sha);
    if (!r.ok) messages.push(...r.messages.map((m) => `${shortSha(sha)} (red-first): ${m}`));
    else {
      cache[full] = fingerprint;
      added = true;
    }
  }
  if (added) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
    } catch {
      // A cache that can't be written only costs time on the next gate.
    }
  }
  return check('red-first', messages);
}
