// Slice Q2: a board's card move, the one write path of every board (docs/contracts/v1-views.md §1.9; D-82, as the Tasks
// Kanban's tasks/write.ts). note_read → the version must still be the row's (else a conflict, never an overwrite,
// NFR-REL-02, FR-SYN-03 AC-30) → @tegg/doc `applyBoardMove` → `touchModified` → note_write with the row's version as
// base. At most one write per object is in flight; read-only rows are never written.
import { applyBoardMove, touchModified, type BoardMove } from '@tegg/doc';
import { ipc } from '../../ipc/client';
import type { QueryRowDto } from '../../ipc/queries';
import type { VersionDto } from '../../ipc/types';
import { localIso } from '../../newNote';

export type CardMoveResult =
  | { outcome: 'written'; inlineKept: boolean }
  | { outcome: 'unchanged' }
  | { outcome: 'conflict' | 'gone' | 'failed' };

/** D-175: the same bytes with only a new mtime are the same version (the hash decides when there is one). */
const sameVersion = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) =>
  !!a && !!b && (a.hash && b.hash ? a.hash === b.hash && a.size === b.size : JSON.stringify(a) === JSON.stringify(b));
const inFlight = new Map<string, Promise<unknown>>();

export function writeCardMove(row: QueryRowDto, move: BoardMove): Promise<CardMoveResult> {
  const key = row.path.normalize('NFC');
  const prev = inFlight.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => doWrite(row, move));
  inFlight.set(key, run);
  void run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); });
  return run;
}

async function doWrite(row: QueryRowDto, move: BoardMove): Promise<CardMoveResult> {
  if (row.readOnly) return { outcome: 'unchanged' };
  let note;
  try {
    note = await ipc.noteRead(row.path);
  } catch (e) {
    return { outcome: (e as { kind?: string })?.kind === 'NotFound' ? 'gone' : 'failed' };
  }
  if (!sameVersion(note.version, row.version)) return { outcome: 'conflict' };
  if (!note.utf8) return { outcome: 'unchanged' };
  const r = applyBoardMove(note.text, move);
  if (!r) return { outcome: 'unchanged' };
  const text = touchModified(note.text, r.text, localIso(new Date(Date.now())));
  try {
    await ipc.noteWrite(row.path, text, note.version);
    return { outcome: 'written', inlineKept: r.inlineKept };
  } catch (e) {
    const kind = (e as { kind?: string })?.kind;
    return { outcome: kind === 'Conflict' ? 'conflict' : kind === 'Gone' || kind === 'NotFound' ? 'gone' : 'failed' };
  }
}
