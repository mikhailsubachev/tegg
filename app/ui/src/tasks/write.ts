// Slice 5A-1: the one write path of every task surface (docs/contracts/ms5-tasks.md §5; D-82, D-472, D-478, D-506).
// note_read → the version must still be the row's (else a conflict, never an overwrite, NFR-REL-02) → @tegg/doc →
// touchModified → note_write with the row's version as base. At most one write per task is in flight.
import { applyTaskChange, completeTask, parse, touchModified, type TaskChange, type TaskState } from '@tegg/doc';
import { ipc } from '../ipc/client';
import type { TaskDefsDto, TaskRowDto, VersionDto } from '../ipc/types';
import { localIso } from '../newNote';

export type TaskAction = { kind: 'complete'; done: boolean } | { kind: 'change'; change: TaskChange };
export type WriteResult = { outcome: 'written' | 'unchanged'; inlineKept: boolean; text?: string; version?: VersionDto } | { outcome: 'conflict' | 'gone' | 'failed' };

const sameVersion = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

const inFlight = new Map<string, Promise<unknown>>();
/** Per path, the unbroken chain of versions this window's own writes went through (the first one replaced, then each
 *  one written). A queued action whose row is any version in the chain, while the file is at its end, is based on this
 *  window's own writes, not reported as an outside change (PR #47 reviews). Any outside write breaks the chain. */
const chains = new Map<string, VersionDto[]>();

/** Runs one task write. `base: 'current'` (Try again) bases it on the file as it is now. */
/** Tells the sidebar's Tasks count (D-588) that a task changed: the app's own writes send no `vault:changed`. */
export const TASKS_WRITTEN = 'tegg:tasks-written';
export function tasksWritten() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(TASKS_WRITTEN)); }

export function writeTask(row: TaskRowDto, defs: TaskDefsDto, action: TaskAction, base: 'row' | 'current' = 'row'): Promise<WriteResult> {
  const key = row.path.normalize('NFC');
  const prev = inFlight.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doWrite(row, defs, action, base));
  inFlight.set(key, run);
  void run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

async function doWrite(row: TaskRowDto, defs: TaskDefsDto, action: TaskAction, base: 'row' | 'current'): Promise<WriteResult> {
  if (row.readOnly) return { outcome: 'unchanged', inlineKept: false };
  let note;
  try {
    note = await ipc.noteRead(row.path);
  } catch (e) {
    return { outcome: (e as { kind?: string })?.kind === 'NotFound' ? 'gone' : 'failed' };
  }
  const key = row.path.normalize('NFC');
  const chain = chains.get(key) ?? [];
  const ours = chain.length > 1 && sameVersion(chain[chain.length - 1], note.version) && chain.some((v) => sameVersion(v, row.version));
  if (base === 'row' && !sameVersion(note.version, row.version) && !ours) return { outcome: 'conflict' };
  if (!note.utf8) return { outcome: 'unchanged', inlineKept: false };
  const now = localIso(new Date(Date.now()));
  let after: string | null = null;
  let inlineKept = false;
  if (action.kind === 'complete') after = completeTask(note.text, defs as never, action.done, now);
  else {
    // The status it changes from is the file's as read now (Try again reads a file the row may predate, D-472).
    const st = parse(note.text).frontmatter?.data?.status;
    const cur = typeof st === 'string' ? st.normalize('NFC') : null;
    const fromState = (defs.statuses.find((x) => x.label === cur)?.state ?? 'open') as TaskState;
    const change = action.change.kind === 'status' ? { ...action.change, fromState, now } : action.change;
    const r = applyTaskChange(note.text, change);
    after = r?.text ?? null;
    inlineKept = r?.inlineKept ?? false;
  }
  if (after === null) return { outcome: 'unchanged', inlineKept };
  const text = touchModified(note.text, after, now);
  try {
    const w = await ipc.noteWrite(row.path, text, note.version);
    const prev = chains.get(key);
    chains.set(key, prev && sameVersion(prev[prev.length - 1], note.version) ? [...prev.slice(-15), w.version] : [note.version, w.version]);
    tasksWritten();
    return { outcome: 'written', inlineKept, text, version: w.version };
  } catch (e) {
    const kind = (e as { kind?: string })?.kind;
    return { outcome: kind === 'Conflict' ? 'conflict' : kind === 'Gone' || kind === 'NotFound' ? 'gone' : 'failed' };
  }
}
