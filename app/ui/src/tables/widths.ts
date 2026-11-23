// Slice Q2: the shared column-width helper (docs/contracts/v1-views.md §4.2, D-1767; type-columns §4, R130, D-1248).
// Widths are machine-local (FR-STO-07): `typeColumnWidths[<type key>]` for a type page's `All <plural>` table,
// `usageColumnWidths[<usage key>]` for a saved query's table in one usage (a view tab, a block, the query page; Q2.1,
// R198, D-1845; 0.4.0's `queryColumnWidths` is no longer read or written). Every mounted table of one scope shows the
// same widths at once; a drag writes one `ui_state_set` on release.
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { UiStateDto } from '../ipc/types';

export const WIDTH = { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 } as const; // R130, D-1248

/** A width within R130's limits (`title` has its own minimum). */
export function clampWidth(key: string, px: number): number {
  return Math.round(Math.min(WIDTH.max, Math.max(key === 'title' ? WIDTH.titleMin : WIDTH.min, px)));
}

/** Slice Q3 (v1-views §40.2, §41.6; D-2177, D-2190): `type` (`All <plural>`) and `page` (`query/<name>`, a `page:` key)
 *  stay on this Mac; a `usage` (a tab, a block) keeps its widths in the vault through `write`, reading the 0.6.0 entry
 *  `usageColumnWidths[<usage key>]` while it has no own `widths`. A `usage` without `write` is machine-local (an
 *  inline fence's table). */
export type WidthScope =
  | { kind: 'type'; key: string }
  | { kind: 'page'; key: string }
  | { kind: 'usage'; key: string; own?: [string, number][] | null; order?: string[]; write?: (next: [string, number][] | null) => Promise<boolean>; disabled?: string | null };
type Widths = Record<string, number>;
type WidthsUi = Pick<UiStateDto, 'typeColumnWidths' | 'usageColumnWidths'>;

const nfc = (s: string) => s.normalize('NFC');
const scopeId = (s: WidthScope) => (s.kind === 'type' ? `type\n${nfc(s.key)}` : `usage\n${nfc(s.key)}`);
type VaultScope = Extract<WidthScope, { kind: 'usage' }> & { write: (next: [string, number][] | null) => Promise<boolean> };
const inVault = (s: WidthScope): s is VaultScope => s.kind === 'usage' && typeof s.write === 'function';

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

/** The 0.6.0 entry of a usage (D-2190), read while the usage has no own `widths`. */
export function legacyWidthsOf(usageKey: string): Widths | null {
  const m = impl?.get()?.usageColumnWidths?.[nfc(usageKey)];
  return m ? { ...(m as Widths) } : null;
}
/** One `ui_state_set` removing a usage's 0.6.0 entry (after its first vault width write). */
export function dropLegacyWidths(usageKey: string): void {
  const k = nfc(usageKey);
  if (!impl?.get()?.usageColumnWidths?.[k]) return;
  impl.update((u) => {
    const all = { ...(u.usageColumnWidths ?? {}) };
    delete all[k];
    return { ...u, usageColumnWidths: all };
  });
}

function stored(scope: WidthScope): Widths {
  if (inVault(scope)) {
    if (scope.own) return Object.fromEntries(scope.own.map(([k, w]) => [nfc(k), w]));
    return legacyWidthsOf(scope.key) ?? {};
  }
  const u = impl?.get();
  const m = scope.kind === 'type' ? u?.typeColumnWidths?.[nfc(scope.key)] : u?.usageColumnWidths?.[nfc(scope.key)];
  return { ...((m ?? {}) as Widths) };
}

/** The widths of a scope now: the stored ones with a running drag on top. */
export function widthsOf(scope: WidthScope): Widths {
  return { ...stored(scope), ...(live.get(scopeId(scope)) ?? {}) };
}

/** The pairs to write: Title first, then the column order, then other stored keys (R221). */
function ordered(map: Map<string, number>, order: readonly string[], storedKeys: readonly string[]): [string, number][] {
  const keys: string[] = [];
  const add = (k: string) => { if (map.has(k) && !keys.includes(k)) keys.push(k); };
  add('title');
  for (const k of order) add(nfc(k));
  for (const k of storedKeys) add(k);
  for (const k of map.keys()) add(k);
  return keys.map((k) => [k, map.get(k)!]);
}
/** One vault write of a usage's widths (none when they equal the disk); the 0.6.0 entry goes after a write. */
function writeVault(scope: VaultScope, next: [string, number][] | null): void {
  const id = scopeId(scope);
  const base = scope.own ?? [];
  const same = next !== null && next.length === base.length && next.every(([k, w]) => base.some(([b, bw]) => nfc(b) === k && bw === w));
  const legacy = legacyWidthsOf(scope.key);
  if (same || (next === null && !scope.own)) {
    live.delete(id);
    notify();
    if (next === null && legacy) dropLegacyWidths(scope.key);
    return;
  }
  void scope.write(next).then((ok) => {
    live.delete(id);
    notify();
    if (ok && legacy) dropLegacyWidths(scope.key);
  });
}
/** The widths after `changes` (only the changed widths clamped; others as stored, v1-views §45 choice 7). */
function vaultNext(scope: VaultScope, changes: Widths): [string, number][] {
  const own = scope.own ? scope.own.map(([k, w]) => [nfc(k), w] as [string, number]) : null;
  const base: [string, number][] = own ?? Object.entries(legacyWidthsOf(scope.key) ?? {}).map(([k, w]) => [nfc(k), w]);
  const map = new Map(base);
  for (const [k, w] of Object.entries(changes)) map.set(nfc(k), clampWidth(nfc(k), w));
  return ordered(map, scope.order ?? [], base.map(([k]) => k));
}

function write(scope: WidthScope, w: Widths): void {
  const id = scopeId(scope);
  if (inVault(scope)) {
    const cur = stored(scope);
    const changes = Object.fromEntries(Object.entries(w).filter(([k, v]) => cur[k] !== v));
    if (Object.keys(changes).length === 0) { live.delete(id); notify(); return; }
    writeVault(scope, vaultNext(scope, changes));
    return;
  }
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
  const pending = timers.get(id);
  if (pending) { clearTimeout(pending); timers.delete(id); }
  if (inVault(scope)) {
    if (scope.disabled) return;
    // Only the changed column: a vault write never pins the widths it didn't change (D-2190).
    const liveNow = { ...(live.get(id) ?? {}), [nfc(key)]: clampWidth(nfc(key), px) };
    if (save === true) { live.set(id, liveNow); write(scope, liveNow); return; }
    live.set(id, liveNow);
    notify();
    if (save === 'later') timers.set(id, setTimeout(() => flushWidths(scope), 1000));
    return;
  }
  const next = { ...widthsOf(scope), [nfc(key)]: clampWidth(nfc(key), px) };
  if (save === true) { write(scope, next); return; }
  live.set(id, next);
  notify();
  // Slice Q3 (§40.2): one write 1,000 ms after the last key (or when the handle loses the focus).
  if (save === 'later') timers.set(id, setTimeout(() => { timers.delete(id); write(scope, widthsOf(scope)); }, 1000));
}

/** Keyboard steps waiting for their write: written now (the handle lost the focus). */
export function flushWidths(scope: WidthScope): void {
  const id = scopeId(scope);
  const pending = timers.get(id);
  if (!pending) return;
  clearTimeout(pending);
  timers.delete(id);
  if (inVault(scope)) write(scope, live.get(id) ?? {});
  else write(scope, widthsOf(scope));
}

/** `⌫` on a handle (vault scope): that key removed; nothing when it isn't stored; empty widths go. */
export function removeWidth(scope: WidthScope, key: string): void {
  const id = scopeId(scope);
  const pending = timers.get(id);
  if (pending) { clearTimeout(pending); timers.delete(id); }
  if (!inVault(scope)) { setWidth(scope, key, key === 'title' ? WIDTH.titleFill : WIDTH.default, true); return; }
  if (scope.disabled) return;
  live.delete(id);
  const k = nfc(key);
  const cur = stored(scope);
  if (cur[k] === undefined) { notify(); return; }
  const map = new Map(Object.entries(cur));
  map.delete(k);
  const next = ordered(map, scope.order ?? [], Object.keys(cur));
  writeVault(scope, next.length ? next : null);
}

/** `Reset column widths`: the scope's entry goes. */
export function resetWidths(scope: WidthScope): void {
  const id = scopeId(scope);
  const pending = timers.get(id);
  if (pending) { clearTimeout(pending); timers.delete(id); }
  if (inVault(scope)) {
    if (scope.disabled) return;
    live.delete(id);
    writeVault(scope, null);
    return;
  }
  write(scope, {});
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The widths of a scope for a mounted table, updated whenever any table of the same scope changes them. */
export function useColumnWidths(scope: WidthScope): { widths: Widths; set: (key: string, px: number, save: boolean | 'later') => void; reset: () => void; remove: (key: string) => void; flush: () => void; vault: boolean } {
  useSyncExternalStore(subscribe, () => version);
  // The latest scope (its own widths and writer change with each run).
  const ref = useRef(scope);
  ref.current = scope;
  const id = scopeId(scope);
  const widths = widthsOf(scope);
  const set = useCallback((key: string, px: number, save: boolean | 'later') => setWidth(ref.current, key, px, save), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => resetWidths(ref.current), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = useCallback((key: string) => removeWidth(ref.current, key), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = useCallback(() => flushWidths(ref.current), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { widths, set, reset, remove, flush, vault: inVault(scope) };
}
