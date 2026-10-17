// Dev-server ports for gate runs (CONTRACT §3.2.1, D-343).

import { createHash } from 'node:crypto';
import { exec } from './proc.ts';

const PROBE = `const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen(Number(process.argv[1]),()=>s.close(()=>process.exit(0)))`;

/**
 * The port a tree gate's steps bind their dev servers to (CONTRACT §3.2.1, D-343): derived from the worktree
 * path, so two gates of the same repository (stable path and fall-back temporary path) start from different
 * candidates, then moved up past any port that is already taken. Never the developer ports (5177, 5174).
 */
export function gatePortBase(worktree: string, isFree: (port: number) => boolean = portFree): number {
  const hash = createHash('sha256').update(worktree).digest();
  let port = 20000 + (hash.readUInt16BE(0) % 10000);
  while (!isFree(port)) port = port >= 29999 ? 20000 : port + 1;
  return port;
}

function portFree(port: number): boolean {
  return exec(process.execPath, ['-e', PROBE, String(port)], { cwd: process.cwd() }).status === 0;
}
