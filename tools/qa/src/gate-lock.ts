// One gate at a time on this machine (D-1330, CONTRACT §3.5): parallel gates load the machine so much that
// timing-sensitive WebKit tests fail falsely. Every heavy command takes a machine-wide lock first and waits for it.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopSteps } from './proc.ts';

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

/** When `pid` started, as `ps` prints it; undefined if the system can't tell. Together with the pid it names one process. */
function procStart(pid: number): string | undefined {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
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

/** A lock is stale when it has no owner record, its owner has exited, the machine restarted since, or the pid now
 *  belongs to another process. A lock never lacks its owner record while it's being made (it's renamed into place). */
function stale(o: Owner | undefined): boolean {
  if (!o) return true;
  if (!alive(o.pid)) return true;
  const boot = o.boot === undefined ? undefined : bootTime();
  if (boot !== undefined && boot !== o.boot) return true;
  const start = o.procStart === undefined ? undefined : procStart(o.pid);
  return start !== undefined && start !== o.procStart;
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

/** Waits until this process holds the gate lock. Returns at once inside a gate that already holds it. */
export async function acquireGateLock(command: string, checkout: string): Promise<void> {
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
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      // The steps run in their own process groups, so they only get the signal when it's passed on; the lock stays
      // until they've exited, or another gate would start next to them.
      void stopSteps(sig).then(() => {
        cleanup();
        process.kill(process.pid, sig);
      });
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
