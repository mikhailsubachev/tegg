// Slice 4C (docs/contracts/ms4-jobs.md §10): the UI side of the job engine: start a note rename on a title commit
// (D-268), undo and redo it (D-385), follow `job:progress` (FR-UX-07 AC-8, AC-9), and keep the "links not updated"
// list in memory until quit (D-398). One store for the app; components read it with `useJobs`.
import { useSyncExternalStore } from 'react';
import { errorKind, events, ipc } from '../ipc/client';
import type { JobPlanDto, JobProgressDto, JobReportDto, NoteRenameDto } from '../ipc/types';
import { t as t_ } from '../i18n/catalog';

/** `retry: false`: a row Retry can't redo (a type delete's skipped object, FR-TYP-05 AC-9 asks only for Show). */
export type SkipRow = { jobId: number; path: string; title: string; reason: string; retry?: false };
/** A finished rename, undo or redo that moved a note (the open note page follows it). */
export type Moved = { jobId: number; from: string; to: string };

/** `text`: a 4D-lite job's own status line (no Undo, D-395). `undo`: a 4E-1 job the status can undo (D-812); `show`:
 *  the status opens the not-updated list. */
type Status = { phase: 'running' | 'done'; count: number; jobId: number; text?: string; cancel?: boolean; alert?: boolean; undo?: number; show?: boolean; hideAfter?: number } | null;
/** The undoable 4E jobs (D-812): ⌘Z after a type change, the status's `Undo`, the palette's `Undo <operation>`. */
export type UndoKind = 'type-move' | 'folder-move' | 'value-remove' | 'type-delete';
type Tracked = {
  kind: 'rename' | 'undo' | 'redo' | 'confirmed' | 'move'; of?: number; path: string; done?: (r: JobReportDto | null) => void;
  running?: (count: number, done: number) => string; doneText?: (r: JobReportDto) => string | null; count?: number;
  /** 4E-1: the move's kind, and the target type's name for `Now a <Type>`; 4E-2: the delete job's kind. */
  moveKind?: UndoKind; typeName?: string; folderType?: string;
  /** 4E-2 (ms4-jobs §14.9.1): cancellable while writing too; the done status offers Undo (and Show with skips). */
  undoable?: boolean;
};
/** 4E-1: a type as the move status texts name it (R99: the Name for 1, the plural otherwise, in lower case). */
export type MoveType = { key: string; name: string; plural: string; folder: string };

type State = {
  status: Status;
  rows: SkipRow[];
  listOpen: boolean;
  /** The last rename that wrote something, for `Undo rename`; `redo` once it is undone. */
  last: { jobId: number; path: string; undone: boolean } | null;
  /** 4E-1 (D-812): the last type or folder move, for ⌘Z in the moved note, `Undo type change` and `Undo move`. */
  lastMove: { jobId: number; kind: UndoKind; path: string | null; undone: boolean } | null;
};

let state: State = { status: null, rows: [], listOpen: false, last: null, lastMove: null };
let moveTypes: MoveType[] = [];
/** A folder save the UI asked for: the next folder-move job the core starts is that one (D-822). */
let pendingFolder: string | null = null;
const listeners = new Set<() => void>();
const progressListeners = new Set<(p: JobProgressDto) => void>();
const movedListeners = new Set<(m: Moved) => void>();
const rewrittenListeners = new Set<(path: string) => void>();
const tracked = new Map<number, Tracked>();
const seenMove = new Set<number>();
/** While the UI starts a move or an undo itself, early events of its job aren't taken for a core-started move. */
let claiming = 0;
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
    // Slice I2 (v1-import-window §2.4, ms4-jobs §10): an import's status is the Import window's, driven by `import:progress`.
    if ((p as { kind?: string }).kind === 'import') return;
    seen.set(p.jobId, p);
    for (const f of progressListeners) f(p);
    void onProgress(p);
  });
}

async function onProgress(p: JobProgressDto) {
  let t = tracked.get(p.jobId);
  // 4E-1: a move the core started (the tidy job, a folder save inside `type_patch`) is followed from its first event.
  if (!t && (p.kind === 'folder-move' || p.kind === 'type-move') && !seenMove.has(p.jobId) && claiming === 0) {
    seenMove.add(p.jobId);
    t = { kind: 'move', path: '', moveKind: p.kind, folderType: p.kind === 'folder-move' ? pendingFolder ?? undefined : undefined };
    if (p.kind === 'folder-move') pendingFolder = null;
    tracked.set(p.jobId, t);
  }
  if (!t) return;
  if (t.kind === 'confirmed') return confirmedProgress(p, t);
  if (t.kind === 'move') return moveProgress(p, t);
  if (t.kind === 'undo' && t.moveKind) {
    if (p.phase !== 'done' && p.phase !== 'cancelled' && p.phase !== 'failed') return;
    tracked.delete(p.jobId);
    const rep = await ipc.jobReport(p.jobId).catch(() => null);
    t.done?.(rep);
    return;
  }
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
  for (const r of [...state.rows]) if (r.reason !== 'missing' && r.retry !== false) await retry(r.path);
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

/** Calls `f` for each note a finished 4E-1 job (or its undo / redo) wrote where it was: a type change in place is
 *  written on disk, never through the editor (QA 4E-1 M1, 4 M1′), so an open page takes it as an external change. */
export function onRewritten(f: (path: string) => void): () => void {
  rewrittenListeners.add(f);
  return () => { rewrittenListeners.delete(f); };
}

const rewritten = (r: JobReportDto) => {
  const moved = new Set([...(r.moved ?? []).flatMap((m) => [m.from, m.to]), ...(r.renamed ? [r.renamed.from, r.renamed.to] : [])].map((p) => p.normalize('NFC')));
  for (const w of r.written) if (!moved.has(w.normalize('NFC'))) for (const f of rewrittenListeners) f(w.normalize('NFC'));
};

/** Calls `f` when a finished job moved a note (rename, undo, redo). */
export function onMoved(f: (m: Moved) => void): () => void {
  movedListeners.add(f);
  return () => { movedListeners.delete(f); };
}

// ---------------------------------------------------------------- 4E-1 (ms4-jobs §14.8, R99 A, B2; D-804, D-805, D-812)

const typeWord = (t: MoveType | undefined, n: number) => (t ? (n === 1 ? t.name : t.plural) : '').toLocaleLowerCase();
const typeOfPath = (p: string) => {
  const f = p.normalize('NFC').toLowerCase();
  return [...moveTypes].sort((a, b) => b.folder.length - a.folder.length).find((t) => t.folder && f.startsWith(`${t.folder.normalize('NFC').toLowerCase()}/`));
};

/** The types the move status texts name (App keeps it current). */
export function setMoveTypes(types: MoveType[]): void {
  moveTypes = types;
}

/** Type settings is about to save a new folder for `typeKey` (D-822): the folder-move job that follows is named by it. */
export function expectFolderMove(typeKey: string): void {
  pendingFolder = typeKey;
}

async function moveProgress(p: JobProgressDto, t: Tracked) {
  const type = moveTypes.find((x) => x.key === t.folderType);
  if (t.moveKind === 'folder-move' && type && !['done', 'cancelled', 'failed'].includes(p.phase)) {
    // The job can be cancelled until it writes (ms4-jobs §14.1: planning, backup).
    const n = p.total;
    set({ status: { phase: 'running', count: n, jobId: p.jobId, text: t_('job.folderMove.running', { plural: typeWord(type, n), done: p.done, n }), cancel: p.phase !== 'writing' } });
  }
  if (p.phase !== 'done' && p.phase !== 'cancelled' && p.phase !== 'failed') return;
  tracked.delete(p.jobId);
  const r = await ipc.jobReport(p.jobId).catch(() => null);
  // A tidy run at vault open can end before the app has its type list: the status texts need the types' names.
  if (r?.moved?.length && moveTypes.length === 0) {
    const types = await ipc.vaultTypes().catch(() => []);
    if (moveTypes.length === 0) moveTypes = types.map((x) => ({ key: x.key, name: x.name, plural: x.plural, folder: x.folder }));
  }
  moveFinished(p.jobId, t, r);
}

function moveFinished(jobId: number, t: Tracked, r: JobReportDto | null) {
  if (!r) { if (state.status?.jobId === jobId) set({ status: null }); t.done?.(null); return; }
  const rows = state.rows.filter((x) => !r.skipped.some((s) => s.path.normalize('NFC') === x.path.normalize('NFC')));
  for (const s of r.skipped) rows.push({ jobId, path: s.path.normalize('NFC'), title: stem(s.path), reason: s.reason });
  const moved = r.moved ?? [];
  const patch: Partial<State> = { rows };
  let text: string | null = null;
  let show = false;
  const failed = r.phase === 'failed' && /BackupFailed/.test(r.error ?? '');
  // m2: a type move whose notes were all skipped says so (with `Show`), never `Now a <Type>`.
  if (r.phase === 'done' && t.moveKind === 'type-move' && r.written.length === 0 && r.skipped.length > 0) { text = t_('job.notUpdated.count', { count: r.skipped.length }); show = true; }
  else if (r.phase === 'done' && t.moveKind === 'type-move') text = t.typeName ? t_('job.typeMove.done', { type: t.typeName }) : null;
  else if (r.phase === 'done' && moved.length > 0) {
    // Moved notes by their new type, in the order they were moved.
    const groups: { type: MoveType | undefined; n: number }[] = [];
    for (const m of moved) {
      const ty = t.folderType ? moveTypes.find((x) => x.key === t.folderType) : typeOfPath(m.to);
      const g = groups.find((x) => x.type?.key === ty?.key);
      if (g) g.n++; else groups.push({ type: ty, n: 1 });
    }
    const [a, b] = groups;
    const changed = r.written.filter((w) => !moved.some((m) => m.to.normalize('NFC') === w.normalize('NFC'))).length;
    if (r.skipped.length) { text = t_('job.folderMove.skipped', { n: a.n, plural: typeWord(a.type, a.n), k: r.skipped.length }); show = true; }
    else if (t.folderType) text = t_('job.folderMove.done', { n: a.n, plural: typeWord(a.type, a.n) }) + (changed ? ` · ${t_('job.folderMove.links', { count: changed })}` : '');
    else if (b) text = t_('job.folderMove.tidy', { n: a.n, plural: typeWord(a.type, a.n), k: b.n, plural2: typeWord(b.type, b.n) });
    else text = t_('job.folderMove.tidyOne', { n: a.n, plural: typeWord(a.type, a.n) });
  } else if (failed) text = t_('job.backupFailed');
  const undoable = r.phase === 'done' && (moved.length > 0 || r.written.length > 0);
  if (undoable) patch.lastMove = { jobId, kind: t.moveKind ?? 'type-move', path: r.renamed?.to?.normalize('NFC') ?? (r.written[0] ?? null), undone: false };
  if (text) {
    // Its 5 s start when the status is first shown (JobStatus), so a tidy run at vault open isn't over before the page is.
    patch.status = { phase: 'done', count: r.written.length, jobId, text, alert: failed, undo: undoable ? jobId : undefined, show, hideAfter: 5000 };
    if (doneTimer) clearTimeout(doneTimer);
  } else if (state.status?.jobId === jobId) patch.status = null;
  set(patch);
  // ms4-jobs §9: an open note the job moved (a single move, a bulk convert, a folder save, the tidy job) follows it.
  const moves = r.renamed ? [r.renamed] : moved;
  for (const m of moves) for (const f of movedListeners) f({ jobId, from: m.from.normalize('NFC'), to: m.to.normalize('NFC') });
  rewritten(r);
  t.done?.(r);
}

/** `type_move` (D-804): one or more notes to `toType` with the dialog's mapping; `review` for an Inbox convert. */
export async function moveNotes(paths: string[], toType: string, toName: string, mapping: { from: string; to: string }[], review: boolean, done?: (r: JobReportDto | null) => void, bulk = false): Promise<number | null> {
  startJobs();
  claiming++;
  const { jobId } = await ipc.typeMove(paths, toType, mapping, review, bulk).finally(() => { claiming--; });
  if (jobId === null) { done?.(null); return null; }
  const t: Tracked = { kind: 'move', path: paths[0] ?? '', moveKind: 'type-move', typeName: toName, done };
  seenMove.add(jobId);
  tracked.set(jobId, t);
  const rep = await ipc.jobReport(jobId).catch(() => null);
  if (rep && tracked.has(jobId)) { tracked.delete(jobId); moveFinished(jobId, t, rep); }
  return jobId;
}

/** Undoes (or redoes) a 4E-1 job; the status's `Undo`, ⌘Z / ⇧⌘Z in the moved note, the palette commands. */
export async function undoMove(jobId: number, back = true): Promise<number | null> {
  startJobs();
  claiming++;
  const r = await (back ? ipc.jobUndo(jobId) : ipc.jobRedo(jobId)).catch(() => null).finally(() => { claiming--; });
  if (!r) return null;
  const lm = state.lastMove;
  const t: Tracked = { kind: 'move', path: '', moveKind: lm?.kind, done: (rep) => {
    if (rep && rep.phase === 'done' && state.lastMove?.jobId === jobId) set({ lastMove: { ...state.lastMove, undone: back, path: rep.renamed?.to?.normalize('NFC') ?? state.lastMove.path } });
    if (rep?.renamed) for (const f of movedListeners) f({ jobId: r.jobId, from: rep.renamed.from.normalize('NFC'), to: rep.renamed.to.normalize('NFC') });
    if (rep) rewritten(rep);
  } };
  if (state.status?.undo === jobId) set({ status: null });
  seenMove.add(r.jobId);
  tracked.set(r.jobId, { ...t, kind: 'undo', of: jobId });
  const rep = await ipc.jobReport(r.jobId).catch(() => null);
  if (rep && tracked.has(r.jobId)) { tracked.delete(r.jobId); t.done?.(rep); }
  return r.jobId;
}

/** The palette's `Undo type change` / `Undo move` (R100, D-830): only while that kind is the last undoable move. */
export function undoLastMove(kind: UndoKind): void {
  const l = state.lastMove;
  if (l && l.kind === kind && !l.undone) void undoMove(l.jobId, true);
}

/** The last undoable job (rename or type move) of the note at `path`, for ⌘Z / ⇧⌘Z right after it. */
export function lastJobOf(path: string): { jobId: number; undone: boolean; move: boolean } | null {
  const p = path.normalize('NFC');
  const m = state.lastMove;
  const r = state.last;
  const mm = m && m.kind === 'type-move' && m.path === p ? m : null;
  const rr = r && r.path.normalize('NFC') === p ? r : null;
  if (mm && (!rr || mm.jobId > rr.jobId)) return { jobId: mm.jobId, undone: mm.undone, move: true };
  return rr ? { jobId: rr.jobId, undone: rr.undone, move: false } : null;
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
  set({ status: null, rows: [], listOpen: false, last: null, lastMove: null });
}

// ---------------------------------------------------------------- 4D-lite (ms4-tags §4.4): jobs a dialog confirmed

async function confirmedProgress(p: JobProgressDto, t: Tracked) {
  const n = t.count ?? p.total;
  if (p.phase === 'writing' && t.running) set({ status: { phase: 'running', count: n, jobId: p.jobId, text: t.running(n, p.done), cancel: t.undoable } });
  if (p.phase !== 'done' && p.phase !== 'cancelled' && p.phase !== 'failed') return;
  tracked.delete(p.jobId);
  const r = await ipc.jobReport(p.jobId).catch(() => null);
  confirmedFinished(p.jobId, t, r);
}

function confirmedFinished(jobId: number, t: Tracked, r: JobReportDto | null) {
  if (!r) { t.done?.(null); return; }
  const rows = state.rows.filter((x) => !r.skipped.some((s) => s.path.normalize('NFC') === x.path.normalize('NFC')));
  // Rows Retry can't redo: a type delete's skipped objects, a property delete's anchored entries (D-858, D-859).
  const noRetry = (reason: string) => t.moveKind === 'type-delete' || (t.moveKind === 'value-remove' && reason === 'readOnly') ? { retry: false as const } : {};
  for (const s of r.skipped) rows.push({ jobId, path: s.path.normalize('NFC'), title: stem(s.path), reason: s.reason, ...noRetry(s.reason) });
  const failed = r.phase === 'failed' && /BackupFailed/.test(r.error ?? '');
  // D-857, D-859: a 4E-2 job that failed after writing put everything back; the status says so.
  const lateFail = t.undoable && r.phase === 'failed' && !failed;
  const text = r.phase === 'done' ? t.doneText?.(r) ?? null : failed ? t_('job.backupFailed') : lateFail ? t_('job.delete.failed', { name: t.typeName ?? '' }) : null;
  const patch: Partial<State> = { rows };
  const undoable = t.undoable && r.phase === 'done' && r.written.length > 0;
  if (undoable) patch.lastMove = { jobId, kind: t.moveKind!, path: null, undone: false };
  if (text && t.undoable) {
    // 4E-2 (R99 D3, F2): Undo for 5 s once shown; Show opens the not-updated list when something was skipped (D-844).
    patch.status = { phase: 'done', count: r.written.length, jobId, text, alert: failed || lateFail, undo: undoable ? jobId : undefined, show: r.skipped.length > 0, hideAfter: 5000 };
    if (doneTimer) clearTimeout(doneTimer);
  } else if (text) {
    patch.status = { phase: 'done', count: r.written.length, jobId, text, alert: failed };
    if (doneTimer) clearTimeout(doneTimer);
    doneTimer = setTimeout(() => { if (state.status?.jobId === jobId) set({ status: null }); }, 5000);
  } else if (state.status?.jobId === jobId) patch.status = null;
  set(patch);
  if (r.renamed) for (const f of movedListeners) f({ jobId, from: r.renamed.from.normalize('NFC'), to: r.renamed.to.normalize('NFC') });
  t.done?.(r);
}

/** Starts a job that waits in `confirm` and confirms it at once: the dialog's button was the confirmation (tag rename,
 *  tag delete, merge). Resolves with the job id (null when nothing starts) once the job is confirmed; `done` gets the
 *  report when it has finished. Start errors are thrown to the dialog. */
export async function runConfirmed(start: () => Promise<{ jobId: number | null }>, o: { count?: number; running?: (count: number) => string; done?: (r: JobReportDto) => string | null; finished?: (r: JobReportDto | null) => void; confirm?: boolean; started?: (jobId: number) => void }): Promise<number | null> {
  startJobs();
  const { jobId } = await start();
  if (jobId === null) { o.finished?.(null); return null; }
  o.started?.(jobId);
  const t: Tracked = { kind: 'confirmed', path: '', running: o.running, doneText: o.done, done: o.finished, count: o.count };
  tracked.set(jobId, t);
  // Until it writes, the job can be cancelled from its status (ms4-jobs §1: planning, confirm, backup).
  if (o.running) set({ status: { phase: 'running', count: o.count ?? 0, jobId, text: o.running(o.count ?? 0), cancel: true } });
  if (o.confirm !== false) {
    const end = Date.now() + 30_000;
    for (;;) {
      const ok = await ipc.jobConfirm(jobId).then(() => true, () => false);
      if (ok || !tracked.has(jobId) || Date.now() > end) break;
      const rep = await ipc.jobReport(jobId).catch(() => null);
      if (rep) break;
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const early = seen.get(jobId);
  if (early && tracked.has(jobId)) void onProgress(early);
  const rep = await ipc.jobReport(jobId).catch(() => null);
  if (rep && tracked.has(jobId)) { tracked.delete(jobId); confirmedFinished(jobId, t, rep); }
  return jobId;
}

// ---------------------------------------------------------------- 4E-2 (ms4-jobs §14.9.6, R99 D, F)

/** Starts a `value-remove` or `type-delete` job and waits until it stops in `confirm`: its plan has the counts the
 *  dialog shows (FR-TYP-04 AC-6, FR-TYP-05 AC-6). Null when no job starts or it ends before confirm; start errors are
 *  thrown to the dialog. */
export async function planDelete(start: () => Promise<{ jobId: number | null }>): Promise<{ jobId: number; plan: JobPlanDto } | null> {
  startJobs();
  const { jobId } = await start();
  if (jobId === null) return null;
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const plan = await ipc.jobPlan(jobId).catch(() => null);
    if (plan) return { jobId, plan };
    if (await ipc.jobReport(jobId).catch(() => null)) return null;
    await new Promise((r) => setTimeout(r, 30));
  }
  // QA 4E-2 N9: a job that never reached confirm is cancelled, so it doesn't wait there later and hold the queue.
  void ipc.jobCancel(jobId).catch(() => {});
  throw new Error('timeout');
}

/** The dialog's confirm button: the job writes, with its R99 status (count while writing, Cancel; done with Undo). */
export async function confirmDelete(jobId: number, kind: 'value-remove' | 'type-delete', o: { name: string; count: number; running: (n: number, done: number) => string; done: (r: JobReportDto) => string | null; finished?: (r: JobReportDto | null) => void }): Promise<void> {
  const t: Tracked = { kind: 'confirmed', path: '', moveKind: kind, typeName: o.name, undoable: true, count: o.count, running: o.running, doneText: o.done, done: o.finished };
  tracked.set(jobId, t);
  await ipc.jobConfirm(jobId).catch(() => {});
  const early = seen.get(jobId);
  if (early && tracked.has(jobId)) void onProgress(early);
  const rep = await ipc.jobReport(jobId).catch(() => null);
  if (rep && tracked.has(jobId)) { tracked.delete(jobId); confirmedFinished(jobId, t, rep); }
}

/** The status of the last 4E job, for the deleted-type route's `Undo` (FR-TYP-05 AC-7). */
export function lastUndoable(kind: UndoKind): number | null {
  const l = state.lastMove;
  return l && l.kind === kind && !l.undone ? l.jobId : null;
}

/** Clears the status of `jobId` if it is still the one shown (the move statuses' timer, JobStatus). */
export function clearStatus(jobId: number): void {
  if (state.status?.jobId === jobId) set({ status: null });
}

/** The status's `Cancel` of a confirmed job that hasn't started writing. */
export function cancelStatusJob(): void {
  const st = state.status;
  if (!st?.cancel) return;
  void ipc.jobCancel(st.jobId).catch(() => {});
  set({ status: null });
}
