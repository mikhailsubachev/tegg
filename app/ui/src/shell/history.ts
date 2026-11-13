// Back/forward history (FR-NAV-03, D-165, D-169, D-171; docs/contracts/ms3-shell.md §12.1). In memory only, one per
// window: the visited routes (a fragment makes a different route) with the centre pane's scroll position of each.
import { routeString, type Route } from './routes';

/** Slice G2 (v1-graph §15.5, D-1037): the panel's hand-over to the full view, carried by that entry only. */
export type GraphHandover = { depth: 1 | 2 | 3; select: { path: string } | { tag: string } | null };
/** The note editor's selection when the entry was left (Back returns with its caret, graph.md FR-GRP-01 AC-11, AC-34);
 *  `follow` (slice OL, D-1610) maps it through later edits of the same editor (D-112). */
export type Caret = { anchor: number; head: number; follow?: () => { anchor: number; head: number } | null };
/** The Search page's state, carried by its entry only (v1-search §3, D-1217): Back restores it, nothing else keeps it. */
export type SearchState = { text: string; type: string | null; tags: string[]; loaded: number; focusPath: string | null };
export type HistoryEntry = { route: Route; scrollTop: number; graph?: GraphHandover; caret?: Caret; search?: SearchState };

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
  setSearch(search: SearchState): void;
  /** Slice OL (v1-outline §4, D-1610): a jump's place on the current route. Saves `from` on the current entry, drops the
   *  forward entries and adds `{ route: current route, scrollTop: to.scrollTop, caret: to.caret }`; the current
   *  `new/<type>` draft entry is kept (D-1638). */
  pushPlace(from: { scrollTop: number; caret: Caret | null }, to: { scrollTop: number; caret: Caret | null }): void;
  /** The entry a step `dir` would show, without stepping (null: none). */
  peek(dir: 'back' | 'forward'): HistoryEntry | null;
  clear(): void;
} {
  let entries: HistoryEntry[] = [];
  let at = -1;
  const key = (r: Route) => routeString(r).normalize('NFC');
  const copy = (e: HistoryEntry): HistoryEntry => ({
    route: { ...e.route }, scrollTop: e.scrollTop, ...(e.graph ? { graph: { ...e.graph } } : {}), ...(e.caret ? { caret: { ...e.caret } } : {}),
    ...(e.search ? { search: { ...e.search, tags: [...e.search.tags] } } : {}),
  });
  // D-521: an unsaved new object (`new/<type>`) is an entry only while it is shown; once left, it is dropped.
  const draft = (e: HistoryEntry | undefined) => e?.route.id === 'new/<type>';
  const dropLeftDrafts = () => {
    const cur = entries[at];
    // Slice OL (D-1638): a draft's own jump entries (same route) stay while it is shown; all go once it is left.
    entries = entries.filter((e, i) => i === at || !draft(e) || (draft(cur) && key(e.route) === key(cur.route)));
    at = entries.indexOf(cur);
  };
  return {
    push(r, graph) {
      if (at >= 0 && key(entries[at].route) === key(r)) { if (graph) entries[at].graph = { ...graph }; return; }
      entries = entries.slice(0, at + 1);
      // D-521, D-1638: the draft left (and its own jump entries, the same route) goes.
      const left = at >= 0 && draft(entries[at]) ? key(entries[at].route) : null;
      while (left !== null && at >= 0 && draft(entries[at]) && key(entries[at].route) === left) { entries.pop(); at--; }
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
      // The same view under its new path (a rename the full view or the note follows) keeps its hand-over and caret
      // (§15.5); another view starts without them.
      if (at < 0) return;
      const e = entries[at];
      entries[at] = e.route.id === r.id ? { ...e, route: { ...r } } : { route: { ...r }, scrollTop: e.scrollTop };
    },
    current: () => (at >= 0 ? copy(entries[at]) : null),
    setGraph(graph) {
      if (at >= 0) entries[at].graph = { ...graph };
    },
    setSearch(search) {
      if (at >= 0 && entries[at].route.id === 'search') entries[at].search = { ...search, tags: [...search.tags] };
    },
    pushPlace(from, to) {
      if (at < 0) return;
      const cur = entries[at];
      cur.scrollTop = from.scrollTop;
      if (from.caret) cur.caret = { ...from.caret }; else delete cur.caret;
      entries = entries.slice(0, at + 1);
      entries.push({ route: { ...cur.route }, scrollTop: to.scrollTop, ...(to.caret ? { caret: { ...to.caret } } : {}) });
      at = entries.length - 1;
    },
    peek(dir) {
      const i = dir === 'back' ? at - 1 : at + 1;
      return at >= 0 && i >= 0 && i < entries.length ? copy(entries[i]) : null;
    },
    clear() {
      entries = [];
      at = -1;
    },
  };
}
