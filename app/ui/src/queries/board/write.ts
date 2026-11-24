// Slice Q2: a board's card move, the one write path of every board (docs/contracts/v1-views.md §1.9; D-82, as the Tasks
// Kanban's tasks/write.ts). note_read → the version must still be the row's (else a conflict, never an overwrite,
// NFR-REL-02, FR-SYN-03 AC-30) → @tegg/doc `applyBoardMove` → `touchModified` → note_write with the row's version as
// base. At most one write per object is in flight; read-only rows are never written.
// Slice Q2-T (v1-views §26): `writeCardChange` is that path with the change as a parameter; card moves, period moves,
// the Task card's checkbox and its menu's status, priority and due all go through it, so every write to one object from
// a board shares one queue.
import { applyBoardMove, applyPeriodMove, applyTaskChange, touchModified, type BoardMove, type PeriodMove, type TaskState } from '@tegg/doc';
import { ipc } from '../../ipc/client';
import type { QueryRowDto } from '../../ipc/queries';
import type { TaskDefsDto, VersionDto } from '../../ipc/types';
import { localIso } from '../../newNote';
import { tasksWritten } from '../../tasks/write';

export type CardMoveResult =
  | { outcome: 'written'; inlineKept: boolean }
  | { outcome: 'unchanged' }
  | { outcome: 'conflict' | 'gone' | 'failed' };

/** D-175: the same bytes with only a new mtime are the same version (the hash decides when there is one). */
const sameVersion = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) =>
  !!a && !!b && (a.hash && b.hash ? a.hash === b.hash && a.size === b.size : JSON.stringify(a) === JSON.stringify(b));
const inFlight = new Map<string, Promise<unknown>>();
/** QA S3: per path, the unbroken chain of versions this window's own board writes went through (the version replaced,
 *  then each one written). A queued write whose row is any version in the chain, while the file is at its end, builds
 *  on this window's own writes (not an outside change); any outside write breaks the chain (as tasks/write.ts). */
const chains = new Map<string, VersionDto[]>();

/** A change of a note's text: the new text (before `touchModified`), or null for nothing to write. */
export type CardChange = (text: string) => { text: string; inlineKept: boolean } | null;

/** One write of one object from a board, queued behind the object's previous one (§26). */
export function writeCardChange(row: QueryRowDto, change: CardChange): Promise<CardMoveResult> {
  const key = row.path.normalize('NFC');
  const prev = inFlight.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doWrite(row, change));
  inFlight.set(key, run);
  void run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

export function writeCardMove(row: QueryRowDto, move: BoardMove): Promise<CardMoveResult> {
  return writeCardChange(row, (text) => applyBoardMove(text, move));
}

/** A period drag, `Move to ›` or a done-lane drop on a period board (§26): the date key's line, or the status. */
export function writePeriodMove(row: QueryRowDto, move: PeriodMove): Promise<CardMoveResult> {
  return writeCardChange(row, (text) => {
    const after = applyPeriodMove(text, move);
    return after === null ? null : { text: after, inlineKept: false };
  });
}

async function doWrite(row: QueryRowDto, change: CardChange): Promise<CardMoveResult> {
  if (row.readOnly) return { outcome: 'unchanged' };
  let note;
  try {
    note = await ipc.noteRead(row.path);
  } catch (e) {
    return { outcome: (e as { kind?: string })?.kind === 'NotFound' ? 'gone' : 'failed' };
  }
  const key = row.path.normalize('NFC');
  const chain = chains.get(key) ?? [];
  const ours = chain.length > 1 && sameVersion(chain[chain.length - 1], note.version) && chain.some((v) => sameVersion(v, row.version));
  if (!sameVersion(note.version, row.version) && !ours) return { outcome: 'conflict' };
  if (!note.utf8) return { outcome: 'unchanged' };
  const r = change(note.text);
  if (!r) return { outcome: 'unchanged' };
  const text = touchModified(note.text, r.text, localIso(new Date(Date.now())));
  try {
    const w = await ipc.noteWrite(row.path, text, note.version);
    const prev = chains.get(key);
    if (w?.version) chains.set(key, prev && sameVersion(prev[prev.length - 1], note.version) ? [...prev.slice(-15), w.version] : [note.version, w.version]);
    if (row.type.normalize('NFC') === 'task') tasksWritten();
    return { outcome: 'written', inlineKept: r.inlineKept };
  } catch (e) {
    const kind = (e as { kind?: string })?.kind;
    return { outcome: kind === 'Conflict' ? 'conflict' : kind === 'Gone' || kind === 'NotFound' ? 'gone' : 'failed' };
  }
}

/** R43's `Set status` on a Task card (§29.5; the grouped and the ungrouped wall, D-2220): the text change that sets
 *  `label`, with its state's side effects (`completed`); null when nothing changes. */
export function taskStatusChange(defs: TaskDefsDto, row: QueryRowDto, label: string, now: string): (text: string) => string | null {
  const stateOf = (l: string | null) => (defs.statuses.find((x) => x.label === l)?.state ?? 'open') as TaskState;
  const firstOpen = defs.statuses.find((x) => x.state === 'open')?.label ?? defs.statuses[0]?.label ?? '';
  return (text) => applyTaskChange(text, { kind: 'status', to: label, toState: stateOf(label), fromState: stateOf(row.taskRow?.status ?? null), firstOpen, now })?.text ?? null;
}
