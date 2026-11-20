// Slice Q2: the shared column-width helper (docs/contracts/v1-views.md §4.2, D-1767; type-columns §4, R130, D-1248).
// Widths are machine-local (FR-STO-07): `typeColumnWidths[<type key>]` for a type page's `All <plural>` table,
// `usageColumnWidths[<usage key>]` for a saved query's table in one usage (a view tab, a block, the query page; Q2.1,
// R198, D-1845; 0.4.0's `queryColumnWidths` is no longer read or written). Every mounted table of one scope shows the
// same widths at once; a drag writes one `ui_state_set` on release.
import { useCallback, useSyncExternalStore } from 'react';
import type { UiStateDto } from '../ipc/types';

export const WIDTH = { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 } as const; // R130, D-1248

/** A width within R130's limits (`title` has its own minimum). */
export function clampWidth(key: string, px: number): number {
  return Math.round(Math.min(WIDTH.max, Math.max(key === 'title' ? WIDTH.titleMin : WIDTH.min, px)));
}

export type WidthScope = { kind: 'type'; key: string } | { kind: 'usage'; key: string };
type Widths = Record<string, number>;
type WidthsUi = Pick<UiStateDto, 'typeColumnWidths' | 'usageColumnWidths'>;

const nfc = (s: string) => s.normalize('NFC');
const scopeId = (s: WidthScope) => (s.kind === 'type' ? `type\n${nfc(s.key)}` : `usage\n${nfc(s.key)}`);

let impl: { get: () => WidthsUi | undefined; update: (f: <U extends WidthsUi>(u: U) => U) => void } | null = null;
/** Widths shown while a drag runs (not written yet), per scope. */
const live = new Map<string, Widths>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let version = 0;
const notify = () => { version++; for (const l of listeners) l(); };

/** The app registers how to read and change the UI state (one writer keeps the whole state). */
export function registerWidthsStore(i: typeof impl): void {
  impl = i;
  notify();
}
/** The app calls this after its UI state changed, so mounted tables re-read it. */
export function widthsChanged(): void {
  notify();
}

function stored(scope: WidthScope): Widths {
  const u = impl?.get();
  const m = scope.kind === 'type' ? u?.typeColumnWidths?.[nfc(scope.key)] : u?.usageColumnWidths?.[nfc(scope.key)];
  return { ...((m ?? {}) as Widths) };
}

/** The widths of a scope now: the stored ones with a running drag on top. */
export function widthsOf(scope: WidthScope): Widths {
  return { ...stored(scope), ...(live.get(scopeId(scope)) ?? {}) };
}

function write(scope: WidthScope, w: Widths): void {
  const id = scopeId(scope);
  live.delete(id);
  const empty = Object.keys(w).length === 0;
  impl?.update((u) => {
    if (scope.kind === 'type') {
      const all = { ...(u.typeColumnWidths ?? {}) };
      if (empty) delete all[nfc(scope.key)]; else all[nfc(scope.key)] = w;
      return { ...u, typeColumnWidths: all };
    }
    const all = { ...(u.usageColumnWidths ?? {}) };
    if (empty) delete all[nfc(scope.key)]; else all[nfc(scope.key)] = w;
    return { ...u, usageColumnWidths: all };
  });
  notify();
}

/** One column's width: `save` false shows it only (a drag in progress), true writes now (release), `'later'` writes
 *  once ≤ 1 s after the last call (keyboard steps). */
export function setWidth(scope: WidthScope, key: string, px: number, save: boolean | 'later'): void {
  const id = scopeId(scope);
  const next = { ...widthsOf(scope), [nfc(key)]: clampWidth(nfc(key), px) };
  const pending = timers.get(id);
  if (pending) { clearTimeout(pending); timers.delete(id); }
  if (save === true) { write(scope, next); return; }
  live.set(id, next);
  notify();
  if (save === 'later') timers.set(id, setTimeout(() => { timers.delete(id); write(scope, widthsOf(scope)); }, 500));
}

/** `Reset column widths`: the scope's entry goes. */
export function resetWidths(scope: WidthScope): void {
  const id = scopeId(scope);
  const pending = timers.get(id);
  if (pending) { clearTimeout(pending); timers.delete(id); }
  write(scope, {});
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The widths of a scope for a mounted table, updated whenever any table of the same scope changes them. */
export function useColumnWidths(scope: WidthScope): { widths: Widths; set: (key: string, px: number, save: boolean | 'later') => void; reset: () => void } {
  useSyncExternalStore(subscribe, () => version);
  const id = scopeId(scope);
  const widths = widthsOf(scope);
  const set = useCallback((key: string, px: number, save: boolean | 'later') => setWidth(scope, key, px, save), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => resetWidths(scope), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { widths, set, reset };
}
