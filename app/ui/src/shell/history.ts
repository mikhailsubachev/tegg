// Back/forward history (FR-NAV-03, D-165, D-169, D-171; docs/contracts/ms3-shell.md §12.1). In memory only, one per
// window: the visited routes (a fragment makes a different route) with the centre pane's scroll position of each.
import { routeString, type Route } from './routes';

/** Slice G2 (v1-graph §15.5, D-1037): the panel's hand-over to the full view, carried by that entry only. */
export type GraphHandover = { depth: 1 | 2 | 3; select: { path: string } | { tag: string } | null };
/** The note editor's selection when the entry was left (Back returns with its caret, graph.md FR-GRP-01 AC-11, AC-34). */
export type Caret = { anchor: number; head: number };
export type HistoryEntry = { route: Route; scrollTop: number; graph?: GraphHandover; caret?: Caret };

export function createHistory(): {
  push(r: Route, graph?: GraphHandover): void;
  back(): HistoryEntry | null;
  forward(): HistoryEntry | null;
  canBack(): boolean;
  canForward(): boolean;
  saveScroll(scrollTop: number, caret?: Caret | null): void;
  /** The current note was renamed: its entry now points at the new route. */
  replace(r: Route): void;
  /** The current entry's hand-over (G2: a depth change in the full view updates it). */
  current(): HistoryEntry | null;
  setGraph(graph: GraphHandover): void;
  clear(): void;
} {
  let entries: HistoryEntry[] = [];
  let at = -1;
  const key = (r: Route) => routeString(r).normalize('NFC');
  const copy = (e: HistoryEntry): HistoryEntry => ({ route: { ...e.route }, scrollTop: e.scrollTop, ...(e.graph ? { graph: { ...e.graph } } : {}), ...(e.caret ? { caret: { ...e.caret } } : {}) });
  // D-521: an unsaved new object (`new/<type>`) is an entry only while it is shown; once left, it is dropped.
  const draft = (e: HistoryEntry | undefined) => e?.route.id === 'new/<type>';
  const dropLeftDrafts = () => {
    const cur = entries[at];
    entries = entries.filter((e, i) => i === at || !draft(e));
    at = entries.indexOf(cur);
  };
  return {
    push(r, graph) {
      if (at >= 0 && key(entries[at].route) === key(r)) { if (graph) entries[at].graph = { ...graph }; return; }
      entries = entries.slice(0, at + 1);
      if (draft(entries[at])) { entries.pop(); at--; }
      entries.push({ route: { ...r }, scrollTop: 0, ...(graph ? { graph: { ...graph } } : {}) });
      at = entries.length - 1;
    },
    back() {
      if (at <= 0) return null;
      at--;
      dropLeftDrafts();
      return copy(entries[at]);
    },
    forward() {
      if (at < 0 || at >= entries.length - 1) return null;
      at++;
      dropLeftDrafts();
      return copy(entries[at]);
    },
    canBack: () => at > 0,
    canForward: () => at >= 0 && at < entries.length - 1,
    saveScroll(scrollTop, caret) {
      if (at < 0) return;
      entries[at].scrollTop = scrollTop;
      if (caret) entries[at].caret = { ...caret }; else delete entries[at].caret;
    },
    replace(r) {
      if (at >= 0) entries[at] = { route: { ...r }, scrollTop: entries[at].scrollTop };
    },
    current: () => (at >= 0 ? copy(entries[at]) : null),
    setGraph(graph) {
      if (at >= 0) entries[at].graph = { ...graph };
    },
    clear() {
      entries = [];
      at = -1;
    },
  };
}
