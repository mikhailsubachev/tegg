// Recent icons (docs/contracts/v1-cards.md §7.8, §10; FR-TYP-01 AC-18, FR-STO-07 AC-15; D-2066, D-2101): canonical
// Lucide names, newest first, unique, at most 12, in the machine-local UI state (`ui-state.json`), never in the vault.
// The app owns the UI state and registers how to read and change it, so each choice is one `ui_state_set`.
import type { UiStateDto } from '../ipc/types';

export const RECENT_MAX = 12;

/** Pure: `canonical` moved to the front, without repeats, the last 12. */
export function pushRecent(list: readonly string[], canonical: string): string[] {
  return [canonical, ...list.filter((n) => n !== canonical)].slice(0, RECENT_MAX);
}

type RecentUi = Pick<UiStateDto, 'recentIcons'>;
let impl: { get: () => RecentUi | undefined; update: (f: <U extends RecentUi>(u: U) => U) => void } | null = null;

export function registerRecentIcons(i: typeof impl): void {
  impl = i;
}

/** The stored list (read from the in-memory UI state when the picker opens, no extra call). */
export function recentIcons(): string[] {
  return [...(impl?.get()?.recentIcons ?? [])].slice(0, RECENT_MAX);
}

/** One `ui_state_set` per choice (also the current icon, D-2101). */
export function rememberIcon(canonical: string): void {
  if (!impl) return;
  impl.update((u) => ({ ...u, recentIcons: pushRecent(u.recentIcons ?? [], canonical) }));
}
