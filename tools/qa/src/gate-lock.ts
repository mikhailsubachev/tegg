// One gate at a time on this machine (D-1330, CONTRACT §3.5): parallel gates load the machine so much that
// timing-sensitive WebKit tests fail falsely. Every heavy command takes a machine-wide lock first and waits for it.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { killSteps, stopSteps } from './proc.ts';

/** Set while a gate holds the lock; a `verify` started by that gate's steps doesn't wait for its own parent. */
const HELD = 'VERIFY_GATE_LOCK_HELD';

type Owner = { pid: number; command: string; checkout: string; started: string; id: string; procStart?: string; boot?: number };

/** The lock directory: `$VERIFY_GATE_LOCK_DIR`, else one per user outside every checkout and worktree. */
export function gateLockDir(): string {
  const dir = process.env.VERIFY_GATE_LOCK_DIR;
  if (dir) return path.resolve(dir);
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache');
  return path.join(base, 'tegg-verify');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When `pid` started, as `ps` prints it; undefined if the system can't tell. Together with the pid it names one process.
 *  A fixed locale and time zone, so every shell and launchd print the same string for the same process. */
function procStart(pid: number): string | undefined {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' } });
  const s = r.status === 0 ? r.stdout.trim() : '';
  return s || undefined;
}

/** System boot time in seconds since the epoch; undefined if the system can't tell. */
function bootTime(): number | undefined {
  try {
    if (process.platform === 'darwin') {
      const m = /sec = (\d+)/.exec(spawnSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }).stdout ?? '');
      return m ? Number(m[1]) : undefined;
    }
    const m = /^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf8'));
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

function readOwner(lock: string): Owner | undefined {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')) as Owner;
    return Number.isInteger(o.pid) ? o : undefined;
  } catch {
    return undefined;
  }
}

/** A lock is stale when it has no owner record, its owner has exited, or the pid now belongs to another process:
 *  told by the start time, else by the boot time (the system moves it when the clock is set, so it's the fallback).
 *  A lock never lacks its owner record while it's being made (it's renamed into place). */
function stale(o: Owner | undefined): boolean {
  if (!o) return true;
  if (!alive(o.pid)) return true;
  const start = o.procStart === undefined ? undefined : procStart(o.pid);
  if (start !== undefined) return start !== o.procStart;
  const boot = o.boot === undefined ? undefined : bootTime();
  return boot !== undefined && boot !== o.boot;
}

function oldFolder(f: string): boolean {
  try {
    return Date.now() - fs.statSync(f).mtimeMs > 60_000;
  } catch {
    return false;
  }
}

/** Removes the folders that stale owners left next to the lock: drafts of killed waiters, locks moved aside. One
 *  without an owner record is only removed after a minute: it may be another waiter's draft in the making. */
function sweep(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const f = path.join(dir, n);
    if (!n.startsWith('gate.lock.')) continue;
    const o = readOwner(f);
    if (o ? stale(o) : oldFolder(f)) fs.rmSync(f, { recursive: true, force: true });
  }
}

/** Removes the stale lock judged from `judged`. It's moved aside first and moved back if it turns out to be another
 *  waiter's fresh lock, so two waiters that both find the same stale lock can't remove a lock taken meanwhile. */
function breakStale(lock: string, judged: Owner | undefined): void {
  const aside = `${lock}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(lock, aside);
  } catch {
    return; // gone already
  }
  if (readOwner(aside)?.id !== judged?.id) {
    try {
      fs.renameSync(aside, lock);
      return;
    } catch {
      // a third command took the lock meanwhile; the moved lock is only removed if it's stale itself
      if (!stale(readOwner(aside))) return;
    }
  }
  fs.rmSync(aside, { recursive: true, force: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until this process holds the gate lock. Returns at once inside a gate that already holds it. With
 *  `signals: false` the lock is only released on exit, for a host that handles its own signals (Playwright). */
export async function acquireGateLock(command: string, checkout: string, opts: { signals?: boolean } = {}): Promise<void> {
  if (process.env[HELD]) return;
  const dir = gateLockDir();
  const lock = path.join(dir, 'gate.lock');
  const poll = Number(process.env.VERIFY_GATE_LOCK_POLL_MS) || 2000;
  const owner: Owner = { pid: process.pid, command, checkout, started: new Date().toISOString(), id: crypto.randomUUID(), procStart: procStart(process.pid), boot: bootTime() };
  // The lock is made in a private folder with its owner record and renamed into place: one atomic step.
  const draft = `${lock}.${owner.id}`;
  try {
    fs.mkdirSync(draft, { recursive: true });
    fs.writeFileSync(path.join(draft, 'owner.json'), JSON.stringify(owner) + '\n');
  } catch (e) {
    process.stderr.write(`verify: warning: can't create the gate lock folder ${dir} (${(e as Error).message}); running without the one-gate-at-a-time lock\n`);
    return;
  }
  sweep(dir);
  // Until the lock is taken, an exit or a signal only removes the draft; afterwards it releases the lock, which is
  // moved aside first so it's never seen without its owner record.
  let held = false;
  const cleanup = () => {
    if (!held) {
      fs.rmSync(draft, { recursive: true, force: true });
      return;
    }
    if (readOwner(lock)?.id !== owner.id) return;
    const aside = `${lock}.released-${owner.id}`;
    try {
      fs.renameSync(lock, aside);
    } catch {
      return;
    }
    fs.rmSync(aside, { recursive: true, force: true });
  };
  process.on('exit', cleanup);
  // The steps run in their own process groups, so they only get a signal when it's passed on; the lock stays until
  // they've exited, or another gate would start next to them. A second signal kills them at once.
  const signals = opts.signals === false ? [] : (['SIGINT', 'SIGTERM', 'SIGHUP'] as const);
  for (const sig of signals) {
    let stopping = false;
    const exitBy = () => {
      cleanup();
      for (const s of signals) process.removeAllListeners(s);
      process.kill(process.pid, sig);
    };
    process.on(sig, () => {
      if (stopping) {
        killSteps();
        exitBy();
        return;
      }
      stopping = true;
      void stopSteps(sig).then(exitBy);
    });
  }
  let waitingSince = 0;
  let lastNote = 0;
  for (;;) {
    try {
      fs.renameSync(draft, lock);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
        process.stderr.write(`verify: warning: can't take the gate lock ${lock} (${code}); running without it\n`);
        cleanup();
        return;
      }
    }
    const o = readOwner(lock);
    if (stale(o)) {
      breakStale(lock, o);
      continue;
    }
    const now = Date.now();
    if (!waitingSince) waitingSince = now;
    if (now - lastNote >= 60_000) {
      const who = `${o!.command} in ${o!.checkout} (pid ${o!.pid}, since ${o!.started})`;
      const waited = Math.round((now - waitingSince) / 60_000);
      console.log(`verify: waiting for ${who} to finish; only one gate runs at a time (D-1330)${waited ? `, waited ${waited} min` : ''}`);
      lastNote = now;
    }
    await sleep(poll);
  }
  held = true;
  process.env[HELD] = String(process.pid);
}
