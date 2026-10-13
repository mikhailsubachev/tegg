// Back/forward history (FR-NAV-03, D-165; docs/contracts/ms3-shell.md §12.1).
// STUB for the red AC tests (TS-I1): compiles and returns deliberately wrong results. Slice 3B.1 implements it.
import type { Route } from './routes';

export type HistoryEntry = { route: Route; scrollTop: number };

export function createHistory(): {
  push(r: Route): void;
  back(): HistoryEntry | null;
  forward(): HistoryEntry | null;
  canBack(): boolean;
  canForward(): boolean;
  saveScroll(scrollTop: number): void;
  clear(): void;
} {
  return {
    push: () => {},
    back: () => null,
    forward: () => null,
    canBack: () => false,
    canForward: () => false,
    saveScroll: () => {},
    clear: () => {},
  };
}
