// Slice 5A-2: the note page's alerts from the conversion flow and the Task card (FR-CNV-03 AC-6, FR-CNV-06 AC-3,
// FR-CNV-05 AC-7): a small external store, because Task cards render in their own React roots (node views).
import { useSyncExternalStore } from 'react';

export type PageAlert = { id: number; text: string; retry?: () => void };

let alerts: PageAlert[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Shows `text` (once: an equal alert is replaced). */
export function pushAlert(text: string, retry?: () => void): void {
  alerts = [...alerts.filter((a) => a.text !== text), { id: ++seq, text, retry }];
  emit();
}

export function dismissAlert(id: number): void {
  alerts = alerts.filter((a) => a.id !== id);
  emit();
}

/** Clears every alert (a new note page). */
export function clearAlerts(): void {
  if (!alerts.length) return;
  alerts = [];
  emit();
}

export function usePageAlerts(): PageAlert[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => alerts);
}
