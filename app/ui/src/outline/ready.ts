// Slice OL (docs/contracts/v1-outline.md §10): the once-per-process mark `outline-ready`, when the tab or the rail first
// paints rows (L6 waits for it). The only IPC of the outline (`perf_mark`, test builds).
import { ipc } from '../ipc/client';

let marked = false;
export function markOutlineReady(): void {
  if (marked) return;
  marked = true;
  requestAnimationFrame(() => { void ipc.perfMark('outline-ready').catch(() => {}); });
}
