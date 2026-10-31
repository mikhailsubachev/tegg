// Shared helpers for the gate-lock tests (D-1330, TS-VERIFY AC-8, tools/qa/CONTRACT.md §3.5). Black box: they
// only create lock folders the way the contract describes them and watch processes from the outside.
// Not a test file itself. Nothing in this module may throw at load time.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanEnv, VERIFY } from './helpers.ts';

type Cleanup = { after: (fn: () => void) => void };

/** Environment for a `verify` run with its own lock folder and a short poll interval. */
export const lockEnv = (dir: string, extra: Record<string, string | undefined> = {}) => ({
  VERIFY_GATE_LOCK_DIR: dir,
  VERIFY_GATE_LOCK_POLL_MS: '100',
  ...extra,
});

/** `ps -o lstart= -p <pid>`, trimmed (CONTRACT §3.5 `procStart`). Empty if the process doesn't exist. */
export function procStartOf(pid: number): string {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

/** The system boot time in seconds since the epoch (macOS `kern.boottime`, Linux `btime`); NaN if unknown. */
export function bootTime(): number {
  if (process.platform === 'darwin') {
    const r = spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' });
    const m = (r.stdout ?? '').match(/sec\s*=\s*(\d+)/);
    return m ? Number(m[1]) : Number.NaN;
  }
  try {
    const m = fs.readFileSync('/proc/stat', 'utf8').match(/^btime\s+(\d+)$/m);
    return m ? Number(m[1]) : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** True if `pid` names a running process that isn't a zombie. */
export function isAlive(pid: number): boolean {
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const stat = (r.stdout ?? '').trim();
  return stat.length > 0 && !stat.startsWith('Z');
}

export function killQuietly(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return;
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

/**
 * A lock held by a live process (a spawned `sleep`), as a running gate leaves it. `record` overrides or adds owner
 * fields; a field set to `undefined` is left out. The sleep is killed and the lock removed in `t.after`.
 */
export function holdLock(
  t: Cleanup,
  dir: string,
  record: (pid: number) => Record<string, unknown> = () => ({}),
): { pid: number; release: () => void } {
  const child = spawn('sleep', ['120'], { stdio: 'ignore' });
  const pid = child.pid as number;
  const lock = path.join(dir, 'gate.lock');
  fs.mkdirSync(lock, { recursive: true });
  const owner: Record<string, unknown> = {
    pid,
    command: 'push',
    checkout: '/elsewhere',
    started: '2026-10-31T09:00:00+01:00',
    id: `test-owner-${pid}`,
    ...record(pid),
  };
  for (const [k, v] of Object.entries(owner)) if (v === undefined) delete owner[k];
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    child.kill('SIGKILL');
    fs.rmSync(lock, { recursive: true, force: true });
  };
  t.after(release);
  return { pid, release };
}

export type AsyncRun = {
  child: ChildProcess;
  pid: number;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdout: () => string;
  stderr: () => string;
};

/** Starts the real `verify` without waiting for it; it is SIGKILLed in `t.after` if still running. */
export function startVerify(t: Cleanup, cwd: string, args: string[], env: Record<string, string | undefined>): AsyncRun {
  const child = spawn(VERIFY, args, { cwd, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout?.setEncoding('utf8').on('data', (d: string) => (out += d));
  child.stderr?.setEncoding('utf8').on('data', (d: string) => (err += d));
  let done = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => {
      done = true;
      resolve({ code, signal });
    });
    child.on('error', () => {
      done = true;
      resolve({ code: null, signal: null });
    });
  });
  t.after(() => {
    if (!done) killQuietly(child.pid);
  });
  return { child, pid: child.pid as number, exited, stdout: () => out, stderr: () => err };
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves to `'resolved'` when `p` settles successfully within `ms`, else `'timeout'` (the timer doesn't linger). */
export async function settlesWithin(p: Promise<unknown>, ms: number): Promise<'resolved' | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), ms);
  });
  try {
    return await Promise.race([p.then(() => 'resolved' as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls `cond` every 10 ms until it holds or `ms` elapse; returns whether it held. */
export async function waitUntil(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleepMs(10);
  }
  return cond();
}

/** Resolves to the exit of `run`, or to `'timeout'` after `ms`. */
export async function exitWithin(run: AsyncRun, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), ms);
  });
  try {
    return await Promise.race([run.exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function describeAsync(run: AsyncRun): string {
  return `--- stdout ---\n${run.stdout()}\n--- stderr ---\n${run.stderr()}`;
}

export function readOwner(dir: string): any {
  const file = path.join(dir, 'gate.lock', 'owner.json');
  assert.ok(fs.existsSync(file), `expected ${file} to exist while the gate holds the lock`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
