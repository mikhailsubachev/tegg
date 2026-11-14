// Slice OL (docs/contracts/v1-outline.md §3.3, §3.5, §10): the window's one outline source, the current section, the
// card's state and the test hook. The rail and the card read from here, so they can't disagree (R172 rule
// 7). Nothing here calls IPC or writes anything.
import { useSyncExternalStore } from 'react';
import type { OutlineNode } from '@tegg/doc';

/** What the outline reads (R171 rule 1, D-1619, D-1620): the text the centre pane shows. */
export type OutlineSource = {
  view: 'editor' | 'source';
  /** The note's key: its `id`, else its vault path in NFC; null for an unwritten `new/<type>` draft. A new key closes the card. */
  key: string | null;
  version: number;
  tree: OutlineNode[];
  /** The rendered element of heading i, or the nearest rendered block holding it. */
  element(i: number): HTMLElement | null;
  jump(i: number, version: number): 'ok' | 'stale';
  refocus(): void;
  /** Recomputes the outline at once (a stale click, the end of a test hold). */
  refresh(): void;
};

type Card = { open: boolean; by: 'hover' | 'key'; tempOpen: ReadonlySet<number> };

let source: OutlineSource | null = null;
let current: number | null = null;
let card: Card = { open: false, by: 'hover', tempOpen: new Set() };
let held = false;
let railShown: number[] = [];
/** A request to focus a card row; OutlineEdge consumes it. */
let focusReq: { where: 'card'; n: number } | null = null;
let liveText = '';
const listeners = new Set<() => void>();
const emit = () => { for (const f of listeners) f(); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** The page publishes its source; null when it shows no note text (gone, loading, the read view) or unmounts. */
export function publishOutline(s: OutlineSource | null): void {
  if (s === source) return;
  const keyChanged = (s?.key ?? null) !== (source?.key ?? null) || !s || !source;
  source = s;
  if (!s) current = null;
  else if (current !== null && current >= s.tree.length) current = null;
  if (!s || keyChanged) closeCard();
  emit();
}
export const getOutline = () => source;
export const useOutline = () => useSyncExternalStore(subscribe, () => source);

export function setCurrent(i: number | null): void {
  if (i === current) return;
  current = i;
  emit();
}
export const getCurrent = () => current;
export const useCurrent = () => useSyncExternalStore(subscribe, () => current);

export const getCard = () => card;
export const useCard = () => useSyncExternalStore(subscribe, () => card);
export function openCard(by: 'hover' | 'key'): void {
  if (card.open && card.by === by) return;
  card = { open: true, by: card.open && card.by === 'key' ? 'key' : by, tempOpen: card.open ? card.tempOpen : new Set() };
  emit();
}
/** Closing clears the card's temporary opens (R173). */
export function closeCard(): void {
  if (!card.open && card.tempOpen.size === 0) return;
  card = { open: false, by: 'hover', tempOpen: new Set() };
  emit();
}
export function setTempOpen(i: number, on: boolean): void {
  if (card.tempOpen.has(i) === on) return;
  const next = new Set(card.tempOpen);
  if (on) next.add(i); else next.delete(i);
  card = { ...card, tempOpen: next };
  emit();
}

export const isHeld = () => held;
export function setRailRows(rows: number[]): void { railShown = rows; }

export function requestFocus(where: 'card'): void {
  focusReq = { where, n: (focusReq?.n ?? 0) + 1 };
  emit();
}
export function takeFocus(where: 'card'): boolean {
  if (focusReq?.where !== where) return false;
  focusReq = null;
  return true;
}
export const useFocusReq = () => useSyncExternalStore(subscribe, () => focusReq);

/** The polite live region's text (⌘J with no headings): cleared first, so a repeat is announced again. */
export function announce(text: string): void {
  liveText = '';
  emit();
  setTimeout(() => { liveText = text; emit(); }, 30);
}
export const useLive = () => useSyncExternalStore(subscribe, () => liveText);

/** `window.__TEGG_TEST__.outline` (§10). */
function installHook(): void {
  if (typeof window === 'undefined') return;
  const w = window as { __TEGG_TEST__?: Record<string, unknown> };
  w.__TEGG_TEST__ = {
    ...(w.__TEGG_TEST__ ?? {}),
    outline: {
      headings: () => (source?.tree ?? []).map((n) => ({ level: n.level, text: n.text, from: n.from, to: n.to, depth: n.depth, key: n.key })),
      current: () => current,
      hold: (on: boolean) => { held = !!on; if (!held) source?.refresh(); },
      railRows: () => [...railShown],
    },
  };
}
installHook();
export function ensureHook(): void {
  const w = window as { __TEGG_TEST__?: Record<string, unknown> };
  if (!w.__TEGG_TEST__?.outline) installHook();
}
