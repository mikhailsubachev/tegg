// NFR-PERF-06 AC-5 / FR-SYN-03 AC-20 benchmark helpers (docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.4,
// D-66, D-190): types 200 characters, one every 40 ms, into the built app through System Events, and reads the latency
// probe's lines `{"mark":"key","frame":<n>,"ms":<float>}` from TEGG_PERF_LOG. The display should run at 60 Hz for the
// gated run (D-190; set by the owner before the run). No assertions about the AC outcome here.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export type KeyLine = { mark: string; frame?: number; ms: number };

export function keyLines(log: string): KeyLine[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as KeyLine).filter((m) => m.mark === 'key');
}

/** 200 keystrokes, one every 40 ms, in one AppleScript run (per-key osascript calls would be slower than 40 ms). */
export function type200(char = 'a') {
  execFileSync('osascript', ['-e', `tell application "System Events"\nrepeat 200 times\nkeystroke "${char}"\ndelay 0.04\nend repeat\nend tell`]);
}

export function summary(lines: KeyLine[]) {
  const ms = lines.map((l) => l.ms).sort((a, b) => a - b);
  const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)] : NaN);
  return {
    n: lines.length,
    frame1: lines.length ? lines.filter((l) => l.frame === 1).length / lines.length : 0,
    late: lines.filter((l) => (l.frame ?? 99) > 2).length,
    p50: q(0.5), p95: q(0.95), max: ms.length ? ms[ms.length - 1] : NaN,
  };
}
