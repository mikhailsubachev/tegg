// Slice PIN (docs/contracts/v1-pinned.md §3.1 `store.ts`, §2 UI handling): the one `PinsDto` of the open vault, as
// tags/store.ts keeps the tags. `pins_apply` calls run one at a time, each with the version of the last answer; errors
// follow §2 (no automatic retry, D-1371). The alert and the live-region text live here too, so a pin from a menu or the
// palette is announced by the section.
import { useEffect, useState } from 'react';
import { events, ipc } from '../ipc/client';
import { t } from '../i18n/catalog';
import type { PinOpDto, PinRequestDto, PinsDto } from '../ipc/pins';

export type PinsUi = {
  pins: PinsDto | null;
  /** `role="alert"` text, with the missing row's index when it offers Unpin (R132) and the pins version it was read
   *  from (an Unpin sends that base, so an outside change in between is a conflict, never another row's unpin). */
  alert: { text: string; unpin: number | null; base?: PinsDto['version'] } | null;
  /** The live region's text, with a sequence so one text said twice is announced twice. */
  live: { text: string; seq: number } | null;
};

let state: PinsUi = { pins: null, alert: null, live: null };
const subs = new Set<(s: PinsUi) => void>();
let listening = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let alertTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;
let loads = 0;

function publish(next: Partial<PinsUi>) {
  state = { ...state, ...next };
  for (const f of subs) f(state);
}
const same = (a: PinsDto | null, b: PinsDto | null) => JSON.stringify(a) === JSON.stringify(b);

let inflight: Promise<PinsDto | null> | null = null;
let vaultKey: string | null = null;

/** Reads the pins again (one read at a time: a call while one runs shares it); an answer equal to the drawn one changes
 *  nothing. A read started before a vault switch is dropped. */
let again = false;
export function refreshPins(): Promise<PinsDto | null> {
  // A change during a read is read once more after it (the running read may have missed it).
  if (inflight) { again = true; return inflight; }
  const n = ++loads;
  const p = ipc.pinsGet().then((r) => {
    if (n === loads && !same(r, state.pins)) publish({ pins: r });
    return r;
  }, () => state.pins).finally(() => {
    if (n !== loads) return;
    inflight = null;
    if (again) { again = false; void refreshPins(); }
  });
  inflight = p;
  return p;
}

/** The open vault (NFC path, or null when none): a switch forgets the last vault's pins and reads the new ones. */
export function pinsForVault(path: string | null) {
  if (path === vaultKey) return;
  const first = vaultKey === null;
  vaultKey = path;
  if (!first || !path) {
    loads++;
    inflight = null;
    again = false;
    publish({ pins: null, alert: null, live: null });
  }
  if (path) void refreshPins();
}

function listen() {
  if (listening) return;
  listening = true;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void refreshPins(); }, 300);
  };
  // §2: every `vault:changed` (a target's rename, trash or type change changes rows) and the end of the first index build.
  void events.changed(later).catch(() => {});
  void events.progress((p) => { if (p.state === 'done' && state.pins && !state.pins.indexReady) void refreshPins(); }).catch(() => {});
}

export function pinsNow(): PinsDto | null {
  return state.pins;
}

export function usePins(): PinsUi {
  const [s, setS] = useState<PinsUi>(state);
  useEffect(() => {
    subs.add(setS);
    listen();
    setS(state); // App reads the pins when a vault opens (pinsForVault)
    return () => { subs.delete(setS); };
  }, []);
  return s;
}

export function setPinsAlert(alert: PinsUi['alert']) {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = alert ? setTimeout(() => { alertTimer = null; publish({ alert: null }); }, 10_000) : null;
  publish({ alert });
}

export function announce(text: string) {
  publish({ live: { text, seq: ++seq } });
}

/** One `pins_apply`; resolves true when it wrote (or was a no-op the core accepted), false on an error (§2). */
/** `base`: the version the action was chosen against (a menu or alert opened earlier); default the last answer's. */
type Base = { base: PinsDto['version'] } | undefined;
function apply(op: PinOpDto, said: (p: PinsDto) => string | null, at?: Base): Promise<boolean> {
  setPinsAlert(null);
  const task = queue.then(async () => {
    try {
      const next = await ipc.pinsApply(at ? at.base : state.pins?.version ?? null, op);
      publish({ pins: next });
      const text = said(next);
      if (text) announce(text);
      return true;
    } catch (e) {
      const err = e as { kind?: string; disk?: unknown };
      if (err?.kind === 'Conflict' && err.disk && typeof err.disk === 'object' && 'rows' in (err.disk as object)) {
        publish({ pins: { ...(err.disk as PinsDto), version: (err.disk as PinsDto).version ?? null } });
        await refreshPins();
        setPinsAlert({ text: t('pinned.changedOutside'), unpin: null });
      } else if (err?.kind === 'Conflict' || err?.kind === 'Gone' || err?.kind === 'NoSuchPin' || err?.kind === 'NotPinnable') {
        await refreshPins();
        setPinsAlert({ text: t('pinned.changedOutside'), unpin: null });
      } else if (err?.kind === 'NewerVersion' || err?.kind === 'Unreadable') {
        await refreshPins();
      } else {
        setPinsAlert({ text: t('pinned.saveFailed'), unpin: null });
      }
      return false;
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

/** Pins `request` at `at` (0-based; null: the end). A pinned target moves there instead (D-1379). */
export function pinTarget(request: PinRequestDto, at: number | null = null, label?: () => string | null): Promise<boolean> {
  return apply({ op: 'pin', target: request, at }, () => {
    const l = label?.();
    return l ? t('pinned.pinnedAnnounce', { label: l }) : null;
  });
}

export function unpin(index: number, label?: string, at?: Base): Promise<boolean> {
  return apply({ op: 'unpin', index }, () => (label ? t('pinned.unpinnedAnnounce', { label }) : null), at);
}

/** Moves listed pin `from` to final position `to`; a move to its own place sends nothing. */
export function move(from: number, to: number, at?: Base): Promise<boolean> {
  const n = state.pins?.rows.length ?? 0;
  if (from === to || to < 0 || to >= n) return Promise.resolve(false);
  return apply({ op: 'move', from, to }, (p) => t('pinned.moved', { position: to + 1, total: p.rows.length }), at);
}
