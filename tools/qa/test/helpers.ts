// Shared helpers for the QA tooling acceptance tests (black box, tools/qa/CONTRACT.md).
// Not an AC test file itself. Nothing in this module may throw at load time.
//
// Every scenario runs the real `verify` script at the repository root with a
// temporary git repository as its working directory (CONTRACT §1). A missing
// `verify` (red state) shows up as `status: null` plus `error`, which the
// assertion helpers turn into AssertionErrors.

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const VERIFY = path.resolve(import.meta.dirname, '../../../verify');
export const NODE_DIR = path.dirname(process.execPath);

/** The gate lock of the `verify` runs these tests start (D-1330): one per test process, so they never wait for a
 *  real gate on this machine or for another test file. A test passes its own `VERIFY_GATE_LOCK_DIR` to override it. */
export const TEST_GATE_LOCK_DIR = path.join(os.tmpdir(), `tegg-qa-gate-lock-${process.pid}`);

export const ZERO_SHA = '0000000000000000000000000000000000000000';

export type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | undefined;
};

export type RunOptions = {
  cwd: string;
  input?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
};

type Cleanup = { after: (fn: () => void) => void };

/** Environment for child processes: no inherited git hook / verify variables, node on PATH. */
export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('GIT_')) continue;
    if (k.startsWith('VERIFY_') || k === 'QA_SEED' || k === 'QA_PROPERTY_SCALE') continue;
    if (k === 'NODE_TEST_CONTEXT' || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  env.PATH = `${NODE_DIR}:${env.PATH ?? '/usr/bin:/bin'}`;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.VERIFY_GATE_LOCK_DIR = TEST_GATE_LOCK_DIR;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export function run(cmd: string, args: string[], opts: RunOptions): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input ?? '',
    env: cleanEnv(opts.env),
    encoding: 'utf8',
    timeout: opts.timeout ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    error: r.error ? String(r.error.message ?? r.error) : undefined,
  };
}

/** Runs the real `verify` with `cwd` as the working directory. */
export function verify(cwd: string, args: string[], opts: Omit<RunOptions, 'cwd'> = {}): RunResult {
  return run(VERIFY, args, { ...opts, cwd });
}

export function describe(r: RunResult): string {
  return [
    `exit status: ${r.status}${r.error ? ` (spawn error: ${r.error})` : ''}`,
    `--- stdout ---\n${r.stdout}`,
    `--- stderr ---\n${r.stderr}`,
  ].join('\n');
}

export function assertExit(r: RunResult, expected: number, what: string): void {
  assert.equal(r.status, expected, `${what}: expected exit code ${expected}\n${describe(r)}`);
}

export function assertNonZero(r: RunResult, what: string): void {
  assert.ok(r.status !== null && r.status !== 0, `${what}: expected a non-zero exit code\n${describe(r)}`);
}

export function output(r: RunResult): string {
  return `${r.stdout}\n${r.stderr}`;
}

// ---------------------------------------------------------------------------
// Temporary directories and repositories
// ---------------------------------------------------------------------------

export function tmpDir(t: Cleanup, prefix = 'tegg-qa-'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export function git(cwd: string, args: string[], opts: { input?: string; env?: Record<string, string | undefined> } = {}): string {
  const r = run('git', args, { cwd, input: opts.input, env: opts.env });
  assert.equal(r.status, 0, `test setup: git ${args.join(' ')} failed\n${describe(r)}`);
  return r.stdout;
}

export function gitTry(cwd: string, args: string[], opts: { input?: string; env?: Record<string, string | undefined> } = {}): RunResult {
  return run('git', args, { cwd, input: opts.input, env: opts.env });
}

export type Files = Record<string, string | Buffer>;

/**
 * Test keys used as *fixture data* (e.g. `fr_abc_01_ac1_x` inside a temp repo's test file) are written in this
 * repository's sources as `fr_abc_01_AC1_x`, so that the real `verify coverage` (CONTRACT §9.2), which scans every
 * `*.test.ts` here, doesn't count them as references to real ACs or as orphans. `k()` turns them into real keys;
 * `writeFiles` and `junitXml` apply it to everything they write.
 */
export function k(s: string): string {
  return s.replace(/_AC(\d+)/g, '_ac$1');
}

export function writeFiles(dir: string, files: Files): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? k(content) : content);
  }
}

export type Step = {
  id: string;
  run: string;
  level: 'commit' | 'push' | 'nightly' | 'milestone' | 'release';
  dir?: string;
  changedOnly?: boolean;
  cargoCache?: boolean;
  /** CONTRACT §3.2.2 (D-609): steps of one lane run in config order, lanes run concurrently. */
  lane?: string;
  /** CONTRACT §3.2.3 (D-611): repository-relative paths the step depends on (step memo). */
  inputs?: string[];
};

export type Config = {
  steps?: Step[];
  acTestPatterns?: string[];
  acRunners?: Array<{ dir: string; match: string; run: string }>;
  budgets?: Record<string, number>;
};

export const NODE_AC_RUNNER = {
  dir: '.',
  match: '\\.ac\\.test\\.ts$',
  run: 'node --test --test-reporter=junit --test-reporter-destination={junit} {files}',
};

export function configJson(cfg: Config): string {
  return JSON.stringify(cfg, null, 2) + '\n';
}

export type RepoOptions = {
  /** Config written as qa.config.json; `null` writes none. Default `{ steps: [] }`. */
  config?: Config | null;
  files?: Files;
  /** Set core.hooksPath to .githooks (default true, so the "hooks not installed" warning is off). */
  hooksPath?: boolean;
  /** Create an initial commit with all files (default true). */
  commit?: boolean;
  message?: string;
};

/** Creates a temporary git repository on branch `main`. Returns its real path (the toplevel). */
export function makeRepo(t: Cleanup, opts: RepoOptions = {}): string {
  const dir = tmpDir(t, 'tegg-qa-repo-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'QA Test']);
  git(dir, ['config', 'user.email', 'qa@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'tag.gpgsign', 'false']);
  if (opts.hooksPath !== false) git(dir, ['config', 'core.hooksPath', '.githooks']);
  // Mirrors the real repository: .verify/ and qa/nightly/ are machine-local (CONTRACT §1, §8.1).
  const files: Files = { 'README.md': '# temp repo\n', '.gitignore': '.verify/\nqa/nightly/\n', ...(opts.files ?? {}) };
  if (opts.config !== null) files['qa.config.json'] = configJson(opts.config ?? { steps: [] });
  writeFiles(dir, files);
  if (opts.commit !== false) commitAll(dir, opts.message ?? 'initial');
  return dir;
}

/** Stages everything and commits without running hooks (setup commits only). */
export function commitAll(dir: string, message: string, opts: { allowEmpty?: boolean } = {}): string {
  git(dir, ['add', '-A']);
  const args = ['commit', '-q', '--no-verify', '-m', message];
  if (opts.allowEmpty) args.push('--allow-empty');
  git(dir, args);
  return headSha(dir);
}

export function headSha(dir: string, rev = 'HEAD'): string {
  return git(dir, ['rev-parse', rev]).trim();
}

export function treeOf(dir: string, rev = 'HEAD'): string {
  return git(dir, ['rev-parse', `${rev}^{tree}`]).trim();
}

export function toplevel(dir: string): string {
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
}

export function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Files written by verify
// ---------------------------------------------------------------------------

export function readJsonFile(file: string, what: string): any {
  assert.ok(fs.existsSync(file), `${what}: expected file ${file} to exist`);
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    assert.fail(`${what}: ${file} is not valid JSON: ${String(e)}\n${text}`);
  }
}

export function lastSummary(repo: string, gate: string): any {
  return readJsonFile(path.join(repo, '.verify', `last-${gate}.json`), `summary of the ${gate} gate`);
}

export function readText(file: string, what: string): string {
  assert.ok(fs.existsSync(file), `${what}: expected file ${file} to exist`);
  return fs.readFileSync(file, 'utf8');
}

export function findCheck(summary: any, id: string): any {
  assert.ok(Array.isArray(summary?.checks), `summary.checks must be an array, got ${JSON.stringify(summary?.checks)}`);
  const c = summary.checks.find((x: any) => x?.id === id);
  assert.ok(c, `summary.checks has no check with id "${id}": ${JSON.stringify(summary.checks)}`);
  return c;
}

export function findStep(summary: any, id: string): any {
  assert.ok(Array.isArray(summary?.steps), `summary.steps must be an array, got ${JSON.stringify(summary?.steps)}`);
  const s = summary.steps.find((x: any) => x?.id === id);
  assert.ok(s, `summary.steps has no step with id "${id}": ${JSON.stringify(summary.steps)}`);
  return s;
}

export function checkMessages(summary: any, id: string): string {
  const c = findCheck(summary, id);
  assert.ok(Array.isArray(c.messages), `check ${id}: messages must be an array`);
  return c.messages.join('\n');
}

// ---------------------------------------------------------------------------
// JUnit and markers
// ---------------------------------------------------------------------------

export type Case = { name: string; classname?: string; fail?: boolean; error?: boolean; skipped?: boolean };

function xmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function junitXml(cases: Case[]): string {
  const body = cases
    .map((c) => {
      const open = `    <testcase name="${xmlAttr(c.name)}" classname="${xmlAttr(c.classname ?? 'suite')}" time="0.001"`;
      if (c.fail) return `${open}>\n      <failure type="AssertionError" message="expected">AssertionError: expected</failure>\n    </testcase>`;
      if (c.error) return `${open}>\n      <error type="Error" message="boom">Error: boom</error>\n    </testcase>`;
      if (c.skipped) return `${open}>\n      <skipped/>\n    </testcase>`;
      return `${open}/>`;
    })
    .join('\n');
  const failures = cases.filter((c) => c.fail).length;
  return k(`<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n  <testsuite name="suite" tests="${cases.length}" failures="${failures}">\n${body}\n  </testsuite>\n</testsuites>\n`);
}

/** Step command that appends one line to an absolute marker file, then runs `rest`. */
export function markStep(marker: string, rest = 'true'): string {
  return `echo ran >> ${sq(marker)}; ${rest}`;
}

/**
 * Step command that appends `start <ms>` to the absolute marker file, sleeps `seconds`, then appends `end <ms>`.
 * Uses node for millisecond timestamps (macOS `date` has no `%N`; node is on PATH in `cleanEnv`).
 */
export function stampStep(marker: string, seconds: number): string {
  const stamp = (label: string) =>
    `node -e 'require("fs").appendFileSync(process.argv[1], "${label} " + Date.now() + "\\n")' ${sq(marker)}`;
  return `${stamp('start')}; sleep ${seconds}; ${stamp('end')}`;
}

/** Reads the `start`/`end` timestamps written by `stampStep`. Missing lines give NaN (the assertion then fails). */
export function readStamps(marker: string): { start: number; end: number } {
  const text = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  const pick = (label: string) => {
    const m = text.match(new RegExp(`^${label} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : Number.NaN;
  };
  return { start: pick('start'), end: pick('end') };
}

export function countLines(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0).length;
}

/** Local calendar date YYYY-MM-DD in a given IANA time zone. */
export function localDate(timeZone: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Copies the real repository's .githooks into `repo` and adds a `verify` wrapper that execs the real one. */
export function installRealHooks(repo: string): void {
  const src = path.join(REPO_ROOT, '.githooks');
  assert.ok(fs.existsSync(src), `expected the repository to contain ${src}`);
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
    const from = path.join(src, name);
    assert.ok(fs.existsSync(from), `expected hook ${from} to exist`);
    const to = path.join(repo, '.githooks', name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o755);
  }
  const wrapper = path.join(repo, 'verify');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${sq(VERIFY)} "$@"\n`);
  fs.chmodSync(wrapper, 0o755);
  git(repo, ['config', 'core.hooksPath', '.githooks']);
}
