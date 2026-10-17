// Slice 4C (docs/contracts/ms4-jobs.md §10): the UI side of the job engine: start a note rename on a title commit
// (D-268), undo the last rename (D-385), follow `job:progress` (FR-UX-07 AC-8, AC-9).
//
// Stub (slice 4C red tests): nothing is started; `subscribe` never calls back.
import type { JobProgressDto, NoteRenameDto } from '../ipc/types';

/** Starts the `note-rename` job for a committed title; `fromTitle` is the title when the edit started (D-394). */
export async function renameNote(path: string, title: string, fromTitle: string): Promise<NoteRenameDto | null> {
  void path;
  void title;
  void fromTitle;
  return null;
}

/** Undoes the last undoable job (palette `Undo rename`); returns the undo job's id, or null when there is none. */
export async function undoLast(): Promise<number | null> {
  return null;
}

/** Calls `onProgress` for every `job:progress` event; returns the unsubscribe function. */
export function subscribe(onProgress: (p: JobProgressDto) => void): () => void {
  void onProgress;
  return () => {};
}
