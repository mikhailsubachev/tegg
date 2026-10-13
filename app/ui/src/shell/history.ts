// Back/forward history (FR-NAV-03, D-165, D-169, D-171; docs/contracts/ms3-shell.md §12.1). In memory only, one per
// window: the visited routes (a fragment makes a different route) with the centre pane's scroll position of each.
import { routeString, type Route } from './routes';

export type HistoryEntry = { route: Route; scrollTop: number };

export function createHistory(): {
  push(r: Route): void;
  back(): HistoryEntry | null;
  forward(): HistoryEntry | null;
  canBack(): boolean;
  canForward(): boolean;
  saveScroll(scrollTop: number): void;
  /** The current note was renamed: its entry now points at the new route. */
  replace(r: Route): void;
  clear(): void;
} {
  let entries: HistoryEntry[] = [];
  let at = -1;
  const key = (r: Route) => routeString(r).normalize('NFC');
  const copy = (e: HistoryEntry): HistoryEntry => ({ route: { ...e.route }, scrollTop: e.scrollTop });
  return {
    push(r) {
      if (at >= 0 && key(entries[at].route) === key(r)) return;
      entries = entries.slice(0, at + 1);
      entries.push({ route: { ...r }, scrollTop: 0 });
      at = entries.length - 1;
    },
    back() {
      if (at <= 0) return null;
      at--;
      return copy(entries[at]);
    },
    forward() {
      if (at < 0 || at >= entries.length - 1) return null;
      at++;
      return copy(entries[at]);
    },
    canBack: () => at > 0,
    canForward: () => at >= 0 && at < entries.length - 1,
    saveScroll(scrollTop) {
      if (at >= 0) entries[at].scrollTop = scrollTop;
    },
    replace(r) {
      if (at >= 0) entries[at] = { route: { ...r }, scrollTop: entries[at].scrollTop };
    },
    clear() {
      entries = [];
      at = -1;
    },
  };
}
