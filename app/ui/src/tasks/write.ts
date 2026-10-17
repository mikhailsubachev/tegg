// Slice 5A-1: the one write path of every task surface (docs/contracts/ms5-tasks.md §5; D-82, D-472, D-478, D-506).
// note_read → the version must still be the row's (else a conflict, never an overwrite, NFR-REL-02) → @tegg/doc →
// touchModified → note_write with the row's version as base. At most one write per task is in flight.
import { applyTaskChange, completeTask, touchModified, type TaskChange } from '@tegg/doc';
import { ipc } from '../ipc/client';
import type { TaskDefsDto, TaskRowDto, VersionDto } from '../ipc/types';
import { localIso } from '../newNote';

export type TaskAction = { kind: 'complete'; done: boolean } | { kind: 'change'; change: TaskChange };
export type WriteResult = { outcome: 'written' | 'unchanged'; inlineKept: boolean } | { outcome: 'conflict' | 'gone' | 'failed' };

const sameVersion = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

const inFlight = new Map<string, Promise<unknown>>();

/** Runs one task write. `base: 'current'` (Try again) bases it on the file as it is now. */
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
  if (base === 'row' && !sameVersion(note.version, row.version)) return { outcome: 'conflict' };
  if (!note.utf8) return { outcome: 'unchanged', inlineKept: false };
  const now = localIso(new Date(Date.now()));
  let after: string | null = null;
  let inlineKept = false;
  if (action.kind === 'complete') after = completeTask(note.text, defs as never, action.done, now);
  else {
    const change = action.change.kind === 'status' ? { ...action.change, now } : action.change;
    const r = applyTaskChange(note.text, change);
    after = r?.text ?? null;
    inlineKept = r?.inlineKept ?? false;
  }
  if (after === null) return { outcome: 'unchanged', inlineKept };
  const text = touchModified(note.text, after, now);
  try {
    await ipc.noteWrite(row.path, text, note.version);
    return { outcome: 'written', inlineKept };
  } catch (e) {
    const kind = (e as { kind?: string })?.kind;
    return { outcome: kind === 'Conflict' ? 'conflict' : kind === 'Gone' || kind === 'NotFound' ? 'gone' : 'failed' };
  }
}
