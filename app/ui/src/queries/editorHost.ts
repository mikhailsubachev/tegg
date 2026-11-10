// Slice Q (docs/contracts/v1-queries.md §4.2 `QueryEditor.tsx`, §4.4): the one open query editor (R142). A block or the
// query page asks for it with `openQueryEditor`; the App renders `QueryEditorHost` once. The editor works on a copy of
// the definition, runs `query_run` `def` per change (no write) and hands the live result to its opener, then commits
// once (`query_apply`, then the rename job when the title changed).
import { useEffect, useState } from 'react';
import type { QueryDefDto, QueryDto, QueryResultDto } from '../ipc/queries';

export type EditorRequest = {
  /** The saved query's name; null for an unsaved draft (R144 `New query`, D-1471). */
  name: string | null;
  /** The note the block is on (`this`, FR-QRY-03); null on the query page. */
  host: string | null;
  /** The popover's anchor: the block's figure, or `Edit query` on the query page. */
  anchor: HTMLElement | null;
  /** Where the focus goes when the editor closes (the block or `Edit query`, R142). */
  returnFocus: HTMLElement | null;
  /** Start with the title selected (a new draft, board C). */
  selectTitle?: boolean;
  /** `Fix filter`: the broken row's `src` path to focus. */
  focusFilter?: number[] | null;
  /** The definition to start from when already known (a draft's defaults); else the editor reads `query_get`. */
  def?: QueryDefDto | null;
  /** Live results while editing (null when the editor closes: the opener shows its own run again). */
  onResult?: (r: QueryResultDto | null) => void;
  /** After a commit wrote: the query as written and the bytes before (for ⌘Z, D-1476). */
  onCommitted?: (c: { query: QueryDto; undo: string | null }) => void;
  /** A draft's first commit with a type, a filter or a changed title: create the file and write the fence. */
  onDraftCommit?: (title: string, def: QueryDefDto) => Promise<void>;
  /** A draft closed with nothing chosen (Esc, click outside): drop it, write nothing. */
  onDraftDrop?: () => void;
  /** The editor closed (after any commit). */
  onClosed?: () => void;
};

let current: EditorRequest | null = null;
let seq = 0;
const subs = new Set<(r: { req: EditorRequest | null; seq: number }) => void>();
function publish() { for (const f of subs) f({ req: current, seq }); }

/** Opens the editor for `req` (an open one is closed first, committing its change). */
export function openQueryEditor(req: EditorRequest) {
  current = req;
  seq++;
  publish();
}
/** Closes the editor without a commit (an external change took the note away, FR-EDT-02 AC-25). */
export function dismissQueryEditor(name?: string | null) {
  if (!current || (name !== undefined && current.name !== name)) return;
  const r = current;
  current = null;
  seq++;
  publish();
  r.onResult?.(null);
  r.onClosed?.();
}
/** Called by the editor itself once it closed. */
export function editorClosed(req: EditorRequest) {
  if (current !== req) return;
  current = null;
  seq++;
  publish();
}
export function queryEditorOpen(): EditorRequest | null { return current; }

export function useEditorRequest(): { req: EditorRequest | null; seq: number } {
  const [s, setS] = useState({ req: current, seq });
  useEffect(() => { subs.add(setS); setS({ req: current, seq }); return () => { subs.delete(setS); }; }, []);
  return s;
}

// ------------------------------------------------------------------ the shared live region and alert (§4.3)

type Notices = { live: { text: string; n: number } | null; alert: { text: string; n: number } | null };
let notices: Notices = { live: null, alert: null };
let n = 0;
const noticeSubs = new Set<(x: Notices) => void>();
let alertTimer: ReturnType<typeof setTimeout> | null = null;
function publishNotices(next: Partial<Notices>) { notices = { ...notices, ...next }; for (const f of noticeSubs) f(notices); }
/** One polite announcement (`query.editor.results` once per commit, FR-UX-08 AC-18). */
export function announceQuery(text: string) { publishNotices({ live: { text, n: ++n } }); }
/** `role="alert"` (§2.1: `query.editor.changedOutside`, `query.saveFailed`), cleared after 10 s. */
export function queryAlert(text: string | null) {
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = text ? setTimeout(() => { alertTimer = null; publishNotices({ alert: null }); }, 10_000) : null;
  publishNotices({ alert: text ? { text, n: ++n } : null });
}
export function useQueryNotices(): Notices {
  const [s, setS] = useState(notices);
  useEffect(() => { noticeSubs.add(setS); setS(notices); return () => { noticeSubs.delete(setS); }; }, []);
  return s;
}
