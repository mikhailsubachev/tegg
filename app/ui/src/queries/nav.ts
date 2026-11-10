// Slice Q: how query surfaces outside the App's tree (blocks mounted in the editor, embeds, the read view) open things.
// The App sets it once (as preview/store.ts's host).
import type { Route } from '../shell/routes';

export type QueryNav = {
  /** A note (a `.trash/` path opens the Trash with its row, as every link does). */
  openNote: (path: string) => void;
  /** `query/<name>`; `edit`: with its editor open (New query, Create it). */
  openQuery: (name: string, o?: { edit?: boolean }) => void;
  /** D-1490: the draft `new/<type>` with its pre-filled values. */
  openNew: (type: string, prefill: [string, unknown][]) => void;
  go: (r: Route) => void;
};

let nav: QueryNav | null = null;
export function setQueryNav(n: QueryNav | null) { nav = n; }
export function queryNav(): QueryNav | null { return nav; }

/** The query page to open with its editor (set by `openQuery(…, { edit: true })`, taken by the page once). */
let pendingEdit: string | null = null;
export function setPendingEdit(name: string | null) { pendingEdit = name?.normalize('NFC') ?? null; }
export function takePendingEdit(name: string): boolean {
  if (pendingEdit === null || pendingEdit !== name.normalize('NFC')) return false;
  pendingEdit = null;
  return true;
}
