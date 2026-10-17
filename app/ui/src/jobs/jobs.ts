// Slice 4C (docs/contracts/ms4-jobs.md §10): the UI side of the job engine: start a note rename on a title commit
// (D-268), undo and redo it (D-385), follow `job:progress` (FR-UX-07 AC-8, AC-9), and keep the "links not updated"
// list in memory until quit (D-398). One store for the app; components read it with `useJobs`.
import { useSyncExternalStore } from 'react';
import { errorKind, events, ipc } from '../ipc/client';
import type { JobProgressDto, JobReportDto, NoteRenameDto } from '../ipc/types';

export type SkipRow = { jobId: number; path: string; title: string; reason: string };
/** A finished rename, undo or redo that moved a note (the open note page follows it). */
export type Moved = { jobId: number; from: string; to: string };

type Status = { phase: 'running' | 'done'; count: number; jobId: number } | null;
type Tracked = { kind: 'rename' | 'undo' | 'redo'; of?: number; path: string; done?: (r: JobReportDto | null) => void };

type State = {
  status: Status;
  rows: SkipRow[];
  listOpen: boolean;
  /** The last rename that wrote something, for `Undo rename`; `redo` once it is undone. */
  last: { jobId: number; path: string; undone: boolean } | null;
};

let state: State = { status: null, rows: [], listOpen: false, last: null };
const listeners = new Set<() => void>();
const progressListeners = new Set<(p: JobProgressDto) => void>();
const movedListeners = new Set<(m: Moved) => void>();
const tracked = new Map<number, Tracked>();
/** The last progress of every job, for a job whose events came before `note_rename` answered. */
const seen = new Map<number, JobProgressDto>();
let started = false;
let doneTimer: ReturnType<typeof setTimeout> | null = null;

const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  for (const l of listeners) l();
};

const stem = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

/** Starts listening to `job:progress` once (App calls it on mount; the first rename does too). */
export function startJobs(): void {
  if (started) return;
  started = true;
  void events.jobProgress((p) => {
    seen.set(p.jobId, p);
    for (const f of progressListeners) f(p);
    void onProgress(p);
  });
}

async function onProgress(p: JobProgressDto) {
  const t = tracked.get(p.jobId);
  if (!t) return;
  const others = Math.max(0, p.total - 1);
  if (p.phase === 'writing' && others > 0 && t.kind === 'rename') set({ status: { phase: 'running', count: others, jobId: p.jobId } });
  if (p.phase !== 'done' && p.phase !== 'cancelled' && p.phase !== 'failed') return;
  tracked.delete(p.jobId);
  const report = await ipc.jobReport(p.jobId).catch(() => null);
  if (report) finished(p.jobId, t, report, others);
  else t.done?.(null);
}

function finished(jobId: number, t: Tracked, r: JobReportDto | null, others: number) {
  if (!r) return;
  // D-433: an undo of a rename takes that rename's rows away: retrying them would move links to a note that is gone.
  const undid = t.kind === 'undo' && r.phase === 'done' ? t.of : undefined;
  const rows = state.rows.filter((x) => x.jobId !== undid && !r.skipped.some((s) => s.path.normalize('NFC') === x.path.normalize('NFC')));
  for (const s of r.skipped) rows.push({ jobId, path: s.path.normalize('NFC'), title: stem(s.path), reason: s.reason });
  const patch: Partial<State> = { rows };
  if (t.kind === 'rename') {
    if (r.written.length > 0) patch.last = { jobId, path: r.renamed?.to ?? t.path, undone: false };
    if (others > 0 && r.phase === 'done') {
      patch.status = { phase: 'done', count: others, jobId };
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => { if (state.status?.jobId === jobId) set({ status: null }); }, 5000);
    } else if (state.status?.jobId === jobId) patch.status = null;
  } else if (state.last && state.last.jobId === t.of) {
    patch.last = { ...state.last, undone: t.kind === 'undo', path: r.renamed?.to ?? state.last.path };
    if (state.status?.jobId === t.of) patch.status = null;
  }
  set(patch);
  if (r.renamed) for (const f of movedListeners) f({ jobId, from: r.renamed.from.normalize('NFC'), to: r.renamed.to.normalize('NFC') });
  t.done?.(r);
}

/** Starts the `note-rename` job for a committed title; `fromTitle` is the title when the edit started (D-394). */
/** `done` is called once the job has finished (with its report), after any move it made. */
export async function renameNote(path: string, title: string, fromTitle: string, done?: (r: JobReportDto | null) => void): Promise<NoteRenameDto | null> {
  startJobs();
  try {
    const r = await ipc.noteRename(path, title, fromTitle);
    const t: Tracked = { kind: 'rename', path, done };
    tracked.set(r.jobId, t);
    const early = seen.get(r.jobId);
    if (early && early.phase === 'writing') void onProgress(early);
    // The final event may have come before the answer: ask for the report once.
    const rep = await ipc.jobReport(r.jobId).catch(() => null);
    if (rep && tracked.has(r.jobId)) {
      tracked.delete(r.jobId);
      finished(r.jobId, t, rep, Math.max(0, rep.written.length + rep.unchanged.length + rep.skipped.length - 1));
    }
    return r;
  } catch (e) {
    done?.(null);
    if (errorKind(e) === 'NotRenamable') return null;
    throw e;
  }
}

async function run(kind: 'undo' | 'redo', of: number): Promise<number | null> {
  startJobs();
  const r = await (kind === 'undo' ? ipc.jobUndo(of) : ipc.jobRedo(of)).catch(() => null);
  if (!r) return null;
  tracked.set(r.jobId, { kind, of, path: state.last?.path ?? '' });
  const rep = await ipc.jobReport(r.jobId).catch(() => null);
  if (rep && tracked.has(r.jobId)) {
    tracked.delete(r.jobId);
    finished(r.jobId, { kind, of, path: state.last?.path ?? '' }, rep, 0);
  }
  return r.jobId;
}

/** Undoes the last rename (palette `Undo rename`, ⌘Z right after it, the toast's `Undo`); null when there is none. */
export async function undoLast(): Promise<number | null> {
  const l = state.last;
  if (!l || l.undone) return null;
  return run('undo', l.jobId);
}

/** Redoes the last undone rename (⇧⌘Z right after the undo). */
export async function redoLast(): Promise<number | null> {
  const l = state.last;
  if (!l || !l.undone) return null;
  return run('redo', l.jobId);
}

/** The rename `path` was the subject of, if it is the last one and still undoable / redoable. */
export function lastRenameOf(path: string): { jobId: number; undone: boolean } | null {
  const l = state.last;
  return l && l.path.normalize('NFC') === path.normalize('NFC') ? { jobId: l.jobId, undone: l.undone } : null;
}

/** Retry for one row (FR-LNK-03 AC-15, AC-16): re-reads the current file (D-398); a successful retry removes the row. */
export async function retry(path: string): Promise<void> {
  const row = state.rows.find((r) => r.path === path.normalize('NFC'));
  if (!row || row.reason === 'missing') return;
  const r = await ipc.jobRetry(row.jobId, row.path).catch(() => null);
  if (!r) return;
  if (r.outcome === 'written' || r.outcome === 'unchanged') set({ rows: state.rows.filter((x) => x.path !== row.path) });
  else if (r.reason) set({ rows: state.rows.map((x) => (x.path === row.path ? { ...x, reason: r.reason! } : x)) });
}

export async function retryAll(): Promise<void> {
  for (const r of [...state.rows]) if (r.reason !== 'missing') await retry(r.path);
}

export function showList(open = true): void {
  set({ listOpen: open });
}

/** Calls `onProgress` for every `job:progress` event; returns the unsubscribe function. */
export function subscribe(onProgress: (p: JobProgressDto) => void): () => void {
  startJobs();
  progressListeners.add(onProgress);
  return () => { progressListeners.delete(onProgress); };
}

/** Calls `f` when a finished job moved a note (rename, undo, redo). */
export function onMoved(f: (m: Moved) => void): () => void {
  movedListeners.add(f);
  return () => { movedListeners.delete(f); };
}

export function useJobs(): State {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}

/** A vault switch forgets the list and the undo entry (D-385, D-398). */
export function resetJobs(): void {
  tracked.clear();
  set({ status: null, rows: [], listOpen: false, last: null });
}
