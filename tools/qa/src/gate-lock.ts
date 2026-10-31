// One gate at a time on this machine (D-1330, CONTRACT §3.5): parallel gates load the machine so much that
// timing-sensitive WebKit tests fail falsely. Every heavy command takes a machine-wide lock first and waits for it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Set while a gate holds the lock; a `verify` started by that gate's steps doesn't wait for its own parent. */
const HELD = 'VERIFY_GATE_LOCK_HELD';

type Owner = { pid: number; command: string; checkout: string; started: string };

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

function readOwner(lock: string): Owner | undefined {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')) as Owner;
    return Number.isInteger(o.pid) ? o : undefined;
  } catch {
    return undefined;
  }
}

/** A lock whose owner has exited, or that never got an owner file within 30 s, is stale. */
function stale(lock: string): boolean {
  const o = readOwner(lock);
  if (o) return !alive(o.pid);
  try {
    return Date.now() - fs.statSync(lock).mtimeMs > 30_000;
  } catch {
    return false; // gone already
  }
}

/** Moves a stale lock aside first, so two waiters that both find it stale can't remove a fresh one. */
function breakStale(lock: string): void {
  const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lock, aside);
  } catch {
    return;
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
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    process.stderr.write(`verify: warning: can't create the gate lock folder ${dir} (${(e as Error).message}); running without the one-gate-at-a-time lock\n`);
    return;
  }
  let waitingSince = 0;
  let lastNote = 0;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        process.stderr.write(`verify: warning: can't take the gate lock ${lock} (${code}); running without it\n`);
        return;
      }
    }
    if (stale(lock)) {
      breakStale(lock);
      continue;
    }
    const now = Date.now();
    if (!waitingSince) waitingSince = now;
    if (now - lastNote >= 60_000) {
      const o = readOwner(lock);
      const who = o ? `${o.command} in ${o.checkout} (pid ${o.pid}, since ${o.started})` : 'another gate';
      const waited = Math.round((now - waitingSince) / 60_000);
      console.log(`verify: waiting for ${who} to finish; only one gate runs at a time (D-1330)${waited ? `, waited ${waited} min` : ''}`);
      lastNote = now;
    }
    await sleep(poll);
  }
  const owner: Owner = { pid: process.pid, command, checkout, started: new Date().toISOString() };
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(owner) + '\n');
  process.env[HELD] = String(process.pid);
  const release = () => {
    if (readOwner(lock)?.pid === process.pid) fs.rmSync(lock, { recursive: true, force: true });
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      release();
      process.kill(process.pid, sig);
    });
  }
}
