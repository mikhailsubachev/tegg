// FR-EDT-11 AC-20 benchmark helpers (docs/acceptance/outline.md; docs/contracts/v1-outline.md §8, D-1623): the perf line
// `{"mark":"outline","frame":<n>,"ms":<float>}` that test builds append to TEGG_PERF_LOG when a refresh's rows have painted
// (ms from the last printable keydown), and 50 keystrokes with a 400 ms pause each, sent through System Events while Tegg
// is frontmost (helpers/osa.ts, D-758, D-799). No assertions about the AC outcome here.
import { existsSync, readFileSync } from 'node:fs';
import { osa } from './helpers/osa.ts';

export type OutlineLine = { mark: string; frame?: number; ms: number };

export function outlineLines(log: string): OutlineLine[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as OutlineLine; } catch { return { mark: '?', ms: NaN }; } })
    .filter((m) => m.mark === 'outline');
}

/** One key, a 400 ms pause, × 50, in one AppleScript run. */
export function type50(char = 'x') {
  osa('tell application "System Events"', 'repeat 50 times', `keystroke "${char}"`, 'delay 0.4', 'end repeat', 'end tell');
}

export function p95(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)] : NaN;
}
